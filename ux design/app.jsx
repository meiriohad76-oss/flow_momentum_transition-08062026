/* ============================================================
   App shell — topbar, regime banner, routing, tweaks
   ============================================================ */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "accent": "#5a82f0",
  "density": "regular",
  "typeface": "Spline Sans"
}/*EDITMODE-END*/;

const TYPEFACES = {
  'Spline Sans': { ui: "'Spline Sans'", mono: "'Spline Sans Mono'" },
  'Hanken Grotesk': { ui: "'Hanken Grotesk'", mono: "'JetBrains Mono'" },
  'IBM Plex Sans': { ui: "'IBM Plex Sans'", mono: "'IBM Plex Mono'" },
};

/* ---------- time helper ---------- */
function nowET() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* ---------- persistent watchlist store (shared across scripts) ---------- */
const WL_KEY = 'uta_watchlist_v1';
const watchStore = {
  set: new Set((() => { try { return JSON.parse(localStorage.getItem(WL_KEY) || '[]'); } catch (e) { return []; } })()),
  subs: new Set(),
  has(s) { return this.set.has(s); },
  list() { return [...this.set]; },
  toggle(s) {
    this.set.has(s) ? this.set.delete(s) : this.set.add(s);
    try { localStorage.setItem(WL_KEY, JSON.stringify([...this.set])); } catch (e) {}
    this.subs.forEach(f => f());
  },
};
function useWatchlist() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force(n => n + 1); watchStore.subs.add(f); return () => watchStore.subs.delete(f); }, []);
  return { has: s => watchStore.has(s), list: () => watchStore.list(), toggle: s => watchStore.toggle(s), count: watchStore.set.size };
}
Object.assign(window, { useWatchlist, watchStore });

/* ---------- watchlist drawer ---------- */
function WatchlistDrawer({ open, onClose, onOpen }) {
  const wl = useWatchlist();
  if (!open) return null;
  const items = wl.list().map(s => U.bySym[s]).filter(Boolean);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer" style={{ width: 'min(440px, 94vw)' }}>
        <div className="drawer-head">
          <span className="ico" style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'grid', placeItems: 'center' }}><Icon name="bookmark" size={16} /></span>
          <div style={{ flex: 1 }}>
            <div className="dt">Watchlist</div>
            <div className="ds">{items.length ? `${items.length} ticker${items.length > 1 ? 's' : ''} saved · click to open` : 'No tickers saved yet'}</div>
          </div>
          <button className="x-close" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="drawer-body" style={{ padding: items.length ? '10px 14px' : '18px 20px' }}>
          {items.length ? items.map(t => (
            <div className="wl-row" key={t.symbol} onClick={() => { onOpen(t.symbol); onClose(); }}>
              <TierBadge tier={t.tier} size="sm" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="wl-sym mono">{t.symbol}</div>
                <div className="wl-name">{t.name}</div>
              </div>
              <DirTag dir={t.dir} />
              <button className="wl-x" title="Remove" onClick={e => { e.stopPropagation(); wl.toggle(t.symbol); }}><Icon name="x" size={13} /></button>
            </div>
          )) : (
            <div style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '40px 12px' }}>
              <div className="ico" style={{ width: 44, height: 44, margin: '0 auto 14px', borderRadius: 12, background: 'var(--panel-3)', color: 'var(--ink-faint)', display: 'grid', placeItems: 'center' }}><Icon name="bookmark" size={22} /></div>
              <p style={{ fontSize: 13.5, maxWidth: 280, margin: '0 auto' }}>Add tickers from any analysis with <b style={{ color: 'var(--ink-2)' }}>Add to watchlist</b> to track them here across cycles.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function RegimeBanner() {
  const m = U.macro;
  return (
    <div className={`regime ${m.regime}`}>
      <span className="badge"><Icon name="shield" size={13} />Market Regime · {m.label}</span>
      <span className="stat">VIX <b>{m.vix}</b></span>
      <span className="sep" />
      <span className="stat">Yield curve <b style={{ color: 'var(--sell)' }}>{m.yieldCurve}%</b> inverted</span>
      <span className="sep" />
      <span className="stat">Fed Funds <b>{m.fedFunds}%</b></span>
      <span className="interp">{m.interpretation}</span>
    </div>
  );
}

function TopBar({ mode, setMode, onSearch, onHome, onWatchlist, watchCount, alertCount, revalidating, syncTime, t, setTweak }) {
  const [q, setQ] = useState('');
  const tabs = [
    { k: 'single', label: 'Single Ticker', ic: 'target' },
    { k: 'portfolio', label: 'Portfolio', ic: 'briefcase' },
    { k: 'scan', label: 'Scan', ic: 'layers' },
    { k: 'alerts', label: 'Alerts', ic: 'bell', badge: alertCount },
  ];
  function submit(e) {
    e.preventDefault();
    const sym = q.trim().toUpperCase();
    if (U.bySym[sym]) { onSearch(sym); setQ(''); }
  }
  return (
    <div className="topbar">
      <button className={`brand ${mode === 'home' ? 'is-home' : ''}`} onClick={onHome} title="Home">
        <span className="mark"><Icon name="activity" size={17} /></span>
        <span className="nm">Unusual Activity<small>Trading intelligence agent</small></span>
      </button>
      <div className="modetabs">
        {tabs.map(tab => (
          <button key={tab.k} className={`modetab ${mode === tab.k ? 'active' : ''}`} onClick={() => setMode(tab.k)}>
            <Icon name={tab.ic} size={15} /><span>{tab.label}</span>
            {tab.badge ? <span className="mt-badge">{tab.badge}</span> : null}
          </button>
        ))}
      </div>
      <form className="searchbox" onSubmit={submit}>
        <Icon name="search" size={15} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search any ticker…" list="tk-list" />
        <datalist id="tk-list">{U.tickers.map(t => <option key={t.symbol} value={t.symbol}>{t.name}</option>)}</datalist>
        <kbd>↵</kbd>
      </form>
      <div className="topbar-right">
        <button className="wl-pill" onClick={onWatchlist} title="Watchlist">
          <Icon name="bookmark" size={14} />
          {watchCount > 0 && <span className="wl-count">{watchCount}</span>}
        </button>
        <button className="btn btn-icon btn-ghost" title="Toggle theme" onClick={() => setTweak('theme', t.theme === 'dark' ? 'light' : 'dark')}>
          <Icon name={t.theme === 'dark' ? 'sun' : 'moon'} size={16} />
        </button>
        {revalidating
          ? <span className="reval-pill"><Icon name="refresh" size={14} className="spin" />Revalidating lanes…</span>
          : <span className="reval-pill"><span className="ls ls-ready" style={{ width: 7, height: 7, borderRadius: 99 }} />Live · synced {syncTime} ET</span>}
      </div>
    </div>
  );
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [mode, setMode] = useState('home');
  const [singleSym, setSingleSym] = useState('AVGO');
  const [openSym, setOpenSym] = useState(null);
  const [watchOpen, setWatchOpen] = useState(false);
  const wl = useWatchlist();
  const rulesHook = useRules();
  const alertCount = useMemo(() => feedCounts().hot, [rulesHook.version, wl.count]);

  // revalidation feedback (driven by triggerRevalidate -> 'uta:revalidate')
  const [revalidating, setRevalidating] = useState(false);
  const [syncTime, setSyncTime] = useState('14:35:22');
  const [revalKey, setRevalKey] = useState(0);
  useEffect(() => {
    let timer;
    function onReval() {
      setRevalidating(true);
      setRevalKey(k => k + 1);
      clearTimeout(timer);
      timer = setTimeout(() => { setRevalidating(false); setSyncTime(nowET()); }, 1900);
    }
    window.addEventListener('uta:revalidate', onReval);
    return () => { window.removeEventListener('uta:revalidate', onReval); clearTimeout(timer); };
  }, []);

  // apply tweaks to root
  const tf = TYPEFACES[t.typeface] || TYPEFACES['Spline Sans'];
  const rootStyle = {
    '--accent': t.accent,
    '--font-ui': `${tf.ui}, system-ui, sans-serif`,
    '--font-mono': `${tf.mono}, ui-monospace, monospace`,
  };
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('theme-switching');
    root.setAttribute('data-theme', t.theme);
    root.setAttribute('data-density', t.density);
    const id = setTimeout(() => root.classList.remove('theme-switching'), 60);
    return () => clearTimeout(id);
  }, [t.theme, t.density]);

  function goSingle(sym) { setMode('single'); setSingleSym(sym); setOpenSym(null); }
  function switchMode(m) { setMode(m); setOpenSym(null); }
  function goHome() { setMode('home'); setOpenSym(null); }

  return (
    <div className="app" style={rootStyle}>
      {revalidating && <div className="reval-bar" key={revalKey} />}
      <TopBar mode={mode} setMode={switchMode} onSearch={goSingle} onHome={goHome}
        onWatchlist={() => setWatchOpen(true)} watchCount={wl.count} alertCount={alertCount}
        revalidating={revalidating} syncTime={syncTime} t={t} setTweak={setTweak} />
      {mode !== 'home' && <RegimeBanner />}

      {mode === 'home' && <HomeMode onPick={switchMode} />}

      {mode === 'single' && <SingleMode symbol={singleSym} onNav={goHome} />}

      {mode === 'portfolio' && (openSym
        ? <div className="page"><TickerDetail symbol={openSym} mode="portfolio" onNav={(n) => n.symbol ? setOpenSym(n.symbol) : setOpenSym(null)} /></div>
        : <PortfolioMode onOpen={setOpenSym} />)}

      {mode === 'scan' && (openSym
        ? <div className="page"><TickerDetail symbol={openSym} mode="scan" onNav={(n) => n.symbol ? setOpenSym(n.symbol) : setOpenSym(null)} /></div>
        : <ScanMode onOpen={setOpenSym} />)}

      {mode === 'alerts' && (openSym
        ? <div className="page"><TickerDetail symbol={openSym} mode="single" onNav={(n) => n.symbol ? setOpenSym(n.symbol) : setOpenSym(null)} /></div>
        : <AlertsMode onOpen={setOpenSym} />)}

      <WatchlistDrawer open={watchOpen} onClose={() => setWatchOpen(false)} onOpen={goSingle} />

      <TweaksPanel>
        <TweakSection label="Theme" />
        <TweakRadio label="Mode" value={t.theme} options={['dark', 'light']} onChange={v => setTweak('theme', v)} />
        <TweakColor label="Accent" value={t.accent} options={['#5a82f0', '#2a9d8f', '#7a5be0', '#e08a3c']} onChange={v => setTweak('accent', v)} />
        <TweakSection label="Layout" />
        <TweakRadio label="Density" value={t.density} options={['compact', 'regular', 'comfy']} onChange={v => setTweak('density', v)} />
        <TweakSection label="Typography" />
        <TweakSelect label="Typeface" value={t.typeface} options={Object.keys(TYPEFACES)} onChange={v => setTweak('typeface', v)} />
      </TweaksPanel>

      <footer style={{ padding: '20px 22px 32px', color: 'var(--ink-faint)', fontSize: 11.5, textAlign: 'center' }}>
        Illustrative data for design review. Off-exchange prints identify off-exchange reporting only — not a named institution or venue. Not investment advice.
      </footer>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
