import { createServer } from "node:http";
import { createSentimentApp } from "../src/app.js";
import { routeRequest } from "../src/http/router.js";

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

async function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function readJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { accept: "application/json", ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json();
  return { response, payload };
}

async function readStreamPrelude(baseUrl, path) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { accept: "text/event-stream" },
    signal: controller.signal
  });
  const reader = response.body.getReader();
  const { value } = await reader.read();
  controller.abort();
  return {
    response,
    text: new TextDecoder().decode(value || new Uint8Array())
  };
}

const app = createSentimentApp();
const server = createServer((request, response) => {
  routeRequest(app, request, response).catch((error) => {
    response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error.message }));
  });
});

try {
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;

  const single = await readJson(baseUrl, "/api/uta/single?ticker=AVGO");
  assert(single.response.status === 200, "Single ticker API should return 200.");
  assert(single.payload.ticker === "AVGO", "Single ticker API returned wrong ticker.");
  assert(single.payload.indicators.A === null, "Single ticker API must return A=null.");
  assert(single.payload.calculation_metadata.engine_version === "uta_engine_v1", "Single ticker API should return engine-backed replay.");
  assert(single.payload.raw_prints?.normalization_summary?.eligible_notional === 880000000, "Single ticker API should expose normalization diagnostics.");
  assert(single.payload.runtime_cycle?.status === "completed", "Single ticker API should run a runtime cycle.");

  const missing = await readJson(baseUrl, "/api/uta/single?ticker=ZZZZ");
  assert(missing.response.status === 404, "Missing replay ticker should return 404.");
  assert(missing.payload.tier === "D", "Missing replay ticker should be non-actionable Tier D.");

  const universes = await readJson(baseUrl, "/api/uta/universes");
  assert(universes.payload.universes.length >= 1, "Universes API returned no universes.");

  const lanes = await readJson(baseUrl, "/api/uta/lane-states");
  assert(lanes.payload.lanes.length >= 8, "Lane-state API returned too few lanes.");

  const portfolio = await readJson(baseUrl, "/api/uta/portfolio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tickers: ["AVGO"] })
  });
  assert(portfolio.payload.results.length === 1, "Portfolio API should return one row.");
  assert(portfolio.payload.runtime_cycle?.status === "completed", "Portfolio API should run a runtime cycle.");

  const scan = await readJson(baseUrl, "/api/uta/scan?universe=sp500&direction=bullish&pass=1");
  assert(scan.payload.results[0].pass2_status === "pending", "Scan pass 1 should be pending.");
  assert(scan.payload.runtime_cycle?.mode === "scan_pass1", "Scan pass 1 should expose runtime cycle metadata.");

  const refresh = await readJson(baseUrl, "/api/uta/lanes/massive_live_trade_slices/refresh", { method: "POST" });
  assert(refresh.payload.ok === true, "Lane refresh should return ok.");

  const pass2 = await readJson(baseUrl, "/api/uta/scan/pass2", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shortlist: ["AVGO"] })
  });
  assert(pass2.payload.results[0].status === "resolved", "Scan pass 2 should resolve rows.");

  const historyBefore = await readJson(baseUrl, "/api/uta/history?ticker=AVGO");
  assert(historyBefore.payload.rows.length >= 2, "UTA history should include runtime signal rows.");

  const userState = await readJson(baseUrl, "/api/uta/user-state/watchlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ watchlist: ["AVGO"], reviewed: { AVGO: true } })
  });
  assert(userState.payload.state.watchlist.includes("AVGO"), "User state update did not persist in runtime state.");
  const historyAfter = await readJson(baseUrl, "/api/uta/history?ticker=AVGO");
  assert(
    historyAfter.payload.rows.length === historyBefore.payload.rows.length,
    "User state update must not mutate historical signal results."
  );

  const runtime = await readJson(baseUrl, "/api/uta/runtime");
  assert(runtime.payload.signal_result_count >= historyAfter.payload.rows.length, "Runtime status should expose signal count.");
  assert(runtime.payload.pi_policy?.auto_start_heavy_jobs === false, "UTA Pi policy should block heavy auto-start.");
  assert(runtime.payload.provider_status?.schema_version === "uta.provider_status.v1", "Runtime should embed provider status.");

  const providers = await readJson(baseUrl, "/api/uta/providers");
  assert(providers.response.status === 200, "Provider status API should return 200.");
  assert(providers.payload.schema_version === "uta.provider_status.v1", "Provider status API schema mismatch.");
  assert(providers.payload.replay_available === true, "Provider status should keep replay fixture visible.");
  assert(providers.payload.summary.auto_start_allowed === 0, "Provider status must not enable heavy auto-start.");
  assert(
    providers.payload.provider_lanes.some((lane) => lane.lane_id === "massive_live_trade_slices" && lane.required),
    "Provider status should include required trade-print lane."
  );

  const preflight = await readJson(baseUrl, "/api/uta/providers/preflight", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker: "AVGO" })
  });
  assert(preflight.response.status === 200, "Provider preflight API should return 200.");
  assert(preflight.payload.schema_version === "uta.provider_preflight.v1", "Provider preflight schema mismatch.");
  assert(preflight.payload.summary.trading_effect === "none", "Provider preflight must not affect trading.");
  assert(preflight.payload.mutation_guard.historical_signal_results_preserved, "Provider preflight must preserve signal history.");

  const scheduler = await readJson(baseUrl, "/api/uta/scheduler", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true })
  });
  assert(scheduler.payload.scheduler.mode === "dry_run", "UTA scheduler should stay dry-run when enabled locally.");

  const revalidate = await readJson(baseUrl, "/api/uta/revalidate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker: "AVGO" })
  });
  assert(revalidate.payload.runtime_cycle?.status === "completed", "UTA revalidation should run a cycle.");

  const runtimeAction = await readJson(baseUrl, "/api/runtime-reliability/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "poll_once", source: "uta", mode: "single", ticker: "AVGO" })
  });
  assert(runtimeAction.payload.ok === true, "Runtime reliability UTA action should return ok.");
  assert(runtimeAction.payload.result?.cycle?.status === "completed", "Runtime reliability UTA action should run a cycle.");
  assert(
    runtimeAction.payload.runtime_reliability?.sources?.some((source) => source.key === "uta"),
    "Runtime reliability should report UTA as a source."
  );

  const stream = await readStreamPrelude(baseUrl, "/api/uta/stream");
  assert(stream.response.status === 200, "UTA SSE stream should connect.");
  assert(stream.text.includes("uta connected") || stream.text.includes("uta_snapshot"), "UTA SSE stream should send an initial frame.");

  console.log(JSON.stringify({
    status: "ok",
    base_url: baseUrl,
    checked_endpoints: 17,
    history_rows: historyAfter.payload.rows.length,
    runtime_signal_results: runtime.payload.signal_result_count
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "error", error: error.message, details: error.details || {} }, null, 2));
  process.exitCode = 1;
} finally {
  await close(server);
  await app.stopLiveSources?.();
}
