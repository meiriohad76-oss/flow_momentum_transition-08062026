// src/uta/src/scan.tsx
import React, { useState } from "react";
import { fmtNumber, fmtPct, tickerList, setupTone, setupLabel, DEFAULT_PORTFOLIO, tierRank } from "./utils.js";
import { TierBadge, DirTag, BandTag, PressureGauge } from "./components.js";
import type { ScanResult, ScanRow, LoadState, UtaTickerResult } from "./types.js";

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

function ScanFunnel({
  screened,
  flagged,
  resolved,
  total,
  pass,
  isRunning
}: {
  screened: number;
  flagged: number;
  resolved: number;
  total: number;
  pass: 1 | 2;
  isRunning: boolean;
}) {
  const pass2Pct = total > 0 ? Math.round((resolved / total) * 100) : 0;
  return (
    <div className="scan-funnel">
      <div className="funnel-stages">
        <div className={`funnel-stage ${screened > 0 ? "done" : pass === 1 && isRunning ? "active" : "idle"}`}>
          <span className="funnel-count">{screened > 0 ? screened.toLocaleString() : "—"}</span>
          <span className="funnel-label">Screened</span>
          {screened > 0 && <span className="funnel-check">✓</span>}
        </div>
        <div className="funnel-arrow">→</div>
        <div className={`funnel-stage ${flagged > 0 ? (pass === 2 ? "active" : "done") : "idle"}`}>
          <span className="funnel-count">{flagged > 0 ? flagged : "—"}</span>
          <span className="funnel-label">Flagged</span>
        </div>
        <div className="funnel-arrow">→</div>
        <div className={`funnel-stage ${resolved > 0 ? (resolved >= total && total > 0 ? "done" : "active") : "idle"}`}>
          <span className="funnel-count">
            {resolved > 0 ? `${resolved} / ${total}` : "—"}
          </span>
          <span className="funnel-label">Resolved</span>
          {resolved >= total && total > 0 && <span className="funnel-check">✓</span>}
        </div>
      </div>
      {pass === 2 && isRunning && (
        <div className="funnel-progress">
          <div className="funnel-prog-bar" style={{ width: `${pass2Pct}%` }} />
          <span className="funnel-prog-label">Pass 2 · Resolving live prints · {pass2Pct}%</span>
        </div>
      )}
    </div>
  );
}

function ResolvingTable({
  rows,
  pass2Status
}: {
  rows: ScanRow[];
  pass2Status: "idle" | "loading" | "ready";
}) {
  return (
    <div className="resolving-table">
      {rows.map((row) => {
        const isResolved = !!row.result;
        const isActive = !isResolved && pass2Status === "loading";
        const statusClass = isResolved ? "rt-done" : isActive ? "rt-active" : "rt-queued";
        return (
          <div className={`rt-row ${statusClass}`} key={row.ticker}>
            <span className="rt-ticker mono">{row.ticker}</span>
            {isResolved && row.result ? (
              <>
                <TierBadge tier={row.result.tier} size="sm" />
                <DirTag direction={row.result.direction} />
                <span className="rt-check">✓ Resolved</span>
              </>
            ) : isActive ? (
              <span className="rt-resolving">Resolving…</span>
            ) : (
              <span className="rt-queued-label">
                {row.preliminary_tier ? `~ ${row.preliminary_tier} est` : "Queued"}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

type TierFilter = "all" | "A" | "B" | "C";
type ViewMode = "cards" | "table" | "grouped";

function RefinementBar({
  rows,
  tierFilter,
  onTierFilter,
  viewMode,
  onViewMode,
  onWatchAll,
  onSaveScan
}: {
  rows: ScanRow[];
  tierFilter: TierFilter;
  onTierFilter: (f: TierFilter) => void;
  viewMode: ViewMode;
  onViewMode: (v: ViewMode) => void;
  onWatchAll: () => void;
  onSaveScan: () => void;
}) {
  const counts: Record<string, number> = { all: rows.length };
  for (const row of rows) {
    const t = row.result?.tier || row.preliminary_tier || "D";
    counts[t] = (counts[t] || 0) + 1;
  }
  return (
    <div className="refinement-bar">
      <div className="ref-tier-chips">
        {(["all", "A", "B", "C"] as TierFilter[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`ref-chip ${tierFilter === t ? "active" : "secondary"}`}
            onClick={() => onTierFilter(t)}
          >
            {t === "all" ? "All" : `Tier ${t}`}
            <span className="ref-chip-count">{counts[t] ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="ref-view-switch">
        {(["cards", "table", "grouped"] as ViewMode[]).map((v) => (
          <button
            key={v}
            type="button"
            className={`ref-view-btn ${viewMode === v ? "active" : "secondary"}`}
            onClick={() => onViewMode(v)}
          >
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>
      <div className="ref-actions">
        <button type="button" className="secondary" onClick={onWatchAll}>Watch all shown</button>
        <button type="button" className="secondary" onClick={onSaveScan}>Save scan</button>
      </div>
    </div>
  );
}

function ScanCard({ row, onInspect }: { row: ScanRow; onInspect: (r: UtaTickerResult) => void }) {
  const result = row.result;
  const tier = result?.tier || row.preliminary_tier || "D";
  const direction = result?.direction || row.bias || "undetermined";
  const pressureVal = Number(row.signed_pressure ?? result?.indicators?.C?.net_notional_pressure ?? 0);
  const setupStatus = row.setup_status || result?.trade_analysis?.setup_status;
  const isClickable = !!result;
  return (
    <div
      className={`scan-card ${isClickable ? "clickable" : ""}`}
      onClick={isClickable ? () => onInspect(result!) : undefined}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
    >
      <div className="sc-head">
        <span className="sc-sym mono">{row.ticker}</span>
        <TierBadge tier={tier} size="sm" />
      </div>
      <div className="sc-meta">
        <DirTag direction={direction} />
        {row.anomaly_band && <BandTag band={row.anomaly_band} />}
      </div>
      {setupStatus && (
        <div className={`sc-setup pill ${setupTone(setupStatus)}`}>
          {setupLabel(setupStatus)}
        </div>
      )}
      <div className="sc-stats">
        {result && (
          <>
            <span className="sc-stat">
              <span>B</span>
              <strong>{fmtNumber(result.indicators.B.notional_zscore, 1)}σ</strong>
            </span>
            <span className="sc-stat">
              <span>C</span>
              <strong>{fmtNumber(result.indicators.C.notional_ratio, 1)}×</strong>
            </span>
          </>
        )}
      </div>
      <div className="sc-pressure-wrap">
        <PressureGauge value={pressureVal} />
      </div>
    </div>
  );
}

type SortKey = "ticker" | "tier" | "direction" | "B" | "A" | "C" | "setup" | "delta";

function ScanTable({
  rows,
  onInspect
}: {
  rows: ScanRow[];
  onInspect: (r: UtaTickerResult) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("tier");
  const [sortAsc, setSortAsc] = useState(false);

  function handleSort(key: SortKey) {
    if (sortKey === key) { setSortAsc((a) => !a); }
    else { setSortKey(key); setSortAsc(false); }
  }

  const sorted = [...rows].sort((a, b) => {
    const ra = a.result, rb = b.result;
    let av: unknown, bv: unknown;
    if (sortKey === "tier")   { av = tierRank(ra?.tier ?? a.preliminary_tier); bv = tierRank(rb?.tier ?? b.preliminary_tier); }
    else if (sortKey === "B") { av = ra?.indicators.B.notional_zscore ?? 0; bv = rb?.indicators.B.notional_zscore ?? 0; }
    else if (sortKey === "C") { av = ra?.indicators.C.notional_ratio ?? 0; bv = rb?.indicators.C.notional_ratio ?? 0; }
    else if (sortKey === "ticker") { av = a.ticker; bv = b.ticker; }
    else { av = 0; bv = 0; }
    const cmp = typeof av === "string" ? av.localeCompare(String(bv)) : Number(av) - Number(bv);
    return sortAsc ? cmp : -cmp;
  });

  function Th({ k, label }: { k: SortKey; label: string }) {
    return (
      <th
        onClick={() => handleSort(k)}
        style={{ cursor: "pointer", userSelect: "none" }}
      >
        {label} {sortKey === k ? (sortAsc ? "↑" : "↓") : ""}
      </th>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <Th k="ticker" label="Ticker" />
            <Th k="tier" label="Tier" />
            <Th k="direction" label="Direction" />
            <Th k="B" label="B (σ)" />
            <Th k="A" label="A (%)" />
            <Th k="C" label="C (×)" />
            <Th k="setup" label="Setup" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const r = row.result;
            const tier = r?.tier || row.preliminary_tier || "D";
            const setup = row.setup_status || r?.trade_analysis?.setup_status;
            return (
              <tr
                key={row.ticker}
                className={r ? "clickable-row" : ""}
                onClick={r ? () => onInspect(r) : undefined}
              >
                <td className="mono">{row.ticker}</td>
                <td><TierBadge tier={tier} size="sm" /></td>
                <td>{r ? <DirTag direction={r.direction} /> : "—"}</td>
                <td className="mono">{r ? fmtNumber(r.indicators.B.notional_zscore, 2) : "—"}</td>
                <td className="mono">{r?.indicators.A ? fmtPct(r.indicators.A.volume_percentile) : "N/A"}</td>
                <td className="mono">{r ? fmtNumber(r.indicators.C.notional_ratio, 2) : "—"}</td>
                <td>{setup ? <span className={`pill ${setupTone(setup)}`}>{setupLabel(setup)}</span> : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const TIER_DESC: Record<string, string> = {
  A: "Actionable — strong supporting evidence across multiple indicators",
  B: "Review closely — notable activity, confirm with corroboration",
  C: "Context only — elevated but insufficient for setup"
};

function ScanGrouped({
  rows,
  onInspect
}: {
  rows: ScanRow[];
  onInspect: (r: UtaTickerResult) => void;
}) {
  const byTier: Record<string, ScanRow[]> = { A: [], B: [], C: [] };
  for (const row of rows) {
    const t = row.result?.tier || row.preliminary_tier || "D";
    if (t === "A" || t === "B" || t === "C") byTier[t].push(row);
  }
  return (
    <div className="scan-grouped">
      {(["A", "B", "C"] as const).map((t) => {
        if (byTier[t].length === 0) return null;
        return (
          <div className="sg-section" key={t}>
            <div className="sg-header">
              <TierBadge tier={t} />
              <div>
                <div className="sg-tier-name">Tier {t}</div>
                <div className="sg-tier-desc">{TIER_DESC[t]}</div>
              </div>
              <span className="sg-count">{byTier[t].length}</span>
            </div>
            <div className="scan-cards-grid">
              {byTier[t].map((row) => (
                <ScanCard key={row.ticker} row={row} onInspect={onInspect} />
              ))}
            </div>
          </div>
        );
      })}
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
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    (localStorage.getItem("uta_scan_view") as ViewMode) || "cards"
  );

  function handleViewMode(v: ViewMode) {
    setViewMode(v);
    localStorage.setItem("uta_scan_view", v);
  }

  const resultRows = (pass2.data?.results ?? scan.data?.results ?? [])
    .filter((row) => tierFilter === "all" || (row.result?.tier || row.preliminary_tier) === tierFilter);

  // Derived values for funnel
  const pass1Data = scan.data;
  const pass2Data = pass2.data;
  const allRows: ScanRow[] = pass2Data?.results ?? pass1Data?.results ?? [];
  const resolvedCount = allRows.filter((r) => !!r.result).length;
  const isPass2Running = pass2.status === "loading";
  const currentPass: 1 | 2 = pass2.status !== "idle" ? 2 : 1;

  function resolveTickerList(): string[] {
    if (universe === "custom") return tickerList(customTickers);
    if (universe === "portfolio") return DEFAULT_PORTFOLIO;
    return [];
  }

  return (
    <section className="mode-stack">
      {/* Idle controls */}
      {scan.status === "idle" && (
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
            Run scan
          </button>
          <SavedScans
            scans={savedScans || []}
            onLoad={(s) => {
              setUniverse(String(s.universe || ""));
              setDirection((s.direction as "bullish" | "bearish" | "both") || "bullish");
            }}
          />
        </div>
      )}

      {/* Running / Pass-1 done */}
      {(scan.status === "loading" || (scan.status === "ready" && pass2.status !== "ready")) && (
        <div className="scan-running">
          <ScanFunnel
            screened={pass1Data?.scanned_count ?? (scan.status === "ready" ? (pass1Data?.results?.length ?? 0) : 0)}
            flagged={pass1Data?.shortlist_count ?? 0}
            resolved={resolvedCount}
            total={pass1Data?.shortlist_count ?? 0}
            pass={currentPass}
            isRunning={scan.status === "loading" || isPass2Running}
          />
          {allRows.length > 0 && (
            <ResolvingTable rows={allRows} pass2Status={pass2.status} />
          )}
          {scan.status === "ready" && pass2.status === "idle" && (
            <button type="button" onClick={onPass2}>
              Run Pass 2 — Resolve {pass1Data?.shortlist_count ?? 0} flagged tickers
            </button>
          )}
        </div>
      )}

      {/* Results — show when pass-1 or pass-2 data available */}
      {(pass2.status === "ready" || scan.status === "ready") && (
        <div className="scan-results">
          <RefinementBar
            rows={pass2.data?.results ?? scan.data?.results ?? []}
            tierFilter={tierFilter}
            onTierFilter={setTierFilter}
            viewMode={viewMode}
            onViewMode={handleViewMode}
            onWatchAll={() => { /* Phase 5: bulk watchlist add */ }}
            onSaveScan={() => { /* Phase 5: persist saved scan */ }}
          />
          {viewMode === "cards" && (
            <div className="scan-cards-grid">
              {resultRows.map((row) => (
                <ScanCard key={row.ticker} row={row} onInspect={onInspect} />
              ))}
            </div>
          )}
          {viewMode === "table" && (
            <ScanTable rows={resultRows} onInspect={onInspect} />
          )}
          {viewMode === "grouped" && (
            <ScanGrouped rows={resultRows} onInspect={onInspect} />
          )}
          {resultRows.length === 0 && (
            <p className="empty">No results match the current filter.</p>
          )}
        </div>
      )}
    </section>
  );
}
