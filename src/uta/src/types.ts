// src/uta/src/types.ts

export type LaneState = {
  lane_id: string;
  label: string;
  state: string;
  required: boolean;
  tier_effect: string;
  operator_copy: string;
  coverage?: number | null;
  freshness_seconds?: number | null;
  next_action?: { label: string; route: string } | null;
};

export type EvidenceCard = {
  id: string;
  title: string;
  status: string;
  headline_metric: string;
  summary: string;
};

export type ExplainRule = {
  id: string;
  label: string;
  passed: boolean;
  actual: string;
};

export type RawPrint = {
  ts: string;
  venue: string;
  price: number;
  size: number;
  notional: number;
  signed_side?: string;
  signing_method?: string;
  condition_codes?: string[];
};

export type UtaTickerResult = {
  schema_version: string;
  mode: string;
  ticker: string;
  name?: string;
  exchange?: string;
  sector?: string;
  generated_at: string;
  data_state: string;
  tier: string;
  direction: string;
  signing_confidence: number;
  indicators: {
    A: null | Record<string, unknown>;
    B: Record<string, number | null | undefined>;
    C: Record<string, number | null | undefined>;
  };
  lane_states: LaneState[];
  bluf: {
    headline: string;
    what_happened: string;
    why_it_matters: string;
    what_to_check: string;
    limitations: string;
  };
  trade_analysis?: {
    bias: string;
    setup_status: string;
    verdict: string;
    trigger_model?: string;
    evidence_grade: string;
    anomaly_band: string;
    confidence: number;
    trigger_summary?: {
      primary_trigger?: string;
      next_trigger_needed?: string;
      trade_action?: string;
    };
    criteria?: Array<{ id: string; label: string; passed: boolean; actual: string }>;
    pressure: {
      direction: string;
      net_notional_pressure: number;
      net_volume_pressure?: number;
      signing_confidence: number;
      interpretation: string;
    };
    activity: {
      latest_bar_date?: string | null;
      latest_close?: number | null;
      prev_close?: number | null;
      price_change_pct?: number | null;
      volume_ratio?: number | null;
      notional_ratio?: number | null;
      volume_zscore?: number | null;
      notional_zscore?: number | null;
      total_notional?: number | null;
      analyzed_prints?: number;
      baseline_sessions?: number;
    };
    block_flow: {
      focus_trade_count?: number;
      focus_notional?: number | null;
      focus_notional_share?: number | null;
      largest_print_notional?: number | null;
      largest_print_multiple?: number | null;
      trf_share?: number | null;
    };
    indicator_aliases?: {
      A: null | Record<string, number | null | undefined>;
      B: Record<string, number | null | undefined>;
      C: Record<string, number | null | undefined>;
    };
    corroboration?: {
      price_action_aligned?: boolean;
      provider_alert_confirmed?: boolean;
      options_flow_aligned?: boolean;
      premarket_regular_elevated?: boolean;
      news_catalyst_present?: boolean;
      macro_regime_supports?: boolean;
      independent_strong_count?: number;
      note?: string;
    };
    trade_boundaries?: string[];
  };
  evidence_cards: EvidenceCard[];
  explain_tier: {
    mode?: string;
    rule_set?: string;
    verdict?: string;
    rules: ExplainRule[];
    gap_to_next_tier?: unknown[];
  };
  raw_prints?: {
    ticker: string;
    policy_version: string;
    truncated?: boolean;
    prints: RawPrint[];
    normalization_summary?: Record<string, unknown>;
  };
  calculation_metadata: {
    source_mode: string;
    replay_clock?: string;
    live_clock?: string;
    provider?: string;
    bars_source?: string;
    prints_source?: string;
    latest_bar_date?: string | null;
    live_volume_source?: string;
    live_manual_only?: boolean;
    direction_source: string;
    price_is_corroboration_only: boolean;
    abc_indicators_kept_separate?: boolean;
  };
  engine_diagnostics?: {
    provider?: string;
    fetched_at?: string;
    print_sample?: { eligible_prints?: number; total_notional?: number; total_volume?: number };
    baseline?: { session_count?: number; state?: string };
    signal_components?: { state?: string };
  };
  runtime_cycle?: {
    run_id?: string;
    status?: string;
    mode?: string;
    reason?: string;
    generated_at?: string;
    duration_ms?: number;
  };
};

export type PortfolioResult = {
  schema_version: string;
  mode: string;
  generated_at: string;
  data_state: string;
  portfolio_ticker_count: number;
  results: UtaTickerResult[];
};

export type ScanRow = {
  ticker: string;
  preliminary_tier?: string;
  B_estimate?: Record<string, number>;
  C_screen?: number;
  pass2_status?: string;
  label?: string;
  scan_reason?: string;
  status?: string;
  setup_status?: string;
  bias?: string;
  trade_action?: string;
  primary_trigger?: string;
  next_trigger_needed?: string;
  anomaly_band?: string;
  evidence_grade?: string;
  signed_pressure?: number | null;
  signing_confidence?: number | null;
  volume_ratio?: number | null;
  notional_ratio?: number | null;
  focus_trade_count?: number | null;
  result?: UtaTickerResult;
};

export type ScanResult = {
  schema_version: string;
  mode: string;
  universe: string;
  universe_label: string;
  universe_ticker_count: number;
  requested_ticker_count?: number | null;
  direction_filter: string;
  pass: number;
  generated_at: string;
  data_state?: string;
  performance_tier: string;
  shortlist_count: number;
  scanned_count?: number;
  blocked_count?: number | null;
  scan_policy?: string;
  scan_scope?: string;
  universe_source?: string;
  universe_cache_state?: string;
  universe_warning?: string | null;
  results: ScanRow[];
};

export type RuntimeStatus = {
  schema_version: string;
  generated_at: string;
  mode: string;
  provider_status?: ProviderStatus;
  scheduler?: {
    enabled?: boolean;
    mode?: string;
    next_run_at?: string | null;
    jobs?: string[];
  };
  last_cycle?: Record<string, unknown> | null;
  signal_result_count: number;
  replay_run_count: number;
  lane_pressure: { total: number; required_not_ready: number; optional_disabled: number };
  pi_policy: {
    auto_start_heavy_jobs: boolean;
    api_saver_blocks_heavy_autostart: boolean;
    storage: string;
  };
  next_actions?: { action: string; label: string; safe: boolean }[];
};

export type ProviderLane = {
  lane_id: string;
  label: string;
  required: boolean;
  provider_family: string;
  provider: string;
  enabled: boolean;
  configured: boolean;
  live_capable: boolean;
  auto_start_allowed: boolean;
  state_if_unavailable: string;
  tier_effect_when_unavailable: string;
  optional_corroboration_only?: boolean;
  operator_copy: string;
};

export type ProviderStatus = {
  schema_version: string;
  generated_at: string;
  mode: string;
  live_ready: boolean;
  summary: {
    required_configured: number;
    required_total: number;
    optional_configured: number;
    optional_total: number;
    live_capable: number;
    auto_start_allowed: number;
  };
  provider_lanes: ProviderLane[];
  safeguards: string[];
  policy: string;
};

export type HistoryResult = {
  schema_version: string;
  rows: Array<{
    id?: string;
    ticker?: string;
    mode?: string;
    tier?: string;
    direction?: string;
    generated_at?: string;
    created_at?: string;
  }>;
  replay_runs: Array<Record<string, unknown>>;
  audit_log: Array<Record<string, unknown>>;
};

export type SchedulerResult = {
  schema_version: string;
  scheduler: RuntimeStatus["scheduler"];
  policy: string;
};

export type UtaRule = {
  id: string;
  name: string;
  enabled: boolean;
  min_tier: string;
  direction: string;
  source?: string;
};

export type UserStateResult = {
  scope: string;
  state: {
    watchlist?: string[];
    reviewed?: Record<string, unknown>;
    ignored?: Record<string, unknown>;
    rules?: UtaRule[];
    saved_scans?: Array<Record<string, unknown>>;
    settings?: Record<string, unknown>;
  };
};

export type LoadState<T> =
  | { status: "idle"; data?: T; message?: string }
  | { status: "loading"; data?: T; message: string }
  | { status: "error"; data?: T; message: string }
  | { status: "ready"; data: T; message?: string };

export type Mode = "home" | "single" | "portfolio" | "scan" | "alerts" | "runtime";
