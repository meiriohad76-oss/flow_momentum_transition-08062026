/* ============================================================
   Options Flow — evidence card backing the "options aligned"
   corroboration flag. Optional lane; never affects tier when absent.
   ============================================================ */
const optFmt = window.UTA.fmtMoney;
function optRng(str) { let s = 0; for (let i = 0; i < str.length; i++) s = (s * 31 + str.charCodeAt(i)) >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function genOptionsFlow(t) {
  if (!t.corr || !t.corr.options || t.tier === 'D') return { available: false };
  const r = optRng(t.symbol + 'opt');
  const bull = t.dir === 'bullish';
  const bear = t.dir === 'bearish';
  let callShare = t.dir === 'mixed'
    ? 0.46 + (r() - 0.5) * 0.1
    : bull ? 0.60 + r() * 0.18 : 0.32 - r() * 0.10;
  callShare = Math.max(0.14, Math.min(0.9, callShare));
  const putShare = 1 - callShare;
  const cpr = +(callShare / putShare).toFixed(1);
  const base = t.C && t.C.fnotional ? t.C.fnotional * 0.13 : 42e6;
  const netPrem = Math.round(base * (0.6 + r() * 0.9));
  const sweeps = 4 + Math.floor(r() * 21);
  const blockPct = Math.round((0.28 + r() * 0.4) * 100);
  const skew = +((bull ? -1 : bear ? 1 : (r() - 0.5) * 2) * (1.1 + r() * 3)).toFixed(1); // 25Δ vol skew; <0 = calls bid
  const expiry = ['0DTE', 'Weekly', 'Front month', 'Next month'][Math.floor(r() * 4)];
  const aligned = (bull && callShare > 0.55) || (bear && putShare > 0.55);
  return { available: true, callShare, putShare, cpr, netPrem, sweeps, blockPct, skew, expiry, aligned, dir: t.dir };
}

function OptionsFlowCard({ t }) {
  const o = useMemo(() => genOptionsFlow(t), [t.symbol, t.tier]);
  const side = t.dir === 'bullish' ? 'buyer-side' : t.dir === 'bearish' ? 'seller-side' : 'mixed';
  const callsBid = o.skew < 0;
  return (
    <EvCard icon="sparkle" title="Options Flow" sub="Premium-weighted · OPRA"
      headline={o.available
        ? <span className={`ev-metric ${o.cpr >= 1.2 ? 'pos' : o.cpr <= 0.8 ? 'neg' : ''}`}>{o.cpr}× C/P</span>
        : <span className="ev-sub">optional</span>}>
      {o.available ? <>
        <div style={{ display: 'flex', gap: 18, marginBottom: 12, flexWrap: 'wrap' }}>
          <div><div className="uplabel" style={{ whiteSpace: 'nowrap' }}>Net premium</div><div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>${optFmt(o.netPrem)}</div></div>
          <div><div className="uplabel" style={{ whiteSpace: 'nowrap' }}>Sweeps</div><div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{o.sweeps}</div></div>
          <div><div className="uplabel" style={{ whiteSpace: 'nowrap' }}>Call / Put</div><div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{o.cpr}×</div></div>
        </div>
        <div className="uplabel" style={{ marginBottom: 6 }}>Premium split (calls vs puts)</div>
        <div className="mix-bar">
          <span style={{ width: (o.callShare * 100) + '%', background: 'var(--buy)' }} />
          <span style={{ width: (o.putShare * 100) + '%', background: 'var(--sell)' }} />
        </div>
        <div className="mix-legend">
          <span className="li"><span className="sw" style={{ background: 'var(--buy)' }} />Calls {Math.round(o.callShare * 100)}%</span>
          <span className="li"><span className="sw" style={{ background: 'var(--sell)' }} />Puts {Math.round(o.putShare * 100)}%</span>
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="kv"><span className="k">25-delta skew</span><span className="v" style={{ color: callsBid ? 'var(--buy)' : 'var(--sell)' }}>{Math.abs(o.skew)} vol pts · {callsBid ? 'calls bid' : 'puts bid'}</span></div>
          <div className="kv"><span className="k">Block share of premium</span><span className="v">{o.blockPct}%</span></div>
          <div className="kv"><span className="k">Dominant expiry</span><span className="v">{o.expiry}</span></div>
        </div>
        <div style={{ marginTop: 12 }}>
          {o.aligned
            ? <span className="pill" style={{ color: 'var(--buy)' }}><Icon name="check" size={12} />Flow agrees with {side} signal</span>
            : <span className="pill" style={{ color: 'var(--ink-2)' }}><Icon name="alert" size={11} />Flow does not confirm direction</span>}
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--ink-3)', margin: '8px 0 0' }}>Independent (Strong) corroboration lane — eligible to support a tier when aligned, never to lower one.</p>
      </> : (
        <div style={{ padding: '4px 0 2px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span className="ls ls-disabled" style={{ width: 7, height: 7, borderRadius: 99 }} />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)' }}>Optional lane — not contributing this cycle</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>No qualifying options flow for {t.symbol} today, or the OPRA lane is not subscribed for this name. An absent optional lane never affects the tier — only present, aligned flow can corroborate.</p>
        </div>
      )}
    </EvCard>
  );
}

Object.assign(window, { OptionsFlowCard, genOptionsFlow });
