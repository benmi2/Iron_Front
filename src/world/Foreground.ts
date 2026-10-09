import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RNG } from '../core/rng';
import { Noise2, paintTexture } from '../render/Paint';
import { stoneTexture, woodTexture } from '../render/Textures';
import { DEPTH_MAX } from './Terrain';
import { mergeChunked } from '../render/Merge';
import type { World } from './World';

/**
 * Purely visual dressing between the playable band and the camera: dry-stone walls, broken
 * fences, ammunition crates and fuel drums, a burnt-out lorry, steel hedgehogs, and a dense strip
 * of grass with poppies that moves in the wind. Nothing here is an Obstacle: units never go there.
 * The depth of field blurs it, which frames the action like the foreground of a painting.
 */

const Z0 = DEPTH_MAX + 1.2;
const Z1 = DEPTH_MAX + 17;

const shared = new Map<string, THREE.Material>();
function std(key: string, o: THREE.MeshStandardMaterialParameters) {
  let m = shared.get(key);
  if (!m) shared.set(key, (m = new THREE.MeshStandardMaterial(o)));
  return m as THREE.MeshStandardMaterial;
}

/* ------------------------------------------------------------------ grass */

type Tuft = 'grass' | 'poppy' | 'dry';

function tuftTexture(kind: Tuft, seed: number) {
  return paintTexture(`tuft-${kind}-${seed}`, 256, 256, (ctx, w, h) => {
    const r = new RNG(seed);
    ctx.clearRect(0, 0, w, h);
    const blades = kind === 'dry' ? 70 : 95;
    for (let i = 0; i < blades; i++) {
      const x0 = w * 0.5 + r.normal(0, w * 0.13);
      const len = h * r.range(0.45, 0.97);
      const lean = r.normal(0, w * 0.16);
      const g = ctx.createLinearGradient(0, h, 0, h - len);
      const dry = kind === 'dry' || r.chance(0.18);
      const base = dry ? [110, 96, 52] : [44, 70, 26];
      const tip = dry ? [200, 178, 104] : r.chance(0.5) ? [112, 150, 52] : [146, 170, 64];
      g.addColorStop(0, `rgb(${base.join(',')})`);
      g.addColorStop(1, `rgb(${tip.join(',')})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = r.range(1.6, 3.4);
      ctx.beginPath();
      ctx.moveTo(x0, h);
      ctx.quadraticCurveTo(x0 + lean * 0.3, h - len * 0.6, x0 + lean, h - len);
      ctx.stroke();
    }
    if (kind === 'poppy') {
      for (let i = 0; i < 11; i++) {
        const x = w * 0.5 + r.normal(0, w * 0.17);
        const y = h * r.range(0.12, 0.45);
        ctx.strokeStyle = 'rgb(60,78,30)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + r.range(-8, 8), h);
        ctx.lineTo(x, y);
        ctx.stroke();
        const s = r.range(17, 26);
        for (let k = 0; k < 4; k++) {
          ctx.fillStyle = k % 2 ? 'rgb(206,34,24)' : 'rgb(178,22,18)';
          ctx.beginPath();
          ctx.ellipse(x + Math.cos(k * 1.6) * s * 0.35, y + Math.sin(k * 1.6) * s * 0.25, s * 0.62, s * 0.45, k, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = 'rgb(28,20,18)';
        ctx.beginPath();
        ctx.arc(x, y, s * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, { srgb: true, mip: true });
}

/** crossed quads with up-facing normals (lit like the ground) */
function tuftGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 2; i++) {
    const g = new THREE.PlaneGeometry(1, 1);
    g.translate(0, 0.5, 0);
    g.rotateY(i * Math.PI / 2 + 0.4);
    parts.push(g);
  }
  const g = mergeGeometries(parts)!;
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

const windTime = { value: 0 };
/** where the dressing goes while building (merged into chunks afterwards) */
let target: THREE.Object3D;

function grassMaterial(map: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.windTime = windTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float windTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          float gust = sin(windTime * 0.7 + ip.x * 0.05) * 0.5 + 0.5;
          float sway = sin(windTime * 2.1 + ip.x * 0.9 + ip.z * 0.5) * (0.06 + 0.1 * gust);
          transformed.x += sway * position.y * position.y;
          transformed.z += sway * 0.4 * position.y;
        #endif`);
    // the cards carry up-facing normals; undo three's back-face flip so both sides light alike
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      #ifdef DOUBLE_SIDED
        normal *= faceDirection;
      #endif`);
  };
  m.customProgramCacheKey = () => 'grass-wind';
  return m;
}

function addGrass(w: World, x0: number, x1: number, seed: number) {
  const r = new RNG(seed);
  const noise = new Noise2(seed, 128);
  const geo = tuftGeometry();
  const kinds: Tuft[] = ['grass', 'poppy', 'dry'];
  const mats = kinds.map((k, i) => grassMaterial(tuftTexture(k, 300 + i)));
  const chunk = 40;
  const tmp = new THREE.Object3D();
  for (let cx = x0; cx < x1; cx += chunk) {
    const lists: THREE.Matrix4[][] = [[], [], []];
    const area = chunk * (Z1 - Z0 + 4);
    const n = Math.floor(area * 7);
    for (let i = 0; i < n; i++) {
      const x = cx + r.range(0, chunk);
      const z = r.range(Z0 - 1.5, Z1 + 3);
      const field = noise.fbm(x / 26, z / 26, 3);
      // poppies grow in drifts; dry grass in patches
      const k = field > 0.55 && r.chance(0.6) ? 1 : noise.fbm(x / 13 + 50, z / 13, 2) > 0.66 ? 2 : 0;
      const near = (z - Z0) / (Z1 - Z0);
      const hgt = r.range(0.3, 0.62) * (0.8 + near * 0.6) * (k === 2 ? 1.2 : 1);
      tmp.position.set(x, w.terrain.height(x, z) - 0.04, z);
      tmp.rotation.set(0, r.range(0, Math.PI), 0);
      tmp.scale.set(hgt * r.range(0.9, 1.4), hgt, hgt * r.range(0.9, 1.4));
      tmp.updateMatrix();
      lists[k].push(tmp.matrix.clone());
    }
    lists.forEach((list, k) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mats[k], list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.computeBoundingSphere();
      im.receiveShadow = true;
      im.castShadow = false;
      if (k === 0) im.onBeforeRender = () => { windTime.value = performance.now() / 1000; };
      target.add(im);
    });
  }
}

/* ------------------------------------------------------------------ dry-stone wall */

function stoneWall(w: World, x0: number, x1: number, z: number, seed: number) {
  const r = new RNG(seed);
  const m = std('fg-stone', { map: stoneTexture(14, '#a39884'), roughness: 0.95 });
  const parts: THREE.BufferGeometry[] = [];
  const len = x1 - x0;
  // the wall is partly tumbled: its height follows a slow random profile
  const prof = new Noise2(seed, 32);
  for (let x = 0; x < len; ) {
    const s = r.range(0.32, 0.55);
    const hTop = 0.45 + 0.75 * prof.fbm(x / 7, seed, 2);
    for (let y = 0; y < hTop; ) {
      const sy = s * r.range(0.45, 0.7);
      const g = new THREE.DodecahedronGeometry(0.5, 0);
      g.scale(s * r.range(1.0, 1.5), sy, r.range(0.45, 0.6));
      g.rotateY(r.range(-0.2, 0.2));
      g.rotateZ(r.range(-0.12, 0.12));
      g.translate(x + r.range(-0.05, 0.05), y + sy / 2, r.range(-0.06, 0.06));
      parts.push(g);
      y += sy * 0.82;
    }
    x += s * r.range(0.95, 1.25);
  }
  // fallen stones in front
  for (let i = 0; i < len * 0.5; i++) {
    const s = r.range(0.2, 0.42);
    const g = new THREE.DodecahedronGeometry(0.5, 0);
    g.scale(s, s * 0.6, s * 0.8);
    g.rotateY(r.range(0, 3));
    g.translate(r.range(0, len), s * 0.2, r.range(0.4, 1.4));
    parts.push(g);
  }
  const geo = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
  geo.computeVertexNormals();
  // planar UVs so the stone texture reads on every face
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { uv[i * 2] = (pos.getX(i) + pos.getZ(i)) / 1.6; uv[i * 2 + 1] = pos.getY(i) / 1.6; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x0, w.terrain.height(x0 + len / 2, z) - 0.12, z);
  mesh.castShadow = mesh.receiveShadow = true;
  target.add(mesh);
}

/* ------------------------------------------------------------------ fences */

function brokenFence(w: World, x0: number, x1: number, z: number, seed: number) {
  const r = new RNG(seed);
  const m = std('fg-fence', { map: woodTexture(7, '#5e4e3a'), roughness: 1 });
  const g = new THREE.Group();
  const posts: [number, number][] = [];
  for (let x = x0; x <= x1; x += r.range(2.2, 2.8)) {
    if (r.chance(0.12)) continue;
    const h = r.range(1.0, 1.35);
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.11, h, 0.11), m);
    p.position.set(x, h / 2 + w.terrain.height(x, z) - 0.15, z);
    p.rotation.set(r.range(-0.15, 0.15), r.range(0, 1), r.range(-0.18, 0.18));
    g.add(p);
    posts.push([x, h]);
  }
  for (let i = 0; i + 1 < posts.length; i++) {
    const [xa] = posts[i], [xb] = posts[i + 1];
    for (const y of [0.42, 0.88]) {
      if (r.chance(0.25)) continue;
      const broken = r.chance(0.2);
      const len = (xb - xa) * (broken ? r.range(0.4, 0.7) : 1.04);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.045), m);
      const gy = w.terrain.height(xa, z) - 0.15;
      rail.position.set(xa + len / 2, gy + y + r.range(-0.05, 0.05), z + 0.07);
      rail.rotation.z = broken ? r.range(-0.5, -0.2) : r.range(-0.04, 0.04);
      if (broken) rail.position.y -= len * 0.18;
      g.add(rail);
    }
  }
  g.traverse((o) => { (o as THREE.Mesh).castShadow = (o as THREE.Mesh).receiveShadow = true; });
  target.add(g);
}

/* ------------------------------------------------------------------ supplies */

function crateTexture() {
  return paintTexture('fg-crate', 256, 256, (ctx, w, h) => {
    const r = new RNG(5);
    for (let i = 0; i < 6; i++) {
      const y = (i * h) / 6;
      ctx.fillStyle = `rgb(${92 + r.int(-10, 10)},${84 + r.int(-8, 8)},${52 + r.int(-6, 6)})`;
      ctx.fillRect(0, y, w, h / 6);
      ctx.fillStyle = 'rgba(30,24,14,0.6)';
      ctx.fillRect(0, y, w, 2);
      for (let k = 0; k < 30; k++) { ctx.fillStyle = `rgba(40,32,18,${r.range(0.05, 0.2)})`; ctx.fillRect(r.range(0, w), y + r.range(2, h / 6), r.range(10, 60), 1); }
    }
    ctx.fillStyle = 'rgb(64,58,36)';
    ctx.fillRect(0, 0, 18, h); ctx.fillRect(w - 18, 0, 18, h);
    ctx.fillStyle = 'rgba(232,222,196,0.75)';
    ctx.font = 'bold 26px monospace';
    ctx.fillText('CTG 75MM', 40, 110);
    ctx.font = '18px monospace';
    ctx.fillText('M48 HE  LOT 2241', 40, 140);
  }, { srgb: true });
}

function drumGeometry() {
  const pts: THREE.Vector2[] = [];
  const R = 0.29, H = 0.88;
  pts.push(new THREE.Vector2(0, 0));
  for (let i = 0; i <= 20; i++) {
    const y = (i / 20) * H;
    const rib = Math.abs(y - H / 3) < 0.02 || Math.abs(y - (2 * H) / 3) < 0.02 ? 0.012 : 0;
    const rim = y < 0.02 || y > H - 0.02 ? 0.008 : 0;
    pts.push(new THREE.Vector2(R + rib + rim, y));
  }
  pts.push(new THREE.Vector2(0, H));
  return new THREE.LatheGeometry(pts, 18);
}

function supplies(w: World, x: number, z: number, seed: number) {
  const r = new RNG(seed);
  const g = new THREE.Group();
  const crate = std('fg-cratemat', { map: crateTexture(), roughness: 0.92 });
  const drumMats = [std('fg-drum1', { color: 0x3d4a32, roughness: 0.6, metalness: 0.45 }), std('fg-drum2', { color: 0x6a5a40, roughness: 0.7, metalness: 0.35 }), std('fg-drum3', { color: 0x5a2c20, roughness: 0.75, metalness: 0.4 })];
  const can = std('fg-jerry', { color: 0x3e4630, roughness: 0.6, metalness: 0.35 });
  const drum = drumGeometry();
  const nC = r.int(1, 4);
  for (let i = 0; i < nC; i++) {
    const L = r.range(0.75, 1.1), H = r.range(0.32, 0.42), D = r.range(0.42, 0.55);
    const c = new THREE.Mesh(new THREE.BoxGeometry(L, H, D), crate);
    const stack = i >= 2;
    c.position.set(r.range(-0.9, 0.9), H / 2 + (stack ? H : 0), r.range(-0.4, 0.4));
    c.rotation.y = r.range(-0.6, 0.6);
    g.add(c);
  }
  const nD = r.int(0, 3);
  for (let i = 0; i < nD; i++) {
    const d = new THREE.Mesh(drum, r.pick(drumMats));
    if (r.chance(0.3)) { d.rotation.z = Math.PI / 2; d.position.set(r.range(-1.6, 1.6), 0.29, r.range(-0.8, 0.8)); d.rotation.y = r.range(0, 3); }
    else d.position.set(r.range(-1.6, 1.6), 0, r.range(-0.8, 0.8));
    g.add(d);
  }
  for (let i = 0; i < r.int(0, 3); i++) {
    const j = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.47, 0.16), can);
    j.position.set(r.range(-1.4, 1.4), 0.235, r.range(-0.6, 0.6));
    j.rotation.y = r.range(0, 3);
    g.add(j);
  }
  g.position.set(x, w.terrain.height(x, z) - 0.03, z);
  g.rotation.y = r.range(-0.4, 0.4);
  g.traverse((o) => { (o as THREE.Mesh).castShadow = (o as THREE.Mesh).receiveShadow = true; });
  target.add(g);
}

function hedgehog(w: World, x: number, z: number, seed: number) {
  const r = new RNG(seed);
  const m = std('fg-beam', { color: 0x3e3028, roughness: 0.7, metalness: 0.55 });
  const g = new THREE.Group();
  // three angle-iron beams riveted at their centres
  const dirs = [new THREE.Vector3(1, 1, 0), new THREE.Vector3(-1, 1, 0.2), new THREE.Vector3(0.1, 1, 1)];
  for (const d of dirs) {
    const beam = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.1, 0.02), m);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.02, 2.1, 0.14), m);
    a.position.z = -0.06; b.position.x = -0.06;
    beam.add(a, b);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    g.add(beam);
  }
  g.position.set(x, w.terrain.height(x, z) + 0.55, z);
  g.rotation.y = r.range(0, 3);
  g.traverse((o) => { (o as THREE.Mesh).castShadow = (o as THREE.Mesh).receiveShadow = true; });
  target.add(g);
}

/** burnt-out 3-ton lorry lying in the ditch */
function wreckedLorry(w: World, x: number, z: number, yaw: number, seed: number) {
  const r = new RNG(seed);
  const g = new THREE.Group();
  const burnt = std('fg-burnt', { color: 0x2c2520, roughness: 0.95, metalness: 0.25 });
  const rust = std('fg-rust', { color: 0x5a3422, roughness: 0.9, metalness: 0.3 });
  const paint = std('fg-truckpaint', { color: 0x46492f, roughness: 0.8, metalness: 0.2 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    g.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(6.4, 0.22, 0.16), burnt, 0, 0.78, -0.48);
  add(new THREE.BoxGeometry(6.4, 0.22, 0.16), burnt, 0, 0.78, 0.48);
  // cab: open-topped, blistered paint shading into rust
  add(new THREE.BoxGeometry(1.5, 1.05, 2.0), rust, 1.6, 1.45, 0);
  add(new THREE.BoxGeometry(0.06, 0.9, 1.9), burnt, 2.33, 2.0, 0, 0, 0, -0.35);
  add(new THREE.BoxGeometry(1.25, 0.75, 1.15), paint, 2.95, 1.25, 0);
  add(new THREE.BoxGeometry(0.1, 0.62, 1.0), burnt, 3.6, 1.2, 0);
  for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.62, 0.62, 0.55, 14, 1, true, 0, Math.PI), paint, 2.9, 0.8, s * 0.92, Math.PI / 2, 0, 0);
  // cargo bed: charred boards, bent bows of the canvas cover
  add(new THREE.BoxGeometry(3.6, 0.1, 2.2), burnt, -1.4, 1.05, 0);
  for (let i = 0; i < 8; i++) {
    if (r.chance(0.3)) continue;
    add(new THREE.BoxGeometry(0.42, r.range(0.25, 0.6), 0.05), burnt, -3.0 + i * 0.45, 1.35, 1.08, 0, 0, r.range(-0.2, 0.2));
  }
  for (let i = 0; i < 3; i++) {
    const bow = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.025, 4, 10, Math.PI), burnt);
    bow.position.set(-2.6 + i * 1.1, 1.15, 0);
    bow.rotation.set(0, Math.PI / 2, r.range(-0.25, 0.25));
    g.add(bow);
  }
  const tyre = std('fg-tyre', { color: 0x161412, roughness: 0.95 });
  for (const [wx, wz, gone] of [[2.9, -0.95, false], [2.9, 0.95, true], [-1.2, -0.95, false], [-1.2, 0.95, false], [-2.2, -0.95, true], [-2.2, 0.95, false]] as [number, number, boolean][]) {
    add(new THREE.CylinderGeometry(gone ? 0.3 : 0.5, gone ? 0.3 : 0.5, 0.26, 14).rotateX(Math.PI / 2), gone ? burnt : tyre, wx, gone ? 0.3 : 0.48, wz);
  }
  g.position.set(x, w.terrain.height(x, z) - 0.15, z);
  g.rotation.set(r.range(-0.08, 0.08), yaw, r.range(0.04, 0.12));
  g.traverse((o) => { (o as THREE.Mesh).castShadow = (o as THREE.Mesh).receiveShadow = true; });
  target.add(g);
  w.effects.emitter({ pos: new THREE.Vector3(x, w.terrain.height(x, z) + 1.5, z), kind: 'smolder', intensity: 0.9 });
}

/* ------------------------------------------------------------------ layout */

export function buildForeground(w: World, x0: number, x1: number, seed: number) {
  const r = new RNG(seed);
  const fg = new THREE.Group();
  fg.name = 'foreground';
  target = fg;
  w.root.add(fg);
  addGrass(w, x0 - 60, x1 + 60, seed + 1);
  // walls: long runs with gaps, roughly parallel to the road
  for (let x = x0 - 60; x < x1 + 60; ) {
    const len = r.range(10, 30);
    if (r.chance(0.7)) stoneWall(w, x, x + len, Z0 + r.range(2.5, 4.5), r.int(1, 9999));
    x += len + r.range(6, 28);
  }
  for (let x = x0 - 60; x < x1 + 60; ) {
    const len = r.range(8, 22);
    if (r.chance(0.65)) brokenFence(w, x, x + len, Z0 + r.range(7, 10), r.int(1, 9999));
    x += len + r.range(10, 30);
  }
  for (let x = x0 - 40; x < x1 + 40; x += r.range(16, 38)) supplies(w, x, Z0 + r.range(1, 9), r.int(1, 9999));
  for (let x = x0 + 30; x < x1; x += r.range(90, 160)) if (r.chance(0.6)) hedgehog(w, x, Z0 + r.range(0.5, 3), r.int(1, 9999));
  for (let x = x0 + 140; x < x1; x += r.range(240, 330)) wreckedLorry(w, x, Z0 + r.range(5, 8), r.range(-0.4, 0.4) + (r.chance(0.5) ? Math.PI : 0), r.int(1, 9999));
  // hundreds of small props -> a few draw calls per 80 m of front
  mergeChunked(fg, 80);
}
