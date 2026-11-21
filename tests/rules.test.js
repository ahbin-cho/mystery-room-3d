import test from 'node:test';
import assert from 'node:assert/strict';
import { CASE } from '../src/cases/owl-manor.js';
import { createState, applyAction, assignRoles, canUsePassage, visibleItem, tally } from '../src/core/rules.js';

function seeded(seed) {
  let s = (seed * 2654435761 + 12345) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const act = (S, action, pid = 'host', now = 0) => applyAction(S, CASE, action, pid, now, seeded(1));
function lobby(names = ['a', 'b', 'c']) {
  let S = createState(CASE);
  for (const n of names) S = act(S, { t: 'join', name: n }, n).S;
  return S;
}
function toPhase(S, phase, now = 0) {
  let guard = 0;
  while (S.phase !== phase && guard++ < 10) S = act(S, { t: 'next' }, 'host', now).S;
  return S;
}
const roleOf = (S, role) => Object.keys(S.players).find(p => S.players[p].role === role);

test('culprit always assigned to a player when 2+', () => {
  for (let s = 0; s < 50; s++) {
    const r = assignRoles(['a', 'b'], CASE, seeded(s));
    assert.ok(Object.values(r).includes('sera'));
  }
});

test('5th player becomes helper', () => {
  const r = assignRoles(['a', 'b', 'c', 'd', 'e'], CASE, seeded(3));
  assert.equal(r.e, 'helper');
  assert.equal(Object.values(r).filter(x => x === 'helper').length, 1);
});

test('solo gets some role', () => {
  const r = assignRoles(['a'], CASE, seeded(3));
  assert.ok(CASE.ROLES[r.a]);
});

test('next only from host', () => {
  const S = lobby();
  assert.equal(act(S, { t: 'next' }, 'a').S.phase, 'lobby');
  assert.equal(act(S, { t: 'next' }, 'host').S.phase, 'intro');
});

test('phase timer and floors', () => {
  let S = lobby();
  S = act(S, { t: 'next' }, 'host', 1000).S;
  S = act(S, { t: 'next' }, 'host', 2000).S;
  assert.equal(S.phase, 'investigate1');
  assert.equal(S.phaseEndsAt, 2000 + 720000);
  assert.deepEqual(S.floorsOpen, [0]);
  S = toPhase(S, 'investigate2', 5000);
  assert.equal(S.phaseEndsAt, 5000 + 600000);
  assert.deepEqual(S.floorsOpen, [0, 1]);
});

test('intro teleports everyone to hall', () => {
  const S = lobby();
  const r = act(S, { t: 'next' });
  const tps = r.events.filter(e => e.type === 'teleport');
  assert.equal(tps.length, 3);
  assert.deepEqual(new Set(tps.map(e => e.pid)), new Set(['a', 'b', 'c']));
  assert.ok(r.events.some(e => e.type === 'phase' && e.phase === 'intro'));
  for (const p of Object.values(r.S.players)) assert.ok(p.role);
  const hall = CASE.MAP.rooms.find(x => x.id === 'hall').rect;
  for (const e of tps) {
    assert.equal(e.floor, 0);
    assert.ok(e.x > hall[0] && e.x < hall[2] && e.z > hall[1] && e.z < hall[3]);
  }
  assert.equal(new Set(tps.map(e => e.x + ',' + e.z)).size, 3);
});

test('stairs blocked before investigate2', () => {
  const S1 = toPhase(lobby(), 'investigate1');
  const { S, private: p } = act(S1, { t: 'useStairs', id: CASE.MAP.stairs[0].id }, 'a');
  assert.equal(S.players.a.floor, 0);
  assert.match(p.a[0].text, /2층은 조사 2부터/);
});

test('stairs work in investigate2 and back', () => {
  const S1 = toPhase(lobby(), 'investigate2');
  const up = act(S1, { t: 'useStairs', id: 'main' }, 'a');
  assert.equal(up.S.players.a.floor, 1);
  assert.equal(up.events[0].type, 'teleport');
  assert.equal(up.events[0].pid, 'a');
  const down = act(up.S, { t: 'useStairs', id: 'main' }, 'a');
  assert.equal(down.S.players.a.floor, 0);
});

test('fixed items cannot be picked', () => {
  const S1 = toPhase(lobby(), 'investigate1');
  const { S } = act(S1, { t: 'pick', id: 'body' }, 'a');
  assert.equal(S.items.body?.holder ?? null, null);
  assert.equal(visibleItem(S, 'a', 'body'), 'present');
});

test('portable item: first picker holds, others see gone', () => {
  const S1 = toPhase(lobby(), 'investigate1');
  const r = act(S1, { t: 'pick', id: 'earring' }, 'a');
  assert.equal(visibleItem(r.S, 'b', 'earring'), 'gone');
  assert.equal(visibleItem(r.S, 'a', 'earring'), 'mine');
  assert.equal(r.events[0].text, '👜 누군가 온실에서 증거를 챙겼다…');
  const r2 = act(r.S, { t: 'pick', id: 'earring' }, 'b');
  assert.equal(r2.S.items.earring.holder, 'a');
  assert.equal(r2.events.length, 0);
});

test('shared item visible to all', () => {
  let S = toPhase(lobby(), 'investigate1');
  S = act(S, { t: 'pick', id: 'earring' }, 'a').S;
  assert.equal(act(S, { t: 'share', id: 'earring' }, 'b').S.items.earring.shared, false);
  S = act(S, { t: 'share', id: 'earring' }, 'a').S;
  assert.equal(visibleItem(S, 'b', 'earring'), 'shared');
  assert.equal(visibleItem(S, 'a', 'earring'), 'shared');
});

test('cannot pick in lobby or vote', () => {
  const L = lobby();
  assert.equal(act(L, { t: 'pick', id: 'earring' }, 'a').S.items.earring?.holder ?? null, null);
  const V = toPhase(L, 'vote');
  assert.equal(act(V, { t: 'pick', id: 'earring' }, 'a').S.items.earring?.holder ?? null, null);
});

test('passage: sera and doyun can use from start, others after discover or share', () => {
  let S = toPhase(lobby(['a', 'b', 'c', 'd']), 'investigate1');
  const sera = roleOf(S, 'sera'), doyun = roleOf(S, 'doyun');
  const other = Object.keys(S.players).find(p => p !== sera && p !== doyun);
  assert.ok(canUsePassage(S, CASE, sera));
  if (doyun) assert.ok(canUsePassage(S, CASE, doyun));
  assert.equal(canUsePassage(S, CASE, other), false);
  const rej = act(S, { t: 'usePassage' }, other);
  assert.equal(rej.S.players[other].floor, 0);
  assert.ok(rej.private[other].length > 0);
  const d = act(S, { t: 'discoverPassage' }, other).S;
  assert.ok(canUsePassage(d, CASE, other));
  const use = act(d, { t: 'usePassage' }, other);
  assert.equal(use.events[0].type, 'teleport');
  // sharing
  assert.equal(act(S, { t: 'sharePassage' }, other).S.passageShared, false);
  const sh = act(S, { t: 'sharePassage' }, sera);
  assert.equal(sh.S.passageShared, true);
  assert.ok(sh.events.some(e => e.type === 'toast'));
  assert.ok(canUsePassage(sh.S, CASE, other));
});

test('rejoin keeps role and items', () => {
  let S = toPhase(lobby(), 'investigate1');
  const role = S.players.a.role;
  S = act(S, { t: 'pick', id: 'earring' }, 'a').S;
  S = act(S, { t: 'leave' }, 'a').S;
  assert.equal(S.players.a.online, false);
  S = act(S, { t: 'join', name: 'a' }, 'a').S;
  assert.equal(S.players.a.online, true);
  assert.equal(S.players.a.role, role);
  assert.equal(S.items.earring.holder, 'a');
});

test('late joiner gets remaining role then helper', () => {
  let S = toPhase(lobby(['a', 'b']), 'investigate1');
  S = act(S, { t: 'join', name: 'c' }, 'c').S;
  S = act(S, { t: 'join', name: 'd' }, 'd').S;
  S = act(S, { t: 'join', name: 'e' }, 'e').S;
  const roles = Object.values(S.players).map(p => p.role);
  assert.equal(new Set(roles).size, 5);
  assert.equal(S.players.e.role, 'helper');
});

test('leave in lobby removes player', () => {
  let S = lobby();
  S = act(S, { t: 'leave' }, 'b').S;
  assert.equal(S.players.b, undefined);
  assert.ok(!S.order.includes('b'));
});

test('pos updates own player', () => {
  const S = act(lobby(), { t: 'pos', floor: 0, x: 3, z: 4, ry: 1, mv: 1 }, 'a').S;
  assert.equal(S.players.a.x, 3);
  assert.equal(S.players.a.mv, 1);
});

test('vote only in vote phase, can change vote', () => {
  let S = toPhase(lobby(), 'investigate1');
  assert.equal(act(S, { t: 'vote', target: 'sera' }, 'a').S.votes.a, undefined);
  S = toPhase(S, 'vote');
  S = act(S, { t: 'vote', target: 'sera' }, 'a').S;
  assert.equal(S.votes.a, 'sera');
  S = act(S, { t: 'vote', target: 'yujin' }, 'a').S;
  assert.equal(S.votes.a, 'yujin');
});

test('tally tie means not caught', () => {
  let S = toPhase(lobby(['a', 'b']), 'vote');
  S = act(S, { t: 'vote', target: 'sera' }, 'a').S;
  S = act(S, { t: 'vote', target: 'yujin' }, 'b').S;
  const t = tally(S, CASE);
  assert.equal(t.caught, false);
  assert.equal(t.top.length, 2);
});

test('offline players excluded from vote count', () => {
  let S = toPhase(lobby(), 'vote');
  for (const p of ['a', 'b', 'c']) S = act(S, { t: 'vote', target: 'sera' }, p).S;
  S = act(S, { t: 'leave' }, 'c').S;
  assert.equal(tally(S, CASE).voters, 2);
  assert.equal(tally(S, CASE).counts.sera, 2);
});

test('caught when culprit has unique top', () => {
  let S = toPhase(lobby(), 'vote');
  S = act(S, { t: 'vote', target: 'sera' }, 'a').S;
  S = act(S, { t: 'vote', target: 'sera' }, 'b').S;
  S = act(S, { t: 'vote', target: 'yujin' }, 'c').S;
  const t = tally(S, CASE);
  assert.equal(t.caught, true);
  assert.deepEqual(t.top, ['sera']);
});

test('does not mutate input; unknown action is a no-op', () => {
  const S = lobby();
  const snap = JSON.stringify(S);
  act(S, { t: 'next' });
  assert.equal(JSON.stringify(S), snap);
  const r = act(S, { t: 'bogus' }, 'a');
  assert.deepEqual(r.events, []);
  assert.deepEqual(r.S, S);
});
