import * as THREE from 'three';
import { clamp } from '../core/math';
import type { GrenadeDef } from '../data/smallarms';
import type { World } from '../world/World';
import type { Team } from '../world/Team';
import type { Soldier } from './Soldier';
import type { Tank } from '../vehicles/Tank';
import { tankHitTest } from '../vehicles/DamageModel';

/**
 * Small-arms bullets: swept segments with gravity and drag (no hitscan). They stop in masonry,
 * earth and armour, pass foliage and wooden fences, hit soldiers by zone, wound an unbuttoned
 * tank commander, and suppress anyone they pass close to.
 */
interface Bullet {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  team: Team;
  owner: Soldier | Tank | null;
  massKg: number;
  age: number;
  alive: boolean;
  tracer: boolean;
  suppressed: Set<number>;
}

interface Grenade {
  def: GrenadeDef;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fuse: number;
  owner: Soldier;
  mesh: THREE.Mesh;
  rest: boolean;
}

const _p0 = new THREE.Vector3();
const _seg = new THREE.Line3();
const _q = new THREE.Vector3();

export class BulletSystem {
  bullets: Bullet[] = [];
  grenades: Grenade[] = [];
  private gGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8);
  private gMat = new THREE.MeshStandardMaterial({ color: 0x4a4c34, roughness: 0.8 });

  spawn(pos: THREE.Vector3, vel: THREE.Vector3, team: Team, owner: Soldier | Tank | null, kind: 'rifle' | 'mg', massG = 10) {
    this.bullets.push({ pos: pos.clone(), vel: vel.clone(), team, owner, massKg: massG / 1000, age: 0, alive: true, tracer: kind === 'mg' && Math.random() < 0.25, suppressed: new Set() });
  }

  throw(def: GrenadeDef, pos: THREE.Vector3, vel: THREE.Vector3, owner: Soldier, w: World) {
    const mesh = new THREE.Mesh(this.gGeo, this.gMat);
    mesh.castShadow = true;
    w.root.add(mesh);
    this.grenades.push({ def, pos: pos.clone(), vel: vel.clone(), fuse: def.fuseS, owner, mesh, rest: false });
  }

  update(dt: number, w: World) {
    const sub = 3;
    const h = dt / sub;
    for (const b of this.bullets) {
      for (let i = 0; i < sub && b.alive; i++) {
        _p0.copy(b.pos);
        const v = b.vel.length();
        const k = 0.00028 * v * (0.01 / Math.max(0.005, b.massKg)) ** 0.3;
        b.vel.multiplyScalar(1 - k * h);
        b.vel.y -= 9.81 * h;
        b.pos.addScaledVector(b.vel, h);
        this.sweep(b, _p0, b.pos, w);
      }
      if (b.tracer && b.alive) w.effects.tracer(b.pos, b.vel, b.team === 'allies' ? 0xff7050 : 0x90ff90, 0.07);
      b.age += dt;
      if (b.age > 3) b.alive = false;
    }
    this.bullets = this.bullets.filter((b) => b.alive);
    this.updateGrenades(dt, w);
  }

  private sweep(b: Bullet, p0: THREE.Vector3, p1: THREE.Vector3, w: World) {
    let bestT = Infinity;
    let kind: 'ground' | 'obstacle' | 'soldier' | 'tank' | 'commander' | null = null;
    let sold: Soldier | null = null;
    let tank: Tank | null = null;
    const g = w.terrain.height(p1.x, p1.z);
    if (p1.y < g) { bestT = 1; kind = 'ground'; }
    for (const o of w.obstaclesOnSegment(p0, p1)) {
      if (!o.stopsBullets || (o.destroyed && o.kind !== 'rubble')) continue;
      const r = o.segment(p0, p1);
      if (r && r[0] < bestT && (o.solidity >= 1 || Math.random() < o.solidity)) { bestT = r[0]; kind = 'obstacle'; }
    }
    for (const s of w.soldiersNearSegment(p0, p1)) {
      if (s === b.owner) continue;
      const t = s.hitSegment(p0, p1);
      if (t >= 0 && t < bestT) { bestT = t; kind = 'soldier'; sold = s; }
      // near misses suppress
      if (s.team !== b.team && s.alive && !b.suppressed.has(s.id)) {
        _seg.set(p0, p1);
        _seg.closestPointToPoint(s.center, true, _q);
        const dist = _q.distanceTo(s.center);
        if (dist < 2.2) {
          b.suppressed.add(s.id);
          s.suppress(clamp((2.2 - dist) / 2.2, 0, 1) * 0.24);
          if (s.isPlayer) w.audio.whiz(_q);
        }
      }
    }
    for (const t of w.tanks) {
      const c = t.centerWorld();
      _seg.set(p0, p1);
      _seg.closestPointToPoint(c, true, _q);
      if (_q.distanceToSquared(c) > 25) continue;
      // exposed commander (unbuttoned) above the cupola
      if (!t.buttoned && t.state === 'active') {
        const eye = t.eyeWorld();
        _seg.closestPointToPoint(eye, true, _q);
        if (_q.distanceTo(eye) < 0.22) {
          const tt = _seg.closestPointToPointParameter(eye, true);
          if (tt < bestT) { bestT = tt; kind = 'commander'; tank = t; }
        }
      }
      const hit = tankHitTest(t, p0, p1);
      if (hit && hit.t < bestT) { bestT = hit.t; kind = 'tank'; tank = t; }
    }
    if (!kind) return;
    const hp = p0.clone().lerp(p1, bestT);
    const E = 0.5 * b.massKg * b.vel.lengthSq();
    b.alive = false;
    if (kind === 'ground') w.effects.puff(hp, 0x7d6a50, 0.5);
    else if (kind === 'obstacle') w.effects.puff(hp, 0x9a8f7c, 0.5);
    else if (kind === 'soldier' && sold) {
      sold.hitByBullet(hp, E, w, b.owner);
      if (b.owner && 'kind' in b.owner && b.owner.kind === 'soldier') w.onSoldierShotBy(sold, b.owner);
    } else if (kind === 'tank' && tank) {
      w.effects.particles.glow.spawn({ pos: hp, life: 0.05, size: 0.18, color: 0xffe0a0, shape: 1 });
      w.audio.ping(hp);
    } else if (kind === 'commander' && tank) {
      const seat = tank.seat('commander');
      if (seat && seat.occupant) {
        tank.damageComp(seat, 900, w, 'spall');
        w.log(`${tank.callsign}: commander hit by small-arms fire`, tank.team, 'bad');
        tank.buttoned = true;
      }
    }
  }

  private updateGrenades(dt: number, w: World) {
    for (const g of this.grenades) {
      g.fuse -= dt;
      if (!g.rest) {
        g.vel.y -= 9.81 * dt;
        const prev = g.pos.clone();
        g.pos.addScaledVector(g.vel, dt);
        const gy = w.terrain.height(g.pos.x, g.pos.z);
        for (const o of w.obstaclesOnSegment(prev, g.pos)) {
          if (!o.stopsBullets || o.destroyed) continue;
          const r = o.segment(prev, g.pos);
          if (r) {
            g.pos.copy(prev);
            g.vel.x *= -0.3; g.vel.z *= -0.3;
            break;
          }
        }
        if (g.pos.y < gy + 0.05) {
          g.pos.y = gy + 0.05;
          if (Math.abs(g.vel.y) < 1.5) { g.rest = true; g.vel.set(0, 0, 0); }
          else { g.vel.y *= -0.3; g.vel.x *= 0.5; g.vel.z *= 0.5; }
        }
      }
      g.mesh.position.copy(g.pos);
      g.mesh.rotation.z += dt * 8;
      if (g.fuse <= 0) {
        if (g.def.smoke) w.smokeAt(g.pos, 7, 40);
        else w.explode(g.pos.clone(), g.def.fillerKg, null, true, false, null, null, g.owner, g.def.frag);
        g.mesh.removeFromParent();
      }
    }
    this.grenades = this.grenades.filter((g) => g.fuse > 0);
  }

  clear() {
    this.bullets.length = 0;
    for (const g of this.grenades) g.mesh.removeFromParent();
    this.grenades.length = 0;
  }
}
