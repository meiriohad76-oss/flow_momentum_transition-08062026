# UTA Single Ticker UX Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four UX gaps in the Single Ticker dashboard: merge the redundant B/C indicator lanes, surface flow-vs-price tension in the BLUF headline and findings row, redesign the corroboration panel with color/icons/data text, and add inline labels + narrative to the block/off-exchange panel.

**Architecture:** All changes are purely frontend — no backend modifications. Logic lives in `evidence.tsx` (all panel components) and `components.tsx` (IndicatorGrid). CSS additions go in `styles.css`. Four tasks ship independently; each can be reviewed and reverted on its own.

**Tech Stack:** React + TypeScript (TSX), plain CSS custom properties, no new dependencies.

---

## File Map

| File | What changes |
|---|---|
| `src/uta/src/components.tsx` | `IndicatorGrid` — merge B+C into one chip |
| `src/uta/src/evidence.tsx` | `BlufCard`, `BlufFindings`, `CorroborationPanel`, `BlockOffExchangeBody` |
| `src/uta/src/styles.css` | New CSS classes: `.ind-chip.bc`, `.bf-row.bf-diverge`, `.corr-row` modifiers, `.ev-hero-sub` |

---

## Task 1: Merge B+C Indicator Panel

**Files:**
- Modify: `src/uta/src/components.tsx:365-436` (replace `IndicatorGrid`)
- Modify: `src/uta/src/styles.css` (add `.ind-chip.bc` and `.ind-sigma`)

### Background
`IndicatorGrid` renders 3 equal columns: B (z-score), A (universe), C (raw ratio). B and C both show "0.96× normal dollar flow" — they look identical because they measure the same underlying data with different lenses. The fix: merge B and C into one wider chip that shows both numbers together. Grid goes from 3-column to 2-column (merged chip spans 2, A stays at 1).

- [ ] **Step 1: Replace IndicatorGrid in `components.tsx`**

Replace the entire `IndicatorGrid` function (lines 365–436) with:

```tsx
export function IndicatorGrid({ data, portfolioMode = false }: { data: UtaTickerResult; portfolioMode?: boolean }) {
  // Tier D has no indicators — suppress the grid entirely
  if (String(data.tier || "D").toUpperCase() === "D") return null;

  const a = data.indicators.A;
  const aliases = data.trade_analysis?.indicator_aliases;
  const B = aliases?.B || {
    volume: data.indicators.B.volume_zscore,
    notional: data.indicators.B.notional_zscore,
    focus: data.indicators.B.focus_notional_share_zscore,
    pressure: data.indicators.B.net_notional_pressure_zscore
  };
  const C = aliases?.C || {
    vr: data.indicators.C.volume_ratio,
    nr: data.indicators.C.notional_ratio,
    fshare: data.indicators.C.focus_notional_share,
    fcount: data.indicators.C.focus_trade_count,
    nnp: data.indicators.C.net_notional_pressure
  };

  const dir = data.direction;
  const isUndetermined = dir !== "bullish" && dir !== "bearish";

  // Best B-score drives the panel color
  const bN = Number(B.notional ?? 0);
  const bV = Number(B.volume ?? 0);
  const bestB = Math.max(bN, bV);
  const triggered = bestB >= 1.5;
  const building = bestB >= 0.5 && bestB < 1.5;

  // Green when triggered with direction, amber when triggered-undetermined or building, grey otherwise
  const panelColor = triggered
    ? isUndetermined ? "var(--warn)" : "var(--buy)"
    : building ? "var(--warn)" : "var(--ink-3)";

  const dirArrow = isUndetermined ? "↕" : dir === "bearish" ? "↓" : "↑";
  const statusText = triggered
    ? `${dirArrow} Above 1.5σ review threshold${isUndetermined ? " · no direction" : ""}`
    : building
    ? `↗ Building — need +${fmtNumber(1.5 - bestB, 2)}σ to trigger`
    : `→ Normal — ${fmtNumber(1.5 - bestB, 2)}σ below the 1.5σ review trigger`;

  return (
    <div className="indicator-summary ind-summary">
      {/* B+C merged: spans 2 of the 3 grid columns */}
      <article className="ind-chip B bc">
        <span>B+C · vs own 20-session history</span>
        <strong>
          <span style={{ color: panelColor }}>{fmtNumber(C.nr, 2)}×</span>
          {" "}normal dollar flow{" "}
          <span className="ind-sigma" style={{ color: panelColor }}>
            {bN >= 0 ? "+" : ""}{fmtNumber(bN, 2)}σ
          </span>
        </strong>
        <small>
          vol {fmtNumber(C.vr, 2)}× · notional {fmtNumber(C.nr, 2)}× · {C.fcount ?? 0} focus print{C.fcount !== 1 ? "s" : ""}
        </small>
        <small className="ind-threshold" style={{ color: panelColor }}>
          ● {statusText}
        </small>
      </article>

      {/* A lane unchanged */}
      <article className={`ind-chip A a ${a === null ? "na" : ""}`}>
        <span>{portfolioMode ? "A · relative to your portfolio today" : "A · universe percentile"}</span>
        <strong>{a === null ? "N/A" : fmtPct((a as Record<string, unknown>).volume_percentile)}</strong>
        <small>
          {a === null
            ? "Peer ranking not available in single-ticker mode — run Portfolio Scan to compare against universe"
            : String((a as Record<string, unknown>).scope_label || "peer ranked context")}
        </small>
      </article>
    </div>
  );
}
```

- [ ] **Step 2: Add CSS for the merged chip in `styles.css`**

Find the block starting at `.ind-chip.C {` (around line 1504) and add after it:

```css
/* Merged B+C chip — spans 2 of the 3 grid columns */
.ind-chip.bc {
  grid-column: span 2;
  --ind-key: var(--accent);
}

/* σ value inline with the hero ratio — slightly smaller */
.ind-sigma {
  font-size: 13px;
  font-family: var(--font-mono);
  opacity: 0.9;
}
```

- [ ] **Step 3: Verify visually**

Start the server (`npm start`) and open any ticker. Confirm:
- The indicator row shows 2 columns: wide merged chip on the left, A on the right
- Grey when flow is normal (< 0.5σ), amber when building, green when triggered
- The σ value appears inline with the ratio in the hero line
- A lane content is unchanged

- [ ] **Step 4: Commit**

```bash
git add src/uta/src/components.tsx src/uta/src/styles.css
git commit -m "feat(ux): merge B+C indicator lanes into one richer panel"
```

---

## Task 2: Flow/Price Tension — BLUF Headline + Findings Row

**Files:**
- Modify: `src/uta/src/evidence.tsx` — `BlufCard` (around line 177) and `BlufFindings` (around line 8)
- Modify: `src/uta/src/styles.css` — add `.bf-row.bf-diverge`

### Background
When signed flow is bearish but price is up (or vice versa), the current UI shows a red "Seller-side" tag next to a green "+2.71%" pill with no explanation. The fix: (1) turn the last-close pill amber with a "diverges from flow ⚠" suffix, (2) add an amber left border + `⚠` icon to the "Signed flow pressure" findings row.

- [ ] **Step 1: Add `.bf-row.bf-diverge` CSS in `styles.css`**

Find `.bf-warn { ... }` (around line 3435) and add directly after it:

```css
.bf-row.bf-diverge {
  border-color: var(--warn);
  background: color-mix(in srgb, var(--warn) 6%, transparent);
}
.bf-row.bf-diverge .bf-mk { color: var(--warn); }
```

- [ ] **Step 2: Add divergence to the "Signed flow pressure" findings entry in `BlufFindings`**

In the `BlufFindings` function (around line 67–91), `signedPressure` and `priceSide` are already computed. Add `diverging` right after them and pass it to the finding:

Find this existing block (around line 78–91):
```tsx
        const priceChg = ta?.activity?.price_change_pct;
        const flowSide = signedPressure >= 0 ? "buy" : "sell";
        const priceSide = priceChg != null ? (priceChg < -1 ? "bearish" : priceChg > 1 ? "bullish" : "flat") : null;
        if (Math.abs(signedPressure) >= 0.6) {
```

Replace with:
```tsx
        const priceChg = ta?.activity?.price_change_pct;
        const flowSide = signedPressure >= 0 ? "buy" : "sell";
        const priceSide = priceChg != null ? (priceChg < -1 ? "bearish" : priceChg > 1 ? "bullish" : "flat") : null;
        const flowSideDir = signedPressure >= 0 ? "bullish" : "bearish";
        const diverging = priceSide != null && priceSide !== "flat" && priceSide !== flowSideDir && dir !== "undetermined";
        if (Math.abs(signedPressure) >= 0.6) {
```

Then in the `findings` array, extend the type and the "Signed flow pressure" entry. Find the type declaration:
```tsx
  const findings: Array<{ label: string; value: string; note: string; status: Status }> = [
```
Replace with:
```tsx
  const findings: Array<{ label: string; value: string; note: string; status: Status; diverge?: boolean }> = [
```

Find the "Signed flow pressure" entry's closing (around line 91):
```tsx
      status: Math.abs(pressure) >= 0.6 ? "pass" : Math.abs(pressure) >= 0.3 ? "warn" : "fail",
    },
```
Replace with:
```tsx
      status: Math.abs(pressure) >= 0.6 ? "pass" : Math.abs(pressure) >= 0.3 ? "warn" : "fail",
      diverge: diverging,
    },
```

Then update the findings render (around line 158–164). Find:
```tsx
          <div key={f.label} className={`bf-row bf-${f.status}`}>
            <span className="bf-mk">{STATUS_ICON[f.status]}</span>
```
Replace with:
```tsx
          <div key={f.label} className={`bf-row ${f.diverge ? "bf-diverge" : `bf-${f.status}`}`}>
            <span className="bf-mk">{f.diverge ? "⚠" : STATUS_ICON[f.status]}</span>
```

- [ ] **Step 3: Update the last-close pill in `BlufCard`**

In `BlufCard` (around line 196–201), find the last-close pill block:
```tsx
            {analysis?.activity?.latest_close != null && (() => {
              const chg = analysis.activity.price_change_pct;
              const tone = chg == null ? "neutral" : chg > 0 ? "good" : chg < 0 ? "bad" : "neutral";
              const chgStr = chg != null ? ` (${chg > 0 ? "+" : ""}${fmtNumber(chg, 2)}%)` : "";
              return <Pill tone={tone}>Last close ${fmtNumber(analysis.activity.latest_close, 2)}{chgStr}</Pill>;
            })()}
```
Replace with:
```tsx
            {analysis?.activity?.latest_close != null && (() => {
              const chg = analysis.activity.price_change_pct;
              const sp = Number(analysis?.pressure?.net_signed_pressure ?? analysis?.pressure?.net_notional_pressure ?? 0);
              const pSide = chg != null ? (chg > 1 ? "bullish" : chg < -1 ? "bearish" : "flat") : null;
              const fSide = sp >= 0 ? "bullish" : "bearish";
              const pillDiverging = pSide != null && pSide !== "flat" && pSide !== fSide && data.direction !== "neutral";
              const tone = pillDiverging ? "warn" : chg == null ? "neutral" : chg > 0 ? "good" : chg < 0 ? "bad" : "neutral";
              const chgStr = chg != null ? ` (${chg > 0 ? "+" : ""}${fmtNumber(chg, 2)}%)` : "";
              const arrow = chg != null ? (chg > 0 ? " ↑" : " ↓") : "";
              const suffix = pillDiverging ? `${arrow} — diverges from flow ⚠` : "";
              return <Pill tone={tone}>Last close ${fmtNumber(analysis.activity.latest_close, 2)}{chgStr}{suffix}</Pill>;
            })()}
```

- [ ] **Step 4: Verify visually**

With a ticker that has flow/price divergence (bearish flow + price up, or vice versa):
- Last-close pill is amber and reads "Last close $100.23 (+2.71%) ↑ — diverges from flow ⚠"
- "Signed flow pressure" findings row has amber left border and shows ⚠ icon
- With aligned flow and price: pill stays green/red, no changes to findings row

- [ ] **Step 5: Commit**

```bash
git add src/uta/src/evidence.tsx src/uta/src/styles.css
git commit -m "feat(ux): surface flow/price divergence in BLUF headline and findings row"
```

---

## Task 3: Corroboration Panel — Color, Icons, Data Text

**Files:**
- Modify: `src/uta/src/evidence.tsx` — `CorroborationPanel` (around line 220–311)
- Modify: `src/uta/src/styles.css` — add corroboration color modifier classes

### Background
All rows look identical. There's no color showing which Strong signals are confirmed vs missing, the hint text is generic ("Check chart"), and there's no data-specific context per row. Fix: add a helper that generates a data line + interpretation text specific to each row, and apply color classes based on weight + state.

- [ ] **Step 1: Add CSS modifier classes in `styles.css`**

Find the existing `.corr-row {` rule (around line 3563 area — search for `.corr-row`). After all existing `.corr-row` rules, add:

```css
/* Corroboration row color states */
.corr-row.strong-confirmed { border-left-color: var(--buy);  background: var(--buy-soft); }
.corr-row.strong-missing   { border-left-color: var(--warn); background: var(--warn-bg); }
.corr-row.strong-false     { border-left-color: var(--sell); background: var(--sell-soft); }
.corr-row.corr-moderate    { border-left-color: transparent; }
.corr-row.corr-contextual  { border-left-color: transparent; opacity: 0.85; }

/* Data line (specific numbers for this ticker) */
.corr-data-line {
  font-size: 0.82rem;
  font-weight: 600;
  margin: 4px 0 2px;
}

/* Interpretation text (what it means) */
.corr-interp {
  font-size: 0.78rem;
  color: var(--ink-3);
  line-height: 1.45;
}
```

- [ ] **Step 2: Add `getCorrDataLine` helper inside `CorroborationPanel`**

Inside the `CorroborationPanel` function (right after the `const priceChg = ...` line, before the `rows` declaration), insert this helper:

```tsx
  function getCorrDataLine(id: string, passed: boolean | undefined): { dataLine: string; interpText: string } {
    const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const sp = Number(data.trade_analysis?.pressure?.net_signed_pressure ?? data.trade_analysis?.pressure?.net_notional_pressure ?? 0);
    const dirWord = data.direction === "bullish" ? "bullish" : data.direction === "bearish" ? "bearish" : "undetermined";
    switch (id) {
      case "price_action": {
        if (priceChg == null) return { dataLine: "Price change not available — check chart manually", interpText: "Compare the price move to the flow signal on the chart." };
        const chgStr = `${priceChg >= 0 ? "+" : ""}${fmtNumber(priceChg, 2)}%`;
        const flowDir = sp >= 0 ? "bullish" : "bearish";
        const diverges = (priceChg > 1 && flowDir === "bearish") || (priceChg < -1 && flowDir === "bullish");
        if (!isUndetermined && diverges) return {
          dataLine: `Price ${chgStr} vs prior close — moving AGAINST ${dirWord} flow ⚠`,
          interpText: `A price move against the flow direction may indicate distribution (selling into strength) or a false signal. Watch for price to stall or reverse before treating this as a confirmed ${dirWord} setup.`
        };
        return {
          dataLine: `Price ${chgStr} vs prior close — moves with ${dirWord} flow ✓`,
          interpText: "Price and flow direction agree — a corroborating signal. Strongest when the price move preceded the volume spike."
        };
      }
      case "provider_alert":
        return {
          dataLine: `Check ${data.ticker} on your UOA / block-flow provider for today`,
          interpText: "Any alert — regardless of direction — confirms institutional-scale activity. Direction is secondary to scale here."
        };
      case "options_flow":
        return {
          dataLine: isUndetermined
            ? `Check ${data.ticker} options chain for unusual volume on either side`
            : `Look for ${data.direction === "bullish" ? "call" : "put"} sweeps or unusual volume in ${data.ticker} options`,
          interpText: isUndetermined
            ? "Volume alone (not direction) confirms scale — any large options sweep is a corroboration."
            : `Directional match to ${dirWord} flow. Look for aggressive sweep buying, not just elevated open interest.`
        };
      case "premarket_regular":
        if (passed === true) return { dataLine: "Both sessions elevated vs own history", interpText: "Sustained multi-session elevation is stronger than a single spike — meaningful confirmation." };
        if (passed === false) return { dataLine: "Single session only — not both", interpText: "A single-session spike is weaker than sustained flow across pre-market and regular hours." };
        return { dataLine: "Could not auto-compute — bar data may be unavailable", interpText: "Check whether pre-market and the regular session both showed elevated activity vs this ticker's own history." };
      case "news_catalyst":
        return {
          dataLine: `Check ${data.ticker} events for ${today}`,
          interpText: "Earnings, guidance revisions, analyst actions, or macro events. A known catalyst reduces edge — informed flow is harder to trade against."
        };
      case "macro_regime":
        return {
          dataLine: isUndetermined
            ? "Check if volume reflects index rebalancing or event risk"
            : `Check sector ETF and broad market regime for ${dirWord} support`,
          interpText: isUndetermined
            ? "Could elevated volume reflect index rebalancing, sector rotation, or event risk rather than a directional bet?"
            : `Aligned macro context raises conviction; opposing macro lowers it. Check the sector ETF and broad market direction.`
        };
      default:
        return { dataLine: "", interpText: passed === true ? "Confirmed" : passed === false ? "Not confirmed" : "Check required" };
    }
  }
```

- [ ] **Step 3: Replace the `rows` array and rendering in `CorroborationPanel`**

Find the existing `rows` declaration (starts with `const rows: Array<[string, boolean | undefined, string, string, "auto" | "manual"]>`) and its entire rendering block (through the closing `</div>` of `corr-list`). Replace the entire block with:

```tsx
  // [id, label, passed, weight, source]
  const rows: Array<[string, string, boolean | undefined, string, "auto" | "manual"]> = [
    ["price_action",       "Price action aligned",           corr.price_action_aligned,        "Strong",      "auto"],
    ["provider_alert",     "Provider alert confirmed",        corr.provider_alert_confirmed,     "Strong",      "manual"],
    ["options_flow",       "Options flow aligned",            corr.options_flow_aligned,         "Strong",      "manual"],
    ["premarket_regular",  "Pre-market + regular elevated",   corr.premarket_regular_elevated,   "Moderate",    "auto"],
    ["news_catalyst",      "News catalyst present",           corr.news_catalyst_present,        "Contextual",  "manual"],
    ["macro_regime",       "Macro regime supports",           corr.macro_regime_supports,        "Contextual",  "manual"],
  ];

  return (
    <section className="panel">
      <SectionHeader
        title="Corroboration"
        meta={`${strongCount} of 3 strong signals confirmed · Tier A needs ≥ 1`}
      />
      <p className="corr-intro">
        Confirming even one <b>Strong</b> item raises conviction and may qualify for Tier A.
        <b> Auto</b> signals are computed from bar/print data. <b>Manual</b> signals require an external check.
      </p>
      {isUndetermined && (
        <p className="corr-gap corr-undetermined-note">
          <b>⚠ Volume anomaly — direction not established.</b>{" "}
          Signed pressure ({fmtNumber(Math.abs(Number(data.indicators?.C?.net_notional_pressure ?? 0)) * 100, 1)}%) is below the 60% directional threshold.
          Focus on confirming <em>scale</em> (provider alerts, options volume, price reaction), not direction.
        </p>
      )}
      <div className="corr-list">
        {rows.map(([id, label, passed, weight, source]) => {
          const isStrong = weight === "Strong";
          const isModerate = weight === "Moderate";
          const icon = passed === true ? "✓" : passed === false ? "✗" : isStrong ? "○" : "ℹ";
          const iconColor = passed === true
            ? "var(--buy)"
            : passed === false
            ? isStrong ? "var(--sell)" : "var(--ink-3)"
            : isStrong ? "var(--warn)" : "var(--ink-3)";
          const rowClass = isStrong
            ? passed === true ? "strong-confirmed" : passed === false ? "strong-false" : "strong-missing"
            : isModerate ? "corr-moderate" : "corr-contextual";
          const { dataLine, interpText } = getCorrDataLine(id, passed);
          return (
            <div className={`corr-row ${rowClass}`} key={id}>
              <span className="corr-icon" style={{ color: iconColor }}>{icon}</span>
              <div className="corr-body">
                <div className="corr-label-row">
                  <b>{label}</b>
                  <span className={`corr-weight corr-w-${weight.toLowerCase()}`}>{weight}</span>
                  <span className={`corr-source corr-src-${source}`}>{source}</span>
                </div>
                {dataLine && <div className="corr-data-line">{dataLine}</div>}
                <p className="corr-interp">{interpText}</p>
              </div>
            </div>
          );
        })}
      </div>
      {strongCount === 0 && (
        <p className="corr-gap">
          No strong confirmations yet — this signal stays at Tier {data.tier} until at least one is confirmed.
          {isUndetermined
            ? " Check provider alerts and options volume first — look for scale confirmation, not direction."
            : " Check price action, provider alerts, and options flow first (highest independence)."}
        </p>
      )}
    </section>
  );
```

Note: the closing `}` of `CorroborationPanel` function stays as-is — you are replacing everything from the `const rows` line through the `</section>` closing tag before the final `}`.

- [ ] **Step 4: Verify visually**

Check the Corroboration panel on a Tier B or C ticker:
- Strong + confirmed rows have green left border and `✓` icon in green
- Strong + unconfirmed rows have amber left border and `○` in amber
- Moderate rows have no border, grey `ℹ` icon
- Each row shows a data line (ticker-specific numbers) and an interpretation paragraph
- The intro text no longer mentions "Auto/Manual" as separate label types (they're still shown as small chips)

- [ ] **Step 5: Commit**

```bash
git add src/uta/src/evidence.tsx src/uta/src/styles.css
git commit -m "feat(ux): redesign corroboration panel with color, icons, and data-specific text"
```

---

## Task 4: Block/Off-Exchange Panel — Inline Labels + Narrative

**Files:**
- Modify: `src/uta/src/evidence.tsx` — `BlockOffExchangeBody` (lines 382–423)
- Modify: `src/uta/src/styles.css` — add `.ev-hero-sub`

### Background
The hero shows "195.4×" with no baseline, "0% Focus share" when there's $98M in notional (confusing label — it actually measures TRF/dark-pool share, not focus share), and KV rows with no context. Fix: rename the label, add sub-labels to every hero metric, add a narrative sentence that ties the numbers together, and extend KV rows with inline context.

- [ ] **Step 1: Add `.ev-hero-sub` CSS in `styles.css`**

Find the `.ev-block-hero` rule (search for `ev-block-hero` in styles.css). Directly after the rule that styles `.ev-block-hero`, add:

```css
/* Sub-label under each hero metric in the block panel */
.ev-hero-sub {
  font-size: 11px;
  color: var(--ink-3);
  margin-top: 3px;
  line-height: 1.3;
}
```

- [ ] **Step 2: Replace `BlockOffExchangeBody` in `evidence.tsx`**

Replace the entire `BlockOffExchangeBody` function (lines 382–423) with:

```tsx
function BlockOffExchangeBody({ data }: { data: UtaTickerResult }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ta = data.trade_analysis as any;
  const bf = ta?.block_flow;
  const C = data.indicators.C;
  const B = data.indicators.B;

  const trfShare = Number(bf?.trf_share ?? C.focus_notional_share ?? 0);
  const litShare = 1 - trfShare;
  const focusCount = Number(bf?.focus_trade_count ?? C.focus_trade_count ?? 0);
  const pressure = Number(C.net_notional_pressure ?? 0);

  // Infer the institutional floor from largest_print_notional / largest_print_multiple.
  // The backend computes largest_print_multiple = notional / floor; we reverse it here.
  const inferredFloor: number | null =
    bf?.largest_print_notional && bf?.largest_print_multiple
      ? bf.largest_print_notional / bf.largest_print_multiple
      : null;
  const floorLabel = inferredFloor != null ? fmtMoney(inferredFloor) : "$500K";

  // Venue split bar
  const venueMix: MixSegment[] = [
    { label: "Off-exchange / TRF / dark pool", value: trfShare, colour: "var(--accent)" },
    { label: "Lit exchange", value: litShare, colour: "var(--border-strong)" }
  ];

  // Narrative sentence
  function buildNarrative(): string {
    if (focusCount === 0) return "No institutional-size prints detected this session — monitor for block activity.";
    const focusStr = bf?.focus_notional ? fmtMoney(bf.focus_notional) : `${focusCount} print${focusCount !== 1 ? "s" : ""}`;
    const multipleStr = bf?.largest_print_multiple ? ` · ${fmtNumber(bf.largest_print_multiple, 1)}× the ${floorLabel} floor` : "";
    const venueDesc = trfShare < 0.05
      ? "entirely on lit exchanges"
      : trfShare > 0.95
      ? "entirely off-exchange (dark pool / TRF)"
      : `${fmtNumber(trfShare * 100, 0)}% off-exchange, ${fmtNumber((1 - trfShare) * 100, 0)}% lit`;
    const pressurePct = Math.abs(pressure) * 100;
    const dirDesc = pressurePct >= 60
      ? `The print${focusCount !== 1 ? "s were" : " was"} ${fmtNumber(pressurePct, 1)}% net ${pressure > 0 ? "buy" : "sell"}-directed`
      : `Buy/sell split is too even to confirm direction (${pressure >= 0 ? "+" : ""}${fmtNumber(pressure * 100, 1)}%)`;
    const watchLine = focusCount === 1
      ? "With only 1 focus trade, the directional read is preliminary — watch for a second block print to confirm."
      : focusCount === 2
      ? "Two block prints detected — directional signal is building."
      : `Block activity confirmed across ${focusCount} prints.`;
    return `${focusCount} institutional-size print${focusCount !== 1 ? "s" : ""} (${focusStr}${multipleStr}) executed ${venueDesc}. ${dirDesc}. ${watchLine}`;
  }

  const pressureStr = `${pressure > 0 ? "+" : ""}${fmtNumber(pressure * 100, 1)}%`;
  const pressureColor = pressure > 0 ? "var(--buy)" : "var(--sell)";
  const bFocusZ = Number(B.focus_notional_share_zscore ?? 0);

  return (
    <div className="ev-body-inner">
      {/* Hero metrics with inline sub-labels */}
      <div className="ev-block-hero">
        <div>
          <div className="uplabel">Focus notional</div>
          <div className="mono ev-hero-val">{fmtMoney(bf?.focus_notional ?? 0)}</div>
          <div className="ev-hero-sub">{focusCount} print{focusCount !== 1 ? "s" : ""} above floor</div>
        </div>
        <div>
          <div className="uplabel">TRF / dark pool share</div>
          <div className="mono ev-hero-val">{fmtNumber(trfShare * 100, 0)}%</div>
          <div className="ev-hero-sub">{trfShare < 0.05 ? "All lit exchange" : `${fmtNumber(trfShare * 100, 0)}% off-exchange`}</div>
        </div>
        <div>
          <div className="uplabel">Largest print</div>
          <div className="mono ev-hero-val">
            {bf?.largest_print_multiple ? `${fmtNumber(bf.largest_print_multiple, 1)}×` : fmtMoney(bf?.largest_print_notional ?? 0)}
          </div>
          <div className="ev-hero-sub">the {floorLabel} floor</div>
        </div>
      </div>

      {/* Narrative: ties all hero numbers together in plain English */}
      <p className="ev-block-narrative">{buildNarrative()}</p>

      {/* Venue split bar */}
      <div className="uplabel" style={{ marginBottom: 6 }}>Venue split (by notional)</div>
      <MixBar segments={venueMix} />

      {/* KV rows with inline context */}
      <div className="ev-kv-list">
        <div className="kv">
          <span className="k">Focus trade count</span>
          <span className="v">{focusCount} print{focusCount !== 1 ? "s" : ""} above the {floorLabel} institutional floor</span>
        </div>
        <div className="kv">
          <span className="k">Block directional pressure</span>
          <span className="v" style={{ color: pressureColor }}>
            {pressureStr} ({focusCount} focus print{focusCount !== 1 ? "s" : ""}, signed {pressure > 0 ? "buy" : "sell"})
          </span>
        </div>
        <div className="kv">
          <span className="k">B-score (focus share)</span>
          <span className="v">
            {fmtNumber(B.focus_notional_share_zscore, 2)}σ — focus share is{" "}
            {Math.abs(bFocusZ) >= 1.5 ? "elevated" : "normal"} vs 20-session history
          </span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add `.ev-block-narrative` CSS in `styles.css`**

Find `.ev-block-hero` in `styles.css` and add this after the hero rules:

```css
.ev-block-narrative {
  font-size: 12.5px;
  color: var(--ink-2);
  line-height: 1.5;
  margin: 10px 0 12px;
  padding: 8px 10px;
  background: var(--panel-3);
  border-radius: var(--radius-sm);
  border-left: 3px solid var(--border-strong);
}
```

- [ ] **Step 4: Verify visually**

Open the Block/Off-Exchange evidence card. Confirm:
- Hero labels: "Focus notional", "TRF / dark pool share" (not "Focus share"), "Largest print"
- Each hero value has a sub-label (e.g. "1 print above floor", "All lit exchange", "the $500K floor")
- A narrative paragraph appears below the hero, above the venue split bar
- KV rows show inline context after the value
- "B-score" row ends with "…is normal vs 20-session history" or "…is elevated vs 20-session history"

- [ ] **Step 5: Commit**

```bash
git add src/uta/src/evidence.tsx src/uta/src/styles.css
git commit -m "feat(ux): add inline labels and narrative to block/off-exchange panel"
```

---

## Final: Push to Pi

After all 4 tasks are committed:

```bash
# Windows — push all commits
git push

# Pi
cd ~/flow_momentum_transition-08062026
git pull
sudo fuser -k 3000/tcp
npm start
```
