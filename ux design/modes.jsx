/* ============================================================
   Mode views — Single Ticker detail, Portfolio, Scan
   ============================================================ */
const U = window.UTA;

/* ---------- shared: ticker detail (hero) ---------- */
function TickerDetail({ symbol, mode, onNav }) {
  const t = U.bySym[symbol];
  const [drawer, setDrawer] = useState(null);
  const [compare, setCompare] = useState(false);
  if (!t) return null;
  const up = t.chg >= 0;
  const ctx = { t, mode, drawer, setDrawer, compare, setCompare };
  return (
    <DetailCtx.Provider value={ctx}>
    <div className="fade-in">
      <div className="crumb">
        <a onClick={() => onNav({ view: mode })}>{mode === 'single' ? 'Single Ticker' : mode === 'portfolio' ? 'Portfolio' : 'Scan'}</a>
        <Icon name="chevron" size={12} style={{ transform: 'rotate(-90deg)' }} />
        <span style={{ color: 'var(--ink-2)' }}>{t.symbol}</span>
      </div>

      <div className="ticker-head" style={{ marginBottom: 16 }}>
        <div className="th-id">
          <span className="th-sym mono">{t.symbol}</span>
          <span className="th-name">{t.name}</span>
        </div>
        <div className="th-meta">
          <span className="pill">{t.exch}</span>
          <span className="pill">{t.sector}</span>
          <span className="pill" style={{ textTransform: 'capitalize' }}>{t.bucket} cap</span>
          <ReviewChip sym={t.symbol} />
        </div>
        <div className="th-price">
          <span className="p">{t.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          <span className="c" style={{ color: up ? 'var(--buy)' : 'var(--sell)' }}>{up ? '+' : ''}{t.chg}%</span>
        </div>
      </div>

      {t.capNote && (
        <div className="compare-banner" style={{ borderStyle: 'solid', borderColor: 'var(--border-strong)', marginBottom: 14 }}>
          <Icon name="alert" size={15} style={{ color: 'var(--risk-off)' }} />
          <span>{t.capNote}</span>
        </div>
      )}

      <div className="layout">
        <div className="main-col">
          {compare && <CompareBanner t={t} mode={mode} />}
          <BlufCard t={t} mode={mode} />
          <IndicatorSummary t={t} mode={mode} compare={compare} />
          <CycleTimeline t={t} mode={mode} />
          <EvidenceGrid t={t} mode={mode} />
        </div>
        <div className="side-col">
          <CorroborationPanel t={t} />
          <ActionsPanel t={t} />
        </div>
      </div>

      <RawPrintsDrawer />
      <ExplainTierPanel />
    </div>
    </DetailCtx.Provider>
  );
}

/* ---------- single ticker mode ---------- */
function SingleMode({ symbol, onNav }) {
  const [sym, setSym] = useState(symbol || 'AVGO');
  useEffect(() => { if (symbol) setSym(symbol); }, [symbol]);
  return (
    <div className="page">
      <TickerDetail symbol={sym} mode="single" onNav={(n) => n.symbol ? setSym(n.symbol) : onNav(n)} />
    </div>
  );
}

/* ---------- results table (portfolio + scan pass 2) ---------- */
function ResultsTable({ rows, showA, onOpen, sortKey, setSort }) {
  const rv = useReview();
  const cols = [
    { k: 'symbol', label: 'Ticker' },
    { k: 'tier', label: 'Tier' },
    { k: 'dir', label: 'Direction' },
    { k: 'b', label: 'B · vs history', num: true },
    ...(showA ? [{ k: 'a', label: 'A · pct', num: true }] : []),
    { k: 'c', label: 'C · notional', num: true },
    { k: 'delta', label: 'Δ cycle', num: true },
  ];
  return (
    <table className="utable">
      <thead><tr>{cols.map(c => (
        <th key={c.k} className={c.num ? 'num' : ''} onClick={() => setSort(c.k)}>
          {c.label}{sortKey === c.k && <span className="so">↓</span>}
        </th>
      ))}</tr></thead>
      <tbody>
        {rows.map(t => {
          const changed = t.delta && t.delta.tier !== 'flat';
          const st = rv.get(t.symbol);
          return (
            <tr key={t.symbol} className={`${changed ? 'changed' : ''} ${st === 'ignored' ? 'dimmed' : ''}`} onClick={() => onOpen(t.symbol)}>
              <td><div className="cell-sym"><div><div className="s">{t.symbol}</div><div className="n">{t.name}</div></div><ReviewDot sym={t.symbol} /><RuleFlag sym={t.symbol} /></div></td>
              <td><TierBadge tier={t.tier} size="sm" /></td>
              <td><DirTag dir={t.dir} /></td>
              <td className="num cell-b">{t.tier === 'D' ? '—' : `${t.B.volume}σ vol`}</td>
              {showA && <td className="num cell-b">{t.tier === 'D' ? '—' : ordinal(t.A.volume)}</td>}
              <td className="num"><span className="cell-num">{t.tier === 'D' ? '—' : `${t.C.nr}×`}</span></td>
              <td className="num">{t.tier === 'D' ? '—' : <DeltaChip delta={t.delta} />}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ---------- portfolio mode ---------- */
function PortfolioMode({ onOpen }) {
  const [sortKey, setSortKey] = useState('c');
  const rows = useMemo(() => {
    const list = U.portfolioSymbols.map(s => U.bySym[s]);
    const v = (t) => t.tier === 'D' ? -1 : sortKey === 'b' ? t.B.volume : sortKey === 'a' ? t.A.volume : sortKey === 'c' ? t.C.nr : sortKey === 'tier' ? ({ A: 4, B: 3, C: 2, D: 1 })[t.tier] : sortKey === 'delta' ? (t.delta.b || 0) : 0;
    if (sortKey === 'symbol' || sortKey === 'dir') return [...list].sort((a, b) => a[sortKey === 'symbol' ? 'symbol' : 'dir'].localeCompare(b[sortKey === 'symbol' ? 'symbol' : 'dir']));
    return [...list].sort((a, b) => v(b) - v(a));
  }, [sortKey]);
  const aCount = rows.filter(r => r.tier === 'A').length;
  const changed = rows.filter(r => r.delta && r.delta.tier !== 'flat').length;
  return (
    <div className="page">
      <div className="mode-intro">
        <h1>Portfolio</h1>
        <p>Your 8 holdings ranked by activity. Indicator A is relative to your portfolio today. Rows with a tier change since the last cycle are marked.</p>
      </div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatCard label="Holdings" value="8" />
        <StatCard label="Tier A — actionable" value={aCount} accent />
        <StatCard label="Tier changes" value={changed} />
        <StatCard label="Cycle" value="14:35 ET" sub="every 5 min" />
      </div>
      <div className="tbl-wrap">
        <div className="tbl-top">
          <div><div className="t-title">Holdings · ranked by activity</div><div className="t-sub">A relative to your portfolio · click a row for full analysis</div></div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn btn-sm"><Icon name="refresh" size={13} className="ic" />Refresh cycle</button>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <ResultsTable rows={rows} showA onOpen={onOpen} sortKey={sortKey} setSort={setSortKey} />
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="card card-pad" style={{ flex: 1, minWidth: 140, padding: '14px 16px' }}>
      <div className="uplabel">{label}</div>
      <div className="mono" style={{ fontSize: 26, fontWeight: 600, marginTop: 4, color: accent ? 'var(--accent)' : 'var(--ink)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{sub}</div>}
    </div>
  );
}

/* ---------- scan mode ---------- */
function ScanMode({ onOpen }) {
  const [universe, setUniverse] = useState('sp500');
  const [direction, setDirection] = useState('bullish');
  const [phase, setPhase] = useState('idle'); // idle | pass1 | pass2 | done
  const [progress, setProgress] = useState(0);
  const [scanned, setScanned] = useState(0);
  const [sortKey, setSortKey] = useState('c');
  const timers = useRef([]);
  const uni = U.universes.find(u => u.id === universe);

  // candidate pool filtered by direction
  const pool = useMemo(() => {
    let list = U.tickers.filter(t => t.tier !== 'D');
    if (direction === 'bullish') list = list.filter(t => t.dir === 'bullish' || t.dir === 'mixed');
    if (direction === 'bearish') list = list.filter(t => t.dir === 'bearish' || t.dir === 'mixed');
    return list.sort((a, b) => (b.C.nr) - (a.C.nr));
  }, [direction]);

  // Pass 1 flags a coarse candidate set from bars; Pass 2 resolves the top shortlist live.
  const flagged = Math.max(pool.length, Math.round(uni.count * 0.09));

  function clearTimers() { timers.current.forEach(clearTimeout); timers.current = []; }
  useEffect(() => () => clearTimers(), []);

  function runScan() {
    clearTimers();
    setPhase('pass1'); setProgress(0); setScanned(0);
    const total = uni.count, P1 = 1300, steps = 24;
    for (let i = 1; i <= steps; i++) {
      timers.current.push(setTimeout(() => setScanned(Math.round(total * i / steps)), (P1 / steps) * i));
    }
    timers.current.push(setTimeout(() => { setScanned(total); setPhase('pass2'); }, P1 + 140));
    const n = pool.length;
    pool.forEach((_, i) => {
      timers.current.push(setTimeout(() => {
        setProgress(Math.round(((i + 1) / n) * 100));
        if (i === n - 1) setPhase('done');
      }, P1 + 420 + i * 340));
    });
  }
  function reset() { clearTimers(); setPhase('idle'); setProgress(0); setScanned(0); }
  useEffect(() => { reset(); }, [universe, direction]);

  const completed = Math.round((progress / 100) * pool.length);
  const resolvedN = phase === 'done' ? pool.length : phase === 'pass2' ? completed : 0;
  const dist = ['A', 'B', 'C'].map(tk => [tk, pool.filter(p => p.tier === tk).length]).filter(([, n]) => n);
  const perfLabel = { fast: 'Fast', standard: 'Standard', extended: 'Extended' }[uni.perf];
  const perfTime = { fast: '30–60 s', standard: '2–4 min', extended: '5–10 min' }[uni.perf];

  return (
    <div className="page">
      <div className="mode-intro">
        <h1>Scan / Discovery</h1>
        <p>Search a universe for tickers meeting bullish or bearish criteria. Pass 1 screens all constituents from bars in seconds; Pass 2 pulls live slices for the shortlist and resolves each row to full A/B/C indicators.</p>
      </div>

      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="scan-controls">
          <div className="field">
            <label>Universe</label>
            <select className="uselect" value={universe} onChange={e => setUniverse(e.target.value)}>
              {['Index', 'Sector · S&P 500', 'Custom'].map(cat => (
                <optgroup key={cat} label={cat}>
                  {U.universes.filter(u => u.cat === cat).map(u => <option key={u.id} value={u.id}>{u.label} ({u.count})</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Direction filter</label>
            <div className="seg">
              <button className={direction === 'bullish' ? 'on bull' : ''} onClick={() => setDirection('bullish')}><Icon name="up" size={14} />Bullish</button>
              <button className={direction === 'bearish' ? 'on bear' : ''} onClick={() => setDirection('bearish')}><Icon name="down" size={14} />Bearish</button>
              <button className={direction === 'both' ? 'on' : ''} onClick={() => setDirection('both')}>Both</button>
            </div>
          </div>
          <div className="field">
            <label>&nbsp;</label>
            {phase === 'idle' || phase === 'done'
              ? <button className="btn btn-accent" style={{ height: 40 }} onClick={runScan}><Icon name="search" size={15} className="ic" />{phase === 'done' ? 'Re-run scan' : 'Run scan'}</button>
              : <button className="btn" style={{ height: 40 }} onClick={reset}><Icon name="x" size={15} className="ic" />Cancel</button>}
          </div>
        </div>
        <div className="perf-row" style={{ marginTop: 14, border: 'none', padding: '12px 0 0' }}>
          <span className={`perf-dot perf-${uni.perf}`} />
          <span><b style={{ color: 'var(--ink)' }}>{perfLabel}</b> tier · {uni.count} tickers · est. {perfTime}</span>
          <span className="sep" style={{ width: 1, height: 14, background: 'var(--border)' }} />
          <span>Universe updated {uni.updated}</span>
          {uni.perf === 'extended' && <span style={{ color: 'var(--risk-off)' }}>· Pass 1 only by default — trigger Pass 2 on shortlist</span>}
        </div>
        <SavedScans onLoad={(u, d) => { setUniverse(u); setDirection(d); }} />
      </div>

      {phase === 'idle' ? (
        <div className="tbl-wrap"><div className="cta-card">
          <div className="ico" style={{ width: 46, height: 46, borderRadius: 13, background: 'var(--panel-3)', color: 'var(--ink-3)', display: 'grid', placeItems: 'center', marginBottom: 14 }}><Icon name="layers" size={23} /></div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>Ready to scan {uni.label}</div>
          <p style={{ color: 'var(--ink-2)', fontSize: 13.5, maxWidth: 420, margin: '6px 0 16px' }}>Run the scan to screen all {uni.count} constituents, then progressively resolve the shortlist with live data.</p>
          <button className="btn btn-accent" onClick={runScan}><Icon name="search" size={15} className="ic" />Run {direction} scan</button>
        </div></div>
      ) : (
        <div className="tbl-wrap">
          <div className="scan-funnel">
            <div className={`funnel-stage ${phase === 'pass1' ? 'active' : ''}`}>
              <span className="fl"><Icon name="database" size={13} />Screened</span>
              <span className="fv">{scanned.toLocaleString()}</span>
              <span className="fs">of {uni.count.toLocaleString()} from bars</span>
            </div>
            <span className="funnel-arrow"><Icon name="arrowRight" size={15} /></span>
            <div className={`funnel-stage ${phase === 'pass1' ? 'active' : ''}`}>
              <span className="fl"><Icon name="filter" size={13} />Flagged</span>
              <span className="fv">{phase === 'pass1' ? '·' : flagged}</span>
              <span className="fs">cleared pre-screen</span>
            </div>
            <span className="funnel-arrow"><Icon name="arrowRight" size={15} /></span>
            <div className={`funnel-stage ${phase === 'pass2' ? 'active' : ''} ${phase === 'done' ? 'done-stage' : ''}`}>
              <span className="fl"><Icon name={phase === 'done' ? 'check' : 'activity'} size={13} />Resolved</span>
              <span className="fv">{resolvedN}<span style={{ color: 'var(--ink-faint)', fontSize: 16 }}> / {pool.length}</span></span>
              <span className="fs">full A/B/C live</span>
            </div>
          </div>
          {phase === 'done' ? (
            <ScanResults pool={pool} direction={direction} uni={uni} onOpen={onOpen} />
          ) : (
            <>
              <div className="scan-prog">
                <Icon name="activity" size={15} style={{ color: 'var(--accent)' }} />
                <span>{phase === 'pass1' ? 'Pass 1 — screening constituents from daily bars…' : `Pass 2 — pulling live slices · resolving ${completed} of ${pool.length}`}</span>
                <div className="prog-track"><div className="prog-fill" style={{ width: (phase === 'pass1' ? Math.round(scanned / uni.count * 100) : progress) + '%' }} /></div>
                <span className="mono" style={{ color: 'var(--ink-2)' }}>{phase === 'pass1' ? Math.round(scanned / uni.count * 100) + '%' : progress + '%'}</span>
              </div>
              <div className="tbl-top">
                <div><div className="t-title">{uni.label} · {direction} shortlist</div><div className="t-sub">Resolving live — highest-notional candidates first</div></div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <ScanTable pool={pool} phase={phase} completed={completed} onOpen={onOpen} sortKey={sortKey} setSort={setSortKey} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ScanTable({ pool, phase, completed, onOpen, sortKey, setSort }) {
  const rv = useReview();
  const done = phase === 'done';
  const rows = useMemo(() => {
    if (!done) return pool; // keep notional order while resolving
    const v = (t) => sortKey === 'b' ? t.B.volume : sortKey === 'a' ? t.A.volume : sortKey === 'tier' ? ({ A: 4, B: 3, C: 2, D: 1 })[t.tier] : t.C.nr;
    if (sortKey === 'symbol' || sortKey === 'dir') return [...pool].sort((a, b) => a[sortKey].localeCompare(b[sortKey]));
    return [...pool].sort((a, b) => v(b) - v(a));
  }, [pool, done, sortKey]);
  const cols = [
    { k: 'symbol', label: 'Ticker' }, { k: 'tier', label: 'Tier' }, { k: 'dir', label: 'Direction' },
    { k: 'b', label: 'B · vs history', num: true }, { k: 'a', label: 'A · pct', num: true }, { k: 'c', label: 'C · notional', num: true },
    { k: 'status', label: 'Status' },
  ];
  return (
    <table className="utable">
      <thead><tr>{cols.map(col => (
        <th key={col.k} className={col.num ? 'num' : ''} style={{ cursor: done && col.k !== 'status' ? 'pointer' : 'default' }} onClick={() => done && col.k !== 'status' && setSort(col.k)}>
          {col.label}{done && sortKey === col.k && <span className="so">↓</span>}
        </th>
      ))}</tr></thead>
      <tbody>
        {rows.map((t) => {
          const idx = pool.indexOf(t);
          const resolved = done || idx < completed;
          const resolving = !done && idx === completed;
          const st = rv.get(t.symbol);
          return (
            <tr key={t.symbol} className={`${resolving ? 'resolving' : ''} ${st === 'ignored' ? 'dimmed' : ''}`} onClick={() => resolved && onOpen(t.symbol)} style={{ cursor: resolved ? 'pointer' : 'default' }}>
              <td><div className="cell-sym"><div><div className="s">{t.symbol}</div><div className="n">{t.name}</div></div><ReviewDot sym={t.symbol} /><RuleFlag sym={t.symbol} /></div></td>
              <td><TierBadge tier={t.tier} size="sm" /></td>
              <td><DirTag dir={t.dir} /></td>
              <td className="num cell-b">{resolved ? `${t.B.volume}σ vol` : `~${t.B.volume}σ`}</td>
              <td className="num cell-b">{resolved ? ordinal(t.A.volume) : '—'}</td>
              <td className="num"><span className="cell-num">{t.C.nr}×</span></td>
              <td>{resolved
                ? <span className="pill" style={{ fontSize: 11, color: 'var(--buy)' }}><Icon name="check" size={11} />Resolved</span>
                : resolving
                  ? <span className="cell-prelim"><span className="sk-dot" />Resolving…</span>
                  : <span className="cell-prelim" style={{ fontStyle: 'normal', color: 'var(--ink-faint)' }}><span className="sk-dot" style={{ background: 'var(--ink-faint)', animation: 'none' }} />Queued</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

Object.assign(window, { SingleMode, PortfolioMode, ScanMode, TickerDetail, StatCard });
