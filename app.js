// Armageddon Chart Scanner 2.0 - phone app (PWA). Everything runs on the device; no server, no PC.
import { Book } from './engine.js';
import { Calendar } from './news.js';
import { DerivFeed, MockFeed, DEFAULT_INSTRUMENTS } from './feed.js';
import { Scanner, STRATEGY_INFO } from './scanner.js';
import { drawChart } from './chart.js';
import * as V from './views.js';

const $ = id => document.getElementById(id);
const store = {
  getItem: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode / full */ } },
  removeItem: k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};
const DEF = { source: globalThis.ACS_FORCE_DEMO ? 'demo' : 'deriv', appId: 1089, instruments: DEFAULT_INSTRUMENTS.map(i => i.code), extra: {},
  alerts: { sound: true, vibrate: true, notify: false }, wake: false };
let app = { ...DEF, ...(() => { try { return JSON.parse(store.getItem('acs_app') || '{}'); } catch (e) { return {}; } })() };
app.alerts = { ...DEF.alerts, ...app.alerts };
const saveApp = () => store.setItem('acs_app', JSON.stringify(app));

const ui = { tab: 'scan', sel: null, cat: 'All', sigTab: 'Live', tour: false, error: '', booting: true, lastHTML: {} };
const book = new Book(store), calendar = new Calendar({ storage: store });
let feed = null, scanner = null, deferredInstall = null, wakeLock = null, audio = null, tourN = 0;

// ------------------------------------------------------------------ helpers
const setHTML = (id, html) => { const el = $(id); if (el && ui.lastHTML[id] !== html) { ui.lastHTML[id] = html; el.innerHTML = html; } };
const now = () => Date.now() / 1000;
const metasFromCfg = () => app.instruments.map(code => DEFAULT_INSTRUMENTS.find(i => i.code === code) || app.extra[code]).filter(Boolean).map(m => ({ ...m }));

function feedStatus() {
  const s = feed ? feed.status() : { state: 'connecting', ready: 0, total: 0 };
  return { ...s, demo: app.source === 'demo' };
}

function toast(msg) {
  const t = $('toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 4500);
}
function beep() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const o = audio.createOscillator(), g = audio.createGain();
    o.connect(g); g.connect(audio.destination); o.frequency.value = 880; g.gain.value = 0.15; o.start(); o.stop(audio.currentTime + 0.18);
  } catch (e) { /* audio blocked */ }
}
async function systemNotify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg) reg.showNotification(title, { body, icon: 'assets/icon-192.png', badge: 'assets/favicon.png', tag: 'acs' });
    else new Notification(title, { body, icon: 'assets/icon-192.png' });
  } catch (e) { /* ignore */ }
}
function onEvent(e, sig) {
  const big = e.event === 'new';
  if (!['new', 'activated', 'tp1', 'tp2', 'tp3', 'sl', 'breakeven'].includes(e.event)) return;
  toast((big ? '🔥 ' : '') + e.text);
  if (app.alerts.vibrate && navigator.vibrate) navigator.vibrate(big ? [120, 60, 120] : 80);
  if (big && app.alerts.sound) beep();
  if (big && app.alerts.notify) systemNotify(`Armageddon: ${sig.symbol} ${sig.direction}`, `${sig.title} - conf ${sig.confidence}% (${sig.order_type.replace('_', ' ')})`);
}

async function keepAwake() {
  try {
    if (app.wake && 'wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!app.wake && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { /* not allowed */ }
}

// --------------------------------------------------------------------- boot
async function boot() {
  ui.booting = true; ui.error = ''; render();
  if (feed) feed.stop();
  feed = app.source === 'demo' ? new MockFeed() : new DerivFeed({ appId: +app.appId || 1089 });
  if (feed.onStatus) feed.onStatus(() => renderHeader());
  if (!scanner) scanner = new Scanner({ feed, book, calendar, onEvent });
  scanner.feed = feed;
  try { scanner.setSymbols(await feed.start(metasFromCfg(), scanner.settings.timeframe)); }
  catch (e) { ui.error = e.message || String(e); scanner.setSymbols([]); }
  if (feed.skipped && feed.skipped.length) toast(`Not available on this market feed: ${feed.skipped.map(m => m.name).join(', ')}`);
  ui.booting = false;
  if (!ui.sel && scanner.symbols.length) ui.sel = scanner.symbols[0].name;
  const sp = $('splash'); if (sp) { sp.classList.add('hide'); setTimeout(() => sp.remove(), 600); }
  calendar.refresh().then(() => render()).catch(() => {});
  keepAwake(); loop();
}

function loop() {
  if (!scanner) return;
  if (scanner.symbols.length) scanner.cycle();
  if (ui.tour && ui.tab === 'chart' && scanner.symbols.length && ++tourN % 7 === 0) step(1);
  render();
}

// ------------------------------------------------------------------- render
const TABS = [['scan', '🔥', 'Scan'], ['chart', '📈', 'Chart'], ['signals', '🎯', 'Signals'], ['news', '📰', 'News'], ['settings', '⚙️', 'Settings']];

function renderHeader() {
  const s = feedStatus(), pill = $('pill');
  if (!pill) return;
  pill.textContent = V.pillText(s); pill.className = 'pill ' + (s.state === 'live' ? (s.demo ? 'demo' : 'ok') : s.state === 'error' ? 'bad' : 'wait');
  const n = scanner ? scanner.book.live().length : 0;
  setHTML('tabbar', TABS.map(([k, ic, nm]) => `<button class="${ui.tab === k ? 'on' : ''}" data-act="goto" data-tab="${k}"><span class="ic">${ic}</span><span>${nm}</span>${k === 'signals' && n ? `<em>${n}</em>` : ''}</button>`).join(''));
}

function banner() {
  const s = feedStatus();
  if (ui.error) return `<div class="banner bad">⚠ ${V.esc(ui.error)}<div class="row"><button class="chip sm on" data-act="retry">Retry</button><button class="chip sm" data-act="useDemo">Use demo data</button></div></div>`;
  if (s.state === 'reconnecting') return `<div class="banner wait">⟳ ${V.esc(s.msg || 'Reconnecting...')}</div>`;
  if (s.demo) return '<div class="banner demo">Demo mode - simulated prices. Switch to Live data in Settings.</div>';
  return '';
}

const MOUNT = {
  scan: () => `<div id="banner"></div><section class="card"><div id="scan-strat" class="chips scroll"></div><p id="scan-desc" class="mu"></p>
<div class="row"><label>Timeframe <select id="tf" data-chg="tf"></select></label><label>Min confidence <select id="mc" data-chg="mc"></select></label></div></section>
<div id="scan-cats" class="chips scroll"></div><div id="scan-list"></div>`,
  chart: () => `<div id="banner"></div><section class="card chartcard"><div class="chhead"><button class="nav" data-act="prev" aria-label="Previous">‹</button><div id="ch-title"></div><button class="nav" data-act="next" aria-label="Next">›</button></div>
<canvas id="cv"></canvas><div class="legend"><span style="color:#ff6a1a">━</span> EMA20 <span style="color:#f5b942">━</span> EMA50 · S/R dotted · ◯ signal candle · ▒ FVG/OTE zone</div>
<div class="row"><label class="sw"><input type="checkbox" id="tour" data-chg="tour" ${ui.tour ? 'checked' : ''}> Auto-tour all pairs</label><button class="chip sm" data-act="png">⬇ Save chart PNG</button></div></section><div id="ch-sigs"></div>`,
  signals: () => `<div id="banner"></div><div id="sg-tabs" class="chips scroll"></div><div id="sg-list"></div>`,
  news: () => `<div id="banner"></div><section class="card"><h3>High-impact news</h3><label class="sw"><input type="checkbox" id="nws" data-chg="news"> Create news-straddle signals (OCO stop orders 30 min before release)</label>
<p class="mu" id="nw-status"></p><div id="nw-list"></div></section>
<section class="card"><h3>Add an event</h3><p class="mu">The free calendar can be blocked by your browser or carrier. Add a release yourself and the scanner will treat it like any other.</p>
<div class="form"><input id="nw-title" placeholder="Event name (e.g. US CPI)"><select id="nw-ccy">${['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'].map(c => `<option>${c}</option>`).join('')}</select><input id="nw-time" type="datetime-local"><button class="chip on" data-act="addNews">Add event</button></div></section>`,
  settings: () => settingsHTML(),
};

function groupsForPicker() {
  const list = feed && feed.active && feed.active.length ? feed.active : [...DEFAULT_INSTRUMENTS, ...Object.values(app.extra)];
  const groups = {};
  for (const i of list) (groups[i.category] ||= []).push(i);
  delete groups.Other;
  return groups;
}

function settingsHTML() {
  const en = new Set(app.instruments), s = feedStatus();
  return `<div id="banner"></div>
<section class="card"><h3>Market data</h3>
<div class="row"><button class="chip ${app.source === 'deriv' ? 'on' : ''}" data-act="source" data-v="deriv">Live prices</button><button class="chip ${app.source === 'demo' ? 'on' : ''}" data-act="source" data-v="demo">Demo (simulated)</button></div>
<p class="mu">Live mode streams prices for forex, gold, crypto, indices and synthetics straight to your phone from Deriv's public market-data feed - no account, API key, PC or server needed. Status: <b id="set-status">${V.pillText(s)}</b></p>
<div class="row"><label>Feed app ID <input id="appid" data-chg="appid" inputmode="numeric" value="${V.esc(app.appId)}" size="8"></label><button class="chip sm" data-act="retry">Reconnect</button></div></section>
<section class="card"><h3>Alerts</h3>
<label class="sw"><input type="checkbox" data-chg="a-sound" ${app.alerts.sound ? 'checked' : ''}> Sound on new signals</label>
<label class="sw"><input type="checkbox" data-chg="a-vibrate" ${app.alerts.vibrate ? 'checked' : ''}> Vibrate</label>
<label class="sw"><input type="checkbox" data-chg="a-notify" ${app.alerts.notify ? 'checked' : ''}> System notifications</label>
<label class="sw"><input type="checkbox" data-chg="wake" ${app.wake ? 'checked' : ''}> Keep screen awake while scanning</label>
<p class="mu">The scanner runs while the app is open on your screen. Phones pause web apps in the background, so keep it open (with the screen-awake option on) to catch every signal.</p></section>
<section class="card"><h3>Instruments</h3><p class="mu">Choose what to scan (max 25). Tap a group to expand.</p><div id="picker">${V.instrumentPicker(groupsForPicker(), en)}</div>
<div class="row"><button class="chip on" data-act="applyInstr">Apply &amp; restart scan</button></div></section>
<section class="card"><h3>Install on your phone</h3>
<p class="mu"><b>Android (Chrome):</b> menu ⋮ → Install app. <b>iPhone (Safari):</b> Share → Add to Home Screen. It then opens full-screen like a normal app.</p>
<div class="row"><button class="chip" id="install" data-act="install" ${deferredInstall ? '' : 'hidden'}>Install app</button></div></section>
<section class="card"><h3>Data</h3><div class="row"><button class="chip sm" data-act="clearSignals">Clear signal history</button><button class="chip sm" data-act="resetApp">Reset everything</button></div>
<p class="mu">Signals and settings are stored only on this phone.<br>Armageddon Chart Scanner 2.0 - rule-based signals, not financial advice. Not backtested: test on a demo account first.</p></section>`;
}

function mountTab() { const v = $('view'); ui.lastHTML = {}; v.innerHTML = MOUNT[ui.tab](); v.scrollTop = 0; window.scrollTo(0, 0); syncControls(); }

function syncControls() {
  if (!scanner) return;
  const cfg = scanner.settings, tf = $('tf'), mc = $('mc'), nws = $('nws');
  if (tf) { tf.innerHTML = V.selectOptions(['M1', 'M5', 'M15', 'M30', 'H1'], cfg.timeframe); }
  if (mc) { mc.innerHTML = V.selectOptions([50, 60, 70, 80, 90], cfg.min_conf); }
  if (nws) nws.checked = cfg.news;
}

function selSymbol() { const s = scanner.symbols; if (!s.find(x => x.name === ui.sel)) ui.sel = s[0] ? s[0].name : null; return ui.sel; }

function render() {
  renderHeader();
  if (!scanner || $('view') === null) return;
  if (!$('view').dataset.tab || $('view').dataset.tab !== ui.tab) { $('view').dataset.tab = ui.tab; mountTab(); }
  const st = scanner.state(), t = now();
  setHTML('banner', banner());
  if (ui.tab === 'scan') {
    setHTML('scan-strat', V.stratChips(st.settings.strategy));
    setHTML('scan-desc', V.esc((STRATEGY_INFO[st.settings.strategy] || STRATEGY_INFO.ALL).desc));
    setHTML('scan-cats', V.catChips(st.symbols, ui.cat));
    setHTML('scan-list', ui.booting ? '<p class="mu pad">Connecting to the market feed…</p>' : V.instrumentList(st, ui.cat, selSymbol()));
    const tf = $('tf'), mc = $('mc');
    if (tf && document.activeElement !== tf) tf.value = st.settings.timeframe;
    if (mc && document.activeElement !== mc) mc.value = st.settings.min_conf;
  } else if (ui.tab === 'chart') {
    const sym = selSymbol(), cd = sym && scanner.chartData(sym), x = st.symbols.find(q => q.symbol === sym);
    setHTML('ch-title', x ? `<b>${V.esc(x.symbol)}</b> <span class="mu">${V.esc(x.category)} · ${x.timeframe}</span><div class="px">${x.bid.toFixed(x.digits)} <small class="${x.bias === 'UP' ? 'up' : 'dn'}">${x.bias === 'UP' ? '▲ bullish' : '▼ bearish'} · RSI ${x.rsi.toFixed(0)}</small></div>` : '<span class="mu">Waiting for prices…</span>');
    if (cd) drawChart($('cv'), cd);
    const mine = st.signals.filter(g => g.symbol === sym && V.isLive(g));
    setHTML('ch-sigs', mine.length ? mine.map(g => V.sigCard(g, t)).join('') : '<p class="mu pad">No live signal on this pair right now. Swipe the chart or use ‹ › to scan the next pair.</p>');
  } else if (ui.tab === 'signals') {
    setHTML('sg-tabs', V.signalTabs(st, ui.sigTab));
    setHTML('sg-list', V.signalList(st, ui.sigTab, t));
  } else if (ui.tab === 'news') {
    setHTML('nw-status', V.esc(calendar.status));
    setHTML('nw-list', V.newsList(st.news, t));
  } else if (ui.tab === 'settings') {
    const el = $('set-status'); if (el) el.textContent = V.pillText(feedStatus());
    setHTML('banner', banner());
  }
}

function step(dir) {
  const s = scanner.symbols; if (!s.length) return;
  const i = Math.max(0, s.findIndex(x => x.name === ui.sel));
  ui.sel = s[(i + dir + s.length) % s.length].name; render();
}

// ------------------------------------------------------------------- events
const ACT = {
  goto: el => { ui.tab = el.dataset.tab; render(); },
  strat: async el => { const k = el.dataset.v; await scanner.updateSettings({ strategy: k, timeframe: STRATEGY_INFO[k].tf }); syncControls(); render(); },
  cat: el => { ui.cat = el.dataset.v; render(); },
  pick: el => { ui.sel = el.dataset.sym; ui.tab = 'chart'; render(); },
  prev: () => step(-1), next: () => step(1),
  sigtab: el => { ui.sigTab = el.dataset.v; render(); },
  png: () => {
    const cv = $('cv'); if (!cv) return;
    cv.toBlob(async b => {
      if (!b) return;
      const file = new File([b], `${ui.sel || 'chart'}.png`, { type: 'image/png' });
      try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: ui.sel }); return; } } catch (e) { /* cancelled */ }
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = file.name; a.click();
    });
  },
  addNews: () => {
    const title = $('nw-title').value.trim(), v = $('nw-time').value;
    if (!title || !v) { toast('Enter an event name and a time'); return; }
    calendar.addManual(title, $('nw-ccy').value, new Date(v).getTime() / 1000); $('nw-title').value = ''; toast('Event added'); ui.lastHTML['nw-list'] = null; render();
  },
  delNews: el => { calendar.removeManual(+el.dataset.id); ui.lastHTML['nw-list'] = null; render(); },
  source: async el => { app.source = el.dataset.v; saveApp(); $('view').dataset.tab = ''; await boot(); },
  retry: async () => { ui.error = ''; await boot(); },
  useDemo: async () => { app.source = 'demo'; saveApp(); await boot(); },
  applyInstr: async () => {
    const codes = [...document.querySelectorAll('#picker input[data-code]:checked')].map(i => i.dataset.code);
    if (!codes.length) { toast('Pick at least one instrument'); return; }
    if (codes.length > 25) { toast('Please pick 25 or fewer'); return; }
    if (feed && feed.active) for (const a of feed.active) if (codes.includes(a.code) && !DEFAULT_INSTRUMENTS.find(i => i.code === a.code)) app.extra[a.code] = { code: a.code, name: a.label, label: a.label, category: a.category };
    app.instruments = codes; saveApp(); toast('Restarting scan…'); await boot();
  },
  install: async () => { if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; render(); } },
  clearSignals: () => { book.signals.clear(); book.save(); toast('Signal history cleared'); render(); },
  resetApp: () => { if (confirm('Reset all settings and signal history on this phone?')) { Object.keys(localStorage).filter(k => k.startsWith('acs_')).forEach(k => store.removeItem(k)); location.reload(); } },
};
const CHG = {
  tf: async el => { await scanner.updateSettings({ timeframe: el.value }); render(); },
  mc: async el => { await scanner.updateSettings({ min_conf: +el.value }); render(); },
  news: async el => { await scanner.updateSettings({ news: el.checked }); },
  tour: el => { ui.tour = el.checked; },
  appid: el => { app.appId = el.value.replace(/\D/g, '') || 1089; saveApp(); },
  'a-sound': el => { app.alerts.sound = el.checked; saveApp(); if (el.checked) beep(); },
  'a-vibrate': el => { app.alerts.vibrate = el.checked; saveApp(); if (el.checked && navigator.vibrate) navigator.vibrate(60); },
  'a-notify': async el => {
    if (el.checked && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    app.alerts.notify = el.checked && 'Notification' in window && Notification.permission === 'granted';
    if (el.checked && !app.alerts.notify) { el.checked = false; toast('Notifications are blocked for this site'); } saveApp();
  },
  wake: el => { app.wake = el.checked; saveApp(); keepAwake(); },
};

document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (el && ACT[el.dataset.act]) { if (audio && audio.state === 'suspended') audio.resume(); ACT[el.dataset.act](el, e); } });
document.addEventListener('change', e => { const el = e.target.closest('[data-chg]'); if (el && CHG[el.dataset.chg]) CHG[el.dataset.chg](el, e); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { keepAwake(); loop(); } });
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; const b = $('install'); if (b) b.hidden = false; });
let sx = 0;
document.addEventListener('touchstart', e => { if (e.target.id === 'cv') sx = e.changedTouches[0].clientX; }, { passive: true });
document.addEventListener('touchend', e => { if (e.target.id === 'cv') { const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1); } }, { passive: true });
window.addEventListener('resize', () => { if (ui.tab === 'chart') render(); });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
setInterval(loop, 1000);
globalThis.__acs = { get scanner() { return scanner; }, get feed() { return feed; }, ui, app };
boot();
