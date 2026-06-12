// src/uta/src/modes.tsx
import React, { FormEvent, useEffect, useMemo, useState } from "react";
import {
  fmtDate, fmtMoney, fmtPct, fmtNumber, tickerList,
  DEFAULT_PORTFOLIO, invariantWarnings
} from "./utils.js";
import { Pill, SectionHeader, MetricTile, TierBadge, DirTag } from "./components.js";
import { BlufCard, CorroborationPanel, ActionsPanel, EvidenceCards, LaneHealth, DataProvenance } from "./evidence.js";
import { TradeAnalysisPanel } from "./trade-analysis.js";
import { CycleHistory, RawPrintsDrawer, ExplainTierPanel } from "./detail-extras.js";
import type {
  UtaTickerResult, PortfolioResult, RuntimeStatus, ProviderStatus,
  SchedulerResult, HistoryResult, LaneState, LoadState
} from "./types.js";

export function useSseEvents() {
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

function toneForTier(tier?: string) {
  if (tier === "A") return "good";
  if (tier === "B") return "warn";
  if (tier === "C") return "neutral";
  return "bad";
}

export function StatusStrip({ data }: { data: UtaTickerResult }) {
  const warnings = invariantWarnings(data);
  return (
    <section className={`status-strip ${warnings.length ? "error" : "ok"}`}>
      <div>
        <strong>{warnings.length ? "Invariant warning" : "Live analysis"}</strong>
        <span>
          {warnings.length
            ? warnings.join(" ")
            : `Loaded ${data.ticker} from ${data.calculation_metadata.source_mode || data.data_state}. Direction source: ${data.calculation_metadata.direction_source}.`}
        </span>
      </div>
      <Pill tone={data.data_state === "live_unavailable" ? "warn" : "good"}>{data.data_state}</Pill>
    </section>
  );
}

export function CompareBanner({ data }: { data: UtaTickerResult }) {
  const maxB = data.trade_analysis?.activity.max_b_zscore ?? data.indicators.B.notional_zscore;
  return (
    <section className="compare-banner cmp-panel" data-ux-source="ux design/detail-extras.jsx:CompareBanner">
      <span className="cmp-eye">Δ</span>
      <div>
        <b>Compare to prior cycle</b>
        <span>B peak now {fmtNumber(maxB, 2)}σ · signed pressure {fmtPct(data.trade_analysis?.pressure.net_notional_pressure)} · tier {data.tier}</span>
      </div>
    </section>
  );
}

export function TickerDetail({
  data, history, isWatchlisted, onRevalidate, onToggleWatchlist, onRefreshLane
}: {
  data: UtaTickerResult;
  history: HistoryResult | null;
  isWatchlisted: boolean;
  onRevalidate: () => void;
  onToggleWatchlist: () => void;
  onRefreshLane: (lane: LaneState) => void;
}) {
  const [showRawPrints, setShowRawPrints] = useState(false);
  const [showExplainTier, setShowExplainTier] = useState(false);
  const [activeTab, setActiveTab] = useState<"evidence" | "trade">("evidence");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const analysis = data.trade_analysis as any;
  const evidenceContextChip = analysis
    ? `${String(analysis.bias || "").charAt(0).toUpperCase() + String(analysis.bias || "").slice(1)} · ${String(analysis.setup_status || "").replaceAll("_", " ")}`
    : null;
  const tradeContextChip = `Tier ${data.tier} · ${fmtNumber(data.indicators.B.notional_zscore, 1)}σ vol`;

  return (
    <div className="layout">
      <div className="main-col">
        <StatusStrip data={data} />
        <BlufCard data={data} />
        <div className="detail-tabs">
          <button
            type="button"
            className={`detail-tab ${activeTab === "evidence" ? "active" : ""}`}
            onClick={() => setActiveTab("evidence")}
          >
            Evidence
            {activeTab !== "evidence" && tradeContextChip
              ? <span className="tab-ctx-chip">{tradeContextChip}</span>
              : null}
          </button>
          <button
            type="button"
            className={`detail-tab ${activeTab === "trade" ? "active" : ""}`}
            onClick={() => setActiveTab("trade")}
          >
            Trade Analysis
            {activeTab !== "trade" && evidenceContextChip
              ? <span className="tab-ctx-chip">{evidenceContextChip}</span>
              : null}
          </button>
        </div>
        {activeTab === "evidence" && (
          <div className="detail-tab-content">
            <CycleHistory ticker={data.ticker} history={history} />
            <EvidenceCards cards={data.evidence_cards || []} data={data} />
          </div>
        )}
        {activeTab === "trade" && (
          <div className="detail-tab-content">
            <TradeAnalysisPanel data={data} />
          </div>
        )}
      </div>
      <div className="side-col">
        <CorroborationPanel data={data} />
        <ActionsPanel
          data={data}
          onRevalidate={onRevalidate}
          onRawPrints={() => setShowRawPrints(true)}
          onExplainTier={() => setShowExplainTier(true)}
          onCompare={() => {}}
          onWatchlist={onToggleWatchlist}
          onRefreshLane={() => data.lane_states[0] && onRefreshLane(data.lane_states[0])}
        />
        <LaneHealth lanes={data.lane_states || []} onRefresh={onRefreshLane} />
      </div>
      {showRawPrints && <RawPrintsDrawer data={data} open={showRawPrints} onClose={() => setShowRawPrints(false)} />}
      {showExplainTier && <ExplainTierPanel data={data} open={showExplainTier} onClose={() => setShowExplainTier(false)} />}
    </div>
  );
}

export function SingleMode({
  data,
  history,
  isWatchlisted,
  onAnalyze,
  onRefreshLane,
  onRevalidate,
  onToggleWatchlist
}: {
  data: LoadState<UtaTickerResult>;
  history: HistoryResult | null;
  isWatchlisted: boolean;
  onAnalyze: (ticker: string) => void;
  onRefreshLane: (lane: LaneState) => void;
  onRevalidate: () => void;
  onToggleWatchlist: () => void;
}) {
  const [ticker, setTicker] = useState("AVGO");
  return (
    <section className="mode-stack">
      <form className="command-bar" onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onAnalyze(ticker.trim().toUpperCase() || "AVGO");
      }}>
        <label htmlFor="single-ticker">Ticker</label>
        <input id="single-ticker" value={ticker} onChange={(event) => setTicker(event.target.value)} autoComplete="off" />
        <button type="submit">Analyze</button>
      </form>
      {data.status === "loading" ? <section className="panel muted-panel">{data.message}</section> : null}
      {data.status === "error" ? <section className="panel error-panel">{data.message}</section> : null}
      {data.data ? (
        <TickerDetail
          data={data.data}
          history={history}
          isWatchlisted={isWatchlisted}
          onRefreshLane={onRefreshLane}
          onRevalidate={onRevalidate}
          onToggleWatchlist={onToggleWatchlist}
        />
      ) : null}
    </section>
  );
}

export function PortfolioMode({
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
        <SectionHeader title="Portfolio Rank" meta={portfolio.data?.data_state === "live_manual" ? "A is relative to this live sample" : "A is relative to your portfolio today"} />
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
                  <td>{row.indicators.A === null ? "N/A" : fmtPct((row.indicators.A as Record<string, unknown>).volume_percentile)}</td>
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

export function RuntimeMode({
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
          <strong>{liveReady ? "Live providers ready" : "Live providers gated"}</strong>
          <span>
            {liveReady
              ? "Massive-required lanes are configured. Live UTA analysis uses provider data and does not fall back to fixtures."
              : "Configure all required providers before live UTA can produce signal results. Missing providers create unavailable lane states."}
          </span>
        </div>
        <Pill tone={liveReady ? "good" : "warn"}>{providerStatus?.mode || "live_only"}</Pill>
      </section>
      <div className="runtime-grid">
        <section className="panel">
          <SectionHeader title="Runtime" meta={status?.mode || runtime.status} />
          <div className="metric-grid four">
            <MetricTile label="Signals" value={status?.signal_result_count ?? "N/A"} />
            <MetricTile label="Cycle runs" value={status?.replay_run_count ?? "N/A"} />
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
        <CycleHistory ticker="runtime" history={null} />
      </div>
    </section>
  );
}
