import * as THREE from 'three';
import { RNG } from '../core/rng';
import { foliageTexture, plasterTexture, roofTileTexture, stoneTexture } from '../render/Textures';
import { bakeStatic } from '../vehicles/TankBuilder';
import type { World } from './World';

/**
 * Distant scenery seen through the atmospheric haze: tree lines and poplar rows, a village
 * with its church across the river, a multi-arched stone bridge, burning buildings with tall
 * smoke columns. All of it is real geometry so perspective parallax comes for free.
 */
export function buildBackground(w: World, seed: number, x0: number, x1: number, opts: { churchX: number; bridgeX: number; burning: number[] }) {
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
  const rows: [number, number, number, number][] = [[-52, 0.4, 1, 1], [-78, 0.7, 1.1, 1], [-128, 0.95, 0.9, 0.85], [-215, 1, 0.8, 0.8], [-300, 1, 0.8, 0.9]];
  for (const [z, density, spacing, hs] of rows) {
    for (let x = x0 - 500; x < x1 + 500; x += r.range(5, 11) * spacing * (z < -150 ? 1.4 : 1)) {
      if (!r.chance(density)) continue;
      const zz = z + r.range(-5, 5);
      const gy = t.height(x, zz);
      const poplar = r.chance(z < -100 ? 0.18 : 0.3);
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

  w.root.add(group);
  return group;
}
