import * as THREE from 'three';
import { clamp, smoothstep } from '../core/math';
import { Noise2 } from '../render/Paint';
import { dirtTexture, grassTexture, mudTexture, roadTexture } from '../render/Textures';

/**
 * World frame: X = along the battlefield (east → right of screen), Y = up, Z = depth toward the
 * camera. The playable depth band is DEPTH_MIN..DEPTH_MAX; the camera looks from +Z.
 */
export const DEPTH_MIN = -17;
export const DEPTH_MAX = 6;

export type SurfaceKind = 'road' | 'grass' | 'dirt' | 'mud' | 'rubble' | 'bridge' | 'water';

export interface SurfaceInfo {
  kind: SurfaceKind;
  /** rolling resistance coefficient for tracked vehicles (Bekker-style simplification) */
  roll: number;
  /** usable traction coefficient */
  traction: number;
  /** infantry speed factor */
  foot: number;
  dust: number;
}

export const SURFACES: Record<SurfaceKind, SurfaceInfo> = {
  road: { kind: 'road', roll: 0.03, traction: 0.75, foot: 1, dust: 0.6 },
  grass: { kind: 'grass', roll: 0.07, traction: 0.65, foot: 0.95, dust: 0.25 },
  dirt: { kind: 'dirt', roll: 0.06, traction: 0.7, foot: 0.95, dust: 0.9 },
  mud: { kind: 'mud', roll: 0.13, traction: 0.42, foot: 0.7, dust: 0.05 },
  rubble: { kind: 'rubble', roll: 0.1, traction: 0.6, foot: 0.75, dust: 0.8 },
  bridge: { kind: 'bridge', roll: 0.03, traction: 0.75, foot: 1, dust: 0.3 },
  water: { kind: 'water', roll: 1, traction: 0.1, foot: 0.3, dust: 0 },
};

export interface TerrainDef {
  x0: number;
  x1: number;
  seed: number;
  roadZ: number;
  roadHalf: number;
  /** authored height features within the band */
  hills: { x: number; z: number; rx: number; rz: number; h: number }[];
  mud: { x: number; z: number; r: number }[];
  /** decorative river in the far background along x */
  farRiverZ: number;
  /** village squares get dirt/cobble instead of grass */
  village: { x0: number; x1: number }[];
}

export class Terrain {
  private n1: Noise2;
  private n2: Noise2;
  readonly group = new THREE.Group();
  private craters: { x: number; z: number; r: number; d: number }[] = [];
  private near: { mesh: THREE.Mesh; x0: number; x1: number; z0: number; z1: number; nx: number; nz: number } | null = null;

  /** cached height grid over the near strip (0.5 m) — gameplay queries are bilinear lookups */
  private grid: Float32Array;
  private gx0: number;
  private gz0 = -46;
  private gnx: number;
  private gnz: number;
  private readonly gs = 0.5;

  constructor(readonly def: TerrainDef) {
    this.n1 = new Noise2(def.seed, 256);
    this.n2 = new Noise2(def.seed + 99, 256);
    this.group.name = 'terrain';
    this.gx0 = def.x0 - 250;
    this.gnx = Math.ceil((def.x1 + 250 - this.gx0) / this.gs) + 1;
    this.gnz = Math.ceil((70 - this.gz0) / this.gs) + 1;
    this.grid = new Float32Array(this.gnx * this.gnz);
    for (let iz = 0; iz < this.gnz; iz++) {
      for (let ix = 0; ix < this.gnx; ix++) this.grid[iz * this.gnx + ix] = this.computeHeight(this.gx0 + ix * this.gs, this.gz0 + iz * this.gs);
    }
    this.build();
  }

  /** ground height (m) */
  height(x: number, z: number) {
    const fx = (x - this.gx0) / this.gs, fz = (z - this.gz0) / this.gs;
    if (fx < 0 || fz < 0 || fx >= this.gnx - 1 || fz >= this.gnz - 1) return this.computeHeight(x, z);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const g = this.grid, n = this.gnx, i = iz * n + ix;
    const a = g[i], b = g[i + 1], c = g[i + n], e = g[i + n + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + e) * tx * tz;
  }

  private computeHeight(x: number, z: number) {
    const d = this.def;
    let h = (this.n1.fbm(x / 70 + 100, z / 70 + 100, 4) - 0.5) * 1.3;
    // flatten near the road; let fields roll a little
    const road = 1 - smoothstep(d.roadHalf, d.roadHalf + 4, Math.abs(z - d.roadZ));
    h *= 1 - road * 0.85;
    for (const hl of d.hills) {
      const u = (x - hl.x) / hl.rx, v = (z - hl.z) / hl.rz;
      const r2 = u * u + v * v;
      if (r2 < 1) h += hl.h * (1 - r2) * (1 - r2);
    }
    // the far background climbs into hills, the river valley dips
    const back = smoothstep(-40, -150, z);
    h += back * (8 + 22 * this.n2.fbm(x / 160, z / 160, 4)) * smoothstep(-60, -110, z);
    const rv = Math.exp(-(((z - d.farRiverZ) / 22) ** 2));
    h = h * (1 - rv) + -2.2 * rv;
    for (const c of this.craters) {
      const r = Math.hypot(x - c.x, z - c.z);
      if (r < c.r) h -= c.d * (1 - (r / c.r) ** 2);
    }
    return h;
  }

  /** terrain normal by central differences */
  normal(x: number, z: number, out = new THREE.Vector3()) {
    const e = 0.6;
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  surface(x: number, z: number): SurfaceInfo {
    const d = this.def;
    if (Math.abs(z - d.roadZ) < d.roadHalf) return SURFACES.road;
    for (const m of d.mud) if ((x - m.x) ** 2 + (z - m.z) ** 2 < m.r * m.r) return SURFACES.mud;
    for (const v of d.village) if (x > v.x0 && x < v.x1) return SURFACES.dirt;
    if (Math.abs(z - d.roadZ) < d.roadHalf + 1.6) return SURFACES.dirt;
    return SURFACES.grass;
  }

  private splatAt(x: number, z: number): [number, number, number] {
    const d = this.def;
    const rd = Math.abs(z - d.roadZ);
    let dirt = 1 - smoothstep(d.roadHalf, d.roadHalf + 2.6, rd);
    let mud = 0;
    for (const m of d.mud) {
      const r = Math.hypot(x - m.x, z - m.z);
      mud = Math.max(mud, 1 - smoothstep(m.r * 0.6, m.r * 1.15, r));
    }
    for (const v of d.village) {
      const inside = smoothstep(v.x0 - 6, v.x0 + 6, x) * (1 - smoothstep(v.x1 - 6, v.x1 + 6, x)) * (1 - smoothstep(-24, -32, z)) * (1 - smoothstep(10, 18, z));
      dirt = Math.max(dirt, inside * 0.75);
    }
    // worn patches and tracks in the fields
    const wear = smoothstep(0.58, 0.72, this.n2.fbm(x / 18, z / 18, 3));
    dirt = Math.max(dirt, wear * 0.7 * (1 - smoothstep(-30, -60, z)));
    mud = Math.max(mud, smoothstep(0.66, 0.78, this.n1.fbm(x / 30 + 7, z / 30, 3)) * 0.8 * (1 - smoothstep(-25, -45, z)));
    const grass = Math.max(0, 1 - dirt - mud);
    const s = grass + dirt + mud;
    return [grass / s, dirt / s, mud / s];
  }

  private build() {
    const d = this.def;
    this.group.clear();
    // near strip (fine) + far background (coarse)
    const near = this.patch(d.x0 - 250, d.x1 + 250, -46, 70, 2, 1);
    this.near = { mesh: near, x0: d.x0 - 250, x1: d.x1 + 250, z0: -46, z1: 70, nx: Math.ceil((d.x1 + 250 - (d.x0 - 250)) / 2), nz: Math.ceil((70 + 46) / 1) };
    this.group.add(near);
    this.group.add(this.patch(d.x0 - 700, d.x1 + 700, -420, -44, 10, 6));
    this.group.add(this.roadMesh());
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(d.x1 - d.x0 + 1600, 46).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x5d6f78, roughness: 0.18, metalness: 0.35 }),
    );
    water.position.set((d.x0 + d.x1) / 2, -1.1, d.farRiverZ);
    water.receiveShadow = true;
    this.group.add(water);
  }

  private patch(x0: number, x1: number, z0: number, z1: number, sx: number, sz: number) {
    const nx = Math.ceil((x1 - x0) / sx), nz = Math.ceil((z1 - z0) / sz);
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
    const col = new Float32Array((nx + 1) * (nz + 1) * 3);
    const spl = new Float32Array((nx + 1) * (nz + 1) * 3);
    let i = 0;
    for (let iz = 0; iz <= nz; iz++) {
      for (let ix = 0; ix <= nx; ix++) {
        const x = x0 + (ix / nx) * (x1 - x0), z = z0 + (iz / nz) * (z1 - z0);
        pos[i * 3] = x; pos[i * 3 + 1] = this.height(x, z); pos[i * 3 + 2] = z;
        const s = this.splatAt(x, z);
        spl[i * 3] = s[0]; spl[i * 3 + 1] = s[1]; spl[i * 3 + 2] = s[2];
        // large-scale field colour variation (crop / meadow patches), desaturating with distance
        const v = this.n2.fbm(x / 90 + 30, z / 90, 3);
        const far = smoothstep(-40, -200, z);
        const t = 0.82 + 0.32 * v;
        col[i * 3] = t * (1 + 0.15 * far); col[i * 3 + 1] = t * (1 + 0.05 * far); col[i * 3 + 2] = t * (0.9 + 0.1 * far);
        i++;
      }
    }
    const idx: number[] = [];
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const a = iz * (nx + 1) + ix, b = a + 1, c = a + nx + 1, e = c + 1;
        idx.push(a, c, b, b, c, e);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('splat', new THREE.BufferAttribute(spl, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, groundMaterial());
    mesh.receiveShadow = true;
    return mesh;
  }

  private roadMesh() {
    const d = this.def;
    const x0 = d.x0 - 250, x1 = d.x1 + 250;
    const nx = Math.ceil((x1 - x0) / 2), nz = 6;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let ix = 0; ix <= nx; ix++) {
      for (let iz = 0; iz <= nz; iz++) {
        const x = x0 + (ix / nx) * (x1 - x0);
        const z = d.roadZ - d.roadHalf - 0.3 + (iz / nz) * (d.roadHalf * 2 + 0.6);
        pos.push(x, this.height(x, z) + 0.035, z);
        uv.push(x / 24, iz / nz);
      }
    }
    for (let ix = 0; ix < nx; ix++) {
      for (let iz = 0; iz < nz; iz++) {
        const a = ix * (nz + 1) + iz, b = a + 1, c = a + nz + 1, e = c + 1;
        idx.push(a, b, c, b, e, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.92, transparent: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    mesh.name = 'road';
    return mesh;
  }

  /** shell craters lower the ground (cover for infantry, rough going for tanks) */
  addCrater(x: number, z: number, r: number, depth: number) {
    this.craters.push({ x, z, r, d: depth });
    const ix0 = Math.max(0, Math.floor((x - r - this.gx0) / this.gs)), ix1 = Math.min(this.gnx - 1, Math.ceil((x + r - this.gx0) / this.gs));
    const iz0 = Math.max(0, Math.floor((z - r - this.gz0) / this.gs)), iz1 = Math.min(this.gnz - 1, Math.ceil((z + r - this.gz0) / this.gs));
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const rr = Math.hypot(this.gx0 + ix * this.gs - x, this.gz0 + iz * this.gs - z);
        if (rr < r) this.grid[iz * this.gnx + ix] -= depth * (1 - (rr / r) ** 2);
      }
    }
    // displace only the near-strip vertices inside the crater, and re-derive their normals
    const n = this.near;
    if (!n) return;
    const geo = n.mesh.geometry;
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    const nm = geo.getAttribute('normal') as THREE.BufferAttribute;
    const fx = (n.x1 - n.x0) / n.nx, fz = (n.z1 - n.z0) / n.nz;
    const vx0 = Math.max(0, Math.floor((x - r - 1 - n.x0) / fx)), vx1 = Math.min(n.nx, Math.ceil((x + r + 1 - n.x0) / fx));
    const vz0 = Math.max(0, Math.floor((z - r - 1 - n.z0) / fz)), vz1 = Math.min(n.nz, Math.ceil((z + r + 1 - n.z0) / fz));
    const v = new THREE.Vector3();
    let lo = Infinity, hi = -1;
    for (let iz = vz0; iz <= vz1; iz++) {
      for (let ix = vx0; ix <= vx1; ix++) {
        const i = iz * (n.nx + 1) + ix;
        const vx = p.getX(i), vz = p.getZ(i);
        p.setY(i, this.height(vx, vz));
        this.normal(vx, vz, v);
        nm.setXYZ(i, v.x, v.y, v.z);
        lo = Math.min(lo, i);
        hi = Math.max(hi, i);
      }
    }
    if (hi >= lo) {
      p.addUpdateRange(lo * 3, (hi - lo + 1) * 3);
      nm.addUpdateRange(lo * 3, (hi - lo + 1) * 3);
      p.needsUpdate = true;
      nm.needsUpdate = true;
    }
  }

  clampDepth(z: number) {
    return clamp(z, DEPTH_MIN, DEPTH_MAX);
  }
}

let groundMat: THREE.MeshStandardMaterial | null = null;
function groundMaterial() {
  if (groundMat) return groundMat;
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.96, metalness: 0 });
  const grass = grassTexture(), dirt = dirtTexture(), mud = mudTexture();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.grassMap = { value: grass };
    sh.uniforms.dirtMap = { value: dirt };
    sh.uniforms.mudMap = { value: mud };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 splat;\nvarying vec3 vSplat;\nvarying vec2 vGround;\nvarying float vDist;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;\nvec4 wpG = modelMatrix * vec4(position, 1.0);\nvGround = wpG.xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D grassMap, dirtMap, mudMap;\nvarying vec3 vSplat;\nvarying vec2 vGround;')
      .replace('#include <map_fragment>', `
        vec2 gUv = vGround * 0.11;
        vec2 gUv2 = vGround * 0.023 + vec2(0.37, 0.71);
        vec3 gc = mix(texture2D(grassMap, gUv).rgb, texture2D(grassMap, gUv2).rgb, 0.4);
        vec3 dc = mix(texture2D(dirtMap, gUv).rgb, texture2D(dirtMap, gUv2).rgb, 0.35);
        vec3 mc = texture2D(mudMap, gUv * 0.8).rgb;
        vec3 tex = gc * vSplat.x + dc * vSplat.y + mc * vSplat.z;
        diffuseColor.rgb *= tex * 1.6;`);
  };
  groundMat = m;
  return m;
}
