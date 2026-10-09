import * as THREE from 'three';
import { clamp } from '../core/math';
import type { World } from '../world/World';
import type { Tank } from '../vehicles/Tank';
import type { Soldier } from '../infantry/Soldier';
import { enemyOf, type Team } from '../world/Team';

export type Unit = Tank | Soldier;

export interface Intel {
  e: Unit;
  /** last known position */
  pos: THREE.Vector3;
  lastSeen: number;
  /** currently in view of at least one observer */
  visible: boolean;
  /** heard only (position approximate) */
  heard: boolean;
  /** who spotted it (for radio call-outs) */
  spotter: Unit | null;
}

/**
 * Spotting: observers accumulate detection on enemies they can actually see (terrain, solid
 * obstacles, foliage and smoke block the line), faster for big, moving or firing targets and
 * for good / unbuttoned commanders. Neither side gets perfect knowledge.
 */
export class Perception {
  readonly known: Record<Team, Map<Unit, Intel>> = { allies: new Map(), axis: new Map() };
  private acc: Record<Team, Map<Unit, number>> = { allies: new Map(), axis: new Map() };
  private passT = 0;
  private half = 0;
  /** called the first time a team spots an enemy tank */
  onFirstSpot: ((team: Team, e: Unit, by: Unit | null) => void) | null = null;
  private announced = new Set<string>();

  constructor(private w: World) {}

  isKnown(team: Team, e: Unit) {
    const i = this.known[team].get(e);
    return !!i && (i.visible || this.w.time - i.lastSeen < 4);
  }

  intel(team: Team): Intel[] {
    return [...this.known[team].values()];
  }

  noise(pos: THREE.Vector3, radius: number, team: Team) {
    // a gun firing reveals the shooter to listeners on the other side (approximately)
    const other = enemyOf(team);
    for (const t of this.w.tanks) {
      if (t.team !== team || !t.alive) continue;
      if (t.centerWorld().distanceTo(pos) < 6 && !this.known[other].get(t)?.visible) this.hear(other, t, pos, radius);
    }
    for (const s of this.w.soldiers) {
      if (s.team !== team || !s.alive) continue;
      if (s.pos.distanceTo(pos) < 3 && !this.known[other].get(s)?.visible) this.hear(other, s, pos, radius * 0.6);
    }
  }

  private hear(team: Team, e: Unit, pos: THREE.Vector3, radius: number) {
    // only if someone of `team` is within earshot
    let near = false;
    for (const o of this.observers(team)) if (this.posOf(o).distanceTo(pos) < radius) { near = true; break; }
    if (!near) return;
    const jitter = new THREE.Vector3(this.w.rng.normal(0, 15), 0, this.w.rng.normal(0, 3));
    const prev = this.known[team].get(e);
    if (prev && prev.visible) return;
    this.known[team].set(e, { e, pos: pos.clone().add(jitter), lastSeen: this.w.time, visible: false, heard: true, spotter: null });
  }

  private observers(team: Team): Unit[] {
    const out: Unit[] = [];
    for (const t of this.w.tanks) if (t.team === team && t.alive) out.push(t);
    for (const s of this.w.soldiers) if (s.team === team && s.alive && !s.inTank) out.push(s);
    return out;
  }

  private posOf(u: Unit) {
    return u.kind === 'tank' ? u.eyeWorld() : u.eye;
  }

  private targetPoints(u: Unit): THREE.Vector3[] {
    if (u.kind === 'tank') {
      const c = u.centerWorld();
      return [u.turretWorld().add(new THREE.Vector3(0, 0.4, 0)), c];
    }
    return [u.eye, u.center];
  }

  update(dt: number) {
    this.passT += dt;
    if (this.passT < 0.2) return;
    const pdt = this.passT;
    this.passT = 0;
    this.half ^= 1;
    for (const team of ['allies', 'axis'] as Team[]) {
      const obs = this.observers(team);
      const enemy = enemyOf(team);
      const targets: Unit[] = [];
      for (const t of this.w.tanks) if (t.team === enemy && t.state !== 'destroyed') targets.push(t);
      for (const s of this.w.soldiers) if (s.team === enemy && (s.alive || s.state === 'down') && !s.inTank) targets.push(s);
      const acc = this.acc[team];
      const known = this.known[team];
      targets.forEach((tg, idx) => {
        if ((idx & 1) !== this.half && known.get(tg)?.visible !== true) return;
        let rate = 0;
        let best: Unit | null = null;
        let anyVis = false;
        const tpts = this.targetPoints(tg);
        const tpos = tpts[1];
        const isTank = tg.kind === 'tank';
        const moving = isTank ? Math.abs(tg.speed) > 0.6 : Math.hypot(tg.vel.x, tg.vel.z) > 0.6;
        let sig = isTank ? (tg.state === 'active' ? 1 : 0.5) : 0.32 * (tg.crouch > 0.5 ? 0.6 : 1) * (tg.cover ? 0.6 : 1);
        if (moving) sig *= isTank ? 1.8 : 1.6;
        for (const o of obs) {
          const op = this.posOf(o);
          const d = op.distanceTo(tpos);
          const maxR = o.kind === 'tank' ? 1600 : 800;
          if (d > maxR) continue;
          let q: number;
          if (o.kind === 'tank') {
            const cmd = o.stationEff('commander');
            const skill = o.seat('commander')?.occupant?.skills.observation ?? 0.5;
            q = (cmd > 0 ? 0.6 + 0.7 * skill * cmd : 0.3) * (o.buttoned ? 0.6 : 1.4);
          } else q = (0.6 + 0.6 * o.skill) * (1 - o.suppression * 0.6);
          const R50 = isTank ? 330 : 130;
          const r = (q * sig) / (1 + (d / R50) ** 2);
          if (r * 6 < 0.002 && tg.revealT <= 0) continue;
          let vis = 0;
          for (const p of tpts) {
            vis = Math.max(vis, this.w.visibility(op, p));
            if (vis > 0.8) break;
          }
          if (vis <= 0.02) continue;
          anyVis = true;
          let rr = r * vis;
          if (tg.revealT > 0 && d < 1200) rr = Math.max(rr, 1.2 * vis);
          if (d < (isTank ? 60 : 18)) rr = Math.max(rr, 2 * vis);
          if (rr > rate) { rate = rr; best = o; }
        }
        let a = acc.get(tg) ?? 0;
        if (anyVis) a = clamp(a + rate * pdt * 3, 0, 1.5);
        else a = Math.max(0, a - pdt * 0.08);
        acc.set(tg, a);
        const info = known.get(tg);
        if (anyVis && a >= 1) {
          if (!info) known.set(tg, { e: tg, pos: tpos.clone(), lastSeen: this.w.time, visible: true, heard: false, spotter: best });
          else { info.pos.copy(tpos); info.lastSeen = this.w.time; info.visible = true; info.heard = false; info.spotter = best ?? info.spotter; }
          const key = `${team}:${tg.kind}:${tg.id}`;
          if (!this.announced.has(key)) {
            this.announced.add(key);
            this.onFirstSpot?.(team, tg, best);
          }
        } else if (info) {
          info.visible = false;
          if (this.w.time - info.lastSeen > 40 || (tg.kind === 'soldier' && !tg.alive) || (tg.kind === 'tank' && tg.state === 'destroyed' && this.w.time - info.lastSeen > 5)) known.delete(tg);
        }
      });
    }
  }
}
