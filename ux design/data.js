/* ============================================================
   Unusual Trading Activity Agent — Sample Dataset
   Invented but spec-faithful. Exposed on window.UTA.
   All numbers are illustrative. Direction is never inferred
   from price; tiers come from rule-based A/B/C logic.
   ============================================================ */
(function () {
  // seeded RNG for deterministic sparkline series
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  function fmtMoney(n) {
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return n.toFixed(0);
  }

  // ---- macro / market regime ----
  const macro = {
    vix: 28.4, vixSeries: [16.1, 17.0, 19.8, 22.4, 21.1, 24.6, 27.0, 28.4],
    yieldCurve: -0.12, fedFunds: 4.75,
    regime: 'risk_off', // risk_on | neutral | risk_off | crisis
    label: 'Risk-Off',
    interpretation: 'Large off-exchange activity may reflect liquidation, not accumulation. Treat bullish signals cautiously.',
    asOf: '07:02 ET',
  };

  // build a time-bucketed intraday volume series vs baseline band
  function vseries(seed, mult) {
    const r = rng(seed);
    const base = [1.0, 0.72, 0.55, 0.6, 0.85, 1.1];
    return base.map((b, i) => {
      const noise = 0.8 + r() * 0.5;
      return { bucket: ['Open', 'Morn', 'Mid', 'Aft', 'Power', 'Close'][i], baseline: b, value: +(b * mult * noise).toFixed(2) };
    });
  }
  function pseries(seed, bias) {
    const r = rng(seed); const out = []; let v = bias * 0.4;
    for (let i = 0; i < 26; i++) { v += (bias - v) * 0.12 + (r() - 0.5) * 0.22; out.push(+Math.max(-1, Math.min(1, v)).toFixed(3)); }
    return out;
  }

  // ---- core ticker table (hand-set headline numbers) ----
  const core = [
    { symbol: 'AVGO', name: 'Broadcom Inc.', exch: 'NASDAQ', sector: 'Information Technology', industry: 'Semiconductors', price: 1842.30, chg: 3.18, bucket: 'mega',
      tier: 'A', dir: 'bullish', sign: 0.74, band: 'Extreme',
      B: { volume: 3.8, notional: 4.1, focus: 2.9, pressure: 2.6, premarket: 2.2 },
      A: { volume: 0.97, focus: 0.93, pressure: 0.89 },
      C: { vr: 9.8, nr: 9.8, cr: 4.2, fshare: 0.50, fcount: 4, lpm: 6.2, nnp: 0.72, nvp: 0.68, fnotional: 440e6, total: 880e6, largest: 168e6 },
      corr: { price: true, options: false, news: false, provider: true, prepost: true, macro: false },
      alerts: [{ provider: 'TradeVision', type: 'Block', dir: 'bullish', ts: '14:22 ET', conf: 'Confirmed', notional: 168e6 }],
      news: null, delta: { tier: 'up', b: +0.4 },
      premkt: { vr: 6.1, pressure: 0.61, gap: 1.9, decay: 0.31 } },

    { symbol: 'NVDA', name: 'NVIDIA Corp.', exch: 'NASDAQ', sector: 'Information Technology', industry: 'Semiconductors', price: 1318.74, chg: 2.04, bucket: 'mega',
      tier: 'A', dir: 'bullish', sign: 0.81, band: 'Unusual',
      B: { volume: 2.7, notional: 3.0, focus: 2.6, pressure: 3.1, premarket: 1.4 },
      A: { volume: 0.91, focus: 0.88, pressure: 0.95 },
      C: { vr: 5.4, nr: 5.9, cr: 3.1, fshare: 0.41, fcount: 7, lpm: 4.4, nnp: 0.69, nvp: 0.71, fnotional: 612e6, total: 1490e6, largest: 121e6 },
      corr: { price: true, options: true, news: false, provider: true, prepost: false, macro: false },
      alerts: [{ provider: 'Unusual Whales', type: 'Sweep', dir: 'bullish', ts: '11:08 ET', conf: 'Confirmed', notional: 92e6 }, { provider: 'TradeVision', type: 'Block', dir: 'bullish', ts: '13:47 ET', conf: 'Confirmed', notional: 121e6 }],
      news: null, delta: { tier: 'flat', b: +0.1 },
      premkt: { vr: 2.2, pressure: 0.33, gap: 0.6, decay: 0.18 } },

    { symbol: 'LLY', name: 'Eli Lilly & Co.', exch: 'NYSE', sector: 'Health Care', industry: 'Pharmaceuticals', price: 1067.50, chg: 4.42, bucket: 'mega',
      tier: 'A', dir: 'bullish', sign: 0.7, band: 'Extreme',
      B: { volume: 4.4, notional: 4.0, focus: 3.3, pressure: 2.4, premarket: 3.1 },
      A: { volume: 0.99, focus: 0.96, pressure: 0.84 },
      C: { vr: 11.2, nr: 10.6, cr: 5.0, fshare: 0.57, fcount: 5, lpm: 7.1, nnp: 0.66, nvp: 0.6, fnotional: 388e6, total: 680e6, largest: 142e6 },
      corr: { price: true, options: false, news: true, provider: false, prepost: true, macro: false },
      alerts: [], news: { type: 'FDA', headline: 'Phase 3 readout expected after close', ts: 'Today' }, delta: { tier: 'up', b: +1.2 },
      premkt: { vr: 8.4, pressure: 0.58, gap: 3.2, decay: 0.4 } },

    { symbol: 'JPM', name: 'JPMorgan Chase & Co.', exch: 'NYSE', sector: 'Financials', industry: 'Diversified Banks', price: 268.91, chg: 0.86, bucket: 'mega',
      tier: 'B', dir: 'bullish', sign: 0.63, band: 'Unusual',
      B: { volume: 2.1, notional: 2.3, focus: 1.7, pressure: 1.6, premarket: 0.9 },
      A: { volume: 0.78, focus: 0.72, pressure: 0.69 },
      C: { vr: 3.2, nr: 3.5, cr: 2.0, fshare: 0.31, fcount: 6, lpm: 3.8, nnp: 0.52, nvp: 0.49, fnotional: 210e6, total: 680e6, largest: 64e6 },
      corr: { price: true, options: false, news: false, provider: false, prepost: false, macro: true },
      alerts: [], news: null, delta: { tier: 'flat', b: +0.2 },
      premkt: { vr: 1.4, pressure: 0.22, gap: 0.3, decay: 0.12 } },

    { symbol: 'CRWD', name: 'CrowdStrike Holdings', exch: 'NASDAQ', sector: 'Information Technology', industry: 'Systems Software', price: 482.16, chg: 1.77, bucket: 'large',
      tier: 'B', dir: 'bullish', sign: 0.66, band: 'Unusual',
      B: { volume: 2.4, notional: 2.2, focus: 2.0, pressure: 1.9, premarket: 1.1 },
      A: { volume: 0.82, focus: 0.79, pressure: 0.74 },
      C: { vr: 4.1, nr: 3.9, cr: 2.6, fshare: 0.36, fcount: 5, lpm: 4.0, nnp: 0.58, nvp: 0.55, fnotional: 96e6, total: 266e6, largest: 31e6 },
      corr: { price: true, options: true, news: false, provider: false, prepost: true, macro: true },
      alerts: [], news: null, delta: { tier: 'up', b: +0.6 },
      premkt: { vr: 2.9, pressure: 0.44, gap: 1.1, decay: 0.28 } },

    { symbol: 'PLTR', name: 'Palantir Technologies', exch: 'NASDAQ', sector: 'Information Technology', industry: 'Application Software', price: 64.28, chg: 2.41, bucket: 'large',
      tier: 'B', dir: 'bullish', sign: 0.58, band: 'Unusual',
      B: { volume: 1.9, notional: 1.8, focus: 1.6, pressure: 1.5, premarket: 1.3 },
      A: { volume: 0.75, focus: 0.71, pressure: 0.7 },
      C: { vr: 2.8, nr: 2.7, cr: 1.9, fshare: 0.28, fcount: 4, lpm: 3.2, nnp: 0.49, nvp: 0.47, fnotional: 71e6, total: 254e6, largest: 22e6 },
      corr: { price: true, options: true, news: false, provider: false, prepost: false, macro: true },
      alerts: [], news: null, delta: { tier: 'flat', b: -0.1 },
      premkt: { vr: 1.8, pressure: 0.31, gap: 0.7, decay: 0.2 } },

    { symbol: 'XOM', name: 'Exxon Mobil Corp.', exch: 'NYSE', sector: 'Energy', industry: 'Integrated Oil & Gas', price: 112.44, chg: -1.92, bucket: 'mega',
      tier: 'B', dir: 'bearish', sign: 0.69, band: 'Unusual',
      B: { volume: 2.6, notional: 2.5, focus: 2.1, pressure: 2.3, premarket: 1.2 },
      A: { volume: 0.84, focus: 0.77, pressure: 0.81 },
      C: { vr: 4.6, nr: 4.4, cr: 2.4, fshare: 0.34, fcount: 5, lpm: 3.9, nnp: -0.61, nvp: -0.58, fnotional: 188e6, total: 552e6, largest: 58e6 },
      corr: { price: true, options: false, news: true, provider: true, prepost: false, macro: true },
      alerts: [{ provider: 'TradeVision', type: 'Block', dir: 'bearish', ts: '10:54 ET', conf: 'Confirmed', notional: 58e6 }],
      news: { type: 'Macro', headline: 'Crude -3.4% on inventory build', ts: 'Today' }, delta: { tier: 'up', b: +0.5 },
      premkt: { vr: 2.1, pressure: -0.38, gap: -1.4, decay: 0.22 } },

    { symbol: 'TSLA', name: 'Tesla, Inc.', exch: 'NASDAQ', sector: 'Consumer Discretionary', industry: 'Automobiles', price: 298.10, chg: -2.66, bucket: 'mega',
      tier: 'B', dir: 'bearish', sign: 0.64, band: 'Unusual',
      B: { volume: 2.2, notional: 2.4, focus: 1.8, pressure: 2.0, premarket: 1.6 },
      A: { volume: 0.8, focus: 0.74, pressure: 0.78 },
      C: { vr: 3.9, nr: 4.1, cr: 2.2, fshare: 0.29, fcount: 4, lpm: 3.4, nnp: -0.55, nvp: -0.52, fnotional: 214e6, total: 740e6, largest: 71e6 },
      corr: { price: true, options: true, news: false, provider: false, prepost: true, macro: true },
      alerts: [], news: null, delta: { tier: 'down', b: -0.3 },
      premkt: { vr: 2.6, pressure: -0.41, gap: -1.7, decay: 0.3 } },

    { symbol: 'AAPL', name: 'Apple Inc.', exch: 'NASDAQ', sector: 'Information Technology', industry: 'Technology Hardware', price: 224.66, chg: 0.31, bucket: 'mega',
      tier: 'C', dir: 'mixed', sign: 0.58, band: 'Elevated',
      B: { volume: 1.3, notional: 1.2, focus: 0.9, pressure: 0.4, premarket: 0.6 },
      A: { volume: 0.61, focus: 0.55, pressure: 0.5 },
      C: { vr: 1.8, nr: 1.7, cr: 1.4, fshare: 0.19, fcount: 3, lpm: 2.4, nnp: 0.12, nvp: 0.08, fnotional: 142e6, total: 740e6, largest: 49e6 },
      corr: { price: false, options: false, news: false, provider: false, prepost: false, macro: false },
      alerts: [], news: null, delta: { tier: 'flat', b: +0.1 },
      premkt: { vr: 1.1, pressure: 0.05, gap: 0.1, decay: 0.08 } },

    { symbol: 'WMT', name: 'Walmart Inc.', exch: 'NYSE', sector: 'Consumer Staples', industry: 'Hypermarkets', price: 84.12, chg: 0.42, bucket: 'mega',
      tier: 'C', dir: 'undetermined', sign: 0.41, band: 'Elevated',
      B: { volume: 1.4, notional: 1.3, focus: 1.0, pressure: 0.3, premarket: 0.5 },
      A: { volume: 0.64, focus: 0.58, pressure: 0.44 },
      C: { vr: 1.9, nr: 1.8, cr: 1.5, fshare: 0.22, fcount: 3, lpm: 2.6, nnp: 0.18, nvp: 0.14, fnotional: 88e6, total: 400e6, largest: 28e6 },
      corr: { price: false, options: false, news: false, provider: false, prepost: false, macro: false },
      alerts: [], news: null, delta: { tier: 'flat', b: 0.0 },
      premkt: { vr: 1.0, pressure: 0.02, gap: 0.0, decay: 0.05 } },

    { symbol: 'BA', name: 'Boeing Co.', exch: 'NYSE', sector: 'Industrials', industry: 'Aerospace & Defense', price: 178.33, chg: -0.74, bucket: 'large',
      tier: 'C', dir: 'mixed', sign: 0.47, band: 'Elevated',
      B: { volume: 1.6, notional: 1.5, focus: 1.2, pressure: 0.7, premarket: 0.9 },
      A: { volume: 0.68, focus: 0.62, pressure: 0.55 },
      C: { vr: 2.2, nr: 2.1, cr: 1.6, fshare: 0.24, fcount: 3, lpm: 2.8, nnp: -0.22, nvp: -0.19, fnotional: 64e6, total: 268e6, largest: 24e6 },
      corr: { price: false, options: false, news: true, provider: false, prepost: false, macro: false },
      alerts: [], news: { type: 'News', headline: 'Delivery-rate report due this week', ts: 'Today' }, delta: { tier: 'flat', b: +0.2 },
      laneIssue: 'partial', coverage: 0.82, capNote: 'Usable — partial coverage. Tier capped at C until the live trade-slices lane reaches 90% coverage for this session.',
      premkt: { vr: 1.3, pressure: -0.14, gap: -0.5, decay: 0.1 } },

    { symbol: 'MSFT', name: 'Microsoft Corp.', exch: 'NASDAQ', sector: 'Information Technology', industry: 'Systems Software', price: 472.05, chg: 0.12, bucket: 'mega',
      tier: 'D', dir: 'undetermined', sign: 0.0, band: null,
      B: { volume: null, notional: null, focus: null, pressure: null, premarket: null },
      A: { volume: null, focus: null, pressure: null },
      C: { vr: null, nr: null, cr: null, fshare: null, fcount: null, lpm: null, nnp: null, nvp: null, fnotional: null, total: null, largest: null },
      corr: { price: false, options: false, news: false, provider: false, prepost: false, macro: false },
      alerts: [], news: null, delta: { tier: 'flat', b: null }, laneIssue: 'loading',
      premkt: null },
  ];

  // band/anomaly label helper
  function dirLabel(d) { return { bullish: 'Buyer-side', bearish: 'Seller-side', mixed: 'Mixed', undetermined: 'Undetermined' }[d]; }

  // synthesize BLUF text from numbers
  function buildBluf(t) {
    if (t.tier === 'D') {
      return {
        headline: `${t.symbol} — Tier D — Suppressed`,
        what: 'Live trade-slice lane is still loading. No directional signal is computed on incomplete data.',
        why: 'A tier is never emitted while a required lane is loading or a sample is below threshold.',
        check: 'Refresh the live trade-slices lane, then re-evaluate.',
        limits: 'No score is shown as current until the source lane reports ready.',
      };
    }
    const C = t.C, B = t.B;
    const dirWord = t.dir === 'bullish' ? 'buyer-side' : t.dir === 'bearish' ? 'seller-side' : t.dir;
    const pressPct = C.nnp == null ? '' : (C.nnp > 0 ? '+' : '') + Math.round(C.nnp * 100) + '%';
    return {
      headline: `${t.symbol} — Tier ${t.tier} — ${t.dir === 'mixed' || t.dir === 'undetermined' ? 'Context only' : t.dir[0].toUpperCase() + t.dir.slice(1) + ' supporting evidence'}`,
      what: `Notional activity was ${C.nr}× its recent median. ${C.fcount} off-exchange / large focus prints totaled $${fmtMoney(C.fnotional)} (${Math.round(C.fshare * 100)}% of analyzed notional).`,
      why: t.dir === 'undetermined'
        ? `Signed pressure did not reach the ${0.6} direction threshold (${pressPct}). Volume is elevated but non-directional — context only.`
        : `Signed notional pressure leaned ${dirWord} at ${pressPct}. B-score ${B.volume}σ above own 20-session median${t.corr.prepost ? '. Pre-market and regular session both elevated' : ''}${t.alerts.length ? '. ' + t.alerts[0].provider + ' confirmed' : ''}.`,
      check: 'Price follow-through, VWAP reclaim, options flow, and news catalyst before treating as conviction.',
      limits: `Off-exchange prints identify off-exchange reporting only — not the named institution or venue.${macro.regime === 'risk_off' ? ' VIX at ' + macro.vix + ': risk-off context — treat bullish signals cautiously.' : ''}`,
    };
  }

  // lane states per ticker
  function buildLanes(t) {
    const ready = (id, label, fresh) => ({ id, label, state: 'ready', operator: 'Ready', fresh, sla: 1800 });
    if (t.laneIssue === 'loading') {
      return [
        { id: 'massive_live_trade_slices', label: 'Live Trade Slices', state: 'loading', operator: 'Data is still loading', fresh: null, sla: 1800 },
        ready('massive_daily_bars', 'Daily Bars', 60),
        { id: 'massive_block_trade_feed', label: 'Block Trade Feed', state: 'blocked', operator: 'Cannot evaluate', fresh: null, sla: 1800 },
        ready('fred_macro_context', 'FRED Macro', 3600),
      ];
    }
    if (t.laneIssue === 'partial') {
      return [
        { id: 'massive_live_trade_slices', label: 'Live Trade Slices', state: 'partial_usable', operator: 'Usable — partial coverage', fresh: 240, sla: 1800 },
        ready('massive_premarket_trade_slices', 'Pre-Market Slices', 900),
        ready('massive_daily_bars', 'Daily Bars', 60),
        { id: 'massive_block_trade_feed', label: 'Block Trade Feed', state: 'partial_usable', operator: 'Usable — partial coverage', fresh: 240, sla: 1800 },
        ready('fred_macro_context', 'FRED Macro', 3600),
        { id: 'activity_alerts', label: 'Confirmed Alerts', state: 'disabled_optional', operator: 'Optional source disabled', fresh: null, sla: 0 },
        ready('earnings_calendar', 'Earnings Calendar', 86400),
        ready('universe_constituents', 'Universe Lists', 86400 * 3),
      ];
    }
    return [
      ready('massive_premarket_trade_slices', 'Pre-Market Slices', 900),
      ready('massive_daily_bars', 'Daily Bars', 60),
      ready('massive_block_trade_feed', 'Block Trade Feed', 120),
      ready('fred_macro_context', 'FRED Macro', 3600),
      t.alerts.length ? ready('activity_alerts', 'Confirmed Alerts', 600)
        : { id: 'activity_alerts', label: 'Confirmed Alerts', state: 'disabled_optional', operator: 'Optional source disabled', fresh: null, sla: 0 },
      ready('earnings_calendar', 'Earnings Calendar', 86400),
      ready('universe_constituents', 'Universe Lists', 86400 * 3),
    ];
  }

  // expand every ticker with derived display data
  const tickers = core.map((t, i) => {
    const seed = 1000 + i * 37;
    return Object.assign({}, t, {
      dirLabel: dirLabel(t.dir),
      bluf: buildBluf(t),
      lanes: buildLanes(t),
      volSeries: t.tier === 'D' ? null : vseries(seed, t.C.vr / 2.2),
      pressSeries: t.tier === 'D' ? null : pseries(seed + 5, t.C.nnp || 0),
      vixSeries: macro.vixSeries,
      signMix: t.tier === 'D' ? null : { quote: 0.66, tick: 0.18, mid: 0.1, unknown: 0.06 },
      asOf: '14:35:22 ET',
      coverage: t.coverage != null ? t.coverage : (t.laneIssue === 'loading' ? 0.0 : 1.0),
      rowCount: t.tier === 'D' ? 0 : Math.round((t.C.total || 0) / 1e5 + 1840),
      excluded: t.tier === 'D' ? 0 : Math.round(((t.C.total || 0) / 1e5 + 1840) * 0.06),
    });
  });

  const bySym = Object.fromEntries(tickers.map(t => [t.symbol, t]));

  // ---- universes for scan ----
  const universes = [
    { id: 'sp500', label: 'S&P 500', cat: 'Index', count: 503, perf: 'standard', updated: '2026-06-06' },
    { id: 'ndx', label: 'NASDAQ-100', cat: 'Index', count: 100, perf: 'fast', updated: '2026-06-06' },
    { id: 'djia', label: 'Dow Jones Industrial', cat: 'Index', count: 30, perf: 'fast', updated: '2026-06-06' },
    { id: 'sp400', label: 'S&P 400 Mid-Cap', cat: 'Index', count: 400, perf: 'standard', updated: '2026-06-06' },
    { id: 'r2000', label: 'Russell 2000', cat: 'Index', count: 2000, perf: 'extended', updated: '2026-06-01' },
    { id: 'sec_it', label: 'Information Technology', cat: 'Sector · S&P 500', count: 70, perf: 'fast', updated: '2026-06-06' },
    { id: 'sec_hc', label: 'Health Care', cat: 'Sector · S&P 500', count: 65, perf: 'fast', updated: '2026-06-06' },
    { id: 'sec_en', label: 'Energy', cat: 'Sector · S&P 500', count: 25, perf: 'fast', updated: '2026-06-06' },
    { id: 'watchlist', label: 'My Watchlist', cat: 'Custom', count: 12, perf: 'fast', updated: 'live' },
    { id: 'portfolio', label: 'My Portfolio', cat: 'Custom', count: 8, perf: 'fast', updated: 'live' },
  ];

  // portfolio = subset
  const portfolioSymbols = ['AVGO', 'NVDA', 'LLY', 'JPM', 'XOM', 'TSLA', 'AAPL', 'MSFT'];

  window.UTA = {
    macro, tickers, bySym, universes, portfolioSymbols, fmtMoney, dirLabel,
  };
})();
