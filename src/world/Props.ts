import * as THREE from 'three';
import { RNG } from '../core/rng';
import { barkTexture, plasterTexture, roofTileTexture, sandbagTexture, signTexture, stoneTexture, wallLetteringTexture, woodTexture, craterTexture } from '../render/Textures';
import { Obstacle } from './Obstacle';
import { mergeByMaterial } from '../render/Merge';
import { buildHedge, buildTree } from './Trees';
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
  const trimTint = o.style === 'stone' ? '#c4b9a0' : '#d6ccb4';
  const trimMat = std(`trim${trimTint}`, { map: stoneTexture(5, trimTint), roughness: 0.9 });
  const frameMat = std(`frame${o.seed % 3}`, { color: [0xe0d9c6, 0xd2cab2, 0x56664f][o.seed % 3], roughness: 0.7 });
  const doorMat = std(`door${o.seed % 4}`, { map: woodTexture(o.seed % 4 + 5, ['#4a3a2a', '#3d4c3c', '#5c2e24', '#34404e'][o.seed % 4]), roughness: 0.8 });
  const glassMat = std('glass', { color: 0x10171c, roughness: 0.18, metalness: 0.25, envMapIntensity: 0.55 });
  const zincMat = std('zinc', { color: 0x6a6d6a, roughness: 0.5, metalness: 0.55 });
  const potMat = std('chimpot', { color: 0x98502f, roughness: 0.85 });
  const ridgeMat = std(`ridge${o.roofTint ?? ''}`, { color: new THREE.Color(o.roofTint ?? '#8a4a32').multiplyScalar(0.7), roughness: 0.85 });
  const box = (parent: THREE.Object3D, m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, tile = 2) => {
    const b = new THREE.Mesh(boxUV(sx, sy, sz, tile), m);
    b.position.set(x, y, z);
    parent.add(b);
    return b;
  };
  const walls = new THREE.Group();
  const front = new THREE.Mesh(wallQuad(o.w, H), wallMat); front.position.set(0, H / 2, hd);
  const back = new THREE.Mesh(wallQuad(o.w, H), wallMat); back.position.set(0, H / 2, -hd); back.rotation.y = Math.PI;
  const left = new THREE.Mesh(wallQuad(o.d, H), wallMat); left.position.set(-hw, H / 2, 0); left.rotation.y = -Math.PI / 2;
  const right = new THREE.Mesh(wallQuad(o.d, H), wallMat); right.position.set(hw, H / 2, 0); right.rotation.y = Math.PI / 2;
  walls.add(front, back, left, right);
  // stone plinth / foundation
  box(walls, std('plinth', { map: stoneTexture(7, '#8f8574'), roughness: 1 }), o.w + 0.12, 0.7, o.d + 0.12, 0, 0.35, 0, 4);
  // dressed corner stones (quoins), alternating long and short so they bond into both faces
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    let k = 0;
    for (let y = 0.86; y < H - 0.3; y += 0.34, k++) {
      const a = k % 2 ? 0.32 : 0.56, b = k % 2 ? 0.56 : 0.32;
      box(walls, trimMat, a, 0.3, b, sx * (hw - a / 2 + 0.04), y, sz * (hd - b / 2 + 0.04));
    }
  }
  // string course between the floors and a moulded cornice under the eaves
  if (o.floors === 2) box(walls, trimMat, o.w + 0.1, 0.14, o.d + 0.1, 0, 3.07, 0);
  box(walls, trimMat, o.w + 0.22, 0.16, o.d + 0.22, 0, H - 0.2, 0);
  box(walls, trimMat, o.w + 0.34, 0.1, o.d + 0.34, 0, H - 0.07, 0);

  // ---- windows: stone surround, glazed casement with glazing bars, louvred shutters
  const openings = new THREE.Group();
  const shop = !!o.sign && !o.flag;
  const nWin = Math.max(1, Math.floor(o.w / 3.2));
  const addWindow = (x: number, y: number, face: number, ww: number, wh: number, shutters: boolean) => {
    const z0 = face * hd;
    box(openings, trimMat, ww + 0.4, 0.2, 0.12, x, y + wh / 2 + 0.1, z0 + face * 0.05);
    for (const sd of [-1, 1]) box(openings, trimMat, 0.14, wh, 0.09, x + sd * (ww / 2 + 0.07), y, z0 + face * 0.04);
    box(openings, trimMat, ww + 0.34, 0.09, 0.24, x, y - wh / 2 - 0.045, z0 + face * 0.11);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), r.chance(0.18) ? darkMat : glassMat);
    glass.position.set(x, y, z0 + face * 0.006);
    if (face < 0) glass.rotation.y = Math.PI;
    openings.add(glass);
    // casement frame: outer bars, the meeting stile and two glazing bars per leaf
    const fz = z0 + face * 0.03;
    box(openings, frameMat, ww, 0.06, 0.04, x, y + wh / 2 - 0.03, fz);
    box(openings, frameMat, ww, 0.06, 0.04, x, y - wh / 2 + 0.03, fz);
    for (const fx of [-ww / 2 + 0.03, 0, ww / 2 - 0.03]) box(openings, frameMat, fx === 0 ? 0.07 : 0.06, wh, 0.04, x + fx, y, fz);
    for (const fy of [-wh / 6, wh / 6]) box(openings, frameMat, ww, 0.035, 0.03, x, y + fy, fz);
    if (!shutters) return;
    for (const sd of [-1, 1]) {
      if (r.chance(0.15)) continue;
      const piv = new THREE.Group();
      piv.position.set(x + (sd * (ww + 0.28)) / 2, y, z0 + face * 0.06);
      const sh = new THREE.Mesh(boxUV(ww / 2, wh, 0.04, 1), shutterMat);
      sh.position.x = (sd * ww) / 4;
      piv.add(sh);
      // louvre slats
      for (let ly = -wh / 2 + 0.12; ly < wh / 2 - 0.08; ly += 0.11) {
        const sl = new THREE.Mesh(new THREE.BoxGeometry(ww / 2 - 0.08, 0.025, 0.05), shutterMat);
        sl.position.set((sd * ww) / 4, ly, face * 0.03);
        sl.rotation.x = 0.5 * face;
        piv.add(sl);
      }
      piv.rotation.y = sd * face * (r.chance(0.3) ? 0.05 : r.range(1.2, 1.55));
      openings.add(piv);
    }
  };
  const addDoor = (x: number, face: number, glazed: boolean) => {
    const z0 = face * hd, ww = 1.1, wh = 2.2, y = 0.35 + wh / 2;
    // surround with a keystone, transom light, panelled leaf
    box(openings, trimMat, ww + 0.5, 0.24, 0.14, x, y + wh / 2 + 0.12, z0 + face * 0.06);
    box(openings, trimMat, 0.26, 0.34, 0.18, x, y + wh / 2 + 0.16, z0 + face * 0.08);
    for (const sd of [-1, 1]) box(openings, trimMat, 0.18, wh, 0.1, x + sd * (ww / 2 + 0.09), y, z0 + face * 0.05);
    const tr = new THREE.Mesh(new THREE.PlaneGeometry(ww, 0.4), glassMat);
    tr.position.set(x, y + wh / 2 - 0.2, z0 + face * 0.006);
    if (face < 0) tr.rotation.y = Math.PI;
    openings.add(tr);
    box(openings, frameMat, ww, 0.06, 0.05, x, y + wh / 2 - 0.42, z0 + face * 0.03);
    const leafH = wh - 0.45;
    box(openings, doorMat, ww, leafH, 0.06, x, 0.35 + leafH / 2, z0);
    if (glazed) {
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(ww * 0.7, leafH * 0.55), glassMat);
      gl.position.set(x, 0.35 + leafH * 0.65, z0 + face * 0.035);
      if (face < 0) gl.rotation.y = Math.PI;
      openings.add(gl);
    } else {
      for (const px of [-0.24, 0.24]) for (const py of [0.3, 0.72]) box(openings, doorMat, 0.36, leafH * 0.32, 0.04, x + px, 0.35 + leafH * py, z0 + face * 0.04);
    }
    box(openings, std('brass', { color: 0xb08d4a, metalness: 0.8, roughness: 0.35 }), 0.05, 0.05, 0.06, x + 0.38, 0.35 + leafH * 0.5, z0 + face * 0.07);
    // two stone steps
    box(openings, trimMat, ww + 0.8, 0.18, 0.62, x, 0.09, z0 + face * 0.31);
    box(openings, trimMat, ww + 0.5, 0.18, 0.36, x, 0.27, z0 + face * 0.18);
  };
  const doorI = Math.floor(nWin / 2);
  for (const face of [1, -1]) {
    for (let f = 0; f < o.floors; f++) {
      if (face === 1 && f === 0 && shop) continue;
      for (let i = 0; i < nWin; i++) {
        const x = -hw + (o.w / nWin) * (i + 0.5);
        if (face === 1 && f === 0 && i === doorI) { addDoor(x, face, false); continue; }
        addWindow(x, f * 3 + 1.75, face, 0.9, 1.35, face === 1 || r.chance(0.5));
      }
    }
  }
  // ---- shop front (cafe, boulangerie...): fascia for the sign, pilasters, big panes, stall riser, awning
  if (shop) {
    const sw = o.w - 1.2, z0 = hd;
    box(openings, doorMat, sw + 0.3, 0.6, 0.16, 0, 2.95, z0 + 0.08);
    box(openings, trimMat, sw + 0.45, 0.1, 0.26, 0, 3.28, z0 + 0.12);
    const bays = Math.max(2, Math.round(sw / 2.4));
    const bw = sw / bays;
    for (let i = 0; i <= bays; i++) box(openings, doorMat, 0.26, 2.6, 0.14, -sw / 2 + i * bw, 1.35, z0 + 0.07);
    for (let i = 0; i < bays; i++) {
      const cx = -sw / 2 + bw * (i + 0.5);
      if (i === Math.floor(bays / 2)) { addDoor(cx, 1, true); continue; }
      box(openings, doorMat, bw - 0.26, 0.7, 0.1, cx, 0.7, z0 + 0.05);
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(bw - 0.26, 1.75), glassMat);
      gl.position.set(cx, 1.95, z0 + 0.012);
      openings.add(gl);
      box(openings, doorMat, 0.05, 1.75, 0.05, cx, 1.95, z0 + 0.04);
    }
    const awn = new THREE.Mesh(new THREE.PlaneGeometry(sw, 1.7), std(`awning${o.seed % 3}`, { map: awningTexture(o.seed), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1 }));
    awn.position.set(0, 2.18, z0 + 0.72);
    awn.rotation.x = -1.0;
    openings.add(awn);
    for (const sd of [-1, 1]) box(openings, zincMat, 0.03, 0.03, 1.45, sd * sw * 0.48, 1.85, z0 + 0.72);
  }
  // ---- gutters and downpipes
  for (const s of [-1, 1]) {
    const gut = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, o.w + 0.6, 8), zincMat);
    gut.rotation.z = Math.PI / 2;
    gut.position.set(0, H + 0.02, s * (hd + 0.42));
    walls.add(gut);
    for (const sx of [-1, 1]) {
      const dp = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, H - 0.2, 6), zincMat);
      dp.position.set(sx * (hw - 0.22), H / 2 - 0.05, s * (hd + 0.1));
      walls.add(dp);
    }
  }

  // ---- roof: thick tiled slabs, ridge tiles, barge boards on the gables, chimneys, dormers
  const rh = o.d * 0.5 + 0.5;
  const ov = 0.4, ovx = 0.3;
  const slope = Math.hypot(hd + ov, rh);
  const roof = new THREE.Group();
  let roofFront: THREE.Mesh | null = null;
  for (const s of [-1, 1]) {
    // local +y of the slab runs from the eave up to the ridge; it sits on top of the line
    const p = new THREE.Mesh(boxUV(o.w + ovx * 2, slope, 0.14, 3), roofMat);
    const a = -s * Math.atan2(hd + ov, rh);
    p.rotation.x = a;
    p.position.set(0, H + rh / 2, (s * (hd + ov)) / 2);
    p.position.add(new THREE.Vector3(0, 0, 0.07).applyEuler(p.rotation));
    roof.add(p);
    if (s === 1) roofFront = p;
    for (const sx of [-1, 1]) {
      const bb = new THREE.Mesh(boxUV(0.06, slope + 0.1, 0.26, 1), woodMat);
      bb.rotation.x = a;
      bb.position.set(sx * (hw + ovx + 0.02), H + rh / 2, (s * (hd + ov)) / 2);
      roof.add(bb);
    }
  }
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, o.w + ovx * 2 + 0.1, 8), ridgeMat);
  ridge.rotation.z = Math.PI / 2;
  ridge.position.set(0, H + rh + 0.1, 0);
  roof.add(ridge);
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
  // chimney stacks on the gable ends: corbelled cap and clay pots
  const stacks = r.chance(0.55) ? [-1, 1] : [r.chance(0.5) ? -1 : 1];
  for (const sx of stacks) {
    const cx = sx * (hw - 0.45);
    box(roof, wallMat, 0.75, 2.4, 1.0, cx, H + rh + 0.2, 0);
    box(roof, trimMat, 0.92, 0.14, 1.16, cx, H + rh + 1.45, 0);
    for (const pz of r.chance(0.5) ? [-0.22, 0.22] : [0]) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.5, 8), potMat);
      pot.position.set(cx, H + rh + 1.77, pz);
      roof.add(pot);
    }
  }
  // dormers on the street side of two-storey houses
  const dormers = new THREE.Group();
  if (o.floors === 2 && o.w >= 10 && r.chance(0.7)) {
    const xs = o.w >= 13 ? [-hw * 0.42, hw * 0.42] : [r.pick([-1, 1]) * hw * 0.3];
    const zf = (hd + ov) * 0.48;
    const baseY = H + rh * (1 - zf / (hd + ov));
    for (const x of xs) {
      const dw = 1.5, dh = 1.55, dd = 2.4;
      box(dormers, wallMat, dw, dh, dd, x, baseY + dh / 2 - 0.35, zf - dd / 2);
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.9), glassMat);
      gl.position.set(x, baseY + 0.55, zf + 0.008);
      dormers.add(gl);
      box(dormers, frameMat, 0.85, 0.07, 0.05, x, baseY + 1.0, zf + 0.03);
      box(dormers, frameMat, 0.85, 0.07, 0.05, x, baseY + 0.1, zf + 0.03);
      for (const fx of [-0.4, 0, 0.4]) box(dormers, frameMat, 0.06, 0.95, 0.05, x + fx, baseY + 0.55, zf + 0.03);
      // small pitched roof
      for (const s of [-1, 1]) {
        const dr = new THREE.Mesh(boxUV(1.15, 0.1, dd + 0.3, 3), roofMat);
        dr.rotation.z = -s * 0.7;
        dr.position.set(x + s * 0.42, baseY + dh - 0.12, zf - dd / 2 + 0.15);
        dormers.add(dr);
      }
    }
  }
  roof.add(dormers);
  dormers.userData.keep = true;
  roofFront!.userData.keep = true;
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
  g.add(walls, roof, rafters, openings);
  if (o.sign) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(o.w * 0.7, o.sign.length * 0.42 + 0.6), 0.55), std(`sign${o.sign}`, { map: signTexture(o.sign, '#e2d8bc', '#2a2a3a'), roughness: 0.8 }));
    s.position.set(0, shop ? 2.95 : 3.3, hd + (shop ? 0.17 : 0.05));
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
  for (const part of [walls, openings, roof]) mergeByMaterial(part);
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
    if (frac < 0.55 && roofFront!.visible) {
      roofFront!.visible = false;
      dormers.visible = false;
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
    if (o.damage > 0.4) { roofFront!.visible = false; dormers.visible = false; rafters.visible = true; }
  }
  w.addObstacle(ob);
  return ob;
}

/** striped canvas awning with a scalloped valance */
function awningTexture(seed: number) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const x = c.getContext('2d')!;
  const [a, b] = [['#9a2a24', '#e6dcc4'], ['#2f5a3a', '#e2d8bc'], ['#2b4766', '#ded4b8']][seed % 3];
  const n = 12;
  for (let i = 0; i < n; i++) {
    x.fillStyle = i % 2 ? b : a;
    x.fillRect((i * 256) / n, 0, 256 / n + 1, 104);
    // scallop below each stripe
    x.beginPath();
    x.arc(((i + 0.5) * 256) / n, 104, 256 / n / 2, 0, Math.PI);
    x.fill();
  }
  // weathering: darker toward the top
  const gr = x.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, 'rgba(0,0,0,0.25)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  x.globalCompositeOperation = 'source-atop';
  x.fillStyle = gr;
  x.fillRect(0, 0, 256, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
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
    const hedge = buildHedge(seed * 131 + i, seg, 0.75);
    if (!alongX) hedge.rotation.y = Math.PI / 2;
    g.add(hedge);
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
  return buildTree(seed, kind);
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
