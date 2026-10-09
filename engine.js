// Armageddon Chart Scanner 2.0 - signal engine (pure JavaScript, no I/O).
// Shared pieces: indicators, Signal lifecycle, Shadow Entry and News Straddle strategies.
// (Scalping / ICT / Price Action live in strategies.js and produce the same "setup" object.)

export const TF_SECONDS = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 };

export const DEFAULTS = {
  min_wick: 0.5, body_mult: 2.0, close_zone: 0.6, min_range_atr: 0.8,
  sl_atr: 0.25, retrace: 0.5, tp: [1.0, 2.0, 3.0], min_conf: 60, level_atr: 0.6,
  pending_candles: 12, breakeven_after_tp1: true,
  news_lead_min: 30, news_stop_atr: 0.8, news_sl_atr: 1.2, news_expiry_min: 5, blackout_min: 5,
  scalp_tp: [1.0, 1.5, 2.0], scalp_expiry: 3, ict_tp: [1.5, 2.5, 4.0], ict_expiry: 12, ict_disp_atr: 0.9,
  pa_tp: [1.0, 2.0, 3.0], pa_expiry: 8,
};
export const params = (over = {}) => ({ ...DEFAULTS, ...over });

// Python-style rounding (half to even) so results match the validated reference exactly.
export function pyRound(x) {
  const f = Math.floor(x), d = x - f;
  return d < 0.5 ? f : d > 0.5 ? f + 1 : (f % 2 === 0 ? f : f + 1);
}

// ---------------------------------------------------------------- indicators
export function ema(vals, n) {
  const k = 2 / (n + 1);
  let e = vals[0];
  return vals.map(v => (e = v * k + e * (1 - k)));
}
export function atr(c, n = 14) {
  let s = 0;
  for (let i = c.length - n; i < c.length; i++) {
    const k = c[i], p = c[i - 1];
    s += Math.max(k.h - k.l, Math.abs(k.h - p.c), Math.abs(k.l - p.c));
  }
  return s / n;
}
export function rsi(c, n = 14) {
  let g = 0, l = 0;
  for (let i = c.length - n; i < c.length; i++) {
    const d = c[i].c - c[i - 1].c;
    if (d > 0) g += d; else l -= d;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
export function swingLevels(c, side = 3, keep = 8) {
  const out = [];
  for (let i = side; i < c.length - side; i++) {
    const h = c[i].h, l = c[i].l, win = c.slice(i - side, i + side + 1);
    if (win.every(x => x.h <= h)) out.push({ price: h, type: 'R' });
    if (win.every(x => x.l >= l)) out.push({ price: l, type: 'S' });
  }
  return out.slice(-keep);
}
export function analyze(closed) {
  const cl = closed.map(k => k.c);
  const e20 = ema(cl, 20).at(-1), e50 = ema(cl, 50).at(-1);
  return { candle_time: closed.at(-1).t, close: closed.at(-1).c, atr: atr(closed), rsi: rsi(closed),
    ema20: e20, ema50: e50, bias: e20 > e50 ? 'UP' : 'DOWN', levels: swingLevels(closed.slice(-150)) };
}

// ------------------------------------------------------------------- signals
const tps = (entry, d, r, mults) => mults.map(m => entry + d * r * m);

export function detectShadow(closed, P, blackout = false) {
  if (closed.length < 60) return null;
  const L = closed.at(-1);
  const rg = L.h - L.l;
  const A = atr(closed);
  if (rg <= 0 || A <= 0 || rg < A * P.min_range_atr) return null;
  const body = Math.abs(L.c - L.o);
  const lo = Math.min(L.o, L.c) - L.l;
  const up = L.h - Math.max(L.o, L.c);
  let d, sh, ext;
  if (lo >= rg * P.min_wick && lo >= body * P.body_mult && (L.c - L.l) / rg >= P.close_zone) { d = 1; sh = lo; ext = L.l; }
  else if (up >= rg * P.min_wick && up >= body * P.body_mult && (L.h - L.c) / rg >= P.close_zone) { d = -1; sh = up; ext = L.h; }
  else return null;
  const an = analyze(closed);
  const nearLv = an.levels.some(x => Math.abs(x.price - ext) < A * P.level_atr && x.type === (d > 0 ? 'S' : 'R'));
  const nearEma = Math.abs(an.ema50 - ext) < A * P.level_atr;
  const trend = d > 0 ? an.ema20 > an.ema50 : an.ema20 < an.ema50;
  const rsiOk = d > 0 ? an.rsi < 45 : an.rsi > 55;
  let conf = 40 + Math.min(20, (sh / rg - 0.5) * 80) + (nearLv ? 15 : 0) + (nearEma ? 5 : 0) + (trend ? 12 : 0) + (rsiOk ? 8 : 0);
  const side = d > 0 ? 'buyers' : 'sellers';
  const why = [`${d > 0 ? 'Lower' : 'Upper'} shadow is ${(sh / rg * 100).toFixed(0)}% of the candle range - ${side} rejected the move and closed back near the ${d > 0 ? 'high' : 'low'}`];
  if (nearLv) why.push('The rejection happened right at ' + (d > 0 ? 'support' : 'resistance') + ' (a recent swing ' + (d > 0 ? 'low' : 'high') + ')');
  if (nearEma) why.push('EMA50 sits at the rejection point - extra confluence');
  why.push(trend ? (d > 0 ? 'EMA20 above EMA50: trend favours buying' : 'EMA20 below EMA50: trend favours selling')
                 : 'Trend (EMA20/50) is against the trade - lower confidence');
  if (rsiOk) why.push(`RSI ${an.rsi.toFixed(0)} supports a ` + (d > 0 ? 'bounce' : 'pullback lower'));
  if (blackout) { conf -= 10; why.push('A high-impact news release is within the blackout window (-10 confidence)'); }
  conf = Math.min(99, pyRound(conf));
  if (conf < P.min_conf) return null;
  return { strategy: 'SHADOW_ENTRY', code: 'SE', title: (d > 0 ? 'Bullish' : 'Bearish') + ' shadow rejection',
    dir: d, level: ext + d * sh * P.retrace, sl: ext - d * A * P.sl_atr, mults: P.tp,
    conf, reasons: why, t: L.t, ext, atr: A, tol: A * 0.1, zone: [], expiry: P.pending_candles, sh, rg,
    sl_why: `SL sits just beyond the shadow extreme (+${P.sl_atr} ATR): if price trades there the rejection has failed` };
}

export function buildSignal(meta, tf, setup, bid, ask, P, now, digits) {
  const d = setup.dir, A = setup.atr, buy = d > 0;
  const f = v => v.toFixed(digits);
  const { level, tol, sl } = setup;
  const px = buy ? ask : bid;
  const market = buy ? px <= level + tol : px >= level - tol;
  const entry = market ? px : level;
  const r = Math.abs(entry - sl);
  if (r <= 0 || (buy && entry <= sl) || (!buy && entry >= sl)) return null;
  const m = setup.mults, tp = tps(entry, d, r, m), verb = buy ? 'BUY' : 'SELL';
  const why = [...setup.reasons];
  if (market) why.push(`MARKET ${verb}: price (${f(px)}) is already inside the entry zone, so the trade is opened now`);
  else why.push(`PENDING ${verb} LIMIT at ${f(level)}: price (${f(px)}) is still ${f(Math.abs(px - level))} ${buy ? 'above' : 'below'} the entry zone, so the order waits for a pullback instead of chasing`);
  why.push(setup.sl_why);
  why.push(`TP1 / TP2 / TP3 sit at ${m[0]}R / ${m[1]}R / ${m[2]}R from entry (risk = ${f(r)})`);
  return {
    id: `${meta.name}-${setup.code}-${setup.t}-${buy ? 'B' : 'S'}`, symbol: meta.name, category: meta.category,
    strategy: setup.strategy, direction: verb, order_type: market ? 'MARKET' : `${verb}_LIMIT`, entry, sl,
    tp1: tp[0], tp2: tp[1], tp3: tp[2], confidence: setup.conf, state: market ? 'ACTIVE' : 'PENDING',
    timeframe: tf, digits, created: now, expires: market ? 0 : now + setup.expiry * TF_SECONDS[tf],
    activated: market ? now : 0, hits: 0, sl_initial: sl, atr: A, candle_t: setup.t, ext: setup.ext, oco: '',
    reasons: why, news: {}, title: setup.title, zone: [...(setup.zone || [])],
    summary: `${setup.title} - ${verb} ${market ? 'at market' : 'limit order (pending)'}`,
  };
}

export function buildNewsStraddle(meta, tf, event, A, bid, ask, P, now, digits) {
  const out = [], r = A * P.news_sl_atr, mins = Math.max(1, pyRound((event.ts - now) / 60));
  const oco = `${meta.name}-NW-${Math.trunc(event.ts)}`;
  for (const d of [1, -1]) {
    const entry = d > 0 ? ask + A * P.news_stop_atr : bid - A * P.news_stop_atr;
    const sl = entry - d * r, tp = tps(entry, d, r, P.tp), verb = d > 0 ? 'BUY' : 'SELL';
    out.push({
      id: `${oco}-${d > 0 ? 'B' : 'S'}`, symbol: meta.name, category: meta.category, strategy: 'NEWS_STRADDLE',
      direction: verb, order_type: `${verb}_STOP`, entry, sl, tp1: tp[0], tp2: tp[1], tp3: tp[2],
      confidence: 66 + (mins < 10 ? 4 : 0), state: 'PENDING', timeframe: tf, digits, created: now,
      expires: event.ts + P.news_expiry_min * 60, activated: 0, hits: 0, sl_initial: sl, atr: A, candle_t: 0, ext: 0, oco,
      reasons: [`${event.title} (${event.ccy}) is a HIGH-impact release in ~${mins} min - price usually spikes`,
        `PENDING ${verb} STOP ${(A * P.news_stop_atr).toFixed(digits)} ${d > 0 ? 'above' : 'below'} the market: it only triggers if the spike goes this way`,
        'OCO straddle: the opposite stop is cancelled as soon as one side triggers',
        `SL is ${P.news_sl_atr} ATR from entry; TP1 / TP2 / TP3 at 1R / 2R / 3R`],
      news: { title: event.title, currency: event.ccy, time: event.ts }, title: `News straddle: ${event.title}`,
      zone: [], summary: `${verb} STOP (pending) ahead of ${event.title}`,
    });
  }
  return out;
}

// Move a signal through its lifecycle on a price update. Returns [[event, reason], ...].
export function advance(s, bid, ask, now, P) {
  const ev = [], buy = s.direction === 'BUY';
  const [pxIn, pxOut] = buy ? [ask, bid] : [bid, ask];
  if (s.state === 'PENDING') {
    let filled, invalid, missed;
    if (s.order_type === 'BUY_LIMIT' || s.order_type === 'SELL_LIMIT') {
      filled = buy ? pxIn <= s.entry : pxIn >= s.entry;
      invalid = buy ? pxOut <= s.sl : pxOut >= s.sl;
      missed = buy ? pxOut >= s.tp1 : pxOut <= s.tp1;
    } else {
      filled = buy ? pxIn >= s.entry : pxIn <= s.entry;
      invalid = missed = false;
    }
    if (invalid) { s.state = 'CANCELLED'; ev.push(['cancelled', 'invalidated: price broke the stop-loss before entry']); }
    else if (filled) { s.state = 'ACTIVE'; s.activated = now; ev.push(['activated', '']); }
    else if (missed) { s.state = 'CANCELLED'; ev.push(['cancelled', 'missed: price reached TP1 without filling']); }
    else if (now > s.expires) { s.state = 'EXPIRED'; ev.push(['expired', '']); }
    if (s.state !== 'ACTIVE') return ev;
  }
  if (s.state === 'ACTIVE') {
    if (buy ? pxOut <= s.sl : pxOut >= s.sl) {
      if (s.hits && Math.abs(s.sl - s.entry) < 1e-12) { s.state = 'CLOSED_BE'; ev.push(['breakeven', 'stopped at entry after TP1']); }
      else { s.state = 'SL_HIT'; ev.push(['sl', '']); }
      return ev;
    }
    while (s.hits < 3) {
      const tp = [s.tp1, s.tp2, s.tp3][s.hits];
      if (buy ? pxOut >= tp : pxOut <= tp) {
        s.hits += 1;
        ev.push([`tp${s.hits}`, '']);
        if (s.hits === 1 && P.breakeven_after_tp1) s.sl = s.entry;
        if (s.hits === 3) s.state = 'COMPLETED';
      } else break;
    }
  }
  return ev;
}

// Public (rounded) view of a signal, as shown in the UI.
export function publicSignal(s) {
  const r = s.digits, rd = v => Number(v.toFixed(r));
  const risk = Math.abs(s.entry - s.sl_initial) || 1;
  return { ...s, entry: rd(s.entry), sl: rd(s.sl), tp1: rd(s.tp1), tp2: rd(s.tp2), tp3: rd(s.tp3), sl_initial: rd(s.sl_initial),
    atr: rd(s.atr), ext: rd(s.ext), zone: s.zone.map(rd),
    risk_reward: [s.tp1, s.tp2, s.tp3].map(t => Number((Math.abs(t - s.entry) / risk).toFixed(2))) };
}

// ------------------------------------------------------------------- storage
export class Book {
  constructor(storage = null, key = 'acs_book') {
    this.storage = storage; this.key = key;
    this.signals = new Map(); this.flags = new Set(); this.settings = {};
    if (storage) {
      try {
        const d = JSON.parse(storage.getItem(key) || 'null');
        if (d) { for (const x of d.signals || []) this.signals.set(x.id, x); this.flags = new Set(d.flags || []); this.settings = d.settings || {}; }
      } catch (e) { /* ignore corrupt state */ }
    }
  }
  add(s) {
    this.signals.set(s.id, s);
    const done = [...this.signals].filter(([, v]) => v.state !== 'PENDING' && v.state !== 'ACTIVE').map(([k]) => k);
    for (const k of done.slice(0, Math.max(0, done.length - 200))) this.signals.delete(k);
  }
  live(symbol = null) {
    return [...this.signals.values()].filter(s => (s.state === 'PENDING' || s.state === 'ACTIVE') && (symbol === null || s.symbol === symbol));
  }
  save() {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.key, JSON.stringify({ signals: [...this.signals.values()], flags: [...this.flags].sort().slice(-500), settings: this.settings }));
    } catch (e) { /* storage full or blocked */ }
  }
}
