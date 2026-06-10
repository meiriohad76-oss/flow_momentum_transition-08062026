import { clamp, makeId, round } from "../utils/helpers.js";
import { filterFreshEvidence } from "./freshness-policy.js";

const SOURCE_TYPE_WEIGHTS = {
  filing: 0.96,
  sec: 0.96,
  insider: 0.92,
  institutional: 0.88,
  market_flow: 0.82,
  market_data: 0.82,
  news: 0.68,
  news_api: 0.68,
  rss: 0.62,
  macro: 0.72,
  synthetic: 0.35
};

function reliabilityContext(normalized = {}, score = {}) {
  const sourceName = String(normalized.source_name || "").toLowerCase();
  const sourceType = String(normalized.source_type || "").toLowerCase();
  const metadata = normalized.source_metadata || {};
  const collector = String(metadata.collector || "").toLowerCase();
  const eventType = String(score.event_type || "").toLowerCase();
  const warnings = [];
  let observationLevel = "unverified_signal";
  let verificationStatus = "unverified";
  let multiplier = 0.72;

  if (
    ["filing", "sec", "insider", "institutional"].includes(sourceType) ||
    sourceName === "sec_edgar" ||
    /sec/.test(collector)
  ) {
    observationLevel = "official_filing";
    verificationStatus = "verified_official_source";
    multiplier = 1;
  } else if (sourceName === "massive_trades" || sourceName === "polygon_trades" || sourceName === "iex_trades" || /trade_prints/.test(collector)) {
    observationLevel = "delayed_trade_prints";
    verificationStatus = "direct_trade_prints_delayed";
    multiplier = ["massive_trades", "polygon_trades"].includes(sourceName) ? 0.86 : 0.8;
    warnings.push("Trade-print direction is inferred from print price versus a reference price; it is not full order-book aggressor data.");
  } else if (sourceName === "market_flow" || sourceType === "market_flow" || collector === "market_flow") {
    observationLevel = "bar_derived_inferred";
    verificationStatus = "inferred_from_ohlcv";
    multiplier = 0.56;
    warnings.push("Market-flow radar is inferred from price/volume bars, not direct exchange block prints.");
  } else if (sourceName === "marketaux" || collector === "marketaux_news") {
    observationLevel = "provider_linked_news";
    verificationStatus =
      metadata.marketaux_entity_symbol || Number(metadata.marketaux_entity_match_score || 0) >= 0.55
        ? "provider_entity_linked"
        : "provider_link_unconfirmed";
    multiplier = verificationStatus === "provider_entity_linked" ? 0.82 : 0.68;
  } else if (sourceType === "rss" || sourceName === "google_news" || sourceName === "yahoo_finance") {
    observationLevel = "rss_headline_only";
    verificationStatus = "headline_or_feed_match";
    multiplier = sourceName === "yahoo_finance" ? 0.7 : 0.64;
    warnings.push("RSS items can be query/headline matched; verify the original article before treating as a catalyst.");
  } else if (sourceName === "stocktwits") {
    observationLevel = "social_stream";
    verificationStatus = "crowd_signal_unverified";
    multiplier = 0.52;
    warnings.push("Social evidence is crowd sentiment, not confirmed institutional activity.");
  }

  if (!normalized.canonical_url) {
    multiplier = Math.min(multiplier, 0.62);
    warnings.push("No original source URL is attached.");
  }
  if (normalized.processing_notes?.ticker_hint_rejected) {
    multiplier = Math.min(multiplier, 0.5);
    warnings.push("Provider ticker hint was rejected because the article did not support the ticker mapping.");
  }
  if (Number(normalized.mapping_confidence || 0) < 0.72) {
    multiplier = Math.min(multiplier, 0.62);
    warnings.push("Ticker mapping confidence is limited.");
  }
  if (/block_trade/.test(eventType) && observationLevel === "bar_derived_inferred") {
    multiplier = Math.min(multiplier, 0.42);
    warnings.push("Legacy inferred bar signal used a block-trade label; treat it as abnormal-volume context only.");
  }

  return {
    observation_level: observationLevel,
    verification_status: verificationStatus,
    reliability_multiplier: round(clamp(multiplier, 0.25, 1), 3),
    reliability_warnings: [...new Set(warnings)].slice(0, 4)
  };
}

function ageHours(value) {
  if (!value) {
    return 999;
  }
  const ageMs = Date.now() - new Date(value).getTime();
  return Number.isFinite(ageMs) ? Math.max(0, ageMs / 3600000) : 999;
}

function qualityLabel({ freshnessScore, sourceReliabilityScore, classificationConfidence, duplicationScore, corroborationScore, score, normalized }) {
  if (!normalized.primary_ticker) {
    return "source_limited";
  }
  if (duplicationScore >= 0.68) {
    return "duplicate";
  }
  if (freshnessScore < 0.25) {
    return "stale";
  }
  if (score.event_type === "monitor_item" || classificationConfidence < 0.5 || Number(score.relevance_score || 0) < 0.45) {
    return "low_signal";
  }
  if (sourceReliabilityScore < 0.58 || corroborationScore < 0.28) {
    return "needs_confirmation";
  }
  return "high_quality";
}

function displayTier(label, downstreamWeight, score) {
  if (label === "duplicate" || downstreamWeight < 0.28) {
    return "suppress";
  }
  if (label === "stale" || label === "low_signal") {
    return "context";
  }
  if (downstreamWeight >= 0.72 && Math.abs(Number(score.sentiment_score || 0)) >= 0.45) {
    return "alert";
  }
  return "watch";
}

function corroborationScore(store, normalized, score, cluster) {
  const clusterSources = Number(cluster?.unique_source_count || 1);
  const sameTickerSources = new Set();
  const cutoffMs = Date.now() - 24 * 3600000;

  for (const existingScore of store.documentScores || []) {
    if (existingScore.score_id === score.score_id || existingScore.event_type !== score.event_type) {
      continue;
    }
    const existingDoc = store.normalizedDocuments.find((doc) => doc.doc_id === existingScore.doc_id);
    if (!existingDoc || existingDoc.primary_ticker !== normalized.primary_ticker) {
      continue;
    }
    if (new Date(existingDoc.published_at || existingScore.scored_at || 0).getTime() < cutoffMs) {
      continue;
    }
    sameTickerSources.add(existingDoc.source_name);
  }

  if (normalized.source_name) {
    sameTickerSources.add(normalized.source_name);
  }

  return clamp(0.18 + Math.min(0.38, (clusterSources - 1) * 0.16) + Math.min(0.44, (sameTickerSources.size - 1) * 0.18), 0, 1);
}

function explanation(label, tier, parts) {
  const base = {
    high_quality: "Strong enough to influence downstream ranking.",
    needs_confirmation: "Useful, but should be confirmed by another source or stronger classification.",
    stale: "Freshness is low, so it should mostly provide context.",
    duplicate: "Likely repeats an already-seen item and should not add much weight.",
    low_signal: "Classification or relevance is weak, so it should not drive decisions alone.",
    source_limited: "Ticker/source mapping is incomplete, so downstream use should be cautious."
  }[label] || "Evidence quality could not be classified precisely.";

  return `${base} Display tier: ${tier}. ${parts.join(" ")}`.trim();
}

export function evaluateEvidenceQuality({ store, normalized, score, cluster }) {
  const freshnessScore = clamp(Number(normalized.timeliness_score || 0), 0, 1);
  const sourceTypeWeight = SOURCE_TYPE_WEIGHTS[normalized.source_type] ?? 0.62;
  const sourceReliabilityScore = clamp(Number(normalized.source_trust || 0.5) * 0.75 + sourceTypeWeight * 0.25, 0, 1);
  const classificationConfidence = clamp(Number(score.classification_confidence || score.final_confidence || 0), 0, 1);
  const duplicationScore = clamp(1 - Number(normalized.novelty_score || 0), 0, 1);
  const corroboration = corroborationScore(store, normalized, score, cluster);
  const completeness = clamp(Number(normalized.extraction_quality_score || 0), 0, 1);
  const mapping = clamp(Number(normalized.mapping_confidence || 0), 0, 1);
  const reliability = reliabilityContext(normalized, score);

  const baseDownstreamWeight = clamp(
    freshnessScore * 0.16 +
      sourceReliabilityScore * 0.2 +
      classificationConfidence * 0.22 +
      corroboration * 0.16 +
      completeness * 0.12 +
      mapping * 0.08 +
      Number(normalized.novelty_score || 0) * 0.06,
    0,
    1
  );
  const downstreamWeight = round(
    clamp(
      baseDownstreamWeight * reliability.reliability_multiplier,
      0,
      1
    ),
    3
  );

  let label = qualityLabel({
    freshnessScore,
    sourceReliabilityScore,
    classificationConfidence,
    duplicationScore,
    corroborationScore: corroboration,
    score,
    normalized
  });
  if (label === "high_quality" && reliability.reliability_multiplier < 0.7) {
    label = "needs_confirmation";
  }
  const tier = displayTier(label, downstreamWeight, score);
  const reasonCodes = [];

  if (freshnessScore < 0.35) {
    reasonCodes.push("stale_evidence");
  }
  if (duplicationScore >= 0.45) {
    reasonCodes.push("duplicate_or_repeated");
  }
  if (corroboration < 0.32) {
    reasonCodes.push("limited_corroboration");
  }
  if (sourceReliabilityScore < 0.58) {
    reasonCodes.push("source_reliability_limited");
  }
  if (reliability.reliability_multiplier < 0.7) {
    reasonCodes.push("source_verification_limited");
  }
  if (reliability.observation_level === "bar_derived_inferred") {
    reasonCodes.push("bar_derived_inferred_flow");
  }
  if (reliability.observation_level === "rss_headline_only") {
    reasonCodes.push("rss_headline_or_feed_match");
  }
  if (score.event_type === "monitor_item" || classificationConfidence < 0.5) {
    reasonCodes.push("weak_classification");
  }
  if (!normalized.primary_ticker) {
    reasonCodes.push("ticker_mapping_missing");
  }

  return {
    evidence_id: makeId(),
    doc_id: normalized.doc_id,
    score_id: score.score_id,
    ticker: normalized.primary_ticker || null,
    source_type: normalized.source_type,
    source_name: normalized.source_name,
    source_url: normalized.canonical_url || null,
    ...reliability,
    event_type: score.event_type,
    published_at: normalized.published_at,
    evaluated_at: new Date().toISOString(),
    age_hours: round(ageHours(normalized.published_at), 2),
    freshness_score: round(freshnessScore, 3),
    source_reliability_score: round(sourceReliabilityScore, 3),
    classification_confidence: round(classificationConfidence, 3),
    duplication_score: round(duplicationScore, 3),
    corroboration_score: round(corroboration, 3),
    extraction_quality_score: round(completeness, 3),
    mapping_confidence: round(mapping, 3),
    base_downstream_weight: round(baseDownstreamWeight, 3),
    data_quality_label: label,
    display_tier: tier,
    downstream_weight: downstreamWeight,
    reason_codes: reasonCodes,
    explanation: explanation(label, tier, [
      `freshness=${round(freshnessScore, 2)}`,
      `source=${round(sourceReliabilityScore, 2)}`,
      `classification=${round(classificationConfidence, 2)}`,
      `corroboration=${round(corroboration, 2)}`,
      `verification=${reliability.verification_status}`
    ])
  };
}

export function summarizeEvidenceQuality(items = []) {
  const tiers = { alert: 0, watch: 0, context: 0, suppress: 0 };
  const labels = {};
  const sources = {};
  const tickers = {};
  const verification = {};
  const observationLevels = {};

  for (const item of items) {
    tiers[item.display_tier] = (tiers[item.display_tier] || 0) + 1;
    labels[item.data_quality_label] = (labels[item.data_quality_label] || 0) + 1;
    sources[item.source_name] = (sources[item.source_name] || 0) + 1;
    verification[item.verification_status] = (verification[item.verification_status] || 0) + 1;
    observationLevels[item.observation_level] = (observationLevels[item.observation_level] || 0) + 1;
    if (item.ticker) {
      tickers[item.ticker] = (tickers[item.ticker] || 0) + 1;
    }
  }

  const averageWeight = items.length
    ? round(items.reduce((sum, item) => sum + Number(item.downstream_weight || 0), 0) / items.length, 3)
    : 0;

  return {
    as_of: new Date().toISOString(),
    total_evidence_items: items.length,
    average_downstream_weight: averageWeight,
    display_tiers: tiers,
    quality_labels: labels,
    verification_statuses: verification,
    observation_levels: observationLevels,
    top_sources: Object.entries(sources)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([source_name, count]) => ({ source_name, count })),
    top_tickers: Object.entries(tickers)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([ticker, count]) => ({ ticker, count }))
  };
}

export function createEvidenceQualityAgent({ store }) {
  function evaluate(input) {
    const quality = evaluateEvidenceQuality({ store, ...input });
    store.evidenceQuality.items = [quality, ...store.evidenceQuality.items].slice(0, 1000);
    store.evidenceQuality.summary = summarizeEvidenceQuality(store.evidenceQuality.items);
    return quality;
  }

  function getSnapshot({ ticker = null, tier = null, limit = 50 } = {}) {
    let items = filterFreshEvidence(store.evidenceQuality.items || [], store.config);
    if (ticker) {
      items = items.filter((item) => item.ticker === ticker);
    }
    if (tier) {
      items = items.filter((item) => item.display_tier === tier);
    }
    return {
      summary: summarizeEvidenceQuality(items),
      items: items.slice(0, limit)
    };
  }

  return {
    evaluate,
    getSnapshot
  };
}
