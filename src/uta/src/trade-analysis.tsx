// src/uta/src/trade-analysis.tsx
import React from "react";
import { fmtMoney, fmtPct, fmtNumber } from "./utils.js";
import { Pill, SectionHeader, BandTag } from "./components.js";
import type { UtaTickerResult } from "./types.js";

function toneForBias(bias?: string) {
  if (bias === "bullish") return "good";
  if (bias === "bearish") return "bad";
  if (bias === "neutral") return "neutral";
  return "warn";
}

/** Synthesized, data-specific interpretation — replaces generic API text. */
function TradeInterpretation({ data }: { data: UtaTickerResult }) {
  const analysis = data.trade_analysis!;
  const pressure = Number(analysis.pressure.net_notional_pressure);
  const conf = analysis.pressure.signing_confidence;
  const dir = analysis.bias;
  const dirWord = dir === "bullish" ? "buyer" : dir === "bearish" ? "seller" : "undetermined";
  const dirFlow = dir === "bullish" ? "buy" : dir === "bearish" ? "sell" : "neutral";

  const B = data.indicators.B;
  const bScores = (
    [B.volume_zscore, B.notional_zscore, B.focus_notional_share_zscore, B.net_notional_pressure_zscore] as (number | null | undefined)[]
  ).filter((v): v is number => v != null);
  const maxB = bScores.length > 0 ? Math.max(...bScores) : 0;

  const pressurePct = Math.abs(pressure) * 100;
  const pressureOK = pressurePct >= 60;
  const confOK = conf >= 0.5;
  const bOK = maxB >= 1.5;
  const notR = Number(analysis.activity.notional_ratio ?? 1);
  const focusCount = analysis.block_flow.focus_trade_count ?? 0;

  type LineType = "confirmed" | "missing" | "watch";
  const lines: Array<{ type: LineType; text: string }> = [];

  // Confirmed signals
  if (pressureOK) {
    lines.push({ type: "confirmed", text: `Signed flow is ${dir}: ${fmtNumber(pressurePct, 1)}% of tracked dollars are ${dirFlow}-directed — above the 60% directional threshold. ${dirWord.charAt(0).toUpperCase() + dirWord.slice(1)}s are in control of this session.` });
  }
  if (confOK) {
    lines.push({ type: "confirmed", text: `Signing confidence ${fmtPct(conf)} is above the 50% reliability floor — the directional label can be trusted.` });
  }
  if (bOK) {
    lines.push({ type: "confirmed", text: `B-score ${fmtNumber(maxB, 2)}σ — above the 1.5σ review trigger. Dollar flow is statistically elevated vs own history.` });
  }
  if (focusCount >= 3) {
    lines.push({ type: "confirmed", text: `${focusCount} institutional-size prints confirmed — block ${dirFlow}ers are active.` });
  }

  // Missing signals
  if (!pressureOK) {
    lines.push({ type: "missing", text: `Signed pressure ${fmtNumber(pressurePct, 1)}% is below the 60% threshold — no clear directional edge yet. Both sides are fairly balanced.` });
  }
  if (!confOK) {
    lines.push({ type: "missing", text: `Signing confidence only ${fmtPct(conf)} — below 50% floor. Too many ambiguous prints to trust the direction label.` });
  }
  if (!bOK) {
    lines.push({ type: "missing", text: `Best B-score is ${fmtNumber(maxB, 2)}σ — below the 1.5σ review trigger. Dollar flow is not yet statistically unusual vs ${analysis.activity.baseline_sessions || 20}-session history. Need ${fmtNumber(Math.max(0, 1.5 - maxB), 2)}σ more.` });
  }
  if (focusCount === 0) {
    lines.push({ type: "missing", text: `No focus/block prints above the institutional floor — position-size confirmation is absent. We can see direction in the signed flow, but not confirmed institutional commitment.` });
  }

  // Watch items
  if (notR < 1.5 && bOK) {
    lines.push({ type: "watch", text: `Notional ratio ${fmtNumber(notR, 2)}× vs own median (full confirmation needs ≥1.5×).` });
  }

  const actionLine =
    analysis.setup_status === "review_candidate"
      ? `This setup qualifies for trade review. Corroborate independently — check price action, options flow, and provider alerts — then evaluate position sizing.`
      : analysis.setup_status === "watch_only"
      ? `Watch-only: direction is ${dir} but the magnitude evidence is insufficient for action. ${!bOK ? `Re-analyze when B-score crosses 1.5σ (${fmtNumber(Math.max(0, 1.5 - maxB), 2)}σ away) or a focus print appears.` : "Wait for corroboration."}`
      : `No actionable setup. Monitor only — re-analyze on a volume spike or price catalyst.`;

  const ICON: Record<LineType, string> = { confirmed: "✓", missing: "○", watch: "→" };

  return (
    <div className="ta-interp">
      <div className="ta-interp-lines">
        {lines.map((line, i) => (
          <div key={i} className={`ta-interp-line ta-il-${line.type}`}>
            <span className="ta-il-icon">{ICON[line.type]}</span>
            <span className="ta-il-text">{line.text}</span>
          </div>
        ))}
      </div>
      <div className="ta-action">{actionLine}</div>
    </div>
  );
}

/** Single metric tile with optional threshold color. */
function TATile({
  label, value, detail, tone
}: {
  label: string; value: string | number; detail?: string; tone?: "good" | "warn" | "bad" | "neutral";
}) {
  const col = tone === "good" ? "var(--buy, #22c55e)" : tone === "bad" ? "var(--sell, #ef4444)" : tone === "warn" ? "var(--accent)" : undefined;
  return (
    <div className="ta-tile">
      <span className="ta-tile-label">{label}</span>
      <strong className="ta-tile-value" style={{ color: col }}>{value}</strong>
      {detail && <small className="ta-tile-detail">{detail}</small>}
    </div>
  );
}

export function TradeAnalysisPanel({ data }: { data: UtaTickerResult }) {
  const analysis = data.trade_analysis;
  if (!analysis) return null;

  const pressure = Number(analysis.pressure.net_notional_pressure);
  const pressurePct = Math.abs(pressure) * 100;
  const conf = analysis.pressure.signing_confidence;
  const focusCount = analysis.block_flow.focus_trade_count ?? 0;
  const notR = Number(analysis.activity.notional_ratio ?? 0);
  const volR = Number(analysis.activity.volume_ratio ?? 0);

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

      {/* Metric tiles with threshold-based color */}
      <div className="ta-tiles">
        <TATile
          label="Signed pressure"
          value={`${fmtNumber(pressurePct, 1)}%`}
          detail={`${analysis.pressure.direction} · ${fmtNumber(pressurePct, 1)}% of dollars ${analysis.bias === "bullish" ? "buy" : analysis.bias === "bearish" ? "sell" : "mixed"}-directed`}
          tone={pressurePct >= 60 ? "good" : pressurePct >= 30 ? "warn" : "neutral"}
        />
        <TATile
          label="Signing confidence"
          value={fmtPct(conf)}
          detail={conf >= 0.5 ? "reliable — direction trustworthy" : "low — direction uncertain"}
          tone={conf >= 0.5 ? "good" : "bad"}
        />
        <TATile
          label="Vol × / Notional ×"
          value={`${fmtNumber(volR, 2)}× / ${fmtNumber(notR, 2)}×`}
          detail={`vs ${analysis.activity.baseline_sessions || 20}-session baseline`}
          tone={notR >= 1.5 ? "good" : notR >= 1.0 ? "warn" : "neutral"}
        />
        <TATile
          label="Focus / block prints"
          value={focusCount}
          detail={focusCount > 0 ? `${fmtMoney(analysis.block_flow.focus_notional)} notional` : "none above institutional floor"}
          tone={focusCount >= 3 ? "good" : focusCount > 0 ? "warn" : "neutral"}
        />
      </div>

      <div className="trade-analysis-body">
        <div>
          <h3>What the data says</h3>
          <TradeInterpretation data={data} />
        </div>
        <div>
          <h3>Trigger criteria</h3>
          <div className="criteria-list">
            {(analysis.criteria || []).map((item) => (
              <div className={`criteria ${item.passed ? "pass" : "fail"}`} key={item.id}>
                <b>{item.passed ? "✓" : "×"}</b>
                <span>
                  {item.label}
                  <small>{item.actual}</small>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
