import * as THREE from 'three';
import { RNG } from '../../core/rng';
import type { TerrainDef } from '../Terrain';
import type { World } from '../World';
import { buildBackground } from '../Background';
import { craterTexture } from '../../render/Textures';
import {
  addCrates, addFence, addHedgehog, addHedgerow, addHouse, addLamp, addRoadSign, addSandbags, addStoneWall, addTelegraphPoles, addTree, addWire, addWreckTruck,
} from '../Props';

/**
 * "Saint-Martin-des-Champs, July 1944" — a fictional Norman village on the road south of the
 * beachhead. West → east: US start line, bocage fields with hedgerow choke points, the
 * crossroads farm (A), the village square with the mairie (B), open ground with a low rise,
 * the walled château farm (C), and the German rear.
 */

export const NORMANDY: TerrainDef = {
  x0: 0,
  x1: 1150,
  seed: 1944,
  roadZ: -3,
  roadHalf: 3.2,
  hills: [
    { x: 740, z: -11, rx: 45, rz: 9, h: 2.4 },
    { x: 250, z: 3, rx: 30, rz: 6, h: 1.2 },
    { x: 980, z: -12, rx: 50, rz: 10, h: 2.0 },
  ],
  mud: [
    { x: 210, z: -12, r: 9 },
    { x: 420, z: 2, r: 7 },
    { x: 700, z: 0, r: 10 },
    { x: 905, z: -13, r: 8 },
  ],
  farRiverZ: -175,
  village: [{ x0: 450, x1: 650 }],
};

export interface MapLayout {
  objectives: { id: string; label: string; x: number; z: number; r: number; owner: 'allies' | 'axis' | null }[];
  alliesStart: number;
  axisStart: number;
  /** German defensive positions: [x, z] */
  defence: { a: [number, number][]; b: [number, number][]; c: [number, number][] };
}

export function populateNormandy(w: World): MapLayout {
  const r = new RNG(77);
  const BAND_BACK = -16.8;

  buildBackground(w, 9, NORMANDY.x0, NORMANDY.x1, { churchX: 620, bridgeX: 380, burning: [470, 760, 1010, 240] });

  // ---- hedgerows framing the band (back edge) and the far side of the fields
  addHedgerow(w, -40, BAND_BACK - 1.5, 300, BAND_BACK - 1.5, 3);
  addHedgerow(w, 655, BAND_BACK - 1.5, 820, BAND_BACK - 1.5, 4);
  addHedgerow(w, 905, BAND_BACK - 1.5, 1190, BAND_BACK - 1.5, 5);
  for (const [x0, x1, z] of [[-60, 420, -44], [600, 1200, -46], [100, 900, -30]] as [number, number, number][]) addHedgerow(w, x0, z, x1, z, x0 + 11);

  // ---- bocage cross-hedges with gaps: the road and a field gate are the only ways through
  addHedgerow(w, 180, BAND_BACK, 180, -8.5, 21);
  addHedgerow(w, 180, 1.8, 180, 6.5, 22);
  addHedgerow(w, 268, BAND_BACK, 268, -11, 23);
  addHedgerow(w, 268, -0.5, 268, 6.5, 24);

  // ---- start line (US)
  addFence(w, 15, 120, 4.6, 1);
  addSandbags(w, 62, -12.5, 5, 3, true, 2);
  addWreckTruck(w, 102, -11.5, 0.25, 3, true);
  addRoadSign(w, 74, 1.2, [['ST-MARTIN', '2 km'], ['CARENTAN', '14 km']]);
  for (const x of [30, 140, 205, 300]) addTree(w, x, -21, x, 'poplar');
  addTree(w, 128, 3.8, 12, 'round');

  // ---- objective A: crossroads farm
  addHouse(w, { x: 340, z: -15.2, w: 12, d: 7, floors: 2, style: 'stone', seed: 31, damage: 0.2 });
  addHouse(w, { x: 372, z: -14.8, w: 10, d: 7.5, floors: 1, style: 'stone', tint: '#9d9178', seed: 32 });
  addStoneWall(w, 296, 330, -8.4, 1.2, 1);
  addStoneWall(w, 346, 388, 2.6, 1.0, 2);
  addSandbags(w, 352, -8.6, 4, 3, true, 5);
  addCrates(w, 386, -9.8, 7);
  for (const x of [302, 318, 392]) addTree(w, x, -13.5, x + 5, 'round');

  // ---- approach to the village: obstacles and wire
  addHedgehog(w, 418, -8.0, 1);
  addHedgehog(w, 424, 1.6, 2);
  addHedgehog(w, 433, -11.5, 3);
  addWire(w, 402, 434, 3.4);
  addSandbags(w, 445, -9.2, 5, 3, true, 6);
  addWreckTruck(w, 452, 2.2, -0.3, 8, false);
  addRoadSign(w, 438, -7.4, [['ST-MARTIN', '']]);

  // ---- the village (houses behind the road; low walls on the camera side)
  const houses: Parameters<typeof addHouse>[1][] = [
    { x: 470, z: -14.6, w: 12, d: 7, floors: 2, style: 'stone', seed: 41, sign: 'BOULANGERIE' },
    { x: 488, z: -15.2, w: 9, d: 7, floors: 2, style: 'plaster', seed: 42 },
    { x: 506, z: -14.9, w: 14, d: 8, floors: 2, style: 'plaster', tint: '#d4c6a6', seed: 43, sign: 'MAIRIE', flag: true },
    { x: 528, z: -15.1, w: 10, d: 7, floors: 2, style: 'plaster', tint: '#c2b08c', seed: 44, sign: 'CAFÉ DU COMMERCE' },
    { x: 548, z: -14.6, w: 12, d: 7, floors: 2, style: 'stone', seed: 45, lettering: ['LIBERTÉ', 'ÉGALITÉ', 'FRATERNITÉ'], damage: 0.5 },
    { x: 575, z: -15.2, w: 9, d: 7, floors: 1, style: 'stone', seed: 46 },
    { x: 598, z: -14.6, w: 13, d: 8, floors: 2, style: 'plaster', seed: 47, sign: 'HÔTEL DE LA GARE' },
    { x: 624, z: -15.5, w: 10, d: 7, floors: 2, style: 'stone', seed: 48, damage: 0.6 },
  ];
  for (const h of houses) addHouse(w, h);
  addStoneWall(w, 478, 500, 3.2, 1.3, 3);
  addStoneWall(w, 556, 586, 3.4, 1.1, 4);
  addStoneWall(w, 628, 652, -9.2, 1.3, 5); // hull-down position for the defending Panzer IV
  addSandbags(w, 505, -9.4, 4, 3, true, 9);
  addSandbags(w, 590, 1.9, 3.5, 3, true, 10);
  addCrates(w, 540, -9.6, 11);
  for (const x of [482, 540, 600]) addLamp(w, x, -8.3);
  addRoadSign(w, 655, -7.4, [['VIRE', '27 km'], ['ST-LÔ', '19 km']]);

  // ---- open ground and the rise
  for (const x of [680, 712, 760, 800]) addTree(w, x, -14.2 + r.range(-1, 1), x, r.chance(0.5) ? 'round' : 'poplar');
  addWreckTruck(w, 705, -12.5, 2.9, 12, true);
  addSandbags(w, 744, -9.5, 6, 2, true, 13);
  addFence(w, 690, 790, 4.4, 14);

  // ---- objective C: walled château farm
  addStoneWall(w, 818, 852, -9.0, 1.9, 6);
  addStoneWall(w, 866, 902, -9.0, 1.9, 7);
  addHouse(w, { x: 860, z: -15.3, w: 14, d: 8, floors: 2, style: 'stone', tint: '#ab9f88', seed: 51 });
  addHouse(w, { x: 888, z: -15.0, w: 9, d: 7, floors: 1, style: 'stone', seed: 52 });
  addSandbags(w, 860, 2.6, 5, 3, true, 15);
  addHedgehog(w, 812, 1.2, 4);
  addCrates(w, 840, -10.8, 16);

  // ---- German rear
  addHedgerow(w, 960, BAND_BACK, 960, -9, 25);
  addHedgerow(w, 960, 2.2, 960, 6.5, 26);
  for (const x of [930, 1010, 1060, 1100]) addTree(w, x, -12 + r.range(-2, 1), x, 'round');
  addTelegraphPoles(w, -40, 1180, -7.6);

  // ---- battle scars: craters and scorch along the line of advance
  for (let i = 0; i < 30; i++) {
    const x = r.range(150, 1000), z = r.range(-15, 5);
    if (Math.abs(z + 3) < 3.5) continue;
    w.terrain.addCrater(x, z, r.range(0.8, 1.6), r.range(0.15, 0.35));
  }
  for (let i = 0; i < 40; i++) {
    const x = r.range(100, 1050), z = r.range(-15, 6);
    w.effects.decal(craterTexture(), new THREE.Vector3(x, w.terrain.height(x, z), z), new THREE.Vector3(0, 1, 0), r.range(1.5, 3.4));
  }

  return {
    objectives: [
      { id: 'A', label: 'Crossroads farm', x: 350, z: -5, r: 17, owner: 'axis' },
      { id: 'B', label: 'Village square', x: 520, z: -5, r: 19, owner: 'axis' },
      { id: 'C', label: 'Château farm', x: 860, z: -4, r: 18, owner: 'axis' },
    ],
    alliesStart: 40,
    axisStart: 1110,
    defence: {
      a: [[352, -10.2], [326, -10], [360, 1.2], [372, 0.5], [340, -9.8], [384, -11.2]],
      b: [[505, -11], [490, 1.6], [570, 2], [590, 0.4], [540, -11.4], [524, -10.6], [600, -10.6], [470, -10.8]],
      c: [[845, -10.5], [872, -10.5], [860, 1.2], [880, 1.1], [830, -10.6], [895, -10.8]],
    },
  };
}
