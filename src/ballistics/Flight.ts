import * as THREE from 'three';
import type { AmmoDef } from '../data/ammo';

/**
 * External ballistics (point mass), ported from Ballistic Armour Lab's BallisticsEngine:
 * drag coefficient vs Mach scaled from the round's reference Cd. The SAME model is used
 *   • in real time — every shell is integrated with gravity + drag each physics sub-step,
 *   • offline     — to pair each documented penetration-table range with its striking velocity,
 *   • by the AI   — range tables (time of flight, drop) for laying the gun.
 */

export const GRAVITY = 9.81;
const RHO = 1.225;
const SOUND = 340;

const CD_TABLE: [number, number][] = [
  [0, 0.55], [0.8, 0.6], [0.95, 0.85], [1.05, 1.35], [1.2, 1.35], [1.5, 1.18], [2.0, 1.0], [2.5, 0.9], [3.0, 0.82], [4.0, 0.72], [5.0, 0.65],
];

export function cdFactor(mach: number) {
  if (mach <= CD_TABLE[0][0]) return CD_TABLE[0][1];
  for (let i = 1; i < CD_TABLE.length; i++) {
    if (mach <= CD_TABLE[i][0]) {
      const [a, ca] = CD_TABLE[i - 1];
      const [b, cb] = CD_TABLE[i];
      return ca + ((cb - ca) * (mach - a)) / (b - a);
    }
  }
  return CD_TABLE[CD_TABLE.length - 1][1];
}

/** k such that drag deceleration = k · cdFactor(M) · v² */
export function dragK(a: AmmoDef) {
  const d = a.caliberMm / 1000;
  const A = Math.PI * (d / 2) ** 2;
  return (0.5 * RHO * A * a.dragCd.value) / a.massKg.value;
}

/** Advance a shell one step (semi-implicit Euler). Mutates pos/vel. */
export function stepShell(pos: THREE.Vector3, vel: THREE.Vector3, k: number, dt: number) {
  const v = vel.length();
  const f = k * cdFactor(v / SOUND) * v;
  vel.x -= f * vel.x * dt;
  vel.y -= (f * vel.y + GRAVITY) * dt;
  vel.z -= f * vel.z * dt;
  pos.addScaledVector(vel, dt);
}

export interface FlightPoint {
  range: number;
  velocity: number;
  tof: number;
  /** drop below the bore line (m) for a flat (0°) launch */
  drop: number;
}

/** Flat-fire flight to a set of ranges (RK4, 2 ms). */
export function flightTo(a: AmmoDef, ranges: number[], v0 = a.muzzleVelocity.value): FlightPoint[] {
  const k = dragK(a);
  const acc = (vx: number, vy: number): [number, number] => {
    const v = Math.hypot(vx, vy);
    const f = k * cdFactor(v / SOUND) * v;
    return [-f * vx, -f * vy - GRAVITY];
  };
  const out: FlightPoint[] = [];
  const sorted = ranges.map((r, i) => [r, i] as const).sort((p, q) => p[0] - q[0]);
  let x = 0, y = 0, vx = v0, vy = 0, t = 0;
  const dt = 0.002;
  const res: FlightPoint[] = new Array(ranges.length);
  for (const [r, i] of sorted) {
    while (x < r && t < 40) {
      const [ax1, ay1] = acc(vx, vy);
      const [ax2, ay2] = acc(vx + (ax1 * dt) / 2, vy + (ay1 * dt) / 2);
      const [ax3, ay3] = acc(vx + (ax2 * dt) / 2, vy + (ay2 * dt) / 2);
      const [ax4, ay4] = acc(vx + ax3 * dt, vy + ay3 * dt);
      const nvx = vx + (dt / 6) * (ax1 + 2 * ax2 + 2 * ax3 + ax4);
      const nvy = vy + (dt / 6) * (ay1 + 2 * ay2 + 2 * ay3 + ay4);
      x += ((vx + nvx) / 2) * dt;
      y += ((vy + nvy) / 2) * dt;
      vx = nvx;
      vy = nvy;
      t += dt;
    }
    res[i] = { range: r, velocity: Math.hypot(vx, vy), tof: t, drop: -y };
  }
  out.push(...res);
  return out;
}

/**
 * Range table for gun laying: superelevation angle needed for range r (flat target), built once
 * per ammo. Using drop/range is exact enough for flat-fire tank guns (< 5° superelevation).
 */
export class RangeTable {
  private pts: FlightPoint[];
  readonly step = 25;
  constructor(public ammo: AmmoDef, maxRange = 3000) {
    const ranges: number[] = [];
    for (let r = 0; r <= maxRange; r += this.step) ranges.push(Math.max(1, r));
    this.pts = flightTo(ammo, ranges);
  }
  private at(r: number) {
    const f = Math.max(0, Math.min(this.pts.length - 1.001, r / this.step));
    const i = Math.floor(f);
    const t = f - i;
    const a = this.pts[i], b = this.pts[i + 1];
    return { drop: a.drop + (b.drop - a.drop) * t, tof: a.tof + (b.tof - a.tof) * t, velocity: a.velocity + (b.velocity - a.velocity) * t };
  }
  /** superelevation (rad) to hit at range r */
  superelevation(r: number) {
    const { drop } = this.at(r);
    return Math.atan2(drop, Math.max(1, r));
  }
  tof(r: number) {
    return this.at(r).tof;
  }
  velocity(r: number) {
    return this.at(r).velocity;
  }
}

const tables = new Map<string, RangeTable>();
export function rangeTable(a: AmmoDef) {
  let t = tables.get(a.id);
  if (!t) tables.set(a.id, (t = new RangeTable(a)));
  return t;
}
