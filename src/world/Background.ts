import * as THREE from 'three';
import { RNG } from '../core/rng';
import { foliageTexture, plasterTexture, roofTileTexture, stoneTexture } from '../render/Textures';
import { bakeStatic } from '../vehicles/TankBuilder';
import { mergeChunked } from '../render/Merge';
import type { World } from './World';

/**
 * Distant scenery seen through the atmospheric haze: tree lines and poplar rows, a village
 * with its church across the river, a multi-arched stone bridge, burning buildings with tall
 * smoke columns. All of it is real geometry so perspective parallax comes for free.
 */
export function buildBackground(w: World, seed: number, x0: number, x1: number, opts: { churchX: number; bridgeX: number; burning: number[]; ruins?: number[]; windmills?: number[] }) {
  const r = new RNG(seed);
  const t = w.terrain;
  const group = new THREE.Group();
  group.name = 'background';

  // ---- tree lines (three depth rows)
  const leafTex = [foliageTexture(61, '#4a5f2e', 'round'), foliageTexture(62, '#566a34', 'round'), foliageTexture(63, '#42552a', 'round')];
  const poplarTex = [foliageTexture(71, '#4f6432', 'poplar'), foliageTexture(72, '#45592b', 'poplar')];
  const leafMat = leafTex.map((tx) => new THREE.MeshStandardMaterial({ map: tx, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 }));
  const popMat = poplarTex.map((tx) => new THREE.MeshStandardMaterial({ map: tx, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 }));
  // [z, density, spacing scale, height scale]: near rows are individual trees, far rows dense tree lines
  const rows: [number, number, number, number][] = [[-56, 0.22, 1.4, 0.85], [-84, 0.4, 1.2, 0.8], [-128, 0.75, 0.9, 0.7], [-215, 0.9, 0.8, 0.6], [-320, 1, 0.8, 0.65]];
  for (const [z, density, spacing, hs] of rows) {
    for (let x = x0 - 500; x < x1 + 500; x += r.range(5, 11) * spacing * (z < -150 ? 1.4 : 1)) {
      if (!r.chance(density)) continue;
      const zz = z + r.range(-5, 5);
      const gy = t.height(x, zz);
      const poplar = r.chance(z < -100 ? 0.12 : 0.2);
      const h = (poplar ? r.range(15, 21) : r.range(8, 12)) * hs;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(poplar ? h * 0.3 : h * 1.15, h), poplar ? popMat[r.int(0, 1)] : leafMat[r.int(0, 2)]);
      m.position.set(x, gy + h * 0.45, zz);
      m.rotation.y = r.range(-0.3, 0.3);
      m.castShadow = z > -60;
      group.add(m);
    }
  }

  // ---- far village across the river with its church
  const vg = new THREE.Group();
  const wallTex = [plasterTexture(5, '#c9b99a'), stoneTexture(6, '#a69a84'), plasterTexture(8, '#bfb294')];
  const wallMats = wallTex.map((tx) => new THREE.MeshStandardMaterial({ map: tx, roughness: 1 }));
  const roofMats = [roofTileTexture(3, '#7d4630'), roofTileTexture(4, '#5a4a44')].map((tx) => new THREE.MeshStandardMaterial({ map: tx, roughness: 1 }));
  const vz = w.terrain.def.farRiverZ - 40;
  const cx = opts.churchX;
  for (let i = 0; i < 46; i++) {
    const x = cx + r.normal(0, 70);
    const z = vz - r.range(0, 60);
    const wd = r.range(7, 13), d = r.range(6, 9), h = r.range(5, 9);
    const gy = t.height(x, z) - 0.5;
    const body = new THREE.Mesh(new THREE.BoxGeometry(wd, h, d), wallMats[r.int(0, 2)]);
    body.position.set(x, gy + h / 2, z);
    vg.add(body);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, d * 0.72, wd + 0.6, 4, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 4), roofMats[r.int(0, 1)]);
    roof.scale.set(1, 0.65, 1);
    roof.position.set(x, gy + h + d * 0.2, z);
    vg.add(roof);
  }
  // church: nave, tower, steeple
  const cgy = t.height(cx, vz - 30) - 0.5;
  const stone = new THREE.MeshStandardMaterial({ map: stoneTexture(11, '#b0a48c'), roughness: 1 });
  const nave = new THREE.Mesh(new THREE.BoxGeometry(30, 14, 11), stone);
  nave.position.set(cx + 12, cgy + 7, vz - 30);
  const naveRoof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 8, 31, 4, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 4), roofMats[1]);
  naveRoof.scale.set(1, 0.8, 1);
  naveRoof.position.set(cx + 12, cgy + 16, vz - 30);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(8, 30, 8), stone);
  tower.position.set(cx - 7, cgy + 15, vz - 30);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(5.4, 22, 4).rotateY(Math.PI / 4), new THREE.MeshStandardMaterial({ color: 0x4e5156, roughness: 0.8 }));
  spire.position.set(cx - 7, cgy + 41, vz - 30);
  const cross = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3, 0.4), new THREE.MeshStandardMaterial({ color: 0x333333 }));
  cross.position.set(cx - 7, cgy + 53, vz - 30);
  vg.add(nave, naveRoof, tower, spire, cross);
  bakeStatic(vg);
  group.add(vg);

  // ---- stone bridge with arches over the far river
  const bx = opts.bridgeX;
  const bz = w.terrain.def.farRiverZ;
  const bridge = new THREE.Group();
  const bstone = new THREE.MeshStandardMaterial({ map: stoneTexture(12, '#9d9482'), roughness: 1 });
  const span = 7;
  const n = 9;
  const deckY = 5.5;
  const shape = new THREE.Shape();
  const L = span * n;
  shape.moveTo(-L / 2, -2);
  shape.lineTo(-L / 2, deckY);
  shape.lineTo(L / 2, deckY);
  shape.lineTo(L / 2, -2);
  for (let i = n - 1; i >= 0; i--) {
    const a = -L / 2 + i * span;
    shape.lineTo(a + span - 0.8, -2);
    shape.lineTo(a + span - 0.8, 1.2);
    shape.absarc(a + span / 2, 1.2, span / 2 - 0.8, 0, Math.PI, false);
    shape.lineTo(a + 0.8, -2);
  }
  const bgeo = new THREE.ExtrudeGeometry(shape, { depth: 7, bevelEnabled: false });
  bgeo.translate(0, 0, -3.5);
  const uv = bgeo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 4, uv.getY(i) / 4);
  const bmesh = new THREE.Mesh(bgeo, bstone);
  bmesh.position.set(bx, -1.2, bz);
  bmesh.rotation.y = 0.12;
  bridge.add(bmesh);
  const parapet = new THREE.Mesh(new THREE.BoxGeometry(L, 1, 0.5), bstone);
  parapet.position.set(bx, deckY - 0.7, bz + 3.4);
  parapet.rotation.y = 0.12;
  bridge.add(parapet);
  group.add(bridge);

  // ---- smoke columns from burning buildings beyond the village
  for (const x of opts.burning) {
    const z = vz - r.range(10, 80);
    w.effects.emitter({ pos: new THREE.Vector3(x, t.height(x, z) + 4, z), kind: 'column', intensity: r.range(1.0, 1.6) });
  }

  // ---- burning ruins just behind the fields: roofless stone shells, fire in the windows
  for (const x of opts.ruins ?? []) burningRuin(w, group, x, r.range(-34, -26), r.int(1, 9999));

  // ---- windmills on the far ridge
  for (const x of opts.windmills ?? []) windmill(w, group, x, r.range(-330, -290), r.int(1, 9999));

  mergeChunked(group, 120);
  w.root.add(group);
  return group;
}

/** a gutted Norman farmhouse: jagged stone walls with window openings, charred beams, fire inside */
function burningRuin(w: World, parent: THREE.Group, x: number, z: number, seed: number) {
  const r = new RNG(seed);
  const t = w.terrain;
  const W = r.range(9, 13), D = r.range(6.5, 8), H = r.range(6, 7.5);
  const gy = t.height(x, z) - 0.3;
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ map: stoneTexture(20 + (seed % 5), '#a89c86'), roughness: 1 });
  const soot = new THREE.MeshStandardMaterial({ color: 0x1c1814, roughness: 1 });
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff7a2a).multiplyScalar(3.2), toneMapped: true, fog: false });
  // one wall: an extruded outline with a broken top and window holes
  const wall = (len: number, broken: number) => {
    const sh = new THREE.Shape();
    sh.moveTo(-len / 2, 0);
    sh.lineTo(len / 2, 0);
    const steps = 9;
    for (let i = steps; i >= 0; i--) {
      const u = i / steps;
      const ruin = Math.max(0, Math.sin(u * Math.PI * r.range(0.8, 1.6) + r.range(0, 3))) * broken;
      sh.lineTo(-len / 2 + u * len, H * (1 - ruin * 0.55) + r.range(-0.4, 0.3));
    }
    const holes = Math.floor(len / 3.2);
    for (let i = 0; i < holes; i++) {
      const cx = -len / 2 + (i + 0.5) * (len / holes);
      for (const [y0, hh] of [[1.0, 1.4], [H * 0.58, 1.2]] as [number, number][]) {
        if (y0 + hh > H * 0.8 && r.chance(0.5)) continue;
        const hole = new THREE.Path();
        hole.moveTo(cx - 0.5, y0); hole.lineTo(cx + 0.5, y0); hole.lineTo(cx + 0.5, y0 + hh); hole.lineTo(cx - 0.5, y0 + hh); hole.lineTo(cx - 0.5, y0);
        sh.holes.push(hole);
      }
    }
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.55, bevelEnabled: false });
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3, uv.getY(i) / 3);
    return new THREE.Mesh(geo, stone);
  };
  const front = wall(W, r.range(0.3, 0.8));
  front.position.set(0, 0, D / 2 - 0.55);
  const back = wall(W, r.range(0.1, 0.5));
  back.position.set(0, 0, -D / 2);
  const left = wall(D, r.range(0.2, 0.7));
  left.rotation.y = Math.PI / 2;
  left.position.set(-W / 2, 0, 0);
  const right = wall(D, r.range(0.4, 0.9));
  right.rotation.y = Math.PI / 2;
  right.position.set(W / 2 - 0.55, 0, 0);
  g.add(front, back, left, right);
  // fire light seen through the openings: a glowing plane inside each long wall
  for (const zz of [D / 2 - 0.9, -D / 2 + 0.7]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(W - 1.4, H * 0.75), glowMat);
    p.position.set(0, H * 0.38, zz);
    if (zz < 0) p.rotation.y = Math.PI;
    g.add(p);
  }
  // charred roof timbers, some fallen
  for (let i = 0; i < 6; i++) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, D * r.range(0.7, 1.05)), soot);
    const fallen = r.chance(0.45);
    beam.position.set(-W / 2 + 1 + i * ((W - 2) / 5), fallen ? r.range(1.5, 3) : H - 0.3, r.range(-0.4, 0.4));
    beam.rotation.set(fallen ? r.range(-0.7, 0.7) : 0, 0, fallen ? r.range(-0.4, 0.4) : 0);
    g.add(beam);
  }
  g.position.set(x, gy, z);
  g.rotation.y = r.range(-0.12, 0.12);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material !== glowMat) { o.castShadow = true; o.receiveShadow = true; } });
  parent.add(g);
  for (let i = 0; i < 2; i++) {
    w.effects.emitter({ pos: new THREE.Vector3(x + r.range(-W / 3, W / 3), gy + r.range(0.5, 2.5), z + r.range(-1.5, 1.5)), kind: 'fire', intensity: r.range(1.6, 2.4), smoke: 0.12 });
  }
  w.effects.emitter({ pos: new THREE.Vector3(x, gy + H * 0.8, z), kind: 'column', intensity: r.range(0.9, 1.3) });
}

/** Norman tower windmill: stone tower, conical cap, four sails (one broken) */
function windmill(w: World, parent: THREE.Group, x: number, z: number, seed: number) {
  const r = new RNG(seed);
  const gy = w.terrain.height(x, z) - 0.5;
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ map: stoneTexture(30, '#b4a890'), roughness: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3c3630, roughness: 0.95 });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.4, 13, 16), stone);
  tower.position.y = 6.5;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(3.8, 4.2, 16), dark);
  cap.position.y = 15.1;
  g.add(tower, cap);
  const hub = new THREE.Group();
  hub.position.set(0, 13.4, 3.9);
  const broken = r.int(0, 3);
  for (let i = 0; i < 4; i++) {
    const L = i === broken ? 4.5 : 9.5;
    const arm = new THREE.Group();
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.35, L, 0.25), dark);
    stock.position.y = L / 2;
    arm.add(stock);
    if (i !== broken) {
      const lattice = new THREE.Mesh(new THREE.BoxGeometry(1.8, L * 0.78, 0.08), dark);
      lattice.position.set(0.9, L * 0.55, 0);
      arm.add(lattice);
    }
    arm.rotation.z = i * (Math.PI / 2) + r.range(0.2, 0.5);
    hub.add(arm);
  }
  g.add(hub);
  g.position.set(x, gy, z);
  g.rotation.y = r.range(-0.4, 0.4);
  parent.add(g);
}
