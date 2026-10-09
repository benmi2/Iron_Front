import { RNG } from '../core/rng';
import type { Nation } from '../data/ammo';
import { NODE_BY_ID, TECH_TREE } from '../data/techtree';
import { UPGRADE_BY_ID } from '../data/upgrades';
import { VEHICLES } from '../data/vehicles';
import { makeCrewMember, type CrewMember } from '../vehicles/Crew';

/**
 * Persistent player progression (localStorage, versioned). Progression changes what the player
 * owns, how well the crews perform and the vehicle's maintenance state — never the physics of
 * armour or shells.
 */

export interface VehicleRecord {
  id: string;
  xp: number;
  battles: number;
  kills: number;
  upgrades: string[];
  loadout: Record<string, number>;
  /** 0..1 wear since the last overhaul (worn engines / sights) */
  wear: number;
  crew: CrewMember[];
}

export interface Profile {
  version: 2;
  name: string;
  xp: number;
  rp: number;
  requisition: number;
  researched: string[];
  owned: string[];
  vehicles: Record<string, VehicleRecord>;
  selected: Partial<Record<Nation, string>>;
  nation: 'USA' | 'GER';
  campaign: { completed: string[] };
  achievements: string[];
  stats: { battles: number; wins: number; tankKills: number; infantryKills: number; objectives: number; penetrations: number; recovered: number };
  settings: { realism: boolean; volume: number; quality: 'high' | 'medium'; hitMarkers: boolean };
}

const KEY = 'ironfront.profile';

export const RANKS: Record<'USA' | 'GER', [number, string][]> = {
  USA: [[0, 'Private'], [500, 'Private First Class'], [1500, 'Corporal'], [3500, 'Sergeant'], [7000, 'Staff Sergeant'], [12000, 'Technical Sergeant'], [20000, 'Second Lieutenant'], [32000, 'First Lieutenant'], [50000, 'Captain'], [80000, 'Major']],
  GER: [[0, 'Panzerschütze'], [500, 'Gefreiter'], [1500, 'Obergefreiter'], [3500, 'Unteroffizier'], [7000, 'Feldwebel'], [12000, 'Oberfeldwebel'], [20000, 'Leutnant'], [32000, 'Oberleutnant'], [50000, 'Hauptmann'], [80000, 'Major']],
};

export function rankOf(p: Profile) {
  const table = RANKS[p.nation];
  let idx = 0;
  for (let i = 0; i < table.length; i++) if (p.xp >= table[i][0]) idx = i;
  const next = table[idx + 1];
  return { index: idx, name: table[idx][1], next: next ? next[0] : null, prev: table[idx][0] };
}

export function newProfile(): Profile {
  const p: Profile = {
    version: 2, name: 'Commander', xp: 0, rp: 1500, requisition: 5000,
    researched: TECH_TREE.filter((n) => n.rp === 0).map((n) => n.id),
    owned: ['m4a3_75w', 'pz4h'],
    vehicles: {},
    selected: { USA: 'm4a3_75w', GER: 'pz4h' },
    nation: 'USA',
    campaign: { completed: [] },
    achievements: [],
    stats: { battles: 0, wins: 0, tankKills: 0, infantryKills: 0, objectives: 0, penetrations: 0, recovered: 0 },
    settings: { realism: false, volume: 0.8, quality: 'high', hitMarkers: true },
  };
  for (const id of p.owned) ensureVehicle(p, id);
  return p;
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Profile;
      if (p.version === 2) {
        for (const id of p.owned) ensureVehicle(p, id);
        return p;
      }
    }
  } catch {
    /* corrupted or unavailable storage: start fresh */
  }
  return newProfile();
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable (private window): progression lives for this session only */
  }
}

export function ensureVehicle(p: Profile, id: string): VehicleRecord | null {
  const spec = VEHICLES[id];
  if (!spec) return null;
  let v = p.vehicles[id];
  if (!v) {
    const rng = new RNG(id.length * 7919 + 13);
    v = p.vehicles[id] = {
      id, xp: 0, battles: 0, kills: 0, upgrades: [], loadout: { ...spec.defaultLoadout }, wear: 0.25,
      crew: spec.crew.map((r) => makeCrewMember(spec.nation, r, rng, 0.45)),
    };
  }
  return v;
}

export function canResearch(p: Profile, nodeId: string) {
  const n = NODE_BY_ID[nodeId];
  if (!n || p.researched.includes(nodeId)) return false;
  return n.requires.every((r) => p.researched.includes(r)) && p.rp >= n.rp;
}

export function research(p: Profile, nodeId: string) {
  if (!canResearch(p, nodeId)) return false;
  p.rp -= NODE_BY_ID[nodeId].rp;
  p.researched.push(nodeId);
  saveProfile(p);
  return true;
}

export function canBuy(p: Profile, nodeId: string) {
  const n = NODE_BY_ID[nodeId];
  return !!n && n.status === 'playable' && p.researched.includes(nodeId) && !p.owned.includes(nodeId) && p.requisition >= n.cost;
}

export function buy(p: Profile, nodeId: string) {
  if (!canBuy(p, nodeId)) return false;
  p.requisition -= NODE_BY_ID[nodeId].cost;
  p.owned.push(nodeId);
  ensureVehicle(p, nodeId);
  saveProfile(p);
  return true;
}

export function buyUpgrade(p: Profile, vehId: string, upId: string) {
  const v = ensureVehicle(p, vehId);
  const u = UPGRADE_BY_ID[upId];
  if (!v || !u || v.upgrades.includes(upId)) return false;
  if (p.rp < u.rp || p.requisition < u.cost) return false;
  if (u.requires && !u.requires.every((r) => v.upgrades.includes(r))) return false;
  p.rp -= u.rp;
  p.requisition -= u.cost;
  v.upgrades.push(upId);
  // training upgrades act on the crew's skills directly
  const bump = (k: keyof CrewMember['skills'], role?: string) => {
    for (const c of v.crew) if (!role || c.role === role) c.skills[k] = Math.min(0.95, c.skills[k] + 0.12);
  };
  if (upId === 'crew_gunnery') bump('gunnery', 'gunner');
  if (upId === 'crew_loading') bump('loading', 'loader');
  if (upId === 'crew_driving') bump('driving', 'driver');
  if (upId === 'crew_observation') bump('observation', 'commander');
  if (upId === 'crew_repair') bump('repair');
  if (upId === 'engine_overhaul') v.wear = 0;
  saveProfile(p);
  return true;
}

/** workshop repair between battles: requisition cost scales with wear */
export function repairCost(v: VehicleRecord) {
  return Math.round(v.wear * 1600);
}

export function repairVehicle(p: Profile, vehId: string) {
  const v = ensureVehicle(p, vehId);
  if (!v) return false;
  const c = repairCost(v);
  if (p.requisition < c) return false;
  p.requisition -= c;
  v.wear = 0;
  saveProfile(p);
  return true;
}

export interface BattleStats {
  tankKills: number;
  softKills: number;
  penetrations: number;
  assists: number;
  objectives: number;
  recovered: number;
  supportedSquads: number;
  survived: boolean;
  won: boolean;
  timeS: number;
  /** left the battle before it was decided */
  withdrew?: boolean;
}

export interface Rewards {
  xp: number;
  rp: number;
  requisition: number;
  lines: [string, number][];
  promoted: string | null;
}

/** team play and tactics are rewarded, not only kills */
export function computeRewards(s: BattleStats): Rewards {
  const lines: [string, number][] = [];
  const add = (label: string, n: number, per: number) => { if (n > 0) lines.push([`${label} ×${n}`, n * per]); };
  add('Enemy tanks knocked out', s.tankKills, 300);
  add('Penetrating hits', s.penetrations, 40);
  add('Assists on enemy armour', s.assists, 120);
  add('Enemy infantry neutralised', s.softKills, 25);
  add('Objectives captured', s.objectives, 250);
  add('Vehicles recovered / re-crewed', s.recovered, 200);
  if (!s.withdrew && s.timeS > 120) add('Friendly squads supported', s.supportedSquads, 60);
  // completion bonuses only for battles actually fought to a decision (no quitting for XP)
  if (!s.withdrew && s.timeS > 120) {
    lines.push([s.won ? 'Mission accomplished' : 'Participation', s.won ? 800 : 200]);
    if (s.survived) lines.push(['Survived the engagement', 300]);
  }
  const xp = lines.reduce((a, l) => a + l[1], 0);
  return { xp, rp: Math.round(xp * 0.9), requisition: Math.round(xp * 1.6), lines, promoted: null };
}

export function applyRewards(p: Profile, vehId: string | null, s: BattleStats, r: Rewards) {
  const before = rankOf(p).name;
  p.xp += r.xp;
  p.rp += r.rp;
  p.requisition += r.requisition;
  p.stats.battles++;
  if (s.won) p.stats.wins++;
  p.stats.tankKills += s.tankKills;
  p.stats.infantryKills += s.softKills;
  p.stats.objectives += s.objectives;
  p.stats.penetrations += s.penetrations;
  p.stats.recovered += s.recovered;
  if (vehId) {
    const v = ensureVehicle(p, vehId);
    if (v) {
      v.xp += r.xp;
      v.battles++;
      v.kills += s.tankKills;
      if (!v.upgrades.includes('maintenance_kit')) v.wear = Math.min(1, v.wear + 0.15);
      // crew experience: a little skill growth with every battle survived
      for (const c of v.crew) {
        c.xp += Math.round(r.xp / 5);
        const k: keyof CrewMember['skills'] = c.role === 'gunner' ? 'gunnery' : c.role === 'loader' ? 'loading' : c.role === 'driver' ? 'driving' : c.role === 'commander' ? 'observation' : 'repair';
        c.skills[k] = Math.min(0.95, c.skills[k] + r.xp / 40000);
        c.state = 'ok';
        c.wound = 0;
      }
    }
  }
  const after = rankOf(p).name;
  r.promoted = after !== before ? after : null;
  const ach = (id: string, cond: boolean) => { if (cond && !p.achievements.includes(id)) p.achievements.push(id); };
  ach('first_blood', p.stats.tankKills >= 1);
  ach('tank_ace', p.stats.tankKills >= 5);
  ach('recovery', p.stats.recovered >= 1);
  ach('liberator', p.campaign.completed.includes('normandy_allied'));
  saveProfile(p);
}

export const ACHIEVEMENTS: Record<string, string> = {
  first_blood: 'First kill — knock out an enemy tank',
  tank_ace: 'Tank ace — 5 enemy tanks knocked out',
  recovery: 'Recovery — re-crew an abandoned friendly vehicle',
  liberator: 'Liberator — complete "Normandy 1944: Allied Advance"',
};
