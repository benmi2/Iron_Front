import { cite, type CitedValue } from './provenance';

/**
 * Infantry weapons (1944, Normandy). Ballistic figures from the cited references; fire rates are
 * practical aimed rates used for game pacing (labelled 'interpreted').
 */

export type HoldStyle = 'rifle' | 'smg' | 'mg' | 'tube' | 'faust' | 'pistol';

export interface SmallArm {
  id: string;
  name: string;
  nation: 'USA' | 'GER';
  kind: 'rifle' | 'smg' | 'lmg' | 'at' | 'pistol' | 'carbine';
  hold: HoldStyle;
  caliber: string;
  muzzleVelocity: CitedValue;
  bulletMassG: number;
  magazine: number;
  /** seconds between shots (aimed, semi/bolt) or 60/cyclic for automatics */
  interval: CitedValue;
  auto: boolean;
  reloadS: number;
  /** effective range (m) the AI engages at */
  rangeM: number;
  /** 1σ dispersion (mrad) standing / supported */
  spreadMil: number;
  /** AT launchers fire this ammo id (data/ammo.ts) */
  rocket?: string;
  /** launchers: rounds carried by the team */
  rounds?: number;
  art: string;
}

export const SMALL_ARMS: Record<string, SmallArm> = {
  garand: {
    id: 'garand', name: 'M1 Garand', nation: 'USA', kind: 'rifle', hold: 'rifle', caliber: '.30-06 M2 ball',
    muzzleVelocity: cite(853, 'verified', ['WIKI_SMALLARMS', 'FM23_5'], '2,800 ft/s'), bulletMassG: 9.7, magazine: 8,
    interval: cite(0.45, 'interpreted', ['FM23_5'], 'aimed semi-automatic fire'), auto: false, reloadS: 2.6, rangeM: 400, spreadMil: 1.4, art: 'garand',
  },
  thompson: {
    id: 'thompson', name: 'Thompson M1A1', nation: 'USA', kind: 'smg', hold: 'smg', caliber: '.45 ACP',
    muzzleVelocity: cite(285, 'verified', ['WIKI_SMALLARMS']), bulletMassG: 14.9, magazine: 30,
    interval: cite(60 / 700, 'verified', ['WIKI_SMALLARMS'], '600–700 rpm cyclic'), auto: true, reloadS: 3.0, rangeM: 120, spreadMil: 9, art: 'thompson',
  },
  bar: {
    id: 'bar', name: 'M1918A2 BAR', nation: 'USA', kind: 'lmg', hold: 'rifle', caliber: '.30-06 M2 ball',
    muzzleVelocity: cite(860, 'verified', ['WIKI_SMALLARMS']), bulletMassG: 9.7, magazine: 20,
    interval: cite(60 / 450, 'verified', ['WIKI_SMALLARMS'], 'slow rate 300–450 rpm'), auto: true, reloadS: 3.2, rangeM: 500, spreadMil: 5, art: 'bar',
  },
  carbine: {
    id: 'carbine', name: 'M1 Carbine', nation: 'USA', kind: 'carbine', hold: 'rifle', caliber: '.30 Carbine',
    muzzleVelocity: cite(607, 'verified', ['WIKI_SMALLARMS']), bulletMassG: 7.1, magazine: 15,
    interval: cite(0.35, 'interpreted', ['WIKI_SMALLARMS']), auto: false, reloadS: 2.2, rangeM: 250, spreadMil: 2.2, art: 'carbine',
  },
  bazooka: {
    id: 'bazooka', name: 'Bazooka M1A1', nation: 'USA', kind: 'at', hold: 'tube', caliber: '2.36 in rocket M6A1',
    muzzleVelocity: cite(82, 'interpreted', ['WIKI_BAZOOKA']), bulletMassG: 1590, magazine: 1,
    interval: cite(1, 'interpreted', ['GAME']), auto: false, reloadS: 4.5, rangeM: 130, spreadMil: 9, rocket: 'm6a1', rounds: 6, art: 'bazooka',
  },
  kar98k: {
    id: 'kar98k', name: 'Karabiner 98k', nation: 'GER', kind: 'rifle', hold: 'rifle', caliber: '7.92×57 mm sS',
    muzzleVelocity: cite(760, 'verified', ['WIKI_SMALLARMS']), bulletMassG: 12.8, magazine: 5,
    interval: cite(1.5, 'interpreted', ['WIKI_SMALLARMS'], 'bolt action, aimed fire'), auto: false, reloadS: 3.2, rangeM: 450, spreadMil: 1.2, art: 'kar98k',
  },
  mp40: {
    id: 'mp40', name: 'MP 40', nation: 'GER', kind: 'smg', hold: 'smg', caliber: '9×19 mm',
    muzzleVelocity: cite(400, 'verified', ['WIKI_SMALLARMS']), bulletMassG: 8.0, magazine: 32,
    interval: cite(60 / 550, 'verified', ['WIKI_SMALLARMS'], '500–550 rpm'), auto: true, reloadS: 3.0, rangeM: 120, spreadMil: 8, art: 'mp40',
  },
  mg42: {
    id: 'mg42', name: 'MG 42', nation: 'GER', kind: 'lmg', hold: 'mg', caliber: '7.92×57 mm sS',
    muzzleVelocity: cite(740, 'verified', ['WIKI_SMALLARMS']), bulletMassG: 12.8, magazine: 50,
    interval: cite(60 / 1200, 'verified', ['WIKI_SMALLARMS'], '≈1,200 rpm cyclic'), auto: true, reloadS: 6, rangeM: 600, spreadMil: 6, art: 'mg42',
  },
  panzerschreck: {
    id: 'panzerschreck', name: 'Panzerschreck RPzB 54', nation: 'GER', kind: 'at', hold: 'tube', caliber: '8.8 cm rocket',
    muzzleVelocity: cite(110, 'interpreted', ['WIKI_PANZERFAUST']), bulletMassG: 3250, magazine: 1,
    interval: cite(1, 'interpreted', ['GAME']), auto: false, reloadS: 4.5, rangeM: 150, spreadMil: 8, rocket: 'rpzbgr4322', rounds: 5, art: 'panzerschreck',
  },
  panzerfaust: {
    id: 'panzerfaust', name: 'Panzerfaust 60', nation: 'GER', kind: 'at', hold: 'faust', caliber: '149 mm HEAT bomb',
    muzzleVelocity: cite(45, 'interpreted', ['WIKI_PANZERFAUST']), bulletMassG: 3000, magazine: 1,
    interval: cite(1, 'interpreted', ['GAME']), auto: false, reloadS: 0, rangeM: 60, spreadMil: 14, rocket: 'pf60', rounds: 1, art: 'panzerfaust',
  },
  p38: {
    id: 'p38', name: 'Walther P38', nation: 'GER', kind: 'pistol', hold: 'pistol', caliber: '9×19 mm',
    muzzleVelocity: cite(365, 'verified', ['WIKI_SMALLARMS']), bulletMassG: 8.0, magazine: 8,
    interval: cite(0.4, 'interpreted', ['GAME']), auto: false, reloadS: 2, rangeM: 40, spreadMil: 12, art: 'pistol',
  },
  m1911: {
    id: 'm1911', name: 'M1911A1', nation: 'USA', kind: 'pistol', hold: 'pistol', caliber: '.45 ACP',
    muzzleVelocity: cite(253, 'verified', ['WIKI_SMALLARMS']), bulletMassG: 14.9, magazine: 7,
    interval: cite(0.4, 'interpreted', ['GAME']), auto: false, reloadS: 2, rangeM: 40, spreadMil: 12, art: 'pistol',
  },
};

export interface GrenadeDef {
  id: string;
  name: string;
  fillerKg: number;
  fuseS: number;
  throwM: number;
  smoke?: boolean;
  /** fragmenting body (Mk 2) vs blast (M24) */
  frag: number;
}

export const GRENADES: Record<string, GrenadeDef> = {
  mk2: { id: 'mk2', name: 'Mk 2 frag', fillerKg: 0.057, fuseS: 4.5, throwM: 30, frag: 1 },
  m24: { id: 'm24', name: 'Stielhandgranate 24', fillerKg: 0.165, fuseS: 4.5, throwM: 38, frag: 0.35 },
  smoke_us: { id: 'smoke_us', name: 'AN-M8 HC smoke', fillerKg: 0, fuseS: 1.5, throwM: 25, smoke: true, frag: 0 },
  smoke_de: { id: 'smoke_de', name: 'NbHgr 39 smoke', fillerKg: 0, fuseS: 5, throwM: 30, smoke: true, frag: 0 },
};
