import { readFileSync } from "node:fs";
import path from "node:path";
import {
  analyzeReplayFixture,
  buildBaseline,
  buildLaneStates,
  classifyTier,
  computeAbcIndicators,
  computeSignalComponents,
  createReplayClock,
  createUtaService,
  detectBlockTrf,
  loadUniverseProfiles,
  normalizeTradePrints,
  signTradePrints
} from "../src/domain/uta.js";
import { config } from "../src/config.js";

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

try {
  const service = createUtaService({ config });
  const fixture = JSON.parse(readFileSync(path.join(config.rootDir, "data", "uta", "replay", "avgo-single.json"), "utf8"));
  const policy = JSON.parse(readFileSync(path.join(config.rootDir, "config", "condition_code_policy_v1.json"), "utf8"));
  const registry = JSON.parse(readFileSync(path.join(config.rootDir, "config", "uta_lane_registry.json"), "utf8"));
  const universeFixture = JSON.parse(readFileSync(path.join(config.rootDir, "data", "uta", "universes", "sample-sp500.json"), "utf8"));

  const clock = createReplayClock(fixture.engine_inputs.replay_clock);
  assert(clock.iso() === "2026-06-08T14:35:22.000Z", "Replay clock should be fixed.");

  const profiles = loadUniverseProfiles(universeFixture, [{ ticker: fixture.ticker, ...fixture.profile }]);
  const avgoProfile = profiles.find((profile) => profile.ticker === "AVGO");
  assert(avgoProfile?.pi_performance_tier === "standard", "Profile should carry Pi performance tier.");
  assert(avgoProfile?.notional_floor === 25000000, "Profile should carry block notional floor.");

  const baseline = buildBaseline({
    ticker: "AVGO",
    historicalSessions: fixture.engine_inputs.historical_sessions,
    clock
  });
  assert(baseline.state === "ready", "Baseline should be ready with 20 usable sessions.", baseline);
  assert(baseline.session_count === 20, "Baseline should use exactly 20 non-earnings sessions.", baseline);
  assert(baseline.earnings_excluded_count === 1, "Baseline should exclude earnings sessions.", baseline);
  assert(baseline.no_lookahead_verified === true, "Baseline must prove no-look-ahead filtering.", baseline);
  assert(baseline.metrics.notional.median > 0, "Baseline notional median missing.", baseline.metrics);

  const normalized = normalizeTradePrints(fixture.engine_inputs.prints, policy);
  assert(normalized.summary.total_prints === 8, "Normalizer should read all fixture prints.", normalized.summary);
  assert(normalized.summary.eligible_prints === 7, "Hard-excluded print must not be eligible.", normalized.summary);
  assert(normalized.summary.excluded_notional === 200000000, "Hard-excluded notional must be tracked but not scored.");
  assert(normalized.summary.eligible_notional === 880000000, "Scored notional should exclude hard-excluded prints.");
  assert(normalized.flagged.some((print) => print.flags.includes("odd_lot")), "Flag-only odd-lot policy missing.");
  assert(
    normalized.flagged.some((print) => print.excluded_from.includes("focus_block_classification")),
    "Separate-analysis prints should be excluded from focus classification."
  );

  const signed = signTradePrints(normalized, fixture.engine_inputs.price_context);
  assert(signed.direction === "bullish", "Signed-flow direction should be bullish.", signed);
  assert(signed.net_notional_pressure > 0.7 && signed.net_notional_pressure < 0.73, "Net pressure should come from signed prints.", signed);
  assert(signed.prints.some((print) => print.signed_side === "sell"), "Quote-rule sell fixture missing.");
  assert(signed.prints.some((print) => print.signing_method === "midpoint"), "Midpoint/unknown signing fixture missing.");

  const blocks = detectBlockTrf(signed, { profile: avgoProfile, baseline });
  assert(blocks.focus_trade_count === 4, "Focus block count should exclude ISO/odd-lot and hard exclusions.", blocks);
  assert(blocks.focus_notional === 440000000, "Focus notional should match eligible focus prints.", blocks);
  assert(blocks.largest_print_multiple === 9.4, "Largest print multiple should use profile floor.", blocks);

  const components = computeSignalComponents({ baseline, signed, blocks });
  assert(components.state === "ready", "Signal components should be ready.");
  assert(components.B_inputs.notional_zscore >= 2.5, "B notional z-score should be elevated.");
  assert(components.C_metrics.notional_ratio >= 5, "C notional ratio should be extreme.");
  assert(components.provenance.direction_source === "signed_flow", "Components must keep direction provenance.");

  const singleIndicators = computeAbcIndicators({ mode: "single_ticker", components });
  assert(singleIndicators.A === null, "A must be null in single ticker mode.");
  assert(!Object.hasOwn(singleIndicators, "composite_score"), "A/B/C must not collapse into a composite score.");
  const portfolioIndicators = computeAbcIndicators({
    mode: "portfolio",
    components,
    portfolioPopulation: [
      { volume_ratio: 1.1, focus_notional_share: 0.02, net_notional_pressure: -0.1 },
      components.C_metrics
    ]
  });
  assert(portfolioIndicators.A?.scope_label === "relative to your portfolio today", "Portfolio A scope label is required.");

  const laneStates = buildLaneStates(registry.lanes, fixture.lane_states, clock);
  const optionalOptions = laneStates.find((lane) => lane.lane_id === "options_flow");
  assert(optionalOptions?.required === false && optionalOptions.tier_effect === "none", "Optional lanes must not penalize.");

  const classifier = classifyTier({
    mode: "single_ticker",
    indicators: singleIndicators,
    laneStates,
    corroboration: fixture.corroboration,
    signing: signed
  });
  assert(classifier.tier === "A", "Classifier should produce Tier A from replay fixture.", classifier);
  assert(classifier.explain_tier.verdict === "Tier A", "Explain-tier verdict must come from classifier output.");

  const suppressed = classifyTier({
    mode: "single_ticker",
    indicators: singleIndicators,
    laneStates: laneStates.map((lane) =>
      lane.lane_id === "massive_live_trade_slices" ? { ...lane, state: "failed", tier_effect: "suppress_to_d" } : lane
    ),
    corroboration: fixture.corroboration,
    signing: signed
  });
  assert(suppressed.tier === "D" && suppressed.suppressed === true, "Required failed lanes must suppress to D.", suppressed);

  const capped = classifyTier({
    mode: "single_ticker",
    indicators: singleIndicators,
    laneStates: laneStates.map((lane) =>
      lane.lane_id === "massive_block_trade_feed" ? { ...lane, state: "partial", tier_effect: "cap_at_c" } : lane
    ),
    corroboration: fixture.corroboration,
    signing: signed
  });
  assert(capped.tier === "C" && capped.capped === true, "Block-lane partial coverage should cap at C.", capped);

  const fullAnalysis = analyzeReplayFixture(fixture, {
    policy,
    laneRegistry: registry,
    universe: universeFixture
  });
  assert(fullAnalysis.classifier.tier === "A", "Full replay analysis should classify Tier A.");

  const universes = service.getUniverses();
  assert(universes.universes.length === 1, "Expected one replay universe.");
  assert(universes.universes[0].performance_tier === "standard", "Replay universe should expose a performance tier.");

  const lanes = service.getLaneStates().lanes;
  assert(lanes.some((lane) => lane.required && lane.state === "ready"), "Required ready lane missing.");
  const optionalDisabled = lanes.find((lane) => lane.lane_id === "options_flow");
  assert(optionalDisabled?.required === false, "Options flow must be optional.");
  assert(optionalDisabled?.tier_effect === "none", "Optional disabled lane must not penalize tier.");
  assert(
    lanes.every((lane) => lane.provider_status && lane.provider_status.auto_start_allowed === false),
    "Lane states must expose provider readiness without enabling auto-start.",
    lanes
  );

  const providerService = createUtaService({
    config: {
      ...config,
      tradePrintsEnabled: false,
      tradePrintsApiKey: "",
      polygonApiKey: "",
      iexApiKey: "",
      marketDataProvider: "synthetic",
      autonomousDataEnabled: false,
      stocktwitsEnabled: false,
      stocktwitsApiKey: ""
    }
  });
  const providers = providerService.getProviderStatus();
  assert(providers.schema_version === "uta.provider_status.v1", "Provider status schema mismatch.", providers);
  assert(providers.replay_available === true, "Replay fixture must stay available while providers are configured.", providers);
  assert(providers.live_ready === false, "Default UTA provider status must not claim live readiness.", providers);
  assert(providers.summary.auto_start_allowed === 0, "UTA provider readiness must not allow heavy auto-start.", providers.summary);
  assert(
    providers.provider_lanes.some((lane) =>
      lane.lane_id === "massive_live_trade_slices" &&
      lane.required &&
      lane.configured === false &&
      lane.state_if_unavailable === "unavailable" &&
      lane.tier_effect_when_unavailable === "suppress_to_d"
    ),
    "Missing live trade-print provider must be explicit and suppress required live lanes.",
    providers.provider_lanes
  );
  assert(
    providers.provider_lanes.some((lane) => lane.provider_family === "options" && lane.optional_corroboration_only && lane.tier_effect_when_unavailable === "none"),
    "Optional provider lanes must remain corroboration-only.",
    providers.provider_lanes
  );

  const portfolio = service.getPortfolioAnalysis({ tickers: ["AVGO", "ZZZZ"] });
  assert(portfolio.results.length === 2, "Portfolio should preserve requested ticker count.");
  assert(portfolio.results[0].indicators.A?.scope_label === "relative to your portfolio today", "Portfolio A scope label is wrong.");
  assert(portfolio.results[1].tier === "D", "Missing portfolio ticker should be Tier D.");

  const pass1 = service.getScan({ universe: "sp500", direction: "bullish", pass: 1 });
  assert(pass1.results[0].pass2_status === "pending", "Scan pass 1 should be preliminary.");
  const pass2 = service.runScanPass2({ shortlist: ["AVGO"] });
  assert(pass2.results[0].status === "resolved", "Scan pass 2 should resolve shortlist rows.");

  console.log(JSON.stringify({
    status: "ok",
    universes: universes.universes.length,
    lanes: lanes.length,
    portfolio_rows: portfolio.results.length,
    scan_pass1_rows: pass1.results.length,
    scan_pass2_rows: pass2.results.length,
    baseline_sessions: baseline.session_count,
    eligible_prints: normalized.summary.eligible_prints,
    excluded_notional: normalized.summary.excluded_notional,
    net_notional_pressure: signed.net_notional_pressure,
    classifier_tier: classifier.tier
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "error", error: error.message, details: error.details || {} }, null, 2));
  process.exitCode = 1;
}
