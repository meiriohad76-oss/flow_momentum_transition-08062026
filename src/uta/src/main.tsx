import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type LaneState = {
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

type EvidenceCard = {
  id: string;
  title: string;
  status: string;
  headline_metric: string;
  summary: string;
};

type ExplainRule = {
  id: string;
  label: string;
  passed: boolean;
  actual: string;
};

type RawPrint = {
  ts: string;
  venue: string;
  price: number;
  size: number;
  notional: number;
  signed_side?: string;
  signing_method?: string;
  condition_codes?: string[];
};

type UtaTickerResult = {
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
    direction_source: string;
    price_is_corroboration_only: boolean;
    abc_indicators_kept_separate?: boolean;
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

type PortfolioResult = {
  schema_version: string;
  mode: string;
  generated_at: string;
  data_state: string;
  portfolio_ticker_count: number;
  results: UtaTickerResult[];
};

type ScanRow = {
  ticker: string;
  preliminary_tier?: string;
  B_estimate?: Record<string, number>;
  C_screen?: number;
  pass2_status?: string;
  label?: string;
  status?: string;
  result?: UtaTickerResult;
};

type ScanResult = {
  schema_version: string;
  mode: string;
  universe: string;
  universe_label: string;
  universe_ticker_count: number;
  direction_filter: string;
  pass: number;
  generated_at: string;
  performance_tier: string;
  shortlist_count: number;
  results: ScanRow[];
};

type RuntimeStatus = {
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
  lane_pressure: {
    total: number;
    required_not_ready: number;
    optional_disabled: number;
  };
  pi_policy: {
    auto_start_heavy_jobs: boolean;
    api_saver_blocks_heavy_autostart: boolean;
    storage: string;
  };
  next_actions?: { action: string; label: string; safe: boolean }[];
};

type ProviderLane = {
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

type ProviderStatus = {
  schema_version: string;
  generated_at: string;
  mode: string;
  replay_available: boolean;
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

type HistoryResult = {
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

type SchedulerResult = {
  schema_version: string;
  scheduler: RuntimeStatus["scheduler"];
  policy: string;
};

type UtaRule = {
  id: string;
  name: string;
  enabled: boolean;
  min_tier: string;
  direction: string;
  source?: string;
};

type UserStateResult = {
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

type LoadState<T> =
  | { status: "idle"; data?: T; message?: string }
  | { status: "loading"; data?: T; message: string }
  | { status: "error"; data?: T; message: string }
  | { status: "ready"; data: T; message?: string };

type Mode = "single" | "portfolio" | "scan" | "alerts" | "runtime";
type SingleSourceMode = "replay" | "live";

const DEFAULT_PORTFOLIO = ["AVGO", "NVDA", "MSFT"];

function fmtMoney(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "N/A";
  if (Math.abs(numeric) >= 1_000_000_000) return `$${(numeric / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(numeric) >= 1_000_000) return `$${Math.round(numeric / 1_000_000).toLocaleString()}M`;
  return `$${Math.round(numeric).toLocaleString()}`;
}

function fmtPct(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "N/A";
  return `${Math.round(numeric * 100)}%`;
}

function fmtNumber(value: unknown, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "N/A";
  return numeric.toFixed(digits);
}

function fmtDate(value?: string | null) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function tickerList(value: string) {
  return value
    .split(/[,\s]+/)
    .map((ticker) => ticker.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 25);
}

function tierRank(tier?: string) {
  return { A: 4, B: 3, C: 2, D: 1 }[String(tier || "D").toUpperCase() as "A" | "B" | "C" | "D"] || 0;
}

function ruleMatches(rule: UtaRule, result?: UtaTickerResult | null) {
  if (!rule.enabled || !result) return false;
  if (result.tier === "D") return false;
  const tierOk = tierRank(result.tier) >= tierRank(rule.min_tier || "A");
  const directionOk = rule.direction === "any" || rule.direction === result.direction;
  return tierOk && directionOk;
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok && !payload?.schema_version) {
    throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

async function apiGet<T>(url: string) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  return readJson<T>(response);
}

async function apiPost<T>(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return readJson<T>(response);
}

function invariantWarnings(data: UtaTickerResult) {
  const warnings: string[] = [];
  if (data.mode === "single_ticker" && data.indicators.A !== null) warnings.push("Single ticker mode must render A as N/A.");
  if (data.tier !== "D" && data.calculation_metadata.direction_source !== "signed_flow") {
    warnings.push("Direction source is not signed_flow.");
  }
  if (Object.prototype.hasOwnProperty.call(data, "composite_score")) warnings.push("Composite score detected.");
  if (data.calculation_metadata.price_is_corroboration_only !== true) warnings.push("Price corroboration policy missing.");
  return warnings;
}

function useSseEvents() {
  const [events, setEvents] = useState<Array<{ type: string; received_at: string; payload: string }>>([]);
  const [state, setState] = useState("connecting");

  useEffect(() => {
    if (!("EventSource" in window)) {
      setState("unsupported");
      return;
    }

    const source = new EventSource("/api/uta/stream");
    const remember = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);
        setEvents((current) => [
          {
            type: payload.type || event.type,
            received_at: new Date().toISOString(),
            payload: JSON.stringify(payload.payload || payload).slice(0, 160)
          },
          ...current
        ].slice(0, 8));
      } catch {
        setEvents((current) => [
          { type: event.type, received_at: new Date().toISOString(), payload: String(event.data).slice(0, 160) },
          ...current
        ].slice(0, 8));
      }
    };

    source.addEventListener("uta_snapshot", (event) => {
      setState("connected");
      remember(event as MessageEvent);
    });
    ["uta_signal_result", "uta_scan_progress", "uta_lane_state", "uta_revalidation"].forEach((eventType) => {
      source.addEventListener(eventType, remember as EventListener);
    });
    source.onerror = () => setState("reconnecting");
    source.onopen = () => setState("connected");

    return () => source.close();
  }, []);

  return { state, events };
}

function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

function SectionHeader({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="section-header">
      <h2>{title}</h2>
      {meta ? <span>{meta}</span> : null}
    </div>
  );
}

function MetricTile({ label, value, detail }: { label: string; value: React.ReactNode; detail?: string }) {
  return (
    <div className="metric-tile">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function StatusStrip({ data }: { data: UtaTickerResult }) {
  const warnings = invariantWarnings(data);
  const replayBacked = data.calculation_metadata.source_mode === "replay" || data.data_state === "replay";
  return (
    <section className={`status-strip ${warnings.length ? "error" : "ok"}`}>
      <div>
        <strong>{warnings.length ? "Invariant warning" : replayBacked ? "Replay-backed analysis" : "Live analysis"}</strong>
        <span>
          {warnings.length
            ? warnings.join(" ")
            : replayBacked
              ? `Displayed tier/evidence comes from the replay engine. Direction source: ${data.calculation_metadata.direction_source}. Massive provider readiness is shown in Runtime and does not yet replace these calculations.`
              : `Loaded ${data.ticker} from ${data.calculation_metadata.source_mode}. Direction source: ${data.calculation_metadata.direction_source}.`}
        </span>
      </div>
      <Pill tone={data.data_state === "replay" ? "warn" : "good"}>{data.data_state}</Pill>
    </section>
  );
}

function IndicatorGrid({ data, portfolioMode = false }: { data: UtaTickerResult; portfolioMode?: boolean }) {
  const a = data.indicators.A;
  return (
    <div className="indicator-grid">
      <MetricTile
        label={portfolioMode ? "A - relative to your portfolio today" : "A - universe percentile"}
        value={a === null ? "N/A" : fmtPct(a.volume_percentile)}
        detail={a === null ? "Single ticker mode" : String(a.scope_label || "Ranked context")}
      />
      <MetricTile
        label="B - historical z-score"
        value={`${fmtNumber(data.indicators.B.notional_zscore)} sigma`}
        detail="Robust baseline"
      />
      <MetricTile
        label="C - raw ordering metric"
        value={fmtMoney(data.indicators.C.focus_notional)}
        detail={`${fmtNumber(data.indicators.C.volume_ratio)}x volume`}
      />
    </div>
  );
}

function LaneHealth({ lanes, onRefresh }: { lanes: LaneState[]; onRefresh?: (lane: LaneState) => void }) {
  return (
    <section className="panel">
      <SectionHeader title="Data Health" meta={`${lanes.length} lanes`} />
      <div className="lane-list">
        {lanes.map((lane) => (
          <div className="lane" key={lane.lane_id}>
            <div>
              <b>{lane.label}</b>
              <span>{lane.operator_copy}</span>
              <small>
                {lane.required ? "Required" : "Optional"} / tier effect: {lane.tier_effect}
                {typeof lane.coverage === "number" ? ` / coverage ${fmtPct(lane.coverage)}` : ""}
              </small>
            </div>
            <div className="lane-actions">
              <Pill tone={lane.state === "ready" ? "good" : lane.state === "disabled" ? "neutral" : "warn"}>{lane.state}</Pill>
              {lane.next_action && onRefresh ? (
                <button className="icon-button" type="button" onClick={() => onRefresh(lane)} title={lane.next_action.label}>
                  R
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function EvidenceCards({ cards }: { cards: EvidenceCard[] }) {
  return (
    <section className="panel">
      <SectionHeader title="Evidence" meta={`${cards.length} cards`} />
      <div className="evidence-grid">
        {cards.map((card) => (
          <article className="evidence-card" key={card.id}>
            <div>
              <Pill tone={card.status === "ready" ? "good" : card.status === "disabled" ? "neutral" : "warn"}>{card.status}</Pill>
              <h3>{card.title}</h3>
            </div>
            <strong>{card.headline_metric}</strong>
            <p>{card.summary}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ExplainTier({ data }: { data: UtaTickerResult }) {
  return (
    <section className="panel" data-testid="explain-tier">
      <SectionHeader title="Explain Tier" meta={data.explain_tier.verdict || `Tier ${data.tier}`} />
      <div className="rule-list">
        {(data.explain_tier.rules || []).map((rule) => (
          <div className={`rule ${rule.passed ? "pass" : "fail"}`} key={rule.id}>
            <Pill tone={rule.passed ? "good" : "bad"}>{rule.passed ? "passed" : "failed"}</Pill>
            <div>
              <b>{rule.label}</b>
              <span>{rule.actual}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RawPrints({ prints }: { prints: RawPrint[] }) {
  return (
    <section className="panel raw-print-panel">
      <SectionHeader title="Raw Prints" meta={`${prints.length} shown`} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Venue</th>
              <th>Side</th>
              <th>Price</th>
              <th>Size</th>
              <th>Notional</th>
              <th>Codes</th>
            </tr>
          </thead>
          <tbody>
            {prints.map((print, index) => (
              <tr key={`${print.ts}-${index}`}>
                <td>{fmtDate(print.ts)}</td>
                <td>{print.venue}</td>
                <td>{print.signed_side || "unknown"}</td>
                <td>{fmtMoney(print.price)}</td>
                <td>{Number(print.size || 0).toLocaleString()}</td>
                <td>{fmtMoney(print.notional)}</td>
                <td>{(print.condition_codes || []).join(", ") || "none"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CycleHistory({ history }: { history: HistoryResult | null }) {
  return (
    <section className="panel">
      <SectionHeader title="Cycle History" meta={`${history?.rows.length || 0} rows`} />
      <div className="compact-list">
        {(history?.rows || []).slice(0, 6).map((row, index) => (
          <div className="compact-row" key={row.id || index}>
            <div>
              <b>{row.ticker || "UTA"}</b>
              <span>{row.mode || "cycle"} / {row.direction || "n/a"}</span>
            </div>
            <Pill tone={row.tier === "A" ? "good" : "neutral"}>{row.tier || "n/a"}</Pill>
          </div>
        ))}
        {!history?.rows.length ? <p className="empty">No cycles stored yet.</p> : null}
      </div>
    </section>
  );
}

function TickerDetail({
  data,
  history,
  portfolioMode,
  onRefreshLane,
  onRevalidate,
  onWatchlist
}: {
  data: UtaTickerResult;
  history: HistoryResult | null;
  portfolioMode?: boolean;
  onRefreshLane?: (lane: LaneState) => void;
  onRevalidate?: () => void;
  onWatchlist?: () => void;
}) {
  const prints = data.raw_prints?.prints || [];
  return (
    <div className="detail-stack">
      <StatusStrip data={data} />
      <section className="panel detail-hero">
        <div className="ticker-head">
          <div>
            <span className="crumb">{portfolioMode ? "Portfolio detail" : "Single ticker"} / {data.sector || "UTA"}</span>
            <h1>{data.ticker}</h1>
            <p>{data.name || ""} {data.exchange ? `/ ${data.exchange}` : ""}</p>
          </div>
          <div className="tier-cluster">
            <span className="tier-ring">Tier {data.tier}</span>
            <Pill tone={data.direction === "bullish" ? "good" : data.direction === "bearish" ? "bad" : "neutral"}>
              {data.direction}
            </Pill>
          </div>
        </div>
        <h2>{data.bluf.headline}</h2>
        <IndicatorGrid data={data} portfolioMode={portfolioMode} />
        <div className="bluf-grid">
          <MetricTile label="What happened" value={data.bluf.what_happened} />
          <MetricTile label="Why it matters" value={data.bluf.why_it_matters} />
          <MetricTile label="What to check" value={data.bluf.what_to_check} />
          <MetricTile label="Limitations" value={data.bluf.limitations} />
        </div>
        <div className="action-row">
          <button type="button" onClick={onRevalidate}>Revalidate</button>
          <button type="button" className="secondary" onClick={onWatchlist}>Watchlist</button>
          <span>Cycle {data.runtime_cycle?.run_id || data.cycle_id || "replay"}</span>
        </div>
      </section>

      <div className="two-column">
        <EvidenceCards cards={data.evidence_cards || []} />
        <LaneHealth lanes={data.lane_states || []} onRefresh={onRefreshLane} />
      </div>
      <div className="two-column">
        <ExplainTier data={data} />
        <CycleHistory history={history} />
      </div>
      <RawPrints prints={prints} />
    </div>
  );
}

function SingleMode({
  data,
  history,
  sourceMode,
  onAnalyze,
  onSourceModeChange,
  onRefreshLane,
  onRevalidate,
  onWatchlist
}: {
  data: LoadState<UtaTickerResult>;
  history: HistoryResult | null;
  sourceMode: SingleSourceMode;
  onAnalyze: (ticker: string, sourceMode: SingleSourceMode) => void;
  onSourceModeChange: (sourceMode: SingleSourceMode) => void;
  onRefreshLane: (lane: LaneState) => void;
  onRevalidate: () => void;
  onWatchlist: () => void;
}) {
  const [ticker, setTicker] = useState("AVGO");
  return (
    <section className="mode-stack">
      <form className="command-bar" onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onAnalyze(ticker.trim().toUpperCase() || "AVGO", sourceMode);
      }}>
        <label htmlFor="single-ticker">Ticker</label>
        <input id="single-ticker" value={ticker} onChange={(event) => setTicker(event.target.value)} autoComplete="off" />
        <label htmlFor="single-source">Source</label>
        <select
          id="single-source"
          value={sourceMode}
          onChange={(event) => onSourceModeChange(event.target.value as SingleSourceMode)}
        >
          <option value="replay">Replay fixture</option>
          <option value="live">Live manual Massive</option>
        </select>
        <button type="submit">Analyze</button>
      </form>
      {data.status === "loading" ? <section className="panel muted-panel">{data.message}</section> : null}
      {data.status === "error" ? <section className="panel error-panel">{data.message}</section> : null}
      {data.data ? (
        <TickerDetail
          data={data.data}
          history={history}
          onRefreshLane={onRefreshLane}
          onRevalidate={onRevalidate}
          onWatchlist={onWatchlist}
        />
      ) : null}
    </section>
  );
}

function PortfolioMode({
  portfolio,
  onRun,
  onInspect
}: {
  portfolio: LoadState<PortfolioResult>;
  onRun: (tickers: string[]) => void;
  onInspect: (result: UtaTickerResult) => void;
}) {
  const [value, setValue] = useState(DEFAULT_PORTFOLIO.join(", "));
  const rows = portfolio.data?.results || [];
  return (
    <section className="mode-stack">
      <form className="command-bar" onSubmit={(event) => {
        event.preventDefault();
        onRun(tickerList(value));
      }}>
        <label htmlFor="portfolio-tickers">Portfolio</label>
        <input id="portfolio-tickers" className="wide-input" value={value} onChange={(event) => setValue(event.target.value)} />
        <button type="submit">Rank</button>
      </form>
      <section className="panel">
        <SectionHeader title="Portfolio Rank" meta="A is relative to your portfolio today" />
        {portfolio.status === "loading" ? <p className="empty">{portfolio.message}</p> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Tier</th>
                <th>A</th>
                <th>B</th>
                <th>C</th>
                <th>Direction</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.ticker} onClick={() => onInspect(row)} className="clickable-row">
                  <td>{row.ticker}</td>
                  <td>Tier {row.tier}</td>
                  <td>{row.indicators.A === null ? "N/A" : fmtPct(row.indicators.A.volume_percentile)}</td>
                  <td>{fmtNumber(row.indicators.B.notional_zscore)} sigma</td>
                  <td>{fmtMoney(row.indicators.C.focus_notional)}</td>
                  <td>{row.direction}</td>
                  <td>{row.data_state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && portfolio.status !== "loading" ? <p className="empty">No portfolio rows yet.</p> : null}
      </section>
    </section>
  );
}

function ScanMode({
  scan,
  pass2,
  onPass1,
  onPass2,
  onInspect
}: {
  scan: LoadState<ScanResult>;
  pass2: LoadState<ScanResult>;
  onPass1: (direction: string) => void;
  onPass2: () => void;
  onInspect: (result: UtaTickerResult) => void;
}) {
  const [direction, setDirection] = useState("bullish");
  const preliminaryRows = scan.data?.results || [];
  const resolvedRows = pass2.data?.results || [];
  return (
    <section className="mode-stack">
      <form className="command-bar" onSubmit={(event) => {
        event.preventDefault();
        onPass1(direction);
      }}>
        <label htmlFor="scan-direction">Direction</label>
        <select id="scan-direction" value={direction} onChange={(event) => setDirection(event.target.value)}>
          <option value="bullish">Bullish</option>
          <option value="bearish">Bearish</option>
        </select>
        <button type="submit">Pass 1</button>
        <button type="button" className="secondary" onClick={onPass2} disabled={!preliminaryRows.length}>Pass 2</button>
      </form>
      <div className="two-column">
        <section className="panel">
          <SectionHeader title="Scan Pass 1" meta={scan.data ? `${scan.data.universe_label} / ${scan.data.performance_tier}` : "preliminary"} />
          {scan.status === "loading" ? <p className="empty">{scan.message}</p> : null}
          <div className="compact-list">
            {preliminaryRows.map((row) => (
              <div className="compact-row" key={row.ticker}>
                <div>
                  <b>{row.ticker}</b>
                  <span>{row.label || "Preliminary - pass 2 pending"}</span>
                </div>
                <div className="row-metrics">
                  <Pill tone="warn">preliminary</Pill>
                  <span>{row.preliminary_tier || "n/a"}</span>
                </div>
              </div>
            ))}
            {!preliminaryRows.length ? <p className="empty">No preliminary scan rows yet.</p> : null}
          </div>
        </section>
        <section className="panel">
          <SectionHeader title="Scan Pass 2" meta="resolved evidence" />
          {pass2.status === "loading" ? <p className="empty">{pass2.message}</p> : null}
          <div className="compact-list">
            {resolvedRows.map((row) => (
              <div className="compact-row clickable-row" key={row.ticker} onClick={() => row.result && onInspect(row.result)}>
                <div>
                  <b>{row.ticker}</b>
                  <span>{row.status || row.pass2_status || "resolved"}</span>
                </div>
                <div className="row-metrics">
                  <Pill tone="good">resolved</Pill>
                  <span>{row.result ? `Tier ${row.result.tier}` : "n/a"}</span>
                </div>
              </div>
            ))}
            {!resolvedRows.length ? <p className="empty">No resolved scan rows yet.</p> : null}
          </div>
        </section>
      </div>
    </section>
  );
}

function AlertsMode({
  userState,
  history,
  activeData,
  onRulesChange,
  onReviewed,
  onIgnored
}: {
  userState: UserStateResult | null;
  history: HistoryResult | null;
  activeData?: UtaTickerResult;
  onRulesChange: (rules: UtaRule[]) => void;
  onReviewed: () => void;
  onIgnored: () => void;
}) {
  const rules = userState?.state.rules || [];
  const [draft, setDraft] = useState({
    name: "Tier B or better bullish",
    min_tier: "B",
    direction: "bullish"
  });
  const feedRows = [
    ...(history?.rows || []).map((row) => ({
      id: row.id || `${row.ticker}-${row.generated_at}`,
      title: `${row.ticker || "UTA"} ${row.tier ? `Tier ${row.tier}` : "cycle"}`,
      detail: `${row.mode || "cycle"} / ${row.direction || "n/a"} / ${fmtDate(row.generated_at || row.created_at)}`,
      source: "cycle"
    })),
    ...(history?.audit_log || []).map((row, index) => ({
      id: String(row.id || `audit-${index}`),
      title: String(row.event || row.type || "Audit event"),
      detail: JSON.stringify(row).slice(0, 120),
      source: "audit"
    }))
  ].slice(0, 10);

  function addRule() {
    const nextRule: UtaRule = {
      id: `user-rule-${Date.now()}`,
      name: draft.name.trim() || "Untitled UTA rule",
      enabled: true,
      min_tier: draft.min_tier,
      direction: draft.direction,
      source: "user"
    };
    onRulesChange([...rules, nextRule]);
  }

  function toggleRule(rule: UtaRule) {
    onRulesChange(rules.map((item) => item.id === rule.id ? { ...item, enabled: !item.enabled } : item));
  }

  function deleteRule(rule: UtaRule) {
    onRulesChange(rules.filter((item) => item.id !== rule.id));
  }

  return (
    <section className="mode-stack">
      <div className="two-column">
        <section className="panel">
          <SectionHeader title="Activity Feed" meta={`${feedRows.length} events`} />
          <div className="compact-list">
            {feedRows.map((row) => (
              <div className="compact-row" key={row.id}>
                <div>
                  <b>{row.title}</b>
                  <span>{row.detail}</span>
                </div>
                <Pill tone={row.source === "cycle" ? "good" : "neutral"}>{row.source}</Pill>
              </div>
            ))}
            {!feedRows.length ? <p className="empty">No UTA activity yet.</p> : null}
          </div>
        </section>
        <section className="panel">
          <SectionHeader title="Live Match Preview" meta={activeData ? activeData.ticker : "no ticker"} />
          <div className="metric-grid">
            <MetricTile label="Ticker" value={activeData?.ticker || "N/A"} />
            <MetricTile label="Tier" value={activeData ? `Tier ${activeData.tier}` : "N/A"} />
            <MetricTile label="Direction" value={activeData?.direction || "N/A"} />
          </div>
          <div className="compact-list preview-list">
            {rules.map((rule) => (
              <div className="compact-row" key={rule.id}>
                <div>
                  <b>{rule.name}</b>
                  <span>Min Tier {rule.min_tier} / {rule.direction}</span>
                </div>
                <Pill tone={ruleMatches(rule, activeData) ? "good" : "neutral"}>
                  {ruleMatches(rule, activeData) ? "match" : "no match"}
                </Pill>
              </div>
            ))}
            {!rules.length ? <p className="empty">No rules configured.</p> : null}
          </div>
          <div className="action-row">
            <button type="button" onClick={onReviewed}>Reviewed</button>
            <button type="button" className="secondary" onClick={onIgnored}>Ignored</button>
          </div>
        </section>
      </div>

      <section className="panel">
        <SectionHeader title="Rule Editor" meta="user rules only" />
        <div className="command-bar inline-editor">
          <label htmlFor="rule-name">Name</label>
          <input
            id="rule-name"
            className="wide-input"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
          <label htmlFor="rule-tier">Min tier</label>
          <select id="rule-tier" value={draft.min_tier} onChange={(event) => setDraft({ ...draft, min_tier: event.target.value })}>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
          <label htmlFor="rule-direction">Direction</label>
          <select id="rule-direction" value={draft.direction} onChange={(event) => setDraft({ ...draft, direction: event.target.value })}>
            <option value="bullish">Bullish</option>
            <option value="bearish">Bearish</option>
            <option value="any">Any</option>
          </select>
          <button type="button" onClick={addRule}>Add Rule</button>
        </div>
        <div className="rule-table">
          {rules.map((rule) => (
            <div className="rule-row" key={rule.id}>
              <div>
                <b>{rule.name}</b>
                <span>{rule.source === "default" ? "default rule" : "user rule"} / min Tier {rule.min_tier} / {rule.direction}</span>
              </div>
              <div className="action-row">
                <Pill tone={rule.enabled ? "good" : "neutral"}>{rule.enabled ? "enabled" : "disabled"}</Pill>
                <button type="button" className="secondary" onClick={() => toggleRule(rule)}>
                  {rule.enabled ? "Disable" : "Enable"}
                </button>
                {rule.source === "default" ? null : (
                  <button type="button" className="secondary" onClick={() => deleteRule(rule)}>Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function RuntimeMode({
  runtime,
  providers,
  scheduler,
  history,
  stream,
  onSchedulerToggle,
  onRefreshRuntime
}: {
  runtime: LoadState<RuntimeStatus>;
  providers: LoadState<ProviderStatus>;
  scheduler: LoadState<SchedulerResult>;
  history: HistoryResult | null;
  stream: ReturnType<typeof useSseEvents>;
  onSchedulerToggle: (enabled: boolean) => void;
  onRefreshRuntime: () => void;
}) {
  const status = runtime.data;
  const providerStatus = providers.data || status?.provider_status;
  const liveReady = Boolean(providerStatus?.live_ready);
  return (
    <section className="mode-stack">
      <section className={`status-strip ${liveReady ? "ok" : "error"}`}>
        <div>
          <strong>{liveReady ? "Live providers ready" : "Replay-first mode"}</strong>
          <span>
            {liveReady
              ? "Massive-required lanes are configured for manual validation. Tier calculations remain replay-backed until the live UTA analysis gate is implemented."
              : "The dashboard is not yet a live Massive signal engine. Configure all required providers, then run manual live parity before promoting live results."}
          </span>
        </div>
        <Pill tone={liveReady ? "good" : "warn"}>{providerStatus?.mode || "replay_first"}</Pill>
      </section>
      <div className="runtime-grid">
        <section className="panel">
          <SectionHeader title="Runtime" meta={status?.mode || runtime.status} />
          <div className="metric-grid four">
            <MetricTile label="Signals" value={status?.signal_result_count ?? "N/A"} />
            <MetricTile label="Replay runs" value={status?.replay_run_count ?? "N/A"} />
            <MetricTile label="Required not ready" value={status?.lane_pressure.required_not_ready ?? "N/A"} />
            <MetricTile label="Storage" value={status?.pi_policy.storage || "N/A"} />
          </div>
          <div className="action-row">
            <button type="button" onClick={onRefreshRuntime}>Refresh</button>
            <Pill tone={status?.pi_policy.auto_start_heavy_jobs ? "bad" : "good"}>Pi heavy auto-start off</Pill>
            <Pill tone={status?.pi_policy.api_saver_blocks_heavy_autostart ? "warn" : "neutral"}>API saver policy</Pill>
          </div>
        </section>
        <section className="panel">
          <SectionHeader title="Scheduler" meta={scheduler.data?.scheduler?.mode || "manual"} />
          <div className="compact-list">
            <div className="compact-row">
              <div>
                <b>{scheduler.data?.scheduler?.enabled ? "Enabled" : "Manual"}</b>
                <span>{scheduler.data?.policy || "Pi v1 scheduler policy pending."}</span>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => onSchedulerToggle(!scheduler.data?.scheduler?.enabled)}
              >
                {scheduler.data?.scheduler?.enabled ? "Disable" : "Dry Run"}
              </button>
            </div>
            <div className="compact-row">
              <div>
                <b>Next run</b>
                <span>{fmtDate(scheduler.data?.scheduler?.next_run_at)}</span>
              </div>
              <Pill tone="neutral">manual/dry-run</Pill>
            </div>
          </div>
        </section>
      </div>
      <div className="two-column">
        <section className="panel">
          <SectionHeader
            title="Provider Readiness"
            meta={providerStatus?.live_ready ? "manual live ready" : providers.status}
          />
          <div className="metric-grid three">
            <MetricTile
              label="Required configured"
              value={`${providerStatus?.summary.required_configured ?? "N/A"} / ${providerStatus?.summary.required_total ?? "N/A"}`}
            />
            <MetricTile
              label="Optional configured"
              value={`${providerStatus?.summary.optional_configured ?? "N/A"} / ${providerStatus?.summary.optional_total ?? "N/A"}`}
            />
            <MetricTile
              label="Auto-start"
              value={providerStatus?.summary.auto_start_allowed ?? "N/A"}
              detail="kept off for Pi"
            />
          </div>
          <div className="compact-list provider-list">
            {(providerStatus?.provider_lanes || []).slice(0, 8).map((lane) => (
              <div className="compact-row" key={`${lane.lane_id}-${lane.provider_family}`}>
                <div>
                  <b>{lane.label}</b>
                  <span>{lane.provider_family} / {lane.provider} / fallback {lane.state_if_unavailable}</span>
                </div>
                <div className="row-metrics">
                  <Pill tone={lane.configured ? "good" : lane.required ? "warn" : "neutral"}>
                    {lane.configured ? "configured" : "missing"}
                  </Pill>
                  <Pill tone={lane.auto_start_allowed ? "bad" : "good"}>manual</Pill>
                </div>
              </div>
            ))}
            {!providerStatus?.provider_lanes?.length ? <p className="empty">Provider readiness has not loaded yet.</p> : null}
          </div>
        </section>
        <section className="panel">
          <SectionHeader title="SSE Events" meta={stream.state} />
          <div className="compact-list">
            {stream.events.map((event, index) => (
              <div className="compact-row" key={`${event.received_at}-${index}`}>
                <div>
                  <b>{event.type}</b>
                  <span>{event.payload}</span>
                </div>
                <small>{fmtDate(event.received_at)}</small>
              </div>
            ))}
            {!stream.events.length ? <p className="empty">Waiting for runtime events.</p> : null}
          </div>
        </section>
        <CycleHistory history={history} />
      </div>
    </section>
  );
}

function App() {
  const [mode, setMode] = useState<Mode>("single");
  const [activeTicker, setActiveTicker] = useState("AVGO");
  const [singleSourceMode, setSingleSourceMode] = useState<SingleSourceMode>("replay");
  const [single, setSingle] = useState<LoadState<UtaTickerResult>>({ status: "idle" });
  const [portfolio, setPortfolio] = useState<LoadState<PortfolioResult>>({ status: "idle" });
  const [scan, setScan] = useState<LoadState<ScanResult>>({ status: "idle" });
  const [pass2, setPass2] = useState<LoadState<ScanResult>>({ status: "idle" });
  const [runtime, setRuntime] = useState<LoadState<RuntimeStatus>>({ status: "idle" });
  const [providers, setProviders] = useState<LoadState<ProviderStatus>>({ status: "idle" });
  const [history, setHistory] = useState<HistoryResult | null>(null);
  const [scheduler, setScheduler] = useState<LoadState<SchedulerResult>>({ status: "idle" });
  const [userState, setUserState] = useState<UserStateResult | null>(null);
  const stream = useSseEvents();

  const activeData = single.data;
  const watchlistCount = userState?.state.watchlist?.length || 0;

  async function loadSingle(ticker = activeTicker, sourceMode = singleSourceMode) {
    const normalized = ticker.trim().toUpperCase() || "AVGO";
    setActiveTicker(normalized);
    setSingleSourceMode(sourceMode);
    setSingle((current) => ({ status: "loading", data: current.data, message: `Loading ${normalized} from ${sourceMode}...` }));
    const data = await apiGet<UtaTickerResult>(`/api/uta/single?ticker=${encodeURIComponent(normalized)}&source=${encodeURIComponent(sourceMode)}`);
    setSingle({ status: "ready", data });
    const nextHistory = await apiGet<HistoryResult>(`/api/uta/history?ticker=${encodeURIComponent(normalized)}&limit=20`);
    setHistory(nextHistory);
  }

  async function loadRuntime() {
    setRuntime((current) => ({ status: "loading", data: current.data, message: "Refreshing runtime..." }));
    setProviders((current) => ({ status: "loading", data: current.data, message: "Refreshing providers..." }));
    const [runtimeData, providerData, schedulerData, historyData, stateData] = await Promise.all([
      apiGet<RuntimeStatus>("/api/uta/runtime"),
      apiGet<ProviderStatus>("/api/uta/providers"),
      apiGet<SchedulerResult>("/api/uta/scheduler"),
      apiGet<HistoryResult>("/api/uta/history?limit=20"),
      apiGet<UserStateResult>("/api/uta/user-state")
    ]);
    setRuntime({ status: "ready", data: runtimeData });
    setProviders({ status: "ready", data: providerData });
    setScheduler({ status: "ready", data: schedulerData });
    setHistory(historyData);
    setUserState(stateData);
  }

  async function runPortfolio(tickers = DEFAULT_PORTFOLIO) {
    setPortfolio((current) => ({ status: "loading", data: current.data, message: "Ranking portfolio..." }));
    const data = await apiPost<PortfolioResult>("/api/uta/portfolio", { tickers });
    setPortfolio({ status: "ready", data });
    await loadRuntime();
  }

  async function runScan(direction = "bullish") {
    setScan((current) => ({ status: "loading", data: current.data, message: "Running pass 1..." }));
    const data = await apiGet<ScanResult>(`/api/uta/scan?universe=sp500&direction=${encodeURIComponent(direction)}&pass=1`);
    setScan({ status: "ready", data });
    await loadRuntime();
  }

  async function runPass2() {
    const shortlist = (scan.data?.results || []).map((row) => row.ticker);
    setPass2((current) => ({ status: "loading", data: current.data, message: "Resolving pass 2..." }));
    const data = await apiPost<ScanResult>("/api/uta/scan/pass2", { shortlist: shortlist.length ? shortlist : ["AVGO"] });
    setPass2({ status: "ready", data });
    await loadRuntime();
  }

  async function refreshLane(lane: LaneState) {
    await apiPost(`/api/uta/lanes/${encodeURIComponent(lane.lane_id)}/refresh`, {});
    await loadSingle(activeTicker, singleSourceMode);
  }

  async function revalidateActive() {
    setSingle((current) => ({ status: "loading", data: current.data, message: `Revalidating ${activeTicker} from ${singleSourceMode}...` }));
    const data = await apiPost<UtaTickerResult>("/api/uta/revalidate", { ticker: activeTicker, source: singleSourceMode });
    setSingle({ status: "ready", data });
    await loadRuntime();
  }

  async function toggleWatchlist() {
    const current = userState?.state.watchlist || [];
    const next = current.includes(activeTicker) ? current.filter((ticker) => ticker !== activeTicker) : [...current, activeTicker];
    const updated = await apiPost<UserStateResult>("/api/uta/user-state/watchlist", { watchlist: next });
    setUserState(updated);
  }

  async function updateRules(rules: UtaRule[]) {
    const updated = await apiPost<UserStateResult>("/api/uta/user-state/rules", { rules });
    setUserState(updated);
  }

  async function markActiveReviewed() {
    const reviewed = {
      ...(userState?.state.reviewed || {}),
      [activeTicker]: { ticker: activeTicker, reviewed_at: new Date().toISOString() }
    };
    const updated = await apiPost<UserStateResult>("/api/uta/user-state/reviewed", { reviewed });
    setUserState(updated);
  }

  async function markActiveIgnored() {
    const ignored = {
      ...(userState?.state.ignored || {}),
      [activeTicker]: { ticker: activeTicker, ignored_at: new Date().toISOString() }
    };
    const updated = await apiPost<UserStateResult>("/api/uta/user-state/ignored", { ignored });
    setUserState(updated);
  }

  async function toggleScheduler(enabled: boolean) {
    setScheduler((current) => ({ status: "loading", data: current.data, message: "Updating scheduler..." }));
    const updated = await apiPost<SchedulerResult>("/api/uta/scheduler", { enabled });
    setScheduler({ status: "ready", data: updated });
    await loadRuntime();
  }

  useEffect(() => {
    loadSingle("AVGO").catch((error) => setSingle({ status: "error", message: error.message }));
    loadRuntime().catch((error) => setRuntime({ status: "error", message: error.message }));
    runPortfolio(DEFAULT_PORTFOLIO).catch((error) => setPortfolio({ status: "error", message: error.message }));
  }, []);

  const modeBody = useMemo(() => {
    if (mode === "portfolio") {
      return (
        <PortfolioMode
          portfolio={portfolio}
          onRun={(tickers) => runPortfolio(tickers).catch((error) => setPortfolio({ status: "error", message: error.message }))}
          onInspect={(result) => {
            setSingle({ status: "ready", data: result });
            setActiveTicker(result.ticker);
            setMode("single");
          }}
        />
      );
    }
    if (mode === "scan") {
      return (
        <ScanMode
          scan={scan}
          pass2={pass2}
          onPass1={(direction) => runScan(direction).catch((error) => setScan({ status: "error", message: error.message }))}
          onPass2={() => runPass2().catch((error) => setPass2({ status: "error", message: error.message }))}
          onInspect={(result) => {
            setSingle({ status: "ready", data: result });
            setActiveTicker(result.ticker);
            setMode("single");
          }}
        />
      );
    }
    if (mode === "alerts") {
      return (
        <AlertsMode
          userState={userState}
          history={history}
          activeData={single.data}
          onRulesChange={(rules) => updateRules(rules).catch((error) => setRuntime({ status: "error", data: runtime.data, message: error.message }))}
          onReviewed={() => markActiveReviewed().catch((error) => setRuntime({ status: "error", data: runtime.data, message: error.message }))}
          onIgnored={() => markActiveIgnored().catch((error) => setRuntime({ status: "error", data: runtime.data, message: error.message }))}
        />
      );
    }
    if (mode === "runtime") {
      return (
        <RuntimeMode
          runtime={runtime}
          providers={providers}
          scheduler={scheduler}
          history={history}
          stream={stream}
          onSchedulerToggle={(enabled) => toggleScheduler(enabled).catch((error) => setScheduler({ status: "error", message: error.message }))}
          onRefreshRuntime={() => loadRuntime().catch((error) => setRuntime({ status: "error", message: error.message }))}
        />
      );
    }
    return (
      <SingleMode
        data={single}
        history={history}
        sourceMode={singleSourceMode}
        onAnalyze={(ticker, sourceMode) => loadSingle(ticker, sourceMode).catch((error) => setSingle({ status: "error", data: single.data, message: error.message }))}
        onSourceModeChange={setSingleSourceMode}
        onRefreshLane={(lane) => refreshLane(lane).catch((error) => setSingle({ status: "error", data: single.data, message: error.message }))}
        onRevalidate={() => revalidateActive().catch((error) => setSingle({ status: "error", data: single.data, message: error.message }))}
        onWatchlist={() => toggleWatchlist().catch((error) => setRuntime({ status: "error", data: runtime.data, message: error.message }))}
      />
    );
  }, [mode, single, portfolio, scan, pass2, runtime, providers, scheduler, history, stream, activeTicker, singleSourceMode, userState]);

  return (
    <main className="uta-shell">
      <header className="uta-topbar">
        <div>
          <span className="crumb">
            UTA / {providers.data?.live_ready ? "Massive ready, replay analysis" : "replay-first runtime"}
          </span>
          <h1>Unusual Trading Activity Agent</h1>
        </div>
        <div className="topbar-meta">
          <Pill tone={providers.data?.live_ready ? "good" : "warn"}>
            {providers.data?.live_ready ? "Massive ready" : "Massive gated"}
          </Pill>
          <Pill tone={runtime.data?.lane_pressure.required_not_ready ? "warn" : "good"}>
            required lanes {runtime.data?.lane_pressure.required_not_ready ?? 0}
          </Pill>
          <Pill tone="neutral">watchlist {watchlistCount}</Pill>
          <Pill tone={stream.state === "connected" ? "good" : "warn"}>SSE {stream.state}</Pill>
        </div>
      </header>
      <nav className="mode-tabs" aria-label="UTA modes">
        {[
          ["single", "Single"],
          ["portfolio", "Portfolio"],
          ["scan", "Scan"],
          ["alerts", "Alerts"],
          ["runtime", "Runtime"]
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={mode === id ? "active" : ""}
            onClick={() => setMode(id as Mode)}
          >
            {label}
          </button>
        ))}
      </nav>
      {activeData && mode !== "single" ? (
        <section className="context-strip">
          <span>{activeData.ticker} / Tier {activeData.tier} / {activeData.direction}</span>
          <span>Direction source: {activeData.calculation_metadata.direction_source}</span>
        </section>
      ) : null}
      {modeBody}
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
