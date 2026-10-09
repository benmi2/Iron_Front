import type { Cite } from './provenance';

/**
 * Vehicle upgrades. Each one is tagged:
 *   'documented'  — a historically documented production change or field modification
 *   'maintenance' — a game abstraction of keeping the vehicle at its rated condition
 *   'training'    — crew proficiency (operates the vehicle better, never changes the physics)
 * Nothing here increases a shell's penetration or an armour plate beyond what the vehicle had.
 * Field add-ons are modelled physically (extra plates / spaced material on the hull), not as a
 * damage multiplier.
 */

export type UpgradeKind = 'documented' | 'maintenance' | 'training';
export type UpgradeCat = 'firepower' | 'mobility' | 'protection' | 'crew' | 'reliability';

export interface UpgradeDef {
  id: string;
  name: string;
  cat: UpgradeCat;
  kind: UpgradeKind;
  /** vehicles it applies to ('*' = all) */
  vehicles: string[];
  rp: number;
  cost: number;
  requires?: string[];
  desc: string;
  /** what it changes in the simulation */
  effect: string;
  cite?: Cite;
}

export const UPGRADES: UpgradeDef[] = [
  // ---- firepower
  { id: 'ammo_pzgr40', name: 'Extra Pzgr. 40 allocation', cat: 'firepower', kind: 'documented', vehicles: ['pz4h'], rp: 600, cost: 1500,
    desc: 'Tungsten was scarce by 1944: a tank normally drew only a few APCR rounds. A favoured unit might draw a few more.', effect: 'Pzgr. 40 limit raised from 3 to 6 rounds.',
    cite: { prov: 'interpreted', src: ['WIKI_KWK40', 'JENTZ_PT4'] } },
  { id: 'gun_sight_service', name: 'Sight collimation', cat: 'firepower', kind: 'maintenance', vehicles: ['*'], rp: 500, cost: 1200,
    desc: 'Bore-sighting and sight adjustment by the battalion workshop.', effect: 'Removes the worn-sight dispersion penalty of a used vehicle.' },
  // ---- mobility
  { id: 'engine_overhaul', name: 'Engine overhaul', cat: 'mobility', kind: 'maintenance', vehicles: ['*'], rp: 600, cost: 2500,
    desc: 'Workshop overhaul restores the engine to rated power.', effect: 'A worn engine (−10 % power) is brought back to its rated output.' },
  { id: 'track_grousers', name: 'Duckbill extended end connectors', cat: 'mobility', kind: 'documented', vehicles: ['m4a3_75w'], rp: 700, cost: 1500,
    desc: 'Extended end connectors widened the narrow VVSS track for soft ground (late 1944).', effect: 'Lower ground pressure: +15 % traction in mud.',
    cite: { prov: 'interpreted', src: ['HUNNICUTT'], note: 'field-fitted from late 1944' } },
  { id: 'culin_cutter', name: 'Culin hedgerow cutter ("Rhino")', cat: 'mobility', kind: 'documented', vehicles: ['m4a3_75w'], rp: 1200, cost: 3000,
    desc: 'Steel tusks welded to the nose, made from German beach obstacles, let Shermans bull through Normandy hedgerows (July 1944).', effect: 'The tank can breach bocage hedgerows.',
    cite: { prov: 'verified', src: ['HUNNICUTT'] } },
  // ---- protection
  { id: 'spare_tracks', name: 'Spare track links on the hull front', cat: 'protection', kind: 'documented', vehicles: ['m4a3_75w', 'pz4h'], rp: 400, cost: 900,
    desc: 'Crews hung spare links on the glacis / nose. Their real protective value was small.', effect: 'Adds a thin spaced layer (≈20 mm steel) over part of the front.',
    cite: { prov: 'interpreted', src: ['HUNNICUTT', 'JENTZ_PT4'] } },
  { id: 'sandbags', name: 'Sandbag field armour', cat: 'protection', kind: 'documented', vehicles: ['m4a3_75w'], rp: 600, cost: 1200,
    desc: 'Sandbags on the hull front against Panzerfausts. Contemporary tests found little benefit and the weight strained the suspension.', effect: 'Adds a spaced sand layer on the glacis; +1.2 t mass.',
    cite: { prov: 'interpreted', src: ['HUNNICUTT'], note: 'protective value disputed in period tests' } },
  { id: 'schurzen_repair', name: 'Replace lost Schürzen', cat: 'protection', kind: 'documented', vehicles: ['pz4h'], rp: 200, cost: 500,
    desc: 'Skirt panels were easily torn off; replacing them restores the stand-off against anti-tank rifles and some HEAT.', effect: 'All 5 mm / 8 mm skirt panels present.',
    cite: { prov: 'verified', src: ['WIKI_PZIV'] } },
  // ---- crew
  { id: 'crew_gunnery', name: 'Gunnery school', cat: 'crew', kind: 'training', vehicles: ['*'], rp: 800, cost: 2000,
    desc: 'Range estimation and laying drills.', effect: 'Gunner skill +0.12 (smaller ranging errors, faster lay).' },
  { id: 'crew_loading', name: 'Loading drill', cat: 'crew', kind: 'training', vehicles: ['*'], rp: 600, cost: 1500,
    desc: 'Ammunition handling drill in a moving turret.', effect: 'Loader skill +0.12 (closer to the documented maximum rate of fire).' },
  { id: 'crew_driving', name: 'Driver training', cat: 'crew', kind: 'training', vehicles: ['*'], rp: 500, cost: 1200,
    desc: 'Smooth gear changes and terrain reading.', effect: 'Driver skill +0.12.' },
  { id: 'crew_observation', name: 'Commander observation course', cat: 'crew', kind: 'training', vehicles: ['*'], rp: 700, cost: 1800,
    desc: 'Target spotting and identification.', effect: 'Commander observation +0.12 (faster spotting).' },
  { id: 'crew_repair', name: 'Field repair course', cat: 'crew', kind: 'training', vehicles: ['*'], rp: 600, cost: 1500,
    desc: 'Track and running-gear repair under field conditions.', effect: 'Track repairs 30 % faster.' },
  // ---- reliability
  { id: 'maintenance_kit', name: 'Battalion maintenance', cat: 'reliability', kind: 'maintenance', vehicles: ['*'], rp: 400, cost: 1000,
    desc: 'Regular servicing keeps every component at full condition between battles.', effect: 'Components start each battle undamaged even after hard use.' },
];

export const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

export function upgradesFor(vehicleId: string) {
  return UPGRADES.filter((u) => u.vehicles.includes('*') || u.vehicles.includes(vehicleId));
}
