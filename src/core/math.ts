import * as THREE from 'three';

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => (b === a ? 0 : (v - a) / (b - a));
export const saturate = (v: number) => clamp(v, 0, 1);
export const smoothstep = (a: number, b: number, v: number) => {
  const t = saturate((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const smootherstep = (a: number, b: number, v: number) => {
  const t = saturate((v - a) / (b - a));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Build an orthonormal basis (u, v) perpendicular to n. */
export function basisFromNormal(n: THREE.Vector3, u = new THREE.Vector3(), v = new THREE.Vector3()) {
  const ref = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  u.crossVectors(ref, n).normalize();
  v.crossVectors(n, u).normalize();
  return { u, v };
}

/** Rotate vector a towards b by up to angle (radians). */
export function rotateTowards(a: THREE.Vector3, b: THREE.Vector3, angle: number, out = new THREE.Vector3()) {
  const an = a.clone().normalize();
  const bn = b.clone().normalize();
  const cos = clamp(an.dot(bn), -1, 1);
  const full = Math.acos(cos);
  if (full < 1e-6) return out.copy(an);
  const t = Math.min(1, angle / full);
  const axis = new THREE.Vector3().crossVectors(an, bn);
  if (axis.lengthSq() < 1e-12) return out.copy(an);
  axis.normalize();
  return out.copy(an).applyAxisAngle(axis, full * t);
}

/** Möller–Trumbore ray/triangle. Returns distance or -1. */
export function rayTriangle(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  out?: { u: number; v: number },
): number {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -1e-12 && det < 1e-12) return -1;
  const inv = 1 / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-7 || u > 1 + 1e-7) return -1;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < -1e-7 || u + v > 1 + 1e-7) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  if (out) { out.u = u; out.v = v; }
  return t;
}

/** Segment vs oriented box. Returns t in [0,1] of first entry and the entry normal, or -1. */
export function segmentOBB(
  p0: THREE.Vector3, p1: THREE.Vector3,
  center: THREE.Vector3, axes: [THREE.Vector3, THREE.Vector3, THREE.Vector3], half: THREE.Vector3,
  outNormal?: THREE.Vector3,
): number {
  let tmin = 0, tmax = 1;
  let hitAxis = -1, hitSign = 1;
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  const rx = p0.x - center.x, ry = p0.y - center.y, rz = p0.z - center.z;
  const h = [half.x, half.y, half.z];
  for (let i = 0; i < 3; i++) {
    const a = axes[i];
    const e = a.x * rx + a.y * ry + a.z * rz;
    const f = a.x * dx + a.y * dy + a.z * dz;
    if (Math.abs(f) < 1e-12) {
      if (e < -h[i] || e > h[i]) return -1;
      continue;
    }
    let t1 = (-h[i] - e) / f;
    let t2 = (h[i] - e) / f;
    let sign = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
    if (t1 > tmin) { tmin = t1; hitAxis = i; hitSign = sign; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (hitAxis < 0) return -1; // started inside
  if (outNormal) outNormal.copy(axes[hitAxis]).multiplyScalar(hitSign);
  return tmin;
}

export function segmentSphere(p0: THREE.Vector3, p1: THREE.Vector3, c: THREE.Vector3, r: number): number {
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  const fx = p0.x - c.x, fy = p0.y - c.y, fz = p0.z - c.z;
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const cc = fx * fx + fy * fy + fz * fz - r * r;
  if (cc < 0) return -1;
  const disc = b * b - 4 * a * cc;
  if (disc < 0 || a < 1e-14) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

/** Signed-distance-free 2D convex hull (monotone chain). */
export function convexHull2D(pts: [number, number][]): [number, number][] {
  const p = pts.slice().sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export function formatNum(v: number, digits = 0) {
  if (!isFinite(v)) return '—';
  return v.toFixed(digits);
}

/* ---------------------------------------------------------------- game additions */

/** Wrap an angle to (-π, π]. */
export function wrapAngle(a: number) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** Move an angle towards a target by at most `step` (shortest way). */
export function approachAngle(a: number, target: number, step: number) {
  const d = wrapAngle(target - a);
  if (Math.abs(d) <= step) return target;
  return a + Math.sign(d) * step;
}

/** Move a value towards a target by at most `step`. */
export function approach(v: number, target: number, step: number) {
  if (v < target) return Math.min(target, v + step);
  return Math.max(target, v - step);
}

/** Frame-rate independent exponential smoothing factor. */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** Segment (2D) vs axis-aligned rectangle, returns entry t in [0,1] or -1. */
export function segmentAABB2(x0: number, z0: number, x1: number, z1: number, minX: number, minZ: number, maxX: number, maxZ: number) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dz = z1 - z0;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  if (clip(-dx, x0 - minX) && clip(dx, maxX - x0) && clip(-dz, z0 - minZ) && clip(dz, maxZ - z0)) return t0;
  return -1;
}

export const fmt = (v: number, d = 0) => (isFinite(v) ? v.toFixed(d) : '—');
