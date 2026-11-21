import test from 'node:test';
import assert from 'node:assert/strict';
import { roomAt, validateMap } from '../src/core/map.js';
import { M } from './fixture.js';

test('roomAt finds room', () => {
  assert.equal(roomAt(M, 0, 1, 1), 'A');
  assert.equal(roomAt(M, 0, 5, 1), 'B');
  assert.equal(roomAt(M, 0, 9, 9), null);
});

test('validateMap flags door not on shared wall', () => {
  const bad = { ...M, doors: [{ a: 'A', b: 'B', x: 2, z: 2, width: 1 }] };
  assert.ok(validateMap(bad).length > 0);
  assert.deepEqual(validateMap(M), []);
});

test('validateMap flags overlapping rooms', () => {
  const bad = { ...M, rooms: [M.rooms[0], { ...M.rooms[1], rect: [3, 0, 8, 4] }] };
  assert.ok(validateMap(bad).length >= 1);
});

test('validateMap ignores overlap across floors', () => {
  const up = { ...M.rooms[1], id: 'C', floor: 1, rect: [0, 0, 4, 4] };
  const m = { ...M, rooms: [...M.rooms, up] };
  assert.deepEqual(validateMap(m), []);
});

test('validateMap flags duplicate room ids', () => {
  const bad = { ...M, rooms: [M.rooms[0], { ...M.rooms[1], id: 'A' }] };
  assert.ok(validateMap(bad).length >= 1);
});

test('validateMap flags stairs on same floor', () => {
  const bad = { ...M, stairs: [{ id: 's', a: { room: 'A', x: 1, z: 1 }, b: { room: 'B', x: 5, z: 1 } }] };
  assert.ok(validateMap(bad).length >= 1);
});
