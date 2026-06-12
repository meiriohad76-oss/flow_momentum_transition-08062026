// src/uta/src/main.tsx  (TRANSITIONAL — will shrink to 5 lines by Task 3)
import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import type {
  LaneState, EvidenceCard, ExplainRule, RawPrint, UtaTickerResult,
  PortfolioResult, ScanRow, ScanResult, RuntimeStatus, ProviderLane,
  ProviderStatus, HistoryResult, SchedulerResult, UtaRule, UserStateResult,
  LoadState, Mode
} from "./types.js";
import {
  LIVE_SOURCE_MODE, DEFAULT_PORTFOLIO, SAFE_TICKER_PATTERN,
  fmtMoney, fmtPct, fmtNumber, fmtDate, tickerList,
  tierRank, setupTone, setupLabel, ruleMatches, invariantWarnings,
  apiGet, apiPost
} from "./utils.js";

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

function toneForTier(tier?: string) {
  if (tier === "A") return "good";
  if (tier === "B") return "warn";
  if (tier === "C") return "neutral";
  return "bad";
}

function TierBadge({ tier, size = "" }: { tier?: string; size?: string }) {
  const normalized = String(tier || "D").toUpperCase();
  return <span className={`tier-badge tier-ring t-${normalized.toLowerCase()} tier-${normalized.toLowerCase()} ${size}`}>{normalized}</span>;
}

function DirectionTag({ direction }: { direction?: string }) {
  const arrow = direction === "bullish" ? "↑" : direction === "bearish" ? "↓" : "↔";
  return <span className={`dir-tag ${direction || "neutral"}`}>{arrow} {direction || "neutral"}</span>;
}

function BandTag({ band }: { band?: string }) {
  return <span className={`band-tag ${String(band || "normal").toLowerCase()}`}>{band || "Normal"}</span>;
}

function DisplayDirectionTag({ direction }: { direction?: string }) {
  const dir = direction || "undetermined";
  const arrow = dir === "bullish" ? "↑" : dir === "bearish" ? "↓" : "↔";
  const label = dir === "bullish" ? "Buyer-side" : dir === "bearish" ? "Seller-side" : "Undetermined";
  return <span className={`dir-tag ${dir === "bullish" ? "bull" : dir === "bearish" ? "bear" : "undet"} ${dir}`}>{arrow} {label}</span>;
}

function IndicatorGrid({ data, portfolioMode = false }: { data: UtaTickerResult; portfolioMode?: boolean }) {
  const a = data.indicators.A;
  const aliases = data.trade_analysis?.indicator_aliases;
  const b = aliases?.B || {
    volume: data.indicators.B.volume_zscore,
    notional: data.indicators.B.notional_zscore,
    focus: data.indicators.B.focus_notional_share_zscore,
    pressure: data.indicators.B.net_notional_pressure_zscore
  };
  const c = aliases?.C || {
    vr: data.indicators.C.volume_ratio,
    nr: data.indicators.C.notional_ratio,
    fshare: data.indicators.C.focus_notional_share,
    fcount: data.indicators.C.focus_trade_count,
    nnp: data.indicators.C.net_notional_pressure
  };
  return (
    <div className="indicator-summary ind-summary">
      <article className="ind-chip B b">
        <span>B · vs own history</span>
        <strong>{fmtNumber(b.notional, 2)}σ notional</strong>
        <small>{fmtNumber(b.volume, 2)}σ vol · {fmtNumber(b.focus, 2)}σ focus · {fmtNumber(b.pressure, 2)}σ pressure</small>
      </article>
      <article className={`ind-chip A a ${a === null ? "na" : ""}`}>
        <span>{portfolioMode ? "A - relative to your portfolio today" : "A - universe percentile"}</span>
        <strong>{a === null ? "N/A" : fmtPct(a.volume_percentile)}</strong>
        <small>{a === null ? "single-ticker mode by design" : String(a.scope_label || "peer ranked context")}</small>
      </article>
      <article className="ind-chip C c">
        <span>C · raw magnitude</span>
        <strong>{fmtNumber(c.nr, 2)}x notional</strong>
        <small>{fmtNumber(c.vr, 2)}x vol · {fmtPct(c.nnp)} pressure · {c.fcount ?? 0} focus prints</small>
      </article>
    </div>
  );
}

function toneForBias(bias?: string) {
  if (bias === "bullish") return "good";
  if (bias === "bearish") return "bad";
  if (bias === "neutral") return "neutral";
  return "warn";
}

function TradeAnalysisPanel({ data }: { data: UtaTickerResult }) {
  const analysis = data.trade_analysis;
  if (!analysis) {
    return null;
  }
  return (
    <section className={`panel trade-analysis ${analysis.bias || "neutral"}`} data-testid="trade-analysis">
      <SectionHeader title="Trade Analysis" meta={analysis.trigger_model || "signed-flow criteria"} />
      <div className="trade-verdict-row">
        <div>
          <span className="crumb">Bias / setup verdict</span>
          <h2>{analysis.bias === "neutral" ? "No directional UTA setup" : `${analysis.bias.toUpperCase()} signed-flow setup`}</h2>
          <p>{analysis.verdict}</p>
        </div>
        <div className="trade-verdict-tags">
          <Pill tone={toneForBias(analysis.bias)}>{analysis.bias}</Pill>
          <Pill tone={analysis.setup_status === "review_candidate" ? "good" : analysis.setup_status === "watch_only" ? "warn" : "neutral"}>
            {analysis.setup_status.replaceAll("_", " ")}
          </Pill>
          <BandTag band={analysis.anomaly_band} />
        </div>
      </div>
      <div className="trigger-strip">
        <div>
          <span>Primary trigger</span>
          <b>{analysis.trigger_summary?.primary_trigger || "No trigger"}</b>
        </div>
        <div>
          <span>Next required evidence</span>
          <b>{analysis.trigger_summary?.next_trigger_needed || "N/A"}</b>
        </div>
        <div>
          <span>Trade workflow effect</span>
          <b>{(analysis.trigger_summary?.trade_action || "no_trade").replaceAll("_", " ")}</b>
        </div>
      </div>
      <div className="metric-grid four">
        <MetricTile label="Signed pressure" value={`${fmtNumber(Number(analysis.pressure.net_notional_pressure) * 100, 1)}%`} detail={analysis.pressure.direction} />
        <MetricTile label="Confidence" value={fmtPct(analysis.pressure.signing_confidence)} detail="print signing" />
        <MetricTile label="Volume / notional" value={`${fmtNumber(analysis.activity.volume_ratio, 2)}x / ${fmtNumber(analysis.activity.notional_ratio, 2)}x`} detail={`${analysis.activity.baseline_sessions || 0} baseline sessions`} />
        <MetricTile label="Focus prints" value={analysis.block_flow.focus_trade_count ?? 0} detail={`${fmtMoney(analysis.block_flow.focus_notional)} focus notional`} />
      </div>
      <div className="trade-analysis-body">
        <div>
          <h3>Interpretation</h3>
          <p>{analysis.pressure.interpretation}</p>
        </div>
        <div>
          <h3>Trigger criteria</h3>
          <div className="criteria-list">
            {(analysis.criteria || []).map((item) => (
              <div className={`criteria ${item.passed ? "pass" : "fail"}`} key={item.id}>
                <b>{item.passed ? "✓" : "×"}</b>
                <span>{item.label}<small>{item.actual}</small></span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function BlufCard({ data, portfolioMode = false }: { data: UtaTickerResult; portfolioMode?: boolean }) {
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
            <DisplayDirectionTag direction={data.direction} />
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

function DataProvenance({ data }: { data: UtaTickerResult }) {
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

function EvidenceCards({ cards }: { cards: EvidenceCard[] }) {
  return (
    <section className="panel card" data-ux-source="ux design/evidence.jsx:EvidenceGrid">
      <SectionHeader title="Evidence" meta={`${cards.length} cards`} />
      <div className="evidence-grid ev-grid">
        {cards.map((card, index) => <EvCard key={card.id} card={card} defaultOpen={index < 3} />)}
      </div>
    </section>
  );
}

function CorroborationPanel({ data }: { data: UtaTickerResult }) {
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

function ActionsPanel({
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
      {data.explain_tier.gap_to_next_tier?.length ? (
        <div className="gap-box">
          <b>Gap to next tier</b>
          <ul>
            {data.explain_tier.gap_to_next_tier.map((gap, index) => <li key={`${gap}-${index}`}>{String(gap)}</li>)}
          </ul>
        </div>
      ) : null}
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

function RawPrintsDrawer({ data, open, onClose }: { data: UtaTickerResult; open: boolean; onClose: () => void }) {
  const prints = data.raw_prints?.prints || [];
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" data-ux-source="ux design/detail-extras.jsx:RawPrintsDrawer">
        <div className="drawer-head">
          <div>
            <div className="dt">{data.ticker} · Raw prints</div>
            <div className="ds">Top {prints.length} by notional · post-condition-code policy {data.raw_prints?.policy_version || "v1"}</div>
          </div>
          <button className="x-close" type="button" onClick={onClose}>×</button>
        </div>
        <div className="drawer-body">
          <div className="table-wrap">
            <table className="rp-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Price</th>
                  <th>Size</th>
                  <th>Notional</th>
                  <th>Venue</th>
                  <th>Signed</th>
                  <th>Method</th>
                  <th>Codes</th>
                </tr>
              </thead>
              <tbody>
                {prints.map((print, index) => (
                  <tr key={`${print.ts}-${index}`}>
                    <td>{fmtDate(print.ts)}</td>
                    <td>{fmtMoney(print.price)}</td>
                    <td>{Number(print.size || 0).toLocaleString()}</td>
                    <td>{fmtMoney(print.notional)}</td>
                    <td><span className={String(print.venue || "").toUpperCase().includes("TRF") ? "venue-chip venue-trf" : "venue-chip venue-lit"}>{print.venue || "N/A"}</span></td>
                    <td className={print.signed_side === "buy" ? "rp-buy" : print.signed_side === "sell" ? "rp-sell" : ""}>{print.signed_side || "unknown"}</td>
                    <td>{print.signing_method || "unknown"}</td>
                    <td>{(print.condition_codes || []).join(", ") || "none"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="drawer-foot">Condition-code policy removes hard-excluded prints before scoring. Direction remains signed-flow only.</div>
      </aside>
    </>
  );
}

function ExplainTierModal({ data, open, onClose }: { data: UtaTickerResult; open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section className="modal" data-ux-source="ux design/detail-extras.jsx:ExplainTierPanel">
        <div className="modal-head">
          <TierBadge tier={data.tier} size="lg" />
          <div>
            <div className="dt">Why {data.ticker} is Tier {data.tier}</div>
            <div className="ds">{data.explain_tier.rule_set || "rule-based A/B/C gates"}</div>
          </div>
          <button className="x-close" type="button" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="verdict-banner">
            <b>{data.explain_tier.verdict || `Tier ${data.tier}`}</b>
            <span>Tier is rule-based and never a collapsed score.</span>
          </div>
          {(data.explain_tier.rules || []).map((rule) => (
            <div className="rule-row" key={rule.id}>
              <span className={`rule-mk ${rule.passed ? "pass" : "fail"}`}>{rule.passed ? "✓" : "×"}</span>
              <div className="rule-ct">
                <div className="rule-name">{rule.label}</div>
                <div className="rule-detail">{rule.actual}</div>
              </div>
            </div>
          ))}
          {data.explain_tier.gap_to_next_tier?.length ? (
            <div className="elev-note">
              <b>Why not the next tier?</b> {data.explain_tier.gap_to_next_tier.map(String).join(" · ")}
            </div>
          ) : null}
        </div>
        <div className="modal-foot">
          <span>Policy: condition_code_policy_v1. Explain output comes from classifier payload.</span>
          <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
      </section>
    </>
  );
}

function CompareBanner({ data }: { data: UtaTickerResult }) {
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

function CycleHistory({ history }: { history: HistoryResult | null }) {
  return (
    <section className="panel card cyc" data-ux-source="ux design/detail-extras.jsx:CycleTimeline">
      <SectionHeader title="Cycle History" meta={`${history?.rows.length || 0} rows`} />
      <div className="cyc-bars">
        {(history?.rows || []).slice(0, 12).map((row, index) => {
          const up = row.direction === "bullish";
          const height = row.tier === "A" ? 48 : row.tier === "B" ? 34 : row.tier === "C" ? 22 : 8;
          return <span className="cyc-bar-col" key={row.id || index}><span className={`cyc-bar ${up ? "up" : "dn"} ${index === 0 ? "cur" : ""}`} style={{ height, bottom: up ? "50%" : "auto", top: up ? "auto" : "50%" }} /></span>;
        })}
        {!history?.rows.length ? <p className="empty">No cycles stored yet.</p> : null}
      </div>
      <div className="cyc-ribbon">
        {(history?.rows || []).slice(0, 12).map((row, index) => <span className={`cyc-cell cyc-${row.tier || "D"} ${index === 0 ? "cyc-now" : ""}`} key={`${row.id || index}-tier`}>{row.tier || "D"}</span>)}
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
  const [drawer, setDrawer] = useState<"raw" | null>(null);
  const [explainOpen, setExplainOpen] = useState(false);
  const [compare, setCompare] = useState(false);
  return (
    <div className="detail-stack fade-in">
      <StatusStrip data={data} />
      <div className="crumb detail-crumb">
        <span>{portfolioMode ? "Portfolio" : "Single Ticker"}</span>
        <span>›</span>
        <span>{data.ticker}</span>
      </div>
      <section className="ticker-head ticker-title-row">
        <div className="th-id">
          <span className="th-sym mono">{data.ticker}</span>
          <span className="th-name">{data.name || ""}</span>
        </div>
        <div className="th-meta">
          <span className="pill">{data.exchange || "market"}</span>
          <span className="pill">{data.sector || "UTA"}</span>
        </div>
        <div className="tier-cluster">
          <TierBadge tier={data.tier} size="lg" />
          <DisplayDirectionTag direction={data.direction} />
          <Pill tone={toneForTier(data.tier)}>Cycle {data.runtime_cycle?.run_id || data.cycle_id || "live"}</Pill>
        </div>
      </section>
      <div className="detail-layout layout">
        <main className="detail-main main-col">
          {compare ? <CompareBanner data={data} /> : null}
          <BlufCard data={data} portfolioMode={portfolioMode} />
          <TradeAnalysisPanel data={data} />
          <CycleHistory history={history} />
          <EvidenceCards cards={data.evidence_cards || []} />
        </main>
        <aside className="detail-side side-col">
          <CorroborationPanel data={data} />
          <ActionsPanel
            data={data}
            onRefreshLane={onRefreshLane}
            onRevalidate={onRevalidate}
            onWatchlist={onWatchlist}
            onRawPrints={() => setDrawer("raw")}
            onExplainTier={() => setExplainOpen(true)}
            onCompare={() => setCompare((current) => !current)}
            compare={compare}
          />
          <LaneHealth lanes={data.lane_states || []} onRefresh={onRefreshLane} />
          <DataProvenance data={data} />
        </aside>
      </div>
      <RawPrintsDrawer data={data} open={drawer === "raw"} onClose={() => setDrawer(null)} />
      <ExplainTierModal data={data} open={explainOpen} onClose={() => setExplainOpen(false)} />
    </div>
  );
}

function SingleMode({
  data,
  history,
  onAnalyze,
  onRefreshLane,
  onRevalidate,
  onWatchlist
}: {
  data: LoadState<UtaTickerResult>;
  history: HistoryResult | null;
  onAnalyze: (ticker: string) => void;
  onRefreshLane: (lane: LaneState) => void;
  onRevalidate: () => void;
  onWatchlist: () => void;
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
  onPass1: (direction: string, tickers: string[]) => void;
  onPass2: () => void;
  onInspect: (result: UtaTickerResult) => void;
}) {
  const [direction, setDirection] = useState("bullish");
  const [tickers, setTickers] = useState("");
  const preliminaryRows = scan.data?.results || [];
  const resolvedRows = pass2.data?.results || [];
  return (
    <section className="mode-stack">
      <form className="command-bar" onSubmit={(event) => {
        event.preventDefault();
        onPass1(direction, tickerList(tickers));
      }}>
        <label htmlFor="scan-direction">Direction</label>
        <select id="scan-direction" value={direction} onChange={(event) => setDirection(event.target.value)}>
          <option value="bullish">Bullish</option>
          <option value="bearish">Bearish</option>
        </select>
        <input
          id="scan-tickers"
          className="wide-input"
          value={tickers}
          onChange={(event) => setTickers(event.target.value)}
          placeholder="Blank = automatic S&P 500 live scan"
          aria-label="Scan tickers"
        />
        <button type="submit">Pass 1</button>
        <button type="button" className="secondary" onClick={onPass2} disabled={!preliminaryRows.length}>Pass 2</button>
      </form>
      <div className="two-column">
        <section className="panel">
          <SectionHeader title="Scan Pass 1" meta={scan.data ? `${scan.data.universe_label} / ${scan.data.performance_tier}` : "preliminary"} />
          {scan.data ? (
            <p className="empty">
              {scan.data.scan_policy || "Pass 1 ranks preliminary activity before pass 2 resolves trade-print evidence."}
              {" "}
              {scan.data.scanned_count !== undefined ? `Scanned ${scan.data.scanned_count} of ${scan.data.universe_ticker_count || scan.data.requested_ticker_count || "unknown"} names.` : ""}
              {scan.data.universe_cache_state ? ` Universe: ${scan.data.universe_cache_state}.` : ""}
            </p>
          ) : null}
          {scan.status === "loading" ? <p className="empty">{scan.message}</p> : null}
          <div className="compact-list">
            {preliminaryRows.map((row) => (
              <div className="compact-row" key={row.ticker}>
                <div>
                  <b>{row.ticker}</b>
                  <span>{row.scan_reason || row.label || "Preliminary activity screen - pass 2 resolves signed-flow evidence"}</span>
                </div>
                <div className="row-metrics">
                  <Pill tone="warn">preliminary</Pill>
                  <span>{row.preliminary_tier || "n/a"}</span>
                  {row.C_screen !== undefined ? <span>{fmtNumber(row.C_screen, 2)}x C</span> : null}
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
                  <span>
                    {row.result
                      ? `${setupLabel(row.setup_status)} / ${row.bias || row.result.direction} / ${row.primary_trigger || "No trigger"}`
                      : row.error || row.status || row.pass2_status || "blocked"}
                  </span>
                  {row.next_trigger_needed ? <small>{row.next_trigger_needed}</small> : null}
                </div>
                <div className="row-metrics">
                  <Pill tone={setupTone(row.setup_status)}>{setupLabel(row.setup_status)}</Pill>
                  <span>{row.result ? `Tier ${row.result.tier}` : "n/a"}</span>
                  {row.signed_pressure !== undefined && row.signed_pressure !== null ? <span>{fmtPct(row.signed_pressure)} pressure</span> : null}
                  {row.signing_confidence !== undefined && row.signing_confidence !== null ? <span>{fmtPct(row.signing_confidence)} conf</span> : null}
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
        <CycleHistory history={history} />
      </div>
    </section>
  );
}

function App() {
  const [mode, setMode] = useState<Mode>("single");
  const [activeTicker, setActiveTicker] = useState("AVGO");
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

  async function loadSingle(ticker = activeTicker) {
    const normalized = ticker.trim().toUpperCase() || "AVGO";
    setActiveTicker(normalized);
    if (!SAFE_TICKER_PATTERN.test(normalized)) {
      setSingle({ status: "error", data: single.data, message: `Invalid ticker symbol: ${normalized}` });
      return;
    }
    setSingle((current) => ({ status: "loading", data: current.data, message: `Loading ${normalized} from live providers...` }));
    const data = await apiGet<UtaTickerResult>(`/api/uta/single?ticker=${encodeURIComponent(normalized)}&source=${LIVE_SOURCE_MODE}`);
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
    setPortfolio((current) => ({ status: "loading", data: current.data, message: "Ranking portfolio from live providers..." }));
    const data = await apiPost<PortfolioResult>("/api/uta/portfolio", { tickers, source: LIVE_SOURCE_MODE });
    setPortfolio({ status: "ready", data });
    await loadRuntime();
  }

  async function runScan(direction = "bullish", tickers = DEFAULT_PORTFOLIO) {
    setScan((current) => ({ status: "loading", data: current.data, message: "Running live pass 1..." }));
    const params = new URLSearchParams({
      universe: "sp500",
      direction,
      pass: "1",
      source: LIVE_SOURCE_MODE,
      tickers: tickers.join(",")
    });
    const data = await apiGet<ScanResult>(`/api/uta/scan?${params.toString()}`);
    setScan({ status: "ready", data });
    setPass2({ status: "idle" });
    await loadRuntime();
  }

  async function runPass2() {
    const shortlist = (scan.data?.results || []).map((row) => row.ticker);
    setPass2((current) => ({ status: "loading", data: current.data, message: "Resolving live pass 2..." }));
    const data = await apiPost<ScanResult>("/api/uta/scan/pass2", {
      shortlist: shortlist.length ? shortlist : ["AVGO"],
      source: LIVE_SOURCE_MODE,
      direction: scan.data?.direction_filter || "bullish"
    });
    setPass2({ status: "ready", data });
    await loadRuntime();
  }

  async function refreshLane(lane: LaneState) {
    await apiPost(`/api/uta/lanes/${encodeURIComponent(lane.lane_id)}/refresh`, {});
    await loadSingle(activeTicker);
  }

  async function revalidateActive() {
    setSingle((current) => ({ status: "loading", data: current.data, message: `Revalidating ${activeTicker} from live providers...` }));
    const data = await apiPost<UtaTickerResult>("/api/uta/revalidate", { ticker: activeTicker, source: LIVE_SOURCE_MODE });
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
          onRun={(tickers) => runPortfolio(tickers).catch((error) => setPortfolio({ status: "error", data: portfolio.data, message: error.message }))}
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
          onPass1={(direction, tickers) => runScan(direction, tickers).catch((error) => setScan({ status: "error", data: scan.data, message: error.message }))}
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
        onAnalyze={(ticker) => loadSingle(ticker).catch((error) => setSingle({ status: "error", data: single.data, message: error.message }))}
        onRefreshLane={(lane) => refreshLane(lane).catch((error) => setSingle({ status: "error", data: single.data, message: error.message }))}
        onRevalidate={() => revalidateActive().catch((error) => setSingle({ status: "error", data: single.data, message: error.message }))}
        onWatchlist={() => toggleWatchlist().catch((error) => setRuntime({ status: "error", data: runtime.data, message: error.message }))}
      />
    );
  }, [
    mode,
    single,
    portfolio,
    scan,
    pass2,
    runtime,
    providers,
    scheduler,
    history,
    stream,
    activeTicker,
    userState
  ]);

  return (
    <main className="uta-shell">
      <header className="uta-topbar">
        <div>
          <span className="crumb">
            UTA / {providers.data?.live_ready ? "Massive live ready" : "live provider gated"}
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
