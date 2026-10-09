import * as THREE from 'three';
import type { V3 } from '../../ballistics/ArmorMesh';
import { usStarTexture } from '../../render/Textures';
import { SCHEME_OD } from '../TankMaterials';
import { TankBuilder, turretRing, type TankModel } from '../TankBuilder';
import { antenna, bolts, boltRow, cable, coil, handle, hinge, rod, stowageBox, tool } from '../Details';

/**
 * Medium Tank M4A3(75)W "Sherman" — late production: one-piece 47° glacis, wet stowage,
 * cast "sharp-nose" final-drive housing, D50878 turret with M34A1 mount, vision cupola and oval
 * loader hatch, VVSS with T48 rubber chevron track.
 *
 * Armour STATIONS are reused unchanged from Ballistic Armour Lab's ShermanM4A3.ts (built from
 * TM 9-759 dimensions and Hunnicutt's drawings): hull length 5.89 m, width 2.62 m, height 2.74 m,
 * clearance 0.43 m, turret ring 69 in, track centres 83 in, T48 track 16.56 in, 20 in road wheels.
 * In the game the turret armour lives in the TURRET frame and the rotor shield in the GUN frame.
 */

const Y_FLOOR = 0.43;
const Y_SPONSON = 1.02;
const Y_ROOF = 1.9;
const Z_LOW = 0.8;
const Z_SIDE = 1.27;
const X_GLACIS_BOT = 2.84;
const GLACIS_TAN = Math.tan((47 * Math.PI) / 180);
const X_GLACIS_TOP = X_GLACIS_BOT - (Y_ROOF - Y_SPONSON) * GLACIS_TAN;
const X_DECK_REAR = -2.7;
const X_REAR_LOW = -2.858;
const X_FLOOR_REAR = -2.78;
const X_FIREWALL = -0.7;
const TURRET_X = 0.5;
const Y_TURRET = 1.92;
const TRACK_Z = 1.055;
const TRACK_W = 0.42;
const WHEEL_R = 0.254;
const WHEEL_Y = 0.32;
const BOGIES = [1.47, -0.03, -1.53];
const GUN_Y = 2.28;
const XC = 1.13; // rotor shield axis (trunnion)
const RC = 0.27;

export function buildSherman(upgrades: Set<string> = new Set()): TankModel {
  const b = new TankBuilder(new THREE.Vector3(TURRET_X, Y_ROOF, 0), new THREE.Vector3(XC, GUN_Y, 0), SCHEME_OD);
  b.hullInside = [0.3, 1.2, 0];
  b.turretInside = [TURRET_X - 0.1, 2.3, 0];

  /* ================================================================ HULL ARMOUR */
  b.setFrame('hull');
  b.plate('Upper glacis', 'hull', 'RHA', 63.5, [
    [X_GLACIS_BOT, Y_SPONSON, -Z_SIDE], [X_GLACIS_BOT, Y_SPONSON, Z_SIDE], [X_GLACIS_TOP, Y_ROOF, Z_SIDE], [X_GLACIS_TOP, Y_ROOF, -Z_SIDE],
  ], undefined, '47°');
  const noseProfile: [number, number][] = [
    [2.84, 1.02], [2.915, 0.95], [2.96, 0.86], [2.965, 0.77], [2.93, 0.67], [2.85, 0.575], [2.72, 0.495], [2.58, 0.448], [2.46, 0.43],
  ];
  b.sweptProfile(
    noseProfile, 0.83, 12,
    (zAbs, y) => (zAbs > 0.6 ? Math.pow((zAbs - 0.6) / 0.23, 2) * 0.17 * (1 - THREE.MathUtils.smoothstep(y, 0.9, 1.02)) : 0),
    [2.3, 0.75, 0],
    { nose: { name: 'Lower nose (final drive housing)', group: 'hull', material: 'CHA', nominalMm: 89, angleNote: 'curved' } },
    () => 'nose',
    (p) => Math.max(51, 108 * Math.exp(-(((p.y - 0.8) / 0.17) ** 2)), p.y > 0.93 ? 64 : 0),
  );
  b.platePair('Upper hull side', 'hull', 'RHA', 38, [
    [X_GLACIS_BOT, Y_SPONSON, Z_SIDE], [X_GLACIS_TOP, Y_ROOF, Z_SIDE], [X_DECK_REAR, Y_ROOF, Z_SIDE], [X_REAR_LOW, Y_SPONSON, Z_SIDE],
  ], undefined, '0°');
  b.platePair('Sponson floor', 'hull', 'RHA', 13, [
    [X_GLACIS_BOT, Y_SPONSON, Z_LOW], [X_GLACIS_BOT, Y_SPONSON, Z_SIDE], [X_REAR_LOW, Y_SPONSON, Z_SIDE], [X_REAR_LOW, Y_SPONSON, Z_LOW],
  ], [0.3, 1.4, 1.0], 'horizontal');
  b.platePair('Lower hull side', 'hull', 'RHA', 38, [
    [2.3, Y_SPONSON, Z_LOW], [2.3, Y_FLOOR, Z_LOW], [X_FLOOR_REAR, Y_FLOOR, Z_LOW], [X_REAR_LOW, Y_SPONSON, Z_LOW],
  ], undefined, '0°');
  b.plate('Hull floor (front)', 'hull', 'RHA', 25, [[2.46, Y_FLOOR, -Z_LOW], [2.46, Y_FLOOR, Z_LOW], [0.8, Y_FLOOR, Z_LOW], [0.8, Y_FLOOR, -Z_LOW]], undefined, 'horizontal');
  b.plate('Hull floor (rear)', 'hull', 'RHA', 13, [[0.8, Y_FLOOR, -Z_LOW], [0.8, Y_FLOOR, Z_LOW], [X_FLOOR_REAR, Y_FLOOR, Z_LOW], [X_FLOOR_REAR, Y_FLOOR, -Z_LOW]], undefined, 'horizontal');
  b.plate('Hull roof', 'hull', 'RHA', 19, [[X_GLACIS_TOP, Y_ROOF, -Z_SIDE], [X_GLACIS_TOP, Y_ROOF, Z_SIDE], [X_FIREWALL, Y_ROOF, Z_SIDE], [X_FIREWALL, Y_ROOF, -Z_SIDE]], undefined, 'horizontal');
  b.plate('Engine deck', 'hull', 'RHA', 13, [[X_FIREWALL, Y_ROOF, -Z_SIDE], [X_FIREWALL, Y_ROOF, Z_SIDE], [X_DECK_REAR, Y_ROOF, Z_SIDE], [X_DECK_REAR, Y_ROOF, -Z_SIDE]], undefined, 'horizontal');
  b.plate('Upper rear plate', 'hull', 'RHA', 38, [[X_DECK_REAR, Y_ROOF, -Z_SIDE], [X_DECK_REAR, Y_ROOF, Z_SIDE], [X_REAR_LOW, Y_SPONSON, Z_SIDE], [X_REAR_LOW, Y_SPONSON, -Z_SIDE]], undefined, '10°');
  b.plate('Lower rear plate', 'hull', 'RHA', 38, [[X_REAR_LOW, Y_SPONSON, -Z_LOW], [X_REAR_LOW, Y_SPONSON, Z_LOW], [X_FLOOR_REAR, Y_FLOOR, Z_LOW], [X_FLOOR_REAR, Y_FLOOR, -Z_LOW]], undefined, '8°');
  b.plate('Engine firewall (lower)', 'hull', 'MILD', 6, [[X_FIREWALL, 0.46, -0.76], [X_FIREWALL, 0.46, 0.76], [X_FIREWALL, Y_SPONSON + 0.02, 0.76], [X_FIREWALL, Y_SPONSON + 0.02, -0.76]], [-1.5, 0.8, 0], 'bulkhead', { auxiliary: true });
  b.plate('Engine firewall (upper)', 'hull', 'MILD', 6, [[X_FIREWALL, Y_SPONSON + 0.02, -1.24], [X_FIREWALL, Y_SPONSON + 0.02, 1.24], [X_FIREWALL, 1.87, 1.24], [X_FIREWALL, 1.87, -1.24]], [-1.5, 1.4, 0], 'bulkhead', { auxiliary: true });

  /* ================================================================ TURRET ARMOUR (cast) */
  b.setFrame('turret');
  const rings: V3[][] = [
    turretRing(TURRET_X, Y_TURRET, 0, 0.86, 1.1, 0.95, 36, 2.3, 2.1),
    turretRing(TURRET_X, 2.05, 0, 0.87, 1.12, 0.97, 36, 2.4, 2.15),
    turretRing(TURRET_X, 2.3, 0, 0.79, 1.1, 0.96, 36, 2.4, 2.15),
    turretRing(TURRET_X, 2.53, 0, 0.65, 1.04, 0.92, 36, 2.3, 2.1),
    turretRing(TURRET_X, 2.67, 0, 0.53, 0.96, 0.85, 36, 2.2, 2.0),
    turretRing(TURRET_X, 2.73, 0, 0.42, 0.87, 0.76, 36, 2.1, 1.95),
  ];
  const angleOf = (p: THREE.Vector3) => Math.atan2(p.z, p.x - TURRET_X) * (180 / Math.PI);
  b.loft(rings, [TURRET_X, 2.3, 0], {
    front: { name: 'Turret front', group: 'turret', material: 'CHA', nominalMm: 76, angleNote: '≈30°' },
    sideR: { name: 'Turret side (right)', group: 'turret', material: 'CHA', nominalMm: 51, angleNote: '5°' },
    sideL: { name: 'Turret side (left)', group: 'turret', material: 'CHA', nominalMm: 51, angleNote: '5°' },
    rear: { name: 'Turret rear (bustle)', group: 'turret', material: 'CHA', nominalMm: 51, angleNote: '0°' },
  }, (c) => {
    const a = angleOf(c);
    if (Math.abs(a) < 42) return 'front';
    if (Math.abs(a) > 142) return 'rear';
    return a > 0 ? 'sideR' : 'sideL';
  }, (p) => {
    const a = Math.abs(angleOf(p));
    return a < 30 ? 76 : a < 55 ? 76 - ((a - 30) / 25) * 25 : 51;
  });
  b.plate('Turret roof', 'turret', 'RHA', 25, rings[rings.length - 1], [TURRET_X, 2.4, 0], 'horizontal');

  /* ================================================================ GUN MOUNT M34A1 (gun frame) */
  b.setFrame('gun');
  const arc: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const a = (-52 + (104 * i) / 10) * (Math.PI / 180);
    arc.push([XC + RC * Math.cos(a), GUN_Y + RC * Math.sin(a)]);
  }
  b.sweptProfile(arc, 0.48, 8, (zAbs) => (zAbs > 0.4 ? ((zAbs - 0.4) / 0.08) ** 2 * 0.04 : 0), [XC - 0.15, GUN_Y, 0],
    { m: { name: 'Gun mantlet (rotor shield)', group: 'mantlet', material: 'CHA', nominalMm: 89, angleNote: 'curved' } }, () => 'm', () => 89);
  const GS: [number, number, number, number] = [XC + RC - 0.02, XC + RC + 0.13, GUN_Y - 0.15, GUN_Y + 0.15];
  b.plate('Gun shield (front)', 'mantlet', 'CHA', 76, [[GS[1], GS[2], -0.2], [GS[1], GS[2], 0.24], [GS[1], GS[3], 0.24], [GS[1], GS[3], -0.2]], [XC, GUN_Y, 0], '0°');
  b.plate('Gun shield (top)', 'mantlet', 'CHA', 50, [[GS[0], GS[3], -0.2], [GS[0], GS[3], 0.24], [GS[1], GS[3], 0.24], [GS[1], GS[3], -0.2]], [XC, GUN_Y, 0], 'horizontal');
  b.plate('Gun shield (left)', 'mantlet', 'CHA', 50, [[GS[0], GS[2], -0.2], [GS[1], GS[2], -0.2], [GS[1], GS[3], -0.2], [GS[0], GS[3], -0.2]], [XC, GUN_Y, 0], '0°');
  b.plate('Gun shield (right)', 'mantlet', 'CHA', 50, [[GS[0], GS[2], 0.24], [GS[1], GS[2], 0.24], [GS[1], GS[3], 0.24], [GS[0], GS[3], 0.24]], [XC, GUN_Y, 0], '0°');
  // 75 mm M3 (L/40)
  b.barrel([GS[1], GUN_Y, 0.02], 1.83, 0.058, 0.05);
  b.cyl(0.07, 0.07, 0.16, [GS[1] + 0.08, GUN_Y, 0.02], 'x', 'paint', 18);
  b.cyl(0.018, 0.018, 0.12, [GS[1] + 0.03, GUN_Y, 0.17], 'x', 'darkSteel', 8);
  b.cyl(0.03, 0.03, 0.05, [GS[1] + 0.01, GUN_Y + 0.05, -0.14], 'x', 'glass', 10);
  b.coax.copy(b.V([GS[1] + 0.1, GUN_Y, 0.17]));
  b.externalPart('Gun barrel', 'barrel', [GS[1] + 0.92, GUN_Y, 0.02], [1.84, 0.13, 0.13], 0);
  b.component('75 mm gun breech', 'breech', [XC - 0.5, GUN_Y, 0.02], [0.95, 0.3, 0.3]);

  /* ================================================================ TURRET DETAILS */
  b.setFrame('turret');
  // commander's vision cupola (right rear) — six vision blocks
  const CUP: V3 = [TURRET_X - 0.33, 2.73, 0.38];
  b.cyl(0.33, 0.33, 0.15, [CUP[0], CUP[1] + 0.075, CUP[2]], 'y', 'paint', 28);
  b.cyl(0.25, 0.26, 0.06, [CUP[0], CUP[1] + 0.18, CUP[2]], 'y', 'paint', 28);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const blk = b.box([0.03, 0.07, 0.13], [CUP[0] + Math.cos(a) * 0.33, CUP[1] + 0.08, CUP[2] + Math.sin(a) * 0.33], 'glass');
    blk.rotation.y = -a;
  }
  b.hatch(CUP[0], CUP[1] + 0.21, CUP[2], 0.24, 0.04);
  b.commanderHatch.copy(b.V([CUP[0], CUP[1] + 0.55, CUP[2]]));
  b.hatch(TURRET_X - 0.05, 2.73, -0.4, 0.22, 0.04, 1.25, 0.8);
  b.lathe([[0.001, 0.12], [0.06, 0.11], [0.1, 0.06], [0.11, 0]], [TURRET_X - 0.55, 2.73, -0.05], 'y', 'paint');
  b.periscope(TURRET_X + 0.38, 2.73, 0.32);
  b.periscope(TURRET_X + 0.2, 2.73, -0.45);
  for (const [x, z] of [[TURRET_X + 0.45, 0.75], [TURRET_X + 0.45, -0.75], [TURRET_X - 0.7, 0]] as [number, number][]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.01, 6, 12), b.mats.paint);
    const p = b.V([x, 2.71, z]);
    ring.position.copy(p);
    b.add(ring);
  }
  // .50 cal M2HB on the cupola
  b.cyl(0.015, 0.015, 0.35, [CUP[0], 3.05, 0.6], 'y', 'darkSteel', 8);
  b.cyl(0.045, 0.045, 0.32, [CUP[0] - 0.05, 3.22, 0.6], 'x', 'darkSteel', 10);
  b.cyl(0.018, 0.016, 1.0, [CUP[0] + 0.55, 3.22, 0.6], 'x', 'darkSteel', 8);
  // stowed gear on the bustle (bedrolls, ration boxes — typical Normandy stowage)
  b.cyl(0.13, 0.13, 0.9, [TURRET_X - 1.12, 2.35, 0.05], 'z', 'canvas', 12);
  b.box([0.3, 0.2, 0.42], [TURRET_X - 1.05, 2.52, -0.45], 'wood');
  b.component('Gunner\'s periscope / telescope', 'optics', [TURRET_X + 0.55, 2.62, 0.3], [0.2, 0.18, 0.14]);
  b.component('Oilgear traverse unit', 'traverse', [TURRET_X + 0.45, 2.02, 0.62], [0.32, 0.28, 0.26]);
  b.component('SCR-528 radio', 'radio', [TURRET_X - 0.9, 2.28, 0], [0.3, 0.28, 0.6]);
  b.component('Turret ready rack', 'ammo', [-0.05, 1.05, -0.72], [0.36, 0.45, 0.26], { rounds: 8, ready: true, wet: false });
  b.crew('gunner', 'Gunner', [0.92, 1.55, 0.42]);
  b.crew('commander', 'Commander', [0.3, 1.72, 0.42]);
  b.crew('loader', 'Loader', [0.4, 0.8, -0.5], 'standing');

  /* ================================================================ HULL DETAILS */
  b.setFrame('hull');
  b.cyl(0.9, 0.9, 0.04, [TURRET_X, Y_ROOF + 0.02, 0], 'y', 'paintDark', 36);
  for (const z of [-0.55, 0.55]) {
    b.hatch(1.5, Y_ROOF + 0.005, z, 0.25, 0.04, 1.15, 0.9);
    b.periscope(1.82, Y_ROOF, z * 0.92);
  }
  const gn = new THREE.Vector3(0.682, 0.731, 0).normalize();
  const bmPos = new THREE.Vector3(X_GLACIS_BOT - (1.42 - Y_SPONSON) * GLACIS_TAN, 1.42, 0.43);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), b.mats.paint);
  ball.position.copy(bmPos);
  ball.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), gn);
  b.add(ball);
  b.cyl(0.018, 0.014, 0.55, [bmPos.x + 0.3, bmPos.y + 0.02, bmPos.z], 'x', 'darkSteel', 8);
  b.bow = new THREE.Vector3(bmPos.x + 0.6, bmPos.y + 0.02, bmPos.z);
  b.headlight(X_GLACIS_BOT + 0.05, Y_SPONSON + 0.1, 1.08);
  b.headlight(X_GLACIS_BOT + 0.05, Y_SPONSON + 0.1, -1.08);
  b.cyl(0.05, 0.05, 0.1, [X_GLACIS_BOT - 0.05, Y_SPONSON + 0.08, -0.65], 'x', 'paintDark', 12);
  for (const z of [-0.5, 0.5]) {
    const sh = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.016, 6, 12), b.mats.darkSteel);
    sh.position.set(2.97, 0.66, z);
    sh.rotation.y = Math.PI / 2;
    b.add(sh);
  }
  // upgrade: spare T48 track blocks hung on the glacis — modelled as a thin spaced steel layer
  if (upgrades.has('spare_tracks')) {
    for (const z of [-0.55, 0.0, 0.55]) {
      for (let i = 0; i < 4; i++) {
        const y = 1.12 + i * 0.16;
        const x = X_GLACIS_BOT - (y - Y_SPONSON) * GLACIS_TAN + 0.06;
        b.box([0.07, 0.15, 0.42], [x, y, z], 'track', [0, 0, 0.82]);
      }
    }
    const off = 0.07;
    const gx = (y: number) => X_GLACIS_BOT - (y - Y_SPONSON) * GLACIS_TAN + off;
    b.plate('Spare track links (glacis)', 'skirt', 'TRACK', 20, [
      [gx(1.06), 1.06, -0.8], [gx(1.06), 1.06, 0.8], [gx(1.7), 1.7, 0.8], [gx(1.7), 1.7, -0.8],
    ], undefined, '47°', { spaced: true, auxiliary: true });
  }
  // upgrade: sandbag field armour on the glacis (protective value disputed — modelled as sand)
  if (upgrades.has('sandbags')) {
    const sb = new THREE.MeshStandardMaterial({ color: 0x8c7d5a, roughness: 1 });
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        const y = 1.1 + i * 0.16;
        const x = X_GLACIS_BOT - (y - Y_SPONSON) * GLACIS_TAN + 0.16;
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), sb);
        m.scale.set(0.2, 0.17, 0.5);
        m.position.set(x, y, -1.0 + j * 0.5);
        b.add(m);
      }
    }
    const sx = (y: number) => X_GLACIS_BOT - (y - Y_SPONSON) * GLACIS_TAN + 0.05;
    b.plate('Sandbags (glacis)', 'skirt', 'SAND', 300, [
      [sx(1.04), 1.04, -1.2], [sx(1.04), 1.04, 1.2], [sx(1.86), 1.86, 1.2], [sx(1.86), 1.86, -1.2],
    ], undefined, 'sand layer', { spaced: true, auxiliary: true });
  }
  for (const s of [-1, 1]) {
    b.box([0.28, 0.008, 0.46], [2.98, Y_SPONSON + 0.05, s * TRACK_Z], 'paint', [0, 0, -0.25]);
    b.box([0.012, 0.12, 0.44], [3.1, Y_SPONSON - 0.02, s * TRACK_Z], 'paint', [0, 0, -0.25]);
  }
  for (const z of [-0.55, 0.55]) {
    b.box([1.0, 0.025, 0.72], [-1.75, Y_ROOF + 0.013, z], 'paintDark');
    for (let i = 0; i < 9; i++) b.box([0.02, 0.03, 0.68], [-2.2 + i * 0.11, Y_ROOF + 0.03, z], 'darkSteel');
    b.cyl(0.06, 0.06, 0.04, [-0.95, Y_ROOF + 0.02, z * 1.6], 'y', 'darkSteel', 12);
  }
  b.box([0.18, 0.06, 2.5], [-2.62, Y_ROOF + 0.03, 0], 'paint');
  b.box([0.9, 0.04, 0.08], [-1.4, Y_ROOF + 0.045, 1.15], 'wood');
  b.box([0.18, 0.05, 0.14], [-0.92, Y_ROOF + 0.045, 1.15], 'darkSteel');
  b.box([1.1, 0.035, 0.07], [-1.45, Y_ROOF + 0.04, -1.16], 'wood');
  // engine-deck stowage: tarp roll and jerrycans
  b.cyl(0.14, 0.14, 1.6, [-2.35, Y_ROOF + 0.15, 0], 'z', 'canvas', 12);
  for (const z of [0.85, 1.05]) b.box([0.16, 0.34, 0.24], [-2.0, Y_ROOF + 0.17, z], 'paintDark');
  b.extrudeSide([[X_REAR_LOW - 0.02, 1.02], [X_REAR_LOW - 0.22, 0.98], [X_REAR_LOW - 0.25, 0.75], [X_REAR_LOW - 0.08, 0.72]], -0.75, 0.75, 'paintDark');
  b.exhausts.push(new THREE.Vector3(X_REAR_LOW - 0.25, 0.74, -0.4), new THREE.Vector3(X_REAR_LOW - 0.25, 0.74, 0.4));
  for (const z of [-1.05, 1.05]) b.box([0.05, 0.1, 0.12], [X_REAR_LOW - 0.03, 1.55, z], 'lamp');
  b.cyl(0.04, 0.04, 0.16, [X_FLOOR_REAR - 0.1, 0.6, 0], 'x', 'darkSteel', 10);
  for (const s of [-1, 1]) b.box([5.4, 0.03, 0.04], [-0.05, Y_SPONSON + 0.015, s * (Z_SIDE + 0.02)], 'paintDark');
  // white stars (1944 invasion markings) on the hull sides
  for (const s of [-1, 1]) b.decal(usStarTexture(), [-0.35, 1.48, s * (Z_SIDE + 0.002)], [0, 0, s], 0.72, 0.72);
  b.decal(usStarTexture(), [-1.55, Y_ROOF + 0.004, 0], [0, 1, 0], 1.0, 1.0);

  /* ================================================================ RUNNING GEAR (VVSS) */
  const circles: [number, number, number][] = [];
  for (const side of [-1, 1] as const) {
    const z = side * TRACK_Z;
    for (const bx of BOGIES) {
      b.box([0.5, 0.34, 0.12], [bx, 0.66, side * (Z_LOW + 0.07)], 'paint');
      b.box([0.2, 0.34, 0.24], [bx, 0.52, side * (Z_LOW + 0.22)], 'paint');
      b.box([0.18, 0.06, 0.38], [bx, 0.81, side * (TRACK_Z - 0.02)], 'paint');
      b.wheel(bx - 0.12, 0.84, z, 0.09, 0.2, 'steel', side, true);
      for (const off of [-0.315, 0.315]) {
        const wx = bx + off;
        b.box([0.34, 0.07, 0.07], [bx + off * 0.5, 0.42, side * (TRACK_Z - 0.12)], 'paint', [0, 0, off > 0 ? 0.55 : -0.55]);
        for (const dz of [-0.095, 0.095]) b.wheel(wx, WHEEL_Y, z + dz, WHEEL_R, 0.1, 'pressed', side);
        if (side === 1) circles.push([wx, WHEEL_Y, WHEEL_R]);
      }
      if (side === 1) circles.push([bx - 0.12, 0.84, 0.09]);
    }
    b.sprocket(2.52, 0.66, z, 0.31, 0.38, 13);
    for (const dz of [-0.095, 0.095]) b.wheel(-2.56, 0.4, z + dz, 0.27, 0.1, 'spoked', side);
    b.box([0.45, 0.08, 0.08], [-2.36, 0.45, side * (Z_LOW + 0.1)], 'paint', [0, 0, -0.25]);
  }
  circles.push([2.52, 0.66, 0.32], [-2.56, 0.4, 0.27]);
  for (const side of [-1, 1] as const) {
    b.track(circles, side * TRACK_Z, TRACK_W, 0.152, 0.065, 'chevron');
    b.externalPart(`Track & suspension (${side > 0 ? 'right' : 'left'})`, 'track', [0, 0.5, side * TRACK_Z], [5.5, 1.0, TRACK_W], 22, side);
  }

  /* ================================================================ FINE DETAIL */
  b.setFrame('hull');
  // engine access doors on the upper rear plate: hinges, handles, latch bolts
  const rearX = (y: number) => X_DECK_REAR - ((Y_ROOF - y) / (Y_ROOF - Y_SPONSON)) * (X_DECK_REAR - X_REAR_LOW);
  for (const s of [-1, 1]) {
    b.box([0.02, 0.7, 1.05], [rearX(1.47) - 0.012, 1.47, s * 0.58], 'paint', [0, 0, -0.17]);
    hinge(b, [rearX(1.8) - 0.03, 1.8, s * 0.12], [rearX(1.8) - 0.03, 1.8, s * 1.05], 0.022, 3);
    handle(b, [rearX(1.35) - 0.02, 1.35, s * 0.3], [rearX(1.35) - 0.02, 1.35, s * 0.55], [-1, 0, 0], 0.05);
    boltRow(b, [rearX(1.15) - 0.024, 1.15, s * 0.12], [rearX(1.15) - 0.024, 1.15, s * 1.05], 6, [-1, 0, 0]);
  }
  // EE-8 field telephone box for the infantry (Normandy field modification) with its cable
  stowageBox(b, [0.12, 0.28, 0.26], [X_REAR_LOW - 0.11, 1.32, 0.95]);
  cable(b, [[X_REAR_LOW - 0.17, 1.2, 0.95], [X_REAR_LOW - 0.3, 1.05, 0.9], [X_REAR_LOW - 0.26, 0.92, 0.75], [X_REAR_LOW - 0.18, 1.1, 0.7]], 0.008, 'rubber');
  // gun travel lock on the rear deck (A-frame and cradle)
  for (const z of [-0.18, 0.18]) rod(b, [-2.5, Y_ROOF + 0.02, z], [-2.36, 2.34, z * 0.3], 0.02, 'paint');
  b.box([0.1, 0.06, 0.22], [-2.36, 2.36, 0], 'paintDark');
  // pioneer tools on the rear deck and hull rear
  tool(b, 'shovel', [-2.05, Y_ROOF + 0.01, -1.0], 0);
  tool(b, 'axe', [-1.1, Y_ROOF + 0.01, -1.05], Math.PI);
  tool(b, 'pick', [-2.0, Y_ROOF + 0.01, 1.05], 0);
  tool(b, 'sledge', [-1.15, Y_ROOF + 0.01, 1.0], Math.PI);
  tool(b, 'crowbar', [-1.6, Y_ROOF + 0.01, 0.0], 0);
  // tow cable coiled on the rear deck
  const loop: [number, number, number][] = [];
  for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI * 2; loop.push([-2.35 + Math.cos(a) * 0.22, Y_ROOF + 0.32 + i * 0.002, Math.sin(a) * 0.5]); }
  cable(b, loop, 0.016);
  // lifting eyes and glacis details
  for (const z of [-1.1, 1.1]) {
    const eye = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.014, 6, 12), b.mats.paint);
    eye.position.copy(b.V([X_GLACIS_TOP + 0.08, Y_ROOF + 0.04, z]));
    eye.rotation.y = Math.PI / 2;
    b.add(eye);
  }
  bolts(b, [[2.75, 0.92, -0.75], [2.75, 0.92, -0.25], [2.75, 0.92, 0.25], [2.75, 0.92, 0.75]], [1, 0.1, 0], 0.018);
  // sponson rail clips
  for (const s of [-1, 1]) for (let x = -2.3; x < 2.4; x += 0.9) b.box([0.04, 0.05, 0.06], [x, Y_SPONSON + 0.02, s * (Z_SIDE + 0.03)], 'paintDark');
  // VVSS volute springs (helical coils) and skid gussets on every bogie
  for (const side of [-1, 1]) {
    for (const bx of BOGIES) {
      coil(b, [bx, 0.42, side * (Z_LOW + 0.24)], 0.065, 0.2, 5, 0.014, 'darkSteel');
      b.box([0.36, 0.03, 0.14], [bx, 0.65, side * (Z_LOW + 0.23)], 'paintDark');
    }
  }
  b.setFrame('turret');
  // pistol port, M3 2-inch smoke mortar, .50 ammo box, aerial on the bustle
  b.cyl(0.08, 0.08, 0.05, [TURRET_X - 0.35, 2.3, -1.06], 'z', 'paintDark', 14);
  b.cyl(0.04, 0.04, 0.22, [TURRET_X + 0.25, 2.82, -0.62], 'y', 'darkSteel', 10);
  stowageBox(b, [0.28, 0.18, 0.12], [CUP[0] + 0.05, 3.06, 0.78], 'paintDark');
  antenna(b, [TURRET_X - 0.85, 2.62, 0.62], 2.6, [-0.35, 1, 0.08]);
  for (const [x, z] of [[TURRET_X + 0.3, -0.7], [TURRET_X + 0.3, 0.7]] as [number, number][]) handle(b, [x - 0.15, 2.55, z * 1.05], [x + 0.15, 2.55, z * 1.05], [0, 0, Math.sign(z)], 0.05);
  b.setFrame('gun');
  bolts(b, [[GS[1] + 0.002, GUN_Y + 0.11, -0.16], [GS[1] + 0.002, GUN_Y + 0.11, 0.2], [GS[1] + 0.002, GUN_Y - 0.11, -0.16], [GS[1] + 0.002, GUN_Y - 0.11, 0.2]], [1, 0, 0], 0.016);
  b.setFrame('hull');

  /* ================================================================ INTERIOR */
  b.crew('driver', 'Driver', [1.3, 0.72, -0.5]);
  b.crew('radio', 'Asst. driver / bow gunner', [1.3, 0.72, 0.5]);
  b.component('Transmission / differential', 'transmission', [2.15, 0.78, 0], [0.78, 0.55, 0.9]);
  b.component('Ford GAA V-8 engine', 'engine', [-1.75, 0.98, 0], [1.3, 0.85, 1.0]);
  b.component('Fuel tank (left sponson)', 'fuel', [-1.65, 1.45, -1.04], [1.55, 0.78, 0.36]);
  b.component('Fuel tank (right sponson)', 'fuel', [-1.65, 1.45, 1.04], [1.55, 0.78, 0.36]);
  b.component('Wet ammo bin (left)', 'ammo', [0.55, 0.6, -0.43], [0.95, 0.3, 0.5], { rounds: 48, wet: true });
  b.component('Wet ammo bin (right)', 'ammo', [0.55, 0.6, 0.43], [0.95, 0.3, 0.5], { rounds: 48, wet: true });
  b.component('Propeller shaft / basket', 'structure', [0.5, 0.6, 0], [2.6, 0.12, 0.12]);

  return b.finish({ halfLength: 2.95, halfWidth: 1.31, height: 2.94 });
}
