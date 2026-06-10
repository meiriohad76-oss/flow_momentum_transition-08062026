import { config } from "./config.js";
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import {
  getFundamentalPersistenceFactSeries,
  getFundamentalPersistenceFilings,
  getFundamentalPersistenceTicker,
  summarizeFundamentalPersistence
} from "./domain/fundamental-persistence.js";
import { createFundamentalMarketDataService } from "./domain/fundamental-market-data.js";
import { loadFundamentalUniverse } from "./domain/fundamental-universe.js";
import { evidenceTimestamp, filterFreshEvidence, shouldUseEvidence } from "./domain/freshness-policy.js";
import {
  buildFundamentalResearchGovernance,
  createFundamentalsEngine,
  settingsForFundamentalProfile
} from "./domain/fundamentals.js";
import { createLiveNewsCollector } from "./domain/live-news.js";
import { createMarketDataService } from "./domain/market-data.js";
import { createMarketFlowMonitor } from "./domain/market-flow.js";
import { hasConfiguredLiveMarketProvider } from "./domain/market-providers.js";
import { createPersistence } from "./domain/persistence.js";
import { createPipeline } from "./domain/pipeline.js";
import { createProviderQuotaManager } from "./domain/provider-quota.js";
import { replaySampleEvents } from "./domain/replay.js";
import { createSecFundamentalsCollector, selectSecFundamentalsRefreshBatch } from "./domain/sec-fundamentals.js";
import { createSecInstitutionalCollector } from "./domain/sec-institutional.js";
import { createSecInsiderCollector } from "./domain/sec-insider.js";
import { createStore, resetStore } from "./domain/store.js";
import { EVENT_TAXONOMY } from "./domain/taxonomy.js";
import { lookupUniverseEntry } from "./domain/tracked-universe.js";
import { createMacroRegimeAgent } from "./domain/macro-regime.js";
import { createTradeSetupAgent } from "./domain/trade-setup.js";
import { RUNTIME_PROFILES, createRuntimeReliabilityAgent } from "./domain/runtime-reliability.js";
import { createAlpacaBroker } from "./domain/broker-alpaca.js";
import { createAlpacaMcpBroker } from "./domain/broker-alpaca-mcp.js";
import { createExecutionAgent } from "./domain/execution-agent.js";
import { createRiskAgent } from "./domain/risk-agent.js";
import { createPositionMonitorAgent } from "./domain/position-monitor-agent.js";
import { buildTradingWorkflowStatus } from "./domain/trading-workflow.js";
import { buildAgencyCycleStatus, chooseAgencyCycleAdvance } from "./domain/agency-cycle.js";
import { buildSystemDoctorSnapshot } from "./domain/system-doctor.js";
import {
  PORTFOLIO_POLICY_FIELDS,
  buildPortfolioPolicySnapshot,
  normalizePortfolioPolicyUpdates,
  portfolioPolicyEnvUpdates,
  readPortfolioPolicy
} from "./domain/portfolio-policy.js";
import { buildLlmSelectionSnapshot } from "./domain/llm-selection-agent.js";
import { buildFinalSelectionSnapshot } from "./domain/final-selection.js";
import { buildFundamentalBacktestSnapshot } from "./domain/backtest.js";
import { createCorporateEventsCollector } from "./domain/corporate-events.js";
import { createSocialSentimentCollector } from "./domain/social-sentiment.js";
import { createTradePrintsCollector } from "./domain/trade-prints.js";
import { createExecutionAgent as createHumanApprovalAgent } from "./domain/execution.js";
import { createUtaService } from "./domain/uta.js";
import { round, scoreToLabel } from "./utils/helpers.js";
import { SECTOR_ETF_PROXIES, buildSectorStrengthSnapshot, normalizeReferenceReturn } from "./domain/sector-strength.js";

const MARKET_FLOW_SETTINGS_FIELDS = {
  marketFlowVolumeSpikeThreshold: { env: "MARKET_FLOW_VOLUME_SPIKE_THRESHOLD", min: 1, max: 20, digits: 2 },
  marketFlowMinPriceMoveThreshold: { env: "MARKET_FLOW_MIN_PRICE_MOVE_THRESHOLD", min: 0.001, max: 0.2, digits: 4 },
  marketFlowBlockTradeSpikeThreshold: { env: "MARKET_FLOW_BLOCK_TRADE_SPIKE_THRESHOLD", min: 1, max: 30, digits: 2 },
  marketFlowBlockTradeShockThreshold: { env: "MARKET_FLOW_BLOCK_TRADE_SHOCK_THRESHOLD", min: 1, max: 30, digits: 2 },
  marketFlowBlockTradeMinShares: { env: "MARKET_FLOW_BLOCK_TRADE_MIN_SHARES", min: 10000, max: 1000000000, digits: 0 },
  marketFlowBlockTradeMinNotionalUsd: { env: "MARKET_FLOW_BLOCK_TRADE_MIN_NOTIONAL_USD", min: 100000, max: 10000000000, digits: 0 },
  marketFlowAbnormalVolumeMinNotionalUsd: { env: "MARKET_FLOW_ABNORMAL_VOLUME_MIN_NOTIONAL_USD", min: 100000, max: 10000000000, digits: 0 }
};

const MONEY_FLOW_EVENT_TYPES = new Set([
  ...EVENT_TAXONOMY.insider_ownership,
  ...EVENT_TAXONOMY.money_flow
]);

const AGENCY_AUDIT_HISTORY_LIMIT = 250;
const FINAL_SELECTION_CACHE_TTL_MS = 120_000;

function cloneForAudit(value) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function rememberAuditSnapshot(store, key, value, { limit = AGENCY_AUDIT_HISTORY_LIMIT, identity = null } = {}) {
  const snapshot = cloneForAudit(value);
  if (!snapshot) {
    return null;
  }
  const stamp = snapshot.as_of || snapshot.asOf || snapshot.generated_at || snapshot.at || new Date().toISOString();
  if (!snapshot.as_of) {
    snapshot.as_of = stamp;
  }
  const rowIdentity = identity || snapshot.id || `${key}:${stamp}`;
  const history = Array.isArray(store[key]) ? store[key] : [];
  store[key] = [
    snapshot,
    ...history.filter((item) => {
      const itemStamp = item?.as_of || item?.asOf || item?.generated_at || item?.at || null;
      const itemIdentity = item?.id || `${key}:${itemStamp}`;
      return itemIdentity !== rowIdentity;
    })
  ].slice(0, limit);
  return snapshot;
}

function rememberFinalSelectionAudit(store, finalSelection) {
  const snapshot = rememberAuditSnapshot(store, "finalSelectionHistory", finalSelection);
  if (!snapshot) {
    return null;
  }

  const passes = (snapshot.candidates || [])
    .filter((candidate) => candidate.execution_allowed)
    .map((candidate) => ({
      id: `${snapshot.as_of}:${snapshot.window || "default"}:${candidate.ticker}:${candidate.final_action}`,
      as_of: snapshot.as_of,
      window: snapshot.window || null,
      candidate
    }));
  for (const pass of passes.reverse()) {
    rememberAuditSnapshot(store, "tradingSelectionPassHistory", pass, { identity: pass.id });
  }
  return snapshot;
}

function rememberAgencyAudit(store, snapshots = {}) {
  if (snapshots.llmSelection) {
    rememberAuditSnapshot(store, "llmSelectionHistory", snapshots.llmSelection);
  }
  if (snapshots.finalSelection) {
    rememberFinalSelectionAudit(store, snapshots.finalSelection);
  }
  if (snapshots.riskSnapshot) {
    rememberAuditSnapshot(store, "riskSnapshotHistory", snapshots.riskSnapshot);
  }
  if (snapshots.positionMonitor) {
    rememberAuditSnapshot(store, "positionMonitorHistory", snapshots.positionMonitor);
  }
  if (snapshots.agencyCycle) {
    rememberAuditSnapshot(store, "agencyCycleHistory", snapshots.agencyCycle);
  }
}

function rememberExecutionAudit(store, previewOrResult) {
  const payload = cloneForAudit(previewOrResult);
  if (!payload) {
    return null;
  }
  const intent = payload.intent || payload.preview?.intent || null;
  const ticker = intent?.ticker || payload.ticker || null;
  const action = intent?.action || payload.action || null;
  const asOf = payload.as_of || new Date().toISOString();
  const row = {
    id: `${asOf}:${ticker || "unknown"}:${action || "unknown"}`,
    as_of: asOf,
    ticker,
    action,
    preview: payload
  };
  return rememberAuditSnapshot(store, "executionIntentHistory", row, { identity: row.id });
}

const FUNDAMENTAL_SCREENER_FIELDS = {
  screenerRequireLiveSecForEligible: {
    env: "SCREENER_REQUIRE_LIVE_SEC_FOR_ELIGIBLE",
    type: "boolean",
    label: "Require Live SEC For Eligible",
    help: "When enabled, only live SEC-backed fundamentals can become Eligible."
  },
  screenerMinReportingConfidence: {
    env: "SCREENER_MIN_REPORTING_CONFIDENCE",
    type: "number",
    min: 0.5,
    max: 1,
    digits: 2,
    step: 0.01,
    label: "Min Reporting Confidence",
    help: "Minimum reporting confidence for the filing-quality check."
  },
  screenerMinDataFreshness: {
    env: "SCREENER_MIN_DATA_FRESHNESS",
    type: "number",
    min: 0.5,
    max: 1,
    digits: 2,
    step: 0.01,
    label: "Min Data Freshness",
    help: "Minimum freshness score for the filing-quality check."
  },
  screenerMaxMissingFields: {
    env: "SCREENER_MAX_MISSING_FIELDS",
    type: "number",
    min: 0,
    max: 10,
    digits: 0,
    step: 1,
    label: "Max Missing Fields",
    help: "Maximum missing-field count allowed in the filing-quality gate."
  },
  screenerMinRevenueGrowth: {
    env: "SCREENER_MIN_REVENUE_GROWTH",
    type: "number",
    min: -0.1,
    max: 0.5,
    digits: 3,
    step: 0.01,
    label: "Min Revenue Growth",
    help: "Revenue growth threshold for the growth check."
  },
  screenerMinEpsGrowth: {
    env: "SCREENER_MIN_EPS_GROWTH",
    type: "number",
    min: -0.1,
    max: 0.8,
    digits: 3,
    step: 0.01,
    label: "Min EPS Growth",
    help: "EPS growth threshold for the growth check."
  },
  screenerMinOperatingMargin: {
    env: "SCREENER_MIN_OPERATING_MARGIN",
    type: "number",
    min: 0,
    max: 0.5,
    digits: 3,
    step: 0.01,
    label: "Min Operating Margin",
    help: "Operating margin threshold for the profitability check."
  },
  screenerMinGrossMargin: {
    env: "SCREENER_MIN_GROSS_MARGIN",
    type: "number",
    min: 0,
    max: 0.9,
    digits: 3,
    step: 0.01,
    label: "Min Gross Margin",
    help: "Gross margin threshold for the profitability check."
  },
  screenerMinCurrentRatio: {
    env: "SCREENER_MIN_CURRENT_RATIO",
    type: "number",
    min: 0.2,
    max: 5,
    digits: 2,
    step: 0.05,
    label: "Min Current Ratio",
    help: "Current ratio threshold for the balance-sheet check."
  },
  screenerMaxNetDebtToEbitda: {
    env: "SCREENER_MAX_NET_DEBT_TO_EBITDA",
    type: "number",
    min: -5,
    max: 10,
    digits: 2,
    step: 0.1,
    label: "Max Net Debt / EBITDA",
    help: "Maximum leverage allowed in the balance-sheet check."
  },
  screenerMinFcfConversion: {
    env: "SCREENER_MIN_FCF_CONVERSION",
    type: "number",
    min: 0,
    max: 1.5,
    digits: 2,
    step: 0.01,
    label: "Min FCF Conversion",
    help: "FCF conversion threshold for the cash-efficiency check."
  },
  screenerMinFcfMargin: {
    env: "SCREENER_MIN_FCF_MARGIN",
    type: "number",
    min: 0,
    max: 0.5,
    digits: 3,
    step: 0.01,
    label: "Min FCF Margin",
    help: "FCF margin threshold for the cash-efficiency check."
  },
  screenerMaxPeTtm: {
    env: "SCREENER_MAX_PE_TTM",
    type: "number",
    min: 1,
    max: 120,
    digits: 1,
    step: 0.5,
    label: "Max P/E TTM",
    help: "P/E ceiling for the valuation sanity check."
  },
  screenerMaxPeg: {
    env: "SCREENER_MAX_PEG",
    type: "number",
    min: 0.1,
    max: 10,
    digits: 2,
    step: 0.1,
    label: "Max PEG",
    help: "PEG ceiling for the valuation sanity check."
  },
  screenerMinFcfYield: {
    env: "SCREENER_MIN_FCF_YIELD",
    type: "number",
    min: 0,
    max: 0.2,
    digits: 3,
    step: 0.005,
    label: "Min FCF Yield",
    help: "FCF yield floor for the valuation sanity check."
  },
  screenerMinCompositeScoreForEligible: {
    env: "SCREENER_MIN_COMPOSITE_SCORE_FOR_ELIGIBLE",
    type: "number",
    min: 0.3,
    max: 0.9,
    digits: 2,
    step: 0.01,
    label: "Min Composite For Eligible",
    help: "Minimum weighted fundamentals score required before a company can be marked Eligible."
  },
  screenerEligibleScore: {
    env: "SCREENER_ELIGIBLE_SCORE",
    type: "number",
    min: 0.3,
    max: 1,
    digits: 2,
    step: 0.01,
    label: "Eligible Score Threshold",
    help: "Minimum fraction of passed checks required for the eligible stage."
  },
  screenerWatchScore: {
    env: "SCREENER_WATCH_SCORE",
    type: "number",
    min: 0.1,
    max: 0.9,
    digits: 2,
    step: 0.01,
    label: "Watch Score Threshold",
    help: "Minimum fraction of passed checks required for the watch stage."
  }
};

function directorySizeBytes(dirPath) {
  if (!dirPath || !existsSync(dirPath)) {
    return 0;
  }

  return readdirSync(dirPath, { withFileTypes: true }).reduce((sum, entry) => {
    const entryPath = `${dirPath}/${entry.name}`;
    if (entry.isDirectory()) {
      return sum + directorySizeBytes(entryPath);
    }
    return sum + statSync(entryPath).size;
  }, 0);
}

function fileSizeBytes(filePath) {
  return filePath && existsSync(filePath) ? statSync(filePath).size : 0;
}

function buildPerformanceSnapshot(currentConfig, store) {
  const memory = process.memoryUsage();
  return {
    as_of: new Date().toISOString(),
    pi_performance_mode: currentConfig.piPerformanceMode,
    process: {
      uptime_seconds: Math.round(process.uptime()),
      rss_bytes: memory.rss,
      heap_used_bytes: memory.heapUsed,
      heap_total_bytes: memory.heapTotal,
      external_bytes: memory.external
    },
    data: {
      database_path: currentConfig.databaseProvider === "sqlite" ? currentConfig.databasePath : null,
      database_size_bytes: currentConfig.databaseProvider === "sqlite" ? fileSizeBytes(currentConfig.databasePath) : null,
      data_dir_size_bytes: directorySizeBytes(currentConfig.dataDir),
      backup_dir_size_bytes: directorySizeBytes(currentConfig.sqliteBackupDir)
    },
    workload: {
      raw_documents: store.rawDocuments.length,
      normalized_documents: store.normalizedDocuments.length,
      document_scores: store.documentScores.length,
      sentiment_states: store.sentimentStates.length,
      evidence_items: store.evidenceQuality?.summary?.total_evidence_items || 0
    },
    tuned_settings: {
      database_autosave_ms: currentConfig.databaseAutosaveMs,
      live_news_poll_ms: currentConfig.liveNewsPollMs,
      live_news_max_items_per_ticker: currentConfig.liveNewsMaxItemsPerTicker,
      agency_initial_baseline_cycle_ms: currentConfig.agencyInitialBaselineCycleMs,
      agency_ongoing_cycle_ms: currentConfig.agencyOngoingCycleMs,
      agency_baseline_sec_batches_per_run: currentConfig.agencyBaselineSecBatchesPerRun,
      market_data_refresh_ms: currentConfig.marketDataRefreshMs,
      market_flow_poll_ms: currentConfig.marketFlowPollMs,
      auto_start_market_flow: currentConfig.autoStartMarketFlow,
      fundamental_market_data_refresh_ms: currentConfig.fundamentalMarketDataRefreshMs,
      auto_start_fundamental_market_data: currentConfig.autoStartFundamentalMarketData,
      fundamental_sec_baseline_poll_ms: currentConfig.fundamentalSecBaselinePollMs,
      fundamental_sec_concurrency: currentConfig.fundamentalSecConcurrency,
      auto_start_sec_fundamentals: currentConfig.autoStartSecFundamentals,
      auto_start_sec_13f: currentConfig.autoStartSec13f,
      sec_request_retries: currentConfig.secRequestRetries,
      sqlite_backup_interval_ms: currentConfig.sqliteBackupIntervalMs,
      sqlite_backup_retention_count: currentConfig.sqliteBackupRetentionCount,
      sqlite_backup_on_startup: currentConfig.sqliteBackupOnStartup
    }
  };
}

function sourceUrlFromNormalized(normalized = {}) {
  const url = (
    normalized.canonical_url ||
    normalized.url ||
    normalized.source_metadata?.source_url ||
    normalized.source_metadata?.filing_url ||
    null
  );
  if (String(url || "").startsWith("market-flow://") && normalized.primary_ticker) {
    return `https://finance.yahoo.com/quote/${encodeURIComponent(normalized.primary_ticker)}/chart/`;
  }
  return url;
}

function sourceUrlFromAlert(alert = {}, normalized = null) {
  const url = (
    alert.url ||
    alert.canonical_url ||
    alert.payload?.url ||
    alert.payload?.canonical_url ||
    alert.evidence_quality?.url ||
    alert.payload?.evidence_quality?.url ||
    alert.source_metadata?.source_url ||
    alert.payload?.source_metadata?.source_url ||
    sourceUrlFromNormalized(normalized || {}) ||
    null
  );
  const ticker = alert.entity_key || normalized?.primary_ticker || alert.payload?.ticker || alert.payload?.ticker_hint || null;
  if (String(url || "").startsWith("market-flow://") && ticker) {
    return `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/chart/`;
  }
  return url;
}

function buildScoreLookup(store) {
  const normalizedByDocId = new Map(store.normalizedDocuments.map((doc) => [doc.doc_id, doc]));
  return new Map(
    store.documentScores.map((score) => [
      score.score_id,
      {
        score,
        normalized: normalizedByDocId.get(score.doc_id) || null
      }
    ])
  );
}

function hydrateAlertForDashboard(alert, scoreLookup) {
  const match = scoreLookup.get(alert.payload?.score_id || "");
  const normalized = match?.normalized || null;
  return {
    ...alert,
    source_name: alert.source_name || alert.payload?.source_name || normalized?.source_name || null,
    source_type: alert.source_type || alert.payload?.source_type || normalized?.source_type || null,
    source_metadata: alert.source_metadata || alert.payload?.source_metadata || normalized?.source_metadata || null,
    published_at: alert.published_at || alert.payload?.published_at || normalized?.published_at || null,
    event_type: alert.event_type || alert.payload?.event_type || match?.score?.event_type || null,
    url: sourceUrlFromAlert(alert, normalized)
  };
}

function alertSortTimestamp(alert) {
  return alert.created_at || alert.detected_at || evidenceTimestamp(alert) || null;
}

function isActiveAlertFresh(alert, currentConfig) {
  const maxAgeHours = Number(currentConfig.activeAlertFreshnessMaxHours || currentConfig.signalFreshnessMaxHours || 24);
  const observed = evidenceTimestamp(alert) || alertSortTimestamp(alert);
  const observedMs = new Date(observed || 0).getTime();
  if (!Number.isFinite(observedMs) || observedMs <= 0) {
    return false;
  }
  const ageHours = Math.max(0, (Date.now() - observedMs) / 3_600_000);
  return ageHours <= maxAgeHours;
}

function buildActiveAlerts(store, limit = 10) {
  const scoreLookup = buildScoreLookup(store);
  return store.alertHistory
    .map((alert) => hydrateAlertForDashboard(alert, scoreLookup))
    .filter((alert) => isActiveAlertFresh(alert, config))
    .sort((a, b) => new Date(alertSortTimestamp(b) || 0) - new Date(alertSortTimestamp(a) || 0))
    .slice(0, limit);
}

function readMarketFlowSettings(currentConfig) {
  return Object.keys(MARKET_FLOW_SETTINGS_FIELDS).reduce((acc, key) => {
    acc[key] = Number(currentConfig[key]);
    return acc;
  }, {});
}

function readScreenerSettings(currentConfig) {
  return Object.entries(FUNDAMENTAL_SCREENER_FIELDS).reduce((acc, [key, spec]) => {
    acc[key] = spec.type === "boolean" ? Boolean(currentConfig[key]) : Number(currentConfig[key]);
    return acc;
  }, {});
}

function databaseTargetLabel(currentConfig) {
  if (currentConfig.databaseProvider === "postgres") {
    if (!currentConfig.databaseUrl) {
      return "unconfigured";
    }

    try {
      const parsed = new URL(currentConfig.databaseUrl);
      const host = parsed.hostname || "host";
      const databaseName = parsed.pathname.replace(/^\/+/, "") || "db";
      return `${host}/${databaseName}`;
    } catch {
      return "configured";
    }
  }

  return currentConfig.databasePath || "local file";
}

function databaseBackupConfig(currentConfig) {
  return {
    enabled:
      Boolean(currentConfig.databaseEnabled) &&
      currentConfig.databaseProvider === "sqlite" &&
      Boolean(currentConfig.sqliteBackupEnabled),
    provider: currentConfig.databaseProvider,
    backup_dir:
      currentConfig.databaseProvider === "sqlite" && currentConfig.databaseEnabled
        ? currentConfig.sqliteBackupDir
        : null,
    interval_ms:
      currentConfig.databaseProvider === "sqlite" && currentConfig.databaseEnabled
        ? currentConfig.sqliteBackupIntervalMs
        : null,
    retention_count:
      currentConfig.databaseProvider === "sqlite" && currentConfig.databaseEnabled
        ? currentConfig.sqliteBackupRetentionCount
        : null,
    retention_days:
      currentConfig.databaseProvider === "sqlite" && currentConfig.databaseEnabled
        ? currentConfig.sqliteBackupRetentionDays
        : null,
    on_startup:
      currentConfig.databaseProvider === "sqlite" && currentConfig.databaseEnabled
        ? currentConfig.sqliteBackupOnStartup
        : null
  };
}

function clampSettingValue(value, spec) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid value for ${spec.env}`);
  }
  const bounded = Math.min(spec.max, Math.max(spec.min, numeric));
  return Number(bounded.toFixed(spec.digits));
}

function normalizeScreenerSettingValue(value, spec) {
  if (spec.type === "boolean") {
    return String(value).toLowerCase() === "true" || value === true;
  }

  return clampSettingValue(value, spec);
}

const RUNTIME_PROFILE_CONFIG_FIELDS = {
  API_SAVER_MODE: { key: "apiSaverMode", type: "boolean" },
  PI_PERFORMANCE_MODE: { key: "piPerformanceMode", type: "boolean" },
  DATABASE_ENABLED: { key: "databaseEnabled", type: "boolean" },
  LIGHTWEIGHT_STATE_ENABLED: { key: "lightweightStateEnabled", type: "boolean" },
  SQLITE_BACKUP_ENABLED: { key: "sqliteBackupEnabled", type: "boolean" },
  SQLITE_BACKUP_ON_STARTUP: { key: "sqliteBackupOnStartup", type: "boolean" },
  AGENCY_AUTONOMOUS_DATA_ENABLED: { key: "autonomousDataEnabled", type: "boolean" },
  LIVE_NEWS_ENABLED: { key: "liveNewsEnabled", type: "boolean" },
  AUTO_START_LIVE_NEWS: { key: "autoStartLiveNews", type: "boolean" },
  LIVE_NEWS_POLL_MS: { key: "liveNewsPollMs", type: "number" },
  LIVE_NEWS_MAX_ITEMS_PER_TICKER: { key: "liveNewsMaxItemsPerTicker", type: "number" },
  LIVE_NEWS_UNIVERSE_MODE: { key: "liveNewsUniverseMode", type: "string" },
  LIVE_NEWS_RSS_FALLBACK_MAX_TICKERS: { key: "liveNewsRssFallbackMaxTickers", type: "number" },
  LIVE_NEWS_API_FALLBACK_MAX_TICKERS: { key: "liveNewsApiFallbackMaxTickers", type: "number" },
  MARKETAUX_ENABLED: { key: "marketauxEnabled", type: "boolean" },
  MARKETAUX_SYMBOLS_PER_REQUEST: { key: "marketauxSymbolsPerRequest", type: "number" },
  MARKETAUX_MAX_REQUESTS_PER_POLL: { key: "marketauxMaxRequestsPerPoll", type: "number" },
  MARKETAUX_LIMIT_PER_REQUEST: { key: "marketauxLimitPerRequest", type: "number" },
  MARKET_DATA_PROVIDER: { key: "marketDataProvider", type: "string" },
  ALPACA_MARKET_DATA_ENABLED: { key: "alpacaMarketDataEnabled", type: "boolean" },
  ALPACA_MARKET_DATA_FEED: { key: "alpacaMarketDataFeed", type: "string" },
  MARKET_DATA_REFRESH_MS: { key: "marketDataRefreshMs", type: "number" },
  MARKET_FLOW_ENABLED: { key: "marketFlowEnabled", type: "boolean" },
  AUTO_START_MARKET_FLOW: { key: "autoStartMarketFlow", type: "boolean" },
  MARKET_FLOW_POLL_MS: { key: "marketFlowPollMs", type: "number" },
  MARKET_FLOW_MAX_TICKERS_PER_POLL: { key: "marketFlowMaxTickersPerPoll", type: "number" },
  EARNINGS_ENABLED: { key: "earningsEnabled", type: "boolean" },
  EARNINGS_PROVIDER: { key: "earningsProvider", type: "string" },
  EARNINGS_MAX_TICKERS_PER_POLL: { key: "earningsMaxTickersPerPoll", type: "number" },
  EARNINGS_POLL_MS: { key: "earningsPollMs", type: "number" },
  STOCKTWITS_ENABLED: { key: "stocktwitsEnabled", type: "boolean" },
  STOCKTWITS_POLL_MS: { key: "stocktwitsPollMs", type: "number" },
  STOCKTWITS_MAX_TICKERS_PER_POLL: { key: "stocktwitsMaxTickersPerPoll", type: "number" },
  TRADE_PRINTS_ENABLED: { key: "tradePrintsEnabled", type: "boolean" },
  TRADE_PRINTS_PROVIDER: { key: "tradePrintsProvider", type: "string" },
  TRADE_PRINTS_POLL_MS: { key: "tradePrintsPollMs", type: "number" },
  TRADE_PRINTS_MAX_TICKERS_PER_POLL: { key: "tradePrintsMaxTickersPerPoll", type: "number" },
  FUNDAMENTAL_MARKET_DATA_PROVIDER: { key: "fundamentalMarketDataProvider", type: "string" },
  AUTO_START_SECTOR_ETF_PROXIES: { key: "autoStartSectorEtfProxies", type: "boolean" },
  AUTO_START_FUNDAMENTAL_MARKET_DATA: { key: "autoStartFundamentalMarketData", type: "boolean" },
  FUNDAMENTAL_MARKET_DATA_REFRESH_MS: { key: "fundamentalMarketDataRefreshMs", type: "number" },
  FUNDAMENTAL_MARKET_DATA_MAX_COMPANIES_PER_POLL: { key: "fundamentalMarketDataMaxCompaniesPerPoll", type: "number" },
  FUNDAMENTAL_SEC_ENABLED: { key: "fundamentalSecEnabled", type: "boolean" },
  AUTO_START_SEC_FUNDAMENTALS: { key: "autoStartSecFundamentals", type: "boolean" },
  FUNDAMENTAL_SEC_BASELINE_POLL_MS: { key: "fundamentalSecBaselinePollMs", type: "number" },
  FUNDAMENTAL_SEC_CONCURRENCY: { key: "fundamentalSecConcurrency", type: "number" },
  FUNDAMENTAL_SEC_MAX_COMPANIES_PER_POLL: { key: "fundamentalSecMaxCompaniesPerPoll", type: "number" },
  SEC_FORM4_ENABLED: { key: "secForm4Enabled", type: "boolean" },
  AUTO_START_SEC_FORM4: { key: "autoStartSecForm4", type: "boolean" },
  SEC_FORM4_POLL_MS: { key: "secForm4PollMs", type: "number" },
  SEC_FORM4_MAX_TICKERS_PER_POLL: { key: "secForm4MaxTickersPerPoll", type: "number" },
  SEC_13F_ENABLED: { key: "sec13fEnabled", type: "boolean" },
  AUTO_START_SEC_13F: { key: "autoStartSec13f", type: "boolean" },
  SEC_REQUEST_RETRIES: { key: "secRequestRetries", type: "number" }
};

function coerceRuntimeProfileValue(value, type) {
  if (type === "boolean") {
    return String(value).toLowerCase() === "true";
  }
  if (type === "number") {
    return Number(value);
  }
  return String(value);
}

function summarizeRuntimeActionResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }

  if (result.universeName && result.counts) {
    return {
      universe_name: result.universeName,
      as_of: result.asOf || null,
      sources: result.sources || null,
      counts: result.counts
    };
  }

  const { companies, next_batch, pending_by_sector, live_preview, ...rest } = result;
  return {
    ...rest,
    companies_count: Array.isArray(companies) ? companies.length : undefined,
    next_batch_count: Array.isArray(next_batch) ? next_batch.length : undefined,
    pending_sector_count: Array.isArray(pending_by_sector) ? pending_by_sector.length : undefined,
    live_preview_count: Array.isArray(live_preview) ? live_preview.length : undefined
  };
}

function boundedFundamentalMarketDataLimit(requestedLimit = null) {
  const configuredCap = Math.max(0, Math.floor(Number(config.fundamentalMarketDataMaxCompaniesPerPoll || 0)));
  const requested = Math.max(0, Math.floor(Number(requestedLimit || 0)));

  if (!requested && configuredCap) {
    return configuredCap;
  }
  if (!requested) {
    return 0;
  }
  if (!configuredCap) {
    return requested;
  }
  return Math.min(requested, configuredCap);
}

function canonicalRuntimeSourceKey(source) {
  const providerTradePrints = config.tradePrintsProvider ? `${config.tradePrintsProvider}_trade_prints` : "";
  return {
    yahoo_earnings_calendar: "earnings_calendar",
    earnings: "earnings_calendar",
    stocktwits: "stocktwits_stream",
    massive_trade_prints: "trade_prints",
    polygon_trade_prints: "trade_prints",
    iex_trade_prints: "trade_prints",
    [providerTradePrints]: "trade_prints"
  }[source] || source;
}

function runtimeSourceStatusMap(workflowStatus = {}) {
  return new Map((workflowStatus.live_data?.sources || []).map((source) => [source.key, source]));
}

function sourceStatusIsFresh(source = null) {
  return Boolean(
    source &&
      source.status === "fresh" &&
      !source.fallback_mode &&
      !source.fallback_active &&
      source.status !== "fallback"
  );
}

function sourceStatusIsPolling(source = null) {
  return Boolean(source?.polling);
}

function timeoutError(label, timeoutMs) {
  const error = new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s. The provider may still be finishing in the background; refresh the Command Center in a moment.`);
  error.code = "AGENCY_ACTION_TIMEOUT";
  return error;
}

async function withAgencyActionTimeout(promise, label, timeoutMs) {
  const safeTimeout = Math.max(5000, Number(timeoutMs || 60000));
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(label, safeTimeout)), safeTimeout);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function persistEnvUpdates(filePath, updates) {
  const raw = await readFile(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const seen = new Set();
  const nextLines = lines.map((line) => {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      return line;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!(key in updates)) {
      return line;
    }

    seen.add(key);
    return `${key}=${updates[key]}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${value}`);
    }
  }

  await writeFile(filePath, nextLines.join("\n"), "utf8");
}

function buildWatchlistSnapshot(store, windowKey, filters = {}) {
  const fullFundamentalRows = trackedFundamentalCompanies(store);
  const fundamentalsByTicker = new Map(fullFundamentalRows.map((row) => [row.ticker, row]));
  const dedupedStates = new Map();
  const dedupedSectorStates = new Map();
  let latestMarketState = null;

  function isAtLeastAsFresh(current, previous) {
    return new Date(current?.as_of || 0).getTime() >= new Date(previous?.as_of || 0).getTime();
  }

  function rememberLatest(map, key, state) {
    const previous = map.get(key);
    if (!previous || isAtLeastAsFresh(state, previous)) {
      map.set(key, state);
    }
  }

  function resolveTickerMetadata(ticker, fundamentalsRow, sentimentState) {
    return {
      company_name: fundamentalsRow?.company_name || sentimentState?.entity_name || ticker,
      sector: fundamentalsRow?.sector || "Other",
      industry: fundamentalsRow?.industry || null
    };
  }

  function exposeFundamentalDecisionFields(fundamentalsRow) {
    if (!fundamentalsRow) {
      return {
        initial_screen: null,
        reason_codes: [],
        top_strengths: [],
        top_weaknesses: [],
        quality_flags: null,
        metric_snapshot: null,
        quality_score: null,
        growth_score: null,
        valuation_score: null,
        balance_sheet_score: null,
        efficiency_score: null,
        earnings_stability_score: null,
        sector_score: null,
        valuation_label: null,
        direction_label: null,
        reporting_confidence_score: null,
        data_freshness_score: null
      };
    }

    return {
      initial_screen: fundamentalsRow.initial_screen || null,
      reason_codes: fundamentalsRow.reason_codes || [],
      top_strengths: fundamentalsRow.top_strengths || [],
      top_weaknesses: fundamentalsRow.top_weaknesses || [],
      quality_flags: fundamentalsRow.quality_flags || null,
      metric_snapshot: fundamentalsRow.metric_snapshot || null,
      quality_score: fundamentalsRow.quality_score ?? null,
      growth_score: fundamentalsRow.growth_score ?? null,
      valuation_score: fundamentalsRow.valuation_score ?? null,
      balance_sheet_score: fundamentalsRow.balance_sheet_score ?? null,
      efficiency_score: fundamentalsRow.efficiency_score ?? null,
      earnings_stability_score: fundamentalsRow.earnings_stability_score ?? null,
      sector_score: fundamentalsRow.sector_score ?? null,
      valuation_label: fundamentalsRow.valuation_label || null,
      direction_label: fundamentalsRow.direction_label || null,
      reporting_confidence_score: fundamentalsRow.reporting_confidence_score ?? null,
      data_freshness_score: fundamentalsRow.data_freshness_score ?? null
    };
  }

  function exposeMarketReference(fundamentalsRow) {
    const reference = fundamentalsRow?.market_reference || null;
    if (!reference) {
      return { market_reference: null };
    }

    const normalizedReturn = normalizeReferenceReturn(reference, {
      maxAbsoluteReturn: 0.2
    });

    return {
      market_reference: {
        ticker: reference.ticker || fundamentalsRow.ticker,
        provider: reference.provider || null,
        live: Boolean(reference.live),
        partial_live: Boolean(reference.partial_live),
        as_of: reference.as_of || null,
        current_price: reference.current_price ?? null,
        absolute_change: reference.absolute_change ?? null,
        raw_percent_change: reference.percent_change ?? null,
        percent_change: normalizedReturn.value ?? reference.percent_change ?? null,
        percent_change_basis: normalizedReturn.basis,
        percent_change_warning: normalizedReturn.warning,
        market_cap: reference.market_cap ?? null,
        beta: reference.beta ?? null
      }
    };
  }

  for (const state of store.sentimentStates) {
    if (state.window !== windowKey) {
      continue;
    }
    if (!shouldUseEvidence({ published_at: state.as_of, source_type: "sentiment_state" }, config)) {
      continue;
    }
    if (state.entity_type === "ticker") {
      rememberLatest(dedupedStates, state.entity_key, state);
    } else if (state.entity_type === "sector") {
      rememberLatest(dedupedSectorStates, state.entity_key, state);
    } else if (state.entity_type === "market" && state.entity_key === "market") {
      if (!latestMarketState || isAtLeastAsFresh(state, latestMarketState)) {
        latestMarketState = state;
      }
    }
  }

  const allUniverseRows = fullFundamentalRows
    .map((fundamentalsRow) => {
      const sentimentState = dedupedStates.get(fundamentalsRow.ticker) || null;
      const metadata = resolveTickerMetadata(fundamentalsRow.ticker, fundamentalsRow, sentimentState);
      return {
        state_id: sentimentState?.state_id || null,
        entity_type: "ticker",
        entity_key: fundamentalsRow.ticker,
        entity_name: metadata.company_name,
        window: windowKey,
        as_of: sentimentState?.as_of || fundamentalsRow.as_of || store.health.lastUpdate,
        doc_count: sentimentState?.doc_count || 0,
        unique_story_count: sentimentState?.unique_story_count || 0,
        weighted_sentiment: sentimentState?.weighted_sentiment || 0,
        weighted_impact: sentimentState?.weighted_impact || 0,
        weighted_confidence: sentimentState?.weighted_confidence ?? 0,
        sentiment_confidence: sentimentState?.weighted_confidence ?? 0,
        story_velocity: sentimentState?.story_velocity || 0,
        momentum_delta: sentimentState?.momentum_delta || 0,
        event_concentration: sentimentState?.event_concentration || 0,
        source_diversity: sentimentState?.source_diversity || 0,
        sentiment_regime: sentimentState?.sentiment_regime || "neutral",
        top_event_types: sentimentState?.top_event_types || [],
        top_reasons: sentimentState?.top_reasons || [],
        state_metadata: sentimentState?.state_metadata || {},
        company_name: metadata.company_name,
        sector: metadata.sector,
        industry: metadata.industry,
        screen_stage: fundamentalsRow?.initial_screen?.stage || null,
        screen_provisional: Boolean(fundamentalsRow?.initial_screen?.provisional),
        composite_fundamental_score: fundamentalsRow?.composite_fundamental_score ?? null,
        fundamental_confidence: fundamentalsRow?.final_confidence ?? null,
        fundamental_rating: fundamentalsRow?.rating_label || null,
        fundamental_data_source: fundamentalsRow?.data_source || null,
        fundamental_direction_label: fundamentalsRow?.direction_label || null,
        ...exposeFundamentalDecisionFields(fundamentalsRow),
        ...exposeMarketReference(fundamentalsRow),
        sentiment_visible: Boolean(sentimentState)
      };
    })
    .concat(
      [...dedupedStates.values()]
        .filter((sentimentState) => !fundamentalsByTicker.has(sentimentState.entity_key))
        .map((sentimentState) => {
          const metadata = resolveTickerMetadata(sentimentState.entity_key, null, sentimentState);
          return {
            ...sentimentState,
            company_name: metadata.company_name,
            sector: metadata.sector,
            industry: metadata.industry,
            screen_stage: null,
            screen_provisional: false,
            composite_fundamental_score: null,
            fundamental_confidence: null,
            sentiment_confidence: sentimentState.weighted_confidence ?? 0,
            fundamental_rating: null,
            fundamental_data_source: null,
            fundamental_direction_label: null,
            ...exposeFundamentalDecisionFields(null),
            market_reference: null,
            sentiment_visible: true
          };
        })
    );

  const states = allUniverseRows
    .filter((state) => (filters.label ? state.sentiment_regime === filters.label : true))
    .filter((state) => (filters.minConfidence ? state.weighted_confidence >= filters.minConfidence : true))
    .filter((state) => (filters.screenStage ? state.screen_stage === filters.screenStage : true))
    .sort((a, b) => {
      const scoreA =
        Math.abs(Number(a.weighted_sentiment || 0)) * 3 +
        Number(a.weighted_confidence || 0) +
        Math.abs(Number(a.momentum_delta || 0)) * 2 +
        Math.min(2, Number(a.unique_story_count || 0) * 0.2) +
        (a.sentiment_visible ? 0.6 : 0);
      const scoreB =
        Math.abs(Number(b.weighted_sentiment || 0)) * 3 +
        Number(b.weighted_confidence || 0) +
        Math.abs(Number(b.momentum_delta || 0)) * 2 +
        Math.min(2, Number(b.unique_story_count || 0) * 0.2) +
        (b.sentiment_visible ? 0.6 : 0);
      return scoreB - scoreA || Number(b.composite_fundamental_score || 0) - Number(a.composite_fundamental_score || 0);
    });

  const summarizeScreenStages = (rows) => ({
    tracked: rows.length,
    eligible: rows.filter((row) => row.initial_screen?.stage === "eligible" || row.screen_stage === "eligible").length,
    watch: rows.filter((row) => row.initial_screen?.stage === "watch" || row.screen_stage === "watch").length,
    reject: rows.filter((row) => row.initial_screen?.stage === "reject" || row.screen_stage === "reject").length
  });

  const fullUniverseScreening = summarizeScreenStages(fullFundamentalRows);
  const allUniverseScreening = summarizeScreenStages(allUniverseRows);
  const visibleScreening = summarizeScreenStages(states);
  const sentimentVisibleScreening = summarizeScreenStages(allUniverseRows.filter((row) => row.sentiment_visible));
  const filteredSentimentVisibleScreening = summarizeScreenStages(states.filter((row) => row.sentiment_visible));

  const sectorStrength = buildSectorStrengthSnapshot(fullFundamentalRows, {
    sectorStates: [...dedupedSectorStates.values()],
    etfReferences: store.sectorEtfReferences,
    asOf: store.health.lastUpdate,
    window: windowKey,
    config
  });
  const sectorStrengthByKey = new Map(sectorStrength.sectors.map((sector) => [sector.entity_key, sector]));
  const sectors = [
    ...sectorStrength.sectors,
    ...[...dedupedSectorStates.values()].filter((sector) => !sectorStrengthByKey.has(sector.entity_key))
  ].sort((a, b) => {
    const aScoreAvailable = Number(Boolean(a.score_available));
    const bScoreAvailable = Number(Boolean(b.score_available));
    return (
      bScoreAvailable - aScoreAvailable ||
      Math.abs(Number(b.weighted_sentiment || 0)) - Math.abs(Number(a.weighted_sentiment || 0)) ||
      Number(b.weighted_confidence || 0) - Number(a.weighted_confidence || 0)
    );
  });

    return {
      as_of: store.health.lastUpdate,
      window: windowKey,
    market_pulse: latestMarketState || {
      weighted_sentiment: 0,
      weighted_confidence: 0,
      story_velocity: 0,
      sentiment_regime: "neutral"
    },
      leaderboard: states,
      screener_overview: {
        eligible: visibleScreening.eligible,
        watch: visibleScreening.watch,
        reject: visibleScreening.reject,
        filter: {
          label: filters.label || null,
          min_confidence: filters.minConfidence || null,
          screen_stage: filters.screenStage || null
        },
        full_universe: fullUniverseScreening,
        all_universe: allUniverseScreening,
        visible_universe: visibleScreening,
        filtered_universe: visibleScreening,
        sentiment_visible_universe: sentimentVisibleScreening,
        filtered_sentiment_visible_universe: filteredSentimentVisibleScreening,
        fundamental_sec_live: fullFundamentalRows.filter((row) => row.data_source === "live_sec_filing").length,
        pending_live_sec: Math.max(
          0,
          (store.fundamentalUniverse?.companies?.length || fullFundamentalRows.length) -
            fullFundamentalRows.filter((row) => row.data_source === "live_sec_filing").length
        )
      },
      sectors,
      sector_strength: sectorStrength.summary,
      alerts: buildActiveAlerts(store, 10),
    source_quality: [...store.sourceStats.values()].sort((a, b) => b.rolling_avg_confidence - a.rolling_avg_confidence)
  };
}

function summarizeQueueCompany(company) {
  return {
    ticker: company.ticker,
    company_name: company.company_name,
    sector: company.sector,
    industry: company.industry,
    data_source: company.data_source || null,
    screen_stage: company.initial_screen?.stage || null,
    screen_score: company.initial_screen?.score ?? null,
    screen_provisional: Boolean(company.initial_screen?.provisional),
    composite_fundamental_score: company.composite_fundamental_score ?? null,
    final_confidence: company.final_confidence ?? null,
    rating_label: company.rating_label || null,
    filing_date: company.filing_date || null,
    form_type: company.form_type || null
  };
}

function summarizePendingBySector(companies) {
  const counts = new Map();
  for (const company of companies) {
    const sector = company.sector || "Unknown";
    counts.set(sector, (counts.get(sector) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([sector, count]) => ({ sector, count }))
    .sort((a, b) => b.count - a.count || a.sector.localeCompare(b.sector));
}

function isLiveSecCompany(company) {
  return company?.data_source === "live_sec_filing";
}

function liveFundamentalRows(store) {
  return (store.fundamentals?.leaderboard || []).filter(isLiveSecCompany);
}

function allowedUniverseCompanies(store) {
  return store.fundamentalUniverse?.companies?.length
    ? store.fundamentalUniverse.companies
    : store.fundamentals?.leaderboard || [];
}

function trackedFundamentalCompanies(store) {
  const liveByTicker = new Map(liveFundamentalRows(store).map((company) => [company.ticker, company]));
  const universe = allowedUniverseCompanies(store);
  if (!universe.length) {
    return liveFundamentalRows(store);
  }

  return universe.map((company) => liveByTicker.get(company.ticker) || company);
}

function sectorEtfProxyCompanies() {
  return Object.entries(SECTOR_ETF_PROXIES).map(([sector, ticker]) => ({
    ticker,
    company_name: `${sector} Select Sector ETF proxy`,
    company: `${sector} Select Sector ETF proxy`,
    sector,
    industry: "Sector ETF Proxy",
    asset_type: "etf",
    sector_etf_proxy: true,
    metrics: {}
  }));
}

function activePollingFlag(source = {}, staleMs = 600_000) {
  if (!source.polling) {
    return false;
  }
  const lastPollTime = new Date(source.last_poll_at || 0).getTime();
  if (!Number.isFinite(lastPollTime) || lastPollTime <= 0) {
    return true;
  }
  return Date.now() - lastPollTime <= Math.max(60_000, Number(staleMs || 600_000));
}

function buildSecFundamentalsQueue(store, config, options = {}) {
  const parsedLimit = Math.floor(Number(options.limit || 20));
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(100, parsedLimit)) : 20;
  const companies = trackedFundamentalCompanies(store);
  const health = store.health.liveSources.sec_fundamentals || {};
  const liveCompanies = companies.filter(isLiveSecCompany);
  const pendingCompanies = companies.filter((company) => !isLiveSecCompany(company));
  const refreshCursor = Math.max(0, Math.floor(Number(health.refresh_cursor || 0)));
  const nextBatch = selectSecFundamentalsRefreshBatch(companies, config, refreshCursor);
  const configuredLimit = Number(config.fundamentalSecMaxCompaniesPerPoll || 0);
  const refreshLimit =
    Number(health.refresh_limit || 0) ||
    (configuredLimit > 0 ? Math.min(configuredLimit, companies.length) : companies.length);
  const polling = activePollingFlag(
    health,
    config.autoStartSecFundamentals
      ? Math.max(Number(config.fundamentalSecBaselinePollMs || 900_000), Number(config.secRequestTimeoutMs || 15_000) * Math.max(1, refreshLimit))
      : Math.max(120_000, Number(config.secRequestTimeoutMs || 15_000) * Math.max(1, refreshLimit))
  );

  return {
    as_of: store.health.lastUpdate,
    enabled: config.fundamentalSecEnabled,
    auto_start: config.autoStartSecFundamentals,
    tracked_companies: companies.length,
    live_sec_companies: liveCompanies.length,
    pending_live_sec_companies: pendingCompanies.length,
    coverage_ratio: companies.length ? round(liveCompanies.length / companies.length, 3) : 0,
    refresh_limit: refreshLimit,
    refresh_cursor: refreshCursor,
    next_batch_size: nextBatch.length,
    next_batch_preview_count: Math.min(limit, nextBatch.length),
    next_batch: nextBatch.slice(0, limit).map(summarizeQueueCompany),
    pending_by_sector: summarizePendingBySector(pendingCompanies),
    live_preview: liveCompanies.slice(0, limit).map(summarizeQueueCompany),
    polling,
    last_poll_at: health.last_poll_at || null,
    last_success_at: health.last_success_at || null,
    next_poll_at: health.next_poll_at || null,
    baseline_poll_ms: config.fundamentalSecBaselinePollMs,
    ongoing_poll_ms: config.fundamentalSecPollMs,
    current_poll_ms: pendingCompanies.length ? config.fundamentalSecBaselinePollMs : config.fundamentalSecPollMs,
    last_error: health.last_error || null,
    explanation:
      "SEC fundamentals refresh runs in bounded batches. Pending names are tracked only as allowed-universe metadata until live SEC filings create real fundamental rows."
  };
}

function refreshSecFundamentalsHealthPreview(store, config) {
  const companies = trackedFundamentalCompanies(store);
  const liveCompanies = companies.filter(isLiveSecCompany);
  const pendingCompanies = companies.filter((company) => !isLiveSecCompany(company));
  const existing = store.health.liveSources.sec_fundamentals || {};
  const refreshCursor = Math.max(0, Math.floor(Number(existing.refresh_cursor || 0)));
  const nextBatch = selectSecFundamentalsRefreshBatch(companies, config, refreshCursor);
  const configuredLimit = Number(config.fundamentalSecMaxCompaniesPerPoll || 0);
  const refreshLimit = companies.length
    ? configuredLimit > 0
      ? Math.min(Math.floor(configuredLimit), companies.length)
      : companies.length
    : null;

  store.health.liveSources.sec_fundamentals = {
    enabled: config.fundamentalSecEnabled,
    polling: activePollingFlag(
      existing,
      config.autoStartSecFundamentals
        ? Math.max(Number(config.fundamentalSecBaselinePollMs || 900_000), Number(config.secRequestTimeoutMs || 15_000) * Math.max(1, nextBatch.length || 1))
        : Math.max(120_000, Number(config.secRequestTimeoutMs || 15_000) * Math.max(1, nextBatch.length || 1))
    ),
    last_poll_at: existing.last_poll_at || null,
    last_success_at: existing.last_success_at || null,
    last_error: existing.last_error || null,
    polls: Number(existing.polls || 0),
    tracked_companies: companies.length,
    live_companies: liveCompanies.length,
    refresh_limit: refreshLimit,
    refresh_batch_size: existing.polling ? Number(existing.refresh_batch_size || 0) : nextBatch.length,
    refresh_cursor: refreshCursor,
    pending_live_sec_companies: pendingCompanies.length
  };

  return store.health.liveSources.sec_fundamentals;
}

async function buildTickerDetail(store, marketDataService, ticker) {
  const fundamentalsByTicker = new Map((store.fundamentals?.leaderboard || []).map((row) => [row.ticker, row]));
  const tickerMeta = lookupUniverseEntry(trackedFundamentalCompanies(store), ticker);
  const fundamentalRow = fundamentalsByTicker.get(ticker) || null;
  const windows = Object.fromEntries(
    ["15m", "1h", "4h", "1d", "7d"].map((windowKey) => {
      const state = store.sentimentStates.find(
        (item) => item.entity_type === "ticker" && item.entity_key === ticker && item.window === windowKey
      );
      return [
        windowKey,
        state
          ? {
              weighted_sentiment: state.weighted_sentiment,
              confidence: state.weighted_confidence,
              story_velocity: state.story_velocity
            }
          : { weighted_sentiment: 0, confidence: 0, story_velocity: 0 }
      ];
    })
  );

  const scoredDocs = store.documentScores
    .map((score) => {
      const normalized = store.normalizedDocuments.find((doc) => doc.doc_id === score.doc_id);
      return normalized?.primary_ticker === ticker ? { score, normalized } : null;
    })
    .filter(Boolean)
    .filter(({ normalized }) => shouldUseEvidence(normalized, config))
    .sort((a, b) => new Date(b.normalized.published_at) - new Date(a.normalized.published_at));

  if (!scoredDocs.length && !fundamentalRow && !tickerMeta) {
    return null;
  }

  const eventFamilyBreakdown = Object.entries(
    scoredDocs.reduce((acc, item) => {
      acc[item.score.event_family] = (acc[item.score.event_family] || 0) + 1;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value }));

  const sourceDistribution = Object.entries(
    scoredDocs.reduce((acc, item) => {
      acc[item.normalized.source_name] = (acc[item.normalized.source_name] || 0) + 1;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value }));

  const marketSeries = await marketDataService.getTickerSeries(ticker, scoredDocs, store.health.lastUpdate);

  return {
    ticker,
    company_name: fundamentalRow?.company_name || windows["1h"]?.entity_name || tickerMeta?.company || ticker,
    sector: fundamentalRow?.sector || tickerMeta?.sector || "Other",
    industry: fundamentalRow?.industry || tickerMeta?.industry || null,
    as_of: store.health.lastUpdate,
    windows,
    data_mode: scoredDocs.length ? "sentiment_and_market" : "fundamentals_only",
    top_events: scoredDocs.slice(0, 5).map(({ score, normalized }) => ({
      event_type: score.event_type,
      impact_score: score.impact_score,
      headline: normalized.headline,
      confidence: score.final_confidence
    })),
    regime: scoreToLabel(windows["1h"].weighted_sentiment),
    risk_flags: filterFreshEvidence(store.alertHistory, config).filter((alert) => alert.entity_key === ticker).map((alert) => alert.alert_type),
    recent_documents: scoredDocs.slice(0, 10).map(({ score, normalized }) => ({
      published_at: normalized.published_at,
      headline: normalized.headline,
      source_name: normalized.source_name,
      event_type: score.event_type,
      label: score.bullish_bearish_label,
      confidence: score.final_confidence,
      evidence_quality: score.evidence_quality || null,
      display_tier: score.display_tier || score.evidence_quality?.display_tier || null,
      downstream_weight: score.downstream_weight ?? score.evidence_quality?.downstream_weight ?? null,
      explanation_short: score.explanation_short,
      source_metadata: normalized.source_metadata || null,
      url: normalized.canonical_url
    })),
    price_history: marketSeries.price_history,
    sentiment_history: marketSeries.sentiment_history,
    market_snapshot: marketSeries.market_snapshot,
    source_distribution: sourceDistribution,
    event_family_breakdown: eventFamilyBreakdown
  };
}

function hasUsableDashboardData(store, windowKey = "1h") {
  return store.sentimentStates.some(
    (state) =>
      state.entity_type === "ticker" &&
      state.window === windowKey &&
      shouldUseEvidence({ published_at: state.as_of, source_type: "sentiment_state" }, config)
  );
}

function buildRecentDocuments(store, { ticker = null, limit = 20 } = {}) {
  return store.documentScores
    .map((score) => {
      const normalized = store.normalizedDocuments.find((doc) => doc.doc_id === score.doc_id);
      if (!normalized) {
        return null;
      }

      if (ticker && normalized.primary_ticker !== ticker) {
        return null;
      }

      if (!shouldUseEvidence(normalized, config)) {
        return null;
      }

      return {
        timestamp: score.scored_at,
        published_at: normalized.published_at,
        ticker: normalized.primary_ticker,
        headline: normalized.headline,
        source_name: normalized.source_name,
        event_type: score.event_type,
        label: score.bullish_bearish_label,
        sentiment_score: score.sentiment_score,
        impact_score: score.impact_score,
        confidence: score.final_confidence,
        evidence_quality: score.evidence_quality || null,
        display_tier: score.display_tier || score.evidence_quality?.display_tier || null,
        downstream_weight: score.downstream_weight ?? score.evidence_quality?.downstream_weight ?? null,
        explanation_short: score.explanation_short,
        url: sourceUrlFromNormalized(normalized),
        source_metadata: normalized.source_metadata || null
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.published_at || b.timestamp) - new Date(a.published_at || a.timestamp))
    .slice(0, limit);
}

function buildMoneyFlowDocuments(store, { ticker = null, limit = 30 } = {}) {
  return store.documentScores
    .map((score) => {
      const normalized = store.normalizedDocuments.find((doc) => doc.doc_id === score.doc_id);
      if (!normalized || !MONEY_FLOW_EVENT_TYPES.has(score.event_type)) {
        return null;
      }
      if (ticker && normalized.primary_ticker !== ticker) {
        return null;
      }
      if (!shouldUseEvidence(normalized, config)) {
        return null;
      }

      return {
        timestamp: score.scored_at,
        published_at: normalized.published_at,
        ticker: normalized.primary_ticker,
        headline: normalized.headline,
        source_name: normalized.source_name,
        source_type: normalized.source_type,
        event_type: score.event_type,
        label: score.bullish_bearish_label,
        sentiment_score: score.sentiment_score,
        impact_score: score.impact_score,
        confidence: score.final_confidence,
        evidence_quality: score.evidence_quality || null,
        display_tier: score.display_tier || score.evidence_quality?.display_tier || null,
        downstream_weight: score.downstream_weight ?? score.evidence_quality?.downstream_weight ?? null,
        explanation_short: score.explanation_short,
        url: sourceUrlFromNormalized(normalized),
        source_metadata: normalized.source_metadata || null
      };
    })
    .filter(Boolean)
    .filter((item) => item.display_tier !== "suppress")
    .sort((a, b) => new Date(b.published_at || b.timestamp) - new Date(a.published_at || a.timestamp))
    .slice(0, limit);
}

export function createSentimentApp() {
  const store = createStore(config);
  const persistence = createPersistence({ config });
  const persistenceReady = persistence.init();
  store.persistence = persistence;
  const pipeline = createPipeline(store);
  const providerQuota = createProviderQuotaManager({ config, store });
  const fundamentalMarketDataService = createFundamentalMarketDataService({ config, store, providerQuota });
  const fundamentals = createFundamentalsEngine({ store, config, marketReferenceService: fundamentalMarketDataService });
  const liveNewsCollector = createLiveNewsCollector({
    config,
    store,
    pipeline,
    providerQuota,
    getTrackedFundamentalCompanies: () => trackedFundamentalCompanies(store)
  });
  const marketDataService = createMarketDataService({ config, store, providerQuota });
  const trackedUniverse = { getTrackedFundamentalCompanies: () => trackedFundamentalCompanies(store) };
  const marketFlowMonitor = createMarketFlowMonitor({ config, store, pipeline, marketDataService, ...trackedUniverse });
  const secInsiderCollector = createSecInsiderCollector({ config, store, pipeline, ...trackedUniverse });
  const secInstitutionalCollector = createSecInstitutionalCollector({ config, store, pipeline, ...trackedUniverse });
  const corporateEventsCollector = createCorporateEventsCollector({ config, store, pipeline, providerQuota, ...trackedUniverse });
  const socialSentimentCollector = createSocialSentimentCollector({ config, store, pipeline, ...trackedUniverse });
  const tradePrintsCollector = createTradePrintsCollector({ config, store, pipeline, providerQuota, ...trackedUniverse });
  const uta = createUtaService({ config, store });

  async function loadFundamentalCoverage({ force = false } = {}) {
    const targetUniverse = await loadFundamentalUniverse({ config });
    const previousUniverse = store.fundamentalUniverse?.companies || [];
    store.fundamentalUniverse = targetUniverse;
    const liveCompanies = fundamentals
      .getTrackedCompanies()
      .filter(isLiveSecCompany)
      .filter((company) => targetUniverse.companies.some((universeCompany) => universeCompany.ticker === company.ticker));
    const trackedTickers = previousUniverse.map((company) => company.ticker).sort();
    const nextTickers = targetUniverse.companies.map((company) => company.ticker).sort();
    const sameUniverse =
      trackedTickers.length === nextTickers.length &&
      trackedTickers.every((ticker, index) => ticker === nextTickers[index]);
    const hadNonLiveFundamentals = fundamentals.getTrackedCompanies().some((company) => !isLiveSecCompany(company));

    store.health.liveSources.fundamental_universe = {
      enabled: true,
      last_loaded_at: new Date().toISOString(),
      universe_name: targetUniverse.universeName,
      tracked_companies: targetUniverse.counts.combined,
      sp100_constituents: targetUniverse.counts.sp100,
      qqq_constituents: targetUniverse.counts.qqq,
      sec_directory_source: targetUniverse.sources.sec_directory,
      sp100_source: targetUniverse.sources.sp100,
      qqq_source: targetUniverse.sources.qqq,
      live_fundamental_rows: liveCompanies.length,
      pending_live_sec_companies: Math.max(0, targetUniverse.companies.length - liveCompanies.length),
      non_live_fundamental_rows: 0,
      last_error: null
    };

    if (!force && sameUniverse && !hadNonLiveFundamentals) {
      return targetUniverse;
    }

    await fundamentals.replaceCompanies(liveCompanies, {
      asOf: targetUniverse.asOf,
      emitDiff: false
    });
    return targetUniverse;
  }

  async function ensureFundamentalCoverage({ force = false, minTrackedCompanies = 25 } = {}) {
    const trackedCompanies = fundamentals.getTrackedCompanies();
    const shouldLoadUniverse =
      force ||
      trackedCompanies.length < minTrackedCompanies ||
      !store.fundamentalUniverse?.companies?.length ||
      !store.health.liveSources.fundamental_universe;

    if (!shouldLoadUniverse) {
      return null;
    }

    try {
      return await loadFundamentalCoverage({ force });
    } catch (error) {
      store.health.liveSources.fundamental_universe = {
        enabled: true,
        last_loaded_at: new Date().toISOString(),
        tracked_companies: trackedCompanies.length,
        non_live_fundamental_rows: 0,
        last_error: error.message
      };
      console.error("Fundamental universe load failed:", error);
      return null;
    }
  }

  async function refreshSectorEtfReferences() {
    const proxies = sectorEtfProxyCompanies();
    const health = {
      enabled: true,
      provider: config.fundamentalMarketDataProvider,
      proxy_count: proxies.length,
      last_poll_at: new Date().toISOString(),
      last_success_at: null,
      last_error: null,
      refreshed_proxies: 0,
      available_proxies: store.sectorEtfReferences?.size || 0,
      fallback_active: false,
      notes: "Market Agent sector ETF proxies use current quote data when available, or the provider's latest close when markets are closed."
    };
    store.health.liveSources.sector_etf_proxies = health;

    try {
      const referenceMap = await fundamentalMarketDataService.getReferenceBatch(proxies, { force: true });
      store.sectorEtfReferences = new Map(
        [...referenceMap.entries()].filter(([, reference]) => reference?.live === true && reference?.provider !== "synthetic")
      );
      health.refreshed_proxies = referenceMap.size;
      health.available_proxies = store.sectorEtfReferences.size;
      health.last_success_at = new Date().toISOString();
      health.fallback_active = [...referenceMap.values()].some((reference) => reference?.provider === "synthetic" || reference?.live !== true);
      health.last_error =
        store.sectorEtfReferences.size === proxies.length
          ? null
          : `${proxies.length - store.sectorEtfReferences.size} ETF proxy reference(s) were unavailable or fallback.`;
      store.bus.emit("event", {
        type: "sector_etf_proxy_update",
        timestamp: health.last_success_at,
        proxy_count: proxies.length,
        available_proxies: store.sectorEtfReferences.size,
        provider: config.fundamentalMarketDataProvider
      });
      return {
        refreshed_proxies: referenceMap.size,
        available_proxies: store.sectorEtfReferences.size,
        proxies: [...store.sectorEtfReferences.entries()].map(([ticker, reference]) => ({
          ticker,
          provider: reference.provider,
          as_of: reference.as_of,
          percent_change: reference.percent_change
        }))
      };
    } catch (error) {
      health.last_error = error.message;
      throw error;
    }
  }

  async function refreshBackupStatus() {
    store.health.databaseBackup = await persistence.getBackupStatus();
    return store.health.databaseBackup;
  }

  const macroRegimeAgent = createMacroRegimeAgent({ store });
  const runtimeReliabilityAgent = createRuntimeReliabilityAgent({ config, store });
  const tradeSetupAgent = createTradeSetupAgent({
    store,
    getMacroRegime: (options = {}) => macroRegimeAgent.getMacroRegime(options),
    getRuntimeReliability: () => runtimeReliabilityAgent.getSnapshot()
  });
  const broker = config.brokerAdapter === "mcp"
    ? createAlpacaMcpBroker({ config })
    : createAlpacaBroker({ config });
  const riskAgent = createRiskAgent({
    config,
    broker,
    getRuntimeReliability: () => runtimeReliabilityAgent.getSnapshot()
  });
  const executionAgent = createExecutionAgent({
    config,
    broker,
    getTradeSetup: (ticker, options = {}) => tradeSetupAgent.getTickerSetup(ticker, options),
    evaluateRisk: (intent) => riskAgent.evaluateIntent(intent)
  });
  const positionMonitorAgent = createPositionMonitorAgent({
    broker,
    getTradeSetups: (options = {}) => tradeSetupAgent.getTradeSetups(options),
    getRiskSnapshot: () => riskAgent.getSnapshot(),
    getPortfolioPolicy: () => readPortfolioPolicy(config)
  });
  let finalSelectionCache = null;

  function finalSelectionCacheKey({ window, limit, minConviction }) {
    return [
      window || config.defaultWindow,
      Number(limit || 12),
      minConviction ?? "default",
      config.selectionWorkflowTestMode ? "test" : "production",
      config.llmSelectionEnabled ? "llm-on" : "llm-off",
      config.llmSelectionProvider,
      config.llmSelectionModel,
      config.llmSelectionMaxCandidates,
      config.llmSelectionMinConfidence,
      config.executionAllowShorts,
      config.brokerSubmitEnabled
    ].join("|");
  }

  async function buildFinalSelection(options = {}) {
    const window = options.window || config.defaultWindow;
    const limit = options.limit ? Number(options.limit) : 12;
    const minConviction = options.minConviction !== undefined ? Number(options.minConviction) : 0.35;
    const tradeSetups = tradeSetupAgent.getTradeSetups({
      window,
      limit: Math.max(limit * 3, 30),
      minConviction
    });
    const [riskSnapshot, positionMonitor] = await Promise.all([
      riskAgent.getSnapshot(),
      positionMonitorAgent.getSnapshot({
        window,
        limit: Math.max(limit * 2, 25)
      })
    ]);
    const portfolioPolicy = readPortfolioPolicy(config);
    const llmSelection = await buildLlmSelectionSnapshot({
      config,
      tradeSetups,
      portfolioPolicy,
      riskSnapshot,
      positionMonitor
    });
    const utaEvidenceByTicker = uta.getSupportingEvidenceForTickers(
      (tradeSetups.setups || []).map((setup) => setup.ticker)
    );

    const finalSelection = buildFinalSelectionSnapshot({
      config,
      tradeSetups,
      llmSelection,
      portfolioPolicy,
      riskSnapshot,
      positionMonitor,
      utaEvidenceByTicker,
      window,
      limit
    });
    rememberAgencyAudit(store, { llmSelection, finalSelection, riskSnapshot, positionMonitor });
    return finalSelection;
  }
  let humanApprovalAgent = null;
  const startupState = {
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    phase: "created",
    http_listening: false,
    initialized: false,
    live_sources_started: false,
    last_error: null
  };

  function updateStartupStatus(nextStatus = {}) {
    Object.assign(startupState, nextStatus, { updated_at: new Date().toISOString() });
    return startupState;
  }

  function getReadiness() {
    const ready = Boolean(startupState.http_listening && startupState.initialized);
    return {
      status: startupState.last_error ? "error" : ready ? "ready" : "starting",
      ready,
      ...startupState
    };
  }

  const app = {
    config,
    store,
    pipeline,
    persistence,
    async initialize() {
      await persistenceReady;
      await persistence.hydrateStore(store);
      await refreshBackupStatus();
      await ensureFundamentalCoverage();
    },
    async hasPersistedData() {
      await persistenceReady;
      return persistence.hasData();
    },
    hasDashboardData(windowKey = config.defaultWindow) {
      return hasUsableDashboardData(store, windowKey);
    },
    async reset() {
      await persistenceReady;
      resetStore(store);
      await persistence.clearAll();
    },
    async replay(options = {}) {
      const trackedCompaniesBeforeReplay =
        options.preserveFundamentals === false ? [] : fundamentals.getTrackedCompanies();
      const shouldPreserveFundamentalUniverse = trackedCompaniesBeforeReplay.length >= 25;
      const sentimentCount = await replaySampleEvents(this, options);
      let fundamentalCount = store.fundamentals.leaderboard.length;

      if (shouldPreserveFundamentalUniverse) {
        if (options.reset || fundamentalCount < trackedCompaniesBeforeReplay.length) {
          fundamentalCount = await fundamentals.replaceCompanies(trackedCompaniesBeforeReplay, {
            asOf: new Date().toISOString(),
            emitDiff: false
          });
        }
      } else if (!options.skipFundamentals) {
        fundamentalCount = await fundamentals.replaySample({
          intervalMs: options.intervalMs ? Math.max(0, Math.floor(options.intervalMs / 2)) : 0
        });
      }

      await persistence.saveStoreSnapshot(store);
      return { sentimentCount, fundamentalCount };
    },
    async loadFundamentalCoverage(options = {}) {
      await persistenceReady;
      return loadFundamentalCoverage(options);
    },
    getConfig() {
      return {
        app_name: "Sentiment Analyst",
        companion_dashboard: "/fundamentals.html",
        pi_performance_mode: config.piPerformanceMode,
        database_enabled: config.databaseEnabled,
        database_provider: config.databaseProvider,
        database_target: databaseTargetLabel(config),
        lightweight_state_enabled: config.lightweightStateEnabled,
        lightweight_state_path: config.lightweightStatePath,
        database_backup: databaseBackupConfig(config),
        api_saver_mode: config.apiSaverMode,
        universe_name: config.universeName,
        default_window: config.defaultWindow,
        windows: ["15m", "1h", "4h", "1d", "7d"],
        signal_freshness_max_hours: config.signalFreshnessMaxHours,
        active_alert_freshness_max_hours: config.activeAlertFreshnessMaxHours,
        agency_cadence: {
          initial_baseline_cycle_ms: config.agencyInitialBaselineCycleMs,
          ongoing_cycle_ms: config.agencyOngoingCycleMs,
          baseline_universe_min_count: config.agencyBaselineUniverseMinCount,
          baseline_require_full_sec: config.agencyBaselineRequireFullSec,
          baseline_min_sec_coverage_pct: config.agencyBaselineMinSecCoveragePct,
          baseline_min_signal_sources: config.agencyBaselineMinSignalSources,
          baseline_sec_batches_per_run: config.agencyBaselineSecBatchesPerRun,
          action_timeout_ms: config.agencyCycleActionTimeoutMs,
          recommended: [
            "Initial baseline cycle: every 5 minutes until all required agents are baseline-ready.",
            "Ongoing agency cycle: every 15 minutes during market hours.",
            "SEC fundamentals baseline catch-up: several bounded batches per baseline run, then every 6 hours after coverage is complete.",
            "Market/news/signals: refresh on their configured source intervals, with paper execution gated when live pricing is not confirmed."
          ]
        },
        seed_data_on_empty: config.seedDataOnEmpty,
        seed_data_in_decisions: config.seedDataInDecisions,
        live_news_enabled: config.liveNewsEnabled,
        auto_start_live_news: config.autoStartLiveNews,
        live_news_universe_mode: config.liveNewsUniverseMode,
        live_news_rss_fallback_max_tickers: config.liveNewsRssFallbackMaxTickers,
        marketaux_enabled: config.marketauxEnabled,
        marketaux_configured: Boolean(config.marketauxApiKey),
        marketaux_symbols_per_request: config.marketauxSymbolsPerRequest,
        marketaux_max_requests_per_poll: config.marketauxMaxRequestsPerPoll,
        marketaux_limit_per_request: config.marketauxLimitPerRequest,
        autonomous_data_enabled: config.autonomousDataEnabled,
        credential_warnings: config.credentialWarnings || [],
        market_data_provider: config.marketDataProvider,
        market_flow_max_tickers_per_poll: config.marketFlowMaxTickersPerPoll,
        alpaca_market_data_enabled: config.alpacaMarketDataEnabled,
        alpaca_market_data_configured: Boolean(config.alpacaMarketDataApiKeyId && config.alpacaMarketDataApiSecretKey),
        alpaca_market_data_feed: config.alpacaMarketDataFeed,
        market_flow_enabled: config.marketFlowEnabled,
        auto_start_market_flow: config.autoStartMarketFlow,
        market_flow_settings: readMarketFlowSettings(config),
        screener_settings: readScreenerSettings(config),
        fundamental_screener_governance: buildFundamentalResearchGovernance(readScreenerSettings(config)),
        portfolio_policy_settings: readPortfolioPolicy(config),
        selection_workflow_test_mode: config.selectionWorkflowTestMode,
        selection_workflow_test_thresholds: {
          deterministic_long: config.selectionWorkflowTestLongThreshold,
          deterministic_short: config.selectionWorkflowTestShortThreshold,
          direction_gap: config.selectionWorkflowTestDirectionGap,
          watch: config.selectionWorkflowTestWatchThreshold,
          final_conviction: config.selectionWorkflowTestFinalConviction,
          llm_min_confidence: config.selectionWorkflowTestLlmMinConfidence,
          max_runtime_penalty: config.selectionWorkflowTestMaxRuntimePenalty,
          max_risk_penalty: config.selectionWorkflowTestMaxRiskPenalty,
          allow_llm_demotion_preview: config.selectionWorkflowTestAllowLlmDemotionPreview
        },
        trust_gates: {
          selection_min_signal_evidence_items: config.selectionMinSignalEvidenceItems,
          selection_min_signal_evidence_sources: config.selectionMinSignalEvidenceSources,
          macro_min_sector_signals: config.macroMinSectorSignals,
          macro_min_ticker_signals: config.macroMinTickerSignals,
          macro_min_recent_events: config.macroMinRecentEvents,
          macro_min_recent_sources: config.macroMinRecentSources
        },
        llm_selection: {
          enabled: config.llmSelectionEnabled,
          provider: config.llmSelectionProvider,
          model: config.llmSelectionModel,
          configured: Boolean(config.llmSelectionApiUrl && config.llmSelectionApiKey),
          min_confidence: config.llmSelectionMinConfidence,
          max_candidates: config.llmSelectionMaxCandidates,
          request_timeout_ms: config.llmSelectionRequestTimeoutMs,
          cache_ms: config.llmSelectionCacheMs
        },
        fundamental_market_data_provider: config.fundamentalMarketDataProvider,
        auto_start_sector_etf_proxies: config.autoStartSectorEtfProxies,
        auto_start_fundamental_market_data: config.autoStartFundamentalMarketData,
        fundamental_market_data_max_companies_per_poll: config.fundamentalMarketDataMaxCompaniesPerPoll,
        sector_etf_proxies: SECTOR_ETF_PROXIES,
        sector_etf_proxy_provider: config.fundamentalMarketDataProvider,
        fundamental_sec_enabled: config.fundamentalSecEnabled,
        fundamental_sec_max_companies_per_poll: config.fundamentalSecMaxCompaniesPerPoll,
        fundamental_sec_baseline_poll_ms: config.fundamentalSecBaselinePollMs,
        auto_start_sec_fundamentals: config.autoStartSecFundamentals,
        sec_form4_enabled: config.secForm4Enabled,
        auto_start_sec_form4: config.autoStartSecForm4,
        sec_form4_max_tickers_per_poll: config.secForm4MaxTickersPerPoll,
        sec_13f_enabled: config.sec13fEnabled,
        auto_start_sec_13f: config.autoStartSec13f,
        earnings_enabled: config.earningsEnabled || config.autonomousDataEnabled,
        earnings_provider: config.earningsProvider,
        earnings_max_tickers_per_poll: config.earningsMaxTickersPerPoll,
        stocktwits_enabled: config.stocktwitsEnabled,
        stocktwits_max_tickers_per_poll: config.stocktwitsMaxTickersPerPoll,
        trade_prints_enabled: config.tradePrintsEnabled,
        trade_prints_provider: config.tradePrintsProvider,
        trade_prints_max_tickers_per_poll: config.tradePrintsMaxTickersPerPoll,
        broker_adapter: config.brokerAdapter,
        broker_trading_mode: config.brokerTradingMode,
        broker_submit_enabled: config.brokerSubmitEnabled,
        execution: executionAgent.getStatus(),
        risk: {
          max_gross_exposure_pct: config.riskMaxGrossExposurePct,
          max_single_name_exposure_pct: config.riskMaxSingleNameExposurePct,
          max_open_orders: config.riskMaxOpenOrders,
          block_when_runtime_constrained: config.riskBlockWhenRuntimeConstrained
        },
        fundamentals_enabled: true
      };
    },
    getHealth() {
      refreshSecFundamentalsHealthPreview(store, config);
      const runtimeReliability = runtimeReliabilityAgent.getSnapshot();
      return {
        status: store.health.systemStatus,
        readiness: getReadiness(),
        last_update: store.health.lastUpdate,
        queue_depth: store.health.queueDepth,
        llm_latency_ms: store.health.llmLatencyMs,
        documents_processed_today: store.health.documentsProcessedToday,
        fundamental_companies_scored: store.health.fundamentalCompaniesScored,
        fundamental_sectors_covered: store.health.fundamentalSectorsCovered,
        active_sources: store.sourceStats.size,
        live_sources: store.health.liveSources,
        database_backup: store.health.databaseBackup,
        evidence_quality: pipeline.evidenceQualityAgent.getSnapshot({ limit: 0 }).summary || null,
        runtime_reliability: {
          status: runtimeReliability.status,
          summary: runtimeReliability.summary,
          pressure: runtimeReliability.pressure,
          source_counts: runtimeReliability.source_counts,
          collector_plan: runtimeReliability.collector_plan
        },
        uta: {
          status: "replay_ready",
          provider_status: uta.getProviderStatus(),
          runtime: uta.getRuntimeStatus()
        }
      };
    },
    getPerformance() {
      return buildPerformanceSnapshot(config, store);
    },
    setStartupStatus(nextStatus = {}) {
      return updateStartupStatus(nextStatus);
    },
    getReadiness() {
      return getReadiness();
    },
    getRuntimeReliability() {
      refreshSecFundamentalsHealthPreview(store, config);
      return runtimeReliabilityAgent.getSnapshot();
    },
    getSecFundamentalsQueue(options = {}) {
      refreshSecFundamentalsHealthPreview(store, config);
      return buildSecFundamentalsQueue(store, config, options);
    },
    async runRuntimeReliabilityAction(payload = {}) {
      await persistenceReady;
      const action = String(payload.action || "snapshot").trim();
      const source = String(payload.source || "").trim();
      const forceUniverse = Boolean(payload.forceUniverse || payload.force_universe);
      const profileKey = String(payload.profile || "").trim();
      const applyProfile = Boolean(payload.apply);
      const earningsEnabled = Boolean(config.earningsEnabled || config.autonomousDataEnabled);
      const stocktwitsEnabled = Boolean(config.stocktwitsEnabled);
      const tradePrintsEnabled = Boolean(config.tradePrintsEnabled);

      const disabledSources = {
        live_news: !config.liveNewsEnabled,
        market_flow: !config.marketFlowEnabled,
        earnings_calendar: !earningsEnabled,
        yahoo_earnings_calendar: !earningsEnabled,
        earnings: !earningsEnabled,
        stocktwits_stream: !stocktwitsEnabled,
        stocktwits: !stocktwitsEnabled,
        trade_prints: !tradePrintsEnabled,
        massive_trade_prints: !tradePrintsEnabled,
        polygon_trade_prints: !tradePrintsEnabled,
        iex_trade_prints: !tradePrintsEnabled,
        [`${config.tradePrintsProvider}_trade_prints`]: !tradePrintsEnabled,
        sec_form4: !config.secForm4Enabled,
        sec_13f: !config.sec13fEnabled,
        sec_fundamentals: !config.fundamentalSecEnabled,
        lightweight_state: config.databaseEnabled || !config.lightweightStateEnabled,
        database_backup: !config.databaseEnabled || config.databaseProvider !== "sqlite" || !config.sqliteBackupEnabled,
        sector_etf_proxies: false,
        uta: false
      };

      function assertSourceEnabled(key) {
        if (disabledSources[key]) {
          throw new Error(`${key} is disabled by configuration. Enable it in .env before running this action.`);
        }
      }

      let result = null;

      if (action === "snapshot") {
        result = { message: "Runtime reliability snapshot refreshed." };
      } else if (action === "apply_profile") {
        const profile = RUNTIME_PROFILES[profileKey];
        if (!profile) {
          throw new Error(`Unsupported runtime profile: ${profileKey}`);
        }

        if (applyProfile) {
          await persistEnvUpdates(config.envPath, profile.env);
          for (const [envKey, envValue] of Object.entries(profile.env)) {
            const spec = RUNTIME_PROFILE_CONFIG_FIELDS[envKey];
            if (spec) {
              config[spec.key] = coerceRuntimeProfileValue(envValue, spec.type);
            }
          }
        }

        result = {
          profile: profileKey,
          applied: applyProfile,
          env_updates: profile.env,
          message: applyProfile
            ? `${profile.label} profile was written to .env. Restart the service for timers and startup policy to fully reload.`
            : `${profile.label} profile preview only. Send apply=true to write these values to .env.`
        };
      } else if (action === "refresh_universe") {
        result = await ensureFundamentalCoverage({ force: true });
      } else if (action === "save_lightweight_state") {
        assertSourceEnabled("lightweight_state");
        await persistence.saveStoreSnapshot(store);
        await refreshBackupStatus();
        result = {
          saved: true,
          status: store.health.databaseBackup
        };
      } else if (action === "backup_now") {
        assertSourceEnabled("database_backup");
        result = await persistence.backupNow({ reason: "runtime_reliability_manual" });
        await refreshBackupStatus();
      } else if (action === "poll_once") {
        if (!source) {
          throw new Error("poll_once requires a source.");
        }

        const canonicalSource = {
          yahoo_earnings_calendar: "earnings_calendar",
          earnings: "earnings_calendar",
          stocktwits: "stocktwits_stream",
          massive_trade_prints: "trade_prints",
          polygon_trade_prints: "trade_prints",
          iex_trade_prints: "trade_prints",
          [`${config.tradePrintsProvider}_trade_prints`]: "trade_prints"
        }[source] || source;

        if (canonicalSource === "live_news") {
          assertSourceEnabled(canonicalSource);
          result = await liveNewsCollector.pollOnce();
        } else if (canonicalSource === "market_flow") {
          assertSourceEnabled(canonicalSource);
          result = await marketFlowMonitor.pollOnce();
        } else if (canonicalSource === "earnings_calendar") {
          assertSourceEnabled(canonicalSource);
          result = await corporateEventsCollector.pollOnce();
        } else if (canonicalSource === "stocktwits_stream") {
          assertSourceEnabled(canonicalSource);
          result = await socialSentimentCollector.pollOnce();
        } else if (canonicalSource === "trade_prints") {
          assertSourceEnabled(canonicalSource);
          result = await tradePrintsCollector.pollOnce();
        } else if (canonicalSource === "sec_form4") {
          assertSourceEnabled(canonicalSource);
          result = await secInsiderCollector.pollOnce();
        } else if (canonicalSource === "sec_13f") {
          assertSourceEnabled(canonicalSource);
          result = await secInstitutionalCollector.pollOnce();
        } else if (canonicalSource === "sec_fundamentals") {
          assertSourceEnabled(canonicalSource);
          await ensureFundamentalCoverage({ force: forceUniverse });
          result = await secFundamentalsCollector.pollOnce();
        } else if (canonicalSource === "fundamental_market_data") {
          const requestedLimit = Math.max(0, Math.floor(Number(payload.limit || payload.company_limit || 0)));
          const limit = boundedFundamentalMarketDataLimit(requestedLimit);
          const companies = limit ? fundamentals.getTrackedCompanies().slice(0, limit) : fundamentals.getTrackedCompanies();
          const referenceMap = await fundamentalMarketDataService.getReferenceBatch(companies);
          const refreshed = await fundamentals.refreshMarketReference(referenceMap);
          result = {
            refreshed_companies: refreshed,
            reference_count: referenceMap.size,
            limited: Boolean(limit),
            requested_limit: requestedLimit || null,
            effective_limit: limit || null,
            provider_cap: config.fundamentalMarketDataMaxCompaniesPerPoll || null
          };
        } else if (canonicalSource === "sector_etf_proxies") {
          result = await refreshSectorEtfReferences();
        } else if (canonicalSource === "fundamental_universe") {
          result = await ensureFundamentalCoverage({ force: true });
        } else if (canonicalSource === "uta") {
          result = await uta.runCycle({
            mode: payload.mode || "single",
            tickers: payload.tickers || [payload.ticker || "AVGO"],
            query: payload.query || {},
            body: payload.body || payload,
            reason: "runtime_reliability_manual"
          });
        } else {
          throw new Error(`Unsupported runtime source: ${source}`);
        }
      } else if (action === "uta_cycle") {
        result = await uta.runCycle({
          mode: payload.mode || "single",
          tickers: payload.tickers || [payload.ticker || "AVGO"],
          query: payload.query || {},
          body: payload.body || payload,
          reason: "runtime_reliability_manual"
        });
      } else if (action === "uta_revalidate") {
        result = await uta.revalidate(payload);
      } else {
        throw new Error(`Unsupported runtime action: ${action}`);
      }

      const shouldAutoSaveLightweightState =
        config.lightweightStateEnabled &&
        !config.databaseEnabled &&
        !["snapshot", "apply_profile", "save_lightweight_state", "backup_now"].includes(action);

      if (shouldAutoSaveLightweightState) {
        await persistence.saveStoreSnapshot(store);
        await refreshBackupStatus();
        result = {
          ...(result && typeof result === "object" && !Array.isArray(result) ? result : { value: result }),
          lightweight_state_saved: true,
          lightweight_state_status: store.health.databaseBackup
        };
      }

      return {
        ok: true,
        action,
        source: source || null,
        result,
        runtime_reliability: runtimeReliabilityAgent.getSnapshot(),
        health: this.getHealth()
      };
    },
    getWatchlistSnapshot(windowKey, filters) {
      return buildWatchlistSnapshot(store, windowKey, filters);
    },
    async getTickerDetail(ticker) {
      return buildTickerDetail(store, marketDataService, ticker);
    },
    runUtaCycle(payload = {}) {
      return uta.runCycle({
        mode: payload.mode || "single",
        tickers: payload.tickers || [payload.ticker || "AVGO"],
        query: payload.query || {},
        body: payload.body || payload,
        reason: payload.reason || "api_manual"
      });
    },
    revalidateUta(payload = {}) {
      return uta.revalidate(payload);
    },
    getUtaSingle(ticker) {
      return uta.getSingleAnalysis(ticker);
    },
    getUtaPortfolio(payload = {}) {
      return uta.getPortfolioAnalysis(payload);
    },
    getUtaScan(query = {}) {
      return uta.getScan(query);
    },
    runUtaScanPass2(payload = {}) {
      return uta.runScanPass2(payload);
    },
    getUtaUniverses() {
      return uta.getUniverses();
    },
    getUtaLaneStates() {
      return uta.getLaneStates();
    },
    refreshUtaLane(laneId) {
      return uta.refreshLane(laneId);
    },
    getUtaUserState(scope = "") {
      return uta.getUserState(scope);
    },
    updateUtaUserState(scope = "", updates = {}) {
      return uta.updateUserState(scope, updates);
    },
    getUtaHistory(options = {}) {
      return uta.getHistory(options);
    },
    getUtaRuntimeStatus() {
      return uta.getRuntimeStatus();
    },
    getUtaScheduler() {
      return uta.getScheduler();
    },
    updateUtaScheduler(updates = {}) {
      return uta.updateScheduler(updates);
    },
    getUtaProviderStatus() {
      return uta.getProviderStatus();
    },
    runUtaProviderPreflight(payload = {}) {
      return uta.runProviderPreflight(payload);
    },
    getUtaSupportingEvidenceForTickers(tickers = []) {
      return uta.getSupportingEvidenceForTickers(tickers);
    },
    getMarketFlowSettings() {
      return readMarketFlowSettings(config);
    },
    getScreenerSettings() {
      const settings = readScreenerSettings(config);
      return {
        settings,
        fields: Object.entries(FUNDAMENTAL_SCREENER_FIELDS).map(([key, spec]) => ({
          key,
          type: spec.type,
          label: spec.label,
          help: spec.help,
          min: spec.min ?? null,
          max: spec.max ?? null,
          step: spec.step ?? null
        })),
        governance: buildFundamentalResearchGovernance(settings)
      };
    },
    getPortfolioPolicySettings() {
      return {
        settings: readPortfolioPolicy(config),
        fields: Object.entries(PORTFOLIO_POLICY_FIELDS).map(([key, spec]) => ({
          key,
          type: spec.type,
          label: spec.label,
          help: spec.help,
          min: spec.min ?? null,
          max: spec.max ?? null,
          step: spec.step ?? null
        }))
      };
    },
    async updateMarketFlowSettings(nextSettings, { persist = true } = {}) {
      const updates = {};

      for (const [key, spec] of Object.entries(MARKET_FLOW_SETTINGS_FIELDS)) {
        if (!(key in nextSettings)) {
          continue;
        }
        updates[key] = clampSettingValue(nextSettings[key], spec);
      }

      Object.assign(config, updates);

      if (persist && Object.keys(updates).length) {
        const envUpdates = Object.entries(updates).reduce((acc, [key, value]) => {
          acc[MARKET_FLOW_SETTINGS_FIELDS[key].env] = value;
          return acc;
        }, {});
        await persistEnvUpdates(config.envPath, envUpdates);
      }

      store.bus.emit("event", {
        type: "snapshot",
        timestamp: new Date().toISOString(),
        settings_scope: "market_flow"
      });
      await persistenceReady;
      await persistence.saveStoreSnapshot(store);

      return readMarketFlowSettings(config);
    },
    async updateScreenerSettings(nextSettings, { persist = true } = {}) {
      const profileKey = String(nextSettings.profile || nextSettings.profile_key || "").trim();
      const profileSettings = profileKey ? settingsForFundamentalProfile(profileKey) : null;
      if (profileKey && !profileSettings) {
        throw new Error(`Unsupported fundamental screener profile: ${profileKey}`);
      }
      const requestedSettings = {
        ...(profileSettings || {}),
        ...nextSettings
      };
      const updates = {};

      for (const [key, spec] of Object.entries(FUNDAMENTAL_SCREENER_FIELDS)) {
        if (!(key in requestedSettings)) {
          continue;
        }
        updates[key] = normalizeScreenerSettingValue(requestedSettings[key], spec);
      }

      Object.assign(config, updates);

      if (persist && Object.keys(updates).length) {
        const envUpdates = Object.entries(updates).reduce((acc, [key, value]) => {
          acc[FUNDAMENTAL_SCREENER_FIELDS[key].env] =
            FUNDAMENTAL_SCREENER_FIELDS[key].type === "boolean" ? String(value) : value;
          return acc;
        }, {});
        await persistEnvUpdates(config.envPath, envUpdates);
      }

      if (store.fundamentals?.asOf && fundamentals.getTrackedCompanies().length) {
        await fundamentals.replaceCompanies(fundamentals.getTrackedCompanies(), {
          asOf: new Date().toISOString(),
          emitDiff: true
        });
      }

      return this.getScreenerSettings();
    },
    async updatePortfolioPolicySettings(nextSettings, { persist = true } = {}) {
      const updates = normalizePortfolioPolicyUpdates(nextSettings);

      Object.assign(config, updates);

      if (persist && Object.keys(updates).length) {
        await persistEnvUpdates(config.envPath, portfolioPolicyEnvUpdates(updates));
      }

      store.bus.emit("event", {
        type: "snapshot",
        timestamp: new Date().toISOString(),
        settings_scope: "portfolio_policy"
      });
      await persistenceReady;
      await persistence.saveStoreSnapshot(store);

      return this.getPortfolioPolicySettings();
    },
    getSectorDetail(sector) {
      const windows = ["15m", "1h", "4h", "1d", "7d"].reduce((acc, windowKey) => {
        const state = store.sentimentStates
          .filter((item) => item.entity_type === "sector" && item.entity_key === sector && item.window === windowKey)
          .sort((a, b) => new Date(b.as_of || 0) - new Date(a.as_of || 0))[0];
        acc[windowKey] = state || null;
        return acc;
      }, {});
      const sectorStrength = buildSectorStrengthSnapshot(trackedFundamentalCompanies(store), {
        sectorStates: Object.values(windows).filter(Boolean),
        etfReferences: store.sectorEtfReferences,
        asOf: store.health.lastUpdate,
        window: config.defaultWindow,
        config
      }).sectors.find((item) => item.entity_key === sector) || null;

      if (!Object.values(windows).some(Boolean) && !sectorStrength) {
        return null;
      }

      return {
        sector,
        as_of: store.health.lastUpdate,
        windows,
        sector_strength: sectorStrength?.sector_strength || null
      };
    },
    getRecentDocuments(params) {
      return buildRecentDocuments(store, params);
    },
    getMoneyFlowSignals(params = {}) {
      return buildMoneyFlowDocuments(store, {
        ticker: params.ticker ? String(params.ticker).toUpperCase() : null,
        limit: params.limit ? Number(params.limit) : 30
      });
    },
    getEarningsCalendar() {
      return Object.fromEntries(store.earningsCalendar);
    },
    getHighImpactEvents(limit = 10) {
      return buildRecentDocuments(store, { limit: 100 })
        .filter((item) => item.confidence >= 0.7 && Math.abs(item.sentiment_score) >= 0.4)
        .filter((item) => item.display_tier !== "suppress")
        .slice(0, limit);
    },
    getEvidenceQuality(options = {}) {
      return pipeline.evidenceQualityAgent.getSnapshot(options);
    },
    getFundamentalsSnapshot(filters) {
      return fundamentals.getSnapshot(filters);
    },
    getFundamentalsTickerDetail(ticker) {
      return fundamentals.getTickerDetail(ticker);
    },
    getFundamentalsSectorDetail(sector) {
      return fundamentals.getSectorDetail(sector);
    },
    getFundamentalsChanges(limit) {
      return fundamentals.getChanges(limit);
    },
    getFundamentalBacktest(options = {}) {
      return buildFundamentalBacktestSnapshot({
        config,
        store,
        horizonDays: options.horizonDays || options.horizon_days,
        minSample: options.minSample || options.min_sample,
        allowSyntheticPrices:
          options.allowSyntheticPrices === true ||
          options.allow_synthetic_prices === true ||
          String(options.allowSyntheticPrices || options.allow_synthetic_prices || "").toLowerCase() === "true"
      });
    },
    getMacroRegime(options = {}) {
      return macroRegimeAgent.getMacroRegime(options);
    },
    getMacroRegimeHistory(limit = 20) {
      return store.macroRegimeHistory.slice(0, limit);
    },
    async getPortfolioPolicy() {
      const riskSnapshot = await riskAgent.getSnapshot();
      const positionMonitor = await positionMonitorAgent.getSnapshot({
        window: config.defaultWindow,
        limit: 25
      });
      return buildPortfolioPolicySnapshot({
        config,
        riskSnapshot,
        positionMonitor
      });
    },
    getTradeSetups(options = {}) {
      return tradeSetupAgent.getTradeSetups(options);
    },
    getTradeSetupTicker(ticker, options = {}) {
      return tradeSetupAgent.getTickerSetup(ticker, options);
    },
    async getFinalSelection(options = {}) {
      const window = options.window || config.defaultWindow;
      const limit = options.limit ? Number(options.limit) : 12;
      const minConviction = options.minConviction !== undefined ? Number(options.minConviction) : 0.35;
      const cacheKey = finalSelectionCacheKey({ window, limit, minConviction });
      const nowMs = Date.now();

      if (
        finalSelectionCache?.key === cacheKey &&
        finalSelectionCache.value &&
        nowMs - finalSelectionCache.resolvedAt < FINAL_SELECTION_CACHE_TTL_MS
      ) {
        return finalSelectionCache.value;
      }

      if (finalSelectionCache?.key === cacheKey && finalSelectionCache.promise) {
        return finalSelectionCache.promise;
      }

      const promise = buildFinalSelection({ window, limit, minConviction });
      finalSelectionCache = {
        key: cacheKey,
        startedAt: nowMs,
        promise,
        value: null,
        resolvedAt: 0
      };

      try {
        const value = await promise;
        finalSelectionCache = {
          key: cacheKey,
          promise: null,
          value,
          resolvedAt: Date.now()
        };
        return value;
      } catch (error) {
        if (finalSelectionCache?.promise === promise) {
          finalSelectionCache = null;
        }
        throw error;
      }
    },
    async getFinalSelectionTicker(ticker, options = {}) {
      const finalSelection = await this.getFinalSelection({
        ...options,
        limit: Math.max(50, Number(options.limit || 50))
      });
      return finalSelection.candidates.find((candidate) => candidate.ticker === String(ticker).toUpperCase()) || null;
    },
    async getTradingWorkflowStatus(options = {}) {
      refreshSecFundamentalsHealthPreview(store, config);
      const window = options.window || config.defaultWindow;
      const runtimeReliability = runtimeReliabilityAgent.getSnapshot();
      const tradeSetups = tradeSetupAgent.getTradeSetups({
        window,
        limit: options.limit ? Number(options.limit) : 25,
        minConviction: options.minConviction !== undefined ? Number(options.minConviction) : 0.35
      });
      const executionStatus = executionAgent.getStatus();
      const riskSnapshot = await riskAgent.getSnapshot();
      const positionMonitor = await positionMonitorAgent.getSnapshot({
        window,
        limit: options.positionLimit ? Number(options.positionLimit) : 25
      });

      const workflowStatus = buildTradingWorkflowStatus({
        config,
        store,
        readiness: getReadiness(),
        runtimeReliability,
        tradeSetups,
        executionStatus,
        riskSnapshot,
        positionMonitor
      });
      rememberAgencyAudit(store, { riskSnapshot, positionMonitor });
      return workflowStatus;
    },
    async getAgencyCycleStatus(options = {}) {
      refreshSecFundamentalsHealthPreview(store, config);
      const window = options.window || config.defaultWindow;
      const runtimeReliability = runtimeReliabilityAgent.getSnapshot();
      const tradeSetups = tradeSetupAgent.getTradeSetups({
        window,
        limit: options.limit ? Number(options.limit) : 25,
        minConviction: options.minConviction !== undefined ? Number(options.minConviction) : 0.35
      });
      const executionStatus = executionAgent.getStatus();
      const [riskSnapshot, positionMonitor] = await Promise.all([
        riskAgent.getSnapshot(),
        positionMonitorAgent.getSnapshot({
          window,
          limit: options.positionLimit ? Number(options.positionLimit) : 25
        })
      ]);
      const workflowStatus = buildTradingWorkflowStatus({
        config,
        store,
        readiness: getReadiness(),
        runtimeReliability,
        tradeSetups,
        executionStatus,
        riskSnapshot,
        positionMonitor
      });
      const limit = options.limit ? Number(options.limit) : 25;
      const minConviction = options.minConviction !== undefined ? Number(options.minConviction) : 0.35;
      const portfolioPolicy = buildPortfolioPolicySnapshot({
        config,
        riskSnapshot,
        positionMonitor
      });
      const finalSelection = await this.getFinalSelection({
        window,
        limit,
        minConviction
      });
      const llmSelection = finalSelection.llm_agent || {};

      const agencyCycle = buildAgencyCycleStatus({
        config,
        readiness: getReadiness(),
        runtimeReliability,
        workflowStatus,
        tradeSetups,
        executionStatus,
        riskSnapshot,
        positionMonitor,
        portfolioPolicy,
        llmSelection,
        finalSelection,
        secQueue: buildSecFundamentalsQueue(store, config, { limit: 8 }),
        executionLog: store.executionLog,
        advanceLog: store.agencyCycleLog || []
      });
      rememberAgencyAudit(store, { llmSelection, finalSelection, riskSnapshot, positionMonitor, agencyCycle });
      return agencyCycle;
    },
    async getSystemDoctor(options = {}) {
      refreshSecFundamentalsHealthPreview(store, config);
      const window = options.window || config.defaultWindow;
      const limit = options.limit ? Number(options.limit) : 25;
      const [workflowStatus, agencyCycle, finalSelection, riskSnapshot, positionMonitor] = await Promise.all([
        this.getTradingWorkflowStatus({ ...options, window, limit }),
        this.getAgencyCycleStatus({ ...options, window, limit }),
        this.getFinalSelection({
          window,
          limit,
          minConviction: options.minConviction !== undefined ? Number(options.minConviction) : undefined
        }),
        riskAgent.getSnapshot(),
        positionMonitorAgent.getSnapshot({
          window,
          limit: options.positionLimit ? Number(options.positionLimit) : 25
        })
      ]);
      const portfolioPolicy = buildPortfolioPolicySnapshot({
        config,
        riskSnapshot,
        positionMonitor
      });

      return buildSystemDoctorSnapshot({
        config,
        readiness: getReadiness(),
        health: this.getHealth(),
        runtimeReliability: runtimeReliabilityAgent.getSnapshot(),
        workflowStatus,
        agencyCycle,
        finalSelection,
        executionStatus: executionAgent.getStatus(),
        riskSnapshot,
        positionMonitor,
        portfolioPolicy,
        secQueue: buildSecFundamentalsQueue(store, config, { limit: 8 })
      });
    },
    async advanceAgencyCycle(options = {}) {
      const window = options.window || config.defaultWindow;
      const before = await this.getAgencyCycleStatus(options);
      const selectedAction = chooseAgencyCycleAdvance(before);
      const actionResults = [];
      let preview = null;
      let result = null;
      let openedView = null;
      let topSetup = null;

      async function runRuntime(payload) {
        try {
          const runtimeResult = await app.runRuntimeReliabilityAction(payload);
          actionResults.push({
            ok: true,
            type: "runtime",
            action: payload.action,
            source: payload.source || null,
            summary: summarizeRuntimeActionResult(runtimeResult.result) || null
          });
          return runtimeResult;
        } catch (error) {
          actionResults.push({
            ok: false,
            type: "runtime",
            action: payload.action,
            source: payload.source || null,
            error: error.message
          });
          return null;
        }
      }

      if (selectedAction.type === "runtime") {
        result = await runRuntime(selectedAction.payload);
      } else if (selectedAction.type === "runtime_bundle") {
        for (const action of selectedAction.actions || []) {
          await runRuntime(action);
        }
        result = { actions: actionResults };
      } else if (selectedAction.type === "execution_preview") {
        const finalSelection = await this.getFinalSelection({
          window,
          limit: options.limit ? Number(options.limit) : 25,
          minConviction: options.minConviction !== undefined ? Number(options.minConviction) : 0.35
        });
        const topFinalCandidate = (finalSelection.candidates || []).find((candidate) => candidate.execution_allowed) || null;
        topSetup = topFinalCandidate?.setup_for_execution || null;
        if (topSetup) {
          preview = await executionAgent.previewOrder({
            ticker: topSetup.ticker,
            window,
            setup: topSetup
          });
          rememberExecutionAudit(store, preview);
          result = {
            ticker: topSetup.ticker,
            final_selection_reason: topFinalCandidate.final_reason,
            preview_allowed: Boolean(preview.execution_allowed),
            broker_ready: Boolean(preview.broker_ready),
            blocked_reason: preview.intent?.blocked_reason || preview.risk?.blocked_reason || null
          };
        } else {
          result = {
            preview_allowed: false,
            blocked_reason: "no_tradable_setup"
          };
        }
      } else if (selectedAction.type === "risk_snapshot") {
        result = await riskAgent.getSnapshot();
      } else if (selectedAction.type === "position_monitor") {
        result = await positionMonitorAgent.getSnapshot({
          window,
          limit: options.positionLimit ? Number(options.positionLimit) : 25
        });
      } else if (selectedAction.type === "learning_review") {
        const positionMonitor = await positionMonitorAgent.getSnapshot({
          window,
          limit: options.positionLimit ? Number(options.positionLimit) : 25
        });
        result = {
          execution_decisions: store.executionLog.length,
          visible_positions: positionMonitor.position_count || 0,
          outcome_sample: store.executionLog.length + (positionMonitor.position_count || 0)
        };
      } else if (selectedAction.type === "view") {
        openedView = selectedAction.view || before.workers?.find((worker) => worker.key === before.current_worker_key)?.view || "overview";
        result = { view: openedView };
      } else {
        result = { message: selectedAction.reason || "No safe cycle action is available." };
      }

      const after = await this.getAgencyCycleStatus(options);
      const logEntry = {
        id: `cycle-${Date.now()}`,
        at: new Date().toISOString(),
        worker_key: before.current_worker_key,
        worker_label: before.current_worker_label,
        action_type: selectedAction.type,
        action_label: selectedAction.label,
        reason: selectedAction.reason,
        before_status: before.status,
        before_mode: before.mode,
        after_status: after.status,
        after_mode: after.mode,
        after_worker_key: after.current_worker_key,
        after_worker_label: after.current_worker_label,
        submitted_order: false,
        preview_ticker: topSetup?.ticker || null,
        action_results: actionResults
      };
      store.agencyCycleLog = [logEntry, ...(store.agencyCycleLog || [])].slice(0, 25);
      const afterWithLog = {
        ...after,
        recent_advances: store.agencyCycleLog.slice(0, 5)
      };

      return {
        ok: true,
        submitted_order: false,
        opened_view: openedView,
        action: selectedAction,
        result,
        preview,
        before,
        after: afterWithLog,
        log_entry: logEntry
      };
    },
    async runAgencyCycle(options = {}) {
      const window = options.window || config.defaultWindow;
      const limit = options.limit ? Number(options.limit) : 25;
      const requestedIncludeHeavy = Boolean(options.includeHeavy || options.include_heavy);
      const requestedPriceLimit = Math.max(1, Math.floor(Number(options.priceLimit || options.price_limit || config.fundamentalMarketDataMaxCompaniesPerPoll || 25)));
      const priceLimit = Math.max(1, boundedFundamentalMarketDataLimit(requestedPriceLimit) || requestedPriceLimit);
      const before = await this.getAgencyCycleStatus({ ...options, window, limit });
      const workflowBefore = await this.getTradingWorkflowStatus({ ...options, window, limit }).catch(() => null);
      const sourceStatuses = runtimeSourceStatusMap(workflowBefore || {});
      const baselineMode = before.baseline_ready === false || before.mode === "initial_baseline";
      const includeHeavy = requestedIncludeHeavy || baselineMode;
      const actionResults = [];
      const baselineSecBatches = baselineMode
        ? Math.max(1, Math.floor(Number(config.agencyBaselineSecBatchesPerRun || 1)))
        : 1;
      const runtimeActions = [
        { label: "Refresh Universe", payload: { action: "refresh_universe" } },
        { label: "Refresh Pricing Sample", payload: { action: "poll_once", source: "fundamental_market_data", limit: priceLimit } },
        { label: "Poll Market Flow", payload: { action: "poll_once", source: "market_flow" } },
        { label: "Poll Live News", payload: { action: "poll_once", source: "live_news" } },
        { label: "Poll SEC Form 4", payload: { action: "poll_once", source: "sec_form4" } },
        { label: "Run SEC Fundamentals Batch", payload: { action: "poll_once", source: "sec_fundamentals" }, heavy: true, baseline: true, repeat: baselineSecBatches },
        { label: "Poll Trade Prints", payload: { action: "poll_once", source: "trade_prints" }, optional: true },
        { label: "Poll SEC 13F", payload: { action: "poll_once", source: "sec_13f" }, optional: true, heavy: true }
      ];

      function cycleSkipReason(item) {
        const payload = item.payload || {};
        if (baselineMode && item.baseline) {
          return null;
        }

        if (!baselineMode && payload.action === "refresh_universe") {
          const universeWorker = (before.workers || []).find((worker) => worker.key === "universe");
          if (universeWorker?.data_ready || universeWorker?.baseline_ready) {
            return "Allowed universe is already loaded; skipped during ongoing cycle.";
          }
        }

        if (!baselineMode && payload.action === "poll_once" && payload.source) {
          const sourceKey = canonicalRuntimeSourceKey(payload.source);
          const sourceStatus = sourceStatuses.get(sourceKey) || sourceStatuses.get(payload.source);
          if (sourceStatusIsPolling(sourceStatus)) {
            return `${sourceStatus.label || sourceKey} is already refreshing; skipped to avoid a duplicate blocking request.`;
          }
          if (sourceStatusIsFresh(sourceStatus)) {
            return `${sourceStatus.label || sourceKey} is already fresh; skipped so the agency can move to selection.`;
          }
        }

        return null;
      }

      for (const item of runtimeActions) {
        const allowedByBaseline = baselineMode && item.baseline;
        if (item.heavy && !requestedIncludeHeavy && !allowedByBaseline) {
          actionResults.push({
            ok: null,
            skipped: true,
            label: item.label,
            action: item.payload.action,
            source: item.payload.source || null,
            reason: "Skipped by bounded cycle. Enable heavy actions from System or pass includeHeavy=true."
          });
          continue;
        }

        const skipReason = cycleSkipReason(item);
        if (skipReason) {
          actionResults.push({
            ok: null,
            skipped: true,
            label: item.label,
            action: item.payload.action,
            source: item.payload.source || null,
            reason: skipReason
          });
          continue;
        }

        const repeat = Math.max(1, Math.floor(Number(item.repeat || 1)));
        for (let iteration = 0; iteration < repeat; iteration += 1) {
          const actionLabel = repeat > 1 ? `${item.label} ${iteration + 1}/${repeat}` : item.label;
          try {
            const response = await withAgencyActionTimeout(
              this.runRuntimeReliabilityAction(item.payload),
              actionLabel,
              config.agencyCycleActionTimeoutMs
            );
            const sourceStatus = item.payload.source
              ? response.runtime_reliability?.sources?.find((source) => source.key === item.payload.source)
              : null;
            actionResults.push({
              ok: true,
              skipped: false,
              label: actionLabel,
              action: item.payload.action,
              source: item.payload.source || null,
              result: summarizeRuntimeActionResult(response.result) || null,
              source_status: sourceStatus
                ? {
                    status: sourceStatus.status,
                    provider: sourceStatus.provider,
                    last_success_at: sourceStatus.last_success_at,
                    last_error: sourceStatus.last_error
                  }
                : null
            });

            if (
              item.payload.source === "sec_fundamentals" &&
              Number(response.result?.trackedCompanies || 0) > 0 &&
              Number(response.result?.pendingLiveSecCompanies ?? 0) === 0
            ) {
              break;
            }
          } catch (error) {
            const skipped = /disabled by configuration/i.test(error.message);
            actionResults.push({
              ok: skipped ? null : false,
              skipped,
              timeout: error.code === "AGENCY_ACTION_TIMEOUT",
              label: actionLabel,
              action: item.payload.action,
              source: item.payload.source || null,
              error: error.message
            });
            if (!skipped) {
              break;
            }
          }
        }
      }

      const [finalSelectionResult, riskSnapshotResult, positionMonitorResult] = await Promise.allSettled([
        this.getFinalSelection({ window, limit, minConviction: options.minConviction !== undefined ? Number(options.minConviction) : undefined }),
        riskAgent.getSnapshot(),
        positionMonitorAgent.getSnapshot({ window, limit: options.positionLimit ? Number(options.positionLimit) : 25 })
      ]);
      const finalSelection = finalSelectionResult.status === "fulfilled" ? finalSelectionResult.value : { counts: {}, candidates: [] };
      const riskSnapshot = riskSnapshotResult.status === "fulfilled" ? riskSnapshotResult.value : { status: "unknown" };
      const positionMonitor = positionMonitorResult.status === "fulfilled" ? positionMonitorResult.value : { risk_status: "unknown" };

      for (const [label, settled] of [
        ["Final Selection Snapshot", finalSelectionResult],
        ["Risk Snapshot", riskSnapshotResult],
        ["Portfolio Monitor Snapshot", positionMonitorResult]
      ]) {
        if (settled.status === "rejected") {
          actionResults.push({
            ok: false,
            skipped: false,
            label,
            action: "snapshot",
            source: null,
            error: settled.reason?.message || String(settled.reason)
          });
        }
      }

      let after = null;
      try {
        after = await this.getAgencyCycleStatus({ ...options, window, limit });
      } catch (error) {
        actionResults.push({
          ok: false,
          skipped: false,
          label: "Agency Cycle Status",
          action: "snapshot",
          source: null,
          error: error.message
        });
        after = before;
      }

      const workflowStatus = await this.getTradingWorkflowStatus({ ...options, window, limit }).catch((error) => {
        actionResults.push({
          ok: false,
          skipped: false,
          label: "Trading Workflow Status",
          action: "snapshot",
          source: null,
          error: error.message
        });
        return workflowBefore || {};
      });
      const logEntry = {
        id: `cycle-run-${Date.now()}`,
        at: new Date().toISOString(),
        worker_key: before.current_worker_key,
        worker_label: before.current_worker_label,
        action_type: "agency_run",
        action_label: "Run Agency Cycle",
        reason: "Bounded agency run refreshed data workers, then recomputed selection, final selection, risk, portfolio, and learning snapshots.",
        before_status: before.status,
        before_mode: before.mode,
        after_status: after.status,
        after_mode: after.mode,
        after_worker_key: after.current_worker_key,
        after_worker_label: after.current_worker_label,
        submitted_order: false,
        preview_ticker: null,
        action_results: actionResults
      };
      store.agencyCycleLog = [logEntry, ...(store.agencyCycleLog || [])].slice(0, 25);
      const okCount = actionResults.filter((item) => item.ok === true).length;
      const failedCount = actionResults.filter((item) => item.ok === false).length;
      const skippedCount = actionResults.filter((item) => item.skipped).length;
      const afterWithLog = {
        ...after,
        recent_advances: store.agencyCycleLog.slice(0, 5)
      };

      return {
        ok: failedCount === 0,
        submitted_order: false,
        action: {
          type: "agency_run",
          label: "Run Agency Cycle"
        },
        run: {
          actions: actionResults,
          ok_count: okCount,
          failed_count: failedCount,
          skipped_count: skippedCount,
          include_heavy: includeHeavy,
          baseline_mode: baselineMode,
          baseline_sec_batches: baselineMode ? baselineSecBatches : 0,
          price_limit: priceLimit,
          requested_price_limit: requestedPriceLimit,
          provider_price_cap: config.fundamentalMarketDataMaxCompaniesPerPoll || null,
          final_executable: finalSelection.counts?.executable || 0,
          final_buy: finalSelection.counts?.final_buy || 0,
          final_sell: finalSelection.counts?.final_sell || 0,
          risk_status: riskSnapshot.status || positionMonitor.risk_status || "unknown",
          live_pricing_ready: Boolean(workflowStatus.live_data?.live_pricing_ready),
          can_preview_orders: Boolean(afterWithLog.can_preview_orders),
          can_submit_orders: Boolean(afterWithLog.can_submit_orders),
          next_actions: afterWithLog.next_actions || []
        },
        before,
        after: afterWithLog,
        log_entry: logEntry
      };
    },
    getExecutionStatus() {
      return executionAgent.getStatus();
    },
    async previewExecutionOrder(payload = {}) {
      const preview = await executionAgent.previewOrder(payload);
      rememberExecutionAudit(store, preview);
      return preview;
    },
    async submitExecutionOrder(payload = {}) {
      const result = await executionAgent.submitOrder(payload);
      rememberExecutionAudit(store, result);
      return result;
    },
    async getBrokerAccount() {
      return broker.getAccount();
    },
    async getBrokerPositions() {
      return broker.getPositions();
    },
    async getBrokerOrders(options = {}) {
      return broker.getOrders(options);
    },
    async getRiskSnapshot() {
      const riskSnapshot = await riskAgent.getSnapshot();
      rememberAgencyAudit(store, { riskSnapshot });
      return riskSnapshot;
    },
    async evaluateExecutionRisk(payload = {}) {
      const preview = await executionAgent.previewOrder(payload);
      return {
        ok: true,
        ticker: payload.ticker || preview.intent?.ticker || null,
        preview,
        risk: preview.risk
      };
    },
    async getPositionMonitor(options = {}) {
      const positionMonitor = await positionMonitorAgent.getSnapshot(options);
      rememberAgencyAudit(store, { positionMonitor });
      return positionMonitor;
    },
    getExecutionState() {
      return {
        ...store.executionState,
        pending_approvals: store.pendingApprovals.size
      };
    },
    getExecutionPositions() {
      return Array.from(store.positions.values());
    },
    getExecutionOrders() {
      return Array.from(store.orders.values());
    },
    getExecutionLog() {
      return store.executionLog;
    },
    async approveExecution(approvalId) {
      return humanApprovalAgent.approve(approvalId);
    },
    rejectExecution(approvalId, reason = "") {
      humanApprovalAgent.reject(approvalId, reason);
    },
    setKillSwitch(enabled) {
      humanApprovalAgent.setKillSwitch(enabled);
    },
    async syncExecution() {
      return humanApprovalAgent.sync();
    },
    getTradeSetupStorageSummary() {
      const rows = store.tradeSetupHistory || [];
      const latestAsOf = rows[0]?.as_of || null;
      const latestRows = latestAsOf ? rows.filter((row) => row.as_of === latestAsOf) : [];
      return {
        latest_as_of: latestAsOf,
        total_rows: rows.length,
        distinct_tickers: new Set(rows.map((row) => row.ticker)).size,
        action_counts: {
          long: latestRows.filter((row) => row.action === "long").length,
          short: latestRows.filter((row) => row.action === "short").length,
          watch: latestRows.filter((row) => row.action === "watch").length,
          no_trade: latestRows.filter((row) => row.action === "no_trade").length
        },
        latest_macro_regime: store.macroRegimeHistory[0] || null
      };
    },
    getTradeSetupStorageTicker(ticker, limit = 20) {
      return store.tradeSetupHistory
        .filter((row) => row.ticker === ticker)
        .slice(0, limit);
    },
    getFundamentalPersistenceSummary() {
      return summarizeFundamentalPersistence(store.fundamentalWarehouse);
    },
    getFundamentalPersistenceTicker(ticker) {
      return getFundamentalPersistenceTicker(store.fundamentalWarehouse, ticker);
    },
    getFundamentalPersistenceFilings(ticker, limit) {
      return getFundamentalPersistenceFilings(store.fundamentalWarehouse, ticker, limit);
    },
    getFundamentalPersistenceFactSeries(ticker, canonicalField, options = {}) {
      return getFundamentalPersistenceFactSeries(store.fundamentalWarehouse, ticker, canonicalField, options);
    },
    getTrackedFundamentalCompanies() {
      return trackedFundamentalCompanies(store);
    },
    async replaceFundamentalCompanies(companies, options = {}) {
      return fundamentals.replaceCompanies(companies, options);
    },
    async refreshFundamentals(options = {}) {
      await persistenceReady;
      await ensureFundamentalCoverage({ force: Boolean(options.forceUniverse) });
      const refreshResult = await secFundamentalsCollector.pollOnce();
      return {
        ok: true,
        refresh: refreshResult,
        health: this.getHealth()
      };
    },
    async startLiveSources() {
      return undefined;
    },
    stopLiveSources() {},
    async pollLiveSourcesOnce() {
      const liveNews = await liveNewsCollector.pollOnce();
      const marketFlow = await marketFlowMonitor.pollOnce();
      const earningsCalendar = await corporateEventsCollector.pollOnce();
      const stocktwits = await socialSentimentCollector.pollOnce();
      const tradePrints = await tradePrintsCollector.pollOnce();
      const secForm4 = await secInsiderCollector.pollOnce();
      const sec13f = await secInstitutionalCollector.pollOnce();

      return {
        live_news: liveNews,
        market_flow: marketFlow,
        earnings_calendar: earningsCalendar,
        stocktwits_stream: stocktwits,
        trade_prints: tradePrints,
        sec_form4: secForm4,
        sec_13f: sec13f
      };
    }
  };

  humanApprovalAgent = createHumanApprovalAgent(app, broker);
  const secFundamentalsCollector = createSecFundamentalsCollector(app);
  let autosaveTimer = null;
  let backupTimer = null;

  app.startLiveSources = async function startLiveSources() {
    await persistenceReady;
    await ensureFundamentalCoverage();
    const autonomous = Boolean(config.autonomousDataEnabled);
    const launches = [];
    const launch = (label, starter) => {
      const promise = Promise.resolve()
        .then(starter)
        .catch((error) => {
          console.error(`${label} startup failed:`, error);
          store.health.liveSourceStartup = {
            ...(store.health.liveSourceStartup || {}),
            [label]: {
              last_error: error.message,
              failed_at: new Date().toISOString()
            }
          };
        });
      launches.push(promise);
    };

    if (config.liveNewsEnabled && (config.autoStartLiveNews || autonomous)) {
      launch("live_news", () => liveNewsCollector.start());
    }
    launch("market_data", () => marketDataService.start());
    if (config.autoStartSectorEtfProxies || autonomous) {
      launch("sector_etf_proxies", () => refreshSectorEtfReferences());
    }
    if (config.secForm4Enabled && (config.autoStartSecForm4 || autonomous)) {
      launch("sec_form4", () => secInsiderCollector.start());
    }

    if (config.sec13fEnabled && (config.autoStartSec13f || autonomous)) {
      launch("sec_13f", () => secInstitutionalCollector.start());
    }

    const fundamentalMarketConfigured =
      config.fundamentalMarketDataProvider === "synthetic" ||
      hasConfiguredLiveMarketProvider(config, config.fundamentalMarketDataProvider);
    if ((config.autoStartFundamentalMarketData || autonomous) && fundamentalMarketConfigured) {
      launch("fundamental_market_data", () => fundamentalMarketDataService.start({
        getCompanies: () => fundamentals.getTrackedCompanies(),
        onUpdate: async (referenceMap) => fundamentals.refreshMarketReference(referenceMap)
      }));
    }

    if (config.fundamentalSecEnabled && (config.autoStartSecFundamentals || autonomous)) {
      launch("sec_fundamentals", () => secFundamentalsCollector.start());
    }

    const earningsConfigured = config.earningsProvider !== "twelvedata" || Boolean(config.earningsApiKey || config.twelveDataApiKey);
    if ((config.earningsEnabled || autonomous) && earningsConfigured) {
      launch("earnings_calendar", () => corporateEventsCollector.start());
    }

    if (config.stocktwitsEnabled && config.stocktwitsApiKey) {
      launch("stocktwits_stream", () => socialSentimentCollector.start());
    }

    if (config.tradePrintsEnabled && config.tradePrintsApiKey) {
      launch("trade_prints", () => tradePrintsCollector.start());
    }

    if (config.marketFlowEnabled && (config.autoStartMarketFlow || autonomous)) {
      launch("market_flow", () => marketFlowMonitor.start());
    }

    if (config.executionEnabled) {
      humanApprovalAgent.start();
    }

    if (config.databaseEnabled && !autosaveTimer) {
      autosaveTimer = setInterval(() => {
        persistence.saveStoreSnapshot(store).catch((error) => {
          console.error("Persistence autosave failed:", error);
        });
      }, config.databaseAutosaveMs);
    }

    if (config.databaseEnabled && config.databaseProvider === "sqlite") {
      if (config.sqliteBackupOnStartup) {
        await persistence.backupNow({ reason: "startup" });
      }
      await refreshBackupStatus();
      if (config.sqliteBackupEnabled && !backupTimer) {
        backupTimer = setInterval(() => {
          persistence.backupNow({ reason: "interval" })
            .then(() => refreshBackupStatus())
            .catch((error) => {
              console.error("SQLite backup failed:", error);
            });
        }, config.sqliteBackupIntervalMs);
      }
    }

    return {
      launched: launches.length
    };
  };

  app.stopLiveSources = async function stopLiveSources() {
    liveNewsCollector.stop();
    marketDataService.stop();
    marketFlowMonitor.stop();
    secInsiderCollector.stop();
    secInstitutionalCollector.stop();
    fundamentalMarketDataService.stop();
    secFundamentalsCollector.stop();
    corporateEventsCollector.stop();
    socialSentimentCollector.stop();
    tradePrintsCollector.stop();
    humanApprovalAgent.stop();
    if (autosaveTimer) {
      clearInterval(autosaveTimer);
      autosaveTimer = null;
    }
    if (backupTimer) {
      clearInterval(backupTimer);
      backupTimer = null;
    }
    await persistenceReady;
    await persistence.saveStoreSnapshot(store);
    await refreshBackupStatus();
  };

  return app;
}
