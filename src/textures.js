// 16x16 pixel-art textures drawn procedurally onto canvases.
// Deterministic: noise is seeded by the texture key, so every load looks the same.
import * as THREE from 'three';

const S = 16;
const cache = new Map();
const warned = new Set();

function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hex(c) {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}
function shade(rgb, f) {
  return rgb.map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
}

// Helpers receive a pixel buffer api: px(x,y,rgb[,a]) and a seeded rand().
function fillNoise(px, rand, base, amp) {
  const b = hex(base);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) px(x, y, shade(b, 1 + (rand() - 0.5) * amp));
}

function planks(px, rand, base, rows, grain) {
  const b = hex(base);
  const rh = S / rows;
  for (let r = 0; r < rows; r++) {
    const tone = 0.9 + rand() * 0.2;
    const off = Math.floor(rand() * S);
    for (let y = 0; y < rh; y++)
      for (let x = 0; x < S; x++) {
        const yy = r * rh + y;
        let f = tone + (rand() - 0.5) * grain;
        if (y === rh - 1) f *= 0.65; // seam
        if ((x + off) % S === 0) f *= 0.75; // end joint
        px(x, yy, shade(b, f));
      }
  }
}

function bricks(px, rand, base, mortar) {
  const b = hex(base), m = hex(mortar);
  for (let y = 0; y < S; y++) {
    const row = Math.floor(y / 4);
    const off = row % 2 ? 4 : 0;
    for (let x = 0; x < S; x++) {
      if (y % 4 === 3 || (x + off) % 8 === 7) px(x, y, shade(m, 0.9 + rand() * 0.2));
      else px(x, y, shade(b, 0.88 + rand() * 0.24));
    }
  }
}

function tiles(px, rand, base, grout, size) {
  const b = hex(base), g = hex(grout);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      if (x % size === size - 1 || y % size === size - 1) px(x, y, g);
      else px(x, y, shade(b, 0.96 + rand() * 0.08));
    }
}

function wallpaper(px, rand, base, motif) {
  const b = hex(base), m = hex(motif);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let c = shade(b, 0.97 + rand() * 0.06);
      if (x % 8 === 0) c = shade(b, 0.9); // vertical stripe
      px(x, y, c);
    }
  // small diamond motif
  const pts = [[3, 3], [3, 2], [3, 4], [2, 3], [4, 3], [11, 11], [11, 10], [11, 12], [10, 11], [12, 11]];
  for (const [x, y] of pts) px(x, y, m);
}

function carpet(px, rand, base, trim) {
  const b = hex(base), t = hex(trim);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const border = x === 1 || y === 1 || x === 14 || y === 14;
      px(x, y, border ? shade(t, 0.9 + rand() * 0.15) : shade(b, 0.9 + rand() * 0.2));
    }
}

function book(px, rand, base) {
  const b = hex(base);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let f = 0.95 + rand() * 0.1;
      if (y === 3 || y === 12) f *= 0.65; // bands
      if (y === 7 || y === 8) f *= 1.25; // gold-ish label area
      px(x, y, y === 7 || y === 8 ? [225, 195, 110] : shade(b, f));
    }
  for (let y = 0; y < S; y++) px(0, y, shade(b, 0.6));
}

const gens = {
  wood_dark: (px, r) => planks(px, r, 0x5a3a24, 4, 0.14),
  wood_light: (px, r) => planks(px, r, 0xa87a4c, 4, 0.14),
  plank_floor: (px, r) => planks(px, r, 0x8a5a36, 2, 0.12),
  wallpaper_cream: (px, r) => wallpaper(px, r, 0xe9dcbb, 0xc9a96a),
  wallpaper_green: (px, r) => wallpaper(px, r, 0x4f7a5a, 0xc9b66a),
  brick: (px, r) => bricks(px, r, 0x9a4a3a, 0xc8b8a0),
  stone: (px, r) => {
    fillNoise(px, r, 0x8a8a90, 0.3);
    for (let i = 0; i < 6; i++) px(Math.floor(r() * S), Math.floor(r() * S), [100, 100, 106]);
    for (let x = 0; x < S; x++) px(x, 7, [96, 96, 102]);
    for (let y = 0; y < 8; y++) px(5, y, [96, 96, 102]);
    for (let y = 8; y < S; y++) px(11, y, [96, 96, 102]);
  },
  tile_white: (px, r) => tiles(px, r, 0xf0ede4, 0xb9b5aa, 8),
  tile_green: (px, r) => tiles(px, r, 0x3f8a5c, 0x24523a, 8),
  carpet_wine: (px, r) => carpet(px, r, 0x6e1f34, 0xc9a050),
  carpet_blue: (px, r) => carpet(px, r, 0x24407a, 0xd8c890),
  glass: (px, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const edge = x === 0 || y === 0 || x === 15 || y === 15;
        px(x, y, edge ? [200, 235, 245] : [170, 215, 235], edge ? 255 : 255);
      }
    for (let i = 0; i < 5; i++) px(2 + i, 2 + i, [235, 250, 255]); // glint
    px(3, 6, [235, 250, 255]); px(6, 3, [235, 250, 255]);
  },
  book_red: (px, r) => book(px, r, 0x8a2a2a),
  book_blue: (px, r) => book(px, r, 0x2a4a8a),
  book_green: (px, r) => book(px, r, 0x2a6a3e),
  leaves: (px, r) => {
    fillNoise(px, r, 0x3f8a3a, 0.5);
    for (let i = 0; i < 28; i++) px(Math.floor(r() * S), Math.floor(r() * S), [28, 84, 34]);
    for (let i = 0; i < 12; i++) px(Math.floor(r() * S), Math.floor(r() * S), [96, 160, 70]);
  },
  soil: (px, r) => {
    fillNoise(px, r, 0x5a3c26, 0.35);
    for (let i = 0; i < 18; i++) px(Math.floor(r() * S), Math.floor(r() * S), [36, 24, 16]);
    for (let i = 0; i < 6; i++) px(Math.floor(r() * S), Math.floor(r() * S), [110, 84, 60]);
  },
  snow: (px, r) => {
    fillNoise(px, r, 0xf2f6fa, 0.08);
    for (let i = 0; i < 10; i++) px(Math.floor(r() * S), Math.floor(r() * S), [205, 222, 238]);
  },
  metal: (px, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        let f = 0.94 + r() * 0.06;
        if (x === 0 || y === 0) f = 1.2;
        if (x === 15 || y === 15) f = 0.7;
        px(x, y, shade([150, 156, 166], f));
      }
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) px(x, y, [90, 94, 104]);
  },
  gold: (px, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        let f = 0.93 + r() * 0.1;
        if (x === 0 || y === 0) f = 1.2;
        if (x === 15 || y === 15) f = 0.7;
        px(x, y, shade([214, 170, 52], f));
      }
    for (let i = 0; i < 4; i++) px(3 + i, 3 + i, [255, 236, 150]);
  },
  white: (px, r) => fillNoise(px, r, 0xf4f4f0, 0.05),
  black: (px, r) => fillNoise(px, r, 0x1c1c22, 0.25),
  red: (px, r) => fillNoise(px, r, 0xc02e2e, 0.12),
  pearl: (px, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const t = (x + y) / 30;
        px(x, y, shade([240 - 10 * t, 230 + 5 * t, 238 + 8 * t].map((v) => Math.min(255, v)), 0.97 + r() * 0.05));
      }
    px(4, 4, [255, 255, 255]); px(5, 4, [255, 255, 255]); px(4, 5, [255, 255, 255]);
  },
  paper: (px, r) => {
    fillNoise(px, r, 0xf1e8cc, 0.07);
    for (const y of [3, 6, 9, 12]) for (let x = 2; x < 14; x++) if (r() > 0.2) px(x, y, [120, 105, 90]);
  },
  water: (px, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const wave = Math.sin((x + y * 0.5) * 0.9) * 0.08;
        px(x, y, shade([60, 130, 200], 1 + wave + (r() - 0.5) * 0.1));
      }
  },
  // ── Task 6 additions (props / world) ──
  fire: (px, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const t = y / 15; // 0 = top (bright), 1 = bottom (deep red)
        const c = [255, Math.round(232 - 150 * t), Math.round(120 - 100 * t)];
        let f = 0.9 + r() * 0.2;
        if (y < 5 && r() < 0.25 - y * 0.04) f = 0.55; // flicker gaps near the tips
        px(x, y, shade(c, f));
      }
    for (let i = 0; i < 6; i++) px(Math.floor(r() * S), 8 + Math.floor(r() * 8), [255, 250, 200]);
  },
  lampshade: (px, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        let f = 0.96 + r() * 0.06;
        if (x % 4 === 3) f *= 0.88; // pleats
        if (y === 0 || y === 15) f *= 0.8; // rim bands
        px(x, y, shade([255, 222, 150], f));
      }
  },
  tape: (px) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) px(x, y, ((x + y) >> 2) % 2 ? [32, 30, 28] : [246, 206, 44]);
  },
  flower: (px, r) => {
    fillNoise(px, r, 0x3a7f38, 0.45);
    for (let i = 0; i < 10; i++) px(Math.floor(r() * S), Math.floor(r() * S), [26, 76, 30]);
    const pts = [[2, 2], [9, 1], [5, 7], [12, 6], [1, 11], [8, 12], [13, 13]];
    for (const [x, y] of pts) {
      const c = r() < 0.5 ? [232, 104, 146] : [214, 48, 70];
      px(x, y, c); px(x + 1, y, c); px(x, y + 1, c); px(x + 1, y + 1, shade(c, 0.7));
    }
  },
  leather: (px, r) => {
    fillNoise(px, r, 0x7a3428, 0.14);
    for (let i = 0; i < S; i += 2) { px(i, 1, [150, 92, 66]); px(i, 14, [150, 92, 66]); }
    for (const [x, y] of [[4, 5], [11, 5], [4, 10], [11, 10], [7, 8]]) px(x, y, [70, 28, 22]);
  },
  linen: (px, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) px(x, y, shade([238, 232, 218], ((x + y) % 2 ? 0.97 : 1.02) + (r() - 0.5) * 0.04));
  },
  window_night: (px, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const t = y / 15;
        let c = [Math.round(34 + 50 * t), Math.round(58 + 70 * t), Math.round(118 + 80 * t)];
        if (y > 12) c = [214, 226, 240]; // snow drift on the sill outside
        px(x, y, c);
      }
    for (let i = 0; i < 9; i++) px(1 + Math.floor(r() * 14), 1 + Math.floor(r() * 11), [236, 244, 255]);
    for (let i = 0; i < S; i++) { px(7, i, [228, 222, 206]); px(i, 7, [228, 222, 206]); }
    for (let i = 0; i < S; i++) { px(0, i, [92, 64, 42]); px(15, i, [92, 64, 42]); px(i, 0, [92, 64, 42]); px(i, 15, [92, 64, 42]); }
  },
  bottle: (px, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        let c = shade([34, 82, 52], 0.9 + r() * 0.15);
        if (x === 4 || x === 5) c = [120, 170, 130]; // highlight
        if (y >= 8 && y <= 11) c = shade([234, 222, 190], 0.95 + r() * 0.08); // label
        px(x, y, c);
      }
  },
  photo: (px, r) => {
    fillNoise(px, r, 0xc9ad7c, 0.1);
    for (let x = 0; x < S; x++) { px(x, 0, [70, 50, 30]); px(x, 15, [70, 50, 30]); }
    for (let y = 0; y < S; y++) { px(0, y, [70, 50, 30]); px(15, y, [70, 50, 30]); }
    const people = [[2, [120, 70, 40]], [5, [190, 40, 50]], [8, [60, 60, 70]], [11, [180, 40, 46]]];
    for (const [x, body] of people) {
      px(x, 5, [240, 205, 170]); px(x + 1, 5, [240, 205, 170]);
      px(x, 4, [40, 30, 24]); px(x + 1, 4, [40, 30, 24]);
      for (let y = 6; y < 12; y++) { px(x, y, body); px(x + 1, y, body); }
    }
    px(5, 6, [250, 250, 250]); // pearl glint
  },
  blueprint: (px, r) => {
    fillNoise(px, r, 0x2c5aa0, 0.08);
    for (let i = 0; i < S; i += 4) for (let j = 0; j < S; j++) { px(i, j, [70, 110, 180]); px(j, i, [70, 110, 180]); }
    for (let i = 2; i < 14; i++) { px(i, 2, [230, 240, 255]); px(i, 13, [230, 240, 255]); px(2, i, [230, 240, 255]); px(13, i, [230, 240, 255]); px(8, i, [230, 240, 255]); }
    for (let i = 3; i < 13; i += 2) px(i, 8, [255, 255, 255]); // dashed secret passage
  },
  terracotta: (px, r) => {
    fillNoise(px, r, 0xb4643a, 0.14);
    for (let x = 0; x < S; x++) { px(x, 0, [204, 128, 84]); px(x, 1, [204, 128, 84]); px(x, 2, [130, 66, 36]); }
  },
  skin: (px, r) => fillNoise(px, r, 0xf0c8a4, 0.05),
};

export const TEXTURE_KEYS = Object.keys(gens);

function makeCanvas(key) {
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const px = (x, y, rgb, a = 255) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = a;
  };
  const gen = gens[key];
  if (gen) {
    gen(px, mulberry32(hashStr(key)));
  } else {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`makeTexture: unknown texture key "${key}", using fallback`);
    }
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++)
        px(x, y, ((x >> 2) + (y >> 2)) % 2 ? [0, 0, 0] : [255, 0, 255]);
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function makeTexture(key) {
  if (cache.has(key)) return cache.get(key);
  const tex = new THREE.CanvasTexture(makeCanvas(key));
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}
