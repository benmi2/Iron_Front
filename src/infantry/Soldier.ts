import * as THREE from 'three';
import { approach, clamp } from '../core/math';
import { RNG } from '../core/rng';
import { ammo as getAmmo } from '../data/ammo';
import { GRENADES, SMALL_ARMS, type SmallArm } from '../data/smallarms';
import { SoldierRig } from './rig/SoldierRig';
import { lookFor, type SoldierLook } from './rig/SoldierPainter';
import { PX } from './rig/Skeleton';
import type { World } from '../world/World';
import type { Team } from '../world/Team';
import type { Tank } from '../vehicles/Tank';
import type { Obstacle } from '../world/Obstacle';
import type { SoldierAI } from '../ai/SoldierAI';
import type { Squad } from '../ai/Squad';
import type { CrewMember } from '../vehicles/Crew';

export type SoldierRole = 'rifleman' | 'smg' | 'mg' | 'at' | 'faust' | 'officer' | 'medic' | 'engineer' | 'crew';
export type SoldierState = 'ok' | 'wounded' | 'down' | 'dead';

export interface WeaponState {
  def: SmallArm;
  mag: number;
  reserve: number;
}

const ROLE_KIT: Record<'USA' | 'GER', Record<SoldierRole, { primary: string; at?: string; grenades: number; smoke: number }>> = {
  USA: {
    rifleman: { primary: 'garand', grenades: 2, smoke: 0 },
    smg: { primary: 'thompson', grenades: 2, smoke: 1 },
    mg: { primary: 'bar', grenades: 1, smoke: 0 },
    at: { primary: 'carbine', at: 'bazooka', grenades: 1, smoke: 0 },
    faust: { primary: 'carbine', at: 'bazooka', grenades: 1, smoke: 0 },
    officer: { primary: 'thompson', grenades: 1, smoke: 2 },
    medic: { primary: 'm1911', grenades: 0, smoke: 1 },
    engineer: { primary: 'carbine', grenades: 2, smoke: 1 },
    crew: { primary: 'm1911', grenades: 0, smoke: 0 },
  },
  GER: {
    rifleman: { primary: 'kar98k', grenades: 2, smoke: 0 },
    smg: { primary: 'mp40', grenades: 2, smoke: 1 },
    mg: { primary: 'mg42', grenades: 1, smoke: 0 },
    at: { primary: 'kar98k', at: 'panzerschreck', grenades: 1, smoke: 0 },
    faust: { primary: 'kar98k', at: 'panzerfaust', grenades: 2, smoke: 0 },
    officer: { primary: 'mp40', grenades: 1, smoke: 2 },
    medic: { primary: 'p38', grenades: 0, smoke: 1 },
    engineer: { primary: 'mp40', grenades: 2, smoke: 1 },
    crew: { primary: 'p38', grenades: 0, smoke: 0 },
  },
};

const US_NAMES = ['Adams', 'Brooks', 'Coleman', 'Duffy', 'Evans', 'Garcia', 'Hill', 'Jackson', 'Kelly', 'Lopez', 'Martin', 'Nowak', 'Owens', 'Parker', 'Quinn', 'Russo', 'Stone', 'Turner', 'Vargas', 'Wright'];
const DE_NAMES = ['Bauer', 'Dietrich', 'Engel', 'Frank', 'Graf', 'Haas', 'Jung', 'Keller', 'Lehmann', 'Maier', 'Nagel', 'Otto', 'Peters', 'Roth', 'Schulz', 'Thiel', 'Vogel', 'Winkler', 'Ziegler', 'Brandt'];

let seq = 1;

export class Soldier {
  readonly id = seq++;
  readonly kind = 'soldier' as const;
  team: Team;
  nation: 'USA' | 'GER';
  role: SoldierRole;
  name: string;
  rank: string;
  rng: RNG;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  facing: 1 | -1 = 1;
  aimAngle = 0;
  aimDir = new THREE.Vector3(1, 0, 0);
  crouch = 0;
  health = 100;
  state: SoldierState = 'ok';
  downT = 0;
  deadT = 0;
  suppression = 0;
  morale = 1;
  weapons: WeaponState[] = [];
  current = 0;
  grenades: number;
  smokes: number;
  fireCool = 0;
  reloadT = 0;
  kick = 0;
  throwT = 0;
  private throwTarget: THREE.Vector3 | null = null;
  private throwSmoke = false;
  skill: number;
  inTank: Tank | null = null;
  ai: SoldierAI | null = null;
  squad: Squad | null = null;
  rig: SoldierRig;
  look: SoldierLook;
  isPlayer = false;
  /** the cover object protecting this soldier from the current threat direction */
  cover: Obstacle | null = null;
  /** crew member record when this soldier is a bailed-out tanker */
  crewRecord: CrewMember | null = null;
  revealT = 0;
  stats = { kills: 0, shots: 0, tankHits: 0 };
  ctl = {
    moveX: 0,
    moveZ: 0,
    sprint: false,
    crouch: false,
    aim: null as THREE.Vector3 | null,
    fire: false,
    reload: false,
    throwAt: null as THREE.Vector3 | null,
    throwSmoke: false,
    weapon: -1,
  };

  constructor(team: Team, nation: 'USA' | 'GER', role: SoldierRole, x: number, z: number, seed: number, skill = 0.5) {
    this.team = team;
    this.nation = nation;
    this.role = role;
    this.rng = new RNG(seed);
    this.skill = skill;
    this.name = this.rng.pick(nation === 'USA' ? US_NAMES : DE_NAMES);
    this.rank = role === 'officer' ? (nation === 'USA' ? 'Lt.' : 'Lt.') : role === 'medic' ? (nation === 'USA' ? 'T/5' : 'San.') : nation === 'USA' ? 'Pfc.' : 'Gren.';
    this.pos.set(x, 0, z);
    const kit = ROLE_KIT[nation][role];
    const pd = SMALL_ARMS[kit.primary];
    this.weapons.push({ def: pd, mag: pd.magazine, reserve: pd.magazine * (pd.auto ? 5 : 8) });
    if (kit.at) {
      const ad = SMALL_ARMS[kit.at];
      this.weapons.push({ def: ad, mag: 1, reserve: (ad.rounds ?? 1) - 1 });
    }
    this.grenades = kit.grenades;
    this.smokes = kit.smoke;
    this.look = lookFor(nation, role === 'crew' ? 'crew' : role === 'officer' ? 'officer' : role === 'medic' ? 'medic' : 'infantry', seed);
    this.rig = new SoldierRig(this.look);
    if (kit.at && role === 'faust') this.current = 0;
    this.rig.setWeapon(this.weapon.def.art);
  }

  get weapon() {
    return this.weapons[this.current];
  }

  get alive() {
    return this.state === 'ok' || this.state === 'wounded';
  }

  get height() {
    return (1.72 - this.crouch * 0.6) * (this.state === 'down' ? 0.25 : 1);
  }

  get center() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.height * 0.55, this.pos.z);
  }

  get eye() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.height * 0.93, this.pos.z);
  }

  hasAT() {
    return this.weapons.some((w) => w.def.kind === 'at' && w.mag + w.reserve > 0);
  }

  selectWeapon(i: number) {
    if (i < 0 || i >= this.weapons.length || i === this.current) return;
    this.current = i;
    this.reloadT = 0;
    this.fireCool = 0.6;
    this.rig.setWeapon(this.weapon.def.art);
  }

  /* ------------------------------------------------------------------ update */

  update(dt: number, w: World) {
    this.revealT = Math.max(0, this.revealT - dt);
    if (this.state === 'dead') {
      this.deadT = Math.min(1, this.deadT + dt * 2.2);
      this.animate(dt);
      return;
    }
    if (this.state === 'down') {
      this.downT -= dt;
      if (this.downT <= 0) this.die(w, null);
      this.deadT = Math.min(0.92, this.deadT + dt * 2.5);
      this.animate(dt);
      return;
    }
    if (this.inTank) return;
    this.suppression = Math.max(0, this.suppression - dt * (0.12 + this.skill * 0.08));
    if (this.ctl.weapon >= 0) { this.selectWeapon(this.ctl.weapon); this.ctl.weapon = -1; }

    // movement in the depth band: x = along the battlefield, z = depth lanes
    const surf = w.terrain.surface(this.pos.x, this.pos.z);
    const wounded = this.state === 'wounded' ? 0.6 : 1;
    const base = this.ctl.sprint && this.crouch < 0.5 ? 4.6 : this.crouch > 0.5 ? 1.5 : 2.4;
    const sp = base * surf.foot * wounded * (this.weapon.def.kind === 'lmg' || this.weapon.def.kind === 'at' ? 0.88 : 1);
    let mx = this.ctl.moveX, mz = this.ctl.moveZ * 0.75;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    this.vel.x = approach(this.vel.x, mx * sp, dt * 14);
    this.vel.z = approach(this.vel.z, mz * sp, dt * 14);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    w.collideSoldier(this);
    this.pos.y = w.terrain.height(this.pos.x, this.pos.z);
    this.crouch = approach(this.crouch, this.ctl.crouch || this.suppression > 0.75 ? 1 : 0, dt * 4);

    // aim
    const aim = this.ctl.aim;
    if (aim) {
      const sh = new THREE.Vector3(this.pos.x, this.pos.y + this.height * 0.78, this.pos.z);
      const d = aim.clone().sub(sh);
      if (Math.abs(d.x) > 0.3) this.facing = d.x >= 0 ? 1 : -1;
      const horiz = Math.hypot(d.x, d.z);
      const target = Math.atan2(-d.y, horiz); // rig space: negative = up
      this.aimAngle = approach(this.aimAngle, clamp(target, -1.1, 1.0), dt * 6);
      this.aimDir.copy(d).normalize();
    } else if (Math.abs(this.vel.x) > 0.3) this.facing = this.vel.x > 0 ? 1 : -1;

    // weapon handling
    this.fireCool -= dt;
    this.kick = Math.max(0, this.kick - dt * 8);
    const ws = this.weapon;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const need = ws.def.magazine - ws.mag;
        const take = Math.min(need, ws.reserve);
        ws.mag += take;
        ws.reserve -= take;
      }
    } else if ((this.ctl.reload && ws.mag < ws.def.magazine) || (ws.mag === 0 && ws.reserve > 0)) {
      if (ws.def.reloadS > 0 && ws.reserve > 0) {
        this.reloadT = ws.def.reloadS * (1.2 - this.skill * 0.4);
        w.audio.reload(this.pos);
      }
    }
    if (ws.mag === 0 && ws.reserve === 0 && ws.def.kind === 'at' && this.weapons.length > 1) this.selectWeapon(0);
    if (this.ctl.fire && this.fireCool <= 0 && this.reloadT <= 0 && ws.mag > 0 && aim && this.throwT <= 0) this.fire(w);

    // grenades
    if (this.throwT > 0) {
      this.throwT += dt * 1.6;
      if (this.throwT >= 0.62 && this.throwTarget) {
        this.releaseGrenade(w);
        this.throwTarget = null;
      }
      if (this.throwT >= 1) this.throwT = 0;
    } else if (this.ctl.throwAt) {
      const smoke = this.ctl.throwSmoke;
      if ((smoke ? this.smokes : this.grenades) > 0) {
        this.throwT = 0.01;
        this.throwTarget = this.ctl.throwAt.clone();
        this.throwSmoke = smoke;
        if (smoke) this.smokes--; else this.grenades--;
      }
      this.ctl.throwAt = null;
    }

    this.animate(dt);
  }

  private animate(dt: number) {
    const along = this.vel.x * this.facing;
    this.rig.setFacing(this.facing);
    this.rig.setPosition(this.pos.x, this.pos.y, this.pos.z);
    this.rig.animate({
      dt, speed: this.state === 'dead' || this.state === 'down' ? 0 : along, crouch: this.crouch, aim: this.aimAngle,
      aiming: !!this.ctl.aim && !(this.ctl.sprint && Math.abs(this.vel.x) > 3), hold: this.weapon.def.hold, kick: this.kick,
      reload: this.reloadT > 0 ? 1 - this.reloadT / Math.max(0.1, this.weapon.def.reloadS) : 0, throwT: this.throwT,
      dead: this.deadT, wounded: this.state === 'wounded',
    });
    this.rig.group.updateMatrixWorld(true);
  }

  /* ------------------------------------------------------------------ firing */

  private fire(w: World) {
    const ws = this.weapon;
    const d = ws.def;
    ws.mag--;
    this.fireCool = d.interval.value;
    this.kick = d.kind === 'at' ? 1 : d.auto ? 0.5 : 0.8;
    this.rig.flashT = d.kind === 'at' ? 0.1 : 0.05;
    this.stats.shots++;
    this.revealT = d.kind === 'at' ? 10 : 4;
    const muzzle = this.rig.muzzleWorld();
    const target = this.ctl.aim!;
    // spread grows with movement, suppression and poor skill; crouching steadies the aim
    const moving = Math.hypot(this.vel.x, this.vel.z) > 0.6;
    let mil = d.spreadMil * (1.6 - this.skill) * (moving ? 2.6 : 1) * (1 + this.suppression * 1.5) * (this.crouch > 0.5 ? 0.75 : 1);
    if (this.state === 'wounded') mil *= 1.5;
    // combat stress, half-seen targets and snap shooting: AI riflemen hit far less than on a range
    if (!this.isPlayer) mil *= 2.6;
    const dir = target.clone().sub(muzzle).normalize();
    if (d.kind === 'at') {
      // launchers are aimed with a ladder sight: compensate for drop over the range
      const range = target.distanceTo(muzzle);
      const v = d.muzzleVelocity.value;
      const tof = range / v;
      dir.y += (0.5 * 9.81 * tof * tof) / Math.max(1, range);
      dir.normalize();
    }
    const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    const up = new THREE.Vector3().crossVectors(side, dir);
    dir.addScaledVector(side, this.rng.normal(0, mil / 1000)).addScaledVector(up, this.rng.normal(0, mil / 1000)).normalize();
    if (d.kind === 'at' && d.rocket) {
      const a = getAmmo(d.rocket);
      w.spawnRocket(a, muzzle, dir.multiplyScalar(d.muzzleVelocity.value), this);
      // back-blast
      const back = muzzle.clone().addScaledVector(dir, -1.6 / (d.muzzleVelocity.value / d.muzzleVelocity.value));
      for (let i = 0; i < 10; i++) w.effects.particles.smoke.spawn({ pos: back, vel: dir.clone().multiplyScalar(-this.rng.range(3, 9)).add(new THREE.Vector3(this.rng.normal(0, 1), this.rng.normal(0, 1), this.rng.normal(0, 1))), life: this.rng.range(1.5, 3), size: 0.6, grow: 1, color: 0xa8a090, alpha: 0.6, drag: 2 });
      w.audio.rocket(muzzle);
      if (d.id === 'panzerfaust' && ws.mag + ws.reserve === 0) {
        // the spent tube is thrown away
        this.weapons.splice(this.current, 1);
        this.current = 0;
        this.rig.setWeapon(this.weapon.def.art);
      }
    } else {
      w.spawnBullet(muzzle, dir.multiplyScalar(d.muzzleVelocity.value), this.team, this, d.kind === 'lmg' ? 'mg' : 'rifle', d.bulletMassG);
      w.audio.gunshot(muzzle, d.id);
    }
    w.noise(muzzle, d.kind === 'at' ? 400 : 250, this.team);
  }

  private releaseGrenade(w: World) {
    const t = this.throwTarget!;
    const from = new THREE.Vector3(this.pos.x, this.pos.y + 1.6, this.pos.z);
    const def = GRENADES[this.throwSmoke ? (this.nation === 'USA' ? 'smoke_us' : 'smoke_de') : this.nation === 'USA' ? 'mk2' : 'm24'];
    const dx = t.x - from.x, dz = t.z - from.z;
    const dist = Math.min(def.throwM, Math.hypot(dx, dz));
    const ang = 0.6;
    const v = Math.sqrt((dist * 9.81) / Math.sin(2 * ang)) * this.rng.range(0.92, 1.05);
    const h = Math.hypot(dx, dz) || 1;
    const vel = new THREE.Vector3((dx / h) * v * Math.cos(ang), v * Math.sin(ang), (dz / h) * v * Math.cos(ang));
    w.spawnGrenade(def, from, vel, this);
  }

  /* ------------------------------------------------------------------ hits */

  /** segment vs body capsule; returns t in [0,1] or −1 */
  hitSegment(p0: THREE.Vector3, p1: THREE.Vector3) {
    if (!this.alive && this.state !== 'down') return -1;
    if (this.inTank) return -1;
    const r = this.state === 'down' ? 0.35 : 0.24;
    const a = new THREE.Vector3(this.pos.x, this.pos.y + 0.15, this.pos.z);
    const b = new THREE.Vector3(this.pos.x, this.pos.y + this.height, this.pos.z);
    // closest points between two segments
    const d1 = p1.clone().sub(p0), d2 = b.clone().sub(a), r0 = p0.clone().sub(a);
    const A = d1.dot(d1), E = d2.dot(d2), F = d2.dot(r0);
    const C = d1.dot(r0), B = d1.dot(d2);
    const den = A * E - B * B;
    let s = den > 1e-9 ? clamp((B * F - C * E) / den, 0, 1) : 0;
    let t = (B * s + F) / E;
    if (t < 0) { t = 0; s = clamp(-C / A, 0, 1); } else if (t > 1) { t = 1; s = clamp((B - C) / A, 0, 1); }
    const c1 = p0.clone().addScaledVector(d1, s), c2 = a.clone().addScaledVector(d2, t);
    return c1.distanceToSquared(c2) < r * r ? s : -1;
  }

  /** small-arms hit: damage by zone from the bullet's energy */
  hitByBullet(point: THREE.Vector3, energyJ: number, w: World, shooter: Soldier | Tank | null) {
    if (!this.alive && this.state !== 'down') return;
    const rel = (point.y - this.pos.y) / Math.max(0.3, this.height);
    const zone = rel > 0.86 ? 'head' : rel > 0.5 ? 'torso' : 'legs';
    if (this.cover && zone !== 'head' && this.crouch > 0.5 && this.rng.chance(0.6)) {
      // cover soaks it (Dead Meridian's cover soak, now physical where obstacles exist)
      w.effects.puff(point, 0x8a7a62, 0.6);
      return;
    }
    const base = Math.sqrt(energyJ) * 1.5;
    const mult = zone === 'head' ? 4 : zone === 'torso' ? 1.15 : 0.55;
    this.damage(base * mult * this.rng.range(0.7, 1.3), w, shooter, zone === 'head');
    w.effects.particles.smoke.spawn({ pos: point, vel: new THREE.Vector3(this.rng.normal(0, 0.5), 0.5, this.rng.normal(0, 0.5)), life: 0.5, size: 0.18, grow: 0.4, color: 0x5a1010, alpha: 0.7, drag: 3 });
  }

  hitByShell(_s: unknown, _p: THREE.Vector3, w: World) {
    this.damage(500, w, null, true);
  }

  damage(amount: number, w: World, by: Soldier | Tank | null, lethal = false) {
    if (this.state === 'dead') return;
    this.health -= amount;
    this.suppression = Math.min(1, this.suppression + 0.5);
    if (this.isPlayer) w.onPlayerHurt(amount);
    if (this.health <= 0 || lethal) {
      if (!lethal && this.health > -40 && this.rng.chance(0.55)) this.goDown(w, by);
      else this.die(w, by);
    } else if (this.health < 55 && this.state === 'ok') this.state = 'wounded';
  }

  private goDown(w: World, by: Soldier | Tank | null) {
    this.state = 'down';
    this.downT = this.rng.range(40, 90);
    w.onSoldierDown(this, by);
  }

  die(w: World, by: Soldier | Tank | null) {
    if (this.state === 'dead') return;
    const wasDown = this.state === 'down';
    this.state = 'dead';
    this.vel.set(0, 0, 0);
    if (!wasDown) w.onSoldierDown(this, by);
    w.onSoldierDead(this, by);
  }

  /** medic treatment brings a downed man back as wounded */
  revive() {
    if (this.state !== 'down') return;
    this.state = 'wounded';
    this.health = 35;
    this.deadT = 0;
  }

  suppress(amount: number) {
    this.suppression = Math.min(1, this.suppression + amount * (1.2 - this.skill * 0.5));
    this.morale = Math.max(0, this.morale - amount * 0.05);
  }

  dispose() {
    this.rig.dispose();
  }
}

export const SOLDIER_PX = PX;
