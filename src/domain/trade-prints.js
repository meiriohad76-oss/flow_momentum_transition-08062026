import { getTrackedUniverseEntries, rotateUniverseEntries } from "./tracked-universe.js";

const POLYGON_BASE = "https://api.polygon.io";
const IEX_BASE = "https://cloud.iexapis.com/stable/stock";

function dateSlot() {
  return new Date().toISOString().slice(0, 10);
}

function buildSeenKey(ticker) {
  return `trade_print:${ticker}:${dateSlot()}`;
}

function normalizeTradeTimestamp(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "string" && Number.isNaN(Number(value))) {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  if (numeric > 1e15) {
    return new Date(numeric / 1_000_000).toISOString();
  }
  if (numeric > 1e12) {
    return new Date(numeric).toISOString();
  }
  return new Date(numeric * 1000).toISOString();
}

async function fetchMassiveCompatibleTrades(ticker, apiKey, timeoutMs, quotaManager = null, options = {}) {
  const provider = options.provider || "massive";
  const base = String(options.baseUrl || POLYGON_BASE).replace(/\/+$/, "");
  const url = `${base}/v3/trades/${encodeURIComponent(ticker)}?limit=50&sort=timestamp&order=desc&apiKey=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const run = async () => {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "SentimentAnalyst/1.0 (+trade-prints)" }
      });
      if (!response.ok) throw new Error(`${provider} trades ${response.status}`);
      return response.json();
    };
    const json = quotaManager ? await quotaManager.run(provider, run) : await run();
    return (json?.results ?? []).map((t) => ({
      price: t.price,
      size: t.size,
      timestamp: normalizeTradeTimestamp(t.sip_timestamp || t.participant_timestamp || t.trf_timestamp || t.timestamp)
    }));
  } finally {
    clearTimeout(timer);
  }
}

async function fetchIexTrades(ticker, apiKey, timeoutMs) {
  const url = `${IEX_BASE}/${encodeURIComponent(ticker)}/trades?token=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "SentimentAnalyst/1.0 (+trade-prints)" }
    });
    if (!response.ok) throw new Error(`IEX trades ${response.status}`);
    const json = await response.json();
    return (Array.isArray(json) ? json : []).map((t) => ({
      price: t.price,
      size: t.size,
      timestamp: normalizeTradeTimestamp(t.tradeTime || t.timestamp || t.time || t.date)
    }));
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTrades(ticker, config, quotaManager = null) {
  if (config.tradePrintsProvider === "iex") {
    return fetchIexTrades(ticker, config.tradePrintsApiKey, config.tradePrintsRequestTimeoutMs);
  }
  const provider = config.tradePrintsProvider === "polygon" ? "polygon" : "massive";
  const baseUrl = provider === "polygon"
    ? config.massiveCompatBaseUrl || "https://api.polygon.io"
    : config.massiveBaseUrl || "https://api.massive.com";
  return fetchMassiveCompatibleTrades(ticker, config.tradePrintsApiKey, config.tradePrintsRequestTimeoutMs, quotaManager, {
    provider,
    baseUrl
  });
}

function classifyTrades(trades, basePrice, minNotionalUsd) {
  let buyNotional = 0;
  let sellNotional = 0;
  let blockCount = 0;
  let latestTimestamp = null;
  const referencePrice =
    Number(basePrice) > 0
      ? Number(basePrice)
      : trades.reduce((sum, trade) => sum + Number(trade.price || 0), 0) / Math.max(1, trades.length);

  for (const trade of trades) {
    const notional = trade.price * trade.size;
    if (notional < minNotionalUsd) continue;
    blockCount += 1;
    if (trade.timestamp && (!latestTimestamp || new Date(trade.timestamp) > new Date(latestTimestamp))) {
      latestTimestamp = trade.timestamp;
    }
    if (trade.price >= referencePrice) {
      buyNotional += notional;
    } else {
      sellNotional += notional;
    }
  }

  return { buyNotional, sellNotional, blockCount, latestTimestamp, referencePrice };
}

function buildRawDocument(entry, action, buyNotional, sellNotional, blockCount, provider, latestTimestamp, referencePrice) {
  const isBuy = action === "block_trade_buying";
  const dominantNotional = isBuy ? buyNotional : sellNotional;
  const usd = (dominantNotional / 1e6).toFixed(1);
  const sourceName = provider === "iex" ? "iex_trades" : provider === "massive" ? "massive_trades" : "polygon_trades";
  const observedAt = latestTimestamp || new Date().toISOString();
  return {
    source_name: sourceName,
    source_type: "api",
    source_priority: provider === "iex" ? 0.75 : 0.81,
    canonical_url: `https://finance.yahoo.com/quote/${entry.ticker}`,
    url: `https://finance.yahoo.com/quote/${entry.ticker}`,
    title: `${entry.ticker} ${isBuy ? "large block buying" : "large block selling"} - $${usd}M notional (${blockCount} prints)`,
    body: `${isBuy ? "Large block buying" : "Large block selling"} detected in ${entry.ticker}. ${blockCount} delayed trade print${blockCount === 1 ? "" : "s"} crossed the configured block threshold with $${usd}M dominant notional flow. Direction is inferred from print price versus a reference price, not full order-book aggressor data.`,
    language: "en",
    published_at: observedAt,
    fetched_at: new Date().toISOString(),
    source_metadata: {
      ticker_hint: entry.ticker,
      sector_hint: entry.sector,
      collector: `${provider}_trade_prints`,
      action,
      observation_level: "delayed_trade_prints",
      verification_status: "direct_trade_prints_delayed",
      classification_method: "print_price_vs_reference_price",
      reliability_warning: "Trade-print direction is inferred without full order-book aggressor context.",
      reference_price: referencePrice,
      block_count: blockCount,
      buy_notional_usd: buyNotional,
      sell_notional_usd: sellNotional
    },
    raw_payload: { buyNotional, sellNotional, blockCount, latestTimestamp, referencePrice }
  };
}

export function createTradePrintsCollector(app) {
  const { config, pipeline, store, providerQuota = null } = app;
  const healthKey = `${config.tradePrintsProvider}_trade_prints`;
  let timer = null;
  let running = false;
  let inFlight = false;
  let cursor = 0;

  function isEnabled() {
    return Boolean(config.tradePrintsEnabled || config.autonomousDataEnabled);
  }

  function ensureHealthEntry() {
    if (!store.health.liveSources[healthKey]) {
      store.health.liveSources[healthKey] = {
        enabled: isEnabled(),
        polling: false,
        last_poll_at: null,
        last_success_at: null,
        last_error: null,
        polls: 0,
        consecutive_failures: 0,
        ingested_documents: 0,
        universe_symbols: 0,
        last_batch_size: 0
      };
    }
    store.health.liveSources[healthKey].enabled = isEnabled();
    return store.health.liveSources[healthKey];
  }

  async function pollOnce() {
    if (!isEnabled() || inFlight) return { ingested: 0, skipped: 0 };
    if (!config.tradePrintsApiKey) {
      const health = ensureHealthEntry();
      health.last_poll_at = new Date().toISOString();
      health.last_error = "no API key configured";
      return { ingested: 0, skipped: 0, error: health.last_error };
    }

    inFlight = true;
    const health = ensureHealthEntry();
    health.polling = true;
    health.last_poll_at = new Date().toISOString();
    health.polls += 1;

    let ingested = 0;
    let skipped = 0;
    let errors = 0;

    try {
      const fullUniverse = getTrackedUniverseEntries(app, { excludeFunds: true });
      const latestFinalSelection = store.finalSelectionHistory?.[0]?.candidates || [];
      const finalistTickers = new Set(
        latestFinalSelection
          .filter((candidate) => candidate.execution_allowed || ["long", "short", "review"].includes(candidate.final_action))
          .map((candidate) => candidate.ticker)
      );
      const scopedUniverse =
        config.tradePrintsScope === "finalists" && finalistTickers.size
          ? fullUniverse.filter((entry) => finalistTickers.has(entry.ticker))
          : fullUniverse;
      const universe = scopedUniverse.length ? scopedUniverse : fullUniverse;
      const maxTickers = Math.max(0, Math.floor(Number(config.tradePrintsMaxTickersPerPoll || 0)));
      const rotated = maxTickers && maxTickers < universe.length
        ? rotateUniverseEntries(universe, cursor, maxTickers)
        : { selected: universe, nextCursor: 0 };
      cursor = rotated.nextCursor;
      const batch = rotated.selected;
      health.universe_symbols = universe.length;
      health.last_batch_size = batch.length;

      for (const entry of batch) {
        const seenKey = buildSeenKey(entry.ticker);
        if (store.seenExternalDocuments.has(seenKey)) {
          skipped += 1;
          continue;
        }

        let trades;
        try {
          trades = await fetchTrades(entry.ticker, config, providerQuota);
        } catch {
          errors += 1;
          continue;
        }

        const { buyNotional, sellNotional, blockCount, latestTimestamp, referencePrice } = classifyTrades(trades, entry.base_price, config.tradePrintsBlockTradeMinNotionalUsd);
        if (blockCount === 0) {
          skipped += 1;
          continue;
        }

        const action = buyNotional >= sellNotional ? "block_trade_buying" : "block_trade_selling";
        store.seenExternalDocuments.add(seenKey);
        await pipeline.processRawDocument(buildRawDocument(entry, action, buyNotional, sellNotional, blockCount, config.tradePrintsProvider, latestTimestamp, referencePrice));
        ingested += 1;

        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      health.ingested_documents += ingested;
      if (ingested > 0 || errors < batch.length) health.last_success_at = new Date().toISOString();
      health.last_error = errors > 0 ? `${errors} tickers failed` : null;
      health.consecutive_failures = batch.length && errors === batch.length ? health.consecutive_failures + 1 : 0;
      return { ingested, skipped, errors };
    } finally {
      health.polling = false;
      inFlight = false;
    }
  }

  function scheduleNext() {
    if (!running || !isEnabled()) return;
    timer = setTimeout(async () => {
      await pollOnce();
      scheduleNext();
    }, config.tradePrintsPollMs);
  }

  return {
    async start() {
      ensureHealthEntry();
      if (running || !isEnabled()) return;
      running = true;
      await pollOnce();
      scheduleNext();
    },
    stop() {
      running = false;
      if (timer) { clearTimeout(timer); timer = null; }
      ensureHealthEntry().polling = false;
    },
    async pollOnce() {
      ensureHealthEntry();
      return pollOnce();
    }
  };
}
