import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { normalizeTickerSymbol } from "../utils/helpers.js";

const USER_STATE_VERSION = "uta.user_state.v1";
const UTA_HISTORY_LIMIT = 250;
const UTA_AUDIT_LIMIT = 200;
const UTA_REPLAY_RUN_LIMIT = 50;

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function stableCycleStamp(value) {
  return String(value || nowIso()).replace(/[:.]/g, "-");
}

function roundNumber(value, digits = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function sum(values) {
  return values.reduce((total, value) => total + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);
}

function median(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) {
    return null;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function mad(values, center = median(values)) {
  if (!Number.isFinite(Number(center))) {
    return null;
  }
  return median(values.map((value) => Math.abs(Number(value) - Number(center))));
}

function robustZScore(value, center, dispersion) {
  const numeric = Number(value);
  const medianValue = Number(center);
  const madValue = Number(dispersion);
  if (!Number.isFinite(numeric) || !Number.isFinite(medianValue) || !Number.isFinite(madValue) || madValue <= 0) {
    return null;
  }
  const zscore = (numeric - medianValue) / (1.4826 * madValue);
  return Math.max(-12, Math.min(12, zscore));
}

function dateOnly(isoValue) {
  return String(isoValue || "").slice(0, 10);
}

function toEpochMs(isoValue) {
  const ms = new Date(isoValue || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function createReplayClock(replayClock) {
  const fixed = new Date(replayClock || "1970-01-01T00:00:00.000Z");
  const fixedMs = fixed.getTime();
  if (!Number.isFinite(fixedMs)) {
    throw new Error(`Invalid UTA replay clock: ${replayClock}`);
  }
  return {
    now: () => fixedMs,
    iso: () => fixed.toISOString(),
    date: () => dateOnly(fixed.toISOString()),
    metadata: () => ({
      source_mode: "replay",
      replay_clock: fixed.toISOString()
    })
  };
}

export function loadUniverseProfiles(universe = {}, profileOverrides = []) {
  const overrides = new Map(profileOverrides.map((profile) => [profile.ticker || profile.symbol, profile]));
  const tickers = Array.isArray(universe.tickers) ? universe.tickers : [];
  return tickers.map((row) => {
    const override = overrides.get(row.symbol) || {};
    return {
      ticker: row.symbol,
      name: row.name,
      exchange: row.exchange || override.exchange || null,
      sector: row.sector || override.sector || null,
      liquidity_bucket: override.liquidity_bucket || "unknown",
      adv_20day: Number(override.adv_20day || 0),
      notional_floor: Number(override.notional_floor || 25_000_000),
      pi_performance_tier: universe.performance_tier || override.pi_performance_tier || "standard",
      source: universe.source || "unknown"
    };
  });
}

export function buildBaseline({ ticker, historicalSessions = [], clock = createReplayClock(), windowSessions = 20 } = {}) {
  const asOfDate = clock.date();
  const beforeAsOf = historicalSessions
    .filter((session) => session?.date && session.date < asOfDate)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const earningsExcluded = beforeAsOf.filter((session) => Boolean(session.earnings_session || session.earningsSession));
  const usable = beforeAsOf
    .filter((session) => !session.earnings_session && !session.earningsSession)
    .slice(0, windowSessions);
  const metrics = ["volume", "notional", "focus_notional_share", "net_notional_pressure"].reduce((acc, metric) => {
    const values = usable.map((session) => Number(session[metric])).filter(Number.isFinite);
    const center = median(values);
    acc[metric] = {
      median: roundNumber(center, metric.includes("share") || metric.includes("pressure") ? 4 : 2),
      mad: roundNumber(mad(values, center), metric.includes("share") || metric.includes("pressure") ? 4 : 2),
      samples: values.length
    };
    return acc;
  }, {});

  return {
    ticker,
    as_of_date: asOfDate,
    time_bucket: "regular",
    state: usable.length >= 10 ? "ready" : "insufficient_history",
    session_count: usable.length,
    source_session_count: beforeAsOf.length,
    earnings_excluded_count: earningsExcluded.length,
    window_sessions: windowSessions,
    no_lookahead_verified: usable.every((session) => session.date < asOfDate),
    metrics
  };
}

function policyLookup(policy = {}) {
  const hard = new Map((policy.hard_exclude || []).map((row) => [String(row.code), row]));
  const session = new Map((policy.session_bucket || []).map((row) => [String(row.code), row]));
  const flagOnly = new Map((policy.flag_only || []).map((row) => [String(row.code), row]));
  const separate = new Map((policy.separate_analysis || []).map((row) => [String(row.code), row]));
  return { hard, session, flagOnly, separate };
}

function sessionBucketFromTimestamp(ts) {
  const timestamp = new Date(ts || 0);
  if (!Number.isFinite(timestamp.getTime())) {
    return "unknown";
  }
  const minutesUtc = timestamp.getUTCHours() * 60 + timestamp.getUTCMinutes();
  if (minutesUtc < 13 * 60 + 30) {
    return "premarket";
  }
  if (minutesUtc >= 20 * 60) {
    return "extended_hours";
  }
  return "regular";
}

export function normalizeTradePrints(prints = [], policy = {}) {
  const lookup = policyLookup(policy);
  const normalized = prints.map((print, index) => {
    const conditionCodes = (print.condition_codes || print.conditions || []).map(String);
    const hardMatch = conditionCodes.map((code) => lookup.hard.get(code)).find(Boolean);
    const flags = [];
    const excludedFrom = new Set();
    let conditionSessionBucket = null;

    for (const code of conditionCodes) {
      const sessionRule = lookup.session.get(code);
      if (sessionRule?.bucket) {
        conditionSessionBucket = sessionRule.bucket;
      }
      const flagRule = lookup.flagOnly.get(code);
      if (flagRule) {
        flags.push(flagRule.flag);
        for (const target of flagRule.exclude_from || []) {
          excludedFrom.add(target);
        }
      }
      const separateRule = lookup.separate.get(code);
      if (separateRule) {
        flags.push(separateRule.flag);
        for (const target of separateRule.excluded_from || []) {
          excludedFrom.add(target);
        }
      }
    }

    const price = Number(print.price);
    const size = Number(print.size);
    const notional = Number.isFinite(Number(print.notional))
      ? Number(print.notional)
      : Number.isFinite(price) && Number.isFinite(size)
        ? price * size
        : 0;
    const hardExcluded = Boolean(hardMatch);
    if (hardExcluded) {
      excludedFrom.add("scoring");
      excludedFrom.add("block_detection");
      excludedFrom.add("directional_scoring");
    }

    return {
      id: print.id || `print-${index + 1}`,
      ts: print.ts,
      venue: print.venue || "unknown",
      price,
      size,
      notional,
      bid: Number.isFinite(Number(print.bid)) ? Number(print.bid) : null,
      ask: Number.isFinite(Number(print.ask)) ? Number(print.ask) : null,
      condition_codes: conditionCodes,
      policy_version: policy.version || "unknown",
      eligible: !hardExcluded,
      policy_action: hardExcluded ? "hard_excluded" : flags.length ? "flagged" : "eligible",
      exclude_reason: hardMatch?.description || null,
      flags: Array.from(new Set(flags)),
      excluded_from: Array.from(excludedFrom),
      session_bucket: conditionSessionBucket || sessionBucketFromTimestamp(print.ts)
    };
  });

  const eligible = normalized.filter((print) => print.eligible);
  const excluded = normalized.filter((print) => !print.eligible);
  const flagged = normalized.filter((print) => print.flags.length > 0);
  return {
    policy_version: policy.version || "unknown",
    prints: normalized,
    eligible,
    excluded,
    flagged,
    summary: {
      total_prints: normalized.length,
      eligible_prints: eligible.length,
      excluded_prints: excluded.length,
      flagged_prints: flagged.length,
      eligible_notional: roundNumber(sum(eligible.map((print) => print.notional)), 2),
      excluded_notional: roundNumber(sum(excluded.map((print) => print.notional)), 2),
      excluded_counts_by_reason: excluded.reduce((acc, print) => {
        const reason = print.exclude_reason || "unknown";
        acc[reason] = (acc[reason] || 0) + 1;
        return acc;
      }, {})
    }
  };
}

export function signTradePrints(normalizedResult = {}, priceContext = {}) {
  const eligible = normalizedResult.eligible || [];
  let previousPrice = Number(priceContext.previous_trade_price);
  let signedNotional = 0;
  let signedVolume = 0;
  let weightedConfidence = 0;

  const prints = eligible.map((print) => {
    let signedSide = "unknown";
    let signingMethod = "unknown";
    let confidence = 0.2;

    if (print.excluded_from.includes("directional_scoring")) {
      signingMethod = "policy_excluded";
      confidence = 0;
    } else if (Number.isFinite(print.bid) && Number.isFinite(print.ask)) {
      if (print.price >= print.ask) {
        signedSide = "buy";
        signingMethod = "quote_rule";
        confidence = 0.85;
      } else if (print.price <= print.bid) {
        signedSide = "sell";
        signingMethod = "quote_rule";
        confidence = 0.85;
      } else {
        signingMethod = "midpoint";
        confidence = 0.2;
      }
    } else if (Number.isFinite(previousPrice)) {
      if (print.price > previousPrice) {
        signedSide = "buy";
        signingMethod = "tick_fallback";
        confidence = 0.6;
      } else if (print.price < previousPrice) {
        signedSide = "sell";
        signingMethod = "tick_fallback";
        confidence = 0.6;
      } else {
        signingMethod = "zero_tick";
        confidence = 0.2;
      }
    }

    const multiplier = signedSide === "buy" ? 1 : signedSide === "sell" ? -1 : 0;
    const printSignedNotional = multiplier * print.notional;
    const printSignedVolume = multiplier * print.size;
    signedNotional += printSignedNotional;
    signedVolume += printSignedVolume;
    weightedConfidence += print.notional * confidence;
    if (Number.isFinite(print.price)) {
      previousPrice = print.price;
    }
    return {
      ...print,
      signed_side: signedSide,
      signing_method: signingMethod,
      signing_confidence: roundNumber(confidence, 3),
      signed_notional: roundNumber(printSignedNotional, 2),
      signed_volume: roundNumber(printSignedVolume, 2)
    };
  });

  const totalNotional = sum(eligible.map((print) => print.notional));
  const totalVolume = sum(eligible.map((print) => print.size));
  const netNotionalPressure = totalNotional > 0 ? signedNotional / totalNotional : null;
  const netVolumePressure = totalVolume > 0 ? signedVolume / totalVolume : null;
  const direction =
    Number(netNotionalPressure) > 0.15 ? "bullish" : Number(netNotionalPressure) < -0.15 ? "bearish" : "neutral";

  return {
    prints,
    direction,
    total_notional: roundNumber(totalNotional, 2),
    total_volume: roundNumber(totalVolume, 2),
    signed_notional: roundNumber(signedNotional, 2),
    signed_volume: roundNumber(signedVolume, 2),
    net_notional_pressure: roundNumber(netNotionalPressure, 4),
    net_volume_pressure: roundNumber(netVolumePressure, 4),
    signing_confidence: totalNotional > 0 ? roundNumber(weightedConfidence / totalNotional, 3) : 0
  };
}

export function detectBlockTrf(signedResult = {}, { profile = {}, baseline = null } = {}) {
  const prints = signedResult.prints || [];
  const focusFloor = Number(profile.notional_floor || 25_000_000);
  const eligible = prints.filter((print) => print.eligible);
  const focusPrints = eligible.filter((print) => {
    const blockedByPolicy =
      print.excluded_from.includes("block_detection") ||
      print.excluded_from.includes("focus_block_classification");
    return !blockedByPolicy && print.notional >= focusFloor;
  });
  const totalNotional = sum(eligible.map((print) => print.notional));
  const trfNotional = sum(eligible.filter((print) => /TRF|OFF/i.test(print.venue)).map((print) => print.notional));
  const focusNotional = sum(focusPrints.map((print) => print.notional));
  const largest = eligible.reduce((max, print) => (print.notional > (max?.notional || 0) ? print : max), null);
  return {
    focus_trade_count: focusPrints.length,
    focus_notional: roundNumber(focusNotional, 2),
    focus_notional_share: totalNotional > 0 ? roundNumber(focusNotional / totalNotional, 4) : null,
    trf_share: totalNotional > 0 ? roundNumber(trfNotional / totalNotional, 4) : null,
    largest_print_notional: roundNumber(largest?.notional || 0, 2),
    largest_print_multiple: focusFloor > 0 ? roundNumber((largest?.notional || 0) / focusFloor, 2) : null,
    top_raw_print_refs: focusPrints
      .sort((a, b) => b.notional - a.notional)
      .slice(0, 5)
      .map((print) => ({
        id: print.id,
        ts: print.ts,
        venue: print.venue,
        notional: print.notional,
        signed_side: print.signed_side
      })),
    baseline_state: baseline?.state || "unknown"
  };
}

export function computeSignalComponents({ baseline, signed, blocks } = {}) {
  const notionalMedian = Number(baseline?.metrics?.notional?.median || 0);
  const volumeMedian = Number(baseline?.metrics?.volume?.median || 0);
  const focusMedian = Number(baseline?.metrics?.focus_notional_share?.median || 0);
  const pressureMedian = Number(baseline?.metrics?.net_notional_pressure?.median || 0);
  const totalNotional = Number(signed?.total_notional || 0);
  const totalVolume = Number(signed?.total_volume || 0);
  const focusShare = Number(blocks?.focus_notional_share || 0);
  const pressure = Number(signed?.net_notional_pressure || 0);

  const bInputs = {
    volume_zscore: robustZScore(totalVolume, volumeMedian, baseline?.metrics?.volume?.mad),
    notional_zscore: robustZScore(totalNotional, notionalMedian, baseline?.metrics?.notional?.mad),
    focus_notional_share_zscore: robustZScore(focusShare, focusMedian, baseline?.metrics?.focus_notional_share?.mad),
    net_notional_pressure_zscore: robustZScore(pressure, pressureMedian, baseline?.metrics?.net_notional_pressure?.mad)
  };

  const cMetrics = {
    volume_ratio: volumeMedian > 0 ? totalVolume / volumeMedian : null,
    notional_ratio: notionalMedian > 0 ? totalNotional / notionalMedian : null,
    focus_notional_share: blocks?.focus_notional_share ?? null,
    focus_trade_count: blocks?.focus_trade_count ?? 0,
    largest_print_multiple: blocks?.largest_print_multiple ?? null,
    net_notional_pressure: signed?.net_notional_pressure ?? null,
    net_volume_pressure: signed?.net_volume_pressure ?? null,
    total_notional: totalNotional,
    focus_notional: blocks?.focus_notional ?? 0,
    largest_print_notional: blocks?.largest_print_notional ?? 0
  };

  return {
    state: baseline?.state === "ready" ? "ready" : "insufficient_history",
    B_inputs: Object.fromEntries(Object.entries(bInputs).map(([key, value]) => [key, roundNumber(value, 2)])),
    C_metrics: Object.fromEntries(Object.entries(cMetrics).map(([key, value]) => [key, roundNumber(value, key.includes("ratio") || key.includes("share") || key.includes("pressure") ? 3 : 2)])),
    provenance: {
      baseline_session_count: baseline?.session_count || 0,
      earnings_excluded_count: baseline?.earnings_excluded_count || 0,
      no_lookahead_verified: Boolean(baseline?.no_lookahead_verified),
      direction_source: "signed_flow"
    },
    calculation_notes: [
      "B uses median/MAD baseline statistics.",
      "C preserves raw ordering metrics.",
      "Direction comes from signed flow, not price movement."
    ]
  };
}

function percentileRank(value, peers = []) {
  const numeric = Number(value);
  const values = peers.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!Number.isFinite(numeric) || !values.length) {
    return null;
  }
  const belowOrEqual = values.filter((peer) => peer <= numeric).length;
  return belowOrEqual / values.length;
}

export function computeAbcIndicators({ mode = "single_ticker", components, portfolioPopulation = [] } = {}) {
  const C = components?.C_metrics || {};
  const B = components?.B_inputs || {};
  const A =
    mode === "single_ticker"
      ? null
      : {
          volume_percentile: roundNumber(percentileRank(C.volume_ratio, portfolioPopulation.map((row) => row.volume_ratio)), 3),
          focus_notional_share_percentile: roundNumber(percentileRank(C.focus_notional_share, portfolioPopulation.map((row) => row.focus_notional_share)), 3),
          net_notional_pressure_percentile: roundNumber(percentileRank(C.net_notional_pressure, portfolioPopulation.map((row) => row.net_notional_pressure)), 3),
          scope_label: "relative to your portfolio today"
        };
  return { A, B, C };
}

function tierRank(tier) {
  return { A: 4, B: 3, C: 2, D: 1 }[tier] || 1;
}

function capTier(tier, cap) {
  return tierRank(tier) > tierRank(cap) ? cap : tier;
}

export function classifyTier({ mode = "single_ticker", indicators = {}, laneStates = [], corroboration = {}, signing = {} } = {}) {
  const requiredProblem = laneStates.find((lane) =>
    lane.required && ["loading", "failed", "unavailable"].includes(String(lane.state || "").toLowerCase())
  );
  const staleSuppressingProblem = laneStates.find((lane) =>
    lane.required &&
    String(lane.state || "").toLowerCase() === "stale" &&
    String(lane.tier_effect || "").toLowerCase() === "suppress_to_d"
  );
  const capProblem = laneStates.find((lane) =>
    lane.required &&
    ["stale", "partial", "unavailable"].includes(String(lane.state || "").toLowerCase()) &&
    String(lane.tier_effect || "").toLowerCase() === "cap_at_c"
  );
  const bValues = Object.values(indicators.B || {}).map(Number).filter(Number.isFinite);
  const c = indicators.C || {};
  const maxB = bValues.length ? Math.max(...bValues) : null;
  const direction = signing.direction || "undetermined";
  const directionConsistent = ["bullish", "bearish"].includes(direction) && Math.abs(Number(c.net_notional_pressure || 0)) >= 0.25;
  const cExtreme =
    Number(c.notional_ratio || 0) >= 5 ||
    Number(c.focus_notional_share || 0) >= 0.25 ||
    Number(c.focus_trade_count || 0) >= 2;
  const bExtreme = Number(maxB) >= 2.5;
  const bElevated = Number(maxB) >= 1.5;
  const corroborationCount = Number(corroboration.independent_confirmation_count || 0);
  const hasCorroboration = corroborationCount >= 1 || Boolean(corroboration.provider_alert_confirmed);

  let tier = "D";
  if (requiredProblem || staleSuppressingProblem || !bValues.length || Object.keys(c).length === 0) {
    tier = "D";
  } else if (bExtreme && cExtreme && directionConsistent && hasCorroboration) {
    tier = "A";
  } else if (bExtreme && cExtreme && directionConsistent) {
    tier = "B";
  } else if (bElevated || cExtreme) {
    tier = "C";
  }
  if (capProblem) {
    tier = capTier(tier, "C");
  }

  const verdict = `Tier ${tier}`;
  return {
    tier,
    direction,
    capped: Boolean(capProblem && tier === "C"),
    suppressed: tier === "D" && Boolean(requiredProblem || staleSuppressingProblem),
    explain_tier: {
      mode,
      rule_set: mode === "single_ticker" ? "single_ticker_b_plus_c" : "portfolio_or_scan_abc",
      verdict,
      rules: [
        {
          id: "b_extreme",
          label: "B >= 2.5 sigma on volume, notional, focus, or pressure",
          passed: bExtreme,
          actual: Number.isFinite(maxB) ? `${roundNumber(maxB, 2)} sigma max` : "No B values"
        },
        {
          id: "c_extreme",
          label: "C raw metrics show extreme volume, focus prints, or pressure",
          passed: cExtreme,
          actual: `${roundNumber(c.notional_ratio, 2) ?? "N/A"}x notional, ${c.focus_trade_count ?? 0} focus prints`
        },
        {
          id: "direction_consistent",
          label: "Directional pressure is consistent",
          passed: directionConsistent,
          actual: `${roundNumber(Number(c.net_notional_pressure || 0) * 100, 1)}% signed notional pressure`
        },
        {
          id: "independent_corroboration",
          label: "At least one independent corroboration",
          passed: hasCorroboration,
          actual: `${corroborationCount} confirmations`
        },
        {
          id: "required_lanes_ready",
          label: "Required lanes are ready enough for this tier",
          passed: !requiredProblem && !staleSuppressingProblem,
          actual: requiredProblem?.operator_copy || staleSuppressingProblem?.operator_copy || "Required lanes ready"
        }
      ],
      gap_to_next_tier:
        tier === "A"
          ? []
          : [
              !bExtreme ? "Increase B anomaly above the 2.5 sigma gate." : null,
              !cExtreme ? "Add stronger raw C evidence." : null,
              !directionConsistent ? "Improve signed-flow directional confidence." : null,
              !hasCorroboration ? "Add independent corroboration." : null
            ].filter(Boolean)
    }
  };
}

export function buildLaneStates(registry = [], observedStates = [], clock = createReplayClock()) {
  const observed = new Map(observedStates.map((lane) => [lane.lane_id, lane]));
  const now = clock.now();
  return registry.map((lane) => {
    const current = observed.get(lane.lane_id);
    const latestMs = toEpochMs(current?.latest_as_of);
    const freshnessSeconds = latestMs ? Math.max(0, Math.round((now - latestMs) / 1000)) : null;
    const stale =
      current &&
      current.state !== "disabled" &&
      Number.isFinite(freshnessSeconds) &&
      freshnessSeconds > Number(lane.freshness_sla_seconds || current.freshness_sla_seconds || Infinity);
    const state = stale ? "stale" : current?.state || (lane.required ? "unavailable" : "disabled");
    const tierEffect = lane.required ? lane.tier_effect_when_missing : "none";
    return {
      lane_id: lane.lane_id,
      label: lane.label,
      state,
      required: lane.required,
      tier_effect: state === "ready" ? "none" : current?.tier_effect || tierEffect,
      coverage: current?.coverage ?? null,
      latest_as_of: current?.latest_as_of ?? null,
      freshness_seconds: freshnessSeconds,
      freshness_sla_seconds: lane.freshness_sla_seconds,
      operator_copy:
        current?.operator_copy ||
        (lane.required
          ? `${lane.label} is unavailable; no live signal is fabricated.`
          : `${lane.label} is optional or disabled and does not penalize tiers.`),
      next_action: current?.next_action || { label: `Refresh ${lane.label}`, route: lane.refresh_route }
    };
  });
}

function fixturePaths(config) {
  return {
    single: path.join(config.rootDir, "data", "uta", "replay", "avgo-single.json"),
    universe: path.join(config.rootDir, "data", "uta", "universes", "sample-sp500.json"),
    lanes: path.join(config.rootDir, "config", "uta_lane_registry.json"),
    policy: path.join(config.rootDir, "config", "condition_code_policy_v1.json"),
    providers: path.join(config.rootDir, "docs", "uta-provider-adapter-matrix.md")
  };
}

function defaultUserState() {
  return {
    schema_version: USER_STATE_VERSION,
    watchlist: [],
    reviewed: {},
    ignored: {},
    rules: [
      {
        id: "tier-a-bullish",
        name: "Tier A bullish flow",
        enabled: true,
        min_tier: "A",
        direction: "bullish",
        source: "default"
      }
    ],
    saved_scans: [],
    settings: {
      theme: "dark",
      density: "regular"
    }
  };
}

function defaultUtaStoreState() {
  return {
    userState: defaultUserState(),
    signalResults: [],
    laneStates: [],
    replayRuns: [],
    alerts: [],
    auditLog: [],
    scheduler: {
      enabled: false,
      mode: "manual",
      profile: "pi_safe_replay",
      last_run_at: null,
      next_run_at: null,
      jobs: [
        { id: "manual_refresh", label: "Manual refresh", enabled: true, interval_seconds: null },
        { id: "regular_cycle", label: "5-minute UTA cycle", enabled: false, interval_seconds: 300 },
        { id: "premarket_cycle", label: "Pre-market UTA cycle", enabled: false, interval_seconds: 900 },
        { id: "nightly_baseline", label: "Nightly baseline rebuild", enabled: false, interval_seconds: 86400 },
        { id: "weekly_universe", label: "Weekly universe refresh", enabled: false, interval_seconds: 604800 }
      ]
    },
    lastCycle: null
  };
}

function providerCredential(config, envNames = []) {
  const configured = envNames.some((name) => {
    if (name === "TRADE_PRINTS_API_KEY") {
      return Boolean(config.tradePrintsApiKey);
    }
    if (name === "POLYGON_API_KEY") {
      return Boolean(config.polygonApiKey);
    }
    if (name === "IEX_API_KEY") {
      return Boolean(config.iexApiKey);
    }
    if (name === "STOCKTWITS_API_KEY") {
      return Boolean(config.stocktwitsApiKey);
    }
    if (name === "EARNINGS_API_KEY") {
      return Boolean(config.earningsApiKey);
    }
    return false;
  });
  return {
    env_names: envNames,
    configured
  };
}

function buildProviderReadiness(config = {}, registry = []) {
  const byLane = new Map(registry.map((lane) => [lane.lane_id, lane]));
  const tradePrintCredential = providerCredential(config, ["TRADE_PRINTS_API_KEY", "POLYGON_API_KEY", "IEX_API_KEY"]);
  const marketProvider = config.marketDataProvider || "synthetic";
  const marketConfigured = marketProvider !== "synthetic";
  const earningsCredential = providerCredential(config, ["EARNINGS_API_KEY"]);
  const stocktwitsCredential = providerCredential(config, ["STOCKTWITS_API_KEY"]);
  const piBlocksHeavyAutoStart = Boolean(config.apiSaverMode || config.piPerformanceMode);

  const specs = [
    {
      lane_id: "massive_live_trade_slices",
      provider_family: "trade_prints",
      provider: config.tradePrintsProvider || "polygon",
      enabled: Boolean(config.tradePrintsEnabled),
      credential: tradePrintCredential,
      fallback_state: "unavailable",
      operator_copy_ready: "Live trade-print adapter is configured; keep polling manual until replay/live parity is validated.",
      operator_copy_missing: "Live trade-print adapter is not configured; required flow lanes remain replay-backed or unavailable and no live signal is fabricated."
    },
    {
      lane_id: "massive_premarket_trade_slices",
      provider_family: "trade_prints",
      provider: config.tradePrintsProvider || "polygon",
      enabled: Boolean(config.tradePrintsEnabled),
      credential: tradePrintCredential,
      fallback_state: "disabled",
      operator_copy_ready: "Pre-market trade-print adapter is configured and can be run manually.",
      operator_copy_missing: "Pre-market slices stay disabled when trade prints are unavailable or the session is outside premarket."
    },
    {
      lane_id: "massive_daily_bars",
      provider_family: "bars",
      provider: marketProvider,
      enabled: Boolean(config.autonomousDataEnabled),
      credential: { env_names: ["MARKET_DATA_PROVIDER"], configured: marketConfigured },
      fallback_state: marketConfigured ? "stale" : "unavailable",
      operator_copy_ready: "Market-data bars provider is configured for baseline and trend lanes.",
      operator_copy_missing: "Daily bars need a non-synthetic market-data provider before live baselines can be trusted."
    },
    {
      lane_id: "massive_block_trade_feed",
      provider_family: "derived_trade_prints",
      provider: config.tradePrintsProvider || "polygon",
      enabled: Boolean(config.tradePrintsEnabled),
      credential: tradePrintCredential,
      fallback_state: "unavailable",
      operator_copy_ready: "Block/TRF evidence can be derived from normalized live prints.",
      operator_copy_missing: "Block/TRF evidence cannot be derived until live prints are configured."
    },
    {
      lane_id: "fred_macro_context",
      provider_family: "macro",
      provider: "existing_macro_context",
      enabled: true,
      credential: { env_names: [], configured: true },
      fallback_state: "stale",
      operator_copy_ready: "Macro lane is contextual only and can use existing macro/regime state.",
      operator_copy_missing: "Macro lane is contextual only; missing data never penalizes UTA tiers."
    },
    {
      lane_id: "activity_alerts",
      provider_family: "alerts",
      provider: "manual_or_import",
      enabled: false,
      credential: { env_names: [], configured: false },
      fallback_state: "disabled",
      operator_copy_ready: "Optional alert imports are available.",
      operator_copy_missing: "Optional alert imports are disabled and never penalize tiers."
    },
    {
      lane_id: "options_flow",
      provider_family: "options",
      provider: "future_adapter",
      enabled: false,
      credential: { env_names: [], configured: false },
      fallback_state: "disabled",
      operator_copy_ready: "Optional options-flow adapter is available.",
      operator_copy_missing: "Options flow is optional, disabled in v1, and never penalizes tiers."
    },
    {
      lane_id: "earnings_calendar",
      provider_family: "earnings",
      provider: config.earningsProvider || "yahoo",
      enabled: Boolean(config.earningsEnabled),
      credential: earningsCredential.configured || (config.earningsProvider || "yahoo") === "yahoo"
        ? { ...earningsCredential, configured: true }
        : earningsCredential,
      fallback_state: "stale",
      operator_copy_ready: "Earnings calendar is available for baseline exclusion context.",
      operator_copy_missing: "Earnings calendar is stale; baseline exclusion must disclose reduced confidence."
    },
    {
      lane_id: "universe_constituents",
      provider_family: "universe",
      provider: "json_fixture_or_reference_provider",
      enabled: true,
      credential: { env_names: [], configured: true },
      fallback_state: "stale",
      operator_copy_ready: "Universe constituents are available from fixtures or configured reference data.",
      operator_copy_missing: "Universe constituents are stale; scan can run with last known universe and a warning."
    },
    {
      lane_id: "activity_alerts",
      provider_family: "social_sentiment",
      provider: "stocktwits",
      enabled: Boolean(config.stocktwitsEnabled),
      credential: stocktwitsCredential,
      fallback_state: "disabled",
      operator_copy_ready: "StockTwits can provide optional corroborating sentiment only.",
      operator_copy_missing: "StockTwits is optional and cannot penalize or promote a UTA tier by itself.",
      optional_corroboration_only: true
    }
  ];

  const providerLanes = specs.map((spec) => {
    const lane = byLane.get(spec.lane_id) || {};
    const credentialConfigured = Boolean(spec.credential?.configured);
    const configured = Boolean(spec.enabled && credentialConfigured);
    const liveCapable = configured && !piBlocksHeavyAutoStart;
    return {
      lane_id: spec.lane_id,
      label: lane.label || spec.lane_id,
      required: Boolean(lane.required),
      provider_family: spec.provider_family,
      provider: spec.provider,
      enabled: Boolean(spec.enabled),
      configured,
      credential_configured: credentialConfigured,
      credential_env_names: spec.credential?.env_names || [],
      live_capable: liveCapable,
      auto_start_allowed: false,
      pi_safe_manual_only: piBlocksHeavyAutoStart || configured,
      state_if_unavailable: spec.fallback_state,
      tier_effect_when_unavailable: lane.required ? lane.tier_effect_when_missing : "none",
      optional_corroboration_only: Boolean(spec.optional_corroboration_only || !lane.required),
      operator_copy: configured ? spec.operator_copy_ready : spec.operator_copy_missing,
      next_action: configured
        ? { action: "manual_revalidate", label: "Run manual replay/live parity check" }
        : { action: "configure_provider", label: `Configure ${spec.provider_family}` }
    };
  });

  const required = providerLanes.filter((lane) => lane.required);
  const optional = providerLanes.filter((lane) => !lane.required);
  return {
    schema_version: "uta.provider_status.v1",
    generated_at: nowIso(),
    source: "docs/uta-provider-adapter-matrix.md",
    mode: "replay_first",
    replay_available: false,
    live_ready: required.every((lane) => lane.configured),
    live_trade_prints_configured: Boolean(config.tradePrintsApiKey),
    summary: {
      total_lanes: providerLanes.length,
      required_configured: required.filter((lane) => lane.configured).length,
      required_total: required.length,
      optional_configured: optional.filter((lane) => lane.configured).length,
      optional_total: optional.length,
      live_capable: providerLanes.filter((lane) => lane.live_capable).length,
      auto_start_allowed: 0
    },
    provider_lanes: providerLanes,
    safeguards: [
      "Replay remains the source of truth until live-provider parity checks pass.",
      "Provider failures become lane states; they do not create synthetic live signals.",
      "Optional corroboration lanes never penalize UTA tiers.",
      "No paper-trading effect is enabled by provider readiness."
    ],
    policy: "Provider failures become lane states; they do not create synthetic live signals."
  };
}

function countBy(items = [], key = "state") {
  return items.reduce((counts, item) => {
    const value = item?.[key] || "unknown";
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function ensureUtaStoreState(store) {
  if (!store) {
    return defaultUtaStoreState();
  }
  store.uta = {
    ...defaultUtaStoreState(),
    ...(store.uta || {})
  };
  store.uta.userState = {
    ...defaultUserState(),
    ...(store.uta.userState || {})
  };
  store.uta.signalResults = Array.isArray(store.uta.signalResults) ? store.uta.signalResults : [];
  store.uta.laneStates = Array.isArray(store.uta.laneStates) ? store.uta.laneStates : [];
  store.uta.replayRuns = Array.isArray(store.uta.replayRuns) ? store.uta.replayRuns : [];
  store.uta.alerts = Array.isArray(store.uta.alerts) ? store.uta.alerts : [];
  store.uta.auditLog = Array.isArray(store.uta.auditLog) ? store.uta.auditLog : [];
  store.uta.scheduler = {
    ...defaultUtaStoreState().scheduler,
    ...(store.uta.scheduler || {})
  };
  return store.uta;
}

function assertNoCompositeScore(payload) {
  const forbidden = new Set(["composite_score", "signal_strength_score"]);
  const stack = [payload];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") {
      continue;
    }
    for (const [key, value] of Object.entries(current)) {
      if (forbidden.has(key.toLowerCase())) {
        throw new Error("UTA payload violates invariant: A/B/C must not be collapsed into a composite score.");
      }
      if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }
}

function applyTickerOverride(payload, ticker) {
  const next = clone(payload);
  next.ticker = ticker;
  if (ticker !== payload.ticker) {
    next.tier = "D";
    next.direction = "undetermined";
    next.name = null;
    next.exchange = null;
    next.sector = null;
    next.profile = null;
    next.data_state = "insufficient_history";
    next.indicators = { A: null, B: {}, C: {} };
    next.signing_confidence = 0;
    next.bluf = {
      headline: `${ticker} - insufficient replay history`,
      what_happened: "This ticker is not present in the current UTA replay fixture.",
      why_it_matters: "The vertical slice refuses to fabricate a signal when baseline and print data are unavailable.",
      what_to_check: "Add a replay fixture or configure a live trade-print provider before using this ticker.",
      limitations: "No tier should be treated as actionable for this ticker."
    };
    next.evidence_cards = [];
    next.explain_tier = {
      mode: "single_ticker",
      rule_set: "single_ticker_b_plus_c",
      verdict: "Tier D",
      rules: [
        { id: "insufficient_history", label: "At least 10 usable baseline sessions", passed: false, actual: "0 replay sessions" }
      ],
      gap_to_next_tier: ["Add baseline and print data."]
    };
    next.raw_prints = {
      ticker,
      policy_version: payload.raw_prints?.policy_version || "unknown",
      truncated: false,
      normalization_summary: {
        total_prints: 0,
        eligible_prints: 0,
        excluded_prints: 0,
        flagged_prints: 0,
        eligible_notional: 0,
        excluded_notional: 0,
        excluded_counts_by_reason: {}
      },
      prints: []
    };
    next.engine_diagnostics = {
      state: "unavailable",
      reason: "missing_replay_fixture",
      baseline: { state: "insufficient_history", session_count: 0 },
      signal_components: { state: "insufficient_history", B_inputs: {}, C_metrics: {} }
    };
    next.calculation_metadata = {
      ...next.calculation_metadata,
      source_mode: "replay",
      replay_clock: payload.calculation_metadata?.replay_clock || payload.generated_at,
      direction_source: "unavailable",
      price_is_corroboration_only: true,
      abc_indicators_kept_separate: true
    };
  }
  assertNoCompositeScore(next);
  return next;
}

export function analyzeReplayFixture(fixture, { policy = {}, laneRegistry = {}, universe = {}, mode = "single_ticker" } = {}) {
  const engineInputs = fixture.engine_inputs || {};
  const clock = createReplayClock(engineInputs.replay_clock || fixture.calculation_metadata?.replay_clock || fixture.generated_at);
  const profiles = loadUniverseProfiles(universe, [{ ticker: fixture.ticker, ...(fixture.profile || {}) }]);
  const profile = profiles.find((row) => row.ticker === fixture.ticker) || {
    ticker: fixture.ticker,
    ...(fixture.profile || {})
  };
  const baseline = buildBaseline({
    ticker: fixture.ticker,
    historicalSessions: engineInputs.historical_sessions || [],
    clock
  });
  const normalized = normalizeTradePrints(engineInputs.prints || fixture.raw_prints?.prints || [], policy);
  const signing = signTradePrints(normalized, engineInputs.price_context || {});
  const blocks = detectBlockTrf(signing, { profile, baseline });
  const components = computeSignalComponents({ baseline, signed: signing, blocks });
  const indicators = computeAbcIndicators({ mode, components });
  const laneStates = buildLaneStates(laneRegistry.lanes || laneRegistry || [], fixture.lane_states || [], clock);
  const classifier = classifyTier({
    mode,
    indicators,
    laneStates,
    corroboration: fixture.corroboration || {},
    signing
  });

  return {
    clock,
    profile,
    baseline,
    normalized,
    signing,
    blocks,
    components,
    indicators,
    lane_states: laneStates,
    classifier
  };
}

function buildReplayPayload(fixture, context) {
  if (!fixture.engine_inputs) {
    return clone(fixture);
  }
  const analysis = analyzeReplayFixture(fixture, context);
  const basePayload = clone(fixture);
  delete basePayload.engine_inputs;
  const payload = {
    ...basePayload,
    generated_at: analysis.clock.iso(),
    tier: analysis.classifier.tier,
    direction: analysis.classifier.direction,
    signing_confidence: analysis.signing.signing_confidence,
    indicators: analysis.indicators,
    lane_states: analysis.lane_states,
    explain_tier: analysis.classifier.explain_tier,
    raw_prints: {
      ticker: fixture.ticker,
      policy_version: analysis.normalized.policy_version,
      truncated: false,
      normalization_summary: analysis.normalized.summary,
      top_raw_print_refs: analysis.blocks.top_raw_print_refs,
      prints: analysis.signing.prints.map((print) => ({
        id: print.id,
        ts: print.ts,
        venue: print.venue,
        price: print.price,
        size: print.size,
        notional: print.notional,
        signed_side: print.signed_side,
        signing_method: print.signing_method,
        condition_codes: print.condition_codes,
        policy_action: print.policy_action,
        flags: print.flags,
        excluded_from: print.excluded_from
      }))
    },
    engine_diagnostics: {
      profile: analysis.profile,
      baseline: analysis.baseline,
      normalization_summary: analysis.normalized.summary,
      block_trf: analysis.blocks,
      signal_components: analysis.components
    },
    calculation_metadata: {
      ...(fixture.calculation_metadata || {}),
      ...analysis.clock.metadata(),
      engine_version: "uta_engine_v1",
      direction_source: "signed_flow",
      price_is_corroboration_only: true,
      condition_code_policy_version: analysis.normalized.policy_version,
      baseline_window_days: analysis.baseline.window_sessions,
      baseline_earnings_excluded: analysis.baseline.earnings_excluded_count,
      baseline_state: analysis.baseline.state,
      no_lookahead_verified: analysis.baseline.no_lookahead_verified,
      abc_indicators_kept_separate: true
    }
  };
  assertNoCompositeScore(payload);
  return payload;
}

export function createUtaService({ config, store } = {}) {
  const paths = fixturePaths(config);
  let singleFixture = null;
  let universeFixture = null;
  let laneRegistry = null;
  let conditionPolicy = null;
  const state = ensureUtaStoreState(store);

  function getSingleFixture() {
    singleFixture ||= readJson(paths.single);
    return singleFixture;
  }

  function getUniverseFixture() {
    universeFixture ||= readJson(paths.universe);
    return universeFixture;
  }

  function getLaneRegistry() {
    laneRegistry ||= readJson(paths.lanes);
    return laneRegistry;
  }

  function getConditionPolicy() {
    conditionPolicy ||= readJson(paths.policy);
    return conditionPolicy;
  }

  function getReplayPayload(mode = "single_ticker") {
    return buildReplayPayload(getSingleFixture(), {
      mode,
      policy: getConditionPolicy(),
      laneRegistry: getLaneRegistry(),
      universe: getUniverseFixture()
    });
  }

  function emit(type, payload) {
    store?.bus?.emit("event", {
      type,
      timestamp: nowIso(),
      payload
    });
  }

  function rememberAudit(action, payload = {}) {
    const entry = {
      id: `uta-audit-${stableCycleStamp(nowIso())}-${state.auditLog.length + 1}`,
      at: nowIso(),
      action,
      payload
    };
    state.auditLog = [entry, ...state.auditLog].slice(0, UTA_AUDIT_LIMIT);
    return entry;
  }

  function rememberSignal(payload, { mode = payload.mode || "single_ticker", universe = null, replayMode = true } = {}) {
    const row = {
      id: `${payload.cycle_id || `uta-cycle-${stableCycleStamp(payload.generated_at)}`}:${payload.ticker || mode}`,
      ticker: payload.ticker || null,
      cycle_id: payload.cycle_id || null,
      mode,
      universe,
      as_of: payload.generated_at || nowIso(),
      schema_version: payload.schema_version || null,
      tier: payload.tier || null,
      direction: payload.direction || null,
      replay_mode: replayMode,
      payload
    };
    state.signalResults = [row, ...state.signalResults.filter((item) => item.id !== row.id)].slice(0, UTA_HISTORY_LIMIT);
    return row;
  }

  function rememberLaneStates(lanes = [], asOf = nowIso()) {
    state.laneStates = lanes.map((lane) => ({ ...clone(lane), observed_at: asOf }));
    return state.laneStates;
  }

  function buildCycle({ mode, tickers = ["AVGO"], query = {}, body = {}, reason = "manual" } = {}) {
    const startedAt = nowIso();
    const cycleId = `uta-${mode || "cycle"}-${stableCycleStamp(startedAt)}`;
    let result;
    const events = [];
    try {
      if (mode === "single") {
        const ticker = tickers[0] || body.ticker || query.ticker || "AVGO";
        const single = getSingleAnalysis(ticker);
        result = { status: single.status, payload: { ...single.payload, cycle_id: cycleId } };
        rememberSignal(result.payload, { mode: "single_ticker", replayMode: true });
        events.push({ type: "uta_signal_result", payload: result.payload });
      } else if (mode === "portfolio") {
        const portfolio = getPortfolioAnalysis({ ...body, tickers });
        result = { status: 200, payload: { ...portfolio, cycle_id: cycleId } };
        for (const row of result.payload.results || []) {
          rememberSignal({ ...row, cycle_id: cycleId }, { mode: "portfolio", replayMode: true });
        }
        events.push({ type: "uta_signal_result", payload: result.payload });
      } else if (mode === "scan_pass2") {
        const scan = runScanPass2(body);
        result = { status: 200, payload: { ...scan, cycle_id: cycleId } };
        for (const row of scan.results || []) {
          if (row.result) {
            rememberSignal({ ...row.result, cycle_id: cycleId }, { mode: "scan", universe: scan.universe, replayMode: true });
          }
        }
        events.push({ type: "uta_scan_progress", payload: result.payload });
      } else {
        const scan = getScan(query);
        result = { status: 200, payload: { ...scan, cycle_id: cycleId } };
        events.push({ type: "uta_scan_progress", payload: result.payload });
      }

      const laneState = getLaneStates();
      rememberLaneStates(laneState.lanes, laneState.generated_at);
      events.push({ type: "uta_lane_state", payload: laneState });
      const completedAt = nowIso();
      const run = {
        run_id: cycleId,
        mode,
        reason,
        status: "completed",
        started_at: startedAt,
        completed_at: completedAt,
        replay_clock: getReplayPayload("single_ticker").calculation_metadata?.replay_clock || null,
        tickers,
        result_summary: {
          status: result.status,
          tier: result.payload?.tier || null,
          result_count: result.payload?.results?.length || (result.payload?.ticker ? 1 : 0)
        }
      };
      state.replayRuns = [run, ...state.replayRuns].slice(0, UTA_REPLAY_RUN_LIMIT);
      state.lastCycle = run;
      state.scheduler = {
        ...state.scheduler,
        last_run_at: completedAt,
        next_run_at: state.scheduler.enabled ? new Date(Date.now() + 300_000).toISOString() : null
      };
      if (store?.health?.liveSources) {
        store.health.liveSources.uta = {
          status: "ready",
          provider: "replay_first_node",
          last_success_at: completedAt,
          last_poll_at: completedAt,
          mode,
          cycle_id: cycleId,
          lane_pressure: {
            required_not_ready: laneState.lanes.filter((lane) => lane.required && lane.state !== "ready").length,
            optional_disabled: laneState.lanes.filter((lane) => !lane.required && lane.state === "disabled").length
          }
        };
      }
      rememberAudit("cycle_completed", { cycle_id: cycleId, mode, reason });
      for (const event of events) {
        emit(event.type, { ...event.payload, cycle_id: cycleId });
      }
      return {
        ...result,
        cycle: run
      };
    } catch (error) {
      const failed = {
        run_id: cycleId,
        mode,
        reason,
        status: "failed",
        started_at: startedAt,
        completed_at: nowIso(),
        error: error.message,
        tickers
      };
      state.replayRuns = [failed, ...state.replayRuns].slice(0, UTA_REPLAY_RUN_LIMIT);
      state.lastCycle = failed;
      if (store?.health?.liveSources) {
        store.health.liveSources.uta = {
          status: "error",
          provider: "replay_first_node",
          last_poll_at: failed.completed_at,
          last_error: error.message,
          mode,
          cycle_id: cycleId
        };
      }
      rememberAudit("cycle_failed", failed);
      emit("uta_lane_state", {
        cycle_id: cycleId,
        state: "failed",
        operator_copy: `UTA cycle failed: ${error.message}`
      });
      return {
        status: 500,
        payload: { ok: false, error: "uta_cycle_failed", detail: error.message },
        cycle: failed
      };
    }
  }

  function getSingleAnalysis(tickerValue) {
    const ticker = normalizeTickerSymbol(tickerValue);
    if (!ticker) {
      return { status: 400, payload: { ok: false, error: "invalid_ticker", detail: "Ticker must be an uppercase market symbol." } };
    }
    const payload = applyTickerOverride(getReplayPayload("single_ticker"), ticker);
    return { status: payload.tier === "D" && ticker !== getSingleFixture().ticker ? 404 : 200, payload };
  }

  function getUniverses() {
    const universe = getUniverseFixture();
    return {
      schema_version: "uta.universes.v1",
      generated_at: new Date().toISOString(),
      universes: [
        {
          universe_id: universe.universe_id,
          name: universe.name,
          label: universe.label,
          category: universe.category,
          ticker_count: universe.tickers.length,
          last_updated: universe.last_updated,
          source: universe.source,
          performance_tier: universe.performance_tier,
          estimated_time_seconds: universe.estimated_time_seconds
        }
      ]
    };
  }

  function getLaneStates() {
    const fixture = getReplayPayload("single_ticker");
    const fixtureStates = new Map(fixture.lane_states.map((lane) => [lane.lane_id, lane]));
    const providerStates = new Map(
      getProviderStatus().provider_lanes.map((provider) => [provider.lane_id, provider])
    );
    return {
      schema_version: "uta.lane_states.v1",
      generated_at: fixture.generated_at,
      lanes: getLaneRegistry().lanes.map((lane) => {
        const current = fixtureStates.get(lane.lane_id);
        const provider_status = providerStates.get(lane.lane_id) || null;
        return current ? { ...current, provider_status } : {
          lane_id: lane.lane_id,
          label: lane.label,
          state: lane.required ? "unavailable" : "disabled",
          required: lane.required,
          tier_effect: lane.required ? lane.tier_effect_when_missing : "none",
          coverage: null,
          latest_as_of: null,
          freshness_seconds: null,
          freshness_sla_seconds: lane.freshness_sla_seconds,
          operator_copy: lane.required
            ? `${lane.label} is unavailable in the replay slice. No live signal is fabricated.`
            : `${lane.label} is optional or disabled and does not penalize tiers.`,
          next_action: { label: `Refresh ${lane.label}`, route: lane.refresh_route },
          provider_status
        };
      })
    };
  }

  function refreshLane(laneId) {
    const states = getLaneStates();
    const lane = states.lanes.find((item) => item.lane_id === laneId);
    if (!lane) {
      return { status: 404, payload: { ok: false, error: "lane_not_found", detail: `Unknown UTA lane: ${laneId}` } };
    }
    const payload = {
      ok: true,
      refreshed: false,
      mode: "replay",
      message: "Replay lanes are deterministic; refresh reports current fixture state.",
      lane
    };
    rememberLaneStates(states.lanes, states.generated_at);
    rememberAudit("lane_refresh_requested", { lane_id: laneId, refreshed: false, mode: "replay" });
    emit("uta_lane_state", payload);
    return { status: 200, payload };
  }

  function getPortfolioAnalysis(payload = {}) {
    const tickers = Array.isArray(payload.tickers) && payload.tickers.length ? payload.tickers : ["AVGO"];
    const results = tickers.map((ticker) => getSingleAnalysis(ticker).payload);
    return {
      schema_version: "uta.portfolio.v1",
      mode: "portfolio",
      generated_at: new Date().toISOString(),
      data_state: "replay",
      portfolio_ticker_count: tickers.length,
      results: results.map((row) => ({
        ...row,
        mode: "portfolio",
        indicators: {
          ...row.indicators,
          A: row.tier === "D" ? null : {
            volume_percentile: 0.92,
            focus_notional_share_percentile: 0.88,
            net_notional_pressure_percentile: 0.9,
            scope_label: "relative to your portfolio today"
          }
        }
      }))
    };
  }

  function getScan(query = {}) {
    const universe = getUniverseFixture();
    const direction = String(query.direction || "bullish").toLowerCase();
    const pass = Number(query.pass || 1);
    const single = getReplayPayload("scan");
    return {
      schema_version: "uta.scan_result.v1",
      mode: "scan",
      universe: universe.universe_id,
      universe_label: universe.label,
      universe_ticker_count: universe.tickers.length,
      direction_filter: direction,
      pass,
      generated_at: new Date().toISOString(),
      performance_tier: universe.performance_tier,
      shortlist_count: 1,
      results: [
        {
          ticker: single.ticker,
          preliminary_tier: single.tier,
          B_estimate: { volume_zscore_from_bars: single.indicators.B.volume_zscore },
          C_screen: 12.4,
          pass2_status: pass === 1 ? "pending" : "resolved",
          label: pass === 1 ? "Preliminary - live data loading" : "Resolved from replay fixture"
        }
      ]
    };
  }

  function runScanPass2(payload = {}) {
    const shortlist = Array.isArray(payload.shortlist) && payload.shortlist.length ? payload.shortlist : ["AVGO"];
    return {
      ...getScan({ universe: payload.universe || "sp500", direction: payload.direction || "bullish", pass: 2 }),
      results: shortlist.map((ticker) => ({
        ticker: normalizeTickerSymbol(ticker),
        status: "resolved",
        result: getSingleAnalysis(ticker).payload
      }))
    };
  }

  function getUserState(scope = "") {
    return {
      scope: scope || "all",
      state: clone(state.userState)
    };
  }

  function updateUserState(scope = "", updates = {}) {
    const allowed = new Set(["watchlist", "reviewed", "ignored", "rules", "saved_scans", "settings"]);
    const beforeSignalCount = state.signalResults.length;
    for (const [key, value] of Object.entries(updates || {})) {
      if (allowed.has(key)) {
        state.userState[key] = value;
      }
    }
    state.userState.schema_version = USER_STATE_VERSION;
    state.userState.updated_at = nowIso();
    rememberAudit("user_state_updated", {
      scope: scope || "all",
      updated_keys: Object.keys(updates || {}).filter((key) => allowed.has(key)),
      historical_signal_rows_preserved: beforeSignalCount === state.signalResults.length
    });
    return getUserState(scope);
  }

  function getHistory({ ticker = "", mode = "", limit = 50 } = {}) {
    const normalizedTicker = ticker ? normalizeTickerSymbol(ticker) : "";
    const maxRows = Math.max(1, Math.min(250, Number(limit || 50)));
    const rows = state.signalResults
      .filter((row) => !normalizedTicker || row.ticker === normalizedTicker)
      .filter((row) => !mode || row.mode === mode)
      .slice(0, maxRows);
    return {
      schema_version: "uta.history.v1",
      generated_at: nowIso(),
      filters: {
        ticker: normalizedTicker || null,
        mode: mode || null,
        limit: maxRows
      },
      rows: clone(rows),
      replay_runs: clone(state.replayRuns.slice(0, 20)),
      audit_log: clone(state.auditLog.slice(0, 20))
    };
  }

  function getRuntimeStatus() {
    const laneStates = getLaneStates();
    return {
      schema_version: "uta.runtime_status.v1",
      generated_at: nowIso(),
      mode: "replay_first",
      provider_status: getProviderStatus(),
      scheduler: clone(state.scheduler),
      last_cycle: clone(state.lastCycle),
      signal_result_count: state.signalResults.length,
      replay_run_count: state.replayRuns.length,
      lane_pressure: {
        total: laneStates.lanes.length,
        required_not_ready: laneStates.lanes.filter((lane) => lane.required && lane.state !== "ready").length,
        optional_disabled: laneStates.lanes.filter((lane) => !lane.required && lane.state === "disabled").length
      },
      pi_policy: {
        auto_start_heavy_jobs: false,
        api_saver_blocks_heavy_autostart: Boolean(config.apiSaverMode || config.piPerformanceMode),
        storage: config.databaseEnabled ? config.databaseProvider : config.lightweightStateEnabled ? "lightweight_json" : "memory"
      },
      next_actions: [
        { action: "run_single", label: "Run replay-backed single ticker cycle", safe: true },
        { action: "run_scan_pass1", label: "Run replay-backed scan pass 1", safe: true },
        { action: "run_scan_pass2", label: "Resolve scan pass 2", safe: true }
      ]
    };
  }

  function getScheduler() {
    return {
      schema_version: "uta.scheduler.v1",
      generated_at: nowIso(),
      scheduler: clone(state.scheduler),
      policy: "Pi v1 keeps UTA scheduled jobs manual/dry-run until live providers and validation gates pass."
    };
  }

  function updateScheduler(updates = {}) {
    const enabled = Boolean(updates.enabled);
    state.scheduler = {
      ...state.scheduler,
      enabled,
      mode: enabled ? "dry_run" : "manual",
      updated_at: nowIso(),
      next_run_at: enabled ? new Date(Date.now() + 300_000).toISOString() : null,
      jobs: Array.isArray(updates.jobs) ? updates.jobs : state.scheduler.jobs
    };
    rememberAudit("scheduler_updated", {
      enabled: state.scheduler.enabled,
      mode: state.scheduler.mode,
      next_run_at: state.scheduler.next_run_at
    });
    return getScheduler();
  }

  function revalidate(payload = {}) {
    const ticker = normalizeTickerSymbol(payload.ticker || "AVGO");
    const result = buildCycle({ mode: "single", tickers: [ticker], reason: "manual_revalidation" });
    emit("uta_revalidation", {
      ticker,
      cycle_id: result.cycle?.run_id || null,
      status: result.cycle?.status || "unknown",
      tier: result.payload?.tier || null
    });
    return result;
  }

  function getProviderStatus() {
    return {
      ...buildProviderReadiness(config, getLaneRegistry().lanes),
      replay_available: existsSync(paths.single)
    };
  }

  function runProviderPreflight(payload = {}) {
    const startedAt = nowIso();
    const ticker = normalizeTickerSymbol(payload.ticker || "AVGO") || "AVGO";
    const probeLive = Boolean(payload.probe_live || payload.live_probe);
    const before = {
      signal_results: state.signalResults.length,
      replay_runs: state.replayRuns.length,
      lane_states: state.laneStates.length,
      audit_log: state.auditLog.length,
      scheduler_mode: state.scheduler.mode
    };
    const providerStatus = getProviderStatus();
    const checks = providerStatus.provider_lanes.map((provider) => {
      const stateName = provider.configured ? "configured" : "missing_key";
      const sampleAttempted = false;
      return {
        id: `${provider.lane_id}:${provider.provider_family}`,
        lane_id: provider.lane_id,
        label: provider.label,
        required: provider.required,
        provider_family: provider.provider_family,
        provider: provider.provider,
        enabled: provider.enabled,
        configured: provider.configured,
        state: stateName,
        sample_attempted: sampleAttempted,
        sample_ticker: ticker,
        sample_count: null,
        rate_limit_observed: false,
        mutation_allowed: false,
        trading_effect: "none",
        tier_effect_if_missing: provider.tier_effect_when_unavailable,
        operator_copy: provider.configured
          ? "Provider is configured. Live sample probing remains disabled unless explicitly requested in a future manual probe."
          : provider.operator_copy
      };
    });
    const after = {
      signal_results: state.signalResults.length,
      replay_runs: state.replayRuns.length,
      lane_states: state.laneStates.length,
      audit_log: state.auditLog.length,
      scheduler_mode: state.scheduler.mode
    };
    return {
      schema_version: "uta.provider_preflight.v1",
      generated_at: nowIso(),
      started_at: startedAt,
      completed_at: nowIso(),
      ticker,
      mode: "manual_preflight",
      probe_live: probeLive,
      live_probe_status: probeLive
        ? "not_implemented_in_safe_slice"
        : "not_requested",
      ok: true,
      live_ready: false,
      provider_status: providerStatus,
      checks,
      summary: {
        total: checks.length,
        required_total: checks.filter((check) => check.required).length,
        required_missing: checks.filter((check) => check.required && check.state !== "configured" && check.state !== "sample_ok").length,
        by_state: countBy(checks, "state"),
        sample_attempts: checks.filter((check) => check.sample_attempted).length,
        trading_effect: "none"
      },
      mutation_guard: {
        historical_signal_results_preserved: before.signal_results === after.signal_results,
        replay_runs_preserved: before.replay_runs === after.replay_runs,
        lane_states_preserved: before.lane_states === after.lane_states,
        audit_log_preserved: before.audit_log === after.audit_log,
        scheduler_mode_preserved: before.scheduler_mode === after.scheduler_mode,
        before,
        after
      },
      next_actions: [
        {
          action: "configure_required_providers",
          label: "Configure trade prints and market bars before live UTA mode",
          required: true
        },
        {
          action: "manual_live_sample_probe",
          label: "Add explicit one-ticker live sample probes after credentials are present",
          required: true
        }
      ],
      safeguards: [
        "Preflight does not write signal results.",
        "Preflight does not refresh lanes or mutate lane history.",
        "Preflight does not change scheduler mode.",
        "Preflight has no paper-trading effect."
      ]
    };
  }

  function getSupportingEvidenceForTickers(tickers = []) {
    const uniqueTickers = [...new Set((tickers || []).map(normalizeTickerSymbol).filter(Boolean))];
    return Object.fromEntries(
      uniqueTickers.map((ticker) => {
        const result = getSingleAnalysis(ticker);
        const payload = result.status === 200 ? result.payload : null;
        return [
          ticker,
          payload && payload.tier !== "D"
            ? {
                ticker: payload.ticker,
                tier: payload.tier,
                direction: payload.direction,
                generated_at: payload.generated_at,
                bluf: payload.bluf,
                indicators: payload.indicators,
                explain_tier: payload.explain_tier,
                calculation_metadata: payload.calculation_metadata,
                role: "supporting_evidence_only",
                trading_effect: "none"
              }
            : null
        ];
      })
    );
  }

  return {
    runCycle: buildCycle,
    revalidate,
    getSingleAnalysis,
    getPortfolioAnalysis,
    getScan,
    runScanPass2,
    getUniverses,
    getLaneStates,
    refreshLane,
    getUserState,
    updateUserState,
    getHistory,
    getRuntimeStatus,
    getScheduler,
    updateScheduler,
    getProviderStatus,
    runProviderPreflight,
    getSupportingEvidenceForTickers,
    getReplayFixture: () => clone(getReplayPayload("single_ticker")),
    analyzeReplayFixture: () => clone(analyzeReplayFixture(getSingleFixture(), {
      policy: getConditionPolicy(),
      laneRegistry: getLaneRegistry(),
      universe: getUniverseFixture()
    }))
  };
}
