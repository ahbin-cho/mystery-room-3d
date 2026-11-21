// Block builder: collects blocks, then emits one InstancedMesh per texture key (sizes share a scaled unit cube).
import * as THREE from 'three';
import { makeTexture } from './textures.js';

const TRANSLUCENT = { glass: 0.45, water: 0.4 };
// Keys that glow by themselves (fake light: flames, lamp shades, snowy night windows).
const EMISSIVE = { fire: 1.0, lampshade: 0.85, window_night: 0.7 };
const boxGeoCache = new Map();
const matCache = new Map();

function boxGeo(size) {
  let g = boxGeoCache.get(size);
  if (!g) {
    g = new THREE.BoxGeometry(size, size, size);
    boxGeoCache.set(size, g);
  }
  return g;
}

function material(key) {
  let m = matCache.get(key);
  if (!m) {
    const opts = { map: makeTexture(key) };
    if (key in TRANSLUCENT) {
      opts.transparent = true;
      opts.opacity = TRANSLUCENT[key];
      opts.depthWrite = false;
    }
    if (key in EMISSIVE) {
      opts.emissive = new THREE.Color(0xffffff);
      opts.emissiveMap = opts.map;
      opts.emissiveIntensity = EMISSIVE[key];
    }
    m = new THREE.MeshLambertMaterial(opts);
    matCache.set(key, m);
  }
  return m;
}

export class VoxelBuilder {
  constructor() {
    this.groups = new Map(); // key -> { key, pos: number[] (x, y, z, size per block) }
  }

  // (x,y,z) is the block's minimum corner, in metres.
  add(key, x, y, z, size = 0.5) {
    let g = this.groups.get(key);
    if (!g) {
      g = { key, pos: [] };
      this.groups.set(key, g);
    }
    g.pos.push(x, y, z, size);
    return this;
  }

  // Fills [x0,x1) x [y0,y1) x [z0,z1) with blocks of `size`.
  addBox(key, x0, y0, z0, x1, y1, z1, size = 0.5) {
    const eps = 1e-6;
    const cnt = (a, b) => Math.max(0, Math.ceil((b - a) / size - eps));
    for (let i = 0, n = cnt(x0, x1); i < n; i++)
      for (let j = 0, m = cnt(y0, y1); j < m; j++)
        for (let k = 0, o = cnt(z0, z1); k < o; k++)
          this.add(key, x0 + i * size, y0 + j * size, z0 + k * size, size);
    return this;
  }

  // One InstancedMesh per texture key: every block size shares a unit cube scaled per instance,
  // so big walls and 1/4-size props of the same material cost a single draw call.
  build() {
    const group = new THREE.Group();
    const m4 = new THREE.Matrix4();
    for (const { key, pos } of this.groups.values()) {
      const n = pos.length / 4;
      const mesh = new THREE.InstancedMesh(boxGeo(1), material(key), n);
      for (let i = 0; i < n; i++) {
        const s = pos[i * 4 + 3], h = s / 2;
        m4.makeScale(s, s, s).setPosition(pos[i * 4] + h, pos[i * 4 + 1] + h, pos[i * 4 + 2] + h);
        mesh.setMatrixAt(i, m4);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.name = key;
      if (key in TRANSLUCENT) mesh.renderOrder = 1;
      group.add(mesh);
    }
    return group;
  }
}
