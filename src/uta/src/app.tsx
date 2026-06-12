// src/uta/src/app.tsx
import React, { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, LIVE_SOURCE_MODE, DEFAULT_PORTFOLIO, SAFE_TICKER_PATTERN } from "./utils.js";
import { useSseEvents, SingleMode, PortfolioMode, RuntimeMode } from "./modes.js";
import { ScanMode } from "./scan.js";
import { AlertsMode } from "./alerts.js";
import { Pill } from "./components.js";
import type {
  Mode, UtaTickerResult, PortfolioResult, ScanResult, RuntimeStatus,
  ProviderStatus, HistoryResult, SchedulerResult, UserStateResult, LaneState, LoadState, UtaRule
} from "./types.js";

export function App() {
  const [mode, setMode] = useState<Mode>("single");
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

  const activeData = single.data;
  const watchlistCount = userState?.state.watchlist?.length || 0;

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
        onAnalyze={(ticker) => loadSingle(ticker).catch((error) => setSingle({ status: "error", data: single.data, message: error.message }))}
        onRefreshLane={(lane) => refreshLane(lane).catch((error) => setSingle({ status: "error", data: single.data, message: error.message }))}
        onRevalidate={() => revalidateActive().catch((error) => setSingle({ status: "error", data: single.data, message: error.message }))}
        onWatchlist={() => toggleWatchlist().catch((error) => setRuntime({ status: "error", data: runtime.data, message: error.message }))}
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
      <header className="uta-topbar">
        <div>
          <span className="crumb">
            UTA / {providers.data?.live_ready ? "Massive live ready" : "live provider gated"}
          </span>
          <h1>Unusual Trading Activity Agent</h1>
        </div>
        <div className="topbar-meta">
          <Pill tone={providers.data?.live_ready ? "good" : "warn"}>
            {providers.data?.live_ready ? "Massive ready" : "Massive gated"}
          </Pill>
          <Pill tone={runtime.data?.lane_pressure.required_not_ready ? "warn" : "good"}>
            required lanes {runtime.data?.lane_pressure.required_not_ready ?? 0}
          </Pill>
          <Pill tone="neutral">watchlist {watchlistCount}</Pill>
          <Pill tone={stream.state === "connected" ? "good" : "warn"}>SSE {stream.state}</Pill>
        </div>
      </header>
      <nav className="mode-tabs" aria-label="UTA modes">
        {[
          ["single", "Single"],
          ["portfolio", "Portfolio"],
          ["scan", "Scan"],
          ["alerts", "Alerts"],
          ["runtime", "Runtime"]
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={mode === id ? "active" : ""}
            onClick={() => setMode(id as Mode)}
          >
            {label}
          </button>
        ))}
      </nav>
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
