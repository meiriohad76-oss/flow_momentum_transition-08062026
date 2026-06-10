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
  const historyBefore = await readJson(baseUrl, "/api/uta/history?limit=250");
  const schedulerBefore = await readJson(baseUrl, "/api/uta/scheduler");
  const preflight = await readJson(baseUrl, "/api/uta/providers/preflight", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker: "AVGO" })
  });
  const liveProbeNoKeys = await readJson(baseUrl, "/api/uta/providers/preflight", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker: "AVGO", probe_live: true })
  });
  const historyAfter = await readJson(baseUrl, "/api/uta/history?limit=250");
  const schedulerAfter = await readJson(baseUrl, "/api/uta/scheduler");

  assert(preflight.response.status === 200, "Provider preflight endpoint should return 200.");
  assert(preflight.payload.schema_version === "uta.provider_preflight.v1", "Provider preflight schema mismatch.");
  assert(preflight.payload.mode === "manual_preflight", "Preflight must be manual.");
  assert(preflight.payload.probe_live === false, "Default preflight must not run live probes.");
  assert(preflight.payload.summary.trading_effect === "none", "Preflight must have no trading effect.");
  assert(preflight.payload.summary.sample_attempts === 0, "Default preflight must not call external samples.");
  assert(liveProbeNoKeys.payload.probe_live === true, "Explicit preflight probe flag should be reflected.");
  assert(liveProbeNoKeys.payload.live_probe_status === "manual_probe_completed", "Live probe request should complete safely.");
  assert(liveProbeNoKeys.payload.summary.sample_attempts === 0, "Live probe without Massive credentials should not call external samples.");
  assert(preflight.payload.summary.required_missing >= 1, "Default config should show missing required live providers.");
  assert(preflight.payload.checks.some((check) => check.state === "missing_key"), "Preflight should expose missing provider state.");
  assert(preflight.payload.checks.some((check) => check.state === "configured"), "Preflight should expose configured provider state.");
  assert(
    preflight.payload.checks.every((check) => check.trading_effect === "none" && check.mutation_allowed === false),
    "Every preflight check must be read-only with no trading effect.",
    preflight.payload.checks
  );
  assert(
    preflight.payload.mutation_guard.historical_signal_results_preserved &&
      preflight.payload.mutation_guard.replay_runs_preserved &&
      preflight.payload.mutation_guard.lane_states_preserved &&
      preflight.payload.mutation_guard.audit_log_preserved &&
      preflight.payload.mutation_guard.scheduler_mode_preserved,
    "Preflight mutation guard failed.",
    preflight.payload.mutation_guard
  );
  assert(
    historyBefore.payload.rows.length === historyAfter.payload.rows.length,
    "Provider preflight must not mutate UTA signal history.",
    { before: historyBefore.payload.rows.length, after: historyAfter.payload.rows.length }
  );
  assert(
    schedulerBefore.payload.scheduler.mode === schedulerAfter.payload.scheduler.mode,
    "Provider preflight must not mutate scheduler mode.",
    { before: schedulerBefore.payload.scheduler.mode, after: schedulerAfter.payload.scheduler.mode }
  );

  console.log(JSON.stringify({
    status: "ok",
    base_url: baseUrl,
    checks: preflight.payload.checks.length,
    by_state: preflight.payload.summary.by_state,
    required_missing: preflight.payload.summary.required_missing,
    live_probe_without_keys_sample_attempts: liveProbeNoKeys.payload.summary.sample_attempts,
    trading_effect: preflight.payload.summary.trading_effect,
    mutation_guard: {
      historical_signal_results_preserved: preflight.payload.mutation_guard.historical_signal_results_preserved,
      scheduler_mode_preserved: preflight.payload.mutation_guard.scheduler_mode_preserved
    }
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "error", error: error.message, details: error.details || {} }, null, 2));
  process.exitCode = 1;
} finally {
  await close(server);
  await app.stopLiveSources?.();
}
