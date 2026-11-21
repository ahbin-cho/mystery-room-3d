// Block characters: ~1.6 m tall, 0.5 m cube head with a 16x16 pixel face.
// Geometries and materials are shared across every character (cached by size / colour / look),
// so 8 characters on screen cost ~12 draw calls each and almost no extra GPU memory.
import * as THREE from 'three';
import { makeTexture } from './textures.js';

// ── shared caches ──────────────────────────────────────────────────────
const geoCache = new Map();
const matCache = new Map();
const texCache = new Map();

function texMat(key, tex) {
  let m = matCache.get(key);
  if (!m) matCache.set(key, (m = new THREE.MeshLambertMaterial({ map: tex })));
  return m;
}

// ── 16x16 pixel canvases (same NearestFilter sRGB style as textures.js) ──
const S = 16;
function rgb(c) {
  const n = typeof c === 'number' ? c : parseInt(String(c).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(c, f) {
  return c.map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
}
function pixelTexture(key, draw) {
  let t = texCache.get(key);
  if (t) return t;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const px = (x, y, c) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
  };
  const rect = (x0, y0, x1, y1, c) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(x, y, c);
  };
  draw(px, rect);
  ctx.putImageData(img, 0, 0);
  t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  texCache.set(key, t);
  return t;
}

const has = (look, a) => (look.accessories || []).includes(a);

// Face: fringe in hair colour, brows, two-tone eyes, blush, small mouth. Glasses are drawn on.
function faceTexture(look) {
  const glasses = has(look, 'glasses');
  const key = `face|${look.skin}|${look.hair}|${look.hairColor}|${glasses}`;
  return pixelTexture(key, (px, rect) => {
    const skin = rgb(look.skin), hair = rgb(look.hairColor);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) px(x, y, shade(skin, (x + y) % 3 ? 1 : 0.97));
    // fringe
    if (look.hair === 'neat') {
      rect(0, 0, 15, 1, hair); rect(0, 2, 5, 2, hair); rect(0, 3, 1, 5, hair); rect(14, 2, 15, 5, hair);
      px(6, 2, shade(hair, 0.8));
    } else if (look.hair === 'long') {
      rect(0, 0, 15, 2, hair); rect(0, 3, 1, 15, hair); rect(14, 3, 15, 15, hair);
      rect(3, 3, 6, 3, hair); rect(10, 3, 12, 3, hair); px(2, 3, hair); px(13, 3, hair);
    } else {
      rect(0, 0, 15, 2, hair); rect(0, 3, 1, 6, hair); rect(14, 3, 15, 6, hair);
      for (const x of [2, 3, 5, 8, 9, 12, 13]) px(x, 3, hair);
      px(4, 4, shade(hair, 1.15)); px(11, 4, shade(hair, 1.15));
    }
    // brows
    const brow = shade(hair, 0.85);
    rect(3, 6, 5, 6, brow); rect(10, 6, 12, 6, brow);
    // eyes: white + dark pupil, 2px tall
    const white = [250, 250, 246], pupil = [34, 30, 46];
    rect(3, 8, 5, 9, white); rect(10, 8, 12, 9, white);
    rect(4, 8, 5, 9, pupil); rect(10, 8, 11, 9, pupil);
    px(5, 8, [120, 150, 210]); px(11, 8, [120, 150, 210]); // catch-light
    // nose shadow, blush, mouth
    px(7, 11, shade(skin, 0.86)); px(8, 11, shade(skin, 0.86));
    const blush = [236, 150, 150];
    px(2, 11, blush); px(3, 11, blush); px(12, 11, blush); px(13, 11, blush);
    const lip = [150, 62, 66];
    rect(6, 13, 9, 13, lip); px(5, 12, lip); px(10, 12, lip);
    if (glasses) {
      const fr = [40, 34, 30];
      for (const x0 of [2, 9]) {
        rect(x0, 7, x0 + 4, 7, fr); rect(x0, 10, x0 + 4, 10, fr);
        rect(x0, 7, x0, 10, fr); rect(x0 + 4, 7, x0 + 4, 10, fr);
      }
      px(7, 8, fr); px(8, 8, fr); px(0, 8, fr); px(1, 8, fr); px(14, 8, fr); px(15, 8, fr);
    }
  });
}

// Torso front: outfit details (lapels, buttons, bow tie, pouch, belt) at 16x16.
function torsoTexture(look) {
  const acc = (look.accessories || []).slice().sort().join(',');
  const key = `torso|${look.top}|${look.bottom}|${acc}`;
  return pixelTexture(key, (px, rect) => {
    const top = rgb(look.top);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) px(x, y, shade(top, 0.96 + ((x * 7 + y * 3) % 5) * 0.02));
    const dark = shade(top, 0.7), light = shade(top, 1.18);
    if (has(look, 'butler_suit')) {
      const shirt = [240, 238, 232];
      for (let y = 0; y < 11; y++) rect(7 - Math.floor((10 - y) / 3), y, 8 + Math.floor((10 - y) / 3), y, shirt);
      rect(5, 1, 10, 2, [150, 24, 40]); rect(7, 1, 8, 2, [110, 16, 30]); // bow tie
      for (const y of [5, 8, 11]) px(7, y, [190, 190, 196]);
      rect(0, 14, 15, 15, shade(top, 0.8));
    } else if (has(look, 'trench_coat')) {
      rect(0, 0, 3, 5, light); rect(12, 0, 15, 5, light); // wide collar
      rect(6, 0, 9, 3, [234, 226, 206]); rect(7, 1, 8, 6, [60, 52, 70]); // shirt + tie
      for (let y = 4; y < 16; y++) px(7 + (y % 2), y, dark); // overlap seam
      for (const y of [6, 9, 13]) { px(5, y, [60, 44, 30]); px(10, y, [60, 44, 30]); }
      rect(0, 10, 15, 11, shade(top, 0.62)); rect(7, 10, 8, 11, [200, 170, 90]); // belt + buckle
    } else if (has(look, 'coat')) {
      rect(5, 0, 10, 15, [236, 228, 210]); // shirt under open coat
      rect(7, 1, 8, 9, [60, 80, 70]); // tie
      for (let y = 0; y < 7; y++) { px(4 + Math.floor(y / 2), y, dark); px(11 - Math.floor(y / 2), y, dark); }
      rect(0, 9, 3, 10, dark); rect(12, 9, 15, 10, dark); // pockets
    } else if (has(look, 'hoodie')) {
      rect(4, 0, 11, 1, dark); // hood opening
      rect(5, 2, 5, 6, [240, 236, 228]); rect(10, 2, 10, 6, [240, 236, 228]); // drawstrings
      rect(3, 10, 12, 14, dark); rect(4, 10, 11, 10, shade(top, 0.6)); // kangaroo pouch
      rect(0, 15, 15, 15, shade(top, 0.75)); // ribbed hem
    } else {
      rect(5, 0, 10, 1, dark); px(6, 2, dark); px(9, 2, dark); // collar
      for (const y of [4, 8, 12]) px(8, y, light);
    }
    if (has(look, 'red_shawl')) rect(0, 0, 15, 4, [178, 30, 52]);
  });
}

// ── character assembly ─────────────────────────────────────────────────
const HEAD = 0.5;
const LEG_SEG = 0.3; // thigh + shin = 0.6 hip height
const TORSO_H = 0.5;
const SHOE = '#2a201c';

// All plain-coloured blocks on one pivot are merged into a single vertex-coloured mesh that
// shares one material, so a character is ~12 draw calls. Merged geometries are cached by content.
const blockMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const tmpColor = new THREE.Color();

function blocks(list, parent) {
  if (!list.length) return null;
  const key = 'blk|' + list.map((b) => b.join(',')).join(';');
  let geo = geoCache.get(key);
  if (!geo) {
    const P = unitBox.attributes.position.array, N = unitBox.attributes.normal.array, I = unitBox.index.array;
    const nv = P.length / 3;
    const pos = new Float32Array(list.length * P.length), nor = new Float32Array(list.length * N.length);
    const col = new Float32Array(list.length * P.length), idx = [];
    list.forEach(([w, h, d, x, y, z, c], bi) => {
      tmpColor.set(c);
      for (let v = 0; v < nv; v++) {
        const o = (bi * nv + v) * 3;
        pos[o] = P[v * 3] * w + x; pos[o + 1] = P[v * 3 + 1] * h + y; pos[o + 2] = P[v * 3 + 2] * d + z;
        nor[o] = N[v * 3]; nor[o + 1] = N[v * 3 + 1]; nor[o + 2] = N[v * 3 + 2];
        col[o] = tmpColor.r; col[o + 1] = tmpColor.g; col[o + 2] = tmpColor.b;
      }
      for (const i of I) idx.push(i + bi * nv);
    });
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    geoCache.set(key, geo);
  }
  const m = new THREE.Mesh(geo, blockMat);
  parent.add(m);
  return m;
}

// A box textured only on its front (+z) face: the other faces sample one plain pixel (px,py)
// of the same texture, so the whole box is one material / one draw call.
function frontTexturedBox(w, h, d, px, py) {
  const key = `ftb|${w},${h},${d}|${px},${py}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const u = (px + 0.5) / 16, v = 1 - (py + 0.5) / 16;
    for (let f = 0; f < 6; f++) if (f !== 4) for (let i = f * 4; i < f * 4 + 4; i++) uv.setXY(i, u, v);
    geoCache.set(key, g);
  }
  return g;
}

let shadowGeo, shadowMat;
function blobShadow() {
  if (!shadowGeo) {
    shadowGeo = new THREE.CircleGeometry(0.36, 12).rotateX(-Math.PI / 2);
    shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false });
  }
  const m = new THREE.Mesh(shadowGeo, shadowMat);
  m.position.y = 0.012;
  m.renderOrder = -1;
  return m;
}

function shade3(hexStr, f) {
  const c = shade(rgb(hexStr), f);
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

// Hair / hat / earrings, in head-centre coordinates. Each entry: [w,h,d, x,y,z, colour].
function headBlocks(look) {
  const hc = look.hairColor, top = HEAD / 2, hat = has(look, 'hat'), L = [];
  if (look.hair === 'long') {
    if (!hat) L.push([0.54, 0.1, 0.54, 0, top + 0.03, 0, hc]);
    L.push([0.54, 0.78, 0.08, 0, top - 0.36, -0.27, hc]); // falls down the back
    L.push([0.06, 0.6, 0.4, -0.28, top - 0.3, -0.05, hc], [0.06, 0.6, 0.4, 0.28, top - 0.3, -0.05, hc]);
  } else if (look.hair === 'neat') {
    if (!hat) {
      L.push([0.53, 0.07, 0.53, 0, top + 0.02, 0, hc]);
      L.push([0.2, 0.05, 0.28, 0.1, top + 0.07, 0.1, shade3(hc, 1.2)]); // combed sweep
    }
    L.push([0.53, 0.3, 0.06, 0, top - 0.14, -0.25, hc]);
  } else {
    if (!hat) {
      L.push([0.54, 0.1, 0.54, 0, top + 0.03, 0, hc]);
      L.push([0.14, 0.08, 0.14, -0.1, top + 0.11, 0.04, hc], [0.12, 0.06, 0.12, 0.12, top + 0.1, -0.1, hc]); // tufts
    }
    L.push([0.54, 0.38, 0.06, 0, top - 0.17, -0.26, hc]);
  }
  if (hat) {
    L.push([0.68, 0.04, 0.68, 0, top + 0.02, 0, '#4a3a2c']); // brim
    L.push([0.46, 0.18, 0.46, 0, top + 0.13, 0, '#4a3a2c']); // crown
    L.push([0.47, 0.05, 0.47, 0, top + 0.07, 0, '#2a1e18']); // band
  }
  const ears = (w, h, d, y, c) => L.push([w, h, d, 0.27, y, 0.02, c], [w, h, d, -0.27, y, 0.02, c]);
  if (has(look, 'silver_ring_earrings')) {
    ears(0.03, 0.1, 0.08, -0.14, '#dfe4ee'); // ring: open square loop reads as a hoop
    ears(0.035, 0.03, 0.03, -0.07, '#b9c0cc');
  }
  return L;
}

// Extra outfit blocks hung from the hips group (torso-bottom = y 0).
function outfitBlocks(look) {
  const L = [], top = look.top;
  if (has(look, 'hoodie')) L.push([0.42, 0.2, 0.14, 0, TORSO_H + 0.02, -0.19, shade3(top, 0.82)]); // hood
  if (has(look, 'red_shawl')) {
    L.push([0.62, 0.12, 0.36, 0, TORSO_H - 0.03, 0, '#b21e34']); // over the shoulders
    L.push([0.56, 0.34, 0.05, 0, TORSO_H - 0.24, -0.16, '#b21e34']); // drape down the back
    L.push([0.1, 0.22, 0.04, -0.12, TORSO_H - 0.18, 0.165, '#9a1a2e']); // knotted ends in front
  }
  if (has(look, 'coat')) L.push([0.52, 0.2, 0.3, 0, -0.08, 0, shade3(top, 0.9)]);
  if (has(look, 'trench_coat')) {
    L.push([0.54, 0.34, 0.32, 0, -0.15, 0, shade3(top, 0.92)]); // skirt to the knee
    L.push([0.56, 0.08, 0.32, 0, TORSO_H - 0.02, 0, shade3(top, 1.12)]); // shoulder cape
  }
  if (has(look, 'butler_suit')) L.push([0.36, 0.3, 0.04, 0, -0.1, -0.15, top]); // tailcoat tails
  return L;
}

function makeLabelSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sm = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const s = new THREE.Sprite(sm);
  s.renderOrder = 10;
  s.position.y = HEAD + TORSO_H + 2 * LEG_SEG + 0.42;
  return s;
}

function drawLabel(sprite, text) {
  const tex = sprite.material.map;
  const canvas = tex.image;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  sprite.visible = !!text;
  if (!text) return;
  ctx.font = 'bold 34px "Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif';
  const w = Math.min(canvas.width - 4, ctx.measureText(text).width + 28);
  const x0 = (canvas.width - w) / 2;
  ctx.fillStyle = 'rgba(20,16,28,0.78)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x0, 6, w, 52, 14); else ctx.rect(x0, 6, w, 52);
  ctx.fill();
  ctx.fillStyle = '#fff6e0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, 33, canvas.width - 20);
  tex.needsUpdate = true;
  sprite.scale.set(1.2, 0.3, 1);
}

export function makeCharacter(look, label = '') {
  const group = new THREE.Group();
  group.name = 'character';
  group.add(blobShadow());
  const acc = (look.accessories || []).slice().sort().join(',');

  // Everything above the hips hangs from `hips` so crouching can lower it as one piece.
  const hips = new THREE.Group();
  hips.position.y = 2 * LEG_SEG;
  group.add(hips);

  // torso: front face carries the outfit texture; (1,7) is plain top colour in every outfit
  const body = new THREE.Mesh(frontTexturedBox(0.5, TORSO_H, 0.28, 1, 7),
    texMat(`torsoMat|${look.top}|${look.bottom}|${acc}`, torsoTexture(look)));
  body.position.y = TORSO_H / 2;
  hips.add(body);
  blocks(outfitBlocks(look), hips);

  // head pivots at the neck; (8,15) is plain skin in every face
  const head = new THREE.Group();
  head.position.y = TORSO_H;
  hips.add(head);
  const headCenter = new THREE.Group();
  headCenter.position.y = HEAD / 2;
  head.add(headCenter);
  headCenter.add(new THREE.Mesh(frontTexturedBox(HEAD, HEAD, HEAD, 8, 15),
    texMat(`faceMat|${look.skin}|${look.hair}|${look.hairColor}|${has(look, 'glasses')}`, faceTexture(look))));
  blocks(headBlocks(look), headCenter);
  if (has(look, 'pearl_earrings')) { // pearl mini blocks keep the shared pearl texture
    const g = geoCache.get('pearl') || geoCache.set('pearl', new THREE.BoxGeometry(0.07, 0.07, 0.07)).get('pearl');
    const m = texMat('pearlMat', makeTexture('pearl'));
    for (const sx of [1, -1]) {
      const e = new THREE.Mesh(g, m);
      e.position.set(sx * 0.27, -0.17, 0.02);
      headCenter.add(e);
    }
  }

  // arms pivot at the shoulders: sleeve + hand (white gloves replace skin)
  const hand = has(look, 'white_gloves') ? '#f7f7f2' : look.skin;
  const mkArm = (side) => {
    const a = new THREE.Group();
    a.position.set(side * 0.34, TORSO_H - 0.04, 0);
    hips.add(a);
    blocks([[0.17, 0.36, 0.2, 0, -0.18, 0, look.top], [0.15, 0.1, 0.18, 0, -0.41, 0, hand]], a);
    return a;
  };
  const armL = mkArm(1), armR = mkArm(-1);

  // legs pivot at the hip: thigh, then a knee pivot with shin + shoe
  const mkLeg = (side) => {
    const l = new THREE.Group();
    l.position.set(side * 0.12, 0, 0);
    hips.add(l);
    blocks([[0.22, LEG_SEG, 0.24, 0, -LEG_SEG / 2, 0, look.bottom]], l);
    const knee = new THREE.Group();
    knee.position.y = -LEG_SEG;
    l.add(knee);
    blocks([[0.21, LEG_SEG - 0.06, 0.23, 0, -(LEG_SEG - 0.06) / 2, 0, look.bottom],
      [0.23, 0.07, 0.3, 0, -LEG_SEG + 0.035, 0.03, SHOE]], knee);
    l.userData.knee = knee;
    return l;
  };
  const legL = mkLeg(1), legR = mkLeg(-1);

  const sprite = makeLabelSprite();
  group.add(sprite);
  drawLabel(sprite, label);

  return {
    group,
    parts: { head, body, armL, armR, legL, legR },
    setLabel(text) { drawLabel(sprite, text); },
    _rig: { hips, walk: 0, crouch: 0, phase: Math.random() * 6 },
  };
}

// ── animation ──────────────────────────────────────────────────────────
// walk: limbs swing on a sine; idle: breathing; crouch: knees bend and the upper body sinks.
// Weights ease toward the requested state so switching states never pops.
export function animateCharacter(ch, state, t, dt) {
  const r = ch._rig, p = ch.parts;
  const k = 1 - Math.exp(-(dt || 0) * 10);
  r.walk += ((state === 'walk' ? 1 : 0) - r.walk) * k;
  r.crouch += ((state === 'crouch' ? 1 : 0) - r.crouch) * k;
  const w = r.walk, c = r.crouch;
  const tt = t + r.phase;

  const swing = Math.sin(tt * 9) * 0.65 * w;
  const breathe = Math.sin(tt * 2.2) * (1 - w);

  // crouch geometry: thigh forward, shin back, so the foot stays under the hip
  const thigh = -1.1 * c, kneeBend = 2.0 * c;
  const hipH = LEG_SEG * Math.cos(thigh) + LEG_SEG * Math.cos(thigh + kneeBend);
  const bob = Math.abs(Math.sin(tt * 9)) * 0.045 * w;
  r.hips.position.y = hipH + bob + breathe * 0.006;

  p.legL.rotation.x = thigh + swing;
  p.legR.rotation.x = thigh - swing;
  p.legL.userData.knee.rotation.x = kneeBend + Math.max(0, -swing) * 0.6;
  p.legR.userData.knee.rotation.x = kneeBend + Math.max(0, swing) * 0.6;

  p.armL.rotation.x = -swing * 0.9 - 0.55 * c + breathe * 0.03;
  p.armR.rotation.x = swing * 0.9 - 0.55 * c + breathe * 0.03;
  p.armL.rotation.z = 0.05 + breathe * 0.025;
  p.armR.rotation.z = -0.05 - breathe * 0.025;

  p.body.scale.set(1, 1 + breathe * 0.02, 1);
  p.body.rotation.x = 0.25 * c;
  p.head.position.y = TORSO_H + breathe * 0.01;
  p.head.position.z = 0.06 * c;
  p.head.rotation.x = -0.2 * c + Math.sin(tt * 18) * 0.02 * w;
  p.head.rotation.y = Math.sin(tt * 0.7) * 0.12 * (1 - w) * (1 - c); // idle glance
}

// Pre-assignment lobby looks: distinct colours, no case accessories (only glasses).
export const LOBBY_LOOKS = [
  { skin: '#f2cba8', hair: 'short', hairColor: '#2a1c14', top: '#2f8a86', bottom: '#2e3444', accessories: [] },
  { skin: '#e9bd96', hair: 'neat', hairColor: '#5a3a22', top: '#d9a03a', bottom: '#3c3a36', accessories: [] },
  { skin: '#f5d6bf', hair: 'short', hairColor: '#8a5a2e', top: '#6a4a9a', bottom: '#2a2a36', accessories: ['glasses'] },
  { skin: '#dcae88', hair: 'short', hairColor: '#1a1414', top: '#4f8a3e', bottom: '#4a3a2a', accessories: [] },
  { skin: '#f0c6a0', hair: 'neat', hairColor: '#24242c', top: '#2c4f8a', bottom: '#d8d0c0', accessories: [] },
  { skin: '#f4cfb0', hair: 'short', hairColor: '#c08a4a', top: '#e0743a', bottom: '#33404c', accessories: [] },
];
