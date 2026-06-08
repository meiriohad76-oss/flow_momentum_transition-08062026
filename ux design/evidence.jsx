/* ============================================================
   BLUF + Evidence cards + Corroboration + Actions
   ============================================================ */
const { fmtMoney } = window.UTA;
function pctStr(v) { return (v > 0 ? '+' : '') + Math.round(v * 100) + '%'; }
function ordinal(p) { const n = Math.round(p * 100); return n + (['th','st','nd','rd'][(n%100>>3^1&&n%10)||0] || 'th'); }

/* ---------- BLUF card ---------- */
function BlufCard({ t, mode }) {
  const b = t.bluf;
  const rows = [
    ['What happened', b.what],
    ['Why it matters', b.why],
    ['What to check', b.check],
    ['Limitations', b.limits],
  ];
  return (
    <div className="card bluf fade-in">
      <div className="bluf-head">
        <TierBadge tier={t.tier} size="lg" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="bluf-headline">{b.headline}</div>
          <div className="bluf-meta">
            <DirTag dir={t.dir} />
            {t.band && <Band band={t.band} />}
            {t.sign > 0 && <span className="pill" style={{ fontSize: 11.5 }}><Icon name="activity" size={12} />Direction confidence {Math.round(t.sign * 100)}%</span>}
          </div>
        </div>
        <div className="bluf-aside uplabel">BLUF · as of {t.asOf}</div>
      </div>
      <div className="bluf-grid">
        {rows.map(([k, v], i) => (
          <div className="bluf-row" key={i}>
            <div className="bluf-k">{k}</div>
            <div className="bluf-v">{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- indicator summary (A/B/C) ---------- */
function IndicatorSummary({ t, mode, compare }) {
  if (t.tier === 'D') return null;
  const C = t.C, B = t.B, A = t.A;
  const aAvailable = mode !== 'single';
  const aLabel = mode === 'portfolio' ? 'A · vs your portfolio' : 'A · vs S&P 500 today';
  const d = compare ? priorDeltas(t) : null;
  return (
    <div className="ind-summary">
      <IndChip kind="B" label="B · vs own history" value={<>{B.volume}σ vol{d && <CmpDelta v={d.bVol} unit="σ" />}</>} sub={`${B.focus}σ focus · ${B.notional}σ notional`} />
      <IndChip kind="A" label={aLabel} value={aAvailable ? <>{ordinal(A.volume)} pct{d && <CmpDelta v={d.aVol * 100} unit="" />}</> : 'N/A'} sub={aAvailable ? `focus ${ordinal(A.focus)} · press ${ordinal(A.pressure)}` : 'single-ticker mode'} na={!aAvailable} />
      <IndChip kind="C" label="C · raw metric" value={<>{C.nr}× notional{d && <CmpDelta v={d.cNr} unit="×" />}</>} sub={`${C.vr}× vol · ${pctStr(C.nnp)} pressure`} />
    </div>
  );
}

/* ---------- generic evidence card ---------- */
function EvCard({ icon, title, sub, headline, defaultOpen, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`ev-card ${open ? 'open' : 'ev-collapsed'}`}>
      <div className="ev-head" onClick={() => setOpen(o => !o)}>
        <span className="ico"><Icon name={icon} /></span>
        <div className="ev-titlewrap">
          <div className="ev-title">{title}</div>
          {sub && <div className="ev-sub">{sub}</div>}
        </div>
        {headline && <span style={{ marginRight: 4 }}>{headline}</span>}
        <span className="ev-chev"><Icon name="chevron" size={16} /></span>
      </div>
      <div className="ev-body">{children}</div>
    </div>
  );
}

/* ---------- the 8 evidence cards ---------- */
function EvidenceGrid({ t, mode }) {
  if (t.tier === 'D') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card card-pad fade-in" style={{ textAlign: 'center', padding: '40px 24px' }}>
        <div className="ico" style={{ width: 44, height: 44, margin: '0 auto 14px', borderRadius: 12, background: 'var(--panel-3)', color: 'var(--ink-3)', display: 'grid', placeItems: 'center' }}>
          <Icon name="database" size={22} />
        </div>
        <div style={{ fontWeight: 600, fontSize: 16 }}>Evidence suppressed — Tier D</div>
        <p style={{ color: 'var(--ink-2)', maxWidth: 440, margin: '8px auto 16px', fontSize: 13.5 }}>
          The live trade-slices lane is still loading. No directional signal or evidence is computed on incomplete data — a tier is never emitted while a required lane is loading.
        </p>
        <button className="btn btn-accent" style={{ margin: '0 auto' }} onClick={() => triggerRevalidate()}><Icon name="refresh" size={15} className="ic" />Refresh Live Trade Slices</button>
      </div>
      <div className="card card-pad">
        <div className="panel-head"><span className="panel-title">Lane health</span><span className="pill" style={{ color: 'var(--sell)' }}><span className="ls ls-blocked" style={{ width: 7, height: 7, borderRadius: 99 }} />Cannot evaluate</span></div>
        <div style={{ marginTop: 6 }}>{t.lanes.map(l => <LaneRow key={l.id} lane={l} />)}</div>
      </div>
      <LaneStateLegend />
      </div>
    );
  }
  const C = t.C, B = t.B;
  const venueLit = 1 - C.fshare;
  return (
    <div className="ev-grid">
      {/* 1 — Volume Anomaly */}
      <EvCard icon="bolt" title="Volume Anomaly" sub={`Open–Power Hour · ${t.band} band`} defaultOpen
        headline={<span className={`ev-metric ${C.vr >= 2 ? 'pos' : ''}`}>{C.vr}×</span>}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <Band band={t.band} />
          <span className="pill"><span className="dot" style={{ background: 'var(--accent)' }} />B {B.volume}σ above own median</span>
        </div>
        <VolBars series={t.volSeries} />
        <div className="chart-cap"><span>Session vs 20-day baseline by time bucket</span><span>solid = today · ghost = baseline</span></div>
        <div style={{ marginTop: 12 }}>
          <div className="kv"><span className="k">Volume ratio</span><span className="v">{C.vr}× median</span></div>
          <div className="kv"><span className="k">Notional ratio</span><span className="v">{C.nr}× median</span></div>
          <div className="kv"><span className="k">Trade-count ratio</span><span className="v">{C.cr}× median</span></div>
          <div className="kv"><span className="k">B-score (volume)</span><span className="v">{B.volume}σ</span></div>
        </div>
      </EvCard>

      {/* 2 — Block / TRF */}
      <EvCard icon="layers" title="Block / Off-Exchange Activity" sub="Focus prints · venue classification" defaultOpen
        headline={<span className="ev-metric">{C.fcount} prints</span>}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div><div className="uplabel">Focus notional</div><div className="mono" style={{ fontSize: 19, fontWeight: 600 }}>${fmtMoney(C.fnotional)}</div></div>
          <div><div className="uplabel">Focus share</div><div className="mono" style={{ fontSize: 19, fontWeight: 600 }}>{Math.round(C.fshare * 100)}%</div></div>
          <div><div className="uplabel">Largest print</div><div className="mono" style={{ fontSize: 19, fontWeight: 600 }}>{C.lpm}×</div></div>
        </div>
        <div className="uplabel" style={{ marginBottom: 6 }}>Venue split (by notional)</div>
        <div className="mix-bar"><span style={{ width: (C.fshare * 100) + '%', background: 'var(--accent)' }} /><span style={{ width: (venueLit * 100) + '%', background: 'var(--border-strong)' }} /></div>
        <div className="mix-legend">
          <span className="li"><span className="sw" style={{ background: 'var(--accent)' }} />Off-exchange / focus {Math.round(C.fshare * 100)}%</span>
          <span className="li"><span className="sw" style={{ background: 'var(--border-strong)' }} />Lit exchange {Math.round(venueLit * 100)}%</span>
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="kv"><span className="k">Focus trade count</span><span className="v">{C.fcount}</span></div>
          <div className="kv"><span className="k">Largest print notional</span><span className="v">${fmtMoney(C.largest)}</span></div>
          <div className="kv"><span className="k">Block directional pressure</span><span className="v" style={{ color: C.nnp > 0 ? 'var(--buy)' : 'var(--sell)' }}>{pctStr(C.nnp)}</span></div>
          <div className="kv"><span className="k">B-score (focus share)</span><span className="v">{B.focus}σ</span></div>
        </div>
      </EvCard>

      {/* 3 — Directional Pressure */}
      <EvCard icon="activity" title="Directional Pressure" sub="Signed flow · Lee-Ready signing" defaultOpen
        headline={<span className={`ev-metric ${C.nnp > 0 ? 'pos' : C.nnp < 0 ? 'neg' : ''}`}>{pctStr(C.nnp)}</span>}>
        <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-3)' }}><span>Seller-side</span><span>Neutral</span><span>Buyer-side</span></div>
        <PressureGauge value={C.nnp} />
        <div style={{ marginTop: 14 }}>
          <div className="kv"><span className="k">Net notional pressure</span><span className="v" style={{ color: C.nnp > 0 ? 'var(--buy)' : 'var(--sell)' }}>{pctStr(C.nnp)}</span></div>
          <div className="kv"><span className="k">Net volume pressure</span><span className="v" style={{ color: C.nvp > 0 ? 'var(--buy)' : 'var(--sell)' }}>{pctStr(C.nvp)}</span></div>
        </div>
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span className="uplabel">Signing confidence</span><span className="mono" style={{ fontWeight: 600 }}>{Math.round(t.sign * 100)}%</span></div>
          <ConfBar value={t.sign} />
          {t.sign < 0.5 && <div style={{ fontSize: 11.5, color: 'var(--sell)', marginTop: 6 }}>Low signing confidence — treat direction as indicative only.</div>}
          <div style={{ marginTop: 14 }} className="uplabel">Signing method mix</div>
          <div style={{ marginTop: 8 }}><MixBar mix={t.signMix} /></div>
        </div>
      </EvCard>

      {/* 4 — Pre-Market */}
      <EvCard icon="premarket" title="Pre-Market Activity" sub="04:00–09:30 ET · decay applied"
        headline={t.premkt ? <span className="ev-metric">{t.premkt.vr}×</span> : <span className="ev-sub">none</span>}>
        {t.premkt ? <>
          <div style={{ display: 'flex', gap: 18, marginBottom: 12, flexWrap: 'wrap' }}>
            <div><div className="uplabel">Volume ratio</div><div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{t.premkt.vr}×</div></div>
            <div><div className="uplabel">Pre-mkt pressure</div><div className="mono" style={{ fontSize: 18, fontWeight: 600, color: t.premkt.pressure > 0 ? 'var(--buy)' : 'var(--sell)' }}>{pctStr(t.premkt.pressure)}</div></div>
            <div><div className="uplabel">Gap</div><div className="mono" style={{ fontSize: 18, fontWeight: 600, color: t.premkt.gap > 0 ? 'var(--buy)' : 'var(--sell)' }}>{(t.premkt.gap > 0 ? '+' : '') + t.premkt.gap}%</div></div>
          </div>
          <div className="kv"><span className="k">Decay state (since open)</span><span className="v">{Math.round(t.premkt.decay * 100)}% of original weight</span></div>
          <div className="kv"><span className="k">Pre-market B-score</span><span className="v">{t.B.premarket}σ</span></div>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 10, marginBottom: 0 }}>Pre-market pressure decays with a 60-min half-life after 09:30; weight shown is post-decay.</p>
        </> : <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>No pre-market prints above threshold for this session.</p>}
      </EvCard>

      {/* 5 — Market Flow Trend */}
      <EvCard icon="trend" title="Market Flow Trend" sub="Pressure trend · last 5 cycles"
        headline={<span className={`ev-metric ${C.nnp > 0 ? 'pos' : 'neg'}`}>{t.dir === 'bullish' ? 'Building' : t.dir === 'bearish' ? 'Fading' : 'Neutral'}</span>}>
        <Sparkline data={t.pressSeries} color={C.nnp > 0 ? 'var(--buy)' : 'var(--sell)'} h={48} zero />
        <div className="chart-cap"><span>Signed notional pressure over session</span><span>zero = balanced</span></div>
        <div style={{ marginTop: 12 }}>
          <div className="kv"><span className="k">Pressure delta vs prior cycles</span><span className="v" style={{ color: C.nnp > 0 ? 'var(--buy)' : 'var(--sell)' }}>{pctStr(C.nnp * 0.3)}</span></div>
          <div className="kv"><span className="k">Participation</span><span className="v">{(1 + C.vr * 0.08).toFixed(1)}× median</span></div>
          <div className="kv"><span className="k">Trend direction</span><span className="v">{t.dirLabel}</span></div>
        </div>
      </EvCard>

      {/* 6 — Confirmed Alerts */}
      <EvCard icon="bell" title="Confirmed Alerts" sub={t.alerts.length ? `${t.alerts.length} provider alert${t.alerts.length > 1 ? 's' : ''}` : 'no provider alerts'}
        headline={t.alerts.length ? <span className="pill" style={{ color: 'var(--buy)' }}><Icon name="check" size={12} />{t.alerts.length}</span> : <span className="ev-sub">none</span>}>
        {t.alerts.length ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {t.alerts.map((a, i) => (
            <div key={i} className="alert-row">
              <span className={`mk yes`} style={{ width: 22, height: 22, display: 'grid', placeItems: 'center', borderRadius: 6, background: 'var(--buy-soft)', color: 'var(--buy)' }}><Icon name="check" size={13} /></span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{a.provider} · {a.type}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{a.conf} · {a.dir} · ${fmtMoney(a.notional)} · {a.ts}</div>
              </div>
              <DirTag dir={a.dir} />
            </div>
          ))}
          <p style={{ fontSize: 11.5, color: 'var(--ink-3)', margin: '4px 0 0' }}>Confirmed alerts are independent, human-reviewed sources and are eligible for tier elevation when direction matches.</p>
        </div> : <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>No confirmed provider alerts for this ticker and session.</p>}
      </EvCard>

      {/* 6b — Options Flow */}
      <OptionsFlowCard t={t} />

      {/* 7 — Macro Context */}
      <EvCard icon="shield" title="Macro Context" sub="FRED · market regime"
        headline={<span className={`band-tag ${UTA.macro.regime === 'risk_off' ? 'elevated' : UTA.macro.regime === 'crisis' ? 'extreme' : 'unusual'}`}>{UTA.macro.label}</span>}>
        <div className="kv"><span className="k">VIX (VIXCLS)</span><span className="v">{UTA.macro.vix}</span></div>
        <div className="kv"><span className="k">Yield curve (T10Y2Y)</span><span className="v" style={{ color: 'var(--sell)' }}>{UTA.macro.yieldCurve}% inverted</span></div>
        <div className="kv"><span className="k">Fed Funds Rate</span><span className="v">{UTA.macro.fedFunds}%</span></div>
        <div style={{ marginTop: 12 }}><Sparkline data={UTA.macro.vixSeries} color="var(--risk-off)" h={36} /></div>
        <div className="chart-cap"><span>VIX, last 8 sessions</span></div>
        <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 10, marginBottom: 0 }}>{UTA.macro.interpretation}</p>
      </EvCard>

      {/* 8 — Data Health */}
      <EvCard icon="database" title="Data Health" sub="Lane states · coverage · policy"
        headline={<span className="pill" style={{ color: 'var(--buy)' }}><span className="ls ls-ready" style={{ width: 7, height: 7, borderRadius: 99 }} />Ready</span>}>
        <div style={{ marginBottom: 10 }}>{t.lanes.slice(0, 6).map(l => <LaneRow key={l.id} lane={l} />)}</div>
        <div className="kv"><span className="k">Coverage</span><span className="v">{Math.round(t.coverage * 100)}%</span></div>
        <div className="kv"><span className="k">Prints analyzed</span><span className="v">{t.rowCount.toLocaleString()}</span></div>
        <div className="kv"><span className="k">Condition-excluded</span><span className="v">{t.excluded.toLocaleString()}</span></div>
        <div className="kv"><span className="k">Latest event</span><span className="v">{t.asOf}</span></div>
        <div className="kv"><span className="k">Policy version</span><span className="v">condition_code_policy_v1</span></div>
        <RefreshLaneBtn />
      </EvCard>
    </div>
  );
}

function RefreshLaneBtn() {
  const [s, setS] = useState('idle'); // idle | loading | done
  const tmr = useRef([]);
  useEffect(() => () => tmr.current.forEach(clearTimeout), []);
  function go() {
    if (s === 'loading') return;
    setS('loading');
    triggerRevalidate();
    tmr.current.push(setTimeout(() => setS('done'), 1500));
    tmr.current.push(setTimeout(() => setS('idle'), 4200));
  }
  return (
    <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={go}>
      <Icon name={s === 'done' ? 'check' : 'refresh'} size={13} className={'ic' + (s === 'loading' ? ' spin' : '')} />
      {s === 'loading' ? 'Refreshing…' : s === 'done' ? 'Updated · just now' : 'Refresh this lane'}
    </button>
  );
}

function LaneRow({ lane }) {
  const sc = { ready: 'ls-ready', loading: 'ls-loading', blocked: 'ls-blocked', disabled_optional: 'ls-disabled' }[lane.state] || 'ls-disabled';
  const freshTxt = lane.fresh == null ? '—' : lane.fresh < 120 ? `${lane.fresh}s ago` : lane.fresh < 3600 ? `${Math.round(lane.fresh / 60)}m ago` : `${Math.round(lane.fresh / 3600)}h ago`;
  return (
    <div className="lane">
      <span className={`ls ${sc}`} />
      <span className="ln">{lane.label}</span>
      <span className="lst">{lane.operator}{lane.state === 'ready' ? ' · ' + freshTxt : ''}</span>
    </div>
  );
}

/* ---------- corroboration panel ---------- */
function CorroborationPanel({ t }) {
  if (t.tier === 'D') return null;
  const flags = [
    { k: 'price', label: 'Price action aligned', d: t.corr.price ? `Price moved with signed pressure (${pctStr(t.C.nnp * 0.02)})` : 'No confirming price move', indep: 'Strong' },
    { k: 'provider', label: 'Provider alert confirmed', d: t.corr.provider ? `${t.alerts[0] ? t.alerts[0].provider + ', ' + t.alerts[0].ts : 'matched'}` : 'No confirmed alert', indep: 'Strong' },
    { k: 'options', label: 'Options flow aligned', d: t.corr.options ? 'Call/put flow agrees with direction' : 'Not available', indep: 'Strong' },
    { k: 'prepost', label: 'Pre-market + regular elevated', d: t.corr.prepost ? 'Both windows B ≥ 1.5σ' : 'Single window only', indep: 'Moderate' },
    { k: 'news', label: 'News catalyst present', d: t.news ? `${t.news.type}: ${t.news.headline}` : 'None detected today', indep: 'Contextual' },
    { k: 'macro', label: 'Macro regime supports', d: t.corr.macro ? 'Regime consistent with direction' : `VIX ${UTA.macro.vix} — ${UTA.macro.label} context`, indep: 'Contextual' },
  ];
  const strong = flags.filter(f => f.indep === 'Strong' && t.corr[f.k]).length;
  return (
    <div className="card card-pad fade-in">
      <div className="panel-head">
        <span className="panel-title">Corroboration</span>
        <span className="pill" style={{ color: strong >= 1 ? 'var(--buy)' : 'var(--ink-2)' }}>{strong} independent</span>
      </div>
      <div style={{ marginTop: 4 }}>
        {flags.map(f => {
          const on = t.corr[f.k];
          const warn = f.k === 'macro' && !on;
          return (
            <div className="corr-row" key={f.k}>
              <span className={`mk ${on ? 'yes' : warn ? 'warn' : 'no'}`}>
                {on ? <Icon name="check" size={12} /> : warn ? <Icon name="alert" size={11} /> : ''}
              </span>
              <div className="ct">
                <div className="cl">{f.label}</div>
                <div className="cd">{f.d}</div>
              </div>
              <span className="indep">{f.indep}</span>
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--ink-3)', margin: '10px 0 0' }}>Tier A requires ≥ 1 independent (Strong) corroboration. Contextual flags inform but never elevate a tier.</p>
    </div>
  );
}

/* ---------- actions panel ---------- */
function ActionsPanel({ t }) {
  const ctx = useContext(DetailCtx);
  const wl = useWatchlist();
  const rv = useReview();
  const [done, setDone] = useState({});
  function flash(label) { setDone(d => ({ ...d, [label]: true })); setTimeout(() => setDone(d => ({ ...d, [label]: false })), 1100); }
  const inWatch = wl.has(t.symbol);
  const reviewed = rv.get(t.symbol) === 'reviewed';
  const ignored = rv.get(t.symbol) === 'ignored';
  const actions = [
    { ic: 'refresh', label: 'Refresh lane', on: () => triggerRevalidate() },
    { ic: 'hash', label: 'Show raw prints', on: () => ctx.setDrawer('raw') },
    { ic: 'sparkle', label: 'Explain this tier', on: () => ctx.setDrawer('explain') },
    { ic: 'eye', label: 'Compare to prior cycle', on: () => ctx.setCompare(c => !c), active: ctx && ctx.compare },
    { ic: 'check', label: reviewed ? 'Reviewed' : 'Mark reviewed', on: () => rv.toggle(t.symbol, 'reviewed'), active: reviewed },
    { ic: 'bookmark', label: inWatch ? 'In watchlist' : 'Add to watchlist', on: () => wl.toggle(t.symbol), active: inWatch },
    { ic: 'flag', label: 'Use as supporting evidence', on: () => flash('Use as supporting evidence') },
    { ic: 'x', label: ignored ? 'Ignored this cycle' : 'Ignore this cycle', on: () => rv.toggle(t.symbol, 'ignored'), active: ignored },
  ];
  return (
    <div className="card card-pad fade-in">
      <div className="panel-head"><span className="panel-title">Actions</span></div>
      <div className="actions-grid">
        {actions.map(a => (
          <button key={a.label} className="action-btn" onClick={a.on} style={a.active ? { background: 'var(--accent-soft)', color: 'var(--ink)' } : null}>
            <Icon name={done[a.label] ? 'check' : a.ic} size={14} />
            {done[a.label] ? 'Done' : a.label}
            {a.active && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--accent)', fontWeight: 700 }}>ON</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { BlufCard, IndicatorSummary, EvidenceGrid, CorroborationPanel, ActionsPanel, LaneRow, pctStr, ordinal });
