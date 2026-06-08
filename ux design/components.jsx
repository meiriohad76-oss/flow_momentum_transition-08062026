/* ============================================================
   Shared primitives — exported to window
   ============================================================ */
const { useState, useEffect, useRef, useMemo, useContext } = React;
const DetailCtx = React.createContext(null);

/* ---------- icon set ---------- */
const ICONS = {
  search: 'M11 4a7 7 0 105.2 11.7l4 4 1.4-1.4-4-4A7 7 0 0011 4zm0 2a5 5 0 110 10 5 5 0 010-10z',
  chevron: 'M6 9l6 6 6-6',
  refresh: 'M4 4v5h5M20 20v-5h-5M19 9a7 7 0 00-13-2M5 15a7 7 0 0013 2',
  target: 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 4a5 5 0 100 10 5 5 0 000-10zm0 4a1 1 0 100 2 1 1 0 000-2z',
  briefcase: 'M3 8h18v11a2 2 0 01-2 2H5a2 2 0 01-2-2V8zm6-3h6a2 2 0 012 2v1H7V7a2 2 0 012-2z',
  layers: 'M12 3l9 5-9 5-9-5 9-5zm-9 9l9 5 9-5M3 16l9 5 9-5',
  sun: 'M12 7a5 5 0 100 10 5 5 0 000-10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  sliders: 'M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4M14 4v4M6 10v4M12 16v4',
  check: 'M5 12l4 4L19 7',
  alert: 'M12 3l9 16H3L12 3zm0 6v5m0 3v.5',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 5v.5m0 3.5v5',
  bolt: 'M13 2L4 14h6l-1 8 9-12h-6l1-8z',
  up: 'M7 17L17 7M9 7h8v8',
  down: 'M7 7l10 10M17 9v8H9',
  activity: 'M3 12h4l3 8 4-16 3 8h4',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 4v5l3 2',
  database: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zm8 4.5v5c0 1.7-3.6 3-8 3s-8-1.3-8-3v-5M4 12.5v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5',
  shield: 'M12 3l8 3v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-3z',
  bell: 'M18 9a6 6 0 10-12 0c0 6-3 7-3 7h18s-3-1-3-7M10 21a2 2 0 004 0',
  flag: 'M5 21V4m0 0l11 2-2 5 2 5-11-2',
  bookmark: 'M6 3h12v18l-6-4-6 4V3z',
  trend: 'M3 17l6-6 4 4 8-8M21 7v5h-5',
  wave: 'M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0',
  premarket: 'M12 3v3M5.6 5.6l2.1 2.1M3 12h3M18 12h3M12 20a5 5 0 100-10 5 5 0 000 10z',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 100-6 3 3 0 000 6z',
  filter: 'M3 5h18l-7 8v6l-4-2v-4L3 5z',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  dot: 'M12 9a3 3 0 100 6 3 3 0 000-6z',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z',
  hash: 'M4 9h16M4 15h16M10 3L8 21M16 3l-2 18',
  columns: 'M3 4h18v16H3zM10 4v16M17 4v16',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  cog: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19.4 13a7.9 7.9 0 000-2l1.9-1.5-2-3.4-2.3 1a8 8 0 00-1.7-1L17 3h-4l-.3 2.6a8 8 0 00-1.7 1l-2.3-1-2 3.4L8.6 11a7.9 7.9 0 000 2l-1.9 1.5 2 3.4 2.3-1a8 8 0 001.7 1L13 21h4l.3-2.6a8 8 0 001.7-1l2.3 1 2-3.4z',
  play: 'M7 5v14l11-7z',
  pause: 'M8 5v14M16 5v14',
  inbox: 'M4 13h4l2 3h4l2-3h4M4 13l2-8h12l2 8v5a2 2 0 01-2 2H6a2 2 0 01-2-2z',
  rewind: 'M11 6L3 12l8 6V6zM21 6l-8 6 8 6V6z',
};
function Icon({ name, size = 16, className = '', fill = false }) {
  const d = ICONS[name] || '';
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24"
      fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'}
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.split('M').filter(Boolean).map((seg, i) => <path key={i} d={'M' + seg} />)}
    </svg>
  );
}

/* ---------- tier badge ---------- */
function TierBadge({ tier, size = '', word = false }) {
  const cls = `tier-badge t-${tier.toLowerCase()} ${size}`;
  if (!word) return <span className={cls}>{tier}</span>;
  const words = { A: 'Actionable', B: 'Review', C: 'Context only', D: 'Suppressed' };
  return (
    <span className="tier-line">
      <span className={cls}>{tier}</span>
      <span className="tier-word">Tier {tier} · {words[tier]}</span>
    </span>
  );
}

/* ---------- direction tag ---------- */
function DirTag({ dir, label }) {
  const map = { bullish: { c: 'bull', a: '↑', t: 'Buyer-side' }, bearish: { c: 'bear', a: '↓', t: 'Seller-side' },
    mixed: { c: 'mixed', a: '↔', t: 'Mixed' }, undetermined: { c: 'undet', a: '–', t: 'Undetermined' } };
  const m = map[dir] || map.undetermined;
  return <span className={`dir-tag ${m.c}`}><span className="arrow">{m.a}</span>{label || m.t}</span>;
}

/* ---------- indicator chip ---------- */
function IndChip({ kind, label, value, sub, na }) {
  return (
    <div className={`ind-chip ${kind} ${na ? 'na' : ''}`}>
      <span className="lab">{label}</span>
      <span className="val">{na ? 'N/A' : value}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}

/* ---------- band ---------- */
function Band({ band }) {
  if (!band) return null;
  return <span className={`band-tag ${band.toLowerCase()}`}>{band}</span>;
}

/* ---------- sparkline (line) ---------- */
function Sparkline({ data, color, h = 40, fill = true, zero = false }) {
  const w = 240;
  const min = Math.min(...data, zero ? -1 : Math.min(...data));
  const max = Math.max(...data, zero ? 1 : Math.max(...data));
  const rng = (max - min) || 1;
  const pts = data.map((v, i) => [ (i / (data.length - 1)) * w, h - ((v - min) / rng) * (h - 6) - 3 ]);
  const dLine = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const zeroY = zero ? h - ((0 - min) / rng) * (h - 6) - 3 : null;
  const id = useMemo(() => 'sg' + Math.random().toString(36).slice(2, 8), []);
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ height: h }}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={color} stopOpacity="0.22" /><stop offset="1" stopColor={color} stopOpacity="0" />
      </linearGradient></defs>
      {zero && <line x1="0" y1={zeroY} x2={w} y2={zeroY} stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="2 3" />}
      {fill && <path d={`${dLine} L ${w} ${h} L 0 ${h} Z`} fill={`url(#${id})`} />}
      <path d={dLine} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.6" fill={color} />
    </svg>
  );
}

/* ---------- volume bars vs baseline ---------- */
function VolBars({ series }) {
  const w = 240, h = 56;
  const max = Math.max(...series.map(s => Math.max(s.value, s.baseline))) || 1;
  const bw = w / series.length;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h + 14}`} style={{ height: h + 14 }}>
      {series.map((s, i) => {
        const x = i * bw, vH = (s.value / max) * h, bH = (s.baseline / max) * h;
        const hot = s.value / s.baseline;
        const col = hot >= 2.5 ? 'var(--sell)' : hot >= 1.6 ? 'var(--accent)' : 'var(--ink-3)';
        return (
          <g key={i}>
            <rect x={x + bw * 0.18} y={h - bH} width={bw * 0.64} height={bH} rx="2" fill="var(--border-strong)" opacity="0.5" />
            <rect x={x + bw * 0.28} y={h - vH} width={bw * 0.44} height={vH} rx="2" fill={col} />
            <text x={x + bw / 2} y={h + 11} textAnchor="middle" fontSize="8" fill="var(--ink-3)" fontFamily="var(--font-ui)">{s.bucket}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- pressure gauge ---------- */
function PressureGauge({ value }) {
  const pct = ((value + 1) / 2) * 100;
  const col = value > 0.05 ? 'var(--buy)' : value < -0.05 ? 'var(--sell)' : 'var(--ink-3)';
  return (
    <div className="gauge">
      <div className="mid" />
      <div className="needle" style={{ left: pct + '%', background: col }} />
    </div>
  );
}

/* ---------- confidence bar ---------- */
function ConfBar({ value, color = 'var(--accent)' }) {
  return <div className="conf"><span style={{ width: Math.round(value * 100) + '%', background: value < 0.5 ? 'var(--sell)' : color }} /></div>;
}

/* ---------- signing mix ---------- */
function MixBar({ mix }) {
  const segs = [
    { k: 'quote', label: 'Quote rule', col: 'var(--accent)' },
    { k: 'tick', label: 'Tick test', col: '#7c9bf2' },
    { k: 'mid', label: 'Midpoint (excl.)', col: 'var(--ink-faint)' },
    { k: 'unknown', label: 'Unknown', col: 'var(--border-strong)' },
  ];
  return (
    <div>
      <div className="mix-bar">{segs.map(s => <span key={s.k} style={{ width: (mix[s.k] * 100) + '%', background: s.col }} />)}</div>
      <div className="mix-legend">{segs.map(s => (
        <span key={s.k} className="li"><span className="sw" style={{ background: s.col }} />{s.label} {Math.round(mix[s.k] * 100)}%</span>
      ))}</div>
    </div>
  );
}

/* ---------- delta chip ---------- */
function DeltaChip({ delta }) {
  if (!delta || delta.b == null || delta.b === 0) return <span className="pill" style={{ fontSize: 11 }}>— flat</span>;
  const up = delta.b > 0;
  return <span className="pill" style={{ fontSize: 11, color: up ? 'var(--buy)' : 'var(--sell)' }}>
    <Icon name={up ? 'up' : 'down'} size={11} />{(up ? '+' : '') + delta.b.toFixed(1)}σ
  </span>;
}

Object.assign(window, { Icon, TierBadge, DirTag, IndChip, Band, Sparkline, VolBars, PressureGauge, ConfBar, MixBar, DeltaChip,
  DetailCtx, React, useState, useEffect, useRef, useMemo, useContext });
