import * as THREE from 'three';
import type { V3 } from '../ballistics/ArmorMesh';
import type { TankBuilder } from './TankBuilder';

/**
 * Small hard-surface details shared by the vehicle models: bolts, hinges, grab handles,
 * pioneer tools with their clamps, tow cables, aerials, coil springs. Coordinates are in the
 * HULL frame of the drawings (as everywhere in the builder); meshes go into the active frame
 * and are merged per material when the model is finished.
 */

const _up = new THREE.Vector3(0, 1, 0);

function placeAlong(m: THREE.Object3D, a: THREE.Vector3, c: THREE.Vector3) {
  m.position.copy(a).add(c).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(_up, c.clone().sub(a).normalize());
}

/** a cylinder between two hull-frame points */
export function rod(b: TankBuilder, p0: V3, p1: V3, r: number, mat = 'darkSteel', seg = 8) {
  const a = b.V(p0), c = b.V(p1);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(c), seg), b.mats[mat]);
  placeAlong(m, a, c);
  return b.add(m);
}

/** bolt heads (short hex cylinders) at points, standing along `normal` */
export function bolts(b: TankBuilder, pts: V3[], normal: V3, r = 0.014, h = 0.012, mat = 'paintDark') {
  const n = new THREE.Vector3(...normal).normalize();
  const g = new THREE.CylinderGeometry(r, r, h, 6);
  for (const p of pts) {
    const m = new THREE.Mesh(g, b.mats[mat]);
    m.position.copy(b.V(p)).addScaledVector(n, h / 2);
    m.quaternion.setFromUnitVectors(_up, n);
    b.add(m);
  }
}

/** evenly spaced bolt row between two points */
export function boltRow(b: TankBuilder, p0: V3, p1: V3, count: number, normal: V3, r = 0.014) {
  const pts: V3[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    pts.push([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, p0[2] + (p1[2] - p0[2]) * t]);
  }
  bolts(b, pts, normal, r);
}

/** bent grab handle standing off a surface: two legs and a bar */
export function handle(b: TankBuilder, p0: V3, p1: V3, normal: V3, standoff = 0.06, r = 0.009, mat = 'paint') {
  const n: V3 = [normal[0] * standoff, normal[1] * standoff, normal[2] * standoff];
  const q0: V3 = [p0[0] + n[0], p0[1] + n[1], p0[2] + n[2]];
  const q1: V3 = [p1[0] + n[0], p1[1] + n[1], p1[2] + n[2]];
  rod(b, p0, q0, r, mat, 6);
  rod(b, p1, q1, r, mat, 6);
  rod(b, q0, q1, r, mat, 6);
}

/** hinge knuckles along an axis */
export function hinge(b: TankBuilder, p0: V3, p1: V3, r = 0.025, knuckles = 2) {
  for (let i = 0; i < knuckles; i++) {
    const t0 = i / knuckles + 0.05, t1 = (i + 1) / knuckles - 0.05;
    const a: V3 = [p0[0] + (p1[0] - p0[0]) * t0, p0[1] + (p1[1] - p0[1]) * t0, p0[2] + (p1[2] - p0[2]) * t0];
    const c: V3 = [p0[0] + (p1[0] - p0[0]) * t1, p0[1] + (p1[1] - p0[1]) * t1, p0[2] + (p1[2] - p0[2]) * t1];
    rod(b, a, c, r, 'paintDark', 10);
  }
}

/** tube along a smooth curve (tow cables, wiring) */
export function cable(b: TankBuilder, pts: V3[], r = 0.012, mat = 'darkSteel') {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => b.V(p)));
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, pts.length * 10), r, 6, false), b.mats[mat]);
  return b.add(m);
}

/** whip aerial on a sprung base */
export function antenna(b: TankBuilder, base: V3, len: number, lean: V3 = [-0.25, 1, 0]) {
  b.cyl(0.035, 0.04, 0.08, [base[0], base[1] + 0.04, base[2]], 'y', 'darkSteel', 10);
  b.cyl(0.018, 0.022, 0.1, [base[0], base[1] + 0.13, base[2]], 'y', 'rubber', 8);
  const d = new THREE.Vector3(...lean).normalize();
  const pts: V3[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = (i / 6) * len;
    const sag = (t / len) ** 2 * len * 0.06;
    pts.push([base[0] + d.x * t - sag * 0.6, base[1] + 0.18 + d.y * t - sag, base[2] + d.z * t]);
  }
  cable(b, pts, 0.004, 'darkSteel');
}

/** helical coil spring (VVSS volute springs, shock absorbers) */
export function coil(b: TankBuilder, base: V3, radius: number, height: number, turns: number, wire: number, mat = 'darkSteel') {
  const pts: THREE.Vector3[] = [];
  const n = turns * 12;
  const o = b.V(base);
  for (let i = 0; i <= n; i++) {
    const a = (i / 12) * Math.PI * 2;
    pts.push(new THREE.Vector3(o.x + Math.cos(a) * radius, o.y + (i / n) * height, o.z + Math.sin(a) * radius));
  }
  const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, wire, 5, false), b.mats[mat]);
  return b.add(m);
}

export type ToolKind = 'shovel' | 'axe' | 'pick' | 'crowbar' | 'sledge' | 'jack' | 'extinguisher' | 'cutters' | 'trackTool';

/**
 * Pioneer tool lying on a surface with its clamps, oriented along x (rotY turns it in plan).
 * pos = centre of the tool on the surface (hull frame).
 */
export function tool(b: TankBuilder, kind: ToolKind, pos: V3, rotY = 0, scale = 1) {
  const g = new THREE.Group();
  const P = b.V(pos);
  g.position.copy(P);
  g.rotation.y = rotY;
  const wood = b.mats.wood, steel = b.mats.darkSteel;
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rz = 0, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x * scale, y * scale, z * scale);
    m.rotation.set(0, ry, rz);
    g.add(m);
    return m;
  };
  const clamp = (x: number) => mk(new THREE.BoxGeometry(0.03, 0.05, 0.07), b.mats.paintDark, x, 0.025, 0);
  switch (kind) {
    case 'shovel':
      mk(new THREE.CylinderGeometry(0.018, 0.018, 0.75, 8).rotateZ(Math.PI / 2), wood, -0.12, 0.022, 0);
      mk(new THREE.BoxGeometry(0.28, 0.012, 0.22), steel, 0.38, 0.012, 0);
      mk(new THREE.BoxGeometry(0.06, 0.03, 0.12), wood, -0.52, 0.025, 0);
      clamp(-0.3); clamp(0.15);
      break;
    case 'axe':
      mk(new THREE.CylinderGeometry(0.017, 0.02, 0.8, 8).rotateZ(Math.PI / 2), wood, 0, 0.022, 0);
      mk(new THREE.BoxGeometry(0.06, 0.03, 0.2), steel, 0.38, 0.022, 0.05);
      clamp(-0.25); clamp(0.2);
      break;
    case 'pick':
      mk(new THREE.CylinderGeometry(0.02, 0.022, 0.85, 8).rotateZ(Math.PI / 2), wood, 0, 0.025, 0);
      mk(new THREE.BoxGeometry(0.05, 0.03, 0.55), steel, 0.4, 0.028, 0);
      clamp(-0.25); clamp(0.15);
      break;
    case 'crowbar':
      mk(new THREE.CylinderGeometry(0.014, 0.014, 1.4, 6).rotateZ(Math.PI / 2), steel, 0, 0.016, 0);
      clamp(-0.45); clamp(0.45);
      break;
    case 'sledge':
      mk(new THREE.CylinderGeometry(0.018, 0.02, 0.85, 8).rotateZ(Math.PI / 2), wood, 0, 0.022, 0);
      mk(new THREE.BoxGeometry(0.08, 0.07, 0.15), steel, 0.42, 0.035, 0);
      clamp(-0.2); clamp(0.2);
      break;
    case 'jack':
      mk(new THREE.BoxGeometry(0.42, 0.14, 0.14), steel, 0, 0.07, 0);
      mk(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 10), b.mats.steel, 0.12, 0.17, 0);
      break;
    case 'extinguisher':
      mk(new THREE.CylinderGeometry(0.065, 0.065, 0.55, 14).rotateZ(Math.PI / 2), b.mats.rust, 0, 0.065, 0);
      mk(new THREE.CylinderGeometry(0.025, 0.035, 0.08, 8).rotateZ(Math.PI / 2), steel, 0.31, 0.065, 0);
      clamp(-0.15); clamp(0.15);
      break;
    case 'cutters':
      mk(new THREE.BoxGeometry(0.7, 0.02, 0.04), steel, 0, 0.012, -0.02);
      mk(new THREE.BoxGeometry(0.7, 0.02, 0.04), steel, 0, 0.012, 0.03);
      mk(new THREE.BoxGeometry(0.12, 0.03, 0.09), steel, 0.38, 0.015, 0);
      break;
    case 'trackTool':
      mk(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 8).rotateZ(Math.PI / 2), steel, 0, 0.022, 0);
      mk(new THREE.BoxGeometry(0.06, 0.12, 0.06), steel, 0.45, 0.06, 0);
      clamp(-0.3); clamp(0.25);
      break;
  }
  b.add(g);
  return g;
}

/** box mounted on a surface with latches (stowage boxes, the Sherman's infantry telephone) */
export function stowageBox(b: TankBuilder, size: V3, pos: V3, mat = 'paint') {
  const box = b.box(size, pos, mat);
  b.box([size[0] * 1.02, 0.015, size[2] * 1.02], [pos[0], pos[1] + size[1] / 2 + 0.008, pos[2]], 'paintDark');
  for (const s of [-1, 1]) b.box([0.02, 0.05, 0.03], [pos[0] + s * size[0] * 0.3, pos[1] + size[1] * 0.3, pos[2] + size[2] / 2 + 0.01], 'darkSteel');
  return box;
}
