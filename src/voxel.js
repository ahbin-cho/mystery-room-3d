// Block builder: collects blocks, then emits one InstancedMesh per (texture key, size).
import * as THREE from 'three';
import { makeTexture } from './textures.js';

const TRANSLUCENT = { glass: 0.45, water: 0.4 };
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
    m = new THREE.MeshLambertMaterial(opts);
    matCache.set(key, m);
  }
  return m;
}

export class VoxelBuilder {
  constructor() {
    this.groups = new Map(); // "key|size" -> { key, size, pos: number[] }
  }

  // (x,y,z) is the block's minimum corner, in metres.
  add(key, x, y, z, size = 0.5) {
    const id = `${key}|${size}`;
    let g = this.groups.get(id);
    if (!g) {
      g = { key, size, pos: [] };
      this.groups.set(id, g);
    }
    g.pos.push(x, y, z);
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

  build() {
    const group = new THREE.Group();
    const m4 = new THREE.Matrix4();
    for (const { key, size, pos } of this.groups.values()) {
      const n = pos.length / 3;
      const mesh = new THREE.InstancedMesh(boxGeo(size), material(key), n);
      const h = size / 2;
      for (let i = 0; i < n; i++) {
        m4.makeTranslation(pos[i * 3] + h, pos[i * 3 + 1] + h, pos[i * 3 + 2] + h);
        mesh.setMatrixAt(i, m4);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.name = `${key}@${size}`;
      if (key in TRANSLUCENT) mesh.renderOrder = 1;
      group.add(mesh);
    }
    return group;
  }
}
