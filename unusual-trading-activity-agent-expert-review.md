# Expert Review: Unusual Trading Activity Agent — Product Design Specification

**Reviewed:** 2026-06-06
**Document reviewed:** `unusual-trading-activity-agent-product-design.md`
**Review scope:** Market microstructure validity · Quantitative algorithm design · System architecture · UX and data contracts · QA and validation plan · Open questions resolution

---

## Executive Assessment

This is a well-structured, intellectually honest product spec. Its greatest strengths are its explicit epistemic discipline — it refuses to over-claim (no "institution bought," no "dark pool buyer"), grounds every signal in a named data source, and separates observation from interpretation from user guidance. These are rare qualities in retail-facing trading tooling.

The weaknesses are concentrated in three areas: (1) the scoring formulas carry embedded assumptions that need walk-forward calibration before they are used for paper-trading decisions; (2) the pre-market weight in the buy/sell pressure formula is structurally aggressive for thin pre-market sessions; (3) several open questions in Section 20 are load-bearing for product correctness and should be resolved before Phase 2 begins, not deferred.

**Overall readiness rating: B+ — strong foundation, needs targeted hardening before production use.**

---

## 1. Market Microstructure Review

### 1.1 TRF / Off-Exchange Classification — Correct and Conservative

The spec correctly restricts "dark pool" claims to source-confirmed venue identity and uses "TRF/off-exchange" as the default label for `exchange: 4` + `trf_id` prints. This is the right policy.

**Nuance the spec should add:**

- **Intermarket Sweep Orders (ISOs)** often route to TRF after initial sweep execution. They are directional but not necessarily institutional in the dark-pool sense. ISO condition codes should be identified and noted separately.
- **FINRA ADF** (Alternative Display Facility) is also reported via TRF and includes internalized retail flow — not a sign of institutional activity at all. If the data includes ADF origination metadata, this segment should be excluded from the "unusual TRF cluster" signal.
- **TRF itself is not a venue** — it is a reporting facility used by multiple ATSs, broker-dealers, and internalizers. The spec states this correctly, but the UX label "TRF/off-exchange print" will still confuse users who associate TRF with dark pools specifically. Consider: "Off-exchange reported print" as the user-facing label.

### 1.2 Block Trade Thresholds — Reasonable Starting Point, Needs Liquidity Buckets

The proposed rule:

```
absolute_block = shares >= 10,000 OR notional >= $200,000
relative_block = shares >= 5x median_trade_size OR notional >= 5x median_notional
large_print = absolute_block AND relative_block
```

**Issues:**

- The `$200,000` notional floor is appropriate for small/mid caps but is trivially exceeded on mega-caps (NVDA, AAPL, AVGO) multiple times per minute during normal trading. For names with ADV > $1B, the notional floor should be at least $1M–$2M to avoid noise saturation.
- The `5x median` relative threshold is a reasonable heuristic but the median can itself be distorted by earlier large prints in the same session. Use the **median of the trailing 20-session daily distribution** rather than the intraday session median to avoid self-contamination.
- The `AND` between absolute and relative thresholds is correct — it prevents low-price penny stocks from qualifying every round lot as a "block."

**Recommended enhancement:** Stratify thresholds by liquidity bucket:

| Liquidity Bucket | ADV Criterion | Absolute Notional Floor | Relative Multiple |
|---|---|---|---|
| Micro | ADV < $10M | $100K | 5x |
| Small | ADV $10M–$100M | $250K | 5x |
| Mid | ADV $100M–$1B | $750K | 4x |
| Large | ADV $1B–$10B | $2M | 3x |
| Mega | ADV > $10B | $5M | 3x |

### 1.3 Trade Signing — Well-Designed but Transparency Gap

The quote rule → tick test fallback hierarchy is the standard Lee-Ready approach. The spec correctly acknowledges that tick test is less reliable and that signing confidence should be reported.

**Issues the spec should address:**

- **Quote rule midpoint boundary**: trades at the exact bid-ask midpoint should be classified as unknown, not randomly assigned. The spec doesn't address midpoint trades explicitly.
- **Bulk quote data latency**: quote data from consolidated tape feeds can lag trade prints by 5–50ms. The spec should specify whether quote timestamps are exchange-side or participant-side and how the signing logic handles quote-to-trade timestamp alignment.
- **Reverse tick test**: the original Lee-Ready paper also uses a reverse tick test for up-ticks — the spec mentions "tick test fallback" but should clarify whether it implements the full Lee-Ready logic (tick test + reverse tick test in sequence).
- **Modern alternative**: Ellis-Michaely-O'Hara (EMO) or Chakrabarty-Li-Nguyen-Van Ness (CLNV) algorithms consistently outperform basic tick test in modern microstructure literature. These should be on the quant expert's evaluation list (Section 16.2).

### 1.4 Special Condition Exclusions — Critical Gap

Section 8.1 lists exclusion categories (corrections, cancels, odd lots, late reports, average price) but does not specify the **condition codes** that map to each. This is a load-bearing gap: if the wrong condition codes are included, the volume and notional calculations will be inflated by non-directional prints.

**Required additions to the spec:**

| Condition Category | Action | Rationale |
|---|---|---|
| Corrections (E) | Exclude | Not a new trade |
| Cancellations | Exclude | Reversal of a prior print |
| Odd lots (I) | Exclude from block detection | Too small; skews median down |
| Extended Hours (T, U) | Separate session bucket | Not comparable to regular session |
| Average Price (W) | Exclude from directional scoring | Not a market-side print |
| Form T (late reports) | Exclude from freshness calculation | Timestamp is not the trade time |
| Intermarket Sweep (F) | Flag for separate analysis | Directional but not institutional |
| Derivatively Priced (6) | Exclude from price-level analysis | Price is synthetic |
| Opening Trade (O) | Flag | Can be large but not discretionary |
| Closing Trade (M, 6) | Flag | Can be large but not discretionary |

The data engineer and QA lead (Sections 16.3, 16.5) should build condition-code validation into the contract test suite before any derived signal is treated as production.

### 1.5 Signed Pressure Formulas — Correct, But Pre-Market Weight is Aggressive

The buy/sell pressure formula:

```
buy_sell_pressure =
  0.45 * net_notional_pressure
  + 0.20 * net_volume_pressure
  + 0.35 * pre_market_net_pressure * min(1, pre_market_volume_share * 4)
```

**Issues:**

- Pre-market receives **35% weight** — the largest single contributor when pre-market volume share is high. Pre-market sessions are structurally thin (wide spreads, lower participation, no specialist/market-maker balancing) and trade signing confidence is lower because quote data quality degrades significantly before 9:30 ET. A 35% weight requires strong empirical justification.
- `min(1, pre_market_volume_share * 4)` means pre-market only reaches full 35% weight when it represents ≥25% of total session volume. For most tickers on most days, pre-market is 2–10% of daily volume, which caps pre-market contribution at 7%–35% of the 35% weight, i.e., 2.5%–12.3% effective weight. This is reasonable scaling, but the max exposure is still too high without calibration.
- **Recommended**: Reduce max pre-market weight to 0.20 and add a confidence discount when quote availability drops below 50% of pre-market trades.

---

## 2. Quantitative Algorithm Review

### 2.1 Block Trade Pressure Formula — Structurally Sound

```
focus_notional_share = focus_notional / total_notional
directional_pressure = signed_focus_notional / focus_notional
focus_activity_score = focus_notional_share * log1p(focus_trade_count)
block_trade_pressure = directional_pressure * focus_activity_score
```

This is mathematically well-formed. `log1p` prevents the score from being dominated by single-print events with high notional, which is the right design choice.

**Issue:** The formula bounds are asymmetric. `directional_pressure ∈ [-1, +1]` and `focus_notional_share ∈ [0, 1]`, but `log1p(focus_trade_count)` is unbounded. A ticker with 500 focus prints gets `log1p(500) ≈ 6.2`, while one with 5 prints gets `log1p(5) ≈ 1.8`. The resulting `block_trade_pressure` ranges are non-comparable across tickers without normalization.

**Fix:** Normalize by a reference count (e.g., expected focus prints per session for the liquidity bucket) or cap `log1p(focus_trade_count)` at `log1p(100)` and re-scale to [0, 1] before multiplying.

### 2.2 Enhanced Block Pressure — Over-Parameterized

```
enhanced_block_pressure =
  directional_pressure
  * focus_notional_share
  * log1p(focus_trade_count)
  * (1 + 0.15 * largest_print_bonus + 0.10 * cluster_bonus + 0.10 * price_level_bonus)
```

The bonus multiplier `(1 + 0.15 + 0.10 + 0.10)` = maximum 1.35x amplification. These weights (0.15, 0.10, 0.10) have no empirical basis stated in the spec. The expert review in Section 16.2 should derive these via a regression of future returns on each bonus component.

**More critically:** `price_level_bonus = 1 if clustered near VWAP/support/resistance else 0` is a binary that doubles the bonus from that component. Support/resistance is subjective — without a precise algorithmic definition (e.g., price within 0.5 ATR of 20-day pivot), this term introduces inconsistency across tickers and sessions.

### 2.3 Anomaly Detection — MAD Score Is the Right Choice

The use of Median Absolute Deviation (MAD) over standard z-score is the correct choice for equity trading data, which has heavy tails and frequent outlier sessions (earnings, macro events).

```
mad_score = abs(latest - median) / MAD
```

**Issues:**

- The spec does not define the **baseline window length**. This is Open Question #1 in Section 20, but it is also load-bearing for the anomaly calculation. Without a defined window, results are not reproducible. **Recommendation**: 20 trading days as a starting default (covers one calendar month, includes diverse market conditions), with a 60-day option for lower-volatility names.
- **Intraday time-of-day adjustment**: Open Question raised in Section 16.2. This is important. Volume at 09:35 is structurally different from volume at 13:00. Using a full-day baseline for a 5-minute window produces false positives at market open (when volume is always high) and false negatives at midday (when volume is always low). Minimum viable fix: use **time-of-day-matched baselines** — compare the 09:30–10:00 window against historical 09:30–10:00 sessions, not full-day medians.
- The bands (`1.5x`, `2.0x`, `3.0x`) are stated as "recommended" without calibration. These are reasonable starting points but should be tuned per liquidity bucket — mega-caps have lower ratio variance, so the same band means less for AAPL than for a $50M ADV mid-cap.

### 2.4 Composite Score — Weight Allocation Is Defensible

```
raw_activity_score =
  0.25 * unusual_activity_strength
  + 0.25 * block_trade_pressure_strength
  + 0.20 * buy_sell_pressure_strength
  + 0.15 * market_flow_trend_strength
  + 0.10 * pre_market_activity_strength
  + 0.05 * confirmed_alert_strength
```

The weights sum to 1.0 and the hierarchy makes conceptual sense: volume anomaly and block pressure lead, then directional pressure, then trend, then pre-market context, then provider alerts.

**Issue:** `confirmed_alert_strength` at only 5% seems too low given that confirmed provider alerts are the highest-signal evidence type (per Section 3.5: "direct" dark pool evidence). A confirmed Unusual Whales alert or TradeVision block alert is qualitatively different from an inferred TRF cluster. Consider 10–15% weight for confirmed alerts, with a corresponding reduction in one of the raw-data components.

**Issue:** None of the component `_strength` values are defined. Each component needs a stated normalization to [0, 1] or [-1, +1] before the composite is meaningful. This is a gap the Phase 1 contracts work should close.

### 2.5 Corroboration Logic — Well-Conceived

The independence hierarchy in Section 9.2 (same raw lane → raw + price → raw + options → confirmed alert + raw) correctly penalizes corroboration from the same underlying data stream. This prevents the system from double-counting the same evidence.

**Gap:** The corroboration factor is described conceptually but has no formula. The spec should define:

```
corroboration_factor = f(number_of_independent_sources, source_independence_weight)
```

A reasonable starting point:

```
corroboration_factor = 1 + sum(independence_weight[i] for i in confirmed_independent_sources)
where independence_weight = {same_lane: 0.05, price_action: 0.15, options_flow: 0.20, provider_alert: 0.30}
```

Cap at 1.50 to prevent any single combination from over-weighting confidence.

---

## 3. System Architecture Review

### 3.1 Lane Architecture — Correct Design

The separation of raw lanes (Massive endpoints) from derived signal lanes (no direct Massive calls) is architecturally sound and follows a proper medallion/lambda model. The key constraint — "Raw acquisition happens once; derived agents reuse lane artifacts" — is the right principle for both cost control and reproducibility.

**Gap:** The spec does not define the **artifact format** for lane outputs. Are lane artifacts stored as Parquet files? In a database? As JSON manifests? This decision affects replay capability (Section 17.1), concurrency (multiple signal lanes reading the same raw slice), and data quality checks (Section 11.3). This belongs in the Phase 1 contracts deliverable.

### 3.2 Data State Contract — Excellent Design

The 8-state model (ready, loading, source_available_not_analyzed, analysis_needs_refresh, source_unavailable, partial_usable, blocked, disabled_optional) is comprehensive and well-named. The prohibition on the word "stale" as a user-facing label is correct.

**One gap:** The contract does not define what happens when **ticker coverage is partial** — i.e., 150 of 168 tickers are ready but 18 are blocked. The `coverage_pct` field addresses this at the lane level, but the per-ticker state needs to be surfaced clearly in the UI (Section 12). The QA matrix (Section 18) has a row for "ticker outside universe" but not for "ticker in universe but source unavailable for this ticker."

### 3.3 API Contract — Minimal, Needs Completion

The two endpoints (summary + ticker detail) are the right surface area but the spec is skeletal. Before Phase 3 (Dashboard UX), the following need to be defined:

- **Pagination** on the summary endpoint (`top_alerts` array could be large for 168-ticker universe)
- **Cycle ID semantics**: what is a cycle? Is it time-based (every 5 minutes) or event-based (triggered when a new lane artifact is available)?
- **Stale-while-revalidate behavior**: should the API return the last-known signal with a `stale` flag while a new cycle is computing, or block until the new cycle is complete?
- **Error response contract**: what shape do 404 (ticker not in universe), 503 (lane unavailable), and 206 (partial data) responses take?

### 3.4 Data Model — Complete and Well-Structured

The observation table and signal result table in Section 14 cover the right fields. Two additions:

- `unusual_activity_signal_results` should include a `version` column to support forward-compatible schema evolution without breaking replay.
- `raw_print_refs_json` in the observation table will grow unbounded for high-volume tickers with many focus prints. Consider storing print refs in a separate child table with a foreign key to `unusual_activity_observations.id`, or limit `raw_print_refs_json` to the top N prints by notional with a `truncated: true` flag.

### 3.5 Replay Architecture — Mentioned but Not Specified

Section 17.1 names replay as a validation tool. For replay to work, the system needs:

1. **Point-in-time lane snapshots** — not just current lane state but the exact raw data available at time T.
2. **Deterministic RNG** if any randomness is used (e.g., tie-breaking in trade signing).
3. **Clock injection** — all "freshness" checks must use an injectable clock, not `now()`, so replay can simulate historical evaluation.

None of these are in the current spec. The data engineer (Section 16.3) should produce a replay harness design before Phase 4.

---

## 4. UX and Display Contract Review

### 4.1 Bottom-Line-Up-Front — Excellent Design Principle

The BLUF card format in Section 12.1 is correct. The "What happened / Why it matters / What to check" structure mirrors the format used by professional market-intelligence services (Bloomberg RBAC alerts, Refinitiv Eikon flow commentary). The example for AVGO is concrete and well-written.

### 4.2 Terminology Policy — Strong but Incomplete

The allowed/forbidden language list in Section 21 is one of the spec's strongest sections. Additions needed:

**Also avoid:**
- "Accumulation" (implies sustained directional intent without proof)
- "Whale activity" (retail-coded language inconsistent with professional positioning)
- "Informed flow" as a headline label (can appear in context with a qualifier, not as a verdict)
- "Conviction buy/sell" (implies confirmed direction + sustained intent)

**Also allow (currently missing from the permitted list):**
- "Elevated off-exchange participation" (more precise than "TRF/off-exchange print")
- "Signing confidence: XX%" (a concrete metric the user can evaluate)
- "Incomplete lane — showing best available" (better than hiding partial data)

### 4.3 User Actions — Two Missing

Section 12.4 lists 8 user actions. Two are missing:

- **"Explain calculation"** — distinct from "Show calculation." The user should be able to ask "why is this strong?" and get a plain-English explanation of which component drove the score. This is the "explainability" requirement implicit in the product goals.
- **"Compare to prior cycle"** — the user should be able to see whether this ticker's activity score went up, down, or held since the last cycle. A simple delta indicator (↑ +0.12 vs. last cycle) is high-value for paper-trading decision-making.

### 4.4 Dashboard Placement — Well-Specified

The four placement contexts (Command/Cockpit, Candidate Detail, Signals Dashboard, Execution Preview) map cleanly to different user tasks. The constraint that Execution Preview shows "compact caution/support line only" is correct — at the point of execution, a dense diagnostic panel creates decision paralysis.

---

## 5. QA and Validation Plan Review

### 5.1 QA Matrix — Good But Missing Critical Failure Modes

The 10 QA scenarios in Section 18 are all correct. Missing:

| Missing Scenario | Expected Result |
|---|---|
| Duplicate trade prints (same id) in raw lane | Deduped before analysis; observation row count reflects post-dedupe |
| Signing method: 100% unknown | Direction shown as "undetermined"; no directional score emitted |
| All prints are average-price/derivatively-priced | Score suppressed; "Non-directional print types only" label shown |
| Focus notional share = 1.0 (all prints are blocks) | Score capped; label "All prints are focus prints — baseline context missing" |
| Pre-market volume share > 50% of daily | Pre-market weight capped; caution label shown |
| Ticker with < 5 raw prints | Score suppressed; "Insufficient sample" label |
| Provider alert for ticker not in live universe | Alert shown in alerts panel but not linked to candidate scoring |
| Clock skew between lanes (lane A timestamp > lane B) | Freshness check flags inconsistency; user notified |

### 5.2 Validation Plan — Methodologically Sound

The walk-forward validation with HAC/bootstrap p-values (Section 17.3) is the correct approach for overlapping return horizons. Two important additions:

- **Multiple-testing correction**: when evaluating 6+ signal components × 4 return horizons × multiple threshold levels, the probability of spurious significance is high. Apply Benjamini-Hochberg FDR correction or Bonferroni correction before reporting that any threshold has statistically significant predictive value.
- **Look-ahead bias audit**: the baseline calculation (Section 8.5) uses `median_baseline_volume`. In live operation this is fine, but in replay/backtest, the baseline must use only data available at the evaluation timestamp. A common error is using the full-day median to evaluate a morning print — the full-day median is not known until market close.

### 5.3 Acceptance Criteria — Should Be Quantitative

Section 17.4 states the agent can affect recommendations only when "score is stable in replay" and "thresholds have positive out-of-sample utility." These need numeric definitions:

**Recommended quantitative acceptance criteria:**

| Criterion | Threshold |
|---|---|
| Information ratio (IR) of actionable signals (Class A) | IR ≥ 0.30 over 1-year OOS window |
| False positive rate (Class A predicted bullish, next-close negative) | ≤ 40% |
| Precision at top decile (highest scores, 30m forward return) | ≥ 55% positive |
| Score stability (correlation between consecutive cycle scores for unchanged tickers) | ≥ 0.90 |
| Data lane availability SLA (% of cycles with all required lanes ready) | ≥ 95% |

---

## 6. Resolution of Open Questions (Section 20)

| # | Question | Recommended Resolution |
|---|---|---|
| 1 | Require quote data for high-confidence signing? | Yes — enforce quote-rule-only mode when bid/ask coverage ≥ 70% of prints. Fall back to tick-test and flag lower confidence, but do not suppress the signal. |
| 2 | Minimum source coverage for live paper-trading support? | 90% ticker coverage on `massive_live_trade_slices` for the current date/window. Below 90%, score is context-only. |
| 3 | Pre-market anomalies decay after open? | Yes — apply exponential decay with half-life of 60 minutes after 09:30 ET open. Pre-market signal should be negligible by 11:00 ET in the absence of reinforcing regular-session activity. |
| 4 | Large off-exchange prints near VWAP scored differently? | Yes — prints within ±0.5 ATR of VWAP should receive the `price_level_bonus`. Prints far from VWAP may reflect stop-hunting or post-event liquidation rather than accumulation. |
| 5 | Options flow: same agent or companion? | Companion agent. Options flow has distinct data contracts, expiry/strike complexity, and OI vs. volume interpretation requirements. It should corroborate this agent, not live inside it. |
| 6 | Which provider alert source is "confirmed"? | Confirmed = provider explicitly states venue or names the instrument + direction with a human-reviewed alert. TradeVision and Unusual Whales meet this bar. Social media signal aggregators do not. |
| 7 | All 168 tickers every cycle, or only active? | All 168, but with a two-tier approach: compute full scoring only for active/recommended/watch tickers; compute lightweight anomaly screening (volume ratio only) for all 168 to surface emerging names. |
| 8 | Duplicate articles/alerts for same raw prints? | Dedupe at alert ingest by (ticker, event_date, direction, notional_range, provider). If two provider alerts reference the same underlying prints, count as one corroboration event, not two. |

---

## 7. MVP Phase Sequencing — Recommended Adjustments

The 5-phase plan is logical. Recommended additions:

**Phase 1 (Contracts)** — Add:
- Condition code policy document (which SIP/CTS codes are included/excluded)
- Signed pressure normalization contract (each component → [0,1] mapping)
- Replay clock injection interface spec

**Phase 2 (Feature Engine)** — Add:
- Liquidity bucket classifier (needed before threshold tuning)
- Time-of-day baseline engine (critical for avoiding open/close false positives)
- Condition code validator (automated test that no excluded codes appear in scored data)

**Phase 4 (Validation)** — Add:
- Multiple-testing correction procedure
- Look-ahead bias audit checklist
- Quantitative acceptance criteria gate (must pass before Phase 5 unlock)

**Phase 5 (Paper-Trading Integration)** — Add:
- Corroboration formula with defined weights (not yet specified in the current doc)
- Explicit cap on maximum score contribution per component (prevents a single extreme print from overriding all other signals)

---

## 8. Priority Issues — Ranked by Impact

| Priority | Issue | Section | Impact |
|---|---|---|---|
| P0 | Condition code exclusion policy not defined | 8.1 | Inflated scores from non-directional prints |
| P0 | Baseline window length not defined | 8.5 | Non-reproducible anomaly scores |
| P0 | Component `_strength` normalization not defined | 9.1 | Composite score is not meaningful |
| P1 | Pre-market weight (35%) needs empirical justification | 8.4 | Systematic over-weighting of thin sessions |
| P1 | `log1p(focus_trade_count)` unbounded — cross-ticker scores not comparable | 8.3 | Ranking distortion |
| P1 | Look-ahead bias risk in replay baseline calculation | 17.1 | False validation of signal |
| P1 | Time-of-day baseline matching not implemented | 16.2 | Open/close false positives |
| P2 | Liquidity bucket thresholds not defined | 8.2 | Mega-cap noise saturation |
| P2 | Confirmed alert weight too low (5%) | 9.1 | Under-uses highest-quality signal |
| P2 | Corroboration factor has no formula | 9.2 | Confidence score is ad hoc |
| P2 | Replay clock injection not designed | 17.1 | Point-in-time replay impossible |
| P3 | ADF / retail internalization not separated from institutional TRF | 3.4 | TRF signal quality degraded |
| P3 | Quote midpoint trades classified as unknown | 8.1 | Minor signing accuracy gap |
| P3 | Multiple-testing correction missing from validation | 17.3 | Risk of reporting spurious signals |

---

## 9. Specific Quantitative Recommendations

### Revised Buy/Sell Pressure Formula

```
buy_sell_pressure =
  0.50 * net_notional_pressure * signing_confidence_weight
  + 0.25 * net_volume_pressure * signing_confidence_weight
  + 0.15 * pre_market_net_pressure * min(0.6, pre_market_volume_share * 4)
  + 0.10 * market_flow_trend

where signing_confidence_weight = (quote_rule_pct * 1.0 + tick_test_pct * 0.6 + unknown_pct * 0.0)
```

This change: reduces pre-market max exposure from 35% to 15% (×0.6 cap), discounts all pressure measures by trade-signing confidence, and folds market flow trend into pressure (since it is derived from the same data).

### Revised Composite Score with Corroboration

```
raw_activity_score =
  0.25 * unusual_activity_strength        # anomaly: volume/notional/count
  + 0.25 * block_trade_pressure_strength  # focus print direction + weight
  + 0.20 * buy_sell_pressure_strength     # signed pressure (as revised above)
  + 0.10 * market_flow_trend_strength     # pressure trend
  + 0.10 * pre_market_activity_strength   # pre-market anomaly (decayed post-open)
  + 0.10 * confirmed_alert_strength       # provider-confirmed alert (increased from 5%)

confidence = data_quality * method_confidence * clamp(corroboration_factor, 1.0, 1.50)
actionability_score = raw_activity_score * confidence
```

### Anomaly Band Calibration Starting Point

For calibration purposes, start with:

```
normal:    ratio < 1.5x  AND  mad_score < 1.5
attention: ratio >= 1.5x OR   mad_score >= 1.5
strong:    ratio >= 2.0x AND  mad_score >= 2.0
extreme:   ratio >= 3.0x AND  mad_score >= 3.0
```

The `AND` in strong/extreme requires both ratio AND MAD score to be elevated, which reduces false positives from single-day baseline outliers.

---

## 10. Strengths to Preserve

The following design decisions are well-reasoned and should not be changed during implementation:

1. **Epistemic discipline in language policy** — the permitted/forbidden terms list is the product's intellectual core and should be enforced in every UX review gate.
2. **Three-level output model** (Observation → Interpretation → User Guidance) — this separation is what makes the agent explainable.
3. **Lane state machine** — the 8-state model prevents silent failures and ensures the user always knows what the data can and cannot prove.
4. **Corroboration independence hierarchy** — this prevents circular reinforcement from the same raw data.
5. **Non-goal discipline** — the explicit prohibition on claiming named dark pool venues from TRF codes alone is correct and should survive all pressure to loosen it.
6. **BLUF card format** — concrete, data-first, action-oriented. It is the right template for a professional trading intelligence product.

---

## Summary Scorecard

| Dimension | Score | Key Gap |
|---|---|---|
| Market microstructure correctness | B+ | Condition code policy missing; ADF not separated |
| Algorithm design | B | Component normalization undefined; pre-market weight too high |
| Statistical validity | B | Baseline window unspecified; look-ahead bias risk; no multiple-testing correction |
| System architecture | A- | Artifact format and replay clock not specified |
| UX and display design | A | Two missing user actions; two missing forbidden terms |
| QA coverage | B+ | 8 missing QA scenarios; acceptance criteria not quantified |
| Open question resolution | C (deferred) | All 8 open questions are load-bearing for Phase 2; none should remain open |

**The spec is ready for expert review as designed. P0 items must be resolved before Phase 2 begins. P1 items should be resolved before Phase 3. The product philosophy is sound — execution is where it will be won or lost.**
