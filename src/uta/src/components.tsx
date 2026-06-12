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

export function volMetricsFromResult(data: UtaTickerResult, direction?: string): VolMetric[] {
  const dir = direction === "bullish" ? "bull" : direction === "bearish" ? "bear" : undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blockFlow = (data.trade_analysis as any)?.block_flow;
  return [
    { label: "Vol", ratio: Number(data.indicators.C.volume_ratio ?? 1), direction: dir },
    { label: "Notional", ratio: Number(data.indicators.C.notional_ratio ?? 1), direction: dir },
    { label: "Trades", ratio: blockFlow?.focus_trade_count > 0 ? 1.5 : 0.5, direction: dir }
  ];
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
