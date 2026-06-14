// src/uta/src/evidence.tsx
import React, { useState } from "react";
import { fmtMoney, fmtPct, fmtNumber, fmtDate } from "./utils.js";
import { Icon, Pill, SectionHeader, MetricTile, TierBadge, DirTag, BandTag, IndicatorGrid, VolBars, volSeriesFromResult, PressureGauge, ConfBar, MixBar, type MixSegment } from "./components.js";
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

  // Detect flow/price divergence for the "Signed flow pressure" finding
  const signedPressure = Number(ta?.pressure?.net_signed_pressure ?? pressure);
  const priceChg = ta?.activity?.price_change_pct;
  const priceSide = priceChg != null ? (priceChg < -1 ? "bearish" : priceChg > 1 ? "bullish" : "flat") : null;
  const diverging = priceSide != null && priceSide !== "flat" && priceSide !== dir && dir !== "undetermined";

  const findings: Array<{ label: string; value: string; note: string; status: Status; diverge?: boolean }> = [
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
      note: (() => {
        // Use actual buy/sell/unsigned breakdown from backend when available (post-algorithm-fix).
        // Fall back to approximation via conf + total pressure for older backend versions.
        const bp = ta?.pressure;
        const totalN = bp?.buy_notional != null ? (bp.buy_notional + bp.sell_notional + (bp.unsigned_notional ?? 0)) : null;
        const buyC  = totalN && totalN > 0 ? Math.round((bp.buy_notional      / totalN) * 100) : Math.round(((conf + pressure) / 2) * 100);
        const sellC = totalN && totalN > 0 ? Math.round((bp.sell_notional     / totalN) * 100) : Math.round(((conf - pressure) / 2) * 100);
        const unsC  = totalN && totalN > 0 ? Math.round(((bp.unsigned_notional ?? 0) / totalN) * 100) : Math.round((1 - conf) * 100);
        // net_signed_pressure = (buy$ - sell$) / (buy$ + sell$) — signed-only, no unknown dilution
        const signedPressure = Number(bp?.net_signed_pressure ?? pressure);
        const netPct = Math.round(Math.abs(signedPressure) * 100);
        const priceChg = ta?.activity?.price_change_pct;
        const flowSide = signedPressure >= 0 ? "buy" : "sell";
        if (Math.abs(signedPressure) >= 0.6) {
          const confirmedNote = `Strong ${flowSide}-side pressure: ${netPct}% net of labeled trades go to ${flowSide}ers. ${dir.toUpperCase()} directional edge confirmed (threshold: ≥60% of labeled-only flow).`;
          if (diverging && priceSide != null && priceSide !== "flat") {
            const priceStr = priceChg != null ? ` (${priceChg > 0 ? "+" : ""}${fmtNumber(priceChg, 2)}% vs prior close)` : "";
            return `${confirmedNote} ⚠ Price${priceStr} is moving against the confirmed ${dir} flow — possible distribution or false signal. Monitor for price reversal.`;
          }
          return confirmedNote;
        }
        const baseNote = `Of every $1 traded: ~${buyC}¢ labeled buyer-driven, ~${sellC}¢ labeled seller-driven, ~${unsC}¢ unknown direction. "Labeled" means the algorithm could determine who drove the trade (buyer lifting the ask vs. seller hitting the bid) using price-tick rules. The ${unsC}¢ unknown trades executed in dark pools or at mid-market prices where neither side can be identified. Net buyer excess among labeled trades: ${netPct}% — below the 60% threshold needed to call a direction.`;
        if (priceSide && priceSide !== "flat" && priceSide !== (signedPressure >= 0 ? "bullish" : "bearish")) {
          const priceStr = priceChg != null ? ` (${priceChg > 0 ? "+" : ""}${fmtNumber(priceChg, 2)}% vs prior close)` : "";
          return `${baseNote} ⚠ Price${priceStr} is moving against the labeled tilt — the ${unsC}¢ unknown trades are likely what's driving the price. If those dark-pool and mid-market prints are sell-heavy, the real net pressure is bearish. Direction cannot be confirmed.`;
        }
        return baseNote;
      })(),
      status: Math.abs(pressure) >= 0.6 ? "pass" : Math.abs(pressure) >= 0.3 ? "warn" : "fail",
      diverge: diverging,
    },
    {
      label: "Direction confidence",
      value: fmtPct(conf),
      note: dir === "undetermined"
        ? `${fmtPct(conf)} of trades could be labeled buyer-driven or seller-driven — the other ${fmtPct(1 - conf)} traded in dark pools or at mid-market prices where direction can't be determined. Even with ${fmtPct(conf)} labeled, the net buyer/seller split is only ${fmtNumber(Math.abs(pressure) * 100, 1)}% — below the 60% needed to call a direction. Volume anomaly confirmed; direction is NOT.`
        : conf >= 0.7
        ? `High — ${fmtPct(conf)} of trades were labeled buyer- or seller-driven. Direction signal is trustworthy.`
        : conf >= 0.5
        ? `${fmtPct(conf)} of trades labeled (above the 50% minimum). Direction is meaningful but not ideal — the other ${fmtPct(1 - conf)} traded in dark pools or at mid-market where buyer vs. seller can't be determined.`
        : `Low — only ${fmtPct(conf)} of trades could be labeled. The remaining ${fmtPct(1 - conf)} have unknown direction (dark pools, mid-market). Direction signal should not be trusted.`,
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
      const priceChgPct = ta?.activity?.price_change_pct;
      const priceNote = (() => {
        if (lastClose == null) return "";
        const priceStr = `$${fmtNumber(lastClose, 2)}`;
        if (priceChgPct == null) return ` Last close ${priceStr}. Check whether price is rising or falling with this volume — the direction of price vs the volume anomaly is the key missing piece.`;
        if (priceChgPct < -1) return ` Last close ${priceStr} (${fmtNumber(priceChgPct, 2)}% vs prior close). Price is falling while volume is extreme — this looks like DISTRIBUTION: large money may be selling into demand, which is why signed pressure is split. Watch for pressure to break below 40% (net sell-side) to confirm.`;
        if (priceChgPct > 1) return ` Last close ${priceStr} (+${fmtNumber(priceChgPct, 2)}% vs prior close). Price is rising with extreme volume — possible ACCUMULATION: large money buying, but the signed flow is too balanced to confirm. Watch for pressure to break above 60% (net buy-side) to confirm.`;
        return ` Last close ${priceStr} (${fmtNumber(priceChgPct, 2)}% vs prior close). Price is roughly flat despite extreme volume — indeterminate. Watch for a directional break.`;
      })();
      rec = `Major volume anomaly — ${fmtNumber(notR, 2)}× normal dollar flow (${fmtNumber(peakB, 1)}σ above ${histContext}) — but NO directional edge: signed pressure is only ${fmtNumber(Math.abs(pressure) * 100, 1)}%, well below the 60% threshold needed to assign a direction. Buyers and sellers are splitting the volume too evenly to confirm a side.${priceNote} Do not trade on direction — there is none yet.`;
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
      {rec && (
        <div className="bf-rec">
          <span className="bf-rec-label">Recommendation</span>
          <span className="bf-rec-text">{rec}</span>
        </div>
      )}
      <div className="bf-findings-list">
        {findings.map((f) => (
          <div key={f.label} className={`bf-row ${f.diverge ? "bf-diverge" : `bf-${f.status}`}`}>
            <span className="bf-mk">{f.diverge ? "⚠" : STATUS_ICON[f.status]}</span>
            <span className="bf-label">{f.label}</span>
            <span className="bf-value">{f.value}</span>
            <span className="bf-note">{f.note}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BlufCard({ data, portfolioMode = false }: { data: UtaTickerResult; portfolioMode?: boolean }) {
  const analysis = data.trade_analysis;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bf = (analysis as any)?.block_flow ?? null;
  const B = data.indicators.B;
  const C = data.indicators.C;

  const rows = [
    ["What happened", data.bluf.what_happened],
    ["Why it matters", data.bluf.why_it_matters],
    ["What to check", data.bluf.what_to_check],
    ["Limitations", data.bluf.limitations]
  ];

  // Tier band color — left border + tint on bluf-head
  const tierStr = String(data.tier || "D").toUpperCase();
  const tierBorderColor = tierStr === "A" ? "var(--buy)" : tierStr === "B" ? "var(--warn)" : "var(--ink-3)";
  const tierBg = tierStr === "A" ? "var(--buy-soft)" : tierStr === "B" ? "var(--warn-bg)" : "transparent";

  // Key stats for the stat row
  const bV = Number(B.volume_zscore ?? 0);
  const bN = Number(B.notional_zscore ?? 0);
  const bestB = Math.max(bV, bN);
  const signedPressure = Number(analysis?.pressure?.net_signed_pressure ?? C.net_notional_pressure ?? 0);
  const focusCount = Number(bf?.focus_trade_count ?? C.focus_trade_count ?? 0);

  const pressureColor = Math.abs(signedPressure) < 0.1
    ? "var(--ink-3)"
    : signedPressure > 0 ? "var(--buy)" : "var(--sell)";
  const volColor = bestB >= 1.5 ? "var(--buy)" : bestB >= 0.5 ? "var(--warn)" : "var(--ink-3)";
  const focusColor = focusCount >= 3 ? "var(--buy)" : focusCount >= 1 ? "var(--warn)" : "var(--ink-3)";

  return (
    <section className="panel card bluf bluf-card" data-ux-source="ux design/evidence.jsx:BlufCard">
      <div className="bluf-head" style={{ borderLeft: `4px solid ${tierBorderColor}`, background: tierBg }}>
        <TierBadge tier={data.tier} size="lg" />
        <div>
          <span className="crumb">{portfolioMode ? "Portfolio detail" : "Single ticker"} / BLUF</span>
          <div className="bluf-headline">{data.bluf.headline}</div>
          <div className="bluf-meta">
            <DirTag direction={data.direction} />
            <BandTag band={analysis?.anomaly_band} />
            <Pill tone="neutral">Direction confidence {fmtPct(data.signing_confidence)}</Pill>
            {analysis?.activity?.latest_close != null && (() => {
              const chg = analysis.activity.price_change_pct;
              const pSide = chg != null ? (chg > 1 ? "bullish" : chg < -1 ? "bearish" : "flat") : null;
              const pillDiverging = pSide != null && pSide !== "flat" && pSide !== data.direction && data.direction !== "undetermined";
              const tone = pillDiverging ? "warn" : chg == null ? "neutral" : chg > 0 ? "good" : chg < 0 ? "bad" : "neutral";
              const chgStr = chg != null ? ` (${chg > 0 ? "+" : ""}${fmtNumber(chg, 2)}%)` : "";
              const arrow = chg != null ? (chg > 0 ? " ↑" : " ↓") : "";
              const suffix = pillDiverging ? `${arrow} — diverges from flow ⚠` : "";
              return <Pill tone={tone}>Last close ${fmtNumber(analysis.activity.latest_close, 2)}{chgStr}{suffix}</Pill>;
            })()}
          </div>
        </div>
        <div className="bluf-aside uplabel">BLUF · as of {fmtDate(data.generated_at)}</div>
      </div>

      {/* Key stats row: verdict numbers before any text */}
      <div className="bluf-stats-row">
        <div className="bluf-stat-tile">
          <span className="st-label">Signed pressure</span>
          <span className="st-value" style={{ color: pressureColor }}>
            {signedPressure >= 0 ? "+" : ""}{fmtNumber(signedPressure * 100, 1)}%
          </span>
          <span className="st-detail">
            {signedPressure > 0 ? "buy-side" : signedPressure < 0 ? "sell-side" : "balanced"}
          </span>
        </div>
        <div className="bluf-stat-tile">
          <span className="st-label">Volume (σ)</span>
          <span className="st-value" style={{ color: volColor }}>
            {bestB >= 0 ? "+" : ""}{fmtNumber(bestB, 2)}σ
          </span>
          <span className="st-detail">vs own 20-session history</span>
        </div>
        <div className="bluf-stat-tile">
          <span className="st-label">Focus prints</span>
          <span className="st-value" style={{ color: focusColor }}>
            {focusCount}
          </span>
          <span className="st-detail">{focusCount === 1 ? "print" : "prints"} above floor</span>
        </div>
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

  // Rows: [label, value, weight, hint-when-unconfirmed, source]
  // source: "auto" = backend computes from bar/print data | "manual" = requires external check
  const priceChg = data.trade_analysis?.activity?.price_change_pct;

  function getCorrDataLine(id: string, passed: boolean | undefined): { dataLine: string; interpText: string } {
    const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const sp = Number(data.trade_analysis?.pressure?.net_signed_pressure ?? data.trade_analysis?.pressure?.net_notional_pressure ?? 0);
    const dirWord = data.direction === "bullish" ? "bullish" : data.direction === "bearish" ? "bearish" : "undetermined";
    switch (id) {
      case "price_action": {
        if (priceChg == null) return { dataLine: "Price change not available — check chart manually", interpText: "Compare the price move to the flow signal on the chart." };
        const chgStr = `${priceChg >= 0 ? "+" : ""}${fmtNumber(priceChg, 2)}%`;
        const flowDir = sp >= 0 ? "bullish" : "bearish";
        const diverges = (priceChg > 1 && flowDir === "bearish") || (priceChg < -1 && flowDir === "bullish");
        if (!isUndetermined && diverges) return {
          dataLine: `Price ${chgStr} vs prior close — moving AGAINST ${dirWord} flow ⚠`,
          interpText: `A price move against the flow direction may indicate distribution (selling into strength) or a false signal. Watch for price to stall or reverse before treating this as a confirmed ${dirWord} setup.`
        };
        return {
          dataLine: `Price ${chgStr} vs prior close — moves WITH ${dirWord} flow ✓`,
          interpText: "Price and flow direction agree — a corroborating signal. Strongest when the price move preceded the volume spike."
        };
      }
      case "provider_alert":
        return {
          dataLine: `Check ${data.ticker} on your UOA / block-flow provider for today`,
          interpText: "Any alert — regardless of direction — confirms institutional-scale activity. Direction is secondary to scale here."
        };
      case "options_flow":
        return {
          dataLine: isUndetermined
            ? `Check ${data.ticker} options chain for unusual volume on either side`
            : `Look for ${data.direction === "bullish" ? "call" : "put"} sweeps or unusual volume in ${data.ticker} options`,
          interpText: isUndetermined
            ? "Volume alone (not direction) confirms scale — any large options sweep is a corroboration."
            : `Directional match to ${dirWord} flow. Look for aggressive sweep buying, not just elevated open interest.`
        };
      case "premarket_regular":
        if (passed === true) return { dataLine: "Both sessions elevated vs own history", interpText: "Sustained multi-session elevation is stronger than a single spike — meaningful confirmation." };
        if (passed === false) return { dataLine: "Single session only — not both", interpText: "A single-session spike is weaker than sustained flow across pre-market and regular hours." };
        return { dataLine: "Could not auto-compute — bar data may be unavailable", interpText: "Check whether pre-market and the regular session both showed elevated activity vs this ticker's own history." };
      case "news_catalyst":
        return {
          dataLine: `Check ${data.ticker} events for ${today}`,
          interpText: "Earnings, guidance revisions, analyst actions, or macro events. A known catalyst reduces edge — informed flow is harder to trade against."
        };
      case "macro_regime":
        return {
          dataLine: isUndetermined
            ? "Check if volume reflects index rebalancing or event risk"
            : `Check sector ETF and broad market regime for ${dirWord} support`,
          interpText: isUndetermined
            ? "Could elevated volume reflect index rebalancing, sector rotation, or event risk rather than a directional bet?"
            : `Aligned macro context raises conviction; opposing macro lowers it. Check the sector ETF and broad market direction.`
        };
      default:
        return { dataLine: "", interpText: passed === true ? "Confirmed" : passed === false ? "Not confirmed" : "Check required" };
    }
  }

  // [id, label, passed, weight, source]
  const rows: Array<[string, string, boolean | undefined, string, "auto" | "manual"]> = [
    ["price_action",       "Price action aligned",           corr.price_action_aligned,        "Strong",      "auto"],
    ["provider_alert",     "Provider alert confirmed",        corr.provider_alert_confirmed,     "Strong",      "manual"],
    ["options_flow",       "Options flow aligned",            corr.options_flow_aligned,         "Strong",      "manual"],
    ["premarket_regular",  "Pre-market + regular elevated",   corr.premarket_regular_elevated,   "Moderate",    "auto"],
    ["news_catalyst",      "News catalyst present",           corr.news_catalyst_present,        "Contextual",  "manual"],
    ["macro_regime",       "Macro regime supports",           corr.macro_regime_supports,        "Contextual",  "manual"],
  ];

  return (
    <section className="panel">
      <SectionHeader
        title="Corroboration"
        meta={`${strongCount} of 3 strong signals confirmed · Tier A needs ≥ 1`}
      />
      <p className="corr-intro">
        Confirming even one <b>Strong</b> item raises conviction and may qualify for Tier A.
        <b> Auto</b> signals are computed from bar/print data. <b>Manual</b> signals require an external check.
      </p>
      {isUndetermined && (
        <p className="corr-gap corr-undetermined-note">
          <b>⚠ Volume anomaly — direction not established.</b>{" "}
          Signed pressure ({fmtNumber(Math.abs(Number(data.indicators?.C?.net_notional_pressure ?? 0)) * 100, 1)}%) is below the 60% directional threshold.
          Focus on confirming <em>scale</em> (provider alerts, options volume, price reaction), not direction.
        </p>
      )}
      <div className="corr-list">
        {rows.map(([id, label, passed, weight, source]) => {
          const isStrong = weight === "Strong";
          const isModerate = weight === "Moderate";
          const isContextual = weight === "Contextual";
          const icon = isContextual ? "ℹ" : passed === true ? "✓" : passed === false ? "✗" : "○";
          const iconColor = passed === true
            ? "var(--buy)"
            : passed === false
            ? isStrong ? "var(--sell)" : "var(--ink-3)"
            : isStrong ? "var(--warn)" : "var(--ink-3)";
          const rowClass = isStrong
            ? passed === true ? "strong-confirmed" : passed === false ? "strong-false" : "strong-missing"
            : isModerate ? "corr-moderate" : "corr-contextual";
          const { dataLine, interpText } = getCorrDataLine(id, passed);
          return (
            <div className={`corr-row ${rowClass}`} key={id}>
              <span className="corr-icon" style={{ color: iconColor }}>{icon}</span>
              <div className="corr-body">
                <div className="corr-label-row">
                  <b>{label}</b>
                  <span className={`corr-weight corr-w-${weight.toLowerCase()}`}>{weight}</span>
                  <span className={`corr-source corr-src-${source}`}>{source}</span>
                </div>
                {dataLine && <div className="corr-data-line">{dataLine}</div>}
                <p className="corr-interp">{interpText}</p>
              </div>
            </div>
          );
        })}
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
  const focusCount = Number(bf?.focus_trade_count ?? C.focus_trade_count ?? 0);
  const pressure = Number(C.net_notional_pressure ?? 0);

  // Infer the institutional floor from largest_print_notional / largest_print_multiple.
  // The backend computes largest_print_multiple = notional / floor; we reverse it here.
  const inferredFloor: number | null =
    bf?.largest_print_notional && bf?.largest_print_multiple
      ? bf.largest_print_notional / bf.largest_print_multiple
      : null;
  const floorLabel = inferredFloor != null ? fmtMoney(inferredFloor) : "$500K";

  // Venue split bar
  const venueMix: MixSegment[] = [
    { label: "Off-exchange / TRF / dark pool", value: trfShare, colour: "var(--accent)" },
    { label: "Lit exchange", value: litShare, colour: "var(--border-strong)" }
  ];

  // Narrative sentence
  function buildNarrative(): string {
    if (focusCount === 0) return "No institutional-size prints detected this session — monitor for block activity.";
    const focusStr = bf?.focus_notional ? fmtMoney(bf.focus_notional) : `${focusCount} print${focusCount !== 1 ? "s" : ""}`;
    const multipleStr = bf?.largest_print_multiple ? ` · ${fmtNumber(bf.largest_print_multiple, 1)}× the ${floorLabel} floor` : "";
    const venueDesc = trfShare < 0.05
      ? "entirely on lit exchanges"
      : trfShare > 0.95
      ? "entirely off-exchange (dark pool / TRF)"
      : `${fmtNumber(trfShare * 100, 0)}% off-exchange, ${fmtNumber((1 - trfShare) * 100, 0)}% lit`;
    const pressurePct = Math.abs(pressure) * 100;
    const dirDesc = pressurePct >= 60
      ? `The print${focusCount !== 1 ? "s were" : " was"} ${fmtNumber(pressurePct, 1)}% net ${pressure > 0 ? "buy" : "sell"}-directed`
      : `Buy/sell split is too even to confirm direction (${pressure >= 0 ? "+" : ""}${fmtNumber(pressure * 100, 1)}%)`;
    const watchLine = focusCount === 1
      ? "With only 1 focus trade, the directional read is preliminary — watch for a second block print to confirm."
      : focusCount === 2
      ? "Two block prints detected — directional signal is building."
      : `Block activity confirmed across ${focusCount} prints.`;
    return `${focusCount} institutional-size print${focusCount !== 1 ? "s" : ""} (${focusStr}${multipleStr}) executed ${venueDesc}. ${dirDesc}. ${watchLine}`;
  }

  const pressureStr = `${pressure > 0 ? "+" : ""}${fmtNumber(pressure * 100, 1)}%`;
  const pressureColor = pressure > 0 ? "var(--buy)" : "var(--sell)";
  const bFocusZ = Number(B.focus_notional_share_zscore ?? 0);

  // Divergence: price moving against block flow direction
  const priceChgBlock = ta?.activity?.price_change_pct;
  const priceSideBlock = priceChgBlock != null
    ? (priceChgBlock > 1 ? "bullish" : priceChgBlock < -1 ? "bearish" : "flat")
    : null;
  const divergingBlock = priceSideBlock != null
    && priceSideBlock !== "flat"
    && priceSideBlock !== data.direction
    && data.direction !== "undetermined";

  const PRINT_TIP = "A print is a single trade execution recorded to the tape. A focus print is a trade whose notional value exceeds the institutional floor.";
  const P = (s: string) => <abbr title={PRINT_TIP}>{s}</abbr>;

  function buildVerdict(): { headline: string; clause: React.ReactNode; subLine: string | null; color: string; bg: string } {
    const dir = data.direction === "bullish" ? "bullish" : data.direction === "bearish" ? "bearish" : "undetermined";
    const dirLabel = dir !== "undetermined" ? `${dir} ` : "";
    const pressurePct = fmtNumber(Math.abs(pressure) * 100, 1);
    const buySell = pressure > 0 ? "buy" : "sell";
    const subLine = divergingBlock ? "⚠ Price is moving against the block flow direction" : null;

    if (focusCount === 0) {
      return {
        headline: "Monitoring",
        clause: <>No institutional-size {P("prints")} above the {floorLabel} floor yet</>,
        subLine: null,
        color: "var(--ink-3)",
        bg: "transparent",
      };
    }

    if (focusCount === 1) {
      const clause = Math.abs(pressure) >= 0.6
        ? <>{`1 ${dirLabel}block `}{P("print")}{` · ${pressurePct}% ${buySell}-directed — needs a second `}{P("print")}{` to confirm`}</>
        : <>{`1 block `}{P("print")}{` above floor · direction unclear (flow split too even)`}</>;
      return { headline: "Early Signal", clause, subLine, color: "var(--warn)", bg: "var(--warn-bg)" };
    }

    if (focusCount === 2) {
      const pressureNote = Math.abs(pressure) >= 0.6 ? `${pressurePct}% signed pressure` : "direction split too even";
      return {
        headline: "Building",
        clause: <>{`${focusCount} ${dirLabel}block `}{P("prints")}{` · ${pressureNote} — pattern emerging`}</>,
        subLine,
        color: "var(--warn)",
        bg: "var(--warn-bg)",
      };
    }

    // 3+ prints
    const strong = Math.abs(pressure) >= 0.6;
    return {
      headline: strong ? "Confirmed" : "Active",
      clause: strong
        ? <>{`${focusCount} institutional `}{P("prints")}{` · ${pressurePct}% ${dirLabel}directed block signal`}</>
        : <>{`${focusCount} block `}{P("prints")}{` · direction unclear — flow too balanced`}</>,
      subLine,
      color: strong ? "var(--buy)" : "var(--warn)",
      bg: strong ? "var(--buy-soft)" : "var(--warn-bg)",
    };
  }

  function buildWatchPoints(): string[] {
    const points: string[] = [];
    if (focusCount === 0) {
      points.push(
        `Monitor for the first block print above the ${floorLabel} floor — a single institutional-size trade would shift this to an early signal.`
      );
    } else if (focusCount === 1) {
      points.push(
        "Watch for a second block print to confirm direction. One print can be noise — two in the same direction is a pattern."
      );
      if (divergingBlock) {
        points.push(
          "Price is moving against the block flow — watch for price to stall or reverse before acting on this signal."
        );
      }
    } else if (focusCount === 2) {
      points.push(
        "Block signal is building. Confirm direction aligns with options flow or a provider alert before sizing up."
      );
      if (Math.abs(pressure) >= 0.6) {
        points.push(
          `Directional read is ${data.direction} with ${fmtNumber(Math.abs(pressure) * 100, 1)}% signed pressure — wait for price to confirm.`
        );
      }
    } else {
      points.push(
        `Block activity confirmed across ${focusCount} prints. Direction is ${data.direction}.`
      );
      if (Math.abs(pressure) >= 0.6) {
        points.push(
          `Signed pressure at ${fmtNumber(Math.abs(pressure) * 100, 1)}% confirms the ${data.direction} edge — check corroboration before acting.`
        );
      }
    }
    return points;
  }

  return (
    <div className="ev-body-inner">
      {/* Verdict banner — top-line "so what?" before any metrics */}
      {(() => {
        const { headline, clause, subLine, color, bg } = buildVerdict();
        return (
          <div className="block-verdict" style={{ borderLeftColor: color, background: bg }}>
            <span className="block-verdict-headline" style={{ color }}>{headline}</span>
            <span className="block-verdict-clause">{clause}</span>
            {subLine && <span className="block-verdict-sub">{subLine}</span>}
          </div>
        );
      })()}
      {/* Hero metrics with inline sub-labels */}
      <div className="ev-block-hero">
        <div>
          <div className="uplabel">Focus notional</div>
          <div className="mono ev-hero-val">{fmtMoney(bf?.focus_notional ?? 0)}</div>
          <div className="ev-hero-sub">{focusCount} print{focusCount !== 1 ? "s" : ""} above floor</div>
        </div>
        <div>
          <div className="uplabel">TRF / dark pool share</div>
          <div className="mono ev-hero-val">{fmtNumber(trfShare * 100, 0)}%</div>
          <div className="ev-hero-sub">{trfShare < 0.05 ? "All lit exchange" : `${fmtNumber(trfShare * 100, 0)}% off-exchange`}</div>
        </div>
        <div>
          <div className="uplabel">Largest print</div>
          <div className="mono ev-hero-val">
            {bf?.largest_print_multiple ? `${fmtNumber(bf.largest_print_multiple, 1)}×` : fmtMoney(bf?.largest_print_notional ?? 0)}
          </div>
          <div className="ev-hero-sub">the {floorLabel} floor</div>
        </div>
      </div>

      {/* Narrative: ties all hero numbers together in plain English */}
      <p className="ev-block-narrative">{buildNarrative()}</p>

      {/* Venue split bar */}
      <div className="uplabel" style={{ marginBottom: 6 }}>Venue split (by notional)</div>
      <MixBar segments={venueMix} />

      {/* KV rows with inline context */}
      <div className="ev-kv-list">
        <div className="kv">
          <span className="k">Focus trade count</span>
          <span className="v">{focusCount} print{focusCount !== 1 ? "s" : ""} above the {floorLabel} institutional floor</span>
        </div>
        <div className="kv">
          <span className="k">Block directional pressure</span>
          <span className="v" style={{ color: pressureColor }}>
            {pressureStr} ({focusCount} focus print{focusCount !== 1 ? "s" : ""}, signed {pressure > 0 ? "buy" : "sell"})
          </span>
        </div>
        <div className="kv">
          <span className="k">B-score (focus share)</span>
          <span className="v">
            {fmtNumber(B.focus_notional_share_zscore, 2)}σ — focus share is{" "}
            {Math.abs(bFocusZ) >= 1.5 ? "elevated" : "normal"} vs 20-session history
          </span>
        </div>
      </div>

        {/* What to watch next */}
        <div className="block-watch">
          <div className="block-watch-title">What to watch next</div>
          <ul>
            {buildWatchPoints().map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>
        </div>

        {/* Verification checklist — read-only reminder protocol */}
        <div className="block-checklist">
          <div className="bc-title">Checklist before acting</div>
          <ul>
            <li>Block direction aligns with signed flow pressure?</li>
            <li>Price has confirmed the direction (within 1–2 sessions)?</li>
            <li>At least one corroboration signal confirmed (provider alert, options flow, or price action)?</li>
          </ul>
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const analyzedPrints = (data.trade_analysis as any)?.activity?.analyzed_prints ?? "N/A";

  // Pressure bar: track spans -100% to +100% (200% range).
  // Fill extends from the center (50% of track width) left (sell) or right (buy).
  // At |pressure| = 1.0 (100%), fill width = 50% of track = half the bar.
  const fillPct = Math.min(Math.abs(netPressure) * 50, 50);
  const fillColor = netPressure > 0 ? "var(--buy)" : netPressure < 0 ? "var(--sell)" : "var(--ink-3)";
  const fillStyle: React.CSSProperties = netPressure >= 0
    ? { left: "50%", width: `${fillPct}%`, background: fillColor }
    : { right: "50%", width: `${fillPct}%`, background: fillColor };

  // Plain-English interpretation sentence
  const absPressure = Math.abs(netPressure);
  const n = Math.round(absPressure * 10);
  const side = netPressure > 0 ? "buyers" : "sellers";
  const interpText = absPressure >= 0.6
    ? `Strong ${netPressure > 0 ? "buy" : "sell"}-side edge — ${n} of every 10 total dollars was net ${netPressure > 0 ? "buy" : "sell"}-side this session.`
    : absPressure >= 0.1
    ? `Flow is tilted ${netPressure > 0 ? "buy" : "sell"}-side but below the 60% confirmation threshold.`
    : "Buy and sell flow are roughly balanced — no directional edge in the flow composition.";

  // B-score contextual detail
  const bScoreDetail = Math.abs(bScore) >= 1.5
    ? `${bScore > 0 ? "elevated" : "depressed"} vs own history`
    : Math.abs(bScore) >= 0.5
    ? "slightly off own baseline"
    : "within normal range";

  return (
    <div className="ev-body-inner">
      <div className="pres-bar">
        <div className="pres-bar-track">
          <div className="pres-bar-fill" style={fillStyle} />
        </div>
        <div className="pres-bar-labels">
          <span>Sell −100%</span>
          <span>0</span>
          <span>Buy +100%</span>
        </div>
      </div>
      <p className="pres-interp">{interpText}</p>
      <div className="ev-stat-row">
        <MetricTile
          label="Net pressure"
          value={`${netPressure >= 0 ? "+" : ""}${fmtNumber(netPressure * 100, 1)}%`}
          detail="net of labeled trades"
        />
        <MetricTile
          label="B-score"
          value={`${fmtNumber(bScore, 2)}σ`}
          detail={bScoreDetail}
        />
        <MetricTile
          label="Prints analyzed"
          value={String(analyzedPrints)}
          detail="since market open"
        />
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
