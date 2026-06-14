# UTA Dashboard — BLUF, Market Flow Trend & Block Panel UX Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Raise visual hierarchy and actionability of three panels: (1) BLUF — verdict-first layout with key stats row and promoted recommendation; (2) Market Flow Trend — replace synthetic sparkline with honest pressure bar + interpretation sentence; (3) Block/Off-Exchange — add conditional "What to watch" bullets and a verification checklist.

**Approach:** Option B — targeted panel rewrites within existing panel boundaries. All changes in `src/uta/src/evidence.tsx` and `src/uta/src/styles.css`. No backend changes.

**Files touched:**
- `src/uta/src/evidence.tsx` — `BlufCard`, `BlufFindings`, `MarketFlowTrendBody`, `BlockOffExchangeBody`
- `src/uta/src/styles.css` — new classes: `.bluf-tier-band`, `.bluf-stats-row`, `.bluf-stat-tile`, `.pres-bar`, `.pres-bar-fill`, `.pres-interp`, `.block-watch`, `.block-checklist`

---

## 1. BLUF Panel — Verdict-First Layout

### Reading order (A → B → C)
The panel must answer three questions in order, top to bottom:
- **A — Verdict**: What tier? What direction? Should I look further?
- **B — Key numbers**: How strong is this signal?
- **C — Action**: What do I do right now?

### 1a. Colored tier band on `.bluf-head`

Add a left border (4px) and subtle background tint to `.bluf-head` based on tier:

| Tier | Border color | Background |
|---|---|---|
| A | `var(--buy)` | `var(--buy-soft)` |
| B | `var(--warn)` | `var(--warn-bg)` |
| C / D | `var(--ink-3)` | none |

**Implementation:** `BlufCard` computes `tierColor` and `tierBg` from `data.tier` and passes them as inline styles on `.bluf-head`. No new CSS class needed — inline style is sufficient since it's a single dynamic value.

### 1b. Key stats row (new element)

Insert a `.bluf-stats-row` div directly after `.bluf-head` and before `<IndicatorGrid>`. Contains three `.bluf-stat-tile` elements:

```
SIGNED PRESSURE    VOLUME (σ)    FOCUS PRINTS
   −99.9%           +0.05σ          1 print
```

**Data sources:**
- Signed pressure: `ta?.pressure?.net_signed_pressure ?? C.net_notional_pressure` × 100, formatted as `+X.X%` or `−X.X%`
- Volume σ: `bestB = Math.max(Number(B.notional_zscore ?? 0), Number(B.volume_zscore ?? 0))` — same as IndicatorGrid; shows the more elevated of the two
- Focus prints: `bf?.focus_trade_count ?? C.focus_trade_count ?? 0`

**Color rules per tile:**
- Signed pressure: `var(--buy)` if positive, `var(--sell)` if negative, `var(--ink-3)` if `|pressure| < 0.1`
- Volume σ: `var(--buy)` if ≥ 1.5, `var(--warn)` if 0.5–1.49, `var(--ink-3)` if < 0.5
- Focus prints: `var(--buy)` if ≥ 3, `var(--warn)` if 1–2, `var(--ink-3)` if 0

**CSS:**
```css
.bluf-stats-row {
  display: flex;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
}
.bluf-stat-tile {
  display: flex;
  flex-direction: column;
  min-width: 100px;
}
.bluf-stat-tile .st-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-3);
  margin-bottom: 2px;
}
.bluf-stat-tile .st-value {
  font-size: 22px;
  font-weight: 700;
  font-family: var(--font-mono);
  line-height: 1;
}
.bluf-stat-tile .st-detail {
  font-size: 11px;
  color: var(--ink-3);
  margin-top: 3px;
}
```

### 1c. Recommendation promoted above findings

In `BlufFindings`, move the `bf-rec` block from **below** the findings list to **above** it. New order inside `.bluf-findings`:

1. `bf-findings-label` ("Key findings")
2. `bf-rec` (recommendation — if present) ← moved up
3. `bf-findings-list` (the 5 findings rows)

No CSS changes needed — just reorder the JSX.

---

## 2. Market Flow Trend — Pressure Bar + Interpretation

### 2a. Replace synthetic sparkline with a pressure bar

Remove the `<Sparkline>` and `ev-trend-label` elements. Replace with a `.pres-bar` container:

```
SELL ◄───────────────|──────────────► BUY
     −100%     −99.9%▲            0       +100%
```

**Structure:**
```html
<div class="pres-bar">
  <div class="pres-bar-track">
    <div class="pres-bar-fill" style="width: X%; background: var(--sell/buy); margin-left/right: ..."></div>
    <div class="pres-bar-marker"></div>
  </div>
  <div class="pres-bar-labels">
    <span>Sell −100%</span>
    <span>0</span>
    <span>Buy +100%</span>
  </div>
</div>
```

**Fill logic:**
- The track represents −100% to +100% (200% range)
- Center of track = 0
- Fill starts at center and extends left (sell, `var(--sell)`) or right (buy, `var(--buy)`)
- Fill width = `Math.abs(netPressure) * 50`% of track width (since full fill = 50% of track = 100% pressure)
- A small dot marker sits at the exact pressure position

**CSS:**
```css
.pres-bar { margin: 12px 0; }
.pres-bar-track {
  position: relative;
  height: 10px;
  background: var(--panel-3);
  border-radius: 5px;
  overflow: hidden;
}
.pres-bar-fill {
  position: absolute;
  top: 0;
  height: 100%;
  border-radius: 5px;
}
.pres-bar-labels {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--ink-3);
  margin-top: 4px;
}
```

### 2b. Interpretation sentence

Below the bar, add a `.pres-interp` paragraph with a plain-English reading:

| Condition | Text |
|---|---|
| `pressure ≤ −0.6` | `"Strong sell-side edge — {N} of every 10 labeled dollars flowed to sellers this session."` |
| `pressure ≥ +0.6` | `"Strong buy-side edge — {N} of every 10 labeled dollars flowed to buyers this session."` |
| `−0.6 < pressure < −0.1` | `"Flow is tilted sell-side but below the 60% confirmation threshold."` |
| `0.1 < pressure < 0.6` | `"Flow is tilted buy-side but below the 60% confirmation threshold."` |
| `|pressure| ≤ 0.1` | `"Buy and sell flow are roughly balanced — no directional edge in the flow composition."` |

Where `N = Math.round(Math.abs(pressure) * 10)` (e.g., −0.999 → "10 of every 10").

**CSS:**
```css
.pres-interp {
  font-size: 12.5px;
  color: var(--ink-2);
  line-height: 1.45;
  margin: 8px 0 10px;
}
```

### 2c. Richer metric tiles

Keep the 3-tile row but update content and labels:

| Tile | Label | Value | Detail |
|---|---|---|---|
| 1 | Net pressure | `−99.9%` | "net of labeled trades" |
| 2 | B-score | `−0.16σ` | "vs own 20-session history" (colored: `--sell` if ≤ −1.5, `--buy` if ≥ +1.5, `--warn` if ±0.5–1.5, `--ink-3` if within ±0.5) |
| 3 | Prints analyzed | `47` | "since market open" |

Remove the "ev-trend-label" (`Fading`/`Building`/`Flat`) large label — the interpretation sentence and the pressure bar make it redundant.

---

## 3. Block Panel — "What to Watch" Section

### 3a. Conditional "What to watch" bullets

Add a `.block-watch` section below the `.ev-kv-list`, generated by a `buildWatchPoints(focusCount, pressure, direction, floorLabel, diverging)` helper.

**`diverging` computation** (add to `BlockOffExchangeBody` before calling the helper):
```ts
const priceChg = ta?.activity?.price_change_pct;
const priceSide = priceChg != null ? (priceChg > 1 ? "bullish" : priceChg < -1 ? "bearish" : "flat") : null;
const diverging = priceSide != null && priceSide !== "flat" && priceSide !== data.direction && data.direction !== "undetermined";
```

**Logic:**

```
focusCount === 0:
  • "Monitor for the first block print above the {floorLabel} floor — a single institutional-size trade would shift this to an early signal."

focusCount === 1:
  • "Watch for a second block print to confirm direction. One print can be noise — two in the same direction is a pattern."
  • (if diverging): "Price is moving against the block flow — watch for price to stall or reverse before acting on this signal."

focusCount === 2:
  • "Block signal is building. Confirm direction aligns with options flow or a provider alert before sizing up."
  • (if |pressure| >= 0.6): "Directional read is {direction} with {fmtNumber(|pressure|*100,1)}% signed pressure — wait for price to confirm."

focusCount >= 3:
  • "Block activity confirmed across {focusCount} prints. Direction is {direction}."
  • (if |pressure| >= 0.6): "Signed pressure at {fmtNumber(|pressure|*100,1)}% confirms the {direction} edge — check corroboration before acting."
```

**CSS:**
```css
.block-watch {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.block-watch-title {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-3);
  margin-bottom: 6px;
}
.block-watch ul {
  margin: 0;
  padding-left: 16px;
}
.block-watch li {
  font-size: 12.5px;
  color: var(--ink-2);
  line-height: 1.5;
  margin-bottom: 4px;
}
```

### 3b. Verification checklist

Below the bullets, a `.block-checklist` section with 3 read-only items (no interactive checkboxes):

```
Checklist before acting:
□ Block direction aligns with signed flow pressure?
□ Price has confirmed the direction (within 1–2 sessions)?
□ At least one corroboration signal confirmed (provider alert, options flow, or price action)?
```

**Implementation:** Plain `<ul>` with `□` as the list marker character. Not interactive — this is a reminder protocol, not state management.

**CSS:**
```css
.block-checklist {
  margin-top: 10px;
  padding: 8px 10px;
  background: var(--panel-3);
  border-left: 3px solid var(--border-strong);
  border-radius: var(--radius-sm);
}
.block-checklist .bc-title {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-3);
  margin-bottom: 6px;
}
.block-checklist ul {
  margin: 0;
  padding-left: 0;
  list-style: none;
}
.block-checklist li {
  font-size: 12px;
  color: var(--ink-2);
  line-height: 1.5;
  margin-bottom: 3px;
}
.block-checklist li::before {
  content: "□ ";
  color: var(--ink-3);
}
```

---

## What is NOT changing
- `CorroborationPanel` — already redesigned in the previous round
- `BlufFindings` finding rows themselves — content and color unchanged; only the recommendation block moves up
- `IndicatorGrid` (B+C merged) — unchanged
- `BlockOffExchangeBody` hero metrics and narrative — already redesigned; only the "What to watch" section is new
- All backend code — frontend only
- All other evidence cards (Volume Anomaly, Directional Pressure, Pre-Market, Confirmed Alerts, Data Health)

---

## CSS variables assumed present
All CSS variables used here are already confirmed in `styles.css`:
- `--buy`, `--sell`, `--warn` (signal colors)
- `--buy-soft`, `--warn-bg`, `--sell-soft` (tinted backgrounds)
- `--ink-2`, `--ink-3` (secondary text)
- `--panel-3` (subtle panel background)
- `--border`, `--border-strong` (borders)
- `--font-mono` (monospace font)
- `--radius-sm` (border radius)
