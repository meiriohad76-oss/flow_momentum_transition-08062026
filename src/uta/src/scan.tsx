// src/uta/src/scan.tsx
import React, { useState } from "react";
import { fmtNumber, fmtPct, tickerList, setupTone, setupLabel } from "./utils.js";
import { Pill, SectionHeader } from "./components.js";
import type { ScanResult, LoadState, UtaTickerResult } from "./types.js";

export function ScanMode({
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
