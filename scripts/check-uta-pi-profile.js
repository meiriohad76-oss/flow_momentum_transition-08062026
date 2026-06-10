import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createSentimentApp } from "../src/app.js";
import { config } from "../src/config.js";

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

try {
  const stackDoc = readFileSync(path.join(config.rootDir, "docs", "uta-stack-runtime-policy.md"), "utf8");
  const piDoc = readFileSync(path.join(config.rootDir, "docs", "uta-pi-deployment.md"), "utf8");
  const systemdUnit = readFileSync(path.join(config.rootDir, "deploy", "flow-momentum-uta.service"), "utf8");
  const tunnelConfig = readFileSync(path.join(config.rootDir, "deploy", "cloudflared-uta-example.yml"), "utf8");
  const gitignore = readFileSync(path.join(config.rootDir, ".gitignore"), "utf8");

  assert(stackDoc.includes("SQLite WAL on SSD"), "UTA stack policy must lock durable SQLite WAL on SSD/NVMe.");
  assert(stackDoc.includes("Lightweight JSON"), "UTA stack policy must preserve lightweight JSON runtime recovery.");
  assert(stackDoc.includes("FastAPI, Streamlit, and Python workers are out of scope for v1"), "Deferred stack policy missing.");
  assert(gitignore.includes("data/*.sqlite"), "SQLite DB files must be ignored.");
  assert(gitignore.includes("data/backups/"), "SQLite backups must be ignored.");
  assert(existsSync(path.join(config.rootDir, "sql", "uta-schema.sql")), "UTA schema file missing.");
  assert(piDoc.includes("SQLite WAL storage must live on SSD/NVMe"), "UTA Pi deployment doc must require SSD/NVMe storage.");
  assert(systemdUnit.includes("WorkingDirectory=/home/ahad/flow_momentum_transition-08062026"), "UTA systemd unit should point at the Pi checkout.");
  assert(systemdUnit.includes("DATABASE_PATH=/mnt/uta-ssd/"), "UTA systemd unit must keep SQLite on SSD/NVMe.");
  assert(systemdUnit.includes("API_SAVER_MODE=true"), "UTA systemd unit must enable API saver mode.");
  assert(systemdUnit.includes("DASHBOARD_MUTATIONS_ENABLED=false"), "UTA systemd unit must disable public dashboard mutations by default.");
  assert(tunnelConfig.includes("service: http://127.0.0.1:3000"), "Cloudflare example must forward to local Node service.");
  assert(config.port === Number(process.env.PORT || 3000), "Config port should remain environment-driven.");

  const app = createSentimentApp();
  const utaRuntime = app.getUtaRuntimeStatus();
  assert(utaRuntime.pi_policy.auto_start_heavy_jobs === false, "UTA Pi policy must keep heavy auto-start disabled.");
  assert(["memory", "sqlite", "postgres", "lightweight_json"].includes(utaRuntime.pi_policy.storage), "UTA storage policy label is invalid.");
  assert(utaRuntime.scheduler.mode === "manual", "UTA runtime scheduler should default to manual mode.");
  const scheduler = app.getUtaScheduler();
  assert(scheduler.scheduler.enabled === false, "UTA scheduler should default to manual disabled mode.");
  assert(scheduler.scheduler.jobs.some((job) => job.id === "nightly_baseline"), "UTA scheduler should declare nightly baseline job.");
  const runtimeReliability = app.getRuntimeReliability();
  assert(runtimeReliability.sources.some((source) => source.key === "uta"), "Runtime reliability must expose UTA source pressure.");
  assert(
    runtimeReliability.available_actions.some((action) => action.action === "poll_once" && action.source === "uta"),
    "Runtime reliability must expose a manual UTA cycle action."
  );

  console.log(JSON.stringify({
    status: "ok",
    pi_performance_mode_current: config.piPerformanceMode,
    api_saver_mode_current: config.apiSaverMode,
    database_provider_current: config.databaseProvider,
    lightweight_state_enabled_current: config.lightweightStateEnabled,
    uta_scheduler_mode: scheduler.scheduler.mode,
    uta_runtime_source_visible: true,
    deployment_artifacts: ["deploy/flow-momentum-uta.service", "deploy/cloudflared-uta-example.yml"],
    note: "This is a local preflight check; real Pi SSD/systemd/Cloudflare checks remain deployment-ticket work."
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "error", error: error.message, details: error.details || {} }, null, 2));
  process.exitCode = 1;
}
