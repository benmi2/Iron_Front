import * as THREE from 'three';
import { clamp } from '../core/math';
import { isKinetic, type AmmoDef } from '../data/ammo';
import { dragK, stepShell } from './Flight';
import { penCurve } from './PenCurve';
import { resolveShellHit, tankHitTest, type ShellLike } from '../vehicles/DamageModel';
import type { ExternalPart } from '../vehicles/TankBuilder';
import type { Tank } from '../vehicles/Tank';
import type { World } from '../world/World';
import type { Obstacle } from '../world/Obstacle';
import type { Soldier } from '../infantry/Soldier';

/**
 * Every main-gun shell and AT rocket is a real projectile: integrated with gravity and drag at
 * 480 Hz and swept against terrain, obstacles, vehicles (armour prisms + external parts) and
 * soldiers. Nothing is hitscan.
 */
export class Shell implements ShellLike {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  origin = new THREE.Vector3();
  mass: number;
  heatMm: number;
  k: number;
  age = 0;
  alive = true;
  jetLeft = 0;
  skipRegion = -1;
  skipParts: ExternalPart[] = [];
  skipObstacle: Obstacle | null = null;
  ownerName: string;
  ownerTeam: string;
  flyby = false;
  bounced = 0;
  constructor(readonly ammo: AmmoDef, pos: THREE.Vector3, vel: THREE.Vector3, readonly owner: Tank | null, readonly shooter: Soldier | Tank | null, team: string, name: string) {
    this.pos.copy(pos);
    this.origin.copy(pos);
    this.vel.copy(vel);
    this.mass = ammo.massKg.value;
    this.heatMm = ammo.heat?.penMm ?? 0;
    this.k = dragK(ammo);
    this.ownerTeam = team;
    this.ownerName = name;
  }
}

const SUB = 1 / 480;

export class ShellSystem {
  shells: Shell[] = [];

  spawn(ammo: AmmoDef, pos: THREE.Vector3, vel: THREE.Vector3, owner: Tank | null, shooter: Soldier | Tank | null, team: string, name: string) {
    const s = new Shell(ammo, pos, vel, owner, shooter, team, name);
    this.shells.push(s);
    return s;
  }

  update(dt: number, w: World) {
    const n = Math.max(1, Math.round(dt / SUB));
    const h = dt / n;
    for (const s of this.shells) {
      if (!s.alive) continue;
      for (let i = 0; i < n && s.alive; i++) this.step(s, h, w, i);
      s.age += dt;
      if (s.age > 8 || s.pos.y < -60 || Math.abs(s.pos.x - w.centerX) > 3000) s.alive = false;
    }
    this.shells = this.shells.filter((s) => s.alive);
  }

  private step(s: Shell, h: number, w: World, sub: number) {
    const p0 = s.pos.clone();
    if (s.jetLeft > 0) {
      // a HEAT jet travelling after it formed on a skirt / track: straight, no drag
      const d = s.vel.clone().normalize();
      s.pos.addScaledVector(d, Math.min(s.jetLeft, 6000 * h));
      s.jetLeft -= 6000 * h;
      if (s.jetLeft <= 0 || s.heatMm <= 0) { s.alive = false; return; }
    } else stepShell(s.pos, s.vel, s.k, h);
    const p1 = s.pos.clone();
    if (sub % 3 === 0 && s.jetLeft <= 0) w.effects.tracer(p1, s.vel, s.ammo.cls === 'HE' ? 0x8a6a40 : parseInt(s.ammo.tracer.slice(1), 16), s.ammo.cls === 'HE' ? 0.1 : 0.2);
    if (!s.flyby && s.age > 0.05) {
      const lp = w.listener;
      const seg = new THREE.Line3(p0, p1);
      const c = seg.closestPointToPoint(lp, true, new THREE.Vector3());
      if (c.distanceTo(lp) < 14) {
        s.flyby = true;
        w.audio.flyby(c, s.vel.length());
      }
    }
    this.sweep(s, p0, p1, w, 0);
  }

  private sweep(s: Shell, p0: THREE.Vector3, p1: THREE.Vector3, w: World, depth: number) {
    if (!s.alive || depth > 4) return;
    let bestT = Infinity;
    let kind: 'ground' | 'obstacle' | 'tank' | 'soldier' | null = null;
    let obst: Obstacle | null = null;
    let obstExit = 0;
    let tank: Tank | null = null;
    let thit: ReturnType<typeof tankHitTest> = null;
    let sold: Soldier | null = null;

    // terrain
    const g1 = w.terrain.height(p1.x, p1.z);
    if (p1.y < g1) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 8; i++) {
        const m = (lo + hi) / 2;
        const p = p0.clone().lerp(p1, m);
        if (p.y < w.terrain.height(p.x, p.z)) hi = m;
        else lo = m;
      }
      bestT = hi;
      kind = 'ground';
    }
    // obstacles
    for (const o of w.obstaclesOnSegment(p0, p1)) {
      if (o === s.skipObstacle || o.destroyed && o.kind !== 'rubble') continue;
      const r = o.segment(p0, p1);
      if (r && r[0] < bestT) {
        bestT = r[0];
        kind = 'obstacle';
        obst = o;
        obstExit = r[1];
      }
    }
    if (s.skipObstacle && !s.skipObstacle.segment(p0, p1)) s.skipObstacle = null;
    // vehicles
    for (const t of w.tanks) {
      if (t.turretOff && false) continue;
      const c = t.centerWorld();
      const seg = new THREE.Line3(p0, p1);
      const q = seg.closestPointToPoint(c, true, new THREE.Vector3());
      if (q.distanceToSquared(c) > 30) continue;
      const hit = tankHitTest(t, p0, p1, s.skipRegion, s.skipParts);
      if (hit && hit.t < bestT) {
        bestT = hit.t;
        kind = 'tank';
        tank = t;
        thit = hit;
      }
    }
    // soldiers (direct hits)
    for (const so of w.soldiersNearSegment(p0, p1)) {
      const t = so.hitSegment(p0, p1);
      if (t >= 0 && t < bestT) {
        bestT = t;
        kind = 'soldier';
        sold = so;
      }
    }
    if (!kind) return;
    const hp = p0.clone().lerp(p1, bestT);
    const a = s.ammo;

    if (kind === 'ground') {
      s.pos.copy(hp);
      const n = w.terrain.normal(hp.x, hp.z);
      const sp = s.vel.length();
      const grazing = Math.asin(clamp(-s.vel.dot(n) / sp, -1, 1));
      if (a.cls === 'SMOKE') { w.smokeScreen(hp, a); s.alive = false; return; }
      if (a.cls === 'HE' || a.cls === 'HEAT') { w.explode(hp, a.he ? a.he.fillerKg * a.he.tntEq : 0.35, s, true); s.alive = false; return; }
      // kinetic round: skips off the ground at very flat angles, otherwise ploughs in
      if (grazing < 0.11 && sp > 200 && s.bounced < 2) {
        const vn = n.clone().multiplyScalar(s.vel.dot(n));
        s.vel.sub(vn).multiplyScalar(0.62).addScaledVector(n, vn.length() * 0.25);
        s.pos.addScaledVector(n, 0.05);
        s.bounced++;
        w.effects.explosion(hp, 0.02, true, hp.y, true);
        return;
      }
      w.effects.explosion(hp, 0.04 + (a.filler?.kg ?? 0), true, hp.y, true);
      w.audio.impact(hp, 'dirt');
      if (a.filler && a.filler.kg > 0) w.explode(hp, a.filler.kg, s, true, true);
      s.alive = false;
      return;
    }

    if (kind === 'obstacle' && obst) {
      s.pos.copy(hp);
      const o = obst;
      if (a.cls === 'HE' || a.cls === 'HEAT' || a.cls === 'SMOKE') {
        if (o.solidity < 1 && w.rng.next() > o.solidity) { s.skipObstacle = o; this.sweep(s, hp, p1, w, depth + 1); return; }
        o.damage(a.cls === 'HE' ? 900 * (a.he!.fillerKg + 0.2) : 400, hp);
        if (a.cls === 'SMOKE') w.smokeScreen(hp, a);
        else w.explode(hp, a.he ? a.he.fillerKg * a.he.tntEq : 0.35, s, false, false, o);
        s.alive = false;
        return;
      }
      // kinetic through masonry / earth / wreck
      if (o.solidity < 1 && w.rng.next() > o.solidity) { s.skipObstacle = o; this.sweep(s, hp, p1, w, depth + 1); return; }
      const sp = s.vel.length();
      const E = 0.5 * s.mass * sp * sp;
      o.damage(E / 2200, hp);
      const curve = penCurve(a);
      const crossFrac = clamp(obstExit - bestT, 0, 1);
      const thick = o.shellMm * Math.max(0.35, Math.min(1.6, crossFrac > 0 ? 1 : 1));
      const cap = isKinetic(a) ? curve.at(sp) * Math.pow(s.mass / a.massKg.value, 0.71) : 0;
      w.effects.puff(hp, o.kind === 'house' || o.kind === 'wall' ? 0x9d927f : 0x6f5e48, 2);
      w.audio.impact(hp, o.kind === 'wreck' || o.kind === 'hedgehog' ? 'clang' : 'masonry');
      if (cap > thick) {
        const vbl = curve.limitVelocity(thick);
        const vr = Math.sqrt(Math.max(0, sp * sp - vbl * vbl));
        s.vel.multiplyScalar(vr / sp);
        s.skipObstacle = o;
        // yaw after crossing an obstacle
        s.vel.x += w.rng.normal(0, vr * 0.03); s.vel.y += w.rng.normal(0, vr * 0.03); s.vel.z += w.rng.normal(0, vr * 0.03);
        if (a.filler && a.filler.kg > 0 && w.rng.chance(0.5)) { w.explode(hp, a.filler.kg, s, false, true); s.alive = false; return; }
        if (vr < 80) { s.alive = false; return; }
        this.sweep(s, hp, p1, w, depth + 1);
      } else {
        s.alive = false;
        if (a.filler && a.filler.kg > 0) w.explode(hp, a.filler.kg, s, false, true, o);
      }
      return;
    }

    if (kind === 'tank' && tank && thit) {
      s.pos.copy(hp);
      const r = resolveShellHit(w, s, tank, thit);
      if (r.report) w.onTankHit(tank, r.report, s);
      if (r.burstAt) {
        if (a.cls === 'SMOKE') w.smokeScreen(r.burstAt, a);
        else w.explode(r.burstAt, a.he ? a.he.fillerKg * a.he.tntEq : 0.3, s, false, false, null, tank);
      }
      if (!r.continues) { s.alive = false; return; }
      // keep flying from the new state for the rest of this sub-step
      return;
    }

    if (kind === 'soldier' && sold) {
      sold.hitByShell(s, hp, w);
      if (a.cls === 'HE' || a.cls === 'HEAT') {
        s.pos.copy(hp);
        w.explode(hp, a.he ? a.he.fillerKg : 0.3, s, false);
        s.alive = false;
        return;
      }
      this.sweep(s, hp, p1, w, depth + 1);
    }
  }

  clear() {
    this.shells.length = 0;
  }
}
