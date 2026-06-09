import http from "node:http";
import https from "node:https";

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : fallback;
}

function normalizeBaseUrl(value) {
  return String(value || "http://127.0.0.1:3000").replace(/\/+$/, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function numberArg(name, fallback) {
  const value = Number(argValue(name, fallback));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function requestText(url, { timeoutMs = 8000, stream = false } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    const request = client.request(parsed, { method: "GET", timeout: timeoutMs }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
        if (stream && body.length > 80) {
          request.destroy();
          resolve({ status: response.statusCode, headers: response.headers, body });
        }
      });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    request.on("timeout", () => {
      request.destroy(new Error(`Timed out after ${timeoutMs}ms: ${url}`));
    });
    request.on("error", (error) => {
      if (stream && /socket hang up|aborted/i.test(error.message) && error.code !== "ECONNREFUSED") {
        return;
      }
      reject(error);
    });
    request.end();
  });
}

async function jsonGet(baseUrl, path) {
  const response = await requestText(`${baseUrl}${path}`);
  assert(response.status >= 200 && response.status < 300, `${path} returned non-2xx status.`, response);
  return JSON.parse(response.body);
}

async function waitForHealth(baseUrl, { timeoutMs, intervalMs }) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const health = await jsonGet(baseUrl, "/api/health");
      if (health.status === "green") {
        return health;
      }
      lastError = new Error(`Health status is ${health.status}`);
      lastError.details = health;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  const error = new Error(`Health endpoint did not become green within ${timeoutMs}ms.`);
  error.details = { base_url: baseUrl, last_error: lastError?.message, last_details: lastError?.details || {} };
  throw error;
}

try {
  const baseUrl = normalizeBaseUrl(argValue("--base-url", process.env.UTA_BASE_URL || "http://127.0.0.1:3000"));
  const waitMs = numberArg("--wait-ms", Number(process.env.UTA_DEPLOY_SMOKE_WAIT_MS || 90000));
  const intervalMs = numberArg("--interval-ms", Number(process.env.UTA_DEPLOY_SMOKE_INTERVAL_MS || 2500));
  const health = await waitForHealth(baseUrl, { timeoutMs: waitMs, intervalMs });
  const runtime = await jsonGet(baseUrl, "/api/uta/runtime");
  const single = await jsonGet(baseUrl, "/api/uta/single?ticker=AVGO");
  const html = await requestText(`${baseUrl}/uta`);
  const stream = await requestText(`${baseUrl}/api/uta/stream`, { timeoutMs: 4000, stream: true });

  assert(health.status === "green", "Health endpoint is not green.", health);
  assert(runtime.schema_version === "uta.runtime_status.v1", "UTA runtime schema mismatch.", runtime);
  assert(runtime.mode === "replay_first", "UTA runtime should remain replay_first until live providers are configured.", runtime);
  assert(runtime.scheduler?.mode === "manual", "UTA scheduler should default to manual mode.", runtime.scheduler);
  assert(runtime.lane_pressure?.required_not_ready === 0, "Required UTA lanes are not ready.", runtime.lane_pressure);
  assert(single.schema_version === "uta.ticker_result.v1", "UTA single payload schema mismatch.", single);
  assert(single.ticker === "AVGO" && single.tier === "A", "UTA single replay fixture did not return AVGO Tier A.", single);
  assert(single.calculation_metadata?.direction_source === "signed_flow", "UTA single must disclose signed-flow direction.", single);
  assert(html.status === 200 && html.body.includes("Unusual Trading Activity Agent"), "/uta HTML did not render expected shell.", html);
  assert(stream.status === 200 && /uta connected|uta_snapshot/.test(stream.body), "UTA SSE stream did not send an initial frame.", stream);

  console.log(JSON.stringify({
    status: "ok",
    base_url: baseUrl,
    wait_ms: waitMs,
    health: health.status,
    uta_mode: runtime.mode,
    scheduler_mode: runtime.scheduler.mode,
    required_lanes_not_ready: runtime.lane_pressure.required_not_ready,
    single_ticker: single.ticker,
    single_tier: single.tier,
    sse_initial_frame: /uta connected|uta_snapshot/.test(stream.body)
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "error", error: error.message, details: error.details || {} }, null, 2));
  process.exitCode = 1;
}
