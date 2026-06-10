import os from "node:os";
import {
  hasConfiguredLiveMarketProvider,
  hasAlpacaMarketDataAccess,
  marketProviderMissingConfigReason
} from "./market-providers.js";
import { hasAlphaVantageAccess, hasFinnhubAccess, hasFmpAccess } from "./research-providers.js";
import { differenceInHours, round } from "../utils/helpers.js";

const HOUR_MS = 3_600_000;

export const RUNTIME_PROFILES = {
  api_saver_testing: {
    label: "API Saver Testing",
    description: "Manual-only testing mode. Keeps real providers configured, but stops background API polling so credits are spent only when a user clicks a refresh/test action.",
    env: {
      API_SAVER_MODE: "true",
      PI_PERFORMANCE_MODE: "true",
      DATABASE_ENABLED: "false",
      LIGHTWEIGHT_STATE_ENABLED: "true",
      SQLITE_BACKUP_ENABLED: "false",
      SQLITE_BACKUP_ON_STARTUP: "false",
      AGENCY_AUTONOMOUS_DATA_ENABLED: "false",
      LIVE_NEWS_ENABLED: "true",
      AUTO_START_LIVE_NEWS: "false",
      LIVE_NEWS_POLL_MS: "3600000",
      LIVE_NEWS_MAX_ITEMS_PER_TICKER: "1",
      LIVE_NEWS_UNIVERSE_MODE: "full",
      LIVE_NEWS_RSS_FALLBACK_MAX_TICKERS: "3",
      LIVE_NEWS_API_FALLBACK_MAX_TICKERS: "2",
      MARKETAUX_ENABLED: "false",
      MARKETAUX_SYMBOLS_PER_REQUEST: "2",
      MARKETAUX_MAX_REQUESTS_PER_POLL: "1",
      MARKETAUX_LIMIT_PER_REQUEST: "2",
      MARKET_DATA_REFRESH_MS: "900000",
      MARKET_FLOW_ENABLED: "true",
      AUTO_START_MARKET_FLOW: "false",
      MARKET_FLOW_POLL_MS: "3600000",
      MARKET_FLOW_MAX_TICKERS_PER_POLL: "3",
      EARNINGS_ENABLED: "false",
      EARNINGS_MAX_TICKERS_PER_POLL: "3",
      EARNINGS_POLL_MS: "14400000",
      STOCKTWITS_ENABLED: "false",
      STOCKTWITS_POLL_MS: "3600000",
      STOCKTWITS_MAX_TICKERS_PER_POLL: "3",
      TRADE_PRINTS_ENABLED: "false",
      TRADE_PRINTS_POLL_MS: "3600000",
      TRADE_PRINTS_MAX_TICKERS_PER_POLL: "3",
      AUTO_START_SECTOR_ETF_PROXIES: "false",
      AUTO_START_FUNDAMENTAL_MARKET_DATA: "false",
      FUNDAMENTAL_MARKET_DATA_REFRESH_MS: "3600000",
      FUNDAMENTAL_MARKET_DATA_MAX_COMPANIES_PER_POLL: "4",
      FUNDAMENTAL_SEC_ENABLED: "true",
      AUTO_START_SEC_FUNDAMENTALS: "false",
      FUNDAMENTAL_SEC_BASELINE_POLL_MS: "3600000",
      FUNDAMENTAL_SEC_CONCURRENCY: "1",
      FUNDAMENTAL_SEC_MAX_COMPANIES_PER_POLL: "2",
      SEC_FORM4_ENABLED: "true",
      AUTO_START_SEC_FORM4: "false",
      SEC_FORM4_POLL_MS: "3600000",
      SEC_FORM4_MAX_TICKERS_PER_POLL: "3",
      SEC_13F_ENABLED: "true",
      AUTO_START_SEC_13F: "false",
      SEC_REQUEST_RETRIES: "0"
    }
  },
  emergency: {
    label: "Emergency",
    description: "Lowest-load mode for recovering the Pi. Keeps the dashboard and allowed universe online without live collectors or SQLite writes.",
    env: {
      PI_PERFORMANCE_MODE: "true",
      DATABASE_ENABLED: "false",
      LIGHTWEIGHT_STATE_ENABLED: "true",
      SQLITE_BACKUP_ENABLED: "false",
      SQLITE_BACKUP_ON_STARTUP: "false",
      AGENCY_AUTONOMOUS_DATA_ENABLED: "false",
      LIVE_NEWS_ENABLED: "false",
      AUTO_START_LIVE_NEWS: "false",
      MARKETAUX_ENABLED: "false",
      MARKET_DATA_PROVIDER: "synthetic",
      ALPACA_MARKET_DATA_ENABLED: "false",
      MARKET_FLOW_ENABLED: "false",
      AUTO_START_MARKET_FLOW: "false",
      EARNINGS_ENABLED: "false",
      STOCKTWITS_ENABLED: "false",
      TRADE_PRINTS_ENABLED: "false",
      FUNDAMENTAL_MARKET_DATA_PROVIDER: "synthetic",
      AUTO_START_SECTOR_ETF_PROXIES: "false",
      AUTO_START_FUNDAMENTAL_MARKET_DATA: "false",
      FUNDAMENTAL_SEC_ENABLED: "false",
      AUTO_START_SEC_FUNDAMENTALS: "false",
      SEC_FORM4_ENABLED: "false",
      AUTO_START_SEC_FORM4: "false",
      SEC_13F_ENABLED: "false",
      AUTO_START_SEC_13F: "false"
    }
  },
  live_news_only: {
    label: "Live News Only",
    description: "Safe first live-data step. Enables RSS news while keeping heavier SEC and market-flow collectors manual/off.",
    env: {
      PI_PERFORMANCE_MODE: "true",
      DATABASE_ENABLED: "false",
      LIGHTWEIGHT_STATE_ENABLED: "true",
      SQLITE_BACKUP_ENABLED: "false",
      SQLITE_BACKUP_ON_STARTUP: "false",
      AGENCY_AUTONOMOUS_DATA_ENABLED: "false",
      LIVE_NEWS_ENABLED: "true",
      AUTO_START_LIVE_NEWS: "true",
      LIVE_NEWS_POLL_MS: "900000",
      LIVE_NEWS_MAX_ITEMS_PER_TICKER: "2",
      LIVE_NEWS_UNIVERSE_MODE: "full",
      LIVE_NEWS_RSS_FALLBACK_MAX_TICKERS: "10",
      MARKETAUX_ENABLED: "false",
      MARKET_DATA_PROVIDER: "synthetic",
      ALPACA_MARKET_DATA_ENABLED: "false",
      MARKET_FLOW_ENABLED: "false",
      AUTO_START_MARKET_FLOW: "false",
      EARNINGS_ENABLED: "false",
      STOCKTWITS_ENABLED: "false",
      TRADE_PRINTS_ENABLED: "false",
      FUNDAMENTAL_MARKET_DATA_PROVIDER: "synthetic",
      AUTO_START_SECTOR_ETF_PROXIES: "false",
      AUTO_START_FUNDAMENTAL_MARKET_DATA: "false",
      FUNDAMENTAL_SEC_ENABLED: "false",
      AUTO_START_SEC_FUNDAMENTALS: "false",
      SEC_FORM4_ENABLED: "false",
      AUTO_START_SEC_FORM4: "false",
      SEC_13F_ENABLED: "false",
      AUTO_START_SEC_13F: "false"
    }
  },
  pi_light: {
    label: "Pi Light",
    description: "Balanced Pi mode. Allows news and light market refreshes while keeping expensive SEC fundamentals and 13F manual.",
    env: {
      PI_PERFORMANCE_MODE: "true",
      DATABASE_ENABLED: "false",
      LIGHTWEIGHT_STATE_ENABLED: "true",
      SQLITE_BACKUP_ENABLED: "false",
      SQLITE_BACKUP_ON_STARTUP: "false",
      AGENCY_AUTONOMOUS_DATA_ENABLED: "false",
      LIVE_NEWS_ENABLED: "true",
      AUTO_START_LIVE_NEWS: "true",
      LIVE_NEWS_POLL_MS: "900000",
      LIVE_NEWS_MAX_ITEMS_PER_TICKER: "2",
      LIVE_NEWS_UNIVERSE_MODE: "full",
      LIVE_NEWS_RSS_FALLBACK_MAX_TICKERS: "10",
      MARKETAUX_ENABLED: "false",
      MARKET_DATA_PROVIDER: "synthetic",
      ALPACA_MARKET_DATA_ENABLED: "false",
      MARKET_DATA_REFRESH_MS: "300000",
      MARKET_FLOW_ENABLED: "true",
      AUTO_START_MARKET_FLOW: "false",
      MARKET_FLOW_MAX_TICKERS_PER_POLL: "8",
      EARNINGS_ENABLED: "false",
      STOCKTWITS_ENABLED: "false",
      TRADE_PRINTS_ENABLED: "false",
      FUNDAMENTAL_MARKET_DATA_PROVIDER: "synthetic",
      AUTO_START_SECTOR_ETF_PROXIES: "false",
      AUTO_START_FUNDAMENTAL_MARKET_DATA: "false",
      FUNDAMENTAL_SEC_ENABLED: "true",
      AUTO_START_SEC_FUNDAMENTALS: "false",
      FUNDAMENTAL_SEC_CONCURRENCY: "1",
      FUNDAMENTAL_SEC_MAX_COMPANIES_PER_POLL: "8",
      SEC_FORM4_ENABLED: "true",
      AUTO_START_SEC_FORM4: "false",
      SEC_13F_ENABLED: "true",
      AUTO_START_SEC_13F: "false",
      SEC_REQUEST_RETRIES: "0"
    }
  },
  autonomous_live: {
    label: "Autonomous Live Data",
    description: "Pi-safe autonomous data mode. Starts live-data workers from available keys while keeping Alpaca order submission supervised.",
    env: {
      PI_PERFORMANCE_MODE: "false",
      DATABASE_ENABLED: "false",
      LIGHTWEIGHT_STATE_ENABLED: "true",
      SQLITE_BACKUP_ENABLED: "false",
      SQLITE_BACKUP_ON_STARTUP: "false",
      AGENCY_AUTONOMOUS_DATA_ENABLED: "true",
      LIVE_NEWS_ENABLED: "true",
      AUTO_START_LIVE_NEWS: "true",
      LIVE_NEWS_POLL_MS: "900000",
      LIVE_NEWS_MAX_ITEMS_PER_TICKER: "2",
      LIVE_NEWS_UNIVERSE_MODE: "full",
      LIVE_NEWS_RSS_FALLBACK_MAX_TICKERS: "10",
      MARKETAUX_ENABLED: "true",
      MARKETAUX_SYMBOLS_PER_REQUEST: "5",
      MARKETAUX_MAX_REQUESTS_PER_POLL: "1",
      MARKETAUX_LIMIT_PER_REQUEST: "3",
      MARKET_DATA_PROVIDER: "twelvedata",
      ALPACA_MARKET_DATA_ENABLED: "true",
      MARKET_DATA_REFRESH_MS: "900000",
      MARKET_FLOW_ENABLED: "true",
      AUTO_START_MARKET_FLOW: "true",
      MARKET_FLOW_POLL_MS: "900000",
      MARKET_FLOW_MAX_TICKERS_PER_POLL: "3",
      EARNINGS_ENABLED: "true",
      EARNINGS_PROVIDER: "yahoo",
      EARNINGS_MAX_TICKERS_PER_POLL: "9",
      EARNINGS_POLL_MS: "14400000",
      STOCKTWITS_ENABLED: "true",
      STOCKTWITS_POLL_MS: "900000",
      STOCKTWITS_MAX_TICKERS_PER_POLL: "20",
      TRADE_PRINTS_ENABLED: "false",
      TRADE_PRINTS_PROVIDER: "massive",
      TRADE_PRINTS_POLL_MS: "300000",
      TRADE_PRINTS_MAX_TICKERS_PER_POLL: "25",
      FUNDAMENTAL_MARKET_DATA_PROVIDER: "twelvedata",
      AUTO_START_SECTOR_ETF_PROXIES: "true",
      AUTO_START_FUNDAMENTAL_MARKET_DATA: "true",
      FUNDAMENTAL_MARKET_DATA_MAX_COMPANIES_PER_POLL: "4",
      FUNDAMENTAL_SEC_ENABLED: "true",
      AUTO_START_SEC_FUNDAMENTALS: "true",
      FUNDAMENTAL_SEC_CONCURRENCY: "1",
      FUNDAMENTAL_SEC_MAX_COMPANIES_PER_POLL: "8",
      SEC_FORM4_ENABLED: "true",
      AUTO_START_SEC_FORM4: "true",
      SEC_FORM4_MAX_TICKERS_PER_POLL: "25",
      SEC_13F_ENABLED: "true",
      AUTO_START_SEC_13F: "true",
      SEC_REQUEST_RETRIES: "1"
    }
  },
  alpaca_marketaux_live: {
    label: "Alpaca + Marketaux Live",
    description: "Low-budget agent-ready mode. Uses Alpaca market data for bars/flow and Marketaux for linked news while keeping paper submission supervised.",
    env: {
      PI_PERFORMANCE_MODE: "false",
      DATABASE_ENABLED: "false",
      LIGHTWEIGHT_STATE_ENABLED: "true",
      SQLITE_BACKUP_ENABLED: "false",
      SQLITE_BACKUP_ON_STARTUP: "false",
      AGENCY_AUTONOMOUS_DATA_ENABLED: "true",
      LIVE_NEWS_ENABLED: "true",
      AUTO_START_LIVE_NEWS: "true",
      LIVE_NEWS_POLL_MS: "900000",
      LIVE_NEWS_MAX_ITEMS_PER_TICKER: "2",
      LIVE_NEWS_UNIVERSE_MODE: "full",
      LIVE_NEWS_RSS_FALLBACK_MAX_TICKERS: "10",
      MARKETAUX_ENABLED: "true",
      MARKETAUX_SYMBOLS_PER_REQUEST: "5",
      MARKETAUX_MAX_REQUESTS_PER_POLL: "1",
      MARKETAUX_LIMIT_PER_REQUEST: "3",
      MARKET_DATA_PROVIDER: "alpaca",
      ALPACA_MARKET_DATA_ENABLED: "true",
      ALPACA_MARKET_DATA_FEED: "iex",
      MARKET_DATA_REFRESH_MS: "300000",
      MARKET_FLOW_ENABLED: "true",
      AUTO_START_MARKET_FLOW: "true",
      MARKET_FLOW_POLL_MS: "300000",
      MARKET_FLOW_MAX_TICKERS_PER_POLL: "25",
      EARNINGS_ENABLED: "true",
      EARNINGS_PROVIDER: "yahoo",
      EARNINGS_MAX_TICKERS_PER_POLL: "9",
      EARNINGS_POLL_MS: "14400000",
      STOCKTWITS_ENABLED: "false",
      STOCKTWITS_POLL_MS: "900000",
      STOCKTWITS_MAX_TICKERS_PER_POLL: "20",
      TRADE_PRINTS_ENABLED: "false",
      TRADE_PRINTS_PROVIDER: "massive",
      TRADE_PRINTS_POLL_MS: "300000",
      TRADE_PRINTS_MAX_TICKERS_PER_POLL: "25",
      FUNDAMENTAL_MARKET_DATA_PROVIDER: "alpaca",
      AUTO_START_SECTOR_ETF_PROXIES: "true",
      AUTO_START_FUNDAMENTAL_MARKET_DATA: "true",
      FUNDAMENTAL_MARKET_DATA_MAX_COMPANIES_PER_POLL: "12",
      FUNDAMENTAL_SEC_ENABLED: "true",
      AUTO_START_SEC_FUNDAMENTALS: "true",
      FUNDAMENTAL_SEC_CONCURRENCY: "1",
      FUNDAMENTAL_SEC_MAX_COMPANIES_PER_POLL: "8",
      SEC_FORM4_ENABLED: "true",
      AUTO_START_SEC_FORM4: "true",
      SEC_FORM4_MAX_TICKERS_PER_POLL: "25",
      SEC_13F_ENABLED: "true",
      AUTO_START_SEC_13F: "true",
      SEC_REQUEST_RETRIES: "1"
    }
  },
  full_live: {
    label: "Full Live",
    description: "Maximum live coverage. Use only after the Pi is stable or persistence/collectors are moved off-Pi.",
    env: {
      PI_PERFORMANCE_MODE: "false",
      DATABASE_ENABLED: "true",
      LIGHTWEIGHT_STATE_ENABLED: "false",
      SQLITE_BACKUP_ENABLED: "true",
      SQLITE_BACKUP_ON_STARTUP: "false",
      AGENCY_AUTONOMOUS_DATA_ENABLED: "true",
      LIVE_NEWS_ENABLED: "true",
      AUTO_START_LIVE_NEWS: "true",
      LIVE_NEWS_POLL_MS: "300000",
      LIVE_NEWS_UNIVERSE_MODE: "full",
      LIVE_NEWS_RSS_FALLBACK_MAX_TICKERS: "20",
      MARKETAUX_ENABLED: "true",
      MARKETAUX_SYMBOLS_PER_REQUEST: "5",
      MARKETAUX_MAX_REQUESTS_PER_POLL: "2",
      MARKETAUX_LIMIT_PER_REQUEST: "3",
      MARKET_DATA_PROVIDER: "twelvedata",
      ALPACA_MARKET_DATA_ENABLED: "true",
      MARKET_DATA_REFRESH_MS: "60000",
      MARKET_FLOW_ENABLED: "true",
      AUTO_START_MARKET_FLOW: "true",
      MARKET_FLOW_MAX_TICKERS_PER_POLL: "50",
      EARNINGS_ENABLED: "true",
      EARNINGS_PROVIDER: "yahoo",
      EARNINGS_MAX_TICKERS_PER_POLL: "0",
      EARNINGS_POLL_MS: "14400000",
      STOCKTWITS_ENABLED: "true",
      STOCKTWITS_POLL_MS: "300000",
      STOCKTWITS_MAX_TICKERS_PER_POLL: "50",
      TRADE_PRINTS_ENABLED: "true",
      TRADE_PRINTS_PROVIDER: "massive",
      TRADE_PRINTS_POLL_MS: "60000",
      TRADE_PRINTS_MAX_TICKERS_PER_POLL: "50",
      FUNDAMENTAL_MARKET_DATA_PROVIDER: "twelvedata",
      AUTO_START_SECTOR_ETF_PROXIES: "true",
      AUTO_START_FUNDAMENTAL_MARKET_DATA: "true",
      FUNDAMENTAL_MARKET_DATA_MAX_COMPANIES_PER_POLL: "25",
      FUNDAMENTAL_SEC_ENABLED: "true",
      AUTO_START_SEC_FUNDAMENTALS: "true",
      FUNDAMENTAL_SEC_CONCURRENCY: "2",
      FUNDAMENTAL_SEC_MAX_COMPANIES_PER_POLL: "24",
      SEC_FORM4_ENABLED: "true",
      AUTO_START_SEC_FORM4: "true",
      SEC_FORM4_MAX_TICKERS_PER_POLL: "50",
      SEC_13F_ENABLED: "true",
      AUTO_START_SEC_13F: "true",
      SEC_REQUEST_RETRIES: "1"
    }
  }
};

const PROFILE_CONFIG_READERS = {
  API_SAVER_MODE: (config) => config.apiSaverMode,
  PI_PERFORMANCE_MODE: (config) => config.piPerformanceMode,
  DATABASE_ENABLED: (config) => config.databaseEnabled,
  LIGHTWEIGHT_STATE_ENABLED: (config) => config.lightweightStateEnabled,
  SQLITE_BACKUP_ENABLED: (config) => config.sqliteBackupEnabled,
  SQLITE_BACKUP_ON_STARTUP: (config) => config.sqliteBackupOnStartup,
  AGENCY_AUTONOMOUS_DATA_ENABLED: (config) => config.autonomousDataEnabled,
  LIVE_NEWS_ENABLED: (config) => config.liveNewsEnabled,
  AUTO_START_LIVE_NEWS: (config) => config.autoStartLiveNews,
  LIVE_NEWS_POLL_MS: (config) => config.liveNewsPollMs,
  LIVE_NEWS_MAX_ITEMS_PER_TICKER: (config) => config.liveNewsMaxItemsPerTicker,
  LIVE_NEWS_UNIVERSE_MODE: (config) => config.liveNewsUniverseMode,
  LIVE_NEWS_RSS_FALLBACK_MAX_TICKERS: (config) => config.liveNewsRssFallbackMaxTickers,
  LIVE_NEWS_API_FALLBACK_MAX_TICKERS: (config) => config.liveNewsApiFallbackMaxTickers,
  MARKETAUX_ENABLED: (config) => config.marketauxEnabled,
  MARKETAUX_SYMBOLS_PER_REQUEST: (config) => config.marketauxSymbolsPerRequest,
  MARKETAUX_MAX_REQUESTS_PER_POLL: (config) => config.marketauxMaxRequestsPerPoll,
  MARKETAUX_LIMIT_PER_REQUEST: (config) => config.marketauxLimitPerRequest,
  MARKET_DATA_PROVIDER: (config) => config.marketDataProvider,
  ALPACA_MARKET_DATA_ENABLED: (config) => config.alpacaMarketDataEnabled,
  ALPACA_MARKET_DATA_FEED: (config) => config.alpacaMarketDataFeed,
  MARKET_DATA_REFRESH_MS: (config) => config.marketDataRefreshMs,
  MARKET_FLOW_ENABLED: (config) => config.marketFlowEnabled,
  AUTO_START_MARKET_FLOW: (config) => config.autoStartMarketFlow,
  MARKET_FLOW_POLL_MS: (config) => config.marketFlowPollMs,
  MARKET_FLOW_MAX_TICKERS_PER_POLL: (config) => config.marketFlowMaxTickersPerPoll,
  EARNINGS_ENABLED: (config) => config.earningsEnabled,
  EARNINGS_PROVIDER: (config) => config.earningsProvider,
  EARNINGS_MAX_TICKERS_PER_POLL: (config) => config.earningsMaxTickersPerPoll,
  EARNINGS_POLL_MS: (config) => config.earningsPollMs,
  STOCKTWITS_ENABLED: (config) => config.stocktwitsEnabled,
  STOCKTWITS_POLL_MS: (config) => config.stocktwitsPollMs,
  STOCKTWITS_MAX_TICKERS_PER_POLL: (config) => config.stocktwitsMaxTickersPerPoll,
  TRADE_PRINTS_ENABLED: (config) => config.tradePrintsEnabled,
  TRADE_PRINTS_PROVIDER: (config) => config.tradePrintsProvider,
  TRADE_PRINTS_POLL_MS: (config) => config.tradePrintsPollMs,
  TRADE_PRINTS_MAX_TICKERS_PER_POLL: (config) => config.tradePrintsMaxTickersPerPoll,
  FUNDAMENTAL_MARKET_DATA_PROVIDER: (config) => config.fundamentalMarketDataProvider,
  AUTO_START_SECTOR_ETF_PROXIES: (config) => config.autoStartSectorEtfProxies,
  AUTO_START_FUNDAMENTAL_MARKET_DATA: (config) => config.autoStartFundamentalMarketData,
  FUNDAMENTAL_MARKET_DATA_REFRESH_MS: (config) => config.fundamentalMarketDataRefreshMs,
  FUNDAMENTAL_MARKET_DATA_MAX_COMPANIES_PER_POLL: (config) => config.fundamentalMarketDataMaxCompaniesPerPoll,
  FUNDAMENTAL_SEC_ENABLED: (config) => config.fundamentalSecEnabled,
  AUTO_START_SEC_FUNDAMENTALS: (config) => config.autoStartSecFundamentals,
  FUNDAMENTAL_SEC_BASELINE_POLL_MS: (config) => config.fundamentalSecBaselinePollMs,
  FUNDAMENTAL_SEC_CONCURRENCY: (config) => config.fundamentalSecConcurrency,
  FUNDAMENTAL_SEC_MAX_COMPANIES_PER_POLL: (config) => config.fundamentalSecMaxCompaniesPerPoll,
  SEC_FORM4_ENABLED: (config) => config.secForm4Enabled,
  AUTO_START_SEC_FORM4: (config) => config.autoStartSecForm4,
  SEC_FORM4_POLL_MS: (config) => config.secForm4PollMs,
  SEC_FORM4_MAX_TICKERS_PER_POLL: (config) => config.secForm4MaxTickersPerPoll,
  SEC_13F_ENABLED: (config) => config.sec13fEnabled,
  AUTO_START_SEC_13F: (config) => config.autoStartSec13f,
  SEC_REQUEST_RETRIES: (config) => config.secRequestRetries
};

function enabledLabel(enabled) {
  return enabled ? "enabled" : "disabled";
}

function dataAutoStart(config, enabled, explicitAutoStart = true) {
  return Boolean(enabled && (config.autonomousDataEnabled || explicitAutoStart));
}

function hasEarningsAccess(config) {
  return (
    config.earningsProvider === "yahoo" ||
    (config.earningsProvider === "twelvedata" && Boolean(config.earningsApiKey || config.twelveDataApiKey)) ||
    (config.earningsProvider === "finnhub" && hasFinnhubAccess(config)) ||
    (config.earningsProvider === "fmp" && hasFmpAccess(config)) ||
    (config.earningsProvider === "alphavantage" && hasAlphaVantageAccess(config))
  );
}

function hasTradePrintsAccess(config) {
  return Boolean(config.tradePrintsApiKey || config.massiveApiKey || config.polygonApiKey);
}

function sourceSpecs(config) {
  const stocktwitsEnabled = Boolean(config.stocktwitsEnabled);
  const tradePrintsEnabled = Boolean(config.tradePrintsEnabled);
  const earningsEnabled = Boolean(config.earningsEnabled || config.autonomousDataEnabled);

  return [
    {
      key: "fundamental_universe",
      label: "Fundamental Universe",
      category: "coverage",
      enabled: true,
      autoStart: true,
      intervalMs: 24 * HOUR_MS,
      criticality: "critical",
      notes: "Loads the tracked S&P 100 + QQQ coverage set without scored placeholder fundamentals."
    },
    {
      key: "live_news",
      healthKey: "google_news_rss",
      label: "Live News",
      category: "news",
      enabled: config.liveNewsEnabled,
      autoStart: dataAutoStart(config, config.liveNewsEnabled, config.autoStartLiveNews),
      intervalMs: config.liveNewsPollMs,
      criticality: "high",
      notes: "Feeds the sentiment engine with Marketaux when configured, then Google/Yahoo RSS fallbacks."
    },
    {
      key: "marketaux_news",
      label: "Marketaux Linked News",
      category: "news",
      enabled: config.liveNewsEnabled && config.marketauxEnabled,
      autoStart: dataAutoStart(config, config.liveNewsEnabled && config.marketauxEnabled, config.autoStartLiveNews),
      intervalMs: config.liveNewsPollMs,
      criticality: "medium",
      configured: Boolean(config.marketauxApiKey),
      missingConfigReason: "MARKETAUX_API_KEY is required for Marketaux linked market news.",
      notes: "Adds source-linked market news, entity matching, and sentiment fields before RSS fallback."
    },
    {
      key: "market_data",
      label: "Market Data",
      category: "prices",
      provider: config.marketDataProvider,
      enabled: true,
      autoStart: true,
      intervalMs: config.marketDataRefreshMs,
      staleAfterHours: 36,
      softErrorsWhenFresh: true,
      criticality: "high",
      configured: config.marketDataProvider === "synthetic" || hasConfiguredLiveMarketProvider(config, config.marketDataProvider),
      missingConfigReason: marketProviderMissingConfigReason(config.marketDataProvider, "Live pricing"),
      notes: `Ticker charts and market snapshots use ${config.marketDataProvider}.`
    },
    {
      key: "market_flow",
      label: "Market Flow",
      category: "money_flow",
      provider: config.marketDataProvider,
      enabled: config.marketFlowEnabled,
      autoStart: dataAutoStart(config, config.marketFlowEnabled, config.autoStartMarketFlow),
      intervalMs: config.marketFlowPollMs,
      staleAfterHours: 36,
      softErrorsWhenFresh: true,
      criticality: "medium",
      configured: config.marketDataProvider !== "synthetic" && hasConfiguredLiveMarketProvider(config, config.marketDataProvider),
      missingConfigReason: marketProviderMissingConfigReason(config.marketDataProvider, "Market Flow") || "Market Flow needs MARKET_DATA_PROVIDER=alpaca or twelvedata.",
      notes: "Turns abnormal volume and price shocks into money-flow events."
    },
    {
      key: "sector_etf_proxies",
      label: "Sector ETF Proxies",
      category: "prices",
      provider: config.fundamentalMarketDataProvider,
      enabled: true,
      autoStart: dataAutoStart(config, true, config.autoStartSectorEtfProxies),
      intervalMs: config.marketDataRefreshMs,
      staleAfterHours: 120,
      softErrorsWhenFresh: true,
      criticality: "medium",
      configured: config.fundamentalMarketDataProvider === "synthetic" || hasConfiguredLiveMarketProvider(config, config.fundamentalMarketDataProvider),
      missingConfigReason: marketProviderMissingConfigReason(config.fundamentalMarketDataProvider, "Sector ETF proxy quotes"),
      notes: "Feeds Market Agent sector strength with XLK/XLY/XLV-style ETF proxy performance when provider quotes are available."
    },
    {
      key: "earnings_calendar",
      healthKey: "yahoo_earnings_calendar",
      label: "Earnings Calendar",
      category: "events",
      enabled: earningsEnabled,
      autoStart: dataAutoStart(config, earningsEnabled, config.earningsEnabled),
      intervalMs: config.earningsPollMs,
      criticality: "medium",
      configured: hasEarningsAccess(config),
      missingConfigReason: "Twelve Data earnings mode needs TWELVE_DATA_API_KEY or EARNINGS_API_KEY.",
      notes: `Checks ${config.earningsProvider || "earnings"} earnings dates and feeds upcoming/release risk flags.`
    },
    {
      key: "stocktwits_stream",
      label: "StockTwits Social Pulse",
      category: "social",
      enabled: stocktwitsEnabled,
      autoStart: dataAutoStart(config, stocktwitsEnabled, config.stocktwitsEnabled),
      intervalMs: config.stocktwitsPollMs,
      criticality: "low",
      configured: Boolean(config.stocktwitsApiKey),
      missingConfigReason: "StockTwits now blocks unauthenticated server requests in many environments. Set STOCKTWITS_API_KEY or leave this optional source unconfigured.",
      notes: "Turns strong tagged bullish/bearish crowd skew into social-buzz evidence."
    },
    {
      key: "trade_prints",
      healthKey: `${config.tradePrintsProvider}_trade_prints`,
      label: "Delayed Trade Prints",
      category: "money_flow",
      enabled: tradePrintsEnabled,
      autoStart: dataAutoStart(config, tradePrintsEnabled, config.tradePrintsEnabled),
      intervalMs: config.tradePrintsPollMs,
      criticality: "medium",
      configured: hasTradePrintsAccess(config),
      missingConfigReason: "Delayed exchange trade prints need MASSIVE_API_KEY, POLYGON_API_KEY, IEX_API_KEY, or TRADE_PRINTS_API_KEY.",
      notes: `Classifies delayed block prints from ${config.tradePrintsProvider}.`
    },
    {
      key: "uta",
      label: "Unusual Trading Activity",
      category: "money_flow",
      provider: "replay_first_node",
      enabled: true,
      autoStart: false,
      intervalMs: null,
      staleAfterHours: 1,
      criticality: "medium",
      configured: true,
      notes: "Runs replay-first UTA cycles and reports lane pressure without enabling paper-trading effects."
    },
    {
      key: "fundamental_market_data",
      label: "Fundamental Market Reference",
      category: "fundamentals",
      provider: config.fundamentalMarketDataProvider,
      enabled: true,
      autoStart: dataAutoStart(config, true, config.autoStartFundamentalMarketData),
      intervalMs: config.fundamentalMarketDataRefreshMs,
      staleAfterHours: 48,
      softErrorsWhenFresh: true,
      criticality: "medium",
      configured: config.fundamentalMarketDataProvider === "synthetic" || hasConfiguredLiveMarketProvider(config, config.fundamentalMarketDataProvider),
      missingConfigReason: marketProviderMissingConfigReason(config.fundamentalMarketDataProvider, "Live fundamental market reference"),
      notes: `Valuation/reference fields use ${config.fundamentalMarketDataProvider} in batches of ${config.fundamentalMarketDataMaxCompaniesPerPoll || "all"}.`
    },
    {
      key: "sec_fundamentals",
      label: "SEC Fundamentals",
      category: "fundamentals",
      enabled: config.fundamentalSecEnabled,
      autoStart: dataAutoStart(config, config.fundamentalSecEnabled, config.autoStartSecFundamentals),
      intervalMs: config.fundamentalSecPollMs,
      criticality: "high",
      notes: `Refreshes company fundamentals from SEC submissions and Company Facts in batches of ${config.fundamentalSecMaxCompaniesPerPoll || "all"}.`
    },
    {
      key: "sec_form4",
      label: "SEC Form 4 Insider Flow",
      category: "filings",
      enabled: config.secForm4Enabled,
      autoStart: dataAutoStart(config, config.secForm4Enabled, config.autoStartSecForm4),
      intervalMs: config.secForm4PollMs,
      criticality: "medium",
      notes: "Tracks insider buying and selling filings."
    },
    {
      key: "sec_13f",
      label: "SEC 13F Institutional Flow",
      category: "filings",
      enabled: config.sec13fEnabled,
      autoStart: dataAutoStart(config, config.sec13fEnabled, config.autoStartSec13f),
      intervalMs: config.sec13fPollMs,
      criticality: "low",
      notes: "Tracks slower quarterly institutional position changes."
    },
    {
      key: "lightweight_state",
      label: "Lightweight State Snapshot",
      category: "storage",
      enabled: config.lightweightStateEnabled && !config.databaseEnabled,
      autoStart: config.lightweightStateEnabled && !config.databaseEnabled,
      intervalMs: null,
      criticality: "medium",
      notes: "Persists a compact JSON runtime snapshot when SQLite/Postgres persistence is disabled."
    },
    {
      key: "database_backup",
      label: "SQLite Backup",
      category: "storage",
      enabled: config.databaseEnabled && config.databaseProvider === "sqlite" && config.sqliteBackupEnabled,
      autoStart: config.databaseEnabled && config.databaseProvider === "sqlite" && config.sqliteBackupEnabled,
      intervalMs: config.sqliteBackupIntervalMs,
      criticality: "medium",
      notes: "Creates local SQLite snapshot backups when SQLite persistence is active."
    }
  ];
}

function latestTimestamp(health = {}) {
  return health.last_success_at || health.last_backup_at || null;
}

function errorMessage(health = {}) {
  return health.last_error || null;
}

function classifySource(spec, health, pressure) {
  const lastSuccessAt = latestTimestamp(health);
  const lastPollAt = health?.last_poll_at || null;
  const lastError = errorMessage(health);
  const ageHours = lastSuccessAt ? differenceInHours(lastSuccessAt) : null;
  const staleAfterHours = spec.staleAfterHours || Math.max(1, round(((spec.intervalMs || HOUR_MS) * 2.5) / HOUR_MS, 2));
  const providerName = String(health?.provider || spec.provider || "");
  const hasLiveProvider =
    !["market_data", "market_flow", "fundamental_market_data"].includes(spec.key) ||
    (providerName && !providerName.includes("synthetic") && !health?.fallback_mode);

  if (!spec.enabled) {
    return {
      status: "disabled",
      action: "leave_disabled",
      severity: "info",
      reason: `${spec.label} is disabled by configuration.`
    };
  }

  if (spec.configured === false) {
    return {
      status: "unconfigured",
      action: "add_configuration",
      severity: spec.criticality === "high" ? "warning" : "info",
      reason: spec.missingConfigReason || `${spec.label} needs additional configuration before it can run live.`
    };
  }

  if (!spec.autoStart) {
    return {
      status: "manual",
      action: pressure.isConstrained ? "keep_manual" : "manual_refresh_when_needed",
      severity: spec.criticality === "high" ? "warning" : "info",
      reason: `${spec.label} is enabled but not auto-started.`
    };
  }

  if (health?.polling) {
    return {
      status: "polling",
      action: "monitor",
      severity: "info",
      reason: `${spec.label} is currently polling.`
    };
  }

  if (lastError && !lastSuccessAt) {
    return {
      status: "error",
      action: "investigate",
      severity: "critical",
      reason: `${spec.label} has errors and no successful refresh yet.`
    };
  }

  if (lastError && ageHours !== null && ageHours > staleAfterHours) {
    return {
      status: "degraded",
      action: pressure.isConstrained ? "pause_until_stable" : "retry_with_backoff",
      severity: "warning",
      reason: `${spec.label} is stale and has a recent error.`
    };
  }

  if (ageHours !== null && ageHours > staleAfterHours) {
    return {
      status: "stale",
      action: pressure.isConstrained ? "manual_refresh_when_needed" : "refresh",
      severity: spec.criticality === "critical" ? "warning" : "info",
      reason: `${spec.label} has not refreshed within ${staleAfterHours} hours.`
    };
  }

  if (health?.fallback_active && lastError) {
    return {
      status: "degraded",
      action: pressure.isConstrained ? "keep_running_light" : "retry_with_backoff",
      severity: "warning",
      reason: `${spec.label} is temporarily using synthetic fallback after live-provider failures.`
    };
  }

  if (lastError && spec.softErrorsWhenFresh && ageHours !== null && ageHours <= staleAfterHours) {
    return {
      status: "healthy",
      action: "keep_running",
      severity: "info",
      reason: `${spec.label} has usable recent data. Latest provider warning is shown in details.`
    };
  }

  if (!lastSuccessAt && !lastPollAt) {
    return {
      status: hasLiveProvider ? "pending" : "fallback",
      action: hasLiveProvider ? "start_or_wait" : "accept_fallback",
      severity: hasLiveProvider && spec.criticality === "high" ? "warning" : "info",
      reason: hasLiveProvider
        ? `${spec.label} has not refreshed in this process yet.`
        : `${spec.label} is currently using synthetic/fallback data.`
    };
  }

  if (lastError) {
    return {
      status: "degraded",
      action: pressure.isConstrained ? "keep_running_light" : "retry_with_backoff",
      severity: "warning",
      reason: `${spec.label} has a recent error but also has usable data.`
    };
  }

  return {
    status: hasLiveProvider ? "healthy" : "fallback",
    action: hasLiveProvider ? "keep_running" : "accept_fallback",
    severity: "info",
    reason: hasLiveProvider
      ? `${spec.label} is operating normally.`
      : `${spec.label} is serving deterministic fallback data.`
  };
}

function pressureSnapshot(config) {
  const memory = process.memoryUsage();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const loadAvg = os.loadavg();
  const cpuCount = Math.max(1, os.cpus()?.length || 1);
  const loadPerCore = loadAvg[0] / cpuCount;
  const rssRatio = totalMemory ? memory.rss / totalMemory : 0;
  const freeRatio = totalMemory ? freeMemory / totalMemory : 1;
  const isConstrained =
    config.piPerformanceMode ||
    loadPerCore >= 0.8 ||
    rssRatio >= 0.35 ||
    freeRatio <= 0.12;

  const reasons = [];
  if (config.piPerformanceMode) {
    reasons.push("Pi performance mode is enabled.");
  }
  if (loadPerCore >= 0.8) {
    reasons.push("CPU load is high for the available cores.");
  }
  if (rssRatio >= 0.35) {
    reasons.push("Node process memory is high relative to system memory.");
  }
  if (freeRatio <= 0.12) {
    reasons.push("System free memory is low.");
  }

  return {
    isConstrained,
    reasons,
    process: {
      uptime_seconds: Math.round(process.uptime()),
      rss_mb: round(memory.rss / 1_048_576, 1),
      heap_used_mb: round(memory.heapUsed / 1_048_576, 1)
    },
    system: {
      platform: os.platform(),
      cpu_count: cpuCount,
      load_1m: round(loadAvg[0], 2),
      load_per_core_1m: round(loadPerCore, 2),
      total_memory_mb: round(totalMemory / 1_048_576, 1),
      free_memory_mb: round(freeMemory / 1_048_576, 1),
      free_memory_ratio: round(freeRatio, 3)
    }
  };
}

function buildPlan(sources, pressure, config) {
  const safeToAutostart = sources
    .filter((source) => source.enabled && source.auto_start && ["healthy", "fallback", "pending"].includes(source.status))
    .map((source) => source.key);
  const keepManual = sources
    .filter((source) => source.enabled && !source.auto_start)
    .map((source) => source.key);
  const investigate = sources
    .filter((source) => ["error", "degraded"].includes(source.status))
    .map((source) => source.key);
  const needsConfiguration = sources
    .filter((source) => source.status === "unconfigured")
    .map((source) => source.key);
  const disabled = sources
    .filter((source) => !source.enabled)
    .map((source) => source.key);

  const recommendations = [];
  if (pressure.isConstrained) {
    recommendations.push("Keep high-cost collectors manual until pressure is stable.");
  }
  if (!config.databaseEnabled) {
    recommendations.push("Persistence is disabled; runtime data will reset on restart.");
  }
  if (config.databaseProvider === "sqlite" && config.databaseEnabled && config.sqliteBackupOnStartup) {
    recommendations.push("Disable startup SQLite backups on the Pi if boot CPU or disk pressure returns.");
  }
  if (investigate.length) {
    recommendations.push(`Investigate degraded sources: ${investigate.join(", ")}.`);
  }
  if (needsConfiguration.length) {
    recommendations.push(`Add credentials or choose a fallback for: ${needsConfiguration.join(", ")}.`);
  }
  if (!recommendations.length) {
    recommendations.push("Runtime plan is stable; keep current collector schedule.");
  }

  return {
    safe_to_autostart: safeToAutostart,
    keep_manual: keepManual,
    investigate,
    needs_configuration: needsConfiguration,
    disabled,
    recommendations
  };
}

function buildAvailableActions(sources, config) {
  const byKey = new Map(sources.map((source) => [source.key, source]));
  const sourceCanRun = (key) => {
    const source = byKey.get(key);
    return Boolean(source?.enabled && source.status !== "unconfigured");
  };
  const actions = [
    {
      action: "snapshot",
      label: "Refresh Runtime Snapshot",
      source: null,
      safe: true,
      enabled: true,
      description: "Re-read current runtime reliability without polling live sources."
    },
    {
      action: "refresh_universe",
      label: "Refresh Universe",
      source: "fundamental_universe",
      safe: true,
      enabled: true,
      description: "Rebuild the tracked S&P 100 + QQQ coverage universe."
    },
    {
      action: "poll_once",
      label: "Poll News Once",
      source: "live_news",
      safe: true,
      enabled: sourceCanRun("live_news"),
      description: "Fetch one batch of Google/Yahoo RSS news without starting a timer."
    },
    {
      action: "poll_once",
      label: "Poll Market Flow Once",
      source: "market_flow",
      safe: true,
      enabled: sourceCanRun("market_flow"),
      description: "Run one abnormal volume/flow scan without starting a timer."
    },
    {
      action: "poll_once",
      label: "Refresh Sector ETF Proxies",
      source: "sector_etf_proxies",
      safe: true,
      enabled: sourceCanRun("sector_etf_proxies"),
      description: "Refresh sector ETF proxy quotes for the Market Agent without touching stock fundamentals."
    },
    {
      action: "poll_once",
      label: "Poll Earnings Calendar Once",
      source: "earnings_calendar",
      safe: true,
      enabled: sourceCanRun("earnings_calendar"),
      description: "Fetch one Yahoo Finance earnings-calendar batch without starting a timer."
    },
    {
      action: "poll_once",
      label: "Poll StockTwits Once",
      source: "stocktwits_stream",
      safe: true,
      enabled: sourceCanRun("stocktwits_stream"),
      description: "Fetch one StockTwits social-sentiment batch without starting a timer."
    },
    {
      action: "poll_once",
      label: "Poll Trade Prints Once",
      source: "trade_prints",
      safe: true,
      enabled: sourceCanRun("trade_prints"),
      description: "Fetch one delayed trade-prints batch without starting a timer."
    },
    {
      action: "poll_once",
      label: "Run UTA Cycle Once",
      source: "uta",
      safe: true,
      enabled: sourceCanRun("uta"),
      description: "Run one replay-backed UTA cycle without starting a timer."
    },
    {
      action: "poll_once",
      label: "Poll SEC Form 4 Once",
      source: "sec_form4",
      safe: true,
      enabled: sourceCanRun("sec_form4"),
      description: "Fetch one insider-filing batch without starting a timer."
    },
    {
      action: "poll_once",
      label: "Poll SEC 13F Once",
      source: "sec_13f",
      safe: false,
      enabled: sourceCanRun("sec_13f"),
      description: "Run one institutional 13F scan. This can be slower than other actions."
    },
    {
      action: "poll_once",
      label: "Poll SEC Fundamentals Once",
      source: "sec_fundamentals",
      safe: false,
      enabled: sourceCanRun("sec_fundamentals"),
      description: "Refresh SEC submissions/company facts once. This is the heaviest source."
    },
    {
      action: "poll_once",
      label: "Refresh Fundamental Market Data",
      source: "fundamental_market_data",
      safe: true,
      enabled: true,
      description: "Refresh valuation/reference fields once using the configured provider."
    },
    {
      action: "save_lightweight_state",
      label: "Save Lightweight State",
      source: "lightweight_state",
      safe: true,
      enabled: Boolean(config.lightweightStateEnabled && !config.databaseEnabled),
      description: "Persist the current compact JSON runtime snapshot now."
    },
    {
      action: "backup_now",
      label: "Backup SQLite Now",
      source: "database_backup",
      safe: false,
      enabled: Boolean(config.databaseEnabled && config.databaseProvider === "sqlite" && config.sqliteBackupEnabled),
      description: "Create one SQLite backup now. Avoid during high disk pressure."
    },
    {
      action: "apply_profile",
      label: "Preview Runtime Profile",
      source: null,
      safe: true,
      enabled: true,
      description: "Preview or apply one of the predefined runtime .env profiles."
    }
  ];

  return actions.map((item) => {
    const source = item.source ? byKey.get(item.source) : null;
    return {
      ...item,
      disabled_reason: item.enabled
        ? null
        : source?.status === "unconfigured"
          ? source.reason
          : `${item.source || item.action} is disabled by current configuration.`
    };
  });
}

function normalizeProfileValue(value) {
  if (typeof value === "boolean") {
    return String(value);
  }
  return String(value ?? "");
}

function profileDiff(config, profile) {
  return Object.entries(profile.env).map(([key, desired]) => {
    const reader = PROFILE_CONFIG_READERS[key];
    const current = reader ? normalizeProfileValue(reader(config)) : null;
    return {
      key,
      current,
      desired: String(desired),
      matches: current === String(desired)
    };
  });
}

function buildRuntimeProfiles(config, pressure) {
  const profiles = Object.entries(RUNTIME_PROFILES).map(([key, profile]) => {
    const changes = profileDiff(config, profile);
    const changed = changes.filter((item) => !item.matches);
    return {
      key,
      label: profile.label,
      description: profile.description,
      matches_current: changed.length === 0,
      change_count: changed.length,
      env: profile.env,
      changes: changed
    };
  });

  const current = profiles.find((profile) => profile.matches_current)?.key || null;
  let recommended = "pi_light";
  if (config.apiSaverMode) {
    recommended = "api_saver_testing";
  } else if (!config.databaseEnabled && !config.liveNewsEnabled) {
    recommended = "emergency";
  } else if (!config.databaseEnabled && config.liveNewsEnabled && !config.marketFlowEnabled && !config.secForm4Enabled) {
    recommended = "live_news_only";
  } else if (hasAlpacaMarketDataAccess(config) && !config.databaseEnabled) {
    recommended = "alpaca_marketaux_live";
  } else if (config.twelveDataApiKey && !config.databaseEnabled) {
    recommended = "autonomous_live";
  } else if (!pressure.isConstrained && config.databaseEnabled) {
    recommended = "full_live";
  }

  return {
    current,
    recommended,
    profiles
  };
}

function overallStatus(sources, pressure) {
  const criticalErrors = sources.filter((source) => source.severity === "critical").length;
  const warnings = sources.filter((source) => source.severity === "warning").length;

  if (criticalErrors) {
    return "degraded";
  }
  if (pressure.isConstrained && warnings) {
    return "constrained";
  }
  if (pressure.isConstrained || warnings) {
    return "caution";
  }
  return "optimal";
}

export function createRuntimeReliabilityAgent({ config, store }) {
  function getSnapshot() {
    const pressure = pressureSnapshot(config);
    const specs = sourceSpecs(config);
    const sources = specs.map((spec) => {
      const health =
        spec.key === "database_backup"
          ? store.health.databaseBackup || {}
          : store.health.liveSources?.[spec.healthKey || spec.key] || {};
      const classification = classifySource(spec, health, pressure);
      const lastSuccessAt = latestTimestamp(health);

      return {
        key: spec.key,
        label: spec.label,
        category: spec.category,
        enabled: spec.enabled,
        enabled_label: enabledLabel(spec.enabled),
        auto_start: spec.autoStart,
        criticality: spec.criticality,
        status: classification.status,
        action: classification.action,
        severity: classification.severity,
        reason: classification.reason,
        notes: spec.notes,
        provider: health.provider || spec.provider || null,
        feed: health.feed || null,
        fallback_mode: Boolean(health.fallback_mode),
        configured: health.configured === undefined ? null : Boolean(health.configured),
        last_empty_at: health.last_empty_at || null,
        polling: Boolean(health.polling),
        last_poll_at: health.last_poll_at || null,
        last_success_at: lastSuccessAt,
        age_hours: lastSuccessAt ? round(differenceInHours(lastSuccessAt), 2) : null,
        last_error: errorMessage(health),
        active_provider: health.active_provider || null,
        provider_chain: health.provider_chain || null,
        provider_cooldowns: health.provider_cooldowns || [],
        fallback_active: Boolean(health.fallback_active),
        cache_entries: health.cache_entries ?? null,
        universe_symbols: health.universe_symbols ?? null,
        requested_symbols: health.requested_symbols ?? null,
        last_batch_size: health.last_batch_size ?? null,
        rss_fallback_symbols: health.rss_fallback_symbols ?? null,
        requested_batches: health.requested_batches ?? null,
        total_batches: health.total_batches ?? null,
        symbols_per_request: health.symbols_per_request ?? null,
        max_requests_per_poll: health.max_requests_per_poll ?? null,
        limit_per_request: health.limit_per_request ?? null,
        universe_mode: health.universe_mode || null,
        coverage_note: health.coverage_note || null,
        interval_ms: spec.intervalMs || null
      };
    });

    const status = overallStatus(sources, pressure);

    return {
      as_of: new Date().toISOString(),
      status,
      summary:
        status === "optimal"
          ? "Runtime sources are operating within the current safety plan."
          : "Runtime needs attention before increasing live collector load.",
      pressure,
      source_counts: {
        total: sources.length,
        healthy: sources.filter((source) => source.status === "healthy").length,
        fallback: sources.filter((source) => source.status === "fallback").length,
        manual: sources.filter((source) => source.status === "manual").length,
        degraded: sources.filter((source) => ["degraded", "error"].includes(source.status)).length,
        unconfigured: sources.filter((source) => source.status === "unconfigured").length,
        disabled: sources.filter((source) => source.status === "disabled").length
      },
      collector_plan: buildPlan(sources, pressure, config),
      available_actions: buildAvailableActions(sources, config),
      runtime_profiles: buildRuntimeProfiles(config, pressure),
      sources
    };
  }

  return {
    getSnapshot
  };
}
