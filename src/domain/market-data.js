import { WINDOWS } from "./taxonomy.js";
import { lookupUniverseEntry } from "./tracked-universe.js";
import {
  alpacaHeaders,
  isLiveMarketProviderConfigured,
  liveMarketProviderChain,
  liveMarketDataStatus,
  marketProviderCooldownMs,
  normalizeAlpacaTimeframe,
  providerCooldownSnapshot,
  trimTrailingSlash
} from "./market-providers.js";
import { fetchResearchProviderBars } from "./research-providers.js";
import { clamp, fingerprint, round } from "../utils/helpers.js";

function deterministicUnit(value) {
  const hex = fingerprint(value).slice(0, 8);
  return parseInt(hex, 16) / 0xffffffff;
}

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
    }
  };
}

function intervalLookbackDays(interval, pointCount) {
  const normalized = String(interval || "15min").trim().toLowerCase();
  const points = Math.max(1, Number(pointCount || 18));
  if (/d|day/.test(normalized)) {
    return Math.max(14, points * 3);
  }
  if (/h|hr|hour/.test(normalized)) {
    return Math.max(7, Math.ceil(points / 4) + 4);
  }
  return Math.max(7, Math.ceil(points / 8) + 4);
}

function isoDaysAgo(days) {
  return new Date(Date.now() - Math.max(1, Number(days || 1)) * 24 * 60 * 60 * 1000).toISOString();
}

function isoDateDaysAgo(days) {
  return new Date(Date.now() - Math.max(1, Number(days || 1)) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function massiveRangeSpec(interval = "15min") {
  const normalized = String(interval || "15min").trim().toLowerCase();
  const match = normalized.match(/^(\d+)\s*(m|min|minute|minutes|h|hr|hour|hours|d|day|days)$/);
  const value = Math.max(1, Number(match?.[1] || 1));
  const unit = match?.[2] || "day";
  if (["m", "min", "minute", "minutes"].includes(unit)) {
    return { multiplier: value, timespan: "minute" };
  }
  if (["h", "hr", "hour", "hours"].includes(unit)) {
    return { multiplier: value, timespan: "hour" };
  }
  return { multiplier: value, timespan: "day" };
}

function marketHealth(store, config) {
  if (!store.health.liveSources.market_data) {
    store.health.liveSources.market_data = {
      provider: config.marketDataProvider,
      enabled: config.marketDataProvider !== "synthetic",
      polling: false,
      last_poll_at: null,
      last_success_at: null,
      last_error: null,
      cache_entries: 0,
      fallback_mode: config.marketDataProvider === "synthetic",
      configured: isLiveMarketProviderConfigured(config, config.marketDataProvider),
      feed: null,
      missing_config_reason: null
    };
  }

  return store.health.liveSources.market_data;
}

function parseSeriesTimestamp(value) {
  if (!value) {
    return new Date().toISOString();
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T00:00:00.000Z`;
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return `${value.replace(" ", "T")}Z`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function buildSeriesSignal(scoredDocs, pointTime) {
  const signal = scoredDocs.reduce(
    (acc, item) => {
      const published = new Date(item.normalized.published_at).getTime();
      const pointTimestamp = pointTime.getTime();

      if (published > pointTimestamp) {
        return acc;
      }

      const ageHours = (pointTimestamp - published) / 3_600_000;
      const decay = Math.exp(-ageHours / 12);
      const weight = Math.max(0.05, item.score.impact_score * item.score.final_confidence * decay);
      acc.alpha += item.score.document_alpha * decay;
      acc.weight += weight;
      acc.confidence += item.score.final_confidence * decay;
      return acc;
    },
    { alpha: 0, weight: 0, confidence: 0 }
  );

  return {
    sentiment: signal.weight ? clamp(signal.alpha / signal.weight, -1, 1) : 0,
    confidence: signal.weight ? clamp(signal.confidence / Math.max(1, scoredDocs.length), 0, 1) : 0
  };
}

function buildSyntheticTickerMarketSeries(ticker, scoredDocs, asOf, pointCount = 18, tickerEntry = null) {
  const fallbackUnit = deterministicUnit(`${ticker}:synthetic_price`);
  const basePrice = tickerEntry?.base_price || tickerEntry?.market_reference?.current_price || round(45 + fallbackUnit * 420, 2);
  const endTime = new Date(asOf || Date.now());
  const startTime = new Date(endTime.getTime() - 24 * 3_600_000);
  const sentimentHistory = [];
  const priceHistory = [];
  const barHistory = [];
  let price = basePrice;

  for (let index = 0; index < pointCount; index += 1) {
    const ratio = pointCount === 1 ? 1 : index / (pointCount - 1);
    const pointTime = new Date(startTime.getTime() + ratio * (endTime.getTime() - startTime.getTime()));
    const signal = buildSeriesSignal(scoredDocs, pointTime);
    const drift = signal.sentiment * 0.012 * (0.4 + signal.confidence);
    const noise = (deterministicUnit(`${ticker}:${index}:${pointTime.toISOString()}`) - 0.5) * 0.006;
    const open = index === 0 ? basePrice * (1 - drift * 1.8) : price;
    price = index === 0 ? open : price * (1 + drift + noise);
    price = Math.max(1, price);
    const high = Math.max(open, price) * (1 + deterministicUnit(`${ticker}:high:${index}`) * 0.008);
    const low = Math.min(open, price) * (1 - deterministicUnit(`${ticker}:low:${index}`) * 0.008);
    const volume = Math.round(
      900000 +
        deterministicUnit(`${ticker}:volume:${index}:${pointTime.toISOString()}`) * 2500000 * (1 + Math.abs(signal.sentiment))
    );

    sentimentHistory.push({
      timestamp: pointTime.toISOString(),
      sentiment: round(signal.sentiment, 4),
      confidence: round(signal.confidence, 4)
    });
    priceHistory.push({
      timestamp: pointTime.toISOString(),
      price: round(price, 2)
    });
    barHistory.push({
      timestamp: pointTime.toISOString(),
      open: round(open, 2),
      high: round(high, 2),
      low: round(low, 2),
      close: round(price, 2),
      volume
    });
  }

  return buildSeriesPayload(
    priceHistory,
    sentimentHistory,
    WINDOWS.find((window) => window.key === "1d")?.label || "1 Day",
    barHistory
  );
}

function buildSeriesPayload(priceHistory, sentimentHistory, baselineWindow, barHistory = []) {
  const firstPrice = priceHistory[0]?.price || 0;
  const lastPrice = priceHistory.at(-1)?.price || firstPrice;
  const intradayHigh = priceHistory.length ? Math.max(...priceHistory.map((point) => point.price)) : lastPrice;
  const intradayLow = priceHistory.length ? Math.min(...priceHistory.map((point) => point.price)) : lastPrice;
  const denominator = firstPrice || 1;

  return {
    price_history: priceHistory,
    sentiment_history: sentimentHistory,
    bar_history: barHistory,
    market_snapshot: {
      current_price: round(lastPrice, 2),
      absolute_change: round(lastPrice - firstPrice, 2),
      percent_change: round((lastPrice - firstPrice) / denominator, 4),
      intraday_high: round(intradayHigh, 2),
      intraday_low: round(intradayLow, 2),
      baseline_window: baselineWindow
    }
  };
}

function attachProvider(payload, provider, live) {
  return {
    ...payload,
    market_snapshot: {
      ...payload.market_snapshot,
      provider,
      live: Boolean(live)
    }
  };
}

async function fetchTwelveDataSeries(config, ticker, quotaManager = null) {
  const params = new URLSearchParams({
    symbol: ticker,
    interval: config.marketDataInterval,
    outputsize: String(config.marketDataHistoryPoints),
    order: "asc",
    format: "JSON",
    timezone: "UTC",
    apikey: config.twelveDataApiKey
  });
  const request = withTimeout(config.marketDataRequestTimeoutMs);

  try {
    const run = async () => {
      const response = await fetch(`https://api.twelvedata.com/time_series?${params.toString()}`, {
        signal: request.signal,
        headers: {
          "User-Agent": "SentimentAnalyst/1.0 (+market data)"
        }
      });

      if (!response.ok) {
        throw new Error(`Twelve Data request failed with ${response.status}`);
      }

      const payload = await response.json();
      if (payload.status === "error") {
        throw new Error(payload.message || "Twelve Data returned an error");
      }

      if (!Array.isArray(payload.values) || !payload.values.length) {
        throw new Error("Twelve Data returned no price history");
      }

      return payload;
    };
    return quotaManager ? quotaManager.run("twelvedata", run) : run();
  } finally {
    request.clear();
  }
}

async function fetchAlpacaSeries(config, ticker) {
  const lookbackDays = intervalLookbackDays(config.marketDataInterval, config.marketDataHistoryPoints);
  const params = new URLSearchParams({
    timeframe: normalizeAlpacaTimeframe(config.marketDataInterval),
    start: isoDaysAgo(lookbackDays),
    end: new Date().toISOString(),
    limit: String(config.marketDataHistoryPoints),
    adjustment: "raw",
    sort: "desc",
    feed: config.alpacaMarketDataFeed || "iex"
  });
  const request = withTimeout(config.marketDataRequestTimeoutMs);
  const base = trimTrailingSlash(config.alpacaMarketDataBaseUrl || "https://data.alpaca.markets");

  try {
    const response = await fetch(`${base}/v2/stocks/${encodeURIComponent(ticker)}/bars?${params.toString()}`, {
      signal: request.signal,
      headers: alpacaHeaders(config)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Alpaca bars request failed with ${response.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload.bars) || !payload.bars.length) {
      throw new Error("Alpaca returned no price bars");
    }

    return payload;
  } finally {
    request.clear();
  }
}

async function fetchMassiveSeries(config, ticker, quotaManager = null) {
  const lookbackDays = intervalLookbackDays(config.marketDataInterval, config.marketDataHistoryPoints);
  const { multiplier, timespan } = massiveRangeSpec(config.marketDataInterval);
  const from = isoDateDaysAgo(lookbackDays);
  const to = new Date().toISOString().slice(0, 10);
  const apiKey = config.massiveApiKey || config.polygonApiKey;
  const base = trimTrailingSlash(config.massiveBaseUrl || config.massiveCompatBaseUrl || "https://api.massive.com");
  const params = new URLSearchParams({
    adjusted: "true",
    sort: "asc",
    limit: String(config.marketDataHistoryPoints || 18),
    apiKey
  });
  const request = withTimeout(config.marketDataRequestTimeoutMs);

  try {
    const run = async () => {
      const response = await fetch(`${base}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${multiplier}/${timespan}/${from}/${to}?${params.toString()}`, {
        signal: request.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "SentimentAnalyst/1.0 (+massive market data)"
        }
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Massive aggregates request failed with ${response.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
      }
      const payload = await response.json();
      if (!Array.isArray(payload.results) || !payload.results.length) {
        throw new Error("Massive returned no aggregate bars");
      }
      return payload;
    };
    return quotaManager ? quotaManager.run("massive", run) : run();
  } finally {
    request.clear();
  }
}

function mapTwelveDataSeries(payload, scoredDocs) {
  const values = payload.values.map((point) => ({
    timestamp: parseSeriesTimestamp(point.datetime),
    open: Number(point.open),
    high: Number(point.high),
    low: Number(point.low),
    close: Number(point.close),
    volume: Number(point.volume || 0)
  }));

  const sentimentHistory = values.map((point) => {
    const signal = buildSeriesSignal(scoredDocs, new Date(point.timestamp));
    return {
      timestamp: point.timestamp,
      sentiment: round(signal.sentiment, 4),
      confidence: round(signal.confidence, 4)
    };
  });

  const priceHistory = values.map((point) => ({
    timestamp: point.timestamp,
    price: round(point.close, 2)
  }));

  const baselineWindow = WINDOWS.find((window) => window.key === "1d")?.label || payload.meta?.interval || "1 Day";
  return buildSeriesPayload(priceHistory, sentimentHistory, baselineWindow, values.map((point) => ({
    timestamp: point.timestamp,
    open: round(point.open, 2),
    high: round(point.high, 2),
    low: round(point.low, 2),
    close: round(point.close, 2),
    volume: Math.round(point.volume || 0)
  })));
}

function mapAlpacaSeries(payload, scoredDocs, config) {
  const bars = [...payload.bars].sort((a, b) => new Date(a.t) - new Date(b.t));
  const values = bars.map((point) => ({
    timestamp: parseSeriesTimestamp(point.t),
    open: Number(point.o),
    high: Number(point.h),
    low: Number(point.l),
    close: Number(point.c),
    volume: Number(point.v || 0)
  }));

  const sentimentHistory = values.map((point) => {
    const signal = buildSeriesSignal(scoredDocs, new Date(point.timestamp));
    return {
      timestamp: point.timestamp,
      sentiment: round(signal.sentiment, 4),
      confidence: round(signal.confidence, 4)
    };
  });

  const priceHistory = values.map((point) => ({
    timestamp: point.timestamp,
    price: round(point.close, 2)
  }));

  const baselineWindow = WINDOWS.find((window) => window.key === "1d")?.label || normalizeAlpacaTimeframe(config.marketDataInterval);
  return buildSeriesPayload(priceHistory, sentimentHistory, baselineWindow, values.map((point) => ({
    timestamp: point.timestamp,
    open: round(point.open, 2),
    high: round(point.high, 2),
    low: round(point.low, 2),
    close: round(point.close, 2),
    volume: Math.round(point.volume || 0)
  })));
}

function mapMassiveSeries(payload, scoredDocs, config) {
  const values = [...(payload.results || [])].map((point) => ({
    timestamp: parseSeriesTimestamp(point.t),
    open: Number(point.o),
    high: Number(point.h),
    low: Number(point.l),
    close: Number(point.c),
    volume: Number(point.v || 0)
  }));

  const sentimentHistory = values.map((point) => {
    const signal = buildSeriesSignal(scoredDocs, new Date(point.timestamp));
    return {
      timestamp: point.timestamp,
      sentiment: round(signal.sentiment, 4),
      confidence: round(signal.confidence, 4)
    };
  });

  const priceHistory = values.map((point) => ({
    timestamp: point.timestamp,
    price: round(point.close, 2)
  }));

  const baselineWindow = WINDOWS.find((window) => window.key === "1d")?.label || `${massiveRangeSpec(config.marketDataInterval).timespan} bars`;
  return buildSeriesPayload(priceHistory, sentimentHistory, baselineWindow, values.map((point) => ({
    timestamp: point.timestamp,
    open: round(point.open, 2),
    high: round(point.high, 2),
    low: round(point.low, 2),
    close: round(point.close, 2),
    volume: Math.round(point.volume || 0)
  })));
}

function mapGenericBarSeries(bars, scoredDocs) {
  const values = [...bars]
    .filter((point) => point?.timestamp && Number.isFinite(Number(point.close)))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .map((point) => ({
      timestamp: parseSeriesTimestamp(point.timestamp),
      open: Number(point.open ?? point.close),
      high: Number(point.high ?? point.close),
      low: Number(point.low ?? point.close),
      close: Number(point.close),
      volume: Number(point.volume || 0)
    }));

  if (!values.length) {
    throw new Error("Provider returned no normalized bars");
  }

  const sentimentHistory = values.map((point) => {
    const signal = buildSeriesSignal(scoredDocs, new Date(point.timestamp));
    return {
      timestamp: point.timestamp,
      sentiment: round(signal.sentiment, 4),
      confidence: round(signal.confidence, 4)
    };
  });

  const priceHistory = values.map((point) => ({
    timestamp: point.timestamp,
    price: round(point.close, 2)
  }));

  return buildSeriesPayload(priceHistory, sentimentHistory, WINDOWS.find((window) => window.key === "1d")?.label || "1 Day", values.map((point) => ({
    timestamp: point.timestamp,
    open: round(point.open, 2),
    high: round(point.high, 2),
    low: round(point.low, 2),
    close: round(point.close, 2),
    volume: Math.round(point.volume || 0)
  })));
}

export function createMarketDataService({ config, store, providerQuota = null }) {
  const cache = new Map();
  const providerCooldowns = new Map();
  let timer = null;
  let running = false;

  function updateHealthFromCache(options = {}) {
    const health = marketHealth(store, config);
    const providerStatus = liveMarketDataStatus(config, config.marketDataProvider);
    health.cache_entries = cache.size;
    health.provider = config.marketDataProvider;
    health.enabled = config.marketDataProvider !== "synthetic";
    health.configured = providerStatus.configured;
    health.provider_chain = providerStatus.provider_chain;
    if (options.activeProvider !== undefined) {
      health.active_provider = options.activeProvider;
    }
    if (options.failedProviders !== undefined) {
      health.failed_providers = options.failedProviders;
    }
    health.provider_cooldowns = providerCooldownSnapshot(providerCooldowns);
    health.feed = providerStatus.feed;
    if (options.fallbackActive !== undefined) {
      health.fallback_active = Boolean(options.fallbackActive);
    }
    health.fallback_mode = providerStatus.fallback_mode || Boolean(health.fallback_active);
    health.missing_config_reason = providerStatus.configured ? null : providerStatus.missing_config_reason;
    health.decision_status = health.fallback_mode ? "fallback" : "live";
    return health;
  }

  function cooldown(provider) {
    const item = providerCooldowns.get(provider);
    if (!item) {
      return null;
    }
    if (Number(item.until || 0) <= Date.now()) {
      providerCooldowns.delete(provider);
      return null;
    }
    return item;
  }

  function rememberCooldown(provider, error) {
    const cooldownMs = marketProviderCooldownMs(error);
    if (!cooldownMs) {
      return;
    }
    providerCooldowns.set(provider, {
      until: Date.now() + cooldownMs,
      reason: error.message
    });
  }

  async function fetchProviderSeries(provider, ticker, scoredDocs) {
    const rawPayload =
      provider === "alpaca"
        ? await fetchAlpacaSeries(config, ticker)
        : provider === "massive"
          ? await fetchMassiveSeries(config, ticker, providerQuota)
        : provider === "twelvedata"
          ? await fetchTwelveDataSeries(config, ticker, providerQuota)
          : await fetchResearchProviderBars(provider, config, ticker, providerQuota, {
              interval: config.marketDataInterval,
              points: config.marketDataHistoryPoints,
              timeoutMs: config.marketDataRequestTimeoutMs
            });
    const payload =
      provider === "alpaca"
        ? mapAlpacaSeries(rawPayload, scoredDocs, config)
        : provider === "massive"
          ? mapMassiveSeries(rawPayload, scoredDocs, config)
        : provider === "twelvedata"
          ? mapTwelveDataSeries(rawPayload, scoredDocs)
          : mapGenericBarSeries(rawPayload, scoredDocs);
    return attachProvider(payload, provider, true);
  }

  async function getTickerSeries(ticker, scoredDocs, asOf, options = {}) {
    const health = updateHealthFromCache();
    const providerChain = liveMarketProviderChain(config, config.marketDataProvider);
    const liveProviders = providerChain.filter((provider) => provider !== "synthetic");
    const cacheKey = `${ticker}:${providerChain.join(">")}:${config.marketDataInterval}:${config.marketDataHistoryPoints}`;
    const cached = cache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.fetchedAt <= config.marketDataCacheMs) {
      return cached.payload;
    }

    if (config.apiSaverMode && !options.allowLive) {
      const tickerEntry = lookupUniverseEntry(store.fundamentals?.leaderboard || [], ticker);
      const payload = attachProvider(
        buildSyntheticTickerMarketSeries(ticker, scoredDocs, asOf, config.marketDataHistoryPoints, tickerEntry),
        "synthetic",
        false
      );
      cache.set(cacheKey, { fetchedAt: now, payload });
      updateHealthFromCache({ activeProvider: "synthetic", fallbackActive: true, failedProviders: [] });
      return payload;
    }

    if (!liveProviders.length) {
      const tickerEntry = lookupUniverseEntry(store.fundamentals?.leaderboard || [], ticker);
      const payload = attachProvider(
        buildSyntheticTickerMarketSeries(ticker, scoredDocs, asOf, config.marketDataHistoryPoints, tickerEntry),
        "synthetic",
        false
      );
      cache.set(cacheKey, { fetchedAt: now, payload });
      updateHealthFromCache({ activeProvider: "synthetic", fallbackActive: true, failedProviders: [] });
      return payload;
    }

    health.polling = true;
    health.last_poll_at = new Date().toISOString();

    const failures = [];
    try {
      for (const provider of liveProviders) {
        const cooldownState = cooldown(provider);
        if (cooldownState) {
          failures.push({ provider, error: `cooling down after ${cooldownState.reason}` });
          continue;
        }
        try {
          const payload = await fetchProviderSeries(provider, ticker, scoredDocs);
          providerCooldowns.delete(provider);
          cache.set(cacheKey, { fetchedAt: now, payload });
          health.last_success_at = new Date().toISOString();
          health.last_error = failures.length
            ? `Provider failover used ${provider}; earlier failures: ${failures.map((item) => `${item.provider}: ${item.error}`).join("; ")}`
            : null;
          updateHealthFromCache({ activeProvider: provider, fallbackActive: false, failedProviders: failures });
          return payload;
        } catch (error) {
          rememberCooldown(provider, error);
          failures.push({ provider, error: error.message });
        }
      }

      health.last_error = `All live market-data providers failed: ${failures.map((item) => `${item.provider}: ${item.error}`).join("; ")}`;
      const tickerEntry = lookupUniverseEntry(store.fundamentals?.leaderboard || [], ticker);
      const fallback = attachProvider(
        buildSyntheticTickerMarketSeries(ticker, scoredDocs, asOf, config.marketDataHistoryPoints, tickerEntry),
        "synthetic",
        false
      );
      cache.set(cacheKey, { fetchedAt: now, payload: fallback });
      updateHealthFromCache({ activeProvider: "synthetic", fallbackActive: true, failedProviders: failures });
      return fallback;
    } finally {
      health.polling = false;
    }
  }

  function scheduleTicks() {
    if (!running) {
      return;
    }

    timer = setTimeout(() => {
      store.bus.emit("event", {
        type: "market_tick",
        timestamp: new Date().toISOString(),
        provider: config.marketDataProvider
      });
      scheduleTicks();
    }, config.marketDataRefreshMs);
  }

  return {
    async getTickerSeries(ticker, scoredDocs, asOf, options = {}) {
      return getTickerSeries(ticker, scoredDocs, asOf, options);
    },
    async start() {
      running = true;
      updateHealthFromCache();
      scheduleTicks();
    },
    stop() {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      updateHealthFromCache().polling = false;
    }
  };
}
