// src/uta/src/evidence.tsx
import React, { useState } from "react";
import { fmtMoney, fmtPct, fmtNumber, fmtDate } from "./utils.js";
import { Icon, Pill, SectionHeader, MetricTile, TierBadge, DirTag, BandTag, IndicatorGrid, VolBars, volSeriesFromResult, PressureGauge, ConfBar, MixBar, Sparkline, type MixSegment } from "./components.js";
import type { UtaTickerResult, LaneState, EvidenceCard } from "./types.js";

/** Data-driven findings panel — specific numbers, thresholds, recommendation. */
function BlufFindings({ data }: { data: UtaTickerResult }) {
  const B = data.indicators.B;
  const C = data.indicators.C;
  const ta = data.trade_analysis;
  const tier = String(data.tier || "D").toUpperCase();
  const conf = data.signing_confidence;

  // Pull from canonical sources, fall through to trade_analysis sub-fields
  const volRatio  = Number(C.volume_ratio  ?? ta?.activity?.volume_ratio  ?? 0);
  const volB      = Number(B.volume_zscore  ?? ta?.activity?.volume_zscore  ?? 0);
  const notR      = Number(C.notional_ratio ?? ta?.activity?.notional_ratio ?? 0);
  const notB      = Number(B.notional_zscore ?? ta?.activity?.notional_zscore ?? 0);
  const focusCnt  = Number(C.focus_trade_count ?? ta?.block_flow?.focus_trade_count ?? 0);
  const pressure  = Number(C.net_notional_pressure ?? ta?.pressure?.net_notional_pressure ?? 0);

  type Status = "pass" | "warn" | "fail";

  const dir = data.direction === "bullish" ? "bullish" : data.direction === "bearish" ? "bearish" : "undetermined";
  const dirCap = dir === "bullish" ? "Buyer" : dir === "bearish" ? "Seller" : "Undetermined";
  const dirFlow = dir === "bullish" ? "buy" : dir === "bearish" ? "sell" : "undetermined";

  const findings: Array<{ label: string; value: string; note: string; status: Status }> = [
    {
      label: "Trade volume",
      value: `${fmtNumber(volRatio, 2)}× (${volB >= 0 ? "+" : ""}${fmtNumber(volB, 2)}σ)`,
      note: volB >= 2.5
        ? "Significantly more trades than usual — market is unusually active in this name"
        : volB >= 1.5
        ? "Above typical — elevated trading activity vs own 20-session history"
        : volB >= 0.5
        ? "Modestly elevated — slightly more active than average, direction confirmed separately"
        : "Quiet session — activity at or below normal. Direction found in flow composition, not volume.",
      status: volB >= 1.5 ? "pass" : volB >= 0.5 ? "warn" : "fail",
    },
    {
      label: "Dollar flow (shares × price)",
      value: `${fmtNumber(notR, 2)}× normal (${notB >= 0 ? "+" : ""}${fmtNumber(notB, 2)}σ)`,
      note: notB >= 2.5
        ? `${fmtNumber(notR, 2)}× the typical session's dollar volume — that's ${fmtNumber(notB, 1)} standard deviations above own history. Institutional-scale money is moving through this name.`
        : notB >= 1.5
        ? `${fmtNumber(notR, 2)}× normal dollar volume (${fmtNumber(notB, 1)}σ) — more money than 95%+ of this ticker's own sessions. Elevated but not extreme.`
        : notB >= 0.5
        ? `${fmtNumber(notR, 2)}× normal — building toward unusual. Needs +${fmtNumber(1.5 - notB, 1)}σ to cross the review threshold.`
        : `${fmtNumber(notR, 2)}× normal — in line with typical sessions. No institutional-scale dollar flow detected.`,
      status: notB >= 1.5 ? "pass" : notB >= 0.5 ? "warn" : "fail",
    },
    {
      label: "Block / focus prints",
      value: `${focusCnt} print${focusCnt !== 1 ? "s" : ""}`,
      note: focusCnt >= 3
        ? `${focusCnt} institutional-size trades confirmed — block buyers or sellers are active`
        : focusCnt > 0
        ? `${focusCnt} large print${focusCnt !== 1 ? "s" : ""} detected but below block threshold — early signal, not confirmed`
        : "No single trade above the institutional floor — no confirmed block activity this session",
      status: focusCnt >= 3 ? "pass" : focusCnt > 0 ? "warn" : "fail",
    },
    {
      label: "Signed flow pressure",
      value: `${pressure >= 0 ? "+" : ""}${fmtNumber(pressure * 100, 1)}%`,
      note: Math.abs(pressure) >= 0.6
        ? `${Math.round(Math.abs(pressure) * 10)} of 10 tracked dollars are ${dirFlow}-directed — ${dir.toUpperCase()} directional edge confirmed`
        : Math.abs(pressure) >= 0.3
        ? `Moderate ${dirFlow}-side tilt — buyers and sellers are active, ${dirFlow}s slightly ahead. Not yet a clear edge.`
        : "Flow is balanced — no side dominates. Direction is ambiguous from signed flow alone.",
      status: Math.abs(pressure) >= 0.6 ? "pass" : Math.abs(pressure) >= 0.3 ? "warn" : "fail",
    },
    {
      label: "Direction confidence",
      value: fmtPct(conf),
      note: dir === "undetermined"
        ? `${fmtPct(conf)} of prints signed (above 50% reliability floor) — signing quality is fine. But signed pressure is only ${fmtNumber(Math.abs(pressure) * 100, 1)}%, below the 60% threshold needed to assign a direction. Volume anomaly confirmed; side is NOT.`
        : conf >= 0.7
        ? `High — ${fmtPct(conf)} of prints were reliably assigned a side. Direction is trustworthy.`
        : conf >= 0.5
        ? `Above floor — ${fmtPct(conf)} of prints signed. Direction is meaningful but not conclusive.`
        : `Low — only ${fmtPct(conf)} of prints could be signed. Direction signal should not be trusted.`,
      status: dir === "undetermined" ? (conf >= 0.5 ? "warn" : "fail") : (conf >= 0.5 ? "pass" : "fail"),
    },
  ];

  // Client-side diagnosis — what the data says, what's missing, what to watch
  let rec = "";
  const ticker = data.ticker;
  const analyzedPrints = (ta as unknown as Record<string, unknown>)?.activity?.analyzed_prints as number | undefined;
  const baselineSessions = (ta as unknown as Record<string, unknown>)?.activity?.baseline_sessions as number | undefined;
  const dataContext = analyzedPrints ? `${analyzedPrints} prints` : "live prints";
  const histContext = baselineSessions ? `${baselineSessions}-session history` : "own history";

  if (tier === "D") {
    if (volRatio < 1.0 && notR < 1.0) {
      rec = `${ticker} is quiet. Both trade count (${fmtNumber(volRatio, 2)}×) and dollar flow (${fmtNumber(notR, 2)}×) are below baseline — this is a slow session. The signed flow (${fmtNumber(Math.abs(pressure) * 100, 1)}%) hasn't reached the 60% directional threshold either. Nothing to act on. Re-analyze if volume spikes or a catalyst appears.`;
    } else if (Math.abs(pressure) >= 0.6 && conf < 0.5) {
      rec = `${ticker} shows ${dirFlow}-side pressure (${fmtNumber(Math.abs(pressure) * 100, 1)}%) but signing confidence is only ${fmtPct(conf)} — below the 50% reliability floor. The direction signal exists but cannot be trusted with this confidence level. Dollar flow is ${fmtNumber(notB, 1)}σ (needs 1.5σ). Re-analyze after more prints accumulate.`;
    } else {
      rec = `${ticker} has some elevated components but hasn't met tier thresholds. Dollar flow B-score is ${fmtNumber(notB, 1)}σ (review trigger: 1.5σ, needs +${fmtNumber(Math.max(0, 1.5 - notB), 1)}σ). Signed pressure is ${fmtNumber(Math.abs(pressure) * 100, 1)}% (trigger: 60%). Both need to confirm together for a tier signal. Monitor and re-analyze.`;
    }
  } else if (tier === "C") {
    const pressureOK = Math.abs(pressure) >= 0.6;
    const missing: string[] = [];
    if (notB < 1.5) missing.push(`dollar flow (${fmtNumber(notB, 1)}σ, needs 1.5σ)`);
    if (focusCnt === 0) missing.push("block prints (0 above floor)");
    const missingStr = missing.length ? `Not confirmed: ${missing.join(" and ")}. ` : "";
    if (pressureOK) {
      rec = `${dirCap}-side edge confirmed from ${dataContext}: ${fmtNumber(Math.abs(pressure) * 100, 1)}% of tracked dollars are ${dirFlow}-directed (≥60% threshold met), with ${fmtPct(conf)} signing reliability. ${missingStr}This is a directional bias signal — the flow composition points ${dir}, but total dollar volume is not yet at unusual levels vs ${histContext}. Context-tier only: use as a directional lean, not a trade trigger.`;
    } else {
      // B-score triggered Tier C, but signed pressure < 60% — volume anomaly without directional confirmation
      const peakB = Math.max(volB, notB);
      const lastClose = ta?.activity?.latest_close;
      const priceNote = lastClose != null
        ? ` Last close $${fmtNumber(lastClose, 2)}. If price is declining with this volume, large money is being absorbed without an upward response — a potential sign of distribution (sellers using volume to exit into demand). If price is rising, it may be accumulation. Either way, the signed-flow model cannot yet confirm which side is in control.`
        : "";
      rec = `Major volume anomaly — ${fmtNumber(notR, 2)}× normal dollar flow (${fmtNumber(peakB, 1)}σ above ${histContext}) — but NO directional edge: signed pressure is only ${fmtNumber(Math.abs(pressure) * 100, 1)}%, well below the 60% threshold needed to assign a direction. Buyers and sellers are splitting the volume too evenly to confirm a side.${priceNote} Watch for a follow-on cycle where pressure breaks above 60%, or a provider alert / options sweep that confirms direction. Do not trade on direction — there is none yet.`;
    }
  } else if (tier === "B") {
    rec = `Review-worthy signal. ${dirCap}-side: ${fmtNumber(Math.abs(pressure) * 100, 1)}% signed pressure (confirmed), dollar flow ${fmtNumber(notB, 1)}σ above ${histContext} (above 1.5σ trigger)${focusCnt > 0 ? `, ${focusCnt} focus print${focusCnt !== 1 ? "s" : ""} detected` : ", no block prints yet"}. ${fmtPct(conf)} signing confidence. Validate with options flow, price action, and a provider alert before acting. One strong corroboration would qualify for Tier A.`;
  } else if (tier === "A") {
    rec = `Actionable signal. ${dirCap}-side: ${fmtNumber(Math.abs(pressure) * 100, 1)}% pressure, ${fmtNumber(notB, 1)}σ dollar flow above ${histContext}, ${focusCnt} focus print${focusCnt !== 1 ? "s" : ""}. ${fmtPct(conf)} signing confidence. At least one independent corroboration confirmed. Check exposure limits, follow execution protocol, and set your stop before acting.`;
  }

  const STATUS_ICON: Record<Status, string> = { pass: "✓", warn: "!", fail: "✗" };

  return (
    <div className="bluf-findings">
      <div className="bf-findings-label">Key findings</div>
      <div className="bf-findings-list">
        {findings.map((f) => (
          <div key={f.label} className={`bf-row bf-${f.status}`}>
            <span className="bf-mk">{STATUS_ICON[f.status]}</span>
            <span className="bf-label">{f.label}</span>
            <span className="bf-value">{f.value}</span>
            <span className="bf-note">{f.note}</span>
          </div>
        ))}
      </div>
      {rec && (
        <div className="bf-rec">
          <span className="bf-rec-label">Recommendation</span>
          <span className="bf-rec-text">{rec}</span>
        </div>
      )}
    </div>
  );
}

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
            {analysis?.activity?.latest_close != null && (
              <Pill tone="neutral">Last close ${fmtNumber(analysis.activity.latest_close, 2)}</Pill>
            )}
          </div>
        </div>
        <div className="bluf-aside uplabel">BLUF · as of {fmtDate(data.generated_at)}</div>
      </div>
      <IndicatorGrid data={data} portfolioMode={portfolioMode} />
      <BlufFindings data={data} />
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
  const strongCount = corr.independent_strong_count || 0;
  const isUndetermined = data.direction !== "bullish" && data.direction !== "bearish";

  // Each row: [label, confirmed, tier-weight, hint when unconfirmed]
  // Hints are adapted for undetermined direction to avoid implying a side exists
  const rows: Array<[string, boolean | undefined, string, string]> = [
    ["Price action aligned",          corr.price_action_aligned,         "Strong",     isUndetermined
      ? "Did price move unusually (gap, surge, spike) before or with the volume event? Look for price confirmation of the magnitude, not a direction."
      : "Did price move with or before the flow signal? Check chart."],
    ["Provider alert confirmed",      corr.provider_alert_confirmed,      "Strong",     "Did a UOA / block alert provider fire on this ticker today? Any direction."],
    ["Options flow aligned",          corr.options_flow_aligned,          "Strong",     isUndetermined
      ? "Is there unusual options volume (calls or puts)? Look for extreme sweep activity or large prints either side — direction is not yet established."
      : "Is options flow (calls/puts) directionally matching the signed pressure?"],
    ["Pre-market + regular elevated", corr.premarket_regular_elevated,    "Moderate",   "Was volume elevated in both pre-market and the regular session?"],
    ["News catalyst present",         corr.news_catalyst_present,         "Contextual", "Is there earnings, guidance, analyst action, or a macro event today?"],
    ["Macro regime supports",         corr.macro_regime_supports,         "Contextual", isUndetermined
      ? "Is there a sector or macro catalyst that could explain unusual volume without a directional bias (e.g., event risk, rebalancing, index event)?"
      : "Does the broader sector or market regime support the trade direction?"],
  ];

  return (
    <section className="panel">
      <SectionHeader
        title="Corroboration"
        meta={`${strongCount} of 3 strong signals confirmed · Tier A needs ≥ 1`}
      />
      <p className="corr-intro">
        These signals are <b>not auto-calculated</b> — verify each manually after an analysis.
        Confirming even one "Strong" item raises conviction and may qualify for Tier A.
        "Moderate" and "Contextual" items support the case but are never required.
      </p>
      {isUndetermined && (
        <p className="corr-gap corr-undetermined-note">
          <b>⚠ Volume anomaly — direction not established.</b>{" "}
          Signed pressure ({fmtNumber(Math.abs(Number(data.indicators?.C?.net_notional_pressure ?? 0)) * 100, 1)}%) is below the 60% directional threshold.
          Focus corroboration on <em>confirming the scale of activity</em> (provider alerts, options volume, price reaction) rather than directional fit.
          Watch for a catalyst that breaks the pressure imbalance.
        </p>
      )}
      <div className="corr-list">
        {rows.map(([label, passed, weight, hint]) => (
          <div className={`corr-row ${passed ? "on" : "off"}`} key={label}>
            <span className="corr-icon">{passed ? "✓" : "○"}</span>
            <div className="corr-body">
              <div className="corr-label-row">
                <b>{label}</b>
                <span className={`corr-weight corr-w-${weight.toLowerCase()}`}>{weight}</span>
              </div>
              <small className="corr-hint">{passed ? "Confirmed ✓" : hint}</small>
            </div>
          </div>
        ))}
      </div>
      {strongCount === 0 && (
        <p className="corr-gap">
          No strong confirmations yet — this signal stays at Tier {data.tier} until at least one is confirmed.
          {isUndetermined
            ? " Check provider alerts and options volume first — look for scale confirmation, not direction."
            : " Check price action, provider alerts, and options flow first (highest independence)."}
        </p>
      )}
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
