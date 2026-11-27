import test from 'node:test';
import assert from 'node:assert/strict';
import { joystickVector, nearestFree, planRoute, stepRoute, navOptions, SPEED, ARRIVE } from '../src/core/walk.js';
import { buildGrid, isBlocked } from '../src/core/grid.js';
import { roomAt } from '../src/core/map.js';
import { createState } from '../src/core/rules.js';
import { CASE } from '../src/cases/owl-manor.js';
import { M } from './fixture.js';

const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

test('joystick: up on screen is north (-z), full speed at the radius, clamped beyond', () => {
  const v = joystickVector(0, -60);
  assert.ok(near(v.x, 0) && near(v.z, -1) && near(v.mag, 1));
  const w = joystickVector(300, 0);
  assert.ok(near(w.x, 1) && near(w.mag, 1));
  assert.ok(near(w.kx, 60) && near(w.ky, 0), 'knob clamped to 60px');
});

test('joystick: dead zone and proportional speed', () => {
  assert.equal(joystickVector(3, 0).mag, 0);
  const h = joystickVector(0, 30);
  assert.ok(h.mag > 0.3 && h.mag < 0.5, `half travel gives partial speed (${h.mag})`);
});

test('route through a door reaches the far room and ends with done', () => {
  const g = buildGrid(M, 0);
  const route = planRoute(M, { floor: 0, x: 1.5, z: 2 }, { floor: 0, x: 6.5, z: 2.5 }, { floorsOpen: [0] });
  assert.ok(route);
  let pos = { floor: 0, x: 1.5, z: 2 }, ev = null, t = 0;
  while (!ev && t < 10) { const r = stepRoute(route, g, pos, 1 / 30); pos = { ...pos, x: r.x, z: r.z }; ev = r.event; t += 1 / 30; }
  assert.equal(ev, 'done');
  assert.ok(Math.hypot(pos.x - 6.5, pos.z - 2.5) <= 0.1);
  assert.ok(t < 5 / SPEED + 1, `walked at speed (${t.toFixed(2)} s)`);
});

test('interact targets arrive within ARRIVE', () => {
  const g = buildGrid(M, 0);
  const goal = { floor: 0, x: 7, z: 2 };
  const route = planRoute(M, { floor: 0, x: 1.5, z: 2 }, goal, { floorsOpen: [0] }, ARRIVE);
  let pos = { floor: 0, x: 1.5, z: 2 }, ev = null;
  for (let k = 0; k < 300 && !ev; k++) { const r = stepRoute(route, g, pos, 1 / 30); pos = { ...pos, x: r.x, z: r.z }; ev = r.event; }
  assert.equal(ev, 'arrive');
  const d = Math.hypot(goal.x - pos.x, goal.z - pos.z);
  assert.ok(d <= ARRIVE && d > ARRIVE - 0.2, `stopped at the edge of the radius (${d})`);
});

test('a waypoint behind a wall gives up as stuck instead of jittering', () => {
  const g = buildGrid(M, 0);
  const route = { goal: { floor: 0, x: 6, z: 2 }, reach: 0, steps: [{ floor: 0, x: 6, z: 3.0, kind: 'walk' }], i: 0, best: Infinity, stuck: 0 };
  let pos = { floor: 0, x: 2, z: 3.0 }, ev = null, t = 0;
  while (!ev && t < 5) { const r = stepRoute(route, g, pos, 1 / 30); pos = { ...pos, x: r.x, z: r.z }; ev = r.event; t += 1 / 30; }
  assert.equal(ev, 'stuck');
  assert.ok(t < 2.5, `gave up after about a second at the wall (${t.toFixed(2)} s)`);
});

test('stairs step stops at the near end and reports the link id', () => {
  const MAP = CASE.MAP;
  const g = buildGrid(MAP, 0);
  const from = { floor: 0, x: 14, z: 15 };
  const route = planRoute(MAP, from, { floor: 1, x: 19.5, z: 14 }, { floorsOpen: [0, 1] });
  let pos = { ...from }, ev = null;
  for (let k = 0; k < 600 && !ev; k++) { const r = stepRoute(route, g, pos, 1 / 30); pos = { ...pos, x: r.x, z: r.z }; ev = r.event; }
  assert.equal(ev, 'stairs');
  assert.equal(route.linkId, 'main');
  assert.equal(pos.floor, 0, 'controls never change floor themselves');
  assert.ok(Math.hypot(pos.x - 15.5, pos.z - 18.5) <= 0.3);
});

test('closed floor is unreachable', () => {
  assert.equal(planRoute(CASE.MAP, { floor: 0, x: 14, z: 15 }, { floor: 1, x: 19.5, z: 14 }, { floorsOpen: [0] }), null);
});

test('nearestFree moves a point out of furniture', () => {
  const g = buildGrid(M, 0);
  assert.deepEqual(nearestFree(g, 2, 2), { x: 2, z: 2 });
  const p = nearestFree(g, 0.1, 2); // inside the west wall
  assert.ok(p && !isBlocked(g, p.x, p.z));
  assert.equal(nearestFree(g, -5, -5, 1), null);
});

test('navOptions follows the phase floors and passage knowledge', () => {
  const S = createState(CASE);
  S.players.p1 = { role: 'yujin' };
  assert.deepEqual(navOptions(S, CASE, 'p1', 0), { floorsOpen: [0], passageOpen: false });
  S.floorsOpen = [0, 1];
  S.passageKnown.p1 = true;
  assert.deepEqual(navOptions(S, CASE, 'p1', 0), { floorsOpen: [0, 1], passageOpen: true });
  const knower = Object.keys(CASE.ROLES).find(r => CASE.ROLES[r].knowsPassage);
  S.players.p2 = { role: knower };
  assert.equal(navOptions(S, CASE, 'p2', 0).passageOpen, true);
  assert.equal(navOptions(null, CASE, 'p1', 1).floorsOpen[0], 1);
});

test('an interact target across a wall is not reached through the wall', () => {
  const g = buildGrid(M, 0);
  const from = { floor: 0, x: 3.15, z: 3.0 }, goal = { floor: 0, x: 4.7, z: 3.0 }; // 1.55 m apart, wall between
  const route = planRoute(M, from, goal, { floorsOpen: [0] }, ARRIVE);
  const first = stepRoute(route, g, from, 1 / 30);
  assert.equal(first.event, null, 'keeps walking instead of arriving through the wall');
  let pos = { ...from, x: first.x, z: first.z }, ev = null;
  for (let k = 0; k < 300 && !ev; k++) { const r = stepRoute(route, g, pos, 1 / 30); pos = { ...pos, x: r.x, z: r.z }; ev = r.event; }
  assert.equal(ev, 'arrive');
  assert.ok(pos.x >= 4, `arrived on the goal's side of the wall (x ${pos.x.toFixed(2)})`);
});

test('every case interact target lies in its own room, so it can be arrived at', () => {
  const MAP = CASE.MAP;
  const floorOf = id => MAP.rooms.find(r => r.id === id).floor;
  const roomOf = (room, x, z) => planRoute(MAP, { floor: floorOf(room), x, z }, { floor: floorOf(room), x, z }, { floorsOpen: [0, 1] }, ARRIVE).goal.room;
  for (const it of CASE.ITEMS) assert.equal(roomOf(it.room, it.pos[0], it.pos[2]), it.room, `item ${it.id}`);
  for (const s of [...MAP.stairs, ...MAP.passages]) for (const e of [s.a, s.b]) assert.equal(roomOf(e.room, e.x, e.z), e.room, `${s.id} end in ${e.room}`);
});

test('keys: WASD and arrows map like the joystick, diagonals normalised, opposites cancel', async () => {
  const { keysVector, isMoveKey } = await import('../src/core/walk.js');
  const v = (...k) => keysVector(new Set(k));
  assert.deepEqual(v('KeyW'), { x: 0, z: -1, mag: 1 });
  assert.deepEqual(v('ArrowRight'), { x: 1, z: 0, mag: 1 });
  const d = v('KeyW', 'KeyD');
  assert.ok(near(Math.hypot(d.x, d.z), 1) && d.x > 0 && d.z < 0, 'diagonal is unit length');
  assert.deepEqual(v('KeyW', 'ArrowUp'), { x: 0, z: -1, mag: 1 }, 'same direction twice is not faster');
  assert.equal(v('KeyA', 'KeyD').mag, 0);
  assert.equal(v('KeyE').mag, 0);
  assert.ok(isMoveKey('ArrowDown') && !isMoveKey('Space'));
});

test('keyboard interact: nearest target within reach and in the same room only', async () => {
  const { nearestTarget } = await import('../src/core/walk.js');
  const pos = { floor: 0, x: 3.15, z: 3.0 };
  const through = { id: 'b', x: 4.7, z: 3.0 };      // 1.55 m, but in room B behind the wall
  const far = { id: 'far', x: 1.0, z: 1.0 };        // same room, > 1.6 m
  const close = { id: 'close', x: 2.4, z: 2.4 };    // same room, ~0.96 m
  const closer = { id: 'closer', x: 3.0, z: 2.5 };  // same room, ~0.52 m
  assert.equal(nearestTarget(M, pos, [through, far]), null);
  assert.equal(nearestTarget(M, pos, [through, far, close]).id, 'close');
  assert.equal(nearestTarget(M, pos, [close, closer, through]).id, 'closer');
});

test('tap on the 1F stairs from every post-intro hall spot routes around the staircase', async () => {
  const { REACH } = await import('../src/core/rules.js');
  const MAP = CASE.MAP;
  const grids = [];
  const gridOf = f => (grids[f] ??= buildGrid(MAP, f));
  const g = gridOf(0);
  const st = MAP.stairs.find(s => s.id === 'main').a;
  const hall = MAP.rooms.find(r => r.id === 'hall').rect;
  const cx = (hall[0] + hall[2]) / 2, cz = (hall[1] + hall[3]) / 2 - 1; // rules.js hallSpots
  const walkTo = (from, withGrid) => {
    const route = planRoute(MAP, from, { floor: 0, x: st.x, z: st.z }, { floorsOpen: [0, 1] }, ARRIVE, withGrid ? gridOf : null);
    let pos = { ...from }, ev = null;
    for (let k = 0; k < 900 && !ev; k++) { const r = stepRoute(route, g, pos, 1 / 30); pos = { ...pos, x: r.x, z: r.z }; ev = r.event; }
    return { ev, pos };
  };
  let stuckBefore = 0;
  for (let n = 1; n <= 6; n++) {
    for (let i = 0; i < n; i++) {
      const spot = { x: cx + (i - (n - 1) / 2), z: cz };
      // controls steps a player spawned inside furniture (the grand clock at 6 players) out first
      const from = { floor: 0, ...(isBlocked(g, spot.x, spot.z) ? nearestFree(g, spot.x, spot.z, 1.5) : spot) };
      if (walkTo(from, false).ev === 'stuck') stuckBefore++;
      const { ev, pos } = walkTo(from, true);
      assert.equal(ev, 'arrive', `spot ${i + 1}/${n} at x ${from.x}`);
      assert.ok(Math.hypot(pos.x - st.x, pos.z - st.z) <= REACH, 'the host accepts useStairs from there');
      assert.equal(roomAt(MAP, 0, pos.x, pos.z), 'hall');
    }
  }
  assert.ok(stuckBefore > 0, 'the straight-line walk did stall on the staircase (regression guard)');
});

test('gridPath goes around a solid and never through it; a clear line stays one straight leg', async () => {
  const { gridPath, clear } = await import('../src/core/walk.js');
  const map = { ...M, solids: [{ floor: 0, rect: [1.5, 1.5, 2.5, 3] }] };
  const g = buildGrid(map, 0);
  assert.deepEqual(gridPath(g, 1, 1, 3, 1), [{ x: 3, z: 1 }], 'clear line: no detour');
  assert.ok(!clear(g, 1, 2.25, 3, 2.25), 'the solid blocks the straight line');
  const pts = gridPath(g, 1, 2.25, 3, 2.25);
  assert.ok(pts && pts.length >= 2, 'detour has waypoints');
  let x = 1, z = 2.25;
  for (const p of pts) { assert.ok(clear(g, x, z, p.x, p.z), `leg to (${p.x}, ${p.z}) is clear`); x = p.x; z = p.z; }
  assert.deepEqual(pts[pts.length - 1], { x: 3, z: 2.25 });
});
