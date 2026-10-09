/**
 * Side-view 2-D skeleton — ported from Dead Meridian (CharacterRig.ts / CharacterPainter.ts).
 * Angles are absolute directions in rig space (radians, y DOWN as in the original canvas
 * convention), facing +x. The Three.js rig converts to y-up when it places the parts.
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** Bone lengths at scale 1 (px) — Dead Meridian's BODY table. */
export const BODY = {
  thigh: 44,
  shin: 44,
  ankle: 10,
  torso: 62,
  neck: 8,
  upperArm: 31,
  foreArm: 29,
  shoulderDrop: 6,
};

/** metres per rig pixel: a 1.75 m soldier is ≈200 px in the original rig */
export const PX = 0.0088;

export interface Pose {
  hipX: number;
  hipY: number;
  torso: number;
  head: number;
  thighF: number;
  shinF: number;
  footF: number;
  thighB: number;
  shinB: number;
  footB: number;
  uArmF: number;
  fArmF: number;
  uArmB: number;
  fArmB: number;
  weaponX: number;
  weaponY: number;
  weaponAngle: number;
  weaponVisible: boolean;
  shoulderB?: Vec2;
}

export interface Joints {
  hip: Vec2;
  neck: Vec2;
  head: Vec2;
  shoulder: Vec2;
  shoulderB?: Vec2;
  elbowF: Vec2;
  handF: Vec2;
  elbowB: Vec2;
  handB: Vec2;
  kneeF: Vec2;
  footF: Vec2;
  kneeB: Vec2;
  footB: Vec2;
  footAngF: number;
  footAngB: number;
}

export const HEAD_OFFSET = 24;
export const LEG_LENGTH = BODY.thigh + BODY.shin + BODY.ankle;

const dir = (a: number, len: number): Vec2 => ({ x: Math.cos(a) * len, y: Math.sin(a) * len });
const add = (p: Vec2, v: Vec2): Vec2 => ({ x: p.x + v.x, y: p.y + v.y });

export function standingPose(): Pose {
  const d = Math.PI / 2;
  return {
    hipX: 0, hipY: -LEG_LENGTH, torso: -d, head: -d, thighF: d - 0.05, shinF: d, footF: 0, thighB: d + 0.08, shinB: d + 0.1, footB: 0,
    uArmF: d + 0.1, fArmF: d - 0.1, uArmB: d - 0.05, fArmB: d - 0.2, weaponX: 20, weaponY: -60, weaponAngle: 0, weaponVisible: false,
  };
}

export function forwardKinematics(p: Pose): Joints {
  const hip = { x: p.hipX, y: p.hipY };
  const neck = add(hip, dir(p.torso, BODY.torso));
  const shoulder = add(hip, dir(p.torso, BODY.torso - BODY.shoulderDrop));
  const head = add(neck, dir(p.head, HEAD_OFFSET));
  const kneeF = add(hip, dir(p.thighF, BODY.thigh));
  const footF = add(kneeF, dir(p.shinF, BODY.shin));
  const kneeB = add(hip, dir(p.thighB, BODY.thigh));
  const footB = add(kneeB, dir(p.shinB, BODY.shin));
  const elbowF = add(shoulder, dir(p.uArmF, BODY.upperArm));
  const handF = add(elbowF, dir(p.fArmF, BODY.foreArm));
  const shoulderB = p.shoulderB ? add(shoulder, p.shoulderB) : shoulder;
  const elbowB = add(shoulderB, dir(p.uArmB, BODY.upperArm));
  const handB = add(elbowB, dir(p.fArmB, BODY.foreArm));
  return {
    hip, neck, head, shoulder, shoulderB: p.shoulderB ? shoulderB : undefined, elbowF, handF, elbowB, handB, kneeF, footF, kneeB, footB,
    footAngF: p.footF, footAngB: p.footB,
  };
}

/** Two-bone IK in the rig plane: shoulder → hand target; returns [upper, fore] absolute angles. */
export function armIK(shoulder: Vec2, target: Vec2, elbowDown = true): [number, number] {
  const a = BODY.upperArm, b = BODY.foreArm;
  const dx = target.x - shoulder.x, dy = target.y - shoulder.y;
  let d = Math.hypot(dx, dy);
  d = Math.min(d, a + b - 0.01);
  d = Math.max(d, Math.abs(a - b) + 0.01);
  const base = Math.atan2(dy, dx);
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const A = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const upper = base + (elbowDown ? A : -A);
  const elbow = { x: shoulder.x + Math.cos(upper) * a, y: shoulder.y + Math.sin(upper) * a };
  const fore = Math.atan2(target.y - elbow.y, target.x - elbow.x);
  return [upper, fore];
}
