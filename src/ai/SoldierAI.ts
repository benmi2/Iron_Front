import * as THREE from 'three';
import { clamp } from '../core/math';
import type { Soldier } from '../infantry/Soldier';
import type { World } from '../world/World';
import type { Obstacle } from '../world/Obstacle';
import { DEPTH_MAX, DEPTH_MIN } from '../world/Terrain';
import type { Unit } from './Perception';
import { friendlyInLine } from './Paths';

/**
 * Infantry behaviour, adapted from Dead Meridian's Raider AI:
 *  • perception builds awareness (here: team Perception + own line of sight),
 *  • aimed bursts with a planted / crouched stance, reloads between bursts,
 *  • cover chosen by score (distance to the ideal engagement range, travel, randomness),
 *    rotated after a while or when it soaks too much fire,
 *  • rally / fall back below a strength threshold.
 * WWII additions: squads advance with armour from cover to cover, keep out of tanks' paths,
 * suppression pins men down, AT teams stalk tanks to their effective range, medics treat
 * the wounded, grenades for men behind cover, smoke to cross open ground.
 */
export class SoldierAI {
  target: Unit | null = null;
  private thinkT = Math.random() * 0.6;
  private coverX: number | null = null;
  private coverZ: number | null = null;
  private coverObs: Obstacle | null = null;
  private coverT = 0;
  private coverHold = 6;
  private burstLeft = 0;
  private pauseT = 0;
  private reactT = 0.4;
  private nadeCool = 8 + Math.random() * 8;
  private smokeCool = 20;
  private healT = 0;
  private patient: Soldier | null = null;
  status = 'idle';

  constructor(public s: Soldier) {}

  update(dt: number, w: World) {
    const s = this.s;
    if (!s.alive || s.isPlayer) return;
    this.thinkT -= dt;
    this.nadeCool -= dt;
    this.smokeCool -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.35 + Math.random() * 0.3;
      this.think(w);
    }
    this.act(dt, w);
  }

  private visibleFrom(w: World, e: Unit) {
    const p = e.kind === 'tank' ? e.centerWorld().add(new THREE.Vector3(0, 0.4, 0)) : e.center;
    return w.visibility(this.s.eye, p) > 0.25;
  }

  private think(w: World) {
    const s = this.s;
    const intel = w.perception.intel(s.team);
    const range = s.weapon.def.rangeM;
    let best: Unit | null = null;
    let bestScore = 0;
    const at = s.hasAT();
    for (const i of intel) {
      const e = i.e;
      const d = i.pos.distanceTo(s.pos);
      if (e.kind === 'tank') {
        if (e.state !== 'active') continue;
        if (!at) continue;
        if (d > 260) continue;
        const sc = 4 / (1 + d / 60);
        if (sc > bestScore) { bestScore = sc; best = e; }
      } else {
        if (!e.alive) continue;
        if (d > range * 1.2) continue;
        const vis = i.visible && this.visibleFrom(w, e);
        let sc = (vis ? 1 : 0.15) / (1 + d / 80);
        if (e.hasAT()) sc *= 1.5;
        if (e === this.target) sc *= 1.3;
        if (sc > bestScore) { bestScore = sc; best = e; }
      }
    }
    if (best !== this.target) {
      this.target = best;
      this.reactT = 0.3 + (1 - s.skill) * 0.8;
    }
    // weapon: AT for tanks, rifle for men
    if (best && best.kind === 'tank') {
      const ai = s.weapons.findIndex((x) => x.def.kind === 'at' && x.mag + x.reserve > 0);
      if (ai >= 0 && s.current !== ai) s.ctl.weapon = ai;
    } else if (s.weapon.def.kind === 'at') s.ctl.weapon = 0;
    // medic: look for a downed friend nearby
    if (s.role === 'medic' && !this.patient) {
      let bd = 45;
      for (const o of w.soldiers) {
        if (o.team !== s.team || o.state !== 'down') continue;
        const d = o.pos.distanceTo(s.pos);
        if (d < bd) { bd = d; this.patient = o; }
      }
    }
    // cover selection relative to the threat
    const threatX = this.target ? this.target.pos.x : this.enemyDirX(w) * 200 + s.pos.x;
    s.cover = w.coverFrom(s.pos.x, s.pos.z, threatX);
    const sq = s.squad;
    const wantPos = this.goal(w);
    const needNew = this.coverX === null || this.coverT > this.coverHold || Math.abs(this.coverX - wantPos.x) > 22;
    if (needNew) this.pickCover(w, wantPos.x, wantPos.z, threatX);
    // smoke to cover an advance across open ground under fire
    if (sq && sq.order.kind === 'advance' && s.smokes > 0 && this.smokeCool <= 0 && sq.suppression > 0.45 && this.target) {
      this.smokeCool = 40;
      const mid = s.pos.clone().lerp(this.target.pos, 0.35);
      s.ctl.throwAt = mid;
      s.ctl.throwSmoke = true;
      w.log(`${s.rank} ${s.name}: popping smoke!`, s.team, 'radio');
    }
  }

  private enemyDirX(_w: World) {
    return this.s.team === 'allies' ? 1 : -1;
  }

  /** where the squad order wants this man */
  private goal(w: World): { x: number; z: number } {
    const s = this.s;
    const sq = s.squad;
    if (s.role === 'crew') {
      // bailed-out crews make for the rear
      return { x: s.team === 'allies' ? w.x0 + 30 : w.x1 - 30, z: s.pos.z };
    }
    if (!sq) return { x: s.pos.x, z: s.pos.z };
    const slot = sq.slot(s);
    const dirX = this.enemyDirX(w);
    const o = sq.order;
    let anchor = o.x;
    if (o.kind === 'follow' && o.follow) anchor = o.follow.pos.x - dirX * 10;
    if (o.kind === 'retreat' || sq.broken) anchor = s.team === 'allies' ? Math.max(w.x0 + 20, s.pos.x - 60) : Math.min(w.x1 - 20, s.pos.x + 60);
    return { x: anchor + slot.dx * dirX, z: clamp(slot.z, DEPTH_MIN + 0.5, DEPTH_MAX - 0.5) };
  }

  /** cover near the goal on the side facing the threat; DM-style scoring */
  private pickCover(w: World, gx: number, gz: number, threatX: number) {
    const s = this.s;
    const dir = Math.sign(threatX - gx) || 1;
    let best: { x: number; z: number; o: Obstacle | null; score: number } = { x: gx, z: gz, o: null, score: 30 + Math.random() * 10 };
    for (const o of w.obstaclesNear(gx, 26)) {
      if (o.destroyed || !o.stopsBullets) continue;
      const h = o.y1 - w.terrain.height(o.cx, o.cz);
      if (h < 0.7 || o.kind === 'house') continue;
      // stand on the near side of the obstacle (away from the threat)
      const px = o.cx - dir * (o.hx + 0.6);
      const pz = clamp(o.cz + (Math.random() - 0.5) * o.hz * 1.4, DEPTH_MIN, DEPTH_MAX);
      if (w.soldiers.some((m) => m !== s && m.alive && Math.abs(m.pos.x - px) < 1.1 && Math.abs(m.pos.z - pz) < 1.1)) continue;
      const score = Math.abs(px - gx) * 0.8 + Math.abs(pz - gz) * 0.4 + Math.abs(px - s.pos.x) * 0.2 + Math.random() * 6;
      if (score < best.score) best = { x: px, z: pz, o, score };
    }
    this.coverX = best.x;
    this.coverZ = best.z;
    this.coverObs = best.o;
    this.coverT = 0;
    this.coverHold = 5 + Math.random() * 6;
  }

  private act(dt: number, w: World) {
    const s = this.s;
    const c = s.ctl;
    c.fire = false;
    c.reload = false;
    c.sprint = false;
    // ---- medic treatment
    if (this.patient) {
      const p = this.patient;
      if (p.state !== 'down') { this.patient = null; this.healT = 0; }
      else {
        const dx = p.pos.x - s.pos.x, dz = p.pos.z - s.pos.z;
        if (Math.hypot(dx, dz) > 1.1) {
          c.moveX = clamp(dx, -1, 1); c.moveZ = clamp(dz, -1, 1); c.crouch = s.suppression > 0.3; c.sprint = s.suppression < 0.3;
          this.status = 'moving to wounded';
        } else {
          c.moveX = c.moveZ = 0; c.crouch = true;
          this.healT += dt;
          this.status = 'treating wounded';
          if (this.healT > 5) {
            p.revive();
            w.log(`${s.rank} ${s.name} (medic) has treated ${p.name}`, s.team, 'good');
            this.patient = null;
            this.healT = 0;
          }
        }
        return;
      }
    }
    // ---- movement toward cover / goal
    let tx = this.coverX ?? s.pos.x, tz = this.coverZ ?? s.pos.z;
    const tg = this.target;
    const atTank = tg && tg.kind === 'tank';
    if (atTank) {
      // AT team stalks into its effective range
      const effR = s.weapon.def.kind === 'at' ? s.weapon.def.rangeM * 0.75 : 100;
      const d = tg.pos.distanceTo(s.pos);
      if (d > effR) { tx = s.pos.x + Math.sign(tg.pos.x - s.pos.x) * 6; tz = this.coverZ ?? s.pos.z; }
      else { tx = s.pos.x; tz = s.pos.z; }
    }
    // keep out of the way of friendly tanks
    for (const t of w.tanks) {
      if (t.team !== s.team || !t.alive || Math.abs(t.speed) < 0.3) continue;
      const ahead = (s.pos.x - t.pos.x) * Math.sign(t.speed * t.facing);
      if (ahead > -2 && ahead < 14 && Math.abs(s.pos.z - t.pos.z) < t.model.halfWidth + 1.2) {
        tz = t.pos.z + (s.pos.z > t.pos.z ? 1 : -1) * (t.model.halfWidth + 2.2);
        tz = clamp(tz, DEPTH_MIN, DEPTH_MAX);
        if (Math.abs(tz - s.pos.z) < 0.3) tz = clamp(t.pos.z - (s.pos.z > t.pos.z ? 1 : -1) * (t.model.halfWidth + 2.2), DEPTH_MIN, DEPTH_MAX);
        tx = s.pos.x;
      }
    }
    const dx = tx - s.pos.x, dz = tz - s.pos.z;
    const far = Math.hypot(dx, dz);
    const pinned = s.suppression > 0.8 && s.role !== 'crew';
    if (far > 0.6 && !pinned) {
      c.moveX = clamp(dx / 2, -1, 1);
      c.moveZ = clamp(dz / 2, -1, 1);
      // under fire: no running upright across open ground — crouch and move from cover to cover
      const underFire = s.suppression > 0.3 || (s.squad?.suppression ?? 0) > 0.35;
      c.sprint = far > 6 && !underFire;
      c.crouch = underFire;
      this.status = pinned ? 'pinned' : 'moving';
    } else {
      c.moveX = c.moveZ = 0;
      c.crouch = !!s.cover || s.suppression > 0.3 || s.weapon.def.kind === 'lmg' || s.role === 'crew';
      this.coverT += dt;
      this.status = s.cover ? 'in cover' : 'holding';
    }
    if (s.role === 'crew') { c.sprint = true; c.crouch = s.suppression > 0.6; }

    // ---- shooting (Raider-style bursts)
    if (!tg) { c.aim = null; return; }
    const tp = tg.kind === 'tank' ? tg.centerWorld().add(new THREE.Vector3(0, 0.2, 0)) : tg.center;
    const d = tp.distanceTo(s.pos);
    c.aim = tp;
    this.reactT -= dt;
    if (this.reactT > 0) return;
    if (!this.visibleFrom(w, tg)) return;
    const ws = s.weapon;
    if (ws.mag === 0) { c.reload = true; return; }
    if (friendlyInLine(w, s.team, s.eye, tp, s, ws.def.kind === 'at' ? 2.5 : 1.0)) return;
    if (ws.def.kind === 'at') {
      if (d > ws.def.rangeM || (Math.hypot(s.vel.x, s.vel.z) > 0.4)) return;
      c.fire = true;
      w.log(`${s.rank} ${s.name}: ${ws.def.name} — firing!`, s.team, 'radio');
      return;
    }
    if (tg.kind === 'tank') return;
    if (d > ws.def.rangeM) return;
    // grenade at a man in cover close by
    if (this.nadeCool <= 0 && s.grenades > 0 && d > 8 && d < 30 && tg.cover) {
      this.nadeCool = 12 + Math.random() * 10;
      c.throwAt = tg.pos.clone();
      c.throwSmoke = false;
      return;
    }
    this.pauseT -= dt;
    if (this.pauseT > 0) return;
    if (this.burstLeft <= 0) {
      this.burstLeft = ws.def.auto ? (ws.def.kind === 'lmg' ? 8 + Math.floor(Math.random() * 14) : 3 + Math.floor(Math.random() * 4)) : 1;
    }
    if (s.fireCool <= 0) {
      c.fire = true;
      this.burstLeft--;
      if (this.burstLeft <= 0) this.pauseT = (ws.def.auto ? 0.6 + Math.random() * 1.2 : 0.4 + Math.random() * 1.4) * (1 + s.suppression * 1.5);
    }
  }
}
