import test from 'node:test';
import assert from 'node:assert/strict';
import { joystickVector, nearestFree, planRoute, stepRoute, navOptions, SPEED, ARRIVE } from '../src/core/walk.js';
import { buildGrid, isBlocked } from '../src/core/grid.js';
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
  const route = { goal: { floor: 0, x: 6, z: 2 }, reach: 0, steps: [{ floor: 0, x: 6, z: 3.3, kind: 'walk' }], i: 0, best: Infinity, stuck: 0 };
  let pos = { floor: 0, x: 2, z: 3.3 }, ev = null, t = 0;
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
