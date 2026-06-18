// src/uta/src/app.tsx
import React, { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, fmtDate, LIVE_SOURCE_MODE, DEFAULT_PORTFOLIO, SAFE_TICKER_PATTERN } from "./utils.js";
import { useSseEvents, SingleMode, PortfolioMode, RuntimeMode } from "./modes.js";
import { ScanMode } from "./scan.js";
import { AlertsMode } from "./alerts.js";
import { TierBadge, DirTag } from "./components.js";
import type {
  Mode, UtaTickerResult, PortfolioResult, ScanResult, RuntimeStatus,
  ProviderStatus, HistoryResult, SchedulerResult, UserStateResult, LaneState, LoadState, UtaRule
} from "./types.js";

function TopBar({
  mode, onMode, onHome, onSearch, onOpenWatchlist, onOpenRuntime,
  watchlistCount, alertCount, syncState, syncTime, themeToggle, densityControl
}: {
  mode: Mode;
  onMode: (m: Mode) => void;
  onHome: () => void;
  onSearch: (sym: string) => void;
  onOpenWatchlist: () => void;
  onOpenRuntime: () => void;
  watchlistCount: number;
  alertCount: number;
  syncState: "live" | "revalidating" | "error";
  syncTime?: string;
  themeToggle: () => void;
  densityControl: () => void;
}) {
  const [searchVal, setSearchVal] = React.useState("");
  const tabs: { id: Mode; label: string; badge?: number }[] = [
    { id: "single", label: "Single Ticker" },
    { id: "portfolio", label: "Portfolio" },
    { id: "scan", label: "Scan" },
    { id: "alerts", label: "Alerts", badge: alertCount > 0 ? alertCount : undefined }
  ];

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const sym = searchVal.trim().toUpperCase();
    if (sym) { onSearch(sym); setSearchVal(""); }
  }

  return (
    <header className="uta-topbar">
      <button className="topbar-brand secondary icon-button" type="button" onClick={onHome} title="Home">
        UTA
      </button>
      <nav className="topbar-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`topbar-tab ${mode === t.id ? "active" : ""}`}
            onClick={() => onMode(t.id)}
          >
            {t.label}
            {t.badge ? <span className="tab-badge">{t.badge}</span> : null}
          </button>
        ))}
      </nav>
      <form className="topbar-search" onSubmit={handleSearch}>
        <input
          type="text"
          placeholder="Search ticker…"
          value={searchVal}
          onChange={(e) => setSearchVal(e.target.value)}
          className="topbar-search-input"
        />
      </form>
      <div className="topbar-actions">
        <button className="secondary icon-button" type="button" onClick={onOpenWatchlist} title="Watchlist">
          ☆ {watchlistCount > 0 ? watchlistCount : ""}
        </button>
        <button className="secondary icon-button" type="button" onClick={themeToggle} title="Toggle theme">◑</button>
        <button className="secondary icon-button" type="button" onClick={densityControl} title="Density">≡</button>
        <span className={`sync-indicator ${syncState}`}>
          {syncState === "revalidating" ? "Revalidating…" : `Live · ${syncTime || "--:--"} ET`}
        </span>
        <button className="secondary icon-button" type="button" onClick={onOpenRuntime} title="Operator">⚙</button>
      </div>
    </header>
  );
}

type MacroRegime = {
  badge: "Risk-On" | "Neutral" | "Risk-Off" | "Crisis";
  vix?: number;
  t10y2y?: number;
  fed_funds?: number;
  interpretation: string;
};

function RegimeBanner({ regime }: { regime: MacroRegime | null }) {
  if (!regime) return null;
  const toneClass = { "Risk-On": "on", "Neutral": "neutral", "Risk-Off": "off", "Crisis": "crisis" }[regime.badge];
  return (
    <div className={`regime-banner regime-${toneClass}`}>
      <span className="regime-badge">{regime.badge}</span>
      {regime.vix != null && <span>VIX {regime.vix.toFixed(1)}</span>}
      {regime.t10y2y != null && <span>T10Y2Y {regime.t10y2y.toFixed(2)}%</span>}
      {regime.fed_funds != null && <span>Fed Funds {regime.fed_funds.toFixed(2)}%</span>}
      <span className="regime-interp">{regime.interpretation}</span>
    </div>
  );
}

function WatchlistDrawer({
  watchlist, results, onClose, onNavigate, onRemove
}: {
  watchlist: string[];
  results: UtaTickerResult[];
  onClose: () => void;
  onNavigate: (sym: string) => void;
  onRemove: (sym: string) => void;
}) {
  const resultMap = Object.fromEntries(results.map((r) => [r.ticker, r]));
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer watchlist-drawer">
        <div className="drawer-head">
          <span className="dt">Watchlist · {watchlist.length} saved</span>
          <button className="x-close icon-button secondary" type="button" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">
          {watchlist.length === 0 ? (
            <p className="empty">No tickers saved yet. Use 'Add to watchlist' in any ticker detail view.</p>
          ) : watchlist.map((sym) => {
            const r = resultMap[sym];
            return (
              <div className="wl-row" key={sym}>
                <button type="button" className="wl-sym secondary" onClick={() => { onNavigate(sym); onClose(); }}>
                  <span className="mono">{sym}</span>
                  {r ? <><TierBadge tier={r.tier} size="sm" /><DirTag direction={r.direction} /></> : null}
                </button>
                <button type="button" className="icon-button secondary" onClick={() => onRemove(sym)}>×</button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function RevalidationBar({ active }: { active: boolean }) {
  if (!active) return null;
  return <div className="revalidation-bar" />;
}

function HomeMode({
  onMode, lastCycleAt, universeCount, regimeBadge
}: {
  onMode: (mode: Mode) => void;
  lastCycleAt?: string;
  universeCount?: number;
  regimeBadge?: string;
}) {
  const cards = [
    {
      mode: "single" as Mode,
      icon: "◎",
      name: "Single Ticker",
      desc: "Deep analysis of one ticker against its own history.",
      tierRules: "B + C only · no peer group · signed-flow direction"
    },
    {
      mode: "portfolio" as Mode,
      icon: "⊞",
      name: "Portfolio",
      desc: "Rank all your holdings against each other in one cycle.",
      tierRules: "A + B + C · ranked vs your portfolio today"
    },
    {
      mode: "scan" as Mode,
      icon: "⊙",
      name: "Scan / Discovery",
      desc: "Two-pass universe scan — daily bar screen then live prints.",
      tierRules: "A + B + C · two-pass discovery · universe percentile"
    }
  ];
  return (
    <div className="home-mode">
      <div className="home-hero">
        <div className="home-eyebrow">Choose how you want to look at the market</div>
        <h1 className="home-headline">Unusual Trading Activity</h1>
        <p className="home-thesis">
          Three independent indicators — B (historical z-score), A (universe percentile), C (raw magnitude) —
          that are never collapsed into a single score. Tier is rule-based and always auditable.
          Honest data lanes: incomplete data produces Tier D, never a fabricated result.
        </p>
      </div>
      <div className="home-cards">
        {cards.map((c) => (
          <button key={c.mode} className="home-card" type="button" onClick={() => onMode(c.mode)}>
            <div className="home-card-icon">{c.icon}</div>
            <div className="home-card-name">{c.name}</div>
            <div className="home-card-desc">{c.desc}</div>
            <div className="home-card-rules">{c.tierRules}</div>
          </button>
        ))}
      </div>
      <button className="home-alerts-banner" type="button" onClick={() => onMode("alerts")}>
        <span className="home-alerts-label">Alerts &amp; Rules</span>
        <span className="home-alerts-desc">Typed event feed · rule matches · tier changes</span>
        <span className="home-alerts-cta">View →</span>
      </button>
      <div className="home-footer">
        {lastCycleAt ? <span>Last cycle: {fmtDate(lastCycleAt)}</span> : null}
        {universeCount ? <span>{universeCount.toLocaleString()} tickers tracked</span> : null}
        {regimeBadge ? <span className="home-regime-chip">{regimeBadge}</span> : null}
      </div>
    </div>
  );
}

export function App() {
  const [mode, setMode] = useState<Mode>("home");
  const [activeTicker, setActiveTicker] = useState("AVGO");
  const [single, setSingle] = useState<LoadState<UtaTickerResult>>({ status: "idle" });
  const [portfolio, setPortfolio] = useState<LoadState<PortfolioResult>>({ status: "idle" });
  const [scan, setScan] = useState<LoadState<ScanResult>>({ status: "idle" });
  const [pass2, setPass2] = useState<LoadState<ScanResult>>({ status: "idle" });
  const [runtime, setRuntime] = useState<LoadState<RuntimeStatus>>({ status: "idle" });
  const [providers, setProviders] = useState<LoadState<ProviderStatus>>({ status: "idle" });
  const [history, setHistory] = useState<HistoryResult | null>(null);
  const [scheduler, setScheduler] = useState<LoadState<SchedulerResult>>({ status: "idle" });
  const [userState, setUserState] = useState<UserStateResult | null>(null);
  const stream = useSseEvents();

  const [theme, setTheme] = React.useState<"dark" | "light">(() => {
    return (localStorage.getItem("uta_theme_v1") as "dark" | "light") || "dark";
  });
  const [density, setDensity] = React.useState<"compact" | "regular" | "comfy">(() => {
    return (localStorage.getItem("uta_density_v1") as "compact" | "regular" | "comfy") || "regular";
  });
  const [showDensityPop, setShowDensityPop] = React.useState(false);
  const [showWatchlist, setShowWatchlist] = React.useState(false);
  const [showRuntime, setShowRuntime] = React.useState(false);
  const [autoRefreshInterval, setAutoRefreshInterval] = React.useState<0 | 3 | 5 | 10>(() => {
    const stored = Number(localStorage.getItem("uta_autorefresh_v1"));
    return ([0, 3, 5, 10] as const).includes(stored as 0 | 3 | 5 | 10) ? (stored as 0 | 3 | 5 | 10) : 5;
  });
  const [showSettingsPop, setShowSettingsPop] = React.useState(false);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowRuntime(false);
        setShowSettingsPop(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("uta_theme_v1", theme);
  }, [theme]);

  React.useEffect(() => {
    document.documentElement.setAttribute("data-density", density);
    localStorage.setItem("uta_density_v1", density);
  }, [density]);

  React.useEffect(() => {
    localStorage.setItem("uta_autorefresh_v1", String(autoRefreshInterval));
  }, [autoRefreshInterval]);

  function toggleTheme() { setTheme((t) => t === "dark" ? "light" : "dark"); }

  const activeData = single.data;
  const watchlistCount = userState?.state.watchlist?.length || 0;

  const macroRegime = React.useMemo((): MacroRegime | null => {
    const macroCard = activeData?.evidence_cards?.find((c) => c.id === "macro_context");
    if (!macroCard) return null;
    const summary = macroCard.summary || "";
    const badge: MacroRegime["badge"] =
      /risk.off/i.test(summary) ? "Risk-Off" :
      /crisis/i.test(summary) ? "Crisis" :
      /risk.on/i.test(summary) ? "Risk-On" : "Neutral";
    return { badge, interpretation: macroCard.summary };
  }, [activeData]);

  async function loadSingle(ticker = activeTicker) {
    const normalized = ticker.trim().toUpperCase() || "AVGO";
    setActiveTicker(normalized);
    if (!SAFE_TICKER_PATTERN.test(normalized)) {
      setSingle({ status: "error", data: single.data, message: `Invalid ticker symbol: ${normalized}` });
      return;
    }
    setSingle((current) => ({ status: "loading", data: current.data, message: `Loading ${normalized} from live providers...` }));
    const data = await apiGet<UtaTickerResult>(`/api/uta/single?ticker=${encodeURIComponent(normalized)}&source=${LIVE_SOURCE_MODE}`);
    setSingle({ status: "ready", data });
    const nextHistory = await apiGet<HistoryResult>(`/api/uta/history?ticker=${encodeURIComponent(normalized)}&limit=20`);
    setHistory(nextHistory);
  }

  React.useEffect(() => {
    if (autoRefreshInterval === 0 || mode !== "single") return;
    const ms = autoRefreshInterval * 60 * 1000;
    const id = setInterval(() => {
      loadSingle(activeTicker).catch((err) =>
        setSingle((prev) => ({ status: "error", data: prev.data, message: err.message }))
      );
    }, ms);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefreshInterval, activeTicker, mode]);

  async function loadRuntime() {
    setRuntime((current) => ({ status: "loading", data: current.data, message: "Refreshing runtime..." }));
    setProviders((current) => ({ status: "loading", data: current.data, message: "Refreshing providers..." }));
    const [runtimeData, providerData, schedulerData, historyData, stateData] = await Promise.all([
      apiGet<RuntimeStatus>("/api/uta/runtime"),
      apiGet<ProviderStatus>("/api/uta/providers"),
      apiGet<SchedulerResult>("/api/uta/scheduler"),
      apiGet<HistoryResult>("/api/uta/history?limit=20"),
      apiGet<UserStateResult>("/api/uta/user-state")
    ]);
    setRuntime({ status: "ready", data: runtimeData });
    setProviders({ status: "ready", data: providerData });
    setScheduler({ status: "ready", data: schedulerData });
    setHistory(historyData);
    setUserState(stateData);
  }

  async function runPortfolio(tickers = DEFAULT_PORTFOLIO) {
    setPortfolio((current) => ({ status: "loading", data: current.data, message: "Ranking portfolio from live providers..." }));
    const data = await apiPost<PortfolioResult>("/api/uta/portfolio", { tickers, source: LIVE_SOURCE_MODE });
    setPortfolio({ status: "ready", data });
    await loadRuntime();
  }

  async function runScan(direction = "bullish", tickers = DEFAULT_PORTFOLIO) {
    setScan((current) => ({ status: "loading", data: current.data, message: "Running live pass 1..." }));
    const params = new URLSearchParams({
      universe: "sp500",
      direction,
      pass: "1",
      source: LIVE_SOURCE_MODE,
      tickers: tickers.join(",")
    });
    const data = await apiGet<ScanResult>(`/api/uta/scan?${params.toString()}`);
    setScan({ status: "ready", data });
    setPass2({ status: "idle" });
    await loadRuntime();
  }

  async function runPass2() {
    const shortlist = (scan.data?.results || []).map((row) => row.ticker);
    setPass2((current) => ({ status: "loading", data: current.data, message: "Resolving live pass 2..." }));
    const data = await apiPost<ScanResult>("/api/uta/scan/pass2", {
      shortlist: shortlist.length ? shortlist : ["AVGO"],
      source: LIVE_SOURCE_MODE,
      direction: scan.data?.direction_filter || "bullish"
    });
    setPass2({ status: "ready", data });
    await loadRuntime();
  }

  async function refreshLane(lane: LaneState) {
    await apiPost(`/api/uta/lanes/${encodeURIComponent(lane.lane_id)}/refresh`, {});
    await loadSingle(activeTicker);
  }

  async function revalidateActive() {
    setSingle((current) => ({ status: "loading", data: current.data, message: `Revalidating ${activeTicker} from live providers...` }));
    const data = await apiPost<UtaTickerResult>("/api/uta/revalidate", { ticker: activeTicker, source: LIVE_SOURCE_MODE });
    setSingle({ status: "ready", data });
    await loadRuntime();
  }

  async function toggleWatchlist() {
    const current = userState?.state.watchlist || [];
    const next = current.includes(activeTicker) ? current.filter((ticker) => ticker !== activeTicker) : [...current, activeTicker];
    const updated = await apiPost<UserStateResult>("/api/uta/user-state/watchlist", { watchlist: next });
    setUserState(updated);
  }

  async function updateRules(rules: UtaRule[]) {
    const updated = await apiPost<UserStateResult>("/api/uta/user-state/rules", { rules });
    setUserState(updated);
  }

  async function markActiveReviewed() {
    const reviewed = {
      ...(userState?.state.reviewed || {}),
      [activeTicker]: { ticker: activeTicker, reviewed_at: new Date().toISOString() }
    };
    const updated = await apiPost<UserStateResult>("/api/uta/user-state/reviewed", { reviewed });
    setUserState(updated);
  }

  async function markActiveIgnored() {
    const ignored = {
      ...(userState?.state.ignored || {}),
      [activeTicker]: { ticker: activeTicker, ignored_at: new Date().toISOString() }
    };
    const updated = await apiPost<UserStateResult>("/api/uta/user-state/ignored", { ignored });
    setUserState(updated);
  }

  async function toggleScheduler(enabled: boolean) {
    setScheduler((current) => ({ status: "loading", data: current.data, message: "Updating scheduler..." }));
    const updated = await apiPost<SchedulerResult>("/api/uta/scheduler", { enabled });
    setScheduler({ status: "ready", data: updated });
    await loadRuntime();
  }

  useEffect(() => {
    loadSingle("AVGO").catch((error) => setSingle({ status: "error", message: error.message }));
    loadRuntime().catch((error) => setRuntime({ status: "error", message: error.message }));
    runPortfolio(DEFAULT_PORTFOLIO).catch((error) => setPortfolio({ status: "error", message: error.message }));
  }, []);

  const modeBody = useMemo(() => {
    if (mode === "home") {
      return (
        <HomeMode
          onMode={(m) => setMode(m)}
          lastCycleAt={history?.rows?.[0]?.generated_at}
          universeCount={runtime.data?.signal_result_count}
          regimeBadge={undefined}
        />
      );
    }
    if (mode === "portfolio") {
      return (
        <PortfolioMode
          portfolio={portfolio}
          onRun={(tickers) => runPortfolio(tickers).catch((error) => setPortfolio({ status: "error", data: portfolio.data, message: error.message }))}
          onInspect={(result) => {
            setSingle({ status: "ready", data: result });
            setActiveTicker(result.ticker);
            setMode("single");
          }}
          userState={userState}
        />
      );
    }
    if (mode === "scan") {
      return (
        <ScanMode
          scan={scan}
          pass2={pass2}
          onPass1={(direction, tickers) => runScan(direction, tickers).catch((error) => setScan({ status: "error", data: scan.data, message: error.message }))}
          onPass2={() => runPass2().catch((error) => setPass2({ status: "error", message: error.message }))}
          onInspect={(result) => {
            setSingle({ status: "ready", data: result });
            setActiveTicker(result.ticker);
            setMode("single");
          }}
          savedScans={userState?.state.saved_scans || []}
        />
      );
    }
    if (mode === "alerts") {
      return (
        <AlertsMode
          userState={userState}
          history={history}
          activeData={single.data}
          onRulesChange={(rules) => updateRules(rules).catch((error) => setRuntime({ status: "error", data: runtime.data, message: error.message }))}
          onReviewed={() => markActiveReviewed().catch((error) => setRuntime({ status: "error", data: runtime.data, message: error.message }))}
          onIgnored={() => markActiveIgnored().catch((error) => setRuntime({ status: "error", data: runtime.data, message: error.message }))}
        />
      );
    }
    if (mode === "runtime") {
      return (
        <RuntimeMode
          runtime={runtime}
          providers={providers}
          scheduler={scheduler}
          history={history}
          stream={stream}
          onSchedulerToggle={(enabled) => toggleScheduler(enabled).catch((error) => setScheduler({ status: "error", message: error.message }))}
          onRefreshRuntime={() => loadRuntime().catch((error) => setRuntime({ status: "error", message: error.message }))}
        />
      );
    }
    return (
      <SingleMode
        data={single}
        history={history}
        isWatchlisted={userState?.state.watchlist?.includes(activeTicker) || false}
        onAnalyze={(ticker) => loadSingle(ticker).catch((error) => setSingle({ status: "error", data: single.data, message: error.message }))}
        onRefreshLane={(lane) => refreshLane(lane).catch((error) => setSingle({ status: "error", data: single.data, message: error.message }))}
        onRevalidate={() => revalidateActive().catch((error) => setSingle({ status: "error", data: single.data, message: error.message }))}
        onToggleWatchlist={() => toggleWatchlist().catch((error) => setRuntime({ status: "error", data: runtime.data, message: error.message }))}
      />
    );
  }, [
    mode,
    single,
    portfolio,
    scan,
    pass2,
    runtime,
    providers,
    scheduler,
    history,
    stream,
    activeTicker,
    userState
  ]);

  return (
    <main className="uta-shell">
      <TopBar
        mode={mode}
        onMode={(m) => setMode(m)}
        onHome={() => setMode("home")}
        onSearch={(sym) => {
          setMode("single");
          loadSingle(sym).catch((err) => setSingle({ status: "error", data: single.data, message: err.message }));
        }}
        onOpenWatchlist={() => setShowWatchlist(true)}
        onOpenRuntime={() => setShowRuntime(true)}
        watchlistCount={watchlistCount}
        alertCount={0}
        syncState="live"
        syncTime={single.data ? fmtDate(single.data.generated_at).split(",")[1]?.trim() : undefined}
        themeToggle={toggleTheme}
        densityControl={() => setShowDensityPop((v) => !v)}
      />
      {showDensityPop && (
        <div className="density-pop">
          {(["compact", "regular", "comfy"] as const).map((d) => (
            <button key={d} type="button" className={`secondary ${density === d ? "active" : ""}`}
              onClick={() => { setDensity(d); setShowDensityPop(false); }}>
              {d.charAt(0).toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>
      )}
      <RevalidationBar active={single.status === "loading" || portfolio.status === "loading"} />
      {mode !== "home" && <RegimeBanner regime={macroRegime} />}
      {showWatchlist && (
        <WatchlistDrawer
          watchlist={userState?.state.watchlist || []}
          results={portfolio.data?.results || (single.data ? [single.data] : [])}
          onClose={() => setShowWatchlist(false)}
          onNavigate={(sym) => {
            setMode("single");
            loadSingle(sym).catch((err) => setSingle({ status: "error", data: single.data, message: err.message }));
          }}
          onRemove={(sym) => {
            const next = (userState?.state.watchlist || []).filter((t) => t !== sym);
            apiPost<UserStateResult>("/api/uta/user-state/watchlist", { watchlist: next })
              .then(setUserState)
              .catch(console.error);
          }}
        />
      )}
      {showRuntime && (
        <div className="runtime-overlay">
          <div className="runtime-overlay-head">
            <span>Operator — Runtime</span>
            <button type="button" className="x-close icon-button secondary" onClick={() => setShowRuntime(false)}>✕</button>
          </div>
          <div className="runtime-overlay-body">
            <RuntimeMode
              runtime={runtime}
              providers={providers}
              scheduler={scheduler}
              history={history}
              stream={stream}
              onSchedulerToggle={(enabled) => toggleScheduler(enabled).catch((err) => setScheduler({ status: "error", message: err.message }))}
              onRefreshRuntime={() => loadRuntime().catch((err) => setRuntime({ status: "error", message: err.message }))}
            />
          </div>
        </div>
      )}
      {activeData && mode !== "single" ? (
        <section className="context-strip">
          <span>{activeData.ticker} / Tier {activeData.tier} / {activeData.direction}</span>
          <span>Direction source: {activeData.calculation_metadata.direction_source}</span>
        </section>
      ) : null}
      {modeBody}
    </main>
  );
}
