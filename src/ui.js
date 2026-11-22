// UI layer (스펙 4.x, Task 10 + Ruling 7 "증거 가방"): start screen, HUD, room banner, evidence bag,
// evidence cards (dossier + rotating block mini view), container search / safe code, notebook
// (내 역할 · 증거 · 인물 · 지도), vote, reveal, connection overlay. All text is Korean.
// The module injects its own CSS (v1 palette, --red:#b5352d for WCAG AA) and builds its own DOM.
//
//   const ui = createUI({ caseData, net?, getState?, me?, onAction?, root? })
//     net       Net from src/net.js (or set later with ui.setNet(net) once the room is open)
//     getState  () => S, optional; otherwise the last S passed to ui.onState is used
//     me        main's player object {floor, x, z} for the map dot (falls back to S.players[pid])
//     onAction  (target) => void, called when the 🔍 action button is pressed for a stair/passage
//               target (items are handled inside the UI through openItem)
//
//   ui.setNet(net)                  remember the Net (pid, isHost, code, send); shows the HUD
//   ui.openStart(onCreate, onJoin)  start screen. onCreate(name) / onJoin(name, code) return a
//                                   Promise; resolve → start screen closes, reject → err.message shown
//   ui.onState(S)                   every host state (phase changes, bag, votes, open panels refresh)
//   ui.onEvent(ev)                  ev.type === 'toast' → toast(ev.text); other events are ignored
//   ui.showRoomBanner(roomName)     top-centre banner for 1.5 s
//   ui.openItem(itemId)             interact with an item in the world: search step / safe code /
//                                   evidence card, as appropriate (main calls this from onInteract)
//   ui.setNearby(target | null)     target = {kind: 'item' | 'stair' | 'stairs' | 'passage', id};
//                                   shows the contextual "🔍 조사" button (bottom right, "E" on PC)
//   ui.isRevealed(itemId)           this player searched that container (local, not networked)
//   ui.isItemInWorld(itemId)        should main draw world.itemVisuals[itemId]? (held items vanish
//                                   for everyone; container items appear after this player's search)
//   ui.onReveal(cb)                 cb(itemId) after a local reveal → main shows the world visual
//   ui.isModalOpen()                start screen, card, bag, notebook, vote, reveal or connection
//                                   overlay is open → main pauses joystick + keyboard movement, AND
//                                   should skip or throttle its own world render (e.g. every 4th
//                                   frame): the dimmed overlay covers it, and the evidence mini view
//                                   (shared renderer, 30 fps, DPR ≤ 1.5) is then the only GPU work
//   ui.showConnection(status, info) 'reconnecting' (info = try number) → blocking overlay;
//                                   'connected' → hide; 'disconnected' (info = 'refused' | 'replaced'
//                                   | 'lost' | 'host-left') → message + "처음으로". onState also hides
//                                   the reconnecting overlay.
//   ui.update(dt)                   each frame: phase timer (DOM written once per shown second) +
//                                   evidence mini view. setNearby is cheap to call every frame too.
//   ui.toast(text), ui.openNotebook(tab), ui.openBag()
//
// Mini views and bag icons share ONE small WebGLRenderer (phones limit WebGL contexts): the mini view
// renders into it and is copied onto the card's 2D canvas each frame; icons are rendered once and
// cached as data URLs. The party photo is rendered once with makeCharacter, then the characters are
// disposed.
import * as THREE from 'three';
import { VoxelBuilder } from './voxel.js';
import { PROPS } from './props.js';
import { makeCharacter, disposeCharacter } from './characters.js';
import { canUsePassage } from './core/rules.js';
import {
  checkSafeCode, bagItems, evidenceList, searchStep, worldItemVisible, cardFor, canInvestigate,
  canPickPhase, phaseLabel, hostNextLabel, formatRemaining, voteVerdict, containerName, searchGroup,
} from './ui-logic.js';

const CSS = `
.owl-ui{--ink:#3b2f2a;--paper:#fbf3e4;--paper2:#f3e6cc;--red:#b5352d;--navy:#2d3557;--lemon:#ffe58a;--mint:#b8e8c8;
  font-family:'Gowun Dodum',sans-serif;color:var(--ink)}
.owl-ui *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.owl-ui .jua{font-family:'Jua',sans-serif}
.owl-ui button{font-family:'Jua',sans-serif;border:none;border-radius:16px;padding:10px 16px;min-height:44px;min-width:44px;font-size:16px;color:var(--ink);background:#fff;box-shadow:0 4px 0 rgba(0,0,0,.18);cursor:pointer}
.owl-ui button:active{transform:translateY(2px);box-shadow:0 2px 0 rgba(0,0,0,.18)}
.owl-ui button.primary{background:var(--red);color:#fff}
.owl-ui button.navy{background:var(--navy);color:#fff}
.owl-ui button:disabled{opacity:.55;cursor:default}
.owl-ui button:focus-visible{outline:3px solid var(--navy);outline-offset:2px}
.owl-ui input{font-family:'Jua',sans-serif;font-size:18px;padding:10px 14px;min-height:48px;border-radius:14px;border:3px solid var(--ink);background:#fff;width:100%;color:var(--ink)}
.owl-ui .hidden{display:none !important}
.owl-ui .overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(25,22,40,.55);z-index:20}
.owl-ui .card{background:var(--paper);border-radius:22px;padding:20px;width:min(440px,100%);max-height:calc(100% - 24px);overflow:auto;box-shadow:0 10px 0 rgba(0,0,0,.25);position:relative}
.owl-ui .dossier{background:radial-gradient(circle at 1px 1px,rgba(60,40,20,.09) 1px,transparent 1.4px) 0 0/6px 6px,var(--paper);border:2px solid #e2cfa9}
.owl-ui .title{font-family:'Jua';font-weight:400;font-size:30px;line-height:1.15;margin:0 0 4px}
.owl-ui .sub{color:#5a4a40;margin:0 0 14px;font-size:14px}
.owl-ui .row{display:flex;gap:8px;align-items:center}
.owl-ui .stack{display:flex;flex-direction:column;gap:10px}
.owl-ui .stamp{position:absolute;right:64px;top:16px;border:3px solid var(--red);color:var(--red);font-family:'Jua';padding:2px 8px;border-radius:8px;transform:rotate(8deg);font-size:14px;opacity:.9;pointer-events:none}
.owl-ui .tag{display:inline-block;font-family:'Jua';font-size:12px;padding:2px 8px;border-radius:999px;background:var(--paper2);margin-right:4px}
.owl-ui .tag.pub{background:var(--navy);color:#fff}
.owl-ui .err{color:var(--red);font-size:14px;min-height:18px}
.owl-ui h3{font-family:'Jua';font-weight:400;margin:14px 0 6px;font-size:18px}
.owl-ui p{margin:6px 0;line-height:1.5}
.owl-ui .secret{background:#2d3557;color:#fff7e8;border-radius:14px;padding:12px}
.owl-ui .secret h3{color:var(--lemon);margin-top:0}
.owl-ui .x{position:absolute;right:10px;top:10px;padding:0;width:44px;height:44px;z-index:2}
.owl-ui .back{padding:6px 12px;font-size:14px;margin-bottom:8px;background:var(--paper2);box-shadow:none}
.owl-ui .note{background:var(--paper2);border-radius:12px;padding:8px 12px;font-family:'Jua';font-size:15px}
.owl-ui .callout{background:var(--lemon);border-radius:12px;padding:10px 12px;font-family:'Jua';font-size:17px;margin:8px 0}
/* HUD */
.owl-ui .hud{position:fixed;left:0;right:0;top:0;padding:calc(env(safe-area-inset-top) + 10px) 12px 0;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;z-index:10;pointer-events:none}
.owl-ui .hud > *{pointer-events:auto}
.owl-ui .pill{background:rgba(251,243,228,.96);border-radius:999px;padding:8px 14px;font-family:'Jua';box-shadow:0 3px 0 rgba(0,0,0,.2);font-size:15px;white-space:nowrap}
.owl-ui .pill b{color:var(--red);font-weight:400}
.owl-ui button.pill{min-height:44px;font-size:13px;padding:6px 14px;font-weight:400}
.owl-ui .hudR{display:flex;flex-direction:column;gap:8px;align-items:flex-end}
.owl-ui .bagBtn{position:relative;font-size:22px;padding:6px 12px}
.owl-ui .bagBtn .cnt{position:absolute;right:-6px;top:-6px;min-width:24px;height:24px;border-radius:12px;background:var(--red);color:#fff;font-size:14px;line-height:24px;text-align:center;padding:0 6px;box-shadow:0 2px 0 rgba(0,0,0,.2)}
.owl-ui .act{position:fixed;right:16px;bottom:calc(env(safe-area-inset-bottom) + 24px);z-index:10;background:var(--lemon);font-size:20px;min-height:64px;padding:12px 22px;border-radius:22px;display:flex;align-items:center;gap:8px}
.owl-ui .act kbd{font-family:'Jua';font-size:14px;background:var(--ink);color:#fff;border-radius:6px;padding:1px 7px}
.owl-ui .toasts{position:fixed;left:50%;top:calc(env(safe-area-inset-top) + 172px);transform:translateX(-50%);display:flex;flex-direction:column;gap:6px;align-items:center;z-index:15;pointer-events:none;width:min(92%,420px)}
.owl-ui .toast{background:rgba(251,243,228,.97);border-radius:14px;padding:8px 12px;font-size:14px;box-shadow:0 3px 0 rgba(0,0,0,.2);animation:owlPop .25s ease-out;text-align:center}
.owl-ui .banner{position:fixed;left:50%;top:calc(env(safe-area-inset-top) + 116px);transform:translateX(-50%);z-index:14;pointer-events:none;background:rgba(35,39,66,.88);color:#fff7e8;font-family:'Jua';font-size:22px;padding:8px 22px;border-radius:999px;opacity:0;transition:opacity .25s;white-space:nowrap}
.owl-ui .banner.on{opacity:1}
@keyframes owlPop{from{transform:scale(.8);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes owlShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-10px)}40%{transform:translateX(9px)}60%{transform:translateX(-6px)}80%{transform:translateX(4px)}}
.owl-ui .shake{animation:owlShake .4s ease-in-out}
/* cards */
.owl-ui .mini{width:100%;height:190px;border-radius:16px;background:radial-gradient(circle,#fff 0%,#f1e3c6 75%);display:block;margin:6px 0 10px}
.owl-ui .photo{display:block;width:100%;border:10px solid #8a5a32;border-radius:6px;box-shadow:inset 0 0 0 2px #5e3a1e,0 4px 0 rgba(0,0,0,.2);margin:6px 0 4px;background:#3a2a22;aspect-ratio:3/2}
.owl-ui .caption{text-align:center;font-family:'Jua';font-size:13px;color:#5a4a40;margin:0 0 8px}
.owl-ui .progress{height:14px;border-radius:7px;background:var(--paper2);overflow:hidden;margin:14px 0 8px}
.owl-ui .progress i{display:block;height:100%;width:100%;background:var(--navy);border-radius:7px;transform-origin:left;animation:owlFill 1s linear both}
@keyframes owlFill{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.owl-ui .code{font-size:32px;letter-spacing:12px;text-align:center}
/* bag */
.owl-ui .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.owl-ui .grid button{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 6px;font-size:13px;line-height:1.2;background:#fff;position:relative}
.owl-ui .grid img{width:64px;height:64px;image-rendering:pixelated}
.owl-ui .grid .tag{position:absolute;left:4px;top:4px;margin:0}
/* notebook */
.owl-ui .tabs{display:flex;gap:6px;margin:6px 0 12px}
.owl-ui .tabs button{flex:1;padding:8px 4px;font-size:15px;background:var(--paper2);box-shadow:none}
.owl-ui .tabs button.on{background:var(--ink);color:#fff}
.owl-ui .ev{display:block;width:100%;text-align:left;font-family:'Gowun Dodum',sans-serif;border:2px dashed #d8c39b;border-radius:14px;padding:10px;margin-bottom:8px;background:rgba(255,255,255,.5);box-shadow:none}
.owl-ui .ev .n{font-family:'Jua';font-size:16px}
.owl-ui .who{display:flex;gap:10px;align-items:flex-start;padding:10px;border-radius:14px;background:rgba(255,255,255,.55);margin-bottom:8px}
.owl-ui .dot{width:44px;height:44px;border-radius:50%;flex:none;border:3px solid var(--ink);background:#f3e6cc;image-rendering:pixelated;object-fit:cover}
.owl-ui .mini-gl{width:100%;height:100%;display:block}
.owl-ui .map{width:100%;height:auto;background:#fffaf0;border-radius:14px;border:2px solid #e2cfa9}
.owl-ui .voteBtn{width:100%;display:flex;align-items:center;gap:10px;text-align:left;margin-bottom:8px}
.owl-ui .voteBtn.on{outline:4px solid var(--red)}
.owl-ui .bar{height:10px;border-radius:6px}
.owl-ui .spin{width:44px;height:44px;border-radius:50%;border:5px solid var(--paper2);border-top-color:var(--navy);margin:8px auto;animation:owlSpin 1s linear infinite}
@keyframes owlSpin{to{transform:rotate(360deg)}}
.owl-ui .conn{z-index:40}
.owl-fly{position:fixed;left:0;top:0;width:72px;height:72px;margin:-36px 0 0 -36px;z-index:50;pointer-events:none;image-rendering:pixelated}
`;

// Block mini view per item: [prop name, opt]. Portable items use DECOR.itemLooks.
const FIXED_LOOKS = {
  body: ['body'], shoes: ['shoes'], safe: ['safe'], debutbook: ['books_stack', { n: 1 }], oddbook: ['books_stack', { n: 3 }],
  fountain: ['fountain', { stain: [0, 0] }], rosethread: ['rosebush', { w: 1.5, d: 0.75, thread: 0.5 }],
  dragmarks: ['drag_marks', { w: 1.5, d: 1.5 }], photo: ['photo_frame'], blueprint: ['pinned_paper'], vase: ['broken_vase'],
};
const VICTIM_LOOK = { skin: '#efc9a8', hair: 'neat', hairColor: '#d6d6d6', top: '#5a3a5e', bottom: '#2b2b33', accessories: ['glasses'] };
const DISCONNECT_TEXT = {
  refused: ['들어갈 수 없어요', '이 기기로는 이 방에 다시 들어갈 수 없어요.'],
  replaced: ['다른 곳에서 접속했어요', '같은 기기의 다른 탭이나 창에서 이 방에 다시 들어와서, 이 화면의 연결은 끝났어요.'],
  lost: ['연결이 끊겼어요', '방장과 다시 연결하지 못했어요. 방 코드로 다시 들어와 주세요.'],
  'host-left': ['방이 닫혔어요', '방장이 게임을 나가서 방이 끝났어요.'],
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── shared offscreen WebGL renderer (one context for every mini view, icon and the photo) ──
let R3 = null;
function r3() {
  if (!R3) {
    R3 = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    R3.setPixelRatio(1);
    R3.outputColorSpace = THREE.SRGBColorSpace;
    R3.setClearColor(0x000000, 0);
    R3.domElement.className = 'mini-gl';
  }
  return R3;
}
// Resize the shared renderer only when the size really changes (resizing reallocates the buffer).
let r3w = 0, r3h = 0;
function sizeR3(w, h) {
  const R = r3();
  if (w !== r3w || h !== r3h) { R.setSize(w, h, false); r3w = w; r3h = h; }
  return R;
}
function miniLights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb59b7a, 1.7));
  const d = new THREE.DirectionalLight(0xffffff, 1.3);
  d.position.set(2, 4, 3);
  scene.add(d);
}

function buildModel(caseData, id) {
  const look = caseData.DECOR?.itemLooks?.[id] ? [caseData.DECOR.itemLooks[id][0]] : FIXED_LOOKS[id];
  const vb = new VoxelBuilder();
  try {
    PROPS[look?.[0] ?? 'crate'](vb, 0, 0, 0, 0, { ...(look?.[1] ?? {}), solid: false });
  } catch {
    PROPS.crate(vb, 0, 0, 0, 0, { solid: false });
  }
  return vb.build();
}

// Model centred in a holder; per-instance base positions for the teardown (blocks drift apart and back).
function modelRig(caseData, id) {
  const model = buildModel(caseData, id);
  const box = new THREE.Box3().setFromObject(model);
  const ctr = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2 || 0.5;
  model.position.sub(ctr);
  const holder = new THREE.Group();
  holder.add(model);
  const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const parts = model.children.filter(c => c.isInstancedMesh).map(mesh => {
    const base = [];
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m4);
      m4.decompose(p, q, s);
      const dir = p.clone().sub(ctr);
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
      base.push({ p: p.clone(), s: s.x, dir: dir.normalize() });
    }
    return { mesh, base };
  });
  return { holder, model, parts, radius };
}
const EXPLODE_M4 = new THREE.Matrix4();
function explode(rig, amount) {
  const m4 = EXPLODE_M4;
  for (let k = 0; k < rig.parts.length; k++) {
    const { mesh, base } = rig.parts[k];
    for (let i = 0; i < base.length; i++) {
      const b = base[i];
      m4.makeScale(b.s, b.s, b.s).setPosition(b.p.x + b.dir.x * amount, b.p.y + b.dir.y * amount, b.p.z + b.dir.z * amount);
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
}
function disposeRig(rig) {
  for (const { mesh } of rig.parts) mesh.dispose(); // geometry + materials are shared caches
}
function fitCamera(radius, aspect) {
  const cam = new THREE.PerspectiveCamera(35, aspect, 0.01, 100);
  const dist = radius / Math.sin(THREE.MathUtils.degToRad(17.5)) * (aspect < 1 ? 1.25 : 1.05);
  cam.position.set(0, dist * 0.35, dist);
  cam.lookAt(0, 0, 0);
  return cam;
}

const iconCache = new Map();
function itemIcon(caseData, id) {
  if (iconCache.has(id)) return iconCache.get(id);
  let url = '';
  try {
    const scene = new THREE.Scene();
    miniLights(scene);
    const rig = modelRig(caseData, id);
    rig.holder.rotation.set(0.35, -0.6, 0);
    scene.add(rig.holder);
    const R = sizeR3(128, 128);
    R.render(scene, fitCamera(rig.radius, 1));
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    c.getContext('2d').drawImage(R.domElement, 0, 0);
    url = c.toDataURL();
    disposeRig(rig);
  } catch { /* no WebGL: icon stays blank */ }
  iconCache.set(id, url);
  return url;
}

// Head-and-shoulders portrait of a block character (role cards, people tab, vote buttons).
const portraitCache = new Map();
function portrait(look) {
  const key = JSON.stringify(look);
  if (portraitCache.has(key)) return portraitCache.get(key);
  let url = '';
  try {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff4e6, 0x8a6a50, 1.6));
    const d = new THREE.DirectionalLight(0xffffff, 1.1);
    d.position.set(1, 2, 3);
    scene.add(d);
    const ch = makeCharacter(look, '');
    ch.group.rotation.y = -0.25;
    scene.add(ch.group);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    cam.position.set(0, 1.32, 1.65); // head centre is at y 1.35 (hips 0.6 + torso 0.5 + head/2)
    cam.lookAt(0, 1.22, 0);
    const R = sizeR3(96, 96);
    R.render(scene, cam);
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    c.getContext('2d').drawImage(R.domElement, 0, 0);
    url = c.toDataURL();
    disposeCharacter(ch);
  } catch { /* no WebGL */ }
  portraitCache.set(key, url);
  return url;
}
const portraitImg = (look, extra = '') => `<img class="dot" alt="" src="${portrait(look)}"${extra}/>`;

let photoUrl = null;
function partyPhoto(caseData) {
  if (photoUrl !== null) return photoUrl;
  photoUrl = '';
  try {
    const R = r3();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x6b3f2a);
    scene.add(new THREE.HemisphereLight(0xfff0dc, 0x5a4636, 1.5));
    const key = new THREE.DirectionalLight(0xffe0b0, 1.4);
    key.position.set(1, 3, 5);
    scene.add(key);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 6).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x8a5a32 }));
    scene.add(floor);
    const vb = new VoxelBuilder();
    PROPS.fireplace(vb, -1.25, 0, -1.6, 0, { solid: false });
    const fire = vb.build();
    scene.add(fire);
    const R0 = caseData.ROLES;
    const line = [R0.yujin.look, R0.hanbyul.look, VICTIM_LOOK, R0.sera.look, R0.doyun.look];
    const chars = line.map((look, i) => {
      const ch = makeCharacter(look, '');
      ch.group.position.set((i - 2) * 0.72, 0, 0);
      ch.group.rotation.y = (2 - i) * 0.06;
      scene.add(ch.group);
      return ch;
    });
    const cam = new THREE.PerspectiveCamera(30, 1.5, 0.1, 50);
    cam.position.set(0, 1.45, 4.6);
    cam.lookAt(0, 1.1, 0);
    sizeR3(750, 500);
    R.render(scene, cam);
    const c = document.createElement('canvas');
    c.width = 750; c.height = 500;
    c.getContext('2d').drawImage(R.domElement, 0, 0);
    photoUrl = c.toDataURL('image/jpeg', 0.9);
    chars.forEach(disposeCharacter);
    fire.children.forEach(m => m.dispose?.());
    floor.geometry.dispose();
    floor.material.dispose();
  } catch { /* no WebGL */ }
  return photoUrl;
}

// ────────────────────────────────────────────────────────────────────────────

export function createUI({ caseData, net: net0 = null, getState, me = null, onAction, root = document.body } = {}) {
  const CASE = caseData;
  const ROLE_KEYS = Object.keys(CASE.ROLES).filter(k => k !== 'helper');
  const room = id => CASE.MAP.rooms.find(r => r.id === id);
  const itemDef = id => CASE.ITEMS.find(i => i.id === id);
  const finePointer = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;

  let net = null;
  let S0 = null;              // last state from onState
  let prevPhase = null, prevBag = null;
  const examined = new Set(); // items whose card I opened (notebook 증거 tab)
  const revealed = new Set(); // containers I searched / the safe I opened (local only)
  const revealCbs = [];
  let pendingPick = null, pendingTimer = 0;
  let flying = 0;
  let nearby = null;
  let modal = null;           // { kind, arg, back }
  let mini = null;            // running mini view
  let searchTimer = 0;
  let connState = 'connected';

  const S = () => S0 ?? getState?.() ?? null;
  const pid = () => net?.pid ?? null;
  const send = a => net?.send(a);
  const myRole = () => S()?.players?.[pid()]?.role ?? null;

  // ── DOM ──
  if (!document.getElementById('owl-ui-css')) {
    const st = document.createElement('style');
    st.id = 'owl-ui-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const el = document.createElement('div');
  el.className = 'owl-ui';
  el.innerHTML = `
  <div class="hud hidden" data-r="hud">
    <div class="stack" style="gap:6px;align-items:flex-start">
      <div class="pill" data-r="phase">대기실</div>
      <button class="pill" data-r="code" aria-label="방 코드 복사">방 코드 ----</button>
    </div>
    <div class="hudR">
      <button class="primary hidden" data-r="host"></button>
      <div class="row">
        <button class="navy" data-r="note">📒 수첩</button>
        <button class="bagBtn" data-r="bag" aria-label="내 가방">🎒<span class="cnt hidden" data-r="cnt">0</span></button>
      </div>
      <button class="primary hidden" data-r="vote">🗳️ 투표</button>
    </div>
  </div>
  <div class="toasts" data-r="toasts" aria-live="polite"></div>
  <div class="banner" data-r="banner"></div>
  <button class="act hidden" data-r="act"><span data-r="actTxt">🔍 조사</span>${finePointer ? '<kbd>E</kbd>' : ''}</button>
  <div class="overlay hidden" data-r="start" style="background:rgba(25,22,40,.35)">
    <div class="card dossier">
      <div class="stamp">CASE #1121</div>
      <p class="sub jua" style="margin:0">친구들과 각자 폰으로 접속하는 추리 게임</p>
      <h1 class="title">하얀 부엉이<br/>저택 사건</h1>
      <p class="sub">폭설로 길이 끊긴 송년 파티의 밤, 추리소설가가 서재에서 숨진 채 발견됐다. 범인은 우리 중 한 명.</p>
      <div class="stack">
        <input data-r="name" maxlength="8" placeholder="닉네임 (8자까지)" autocomplete="nickname" />
        <button class="primary" data-r="create">방 만들기</button>
        <div class="row">
          <input data-r="codeIn" maxlength="4" placeholder="방 코드" style="text-transform:uppercase" autocomplete="off" />
          <button class="navy" data-r="join" style="flex:none">참가</button>
        </div>
        <div class="err" data-r="startErr" role="alert"></div>
        <p class="sub" style="margin:0">💡 대화는 보이스톡이나 디스코드로 하면서 플레이하세요. 추천 인원 4명 (1~6명 가능)</p>
      </div>
    </div>
  </div>
  <div class="overlay hidden" data-r="modal"><div class="card dossier" data-r="card" role="dialog" aria-modal="true"></div></div>
  <div class="overlay conn hidden" data-r="conn"><div class="card dossier" data-r="connCard" role="alertdialog" aria-modal="true"></div></div>`;
  root.appendChild(el);
  const $ = r => el.querySelector(`[data-r="${r}"]`);
  const card = $('card');

  // ── toast / banner ──
  function toast(text) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = text;
    $('toasts').appendChild(d);
    setTimeout(() => d.remove(), 4200);
    while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
  }
  let bannerTimer = 0;
  function showRoomBanner(name) {
    const b = $('banner');
    b.textContent = name;
    b.classList.add('on');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => b.classList.remove('on'), 1500);
  }

  // ── modal plumbing ──
  function openModal(kind, arg, html, { closable = true, back = null } = {}) {
    stopMini();
    clearTimeout(searchTimer);
    modal = { kind, arg, back, closable };
    const backBtn = back ? `<button class="back" data-r="backBtn">← ${back.kind === 'bag' ? '가방' : '수첩'}으로</button>` : '';
    card.innerHTML = (closable ? '<button class="x" data-r="close" aria-label="닫기">✕</button>' : '') + backBtn + html;
    $('modal').classList.remove('hidden');
    card.scrollTop = 0;
    $('close')?.addEventListener('click', closeModal);
    $('backBtn')?.addEventListener('click', () => (back.kind === 'bag' ? openBag() : openNotebook(back.arg)));
  }
  function closeModal() {
    stopMini();
    clearTimeout(searchTimer);
    modal = null;
    $('modal').classList.add('hidden');
    card.innerHTML = '';
  }
  $('modal').addEventListener('pointerdown', e => { if (e.target === $('modal') && modal?.closable) closeModal(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && modal?.closable && connState !== 'disconnected') closeModal(); });
  function refreshModal() {
    if (!modal) return;
    const { kind, arg } = modal;
    const top = card.scrollTop;
    requestAnimationFrame(() => { if (modal?.kind === kind) card.scrollTop = top; });
    if (kind === 'note') openNotebook(arg);
    else if (kind === 'bag') openBag();
    else if (kind === 'item') {
      // someone took it while I was looking: re-open so the title and mini view switch to "사라진 증거"
      if (cardFor(S(), CASE, pid(), arg)?.mode === 'gone' && !modal.gone) openCard(arg, modal.back?.kind ?? null, modal.group);
      else renderCardBody(arg);
    }
    else if (kind === 'vote') openVote();
    // intro / reveal / search / code: static
  }

  // ── mini view ──
  // The shared renderer's own canvas is put into the card (no 2D copy). It is sized when the card
  // opens and on window resize only, rendered at 30 fps with DPR capped at 1.5, and nothing is
  // allocated per frame.
  const MINI_DT = 1 / 30;
  function startMini(id, slot) {
    try {
      const scene = new THREE.Scene();
      miniLights(scene);
      const rig = modelRig(CASE, id);
      scene.add(rig.holder);
      const R = r3();
      slot.appendChild(R.domElement);
      mini = { id, slot, scene, rig, t: 0, acc: MINI_DT, cam: null, w: 0, h: 0 };
      sizeMini();
      drawMini(0);
    } catch { mini = null; }
  }
  function sizeMini() {
    if (!mini) return;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const w = Math.round(mini.slot.clientWidth * dpr), h = Math.round(mini.slot.clientHeight * dpr);
    if (!w || !h) return;
    mini.w = w; mini.h = h;
    mini.cam = fitCamera(mini.rig.radius * 1.15, w / h);
  }
  addEventListener('resize', sizeMini);
  function drawMini(dt) {
    if (!mini) return;
    if (!mini.slot.isConnected) { stopMini(); return; }
    mini.t += dt;
    mini.acc += dt;
    if (mini.acc < MINI_DT || !mini.cam) return;
    mini.acc = 0;
    const t = mini.t;
    mini.rig.holder.rotation.y = t * 0.6;
    mini.rig.holder.rotation.x = 0.25 + Math.sin(t * 0.5) * 0.12;
    explode(mini.rig, Math.max(0, Math.sin(t * 0.9)) * 0.12 * mini.rig.radius);
    const R = sizeR3(mini.w, mini.h); // no-op unless an icon render resized it meanwhile
    if (R.domElement.parentNode !== mini.slot) mini.slot.appendChild(R.domElement);
    R.render(mini.scene, mini.cam);
  }
  function stopMini() {
    if (!mini) return;
    disposeRig(mini.rig);
    if (R3?.domElement.parentNode) R3.domElement.remove();
    mini = null;
  }

  // ── HUD ──
  let phaseHtml = '';
  function renderHud() {
    const s = S();
    if (!s) return;
    const ph = s.phase;
    let txt = esc(phaseLabel(ph));
    if (ph === 'lobby') txt += ` · ${s.order.filter(id => s.players[id]).length}명`;
    if (s.phaseEndsAt) txt += ' <b data-r="timer"></b>';
    if (txt !== phaseHtml) { $('phase').innerHTML = phaseHtml = txt; timerText = null; }
    tickTimer();
    const label = hostNextLabel(ph);
    $('host').classList.toggle('hidden', !net?.isHost || !label);
    $('host').textContent = label ?? '';
    $('vote').classList.toggle('hidden', !(ph === 'vote' || ph === 'reveal'));
    $('vote').textContent = ph === 'reveal' ? '🔎 진상 보기' : '🗳️ 투표';
    const n = Math.max(0, bagItems(s, CASE, pid()).length - flying);
    $('cnt').textContent = n;
    $('cnt').classList.toggle('hidden', n === 0);
    renderAct();
  }
  let timerText = null; // last text written (null = timer element was just rebuilt)
  function tickTimer() {
    const s = S();
    if (!s?.phaseEndsAt) return;
    const txt = formatRemaining(s.phaseEndsAt - Date.now());
    if (txt === timerText) return;
    const tm = $('timer');
    if (tm) { tm.textContent = txt; timerText = txt; }
  }
  const HOST_CONFIRM = {
    lobby: '지금 인원으로 게임을 시작할까요?\n(시작 후 들어온 사람은 남은 역할이나 조수 탐정이 돼요)',
    finaltalk: '투표를 시작할까요?', vote: '결과를 공개할까요?',
  };
  $('host').onclick = () => {
    const ph = S()?.phase;
    if (HOST_CONFIRM[ph] && !confirm(HOST_CONFIRM[ph])) return;
    send({ t: 'next' });
  };
  $('code').onclick = () => {
    if (!net) return;
    navigator.clipboard?.writeText(net.code).catch(() => {});
    toast(`📋 방 코드를 복사했어요: ${net.code}`);
  };
  $('note').onclick = () => openNotebook('role');
  $('bag').onclick = () => openBag();
  $('vote').onclick = () => (S()?.phase === 'reveal' ? openReveal() : openVote());

  // ── action button ──
  function nearbyOk(t) {
    const s = S();
    if (!t || !s) return false;
    if (t.kind === 'item') return canInvestigate(s.phase) && !!itemDef(t.id);
    if (t.kind === 'passage') return canUsePassage(s, CASE, pid());
    return t.kind === 'stair' || t.kind === 'stairs';
  }
  let actShown = null; // last label written ('' = hidden)
  function renderAct() {
    const label = !nearbyOk(nearby) ? '' : nearby.kind === 'item' ? '🔍 조사' : nearby.kind === 'passage' ? '🕳️ 통로' : '🪜 계단';
    if (label === actShown) return;
    actShown = label;
    $('act').classList.toggle('hidden', !label);
    if (label) $('actTxt').textContent = label;
  }
  $('act').onclick = () => {
    if (!nearbyOk(nearby)) return;
    if (nearby.kind === 'item') openItem(nearby.id);
    else onAction?.(nearby);
  };

  // ── start screen ──
  function openStart(onCreate, onJoin) {
    $('start').classList.remove('hidden');
    try { $('name').value = localStorage.getItem('owl-name') || ''; } catch { /* storage blocked */ }
    const urlCode = new URLSearchParams(location.search).get('room');
    if (urlCode) $('codeIn').value = urlCode.toUpperCase().slice(0, 4);
    const busy = (on, msg = '') => { $('create').disabled = $('join').disabled = on; $('startErr').textContent = msg; };
    const getName = () => {
      const n = $('name').value.trim();
      if (!n) { busy(false, '닉네임을 입력해 주세요.'); return null; }
      try { localStorage.setItem('owl-name', n); } catch { /* storage blocked */ }
      return n;
    };
    const run = (p, msg) => {
      busy(true, msg);
      Promise.resolve(p).then(() => { busy(false); $('start').classList.add('hidden'); })
        .catch(e => busy(false, e?.message || '연결하지 못했어요.'));
    };
    $('create').onclick = () => { const n = getName(); if (n) run(onCreate?.(n), '방을 만드는 중…'); };
    $('join').onclick = () => {
      const n = getName();
      if (!n) return;
      const c = $('codeIn').value.trim().toUpperCase();
      if (c.length !== 4) { busy(false, '4자리 방 코드를 입력해 주세요.'); return; }
      run(onJoin?.(n, c), '접속하는 중…');
    };
    $('codeIn').onkeydown = e => { if (e.key === 'Enter') $('join').click(); };
  }

  function setNet(n) {
    net = n;
    $('start').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('code').textContent = `방 코드 ${n.code}`;
    if (n.isHost) toast(`방이 열렸어요! 친구들에게 코드 ${n.code}를 알려 주세요.`);
    renderHud();
  }

  // ── role card ──
  function roleCardHtml(k) {
    const r = CASE.ROLES[k] ?? CASE.ROLES.helper;
    return `<div class="row" style="gap:12px;margin-bottom:8px;align-items:flex-start">${portraitImg(r.look)}
      <div><div class="jua" style="font-size:22px">${esc(r.name)} <span class="tag">${esc(r.job)}</span></div><div class="sub" style="margin:0">${esc(r.public)}</div></div></div>
      <div class="secret"><h3>🤫 나만 아는 비밀</h3><p>${esc(r.secret)}</p><h3>👀 내가 본 것</h3><p>${esc(r.knows)}</p><h3>🎯 목표</h3><p>${esc(r.goal)}</p>
      ${r.knowsPassage ? '<p>🕳️ 서재 책장과 온실 화분대를 잇는 비밀 통로를 처음부터 알고 있어요. 언제든 쓸 수 있어요.</p>' : ''}</div>`;
  }
  function openIntro() {
    openModal('intro', null, `<div class="stamp">TOP SECRET</div><p class="sub jua" style="margin:0">CASE #1121</p><h2 class="title">${esc(CASE.title)}</h2>
      <p>${esc(CASE.intro)}</p><h3>당신의 역할</h3>${roleCardHtml(myRole())}
      <p class="sub" style="margin-top:12px">🔒 다른 사람에게 화면을 보여 주지 마세요. 이 카드는 📒 수첩에서 다시 볼 수 있어요.</p>
      ${net?.isHost ? '<p class="sub">방장: 모두 읽었으면 오른쪽 위 <b>조사 시작</b>을 눌러 주세요.</p>' : '<p class="sub">방장이 조사를 시작할 때까지 기다려 주세요.</p>'}`);
  }

  // ── evidence: search / safe / card ──
  function reveal(id) {
    if (revealed.has(id)) return;
    revealed.add(id);
    for (const cb of revealCbs) { try { cb(id); } catch (e) { console.error(e); } }
  }
  function openItem(id, from = null) {
    const s = S();
    const it = itemDef(id);
    if (!s || !it) return;
    if (!from && !canInvestigate(s.phase)) { toast('조사 시간이 되면 살펴볼 수 있어요'); return; }
    const step = from ? 'open' : searchStep(CASE, id, revealed);
    if (step === 'search') openSearch(id);
    else if (step === 'code') openSafe(id);
    else openCard(id, from);
  }
  function openSearch(id) {
    const it = itemDef(id);
    openModal('search', id, `<div class="stamp">수색</div><p class="sub jua" style="margin:0">${esc(room(it.room)?.name)}</p>
      <h2 class="title" style="font-size:26px">🔍 ${esc(containerName(it.container))} 조사</h2>
      <div class="progress" role="progressbar" aria-label="뒤지는 중"><i></i></div><p class="jua" style="text-align:center">뒤지는 중…</p>`);
    searchTimer = setTimeout(() => {
      if (modal?.kind !== 'search' || modal.arg !== id) return;
      // one search finds everything in that container (guestA's bag: manuscript + pills)
      const group = searchGroup(CASE, id);
      for (const g of group) reveal(g);
      openCard(id, null, group);
    }, 1000);
  }
  function openSafe(id) {
    openModal('code', id, `<div class="stamp">잠김</div><p class="sub jua" style="margin:0">${esc(room(itemDef(id).room)?.name)}</p>
      <h2 class="title" style="font-size:26px">🔐 벽 금고</h2><p>네 자리 비밀번호를 입력하세요.</p>
      <div class="stack"><input class="code" data-r="safeIn" inputmode="numeric" maxlength="4" autocomplete="off" aria-label="금고 비밀번호" />
      <div class="err" data-r="safeErr" role="alert"></div><button class="primary" data-r="safeGo">열기</button></div>`);
    const input = $('safeIn');
    setTimeout(() => input?.focus(), 50);
    const tryOpen = () => {
      if (checkSafeCode(input.value)) {
        reveal(id);
        toast('딸깍! 금고 문이 열렸다');
        openCard(id);
        return;
      }
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
      $('safeErr').textContent = '번호가 맞지 않아요';
      input.value = '';
      input.focus();
    };
    $('safeGo').onclick = tryOpen;
    input.onkeydown = e => { if (e.key === 'Enter') tryOpen(); };
    card.addEventListener('animationend', () => card.classList.remove('shake'), { once: true });
  }
  // group: items found together by one search; the card then lists them so none is missed.
  function openCard(id, from = null, group = null) {
    const it = itemDef(id);
    const c = cardFor(S(), CASE, pid(), id);
    const idx = CASE.ITEMS.indexOf(it) + 1;
    const gone = c.mode === 'gone';
    if (!gone) examined.add(id);
    const visual = gone ? '' : id === 'photo'
      ? `<img class="photo" alt="파티 단체 사진: 왼쪽부터 차유진, 한별, 한겨울, 세라, 도윤" src="${partyPhoto(CASE)}"/><p class="caption">송년 파티 · 밤 9시 30분</p>`
      : '<div class="mini" data-r="mini" aria-hidden="true"></div>';
    openModal('item', id, `<div class="stamp">EVIDENCE #${String(idx).padStart(2, '0')}</div>
      <p class="sub jua" style="margin:0">${esc(room(it.room)?.name)}${it.kind === 'fixed' ? ' · 고정 증거' : ''}</p>
      <h2 class="title" style="font-size:26px">${gone ? '사라진 증거' : esc(it.name)}</h2>${visual}<div data-r="body"></div>`,
    { back: from === 'bag' ? { kind: 'bag' } : from === 'note' ? { kind: 'note', arg: 'ev' } : null });
    modal.group = group && group.length > 1 ? group : null;
    modal.gone = gone;
    if (!gone && id !== 'photo') startMini(id, $('mini'));
    if (id === 'oddbook' && !gone) {
      const s = S();
      if (!s.passageKnown?.[pid()] && canPickPhase(s.phase)) send({ t: 'discoverPassage' });
    }
    renderCardBody(id);
  }
  function renderCardBody(id) {
    const body = $('body');
    if (!body) return;
    const s = S();
    const it = itemDef(id);
    const c = cardFor(s, CASE, pid(), id);
    const group = modal?.group;
    const found = group ? `<div class="found"><p class="jua" style="margin:12px 0 6px">🔍 ${esc(containerName(it.container))}에서 ${group.length}개를 찾았다</p>
      <div class="row" style="flex-wrap:wrap">${group.map(g => `<button data-found="${esc(g)}" class="${g === id ? 'navy' : ''}" ${g === id ? 'aria-current="true"' : ''}>${esc(itemDef(g).name)}</button>`).join('')}</div></div>` : '';
    const bindFound = () => card.querySelectorAll('[data-found]').forEach(b => {
      if (b.dataset.found !== id) b.onclick = () => openCard(b.dataset.found, null, group);
    });
    if (c.mode === 'gone') {
      body.innerHTML = '<p>여기엔 <b>무언가 있었던 흔적</b>만 남아 있다. 누군가 먼저 챙겨 간 것 같다…</p>' + found;
      bindFound();
      return;
    }
    let html = `<p>${esc(it.desc)}</p>`;
    if (id === 'oddbook') {
      html += '<div class="callout">책장 뒤에 통로가 있다!</div>';
      if (s.passageShared) html += '<p class="sub">📢 이제 모두가 이 통로를 알고 있어요.</p>';
      else if (canUsePassage(s, CASE, pid()) && canPickPhase(s.phase)) html += '<button class="navy" data-r="sharePassage" style="width:100%">🕳️ 모두에게 통로 알리기</button>';
    }
    let act = '';
    if (c.mode === 'fixed') act = '<p class="note">📌 고정 증거 — 챙길 수 없어요</p>';
    else if (c.mode === 'loose') {
      act = c.canPick
        ? `<button class="primary" data-r="pick" style="width:100%" ${pendingPick === id ? 'disabled' : ''}>${pendingPick === id ? '가방에 넣는 중…' : '🎒 가방에 넣기'}</button>
           <p class="sub" style="margin:0">가방에 넣으면 다른 사람은 이 증거를 볼 수 없어요.</p>`
        : '<p class="note">조사 시간에만 가방에 넣을 수 있어요</p>';
    } else if (c.mode === 'mine') {
      act = '<p><span class="tag">🎒 내 가방</span>' + (c.shared ? '<span class="tag pub">📢 공개됨</span>' : '') + '</p>';
      if (c.canShare) act += '<button class="navy" data-r="share" style="width:100%">📢 공개</button><p class="sub" style="margin:0">공개하면 모두의 수첩 증거 탭에 올라가요.</p>';
    } else if (c.mode === 'shared') {
      act = `<p><span class="tag pub">📢 공개됨</span><span class="tag">🎒 ${esc(s.players[s.items[id].holder]?.name ?? '')}의 가방</span></p>`;
    }
    body.innerHTML = html + `<div class="stack" style="margin-top:10px">${act}</div>` + found;
    bindFound();
    $('pick')?.addEventListener('click', () => pick(id));
    $('share')?.addEventListener('click', () => send({ t: 'share', id }));
    $('sharePassage')?.addEventListener('click', () => send({ t: 'sharePassage' }));
  }
  function pick(id) {
    pendingPick = id;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { if (pendingPick === id) { pendingPick = null; refreshModal(); } }, 3000);
    send({ t: 'pick', id });
    renderCardBody(id);
  }

  // icon flies from `from` (DOMRect or null = screen centre) into the 🎒 button, then the count bumps
  function flyToBag(id, from) {
    const to = $('bag').getBoundingClientRect();
    const x0 = from ? from.left + from.width / 2 : innerWidth / 2, y0 = from ? from.top + from.height / 2 : innerHeight / 2;
    const x1 = to.left + to.width / 2, y1 = to.top + to.height / 2;
    const img = document.createElement('img');
    img.className = 'owl-fly';
    img.alt = '';
    img.src = itemIcon(CASE, id);
    el.appendChild(img);
    flying++;
    const done = () => {
      img.remove();
      flying = Math.max(0, flying - 1);
      renderHud();
      $('bag').animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' });
    };
    if (!img.animate) { done(); return; }
    const mx = (x0 + x1) / 2, my = Math.min(y0, y1) - 80;
    const a = img.animate([
      { transform: `translate(${x0}px,${y0}px) scale(1.4)`, opacity: 1 },
      { transform: `translate(${mx}px,${my}px) scale(1)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${x1}px,${y1}px) scale(.35)`, opacity: 0.7 },
    ], { duration: 700, easing: 'ease-in' });
    a.onfinish = done;
    a.oncancel = done;
  }

  // ── bag ──
  function openBag() {
    const list = bagItems(S() ?? { items: {} }, CASE, pid());
    const grid = list.length
      ? `<div class="grid">${list.map(({ item, shared }) => `<button data-item="${esc(item.id)}">
          ${shared ? '<span class="tag pub">공개됨</span>' : ''}<img alt="" src="${itemIcon(CASE, item.id)}"/><span>${esc(item.name)}</span></button>`).join('')}</div>`
      : '<p>가방이 비어 있어요.</p><p class="sub">챙길 수 있는 증거 앞에서 🔍 조사 → <b>가방에 넣기</b>를 눌러 보세요. 서랍·옷장·가방·화분 속도 뒤져 보세요.</p>';
    openModal('bag', null, `<div class="stamp">가방</div><h2 class="title" style="font-size:26px">🎒 내 가방 <span class="tag">${list.length}개</span></h2>
      <p class="sub">가방 속 증거는 나만 볼 수 있어요. 눌러서 살펴보고 공개할 수 있어요.</p>${grid}`);
    card.querySelectorAll('[data-item]').forEach(b => { b.onclick = () => openItem(b.dataset.item, 'bag'); });
  }

  // ── notebook ──
  function openNotebook(tab = 'role') {
    const s = S();
    if (!s) return;
    const TABS = [['role', '내 역할'], ['ev', '증거'], ['who', '인물'], ['map', '지도']];
    const tabs = `<div class="tabs" role="tablist">${TABS.map(([k, n]) => `<button role="tab" aria-selected="${tab === k}" data-t="${k}" class="${tab === k ? 'on' : ''}">${n}</button>`).join('')}</div>`;
    const keepFloor = modal?.kind === 'note' && modal.arg === 'map' ? modal.floor : undefined;
    let body = '';
    if (tab === 'role') {
      const k = myRole();
      body = k ? roleCardHtml(k) : '<p>아직 역할이 없어요. 방장이 게임을 시작하면 비밀 역할 카드가 나와요.</p><p class="sub">대기실에서는 저택을 자유롭게 둘러볼 수 있어요.</p>';
    } else if (tab === 'ev') {
      const list = evidenceList(s, CASE, pid(), examined);
      body = list.length ? list.map(({ item, status, holderName, mine }) => `<button class="ev" data-item="${esc(item.id)}">
          <div class="n">${esc(item.name)} <span class="sub" style="font-size:12px">· ${esc(room(item.room)?.name)}</span></div>
          <div>${status === 'shared' ? `<span class="tag pub">📢 공개됨</span><span class="tag">${mine ? '내 가방' : esc(holderName) + '의 가방'}</span>` : '<span class="tag">📌 고정 증거</span>'}</div>
          <p style="font-size:14px;margin-bottom:0">${esc(item.desc)}</p></button>`).join('')
        : '<p>아직 기록된 증거가 없어요.</p>';
      body += '<p class="sub">내가 살펴본 고정 증거와 누군가 공개한 증거가 여기에 모여요. 내가 챙긴 증거는 🎒 가방에 있어요.</p>';
    } else if (tab === 'who') {
      const byRole = {};
      s.order.forEach(id => { const p = s.players[id]; if (p?.role) (byRole[p.role] ??= []).push(p); });
      const show = [...ROLE_KEYS, ...(byRole.helper ? ['helper'] : [])];
      body = `<p style="font-size:14px">${esc(CASE.intro)}</p>` + show.map(rk => {
        const r = CASE.ROLES[rk];
        const ps = byRole[rk] ?? [];
        const npc = !ps.length && s.phase !== 'lobby';
        return `<div class="who">${portraitImg(r.look)}<div>
          <div class="jua" style="font-size:17px">${esc(r.name)} <span class="tag">${esc(r.job)}</span>${ps.map(p => `<span class="tag">🎮 ${esc(p.name)}</span>`).join('')}${npc ? '<span class="tag">NPC</span>' : ''}</div>
          <div style="font-size:14px">${esc(r.public)}</div>${npc ? `<div style="font-size:14px;margin-top:4px">📝 ${esc(r.npc)}</div>` : ''}</div></div>`;
      }).join('');
    } else if (tab === 'map') {
      body = mapHtml(keepFloor);
    }
    openModal('note', tab, `<h2 class="title" style="font-size:24px">📒 수첩</h2>${tabs}${body}`);
    modal.floor = keepFloor;
    card.querySelectorAll('[data-t]').forEach(b => { b.onclick = () => openNotebook(b.dataset.t); });
    card.querySelectorAll('[data-item]').forEach(b => { b.onclick = () => openItem(b.dataset.item, 'note'); });
    bindFloorBtns();
    function bindFloorBtns() {
      card.querySelectorAll('[data-floor]').forEach(b => {
        b.onclick = () => { modal.floor = +b.dataset.floor; card.querySelector('[data-r="mapBox"]').outerHTML = mapHtml(modal.floor); bindFloorBtns(); };
      });
    }
  }
  function myPos() {
    const s = S();
    const p = s?.players?.[pid()];
    if (me && Number.isFinite(me.x)) return { floor: me.floor ?? p?.floor ?? 0, x: me.x, z: me.z };
    return p ? { floor: p.floor ?? 0, x: p.x, z: p.z } : null;
  }
  function mapHtml(floor) {
    const s = S();
    const pos = myPos();
    const f = floor ?? pos?.floor ?? 0;
    const open = s?.floorsOpen ?? [0];
    const btns = CASE.MAP.floors.map(fl => {
      const locked = !open.includes(fl.id);
      return `<button data-floor="${fl.id}" class="${fl.id === f ? 'navy' : ''}" ${locked ? 'disabled' : ''} aria-label="${esc(fl.name)}${locked ? ' (잠김)' : ''}">${esc(fl.name)}${locked ? ' 🔒' : ''}</button>`;
    }).join('');
    const rooms = CASE.MAP.rooms.filter(r => r.floor === f);
    const xs = rooms.flatMap(r => [r.rect[0], r.rect[2]]), zs = rooms.flatMap(r => [r.rect[1], r.rect[3]]);
    const x0 = Math.min(...xs) - 0.5, z0 = Math.min(...zs) - 0.5, w = Math.max(...xs) - x0 + 0.5, h = Math.max(...zs) - z0 + 0.5;
    const here = pos && pos.floor === f ? rooms.find(r => pos.x >= r.rect[0] && pos.x <= r.rect[2] && pos.z >= r.rect[1] && pos.z <= r.rect[3]) : null;
    const rects = rooms.map(r => {
      const [a, b, c, d] = r.rect;
      const on = here?.id === r.id;
      return `<rect x="${a}" y="${b}" width="${c - a}" height="${d - b}" fill="${on ? '#ffe58a' : '#f3e6cc'}" stroke="#3b2f2a" stroke-width="0.15"/>
        <text x="${(a + c) / 2}" y="${(b + d) / 2}" font-size="${Math.min(1, (c - a) / 4)}" text-anchor="middle" dominant-baseline="middle" fill="#3b2f2a" font-family="Jua,sans-serif">${esc(r.name)}</text>`;
    }).join('');
    const stairs = CASE.MAP.stairs.flatMap(st => [st.a, st.b]).filter(e => room(e.room)?.floor === f)
      .map(e => `<text x="${e.x}" y="${e.z}" font-size="0.9" text-anchor="middle" dominant-baseline="middle">🪜</text>`).join('');
    const dot = pos && pos.floor === f ? `<circle cx="${pos.x}" cy="${pos.z}" r="0.55" fill="#b5352d" stroke="#fff" stroke-width="0.18"/>` : '';
    return `<div data-r="mapBox"><div class="row" style="margin-bottom:8px">${btns}</div>
      <svg class="map" viewBox="${x0} ${z0} ${w} ${h}" role="img" aria-label="${esc(CASE.MAP.floors[f]?.name)} 지도">${rects}${stairs}${dot}</svg>
      <p class="sub">${pos && pos.floor === f ? '🔴 내 위치' + (here ? ` · ${esc(here.name)}` : '') : '다른 층에 있어요'}${open.includes(1) ? '' : ' · 🔒 2층은 조사 2부터 열려요'}</p></div>`;
  }

  // ── vote / reveal ──
  function openVote() {
    const s = S();
    const my = s.votes[pid()];
    const voters = s.order.filter(id => s.players[id]?.online !== false);
    const done = voters.filter(id => s.votes[id]).length;
    const btns = ROLE_KEYS.map(rk => {
      const r = CASE.ROLES[rk];
      return `<button class="voteBtn ${my === rk ? 'on' : ''}" data-v="${rk}" aria-pressed="${my === rk}">${portraitImg(r.look)}<span><b>${esc(r.name)}</b> <span class="tag">${esc(r.job)}</span></span></button>`;
    }).join('');
    const canVote = s.phase === 'vote';
    openModal('vote', null, `<div class="stamp">VOTE</div><h2 class="title">범인은 누구?</h2><p class="sub">${canVote ? '한 명을 골라 주세요. 결과 공개 전까지 바꿀 수 있어요.' : '투표가 끝났어요.'}</p>${btns}
      <p class="sub">투표 완료 ${done} / ${voters.length}명</p>`);
    card.querySelectorAll('[data-v]').forEach(b => { b.disabled = !canVote; b.onclick = () => send({ t: 'vote', target: b.dataset.v }); });
  }
  function openReveal() {
    const s = S();
    const v = voteVerdict(s, CASE, myRole());
    const total = Object.values(v.counts).reduce((a, b) => a + b, 0) || 1;
    const bars = ROLE_KEYS.map(rk => {
      const r = CASE.ROLES[rk];
      const n = v.counts[rk] ?? 0;
      const culprit = rk === v.culprit;
      return `<div style="margin:6px 0"><div class="row" style="justify-content:space-between"><span><b>${esc(r.name)}</b> ${culprit ? '<span class="tag" style="background:#b5352d;color:#fff">범인</span>' : ''}</span><span>${n}표</span></div>
        <div class="bar" style="width:${Math.max(3, n / total * 100)}%;background:${culprit ? '#b5352d' : '#6f625a'}"></div></div>`;
    }).join('');
    openModal('reveal', null, `<div class="stamp">CASE CLOSED</div><h2 class="title" style="margin-top:34px">${esc(v.headline)}</h2>
      ${v.noVotes ? '<p class="sub">아무도 투표하지 않아 범인이 빠져나갔다!</p>' : v.tie ? '<p class="sub">표가 갈려 아무도 지목되지 않았어요. 범인이 빠져나갔다!</p>' : ''}${bars}
      <h3>📜 사건의 진상</h3><p style="white-space:pre-line">${esc(CASE.truth)}</p>
      <h3>🤫 모두의 비밀</h3>${ROLE_KEYS.map(rk => `<p style="font-size:14px"><b>${esc(CASE.ROLES[rk].name)}</b>: ${esc(CASE.ROLES[rk].secret)}</p>`).join('')}`);
  }

  // ── connection ──
  function showConnection(status, info) {
    connState = status;
    const box = $('conn'), c = $('connCard');
    if (status === 'connected') { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    if (status === 'reconnecting') {
      c.innerHTML = `<div class="spin" aria-hidden="true"></div><h2 class="title" style="text-align:center;font-size:26px">재접속 중…</h2>
        <p class="sub" style="text-align:center">연결이 잠깐 끊겼어요. 화면을 켜 둔 채 기다려 주세요.${Number.isFinite(info) ? ` (${info}/10)` : ''}</p>`;
      return;
    }
    const [title, msg] = DISCONNECT_TEXT[info] ?? ['연결이 끝났어요', '게임과의 연결이 끝났어요.'];
    c.innerHTML = `<div class="stamp">연결 끊김</div><h2 class="title" style="font-size:26px">${esc(title)}</h2><p>${esc(msg)}</p>
      <button class="primary" data-r="restart" style="width:100%;margin-top:12px">처음으로</button>`;
    $('restart').onclick = () => {
      const keep = info === 'lost' && net?.code ? `?room=${encodeURIComponent(net.code)}` : '';
      location.href = location.pathname + keep;
    };
    $('restart').focus();
  }

  // ── state / events ──
  function onState(s) {
    S0 = s;
    if (connState === 'reconnecting') showConnection('connected');
    const me0 = pid();
    const bag = new Set(bagItems(s, CASE, me0).map(b => b.item.id));
    if (pendingPick && (bag.has(pendingPick) || s.items[pendingPick]?.holder)) { clearTimeout(pendingTimer); }
    if (prevBag) {
      for (const id of bag) {
        if (prevBag.has(id)) continue;
        let from = null;
        if (modal?.kind === 'item' && modal.arg === id) {
          from = ($('mini') ?? card).getBoundingClientRect();
          if (pendingPick === id) closeModal();
        }
        flyToBag(id, from);
      }
    }
    if (pendingPick && s.items[pendingPick]?.holder) pendingPick = null;
    prevBag = bag;
    const ph = s.phase;
    if (prevPhase !== null && ph !== prevPhase) {
      if (ph === 'intro') openIntro();
      else if (ph === 'investigate1') { if (modal?.kind === 'intro') closeModal(); toast('🔍 조사 1 시작! 1층을 둘러보며 증거를 찾으세요. (12분)'); }
      else if (ph === 'midtalk') toast('💬 중간 토론! 찾은 증거를 공개하고 이야기해 보세요. (5분)');
      else if (ph === 'investigate2') toast('🔍 조사 2 시작! 이제 2층에 올라갈 수 있어요. (10분)');
      else if (ph === 'finaltalk') toast('💬 최종 토론! 범인을 좁혀 보세요. (8분)');
      else if (ph === 'vote') openVote();
      else if (ph === 'reveal') openReveal();
    } else if (prevPhase === null) { // late join / reload: show what the phase needs
      if (ph === 'intro') openIntro();
      else if (ph === 'vote') openVote();
      else if (ph === 'reveal') openReveal();
    }
    const phaseChanged = prevPhase !== ph;
    prevPhase = ph;
    renderHud();
    if (!phaseChanged || !['intro', 'vote', 'reveal'].includes(ph)) refreshModal();
  }
  function onEvent(ev) {
    if (ev?.type === 'toast' && ev.text) toast(ev.text);
  }

  function update(dt) {
    tickTimer();
    if (mini) drawMini(Math.min(dt, 0.1));
  }

  if (net0) setNet(net0);

  return {
    setNet, onState, onEvent, showRoomBanner, openItem: id => openItem(id), openStart, update, toast,
    openNotebook, openBag,
    setNearby(t) { // cheap to call every frame: no allocation or DOM write unless the target changed
      if ((t?.kind ?? null) === (nearby?.kind ?? null) && (t?.id ?? null) === (nearby?.id ?? null)) return;
      nearby = t ? { kind: t.kind, id: t.id } : null;
      renderAct();
    },
    isRevealed: id => revealed.has(id),
    isItemInWorld: id => { const s = S(); return s ? worldItemVisible(s, CASE, id, revealed) : false; },
    onReveal(cb) { revealCbs.push(cb); return () => { const i = revealCbs.indexOf(cb); if (i >= 0) revealCbs.splice(i, 1); }; },
    isModalOpen: () => !!modal || !$('start').classList.contains('hidden') || !$('conn').classList.contains('hidden'),
    showConnection,
  };
}
