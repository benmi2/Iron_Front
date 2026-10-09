import { clamp } from '../core/math';
import type { World } from '../world/World';
import type { Team } from '../world/Team';

/**
 * Capture zones. Infantry hold ground; tanks count half (they cannot occupy buildings).
 * Progress moves toward whichever side has more effective strength in the zone, and only
 * while the zone is not contested.
 */
export class Objective {
  owner: Team | null;
  /** −1 (axis) … +1 (allies) */
  progress: number;
  contested = false;
  active = true;
  justCaptured: Team | null = null;

  constructor(readonly id: string, readonly label: string, readonly x: number, readonly z: number, readonly radius: number, owner: Team | null) {
    this.owner = owner;
    this.progress = owner === 'allies' ? 1 : owner === 'axis' ? -1 : 0;
  }

  update(dt: number, w: World) {
    this.justCaptured = null;
    if (!this.active) return;
    let a = 0, x = 0;
    for (const s of w.soldiers) {
      if (!s.alive || s.inTank) continue;
      if (Math.abs(s.pos.x - this.x) > this.radius || Math.abs(s.pos.z - this.z) > this.radius) continue;
      if (s.team === 'allies') a += 1; else x += 1;
    }
    for (const t of w.tanks) {
      if (!t.alive) continue;
      if (Math.abs(t.pos.x - this.x) > this.radius || Math.abs(t.pos.z - this.z) > this.radius) continue;
      if (t.team === 'allies') a += 0.5; else x += 0.5;
    }
    this.contested = a > 0 && x > 0;
    if (this.contested || (a === 0 && x === 0)) return;
    const dir = a > x ? 1 : -1;
    const rate = 0.045 * Math.min(4, Math.max(a, x));
    const before = this.owner;
    this.progress = clamp(this.progress + dir * rate * dt, -1, 1);
    if (this.progress >= 1) this.owner = 'allies';
    else if (this.progress <= -1) this.owner = 'axis';
    else if (Math.abs(this.progress) < 0.02) this.owner = null;
    if (this.owner !== before && this.owner) this.justCaptured = this.owner;
  }
}
