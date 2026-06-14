# BLUF / Market Flow / Block Panel UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add visual hierarchy to three dashboard panels: BLUF gets a colored tier band + key stats row + recommendation promoted above findings; Market Flow Trend gets a bidirectional pressure bar + interpretation sentence; Block panel gets "What to watch" bullets + a verification checklist.

**Architecture:** All changes are purely frontend — `src/uta/src/evidence.tsx` (three component rewrites) and `src/uta/src/styles.css` (new CSS classes). Three independent tasks, each self-contained and shippable on its own.

**Tech Stack:** React + TypeScript (TSX), plain CSS custom properties, no new imports needed.

---

## File Map

| File | What changes |
|---|---|
| `src/uta/src/evidence.tsx` | `BlufCard` (tier band + stats row), `BlufFindings` (rec moves up), `MarketFlowTrendBody` (replaced), `BlockOffExchangeBody` (watch section added) |
| `src/uta/src/styles.css` | New classes: `.bluf-stats-row`, `.bluf-stat-tile`, `.st-label`, `.st-value`, `.st-detail`, `.pres-bar`, `.pres-bar-track`, `.pres-bar-fill`, `.pres-bar-labels`, `.pres-interp`, `.block-watch`, `.block-watch-title`, `.block-checklist`, `.bc-title` |

---

## Task 1: BLUF Panel — Tier Band + Key Stats Row + Promoted Recommendation

**Files:**
- Modify: `src/uta/src/evidence.tsx` — `BlufCard` (~line 188) and `BlufFindings` return (~line 165)
- Modify: `src/uta/src/styles.css` — add after `.bf-rec-text` block (~line 3514)

### Background
`BlufCard` renders: header → IndicatorGrid → findings → narrative. The user needs to see verdict → numbers → action in that order. Changes: (1) add a left border color to the header based on tier, (2) add a "key stats row" between header and IndicatorGrid showing pressure %, volume σ, and focus count in large colored type, (3) move the recommendation block from below the findings to above them.

- [ ] **Step 1: Add CSS for the stats row in `styles.css`**

Search for `.bf-rec-text {` in `styles.css`. Add this block directly after the closing `}` of the `.bf-rec-text` rule:

```css
/* BLUF key stats row — large colored numbers below the tier band */
.bluf-stats-row {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border);
}
.bluf-stat-tile {
  display: flex;
  flex-direction: column;
  padding: 12px 20px;
  border-right: 1px solid var(--border);
  min-width: 120px;
}
.bluf-stat-tile:last-child { border-right: none; }
.bluf-stat-tile .st-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-3);
  margin-bottom: 4px;
}
.bluf-stat-tile .st-value {
  font-size: 24px;
  font-weight: 700;
  font-family: var(--font-mono);
  line-height: 1;
  margin-bottom: 4px;
}
.bluf-stat-tile .st-detail {
  font-size: 11px;
  color: var(--ink-3);
}
```

- [ ] **Step 2: Replace `BlufCard` in `evidence.tsx`**

Find the entire `BlufCard` export function (starts with `export function BlufCard` around line 188, ends at the closing `}` before `CorroborationPanel`). Replace it with:

```tsx
export function BlufCard({ data, portfolioMode = false }: { data: UtaTickerResult; portfolioMode?: boolean }) {
  const analysis = data.trade_analysis;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bf = (analysis as any)?.block_flow ?? null;
  const B = data.indicators.B;
  const C = data.indicators.C;

  const rows = [
    ["What happened", data.bluf.what_happened],
    ["Why it matters", data.bluf.why_it_matters],
    ["What to check", data.bluf.what_to_check],
    ["Limitations", data.bluf.limitations]
  ];

  // Tier band color — left border + tint on bluf-head
  const tierStr = String(data.tier || "D").toUpperCase();
  const tierBorderColor = tierStr === "A" ? "var(--buy)" : tierStr === "B" ? "var(--warn)" : "var(--ink-3)";
  const tierBg = tierStr === "A" ? "var(--buy-soft)" : tierStr === "B" ? "var(--warn-bg)" : "transparent";

  // Key stats for the stat row
  const bV = Number(B.volume_zscore ?? 0);
  const bN = Number(B.notional_zscore ?? 0);
  const bestB = Math.max(bV, bN);
  const signedPressure = Number(analysis?.pressure?.net_signed_pressure ?? C.net_notional_pressure ?? 0);
  const focusCount = Number(bf?.focus_trade_count ?? C.focus_trade_count ?? 0);

  const pressureColor = Math.abs(signedPressure) < 0.1
    ? "var(--ink-3)"
    : signedPressure > 0 ? "var(--buy)" : "var(--sell)";
  const volColor = bestB >= 1.5 ? "var(--buy)" : bestB >= 0.5 ? "var(--warn)" : "var(--ink-3)";
  const focusColor = focusCount >= 3 ? "var(--buy)" : focusCount >= 1 ? "var(--warn)" : "var(--ink-3)";

  return (
    <section className="panel card bluf bluf-card" data-ux-source="ux design/evidence.jsx:BlufCard">
      <div className="bluf-head" style={{ borderLeft: `4px solid ${tierBorderColor}`, background: tierBg }}>
        <TierBadge tier={data.tier} size="lg" />
        <div>
          <span className="crumb">{portfolioMode ? "Portfolio detail" : "Single ticker"} / BLUF</span>
          <div className="bluf-headline">{data.bluf.headline}</div>
          <div className="bluf-meta">
            <DirTag direction={data.direction} />
            <BandTag band={analysis?.anomaly_band} />
            <Pill tone="neutral">Direction confidence {fmtPct(data.signing_confidence)}</Pill>
            {analysis?.activity?.latest_close != null && (() => {
              const chg = analysis.activity.price_change_pct;
              const pSide = chg != null ? (chg > 1 ? "bullish" : chg < -1 ? "bearish" : "flat") : null;
              const pillDiverging = pSide != null && pSide !== "flat" && pSide !== data.direction && data.direction !== "undetermined";
              const tone = pillDiverging ? "warn" : chg == null ? "neutral" : chg > 0 ? "good" : chg < 0 ? "bad" : "neutral";
              const chgStr = chg != null ? ` (${chg > 0 ? "+" : ""}${fmtNumber(chg, 2)}%)` : "";
              const arrow = chg != null ? (chg > 0 ? " ↑" : " ↓") : "";
              const suffix = pillDiverging ? `${arrow} — diverges from flow ⚠` : "";
              return <Pill tone={tone}>Last close ${fmtNumber(analysis.activity.latest_close, 2)}{chgStr}{suffix}</Pill>;
            })()}
          </div>
        </div>
        <div className="bluf-aside uplabel">BLUF · as of {fmtDate(data.generated_at)}</div>
      </div>

      {/* Key stats row: verdict numbers before any text */}
      <div className="bluf-stats-row">
        <div className="bluf-stat-tile">
          <span className="st-label">Signed pressure</span>
          <span className="st-value" style={{ color: pressureColor }}>
            {signedPressure >= 0 ? "+" : ""}{fmtNumber(signedPressure * 100, 1)}%
          </span>
          <span className="st-detail">
            {signedPressure > 0 ? "buy-side" : signedPressure < 0 ? "sell-side" : "balanced"}
          </span>
        </div>
        <div className="bluf-stat-tile">
          <span className="st-label">Volume (σ)</span>
          <span className="st-value" style={{ color: volColor }}>
            {bestB >= 0 ? "+" : ""}{fmtNumber(bestB, 2)}σ
          </span>
          <span className="st-detail">vs own 20-session history</span>
        </div>
        <div className="bluf-stat-tile">
          <span className="st-label">Focus prints</span>
          <span className="st-value" style={{ color: focusColor }}>
            {focusCount}
          </span>
          <span className="st-detail">{focusCount === 1 ? "print" : "prints"} above floor</span>
        </div>
      </div>

      <IndicatorGrid data={data} portfolioMode={portfolioMode} />
      <BlufFindings data={data} />
      <div className="bluf-grid">
        {rows.map(([label, value]) => (
          <div className="bluf-row" key={label}>
            <div className="bluf-k">{label}</div>
            <div className="bluf-v">{value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Move recommendation above findings in `BlufFindings`**

In `BlufFindings`, find the `return (` block (around line 165). It currently has this order:
1. `bf-findings-label`
2. `bf-findings-list`
3. `bf-rec` (conditional)

Replace just the return block (from `return (` through the final `);` of the function) with this reordered version:

```tsx
  return (
    <div className="bluf-findings">
      <div className="bf-findings-label">Key findings</div>
      {rec && (
        <div className="bf-rec">
          <span className="bf-rec-label">Recommendation</span>
          <span className="bf-rec-text">{rec}</span>
        </div>
      )}
      <div className="bf-findings-list">
        {findings.map((f) => (
          <div key={f.label} className={`bf-row ${f.diverge ? "bf-diverge" : `bf-${f.status}`}`}>
            <span className="bf-mk">{f.diverge ? "⚠" : STATUS_ICON[f.status]}</span>
            <span className="bf-label">{f.label}</span>
            <span className="bf-value">{f.value}</span>
            <span className="bf-note">{f.note}</span>
          </div>
        ))}
      </div>
    </div>
  );
```

- [ ] **Step 4: Commit**

```bash
git add src/uta/src/evidence.tsx src/uta/src/styles.css
git commit -m "feat(ux): BLUF tier band, key stats row, recommendation promoted above findings"
```

---

## Task 2: Market Flow Trend — Pressure Bar + Interpretation

**Files:**
- Modify: `src/uta/src/evidence.tsx` — `MarketFlowTrendBody` (~line 612)
- Modify: `src/uta/src/styles.css` — add after `.ev-trend-label` block (~line 2446)

### Background
`MarketFlowTrendBody` currently shows a synthetic sparkline built from fake intermediate values. Replace the sparkline with a bidirectional pressure bar (honest single-snapshot visual) and add a plain-English interpretation sentence. The 3 metric tiles stay but get updated labels and details.

- [ ] **Step 1: Add CSS for the pressure bar in `styles.css`**

Search for `.ev-trend-label {` in `styles.css`. Add this block directly after the closing `}` of the `.ev-trend-label` rule:

```css
/* Bidirectional pressure bar for Market Flow Trend panel */
.pres-bar { margin: 4px 0 0; }
.pres-bar-track {
  position: relative;
  height: 10px;
  background: var(--panel-3);
  border-radius: 5px;
  overflow: hidden;
}
/* Hairline center divider */
.pres-bar-track::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 0;
  width: 1px;
  height: 100%;
  background: var(--border-strong);
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
  margin-top: 5px;
}
.pres-interp {
  font-size: 12.5px;
  color: var(--ink-2);
  line-height: 1.45;
  margin: 10px 0 12px;
}
```

- [ ] **Step 2: Replace `MarketFlowTrendBody` in `evidence.tsx`**

Find the entire `MarketFlowTrendBody` function (starts with `function MarketFlowTrendBody` around line 612, ends at the closing `}` before the `CARD_ICONS` const). Replace it with:

```tsx
function MarketFlowTrendBody({ data }: { data: UtaTickerResult }) {
  const B = data.indicators.B;
  const C = data.indicators.C;
  const netPressure = Number(C.net_notional_pressure ?? 0);
  const bScore = Number(B.notional_zscore ?? 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const analyzedPrints = (data.trade_analysis as any)?.activity?.analyzed_prints ?? "N/A";

  // Pressure bar: track spans -100% to +100% (200% range).
  // Fill extends from the center (50% of track width) left (sell) or right (buy).
  // At |pressure| = 1.0 (100%), fill width = 50% of track = half the bar.
  const fillPct = Math.min(Math.abs(netPressure) * 50, 50);
  const fillColor = netPressure > 0 ? "var(--buy)" : netPressure < 0 ? "var(--sell)" : "var(--ink-3)";
  const fillStyle: React.CSSProperties = netPressure >= 0
    ? { left: "50%", width: `${fillPct}%`, background: fillColor }
    : { right: "50%", width: `${fillPct}%`, background: fillColor };

  // Plain-English interpretation sentence
  const absPressure = Math.abs(netPressure);
  const n = Math.round(absPressure * 10);
  const side = netPressure > 0 ? "buyers" : "sellers";
  const interpText = absPressure >= 0.6
    ? `Strong ${netPressure > 0 ? "buy" : "sell"}-side edge — ${n} of every 10 labeled dollars flowed to ${side} this session.`
    : absPressure >= 0.1
    ? `Flow is tilted ${netPressure > 0 ? "buy" : "sell"}-side but below the 60% confirmation threshold.`
    : "Buy and sell flow are roughly balanced — no directional edge in the flow composition.";

  // B-score contextual detail
  const bScoreDetail = Math.abs(bScore) >= 1.5
    ? `${bScore > 0 ? "elevated" : "depressed"} vs own history`
    : Math.abs(bScore) >= 0.5
    ? "slightly off own baseline"
    : "within normal range";

  return (
    <div className="ev-body-inner">
      <div className="pres-bar">
        <div className="pres-bar-track">
          <div className="pres-bar-fill" style={fillStyle} />
        </div>
        <div className="pres-bar-labels">
          <span>Sell −100%</span>
          <span>0</span>
          <span>Buy +100%</span>
        </div>
      </div>
      <p className="pres-interp">{interpText}</p>
      <div className="ev-stat-row">
        <MetricTile
          label="Net pressure"
          value={`${netPressure >= 0 ? "+" : ""}${fmtNumber(netPressure * 100, 1)}%`}
          detail="net of labeled trades"
        />
        <MetricTile
          label="B-score"
          value={`${fmtNumber(bScore, 2)}σ`}
          detail={bScoreDetail}
        />
        <MetricTile
          label="Prints analyzed"
          value={String(analyzedPrints)}
          detail="since market open"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/uta/src/evidence.tsx src/uta/src/styles.css
git commit -m "feat(ux): replace synthetic sparkline with pressure bar and interpretation in Market Flow Trend"
```

---

## Task 3: Block Panel — "What to Watch" Bullets + Verification Checklist

**Files:**
- Modify: `src/uta/src/evidence.tsx` — `BlockOffExchangeBody` (add variables + helper + JSX at end)
- Modify: `src/uta/src/styles.css` — add after `.ev-block-narrative` block

### Background
`BlockOffExchangeBody` currently ends after the KV rows with no action guidance. Add: (1) a `divergingBlock` variable (price vs flow direction mismatch), (2) a `buildWatchPoints()` function that returns 1–2 conditional bullet strings based on the signal state, (3) a `.block-watch` section with those bullets, (4) a `.block-checklist` section with 3 read-only verification items.

- [ ] **Step 1: Add CSS for the watch section in `styles.css`**

Search for `.ev-block-narrative {` in `styles.css`. Add this block directly after the closing `}` of the `.ev-block-narrative` rule:

```css
/* Block panel — "What to watch" bullets */
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

/* Block panel — verification checklist */
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

- [ ] **Step 2: Add variables and helper to `BlockOffExchangeBody` in `evidence.tsx`**

Find `BlockOffExchangeBody`. After the existing `const bFocusZ = ...` line (last variable declaration before `return (`), insert:

```tsx
  // Divergence: price moving against block flow direction
  const priceChg = ta?.activity?.price_change_pct;
  const priceSideBlock = priceChg != null
    ? (priceChg > 1 ? "bullish" : priceChg < -1 ? "bearish" : "flat")
    : null;
  const divergingBlock = priceSideBlock != null
    && priceSideBlock !== "flat"
    && priceSideBlock !== data.direction
    && data.direction !== "undetermined";

  function buildWatchPoints(): string[] {
    const points: string[] = [];
    if (focusCount === 0) {
      points.push(
        `Monitor for the first block print above the ${floorLabel} floor — a single institutional-size trade would shift this to an early signal.`
      );
    } else if (focusCount === 1) {
      points.push(
        "Watch for a second block print to confirm direction. One print can be noise — two in the same direction is a pattern."
      );
      if (divergingBlock) {
        points.push(
          "Price is moving against the block flow — watch for price to stall or reverse before acting on this signal."
        );
      }
    } else if (focusCount === 2) {
      points.push(
        "Block signal is building. Confirm direction aligns with options flow or a provider alert before sizing up."
      );
      if (Math.abs(pressure) >= 0.6) {
        points.push(
          `Directional read is ${data.direction} with ${fmtNumber(Math.abs(pressure) * 100, 1)}% signed pressure — wait for price to confirm.`
        );
      }
    } else {
      points.push(
        `Block activity confirmed across ${focusCount} prints. Direction is ${data.direction}.`
      );
      if (Math.abs(pressure) >= 0.6) {
        points.push(
          `Signed pressure at ${fmtNumber(Math.abs(pressure) * 100, 1)}% confirms the ${data.direction} edge — check corroboration before acting.`
        );
      }
    }
    return points;
  }
```

- [ ] **Step 3: Add watch section + checklist to the JSX return**

In the `return (` block of `BlockOffExchangeBody`, find the closing `</div>` of `ev-kv-list`. Add these two sections immediately after it, before the outer `</div>` that closes `ev-body-inner`:

```tsx
        {/* What to watch next */}
        <div className="block-watch">
          <div className="block-watch-title">What to watch next</div>
          <ul>
            {buildWatchPoints().map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>
        </div>

        {/* Verification checklist — read-only reminder protocol */}
        <div className="block-checklist">
          <div className="bc-title">Checklist before acting</div>
          <ul>
            <li>Block direction aligns with signed flow pressure?</li>
            <li>Price has confirmed the direction (within 1–2 sessions)?</li>
            <li>At least one corroboration signal confirmed (provider alert, options flow, or price action)?</li>
          </ul>
        </div>
```

- [ ] **Step 4: Commit**

```bash
git add src/uta/src/evidence.tsx src/uta/src/styles.css
git commit -m "feat(ux): add What to Watch bullets and verification checklist to block panel"
```

---

## Final: Build and Deploy

After all 3 tasks are committed:

```bash
# Windows — build and push
npm run build:uta
git push

# Pi
cd ~/flow_momentum_transition-08062026
git pull
sudo fuser -k 3000/tcp
npm start
```
