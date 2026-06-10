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

  const single = await readJson(baseUrl, "/api/uta/single?ticker=MSFT");
  assert([200, 409, 502].includes(single.response.status), "Single ticker API should return a live result or explicit live unavailable state.", { status: single.response.status, payload: single.payload });
  assert(single.payload.ticker === "MSFT", "Single ticker API returned wrong ticker.");
  if (single.response.status === 200) {
    assert(single.payload.data_state === "live_manual", "Single ticker API must use live provider data.");
    assert(single.payload.indicators.A === null, "Single ticker API must return A=null.");
    assert(single.payload.runtime_cycle?.status === "completed", "Single ticker API should run a runtime cycle.");
    assert(single.payload.calculation_metadata?.source_mode === "live_manual", "Single ticker API should disclose live source mode.");
  } else {
    assert(single.payload.error === "live_uta_unavailable", "Single ticker API must fail explicitly when live providers are unavailable.");
    assert(single.payload.data_state === "live_unavailable", "Single ticker API must not fall back to replay data.");
  }

  const replayRejected = await readJson(baseUrl, "/api/uta/single?ticker=AVGO&source=replay");
  assert(replayRejected.response.status === 400, "Explicit UTA replay requests should be rejected.");
  assert(replayRejected.payload.error === "uta_replay_disabled", "Replay rejection should use uta_replay_disabled.");

  const universes = await readJson(baseUrl, "/api/uta/universes");
  assert(universes.payload.universes.length >= 1, "Universes API returned no universes.");

  const lanes = await readJson(baseUrl, "/api/uta/lane-states");
  assert(lanes.payload.lanes.length >= 8, "Lane-state API returned too few lanes.");

  const portfolio = await readJson(baseUrl, "/api/uta/portfolio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tickers: ["MSFT"], source: "live" })
  });
  assert(portfolio.payload.results.length === 1, "Portfolio API should return one row.");
  assert(portfolio.payload.runtime_cycle?.status === "completed", "Portfolio API should run a runtime cycle.");
  assert(
    portfolio.payload.results.every((row) => ["live_manual", "live_unavailable"].includes(row.data_state)),
    "Portfolio API must use live rows only.",
    portfolio.payload.results
  );

  const scan = await readJson(baseUrl, "/api/uta/scan?source=live&tickers=MSFT,NVDA&direction=bullish&pass=1");
  assert(["pending", "blocked"].includes(scan.payload.results[0].pass2_status), "Scan pass 1 should be pending or explicitly blocked by live provider state.");
  assert(scan.payload.runtime_cycle?.mode === "scan_pass1", "Scan pass 1 should expose runtime cycle metadata.");

  const explicitLive = await readJson(baseUrl, "/api/uta/single?ticker=MSFT&source=live");
  assert([200, 409, 502].includes(explicitLive.response.status), "Explicit live UTA should return live data or explicit unavailable state.");
  assert(explicitLive.payload.ticker === "MSFT", "Explicit live UTA should preserve the requested ticker.");
  assert(explicitLive.payload.data_state !== "replay", "Explicit live UTA must not return replay data.");

  const livePortfolioWithoutCredentials = await readJson(baseUrl, "/api/uta/portfolio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tickers: ["MSFT", "NVDA"], source: "live" })
  });
  assert(livePortfolioWithoutCredentials.payload.data_state === "live_manual", "Live portfolio should expose live_manual state.");
  assert(
    livePortfolioWithoutCredentials.payload.results.every((row) => ["live_manual", "live_unavailable"].includes(row.data_state) && row.ticker),
    "Live portfolio must return live or explicit unavailable rows, not replay fixtures.",
    livePortfolioWithoutCredentials.payload.results
  );

  const liveScanWithoutCredentials = await readJson(baseUrl, "/api/uta/scan?source=live&tickers=MSFT,NVDA&direction=bullish&pass=1");
  assert(liveScanWithoutCredentials.payload.data_state === "live_manual", "Live scan should expose live_manual state.");
  assert(
    liveScanWithoutCredentials.payload.results.every((row) => row.data_state !== "replay" && ["pending", "blocked"].includes(row.pass2_status)),
    "Live scan must return live or explicit unavailable rows, not replay fixtures.",
    liveScanWithoutCredentials.payload.results
  );

  const refresh = await readJson(baseUrl, "/api/uta/lanes/massive_live_trade_slices/refresh", { method: "POST" });
  assert(refresh.payload.ok === true, "Lane refresh should return ok.");

  const pass2 = await readJson(baseUrl, "/api/uta/scan/pass2", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shortlist: ["MSFT"], source: "live" })
  });
  assert(["resolved", "blocked"].includes(pass2.payload.results[0].status), "Scan pass 2 should resolve or explicitly block live rows.");

  const historyBefore = await readJson(baseUrl, "/api/uta/history?ticker=MSFT");
  assert(historyBefore.payload.rows.length >= 0, "UTA history should return rows array.");

  const userState = await readJson(baseUrl, "/api/uta/user-state/watchlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ watchlist: ["MSFT"], reviewed: { MSFT: true } })
  });
  assert(userState.payload.state.watchlist.includes("MSFT"), "User state update did not persist in runtime state.");
  const historyAfter = await readJson(baseUrl, "/api/uta/history?ticker=MSFT");
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
  assert(providers.payload.mode === "live_only", "Provider status should be live_only.");
  assert(!Object.hasOwn(providers.payload, "replay_available"), "Provider status must not expose replay availability.");
  assert(providers.payload.summary.auto_start_allowed === 0, "Provider status must not enable heavy auto-start.");
  assert(
    providers.payload.provider_lanes.some((lane) => lane.lane_id === "massive_live_trade_slices" && lane.required),
    "Provider status should include required trade-print lane."
  );

  const preflight = await readJson(baseUrl, "/api/uta/providers/preflight", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker: "MSFT" })
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
    body: JSON.stringify({ ticker: "MSFT", source: "live" })
  });
  assert(["completed", "failed"].includes(revalidate.payload.runtime_cycle?.status), "UTA revalidation should run a live cycle.");

  const runtimeAction = await readJson(baseUrl, "/api/runtime-reliability/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "poll_once", source: "uta", mode: "single", ticker: "MSFT", source_mode: "live" })
  });
  assert(runtimeAction.payload.ok === true, "Runtime reliability UTA action should return ok.");
  assert(["completed", "failed"].includes(runtimeAction.payload.result?.cycle?.status), "Runtime reliability UTA action should run a live cycle.");
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
