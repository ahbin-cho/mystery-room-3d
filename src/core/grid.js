// Collision grid: Uint8Array, 0 = free, 1 = blocked. One grid per floor.
import { doorCells } from './map.js';

export function buildGrid(map, floor) {
  const cell = map.cell;
  let ox = Infinity, oz = Infinity, mx = -Infinity, mz = -Infinity;
  for (const r of map.rooms) {
    ox = Math.min(ox, r.rect[0]); oz = Math.min(oz, r.rect[1]);
    mx = Math.max(mx, r.rect[2]); mz = Math.max(mz, r.rect[3]);
  }
  const w = Math.max(1, Math.round((mx - ox) / cell));
  const h = Math.max(1, Math.round((mz - oz) / cell));
  const data = new Uint8Array(w * h).fill(1);
  const toCell = (v, o) => Math.round((v - o) / cell);
  const rooms = new Map(map.rooms.map(r => [r.id, r]));

  for (const r of map.rooms) {
    if (r.floor !== floor) continue;
    const i0 = toCell(r.rect[0], ox), i1 = toCell(r.rect[2], ox) - 1;
    const j0 = toCell(r.rect[1], oz), j1 = toCell(r.rect[3], oz) - 1;
    for (let j = j0 + 1; j < j1; j++) for (let i = i0 + 1; i < i1; i++) data[j * w + i] = 0;
  }

  for (const d of map.doors || []) {
    const a = rooms.get(d.a), b = rooms.get(d.b);
    if (!a || a.floor !== floor) continue;
    const dc = doorCells(d, a, b, cell, ox, oz);
    if (!dc) continue;
    for (const [i, j] of dc.open) data[j * w + i] = 0;
  }

  for (const s of map.solids || []) {
    if (s.floor !== floor) continue;
    const i0 = Math.floor((s.rect[0] - ox) / cell + 1e-6), i1 = Math.ceil((s.rect[2] - ox) / cell - 1e-6) - 1;
    const j0 = Math.floor((s.rect[1] - oz) / cell + 1e-6), j1 = Math.ceil((s.rect[3] - oz) / cell - 1e-6) - 1;
    for (let j = Math.max(0, j0); j <= Math.min(h - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(w - 1, i1); i++) data[j * w + i] = 1;
  }
  return { cell, ox, oz, w, h, data };
}

function cellBlocked(g, i, j) {
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return true;
  return g.data[j * g.w + i] === 1;
}

// Circle approximated by its bounding square; blocked if any overlapped cell is blocked.
export function isBlocked(g, x, z, r = 0.3) {
  const i0 = Math.floor((x - r - g.ox) / g.cell), i1 = Math.floor((x + r - g.ox) / g.cell);
  const j0 = Math.floor((z - r - g.oz) / g.cell), j1 = Math.floor((z + r - g.oz) / g.cell);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (cellBlocked(g, i, j)) return true;
  return false;
}

export function moveWithSlide(g, x, z, dx, dz, r = 0.3) {
  if (!isBlocked(g, x + dx, z + dz, r)) return { x: x + dx, z: z + dz };
  let nx = x, nz = z;
  if (!isBlocked(g, x + dx, z, r)) nx = x + dx;
  if (!isBlocked(g, nx, z + dz, r)) nz = z + dz;
  return { x: nx, z: nz };
}
