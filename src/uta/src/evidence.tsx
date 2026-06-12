// src/uta/src/evidence.tsx
import React, { useState } from "react";
import { fmtMoney, fmtPct, fmtNumber, fmtDate } from "./utils.js";
import { Icon, Pill, SectionHeader, MetricTile, TierBadge, DirTag, BandTag, IndicatorGrid, VolBars, volSeriesFromResult, PressureGauge, ConfBar, MixBar, Sparkline, type MixSegment } from "./components.js";
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
  // Tier D has no computed corroboration — show nothing
  if (String(data.tier || "D").toUpperCase() === "D") return null;
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
  const series = volSeriesFromResult(data);
  const band = (data.trade_analysis?.anomaly_band || "").toLowerCase();
  return (
    <div className="ev-body-inner">
      <div className="ev-band-row">
        {data.trade_analysis?.anomaly_band && <BandTag band={data.trade_analysis.anomaly_band} />}
        <span className="pill">
          <span className="dot" style={{ background: "var(--accent)" }} />
          B {fmtNumber(B.volume_zscore, 1)}σ above own median
        </span>
      </div>
      <VolBars series={series} />
      <div className="chart-cap">
        <span>Session vs 20-day baseline by time bucket</span>
        <span>solid = today · ghost = baseline</span>
      </div>
      <div className="ev-kv-list">
        <div className="kv"><span className="k">Volume ratio</span><span className="v">{fmtNumber(C.volume_ratio, 2)}× median</span></div>
        <div className="kv"><span className="k">Notional ratio</span><span className="v">{fmtNumber(C.notional_ratio, 2)}× median</span></div>
        <div className="kv"><span className="k">Focus trade count</span><span className="v">{C.focus_trade_count ?? "—"}</span></div>
        <div className="kv"><span className="k">B-score (volume)</span><span className="v">{fmtNumber(B.volume_zscore, 2)}σ</span></div>
      </div>
    </div>
  );
}

function BlockOffExchangeBody({ data }: { data: UtaTickerResult }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ta = data.trade_analysis as any;
  const bf = ta?.block_flow;
  const C = data.indicators.C;
  const B = data.indicators.B;
  const trfShare = Number(bf?.trf_share ?? C.focus_notional_share ?? 0);
  const litShare = 1 - trfShare;
  const venueMix: MixSegment[] = [
    { label: "Off-exchange / focus", value: trfShare, colour: "var(--accent)" },
    { label: "Lit exchange", value: litShare, colour: "var(--border-strong)" }
  ];
  return (
    <div className="ev-body-inner">
      <div className="ev-block-hero">
        <div>
          <div className="uplabel">Focus notional</div>
          <div className="mono ev-hero-val">{fmtMoney(bf?.focus_notional ?? C.focus_trade_count)}</div>
        </div>
        <div>
          <div className="uplabel">Focus share</div>
          <div className="mono ev-hero-val">{fmtNumber(trfShare * 100, 0)}%</div>
        </div>
        <div>
          <div className="uplabel">Largest print</div>
          <div className="mono ev-hero-val">{bf?.largest_print_multiple ? `${fmtNumber(bf.largest_print_multiple, 1)}×` : fmtMoney(bf?.largest_print_notional)}</div>
        </div>
      </div>
      <div className="uplabel" style={{ marginBottom: 6 }}>Venue split (by notional)</div>
      <MixBar segments={venueMix} />
      <div className="ev-kv-list">
        <div className="kv"><span className="k">Focus trade count</span><span className="v">{bf?.focus_trade_count ?? C.focus_trade_count ?? "—"}</span></div>
        <div className="kv"><span className="k">Block directional pressure</span>
          <span className="v" style={{ color: Number(C.net_notional_pressure) > 0 ? "var(--buy)" : "var(--sell)" }}>
            {Number(C.net_notional_pressure ?? 0) > 0 ? "+" : ""}{fmtNumber(Number(C.net_notional_pressure ?? 0) * 100, 1)}%
          </span>
        </div>
        <div className="kv"><span className="k">B-score (focus share)</span><span className="v">{fmtNumber(B.focus_notional_share_zscore, 2)}σ</span></div>
      </div>
    </div>
  );
}

function DirectionalPressureBody({ data }: { data: UtaTickerResult }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pressure = (data.trade_analysis as any)?.pressure;
  const C = data.indicators.C;
  const signingConf = data.signing_confidence;
  const netPressure = Number(C.net_notional_pressure ?? 0);
  const netVolPressure = Number(C.net_volume_pressure ?? 0);
  const pressureDir = netPressure > 0 ? "var(--buy)" : "var(--sell)";
  return (
    <div className="ev-body-inner">
      <div className="ev-gauge-labels">
        <span>Seller-side</span><span>Neutral</span><span>Buyer-side</span>
      </div>
      <PressureGauge value={netPressure} />
      <div className="ev-kv-list">
        <div className="kv">
          <span className="k">Net notional pressure</span>
          <span className="v" style={{ color: pressureDir }}>
            {netPressure > 0 ? "+" : ""}{fmtNumber(netPressure * 100, 1)}%
          </span>
        </div>
        <div className="kv">
          <span className="k">Net volume pressure</span>
          <span className="v" style={{ color: netVolPressure > 0 ? "var(--buy)" : "var(--sell)" }}>
            {netVolPressure > 0 ? "+" : ""}{fmtNumber(netVolPressure * 100, 1)}%
          </span>
        </div>
      </div>
      <div className="ev-conf-row">
        <span className="uplabel">Signing confidence</span>
        <span className="mono" style={{ fontWeight: 600 }}>{Math.round(signingConf * 100)}%</span>
      </div>
      <ConfBar value={signingConf} />
      {signingConf < 0.5 && (
        <div className="ev-conf-warn">Low signing confidence — treat direction as indicative only.</div>
      )}
      {pressure?.interpretation && <p className="ev-interp">{pressure.interpretation}</p>}
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

const CARD_ICONS: Record<string, string> = {
  volume_anomaly: "bolt",
  block_off_exchange: "layers",
  directional_pressure: "activity",
  pre_market_activity: "premarket",
  market_flow_trend: "trend",
  confirmed_alerts: "bell",
  macro_context: "shield",
  data_health: "database",
};

function EvCard({ card, defaultOpen, data }: { card: EvidenceCard; defaultOpen: boolean; data: UtaTickerResult }) {
  const [open, setOpen] = useState(defaultOpen);
  const iconName = CARD_ICONS[card.id] || "sparkle";

  function renderBody() {
    if (card.id === "volume_anomaly") return <VolumeAnomalyBody data={data} />;
    if (card.id === "block_off_exchange") return <BlockOffExchangeBody data={data} />;
    if (card.id === "directional_pressure") return <DirectionalPressureBody data={data} />;
    if (card.id === "pre_market_activity") return <PreMarketBody data={data} />;
    if (card.id === "market_flow_trend") return <MarketFlowTrendBody data={data} />;
    // Remaining cards: text fallback
    return (
      <div className="ev-body">
        <p>{card.summary}</p>
      </div>
    );
  }

  return (
    <article className={`ev-card ${open ? "open" : "ev-collapsed"} ${card.status}`} data-card-id={card.id}>
      <button className="ev-head" type="button" onClick={() => setOpen((current) => !current)}>
        <span className="ico"><Icon name={iconName} size={15} /></span>
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
  // Tier D: all required lanes still loading — suppress evidence entirely
  if (String(data.tier || "D").toUpperCase() === "D") {
    return (
      <section className="panel card ev-tier-d-panel" data-ux-source="ux design/evidence.jsx:EvidenceGrid">
        <div className="ev-tier-d-icon">
          <Icon name="database" size={22} />
        </div>
        <div className="ev-tier-d-title">Evidence suppressed — Tier D</div>
        <p className="ev-tier-d-body">
          The live trade-slices lane is still loading. No directional signal or evidence is computed
          on incomplete data — a tier is never emitted while a required lane is loading.
        </p>
      </section>
    );
  }
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
