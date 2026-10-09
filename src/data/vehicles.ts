import { cite, type Cite, type CitedValue } from './provenance';
import type { Nation } from './ammo';

export type CrewRole = 'commander' | 'gunner' | 'loader' | 'driver' | 'radio';

export const ROLE_LABEL: Record<CrewRole, string> = {
  commander: 'Commander', gunner: 'Gunner', loader: 'Loader', driver: 'Driver', radio: 'Radio op. / bow MG',
};

export interface ArmourEntry {
  plate: string;
  mm: number;
  /** from vertical; text where the plate is curved / cast */
  angle: number | string;
  material: 'RHA' | 'CHA' | 'HHA' | 'MILD';
  cite: Cite;
}

export interface VehicleSpec {
  id: string;
  name: string;
  short: string;
  nation: Nation;
  cls: 'light' | 'medium' | 'heavy' | 'td';
  year: number;
  /** battle rating used to match opponents in skirmish */
  br: number;
  crew: CrewRole[];
  massT: CitedValue;
  engine: string;
  enginePowerKw: CitedValue;
  fuel: 'gasoline' | 'diesel';
  transmission: string;
  steering: string;
  maxSpeedKmh: CitedValue;
  offroadKmh: CitedValue;
  reverseKmh: CitedValue;
  turnRadiusM: CitedValue;
  traverseDegS: CitedValue;
  manualTraverseDegS: CitedValue;
  elevationRateDegS: CitedValue;
  elevation: CitedValue<[number, number]>;
  gun: string;
  ammoCapacity: CitedValue;
  /** rounds reachable by the loader without digging into hull stowage */
  readyRack: number;
  defaultLoadout: Record<string, number>;
  /** loading cycle (s) from the ready rack / from hull stowage with a trained loader */
  loadCycleS: CitedValue<[number, number]>;
  mgs: { coax?: string; bow?: string; aa?: string };
  stabilizer?: CitedValue<string>;
  dims: {
    lengthHull: CitedValue; lengthGun: CitedValue; width: CitedValue; height: CitedValue;
    groundClearance: CitedValue; trackWidth: CitedValue;
  };
  armour: ArmourEntry[];
  history: string[];
  /** model in-game: 'playable' (full armour/geometry/components) or 'planned' (tech-tree entry only) */
  status: 'playable' | 'planned';
}

const A = (plate: string, mm: number, angle: number | string, material: ArmourEntry['material'], c: Cite): ArmourEntry => ({ plate, mm, angle, material, cite: c });

export const VEHICLES: Record<string, VehicleSpec> = {
  m4a3_75w: {
    id: 'm4a3_75w', name: 'Medium Tank M4A3(75)W', short: 'M4A3(75)W Sherman', nation: 'USA', cls: 'medium', year: 1944, br: 3.7,
    crew: ['commander', 'gunner', 'loader', 'driver', 'radio'],
    massT: cite(31.0, 'interpreted', ['HUNNICUTT', 'WIKI_SHERMAN'], 'sources give 30.3–31.6 t combat weight for the M4A3(75)W'),
    engine: 'Ford GAA V-8 (gasoline)',
    enginePowerKw: cite(336, 'verified', ['WIKI_SHERMAN'], '450 hp gross at 2,600 rpm'),
    fuel: 'gasoline',
    transmission: 'Spicer synchromesh, 5 forward / 1 reverse',
    steering: 'Controlled differential (cannot pivot in place)',
    maxSpeedKmh: cite(42, 'interpreted', ['HUNNICUTT', 'WIKI_SHERMAN'], '26 mph governed'),
    offroadKmh: cite(25, 'interpreted', ['WIKI_SHERMAN'], 'family range 15–20 mph off-road'),
    reverseKmh: cite(5, 'interpreted', ['SHERMANTANK_POWERTRAIN'], '≈3 mph: low 5.65:1 reverse ratio chosen so the tank could back up slopes; the M4E6 trials transmission added fast reverse'),
    turnRadiusM: cite(9.4, 'interpreted', ['HUNNICUTT'], '62 ft turning circle'),
    traverseDegS: cite(24, 'interpreted', ['HUNNICUTT'], 'Oilgear / Westinghouse hydraulic traverse: 360° in ≈15 s'),
    manualTraverseDegS: cite(4, 'estimated', ['GAME']),
    elevationRateDegS: cite(4, 'estimated', ['GAME']),
    elevation: cite<[number, number]>([-10, 25], 'interpreted', ['TM9_759', 'HUNNICUTT'], 'M34A1 mount'),
    gun: 'us75m3',
    ammoCapacity: cite(104, 'verified', ['TM9_759', 'HUNNICUTT'], 'wet stowage'),
    readyRack: 8,
    defaultLoadout: { m61: 50, m48: 40, m72: 6, m89: 8 },
    loadCycleS: cite<[number, number]>([3.0, 5.0], 'interpreted', ['WIKI_75M3'], 'from the documented 12–20 rpm practical rate'),
    mgs: { coax: 'm1919', bow: 'm1919', aa: 'm2hb' },
    stabilizer: cite('Westinghouse gyrostabilizer (elevation only)', 'verified', ['HUNNICUTT'], 'fitted to M4-series guns; many crews did not use it'),
    dims: {
      lengthHull: cite(5.89, 'verified', ['TM9_759']), lengthGun: cite(6.27, 'verified', ['TM9_759']),
      width: cite(2.62, 'verified', ['TM9_759']), height: cite(2.74, 'verified', ['TM9_759'], 'to turret roof; 2.94 m over the cupola'),
      groundClearance: cite(0.43, 'verified', ['TM9_759']), trackWidth: cite(0.42, 'verified', ['TM9_759'], '16.56 in T48 track'),
    },
    armour: [
      A('Upper glacis (one-piece)', 63.5, 47, 'RHA', { prov: 'verified', src: ['TM9_759', 'HUNNICUTT'] }),
      A('Lower nose (cast final-drive housing)', 108, 'curved, 51–108 mm', 'CHA', { prov: 'verified', src: ['HUNNICUTT'] }),
      A('Hull sides', 38, 0, 'RHA', { prov: 'verified', src: ['TM9_759'] }),
      A('Hull rear', 38, '10–20°', 'RHA', { prov: 'verified', src: ['TM9_759'] }),
      A('Hull roof', 19, 90, 'RHA', { prov: 'verified', src: ['TM9_759'] }),
      A('Engine deck', 13, 90, 'RHA', { prov: 'verified', src: ['TM9_759'] }),
      A('Turret front', 76, '≈30° (cast)', 'CHA', { prov: 'verified', src: ['HUNNICUTT'] }),
      A('Gun mantlet (M34A1 rotor shield)', 89, 'curved', 'CHA', { prov: 'verified', src: ['HUNNICUTT'] }),
      A('Turret sides / rear', 51, 5, 'CHA', { prov: 'verified', src: ['HUNNICUTT'] }),
      A('Turret roof', 25, 90, 'RHA', { prov: 'verified', src: ['HUNNICUTT'] }),
    ],
    history: [
      'Ford GAA-powered Sherman. The (75)W standard of 1944 combined the one-piece 47° glacis with "wet" ammunition stowage: the main-gun rounds sat in water-jacketed bins in the hull floor, which sharply reduced fires after penetration.',
      'The standard US medium tank in Normandy. Its 75 mm M3 fired an excellent HE shell but struggled against the Panther and Tiger frontally.',
    ],
    status: 'playable',
  },

  pz4h: {
    id: 'pz4h', name: 'Panzerkampfwagen IV Ausf. H', short: 'Pz.Kpfw. IV Ausf. H', nation: 'GER', cls: 'medium', year: 1943, br: 3.7,
    crew: ['commander', 'gunner', 'loader', 'driver', 'radio'],
    massT: cite(25.0, 'verified', ['WIKI_PZIV', 'TANKENC_PZIVH']),
    engine: 'Maybach HL 120 TRM V-12 (gasoline)',
    enginePowerKw: cite(220, 'verified', ['WIKI_PZIV'], '300 PS at 3,000 rpm; 265 PS at the governed 2,600 rpm (Panzerworld)'),
    fuel: 'gasoline',
    transmission: 'ZF SSG 77, 6 forward / 1 reverse',
    steering: 'Clutch-brake (Wilson-type epicyclic)',
    maxSpeedKmh: cite(38, 'verified', ['TANKENC_PZIVH', 'WIKI_PZIV'], 'Wikipedia gives 38–42 km/h; 25 km/h sustained road speed'),
    offroadKmh: cite(16, 'verified', ['WIKI_PZIV'], 'tanks-encyclopedia gives 25 km/h cross-country'),
    reverseKmh: cite(5, 'estimated', ['GAME'], 'reverse gear speed not yet sourced'),
    turnRadiusM: cite(5.9, 'estimated', ['GAME'], 'not yet sourced'),
    traverseDegS: cite(16, 'interpreted', ['PANZERWORLD_PZIV'], 'electric traverse, DKW ZW 500 generator: up to 16°/s, 360° in ≈22.5 s (D 653/8)'),
    manualTraverseDegS: cite(3, 'interpreted', ['PANZERWORLD_PZIV'], '1.89° per handwheel turn, ≈1.5 turns/s'),
    elevationRateDegS: cite(4, 'estimated', ['GAME']),
    elevation: cite<[number, number]>([-8, 20], 'interpreted', ['WIKI_KWK40', 'JENTZ_PT4'], 'sources give −8° to −10° depression'),
    gun: 'kwk40l48',
    ammoCapacity: cite(87, 'verified', ['WIKI_PZIV', 'TANKENC_PZIVH']),
    readyRack: 6,
    defaultLoadout: { pzgr39_kwk40: 44, sprgr34: 34, pzgr40_kwk40: 3, gr38hlc: 4, nbgr_kwk40: 2 },
    loadCycleS: cite<[number, number]>([4.0, 6.0], 'interpreted', ['WIKI_KWK40'], 'from the documented 10–15 rpm'),
    mgs: { coax: 'mg34', bow: 'mg34' },
    dims: {
      lengthHull: cite(5.92, 'verified', ['WIKI_PZIV']), lengthGun: cite(7.02, 'verified', ['WIKI_PZIV', 'TANKENC_PZIVH']),
      width: cite(2.88, 'verified', ['WIKI_PZIV'], '3.29 m with Schürzen'), height: cite(2.68, 'verified', ['WIKI_PZIV']),
      groundClearance: cite(0.40, 'interpreted', ['JENTZ_PT4']), trackWidth: cite(0.40, 'interpreted', ['JENTZ_PT4']),
    },
    armour: [
      A('Nose plate (Bug)', 80, 14, 'RHA', { prov: 'interpreted', src: ['WIKI_PZIV', 'WT_WIKI'], note: '80 mm verified; angle 12–14° by source' }),
      A('Glacis (brake access)', 20, 72, 'RHA', { prov: 'interpreted', src: ['WT_WIKI', 'JENTZ_PT4'], note: '20–25 mm by source' }),
      A('Lower nose', 20, 60, 'RHA', { prov: 'estimated', src: ['GAME'], note: 'not yet sourced' }),
      A('Driver\'s front plate', 80, 10, 'RHA', { prov: 'verified', src: ['TANKENC_PZIVH', 'WIKI_PZIV'], note: 'single 80 mm plate on later Ausf. H' }),
      A('Hull & superstructure sides', 30, 0, 'RHA', { prov: 'verified', src: ['WIKI_PZIV'] }),
      A('Hull rear', 20, '10–20°', 'RHA', { prov: 'verified', src: ['WIKI_PZIV'] }),
      A('Hull roof / floor', 10, 90, 'RHA', { prov: 'verified', src: ['WIKI_PZIV'] }),
      A('Turret front', 50, 11, 'RHA', { prov: 'verified', src: ['WIKI_PZIV'] }),
      A('Gun mantlet', 50, 'curved', 'RHA', { prov: 'interpreted', src: ['WT_WIKI', 'JENTZ_PT4'] }),
      A('Turret sides', 30, 25, 'RHA', { prov: 'verified', src: ['WIKI_PZIV'], note: 'angle 23–26° by source' }),
      A('Turret rear', 30, 15, 'RHA', { prov: 'verified', src: ['WIKI_PZIV'] }),
      A('Turret roof', 16, 90, 'RHA', { prov: 'interpreted', src: ['WIKI_PZIV'], note: 'infobox 10 mm; text: 16 and 25 mm roof segments on the H' }),
      A('Schürzen (hull / turret)', 5, 0, 'MILD', { prov: 'verified', src: ['WIKI_PZIV', 'TANKENC_PZIVH'], note: '5 mm hull, 8 mm turret skirts' }),
    ],
    history: [
      'The most-produced Panzer IV variant (1943–44). Single 80 mm front plates, the long 7.5 cm KwK 40 L/48, Schürzen side skirts and, from late 1943, Zimmerit anti-magnetic paste.',
      'Fuel tanks sat beneath the fighting-compartment floor and ammunition in the hull sides: penetrations of the thin side armour frequently led to fires.',
    ],
    status: 'playable',
  },
};

export function vehicle(id: string): VehicleSpec {
  const v = VEHICLES[id];
  if (!v) throw new Error(`unknown vehicle ${id}`);
  return v;
}
