import { NORMANDY, populateNormandy } from '../../world/maps/Normandy';
import type { Mode, Session } from '../Session';
import type { TimeOfDay, Weather } from '../Atmosphere';
import type { Profile } from '../../progression/Profile';
import { ensureVehicle } from '../../progression/Profile';
import type { Team } from '../../world/Team';
import type { SoldierRole } from '../../infantry/Soldier';
import { VEHICLES } from '../../data/vehicles';

export interface SkirmishConfig {
  side: Team;
  playerTank: string;
  friendlyTanks: number;
  friendlyModel: string;
  enemyTanks: number;
  enemyModel: string;
  squads: number;
  difficulty: number;
  tod: TimeOfDay;
  weather: Weather;
  ammo: 'full' | 'limited';
}

export const DEFAULT_SKIRMISH: SkirmishConfig = {
  side: 'allies', playerTank: 'm4a3_75w', friendlyTanks: 2, friendlyModel: 'm4a3_75w', enemyTanks: 3, enemyModel: 'pz4h', squads: 2,
  difficulty: 0.5, tod: 'evening', weather: 'clear', ammo: 'full',
};

const SQUAD: Record<Team, SoldierRole[]> = {
  allies: ['officer', 'mg', 'rifleman', 'rifleman', 'at', 'rifleman', 'medic'],
  axis: ['officer', 'mg', 'rifleman', 'faust', 'at', 'rifleman', 'smg'],
};

/** Meeting engagement on the Normandy map: both sides converge on the village square. */
export class SkirmishMode implements Mode {
  id = 'skirmish';
  title = 'Skirmish';
  subtitle = 'Meeting engagement · Saint-Martin';
  terrain = NORMANDY;
  timeLimit = 25 * 60;
  tod: TimeOfDay;
  weather: Weather;
  playerTeam: Team;
  result: 'win' | 'lose' | null = null;
  resultText = '';
  briefing: string[];

  constructor(private profile: Profile, private c: SkirmishConfig) {
    this.tod = c.tod;
    this.weather = c.weather;
    this.playerTeam = c.side;
    this.briefing = [
      `${c.friendlyTanks + 1} × ${VEHICLES[c.playerTank].short} and ${c.squads} squad(s) against ${c.enemyTanks} × ${VEHICLES[c.enemyModel].short} with ${c.squads} squad(s).`,
      'Both sides advance on the village square. Hold the square and destroy the enemy armour.',
    ];
  }

  setup(s: Session) {
    const w = s.world;
    populateNormandy(w);
    s.addObjective('B', 'Village square', 520, -5, 19, null);
    const c = this.c;
    const mine = c.side;
    const enemy = mine === 'allies' ? 'axis' : 'allies';
    const myX = mine === 'allies' ? 40 : 1100;
    const enX = mine === 'allies' ? 1100 : 40;
    const myHead = mine === 'allies' ? 0 : Math.PI;
    const limit = (spec: string) => {
      const d = VEHICLES[spec].defaultLoadout;
      if (c.ammo === 'full') return { ...d };
      const o: Record<string, number> = {};
      for (const k in d) o[k] = Math.ceil(d[k] * 0.4);
      return o;
    };
    const rec = ensureVehicle(this.profile, c.playerTank)!;
    const pt = s.spawnTank(c.playerTank, mine, myX, -3, myHead, { crew: rec.crew, upgrades: rec.upgrades, loadout: c.ammo === 'full' ? rec.loadout : limit(c.playerTank), callsign: mine === 'allies' ? 'Able 1' : 'Pz 301', wear: rec.wear });
    const me = s.spawnSoldier(mine, 'crew', myX, -3, 0.6, false);
    me.crewRecord = pt.seat('commander')?.occupant ?? null;
    s.setPlayer(me, pt);
    const lanes = [-10, 2, -14, 4.5, -6];
    for (let i = 0; i < c.friendlyTanks; i++) {
      s.spawnTank(c.friendlyModel, mine, myX - (mine === 'allies' ? 1 : -1) * (20 + i * 14), lanes[i % lanes.length], myHead, { crewLevel: c.difficulty, loadout: limit(c.friendlyModel), order: { kind: 'follow', x: 0, z: lanes[i % lanes.length], follow: pt } });
    }
    for (let i = 0; i < c.enemyTanks; i++) {
      s.spawnTank(c.enemyModel, enemy, enX + (enemy === 'axis' ? 1 : -1) * i * 18, lanes[i % lanes.length], myHead + Math.PI, { crewLevel: c.difficulty, loadout: limit(c.enemyModel), order: { kind: 'advance', x: enemy === 'axis' ? 560 : 480, z: lanes[i % lanes.length] } });
    }
    for (let i = 0; i < c.squads; i++) {
      s.spawnSquad(mine, `Squad ${i + 1}`, myX - (mine === 'allies' ? 1 : -1) * (10 + i * 12), lanes[(i + 1) % lanes.length], SQUAD[mine], { kind: 'follow', x: 0, z: lanes[(i + 1) % lanes.length], follow: pt }, 0.5);
      s.spawnSquad(enemy, `Enemy squad ${i + 1}`, enX + (enemy === 'axis' ? 1 : -1) * (10 + i * 12), lanes[(i + 2) % lanes.length], SQUAD[enemy], { kind: 'advance', x: enemy === 'axis' ? 540 : 500, z: lanes[(i + 2) % lanes.length] }, c.difficulty);
    }
  }

  objectivesText() {
    return 'Hold the village square (B) and destroy the enemy armour';
  }

  update(_dt: number, s: Session) {
    const w = s.world;
    const mine = this.c.side;
    const enemyTanks = w.tanks.filter((t) => t.team !== mine && t.alive).length;
    const myTanks = w.tanks.filter((t) => t.team === mine && t.alive).length;
    const sq = s.objectives[0];
    if (enemyTanks === 0 && sq.owner === mine) { this.result = 'win'; this.resultText = 'The square is ours and the enemy armour is destroyed.'; }
    else if (myTanks === 0 && !w.soldiers.some((x) => x.team === mine && x.alive && x.role !== 'crew')) { this.result = 'lose'; this.resultText = 'Our force has been destroyed.'; }
    else if (s.time > this.timeLimit) { this.result = sq.owner === mine ? 'win' : 'lose'; this.resultText = 'Time is up.'; }
  }
}
