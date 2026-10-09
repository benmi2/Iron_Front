import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RNG } from '../core/rng';
import { barkTexture, leafCardTexture } from '../render/Textures';

/**
 * Volumetric trees and hedges. A crown is a handful of leaf clumps; each clump is a dark solid
 * core (so the crown never looks see-through) wrapped in alpha-tested leaf-cluster cards.
 *
 * The trick that removes the "crossed billboards" look: every card's normals are bent to point
 * out of the crown (an ellipsoid around its centre, blended with the clump's own sphere), and
 * the foliage material does not flip normals on back faces. Intersecting cards therefore light
 * as one soft volume — sunlit on one side, shaded underneath — with no hard seams.
 */

const mats = new Map<string, THREE.Material>();
function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = mats.get(key) as T | undefined;
  if (!m) mats.set(key, (m = make()));
  return m;
}

/** alpha-tested leaf material that keeps the bent normals on both faces */
export function foliageMaterial(tex: THREE.Texture) {
  return cached(`fol${tex.uuid}`, () => {
    const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.92, metalness: 0 });
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
    };
    m.customProgramCacheKey = () => 'foliage-noflip';
    return m;
  });
}

function coreMaterial(tint: string) {
  return cached(`core${tint}`, () => {
    const c = new THREE.Color(tint).multiplyScalar(0.7);
    return new THREE.MeshStandardMaterial({ color: c, roughness: 1 });
  });
}

const barkMat = () => cached('treebark', () => new THREE.MeshStandardMaterial({ map: barkTexture(), roughness: 1 }));

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

/** crown shape used to bend normals: centre and radii */
interface Crown {
  c: THREE.Vector3;
  r: THREE.Vector3;
}

/** normal of a point in the crown: out of the crown ellipsoid, blended with the clump sphere */
function bentNormal(p: THREE.Vector3, crown: Crown, clump: THREE.Vector3, clumpR: number, out: THREE.Vector3) {
  const ex = (p.x - crown.c.x) / crown.r.x, ey = (p.y - crown.c.y) / crown.r.y, ez = (p.z - crown.c.z) / crown.r.z;
  out.set(ex / crown.r.x, ey / crown.r.y, ez / crown.r.z).normalize();
  _v.copy(p).sub(clump).divideScalar(clumpR);
  return out.addScaledVector(_v, 0.45).normalize();
}

/** a ring of leaf cards and a core around one clump; geometry is pushed into the lists */
function clump(r: RNG, crown: Crown, centre: THREE.Vector3, R: number, cards: number, cardSize: number, upright: number, cardGeos: THREE.BufferGeometry[], coreGeos: THREE.BufferGeometry[], stretch = 1) {
  // core: lumpy sphere (a deterministic wobble so the shared vertices stay welded)
  const core = new THREE.IcosahedronGeometry(R * 0.5, 1);
  const pos = core.getAttribute('position') as THREE.BufferAttribute;
  const nrm = core.getAttribute('normal') as THREE.BufferAttribute;
  const ph = r.range(0, 10);
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    const k = 1 + 0.14 * Math.sin(_v.x * 2.3 + ph) * Math.sin(_v.y * 2.9 + ph * 0.7) * Math.sin(_v.z * 2.1 - ph);
    _v.multiplyScalar(k);
    _v.y *= stretch;
    _v.add(centre);
    pos.setXYZ(i, _v.x, _v.y, _v.z);
    bentNormal(_v, crown, centre, R, _s);
    nrm.setXYZ(i, _s.x, _s.y, _s.z);
  }
  core.deleteAttribute('uv');
  coreGeos.push(core);
  for (let i = 0; i < cards; i++) {
    // on the clump surface, more on the top and outer side
    const d = new THREE.Vector3(r.range(-1, 1), r.range(-0.6, 1) + 0.25, r.range(-1, 1)).normalize();
    const p = centre.clone().addScaledVector(d, R * r.range(0.55, 1.0));
    p.y = centre.y + (p.y - centre.y) * stretch;
    const s = cardSize * r.range(0.75, 1.25);
    const g = new THREE.PlaneGeometry(s, s);
    // face roughly outward, tilted at random, rolled at random; `upright` keeps cards vertical (poplars)
    const look = d.clone().add(new THREE.Vector3(r.range(-0.9, 0.9), r.range(-0.5, 0.5), r.range(-0.9, 0.9)));
    look.y *= 1 - upright;
    _m.lookAt(look.normalize(), new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    _q.setFromRotationMatrix(_m).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), r.range(-0.6, 0.6) * (1 - upright) + r.range(-0.15, 0.15)));
    g.applyMatrix4(new THREE.Matrix4().compose(p, _q, new THREE.Vector3(1, 1, 1)));
    const gp = g.getAttribute('position') as THREE.BufferAttribute;
    const gn = g.getAttribute('normal') as THREE.BufferAttribute;
    for (let k = 0; k < gp.count; k++) {
      _v.fromBufferAttribute(gp, k);
      bentNormal(_v, crown, centre, R, _s);
      gn.setXYZ(k, _s.x, _s.y, _s.z);
    }
    cardGeos.push(g);
  }
}

/** a tapered cylinder from a to b */
function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, segs = 6) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, segs, 1);
  g.translate(0, len / 2, 0);
  _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _v.copy(b).sub(a).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(a, _q, new THREE.Vector3(1, 1, 1)));
  // bark repeats along the limb
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * len * 0.35);
  return g;
}

const ROUND_TINTS = ['#4b6230', '#556b2f', '#465c2a', '#5a6a32'];
const POPLAR_TINTS = ['#4f6432', '#45592b', '#53683a'];

/**
 * A free-standing tree (local origin at the foot of the trunk).
 * round = Normandy oak / elm with a broad crown; poplar = Lombardy poplar column.
 */
export function buildTree(seed: number, kind: 'round' | 'poplar' = 'round') {
  const r = new RNG(seed);
  const g = new THREE.Group();
  const poplar = kind === 'poplar';
  const H = poplar ? r.range(14, 20) : r.range(7.5, 11.5);
  const tint = r.pick(poplar ? POPLAR_TINTS : ROUND_TINTS);
  const tex = leafCardTexture(seed % 3, tint, poplar);
  const cardGeos: THREE.BufferGeometry[] = [];
  const coreGeos: THREE.BufferGeometry[] = [];
  const barkGeos: THREE.BufferGeometry[] = [];
  const lean = new THREE.Vector3(r.range(-0.25, 0.25), 0, r.range(-0.15, 0.15));
  let crown: Crown;
  if (poplar) {
    crown = { c: new THREE.Vector3(lean.x, H * 0.56, lean.z), r: new THREE.Vector3(1.9, H * 0.46, 1.9) };
    const top = new THREE.Vector3(lean.x, H * 0.92, lean.z);
    barkGeos.push(limb(new THREE.Vector3(0, -0.2, 0), top, 0.34, 0.08, 8));
    const n = 14;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const y = H * (0.16 + 0.78 * t);
      // widest a third of the way up, tapering to a point
      const R = Math.max(0.75, 1.9 * Math.sin(Math.PI * Math.pow(0.12 + 0.88 * t, 0.7)) * (1 - 0.3 * t));
      const c = new THREE.Vector3(lean.x * (y / H) + r.range(-0.25, 0.25), y, lean.z * (y / H) + r.range(-0.25, 0.25));
      clump(r, crown, c, R, 16, R * 1.3, 0.5, cardGeos, coreGeos, 1.7);
      if (i % 3 === 1) barkGeos.push(limb(new THREE.Vector3(lean.x * (y / H), y - 0.8, lean.z * (y / H)), c.clone().add(new THREE.Vector3(r.range(-0.6, 0.6), 0.6, r.range(-0.4, 0.4))), 0.07, 0.03, 4));
    }
  } else {
    const trunkTop = new THREE.Vector3(lean.x, H * 0.5, lean.z);
    crown = { c: new THREE.Vector3(lean.x, H * 0.66, lean.z), r: new THREE.Vector3(H * 0.4, H * 0.3, H * 0.36) };
    barkGeos.push(limb(new THREE.Vector3(0, -0.2, 0), trunkTop, r.range(0.34, 0.44), 0.2, 9));
    // root flare
    barkGeos.push(limb(new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, 0.5, 0), 0.62, 0.36, 9));
    const n = r.int(7, 10);
    const centres: THREE.Vector3[] = [new THREE.Vector3(lean.x, crown.c.y + crown.r.y * 0.5, lean.z)];
    for (let i = 1; i < n; i++) {
      const a = (i / (n - 1)) * Math.PI * 2 + r.range(-0.4, 0.4);
      const rr = r.range(0.45, 0.72);
      centres.push(new THREE.Vector3(crown.c.x + Math.cos(a) * crown.r.x * rr, crown.c.y + r.range(-0.45, 0.4) * crown.r.y, crown.c.z + Math.sin(a) * crown.r.z * rr));
    }
    for (const c of centres) {
      const R = H * r.range(0.15, 0.21);
      clump(r, crown, c, R, 22, R * 1.25, 0, cardGeos, coreGeos);
      // main bough from the trunk head into the clump
      const from = trunkTop.clone().add(new THREE.Vector3(0, r.range(-0.6, 0.4), 0));
      barkGeos.push(limb(from, c.clone().lerp(from, 0.25), 0.16, 0.06, 5));
    }
  }
  const add = (geos: THREE.BufferGeometry[], mat: THREE.Material) => {
    const merged = mergeGeometries(geos, false);
    for (const x of geos) x.dispose();
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  };
  add(barkGeos, barkMat());
  add(coreGeos, coreMaterial(tint));
  add(cardGeos, foliageMaterial(tex));
  return g;
}

/**
 * Hedge foliage along a bank section: clumps every ≈1.8 m, local x along the hedge, top of the
 * bank at y = `base`. Returns a group (cores + leaf cards) to add to the hedge section.
 */
export function buildHedge(seed: number, length: number, base: number) {
  const r = new RNG(seed);
  const g = new THREE.Group();
  const tint = r.pick(['#3e5428', '#4b6230', '#445a2c']);
  const tex = leafCardTexture(10 + (seed % 2), tint);
  const crown: Crown = { c: new THREE.Vector3(0, base + 0.6, 0), r: new THREE.Vector3(length * 0.5 + 2, 2.4, 1.6) };
  const cardGeos: THREE.BufferGeometry[] = [];
  const coreGeos: THREE.BufferGeometry[] = [];
  const n = Math.max(2, Math.round(length / 1.8));
  for (let i = 0; i < n; i++) {
    const x = -length / 2 + (length / n) * (i + 0.5) + r.range(-0.3, 0.3);
    const R = r.range(1.3, 1.7);
    const c = new THREE.Vector3(x, base + r.range(1.1, 1.8), r.range(-0.3, 0.3));
    // the hedge crown is a long sausage: bend normals out from its axis, not from its middle
    crown.c.x = x;
    clump(r, crown, c, R, 14, R * 1.3, 0.2, cardGeos, coreGeos, 1.25);
  }
  const cores = new THREE.Mesh(mergeGeometries(coreGeos, false), coreMaterial(tint));
  const cards = new THREE.Mesh(mergeGeometries(cardGeos, false), foliageMaterial(tex));
  for (const x of [...coreGeos, ...cardGeos]) x.dispose();
  for (const m of [cores, cards]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
  return g;
}
