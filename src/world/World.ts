import * as THREE from 'three';
import { clamp, segmentSphere } from '../core/math';
import { RNG } from '../core/rng';
import type { AmmoDef } from '../data/ammo';
import type { GrenadeDef } from '../data/smallarms';
import { ShellSystem, type Shell } from '../ballistics/ShellSystem';
import { BulletSystem } from '../infantry/Bullets';
import { Soldier } from '../infantry/Soldier';
import { nearMissOnTank, type ImpactReport } from '../vehicles/DamageModel';
import type { CrewMember } from '../vehicles/Crew';
import type { Tank } from '../vehicles/Tank';
import type { Effects } from '../render/Effects';
import type { AudioSys } from '../audio/Audio';
import { DEPTH_MAX, DEPTH_MIN, type Terrain } from './Terrain';
import type { Obstacle } from './Obstacle';
import { enemyOf, type Team } from './Team';
import { Perception } from '../ai/Perception';

export interface SmokeCloud {
  pos: THREE.Vector3;
  radius: number;
  life: number;
  t: number;
  density: number;
}

export type LogLevel = 'info' | 'warn' | 'bad' | 'good' | 'radio';

export interface WorldEvents {
  tankKilled: (t: Tank, reason: string, killer: Tank | null) => void;
  tankHit: (t: Tank, r: ImpactReport, shooter: Tank | Soldier | null) => void;
  soldierKilled: (s: Soldier, by: Soldier | Tank | null) => void;
  bailout: (t: Tank, crew: Soldier[]) => void;
  log: (msg: string, team: Team | null, level: LogLevel) => void;
  playerHurt: (amount: number) => void;
}

const BUCKET = 10;

/**
 * Battlefield simulation container. Everything physical lives here; game modes observe it
 * through `events` and drive units through their controls.
 */
export class World {
  time = 0;
  rng = new RNG(1944);
  readonly root = new THREE.Group();
  readonly tanks: Tank[] = [];
  readonly soldiers: Soldier[] = [];
  readonly obstacles: Obstacle[] = [];
  private buckets = new Map<number, Obstacle[]>();
  readonly shells = new ShellSystem();
  readonly bullets = new BulletSystem();
  readonly smoke: SmokeCloud[] = [];
  readonly reports: ImpactReport[] = [];
  readonly perception: Perception;
  readonly listener = new THREE.Vector3();
  centerX = 0;
  x0: number;
  x1: number;
  private flying: { obj: THREE.Object3D; v: THREE.Vector3; w: THREE.Vector3; rest: boolean }[] = [];
  private craters = 0;
  events: Partial<WorldEvents> = {};
  /** engineers near a tank speed its repairs */
  engineersNear = new Map<number, number>();
  realism = false;

  constructor(readonly terrain: Terrain, readonly effects: Effects, readonly audio: AudioSys) {
    this.root.name = 'world';
    this.root.add(terrain.group);
    this.root.add(effects.group);
    this.x0 = terrain.def.x0;
    this.x1 = terrain.def.x1;
    effects.ground = (x, z) => terrain.height(x, z);
    this.perception = new Perception(this);
  }

  /* ================================================================== registry */

  addObstacle(o: Obstacle) {
    this.obstacles.push(o);
    const r = o.radius;
    for (let b = Math.floor((o.cx - r) / BUCKET); b <= Math.floor((o.cx + r) / BUCKET); b++) {
      let arr = this.buckets.get(b);
      if (!arr) this.buckets.set(b, (arr = []));
      arr.push(o);
    }
    if (o.object && !o.object.parent) this.root.add(o.object);
    return o;
  }

  addTank(t: Tank) {
    this.tanks.push(t);
    this.root.add(t.root);
    t.pos.y = this.terrain.height(t.pos.x, t.pos.z);
    t.syncTransforms();
    return t;
  }

  addSoldier(s: Soldier) {
    this.soldiers.push(s);
    this.root.add(s.rig.group);
    s.pos.y = this.terrain.height(s.pos.x, s.pos.z);
    return s;
  }

  removeTank(t: Tank) {
    const i = this.tanks.indexOf(t);
    if (i >= 0) this.tanks.splice(i, 1);
    t.dispose();
  }

  removeSoldier(s: Soldier) {
    const i = this.soldiers.indexOf(s);
    if (i >= 0) this.soldiers.splice(i, 1);
    s.dispose();
  }

  obstaclesNear(x: number, r: number): Obstacle[] {
    const out = new Set<Obstacle>();
    for (let b = Math.floor((x - r) / BUCKET); b <= Math.floor((x + r) / BUCKET); b++) for (const o of this.buckets.get(b) ?? []) out.add(o);
    return [...out];
  }

  obstaclesOnSegment(p0: THREE.Vector3, p1: THREE.Vector3): Obstacle[] {
    const a = Math.min(p0.x, p1.x), b = Math.max(p0.x, p1.x);
    const ba = Math.floor(a / BUCKET), bb = Math.floor(b / BUCKET);
    if (ba === bb) return this.buckets.get(ba) ?? [];
    const out = new Set<Obstacle>();
    for (let k = ba; k <= bb; k++) for (const o of this.buckets.get(k) ?? []) out.add(o);
    return [...out];
  }

  soldiersNearSegment(p0: THREE.Vector3, p1: THREE.Vector3): Soldier[] {
    const a = Math.min(p0.x, p1.x) - 1, b = Math.max(p0.x, p1.x) + 1;
    return this.soldiers.filter((s) => s.pos.x > a && s.pos.x < b && s.state !== 'dead' && !s.inTank);
  }

  /* ================================================================== spawning */

  spawnShell(a: AmmoDef, pos: THREE.Vector3, vel: THREE.Vector3, owner: Tank) {
    return this.shells.spawn(a, pos, vel, owner, owner, owner.team, owner.callsign);
  }

  spawnRocket(a: AmmoDef, pos: THREE.Vector3, vel: THREE.Vector3, owner: Soldier) {
    return this.shells.spawn(a, pos, vel, null, owner, owner.team, `${owner.rank} ${owner.name}`);
  }

  spawnBullet(pos: THREE.Vector3, vel: THREE.Vector3, team: Team, owner: Soldier | Tank | null, kind: 'rifle' | 'mg', massG = 10) {
    this.bullets.spawn(pos, vel, team, owner, kind, massG);
  }

  spawnGrenade(def: GrenadeDef, pos: THREE.Vector3, vel: THREE.Vector3, owner: Soldier) {
    this.bullets.throw(def, pos, vel, owner, this);
  }

  log(msg: string, team: Team | null, level: LogLevel = 'info') {
    this.events.log?.(msg, team, level);
  }

  noise(pos: THREE.Vector3, radius: number, team: Team) {
    this.perception.noise(pos, radius, team);
  }

  addReport(r: ImpactReport) {
    this.reports.push(r);
    if (this.reports.length > 40) this.reports.shift();
  }

  onTankHit(t: Tank, r: ImpactReport, s: Shell) {
    if (s.owner && s.owner !== t && s.owner.team !== t.team && r.severity >= 1) s.owner.stats.hits++;
    this.events.tankHit?.(t, r, s.shooter);
  }

  /* ================================================================== events from entities */

  onTankKilled(t: Tank, reason: string) {
    const killer = t.killedBy ?? t.lastHitBy;
    if (killer && killer !== t && killer.team !== t.team) killer.stats.kills++;
    this.log(`${t.callsign} ${reason === 'crew killed' ? 'knocked out' : 'destroyed'} (${reason})`, t.team, 'bad');
    this.events.tankKilled?.(t, reason, killer && killer.team !== t.team ? killer : null);
  }

  onBailOut(t: Tank, crew: CrewMember[]) {
    const out: Soldier[] = [];
    const f = t.forward;
    crew.forEach((c, i) => {
      const side = i % 2 === 0 ? 1 : -1;
      const s = new Soldier(t.team, t.nation === 'GER' ? 'GER' : 'USA', 'crew', t.pos.x - f.x * (1 + i * 0.6), clamp(t.pos.z + side * (t.model.halfWidth + 0.8), DEPTH_MIN, DEPTH_MAX), this.rng.int(1, 1e6), 0.4);
      s.crewRecord = c;
      s.name = c.name.split(' ').pop() ?? s.name;
      s.rank = c.rank;
      if (c.state === 'wounded') { s.state = 'wounded'; s.health = 45; }
      this.addSoldier(s);
      out.push(s);
    });
    this.events.bailout?.(t, out);
    // an abandoned vehicle still counts as knocked out for scoring
    this.onTankKilled(t, 'crew bailed out');
  }

  onSoldierDown(s: Soldier, by: Soldier | Tank | null) {
    void s; void by;
  }

  onSoldierDead(s: Soldier, by: Soldier | Tank | null) {
    if (by && by.team !== s.team) by.stats.kills++;
    this.events.soldierKilled?.(s, by);
  }

  onSoldierShotBy(_s: Soldier, _by: Soldier) {}

  onPlayerHurt(amount: number) {
    this.events.playerHurt?.(amount);
  }

  repairBoost(t: Tank) {
    let n = 0;
    for (const s of this.soldiers) if (s.team === t.team && s.role === 'engineer' && s.alive && s.pos.distanceTo(t.pos) < 7) n++;
    return 1 + Math.min(2, n) * 0.8;
  }

  /** the turret is thrown off by an ammunition explosion */
  throwTurret(t: Tank) {
    const tur = t.model.turret;
    tur.updateMatrixWorld(true);
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
    tur.matrixWorld.decompose(wp, wq, ws);
    this.root.add(tur);
    tur.position.copy(wp);
    tur.quaternion.copy(wq);
    const r = this.rng;
    this.flying.push({ obj: tur, v: new THREE.Vector3(r.normal(0, 2), r.range(7, 13), r.normal(0, 2)), w: new THREE.Vector3(r.normal(0, 2), r.normal(0, 3), r.normal(0, 2)), rest: false });
  }

  /* ================================================================== explosions & smoke */

  explode(p: THREE.Vector3, kg: number, shell: Shell | null, onGround: boolean, small = false, obstacle: Obstacle | null = null, directTank: Tank | null = null, ownerSoldier: Soldier | null = null, frag = 1) {
    const gy = this.terrain.height(p.x, p.z);
    const ground = onGround || p.y - gy < 0.6;
    const surf = this.terrain.surface(p.x, p.z);
    this.effects.explosion(p, small ? kg * 2 + 0.05 : kg, ground, gy, surf.kind !== 'road');
    this.audio.explosion(p, kg);
    if (ground && kg >= 0.25 && this.craters < 160 && surf.kind !== 'road') {
      this.terrain.addCrater(p.x, p.z, 0.7 + Math.cbrt(kg) * 1.0, 0.15 + Math.cbrt(kg) * 0.25);
      this.craters++;
    }
    if (small && kg < 0.05) return;
    const owner: Soldier | Tank | null = ownerSoldier ?? shell?.shooter ?? null;
    // fragments and blast against infantry (line of sight from the burst matters)
    const rc = 13 * Math.cbrt(kg / 0.68) * (0.6 + 0.4 * frag);
    const rl = 2.6 * Math.cbrt(kg / 0.68);
    for (const s of this.soldiers) {
      if (s.state === 'dead' || s.inTank) continue;
      const c = s.center;
      const d = c.distanceTo(p);
      if (d < rc * 2.2 && s.team !== owner?.team) s.suppress(clamp(1 - d / (rc * 2.2), 0, 1) * 0.9);
      else if (d < rc * 1.5) s.suppress(clamp(1 - d / (rc * 1.5), 0, 1) * 0.6);
      if (d > rc) continue;
      const vis = this.visibility(p.clone().add(new THREE.Vector3(0, 0.3, 0)), c, true);
      if (vis < 0.15 && d > rl * 0.6) continue;
      const exposure = (s.crouch > 0.5 ? 0.55 : 1) * (s.state === 'down' ? 0.3 : 1) * Math.max(0.15, vis);
      if (d < rl) s.damage(this.rng.range(90, 220) * exposure, this, owner, exposure > 0.5 && d < rl * 0.5);
      else if (this.rng.chance(Math.pow(1 - d / rc, 1.6) * exposure)) s.damage(this.rng.range(30, 110), this, owner);
    }
    for (const t of this.tanks) {
      if (t === directTank) continue;
      const d = t.centerWorld().distanceTo(p);
      if (d < 6) nearMissOnTank(this, t, p, kg);
    }
    // light obstacles near the burst
    for (const o of this.obstaclesNear(p.x, 6)) {
      if (o === obstacle || o.destroyed) continue;
      const [lx, lz] = o.toLocal(p.x, p.z);
      const dx = Math.max(0, Math.abs(lx) - o.hx), dz = Math.max(0, Math.abs(lz) - o.hz);
      const d = Math.hypot(dx, dz);
      const r = 1.5 + Math.cbrt(kg) * 2;
      if (d < r) o.damage(260 * kg * (1 - d / r) + (o.crushable ? 200 : 0), p);
    }
    this.noise(p, 600, owner?.team ?? 'allies');
  }

  smokeScreen(p: THREE.Vector3, a: AmmoDef) {
    const s = a.smoke!;
    this.smokeAt(p, s.radiusM, s.durationS);
  }

  smokeAt(p: THREE.Vector3, radius: number, duration: number) {
    const pos = p.clone();
    pos.y = this.terrain.height(p.x, p.z) + radius * 0.4;
    this.smoke.push({ pos, radius: 1, life: duration, t: 0, density: 0.55 });
    const cloud = this.smoke[this.smoke.length - 1];
    (cloud as SmokeCloud & { max: number }).max = radius;
    this.effects.smokeScreen(pos, radius, duration);
    this.audio.impact(p, 'smoke');
  }

  /* ================================================================== line of sight */

  /** 0..1: how much of `b` can be seen from `a` (terrain, solid obstacles, foliage, smoke) */
  visibility(a: THREE.Vector3, b: THREE.Vector3, ignoreFoliage = false): number {
    let v = 1;
    for (const o of this.obstaclesOnSegment(a, b)) {
      if (!o.blocksLOS || o.destroyed) continue;
      const r = o.segment(a, b);
      if (!r) continue;
      if (o.solidity >= 1) return 0;
      if (!ignoreFoliage) v *= 1 - o.solidity * 0.85;
    }
    // terrain crest between the two points
    const n = 12;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
      if (this.terrain.height(x, z) > y + 0.05) return 0;
    }
    for (const s of this.smoke) {
      const r = s.radius;
      const ab = b.clone().sub(a);
      const len = ab.length();
      const dir = ab.multiplyScalar(1 / len);
      const tc = clamp(s.pos.clone().sub(a).dot(dir), 0, len);
      const closest = a.clone().addScaledVector(dir, tc);
      const d = closest.distanceTo(s.pos);
      if (d < r) {
        const chord = 2 * Math.sqrt(r * r - d * d);
        v *= Math.exp(-chord * s.density * 0.35);
      }
    }
    void segmentSphere;
    return v;
  }

  /* ================================================================== collisions */

  collideTank(t: Tank) {
    const L = t.model.halfLength, W = t.model.halfWidth;
    const f = { x: Math.cos(t.heading), z: -Math.sin(t.heading) };
    const r = { x: Math.sin(t.heading), z: Math.cos(t.heading) };
    const sat = (cx: number, cz: number, ax: { x: number; z: number }[], hx: number, hz: number) => {
      const axes = [f, r, ax[0], ax[1]];
      let best = Infinity, bx = 0, bz = 0;
      const dx = t.pos.x - cx, dz = t.pos.z - cz;
      for (const a of axes) {
        const ra = L * Math.abs(f.x * a.x + f.z * a.z) + W * Math.abs(r.x * a.x + r.z * a.z);
        const rb = hx * Math.abs(ax[0].x * a.x + ax[0].z * a.z) + hz * Math.abs(ax[1].x * a.x + ax[1].z * a.z);
        const dist = dx * a.x + dz * a.z;
        const o = ra + rb - Math.abs(dist);
        if (o <= 0) return null;
        if (o < best) { best = o; const s = Math.sign(dist) || 1; bx = a.x * s; bz = a.z * s; }
      }
      return { depth: best, nx: bx, nz: bz };
    };
    for (const o of this.obstaclesNear(t.pos.x, 12)) {
      if (o.destroyed || !(o.blocksTanks || o.crushable)) continue;
      if (Math.abs(o.cx - t.pos.x) > o.radius + L + 1) continue;
      const res = sat(o.cx, o.cz, [{ x: o.cos, z: -o.sin }, { x: o.sin, z: o.cos }], o.hx, o.hz);
      if (!res) continue;
      if (o.kind === 'hedge' && t.upgrades.has('culin_cutter') && Math.abs(t.speed) > 0.8) {
        // the hedgerow cutter's tusks dig in and the tank bulls through the bank
        o.damage(1e6, t.pos);
        t.speed *= 0.45;
        this.audio.impact(t.pos, 'crunch');
        continue;
      }
      if (o.crushable) {
        if (Math.abs(t.speed) > 0.3) {
          o.damage(1e6, t.pos);
          t.speed *= 0.85;
          this.audio.impact(t.pos, 'crunch');
        }
        continue;
      }
      t.pos.x += res.nx * res.depth;
      t.pos.z += res.nz * res.depth;
      const into = -(f.x * res.nx + f.z * res.nz) * Math.sign(t.speed);
      if (into > 0.3) t.speed *= 0.2;
    }
    for (const u of this.tanks) {
      if (u === t) continue;
      if (Math.abs(u.pos.x - t.pos.x) > 9 || Math.abs(u.pos.z - t.pos.z) > 7) continue;
      const fu = { x: Math.cos(u.heading), z: -Math.sin(u.heading) }, ru = { x: Math.sin(u.heading), z: Math.cos(u.heading) };
      const res = sat(u.pos.x, u.pos.z, [fu, ru], u.model.halfLength, u.model.halfWidth);
      if (!res) continue;
      const mt = t.spec.massT.value, mu = u.state === 'active' ? u.spec.massT.value : u.spec.massT.value * 3;
      const k = mu / (mt + mu);
      t.pos.x += res.nx * res.depth * k;
      t.pos.z += res.nz * res.depth * k;
      if (u.state === 'active') { u.pos.x -= res.nx * res.depth * (1 - k); u.pos.z -= res.nz * res.depth * (1 - k); }
      t.speed *= 0.6;
    }
    // soldiers in the way: enemies are run over, friends are shoved aside
    for (const s of this.soldiers) {
      if (s.state === 'dead' || s.inTank) continue;
      if (Math.abs(s.pos.x - t.pos.x) > L + 1 || Math.abs(s.pos.z - t.pos.z) > L + 1) continue;
      const dx = s.pos.x - t.pos.x, dz = s.pos.z - t.pos.z;
      const lf = dx * f.x + dz * f.z, lr = dx * r.x + dz * r.z;
      if (Math.abs(lf) < L + 0.25 && Math.abs(lr) < W + 0.25) {
        if (Math.abs(t.speed) > 1.2 && (s.team !== t.team || s.state === 'down') && !s.isPlayer) s.die(this, t);
        else {
          const push = W + 0.3 - Math.abs(lr);
          s.pos.x += r.x * Math.sign(lr || 1) * push;
          s.pos.z += r.z * Math.sign(lr || 1) * push;
          if (s.isPlayer && Math.abs(t.speed) > 2.5) s.damage(30, this, t);
        }
      }
    }
    const hw = W * 0.7;
    t.pos.z = clamp(t.pos.z, DEPTH_MIN + hw, DEPTH_MAX - hw);
    t.pos.x = clamp(t.pos.x, this.x0 + 4, this.x1 - 4);
  }

  collideSoldier(s: Soldier) {
    for (const o of this.obstaclesNear(s.pos.x, 8)) {
      if (o.destroyed || !o.blocksFoot) continue;
      const c = o.pushOut(s.pos.x, s.pos.z, 0.28);
      if (c) { s.pos.x += c[0]; s.pos.z += c[1]; }
    }
    for (const t of this.tanks) {
      if (Math.abs(t.pos.x - s.pos.x) > 5) continue;
      const f = { x: Math.cos(t.heading), z: -Math.sin(t.heading) };
      const r = { x: Math.sin(t.heading), z: Math.cos(t.heading) };
      const dx = s.pos.x - t.pos.x, dz = s.pos.z - t.pos.z;
      const lf = dx * f.x + dz * f.z, lr = dx * r.x + dz * r.z;
      const L = t.model.halfLength + 0.25, W = t.model.halfWidth + 0.25;
      if (Math.abs(lf) < L && Math.abs(lr) < W) {
        const ol = L - Math.abs(lf), ow = W - Math.abs(lr);
        if (ol < ow) { s.pos.x += f.x * Math.sign(lf || 1) * ol; s.pos.z += f.z * Math.sign(lf || 1) * ol; }
        else { s.pos.x += r.x * Math.sign(lr || 1) * ow; s.pos.z += r.z * Math.sign(lr || 1) * ow; }
      }
    }
    s.pos.z = clamp(s.pos.z, DEPTH_MIN, DEPTH_MAX);
    s.pos.x = clamp(s.pos.x, this.x0 + 2, this.x1 - 2);
  }

  /** the obstacle (if any) that shields a soldier at x,z from a threat at tx */
  coverFrom(x: number, z: number, threatX: number): Obstacle | null {
    const dir = Math.sign(threatX - x) || 1;
    for (const o of this.obstaclesNear(x, 4)) {
      if (o.destroyed || !o.stopsBullets) continue;
      const [lx, lz] = o.toLocal(x + dir * 0.9, z);
      if (Math.abs(lx) < o.hx + 0.4 && Math.abs(lz) < o.hz + 0.5 && o.y1 - this.terrain.height(o.cx, o.cz) > 0.7) return o;
    }
    return null;
  }

  /* ================================================================== update */

  update(dt: number) {
    this.time += dt;
    this.perception.update(dt);
    for (const t of this.tanks) t.update(dt, this);
    for (const s of this.soldiers) s.update(dt, this);
    this.shells.update(dt, this);
    this.bullets.update(dt, this);
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const s = this.smoke[i] as SmokeCloud & { max?: number };
      s.t += dt;
      s.radius = Math.min(s.max ?? 8, s.radius + dt * 3);
      if (s.t > s.life) this.smoke.splice(i, 1);
      else if (s.t > s.life - 10) s.density = 0.55 * (s.life - s.t) / 10;
    }
    for (const f of this.flying) {
      if (f.rest) continue;
      f.v.y -= 9.81 * dt;
      f.obj.position.addScaledVector(f.v, dt);
      f.obj.rotation.x += f.w.x * dt; f.obj.rotation.y += f.w.y * dt; f.obj.rotation.z += f.w.z * dt;
      const gy = this.terrain.height(f.obj.position.x, f.obj.position.z);
      if (f.obj.position.y < gy + 0.4 && f.v.y < 0) {
        f.obj.position.y = gy + 0.4;
        f.v.multiplyScalar(0.3);
        f.v.y = Math.abs(f.v.y) * 0.3;
        f.w.multiplyScalar(0.4);
        if (f.v.length() < 1) f.rest = true;
        this.effects.explosion(f.obj.position, 0.05, true, gy, true);
      }
    }
    // dead soldiers stay for a while, then fade from the simulation
    for (let i = this.soldiers.length - 1; i >= 0; i--) {
      const s = this.soldiers[i];
      if (s.state === 'dead' && s.deadT >= 1) {
        (s as Soldier & { gone?: number }).gone = ((s as Soldier & { gone?: number }).gone ?? 0) + dt;
        if (((s as Soldier & { gone?: number }).gone ?? 0) > 90 && !s.isPlayer) this.removeSoldier(s);
      }
    }
  }

  teamTanks(team: Team) {
    return this.tanks.filter((t) => t.team === team && t.alive);
  }

  enemyTeam(team: Team) {
    return enemyOf(team);
  }

  dispose() {
    this.shells.clear();
    this.bullets.clear();
    for (const t of this.tanks) t.dispose();
    for (const s of this.soldiers) s.dispose();
    this.root.removeFromParent();
  }
}
