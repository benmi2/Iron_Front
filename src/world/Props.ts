import * as THREE from 'three';
import { RNG } from '../core/rng';
import { barkTexture, foliageTexture, plasterTexture, roofTileTexture, sandbagTexture, signTexture, stoneTexture, wallLetteringTexture, woodTexture, craterTexture } from '../render/Textures';
import { Obstacle } from './Obstacle';
import { mergeByMaterial } from '../render/Merge';
import type { World } from './World';

/**
 * Normandy 1944 set dressing. Every prop that matters physically registers an Obstacle; the
 * visual reacts to damage (holes, collapsing roofs, rubble) and the obstacle changes with it
 * (a collapsed house no longer blocks sight, a breached wall gives less cover).
 */

const mats = new Map<string, THREE.Material>();
function mat(key: string, make: () => THREE.Material) {
  let m = mats.get(key);
  if (!m) mats.set(key, (m = make()));
  return m;
}
const std = (key: string, o: THREE.MeshStandardMaterialParameters) => mat(key, () => new THREE.MeshStandardMaterial(o)) as THREE.MeshStandardMaterial;

/** quad wall with metric UVs (texture repeats every `tile` metres) */
function wallQuad(w: number, h: number, tile = 4) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile);
  return g;
}

function boxUV(w: number, h: number, d: number, tile = 4) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    const su = nx > 0.5 ? d : w;
    const sv = ny > 0.5 ? d : h;
    uv.setXY(i, (uv.getX(i) * su) / tile, (uv.getY(i) * sv) / tile);
  }
  return g;
}

function shadow<T extends THREE.Object3D>(o: T, cast = true, receive = true) {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = cast;
      c.receiveShadow = receive;
    }
  });
  return o;
}

/* ====================================================================== houses */

export interface HouseOpts {
  x: number;
  z: number;
  w: number;
  d: number;
  floors: 1 | 2;
  style: 'stone' | 'plaster';
  tint?: string;
  roofTint?: string;
  sign?: string;
  lettering?: string[];
  damage?: number;
  seed: number;
  /** a mairie / café front: tricolour flagpole */
  flag?: boolean;
}

export function addHouse(w: World, o: HouseOpts) {
  const r = new RNG(o.seed);
  const g = new THREE.Group();
  const gy = Math.min(w.terrain.height(o.x - o.w / 2, o.z), w.terrain.height(o.x + o.w / 2, o.z), w.terrain.height(o.x, o.z + o.d / 2), w.terrain.height(o.x, o.z - o.d / 2)) - 0.2;
  g.position.set(o.x, gy, o.z);
  const H = o.floors * 3.0 + 0.6;
  const wallTex = o.style === 'stone' ? stoneTexture(o.seed % 3 + 1, o.tint ?? '#a69a84') : plasterTexture(o.seed % 3 + 1, o.tint ?? '#cbbd9e');
  const wallMat = std(`wall${wallTex.uuid}`, { map: wallTex, roughness: 0.95 });
  const roofTex = roofTileTexture(o.seed % 2 + 1, o.roofTint ?? '#8a4a32');
  const roofMat = std(`roof${roofTex.uuid}`, { map: roofTex, roughness: 0.9, side: THREE.DoubleSide });
  const woodMat = std('wood', { map: woodTexture(1, '#5d4a35'), roughness: 0.9 });
  const shutterMat = std(`shut${o.seed % 3}`, { map: woodTexture(o.seed % 3 + 2, r.pick(['#4d5a46', '#5a6b6e', '#6b5a3a', '#3f4a52'])), roughness: 0.85 });
  const darkMat = std('winDark', { color: 0x0c0b0a, roughness: 1 });
  const hw = o.w / 2, hd = o.d / 2;
  const walls = new THREE.Group();
  const front = new THREE.Mesh(wallQuad(o.w, H), wallMat); front.position.set(0, H / 2, hd);
  const back = new THREE.Mesh(wallQuad(o.w, H), wallMat); back.position.set(0, H / 2, -hd); back.rotation.y = Math.PI;
  const left = new THREE.Mesh(wallQuad(o.d, H), wallMat); left.position.set(-hw, H / 2, 0); left.rotation.y = -Math.PI / 2;
  const right = new THREE.Mesh(wallQuad(o.d, H), wallMat); right.position.set(hw, H / 2, 0); right.rotation.y = Math.PI / 2;
  walls.add(front, back, left, right);
  // stone plinth / foundation
  const plinth = new THREE.Mesh(boxUV(o.w + 0.12, 0.7, o.d + 0.12), std('plinth', { map: stoneTexture(7, '#8f8574'), roughness: 1 }));
  plinth.position.y = 0.35;
  walls.add(plinth);
  // gable roof along x
  const rh = o.d * 0.42 + 0.4;
  const ov = 0.35;
  const slope = Math.hypot(hd + ov, rh);
  const roof = new THREE.Group();
  for (const s of [-1, 1]) {
    // local +y of the plane runs from the eave up to the ridge; its normal points up and out
    const p = new THREE.Mesh(wallQuad(o.w + ov * 2, slope, 3), roofMat);
    p.position.set(0, H + rh / 2, (s * (hd + ov)) / 2);
    p.rotation.x = -s * Math.atan2(hd + ov, rh);
    roof.add(p);
  }
  // gable triangles
  const tri = new THREE.Shape([new THREE.Vector2(-hd, 0), new THREE.Vector2(hd, 0), new THREE.Vector2(0, rh)]);
  const triGeo = new THREE.ShapeGeometry(tri);
  const tuv = triGeo.getAttribute('uv') as THREE.BufferAttribute;
  const tpos = triGeo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tpos.getX(i) / 4, tpos.getY(i) / 4);
  for (const s of [-1, 1]) {
    const t = new THREE.Mesh(triGeo, wallMat);
    t.position.set(s * hw, H, 0);
    t.rotation.y = (s * Math.PI) / 2;
    roof.add(t);
  }
  // chimney
  const ch = new THREE.Mesh(boxUV(0.6, 1.8, 0.6, 2), wallMat);
  ch.position.set(hw * 0.6 * (r.chance(0.5) ? 1 : -1), H + rh * 0.6, -hd * 0.2);
  roof.add(ch);
  // rafters exposed when the roof is broken
  const rafters = new THREE.Group();
  for (let x = -hw; x <= hw; x += 0.9) {
    for (const s of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, slope), woodMat);
      b.position.set(x, H + rh / 2, (s * hd) / 2);
      b.rotation.x = s * Math.atan2(rh, hd);
      rafters.add(b);
    }
  }
  rafters.visible = false;
  // windows, shutters, door on the front (camera side) and back
  const openings = new THREE.Group();
  const nWin = Math.max(1, Math.floor(o.w / 3.2));
  for (const face of [1, -1]) {
    for (let f = 0; f < o.floors; f++) {
      for (let i = 0; i < nWin; i++) {
        const x = -hw + (o.w / nWin) * (i + 0.5);
        const isDoor = face === 1 && f === 0 && i === Math.floor(nWin / 2);
        const ww = isDoor ? 1.1 : 0.85, wh = isDoor ? 2.1 : 1.25;
        const y = f * 3 + (isDoor ? 1.25 : 1.6) + 0.15;
        const hole = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), isDoor ? woodMat : darkMat);
        hole.position.set(x, y, face * (hd + 0.01));
        if (face < 0) hole.rotation.y = Math.PI;
        openings.add(hole);
        // stone lintel & sill
        const lint = new THREE.Mesh(new THREE.BoxGeometry(ww + 0.3, 0.16, 0.12), std('lintel', { color: 0xb9ad96, roughness: 0.9 }));
        lint.position.set(x, y + wh / 2 + 0.08, face * (hd + 0.04));
        openings.add(lint);
        if (!isDoor) {
          const sill = lint.clone();
          sill.position.y = y - wh / 2 - 0.06;
          openings.add(sill);
          for (const sd of [-1, 1]) {
            if (r.chance(0.2)) continue;
            const sh = new THREE.Mesh(new THREE.BoxGeometry(ww / 2, wh, 0.04), shutterMat);
            const open = r.range(0.2, 1.4);
            const piv = new THREE.Group();
            piv.position.set(x + (sd * ww) / 2, y, face * (hd + 0.04));
            sh.position.x = (sd * ww) / 4;
            piv.add(sh);
            piv.rotation.y = sd * open * face;
            openings.add(piv);
          }
        }
      }
    }
  }
  g.add(walls, roof, rafters, openings);
  if (o.sign) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(o.w * 0.7, o.sign.length * 0.42 + 0.6), 0.55), std(`sign${o.sign}`, { map: signTexture(o.sign, '#e2d8bc', '#2a2a3a'), roughness: 0.8 }));
    s.position.set(0, 3.3, hd + 0.05);
    g.add(s);
  }
  if (o.lettering) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(o.d * 0.8, o.d * 0.8), std(`let${o.lettering.join()}`, { map: wallLetteringTexture(o.lettering), transparent: true, roughness: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    s.position.set(hw + 0.02, H * 0.55, 0);
    s.rotation.y = Math.PI / 2;
    g.add(s);
  }
  if (o.flag) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4), std('pole', { color: 0x2a2a2a }));
    pole.position.set(0, H - 0.4, hd + 0.5);
    pole.rotation.x = 0.6;
    g.add(pole);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), std('tricolour', { map: tricolour(), side: THREE.DoubleSide, roughness: 1 }));
    fl.position.set(0.45, H + 0.2, hd + 1.0);
    g.add(fl);
  }
  shadow(g);
  w.root.add(g);
  const ob = new Obstacle({
    kind: 'house', cx: o.x, cz: o.z, hx: hw, hz: hd, y0: gy, y1: gy + H + rh, blocksTanks: true, blocksFoot: true, blocksLOS: true,
    stopsBullets: true, shellMm: 45, hp: 2600 * o.w * o.d / 60, label: 'stone house',
  });
  ob.object = g;
  // firing positions at the windows facing the road
  for (let i = 0; i < nWin; i++) ob.slots.push(new THREE.Vector3(o.x - hw + (o.w / nWin) * (i + 0.5), gy + 0.2, o.z + hd + 0.5));
  const holes: THREE.Mesh[] = [];
  const holeMat = std('househole', { map: craterTexture(), transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, color: 0x2a2420 });
  ob.onDamage = (obs, frac, point) => {
    // punch a hole where it was hit (front face toward the camera shows it best)
    if (holes.length < 10) {
      const lp = g.worldToLocal(point.clone());
      const h = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), holeMat);
      const faceZ = Math.abs(Math.abs(lp.z) - hd) < Math.abs(Math.abs(lp.x) - hw);
      if (faceZ) { h.position.set(lp.x, lp.y, Math.sign(lp.z || 1) * (hd + 0.03)); if (lp.z < 0) h.rotation.y = Math.PI; }
      else { h.position.set(Math.sign(lp.x || 1) * (hw + 0.03), lp.y, lp.z); h.rotation.y = (Math.sign(lp.x || 1) * Math.PI) / 2; }
      h.rotation.z = Math.random() * 6;
      g.add(h);
      holes.push(h);
    }
    if (frac < 0.55 && roof.children[0].visible) {
      roof.children[0].visible = false;
      rafters.visible = true;
      w.effects.explosion(new THREE.Vector3(o.x, gy + H + 1, o.z), 0.3, false, gy, false);
    }
    void obs;
  };
  ob.onDestroyed = () => {
    collapseToRubble(w, g, o.x, o.z, o.w, o.d, gy, wallMat);
    w.effects.burn(new THREE.Vector3(o.x, gy + 1.5, o.z), 1.6, 120);
  };
  if (o.damage && o.damage > 0) {
    if (o.damage > 0.4) { roof.children[0].visible = false; rafters.visible = true; }
  }
  w.addObstacle(ob);
  return ob;
}

function tricolour() {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#20307a'; x.fillRect(0, 0, 32, 64);
  x.fillStyle = '#efefe8'; x.fillRect(32, 0, 32, 64);
  x.fillStyle = '#c82a2a'; x.fillRect(64, 0, 32, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function collapseToRubble(w: World, g: THREE.Group, x: number, z: number, wd: number, d: number, gy: number, wallMat: THREE.Material) {
  // keep a ruined shell: low broken walls + a rubble mound
  g.clear();
  const r = new RNG(Math.floor(x * 7 + z));
  const pile = new THREE.Group();
  const stone = std('rubble', { map: stoneTexture(9, '#9a8f7c'), roughness: 1 });
  for (let i = 0; i < 26; i++) {
    const s = r.range(0.4, 1.4);
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), stone);
    m.position.set(r.range(-wd / 2, wd / 2), r.range(0, 1.2), r.range(-d / 2, d / 2));
    m.rotation.set(r.range(0, 3), r.range(0, 3), 0);
    m.scale.y = 0.6;
    pile.add(m);
  }
  for (const s of [-1, 1]) {
    const h = r.range(1.2, 3.5);
    const wall = new THREE.Mesh(boxUV(r.range(1.5, wd * 0.5), h, 0.5), wallMat);
    wall.position.set(s * wd * 0.25, h / 2, -d / 2 + 0.25);
    pile.add(wall);
  }
  g.add(pile);
  shadow(g);
  const rb = new Obstacle({ kind: 'rubble', cx: x, cz: z, hx: wd / 2, hz: d / 2, y0: gy, y1: gy + 1.4, blocksTanks: false, blocksFoot: false, blocksLOS: false, stopsBullets: true, shellMm: 30, hp: 0, solidity: 0.6, label: 'rubble' });
  w.addObstacle(rb);
  w.effects.explosion(new THREE.Vector3(x, gy + 2, z), 1.5, true, gy, false);
}

/* ====================================================================== walls, hedges, trees */

export function addStoneWall(w: World, x0: number, x1: number, z: number, h: number, seed: number) {
  const len = Math.abs(x1 - x0);
  const cx = (x0 + x1) / 2;
  const gy = Math.min(w.terrain.height(x0, z), w.terrain.height(x1, z), w.terrain.height(cx, z)) - 0.15;
  const m = std('drystone', { map: stoneTexture(4, '#9c927e'), roughness: 1 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(boxUV(len, h, 0.55, 2.5), m);
  body.position.y = h / 2;
  const cap = new THREE.Mesh(boxUV(len, 0.18, 0.65, 2.5), m);
  cap.position.y = h + 0.05;
  g.add(body, cap);
  g.position.set(cx, gy, z);
  shadow(g);
  w.root.add(g);
  const o = new Obstacle({ kind: 'wall', cx, cz: z, hx: len / 2, hz: 0.3, y0: gy, y1: gy + h + 0.12, blocksTanks: true, blocksFoot: true, blocksLOS: h > 1.6, stopsBullets: true, shellMm: 35, hp: 900 * len / 6, label: 'stone wall' });
  o.object = g;
  o.onDamage = (_o, frac) => {
    body.scale.y = 0.45 + frac * 0.55;
    body.position.y = (h * body.scale.y) / 2;
    cap.position.y = h * body.scale.y + 0.05;
    o.y1 = gy + h * body.scale.y;
  };
  o.onDestroyed = () => {
    body.scale.y = 0.25; body.position.y = h * 0.125; cap.visible = false;
    w.addObstacle(new Obstacle({ kind: 'rubble', cx, cz: z, hx: len / 2, hz: 0.6, y0: gy, y1: gy + 0.5, blocksTanks: false, blocksFoot: false, blocksLOS: false, stopsBullets: true, shellMm: 15, hp: 0, label: 'broken wall' }));
  };
  void seed;
  return w.addObstacle(o);
}

/**
 * Normandy bocage: an earth bank topped by a dense hedge, built in ≈8 m sections so a tank with
 * a hedgerow cutter breaches only the section it drives into. Axis-aligned from (ax,az) to (bx,bz).
 */
export function addHedgerow(w: World, ax: number, az: number, bx: number, bz: number, seed: number) {
  const r = new RNG(seed);
  const alongX = Math.abs(bx - ax) >= Math.abs(bz - az);
  const len = alongX ? Math.abs(bx - ax) : Math.abs(bz - az);
  const n = Math.max(1, Math.round(len / 8));
  const seg = len / n;
  const bankMat = std('bankdirt', { color: 0x5d5038, roughness: 1 });
  const leaf = [foliageTexture(seed % 4 + 10, '#3e5428', 'hedge'), foliageTexture(seed % 4 + 20, '#4b6230', 'hedge')];
  const out: Obstacle[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = i * seg;
    const cx = alongX ? Math.min(ax, bx) + t0 + seg / 2 : ax;
    const cz = alongX ? az : Math.min(az, bz) + t0 + seg / 2;
    const gy = w.terrain.height(cx, cz) - 0.25;
    const g = new THREE.Group();
    const bank = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, seg + 0.1, 10, 1, false, 0, Math.PI), bankMat);
    // half cylinder lying along the hedge line, flat side down
    bank.rotation.set(0, alongX ? 0 : Math.PI / 2, Math.PI / 2);
    bank.rotation.order = 'YXZ';
    bank.rotation.y = alongX ? 0 : Math.PI / 2;
    bank.rotation.z = Math.PI / 2;
    bank.scale.set(1, 1, 0.85);
    g.add(bank);
    const k = Math.ceil(seg / 2.4);
    for (let j = 0; j < k; j++) {
      const tx = leaf[(i + j) % 2];
      const m = std(`hedge${tx.uuid}`, { map: tx, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 });
      const hh = r.range(2.6, 4.2);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(3.0, hh), m);
      const off = -seg / 2 + (seg / k) * (j + 0.5) + r.range(-0.4, 0.4);
      if (alongX) p.position.set(off, 0.85 + hh / 2, r.range(-0.4, 0.4));
      else { p.position.set(r.range(-0.4, 0.4), 0.85 + hh / 2, off); p.rotation.y = Math.PI / 2; }
      p.rotation.y += r.range(-0.25, 0.25);
      g.add(p);
    }
    if (r.chance(0.14)) {
      const tr = tree(r.int(0, 9999), r.chance(0.25) ? 'poplar' : 'round');
      tr.position.set(alongX ? r.range(-seg / 3, seg / 3) : 0, 0.6, alongX ? 0 : r.range(-seg / 3, seg / 3));
      g.add(tr);
    }
    g.position.set(cx, gy, cz);
    shadow(g, true, true);
    mergeByMaterial(g);
    w.root.add(g);
    const hx = alongX ? seg / 2 : 1.15, hz = alongX ? 1.15 : seg / 2;
    const o = new Obstacle({ kind: 'hedge', cx, cz, hx, hz, y0: gy, y1: gy + 4.2, blocksTanks: true, blocksFoot: true, blocksLOS: true, stopsBullets: true, shellMm: 80, hp: 9000, solidity: 1, label: 'bocage hedgerow' });
    o.object = g;
    o.onDestroyed = () => {
      // breached: a churned gap of earth and broken shrubs remains
      g.clear();
      const heap = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, seg * 0.9, 8, 1, false, 0, Math.PI), bankMat);
      heap.rotation.order = 'YXZ';
      heap.rotation.y = alongX ? 0 : Math.PI / 2;
      heap.rotation.z = Math.PI / 2;
      heap.scale.set(0.35, 1, 0.35);
      g.add(heap);
      w.effects.explosion(new THREE.Vector3(cx, gy + 1, cz), 0.1, true, gy, true);
    };
    out.push(w.addObstacle(o));
  }
  return out;
}

export function tree(seed: number, kind: 'round' | 'poplar' = 'round') {
  const r = new RNG(seed);
  const g = new THREE.Group();
  const barkMat = std('bark', { map: barkTexture(), roughness: 1 });
  const H = kind === 'poplar' ? r.range(14, 20) : r.range(7, 11);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, kind === 'poplar' ? 0.32 : 0.38, H * 0.6, 8), barkMat);
  trunk.position.y = H * 0.3;
  g.add(trunk);
  const tex = foliageTexture(seed % 5 + (kind === 'poplar' ? 40 : 30), r.pick(['#4b6230', '#556b2f', '#465c2a', '#5a6a32']), kind === 'poplar' ? 'poplar' : 'round');
  const m = std(`leaf${tex.uuid}`, { map: tex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 });
  if (kind === 'poplar') {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(H * 0.32, H * 0.86), m);
    p.position.y = H * 0.55;
    g.add(p);
    const p2 = p.clone();
    p2.rotation.y = Math.PI / 2.4;
    p2.position.x += 0.2;
    g.add(p2);
  } else {
    for (let i = 0; i < 4; i++) {
      const s = H * r.range(0.45, 0.7);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(s, s * 0.9), m);
      p.position.set(r.range(-1.2, 1.2), H * r.range(0.62, 0.85), r.range(-0.8, 0.8));
      p.rotation.y = r.range(-0.6, 0.6);
      g.add(p);
    }
  }
  shadow(g);
  return g;
}

export function addTree(w: World, x: number, z: number, seed: number, kind: 'round' | 'poplar' = 'round') {
  const g = tree(seed, kind);
  const gy = w.terrain.height(x, z);
  g.position.set(x, gy - 0.1, z);
  w.root.add(g);
  const o = new Obstacle({ kind: 'tree', cx: x, cz: z, hx: 0.35, hz: 0.35, y0: gy, y1: gy + 12, blocksTanks: true, blocksFoot: true, blocksLOS: true, stopsBullets: true, shellMm: 20, hp: 600, solidity: 0.35, label: 'tree' });
  o.object = g;
  o.onDestroyed = () => { g.rotation.z = (Math.random() < 0.5 ? -1 : 1) * 1.4; g.position.y += 0.3; };
  return w.addObstacle(o);
}

/* ====================================================================== field fortifications */

export function addSandbags(w: World, x: number, z: number, len: number, rows = 3, alongX = true, seed = 1) {
  const r = new RNG(seed);
  const tex = sandbagTexture();
  const m = std('sandbag', { map: tex, roughness: 1 });
  const geo = new THREE.SphereGeometry(0.5, 10, 6);
  geo.scale(0.62, 0.22, 0.34);
  const perRow = Math.ceil(len / 0.62);
  const inst = new THREE.InstancedMesh(geo, m, perRow * rows);
  const mm = new THREE.Matrix4();
  let k = 0;
  for (let row = 0; row < rows; row++) {
    for (let i = 0; i < perRow; i++) {
      const off = -len / 2 + (i + (row % 2) * 0.5) * 0.62;
      if (off > len / 2) continue;
      const p = alongX ? new THREE.Vector3(off, 0.11 + row * 0.2, r.range(-0.04, 0.04)) : new THREE.Vector3(r.range(-0.04, 0.04), 0.11 + row * 0.2, off);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r.range(-0.08, 0.08), (alongX ? 0 : Math.PI / 2) + r.range(-0.1, 0.1), r.range(-0.06, 0.06)));
      inst.setMatrixAt(k++, mm.compose(p, q, new THREE.Vector3(1, 1, 1)));
    }
  }
  inst.count = k;
  const gy = w.terrain.height(x, z);
  inst.position.set(x, gy, z);
  shadow(inst);
  w.root.add(inst);
  const h = rows * 0.2 + 0.1;
  const o = new Obstacle({ kind: 'sandbags', cx: x, cz: z, hx: alongX ? len / 2 : 0.35, hz: alongX ? 0.35 : len / 2, y0: gy, y1: gy + h, blocksTanks: false, blocksFoot: true, blocksLOS: false, stopsBullets: true, shellMm: 25, hp: 500, crushable: true, label: 'sandbags' });
  o.object = inst;
  o.onDestroyed = () => { inst.scale.y = 0.3; };
  return w.addObstacle(o);
}

/** Czech hedgehog anti-tank obstacle (three crossed steel I-beams) */
export function addHedgehog(w: World, x: number, z: number, seed: number) {
  const r = new RNG(seed);
  const g = new THREE.Group();
  const m = std('rustbeam', { color: 0x4a3a2c, roughness: 0.75, metalness: 0.5 });
  for (let i = 0; i < 3; i++) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.0, 0.1), m);
    const e = [new THREE.Euler(0.95, 0, 0), new THREE.Euler(0, 0, 0.95), new THREE.Euler(-0.6, 0.8, -0.6)][i];
    beam.rotation.copy(e);
    g.add(beam);
  }
  const gy = w.terrain.height(x, z);
  g.position.set(x, gy + 0.62, z);
  g.rotation.y = r.range(0, 3);
  shadow(g);
  w.root.add(g);
  const o = new Obstacle({ kind: 'hedgehog', cx: x, cz: z, hx: 0.85, hz: 0.85, y0: gy, y1: gy + 1.4, blocksTanks: true, blocksFoot: false, blocksLOS: false, stopsBullets: false, shellMm: 15, hp: 2500, solidity: 0.25, label: 'Czech hedgehog' });
  o.object = g;
  return w.addObstacle(o);
}

export function addFence(w: World, x0: number, x1: number, z: number, seed: number) {
  const r = new RNG(seed);
  const len = Math.abs(x1 - x0);
  const cx = (x0 + x1) / 2;
  const g = new THREE.Group();
  const m = std('fencewood', { map: woodTexture(5, '#6a5a44'), roughness: 1 });
  for (let x = -len / 2; x <= len / 2; x += 2.2) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.15, 0.1), m);
    p.position.set(x, 0.55, 0);
    p.rotation.z = r.range(-0.1, 0.1);
    g.add(p);
  }
  for (const y of [0.45, 0.9]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.04), m);
    rail.position.set(0, y, 0.06);
    rail.rotation.z = r.range(-0.02, 0.02);
    g.add(rail);
  }
  const gy = w.terrain.height(cx, z);
  g.position.set(cx, gy, z);
  shadow(g);
  w.root.add(g);
  const o = new Obstacle({ kind: 'fence', cx, cz: z, hx: len / 2, hz: 0.1, y0: gy, y1: gy + 1.1, blocksTanks: false, blocksFoot: false, blocksLOS: false, stopsBullets: false, shellMm: 2, hp: 80, crushable: true, solidity: 0.2, label: 'fence' });
  o.object = g;
  o.onDestroyed = () => { g.rotation.x = -1.4; g.position.y += 0.1; };
  return w.addObstacle(o);
}

export function addWire(w: World, x0: number, x1: number, z: number) {
  const len = Math.abs(x1 - x0);
  const cx = (x0 + x1) / 2;
  const g = new THREE.Group();
  const m = std('wirepost', { color: 0x4a4038, roughness: 1 });
  const pts: THREE.Vector3[] = [];
  for (let x = -len / 2; x <= len / 2; x += 2.5) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.2, 5), m);
    p.position.set(x, 0.55, 0);
    p.rotation.z = (Math.random() - 0.5) * 0.3;
    g.add(p);
  }
  for (const y of [0.3, 0.65, 1.0]) for (let x = -len / 2; x <= len / 2; x += 0.3) pts.push(new THREE.Vector3(x, y + Math.sin(x * 9) * 0.05, Math.sin(x * 3) * 0.08));
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x3a3632 }));
  g.add(line);
  const gy = w.terrain.height(cx, z);
  g.position.set(cx, gy, z);
  w.root.add(g);
  const o = new Obstacle({ kind: 'wire', cx, cz: z, hx: len / 2, hz: 0.3, y0: gy, y1: gy + 1.1, blocksTanks: false, blocksFoot: true, blocksLOS: false, stopsBullets: false, shellMm: 0, hp: 60, crushable: true, solidity: 0.05, label: 'barbed wire' });
  o.object = g;
  o.onDestroyed = () => { g.scale.y = 0.15; };
  return w.addObstacle(o);
}

/** burnt-out lorry (Opel Blitz class) — a hard obstacle that gives cover */
export function addWreckTruck(w: World, x: number, z: number, yaw: number, seed: number, smoulder = true) {
  const r = new RNG(seed);
  const g = new THREE.Group();
  const rust = std('rusted', { color: 0x4a3426, roughness: 0.95, metalness: 0.3 });
  const burnt = std('burntmetal', { color: 0x2a2420, roughness: 1, metalness: 0.2 });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 2.1), rust);
  cab.position.set(2.0, 1.55, 0);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 1.4), burnt);
  hood.position.set(3.2, 1.3, 0);
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(6.0, 0.3, 1.2), burnt);
  chassis.position.set(0.3, 0.75, 0);
  const bed = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    if (r.chance(0.35)) continue;
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.12, r.range(0.3, 0.8), 2.2), std('charwood', { map: woodTexture(9, '#2e2218'), roughness: 1 }));
    slat.position.set(-2.2 + i * 0.45, 1.3, 0);
    slat.rotation.z = r.range(-0.2, 0.2);
    bed.add(slat);
  }
  const floor = new THREE.Mesh(new THREE.BoxGeometry(4, 0.12, 2.2), burnt);
  floor.position.set(-0.5, 1.0, 0);
  g.add(cab, hood, chassis, bed, floor);
  for (const [wx, wz] of [[2.8, -1], [2.8, 1], [-1.4, -1], [-1.4, 1], [-2.4, -1], [-2.4, 1]]) {
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.25, 12).rotateX(Math.PI / 2), std('rim', { color: 0x221d18, roughness: 0.8, metalness: 0.4 }));
    wh.position.set(wx, 0.42, wz);
    g.add(wh);
  }
  g.rotation.set(0, yaw, r.range(-0.06, 0.06));
  const gy = w.terrain.height(x, z);
  g.position.set(x, gy, z);
  shadow(g);
  w.root.add(g);
  if (smoulder) w.effects.emitter({ pos: new THREE.Vector3(x, gy + 1.6, z), kind: 'smolder', intensity: 1.2 });
  const o = new Obstacle({ kind: 'wreck', cx: x, cz: z, hx: 3.4, hz: 1.2, yaw, y0: gy, y1: gy + 2.3, blocksTanks: true, blocksFoot: true, blocksLOS: true, stopsBullets: true, shellMm: 10, hp: 4000, solidity: 0.7, label: 'wrecked lorry' });
  o.object = g;
  return w.addObstacle(o);
}

export function addCrates(w: World, x: number, z: number, seed: number) {
  const r = new RNG(seed);
  const g = new THREE.Group();
  const m = std('crate', { map: woodTexture(3, '#7a6244'), roughness: 0.95 });
  const bm = std('barrel', { color: 0x4a4238, roughness: 0.7, metalness: 0.4 });
  const n = r.int(2, 4);
  for (let i = 0; i < n; i++) {
    const s = r.range(0.6, 0.9);
    const c = new THREE.Mesh(boxUV(s, s * 0.8, s, 1), m);
    c.position.set(r.range(-0.8, 0.8), (s * 0.8) / 2 + (i > 1 ? s * 0.8 : 0), r.range(-0.5, 0.5));
    c.rotation.y = r.range(0, 1);
    g.add(c);
  }
  for (let i = 0; i < r.int(1, 3); i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12), bm);
    b.position.set(r.range(-1.2, 1.2), 0.45, r.range(-0.6, 0.6));
    g.add(b);
  }
  const gy = w.terrain.height(x, z);
  g.position.set(x, gy, z);
  shadow(g);
  w.root.add(g);
  const o = new Obstacle({ kind: 'crate', cx: x, cz: z, hx: 1.2, hz: 0.7, y0: gy, y1: gy + 1.2, blocksTanks: false, blocksFoot: true, blocksLOS: false, stopsBullets: true, shellMm: 4, hp: 150, crushable: true, solidity: 0.6, label: 'crates' });
  o.object = g;
  o.onDestroyed = () => { g.scale.y = 0.25; };
  return w.addObstacle(o);
}

/* ====================================================================== roadside dressing (visual only) */

export function addRoadSign(w: World, x: number, z: number, lines: [string, string][]) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6), std('signpost', { color: 0x3a3632, roughness: 0.8 }));
  post.position.y = 1.3;
  g.add(post);
  lines.forEach(([name, dist], i) => {
    const text = `${name}  ${dist}`;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.36), std(`rs${text}`, { map: signTexture(text, '#e8e4d6', '#2d3550', 512, 108), roughness: 0.7, side: THREE.DoubleSide }));
    plate.position.set(0.8, 2.2 - i * 0.45, 0.05);
    g.add(plate);
  });
  g.position.set(x, w.terrain.height(x, z), z);
  shadow(g);
  w.root.add(g);
}

export function addTelegraphPoles(w: World, x0: number, x1: number, z: number) {
  const m = std('pole', { map: barkTexture(), color: 0x6a5a48, roughness: 1 });
  const wireMat = new THREE.LineBasicMaterial({ color: 0x222222 });
  let prev: THREE.Vector3 | null = null;
  for (let x = x0; x <= x1; x += 45) {
    const gy = w.terrain.height(x, z);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 8), m);
    p.position.set(x, gy + 4, z);
    p.castShadow = true;
    w.root.add(p);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.4), m);
    arm.position.set(x, gy + 7.5, z);
    w.root.add(arm);
    const top = new THREE.Vector3(x, gy + 7.6, z);
    if (prev) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const q = prev.clone().lerp(top, t);
        q.y -= Math.sin(t * Math.PI) * 0.9;
        pts.push(q);
      }
      for (const dz of [-0.55, 0.55]) {
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map((q) => q.clone().setZ(q.z + dz))), wireMat);
        w.root.add(l);
      }
    }
    prev = top;
  }
}

export function addLamp(w: World, x: number, z: number) {
  const g = new THREE.Group();
  const m = std('iron', { color: 0x1e1e1e, roughness: 0.6, metalness: 0.5 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 3.6), m);
  post.position.y = 1.8;
  const arm = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.03, 6, 12, Math.PI), m);
  arm.position.set(0.35, 3.6, 0);
  const lamp = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.3, 8), m);
  lamp.position.set(0.7, 3.45, 0);
  const glass = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), std('lampglass', { color: 0xe8d8a8, emissive: 0x403010, roughness: 0.3 }));
  glass.position.set(0.7, 3.3, 0);
  g.add(post, arm, lamp, glass);
  g.position.set(x, w.terrain.height(x, z), z);
  shadow(g);
  w.root.add(g);
}
