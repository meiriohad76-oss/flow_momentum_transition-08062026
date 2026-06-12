// src/uta/src/components.tsx
import React from "react";
import { fmtNumber, fmtPct } from "./utils.js";
import type { UtaTickerResult } from "./types.js";

/* ---------- icon set ---------- */
const ICONS: Record<string, string> = {
  search: "M11 4a7 7 0 105.2 11.7l4 4 1.4-1.4-4-4A7 7 0 0011 4zm0 2a5 5 0 110 10 5 5 0 010-10z",
  chevron: "M6 9l6 6 6-6",
  refresh: "M4 4v5h5M20 20v-5h-5M19 9a7 7 0 00-13-2M5 15a7 7 0 0013 2",
  bolt: "M13 2L4 14h6l-1 8 9-12h-6l1-8z",
  layers: "M12 3l9 5-9 5-9-5 9-5zm-9 9l9 5 9-5M3 16l9 5 9-5",
  activity: "M3 12h4l3 8 4-16 3 8h4",
  database: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zm8 4.5v5c0 1.7-3.6 3-8 3s-8-1.3-8-3v-5M4 12.5v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5",
  shield: "M12 3l8 3v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-3z",
  bell: "M18 9a6 6 0 10-12 0c0 6-3 7-3 7h18s-3-1-3-7M10 21a2 2 0 004 0",
  trend: "M3 17l6-6 4 4 8-8M21 7v5h-5",
  premarket: "M12 3v3M5.6 5.6l2.1 2.1M3 12h3M18 12h3M12 20a5 5 0 100-10 5 5 0 000 10z",
  check: "M5 12l4 4L19 7",
  alert: "M12 3l9 16H3L12 3zm0 6v5m0 3v.5",
  sparkle: "M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z",
  flag: "M5 21V4m0 0l11 2-2 5 2 5-11-2",
  up: "M7 17L17 7M9 7h8v8",
  down: "M7 7l10 10M17 9v8H9",
};

export function Icon({ name, size = 16, className = "" }: { name: string; size?: number; className?: string }) {
  const d = ICONS[name] || "";
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {d.split("M").filter(Boolean).map((seg, i) => <path key={i} d={"M" + seg} />)}
    </svg>
  );
}

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
  const W = 200;
  const H = height;

  function toX(i: number) { return (i / (values.length - 1)) * W; }
  function toY(v: number) { return H - ((v - min) / range) * H; }

  const points = values.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
  const baselineY = toY(baseline).toFixed(1);

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
      <line
        x1={0} y1={baselineY} x2={W} y2={baselineY}
        stroke="var(--line-strong)" strokeWidth={1} strokeDasharray="4 3"
      />
      <polygon points={fillPoints} fill={fillColour} opacity={0.6} />
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

export function ConfBar({
  value,
  label
}: {
  value: number;
  label?: string;
}) {
  const pct = Math.min(1, Math.max(0, value));
  const display = label ?? `${Math.round(pct * 100)}%`;
  const fillColor = pct < 0.5 ? "var(--sell)" : "var(--accent)";
  return (
    <div className="conf-bar-wrap">
      <div className="conf-bar-track">
        <div
          className="conf-bar-fill"
          style={{ width: `${pct * 100}%`, background: fillColor }}
        />
      </div>
      <span className="conf-bar-label" style={{ color: pct < 0.5 ? "var(--sell)" : undefined }}>{display}</span>
    </div>
  );
}

export function PressureGauge({ value }: { value: number }) {
  const clamped = Math.min(1, Math.max(-1, value));
  const pct = Math.abs(clamped) * 50;
  const isBull = clamped >= 0;
  const fillColour = isBull ? "var(--buy)" : "var(--sell)";
  const label = `${isBull ? "+" : ""}${Math.round(clamped * 100)}%`;

  return (
    <div className="pressure-gauge" aria-label={`Pressure ${label}`}>
      <div className="pg-track">
        <div className="pg-half pg-left">
          {!isBull && (
            <div className="pg-fill pg-fill-left" style={{ width: `${pct}%`, background: fillColour }} />
          )}
        </div>
        <div className="pg-centre" />
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

export type VolSeries = { bucket: string; baseline: number; value: number };

/** Render time-bucketed session bars vs 20-day baseline ghost bars, color-coded by ratio. */
export function VolBars({ series }: { series: VolSeries[] }) {
  if (!series || series.length === 0) return null;
  const W = 240, H = 56;
  const max = Math.max(...series.map((s) => Math.max(s.value, s.baseline)), 1);
  const bw = W / series.length;
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H + 14}`} style={{ height: H + 14, width: "100%" }}>
      {series.map((s, i) => {
        const x = i * bw;
        const vH = (s.value / max) * H;
        const bH = (s.baseline / max) * H;
        const hot = s.baseline > 0 ? s.value / s.baseline : 0;
        const col = hot >= 2.5 ? "var(--sell)" : hot >= 1.6 ? "var(--accent)" : "var(--ink-3)";
        return (
          <g key={i}>
            {/* ghost baseline bar */}
            <rect x={x + bw * 0.18} y={H - bH} width={bw * 0.64} height={bH} rx="2" fill="var(--border-strong)" opacity="0.5" />
            {/* solid session bar */}
            <rect x={x + bw * 0.28} y={H - vH} width={bw * 0.44} height={vH} rx="2" fill={col} />
            <text x={x + bw / 2} y={H + 11} textAnchor="middle" fontSize="8" fill="var(--ink-3)" fontFamily="var(--font-ui)">{s.bucket}</text>
          </g>
        );
      })}
    </svg>
  );
}

function _simpleHash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Generate a deterministic 6-bucket intraday volume series from a UtaTickerResult.
 * Baseline shape follows typical intraday liquidity curve; session values scale
 * by the overall volume ratio with per-ticker seeded noise.
 */
export function volSeriesFromResult(data: UtaTickerResult): VolSeries[] {
  const vr = Math.max(0.1, Number(data.indicators.C.volume_ratio ?? 1));
  const buckets = ["Open", "Morn", "Mid", "Aft", "Power", "Close"];
  const baselines = [1.0, 0.72, 0.55, 0.60, 0.85, 1.10];
  let seed = _simpleHash(data.ticker);
  return buckets.map((bucket, i) => {
    seed = ((seed * 1664525 + 1013904223) >>> 0);
    const noise = 0.8 + (seed / 4294967296) * 0.5;
    const baseline = baselines[i];
    const value = +(baseline * vr * noise).toFixed(2);
    return { bucket, baseline, value };
  });
}

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

export function IndicatorGrid({ data, portfolioMode = false }: { data: UtaTickerResult; portfolioMode?: boolean }) {
  // Tier D has no indicators — suppress the grid entirely
  if (String(data.tier || "D").toUpperCase() === "D") return null;
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
