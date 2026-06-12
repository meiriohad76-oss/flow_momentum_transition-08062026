// src/uta/src/scan.tsx
import React, { useState } from "react";
import { fmtNumber, fmtPct, tickerList, setupTone, setupLabel, DEFAULT_PORTFOLIO } from "./utils.js";
import { Pill, SectionHeader } from "./components.js";
import type { ScanResult, LoadState, UtaTickerResult } from "./types.js";

type UniverseOption = {
  id: string;
  label: string;
  count: number;
  perfTier: "fast" | "standard" | "extended";
};

type UniverseGroup = {
  group: string;
  options: UniverseOption[];
};

const UNIVERSE_GROUPS: UniverseGroup[] = [
  {
    group: "US Indices",
    options: [
      { id: "dow30",      label: "DOW 30",        count: 30,   perfTier: "fast" },
      { id: "nasdaq100",  label: "NASDAQ-100",     count: 100,  perfTier: "fast" },
      { id: "sp500",      label: "S&P 500",        count: 503,  perfTier: "standard" },
      { id: "sp400",      label: "S&P 400 Mid",    count: 400,  perfTier: "standard" },
      { id: "sp600",      label: "S&P 600 Small",  count: 600,  perfTier: "extended" },
      { id: "russell1000",label: "Russell 1000",   count: 1000, perfTier: "extended" },
      { id: "russell2000",label: "Russell 2000",   count: 2000, perfTier: "extended" },
    ]
  },
  {
    group: "US Sectors",
    options: [
      { id: "sector_tech",   label: "Technology",          count: 68,  perfTier: "fast" },
      { id: "sector_health", label: "Health Care",         count: 64,  perfTier: "fast" },
      { id: "sector_fin",    label: "Financials",          count: 72,  perfTier: "fast" },
      { id: "sector_cons",   label: "Consumer Discretionary", count: 54, perfTier: "fast" },
      { id: "sector_ind",    label: "Industrials",         count: 78,  perfTier: "standard" },
      { id: "sector_energy", label: "Energy",              count: 23,  perfTier: "fast" },
    ]
  },
  {
    group: "US Exchanges",
    options: [
      { id: "nyse_arca",  label: "NYSE Arca",    count: 480,  perfTier: "standard" },
      { id: "nyse_listed",label: "NYSE Listed",  count: 2300, perfTier: "extended" },
      { id: "nasdaq_cm",  label: "NASDAQ Listed",count: 3100, perfTier: "extended" },
    ]
  },
  {
    group: "Custom",
    options: [
      { id: "portfolio",  label: "My Portfolio", count: 0, perfTier: "fast" },
      { id: "watchlist",  label: "My Watchlist", count: 0, perfTier: "fast" },
      { id: "custom",     label: "Custom list",  count: 0, perfTier: "fast" },
    ]
  }
];

const PERF_TIER_LABEL: Record<string, string> = {
  fast: "🟢 Fast",
  standard: "🟡 Standard",
  extended: "🔴 Extended"
};

const PERF_TIER_ESTIMATE: Record<string, string> = {
  fast:     "< 30 s",
  standard: "1–3 min",
  extended: "5–15 min"
};

function UniverseSelector({
  value,
  onChange,
  customTickers,
  onCustomTickersChange
}: {
  value: string;
  onChange: (id: string) => void;
  customTickers: string;
  onCustomTickersChange: (v: string) => void;
}) {
  const selected = UNIVERSE_GROUPS
    .flatMap((g) => g.options)
    .find((o) => o.id === value);

  return (
    <div className="universe-selector">
      <label className="uni-label">Universe</label>
      <select
        className="uni-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— Choose a universe —</option>
        {UNIVERSE_GROUPS.map((g) => (
          <optgroup key={g.group} label={g.group}>
            {g.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}{o.count > 0 ? ` (${o.count.toLocaleString()})` : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {selected && (
        <div className="uni-perf-chip">
          <span className="uni-perf-badge">{PERF_TIER_LABEL[selected.perfTier]}</span>
          <span className="uni-perf-est">~{PERF_TIER_ESTIMATE[selected.perfTier]}</span>
        </div>
      )}
      {value === "custom" && (
        <textarea
          className="uni-custom-input"
          placeholder="AAPL, MSFT, NVDA, …"
          value={customTickers}
          onChange={(e) => onCustomTickersChange(e.target.value)}
          rows={3}
        />
      )}
    </div>
  );
}

function DirectionFilter({
  value,
  onChange
}: {
  value: "bullish" | "bearish" | "both";
  onChange: (v: "bullish" | "bearish" | "both") => void;
}) {
  const opts: Array<{ id: "bullish" | "bearish" | "both"; label: string }> = [
    { id: "bullish", label: "Bullish" },
    { id: "bearish", label: "Bearish" },
    { id: "both",    label: "Both" }
  ];
  return (
    <div className="direction-filter">
      <span className="dir-filter-label">Direction</span>
      <div className="dir-seg">
        {opts.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`dir-seg-btn ${value === o.id ? "active" : "secondary"}`}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SavedScans({
  scans,
  onLoad
}: {
  scans: Array<Record<string, unknown>>;
  onLoad: (scan: Record<string, unknown>) => void;
}) {
  if (!scans || scans.length === 0) return null;
  return (
    <div className="saved-scans">
      <div className="saved-scans-label">Saved scans</div>
      <div className="saved-scans-list">
        {scans.map((s, i) => (
          <button
            key={i}
            type="button"
            className="saved-scan-chip secondary"
            onClick={() => onLoad(s)}
          >
            {String(s.universe_label || s.universe || "Scan")} · {String(s.direction || "any")}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ScanMode({
  scan,
  pass2,
  onPass1,
  onPass2,
  onInspect,
  savedScans
}: {
  scan: LoadState<ScanResult>;
  pass2: LoadState<ScanResult>;
  onPass1: (direction: string, tickers: string[]) => void;
  onPass2: () => void;
  onInspect: (result: UtaTickerResult) => void;
  savedScans?: Array<Record<string, unknown>>;
}) {
  const [universe, setUniverse] = useState("");
  const [direction, setDirection] = useState<"bullish" | "bearish" | "both">("bullish");
  const [customTickers, setCustomTickers] = useState("");
  const preliminaryRows = scan.data?.results || [];
  const resolvedRows = pass2.data?.results || [];

  function resolveTickerList(): string[] {
    if (universe === "custom") return tickerList(customTickers);
    if (universe === "portfolio") return DEFAULT_PORTFOLIO;
    return [];
  }

  return (
    <section className="mode-stack">
      <div className="scan-controls">
        <UniverseSelector
          value={universe}
          onChange={setUniverse}
          customTickers={customTickers}
          onCustomTickersChange={setCustomTickers}
        />
        <DirectionFilter value={direction} onChange={setDirection} />
        <button
          type="button"
          disabled={!universe || scan.status === "loading"}
          onClick={() => onPass1(direction, resolveTickerList())}
        >
          {scan.status === "loading" ? "Scanning…" : "Run scan"}
        </button>
        <SavedScans
          scans={savedScans || []}
          onLoad={(s) => {
            setUniverse(String(s.universe || ""));
            setDirection((s.direction as "bullish" | "bearish" | "both") || "bullish");
          }}
        />
      </div>
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
