// Drives the real app.js with a minimal fake DOM: boots in demo mode, then taps through every screen.
import test from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------- tiny DOM shim
const els = new Map(), handlers = {}, intervals = [];
function el(id, extra = {}) {
  const e = { id, _html: '', dataset: {}, value: '', checked: false, hidden: false, scrollTop: 0, clientWidth: 360, clientHeight: 300, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, remove() {}, click() {}, ...extra,
    get innerHTML() { return this._html; },
    set innerHTML(h) { this._html = h; for (const m of String(h).matchAll(/id="([^"]+)"/g)) if (!els.has(m[1]) || m[1] !== id) { if (m[1] !== id) els.set(m[1], el(m[1])); } },
    get textContent() { return this._text || ''; }, set textContent(t) { this._text = t; },
    closest() { return null; } };
  e.getContext = () => canvasCtx;
  e.toBlob = cb => cb(null);
  els.set(id, e); return e;
}
const calls = { fillRect: 0, arc: 0, fillText: 0 };
const canvasCtx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { if (k in calls) calls[k]++; }), set: (t, k, v) => { t[k] = v; return true; } });
for (const id of ['view', 'tabbar', 'pill', 'toast', 'splash']) el(id);
globalThis.window = globalThis;
globalThis.ACS_FORCE_DEMO = true;
globalThis.devicePixelRatio = 2;
globalThis.scrollTo = () => {};
globalThis.addEventListener = (t, f) => { (handlers['w:' + t] ||= []).push(f); };
const mem = {};
globalThis.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
Object.defineProperty(globalThis, 'navigator', { value: { vibrate: () => true }, configurable: true });
globalThis.location = { protocol: 'http:', hostname: 'test' };
globalThis.document = {
  getElementById: id => els.get(id) || null, activeElement: null, visibilityState: 'visible',
  addEventListener: (t, f) => { (handlers['d:' + t] ||= []).push(f); },
  querySelectorAll: sel => {
    const html = (els.get('picker') || {}).innerHTML || '';
    return [...html.matchAll(/<input type="checkbox" data-code="([^"]+)" (checked)?/g)].filter(m => m[2]).map(m => ({ dataset: { code: m[1] } }));
  },
  createElement: () => el('_tmp' + Math.random(), { click() {} }),
};
globalThis.setInterval = f => { intervals.push(f); return intervals.length; };

const fire = (type, target) => (handlers['d:' + type] || []).forEach(h => h({ target }));
const tap = (act, data = {}) => { const t = { dataset: { act, ...data }, closest: s => (s === '[data-act]' ? t : null) }; fire('click', t); };
const change = (chg, props = {}) => { const t = { dataset: { chg }, ...props, closest: s => (s === '[data-chg]' ? t : null) }; fire('change', t); };
const ticks = n => { for (let i = 0; i < n; i++) intervals.forEach(f => f()); };
const until = async (f, ms = 8000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 10)); } };

await import(process.env.ACS_ENTRY ? new URL(process.env.ACS_ENTRY, import.meta.url) : '../js/app.js');
const A = globalThis.__acs;

test('boots in demo mode, shows the status pill and tab bar', async () => {
  await until(() => !A.ui.booting);
  ticks(3);
  assert.match(els.get('pill').textContent, /DEMO/);
  assert.match(els.get('tabbar').innerHTML, /Scan/); assert.match(els.get('tabbar').innerHTML, /Settings/);
  assert.equal(A.scanner.symbols.length, 13);
});

test('Scan screen: instruments, strategy chips, timeframe and confidence controls', () => {
  assert.match(els.get('scan-list').innerHTML, /XAUUSD/); assert.match(els.get('scan-list').innerHTML, /Volatility 75/);
  for (const s of ['All', 'Shadow Entry', 'Scalping', 'ICT', 'Price Action']) assert.match(els.get('scan-strat').innerHTML, new RegExp(s));
  assert.match(els.get('scan-cats').innerHTML, /Synthetics/);
  tap('cat', { v: 'Crypto' }); ticks(1);
  assert.ok(!/XAUUSD/.test(els.get('scan-list').innerHTML) && /BTCUSD/.test(els.get('scan-list').innerHTML));
  tap('cat', { v: 'All' });
});

test('choosing a strategy sets it and its recommended timeframe', async () => {
  tap('strat', { v: 'ICT' }); await until(() => A.scanner.settings.strategy === 'ICT');
  await until(() => A.scanner.settings.timeframe === 'M15'); ticks(2);
  assert.match(els.get('scan-desc').innerHTML, /Liquidity sweep/);
  change('mc', { value: '70' }); await until(() => A.scanner.settings.min_conf === 70);
  change('tf', { value: 'M5' }); await until(() => A.scanner.settings.timeframe === 'M5');
  tap('strat', { v: 'ALL' }); await until(() => A.scanner.settings.strategy === 'ALL');
  change('mc', { value: '50' }); await until(() => A.scanner.settings.min_conf === 50);
});

test('Chart screen draws candles/levels and ‹ › cycles through the pairs', () => {
  tap('pick', { sym: 'XAUUSD' }); ticks(2);
  assert.equal(A.ui.tab, 'chart'); assert.match(els.get('ch-title').innerHTML, /XAUUSD/);
  assert.ok(calls.fillRect > 100 && calls.fillText > 5, `chart should draw (fillRect ${calls.fillRect}, fillText ${calls.fillText})`);
  tap('next'); assert.equal(A.ui.sel, 'EURUSD'); tap('prev'); tap('prev'); assert.equal(A.ui.sel, 'CRASH1000'.length ? 'Crash 1000' : '');
  change('tour', { checked: true }); assert.equal(A.ui.tour, true); change('tour', { checked: false });
});

test('signals appear with full reasons; tabs and activity feed work', async () => {
  const feed = A.feed;
  for (let i = 0; i < 900 && A.scanner.book.signals.size < 6; i++) ticks(1);
  assert.ok(A.scanner.book.signals.size >= 3, 'signals should be generated');
  tap('goto', { tab: 'signals' }); ticks(1);
  assert.match(els.get('sg-tabs').innerHTML, /Pending/); assert.match(els.get('sg-tabs').innerHTML, /Activity/);
  let html = '';
  for (const t of ['Live', 'Pending', 'News', 'History']) { tap('sigtab', { v: t }); html += els.get('sg-list').innerHTML; }
  assert.match(html, /Why this/); assert.match(html, /Confidence \d+%/); assert.match(html, /Entry/); assert.match(html, /TP3/);
  assert.ok(!/<script/i.test(html), 'output is escaped');
  tap('sigtab', { v: 'Activity' }); assert.match(els.get('sg-list').innerHTML, /class="ev"/);
  assert.match(els.get('tabbar').innerHTML, /<em>\d+<\/em>/, 'live-signal badge on the tab bar');
  assert.match(els.get('toast').textContent, /\S/, 'alert toast shown');
});

test('News screen: add and remove a manual event', () => {
  tap('goto', { tab: 'news' }); ticks(1);
  assert.match(els.get('nw-status').innerHTML, /./);
  els.get('nw-title').value = 'US NFP'; els.get('nw-ccy').value = 'USD';
  els.get('nw-time').value = new Date(Date.now() + 3600e3).toISOString().slice(0, 16);
  tap('addNews'); ticks(1);
  assert.match(els.get('nw-list').innerHTML, /US NFP/); assert.match(els.get('nw-list').innerHTML, /yours/);
  const id = A.scanner.cal.manual.at(-1).id; tap('delNews', { id }); ticks(1);
  assert.ok(!/US NFP/.test(els.get('nw-list').innerHTML));
});

test('Settings screen: instrument picker, alert toggles, source switch', async () => {
  tap('goto', { tab: 'settings' }); ticks(1);
  const v = els.get('view').innerHTML;
  assert.match(v, /Market data/); assert.match(v, /Install on your phone/); assert.match(v, /data-code="frxXAUUSD"/);
  change('a-sound', { checked: false }); assert.equal(A.app.alerts.sound, false);
  change('a-vibrate', { checked: false }); assert.equal(A.app.alerts.vibrate, false);
  change('wake', { checked: true }); assert.equal(A.app.wake, true);
  change('appid', { value: '1089abc' }); assert.equal(A.app.appId, '1089');
  assert.ok(JSON.parse(mem.acs_app).alerts.sound === false, 'app settings persisted');
  const picked = v.match(/id="picker">([\s\S]*?)<\/div>\s*<div class="row"><button class="chip on" data-act="applyInstr"/)[1];
  const clean = picked.replace(/ checked/g, '');
  els.get('picker').innerHTML = clean.replace('data-code="frxEURUSD">', 'data-code="frxEURUSD" checked>').replace('data-code="frxXAUUSD">', 'data-code="frxXAUUSD" checked>');
  tap('applyInstr'); await until(() => !A.ui.booting && A.scanner.symbols.length === 2);
  assert.deepEqual(A.scanner.symbols.map(s => s.name).sort(), ['EURUSD', 'XAUUSD']);
  tap('goto', { tab: 'scan' }); ticks(2); assert.ok(!/BTCUSD/.test(els.get('scan-list').innerHTML));
});

test('a failed live connection shows a clear banner with Retry / Use demo', async () => {
  globalThis.WebSocket = class { constructor() { setTimeout(() => this.onerror && this.onerror({}), 1); } close() {} };
  A.app.source = 'deriv';
  tap('retry'); await until(() => !A.ui.booting);
  ticks(1);
  assert.match(A.ui.error, /Could not reach/);
  assert.match(els.get('banner').innerHTML, /Retry/); assert.match(els.get('banner').innerHTML, /Use demo data/);
  tap('useDemo'); await until(() => !A.ui.booting && !A.ui.error); ticks(2);
  assert.equal(A.app.source, 'demo'); assert.ok(A.scanner.symbols.length > 0);
});
