// The block walls (world.js) and the collision grid (grid.js) both open doors through doorCells().
// These tests pin that contract: the wall cells the grid opens are exactly the doorCells openings,
// and world.js's world-origin call (ox = oz = 0) names the same cells.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGrid } from '../src/core/grid.js';
import { doorCells } from '../src/core/map.js';
import { CASE } from '../src/cases/owl-manor.js';

const M = { ...CASE.MAP, solids: [] };
const byId = new Map(M.rooms.map(r => [r.id, r]));
const key = (i, j) => `${i},${j}`;

for (const floor of M.floors.map(f => f.id)) {
  test(`floor ${floor}: buildGrid opens exactly the doorCells cells in the walls`, () => {
    const g = buildGrid(M, floor);
    // room-boundary (wall) cells of this floor, in grid coordinates
    const wall = new Set();
    for (const r of M.rooms.filter(x => x.floor === floor)) {
      const i0 = Math.round((r.rect[0] - g.ox) / g.cell), i1 = Math.round((r.rect[2] - g.ox) / g.cell) - 1;
      const j0 = Math.round((r.rect[1] - g.oz) / g.cell), j1 = Math.round((r.rect[3] - g.oz) / g.cell) - 1;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++)
        if (i === i0 || i === i1 || j === j0 || j === j1) wall.add(key(i, j));
    }
    const openedByGrid = new Set([...wall].filter(k => { const [i, j] = k.split(',').map(Number); return g.data[j * g.w + i] === 0; }));
    const expected = new Set();
    for (const d of M.doors) {
      const a = byId.get(d.a), b = byId.get(d.b);
      if (a.floor !== floor) continue;
      const dc = doorCells(d, a, b, g.cell, g.ox, g.oz);
      assert.ok(dc, `door ${d.a}-${d.b} is on a shared wall`);
      assert.equal(dc.open.length, 2 * Math.round(d.width / g.cell), `door ${d.a}-${d.b} opens width x 2 wall cells`);
      dc.open.forEach(([i, j]) => { assert.ok(wall.has(key(i, j)), `door ${d.a}-${d.b} cell ${i},${j} is a wall cell`); expected.add(key(i, j)); });
      dc.posts.forEach(([i, j]) => assert.equal(g.data[j * g.w + i], 1, `door ${d.a}-${d.b} post ${i},${j} stays solid`));
    }
    assert.deepEqual([...openedByGrid].sort(), [...expected].sort());
  });
}

test('world-origin doorCells (as world.js calls it) names the same cells as the grid-origin call', () => {
  const g = buildGrid(M, 0);
  const si = Math.round(g.ox / g.cell), sj = Math.round(g.oz / g.cell);
  assert.equal(si * g.cell, g.ox);
  assert.equal(sj * g.cell, g.oz);
  for (const d of M.doors) {
    const a = byId.get(d.a), b = byId.get(d.b);
    const world = doorCells(d, a, b, M.cell); // world.js: origin (0, 0)
    const grid = doorCells(d, a, b, M.cell, g.ox, g.oz);
    assert.deepEqual(world.open.map(([i, j]) => [i - si, j - sj]), grid.open);
    assert.deepEqual(world.posts.map(([i, j]) => [i - si, j - sj]), grid.posts);
  }
});

test('doorCells returns null for a door that is not on a shared wall', () => {
  const a = { floor: 0, rect: [0, 0, 4, 4] }, b = { floor: 0, rect: [4, 0, 8, 4] };
  assert.equal(doorCells({ x: 2, z: 2, width: 2 }, a, b, 0.5), null);
  assert.equal(doorCells({ x: 4, z: 2, width: 2 }, a, b, 0.5).o, 'v');
});
