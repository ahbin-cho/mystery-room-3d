// 저택 생성 (스펙 4.2 · 4.4): 층마다 바닥·벽·문틀·창문·소품·바깥 눈밭을 블록으로 쌓는다.
// 정적인 것은 전부 VoxelBuilder(InstancedMesh)로 묶어 층당 드로우콜을 낮게 유지한다.
// 벽은 층마다 별도 그룹(wallGroups[floor])이라 나중에 카메라-플레이어 사이 벽을 흐리게 처리할 수 있다.
//
// 조명 API (Task 10/11):
//   scene.add(makeSceneLights());      // 달빛 + 반구광, 한 번
//   scene.add(world.lightPool);        // 방 조명 풀(PointLight 4개 고정), 한 번
//   updateLights(world, floor, roomId) // 플레이어가 있는 방이 바뀔 때마다: 그 방 + 문으로 이어진 가까운 방 3곳을 밝힌다
//   setVisibleFloor(world, floor)      // 층 전환 (조명 개수는 그대로라 셰이더 재컴파일 없음)
// world.roomLights[roomId] 는 PointLight 가 아니라 그 방 조명의 설정값 {color, intensity, distance, decay, position} 이다.
import * as THREE from 'three';
import { VoxelBuilder } from './voxel.js';
import { PROPS, frame, entryFootprint } from './props.js';
import { doorCells } from './core/map.js';

const C = 0.5; // grid cell / big block
const WALL_H = 3;
const LIGHT_K = 16; // PointLight candela per unit of room light intensity (tuned in dev/world-viewer.html)
const EPS = 1e-6;
const LIGHT_POOL = 4; // point lights alive at once: the player's room + its nearest door neighbours

const ci = v => Math.round(v / C); // metres -> cell index (cell min corner)
const ck = (i, j) => `${i},${j}`;
const overlap = (a, b) => a[0] < b[2] - EPS && b[0] < a[2] - EPS && a[1] < b[3] - EPS && b[1] < a[3] - EPS;

function floorBases(map) {
  const out = [];
  let y = 0;
  for (const f of map.floors) { out[f.id] = y; y += f.height || WALL_H; }
  return out;
}

// Wall stack (bottom → top) for one ordinary wall cell of a room.
function wallStack(room) {
  const t = room.wallTex;
  if (t === 'glass') return [['stone', 0, 0.5], ['glass', 0.5, 2.5], ['white', 2.5, 3]];
  if (t.startsWith('wallpaper') || t.startsWith('book')) return [['wood_dark', 0, 0.5], [t, 0.5, 2.5], ['wood_dark', 2.5, 3]];
  return [[t, 0, 3]];
}

// Sill, curtains and rod on the room side of a 1 m window. rot/x/z as in props.js (front = into the room).
function windowDressing(b, x, y, z, rot, curtain) {
  const t = frame(b, x, y, z, rot, 1.5, 0.125);
  t.box('wood_light', 0.125, 0.875, 0, 1.375, 1.0, 0.125);
  t.box(curtain, 0, 1.0, 0, 0.25, 2.5, 0.125).box(curtain, 1.25, 1.0, 0, 1.5, 2.5, 0.125);
  t.box('gold', 0, 1.375, 0.0625, 0.25, 1.5, 0.1875).box('gold', 1.25, 1.375, 0.0625, 1.5, 1.5, 0.1875); // tie-backs
  t.box('wood_dark', 0, 2.5, 0, 1.5, 2.625, 0.125);
}

export function buildWorld(caseData) {
  const MAP = caseData.MAP, ITEMS = caseData.ITEMS || [];
  const DECOR = caseData.DECOR || { rooms: {} };
  const decorRooms = DECOR.rooms || {};
  const bases = floorBases(MAP);
  const roomById = new Map(MAP.rooms.map(r => [r.id, r]));

  const world = {
    floors: [], wallGroups: [], itemMarkers: {}, itemVisuals: {},
    stairMarkers: {}, passageMarkers: {}, roomLights: {}, passageDoors: {},
    lightPool: new THREE.Group(), lightNeighbours: {},
  };
  // A fixed pool of point lights shared by both floors. The count never changes, so switching floors
  // never recompiles shaders, and each fragment evaluates LIGHT_POOL lights instead of one per room.
  world.lightPool.name = 'room-light-pool';
  for (let i = 0; i < LIGHT_POOL; i++) {
    const L = new THREE.PointLight(0xffffff, 0, 10, 1.2);
    L.name = `pool-light-${i}`;
    world.lightPool.add(L);
  }
  // Neighbours = rooms joined by a door, nearest first.
  const centre = r => [(r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2];
  for (const r of MAP.rooms) {
    const [cx, cz] = centre(r);
    world.lightNeighbours[r.id] = (MAP.doors || [])
      .filter(d => d.a === r.id || d.b === r.id).map(d => (d.a === r.id ? d.b : d.a))
      .filter(id => roomById.get(id) && roomById.get(id).floor === r.floor)
      .sort((p, q) => { const [px, pz] = centre(roomById.get(p)), [qx, qz] = centre(roomById.get(q)); return Math.hypot(px - cx, pz - cz) - Math.hypot(qx - cx, qz - cz); });
  }

  for (const fl of MAP.floors) {
    const f = fl.id, base = bases[f];
    const rooms = MAP.rooms.filter(r => r.floor === f);
    const group = new THREE.Group();
    group.name = `floor-${f}`;
    const walls = new VoxelBuilder();
    const deco = new VoxelBuilder();

    // Which cells belong to which room on this floor.
    const cellRoom = new Map();
    for (const r of rooms)
      for (let j = ci(r.rect[1]); j < ci(r.rect[3]); j++)
        for (let i = ci(r.rect[0]); i < ci(r.rect[2]); i++) cellRoom.set(ck(i, j), r);

    // Decor footprints, for keeping windows / door leaves clear of furniture.
    const blockers = [], holes = [], rugs = [];
    for (const r of rooms) for (const e of decorRooms[r.id] || []) {
      const p = PROPS[e[0]];
      const fp = entryFootprint(e);
      if (p.hole) holes.push(fp);
      if (e[0] === 'rug' && !(e[4] && e[4].y)) rugs.push(fp); // a rug's sunk blocks hide the slab under it
      if (!p.flat) blockers.push({ fp, tall: !!p.tall, room: r.id });
    }
    const blocked = (rect, tallOnly) => blockers.some(bk => (!tallOnly || bk.tall) && overlap(rect, bk.fp));

    // ── door openings, posts and leaves ──
    const openCells = new Set(), postCells = new Set();
    for (const d of MAP.doors || []) {
      const A = roomById.get(d.a), B = roomById.get(d.b);
      if (!A || A.floor !== f) continue;
      const dc = doorCells(d, A, B, C); // same cells buildGrid opens (origin 0,0 = world cell indices)
      if (!dc) continue;
      const o = dc.o;
      for (const [i, j] of dc.open) openCells.add(ck(i, j));
      for (const [i, j] of dc.posts) postCells.add(ck(i, j));
      const half = d.width / 2;
      const lo = (o === 'v' ? d.z : d.x) - half, hi = (o === 'v' ? d.z : d.x) + half;
      // Two leaves swung flat against the wall on B's side, when nothing stands there.
      const bAfter = o === 'v' ? Math.abs(B.rect[0] - d.x) < EPS : Math.abs(B.rect[1] - d.z) < EPS;
      const face = (o === 'v' ? d.x : d.z) + (bAfter ? C : -C);
      const n0 = bAfter ? face : face - 0.25, n1 = n0 + 0.25;
      for (const [a0, a1, knob] of [[lo - 1, lo, lo - 0.875], [hi, hi + 1, hi + 0.75]]) {
        const rect = o === 'v' ? [n0, a0, n1, a1] : [a0, n0, a1, n1];
        const wallRoomOk = o === 'v' ? (a0 >= B.rect[1] + C - EPS && a1 <= B.rect[3] - C + EPS) : (a0 >= B.rect[0] + C - EPS && a1 <= B.rect[2] - C + EPS);
        if (!wallRoomOk || blocked(rect, false)) continue;
        deco.addBox('wood_light', rect[0], base, rect[1], rect[2], base + 2.25, rect[3], 0.25);
        const kx = o === 'v' ? (bAfter ? n1 : n0 - 0.125) : knob, kz = o === 'v' ? knob : (bAfter ? n1 : n0 - 0.125);
        deco.add('gold', kx, base + 1.0, kz, 0.125);
      }
    }

    // ── walls ──
    const windowCells = new Set();
    const underWall = new Set(); // cells whose slab block is hidden under a wall column
    const noWin = new Set(DECOR.noWindows || []);
    const wallWins = DECOR.wallWindows || [];
    const curtains = DECOR.curtains || {};
    for (const r of rooms) {
      const [x0, z0, x1, z1] = r.rect;
      const i0 = ci(x0), i1 = ci(x1) - 1, j0 = ci(z0), j1 = ci(z1) - 1;
      const stack = wallStack(r), glassRoom = r.wallTex === 'glass';
      // edges: cells along the wall, outward step, rot facing into the room
      const edges = {
        N: { cells: [], out: [0, -1], rot: 0 }, S: { cells: [], out: [0, 1], rot: 2 },
        W: { cells: [], out: [-1, 0], rot: 1 }, E: { cells: [], out: [1, 0], rot: 3 },
      };
      for (let i = i0; i <= i1; i++) { edges.N.cells.push([i, j0]); edges.S.cells.push([i, j1]); }
      for (let j = j0; j <= j1; j++) { edges.W.cells.push([i0, j]); edges.E.cells.push([i1, j]); }
      const plan = new Map(); // cell key -> 'open' | 'post' | 'window' | 'glasswin' | 'pillar' | 'wall'
      for (const [name, e] of Object.entries(edges)) {
        const L = e.cells.length;
        const isExt = ([i, j]) => !cellRoom.has(ck(i + e.out[0], j + e.out[1]));
        e.cells.forEach(([i, j], k) => {
          const key = ck(i, j);
          if (openCells.has(key)) { plan.set(key, 'open'); return; }
          if (postCells.has(key)) { plan.set(key, 'post'); return; }
          if (plan.has(key)) return; // corner already decided by the other edge
          if (k === 0 || k === L - 1) { plan.set(key, glassRoom ? 'pillar' : 'wall'); return; }
          // explicit interior windows (e.g. kitchen → conservatory)
          const ww = wallWins.find(w => w.room === r.id && w.edge === name);
          if (ww) {
            const along = name === 'N' || name === 'S' ? i * C : j * C;
            if (along >= ww.from - EPS && along + C <= ww.to + EPS) { plan.set(key, 'glasswin'); return; }
          }
          if (glassRoom) { plan.set(key, k % 4 === 0 ? 'pillar' : 'wall'); return; }
          plan.set(key, 'wall');
        });
        // exterior windows: 1 m pairs every 2 m, never next to a door or behind tall furniture
        if (glassRoom || noWin.has(r.id)) continue;
        for (let p = 2; p + 1 <= L - 3; p += 4) {
          const pair = [e.cells[p], e.cells[p + 1]];
          if (!pair.every(c => isExt(c) && plan.get(ck(...c)) === 'wall')) continue;
          const nb = [e.cells[p - 1], e.cells[p + 2]].filter(Boolean);
          if (nb.some(c => ['open', 'post'].includes(plan.get(ck(...c))))) continue;
          const [ai, aj] = pair[0];
          const ax = ai * C, az = aj * C;
          let band, dress;
          if (name === 'N') { band = [ax, az + C, ax + 1, az + C + 0.75]; dress = [ax - 0.25, az + C]; }
          if (name === 'S') { band = [ax, az - 0.75, ax + 1, az]; dress = [ax - 0.25, az - 0.125]; }
          if (name === 'W') { band = [ax + C, az, ax + C + 0.75, az + 1]; dress = [ax + C, az - 0.25]; }
          if (name === 'E') { band = [ax - 0.75, az, ax, az + 1]; dress = [ax - 0.125, az - 0.25]; }
          if (blocked(band, true)) continue;
          pair.forEach(c => { plan.set(ck(...c), 'window'); windowCells.add(ck(...c)); });
          windowDressing(deco, dress[0], base, dress[1], e.rot, curtains[r.id] || 'carpet_wine');
        }
      }
      for (const [key, kind] of plan) {
        if (kind !== 'open') underWall.add(key);
        const [i, j] = key.split(',').map(Number);
        const x = i * C, z = j * C;
        // door opening: no lintel (it would hide the gap from the top-down camera), just a wooden threshold
        if (kind === 'open') { deco.add('wood_light', x, base - C + 0.025, z, C); continue; }
        if (kind === 'post') { walls.addBox('wood_dark', x, base, z, x + C, base + WALL_H, z + C); continue; }
        if (kind === 'pillar') { walls.addBox('stone', x, base, z, x + C, base + C, z + C); walls.addBox('white', x, base + C, z, x + C, base + WALL_H, z + C); continue; }
        for (const [tex, a, b] of stack) {
          if ((kind === 'window' || kind === 'glasswin') && a < 2.0 && b > 1.0) {
            // split the band around the window rows (1.0 – 2.0 m)
            if (a < 1.0) walls.addBox(tex, x, base + a, z, x + C, base + 1.0, z + C);
            walls.addBox(kind === 'window' ? 'window_night' : 'glass', x, base + 1.0, z, x + C, base + 2.0, z + C);
            if (b > 2.0) walls.addBox(tex, x, base + 2.0, z, x + C, base + b, z + C);
          } else walls.addBox(tex, x, base + a, z, x + C, base + b, z + C);
        }
      }
      // conservatory: a glass roof only on the far (north) side + a white rim, so the camera
      // (which looks from the south) still sees into the room.
      if (glassRoom) {
        deco.addBox('white', x0, base + WALL_H, z0, x1, base + WALL_H + 0.125, z0 + 0.25, 0.125);
        deco.addBox('glass', x0 + C, base + WALL_H, z0 + 0.25, x1 - C, base + WALL_H + 0.25, z0 + 1.75, 0.25);
        for (let x = x0 + 1.5; x < x1 - 1; x += 2) deco.addBox('white', x, base + WALL_H, z0 + 0.25, x + 0.125, base + WALL_H + 0.25, z0 + 1.75, 0.125);
        deco.addBox('white', x0 + C, base + WALL_H + 0.25, z0 + 1.625, x1 - C, base + WALL_H + 0.375, z0 + 1.75, 0.125);
      }
    }

    // ── floors (slab under every room, minus stairwell holes and the cells under walls) ──
    for (const r of rooms)
      for (let j = ci(r.rect[1]); j < ci(r.rect[3]); j++)
        for (let i = ci(r.rect[0]); i < ci(r.rect[2]); i++) {
          const x = i * C, z = j * C;
          if (underWall.has(ck(i, j))) continue;
          if (rugs.some(h => x + EPS >= h[0] && x + C <= h[2] + EPS && z + EPS >= h[1] && z + C <= h[3] + EPS)) continue;
          if (holes.some(h => x + EPS >= h[0] && x + C <= h[2] + EPS && z + EPS >= h[1] && z + C <= h[3] + EPS)) continue;
          deco.add(r.floorTex, x, base - C, z);
        }

    // ── exterior skin: one stone layer round the outside (windows show through).
    // The game camera looks north from inside the house, so only skin on the house's SOUTH side ever shows
    // its outer face; elsewhere only the top is visible and we draw just the top block + snow.
    const skin = new Set();
    for (const key of cellRoom.keys()) {
      const [i, j] = key.split(',').map(Number);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const k2 = ck(i + di, j + dj);
        if (!cellRoom.has(k2)) skin.add(k2);
      }
    }
    for (const key of skin) {
      const [i, j] = key.split(',').map(Number);
      const nbRooms = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
        .map(([di, dj]) => cellRoom.get(ck(i + di, j + dj))).filter(Boolean);
      if (nbRooms.every(r => r.wallTex === 'glass')) continue;
      const x = i * C, z = j * C;
      const win = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => windowCells.has(ck(i + di, j + dj)));
      const southFace = cellRoom.has(ck(i, j - 1)) || cellRoom.has(ck(i - 1, j - 1)) || cellRoom.has(ck(i + 1, j - 1));
      if (!southFace) walls.addBox('stone', x, base + WALL_H - C, z, x + C, base + WALL_H, z + C);
      else if (win) {
        walls.addBox('stone', x, base - C, z, x + C, base + 1.0, z + C);
        walls.addBox('window_night', x, base + 1.0, z, x + C, base + 2.0, z + C);
        walls.addBox('stone', x, base + 2.0, z, x + C, base + WALL_H, z + C);
      } else walls.addBox('stone', x, base - C, z, x + C, base + WALL_H, z + C);
      walls.add('snow', x, base + WALL_H, z, 0.25); walls.add('snow', x + 0.25, base + WALL_H, z + 0.25, 0.25);
    }

    // ── outside: snowy ground (and, upstairs, the snowy roofs of the ground floor) ──
    const inRects = (x, z, list) => list.some(r => x >= r.rect[0] - EPS && x + 1 <= r.rect[2] + EPS && z >= r.rect[1] - EPS && z + 1 <= r.rect[3] + EPS);
    const ground = MAP.rooms.filter(r => r.floor === 0);
    // Snow only as far out as a camera inside the house can see (more to the north: the camera looks north).
    const bb = MAP.rooms.reduce((a, r) => [Math.min(a[0], r.rect[0]), Math.min(a[1], r.rect[1]), Math.max(a[2], r.rect[2]), Math.max(a[3], r.rect[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    for (let z = Math.floor(bb[1]) - 6; z < Math.ceil(bb[3]) + 4; z++) for (let x = Math.floor(bb[0]) - 4; x < Math.ceil(bb[2]) + 4; x++) {
      if (!inRects(x, z, ground)) { deco.add('snow', x, -1.25, z, 1); continue; }
      if (f === 0) continue;
      // upstairs: the snowy roof of the ground floor wherever no upper room or wall stands
      const quads = [[0, 0], [C, 0], [0, C], [C, C]].filter(([dx, dz]) => {
        const k = ck(ci(x + dx), ci(z + dz));
        return !skin.has(k) && !cellRoom.has(k);
      });
      if (quads.length === 4) deco.add('snow', x, base - 1.25, z, 1);
      else for (const [dx, dz] of quads) deco.add('snow', x + dx, base - 0.75, z + dz, C);
    }
    for (const e of DECOR.outside || []) PROPS[e[0]](deco, e[1], -0.25, e[2], e[3] || 0, e[4] || {});

    // ── furniture ──
    for (const r of rooms) for (const e of decorRooms[r.id] || []) {
      const [name, x, z, rot = 0, opt = {}] = e;
      if (opt.door) { // a movable piece (secret bookshelf): its own group so it can slide open later
        const db = new VoxelBuilder();
        PROPS[name](db, x, base + (opt.y || 0), z, rot, opt);
        const g = db.build();
        g.name = `door-${opt.door}`;
        group.add(g);
        world.passageDoors[opt.door] = g;
        continue;
      }
      PROPS[name](deco, x, base + (opt.y || 0), z, rot, opt);
    }

    const wallGroup = walls.build();
    wallGroup.name = `walls-${f}`;
    group.add(wallGroup);
    const decoGroup = deco.build();
    decoGroup.name = `decor-${f}`;
    group.add(decoGroup);
    world.wallGroups[f] = wallGroup;

    // ── room light settings (the actual PointLights live in world.lightPool, see updateLights) ──
    for (const r of rooms) {
      const [x0, z0, x1, z1] = r.rect;
      const span = Math.max(x1 - x0, z1 - z0);
      world.roomLights[r.id] = {
        room: r.id, floor: f, color: r.light.color, intensity: r.light.intensity * LIGHT_K,
        distance: span * 1.6 + 2, decay: 1.2, position: new THREE.Vector3((x0 + x1) / 2, base + 2.4, (z0 + z1) / 2),
      };
    }

    world.floors[f] = group;
  }

  // ── evidence markers (+ separate visuals for portable evidence) ──
  const looks = DECOR.itemLooks || {};
  for (const it of ITEMS) {
    const r = roomById.get(it.room);
    if (!r) continue;
    const base = bases[r.floor];
    const m = new THREE.Object3D();
    m.name = `item-${it.id}`;
    m.position.set(it.pos[0], base + it.pos[1], it.pos[2]);
    m.userData = { itemId: it.id, room: it.room, floor: r.floor };
    world.floors[r.floor].add(m);
    world.itemMarkers[it.id] = m;
    const look = looks[it.id];
    if (look && PROPS[look[0]]) {
      const vb = new VoxelBuilder();
      const [w, d] = PROPS[look[0]].size({});
      PROPS[look[0]](vb, it.pos[0] - w / 2, base + it.pos[1] + look[1], it.pos[2] - d / 2, 0, {});
      const g = vb.build();
      g.name = `look-${it.id}`;
      world.floors[r.floor].add(g);
      world.itemVisuals[it.id] = g;
      m.userData.visual = g;
    }
  }

  // ── stair / passage end markers ──
  const marker = (kind, id, end) => {
    const r = roomById.get(end.room);
    const o = new THREE.Object3D();
    o.name = `${kind}-${id}-${end.room}`;
    o.position.set(end.x, bases[r.floor], end.z);
    o.userData = { kind, id, room: end.room, floor: r.floor };
    world.floors[r.floor].add(o);
    return o;
  };
  for (const s of MAP.stairs || []) world.stairMarkers[s.id] = { a: marker('stair', s.id, s.a), b: marker('stair', s.id, s.b) };
  for (const p of MAP.passages || []) {
    world.passageMarkers[p.id] = { a: marker('passage', p.id, p.a), b: marker('passage', p.id, p.b) };
    if (world.passageDoors[p.id]) world.passageMarkers[p.id].a.userData.door = world.passageDoors[p.id];
  }
  return world;
}

export function setVisibleFloor(world, floor) {
  world.floors.forEach((g, i) => { if (g) g.visible = i === floor; });
}

// Light the player's room and its nearest door neighbours with the fixed light pool.
// Call whenever the player's room (or floor) changes; it is cheap (just moves/retunes 4 lights).
// roomId may be null/unknown on that floor: the pool then lights nothing (scene lights still apply).
// The caller must have added world.lightPool to the scene once: scene.add(world.lightPool).
export function updateLights(world, floor, roomId) {
  const want = [];
  const cur = world.roomLights[roomId];
  if (cur && cur.floor === floor) {
    want.push(cur);
    for (const id of world.lightNeighbours[roomId] || []) want.push(world.roomLights[id]);
  }
  world.lightPool.children.forEach((L, i) => {
    const s = want[i];
    if (!s) { L.intensity = 0; return; }
    L.color.set(s.color);
    L.intensity = s.intensity;
    L.distance = s.distance;
    L.decay = s.decay;
    L.position.copy(s.position);
  });
  world.litRoom = cur ? roomId : null;
}

// Night sky light shared by every floor: cool moonlight + warm/cool hemisphere fill.
export function makeSceneLights() {
  const g = new THREE.Group();
  g.name = 'scene-lights';
  g.add(new THREE.HemisphereLight(0xc8d8ff, 0x5a4636, 0.75));
  const moon = new THREE.DirectionalLight(0xa8c0ff, 0.6);
  moon.position.set(-8, 20, 14);
  g.add(moon);
  return g;
}
