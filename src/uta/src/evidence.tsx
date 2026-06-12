// src/uta/src/evidence.tsx
import React, { useState } from "react";
import { fmtMoney, fmtPct, fmtNumber, fmtDate } from "./utils.js";
import { Pill, SectionHeader, MetricTile, TierBadge, DirTag, BandTag, IndicatorGrid, VolBars, volMetricsFromResult, PressureGauge, ConfBar, MixBar, Sparkline, type MixSegment } from "./components.js";
import type { UtaTickerResult, LaneState, EvidenceCard } from "./types.js";

export function BlufCard({ data, portfolioMode = false }: { data: UtaTickerResult; portfolioMode?: boolean }) {
  const analysis = data.trade_analysis;
  const rows = [
    ["What happened", data.bluf.what_happened],
    ["Why it matters", data.bluf.why_it_matters],
    ["What to check", data.bluf.what_to_check],
    ["Limitations", data.bluf.limitations]
  ];
  return (
    <section className="panel card bluf bluf-card" data-ux-source="ux design/evidence.jsx:BlufCard">
      <div className="bluf-head">
        <TierBadge tier={data.tier} size="lg" />
        <div>
          <span className="crumb">{portfolioMode ? "Portfolio detail" : "Single ticker"} / BLUF</span>
          <div className="bluf-headline">{data.bluf.headline}</div>
          <div className="bluf-meta">
            <DirTag direction={data.direction} />
            <BandTag band={analysis?.anomaly_band} />
            <Pill tone="neutral">Direction confidence {fmtPct(data.signing_confidence)}</Pill>
          </div>
        </div>
        <div className="bluf-aside uplabel">BLUF · as of {fmtDate(data.generated_at)}</div>
      </div>
      <IndicatorGrid data={data} portfolioMode={portfolioMode} />
      <div className="bluf-grid">
        {rows.map(([label, value]) => (
          <div className="bluf-row" key={label}>
            <div className="bluf-k">{label}</div>
            <div className="bluf-v">{value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function CorroborationPanel({ data }: { data: UtaTickerResult }) {
  const corr = data.trade_analysis?.corroboration || {};
  const rows = [
    ["Price action aligned", corr.price_action_aligned, "Strong"],
    ["Provider alert confirmed", corr.provider_alert_confirmed, "Strong"],
    ["Options flow aligned", corr.options_flow_aligned, "Strong"],
    ["Pre-market + regular elevated", corr.premarket_regular_elevated, "Moderate"],
    ["News catalyst present", corr.news_catalyst_present, "Contextual"],
    ["Macro regime supports", corr.macro_regime_supports, "Contextual"]
  ] as const;
  return (
    <section className="panel">
      <SectionHeader title="Corroboration" meta={`${corr.independent_strong_count || 0} strong confirmations`} />
      <div className="corr-list">
        {rows.map(([label, passed, level]) => (
          <div className={`corr-row ${passed ? "on" : "off"}`} key={label}>
            <span>{passed ? "✓" : "–"}</span>
            <div>
              <b>{label}</b>
              <small>{level} independence</small>
            </div>
          </div>
        ))}
      </div>
      <p>{corr.note || "Tier A requires at least one independent strong corroboration. Optional lanes never penalize when absent."}</p>
    </section>
  );
}

export function ActionsPanel({
  data,
  onRefreshLane,
  onRevalidate,
  onWatchlist,
  onRawPrints,
  onExplainTier,
  onCompare,
  compare
}: {
  data: UtaTickerResult;
  onRefreshLane?: (lane: LaneState) => void;
  onRevalidate?: () => void;
  onWatchlist?: () => void;
  onRawPrints?: () => void;
  onExplainTier?: () => void;
  onCompare?: () => void;
  compare?: boolean;
}) {
  const firstRefreshable = data.lane_states.find((lane) => lane.next_action) || data.lane_states[0];
  return (
    <section className="panel card actions-panel" data-ux-source="ux design/evidence.jsx:ActionsPanel">
      <SectionHeader title="Actions" meta="human review controls" />
      <button type="button" className="action-btn" onClick={onRevalidate}>Revalidate ticker</button>
      <button type="button" className="action-btn" onClick={onRawPrints}>Raw Prints</button>
      <button type="button" className="action-btn" onClick={onExplainTier}>Explain Tier</button>
      <button type="button" className={`action-btn ${compare ? "on" : ""}`} onClick={onCompare}>{compare ? "Hide compare" : "Compare to prior cycle"}</button>
      <button type="button" className="action-btn" onClick={onWatchlist}>Add to watchlist</button>
      <button type="button" className="action-btn" onClick={() => firstRefreshable && onRefreshLane?.(firstRefreshable)}>
        Refresh lane
      </button>
      <div className="action-note">
        <b>Supporting evidence only</b>
        <span>UTA cannot place trades or bypass risk/execution gates. Use Tier A/B as a review prompt, not an instruction.</span>
      </div>
    </section>
  );
}

function VolumeAnomalyBody({ data }: { data: UtaTickerResult }) {
  const C = data.indicators.C;
  const B = data.indicators.B;
  const metrics = volMetricsFromResult(data, data.direction);
  return (
    <div className="ev-body-inner">
      <VolBars metrics={metrics} />
      <div className="ev-stat-row">
        <MetricTile label="Volume ratio" value={`${fmtNumber(C.volume_ratio, 2)}×`} detail="vs 20-day baseline" />
        <MetricTile label="Notional ratio" value={`${fmtNumber(C.notional_ratio, 2)}×`} detail="vs 20-day baseline" />
        <MetricTile label="B-score (notional)" value={`${fmtNumber(B.notional_zscore, 2)}σ`} detail="z-score vs history" />
      </div>
    </div>
  );
}

function BlockOffExchangeBody({ data }: { data: UtaTickerResult }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bf = (data.trade_analysis as any)?.block_flow;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ta = data.trade_analysis as any;
  const trfShare = Number(ta?.block_flow?.trf_share ?? 0);
  const litShare = 1 - trfShare;
  const venueMix: MixSegment[] = [
    { label: "Off-exchange (TRF)", value: trfShare, colour: "var(--accent)" },
    { label: "Lit markets", value: litShare, colour: "var(--panel-3)" }
  ];
  return (
    <div className="ev-body-inner">
      <div className="ev-stat-row">
        <MetricTile label="Focus prints" value={bf?.focus_trade_count ?? 0} detail="block / off-exchange" />
        <MetricTile label="Focus notional" value={fmtMoney(bf?.focus_notional)} detail="total focus flow" />
        <MetricTile label="Largest print" value={fmtMoney(bf?.largest_print_notional)} detail={bf?.largest_print_multiple ? `${fmtNumber(bf.largest_print_multiple, 1)}× ADV` : "—"} />
      </div>
      <div className="ev-sub-label">Venue split</div>
      <MixBar segments={venueMix} />
    </div>
  );
}

function DirectionalPressureBody({ data }: { data: UtaTickerResult }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pressure = (data.trade_analysis as any)?.pressure;
  const C = data.indicators.C;
  const signingConf = data.signing_confidence;
  const netPressure = Number(C.net_notional_pressure ?? 0);
  return (
    <div className="ev-body-inner">
      <div className="ev-sub-label">Net pressure</div>
      <PressureGauge value={netPressure} />
      <div className="ev-stat-row">
        <MetricTile label="Net notional pressure" value={`${fmtNumber(netPressure * 100, 1)}%`} detail={pressure?.direction || "—"} />
        <MetricTile label="Signing confidence" value={fmtPct(signingConf)} detail="print signing" />
      </div>
      <div className="ev-sub-label">Signing confidence</div>
      <ConfBar value={signingConf} />
      {pressure?.interpretation ? <p className="ev-interp">{pressure.interpretation}</p> : null}
    </div>
  );
}

function PreMarketBody({ data }: { data: UtaTickerResult }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const act = (data.trade_analysis as any)?.activity;
  const hasPreMarket = act && (act.volume_ratio ?? 0) > 0;
  if (!hasPreMarket) {
    return (
      <div className="ev-body">
        <p className="ev-empty">No pre-market prints in this session.</p>
      </div>
    );
  }
  return (
    <div className="ev-body-inner">
      <div className="ev-stat-row">
        <MetricTile label="Pre-mkt vol ratio" value={`${fmtNumber(act.volume_ratio, 2)}×`} detail="vs session baseline" />
        <MetricTile label="Notional ratio" value={`${fmtNumber(act.notional_ratio, 2)}×`} detail="vs session baseline" />
        <MetricTile label="Latest bar" value={fmtDate(act.latest_bar_date)} detail="last bar timestamp" />
      </div>
      <p className="ev-interp">
        Pre-market volume signals persist with approximately 60-minute half-life into the regular session.
      </p>
    </div>
  );
}

function MarketFlowTrendBody({ data }: { data: UtaTickerResult }) {
  const B = data.indicators.B;
  const C = data.indicators.C;
  const netPressure = Number(C.net_notional_pressure ?? 0);
  const bScore = Number(B.notional_zscore ?? 0);
  const syntheticValues = [0, netPressure * 0.4, netPressure * 0.7, netPressure * bScore * 0.3, netPressure];
  const trend = netPressure > 0.1 ? "Building" : netPressure < -0.1 ? "Fading" : "Flat";
  const trendColour = trend === "Building" ? "var(--buy)" : trend === "Fading" ? "var(--sell)" : undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const analyzedPrints = (data.trade_analysis as any)?.activity?.analyzed_prints ?? "N/A";
  return (
    <div className="ev-body-inner">
      <div className="ev-trend-label" style={{ color: trendColour || "var(--ink-2)" }}>{trend}</div>
      <Sparkline values={syntheticValues} baseline={0} colour={trendColour} height={56} />
      <div className="ev-stat-row">
        <MetricTile label="Pressure delta" value={`${fmtNumber(netPressure * 100, 1)}%`} detail="net notional" />
        <MetricTile label="B-score" value={`${fmtNumber(bScore, 2)}σ`} detail="notional z-score" />
        <MetricTile label="Analyzed prints" value={analyzedPrints} detail="this session" />
      </div>
    </div>
  );
}

function EvCard({ card, defaultOpen, data }: { card: EvidenceCard; defaultOpen: boolean; data: UtaTickerResult }) {
  const [open, setOpen] = useState(defaultOpen);

  function renderBody() {
    if (card.id === "volume_anomaly") return <VolumeAnomalyBody data={data} />;
    if (card.id === "block_off_exchange") return <BlockOffExchangeBody data={data} />;
    if (card.id === "directional_pressure") return <DirectionalPressureBody data={data} />;
    if (card.id === "pre_market_activity") return <PreMarketBody data={data} />;
    if (card.id === "market_flow_trend") return <MarketFlowTrendBody data={data} />;
    // Cards 6–9: text fallback
    return (
      <div className="ev-body">
        <p>{card.summary}</p>
      </div>
    );
  }

  return (
    <article className={`ev-card ${open ? "open" : "ev-collapsed"} ${card.status}`} data-card-id={card.id}>
      <button className="ev-head" type="button" onClick={() => setOpen((current) => !current)}>
        <span className="ico">{card.title.slice(0, 1)}</span>
        <span className="ev-titlewrap">
          <span className="ev-title">{card.title}</span>
          <span className="ev-sub">{card.status.replaceAll("_", " ")}</span>
        </span>
        <span className="ev-metric">{card.headline_metric}</span>
        <span className="ev-chev">{open ? "⌃" : "⌄"}</span>
      </button>
      {open && renderBody()}
    </article>
  );
}

export function EvidenceCards({ cards, data }: { cards: EvidenceCard[]; data: UtaTickerResult }) {
  return (
    <section className="panel card" data-ux-source="ux design/evidence.jsx:EvidenceGrid">
      <SectionHeader title="Evidence" meta={`${cards.length} cards`} />
      <div className="evidence-grid ev-grid">
        {cards.map((card, index) => (
          <EvCard key={card.id} card={card} defaultOpen={index < 3} data={data} />
        ))}
      </div>
    </section>
  );
}

export function LaneHealth({ lanes, onRefresh }: { lanes: LaneState[]; onRefresh?: (lane: LaneState) => void }) {
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

export function DataProvenance({ data }: { data: UtaTickerResult }) {
  const diagnostics = data.engine_diagnostics || {};
  const printSample = diagnostics.print_sample || {};
  const live = data.data_state === "live_manual";
  return (
    <section className="panel">
      <SectionHeader title="Data Provenance" meta={live ? "Massive live manual" : "Live provider state"} />
      <div className="metric-grid four">
        <MetricTile label="Source mode" value={data.calculation_metadata.source_mode || data.data_state} detail={live ? "manual provider pull" : "provider unavailable"} />
        <MetricTile label="Provider" value={data.calculation_metadata.provider || diagnostics.provider || "massive"} detail={data.calculation_metadata.prints_source || "live provider"} />
        <MetricTile label="Bars" value={data.calculation_metadata.latest_bar_date || data.calculation_metadata.live_clock || "N/A"} detail={data.calculation_metadata.bars_source || `${diagnostics.baseline?.session_count ?? "N/A"} baseline sessions`} />
        <MetricTile label="Print sample" value={printSample.eligible_prints ?? data.raw_prints?.prints?.length ?? "N/A"} detail={fmtMoney(printSample.total_notional)} />
      </div>
      <p>
        {live
          ? "Live manual mode uses Massive daily bars for volume/notional baselines and recent Massive prints for signed flow, focus prints, and raw-print evidence."
          : "Live provider data is required. Missing providers produce explicit unavailable lane states and no synthetic signal."}
      </p>
    </section>
  );
}
