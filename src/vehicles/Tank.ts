import * as THREE from 'three';
import { approach, approachAngle, clamp, DEG, wrapAngle } from '../core/math';
import { RNG } from '../core/rng';
import { ammo as getAmmo, type AmmoDef, type Nation } from '../data/ammo';
import { GUNS, type GunDef } from '../data/guns';
import { vehicle, type CrewRole, type VehicleSpec } from '../data/vehicles';
import { rangeTable } from '../ballistics/Flight';
import { setBurnt } from './TankMaterials';
import { layoutTrack, type CompDef, type Frame, type TankModel } from './TankBuilder';
import { makeCrewMember, stationEfficiency, type CrewMember } from './Crew';
import { buildSherman } from './models/ShermanM4A3_75W';
import { buildPanzerIVH } from './models/PanzerIVH';
import type { World } from '../world/World';
import type { Team } from '../world/Team';

export type CompStatus = 'ok' | 'damaged' | 'destroyed';

export class CompState {
  energy = 0;
  status: CompStatus = 'ok';
  /** crew seat occupant */
  occupant: CrewMember | null = null;
  rounds: number;
  flash = 0;
  constructor(readonly def: CompDef) {
    this.rounds = def.rounds ?? 0;
  }
  get name() {
    return this.def.name;
  }
}

export interface FireState {
  where: 'engine' | 'fighting' | 'ammo';
  intensity: number;
  t: number;
  extinguisherTried: boolean;
  cookoffAt: number;
}

export type TankState = 'active' | 'abandoned' | 'knocked-out' | 'destroyed';

export interface TankOptions {
  team: Team;
  x: number;
  z: number;
  heading: number;
  crewLevel?: number;
  seed?: number;
  callsign?: string;
  loadout?: Record<string, number>;
  /** applied upgrade ids (data/upgrades.ts) */
  upgrades?: string[];
  crew?: CrewMember[];
}

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();

export const TANK_BUILDERS: Record<string, (seed: number, num: string, upgrades: Set<string>) => TankModel> = {
  m4a3_75w: (_seed, _num, up) => buildSherman(up),
  pz4h: (seed, num, up) => buildPanzerIVH(seed, num, up),
};

/**
 * A tank on the battlefield: drivetrain, steering, turret / gun laying, loading cycle, crew,
 * internal components and their effect on every system. No hit points: the vehicle works as
 * long as its crew and components let it.
 */
export class Tank {
  static seq = 1;
  readonly id = Tank.seq++;
  readonly kind = 'tank' as const;
  readonly spec: VehicleSpec;
  readonly gunDef: GunDef;
  readonly model: TankModel;
  readonly root: THREE.Group;
  team: Team;
  nation: Nation;
  callsign: string;
  rng: RNG;

  // ---- kinematics
  pos = new THREE.Vector3();
  heading: number;
  speed = 0;
  yawRate = 0;
  pitch = 0;
  roll = 0;
  turretYaw = 0;
  gunElev = 0;
  recoil = 0;

  // ---- controls (set by player controller or AI each step)
  ctl = {
    throttle: 0,
    targetHeading: null as number | null,
    brake: false,
    aim: null as THREE.Vector3 | null,
    /** manual range setting (realism mode); null = gunner ranges automatically */
    manualRange: null as number | null,
    fire: false,
    mg: false,
    stabilizer: true,
  };

  // ---- ammunition & loading
  ammoCount: Record<string, number> = {};
  readyRounds: number;
  loaded: AmmoDef | null = null;
  loading: AmmoDef | null = null;
  loadT = 0;
  loadDur = 1;
  selected: string;
  lastShotT = -99;
  mgCool = 0;
  mgAmmo = 4000;

  // ---- crew & components
  crew: CrewMember[];
  comps: CompState[];
  state: TankState = 'active';
  fire: FireState | null = null;
  tracksBroken = { L: false, R: false };
  repairT = 0;
  buttoned = false;
  lastHitT = -99;
  lastHitBy: Tank | null = null;
  killedBy: Tank | null = null;
  bailT = -1;
  swapT = 0;
  /** rangefinding error memory for the current target (bracketing) */
  rangeErr = 0;
  rangeTarget: unknown = null;
  /** seconds the gun has been laid on the current aim */
  layT = 0;
  upgrades: Set<string>;
  /** set by World for the player's vehicle */
  isPlayer = false;
  /** spotting: per enemy team visibility handled in World */
  revealT = 0;
  stats = { shots: 0, hits: 0, kills: 0, damageDealt: 0, assists: 0 };
  private burnFx: { intensity: number } | null = null;
  private fireEm: unknown = null;
  private engineAudio: unknown = null;
  turretOff = false;

  constructor(specId: string, o: TankOptions) {
    this.spec = vehicle(specId);
    this.gunDef = GUNS[this.spec.gun];
    this.team = o.team;
    this.nation = this.spec.nation;
    this.rng = new RNG(o.seed ?? Math.floor(Math.random() * 1e9));
    this.callsign = o.callsign ?? `${this.spec.short}`;
    this.upgrades = new Set(o.upgrades ?? []);
    this.model = TANK_BUILDERS[specId](o.seed ?? 1, String(o.callsign?.match(/\d+/)?.[0] ?? 300 + this.rng.int(1, 34)), this.upgrades);
    this.root = this.model.root;
    this.root.userData.tank = this;
    this.pos.set(o.x, 0, o.z);
    this.heading = o.heading;
    if (this.upgrades.has('sandbags')) this.extraMassT = 1.2;
    const load = o.loadout ?? this.spec.defaultLoadout;
    for (const [id, n] of Object.entries(load)) this.ammoCount[id] = n;
    this.readyRounds = this.spec.readyRack;
    this.selected = Object.keys(load)[0];
    this.crew = o.crew ?? this.spec.crew.map((r) => makeCrewMember(this.nation, r, this.rng, o.crewLevel ?? 0.5));
    for (const c of this.crew) { c.state = 'ok'; c.wound = 0; c.station = c.role; }
    this.comps = this.model.components.map((d) => new CompState(d));
    for (const c of this.comps) {
      if (c.def.kind === 'crew' && c.def.role) c.occupant = this.crew.find((m) => m.role === c.def.role) ?? null;
    }
    // load the first round already in the breech at the start of the engagement
    this.loaded = this.takeRound(this.selected);
  }

  /* ================================================================== crew / systems queries */

  seat(role: CrewRole) {
    return this.comps.find((c) => c.def.kind === 'crew' && c.def.role === role) ?? null;
  }

  stationEff(role: CrewRole) {
    const s = this.seat(role);
    return s ? stationEfficiency(s.occupant, role) : 0;
  }

  compStatus(kind: CompDef['kind']): CompStatus {
    let worst: CompStatus = 'ok';
    let any = false;
    for (const c of this.comps) {
      if (c.def.kind !== kind) continue;
      any = true;
      if (c.status === 'destroyed') return 'destroyed';
      if (c.status === 'damaged') worst = 'damaged';
    }
    return any ? worst : 'ok';
  }

  get alive() {
    return this.state === 'active';
  }

  get immobile() {
    return this.tracksBroken.L || this.tracksBroken.R || this.compStatus('engine') === 'destroyed' || this.compStatus('transmission') === 'destroyed' || this.stationEff('driver') === 0;
  }

  get gunOperable() {
    return this.compStatus('breech') !== 'destroyed' && !this.barrelDestroyed && this.stationEff('gunner') > 0;
  }

  barrelDestroyed = false;
  /** 0..1 mechanical wear (engine power, sight collimation) carried over from the garage */
  wear = 0;
  extraMassT = 0;
  barrelDamaged = false;

  get traverseMode(): 'powered' | 'manual' | 'jammed' {
    if (this.turretJammed) return 'jammed';
    if (this.compStatus('traverse') !== 'ok' || this.compStatus('engine') === 'destroyed') return 'manual';
    return 'powered';
  }
  turretJammed = false;

  get crewAlive() {
    return this.crew.filter((c) => c.state === 'ok' || c.state === 'wounded').length;
  }

  /** condition 0..1 derived from crew and components (for the compact HUD bar only) */
  get condition() {
    if (this.state === 'destroyed') return 0;
    let s = 1;
    for (const c of this.crew) if (c.state === 'dead') s -= 0.14; else if (c.state === 'wounded') s -= 0.05;
    for (const c of this.comps) {
      if (c.def.kind === 'crew' || c.def.kind === 'structure') continue;
      if (c.status === 'destroyed') s -= c.def.kind === 'engine' || c.def.kind === 'breech' ? 0.2 : 0.08;
      else if (c.status === 'damaged') s -= 0.04;
    }
    if (this.tracksBroken.L || this.tracksBroken.R) s -= 0.12;
    if (this.fire) s -= 0.25;
    if (this.barrelDestroyed) s -= 0.2;
    return clamp(s, 0.02, 1);
  }

  get forward() {
    return new THREE.Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading));
  }

  /** screen-facing: +1 right, −1 left */
  get facing() {
    return Math.cos(this.heading) >= 0 ? 1 : -1;
  }

  /* ================================================================== frames */

  /** world matrix of a frame (hull / turret / gun) — valid after syncTransforms */
  frameMatrix(f: Frame) {
    return f === 'hull' ? this.model.hull.matrixWorld : f === 'turret' ? this.model.turret.matrixWorld : this.model.gun.matrixWorld;
  }

  /** matrix taking frame-local coordinates to HULL coordinates */
  frameToHull(f: Frame, out = new THREE.Matrix4()) {
    if (f === 'hull') return out.identity();
    if (f === 'turret') return out.copy(this.model.turret.matrix);
    return out.multiplyMatrices(this.model.turret.matrix, this.model.gun.matrix);
  }

  muzzleWorld(out = new THREE.Vector3()) {
    return out.copy(this.model.muzzle).applyMatrix4(this.model.gun.matrixWorld);
  }

  boreDirWorld(out = new THREE.Vector3()) {
    return out.set(1, 0, 0).transformDirection(this.model.gun.matrixWorld);
  }

  turretWorld(out = new THREE.Vector3()) {
    return out.setFromMatrixPosition(this.model.turret.matrixWorld);
  }

  /** eye point used for observation (commander's cupola) */
  eyeWorld(out = new THREE.Vector3()) {
    return out.copy(this.model.commanderHatch).applyMatrix4(this.model.turret.matrixWorld);
  }

  centerWorld(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + this.model.height * 0.5, this.pos.z);
  }

  syncTransforms() {
    const r = this.root;
    r.position.copy(this.pos);
    r.rotation.set(0, 0, 0);
    r.rotation.order = 'YXZ';
    r.rotation.y = this.heading;
    r.rotation.z = this.pitch;
    r.rotation.x = this.roll;
    this.model.turret.rotation.y = this.turretYaw;
    this.model.gun.rotation.z = this.gunElev;
    this.model.barrel.position.x = -this.recoil;
    r.updateMatrixWorld(true);
  }

  /* ================================================================== update */

  update(dt: number, w: World) {
    if (this.state === 'destroyed') {
      this.speed = approach(this.speed, 0, 6 * dt);
      this.updateFire(dt, w);
      this.syncTransforms();
      return;
    }
    this.updateCrewSwaps(dt);
    this.updateFire(dt, w);
    this.updateBailout(dt, w);
    this.drive(dt, w);
    this.layGun(dt, w);
    this.updateLoading(dt, w.time);
    if (this.state === 'active') {
      if (this.ctl.fire) this.tryFire(w);
      if (this.ctl.mg) this.fireMG(dt, w);
    }
    this.mgCool = Math.max(0, this.mgCool - dt);
    this.recoil = approach(this.recoil, 0, dt * (this.recoil > 0.25 ? 3.5 : 0.9));
    this.updateRepair(dt, w);
    this.syncTransforms();
    this.model.rootInv.value.copy(this.root.matrixWorld).invert();
    this.updateVisuals(dt, w);
  }

  /* ------------------------------------------------------------------ drivetrain */

  private drive(dt: number, w: World) {
    const spec = this.spec;
    const m = (spec.massT.value + this.extraMassT) * 1000;
    const surf = w.terrain.surface(this.pos.x, this.pos.z);
    const engine = this.compStatus('engine');
    const trans = this.compStatus('transmission');
    const driver = this.stationEff('driver');
    let P = spec.enginePowerKw.value * 1000 * (engine === 'destroyed' ? 0 : engine === 'damaged' ? 0.45 : 1);
    P *= 1 - 0.1 * this.wear; // a worn engine has lost some power (an overhaul resets wear)
    const canMove = this.state === 'active' && !this.immobile && trans !== 'destroyed';
    const roadV = spec.maxSpeedKmh.value / 3.6;
    const offV = spec.offroadKmh.value / 3.6;
    let vmax = surf.kind === 'road' || surf.kind === 'bridge' ? roadV : surf.kind === 'mud' ? offV * 0.55 : offV * 1.15;
    vmax = Math.min(vmax, roadV);
    if (trans === 'damaged') vmax *= 0.6;
    vmax *= 0.75 + 0.25 * driver;
    const vrev = spec.reverseKmh.value / 3.6;
    const thr = canMove ? clamp(this.ctl.throttle, -1, 1) : 0;
    const g = 9.81;
    // traction-limited tractive effort and power-limited effort (η ≈ 0.75 through the driveline)
    const traction = surf.traction * (surf.kind === 'mud' && this.upgrades.has('track_grousers') ? 1.15 : 1);
    const fTraction = traction * m * g;
    const v = this.speed;
    const fPower = (P * 0.75) / Math.max(1.6, Math.abs(v));
    let F = thr * Math.min(fTraction, fPower);
    // rolling resistance grows when steering (skid-steer losses) and with grade
    const steering = Math.abs(this.yawRate) > 0.02 ? 1.6 : 1;
    const slope = this.slopeAlongHeading(w);
    const R = surf.roll * m * g * steering;
    const grade = m * g * Math.sin(slope);
    let a = (F - grade) / m;
    if (Math.abs(v) > 0.05) a -= Math.sign(v) * (R / m);
    else if (Math.abs(F - grade) < R) a = -v / Math.max(dt, 1e-3);
    if (this.ctl.brake || thr === 0) a -= Math.sign(v) * Math.min(Math.abs(v) / dt, thr === 0 ? 1.4 : 4.5);
    this.speed = clamp(v + a * dt, -vrev, vmax);
    if (!canMove) this.speed = approach(this.speed, 0, 5 * dt);

    // steering: rate limited by speed / minimum radius (controlled differential cannot pivot)
    const Rmin = spec.turnRadiusM.value;
    const pivot = spec.steering.startsWith('Clutch') ? 10 * DEG : 0;
    const wMax = Math.max(Math.abs(this.speed) / Rmin, canMove ? pivot : 0) * (0.7 + 0.3 * driver);
    let want = 0;
    if (this.ctl.targetHeading !== null && canMove) {
      const err = wrapAngle(this.ctl.targetHeading - this.heading);
      // proportional steering with a dead band, followed by a first-order lag: converges
      // without the overshoot that made the hull wobble left and right
      want = Math.abs(err) < 0.004 ? 0 : clamp(err * 2.0, -wMax, wMax);
    }
    this.yawRate += (want - this.yawRate) * (1 - Math.exp(-7 * dt));
    this.heading = wrapAngle(this.heading + this.yawRate * dt);

    // integrate position
    const f = this.forward;
    this.pos.x += f.x * this.speed * dt;
    this.pos.z += f.z * this.speed * dt;
    w.collideTank(this);
    // conform to the ground
    const L = this.model.halfLength * 0.8, W = this.model.halfWidth * 0.8;
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    const hAt = (lx: number, lz: number) => w.terrain.height(this.pos.x + lx * c + lz * s, this.pos.z - lx * s + lz * c);
    const hf = hAt(L, 0), hb = hAt(-L, 0), hl = hAt(0, -W), hr = hAt(0, W);
    const targetPitch = Math.atan2(hf - hb, 2 * L);
    const targetRoll = Math.atan2(hl - hr, 2 * W);
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 8);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 8);
    this.pos.y = (hf + hb + hl + hr) / 4;
  }

  private slopeAlongHeading(w: World) {
    const f = this.forward;
    const h0 = w.terrain.height(this.pos.x - f.x * 2, this.pos.z - f.z * 2);
    const h1 = w.terrain.height(this.pos.x + f.x * 2, this.pos.z + f.z * 2);
    return Math.atan2(h1 - h0, 4);
  }

  /* ------------------------------------------------------------------ turret & gun laying */

  private layGun(dt: number, w: World) {
    const gunner = this.stationEff('gunner');
    const mode = this.traverseMode;
    let rate = (mode === 'powered' ? this.spec.traverseDegS.value : mode === 'manual' ? this.spec.manualTraverseDegS.value : 0) * DEG;
    rate *= gunner > 0 ? 0.7 + 0.3 * gunner : 0.4 * (this.stationEff('commander') > 0 ? 1 : 0);
    const aim = this.ctl.aim;
    const elevRate = this.spec.elevationRateDegS.value * DEG * (gunner > 0 ? 1 : 0.5);
    const [emin, emax] = this.spec.elevation.value;
    if (!aim || this.state !== 'active') {
      this.layT = 0;
      return;
    }
    // aim point into the hull frame
    const inv = _m.copy(this.root.matrixWorld).invert();
    const local = _v.copy(aim).applyMatrix4(inv).sub(this.model.turretPivot);
    const wantYaw = Math.atan2(-local.z, local.x);
    const prevYaw = this.turretYaw;
    this.turretYaw = approachAngle(this.turretYaw, wantYaw, rate * dt);
    // elevation: line of sight in the turret frame + superelevation for the range
    const tm = this.model.turret.matrixWorld;
    const tLocal = new THREE.Vector3().copy(aim).applyMatrix4(new THREE.Matrix4().copy(tm).invert());
    const tr = this.model.trunnion.clone().sub(this.model.turretPivot);
    const dx = Math.hypot(tLocal.x - tr.x, tLocal.z - tr.z);
    const dy = tLocal.y - tr.y;
    const range = Math.hypot(dx, dy);
    let sup = 0;
    const round = this.loaded ?? this.loading ?? getAmmo(this.selected);
    if (round) {
      const setRange = this.ctl.manualRange ?? range * (1 + this.rangeErr);
      sup = rangeTable(round).superelevation(setRange);
    }
    const wantElev = clamp(Math.atan2(dy, dx) + sup, emin * DEG, emax * DEG);
    // gyrostabilizer: holds the gun's elevation in space while the hull pitches; without it the
    // gun pitches with the hull and the gunner's slow handwheel has to catch up
    const stab = this.spec.stabilizer && this.ctl.stabilizer;
    const comp = stab ? (this.pitch - this.prevPitch) * 0.85 : 0;
    this.prevPitch = this.pitch;
    this.gunElev = clamp(approach(this.gunElev - comp, wantElev, elevRate * dt), emin * DEG, emax * DEG);
    const settled = Math.abs(wrapAngle(this.turretYaw - wantYaw)) < 0.004 && Math.abs(this.gunElev - wantElev) < 0.003;
    this.layT = settled ? this.layT + dt : 0;
    this.turretMoving = Math.abs(wrapAngle(this.turretYaw - prevYaw)) > 1e-4;
    void w;
  }
  private prevPitch = 0;
  turretMoving = false;

  /* ------------------------------------------------------------------ loading */

  totalRounds() {
    let n = 0;
    for (const k in this.ammoCount) n += this.ammoCount[k];
    return n;
  }

  private takeRound(id: string): AmmoDef | null {
    if ((this.ammoCount[id] ?? 0) <= 0) {
      const alt = Object.keys(this.ammoCount).find((k) => this.ammoCount[k] > 0);
      if (!alt) return null;
      id = alt;
    }
    this.ammoCount[id]--;
    // the round leaves its rack
    const racks = this.comps.filter((c) => c.def.kind === 'ammo' && c.rounds > 0 && c.status !== 'destroyed');
    const rack = racks.find((r) => r.def.ready) ?? racks[0];
    if (rack) rack.rounds--;
    return getAmmo(id);
  }

  /** loader cycle: ready rack vs stowage, loader skill and station efficiency */
  private loadTime() {
    const [ready, stowed] = this.spec.loadCycleS.value;
    const fromReady = this.readyRounds > 0;
    let t = fromReady ? ready : stowed;
    const loaderSeat = this.seat('loader');
    let eff = stationEfficiency(loaderSeat?.occupant, 'loader');
    let skill = loaderSeat?.occupant?.skills.loading ?? 0.5;
    if (eff === 0) {
      // nobody at the loader's station: commander (or radio op) loads, much slower
      const cmd = this.seat('commander')?.occupant;
      eff = cmd && cmd.state !== 'dead' && cmd.state !== 'bailed' ? 0.5 : 0;
      skill = 0.35;
    }
    if (eff === 0) return Infinity;
    t *= 1.25 - 0.5 * skill;
    t /= eff;
    if (Math.abs(this.speed) > 2) t *= 1.15;
    if (this.compStatus('breech') === 'damaged') t *= 1.5;
    return t * this.rng.range(0.92, 1.12);
  }

  private updateLoading(dt: number, now: number) {
    if (this.state !== 'active') return;
    if (!this.loaded && !this.loading) {
      const r = this.takeRound(this.selected);
      if (r) {
        this.loading = r;
        this.loadDur = this.loadTime();
        this.loadT = 0;
        if (this.readyRounds > 0) this.readyRounds--;
      }
    }
    if (this.loading) {
      this.loadT += dt;
      if (this.loadT >= this.loadDur) {
        this.loaded = this.loading;
        this.loading = null;
      }
    }
    // the crew restocks the ready rack from stowage when not firing
    if (this.readyRounds < this.spec.readyRack && now - this.lastShotT > 8 && this.stationEff('loader') > 0) this.readyRounds = Math.min(this.spec.readyRack, this.readyRounds + dt / 12);
  }

  get reloadFraction() {
    if (this.loaded) return 1;
    if (this.loading) return clamp(this.loadT / this.loadDur, 0, 1);
    return 0;
  }

  /** select ammunition for the NEXT load; a loaded round of another type stays in the breech */
  selectAmmo(id: string, unload = false) {
    if (!(id in this.ammoCount)) return;
    this.selected = id;
    if (unload && this.loaded && this.loaded.id !== id && this.ammoCount[id] > 0) {
      // swap the round in the breech (counts as a reload)
      this.ammoCount[this.loaded.id] = (this.ammoCount[this.loaded.id] ?? 0) + 1;
      this.loaded = null;
    }
  }

  /* ------------------------------------------------------------------ firing */

  tryFire(w: World) {
    if (!this.loaded || !this.gunOperable) return false;
    const a = this.loaded;
    const gunner = this.seat('gunner')?.occupant;
    const skill = gunner?.skills.gunnery ?? 0.5;
    // dispersion: gun + crew + moving / unstabilised
    let mil = this.gunDef.dispersionMil.value;
    mil += (1 - skill) * 0.5;
    mil /= Math.max(0.3, this.stationEff('gunner'));
    if (this.barrelDamaged) mil *= 2.5;
    if (!this.upgrades.has('gun_sight_service')) mil += this.wear * 0.3;
    if (this.compStatus('optics') !== 'ok') mil *= 1.6;
    const moving = Math.abs(this.speed) > 0.6;
    if (moving) mil += this.spec.stabilizer && this.ctl.stabilizer ? 2.5 : 7;
    if (this.turretMoving) mil += 2;
    const dir = this.boreDirWorld();
    const sd = mil / 1000;
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(dir, up).normalize();
    const up2 = new THREE.Vector3().crossVectors(side, dir).normalize();
    dir.addScaledVector(side, this.rng.normal(0, sd)).addScaledVector(up2, this.rng.normal(0, sd)).normalize();
    const muzzle = this.muzzleWorld();
    const v0 = a.muzzleVelocity.value * this.rng.range(0.995, 1.005);
    w.spawnShell(a, muzzle, dir.multiplyScalar(v0), this);
    w.effects.muzzleBlast(muzzle, this.boreDirWorld(), this.gunDef.caliberMm * this.gunDef.blast, w.terrain.height(muzzle.x, muzzle.z));
    w.audio.cannon(muzzle, this.gunDef.caliberMm, this.gunDef.blast);
    w.noise(muzzle, 900, this.team);
    this.revealT = 12;
    this.recoil = 0.32;
    this.loaded = null;
    this.lastShotT = w.time;
    this.stats.shots++;
    // a shot rocks the vehicle slightly
    this.pitch += 0.006;
    return true;
  }

  private fireMG(dt: number, w: World) {
    if (this.mgCool > 0 || this.mgAmmo <= 0) return;
    const gunner = this.stationEff('gunner');
    if (gunner === 0) return;
    this.mgCool = 60 / 800 / Math.max(0.5, gunner);
    this.mgAmmo--;
    const p = this.model.coax.clone().applyMatrix4(this.model.gun.matrixWorld);
    const d = this.boreDirWorld();
    d.x += this.rng.normal(0, 0.006); d.y += this.rng.normal(0, 0.006); d.z += this.rng.normal(0, 0.006);
    // coax is zeroed with the main gun's lay: correct for the rifle bullet's flatter trajectory
    w.spawnBullet(p, d.normalize().multiplyScalar(820), this.team, this, 'mg');
    if (this.rng.chance(0.25)) w.effects.particles.glow.spawn({ pos: p, life: 0.04, size: 0.35, color: 0xffd090, shape: 1 });
    w.audio.mg(p, this.nation === 'GER');
    void dt;
  }

  /* ------------------------------------------------------------------ crew changes */

  private updateCrewSwaps(dt: number) {
    this.swapT -= dt;
    if (this.swapT > 0) return;
    const order: CrewRole[] = ['driver', 'gunner', 'loader', 'commander', 'radio'];
    const donors: CrewRole[] = ['radio', 'commander', 'loader'];
    for (const role of order) {
      const seat = this.seat(role);
      if (!seat) continue;
      const occ = seat.occupant;
      if (occ && occ.state !== 'dead' && occ.state !== 'bailed') continue;
      for (const d of donors) {
        if (d === role) continue;
        if (order.indexOf(d) < order.indexOf(role)) continue;
        const ds = this.seat(d);
        const m = ds?.occupant;
        if (ds && m && (m.state === 'ok' || m.state === 'wounded')) {
          seat.occupant = m;
          m.station = role;
          ds.occupant = null;
          this.swapT = 6;
          return;
        }
      }
    }
  }

  /* ------------------------------------------------------------------ fire & bail-out */

  ignite(where: FireState['where'], w: World) {
    if (this.fire) {
      if (where === 'ammo') this.fire.where = 'ammo';
      this.fire.intensity = Math.min(2, this.fire.intensity + 0.4);
      return;
    }
    this.fire = { where, intensity: where === 'engine' ? 0.6 : 1, t: 0, extinguisherTried: false, cookoffAt: where === 'ammo' ? this.rng.range(4, 14) : Infinity };
    w.log(`${this.callsign}: FIRE in the ${where === 'engine' ? 'engine compartment' : where === 'ammo' ? 'ammunition' : 'fighting compartment'}`, this.team, 'warn');
    if (!this.fireEm) {
      const local = where === 'engine' ? new THREE.Vector3(-1.8, this.model.height * 0.75, 0) : new THREE.Vector3(0.3, this.model.height * 0.9, 0);
      const pos = local.applyMatrix4(this.root.matrixWorld);
      this.fireEm = w.effects.burn(pos, 0.8, Infinity, this.root);
      this.burnFx = this.fireEm as { intensity: number };
    }
  }

  private updateFire(dt: number, w: World) {
    const f = this.fire;
    if (!f) return;
    f.t += dt;
    if (this.burnFx) this.burnFx.intensity = 0.5 + f.intensity * 0.8;
    // automatic / hand extinguishers act on engine fires after a few seconds
    if (!f.extinguisherTried && f.where === 'engine' && f.t > 3 && this.state !== 'destroyed') {
      f.extinguisherTried = true;
      if (this.rng.chance(0.6)) {
        w.log(`${this.callsign}: engine fire extinguished`, this.team, 'info');
        this.fire = null;
        if (this.fireEm) { w.effects.removeEmitter(this.fireEm as never); this.fireEm = null; }
        return;
      }
    }
    f.intensity = Math.min(2, f.intensity + dt * (f.where === 'engine' ? 0.04 : 0.12));
    // the fire damages what is near it
    for (const c of this.comps) {
      if (c.def.kind === 'crew' && f.where !== 'engine') this.damageComp(c, dt * 120 * f.intensity, w, null);
      if (c.def.kind === 'engine') this.damageComp(c, dt * 400 * f.intensity, w, null);
    }
    if (f.where !== 'ammo' && f.t > 25 && this.rng.chance(dt * 0.05)) {
      f.where = 'ammo';
      f.cookoffAt = f.t + this.rng.range(3, 10);
    }
    if (f.t > f.cookoffAt && this.state !== 'destroyed') this.catastrophic(w, 'ammunition cook-off');
    if (this.state !== 'destroyed' && f.t > 40 && f.intensity > 1.5) this.knockOut(w, 'burnt out', true);
  }

  private updateBailout(dt: number, w: World) {
    if (this.state === 'destroyed') return;
    if (this.bailT >= 0) {
      this.bailT -= dt;
      if (this.bailT < 0) this.bailOut(w);
      return;
    }
    if (this.state !== 'active') return;
    const alive = this.crewAlive;
    if (alive === 0) {
      this.knockOut(w, 'crew killed', false);
      return;
    }
    const fireInside = this.fire && (this.fire.where !== 'engine' || this.fire.intensity > 1.2);
    let bail = !!fireInside;
    if (!this.isPlayer) {
      const dead = this.crew.filter((c) => c.state === 'dead').length;
      if (dead >= 3) bail = true;
      if (this.immobile && !this.gunOperable) bail = true;
    }
    if (bail) this.bailT = this.rng.range(1.2, 3.5);
  }

  /** the crew abandons the vehicle; survivors become infantry */
  bailOut(w: World) {
    if (this.state === 'destroyed' || this.state === 'abandoned') return;
    const survivors = this.crew.filter((c) => c.state === 'ok' || c.state === 'wounded');
    for (const h of this.model.hatches) h.rotation.x = -1.9;
    for (const c of survivors) c.state = 'bailed';
    for (const s of this.comps) if (s.def.kind === 'crew') s.occupant = null;
    this.state = 'abandoned';
    this.ctl.throttle = 0;
    w.onBailOut(this, survivors);
    w.log(`${this.callsign}: crew bailing out`, this.team, 'warn');
  }

  knockOut(w: World, reason: string, burnt: boolean) {
    if (this.state === 'destroyed') return;
    if (burnt) {
      this.state = 'destroyed';
      setBurnt(this.root, 1);
    } else if (this.state === 'active') {
      this.state = 'knocked-out';
    }
    w.onTankKilled(this, reason);
  }

  /** ammunition detonation: the turret is thrown off, the hull burns out */
  catastrophic(w: World, reason: string) {
    if (this.state === 'destroyed') return;
    const center = this.turretWorld();
    for (const c of this.crew) if (c.state !== 'bailed') c.state = 'dead';
    this.state = 'destroyed';
    w.effects.explosion(center.clone().add(new THREE.Vector3(0, 0.8, 0)), 6, false, w.terrain.height(center.x, center.z), false);
    w.effects.explosion(center.clone().add(new THREE.Vector3(0, 1.5, 0)), 3, false, w.terrain.height(center.x, center.z), false);
    w.audio.explosion(center, 6);
    setBurnt(this.root, 1);
    if (!this.turretOff) {
      this.turretOff = true;
      w.throwTurret(this);
    }
    if (!this.fire) this.fire = { where: 'ammo', intensity: 2, t: 0, extinguisherTried: true, cookoffAt: Infinity };
    this.fire.intensity = 2;
    if (!this.fireEm) this.fireEm = w.effects.burn(this.centerWorld().add(new THREE.Vector3(0, 0.6, 0)), 1.6, Infinity, this.root);
    w.onTankKilled(this, reason);
  }

  /* ------------------------------------------------------------------ damage */

  /** add damaging energy (J) to a component, apply consequences. Returns a short effect label. */
  damageComp(c: CompState, J: number, w: World, cause: 'projectile' | 'spall' | 'blast' | 'jet' | null, hot = false): string | null {
    if (J <= 0) return null;
    c.energy += J;
    c.flash = 1;
    const [t1, t2] = c.def.thresholds;
    const prev = c.status;
    if (cause === 'projectile' && c.def.kind !== 'structure') c.energy = Math.max(c.energy, t2);
    c.status = c.energy >= t2 ? 'destroyed' : c.energy >= t1 ? 'damaged' : 'ok';
    let label: string | null = null;
    if (c.def.kind === 'crew') {
      const m = c.occupant;
      if (m && m.state !== 'dead' && m.state !== 'bailed') {
        m.wound = c.energy;
        if (c.status === 'destroyed') {
          m.state = 'dead';
          label = `${m.station ? m.station : m.role} killed`;
          w.log(`${this.callsign}: ${m.rank} ${m.name} (${m.station}) killed`, this.team, 'bad');
          c.energy = 0;
          c.status = 'ok';
        } else if (c.status === 'damaged' && m.state === 'ok') {
          m.state = 'wounded';
          label = `${m.station} wounded`;
        }
      }
      return label;
    }
    if (c.status === prev && !hot) return null;
    switch (c.def.kind) {
      case 'ammo': {
        const pIgn = c.def.wet ? 0.12 : 0.55;
        const pHit = cause === 'projectile' || cause === 'jet' ? 1 : clamp(J / 1500, 0.1, 1);
        if (c.rounds > 0 && this.rng.chance(pIgn * pHit)) {
          if (this.rng.chance(c.def.wet ? 0.2 : 0.35)) {
            label = 'AMMUNITION DETONATION';
            this.catastrophic(w, 'ammunition detonation');
          } else {
            label = 'Ammunition fire';
            this.ignite('ammo', w);
          }
        } else if (c.status === 'destroyed') {
          label = `${c.def.name} destroyed`;
          c.rounds = 0;
        } else label = `${c.def.name} hit`;
        break;
      }
      case 'fuel': {
        const pIgn = this.spec.fuel === 'gasoline' ? 0.45 : 0.15;
        if (this.rng.chance(pIgn * (hot ? 1.3 : 1) * clamp(J / 600, 0.3, 1))) {
          label = 'Fuel fire';
          this.ignite('fighting', w);
        } else label = 'Fuel tank holed';
        break;
      }
      case 'engine':
        label = c.status === 'destroyed' ? 'Engine destroyed' : 'Engine damaged';
        if (this.rng.chance(c.status === 'destroyed' ? 0.3 : 0.08)) {
          this.ignite('engine', w);
          label += ' — fire';
        }
        break;
      case 'transmission':
        label = c.status === 'destroyed' ? 'Transmission destroyed' : 'Transmission damaged';
        break;
      case 'breech':
        label = c.status === 'destroyed' ? 'Gun breech destroyed' : 'Gun breech damaged';
        break;
      case 'traverse':
        label = c.status === 'destroyed' ? 'Turret traverse knocked out' : 'Traverse drive damaged';
        if (c.status === 'destroyed' && c.def.frame === 'turret' && this.rng.chance(0.35)) {
          this.turretJammed = true;
          label = 'Turret ring jammed';
        }
        break;
      case 'radio':
        label = c.status === 'destroyed' ? 'Radio destroyed' : 'Radio damaged';
        break;
      case 'optics':
        label = c.status === 'destroyed' ? 'Gunner\'s sight destroyed' : 'Sight damaged';
        break;
      default:
        label = null;
    }
    return label;
  }

  breakTrack(side: -1 | 1, w: World) {
    const k = side > 0 ? 'R' : 'L';
    if (this.tracksBroken[k]) return;
    this.tracksBroken[k] = true;
    this.repairT = 0;
    // a broken track run drops off the sprocket: hide it
    const run = this.model.tracks.find((t) => t.side === side);
    if (run) {
      run.mesh.visible = false;
      for (const e of run.extras) e.visible = false;
    }
    w.log(`${this.callsign}: ${side > 0 ? 'right' : 'left'} track broken`, this.team, 'warn');
  }

  /** crew field repair of tracks (game abstraction: real track repairs took far longer) */
  private updateRepair(dt: number, w: World) {
    if (!(this.tracksBroken.L || this.tracksBroken.R) || this.state !== 'active') return;
    if (w.time - this.lastHitT < 6) return;
    const helpers = this.crew.filter((c) => c.state === 'ok').length;
    if (helpers < 2) return;
    const skill = Math.max(...this.crew.map((c) => (c.state === 'ok' ? c.skills.repair : 0)));
    const rate = (0.6 + skill) * (this.upgrades.has('crew_repair') ? 1.3 : 1) * (helpers / 5) * w.repairBoost(this);
    this.repairT += dt * rate;
    if (this.repairT >= 45) {
      for (const side of [-1, 1] as const) {
        const k = side > 0 ? 'R' : 'L';
        if (!this.tracksBroken[k]) continue;
        this.tracksBroken[k] = false;
        const run = this.model.tracks.find((t) => t.side === side);
        if (run) {
          run.mesh.visible = true;
          for (const e of run.extras) e.visible = true;
        }
      }
      this.repairT = 0;
      w.log(`${this.callsign}: track repaired`, this.team, 'info');
    }
  }

  get repairProgress() {
    return clamp(this.repairT / 45, 0, 1);
  }

  /* ------------------------------------------------------------------ visuals */

  private updateVisuals(dt: number, w: World) {
    const d = this.speed * dt;
    const turnD = this.yawRate * dt * this.model.halfWidth;
    for (const run of this.model.tracks) {
      if (!run.mesh.visible) continue;
      // tracks move with the ground (link offset opposite to travel on the bottom run)
      run.offset -= d + run.side * turnD;
      layoutTrack(run);
    }
    for (const wh of this.model.wheels) wh.obj.rotation.z -= (d + wh.side * turnD) / wh.radius;
    const sp = Math.abs(this.speed);
    if (sp > 0.6) {
      const surf = w.terrain.surface(this.pos.x, this.pos.z);
      const back = this.forward.multiplyScalar(-this.model.halfLength * Math.sign(this.speed || 1));
      for (const s of [-1, 1]) {
        const p = this.pos.clone().add(back).add(new THREE.Vector3(Math.sin(this.heading) * s * this.model.halfWidth * 0.8, 0.25, Math.cos(this.heading) * s * this.model.halfWidth * 0.8));
        w.effects.dust(p, surf.dust * sp * dt * 6, surf.kind === 'mud' ? 0x5a4a38 : 0xa08f72, 1.2 + sp * 0.08);
      }
    }
    if (this.state === 'active' && this.compStatus('engine') !== 'destroyed') {
      for (const e of this.model.exhausts) {
        const p = e.clone().applyMatrix4(this.root.matrixWorld);
        w.effects.exhaust(p, 0.12 + Math.abs(this.ctl.throttle) * 0.35);
      }
    }
    w.audio.engine(this, this.state === 'active' && this.compStatus('engine') !== 'destroyed', Math.abs(this.speed), Math.abs(this.ctl.throttle));
    void this.engineAudio;
  }

  dispose() {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    for (const m of this.model.materials) m.dispose();
  }
}
