# UTA Single Ticker Dashboard UX Improvements — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix four UX gaps in the Single Ticker view: redundant B/C lanes, unread flow-vs-price tension, opaque corroboration panel, and context-free block metrics.

**Approach:** Option A — targeted panel rewrites within existing panel boundaries. No structural layout changes. All changes are in `src/uta/src/evidence.tsx`, `src/uta/src/components.tsx`, and `src/uta/src/styles.css`.

**Files touched:**
- `src/uta/src/evidence.tsx` — all panel logic lives here
- `src/uta/src/components.tsx` — `IndicatorGrid` (B/C merge), `VolBars` (sparkline reuse)
- `src/uta/src/styles.css` — color tokens, new modifier classes

---

## 1. Merged B+C Indicator Panel

### What changes
The 3-column indicator row (B · A · C) becomes 2 columns: **[Flow Magnitude · A]**.

The merged panel replaces both B and C columns. A (Universe Percentile) is unchanged.

### Content of the merged panel

**Header:** `B+C · VS 20-SESSION HISTORY`

**Hero row:**
```
0.96×  normal dollar flow          -0.16σ
       ↑ ratio vs own median    ↑ std devs from own 20-session history
```

**Sub-metrics row:**
```
vol 1.02×  ·  notional 0.96×  ·  1 focus print
```

**Status line:**
```
● Normal — 1.66σ below the 1.5σ review trigger
```

### Color rules (applied to the whole panel)
| B-score (best of vol/notional σ) | Panel color | Status dot |
|---|---|---|
| < 0.5σ | grey (neutral) | grey |
| 0.5σ – 1.49σ | amber | amber |
| ≥ 1.5σ | green | green |

### Implementation notes
- `IndicatorGrid` in `components.tsx` currently renders 3 columns. Change to 2: left column renders merged B+C content, right column renders A content unchanged.
- Best B-score = `Math.max(B.volume_zscore ?? 0, B.notional_zscore ?? 0)` — drives the color.
- Status line text: if below trigger, show `"Need +{gap}σ to trigger review"`; if triggered, show `"Above 1.5σ review threshold"`.
- The ratio shown is `C.notional_ratio` (dollar flow multiple). The σ is `B.notional_zscore`. Sub-metrics pull `C.volume_ratio`, `C.notional_ratio`, `C.focus_trade_count`.

---

## 2. Flow/Price Tension — BLUF Headline + Findings Row

### Trigger condition
Divergence is detected when:
```js
const priceSide = priceChg > 1 ? "bullish" : priceChg < -1 ? "bearish" : "flat";
const flowSide  = signedPressure >= 0 ? "bullish" : "bearish";
const diverging = priceSide !== "flat" && priceSide !== flowSide;
```

### Touch point 1: BLUF headline meta row
The last-close pill gains a suffix and amber styling when `diverging === true`:

- **Normal:** `Last close $100.23 (+2.71%)` — green pill
- **Diverging:** `Last close $100.23 (+2.71%) ↑ — diverges from flow ⚠` — amber pill with amber border

No new pill. The existing `<Pill tone={tone}>` changes `tone` from `"good"` to `"warn"` and the text gains the suffix.

### Touch point 2: Findings row — "Signed flow pressure"
When `diverging === true`, the findings row gets visual treatment:

- **Row class:** `bf-row bf-diverge` (instead of `bf-warn`) — adds amber left border (3px solid `var(--warn)`)
- **Status icon:** `⚠` instead of `!`
- **Note text:** already written correctly in the existing `priceSide !== flowSide` branch — no text change needed

New CSS class:
```css
.bf-row.bf-diverge {
  border-left: 3px solid var(--warn);
  background: color-mix(in srgb, var(--warn) 6%, transparent);
}
.bf-row.bf-diverge .bf-mk { color: var(--warn); }
```

---

## 3. Corroboration Panel — Read-Only with Color, Icons, Data Text

### Row structure (replaces the current checkbox list)
Each row is a card with 4 layers:

```
┌─ [ICON] Label                    WEIGHT  SOURCE ──────────────────┐
│  Data line (actual numbers from backend when auto)                 │
│  Interpretation text (what this means for this specific ticker)    │
└────────────────────────────────────────────────────────────────────┘
```

### Icon + color rules
CSS color variables to use: `--buy` (green), `--sell` (red), `--warn` (amber). Backgrounds: `--buy-soft`, `--sell-soft`, `--warn-bg`.

| State | Left border | Icon | Icon color |
|---|---|---|---|
| Strong + confirmed (`true`) | `--buy` (3px) | `✓` | `--buy` |
| Strong + unconfirmed (`undefined`) | `--warn` (3px) | `○` | `--warn` |
| Strong + explicitly false (`false`) | `--sell` (3px) | `✗` | `--sell` |
| Moderate + confirmed | no border | `✓` | `--buy` |
| Moderate + unconfirmed/false | no border | `○` / `✗` | `var(--text-2)` |
| Contextual (any) | no border | `ℹ` | `var(--text-2)` |

### Per-row data text rules

**Price action aligned** (auto):
- Confirmed: `"Price {+/-X.XX}% vs prior close — moves WITH {direction} flow ✓"`
- Diverging: `"Price {+X.XX}% vs prior close — moving AGAINST {direction} flow ⚠"` (amber)
- Unknown: `"Price change not available — check chart manually"`

**Provider alert confirmed** (manual):
- Always: `"Open your UOA / block-flow provider and search {TICKER} for today. Any alert — regardless of direction — confirms institutional scale."`

**Options flow aligned** (manual):
- Directional: `"Look for {call/put} sweeps or unusual volume in {TICKER} options chain — directional match to {direction} flow."`
- Undetermined: `"Check for unusual options volume on either side — volume alone (not direction) confirms scale."`

**Pre-market + regular elevated** (auto):
- Backend provides only a boolean (`corr.premarket_regular_elevated`), not raw pre/regular ratios. No sparkline — text-only.
- Confirmed (`true`): `"Both pre-market and regular-session volume were elevated vs own history — sustained multi-session flow is a stronger signal than a single spike."`
- Unconfirmed (`undefined`): `"Could not auto-compute — bar data lane may be unavailable. Check whether pre-market and the regular session both showed elevated activity."`
- False: `"Only one session was elevated (not both). A single-session spike is weaker than sustained flow across pre-market and regular hours."`

**News catalyst present** (manual):
- Always: `"Check earnings calendar, analyst actions, and macro events for {TICKER} on {today's date}."`

**Macro regime supports** (manual):
- Directional: `"Check sector ETF and broad market regime — does the backdrop support {direction} positioning?"`
- Undetermined: `"Could elevated volume reflect index rebalancing, sector rotation, or event risk rather than a directional bet?"`

### CSS additions
```css
.corr-row { border-left: 3px solid transparent; border-radius: 4px; padding: 10px 12px; margin-bottom: 6px; }
.corr-row.strong-confirmed  { border-left-color: var(--buy);  background: var(--buy-soft); }
.corr-row.strong-missing    { border-left-color: var(--warn); background: var(--warn-bg);  }
.corr-row.strong-false      { border-left-color: var(--sell); background: var(--sell-soft); }
.corr-data-line { font-size: 0.82rem; font-weight: 600; margin-bottom: 2px; }
.corr-interp    { font-size: 0.78rem; color: var(--text-2); line-height: 1.4; }
```

---

## 4. Block/Off-Exchange Panel

### Hero metrics — inline sub-labels

**Current:**
```
FOCUS NOTIONAL    FOCUS SHARE    LARGEST PRINT
$98M              0%             195.4×
```

**New:**
```
FOCUS NOTIONAL        TRF / DARK POOL SHARE    LARGEST PRINT
$98M                  0%                        195.4×
1 print above floor   All lit exchange           the $500K floor
```

Changes:
- "Focus share" label → "TRF / Dark pool share" (it measures `trf_share`, not focus notional share)
- Sub-label under dollar amount: `"{N} print{s} above floor"`
- Sub-label under percentage: `"All lit exchange"` when 0%, `"{X}% off-exchange"` otherwise
- Sub-label under multiple: `"the {fmtMoney(focusFloor)} floor"` — floor value from `profile.notional_floor`

### Key-value rows — inline context

| Metric | Current | New |
|---|---|---|
| Focus trade count | `1` | `1 print above the $500K institutional floor` |
| Block directional pressure | `-99.9%` | `-99.9% (1 focus print, signed sell)` |
| B-score (focus share) | `0.00σ` | `0.00σ — focus share is normal vs 20-session history` |

The parenthetical for directional pressure is dynamic:
- `({N} focus print{s}, signed {sell/buy/mixed})` based on `focus_trade_count` and sign of pressure

### Narrative sentence (new element, below hero, above venue split)

Dynamic template:
```
"{N} institutional-size print{s} ({totalFocusNotional}, {multiple}× the {floor} floor)
executed {venueDesc}. {dirDesc}. {watchLine}"
```

Where:
- `venueDesc`: `"entirely on lit exchanges"` if trf_share < 0.05, `"entirely off-exchange (dark pool / TRF)"` if trf_share > 0.95, `"{X}% off-exchange, {Y}% lit"` otherwise
- `dirDesc`: if `|pressure| >= 0.6` → `"The prints were {X}% net {buy/sell}-directed"` ; else → `"Buy/sell split is too even to confirm direction ({pressure}%)"`
- `watchLine`:
  - 0 focus prints: `"No institutional-size prints yet — monitor for block activity."`
  - 1 focus print: `"With only 1 focus trade, the directional read is preliminary — watch for a second block print to confirm."`
  - 2 focus prints: `"Two block prints detected — directional signal is building."`
  - ≥ 3: `"Block activity confirmed across {N} prints."`

---

## What is NOT changing
- A lane (Universe Percentile) — unchanged
- BLUF narrative text fields (What happened / Why it matters / What to check / Limitations) — unchanged
- Actions panel — unchanged
- Raw Prints panel — unchanged
- Explain Tier panel — unchanged
- Lane states panel — unchanged
- All backend code — this is purely a frontend change

---

## CSS variables assumed present
```css
--good: /* green */
--warn: /* amber */
--bad:  /* red */
--text-2: /* secondary text color */
--border-strong: /* strong border */
--accent: /* brand accent */
```
Verify these exist in `styles.css` before implementing. If any are missing, add them.
