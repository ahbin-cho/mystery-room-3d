// Furniture (MAP.solids) must never cut off a door, a stair/passage end or an evidence spot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGrid, isBlocked } from '../src/core/grid.js';
import { CASE } from '../src/cases/owl-manor.js';

const M = CASE.MAP;
const R = 0.3, STEP = 0.25;
const floorOf = id => M.rooms.find(r => r.id === id).floor;

function cellBlocked(g, i, j) {
  return i < 0 || j < 0 || i >= g.w || j >= g.h || g.data[j * g.w + i] === 1;
}
// Axis-aligned box swept by the player's bounding square is free.
function boxFree(g, x0, z0, x1, z1) {
  const i0 = Math.floor((Math.min(x0, x1) - R - g.ox) / g.cell), i1 = Math.floor((Math.max(x0, x1) + R - g.ox) / g.cell);
  const j0 = Math.floor((Math.min(z0, z1) - R - g.oz) / g.cell), j1 = Math.floor((Math.max(z0, z1) + R - g.oz) / g.cell);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (cellBlocked(g, i, j)) return false;
  return true;
}

// Flood fill over a 0.25 m lattice of player positions.
function flood(g, sx, sz) {
  const nx = Math.round(g.w * g.cell / STEP) + 1, nz = Math.round(g.h * g.cell / STEP) + 1;
  const seen = new Uint8Array(nx * nz);
  const pos = (i, j) => [g.ox + i * STEP, g.oz + j * STEP];
  const si = Math.round((sx - g.ox) / STEP), sj = Math.round((sz - g.oz) / STEP);
  assert.ok(!isBlocked(g, ...pos(si, sj), R), `flood start (${sx},${sz}) is blocked`);
  const q = [[si, sj]];
  seen[sj * nx + si] = 1;
  while (q.length) {
    const [i, j] = q.pop();
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz || seen[b * nx + a]) continue;
      const [x, z] = pos(a, b);
      if (isBlocked(g, x, z, R)) continue;
      seen[b * nx + a] = 1;
      q.push([a, b]);
    }
  }
  const reachedNear = (x, z, within) => {
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      if (!seen[j * nx + i]) continue;
      const [px, pz] = pos(i, j);
      if (Math.hypot(px - x, pz - z) <= within) return true;
    }
    return false;
  };
  const reach = (x, z) => {
    if (isBlocked(g, x, z, R)) return false;
    const fi = (x - g.ox) / STEP, fj = (z - g.oz) / STEP;
    for (const i of [Math.floor(fi), Math.ceil(fi)]) for (const j of [Math.floor(fj), Math.ceil(fj)]) {
      if (i < 0 || j < 0 || i >= nx || j >= nz || !seen[j * nx + i]) continue;
      const [px, pz] = pos(i, j);
      if (boxFree(g, px, pz, x, z)) return true;
    }
    return false;
  };
  return { reach, reachedNear };
}

function targets(floor) {
  const out = [];
  for (const d of M.doors) if (floorOf(d.a) === floor) out.push([`door ${d.a}-${d.b}`, d.x, d.z]);
  for (const s of [...M.stairs, ...M.passages]) for (const e of [s.a, s.b])
    if (floorOf(e.room) === floor) out.push([`${s.id}:${e.room}`, e.x, e.z]);
  return out;
}

test('furniture adds solids on both floors', () => {
  assert.ok(M.solids.filter(s => s.floor === 0).length >= 20);
  assert.ok(M.solids.filter(s => s.floor === 1).length >= 10);
  M.solids.forEach(s => s.rect.forEach(v => assert.equal(v * 2, Math.round(v * 2), 'solids sit on the 0.5 m grid')));
});

for (const [floor, room] of [[0, 'hall'], [1, 'corridor']]) {
  test(`floor ${floor}: doors, stair/passage ends and evidence are reachable from the ${room}`, () => {
    const g = buildGrid(M, floor);
    const r = M.rooms.find(x => x.id === room).rect;
    const { reach, reachedNear } = flood(g, Math.round((r[0] + r[2]) / 2 * 2) / 2 - 1, Math.round((r[1] + r[3]) / 2 * 2) / 2);
    for (const [name, x, z] of targets(floor)) assert.ok(reach(x, z), `${name} at (${x}, ${z}) is not reachable`);
    // Evidence: never inside furniture, and a player can get within arm's reach (0.5 m) of it.
    // (Wall-hung items like the party photo sit closer to the wall than the player radius allows.)
    for (const it of CASE.ITEMS.filter(i => floorOf(i.room) === floor)) {
      const [x, , z] = it.pos;
      const inside = M.solids.find(s => s.floor === floor && x > s.rect[0] && x < s.rect[2] && z > s.rect[1] && z < s.rect[3]);
      assert.ok(!inside, `item ${it.id} is inside the ${inside && inside.prop} solid`);
      assert.ok(reach(x, z) || reachedNear(x, z, 0.5), `item ${it.id} at (${x}, ${z}) is not reachable`);
    }
  });
}
