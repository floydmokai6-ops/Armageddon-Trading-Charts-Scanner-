// Canvas chart: candles, EMA20/50, support/resistance, signal zone + entry/SL/TP1-3 lines.
const C = { bg: '#0a0605', grid: '#2a130c', mut: '#a98f7c', up: '#3be08f', dn: '#ff4d5e', ember: '#ff6a1a', gold: '#f5b942' };

export function drawChart(canvas, CD, opts = {}) {
  const dpr = opts.dpr || (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1);
  const W = opts.width || canvas.clientWidth, H = opts.height || canvas.clientHeight;
  if (!CD || !W || !H) return false;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const x = canvas.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.fillStyle = C.bg; x.fillRect(0, 0, W, H);
  const K = CD.candles, N = K.length, pw = W < 480 ? 74 : 88, cw = (W - pw) / N, d = CD.digits, f = v => v.toFixed(d);
  let hi = Math.max(...K.map(k => k.h)), lo = Math.min(...K.map(k => k.l));
  CD.signals.forEach(g => [g.entry, g.sl, g.tp3].forEach(v => { hi = Math.max(hi, v); lo = Math.min(lo, v); }));
  const pad = (hi - lo) * 0.06; hi += pad; lo -= pad;
  const Y = v => H - (v - lo) / (hi - lo) * H;
  x.font = '10px system-ui, sans-serif'; x.textBaseline = 'middle';
  for (let i = 0; i <= 5; i++) {
    const v = lo + (hi - lo) * i / 5, y = Y(v);
    x.strokeStyle = C.grid; x.beginPath(); x.moveTo(0, y); x.lineTo(W - pw, y); x.stroke();
    x.fillStyle = C.mut; x.fillText(f(v), W - pw + 5, y);
  }
  CD.levels.forEach(l => {
    if (l.price < lo || l.price > hi) return;
    x.setLineDash([2, 4]); x.strokeStyle = C.mut; x.beginPath(); x.moveTo(0, Y(l.price)); x.lineTo(W - pw, Y(l.price)); x.stroke(); x.setLineDash([]);
    x.fillStyle = C.mut; x.fillText(l.type, 4, Y(l.price) - 7);
  });
  CD.signals.forEach(g => {
    if (g.zone && g.zone.length === 2) { x.fillStyle = 'rgba(245,185,66,.16)'; x.fillRect(0, Y(g.zone[1]), W - pw, Math.max(2, Y(g.zone[0]) - Y(g.zone[1]))); }
  });
  K.forEach((k, i) => {
    const cx = i * cw + cw / 2, up = k.c >= k.o;
    x.strokeStyle = x.fillStyle = up ? C.up : C.dn;
    x.beginPath(); x.moveTo(cx, Y(k.h)); x.lineTo(cx, Y(k.l)); x.stroke();
    x.fillRect(cx - cw * 0.35, Math.min(Y(k.o), Y(k.c)), cw * 0.7, Math.max(1, Math.abs(Y(k.o) - Y(k.c))));
  });
  [[CD.ema20, C.ember], [CD.ema50, C.gold]].forEach(([e, col]) => {
    x.strokeStyle = col; x.lineWidth = 1.3; x.beginPath();
    e.forEach((v, i) => (i ? x.lineTo(i * cw + cw / 2, Y(v)) : x.moveTo(cw / 2, Y(v)))); x.stroke(); x.lineWidth = 1;
  });
  CD.signals.forEach(g => {
    const buy = g.direction === 'BUY', col = buy ? C.up : C.dn, i = K.findIndex(k => k.t === g.candle_t);
    if (g.candle_t && i >= 0) { x.strokeStyle = C.gold; x.lineWidth = 1.5; x.beginPath(); x.arc(i * cw + cw / 2, Y(g.ext) + (buy ? 9 : -9), 6, 0, 7); x.stroke(); x.lineWidth = 1; }
    [['ENTRY', g.entry, col, 0], ['SL', g.sl, C.dn, 1], ['TP1', g.tp1, C.up, 1], ['TP2', g.tp2, C.up, 1], ['TP3', g.tp3, C.up, 1]].forEach(([n, v, c, dash]) => {
      const y = Y(v);
      x.setLineDash(dash ? [6, 4] : []); x.strokeStyle = c; x.lineWidth = dash ? 1 : 1.6;
      x.beginPath(); x.moveTo(0, y); x.lineTo(W - pw, y); x.stroke(); x.setLineDash([]); x.lineWidth = 1;
      x.fillStyle = c; x.fillRect(W - pw, y - 8, pw, 16); x.fillStyle = '#04120b'; x.fillText(`${n} ${f(v)}`, W - pw + 3, y);
    });
  });
  return true;
}
