import { NORMANDY, populateNormandy } from '../../world/maps/Normandy';
import type { Mode, Session } from '../Session';
import type { Profile } from '../../progression/Profile';
import { ensureVehicle } from '../../progression/Profile';
import type { SoldierRole } from '../../infantry/Soldier';
import type { Tank } from '../../vehicles/Tank';

const US_RIFLE: SoldierRole[] = ['officer', 'mg', 'rifleman', 'rifleman', 'rifleman', 'at', 'rifleman', 'medic'];
const US_SUPPORT: SoldierRole[] = ['smg', 'engineer', 'engineer', 'at', 'rifleman'];

/**
 * Historical battle: "Normandy 1944 — Allied Advance". A Sherman platoon with infantry pushes
 * through bocage and a defended village; German armour counter-attacks once the square falls.
 */
export class CampaignNormandy implements Mode {
  id = 'normandy_allied';
  title = 'Normandy 1944 — Allied Advance';
  subtitle = 'Saint-Martin-des-Champs · July 1944';
  terrain = NORMANDY;
  timeLimit = 30 * 60;
  tod = 'evening' as const;
  weather = 'clear' as const;
  playerTeam = 'allies' as const;
  result: 'win' | 'lose' | null = null;
  resultText = '';
  briefing = [
    'July 1944. The bocage south of the beachhead has cost us dearly. Your M4A3 Sherman leads 2nd Platoon with a rifle company in support.',
    'Clear the crossroads farm (A), take the village square at Saint-Martin (B), then secure the walled château farm (C).',
    'Expect MG 42 nests, Panzerfaust and Panzerschreck teams in the village, and Panzer IVs. A German armoured counter-attack is likely once the square falls.',
    'Advance with the infantry: they find the anti-tank teams before those find you. Use the road gaps through the hedgerows, use HE against the guns and men in the houses, and save your M61s for armour. Watch the Panzer IV\'s weak 50 mm turret front.',
  ];
  private reinforced = false;
  private phase = 0;
  private enemyTanks: Tank[] = [];

  constructor(private profile: Profile) {}

  setup(s: Session) {
    const w = s.world;
    const L = populateNormandy(w);
    for (const o of L.objectives) s.addObjective(o.id, o.label, o.x, o.z, o.r, o.owner);
    // --- US platoon
    const vehId = this.profile.selected.USA ?? 'm4a3_75w';
    const rec = ensureVehicle(this.profile, vehId)!;
    const player = s.spawnTank(vehId, 'allies', L.alliesStart, -3, 0, { ai: true, crew: rec.crew, upgrades: rec.upgrades, loadout: rec.loadout, callsign: 'Able 1', wear: rec.wear });
    const me = s.spawnSoldier('allies', 'crew', player.pos.x, player.pos.z, 0.6, false);
    me.crewRecord = player.seat('commander')?.occupant ?? null;
    if (me.crewRecord) { me.name = me.crewRecord.name.split(' ').pop()!; me.rank = me.crewRecord.rank; }
    s.setPlayer(me, player);
    const a2 = s.spawnTank('m4a3_75w', 'allies', L.alliesStart - 22, -9.5, 0, { callsign: 'Able 2', crewLevel: 0.5, order: { kind: 'follow', x: 0, z: -9.5, follow: player } });
    const a3 = s.spawnTank('m4a3_75w', 'allies', L.alliesStart - 34, 1.8, 0, { callsign: 'Able 3', crewLevel: 0.45, order: { kind: 'follow', x: 0, z: 1.5, follow: player } });
    void a2; void a3;
    s.spawnSquad('allies', '1st Squad', L.alliesStart - 8, -12, US_RIFLE, { kind: 'follow', x: 0, z: -12, follow: player }, 0.5);
    s.spawnSquad('allies', '2nd Squad', L.alliesStart - 14, 2, US_RIFLE, { kind: 'follow', x: 0, z: 2.5, follow: player }, 0.5);
    s.spawnSquad('allies', '3rd Squad', L.alliesStart - 30, -6, US_RIFLE, { kind: 'follow', x: 0, z: -7, follow: player }, 0.45);
    s.spawnSquad('allies', 'Weapons & engineers', L.alliesStart - 40, -14, US_SUPPORT, { kind: 'follow', x: 0, z: -14, follow: player }, 0.5);
    // --- German defence
    s.spawnDefenders('axis', 'Grenadiers (crossroads)', L.defence.a, ['mg', 'rifleman', 'rifleman', 'faust', 'smg', 'rifleman'], 0.5);
    s.spawnDefenders('axis', 'Grenadiers (village)', L.defence.b, ['mg', 'rifleman', 'at', 'faust', 'rifleman', 'smg', 'mg', 'officer'], 0.55);
    s.spawnDefenders('axis', 'Grenadiers (château)', L.defence.c, ['mg', 'rifleman', 'rifleman', 'faust', 'smg', 'at'], 0.5);
    this.enemyTanks.push(s.spawnTank('pz4h', 'axis', 640, -12.6, Math.PI, { callsign: 'Pz 312', crewLevel: 0.6, order: { kind: 'hold', x: 640, z: -12.6 } }));
    this.enemyTanks.push(s.spawnTank('pz4h', 'axis', 880, -12.2, Math.PI, { callsign: 'Pz 314', crewLevel: 0.55, order: { kind: 'hold', x: 880, z: -12.2 } }));
    for (const t of this.enemyTanks) t.buttoned = true;
    w.log('Able 1, this is Able 6. Move out — clear the crossroads, then the village. Infantry is with you.', 'allies', 'radio');
  }

  objectivesText(s: Session) {
    const own = (id: string) => s.objectives.find((o) => o.id === id)?.owner === 'allies';
    if (!own('A')) return 'Clear the crossroads farm (A)';
    if (!own('B')) return 'Take the village square (B)';
    if (!this.reinforced || this.enemyTanks.some((t) => t.alive && t.pos.x < 1140)) return own('C') ? 'Destroy the German armoured counter-attack' : 'Secure the château farm (C) · repel the counter-attack';
    return 'Secure the château farm (C)';
  }

  update(_dt: number, s: Session) {
    const w = s.world;
    const own = (id: string) => s.objectives.find((o) => o.id === id)?.owner === 'allies';
    if (this.phase === 0 && own('A')) {
      this.phase = 1;
      w.log('Able 6: Good work at the crossroads. Push on into Saint-Martin — watch the windows.', 'allies', 'radio');
      for (const sq of s.squads) if (sq.team === 'allies') sq.order = { ...sq.order };
    }
    if (!this.reinforced && (own('B') || s.time > 11 * 60)) {
      this.reinforced = true;
      this.phase = 2;
      w.log('Able 6: Recon reports Panzers moving up from the east! Get hull-down and hold.', 'allies', 'radio');
      for (let i = 0; i < 2; i++) {
        const t = s.spawnTank('pz4h', 'axis', 1120 + i * 22, i === 0 ? -6 : -12, Math.PI, { callsign: `Pz ${321 + i}`, crewLevel: 0.6, order: { kind: 'advance', x: 640 + i * 30, z: i === 0 ? -6 : -12 } });
        this.enemyTanks.push(t);
      }
      s.spawnSquad('axis', 'Panzergrenadiers', 1130, -2, ['officer', 'mg', 'rifleman', 'rifleman', 'faust', 'smg', 'rifleman', 'faust'], { kind: 'advance', x: 700, z: -2 }, 0.55);
    }
    // win / lose
    const alliedTanks = w.tanks.filter((t) => t.team === 'allies' && t.alive).length;
    const enemyArmour = this.enemyTanks.filter((t) => t.alive).length;
    if (this.reinforced && own('A') && own('B') && own('C') && enemyArmour === 0) {
      this.result = 'win';
      this.resultText = 'Saint-Martin-des-Champs is in Allied hands and the counter-attack has been broken.';
      if (!this.profile.campaign.completed.includes(this.id)) this.profile.campaign.completed.push(this.id);
    } else if (alliedTanks === 0 && !w.soldiers.some((x) => x.team === 'allies' && x.alive && x.role !== 'crew')) {
      this.result = 'lose';
      this.resultText = 'The platoon has been destroyed.';
    } else if (s.time > this.timeLimit) {
      this.result = 'lose';
      this.resultText = 'The attack ran out of time; the Germans have reinforced the village.';
    }
  }
}
