// src/uta/src/trade-analysis.tsx
import React from "react";
import { fmtMoney, fmtPct, fmtNumber } from "./utils.js";
import { Pill, SectionHeader, BandTag, Tooltip, ThresholdBar } from "./components.js";
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
  // Use net_signed_pressure — labeled trades only: (buy$ − sell$) / (buy$ + sell$).
  // net_notional_pressure uses a different denominator (all$) and would show a diluted number
  // under the "signed flow" label, contradicting the evidence panel which uses net_signed_pressure.
  const pressure = Number(analysis.pressure.net_signed_pressure ?? 0);
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
  // Mirror backend conf-adjusted threshold: 60% when conf ≥ 50%, 72% when 35–50%, 200% (unreachable) below 35%.
  const confAdjThr = conf >= 0.5 ? 60 : conf >= 0.35 ? 72 : 200;
  const pressureOK = pressurePct >= confAdjThr;
  const confOK = conf >= 0.5;
  const bOK = maxB >= 1.5;
  const notR = Number(analysis.activity.notional_ratio ?? 1);
  const focusCount = analysis.block_flow.focus_trade_count ?? 0;

  type LineType = "confirmed" | "missing" | "watch";
  const lines: Array<{ type: LineType; text: string }> = [];

  // Confirmed signals
  if (pressureOK) {
    lines.push({ type: "confirmed", text: `Signed flow is ${dir}: ${fmtNumber(pressurePct, 1)}% of labeled trades are ${dirFlow}-directed — above the ${confAdjThr}% threshold. ${dirWord.charAt(0).toUpperCase() + dirWord.slice(1)}s are in control of this session.` });
  }
  if (confOK) {
    lines.push({ type: "confirmed", text: `Signing coverage ${fmtPct(conf)} is above the 50% floor — sufficient trades were labeled, making the direction signal trustworthy.` });
  }
  if (bOK) {
    lines.push({ type: "confirmed", text: `B-score ${fmtNumber(maxB, 2)}σ — above the 1.5σ review trigger. Dollar flow is statistically elevated vs own history.` });
  }
  if (focusCount >= 3) {
    lines.push({ type: "confirmed", text: `${focusCount} institutional-size prints confirmed — block ${dirFlow}ers are active.` });
  }

  // Missing signals
  if (!pressureOK) {
    lines.push({ type: "missing", text: `Signed pressure ${fmtNumber(pressurePct, 1)}% is below the ${confAdjThr}% threshold — no clear directional edge yet. Both sides are fairly balanced.` });
  }
  if (!confOK) {
    lines.push({ type: "missing", text: `Signing coverage only ${fmtPct(conf)} — below 50% floor. Too few labeled trades to trust the direction signal.` });
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

// ── Criterion glossary — explains technical terms on hover ───────────────
const CRITERION_TIPS: Array<{ match: string; tip: string }> = [
  { match: "b anomaly",    tip: "B-score (B indicator): how many standard deviations above its own 20-session average this ticker's flow is. 0σ = average; 1.5σ = elevated; 2.5σ = highly unusual. Compared against the ticker's own history — not other stocks." },
  { match: "sigma",        tip: "σ (sigma / standard deviation): a statistical measure of how far a value is from its own average. 1σ covers ~68% of typical sessions; 2σ covers ~95%. Values above 1.5σ are considered statistically unusual." },
  { match: "notional",     tip: "Notional = shares traded × price per share. Measures the dollar-scale of activity, not just trade count. 1.5× notional means 50% more dollar volume than the typical session for this ticker." },
  { match: "signed pressure", tip: "Signed pressure: of all tracked dollar volume, what % is directionally assigned to buyers vs sellers. ≥60% means one side strongly dominates. Computed by signing each trade using quote-side and tick-rule methods." },
  { match: "raw c",        tip: "C indicator (raw magnitude): direct ratios vs session baseline. Volume ratio = today's trade count ÷ baseline average. Focus prints = individual trades at or above the institutional size floor ($1M+)." },
  { match: "focus",        tip: "Focus / block prints: individual trades at or above the institutional-size floor. Confirms that position-size money is moving — not just retail order flow. ≥3 prints is the block activity threshold." },
  { match: "lanes",        tip: "Data lanes: the required data sources for the analysis — baseline daily bars and live trade prints. Both must be available and fresh for a valid result." },
];

function getCriterionTip(label: string): string | undefined {
  const lower = label.toLowerCase();
  for (const { match, tip } of CRITERION_TIPS) {
    if (lower.includes(match)) return tip;
  }
  return undefined;
}

/** Parse (value, threshold, unit) from an API criterion row so we can render a ThresholdBar. */
function parseCriterionBar(label: string, actual: string): { value: number; threshold: number; unit: string } | null {
  // B-score: "max 0.84 sigma" or similar in actual; "1.5 sigma" in label
  const maxSigma = actual.match(/max\s*([\d.]+)\s*sigma/i) ?? actual.match(/\b([\d.]+)\s*sigma\b/i);
  const threshSigma = label.match(/([\d.]+)\s*sigma/i);
  if (maxSigma && threshSigma) {
    return { value: parseFloat(maxSigma[1]), threshold: parseFloat(threshSigma[1]), unit: "σ" };
  }
  // Ratio: "1.19x" in actual, "1.5x" in label
  const ratioActual = actual.match(/^([\d.]+)x\b/i);
  const ratioThresh = label.match(/([\d.]+)x\b/i);
  if (ratioActual && ratioThresh) {
    return { value: parseFloat(ratioActual[1]), threshold: parseFloat(ratioThresh[1]), unit: "×" };
  }
  // Percent: "64.1% something" in actual, "60%" in label
  const pctActual = actual.match(/^([\d.]+)%/);
  const pctThresh = label.match(/([\d.]+)%/);
  if (pctActual && pctThresh) {
    return { value: parseFloat(pctActual[1]), threshold: parseFloat(pctThresh[1]), unit: "%" };
  }
  return null;
}

/** Single criterion row with tooltip + optional threshold bar. */
function CriterionRow({ item }: { item: { id: string; label: string; passed: boolean; actual: string } }) {
  const tip = getCriterionTip(item.label);
  const barData = !item.passed ? parseCriterionBar(item.label, item.actual) : null;
  return (
    <div className={`criteria ${item.passed ? "pass" : "fail"}`}>
      <b>{item.passed ? "✓" : "×"}</b>
      <span>
        <span className="crit-label-row">
          {tip ? (
            <Tooltip text={tip}>
              <span className="crit-label">{item.label}</span>
              <span className="crit-help-icon" aria-hidden="true">?</span>
            </Tooltip>
          ) : (
            <span className="crit-label">{item.label}</span>
          )}
        </span>
        <small>{item.actual}</small>
        {barData && (
          <ThresholdBar
            value={barData.value}
            threshold={barData.threshold}
            unit={barData.unit}
            showLabels={false}
          />
        )}
      </span>
    </div>
  );
}

export function TradeAnalysisPanel({ data }: { data: UtaTickerResult }) {
  const analysis = data.trade_analysis;
  if (!analysis) return null;

  // Use net_signed_pressure (labeled trades only) — same metric as the evidence panel displays.
  const pressure = Number(analysis.pressure.net_signed_pressure ?? 0);
  const pressurePct = Math.abs(pressure) * 100;
  const conf = analysis.pressure.signing_confidence;
  // Conf-adjusted threshold matches backend: 60% when conf ≥ 50%, 72% when 35–50%.
  const confAdjThrPanel = conf >= 0.5 ? 60 : conf >= 0.35 ? 72 : 200;
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

      {/* Metric tiles — color-coded, each with mini threshold bar */}
      <div className="ta-tiles">
        <div className="ta-tile">
          <span className="ta-tile-label">
            <Tooltip text={`Signed pressure: of labeled trades only (buy$ + sell$), what % is buyer-directed vs seller-directed. ≥${confAdjThrPanel}% means one side strongly dominates (threshold is conf-adjusted). Different from net notional pressure, which dilutes by all dollar volume including dark pool.`}>
              Signed pressure <span className="crit-help-icon">?</span>
            </Tooltip>
          </span>
          <strong className="ta-tile-value" style={{ color: pressurePct >= confAdjThrPanel ? "var(--buy)" : pressurePct >= 30 ? "var(--accent)" : undefined }}>{fmtNumber(pressurePct, 1)}%</strong>
          <small className="ta-tile-detail">{analysis.pressure.direction} · of labeled trades</small>
          <ThresholdBar value={pressurePct} threshold={confAdjThrPanel} max={100} unit="%" />
        </div>
        <div className="ta-tile">
          <span className="ta-tile-label">
            <Tooltip text="Signing coverage: what % of dollar volume could be reliably labeled as buy or sell direction. Below 50%: too few labeled trades to trust the direction signal.">
              Signing coverage <span className="crit-help-icon">?</span>
            </Tooltip>
          </span>
          <strong className="ta-tile-value" style={{ color: conf >= 0.5 ? "var(--buy)" : "var(--sell)" }}>{fmtPct(conf)}</strong>
          <small className="ta-tile-detail">{conf >= 0.5 ? "reliable — direction trustworthy" : "low — direction uncertain"}</small>
          <ThresholdBar value={conf * 100} threshold={50} max={100} unit="%" />
        </div>
        <div className="ta-tile">
          <span className="ta-tile-label">
            <Tooltip text="Notional (dollar volume) = shares × price. Measures the dollar scale of activity vs the typical session. 1.5× means 50% more dollar volume than the ticker's own 20-session average.">
              Notional × (dollar flow) <span className="crit-help-icon">?</span>
            </Tooltip>
          </span>
          <strong className="ta-tile-value" style={{ color: notR >= 1.5 ? "var(--buy)" : notR >= 1.0 ? "var(--accent)" : undefined }}>{fmtNumber(notR, 2)}×</strong>
          <small className="ta-tile-detail">vol {fmtNumber(volR, 2)}× · vs {analysis.activity.baseline_sessions || 20}-session baseline</small>
          <ThresholdBar value={notR} threshold={1.5} max={3} unit="×" />
        </div>
        <div className="ta-tile">
          <span className="ta-tile-label">
            <Tooltip text="Focus / block prints: individual trades at or above the institutional-size floor. Confirms that position-size money is active, not just retail flow. ≥3 prints is the block activity threshold.">
              Focus / block prints <span className="crit-help-icon">?</span>
            </Tooltip>
          </span>
          <strong className="ta-tile-value" style={{ color: focusCount >= 3 ? "var(--buy)" : focusCount > 0 ? "var(--accent)" : undefined }}>{focusCount}</strong>
          <small className="ta-tile-detail">{focusCount > 0 ? `${fmtMoney(analysis.block_flow.focus_notional)} notional` : "none above institutional floor"}</small>
        </div>
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
              <CriterionRow key={item.id} item={item} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
