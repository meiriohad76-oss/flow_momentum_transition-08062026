import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeTickerSymbol } from "../utils/helpers.js";

const USER_STATE_VERSION = "uta.user_state.v1";
const UTA_HISTORY_LIMIT = 250;
const UTA_AUDIT_LIMIT = 200;
const UTA_REPLAY_RUN_LIMIT = 50;

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
    Number(netNotionalPressure) >= 0.6 ? "bullish" : Number(netNotionalPressure) <= -0.6 ? "bearish" : "neutral";

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
    lane.required &&
    ["loading", "failed", "unavailable"].includes(String(lane.state || "").toLowerCase()) &&
    String(lane.tier_effect || "").toLowerCase() !== "cap_at_c"
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
  const b = indicators.B || {};
  const bValues = Object.values(b).map(Number).filter(Number.isFinite);
  const c = indicators.C || {};
  const maxB = bValues.length ? Math.max(...bValues) : null;
  const direction = signing.direction || "undetermined";
  const signedPressure = Number(c.net_notional_pressure ?? signing.net_notional_pressure ?? 0);
  const signingConfidence = Number(signing.signing_confidence || 0);
  const directionPresent = ["bullish", "bearish"].includes(direction) && Math.abs(signedPressure) >= 0.6 && signingConfidence >= 0.5;
  const blockPressureSameSide =
    !Number.isFinite(Number(c.net_volume_pressure)) ||
    Number(c.net_volume_pressure || 0) === 0 ||
    Math.sign(Number(c.net_volume_pressure || 0)) === Math.sign(signedPressure);
  const directionConsistent = directionPresent && blockPressureSameSide;
  const bCoreValues = [
    Number(b.volume_zscore),
    Number(b.notional_zscore),
    Number(b.focus_notional_share_zscore),
    Math.abs(Number(b.net_notional_pressure_zscore))
  ].filter(Number.isFinite);
  const bExtremeCount = bCoreValues.filter((value) => value >= 2.5).length;
  const bElevatedCount = bCoreValues.filter((value) => value >= 1.5).length;
  const cActivityDetected =
    Number(c.notional_ratio || 0) >= 1.5 ||
    Number(c.volume_ratio || 0) >= 1.5 ||
    Number(c.focus_notional_share || 0) >= 0.1 ||
    Number(c.focus_trade_count || 0) >= 1 ||
    Math.abs(signedPressure) >= 0.35;
  const cExtreme =
    Number(c.notional_ratio || 0) >= 3 ||
    Number(c.volume_ratio || 0) >= 3 ||
    Number(c.focus_notional_share || 0) >= 0.25 ||
    Number(c.focus_trade_count || 0) >= 2 ||
    Math.abs(signedPressure) >= 0.6;
  const bExtreme = bExtremeCount >= 2;
  const bElevated = bElevatedCount >= 1;
  const a = indicators.A || null;
  const aValues = a ? [a.volume_percentile, a.focus_notional_share_percentile, a.net_notional_pressure_percentile].map(Number).filter(Number.isFinite) : [];
  const aExtreme = mode === "single_ticker" ? true : aValues.filter((value) => value >= 0.85).length >= 2;
  const aElevated = mode === "single_ticker" ? true : aValues.filter((value) => value >= 0.7).length >= 1;
  const corroborationCount = Number(corroboration.independent_confirmation_count || 0);
  const hasCorroboration = corroborationCount >= 1 || Boolean(corroboration.provider_alert_confirmed);

  let tier = "D";
  let state = "suppressed";
  if (requiredProblem || staleSuppressingProblem || !bValues.length || Object.keys(c).length === 0) {
    tier = "D";
    state = requiredProblem || staleSuppressingProblem ? "required_lane_not_ready" : "insufficient_indicators";
  } else if (bExtreme && aExtreme && cExtreme && directionConsistent && hasCorroboration) {
    tier = "A";
    state = "actionable";
  } else if (bElevated && aElevated && directionPresent) {
    tier = "B";
    state = "review";
  } else if (cActivityDetected || bElevated || cExtreme) {
    tier = "C";
    state = directionPresent ? "watch" : "context_only";
  }
  if (capProblem) {
    tier = capTier(tier, "C");
    state = "capped_partial_coverage";
  }

  const verdict = `Tier ${tier}`;
  return {
    tier,
    direction,
    classification_state: state,
    capped: Boolean(capProblem && tier === "C"),
    suppressed: tier === "D" && Boolean(requiredProblem || staleSuppressingProblem),
    explain_tier: {
      mode,
      rule_set: mode === "single_ticker" ? "single_ticker_b_plus_c" : "portfolio_or_scan_abc",
      verdict,
      rules: [
        {
          id: "b_actionable_gate",
          label: "Tier A gate: B >= 2.5 sigma on at least two core components",
          passed: bExtreme,
          actual: Number.isFinite(maxB) ? `${bExtremeCount} components; ${roundNumber(maxB, 2)} sigma max` : "No B values"
        },
        {
          id: "b_review_gate",
          label: "Tier B gate: B >= 1.5 sigma on at least one component",
          passed: bElevated,
          actual: `${bElevatedCount} components`
        },
        {
          id: "a_peer_gate",
          label: mode === "single_ticker" ? "A peer percentile skipped in single ticker mode" : "A peer percentile clears the portfolio/scan gate",
          passed: mode === "single_ticker" ? true : aElevated,
          actual: mode === "single_ticker" ? "A = N/A by design" : `${aValues.filter((value) => value >= 0.7).length} components >= 70th percentile`
        },
        {
          id: "c_activity_gate",
          label: "C raw metrics show activity magnitude",
          passed: cExtreme,
          actual: `${roundNumber(c.notional_ratio, 2) ?? "N/A"}x notional, ${roundNumber(c.volume_ratio, 2) ?? "N/A"}x volume, ${c.focus_trade_count ?? 0} focus prints`
        },
        {
          id: "direction_signed_flow_gate",
          label: "Direction from signed flow clears the +/-60% gate with adequate confidence",
          passed: directionConsistent,
          actual: `${roundNumber(signedPressure * 100, 1)}% signed notional pressure; ${roundNumber(signingConfidence * 100, 0)}% signing confidence`
        },
        {
          id: "independent_corroboration",
          label: "Tier A requires at least one independent strong corroboration",
          passed: hasCorroboration,
          actual: `${corroborationCount} confirmations`
        },
        {
          id: "required_lanes_ready",
          label: "Required lanes are ready enough for this tier",
          passed: !requiredProblem && !staleSuppressingProblem,
          actual: requiredProblem?.operator_copy || staleSuppressingProblem?.operator_copy || capProblem?.operator_copy || "Required lanes ready"
        }
      ],
      gap_to_next_tier:
        tier === "A"
          ? []
          : [
              !bExtreme ? "Needs B >= 2.5 sigma on at least two core components for Tier A." : null,
              mode !== "single_ticker" && !aExtreme ? "Needs A >= 85th percentile on at least two peer components for Tier A." : null,
              !cExtreme ? "Needs stronger raw C magnitude: notional/volume/focus/pressure." : null,
              !directionConsistent ? "Needs signed-flow direction >= 60% with adequate confidence." : null,
              !hasCorroboration ? "Needs independent strong corroboration for Tier A." : null
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
    if (name === "MASSIVE_API_KEY") {
      return Boolean(config.massiveApiKey);
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
  const tradePrintCredential = providerCredential(config, ["TRADE_PRINTS_API_KEY", "MASSIVE_API_KEY", "POLYGON_API_KEY", "IEX_API_KEY"]);
  const marketProvider = config.marketDataProvider || "synthetic";
  const marketConfigured = marketProvider === "massive" ? Boolean(config.massiveApiKey || config.polygonApiKey) : marketProvider !== "synthetic";
  const earningsCredential = providerCredential(config, ["EARNINGS_API_KEY"]);
  const stocktwitsCredential = providerCredential(config, ["STOCKTWITS_API_KEY"]);
  const piBlocksHeavyAutoStart = Boolean(config.apiSaverMode || config.piPerformanceMode);

  const specs = [
    {
      lane_id: "massive_live_trade_slices",
      provider_family: "trade_prints",
      provider: config.tradePrintsProvider || "massive",
      enabled: Boolean(config.tradePrintsEnabled),
      credential: tradePrintCredential,
      fallback_state: "unavailable",
      operator_copy_ready: "Live trade-print adapter is configured; keep polling manual until validation is accepted.",
      operator_copy_missing: "Live trade-print adapter is not configured; required flow lanes remain unavailable and no synthetic signal is fabricated."
    },
    {
      lane_id: "massive_premarket_trade_slices",
      provider_family: "trade_prints",
      provider: config.tradePrintsProvider || "massive",
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
      enabled: marketProvider !== "synthetic",
      credential: { env_names: ["MARKET_DATA_PROVIDER", "MASSIVE_API_KEY", "POLYGON_API_KEY"], configured: marketConfigured },
      fallback_state: marketConfigured ? "stale" : "unavailable",
      operator_copy_ready: "Market-data bars provider is configured for manual baseline and trend validation.",
      operator_copy_missing: "Daily bars need a non-synthetic market-data provider before live baselines can be trusted."
    },
    {
      lane_id: "massive_block_trade_feed",
      provider_family: "derived_trade_prints",
      provider: config.tradePrintsProvider || "massive",
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
        ? { action: "manual_revalidate", label: "Run manual live provider check" }
        : { action: "configure_provider", label: `Configure ${spec.provider_family}` }
    };
  });

  const required = providerLanes.filter((lane) => lane.required);
  const optional = providerLanes.filter((lane) => !lane.required);
  return {
    schema_version: "uta.provider_status.v1",
    generated_at: nowIso(),
    source: "docs/uta-provider-adapter-matrix.md",
    mode: "live_only",
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
      "Live providers are the only source for UTA signal results.",
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

function massiveApiKey(config = {}) {
  return config.massiveApiKey || config.tradePrintsApiKey || config.polygonApiKey || "";
}

function massiveBaseUrl(config = {}, provider = "massive") {
  return String(
    provider === "polygon"
      ? config.massiveCompatBaseUrl || "https://api.polygon.io"
      : config.massiveBaseUrl || "https://api.massive.com"
  ).replace(/\/+$/, "");
}

function intervalToMassiveRange(interval = "1day") {
  const normalized = String(interval || "1day").trim().toLowerCase();
  const match = normalized.match(/^(\d+)\s*(m|min|minute|minutes|h|hr|hour|hours|d|day|days)$/);
  const multiplier = Math.max(1, Number(match?.[1] || 1));
  const unit = match?.[2] || "day";
  const timespan = ["m", "min", "minute", "minutes"].includes(unit)
    ? "minute"
    : ["h", "hr", "hour", "hours"].includes(unit)
      ? "hour"
      : "day";
  return { multiplier, timespan };
}

function dateDaysAgo(days) {
  return new Date(Date.now() - Math.max(1, Number(days || 1)) * 86_400_000).toISOString().slice(0, 10);
}

function recentCalendarDates(days = 32) {
  const dates = [];
  const today = new Date();
  for (let index = 0; index < Math.max(1, Number(days || 1)); index += 1) {
    const date = new Date(today.getTime() - index * 86_400_000);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(date.toISOString().slice(0, 10));
    }
  }
  return dates.reverse();
}

function parseTickerList(value, fallback = []) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[,\s]+/);
  const tickers = source
    .map(normalizeTickerSymbol)
    .filter(Boolean);
  return [...new Set(tickers.length ? tickers : fallback.map(normalizeTickerSymbol).filter(Boolean))];
}

function htmlDecode(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(value = "") {
  return htmlDecode(String(value).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function parseSp500ConstituentsHtml(html = "") {
  const tableMatch = String(html).match(/<table[^>]+id=["']constituents["'][\s\S]*?<\/table>/i);
  const table = tableMatch ? tableMatch[0] : String(html);
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const tickers = [];
  for (const rowMatch of rows) {
    const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => stripHtml(cell[1]));
    if (cells.length < 2 || /^symbol$/i.test(cells[0])) {
      continue;
    }
    const symbol = normalizeTickerSymbol(cells[0].replace(".", "."));
    if (!symbol || !/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) {
      continue;
    }
    tickers.push({
      symbol,
      name: cells[1] || symbol,
      sector: cells[2] || null,
      exchange: null
    });
  }
  return [...new Map(tickers.map((row) => [row.symbol, row])).values()];
}

async function fetchText(url, { timeoutMs = 12000, provider = "uta_universe" } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/json",
        "User-Agent": `SentimentAnalyst/1.0 (+${provider})`
      }
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`${provider} ${response.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
      error.status = response.status;
      throw error;
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeLiveUniversePayload(payload = {}, fallback = {}) {
  const tickers = Array.isArray(payload.tickers) ? payload.tickers : [];
  return {
    universe_id: payload.universe_id || fallback.universe_id || "sp500",
    name: payload.name || fallback.name || "sp500",
    label: payload.label || fallback.label || "S&P 500 live universe",
    category: payload.category || fallback.category || "index",
    source: payload.source || fallback.source || "live_cache",
    last_updated: payload.last_updated || fallback.last_updated || nowIso(),
    performance_tier: payload.performance_tier || fallback.performance_tier || "pi_bounded_full",
    estimated_time_seconds: Number(payload.estimated_time_seconds || fallback.estimated_time_seconds || 240),
    tickers: tickers.map((row) => ({
      symbol: normalizeTickerSymbol(row.symbol || row.ticker),
      name: row.name || row.security || row.symbol || row.ticker,
      sector: row.sector || row.gics_sector || null,
      exchange: row.exchange || null
    })).filter((row) => row.symbol)
  };
}

function readCachedLiveUniverse(cachePath) {
  if (!cachePath || !existsSync(cachePath)) {
    return null;
  }
  try {
    return normalizeLiveUniversePayload(readJson(cachePath));
  } catch {
    return null;
  }
}

async function loadLiveSp500Universe(config = {}, fallbackUniverse = {}) {
  const cachePath = config.utaSp500UniverseCachePath;
  const cacheTtlMs = Math.max(0, Number(config.utaSp500UniverseCacheMs || 0));
  const cached = readCachedLiveUniverse(cachePath);
  const cachedMs = cached?.last_updated ? new Date(cached.last_updated).getTime() : 0;
  const freshCache = cached && cached.tickers.length >= 450 && cacheTtlMs > 0 && Date.now() - cachedMs < cacheTtlMs;
  if (freshCache) {
    return { ...cached, source: cached.source || "cached_sp500_constituents", cache_state: "fresh" };
  }

  try {
    const html = await fetchText(config.utaSp500UniverseUrl || "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies", {
      timeoutMs: Math.min(15000, Math.max(2000, Number(config.providerRequestTimeoutMs || 12000))),
      provider: "uta_sp500_universe"
    });
    const tickers = parseSp500ConstituentsHtml(html);
    if (tickers.length < 450) {
      throw new Error(`S&P 500 universe parse returned only ${tickers.length} tickers.`);
    }
    const universe = normalizeLiveUniversePayload({
      universe_id: "sp500",
      name: "sp500",
      label: "S&P 500 live constituents",
      category: "index",
      source: "wikipedia_constituents_table",
      last_updated: nowIso(),
      performance_tier: "pi_bounded_full",
      estimated_time_seconds: 240,
      tickers
    });
    if (cachePath) {
      writeJson(cachePath, universe);
    }
    return { ...universe, cache_state: "refreshed" };
  } catch (error) {
    if (cached?.tickers?.length) {
      return {
        ...cached,
        cache_state: "stale_fallback",
        universe_warning: String(error?.message || error).slice(0, 240)
      };
    }
    const fallback = normalizeLiveUniversePayload(fallbackUniverse);
    return {
      ...fallback,
      label: `${fallback.label || "S&P 500 sample"} fallback`,
      source: fallback.source || "replay_fixture_fallback",
      cache_state: "fixture_fallback",
      universe_warning: String(error?.message || error).slice(0, 240)
    };
  }
}

function createLiveClock(at = new Date()) {
  const date = new Date(at);
  const ms = date.getTime();
  return {
    now: () => ms,
    iso: () => date.toISOString(),
    date: () => dateOnly(date.toISOString()),
    metadata: () => ({
      source_mode: "live_manual",
      live_clock: date.toISOString()
    })
  };
}

async function fetchPreflightJson(url, { timeoutMs = 8000, provider = "massive" } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": `SentimentAnalyst/1.0 (+uta ${provider} preflight)`
      }
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const error = new Error(`${provider} preflight ${response.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function runMassivePreflightSample(providerCheck, config = {}, ticker = "AVGO") {
  const provider = providerCheck.provider === "polygon" ? "polygon" : "massive";
  if (!["massive", "polygon"].includes(providerCheck.provider)) {
    return { state: "configured", sample_count: null, sample_attempted: false };
  }
  const apiKey = massiveApiKey(config);
  if (!apiKey) {
    return { state: "missing_key", sample_count: null, sample_attempted: false };
  }
  const base = massiveBaseUrl(config, provider);
  const timeoutMs = Math.min(12000, Math.max(1000, Number(config.tradePrintsRequestTimeoutMs || config.marketDataRequestTimeoutMs || 8000)));
  let url = "";
  let countPath = "results";
  if (providerCheck.provider_family === "trade_prints" || providerCheck.provider_family === "derived_trade_prints") {
    url = `${base}/v3/trades/${encodeURIComponent(ticker)}?limit=5&sort=timestamp&order=desc&apiKey=${encodeURIComponent(apiKey)}`;
  } else if (providerCheck.provider_family === "bars") {
    const { multiplier, timespan } = intervalToMassiveRange(config.marketDataInterval || "1day");
    url = `${base}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${multiplier}/${timespan}/${dateDaysAgo(7)}/${new Date().toISOString().slice(0, 10)}?adjusted=true&sort=desc&limit=5&apiKey=${encodeURIComponent(apiKey)}`;
  } else if (providerCheck.provider_family === "universe") {
    url = `${base}/v3/reference/tickers/${encodeURIComponent(ticker)}?apiKey=${encodeURIComponent(apiKey)}`;
    countPath = "results_single";
  } else {
    return { state: "configured", sample_count: null, sample_attempted: false };
  }

  try {
    const payload = await fetchPreflightJson(url, { timeoutMs, provider });
    const sampleCount = countPath === "results_single"
      ? payload?.results ? 1 : 0
      : Array.isArray(payload?.results) ? payload.results.length : 0;
    return {
      state: "sample_ok",
      sample_count: sampleCount,
      sample_attempted: true
    };
  } catch (error) {
    const message = String(error?.message || error || "");
    return {
      state: Number(error?.status || 0) === 429 || /rate.?limit|too many requests|quota/i.test(message)
        ? "rate_limited"
        : "provider_error",
      sample_count: null,
      sample_attempted: true,
      error: message.slice(0, 240)
    };
  }
}

function normalizeMassiveTimestamp(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  if (numeric > 1e15) {
    return new Date(numeric / 1_000_000).toISOString();
  }
  if (numeric > 1e12) {
    return new Date(numeric).toISOString();
  }
  return new Date(numeric * 1000).toISOString();
}

async function fetchMassiveLiveInputs(config = {}, ticker = "AVGO") {
  const provider = config.tradePrintsProvider === "polygon" ? "polygon" : "massive";
  const apiKey = massiveApiKey(config);
  if (!apiKey) {
    const error = new Error("MASSIVE_API_KEY or POLYGON_API_KEY is required for live UTA analysis.");
    error.status = 409;
    throw error;
  }
  const base = massiveBaseUrl(config, provider);
  const timeoutMs = Math.min(15000, Math.max(1000, Number(config.tradePrintsRequestTimeoutMs || config.marketDataRequestTimeoutMs || 8000)));
  const today = new Date().toISOString().slice(0, 10);
  const barsFrom = dateDaysAgo(75);
  const tradesUrl = `${base}/v3/trades/${encodeURIComponent(ticker)}?limit=50&sort=timestamp&order=desc&apiKey=${encodeURIComponent(apiKey)}`;
  const barsUrl = `${base}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${barsFrom}/${today}?adjusted=true&sort=asc&limit=80&apiKey=${encodeURIComponent(apiKey)}`;
  const referenceUrl = `${base}/v3/reference/tickers/${encodeURIComponent(ticker)}?apiKey=${encodeURIComponent(apiKey)}`;
  const [tradesPayload, barsPayload, referencePayload] = await Promise.all([
    fetchPreflightJson(tradesUrl, { timeoutMs, provider }),
    fetchPreflightJson(barsUrl, { timeoutMs, provider }),
    fetchPreflightJson(referenceUrl, { timeoutMs, provider }).catch(() => null)
  ]);
  const trades = [...(tradesPayload?.results || [])]
    .map((trade, index) => ({
      id: trade.id || trade.i || `live-print-${index + 1}`,
      ts: normalizeMassiveTimestamp(trade.sip_timestamp || trade.participant_timestamp || trade.trf_timestamp || trade.timestamp),
      venue: trade.trf_id ? `TRF-${trade.trf_id}` : trade.exchange ? `EXCHANGE-${trade.exchange}` : "unknown",
      price: Number(trade.price || trade.p),
      size: Number(trade.size || trade.s),
      condition_codes: (trade.conditions || trade.condition_codes || trade.c || []).map(String)
    }))
    .filter((trade) => trade.ts && Number.isFinite(trade.price) && Number.isFinite(trade.size) && trade.size > 0)
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const bars = [...(barsPayload?.results || [])]
    .map((bar) => ({
      date: normalizeMassiveTimestamp(bar.t)?.slice(0, 10),
      volume: Number(bar.v || 0),
      close: Number(bar.c),
      notional: Number(bar.v || 0) * Number(bar.vw || bar.c || 0),
      focus_notional_share: 0,
      net_notional_pressure: 0
    }))
    .filter((bar) => bar.date && Number.isFinite(bar.volume) && bar.volume > 0);
  return {
    provider,
    trades,
    bars,
    reference: referencePayload?.results || null,
    fetched_at: nowIso()
  };
}

async function fetchMassiveBarSummary(config = {}, ticker = "AVGO") {
  const provider = config.tradePrintsProvider === "polygon" ? "polygon" : "massive";
  const apiKey = massiveApiKey(config);
  if (!apiKey) {
    const error = new Error("MASSIVE_API_KEY or POLYGON_API_KEY is required for live UTA scan.");
    error.status = 409;
    throw error;
  }
  const base = massiveBaseUrl(config, provider);
  const timeoutMs = Math.min(12000, Math.max(1000, Number(config.marketDataRequestTimeoutMs || config.tradePrintsRequestTimeoutMs || 8000)));
  const today = new Date().toISOString().slice(0, 10);
  const barsUrl = `${base}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${dateDaysAgo(75)}/${today}?adjusted=true&sort=asc&limit=80&apiKey=${encodeURIComponent(apiKey)}`;
  const payload = await fetchPreflightJson(barsUrl, { timeoutMs, provider });
  const bars = [...(payload?.results || [])]
    .map((bar) => ({
      date: normalizeMassiveTimestamp(bar.t)?.slice(0, 10),
      volume: Number(bar.v || 0),
      close: Number(bar.c),
      notional: Number(bar.v || 0) * Number(bar.vw || bar.c || 0)
    }))
    .filter((bar) => bar.date && Number.isFinite(bar.volume) && bar.volume > 0);
  const latest = bars.at(-1) || null;
  const previous = bars.slice(-21, -1);
  const volumeMedian = median(previous.map((bar) => bar.volume));
  const notionalMedian = median(previous.map((bar) => bar.notional));
  return {
    ticker,
    provider,
    bars,
    latest,
    volume_ratio: volumeMedian > 0 && latest ? latest.volume / volumeMedian : null,
    notional_ratio: notionalMedian > 0 && latest ? latest.notional / notionalMedian : null,
    volume_zscore: robustZScore(latest?.volume, volumeMedian, mad(previous.map((bar) => bar.volume), volumeMedian)),
    notional_zscore: robustZScore(latest?.notional, notionalMedian, mad(previous.map((bar) => bar.notional), notionalMedian))
  };
}

async function fetchMassiveGroupedDailyBars(config = {}, dates = []) {
  const provider = config.tradePrintsProvider === "polygon" ? "polygon" : "massive";
  const apiKey = massiveApiKey(config);
  if (!apiKey) {
    const error = new Error("MASSIVE_API_KEY or POLYGON_API_KEY is required for full live UTA scan.");
    error.status = 409;
    throw error;
  }
  const base = massiveBaseUrl(config, provider);
  const timeoutMs = Math.min(15000, Math.max(1000, Number(config.marketDataRequestTimeoutMs || config.tradePrintsRequestTimeoutMs || 8000)));
  const byTicker = new Map();
  const attemptedDates = [];
  const emptyDates = [];
  const failedDates = [];

  for (const date of dates) {
    const url = `${base}/v2/aggs/grouped/locale/us/market/stocks/${encodeURIComponent(date)}?adjusted=true&apiKey=${encodeURIComponent(apiKey)}`;
    try {
      const payload = await fetchPreflightJson(url, { timeoutMs, provider });
      attemptedDates.push(date);
      const rows = Array.isArray(payload?.results) ? payload.results : [];
      if (!rows.length) {
        emptyDates.push(date);
      }
      for (const row of rows) {
        const ticker = normalizeTickerSymbol(row.T || row.ticker);
        const volume = Number(row.v || 0);
        const price = Number(row.vw || row.c || 0);
        if (!ticker || !Number.isFinite(volume) || volume <= 0 || !Number.isFinite(price) || price <= 0) {
          continue;
        }
        if (!byTicker.has(ticker)) {
          byTicker.set(ticker, []);
        }
        byTicker.get(ticker).push({
          date,
          volume,
          close: Number(row.c || price),
          notional: volume * price
        });
      }
    } catch (error) {
      const status = Number(error?.status || 0);
      if (status === 404) {
        emptyDates.push(date);
        continue;
      }
      failedDates.push({
        date,
        error: String(error?.message || error).slice(0, 180)
      });
    }
  }

  if (!byTicker.size) {
    const error = new Error(failedDates.length
      ? `Massive grouped bars failed for all attempted dates; last error: ${failedDates.at(-1)?.error}`
      : "Massive grouped bars returned no usable rows.");
    error.status = 502;
    throw error;
  }

  for (const rows of byTicker.values()) {
    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }
  return {
    provider,
    byTicker,
    attempted_dates: attemptedDates,
    empty_dates: emptyDates,
    failed_dates: failedDates
  };
}

function summarizeGroupedBarsForTicker(ticker, bars = [], baselineSessions = 20) {
  const ordered = [...bars].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const latest = ordered.at(-1) || null;
  const previous = ordered.slice(0, -1).slice(-Math.max(1, Number(baselineSessions || 20)));
  const volumeMedian = median(previous.map((bar) => bar.volume));
  const notionalMedian = median(previous.map((bar) => bar.notional));
  return {
    ticker,
    latest,
    session_count: previous.length,
    volume_ratio: volumeMedian > 0 && latest ? latest.volume / volumeMedian : null,
    notional_ratio: notionalMedian > 0 && latest ? latest.notional / notionalMedian : null,
    volume_zscore: robustZScore(latest?.volume, volumeMedian, mad(previous.map((bar) => bar.volume), volumeMedian)),
    notional_zscore: robustZScore(latest?.notional, notionalMedian, mad(previous.map((bar) => bar.notional), notionalMedian))
  };
}

function liveScanRowFromSummary(summary, direction = "bullish", label = "Preliminary - live Massive grouped daily bars") {
  const bScore = Math.max(
    Number(summary.volume_zscore || 0),
    Number(summary.notional_zscore || 0)
  );
  const cScreen = Math.max(
    Number(summary.volume_ratio || 0),
    Number(summary.notional_ratio || 0)
  );
  return {
    ticker: summary.ticker,
    preliminary_tier: bScore >= 2.5 || cScreen >= 3 ? "B" : bScore >= 1.5 || cScreen >= 1.8 ? "C" : "D",
    B_estimate: {
      volume_zscore_from_bars: roundNumber(summary.volume_zscore, 2),
      notional_zscore_from_bars: roundNumber(summary.notional_zscore, 2)
    },
    C_screen: roundNumber(cScreen, 3),
    pass2_status: "pending",
    label,
    scan_reason: `Activity screen: max B ${roundNumber(bScore, 2)} sigma; raw C ${roundNumber(cScreen, 2)}x. Direction is unresolved until pass 2 trade-print signing.`,
    latest_bar_date: summary.latest?.date || null,
    data_state: "live_preliminary",
    preliminary_direction: direction,
    baseline_sessions: summary.session_count
  };
}

function directionPhrase(direction) {
  return {
    bullish: "buyer-side pressure",
    bearish: "seller-side pressure",
    neutral: "balanced signed flow",
    undetermined: "undetermined signed flow"
  }[direction] || "undetermined signed flow";
}

function bandFromMetrics(indicators = {}) {
  const b = indicators.B || {};
  const c = indicators.C || {};
  const peakB = Math.max(
    Number(b.volume_zscore || 0),
    Number(b.notional_zscore || 0),
    Number(b.focus_notional_share_zscore || 0),
    Math.abs(Number(b.net_notional_pressure_zscore || 0))
  );
  const peakRatio = Math.max(Number(c.volume_ratio || 0), Number(c.notional_ratio || 0));
  if (peakB >= 3.5 || peakRatio >= 5) return "Extreme";
  if (peakB >= 2.5 || peakRatio >= 3) return "Unusual";
  if (peakB >= 1.5 || peakRatio >= 1.8) return "Elevated";
  return "Normal";
}

function buildTradeAnalysis({ ticker, classifier, indicators, signing, blocks, baseline, inputs, latestBar, corroboration = {} }) {
  const c = indicators.C || {};
  const b = indicators.B || {};
  const direction = classifier.direction || signing.direction || "undetermined";
  const pressure = Number(signing.net_notional_pressure || 0);
  const absPressure = Math.abs(pressure);
  const confidence = Number(signing.signing_confidence || 0);
  const ready = baseline?.state === "ready" && inputs.trades.length > 0;
  const directional = ["bullish", "bearish"].includes(direction) && absPressure >= 0.6 && confidence >= 0.5;
  const tierRankValue = tierRank(classifier.tier);
  const maxB = Math.max(
    Number(b.volume_zscore || 0),
    Number(b.notional_zscore || 0),
    Number(b.focus_notional_share_zscore || 0),
    Math.abs(Number(b.net_notional_pressure_zscore || 0))
  );
  const bActionableCount = [
    Number(b.volume_zscore),
    Number(b.notional_zscore),
    Number(b.focus_notional_share_zscore),
    Math.abs(Number(b.net_notional_pressure_zscore))
  ].filter((value) => Number.isFinite(value) && value >= 2.5).length;
  const bReviewCount = [
    Number(b.volume_zscore),
    Number(b.notional_zscore),
    Number(b.focus_notional_share_zscore),
    Math.abs(Number(b.net_notional_pressure_zscore))
  ].filter((value) => Number.isFinite(value) && value >= 1.5).length;
  const notionalRatio = Number(c.notional_ratio || 0);
  const volumeRatio = Number(c.volume_ratio || 0);
  const focusCount = Number(c.focus_trade_count || 0);
  const focusShare = Number(c.focus_notional_share || 0);
  const totalNotional = Number(c.total_notional || 0);
  const focusNotional = Number(c.focus_notional || 0);
  const criteria = [
    {
      id: "signed_pressure_60",
      label: "Signed pressure on one side >= 60%",
      passed: directional,
      actual: `${roundNumber(pressure * 100, 1)}% ${directionPhrase(direction)}`
    },
    {
      id: "b_review_15",
      label: "B anomaly >= 1.5 sigma for review",
      passed: bReviewCount >= 1,
      actual: `${bReviewCount} components; max ${roundNumber(maxB, 2)} sigma`
    },
    {
      id: "b_actionable_25",
      label: "B anomaly >= 2.5 sigma on 2+ components for Tier A",
      passed: bActionableCount >= 2,
      actual: `${bActionableCount} components`
    },
    {
      id: "notional_15",
      label: "Notional >= 1.5x own median",
      passed: notionalRatio >= 1.5,
      actual: `${roundNumber(notionalRatio, 2)}x`
    },
    {
      id: "focus_or_volume",
      label: "Raw C confirms activity: volume, focus prints, or block share",
      passed: volumeRatio >= 1.5 || focusCount >= 1 || focusShare >= 0.1,
      actual: `${roundNumber(volumeRatio, 2)}x volume; ${focusCount} focus prints; ${roundNumber(focusShare * 100, 1)}% focus share`
    },
    {
      id: "required_lanes",
      label: "Required lanes ready; optional lanes never penalize",
      passed: ready,
      actual: ready ? "Baseline and live trade prints available" : "Required evidence is unavailable"
    }
  ];
  const setupStatus = !ready
    ? "blocked"
    : directional && tierRankValue >= tierRank("B")
      ? "review_candidate"
      : directional && tierRankValue >= tierRank("C")
        ? "watch_only"
        : "no_directional_setup";
  const bias = directional ? direction : "neutral";
  const latestClose = Number(latestBar?.close || 0);
  const setupCopy = {
    blocked: "Do not analyze as a trade setup yet. Required live evidence is missing or below threshold.",
    no_directional_setup: "No directional UTA trade setup right now. Activity is not strong or directional enough.",
    watch_only: "Watch-only setup. Flow is directional, but evidence is not strong enough for a review candidate.",
    review_candidate: "Review candidate. UTA evidence is directional and unusual enough to inspect with price, risk, and catalyst context."
  }[setupStatus];
  const why = directional
    ? `${ticker} shows ${directionPhrase(direction)} with ${roundNumber(pressure * 100, 1)}% net signed notional pressure and ${roundNumber(confidence * 100, 0)}% signing confidence.`
    : `${ticker} does not show a directional signed-flow edge: net signed notional pressure is ${roundNumber(pressure * 100, 1)}% with ${roundNumber(confidence * 100, 0)}% signing confidence.`;
  return {
    schema_version: "uta.trade_analysis.v1",
    bias,
    setup_status: setupStatus,
    verdict: setupCopy,
    trigger_model: "signed_flow_plus_abc_gates_v2",
    evidence_grade: classifier.tier,
    anomaly_band: bandFromMetrics(indicators),
    confidence: roundNumber(confidence, 3),
    trigger_summary: {
      primary_trigger: directional ? `${direction} signed-flow pressure >= 60%` : "No signed-flow trigger",
      next_trigger_needed: directional
        ? bReviewCount >= 1 ? "Confirm with price/risk/catalyst before trade review." : "Needs B >= 1.5 sigma to become reviewable."
        : "Needs signed pressure >= 60% and signing confidence >= 50%.",
      trade_action: setupStatus === "review_candidate" ? "human_review_candidate" : setupStatus === "watch_only" ? "watch_only" : "no_trade"
    },
    criteria,
    pressure: {
      direction,
      net_notional_pressure: roundNumber(pressure, 3),
      net_volume_pressure: roundNumber(signing.net_volume_pressure, 3),
      signing_confidence: roundNumber(confidence, 3),
      interpretation: why
    },
    activity: {
      latest_bar_date: latestBar?.date || null,
      latest_close: Number.isFinite(latestClose) && latestClose > 0 ? roundNumber(latestClose, 2) : null,
      volume_ratio: roundNumber(volumeRatio, 3),
      notional_ratio: roundNumber(notionalRatio, 3),
      volume_zscore: roundNumber(b.volume_zscore, 2),
      notional_zscore: roundNumber(b.notional_zscore, 2),
      focus_zscore: roundNumber(b.focus_notional_share_zscore, 2),
      pressure_zscore: roundNumber(b.net_notional_pressure_zscore, 2),
      max_b_zscore: roundNumber(maxB, 2),
      total_notional: roundNumber(totalNotional, 2),
      analyzed_prints: inputs.trades.length,
      baseline_sessions: baseline?.session_count || 0
    },
    block_flow: {
      focus_trade_count: focusCount,
      focus_notional: roundNumber(focusNotional, 2),
      focus_notional_share: roundNumber(focusShare, 3),
      largest_print_notional: roundNumber(c.largest_print_notional, 2),
      largest_print_multiple: roundNumber(c.largest_print_multiple, 2),
      trf_share: roundNumber(blocks.trf_share, 3)
    },
    indicator_aliases: {
      A: null,
      B: {
        volume: roundNumber(b.volume_zscore, 2),
        notional: roundNumber(b.notional_zscore, 2),
        focus: roundNumber(b.focus_notional_share_zscore, 2),
        pressure: roundNumber(b.net_notional_pressure_zscore, 2),
        premarket: null
      },
      C: {
        vr: roundNumber(volumeRatio, 2),
        nr: roundNumber(notionalRatio, 2),
        cr: null,
        fshare: roundNumber(focusShare, 3),
        fcount: focusCount,
        lpm: roundNumber(c.largest_print_multiple, 2),
        nnp: roundNumber(pressure, 3),
        nvp: roundNumber(signing.net_volume_pressure, 3),
        fnotional: roundNumber(focusNotional, 2),
        total: roundNumber(totalNotional, 2),
        largest: roundNumber(c.largest_print_notional, 2)
      }
    },
    corroboration: {
      price_action_aligned: Boolean(corroboration.price_action_aligned),
      provider_alert_confirmed: Boolean(corroboration.provider_alert_confirmed),
      options_flow_aligned: Boolean(corroboration.options_flow_aligned),
      premarket_regular_elevated: Boolean(corroboration.premarket_regular_elevated || corroboration.pre_and_regular_both_elevated),
      news_catalyst_present: Boolean(corroboration.news_catalyst_present),
      macro_regime_supports: Boolean(corroboration.macro_regime_supports),
      independent_strong_count: Number(corroboration.independent_confirmation_count || 0),
      note: Number(corroboration.independent_confirmation_count || 0) > 0
        ? "Strong corroboration is present and is shown because it can support Tier A."
        : "Live Massive v1 has required bars/prints only. Optional corroboration lanes render as disabled and never penalize."
    },
    trade_boundaries: [
      "UTA is supporting evidence only; it is not a buy/sell instruction.",
      "Direction is signed-flow based, not price based.",
      "Check price structure, catalyst, liquidity, risk, and portfolio constraints before any trade workflow.",
      classifier.tier === "D" ? "Tier D means no actionable UTA evidence for this cycle." : "Only Tier A/B with aligned risk context should advance to human review."
    ]
  };
}

function buildLiveBluf({ ticker, classifier, indicators, signing, blocks, baseline, inputs }) {
  const trade = buildTradeAnalysis({
    ticker,
    classifier,
    indicators,
    signing,
    blocks,
    baseline,
    inputs,
    latestBar: inputs.bars.at(-1)
  });
  const c = indicators.C || {};
  const b = indicators.B || {};
  const direction = trade.pressure.direction;
  const pressurePct = roundNumber(Number(trade.pressure.net_notional_pressure || 0) * 100, 1);
  const directionLabel = direction === "bullish" ? "Bullish flow" : direction === "bearish" ? "Bearish flow" : "No directional edge";
  const headline = `${ticker} - ${directionLabel} - Tier ${classifier.tier} (${trade.anomaly_band})`;
  const focusText = Number(c.focus_trade_count || 0) > 0
    ? `${c.focus_trade_count} focus prints totaling ${formatUsd(c.focus_notional)} (${roundNumber(Number(c.focus_notional_share || 0) * 100, 1)}% of analyzed notional)`
    : "no focus/block prints above the configured floor";
  return {
    trade,
    bluf: {
      headline,
      what_happened: `${inputs.trades.length} live Massive prints and ${inputs.bars.length} daily bars were analyzed. Volume is ${roundNumber(c.volume_ratio, 2) ?? "N/A"}x baseline, notional is ${roundNumber(c.notional_ratio, 2) ?? "N/A"}x baseline, with ${focusText}.`,
      why_it_matters: direction === "neutral" || direction === "undetermined"
        ? `The activity does not currently resolve into a trade bias: signed notional pressure is ${pressurePct}% and confidence is ${roundNumber(signing.signing_confidence * 100, 0)}%. This is a monitoring state, not a bullish/bearish setup.`
        : `Signed order flow is ${direction}: net notional pressure is ${pressurePct}% with ${roundNumber(signing.signing_confidence * 100, 0)}% signing confidence. B-score peak is ${roundNumber(Math.max(Number(b.volume_zscore || 0), Number(b.notional_zscore || 0)), 2)} sigma.`,
      what_to_check: trade.setup_status === "review_candidate"
        ? "Before trade review: confirm price structure/VWAP, catalyst, spread/liquidity, risk box, and whether the move is continuation or exhaustion."
        : "Watch for a new live cycle with stronger signed pressure, larger focus-print share, provider alerts, options confirmation, or a catalyst before treating this as trade evidence.",
      limitations: "This is UTA evidence only, not a trade instruction. It does not know your entry, stop, account risk, news context, or portfolio exposure."
    }
  };
}

function formatUsd(value) {
  const numeric = Number(value || 0);
  if (Math.abs(numeric) >= 1_000_000_000) return `$${roundNumber(numeric / 1_000_000_000, 2)}B`;
  if (Math.abs(numeric) >= 1_000_000) return `$${roundNumber(numeric / 1_000_000, 1)}M`;
  if (Math.abs(numeric) >= 1_000) return `$${roundNumber(numeric / 1_000, 1)}K`;
  return `$${Math.round(numeric)}`;
}

function liveLaneStates(registry = [], { trades = [], bars = [], reference = null, clock = createLiveClock() } = {}) {
  const latestTrade = trades.at(-1)?.ts || null;
  const latestBar = bars.at(-1)?.date ? `${bars.at(-1).date}T00:00:00.000Z` : null;
  const fetchedAt = clock.iso();
  const observed = [
    {
      lane_id: "massive_live_trade_slices",
      state: trades.length ? "ready" : "unavailable",
      tier_effect: trades.length ? "none" : "suppress_to_d",
      coverage: trades.length ? 1 : 0,
      latest_as_of: fetchedAt,
      operator_copy: trades.length
        ? `Massive returned ${trades.length} recent trade prints for this manual sample; newest print timestamp ${latestTrade || "unknown"}.`
        : "Massive returned no usable recent trade prints; no live signal is fabricated."
    },
    {
      lane_id: "massive_daily_bars",
      state: bars.length >= 10 ? "ready" : "unavailable",
      tier_effect: bars.length >= 10 ? "none" : "suppress_to_d",
      coverage: Math.min(1, bars.length / 20),
      latest_as_of: latestBar,
      operator_copy: bars.length >= 10
        ? `Massive returned ${bars.length} daily bars for manual baseline calculation.`
        : "Massive did not return enough daily bars for a robust live baseline."
    },
    {
      lane_id: "massive_block_trade_feed",
      state: trades.length ? "ready" : "unavailable",
      tier_effect: trades.length ? "none" : "cap_at_c",
      coverage: trades.length ? 1 : 0,
      latest_as_of: fetchedAt,
      operator_copy: trades.length
        ? "Block/TRF evidence was derived from the normalized Massive trade sample."
        : "Block/TRF evidence cannot be derived without live prints."
    },
    {
      lane_id: "universe_constituents",
      state: reference ? "ready" : "stale",
      tier_effect: reference ? "none" : "cap_at_c",
      coverage: reference ? 1 : 0,
      latest_as_of: reference ? fetchedAt : null,
      operator_copy: reference
        ? "Ticker reference data was returned by Massive for this manual sample."
        : "Universe reference data was not confirmed; live tier is capped rather than fabricated."
    }
  ];
  return buildLaneStates(registry, observed, clock);
}

async function buildLiveManualPayload(ticker, context = {}) {
  const { config = {}, laneRegistry = {}, policy = {}, universe = {} } = context;
  const inputs = await fetchMassiveLiveInputs(config, ticker);
  if (!inputs.trades.length && !inputs.bars.length) {
    const error = new Error(`Massive returned no usable trades or daily bars for ${ticker}. Check the ticker symbol or provider entitlement.`);
    error.status = 404;
    error.code = "live_symbol_not_found";
    throw error;
  }
  const clock = createLiveClock();
  const profile = {
    ticker,
    name: inputs.reference?.name || ticker,
    exchange: inputs.reference?.primary_exchange || null,
    sector: inputs.reference?.sic_description || null,
    liquidity_bucket: "live_manual",
    adv_20day: median(inputs.bars.slice(-21, -1).map((bar) => bar.volume)) || 0,
    notional_floor: Number(config.tradePrintsBlockTradeMinNotionalUsd || 500_000),
    pi_performance_tier: universe.performance_tier || "standard",
    source: "massive_reference"
  };
  const latestBar = inputs.bars.at(-1);
  const historicalSessions = inputs.bars.slice(0, -1).map((bar) => ({
    date: bar.date,
    volume: bar.volume,
    notional: bar.notional,
    focus_notional_share: 0,
    net_notional_pressure: 0
  }));
  const baseline = buildBaseline({ ticker, historicalSessions, clock, windowSessions: 20 });
  const normalized = normalizeTradePrints(inputs.trades, policy);
  const signing = signTradePrints(normalized, { previous_trade_price: latestBar?.close });
  const blocks = detectBlockTrf(signing, { profile, baseline });
  const componentSigned = latestBar
    ? {
        ...signing,
        total_volume: latestBar.volume,
        total_notional: latestBar.notional
      }
    : signing;
  const components = computeSignalComponents({ baseline, signed: componentSigned, blocks });
  const indicators = computeAbcIndicators({ mode: "single_ticker", components });
  const laneStates = liveLaneStates(laneRegistry.lanes || laneRegistry || [], {
    trades: inputs.trades,
    bars: inputs.bars,
    reference: inputs.reference,
    clock
  });
  const classifier = classifyTier({
    mode: "single_ticker",
    indicators,
    laneStates,
    corroboration: { independent_confirmation_count: 0, provider_alert_confirmed: false },
    signing
  });
  const interpretation = buildLiveBluf({ ticker, classifier, indicators, signing, blocks, baseline, inputs });
  const generatedAt = clock.iso();
  const payload = {
    schema_version: "uta.ticker_result.v1",
    mode: "single_ticker",
    ticker,
    name: profile.name,
    exchange: profile.exchange,
    sector: profile.sector,
    generated_at: generatedAt,
    data_state: "live_manual",
    tier: classifier.tier,
    direction: classifier.direction,
    signing_confidence: signing.signing_confidence,
    indicators,
    lane_states: laneStates,
    bluf: interpretation.bluf,
    trade_analysis: interpretation.trade,
    evidence_cards: [
      {
        id: "volume_anomaly",
        title: "Volume Anomaly",
        status: baseline.state === "ready" ? "ready" : "unavailable",
        headline_metric: `${roundNumber(indicators.C.volume_ratio, 2) ?? "N/A"}x volume`,
        summary: `Session volume is ${roundNumber(indicators.C.volume_ratio, 2) ?? "N/A"}x the 20-session median; notional is ${roundNumber(indicators.C.notional_ratio, 2) ?? "N/A"}x. B volume ${roundNumber(indicators.B.volume_zscore, 2) ?? "N/A"} sigma.`
      },
      {
        id: "block_off_exchange",
        title: "Block / Off-Exchange Activity",
        status: blocks.focus_trade_count > 0 ? "ready" : "unavailable",
        headline_metric: `${blocks.focus_trade_count} focus prints`,
        summary: `${formatUsd(blocks.focus_notional)} focus notional, ${roundNumber((blocks.focus_notional_share || 0) * 100, 1)}% of analyzed notional, TRF/off-exchange share ${roundNumber((blocks.trf_share || 0) * 100, 1)}%.`
      },
      {
        id: "directional_pressure",
        title: "Directional Pressure",
        status: signing.total_notional > 0 ? "ready" : "unavailable",
        headline_metric: `${roundNumber((signing.net_notional_pressure || 0) * 100, 1)}%`,
        summary: `${directionPhrase(signing.direction)} from quote/tick signing. Confidence ${roundNumber(signing.signing_confidence * 100, 0)}%. Direction requires +/-60% signed pressure and is never inferred from price.`
      },
      {
        id: "premarket_activity",
        title: "Pre-Market Activity",
        status: "disabled_optional",
        headline_metric: "optional lane",
        summary: "Pre-market lane is not enabled in this Massive-only slice. It is visible for auditability and never penalizes the tier."
      },
      {
        id: "market_flow_trend",
        title: "Market Flow Trend",
        status: signing.total_notional > 0 ? "ready" : "unavailable",
        headline_metric: signing.direction === "bullish" ? "Building" : signing.direction === "bearish" ? "Fading" : "Neutral",
        summary: `Current signed-flow pressure is ${roundNumber((signing.net_notional_pressure || 0) * 100, 1)}%. Trend is interpreted from signed prints, not from price movement.`
      },
      {
        id: "confirmed_alerts",
        title: "Confirmed Alerts",
        status: "disabled_optional",
        headline_metric: "none",
        summary: "No confirmed provider alert lane is enabled. Strong alerts can corroborate Tier A when present, but absence does not lower the tier."
      },
      {
        id: "options_flow",
        title: "Options Flow",
        status: "disabled_optional",
        headline_metric: "optional lane",
        summary: "Options flow is not enabled in this Massive-only slice. Aligned options can corroborate, but missing options never penalize."
      },
      {
        id: "macro_context",
        title: "Macro Context",
        status: "disabled_optional",
        headline_metric: "context only",
        summary: "Macro context is informational only and cannot create or elevate a UTA tier by itself."
      },
      {
        id: "data_health",
        title: "Data Health",
        status: "ready",
        headline_metric: `${normalized.summary.eligible_prints} eligible prints`,
        summary: `${normalized.summary.eligible_prints} eligible prints after condition-code policy; ${normalized.summary.excluded_prints || 0} excluded. Required lane status and coverage are shown below.`
      }
    ],
    explain_tier: classifier.explain_tier,
    raw_prints: {
      ticker,
      policy_version: normalized.policy_version,
      truncated: false,
      normalization_summary: normalized.summary,
      prints: signing.prints.slice(-25)
    },
    engine_diagnostics: {
      state: components.state,
      reason: components.state === "ready" ? "live_manual_computed" : "insufficient_live_history",
      baseline,
      signal_components: components,
      print_sample: {
        total_notional: signing.total_notional,
        total_volume: signing.total_volume,
        eligible_prints: normalized.summary.eligible_prints
      },
      provider: inputs.provider,
      fetched_at: inputs.fetched_at
    },
    calculation_metadata: {
      source_mode: "live_manual",
      live_clock: generatedAt,
      provider: inputs.provider,
      bars_source: "massive_aggs_daily",
      prints_source: "massive_trades",
      direction_source: "signed_flow",
      price_is_corroboration_only: true,
      abc_indicators_kept_separate: true,
      latest_bar_date: latestBar?.date || null,
      live_volume_source: latestBar ? "massive_current_daily_bar" : "massive_recent_print_sample",
      print_sample_used_for: ["signed_flow", "focus_prints", "raw_prints"],
      live_manual_only: true
    }
  };
  assertNoCompositeScore(payload);
  return payload;
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
  const replayTradeAnalysis = buildTradeAnalysis({
    ticker: fixture.ticker,
    classifier: analysis.classifier,
    indicators: analysis.indicators,
    signing: analysis.signing,
    blocks: analysis.blocks,
    baseline: analysis.baseline,
    inputs: {
      trades: analysis.signing.prints || [],
      bars: fixture.engine_inputs?.historical_sessions || []
    },
    latestBar: fixture.engine_inputs?.price_context || null,
    corroboration: fixture.corroboration || {}
  });
  const payload = {
    ...basePayload,
    generated_at: analysis.clock.iso(),
    tier: analysis.classifier.tier,
    direction: analysis.classifier.direction,
    signing_confidence: analysis.signing.signing_confidence,
    indicators: analysis.indicators,
    lane_states: analysis.lane_states,
    explain_tier: analysis.classifier.explain_tier,
    trade_analysis: replayTradeAnalysis,
    evidence_cards: [
      {
        id: "volume_anomaly",
        title: "Volume Anomaly",
        status: analysis.baseline.state === "ready" ? "ready" : "unavailable",
        headline_metric: `${roundNumber(analysis.indicators.C.volume_ratio, 2) ?? "N/A"}x volume`,
        summary: `Volume is ${roundNumber(analysis.indicators.C.volume_ratio, 2) ?? "N/A"}x baseline; notional is ${roundNumber(analysis.indicators.C.notional_ratio, 2) ?? "N/A"}x baseline.`
      },
      {
        id: "block_off_exchange",
        title: "Block / Off-Exchange Activity",
        status: analysis.blocks.focus_trade_count > 0 ? "ready" : "unavailable",
        headline_metric: `${analysis.blocks.focus_trade_count} focus prints`,
        summary: `${formatUsd(analysis.blocks.focus_notional)} focus notional, ${roundNumber((analysis.blocks.focus_notional_share || 0) * 100, 1)}% of analyzed notional.`
      },
      {
        id: "directional_pressure",
        title: "Directional Pressure",
        status: analysis.signing.total_notional > 0 ? "ready" : "unavailable",
        headline_metric: `${roundNumber((analysis.signing.net_notional_pressure || 0) * 100, 1)}%`,
        summary: `${directionPhrase(analysis.signing.direction)} from signed prints. Direction requires +/-60% signed pressure and is never inferred from price.`
      },
      {
        id: "premarket_activity",
        title: "Pre-Market Activity",
        status: fixture.corroboration?.pre_and_regular_both_elevated ? "ready" : "disabled_optional",
        headline_metric: fixture.corroboration?.pre_and_regular_both_elevated ? "elevated" : "optional lane",
        summary: fixture.corroboration?.pre_and_regular_both_elevated
          ? "Replay evidence includes elevated pre-market and regular-session activity."
          : "Pre-market lane is optional and never penalizes when absent."
      },
      {
        id: "market_flow_trend",
        title: "Market Flow Trend",
        status: "ready",
        headline_metric: analysis.signing.direction === "bullish" ? "Building" : analysis.signing.direction === "bearish" ? "Fading" : "Neutral",
        summary: `Signed-flow pressure is ${roundNumber((analysis.signing.net_notional_pressure || 0) * 100, 1)}% in this replay cycle.`
      },
      {
        id: "confirmed_alerts",
        title: "Confirmed Alerts",
        status: fixture.corroboration?.provider_alert_confirmed ? "ready" : "disabled_optional",
        headline_metric: fixture.corroboration?.provider_alert_confirmed ? "confirmed" : "none",
        summary: fixture.corroboration?.provider_alert_confirmed
          ? "Replay fixture includes a confirmed provider alert, counted as strong corroboration."
          : "No confirmed alert lane is enabled; absence does not lower the tier."
      },
      {
        id: "options_flow",
        title: "Options Flow",
        status: fixture.corroboration?.options_flow_aligned ? "ready" : "disabled_optional",
        headline_metric: fixture.corroboration?.options_flow_aligned ? "aligned" : "optional lane",
        summary: "Options flow is optional: aligned evidence can corroborate, missing evidence never penalizes."
      },
      {
        id: "macro_context",
        title: "Macro Context",
        status: fixture.corroboration?.macro_regime_supports ? "ready" : "disabled_optional",
        headline_metric: fixture.corroboration?.macro_regime_supports ? "supports" : "context only",
        summary: "Macro context informs interpretation only and cannot create a UTA tier by itself."
      },
      {
        id: "data_health",
        title: "Data Health",
        status: "ready",
        headline_metric: `${analysis.normalized.summary.eligible_prints} eligible prints`,
        summary: `${analysis.normalized.summary.eligible_prints} eligible prints after condition-code policy; required lanes are shown in lane health.`
      }
    ],
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

  async function buildCycle({ mode, tickers = ["AVGO"], query = {}, body = {}, reason = "manual" } = {}) {
    const startedAt = nowIso();
    const cycleId = `uta-${mode || "cycle"}-${stableCycleStamp(startedAt)}`;
    const sourceMode = String(body.source || query.source || "live").trim().toLowerCase();
    if (sourceMode === "replay") {
      return {
        status: 400,
        payload: {
          ok: false,
          error: "uta_replay_disabled",
          detail: "UTA replay mode is disabled. Configure live providers and run live analysis.",
          source_mode: "live_only"
        },
        cycle: {
          run_id: cycleId,
          mode,
          reason,
          status: "rejected",
          started_at: startedAt,
          completed_at: nowIso(),
          error: "uta_replay_disabled",
          tickers
        }
      };
    }
    let result;
    const events = [];
    try {
      if (mode === "single") {
        const ticker = tickers[0] || body.ticker || query.ticker || "AVGO";
        const single = await getLiveSingleAnalysis(ticker);
        result = { status: single.status, payload: { ...single.payload, cycle_id: cycleId } };
        rememberSignal(result.payload, { mode: "single_ticker", replayMode: result.payload?.data_state !== "live_manual" });
        events.push({ type: "uta_signal_result", payload: result.payload });
      } else if (mode === "portfolio") {
        const portfolio = await getLivePortfolioAnalysis({ ...body, tickers });
        result = { status: 200, payload: { ...portfolio, cycle_id: cycleId } };
        for (const row of result.payload.results || []) {
          rememberSignal({ ...row, cycle_id: cycleId }, { mode: "portfolio", replayMode: row.data_state !== "live_manual" });
        }
        events.push({ type: "uta_signal_result", payload: result.payload });
      } else if (mode === "scan_pass2") {
        const scan = await runLiveScanPass2(body);
        result = { status: 200, payload: { ...scan, cycle_id: cycleId } };
        for (const row of scan.results || []) {
          if (row.result) {
            rememberSignal({ ...row.result, cycle_id: cycleId }, { mode: "scan", universe: scan.universe, replayMode: row.result.data_state !== "live_manual" });
          }
        }
        events.push({ type: "uta_scan_progress", payload: result.payload });
      } else {
        const scan = await getLiveScan(query);
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
        source_mode: result.payload?.data_state || sourceMode,
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
          provider: result.payload?.data_state === "live_manual" ? "massive_live_manual" : "live_only",
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
          provider: "live_only",
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

  async function getLiveSingleAnalysis(tickerValue) {
    const ticker = normalizeTickerSymbol(tickerValue);
    if (!ticker) {
      return { status: 400, payload: { ok: false, error: "invalid_ticker", detail: "Ticker must be an uppercase market symbol." } };
    }
    try {
      const payload = await buildLiveManualPayload(ticker, {
        config,
        policy: getConditionPolicy(),
        laneRegistry: getLaneRegistry(),
        universe: getUniverseFixture()
      });
      return { status: 200, payload };
    } catch (error) {
      return {
        status: Number(error?.status || 0) || 502,
        payload: {
          schema_version: "uta.error.v1",
          ok: false,
          error: "live_uta_unavailable",
          ticker,
          detail: error.message,
          data_state: "live_unavailable",
          source_mode: "live_manual"
        }
      };
    }
  }

  function getUniverses() {
    const universe = getUniverseFixture();
    const cachedLiveUniverse = readCachedLiveUniverse(config.utaSp500UniverseCachePath);
    const liveUniverse = cachedLiveUniverse?.tickers?.length
      ? {
          universe_id: cachedLiveUniverse.universe_id,
          name: cachedLiveUniverse.name,
          label: cachedLiveUniverse.label,
          category: cachedLiveUniverse.category,
          ticker_count: cachedLiveUniverse.tickers.length,
          last_updated: cachedLiveUniverse.last_updated,
          source: cachedLiveUniverse.source,
          performance_tier: cachedLiveUniverse.performance_tier,
          estimated_time_seconds: cachedLiveUniverse.estimated_time_seconds,
          cache_state: "cached"
        }
      : {
          universe_id: "sp500",
          name: "sp500",
          label: "S&P 500 live constituents",
          category: "index",
          ticker_count: null,
          last_updated: null,
          source: "not_cached_yet",
          performance_tier: "pi_bounded_full",
          estimated_time_seconds: Number(config.utaLiveScanGroupedDays || 32) + 180,
          cache_state: "missing"
        };
    return {
      schema_version: "uta.universes.v1",
      generated_at: new Date().toISOString(),
      universes: [
        liveUniverse,
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
            ? `${lane.label} is unavailable from live providers. No synthetic signal is fabricated.`
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
      mode: "live_only",
      message: "Lane refresh is manual; configure the live provider before expecting fresh data.",
      lane
    };
    rememberLaneStates(states.lanes, states.generated_at);
    rememberAudit("lane_refresh_requested", { lane_id: laneId, refreshed: false, mode: "live_only" });
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

  async function getLivePortfolioAnalysis(payload = {}) {
    const requested = parseTickerList(payload.tickers, ["AVGO"]);
    const limit = Math.max(1, Math.min(12, Number(payload.limit || payload.max_tickers || requested.length || 1)));
    const tickers = requested.slice(0, limit);
    const results = [];
    for (const ticker of tickers) {
      const analysis = await getLiveSingleAnalysis(ticker);
      results.push(analysis.status === 200 ? analysis.payload : {
        schema_version: "uta.ticker_result.v1",
        mode: "portfolio",
        ticker,
        generated_at: nowIso(),
        data_state: "live_unavailable",
        tier: "D",
        direction: "undetermined",
        signing_confidence: 0,
        indicators: { A: null, B: {}, C: {} },
        lane_states: [],
        bluf: {
          headline: `${ticker} live analysis unavailable`,
          what_happened: analysis.payload?.detail || "Live provider request failed.",
          why_it_matters: "The row is not ranked from replay data.",
          what_to_check: "Check Massive credentials, entitlements, and provider status.",
          limitations: "No actionable UTA tier is produced for this row."
        },
        evidence_cards: [],
        explain_tier: {
          mode: "portfolio",
          rule_set: "portfolio_or_scan_abc",
          verdict: "Tier D",
          rules: [],
          gap_to_next_tier: ["Restore live provider data."]
        },
        calculation_metadata: {
          source_mode: "live_manual",
          direction_source: "unavailable",
          price_is_corroboration_only: true,
          abc_indicators_kept_separate: true
        }
      });
    }
    const population = results.map((row) => row.indicators?.C || {});
    const ranked = results.map((row) => ({
      ...row,
      mode: "portfolio",
      indicators: {
        ...row.indicators,
        A: row.data_state === "live_manual"
          ? {
              volume_percentile: roundNumber(percentileRank(row.indicators?.C?.volume_ratio, population.map((peer) => peer.volume_ratio)), 3),
              focus_notional_share_percentile: roundNumber(percentileRank(row.indicators?.C?.focus_notional_share, population.map((peer) => peer.focus_notional_share)), 3),
              net_notional_pressure_percentile: roundNumber(percentileRank(row.indicators?.C?.net_notional_pressure, population.map((peer) => peer.net_notional_pressure)), 3),
              scope_label: "relative to your live portfolio sample"
            }
          : null
      }
    })).sort((a, b) => {
      const aRank = Number(a.indicators?.A?.volume_percentile || 0) + Number(a.indicators?.A?.focus_notional_share_percentile || 0) + Number(a.indicators?.A?.net_notional_pressure_percentile || 0);
      const bRank = Number(b.indicators?.A?.volume_percentile || 0) + Number(b.indicators?.A?.focus_notional_share_percentile || 0) + Number(b.indicators?.A?.net_notional_pressure_percentile || 0);
      return bRank - aRank;
    });
    return {
      schema_version: "uta.portfolio.v1",
      mode: "portfolio",
      generated_at: new Date().toISOString(),
      data_state: "live_manual",
      source_mode: "live_manual",
      portfolio_ticker_count: tickers.length,
      requested_ticker_count: requested.length,
      truncated: requested.length > tickers.length,
      results: ranked
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

  async function getLiveScan(query = {}) {
    const fallbackUniverse = getUniverseFixture();
    const hasExplicitTickers = Array.isArray(query.tickers)
      ? query.tickers.length > 0
      : String(query.tickers || "").trim().length > 0;
    if (!hasExplicitTickers && !massiveApiKey(config)) {
      return {
        schema_version: "uta.scan_result.v1",
        mode: "scan",
        universe: fallbackUniverse.universe_id,
        universe_label: "S&P 500 live constituents",
        universe_ticker_count: null,
        requested_ticker_count: null,
        direction_filter: String(query.direction || "bullish").toLowerCase(),
        pass: 1,
        generated_at: new Date().toISOString(),
        data_state: "live_manual",
        performance_tier: "pi_bounded_full",
        shortlist_count: 0,
        results: [{
          ticker: "SP500",
          preliminary_tier: "D",
          B_estimate: {},
          C_screen: null,
          pass2_status: "blocked",
          label: "Full live scan blocked: MASSIVE_API_KEY or POLYGON_API_KEY is required.",
          data_state: "live_unavailable"
        }],
        scanned_count: 0,
        blocked_count: null,
        scan_policy: "Automatic S&P 500 pass 1 requires Massive grouped daily bars; no replay fallback is used in live mode.",
        scan_scope: "sp500_auto_full",
        universe_source: "not_loaded_missing_credentials",
        universe_cache_state: "not_loaded"
      };
    }
    const universe = hasExplicitTickers
      ? fallbackUniverse
      : await loadLiveSp500Universe(config, fallbackUniverse);
    const direction = String(query.direction || "bullish").toLowerCase();
    const requested = parseTickerList(query.tickers, universe.tickers.map((row) => row.symbol));
    const defaultLimit = hasExplicitTickers
      ? requested.length || 10
      : requested.length || Number(config.utaLiveScanMaxResults || 50);
    const maxLimit = hasExplicitTickers ? 25 : Math.max(25, Number(config.utaLiveScanMaxResults || 50));
    const limit = Math.max(1, Math.min(maxLimit, Number(query.limit || query.max_tickers || defaultLimit)));
    const tickers = requested.slice(0, limit);
    const rows = [];
    if (!hasExplicitTickers) {
      try {
        const grouped = await fetchMassiveGroupedDailyBars(config, recentCalendarDates(config.utaLiveScanGroupedDays || 32));
        const fullRows = requested.map((ticker) => {
          const summary = summarizeGroupedBarsForTicker(ticker, grouped.byTicker.get(ticker) || [], config.utaLiveScanBaselineSessions || 20);
          return summary.latest && summary.session_count >= Math.min(10, Number(config.utaLiveScanBaselineSessions || 20))
            ? liveScanRowFromSummary(summary, direction)
            : {
                ticker,
                preliminary_tier: "D",
                B_estimate: {},
                C_screen: null,
                pass2_status: "blocked",
                label: "Live scan blocked: insufficient grouped bar history",
                latest_bar_date: summary.latest?.date || null,
                data_state: "live_unavailable",
                preliminary_direction: direction,
                baseline_sessions: summary.session_count
              };
        });
        rows.push(...fullRows);
        const shortlistLimit = Math.max(1, Math.min(25, Number(query.shortlist_limit || config.utaLiveScanShortlistLimit || 10)));
        const ranked = rows
          .filter((row) => row.pass2_status === "pending")
          .sort((a, b) => Math.abs(Number(b.C_screen || 0)) - Math.abs(Number(a.C_screen || 0)));
        return {
          schema_version: "uta.scan_result.v1",
          mode: "scan",
          universe: universe.universe_id,
          universe_label: universe.label,
          universe_ticker_count: requested.length,
          requested_ticker_count: requested.length,
          direction_filter: direction,
          pass: 1,
          generated_at: new Date().toISOString(),
          data_state: "live_manual",
          performance_tier: universe.performance_tier || "pi_bounded_full",
          shortlist_count: Math.min(shortlistLimit, ranked.length),
          results: ranked.slice(0, shortlistLimit),
          scanned_count: rows.length,
          blocked_count: rows.filter((row) => row.pass2_status === "blocked").length,
          scan_policy: "Automatic S&P 500 pass 1 uses Massive grouped daily bars; pass 2 fetches trade prints only for the shortlist.",
          scan_scope: "sp500_auto_full",
          universe_source: universe.source,
          universe_cache_state: universe.cache_state || "unknown",
          universe_warning: universe.universe_warning || null,
          grouped_bar_dates: grouped.attempted_dates,
          grouped_empty_dates: grouped.empty_dates,
          grouped_failed_dates: grouped.failed_dates
        };
      } catch (error) {
        rows.push({
          ticker: "SP500",
          preliminary_tier: "D",
          B_estimate: {},
          C_screen: null,
          pass2_status: "blocked",
          label: `Full live scan blocked: ${error.message}`,
          data_state: "live_unavailable",
          preliminary_direction: direction
        });
        return {
          schema_version: "uta.scan_result.v1",
          mode: "scan",
          universe: universe.universe_id,
          universe_label: universe.label,
          universe_ticker_count: requested.length,
          requested_ticker_count: requested.length,
          direction_filter: direction,
          pass: 1,
          generated_at: new Date().toISOString(),
          data_state: "live_manual",
          performance_tier: universe.performance_tier || "pi_bounded_full",
          shortlist_count: 0,
          results: rows,
          scanned_count: 0,
          blocked_count: requested.length,
          scan_policy: "Automatic S&P 500 pass 1 requires Massive grouped daily bars; no replay fallback is used in live mode.",
          scan_scope: "sp500_auto_full",
          universe_source: universe.source,
          universe_cache_state: universe.cache_state || "unknown",
          universe_warning: universe.universe_warning || null
        };
      }
    }

    for (const ticker of tickers) {
      try {
        const summary = await fetchMassiveBarSummary(config, ticker);
        rows.push(liveScanRowFromSummary(summary, direction, "Preliminary - live Massive per-ticker bars"));
      } catch (error) {
        rows.push({
          ticker,
          preliminary_tier: "D",
          B_estimate: {},
          C_screen: null,
          pass2_status: "blocked",
          label: `Live scan blocked: ${error.message}`,
          data_state: "live_unavailable"
        });
      }
    }
    const shortlist = rows
      .filter((row) => row.pass2_status === "pending")
      .sort((a, b) => Math.abs(Number(b.C_screen || 0)) - Math.abs(Number(a.C_screen || 0)))
      .slice(0, Math.max(1, Math.min(10, Number(query.shortlist_limit || 5))));
    return {
      schema_version: "uta.scan_result.v1",
      mode: "scan",
      universe: universe.universe_id,
      universe_label: `${universe.label} live manual`,
      universe_ticker_count: tickers.length,
      requested_ticker_count: requested.length,
      direction_filter: direction,
      pass: 1,
      generated_at: new Date().toISOString(),
      data_state: "live_manual",
      performance_tier: "pi_bounded_manual",
      shortlist_count: shortlist.length,
      results: shortlist.length ? shortlist : rows.slice(0, 5),
      scanned_count: rows.length,
      blocked_count: rows.filter((row) => row.pass2_status === "blocked").length,
      scan_policy: "Custom pass 1 uses Massive per-ticker daily bars; pass 2 fetches trade prints for the shortlist.",
      scan_scope: "custom_ticker_list",
      universe_source: universe.source
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

  async function runLiveScanPass2(payload = {}) {
    const shortlist = parseTickerList(payload.shortlist, ["AVGO"]).slice(0, Math.max(1, Math.min(10, Number(payload.limit || 5))));
    const results = [];
    for (const ticker of shortlist) {
      const analysis = await getLiveSingleAnalysis(ticker);
      const trade = analysis.payload?.trade_analysis || {};
      const trigger = trade.trigger_summary || {};
      const activity = trade.activity || {};
      const pressure = trade.pressure || {};
      const setupStatus = trade.setup_status || (analysis.status === 200 ? "unknown" : "blocked");
      const tradeAction = trigger.trade_action || (analysis.status === 200 ? "no_trade" : "blocked");
      results.push({
        ticker,
        status: analysis.status === 200 ? setupStatus : "blocked",
        pass2_status: analysis.status === 200 ? "resolved" : "blocked",
        setup_status: setupStatus,
        bias: trade.bias || analysis.payload?.direction || "undetermined",
        trade_action: tradeAction,
        primary_trigger: trigger.primary_trigger || (analysis.status === 200 ? "No trigger" : "Live analysis unavailable"),
        next_trigger_needed: trigger.next_trigger_needed || (analysis.status === 200 ? "Review evidence detail." : "Restore live provider data."),
        anomaly_band: trade.anomaly_band || null,
        evidence_grade: trade.evidence_grade || analysis.payload?.tier || null,
        signed_pressure: pressure.net_notional_pressure ?? analysis.payload?.indicators?.C?.net_notional_pressure ?? null,
        signing_confidence: pressure.signing_confidence ?? analysis.payload?.signing_confidence ?? null,
        volume_ratio: activity.volume_ratio ?? analysis.payload?.indicators?.C?.volume_ratio ?? null,
        notional_ratio: activity.notional_ratio ?? analysis.payload?.indicators?.C?.notional_ratio ?? null,
        focus_trade_count: trade.block_flow?.focus_trade_count ?? analysis.payload?.indicators?.C?.focus_trade_count ?? null,
        result: analysis.status === 200 ? analysis.payload : null,
        error: analysis.status === 200 ? null : analysis.payload?.detail || analysis.payload?.error || "Live analysis unavailable"
      });
    }
    const universe = getUniverseFixture();
    return {
      schema_version: "uta.scan_result.v1",
      mode: "scan",
      universe: payload.universe || universe.universe_id,
      universe_label: `${universe.label} live manual`,
      universe_ticker_count: shortlist.length,
      direction_filter: payload.direction || "bullish",
      pass: 2,
      generated_at: new Date().toISOString(),
      data_state: "live_manual",
      performance_tier: "pi_bounded_manual",
      shortlist_count: shortlist.length,
      results
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
      mode: "live_only",
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
        { action: "run_single", label: "Run live single ticker cycle", safe: true },
        { action: "run_scan_pass1", label: "Run live scan pass 1", safe: true },
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

  async function revalidate(payload = {}) {
    const ticker = normalizeTickerSymbol(payload.ticker || "AVGO");
    const result = await buildCycle({ mode: "single", tickers: [ticker], body: payload, reason: "manual_revalidation" });
    emit("uta_revalidation", {
      ticker,
      cycle_id: result.cycle?.run_id || null,
      status: result.cycle?.status || "unknown",
      tier: result.payload?.tier || null
    });
    return result;
  }

  function getProviderStatus() {
    return buildProviderReadiness(config, getLaneRegistry().lanes);
  }

  async function runProviderPreflight(payload = {}) {
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
    const checks = [];
    for (const provider of providerStatus.provider_lanes) {
      const stateName = provider.configured ? "configured" : "missing_key";
      const sample = probeLive && provider.configured
        ? await runMassivePreflightSample(provider, config, ticker)
        : { state: stateName, sample_attempted: false, sample_count: null };
      checks.push({
        id: `${provider.lane_id}:${provider.provider_family}`,
        lane_id: provider.lane_id,
        label: provider.label,
        required: provider.required,
        provider_family: provider.provider_family,
        provider: provider.provider,
        enabled: provider.enabled,
        configured: provider.configured,
        state: sample.state || stateName,
        sample_attempted: Boolean(sample.sample_attempted),
        sample_ticker: ticker,
        sample_count: sample.sample_count ?? null,
        rate_limit_observed: sample.state === "rate_limited",
        mutation_allowed: false,
        trading_effect: "none",
        tier_effect_if_missing: provider.tier_effect_when_unavailable,
        error: sample.error || null,
        operator_copy: provider.configured
          ? probeLive
            ? "Provider was manually probed without writing UTA signal history."
            : "Provider is configured. Live sample probing remains disabled unless explicitly requested."
          : provider.operator_copy
      });
    }
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
        ? "manual_probe_completed"
        : "not_requested",
      ok: true,
      live_ready: providerStatus.live_ready && checks.filter((check) => check.required).every((check) => ["configured", "sample_ok"].includes(check.state)),
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
    getLiveSingleAnalysis,
    getPortfolioAnalysis,
    getLivePortfolioAnalysis,
    getScan,
    getLiveScan,
    runScanPass2,
    runLiveScanPass2,
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
