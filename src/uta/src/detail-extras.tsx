// src/uta/src/detail-extras.tsx
import React from "react";
import { fmtDate, fmtMoney } from "./utils.js";
import { SectionHeader, TierBadge } from "./components.js";
import type { UtaTickerResult, RawPrint, HistoryResult } from "./types.js";

export function CycleHistory({
  ticker,
  history
}: {
  ticker: string;
  history: HistoryResult | null;
}) {
  const rows = (history?.rows || [])
    .filter((r) => r.ticker === ticker)
    .slice(0, 12)
    .reverse();

  if (rows.length === 0) {
    return (
      <section className="panel cyc">
        <SectionHeader title="Cycle History" meta={ticker} />
        <div className="cyc-cell cyc-D">No cycle history yet</div>
      </section>
    );
  }

  /** Bar height fraction 0–1 per tier */
  function tierFrac(tier: string): number {
    const t = String(tier || "D").toUpperCase();
    if (t === "A") return 0.88;
    if (t === "B") return 0.62;
    if (t === "C") return 0.38;
    return 0.12;
  }

  function formatCycleTs(ts: string | undefined): string {
    if (!ts) return "—";
    try {
      const d = new Date(ts);
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      if (sameDay) {
        return d
          .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
          .replace(" AM", "a")
          .replace(" PM", "p");
      }
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch {
      return "—";
    }
  }

  // SVG bar chart — avoids all CSS absolute-positioning conflicts
  const SVG_H = 72;
  const COLS = 12; // always render 12 slots so the scale is consistent
  const COL_W = 10; // viewBox units per column
  const SVG_W = COLS * COL_W;
  const MID = SVG_H / 2;

  return (
    <section className="panel cyc">
      <SectionHeader title="Cycle History" meta={`last ${rows.length} cycle${rows.length !== 1 ? "s" : ""} · oldest → newest`} />

      {/* SVG bar chart — fully geometry-controlled */}
      <svg
        className="cyc-svg"
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        style={{ width: "100%", height: SVG_H, display: "block" }}
        preserveAspectRatio="none"
        aria-label="Cycle history"
      >
        {/* midline */}
        <line x1={0} y1={MID} x2={SVG_W} y2={MID} stroke="var(--border-strong, #2a3540)" strokeWidth="0.6" />

        {rows.map((row, i) => {
          const tier = String(row.tier || "D").toUpperCase();
          const isUp = row.direction === "bullish";
          const isDown = row.direction === "bearish";
          const frac = tierFrac(tier);
          const maxH = MID - 3;
          const barH = Math.max(2, frac * maxH);
          const fill = isUp ? "var(--buy, #22c55e)" : isDown ? "var(--sell, #ef4444)" : "var(--ink-3)";
          const opacity = tier === "D" ? 0.45 : 1;
          // place in last `rows.length` slots (right-aligned in 12-slot grid)
          const slot = COLS - rows.length + i;
          const x = slot * COL_W + COL_W * 0.15;
          const bW = COL_W * 0.70;
          const y = isUp ? MID - barH : MID;
          return (
            <rect key={i} x={x} y={y} width={bW} height={barH} rx="1.5" fill={fill} opacity={opacity}>
              <title>Tier {tier} · {row.direction || "—"} · {fmtDate(row.generated_at || row.created_at)}</title>
            </rect>
          );
        })}
      </svg>

      {/* Ribbon: tier + direction + timestamp per cell */}
      <div className="cyc-ribbon">
        {rows.map((row, i) => {
          const tier = (row.tier || "D").toUpperCase();
          const isNow = i === rows.length - 1;
          const isUp = row.direction === "bullish";
          const isDown = row.direction === "bearish";
          const ts = row.generated_at || row.created_at;
          return (
            <div
              key={i}
              className={`cyc-cell cyc-${tier} ${isNow ? "cyc-now" : ""}`}
              title={`Tier ${tier} · ${row.direction || "undetermined"} · ${fmtDate(ts)}`}
            >
              <span className="cyc-dir">{isUp ? "↑" : isDown ? "↓" : "·"}</span>
              <span className="cyc-letter">{tier}</span>
              <span className="cyc-ts">{formatCycleTs(ts)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function RawPrintsDrawer({ data, open, onClose }: { data: UtaTickerResult; open: boolean; onClose: () => void }) {
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
                {prints.length === 0 ? (
                  <tr><td colSpan={8}>No raw prints available.</td></tr>
                ) : prints.map((print: RawPrint, index: number) => (
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

export function ExplainTierPanel({ data, open, onClose }: { data: UtaTickerResult; open: boolean; onClose: () => void }) {
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
