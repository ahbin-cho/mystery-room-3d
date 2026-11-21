import test from 'node:test';
import assert from 'node:assert/strict';
import { CASE } from '../src/cases/owl-manor.js';
import { createState, applyAction } from '../src/core/rules.js';
import {
  PREFIX, CODE_CHARS, genCode, peerIdFor, normalizeCode, uuid, cleanName, parseJoin, cleanAction,
  routeEvents, posesOf, phaseRemaining, isPhaseOver, stateChanged,
} from '../src/core/protocol.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('room code: 4 chars from the v1 set, owl prefix', () => {
  assert.equal(CODE_CHARS, 'ABCDEFGHJKMNPQRSTUVWXYZ');
  for (let i = 0; i < 200; i++) {
    const c = genCode();
    assert.equal(c.length, 4);
    for (const ch of c) assert.ok(CODE_CHARS.includes(ch));
  }
  assert.equal(genCode(() => 0), 'AAAA');
  assert.equal(genCode(() => 0.9999), 'ZZZZ');
  assert.equal(peerIdFor('ABCD'), 'owl-2611-ABCD');
  assert.equal(PREFIX, 'owl-2611-');
});

test('normalizeCode accepts typed codes, rejects junk', () => {
  assert.equal(normalizeCode(' abcd '), 'ABCD');
  assert.equal(normalizeCode('ABC'), null);
  assert.equal(normalizeCode('ABCDE'), null);
  assert.equal(normalizeCode('AB1D'), null);
  assert.equal(normalizeCode('ABOD'), null); // O is not in the set
  assert.equal(normalizeCode(null), null);
});

test('uuid: randomUUID when present, getRandomValues or rng otherwise', () => {
  assert.equal(uuid({ randomUUID: () => 'fixed' }), 'fixed');
  const insecure = { getRandomValues: b => { b.fill(0xff); return b; } };
  assert.equal(uuid(insecure), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
  assert.match(uuid({}, Math.random), UUID_RE);
  assert.match(uuid(undefined, () => 0), UUID_RE);
  const throws = { randomUUID() { throw new Error('insecure'); }, getRandomValues: b => b };
  assert.match(uuid(throws), UUID_RE);
  assert.match(uuid(), /^[0-9a-f-]{36}$/);
});

test('cleanName trims, caps and defaults', () => {
  assert.equal(cleanName('  민지 '), '민지');
  assert.equal(cleanName(''), '탐정');
  assert.equal(cleanName(undefined), '탐정');
  assert.equal(cleanName('x'.repeat(40)).length, 12);
});

test('parseJoin: needs an id-shaped pid and key; never host or prototype keys', () => {
  const pid = uuid(), key = uuid();
  assert.deepEqual(parseJoin({ t: 'join', pid, key, name: ' 민지 ' }), { pid, key, name: '민지' });
  for (const bad of ['host', '__proto__', 'constructor', '', 'a b', 'x'.repeat(65), 7, null]) {
    assert.equal(parseJoin({ t: 'join', pid: bad, key, name: 'a' }), null, String(bad));
  }
  assert.equal(parseJoin({ t: 'join', pid, name: 'a' }), null);
  assert.equal(parseJoin({ t: 'pos', pid, key }), null);
  assert.equal(parseJoin(null), null);
});

test('cleanAction keeps only reducer fields; drops join/leave/next and junk', () => {
  assert.deepEqual(cleanAction({ t: 'pos', floor: 1, x: 1, z: 2, ry: 3, mv: 1, extra: 9 }),
    { t: 'pos', x: 1, z: 2, ry: 3, mv: 1 });
  assert.deepEqual(cleanAction({ t: 'pick', id: 'earring', holder: 'x' }), { t: 'pick', id: 'earring' });
  assert.deepEqual(cleanAction({ t: 'vote', target: 'sera' }), { t: 'vote', target: 'sera' });
  assert.deepEqual(cleanAction({ t: 'usePassage', to: 'b' }), { t: 'usePassage' });
  assert.deepEqual(cleanAction({ t: 'useStairs', id: 'main' }), { t: 'useStairs', id: 'main' });
  for (const bad of [{ t: 'next' }, { t: 'join', pid: 'host' }, { t: 'leave' }, { t: 'pick', id: {} },
    { t: 'vote' }, { t: 'state' }, null, 'pos', 42]) {
    assert.equal(cleanAction(bad), null, JSON.stringify(bad));
  }
});

test('routeEvents: public to all, private only to its pid, empty lists dropped', () => {
  const pub = [{ type: 'phase', phase: 'intro' }];
  const priv = { a: [{ type: 'toast', text: '너무 멀어요' }] };
  const r = routeEvents(pub, priv, ['host', 'a', 'b']);
  assert.deepEqual(r.host, pub);
  assert.deepEqual(r.b, pub);
  assert.deepEqual(r.a, [...pub, ...priv.a]);
  assert.deepEqual(routeEvents([], priv, ['host', 'a', 'b']), { a: priv.a });
  assert.deepEqual(routeEvents([], undefined, ['a']), {});
  // a private event for a pid that is not connected goes nowhere
  assert.deepEqual(routeEvents([], { z: [{ type: 'toast' }] }, ['a']), {});
});

test('posesOf gives floor/x/z/ry/mv per player', () => {
  let S = createState(CASE);
  S = applyAction(S, CASE, { t: 'join', name: 'h' }, 'host', 0).S;
  S = applyAction(S, CASE, { t: 'pos', x: 3, z: 4, ry: 1, mv: 1 }, 'host', 0).S;
  assert.deepEqual(posesOf(S), { host: { floor: 0, x: 3, z: 4, ry: 1, mv: 1 } });
});

test('phase timer helpers', () => {
  assert.equal(phaseRemaining({ phaseEndsAt: null }, 5), null);
  assert.equal(phaseRemaining({ phaseEndsAt: 1000 }, 400), 600);
  assert.equal(phaseRemaining({ phaseEndsAt: 1000 }, 4000), 0);
  assert.equal(isPhaseOver({ phaseEndsAt: null }, 1e12), false);
  assert.equal(isPhaseOver({ phaseEndsAt: 1000 }, 999), false);
  assert.equal(isPhaseOver({ phaseEndsAt: 1000 }, 1000), true);
});

test('stateChanged: a rejected action is not a change', () => {
  let S = createState(CASE);
  S = applyAction(S, CASE, { t: 'join', name: 'a' }, 'a', 0).S;
  const same = applyAction(S, CASE, { t: 'next' }, 'a', 0).S; // next from a non-host: no-op clone
  assert.notEqual(same, S);
  assert.equal(stateChanged(S, same), false);
  assert.equal(stateChanged(S, applyAction(S, CASE, { t: 'next' }, 'host', 0).S), true);
  assert.equal(stateChanged(S, S), false);
});
