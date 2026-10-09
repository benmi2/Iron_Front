import * as THREE from 'three';
import type { V3 } from '../../ballistics/ArmorMesh';
import { RNG } from '../../core/rng';
import { balkenkreuzTexture, numberTexture } from '../../render/Textures';
import { SCHEME_GER_3TONE } from '../TankMaterials';
import { TankBuilder, type TankModel } from '../TankBuilder';
import { antenna, bolts, boltRow, cable, handle, hinge, rod, stowageBox, tool } from '../Details';

/**
 * Panzerkampfwagen IV Ausf. H (late 1943 – 1944).
 *
 * Reference data (see data/vehicles.ts for citations and provenance):
 *   length 5.92 m hull / 7.02 m with gun, width 2.88 m (3.29 m over Schürzen), height 2.68 m,
 *   ground clearance ≈0.40 m, 400 mm Kgs 61/400/120 track (120 mm pitch), 8 twin road wheels per
 *   side (470 mm) on 4 leaf-sprung bogies, 4 return rollers, front sprocket, rear idler.
 *   Armour: nose 80 mm @ ≈14°, glacis 20 mm @ ≈72°, driver's plate 80 mm @ ≈10°,
 *   sides 30 mm, rear 20 mm, roof/floor 10–16 mm; turret front 50 mm @ 11°, mantlet 50 mm,
 *   sides 30 mm @ 25°, rear 30 mm @ 15°; Schürzen 5 mm (hull) / 8 mm (turret).
 *
 * Plate positions are interpreted from published side/front/plan drawings; plate thicknesses
 * and angles follow the cited sources. Values marked 'estimated' in data/vehicles.ts (lower nose)
 * are reasoned estimates pending a better source.
 */

const Y_FLOOR = 0.4;
const Y_FENDER = 1.08;
const Y_ROOF = 1.66;
const Z_LOW = 0.92;
const Z_SUP = 1.18;
const Z_TRACK = 1.24;
const TRACK_W = 0.4;
const X_NOSE_BOT = 2.86;
const Y_NOSE_BOT = 0.64;
const Y_NOSE_TOP = 1.02;
const X_NOSE_TOP = X_NOSE_BOT - (Y_NOSE_TOP - Y_NOSE_BOT) * Math.tan((14 * Math.PI) / 180);
const Y_GLACIS_TOP = 1.2;
const X_GLACIS_TOP = X_NOSE_TOP - (Y_GLACIS_TOP - Y_NOSE_TOP) / Math.tan((18 * Math.PI) / 180);
const Y_DRV_BOT = 1.1;
const X_DRV_BOT = X_GLACIS_TOP + (Y_GLACIS_TOP - Y_DRV_BOT) * Math.tan((10 * Math.PI) / 180);
const X_DRV_TOP = X_DRV_BOT - (Y_ROOF - Y_DRV_BOT) * Math.tan((10 * Math.PI) / 180);
const X_LOWNOSE_BOT = 2.52;
const X_REAR_TOP = -2.7;
const X_REAR_MID = -2.8;
const X_REAR_BOT = -2.7;
const X_FIREWALL = -0.75;
const TURRET_X = 0.15;
const Y_TB = 1.7; // turret base
const Y_TT = 2.38; // turret roof
const GUN_Y = 2.03;
const TRUNNION_X = 0.85;
const X_MANTLET = 1.12;
const BOGIES = [1.53, 0.51, -0.51, -1.53];
const WHEEL_R = 0.235;
const WHEEL_Y = 0.27;

/** Offset each edge of a convex plan polygon inward by d[i] and intersect consecutive edges. */
function inset(poly: [number, number][], d: number[]): [number, number][] {
  const n = poly.length;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const len = Math.hypot(ex, ez);
    // inward normal for a counter-clockwise polygon (x right, z down in plan → use left normal)
    const nx = -ez / len, nz = ex / len;
    return { px: a[0] + nx * d[i], pz: a[1] + nz * d[i], dx: ex / len, dz: ez / len };
  });
  return poly.map((_, i) => {
    const l1 = lines[(i - 1 + n) % n], l2 = lines[i];
    const det = l1.dx * l2.dz - l1.dz * l2.dx;
    const t = ((l2.px - l1.px) * l2.dz - (l2.pz - l1.pz) * l2.dx) / det;
    return [l1.px + l1.dx * t, l1.pz + l1.dz * t] as [number, number];
  });
}

export function buildPanzerIVH(seed = 1, turretNumber = '312', upgrades: Set<string> = new Set()): TankModel {
  const rng = new RNG(seed);
  const b = new TankBuilder(new THREE.Vector3(TURRET_X, Y_ROOF, 0), new THREE.Vector3(TRUNNION_X, GUN_Y, 0), SCHEME_GER_3TONE);
  b.hullInside = [0.2, 1.05, 0];
  b.turretInside = [TURRET_X, 2.05, 0];

  /* ================================================================ HULL ARMOUR */
  b.setFrame('hull');
  b.plate('Nose plate (Bug)', 'hull', 'RHA', 80, [
    [X_NOSE_BOT, Y_NOSE_BOT, -Z_LOW], [X_NOSE_BOT, Y_NOSE_BOT, Z_LOW], [X_NOSE_TOP, Y_NOSE_TOP, Z_LOW], [X_NOSE_TOP, Y_NOSE_TOP, -Z_LOW],
  ], undefined, '14°');
  b.plate('Lower nose', 'hull', 'RHA', 20, [
    [X_LOWNOSE_BOT, Y_FLOOR, -Z_LOW], [X_LOWNOSE_BOT, Y_FLOOR, Z_LOW], [X_NOSE_BOT, Y_NOSE_BOT, Z_LOW], [X_NOSE_BOT, Y_NOSE_BOT, -Z_LOW],
  ], undefined, '≈55°');
  b.plate('Glacis (brake access)', 'hull', 'RHA', 20, [
    [X_NOSE_TOP, Y_NOSE_TOP, -Z_LOW], [X_NOSE_TOP, Y_NOSE_TOP, Z_LOW], [X_GLACIS_TOP, Y_GLACIS_TOP, Z_LOW], [X_GLACIS_TOP, Y_GLACIS_TOP, -Z_LOW],
  ], undefined, '72°');
  b.plate('Driver\'s front plate', 'hull', 'RHA', 80, [
    [X_DRV_BOT, Y_DRV_BOT, -Z_SUP], [X_DRV_BOT, Y_DRV_BOT, Z_SUP], [X_DRV_TOP, Y_ROOF, Z_SUP], [X_DRV_TOP, Y_ROOF, -Z_SUP],
  ], undefined, '10°');
  b.platePair('Superstructure side', 'hull', 'RHA', 30, [
    [X_DRV_BOT, Y_FENDER, Z_SUP], [X_DRV_TOP, Y_ROOF, Z_SUP], [X_REAR_TOP, Y_ROOF, Z_SUP], [X_REAR_MID, Y_FENDER, Z_SUP],
  ], undefined, '0°');
  b.platePair('Superstructure floor (over track)', 'hull', 'RHA', 10, [
    [X_DRV_BOT, Y_FENDER, Z_LOW], [X_DRV_BOT, Y_FENDER, Z_SUP], [X_REAR_MID, Y_FENDER, Z_SUP], [X_REAR_MID, Y_FENDER, Z_LOW],
  ], [0.2, 1.3, 1.0], 'horizontal');
  b.platePair('Lower hull side', 'hull', 'RHA', 30, [
    [X_LOWNOSE_BOT, Y_FLOOR, Z_LOW], [X_NOSE_BOT, Y_NOSE_BOT, Z_LOW], [X_NOSE_TOP, Y_NOSE_TOP, Z_LOW], [X_GLACIS_TOP, Y_GLACIS_TOP, Z_LOW],
    [X_REAR_MID, Y_FENDER, Z_LOW], [X_REAR_BOT, Y_FLOOR, Z_LOW],
  ], undefined, '0°');
  b.plate('Hull floor', 'hull', 'RHA', 10, [[X_LOWNOSE_BOT, Y_FLOOR, -Z_LOW], [X_LOWNOSE_BOT, Y_FLOOR, Z_LOW], [X_REAR_BOT, Y_FLOOR, Z_LOW], [X_REAR_BOT, Y_FLOOR, -Z_LOW]], undefined, 'horizontal');
  b.plate('Superstructure roof', 'hull', 'RHA', 16, [[X_DRV_TOP, Y_ROOF, -Z_SUP], [X_DRV_TOP, Y_ROOF, Z_SUP], [X_FIREWALL, Y_ROOF, Z_SUP], [X_FIREWALL, Y_ROOF, -Z_SUP]], undefined, 'horizontal');
  b.plate('Engine deck', 'hull', 'RHA', 10, [[X_FIREWALL, Y_ROOF, -Z_SUP], [X_FIREWALL, Y_ROOF, Z_SUP], [X_REAR_TOP, Y_ROOF, Z_SUP], [X_REAR_TOP, Y_ROOF, -Z_SUP]], undefined, 'horizontal');
  b.plate('Upper rear plate', 'hull', 'RHA', 20, [[X_REAR_TOP, Y_ROOF, -Z_SUP], [X_REAR_TOP, Y_ROOF, Z_SUP], [X_REAR_MID, Y_FENDER, Z_SUP], [X_REAR_MID, Y_FENDER, -Z_SUP]], undefined, '10°');
  b.plate('Lower rear plate', 'hull', 'RHA', 20, [[X_REAR_MID, Y_FENDER, -Z_LOW], [X_REAR_MID, Y_FENDER, Z_LOW], [X_REAR_BOT, Y_FLOOR, Z_LOW], [X_REAR_BOT, Y_FLOOR, -Z_LOW]], undefined, '8°');
  b.plate('Engine firewall', 'hull', 'MILD', 8, [[X_FIREWALL, Y_FLOOR + 0.03, -Z_LOW + 0.02], [X_FIREWALL, Y_FLOOR + 0.03, Z_LOW - 0.02], [X_FIREWALL, Y_ROOF - 0.03, Z_LOW - 0.02], [X_FIREWALL, Y_ROOF - 0.03, -Z_LOW + 0.02]], [-1.6, 1.0, 0], 'bulkhead', { auxiliary: true });

  // Hull Schürzen (5 mm) — hung on rails outside the tracks; panels are often missing in photos
  for (const side of [-1, 1] as const) {
    const n = 6;
    const x0 = 2.02, x1 = -2.42;
    for (let i = 0; i < n; i++) {
      if (!upgrades.has('schurzen_repair') && rng.chance(0.12)) continue;
      const xa = x0 + ((x1 - x0) * i) / n - 0.01, xb = x0 + ((x1 - x0) * (i + 1)) / n + 0.01;
      const tilt = rng.range(-0.02, 0.04);
      b.plate(`Schürzen ${i + 1} (${side > 0 ? 'right' : 'left'})`, 'skirt', 'MILD', 5, [
        [xa, 0.62, side * (1.6 + tilt)], [xb, 0.62, side * (1.6 + tilt)], [xb, 1.6, side * 1.6], [xa, 1.6, side * 1.6],
      ], [0, 1.0, side * 1.2], '0°', { spaced: true, auxiliary: true });
    }
    // rail and brackets
    b.box([4.5, 0.05, 0.05], [-0.2, 1.58, side * 1.5], 'paintDark');
    for (const x of [1.6, 0.6, -0.4, -1.4, -2.2]) b.box([0.05, 0.05, 0.42], [x, 1.58, side * 1.4], 'paintDark');
  }

  /* ================================================================ TURRET (welded plates) */
  b.setFrame('turret');
  const base: [number, number][] = [
    [TURRET_X + 0.88, 0.6], [TURRET_X - 0.55, 0.95], [TURRET_X - 0.92, 0.72], [TURRET_X - 0.92, -0.72], [TURRET_X - 0.55, -0.95], [TURRET_X + 0.88, -0.6],
  ];
  const H = Y_TT - Y_TB;
  const t = (deg: number) => H * Math.tan((deg * Math.PI) / 180);
  // edges: FR→SR (side 25°), SR→RR (rear corner 25°), RR→RL (rear 15°), RL→SL (25°), SL→FL (25°), FL→FR (front 11°)
  // polygon is counter-clockwise in the (x,z) plane → positive offsets move each edge inward
  const top = inset(base, [t(25), t(25), t(15), t(25), t(25), t(11)]);
  const ringB: V3[] = base.map(([x, z]) => [x, Y_TB, z]);
  const ringT: V3[] = top.map(([x, z]) => [x, Y_TT, z]);
  // six welded flat plates between the base and roof outlines (exact thickness per plate)
  const faces: [string, number, string][] = [
    ['Turret side (right)', 30, '25°'], ['Turret rear corner (right)', 30, '25°'], ['Turret rear', 30, '15°'],
    ['Turret rear corner (left)', 30, '25°'], ['Turret side (left)', 30, '25°'], ['Turret front', 50, '11°'],
  ];
  faces.forEach(([name, mm, ang], i) => {
    const j = (i + 1) % ringB.length;
    b.plate(name, 'turret', 'RHA', mm, [ringB[i], ringB[j], ringT[j], ringT[i]], [TURRET_X, 2.05, 0], ang);
  });
  b.plate('Turret roof', 'turret', 'RHA', 16, ringT, [TURRET_X, 2.0, 0], 'horizontal');
  // turret Schürzen (8 mm) — horseshoe around sides and rear
  const sz: [number, number][] = [[TURRET_X + 0.42, 1.2], [TURRET_X - 0.6, 1.2], [TURRET_X - 1.12, 0.95], [TURRET_X - 1.12, -0.95], [TURRET_X - 0.6, -1.2], [TURRET_X + 0.42, -1.2]];
  for (let i = 0; i < sz.length - 1; i++) {
    if (i === 2) continue; // rear: stowage bin sits there instead
    const [ax, az] = sz[i], [bx, bz] = sz[i + 1];
    b.plate(`Turret Schürzen ${i + 1}`, 'skirt', 'MILD', 8, [[ax, 1.74, az], [bx, 1.74, bz], [bx, 2.32, bz], [ax, 2.32, az]], [TURRET_X, 2.0, 0], '0°', { spaced: true, auxiliary: true });
  }
  for (const s of [-1, 1]) {
    for (const x of [TURRET_X + 0.2, TURRET_X - 0.45]) b.box([0.05, 0.05, 0.3], [x, 2.22, s * 1.0], 'paintDark');
  }
  // rear stowage bin (Gepäckkasten)
  b.box([0.34, 0.42, 0.95], [TURRET_X - 1.12, 2.08, 0], 'paint');
  b.box([0.36, 0.03, 0.97], [TURRET_X - 1.12, 2.3, 0], 'paintDark');
  // side hatch doors
  for (const s of [-1, 1]) {
    const n = new THREE.Vector3(0.217, 0.423, s * 0.879).normalize();
    const door = b.box([0.42, 0.5, 0.03], [TURRET_X + 0.1, 1.98, s * 0.7], 'paintDark');
    door.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, s), n);
  }
  // cupola (cast, seven vision blocks) at the turret rear
  const CUP: V3 = [TURRET_X - 0.62, Y_TT, 0];
  b.cyl(0.3, 0.3, 0.2, [CUP[0], CUP[1] + 0.1, CUP[2]], 'y', 'paint', 26);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const blk = b.box([0.03, 0.06, 0.1], [CUP[0] + Math.cos(a) * 0.3, CUP[1] + 0.12, CUP[2] + Math.sin(a) * 0.3], 'glass');
    blk.rotation.y = -a;
  }
  b.hatch(CUP[0], CUP[1] + 0.2, CUP[2], 0.25, 0.05);
  b.commanderHatch.copy(b.V([CUP[0], CUP[1] + 0.52, CUP[2]]));
  b.lathe([[0.001, 0.08], [0.07, 0.07], [0.1, 0.03], [0.11, 0]], [TURRET_X + 0.45, Y_TT, -0.2], 'y', 'paint');
  b.box([0.08, 0.05, 0.1], [TURRET_X + 0.55, Y_TT + 0.03, 0.35], 'darkSteel');
  // Nahverteidigungswaffe port / signal port on the roof
  b.cyl(0.07, 0.07, 0.06, [TURRET_X - 0.2, Y_TT + 0.03, 0.35], 'y', 'paintDark', 12);
  // turret numbers and crosses on the Schürzen
  for (const s of [-1, 1]) b.decal(numberTexture(turretNumber), [TURRET_X - 0.2, 2.05, s * 1.205], [0, 0, s], 0.85, 0.42);
  b.component('Electric traverse motor', 'traverse', [TURRET_X + 0.6, 1.82, -0.55], [0.25, 0.25, 0.25]);
  b.crew('gunner', 'Gunner (Richtschütze)', [TURRET_X + 0.35, 1.38, -0.42]);
  b.crew('commander', 'Commander (Kommandant)', [TURRET_X - 0.5, 1.58, -0.05]);
  b.crew('loader', 'Loader (Ladeschütze)', [TURRET_X + 0.15, 0.6, 0.45], 'standing');

  /* ================================================================ GUN — 7.5 cm KwK 40 L/48 in the external mantlet */
  b.setFrame('gun');
  const MZ = [-0.26, 0.24];
  b.plate('Gun mantlet (front)', 'mantlet', 'RHA', 50, [[X_MANTLET, GUN_Y - 0.2, MZ[0]], [X_MANTLET, GUN_Y - 0.2, MZ[1]], [X_MANTLET, GUN_Y + 0.18, MZ[1]], [X_MANTLET, GUN_Y + 0.18, MZ[0]]], [TRUNNION_X, GUN_Y, 0], '0°');
  b.plate('Gun mantlet (top)', 'mantlet', 'RHA', 50, [[X_MANTLET - 0.3, GUN_Y + 0.18, MZ[0]], [X_MANTLET - 0.3, GUN_Y + 0.18, MZ[1]], [X_MANTLET, GUN_Y + 0.18, MZ[1]], [X_MANTLET, GUN_Y + 0.18, MZ[0]]], [TRUNNION_X, GUN_Y, 0], 'horizontal');
  b.plate('Gun mantlet (left)', 'mantlet', 'RHA', 50, [[X_MANTLET - 0.3, GUN_Y - 0.2, MZ[0]], [X_MANTLET, GUN_Y - 0.2, MZ[0]], [X_MANTLET, GUN_Y + 0.18, MZ[0]], [X_MANTLET - 0.3, GUN_Y + 0.18, MZ[0]]], [TRUNNION_X, GUN_Y, 0], '0°');
  b.plate('Gun mantlet (right)', 'mantlet', 'RHA', 50, [[X_MANTLET - 0.3, GUN_Y - 0.2, MZ[1]], [X_MANTLET, GUN_Y - 0.2, MZ[1]], [X_MANTLET, GUN_Y + 0.18, MZ[1]], [X_MANTLET - 0.3, GUN_Y + 0.18, MZ[1]]], [TRUNNION_X, GUN_Y, 0], '0°');
  b.plate('Gun mantlet (bottom)', 'mantlet', 'RHA', 50, [[X_MANTLET - 0.3, GUN_Y - 0.2, MZ[0]], [X_MANTLET, GUN_Y - 0.2, MZ[0]], [X_MANTLET, GUN_Y - 0.2, MZ[1]], [X_MANTLET - 0.3, GUN_Y - 0.2, MZ[1]]], [TRUNNION_X, GUN_Y, 0], 'horizontal');
  // gun sleeve, tube, double-baffle muzzle brake
  b.cyl(0.095, 0.095, 0.32, [X_MANTLET + 0.16, GUN_Y, 0], 'x', 'paint', 18);
  b.barrel([X_MANTLET + 0.3, GUN_Y, 0], 2.82, 0.07, 0.055, { len: 0.36, r: 0.1, style: 'double' });
  b.cyl(0.02, 0.02, 0.06, [X_MANTLET + 0.02, GUN_Y, 0.19], 'x', 'darkSteel', 8);
  b.cyl(0.035, 0.035, 0.05, [X_MANTLET + 0.01, GUN_Y + 0.03, -0.17], 'x', 'glass', 10);
  b.coax.copy(b.V([X_MANTLET + 0.06, GUN_Y, 0.19]));
  b.externalPart('Gun barrel', 'barrel', [X_MANTLET + 1.75, GUN_Y, 0], [3.2, 0.15, 0.15], 0);
  b.component('7.5 cm breech', 'breech', [TRUNNION_X - 0.4, GUN_Y, 0], [0.8, 0.28, 0.3]);
  b.component('Gunner\'s telescope TZF 5f', 'optics', [TRUNNION_X - 0.05, GUN_Y + 0.05, -0.2], [0.35, 0.1, 0.1]);

  /* ================================================================ HULL DETAILS */
  b.setFrame('hull');
  b.cyl(0.88, 0.88, 0.04, [TURRET_X, Y_ROOF + 0.02, 0], 'y', 'paintDark', 34);
  // driver's visor (Fahrersehklappe 80) and bow MG ball (Kugelblende 30)
  const xv = (y: number) => X_DRV_BOT - (y - Y_DRV_BOT) * Math.tan((10 * Math.PI) / 180);
  b.box([0.08, 0.14, 0.32], [xv(1.42) + 0.03, 1.42, -0.55], 'paintDark', [0, 0, 0.17]);
  b.box([0.01, 0.025, 0.2], [xv(1.42) + 0.075, 1.43, -0.55], 'glass', [0, 0, 0.17]);
  b.sphere(0.13, [xv(1.4) + 0.02, 1.4, 0.5], 'paint', [0.6, 1, 1]);
  b.cyl(0.02, 0.017, 0.4, [xv(1.4) + 0.25, 1.4, 0.5], 'x', 'darkSteel', 8);
  b.bow = new THREE.Vector3(xv(1.4) + 0.45, 1.4, 0.5);
  // brake access hatches on the glacis
  for (const z of [-0.45, 0.45]) {
    const xm = (X_NOSE_TOP + X_GLACIS_TOP) / 2, ym = (Y_NOSE_TOP + Y_GLACIS_TOP) / 2;
    b.box([0.46, 0.025, 0.6], [xm, ym + 0.015, z], 'paintDark', [0, 0, -Math.atan2(Y_GLACIS_TOP - Y_NOSE_TOP, X_NOSE_TOP - X_GLACIS_TOP)]);
  }
  // spare track links on the nose plate (documented Ausf. H practice) + rack bar
  b.box([0.04, 0.04, 1.8], [X_NOSE_TOP + 0.08, 0.95, 0], 'darkSteel');
  if (upgrades.has('spare_tracks')) {
    for (let i = 0; i < 7; i++) {
      const z = -0.75 + i * 0.25;
      b.box([0.04, 0.12, 0.22], [X_NOSE_TOP + 0.06, 0.88, z], 'track', [0, 0, 0.24]);
    }
    b.plate('Spare track links (nose)', 'skirt', 'TRACK', 20, [
      [X_NOSE_BOT + 0.06, 0.74, -0.86], [X_NOSE_BOT + 0.06, 0.74, 0.86], [X_NOSE_TOP + 0.06, 1.0, 0.86], [X_NOSE_TOP + 0.06, 1.0, -0.86],
    ], undefined, '14°', { spaced: true, auxiliary: true });
  }
  // tow shackles, headlight (single Bosch light on the left fender)
  for (const z of [-0.7, 0.7]) b.box([0.16, 0.18, 0.08], [X_NOSE_BOT + 0.05, 0.62, z], 'paintDark');
  b.headlight(2.2, Y_FENDER + 0.14, -1.05);
  // fenders
  for (const s of [-1, 1]) {
    b.box([5.3, 0.012, 0.56], [-0.08, Y_FENDER + 0.006, s * 1.2], 'paint');
    b.box([0.42, 0.012, 0.42], [2.72, 0.98, s * 1.24], 'paint', [0, 0, -0.32]);
  }
  // hull roof hatches (driver / radio operator) + periscope housings
  for (const z of [-0.5, 0.5]) b.hatch(1.45, Y_ROOF + 0.005, z, 0.22, 0.03, 1.2, 0.85);
  // engine deck: two hatches, air intakes, tools
  for (const z of [-0.5, 0.5]) {
    b.box([1.0, 0.03, 0.8], [-1.75, Y_ROOF + 0.015, z], 'paintDark');
    b.box([0.25, 0.04, 0.2], [-1.2, Y_ROOF + 0.03, z * 1.6], 'darkSteel');
  }
  b.box([1.25, 0.04, 0.08], [-1.4, Y_FENDER + 0.03, 1.36], 'wood');
  b.box([0.9, 0.04, 0.06], [-0.1, Y_FENDER + 0.03, -1.38], 'wood');
  b.cyl(0.04, 0.04, 1.6, [0.9, Y_FENDER + 0.04, 1.38], 'x', 'darkSteel', 6);
  // jerrycans / spare road wheels on the rear deck
  b.cyl(0.235, 0.235, 0.075, [-2.3, Y_ROOF + 0.06, 0.6], 'y', 'rubber', 18);
  b.cyl(0.18, 0.18, 0.08, [-2.3, Y_ROOF + 0.12, 0.6], 'y', 'paint', 18);
  // big rear muffler (Auspufftopf) and generator exhaust
  b.cyl(0.19, 0.19, 1.05, [X_REAR_MID - 0.24, 0.95, 0.05], 'z', 'muffler', 18);
  b.cyl(0.04, 0.04, 0.35, [X_REAR_MID - 0.2, 1.25, -0.6], 'y', 'muffler', 8);
  b.exhausts.push(new THREE.Vector3(X_REAR_MID - 0.3, 0.95, 0.55), new THREE.Vector3(X_REAR_MID - 0.2, 1.42, -0.6));
  b.box([0.08, 0.12, 0.3], [X_REAR_MID - 0.02, 1.4, 0.75], 'paintDark');
  // crosses on the hull Schürzen
  for (const s of [-1, 1]) b.decal(balkenkreuzTexture(), [-0.9, 1.14, s * 1.605], [0, 0, s], 0.6, 0.6);

  /* ================================================================ RUNNING GEAR */
  const circles: [number, number, number][] = [];
  for (const side of [-1, 1] as const) {
    const z = side * Z_TRACK;
    for (const bx of BOGIES) {
      // bogie: housing, quarter-elliptic leaf spring, two arms
      b.box([0.3, 0.2, 0.16], [bx, 0.52, side * (Z_LOW + 0.1)], 'paint');
      b.box([0.5, 0.05, 0.1], [bx, 0.66, side * (Z_LOW + 0.1)], 'darkSteel', [0, 0, 0.08]);
      for (const off of [-0.26, 0.26]) {
        b.box([0.3, 0.06, 0.06], [bx + off * 0.5, 0.38, side * (Z_LOW + 0.14)], 'paint', [0, 0, off > 0 ? 0.45 : -0.45]);
        for (const dz of [-0.085, 0.085]) b.wheel(bx + off, WHEEL_Y, z + dz, WHEEL_R, 0.075, 'dished', side);
        if (side === 1) circles.push([bx + off, WHEEL_Y, WHEEL_R]);
      }
    }
    for (const rx of [1.45, 0.48, -0.48, -1.45]) {
      b.wheel(rx, 0.93, z, 0.1, 0.16, 'steel', side);
      b.box([0.06, 0.12, 0.18], [rx, 0.98, side * (Z_LOW + 0.1)], 'paint');
      if (side === 1) circles.push([rx, 0.93, 0.1]);
    }
    b.sprocket(2.48, 0.72, z, 0.33, 0.36, 20);
    b.wheel(-2.58, 0.6, z, 0.27, 0.32, 'spoked', side);
  }
  circles.push([2.48, 0.72, 0.33], [-2.58, 0.6, 0.27]);
  for (const side of [-1, 1] as const) {
    b.track(circles, side * Z_TRACK, TRACK_W, 0.12, 0.05, 'cleat', { x0: -1.45, x1: 1.45, y: 0.9, depth: 0.03 });
    b.externalPart(`Track & suspension (${side > 0 ? 'right' : 'left'})`, 'track', [0, 0.52, side * Z_TRACK], [5.4, 1.05, TRACK_W], 18, side);
  }

  /* ================================================================ FINE DETAIL */
  b.setFrame('hull');
  // pioneer tools and fittings on the fenders (Ausf. H stowage)
  tool(b, 'extinguisher', [1.15, Y_FENDER + 0.012, -1.33], 0);
  tool(b, 'shovel', [0.15, Y_FENDER + 0.012, -1.35], Math.PI);
  tool(b, 'cutters', [-0.75, Y_FENDER + 0.012, -1.33], 0);
  tool(b, 'crowbar', [0.4, Y_FENDER + 0.012, 1.34], 0);
  tool(b, 'axe', [-0.75, Y_FENDER + 0.012, 1.36], Math.PI);
  tool(b, 'trackTool', [-1.7, Y_FENDER + 0.012, 1.34], 0);
  tool(b, 'jack', [-2.2, Y_ROOF + 0.01, -0.75], Math.PI / 2);
  // Notek blackout light and horn on the left fender
  b.box([0.08, 0.06, 0.06], [2.32, Y_FENDER + 0.05, -1.25], 'darkSteel');
  b.cyl(0.03, 0.045, 0.1, [2.1, Y_FENDER + 0.06, -1.15], 'x', 'darkSteel', 10);
  // brake-hatch hinges and handles, engine-deck hatch hinges
  const xm = (X_NOSE_TOP + X_GLACIS_TOP) / 2, ym = (Y_NOSE_TOP + Y_GLACIS_TOP) / 2;
  for (const z of [-0.45, 0.45]) {
    hinge(b, [X_GLACIS_TOP + 0.05, Y_GLACIS_TOP - 0.01, z - 0.25], [X_GLACIS_TOP + 0.05, Y_GLACIS_TOP - 0.01, z + 0.25], 0.02, 2);
    handle(b, [xm + 0.12, ym - 0.02, z - 0.08], [xm + 0.12, ym - 0.02, z + 0.08], [0.31, 0.95, 0], 0.04);
    hinge(b, [-1.28, Y_ROOF + 0.03, z - 0.3], [-1.28, Y_ROOF + 0.03, z + 0.3], 0.02, 2);
    handle(b, [-2.1, Y_ROOF + 0.03, z - 0.08], [-2.1, Y_ROOF + 0.03, z + 0.08], [0, 1, 0], 0.04);
  }
  // bolts round the driver's visor and the nose plate track rack
  bolts(b, [[2.21, 1.53, -0.73], [2.21, 1.53, -0.37], [2.24, 1.31, -0.73], [2.24, 1.31, -0.37]], [1, 0.17, 0], 0.016);
  boltRow(b, [X_NOSE_TOP + 0.03, 0.96, -0.85], [X_NOSE_TOP + 0.03, 0.96, 0.85], 7, [0.97, 0.24, 0], 0.016);
  // Fu 5 rod aerial on the right rear of the hull
  antenna(b, [-1.65, Y_ROOF, 1.08], 2.0, [-0.18, 1, 0.05]);
  // tow cable and jerrycans on the rear deck
  cable(b, [[-2.6, Y_ROOF + 0.05, -0.9], [-2.0, Y_ROOF + 0.08, -0.95], [-1.4, Y_ROOF + 0.06, -0.9], [-1.4, Y_ROOF + 0.06, -0.35], [-2.0, Y_ROOF + 0.08, -0.3], [-2.6, Y_ROOF + 0.05, -0.35]], 0.015);
  for (const z of [0.15, 0.4]) stowageBox(b, [0.16, 0.34, 0.24], [-2.62, Y_ROOF + 0.17, z], 'paintDark');
  // fender support brackets
  for (const s of [-1, 1]) for (const x of [2.0, 0.7, -0.6, -1.9]) rod(b, [x, Y_FENDER, s * Z_SUP], [x, Y_FENDER - 0.12, s * (Z_SUP + 0.2)], 0.012, 'paintDark');
  b.setFrame('turret');
  // side doors: hinges and handles; NbK 39 smoke dischargers (early Ausf. H); cupola hatch hinge
  for (const s of [-1, 1]) {
    hinge(b, [TURRET_X - 0.12, 2.16, s * 0.66], [TURRET_X - 0.12, 1.8, s * 0.72], 0.02, 2);
    handle(b, [TURRET_X + 0.22, 2.02, s * 0.71], [TURRET_X + 0.22, 1.92, s * 0.73], [0.2, 0.4, s * 0.9], 0.04);
    for (let i = 0; i < 3; i++) {
      const z = s * (0.68 + i * 0.07);
      rod(b, [TURRET_X + 0.75, 2.02, z], [TURRET_X + 0.92, 2.14, z * 1.05], 0.035, 'paintDark');
    }
    // hinged access doors in the turret Schürzen
    b.box([0.4, 0.42, 0.012], [TURRET_X - 0.1, 2.03, s * 1.21], 'paintDark');
    hinge(b, [TURRET_X + 0.1, 2.24, s * 1.215], [TURRET_X + 0.1, 1.82, s * 1.215], 0.016, 2);
  }
  hinge(b, [CUP[0] - 0.22, CUP[1] + 0.25, -0.1], [CUP[0] - 0.22, CUP[1] + 0.25, 0.1], 0.02, 1);
  // stowage bin lid hinges and latches
  hinge(b, [TURRET_X - 1.3, 2.3, -0.4], [TURRET_X - 1.3, 2.3, 0.4], 0.016, 3);
  for (const z of [-0.3, 0.3]) b.box([0.02, 0.06, 0.04], [TURRET_X - 1.295, 2.18, z], 'darkSteel');
  b.setFrame('hull');

  /* ================================================================ INTERIOR */
  b.crew('driver', 'Driver (Fahrer)', [1.6, 0.66, -0.5]);
  b.crew('radio', 'Radio operator / bow MG', [1.6, 0.66, 0.5]);
  b.component('SSG 77 transmission', 'transmission', [2.05, 0.75, 0], [0.62, 0.58, 0.62]);
  b.component('Fu 5 radio set', 'radio', [1.75, 1.3, 0.2], [0.35, 0.3, 0.45]);
  b.component('Maybach HL 120 TRM', 'engine', [-1.75, 0.95, 0.05], [1.2, 0.8, 0.85]);
  b.component('DKW auxiliary generator (traverse)', 'traverse', [-1.25, 0.8, -0.68], [0.35, 0.35, 0.3]);
  b.component('Fuel tanks (under fighting compartment floor)', 'fuel', [-0.15, 0.53, 0], [1.5, 0.22, 1.5]);
  b.component('Ammo bin (left hull side)', 'ammo', [0.25, 0.85, -0.72], [1.1, 0.6, 0.36], { rounds: 32 });
  b.component('Ammo bin (right hull side)', 'ammo', [0.35, 0.85, 0.72], [1.0, 0.6, 0.36], { rounds: 24 });
  b.component('Ready rounds (right, by loader)', 'ammo', [-0.35, 0.85, 0.74], [0.3, 0.6, 0.34], { rounds: 6, ready: true });
  b.component('Ammo bin (beside radio operator)', 'ammo', [1.15, 0.75, 0.8], [0.45, 0.6, 0.3], { rounds: 25 });

  return b.finish({ halfLength: 2.92, halfWidth: 1.44, height: 2.68 });
}
