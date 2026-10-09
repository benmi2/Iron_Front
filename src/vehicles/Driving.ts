import { DEG, wrapAngle } from '../core/math';
import { DEPTH_MAX, DEPTH_MIN } from '../world/Terrain';
import type { Tank } from './Tank';

/**
 * Translate a side-view intent (H = −1/0/+1 along the battlefield, D = −1/0/+1 in depth) into
 * throttle and a target heading. Tanks stay roughly aligned with the battlefield and change
 * lanes by steering up to ~32° off-axis — physically, with their real turning limits.
 * Driving the "wrong" way along the screen means reversing at the vehicle's reverse speed,
 * unless a U-turn is ordered.
 */
export interface DriveState {
  uturn: { goal: number; sign: number } | null;
  /** steps spent not moving during a turn, and steps left backing up (three-point turn) */
  stuck: number;
  backup: number;
}

export function newDriveState(): DriveState {
  return { uturn: null, stuck: 0, backup: 0 };
}

export function steerIntent(t: Tank, s: DriveState, H: number, D: number, turnAround = false, throttleScale = 1) {
  if (turnAround && !s.uturn) {
    s.stuck = s.backup = 0;
    const goal = t.facing > 0 ? Math.PI : 0;
    // turn toward the middle of the depth band so the arc fits
    const mid = (DEPTH_MIN + DEPTH_MAX) / 2;
    const sign = (t.pos.z > mid ? 1 : -1) * (t.facing > 0 ? 1 : -1);
    s.uturn = { goal, sign };
  }
  if (s.uturn) {
    const err = wrapAngle(s.uturn.goal - t.heading);
    if (Math.abs(err) < 0.12) {
      s.uturn = null;
      s.stuck = s.backup = 0;
    } else {
      // blocked mid-turn (wreck, wall, hedge, band edge): back up while still swinging the
      // nose the same way, then pull forward again — a three-point turn
      if (s.backup > 0) {
        s.backup--;
        t.ctl.throttle = -0.8;
        t.ctl.targetHeading = t.heading + s.uturn.sign * Math.min(0.8, Math.abs(err));
        return;
      }
      if (Math.abs(t.speed) < 0.4) s.stuck++;
      else s.stuck = Math.max(0, s.stuck - 2);
      if (s.stuck > 45) {
        s.stuck = 0;
        s.backup = 90;
      }
      t.ctl.throttle = 0.75;
      t.ctl.targetHeading = t.heading + s.uturn.sign * Math.min(0.8, Math.abs(err));
      return;
    }
  }
  const facing = t.facing;
  const base = facing > 0 ? 0 : Math.PI;
  let throttle = 0;
  if (H !== 0) throttle = H === facing ? 1 : -1;
  else if (D !== 0) throttle = 0.6;
  const sgn = throttle >= 0 ? 1 : -1;
  let delta = 0;
  if (D !== 0) delta = (facing > 0 ? -1 : 1) * D * sgn * 38 * DEG;
  t.ctl.targetHeading = base + delta;
  t.ctl.throttle = throttle * throttleScale;
}

/** drive toward a battlefield point; returns true when there */
export function driveTo(t: Tank, s: DriveState, x: number, z: number, tol = 3, allowTurn = true, throttleScale = 1) {
  const dx = x - t.pos.x, dz = z - t.pos.z;
  const H = Math.abs(dx) > tol ? Math.sign(dx) : 0;
  const D = Math.abs(dz) > 1.2 ? Math.sign(dz) : 0;
  // long moves in the direction we are not facing: turn around instead of reversing
  const turn = allowTurn && H !== 0 && H !== t.facing && Math.abs(dx) > 45;
  steerIntent(t, s, H, D, turn, throttleScale * (Math.abs(dx) < 10 ? 0.5 : 1));
  if (H === 0 && D === 0) {
    t.ctl.throttle = 0;
    return true;
  }
  return false;
}
