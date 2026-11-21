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

// Route state for walking from `from` ({floor,x,z}) to `goal` ({floor,x,z}).
// reach: stop as soon as the goal is this close (ARRIVE for interact targets, 0 = walk onto it).
// Returns null when findPath finds no way (closed floor, passage unknown, outside every room).
export function planRoute(map, from, goal, navOpts, reach = 0) {
  const steps = findPath(map, from, goal, navOpts);
  if (!steps) return null;
  // reach > 0 only counts inside the goal's room, so an item is never reached through a wall
  return { map, goal: { floor: goal.floor, x: goal.x, z: goal.z, room: roomAt(map, goal.floor, goal.x, goal.z) },
    reach, steps, i: 0, best: Infinity, stuck: 0 };
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
