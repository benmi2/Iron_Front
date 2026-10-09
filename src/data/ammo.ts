import { cite, type Cite, type CitedValue } from './provenance';

/**
 * Historical ammunition database.
 *
 * KINETIC rounds store the documented penetration TABLE (range, plate angle, criterion, source).
 * At load time `ballistics/PenCurve.ts` flies the round through the same drag model the game uses,
 * pairs every table range with its striking velocity and builds a penetration-vs-velocity curve.
 * Nothing is scaled from a single "pen value": the curve IS the documented table.
 *
 * dragCd values were fitted (scratch script fitcd.mjs, 2026-10-09) so that de Marre scaling
 * (P ∝ v^1.43, APCR v^1.65) reproduces the slope of each documented table; the fits agree with
 * Ballistic Armour Lab's independent fits to the same tables (M72 0.545 vs 0.55, Pzgr.39 0.44 vs 0.44).
 */

export type AmmoClass = 'AP' | 'APC' | 'APCBC' | 'APHE' | 'APCR' | 'HE' | 'HEAT' | 'SMOKE';

export const CLASS_LABEL: Record<AmmoClass, string> = {
  AP: 'AP', APC: 'APC', APCBC: 'APCBC', APHE: 'APHE', APCR: 'APCR', HE: 'HE', HEAT: 'HEAT', SMOKE: 'Smoke',
};

export const CLASS_DESC: Record<AmmoClass, string> = {
  AP: 'Uncapped solid steel shot. Prone to shatter against thick plate at high velocity.',
  APC: 'Armour-piercing, capped: the cap protects the nose; most M61 were issued without filler (solid shot).',
  APCBC: 'Capped with a ballistic windscreen; small HE filler with base fuze bursts behind the plate.',
  APHE: 'Armour-piercing with HE filler and base delay fuze.',
  APCR: 'Light body around a tungsten-carbide core: very fast but loses velocity quickly and suffers at obliquity.',
  HE: 'High-explosive shell: blast and fragments. Breaches only thin plate; deadly to infantry and guns.',
  HEAT: 'Shaped charge: penetration does not depend on range or velocity.',
  SMOKE: 'Smoke screen: blocks observation for both sides.',
};

export type Nation = 'USA' | 'GER' | 'USSR' | 'UK';

export interface PenTable {
  /** plate obliquity of the test (0 = normal impact) */
  angleDeg: number;
  rangesM: number[];
  mm: number[];
  /** test standard / acceptance criterion */
  criterion: string;
  cite: Cite;
}

export interface AmmoDef {
  id: string;
  /** short name for the HUD */
  name: string;
  /** full period designation */
  designation: string;
  cls: AmmoClass;
  gun: string;
  nation: Nation;
  caliberMm: number;
  massKg: CitedValue;
  muzzleVelocity: CitedValue;
  dragCd: CitedValue;
  /** documented table the penetration curve is built from (kinetic rounds) */
  pen?: PenTable;
  /** further documented tables, shown in the garage / firing range for comparison */
  penOther?: PenTable[];
  /** de Marre velocity exponent for extrapolating beyond the table */
  velocityExponent?: number;
  /** obliquity exponent k: T_eff = T_los · sec(θ)^(k−1)  (Ballistic Lab model) */
  obliquityExponent?: number;
  /** critical ricochet obliquity (deg) before overmatch correction */
  ricochetDeg: number;
  nose: 'pointed' | 'ogive' | 'blunt';
  capped: boolean;
  /** diameter / mass of the part that actually penetrates (APCR core) */
  penetratorDiameterMm: number;
  penetratorMassKg: number;
  /** HE filler of an AP shell (APHE / APCBC-HE) with base fuze */
  filler?: { kg: number; type: string; fuzeDelayS: number; cite: Cite };
  /** HE shell burst */
  he?: { fillerKg: number; type: string; tntEq: number; cite: Cite };
  /** shaped charge */
  heat?: { penMm: number; cite: Cite };
  smoke?: { radiusM: number; durationS: number; cite: Cite };
  tracer: string;
  notes: string[];
}

const AX = (n: number) => cite(n, 'approximation', ['BALLAB'], 'fitted so the drag model reproduces the documented table slope');

export const AMMO: AmmoDef[] = [
  /* ======================================================================== US 75 mm M3 (M4 Sherman) */
  {
    id: 'm61', name: 'M61 APC', designation: 'Projectile, APC, M61 (APC-HE-T)', cls: 'APC', gun: 'us75m3', nation: 'USA', caliberMm: 75,
    massKg: cite(6.63, 'verified', ['WIKI_75M3'], '14.62 lb'),
    muzzleVelocity: cite(617, 'verified', ['WIKI_75M3'], '2,024 ft/s'),
    dragCd: AX(0.3),
    pen: {
      angleDeg: 30, rangesM: [457, 914, 1372, 1829], mm: [66, 60, 55, 50], criterion: 'US Army, homogeneous plate',
      cite: { prov: 'verified', src: ['WIKI_75M3', 'TM9_1907'], note: '500/1000/1500/2000 yd' },
    },
    penOther: [{
      angleDeg: 0, rangesM: [100, 500, 1000, 1500, 2000], mm: [88, 81, 73, 65, 59], criterion: 'estimated, 50 % probability',
      cite: { prov: 'interpreted', src: ['WIKI_75M3'], note: 'the source itself labels these as estimates' },
    }],
    velocityExponent: 1.43, obliquityExponent: 1.12, ricochetDeg: 71, nose: 'blunt', capped: true,
    penetratorDiameterMm: 75, penetratorMassKg: 6.0,
    tracer: '#ff6a3a',
    notes: ['Most M61 were shipped without the Explosive D filler, so it is modelled as solid capped shot.', 'Standard Sherman 75 mm AP round in Normandy.'],
  },
  {
    id: 'm72', name: 'M72 AP', designation: 'Shot, AP, M72 (AP-T)', cls: 'AP', gun: 'us75m3', nation: 'USA', caliberMm: 75,
    massKg: cite(6.32, 'verified', ['WIKI_75M3'], '13.9 lb'),
    muzzleVelocity: cite(619, 'verified', ['WIKI_75M3'], '2,031 ft/s in the M3'),
    dragCd: AX(0.545),
    pen: {
      angleDeg: 30, rangesM: [457, 914, 1372, 1829], mm: [76, 63, 51, 43], criterion: 'US Army, homogeneous plate',
      cite: { prov: 'verified', src: ['WIKI_75M3', 'TM9_1907'] },
    },
    penOther: [{
      angleDeg: 30, rangesM: [457, 914, 1372, 1829], mm: [66, 53, 41, 33], criterion: 'US Army, face-hardened plate',
      cite: { prov: 'verified', src: ['WIKI_75M3'] },
    }],
    velocityExponent: 1.43, obliquityExponent: 1.25, ricochetDeg: 66, nose: 'pointed', capped: false,
    penetratorDiameterMm: 75, penetratorMassKg: 6.32,
    tracer: '#ff7a40',
    notes: ['Uncapped shot with poor aerodynamics: strong at short range, falls off quickly.', 'Uncapped steel shot is subject to the shatter gap against thick plate at high striking velocity.'],
  },
  {
    id: 'm48', name: 'M48 HE', designation: 'Shell, HE, M48 (supercharge)', cls: 'HE', gun: 'us75m3', nation: 'USA', caliberMm: 75,
    massKg: cite(6.76, 'verified', ['WIKI_75M3'], '14.9 lb'),
    muzzleVelocity: cite(594, 'interpreted', ['WIKI_75M3', 'BALLAB'], 'Wikipedia gives 1,950 ft/s from the M3; Ballistic Lab used 1,885 ft/s. 594 m/s kept.'),
    dragCd: cite(0.36, 'approximation', ['BALLAB']),
    he: { fillerKg: 0.68, type: 'TNT', tntEq: 1, cite: { prov: 'verified', src: ['WIKI_75M3'], note: '1.5 lb TNT' } },
    ricochetDeg: 85, nose: 'ogive', capped: false, penetratorDiameterMm: 75, penetratorMassKg: 6.76,
    tracer: '#ffb060',
    notes: ['Super-quick fuze (standard). Delay setting existed for structures.'],
  },
  {
    id: 'm89', name: 'M89 Smoke', designation: 'Shell, Smoke, HC, B.E., M89', cls: 'SMOKE', gun: 'us75m3', nation: 'USA', caliberMm: 75,
    massKg: cite(3.0, 'verified', ['SHERMANTANK_M3'], '6.61 lb loaded projectile'),
    muzzleVelocity: cite(259, 'verified', ['SHERMANTANK_M3'], '850 ft/s from the M3'),
    dragCd: cite(0.4, 'approximation', ['GAME']),
    smoke: { radiusM: 9, durationS: 50, cite: { prov: 'estimated', src: ['GAME'], note: 'screen size/duration are a gameplay estimate; 1.36 kg HC filler is documented' } },
    ricochetDeg: 88, nose: 'ogive', capped: false, penetratorDiameterMm: 75, penetratorMassKg: 3.0,
    tracer: '#c8c8c8',
    notes: ['Base-ejection hexachloroethane smoke canister (3.03 lb HC).'],
  },

  /* ======================================================================== German 7.5 cm KwK 40 L/48 (Pz IV H) */
  {
    id: 'pzgr39_kwk40', name: 'Pzgr. 39', designation: '7.5 cm Pzgr. Patr. 39 KwK 40 (APCBC-HE-T)', cls: 'APCBC', gun: 'kwk40l48', nation: 'GER', caliberMm: 75,
    massKg: cite(6.8, 'verified', ['WIKI_KWK40', 'JENTZ_PT4']),
    muzzleVelocity: cite(750, 'verified', ['WIKI_KWK40', 'JENTZ_PT4'], 'L/48; 740 m/s from the L/43'),
    dragCd: AX(0.44),
    pen: {
      angleDeg: 30, rangesM: [100, 500, 1000, 1500, 2000], mm: [106, 96, 85, 74, 64], criterion: 'German acceptance, RHA at 30°',
      cite: { prov: 'verified', src: ['WIKI_KWK40', 'JENTZ_PT4'] },
    },
    penOther: [{
      angleDeg: 0, rangesM: [100, 500, 1000, 1500, 2000], mm: [135, 123, 109, 97, 86], criterion: 'calculated, 50 % criterion',
      cite: { prov: 'interpreted', src: ['WIKI_KWK40'], note: 'calculated values, not trial data' },
    }],
    velocityExponent: 1.43, obliquityExponent: 1.12, ricochetDeg: 71, nose: 'blunt', capped: true,
    penetratorDiameterMm: 75, penetratorMassKg: 6.0,
    filler: { kg: 0.018, type: 'PETN/wax', fuzeDelayS: 0.0016, cite: { prov: 'interpreted', src: ['BALLAB', 'BIRD_LIVINGSTON'], note: '≈18 g burster, Bd.Z. base fuze' } },
    tracer: '#ff5030',
    notes: ['Capped, ballistic cap, small explosive filler that bursts behind the plate.'],
  },
  {
    id: 'pzgr40_kwk40', name: 'Pzgr. 40', designation: '7.5 cm Pzgr. Patr. 40 KwK 40 (APCR)', cls: 'APCR', gun: 'kwk40l48', nation: 'GER', caliberMm: 75,
    massKg: cite(4.1, 'verified', ['WIKI_KWK40']),
    muzzleVelocity: cite(930, 'verified', ['WIKI_KWK40'], 'L/48'),
    dragCd: AX(0.425),
    pen: {
      angleDeg: 30, rangesM: [100, 500, 1000, 1500], mm: [143, 120, 97, 77], criterion: 'German acceptance, RHA at 30°',
      cite: { prov: 'verified', src: ['WIKI_KWK40', 'JENTZ_PT4'] },
    },
    velocityExponent: 1.65, obliquityExponent: 1.6, ricochetDeg: 60, nose: 'ogive', capped: false,
    penetratorDiameterMm: 30, penetratorMassKg: 0.95,
    tracer: '#ff4040',
    notes: ['Tungsten was scarce: a few rounds per tank at most by 1944.', 'Sub-calibre core performs poorly against sloped plate.'],
  },
  {
    id: 'gr38hlc', name: 'Gr. 38 Hl/C', designation: '7.5 cm Gr. Patr. 38 Hl/C KwK 40 (HEAT)', cls: 'HEAT', gun: 'kwk40l48', nation: 'GER', caliberMm: 75,
    massKg: cite(4.8, 'interpreted', ['BALLAB', 'WIKI_KWK40'], 'Hl/B listed at 5 kg; Hl/C ≈4.5–4.8 kg'),
    muzzleVelocity: cite(450, 'verified', ['WIKI_KWK40']),
    dragCd: cite(0.36, 'approximation', ['BALLAB']),
    heat: { penMm: 115, cite: { prov: 'interpreted', src: ['WIKI_KWK40', 'BALLAB'], note: '100 mm at 30° in the German table (≈115 mm line of sight); 115 mm quoted at normal' } },
    ricochetDeg: 78, nose: 'ogive', capped: false, penetratorDiameterMm: 75, penetratorMassKg: 4.8,
    tracer: '#ff9a4a',
    notes: ['Spin from the rifled barrel degrades the jet; penetration is independent of range.'],
  },
  {
    id: 'sprgr34', name: 'Sprgr. 34', designation: '7.5 cm Sprgr. Patr. 34 KwK 40 (HE)', cls: 'HE', gun: 'kwk40l48', nation: 'GER', caliberMm: 75,
    massKg: cite(5.74, 'interpreted', ['BALLAB', 'JENTZ_PT4'], 'Wikipedia lists 4.42 kg — sources disagree; 5.74 kg used'),
    muzzleVelocity: cite(550, 'verified', ['WIKI_KWK40']),
    dragCd: cite(0.36, 'approximation', ['BALLAB']),
    he: { fillerKg: 0.686, type: 'amatol', tntEq: 1.0, cite: { prov: 'interpreted', src: ['BALLAB'], note: '0.69 kg amatol' } },
    ricochetDeg: 85, nose: 'ogive', capped: false, penetratorDiameterMm: 75, penetratorMassKg: 5.74,
    tracer: '#ffb060',
    notes: ['AZ 23 nose fuze set to instantaneous.'],
  },
  {
    id: 'nbgr_kwk40', name: 'Nbgr.', designation: '7.5 cm Nebelgranate (smoke)', cls: 'SMOKE', gun: 'kwk40l48', nation: 'GER', caliberMm: 75,
    massKg: cite(6.2, 'estimated', ['WT_WIKI'], 'only a game-wiki figure was found — needs a period firing table'),
    muzzleVelocity: cite(540, 'estimated', ['WT_WIKI'], 'only a game-wiki figure was found'),
    dragCd: cite(0.38, 'approximation', ['GAME']),
    smoke: { radiusM: 9, durationS: 45, cite: { prov: 'estimated', src: ['GAME'] } },
    ricochetDeg: 88, nose: 'ogive', capped: false, penetratorDiameterMm: 75, penetratorMassKg: 6.2,
    tracer: '#c8c8c8',
    notes: ['Flagged ESTIMATED: weight and velocity not yet confirmed from a German source.'],
  },

  /* ======================================================================== Stage-3 guns (data present, vehicles not yet playable) */
  {
    id: 'pzgr39_kwk36', name: 'Pzgr. 39', designation: '8.8 cm Pzgr. Patr. 39 KwK 36 (APCBC-HE-T)', cls: 'APCBC', gun: 'kwk36', nation: 'GER', caliberMm: 88,
    massKg: cite(10.2, 'interpreted', ['WIKI_KWK36', 'BALLAB']),
    muzzleVelocity: cite(773, 'interpreted', ['WIKI_KWK36', 'BALLAB']),
    dragCd: AX(0.355),
    pen: { angleDeg: 30, rangesM: [100, 500, 1000, 1500, 2000], mm: [120, 110, 100, 91, 84], criterion: 'German acceptance, RHA at 30°', cite: { prov: 'interpreted', src: ['WIKI_KWK36', 'BALLAB'], note: 'table as recorded in Ballistic Lab; re-check before Stage 3' } },
    velocityExponent: 1.43, obliquityExponent: 1.12, ricochetDeg: 71, nose: 'blunt', capped: true,
    penetratorDiameterMm: 88, penetratorMassKg: 9.1,
    filler: { kg: 0.059, type: 'PETN/wax', fuzeDelayS: 0.0016, cite: { prov: 'interpreted', src: ['BALLAB'] } },
    tracer: '#ff5030', notes: ['Tiger I main AP round.'],
  },
  {
    id: 'pzgr39_42', name: 'Pzgr. 39/42', designation: '7.5 cm Pzgr. Patr. 39/42 KwK 42 (APCBC-HE-T)', cls: 'APCBC', gun: 'kwk42', nation: 'GER', caliberMm: 75,
    massKg: cite(6.8, 'interpreted', ['WIKI_KWK42', 'BALLAB']),
    muzzleVelocity: cite(925, 'interpreted', ['WIKI_KWK42', 'BALLAB']),
    dragCd: AX(0.43),
    pen: { angleDeg: 30, rangesM: [100, 500, 1000, 1500, 2000], mm: [138, 124, 111, 99, 89], criterion: 'German acceptance, RHA at 30°', cite: { prov: 'interpreted', src: ['WIKI_KWK42', 'BALLAB'] } },
    velocityExponent: 1.43, obliquityExponent: 1.12, ricochetDeg: 71, nose: 'blunt', capped: true,
    penetratorDiameterMm: 75, penetratorMassKg: 6.0,
    filler: { kg: 0.018, type: 'PETN/wax', fuzeDelayS: 0.0016, cite: { prov: 'interpreted', src: ['BALLAB'] } },
    tracer: '#ff5030', notes: ['Panther main AP round.'],
  },

  /* ======================================================================== Infantry anti-tank weapons */
  {
    id: 'm6a1', name: 'M6A1 rocket', designation: '2.36-in rocket M6A1 (Bazooka M1A1)', cls: 'HEAT', gun: 'bazooka', nation: 'USA', caliberMm: 60,
    massKg: cite(1.59, 'interpreted', ['WIKI_BAZOOKA'], '3.5 lb'),
    muzzleVelocity: cite(82, 'interpreted', ['WIKI_BAZOOKA', 'BALLAB'], '≈270 ft/s; motor burns out in the tube'),
    dragCd: cite(0.5, 'approximation', ['BALLAB']),
    heat: { penMm: 90, cite: { prov: 'interpreted', src: ['WIKI_BAZOOKA'], note: '3–4 in quoted; 90 mm used' } },
    ricochetDeg: 72, nose: 'ogive', capped: false, penetratorDiameterMm: 60, penetratorMassKg: 1.59,
    tracer: '#ffcf80', notes: ['Effective against moving tanks to ≈100 m.'],
  },
  {
    id: 'rpzbgr4322', name: 'RPzB.Gr. 4322', designation: '8.8 cm RPzB.Gr. 4322 (Panzerschreck)', cls: 'HEAT', gun: 'panzerschreck', nation: 'GER', caliberMm: 88,
    massKg: cite(3.25, 'interpreted', ['WIKI_PANZERFAUST', 'BALLAB']),
    muzzleVelocity: cite(110, 'interpreted', ['WIKI_PANZERFAUST', 'BALLAB']),
    dragCd: cite(0.5, 'approximation', ['BALLAB']),
    heat: { penMm: 185, cite: { prov: 'interpreted', src: ['GERMAN_MERKBLATT', 'BALLAB'], note: '160 mm at 30° in German tests (≈185 mm LoS); 200–230 mm quoted at normal' } },
    ricochetDeg: 72, nose: 'ogive', capped: false, penetratorDiameterMm: 88, penetratorMassKg: 3.25,
    tracer: '#ffcf80', notes: ['Back-blast; the gunner wore a gas mask until the shield was fitted.'],
  },
  {
    id: 'pf60', name: 'Panzerfaust 60', designation: 'Panzerfaust 60 (Faustpatrone)', cls: 'HEAT', gun: 'panzerfaust', nation: 'GER', caliberMm: 149,
    massKg: cite(3.0, 'interpreted', ['WIKI_PANZERFAUST', 'BALLAB'], 'warhead'),
    muzzleVelocity: cite(45, 'interpreted', ['WIKI_PANZERFAUST']),
    dragCd: cite(0.9, 'approximation', ['BALLAB']),
    heat: { penMm: 200, cite: { prov: 'interpreted', src: ['WIKI_PANZERFAUST'], note: '200 mm quoted' } },
    ricochetDeg: 72, nose: 'ogive', capped: false, penetratorDiameterMm: 149, penetratorMassKg: 3.0,
    tracer: '#ffcf80', notes: ['Single-shot, disposable. Effective range ≈60 m.'],
  },
];

export const AMMO_BY_ID: Record<string, AmmoDef> = Object.fromEntries(AMMO.map((a) => [a.id, a]));

export function ammo(id: string): AmmoDef {
  const a = AMMO_BY_ID[id];
  if (!a) throw new Error(`unknown ammo ${id}`);
  return a;
}

export const isKinetic = (a: AmmoDef) => a.cls === 'AP' || a.cls === 'APC' || a.cls === 'APCBC' || a.cls === 'APHE' || a.cls === 'APCR';
