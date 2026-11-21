// Room-graph pathfinding across doors, stairs and the secret passage.
// Pure logic, no DOM / three.js.
import { roomAt } from './map.js';

// Returns Step[] ({floor,x,z,kind,id?}) ending at `to`, or null if unreachable.
export function findPath(map, from, to, opts = {}) {
  const floorsOpen = opts.floorsOpen || [0];
  const passageOpen = !!opts.passageOpen;
  const floorOf = new Map(map.rooms.map(r => [r.id, r.floor]));
  if (!floorsOpen.includes(from.floor) || !floorsOpen.includes(to.floor)) return null;
  const start = roomAt(map, from.floor, from.x, from.z);
  const goal = roomAt(map, to.floor, to.x, to.z);
  if (start === null || goal === null) return null;
  const dest = { floor: to.floor, x: to.x, z: to.z, kind: 'walk' };
  if (start === goal) return [dest];

  // Edges in data order: doors, then stairs, then passage.
  const edges = new Map();
  const add = (from_, to_, steps) => {
    if (!edges.has(from_)) edges.set(from_, []);
    edges.get(from_).push({ to: to_, steps });
  };
  for (const d of map.doors || []) {
    const fa = floorOf.get(d.a), fb = floorOf.get(d.b);
    if (!floorsOpen.includes(fa) || !floorsOpen.includes(fb)) continue;
    const step = { floor: fa, x: d.x, z: d.z, kind: 'walk' };
    add(d.a, d.b, [step]);
    add(d.b, d.a, [{ ...step }]);
  }
  const link = (list, kind) => {
    for (const s of list || []) {
      const fa = floorOf.get(s.a.room), fb = floorOf.get(s.b.room);
      if (!floorsOpen.includes(fa) || !floorsOpen.includes(fb)) continue;
      const mk = (near, nearFloor, far, farFloor) => [
        { floor: nearFloor, x: near.x, z: near.z, kind: 'walk' },
        { floor: farFloor, x: far.x, z: far.z, kind, id: s.id },
      ];
      add(s.a.room, s.b.room, mk(s.a, fa, s.b, fb));
      add(s.b.room, s.a.room, mk(s.b, fb, s.a, fa));
    }
  };
  link(map.stairs, 'stairs');
  if (passageOpen) link(map.passages, 'passage');

  const prev = new Map([[start, null]]);
  const queue = [start];
  for (let i = 0; i < queue.length && !prev.has(goal); i++) {
    for (const e of edges.get(queue[i]) || []) {
      if (prev.has(e.to)) continue;
      prev.set(e.to, { room: queue[i], steps: e.steps });
      queue.push(e.to);
    }
  }
  if (!prev.has(goal)) return null;

  const chunks = [];
  for (let r = goal; prev.get(r); r = prev.get(r).room) chunks.push(prev.get(r).steps);
  const path = chunks.reverse().flat();
  path.push(dest);
  return path;
}
