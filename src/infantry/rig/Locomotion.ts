/** Ported verbatim from Dead Meridian (src/rendering/Locomotion.ts): procedural, hand-keyed gaits. */
import { BODY } from './Skeleton';
import type { Pose } from './Skeleton';

const D = Math.PI / 2;

export interface LegPose {
  thighF: number;
  shinF: number;
  footF: number;
  thighB: number;
  shinB: number;
  footB: number;
}

/**
 * Procedural gait. phase advances with distance travelled; amp is thigh swing,
 * knee is knee-flex amplitude; crouch 0..1 bends both legs.
 */
export function legCycle(phase: number, amp: number, knee: number, crouch = 0, drag = 0): LegPose {
  const leg = (p: number, a: number) => {
    const s = Math.sin(p);
    const c = Math.cos(p);
    const thigh = D - a * s - crouch * 1.0;
    const flex = crouch * 1.75 + knee * (c > 0 ? c : c * 0.15) + knee * 0.15;
    const shin = thigh + flex;
    const foot = -(thigh - D) * 0.25 + (c > 0 ? -0.25 * c * (knee > 0.3 ? 1 : 0.4) : 0);
    return [thigh, shin, foot] as const;
  };
  const [tf, sf, ff] = leg(phase, amp);
  const [tb, sb, fb] = leg(phase + Math.PI, amp * (1 - drag));
  return { thighF: tf, shinF: sf, footF: ff, thighB: tb, shinB: sb + drag * 0.4, footB: fb };
}

/** Lowest foot sets the hip height so feet stay planted on the ground. */
export function groundedHipY(l: LegPose): number {
  const fy = (t: number, s: number) => Math.sin(t) * BODY.thigh + Math.sin(s) * BODY.shin;
  return -(Math.max(fy(l.thighF, l.shinF), fy(l.thighB, l.shinB)) + BODY.ankle);
}

// ------------------------------------------------------------------ human gait (player & companions)

/** [cycle time 0..1 from this leg's heel strike, value] — sampled as a closed loop. */
type Keys = readonly (readonly [number, number])[];

interface Gait {
  /** Thigh swing in radians, + = forward. */
  thigh: Keys;
  /** Knee flex in radians (0 = straight). */
  knee: Keys;
  /** Foot rotation (0 flat, - toes up at heel strike, + toes down at push-off). */
  foot: Keys;
  /** Fraction of the cycle the foot is planted (used to keep it from sliding). */
  stance: number;
  /** Constant forward thigh / knee bend (crouched stance). */
  baseThigh: number;
  baseKnee: number;
}

/**
 * Hand-keyed cycles: heel strike → loading → mid-stance → push-off (toes down) → knee-up swing → reach.
 * Running has a short stance and a flight phase; the crouch walk keeps the hips low with short steps.
 */
const GAITS = {
  walk: {
    thigh: [[0, 0.36], [0.15, 0.22], [0.5, -0.2], [0.62, -0.3], [0.75, 0.04], [0.9, 0.4]],
    knee: [[0, 0.04], [0.12, 0.22], [0.35, 0.07], [0.55, 0.22], [0.66, 0.6], [0.75, 0.95], [0.88, 0.32]],
    foot: [[0, -0.3], [0.1, 0], [0.45, 0.02], [0.6, 0.45], [0.7, 0.18], [0.86, -0.15]],
    stance: 0.62, baseThigh: 0, baseKnee: 0,
  },
  sprint: {
    thigh: [[0, 0.5], [0.18, 0.02], [0.36, -0.55], [0.5, -0.35], [0.7, 0.62], [0.86, 0.72]],
    knee: [[0, 0.28], [0.12, 0.6], [0.3, 0.38], [0.44, 1.0], [0.6, 2.05], [0.8, 1.0], [0.94, 0.35]],
    foot: [[0, -0.12], [0.1, 0.05], [0.32, 0.55], [0.46, 0.8], [0.66, 0.15], [0.88, -0.2]],
    stance: 0.36, baseThigh: 0.06, baseKnee: 0.1,
  },
  crouch: {
    thigh: [[0, 0.24], [0.3, 0.02], [0.6, -0.22], [0.78, 0.08], [0.92, 0.28]],
    knee: [[0, 0], [0.3, 0.06], [0.6, 0.12], [0.74, 0.5], [0.9, 0.12]],
    foot: [[0, -0.12], [0.15, 0], [0.55, 0.3], [0.7, 0.12], [0.88, -0.1]],
    stance: 0.62, baseThigh: 0.95, baseKnee: 1.65,
  },
} satisfies Record<string, Gait>;

export type GaitName = keyof typeof GAITS;
export type GaitWeights = Record<GaitName, number>;

const frac = (t: number) => t - Math.floor(t);

/** Closed-loop Catmull-Rom through the keys (smooth velocity through every key). */
function sample(keys: Keys, t: number): number {
  const n = keys.length;
  const u = frac(t);
  let i = n - 1;
  while (i > 0 && keys[i][0] > u) i--;
  const k1 = keys[i];
  const k2 = keys[(i + 1) % n];
  const p0 = keys[(i - 1 + n) % n][1];
  const p3 = keys[(i + 2) % n][1];
  const t2 = k2[0] <= k1[0] ? k2[0] + 1 : k2[0];
  const s = (u - k1[0]) / (t2 - k1[0]);
  const p1 = k1[1];
  const p2 = k2[1];
  return 0.5 * (2 * p1 + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s * s + (-p0 + 3 * p1 - 3 * p2 + p3) * s * s * s);
}

function gaitLeg(g: Gait, t: number): [number, number, number] {
  const thigh = D - (sample(g.thigh, t) + g.baseThigh);
  const flex = Math.max(0, sample(g.knee, t) + g.baseKnee);
  return [thigh, thigh + flex, sample(g.foot, t)];
}

/** How far the body travels per full cycle when the planted foot doesn't slide. */
function cycleLength(g: Gait): number {
  const footX = (t: number) => {
    const [th, sh] = gaitLeg(g, t);
    return Math.cos(th) * BODY.thigh + Math.cos(sh) * BODY.shin;
  };
  return Math.max(20, (footX(0) - footX(g.stance)) / g.stance);
}
const CYCLE_LEN = Object.fromEntries(Object.entries(GAITS).map(([k, g]) => [k, cycleLength(g)])) as GaitWeights;

/** Distance per cycle for a blend of gaits: advance the cycle by speed / this to plant the feet. */
export function gaitCycleLength(w: GaitWeights): number {
  let sum = 0;
  let len = 0;
  for (const k of Object.keys(GAITS) as GaitName[]) {
    sum += w[k];
    len += w[k] * CYCLE_LEN[k];
  }
  return sum > 0 ? len / sum : CYCLE_LEN.walk;
}

/** Both legs at `cycle` (back leg half a cycle behind) for a weighted blend of gaits. */
export function gaitLegs(w: GaitWeights, cycle: number): LegPose {
  const out: LegPose = { thighF: 0, shinF: 0, footF: 0, thighB: 0, shinB: 0, footB: 0 };
  let sum = 0;
  for (const k of Object.keys(GAITS) as GaitName[]) {
    const wt = w[k];
    if (wt <= 0) continue;
    const g = GAITS[k];
    const f = gaitLeg(g, cycle);
    const b = gaitLeg(g, cycle + 0.5);
    out.thighF += f[0] * wt;
    out.shinF += f[1] * wt;
    out.footF += f[2] * wt;
    out.thighB += b[0] * wt;
    out.shinB += b[1] * wt;
    out.footB += b[2] * wt;
    sum += wt;
  }
  if (sum <= 0) return idleLegs(0);
  for (const key of Object.keys(out) as (keyof LegPose)[]) out[key] /= sum;
  return out;
}

/**
 * Standing still: a relaxed stance, blending into a half-kneel as crouch → 1
 * (front shin upright, back knee near the floor, toes tucked).
 */
export function idleLegs(crouch: number): LegPose {
  const stand: LegPose = { thighF: D - 0.08, shinF: D, footF: 0, thighB: D + 0.1, shinB: D + 0.14, footB: 0 };
  const kneel: LegPose = { thighF: D - 1.42, shinF: D + 0.06, footF: 0, thighB: D + 0.08, shinB: D + 1.5, footB: 1.15 };
  return mixLegs(stand, kneel, crouch);
}

export function mixLegs(a: LegPose, b: LegPose, t: number): LegPose {
  const m = (x: number, y: number) => x + (y - x) * t;
  return { thighF: m(a.thighF, b.thighF), shinF: m(a.shinF, b.shinF), footF: m(a.footF, b.footF), thighB: m(a.thighB, b.thighB), shinB: m(a.shinB, b.shinB), footB: m(a.footB, b.footB) };
}

export function applyLegs(p: Pose, l: LegPose): void {
  p.thighF = l.thighF;
  p.shinF = l.shinF;
  p.footF = l.footF;
  p.thighB = l.thighB;
  p.shinB = l.shinB;
  p.footB = l.footB;
}
