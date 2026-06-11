# UTA Frontend Recovery — Design Spec
**Date:** 2026-06-11  
**Status:** Approved for implementation planning  
**Author:** Brainstorming session — Meiri + Claude  
**Supersedes:** `docs/uta-ux-parity.md` (structural parity contract — this spec extends and replaces it)

---

## 1. Executive Summary

The UTA backend signal engine is correct and well-implemented. The frontend has drifted from the approved product design in ten distinct areas. This spec defines the full recovery, covering module architecture, shell chrome, detail view redesign (including Trade Analysis as a co-equal tab), visual component library, and all four mode surfaces.

The recovery is structured as a **module-split-first** approach: `src/uta/src/main.tsx` (1,874 lines) is decomposed into nine focused modules matching the `ux design/` file map before any surface is recovered. Each subsequent phase adds to the correct module rather than growing a monolith.

### Core design principles preserved throughout

- **A/B/C indicators are never collapsed into a single score.** They are always shown separately.
- **Direction is derived from signed order flow only.** Price is corroboration, never the direction source.
- **Tier is rule-based and auditable.** "Explain this tier" always traces to explicit gates.
- **Trade Analysis is co-equal with UTA evidence**, not subordinate or superior. It is a separate lens on the same ticker, presented in a tabbed detail view.
- **Incomplete data never produces a fabricated tier.** Tier D is a feature, not an error state.

---

## 2. What Is Being Recovered

| Area | Problem | Recovery |
|---|---|---|
| Module architecture | 1,874-line monolith | Split into 9 focused modules |
| Landing screen | Missing — app starts in Single mode | Restore HomeMode entry point |
| Market-Regime banner | Missing entirely | Add persistent shell banner |
| Top bar chrome | Title only — no search, watchlist, theme toggle, sync | Full TopBar per spec |
| Runtime tab | In primary nav alongside user modes | Relocated to operator overlay |
| Detail view layout | Trade Analysis panel leads the view with foreign workflow terminology | Tabbed layout: Evidence ↔ Trade Analysis, co-equal, BLUF always above |
| Evidence card bodies | `<p>{card.summary}</p>` — one text paragraph | 5 visual primitives + rich card bodies |
| Scan mode | Free-text input + 2 plain columns | Universe selector + funnel + 3 result views |
| Portfolio mode | Plain HTML table, no stat cards | Stat cards + visual table with DeltaChip |
| Alerts mode | History log + minimal rule editor | Typed event feed + filter chips + rule sliders |
| Theme/density | Dark only, hard-coded | CSS token system, dark/light toggle, 2 densities |
| Watchlist drawer | Count pill only | Full slide-in drawer |

---

## 3. Module Architecture

### 3.1 Target file map

`src/uta/src/main.tsx` becomes an entry point of ~5 lines that imports and mounts `App` from `app.tsx`. All logic moves into nine focused modules:

| File | Est. lines | Responsibility |
|---|---|---|
| `types.ts` | ~120 | All TypeScript types (UtaTickerResult, ScanRow, LaneState, etc.) |
| `utils.ts` | ~80 | Pure helpers: fmtMoney, fmtPct, fmtDate, tierRank, ruleMatches, setupTone, setupLabel |
| `components.tsx` | ~300 | Visual primitives: TierBadge, DirTag, BandTag, Pill, Sparkline, VolBars, PressureGauge, ConfBar, MixBar, DeltaChip, MetricTile, SectionHeader |
| `evidence.tsx` | ~350 | BlufCard, IndicatorGrid, EvidenceCards (9 cards), CorroborationPanel, ActionsPanel, LaneHealth, DataProvenance |
| `trade-analysis.tsx` | ~250 | TradeAnalysisPanel (recovered terminology, co-equal positioning) |
| `detail-extras.tsx` | ~200 | RawPrintsDrawer, ExplainTierModal, CompareBanner, CycleHistory |
| `modes.tsx` | ~300 | TickerDetail (tabbed layout), SingleMode, PortfolioMode |
| `scan.tsx` | ~350 | ScanMode, UniverseSelector, ScanFunnel, ScanResults (3 views) |
| `alerts.tsx` | ~300 | AlertsMode, ActivityFeed, RulesDrawer, RuleEditor |
| `app.tsx` | ~250 | App shell, TopBar, RegimeBanner, HomeMode (Landing), routing, WatchlistDrawer, RevalidationBar |

### 3.2 CSS file map

Mirrors the module split:

| File | Responsibility |
|---|---|
| `styles.css` | Design tokens: `--bg`, `--panel`, `--ink`, `--accent`, `--buy`, `--sell`, all spacing, type scale. Theme via `[data-theme="light"]`. Density via `[data-density="compact|comfy"]`. |
| `components.css` | Primitive component styles: `.tier-badge`, `.dir-tag`, `.band-tag`, `.pill`, `.ev-card`, `.ind-chip`, visual chart containers |
| `app.css` | Shell layout: `.uta-shell`, `.uta-topbar`, `.mode-tabs`, `.regime-banner`, `.watchlist-drawer`, `.revalidation-bar` |
| `modes.css` | Detail view layout: `.detail-layout`, `.detail-main`, `.detail-side`, `.detail-tabs`, `.ticker-head`, portfolio table |
| `scan.css` | Scan funnel, results views, refinement bar |
| `alerts.css` | Feed rows, filter chips, rules drawer |

### 3.3 Import order and cross-module dependencies

```
types.ts          ← no imports
utils.ts          ← types.ts
components.tsx    ← types.ts, utils.ts
evidence.tsx      ← types.ts, utils.ts, components.tsx
trade-analysis.tsx ← types.ts, utils.ts, components.tsx
detail-extras.tsx ← types.ts, utils.ts, components.tsx
modes.tsx         ← all above
scan.tsx          ← types.ts, utils.ts, components.tsx
alerts.tsx        ← types.ts, utils.ts, components.tsx
app.tsx           ← all above
main.tsx          ← app.tsx only
```

No circular dependencies. Each module imports only what it needs.

---

## 4. Shell Recovery (app.tsx)

### 4.1 Landing screen — HomeMode

The app initialises with `mode = "home"`. HomeMode is the entry point.

**Anatomy:**
1. **Hero block** — eyebrow ("Choose how you want to look at the market"), headline, one-paragraph thesis: three independent indicators, rule-based tier, honest data lanes, never a collapsed score.
2. **Three mode cards** — Single Ticker · Portfolio · Scan/Discovery. Each card shows: icon, mode name, one-line description, and the tier rules that apply ("B + C only — no peer group" / "A + B + C — ranked vs your portfolio" / "A + B + C — two-pass discovery"). Whole card is the click target → sets mode.
3. **Activity-feed banner** — wide entry into Alerts mode; surfaces live counts (needs-attention, rule matches, tier changes) from `feedCounts()`.
4. **Footer stats strip** — last cycle timestamp, active universe ticker count, current market regime badge.

**Build note:** The mode cards' tier-rules line is load-bearing product copy. It sets the user's expectation that Single Ticker has no A indicator before they ever see one. Keep it in every iteration.

### 4.2 TopBar

Persistent across all modes.

| Element | Behaviour |
|---|---|
| **Brand / home button** | Returns to Landing (`mode = "home"`) |
| **Mode tabs** | Single · Portfolio · Scan · Alerts. Alerts tab carries a count badge (`alertCount` = needs-attention count). Switching mode clears `openSym`. |
| **Global ticker search** | Text input, autocomplete from tracked universe. Submitting a known symbol routes to Single Ticker mode with that symbol pre-loaded. |
| **Watchlist pill** | Opens WatchlistDrawer; shows saved count. |
| **Theme toggle** | Dark ⇄ Light. Writes `data-theme` on `<html>`. Persisted in localStorage. |
| **Density control** | Small icon button opens a popover containing a three-option segmented control: Compact / Regular / Comfy. Writes `data-density` on `<html>`. Persisted in localStorage. Not a full tweaks panel. |
| **⚙ Operator** | Icon button. Opens RuntimeOverlay (full-page overlay). Removed from primary mode tabs. |
| **Sync indicator** | "Live · synced HH:MM ET" at rest. "Revalidating lanes…" spinner pill during any revalidation pass. |

### 4.3 Market-Regime banner — RegimeBanner

Rendered below the TopBar on every mode except Landing.

**Contents:**
- **Regime badge** — colour-keyed: Risk-On (green) / Neutral (grey) / Risk-Off (amber) / Crisis (red)
- **VIX** value
- **Yield-curve spread** (T10Y2Y)
- **Fed Funds Rate**
- **Interpretation line** — plain English, e.g. "Risk-off: treat bullish signals cautiously. Large off-exchange prints may reflect liquidation."

**Rules:**
- Reads from the FRED macro lane already computed by the backend.
- Never changes a tier. Framing only.
- Crisis regime (VIX > 35): banner colour shifts to red, interpretation line prominently warns "All signals are context-only in crisis regime."

### 4.4 Runtime relocation

The "Runtime" tab is removed from `mode-tabs`. A small ⚙ icon button in the TopBar opens `RuntimeOverlay` — a full-page overlay containing all current RuntimeMode content (provider readiness, scheduler, SSE events, cycle history). Keyboard shortcut: `Escape` closes it. No change to RuntimeMode's internal functionality.

### 4.5 WatchlistDrawer

Slide-in from the right edge, triggered by the TopBar watchlist pill.

- Header: "Watchlist · N saved"
- Each row: symbol (mono) + company name + TierBadge + DirectionTag + × remove
- Click row → navigates to Single Ticker for that symbol, closes drawer
- Empty state: "No tickers saved yet. Use 'Add to watchlist' in any ticker detail view."
- Persisted via `/api/uta/user-state/watchlist`

### 4.6 RevalidationBar

A thin progress bar pinned to the top of the viewport (above the TopBar). Triggered by any `uta:revalidate` SSE event or manual refresh action. Accompanied by "Revalidating lanes…" pill in the sync indicator slot. Auto-dismisses on completion, stamping a fresh sync time.

---

## 5. Detail View — Tabbed Layout (modes.tsx + detail-extras.tsx)

### 5.1 Layout anatomy

```
┌──────────────────────────────────────────────┐  ┌────────────────────┐
│  Breadcrumb + ticker head                     │  │                    │
│  (symbol, name, exchange/sector pills,        │  │  CorroborationPanel│
│   review chip, tier badge, direction tag)     │  │  (always visible)  │
├──────────────────────────────────────────────┤  ├────────────────────┤
│  BLUF card  ← always visible                  │  │  ActionsPanel      │
│  IndicatorGrid (A/B/C)  ← always visible      │  │  (always visible)  │
├──────────────────────────────────────────────┤  ├────────────────────┤
│  [ Evidence ]  [ Trade Analysis ]             │  │  LaneHealth        │
│   ── tab bar ─────────────────────────────   │  │  (always visible)  │
│   context chip from inactive tab             │  │                    │
├──────────────────────────────────────────────┤  └────────────────────┘
│  Tab content (full width of main column)      │
└──────────────────────────────────────────────┘
```

**Always visible (above tabs):**
- Breadcrumb with origin-mode crumb
- Ticker head: symbol (mono, large), company name, exchange/sector/cap pills, review chip, TierBadge (lg), DirectionTag, signing confidence pill
- BLUF card (four rows: What happened / Why it matters / What to check / Limitations)
- IndicatorGrid (A/B/C chips; A = N/A in single-ticker mode)

**Right sidebar (always visible):**
- CorroborationPanel (6 flags, strong/moderate/contextual)
- ActionsPanel (Revalidate, Raw Prints, Explain Tier, Compare, Watchlist, Refresh lane)
- LaneHealth

### 5.2 Tab bar

Two tabs: **Evidence** and **Trade Analysis**.

Each tab header shows a context chip from the inactive tab:
- Evidence tab shows: `Trade: Bullish · Review candidate` (trade bias + setup status)
- Trade Analysis tab shows: `Tier B · 2.1σ vol` (UTA tier + peak B-score)

Active tab indicator: accent-coloured bottom border. Tab switch is in-page state — no navigation.

### 5.3 Evidence tab content

1. **CycleHistory** — last 12 cycles (5-min cadence):
   - Signed-pressure bars: bars above zero line = bullish, below = bearish; height proportional to B-score
   - Tier ribbon: A/B/C/D cell per cycle, colour-keyed
   - Time axis below ribbon
   - Event chips on the time axis at cycles where a tier change occurred (e.g. "B→A") or a confirmed provider alert was received (e.g. "TradeVision ↑")
2. **EvidenceGrid** — 9 evidence cards. Cards 1–3 open by default, 4–9 collapsed.

### 5.4 Evidence cards — 9 canonical cards

| # | Card | Default | Headline metric | Body contents |
|---|---|---|---|---|
| 1 | Volume Anomaly | Open | Notional ratio × | **VolBars** (today vs 20-day baseline per time bucket), volume/notional/trade-count ratios, B-score pill, band tag |
| 2 | Block / Off-Exchange | Open | Focus print count | Focus notional / share / largest, venue split (off-exch vs lit), **MixBar** for venue breakdown, block pressure, B-score |
| 3 | Directional Pressure | Open | Net pressure % | **PressureGauge** (−1→+1), net notional + volume pressure values, **ConfBar** (signing confidence), **MixBar** (quote-rule / tick-test / midpoint-excluded / unknown) |
| 4 | Pre-Market Activity | Collapsed | Pre-mkt vol ratio | Volume ratio, pressure, gap %, decay state indicator (60-min half-life label), B-score. Empty state when no pre-market prints. |
| 5 | Market Flow Trend | Collapsed | Building / Fading | **Sparkline** (pressure over session, zero baseline), pressure delta, participation, trend direction label |
| 6 | Confirmed Alerts | Collapsed | Provider count | Each alert: provider · type · direction tag · notional · timestamp. Elevation-eligible label when aligned. |
| 7 | Options Flow | Collapsed | C/P ratio × | Net premium, sweeps, call/put split, alignment verdict. Optional lane — disabled state shown when absent. |
| 8 | Macro Context | Collapsed | Regime band | VIX / yield curve / Fed Funds, **Sparkline** (VIX 8-session history), regime interpretation |
| 9 | Data Health | Collapsed | Ready / N lanes | Lane rows (state, coverage, tier effect), prints analyzed, excluded count, policy version, refresh-lane button |

### 5.5 Visual component library (components.tsx)

Five new primitives required by the evidence cards:

**Sparkline**
- Pure SVG, ~60px height, fluid width
- Input: `values: number[]`, `baseline?: number` (default 0), `colour?: string`
- Renders a polyline with a dashed zero baseline
- Used in: Market Flow Trend (pressure over session), Macro Context (VIX history)
- No external charting dependency — hand-rolled SVG

**VolBars**
- Input: `todayBuckets: Record<string, number>`, `baselineBuckets: Record<string, number>`
- 6 time buckets (open / morning / midday / afternoon / power_hour / close)
- Each bucket = two adjacent bars: today (accent) vs baseline (muted)
- Height proportional to ratio; today bar exceeding baseline gets a buy/sell colour tint based on direction
- Labels on x-axis: "Open" / "AM" / "Mid" / "PM" / "PH" / "Close"

**PressureGauge**
- Input: `value: number` (−1 to +1)
- Horizontal bar, centre origin, fills left (sell, red) or right (buy, green)
- Numeric label at the fill end: "+72%"
- Width: 100% of container

**ConfBar**
- Input: `value: number` (0 to 1)
- Single horizontal bar 0–100%, accent colour, labelled with percentage
- Used for signing confidence

**MixBar**
- Input: `segments: Array<{ label: string; value: number; colour: string }>`
- Stacked horizontal bar, each segment proportional to value
- Used for: signing-method mix (quote-rule / tick-test / midpoint-excluded / unknown), venue split (off-exchange / lit)
- Segments labelled below bar on hover / always on wider containers

**DeltaChip** (already partially in codebase — extend)
- Input: `delta: number`, `unit?: string` (default "σ")
- Shows `↑ +0.4σ` in green or `↓ −0.8σ` in red
- Neutral/zero state: `→ 0.0σ` in muted colour

### 5.6 Trade Analysis tab content (trade-analysis.tsx)

**Terminology policy for this tab:**
The Trade Analysis panel uses the trade setup agent's vocabulary. The only change is rendering: underscore-separated `snake_case` values are displayed as human-readable labels. No backend field names are changed.

| Backend value | Displayed as |
|---|---|
| `review_candidate` | Review candidate |
| `watch_only` | Watch only |
| `no_directional_setup` | No directional setup |
| `blocked` | Blocked |

**Panel anatomy (top to bottom):**
1. **Verdict row** — bias pill (Bullish / Bearish / Neutral) + setup-status pill + anomaly band tag
2. **Trigger strip** — three cells: Primary trigger · Next required evidence · Trade workflow effect
3. **Metric grid** — Signed pressure / Confidence / Volume+Notional ratios / Focus prints (existing MetricTile layout, unchanged)
4. **Interpretation** — `analysis.pressure.interpretation` text
5. **Trigger criteria list** — pass/fail checklist (existing, unchanged)

**What does NOT change:** No backend fields are renamed. The `trade_analysis` object shape on `UtaTickerResult` stays identical.

### 5.7 Overlays from detail view

**RawPrintsDrawer** — unchanged from current implementation. Slide-in from right, opened from Actions. Footnotes condition-code policy version.

**ExplainTierModal** — unchanged. Shows rule pass/fail, gap-to-next-tier, elevation eligibility.

**CompareBanner** — unchanged. Injects delta banner above BLUF when "Compare to prior cycle" is toggled.

---

## 6. Scan Mode (scan.tsx)

### 6.1 Idle / controls state

**Universe selector** — grouped `<select>` with four option groups:

| Group | Options | Each shows |
|---|---|---|
| US Indices | DOW · NASDAQ-100 · S&P 500 · S&P 400 · S&P 600 · Russell 1000/2000/3000 | Count + tier chip |
| US Sectors | GICS sectors scoped to selected index | Count + tier chip |
| US Exchanges | NYSE American · NYSE Arca · NYSE Listed · NASDAQ Listed | Count + tier chip |
| Custom | My Portfolio · My Watchlist · Custom list (free-text) | Always 🟢 Fast |

Performance tier chip (🟢 Fast / 🟡 Standard / 🔴 Extended) shown prominently next to the selector with estimated runtime. This is the Pi 5 overload guard — users see the cost before running.

**Direction filter** — segmented control: Bullish / Bearish / Both.

**Saved scans** — list of saved universe+direction combos below the controls. Persisted in user-state API. "Save this scan" action available after results.

**Run CTA** — disabled until a universe is selected.

### 6.2 Running state — the funnel

Replaces the Pass 1 / Pass 2 button pair during execution:

```
[ Screened 503 ✓ ] → [ Flagged 28 ● ] → [ Resolved 12 / 28 ]
```

- Screened: all constituents processed via daily bars (Pass 1). Turns green on completion.
- Flagged: shortlist that cleared the pre-screen. Accent-coloured while active.
- Resolved: Pass 2 live-print analysis complete count / shortlist total. Updates as each row resolves.

Progress bar below funnel: "Pass 2 · Resolving live prints · 43%"

Resolving table shows rows in highest-notional-first order. Each row states:
- **Queued**: `~ B est` preliminary tier
- **Active**: "Resolving…" pulse animation
- **Done**: `✓ Resolved` + full tier badge + direction tag

Rows are not clickable until resolved.

### 6.3 Results — three views

Refinement bar appears above results once all rows resolve:
- **Tier filter chips**: All · A · B · C (each with count)
- **View switcher**: Cards · Table · Grouped (preference persisted in localStorage)
- **Bulk actions**: Watch all shown · Save scan

**Cards view (default)**
Each card: symbol (mono, large) · TierBadge (lg) · DirectionTag + anomaly band · trade setup status chip ("Review candidate" / "Watch only" / "No setup") · B/A/C stat chips · signed-pressure bar · watchlist star

**Table view**
Dense, sortable. Columns: Ticker · Tier · Direction · B (σ) · A (pct) · C (×) · Setup · Δ cycle

**Grouped view**
Sections: Tier A / Tier B / Tier C. Each section has a tier-meaning line ("Actionable supporting evidence" / "Review closely" / "Context only") then the matching rows.

---

## 7. Portfolio Mode (modes.tsx)

### 7.1 Stat cards row

Four MetricTile cards above the table:

| Card | Value | Style |
|---|---|---|
| Holdings | Total ticker count | Neutral |
| Tier A | Count of Tier A tickers | Accent (green tint) |
| Tier changes | Count changed since last cycle | Amber if > 0, neutral if 0 |
| Cycle time | Last cycle timestamp | Neutral |

### 7.2 Holdings table

Sortable by any column. Click header to sort; click again to reverse.

**Columns:** Ticker · Tier · Direction · B (σ vol) · A (pct vs portfolio) · C (notional ×) · Setup · Δ cycle

**Visual differentiation rules:**
- Tier-changed rows: 2px accent-coloured left border
- Tier A rows: faint accent background tint
- Ignored rows: 40% opacity, struck-through name
- Reviewed rows: small `✓` chip on Ticker cell
- Tier D rows: `—` dashes across all metric columns, never fabricated values

**Setup column:** "Review candidate" / "Watch only" / "No setup" / `—` for Tier D. This is the cascade from the co-equal Trade Analysis decision — allows triage without opening each detail view.

**Δ cycle column:** DeltaChip showing B-score change from prior cycle (`↑ +0.4σ` / `↓ −0.8σ`).

**Row click:** Opens shared detail view with portfolio rules (A+B+C applied). Breadcrumb first crumb returns to portfolio table.

**Refresh cycle button:** Triggers a full portfolio revalidation pass.

---

## 8. Alerts Mode (alerts.tsx)

### 8.1 Stat cards row

Four cards: **Needs attention** (accent — Tier A or rule-matched tickers) · **Rule matches** · **Confirmed alerts** · **Tier changes**

### 8.2 Activity feed

Typed event stream, newest first. Each row:
- **Timestamp**
- **Colour-keyed icon** by event kind
- **Symbol** (mono)
- **Title** (one-line description)
- **TierBadge + DirectionTag** where applicable

| Kind | Icon colour | Example title |
|---|---|---|
| `alert` | Accent | TradeVision confirmed — Bullish |
| `tierup` | Green | Upgraded C → B |
| `tierdown` | Amber | Downgraded B → C |
| `news` | Blue | Earnings catalyst detected |
| `lane` | Red | Live trade slices — unavailable |
| `rule` | Purple | Rule matched: "Tier B bullish" |

**Filter chips** above feed: All · My rules · Confirmed alerts · Tier changes · News · Data lanes — each with live count badge.

**Empty state per filter:** "No tier changes this cycle" / "No confirmed alerts" / "Create a rule" CTA on the rules filter empty state.

### 8.3 Alert-rules drawer

Opened from a Rules button (badge shows active rule count). Slide-in from right.

**Rules list:** Each rule as a card showing: on/off toggle · name · live match count · condition chips · matching symbol pills.

**Rule editor fields:**

| Field | Control | Notes |
|---|---|---|
| Name | Text input | Free text |
| Scope | Segmented control | All tickers · Portfolio · Watchlist |
| Direction | Segmented control | Bullish · Bearish · Any |
| Min tier | Selector | A · B · C |
| Min B-score | Slider 0–4σ | Labelled "Min B-score (σ)" |
| Min universe rank | Slider 0–100th pct | Labelled "Min A rank (percentile)" |
| Min C ratio | Slider 1×–10× | Labelled "Min notional ratio (×)" |
| Provider alert required | Toggle | Confirmed provider alert must be present to match |

**Live match preview** — "Matches **N** tickers right now" shown below the controls. Re-evaluated on every control change (debounced 300ms). Tickers listed by name under the count. This is the essential UX: users tune rules against real current data, not guesses.

---

## 9. Theme and Density System (styles.css)

### 9.1 CSS custom properties

All colours, spacing, and typography are CSS custom properties on `:root`. No component hard-codes a colour value.

**Core colour tokens:**
```css
:root {
  --bg, --panel, --panel-2, --panel-3    /* surface hierarchy */
  --line, --line-strong                  /* borders */
  --ink, --ink-2, --ink-3, --ink-faint   /* text hierarchy */
  --accent, --accent-soft, --accent-line /* brand / primary */
  --buy, --buy-bg                        /* bullish green */
  --sell, --sell-bg                      /* bearish red */
  --warn, --warn-bg                      /* amber / caution */
  --shadow                               /* elevation */
}
```

**Theme switching:**
```css
[data-theme="light"] {
  /* overrides only — all tokens redefined for light palette */
}
```

`data-theme` attribute written to `<html>` by the TopBar theme toggle. Persisted in localStorage key `uta_theme_v1`.

### 9.2 Density

```css
[data-density="compact"] { --space-unit: 0.75rem; --font-base: 12px; }
[data-density="regular"] { --space-unit: 1rem;    --font-base: 14px; }
[data-density="comfy"]   { --space-unit: 1.25rem; --font-base: 15px; }
```

`data-density` attribute written to `<html>` by the TopBar density control. Persisted in localStorage key `uta_density_v1`. Default: `regular`.

### 9.3 What is NOT implemented

- Multi-typeface selector (prototype-only scaffolding — dropped per YAGNI)
- Full tweaks panel (prototype-only — dropped)
- Accent colour picker (not required for production)

---

## 10. Phased Delivery Plan

### Phase 1 — Module split (no visual changes)
Split `main.tsx` into the 9 modules. Extract types, utils, and relocate all existing components to their target files. No functionality changes. All existing tests and API integration must pass after this phase. This phase is a pure refactor.

**Exit criteria:** App runs identically to today. `main.tsx` is ~5 lines.

### Phase 2 — Shell + structural fixes
- Landing screen (HomeMode)
- TopBar recovery (search, watchlist pill, theme toggle, density control, sync indicator, ⚙ operator button)
- Market-Regime banner
- Runtime relocation to overlay
- WatchlistDrawer
- RevalidationBar
- CSS token system (dark/light, 2 densities)

**Exit criteria:** App opens to Landing screen. Market-Regime banner visible on all non-Landing modes. Runtime accessible via ⚙. Theme toggle works.

### Phase 3 — Detail view tabs + visual component library
- Tab layout in TickerDetail (Evidence / Trade Analysis tabs)
- Cross-tab context chips
- Visual component library: Sparkline, VolBars, PressureGauge, ConfBar, MixBar, DeltaChip
- Evidence cards 1–5 wired to visual components
- Trade Analysis tab with display-renamed status labels
- CycleHistory timeline (pressure bars + tier ribbon + time axis + event chips)

**Exit criteria:** Detail view shows two tabs. Evidence cards 1–5 render visual charts. CycleHistory shows bar + ribbon.

### Phase 4 — Scan mode recovery
- UniverseSelector (grouped options, tier chip, estimated runtime)
- Direction filter (Bullish / Bearish / Both)
- ScanFunnel (Screened → Flagged → Resolved, row-resolving animation)
- Three result views (Cards / Table / Grouped)
- Refinement bar (tier filter chips, view switcher, bulk actions)
- Saved scans
- Trade setup status chip on scan cards

**Exit criteria:** Scan opens with universe selector. Funnel visible during run. Results show in 3 switchable views.

### Phase 5 — Portfolio + Alerts recovery
- Portfolio stat cards
- Holdings table with DeltaChip, visual tier differentiation, Setup column
- Alerts stat cards
- Typed event feed with filter chips
- RulesDrawer with B/A/C threshold sliders and live match preview
- Alerts empty states

**Exit criteria:** Portfolio shows stat cards and accent-bordered tier-changed rows. Alerts feed shows typed events with filter chips. Rule editor shows live match count.

---

## 11. Invariants That Must Never Break

These are checked by `invariantWarnings()` in the current implementation. They must remain enforced throughout the recovery:

1. **Single-ticker mode must render A as N/A.** `data.indicators.A === null` when `mode === "single_ticker"`.
2. **Direction source must be `signed_flow`.** `calculation_metadata.direction_source === "signed_flow"` for any non-Tier-D result.
3. **No composite score.** `data` must not contain a `composite_score` field.
4. **Price is corroboration only.** `calculation_metadata.price_is_corroboration_only === true`.
5. **Tier D renders no fabricated values.** All metric columns show `—` for Tier D rows in tables and no tier-coloured content in cards.
6. **Trade Analysis never overrides UTA tier.** The Trade Analysis tab shows trade setup data; it never relabels or replaces the UTA Tier badge.

---

## 12. Out of Scope

The following are explicitly not part of this recovery:

- Backend signal engine changes (uta.js, trade-prints.js, etc.)
- API contract changes (all existing endpoints and response shapes stay as-is)
- Multi-typeface selector
- Full tweaks panel
- Accent colour picker
- Options flow data pipeline (card 7 uses existing optional lane data)
- Backtesting UI
- Mobile layout (< 720px breakpoint)
