import {
  hasAlphaVantageAccess,
  hasFinnhubAccess,
  hasFmpAccess,
  researchProviderMissingConfigReason
} from "./research-providers.js";

export function hasTwelveDataAccess(config) {
  return Boolean(config?.twelveDataApiKey);
}

export function hasAlpacaMarketDataAccess(config) {
  return Boolean(
    config?.alpacaMarketDataEnabled &&
      config?.alpacaMarketDataApiKeyId &&
      config?.alpacaMarketDataApiSecretKey
  );
}

export function hasMassiveAccess(config) {
  return Boolean(config?.massiveApiKey || config?.polygonApiKey);
}

export function isLiveMarketProviderConfigured(config, provider = config?.marketDataProvider) {
  if (provider === "massive") {
    return hasMassiveAccess(config);
  }
  if (provider === "twelvedata") {
    return hasTwelveDataAccess(config);
  }
  if (provider === "alpaca") {
    return hasAlpacaMarketDataAccess(config);
  }
  if (provider === "finnhub") {
    return hasFinnhubAccess(config);
  }
  if (provider === "fmp") {
    return hasFmpAccess(config);
  }
  if (provider === "alphavantage") {
    return hasAlphaVantageAccess(config);
  }
  return provider === "synthetic";
}

export function liveMarketProviderChain(config, preferred = config?.marketDataProvider, options = {}) {
  const includeSynthetic = options.includeSynthetic !== false;
  const includeFmp = Boolean(options.includeFmp);
  const providers = [];
  const add = (provider) => {
    if (!provider || providers.includes(provider)) {
      return;
    }
    if (provider === "synthetic") {
      if (includeSynthetic) {
        providers.push(provider);
      }
      return;
    }
    if (isLiveMarketProviderConfigured(config, provider)) {
      providers.push(provider);
    }
  };

  if (preferred === "synthetic") {
    add("synthetic");
    return providers;
  }

  add(preferred);
  add("massive");
  add("alpaca");
  add("finnhub");
  if (includeFmp) {
    add("fmp");
  }
  add("twelvedata");
  add("alphavantage");
  add("synthetic");
  return providers;
}

export function fundamentalReferenceProviderChain(config, preferred = config?.fundamentalMarketDataProvider, options = {}) {
  return liveMarketProviderChain(config, preferred, { ...options, includeFmp: true });
}

export function hasConfiguredLiveMarketProvider(config, preferred = config?.marketDataProvider) {
  return liveMarketProviderChain(config, preferred, { includeSynthetic: false }).length > 0;
}

export function marketProviderMissingConfigReason(provider, purpose = "live market data") {
  if (provider !== "synthetic" && !provider) {
    return `${purpose} needs MARKET_DATA_PROVIDER=massive, alpaca, finnhub, fmp, twelvedata, alphavantage, or synthetic plus matching credentials.`;
  }
  if (provider === "massive") {
    return `${purpose} needs MASSIVE_API_KEY or POLYGON_API_KEY.`;
  }
  if (provider === "alpaca") {
    return `${purpose} needs Alpaca market data credentials. Set ALPACA_API_KEY/ALPACA_SECRET_KEY or ALPACA_API_KEY_ID/ALPACA_API_SECRET_KEY.`;
  }
  if (["finnhub", "fmp", "alphavantage"].includes(provider)) {
    return researchProviderMissingConfigReason(provider, purpose);
  }
  if (provider === "twelvedata") {
    return `${purpose} needs TWELVE_DATA_API_KEY.`;
  }
  return null;
}

export function liveMarketDataStatus(config, provider = config?.marketDataProvider) {
  const providerChain = liveMarketProviderChain(config, provider);
  const liveProviders = providerChain.filter((item) => item !== "synthetic");
  const configured = provider === "synthetic" ? true : liveProviders.length > 0;
  return {
    provider,
    configured,
    provider_chain: providerChain,
    fallback_mode: provider === "synthetic" || !liveProviders.length,
    feed:
      provider === "massive"
        ? "stocks_rest"
        : provider === "alpaca"
        ? config?.alpacaMarketDataFeed || "iex"
        : provider === "finnhub"
          ? "stock_candle"
          : provider === "fmp"
            ? "stable"
            : provider === "alphavantage"
              ? config?.marketDataInterval || "15min"
        : provider === "twelvedata"
          ? config?.marketDataInterval || null
          : null,
    missing_config_reason: configured ? null : marketProviderMissingConfigReason(provider)
  };
}

export function alpacaHeaders(config) {
  return {
    "APCA-API-KEY-ID": config.alpacaMarketDataApiKeyId,
    "APCA-API-SECRET-KEY": config.alpacaMarketDataApiSecretKey,
    Accept: "application/json",
    "User-Agent": "SentimentAnalyst/1.0 (+alpaca market data)"
  };
}

export function normalizeAlpacaTimeframe(interval = "15min") {
  const normalized = String(interval || "15min").trim().toLowerCase();
  const match = normalized.match(/^(\d+)\s*(min|m|minute|minutes|h|hr|hour|hours|d|day|days)$/);
  if (!match) {
    return "15Min";
  }

  const value = Math.max(1, Number(match[1] || 1));
  const unit = match[2];
  if (["min", "m", "minute", "minutes"].includes(unit)) {
    return `${value}Min`;
  }
  if (["h", "hr", "hour", "hours"].includes(unit)) {
    return `${value}Hour`;
  }
  return `${value}Day`;
}

export function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

export function marketProviderCooldownMs(error) {
  const message = String(error?.message || error || "").toLowerCase();
  const status = Number(error?.status || 0);
  if (status === 429 || /\b429\b|rate.?limit|too many requests/.test(message)) {
    return 15 * 60_000;
  }
  if (/api credits|daily limit|quota|run out of api|credit limit|usage limit|exceeded/.test(message)) {
    return 6 * 60 * 60_000;
  }
  return 0;
}

export function providerCooldownSnapshot(cooldowns = new Map()) {
  const now = Date.now();
  return [...cooldowns.entries()]
    .filter(([, item]) => Number(item?.until || 0) > now)
    .map(([provider, item]) => ({
      provider,
      seconds_remaining: Math.max(0, Math.ceil((Number(item.until) - now) / 1000)),
      reason: item.reason || null
    }));
}
