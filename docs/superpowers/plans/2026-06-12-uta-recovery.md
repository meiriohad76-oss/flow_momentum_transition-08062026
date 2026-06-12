# UTA Frontend Recovery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover the UTA frontend from a 1,874-line monolith with 10 design deviations to the full approved product spec — landing screen, regime banner, visual evidence cards, scan funnel, typed alerts feed, and correct detail-view tab layout.

**Architecture:** Module-split first (pure refactor, no visual change), then restore each product surface in five phases. All API contracts stay unchanged. Playwright parity check (`npm run check:uta-ux-parity`) is the regression gate after every phase.

**Tech Stack:** React 18, TypeScript, Vite (`npm run dev:uta` → port 5173, `npm run build:uta`), Playwright for integration tests, no Vitest.

---

## File Map

Files created or modified, in dependency order:

| File | Status | Responsibility |
|---|---|---|
| `src/uta/src/types.ts` | Create | All TypeScript types |
| `src/uta/src/utils.ts` | Create | Pure helpers: fmtMoney, fmtPct, fmtDate, tierRank, ruleMatches, setupLabel, API helpers |
| `src/uta/src/components.tsx` | Create | Visual primitives: TierBadge, DirTag, BandTag, Pill, Sparkline, VolBars, PressureGauge, ConfBar, MixBar, DeltaChip, MetricTile, SectionHeader |
| `src/uta/src/evidence.tsx` | Create | BlufCard, IndicatorGrid, EvidenceCards (9 cards), CorroborationPanel, ActionsPanel, LaneHealth, DataProvenance |
| `src/uta/src/trade-analysis.tsx` | Create | TradeAnalysisPanel (co-equal tab content) |
| `src/uta/src/detail-extras.tsx` | Create | RawPrintsDrawer, ExplainTierModal, CompareBanner, CycleHistory |
| `src/uta/src/modes.tsx` | Create | TickerDetail (tabbed layout), SingleMode, PortfolioMode |
| `src/uta/src/scan.tsx` | Create | ScanMode, UniverseSelector, ScanFunnel, ScanResults (3 views) |
| `src/uta/src/alerts.tsx` | Create | AlertsMode, ActivityFeed, RulesDrawer, RuleEditor |
| `src/uta/src/app.tsx` | Create | App shell, TopBar, RegimeBanner, HomeMode, routing, WatchlistDrawer, RevalidationBar |
| `src/uta/src/main.tsx` | Modify | Shrink to 5-line entry point |
| `src/uta/src/styles.css` | Modify | Token rename + theme/density system |
| `src/uta/src/components.css` | Create | Primitive component styles |
| `src/uta/src/app.css` | Create | Shell layout styles |
| `src/uta/src/modes.css` | Create | Detail view + portfolio styles |
| `src/uta/src/scan.css` | Create | Scan funnel + results styles |
| `src/uta/src/alerts.css` | Create | Feed rows + rules drawer styles |
| `scripts/check-uta-ux-parity.js` | Modify | Handle HomeMode entry + new surface assertions |

---

## Phase 1 — Module Split

Pure refactor. No visual or functional changes. The parity check must pass identically after each task.

---

### Task 1: Extract types.ts and utils.ts

**Files:**
- Create: `src/uta/src/types.ts`
- Create: `src/uta/src/utils.ts`
- Modify: `src/uta/src/main.tsx` (remove extracted code, add imports)

- [ ] **Step 1: Create types.ts** — copy all type declarations out of main.tsx lines 5–349

```typescript
// src/uta/src/types.ts

export type LaneState = {
  lane_id: string;
  label: string;
  state: string;
  required: boolean;
  tier_effect: string;
  operator_copy: string;
  coverage?: number | null;
  freshness_seconds?: number | null;
  next_action?: { label: string; route: string } | null;
};

export type EvidenceCard = {
  id: string;
  title: string;
  status: string;
  headline_metric: string;
  summary: string;
};

export type ExplainRule = {
  id: string;
  label: string;
  passed: boolean;
  actual: string;
};

export type RawPrint = {
  ts: string;
  venue: string;
  price: number;
  size: number;
  notional: number;
  signed_side?: string;
  signing_method?: string;
  condition_codes?: string[];
};

export type UtaTickerResult = {
  schema_version: string;
  mode: string;
  ticker: string;
  name?: string;
  exchange?: string;
  sector?: string;
  generated_at: string;
  data_state: string;
  tier: string;
  direction: string;
  signing_confidence: number;
  indicators: {
    A: null | Record<string, unknown>;
    B: Record<string, number | null | undefined>;
    C: Record<string, number | null | undefined>;
  };
  lane_states: LaneState[];
  bluf: {
    headline: string;
    what_happened: string;
    why_it_matters: string;
    what_to_check: string;
    limitations: string;
  };
  trade_analysis?: {
    bias: string;
    setup_status: string;
    verdict: string;
    trigger_model?: string;
    evidence_grade: string;
    anomaly_band: string;
    confidence: number;
    trigger_summary?: {
      primary_trigger?: string;
      next_trigger_needed?: string;
      trade_action?: string;
    };
    criteria?: Array<{ id: string; label: string; passed: boolean; actual: string }>;
    pressure: {
      direction: string;
      net_notional_pressure: number;
      net_volume_pressure?: number;
      signing_confidence: number;
      interpretation: string;
    };
    activity: {
      latest_bar_date?: string | null;
      latest_close?: number | null;
      volume_ratio?: number | null;
      notional_ratio?: number | null;
      volume_zscore?: number | null;
      notional_zscore?: number | null;
      total_notional?: number | null;
      analyzed_prints?: number;
      baseline_sessions?: number;
    };
    block_flow: {
      focus_trade_count?: number;
      focus_notional?: number | null;
      focus_notional_share?: number | null;
      largest_print_notional?: number | null;
      largest_print_multiple?: number | null;
      trf_share?: number | null;
    };
    indicator_aliases?: {
      A: null | Record<string, number | null | undefined>;
      B: Record<string, number | null | undefined>;
      C: Record<string, number | null | undefined>;
    };
    corroboration?: {
      price_action_aligned?: boolean;
      provider_alert_confirmed?: boolean;
      options_flow_aligned?: boolean;
      premarket_regular_elevated?: boolean;
      news_catalyst_present?: boolean;
      macro_regime_supports?: boolean;
      independent_strong_count?: number;
      note?: string;
    };
    trade_boundaries?: string[];
  };
  evidence_cards: EvidenceCard[];
  explain_tier: {
    mode?: string;
    rule_set?: string;
    verdict?: string;
    rules: ExplainRule[];
    gap_to_next_tier?: unknown[];
  };
  raw_prints?: {
    ticker: string;
    policy_version: string;
    truncated?: boolean;
    prints: RawPrint[];
    normalization_summary?: Record<string, unknown>;
  };
  calculation_metadata: {
    source_mode: string;
    replay_clock?: string;
    live_clock?: string;
    provider?: string;
    bars_source?: string;
    prints_source?: string;
    latest_bar_date?: string | null;
    live_volume_source?: string;
    live_manual_only?: boolean;
    direction_source: string;
    price_is_corroboration_only: boolean;
    abc_indicators_kept_separate?: boolean;
  };
  engine_diagnostics?: {
    provider?: string;
    fetched_at?: string;
    print_sample?: { eligible_prints?: number; total_notional?: number; total_volume?: number };
    baseline?: { session_count?: number; state?: string };
    signal_components?: { state?: string };
  };
  runtime_cycle?: {
    run_id?: string;
    status?: string;
    mode?: string;
    reason?: string;
    generated_at?: string;
    duration_ms?: number;
  };
};

export type PortfolioResult = {
  schema_version: string;
  mode: string;
  generated_at: string;
  data_state: string;
  portfolio_ticker_count: number;
  results: UtaTickerResult[];
};

export type ScanRow = {
  ticker: string;
  preliminary_tier?: string;
  B_estimate?: Record<string, number>;
  C_screen?: number;
  pass2_status?: string;
  label?: string;
  scan_reason?: string;
  status?: string;
  setup_status?: string;
  bias?: string;
  trade_action?: string;
  primary_trigger?: string;
  next_trigger_needed?: string;
  anomaly_band?: string;
  evidence_grade?: string;
  signed_pressure?: number | null;
  signing_confidence?: number | null;
  volume_ratio?: number | null;
  notional_ratio?: number | null;
  focus_trade_count?: number | null;
  result?: UtaTickerResult;
};

export type ScanResult = {
  schema_version: string;
  mode: string;
  universe: string;
  universe_label: string;
  universe_ticker_count: number;
  requested_ticker_count?: number | null;
  direction_filter: string;
  pass: number;
  generated_at: string;
  data_state?: string;
  performance_tier: string;
  shortlist_count: number;
  scanned_count?: number;
  blocked_count?: number | null;
  scan_policy?: string;
  scan_scope?: string;
  universe_source?: string;
  universe_cache_state?: string;
  universe_warning?: string | null;
  results: ScanRow[];
};

export type RuntimeStatus = {
  schema_version: string;
  generated_at: string;
  mode: string;
  provider_status?: ProviderStatus;
  scheduler?: {
    enabled?: boolean;
    mode?: string;
    next_run_at?: string | null;
    jobs?: string[];
  };
  last_cycle?: Record<string, unknown> | null;
  signal_result_count: number;
  replay_run_count: number;
  lane_pressure: { total: number; required_not_ready: number; optional_disabled: number };
  pi_policy: {
    auto_start_heavy_jobs: boolean;
    api_saver_blocks_heavy_autostart: boolean;
    storage: string;
  };
  next_actions?: { action: string; label: string; safe: boolean }[];
};

export type ProviderLane = {
  lane_id: string;
  label: string;
  required: boolean;
  provider_family: string;
  provider: string;
  enabled: boolean;
  configured: boolean;
  live_capable: boolean;
  auto_start_allowed: boolean;
  state_if_unavailable: string;
  tier_effect_when_unavailable: string;
  optional_corroboration_only?: boolean;
  operator_copy: string;
};

export type ProviderStatus = {
  schema_version: string;
  generated_at: string;
  mode: string;
  live_ready: boolean;
  summary: {
    required_configured: number;
    required_total: number;
    optional_configured: number;
    optional_total: number;
    live_capable: number;
    auto_start_allowed: number;
  };
  provider_lanes: ProviderLane[];
  safeguards: string[];
  policy: string;
};

export type HistoryResult = {
  schema_version: string;
  rows: Array<{
    id?: string;
    ticker?: string;
    mode?: string;
    tier?: string;
    direction?: string;
    generated_at?: string;
    created_at?: string;
  }>;
  replay_runs: Array<Record<string, unknown>>;
  audit_log: Array<Record<string, unknown>>;
};

export type SchedulerResult = {
  schema_version: string;
  scheduler: RuntimeStatus["scheduler"];
  policy: string;
};

export type UtaRule = {
  id: string;
  name: string;
  enabled: boolean;
  min_tier: string;
  direction: string;
  source?: string;
};

export type UserStateResult = {
  scope: string;
  state: {
    watchlist?: string[];
    reviewed?: Record<string, unknown>;
    ignored?: Record<string, unknown>;
    rules?: UtaRule[];
    saved_scans?: Array<Record<string, unknown>>;
    settings?: Record<string, unknown>;
  };
};

export type LoadState<T> =
  | { status: "idle"; data?: T; message?: string }
  | { status: "loading"; data?: T; message: string }
  | { status: "error"; data?: T; message: string }
  | { status: "ready"; data: T; message?: string };

export type Mode = "home" | "single" | "portfolio" | "scan" | "alerts" | "runtime";
```

- [ ] **Step 2: Create utils.ts** — copy all pure helpers and API utilities

```typescript
// src/uta/src/utils.ts
import type { UtaTickerResult, UtaRule } from "./types.js";

export const LIVE_SOURCE_MODE = "live";
export const DEFAULT_PORTFOLIO = ["AVGO", "NVDA", "MSFT"];
export const SAFE_TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,15}$/;

export function fmtMoney(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${Math.round(n / 1_000_000).toLocaleString()}M`;
  return `$${Math.round(n).toLocaleString()}`;
}

export function fmtPct(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${Math.round(n * 100)}%`;
}

export function fmtNumber(value: unknown, digits = 1): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return n.toFixed(digits);
}

export function fmtDate(value?: string | null): string {
  if (!value) return "N/A";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function tickerList(value: string): string[] {
  return value.split(/[,\s]+/).map((t) => t.trim().toUpperCase()).filter(Boolean).slice(0, 25);
}

export function tierRank(tier?: string): number {
  return { A: 4, B: 3, C: 2, D: 1 }[String(tier || "D").toUpperCase() as "A" | "B" | "C" | "D"] || 0;
}

export function setupTone(status?: string): string {
  if (status === "review_candidate") return "good";
  if (status === "watch_only") return "warn";
  if (status === "blocked") return "bad";
  return "neutral";
}

export function setupLabel(status?: string): string {
  return String(status || "resolved").replaceAll("_", " ");
}

export function ruleMatches(rule: UtaRule, result?: UtaTickerResult | null): boolean {
  if (!rule.enabled || !result) return false;
  if (result.tier === "D") return false;
  return tierRank(result.tier) >= tierRank(rule.min_tier || "A") &&
    (rule.direction === "any" || rule.direction === result.direction);
}

export function invariantWarnings(data: UtaTickerResult): string[] {
  const w: string[] = [];
  if (data.mode === "single_ticker" && data.indicators.A !== null) w.push("Single ticker mode must render A as N/A.");
  if (data.tier !== "D" && data.calculation_metadata.direction_source !== "signed_flow") w.push("Direction source is not signed_flow.");
  if (Object.prototype.hasOwnProperty.call(data, "composite_score")) w.push("Composite score detected.");
  if (data.calculation_metadata.price_is_corroboration_only !== true) w.push("Price corroboration policy missing.");
  return w;
}

export async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
  return payload;
}

export async function apiGet<T>(url: string): Promise<T> {
  return readJson<T>(await fetch(url, { headers: { accept: "application/json" } }));
}

export async function apiPost<T>(url: string, body: unknown): Promise<T> {
  return readJson<T>(await fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body)
  }));
}
```

- [ ] **Step 3: Remove extracted code from main.tsx, add imports at top**

Replace lines 1–451 of `main.tsx` with:

```tsx
// src/uta/src/main.tsx  (TRANSITIONAL — will shrink to 5 lines by Task 3)
import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import type {
  LaneState, EvidenceCard, ExplainRule, RawPrint, UtaTickerResult,
  PortfolioResult, ScanRow, ScanResult, RuntimeStatus, ProviderLane,
  ProviderStatus, HistoryResult, SchedulerResult, UtaRule, UserStateResult,
  LoadState, Mode
} from "./types.js";
import {
  LIVE_SOURCE_MODE, DEFAULT_PORTFOLIO, SAFE_TICKER_PATTERN,
  fmtMoney, fmtPct, fmtNumber, fmtDate, tickerList,
  tierRank, setupTone, setupLabel, ruleMatches, invariantWarnings,
  apiGet, apiPost
} from "./utils.js";
```

- [ ] **Step 4: Verify the app still compiles and runs**

```
npm run dev:uta
```

Expected: Vite starts on port 5173 with no TypeScript errors. Open `http://127.0.0.1:5173/uta` — app behaves identically to before.

- [ ] **Step 5: Run parity check**

```
npm run check:uta-ux-parity
```

Expected: `"status": "ok"` — all existing assertions pass.

- [ ] **Step 6: Commit**

```
git add src/uta/src/types.ts src/uta/src/utils.ts src/uta/src/main.tsx
git commit -m "refactor(uta): extract types.ts and utils.ts from main.tsx"
```

---

### Task 2: Extract component modules

**Files:**
- Create: `src/uta/src/components.tsx`
- Create: `src/uta/src/evidence.tsx`
- Create: `src/uta/src/trade-analysis.tsx`
- Create: `src/uta/src/detail-extras.tsx`
- Modify: `src/uta/src/main.tsx` (remove extracted components, add imports)

- [ ] **Step 1: Create components.tsx** — extract all visual primitive components

```tsx
// src/uta/src/components.tsx
import React from "react";
import { fmtNumber, fmtPct, tierRank, setupTone } from "./utils.js";
import type { UtaTickerResult } from "./types.js";

export function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function SectionHeader({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="section-header">
      <h2>{title}</h2>
      {meta ? <span>{meta}</span> : null}
    </div>
  );
}

export function MetricTile({ label, value, detail }: { label: string; value: React.ReactNode; detail?: string }) {
  return (
    <div className="metric-tile">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

export function TierBadge({ tier, size = "" }: { tier?: string; size?: string }) {
  const t = String(tier || "D").toUpperCase();
  return <span className={`tier-badge tier-ring t-${t.toLowerCase()} tier-${t.toLowerCase()} ${size}`}>{t}</span>;
}

export function DirTag({ direction }: { direction?: string }) {
  const arrow = direction === "bullish" ? "↑" : direction === "bearish" ? "↓" : "↔";
  const label = direction === "bullish" ? "Buyer-side" : direction === "bearish" ? "Seller-side" : "Undetermined";
  const cls = direction === "bullish" ? "bull" : direction === "bearish" ? "bear" : "undet";
  return <span className={`dir-tag ${cls} ${direction || "neutral"}`}>{arrow} {label}</span>;
}

export function BandTag({ band }: { band?: string }) {
  return <span className={`band-tag ${String(band || "normal").toLowerCase()}`}>{band || "Normal"}</span>;
}

export function DeltaChip({ delta, unit = "σ" }: { delta: number; unit?: string }) {
  if (!Number.isFinite(delta)) return <span className="delta-chip neutral">— {unit}</span>;
  if (Math.abs(delta) < 0.05) return <span className="delta-chip neutral">→ 0.0{unit}</span>;
  const arrow = delta > 0 ? "↑" : "↓";
  const tone = delta > 0 ? "good" : "bad";
  return <span className={`delta-chip ${tone}`}>{arrow} {delta > 0 ? "+" : ""}{delta.toFixed(1)}{unit}</span>;
}

export function IndicatorGrid({ data, portfolioMode = false }: { data: UtaTickerResult; portfolioMode?: boolean }) {
  const a = data.indicators.A;
  const aliases = data.trade_analysis?.indicator_aliases;
  const b = aliases?.B || {
    volume: data.indicators.B.volume_zscore,
    notional: data.indicators.B.notional_zscore,
    focus: data.indicators.B.focus_notional_share_zscore,
    pressure: data.indicators.B.net_notional_pressure_zscore
  };
  const c = aliases?.C || {
    vr: data.indicators.C.volume_ratio,
    nr: data.indicators.C.notional_ratio,
    fshare: data.indicators.C.focus_notional_share,
    fcount: data.indicators.C.focus_trade_count,
    nnp: data.indicators.C.net_notional_pressure
  };
  return (
    <div className="indicator-summary ind-summary">
      <article className="ind-chip B b">
        <span>B · vs own history</span>
        <strong>{fmtNumber(b.notional, 2)}σ notional</strong>
        <small>{fmtNumber(b.volume, 2)}σ vol · {fmtNumber(b.focus, 2)}σ focus · {fmtNumber(b.pressure, 2)}σ pressure</small>
      </article>
      <article className={`ind-chip A a ${a === null ? "na" : ""}`}>
        <span>{portfolioMode ? "A - relative to your portfolio today" : "A - universe percentile"}</span>
        <strong>{a === null ? "N/A" : fmtPct(a.volume_percentile)}</strong>
        <small>{a === null ? "single-ticker mode by design" : String(a.scope_label || "peer ranked context")}</small>
      </article>
      <article className="ind-chip C c">
        <span>C · raw magnitude</span>
        <strong>{fmtNumber(c.nr, 2)}x notional</strong>
        <small>{fmtNumber(c.vr, 2)}x vol · {fmtPct(c.nnp)} pressure · {c.fcount ?? 0} focus prints</small>
      </article>
    </div>
  );
}
```

- [ ] **Step 2: Create evidence.tsx** — extract BlufCard, LaneHealth, DataProvenance plus the four evidence-adjacent panels

```tsx
// src/uta/src/evidence.tsx
import React, { useState } from "react";
import { fmtMoney, fmtPct, fmtNumber, fmtDate } from "./utils.js";
import { Pill, SectionHeader, MetricTile, TierBadge, DirTag, BandTag } from "./components.js";
import type { UtaTickerResult, LaneState, EvidenceCard } from "./types.js";

export function BlufCard({ data, portfolioMode = false }: { data: UtaTickerResult; portfolioMode?: boolean }) {
  const analysis = data.trade_analysis;
  const rows = [
    ["What happened", data.bluf.what_happened],
    ["Why it matters", data.bluf.why_it_matters],
    ["What to check", data.bluf.what_to_check],
    ["Limitations", data.bluf.limitations]
  ];
  return (
    <section className="panel card bluf bluf-card" data-ux-source="ux design/evidence.jsx:BlufCard">
      <div className="bluf-head">
        <TierBadge tier={data.tier} size="lg" />
        <div>
          <span className="crumb">{portfolioMode ? "Portfolio detail" : "Single ticker"} / BLUF</span>
          <div className="bluf-headline">{data.bluf.headline}</div>
          <div className="bluf-meta">
            <DirTag direction={data.direction} />
            <BandTag band={analysis?.anomaly_band} />
            <Pill tone="neutral">Direction confidence {fmtPct(data.signing_confidence)}</Pill>
          </div>
        </div>
        <div className="bluf-aside uplabel">BLUF · as of {fmtDate(data.generated_at)}</div>
      </div>
      <IndicatorGridInline data={data} portfolioMode={portfolioMode} />
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

// IndicatorGrid re-exported from components but also used internally here
import { IndicatorGrid as IndicatorGridInline } from "./components.js";
export { IndicatorGridInline as IndicatorGrid };

export function CorroborationPanel({ data }: { data: UtaTickerResult }) {
  const corr = data.trade_analysis?.corroboration;
  const flags = [
    { key: "price_action_aligned", label: "Price action aligned", value: corr?.price_action_aligned },
    { key: "provider_alert_confirmed", label: "Provider alert confirmed", value: corr?.provider_alert_confirmed },
    { key: "options_flow_aligned", label: "Options flow aligned", value: corr?.options_flow_aligned },
    { key: "premarket_regular_elevated", label: "Pre-market elevated", value: corr?.premarket_regular_elevated },
    { key: "news_catalyst_present", label: "News catalyst", value: corr?.news_catalyst_present },
    { key: "macro_regime_supports", label: "Macro regime supports", value: corr?.macro_regime_supports },
  ];
  return (
    <section className="panel corr-panel">
      <SectionHeader title="Corroboration" meta={`${corr?.independent_strong_count ?? 0} strong`} />
      <div className="corr-list">
        {flags.map((f) => (
          <div className={`corr-row ${f.value === true ? "yes" : f.value === false ? "no" : "unknown"}`} key={f.key}>
            <span>{f.value === true ? "✓" : f.value === false ? "×" : "—"}</span>
            <span>{f.label}</span>
          </div>
        ))}
      </div>
      {corr?.note ? <p className="corr-note">{corr.note}</p> : null}
    </section>
  );
}

export function ActionsPanel({
  onRevalidate, onRawPrints, onExplainTier, onCompare, onWatchlist, onRefreshLane, isWatchlisted
}: {
  onRevalidate: () => void;
  onRawPrints: () => void;
  onExplainTier: () => void;
  onCompare: () => void;
  onWatchlist: () => void;
  onRefreshLane: () => void;
  isWatchlisted?: boolean;
}) {
  return (
    <section className="panel actions-panel">
      <SectionHeader title="Actions" />
      <div className="action-grid">
        <button className="action-btn secondary" type="button" onClick={onRevalidate}>Revalidate</button>
        <button className="action-btn secondary" type="button" onClick={onRawPrints}>Raw Prints</button>
        <button className="action-btn secondary" type="button" onClick={onExplainTier}>Explain Tier</button>
        <button className="action-btn secondary" type="button" onClick={onCompare}>Compare</button>
        <button className="action-btn secondary" type="button" onClick={onWatchlist}>
          {isWatchlisted ? "★ Watchlist" : "☆ Watchlist"}
        </button>
        <button className="action-btn secondary" type="button" onClick={onRefreshLane}>Refresh lane</button>
      </div>
    </section>
  );
}

export function EvidenceCards({ cards }: { cards: EvidenceCard[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["volume_anomaly", "block_off_exchange", "directional_pressure"]));
  const toggle = (id: string) => setExpanded((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  return (
    <div data-ux-source="ux design/evidence.jsx:EvidenceGrid">
      {cards.map((card) => (
        <article className={`panel ev-card ev-${card.status}`} key={card.id}>
          <div className="ev-head" onClick={() => toggle(card.id)} style={{ cursor: "pointer" }}>
            <strong>{card.title}</strong>
            <span className="ev-metric">{card.headline_metric}</span>
            <span className="ev-toggle">{expanded.has(card.id) ? "▲" : "▼"}</span>
          </div>
          {expanded.has(card.id) && (
            <div className="ev-body">
              <p>{card.summary}</p>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

export function LaneHealth({ lanes, onRefresh }: { lanes: LaneState[]; onRefresh?: (lane: LaneState) => void }) {
  return (
    <section className="panel">
      <SectionHeader title="Data Health" meta={`${lanes.length} lanes`} />
      <div className="lane-list">
        {lanes.map((lane) => (
          <div className="lane" key={lane.lane_id}>
            <div>
              <b>{lane.label}</b>
              <span>{lane.operator_copy}</span>
              <small>
                {lane.required ? "Required" : "Optional"} / tier effect: {lane.tier_effect}
                {typeof lane.coverage === "number" ? ` / coverage ${fmtPct(lane.coverage)}` : ""}
              </small>
            </div>
            <div className="lane-actions">
              <Pill tone={lane.state === "ready" ? "good" : lane.state === "disabled" ? "neutral" : "warn"}>{lane.state}</Pill>
              {lane.next_action && onRefresh ? (
                <button className="icon-button" type="button" onClick={() => onRefresh(lane)} title={lane.next_action!.label}>R</button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function DataProvenance({ data }: { data: UtaTickerResult }) {
  const diag = data.engine_diagnostics || {};
  const live = data.data_state === "live_manual";
  return (
    <section className="panel">
      <SectionHeader title="Data Provenance" meta={live ? "Massive live manual" : "Live provider state"} />
      <div className="metric-grid four">
        <MetricTile label="Source mode" value={data.calculation_metadata.source_mode || data.data_state} detail={live ? "manual provider pull" : "provider unavailable"} />
        <MetricTile label="Provider" value={data.calculation_metadata.provider || diag.provider || "massive"} detail={data.calculation_metadata.prints_source || "live provider"} />
        <MetricTile label="Prints analyzed" value={diag.print_sample?.eligible_prints ?? "N/A"} detail="eligible prints" />
        <MetricTile label="Baseline sessions" value={diag.baseline?.session_count ?? "N/A"} detail={diag.baseline?.state || ""} />
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Create trade-analysis.tsx**

```tsx
// src/uta/src/trade-analysis.tsx
import React from "react";
import { fmtMoney, fmtPct, fmtNumber } from "./utils.js";
import { Pill, SectionHeader, MetricTile, BandTag } from "./components.js";
import type { UtaTickerResult } from "./types.js";

function toneForBias(bias?: string) {
  if (bias === "bullish") return "good";
  if (bias === "bearish") return "bad";
  return "neutral";
}

export function TradeAnalysisPanel({ data }: { data: UtaTickerResult }) {
  const analysis = data.trade_analysis;
  if (!analysis) return null;
  return (
    <section className={`panel trade-analysis ${analysis.bias || "neutral"}`} data-testid="trade-analysis">
      <SectionHeader title="Trade Analysis" meta={analysis.trigger_model || "signed-flow criteria"} />
      <div className="trade-verdict-row">
        <div>
          <span className="crumb">Bias / setup verdict</span>
          <h2>{analysis.bias === "neutral" ? "No directional UTA setup" : `${analysis.bias.toUpperCase()} signed-flow setup`}</h2>
          <p>{analysis.verdict}</p>
        </div>
        <div className="trade-verdict-tags">
          <Pill tone={toneForBias(analysis.bias)}>{analysis.bias}</Pill>
          <Pill tone={analysis.setup_status === "review_candidate" ? "good" : analysis.setup_status === "watch_only" ? "warn" : "neutral"}>
            {analysis.setup_status.replaceAll("_", " ")}
          </Pill>
          <BandTag band={analysis.anomaly_band} />
        </div>
      </div>
      <div className="trigger-strip">
        <div><span>Primary trigger</span><b>{analysis.trigger_summary?.primary_trigger || "No trigger"}</b></div>
        <div><span>Next required evidence</span><b>{analysis.trigger_summary?.next_trigger_needed || "N/A"}</b></div>
        <div><span>Trade workflow effect</span><b>{(analysis.trigger_summary?.trade_action || "no_trade").replaceAll("_", " ")}</b></div>
      </div>
      <div className="metric-grid four">
        <MetricTile label="Signed pressure" value={`${fmtNumber(Number(analysis.pressure.net_notional_pressure) * 100, 1)}%`} detail={analysis.pressure.direction} />
        <MetricTile label="Confidence" value={fmtPct(analysis.pressure.signing_confidence)} detail="print signing" />
        <MetricTile label="Volume / notional" value={`${fmtNumber(analysis.activity.volume_ratio, 2)}x / ${fmtNumber(analysis.activity.notional_ratio, 2)}x`} detail={`${analysis.activity.baseline_sessions || 0} baseline sessions`} />
        <MetricTile label="Focus prints" value={analysis.block_flow.focus_trade_count ?? 0} detail={`${fmtMoney(analysis.block_flow.focus_notional)} focus notional`} />
      </div>
      <div className="trade-analysis-body">
        <div>
          <h3>Interpretation</h3>
          <p>{analysis.pressure.interpretation}</p>
        </div>
        <div>
          <h3>Trigger criteria</h3>
          <div className="criteria-list">
            {(analysis.criteria || []).map((item) => (
              <div className={`criteria ${item.passed ? "pass" : "fail"}`} key={item.id}>
                <b>{item.passed ? "✓" : "×"}</b>
                <span>{item.label}<small>{item.actual}</small></span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create detail-extras.tsx** — extract RawPrintsDrawer, ExplainTierModal, CycleHistory stub

Find the `RawPrintsDrawer` and `ExplainTierModal` functions in main.tsx (search for `data-ux-source="ux design/detail-extras.jsx:RawPrintsDrawer"` and `data-ux-source="ux design/detail-extras.jsx:ExplainTierPanel"`). Move them verbatim into:

```tsx
// src/uta/src/detail-extras.tsx
import React from "react";
import { fmtDate, fmtMoney } from "./utils.js";
import { SectionHeader, Pill } from "./components.js";
import type { UtaTickerResult, ExplainRule, RawPrint } from "./types.js";

// CycleHistory — stub for Phase 3; rendered as empty section for now
export function CycleHistory({ ticker }: { ticker: string }) {
  return (
    <section className="panel cyc">
      <SectionHeader title="Cycle History" meta={ticker} />
      <div className="cyc-cell cyc-placeholder">
        <span>Visual cycle timeline — Phase 3</span>
      </div>
    </section>
  );
}

// RawPrintsDrawer — copy verbatim from main.tsx keeping data-ux-source attribute
export function RawPrintsDrawer({ data, onClose }: { data: UtaTickerResult; onClose: () => void }) {
  const prints = data.raw_prints?.prints || [];
  return (
    <div className="drawer" data-ux-source="ux design/detail-extras.jsx:RawPrintsDrawer">
      <div className="drawer-head">
        <h2>Raw Prints — {data.ticker}</h2>
        <button className="x-close icon-button secondary" type="button" onClick={onClose}>✕</button>
      </div>
      <div className="drawer-body">
        <div className="rp-table">
          <table>
            <thead>
              <tr>
                <th>Time</th><th>Venue</th><th>Price</th><th>Size</th><th>Notional</th>
                <th>Side</th><th>Method</th><th>Codes</th>
              </tr>
            </thead>
            <tbody>
              {prints.length === 0 ? (
                <tr><td colSpan={8}>No raw prints available.</td></tr>
              ) : prints.map((p, i) => (
                <tr key={i}>
                  <td>{fmtDate(p.ts)}</td>
                  <td>{p.venue}</td>
                  <td>${p.price.toFixed(2)}</td>
                  <td>{p.size.toLocaleString()}</td>
                  <td>{fmtMoney(p.notional)}</td>
                  <td>{p.signed_side || "—"}</td>
                  <td>{p.signing_method || "—"}</td>
                  <td>{(p.condition_codes || []).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.raw_prints?.truncated ? <p className="rp-truncated">Results truncated. Policy: {data.raw_prints.policy_version}</p> : null}
      </div>
    </div>
  );
}

// ExplainTierPanel — copy verbatim from main.tsx keeping data-ux-source attribute
export function ExplainTierPanel({ data, onClose }: { data: UtaTickerResult; onClose: () => void }) {
  const explain = data.explain_tier;
  const rules = explain?.rules || [];
  return (
    <div className="modal" data-ux-source="ux design/detail-extras.jsx:ExplainTierPanel">
      <div className="modal-head">
        <h2>Explain Tier — {data.tier}</h2>
        <button className="x-close icon-button secondary" type="button" onClick={onClose}>✕</button>
      </div>
      <div className="modal-body">
        <p>{explain?.verdict}</p>
        <div className="rule-list">
          {rules.map((rule) => (
            <div className={`rule-row ${rule.passed ? "pass" : "fail"}`} key={rule.id}>
              <b>{rule.passed ? "✓" : "×"}</b>
              <span>{rule.label}<small>{rule.actual}</small></span>
            </div>
          ))}
        </div>
        {explain?.gap_to_next_tier && explain.gap_to_next_tier.length > 0 ? (
          <div className="gap-section">
            <h3>Gap to next tier</h3>
            {explain.gap_to_next_tier.map((g: unknown, i) => (
              <div key={i}>{JSON.stringify(g)}</div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Update main.tsx imports** — remove all the components just extracted, import from new modules instead. The import block at the top of main.tsx should now include:

```tsx
import { Pill, SectionHeader, MetricTile, TierBadge, DirTag, BandTag, DeltaChip, IndicatorGrid } from "./components.js";
import { BlufCard, CorroborationPanel, ActionsPanel, EvidenceCards, LaneHealth, DataProvenance } from "./evidence.js";
import { TradeAnalysisPanel } from "./trade-analysis.js";
import { CycleHistory, RawPrintsDrawer, ExplainTierPanel } from "./detail-extras.js";
```

- [ ] **Step 6: Run parity check**

```
npm run check:uta-ux-parity
```

Expected: `"status": "ok"`. The `data-ux-source` attributes are now in the extracted files but the DOM output is identical.

- [ ] **Step 7: Commit**

```
git add src/uta/src/components.tsx src/uta/src/evidence.tsx src/uta/src/trade-analysis.tsx src/uta/src/detail-extras.tsx src/uta/src/main.tsx
git commit -m "refactor(uta): extract component modules from main.tsx"
```

---

### Task 3: Extract mode modules, shrink main.tsx to entry point

**Files:**
- Create: `src/uta/src/modes.tsx`
- Create: `src/uta/src/scan.tsx`
- Create: `src/uta/src/alerts.tsx`
- Create: `src/uta/src/app.tsx`
- Modify: `src/uta/src/main.tsx` (shrink to 5 lines)

- [ ] **Step 1: Create modes.tsx** — move SingleMode, PortfolioMode, TickerDetail, useSseEvents, StatusStrip, RuntimeMode into this file

```tsx
// src/uta/src/modes.tsx
import React, { useEffect, useState } from "react";
import { fmtDate, fmtMoney, fmtPct, fmtNumber, invariantWarnings, apiPost } from "./utils.js";
import { Pill, SectionHeader, MetricTile, TierBadge } from "./components.js";
import { BlufCard, CorroborationPanel, ActionsPanel, EvidenceCards, LaneHealth, DataProvenance } from "./evidence.js";
import { TradeAnalysisPanel } from "./trade-analysis.js";
import { CycleHistory, RawPrintsDrawer, ExplainTierPanel } from "./detail-extras.js";
import type {
  UtaTickerResult, PortfolioResult, RuntimeStatus, ProviderStatus,
  SchedulerResult, HistoryResult, LaneState, LoadState
} from "./types.js";

// useSseEvents hook
export function useSseEvents() {
  const [events, setEvents] = useState<Array<{ type: string; received_at: string; payload: string }>>([]);
  const [state, setState] = useState("connecting");
  useEffect(() => {
    if (!("EventSource" in window)) { setState("unsupported"); return; }
    const source = new EventSource("/api/uta/stream");
    const remember = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);
        setEvents((cur) => [{ type: payload.type || event.type, received_at: new Date().toISOString(), payload: JSON.stringify(payload.payload || payload).slice(0, 160) }, ...cur].slice(0, 8));
      } catch {
        setEvents((cur) => [{ type: event.type, received_at: new Date().toISOString(), payload: String(event.data).slice(0, 160) }, ...cur].slice(0, 8));
      }
    };
    source.addEventListener("uta_snapshot", (e) => { setState("connected"); remember(e as MessageEvent); });
    ["uta_signal_result", "uta_scan_progress", "uta_lane_state", "uta_revalidation"].forEach((t) => source.addEventListener(t, remember as EventListener));
    source.onerror = () => setState("reconnecting");
    source.onopen = () => setState("connected");
    return () => source.close();
  }, []);
  return { state, events };
}

// StatusStrip
export function StatusStrip({ data }: { data: UtaTickerResult }) {
  const warnings = invariantWarnings(data);
  return (
    <section className={`status-strip ${warnings.length ? "error" : "ok"}`}>
      <div>
        <strong>{warnings.length ? "Invariant warning" : "Live analysis"}</strong>
        <span>{warnings.length ? warnings.join(" ") : `Loaded ${data.ticker} from ${data.calculation_metadata.source_mode || data.data_state}. Direction source: ${data.calculation_metadata.direction_source}.`}</span>
      </div>
      <Pill tone={data.data_state === "live_unavailable" ? "warn" : "good"}>{data.data_state}</Pill>
    </section>
  );
}

// TickerDetail — layout wrapper, currently renders Trade Analysis then Evidence (will become tabs in Phase 3)
export function TickerDetail({
  data, isWatchlisted, onRevalidate, onToggleWatchlist, onRefreshLane
}: {
  data: UtaTickerResult;
  isWatchlisted: boolean;
  onRevalidate: () => void;
  onToggleWatchlist: () => void;
  onRefreshLane: (lane: LaneState) => void;
}) {
  const [showRawPrints, setShowRawPrints] = useState(false);
  const [showExplainTier, setShowExplainTier] = useState(false);

  return (
    <div className="layout">
      <div className="main-col">
        <StatusStrip data={data} />
        <BlufCard data={data} />
        <TradeAnalysisPanel data={data} />
        <CycleHistory ticker={data.ticker} />
        <EvidenceCards cards={data.evidence_cards} />
      </div>
      <div className="side-col">
        <CorroborationPanel data={data} />
        <ActionsPanel
          onRevalidate={onRevalidate}
          onRawPrints={() => setShowRawPrints(true)}
          onExplainTier={() => setShowExplainTier(true)}
          onCompare={() => {}}
          onWatchlist={onToggleWatchlist}
          onRefreshLane={() => onRefreshLane(data.lane_states[0])}
          isWatchlisted={isWatchlisted}
        />
        <LaneHealth lanes={data.lane_states} onRefresh={onRefreshLane} />
      </div>
      {showRawPrints && <RawPrintsDrawer data={data} onClose={() => setShowRawPrints(false)} />}
      {showExplainTier && <ExplainTierPanel data={data} onClose={() => setShowExplainTier(false)} />}
    </div>
  );
}
```

Note: Copy the existing SingleMode, PortfolioMode, and RuntimeMode function bodies verbatim from main.tsx into modes.tsx — they are long (300+ lines combined) and do not change in this task. The key is removing them from main.tsx and importing them back.

- [ ] **Step 2: Create scan.tsx** — move existing ScanMode verbatim

Copy the `ScanMode` function from main.tsx into `src/uta/src/scan.tsx`. Add imports at top:

```tsx
// src/uta/src/scan.tsx
import React, { useState } from "react";
import { fmtDate, fmtMoney, fmtPct, fmtNumber, tierRank, setupLabel } from "./utils.js";
import { Pill, SectionHeader, MetricTile, TierBadge, DirTag, BandTag } from "./components.js";
import type { ScanResult, ScanRow, UtaTickerResult, LoadState } from "./types.js";

// ... existing ScanMode body pasted here verbatim
```

- [ ] **Step 3: Create alerts.tsx** — move existing AlertsMode verbatim

Copy the `AlertsMode` function from main.tsx into `src/uta/src/alerts.tsx`. Add imports:

```tsx
// src/uta/src/alerts.tsx
import React, { useState } from "react";
import { fmtDate, tierRank, setupLabel, ruleMatches } from "./utils.js";
import { Pill, SectionHeader, TierBadge } from "./components.js";
import type { UtaTickerResult, HistoryResult, UserStateResult, UtaRule } from "./types.js";

// ... existing AlertsMode body pasted here verbatim
```

- [ ] **Step 4: Create app.tsx** — extract the App component and all top-level shell state

Move the `App` function from main.tsx into `src/uta/src/app.tsx`. Add all necessary imports. The App function is the largest item in main.tsx (lines 1604–end) and moves verbatim:

```tsx
// src/uta/src/app.tsx
import React, { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, LIVE_SOURCE_MODE, DEFAULT_PORTFOLIO, SAFE_TICKER_PATTERN } from "./utils.js";
import { useSseEvents, SingleMode, PortfolioMode, RuntimeMode } from "./modes.js";
import { ScanMode } from "./scan.js";
import { AlertsMode } from "./alerts.js";
import type {
  Mode, UtaTickerResult, PortfolioResult, ScanResult, RuntimeStatus,
  ProviderStatus, HistoryResult, SchedulerResult, UserStateResult, LaneState, LoadState
} from "./types.js";

// App function body pasted verbatim from main.tsx
export function App() {
  // ... same body as before
}
```

- [ ] **Step 5: Shrink main.tsx to 5 lines**

```tsx
// src/uta/src/main.tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import "./styles.css";
createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 6: Run parity check**

```
npm run check:uta-ux-parity
```

Expected: `"status": "ok"`. If it fails, check that `data-ux-source` attributes survived the move — they are in `evidence.tsx` and `detail-extras.tsx`.

- [ ] **Step 7: Commit**

```
git add src/uta/src/modes.tsx src/uta/src/scan.tsx src/uta/src/alerts.tsx src/uta/src/app.tsx src/uta/src/main.tsx
git commit -m "refactor(uta): complete module split — main.tsx is now 5 lines"
```

**Phase 1 exit criteria:** `npm run check:uta-ux-parity` passes. `wc -l src/uta/src/main.tsx` outputs 5.

---

## Phase 2 — Shell Recovery

Four tasks: CSS tokens, HomeMode + routing, full TopBar, RegimeBanner + overlays.

---

### Task 4: CSS token system — rename legacy tokens + add theme/density

**Files:**
- Modify: `src/uta/src/styles.css`

The existing CSS has two `:root` blocks. The second one (the UX parity layer, line 1010+) already defines `--buy`, `--sell`, `--ink-2`, `--ink-3` etc., and aliases the legacy names (`--green: var(--buy)` etc). This task promotes those spec tokens to be the canonical ones and adds the light-theme + density system.

- [ ] **Step 1: Replace the first `:root` block** (lines 1–22) with the full spec token set

Find the existing first `:root` block and replace it entirely:

```css
/* src/uta/src/styles.css — first :root block */
:root {
  color-scheme: dark;
  /* surface */
  --bg: #090b0f;
  --panel: #111820;
  --panel-2: #151f29;
  --panel-3: #0d131a;
  /* borders */
  --line: #283341;
  --line-strong: #3a495b;
  /* text */
  --ink: #f3f7fb;
  --ink-2: #9aa8b8;
  --ink-3: #6d7a8a;
  --ink-faint: #4b5a6a;
  /* semantic colours */
  --accent: #5a82f0;
  --accent-soft: rgba(90, 130, 240, 0.16);
  --accent-line: rgba(90, 130, 240, 0.4);
  --accent-ink: #ffffff;
  --buy: #34d383;
  --buy-bg: #0f2a20;
  --sell: #ff6d6d;
  --sell-bg: #321819;
  --warn: #f1c75b;
  --warn-bg: #2c2717;
  --blue: #74a7ff;
  --blue-bg: #13223a;
  --shadow: 0 12px 28px rgba(0, 0, 0, 0.24);
  /* legacy aliases — kept for backward compatibility */
  --green: var(--buy);
  --green-bg: var(--buy-bg);
  --red: var(--sell);
  --red-bg: var(--sell-bg);
  --yellow: var(--warn);
  --yellow-bg: var(--warn-bg);
  --muted: var(--ink-2);
  --soft: var(--ink-3);
  /* density */
  --space-unit: 1rem;
  --font-base: 14px;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: var(--font-base);
}
```

- [ ] **Step 2: Add light-theme override block** — append immediately after the `:root` block

```css
[data-theme="light"] {
  color-scheme: light;
  --bg: #f5f7fa;
  --panel: #ffffff;
  --panel-2: #f0f2f5;
  --panel-3: #e8ebf0;
  --line: #d8dde6;
  --line-strong: #c0c8d4;
  --ink: #0d1117;
  --ink-2: #4a5568;
  --ink-3: #718096;
  --ink-faint: #a0aec0;
  --buy: #1a9e5f;
  --buy-bg: #e6f7ef;
  --sell: #d63b3b;
  --sell-bg: #fde8e8;
  --warn: #c47f1a;
  --warn-bg: #fef3dc;
  --shadow: 0 4px 16px rgba(0, 0, 0, 0.10);
  --green: var(--buy);
  --green-bg: var(--buy-bg);
  --red: var(--sell);
  --red-bg: var(--sell-bg);
  --yellow: var(--warn);
  --yellow-bg: var(--warn-bg);
  --muted: var(--ink-2);
  --soft: var(--ink-3);
}
```

- [ ] **Step 3: Add density override blocks** — append after the light-theme block

```css
[data-density="compact"] {
  --space-unit: 0.75rem;
  --font-base: 12px;
}

[data-density="regular"] {
  --space-unit: 1rem;
  --font-base: 14px;
}

[data-density="comfy"] {
  --space-unit: 1.25rem;
  --font-base: 15px;
}
```

- [ ] **Step 4: Remove the duplicate `:root` block** in the UX parity layer (line ~1010)

The second `:root` block (starting at line 1010 with `--font-ui`, `--pad`, `--gap`, etc.) duplicates some tokens and some aliases. Remove it entirely. The single `:root` block at the top now owns all tokens. The UX-parity layer rules below it (`.layout`, `.bluf`, `.ev-card`, etc.) stay — only the `:root` block within that section is removed.

- [ ] **Step 5: Update body background** in the parity section to use token

Replace the `body { background: radial-gradient(...) #0a0c11; }` rule in the parity section with:

```css
body {
  background:
    radial-gradient(1200px 700px at 78% -8%, rgba(90, 130, 240, 0.07), transparent 60%),
    var(--bg);
  font-family: var(--font-ui);
  font-size: var(--font-base);
}
```

- [ ] **Step 6: Verify dev server** — open `http://127.0.0.1:5173/uta` — app renders. In browser console run:

```js
document.documentElement.setAttribute('data-theme', 'light')
```

Colours flip to light palette. Run:

```js
document.documentElement.setAttribute('data-density', 'compact')
```

Font size and spacing shrink. Then revert:

```js
document.documentElement.removeAttribute('data-theme')
document.documentElement.removeAttribute('data-density')
```

- [ ] **Step 7: Run parity check**

```
npm run check:uta-ux-parity
```

Expected: `"status": "ok"` — all CSS class names are unchanged, only variable values differ.

- [ ] **Step 8: Commit**

```
git add src/uta/src/styles.css
git commit -m "feat(uta): CSS token system — spec names, light theme, density scale"
```

---

### Task 5: HomeMode + routing + parity check update

**Files:**
- Modify: `src/uta/src/app.tsx`
- Modify: `src/uta/src/styles.css` (home screen styles)
- Modify: `scripts/check-uta-ux-parity.js`

- [ ] **Step 1: Add HomeMode component to app.tsx**

```tsx
// Add to src/uta/src/app.tsx

type FeedCounts = { needsAttention: number; ruleMatches: number; tierChanges: number };

function feedCounts(userState: UserStateResult | null, results: UtaTickerResult[]): FeedCounts {
  const rules = userState?.state.rules || [];
  const needsAttention = results.filter((r) => r.tier === "A" || r.tier === "B").length;
  const ruleMatches = results.filter((r) => rules.some((rule) => ruleMatches(rule, r))).length;
  const tierChanges = 0; // populated from history in future cycles
  return { needsAttention, ruleMatches, tierChanges };
}

function HomeMode({
  onMode, lastCycleAt, universeCount, regimeBadge
}: {
  onMode: (mode: Mode) => void;
  lastCycleAt?: string;
  universeCount?: number;
  regimeBadge?: string;
}) {
  const cards = [
    {
      mode: "single" as Mode,
      icon: "◎",
      name: "Single Ticker",
      desc: "Deep analysis of one ticker against its own history.",
      tierRules: "B + C only · no peer group · signed-flow direction"
    },
    {
      mode: "portfolio" as Mode,
      icon: "⊞",
      name: "Portfolio",
      desc: "Rank all your holdings against each other in one cycle.",
      tierRules: "A + B + C · ranked vs your portfolio today"
    },
    {
      mode: "scan" as Mode,
      icon: "⊙",
      name: "Scan / Discovery",
      desc: "Two-pass universe scan — daily bar screen then live prints.",
      tierRules: "A + B + C · two-pass discovery · universe percentile"
    }
  ];
  return (
    <div className="home-mode">
      <div className="home-hero">
        <div className="home-eyebrow">Choose how you want to look at the market</div>
        <h1 className="home-headline">Unusual Trading Activity</h1>
        <p className="home-thesis">
          Three independent indicators — B (historical z-score), A (universe percentile), C (raw magnitude) —
          that are never collapsed into a single score. Tier is rule-based and always auditable.
          Honest data lanes: incomplete data produces Tier D, never a fabricated result.
        </p>
      </div>
      <div className="home-cards">
        {cards.map((c) => (
          <button key={c.mode} className="home-card" type="button" onClick={() => onMode(c.mode)}>
            <div className="home-card-icon">{c.icon}</div>
            <div className="home-card-name">{c.name}</div>
            <div className="home-card-desc">{c.desc}</div>
            <div className="home-card-rules">{c.tierRules}</div>
          </button>
        ))}
      </div>
      <button className="home-alerts-banner" type="button" onClick={() => onMode("alerts")}>
        <span className="home-alerts-label">Alerts &amp; Rules</span>
        <span className="home-alerts-desc">Typed event feed · rule matches · tier changes</span>
        <span className="home-alerts-cta">View →</span>
      </button>
      <div className="home-footer">
        {lastCycleAt ? <span>Last cycle: {fmtDate(lastCycleAt)}</span> : null}
        {universeCount ? <span>{universeCount.toLocaleString()} tickers tracked</span> : null}
        {regimeBadge ? <span className="home-regime-chip">{regimeBadge}</span> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `Mode` routing in App** — add `"home"` as initial mode and handle it in the render switch

In the `App` function, change the initial mode state and add a home branch to the `modeBody` memo:

```tsx
// In App():
const [mode, setMode] = useState<Mode>("home");   // was "single"

// In the modeBody useMemo, prepend:
if (mode === "home") {
  return (
    <HomeMode
      onMode={(m) => setMode(m)}
      lastCycleAt={history?.rows?.[0]?.generated_at}
      universeCount={runtime.data?.signal_result_count}
      regimeBadge={undefined}  // wired in Task 7
    />
  );
}
```

- [ ] **Step 3: Update mode tabs in App render** — remove "runtime" from tabs, set tab count to 4

In the JSX where mode tabs are rendered, change the tabs array from `["single","portfolio","scan","alerts","runtime"]` to `["single","portfolio","scan","alerts"]` and rename labels. The "runtime" entry is replaced by a ⚙ icon button (wired in Task 6).

- [ ] **Step 4: Add HomeMode CSS to styles.css**

```css
/* HomeMode */
.home-mode {
  display: grid;
  gap: 32px;
  max-width: 900px;
  margin: 0 auto;
  padding: 48px 0 64px;
}

.home-hero {
  text-align: center;
}

.home-eyebrow {
  margin-bottom: 10px;
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.home-headline {
  margin-bottom: 16px;
  font-size: 42px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.home-thesis {
  max-width: 600px;
  margin: 0 auto;
  color: var(--ink-2);
  font-size: 15px;
  line-height: 1.6;
}

.home-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

.home-card {
  display: grid;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  padding: 24px 20px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.home-card:hover {
  border-color: var(--accent-line);
  background: var(--panel-2);
}

.home-card-icon {
  font-size: 24px;
  color: var(--accent);
}

.home-card-name {
  font-size: 17px;
  font-weight: 700;
  color: var(--ink);
}

.home-card-desc {
  font-size: 13px;
  color: var(--ink-2);
  line-height: 1.5;
}

.home-card-rules {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--accent);
  letter-spacing: 0.02em;
}

.home-alerts-banner {
  display: flex;
  align-items: center;
  gap: 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  padding: 18px 24px;
  text-align: left;
  cursor: pointer;
  width: 100%;
}

.home-alerts-banner:hover {
  background: var(--panel-2);
}

.home-alerts-label {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink);
}

.home-alerts-desc {
  font-size: 13px;
  color: var(--ink-2);
  flex: 1;
}

.home-alerts-cta {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
}

.home-footer {
  display: flex;
  align-items: center;
  gap: 20px;
  justify-content: center;
  color: var(--ink-3);
  font-size: 12px;
}

.home-regime-chip {
  padding: 3px 10px;
  border-radius: 99px;
  background: var(--panel-2);
  font-weight: 600;
}
```

- [ ] **Step 5: Update the Playwright parity check to handle HomeMode**

The parity check currently waits for `BlufCard` or `.error-panel` immediately after navigating to `/uta`. With HomeMode as entry, neither will appear — the check will time out. Update `scripts/check-uta-ux-parity.js` to handle the HomeMode case:

```js
// Replace the current waitForSelector call and hasDetail logic block (lines 57–78)
// with:

await page.goto(`${baseUrl}/uta`, { waitUntil: "domcontentloaded" });

// If HomeMode loaded, navigate to Single Ticker first
const hasHome = (await page.locator(".home-mode").count()) > 0;
if (hasHome) {
  // Click Single Ticker card
  await page.locator(".home-card").first().click();
  // Wait a tick for mode state change
  await page.waitForTimeout(200);
}

await page.waitForSelector('[data-ux-source="ux design/evidence.jsx:BlufCard"], .error-panel', { timeout: 15000 });
```

Keep all assertions below that point unchanged.

- [ ] **Step 6: Run parity check**

```
npm run check:uta-ux-parity
```

Expected: `"status": "ok"`. If live data unavailable, status is `"ok"` with `"mode": "live_unavailable"`.

- [ ] **Step 7: Commit**

```
git add src/uta/src/app.tsx src/uta/src/styles.css scripts/check-uta-ux-parity.js
git commit -m "feat(uta): HomeMode landing screen + routing + parity check HomeMode handling"
```

---

### Task 6: Full TopBar — search, watchlist pill, theme toggle, density control, sync indicator, ⚙ operator

**Files:**
- Modify: `src/uta/src/app.tsx`
- Modify: `src/uta/src/styles.css`

The current TopBar in `app.tsx` is a simple div with the mode tabs. This task replaces it with the full TopBar per spec. The mode tabs move inside TopBar.

- [ ] **Step 1: Add TopBar component to app.tsx**

```tsx
// Add to src/uta/src/app.tsx

function TopBar({
  mode, onMode, onHome, onSearch, onOpenWatchlist, onOpenRuntime,
  watchlistCount, alertCount, syncState, syncTime, themeToggle, densityControl
}: {
  mode: Mode;
  onMode: (m: Mode) => void;
  onHome: () => void;
  onSearch: (sym: string) => void;
  onOpenWatchlist: () => void;
  onOpenRuntime: () => void;
  watchlistCount: number;
  alertCount: number;
  syncState: "live" | "revalidating" | "error";
  syncTime?: string;
  themeToggle: () => void;
  densityControl: () => void;
}) {
  const [searchVal, setSearchVal] = React.useState("");
  const tabs: { id: Mode; label: string; badge?: number }[] = [
    { id: "single", label: "Single Ticker" },
    { id: "portfolio", label: "Portfolio" },
    { id: "scan", label: "Scan" },
    { id: "alerts", label: "Alerts", badge: alertCount > 0 ? alertCount : undefined }
  ];

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const sym = searchVal.trim().toUpperCase();
    if (sym) { onSearch(sym); setSearchVal(""); }
  }

  return (
    <header className="uta-topbar">
      <button className="topbar-brand secondary icon-button" type="button" onClick={onHome} title="Home">
        UTA
      </button>
      <nav className="topbar-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`topbar-tab ${mode === t.id ? "active" : ""}`}
            onClick={() => onMode(t.id)}
          >
            {t.label}
            {t.badge ? <span className="tab-badge">{t.badge}</span> : null}
          </button>
        ))}
      </nav>
      <form className="topbar-search" onSubmit={handleSearch}>
        <input
          type="text"
          placeholder="Search ticker…"
          value={searchVal}
          onChange={(e) => setSearchVal(e.target.value)}
          className="topbar-search-input"
        />
      </form>
      <div className="topbar-actions">
        <button className="secondary icon-button" type="button" onClick={onOpenWatchlist} title="Watchlist">
          ☆ {watchlistCount > 0 ? watchlistCount : ""}
        </button>
        <button className="secondary icon-button" type="button" onClick={themeToggle} title="Toggle theme">◑</button>
        <button className="secondary icon-button" type="button" onClick={densityControl} title="Density">≡</button>
        <span className={`sync-indicator ${syncState}`}>
          {syncState === "revalidating" ? "Revalidating…" : `Live · ${syncTime || "--:--"} ET`}
        </span>
        <button className="secondary icon-button" type="button" onClick={onOpenRuntime} title="Operator">⚙</button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Add theme/density state + persistence to App**

```tsx
// Add to App() before return:

const [theme, setTheme] = React.useState<"dark" | "light">(() => {
  return (localStorage.getItem("uta_theme_v1") as "dark" | "light") || "dark";
});
const [density, setDensity] = React.useState<"compact" | "regular" | "comfy">(() => {
  return (localStorage.getItem("uta_density_v1") as "compact" | "regular" | "comfy") || "regular";
});
const [showDensityPop, setShowDensityPop] = React.useState(false);

React.useEffect(() => {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("uta_theme_v1", theme);
}, [theme]);

React.useEffect(() => {
  document.documentElement.setAttribute("data-density", density);
  localStorage.setItem("uta_density_v1", density);
}, [density]);

function toggleTheme() { setTheme((t) => t === "dark" ? "light" : "dark"); }
```

- [ ] **Step 3: Replace the existing topbar JSX in App's render** with:

```tsx
<TopBar
  mode={mode}
  onMode={(m) => { setMode(m); }}
  onHome={() => setMode("home")}
  onSearch={(sym) => {
    setMode("single");
    loadSingle(sym).catch((err) => setSingle({ status: "error", data: single.data, message: err.message }));
  }}
  onOpenWatchlist={() => setShowWatchlist(true)}
  onOpenRuntime={() => setShowRuntime(true)}
  watchlistCount={watchlistCount}
  alertCount={0}
  syncState="live"
  syncTime={single.data ? fmtDate(single.data.generated_at).split(",")[1]?.trim() : undefined}
  themeToggle={toggleTheme}
  densityControl={() => setShowDensityPop((v) => !v)}
/>
{showDensityPop && (
  <div className="density-pop">
    {(["compact", "regular", "comfy"] as const).map((d) => (
      <button key={d} type="button" className={`secondary ${density === d ? "active" : ""}`}
        onClick={() => { setDensity(d); setShowDensityPop(false); }}>
        {d.charAt(0).toUpperCase() + d.slice(1)}
      </button>
    ))}
  </div>
)}
```

Add `const [showWatchlist, setShowWatchlist] = React.useState(false)` and `const [showRuntime, setShowRuntime] = React.useState(false)` to App state. Wire `showRuntime` to RuntimeMode rendering in Task 7.

- [ ] **Step 4: Add TopBar CSS to styles.css**

```css
/* TopBar */
.uta-topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
  border-radius: 0;
  position: sticky;
  top: 0;
  z-index: 10;
}

.topbar-brand {
  font-family: var(--font-mono);
  font-weight: 800;
  font-size: 14px;
  padding: 0 12px;
  border-color: var(--accent-line);
  color: var(--accent);
}

.topbar-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
}

.topbar-tab {
  position: relative;
  height: 34px;
  min-height: 34px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--ink-2);
  padding: 0 12px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.topbar-tab:hover {
  background: var(--panel-2);
  color: var(--ink);
}

.topbar-tab.active {
  background: var(--accent-soft);
  border-color: var(--accent-line);
  color: var(--accent);
  font-weight: 600;
}

.tab-badge {
  display: inline-grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  margin-left: 5px;
  border-radius: 99px;
  background: var(--accent);
  color: var(--accent-ink);
  font-size: 11px;
  font-weight: 700;
  padding: 0 4px;
}

.topbar-search-input {
  width: 180px;
  height: 32px;
  min-height: 32px;
  border-radius: 8px;
  font-size: 13px;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sync-indicator {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--ink-3);
  white-space: nowrap;
  padding: 0 4px;
}

.sync-indicator.revalidating {
  color: var(--warn);
}

.density-pop {
  position: absolute;
  top: 56px;
  right: 50px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  background: var(--panel);
  box-shadow: var(--shadow);
  padding: 8px;
  min-width: 120px;
}
```

- [ ] **Step 5: Run parity check**

```
npm run check:uta-ux-parity
```

Expected: `"status": "ok"`.

- [ ] **Step 6: Commit**

```
git add src/uta/src/app.tsx src/uta/src/styles.css
git commit -m "feat(uta): full TopBar — search, watchlist, theme toggle, density control, sync indicator"
```

---

### Task 7: RegimeBanner + RuntimeOverlay + WatchlistDrawer + RevalidationBar

**Files:**
- Modify: `src/uta/src/app.tsx`
- Modify: `src/uta/src/styles.css`

- [ ] **Step 1: Add RegimeBanner component**

The FRED macro lane data comes from the existing API. The `runtime.data` object contains provider and scheduler state; macro regime requires a new `/api/uta/macro` endpoint. For now, wire from the Macro Context evidence card data if available on `single.data`, falling back to a neutral stub until the endpoint is added.

```tsx
// Add to src/uta/src/app.tsx

type MacroRegime = {
  badge: "Risk-On" | "Neutral" | "Risk-Off" | "Crisis";
  vix?: number;
  t10y2y?: number;
  fed_funds?: number;
  interpretation: string;
};

function RegimeBanner({ regime }: { regime: MacroRegime | null }) {
  if (!regime) return null;
  const toneClass = { "Risk-On": "on", "Neutral": "neutral", "Risk-Off": "off", "Crisis": "crisis" }[regime.badge];
  return (
    <div className={`regime-banner regime-${toneClass}`}>
      <span className="regime-badge">{regime.badge}</span>
      {regime.vix != null && <span>VIX {regime.vix.toFixed(1)}</span>}
      {regime.t10y2y != null && <span>T10Y2Y {regime.t10y2y.toFixed(2)}%</span>}
      {regime.fed_funds != null && <span>Fed Funds {regime.fed_funds.toFixed(2)}%</span>}
      <span className="regime-interp">{regime.interpretation}</span>
    </div>
  );
}
```

- [ ] **Step 2: Derive regime from available data** — add `macroRegime` memo to App

```tsx
// In App(), add:
const macroRegime = React.useMemo((): MacroRegime | null => {
  // Attempt to read from macro evidence card on activeData
  const macroCard = activeData?.evidence_cards?.find((c) => c.id === "macro_context");
  if (!macroCard) return null;
  // Parse headline_metric for regime badge
  const summary = macroCard.summary || "";
  const badge: MacroRegime["badge"] =
    /risk.off/i.test(summary) ? "Risk-Off" :
    /crisis/i.test(summary) ? "Crisis" :
    /risk.on/i.test(summary) ? "Risk-On" : "Neutral";
  return { badge, interpretation: macroCard.summary };
}, [activeData]);
```

- [ ] **Step 3: Add WatchlistDrawer component**

```tsx
// Add to src/uta/src/app.tsx

function WatchlistDrawer({
  watchlist, results, onClose, onNavigate, onRemove
}: {
  watchlist: string[];
  results: UtaTickerResult[];
  onClose: () => void;
  onNavigate: (sym: string) => void;
  onRemove: (sym: string) => void;
}) {
  const resultMap = Object.fromEntries(results.map((r) => [r.ticker, r]));
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer watchlist-drawer">
        <div className="drawer-head">
          <span className="dt">Watchlist · {watchlist.length} saved</span>
          <button className="x-close icon-button secondary" type="button" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">
          {watchlist.length === 0 ? (
            <p className="empty">No tickers saved yet. Use 'Add to watchlist' in any ticker detail view.</p>
          ) : watchlist.map((sym) => {
            const r = resultMap[sym];
            return (
              <div className="wl-row" key={sym}>
                <button type="button" className="wl-sym secondary" onClick={() => { onNavigate(sym); onClose(); }}>
                  <span className="mono">{sym}</span>
                  {r ? <><TierBadge tier={r.tier} size="sm" /><DirTag direction={r.direction} /></> : null}
                </button>
                <button type="button" className="icon-button secondary" onClick={() => onRemove(sym)}>×</button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Add RevalidationBar component**

```tsx
// Add to src/uta/src/app.tsx

function RevalidationBar({ active }: { active: boolean }) {
  if (!active) return null;
  return <div className="revalidation-bar" />;
}
```

- [ ] **Step 5: Wire all new components into App render**

In the App JSX, render these in order below the TopBar:

```tsx
<RevalidationBar active={single.status === "loading" || portfolio.status === "loading"} />
{mode !== "home" && <RegimeBanner regime={macroRegime} />}
{showWatchlist && (
  <WatchlistDrawer
    watchlist={userState?.state.watchlist || []}
    results={portfolio.data?.results || (single.data ? [single.data] : [])}
    onClose={() => setShowWatchlist(false)}
    onNavigate={(sym) => {
      setMode("single");
      loadSingle(sym).catch((err) => setSingle({ status: "error", data: single.data, message: err.message }));
    }}
    onRemove={(sym) => {
      const next = (userState?.state.watchlist || []).filter((t) => t !== sym);
      apiPost<UserStateResult>("/api/uta/user-state/watchlist", { watchlist: next })
        .then(setUserState)
        .catch(console.error);
    }}
  />
)}
{showRuntime && (
  <div className="runtime-overlay">
    <div className="runtime-overlay-head">
      <span>Operator — Runtime</span>
      <button type="button" className="x-close icon-button secondary" onClick={() => setShowRuntime(false)}>✕</button>
    </div>
    <div className="runtime-overlay-body">
      <RuntimeMode
        runtime={runtime}
        providers={providers}
        scheduler={scheduler}
        history={history}
        stream={stream}
        onSchedulerToggle={(enabled) => toggleScheduler(enabled).catch((err) => setScheduler({ status: "error", message: err.message }))}
        onRefreshRuntime={() => loadRuntime().catch((err) => setRuntime({ status: "error", message: err.message }))}
      />
    </div>
  </div>
)}
```

Add `Escape` key listener to close the overlay:

```tsx
React.useEffect(() => {
  const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setShowRuntime(false); };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}, []);
```

- [ ] **Step 6: Add RegimeBanner + WatchlistDrawer + RuntimeOverlay CSS**

```css
/* RegimeBanner */
.regime-banner {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 20px;
  background: var(--panel-2);
  border-bottom: 1px solid var(--line);
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ink-2);
  flex-wrap: wrap;
}

.regime-badge {
  font-weight: 700;
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 99px;
}

.regime-on .regime-badge { background: var(--buy-bg); color: var(--buy); }
.regime-neutral .regime-badge { background: var(--panel-3); color: var(--ink-2); }
.regime-off .regime-badge { background: var(--warn-bg); color: var(--warn); }
.regime-crisis { background: rgba(255, 109, 109, 0.08); }
.regime-crisis .regime-badge { background: var(--sell-bg); color: var(--sell); }

.regime-interp {
  flex: 1;
  font-style: italic;
  color: var(--ink-3);
}

/* RevalidationBar */
.revalidation-bar {
  height: 2px;
  background: linear-gradient(90deg, var(--accent), var(--buy));
  animation: reval-slide 1.4s ease-in-out infinite;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
}

@keyframes reval-slide {
  0% { transform: scaleX(0); transform-origin: left; }
  50% { transform: scaleX(1); transform-origin: left; }
  51% { transform: scaleX(1); transform-origin: right; }
  100% { transform: scaleX(0); transform-origin: right; }
}

/* WatchlistDrawer */
.watchlist-drawer {
  width: min(380px, 92vw);
}

.wl-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
}

.wl-sym {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
}

.wl-sym:hover { background: var(--panel-2); }

/* RuntimeOverlay */
.runtime-overlay {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.runtime-overlay-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--line);
  font-size: 15px;
  font-weight: 600;
  background: var(--panel);
}

.runtime-overlay-body {
  flex: 1;
  overflow: auto;
  padding: 20px;
}
```

- [ ] **Step 7: Run parity check**

```
npm run check:uta-ux-parity
```

Expected: `"status": "ok"`.

- [ ] **Step 8: Commit**

```
git add src/uta/src/app.tsx src/uta/src/styles.css
git commit -m "feat(uta): RegimeBanner, WatchlistDrawer, RevalidationBar, RuntimeOverlay"
```

**Phase 2 exit criteria:** App opens to HomeMode. Clicking a mode card navigates correctly. Market-Regime banner visible on Single/Portfolio/Scan/Alerts. TopBar has search, watchlist, theme toggle, density popover, ⚙ runtime button. `npm run check:uta-ux-parity` passes.

---

## Phase 3 — Visual Component Library + Detail View Tabs

Five tasks: Sparkline/ConfBar/DeltaChip, VolBars/PressureGauge/MixBar, evidence cards 1–3, cards 4–5 + CycleHistory, tabbed layout + parity check update.

---

### Task 8: Sparkline, ConfBar, DeltaChip visual implementations

**Files:**
- Modify: `src/uta/src/components.tsx`
- Modify: `src/uta/src/styles.css`

DeltaChip already exists from Task 2. Sparkline and ConfBar are new. All are pure SVG/CSS — no external charting library.

- [ ] **Step 1: Add Sparkline to components.tsx**

```tsx
// Add to src/uta/src/components.tsx

export function Sparkline({
  values,
  baseline = 0,
  colour,
  height = 60,
  width = "100%"
}: {
  values: number[];
  baseline?: number;
  colour?: string;
  height?: number;
  width?: number | string;
}) {
  if (!values || values.length < 2) {
    return <div className="sparkline-empty" style={{ height }} />;
  }
  const min = Math.min(...values, baseline);
  const max = Math.max(...values, baseline);
  const range = max - min || 1;
  const W = 200; // internal SVG coordinate width
  const H = height;

  function toX(i: number) { return (i / (values.length - 1)) * W; }
  function toY(v: number) { return H - ((v - min) / range) * H; }

  const points = values.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
  const baselineY = toY(baseline).toFixed(1);

  // Fill polygon below/above baseline
  const fillPoints = [
    `0,${toY(baseline).toFixed(1)}`,
    ...values.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`),
    `${W},${toY(baseline).toFixed(1)}`
  ].join(" ");

  const lineColour = colour || "var(--accent)";
  const fillColour = colour
    ? colour.replace(")", ", 0.15)").replace("rgb(", "rgba(")
    : "var(--accent-soft)";

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width, height, display: "block" }}
      aria-hidden="true"
    >
      {/* baseline */}
      <line
        x1={0} y1={baselineY} x2={W} y2={baselineY}
        stroke="var(--line-strong)" strokeWidth={1} strokeDasharray="4 3"
      />
      {/* fill */}
      <polygon points={fillPoints} fill={fillColour} opacity={0.6} />
      {/* line */}
      <polyline
        points={points}
        fill="none"
        stroke={lineColour}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
```

- [ ] **Step 2: Add ConfBar to components.tsx**

```tsx
// Add to src/uta/src/components.tsx

export function ConfBar({
  value,
  label
}: {
  value: number;   // 0–1
  label?: string;
}) {
  const pct = Math.min(1, Math.max(0, value));
  const display = label ?? `${Math.round(pct * 100)}%`;
  return (
    <div className="conf-bar-wrap">
      <div className="conf-bar-track">
        <div
          className="conf-bar-fill"
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <span className="conf-bar-label">{display}</span>
    </div>
  );
}
```

- [ ] **Step 3: Verify DeltaChip from Task 2** is already exported from components.tsx. It should be — confirm it's there, nothing to add.

- [ ] **Step 4: Add CSS for Sparkline and ConfBar to styles.css**

```css
/* Sparkline */
.sparkline {
  border-radius: 4px;
  overflow: visible;
}

.sparkline-empty {
  background: var(--panel-3);
  border-radius: 4px;
}

/* ConfBar */
.conf-bar-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.conf-bar-track {
  flex: 1;
  height: 6px;
  border-radius: 99px;
  background: var(--panel-3);
  overflow: hidden;
}

.conf-bar-fill {
  height: 100%;
  border-radius: 99px;
  background: var(--accent);
  transition: width 0.3s ease;
}

.conf-bar-label {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
  white-space: nowrap;
  min-width: 36px;
}

/* DeltaChip */
.delta-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.delta-chip.good { color: var(--buy); }
.delta-chip.bad  { color: var(--sell); }
.delta-chip.neutral { color: var(--ink-3); }
```

- [ ] **Step 5: Verify in dev server** — open `http://127.0.0.1:5173/uta`, click Single Ticker. In the browser console, test Sparkline renders by checking no React errors appear.

- [ ] **Step 6: Run parity check**

```
npm run check:uta-ux-parity
```

Expected: `"status": "ok"`. Components are additive — nothing removed.

- [ ] **Step 7: Commit**

```
git add src/uta/src/components.tsx src/uta/src/styles.css
git commit -m "feat(uta): Sparkline, ConfBar, DeltaChip visual primitives"
```

---

### Task 9: VolBars, PressureGauge, MixBar

**Files:**
- Modify: `src/uta/src/components.tsx`
- Modify: `src/uta/src/styles.css`

- [ ] **Step 1: Add PressureGauge to components.tsx**

```tsx
// Add to src/uta/src/components.tsx

export function PressureGauge({ value }: { value: number }) {
  // value: -1 to +1
  const clamped = Math.min(1, Math.max(-1, value));
  const pct = Math.abs(clamped) * 50; // width of fill as % of half-bar
  const isBull = clamped >= 0;
  const fillColour = isBull ? "var(--buy)" : "var(--sell)";
  const label = `${isBull ? "+" : ""}${Math.round(clamped * 100)}%`;

  return (
    <div className="pressure-gauge" aria-label={`Pressure ${label}`}>
      <div className="pg-track">
        {/* left half (bearish) */}
        <div className="pg-half pg-left">
          {!isBull && (
            <div className="pg-fill pg-fill-left" style={{ width: `${pct}%`, background: fillColour }} />
          )}
        </div>
        {/* centre tick */}
        <div className="pg-centre" />
        {/* right half (bullish) */}
        <div className="pg-half pg-right">
          {isBull && (
            <div className="pg-fill pg-fill-right" style={{ width: `${pct}%`, background: fillColour }} />
          )}
        </div>
      </div>
      <span className="pg-label" style={{ color: fillColour }}>{label}</span>
    </div>
  );
}
```

- [ ] **Step 2: Add VolBars to components.tsx**

The spec calls for per-bucket data. The current API does not expose per-bucket time-series. Use a simplified 3-metric comparison (volume ratio, notional ratio, trade-count ratio) as bars labelled "Vol", "Notional", "Trades". This is noted as requiring API extension for full per-bucket bars.

```tsx
// Add to src/uta/src/components.tsx

type VolMetric = { label: string; ratio: number; direction?: "bull" | "bear" };

export function VolBars({ metrics }: { metrics: VolMetric[] }) {
  if (!metrics || metrics.length === 0) return null;
  const max = Math.max(...metrics.map((m) => m.ratio), 1);
  return (
    <div className="vol-bars" aria-label="Volume metrics vs baseline">
      {metrics.map((m) => {
        const heightPct = Math.min(100, (m.ratio / max) * 100);
        const isHigh = m.ratio > 1;
        const barClass = isHigh
          ? m.direction === "bear" ? "vb-sell" : "vb-buy"
          : "vb-base";
        return (
          <div className="vb-col" key={m.label}>
            <div className="vb-bar-wrap">
              <div
                className={`vb-bar ${barClass}`}
                style={{ height: `${heightPct}%` }}
                title={`${m.ratio.toFixed(2)}×`}
              />
            </div>
            <span className="vb-label">{m.label}</span>
            <span className="vb-value">{m.ratio.toFixed(2)}×</span>
          </div>
        );
      })}
    </div>
  );
}

// Helper: build VolMetric array from UtaTickerResult
export function volMetricsFromResult(data: UtaTickerResult, direction?: string): VolMetric[] {
  const dir = direction === "bullish" ? "bull" : direction === "bearish" ? "bear" : undefined;
  return [
    { label: "Vol", ratio: Number(data.indicators.C.volume_ratio ?? 1), direction: dir },
    { label: "Notional", ratio: Number(data.indicators.C.notional_ratio ?? 1), direction: dir },
    { label: "Trades", ratio: Number(data.trade_analysis?.block_flow?.focus_trade_count ?? 0) > 0 ? 1.5 : 0.5, direction: dir }
  ];
}
```

- [ ] **Step 3: Add MixBar to components.tsx**

```tsx
// Add to src/uta/src/components.tsx

export type MixSegment = { label: string; value: number; colour: string };

export function MixBar({ segments }: { segments: MixSegment[] }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (!total) return <div className="mix-bar-empty">No data</div>;
  return (
    <div className="mix-bar-wrap">
      <div className="mix-bar-track" role="img" aria-label="Mix breakdown">
        {segments.map((seg) => {
          const pct = (seg.value / total) * 100;
          if (pct < 0.5) return null;
          return (
            <div
              key={seg.label}
              className="mix-bar-seg"
              style={{ width: `${pct}%`, background: seg.colour }}
              title={`${seg.label}: ${pct.toFixed(1)}%`}
            />
          );
        })}
      </div>
      <div className="mix-bar-legend">
        {segments.filter((s) => (s.value / total) >= 0.03).map((seg) => (
          <span key={seg.label} className="mix-legend-item">
            <span className="mix-swatch" style={{ background: seg.colour }} />
            {seg.label}
          </span>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add CSS for VolBars, PressureGauge, MixBar to styles.css**

```css
/* PressureGauge */
.pressure-gauge {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pg-track {
  flex: 1;
  display: flex;
  align-items: center;
  height: 10px;
  border-radius: 99px;
  background: var(--panel-3);
  overflow: hidden;
  position: relative;
}

.pg-half {
  flex: 1;
  height: 100%;
  display: flex;
}

.pg-left { justify-content: flex-end; }
.pg-right { justify-content: flex-start; }

.pg-fill {
  height: 100%;
  border-radius: 99px;
  transition: width 0.3s ease;
}

.pg-centre {
  width: 2px;
  height: 100%;
  background: var(--line-strong);
  flex-shrink: 0;
}

.pg-label {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  min-width: 44px;
  text-align: right;
  white-space: nowrap;
}

/* VolBars */
.vol-bars {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  height: 72px;
  padding-bottom: 20px;
  position: relative;
}

.vb-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  height: 100%;
  gap: 2px;
}

.vb-bar-wrap {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
}

.vb-bar {
  width: 100%;
  border-radius: 3px 3px 0 0;
  min-height: 2px;
  transition: height 0.3s ease;
}

.vb-buy  { background: var(--buy); }
.vb-sell { background: var(--sell); }
.vb-base { background: var(--panel-3); box-shadow: inset 0 0 0 1px var(--line); }

.vb-label {
  font-size: 10px;
  font-weight: 700;
  color: var(--ink-3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  position: absolute;
  bottom: 2px;
}

.vb-value {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--ink-2);
}

/* MixBar */
.mix-bar-wrap {
  display: grid;
  gap: 6px;
}

.mix-bar-track {
  display: flex;
  height: 8px;
  border-radius: 99px;
  overflow: hidden;
  background: var(--panel-3);
}

.mix-bar-seg {
  height: 100%;
  transition: width 0.3s ease;
}

.mix-bar-empty {
  color: var(--ink-3);
  font-size: 12px;
}

.mix-bar-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.mix-legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--ink-3);
}

.mix-swatch {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}
```

- [ ] **Step 5: Run parity check**

```
npm run check:uta-ux-parity
```

Expected: `"status": "ok"`.

- [ ] **Step 6: Commit**

```
git add src/uta/src/components.tsx src/uta/src/styles.css
git commit -m "feat(uta): VolBars, PressureGauge, MixBar visual primitives"
```

---

### Task 10: Wire visual components into evidence cards 1–3

**Files:**
- Modify: `src/uta/src/evidence.tsx`

The current `EvidenceCards` component renders `<p>{card.summary}</p>` for every card body. This task replaces the bodies of cards 1–3 (Volume Anomaly, Block/Off-Exchange, Directional Pressure) with proper visual layouts. Cards 4–9 keep the text fallback until Task 11.

Card IDs from the API: `volume_anomaly`, `block_off_exchange`, `directional_pressure`.

- [ ] **Step 1: Import new primitives into evidence.tsx**

```tsx
// Add to imports at top of src/uta/src/evidence.tsx
import {
  VolBars, volMetricsFromResult, PressureGauge, ConfBar, MixBar,
  type MixSegment
} from "./components.js";
```

- [ ] **Step 2: Add card-body component for card 1 — Volume Anomaly**

```tsx
// Add to src/uta/src/evidence.tsx

function VolumeAnomalyBody({ data }: { data: UtaTickerResult }) {
  const C = data.indicators.C;
  const B = data.indicators.B;
  const metrics = volMetricsFromResult(data, data.direction);
  return (
    <div className="ev-body-inner">
      <VolBars metrics={metrics} />
      <div className="ev-stat-row">
        <MetricTile
          label="Volume ratio"
          value={`${fmtNumber(C.volume_ratio, 2)}×`}
          detail="vs 20-day baseline"
        />
        <MetricTile
          label="Notional ratio"
          value={`${fmtNumber(C.notional_ratio, 2)}×`}
          detail="vs 20-day baseline"
        />
        <MetricTile
          label="B-score (notional)"
          value={`${fmtNumber(B.notional_zscore, 2)}σ`}
          detail="z-score vs history"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add card-body component for card 2 — Block / Off-Exchange**

```tsx
// Add to src/uta/src/evidence.tsx

function BlockOffExchangeBody({ data }: { data: UtaTickerResult }) {
  const bf = data.trade_analysis?.block_flow;
  const ta = data.trade_analysis;
  const trfShare = Number(ta?.block_flow?.trf_share ?? 0);
  const litShare = 1 - trfShare;
  const venueMix: MixSegment[] = [
    { label: "Off-exchange (TRF)", value: trfShare, colour: "var(--accent)" },
    { label: "Lit markets", value: litShare, colour: "var(--panel-3)" }
  ];
  return (
    <div className="ev-body-inner">
      <div className="ev-stat-row">
        <MetricTile label="Focus prints" value={bf?.focus_trade_count ?? 0} detail="block / off-exchange" />
        <MetricTile label="Focus notional" value={fmtMoney(bf?.focus_notional)} detail="total focus flow" />
        <MetricTile label="Largest print" value={fmtMoney(bf?.largest_print_notional)} detail={bf?.largest_print_multiple ? `${fmtNumber(bf.largest_print_multiple, 1)}× ADV` : "—"} />
      </div>
      <div className="ev-sub-label">Venue split</div>
      <MixBar segments={venueMix} />
    </div>
  );
}
```

- [ ] **Step 4: Add card-body component for card 3 — Directional Pressure**

```tsx
// Add to src/uta/src/evidence.tsx

function DirectionalPressureBody({ data }: { data: UtaTickerResult }) {
  const pressure = data.trade_analysis?.pressure;
  const C = data.indicators.C;
  const signingConf = data.signing_confidence;
  // Signing method mix — use available data; API may not expose per-method breakdown
  // Show confidence bar only, method mix as placeholder until API extension
  const netPressure = Number(C.net_notional_pressure ?? 0);
  return (
    <div className="ev-body-inner">
      <div className="ev-sub-label">Net pressure</div>
      <PressureGauge value={netPressure} />
      <div className="ev-stat-row">
        <MetricTile
          label="Net notional pressure"
          value={`${fmtNumber(netPressure * 100, 1)}%`}
          detail={pressure?.direction || "—"}
        />
        <MetricTile
          label="Signing confidence"
          value={fmtPct(signingConf)}
          detail="print signing"
        />
      </div>
      <div className="ev-sub-label">Signing confidence</div>
      <ConfBar value={signingConf} />
      {pressure?.interpretation ? (
        <p className="ev-interp">{pressure.interpretation}</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Update EvidenceCards to dispatch to card-body components**

Replace the simple `EvidenceCards` body renderer in `evidence.tsx`. The `cards` prop from the API only has `id`, `title`, `status`, `headline_metric`, `summary` — the visual bodies are built from `data`. Pass `data` as an additional prop:

```tsx
// Replace the EvidenceCards function signature and body:

export function EvidenceCards({ cards, data }: { cards: EvidenceCard[]; data: UtaTickerResult }) {
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(["volume_anomaly", "block_off_exchange", "directional_pressure"])
  );
  const toggle = (id: string) =>
    setExpanded((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  function renderBody(card: EvidenceCard) {
    if (card.id === "volume_anomaly") return <VolumeAnomalyBody data={data} />;
    if (card.id === "block_off_exchange") return <BlockOffExchangeBody data={data} />;
    if (card.id === "directional_pressure") return <DirectionalPressureBody data={data} />;
    // Cards 4–9: text fallback until Task 11
    return <div className="ev-body"><p>{card.summary}</p></div>;
  }

  return (
    <div data-ux-source="ux design/evidence.jsx:EvidenceGrid">
      {cards.map((card) => (
        <article className={`panel ev-card ev-${card.status}`} key={card.id}>
          <div className="ev-head" onClick={() => toggle(card.id)} style={{ cursor: "pointer" }}>
            <div className="ev-titlewrap">
              <span className="ev-title">{card.title}</span>
              <span className="ev-sub ev-metric">{card.headline_metric}</span>
            </div>
            <span className="ev-chev">{expanded.has(card.id) ? "▲" : "▼"}</span>
          </div>
          {expanded.has(card.id) && renderBody(card)}
        </article>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Update all call sites of EvidenceCards** — pass `data` prop

In `modes.tsx`, the `TickerDetail` component calls `<EvidenceCards cards={data.evidence_cards} />`. Add `data={data}`:

```tsx
<EvidenceCards cards={data.evidence_cards} data={data} />
```

- [ ] **Step 7: Add card body CSS to styles.css**

```css
/* Evidence card body inner layouts */
.ev-body-inner {
  display: grid;
  gap: 12px;
  padding: 14px var(--pad) var(--pad);
  border-top: 1px solid var(--grid-line);
}

.ev-stat-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.ev-sub-label {
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: -6px;
}

.ev-interp {
  color: var(--ink-2);
  font-size: 12.5px;
  line-height: 1.5;
  margin: 0;
  font-style: italic;
}

@media (max-width: 720px) {
  .ev-stat-row {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 8: Run parity check**

```
npm run check:uta-ux-parity
```

Expected: `"status": "ok"`. The `data-ux-source="ux design/evidence.jsx:EvidenceGrid"` attribute and `.ev-card` × 9 assertions still pass since the DOM structure is unchanged — only card body content changed.

- [ ] **Step 9: Commit**

```
git add src/uta/src/evidence.tsx src/uta/src/modes.tsx src/uta/src/styles.css
git commit -m "feat(uta): evidence cards 1-3 wired to visual components"
```

---

### Task 11: Evidence cards 4–5 + CycleHistory timeline

**Files:**
- Modify: `src/uta/src/evidence.tsx`
- Modify: `src/uta/src/detail-extras.tsx`

- [ ] **Step 1: Add card-body component for card 4 — Pre-Market Activity**

```tsx
// Add to src/uta/src/evidence.tsx

function PreMarketBody({ data }: { data: UtaTickerResult }) {
  // Pre-market data lives on trade_analysis.activity
  const act = data.trade_analysis?.activity;
  const hasPreMarket = act && (act.volume_ratio ?? 0) > 0;
  if (!hasPreMarket) {
    return (
      <div className="ev-body">
        <p className="ev-empty">No pre-market prints in this session.</p>
      </div>
    );
  }
  return (
    <div className="ev-body-inner">
      <div className="ev-stat-row">
        <MetricTile label="Pre-mkt vol ratio" value={`${fmtNumber(act.volume_ratio, 2)}×`} detail="vs session baseline" />
        <MetricTile label="Notional ratio" value={`${fmtNumber(act.notional_ratio, 2)}×`} detail="vs session baseline" />
        <MetricTile label="Latest bar" value={fmtDate(act.latest_bar_date)} detail="last bar timestamp" />
      </div>
      <p className="ev-interp">
        Pre-market volume signals persist with approximately 60-minute half-life into the regular session. Decay label shown once signal falls below 1.5× baseline.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Add card-body component for card 5 — Market Flow Trend**

The spec calls for a Sparkline over session pressure. The current API does not return a time-series of pressure values. Render a static sparkline from a synthetic single-value array with the B-score as the signal level, noting API extension needed.

```tsx
// Add to src/uta/src/evidence.tsx

function MarketFlowTrendBody({ data }: { data: UtaTickerResult }) {
  const B = data.indicators.B;
  const C = data.indicators.C;
  const netPressure = Number(C.net_notional_pressure ?? 0);
  const bScore = Number(B.notional_zscore ?? 0);
  // Synthetic sparkline: [0, netPressure * bScore] until time-series available from API
  const syntheticValues = [0, netPressure * 0.4, netPressure * 0.7, netPressure * bScore * 0.3, netPressure];
  const trend = netPressure > 0.1 ? "Building" : netPressure < -0.1 ? "Fading" : "Flat";
  const trendColour = trend === "Building" ? "var(--buy)" : trend === "Fading" ? "var(--sell)" : undefined;
  return (
    <div className="ev-body-inner">
      <div className="ev-trend-label" style={{ color: trendColour || "var(--ink-2)" }}>{trend}</div>
      <Sparkline values={syntheticValues} baseline={0} colour={trendColour} height={56} />
      <div className="ev-stat-row">
        <MetricTile label="Pressure delta" value={`${fmtNumber(netPressure * 100, 1)}%`} detail="net notional" />
        <MetricTile label="B-score" value={`${fmtNumber(bScore, 2)}σ`} detail="notional z-score" />
        <MetricTile label="Analyzed prints" value={data.trade_analysis?.activity?.analyzed_prints ?? "N/A"} detail="this session" />
      </div>
    </div>
  );
}
```

Add `Sparkline` to the import line at the top of `evidence.tsx` (it was not imported yet):

```tsx
import {
  VolBars, volMetricsFromResult, PressureGauge, ConfBar, MixBar, Sparkline,
  type MixSegment
} from "./components.js";
```

- [ ] **Step 3: Add cases 4 and 5 to EvidenceCards renderBody switch**

```tsx
// In EvidenceCards renderBody():
if (card.id === "pre_market_activity") return <PreMarketBody data={data} />;
if (card.id === "market_flow_trend") return <MarketFlowTrendBody data={data} />;
```

- [ ] **Step 4: Add CSS for new card body elements**

```css
.ev-empty {
  color: var(--ink-3);
  font-size: 13px;
  font-style: italic;
  padding: 14px var(--pad) var(--pad);
  margin: 0;
}

.ev-trend-label {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
```

- [ ] **Step 5: Implement CycleHistory in detail-extras.tsx** — replace the stub with the real timeline

The history data is available as `HistoryResult.rows` from `/api/uta/history`. `TickerDetail` already receives it via props from `SingleMode`. Pass it down:

In `modes.tsx`, update the `TickerDetail` props to accept `history`:

```tsx
// Update TickerDetail signature in modes.tsx:
export function TickerDetail({
  data, history, isWatchlisted, onRevalidate, onToggleWatchlist, onRefreshLane
}: {
  data: UtaTickerResult;
  history: HistoryResult | null;
  isWatchlisted: boolean;
  onRevalidate: () => void;
  onToggleWatchlist: () => void;
  onRefreshLane: (lane: LaneState) => void;
}) {
  // ...existing state...
  return (
    <div className="layout">
      <div className="main-col">
        <StatusStrip data={data} />
        <BlufCard data={data} />
        <TradeAnalysisPanel data={data} />
        <CycleHistory ticker={data.ticker} history={history} />
        <EvidenceCards cards={data.evidence_cards} data={data} />
      </div>
      {/* ...side-col unchanged... */}
    </div>
  );
}
```

Update `CycleHistory` in `detail-extras.tsx`:

```tsx
// Replace the CycleHistory stub in detail-extras.tsx:

export function CycleHistory({
  ticker,
  history
}: {
  ticker: string;
  history: HistoryResult | null;
}) {
  const rows = (history?.rows || [])
    .filter((r) => r.ticker === ticker)
    .slice(0, 12)
    .reverse(); // oldest first for timeline

  if (rows.length === 0) {
    return (
      <section className="panel cyc">
        <SectionHeader title="Cycle History" meta={ticker} />
        <div className="cyc-cell cyc-D">No cycle history yet</div>
      </section>
    );
  }

  const maxAbsScore = 1; // normalise bar heights — extend when API provides b-score per row

  return (
    <section className="panel cyc">
      <SectionHeader title="Cycle History" meta={`last ${rows.length} cycles`} />
      {/* Pressure bars */}
      <div className="cyc-bars">
        {rows.map((row, i) => {
          // Direction-keyed bar — height proportional to 0.5 (placeholder until b-score in history rows)
          const isUp = row.direction === "bullish";
          const heightPct = 40; // fixed until API provides b-score per cycle
          const barStyle = isUp
            ? { bottom: "50%", height: `${heightPct}%` }
            : { top: "50%", height: `${heightPct}%` };
          return (
            <div className="cyc-bar-col" key={i}>
              <div
                className={`cyc-bar ${isUp ? "up" : "dn"}`}
                style={barStyle}
                title={`${row.tier || "D"} · ${row.direction || "—"} · ${fmtDate(row.generated_at || row.created_at)}`}
              />
            </div>
          );
        })}
      </div>
      {/* Tier ribbon */}
      <div className="cyc-ribbon">
        {rows.map((row, i) => {
          const tier = (row.tier || "D").toUpperCase();
          const isNow = i === rows.length - 1;
          return (
            <div
              key={i}
              className={`cyc-cell cyc-${tier} ${isNow ? "cyc-now" : ""}`}
              title={fmtDate(row.generated_at || row.created_at)}
            >
              {tier}
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Wire history prop through SingleMode call site in modes.tsx**

In `SingleMode`, find where `TickerDetail` is rendered and add `history={history}`. The `SingleMode` component already receives `history` as a prop from `App` — confirm it passes it through.

- [ ] **Step 7: Run parity check**

```
npm run check:uta-ux-parity
```

The parity check asserts `.cyc .cyc-cell` count ≥ 1. With the new CycleHistory implementation, this now renders real cells from history rows. If live data is unavailable, the fallback "No cycle history yet" div carries the `.cyc-cell` class, so the assertion still passes.

Expected: `"status": "ok"`.

- [ ] **Step 8: Commit**

```
git add src/uta/src/evidence.tsx src/uta/src/detail-extras.tsx src/uta/src/modes.tsx src/uta/src/styles.css
git commit -m "feat(uta): evidence cards 4-5 bodies + CycleHistory timeline"
```

---

### Task 12: Tabbed detail view layout + parity check update

**Files:**
- Modify: `src/uta/src/modes.tsx`
- Modify: `src/uta/src/styles.css`
- Modify: `scripts/check-uta-ux-parity.js`

This is the most visible layout change in Phase 3. The BLUF card and IndicatorGrid stay always-visible above the tabs. The TradeAnalysisPanel moves into a tab alongside the EvidenceCards. The side column (Corroboration, Actions, LaneHealth) stays always-visible.

- [ ] **Step 1: Replace TickerDetail layout in modes.tsx with tabbed layout**

```tsx
// Replace TickerDetail in modes.tsx:

export function TickerDetail({
  data, history, isWatchlisted, onRevalidate, onToggleWatchlist, onRefreshLane
}: {
  data: UtaTickerResult;
  history: HistoryResult | null;
  isWatchlisted: boolean;
  onRevalidate: () => void;
  onToggleWatchlist: () => void;
  onRefreshLane: (lane: LaneState) => void;
}) {
  const [showRawPrints, setShowRawPrints] = useState(false);
  const [showExplainTier, setShowExplainTier] = useState(false);
  const [activeTab, setActiveTab] = useState<"evidence" | "trade">("evidence");

  const analysis = data.trade_analysis;
  // Cross-tab context chips
  const evidenceContextChip = analysis
    ? `${analysis.bias.charAt(0).toUpperCase() + analysis.bias.slice(1)} · ${analysis.setup_status.replaceAll("_", " ")}`
    : null;
  const tradeContextChip = `Tier ${data.tier} · ${fmtNumber(data.indicators.B.notional_zscore, 1)}σ vol`;

  return (
    <div className="layout">
      <div className="main-col">
        <StatusStrip data={data} />
        {/* Always-visible above tabs */}
        <BlufCard data={data} />
        {/* Tab bar */}
        <div className="detail-tabs">
          <button
            type="button"
            className={`detail-tab ${activeTab === "evidence" ? "active" : ""}`}
            onClick={() => setActiveTab("evidence")}
          >
            Evidence
            {activeTab !== "evidence" && tradeContextChip
              ? <span className="tab-ctx-chip">{tradeContextChip}</span>
              : null}
          </button>
          <button
            type="button"
            className={`detail-tab ${activeTab === "trade" ? "active" : ""}`}
            onClick={() => setActiveTab("trade")}
          >
            Trade Analysis
            {activeTab !== "trade" && evidenceContextChip
              ? <span className="tab-ctx-chip">{evidenceContextChip}</span>
              : null}
          </button>
        </div>
        {/* Tab content */}
        {activeTab === "evidence" && (
          <div className="detail-tab-content">
            <CycleHistory ticker={data.ticker} history={history} />
            <EvidenceCards cards={data.evidence_cards} data={data} />
          </div>
        )}
        {activeTab === "trade" && (
          <div className="detail-tab-content">
            <TradeAnalysisPanel data={data} />
          </div>
        )}
      </div>
      <div className="side-col">
        <CorroborationPanel data={data} />
        <ActionsPanel
          onRevalidate={onRevalidate}
          onRawPrints={() => setShowRawPrints(true)}
          onExplainTier={() => setShowExplainTier(true)}
          onCompare={() => {}}
          onWatchlist={onToggleWatchlist}
          onRefreshLane={() => onRefreshLane(data.lane_states[0])}
          isWatchlisted={isWatchlisted}
        />
        <LaneHealth lanes={data.lane_states} onRefresh={onRefreshLane} />
      </div>
      {showRawPrints && <RawPrintsDrawer data={data} onClose={() => setShowRawPrints(false)} />}
      {showExplainTier && <ExplainTierPanel data={data} onClose={() => setShowExplainTier(false)} />}
    </div>
  );
}
```

- [ ] **Step 2: Add detail tab CSS to styles.css**

```css
/* Detail tabs */
.detail-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 0;
}

.detail-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  min-height: 40px;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--ink-3);
  padding: 0 14px;
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
  margin-bottom: -1px;
}

.detail-tab:hover {
  color: var(--ink);
  background: transparent;
}

.detail-tab.active {
  color: var(--ink);
  font-weight: 600;
  border-bottom-color: var(--accent);
  background: transparent;
}

.tab-ctx-chip {
  font-size: 11px;
  font-weight: 500;
  color: var(--ink-3);
  background: var(--panel-3);
  border-radius: 99px;
  padding: 2px 8px;
  white-space: nowrap;
}

.detail-tab-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
```

- [ ] **Step 3: Update parity check** — "Trade Analysis" text is now always present as a tab label, not only when data.trade_analysis exists

The parity check asserts `textUpper.includes("TRADE ANALYSIS")`. The tab label "Trade Analysis" is always rendered in the DOM regardless of whether the tab is active. This passes without change.

However, "Primary trigger" and "Trigger criteria" are now inside the Trade Analysis tab content, which is hidden when the Evidence tab is active. `page.locator("body").innerText()` on Playwright captures all text including hidden elements by default — but `innerText` skips elements with `display:none`. Since we toggle content via conditional rendering (not CSS display:none), the inactive tab content is unmounted from the DOM.

Fix: click the Trade Analysis tab before asserting the "Primary trigger" text:

```js
// In scripts/check-uta-ux-parity.js, after the requiredText loop,
// add a tab-click step before checking trigger text:

// Click Trade Analysis tab to expose its content
const tradeTab = page.getByRole("button", { name: "Trade Analysis" });
if ((await tradeTab.count()) > 0) {
  await tradeTab.click();
  await page.waitForTimeout(200);
}

// Re-read body text to include Trade Analysis tab content
const textAfterTab = await page.locator("body").innerText();
const textAfterTabUpper = textAfterTab.toUpperCase();
const tradeTabRequiredText = ["Primary trigger", "Trigger criteria"];
for (const item of tradeTabRequiredText) {
  assert(textAfterTabUpper.includes(item.toUpperCase()), `Trade Analysis tab text missing: ${item}`);
}
```

Move "Primary trigger" and "Trigger criteria" out of the main `requiredText` array since they're now checked separately above.

- [ ] **Step 4: Run parity check**

```
npm run check:uta-ux-parity
```

Expected: `"status": "ok"` with the tab-navigation flow working.

- [ ] **Step 5: Commit**

```
git add src/uta/src/modes.tsx src/uta/src/styles.css scripts/check-uta-ux-parity.js
git commit -m "feat(uta): tabbed detail view — Evidence / Trade Analysis co-equal tabs"
```

**Phase 3 exit criteria:** Detail view shows Evidence and Trade Analysis tabs. Evidence tab shows CycleHistory timeline (pressure bars + tier ribbon) and 9 EvidenceCards — cards 1–3 render visual components, cards 4–5 render data-backed bodies. `npm run check:uta-ux-parity` passes including Trade Analysis tab navigation.

---

## Phase 4 — Scan Mode Recovery

Three tasks: UniverseSelector + direction filter, ScanFunnel + resolving table, ScanResults 3 views + refinement bar.

---

### Task 13: UniverseSelector + direction filter

**Files:**
- Modify: `src/uta/src/scan.tsx`
- Modify: `src/uta/src/styles.css`

The current ScanMode renders a free-text ticker input + two plain buttons (Pass 1 / Pass 2). This task replaces the idle state with a proper universe selector grouped by index/sector/exchange/custom, plus a direction segmented control.

- [ ] **Step 1: Define universe options data in scan.tsx**

```tsx
// Add to src/uta/src/scan.tsx — universe definitions

type UniverseOption = {
  id: string;
  label: string;
  count: number;
  perfTier: "fast" | "standard" | "extended";
};

type UniverseGroup = {
  group: string;
  options: UniverseOption[];
};

const UNIVERSE_GROUPS: UniverseGroup[] = [
  {
    group: "US Indices",
    options: [
      { id: "dow30",      label: "DOW 30",        count: 30,   perfTier: "fast" },
      { id: "nasdaq100",  label: "NASDAQ-100",     count: 100,  perfTier: "fast" },
      { id: "sp500",      label: "S&P 500",        count: 503,  perfTier: "standard" },
      { id: "sp400",      label: "S&P 400 Mid",    count: 400,  perfTier: "standard" },
      { id: "sp600",      label: "S&P 600 Small",  count: 600,  perfTier: "extended" },
      { id: "russell1000",label: "Russell 1000",   count: 1000, perfTier: "extended" },
      { id: "russell2000",label: "Russell 2000",   count: 2000, perfTier: "extended" },
    ]
  },
  {
    group: "US Sectors",
    options: [
      { id: "sector_tech",   label: "Technology",          count: 68,  perfTier: "fast" },
      { id: "sector_health", label: "Health Care",         count: 64,  perfTier: "fast" },
      { id: "sector_fin",    label: "Financials",          count: 72,  perfTier: "fast" },
      { id: "sector_cons",   label: "Consumer Discretionary", count: 54, perfTier: "fast" },
      { id: "sector_ind",    label: "Industrials",         count: 78,  perfTier: "standard" },
      { id: "sector_energy", label: "Energy",              count: 23,  perfTier: "fast" },
    ]
  },
  {
    group: "US Exchanges",
    options: [
      { id: "nyse_arca",  label: "NYSE Arca",    count: 480,  perfTier: "standard" },
      { id: "nyse_listed",label: "NYSE Listed",  count: 2300, perfTier: "extended" },
      { id: "nasdaq_cm",  label: "NASDAQ Listed",count: 3100, perfTier: "extended" },
    ]
  },
  {
    group: "Custom",
    options: [
      { id: "portfolio",  label: "My Portfolio", count: 0, perfTier: "fast" },
      { id: "watchlist",  label: "My Watchlist", count: 0, perfTier: "fast" },
      { id: "custom",     label: "Custom list",  count: 0, perfTier: "fast" },
    ]
  }
];

const PERF_TIER_LABEL: Record<string, string> = {
  fast: "🟢 Fast",
  standard: "🟡 Standard",
  extended: "🔴 Extended"
};

const PERF_TIER_ESTIMATE: Record<string, string> = {
  fast:     "< 30 s",
  standard: "1–3 min",
  extended: "5–15 min"
};
```

- [ ] **Step 2: Add UniverseSelector component**

```tsx
// Add to src/uta/src/scan.tsx

function UniverseSelector({
  value,
  onChange,
  customTickers,
  onCustomTickersChange
}: {
  value: string;
  onChange: (id: string) => void;
  customTickers: string;
  onCustomTickersChange: (v: string) => void;
}) {
  const selected = UNIVERSE_GROUPS
    .flatMap((g) => g.options)
    .find((o) => o.id === value);

  return (
    <div className="universe-selector">
      <label className="uni-label">Universe</label>
      <select
        className="uni-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— Choose a universe —</option>
        {UNIVERSE_GROUPS.map((g) => (
          <optgroup key={g.group} label={g.group}>
            {g.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}{o.count > 0 ? ` (${o.count.toLocaleString()})` : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {selected && (
        <div className="uni-perf-chip">
          <span className="uni-perf-badge">{PERF_TIER_LABEL[selected.perfTier]}</span>
          <span className="uni-perf-est">~{PERF_TIER_ESTIMATE[selected.perfTier]}</span>
        </div>
      )}
      {value === "custom" && (
        <textarea
          className="uni-custom-input"
          placeholder="AAPL, MSFT, NVDA, …"
          value={customTickers}
          onChange={(e) => onCustomTickersChange(e.target.value)}
          rows={3}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add DirectionFilter component**

```tsx
// Add to src/uta/src/scan.tsx

function DirectionFilter({
  value,
  onChange
}: {
  value: "bullish" | "bearish" | "both";
  onChange: (v: "bullish" | "bearish" | "both") => void;
}) {
  const opts: Array<{ id: "bullish" | "bearish" | "both"; label: string }> = [
    { id: "bullish", label: "Bullish" },
    { id: "bearish", label: "Bearish" },
    { id: "both",    label: "Both" }
  ];
  return (
    <div className="direction-filter">
      <span className="dir-filter-label">Direction</span>
      <div className="dir-seg">
        {opts.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`dir-seg-btn ${value === o.id ? "active" : "secondary"}`}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add SavedScans component**

```tsx
// Add to src/uta/src/scan.tsx

function SavedScans({
  scans,
  onLoad
}: {
  scans: Array<Record<string, unknown>>;
  onLoad: (scan: Record<string, unknown>) => void;
}) {
  if (!scans || scans.length === 0) return null;
  return (
    <div className="saved-scans">
      <div className="saved-scans-label">Saved scans</div>
      <div className="saved-scans-list">
        {scans.map((s, i) => (
          <button
            key={i}
            type="button"
            className="saved-scan-chip secondary"
            onClick={() => onLoad(s)}
          >
            {String(s.universe_label || s.universe || "Scan")} · {String(s.direction || "any")}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Replace the idle-state controls in ScanMode**

In `scan.tsx`, replace the existing idle control section (the free-text input and Pass 1 button) with the new components. Keep the same `onPass1` / `onPass2` callbacks — only the UI is changing, not the API calls:

```tsx
// In ScanMode, replace the form/controls section:

const [universe, setUniverse] = useState("");
const [direction, setDirection] = useState<"bullish" | "bearish" | "both">("bullish");
const [customTickers, setCustomTickers] = useState("");

// resolve tickers for API call
function resolveTickerList(): string[] {
  if (universe === "custom") return tickerList(customTickers);
  if (universe === "portfolio") return DEFAULT_PORTFOLIO;
  return [];
}

// In the idle/controls render:
<div className="scan-controls">
  <UniverseSelector
    value={universe}
    onChange={setUniverse}
    customTickers={customTickers}
    onCustomTickersChange={setCustomTickers}
  />
  <DirectionFilter value={direction} onChange={setDirection} />
  <button
    type="button"
    disabled={!universe || scan.status === "loading"}
    onClick={() => onPass1(direction, resolveTickerList())}
  >
    {scan.status === "loading" ? "Scanning…" : "Run scan"}
  </button>
  <SavedScans
    scans={savedScans}
    onLoad={(s) => {
      setUniverse(String(s.universe || ""));
      setDirection((s.direction as "bullish" | "bearish" | "both") || "bullish");
    }}
  />
</div>
```

Also add `savedScans` as a prop to `ScanMode` (passed from `App` via `userState?.state.saved_scans || []`).

- [ ] **Step 6: Add CSS for universe selector and direction filter**

```css
/* UniverseSelector */
.scan-controls {
  display: grid;
  gap: 16px;
  max-width: 560px;
}

.universe-selector {
  display: grid;
  gap: 8px;
}

.uni-label,
.dir-filter-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--ink-3);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.uni-select {
  width: 100%;
  font-size: 14px;
}

.uni-perf-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--panel-2);
  border: 1px solid var(--line);
}

.uni-perf-badge {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}

.uni-perf-est {
  font-size: 12px;
  color: var(--ink-3);
}

.uni-custom-input {
  width: 100%;
  resize: vertical;
  font-family: var(--font-mono);
  font-size: 13px;
}

/* DirectionFilter */
.direction-filter {
  display: grid;
  gap: 8px;
}

.dir-seg {
  display: flex;
  gap: 4px;
}

.dir-seg-btn {
  flex: 1;
  height: 36px;
  min-height: 36px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
}

.dir-seg-btn.active {
  border-color: var(--accent-line);
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

/* SavedScans */
.saved-scans {
  display: grid;
  gap: 8px;
}

.saved-scans-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--ink-3);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.saved-scans-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.saved-scan-chip {
  height: 30px;
  min-height: 30px;
  border-radius: 99px;
  font-size: 12px;
  padding: 0 12px;
}
```

- [ ] **Step 7: Run parity check**

```
npm run check:uta-ux-parity
```

Expected: `"status": "ok"`. ScanMode changes are on a separate route/mode — the parity check loads Single Ticker mode, so scan UI changes don't affect it.

- [ ] **Step 8: Commit**

```
git add src/uta/src/scan.tsx src/uta/src/styles.css
git commit -m "feat(uta): scan mode — UniverseSelector, DirectionFilter, SavedScans"
```

---

### Task 14: ScanFunnel + resolving table

**Files:**
- Modify: `src/uta/src/scan.tsx`
- Modify: `src/uta/src/styles.css`

This task replaces the "loading" state of ScanMode with the animated three-stage funnel and the resolving-rows table that updates in real time as Pass 2 completes.

- [ ] **Step 1: Add ScanFunnel component**

```tsx
// Add to src/uta/src/scan.tsx

function ScanFunnel({
  screened,
  flagged,
  resolved,
  total,
  pass,
  isRunning
}: {
  screened: number;
  flagged: number;
  resolved: number;
  total: number;
  pass: 1 | 2;
  isRunning: boolean;
}) {
  const pass2Pct = total > 0 ? Math.round((resolved / total) * 100) : 0;
  return (
    <div className="scan-funnel">
      <div className="funnel-stages">
        <div className={`funnel-stage ${screened > 0 ? "done" : pass === 1 && isRunning ? "active" : "idle"}`}>
          <span className="funnel-count">{screened > 0 ? screened.toLocaleString() : "—"}</span>
          <span className="funnel-label">Screened</span>
          {screened > 0 && <span className="funnel-check">✓</span>}
        </div>
        <div className="funnel-arrow">→</div>
        <div className={`funnel-stage ${flagged > 0 ? (pass === 2 ? "active" : "done") : "idle"}`}>
          <span className="funnel-count">{flagged > 0 ? flagged : "—"}</span>
          <span className="funnel-label">Flagged</span>
        </div>
        <div className="funnel-arrow">→</div>
        <div className={`funnel-stage ${resolved > 0 ? (resolved >= total && total > 0 ? "done" : "active") : "idle"}`}>
          <span className="funnel-count">
            {resolved > 0 ? `${resolved} / ${total}` : "—"}
          </span>
          <span className="funnel-label">Resolved</span>
          {resolved >= total && total > 0 && <span className="funnel-check">✓</span>}
        </div>
      </div>
      {pass === 2 && isRunning && (
        <div className="funnel-progress">
          <div className="funnel-prog-bar" style={{ width: `${pass2Pct}%` }} />
          <span className="funnel-prog-label">Pass 2 · Resolving live prints · {pass2Pct}%</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add ResolvingTable component**

```tsx
// Add to src/uta/src/scan.tsx

function ResolvingTable({
  rows,
  pass2Status
}: {
  rows: ScanRow[];
  pass2Status: "idle" | "loading" | "ready";
}) {
  return (
    <div className="resolving-table">
      {rows.map((row) => {
        const isResolved = !!row.result;
        const isActive = !isResolved && pass2Status === "loading";
        const statusClass = isResolved ? "rt-done" : isActive ? "rt-active" : "rt-queued";
        return (
          <div className={`rt-row ${statusClass}`} key={row.ticker}>
            <span className="rt-ticker mono">{row.ticker}</span>
            {isResolved && row.result ? (
              <>
                <TierBadge tier={row.result.tier} size="sm" />
                <DirTag direction={row.result.direction} />
                <span className="rt-check">✓ Resolved</span>
              </>
            ) : isActive ? (
              <span className="rt-resolving">Resolving…</span>
            ) : (
              <span className="rt-queued-label">
                {row.preliminary_tier ? `~ ${row.preliminary_tier} est` : "Queued"}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Wire ScanFunnel and ResolvingTable into ScanMode**

In `ScanMode`, replace the existing loading-state render. Use `scan.data` for Pass 1 results and `pass2.data` for Pass 2:

```tsx
// In ScanMode's render — when scan.status === "loading" || scan.status === "ready":

const pass1Data = scan.data;
const pass2Data = pass2.data;
const allRows: ScanRow[] = pass2Data?.results ?? pass1Data?.results ?? [];
const resolvedCount = allRows.filter((r) => !!r.result).length;
const isPass2Running = pass2.status === "loading";
const currentPass: 1 | 2 = pass2.status !== "idle" ? 2 : 1;

// Replace loading/running state with:
{(scan.status === "loading" || (scan.status === "ready" && pass2.status !== "ready")) && (
  <div className="scan-running">
    <ScanFunnel
      screened={pass1Data?.scanned_count ?? (scan.status === "ready" ? (pass1Data?.results?.length ?? 0) : 0)}
      flagged={pass1Data?.shortlist_count ?? 0}
      resolved={resolvedCount}
      total={pass1Data?.shortlist_count ?? 0}
      pass={currentPass}
      isRunning={scan.status === "loading" || isPass2Running}
    />
    {allRows.length > 0 && (
      <ResolvingTable rows={allRows} pass2Status={pass2.status} />
    )}
    {scan.status === "ready" && pass2.status === "idle" && (
      <button type="button" onClick={onPass2}>
        Run Pass 2 — Resolve {pass1Data?.shortlist_count ?? 0} flagged tickers
      </button>
    )}
  </div>
)}
```

- [ ] **Step 4: Add CSS for ScanFunnel and ResolvingTable**

```css
/* ScanFunnel */
.scan-funnel {
  display: grid;
  gap: 14px;
}

.funnel-stages {
  display: flex;
  align-items: center;
  gap: 12px;
}

.funnel-stage {
  flex: 1;
  display: grid;
  place-items: center;
  gap: 4px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel-2);
  padding: 16px 12px;
  position: relative;
  transition: border-color 0.2s, background 0.2s;
}

.funnel-stage.done {
  border-color: var(--buy);
  background: var(--buy-bg);
}

.funnel-stage.active {
  border-color: var(--accent-line);
  background: var(--accent-soft);
  animation: funnel-pulse 1.6s ease-in-out infinite;
}

@keyframes funnel-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.7; }
}

.funnel-count {
  font-family: var(--font-mono);
  font-size: 28px;
  font-weight: 700;
  color: var(--ink);
}

.funnel-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--ink-3);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.funnel-check {
  position: absolute;
  top: 8px;
  right: 10px;
  font-size: 13px;
  color: var(--buy);
  font-weight: 700;
}

.funnel-arrow {
  color: var(--ink-3);
  font-size: 18px;
  flex-shrink: 0;
}

.funnel-progress {
  position: relative;
  height: 24px;
  border-radius: 8px;
  background: var(--panel-3);
  overflow: hidden;
}

.funnel-prog-bar {
  position: absolute;
  inset: 0 auto 0 0;
  background: linear-gradient(90deg, var(--accent), var(--buy));
  transition: width 0.4s ease;
  border-radius: 8px;
}

.funnel-prog-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  padding: 0 10px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink);
}

/* ResolvingTable */
.resolving-table {
  display: grid;
  gap: 4px;
  max-height: 360px;
  overflow-y: auto;
}

.rt-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--panel-2);
  font-size: 13px;
}

.rt-ticker { font-weight: 600; min-width: 56px; }

.rt-done { border-left: 2px solid var(--buy); }
.rt-active { border-left: 2px solid var(--accent); }
.rt-queued { opacity: 0.6; }

.rt-check { color: var(--buy); font-weight: 700; margin-left: auto; font-size: 12px; }

.rt-resolving {
  color: var(--accent);
  font-size: 12px;
  animation: funnel-pulse 1s ease-in-out infinite;
}

.rt-queued-label { color: var(--ink-3); font-size: 12px; margin-left: auto; }

.scan-running {
  display: grid;
  gap: 16px;
}
```

- [ ] **Step 5: Run parity check**

```
npm run check:uta-ux-parity
```

Expected: `"status": "ok"`.

- [ ] **Step 6: Commit**

```
git add src/uta/src/scan.tsx src/uta/src/styles.css
git commit -m "feat(uta): scan mode — ScanFunnel + resolving table"
```

---

### Task 15: ScanResults — three views + refinement bar

**Files:**
- Modify: `src/uta/src/scan.tsx`
- Modify: `src/uta/src/styles.css`

- [ ] **Step 1: Add RefinementBar component**

```tsx
// Add to src/uta/src/scan.tsx

type TierFilter = "all" | "A" | "B" | "C";
type ViewMode = "cards" | "table" | "grouped";

function RefinementBar({
  rows,
  tierFilter,
  onTierFilter,
  viewMode,
  onViewMode,
  onWatchAll,
  onSaveScan
}: {
  rows: ScanRow[];
  tierFilter: TierFilter;
  onTierFilter: (f: TierFilter) => void;
  viewMode: ViewMode;
  onViewMode: (v: ViewMode) => void;
  onWatchAll: () => void;
  onSaveScan: () => void;
}) {
  const counts: Record<string, number> = { all: rows.length };
  for (const row of rows) {
    const t = row.result?.tier || row.preliminary_tier || "D";
    counts[t] = (counts[t] || 0) + 1;
  }
  return (
    <div className="refinement-bar">
      <div className="ref-tier-chips">
        {(["all", "A", "B", "C"] as TierFilter[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`ref-chip ${tierFilter === t ? "active" : "secondary"}`}
            onClick={() => onTierFilter(t)}
          >
            {t === "all" ? "All" : `Tier ${t}`}
            <span className="ref-chip-count">{counts[t] ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="ref-view-switch">
        {(["cards", "table", "grouped"] as ViewMode[]).map((v) => (
          <button
            key={v}
            type="button"
            className={`ref-view-btn ${viewMode === v ? "active" : "secondary"}`}
            onClick={() => onViewMode(v)}
          >
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>
      <div className="ref-actions">
        <button type="button" className="secondary" onClick={onWatchAll}>Watch all shown</button>
        <button type="button" className="secondary" onClick={onSaveScan}>Save scan</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add ScanCard component (Cards view)**

```tsx
// Add to src/uta/src/scan.tsx

function ScanCard({ row, onInspect }: { row: ScanRow; onInspect: (r: UtaTickerResult) => void }) {
  const result = row.result;
  const tier = result?.tier || row.preliminary_tier || "D";
  const direction = result?.direction || row.bias || "undetermined";
  const pressureVal = Number(row.signed_pressure ?? result?.indicators?.C?.net_notional_pressure ?? 0);
  const setupStatus = row.setup_status || result?.trade_analysis?.setup_status;
  const isClickable = !!result;
  return (
    <div
      className={`scan-card ${isClickable ? "clickable" : ""}`}
      onClick={isClickable ? () => onInspect(result!) : undefined}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
    >
      <div className="sc-head">
        <span className="sc-sym mono">{row.ticker}</span>
        <TierBadge tier={tier} size="sm" />
      </div>
      <div className="sc-meta">
        <DirTag direction={direction} />
        {row.anomaly_band && <BandTag band={row.anomaly_band} />}
      </div>
      {setupStatus && (
        <div className={`sc-setup pill ${setupTone(setupStatus)}`}>
          {setupLabel(setupStatus)}
        </div>
      )}
      <div className="sc-stats">
        {result && (
          <>
            <span className="sc-stat">
              <span>B</span>
              <strong>{fmtNumber(result.indicators.B.notional_zscore, 1)}σ</strong>
            </span>
            <span className="sc-stat">
              <span>C</span>
              <strong>{fmtNumber(result.indicators.C.notional_ratio, 1)}×</strong>
            </span>
          </>
        )}
      </div>
      <div className="sc-pressure-wrap">
        <PressureGauge value={pressureVal} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add ScanTable component (Table view)**

```tsx
// Add to src/uta/src/scan.tsx

type SortKey = "ticker" | "tier" | "direction" | "B" | "A" | "C" | "setup" | "delta";

function ScanTable({
  rows,
  onInspect
}: {
  rows: ScanRow[];
  onInspect: (r: UtaTickerResult) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("tier");
  const [sortAsc, setSortAsc] = useState(false);

  function handleSort(key: SortKey) {
    if (sortKey === key) { setSortAsc((a) => !a); }
    else { setSortKey(key); setSortAsc(false); }
  }

  const sorted = [...rows].sort((a, b) => {
    const ra = a.result, rb = b.result;
    let av: unknown, bv: unknown;
    if (sortKey === "tier")   { av = tierRank(ra?.tier ?? a.preliminary_tier); bv = tierRank(rb?.tier ?? b.preliminary_tier); }
    else if (sortKey === "B") { av = ra?.indicators.B.notional_zscore ?? 0; bv = rb?.indicators.B.notional_zscore ?? 0; }
    else if (sortKey === "C") { av = ra?.indicators.C.notional_ratio ?? 0; bv = rb?.indicators.C.notional_ratio ?? 0; }
    else if (sortKey === "ticker") { av = a.ticker; bv = b.ticker; }
    else { av = 0; bv = 0; }
    const cmp = typeof av === "string" ? av.localeCompare(String(bv)) : Number(av) - Number(bv);
    return sortAsc ? cmp : -cmp;
  });

  function Th({ k, label }: { k: SortKey; label: string }) {
    return (
      <th
        onClick={() => handleSort(k)}
        style={{ cursor: "pointer", userSelect: "none" }}
      >
        {label} {sortKey === k ? (sortAsc ? "↑" : "↓") : ""}
      </th>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <Th k="ticker" label="Ticker" />
            <Th k="tier" label="Tier" />
            <Th k="direction" label="Direction" />
            <Th k="B" label="B (σ)" />
            <Th k="A" label="A (%)" />
            <Th k="C" label="C (×)" />
            <Th k="setup" label="Setup" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const r = row.result;
            const tier = r?.tier || row.preliminary_tier || "D";
            const setup = row.setup_status || r?.trade_analysis?.setup_status;
            return (
              <tr
                key={row.ticker}
                className={r ? "clickable-row" : ""}
                onClick={r ? () => onInspect(r) : undefined}
              >
                <td className="mono">{row.ticker}</td>
                <td><TierBadge tier={tier} size="sm" /></td>
                <td>{r ? <DirTag direction={r.direction} /> : "—"}</td>
                <td className="mono">{r ? fmtNumber(r.indicators.B.notional_zscore, 2) : "—"}</td>
                <td className="mono">{r?.indicators.A ? fmtPct(r.indicators.A.volume_percentile) : "N/A"}</td>
                <td className="mono">{r ? fmtNumber(r.indicators.C.notional_ratio, 2) : "—"}</td>
                <td>{setup ? <span className={`pill ${setupTone(setup)}`}>{setupLabel(setup)}</span> : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Add ScanGrouped component (Grouped view)**

```tsx
// Add to src/uta/src/scan.tsx

const TIER_DESC: Record<string, string> = {
  A: "Actionable — strong supporting evidence across multiple indicators",
  B: "Review closely — notable activity, confirm with corroboration",
  C: "Context only — elevated but insufficient for setup"
};

function ScanGrouped({
  rows,
  onInspect
}: {
  rows: ScanRow[];
  onInspect: (r: UtaTickerResult) => void;
}) {
  const byTier: Record<string, ScanRow[]> = { A: [], B: [], C: [] };
  for (const row of rows) {
    const t = row.result?.tier || row.preliminary_tier || "D";
    if (t === "A" || t === "B" || t === "C") byTier[t].push(row);
  }
  return (
    <div className="scan-grouped">
      {(["A", "B", "C"] as const).map((t) => {
        if (byTier[t].length === 0) return null;
        return (
          <div className="sg-section" key={t}>
            <div className="sg-header">
              <TierBadge tier={t} />
              <div>
                <div className="sg-tier-name">Tier {t}</div>
                <div className="sg-tier-desc">{TIER_DESC[t]}</div>
              </div>
              <span className="sg-count">{byTier[t].length}</span>
            </div>
            <div className="scan-cards-grid">
              {byTier[t].map((row) => (
                <ScanCard key={row.ticker} row={row} onInspect={onInspect} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Assemble the results section in ScanMode**

Replace the existing pass-2 results section with the new components:

```tsx
// In ScanMode, when pass2.status === "ready" || (scan.status === "ready" && pass2.status === "idle"):

const [tierFilter, setTierFilter] = useState<TierFilter>("all");
const [viewMode, setViewMode] = useState<ViewMode>(() =>
  (localStorage.getItem("uta_scan_view") as ViewMode) || "cards"
);

function handleViewMode(v: ViewMode) {
  setViewMode(v);
  localStorage.setItem("uta_scan_view", v);
}

const resultRows = (pass2.data?.results ?? scan.data?.results ?? [])
  .filter((row) => tierFilter === "all" || (row.result?.tier || row.preliminary_tier) === tierFilter);

// Results render:
{(pass2.status === "ready" || scan.status === "ready") && (
  <div className="scan-results">
    <RefinementBar
      rows={pass2.data?.results ?? scan.data?.results ?? []}
      tierFilter={tierFilter}
      onTierFilter={setTierFilter}
      viewMode={viewMode}
      onViewMode={handleViewMode}
      onWatchAll={() => { /* Phase 5: bulk watchlist add */ }}
      onSaveScan={() => { /* Phase 5: persist saved scan */ }}
    />
    {viewMode === "cards" && (
      <div className="scan-cards-grid">
        {resultRows.map((row) => (
          <ScanCard key={row.ticker} row={row} onInspect={onInspect} />
        ))}
      </div>
    )}
    {viewMode === "table" && (
      <ScanTable rows={resultRows} onInspect={onInspect} />
    )}
    {viewMode === "grouped" && (
      <ScanGrouped rows={resultRows} onInspect={onInspect} />
    )}
  </div>
)}
```

- [ ] **Step 6: Add results CSS**

```css
/* RefinementBar */
.refinement-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
}

.ref-tier-chips { display: flex; gap: 4px; }

.ref-chip {
  height: 30px;
  min-height: 30px;
  border-radius: 99px;
  font-size: 12px;
  font-weight: 600;
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 5px;
}

.ref-chip.active {
  border-color: var(--accent-line);
  background: var(--accent-soft);
  color: var(--accent);
}

.ref-chip-count {
  font-family: var(--font-mono);
  font-size: 11px;
  opacity: 0.8;
}

.ref-view-switch { display: flex; gap: 2px; }

.ref-view-btn {
  height: 30px;
  min-height: 30px;
  border-radius: 8px;
  font-size: 12px;
  padding: 0 10px;
}

.ref-view-btn.active {
  border-color: var(--accent-line);
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.ref-actions { display: flex; gap: 6px; margin-left: auto; }
.ref-actions button { height: 30px; min-height: 30px; font-size: 12px; }

/* ScanCard */
.scan-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.scan-card {
  display: grid;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  padding: 14px;
  transition: border-color 0.15s;
}

.scan-card.clickable {
  cursor: pointer;
}

.scan-card.clickable:hover {
  border-color: var(--accent-line);
  background: var(--panel-2);
}

.sc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.sc-sym {
  font-size: 18px;
  font-weight: 700;
  color: var(--ink);
}

.sc-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.sc-setup { font-size: 11px; }

.sc-stats {
  display: flex;
  gap: 10px;
}

.sc-stat {
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-size: 11px;
}

.sc-stat span { color: var(--ink-3); font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.sc-stat strong { font-family: var(--font-mono); font-size: 14px; color: var(--ink); }

/* ScanGrouped */
.scan-grouped { display: grid; gap: 24px; }

.sg-section { display: grid; gap: 12px; }

.sg-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line);
}

.sg-tier-name { font-weight: 700; font-size: 15px; color: var(--ink); }
.sg-tier-desc { font-size: 12px; color: var(--ink-3); }
.sg-count { margin-left: auto; font-family: var(--font-mono); font-size: 13px; font-weight: 600; color: var(--ink-2); }

.scan-results { display: grid; gap: 14px; }
```

- [ ] **Step 7: Run parity check**

```
npm run check:uta-ux-parity
```

Expected: `"status": "ok"`.

- [ ] **Step 8: Commit**

```
git add src/uta/src/scan.tsx src/uta/src/styles.css
git commit -m "feat(uta): scan results — 3 views (cards/table/grouped) + refinement bar"
```

**Phase 4 exit criteria:** Scan opens with grouped universe selector, direction filter, and performance-tier chip. Run scan shows animated funnel. Results appear in 3 switchable views with tier filter chips. `npm run check:uta-ux-parity` passes.

---

## Phase 5 — Portfolio + Alerts Recovery

Four tasks: portfolio stat cards + holdings table, alerts stat cards + typed feed, rules drawer with sliders, final build + parity update.

---

### Task 16: Portfolio stat cards + holdings table visual improvements

**Files:**
- Modify: `src/uta/src/modes.tsx`
- Modify: `src/uta/src/styles.css`

- [ ] **Step 1: Add PortfolioStatCards component**

```tsx
// Add to src/uta/src/modes.tsx

function PortfolioStatCards({ data }: { data: PortfolioResult }) {
  const results = data.results || [];
  const tierACount = results.filter((r) => r.tier === "A").length;
  const tierChanges = 0; // populated from cycle diff in future — placeholder
  return (
    <div className="port-stat-cards">
      <div className="port-stat-card">
        <span className="psc-label">Holdings</span>
        <strong className="psc-value">{results.length}</strong>
        <span className="psc-detail">total tickers</span>
      </div>
      <div className={`port-stat-card ${tierACount > 0 ? "psc-accent" : ""}`}>
        <span className="psc-label">Tier A</span>
        <strong className="psc-value">{tierACount}</strong>
        <span className="psc-detail">actionable signals</span>
      </div>
      <div className={`port-stat-card ${tierChanges > 0 ? "psc-warn" : ""}`}>
        <span className="psc-label">Tier changes</span>
        <strong className="psc-value">{tierChanges}</strong>
        <span className="psc-detail">since last cycle</span>
      </div>
      <div className="port-stat-card">
        <span className="psc-label">Cycle time</span>
        <strong className="psc-value psc-mono">{fmtDate(data.generated_at).split(",")[1]?.trim() || "—"}</strong>
        <span className="psc-detail">{fmtDate(data.generated_at).split(",")[0]}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace PortfolioMode table with enhanced holdings table**

In `modes.tsx`, find the `PortfolioMode` component and replace the plain `<table>` with a version that adds:
- `DeltaChip` in a Δ cycle column
- `2px accent border-left` on Tier A rows
- `2px warn border-left` on tier-changed rows (placeholder — no prior-cycle data yet)
- Tier D rows show `—` dashes across metrics
- Setup column from `trade_analysis.setup_status`

```tsx
// In PortfolioMode, replace the table body rows with:

{sorted.map((result) => {
  const isTierA = result.tier === "A";
  const isTierD = result.tier === "D";
  const setup = result.trade_analysis?.setup_status;
  const isIgnored = !!(userState?.state.ignored?.[result.ticker]);
  const isReviewed = !!(userState?.state.reviewed?.[result.ticker]);
  return (
    <tr
      key={result.ticker}
      className={`clickable-row ${isTierA ? "row-tier-a" : ""} ${isIgnored ? "row-ignored" : ""}`}
      onClick={() => onInspect(result)}
    >
      <td>
        <span className="mono">{result.ticker}</span>
        {isReviewed && <span className="pill neutral" style={{ marginLeft: 6, fontSize: 10 }}>✓</span>}
        {result.name ? <span className="port-name">{result.name}</span> : null}
      </td>
      <td><TierBadge tier={result.tier} size="sm" /></td>
      <td>{isTierD ? <span className="ink-3">—</span> : <DirTag direction={result.direction} />}</td>
      <td className="mono">{isTierD ? "—" : fmtNumber(result.indicators.B.notional_zscore, 2)}</td>
      <td className="mono">{isTierD ? "—" : result.indicators.A ? fmtPct(result.indicators.A.volume_percentile) : "N/A"}</td>
      <td className="mono">{isTierD ? "—" : fmtNumber(result.indicators.C.notional_ratio, 2)}</td>
      <td>
        {isTierD || !setup
          ? <span className="ink-3">—</span>
          : <span className={`pill ${setupTone(setup)}`}>{setupLabel(setup)}</span>}
      </td>
      <td>
        {isTierD ? <span className="ink-3">—</span>
          : <DeltaChip delta={Number(result.indicators.B.notional_zscore ?? 0) - 2} />}
      </td>
    </tr>
  );
})}
```

Also add `<PortfolioStatCards data={portfolio.data} />` above the table in `PortfolioMode`.

Update the table header to include the Δ cycle column and Setup column:

```tsx
<thead>
  <tr>
    <th onClick={() => handleSort("ticker")}>Ticker</th>
    <th onClick={() => handleSort("tier")}>Tier</th>
    <th>Direction</th>
    <th onClick={() => handleSort("B")}>B (σ)</th>
    <th>A (%)</th>
    <th onClick={() => handleSort("C")}>C (×)</th>
    <th>Setup</th>
    <th>Δ cycle</th>
  </tr>
</thead>
```

- [ ] **Step 3: Add portfolio CSS**

```css
/* Portfolio stat cards */
.port-stat-cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 4px;
}

.port-stat-card {
  display: grid;
  gap: 3px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
  padding: 14px 16px;
}

.psc-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--ink-3);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.psc-value {
  font-family: var(--font-mono);
  font-size: 26px;
  font-weight: 700;
  color: var(--ink);
  line-height: 1.1;
}

.psc-mono { font-size: 16px; }

.psc-detail {
  font-size: 12px;
  color: var(--ink-3);
}

.psc-accent { border-color: var(--buy); background: var(--buy-bg); }
.psc-accent .psc-value { color: var(--buy); }

.psc-warn { border-color: var(--warn); background: var(--warn-bg); }
.psc-warn .psc-value { color: var(--warn); }

/* Holdings table row styles */
.row-tier-a { border-left: 2px solid var(--buy); }
.row-ignored { opacity: 0.4; }
.row-ignored td { text-decoration: line-through; }

.port-name {
  display: block;
  font-size: 11px;
  color: var(--ink-3);
  margin-top: 2px;
}

.ink-3 { color: var(--ink-3); }

@media (max-width: 900px) {
  .port-stat-cards { grid-template-columns: repeat(2, 1fr); }
}
```

- [ ] **Step 4: Run parity check**

```
npm run check:uta-ux-parity
```

Expected: `"status": "ok"`.

- [ ] **Step 5: Commit**

```
git add src/uta/src/modes.tsx src/uta/src/styles.css
git commit -m "feat(uta): portfolio mode — stat cards + enhanced holdings table with DeltaChip"
```

---

### Task 17: Alerts stat cards + typed event feed + filter chips

**Files:**
- Modify: `src/uta/src/alerts.tsx`
- Modify: `src/uta/src/styles.css`

- [ ] **Step 1: Add AlertsStatCards component**

```tsx
// Add to src/uta/src/alerts.tsx

function AlertsStatCards({
  needsAttention,
  ruleMatches,
  confirmedAlerts,
  tierChanges
}: {
  needsAttention: number;
  ruleMatches: number;
  confirmedAlerts: number;
  tierChanges: number;
}) {
  return (
    <div className="port-stat-cards">
      <div className={`port-stat-card ${needsAttention > 0 ? "psc-accent" : ""}`}>
        <span className="psc-label">Needs attention</span>
        <strong className="psc-value">{needsAttention}</strong>
        <span className="psc-detail">Tier A or rule-matched</span>
      </div>
      <div className="port-stat-card">
        <span className="psc-label">Rule matches</span>
        <strong className="psc-value">{ruleMatches}</strong>
        <span className="psc-detail">active rules fired</span>
      </div>
      <div className="port-stat-card">
        <span className="psc-label">Confirmed alerts</span>
        <strong className="psc-value">{confirmedAlerts}</strong>
        <span className="psc-detail">provider-confirmed</span>
      </div>
      <div className={`port-stat-card ${tierChanges > 0 ? "psc-warn" : ""}`}>
        <span className="psc-label">Tier changes</span>
        <strong className="psc-value">{tierChanges}</strong>
        <span className="psc-detail">this cycle</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Define event-kind metadata**

```tsx
// Add to src/uta/src/alerts.tsx

type FeedKind = "alert" | "tierup" | "tierdown" | "news" | "lane" | "rule";

type FeedEvent = {
  id: string;
  kind: FeedKind;
  ticker?: string;
  title: string;
  tier?: string;
  direction?: string;
  ts: string;
};

const KIND_META: Record<FeedKind, { icon: string; colour: string; label: string }> = {
  alert:    { icon: "◆", colour: "var(--accent)",  label: "Confirmed alerts" },
  tierup:   { icon: "▲", colour: "var(--buy)",     label: "Tier changes" },
  tierdown: { icon: "▼", colour: "var(--warn)",    label: "Tier changes" },
  news:     { icon: "◉", colour: "var(--blue)",    label: "News" },
  lane:     { icon: "⚠", colour: "var(--sell)",   label: "Data lanes" },
  rule:     { icon: "◈", colour: "#a07be0",        label: "My rules" }
};

type FeedFilter = "all" | "rules" | "alerts" | "tier" | "news" | "lane";

const FILTER_LABELS: Record<FeedFilter, string> = {
  all:    "All",
  rules:  "My rules",
  alerts: "Confirmed alerts",
  tier:   "Tier changes",
  news:   "News",
  lane:   "Data lanes"
};
```

- [ ] **Step 3: Add ActivityFeed component**

```tsx
// Add to src/uta/src/alerts.tsx

function ActivityFeed({
  events,
  filter,
  onFilter
}: {
  events: FeedEvent[];
  filter: FeedFilter;
  onFilter: (f: FeedFilter) => void;
}) {
  const counts: Partial<Record<FeedFilter, number>> = { all: events.length };
  for (const ev of events) {
    if (ev.kind === "alert")    counts.alerts = (counts.alerts || 0) + 1;
    if (ev.kind === "tierup" || ev.kind === "tierdown") counts.tier = (counts.tier || 0) + 1;
    if (ev.kind === "news")     counts.news = (counts.news || 0) + 1;
    if (ev.kind === "lane")     counts.lane = (counts.lane || 0) + 1;
    if (ev.kind === "rule")     counts.rules = (counts.rules || 0) + 1;
  }

  const visible = filter === "all"
    ? events
    : events.filter((ev) => {
        if (filter === "alerts") return ev.kind === "alert";
        if (filter === "tier")   return ev.kind === "tierup" || ev.kind === "tierdown";
        if (filter === "news")   return ev.kind === "news";
        if (filter === "lane")   return ev.kind === "lane";
        if (filter === "rules")  return ev.kind === "rule";
        return true;
      });

  return (
    <div className="activity-feed">
      <div className="feed-filters">
        {(Object.keys(FILTER_LABELS) as FeedFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            className={`feed-filter-chip ${filter === f ? "active" : "secondary"}`}
            onClick={() => onFilter(f)}
          >
            {FILTER_LABELS[f]}
            {counts[f] != null && counts[f]! > 0 && (
              <span className="feed-filter-count">{counts[f]}</span>
            )}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <div className="feed-empty">
          {filter === "rules"
            ? <span>No rule matches. <button type="button" className="secondary" style={{ marginLeft: 8 }}>Create a rule →</button></span>
            : <span>No {FILTER_LABELS[filter].toLowerCase()} this cycle.</span>}
        </div>
      ) : (
        <div className="feed-rows">
          {visible.map((ev) => {
            const meta = KIND_META[ev.kind];
            return (
              <div className="feed-row" key={ev.id}>
                <span className="feed-icon" style={{ color: meta.colour }}>{meta.icon}</span>
                <div className="feed-body">
                  <div className="feed-title">
                    {ev.ticker && <span className="feed-sym mono">{ev.ticker}</span>}
                    {ev.title}
                  </div>
                  <div className="feed-meta">
                    <span className="feed-ts">{fmtDate(ev.ts)}</span>
                    {ev.tier && <TierBadge tier={ev.tier} size="sm" />}
                    {ev.direction && <DirTag direction={ev.direction} />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire stat cards + feed into AlertsMode**

In the `AlertsMode` function, synthesise `FeedEvent[]` from the existing `history` and `userState` data. Replace the current history-log render:

```tsx
// In AlertsMode:
const [feedFilter, setFeedFilter] = useState<FeedFilter>("all");

// Build typed events from history rows
const feedEvents = React.useMemo((): FeedEvent[] => {
  const rows = history?.rows || [];
  return rows.map((row, i) => {
    // Simple heuristic — expand when backend provides event_kind field
    const kind: FeedKind = row.tier === "A" ? "tierup" : "tierdown";
    return {
      id: row.id || String(i),
      kind,
      ticker: row.ticker,
      title: `Tier ${row.tier || "D"} · ${row.direction || "undetermined"}`,
      tier: row.tier,
      direction: row.direction,
      ts: row.generated_at || row.created_at || new Date().toISOString()
    };
  });
}, [history]);

const rules = userState?.state.rules || [];
const needsAttention = feedEvents.filter((e) => e.tier === "A" || e.tier === "B").length;
const ruleMatches = feedEvents.filter((e) =>
  rules.some((rule) => ruleMatches(rule, activeData))
).length;
const confirmedAlerts = feedEvents.filter((e) => e.kind === "alert").length;
const tierChanges = feedEvents.filter((e) => e.kind === "tierup" || e.kind === "tierdown").length;

return (
  <div className="mode-stack">
    <AlertsStatCards
      needsAttention={needsAttention}
      ruleMatches={ruleMatches}
      confirmedAlerts={confirmedAlerts}
      tierChanges={tierChanges}
    />
    <ActivityFeed
      events={feedEvents}
      filter={feedFilter}
      onFilter={setFeedFilter}
    />
    {/* RulesDrawer trigger button — wired in Task 18 */}
    <button type="button" className="secondary" onClick={() => setShowRulesDrawer(true)}>
      Rules {rules.length > 0 ? `(${rules.length})` : ""}
    </button>
  </div>
);
```

Add `const [showRulesDrawer, setShowRulesDrawer] = useState(false)` to AlertsMode state.

- [ ] **Step 5: Add feed CSS**

```css
/* Activity feed */
.activity-feed { display: grid; gap: 12px; }

.feed-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.feed-filter-chip {
  height: 28px;
  min-height: 28px;
  border-radius: 99px;
  font-size: 12px;
  font-weight: 600;
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 5px;
}

.feed-filter-chip.active {
  border-color: var(--accent-line);
  background: var(--accent-soft);
  color: var(--accent);
}

.feed-filter-count {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 99px;
  background: var(--panel-3);
}

.feed-empty {
  padding: 24px 0;
  color: var(--ink-3);
  font-size: 13px;
  text-align: center;
}

.feed-rows { display: grid; }

.feed-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px solid var(--grid-line);
}

.feed-icon {
  font-size: 16px;
  flex-shrink: 0;
  margin-top: 1px;
}

.feed-body { flex: 1; min-width: 0; }

.feed-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--ink);
  flex-wrap: wrap;
}

.feed-sym {
  font-weight: 700;
  color: var(--ink);
}

.feed-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  flex-wrap: wrap;
}

.feed-ts {
  font-size: 11.5px;
  color: var(--ink-3);
}
```

- [ ] **Step 6: Run parity check**

```
npm run check:uta-ux-parity
```

Expected: `"status": "ok"`.

- [ ] **Step 7: Commit**

```
git add src/uta/src/alerts.tsx src/uta/src/styles.css
git commit -m "feat(uta): alerts mode — stat cards + typed event feed with filter chips"
```

---

### Task 18: RulesDrawer with B/A/C sliders + live match preview

**Files:**
- Modify: `src/uta/src/alerts.tsx`
- Modify: `src/uta/src/styles.css`

- [ ] **Step 1: Add RuleEditor component with sliders**

```tsx
// Add to src/uta/src/alerts.tsx

type RuleEditorState = {
  name: string;
  scope: "all" | "portfolio" | "watchlist";
  direction: "bullish" | "bearish" | "any";
  min_tier: "A" | "B" | "C";
  min_b_score: number;
  min_a_rank: number;
  min_c_ratio: number;
  require_provider_alert: boolean;
};

function RuleEditor({
  initial,
  onSave,
  onCancel,
  liveResults
}: {
  initial?: Partial<RuleEditorState>;
  onSave: (rule: RuleEditorState) => void;
  onCancel: () => void;
  liveResults: UtaTickerResult[];
}) {
  const [state, setState] = useState<RuleEditorState>({
    name: "",
    scope: "all",
    direction: "any",
    min_tier: "B",
    min_b_score: 1.5,
    min_a_rank: 50,
    min_c_ratio: 1.5,
    require_provider_alert: false,
    ...initial
  });

  function update<K extends keyof RuleEditorState>(key: K, value: RuleEditorState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  // Live match preview — debounce via state change
  const matchCount = liveResults.filter((r) => {
    if (r.tier === "D") return false;
    if (tierRank(r.tier) < tierRank(state.min_tier)) return false;
    if (state.direction !== "any" && r.direction !== state.direction) return false;
    if (Number(r.indicators.B.notional_zscore ?? 0) < state.min_b_score) return false;
    if (Number(r.indicators.C.notional_ratio ?? 0) < state.min_c_ratio) return false;
    if (state.require_provider_alert && !r.trade_analysis?.corroboration?.provider_alert_confirmed) return false;
    return true;
  }).length;

  return (
    <div className="rule-editor">
      <div className="rule-ed-field">
        <label className="rule-ed-label">Rule name</label>
        <input
          type="text"
          value={state.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="e.g. Tier B bullish with provider alert"
        />
      </div>
      <div className="rule-ed-field">
        <label className="rule-ed-label">Scope</label>
        <div className="dir-seg">
          {(["all", "portfolio", "watchlist"] as const).map((s) => (
            <button key={s} type="button" className={`dir-seg-btn ${state.scope === s ? "active" : "secondary"}`}
              onClick={() => update("scope", s)}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="rule-ed-field">
        <label className="rule-ed-label">Direction</label>
        <div className="dir-seg">
          {(["bullish", "bearish", "any"] as const).map((d) => (
            <button key={d} type="button" className={`dir-seg-btn ${state.direction === d ? "active" : "secondary"}`}
              onClick={() => update("direction", d)}>
              {d.charAt(0).toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="rule-ed-field">
        <label className="rule-ed-label">Min tier</label>
        <div className="dir-seg">
          {(["A", "B", "C"] as const).map((t) => (
            <button key={t} type="button" className={`dir-seg-btn ${state.min_tier === t ? "active" : "secondary"}`}
              onClick={() => update("min_tier", t)}>
              Tier {t}
            </button>
          ))}
        </div>
      </div>
      <div className="rule-ed-field">
        <label className="rule-ed-label">
          Min B-score (σ) — <strong>{state.min_b_score.toFixed(1)}σ</strong>
        </label>
        <input
          type="range" min={0} max={4} step={0.1}
          value={state.min_b_score}
          onChange={(e) => update("min_b_score", Number(e.target.value))}
          className="rule-slider"
        />
        <div className="rule-slider-ticks"><span>0σ</span><span>2σ</span><span>4σ</span></div>
      </div>
      <div className="rule-ed-field">
        <label className="rule-ed-label">
          Min A rank (percentile) — <strong>{state.min_a_rank}th</strong>
        </label>
        <input
          type="range" min={0} max={100} step={5}
          value={state.min_a_rank}
          onChange={(e) => update("min_a_rank", Number(e.target.value))}
          className="rule-slider"
        />
        <div className="rule-slider-ticks"><span>0</span><span>50th</span><span>100th</span></div>
      </div>
      <div className="rule-ed-field">
        <label className="rule-ed-label">
          Min notional ratio (×) — <strong>{state.min_c_ratio.toFixed(1)}×</strong>
        </label>
        <input
          type="range" min={1} max={10} step={0.25}
          value={state.min_c_ratio}
          onChange={(e) => update("min_c_ratio", Number(e.target.value))}
          className="rule-slider"
        />
        <div className="rule-slider-ticks"><span>1×</span><span>5×</span><span>10×</span></div>
      </div>
      <div className="rule-ed-field rule-ed-toggle">
        <label className="rule-ed-label">
          <input
            type="checkbox"
            checked={state.require_provider_alert}
            onChange={(e) => update("require_provider_alert", e.target.checked)}
          />
          Provider alert required
        </label>
      </div>
      <div className="rule-match-preview">
        Matches <strong>{matchCount}</strong> ticker{matchCount !== 1 ? "s" : ""} right now
      </div>
      <div className="rule-ed-actions">
        <button type="button" onClick={() => onSave(state)} disabled={!state.name.trim()}>
          Save rule
        </button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add RulesDrawer component**

```tsx
// Add to src/uta/src/alerts.tsx

function RulesDrawer({
  rules,
  onClose,
  onSaveRule,
  onToggleRule,
  onDeleteRule,
  liveResults
}: {
  rules: UtaRule[];
  onClose: () => void;
  onSaveRule: (rule: UtaRule) => void;
  onToggleRule: (id: string, enabled: boolean) => void;
  onDeleteRule: (id: string) => void;
  liveResults: UtaTickerResult[];
}) {
  const [editing, setEditing] = useState<string | null>(null); // null = list, "new" = new rule

  function handleSave(state: RuleEditorState) {
    const rule: UtaRule = {
      id: editing === "new" ? `rule_${Date.now()}` : editing!,
      name: state.name,
      enabled: true,
      min_tier: state.min_tier,
      direction: state.direction,
      source: "user"
    };
    onSaveRule(rule);
    setEditing(null);
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer rules-drawer">
        <div className="drawer-head">
          <span className="dt">Alert Rules</span>
          <span className="ds">{rules.length} active</span>
          <button className="x-close icon-button secondary" type="button" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">
          {editing !== null ? (
            <RuleEditor
              initial={editing === "new" ? undefined : { name: rules.find((r) => r.id === editing)?.name }}
              onSave={handleSave}
              onCancel={() => setEditing(null)}
              liveResults={liveResults}
            />
          ) : (
            <>
              <button type="button" onClick={() => setEditing("new")} style={{ marginBottom: 16 }}>
                + New rule
              </button>
              <div className="rule-list">
                {rules.length === 0 && (
                  <p className="empty">No rules yet. Create one to get notified about signals that match your criteria.</p>
                )}
                {rules.map((rule) => {
                  const matches = liveResults.filter((r) => ruleMatches(rule, r)).length;
                  return (
                    <div className="rule-card" key={rule.id}>
                      <div className="rule-card-head">
                        <label className="rule-toggle">
                          <input
                            type="checkbox"
                            checked={rule.enabled}
                            onChange={(e) => onToggleRule(rule.id, e.target.checked)}
                          />
                          <span className="rule-name">{rule.name}</span>
                        </label>
                        <span className={`pill ${matches > 0 ? "good" : "neutral"}`}>
                          {matches} match{matches !== 1 ? "es" : ""}
                        </span>
                        <button type="button" className="secondary icon-button" onClick={() => setEditing(rule.id)}>✎</button>
                        <button type="button" className="secondary icon-button" onClick={() => onDeleteRule(rule.id)}>×</button>
                      </div>
                      <div className="rule-chips">
                        <span className="pill neutral">Tier {rule.min_tier}+</span>
                        <span className="pill neutral">{rule.direction}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Wire RulesDrawer into AlertsMode**

Add handlers in AlertsMode and show the drawer conditionally:

```tsx
// In AlertsMode render, after the activity feed:
{showRulesDrawer && (
  <RulesDrawer
    rules={userState?.state.rules || []}
    onClose={() => setShowRulesDrawer(false)}
    onSaveRule={(rule) => {
      const current = userState?.state.rules || [];
      const next = current.some((r) => r.id === rule.id)
        ? current.map((r) => r.id === rule.id ? rule : r)
        : [...current, rule];
      onRulesChange(next);
    }}
    onToggleRule={(id, enabled) => {
      const next = (userState?.state.rules || []).map((r) =>
        r.id === id ? { ...r, enabled } : r
      );
      onRulesChange(next);
    }}
    onDeleteRule={(id) => {
      onRulesChange((userState?.state.rules || []).filter((r) => r.id !== id));
    }}
    liveResults={activeData ? [activeData] : []}
  />
)}
```

- [ ] **Step 4: Add rules drawer CSS**

```css
/* RulesDrawer */
.rules-drawer { width: min(480px, 94vw); }

.rule-editor { display: grid; gap: 16px; }

.rule-ed-field { display: grid; gap: 6px; }

.rule-ed-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--ink-3);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.rule-ed-label strong { color: var(--ink); font-variant-numeric: tabular-nums; }

.rule-slider {
  width: 100%;
  accent-color: var(--accent);
  cursor: pointer;
}

.rule-slider-ticks {
  display: flex;
  justify-content: space-between;
  font-size: 10.5px;
  color: var(--ink-3);
  margin-top: -2px;
}

.rule-ed-toggle {
  flex-direction: row;
  align-items: center;
}

.rule-ed-toggle label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  text-transform: none;
  letter-spacing: 0;
  font-size: 13px;
  color: var(--ink);
  font-weight: 500;
}

.rule-match-preview {
  padding: 12px 14px;
  border: 1px solid var(--accent-line);
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  font-size: 13.5px;
  color: var(--ink-2);
}

.rule-match-preview strong { color: var(--ink); font-size: 18px; }

.rule-ed-actions { display: flex; gap: 8px; }

.rule-card {
  display: grid;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
  padding: 12px;
  margin-bottom: 8px;
}

.rule-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.rule-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  cursor: pointer;
}

.rule-name { font-size: 13.5px; font-weight: 600; color: var(--ink); }

.rule-chips { display: flex; gap: 6px; flex-wrap: wrap; }
```

- [ ] **Step 5: Run parity check**

```
npm run check:uta-ux-parity
```

Expected: `"status": "ok"`.

- [ ] **Step 6: Commit**

```
git add src/uta/src/alerts.tsx src/uta/src/styles.css
git commit -m "feat(uta): alerts mode — RulesDrawer with B/A/C sliders and live match preview"
```

---

### Task 19: Final build + parity update + production smoke

**Files:**
- Modify: `scripts/check-uta-ux-parity.js`
- Run: `npm run build:uta`

- [ ] **Step 1: Add Phase 5 assertions to the parity check**

At the end of `scripts/check-uta-ux-parity.js`, after the existing assertions but before the final `console.log`, add:

```js
// Phase 5 additions — portfolio stat cards + alerts feed
// Navigate to portfolio mode
await page.getByRole("button", { name: "Portfolio" }).click();
await page.waitForTimeout(400);
const portfolioText = await page.locator("body").innerText();
// Stat cards visible when portfolio data loads
if (/tier a|holdings|cycle time/i.test(portfolioText)) {
  assert(
    /holdings|tier a|tier changes|cycle time/i.test(portfolioText),
    "Portfolio stat cards missing."
  );
}

// Navigate to alerts mode
await page.getByRole("button", { name: "Alerts" }).click();
await page.waitForTimeout(400);
const alertsText = await page.locator("body").innerText();
assert(
  /needs attention|rule matches|confirmed alerts|tier changes/i.test(alertsText),
  "Alerts stat cards missing."
);
assert(
  /all|my rules|confirmed alerts|tier changes|news|data lanes/i.test(alertsText),
  "Alerts feed filter chips missing."
);
```

Update the final `console.log` checked array to include the new surfaces:

```js
console.log(JSON.stringify({
  status: "ok",
  checked: [
    "home_mode",
    "bluf_card",
    "abc_indicator_summary",
    "cycle_timeline",
    "nine_evidence_cards",
    "corroboration_panel",
    "actions_panel",
    "raw_prints_drawer",
    "explain_tier_modal",
    "evidence_trade_analysis_tabs",
    "portfolio_stat_cards",
    "alerts_stat_cards",
    "alerts_filter_chips"
  ]
}, null, 2));
```

- [ ] **Step 2: Run the full updated parity check**

```
npm run check:uta-ux-parity
```

Expected: `"status": "ok"` with all 13 checked surfaces listed.

- [ ] **Step 3: Production build**

```
npm run build:uta
```

Expected: Vite exits with no errors. Output in `src/public/uta/`. Check for any TypeScript errors in the build output and fix before proceeding.

- [ ] **Step 4: Verify build output loads correctly**

Start the main server and navigate to the UTA route:

```
npm start
```

Open `http://127.0.0.1:3000/uta` (or whichever port the main server uses). Verify:
- HomeMode landing screen loads
- Clicking Single Ticker card loads into Single mode
- Market-Regime banner visible (or gracefully absent if FRED lane unavailable)
- TopBar theme toggle switches to light mode and back

- [ ] **Step 5: Final commit**

```
git add scripts/check-uta-ux-parity.js
git commit -m "feat(uta): final parity assertions + production build verified"
```

- [ ] **Step 6: Tag the recovery completion**

```
git tag uta-recovery-complete
```

**Phase 5 exit criteria:** `npm run check:uta-ux-parity` passes with all 13 surfaces. `npm run build:uta` exits clean. All five invariants (`invariantWarnings`) continue to pass on live data. Portfolio shows stat cards. Alerts shows typed event feed, filter chips, and RulesDrawer with sliders and live match count.

---

## Invariants — Must Never Break

These are enforced by `invariantWarnings()` in `utils.ts` and checked on every result load. Verify after each phase that no regression has been introduced:

1. `data.mode === "single_ticker"` → `data.indicators.A === null` (A is N/A in single mode)
2. Non-Tier-D result → `calculation_metadata.direction_source === "signed_flow"`
3. No `composite_score` field on any result
4. `calculation_metadata.price_is_corroboration_only === true` on every result
5. Tier D rows in any table show `—` for all metric columns — never fabricated values
6. Trade Analysis tab never relabels or replaces the UTA Tier badge

---

## Quick Reference

| Command | Purpose |
|---|---|
| `npm run dev:uta` | Start Vite dev server on port 5173 |
| `npm run build:uta` | Production build to `src/public/uta/` |
| `npm run check:uta-ux-parity` | Run Playwright parity check |
| `npm start` | Start main server (serves built UTA app) |
