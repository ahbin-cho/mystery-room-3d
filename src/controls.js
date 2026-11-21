// Player controls (스펙 Task 8): joystick, tap-to-move, follow camera, wall fade.
//
//   const controls = createControls({ canvas, camera, map, world, getState, me,
//     onInteract(target), onStairs(id), onPassage(),
//     caseData?, pid?, onBlocked?(reason: 'unreachable' | 'stuck' | 'nothing-near') });
//   each frame: controls.update(dt)          (moves `me`, places the camera, fades walls)
//   host confirmed a floor change: controls.setFloor(floor)  (main also teleports me.x / me.z)
//   controls.dispose()                        (removes every listener, DOM node and fade mesh)
//
// `me = {floor, x, z, ry, moving}` belongs to main; controls write x, z, ry, moving and NEVER floor.
// Floor changes only happen through onStairs(id) / onPassage() and the host's answer.
// findPath options come from getState(): S.floorsOpen, and the passage only when canUsePassage
// holds for `pid` (needs caseData + pid; without them the passage is treated as closed).
//
// Joystick: a touch starting in the bottom-left third of the canvas; knob travel 60 px = 3.6 m/s.
// Screen up is north (-z): the camera never rotates, it looks north from behind/above the player
// (the world is dressed for that view). A quick tap in the joystick zone still counts as a tap.
// Keyboard (PC): WASD / arrow keys move exactly like the joystick (normalised diagonals, cancel any route);
// E / Space interacts with the nearest marker within 1.6 m in the player's own room. Keys are ignored
// while an input / textarea / select / contenteditable has focus, and all held keys are dropped on
// window blur or when the page is hidden. Mouse clicks are taps.
// Tap: an evidence / stairs / passage marker near the tap (screen space) → walk there and fire its
// callback within 1.6 m; otherwise the floor point under the tap → walk there.
//
// Wall fade (camera → player): walls are InstancedMeshes shared per texture, and per-instance opacity
// is not native. For each wall mesh we keep a sibling "fade" InstancedMesh (same geometry, a cloned
// material at opacity 0.25, no depth write). Wall blocks near the camera→player segment are moved
// into the fade mesh and zero-scaled in the original. A fade mesh is hidden while empty, so the cost
// is one extra draw call per wall texture that currently has faded blocks (usually 1-3), and the
// instance buffers are re-uploaded only when the faded set changes.
import * as THREE from 'three';
import { buildGrid, isBlocked, moveWithSlide } from './core/grid.js';
import { roomAt } from './core/map.js';
import { joystickVector, keysVector, isMoveKey, nearestTarget, nearestFree, planRoute, stepRoute, navOptions, SPEED, STICK_RADIUS, ARRIVE } from './core/walk.js';

const CAM_UP = 7.2, CAM_BACK = 4.6;  // landscape offset from the player (m)
const PORTRAIT_K = 1.5;               // portrait screens (aspect < 1) sit 1.5x farther back
const LOOK_Y = 0.8;                   // aim at the player's chest
const FADE_OPACITY = 0.25;
const FADE_R = 1.1;                   // blocks this close to the camera→player segment fade
const FADE_FROM = 0.35;               // ...if at least this far in front of the player (m along the segment)
const HIT_PX = 44;                    // marker tap radius on screen
const TAP_PX = 12, TAP_MS = 450;      // a tap moves less and lasts shorter than this
const LINK_WAIT = 3;                  // s to wait for the host after onStairs / onPassage

function floorBases(map) {
  const out = [];
  let y = 0;
  for (const f of map.floors) { out[f.id] = y; y += f.height || 3; }
  return out;
}

const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

export function createControls({ canvas, camera, map, world, getState, me, onInteract, onStairs, onPassage, caseData, pid, onBlocked }) {
  const bases = floorBases(map);
  const grids = [];
  const grid = f => (grids[f] ??= buildGrid(map, f));
  const opts = () => navOptions(getState?.(), caseData, pid ?? me.pid, me.floor);

  let route = null;   // core/walk.js route, plus .onArrive for interact targets
  let waiting = null; // after onStairs/onPassage: { goal, reach, onArrive, t, replan }
  let stick = null;   // { id, x0, y0, x, y, t0 } in canvas px
  const taps = new Map();
  let camSnap = true;

  // ── DOM: joystick base + knob ──
  const prevTouch = canvas.style.touchAction;
  canvas.style.touchAction = 'none';
  const base = document.createElement('div');
  const knob = document.createElement('div');
  base.style.cssText = `position:fixed;width:${STICK_RADIUS * 2}px;height:${STICK_RADIUS * 2}px;margin:-${STICK_RADIUS}px 0 0 -${STICK_RADIUS}px;`
    + 'border-radius:50%;background:rgba(255,246,224,.12);border:2px solid rgba(255,246,224,.45);box-sizing:border-box;'
    + 'pointer-events:none;display:none;z-index:20';
  knob.style.cssText = 'position:absolute;left:50%;top:50%;width:52px;height:52px;margin:-26px 0 0 -26px;border-radius:50%;'
    + 'background:rgba(255,246,224,.7);box-shadow:0 1px 4px rgba(0,0,0,.5)';
  base.appendChild(knob);
  document.body.appendChild(base);

  const local = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height }; };

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = local(e);
    if (!stick && p.x < p.w / 3 && p.y > (p.h * 2) / 3) {
      stick = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, t0: performance.now() };
      base.style.left = `${e.clientX}px`; base.style.top = `${e.clientY}px`;
      knob.style.transform = '';
      base.style.display = 'block';
    } else taps.set(e.pointerId, { x0: p.x, y0: p.y, t0: performance.now() });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
  }
  function onMove(e) {
    const p = local(e);
    if (stick && e.pointerId === stick.id) {
      stick.x = p.x; stick.y = p.y;
      const v = joystickVector(p.x - stick.x0, p.y - stick.y0);
      knob.style.transform = `translate(${v.kx}px,${v.ky}px)`;
      return;
    }
    const t = taps.get(e.pointerId);
    if (t && Math.hypot(p.x - t.x0, p.y - t.y0) > TAP_PX) taps.delete(e.pointerId);
  }
  function onUp(e) {
    const up = e.type === 'pointerup';
    if (stick && e.pointerId === stick.id) {
      const quick = Math.hypot(stick.x - stick.x0, stick.y - stick.y0) <= TAP_PX && performance.now() - stick.t0 < TAP_MS;
      if (up && quick) tap(stick.x0, stick.y0);
      stick = null;
      base.style.display = 'none';
      return;
    }
    const t = taps.get(e.pointerId);
    taps.delete(e.pointerId);
    if (up && t && performance.now() - t.t0 < TAP_MS) tap(t.x0, t.y0);
  }
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  // ── keyboard ──
  const held = new Set();
  const typing = () => {
    const el = document.activeElement;
    return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
  };
  function onKeyDown(e) {
    if (typing() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isMoveKey(e.code)) { held.add(e.code); e.preventDefault(); return; }
    if (e.code === 'KeyE' || e.code === 'Space') {
      e.preventDefault(); // Space would scroll / click a focused button
      if (!e.repeat) interactNearest();
    }
  }
  function onKeyUp(e) { held.delete(e.code); }
  const releaseKeys = () => held.clear();
  const onVisibility = () => { if (document.visibilityState === 'hidden') held.clear(); };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseKeys);
  document.addEventListener('visibilitychange', onVisibility);

  // ── taps ──
  const v3 = new THREE.Vector3();
  function markerCandidates() {
    const out = [];
    const f = me.floor;
    for (const [id, m] of Object.entries(world.itemMarkers || {})) {
      if (m.userData.floor === f && m.visible !== false) out.push({ obj: m, target: { kind: 'item', id, marker: m } });
    }
    const ends = (markers, kind) => {
      for (const [id, pair] of Object.entries(markers || {}))
        for (const m of [pair.a, pair.b]) if (m && m.userData.floor === f) out.push({ obj: m, target: { kind, id, marker: m } });
    };
    ends(world.stairMarkers, 'stairs');
    if (opts().passageOpen) ends(world.passageMarkers, 'passage');
    return out;
  }
  function pickMarker(px, py, w, h) {
    let best = null, bd = HIT_PX;
    for (const c of markerCandidates()) {
      c.obj.getWorldPosition(v3).project(camera);
      if (v3.z > 1 || v3.z < -1) continue;
      const d = Math.hypot((v3.x * 0.5 + 0.5) * w - px, (-v3.y * 0.5 + 0.5) * h - py);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function tap(px, py) {
    const r = canvas.getBoundingClientRect();
    const hit = pickMarker(px, py, r.width, r.height);
    if (hit) {
      const t = hit.target, pos = t.marker.getWorldPosition(v3);
      goTo({ floor: me.floor, x: pos.x, z: pos.z }, ARRIVE, () => fireTarget(t));
      return;
    }
    ndc.set((px / r.width) * 2 - 1, -(py / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    plane.constant = -(bases[me.floor] || 0);
    if (!ray.ray.intersectPlane(plane, v3)) return;
    if (roomAt(map, me.floor, v3.x, v3.z) === null) return;
    const p = nearestFree(grid(me.floor), v3.x, v3.z);
    if (p) goTo({ floor: me.floor, x: p.x, z: p.z }, 0, null);
  }
  function fireTarget(t) {
    if (t.kind === 'item') onInteract?.({ kind: 'item', id: t.id, marker: t.marker });
    else if (t.kind === 'stairs') onStairs?.(t.id);
    else onPassage?.();
  }
  function interactNearest() {
    const list = markerCandidates().map(c => {
      c.obj.getWorldPosition(v3);
      return { x: v3.x, z: v3.z, target: c.target };
    });
    const hit = nearestTarget(map, me, list, ARRIVE);
    if (!hit) { onBlocked?.('nothing-near'); return; }
    route = null; waiting = null;
    fireTarget(hit.target);
  }
  function goTo(goal, reach, onArrive) {
    waiting = null;
    route = planRoute(map, me, goal, opts(), reach);
    if (!route) { onBlocked?.('unreachable'); return; }
    route.onArrive = onArrive;
  }

  // ── movement ──
  function moveTo(x, z, dt) {
    const dx = x - me.x, dz = z - me.z;
    me.x = x; me.z = z;
    me.moving = Math.hypot(dx, dz) > 1e-4;
    if (me.moving) me.ry += wrapAngle(Math.atan2(dx, dz) - me.ry) * (1 - Math.exp(-dt * 14));
  }
  function walk(dt) {
    const g = grid(me.floor);
    if (isBlocked(g, me.x, me.z)) { // dropped inside furniture (teleport, bad spawn): step out instead of freezing
      const p = nearestFree(g, me.x, me.z, 1.5);
      if (p) { me.x = p.x; me.z = p.z; }
    }
    let v = stick ? joystickVector(stick.x - stick.x0, stick.y - stick.y0) : null;
    if ((!v || v.mag === 0) && held.size) v = keysVector(held);
    if (v && v.mag > 0) {
      route = null; waiting = null; // the stick overrides any tap route
      const p = moveWithSlide(g, me.x, me.z, v.x * SPEED * dt, v.z * SPEED * dt);
      moveTo(p.x, p.z, dt);
      return;
    }
    if (waiting) {
      if (waiting.replan) {
        const w = waiting;
        goTo(w.goal, w.reach, w.onArrive);
      } else if ((waiting.t -= dt) <= 0) waiting = null; // host said no (or never answered)
    }
    if (!route) { me.moving = false; return; }
    const r = stepRoute(route, g, me, dt);
    moveTo(r.x, r.z, dt);
    if (!r.event) return;
    const done = route;
    route = null;
    me.moving = false;
    if (r.event === 'arrive') done.onArrive?.();
    else if (r.event === 'stuck') onBlocked?.('stuck');
    else if (r.event === 'stairs' || r.event === 'passage') {
      waiting = { goal: done.goal, reach: done.reach, onArrive: done.onArrive, t: LINK_WAIT, replan: false };
      if (r.event === 'stairs') onStairs?.(done.linkId); else onPassage?.();
    }
  }

  // ── camera ──
  const camPos = new THREE.Vector3(), look = new THREE.Vector3();
  function placeCamera(dt) {
    const k = camera.aspect < 1 ? PORTRAIT_K : 1;
    const y = bases[me.floor] || 0;
    camPos.set(me.x, y + CAM_UP * k, me.z + CAM_BACK * k);
    if (camSnap) { camera.position.copy(camPos); camSnap = false; }
    else camera.position.lerp(camPos, 1 - Math.exp(-dt * 8));
    camera.lookAt(look.set(me.x, y + LOOK_Y, me.z));
  }

  // ── wall fade ──
  const fades = new Map(); // wall group -> [{ mesh, fade, centres, orig, on }]
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  function fadeData(group) {
    let list = fades.get(group);
    if (list) return list;
    list = [];
    const m4 = new THREE.Matrix4();
    for (const mesh of [...group.children]) { // copy: fade meshes are added to the group below
      if (!mesh.isInstancedMesh) continue;
      const n = mesh.count;
      const orig = new Float32Array(mesh.instanceMatrix.array.subarray(0, n * 16));
      const centres = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        m4.fromArray(orig, i * 16);
        centres[i * 3] = m4.elements[12]; centres[i * 3 + 1] = m4.elements[13]; centres[i * 3 + 2] = m4.elements[14];
      }
      const src = mesh.material;
      const mat = src.clone();
      mat.transparent = true;
      mat.opacity = (src.transparent ? src.opacity : 1) * FADE_OPACITY;
      mat.depthWrite = false;
      const fade = new THREE.InstancedMesh(mesh.geometry, mat, n);
      fade.count = 0;
      fade.visible = false;
      fade.frustumCulled = false;
      fade.renderOrder = 2;
      fade.name = `${mesh.name}-fade`;
      group.add(fade);
      list.push({ mesh, fade, centres, orig, on: new Uint8Array(n), want: new Uint8Array(n) }); // buffers reused every frame
    }
    fades.set(group, list);
    return list;
  }
  // Applies e.want: touches only instances whose state changed, then repacks the fade mesh
  // (only when something changed). No allocation: plain index loops over preallocated buffers.
  function applyFade(e) {
    const { mesh, fade, orig, on, want } = e;
    const dst = mesh.instanceMatrix.array;
    const z = zero.elements;
    let changed = false;
    for (let i = 0; i < on.length; i++) {
      if (on[i] === want[i]) continue;
      on[i] = want[i];
      changed = true;
      const o = i * 16;
      if (on[i]) for (let k = 0; k < 16; k++) dst[o + k] = z[k];
      else for (let k = 0; k < 16; k++) dst[o + k] = orig[o + k];
    }
    if (!changed) return;
    const fdst = fade.instanceMatrix.array;
    let c = 0;
    for (let i = 0; i < on.length; i++) {
      if (!on[i]) continue;
      const o = i * 16, f = c++ * 16;
      for (let k = 0; k < 16; k++) fdst[f + k] = orig[o + k];
    }
    mesh.instanceMatrix.needsUpdate = true;
    fade.count = c;
    fade.visible = c > 0;
    fade.instanceMatrix.needsUpdate = true;
  }
  function clearFade(group) {
    for (const e of fades.get(group) || []) { e.want.fill(0); applyFade(e); }
  }
  const A = new THREE.Vector3(), lastA = new THREE.Vector3(Infinity, 0, 0), lastB = new THREE.Vector3(Infinity, 0, 0);
  let fadeFloor = null;
  function updateFade() {
    const group = world.wallGroups?.[me.floor];
    if (fadeFloor !== me.floor) { if (fadeFloor !== null) clearFade(world.wallGroups?.[fadeFloor]); fadeFloor = me.floor; lastA.x = Infinity; }
    if (!group) return;
    A.set(me.x, (bases[me.floor] || 0) + 1.0, me.z);
    const B = camera.position;
    if (A.distanceToSquared(lastA) < 0.0025 && B.distanceToSquared(lastB) < 0.0025) return;
    lastA.copy(A); lastB.copy(B);
    const abx = B.x - A.x, aby = B.y - A.y, abz = B.z - A.z;
    const len2 = abx * abx + aby * aby + abz * abz, len = Math.sqrt(len2);
    const minX = Math.min(A.x, B.x) - FADE_R, maxX = Math.max(A.x, B.x) + FADE_R;
    const minZ = Math.min(A.z, B.z) - FADE_R, maxZ = Math.max(A.z, B.z) + FADE_R;
    const r2 = FADE_R * FADE_R;
    for (const e of fadeData(group)) {
      const c = e.centres, n = e.on.length, want = e.want;
      want.fill(0);
      for (let i = 0; i < n; i++) {
        const x = c[i * 3], z = c[i * 3 + 2];
        if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
        const px = x - A.x, py = c[i * 3 + 1] - A.y, pz = z - A.z;
        const t = Math.min(1, (px * abx + py * aby + pz * abz) / len2);
        if (t * len < FADE_FROM) continue;
        const qx = px - abx * t, qy = py - aby * t, qz = pz - abz * t;
        if (qx * qx + qy * qy + qz * qz < r2) want[i] = 1;
      }
      applyFade(e);
    }
  }

  return {
    update(dt) {
      dt = Math.min(dt, 0.1); // a stalled tab must not teleport the player through walls
      walk(dt);
      placeCamera(dt);
      updateFade();
    },
    // Host confirmed a floor change (main updates me.floor / me.x / me.z itself).
    setFloor(floor) {
      if (fadeFloor !== null && fadeFloor !== floor) { clearFade(world.wallGroups?.[fadeFloor]); fadeFloor = null; }
      camSnap = true;
      if (waiting) waiting.replan = true; // continue a multi-floor route from the new floor
      else route = null;
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseKeys);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.style.touchAction = prevTouch;
      base.remove();
      for (const [group, list] of fades) {
        clearFade(group);
        for (const e of list) { group.remove(e.fade); e.fade.material.dispose(); e.fade.dispose(); }
      }
      fades.clear();
      route = null; waiting = null; stick = null; taps.clear(); held.clear();
    },
  };
}
