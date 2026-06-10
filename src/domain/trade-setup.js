import { clamp, round } from "../utils/helpers.js";
import { buildMacroRegimeSnapshot } from "./macro-regime.js";
import { filterFreshEvidence, shouldUseEvidence } from "./freshness-policy.js";

const BULLISH_FLOW_EVENT_TYPES = new Set([
  "insider_buy",
  "activist_stake",
  "institutional_buying",
  "abnormal_volume_buying",
  "block_trade_buying",
  "smart_money_accumulation",
  "smart_money_stacking_positive"
]);

const BEARISH_FLOW_EVENT_TYPES = new Set([
  "insider_sell",
  "institutional_selling",
  "abnormal_volume_selling",
  "block_trade_selling",
  "smart_money_distribution",
  "smart_money_stacking_negative"
]);

const RUNTIME_STATUS_PENALTIES = {
  healthy: 0,
  fallback: 0.05,
  manual: 0.035,
  pending: 0.05,
  polling: 0.015,
  stale: 0.08,
  degraded: 0.1,
  error: 0.14,
  disabled: 0.12
};

const RUNTIME_CRITICALITY_MULTIPLIERS = {
  critical: 1.2,
  high: 1,
  medium: 0.75,
  low: 0.45
};

const DIRECTION_GAP_MINIMUM = 0.08;
const WATCH_SCORE_THRESHOLD = 0.38;
const MIN_TRADABLE_SIGNAL_ITEMS = 2;
const MIN_TRADABLE_SIGNAL_SOURCES = 2;

function workflowTestMode(config = {}) {
  return Boolean(config?.selectionWorkflowTestMode);
}

function effectiveThreshold(baseThreshold, testThreshold, config = {}) {
  if (!workflowTestMode(config)) {
    return Number(baseThreshold);
  }
  const parsed = Number(testThreshold);
  return Number.isFinite(parsed) ? Math.min(Number(baseThreshold), parsed) : Number(baseThreshold);
}

function effectiveDirectionGap(config = {}) {
  if (!workflowTestMode(config)) {
    return DIRECTION_GAP_MINIMUM;
  }
  const parsed = Number(config.selectionWorkflowTestDirectionGap);
  return Number.isFinite(parsed) ? parsed : DIRECTION_GAP_MINIMUM;
}

function effectiveWatchThreshold(config = {}) {
  if (!workflowTestMode(config)) {
    return WATCH_SCORE_THRESHOLD;
  }
  const parsed = Number(config.selectionWorkflowTestWatchThreshold);
  return Number.isFinite(parsed) ? parsed : WATCH_SCORE_THRESHOLD;
}

function buildDocumentLookup(store) {
  return new Map(store.normalizedDocuments.map((doc) => [doc.doc_id, doc]));
}

function buildSentimentByTicker(store, window) {
  return new Map(
    store.sentimentStates
      .filter((state) => state.entity_type === "ticker" && state.window === window)
      .filter((state) => shouldUseEvidence({ published_at: state.as_of, source_type: "sentiment_state" }, store.config))
      .map((state) => [state.entity_key, state])
  );
}

function buildFundamentalsByTicker(store) {
  return new Map((store.fundamentals?.leaderboard || []).map((row) => [row.ticker, row]));
}

function buildRecentTickerDocuments(store, documentLookup, ticker, limit = 8) {
  return store.documentScores
    .map((score) => {
      const normalized = documentLookup.get(score.doc_id);
      if (!normalized || normalized.primary_ticker !== ticker) {
        return null;
      }

      if (!shouldUseEvidence(normalized, store.config)) {
        return null;
      }

      return {
        event_type: score.event_type,
        label: score.bullish_bearish_label,
        confidence: score.final_confidence,
        evidence_quality: score.evidence_quality || null,
        display_tier: score.display_tier || score.evidence_quality?.display_tier || null,
        downstream_weight: score.downstream_weight ?? score.evidence_quality?.downstream_weight ?? null,
        impact_score: score.impact_score,
        sentiment_score: score.sentiment_score,
        headline: normalized.headline,
        source_name: normalized.source_name,
        published_at: normalized.published_at,
        explanation_short: score.explanation_short,
        source_metadata: normalized.source_metadata || null,
        url: normalized.canonical_url
      };
    })
    .filter(Boolean)
    .filter((item) => item.display_tier !== "suppress")
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
    .slice(0, limit);
}

function latestAlertTimestamp(alert) {
  return alert.created_at || alert.detected_at || null;
}

function evidenceFlowWeight(item) {
  const baseWeight = Number(item.downstream_weight ?? item.evidence_quality?.downstream_weight ?? 0.5);
  const tierMultiplier =
    item.display_tier === "alert"
      ? 1
      : item.display_tier === "context"
        ? 0.45
        : 0.7;
  return clamp(baseWeight, 0, 1) * tierMultiplier;
}

function isMoneyFlowItem(item) {
  return BULLISH_FLOW_EVENT_TYPES.has(item.event_type) || BEARISH_FLOW_EVENT_TYPES.has(item.event_type);
}

function isDirectMoneyFlowEvidence(item) {
  const observationLevel = item.evidence_quality?.observation_level;
  const sourceName = String(item.source_name || "").toLowerCase();
  return (
    ["official_filing", "delayed_trade_prints"].includes(observationLevel) ||
    sourceName === "massive_trades" ||
    sourceName === "polygon_trades" ||
    sourceName === "iex_trades" ||
    sourceName === "sec_edgar"
  );
}

function decisionEvidenceDocuments(docs = []) {
  return docs.filter((item) => {
    const tier = item.display_tier || item.evidence_quality?.display_tier || null;
    const weight = Number(item.downstream_weight ?? item.evidence_quality?.downstream_weight ?? 0);
    return ["alert", "watch"].includes(tier) && weight >= 0.45;
  });
}

function evidenceSourceKey(item = {}) {
  return String(item.source_name || item.evidence_quality?.source_name || item.source_metadata?.collector || "").trim().toLowerCase();
}

function buildSignalBreadth({ docs = [], directFlowCount = 0, config = {} } = {}) {
  const decisionDocs = decisionEvidenceDocuments(docs);
  const sourceCount = new Set(decisionDocs.map(evidenceSourceKey).filter(Boolean)).size;
  const minimum_items = Math.max(1, Number(config.selectionMinSignalEvidenceItems || MIN_TRADABLE_SIGNAL_ITEMS));
  const minimum_sources = Math.max(1, Number(config.selectionMinSignalEvidenceSources || MIN_TRADABLE_SIGNAL_SOURCES));
  const pass = decisionDocs.length >= minimum_items && sourceCount >= minimum_sources;
  const reason = pass
    ? null
    : `insufficient signal breadth: ${decisionDocs.length}/${minimum_items} fresh alert/watch documents and ${sourceCount}/${minimum_sources} independent sources`;

  return {
    breadth_gate_pass: pass,
    reason,
    usable_signal_items: decisionDocs.length,
    source_count: sourceCount,
    direct_flow_items: directFlowCount,
    minimum_items,
    minimum_sources
  };
}

function pricePlan(action, currentPrice, conviction, beta = 1) {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return {
      current_price: null,
      entry_zone: null,
      stop_loss: null,
      take_profit: null
    };
  }

  const normalizedBeta = clamp(Number(beta) || 1, 0.7, 2.2);
  const riskPct = clamp(0.025 + (1 - conviction) * 0.055 + (normalizedBeta - 1) * 0.015, 0.025, 0.1);
  const entryDriftPct = clamp(riskPct * 0.3, 0.008, 0.025);
  const rewardPct = riskPct * (action === "watch" ? 1.2 : 2.1);

  if (action === "short") {
    return {
      current_price: round(currentPrice, 2),
      entry_zone: {
        low: round(currentPrice, 2),
        high: round(currentPrice * (1 + entryDriftPct), 2),
        bias: "sell_strength"
      },
      stop_loss: round(currentPrice * (1 + riskPct), 2),
      take_profit: round(currentPrice * (1 - rewardPct), 2)
    };
  }

  return {
    current_price: round(currentPrice, 2),
    entry_zone: {
      low: round(currentPrice * (1 - entryDriftPct), 2),
      high: round(currentPrice, 2),
      bias: action === "watch" ? "wait_for_pullback" : "buy_pullback"
    },
    stop_loss: round(currentPrice * (1 - riskPct), 2),
    take_profit: round(currentPrice * (1 + rewardPct), 2)
  };
}

function positionSizePct(action, conviction, hasFundamentalSupport, macroRegimeSnapshot) {
  if (action === "watch" || action === "no_trade") {
    return 0;
  }

  const base = hasFundamentalSupport ? 0.01 : 0.005;
  const size = base + clamp(conviction - 0.5, 0, 0.45) * 0.08;
  const exposureMultiplier = Number(macroRegimeSnapshot?.exposure_multiplier || 1);
  return round(clamp(size * exposureMultiplier, 0.003, 0.06), 4);
}

function timeframeLabel(sentimentRow, flowBalance, action, macroRegimeSnapshot) {
  if (macroRegimeSnapshot?.regime_label === "high_dispersion") {
    return action === "watch" ? "monitor_intraday_to_3d" : "tactical_1d_to_5d";
  }
  if (Math.abs(flowBalance) >= 2 || Math.abs(sentimentRow?.momentum_delta || 0) >= 0.3) {
    return action === "watch" ? "monitor_intraday_to_3d" : "tactical_1d_to_5d";
  }

  if (Math.abs(sentimentRow?.weighted_sentiment || 0) >= 0.35) {
    return action === "watch" ? "monitor_3d_to_2w" : "swing_3d_to_2w";
  }

  return action === "watch" ? "monitor_multiweek" : "position_1w_to_4w";
}

function setupLabel(action, longScore, shortScore, screenStage) {
  if (action === "long") {
    return screenStage === "eligible" ? "confirmed_long" : "tactical_long";
  }
  if (action === "short") {
    return shortScore >= 0.72 ? "high_conviction_short" : "tactical_short";
  }
  if (action === "watch") {
    return longScore >= shortScore ? "bullish_watch" : "bearish_watch";
  }
  return "no_trade";
}

function summarizeSetup(action, setupLabelValue, ticker, conviction) {
  if (action === "long") {
    return `${ticker} is a ${setupLabelValue.replace(/_/g, " ")} with ${Math.round(conviction * 100)}% conviction.`;
  }
  if (action === "short") {
    return `${ticker} sets up as a ${setupLabelValue.replace(/_/g, " ")} with ${Math.round(conviction * 100)}% conviction.`;
  }
  if (action === "watch") {
    return `${ticker} is worth monitoring, but it does not clear the final trade threshold yet.`;
  }
  return `${ticker} does not currently justify a trade.`;
}

function runtimeSourcePenalty(source) {
  if (!source || source.category === "storage") {
    return 0;
  }

  if (source.status === "polling") {
    return 0;
  }

  if (source.status === "disabled" && source.enabled === false) {
    return 0;
  }

  const basePenalty = RUNTIME_STATUS_PENALTIES[source.status] ?? 0.04;
  const criticalityMultiplier = RUNTIME_CRITICALITY_MULTIPLIERS[source.criticality] ?? 0.75;
  return basePenalty * criticalityMultiplier;
}

function buildRuntimeReliabilityAdjustment(runtimeReliabilitySnapshot) {
  if (!runtimeReliabilitySnapshot) {
    return {
      status: "unknown",
      adjustment_multiplier: 1,
      penalty: 0,
      source_penalty: 0,
      pressure_penalty: 0,
      constrained: false,
      degraded_sources: [],
      reason_codes: []
    };
  }

  const sources = runtimeReliabilitySnapshot.sources || [];
  const sourcePenalties = sources
    .filter((source) => source.category !== "storage")
    .map((source) => ({
      key: source.key,
      label: source.label,
      status: source.status,
      enabled: source.enabled,
      action: source.action,
      penalty: runtimeSourcePenalty(source),
      reason: source.reason
    }))
    .filter((source) => source.penalty > 0)
    .sort((a, b) => b.penalty - a.penalty);

  const sourcePenalty = clamp(
    sourcePenalties.reduce((sum, source) => sum + source.penalty, 0),
    0,
    0.32
  );
  const pressure = runtimeReliabilitySnapshot.pressure || {};
  const statusPenalty =
    runtimeReliabilitySnapshot.status === "degraded"
      ? 0.08
      : ["constrained", "caution"].includes(runtimeReliabilitySnapshot.status)
        ? 0.035
        : 0;
  const pressurePenalty = (pressure.isConstrained ? 0.04 : 0) + statusPenalty;
  const penalty = clamp(sourcePenalty + pressurePenalty, 0, 0.42);
  const reasonCodes = [];

  if (pressure.isConstrained) {
    reasonCodes.push("runtime_constrained");
  }
  if (sourcePenalties.some((source) => source.status === "fallback")) {
    reasonCodes.push("fallback_source_active");
  }
  if (sourcePenalties.some((source) => source.status === "manual")) {
    reasonCodes.push("manual_source_active");
  }
  if (sourcePenalties.some((source) => ["stale", "degraded", "error", "disabled"].includes(source.status))) {
    reasonCodes.push("source_health_penalty");
  }

  return {
    status: runtimeReliabilitySnapshot.status || "unknown",
    adjustment_multiplier: round(clamp(1 - penalty, 0.58, 1), 3),
    penalty: round(penalty, 3),
    source_penalty: round(sourcePenalty, 3),
    pressure_penalty: round(pressurePenalty, 3),
    constrained: Boolean(pressure.isConstrained),
    degraded_sources: sourcePenalties.slice(0, 5).map((source) => ({
      key: source.key,
      label: source.label,
      status: source.status,
      action: source.action,
      penalty: round(source.penalty, 3),
      reason: source.reason
    })),
    reason_codes: reasonCodes
  };
}

function buildDecisionBlockers({ action, longScore, shortScore, longThreshold, shortThreshold, directionGap, watchThreshold }) {
  if (action === "long" || action === "short") {
    return [];
  }

  const blockers = [];
  const longGapTarget = shortScore + directionGap;
  const shortGapTarget = longScore + directionGap;

  if (longScore < longThreshold) {
    blockers.push({
      key: "long_below_threshold",
      detail: "Long score is below the current market-regime threshold.",
      value: round(longScore, 3),
      threshold: round(longThreshold, 3),
      gap: round(longThreshold - longScore, 3)
    });
  }

  if (longScore < longGapTarget) {
    blockers.push({
      key: "long_direction_gap_too_small",
      detail: "Long score does not exceed short score by the required decision gap.",
      value: round(longScore, 3),
      threshold: round(longGapTarget, 3),
      gap: round(longGapTarget - longScore, 3)
    });
  }

  if (shortScore < shortThreshold) {
    blockers.push({
      key: "short_below_threshold",
      detail: "Short score is below the current market-regime threshold.",
      value: round(shortScore, 3),
      threshold: round(shortThreshold, 3),
      gap: round(shortThreshold - shortScore, 3)
    });
  }

  if (shortScore < shortGapTarget) {
    blockers.push({
      key: "short_direction_gap_too_small",
      detail: "Short score does not exceed long score by the required decision gap.",
      value: round(shortScore, 3),
      threshold: round(shortGapTarget, 3),
      gap: round(shortGapTarget - shortScore, 3)
    });
  }

  if (Math.max(longScore, shortScore) < watchThreshold) {
    blockers.push({
      key: "below_watch_threshold",
      detail: "Best directional score is below the watch threshold.",
      value: round(Math.max(longScore, shortScore), 3),
      threshold: watchThreshold,
      gap: round(watchThreshold - Math.max(longScore, shortScore), 3)
    });
  }

  return blockers;
}

function computeSetup({
  ticker,
  sentimentRow,
  fundamentalRow,
  docs,
  alerts,
  macroRegimeSnapshot,
  runtimeReliabilitySnapshot,
  earningsCalendar,
  config = {}
}) {
  const companyName = fundamentalRow?.company_name || sentimentRow?.entity_name || ticker;
  const sector = fundamentalRow?.sector || "Unknown";
  const currentPrice = Number(fundamentalRow?.market_reference?.current_price) || null;
  const beta = Number(fundamentalRow?.market_reference?.beta) || 1;
  const screenStage = fundamentalRow?.initial_screen?.stage || "unknown";
  const directionLabel = fundamentalRow?.direction_label || "neutral";
  const ratingLabel = fundamentalRow?.rating_label || "unknown";
  const finalConfidence = Number(fundamentalRow?.final_confidence ?? sentimentRow?.weighted_confidence ?? 0);
  const weightedSentiment = Number(sentimentRow?.weighted_sentiment || 0);
  const momentumDelta = Number(sentimentRow?.momentum_delta || 0);
  const storyVelocity = Number(sentimentRow?.story_velocity || 0);
  const sentimentConfidence = Number(sentimentRow?.weighted_confidence || 0);
  const fundamentalScore = Number(fundamentalRow?.composite_fundamental_score || 0);
  const anomalyPenalty = Number(fundamentalRow?.anomaly_penalty || 0);
  const bullishFlowItems = docs.filter((item) => BULLISH_FLOW_EVENT_TYPES.has(item.event_type));
  const bearishFlowItems = docs.filter((item) => BEARISH_FLOW_EVENT_TYPES.has(item.event_type));
  const bullishFlowCount = bullishFlowItems.length;
  const bearishFlowCount = bearishFlowItems.length;
  const bullishFlowWeight = bullishFlowItems.reduce((sum, item) => sum + evidenceFlowWeight(item), 0);
  const bearishFlowWeight = bearishFlowItems.reduce((sum, item) => sum + evidenceFlowWeight(item), 0);
  const flowBalance = bullishFlowWeight - bearishFlowWeight;
  const qualityAverage = docs.length
    ? docs.reduce((sum, item) => sum + Number(item.downstream_weight ?? item.evidence_quality?.downstream_weight ?? 0.5), 0) / docs.length
    : 0.45;
  const alertQualityCount = docs.filter((item) => item.display_tier === "alert").length;
  const weakQualityCount = docs.filter((item) => ["context", "suppress"].includes(item.display_tier)).length;
  const moneyFlowItems = docs.filter(isMoneyFlowItem);
  const inferredFlowCount = moneyFlowItems.filter((item) => item.evidence_quality?.observation_level === "bar_derived_inferred").length;
  const directFlowCount = moneyFlowItems.filter(isDirectMoneyFlowEvidence).length;
  const rssHeadlineCount = docs.filter((item) => item.evidence_quality?.observation_level === "rss_headline_only").length;
  const signalBreadth = buildSignalBreadth({ docs, directFlowCount, config });

  let longScore = 0;
  let shortScore = 0;
  const thesis = [];
  const riskFlags = [];
  const positiveEvidence = [];
  const negativeEvidence = [];

  longScore += clamp(weightedSentiment, 0, 1) * 0.32;
  shortScore += clamp(-weightedSentiment, 0, 1) * 0.32;
  longScore += clamp(momentumDelta, 0, 0.4) * 0.35;
  shortScore += clamp(-momentumDelta, 0, 0.4) * 0.35;
  longScore += sentimentConfidence * 0.16;
  shortScore += sentimentConfidence * 0.16;
  longScore += clamp(storyVelocity / 6, 0, 1) * 0.05;
  shortScore += clamp(storyVelocity / 6, 0, 1) * 0.05;
  longScore *= clamp(0.72 + qualityAverage * 0.38, 0.72, 1.1);
  shortScore *= clamp(0.72 + qualityAverage * 0.38, 0.72, 1.1);

  if (qualityAverage < 0.45) {
    riskFlags.push("supporting evidence quality is thin");
  }
  if (alertQualityCount > 0) {
    positiveEvidence.push(`${alertQualityCount} high-quality evidence item${alertQualityCount === 1 ? "" : "s"}`);
  }
  if (weakQualityCount > 0) {
    riskFlags.push(`${weakQualityCount} recent evidence item${weakQualityCount === 1 ? " is" : "s are"} low signal or context-only`);
  }
  if (inferredFlowCount > 0 && directFlowCount === 0) {
    riskFlags.push("money-flow evidence is inferred from bars only; no direct trade-print, insider, or filing confirmation");
  }
  if (rssHeadlineCount > 0) {
    riskFlags.push(`${rssHeadlineCount} news item${rssHeadlineCount === 1 ? " is" : "s are"} RSS/headline matched and should be source-checked`);
  }

  if (flowBalance > 0) {
    longScore += clamp(flowBalance / 4, 0, 0.18);
    positiveEvidence.push(`${bullishFlowCount} supportive money-flow signal${bullishFlowCount === 1 ? "" : "s"}`);
  }
  if (flowBalance < 0) {
    shortScore += clamp(Math.abs(flowBalance) / 4, 0, 0.18);
    negativeEvidence.push(`${bearishFlowCount} adverse money-flow signal${bearishFlowCount === 1 ? "" : "s"}`);
  }

  if (fundamentalRow) {
    if (screenStage === "eligible") {
      longScore += 0.18;
      positiveEvidence.push("passes the stage-one screener");
    } else if (screenStage === "watch") {
      longScore += 0.06;
      riskFlags.push("only clears watch-stage fundamentals");
    } else if (screenStage === "reject") {
      shortScore += 0.12;
      riskFlags.push("fails the stage-one screener");
    }

    if (directionLabel === "bullish_supportive") {
      longScore += 0.14;
      positiveEvidence.push("fundamental direction is supportive");
    }
    if (directionLabel === "bearish_headwind") {
      shortScore += 0.14;
      negativeEvidence.push("fundamental direction is a headwind");
    }

    if (ratingLabel === "fundamentally_strong") {
      longScore += 0.12;
    }
    if (ratingLabel === "deteriorating" || ratingLabel === "weak") {
      shortScore += 0.1;
      negativeEvidence.push(`fundamental rating is ${ratingLabel.replace(/_/g, " ")}`);
    }

    longScore += clamp(fundamentalScore - 0.5, 0, 0.3) * 0.28;
    shortScore += clamp(0.45 - fundamentalScore, 0, 0.3) * 0.34;

    if (anomalyPenalty >= 0.15) {
      shortScore += 0.08;
      riskFlags.push("anomaly penalty is elevated");
    }

    if (Array.isArray(fundamentalRow.reason_codes)) {
      if (fundamentalRow.reason_codes.includes("premium_valuation")) {
        shortScore += 0.07;
        riskFlags.push("valuation is stretched");
      }
      if (fundamentalRow.reason_codes.includes("comparability_risk")) {
        riskFlags.push("comparability risk is elevated");
      }
      if (fundamentalRow.reason_codes.includes("balance_sheet_pressure")) {
        riskFlags.push("balance sheet needs monitoring");
      }
    }
  }

  if (alerts.some((item) => item.alert_type === "high_confidence_positive")) {
    longScore += 0.08;
    positiveEvidence.push("recent positive high-confidence alert");
  }
  if (alerts.some((item) => item.alert_type === "high_confidence_negative")) {
    shortScore += 0.08;
    negativeEvidence.push("recent negative high-confidence alert");
  }
  if (alerts.some((item) => item.alert_type === "polarity_reversal")) {
    riskFlags.push("recent polarity reversal raises timing risk");
  }

  const earnings = earningsCalendar?.get(ticker);
  if (earnings?.days_until !== null && earnings?.days_until !== undefined) {
    const daysUntilEarnings = Number(earnings.days_until);
    if (Number.isFinite(daysUntilEarnings) && daysUntilEarnings >= 0 && daysUntilEarnings <= 7) {
      riskFlags.push("earnings_in_window");
    }
  }

  if (macroRegimeSnapshot) {
    if (macroRegimeSnapshot.regime_label === "risk_on") {
      longScore += 0.08;
      shortScore -= 0.03;
      positiveEvidence.push("macro regime is risk on");
    } else if (macroRegimeSnapshot.regime_label === "risk_off") {
      shortScore += 0.08;
      longScore -= 0.03;
      negativeEvidence.push("macro regime is risk off");
    } else if (macroRegimeSnapshot.regime_label === "high_dispersion") {
      riskFlags.push("macro regime is highly selective");
    }
  }

  longScore = clamp(longScore, 0, 1);
  shortScore = clamp(shortScore, 0, 1);

  const rawLongScore = round(longScore, 3);
  const rawShortScore = round(shortScore, 3);
  const runtimeAdjustment = buildRuntimeReliabilityAdjustment(runtimeReliabilitySnapshot);
  const testModeActive = workflowTestMode(config);
  const runtimeMultiplier = runtimeAdjustment.adjustment_multiplier;

  if (runtimeMultiplier < 0.995) {
    longScore = clamp(longScore * runtimeMultiplier, 0, 1);
    shortScore = clamp(shortScore * runtimeMultiplier, 0, 1);
    riskFlags.push(`runtime reliability reduces conviction by ${Math.round((1 - runtimeMultiplier) * 100)}%`);
    runtimeAdjustment.degraded_sources.slice(0, 3).forEach((source) => {
      riskFlags.push(`${source.label} is ${source.status.replace(/_/g, " ")}`);
    });
  }

  if (weightedSentiment >= 0.25) {
    thesis.push("short-term sentiment is supportive");
  } else if (weightedSentiment <= -0.25) {
    thesis.push("short-term sentiment is decisively negative");
  }

  if (flowBalance > 0) {
    thesis.push("money-flow evidence is skewed to accumulation");
  } else if (flowBalance < 0) {
    thesis.push("money-flow evidence is skewed to distribution");
  }

  if (fundamentalRow?.initial_screen?.summary) {
    thesis.push(fundamentalRow.initial_screen.summary);
  }
  if (macroRegimeSnapshot?.summary) {
    thesis.push(macroRegimeSnapshot.summary);
  }

  const bestScore = round(Math.max(longScore, shortScore), 3);
  const scoreGap = round(Math.abs(longScore - shortScore), 3);
  const productionLongThreshold = Number(macroRegimeSnapshot?.long_threshold || 0.56);
  const productionShortThreshold = Number(macroRegimeSnapshot?.short_threshold || 0.56);
  const longThreshold = effectiveThreshold(productionLongThreshold, config.selectionWorkflowTestLongThreshold, config);
  const shortThreshold = effectiveThreshold(productionShortThreshold, config.selectionWorkflowTestShortThreshold, config);
  const directionGapMinimum = effectiveDirectionGap(config);
  const watchThreshold = effectiveWatchThreshold(config);
  let action = "no_trade";

  if (longScore >= longThreshold && longScore >= shortScore + directionGapMinimum) {
    action = "long";
  } else if (shortScore >= shortThreshold && shortScore >= longScore + directionGapMinimum) {
    action = "short";
  } else if (bestScore >= watchThreshold) {
    action = "watch";
  }

  const signalBreadthBlocksTrade = (action === "long" || action === "short") && !signalBreadth.breadth_gate_pass;
  if (signalBreadthBlocksTrade) {
    riskFlags.unshift(signalBreadth.reason);
    action = bestScore >= watchThreshold ? "watch" : "no_trade";
  }

  const conviction = action === "watch" ? clamp(bestScore * 0.88, 0, 0.74) : clamp(bestScore, 0, 0.95);
  const hasFundamentalSupport = screenStage === "eligible" && directionLabel !== "bearish_headwind";
  const tradePlan = pricePlan(action, currentPrice, conviction, beta);
  const setupLabelValue = setupLabel(action, longScore, shortScore, screenStage);
  if (testModeActive) {
    riskFlags.push("workflow test mode lowered selection thresholds for supervised end-to-end testing");
  }
  const decisionBlockers = buildDecisionBlockers({
    action,
    longScore,
    shortScore,
    longThreshold,
    shortThreshold,
    directionGap: directionGapMinimum,
    watchThreshold
  });
  if (signalBreadthBlocksTrade) {
    decisionBlockers.unshift({
      key: "insufficient_signal_breadth",
      detail: "A buy/sell setup needs enough fresh ticker-level evidence breadth before it can become tradable.",
      value: signalBreadth.usable_signal_items,
      threshold: signalBreadth.minimum_items,
      source_count: signalBreadth.source_count,
      source_threshold: signalBreadth.minimum_sources
    });
  }

  return {
    ticker,
    company_name: companyName,
    sector,
    action,
    setup_label: setupLabelValue,
    conviction: round(conviction, 3),
    position_size_pct: positionSizePct(action, conviction, hasFundamentalSupport, macroRegimeSnapshot),
    timeframe: timeframeLabel(sentimentRow, flowBalance, action, macroRegimeSnapshot),
    current_price: tradePlan.current_price,
    entry_zone: tradePlan.entry_zone,
    stop_loss: tradePlan.stop_loss,
    take_profit: tradePlan.take_profit,
    summary: summarizeSetup(action, setupLabelValue, ticker, conviction),
    thesis: [...new Set(thesis)].slice(0, 5),
    risk_flags: [...new Set(riskFlags)].slice(0, 6),
    evidence: {
      positive: [...new Set(positiveEvidence)].slice(0, 5),
      negative: [...new Set(negativeEvidence)].slice(0, 5)
    },
    score_components: {
      long: round(longScore, 3),
      short: round(shortScore, 3),
      gap: scoreGap,
      raw_long: rawLongScore,
      raw_short: rawShortScore,
      runtime_multiplier: runtimeMultiplier
    },
    decision_thresholds: {
      long_threshold: round(longThreshold, 3),
      short_threshold: round(shortThreshold, 3),
      direction_gap_minimum: round(directionGapMinimum, 3),
      watch_threshold: round(watchThreshold, 3),
      production_long_threshold: round(productionLongThreshold, 3),
      production_short_threshold: round(productionShortThreshold, 3),
      workflow_test_mode: testModeActive,
      best_score: bestScore,
      score_gap: scoreGap,
      long_missing_to_threshold: round(Math.max(0, longThreshold - longScore), 3),
      short_missing_to_threshold: round(Math.max(0, shortThreshold - shortScore), 3)
    },
    decision_blockers: decisionBlockers,
    evidence_breadth: signalBreadth,
    runtime_reliability: testModeActive
      ? {
          ...runtimeAdjustment,
          test_mode: true,
          test_mode_note: "Selection thresholds are lowered for supervised end-to-end workflow testing."
        }
      : runtimeAdjustment,
    macro_regime: macroRegimeSnapshot
      ? {
          regime_label: macroRegimeSnapshot.regime_label,
          bias_label: macroRegimeSnapshot.bias_label,
          exposure_multiplier: macroRegimeSnapshot.exposure_multiplier,
          long_threshold: macroRegimeSnapshot.long_threshold,
          short_threshold: macroRegimeSnapshot.short_threshold
        }
      : null,
    sentiment: sentimentRow
      ? {
          window: sentimentRow.window,
          weighted_sentiment: round(weightedSentiment, 4),
          confidence: round(sentimentConfidence, 3),
          momentum_delta: round(momentumDelta, 4),
          story_velocity: round(storyVelocity, 3),
          top_event_types: sentimentRow.top_event_types || [],
          top_reasons: sentimentRow.top_reasons || []
        }
      : null,
    fundamentals: fundamentalRow
      ? {
          composite_fundamental_score: round(fundamentalScore, 3),
          final_confidence: round(finalConfidence, 3),
          screen_stage: screenStage,
          direction_label: directionLabel,
          rating_label: ratingLabel
        }
      : null,
    recent_documents: docs.slice(0, 4),
    evidence_quality: {
      average_downstream_weight: round(qualityAverage, 3),
      alert_quality_items: alertQualityCount,
      weak_quality_items: weakQualityCount,
      inferred_flow_items: inferredFlowCount,
      direct_flow_items: directFlowCount,
      rss_headline_items: rssHeadlineCount
    },
    recent_alerts: alerts.slice(0, 3).map((item) => ({
      alert_type: item.alert_type,
      headline: item.headline,
      confidence: item.confidence,
      created_at: latestAlertTimestamp(item)
    }))
  };
}

function actionRank(action) {
  if (action === "long") {
    return 0;
  }
  if (action === "short") {
    return 1;
  }
  if (action === "watch") {
    return 2;
  }
  return 3;
}

export function buildTradeSetupsSnapshot(
  store,
  {
    window = "1h",
    limit = 12,
    minConviction = 0.35,
    action = null,
    macroRegimeSnapshot = null,
    runtimeReliabilitySnapshot = null
  } = {}
) {
  const sentimentByTicker = buildSentimentByTicker(store, window);
  const fundamentalsByTicker = buildFundamentalsByTicker(store);
  const allTickers = [...new Set([...sentimentByTicker.keys(), ...fundamentalsByTicker.keys()])];
  const documentLookup = buildDocumentLookup(store);
  const regimeSnapshot = macroRegimeSnapshot || buildMacroRegimeSnapshot(store, { window });

  const setups = allTickers
    .map((ticker) =>
      computeSetup({
        ticker,
        sentimentRow: sentimentByTicker.get(ticker) || null,
        fundamentalRow: fundamentalsByTicker.get(ticker) || null,
        docs: buildRecentTickerDocuments(store, documentLookup, ticker),
        alerts: filterFreshEvidence(store.alertHistory, store.config)
          .filter((item) => item.entity_key === ticker)
          .sort((a, b) => new Date(latestAlertTimestamp(b) || 0) - new Date(latestAlertTimestamp(a) || 0)),
        macroRegimeSnapshot: regimeSnapshot,
        runtimeReliabilitySnapshot,
        earningsCalendar: store.earningsCalendar,
        config: store.config
      })
    )
    .filter((setup) => setup.conviction >= minConviction)
    .filter((setup) => (action ? setup.action === action : true))
    .sort((a, b) => {
      const rankDelta = actionRank(a.action) - actionRank(b.action);
      if (rankDelta !== 0) {
        return rankDelta;
      }
      return b.conviction - a.conviction;
    });

  return {
    as_of: store.health.lastUpdate || new Date().toISOString(),
    window,
    macro_regime: {
      regime_label: regimeSnapshot.regime_label,
      bias_label: regimeSnapshot.bias_label,
      exposure_multiplier: regimeSnapshot.exposure_multiplier
    },
    runtime_reliability: runtimeReliabilitySnapshot
      ? {
          status: runtimeReliabilitySnapshot.status,
          summary: runtimeReliabilitySnapshot.summary,
          source_counts: runtimeReliabilitySnapshot.source_counts,
          pressure: runtimeReliabilitySnapshot.pressure
        }
      : null,
    counts: {
      tracked_tickers: allTickers.length,
      sentiment_tickers: sentimentByTicker.size,
      fundamental_tickers: fundamentalsByTicker.size,
      long: setups.filter((item) => item.action === "long").length,
      short: setups.filter((item) => item.action === "short").length,
      watch: setups.filter((item) => item.action === "watch").length,
      no_trade: setups.filter((item) => item.action === "no_trade").length
    },
    setups: setups.slice(0, limit)
  };
}

export function createTradeSetupAgent({ store, getMacroRegime, getRuntimeReliability }) {
  function getTradeSetups(options = {}) {
    return buildTradeSetupsSnapshot(store, {
      ...options,
      macroRegimeSnapshot: getMacroRegime ? getMacroRegime({ window: options.window || "1h" }) : null,
      runtimeReliabilitySnapshot: getRuntimeReliability ? getRuntimeReliability() : null
    });
  }

  function getTickerSetup(ticker, options = {}) {
    const response = getTradeSetups({
      ...options,
      limit: Math.max(250, options.limit || 250),
      minConviction: 0
    });
    return response.setups.find((item) => item.ticker === ticker) || null;
  }

  return {
    getTradeSetups,
    getTickerSetup
  };
}
