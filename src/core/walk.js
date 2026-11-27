// Movement maths for the player controls (src/controls.js): joystick vector and route following.
// Pure logic, no DOM / three.js. A route is a findPath() Step[] walked waypoint by waypoint with
// moveWithSlide, so furniture between waypoints is slid around.
import { findPath } from './nav.js';
import { roomAt } from './map.js';
import { isBlocked, moveWithSlide } from './grid.js';
import { canUsePassage } from './rules.js';

export const SPEED = 3.6;        // m/s at full stick / while following a route
export const STICK_RADIUS = 60;  // px, knob travel
export const STICK_DEAD = 0.12;  // fraction of the radius ignored (thumb jitter)
export const ARRIVE = 1.6;       // m, interact targets fire within this distance
export const WAYPOINT = 0.3;     // m, an intermediate waypoint counts as passed within this
export const FINISH = 0.1;       // m, the final floor-tap point counts as reached within this
export const STUCK_SEC = 1.0;    // s without getting closer to the current waypoint → give up
const PROGRESS = 0.05;           // m closer that counts as progress
const BODY = 0.3;                // collision radius (grid default)

// Screen drag (dx right, dy down, px) → world move direction on the fixed north-looking camera:
// screen up = -z (north), screen right = +x. Returns the clamped knob offset too.
export function joystickVector(dx, dy, radius = STICK_RADIUS, dead = STICK_DEAD) {
  const len = Math.hypot(dx, dy);
  const k = len > radius ? radius / len : 1;
  const kx = dx * k, ky = dy * k;
  const m = Math.min(1, len / radius);
  if (m <= dead) return { x: 0, z: 0, mag: 0, kx, ky };
  const mag = (m - dead) / (1 - dead);
  return { x: (dx / len) * mag, z: (dy / len) * mag, mag, kx, ky };
}

// Held keyboard keys (KeyboardEvent.code) → world move direction, same mapping as the joystick:
// W / ArrowUp = north (-z), S / ArrowDown = south, A / ArrowLeft = west (-x), D / ArrowRight = east.
// Diagonals are normalised, so full speed is never exceeded; opposite keys cancel.
const KEY_DIRS = { KeyW: 'n', ArrowUp: 'n', KeyS: 's', ArrowDown: 's', KeyA: 'w', ArrowLeft: 'w', KeyD: 'e', ArrowRight: 'e' };
export const isMoveKey = code => code in KEY_DIRS;
export function keysVector(held) {
  let n = false, s = false, w = false, e = false; // W and ArrowUp together still count once
  for (const code of held) {
    const d = KEY_DIRS[code];
    if (d === 'n') n = true; else if (d === 's') s = true; else if (d === 'w') w = true; else if (d === 'e') e = true;
  }
  const x = (e ? 1 : 0) - (w ? 1 : 0), z = (s ? 1 : 0) - (n ? 1 : 0);
  if (!x && !z) return { x: 0, z: 0, mag: 0 };
  const k = x && z ? Math.SQRT1_2 : 1;
  return { x: x * k, z: z * k, mag: 1 };
}

// Interact target for the keyboard: the nearest of `targets` ({x, z, ...}) on pos's floor that is
// within `reach` AND in the same room as the player (never through a wall). null if none.
export function nearestTarget(map, pos, targets, reach = ARRIVE) {
  const here = roomAt(map, pos.floor, pos.x, pos.z);
  if (here === null) return null;
  let best = null, bd = reach;
  for (const t of targets) {
    const d = Math.hypot(t.x - pos.x, t.z - pos.z);
    if (d > bd || roomAt(map, pos.floor, t.x, t.z) !== here) continue;
    bd = d; best = t;
  }
  return best;
}

// Nearest walkable point to (x, z) within `maxR` m (searching outward in half-cell rings), or null.
export function nearestFree(g, x, z, maxR = 1.0, r = BODY) {
  if (!isBlocked(g, x, z, r)) return { x, z };
  const step = g.cell / 2;
  for (let d = step; d <= maxR + 1e-6; d += step) {
    let best = null, bd = Infinity;
    for (let a = 0; a < 16; a++) {
      const px = x + Math.cos(a * Math.PI / 8) * d, pz = z + Math.sin(a * Math.PI / 8) * d;
      if (isBlocked(g, px, pz, r)) continue;
      const dd = Math.hypot(px - x, pz - z);
      if (dd < bd) { bd = dd; best = { x: px, z: pz }; }
    }
    if (best) return best;
  }
  return null;
}

// ── in-room grid pathfinding ──
// Nodes are the grid's cell CORNERS: a body (radius BODY ≤ one cell) centred on a corner overlaps the
// 2×2 cells around it, which is also how a player passes a door (door edges sit on cell lines).
// A* over 8-connected corners (no corner cutting), then string-pulled with clear() so the walk stays
// straight wherever it can.
const LOS_STEP = 0.1; // m between line-of-sight samples

// true when a body can walk the straight segment a → b on grid g.
export function clear(g, ax, az, bx, bz, r = BODY) {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / LOS_STEP));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    if (isBlocked(g, ax + (bx - ax) * t, az + (bz - az) * t, r)) return false;
  }
  return true;
}

// Walkable corner nearest to (x, z) from which (x, z) itself is in straight reach, within maxR m;
// `ok(cx, cz)` filters candidates (e.g. same room). Returns [i, j] or null.
function snapCorner(g, x, z, maxR, ok, needLine) {
  const ci = Math.round((x - g.ox) / g.cell), cj = Math.round((z - g.oz) / g.cell);
  const R = Math.ceil(maxR / g.cell);
  let best = null, bd = Infinity;
  for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
    if (i < 0 || j < 0 || i > g.w || j > g.h) continue;
    const cx = g.ox + i * g.cell, cz = g.oz + j * g.cell;
    const d = Math.hypot(cx - x, cz - z);
    if (d > maxR || d >= bd || isBlocked(g, cx, cz) || (ok && !ok(cx, cz))) continue;
    if (needLine && !clear(g, cx, cz, x, z)) continue;
    bd = d; best = [i, j];
  }
  return best;
}

// Waypoints [{x, z}, …] from (ax, az) to (bx, bz) around furniture on grid g, ending at (bx, bz)
// itself (or, if that point is inside furniture, at the nearest walkable corner `ok` accepts).
// Returns null if no way exists (the caller then keeps the straight line).
export function gridPath(g, ax, az, bx, bz, ok = null) {
  if (clear(g, ax, az, bx, bz)) return [{ x: bx, z: bz }];
  const W = g.w + 1, H = g.h + 1; // corners
  const s = snapCorner(g, ax, az, 1.0, null, true) ?? snapCorner(g, ax, az, 1.0, null, false);
  const endFree = !isBlocked(g, bx, bz);
  const e = snapCorner(g, bx, bz, endFree ? 1.0 : 2.0, ok, endFree) ?? (endFree ? null : snapCorner(g, bx, bz, 2.5, ok, false));
  if (!s || !e) return null;
  const idx = (i, j) => j * W + i;
  const px = i => g.ox + i * g.cell, pz = j => g.oz + j * g.cell;
  const free = new Uint8Array(W * H); // 0 unknown, 1 free, 2 blocked
  const isFree = (i, j) => {
    if (i < 0 || j < 0 || i >= W || j >= H) return false;
    const k = idx(i, j);
    if (!free[k]) free[k] = isBlocked(g, px(i), pz(j)) ? 2 : 1;
    return free[k] === 1;
  };
  const start = idx(s[0], s[1]), goal = idx(e[0], e[1]);
  const gs = new Float64Array(W * H).fill(Infinity);
  const came = new Int32Array(W * H).fill(-1);
  const closed = new Uint8Array(W * H);
  const h = k => Math.hypot((k % W) - e[0], Math.floor(k / W) - e[1]);
  const open = [start]; // small grids (≈ 2 000 corners): a linear-scan open list is fast enough
  const fOf = new Float64Array(W * H).fill(Infinity);
  gs[start] = 0; fOf[start] = h(start);
  let found = false;
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (fOf[open[k]] < fOf[open[bi]]) bi = k;
    const cur = open[bi];
    open[bi] = open[open.length - 1]; open.pop();
    if (cur === goal) { found = true; break; }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const ci = cur % W, cj = Math.floor(cur / W);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj;
      if (!isFree(ni, nj)) continue;
      if (di && dj && (!isFree(ci + di, cj) || !isFree(ci, cj + dj))) continue; // no corner cutting
      const nk = idx(ni, nj);
      if (closed[nk]) continue;
      const ng = gs[cur] + (di && dj ? Math.SQRT2 : 1);
      if (ng >= gs[nk]) continue;
      gs[nk] = ng; came[nk] = cur; fOf[nk] = ng + h(nk);
      open.push(nk);
    }
  }
  if (!found) return null;
  const pts = [];
  for (let k = goal; k !== -1; k = came[k]) pts.push({ x: px(k % W), z: pz(Math.floor(k / W)) });
  pts.reverse();
  if (endFree) pts.push({ x: bx, z: bz });
  // string pulling: from each kept point, jump to the farthest point still in straight reach
  const out = [];
  let cx = ax, cz = az, k = 0;
  while (k < pts.length) {
    let far = k;
    for (let m = pts.length - 1; m > k; m--) if (clear(g, cx, cz, pts[m].x, pts[m].z)) { far = m; break; }
    out.push(pts[far]);
    cx = pts[far].x; cz = pts[far].z;
    k = far + 1;
  }
  return out;
}

// Route state for walking from `from` ({floor,x,z}) to `goal` ({floor,x,z}).
// reach: stop as soon as the goal is this close (ARRIVE for interact targets, 0 = walk onto it).
// gridOf (optional): floor → collision grid. With it, every walk leg is routed around furniture on
// that floor's grid (gridPath); without it, legs are straight lines (moveWithSlide only).
// Returns null when findPath finds no way (closed floor, passage unknown, outside every room).
export function planRoute(map, from, goal, navOpts, reach = 0, gridOf = null) {
  let steps = findPath(map, from, goal, navOpts);
  if (!steps) return null;
  if (gridOf) steps = routeLegs(map, from, goal, steps, gridOf, reach);
  // reach > 0 only counts inside the goal's room, so an item is never reached through a wall
  return { map, goal: { floor: goal.floor, x: goal.x, z: goal.z, room: roomAt(map, goal.floor, goal.x, goal.z) },
    reach, steps, i: 0, best: Infinity, stuck: 0 };
}

// Expands each walk leg of a findPath() Step[] into grid waypoints. The leg's start is the previous
// step (or `from`; after a stairs / passage step, its far end). The last leg toward an interact
// target (reach > 0) may end at a corner of the goal's room when the goal sits inside furniture.
function routeLegs(map, from, goal, steps, gridOf, reach) {
  const out = [];
  let prev = { floor: from.floor, x: from.x, z: from.z };
  const goalRoom = roomAt(map, goal.floor, goal.x, goal.z);
  steps.forEach((st, n) => {
    if (st.kind !== 'walk' || st.floor !== prev.floor) { out.push(st); prev = st; return; }
    const g = gridOf(st.floor);
    const lastLeg = n === steps.length - 1;
    const ok = lastLeg && reach > 0 ? (x, z) => roomAt(map, st.floor, x, z) === goalRoom : null;
    const pts = g ? gridPath(g, prev.x, prev.z, st.x, st.z, ok) : null;
    if (!pts) { out.push(st); prev = st; return; }
    // an unwalkable end (item on a table) is still the target: keep it as the final point so stepRoute
    // arrives within reach of it (or slides as close as it can)
    if (pts.length && (pts[pts.length - 1].x !== st.x || pts[pts.length - 1].z !== st.z)) pts.push({ x: st.x, z: st.z });
    for (const p of pts) out.push({ floor: st.floor, x: p.x, z: p.z, kind: 'walk' });
    prev = st;
  });
  return out;
}

// Advances `route` by dt for the player at pos ({floor,x,z}) on collision grid g (of pos.floor).
// Mutates route; returns { x, z, dx, dz, event } where event is
//   null      still walking (dx/dz = actual displacement this frame),
//   'arrive'  within route.reach of the goal and in the goal's room (interact targets),
//   'done'    walked onto the final point,
//   'stairs' | 'passage'  standing at the near end of a floor link; event id in route.linkId,
//             the caller asks the host and replans after the teleport,
//   'stuck'   no progress for STUCK_SEC (or the route no longer matches pos.floor).
export function stepRoute(route, g, pos, dt, speed = SPEED) {
  const out = (event, x = pos.x, z = pos.z) => ({ x, z, dx: x - pos.x, dz: z - pos.z, event });
  const gl = route.goal;
  if (route.reach > 0 && gl.floor === pos.floor && Math.hypot(gl.x - pos.x, gl.z - pos.z) <= route.reach
    && roomAt(route.map, pos.floor, pos.x, pos.z) === gl.room) return out('arrive');
  const s = route.steps[route.i];
  if (!s) return out('done');
  if (s.kind === 'stairs' || s.kind === 'passage') { route.linkId = s.id; return out(s.kind); }
  if (s.floor !== pos.floor) return out('stuck');

  const last = route.i === route.steps.length - 1;
  const tol = last ? FINISH : WAYPOINT;
  const ex = s.x - pos.x, ez = s.z - pos.z;
  const d = Math.hypot(ex, ez);
  if (d <= tol) {
    route.i++; route.best = Infinity; route.stuck = 0;
    if (last) return out('done');
    return stepRoute(route, g, pos, dt, speed);
  }
  const m = Math.min(d, speed * dt);
  const p = moveWithSlide(g, pos.x, pos.z, (ex / d) * m, (ez / d) * m);
  const nd = Math.hypot(s.x - p.x, s.z - p.z);
  if (nd < route.best - PROGRESS) { route.best = nd; route.stuck = 0; }
  else if ((route.stuck += dt) >= STUCK_SEC) return out('stuck', p.x, p.z);
  return out(null, p.x, p.z);
}

// findPath options for this player from the shared game state (see core/rules.js).
export function navOptions(S, caseData, pid, floor = 0) {
  if (!S) return { floorsOpen: [floor], passageOpen: false };
  const floorsOpen = S.floorsOpen ? [...S.floorsOpen] : [floor];
  if (!floorsOpen.includes(floor)) floorsOpen.push(floor); // never strand the player on their own floor
  const passageOpen = !!(caseData && pid != null && canUsePassage(S, caseData, pid));
  return { floorsOpen, passageOpen };
}
