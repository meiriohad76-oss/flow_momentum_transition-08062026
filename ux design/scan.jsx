/* ============================================================
   Scan results — refinement bar, 3 comparable views,
   saved scans, bulk actions
   ============================================================ */

/* ---------- saved scans store ---------- */
const SS_KEY = 'uta_saved_scans_v1';
const savedScansStore = {
  list: (() => { try { return JSON.parse(localStorage.getItem(SS_KEY) || '[]'); } catch (e) { return []; } })(),
  subs: new Set(),
  persist() { try { localStorage.setItem(SS_KEY, JSON.stringify(this.list)); } catch (e) {} this.subs.forEach(f => f()); },
  add(cfg) {
    this.list = this.list.filter(s => !(s.universe === cfg.universe && s.direction === cfg.direction));
    this.list.unshift({ id: 'ss' + Date.now(), ...cfg });
    this.list = this.list.slice(0, 6);
    this.persist();
  },
  remove(id) { this.list = this.list.filter(s => s.id !== id); this.persist(); },
};
function useSavedScans() {
  const [, f] = useState(0);
  useEffect(() => { const fn = () => f(n => n + 1); savedScansStore.subs.add(fn); return () => savedScansStore.subs.delete(fn); }, []);
  return savedScansStore;
}

function SavedScans({ onLoad }) {
  const store = useSavedScans();
  if (!store.list.length) return null;
  return (
    <div className="saved-scans">
      <span className="ss-lab"><Icon name="inbox" size={13} />Saved scans</span>
      {store.list.map(s => {
        const uni = UTA.universes.find(u => u.id === s.universe);
        const arrow = s.direction === 'bullish' ? '▲' : s.direction === 'bearish' ? '▼' : '⇅';
        return (
          <button className="ss-chip" key={s.id} onClick={() => onLoad(s.universe, s.direction)} title={`Load ${uni ? uni.label : s.universe} · ${s.direction}`}>
            <span>{uni ? uni.label : s.universe}</span>
            <span className={`ss-dir ${s.direction === 'bullish' ? 'bull' : s.direction === 'bearish' ? 'bear' : ''}`}>{arrow}</span>
            <span className="ss-n">{s.count}</span>
            <span className="ss-x" role="button" onClick={e => { e.stopPropagation(); savedScansStore.remove(s.id); }}><Icon name="x" size={12} /></span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- mini signed-pressure bar ---------- */
function PBar({ v }) {
  const w = Math.min(50, Math.abs(v || 0) * 50);
  return (
    <div className="sr-pbar">
      {(v || 0) >= 0
        ? <span className="buy" style={{ width: w + '%' }} />
        : <span className="sell" style={{ width: w + '%' }} />}
    </div>
  );
}

/* ---------- watchlist star ---------- */
function StarBtn({ sym, cls }) {
  const wl = useWatchlist();
  const on = wl.has(sym);
  return (
    <button className={`${cls} ${on ? 'on' : ''}`} title={on ? 'In watchlist' : 'Add to watchlist'}
      onClick={e => { e.stopPropagation(); wl.toggle(sym); }}>
      <Icon name="bookmark" size={14} fill={on} />
    </button>
  );
}

const TIER_MEAN = {
  A: 'Actionable — clears every gate with independent corroboration',
  B: 'Review — meets the threshold, wants confirmation before acting',
  C: 'Context — elevated activity, below the action gate',
};

/* ---------- matched-criteria pills ---------- */
function matchedCriteria(direction) {
  const side = direction === 'bullish' ? 'buyer-side' : direction === 'bearish' ? 'seller-side' : 'either side';
  return [
    `Signed pressure ${side} ≥ 60%`,
    'B ≥ 1.5σ vs own history',
    'Notional ≥ 1.5× session median',
    'Required lanes ready',
  ];
}

/* ============================================================
   ScanResults — header + three views
   ============================================================ */
function ScanResults({ pool, direction, uni, onOpen }) {
  const wl = useWatchlist();
  const [view, setView] = useState(() => { try { return localStorage.getItem('uta_scan_view') || 'cards'; } catch (e) { return 'cards'; } });
  const [tf, setTf] = useState(null);
  const [sortKey, setSortKey] = useState('c');
  const [toast, setToast] = useState(null);
  const tmr = useRef(null);
  useEffect(() => () => clearTimeout(tmr.current), []);
  function setViewP(v) { setView(v); try { localStorage.setItem('uta_scan_view', v); } catch (e) {} }
  function flash(msg) { setToast(msg); clearTimeout(tmr.current); tmr.current = setTimeout(() => setToast(null), 1900); }

  const counts = ['A', 'B', 'C'].map(tk => [tk, pool.filter(p => p.tier === tk).length]).filter(([, n]) => n);
  const visible = tf ? pool.filter(p => p.tier === tf) : pool;

  function addAll() {
    let added = 0;
    visible.forEach(t => { if (!wl.has(t.symbol)) { wl.toggle(t.symbol); added++; } });
    flash(added ? `Added ${added} ticker${added > 1 ? 's' : ''} to watchlist` : 'All shown tickers already saved');
  }
  function saveScan() {
    savedScansStore.add({ universe: uni.id, direction, count: pool.length, dist: Object.fromEntries(counts) });
    flash('Scan saved — recall it from the controls above');
  }

  const views = [
    { k: 'table', ic: 'columns', label: 'Table' },
    { k: 'grouped', ic: 'layers', label: 'Grouped by tier' },
    { k: 'cards', ic: 'grid', label: 'Signal cards' },
  ];

  return (
    <>
      {/* refinement bar */}
      <div className="sr-bar">
        <div className="sr-filters">
          <button className={`sr-chip ${!tf ? 'on' : ''}`} onClick={() => setTf(null)}>All <b>{pool.length}</b></button>
          {counts.map(([tk, n]) => (
            <button key={tk} className={`sr-chip ${tf === tk ? 'on' : ''}`} onClick={() => setTf(f => f === tk ? null : tk)}>
              <TierBadge tier={tk} size="sm" /><b>{n}</b>
            </button>
          ))}
        </div>
        <div className="sr-right">
          <div className="seg-mini" role="tablist" aria-label="Results view">
            {views.map(v => (
              <button key={v.k} className={view === v.k ? 'on' : ''} onClick={() => setViewP(v.k)} title={v.label} aria-label={v.label} aria-selected={view === v.k}>
                <Icon name={v.ic} size={15} />
              </button>
            ))}
          </div>
          <button className="btn btn-sm" onClick={addAll}><Icon name="bookmark" size={13} className="ic" />Watch {visible.length}</button>
          <button className="btn btn-sm" onClick={saveScan}><Icon name="inbox" size={13} className="ic" />Save scan</button>
        </div>
      </div>

      {/* matched criteria */}
      <div className="sr-crit">
        <span className="sr-crit-lab">Matched</span>
        {matchedCriteria(direction).map((c, i) => (
          <span className="sr-crit-pill" key={i}><span className="ic-ok"><Icon name="check" size={11} /></span>{c}</span>
        ))}
      </div>

      {view === 'table' && <SrTable rows={visible} onOpen={onOpen} sortKey={sortKey} setSort={setSortKey} />}
      {view === 'grouped' && <SrGrouped pool={visible} tf={tf} onOpen={onOpen} />}
      {view === 'cards' && <SrCards rows={visible} onOpen={onOpen} />}

      {toast && <div className="sr-toast"><Icon name="check" size={15} className="ic" />{toast}</div>}
    </>
  );
}

/* ---------- table view ---------- */
function SrTable({ rows, onOpen, sortKey, setSort }) {
  const rv = useReview();
  const sorted = useMemo(() => {
    const v = (t) => sortKey === 'b' ? t.B.volume : sortKey === 'a' ? t.A.volume : sortKey === 'tier' ? ({ A: 4, B: 3, C: 2, D: 1 })[t.tier] : t.C.nr;
    if (sortKey === 'symbol' || sortKey === 'dir') return [...rows].sort((a, b) => a[sortKey].localeCompare(b[sortKey]));
    return [...rows].sort((a, b) => v(b) - v(a));
  }, [rows, sortKey]);
  const cols = [
    { k: 'symbol', label: 'Ticker' }, { k: 'tier', label: 'Tier' }, { k: 'dir', label: 'Direction' },
    { k: 'b', label: 'B · vs history', num: true }, { k: 'a', label: 'A · pct', num: true }, { k: 'c', label: 'C · notional', num: true },
  ];
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="utable">
        <thead><tr>
          {cols.map(col => (
            <th key={col.k} className={col.num ? 'num' : ''} style={{ cursor: 'pointer' }} onClick={() => setSort(col.k)}>
              {col.label}{sortKey === col.k && <span className="so">↓</span>}
            </th>
          ))}
          <th aria-label="actions"></th>
        </tr></thead>
        <tbody>
          {sorted.map(t => {
            const st = rv.get(t.symbol);
            return (
              <tr key={t.symbol} className={st === 'ignored' ? 'dimmed' : ''} onClick={() => onOpen(t.symbol)} style={{ cursor: 'pointer' }}>
                <td><div className="cell-sym"><div><div className="s">{t.symbol}</div><div className="n">{t.name}</div></div><ReviewDot sym={t.symbol} /><RuleFlag sym={t.symbol} /></div></td>
                <td><TierBadge tier={t.tier} size="sm" /></td>
                <td><DirTag dir={t.dir} /></td>
                <td className="num cell-b">{t.B.volume}σ vol</td>
                <td className="num cell-b">{ordinal(t.A.volume)}</td>
                <td className="num"><span className="cell-num">{t.C.nr}×</span></td>
                <td className="sr-actcell"><StarBtn sym={t.symbol} cls="sr-star" /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- grouped view ---------- */
function SrGrouped({ pool, tf, onOpen }) {
  const tiers = (tf ? [tf] : ['A', 'B', 'C']).filter(tk => pool.some(p => p.tier === tk));
  return (
    <div className="sr-groups">
      {tiers.map(tk => {
        const rows = pool.filter(p => p.tier === tk).sort((a, b) => b.C.nr - a.C.nr);
        return (
          <div className="sr-group" key={tk}>
            <div className="sr-group-head">
              <TierBadge tier={tk} size="lg" />
              <span className="gw">Tier {tk}</span>
              <span className="gn">{rows.length}</span>
              <span className="gd">{TIER_MEAN[tk]}</span>
              <span className="gline" />
            </div>
            <div className="sr-rows">
              {rows.map(t => <SrRow key={t.symbol} t={t} onOpen={onOpen} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
function SrRow({ t, onOpen }) {
  const up = (t.C.nnp || 0) >= 0;
  return (
    <div className={`sr-row ${t.tier === 'A' ? 'tierA' : ''}`} role="button" tabIndex={0}
      onClick={() => onOpen(t.symbol)} onKeyDown={e => { if (e.key === 'Enter') onOpen(t.symbol); }}>
      <div className="sr-row-id"><span className="s">{t.symbol}</span><span className="n">{t.name}</span></div>
      <div className="sr-row-dir"><DirTag dir={t.dir} /></div>
      <div className="sr-row-metrics">
        <div className="sr-metric"><span className="mk">B</span><span className="mv">{t.B.volume}σ</span></div>
        <div className="sr-metric"><span className="mk">A</span><span className="mv">{ordinal(t.A.volume)}</span></div>
        <div className="sr-metric"><span className="mk">C</span><span className="mv">{t.C.nr}×</span></div>
        <div className="sr-metric" style={{ alignItems: 'center' }}>
          <span className="mk" style={{ color: up ? 'var(--buy)' : 'var(--sell)' }}>{pctStr(t.C.nnp)}</span>
          <PBar v={t.C.nnp} />
        </div>
      </div>
      <span className="sr-open"><Icon name="arrowRight" size={16} /></span>
    </div>
  );
}

/* ---------- card view ---------- */
function SrCards({ rows, onOpen }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => (({ A: 4, B: 3, C: 2, D: 1 })[b.tier] - ({ A: 4, B: 3, C: 2, D: 1 })[a.tier]) || (b.C.nr - a.C.nr)), [rows]);
  return (
    <div className="sr-grid">
      {sorted.map(t => <SrCard key={t.symbol} t={t} onOpen={onOpen} />)}
    </div>
  );
}
function SrCard({ t, onOpen }) {
  const up = (t.C.nnp || 0) >= 0;
  return (
    <div className={`sr-card ${t.tier === 'A' ? 'tierA' : ''}`} role="button" tabIndex={0}
      onClick={() => onOpen(t.symbol)} onKeyDown={e => { if (e.key === 'Enter') onOpen(t.symbol); }}>
      <div className="sr-card-top">
        <div className="id"><div className="s">{t.symbol}</div><div className="n">{t.name}</div></div>
        <TierBadge tier={t.tier} size="lg" />
      </div>
      <div className="sr-card-tags"><DirTag dir={t.dir} />{t.band && <Band band={t.band} />}<RuleFlag sym={t.symbol} /></div>
      <div className="sr-card-stats">
        <div className="sr-cstat"><span className="k">B vs hist</span><span className="v">{t.B.volume}σ</span></div>
        <div className="sr-cstat"><span className="k">A pct</span><span className="v">{ordinal(t.A.volume)}</span></div>
        <div className="sr-cstat"><span className="k">C notional</span><span className="v">{t.C.nr}×</span></div>
      </div>
      <PBar v={t.C.nnp} />
      <div className="sr-card-foot">
        <span className="pl">Signed pressure</span>
        <b className="pv" style={{ color: up ? 'var(--buy)' : 'var(--sell)' }}>{pctStr(t.C.nnp)}</b>
        <StarBtn sym={t.symbol} cls="sr-cardstar" />
      </div>
    </div>
  );
}

Object.assign(window, { ScanResults, SavedScans, savedScansStore, useSavedScans, SrTable, SrGrouped, SrCards });
