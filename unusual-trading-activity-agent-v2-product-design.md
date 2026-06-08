# Unusual Trading Activity Agent — Product Design v2
## Full Specification for Implementation Planning

**Version:** 2.0
**Date:** 2026-06-06
**Status:** Approved for implementation planning
**Supersedes:** unusual-trading-activity-agent-product-design.md (v1 draft)
**Deployment target:** Raspberry Pi 5 backend · Cloudflare tunnel + domain · Web browser frontend

---

## Table of Contents

1. Executive Summary
2. Operating Modes
3. Scan Universe System
4. Data Sources and Lane Architecture
5. Indicator System: A, B, C
6. Signal Components and Algorithms
7. Tier Classification
8. Corroboration System
9. Data Quality and Lane State Contract
10. Scoring and Ordering
11. API Contract
12. Data Model
13. UX and Display Design
14. Deployment Architecture (Pi 5 + Cloudflare)
15. Validation Plan
16. QA Matrix
17. MVP Phase Plan
18. Terminology Policy
19. Open Questions — Resolved

---

## 1. Executive Summary

The Unusual Trading Activity Agent identifies, ranks, explains, and monitors abnormal equity trading behavior that may indicate institutional participation, liquidity events, informed flow, post-news repricing, or market-wide risk-on/risk-off dynamics.

The agent operates in three modes: **Single Ticker** (deep individual analysis), **Portfolio** (multi-ticker analysis ranked by urgency), and **Scan/Discovery** (broad universe search for tickers meeting bullish or bearish criteria). All modes share the same signal components and indicator system but differ in data pipeline strategy, tier classification rules, and UX presentation.

Every signal is built on three independent indicators — **A (Universe Percentile)**, **B (Historical Z-score)**, and **C (Raw ordering metric)** — rather than a collapsed composite score. The agent never shows a single "score" to the user. It shows raw evidence, indicator context, and a rule-based tier (A/B/C/D).

The agent is honest about what data can and cannot prove. It distinguishes TRF/off-exchange prints from named dark pool venues, inferred direction from confirmed direction, and supporting evidence from actionable conviction.

---

## 2. Operating Modes

### 2.1 Mode Overview

| Mode | Input | Primary goal | Tier rules used |
|---|---|---|---|
| **Single Ticker** | One user-selected ticker | Full depth analysis | B + C only (no peer group) |
| **Portfolio** | User's holdings or watchlist | Rank by urgency; surface what needs attention | A + B + C |
| **Scan / Discovery** | User-selected universe | Find tickers meeting bullish or bearish criteria | A + B + C; two-pass pipeline |

The mode is selected explicitly at session start. Each mode has its own entry point in the UI and API.

### 2.2 Single Ticker Mode

The user selects any ticker — including names outside any predefined universe. The agent:

- Pulls live trade slices, pre-market slices, and daily bars for that ticker only.
- Builds or retrieves a baseline from the baseline cache. If fewer than 10 trading days of history exist, returns `insufficient_history` state.
- Computes B and C indicators for all signal components.
- Indicator A is **disabled** — there is no peer group. The UX shows: "Universe comparison not available in single-ticker mode."
- Applies single-ticker tier rules (B + C only).
- Produces full evidence cards, BLUF card, and user actions.

**Use case:** Analyzing a specific ticker before a paper trade, researching a name that appeared in news or an alert, or investigating a ticker outside the user's normal universe.

### 2.3 Portfolio Mode

The user has a saved portfolio or watchlist (list of tickers). The agent:

- Pulls data for all portfolio tickers in one cycle.
- Computes A, B, and C for all components, with A being the percentile within the portfolio itself.
- Indicator A label in UX: "Relative to your portfolio today."
- Applies portfolio/scan tier rules (A + B + C).
- Surfaces tickers ranked by C ordering score, with tier and indicators shown per row.
- Highlights tickers that changed tier since the last cycle.

**Use case:** Morning review before market open, ongoing monitoring during trading hours, end-of-day position review.

### 2.4 Scan / Discovery Mode

The user selects a universe (see Section 3) and a direction filter (bullish, bearish, or both). The agent runs a two-pass pipeline:

**Pass 1 — Fast Screen:**
- Uses only precomputed overnight baselines and daily/intraday bar data (no live tick-by-tick slices).
- Computes a lightweight B estimate for all tickers in the universe: `volume_ratio_from_bars` and `direction_from_daily_return`.
- Applies the scan filter: `B_estimate >= threshold AND direction matches filter`.
- Returns a ranked shortlist of up to 50 candidates within seconds.
- Pass 1 results are shown immediately in the UI while Pass 2 loads.

**Pass 2 — Deep Analysis:**
- Pulls live trade slices only for the shortlisted tickers (max 50).
- Computes full A, B, and C indicators for all signal components.
- Produces full tier classification, evidence cards, and BLUF cards.
- Results replace Pass 1 estimates progressively as each ticker completes.

**Scan UI behavior:**
- Pass 1 result: ticker rows with preliminary tier and B estimate, labeled "Preliminary — live data loading."
- Pass 2 completion per ticker: row updates to full indicators and confirmed tier.
- A progress bar shows Pass 2 completion across the shortlist.
- User can click any ticker while Pass 2 is still running to see its current analysis state.

---

## 3. Scan Universe System

### 3.1 Universe Categories

#### US Indices

| Universe | Approx. count | Pi 5 tier |
|---|---|---|
| Dow Jones Industrial Average | 30 | 🟢 Fast — full A/B/C on all |
| NASDAQ-100 | ~100 | 🟢 Fast — full A/B/C on all |
| S&P 500 | ~503 | 🟡 Standard — Pass 1 + Pass 2 on top 30 shortlist |
| S&P 400 Mid-Cap | ~400 | 🟡 Standard |
| S&P 600 Small-Cap | ~600 | 🟡 Standard |
| Russell 1000 | ~1,000 | 🔴 Extended — Pass 1 only by default |
| Russell 2000 | ~2,000 | 🔴 Extended |
| Russell 3000 | ~3,000 | 🔴 Extended |

#### US Sectors (GICS — always scoped to a parent index)

The user selects a sector + index combination. All sector scans within S&P 500 are 🟢 Fast (< 80 tickers).

| Sector | Approx. count in S&P 500 |
|---|---|
| Information Technology | ~70 |
| Health Care | ~65 |
| Financials | ~65 |
| Industrials | ~75 |
| Consumer Discretionary | ~55 |
| Consumer Staples | ~35 |
| Real Estate | ~30 |
| Communication Services | ~25 |
| Energy | ~25 |
| Materials | ~25 |
| Utilities | ~30 |

#### US Exchanges

| Universe | Approx. count | Pi 5 tier |
|---|---|---|
| NYSE American (AMEX) | ~300 | 🟡 Standard |
| NYSE Arca (ETFs) | ~500 | 🟡 Standard |
| NYSE Listed | ~2,400 | 🔴 Extended |
| NASDAQ Listed | ~3,600 | 🔴 Extended |

#### Custom / User-Defined

| Universe | Source |
|---|---|
| My Portfolio | Tickers from Portfolio mode — always 🟢 |
| My Watchlist | User-saved list stored in the app — always 🟢 |
| Custom List | User types or pastes tickers ad hoc — always 🟢 |

### 3.2 Pi 5 Performance Tiers

| Tier | Ticker count | Behavior | Estimated time |
|---|---|---|---|
| 🟢 Fast | < 150 | Full A/B/C on all tickers, single pass | 30–60 seconds |
| 🟡 Standard | 150–600 | Pass 1 on all, Pass 2 on top 30 shortlist | 2–4 minutes |
| 🔴 Extended | 600+ | Pass 1 on all, Pass 2 on top 20 shortlist | 5–10 minutes |

The UI shows the performance tier and estimated time before the scan starts so the user can narrow their universe if needed.

### 3.3 Universe Maintenance

- Constituent lists are stored as **static JSON files** on the Pi, organized by universe name.
- Updated **weekly** via a scheduled task that pulls from a configured free data source (Financial Modeling Prep or Polygon.io free tier).
- Each file contains: `universe_name`, `last_updated`, `source`, `tickers[]` with `{symbol, name, sector, exchange, gics_sector, gics_industry}`.
- When a ticker is removed from a universe, its baseline data is retained for 90 days.
- New additions to a universe trigger an on-demand baseline build in the background (runs overnight at next scheduled cycle).
- The UI shows `last_updated` for the active universe and warns if older than 14 days.

---

## 4. Data Sources and Lane Architecture

### 4.1 Complete Data Source Registry

| Source | Type | What it provides | Used for |
|---|---|---|---|
| **Massive Stock Trades** | Primary — paid | Tick-level trade prints: price, size, exchange, conditions, timestamps, trf_id, bid/ask where available | All live signal computation |
| **Massive Daily Bars** | Primary — paid | OHLCV daily bars, historical and current | Baseline computation, Pass 1 screen, ATR/VWAP context |
| **Massive Pre-Market Slices** | Primary — paid | 04:00–09:30 ET trade prints | Pre-market signal component |
| **Massive Block Trade Feed** | Derived — local | Focus print list derived from live slices; zero additional Massive requests | Block/TRF signal component |
| **FRED (St. Louis Fed)** | Free API | VIX (VIXCLS), Yield curve spread (T10Y2Y), Fed Funds Rate (FEDFUNDS) | Market regime context; macro backdrop for signal interpretation |
| **TradeVision** | Optional — export | Provider-labeled dark pool, block, sweep, unusual activity alerts | Confirmed alert lane; corroboration signal |
| **Unusual Whales** | Optional — export/API | Provider-labeled options and equity flow alerts | Confirmed alert lane; corroboration signal |
| **Other alert providers** | Optional — CSV | Any provider alert with ticker, direction, type, and timestamp | Confirmed alert lane |
| **Earnings Calendar** | Free API | Earnings dates per ticker | Baseline exclusion of earnings sessions; event labeling |
| **Universe Constituent Lists** | Free / weekly update | Index and sector membership, GICS classifications | Scan universe management |

**Sources for free data:** Financial Modeling Prep (FMP) free tier provides earnings calendar, sector/index membership, and basic price data. Polygon.io free tier provides similar. Either is sufficient for non-Massive data needs.

### 4.2 What Each Indicator Reads

| Indicator | Component | Data source |
|---|---|---|
| **A — Universe percentile** | Volume anomaly | Massive daily bars (all universe tickers, same session) |
| **A** | Focus notional share | Massive live slices (Pass 2 universe tickers) |
| **A** | Directional pressure | Massive live slices (Pass 2 universe tickers) |
| **B — Historical z-score** | All components | Massive daily bars + Massive live slices historical; stored in SQLite baseline cache |
| **C — Raw ordering** | Pass 1 screen | Massive daily bars (volume ratio from bars) |
| **C** | Pass 2 full | Massive live slices → locally derived block feed |
| **Macro context** | Market regime | FRED API (VIX, yield curve, Fed Funds Rate) |
| **Confirmed alerts** | Corroboration | TradeVision, Unusual Whales, other providers |
| **Earnings flags** | Baseline exclusion, event label | FMP or Polygon.io earnings calendar |
| **Universe membership** | Scan, sector tag | Universe JSON files (weekly update) |

### 4.3 Raw Lane Architecture

| Lane | Pulls provider? | Purpose | Blocking? |
|---|---|---|---|
| `massive_live_trade_slices` | Yes — Massive | Current-session tick-level trade prints | Yes for live signal |
| `massive_premarket_trade_slices` | Yes — Massive | 04:00–09:30 ET prints | Yes during pre-market |
| `massive_daily_bars` | Yes — Massive | OHLCV history and current session bars | Yes for baseline |
| `massive_block_trade_feed` | No — derived locally | Focus print list from live slices | Yes when block signal required |
| `fred_macro_context` | Yes — FRED API (free) | VIX, yield curve, Fed Funds Rate | No — context only |
| `activity_alerts` | Optional — provider export | Confirmed provider alert import | No |
| `earnings_calendar` | Yes — FMP/Polygon (free) | Earnings dates for baseline exclusion and event labeling | No |
| `universe_constituents` | Weekly update — stored JSON | Universe membership and sector classification | No |

### 4.4 Derived Signal Lanes (No Additional Provider Calls)

| Signal lane | Reads from | Purpose |
|---|---|---|
| `buy_sell_pressure` | `massive_live_trade_slices` | Signed notional and volume pressure with signing confidence |
| `block_trade_pressure` | `massive_live_trade_slices`, `massive_block_trade_feed` | Focus print direction, concentration, largest print |
| `unusual_trade_activity` | `massive_live_trade_slices` + baseline cache | Volume/notional/count anomaly vs. own history |
| `pre_market_unusual_activity` | `massive_premarket_trade_slices` + baseline cache | Pre-market anomaly with session decay |
| `market_flow_trend` | `massive_live_trade_slices` rolling | Pressure trend direction and strength |
| `macro_context` | `fred_macro_context` | VIX regime, yield curve state |
| `confirmed_activity_alerts` | `activity_alerts` | Deduplicated, provenanced provider alerts |
| `baseline_cache` | `massive_daily_bars` (nightly build) | Precomputed 20-day medians and MAD per ticker per time bucket |

### 4.5 Condition Code Policy (v1)

The following SIP/CTS condition codes are applied at the preprocessing stage before any signal is computed.

**Hard exclude (never scored, never counted in volume or notional):**

| Code | Description |
|---|---|
| E | Corrected Consolidated Close |
| Cancel/Error | Any print flagged as cancel or correction |
| W | Average Price Trade |
| 6 | Derivatively Priced |
| 4 | Derivatively Priced (alternate) |
| P | Prior Reference Price |

**Session bucket (separate from regular session scoring):**

| Code | Description | Bucket |
|---|---|---|
| T | Form T (extended hours) | `extended_hours` |
| U | Extended Hours (FINRA) | `extended_hours` |

**Flag only (included in volume counts; excluded from block detection and directional scoring):**

| Code | Description | Flag |
|---|---|---|
| O | Market Center Opening Trade | `opening_print` |
| M | Market Center Close Trade | `closing_print` |
| Q | Market Center Official Open | `opening_print` |
| I | Odd Lot (< 100 shares) | `odd_lot` — excluded from block detection, counted in volume only |

**Flag and separate analysis:**

| Code | Description | Handling |
|---|---|---|
| F | Intermarket Sweep (ISO) | Included in volume; shown separately as `iso_sweep` in evidence; not counted as a focus/block print |

**No condition code:** Treated as a standard eligible print.

This policy is stored as `condition_code_policy_v1.json` and versioned. Every signal result references the policy version used, ensuring replay reproducibility.

---

## 5. Indicator System: A, B, C

### 5.1 Overview

Every signal component produces three independent indicators rather than a single normalized score. These indicators are never collapsed into a single composite number. They are used separately for display, tier classification, and ordering.

| Indicator | Name | Question answered | Available in |
|---|---|---|---|
| **A** | Universe Percentile | "How unusual is this vs. today's peer group?" | Portfolio mode, Scan mode |
| **B** | Historical Z-score | "How unusual is this vs. the ticker's own history?" | All modes |
| **C** | Raw metric | "What are the actual numbers?" | All modes |

### 5.2 Indicator A — Universe Percentile

**Definition:** For each signal metric, compute the percentile rank of this ticker's value within all tickers in the current session's analysis scope.

**Formula:**
```
A_percentile(ticker, metric) =
  count(tickers in scope where metric_value < ticker.metric_value)
  / count(tickers in scope)
```

**Context labels (always shown in UX):**

| Mode | A label |
|---|---|
| Portfolio | "Relative to your X holdings today" |
| Scan | "Relative to [Universe Name] today (N tickers)" |
| Single ticker | "Universe comparison N/A in single-ticker mode" |

**What A catches:** A ticker that is unusual compared to its peers today. A 3x volume spike during a market-wide panic (where everyone is at 3–5x) has low A — it is market noise, not ticker-specific signal. The same 3x spike on a quiet market day where all peers are at 0.8–1.2x has high A — it is genuinely unusual in context.

### 5.3 Indicator B — Historical Z-score (Robust)

**Definition:** For each signal metric, compute how many robust standard deviations the current value is from the ticker's own 20-session baseline, computed on a time-of-day-matched basis.

**Formula:**
```
B_zscore(ticker, metric, time_bucket) =
  (current_value - median_baseline[ticker, metric, time_bucket])
  / MAD_baseline[ticker, metric, time_bucket]
  * 1.4826  (MAD-to-sigma scaling constant)
```

**Baseline definition:**
- 20 most recent completed trading days strictly before the current session date.
- Organized into 6 intraday time buckets: `open` (09:30–10:00), `morning` (10:00–11:30), `midday` (11:30–13:30), `afternoon` (13:30–15:00), `power_hour` (15:00–15:45), `close` (15:45–16:00).
- Earnings sessions within the 20-day window are excluded from the baseline.
- If fewer than 10 usable baseline sessions exist, the ticker returns `insufficient_history` state and is excluded from scored results.

**Storage:** Precomputed nightly per ticker per metric per time bucket in the `baseline_cache` SQLite table. Live cycles read from this table — they do not recompute from raw data.

**What B catches:** A ticker breaking its own pattern. A mega-cap like AAPL at 2x its own volume is more significant than a volatile small-cap at 2x its own volume — B reflects this because each ticker's MAD is calibrated to its own volatility.

### 5.4 Indicator C — Raw Metric

**Definition:** The actual observed value, always in natural units. Never normalized, never compressed.

**Displayed as-is in the UX:** "10x median volume," "$440M notional," "+72% signed pressure," "4 block prints."

**Used for:** Ordering (see Section 10), threshold rule evaluation (see Section 7), and UX display.

**What C catches:** The raw magnitude of the event. C always preserves the information that a 10x event is twice as large as a 5x event — something normalization would destroy.

---

## 6. Signal Components and Algorithms

### 6.1 Preprocessing (All Modes, All Tickers)

For each ticker/window, before any signal computation:

1. Normalize ticker to current symbol (handle symbol changes).
2. Apply condition code policy v1 — hard exclude, session bucket, flag.
3. Compute `notional = price × size`.
4. Assign session: `pre_market`, `regular`, `after_hours`, `extended_hours`.
5. Assign venue:
   - `exchange == 4 AND trf_id present` → `trf_off_exchange`
   - Known retail internalizer origination code (where available) → `trf_retail_internalized`
   - Known ATS origination code (where available) → `trf_ats`
   - No origination code → `trf_unclassified`
   - All others → `lit_exchange`
6. Trade signing:
   - Quote rule when bid/ask available and trade is not at midpoint.
   - Midpoint trades (price = (bid+ask)/2 within tick tolerance) → `signed: unknown, method: midpoint_excluded`.
   - Tick test (Lee-Ready full: tick test + reverse tick test) when bid/ask unavailable.
   - Unknown when neither method has sufficient confidence.
7. Compute signed volume and signed notional.
8. Record signing method mix: `{quote_rule_pct, tick_test_pct, midpoint_excluded_pct, unknown_pct}`.

### 6.2 Block / Large Print Detection

**Per-ticker thresholds** (from nightly `ticker_profiles` table):

| Liquidity bucket | ADV criterion | Notional floor | Share floor | Relative multiple |
|---|---|---|---|---|
| Micro | ADV < $10M | $100K | 5,000 | 5× |
| Small | ADV $10M–$100M | $250K | 10,000 | 5× |
| Mid | ADV $100M–$1B | $750K | 10,000 | 4× |
| Large | ADV $1B–$10B | $2M | 10,000 | 3× |
| Mega | ADV > $10B | $5M | 10,000 | 3× |

**Classification rule:**
```
absolute_block = notional >= notional_floor[bucket] OR size >= share_floor[bucket]
relative_block = notional >= relative_multiple[bucket] × median_trade_notional[20-day]
               OR size    >= relative_multiple[bucket] × median_trade_size[20-day]

large_print    = absolute_block AND relative_block

trf_focus      = venue IN (trf_off_exchange, trf_ats, trf_unclassified)
                 AND large_print

focus_print    = large_print OR trf_focus OR provider_confirmed_block
```

### 6.3 Block Trade Signal — Raw Metrics (C)

| Metric | Formula | Units |
|---|---|---|
| Focus notional share | `focus_notional / total_notional` | [0, 1] — naturally bounded |
| Focus trade count | count of focus prints | integer |
| Largest print multiple | `largest_focus_notional / median_trade_notional[20-day]` | ratio |
| Block directional pressure | `signed_focus_notional / focus_notional` | [-1, +1] |

**Indicators A and B applied to each metric independently.**

### 6.4 Buy/Sell Pressure Signal — Raw Metrics (C)

Three independent directional readings, each with its own A and B:

| Reading | Formula | Units |
|---|---|---|
| Net notional pressure | `signed_notional / total_notional` | [-1, +1] |
| Net volume pressure | `signed_volume / total_volume` | [-1, +1] |
| Pre-market pressure | `signed_premarket_notional / total_premarket_notional` | [-1, +1] |

**Signing confidence modifier (display, not scoring):**
```
signing_confidence =
  quote_rule_pct × 1.0
  + tick_test_pct × 0.6
  + midpoint_excluded_pct × 0.0
  + unknown_pct × 0.0
```

Shown in UX as: "Direction confidence: 74%." When `signing_confidence < 0.50`, the directional reading is shown with a caution label: "Low signing confidence — treat direction as indicative only."

**Pre-market decay:**
After 09:30 ET, pre-market pressure decays exponentially:
```
pre_market_pressure_effective =
  pre_market_pressure × exp(−λ × minutes_since_open)
  where λ = ln(2) / 60  (half-life: 60 minutes)
```
At 11:00 ET (120 minutes after open) effective pre-market weight is ~25% of original unless reinforced by regular session.

### 6.5 Unusual Volume / Notional Anomaly — Raw Metrics (C)

| Metric | Formula | Units |
|---|---|---|
| Volume ratio | `session_volume / median_baseline_volume[time_bucket]` | ratio (e.g., 4.0 = 4× normal) |
| Notional ratio | `session_notional / median_baseline_notional[time_bucket]` | ratio |
| Trade count ratio | `session_trade_count / median_baseline_count[time_bucket]` | ratio |

**Anomaly bands (used for labeling, not scoring):**

| Band | Condition | UX label |
|---|---|---|
| Normal | B < 1.0σ AND C ratio < 1.5× | — (not shown) |
| Attention | B >= 1.0σ OR C ratio >= 1.5× | "Elevated" |
| Strong | B >= 2.0σ AND C ratio >= 2.0× | "Unusual" |
| Extreme | B >= 3.0σ AND C ratio >= 3.0× | "Extreme" |

**Indicators A and B applied to each ratio independently.**

### 6.6 Pre-Market Unusual Activity

| Metric | Formula |
|---|---|
| Pre-market volume ratio | `premarket_volume / median_premarket_baseline_volume` |
| Pre-market notional ratio | `premarket_notional / median_premarket_baseline_notional` |
| Pre-market pressure | `signed_premarket_notional / total_premarket_notional` |
| Gap direction | `(pre_market_last_price − prior_close) / prior_close` — positive = gap up |

B applied against same-window (pre-market only) historical baseline. A applied within universe pre-market metrics.

### 6.7 Market Flow Trend

| Metric | Formula |
|---|---|
| Pressure delta | `current_net_notional_pressure − rolling_median_pressure[last_5_cycles]` |
| Participation | `current_notional / rolling_median_notional[last_5_cycles]` |

Trend is bullish when pressure delta is positive with sufficient participation. Bearish when negative. Neutral when participation is low.

A and B applied to `abs(pressure_delta)`. Sign preserved separately for direction.

### 6.8 Confirmed Activity Alerts

Provider alerts are classified by provenance:

| Level | Condition | Effect |
|---|---|---|
| Confirmed | Provider explicitly states direction, type, and instrument | Tier elevation eligible (see Section 8) |
| Probable | Provider label present but without full provenance detail | Shown in evidence; no tier elevation |
| Contextual | Social/marketing signal aggregator | Context only; never contributes to tier |

Alert deduplication: alerts within the same session for the same `(ticker, direction, type)` from the same provider count as one event.

### 6.9 Macro Context (FRED)

Fetched daily (not per cycle). Used for labeling and interpretation context, not for scoring.

| Metric | FRED series | Interpretation |
|---|---|---|
| VIX level | VIXCLS | < 15: low fear; 15–25: moderate; 25–35: elevated; > 35: crisis |
| Yield curve spread | T10Y2Y | Negative = inverted (recession signal); positive = normal |
| Fed Funds Rate | FEDFUNDS | Context for rate sensitivity of signals |

Shown in UI as a "Market Regime" banner:
- **Risk-On:** VIX < 18, yield curve positive → unusual buying may reflect genuine demand
- **Risk-Off:** VIX > 25 → large off-exchange prints may reflect liquidation, not accumulation
- **Crisis:** VIX > 35 → all unusual activity signals are treated as context-only

---

## 7. Tier Classification

### 7.1 Single Ticker Mode (B + C only)

| Tier | Criteria | UX meaning |
|---|---|---|
| **A** | B >= 2.5σ on volume OR focus notional share AND directional pressure consistent AND ≥ 1 independent corroboration AND lane state = ready | Actionable supporting evidence |
| **B** | B >= 1.5σ on ≥ 1 component AND direction present AND lane state = ready or partial_usable | Review closely |
| **C** | B >= 1.0σ OR raw anomaly detected but B weak OR direction contradictory | Context only |
| **D** | B < 1.0σ on all components OR lane not ready OR sample < 10 days | Do not use |

### 7.2 Portfolio and Scan Mode (A + B + C)

| Tier | Criteria | UX meaning |
|---|---|---|
| **A** | B >= 2.5σ AND A >= 85th pct on ≥ 2 components AND direction consistent across components AND ≥ 1 independent corroboration AND lane state = ready | Actionable supporting evidence |
| **B** | B >= 1.5σ AND A >= 70th pct on ≥ 1 component AND lane state = ready or partial_usable | Review closely |
| **C** | Activity detected but Tier B criteria not met OR A and B signals are contradictory | Context only |
| **D** | Lane not ready OR B < 1.0σ on all components OR insufficient history | Do not use |

### 7.3 Tier Elevation Rule

A Tier B result is elevated to Tier A if:
- A confirmed provider alert exists for the same ticker and session.
- The alert direction matches the raw signal direction.
- Lane state is ready.

A Tier C result may be elevated to Tier B (not to A) by a confirmed provider alert if B >= 1.0σ.

### 7.4 Tier Suppression Rules

A tier is suppressed (forced to D) when any of the following are true:
- Lane state is `loading` or `source_unavailable`.
- Raw print count after exclusions is < 50 for regular session (insufficient sample).
- > 50% of prints by notional are condition-excluded types.
- All signed prints have `method: unknown` (no signing confidence).
- Data is from a prior session, not the current date/window.

---

## 8. Corroboration System

### 8.1 Corroboration Flags

Corroboration is a set of independent boolean flags. It is not a multiplier on any score.

```json
{
  "price_action_aligned": true,
  "options_flow_aligned": false,
  "news_catalyst_present": false,
  "provider_alert_confirmed": true,
  "pre_and_regular_both_elevated": true,
  "macro_regime_supports": true
}
```

| Flag | Definition | Independence level |
|---|---|---|
| `price_action_aligned` | Price moved in the direction of signed pressure during the analysis window | Strong — different data stream |
| `options_flow_aligned` | Options call/put flow (from companion agent or provider) aligns with direction | Strong — different instrument |
| `news_catalyst_present` | Earnings/news/FDA/macro event today for this ticker | Contextual — does not confirm direction |
| `provider_alert_confirmed` | Confirmed alert (TradeVision, Unusual Whales) with matching direction | Strong — independent human-reviewed source |
| `pre_and_regular_both_elevated` | Both pre-market and regular session show B >= 1.5σ | Moderate — different time windows, same raw source |
| `macro_regime_supports` | FRED macro context supports the direction (e.g., bullish signal in risk-on regime) | Contextual |

### 8.2 Corroboration Count

```
corroboration_count = count of flags where independence = "Strong" AND flag is true
```

Tier A requires `corroboration_count >= 1`. Tier B has no corroboration requirement. Contextual flags are shown in the evidence card but do not count toward tier elevation.

### 8.3 Corroboration Display

Each flag is shown as a visual indicator in the evidence card:

```
✅ Price action aligned (+1.2% during analysis window)
✅ Provider alert confirmed (TradeVision, 14:22 ET)
⬜ Options flow — not available
⬜ News catalyst — none detected today
✅ Pre-market + regular session both elevated
⚠️  Macro regime: VIX 28 — risk-off context; treat bullish signals cautiously
```

---

## 9. Data Quality and Lane State Contract

### 9.1 Lane States

Every lane exposes the following state contract:

```json
{
  "lane_id": "massive_live_trade_slices",
  "ticker": "AVGO",
  "state": "ready",
  "operator_label": "Ready",
  "progress": {
    "requested_tickers": 50,
    "completed_tickers": 50,
    "coverage_pct": 1.0
  },
  "latest_as_of": "2026-06-06T14:35:22Z",
  "freshness_seconds": 120,
  "freshness_sla_seconds": 1800,
  "gaps": [],
  "next_action": {
    "label": "Refresh Live Trade Slices",
    "route": "/api/scheduler/lanes/massive_live_trade_slices/refresh"
  }
}
```

Note: `requested_tickers` reflects the current session scope (mode-dependent), not a fixed 168.

| State | Meaning | UX label |
|---|---|---|
| `ready` | Source exists, analyzed, fresh | Ready |
| `loading` | Extraction running | Data is still loading |
| `source_available_not_analyzed` | Raw data exists, derived agent not yet run | Data loaded, analysis pending |
| `analysis_needs_refresh` | Analysis exists but not fresh | Analysis needs refresh |
| `source_unavailable` | Provider/API/file unavailable | Provider unavailable |
| `partial_usable` | Incomplete but usable for context | Usable — partial coverage |
| `blocked` | Missing required source | Cannot evaluate |
| `disabled_optional` | Optional source not configured | Optional source disabled |
| `insufficient_history` | < 10 baseline sessions | Insufficient history for this ticker |

Do not use "stale" as a user-facing label.

### 9.2 Freshness Rules

| Lane | Max age |
|---|---|
| Live trade slices | 30 minutes |
| Block trade feed | 30 minutes AND must match source lane date/window |
| Pre-market slices | 30 minutes during pre-market |
| Daily bars | Latest completed trading day acceptable when market closed |
| FRED macro context | 24 hours |
| Baseline cache | Rebuilt nightly; acceptable until next market open |
| Earnings calendar | 7 days |
| Universe constituents | 14 days (warning shown if older) |

### 9.3 Quality Metrics (Per Signal Output)

Every signal result must include:

| Field | Description |
|---|---|
| `source_lane` | Exact raw lane(s) used |
| `condition_code_policy_version` | Policy version applied |
| `source_row_count` | Raw prints before exclusion |
| `excluded_row_count` | Prints removed by condition code policy |
| `signed_row_count` | Prints with a confirmed direction |
| `signing_method_mix` | `{quote_rule, tick_test, midpoint_excluded, unknown}` percentages |
| `coverage_pct` | Universe/ticker completeness |
| `latest_event_timestamp` | Newest trade used |
| `analyzed_at` | When the agent processed it |
| `baseline_window_days` | Days in the baseline (typically 20) |
| `baseline_earnings_excluded` | Number of earnings sessions removed from baseline |
| `replay_mode` | Boolean — true if point-in-time clock used |

---

## 10. Scoring and Ordering

### 10.1 C Ordering Score (Internal — Not Shown to User)

Used only to sort the ticker list in Portfolio and Scan modes. Never displayed as a number.

**Pass 1 (bars only — Scan mode screening):**
```
C_screen = volume_ratio_from_bars × (1 + abs(daily_return))
```

**Pass 2 (full — Portfolio and Scan):**
```
C_order = volume_ratio
        × (1 + abs(net_notional_pressure))
        × (1 + focus_notional_share)
        × (1 + 0.5 × confirmed_alert_present)
```

All inputs are ratios or naturally bounded fractions. A 10× volume ticker always sorts above a 5× ticker all else equal. A highly directional 5× ticker can outscore a neutral 8× ticker — which is correct.

### 10.2 Tier as the Primary User-Facing Output

The tier (A/B/C/D) is the primary verdict the user sees. It is determined by the rule-based system in Section 7, not by any score formula.

### 10.3 Direction Determination

Direction is determined by the majority of signed, confident pressure readings:

```
if abs(net_notional_pressure) >= 0.60 AND signing_confidence >= 0.60:
    primary_direction = sign(net_notional_pressure)
elif abs(block_directional_pressure) >= 0.60:
    primary_direction = sign(block_directional_pressure)
else:
    primary_direction = "mixed" or "undetermined"
```

Direction is never inferred from price alone. Price alignment is a corroboration flag, not a direction source.

---

## 11. API Contract

### 11.1 Mode Entry Points

```http
GET  /api/analyze/single?ticker=AVGO
POST /api/analyze/portfolio
GET  /api/scan?universe=sp500&direction=bullish&pass=1
GET  /api/scan?universe=sp500&direction=bullish&pass=2&shortlist=AVGO,NVDA,...
```

### 11.2 Single Ticker Response

```json
{
  "mode": "single_ticker",
  "ticker": "AVGO",
  "generated_at": "2026-06-06T14:35:22Z",
  "tier": "A",
  "direction": "bullish",
  "signing_confidence": 0.74,
  "indicators": {
    "B": {
      "volume_zscore": 3.8,
      "notional_zscore": 4.1,
      "focus_notional_share_zscore": 2.9
    },
    "A": null,
    "C": {
      "volume_ratio": 10.2,
      "notional_ratio": 9.8,
      "focus_notional_share": 0.50,
      "focus_trade_count": 4,
      "largest_print_multiple": 6.2,
      "net_notional_pressure": 0.72,
      "net_volume_pressure": 0.68
    }
  },
  "corroboration": {
    "price_action_aligned": true,
    "options_flow_aligned": false,
    "news_catalyst_present": false,
    "provider_alert_confirmed": true,
    "pre_and_regular_both_elevated": true,
    "macro_regime_supports": false
  },
  "lane_states": [],
  "bluf": {
    "headline": "AVGO — Tier A — Bullish supporting evidence",
    "what_happened": "Notional activity was 9.8× its recent median. 4 TRF/off-exchange focus prints totaled $440M (50% of analyzed notional).",
    "why_it_matters": "Signed notional pressure leaned buyer-side at +72%. Pre-market and regular session both elevated. TradeVision confirmed.",
    "what_to_check": "Confirm price follow-through, VWAP reclaim, and options confirmation before treating as conviction.",
    "limitations": "TRF/off-exchange identifies off-exchange reporting, not the named institution or venue. VIX at 28 — risk-off context."
  },
  "evidence_cards": [],
  "user_actions": []
}
```

### 11.3 Scan Response (Pass 1)

```json
{
  "mode": "scan",
  "universe": "sp500",
  "universe_label": "S&P 500",
  "universe_ticker_count": 503,
  "direction_filter": "bullish",
  "pass": 1,
  "generated_at": "...",
  "performance_tier": "standard",
  "shortlist_count": 28,
  "results": [
    {
      "ticker": "AVGO",
      "preliminary_tier": "A",
      "B_estimate": { "volume_zscore_from_bars": 3.8 },
      "C_screen": 12.4,
      "pass2_status": "pending",
      "label": "Preliminary — live data loading"
    }
  ]
}
```

### 11.4 Stale-While-Revalidate Behavior

When a new cycle is computing, the API returns the last-known signal with:
```json
{
  "data_state": "revalidating",
  "last_cycle_at": "...",
  "current_cycle_started_at": "...",
  "estimated_completion_seconds": 45
}
```

The UI shows a subtle refresh indicator. It does not blank the page or block the user.

### 11.5 Error Responses

| HTTP code | Condition | Body |
|---|---|---|
| 404 | Ticker not in baseline and not fetchable | `{"error": "ticker_not_found", "detail": "AVGO has no baseline data. A background baseline build has been triggered."}` |
| 206 | Partial data only | `{"error": "partial_data", "tier_suppressed_to": "C", "reason": "..."}` |
| 503 | Lane unavailable | `{"error": "lane_unavailable", "lane": "massive_live_trade_slices", "detail": "..."}` |

---

## 12. Data Model

### 12.1 Core Tables

**`ticker_profiles`** (refreshed nightly)
- `ticker`, `name`, `exchange`, `gics_sector`, `gics_industry`, `liquidity_bucket`, `adv_20day`, `notional_floor`, `share_floor`, `relative_multiple`, `last_updated`

**`baseline_cache`** (rebuilt nightly)
- `ticker`, `as_of_date`, `time_bucket`, `metric` (`volume`, `notional`, `trade_count`, `focus_notional_share`, `net_notional_pressure`, ...),  `median`, `mad`, `session_count`, `earnings_excluded_count`, `last_built_at`

**`unusual_activity_observations`**
- `id`, `ticker`, `as_of_date`, `session`, `time_bucket`, `event_start_ts`, `event_end_ts`, `source_lane`, `source_manifest_id`, `condition_code_policy_version`, `event_type`, `trade_count`, `excluded_count`, `total_volume`, `total_notional`, `focus_trade_count`, `focus_notional`, `trf_off_exchange_count`, `trf_off_exchange_notional`, `largest_print_notional`, `largest_print_price`, `signing_method_mix_json`, `raw_print_refs_json` (top 20 by notional only; `truncated` flag if more exist), `created_at`

**`unusual_activity_signal_results`**
- `ticker`, `cycle_id`, `mode`, `universe`, `as_of`, `schema_version`, `tier`, `direction`, `signing_confidence`, `indicators_json` (A, B, C per component), `corroboration_json`, `bluf_json`, `lane_state_json`, `evidence_json`, `calculation_json`, `replay_mode`, `replay_clock`, `baseline_window_days`, `created_at`

**`scan_universes`**
- `universe_id`, `name`, `label`, `category` (`index`, `sector`, `exchange`, `custom`), `parent_universe_id` (for sector scans), `ticker_count`, `last_updated`, `source`

**`universe_tickers`**
- `universe_id`, `ticker`, `added_date`, `removed_date` (null if current)

**`activity_alerts`**
- `id`, `ticker`, `provider`, `alert_type`, `direction`, `notional`, `label`, `provenance_detail`, `session_date`, `alert_timestamp`, `confidence_level`, `dedup_key`, `consumed`, `created_at`

---

## 13. UX and Display Design

### 13.1 Mode Selector (Entry Point)

On session start, the user selects:

```
[ Single Ticker ]  [ Portfolio ]  [ Scan / Discovery ]
```

Each mode has a distinct URL: `/single`, `/portfolio`, `/scan`.

### 13.2 BLUF Card

Every ticker result shows a BLUF (Bottom Line Up Front) card:

```
AVGO — Tier A — Bullish supporting evidence

What happened:
Notional activity was 9.8× its recent median. 4 TRF/off-exchange focus prints
totaled $440M (50% of analyzed notional).

Why it matters:
Signed notional pressure leaned buyer-side at +72%. B-score: 3.8σ above own
20-session median. [S&P 500: 97th percentile by volume anomaly today]

What to check:
Price follow-through, VWAP reclaim, options flow, news catalyst.

Limitations:
TRF/off-exchange identifies off-exchange reporting only — not the named institution
or venue. VIX at 28: risk-off context — treat bullish signals cautiously.
```

### 13.3 Indicator Display

Each ticker row in Portfolio and Scan shows:

```
AVGO   Tier A   B: 3.8σ vol / 2.9σ focus   A: 97th pct (S&P 500)   C: 9.8× notional   ↑ Bullish
```

In single-ticker mode, A is omitted:

```
AVGO   Tier A   B: 3.8σ vol / 2.9σ focus   C: 9.8× notional   ↑ Bullish   Direction confidence: 74%
```

### 13.4 Evidence Cards (Expanded)

1. **Volume Anomaly** — latest vs. baseline, B-score, band label, time bucket
2. **Block / TRF Activity** — focus count, focus notional, largest print multiple, venue classification, B-score
3. **Directional Pressure** — net notional pressure, net volume pressure, signing method mix, confidence
4. **Pre-Market** — pre-market volume ratio, pressure, gap direction, decay state
5. **Market Flow Trend** — pressure delta, participation, trend direction
6. **Confirmed Alerts** — provider name, type, direction, timestamp, confidence level
7. **Macro Context** — VIX regime, yield curve state, interpretation note
8. **Data Health** — lane state, latest source timestamp, coverage, excluded print count, policy version, refresh action

### 13.5 User Actions (Per Ticker)

- Refresh this lane
- Show raw prints
- Show calculation detail
- Explain this tier
- Compare to prior cycle (delta indicator: ↑ +0.4σ since last cycle)
- Mark as reviewed
- Add to watchlist
- Use as supporting evidence
- Ignore for this cycle
- Open related candidate detail

### 13.6 Scan UI — Progressive Loading

- **Pass 1 complete:** Table shows all shortlist tickers with preliminary tier and B estimate. Labeled "Preliminary."
- **Pass 2 in progress:** Progress bar at top shows "Analyzing X of Y tickers." Each row updates individually as Pass 2 completes.
- **Pass 2 complete:** All rows show full indicators. Label removed.
- **Universe performance tier** shown before scan starts with estimated time.

### 13.7 Market Regime Banner

Shown at the top of all mode views:

```
Market Regime: ⚠️  Risk-Off — VIX 28.4 | Yield curve: −0.12% inverted | Fed Funds: 4.75%
Interpretation: Large off-exchange activity may reflect liquidation, not accumulation.
```

Regime: Risk-On (VIX < 18), Neutral (VIX 18–25), Risk-Off (VIX 25–35), Crisis (VIX > 35).

### 13.8 Terminology Policy

**Use:**
- "TRF/off-exchange print" or "Off-exchange reported print"
- "Large print" / "Focus print"
- "Ticker-relative block candidate"
- "Buyer-side / seller-side pressure"
- "Supporting evidence" / "Context only"
- "Analysis needs refresh"
- "Elevated off-exchange participation"
- "Signing confidence: XX%"
- "Incomplete lane — showing best available"
- "B-score: Xσ above own history"
- "A-rank: Xth percentile of [Universe]"

**Never use:**
- "Institution bought" / "Dark pool buyer" / "Smart money is buying"
- "Accumulation" as a headline label
- "Whale activity"
- "Informed flow" as a headline verdict
- "Conviction buy/sell"
- "Guaranteed bullish"
- "Stale"
- "Blocked" for user-reviewable caution states

---

## 14. Deployment Architecture (Pi 5 + Cloudflare)

### 14.1 Hardware

- **Device:** Raspberry Pi 5 (8GB RAM recommended)
- **Storage:** 256GB+ SSD via USB 3.0 or NVMe hat (not SD card for production data)
- **OS:** Raspberry Pi OS Lite (64-bit) or Ubuntu Server 22.04 LTS ARM64

### 14.2 Backend Stack

| Component | Technology | Reason |
|---|---|---|
| Language | Python 3.11+ | Ecosystem, data libraries, Pi support |
| API framework | FastAPI + Uvicorn | Async, lightweight, auto OpenAPI docs |
| Database | SQLite (WAL mode) | Zero server overhead; sufficient for this workload on Pi |
| Lane artifacts | Parquet files on local SSD | Compressed, fast reads, reproducible, replay-ready |
| Scheduler | APScheduler | 5-minute live cycles, nightly baseline builds, weekly universe updates |
| Process manager | systemd service | Auto-restart on reboot, logging via journald |

### 14.3 Scheduled Jobs

| Job | Schedule | Description |
|---|---|---|
| Live lane refresh | Every 5 minutes (market hours) | Pull Massive live slices for active tickers, recompute signals |
| Pre-market scan | Every 5 minutes (04:00–09:30 ET) | Pull Massive pre-market slices |
| Baseline rebuild | Nightly (23:00 ET) | Recompute 20-day baselines for all tickers with sufficient history |
| Ticker profiles update | Nightly (23:30 ET) | Recompute ADV, liquidity bucket, thresholds |
| FRED macro update | Daily (07:00 ET) | Refresh VIX, yield curve, Fed Funds Rate |
| Universe constituent update | Weekly (Sunday 02:00 ET) | Pull index/sector/exchange constituent lists |
| Earnings calendar update | Daily (06:00 ET) | Refresh upcoming earnings dates |

### 14.4 Clock Injection (Replay Support)

All freshness checks, SLA evaluations, and baseline selections use an injectable clock interface:

```python
class LiveClock:
    def now(self) -> datetime:
        return datetime.utcnow()

class ReplayClock:
    def __init__(self, as_of: datetime):
        self._as_of = as_of
    def now(self) -> datetime:
        return self._as_of
```

All agent classes receive the clock at initialization. No direct `datetime.utcnow()` calls in signal code.

### 14.5 Network and Security

- FastAPI serves on `localhost:8000` — not exposed directly.
- `cloudflared tunnel` routes the Cloudflare domain to `localhost:8000`.
- Cloudflare Access (Zero Trust) provides authentication — no public IP exposure, no port forwarding on the Pi's router.
- The web frontend (static HTML/JS/CSS) is served by FastAPI's `StaticFiles` mount from `/static/`.
- API endpoints are prefixed `/api/`. Frontend routes are handled by the SPA or by FastAPI serving `index.html` for all non-API routes.

### 14.6 Frontend Stack

| Component | Technology | Reason |
|---|---|---|
| Markup | HTML5 + CSS3 | No build step; Pi serves static files |
| Interactivity | HTMX + Alpine.js | Lightweight; server-driven updates; no Node.js required |
| Live updates | Server-Sent Events (SSE) | FastAPI supports SSE natively; ideal for progressive Pass 2 scan results |
| Charts | Chart.js (CDN) | Lightweight; no bundler needed |
| Styling | Tailwind CSS (CDN play version) | Utility-first; no build step for CDN version |

### 14.7 Storage Estimates (Per-Day)

| Data | Size estimate |
|---|---|
| Raw Parquet lane artifacts (168 tickers, 5-min cadence) | ~50–150 MB/day |
| SQLite baseline cache (all tickers, 6 buckets) | ~20 MB total (not per day) |
| Signal results table (daily) | ~5–10 MB/day |
| Universe constituent JSON files | ~5 MB total |
| FRED macro cache | < 1 MB |
| Total after 30 days retention | ~5–7 GB |

Recommended: retain raw Parquet for 30 days; retain signal results for 1 year.

---

## 15. Validation Plan

### 15.1 Offline Replay Framework

- All signal computation uses `ReplayClock` seeded to historical timestamps.
- Baseline cache is queried with `as_of_date = replay_date − 1` to enforce point-in-time constraint.
- Raw Parquet lane artifacts are read from historical snapshots, not current data.
- Replay results are stored in a separate `replay_signal_results` table with `replay_mode = true`.

### 15.2 Outcome Evaluation

| Horizon | Metric |
|---|---|
| 30-minute forward return | Mean return of Tier A bullish signals at T+30 min |
| 1-hour forward return | Mean return at T+60 min |
| Close-to-close return | Same-day return |
| Next-day open-to-close | Overnight persistence |
| Realized volatility | Whether extreme B-scores predict realized vol |
| Max adverse excursion | Risk-adjusted outcome |
| Pre-news detection rate | Whether Tier A signals preceded news events |

### 15.3 Statistical Treatment

- Walk-forward validation with expanding window (minimum 6 months in-sample before OOS evaluation).
- Ticker-clustered robust statistics (not IID assumption).
- HAC/Newey-West standard errors for overlapping return horizons.
- Benjamini-Hochberg FDR correction at FDR = 0.10 for all threshold and component combinations.
- Liquidity bucket controls: evaluate separately for Micro/Small/Mid/Large/Mega.
- Market regime controls: evaluate separately in Risk-On and Risk-Off regimes.

### 15.4 Quantitative Acceptance Criteria

| Criterion | Threshold | Gate |
|---|---|---|
| Information Ratio (Tier A signals, 30-min) | IR >= 0.30 over 1-year OOS window | Phase 5 unlock |
| False positive rate (Tier A bullish, next-close negative) | <= 40% | Phase 5 unlock |
| Precision at top decile (30-min forward return) | >= 55% positive | Phase 5 unlock |
| B-score stability (consecutive cycle correlation for unchanged tickers) | >= 0.90 | Phase 4 gate |
| Lane availability SLA | >= 95% of cycles with required lanes ready | Phase 4 gate |

---

## 16. QA Matrix

| Scenario | Expected result |
|---|---|
| Raw lane loading | "Data is still loading"; no prior result shown as current |
| Lane ready, derived missing | "Data loaded, analysis pending" |
| TRF/off-exchange detected | "Off-exchange reported print" — not "dark pool buyer" |
| Large lit-exchange print only | "Large print" — not "dark pool" |
| High volume, negative pressure | Bearish or mixed per Section 10.3 |
| High volume, no direction (< 0.60 pressure) | "Undetermined direction" — context only |
| Signing confidence < 0.50 | Direction labeled "Low confidence — indicative only" |
| All prints are average-price/derivatively-priced | Score suppressed; "Non-directional print types only" |
| Focus notional share = 1.0 | "All prints are focus prints — baseline context missing" |
| Partial usable data | Tier capped at C; labeled "Usable — partial coverage" |
| Analysis not fresh | "Analysis needs refresh" + refresh button; no old score shown as current |
| Source unavailable | "Provider unavailable"; no score emitted |
| Ticker outside universe | Shown as "Outside current universe" in scan; available in single-ticker mode |
| Duplicate trade prints (same id) | Deduped before analysis; source_row_count reflects post-dedupe |
| Signing method: 100% unknown | Direction: "Undetermined"; no directional signal emitted |
| Pre-market volume > 50% of session | Pre-market pressure decay applied; caution label shown |
| Ticker with < 10 baseline sessions | `insufficient_history` state; excluded from scan results |
| Provider alert direction conflicts with raw signal | Alert shown in evidence; does not trigger tier elevation |
| Clock skew between lanes | Freshness check flags inconsistency; user notified |
| Replay mode | `replay_mode: true` in result; no live data used |
| Macro regime: Crisis (VIX > 35) | All signals downgraded to context-only; regime banner prominent |
| Sector scan within S&P 500 | Results computed in single pass; no two-pass overhead |
| 🔴 Extended universe (Russell 2000) | Pass 1 only by default; user prompted to trigger Pass 2 on shortlist |

---

## 17. MVP Phase Plan

### Phase 1 — Contracts (No Code)

Deliverables:
- `condition_code_policy_v1.json` — locked and versioned
- Baseline window definition document (20-day standard, 6 time buckets, earnings exclusion rules)
- A/B/C indicator definitions document
- Lane state contract schema
- UX terminology policy (Section 18 of this doc)
- API response schema (Section 11 of this doc)
- Data model DDL (Section 12 of this doc)
- Replay clock interface spec

### Phase 2 — Data and Feature Engine

Deliverables:
- Universe constituent loader (JSON files + weekly update scheduler)
- Ticker profile builder (liquidity bucket, thresholds — nightly)
- Earnings calendar fetcher (FMP/Polygon free tier)
- FRED macro fetcher (daily)
- Raw print normalizer (condition code policy, venue classification, trade signing)
- Baseline cache builder (20-day, 6 buckets, earnings exclusion, point-in-time constraint)
- Block/TRF detector (per-bucket thresholds)
- Signal component computers (volume anomaly, block pressure, buy/sell pressure, pre-market, trend)
- A indicator computer (cross-sectional percentile — Portfolio/Scan modes)
- B indicator computer (historical z-score from baseline cache)
- Corroboration flag evaluator
- Tier classifier (single-ticker rules, portfolio/scan rules, elevation and suppression)
- C ordering score computer (Pass 1 and Pass 2 variants)
- Confirmed alert importer and deduplicator
- Lane state manager
- Replay harness with `ReplayClock` injection

### Phase 3 — API and Dashboard

Deliverables:
- FastAPI application with all endpoints (Section 11)
- Single Ticker mode UI
- Portfolio mode UI
- Scan/Discovery mode UI with two-pass progressive loading
- Market Regime banner
- BLUF card component
- Evidence card set (8 card types)
- Indicator display (A, B, C per metric)
- Corroboration flag display
- User action panel
- Universe selector with performance tier indicator
- Data health / lane state display
- Cloudflare tunnel configuration

### Phase 4 — Validation and Calibration

Deliverables:
- Replay harness integration with historical Massive data
- Outcome evaluation across 4 return horizons
- BH FDR correction procedure
- Look-ahead bias audit checklist and automated check
- Tier threshold calibration per liquidity bucket
- B-score stability measurement
- Lane availability SLA measurement
- Walk-forward IR and precision metrics
- Acceptance criteria gate evaluation

### Phase 5 — Paper-Trading Integration

Deliverables (only after Phase 4 acceptance criteria pass):
- Tier A signals exposed as supporting evidence in paper-trade candidate ranking
- Corroboration requirement enforced before tier contribution to candidate score
- Caution display (not blocking) when evidence is incomplete
- Candidate detail page integration (full BLUF + evidence cards inline)
- Scan mode "Add to paper-trade watchlist" action

---

## 18. Open Questions — Resolved

| # | Original question | Resolution |
|---|---|---|
| 1 | Require quote data for high-confidence signing? | Yes — quote-rule-only mode when bid/ask coverage >= 70%. Fall back to tick test with confidence discount. |
| 2 | Minimum source coverage for live paper-trading support? | 90% ticker coverage on `massive_live_trade_slices` for current date/window. Below 90%: context-only. |
| 3 | Pre-market anomalies decay after open? | Yes — exponential decay, 60-min half-life post 09:30 ET. Negligible by 11:00 ET unless reinforced. |
| 4 | Large off-exchange prints near VWAP scored differently? | Yes — prints within ±0.5 ATR of VWAP are flagged `price_level_bonus` in corroboration evidence. |
| 5 | Options flow: same agent or companion? | Companion agent. Referenced via `options_flow_aligned` corroboration flag only. |
| 6 | Which provider alert source is "confirmed"? | Confirmed = provider explicitly states direction, type, and instrument with human-reviewed alert. TradeVision and Unusual Whales qualify. Social aggregators do not. |
| 7 | All 168 tickers every cycle, or only active? | No fixed universe. Mode determines scope. Scan mode uses two-pass architecture for large universes. |
| 8 | Duplicate articles/alerts for same raw prints? | Dedup by `(ticker, session_date, direction, type, provider)`. Multiple alerts from different providers for same event count as one corroboration event. |
