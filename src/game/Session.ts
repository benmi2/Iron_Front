import * as THREE from 'three';
import { DEPTH_MAX, DEPTH_MIN } from '../world/Terrain';
import type { Input } from '../core/Input';
import { RNG } from '../core/rng';
import { Effects } from '../render/Effects';
import { CameraRig } from '../render/CameraRig';
import type { Renderer } from '../render/Renderer';
import type { AudioSys } from '../audio/Audio';
import { Terrain, type TerrainDef } from '../world/Terrain';
import { World } from '../world/World';
import { enemyOf, type Team } from '../world/Team';
import { Tank } from '../vehicles/Tank';
import { Soldier, type SoldierRole } from '../infantry/Soldier';
import { TankAI, type TankOrder } from '../ai/TankAI';
import { SoldierAI } from '../ai/SoldierAI';
import { Squad, type SquadOrderKind } from '../ai/Squad';
import type { Unit } from '../ai/Perception';
import type { ImpactReport } from '../vehicles/DamageModel';
import { PlayerController } from './PlayerController';
import { Objective } from './Objectives';
import { applyAtmosphere, type TimeOfDay, type Weather } from './Atmosphere';
import type { BattleStats } from '../progression/Profile';
import type { CrewMember } from '../vehicles/Crew';
import { HUD } from '../ui/HUD';

export interface Mode {
  id: string;
  title: string;
  subtitle: string;
  terrain: TerrainDef;
  timeLimit: number;
  tod: TimeOfDay;
  weather: Weather;
  playerTeam: Team;
  briefing: string[];
  setup(s: Session): void;
  update(dt: number, s: Session): void;
  /** 'win' / 'lose' once decided */
  result: 'win' | 'lose' | null;
  resultText?: string;
  objectivesText(s: Session): string;
  /** firing range etc. use a custom side panel */
  sandbox?: boolean;
  dispose?(): void;
}

export interface SpawnTankOpts {
  order?: TankOrder;
  crewLevel?: number;
  upgrades?: string[];
  crew?: CrewMember[];
  loadout?: Record<string, number>;
  callsign?: string;
  ai?: boolean;
  wear?: number;
}

/**
 * One battle: builds the battlefield for a mode, owns the AIs, the player controller, camera
 * and HUD, applies fog of war, and collects the statistics used for rewards.
 */
export class Session {
  readonly world: World;
  readonly effects: Effects;
  readonly cam: CameraRig;
  readonly rng = new RNG(4711);
  readonly tankAIs = new Map<Tank, TankAI>();
  readonly squads: Squad[] = [];
  readonly objectives: Objective[] = [];
  player!: PlayerController;
  hud: HUD;
  playerTeam: Team;
  paused = false;
  ended = false;
  time = 0;
  manualRange = 400;
  stats = { tankKills: 0, softKills: 0, penetrations: 0, assists: 0, objectives: 0, recovered: 0 };
  private damagedBy = new Map<Tank, Set<Tank>>();
  playerVehicleId: string | null = null;
  private rainAcc = 0;
  /** tanks that were the player's at some point (for crediting) */
  private playerTanks = new Set<Tank>();
  /** x-ray report to display */
  xray: ImpactReport | null = null;
  /** the last enemy that hit the player's vehicle (framed by the camera, flagged on the HUD) */
  threat: { u: Unit; t: number } | null = null;
  onEnd: ((s: Session) => void) | null = null;

  constructor(readonly renderer: Renderer, readonly audio: AudioSys, readonly input: Input, readonly mode: Mode, realism: boolean) {
    applyAtmosphere(renderer, mode.tod, mode.weather);
    this.effects = new Effects(renderer.sunDir);
    const terrain = new Terrain(mode.terrain);
    this.world = new World(terrain, this.effects, audio);
    this.world.realism = realism;
    this.playerTeam = mode.playerTeam;
    renderer.scene.add(this.world.root);
    this.cam = new CameraRig(renderer.camera);
    this.hud = new HUD(this);
    this.wireEvents();
    mode.setup(this);
    this.hud.build();
    // warm up: paint the effect textures and compile every shader variant before play starts
    const p = this.player?.unit.pos ?? new THREE.Vector3();
    // the fires have been burning for a while: let the smoke columns climb before the first frame
    this.effects.cameraPos.set(p.x, 10, 40);
    for (let i = 0; i < 1100; i++) this.effects.update(1 / 60, renderer.scene.fog as THREE.FogExp2);
    this.effects.explosion(new THREE.Vector3(p.x, -50, p.z), 0.5, true, -50, true);
    this.effects.armorSpark(new THREE.Vector3(p.x, -50, p.z), new THREE.Vector3(0, 1, 0), null);
    renderer.renderer.compile(renderer.scene, renderer.camera);
  }

  /* ------------------------------------------------------------------ spawning */

  spawnTank(specId: string, team: Team, x: number, z: number, heading: number, o: SpawnTankOpts = {}) {
    const t = new Tank(specId, { team, x, z, heading, crewLevel: o.crewLevel ?? 0.5, seed: this.rng.int(1, 1e9), callsign: o.callsign, upgrades: o.upgrades, crew: o.crew, loadout: o.loadout });
    this.world.addTank(t);
    if (o.ai !== false) this.tankAIs.set(t, new TankAI(t, o.order ?? { kind: 'hold', x, z }));
    t.buttoned = false;
    if (o.wear && !t.upgrades.has('engine_overhaul')) t.wear = o.wear;
    return t;
  }

  spawnSoldier(team: Team, role: SoldierRole, x: number, z: number, skill = 0.5, ai = true) {
    const nation = team === 'allies' ? 'USA' : 'GER';
    const s = new Soldier(team, nation, role, x, z, this.rng.int(1, 1e9), skill);
    this.world.addSoldier(s);
    if (ai) s.ai = new SoldierAI(s);
    return s;
  }

  spawnSquad(team: Team, name: string, x: number, z: number, roles: SoldierRole[], order: Squad['order'], skill = 0.5) {
    const sq = new Squad(team, name, order);
    roles.forEach((role, i) => {
      const s = this.spawnSoldier(team, role, x - (team === 'allies' ? 1 : -1) * (i % 4) * 2.2 + this.rng.range(-0.8, 0.8), (order.z ?? z) + ((i % 3) - 1) * 3.5 + this.rng.range(-0.5, 0.5), skill + this.rng.range(-0.1, 0.1));
      sq.add(s);
    });
    this.squads.push(sq);
    return sq;
  }

  /** defenders placed directly into cover positions */
  spawnDefenders(team: Team, name: string, positions: [number, number][], roles: SoldierRole[], skill = 0.5) {
    const sq = new Squad(team, name, { kind: 'hold', x: positions[0][0], z: positions[0][1] });
    roles.forEach((role, i) => {
      const [x, z] = positions[i % positions.length];
      const s = this.spawnSoldier(team, role, x + this.rng.range(-0.6, 0.6), z + this.rng.range(-0.4, 0.4), skill);
      s.ctl.crouch = true;
      sq.add(s);
    });
    // holding defenders stay at their own spots rather than a formation
    sq.slot = (s: Soldier) => {
      const i = sq.members.indexOf(s);
      const [x, z] = positions[i % positions.length];
      return { dx: x - sq.order.x, z };
    };
    this.squads.push(sq);
    return sq;
  }

  addObjective(id: string, label: string, x: number, z: number, r: number, owner: Team | null) {
    const o = new Objective(id, label, x, z, r, owner);
    this.objectives.push(o);
    return o;
  }

  setPlayer(soldier: Soldier, tank: Tank | null) {
    this.player = new PlayerController(this, soldier, tank);
    if (tank) {
      this.playerTanks.add(tank);
      this.playerVehicleId = tank.spec.id;
    }
  }

  suspendAI(t: Tank) {
    this.playerTanks.add(t);
    const ai = this.tankAIs.get(t);
    if (ai) (ai as TankAI & { suspended?: boolean }).suspended = true;
  }

  resumeAI(t: Tank, order: TankOrder) {
    let ai = this.tankAIs.get(t);
    if (!ai) this.tankAIs.set(t, (ai = new TankAI(t, order)));
    ai.order = order;
    (ai as TankAI & { suspended?: boolean }).suspended = false;
  }

  orderSquads(kind: SquadOrderKind, around: Unit, x?: number) {
    let n = 0;
    for (const sq of this.squads) {
      if (sq.team !== this.playerTeam || !sq.leader) continue;
      if (Math.abs(sq.leader.pos.x - around.pos.x) > 120) continue;
      sq.broken = false;
      sq.order = { kind, x: x ?? around.pos.x, z: sq.order.z, follow: kind === 'follow' ? around : null };
      n++;
    }
    const txt = kind === 'follow' ? 'Squads: follow me!' : kind === 'hold' ? 'Squads: hold this position!' : `Squads: advance to ${Math.round(x ?? 0)} m!`;
    this.world.log(n ? txt : 'No squads in voice range', this.playerTeam, 'radio');
  }

  /* ------------------------------------------------------------------ events */

  private wireEvents() {
    const w = this.world;
    w.events.log = (msg, team, level) => this.hud.log(msg, team, level);
    w.events.tankHit = (t, r, shooter) => {
      const byPlayer = shooter && (shooter === this.player?.tank || shooter === this.player?.soldier || (shooter.kind === 'tank' && this.playerTanks.has(shooter) && shooter.isPlayer));
      if (byPlayer && t.team !== this.playerTeam) {
        if (r.severity >= 2) {
          this.stats.penetrations++;
          let set = this.damagedBy.get(t);
          if (!set) this.damagedBy.set(t, (set = new Set()));
          set.add(this.player.tank ?? (null as unknown as Tank));
        }
        this.hud.hitMarker(r, true);
        this.xray = r;
      } else if (t === this.player?.tank) {
        this.hud.hitMarker(r, false);
        this.xray = r;
        if (shooter && shooter.team !== this.playerTeam) this.threat = { u: shooter, t: this.time };
      }
    };
    w.events.tankKilled = (t, _reason, killer) => {
      if (t.team === this.playerTeam) return;
      const playerKill = killer && killer.isPlayer;
      if (playerKill) this.stats.tankKills++;
      else if (this.damagedBy.has(t)) this.stats.assists++;
      this.hud.killFeed(t, killer);
    };
    w.events.soldierKilled = (s, by) => {
      if (s === this.player?.soldier) this.player.onKilled();
      if (s.team !== this.playerTeam && by && (by === this.player?.soldier || (by.kind === 'tank' && by.isPlayer))) this.stats.softKills++;
    };
    w.events.bailout = (t, crew) => {
      for (const s of crew) s.ai = new SoldierAI(s);
      this.player?.onBailOut(t, crew);
      const ai = this.tankAIs.get(t);
      if (ai) this.tankAIs.delete(t);
    };
    w.perception.onFirstSpot = (team, e, by) => {
      if (team !== this.playerTeam || e.kind !== 'tank') return;
      const ref = this.player?.unit ?? by;
      if (!ref) return;
      const d = e.pos.distanceTo(ref.pos);
      const dir = e.pos.x > ref.pos.x ? 'east' : 'west';
      const yards = this.playerTeam === 'allies';
      const dist = yards ? `${Math.round((d / 0.9144) / 50) * 50} yards` : `${Math.round(d / 50) * 50} metres`;
      const who = by && by.kind === 'soldier' ? `${by.rank} ${by.name}` : by && by.kind === 'tank' ? by.callsign : 'Observer';
      const name = this.playerTeam === 'allies' ? (e.spec.id === 'pz4h' ? 'Mark IV' : e.spec.short) : e.spec.short;
      this.world.log(`${who}: Enemy armour! ${name}, ${dist} ${dir}!`, team, 'radio');
    };
    w.events.playerHurt = (n) => this.hud.hurt(n);
  }

  /* ------------------------------------------------------------------ fog of war */

  visibleToPlayer(u: Unit): boolean {
    if (u.team === this.playerTeam) return true;
    if (u.kind === 'tank' && u.state === 'destroyed') return true;
    if (u.kind === 'soldier' && u.state === 'dead') return true;
    if (this.mode.sandbox) return true;
    const me = this.player?.unit;
    if (me && me.pos.distanceTo(u.pos) < 30) return true;
    if (this.world.perception.isKnown(this.playerTeam, u)) return true;
    return this.playerSees(u);
  }

  private sightCache = new Map<Unit, { t: number; v: boolean }>();

  /**
   * What the player's own unit can see right now: anything in line of sight within observation
   * range (the commander looking out of his hatch / vision blocks, or the soldier himself), and
   * any enemy that just fired within ≈1.5 km (muzzle flash and smoke). Cached 0.2 s.
   */
  playerSees(u: Unit): boolean {
    const me = this.player?.unit;
    if (!me) return false;
    const c = this.sightCache.get(u);
    if (c && this.time - c.t < 0.2) return c.v;
    const inTank = me.kind === 'tank';
    const eye = inTank ? me.eyeWorld() : me.eye;
    const d = eye.distanceTo(u.pos);
    const buttoned = inTank && me.buttoned;
    let range = u.kind === 'tank' ? 1000 : 420;
    if (buttoned) range *= 0.7;
    if (u.kind === 'soldier' && u.crouch > 0.5) range *= 0.75;
    let v = false;
    if (d < 1500 && (d < range || u.revealT > 0)) {
      const pts = u.kind === 'tank' ? [u.turretWorld().add(new THREE.Vector3(0, 0.5, 0)), u.centerWorld()] : [u.eye, u.center];
      for (const p of pts) {
        if (this.world.visibility(eye, p) > (u.revealT > 0 ? 0.05 : 0.25)) { v = true; break; }
      }
    }
    this.sightCache.set(u, { t: this.time, v });
    return v;
  }

  /* ------------------------------------------------------------------ loop */

  update(dt: number) {
    this.hud.keys();
    if (this.paused || this.ended) {
      this.input.endStep();
      return;
    }
    this.time += dt;
    const w = this.world;
    this.player.update(dt, this.input, this.cam, this.renderer.camera);
    for (const [t, ai] of this.tankAIs) if (!(ai as TankAI & { suspended?: boolean }).suspended) ai.update(dt, w);
    for (const s of w.soldiers) if (s.ai && !s.isPlayer) s.ai.update(dt, w);
    // squads break when shattered
    for (const sq of this.squads) {
      if (!sq.broken && sq.members.length >= 4 && sq.strength < 0.4 && sq.suppression > 0.5) {
        sq.broken = true;
        w.log(`${sq.name} is falling back!`, sq.team, sq.team === this.playerTeam ? 'bad' : 'good');
      }
    }
    w.update(dt);
    for (const o of this.objectives) {
      o.update(dt, w);
      if (o.justCaptured) {
        w.log(`Objective ${o.id} — ${o.label} captured by ${o.justCaptured === 'allies' ? 'Allied' : 'German'} forces`, o.justCaptured, o.justCaptured === this.playerTeam ? 'good' : 'bad');
        if (o.justCaptured === this.playerTeam) this.stats.objectives++;
        this.audio.impact(this.cam.focus, 'smoke');
      }
    }
    this.mode.update(dt, this);
    if (this.player.dead && this.player.deadT > 3) this.transferControl();
    if (this.mode.result && !this.ended) {
      this.ended = true;
      this.hud.showEnd();
      this.onEnd?.(this);
    }
    this.input.endStep();
  }

  /** the player was killed: continue as another friendly unit (Men-of-War style) */
  private transferControl() {
    const w = this.world;
    const me = this.player.soldier;
    const tanks = w.tanks.filter((t) => t.team === this.playerTeam && t.alive);
    tanks.sort((a, b) => a.pos.distanceTo(me.pos) - b.pos.distanceTo(me.pos));
    const sold = w.soldiers.filter((s) => s.team === this.playerTeam && s.alive && s !== me && s.role !== 'crew');
    sold.sort((a, b) => a.pos.distanceTo(me.pos) - b.pos.distanceTo(me.pos));
    me.isPlayer = false;
    if (tanks.length) {
      // a new commander: spawn a fresh soldier entity that boards the tank
      const s = this.spawnSoldier(this.playerTeam, 'crew', tanks[0].pos.x, tanks[0].pos.z, 0.5, false);
      this.player = new PlayerController(this, s, tanks[0]);
      w.log(`You take command of ${tanks[0].callsign}`, this.playerTeam, 'info');
    } else if (sold.length) {
      sold[0].ai = null;
      this.player = new PlayerController(this, sold[0], null);
      w.log(`You take over as ${sold[0].rank} ${sold[0].name}`, this.playerTeam, 'info');
    } else {
      this.mode.result = 'lose';
      this.mode.resultText = 'All friendly forces lost.';
      this.player.dead = false;
    }
  }

  render(dt: number) {
    const w = this.world;
    const unit = this.player.unit;
    this.cam.focus.lerp(new THREE.Vector3(unit.pos.x, unit.pos.y, unit.pos.z), 0.25);
    this.cam.shake = Math.max(this.cam.shake, this.effects.shake);
    this.effects.shake = 0;
    this.cam.update(dt);
    this.effects.cameraPos.copy(this.renderer.camera.position);
    this.audio.listener.copy(this.renderer.camera.position).lerp(unit.pos, 0.75);
    w.listener.copy(this.audio.listener);
    w.centerX = unit.pos.x;
    this.audio.update(dt);
    // pulled back, the camera looks through more air for the same picture: thin the haze with zoom
    // so distant targets stay readable
    (this.renderer.scene.fog as THREE.FogExp2).density = this.renderer.baseFogDensity / Math.pow(Math.max(1, this.cam.effectiveZoom), 0.85);
    this.effects.update(dt, this.renderer.scene.fog as THREE.FogExp2);
    this.renderer.followShadow(this.cam.focus.clone().setX(this.cam.focus.x + this.cam.lookAhead * 0.6), this.cam.viewWidth);
    // depth of field: the playing band (plus the hedgerows and village just behind it) stays sharp
    this.renderer.setFocusBand(this.cam.focus.x + this.cam.lookAhead, this.cam.focus.y, DEPTH_MAX + 1.5, DEPTH_MIN - 45);
    // fog of war: hide enemies nobody on our side has spotted
    for (const t of w.tanks) t.root.visible = this.visibleToPlayer(t);
    for (const s of w.soldiers) s.rig.group.visible = !s.inTank && this.visibleToPlayer(s);
    if (this.mode.weather === 'rain') this.rain(dt);
    this.hud.update(dt);
    this.renderer.render(this.time, dt);
  }

  private rain(dt: number) {
    this.rainAcc += dt * 400;
    const c = this.renderer.camera.position;
    while (this.rainAcc > 1) {
      this.rainAcc--;
      const p = new THREE.Vector3(c.x + this.rng.range(-35, 35), c.y + this.rng.range(-5, 12), c.z - this.rng.range(8, 50));
      this.effects.particles.glow.spawn({ pos: p, vel: new THREE.Vector3(-2, -14, 0), life: 0.7, size: 0.025, color: 0x8a9298, shape: 1, stretch: 30, alpha: 0.5 });
    }
  }

  battleStats(): BattleStats {
    let supported = 0;
    for (const sq of this.squads) if (sq.team === this.playerTeam && sq.strength > 0.5) supported++;
    const survived = this.player.tank ? this.player.tank.alive : this.player.soldier.alive;
    return { ...this.stats, supportedSquads: supported, survived, won: this.mode.result === 'win', timeS: this.time };
  }

  dispose() {
    this.mode.dispose?.();
    this.audio.stopAllEngines();
    this.world.dispose();
    this.effects.clear();
    this.hud.dispose();
  }

  enemyTeam() {
    return enemyOf(this.playerTeam);
  }
}
