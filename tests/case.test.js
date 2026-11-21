import test from 'node:test';
import assert from 'node:assert/strict';
import { roomAt, validateMap } from '../src/core/map.js';
import { CASE } from '../src/cases/owl-manor.js';

const floorOf = id => CASE.MAP.rooms.find(r => r.id === id).floor;
const itemById = id => CASE.ITEMS.find(i => i.id === id);
const roomById = id => CASE.MAP.rooms.find(r => r.id === id);

test('map is valid', () => assert.deepEqual(validateMap(CASE.MAP), []));

test('has 13 rooms over 2 floors', () => {
  assert.ok(CASE.MAP.rooms.length >= 13);
  assert.deepEqual([...new Set(CASE.MAP.rooms.map(r => r.floor))].sort(), [0, 1]);
});

test('room ids and floors match the brief', () => {
  const f0 = ['hall', 'living', 'dining', 'kitchen', 'cellar', 'study', 'conservatory', 'butler'];
  const f1 = ['corridor', 'master', 'guestA', 'guestB', 'attic'];
  f0.forEach(id => assert.equal(floorOf(id), 0, id));
  f1.forEach(id => assert.equal(floorOf(id), 1, id));
});

test('door graph matches the brief exactly', () => {
  const key = (a, b) => [a, b].sort().join('-');
  const want = [['hall', 'living'], ['hall', 'dining'], ['hall', 'study'], ['hall', 'butler'],
    ['dining', 'kitchen'], ['dining', 'conservatory'], ['kitchen', 'cellar'], ['kitchen', 'butler'],
    ['corridor', 'master'], ['corridor', 'guestA'], ['corridor', 'guestB'], ['corridor', 'attic']]
    .map(([a, b]) => key(a, b)).sort();
  assert.deepEqual(CASE.MAP.doors.map(d => key(d.a, d.b)).sort(), want);
  const st = CASE.MAP.stairs.map(s => key(s.a.room, s.b.room));
  assert.deepEqual(st, [key('hall', 'corridor')]);
  const sec = CASE.MAP.passages.find(p => p.id === 'secret');
  assert.ok(sec);
  assert.equal(key(sec.a.room, sec.b.room), key('study', 'conservatory'));
});

test('room size minimums', () => {
  CASE.MAP.rooms.forEach(r => {
    const w = r.rect[2] - r.rect[0], d = r.rect[3] - r.rect[1];
    const min = ['conservatory', 'dining'].includes(r.id) ? 6 : 4;
    assert.ok(w >= min && d >= min, `${r.id} ${w}x${d}`);
  });
});

test('master is above study', () => {
  const m = roomById('master').rect, s = roomById('study').rect;
  const ox = Math.min(m[2], s[2]) - Math.max(m[0], s[0]);
  const oz = Math.min(m[3], s[3]) - Math.max(m[1], s[1]);
  assert.ok(ox > 0 && oz > 0 && ox * oz > 0);
});

test('stair and passage endpoints sit well inside their rooms', () => {
  for (const s of [...CASE.MAP.stairs, ...CASE.MAP.passages]) {
    for (const e of [s.a, s.b]) {
      const r = roomById(e.room).rect;
      assert.equal(roomAt(CASE.MAP, floorOf(e.room), e.x, e.z), e.room, `${s.id}:${e.room}`);
      assert.ok(e.x - r[0] >= 0.6 && r[2] - e.x >= 0.6 && e.z - r[1] >= 0.6 && r[3] - e.z >= 0.6, `${s.id}:${e.room}`);
    }
  }
});

test('every item sits inside its room', () => CASE.ITEMS.forEach(it => {
  assert.equal(roomAt(CASE.MAP, floorOf(it.room), it.pos[0], it.pos[2]), it.room, it.id);
  const r = roomById(it.room).rect;
  assert.ok(it.pos[0] - r[0] >= 0.6 && r[2] - it.pos[0] >= 0.6 && it.pos[2] - r[1] >= 0.6 && r[3] - it.pos[2] >= 0.6, `${it.id} too close to wall`);
}));

test('item ids unique and chains reference real items', () => {
  const ids = CASE.ITEMS.map(i => i.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 21);
  CASE.CHAINS.forEach(c => {
    [...c.fixedPath, ...c.all].forEach(id => assert.ok(itemById(id), `${c.id}:${id}`));
    c.fixedPath.forEach(id => assert.ok(c.all.includes(id), `${c.id}:${id} not in all`));
  });
  assert.deepEqual(CASE.CHAINS.map(c => c.id), ['moved', 'passage', 'who']);
});

test('items have valid kind, container, points and text', () => {
  const containers = [null, 'drawer', 'wardrobe', 'bag', 'safe', 'planter', 'shelf'];
  CASE.ITEMS.forEach(i => {
    assert.ok(['fixed', 'portable'].includes(i.kind), i.id);
    assert.ok(containers.includes(i.container), i.id);
    assert.ok(i.name && i.desc, i.id);
    assert.equal(i.pos.length, 3, i.id);
    i.points.forEach(k => assert.ok(CASE.ROLES[k], `${i.id}:${k}`));
  });
});

test('every chain has a fixed-only path', () => CASE.CHAINS.forEach(c =>
  c.fixedPath.forEach(id => assert.equal(itemById(id).kind, 'fixed', `${c.id}:${id}`))));

test('no single item points only at the culprit', () =>
  CASE.ITEMS.filter(i => i.points.length === 1 && i.points[0] === 'sera')
    .forEach(i => assert.equal(i.kind, 'portable', i.id)));

test('who chain fixed path narrows to the culprit only by intersection', () => {
  const who = CASE.CHAINS.find(c => c.id === 'who');
  const sets = who.fixedPath.map(id => itemById(id).points);
  const inter = sets.reduce((a, b) => a.filter(k => b.includes(k)));
  assert.deepEqual(inter, [CASE.culprit]);
});

test('every innocent role has at least 2 items pointing at them', () =>
  ['yujin', 'hanbyul', 'doyun'].forEach(k =>
    assert.ok(CASE.ITEMS.filter(i => i.points.includes(k)).length >= 2, k)));

test('only sera and doyun know the passage', () => {
  const knowers = Object.entries(CASE.ROLES).filter(([, r]) => r.knowsPassage).map(([k]) => k).sort();
  assert.deepEqual(knowers, ['doyun', 'sera']);
});

test('roles are complete', () => {
  assert.deepEqual(Object.keys(CASE.ROLES).sort(), ['doyun', 'hanbyul', 'helper', 'sera', 'yujin']);
  for (const [k, r] of Object.entries(CASE.ROLES)) {
    for (const f of ['name', 'job', 'gender', 'public', 'secret', 'knows', 'goal', 'npc']) assert.ok(r[f], `${k}.${f}`);
    assert.ok(['short', 'long', 'bald', 'neat'].includes(r.look.hair), k);
    assert.ok(Array.isArray(r.look.accessories), k);
    assert.equal(typeof r.knowsPassage, 'boolean', k);
  }
  assert.equal(CASE.ROLES.sera.look.hair, 'long');
  assert.equal(CASE.culprit, 'sera');
});

test('phases durations', () => {
  assert.deepEqual(CASE.PHASES.map(p => p.id),
    ['lobby', 'intro', 'investigate1', 'midtalk', 'investigate2', 'finaltalk', 'vote', 'reveal']);
  assert.deepEqual(CASE.PHASES.filter(p => p.ms).map(p => p.ms), [720000, 300000, 600000, 480000]);
  assert.deepEqual(CASE.PHASES.find(p => p.id === 'investigate2').floors, [0, 1]);
  assert.deepEqual(CASE.PHASES.find(p => p.id === 'lobby').floors, [0]);
});
