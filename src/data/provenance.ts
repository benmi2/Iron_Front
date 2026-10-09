/**
 * Every historical number in the game carries a provenance tag and the sources it came from.
 *
 *  verified      — stated directly by a cited reference (and consistent across references)
 *  interpreted   — derived from cited references (unit conversion, reading a drawing, choosing
 *                  between disagreeing sources); the note says how
 *  estimated     — no reference found yet; a reasoned estimate, flagged in the UI
 *  approximation — a simulation model parameter (e.g. material factor, fit exponent), not a
 *                  historical fact at all
 */
export type Prov = 'verified' | 'interpreted' | 'estimated' | 'approximation';

export interface Cite {
  prov: Prov;
  src: SourceId[];
  note?: string;
}

export interface CitedValue<T = number> extends Cite {
  value: T;
}

export const cite = <T>(value: T, prov: Prov, src: SourceId[], note?: string): CitedValue<T> => ({ value, prov, src, note });

export const SOURCES = {
  TM9_759: 'US War Department, TM 9-759 Medium Tank M4A3 (1944) — dimensions & armour schedule',
  TM9_1907: 'US War Department, TM 9-1907 Ballistic Data, Performance of Ammunition (1948) — via Wikipedia tables',
  HUNNICUTT: 'R. P. Hunnicutt, "Sherman: A History of the American Medium Tank" (1978)',
  WIKI_75M3: 'Wikipedia, "75 mm gun M2/M3/M6" — ammunition list and US 30° / estimated 90° penetration tables',
  WIKI_SHERMAN: 'Wikipedia, "M4 Sherman" — engine, crew, transmission',
  BIRD_LIVINGSTON: 'L. Bird & R. Livingston, "WWII Ballistics: Armor and Gunnery" (2001)',
  JENTZ_PT4: 'T. Jentz & H. Doyle, "Panzer Tracts No. 4 — Panzerkampfwagen IV"',
  WIKI_PZIV: 'Wikipedia, "Panzer IV" — specifications Pz. IV Ausf. H (1943)',
  TANKENC_PZIVH: 'tanks-encyclopedia.com, "Panzer IV Ausf. H"',
  PANZERWORLD_PZIV: 'panzerworld.com, "Pz.Kpfw. IV" — traverse data citing Heereswaffenamt D 653/8',
  WIKI_KWK40: 'Wikipedia, "7.5 cm KwK 40" — German 30° penetration table, projectile data',
  WIKI_KWK36: 'Wikipedia, "8.8 cm KwK 36" — penetration table',
  WIKI_KWK42: 'Wikipedia, "7.5 cm KwK 42" — penetration table',
  WIKI_76M1: 'Wikipedia, "76 mm gun M1" — ammunition and penetration tables',
  WIKI_ZIS53: 'Wikipedia, "85 mm air defense gun M1939 (52-K)" / ZiS-S-53 ammunition tables',
  WT_WIKI: 'War Thunder wiki armour layout (a GAME model — used only to cross-check plate angles, never as a sole source)',
  BALLAB: 'Ballistic Armour Lab (the developer\'s own simulator) — fitted drag/penetration parameters',
  FM5_250: 'US Army FM 5-250 Explosives and Demolitions — steel-cutting rule P = 3/8·A',
  FM23_5: 'US Army FM 23-5 U.S. Rifle Cal. .30 M1 (1943)',
  TM9_294: 'US War Department, TM 9-294 2.36-inch AT Rocket Launcher M9 (1943)',
  GERMAN_MERKBLATT: 'German Merkblatt / training pamphlets for Panzerfaust & Panzerschreck (as summarised in Wikipedia)',
  WIKI_SMALLARMS: 'Wikipedia articles of the individual small arms (M1 Garand, Kar98k, MP 40, M1 Thompson, BAR, MG 42)',
  SHERMANTANK_M3: 'theshermantank.com, "M3 gun Data" (extract of 1944 firing tables FT 75-H-3 / ammunition weights)',
  WIKI_BAZOOKA: 'Wikipedia, "Bazooka" — M1A1 / M9 launchers, M6A1 / M6A3 rockets',
  WIKI_PANZERFAUST: 'Wikipedia, "Panzerfaust" and "Panzerschreck"',
  SHERMANTANK_POWERTRAIN: 'theshermantank.com, "The transmission, differential and final drives" + summaries of the 5.65:1 reverse ratio (≈3 mph reverse)',
  GAME: 'Game design abstraction (not a historical claim)',
} as const;

export type SourceId = keyof typeof SOURCES;

export const PROV_LABEL: Record<Prov, string> = {
  verified: 'Verified',
  interpreted: 'Interpreted',
  estimated: 'Estimated',
  approximation: 'Sim. approximation',
};

export const PROV_COLOR: Record<Prov, string> = {
  verified: '#7fc97f',
  interpreted: '#c9c27f',
  estimated: '#e09a5a',
  approximation: '#8fa8c8',
};
