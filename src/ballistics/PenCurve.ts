import { clamp } from '../core/math';
import type { AmmoDef } from '../data/ammo';
import { flightTo } from './Flight';

/**
 * Historically derived kinetic penetration curve.
 *
 * Each documented table entry (range r_i, penetration P_i into a plate at θ_ref) is flown through
 * the game's own drag model to get the striking velocity v_i. The plate-at-angle value is then
 * expressed as a NORMAL-equivalent capability with the same obliquity model used at impact
 * (Ballistic Lab: T_eff = T · sec(θ)^k_eff), so that a plate exactly as thick as the table value,
 * at the table angle, is exactly at the limit. Between table points the curve is interpolated in
 * log–log space; beyond the ends it is extrapolated with the round's de Marre exponent.
 */

/** Obliquity exponent relaxed for plates thin relative to the penetrator (overmatch) — Ballistic Lab. */
export function effectiveObliquityExponent(k: number, plateMm: number, penDiameterMm: number) {
  const tOverD = plateMm / Math.max(1, penDiameterMm);
  return 1 + (k - 1) * clamp(tOverD * 1.1, 0.35, 1);
}

export class PenCurve {
  readonly v: number[] = [];
  readonly p0: number[] = [];
  readonly n: number;
  /** table points re-expressed at their own angle (for verification) */
  readonly table: { range: number; velocity: number; documented: number; normalEq: number }[] = [];

  constructor(readonly ammo: AmmoDef) {
    const t = ammo.pen;
    this.n = ammo.velocityExponent ?? 1.43;
    if (!t) return;
    const fl = flightTo(ammo, t.rangesM);
    const k = ammo.obliquityExponent ?? 1.15;
    const sec = 1 / Math.cos((t.angleDeg * Math.PI) / 180);
    const pts = t.rangesM.map((r, i) => {
      const kEff = effectiveObliquityExponent(k, t.mm[i], ammo.penetratorDiameterMm);
      const normalEq = t.mm[i] * Math.pow(sec, kEff);
      this.table.push({ range: r, velocity: fl[i].velocity, documented: t.mm[i], normalEq });
      return { v: fl[i].velocity, p: normalEq };
    });
    pts.sort((a, b) => a.v - b.v);
    for (const p of pts) {
      this.v.push(p.v);
      this.p0.push(p.p);
    }
  }

  get valid() {
    return this.v.length > 0;
  }

  /** normal-equivalent penetration (mm RHA) at striking velocity v */
  at(v: number) {
    const V = this.v, P = this.p0, n = V.length;
    if (!n || v <= 0) return 0;
    if (v <= V[0]) return P[0] * Math.pow(v / V[0], this.n);
    if (v >= V[n - 1]) return P[n - 1] * Math.pow(v / V[n - 1], this.n);
    let i = 0;
    while (i < n - 2 && v > V[i + 1]) i++;
    const lv0 = Math.log(V[i]), lv1 = Math.log(V[i + 1]);
    const t = (Math.log(v) - lv0) / (lv1 - lv0);
    return Math.exp(Math.log(P[i]) + (Math.log(P[i + 1]) - Math.log(P[i])) * t);
  }

  /** velocity at which capability equals `mm` (ballistic limit) */
  limitVelocity(mm: number) {
    if (!this.valid) return Infinity;
    let lo = 1, hi = 4000;
    if (this.at(hi) < mm) return Infinity;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (this.at(mid) < mm) lo = mid;
      else hi = mid;
    }
    return hi;
  }

  /** penetration into a plate at `angleDeg` (what the documented tables quote) at velocity v */
  atAngle(v: number, angleDeg: number) {
    const p0 = this.at(v);
    const k = this.ammo.obliquityExponent ?? 1.15;
    const sec = 1 / Math.cos((angleDeg * Math.PI) / 180);
    // solve T such that T·sec^kEff(T) = p0 (kEff depends weakly on T) — 6 fixed-point steps
    let T = p0 / sec;
    for (let i = 0; i < 6; i++) T = p0 / Math.pow(sec, effectiveObliquityExponent(k, T, this.ammo.penetratorDiameterMm));
    return T;
  }
}

const curves = new Map<string, PenCurve>();
export function penCurve(a: AmmoDef) {
  let c = curves.get(a.id);
  if (!c) curves.set(a.id, (c = new PenCurve(a)));
  return c;
}
