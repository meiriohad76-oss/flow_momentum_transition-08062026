# UTA Audit: Lessons Learned
*Compiled from Audit 1 (2026-06-15) and Red Team Audit 2 (2026-06-26)*

This document captures the systemic patterns behind every verified bug found across both audits.
Use it as a checklist before any new signal, metric, or gate is added to the codebase.

---

## 1. Signal Basis: Never Mix Total-Basis and Signed-Only Metrics

### The rule
Every pressure metric must clearly state its denominator in both the backend computation and the frontend label. Two distinct metrics exist:

| Metric | Formula | Denominator | When to use |
|--------|---------|-------------|-------------|
| `net_notional_pressure` | `(buy$ − sell$) / total$` | All trades (including dark pool + unsigned) | Volume-anomaly context; never for directional confirmation |
| `net_signed_pressure` | `(buy$ − sell$) / (buy$ + sell$)` | Labeled trades only | Directional confirmation; the number that drives `direction` |

### Bugs caused by mixing them
- **Audit 1:** Direction was "undetermined" on a stock with 99% net signed pressure — because the frontend was displaying `net_notional_pressure` (46%) in the signed pressure row, making it look unconfirmed.
- **Audit 2 (H2):** `signedPressure` in `BlufFindings` fell back to `net_notional_pressure` when `net_signed_pressure` was null — showing a lower, diluted percentage that contradicted the tier that was derived from the signed-only basis.
- **Audit 2 (H3):** `BlufCard` header tile and `BlufFindings` row used different fallback chains for the same metric — they showed different numbers for the same value.
- **Audit 2 (scan pass2, L2):** `signed_pressure` column in pass2 results was populated from `net_notional_pressure` instead of `net_signed_pressure`.

### How to prevent it
- Every variable that holds pressure must be named `netSignedPressure` or `netNotionalPressure` — never just `pressure`.
- Every frontend display must label what it shows: "% labeled" for signed-only, "% total flow" for total-basis.
- Fallback chains must fall back to `null` / "N/A" rather than to a different metric with a different denominator.
- **Threshold checks must use the same metric that drives the classification.** If `classifyTier` uses `net_signed_pressure`, then `buildTradeAnalysis.directional` must use `net_signed_pressure` with the same threshold logic — not a hardcoded flat gate.

---

## 2. Threshold Consistency: One Threshold, Applied Everywhere

### The rule
Any threshold used in the classification logic (`classifyTier`, `signTradePrints`) **must appear identically** in every place that uses the same gate: display labels, criteria objects, recommendation text, and `next_trigger_needed` messages.

### Bugs caused by inconsistency
- **Audit 1:** Binary `signingConf >= 0.5 && pressure >= 0.6` gate in `signTradePrints` made direction impossible for dark-pool-heavy stocks (signing conf < 0.5). A tiered threshold was introduced.
- **Audit 2 (C3):** The tiered threshold was added to `signTradePrints` and `classifyTier`, but `buildTradeAnalysis.directional` still used the old flat `conf >= 0.5 && pressure >= 0.6` gate. Result: a stock could be classified Tier B ("bullish") by `classifyTier` but `buildTradeAnalysis` would say "No directional setup" — BLUF narrative and tier badge contradicted each other.
- **Audit 2 (M11):** `next_trigger_needed` message hardcoded "Needs ≥60% pressure and ≥50% confidence" — misleading for the 35–50% confidence zone where the real requirement is 72%.
- **Audit 2 (M3):** `BlufFindings` block prints conviction used `>= 8` for Extreme while the backend's own `cExtreme` definition uses `>= 2`. Operators would never see "Extreme" even when the backend classified the session as extreme.

### How to prevent it
- Extract threshold constants into a single named location. If a threshold appears more than once, it will diverge.
- When you change a threshold, search the entire codebase for the old value and update every occurrence.
- Display messages (BLUF, `next_trigger_needed`) must derive from the same threshold variables — never hardcode numbers that are already constants elsewhere.

---

## 3. Dark Pool / TRF Share is a Separate Signal, Not a Dilution Factor

### The rule
Dark pool / TRF off-exchange routing share and signing confidence are **two different metrics**. They must never be substituted for each other.

| Metric | Measures | Source |
|--------|---------|--------|
| `signing_confidence` | What fraction of dollar flow could be directionally labeled (buyer lifting ask vs. seller hitting bid) | `signTradePrints` → `pressure.signing_confidence` |
| `trf_share` | What fraction of dollar flow was routed to dark pools / TRF / internalization | `computeBlockStats` → `block_flow.trf_share` |

A stock can have high signing confidence with high TRF share (many labeled dark pool prints), or low signing confidence with low TRF share (mid-price prints on lit exchanges).

### Bugs caused by mixing them
- **Audit 2 (C1):** `BlufFindings` computed `trfShare = unsigned_notional / total_notional`, which equals `1 − signing_confidence`. This is not the dark pool share. The actual TRF routing percentage is in `block_flow.trf_share`. The "Dark pool / TRF share" row was showing the wrong number entirely.
- **Audit 2 (M2):** `BlockOffExchangeBody` fell back from `block_flow.trf_share` to `C.focus_notional_share` — which is the institutional-size print share, an unrelated metric. Two panels in the same view showed different numbers for "dark pool share."

### How to prevent it
- `block_flow.trf_share` = off-exchange routing = the "dark pool" percentage for display.
- `pressure.signing_confidence` = labelable fraction = confidence in the direction signal.
- Never use one as a fallback for the other.
- `focus_notional_share` = fraction of dollar flow in institutional-size prints = not a venue metric.

---

## 4. Corroboration Must Be Auto-Computed, Never Hardcoded

### The rule
Corroboration fields that can be derived from available data (`price_action_aligned`, `premarket_regular_elevated`) must be computed from that data before being passed to `classifyTier`. A hardcoded constant (0, false, null) in a slot that drives tier gating is a critical correctness bug.

### Bugs caused by hardcoding
- **Audit 1 / Audit 2 (C2 in Audit 1):** `independent_confirmation_count` was hardcoded to `0` in the call to `classifyTier`. Because `hasCorroboration = count >= 1`, Tier A was mathematically impossible regardless of how strong the session was.
- **Root cause pattern:** `buildLiveBluf` accepted corroboration from its caller but didn't forward it to `buildTradeAnalysis`. Fixing the call site did nothing because the forwarding was broken.

### How to prevent it
- Never pass `independent_confirmation_count: 0` as a literal. Compute it from the actual signal list.
- After adding any auto-computable corroboration signal, trace the full call chain from computation → `classifyTier` → `buildTradeAnalysis` and verify each step is forwarded.
- Write a smoke test: if all signals are favorable, `classifyTier` must reach Tier A. If it can't, the corroboration chain is broken.

---

## 5. Field Name Contracts: Backend Emits → Frontend Reads Must Match Exactly

### The rule
Any field the frontend reads from the API response must match the exact field name the backend emits. The TypeScript types file (`types.ts`) must be the single source of truth — if a field name changes in the backend, the type and every frontend read must change together.

### Bugs caused by mismatches
- **Audit 2 (M5):** `CorroborationPanel` read `corr.independent_strong_count`. The backend emits `corr.independent_confirmation_count`. `strongCount` was always 0, so "0 of 3 strong signals" was always displayed regardless of actual confirmed signals.
- **Audit 2 (Finding 4.2):** `BlockOffExchangeBody` read `bf?.trf_share` (correct) but fell back to `C.focus_notional_share` (wrong metric, different field).

### How to prevent it
- Before adding a frontend read of a backend field, grep the backend for the exact field name in the return statement.
- Keep `types.ts` accurate. If a field name diverges between `types.ts` and the backend, both must be fixed together.
- Code review checklist: for every `?.fieldName` in a UI component, verify the backend has a property with that exact name in the JSON response.

---

## 6. State Machine Completeness: Every State Must Have a UI Branch

### The rule
Every variant of a `LoadState<T>` (`idle | loading | ready | error`) must have an explicit render branch. Missing branches produce blank screens or frozen UI with no user escape.

### Bugs caused by missing branches
- **Audit 1:** `scan.status === "error"` had no render branch → blank page with no error message and no retry button.
- **Audit 2 (H6):** `pass2.status === "error"` had no render branch → frozen resolving table, no error message, no "Try again" button.
- **Audit 2 (H5):** Results branch condition `(pass2.status === "ready" || scan.status === "ready")` caused both the pass1-done view and the results view to render simultaneously when `scan.status === "ready"` and `pass2.status === "idle"`. Neither was the intended behavior.
- **Audit 2 (M6):** `ResolvingTable` prop type was `"idle" | "loading" | "ready"` — the "error" variant was excluded from the type, so when pass2 errored, all tickers showed as "Queued" forever.

### How to prevent it
- For every `LoadState`, write the four branches: idle, loading, ready, error. If a branch is intentionally empty, make it explicit with a comment.
- State machine branches must be **mutually exclusive**. Use `if`/`else if` or guard early returns; avoid independent boolean checks that can fire simultaneously.
- Every async operation that sets an error state must have a corresponding UI branch that shows the error message and offers an escape (retry button or reset).

---

## 7. Error Path Coverage: Every Async Flow Needs a Recovery Escape

### The rule
Every async operation must be recoverable without a hard page refresh. The user must always have a path back to the idle/start state.

### Bugs caused by missing escapes
- **Audit 1:** Scan error showed a blank page. No retry. No "new scan" button. Only fix was hard refresh.
- **Audit 2 (M7):** No cancel button during pass1 loading. A slow scan (S&P 500 = minutes) traps the user.
- **Audit 2 (M9):** `runPass2` silently substituted `["AVGO"]` when `scan.data` was null, sending meaningless pass2 results instead of showing an error.
- **Audit 2 (L3):** `getReplayPayload()` was called in live mode just to extract `replay_clock` for a log entry. A missing fixture file would throw and crash the successful live cycle at the logging phase.

### How to prevent it
- Any fallback that substitutes a default value (like a ticker name) instead of surfacing an error will mask bugs. Prefer `throw` or `setError` over a silent default.
- After every await, trace what happens if the request fails. Is there a `.catch()` that sets an error state? Does the UI branch for that state exist (see Rule 6)?
- Destructive operations (clearing state, overwriting data) must happen **at the start** of a new operation, not at the end of the previous one. Example: `setPass2({idle})` must happen at the beginning of `runScan`, not after `setScan({ready})`.

---

## 8. Corroboration Panel Accuracy: Display Must Match Computation

### The rule
The plain-English explanation of what a metric means must accurately describe the metric being shown. "Signed pressure" is **not** a percentile rank vs history — it is the raw net imbalance among labeled trades.

### Bugs caused by inaccurate descriptions
- **Audit 2 (M1):** The undetermined-direction note said: "A reading of −93% means today's balance is more sell-tilted than 93% of its own sessions." This is wrong. −93% means 93% of labeled notional was sell-side (raw ratio). The percentile-vs-history metric is the B-score / anomaly band, not the signed pressure tile.
- **Audit 2 (M4):** The `price_action` data line always said "vs prior close" even when it was computed from `intraday_change_pct` (vs today's open). The label contradicted the actual comparison.

### How to prevent it
- Every display value must be accompanied by the correct label. `net_signed_pressure` = raw labeled ratio. `volume_zscore` = σ above own median. `anomaly_band` = extreme / elevated / normal.
- When the backend computes a derived value with a specific formula, the frontend note must describe that exact formula — not a different formula that sounds similar.
- Test descriptions by plugging in example values: "If this number is X, what does the note say? Is that accurate?"

---

## 9. Universe Loading: All Loaders Must Use the Same Caching Strategy

### The rule
All universe loaders must go through `cachedUniverseLoad` (in-memory, 12-hour TTL) as the first layer. Per-loader disk caches are allowed as a second layer but must not be the only layer.

### Bugs caused by missing cache
- **Audit 2 (L2):** `sp500` and all sector universes bypassed `cachedUniverseLoad`. With default config (`utaSp500UniverseCacheMs = 0`), disk caching was also disabled. Every scan call fetched Wikipedia. Multiple consecutive scans could hit rate limits.
- **Audit 1:** `loadLiveSp500Universe` was routed through `loadISharesEtfHoldings` by mistake during a refactor, causing a 20-second timeout before fallback.

### How to prevent it
- Adding a new universe loader: wrap the outermost call in `cachedUniverseLoad("universe_id", loaderFn)`.
- `sp500` and sector universes need the in-memory cache layer added. The disk cache alone is insufficient.
- `cachedUniverseLoad` is designed to be composable — loaders that call other loaders still benefit from the outer cache.

---

## 10. Conviction Labels Must Align With Backend Tier Definitions

### The rule
The frontend conviction label for a signal ("Extreme / Strong / Moderate / Weak") must use thresholds that align with the backend's own `cExtreme` / `bExtreme` definitions for the same signal.

### Bugs caused by misalignment
- **Audit 2 (M3):** `BlufFindings` used `focusCnt >= 8` for Extreme block prints conviction. The backend's `cExtreme` definition uses `focus_trade_count >= 2`. This means the frontend conviction badge would show "Strong" (max) for a session the backend classifies as extreme in its own tier logic. The conviction label misled the operator about signal strength.

### How to prevent it
- When adding conviction levels to a finding, open the backend `classifyTier` function and find the exact threshold for `cExtreme`/`bExtreme` for that signal. Use the same value.
- For B-score signals, the threshold is: `< 1.5σ = Weak`, `1.5–2.5σ = Strong`, `>= 2.5σ = Extreme`.
- For C-level (raw) signals, align with the `cExtreme` definition in `classifyTier`.

---

---

## 11. Cross-Component Label Consistency: Same Metric, Same Name, Same Threshold Everywhere

### The rule
When the same metric is shown in multiple places (RECOMMENDATION text, evidence row, pill badge, BLUF section, backend narrative), every occurrence must:
1. Use the **same variable** (not different variables that have the same name but different denominators)
2. Show the **same threshold** (not the old flat gate in one place and the conf-adjusted gate in another)
3. Use a **label that matches what the number actually measures** — not a generic term that fits the closest concept

### Bugs caused by cross-component inconsistency (Audit 3 findings)
- **RECOMMENDATION "NO directional edge: signed pressure is only 46.3%"** while the evidence row directly below said **"Bullish directional edge confirmed (98.5%)"** — both were on the same screen. The RECOMMENDATION used `net_notional_pressure` (46.3%) but the evidence row used `net_signed_pressure` (98.5%). Same screen, same signal, two different metrics with different names used interchangeably.
- **"Direction confidence 44%"** pill — 44% is the **signing coverage** (fraction of dollar flow that got directional labels), not the confidence that the direction call is correct. With 86% signed pressure, the direction call is highly confident. The label was wrong.
- **"+86.1% labeled"** in the evidence row — "labeled" was opaque. "Signed" is the correct term (matches "signed flow pressure", the name of the metric).
- **RECOMMENDATION "≥60% threshold met"** when the actual conf-adjusted threshold was 72% (signing coverage < 50%). The recommendation was showing the old threshold, not the one actually applied.
- **Backend `why_it_matters`: "net notional pressure is 86.1%"** — but the variable used was `net_signed_pressure`. The label described the wrong metric.

### Why audits miss this class of bug
Audits that check calculations in isolation miss **cross-component semantic consistency**. A calculation audit verifies that `net_signed_pressure` is computed correctly. It does not verify that the RECOMMENDATION text, which runs in a completely separate code path, uses `net_signed_pressure` rather than `net_notional_pressure` — especially if both happen to have values that make the same directional conclusion in most test cases.

### How to prevent it
- For every metric that appears in more than one place, list all occurrences and verify each uses the identical variable and the same threshold.
- **Read the screen as a user would.** If the RECOMMENDATION says "X" and the row directly below says "not X", the audit failed.
- Pill badges that show percentages must be cross-checked: what does the number measure? What would a user assume it means? If those differ, the label is wrong.
- Threshold values in display text must be derived from the same constant as the actual gate — never typed as a literal.
- **Audit cross-component paths independently:** the backend narrative (`bluf.why_it_matters`) and the frontend RECOMMENDATION are two independent code paths that can silently disagree on metric names.

---

## Summary Checklist — Before Merging Any UTA Change

```
[ ] Every new pressure metric clearly names its basis (signed-only vs total)
[ ] Thresholds that appear in classifyTier also appear in buildTradeAnalysis and in display text
[ ] Dark pool share reads from block_flow.trf_share, not from pressure.unsigned_notional
[ ] Auto-computable corroboration fields are computed, not hardcoded to 0 or false
[ ] Every field the frontend reads matches the exact field name the backend emits
[ ] Every LoadState variant has an explicit render branch (idle / loading / ready / error)
[ ] Every error state has a recovery escape (retry button or reset)
[ ] Async state resets happen at the START of new operations, not after success
[ ] Fallbacks use null/"N/A", not a different metric with a different meaning
[ ] Display descriptions accurately describe the metric shown (test with example values)
[ ] Conviction thresholds align with backend cExtreme/bExtreme definitions
[ ] New universe loaders are wrapped in cachedUniverseLoad
[ ] CROSS-COMPONENT: for every metric shown in multiple places, verify same variable + same threshold in all occurrences
[ ] CROSS-COMPONENT: read the assembled screen as a user — RECOMMENDATION and evidence rows must not contradict each other
[ ] CROSS-COMPONENT: pill/badge labels describe what the number actually measures (not the closest-sounding concept)
[ ] CROSS-COMPONENT: backend narrative text (bluf, why_it_matters) uses the same variable name as the frontend display
```
