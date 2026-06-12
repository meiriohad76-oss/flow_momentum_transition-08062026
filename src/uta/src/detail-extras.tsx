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

  return (
    <section className="panel cyc">
      <SectionHeader title="Cycle History" meta={`last ${rows.length} cycles`} />
      <div className="cyc-bars">
        {rows.map((row, i) => {
          const isUp = row.direction === "bullish";
          const heightPct = 40;
          const barStyle = isUp
            ? { bottom: "50%", height: `${heightPct}%` }
            : { top: "50%", height: `${heightPct}%` };
          return (
            <div className="cyc-bar-col" key={i}>
              <div
                className={`cyc-bar ${isUp ? "up" : "dn"}`}
                style={barStyle}
                title={`${row.tier || "D"} · ${row.direction || "—"} · ${fmtDate(row.generated_at || row.created_at)}`}
              />
            </div>
          );
        })}
      </div>
      <div className="cyc-ribbon">
        {rows.map((row, i) => {
          const tier = (row.tier || "D").toUpperCase();
          const isNow = i === rows.length - 1;
          return (
            <div
              key={i}
              className={`cyc-cell cyc-${tier} ${isNow ? "cyc-now" : ""}`}
              title={fmtDate(row.generated_at || row.created_at)}
            >
              {tier}
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
