import * as THREE from 'three';
import { clamp } from '../core/math';
import { ammo as getAmmo } from '../data/ammo';
import { rangeTable } from '../ballistics/Flight';
import { driveTo, newDriveState, steerIntent, type DriveState } from '../vehicles/Driving';
import type { Tank } from '../vehicles/Tank';
import type { Soldier } from '../infantry/Soldier';
import type { World } from '../world/World';
import { DEPTH_MAX, DEPTH_MIN } from '../world/Terrain';
import { apRound, bestAmmoVs, heRound, presentedArmour } from './Tactics';
import type { Unit } from './Perception';
import { friendlyInLine, laneClear } from './Paths';

export interface TankOrder {
  kind: 'advance' | 'hold' | 'follow' | 'retreat';
  x: number;
  z?: number;
  follow?: Tank | Soldier | null;
}

const LANES = [-14, -10, -6, -2.5, 1, 4];

/**
 * Tank crew AI: spots (through Perception), selects targets it can actually hurt, chooses the
 * ammunition, halts to fire, brackets the range after misses, manoeuvres for line of sight,
 * keeps spacing, avoids friendly infantry and backs off from fights it cannot win.
 */
export class TankAI {
  drive: DriveState = newDriveState();
  target: Unit | null = null;
  private thinkT: number;
  laneZ: number;
  private seekZ: number | null = null;
  private retreatT = 0;
  private quietT = 0;
  private lastShotAtTarget = -99;
  private hitsTaken = 0;
  private lastHitSeen = -99;
  /** debugging / HUD */
  status = 'idle';
  private stuckT = 0;
  private detourZ: number | null = null;
  private detourT = 0;
  private backT = 0;
  /** how long the current target has been continuously in sight */
  private seeT = 0;

  constructor(public tank: Tank, public order: TankOrder) {
    this.thinkT = Math.random() * 0.5;
    this.laneZ = order.z ?? tank.pos.z;
  }

  private gunnerSkill() {
    return this.tank.seat('gunner')?.occupant?.skills.gunnery ?? 0.4;
  }

  update(dt: number, w: World) {
    const t = this.tank;
    if (!t.alive) {
      t.ctl.fire = false;
      t.ctl.mg = false;
      t.ctl.throttle = 0;
      return;
    }
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.45 + Math.random() * 0.2;
      this.think(w);
    }
    this.act(dt, w);
  }

  private canSee(w: World, e: Unit) {
    const eye = this.tank.turretWorld().add(new THREE.Vector3(0, 0.5, 0));
    const p = e.kind === 'tank' ? e.centerWorld().add(new THREE.Vector3(0, 0.6, 0)) : e.center;
    return w.visibility(eye, p) > 0.25;
  }

  private think(w: World) {
    const t = this.tank;
    const radio = t.compStatus('radio') !== 'destroyed';
    const intel = w.perception.intel(t.team).filter((i) => radio || i.spotter === t);
    if (t.lastHitT > this.lastHitSeen) {
      this.lastHitSeen = t.lastHitT;
      this.hitsTaken++;
    }
    // choose target
    let best: Unit | null = null;
    let bestScore = 0;
    let anyThreat = false;
    for (const i of intel) {
      const e = i.e;
      if (e.kind === 'tank') {
        if (e.state !== 'active') continue;
        const d = i.pos.distanceTo(t.pos);
        if (d < 900) anyThreat = true;
        if (d > 1800) continue;
        const sees = i.visible && this.canSee(w, e);
        const mine = bestAmmoVs(t, e, t.centerWorld());
        const theirs = bestAmmoVs(e, t, e.centerWorld());
        let s = (mine && mine.margin > 1 ? 3 : mine ? mine.margin : 0.2) * (theirs && theirs.margin > 1 ? 1.6 : 1) / (1 + d / 500);
        if (!sees) s *= 0.25;
        if (e === this.target) s *= 1.4;
        if (s > bestScore) { bestScore = s; best = e; }
      } else {
        if (!e.alive) continue;
        const d = i.pos.distanceTo(t.pos);
        if (d > 700) continue;
        if (d < 300) anyThreat = true;
        const sees = i.visible && this.canSee(w, e);
        // AT teams are the dangerous ones
        let s = (e.hasAT() ? 2.5 : 0.6) / (1 + d / 150);
        if (!sees) s *= 0.2;
        if (e === this.target) s *= 1.3;
        if (s > bestScore) { bestScore = s; best = e; }
      }
    }
    if (best !== this.target) {
      this.target = best;
      t.rangeErr = (Math.random() - 0.5) * 2 * 0.12 * (1.3 - this.gunnerSkill());
      t.layT = 0;
    }
    // ammunition
    if (best) {
      if (best.kind === 'tank') {
        const pick = bestAmmoVs(t, best, t.centerWorld());
        if (pick) t.selectAmmo(pick.ammo.id, t.loaded ? t.loaded.cls === 'HE' && pick.margin > 1 : false);
      } else {
        const he = heRound(t);
        if (he) t.selectAmmo(he.id, false);
      }
    } else {
      const ap = apRound(t);
      if (ap) t.selectAmmo(ap.id);
    }
    // hatches: commanders fought heads-out until the shooting got close
    if (anyThreat || w.time - t.lastHitT < 20) { t.buttoned = true; this.quietT = 0; }
    else { this.quietT += 0.5; if (this.quietT > 15) t.buttoned = false; }
    // lane for line of sight
    this.seekZ = null;
    if (best && !this.canSee(w, best)) {
      const tp = best.kind === 'tank' ? best.centerWorld() : best.center;
      let bz: number | null = null;
      let bv = 0.3;
      for (const z of LANES) {
        const eye = new THREE.Vector3(t.pos.x, w.terrain.height(t.pos.x, z) + t.model.height * 0.9, z);
        const v = w.visibility(eye, tp) - Math.abs(z - t.pos.z) * 0.01;
        if (v > bv) { bv = v; bz = z; }
      }
      this.seekZ = bz;
    }
    // losing fight: cannot penetrate a target that can penetrate us → break contact
    if (best && best.kind === 'tank') {
      const mine = bestAmmoVs(t, best, t.centerWorld());
      const theirs = bestAmmoVs(best, t, best.centerWorld());
      if ((!mine || mine.margin < 0.8) && theirs && theirs.margin > 1.1 && this.hitsTaken >= 1 && this.order.kind !== 'hold') this.retreatT = 8;
    }
    if (!t.gunOperable) { this.order = { kind: 'retreat', x: this.rearX(w) }; }
    void presentedArmour;
  }

  private rearX(w: World) {
    return this.tank.team === 'allies' ? w.x0 + 40 : w.x1 - 40;
  }

  private act(dt: number, w: World) {
    const t = this.tank;
    t.ctl.fire = false;
    t.ctl.mg = false;
    const tg = this.target;
    let engaging = false;
    let halt = false;
    if (tg && (tg.kind === 'tank' ? tg.state === 'active' : tg.alive)) {
      const sees = this.canSee(w, tg);
      this.seeT = sees ? this.seeT + dt : 0;
      // out of sight: the gun can only be laid on the last REPORTED position, not the real one
      const intel = w.perception.known[t.team].get(tg);
      const tp = sees || !intel
        ? (tg.kind === 'tank' ? tg.centerWorld().add(new THREE.Vector3(0, 0.25, 0)) : tg.center)
        : intel.pos.clone().add(new THREE.Vector3(0, tg.kind === 'tank' ? 1.2 : 0.9, 0));
      const range = tp.distanceTo(t.muzzleWorld());
      const round = t.loaded ?? getAmmo(t.selected);
      const tof = rangeTable(round).tof(range);
      // lead a moving target (skilled gunners lead better)
      const v = tg.kind === 'tank' ? tg.forward.multiplyScalar(tg.speed) : tg.vel.clone();
      const lead = clamp(0.4 + this.gunnerSkill() * 0.6, 0, 1);
      const aim = sees ? tp.clone().addScaledVector(v, tof * lead) : tp.clone();
      t.ctl.aim = aim;
      // crew reaction once the target appears: identify, call the target, re-lay
      const reaction = 0.8 + (1 - this.gunnerSkill()) * 1.4;
      if (sees) {
        engaging = true;
        this.status = `engaging ${tg.kind === 'tank' ? tg.spec.short : 'infantry'}`;
        // machine gun against infantry in the open at short range
        if (tg.kind === 'soldier' && range < 350 && t.layT > 0.2) t.ctl.mg = true;
        const steady = t.layT > 0.9 - this.gunnerSkill() * 0.5 && this.seeT > reaction;
        const halted = Math.abs(t.speed) < 0.6;
        const worth = tg.kind === 'tank' || range > 60 || !t.ctl.mg;
        // never shoot through our own troops
        const blocked = friendlyInLine(w, t.team, t.muzzleWorld(), aim, t, t.loaded?.cls === 'HE' ? 3 : 1.4);
        if (blocked) {
          t.ctl.mg = false;
          this.status = 'clearing the line of fire';
          // shift to a lane with a clear shot
          const muzzleH = t.muzzleWorld().y - t.pos.y;
          let bestZ: number | null = null;
          for (const z of LANES) {
            const from = new THREE.Vector3(t.pos.x, t.pos.y + muzzleH, z);
            if (!friendlyInLine(w, t.team, from, aim, t, 2)) { if (bestZ === null || Math.abs(z - t.pos.z) < Math.abs(bestZ - t.pos.z)) bestZ = z; }
          }
          this.seekZ = bestZ;
        }
        // short halts: against armour always; against infantry only once loaded and laid
        halt = !blocked && (tg.kind === 'tank' ? range < 1600 : !!t.loaded && t.layT > 0.25 && range < 700);
        const maxRange = tg.kind === 'tank' ? 1200 : 700;
        if (t.loaded && steady && halted && worth && range < maxRange && !blocked) {
          if (t.tryFire(w)) {
            this.lastShotAtTarget = w.time;
            // the crew watches the fall of shot and corrects the range
            t.rangeErr *= 0.35 + Math.random() * 0.2;
          }
        }
      }
    } else {
      this.target = null;
      // turret faces the expected enemy direction
      const enemyDir = t.team === 'allies' ? 1 : -1;
      t.ctl.aim = t.pos.clone().add(new THREE.Vector3(enemyDir * 400, 2, 0));
      this.status = this.order.kind;
    }

    // ---- movement
    if (this.retreatT > 0) {
      this.retreatT -= dt;
      const back = t.team === 'allies' ? -1 : 1;
      steerIntent(t, this.drive, back, this.seekZ !== null ? Math.sign(this.seekZ - t.pos.z) : 0, false);
      this.status = 'breaking contact';
      return;
    }
    if (engaging && halt && this.order.kind !== 'retreat') {
      // short halt to fire; small lane adjustment only between shots
      t.ctl.throttle = 0;
      t.ctl.brake = true;
      t.ctl.targetHeading = t.facing > 0 ? 0 : Math.PI;
      return;
    }
    t.ctl.brake = false;
    let gx = this.order.x;
    let gz = this.seekZ ?? this.laneZ;
    if (this.order.kind === 'follow' && this.order.follow) {
      const f = this.order.follow;
      const fx = f.pos.x;
      const behind = t.team === 'allies' ? -1 : 1;
      gx = fx + behind * 18;
    }
    if (this.order.kind === 'retreat') gx = this.rearX(w);
    if (tg && this.seekZ !== null) { gz = this.seekZ; if (!engaging) gx = t.pos.x + (t.team === 'allies' ? 6 : -6); }
    // don't drive into the enemy's position: hold at a stand-off distance from known armour and AT teams
    if (tg && engaging && tg.pos.distanceTo(t.pos) < (tg.kind === 'tank' ? 250 : 90)) gx = t.pos.x;
    // spacing from friendly tanks and infantry in the same lane ahead
    const dir = Math.sign(gx - t.pos.x) || 1;
    for (const u of w.tanks) {
      if (u === t || u.team !== t.team) continue;
      const dx = (u.pos.x - t.pos.x) * dir;
      if (dx > 0 && dx < 13 && Math.abs(u.pos.z - gz) < 3.5) {
        gz = clamp(u.pos.z + (gz > u.pos.z ? 5 : -5), DEPTH_MIN + 2, DEPTH_MAX - 2);
        if (Math.abs(u.pos.z - t.pos.z) < 3) gx = t.pos.x;
      }
    }
    // choose a lane that is actually passable ahead (hedgerows, walls, wrecks)
    const look = t.pos.x + Math.sign(gx - t.pos.x) * Math.min(28, Math.abs(gx - t.pos.x) + 4);
    if (this.detourT > 0) { this.detourT -= dt; if (this.detourZ !== null) gz = this.detourZ; }
    else if (Math.abs(gx - t.pos.x) > 4 && !laneClear(w, t, t.pos.x, look, gz, t.model.halfWidth + 0.4)) {
      const opts = [...LANES, -8.2, -4, 0.5].sort((p, q) => Math.abs(p - gz) - Math.abs(q - gz));
      const ok = opts.find((z) => laneClear(w, t, t.pos.x, look, z, t.model.halfWidth + 0.4) && laneClear(w, t, t.pos.x, t.pos.x + Math.sign(gx - t.pos.x) * 2, (z + t.pos.z) / 2, t.model.halfWidth + Math.abs(z - t.pos.z) / 2));
      if (ok !== undefined) gz = ok;
    }
    // stuck against something: back off into another lane for a while
    if (Math.abs(t.ctl.throttle) > 0.3 && Math.abs(t.speed) < 0.25) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt);
    if (this.backT > 0) {
      // backing away from the obstacle before steering into the detour lane
      this.backT -= dt;
      const away = -Math.sign(gx - t.pos.x || t.facing);
      steerIntent(t, this.drive, away, 0, false, 0.7);
      this.status = 'reversing';
      return;
    }
    if (this.stuckT > 2.5) {
      this.stuckT = 0;
      this.backT = 2.2;
      const free = LANES.filter((z) => Math.abs(z - t.pos.z) > 3 && laneClear(w, t, t.pos.x, look, z, t.model.halfWidth + 0.4));
      this.detourZ = free.length ? free[Math.floor(Math.random() * free.length)] : LANES[Math.floor(Math.random() * LANES.length)];
      this.detourT = 7;
    }
    let creep = 1;
    for (const s of w.soldiers) {
      if (s.team !== t.team || !s.alive) continue;
      const dx = (s.pos.x - t.pos.x) * dir;
      if (dx > 0 && dx < t.model.halfLength + 6 && Math.abs(s.pos.z - t.pos.z) < t.model.halfWidth + 1) creep = 0.25;
    }
    driveTo(t, this.drive, gx, gz, this.order.kind === 'hold' ? 6 : 3, true, this.order.kind === 'advance' ? 0.75 * creep : creep);
  }
}
