/* ============================================================
   Review state + Alert rules + Activity feed mode
   ============================================================ */

/* ---------- persistent review store (reviewed / ignored) ---------- */
const RV_KEY = 'uta_review_v1';
const reviewStore = {
  map: (() => { try { return JSON.parse(localStorage.getItem(RV_KEY) || '{}'); } catch (e) { return {}; } })(),
  subs: new Set(),
  get(s) { return this.map[s] || null; },
  set(s, v) {
    if (v) this.map[s] = v; else delete this.map[s];
    try { localStorage.setItem(RV_KEY, JSON.stringify(this.map)); } catch (e) {}
    this.subs.forEach(f => f());
  },
  toggle(s, v) { this.set(s, this.get(s) === v ? null : v); },
};
function useReview() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force(n => n + 1); reviewStore.subs.add(f); return () => reviewStore.subs.delete(f); }, []);
  return { get: s => reviewStore.get(s), set: (s, v) => reviewStore.set(s, v), toggle: (s, v) => reviewStore.toggle(s, v) };
}
function ReviewChip({ sym }) {
  const rv = useReview();
  const st = rv.get(sym);
  if (!st) return null;
  return st === 'reviewed'
    ? <span className="rv-chip rv-reviewed"><Icon name="check" size={12} />Reviewed</span>
    : <span className="rv-chip rv-ignored"><Icon name="x" size={11} />Ignored this cycle</span>;
}
function ReviewDot({ sym }) {
  const rv = useReview();
  const st = rv.get(sym);
  if (!st) return null;
  return <span className={`row-rv rv-${st}`} title={st === 'reviewed' ? 'Reviewed' : 'Ignored this cycle'} />;
}

/* ============================================================
   Alert rules — persistent store + evaluation engine
   ============================================================ */
const RULE_KEY = 'uta_rules_v1';
const DEFAULT_RULES = [
  { id: 'r-tierA', name: 'Tier A breakouts', enabled: true, scope: 'all', dir: 'any', minTier: 'A',
    cB: { on: false, v: 2.5 }, cA: { on: false, v: 85 }, cC: { on: false, v: 5 }, provider: false },
  { id: 'r-block', name: 'Confirmed block buyers', enabled: true, scope: 'all', dir: 'bullish', minTier: 'any',
    cB: { on: true, v: 2.5 }, cA: { on: false, v: 85 }, cC: { on: false, v: 5 }, provider: true },
  { id: 'r-bear', name: 'Bearish notional surge', enabled: true, scope: 'all', dir: 'bearish', minTier: 'any',
    cB: { on: false, v: 1.5 }, cA: { on: false, v: 70 }, cC: { on: true, v: 4 }, provider: false },
];
const ruleStore = {
  list: (() => { try { const s = localStorage.getItem(RULE_KEY); if (s) return JSON.parse(s); } catch (e) {} return DEFAULT_RULES.map(r => ({ ...r })); })(),
  version: 0, subs: new Set(),
  persist() { try { localStorage.setItem(RULE_KEY, JSON.stringify(this.list)); } catch (e) {} this.version++; this.subs.forEach(f => f()); },
  add(r) { this.list = [...this.list, r]; this.persist(); },
  update(id, r) { this.list = this.list.map(x => x.id === id ? { ...x, ...r } : x); this.persist(); },
  remove(id) { this.list = this.list.filter(x => x.id !== id); this.persist(); },
  toggle(id) { this.list = this.list.map(x => x.id === id ? { ...x, enabled: !x.enabled } : x); this.persist(); },
};
function useRules() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force(n => n + 1); ruleStore.subs.add(f); return () => ruleStore.subs.delete(f); }, []);
  return { list: ruleStore.list, version: ruleStore.version, add: r => ruleStore.add(r), update: (id, r) => ruleStore.update(id, r), remove: id => ruleStore.remove(id), toggle: id => ruleStore.toggle(id) };
}
function newRule() {
  return { id: 'r' + Date.now().toString(36), name: 'New alert rule', enabled: true, scope: 'all', dir: 'any', minTier: 'any',
    cB: { on: true, v: 2.0 }, cA: { on: false, v: 85 }, cC: { on: false, v: 5 }, provider: false };
}
const TIER_RANK = { A: 4, B: 3, C: 2, D: 1 };
function scopeTickers(scope) {
  const U = window.UTA;
  if (scope === 'portfolio') return U.portfolioSymbols.map(s => U.bySym[s]).filter(Boolean);
  if (scope === 'watchlist') return (window.watchStore ? window.watchStore.list() : []).map(s => U.bySym[s]).filter(Boolean);
  return U.tickers;
}
function ruleMatches(rule, t) {
  if (t.tier === 'D') return false;
  if (rule.minTier !== 'any' && TIER_RANK[t.tier] < TIER_RANK[rule.minTier]) return false;
  if (rule.dir !== 'any' && t.dir !== rule.dir) return false;
  if (rule.cB.on && !(t.B.volume >= rule.cB.v)) return false;
  if (rule.cA.on && !((t.A.volume * 100) >= rule.cA.v)) return false;
  if (rule.cC.on && !(t.C.nr >= rule.cC.v)) return false;
  if (rule.provider && !t.corr.provider) return false;
  return true;
}
function matchesForRule(rule) { return scopeTickers(rule.scope).filter(t => ruleMatches(rule, t)); }
function rulesMatchingSym(sym) {
  return ruleStore.list.filter(r => r.enabled && matchesForRule(r).some(t => t.symbol === sym)).map(r => r.name);
}
function RuleFlag({ sym }) {
  useRules(); // subscribe so the flag updates when rules change
  const names = rulesMatchingSym(sym);
  if (!names.length) return null;
  return <span className="rule-flag" title={`Matches ${names.length} active rule${names.length > 1 ? 's' : ''}: ${names.join(' · ')}`}><Icon name="sparkle" size={11} />{names.length}</span>;
}
function ruleMatchDesc(rule, t) {
  const parts = [`Tier ${t.tier}`, t.dir === 'bullish' ? 'buyer-side' : t.dir === 'bearish' ? 'seller-side' : t.dir];
  if (rule.cB.on) parts.push(`B ${t.B.volume}σ`);
  if (rule.cA.on) parts.push(`${ordinal(t.A.volume)} pct`);
  if (rule.cC.on) parts.push(`${t.C.nr}× notional`);
  if (rule.provider && t.alerts[0]) parts.push(`${t.alerts[0].provider} confirmed`);
  return `Matched your rule — ${parts.join(' · ')}.`;
}

/* ---------- activity feed builder ---------- */
function pseudoTime(seed) {
  let s = 0; for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  const h = 10 + (s % 5); const m = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function pseudoTimeRecent(seed) {
  let s = 0; for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  return `14:${String(14 + (s % 21)).padStart(2, '0')}`;
}
function buildRuleEvents() {
  const out = [];
  ruleStore.list.filter(r => r.enabled).forEach(r => {
    matchesForRule(r).forEach(t => {
      out.push({ kind: 'rule', sym: t.symbol, t, dir: t.dir, time: pseudoTimeRecent(r.id + t.symbol),
        title: r.name, desc: ruleMatchDesc(r, t), ruleName: r.name });
    });
  });
  return out;
}
function buildFeed() {
  const U = window.UTA;
  const rank = { A: 4, B: 3, C: 2, D: 1 }, nameByRank = { 4: 'A', 3: 'B', 2: 'C', 1: 'D' };
  const events = [];
  U.tickers.forEach(t => {
    (t.alerts || []).forEach(a => {
      events.push({ kind: 'alert', sym: t.symbol, t, dir: a.dir, time: (a.ts || '').replace(' ET', ''),
        title: `${a.provider} ${a.type.toLowerCase()} confirmed`,
        desc: `${a.dir[0].toUpperCase() + a.dir.slice(1)} · $${U.fmtMoney(a.notional)} focus print · matches signal direction — eligible for tier elevation` });
    });
    if (t.delta && (t.delta.tier === 'up' || t.delta.tier === 'down')) {
      const up = t.delta.tier === 'up';
      const cur = rank[t.tier];
      const from = nameByRank[up ? cur - 1 : cur + 1] || t.tier;
      events.push({ kind: up ? 'tierup' : 'tierdown', sym: t.symbol, t, dir: t.dir, time: '14:35',
        title: `Tier ${up ? 'raised' : 'lowered'} ${from} → ${t.tier}`,
        desc: up
          ? `Cleared the Tier ${t.tier} gate this cycle — B at ${t.B.volume}σ${t.delta.b != null ? ` (${t.delta.b > 0 ? '+' : ''}${t.delta.b}σ vs prior cycle)` : ''}.`
          : `Fell below the Tier ${from} threshold this cycle — indicators eased back.` });
    }
    if (t.news) {
      events.push({ kind: 'news', sym: t.symbol, t, dir: t.dir, time: pseudoTime(t.symbol + 'news'),
        title: `${t.news.type} catalyst`, desc: t.news.headline });
    }
    if (t.laneIssue === 'loading') events.push({ kind: 'lane', sym: t.symbol, t, dir: t.dir, time: '14:34',
      title: 'Tier suppressed — required lane loading',
      desc: 'Live Trade Slices lane went loading mid-cycle — no tier is emitted on incomplete data.' });
    if (t.laneIssue === 'partial') events.push({ kind: 'lane', sym: t.symbol, t, dir: t.dir, time: '14:31',
      title: 'Coverage degraded — tier capped at C',
      desc: `Live Trade Slices at ${Math.round((t.coverage || 0) * 100)}% coverage (< 90% required) — tier capped until coverage recovers.` });
  });
  events.push(...buildRuleEvents());
  events.sort((a, b) => b.time.localeCompare(a.time));
  return events;
}
function feedCounts() {
  const f = buildFeed();
  const count = k => f.filter(e => e.kind === k).length;
  return {
    total: f.length, alert: count('alert'),
    tier: f.filter(e => e.kind === 'tierup' || e.kind === 'tierdown').length,
    news: count('news'), lane: count('lane'), rule: count('rule'),
    hot: f.filter(e => e.kind === 'alert' || e.kind === 'tierup' || e.kind === 'rule').length,
  };
}

const FEED_ICON = { alert: 'check', tierup: 'up', tierdown: 'down', news: 'flag', lane: 'database', rule: 'sparkle' };

function FeedRow({ e, onOpen }) {
  return (
    <div className="feed-row" onClick={() => onOpen(e.sym)}>
      <span className="feed-time">{e.time}</span>
      <span className={`feed-ico k-${e.kind}`}><Icon name={FEED_ICON[e.kind]} size={16} /></span>
      <div className="feed-main">
        <div className="feed-title">
          <span className="feed-sym">{e.sym}</span>
          <span>{e.title}</span>
          {e.kind === 'rule' && <span className="rc-cond" style={{ fontFamily: 'var(--font-ui)' }}>rule</span>}
          <ReviewDot sym={e.sym} />
        </div>
        <div className="feed-desc">{e.desc}</div>
      </div>
      <div className="feed-meta">
        <TierBadge tier={e.t.tier} size="sm" />
        {(e.dir === 'bullish' || e.dir === 'bearish') && <DirTag dir={e.dir} />}
        <span className="feed-go"><Icon name="chevron" size={16} style={{ transform: 'rotate(-90deg)' }} /></span>
      </div>
    </div>
  );
}

/* ---------- rule builder UI ---------- */
function USwitch({ on, onClick }) {
  return <button type="button" className={`uswitch ${on ? 'on' : ''}`} onClick={onClick} aria-pressed={on} />;
}
function CondRow({ label, unit, c, min, max, step, onToggle, onVal }) {
  return (
    <div className={`cond-row ${c.on ? '' : 'off'}`}>
      <USwitch on={c.on} onClick={onToggle} />
      <div>
        <div className="cond-label">{label}</div>
        <input type="range" className="cond-range" min={min} max={max} step={step} value={c.v} disabled={!c.on} onChange={e => onVal(+e.target.value)} />
      </div>
      <span className="cond-val">{c.v}{unit}</span>
    </div>
  );
}
function RuleEditor({ rule, onSave, onCancel }) {
  const [r, setR] = useState(rule);
  const set = (k, v) => setR(p => ({ ...p, [k]: v }));
  const setC = (k, patch) => setR(p => ({ ...p, [k]: { ...p[k], ...patch } }));
  const matches = matchesForRule(r);
  return (
    <div className="rule-editor">
      <div className="re-field"><label>Rule name</label>
        <input className="re-input" value={r.name} onChange={e => set('name', e.target.value)} placeholder="Name this rule" /></div>
      <div className="re-field"><label>Scope</label>
        <div className="seg">
          <button className={r.scope === 'all' ? 'on' : ''} onClick={() => set('scope', 'all')}>All tracked</button>
          <button className={r.scope === 'portfolio' ? 'on' : ''} onClick={() => set('scope', 'portfolio')}>Portfolio</button>
          <button className={r.scope === 'watchlist' ? 'on' : ''} onClick={() => set('scope', 'watchlist')}>Watchlist</button>
        </div></div>
      <div className="re-field"><label>Direction</label>
        <div className="seg">
          <button className={r.dir === 'any' ? 'on' : ''} onClick={() => set('dir', 'any')}>Any</button>
          <button className={r.dir === 'bullish' ? 'on bull' : ''} onClick={() => set('dir', 'bullish')}><Icon name="up" size={13} />Bullish</button>
          <button className={r.dir === 'bearish' ? 'on bear' : ''} onClick={() => set('dir', 'bearish')}><Icon name="down" size={13} />Bearish</button>
        </div></div>
      <div className="re-field"><label>Minimum tier</label>
        <div className="seg">
          {['any', 'C', 'B', 'A'].map(tk => <button key={tk} className={r.minTier === tk ? 'on' : ''} onClick={() => set('minTier', tk)}>{tk === 'any' ? 'Any' : 'Tier ' + tk}</button>)}
        </div></div>
      <div className="re-field"><label>Indicator thresholds</label>
        <div>
          <CondRow label="B · vs own history" unit="σ" c={r.cB} min={0} max={5} step={0.5} onToggle={() => setC('cB', { on: !r.cB.on })} onVal={v => setC('cB', { v })} />
          <CondRow label="A · universe percentile" unit="th" c={r.cA} min={50} max={99} step={1} onToggle={() => setC('cA', { on: !r.cA.on })} onVal={v => setC('cA', { v })} />
          <CondRow label="C · notional ratio" unit="×" c={r.cC} min={1} max={12} step={0.5} onToggle={() => setC('cC', { on: !r.cC.on })} onVal={v => setC('cC', { v })} />
        </div></div>
      <div className="re-toggle"><USwitch on={r.provider} onClick={() => set('provider', !r.provider)} /><span className="rt-label">Require a confirmed provider alert</span></div>
      <div className="re-preview">Matches <b>{matches.length}</b> ticker{matches.length !== 1 ? 's' : ''} right now{matches.length ? ':' : '.'}
        {matches.length > 0 && <div className="pv-syms">{matches.map(t => <span key={t.symbol}>{t.symbol}</span>)}</div>}</div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn btn-accent" onClick={() => r.name.trim() && onSave(r)}><Icon name="check" size={14} className="ic" />Save rule</button>
      </div>
    </div>
  );
}
function RuleCard({ rule, onEdit, onToggle, onDelete, onOpenSym }) {
  const matches = matchesForRule(rule);
  const conds = [rule.scope === 'all' ? 'All tracked' : rule.scope === 'portfolio' ? 'Portfolio' : 'Watchlist'];
  if (rule.dir !== 'any') conds.push(rule.dir === 'bullish' ? 'Buyer-side' : 'Seller-side');
  if (rule.minTier !== 'any') conds.push('≥ Tier ' + rule.minTier);
  if (rule.cB.on) conds.push('B ≥ ' + rule.cB.v + 'σ');
  if (rule.cA.on) conds.push('A ≥ ' + rule.cA.v + 'th');
  if (rule.cC.on) conds.push('C ≥ ' + rule.cC.v + '×');
  if (rule.provider) conds.push('Provider ✓');
  return (
    <div className={`rule-card ${rule.enabled ? '' : 'off'}`}>
      <div className="rc-top">
        <USwitch on={rule.enabled} onClick={onToggle} />
        <div className="rc-name" onClick={onEdit}>{rule.name}</div>
        <span className="rc-count">{matches.length}</span>
        <button className="rc-del" title="Delete rule" onClick={onDelete}><Icon name="x" size={14} /></button>
      </div>
      <div className="rc-conds">{conds.map((c, i) => <span className="rc-cond" key={i}>{c}</span>)}</div>
      {matches.length
        ? <div className="rc-matches">{matches.map(t => <span className="rc-msym" key={t.symbol} onClick={() => onOpenSym(t.symbol)}>{t.symbol}</span>)}</div>
        : <div className="rc-nomatch">No matches this cycle.</div>}
    </div>
  );
}
function RulesDrawer({ open, onClose, onOpenSym }) {
  const rules = useRules();
  const [draft, setDraft] = useState(null);
  if (!open) return null;
  const editing = draft && rules.list.some(x => x.id === draft.id);
  function save(r) { editing ? rules.update(r.id, r) : rules.add(r); setDraft(null); }
  const active = rules.list.filter(r => r.enabled).length;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer" style={{ width: 'min(560px, 96vw)' }}>
        <div className="drawer-head">
          <span className="ico" style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'grid', placeItems: 'center' }}><Icon name="sliders" size={16} /></span>
          <div style={{ flex: 1 }}>
            <div className="dt">{draft ? (editing ? 'Edit rule' : 'New rule') : 'Alert rules'}</div>
            <div className="ds">{draft ? 'Tune conditions — matches flow into your feed' : `${active} active · ${rules.list.length} total · matches flow into your feed`}</div>
          </div>
          <button className="x-close" onClick={draft ? () => setDraft(null) : onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="drawer-body">
          {draft
            ? <RuleEditor rule={draft} onSave={save} onCancel={() => setDraft(null)} />
            : <>
              {rules.list.map(r => (
                <RuleCard key={r.id} rule={r}
                  onEdit={() => setDraft({ ...r })}
                  onToggle={() => rules.toggle(r.id)}
                  onDelete={() => rules.remove(r.id)}
                  onOpenSym={s => { onOpenSym(s); onClose(); }} />
              ))}
              {rules.list.length === 0 && <div className="rc-nomatch" style={{ borderTop: 'none', textAlign: 'center', padding: '24px 0' }}>No rules yet — create one to start watching for setups.</div>}
              <button className="btn" style={{ width: '100%', justifyContent: 'center', marginTop: 4, height: 40 }} onClick={() => setDraft(newRule())}><Icon name="plus" size={15} className="ic" />New alert rule</button>
            </>}
        </div>
        {!draft && <div className="drawer-foot"><Icon name="info" size={14} /><span>Rules evaluate every cycle against live A/B/C indicators. Matches appear in the feed tagged “rule”.</span></div>}
      </div>
    </>
  );
}

/* ---------- alerts mode ---------- */
function AlertsMode({ onOpen }) {
  useReview();
  const rh = useRules();
  const [filter, setFilter] = useState('all');
  const [rulesOpen, setRulesOpen] = useState(false);
  const all = useMemo(() => buildFeed(), [rh.version]);
  const c = useMemo(() => feedCounts(), [rh.version]);
  const activeRules = rh.list.filter(r => r.enabled).length;
  const filters = [
    { k: 'all', label: 'All activity', n: c.total },
    { k: 'rule', label: 'My rules', n: c.rule },
    { k: 'alert', label: 'Confirmed alerts', n: c.alert },
    { k: 'tier', label: 'Tier changes', n: c.tier },
    { k: 'news', label: 'News', n: c.news },
    { k: 'lane', label: 'Data lanes', n: c.lane },
  ];
  const rows = all.filter(e =>
    filter === 'all' ? true :
    filter === 'tier' ? (e.kind === 'tierup' || e.kind === 'tierdown') :
    e.kind === filter);

  return (
    <div className="page">
      <div className="mode-intro">
        <h1>Activity feed</h1>
        <p>Everything that moved this cycle, newest first — your alert-rule matches, confirmed provider alerts, tier changes, news catalysts, and data-lane events. Click any row for the full analysis.</p>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatCard label="Needs attention" value={c.hot} accent sub="alerts · upgrades · rules" />
        <StatCard label="Rule matches" value={c.rule} sub={`${activeRules} active rule${activeRules !== 1 ? 's' : ''}`} />
        <StatCard label="Confirmed alerts" value={c.alert} sub="provider-reviewed" />
        <StatCard label="Tier changes" value={c.tier} sub="vs last cycle" />
      </div>

      <div className="tbl-wrap">
        <div className="tbl-top">
          <div className="feed-filters">
            {filters.map(f => (
              <button key={f.k} className={`fchip ${filter === f.k ? 'on' : ''}`} onClick={() => setFilter(f.k)}>
                {f.label}<span className="fcount">{f.n}</span>
              </button>
            ))}
          </div>
          <button className="btn rules-btn" onClick={() => setRulesOpen(true)}>
            <Icon name="sliders" size={14} className="ic" />Alert rules
            {activeRules > 0 && <span className="mt-badge" style={{ marginLeft: 2 }}>{activeRules}</span>}
          </button>
        </div>
        {rows.length ? (
          <div className="feed">
            {rows.map((e, i) => <FeedRow key={e.kind + e.sym + e.title + i} e={e} onOpen={onOpen} />)}
          </div>
        ) : (
          <div className="feed-empty">
            <div className="ico" style={{ width: 44, height: 44, margin: '0 auto 12px', borderRadius: 12, background: 'var(--panel-3)', color: 'var(--ink-faint)', display: 'grid', placeItems: 'center' }}><Icon name="bell" size={22} /></div>
            <div style={{ fontWeight: 600, color: 'var(--ink-2)' }}>No {filters.find(f => f.k === filter).label.toLowerCase()} this cycle</div>
            {filter === 'rule' && <button className="btn btn-sm" style={{ marginTop: 14 }} onClick={() => setRulesOpen(true)}><Icon name="plus" size={13} className="ic" />Create a rule</button>}
          </div>
        )}
      </div>

      <RulesDrawer open={rulesOpen} onClose={() => setRulesOpen(false)} onOpenSym={onOpen} />
    </div>
  );
}

Object.assign(window, { AlertsMode, buildFeed, feedCounts, reviewStore, useReview, ReviewChip, ReviewDot, ruleStore, useRules, RuleFlag });
