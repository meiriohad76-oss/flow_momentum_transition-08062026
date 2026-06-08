/* ============================================================
   Detail extras — raw prints, explain tier, compare,
   lane legend, landing screen
   ============================================================ */
const Ufmt = window.UTA.fmtMoney;
function triggerRevalidate() { window.dispatchEvent(new CustomEvent('uta:revalidate')); }

/* ---------- deterministic raw-print generator ---------- */
function rngFrom(str) { let s = 0; for (let i = 0; i < str.length; i++) s = (s * 31 + str.charCodeAt(i)) >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function genRawPrints(t) {
  if (!t.C || t.C.total == null) return [];
  const r = rngFrom(t.symbol);
  const rows = [];
  const n = 22;
  const base = t.price;
  const bull = (t.C.nnp || 0) >= 0;
  for (let i = 0; i < n; i++) {
    const isFocus = i < (t.C.fcount || 0) || r() < 0.18;
    const big = isFocus ? (t.C.largest * (0.4 + r() * 0.6)) : (t.C.total / 600) * (0.2 + r() * 1.4);
    const price = +(base * (1 + (r() - 0.5) * 0.004)).toFixed(2);
    const size = Math.max(100, Math.round(big / price / 100) * 100);
    const notional = price * size;
    const venue = isFocus ? (r() < 0.7 ? 'trf_off_exchange' : 'trf_ats') : (r() < 0.25 ? 'trf_unclassified' : 'lit_exchange');
    const buy = r() < (bull ? 0.66 : 0.34);
    const method = r() < 0.66 ? 'quote' : r() < 0.84 ? 'tick' : r() < 0.94 ? 'mid' : 'unk';
    const signed = method === 'mid' || method === 'unk' ? 'unknown' : (buy ? 'buy' : 'sell');
    const codes = [];
    if (r() < 0.12) codes.push('F');
    if (i === 0) codes.push('O');
    const hh = 9 + Math.floor(r() * 6); const mm = Math.floor(r() * 60); const ss = Math.floor(r() * 60);
    rows.push({ ts: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`, price, size, notional, venue, signed, method, codes, isFocus });
  }
  return rows.sort((a, b) => b.notional - a.notional);
}

function RawPrintsDrawer() {
  const ctx = useContext(DetailCtx);
  if (!ctx || ctx.drawer !== 'raw') return null;
  const { t, setDrawer } = ctx;
  const rows = useMemo(() => genRawPrints(t), [t.symbol]);
  const venueLabel = { trf_off_exchange: ['Off-exch', 'venue-trf'], trf_ats: ['ATS', 'venue-trf'], trf_unclassified: ['TRF', 'venue-trf'], lit_exchange: ['Lit', 'venue-lit'] };
  return (
    <>
      <div className="scrim" onClick={() => setDrawer(null)} />
      <div className="drawer">
        <div className="drawer-head">
          <span className="ico" style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--panel-3)', color: 'var(--ink-2)', display: 'grid', placeItems: 'center' }}><Icon name="hash" size={16} /></span>
          <div style={{ flex: 1 }}>
            <div className="dt">{t.symbol} · Raw prints</div>
            <div className="ds">Top {rows.length} by notional · focus prints highlighted · post-condition-code policy v1</div>
          </div>
          <button className="x-close" onClick={() => setDrawer(null)}><Icon name="x" size={16} /></button>
        </div>
        <div className="drawer-body">
          <table className="rp-table">
            <thead><tr>
              <th>Time ET</th><th>Price</th><th>Size</th><th>Notional</th><th>Venue</th><th>Signed</th><th>Method</th><th>Codes</th>
            </tr></thead>
            <tbody>
              {rows.map((p, i) => {
                const [vl, vc] = venueLabel[p.venue];
                return (
                  <tr key={i} className={p.isFocus ? 'focus' : ''}>
                    <td style={{ textAlign: 'left' }}>{p.ts}</td>
                    <td>{p.price.toFixed(2)}</td>
                    <td>{p.size.toLocaleString()}</td>
                    <td>${Ufmt(p.notional)}</td>
                    <td><span className={`venue-chip ${vc}`}>{vl}</span></td>
                    <td className={p.signed === 'buy' ? 'rp-buy' : p.signed === 'sell' ? 'rp-sell' : ''}>{p.signed === 'buy' ? '▲ buy' : p.signed === 'sell' ? '▼ sell' : '— unk'}</td>
                    <td style={{ color: 'var(--ink-3)' }}>{p.method}</td>
                    <td>{p.codes.length ? p.codes.map(c => <span key={c} className="code-chip">{c}</span>) : <span style={{ color: 'var(--ink-faint)' }}>—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="drawer-foot">
          <Icon name="info" size={14} />
          <span>Codes: F = intermarket sweep (shown separately, not a focus print) · O = opening print (volume only). Excluded codes (E, W, 6, P) are removed before this view.</span>
        </div>
      </div>
    </>
  );
}

/* ---------- explain this tier ---------- */
function explainRules(t, mode) {
  const C = t.C, B = t.B, A = t.A;
  const hasA = mode !== 'single';
  if (t.tier === 'D') {
    return {
      verdict: 'Suppressed to Tier D', tone: 'tD',
      lead: t.laneIssue === 'loading' ? 'A required lane is still loading — no tier is emitted on incomplete data.' : 'Signal does not meet the Tier C threshold.',
      criteria: [
        { name: 'Required lanes ready', detail: 'Live trade slices are still loading.', pass: false },
        { name: 'Sample ≥ 50 prints after exclusions', detail: 'Cannot evaluate until the lane reports.', pass: false },
        { name: 'B ≥ 1.0σ on any component', detail: 'Not computed.', pass: false },
      ],
      elevation: null,
    };
  }
  const bComp = [['volume', B.volume], ['focus share', B.focus], ['notional', B.notional]];
  const b25 = bComp.filter(([, v]) => v >= 2.5);
  const b15 = bComp.filter(([, v]) => v >= 1.5);
  const aComp = hasA ? [['volume', A.volume], ['focus', A.focus], ['pressure', A.pressure]] : [];
  const a85 = aComp.filter(([, v]) => v >= 0.85);
  const a70 = aComp.filter(([, v]) => v >= 0.70);
  const strong = ['price', 'provider', 'options'].filter(k => t.corr[k]).length;
  const dirConsistent = t.dir === 'bullish' || t.dir === 'bearish';
  const laneReady = !t.laneIssue;
  const uni = mode === 'portfolio' ? 'your portfolio' : 'S&P 500';

  const crit = [];
  if (t.tier === 'A') {
    crit.push({ name: 'B ≥ 2.5σ on ≥ 2 components', detail: `${b25.length} components: ${b25.map(([n, v]) => `${n} ${v}σ`).join(', ')}`, pass: b25.length >= 2 });
    if (hasA) crit.push({ name: `A ≥ 85th pct on ≥ 2 components (vs ${uni})`, detail: `${a85.length} components: ${a85.map(([n, v]) => `${n} ${ordinal(v)}`).join(', ')}`, pass: a85.length >= 2 });
    crit.push({ name: 'Direction consistent across components', detail: `Net & block pressure both ${t.dir === 'bullish' ? 'buyer-side' : 'seller-side'} (${pctStr(C.nnp)})`, pass: dirConsistent });
    crit.push({ name: '≥ 1 independent (Strong) corroboration', detail: `${strong} strong flag${strong !== 1 ? 's' : ''} active`, pass: strong >= 1 });
    crit.push({ name: 'Lane state = ready', detail: 'All required lanes ready & fresh', pass: laneReady });
  } else if (t.tier === 'B') {
    crit.push({ name: 'B ≥ 1.5σ on ≥ 1 component', detail: `${b15.length} components: ${b15.map(([n, v]) => `${n} ${v}σ`).join(', ')}`, pass: b15.length >= 1 });
    if (hasA) crit.push({ name: `A ≥ 70th pct on ≥ 1 component (vs ${uni})`, detail: `${a70.length} components: ${a70.map(([n, v]) => `${n} ${ordinal(v)}`).join(', ')}`, pass: a70.length >= 1 });
    crit.push({ name: 'Direction present', detail: `${t.dirLabel} pressure ${pctStr(C.nnp)}`, pass: dirConsistent });
    crit.push({ name: 'Lane state = ready or partial', detail: t.laneIssue === 'partial' ? 'Partial coverage — usable' : 'Ready', pass: true });
  } else {
    crit.push({ name: 'Activity detected', detail: `Volume ${C.vr}× median, B ${B.volume}σ`, pass: true });
    crit.push({ name: 'Tier B threshold not met', detail: t.laneIssue === 'partial' ? `Capped at C — coverage ${Math.round(t.coverage * 100)}% (< 90% required)` : `B ${B.volume}σ below 1.5σ, or direction not confirmed (${pctStr(C.nnp)})`, pass: false });
  }

  // why-not-higher gap
  let gap = null;
  if (t.tier === 'B') {
    const miss = [];
    if (b25.length < 2) miss.push(`needs B ≥ 2.5σ on 2 components (has ${b25.length})`);
    if (hasA && a85.length < 2) miss.push(`needs A ≥ 85th pct on 2 (has ${a85.length})`);
    if (strong < 1) miss.push('needs ≥ 1 strong corroboration');
    gap = { to: 'A', miss };
  } else if (t.tier === 'C') {
    const miss = [];
    if (b15.length < 1) miss.push('needs B ≥ 1.5σ on a component');
    if (t.laneIssue === 'partial') miss.push('needs ≥ 90% lane coverage');
    if (!dirConsistent) miss.push('needs a confirmed direction (|pressure| ≥ 0.60)');
    gap = { to: 'B', miss };
  }

  // elevation
  let elevation = null;
  if (t.tier === 'A' && t.corr.provider && t.alerts[0]) elevation = `Eligible for elevation: ${t.alerts[0].provider} confirmed ${t.alerts[0].dir} alert at ${t.alerts[0].ts} matches signal direction.`;
  if (t.tier === 'B' && t.corr.provider) elevation = `A confirmed provider alert could elevate this to Tier A once B ≥ 2.5σ and lane state = ready.`;

  return { verdict: `Classified Tier ${t.tier}`, tone: '', lead: t.bluf.why, criteria: crit, gap, elevation };
}

function ExplainTierPanel() {
  const ctx = useContext(DetailCtx);
  if (!ctx || ctx.drawer !== 'explain') return null;
  const { t, mode, setDrawer } = ctx;
  const ev = explainRules(t, mode);
  return (
    <>
      <div className="scrim" onClick={() => setDrawer(null)} />
      <div className="modal">
        <div className="modal-head">
          <TierBadge tier={t.tier} size="lg" />
          <div style={{ flex: 1 }}>
            <div className="dt" style={{ fontSize: 15, fontWeight: 600 }}>Why {t.symbol} is Tier {t.tier}</div>
            <div className="ds" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{mode === 'single' ? 'Single-ticker rules · B + C' : 'Portfolio / Scan rules · A + B + C'}</div>
          </div>
          <button className="x-close" onClick={() => setDrawer(null)}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body">
          <div className={`verdict-banner ${ev.tone}`}>
            <Icon name={t.tier === 'D' ? 'alert' : 'check'} size={18} style={{ color: t.tier === 'D' ? 'var(--ink-3)' : 'var(--accent)' }} />
            <div style={{ fontSize: 13, color: 'var(--ink)' }}>{ev.lead}</div>
          </div>
          <div className="uplabel" style={{ marginBottom: 4 }}>Rules evaluated</div>
          {ev.criteria.map((c, i) => (
            <div className="rule-row" key={i}>
              <span className={`rule-mk ${c.pass ? 'pass' : 'fail'}`}><Icon name={c.pass ? 'check' : 'x'} size={13} /></span>
              <div className="rule-ct"><div className="rule-name">{c.name}</div><div className="rule-detail">{c.detail}</div></div>
            </div>
          ))}
          {ev.gap && ev.gap.miss.length > 0 && (
            <div className="elev-note"><b style={{ color: 'var(--ink-2)' }}>Why not Tier {ev.gap.to}?</b> {ev.gap.miss.join(' · ')}.</div>
          )}
          {ev.elevation && (
            <div className="elev-note" style={{ borderColor: 'var(--accent-line)' }}><Icon name="bolt" size={13} style={{ color: 'var(--accent)', verticalAlign: '-2px' }} /> {ev.elevation}</div>
          )}
        </div>
        <div className="modal-foot">
          <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Tier is rule-based — never a collapsed score. Policy: condition_code_policy_v1.</span>
          <button className="btn btn-sm" onClick={() => setDrawer(null)}>Close</button>
        </div>
      </div>
    </>
  );
}

/* ---------- compare to prior cycle ---------- */
function priorDeltas(t) {
  const r = rngFrom(t.symbol + 'p');
  let bVol = t.delta && t.delta.b != null ? t.delta.b : +(r() * 0.6 - 0.3).toFixed(1);
  // align B delta with the cycle-history prior→current step so the inline
  // chips and the compare panel never disagree.
  if (t.tier !== 'D') {
    const H = genCycleHistory(t);
    const prev = H.cycles[H.cycles.length - 2], cur = H.cycles[H.cycles.length - 1];
    if (cur.b != null && prev.b != null) bVol = +(cur.b - prev.b).toFixed(1);
  }
  return {
    bVol,
    aVol: +((r() - 0.45) * 0.08).toFixed(2),
    cNr: +((r() - 0.4) * (t.C.nr || 1) * 0.18).toFixed(1),
  };
}
function CmpDelta({ v, unit }) {
  if (v == null || v === 0) return <span className="cmp-delta cmp-flat">±0</span>;
  const up = v > 0;
  return <span className={`cmp-delta ${up ? 'cmp-up' : 'cmp-dn'}`}>{up ? '↑+' : '↓'}{Math.abs(v)}{unit}</span>;
}
/* ---------- compare to prior cycle — driver attribution ---------- */
function compareSummary(t, mode) {
  const H = genCycleHistory(t);
  const prev = H.cycles[H.cycles.length - 2];
  const cur = H.cycles[H.cycles.length - 1];
  const rank = { A: 4, B: 3, C: 2, D: 1 };
  const priorTier = prev.tier, curTier = cur.tier;
  const moved = priorTier !== curTier;
  const up = rank[curTier] > rank[priorTier];
  const d = priorDeltas(t);
  const drivers = [];

  // B · vs own history (the primary tier gate)
  if (cur.b != null && prev.b != null) {
    const gate = ty => ty === 'A' ? 2.5 : ty === 'B' ? 1.5 : 0;
    let bCross = null;
    if (moved && up) { const g = gate(curTier); if (prev.b < g && cur.b >= g) bCross = `cleared ${g}σ`; }
    else if (moved && !up) { const g = gate(priorTier); if (prev.b >= g && cur.b < g) bCross = `fell below ${g}σ`; }
    drivers.push({ key: 'B', label: 'B · vs own history', unit: 'σ', prior: prev.b, cur: cur.b, delta: +(cur.b - prev.b).toFixed(1), crossed: bCross });
  }
  // Signed pressure (direction confirmation gate)
  if (cur.press != null && prev.press != null) {
    const pc = Math.round(cur.press * 100), pp = Math.round(prev.press * 100);
    drivers.push({ key: 'P', label: 'Signed pressure', unit: '%', signed: true, prior: pp, cur: pc, delta: pc - pp,
      crossed: Math.abs(prev.press) < 60 / 100 && Math.abs(cur.press) >= 60 / 100 ? 'confirmed ±60%' : null });
  }
  // C · raw notional ratio
  if (t.C && t.C.nr != null) {
    drivers.push({ key: 'C', label: 'C · notional', unit: '×', prior: +(t.C.nr - d.cNr).toFixed(1), cur: t.C.nr, delta: d.cNr, crossed: null });
  }
  // A · percentile (portfolio / scan only)
  if (mode !== 'single' && t.A && t.A.volume != null) {
    const curA = Math.round(t.A.volume * 100), dA = Math.round(d.aVol * 100);
    drivers.push({ key: 'A', label: 'A · percentile', unit: 'th', prior: curA - dA, cur: curA, delta: dA, crossed: null });
  }

  let lead, tone;
  if (curTier === 'D') { lead = 'Tier suppressed this cycle'; tone = 'down'; }
  else if (!moved) { lead = `Tier ${curTier} held`; tone = 'flat'; }
  else { lead = `Tier ${up ? 'rose' : 'fell'} ${priorTier} → ${curTier}`; tone = up ? 'up' : 'down'; }

  const crossed = drivers.filter(x => x.crossed);
  let note;
  if (curTier === 'D') note = 'Live trade-slices lane went loading mid-cycle — no tier is emitted on incomplete data.';
  else if (moved && up) note = crossed.length
    ? `Elevated by ${crossed.map(c => c.key === 'P' ? 'signed pressure' : c.key).join(' and ')} ${crossed.length > 1 ? 'clearing their gates' : 'clearing its gate'} this cycle.`
    : 'Indicators strengthened enough to clear the next tier gate this cycle.';
  else if (moved && !up) note = 'Indicators fell back below the prior tier threshold this cycle.';
  else note = `Indicators steady — no gate crossed; Tier ${curTier} reaffirmed.`;

  return { lead, tone, priorTier, curTier, drivers, note, span: `${prev.time} → ${cur.time}` };
}

function CompareBanner({ t, mode }) {
  const S = useMemo(() => compareSummary(t, mode), [t.symbol, t.tier, mode]);
  const fmtV = (d, v) => {
    const s = d.signed && v > 0 ? '+' : '';
    if (d.unit === 'th') return v + 'th';
    return s + v + d.unit;
  };
  return (
    <div className={`cmp-panel cmp-${S.tone} fade-in`}>
      <div className="cmp-head">
        <span className="cmp-eye"><Icon name="eye" size={14} /></span>
        <span className="cmp-title">Cycle delta</span>
        <span className="cmp-span mono">{S.span} ET</span>
        <span className={`cmp-verdict v-${S.tone}`}>
          <Icon name={S.tone === 'up' ? 'up' : S.tone === 'down' ? 'down' : 'dot'} size={12} />{S.lead}
        </span>
      </div>
      <div className="cmp-drivers">
        {S.drivers.map((d, i) => (
          <div className="cmp-driver" key={i}>
            <span className="cmp-d-label">{d.label}</span>
            <span className="cmp-d-vals mono">{fmtV(d, d.prior)}<Icon name="arrowRight" size={11} /><b>{fmtV(d, d.cur)}</b></span>
            <CmpDelta v={d.delta} unit={d.unit === '%' || d.unit === 'th' ? '' : d.unit} />
            {d.crossed && <span className={`cmp-cross ${/fell/.test(d.crossed) ? 'bad' : ''}`}><Icon name={/fell/.test(d.crossed) ? 'down' : 'check'} size={10} />{d.crossed}</span>}
          </div>
        ))}
      </div>
      <div className="cmp-note">{S.note}</div>
    </div>
  );
}

/* ---------- cycle history timeline ---------- */
function genCycleHistory(t) {
  const N = 12;
  // build cycle timestamps backward from the current as-of (14:35), 5-min steps
  const times = [];
  let h = 14, m = 35;
  for (let i = 0; i < N; i++) { times.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`); m -= 5; if (m < 0) { m += 60; h -= 1; } }
  times.reverse();

  const rank = { A: 4, B: 3, C: 2, D: 1 };
  const nameByRank = { 4: 'A', 3: 'B', 2: 'C', 1: 'D' };
  const curTier = t.tier;
  const r = rngFrom(t.symbol + 'cyc');
  const curP = t.C && t.C.nnp != null ? t.C.nnp : 0;
  const curB = t.B && t.B.volume != null ? t.B.volume : 0;
  const dir = t.delta ? t.delta.tier : 'flat';

  // tier path across cycles. delta.tier means "changed vs the prior cycle",
  // so an up/down move lands on the FINAL cycle (14:30 → 14:35). Flat tickers
  // hold, with at most a brief earlier dip for visual life (never in the last 3).
  const gateOf = ty => ty === 'A' ? 2.5 : ty === 'B' ? 1.5 : 0;
  const cr = rank[curTier] || 2;
  let tierPath = [];
  let priorTierForGate = curTier;
  if (curTier === 'D') {
    const prior = ['C', 'C', 'C', 'C', 'B', 'B', 'B', 'C', 'C', 'C', 'C'];
    tierPath = prior.slice(0, N - 1).concat(['D']);
  } else if (dir === 'up' && cr > 2) {
    const lower = nameByRank[cr - 1];
    tierPath = Array(N).fill(lower); tierPath[N - 1] = curTier;
    priorTierForGate = lower;
  } else if (dir === 'down' && cr < 4) {
    const higher = nameByRank[cr + 1];
    tierPath = Array(N).fill(higher); tierPath[N - 1] = curTier;
    priorTierForGate = higher;
  } else {
    tierPath = Array(N).fill(curTier);
    if (cr > 2 && r() < 0.6) { const di = 1 + Math.floor(r() * (N - 4)); tierPath[di] = nameByRank[cr - 1]; }
  }

  // signed-pressure + B trajectory ramping toward current
  const cycles = [];
  for (let i = 0; i < N; i++) {
    const ease = Math.pow((i + 1) / N, 1.4);
    let p = curP * ease + (r() - 0.5) * 0.12;
    let b = curB * (0.5 + 0.5 * ease) + (r() - 0.5) * 0.3;
    if (curTier === 'D' && i === N - 1) { p = null; b = null; }
    else { p = Math.max(-1, Math.min(1, +p.toFixed(2))); b = Math.max(0, +b.toFixed(1)); }
    cycles.push({ time: times[i], tier: tierPath[i], press: p, b, current: i === N - 1 });
  }
  if (curTier !== 'D') {
    cycles[N - 1].press = +curP.toFixed(2);
    cycles[N - 1].b = +curB.toFixed(1);
    // make the prior cycle's B gate-consistent with the tier move so the
    // transition reads as a real gate crossing in the compare panel.
    if (dir === 'up' && cr > 2) {
      const g = gateOf(curTier);
      cycles[N - 2].b = +Math.min(g - 0.2, Math.max(g - 0.9, curB - 1.0 - r() * 0.4)).toFixed(1);
    } else if (dir === 'down' && cr < 4) {
      const hg = gateOf(priorTierForGate);
      cycles[N - 2].b = +(hg + 0.2 + r() * 0.4).toFixed(1);
    }
  }

  // events: tier transitions + confirmed alerts
  const events = [];
  for (let i = 1; i < N; i++) {
    if (cycles[i].tier !== cycles[i - 1].tier) {
      const up = rank[cycles[i].tier] > rank[cycles[i - 1].tier];
      events.push({ type: up ? 'up' : 'down', label: `${cycles[i - 1].tier} → ${cycles[i].tier}`, time: cycles[i].time });
    }
  }
  (t.alerts || []).forEach(a => {
    const ts = (a.ts || '').replace(' ET', '');
    if (ts >= times[0]) events.push({ type: 'alert', label: `${a.provider} ${a.type.toLowerCase()}`, time: ts });
  });
  if (curTier === 'D') events.push({ type: 'down', label: 'Suppressed — Live Trade Slices loading', time: times[N - 1] });
  events.sort((a, b) => a.time.localeCompare(b.time));

  return { cycles, events, span: `${times[0]}–${times[N - 1]}` };
}

function CycleTimeline({ t, mode }) {
  const H = useMemo(() => genCycleHistory(t), [t.symbol, t.tier]);
  const { cycles, events, span } = H;
  const maxAbs = Math.max(0.25, ...cycles.map(c => Math.abs(c.press || 0)));
  return (
    <div className="card card-pad cyc fade-in">
      <div className="panel-head">
        <span className="panel-title">Cycle history</span>
        <span className="ds" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Last {cycles.length} cycles · 5-min · {span} ET</span>
      </div>
      <div className="cyc-scaletag uplabel">Signed notional pressure</div>
      <div className="cyc-bars">
        {cycles.map((c, i) => {
          const up = (c.press || 0) >= 0;
          const hpx = c.press == null ? 0 : Math.min(1, Math.abs(c.press) / maxAbs) * 44;
          return (
            <div className="cyc-bar-col" key={i} title={`${c.time} ET · Tier ${c.tier} · ${c.press == null ? 'suppressed' : (c.press > 0 ? '+' : '') + Math.round(c.press * 100) + '% pressure'}`}>
              {c.press != null
                ? <span className={`cyc-bar ${up ? 'up' : 'dn'} ${c.current ? 'cur' : ''}`} style={{ height: hpx + 'px', [up ? 'bottom' : 'top']: '50%' }} />
                : <span className="cyc-bar-empty">·</span>}
            </div>
          );
        })}
      </div>
      <div className="cyc-ribbon">
        {cycles.map((c, i) => (
          <div className={`cyc-cell cyc-${c.tier} ${c.current ? 'cyc-now' : ''}`} key={i} title={`${c.time} ET · Tier ${c.tier}`}><span>{c.tier}</span></div>
        ))}
      </div>
      <div className="cyc-axis">
        <span>{cycles[0].time}</span>
        <span>{cycles[Math.floor(cycles.length / 3)].time}</span>
        <span>{cycles[Math.floor(cycles.length * 2 / 3)].time}</span>
        <span className="cyc-axis-now">{cycles[cycles.length - 1].time} · now</span>
      </div>
      {events.length > 0 && (
        <div className="cyc-events">
          {events.map((e, i) => (
            <span className={`cyc-event ev-${e.type}`} key={i}>
              <Icon name={e.type === 'alert' ? 'check' : e.type === 'up' ? 'up' : 'down'} size={12} />
              {e.label}<b>{e.time}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- lane state legend ---------- */
const LANE_STATES = [
  ['ready', 'ls-ready', 'Ready', 'Source fresh & analyzed'],
  ['loading', 'ls-loading', 'Data is still loading', 'Extraction running'],
  ['source_available_not_analyzed', 'ls-loading', 'Analysis pending', 'Raw data loaded'],
  ['analysis_needs_refresh', 'ls-loading', 'Analysis needs refresh', 'Not fresh'],
  ['partial_usable', 'ls-loading', 'Usable — partial coverage', 'Tier capped at C'],
  ['source_unavailable', 'ls-blocked', 'Provider unavailable', 'No score emitted'],
  ['blocked', 'ls-blocked', 'Cannot evaluate', 'Missing required source'],
  ['disabled_optional', 'ls-disabled', 'Optional source disabled', 'Not configured'],
  ['insufficient_history', 'ls-disabled', 'Insufficient history', '< 10 baseline sessions'],
];
function LaneStateLegend() {
  return (
    <div className="card card-pad">
      <div className="panel-head"><span className="panel-title">Lane state contract</span><span className="ds" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>9 states · never "stale"</span></div>
      <div className="legend-grid" style={{ marginTop: 8 }}>
        {LANE_STATES.map(([id, cls, name, desc]) => (
          <div className="legend-item" key={id}>
            <span className={`ls ${cls}`} />
            <span className="lname">{name}</span>
            <span className="ldesc">· {desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- landing / mode selector ---------- */
function HomeMode({ onPick }) {
  const cards = [
    { k: 'single', ic: 'target', title: 'Single Ticker', desc: 'Deep analysis of one name — full BLUF, all evidence cards, and directional pressure. Works for any ticker, in or out of a universe.', rules: 'Tier rules: B + C (no peer group)' },
    { k: 'portfolio', ic: 'briefcase', title: 'Portfolio', desc: 'Your holdings ranked by urgency. Surfaces what needs attention and what changed tier since the last cycle.', rules: 'Tier rules: A + B + C · A vs your portfolio' },
    { k: 'scan', ic: 'layers', title: 'Scan / Discovery', desc: 'Search a universe for bullish or bearish criteria. Two-pass pipeline screens fast, then resolves the shortlist live.', rules: 'Tier rules: A + B + C · two-pass' },
  ];
  return (
    <div className="home-wrap fade-in">
      <div className="home-hero">
        <div className="eyebrow">Unusual Trading Activity Agent</div>
        <h1>Choose how you want to look at the market.</h1>
        <p>Every signal is built on three independent indicators — universe percentile, historical z-score, and raw metric — never a single collapsed score. The agent shows evidence, context, and a rule-based tier.</p>
      </div>
      <div className="mode-cards">
        {cards.map(c => (
          <button className="mode-card" key={c.k} onClick={() => onPick(c.k)}>
            <span className="mc-ico"><Icon name={c.ic} size={23} /></span>
            <h3>{c.title}</h3>
            <p>{c.desc}</p>
            <div className="mc-rules">{c.rules}</div>
            <span className="mc-go">Open {c.title}<Icon name="arrowRight" size={14} /></span>
          </button>
        ))}
      </div>
      {(() => {
        const fc = feedCounts();
        return (
          <button className="home-alert-banner" onClick={() => onPick('alerts')}>
            <span className="hab-ico"><Icon name="bell" size={20} /></span>
            <div>
              <div className="hab-t">Activity feed</div>
              <div className="hab-d">Confirmed alerts, tier changes, news and lane events — newest first, across every universe.</div>
            </div>
            <div className="hab-counts">
              <div className="hab-stat"><span className="n" style={{ color: 'var(--accent)' }}>{fc.hot}</span><span className="l">Needs attention</span></div>
              <div className="hab-stat"><span className="n">{fc.alert}</span><span className="l">Alerts</span></div>
              <div className="hab-stat"><span className="n">{fc.tier}</span><span className="l">Tier changes</span></div>
            </div>
            <span className="hab-go"><Icon name="arrowRight" size={18} /></span>
          </button>
        );
      })()}
      <div className="home-foot">
        <span className="home-stat"><span className="ls ls-ready" /> Live · 5-minute cycle</span>
        <span className="home-stat"><Icon name="database" size={14} /> 20+ scan universes</span>
        <span className="home-stat"><Icon name="shield" size={14} /> Market regime · {UTA.macro.label}</span>
      </div>
    </div>
  );
}

Object.assign(window, { RawPrintsDrawer, ExplainTierPanel, CompareBanner, CmpDelta, priorDeltas, LaneStateLegend, HomeMode, triggerRevalidate, CycleTimeline });
