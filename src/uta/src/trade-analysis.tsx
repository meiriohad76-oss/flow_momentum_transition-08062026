// src/uta/src/trade-analysis.tsx
import React from "react";
import { fmtMoney, fmtPct, fmtNumber } from "./utils.js";
import { Pill, SectionHeader, MetricTile, BandTag } from "./components.js";
import type { UtaTickerResult } from "./types.js";

function toneForBias(bias?: string) {
  if (bias === "bullish") return "good";
  if (bias === "bearish") return "bad";
  if (bias === "neutral") return "neutral";
  return "warn";
}

export function TradeAnalysisPanel({ data }: { data: UtaTickerResult }) {
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
