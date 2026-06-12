// src/uta/src/evidence.tsx
import React, { useState } from "react";
import { fmtMoney, fmtPct, fmtNumber, fmtDate } from "./utils.js";
import { Pill, SectionHeader, MetricTile, TierBadge, DirTag, BandTag, IndicatorGrid } from "./components.js";
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

function EvCard({ card, defaultOpen }: { card: EvidenceCard; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
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
      <div className="ev-body">
        <p>{card.summary}</p>
      </div>
    </article>
  );
}

export function EvidenceCards({ cards }: { cards: EvidenceCard[] }) {
  return (
    <section className="panel card" data-ux-source="ux design/evidence.jsx:EvidenceGrid">
      <SectionHeader title="Evidence" meta={`${cards.length} cards`} />
      <div className="evidence-grid ev-grid">
        {cards.map((card, index) => <EvCard key={card.id} card={card} defaultOpen={index < 3} />)}
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
