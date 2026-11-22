// 하얀 부엉이 저택 사건 v2 — entry point. Wires world, characters, controls, net and UI together.
//
// Boot: buildWorld → createUI.openStart → createRoom / joinRoom → createControls → frame loop
// (controls.update, remote pose interpolation + animation, setNearby, ui.update, render).
//
// Ownership:
//   - The host's S is the truth. `me` (this player's local position) is owned here and by controls;
//     me.floor only changes when S says so (teleport event or a state whose floor differs).
//   - Our own pos goes out at 10 Hz and only when it changed (the host applies its own pos through
//     applyAction, which clones S, so it must not run every frame).
//   - Input is frozen while a UI modal is open or the client is reconnecting.
//   - While a UI modal is open the world renders every 4th frame (the overlay covers it).
import * as THREE from 'three';
import { CASE } from './cases/owl-manor.js';
import { buildWorld, setVisibleFloor, updateLights, makeSceneLights } from './world.js';
import { makeCharacter, disposeCharacter, animateCharacter, LOBBY_LOOKS } from './characters.js';
import { createControls } from './controls.js';
import { createRoom, joinRoom } from './net.js';
import { createUI } from './ui.js';
import { roomAt } from './core/map.js';
import { canUsePassage } from './core/rules.js';
import { nearestTarget, ARRIVE } from './core/walk.js';

const MAP = CASE.MAP;
const POS_MS = 100;          // own pos → host at 10 Hz
const POS_KEEPALIVE = 2000;  // ...and at least every 2 s even when standing still
const MODAL_RENDER_EVERY = 4;
const NEAR_EVERY = 3;        // nearest-target search every 3rd frame
const DEBUG = new URLSearchParams(location.search).has('debug');

const bases = [];
{ let y = 0; for (const f of MAP.floors) { bases[f.id] = y; y += f.height || 3; } }
const floorOfRoom = id => MAP.rooms.find(r => r.id === id)?.floor;
const roomName = id => MAP.rooms.find(r => r.id === id)?.name ?? '';

// ── renderer / scene ──
const canvas = document.getElementById('world');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  document.getElementById('boot').textContent = '이 기기에서는 3D 화면을 열 수 없어요. 다른 브라우저로 시도해 주세요.';
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.setSize(innerWidth, innerHeight, false);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1424);
scene.fog = new THREE.Fog(0x0e1424, 30, 70);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);

const world = buildWorld(CASE);
world.floors.forEach(g => g && scene.add(g));
scene.add(makeSceneLights());
scene.add(world.lightPool);
document.getElementById('boot').remove();

// ── this player ──
const hall = MAP.rooms.find(r => r.id === 'hall').rect;
const me = { pid: null, floor: 0, x: (hall[0] + hall[2]) / 2, z: (hall[1] + hall[3]) / 2, ry: Math.PI, moving: false };
let net = null;
let S = null;
let controls = null;
let reconnecting = false;
let disconnected = false;
let curRoom = undefined;

setVisibleFloor(world, 0);
updateLights(world, 0, roomAt(MAP, 0, me.x, me.z));
camera.position.set(me.x, 9, me.z + 7);
camera.lookAt(me.x, 0.8, me.z);

// ── floor change fade ──
const fadeEl = document.getElementById('fade');
function flashFade() {
  fadeEl.style.transition = 'none';
  fadeEl.style.opacity = '1';
  void fadeEl.offsetWidth;
  fadeEl.style.transition = 'opacity .45s ease-out';
  fadeEl.style.opacity = '0';
}

// ── UI ──
const ui = createUI({
  caseData: CASE,
  getState: () => S,
  me,
  onAction: t => {
    if (frozen() || !net) return;
    if (t.kind === 'stairs' || t.kind === 'stair') act({ t: 'useStairs', id: t.id });
    else if (t.kind === 'passage') act({ t: 'usePassage' });
  },
});
const frozen = () => reconnecting || disconnected || ui.isModalOpen();

// ── items: world visuals + interactable markers ──
function syncItems() {
  if (!S) return;
  for (const it of CASE.ITEMS) {
    const v = world.itemVisuals[it.id];
    if (v) v.visible = ui.isItemInWorld(it.id);
    const m = world.itemMarkers[it.id];
    if (m) m.visible = !S.items[it.id]?.holder; // held by anyone (me included) → not in the world
  }
}
ui.onReveal(() => syncItems());

// ── characters ──
const chars = new Map(); // pid → { ch, lookKey, name, floor, x, z, ry, mv, tx, tz, try_, mine }
function lookFor(pid) {
  const p = S.players[pid];
  if (p.role && CASE.ROLES[p.role]) return { key: `role:${p.role}`, look: CASE.ROLES[p.role].look };
  const i = Math.max(0, S.order.indexOf(pid)) % LOBBY_LOOKS.length;
  return { key: `lobby:${i}`, look: LOBBY_LOOKS[i] };
}
function labelThroughWalls(ch) {
  // Players are only drawn on our own floor, so their name tags may show through walls.
  const sp = ch._rig.sprite;
  if (!sp) return;
  sp.material.depthTest = false;
  sp.renderOrder = 10;
}
function syncCharacters() {
  if (!S) return;
  const alive = new Set();
  for (const pid of S.order) {
    const p = S.players[pid];
    if (!p || !p.online) continue;
    alive.add(pid);
    const { key, look } = lookFor(pid);
    const label = pid === me.pid ? `${p.name} (나)` : p.name;
    let c = chars.get(pid);
    if (c && c.lookKey !== key) { disposeCharacter(c.ch); chars.delete(pid); c = null; }
    if (!c) {
      const ch = makeCharacter(look, label);
      labelThroughWalls(ch);
      scene.add(ch.group);
      c = { ch, lookKey: key, label, floor: p.floor, x: p.x, z: p.z, ry: p.ry || 0, mv: p.mv || 0, tx: p.x, tz: p.z, tr: p.ry || 0 };
      chars.set(pid, c);
    } else if (c.label !== label) { c.ch.setLabel(label); c.label = label; }
    if (pid !== me.pid && c.floor !== p.floor) { // teleported: snap
      c.floor = p.floor; c.x = c.tx = p.x; c.z = c.tz = p.z;
    }
  }
  for (const [pid, c] of chars) {
    if (!alive.has(pid)) { disposeCharacter(c.ch); chars.delete(pid); }
  }
}
function onPoses(poses) {
  for (const [pid, q] of Object.entries(poses)) {
    if (pid === me.pid) continue;
    const c = chars.get(pid);
    if (!c) continue;
    if (q.floor !== c.floor || Math.hypot(q.x - c.x, q.z - c.z) > 4) { c.floor = q.floor; c.x = q.x; c.z = q.z; c.ry = q.ry; }
    c.tx = q.x; c.tz = q.z; c.tr = q.ry; c.mv = q.mv;
  }
}

// ── actions: our latest pos always reaches the host first ──
// The host checks reach against the position it last heard from us, and our pos is throttled to
// 10 Hz; an action fired on arrival (stairs, passage, pick, …) must not overtake it.
function act(a) {
  if (!net) return;
  sendPos(0, true);
  net.send(a);
}

// ── my floor / position from the host ──
// A teleport reaches a client twice: the state (new floor) and then the teleport event, as separate
// messages with frames in between. The second one must be a no-op, or it snaps the player back and
// cancels a route that controls already re-planned on the new floor.
let lastPlace = null; // { src, floor, x, z, t, used }
function placeFromHost(src, floor, x, z) {
  const L = lastPlace, now = performance.now();
  if (L && !L.used && L.src !== src && L.floor === floor && Math.abs(L.x - x) < 0.01 && Math.abs(L.z - z) < 0.01
      && now - L.t < 3000) { L.used = true; return; }
  lastPlace = { src, floor, x, z, t: now, used: false };
  placeMe(floor, x, z);
}
function placeMe(floor, x, z) {
  const floorChanged = floor !== me.floor;
  me.floor = floor; me.x = x; me.z = z; me.moving = false;
  if (floorChanged) {
    flashFade();
    setVisibleFloor(world, floor);
  }
  controls?.setFloor(floor); // snaps the camera; continues a multi-floor route
  curRoom = undefined;       // re-run lights + banner next frame
}

// ── net handlers ──
let pendingS = null;
const handlers = {
  onState(s) {
    if (!net) { pendingS = s; return; } // before createRoom/joinRoom resolved: wait for our pid
    applyState(s);
  },
  onEvent(ev) {
    if (!net) return;
    if (ev?.type === 'teleport' && ev.pid === me.pid) placeFromHost('event', ev.floor, ev.x, ev.z);
    ui.onEvent(ev);
  },
  onPoses,
  onDisconnected(reason) {
    disconnected = true;
    reconnecting = false;
    ui.showConnection('disconnected', reason);
  },
  onReconnecting(n) {
    reconnecting = true;
    ui.showConnection('reconnecting', n);
  },
};
let first = true;
function applyState(s) {
  S = s;
  reconnecting = false;
  const mine = S.players[me.pid];
  if (mine) {
    if (first) {
      first = false;
      me.ry = mine.ry || Math.PI;
      let x = mine.x;
      // Everyone joins the lobby on the same hall spot: step aside so players don't stand inside each other.
      if (S.phase === 'lobby') x += ((Math.max(0, S.order.indexOf(me.pid)) % 5) - 2) * 0.9;
      placeMe(mine.floor, x, mine.z);
      setVisibleFloor(world, me.floor);
    }
    else if (mine.floor !== me.floor) placeFromHost('state', mine.floor, mine.x, mine.z); // teleport (its event follows)
  }
  ui.onState(S);
  syncItems();
  syncCharacters();
}

async function start(net0) {
  net = net0;
  me.pid = net.pid;
  ui.setNet({ ...net, send: a => (a?.t === 'pos' ? net.send(a) : act(a)) }); // pick / share / vote / … flush pos first
  controls = createControls({
    canvas, camera, map: MAP, world, me, caseData: CASE, pid: me.pid,
    getState: () => S,
    isFrozen: frozen,
    onInteract: t => { if (t.kind === 'item') ui.openItem(t.id); },
    onStairs: id => act({ t: 'useStairs', id }),
    onPassage: () => act({ t: 'usePassage' }),
    onBlocked: r => { if (r === 'unreachable') ui.toast('거기로는 갈 수 없어요'); },
  });
  if (pendingS) { const s = pendingS; pendingS = null; applyState(s); }
  try { history.replaceState(null, '', `${location.pathname}?room=${net.code}${DEBUG ? '&debug' : ''}`); } catch { /* file:// */ }
}

ui.openStart(
  name => createRoom(name, CASE, handlers).then(start),
  (name, code) => joinRoom(name, code, CASE, handlers).then(start),
);

// ── nearest interactable for the 🔍 button ──
const targets = []; // static marker positions: { x, z, floor, target }
const wp = new THREE.Vector3();
for (const [id, m] of Object.entries(world.itemMarkers)) {
  m.getWorldPosition(wp);
  targets.push({ x: wp.x, z: wp.z, floor: m.userData.floor, marker: m, target: { kind: 'item', id } });
}
for (const [kind, markers] of [['stairs', world.stairMarkers], ['passage', world.passageMarkers]]) {
  for (const [id, pair] of Object.entries(markers)) for (const m of [pair.a, pair.b]) {
    m.getWorldPosition(wp);
    targets.push({ x: wp.x, z: wp.z, floor: m.userData.floor, marker: m, target: { kind, id } });
  }
}
const nearList = [];
function updateNearby() {
  if (!S || !net) { ui.setNearby(null); return; }
  nearList.length = 0;
  const passageOk = canUsePassage(S, CASE, me.pid);
  for (const t of targets) {
    if (t.floor !== me.floor) continue;
    if (t.target.kind === 'item' && !t.marker.visible) continue; // held by someone
    if (t.target.kind === 'passage' && !passageOk) continue;
    nearList.push(t);
  }
  const hit = nearestTarget(MAP, me, nearList, ARRIVE);
  ui.setNearby(hit ? hit.target : null);
}

// ── pos sends ──
let posAcc = 0, posIdle = 0;
const lastSent = { x: NaN, z: NaN, ry: NaN, mv: -1 };
function myMv() {
  if (me.moving) return 1;
  return ui.isModalOpen() && S && S.phase !== 'lobby' ? 0.5 : 0; // 0.5 = crouching over evidence
}
// now = true: right before an action, bypassing the 10 Hz throttle (still skipped if unchanged).
function sendPos(dt, now = false) {
  if (!net || !S?.players[me.pid]) return;
  posAcc += dt * 1000; posIdle += dt * 1000;
  if (posAcc < POS_MS && !now) return;
  posAcc = 0;
  const mv = myMv();
  const same = Math.abs(me.x - lastSent.x) < 0.01 && Math.abs(me.z - lastSent.z) < 0.01
    && Math.abs(me.ry - lastSent.ry) < 0.02 && mv === lastSent.mv;
  if (same && (now || posIdle < POS_KEEPALIVE)) return;
  posIdle = 0;
  lastSent.x = me.x; lastSent.z = me.z; lastSent.ry = me.ry; lastSent.mv = mv;
  net.send({ t: 'pos', x: +me.x.toFixed(3), z: +me.z.toFixed(3), ry: +me.ry.toFixed(3), mv });
}

// ── frame loop ──
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const stateOf = mv => (mv >= 0.75 ? 'walk' : mv >= 0.25 ? 'crouch' : 'idle');
let last = performance.now(), t = 0, frame = 0;
const fpsTimes = [];
let fps = 0, calls = 0;

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now; t += dt; frame++;
  fpsTimes.push(now); if (fpsTimes.length > 61) fpsTimes.shift();
  if (fpsTimes.length > 1) fps = (fpsTimes.length - 1) * 1000 / (fpsTimes[fpsTimes.length - 1] - fpsTimes[0]);

  if (controls) controls.update(dt);

  // room change → lights + banner
  const r = roomAt(MAP, me.floor, me.x, me.z);
  if (r !== curRoom) {
    curRoom = r;
    updateLights(world, me.floor, r);
    if (r && net) ui.showRoomBanner(roomName(r));
  }

  // characters
  const k = 1 - Math.exp(-dt * 12);
  for (const [pid, c] of chars) {
    if (pid === me.pid) {
      c.floor = me.floor; c.x = me.x; c.z = me.z; c.ry = me.ry; c.mv = myMv();
    } else {
      c.x += (c.tx - c.x) * k;
      c.z += (c.tz - c.z) * k;
      c.ry += wrap(c.tr - c.ry) * k;
    }
    const g = c.ch.group;
    g.visible = c.floor === me.floor;
    if (!g.visible) continue;
    g.position.set(c.x, bases[c.floor] || 0, c.z);
    g.rotation.y = c.ry;
    animateCharacter(c.ch, stateOf(c.mv), t, dt);
  }

  if (controls && frame % NEAR_EVERY === 0) updateNearby();
  sendPos(dt);
  ui.update(dt);

  if (!ui.isModalOpen() || frame % MODAL_RENDER_EVERY === 0) {
    renderer.render(scene, camera);
    calls = renderer.info.render.calls;
  }
}
requestAnimationFrame(loop);

if (DEBUG) {
  window.__owl = {
    THREE, scene, camera, renderer, world, me, ui, CASE, chars,
    get S() { return S; }, get net() { return net; }, get controls() { return controls; },
    stats: () => ({ fps: +fps.toFixed(1), calls, tris: renderer.info.render.triangles, floor: me.floor, x: +me.x.toFixed(2), z: +me.z.toFixed(2), room: curRoom, chars: chars.size }),
  };
}
