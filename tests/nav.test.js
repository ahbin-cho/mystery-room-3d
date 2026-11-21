import test from 'node:test';
import assert from 'node:assert/strict';
import { findPath } from '../src/core/nav.js';
import { CASE } from '../src/cases/owl-manor.js';

const M = CASE.MAP;
const hall = { floor: 0, x: 14, z: 15 };
const hall2 = { floor: 0, x: 13, z: 12 };
const kitchen = { floor: 0, x: 11, z: 4 };
const study = { floor: 0, x: 20, z: 14 };
const conservatory = { floor: 0, x: 4, z: 4 };
const master = { floor: 1, x: 19.5, z: 14 };
const O = { floorsOpen: [0, 1], passageOpen: false };

test('same room is direct', () => {
  const p = findPath(M, hall, hall2, O);
  assert.equal(p.length, 1);
  assert.deepEqual(p[0], { kind: 'walk', ...hall2 });
});

test('hall to kitchen goes through the dining door', () => {
  const p = findPath(M, hall, kitchen, O);
  assert.ok(p.some(s => s.x === 11 && s.z === 12), 'hall-dining door');
  assert.ok(p.some(s => s.x === 9.5 && s.z === 8), 'dining-kitchen door');
  assert.deepEqual(p[p.length - 1], { kind: 'walk', ...kitchen });
});

test('to master needs stairs', () => {
  const p = findPath(M, hall, master, O);
  const st = p.find(s => s.kind === 'stairs');
  assert.ok(st);
  assert.equal(st.id, 'main');
  assert.equal(st.floor, 1);
  assert.deepEqual([st.x, st.z], [14, 18.5]);
  const i = p.indexOf(st);
  assert.deepEqual(p[i - 1], { floor: 0, x: 15.5, z: 18.5, kind: 'walk' });
  assert.deepEqual(p[p.length - 1], { kind: 'walk', ...master });
});

test('findPath respects floorsOpen', () => {
  assert.equal(findPath(M, hall, master, { floorsOpen: [0], passageOpen: false }), null);
});

test('study to conservatory uses passage only when open', () => {
  const open = findPath(M, study, conservatory, { floorsOpen: [0, 1], passageOpen: true });
  const ps = open.find(s => s.kind === 'passage');
  assert.ok(ps);
  assert.equal(ps.id, 'secret');
  assert.deepEqual([ps.x, ps.z], [1.5, 1.5]);
  const closed = findPath(M, study, conservatory, O);
  assert.ok(closed);
  assert.ok(!closed.some(s => s.kind === 'passage'));
  assert.ok(closed.some(s => s.x === 11 && s.z === 12));
});

test('points outside rooms give null', () => {
  assert.equal(findPath(M, { floor: 0, x: 50, z: 50 }, hall, O), null);
  assert.equal(findPath(M, hall, { floor: 0, x: 50, z: 50 }, O), null);
});
