import * as THREE from 'three';
import { clamp, DEG, RAD, rotateTowards, smoothstep } from '../core/math';
import type { RNG } from '../core/rng';
import { isKinetic, type AmmoDef } from '../data/ammo';
import type { ArmorHit, ArmorSet } from './ArmorMesh';
import type { ArmorMaterial } from './Materials';
import { effectiveObliquityExponent, penCurve } from './PenCurve';

/**
 * Plate impact resolution. Equations ported from Ballistic Armour Lab (PenetrationSolver,
 * RicochetSolver, Explosives); the Lab's microsecond crater/fragment integration is replaced by
 * an instantaneous outcome plus a behind-armour effect description that the vehicle damage model
 * traces through the interior.
 *
 *  • Obliquity from the TRUE local surface normal at the hit point (smooth for cast armour).
 *  • Line-of-sight thickness by tracing the shot line through the armour prism.
 *  • KE: capability from the documented table curve (PenCurve), effective thickness
 *    T_los · sec(θ)^(k_eff−1) · material factor / shatter factor; ricochet above the critical
 *    angle (raised by overmatch); residual velocity by Lambert–Jonas, plug momentum shared.
 *  • HEAT: documented jet penetration vs T_los · CE material factor; independent of velocity.
 *  • HE: FM 5-250 steel-cutting rule for the plate it bursts against.
 */

export type ImpactResult = 'RICOCHET' | 'NON-PENETRATION' | 'PENETRATION' | 'SHATTERED' | 'BREACH' | 'BLAST' | 'HEAT JET' | 'DUD';

export interface ImpactGeometry {
  hit: ArmorHit;
  dir: THREE.Vector3;
  speed: number;
  obliquity: number;
  /** normal thickness at the point (m) */
  thicknessN: number;
  /** line-of-sight path through the steel (m) */
  los: number;
  exitPoint: THREE.Vector3;
  material: ArmorMaterial;
}

export function analyzeImpact(armor: ArmorSet, hit: ArmorHit, dir: THREE.Vector3, speed: number): ImpactGeometry {
  const d = dir.clone().normalize();
  const n = hit.normal;
  const cos = clamp(-d.dot(n), 0, 1);
  const obliquity = Math.acos(cos);
  const f = hit.facet;
  let thicknessN = Math.abs(new THREE.Vector3().subVectors(f.ia, hit.point).dot(f.n));
  if (!(thicknessN > 1e-4)) thicknessN = hit.region.nominalMm / 1000;
  const start = hit.point.clone().addScaledVector(d, 1e-5);
  const maxL = Math.max(0.05, (thicknessN / Math.max(0.08, cos)) * 2.5);
  const exit = armor.traceExit(start, d, maxL, hit.region);
  let los = exit ? exit.distance + 1e-5 : thicknessN / Math.max(0.1, cos);
  if (los > (thicknessN / Math.max(0.1, cos)) * 1.8) los = thicknessN / Math.max(0.1, cos);
  const exitPoint = exit ? exit.point.clone() : hit.point.clone().addScaledVector(d, los);
  return { hit, dir: d, speed, obliquity, thicknessN, los, exitPoint, material: hit.region.material };
}

/** Shatter gap (Ballistic Lab): uncapped steel shot overmatched by the plate breaks up above ≈650–720 m/s. */
export function shatterFactor(a: AmmoDef, g: ImpactGeometry) {
  if (a.capped || a.cls === 'APCR' || a.nose === 'blunt') return 1;
  const tOverD = (g.thicknessN * 1000) / a.penetratorDiameterMm;
  const s = smoothstep(0.75, 1.05, tOverD) * smoothstep(620, 720, g.speed) * clamp(g.material.hardness / 0.55, 0.4, 1.3);
  return 1 - 0.25 * clamp(s, 0, 1);
}

export function keEffectiveMm(a: AmmoDef, g: ImpactGeometry) {
  const k = effectiveObliquityExponent(a.obliquityExponent ?? 1.15, g.thicknessN * 1000, a.penetratorDiameterMm);
  const sec = 1 / Math.max(0.08, Math.cos(g.obliquity));
  return (g.los * 1000 * Math.pow(sec, k - 1) * g.material.keEffectiveness) / shatterFactor(a, g);
}

/** critical ricochet obliquity (rad), raised when the round overmatches the plate */
export function ricochetAngle(a: AmmoDef, thicknessN: number, jitterDeg: number) {
  const om = a.caliberMm / 1000 / Math.max(1e-3, thicknessN);
  const bonus = clamp((om - 1.5) * 6, 0, 14);
  return (a.ricochetDeg + bonus + jitterDeg) * DEG;
}

/** Ricochet: normal momentum mostly destroyed, tangential reduced by gouging (Ballistic Lab). */
export function ricochetVelocity(g: ImpactGeometry) {
  const d = g.dir, n = g.hit.normal, v = g.speed;
  const vn = d.dot(n) * v;
  const vt = d.clone().addScaledVector(n, -d.dot(n)).multiplyScalar(v);
  const vtMag = vt.length();
  const cosO = Math.cos(g.obliquity);
  const mu = 0.08 + 0.35 * cosO;
  const vtOut = Math.max(0, vtMag - mu * Math.abs(vn) * 2.2) * (0.92 - 0.25 * cosO);
  const vnOut = Math.abs(vn) * 0.12 * (0.6 + 0.4 * g.material.hardness);
  const tDir = vtMag > 1e-6 ? vt.multiplyScalar(1 / vtMag) : new THREE.Vector3(0, 1, 0);
  return tDir.multiplyScalar(vtOut).addScaledVector(n, vnOut);
}

/** FM 5-250 steel-cutting rule (Ballistic Lab Explosives): plate thickness (m) an HE burst can breach. */
export function heBreachThicknessM(a: AmmoDef, obliquity: number, mat: ArmorMaterial) {
  const he = a.he;
  if (!he) return 0;
  const tMm = (1207 * he.fillerKg * he.tntEq) / a.caliberMm;
  return ((tMm / 1000) * Math.max(0.15, Math.cos(obliquity))) / Math.max(0.3, mat.keEffectiveness);
}

/** What happens behind the plate — traced through the interior by the vehicle damage model. */
export interface BehindArmour {
  /** where the residual penetrator / jet / blast starts (armour-frame local) */
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  /** residual penetrator: mass (kg) and speed (m/s) — 0 for HEAT/HE */
  residualMassKg: number;
  residualV: number;
  /** HEAT residual jet capability (mm RHA) */
  jetMm: number;
  /** spall: number of fragments and total energy (J) */
  spallCount: number;
  spallEnergyJ: number;
  spallConeDeg: number;
  /** explosive filler that functions inside (kg TNT eq) and the distance it travels first (m) */
  burstKg: number;
  burstAfterM: number;
}

export interface ImpactOutcome {
  result: ImpactResult;
  ammo: AmmoDef;
  regionName: string;
  group: string;
  material: string;
  nominalMm: number;
  angleDeg: number;
  losMm: number;
  effectiveMm: number;
  capabilityMm: number;
  velocity: number;
  energyKJ: number;
  criticalDeg: number;
  /** outgoing velocity (local frame) for ricochets */
  ricochetVel?: THREE.Vector3;
  behind?: BehindArmour;
  /** external effects (HE / spaced plates / tracks) */
  blastKg?: number;
  notes: string[];
}

function base(a: AmmoDef, g: ImpactGeometry, mass: number): ImpactOutcome {
  return {
    result: 'NON-PENETRATION', ammo: a, regionName: g.hit.region.name, group: g.hit.region.group, material: g.material.short,
    nominalMm: g.hit.region.nominalMm, angleDeg: g.obliquity * RAD, losMm: g.los * 1000, effectiveMm: 0, capabilityMm: 0,
    velocity: g.speed, energyKJ: (0.5 * mass * g.speed * g.speed) / 1000, criticalDeg: 90, notes: [],
  };
}

/**
 * Resolve one projectile striking one armour region.
 * `massKg`: current projectile mass (a core that already went through spaced armour is lighter);
 * `heatMm`: remaining jet capability for HEAT (spaced plates erode it).
 */
export function resolveImpact(a: AmmoDef, g: ImpactGeometry, rng: RNG, massKg: number, heatMm?: number): ImpactOutcome {
  const o = base(a, g, massKg);
  const losMm = g.los * 1000;

  /* ---------------------------------------------------------------- SMOKE */
  if (a.cls === 'SMOKE') {
    o.result = 'DUD';
    o.notes.push('smoke round — no armour effect');
    return o;
  }

  /* ---------------------------------------------------------------- HEAT */
  if (a.cls === 'HEAT') {
    o.criticalDeg = a.ricochetDeg;
    if (g.obliquity > a.ricochetDeg * DEG + rng.normal(0, 2) * DEG) {
      o.result = 'RICOCHET';
      o.ricochetVel = ricochetVelocity(g);
      o.notes.push('fuze did not function at grazing impact');
      return o;
    }
    const cap = heatMm ?? a.heat!.penMm;
    const eff = losMm * g.material.ceEffectiveness;
    o.capabilityMm = cap;
    o.effectiveMm = eff;
    if (g.hit.region.spaced) {
      // the jet forms at the skirt and must cross the gap: WWII liners lose coherence quickly
      o.result = 'HEAT JET';
      o.notes.push('detonated on spaced plate — jet crosses the air gap');
      return o;
    }
    if (cap >= eff) {
      o.result = 'PENETRATION';
      o.behind = {
        origin: g.exitPoint.clone(), dir: g.dir.clone(), residualMassKg: 0, residualV: 0, jetMm: cap - eff,
        spallCount: Math.round(6 + 10 * g.material.spallTendency), spallEnergyJ: 1500 + 40 * eff, spallConeDeg: 18, burstKg: 0, burstAfterM: 0,
      };
    } else {
      o.result = 'NON-PENETRATION';
      o.notes.push(`jet stopped ${(eff - cap).toFixed(0)} mm short`);
    }
    return o;
  }

  /* ---------------------------------------------------------------- HE */
  if (a.cls === 'HE') {
    const breach = heBreachThicknessM(a, g.obliquity, g.material);
    o.capabilityMm = breach * 1000;
    o.effectiveMm = g.thicknessN * 1000;
    o.blastKg = a.he!.fillerKg * a.he!.tntEq;
    if (g.thicknessN <= breach && !g.hit.region.auxiliary) {
      o.result = 'BREACH';
      o.notes.push('HE burst breached the plate');
      o.behind = {
        origin: g.exitPoint.clone(), dir: g.dir.clone(), residualMassKg: 0, residualV: 0, jetMm: 0,
        spallCount: 18, spallEnergyJ: 9000 * o.blastKg, spallConeDeg: 55, burstKg: o.blastKg * 0.6, burstAfterM: 0.05,
      };
    } else {
      o.result = 'BLAST';
      o.notes.push('HE burst on the outside');
    }
    return o;
  }

  /* ---------------------------------------------------------------- KINETIC */
  if (!isKinetic(a)) return o;
  const curve = penCurve(a);
  const massFrac = clamp(massKg / a.massKg.value, 0.05, 1);
  const cap = curve.at(g.speed) * Math.pow(massFrac, 0.71);
  const eff = keEffectiveMm(a, g);
  const crit = ricochetAngle(a, g.thicknessN, rng.normal(0, 1.2));
  o.capabilityMm = cap;
  o.effectiveMm = eff;
  o.criticalDeg = crit * RAD;
  const sf = shatterFactor(a, g);

  if (g.obliquity > crit || (g.obliquity > 55 * DEG && cap < eff * 0.9)) {
    o.result = 'RICOCHET';
    o.ricochetVel = ricochetVelocity(g);
    o.notes.push(`critical angle ≈ ${(crit * RAD).toFixed(0)}°`);
    return o;
  }
  if (cap < eff) {
    o.result = sf < 0.97 && cap >= eff * sf ? 'SHATTERED' : 'NON-PENETRATION';
    if (o.result === 'SHATTERED') o.notes.push('shot shattered on the face (shatter gap)');
    // near-limit hits on brittle plate throw scab from the rear face
    if (cap > eff * 0.85 && g.material.ductility < 0.45) {
      o.notes.push('rear-face spalling without perforation');
      o.behind = {
        origin: g.exitPoint.clone(), dir: g.dir.clone(), residualMassKg: 0, residualV: 0, jetMm: 0,
        spallCount: 5, spallEnergyJ: 600, spallConeDeg: 60, burstKg: 0, burstAfterM: 0,
      };
    }
    return o;
  }

  o.result = 'PENETRATION';
  // Lambert–Jonas residual velocity, then the plug's momentum is shared with the penetrator
  const vbl = curve.limitVelocity(eff / Math.pow(massFrac, 0.71));
  const vr0 = Math.sqrt(Math.max(0, g.speed * g.speed - vbl * vbl));
  const penMass = a.cls === 'APCR' ? a.penetratorMassKg : Math.min(massKg, a.penetratorMassKg);
  const d = a.penetratorDiameterMm / 1000;
  const plugMass = 7850 * Math.PI * (d / 2) ** 2 * g.thicknessN * 0.6;
  const vr = (vr0 * penMass) / (penMass + plugMass);
  // capped / blunt rounds normalise toward the plate normal inside the steel
  const norm = a.capped || a.nose === 'blunt' ? 0.3 : 0.15;
  const inside = rotateTowards(g.dir, g.hit.normal.clone().negate(), g.obliquity * norm);
  // behind-armour debris grows as the round barely gets through and with brittle plate
  const margin = clamp(1 - eff / cap, 0, 1);
  const tendency = g.material.spallTendency * (a.cls === 'APCR' ? 1.35 : 1);
  const spallCount = Math.round(clamp((14 + 30 * (1 - margin)) * tendency * (g.thicknessN / 0.05) ** 0.5, 6, 60));
  const spallEnergy = 0.5 * plugMass * vr0 * vr0 * 0.7 + 0.08 * 0.5 * penMass * g.speed * g.speed * (1 - margin);
  const burstKg = a.filler && sf >= 0.97 ? a.filler.kg : 0;
  o.behind = {
    origin: g.exitPoint.clone(), dir: inside, residualMassKg: penMass, residualV: vr, jetMm: 0,
    spallCount, spallEnergyJ: spallEnergy, spallConeDeg: a.cls === 'APCR' ? 40 : 32,
    burstKg, burstAfterM: burstKg ? vr * a.filler!.fuzeDelayS : 0,
  };
  if (sf < 0.97) o.notes.push('shot broke up while perforating');
  o.notes.push(`residual ${vr.toFixed(0)} m/s`);
  return o;
}

/** Quick capability estimate for AI / UI: can `a` defeat `mm` at `angleDeg` from `range`? */
export function estimatePenAt(a: AmmoDef, velocity: number, angleDeg: number) {
  if (a.cls === 'HEAT') return a.heat!.penMm * Math.cos(angleDeg * DEG);
  if (a.cls === 'HE') return (1207 * a.he!.fillerKg * a.he!.tntEq) / a.caliberMm;
  if (!isKinetic(a)) return 0;
  return penCurve(a).atAngle(velocity, angleDeg);
}
