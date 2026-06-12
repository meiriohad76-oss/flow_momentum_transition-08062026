// src/uta/src/components.tsx
import React from "react";
import { fmtNumber, fmtPct } from "./utils.js";
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
  const normalized = String(tier || "D").toUpperCase();
  return <span className={`tier-badge tier-ring t-${normalized.toLowerCase()} tier-${normalized.toLowerCase()} ${size}`}>{normalized}</span>;
}

export function DirTag({ direction }: { direction?: string }) {
  const dir = direction || "undetermined";
  const arrow = dir === "bullish" ? "↑" : dir === "bearish" ? "↓" : "↔";
  const label = dir === "bullish" ? "Buyer-side" : dir === "bearish" ? "Seller-side" : "Undetermined";
  return <span className={`dir-tag ${dir === "bullish" ? "bull" : dir === "bearish" ? "bear" : "undet"} ${dir}`}>{arrow} {label}</span>;
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
        <strong>{a === null ? "N/A" : fmtPct((a as Record<string, unknown>).volume_percentile)}</strong>
        <small>{a === null ? "single-ticker mode by design" : String((a as Record<string, unknown>).scope_label || "peer ranked context")}</small>
      </article>
      <article className="ind-chip C c">
        <span>C · raw magnitude</span>
        <strong>{fmtNumber(c.nr, 2)}x notional</strong>
        <small>{fmtNumber(c.vr, 2)}x vol · {fmtPct(c.nnp)} pressure · {c.fcount ?? 0} focus prints</small>
      </article>
    </div>
  );
}
