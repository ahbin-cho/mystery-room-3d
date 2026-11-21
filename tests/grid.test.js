import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGrid, isBlocked, moveWithSlide } from '../src/core/grid.js';
import { M } from './fixture.js';

test('wall blocks, door opens', () => {
  const g = buildGrid(M, 0);
  assert.equal(isBlocked(g, 4, 0.5), true);
  assert.equal(isBlocked(g, 4, 2), false);
});

test('outside is blocked', () => {
  assert.equal(isBlocked(buildGrid(M, 0), -1, 2), true);
});

test('moveWithSlide slides along wall', () => {
  const p = moveWithSlide(buildGrid(M, 0), 2.9, 1, 0.5, 0.3);
  assert.ok(p.x < 3.5 - 0.3 + 0.01 && p.z > 1);
});

test('moveWithSlide passes through door', () => {
  const p = moveWithSlide(buildGrid(M, 0), 3, 2, 2, 0);
  assert.equal(p.x, 5);
});

test('solids block', () => {
  const m2 = { ...M, solids: [{ floor: 0, rect: [1, 1, 2, 2] }] };
  assert.equal(isBlocked(buildGrid(m2, 0), 1.5, 1.5), true);
});
