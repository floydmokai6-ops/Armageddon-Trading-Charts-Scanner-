// Proves the JavaScript engine matches the validated Python reference results exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { params, detectShadow, buildSignal, buildNewsStraddle, advance, publicSignal } from '../js/engine.js';
import { detectAll } from '../js/strategies.js';

const REF = JSON.parse(fs.readFileSync(new URL('./parity.json', import.meta.url)));
const META = { name: 'XAUUSD', category: 'Gold' };
const CTX = { digits: 2, kz: 'London' };
// The Python reference prints 4.0R where the app prints the friendlier 4R - normalise that one cosmetic difference.
const norm = x => JSON.parse(JSON.stringify(x).replace(/(\d)\.0R/g, '$1R'));

function close(a, b, path = '') {
  if (typeof a === 'number' && typeof b === 'number') {
    const tol = 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));
    assert.ok(Math.abs(a - b) <= tol, `${path}: ${a} != ${b}`);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    assert.equal(a.length, b.length, `${path}: length ${a.length} != ${b.length}`);
    a.forEach((x, i) => close(x, b[i], `${path}[${i}]`));
  } else if (a && b && typeof a === 'object' && typeof b === 'object') {
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), `${path}: keys differ`);
    for (const k of Object.keys(a)) close(a[k], b[k], `${path}.${k}`);
  } else assert.equal(a, b, `${path}: ${a} != ${b}`);
}

test('strategies: JS == Python on every fixture (buy, sell, noise, higher-timeframe)', () => {
  let cases = 0, found = 0;
  for (const [key, expected] of Object.entries(REF.strategies)) {
    const [name, fx] = key.split(':');
    const htf = fx.endsWith('+htf');
    const fixture = REF.fixtures[htf ? fx.slice(0, -4) : fx];
    const P = params(); if (fx !== 'drift') P.min_conf = 50;
    const got = detectAll(name, fixture, htf ? REF.htf : null, P, CTX);
    close(got, expected, key);
    cases++; found += got.length;
  }
  assert.ok(found >= 12, `expected many setups, got ${found}`);
  console.log(`  ${cases} strategy cases identical (${found} setups)`);
});

test('shadow entry: JS == Python', () => {
  for (const [key, expected] of Object.entries(REF.shadow)) {
    const fx = REF.fixtures[key.replace('_blackout', '')];
    const got = detectShadow(fx, params(), key.endsWith('_blackout'));
    close(got, expected, key);
  }
});

test('buildSignal: market and pending signals + reasons identical', () => {
  for (const c of REF.signals) {
    const s = buildSignal(META, 'M15', c.setup, c.px, c.px, params(), 1000.0, 2);
    if (c.signal === null) { assert.equal(s, null); continue; }
    close(publicSignal(s), norm(c.signal), c.label);
  }
});

test('lifecycle: pending/active/TP/SL/breakeven/expiry identical', () => {
  for (const [i, w] of REF.lifecycle.entries()) {
    const P = params();
    const s = buildSignal(META, 'M5', w.setup, w.start, w.start, P, 1000.0, 2);
    let now = 1000.0;
    for (const step of w.log) {
      now += 5;
      const ev = advance(s, step.px, step.px, now, P);
      assert.deepEqual(ev, step.events, `walk ${i} px ${step.px}`);
      assert.equal(s.state, step.state); assert.equal(s.hits, step.hits); close(s.sl, step.sl, `walk ${i} sl`);
    }
  }
});

test('news straddle legs identical', () => {
  const legs = buildNewsStraddle(META, 'M5', REF.news.event, 1.0, 100.0, 100.5, params(), 1000.0, 2).map(publicSignal);
  close(legs, REF.news.legs, 'news');
});
