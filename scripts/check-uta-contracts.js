import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../src/config.js";

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(config.rootDir, relativePath), "utf8"));
}

function sha(relativePath) {
  return createHash("sha256").update(readFileSync(path.join(config.rootDir, relativePath))).digest("hex");
}

try {
  const requiredFiles = [
    "ux design/README.md",
    "docs/uta-stack-runtime-policy.md",
    "docs/uta-provider-adapter-matrix.md",
    "docs/uta-validation-calibration.md",
    "docs/uta-pi-deployment.md",
    "deploy/flow-momentum-uta.service",
    "deploy/cloudflared-uta-example.yml",
    "config/condition_code_policy_v1.json",
    "config/condition_code_policy.schema.json",
    "config/uta_lane_registry.json",
    "config/uta_lane_state.schema.json",
    "schemas/uta-ticker-result.schema.json",
    "schemas/uta-scan-result.schema.json",
    "schemas/uta-user-state.schema.json",
    "schemas/uta-raw-prints.schema.json",
    "schemas/uta-sse-event.schema.json",
    "schemas/uta-error.schema.json",
    "schemas/uta-provider-status.schema.json",
    "schemas/uta-provider-preflight.schema.json",
    "sql/uta-schema.sql",
    "data/uta/replay/avgo-single.json",
    "data/uta/replay/historical-evaluation.json",
    "data/uta/universes/sample-sp500.json",
    "src/domain/uta-validation.js",
    "vite.uta.config.js",
    "src/uta/index.html",
    "src/uta/src/main.tsx",
    "src/uta/src/styles.css",
    "src/public/uta/index.html",
    "scripts/check-uta-historical-replay.js",
    "scripts/check-uta-calibration.js",
    "scripts/check-uta-trading-integration.js",
    "scripts/check-uta-provider-preflight.js",
    "scripts/check-uta-deploy-smoke.js",
    "scripts/deploy-uta-pi.ps1"
  ];

  const missing = requiredFiles.filter((file) => !existsSync(path.join(config.rootDir, file)));
  assert(missing.length === 0, "Missing UTA contract files.", { missing });

  const policy = readJson("config/condition_code_policy_v1.json");
  const codeBuckets = ["hard_exclude", "session_bucket", "flag_only", "separate_analysis"];
  const codes = codeBuckets.flatMap((bucket) => (policy[bucket] || []).map((row) => `${row.code}`));
  assert(new Set(codes).size === codes.length, "Condition-code policy has duplicate codes.", { codes });
  assert(policy.version === "v1", "Condition-code policy version must be v1.", { version: policy.version });

  const lanes = readJson("config/uta_lane_registry.json").lanes;
  assert(lanes.length >= 8, "Lane registry is incomplete.", { lane_count: lanes.length });
  assert(lanes.every((lane) => lane.lane_id && lane.label && lane.refresh_route), "Lane registry has incomplete rows.");

  const fixture = readJson("data/uta/replay/avgo-single.json");
  const registeredLaneIds = new Set(lanes.map((lane) => lane.lane_id));
  const unknownFixtureLanes = fixture.lane_states.filter((lane) => !registeredLaneIds.has(lane.lane_id));
  assert(unknownFixtureLanes.length === 0, "Replay fixture references unknown lanes.", { unknownFixtureLanes });
  assert(fixture.indicators?.A === null, "Single ticker replay fixture must have A=null.");
  assert(!Object.hasOwn(fixture, "composite_score"), "UTA payload must not expose a composite score.");
  assert(fixture.engine_inputs?.replay_clock, "Replay fixture must include deterministic engine clock.");
  assert((fixture.engine_inputs?.historical_sessions || []).length >= 20, "Replay fixture must include baseline sessions.");
  assert((fixture.engine_inputs?.prints || []).length >= 5, "Replay fixture must include raw print inputs.");
  assert(
    fixture.engine_inputs.prints.some((print) => (print.condition_codes || []).includes("W")),
    "Replay fixture must include a hard-excluded condition-code print."
  );
  assert(
    fixture.lane_states.some((lane) => lane.lane_id === "universe_constituents" && lane.state === "ready"),
    "Replay fixture must include ready universe constituents lane."
  );
  const historicalFixture = readJson("data/uta/replay/historical-evaluation.json");
  assert(historicalFixture.schema_version === "uta.historical_replay_fixture.v1", "Historical replay fixture schema version mismatch.");
  assert((historicalFixture.rows || []).length >= 8, "Historical replay fixture should cover enough validation rows.");
  assert(!JSON.stringify(historicalFixture).includes("composite_score"), "Historical replay fixture must not introduce composite scores.");

  const builtUtaIndex = readFileSync(path.join(config.rootDir, "src", "public", "uta", "index.html"), "utf8");
  const utaSource = readFileSync(path.join(config.rootDir, "src", "uta", "src", "main.tsx"), "utf8");
  assert(!/unpkg|babel\.standalone|react\.development/i.test(builtUtaIndex), "Built UTA page must not use CDN React or Babel.");
  assert(/from "react"/.test(utaSource), "UTA source must be the React/Vite source tree.");

  const rootUploadPairs = [
    ["unusual-trading-activity-agent-v2-product-design.md", "ux design/uploads/unusual-trading-activity-agent-v2-product-design.md"],
    ["unusual-trading-activity-agent-expert-review.md", "ux design/uploads/unusual-trading-activity-agent-expert-review.md"],
    ["implementation-plan-tickets.md", "ux design/uploads/implementation-plan-tickets.md"]
  ];
  const hashMismatches = rootUploadPairs
    .map(([root, upload]) => ({ root, upload, rootHash: sha(root), uploadHash: sha(upload) }))
    .filter((row) => row.rootHash !== row.uploadHash);
  assert(hashMismatches.length === 0, "Root UTA docs and ux design/uploads mirrors differ.", { hashMismatches });

  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(path.join(config.rootDir, "sql", "uta-schema.sql"), "utf8"));
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'uta_%'").all();
  db.close();
  assert(tables.length >= 11, "UTA SQLite schema did not create expected tables.", { tables });

  console.log(JSON.stringify({
    status: "ok",
    required_files: requiredFiles.length,
    condition_codes: codes.length,
    lanes: lanes.length,
    uta_tables: tables.length,
    mirrored_docs_verified: rootUploadPairs.length
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "error", error: error.message, details: error.details || {} }, null, 2));
  process.exitCode = 1;
}
