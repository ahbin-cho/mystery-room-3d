// Block prop prefabs (스펙 4.2). Pure JS: no three.js import — every prop only calls b.addBox(),
// so the same code runs in Node (to derive MAP.solids) and in the browser (to draw).
//
// PROPS[name](b, x, y, z, rot = 0, opt = {}) -> { solid: [x0, z0, x1, z1] | null }
//   (x, z) = minimum corner of the prop's footprint AFTER rotation, y = floor height (m).
//   Each prop is modelled in local space: width w along local x, depth d along local z,
//   back at lz = 0 and front at lz = d. rot turns the front: 0 → +z, 1 → +x, 2 → -z, 3 → -x.
//   So "against the north wall" = rot 0, south wall = rot 2, west wall = rot 1, east wall = rot 3.
//   PROPS[name].size(opt) -> [w, d] (unrotated); PROPS[name].tall marks props that hide windows.
//   opt.solid: false (no collision) or an absolute [x0, z0, x1, z1] override.

const SIZES = [0.5, 0.25, 0.125];
const fits = (v, s) => Math.abs(v / s - Math.round(v / s)) < 1e-4;
function pickSize(dx, dy, dz, max) {
  for (const s of SIZES) if (s <= max + 1e-9 && fits(dx, s) && fits(dy, s) && fits(dz, s)) return s;
  return 0.125;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BOOKS = ['book_red', 'book_blue', 'book_green'];

// Local drawing frame for one prop placement.
export function frame(b, x, y, z, rot, w, d) {
  const r = (((rot | 0) % 4) + 4) % 4;
  const tf = (lx, lz) => (r === 0 ? [lx, lz] : r === 1 ? [lz, w - lx] : r === 2 ? [w - lx, d - lz] : [d - lz, lx]);
  const t = {
    w, d, W: r % 2 ? d : w, D: r % 2 ? w : d,
    rand: mulberry((Math.round(x * 64) * 73856093) ^ (Math.round(z * 64) * 19349663) ^ (Math.round(y * 64) * 83492791) ^ (r * 2654435761)),
    // Fill a local box [x0,x1)x[y0,y1)x[z0,z1) with the biggest block size (<= max) that tiles it.
    box(key, x0, y0, z0, x1, y1, z1, max = 0.5) {
      if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6 || z1 - z0 < 1e-6) return t;
      const [ax, az] = tf(x0, z0), [bx, bz] = tf(x1, z1);
      const wx0 = Math.min(ax, bx), wx1 = Math.max(ax, bx), wz0 = Math.min(az, bz), wz1 = Math.max(az, bz);
      b.addBox(key, x + wx0, y + y0, z + wz0, x + wx1, y + y1, z + wz1, pickSize(wx1 - wx0, y1 - y0, wz1 - wz0, max));
      return t;
    },
    m(key, lx, ly, lz) { return t.box(key, lx, ly, lz, lx + 0.125, ly + 0.125, lz + 0.125); },
    // Pixel art standing in the x/y plane at depth lz. rows[0] is the TOP row. '.' = empty.
    pix(rows, keys, lx, ly, lz, s = 0.125, depth = 0.125) {
      const n = rows.length;
      rows.forEach((row, ri) => {
        for (let c = 0; c < row.length; c++) {
          const k = keys[row[c]];
          if (!k) continue;
          const px = lx + c * s, py = ly + (n - 1 - ri) * s;
          t.box(k, px, py, lz, px + s, py + s, lz + depth, s);
        }
      });
      return t;
    },
    // Flat decal on the floor (top 0.025 m above it). rows run along +z, chars along +x.
    decal(rows, keys, lx, lz, s = 0.125) {
      rows.forEach((row, ri) => {
        for (let c = 0; c < row.length; c++) {
          const k = keys[row[c]];
          if (k) t.box(k, lx + c * s, 0.025 - s, lz + ri * s, lx + (c + 1) * s, 0.025, lz + (ri + 1) * s, s);
        }
      });
      return t;
    },
  };
  return t;
}

export const PROPS = {};

function def(name, size, solid, draw, flags = {}) {
  const sz = typeof size === 'function' ? size : () => size;
  const fn = (b, x, y, z, rot = 0, opt = {}) => {
    const [w, d] = sz(opt);
    const t = frame(b, x, y, z, rot, w, d);
    draw(t, opt, w, d);
    const s = opt.solid === undefined ? solid : opt.solid;
    if (Array.isArray(s)) return { solid: s.slice() };
    return { solid: s ? [x, z, x + t.W, z + t.D] : null };
  };
  fn.size = (opt = {}) => sz(opt);
  Object.assign(fn, flags);
  PROPS[name] = fn;
}

// ───────────────────────── shared bits ─────────────────────────

function flame(t, lx, ly, lz) { t.m('fire', lx, ly, lz); }
function candle(t, lx, ly, lz, h = 0.25) {
  t.box('white', lx, ly, lz, lx + 0.125, ly + h, lz + 0.125);
  flame(t, lx, ly + h, lz);
}
function legs(t, key, w, d, h, inset = 0) {
  for (const [lx, lz] of [[inset, inset], [w - 0.125 - inset, inset], [inset, d - 0.125 - inset], [w - 0.125 - inset, d - 0.125 - inset]])
    t.box(key, lx, 0, lz, lx + 0.125, h, lz + 0.125);
}

// Little things that sit on tables / counters, at local (lx, ly, lz).
function smallThing(t, kind, lx, ly, lz) {
  switch (kind) {
    case 'jar': t.box('glass', lx, ly, lz, lx + 0.125, ly + 0.25, lz + 0.125); t.m(t.rand() < 0.5 ? 'red' : 'gold', lx, ly, lz); t.m('wood_light', lx, ly + 0.25, lz); break;
    case 'bottle': t.box('bottle', lx, ly, lz, lx + 0.125, ly + 0.25, lz + 0.125); t.m('black', lx, ly + 0.25, lz); break;
    case 'bread': t.box('terracotta', lx, ly, lz, lx + 0.25, ly + 0.125, lz + 0.125); break;
    case 'veg': t.m('red', lx, ly, lz); t.m('leaves', lx + 0.125, ly, lz); break;
    case 'cup': t.m('white', lx, ly, lz); break;
    case 'book': t.box(BOOKS[Math.floor(t.rand() * 3)], lx, ly, lz, lx + 0.25, ly + 0.125, lz + 0.125); break;
    case 'plant': t.m('terracotta', lx, ly, lz); t.m('leaves', lx, ly + 0.125, lz); break;
    case 'candle': candle(t, lx, ly, lz, 0.125); break;
    case 'board': t.box('wood_light', lx, ly, lz, lx + 0.25, ly + 0.125, lz + 0.125); t.m('terracotta', lx, ly + 0.125, lz); break;
    default: break;
  }
}

// ───────────────────────── furniture ─────────────────────────

def('bookshelf', o => [o.w || 1.5, 0.5], true, (t, o, w) => {
  const h = o.h || 2.5, R = t.rand, wood = o.wood || 'wood_dark';
  t.box(wood, 0, 0, 0, 0.25, h, 0.5).box(wood, w - 0.25, 0, 0, w, h, 0.5);
  const rows = Math.round(h / 0.5);
  for (let k = 0; k < rows; k++) t.box(wood, 0.25, k * 0.5, 0.25, w - 0.25, k * 0.5 + 0.125, 0.5);
  t.box(wood, 0.25, h - 0.125, 0, w - 0.25, h, 0.5);
  t.box(wood, 0.25, 0, 0, w - 0.25, 0.125, 0.25);
  for (let k = 0; k < rows; k++) {
    const y0 = k * 0.5 + 0.125, top = k === rows - 1 ? h - 0.125 : (k + 1) * 0.5;
    for (let lx = 0.25; lx < w - 0.249; lx += 0.125) {
      const isOdd = o.odd !== undefined && Math.abs(lx - o.odd) < 0.01 && k === 2;
      const isDebut = o.debut !== undefined && Math.abs(lx - o.debut) < 0.01 && k === 2;
      if (isOdd) { t.box('book_red', lx, y0, 0.25, lx + 0.125, y0 + 0.25, 0.625); continue; } // sticks out of the row
      if (isDebut) { t.box('pearl', lx, y0, 0.25, lx + 0.125, y0 + 0.25, 0.5); t.m('gold', lx, y0 + 0.25, 0.375); continue; }
      const r = R();
      if (r < 0.08) continue; // gap
      if (r < 0.13) { t.m(['gold', 'pearl', 'terracotta'][Math.floor(R() * 3)], lx, y0, 0.375); continue; }
      const hb = top - y0 >= 0.375 && R() < 0.5 ? 0.375 : 0.25;
      t.box(BOOKS[Math.floor(R() * 3)], lx, y0, 0.375, lx + 0.125, y0 + Math.min(hb, top - y0), 0.5);
    }
  }
  if (o.topper) smallThing(t, o.topper, w / 2 - 0.125, h, 0.25);
}, { tall: true });

def('desk', o => [o.w || 2, o.d || 1], true, (t, o, w, d) => {
  const wood = o.wood || 'wood_dark';
  t.box(wood, 0, 0, 0, 0.5, 0.5, d).box(wood, w - 0.5, 0, 0, w, 0.5, d);
  t.box(wood, 0.5, 0.25, 0, w - 0.5, 0.5, 0.25);
  t.box(o.top || 'wood_light', 0, 0.5, 0, w, 0.75, d);
  t.box('leather', 0.5, 0.65, d - 0.75, w - 0.5, 0.775, d - 0.125);
  for (const px of [0.1875, w - 0.3125]) for (const py of [0.125, 0.3125]) t.m('gold', px, py, d);
  if (o.drawer) { // a drawer pulled open on the right pedestal (front side)
    t.box('wood_light', w - 0.5, 0.375, d, w, 0.5, d + 0.25);
    t.m('gold', w - 0.3125, 0.375, d + 0.25);
  }
  if (o.papers) { t.box('paper', 0.125, 0.75, 0.25, 0.375, 0.875, 0.5); t.m('paper', 0.25, 0.875, 0.375); }
  if (o.ink) { t.m('black', w - 0.25, 0.75, 0.125); t.m('white', w - 0.25, 0.875, 0.125); }
  if (o.books) { t.box('book_green', w - 0.375, 0.75, 0.375, w - 0.125, 0.875, 0.625); t.box('book_red', w - 0.375, 0.875, 0.375, w - 0.125, 1.0, 0.5); }
});

def('table', o => [o.w || 1, o.d || 0.75], true, (t, o, w, d) => {
  const h = o.h || 0.75, leg = o.leg || 'wood_dark';
  legs(t, leg, w, d, h - 0.25, 0.0625);
  t.box(o.top || 'wood_light', 0, h - 0.25, 0, w, h, d);
  if (o.cloth) t.box(o.cloth, 0.125, h - 0.1, 0.125, w - 0.125, h + 0.025, d - 0.125);
  (o.items || []).forEach(([kind, lx, lz]) => smallThing(t, kind, lx, h, lz));
});

def('chair', [0.5, 0.5], false, (t, o) => {
  const wood = o.wood || 'wood_dark';
  legs(t, wood, 0.5, 0.5, 0.375);
  t.box(o.seat || 'carpet_wine', 0, 0.375, 0, 0.5, 0.5, 0.5);
  t.box(wood, 0, 0.5, 0, 0.5, 1.0, 0.125);
  t.box(wood, 0.125, 1.0, 0, 0.375, 1.125, 0.125);
});

def('armchair', [1, 1], true, (t, o) => {
  const k = o.key || 'leather';
  t.box(k, 0, 0, 0, 1, 0.5, 1);
  t.box(k, 0, 0.5, 0, 0.25, 0.75, 1).box(k, 0.75, 0.5, 0, 1, 0.75, 1);
  t.box(k, 0, 0.5, 0, 1, 1.25, 0.25);
  t.box(o.cushion || 'carpet_wine', 0.25, 0.5, 0.25, 0.75, 0.625, 1);
  t.m('gold', 0.25, 1.0, 0.25).m('gold', 0.625, 1.0, 0.25);
});

def('sofa', o => [o.w || 2.5, 1], true, (t, o, w) => {
  const k = o.key || 'carpet_wine';
  t.box('wood_dark', 0, 0, 0, w, 0.25, 1);
  t.box(k, 0, 0.25, 0, w, 0.5, 1);
  t.box(k, 0, 0.5, 0, 0.25, 0.875, 1).box(k, w - 0.25, 0.5, 0, w, 0.875, 1);
  t.box(k, 0, 0.5, 0, w, 1.25, 0.25);
  t.box(o.cushion || 'linen', 0.25, 0.5, 0.25, w - 0.25, 0.625, 1);
  t.box(o.pillow || 'flower', 0.25, 0.625, 0.25, 0.5, 0.875, 0.375);
  t.box(o.pillow2 || 'carpet_blue', w - 0.5, 0.625, 0.25, w - 0.25, 0.875, 0.375);
});

def('fireplace', o => [o.w || 2, 0.75], true, (t, o, w) => {
  const s = o.key || 'stone';
  t.box(s, 0, 0, 0, 0.5, 1.25, 0.75).box(s, w - 0.5, 0, 0, w, 1.25, 0.75);
  t.box('black', 0.5, 0, 0, w - 0.5, 1.0, 0.25);
  t.box(s, 0.5, 1.0, 0, w - 0.5, 1.25, 0.75);
  t.box('wood_dark', 0, 1.25, 0, w, 1.5, 0.75);
  t.box('brick', 0.5, 1.5, 0, w - 0.5, 3.0, 0.5);
  // hearth + logs + fire
  t.box(s, 0.25, 0, 0.75, w - 0.25, 0.125, 1.0);
  t.box('wood_dark', 0.625, 0, 0.375, w - 0.625, 0.125, 0.5);
  t.box('fire', 0.625, 0.125, 0.25, w - 0.625, 0.25, 0.5);
  t.box('fire', 0.75, 0.25, 0.25, w - 0.75, 0.375, 0.5);
  t.box('fire', 0.875, 0.375, 0.25, w - 0.875, 0.5, 0.375);
  t.m('fire', w / 2 - 0.0625, 0.5, 0.25);
  // poker set
  t.box('black', w - 0.25, 0.125, 0.75, w - 0.125, 0.875, 0.875);
  t.m('gold', w - 0.25, 0.875, 0.75);
  if (o.candles !== false) { candle(t, 0.125, 1.5, 0.375); candle(t, w - 0.25, 1.5, 0.375); }
  if (o.clock) { t.box('wood_dark', w / 2 - 0.25, 1.5, 0.25, w / 2 + 0.25, 1.875, 0.5); t.m('white', w / 2 - 0.0625, 1.625, 0.5); }
}, { tall: true });

def('piano', [1.5, 2], true, (t) => {
  t.box('black', 0, 0.5, 0, 1.5, 1.0, 1.25);
  t.box('black', 0, 0.5, 1.25, 1.5, 0.75, 1.5);
  t.box('white', 0.125, 0.75, 1.25, 1.375, 0.875, 1.5);
  for (let i = 0; i < 9; i++) if (i % 7 !== 2 && i % 7 !== 6) t.m('black', 0.1875 + i * 0.125, 0.875, 1.25);
  t.box('black', 0, 1.0, 0.125, 0.125, 1.625, 1.125); // propped lid
  t.box('paper', 0.5, 1.0, 1.125, 1.0, 1.25, 1.25); // music sheet
  for (const [lx, lz] of [[0.125, 0.125], [1.25, 0.125], [0.625, 1.25]]) t.box('black', lx, 0, lz, lx + 0.125, 0.5, lz + 0.125);
  t.box('gold', 0.625, 0, 1.375, 0.875, 0.125, 1.5); // pedals
  t.box('black', 0.375, 0.375, 1.625, 1.125, 0.5, 2.0); // bench
  t.box('carpet_wine', 0.5, 0.5, 1.75, 1.0, 0.625, 1.875);
  for (const [lx, lz] of [[0.375, 1.625], [1.0, 1.625], [0.375, 1.875], [1.0, 1.875]]) t.box('black', lx, 0, lz, lx + 0.125, 0.375, lz + 0.125);
});

def('grand_clock', [0.5, 0.5], true, (t) => {
  t.box('wood_dark', 0, 0, 0, 0.5, 0.5, 0.5);
  t.box('wood_dark', 0.125, 0.5, 0.125, 0.375, 1.5, 0.375);
  t.box('glass', 0.125, 0.625, 0.375, 0.375, 1.375, 0.5);
  t.m('gold', 0.1875, 0.75, 0.25).m('gold', 0.1875, 0.875, 0.25).box('gold', 0.125, 0.625, 0.25, 0.375, 0.75, 0.375);
  t.box('wood_dark', 0, 1.5, 0, 0.5, 2.0, 0.375);
  t.box('white', 0.125, 1.625, 0.375, 0.375, 1.875, 0.5);
  t.m('black', 0.1875, 1.75, 0.5).m('black', 0.25, 1.6875, 0.5);
  t.box('gold', 0.125, 2.0, 0.125, 0.375, 2.125, 0.375);
}, { tall: true });

def('dining_table', o => [o.w || 5, 1.5], true, (t, o, w) => {
  const n = Math.round(w / 1.5);
  for (let i = 0; i <= n; i++) {
    const lx = Math.min(i * (w - 0.125) / n, w - 0.125);
    t.box('wood_dark', lx, 0, 0.125, lx + 0.125, 0.5, 0.25).box('wood_dark', lx, 0, 1.25, lx + 0.125, 0.5, 1.375);
  }
  t.box('linen', 0, 0.5, 0, w, 0.75, 0.5).box('linen', 0, 0.5, 1.0, w, 0.75, 1.5);
  t.box(o.runner || 'carpet_wine', 0, 0.5, 0.5, w, 0.75, 1.0);
  t.box('linen', 0, 0.375, -0.0, w, 0.5, 0.125).box('linen', 0, 0.375, 1.375, w, 0.5, 1.5); // draped cloth edge
});

def('plate_set', [0.5, 0.5], false, (t, o) => {
  t.box('white', 0.125, 0, 0.125, 0.375, 0.0625 + 0.0625, 0.375);
  const food = o.food || ['red', 'gold', 'leaves', 'terracotta'][Math.floor(t.rand() * 4)];
  if (food !== 'none') t.m(food, 0.1875, 0.125, 0.1875);
  t.m('metal', 0, 0, 0.25).m('metal', 0.375, 0, 0.25);
  t.m('glass', 0.375, 0, 0).m(o.wine === false ? 'glass' : 'red', 0.375, 0.125, 0);
});

def('candelabra', [0.5, 0.5], false, (t) => {
  t.box('gold', 0.125, 0, 0.125, 0.375, 0.125, 0.375);
  t.box('gold', 0.1875, 0.125, 0.1875, 0.3125, 0.375, 0.3125);
  t.box('gold', 0, 0.375, 0.1875, 0.5, 0.5, 0.3125);
  for (const lx of [0, 0.1875, 0.375]) candle(t, lx, 0.5, 0.1875, lx === 0.1875 ? 0.25 : 0.125);
});

def('cake', [0.5, 0.5], false, (t) => {
  t.box('gold', 0.0625, 0, 0.0625, 0.4375, 0.0625 + 0.0625, 0.4375);
  // bottom tier with one slice gone
  t.box('white', 0.0625, 0.125, 0.0625, 0.4375, 0.25, 0.25);
  t.box('white', 0.0625, 0.125, 0.25, 0.25, 0.25, 0.4375);
  t.box('pearl', 0.0625, 0.25, 0.0625, 0.4375, 0.375, 0.25);
  t.box('pearl', 0.0625, 0.25, 0.25, 0.25, 0.375, 0.4375);
  t.m('red', 0.0625, 0.375, 0.0625).m('red', 0.3125, 0.375, 0.0625).m('red', 0.0625, 0.375, 0.3125);
  t.box('white', 0.125, 0.375, 0.125, 0.25, 0.5, 0.25);
  t.m('red', 0.125, 0.5, 0.125);
  t.m('white', 0.3125, 0.125, 0.4375); // the missing slice, on its own little plate
});

def('wine_rack', o => [o.w || 1.5, 0.5], true, (t, o, w) => {
  const h = o.h || 2, R = t.rand;
  t.box('wood_dark', 0, 0, 0, 0.25, h, 0.5).box('wood_dark', w - 0.25, 0, 0, w, h, 0.5);
  t.box('wood_dark', 0.25, 0, 0, w - 0.25, 0.25, 0.5).box('wood_dark', 0.25, h - 0.25, 0, w - 0.25, h, 0.5);
  for (let y = 0.75; y < h - 0.3; y += 0.5) t.box('wood_dark', 0.25, y, 0.25, w - 0.25, y + 0.125, 0.5);
  for (let y = 0.25; y < h - 0.3; y += 0.5)
    for (const dy of [0, 0.25]) for (let lx = 0.25; lx < w - 0.3; lx += 0.1875) {
      if (R() < 0.15 || y + dy + 0.125 > h - 0.25) continue;
      t.box('bottle', lx, y + dy, 0.125, lx + 0.125, y + dy + 0.125, 0.375);
      t.m(R() < 0.6 ? 'red' : 'black', lx, y + dy, 0.375);
    }
}, { tall: true });

def('barrel', [0.75, 0.75], true, (t, o) => {
  const k = o.key || 'wood_light';
  t.box(k, 0, 0, 0, 0.75, 0.25, 0.75);
  t.box('metal', 0, 0.25, 0, 0.75, 0.375, 0.75);
  t.box(k, 0, 0.375, 0, 0.75, 0.625, 0.75);
  t.box('metal', 0, 0.625, 0, 0.75, 0.75, 0.75);
  t.box(k, 0, 0.75, 0, 0.75, 1.0, 0.75);
  t.box('wood_dark', 0.125, 1.0, 0.125, 0.625, 1.0625 + 0.0625, 0.625);
  t.m('gold', 0.3125, 0.25, 0.75);
  if (o.top) (o.top).forEach(([kind, lx, lz]) => smallThing(t, kind, lx, 1.125, lz));
});

def('crate', [0.5, 0.5], false, (t, o) => {
  t.box('wood_light', 0, 0, 0, 0.5, 0.5, 0.5);
  t.box('wood_dark', 0, 0.5, 0, 0.5, 0.5625 + 0.0625, 0.125).box('wood_dark', 0, 0.5, 0.375, 0.5, 0.625, 0.5);
  if (o.fill === 'bottles') for (const [lx, lz] of [[0.0625, 0.125], [0.25, 0.125], [0.125, 0.3125], [0.3125, 0.3125]]) { t.box('bottle', lx, 0.5, lz, lx + 0.125, 0.75, lz + 0.125); t.m('red', lx, 0.75, lz); }
  if (o.fill === 'veg') { t.box('red', 0.125, 0.5, 0.125, 0.25, 0.625, 0.375); t.box('leaves', 0.25, 0.5, 0.125, 0.375, 0.625, 0.375); t.m('terracotta', 0.1875, 0.625, 0.1875); }
  if (o.fill === 'apples') { t.box('red', 0.0625, 0.5, 0.125, 0.4375, 0.625, 0.375); t.m('leaves', 0.25, 0.625, 0.25); }
});

def('sack', [0.5, 0.5], false, (t) => {
  t.box('linen', 0.0625, 0, 0.0625, 0.4375, 0.375, 0.4375);
  t.box('linen', 0.125, 0.375, 0.125, 0.375, 0.5, 0.375);
  t.m('wood_light', 0.1875, 0.5, 0.1875);
  t.m('white', 0.0625, 0.375, 0.0625);
});

def('stove', [1, 0.75], true, (t) => {
  t.box('black', 0, 0, 0, 1, 0.75, 0.5);
  t.box('black', 0, 0.5, 0.5, 1, 0.75, 0.75);
  t.box('black', 0, 0, 0.5, 0.25, 0.5, 0.75).box('black', 0.75, 0, 0.5, 1, 0.5, 0.75);
  t.box('metal', 0.25, 0, 0.5, 0.75, 0.125, 0.75).box('metal', 0.25, 0.375, 0.5, 0.75, 0.5, 0.75);
  t.box('fire', 0.25, 0.125, 0.5, 0.75, 0.375, 0.625);
  t.box('metal', 0.125, 0.75, 0.125, 0.5, 1.0, 0.5); // pot
  t.box('water', 0.1875, 0.95, 0.1875, 0.4375, 1.075, 0.4375);
  t.m('metal', 0.5, 0.875, 0.25);
  t.box('red', 0.625, 0.75, 0.25, 0.875, 0.875, 0.5).m('red', 0.875, 0.875, 0.375).m('black', 0.6875, 0.875, 0.3125); // kettle
  t.box('black', 0.375, 0.75, 0, 0.625, 3.0, 0.25); // flue pipe
  t.m('gold', 0.0625, 0.625, 0.75).m('gold', 0.8125, 0.625, 0.75);
}, { tall: true });

def('counter', o => [o.w || 1.5, 0.75], true, (t, o, w) => {
  t.box(o.wood || 'wood_light', 0, 0, 0, w, 0.75, 0.75);
  t.box(o.top || 'tile_white', 0, 0.75, 0, w, 0.875, 0.75);
  for (let lx = 0.1875; lx < w; lx += 0.5) t.m('gold', lx, 0.5, 0.75);
  (o.items || [['jar', 0.125, 0.125], ['jar', 0.25, 0.125], ['board', w / 2, 0.375], ['bottle', w - 0.25, 0.125]])
    .forEach(([kind, lx, lz]) => smallThing(t, kind, lx, 0.875, lz));
});

def('sink', [1, 0.75], true, (t) => {
  t.box('wood_light', 0, 0, 0, 1, 0.75, 0.75);
  t.box('tile_white', 0, 0.75, 0, 1, 0.875, 0.125).box('tile_white', 0, 0.75, 0.625, 1, 0.875, 0.75);
  t.box('tile_white', 0, 0.75, 0.125, 0.25, 0.875, 0.625).box('tile_white', 0.75, 0.75, 0.125, 1, 0.875, 0.625);
  t.box('metal', 0.25, 0.625, 0.125, 0.75, 0.75, 0.625);
  t.box('water', 0.25, 0.7, 0.125, 0.75, 0.825, 0.625);
  t.box('metal', 0.4375, 0.875, 0, 0.5625, 1.125, 0.125).m('metal', 0.4375, 1.0, 0.125);
  t.m('white', 0.25, 0.875, 0.625).m('white', 0.125, 0.875, 0.625); // stacked dishes
  t.m('gold', 0.4375, 0.5, 0.75);
});

def('fridge', [0.75, 0.75], true, (t) => {
  t.box('white', 0, 0, 0, 0.75, 1.75, 0.75);
  t.box('metal', 0.5625, 0.75, 0.75, 0.6875, 1.0, 0.8125 + 0.0625);
  t.box('metal', 0.5625, 1.25, 0.75, 0.6875, 1.5, 0.875);
  t.box('metal', 0, 1.0625, 0.75, 0.75, 1.125 + 0.0625, 0.8125 + 0.0625);
  t.box('pearl', 0.125, 1.75, 0.125, 0.625, 1.875, 0.625);
}, { tall: true });

def('pot_rack', o => [o.w || 1.5, 0.25], false, (t, o, w) => {
  const y = 1.875;
  t.box('wood_dark', 0, y, 0, w, y + 0.125, 0.125);
  let i = 0;
  for (let lx = 0.125; lx < w - 0.2; lx += 0.3125, i++) {
    t.m('metal', lx, y - 0.125, 0.125);
    const kind = i % 4;
    if (kind === 0) t.box('black', lx - 0.0625, y - 0.375, 0.125, lx + 0.1875, y - 0.125, 0.25);
    if (kind === 1) t.box('metal', lx - 0.0625, y - 0.5, 0.125, lx + 0.1875, y - 0.25, 0.25);
    if (kind === 2) { t.box('leaves', lx, y - 0.375, 0.125, lx + 0.125, y - 0.125, 0.25); t.m('flower', lx, y - 0.5, 0.125); }
    if (kind === 3) { t.box('metal', lx, y - 0.5, 0.125, lx + 0.125, y - 0.125, 0.25); t.m('metal', lx - 0.0625, y - 0.5, 0.125); }
  }
}, { tall: true });

def('wall_shelf', o => [o.w || 1.5, 0.25], false, (t, o, w) => {
  const y = o.y0 || 1.5;
  t.box('wood_dark', 0, y, 0, w, y + 0.125, 0.25);
  t.m('wood_dark', 0.125, y - 0.125, 0).m('wood_dark', w - 0.25, y - 0.125, 0);
  const kinds = o.items || ['jar', 'jar', 'cup', 'bottle', 'jar', 'plant'];
  let lx = 0.0625;
  for (const k of kinds) { if (lx > w - 0.2) break; smallThing(t, k, lx, y + 0.125, 0.0625); lx += k === 'bread' || k === 'book' ? 0.3125 : 0.1875 + 0.0625; }
  if (o.plates) for (let px = 0.125; px < w - 0.3; px += 0.375) t.box('white', px, y + 0.125, 0, px + 0.25, y + 0.375, 0.125);
}, { tall: true });

def('bed', o => [o.w || 2, o.d || 2.5], true, (t, o, w, d) => {
  const wood = o.wood || 'wood_dark';
  t.box(wood, 0, 0, 0, w, 0.25, d);
  t.box('linen', 0, 0.25, 0.25, w, 0.5, 0.75);
  t.box(o.blanket || 'carpet_blue', 0, 0.25, 0.75, w, 0.5, d - 0.25);
  t.box(o.blanket || 'carpet_blue', 0, 0.5, 0.75, w, 0.625, 0.875);
  t.box('linen', 0, 0.5, 0.875, w, 0.625, 1.0);
  const pw = w >= 1.5 ? 2 : 1;
  for (let i = 0; i < pw; i++) {
    const px = pw === 1 ? (w - 0.625) / 2 : 0.125 + i * (w / 2);
    t.box('white', px, 0.5, 0.25, px + Math.min(0.625, w / 2 - 0.25), 0.625 + 0.0625 + 0.0625, 0.625);
  }
  t.box(wood, 0, 0, 0, w, 1.25, 0.25);
  t.m('gold', 0, 1.25, 0.0625).m('gold', w - 0.125, 1.25, 0.0625);
  t.box(wood, 0, 0, d - 0.25, w, 0.75, d);
  if (o.canopy) {
    for (const lx of [0, w - 0.125]) t.box(wood, lx, 0.75, d - 0.125, lx + 0.125, 2.25, d);
    for (const lx of [0, w - 0.125]) t.box(wood, lx, 1.25, 0, lx + 0.125, 2.25, 0.125);
    t.box(o.canopy, 0, 2.25, 0, w, 2.5, 0.5); // valance over the headboard
    t.box(wood, 0, 2.25, d - 0.125, w, 2.375, d);
    t.box(wood, 0, 2.25, 0.5, 0.125, 2.375, d - 0.125).box(wood, w - 0.125, 2.25, 0.5, w, 2.375, d - 0.125);
    t.box(o.canopy, 0, 1.25, 0.25, 0.25, 2.25, 0.5).box(o.canopy, w - 0.25, 1.25, 0.25, w, 2.25, 0.5); // drapes
    t.box(o.canopy, 0.125, 1.5, d - 0.125, 0.25, 2.25, d).box(o.canopy, w - 0.25, 1.5, d - 0.125, w - 0.125, 2.25, d);
    t.box('gold', 0, 2.5, 0, w, 2.625, 0.125);
  }
  if (o.messy) { t.box(o.blanket || 'carpet_blue', w - 0.5, 0.5, 1.5, w, 0.75, 2.0); }
});

def('nightstand', [0.5, 0.5], false, (t, o) => {
  t.box(o.wood || 'wood_dark', 0, 0, 0, 0.5, 0.5, 0.5);
  t.m('gold', 0.1875, 0.25, 0.5);
  if (o.lamp !== false) {
    t.m('gold', 0.1875, 0.5, 0.125).m('gold', 0.1875, 0.625, 0.125);
    t.box('lampshade', 0.0625, 0.75, 0.0, 0.3125, 0.875 + 0.0625 + 0.0625, 0.25);
  }
  if (o.book) t.box('book_blue', 0.25, 0.5, 0.25, 0.5, 0.625, 0.5);
  if (o.glasses) { t.m('black', 0.0625, 0.5, 0.375).m('black', 0.25, 0.5, 0.375); }
  if (o.cup) t.m('white', 0.3125, 0.5, 0.0625);
});

def('wardrobe', o => [o.w || 1.5, 0.75], true, (t, o, w) => {
  const wood = o.wood || 'wood_dark', h = 2.25;
  if (o.open === 'left') {
    const half = w / 2;
    t.box(wood, half, 0, 0, w, h, 0.75);
    t.box(wood, 0, 0, 0, 0.125, h, 0.75);
    t.box(wood, 0.125, 0, 0, half, 0.25, 0.75);
    t.box(wood, 0.125, h - 0.25, 0, half, h, 0.75);
    t.box('wood_light', 0.125, 0.25, 0, half, h - 0.25, 0.125);
    t.box('metal', 0.125, 1.75, 0.25, half, 1.875, 0.375); // hanging rail
    t.box(o.clothes || 'linen', 0.5, 0.75, 0.25, 0.625, 1.75, 0.5);
    // the open door, swung out
    t.box(wood, -0.125, 0.25, 0.75, 0, h - 0.25, 1.375);
    t.m('gold', -0.125, 1.0, 1.25);
  } else {
    t.box(wood, 0, 0, 0, w, h, 0.75);
  }
  t.box(wood, -0.0, h, 0, w, h + 0.125, 0.75);
  t.box('gold', w / 2 - 0.125, 1.0, 0.75, w / 2, 1.125, 0.8125 + 0.0625);
  if (o.open !== 'left') t.m('gold', w / 2, 1.0, 0.75);
  if (o.top) t.box('linen', 0.25, h + 0.125, 0.125, 0.75, h + 0.375, 0.625);
}, { tall: true });

def('dresser', o => [o.w || 1.5, 0.5], true, (t, o, w) => {
  t.box(o.wood || 'wood_light', 0, 0, 0, w, 1.0, 0.5);
  for (let r = 0; r < 3; r++) for (const lx of [0.25, w - 0.375]) t.m('gold', lx, 0.125 + r * 0.3125, 0.5);
  if (o.drawer) { t.box('wood_light', w / 2 - 0.25, 0.75, 0.5, w / 2 + 0.25, 0.875, 0.75); }
  if (o.mirror) {
    t.box('gold', 0.25, 1.0, 0, w - 0.25, 2.0, 0.125);
    t.box('glass', 0.375, 1.125, 0.0625, w - 0.375, 1.875, 0.1875);
  }
  (o.items || []).forEach(([kind, lx, lz]) => {
    if (kind === 'jewel') { t.box('red', lx, 1.0, lz, lx + 0.25, 1.125, lz + 0.125); t.m('gold', lx, 1.125, lz); t.m('pearl', lx + 0.125, 1.125, lz); }
    else if (kind === 'perfume') { t.m('glass', lx, 1.0, lz); t.m('pearl', lx, 1.125, lz); }
    else if (kind === 'vase') { t.box('white', lx, 1.0, lz, lx + 0.125, 1.25, lz + 0.125); t.m('flower', lx, 1.25, lz); t.m('red', lx, 1.375, lz); }
    else smallThing(t, kind, lx, 1.0, lz);
  });
  if (o.china) for (let lx = 0.125; lx < w - 0.2; lx += 0.25) t.box('white', lx, 1.0, 0.125, lx + 0.125, 1.25, 0.25);
});

def('suitcase', [0.75, 0.5], false, (t, o) => {
  const k = o.key || 'leather';
  if (o.open) {
    t.box(k, 0, 0, 0, 0.75, 0.125, 0.5);
    t.box(k, 0, 0.125, 0, 0.75, 0.625, 0.125);
    t.box(o.clothes || 'linen', 0.125, 0.125, 0.125, 0.625, 0.25, 0.375);
  } else {
    t.box(k, 0, 0, 0, 0.75, 0.375, 0.5);
    t.box('wood_dark', 0.125, 0, 0, 0.25, 0.375 + 0.0625 + 0.0625, 0.5).box('wood_dark', 0.5, 0, 0, 0.625, 0.5, 0.5);
    t.m('gold', 0.3125, 0.375, 0.5).m('black', 0.3125, 0.375, 0.25);
  }
});

def('bag', [1, 0.5], false, (t) => { // doctor's bag, open at the top
  t.box('leather', 0, 0, 0, 1, 0.25, 0.5);
  t.box('leather', 0, 0.25, 0, 1, 0.375, 0.125).box('leather', 0, 0.25, 0.375, 1, 0.375, 0.5);
  t.box('leather', 0, 0.25, 0.125, 0.125, 0.375, 0.375).box('leather', 0.875, 0.25, 0.125, 1, 0.375, 0.375);
  t.box('black', 0.125, 0.125, 0.125, 0.875, 0.25, 0.375);
  t.box('wood_dark', 0.375, 0.375, 0.0625, 0.625, 0.5, 0.125);
  t.m('gold', 0.4375, 0.25, 0.5);
});

def('rug', o => [o.w || 2, o.d || 2], false, (t, o, w, d) => {
  t.box(o.key || 'carpet_wine', 0, -0.47, 0, w, 0.03, d, 0.5);
  if (o.fringe) for (let lx = 0; lx < w; lx += 0.25) { t.m(o.fringe, lx, -0.095, -0.125); t.m(o.fringe, lx, -0.095, d); }
}, { flat: true });

def('lamp_floor', [0.5, 0.5], false, (t) => {
  t.box('gold', 0.125, 0, 0.125, 0.375, 0.125, 0.375);
  t.box('gold', 0.1875, 0.125, 0.1875, 0.3125, 1.25, 0.3125);
  t.box('lampshade', 0, 1.25, 0, 0.5, 1.625, 0.5);
  t.m('gold', 0.1875, 1.625, 0.1875);
}, { tall: true });

def('lamp_desk', [0.25, 0.25], false, (t, o) => {
  t.box('gold', 0, 0, 0, 0.25, 0.0625 + 0.0625, 0.25);
  t.m('gold', 0.0625, 0.125, 0.0625);
  t.box(o.shade || 'lampshade', 0, 0.25, 0, 0.25, 0.375, 0.25);
});

def('chandelier', [1, 1], false, (t) => {
  t.box('gold', 0.4375, 2.5, 0.4375, 0.5625, 3.0, 0.5625);
  t.box('gold', 0.375, 2.25, 0.375, 0.625, 2.5, 0.625);
  t.box('gold', 0.125, 2.25, 0.4375, 0.875, 2.375, 0.5625);
  t.box('gold', 0.4375, 2.25, 0.125, 0.5625, 2.375, 0.875);
  for (const [lx, lz] of [[0.125, 0.4375], [0.75, 0.4375], [0.4375, 0.125], [0.4375, 0.75]]) {
    candle(t, lx, 2.375, lz, 0.125);
    t.m('pearl', lx, 2.125, lz);
  }
  t.box('lampshade', 0.4375, 2.125, 0.4375, 0.5625, 2.25, 0.5625);
});

def('sconce', [0.25, 0.25], false, (t, o) => {
  const y = o.y0 || 1.75;
  t.m('gold', 0.0625, y, 0).m('gold', 0.0625, y, 0.125);
  t.box('lampshade', 0, y + 0.125, 0.0625, 0.25, y + 0.375, 0.3125);
}, { tall: true });

def('lantern', [0.25, 0.25], false, (t, o) => {
  const y = o.hang ? 2.125 : 0;
  if (o.hang) t.box('metal', 0.0625, y + 0.375, 0.0625, 0.1875, 3.0, 0.1875);
  t.box('black', 0, y, 0, 0.25, y + 0.0625 + 0.0625, 0.25);
  t.box('fire', 0.0625, y + 0.125, 0.0625, 0.1875, y + 0.25, 0.1875);
  t.box('glass', 0, y + 0.125, 0, 0.25, y + 0.25, 0.25, 0.125);
  t.box('black', 0, y + 0.25, 0, 0.25, y + 0.375, 0.25);
});

// Framed pixel paintings. art = key into ART; canvas is w x h, the frame adds 0.125 all round.
const ART = {
  landscape: { keys: { W: 'water', G: 'gold', S: 'snow', T: 'stone', L: 'leaves', D: 'soil' }, rows: [
    'WWWWWWGW', 'WWWSWWWW', 'WWSTSWWW', 'WSTTTSWS', 'LLTTTTLL', 'LLLDLLLL'] },
  portrait: { keys: { B: 'leaves', H: 'stone', F: 'skin', E: 'black', S: 'wood_dark', W: 'white', R: 'red' }, rows: [
    'BBBBBB', 'BHHHHB', 'BHFFHB', 'BFEFEB', 'BFFFFB', 'BSWWSB', 'SSWRSS', 'SSSRSS'] },
  owl: { keys: { K: 'black', M: 'pearl', O: 'white', Y: 'gold', B: 'wood_dark' }, rows: [
    'KKKKKKMK', 'KKOKKOKK', 'KKOOOOKK', 'KKYOOYKK', 'KKOOOOKK', 'BBBOOBBB'] },
  sea: { keys: { S: 'snow', W: 'water', P: 'white', B: 'wood_dark', R: 'red' }, rows: [
    'SSSSSSSS', 'SSSPSSSS', 'SSSPRSSS', 'WWBBBBWW', 'WPWWWWPW', 'WWWWWWWW'] },
  flowers: { keys: { C: 'linen', R: 'red', F: 'flower', L: 'leaves', V: 'water', T: 'wood_dark' }, rows: [
    'CCRCFCCC', 'CRFRFRCC', 'CCLFLCCC', 'CCCVCCCC', 'CCVVVCCC', 'TTTTTTTT'] },
  winter: { keys: { N: 'window_night', S: 'snow', L: 'leaves', H: 'terracotta', Y: 'gold', W: 'white' }, rows: [
    'NNNNNNWN', 'NWNNLNNN', 'NNNLLLNN', 'NHHNLLLN', 'NHYNSSSS', 'SSSSSSSS'] },
};
def('painting', o => [(o.cw || 1) + 0.25, 0.125], false, (t, o, w) => {
  const art = ART[o.art || 'landscape'];
  const cw = w - 0.25, rows = art.rows, ch = rows.length * 0.125, y0 = o.y0 || 1.25;
  const s = cw / rows[0].length;
  t.box(o.frame || 'gold', 0, y0, 0, w, y0 + 0.125, 0.125).box(o.frame || 'gold', 0, y0 + ch + 0.125, 0, w, y0 + ch + 0.25, 0.125);
  t.box(o.frame || 'gold', 0, y0 + 0.125, 0, 0.125, y0 + ch + 0.125, 0.125).box(o.frame || 'gold', w - 0.125, y0 + 0.125, 0, w, y0 + ch + 0.125, 0.125);
  t.pix(rows, art.keys, 0.125, y0 + 0.125, 0, s, 0.0625 + 0.0625);
}, { tall: true });

def('mirror', o => [o.w || 0.75, 0.125], false, (t, o, w) => {
  const y0 = o.y0 || 1.25, h = o.h || 1.0;
  t.box('gold', 0, y0, 0, w, y0 + h, 0.125);
  t.box('glass', 0.125, y0 + 0.125, 0.0625, w - 0.125, y0 + h - 0.125, 0.1875);
}, { tall: true });

def('photo_frame', [0.5, 0.25], false, (t) => {
  t.box('gold', 0, 0, 0, 0.5, 0.125, 0.125).box('gold', 0, 0.375, 0, 0.5, 0.5, 0.125);
  t.box('gold', 0, 0.125, 0, 0.125, 0.375, 0.125).box('gold', 0.375, 0.125, 0, 0.5, 0.375, 0.125);
  t.box('photo', 0.125, 0.125, 0, 0.375, 0.375, 0.25, 0.25);
});

def('pinned_paper', o => [o.w || 1, 0.125], false, (t, o, w) => {
  const y0 = o.y0 || 0.875, h = o.h || 0.75;
  t.box(o.key || 'blueprint', 0, y0, 0, w, y0 + h, 0.125, 0.25);
  t.m('red', 0, y0 + h - 0.125, 0.0625).m('red', w - 0.125, y0 + h - 0.125, 0.0625);
  t.box('paper', w - 0.375, y0 - 0.125, 0.0625, w - 0.125, y0 + 0.125, 0.1875); // scribbled note
}, { tall: true });

// ───────────────────────── plants / outdoors ─────────────────────────

def('plant_pot', [0.5, 0.5], false, (t, o) => {
  const kind = o.kind || 'bush', R = t.rand;
  t.box('terracotta', 0.125, 0, 0.125, 0.375, 0.25, 0.375);
  t.box('soil', 0.125, 0.2, 0.125, 0.375, 0.2625 + 0.0625, 0.375, 0.125);
  if (kind === 'bush' || kind === 'flower' || kind === 'tree') {
    const y = kind === 'tree' ? 0.625 : 0.25;
    if (kind === 'tree') t.box('wood_light', 0.1875, 0.25, 0.1875, 0.3125, 0.625, 0.3125);
    t.box(kind === 'flower' ? 'flower' : 'leaves', 0, y, 0, 0.5, y + 0.5, 0.5, 0.25);
    t.box('leaves', 0.125, y + 0.5, 0.125, 0.375, y + 0.625, 0.375);
    const fruit = kind === 'tree' ? 'gold' : kind === 'flower' ? 'red' : null;
    if (fruit) for (let i = 0; i < 5; i++) t.m(R() < 0.5 ? fruit : 'red', [0, 0.375][i % 2], y + 0.125 + 0.125 * (i % 3), i < 3 ? -0.0625 : 0.4375 + 0.0625);
  } else if (kind === 'palm') {
    t.box('wood_light', 0.1875, 0.25, 0.1875, 0.3125, 1.375, 0.3125);
    t.box('leaves', 0.125, 1.375, 0.125, 0.375, 1.5, 0.375);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
      for (let i = 1; i <= 3; i++) t.m('leaves', 0.1875 + dx * 0.125 * i, 1.375 - (i === 3 ? 0.125 : 0), 0.1875 + dz * 0.125 * i);
    }
  } else if (kind === 'fern') {
    t.box('leaves', 0.125, 0.25, 0.125, 0.375, 0.5, 0.375);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let i = 1; i <= 2; i++)
      t.m('leaves', 0.1875 + dx * (0.125 + 0.125 * i), 0.5 - 0.125 * (i - 1), 0.1875 + dz * (0.125 + 0.125 * i));
  }
});

def('planter', o => [o.w || 2, 0.75], true, (t, o, w) => {
  const R = t.rand;
  legs(t, 'wood_dark', w, 0.75, 0.25);
  t.box('wood_light', 0, 0.25, 0, w, 0.5, 0.75);
  t.box('soil', 0.125, 0.45, 0.125, w - 0.125, 0.575, 0.625);
  for (let lx = 0; lx < w - 0.2; lx += 0.5) {
    const k = R() < 0.35 ? 'flower' : 'leaves';
    t.box(k, lx + 0.125, 0.5, 0.125, lx + 0.375, 0.75 + (R() < 0.5 ? 0.25 : 0), 0.375 + 0.25, 0.25);
    if (R() < 0.5) t.m('red', lx + 0.25, 0.875, 0.625);
  }
  for (let lx = 0.25; lx < w - 0.2; lx += 0.75) t.box('terracotta', lx, 0.5, 0.25, lx + 0.25, 0.75, 0.5);
});

def('potting_table', o => [o.w || 2, 0.75], true, (t, o, w) => {
  legs(t, 'wood_dark', w, 0.75, 0.5);
  t.box('wood_light', 0, 0.5, 0, w, 0.75, 0.75);
  t.box('wood_light', 0.125, 0.125, 0.125, w - 0.125, 0.25, 0.625); // lower shelf
  for (let lx = 0.125; lx < w - 0.3; lx += 0.5) { t.box('terracotta', lx, 0.75, 0.125, lx + 0.25, 1.0, 0.375); t.m('leaves', lx + 0.0625, 1.0, 0.1875); }
  t.box('soil', 0.25, 0.25, 0.25, 0.75, 0.375, 0.5);
  t.box('metal', w - 0.5, 0.75, 0.375, w - 0.25, 0.875 + 0.0625 + 0.0625, 0.625); // watering can
  t.m('metal', w - 0.25, 0.875, 0.5).m('metal', w - 0.125, 0.9375 + 0.0625, 0.5);
});

def('rosebush', o => [o.w || 2, o.d || 0.75], true, (t, o, w, d) => {
  const R = t.rand;
  for (let lx = 0; lx < w - 0.01; lx += 0.25) for (let lz = 0; lz < d - 0.01; lz += 0.25) {
    const h = 0.5 + (R() < 0.5 ? 0.25 : 0) + (lz < 0.3 ? 0.25 : 0);
    t.box(R() < 0.55 ? 'flower' : 'leaves', lx, 0, lz, lx + 0.25, h, lz + 0.25, 0.25);
  }
  for (let i = 0; i < Math.round(w * 3); i++) t.m(R() < 0.5 ? 'red' : 'pearl', R() * (w - 0.125), 0.375 + R() * 0.375, d);
  if (o.thread !== undefined) { // snagged red wool, hanging off the front
    const lx = o.thread;
    t.m('red', lx, 0.625, d).m('red', lx + 0.0625, 0.5, d + 0.0625).m('red', lx - 0.0625, 0.5625, d + 0.0625);
  }
});

def('fountain', [2.5, 2.5], true, (t, o) => {
  const S = 2.5;
  t.box('stone', 0, 0, 0, S, 0.5, 0.25).box('stone', 0, 0, S - 0.25, S, 0.5, S);
  t.box('stone', 0, 0, 0.25, 0.25, 0.5, S - 0.25).box('stone', S - 0.25, 0, 0.25, S, 0.5, S - 0.25);
  t.box('stone', 0.25, -0.125, 0.25, S - 0.25, 0.125, S - 0.25, 0.25);
  t.box('water', 0.25, 0.125, 0.25, S - 0.25, 0.375, S - 0.25, 0.25);
  t.box('stone', 1.0, 0, 1.0, 1.5, 1.0, 1.5);
  t.box('stone', 0.75, 1.0, 0.75, 1.75, 1.25, 1.75, 0.25);
  t.box('water', 1.0, 1.125, 1.0, 1.5, 1.25 + 0.0625 + 0.0625, 1.5, 0.25);
  // spout + falling water
  t.box('water', 1.1875, 1.25, 1.1875, 1.3125, 1.75, 1.3125);
  for (const [lx, lz] of [[0.625, 1.1875], [1.75, 1.1875], [1.1875, 0.625], [1.1875, 1.75]]) t.box('water', lx, 0.375, lz, lx + 0.125, 1.125, lz + 0.125);
  // white owl on top (the manor's emblem)
  t.box('white', 1.125, 1.75, 1.125, 1.375, 2.0, 1.375);
  t.m('gold', 1.125, 1.875, 1.375).m('gold', 1.25, 1.875, 1.375);
  t.m('white', 1.125, 2.0, 1.125).m('white', 1.25, 2.0, 1.125);
  if (o.stain) { // the wiped blood on one corner of the rim
    const [sx, sz] = o.stain;
    t.box('red', sx, 0.45, sz, sx + 0.125, 0.525, sz + 0.25, 0.125);
    t.box('terracotta', sx + 0.125, 0.45, sz, sx + 0.25, 0.525, sz + 0.125, 0.125);
  }
});

def('bench', o => [o.w || 1.5, 0.5], true, (t, o, w) => {
  const k = o.key || 'wood_light';
  for (const lx of [0.125, w - 0.25]) { t.box('black', lx, 0, 0.125, lx + 0.125, 0.375, 0.25); t.box('black', lx, 0, 0.375, lx + 0.125, 0.375, 0.5); }
  t.box(k, 0, 0.375, 0.125, w, 0.5, 0.5);
  t.box('black', 0.125, 0.375, 0, 0.25, 1.0, 0.125).box('black', w - 0.25, 0.375, 0, w - 0.125, 1.0, 0.125);
  t.box(k, 0, 0.625, 0, w, 0.75, 0.125).box(k, 0, 0.875, 0, w, 1.0, 0.125);
  if (o.cushion) t.box(o.cushion, 0.25, 0.5, 0.25, w - 0.25, 0.5625 + 0.0625, 0.5);
});

def('vines', o => [o.w || 2, 0.125], false, (t, o, w) => {
  const R = t.rand;
  for (let lx = 0; lx < w - 0.01; lx += 0.125) {
    const len = 1 + Math.floor(R() * 6);
    for (let i = 0; i < len; i++) t.m(R() < 0.12 ? 'flower' : 'leaves', lx, 2.875 - i * 0.125, 0);
  }
}, { tall: true });

def('bird_cage', [0.5, 0.5], false, (t) => {
  const y = 1.75;
  t.box('gold', 0.0625, y, 0.0625, 0.4375, y + 0.0625 + 0.0625, 0.4375);
  for (const [lx, lz] of [[0.0625, 0.0625], [0.3125, 0.0625], [0.0625, 0.3125], [0.3125, 0.3125]]) t.box('gold', lx, y + 0.125, lz, lx + 0.125, y + 0.5, lz + 0.125);
  t.box('gold', 0.125, y + 0.5, 0.125, 0.375, y + 0.625, 0.375);
  t.box('gold', 0.1875, y + 0.625, 0.1875, 0.3125, 3.0, 0.3125);
  t.m('gold', 0.1875, y + 0.25, 0.1875).m('red', 0.1875, y + 0.375, 0.1875); // little bird
});

def('watering_can', [0.25, 0.25], false, (t) => {
  t.box('metal', 0, 0, 0, 0.25, 0.25, 0.25, 0.125);
  t.m('metal', 0.25, 0.125, 0.0625).m('metal', 0.375, 0.25, 0.0625).m('metal', 0.0625, 0.25, 0.0625);
});

def('hidden_door', o => [o.w || 1.5, 0.25], false, (t, o, w) => {
  t.box('stone', 0, 0, 0, w, 2.25, 0.125);
  t.box('stone', 0, 2.25, 0, w, 2.5, 0.25);
  t.box('black', w / 2 + 0.125, 0, 0.0625, w / 2 + 0.25, 2.0, 0.1875); // the thin dark crack
  t.m('leaves', 0, 2.0, 0.125).m('leaves', 0.125, 1.875, 0.125).m('leaves', w - 0.125, 1.5, 0.125);
}, { tall: true });

def('drag_marks', o => [o.w || 2.5, o.d || 2.5], false, (t, o, w, d) => {
  // two scuffed lines from the far corner (w,d) back to the origin corner (0,0)
  const n = Math.round(Math.max(w, d) / 0.125);
  for (let i = 0; i < n; i++) {
    const f = i / n, lx = (w - 0.25) * (1 - f), lz = (d - 0.25) * (1 - f);
    if (i % 5 === 4) continue;
    t.box('soil', lx, -0.1, lz + 0.125, lx + 0.125, 0.03, lz + 0.25);
    t.box('soil', lx + 0.125, -0.1, lz, lx + 0.25, 0.03, lz + 0.125);
    if (i % 3 === 0) t.box('flower', lx + 0.0625, -0.1, lz + 0.0625, lx + 0.1875, 0.03, lz + 0.1875);
  }
}, { flat: true });

def('pine_tree', o => [1.5, 1.5], false, (t, o) => {
  const s = o.scale || 1;
  t.box('wood_dark', 0.5, 0, 0.5, 1.0, 0.5 * s, 1.0);
  const layers = [[0, 0.5, 1.5], [0.25, 1.0, 1.0], [0.5, 1.5, 0.5]];
  for (const [ins, y, wd] of layers) {
    t.box('leaves', ins, y * s, ins, ins + wd, y * s + 0.5, ins + wd);
    t.box('snow', ins, y * s + 0.5, ins, ins + wd, y * s + 0.75, ins + wd);
  }
  t.box('snow', 0.625, 2.125 * s, 0.625, 0.875, 2.375 * s, 0.875);
});

def('snowman', [1, 1], false, (t) => {
  t.box('snow', 0.125, 0, 0.125, 0.875, 0.75, 0.875, 0.25);
  t.box('snow', 0.25, 0.75, 0.25, 0.75, 1.25, 0.75);
  t.box('snow', 0.3125, 1.25, 0.3125, 0.6875, 1.625, 0.6875);
  t.m('black', 0.375, 1.4375, 0.6875).m('black', 0.5625, 1.4375, 0.6875);
  t.box('terracotta', 0.4375, 1.375, 0.6875, 0.5625, 1.5, 0.9375);
  t.box('red', 0.25, 1.125, 0.25, 0.75, 1.25, 0.75).box('red', 0.625, 0.875, 0.75, 0.75, 1.125, 0.875);
  t.m('black', 0.4375, 1.0, 0.75).m('black', 0.4375, 0.875, 0.75);
  t.box('black', 0.3125, 1.625, 0.3125, 0.6875, 1.75, 0.6875).box('black', 0.375, 1.75, 0.375, 0.625, 2.0, 0.625);
  t.box('wood_dark', -0.125, 0.875, 0.4375, 0.25, 1.0, 0.5625);
});

def('lamp_post', [0.5, 0.5], false, (t) => {
  t.box('black', 0.125, 0, 0.125, 0.375, 0.25, 0.375);
  t.box('black', 0.1875, 0.25, 0.1875, 0.3125, 2.0, 0.3125);
  t.box('lampshade', 0.0625, 2.0, 0.0625, 0.4375, 2.375, 0.4375);
  t.box('black', 0.0625, 2.375, 0.0625, 0.4375, 2.5, 0.4375);
});

// ───────────────────────── rooms / living ─────────────────────────

def('globe', [0.5, 0.5], false, (t) => {
  legs(t, 'wood_dark', 0.5, 0.5, 0.375, 0.0625);
  t.box('wood_dark', 0.0625, 0.375, 0.0625, 0.4375, 0.5, 0.4375);
  t.box('gold', 0.0625, 0.5, 0.1875, 0.125, 1.0, 0.3125);
  t.box('carpet_blue', 0.125, 0.5, 0.125, 0.375, 0.75, 0.375, 0.25);
  t.m('leaves', 0.125, 0.625, 0.375).m('leaves', 0.25, 0.5625, 0.375).m('leaves', 0.375, 0.6875, 0.25);
  t.m('gold', 0.1875, 0.75, 0.1875);
});

def('safe', [0.5, 0.5], false, (t) => {
  t.box('metal', 0, 0, 0, 0.5, 0.75, 0.5, 0.25);
  t.box('black', 0.0625, 0.0625, 0.5, 0.4375, 0.6875, 0.5625 + 0.0625);
  t.box('metal', 0.125, 0.125, 0.5625, 0.375, 0.625, 0.625 + 0.0625);
  t.m('gold', 0.1875, 0.375, 0.6875).m('black', 0.3125, 0.4375, 0.6875).m('gold', 0.3125, 0.3125, 0.6875);
  t.m('white', 0.1875, 0.5, 0.6875);
});

def('display_case', o => [o.w || 1, 0.5], true, (t, o, w) => {
  t.box('wood_dark', 0, 0, 0, w, 0.5, 0.5);
  t.box('wood_dark', 0, 1.5, 0, w, 1.625, 0.5);
  t.box('wood_dark', 0, 0.5, 0, 0.125, 1.5, 0.125).box('wood_dark', w - 0.125, 0.5, 0, w, 1.5, 0.125);
  t.box('wood_dark', 0, 0.5, 0.375, 0.125, 1.5, 0.5).box('wood_dark', w - 0.125, 0.5, 0.375, w, 1.5, 0.5);
  t.box('wood_dark', 0.125, 1.0, 0.0, w - 0.125, 1.0625 + 0.0625, 0.375);
  const fill = o.fill || 'silver';
  for (let lx = 0.25; lx < w - 0.2; lx += 0.25) {
    if (fill === 'silver') { t.box('metal', lx, 0.5, 0.125, lx + 0.125, 0.75, 0.25); t.m('gold', lx, 1.125, 0.1875); t.box('white', lx, 1.125, 0.0625, lx + 0.125, 1.375, 0.125); }
    if (fill === 'china') { t.box('white', lx - 0.0625, 0.5, 0.0625, lx + 0.125, 0.875, 0.125); t.m('carpet_blue', lx, 1.125, 0.1875); t.box('pearl', lx, 1.125, 0.0625, lx + 0.125, 1.375, 0.125); }
    if (fill === 'trophy') { t.box('gold', lx, 0.5, 0.1875, lx + 0.125, 0.75, 0.3125); t.m('gold', lx, 1.125, 0.1875); }
  }
  t.box('glass', 0.125, 0.5, 0.375, w - 0.125, 1.5, 0.5, 0.125);
}, { tall: true });

def('coat_rack', [0.5, 0.5], false, (t, o) => {
  t.box('wood_dark', 0, 0, 0.1875, 0.5, 0.125, 0.3125).box('wood_dark', 0.1875, 0, 0, 0.3125, 0.125, 0.5);
  t.box('wood_dark', 0.1875, 0.125, 0.1875, 0.3125, 1.875, 0.3125);
  t.m('gold', 0.1875, 1.875, 0.1875);
  const coats = o.coats || ['leather', 'black'];
  if (coats[0]) t.box(coats[0], 0.0, 0.875, 0.3125, 0.25, 1.625, 0.5);
  if (coats[1]) t.box(coats[1], 0.3125, 1.0, 0.0, 0.5, 1.625, 0.25);
  if (o.hat) { t.box(o.hat, 0.125, 1.875, 0.125, 0.375, 2.0, 0.375); t.box(o.hat, 0.0625, 1.8125, 0.0625, 0.4375, 1.875 + 0.0625 - 0.0625, 0.4375); }
  if (o.scarf) t.box(o.scarf, 0.125, 1.5, 0.3125, 0.25, 1.75, 0.4375);
}, { tall: true });

def('umbrella_stand', [0.5, 0.5], false, (t) => {
  t.box('metal', 0.125, 0, 0.125, 0.375, 0.5, 0.375, 0.25);
  t.box('black', 0.125, 0.5, 0.125, 0.25, 1.0, 0.25).m('wood_dark', 0.0, 1.0, 0.125).m('wood_dark', 0.125, 1.0, 0.125);
  t.box('red', 0.25, 0.5, 0.25, 0.375, 0.875, 0.375).m('wood_dark', 0.375, 0.875, 0.25);
});

def('trunk', [1, 0.5], true, (t, o) => {
  const k = o.key || 'wood_dark';
  t.box('metal', 0, 0, 0, 0.125, 0.5, 0.5);
  t.box(k, 0.125, 0, 0, 0.875, 0.5, 0.5, 0.25);
  t.box('metal', 0.875, 0, 0, 1, 0.5, 0.5);
  t.box('wood_light', 0.125, 0.5, 0.0625, 0.875, 0.625, 0.4375);
  t.m('gold', 0.4375, 0.25, 0.5);
  if (o.lantern) { t.m('black', 0.25, 0.625, 0.1875); t.m('fire', 0.25, 0.75, 0.1875); t.m('black', 0.25, 0.875, 0.1875); }
});

def('cobweb', [0.5, 0.125], false, (t, o) => {
  const y = o.y0 || 2.375;
  t.pix(['WWWW', 'W.W.', 'WW..', 'W...'], { W: 'linen' }, 0, y, 0, 0.125, 0.0625 + 0.0625);
}, {});

def('police_tape', o => [o.w || 2, 0.125], false, (t, o, w) => {
  const y = o.y0 || 0.875;
  if (o.posts !== false) for (const lx of [0, w - 0.125]) {
    t.box('black', lx - 0.0625, 0, -0.0625, lx + 0.1875, 0.125, 0.1875);
    t.box('metal', lx, 0.125, 0, lx + 0.125, y + 0.25, 0.125);
    t.m('tape', lx, y + 0.25, 0);
  }
  if (o.cross) {
    const n = Math.round(w / 0.125);
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      t.m('tape', i * 0.125, 0.5 + f * 1.375, 0);
      t.m('tape', i * 0.125, 1.875 - f * 1.375, 0);
    }
    return;
  }
  for (let lx = 0; lx < w - 0.01; lx += 0.125) {
    const sag = Math.abs(lx - w / 2) < w / 4 ? 0.0625 : 0;
    t.m('tape', lx, y - sag, 0);
  }
});

const BODY_MASK = [
  '............',
  '.....##.....',
  '....####....',
  '....####....',
  '.#...##.....',
  '.##.####....',
  '..#######...',
  '...######...',
  '...######.#.',
  '...######.#.',
  '...#######..',
  '...######...',
  '...######...',
  '...##..##...',
  '...##..##...',
  '...##..##...',
  '...##..##...',
  '...##...##..',
  '...##...##..',
  '............',
];
def('chalk_outline', [1.5, 2.5], false, (t) => {
  const H = BODY_MASK.length, W = BODY_MASK[0].length;
  const at = (r, c) => r >= 0 && r < H && c >= 0 && c < W && BODY_MASK[r][c] === '#';
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (at(r, c)) continue;
    let edge = false;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (at(r + dr, c + dc)) edge = true;
    if (edge) t.box('white', c * 0.125, -0.1, r * 0.125, (c + 1) * 0.125, 0.03, (r + 1) * 0.125);
  }
}, { flat: true });

// The victim, face down (head at local z = 0). Fits inside chalk_outline when placed 0.25 in.
def('body', [1, 2], false, (t) => {
  t.box('skin', 0.375, 0, 0.125, 0.625, 0.125, 0.375);
  t.box('stone', 0.375, 0.125, 0.125, 0.625, 0.25, 0.375);
  t.box('black', 0.25, 0, 0.375, 0.75, 0.25, 1.0);
  t.box('white', 0.375, 0.25, 0.375, 0.625, 0.3125 + 0.0625 - 0.0625, 0.5);
  t.box('black', 0.0, 0, 0.125, 0.25, 0.125, 0.5); t.m('skin', 0.0625, 0, 0.0); // arm flung up
  t.box('black', 0.75, 0, 0.5, 0.875, 0.125, 0.875); t.m('skin', 0.75, 0, 0.875); // arm down
  t.box('wood_dark', 0.25, 0, 1.0, 0.75, 0.25, 1.125);
  t.box('black', 0.25, 0, 1.125, 0.5, 0.125, 1.75).box('black', 0.5, 0, 1.125, 0.75, 0.125, 1.75);
}, { flat: true });

def('shoes', [0.5, 0.5], false, (t, o) => {
  const k = o.key || 'black';
  t.box(k, 0.0625, 0, 0.125, 0.1875, 0.125, 0.4375);
  t.box(k, 0.3125, 0, 0.0625, 0.4375, 0.125, 0.375);
  if (o.mud !== false) { t.m('soil', 0.0625, 0, 0.4375); t.m('flower', 0.3125, 0, 0.375); t.m('soil', 0.3125, 0.0, -0.0); }
});

def('evidence_tent', [0.25, 0.25], false, (t) => {
  t.box('gold', 0, 0, 0, 0.25, 0.125, 0.25, 0.125);
  t.box('gold', 0.0625, 0.125, 0.0625, 0.1875, 0.25, 0.1875);
  t.m('black', 0.0625, 0.0625, 0.25);
}, {});

def('papers', o => [o.w || 1, o.d || 1], false, (t, o, w, d) => {
  const R = t.rand;
  for (let i = 0; i < Math.round(w * d * 8); i++) {
    const lx = Math.floor(R() * (w / 0.125 - 1)) * 0.125, lz = Math.floor(R() * (d / 0.125 - 1)) * 0.125;
    t.box('paper', lx, -0.09, lz, lx + 0.25, 0.035, lz + 0.125);
  }
}, { flat: true });

def('typewriter', [0.5, 0.5], false, (t) => {
  t.box('black', 0.0, 0, 0.125, 0.5, 0.125, 0.5);
  t.box('black', 0.0625, 0.125, 0.0625, 0.4375, 0.25, 0.25);
  t.box('white', 0.0625, 0.125, 0.25, 0.4375, 0.1875 + 0.0625 - 0.0625, 0.4375);
  t.box('paper', 0.125, 0.25, 0.0625, 0.375, 0.5, 0.125);
  t.m('metal', -0.0625, 0.1875, 0.0625);
});

def('books_stack', [0.25, 0.25], false, (t, o) => {
  const n = o.n || 3;
  for (let i = 0; i < n; i++) t.box(BOOKS[(i + Math.floor(t.rand() * 3)) % 3], 0, i * 0.125, 0, 0.25, (i + 1) * 0.125, 0.125 + (i % 2) * 0.125);
});

def('bottle', [0.125, 0.125], false, (t, o) => { smallThing(t, 'bottle', 0, 0, 0); if (o.glass) t.m('glass', 0.125, 0, 0); });
def('candle', [0.125, 0.125], false, (t) => candle(t, 0, 0, 0, 0.25));
def('vase', [0.25, 0.25], false, (t, o) => {
  t.box(o.key || 'white', 0.0625, 0, 0.0625, 0.1875, 0.25, 0.1875);
  t.box('carpet_blue', 0.0625, 0.0625, 0.0625, 0.1875, 0.1875, 0.1875, 0.125);
  t.m('leaves', 0.0625, 0.25, 0.0625).m(o.bloom || 'red', 0.0, 0.375, 0.0625).m('flower', 0.125, 0.375, 0.125).m(o.bloom || 'red', 0.0625, 0.4375 + 0.0625, 0.0);
});

def('tea_set', [0.5, 0.5], false, (t) => {
  t.box('metal', 0, 0, 0, 0.5, 0.0625 + 0.0625, 0.5, 0.125);
  t.box('white', 0.125, 0.125, 0.125, 0.375, 0.375, 0.375, 0.25);
  t.m('white', 0.375, 0.25, 0.1875).m('white', 0.1875, 0.375, 0.1875);
  t.m('white', 0, 0.125, 0.375).m('white', 0.375, 0.125, 0.375);
});

def('radio', [0.5, 0.25], false, (t) => {
  t.box('wood_light', 0, 0, 0, 0.5, 0.375, 0.25, 0.125);
  t.box('linen', 0.0625, 0.0625, 0.25, 0.3125, 0.3125, 0.3125);
  t.m('gold', 0.375, 0.25, 0.25).m('gold', 0.375, 0.0625, 0.25);
});

def('xmas_tree', [1, 1], true, (t) => {
  const R = t.rand;
  t.box('red', 0.25, 0, 0.25, 0.75, 0.25, 0.75, 0.25);
  t.box('wood_dark', 0.375, 0.25, 0.375, 0.625, 0.5, 0.625);
  t.box('leaves', 0, 0.5, 0, 1, 1.0, 1, 0.25);
  t.box('leaves', 0.125, 1.0, 0.125, 0.875, 1.5, 0.875, 0.25);
  t.box('leaves', 0.25, 1.5, 0.25, 0.75, 2.0, 0.75, 0.25);
  t.box('leaves', 0.375, 2.0, 0.375, 0.625, 2.25, 0.625);
  t.box('gold', 0.4375, 2.25, 0.4375, 0.5625, 2.5, 0.5625).m('gold', 0.3125, 2.3125, 0.4375).m('gold', 0.5625, 2.3125, 0.4375);
  const lay = [[0, 1, 0.5], [0.125, 0.875, 1.0], [0.25, 0.75, 1.5]];
  for (const [a, b, y] of lay) for (let i = 0; i < 7; i++) {
    const side = Math.floor(R() * 4), u = a + R() * (b - a - 0.125), yy = y + Math.floor(R() * 3) * 0.125;
    const k = ['red', 'gold', 'pearl', 'lampshade', 'carpet_blue'][Math.floor(R() * 5)];
    if (side === 0) t.m(k, u, yy, a - 0.0625);
    if (side === 1) t.m(k, u, yy, b - 0.0625);
    if (side === 2) t.m(k, a - 0.0625, yy, u);
    if (side === 3) t.m(k, b - 0.0625, yy, u);
  }
}, { tall: true });

def('gift', [0.5, 0.5], false, (t, o) => {
  const k = o.key || 'red', big = o.big;
  const s = big ? 0.5 : 0.25, a = big ? 0 : 0.125;
  t.box(k, a, 0, a, a + s, s, a + s, s);
  t.box('gold', a + s / 2 - 0.0625, s, a, a + s / 2 + 0.0625, s + 0.0625 + 0.0625, a + s);
  t.m('gold', a + s / 2 - 0.1875, s + 0.0625 + 0.0625, a + s / 2 - 0.0625).m('gold', a + s / 2 + 0.0625, s + 0.125, a + s / 2 - 0.0625);
});

def('balloons', [0.5, 0.5], false, (t, o) => {
  const ks = o.keys || ['red', 'gold', 'carpet_blue'];
  t.m('metal', 0.1875, 0, 0.1875);
  ks.forEach((k, i) => {
    const lx = [0, 0.25, 0.125][i], lz = [0.125, 0.0, 0.25][i], y = 1.75 + i * 0.25;
    t.box('white', 0.1875, 0.125, 0.1875, 0.3125, y - 0.375, 0.3125); // string (shared)
    t.box(k, lx, y, lz, lx + 0.25, y + 0.375, lz + 0.25, 0.125);
  });
});

def('garland', o => [o.w || 4, 0.125], false, (t, o, w) => {
  const y = o.y0 || 2.5, ks = ['red', 'gold', 'white', 'carpet_blue'];
  let i = 0;
  for (let lx = 0; lx < w - 0.01; lx += 0.125, i++) {
    const sag = Math.round(Math.sin((lx / w) * Math.PI * Math.max(1, Math.round(w / 2))) ** 2 * 2) * 0.0625;
    t.m('wood_dark', lx, y - sag, 0);
    if (i % 3 === 1) t.box(ks[(i / 3 | 0) % 4], lx, y - sag - 0.25, 0, lx + 0.125, y - sag, 0.125);
  }
}, { tall: true });

def('owl_statue', [0.5, 0.5], false, (t) => {
  t.box('stone', 0, 0, 0, 0.5, 0.75, 0.5, 0.25);
  t.box('white', 0, 0.75, 0, 0.5, 0.875, 0.5);
  t.box('white', 0.125, 0.875, 0.125, 0.375, 1.125, 0.375);
  t.box('white', 0.125, 1.125, 0.125, 0.375, 1.25, 0.375);
  t.m('white', 0.125, 1.25, 0.125).m('white', 0.25, 1.25, 0.125);
  t.m('gold', 0.125, 1.125, 0.375).m('gold', 0.25, 1.125, 0.375);
  t.m('terracotta', 0.1875, 1.0625 - 0.0625, 0.375 + 0.0625);
});

def('telescope', [0.75, 0.75], false, (t) => {
  for (const [lx, lz] of [[0, 0], [0.625, 0], [0.3125, 0.625]]) t.box('wood_dark', lx, 0, lz, lx + 0.125, 0.75, lz + 0.125);
  t.box('gold', 0.3125, 0.75, 0.0625, 0.4375, 0.875, 0.6875);
  t.box('gold', 0.3125, 0.875, -0.1875, 0.4375, 1.0, 0.125);
  t.m('glass', 0.3125, 0.875, -0.3125);
});

def('sheet_furniture', o => [o.w || 1, o.d || 1], true, (t, o, w, d) => {
  const h = o.h || 1.0;
  t.box('linen', 0, 0, 0, w, h - 0.125, d, 0.125);
  t.box('linen', 0.125, h - 0.125, 0.125, w - 0.125, h, d - 0.125, 0.125);
}, {});

def('rocking_horse', [0.75, 0.5], false, (t) => {
  t.box('wood_dark', 0, 0, 0.0625, 0.75, 0.0625 + 0.0625, 0.1875).box('wood_dark', 0, 0, 0.3125, 0.75, 0.125, 0.4375);
  t.box('wood_light', 0.125, 0.125, 0.125, 0.625, 0.25, 0.375);
  t.box('wood_light', 0.125, 0.25, 0.125, 0.5, 0.5, 0.375);
  t.box('red', 0.25, 0.5, 0.125, 0.375, 0.5625 + 0.0625, 0.375);
  t.box('wood_light', 0.5, 0.375, 0.1875, 0.75, 0.75, 0.3125);
  t.m('black', 0.625, 0.625, 0.125).m('black', 0.5, 0.625, 0.1875);
  t.m('wood_dark', 0.0, 0.375, 0.1875);
});

def('drafting_table', [1, 0.75], false, (t) => {
  legs(t, 'wood_dark', 1, 0.75, 0.625);
  t.box('wood_light', 0, 0.625, 0, 1, 0.75, 0.375);
  t.box('wood_light', 0, 0.75, 0.375, 1, 0.875, 0.75);
  t.box('blueprint', 0.125, 0.875, 0.375, 0.625, 0.9375 + 0.0625 - 0.0625, 0.625);
  t.box('paper', 0.625, 0.75, 0.0625, 0.875, 0.875, 0.25);
  t.box('wood_light', 0.0625, 0.875 + 0.0625, 0.625, 0.9375, 0.9375 + 0.0625 + 0.0625, 0.6875 + 0.0625);
});

def('broken_vase', [1, 1], false, (t) => {
  t.decal(['..w.....', '.wW..b..', '...WWw..', 'b.WwwW..', '..wWW.r.', '.l..w...', '...r..w.', '........'],
    { W: 'water', w: 'white', b: 'carpet_blue', r: 'red', l: 'leaves' }, 0, 0);
  t.box('white', 0.375, 0, 0.375, 0.5, 0.125, 0.5).m('carpet_blue', 0.5, 0, 0.5);
  t.m('flower', 0.125, 0, 0.5);
}, { flat: true });

def('puddle', o => [o.w || 0.75, o.d || 0.5], false, (t, o, w, d) => {
  for (let lx = 0; lx < w - 0.01; lx += 0.125) for (let lz = 0; lz < d - 0.01; lz += 0.125)
    if ((lx + lz) % 0.5 > 0.01 || t.rand() < 0.5) t.box(o.key || 'red', lx, -0.1, lz, lx + 0.125, 0.03, lz + 0.125);
}, { flat: true });

def('cat', [0.5, 0.5], false, (t) => {
  t.box('carpet_blue', 0, 0, 0, 0.5, 0.125, 0.5);
  t.box('terracotta', 0.0625, 0.125, 0.125, 0.4375, 0.25, 0.375);
  t.box('terracotta', 0.3125, 0.125, 0.25, 0.4375, 0.3125 + 0.0625, 0.4375);
  t.m('terracotta', 0.3125, 0.3125 + 0.0625, 0.3125).m('terracotta', 0.4375 - 0.0625, 0.375, 0.375);
  t.m('white', 0.0625, 0.125, 0.375).m('black', 0.375, 0.25, 0.4375);
});

def('armor', [0.5, 0.5], true, (t) => {
  t.box('stone', 0, 0, 0, 0.5, 0.125, 0.5);
  t.box('metal', 0.125, 0.125, 0.1875, 0.25, 0.75, 0.3125).box('metal', 0.25, 0.125, 0.1875, 0.375, 0.75, 0.3125);
  t.box('metal', 0.0625, 0.75, 0.125, 0.4375, 1.25, 0.375, 0.125);
  t.box('metal', 0.0, 0.875, 0.1875, 0.0625 + 0.0625, 1.25, 0.3125).box('metal', 0.375, 0.875, 0.1875, 0.5, 1.25, 0.3125);
  t.box('metal', 0.125, 1.25, 0.125, 0.375, 1.5, 0.375);
  t.m('black', 0.1875, 1.375, 0.375).m('red', 0.1875, 1.5, 0.1875);
  t.box('metal', 0.5, 0.25, 0.25, 0.5625 + 0.0625, 1.75, 0.375);
}, { tall: true });

def('broom', [0.25, 0.25], false, (t) => {
  t.box('wood_light', 0.0625, 0.375, 0.0625, 0.1875, 1.5, 0.1875);
  t.box('gold', 0, 0, 0, 0.25, 0.375, 0.25, 0.125);
}, {});

def('front_door', [2, 0.25], false, (t) => {
  t.box('wood_dark', 0, 0, 0, 0.25, 2.5, 0.25).box('wood_dark', 1.75, 0, 0, 2, 2.5, 0.25);
  t.box('wood_dark', 0, 2.5, 0, 2, 2.75, 0.25);
  t.box('wood_light', 0.25, 0, 0, 1.75, 2.25, 0.125, 0.25);
  t.box('wood_dark', 0.375, 0.25, 0.125, 0.875, 1.0, 0.1875 + 0.0625 - 0.0625).box('wood_dark', 1.125, 0.25, 0.125, 1.625, 1.0, 0.1875);
  t.box('wood_dark', 0.375, 1.25, 0.125, 0.875, 2.0, 0.1875).box('wood_dark', 1.125, 1.25, 0.125, 1.625, 2.0, 0.1875);
  t.box('window_night', 0.25, 2.25, 0, 1.75, 2.5, 0.125, 0.25);
  t.m('gold', 0.875, 1.0, 0.125).m('gold', 1.0, 1.0, 0.125);
}, { tall: true });

def('staircase', [2, 3], true, (t) => {
  // 12 steps of 0.25, foot at the front (lz = 3), top (3 m) at the back.
  // Only what the camera can see: the top two layers of each step (tread + riser) and the open
  // west side as a stepped stringer; the hidden mass under the stairs is left out.
  for (let k = 0; k < 12; k++) {
    const z1 = 3 - k * 0.25, z0 = z1 - 0.25, h = (k + 1) * 0.25, lo = Math.max(0, h - 0.5);
    t.box('wood_dark', 0, 0, z0, 0.25, h, z1, 0.25); // stringer
    t.box('wood_dark', 0.25, lo, z0, 0.5, h, z1, 0.25).box('wood_dark', 1.5, lo, z0, 2, h, z1, 0.25);
    if (h > 0.25) t.box('wood_dark', 0.5, lo, z0, 1.5, h - 0.25, z1, 0.25);
    t.box('carpet_wine', 0.5, h - 0.25, z0, 1.5, h, z1, 0.25);
    if (k % 2 === 0) t.box('wood_light', -0.125, h, z0 + 0.0625, 0, h + 0.875, z0 + 0.1875);
    t.box('wood_light', -0.125, h + 0.875, z0, 0, h + 1.0, z1);
  }
  t.box('wood_dark', -0.25, 0, 2.75, 0.0, 1.25, 3.0); // newel post
  t.box('gold', -0.25, 1.25, 2.75, 0.0, 1.5, 3.0);
}, { tall: true });

// Top of the stairs on the upper floor: a hole with steps going down. The world removes the floor slab here.
def('stairwell', o => [o.w || 2, o.d || 1], false, (t, o, w, d) => {
  const n = Math.round(d / 0.25);
  for (let k = 0; k < n; k++) {
    const top = -(k + 1) * 0.25;
    t.box('wood_dark', 0, -1.5, k * 0.25, w, top - 0.25, (k + 1) * 0.25, 0.25);
    t.box('carpet_wine', 0, top - 0.25, k * 0.25, w, top, (k + 1) * 0.25, 0.25);
  }
  t.box('black', 0, -1.75, 0, w, -1.5, d, 0.25);
  for (const lx of [-0.125, w]) {
    for (let lz = 0; lz < d; lz += 0.5) t.box('wood_light', lx, 0, lz, lx + 0.125, 0.875, lz + 0.125);
    t.box('wood_dark', lx, 0.875, 0, lx + 0.125, 1.0, d);
    t.box('gold', lx, 1.0, 0, lx + 0.125, 1.125, 0.125);
  }
}, { flat: true, hole: true });

// ───────────────────────── small evidence objects (drawn centred on the item point) ─────────────────────────

def('whiskey_glass', [0.125, 0.125], false, (t) => { t.m('gold', 0, 0, 0); t.m('glass', 0, 0.125, 0); });
def('pocket_watch', [0.375, 0.125], false, (t) => { t.box('gold', 0, 0, 0, 0.375, 0.125, 0.125); t.m('white', 0.125, 0.0625, 0.0625); });
def('earring', [0.125, 0.125], false, (t) => { t.m('pearl', 0, 0, 0); t.m('gold', 0.0625, 0.0625, 0.125); });
def('manuscript', [0.375, 0.25], false, (t) => {
  t.box('paper', 0, 0, 0, 0.375, 0.125, 0.25);
  t.box('paper', 0.0625, 0.125, 0.0625, 0.3125, 0.25, 0.25);
});
def('pill_bottle', [0.125, 0.125], false, (t) => { t.box('white', 0, 0, 0, 0.125, 0.25, 0.125); t.m('terracotta', 0, 0.25, 0); });
def('shawl', [0.25, 0.25], false, (t) => { t.box('red', 0, 0, 0, 0.25, 0.875, 0.125); t.box('red', 0, 0.375, 0.125, 0.25, 0.875, 0.25); });
def('will_paper', [0.375, 0.25], false, (t) => { t.box('paper', 0, 0, 0, 0.375, 0.125, 0.25); t.m('red', 0.125, 0.125, 0.125); });
def('ledger_book', [0.375, 0.25], false, (t) => { t.box('book_green', 0, 0, 0, 0.375, 0.125, 0.25); });
def('memo', [0.25, 0.25], false, (t) => { t.box('paper', 0, 0, 0, 0.25, 0.125, 0.25); });
def('glove', [0.375, 0.25], false, (t) => {
  t.box('white', 0, 0, 0.0625, 0.25, 0.125, 0.1875);
  t.m('white', 0.25, 0, 0).m('white', 0.25, 0, 0.125);
  t.m('red', 0.125, 0.0625, 0.125);
});

// ───────────────────────── layout helpers (pure, used by world.js and the case data) ─────────────────────────

const NULL_BUILDER = { add() { return this; }, addBox() { return this; } };

// World footprint [x0, z0, x1, z1] of one decor entry [name, x, z, rot, opt].
export function entryFootprint([name, x, z, rot = 0, opt = {}]) {
  const p = PROPS[name];
  if (!p) throw new Error(`unknown prop: ${name}`);
  const [w, d] = p.size(opt);
  const W = rot % 2 ? d : w, D = rot % 2 ? w : d;
  return [x, z, x + W, z + D];
}

// Collision rects for MAP.solids, snapped INWARD to the 0.5 m grid so they never over-block.
export function solidsFromDecor(decor, rooms) {
  const floorOf = new Map(rooms.map(r => [r.id, r.floor]));
  const out = [];
  for (const [room, list] of Object.entries(decor)) {
    if (!floorOf.has(room)) continue;
    for (const [name, x, z, rot = 0, opt = {}] of list) {
      const p = PROPS[name];
      if (!p) throw new Error(`unknown prop: ${name}`);
      const { solid } = p(NULL_BUILDER, x, 0, z, rot, opt);
      if (!solid) continue;
      const r = [Math.ceil(solid[0] * 2 - 1e-6) / 2, Math.ceil(solid[1] * 2 - 1e-6) / 2,
        Math.floor(solid[2] * 2 + 1e-6) / 2, Math.floor(solid[3] * 2 + 1e-6) / 2];
      if (r[2] > r[0] && r[3] > r[1]) out.push({ floor: floorOf.get(room), rect: r, prop: name });
    }
  }
  return out;
}
