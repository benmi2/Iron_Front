import { cite, type CitedValue } from './provenance';

export interface GunDef {
  id: string;
  name: string;
  caliberMm: number;
  /** barrel length in calibres */
  lengthCal: number;
  /** intrinsic dispersion (1σ, mils = mrad) — the gun alone, before crew error */
  dispersionMil: CitedValue;
  /** documented practical rate of fire (rounds per minute), used to derive the loading cycle */
  rofRpm: CitedValue<[number, number]>;
  ammo: string[];
  /** report loudness/size for audio & effects */
  blast: number;
}

export const GUNS: Record<string, GunDef> = {
  us75m3: {
    id: 'us75m3', name: '75 mm Gun M3 (L/40)', caliberMm: 75, lengthCal: 40,
    dispersionMil: cite(0.4, 'estimated', ['GAME'], 'no period dispersion figure found; crew ranging error dominates in play'),
    rofRpm: cite<[number, number]>([12, 20], 'interpreted', ['WIKI_75M3'], 'maximum rate 20 rpm'),
    ammo: ['m61', 'm72', 'm48', 'm89'], blast: 1.0,
  },
  kwk40l48: {
    id: 'kwk40l48', name: '7.5 cm KwK 40 L/48', caliberMm: 75, lengthCal: 48,
    dispersionMil: cite(0.35, 'estimated', ['GAME'], 'no period dispersion figure found'),
    rofRpm: cite<[number, number]>([10, 15], 'verified', ['WIKI_KWK40']),
    ammo: ['pzgr39_kwk40', 'pzgr40_kwk40', 'gr38hlc', 'sprgr34', 'nbgr_kwk40'], blast: 1.1,
  },
  kwk36: {
    id: 'kwk36', name: '8.8 cm KwK 36 L/56', caliberMm: 88, lengthCal: 56,
    dispersionMil: cite(0.3, 'estimated', ['GAME']),
    rofRpm: cite<[number, number]>([6, 8], 'interpreted', ['WIKI_KWK36']),
    ammo: ['pzgr39_kwk36'], blast: 1.35,
  },
  kwk42: {
    id: 'kwk42', name: '7.5 cm KwK 42 L/70', caliberMm: 75, lengthCal: 70,
    dispersionMil: cite(0.3, 'estimated', ['GAME']),
    rofRpm: cite<[number, number]>([6, 10], 'interpreted', ['WIKI_KWK42']),
    ammo: ['pzgr39_42'], blast: 1.3,
  },
};
