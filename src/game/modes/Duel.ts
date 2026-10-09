import type { TerrainDef } from '../../world/Terrain';
import type { Mode, Session } from '../Session';
import type { Profile } from '../../progression/Profile';
import { ensureVehicle } from '../../progression/Profile';
import type { Team } from '../../world/Team';
import { buildBackground } from '../../world/Background';
import { addHedgerow, addHouse, addStoneWall, addTree, addWreckTruck } from '../../world/Props';
import { RNG } from '../../core/rng';
import type { TimeOfDay, Weather } from '../Atmosphere';

export interface DuelConfig {
  side: Team;
  playerTank: string;
  enemyModel: string;
  count: number;
  distance: number;
  difficulty: number;
  tod: TimeOfDay;
  weather: Weather;
}

export const DEFAULT_DUEL: DuelConfig = { side: 'allies', playerTank: 'm4a3_75w', enemyModel: 'pz4h', count: 1, distance: 600, difficulty: 0.5, tod: 'noon', weather: 'clear' };

const DUEL_TERRAIN: TerrainDef = {
  x0: 0, x1: 1700, seed: 812, roadZ: -4, roadHalf: 3,
  hills: [{ x: 600, z: -10, rx: 70, rz: 10, h: 3 }, { x: 1050, z: -2, rx: 60, rz: 8, h: 2.2 }, { x: 300, z: 2, rx: 40, rz: 7, h: 1.5 }],
  mud: [{ x: 820, z: -9, r: 12 }],
  farRiverZ: -170,
  village: [],
};

/** Tank duel: armour, angles and positioning — no infantry. */
export class DuelMode implements Mode {
  id = 'duel';
  title = 'Tank Duel';
  subtitle = 'Open bocage country';
  terrain = DUEL_TERRAIN;
  timeLimit = 15 * 60;
  tod: TimeOfDay;
  weather: Weather;
  playerTeam: Team;
  result: 'win' | 'lose' | null = null;
  resultText = '';
  briefing: string[];

  constructor(private profile: Profile, private c: DuelConfig) {
    this.tod = c.tod;
    this.weather = c.weather;
    this.playerTeam = c.side;
    this.briefing = ['Find the enemy before he finds you. Present your strongest armour, aim for the weak spots and keep moving between shots.'];
  }

  setup(s: Session) {
    const w = s.world;
    const r = new RNG(5);
    buildBackground(w, 3, 0, 1700, { churchX: 900, bridgeX: 500, burning: [700, 1300] });
    addHedgerow(w, -40, -18.5, 1750, -18.5, 1);
    for (let i = 0; i < 9; i++) addStoneWall(w, 150 + i * 160, 150 + i * 160 + r.range(14, 30), r.pick([-11, -6, 2.5]), r.range(1.1, 1.5), i);
    addHouse(w, { x: 840, z: -14.5, w: 11, d: 7, floors: 1, style: 'stone', seed: 9, damage: 0.7 });
    addWreckTruck(w, 520, 1.5, 0.4, 3, true);
    addWreckTruck(w, 1180, -11, 2.8, 4, true);
    for (let i = 0; i < 14; i++) addTree(w, r.range(60, 1650), r.range(-16, -13), i, r.chance(0.4) ? 'poplar' : 'round');
    const mid = 850;
    const half = this.c.distance / 2;
    const mine = this.c.side, enemy = mine === 'allies' ? 'axis' : 'allies';
    const rec = ensureVehicle(this.profile, this.c.playerTank)!;
    const pt = s.spawnTank(this.c.playerTank, mine, mid - half, -4, 0, { crew: rec.crew, upgrades: rec.upgrades, loadout: rec.loadout, wear: rec.wear, callsign: mine === 'allies' ? 'Able 1' : 'Pz 301' });
    const me = s.spawnSoldier(mine, 'crew', pt.pos.x, pt.pos.z, 0.6, false);
    me.crewRecord = pt.seat('commander')?.occupant ?? null;
    s.setPlayer(me, pt);
    for (let i = 0; i < this.c.count; i++) {
      const lane = [-8, 1, -13][i % 3];
      s.spawnTank(this.c.enemyModel, enemy, mid + half + i * 25, lane, Math.PI, { crewLevel: this.c.difficulty, order: { kind: 'advance', x: mid + half * 0.3, z: lane } });
      if (i > 0) s.spawnTank(this.c.playerTank, mine, mid - half - i * 25, lane, 0, { crewLevel: this.c.difficulty, order: { kind: 'follow', x: 0, z: lane, follow: pt } });
    }
  }

  objectivesText() {
    return 'Knock out the enemy armour';
  }

  update(_dt: number, s: Session) {
    const mine = this.c.side;
    const e = s.world.tanks.filter((t) => t.team !== mine && t.alive).length;
    const m = s.world.tanks.filter((t) => t.team === mine && t.alive).length;
    if (e === 0) { this.result = 'win'; this.resultText = 'Enemy armour knocked out.'; }
    else if (m === 0) { this.result = 'lose'; this.resultText = 'Your tank was knocked out.'; }
    else if (s.time > this.timeLimit) { this.result = 'lose'; this.resultText = 'Time is up.'; }
  }
}
