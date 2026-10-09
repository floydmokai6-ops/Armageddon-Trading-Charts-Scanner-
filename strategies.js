// Scalping, ICT and Price Action strategies.
// Every rule is written once for BUY setups; SELL setups are found by mirroring the candles
// (prices negated), so buy/sell logic can never drift apart. Each rule returns a "setup" object
// that engine.buildSignal() turns into a market or pending signal with a written explanation.
import { atr, ema, rsi, swingLevels, pyRound } from './engine.js';

export const HTF = { M1: 'M15', M5: 'H1', M15: 'H4', M30: 'H4', H1: 'H4', H4: 'D1' };
export const WORDS = {
  '1': { lo: 'low', hi: 'high', under: 'below', over: 'above', sup: 'support', bull: 'bullish', liq: 'sell-side', liq2: 'buy-side', cheap: 'discount', op: '>', buyers: 'buyers' },
  '-1': { lo: 'high', hi: 'low', under: 'above', over: 'below', sup: 'resistance', bull: 'bearish', liq: 'buy-side', liq2: 'sell-side', cheap: 'premium', op: '<', buyers: 'sellers' },
};
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

export const mirror = K => K.map(k => ({ t: k.t, o: -k.o, h: -k.l, l: -k.h, c: -k.c }));

export function swings(K, side = 3) {
  const out = [];
  for (let i = side; i < K.length - side; i++) {
    const h = K[i].h, l = K[i].l, win = K.slice(i - side, i + side + 1);
    if (win.every(x => x.h <= h)) out.push({ idx: i, type: 'H', price: h });
    if (win.every(x => x.l >= l)) out.push({ idx: i, type: 'L', price: l });
  }
  return out;
}

export function htfUp(H) {
  if (!H || H.length < 30) return null;
  const cl = H.map(k => k.c);
  return ema(cl, 20).at(-1) > ema(cl, 50).at(-1);
}

const mk = (strategy, code, title, level, sl, mults, conf, reasons, sl_why, t, ext, A, tol, expiry, zone = []) =>
  ({ strategy, code, title, level, sl, mults, conf: Math.min(99, pyRound(conf)), reasons, sl_why, t, ext, atr: A, tol, expiry, zone: [...zone] });

function htfAdj(conf, reasons, hb, c) {
  if (hb === true) { reasons.push(`Higher-timeframe trend is ${c.w.bull} - it agrees with this trade`); return conf + 8; }
  if (hb === false) { reasons.push('Higher-timeframe trend is against this trade - confidence reduced'); return conf - 8; }
  return conf;
}

// ------------------------------------------------------------------ SCALPING
function scalp(K, H, P, c) {
  const n = K.length;
  if (n < 60) return null;
  const A = atr(K), cl = K.map(k => k.c);
  const e9 = ema(cl, 9).at(-1), e21 = ema(cl, 21).at(-1), e50 = ema(cl, 50).at(-1);
  if (!(e9 > e21 && e21 > e50)) return null;
  const L = K[n - 1], Pv = K[n - 2];
  const rg = L.h - L.l, body = L.c - L.o;
  if (rg <= 0 || body <= 0 || body < 0.5 * rg || rg < 0.5 * A || L.c <= Pv.h) return null;
  const low = Math.min(...K.slice(-4).map(k => k.l));
  if (low > e21 + 0.3 * A) return null;
  const r7 = rsi(K, 7);
  if (!(r7 >= 45 && r7 <= 78)) return null;
  const sl = low - 0.15 * A;
  if (!(L.c - sl > 0 && L.c - sl <= 2.2 * A)) return null;
  const { w, fmt: f, sgn: sg } = c;
  let conf = 50 + 12 + (low <= e21 ? 8 : 4) + Math.min(10, (body / rg - 0.5) * 20) + (r7 >= 50 && r7 <= 70 ? 8 : 3);
  const why = [`Fast trend stack: EMA9 ${w.op} EMA21 ${w.op} EMA50 (${w.bull} momentum)`,
    `Pullback: price dipped to the EMA21 (${f(e21)}) within the last 3 candles and held`,
    `Trigger: a ${w.bull} candle with a ${(body / rg * 100).toFixed(0)}% body closed ${w.over} the previous candle's ${w.hi}`,
    `RSI(7) is ${(sg > 0 ? r7 : 100 - r7).toFixed(0)} - room to run, not exhausted`];
  if (swingLevels(K.slice(-150)).some(x => x.type === 'S' && Math.abs(x.price - low) <= 0.7 * A)) {
    conf += 7; why.push(`The pullback also held a swing ${w.sup}`);
  }
  conf = htfAdj(conf, why, htfUp(H), c);
  return mk('SCALPING', 'SC', `${cap(w.bull)} EMA-pullback scalp`, L.c, sl, P.scalp_tp, conf, why,
    `Tight SL ${f(sl)} just beyond the pullback ${w.lo}: if it breaks, the micro-trend has failed`, L.t, low, A, 0.25 * A, P.scalp_expiry);
}

// ----------------------------------------------------------------------- ICT
function ict(K, H, P, c) {
  const n = K.length;
  if (n < 60) return null;
  const A = atr(K);
  if (A <= 0) return null;
  const sw = swings(K, 3), lows = sw.filter(s => s.type === 'L');
  let found = null;
  for (let j = n - 3; j > Math.max(n - 18, 12); j--) {
    const prior = lows.filter(s => s.idx >= j - 40 && s.idx <= j - 2);
    if (!prior.length) continue;
    const pl = prior.at(-1), cj = K[j];
    if (!(cj.l < pl.price - 0.03 * A && cj.c > pl.price)) continue;
    const sweepLow = Math.min(...K.slice(j, j + 3).map(k => k.l));
    const bl = Math.max(...K.slice(pl.idx, j + 1).map(k => k.h));
    let m = null;
    for (let i = j + 1; i < n; i++) if (K[i].c > bl && K[i].c - K[i].o >= P.ict_disp_atr * A) { m = i; break; }
    if (m === null || m < n - 8) continue;
    let broken = false;
    for (let i = j + 1; i < n; i++) if (K[i].c < sweepLow) { broken = true; break; }
    if (broken) continue;
    found = { j, pl, sweepLow, bl, m };
    break;
  }
  if (!found) return null;
  const { j, pl, sweepLow, bl, m } = found;
  const legHi = Math.max(...K.slice(m).map(k => k.h));
  const rng = legHi - sweepLow;
  if (rng < 1.5 * A) return null;
  const zLo = legHi - 0.79 * rng, zHi = legHi - 0.62 * rng, ote = legHi - 0.705 * rng;
  const gaps = [];
  for (let i = j + 1; i < n - 1; i++) if (K[i - 1].h < K[i + 1].l) gaps.push([K[i - 1].h, K[i + 1].l]);
  const ov = gaps.filter(g => g[1] >= zLo && g[0] <= zHi);
  let level, zone, lo, hi;
  if (ov.length) {
    lo = Math.max(ov.at(-1)[0], zLo); hi = Math.min(ov.at(-1)[1], zHi);
    level = (lo + hi) / 2; zone = [lo, hi];
  } else { level = ote; zone = [zLo, zHi]; }
  const sl = sweepLow - 0.15 * A;
  if (!(level - sl >= 0.3 * A && level - sl <= 5 * A) || K[n - 1].c <= sl) return null;
  const { w, fmt: f, sgn: sg } = c;
  let conf = 38 + 15 + 10;
  const why = [`Liquidity grab: price pushed ${w.under} the swing ${w.lo} at ${f(pl.price)} (${w.liq} liquidity) and closed back ${w.over} it - a stop hunt`,
    `Market structure shift: a ${w.bull} displacement candle (${((K[m].c - K[m].o) / A).toFixed(1)} ATR body) closed ${w.over} ${f(bl)}`];
  if (ov.length) {
    conf += 12;
    const [a, b] = sg > 0 ? [lo, hi] : [hi, lo];
    why.push(`Fair value gap ${f(a)} - ${f(b)} overlaps the 62-79% OTE zone; entry at its midpoint ${f(level)}`);
  } else why.push(`No FVG overlap, so entry is the 70.5% OTE retracement of the displacement leg (${f(ote)})`);
  const eq = (Math.max(...K.slice(-60).map(k => k.h)) + Math.min(...K.slice(-60).map(k => k.l))) / 2;
  if (level < eq) { conf += 8; why.push(`Entry is in ${w.cheap} (beyond 50% of the dealing range at ${f(eq)}): buy low / sell high`); }
  if (c.kz) { conf += 6; why.push(`Inside the ${c.kz} killzone - institutional volume window`); }
  conf = htfAdj(conf, why, htfUp(H), c);
  const tgts = sw.filter(s => s.type === 'H' && s.price > level).map(s => s.price);
  let slWhy = `SL ${f(sl)} is beyond the sweep ${w.lo}: if price trades there the liquidity-grab idea is invalid`;
  if (tgts.length) slWhy += `; ${w.liq2} liquidity (target) rests near ${f(Math.min(...tgts))}`;
  return mk('ICT', 'ICT', `${cap(w.bull)} ICT: sweep + MSS + ` + (ov.length ? 'FVG/OTE' : 'OTE'), level, sl, P.ict_tp, conf, why, slWhy,
    K[m].t, K[m].l, A, 0.15 * A, P.ict_expiry, zone);
}

// ------------------------------------------------------------- PRICE ACTION
function pa(K, H, P, c) {
  const n = K.length;
  if (n < 60) return null;
  const A = atr(K), cl = K.map(k => k.c);
  const e20 = ema(cl, 20).at(-1), e50 = ema(cl, 50).at(-1);
  const lv = swingLevels(K.slice(-150)), r14 = rsi(K), hb = htfUp(H);
  const trend = e20 > e50;
  const { w, fmt: f, sgn: sg } = c;
  const L = K[n - 1], Pv = K[n - 2];
  const out = [];

  const finish = (conf, why, needTrend) => {
    if (needTrend && !trend) return null;
    if (trend) { conf += 12; why.push(`Trend agrees: EMA20 ${w.op} EMA50`); }
    else why.push('Trade is counter-trend (EMA20/50) - confidence kept lower');
    if (r14 < 50) { conf += 4; why.push(`RSI ${(sg > 0 ? r14 : 100 - r14).toFixed(0)} leaves room for the move`); }
    return htfAdj(conf, why, hb, c);
  };

  // (a) engulfing at support
  if (Pv.c < Pv.o && L.c > L.o && L.c > Pv.o && L.o <= Pv.c) {
    const bL = L.c - L.o, bP = Pv.o - Pv.c, lowx = Math.min(L.l, Pv.l);
    const sup = lv.find(x => x.type === 'S' && Math.abs(x.price - lowx) <= 0.7 * A);
    if (bL >= bP && bL >= 0.5 * A && (sup || Math.abs(e50 - lowx) <= 0.7 * A)) {
      const level = L.o + 0.5 * bL, sl = lowx - 0.2 * A;
      if (level - sl > 0 && level - sl <= 3 * A) {
        const why = [`${cap(w.bull)} engulfing: the last candle's body (${(bL / A).toFixed(1)} ATR) fully covers the previous one - ${w.buyers} took control`,
          sup ? `It formed on a swing ${w.sup} at ${f(sup.price)}` : 'It formed on the EMA50 dynamic support'];
        const conf = finish(50 + (sup ? 15 : 7) + Math.min(8, (bL / A - 0.5) * 8), why, false);
        if (conf !== null) out.push(mk('PRICE_ACTION', 'PA', `${cap(w.bull)} engulfing at ${w.sup}`, level, sl, P.pa_tp, conf, why,
          `SL ${f(sl)} is beyond the engulfing pattern's ${w.lo}: if it breaks, the pattern failed`, L.t, lowx, A, 0.15 * A, P.pa_expiry));
      }
    }
  }
  // (b) break & retest of a swing high (old resistance -> new support)
  const highs = swings(K, 3).filter(s => s.type === 'H' && s.idx >= n - 45 && s.idx <= n - 8).reverse();
  for (const pv of highs) {
    const R0 = pv.price;
    let k = null;
    for (let i = pv.idx + 1; i < n - 2; i++) if (K[i].c > R0 + 0.1 * A) { k = i; break; }
    if (k === null || K.slice(k + 1).some(x => x.c < R0 - 0.3 * A)) continue;
    if (!(L.l >= R0 - 0.5 * A && L.l <= R0 + 0.25 * A && L.c > R0 && L.c > L.o)) continue;
    const sl = Math.min(L.l, R0 - 0.3 * A) - 0.15 * A;
    if (!(L.c - sl > 0 && L.c - sl <= 2.5 * A)) continue;
    const why = [`Break: price closed ${w.over} the old resistance at ${f(R0)} (swing ${w.hi}), turning it into ${w.sup}`,
      `Retest: price came back to ${f(R0)} and a ${w.bull} candle rejected it, confirming the flip`];
    const conf = finish(55 + (Math.abs(L.l - R0) <= 0.1 * A ? 8 : 3) + 8, why, true);
    if (conf !== null) out.push(mk('PRICE_ACTION', 'PA', `${cap(w.bull)} break & retest`, L.c, sl, P.pa_tp, conf, why,
      `SL ${f(sl)} is ${w.under} the retested level: closing back through it means the break failed`, K[k].t, L.l, A, 0.4 * A, P.pa_expiry,
      [R0 - 0.1 * A, R0 + 0.1 * A]));
    break;
  }
  // (c) inside-bar breakout in trend direction
  const M = K[n - 3], I = K[n - 2];
  if (I.h <= M.h && I.l >= M.l && L.c > M.h && L.c - L.o >= 0.5 * (L.h - L.l) && M.h - M.l >= 0.8 * A) {
    const sl = M.l - 0.1 * A;
    if (L.c - sl > 0 && L.c - sl <= 2.5 * A) {
      const why = [sg > 0 ? `Inside bar: the previous candle stayed inside the mother bar (${f(M.l)}-${f(M.h)}) - compression`
                          : `Inside bar: the previous candle stayed inside the mother bar (${f(M.h)}-${f(M.l)}) - compression`,
        `Breakout: the last candle closed ${w.over} the mother bar's ${w.hi} with a strong body`];
      const conf = finish(52 + 8, why, true);
      if (conf !== null) out.push(mk('PRICE_ACTION', 'PA', `${cap(w.bull)} inside-bar breakout`, L.c, sl, P.pa_tp, conf, why,
        `SL ${f(sl)} is beyond the mother bar's ${w.lo}: the whole compression pattern is invalidated there`, L.t, M.l, A, 0.4 * A, P.pa_expiry));
    }
  }
  let best = null;
  for (const s of out) if (best === null || s.conf > best.conf) best = s;
  return best;
}

export const STRATEGIES = { SCALPING: scalp, ICT: ict, PRICE_ACTION: pa };

// Every BUY / SELL setup a strategy finds on closed candles K (H = higher-timeframe candles or null).
export function detectAll(name, K, H, P, ctx) {
  const fn = STRATEGIES[name], found = [];
  for (const d of [1, -1]) {
    const c = { ...ctx, sgn: d, w: WORDS[String(d)], fmt: v => (d * v).toFixed(ctx.digits) };
    const s = fn(d > 0 ? K : mirror(K), H ? (d > 0 ? H : mirror(H)) : null, P, c);
    if (!s || s.conf < P.min_conf) continue;
    s.dir = d;
    if (d < 0) { s.level = -s.level; s.sl = -s.sl; s.ext = -s.ext; s.zone = [...s.zone].reverse().map(z => -z); }
    found.push(s);
  }
  return found;
}

// Highest-confidence setup (BUY or SELL), or null.
export function detect(name, K, H, P, ctx) {
  let best = null;
  for (const s of detectAll(name, K, H, P, ctx)) if (best === null || s.conf > best.conf) best = s;
  return best;
}
