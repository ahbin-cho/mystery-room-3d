// Map data helpers: pure logic, no DOM / three.js.
const EPS = 1e-6;

export function roomAt(map, floor, x, z) {
  for (const r of map.rooms) {
    if (r.floor !== floor) continue;
    const [x0, z0, x1, z1] = r.rect;
    if (x >= x0 && x < x1 && z >= z0 && z < z1) return r.id;
  }
  return null;
}

// Where a door sits on the wall shared by rooms a and b.
// Returns 'v' (wall runs along z, at x), 'h' (wall runs along x, at z) or null.
export function doorOrientation(door, a, b) {
  if (!a || !b || a.floor !== b.floor) return null;
  const near = (p, q) => Math.abs(p - q) < EPS;
  const within = (v, lo, hi) => v >= lo - EPS && v <= hi + EPS;
  const zLo = Math.max(a.rect[1], b.rect[1]), zHi = Math.min(a.rect[3], b.rect[3]);
  const xLo = Math.max(a.rect[0], b.rect[0]), xHi = Math.min(a.rect[2], b.rect[2]);
  if ((near(a.rect[2], b.rect[0]) && near(door.x, a.rect[2])) ||
      (near(b.rect[2], a.rect[0]) && near(door.x, a.rect[0]))) {
    if (zHi > zLo && within(door.z, zLo, zHi)) return 'v';
  }
  if ((near(a.rect[3], b.rect[1]) && near(door.z, a.rect[3])) ||
      (near(b.rect[3], a.rect[1]) && near(door.z, a.rect[1]))) {
    if (xHi > xLo && within(door.x, xLo, xHi)) return 'h';
  }
  return null;
}

export function validateMap(map) {
  const errors = [];
  const byId = new Map();
  for (const r of map.rooms) {
    if (byId.has(r.id)) errors.push(`duplicate room id: ${r.id}`);
    else byId.set(r.id, r);
  }
  const rooms = map.rooms;
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const p = rooms[i], q = rooms[j];
      if (p.floor !== q.floor) continue;
      const ox = Math.min(p.rect[2], q.rect[2]) - Math.max(p.rect[0], q.rect[0]);
      const oz = Math.min(p.rect[3], q.rect[3]) - Math.max(p.rect[1], q.rect[1]);
      if (ox > EPS && oz > EPS) errors.push(`rooms overlap: ${p.id} and ${q.id}`);
    }
  }
  for (const d of map.doors || []) {
    const a = byId.get(d.a), b = byId.get(d.b);
    if (!a || !b) errors.push(`door references unknown room: ${d.a}-${d.b}`);
    else if (!doorOrientation(d, a, b)) {
      errors.push(`door (${d.x},${d.z}) is not on the wall shared by ${d.a} and ${d.b}`);
    }
  }
  for (const key of ['stairs', 'passages']) {
    for (const s of map[key] || []) {
      const a = byId.get(s.a.room), b = byId.get(s.b.room);
      if (!a || !b) { errors.push(`${key} ${s.id} references unknown room`); continue; }
      if (key === 'stairs' && a.floor === b.floor) {
        errors.push(`stairs ${s.id} ends are on the same floor (${a.floor})`);
      }
    }
  }
  return errors;
}
