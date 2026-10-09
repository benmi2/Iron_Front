import * as THREE from 'three';
import { basisFromNormal, clamp, segmentOBB } from '../core/math';
import { isKinetic, type AmmoDef } from '../data/ammo';
import type { ArmorHit } from '../ballistics/ArmorMesh';
import { analyzeImpact, resolveImpact, type BehindArmour, type ImpactOutcome } from '../ballistics/Penetration';
import { penCurve } from '../ballistics/PenCurve';
import type { Frame, ExternalPart } from './TankBuilder';
import type { CompState, Tank } from './Tank';
import type { World } from '../world/World';

/* ====================================================================== hit test */

export interface TankHit {
  /** parameter along the tested segment */
  t: number;
  frame: Frame;
  armor?: ArmorHit;
  part?: ExternalPart;
  /** frame-local direction of travel */
  localDir: THREE.Vector3;
  worldPoint: THREE.Vector3;
}

const FRAMES: Frame[] = ['hull', 'turret', 'gun'];
const _inv = new THREE.Matrix4();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const AXES: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

/**
 * Earliest thing a segment strikes on a tank: an armour plate in any of the three frames or an
 * external part (track run, gun barrel). `skipRegion` avoids re-hitting the plate a ricochet
 * just left.
 */
export function tankHitTest(tank: Tank, p0: THREE.Vector3, p1: THREE.Vector3, skipRegionId = -1, skipParts: ExternalPart[] = []): TankHit | null {
  const segLen = p0.distanceTo(p1);
  if (segLen < 1e-6) return null;
  let best: TankHit | null = null;
  for (const f of FRAMES) {
    _inv.copy(tank.frameMatrix(f)).invert();
    const a = _a.copy(p0).applyMatrix4(_inv);
    const b = _b.copy(p1).applyMatrix4(_inv);
    const dir = b.clone().sub(a);
    const len = dir.length();
    dir.multiplyScalar(1 / len);
    const set = tank.model.armor[f];
    const hit = set.raycast(a, dir, len, 'outer', skipRegionId >= 0 ? (r) => r.id !== skipRegionId : undefined);
    if (hit) {
      const t = hit.distance / len;
      if (!best || t < best.t) best = { t, frame: f, armor: hit, localDir: dir.clone(), worldPoint: p0.clone().lerp(p1, t) };
    }
    for (const part of tank.model.external) {
      if (part.frame !== f || skipParts.includes(part)) continue;
      const t = segmentOBB(a, b, part.center, AXES, part.half);
      if (t >= 0 && (!best || t < best.t)) best = { t, frame: f, part, localDir: dir.clone(), worldPoint: p0.clone().lerp(p1, t) };
    }
  }
  return best;
}

/* ====================================================================== reports (X-ray replay) */

export interface ReportLine {
  a: THREE.Vector3;
  b: THREE.Vector3;
  kind: 'shell' | 'residual' | 'spall' | 'jet' | 'burst' | 'ricochet';
  hit: boolean;
}

export interface ImpactReport {
  time: number;
  shooter: string;
  shooterTeam: string;
  target: Tank;
  targetName: string;
  ammo: AmmoDef;
  range: number;
  outcome: ImpactOutcome | null;
  partName?: string;
  /** hull-frame geometry for the X-ray view */
  entry: THREE.Vector3;
  normal: THREE.Vector3;
  inDir: THREE.Vector3;
  lines: ReportLine[];
  /** components struck and what happened */
  hits: { name: string; kind: string; status: string }[];
  effects: string[];
  headline: string;
  severity: 0 | 1 | 2 | 3;
}

/* ====================================================================== resolution */

export interface ShellLike {
  ammo: AmmoDef;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  mass: number;
  heatMm: number;
  owner: Tank | null;
  ownerName: string;
  ownerTeam: string;
  origin: THREE.Vector3;
  /** HEAT jet travelling after a spaced plate / track */
  jetLeft: number;
  skipRegion: number;
  skipParts: ExternalPart[];
}

export interface ResolveResult {
  /** shell keeps flying (ricochet / through spaced plate / exited) */
  continues: boolean;
  /** explode an HE / HEAT round at this world point (outside the vehicle) */
  burstAt?: THREE.Vector3;
  report?: ImpactReport;
}

const toHull = new THREE.Matrix4();

function hullPoint(tank: Tank, frame: Frame, p: THREE.Vector3) {
  return p.clone().applyMatrix4(tank.frameToHull(frame, toHull));
}
function hullDir(tank: Tank, frame: Frame, d: THREE.Vector3) {
  return d.clone().transformDirection(tank.frameToHull(frame, toHull));
}

export function resolveShellHit(w: World, s: ShellLike, tank: Tank, h: TankHit): ResolveResult {
  const a = s.ammo;
  const speed = s.vel.length();
  const range = s.origin.distanceTo(h.worldPoint);
  const frameMat = tank.frameMatrix(h.frame);
  const report: ImpactReport = {
    time: w.time, shooter: s.ownerName, shooterTeam: s.ownerTeam, target: tank, targetName: tank.callsign, ammo: a, range, outcome: null,
    entry: new THREE.Vector3(), normal: new THREE.Vector3(), inDir: hullDir(tank, h.frame, h.localDir), lines: [], hits: [], effects: [], headline: '', severity: 0,
  };
  tank.lastHitT = w.time;
  if (s.owner && s.owner !== tank) tank.lastHitBy = s.owner;
  const wasActive = tank.state === 'active';

  /* -------------------------------------------------------------- external parts */
  if (h.part) {
    const part = h.part;
    report.partName = part.name;
    const lp = h.worldPoint.clone().applyMatrix4(_inv.copy(frameMat).invert());
    report.entry.copy(hullPoint(tank, h.frame, lp));
    report.normal.copy(report.inDir).negate();
    report.lines.push({ a: report.entry.clone().addScaledVector(report.inDir, -4), b: report.entry.clone(), kind: 'shell', hit: true });
    if (part.kind === 'barrel') {
      const E = 0.5 * s.mass * speed * speed;
      if (a.cls === 'HE' || E > 60000) {
        tank.barrelDestroyed = a.cls !== 'HE' || w.rng.chance(0.4);
        tank.barrelDamaged = true;
        report.effects.push(tank.barrelDestroyed ? 'Gun barrel destroyed' : 'Gun barrel damaged');
      }
      w.effects.armorSpark(h.worldPoint, report.inDir.clone().negate().transformDirection(tank.root.matrixWorld), null, 0.8);
      report.headline = tank.barrelDestroyed ? 'GUN DESTROYED' : 'BARREL HIT';
      report.severity = tank.barrelDestroyed ? 2 : 1;
      w.addReport(report);
      return { continues: false, burstAt: a.cls === 'HE' ? h.worldPoint : undefined, report };
    }
    // track run & suspension: breaks the track, soaks some of a KE round, sets off HE/HEAT
    const side = part.side ?? 1;
    if (a.cls === 'HE') {
      const pBreak = clamp(0.4 + a.he!.fillerKg * 0.9, 0, 0.95);
      if (w.rng.chance(pBreak)) { tank.breakTrack(side, w); report.effects.push('Track broken'); }
      report.headline = report.effects.length ? 'TRACK DESTROYED' : 'HE ON RUNNING GEAR';
      report.severity = report.effects.length ? 2 : 1;
      w.addReport(report);
      return { continues: false, burstAt: h.worldPoint, report };
    }
    if (a.cls === 'SMOKE') return { continues: false, burstAt: h.worldPoint };
    if (a.cls === 'HEAT') {
      if (w.rng.chance(0.5)) { tank.breakTrack(side, w); report.effects.push('Track broken'); }
      // the jet forms at the track and must cross the gap to the hull side
      s.heatMm = Math.max(0, s.heatMm - part.absorbMm - 25);
      s.jetLeft = 1.4;
      s.skipParts.push(part);
      w.effects.explosion(h.worldPoint, 0.3, false, w.terrain.height(h.worldPoint.x, h.worldPoint.z), false);
      report.headline = 'HEAT ON TRACK';
      report.severity = 1;
      w.addReport(report);
      return { continues: true, report };
    }
    // kinetic: the round passes through links / wheels and loses capability
    const curve = penCurve(a);
    const cap = curve.at(speed);
    if (cap > 20 && w.rng.chance(0.65)) { tank.breakTrack(side, w); report.effects.push('Track broken'); }
    const vbl = curve.limitVelocity(part.absorbMm);
    const v2 = speed * speed - vbl * vbl;
    w.effects.armorSpark(h.worldPoint, s.vel.clone().normalize().negate(), null, 0.6);
    w.audio.impact(h.worldPoint, 'track');
    if (v2 <= 0 || !isFinite(vbl)) {
      report.headline = report.effects.length ? 'TRACK BROKEN' : 'STOPPED BY RUNNING GEAR';
      report.severity = report.effects.length ? 2 : 0;
      w.addReport(report);
      return { continues: false, report };
    }
    s.vel.multiplyScalar(Math.sqrt(v2) / speed);
    s.skipParts.push(part);
    if (report.effects.length) {
      report.headline = 'TRACK BROKEN';
      report.severity = 2;
      w.addReport(report);
    }
    return { continues: true, report };
  }

  /* -------------------------------------------------------------- armour plate */
  const hit = h.armor!;
  const set = tank.model.armor[h.frame];
  const g = analyzeImpact(set, hit, h.localDir, speed);
  const out = resolveImpact(a, g, w.rng, s.mass, a.cls === 'HEAT' ? s.heatMm : undefined);
  report.outcome = out;
  report.entry.copy(hullPoint(tank, h.frame, hit.point));
  report.normal.copy(hullDir(tank, h.frame, hit.normal));
  report.lines.push({ a: report.entry.clone().addScaledVector(report.inDir, -5), b: report.entry.clone(), kind: 'shell', hit: true });
  const worldNormal = hit.normal.clone().transformDirection(frameMat);
  const group = h.frame === 'hull' ? tank.model.hull : h.frame === 'turret' ? tank.model.turret : tank.model.gun;
  const res: ResolveResult = { continues: false, report };

  switch (out.result) {
    case 'RICOCHET': {
      const v = out.ricochetVel!.clone().transformDirection(frameMat).multiplyScalar(out.ricochetVel!.length());
      s.vel.copy(v);
      s.pos.copy(h.worldPoint).addScaledVector(worldNormal, 0.02);
      s.skipRegion = hit.region.id;
      w.effects.armorSpark(h.worldPoint, worldNormal, v.clone().normalize(), 1);
      w.effects.holeDecal(group, h.worldPoint, worldNormal, a.caliberMm / 1000 * 3, true);
      w.audio.impact(h.worldPoint, 'ricochet');
      report.headline = 'RICOCHET';
      report.lines.push({ a: report.entry.clone(), b: report.entry.clone().addScaledVector(hullDir(tank, h.frame, out.ricochetVel!.clone().normalize()), 3), kind: 'ricochet', hit: false });
      res.continues = v.length() > 60;
      break;
    }
    case 'NON-PENETRATION':
    case 'SHATTERED':
    case 'DUD': {
      w.effects.armorSpark(h.worldPoint, worldNormal, null, a.caliberMm / 75);
      w.effects.holeDecal(group, h.worldPoint, worldNormal, a.caliberMm / 1000 * 2.2, true);
      w.audio.impact(h.worldPoint, 'clang');
      report.headline = out.result === 'SHATTERED' ? 'SHATTERED' : a.cls === 'HEAT' ? 'JET STOPPED' : 'NO PENETRATION';
      if (out.behind) traceInterior(w, tank, h.frame, out.behind, a, report, s);
      // concussion: a heavy hit rattles the crew
      if (s.mass * speed * speed * 0.5 > 400000) tank.swapT = Math.max(tank.swapT, 1.5);
      if (a.cls === 'HEAT') res.burstAt = h.worldPoint;
      break;
    }
    case 'HEAT JET': {
      // detonated on a skirt: the jet crosses the stand-off gap and loses coherence
      s.heatMm = out.capabilityMm * 0.72;
      s.jetLeft = 1.0;
      s.skipRegion = hit.region.id;
      s.pos.copy(h.worldPoint);
      w.effects.explosion(h.worldPoint, 0.25, false, 0, false);
      report.headline = 'SKIRT HIT — JET CONTINUES';
      res.continues = true;
      break;
    }
    case 'BLAST': {
      report.headline = 'HE BLAST (OUTSIDE)';
      res.burstAt = h.worldPoint;
      break;
    }
    case 'PENETRATION':
    case 'BREACH': {
      if (hit.region.spaced) {
        // through a skirt / spare links / sandbags: the round keeps going toward the main armour
        const v = out.behind && out.behind.residualV > 0 ? out.behind.residualV : speed * 0.95;
        if (a.cls === 'HEAT') { s.heatMm = Math.max(0, out.capabilityMm - out.effectiveMm) * 0.75; s.jetLeft = 1.0; }
        s.vel.normalize().multiplyScalar(v);
        s.pos.copy(h.worldPoint);
        s.skipRegion = hit.region.id;
        w.effects.armorSpark(h.worldPoint, worldNormal, null, 0.5);
        report.headline = `THROUGH ${hit.region.name.toUpperCase()}`;
        res.continues = v > 60;
        break;
      }
      w.effects.penetrationFlash(h.worldPoint, worldNormal);
      w.effects.holeDecal(group, h.worldPoint, worldNormal, a.caliberMm / 1000 * 1.8);
      w.audio.impact(h.worldPoint, 'pen');
      report.headline = out.result === 'BREACH' ? 'HE BREACHED THE PLATE' : 'PENETRATION';
      if (out.behind) {
        const exit = traceInterior(w, tank, h.frame, out.behind, a, report, s);
        if (exit) {
          s.pos.copy(exit.pos);
          s.vel.copy(exit.vel);
          s.skipRegion = -1;
          res.continues = true;
        }
      }
      if (out.result === 'BREACH') res.burstAt = undefined;
      break;
    }
  }

  // severity & attribution
  if (out.result === 'PENETRATION' || out.result === 'BREACH') report.severity = report.effects.some((e) => /DETONATION|killed|destroyed|fire/i.test(e)) ? 3 : 2;
  else if (out.result === 'RICOCHET') report.severity = 0;
  else report.severity = report.effects.length ? 1 : 0;
  if (wasActive && tank.state !== 'active' && !tank.killedBy && s.owner && s.owner.team !== tank.team) tank.killedBy = s.owner;
  if (s.owner && s.owner.team !== tank.team && (report.severity >= 2)) s.owner.stats.damageDealt++;
  w.addReport(report);
  return res;
}

/* ====================================================================== interior */

interface OBB {
  comp: CompState;
  center: THREE.Vector3;
  axes: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  half: THREE.Vector3;
}

/** energy (J) a component can soak from a penetrator passing through it */
const STOP_J: Record<string, number> = {
  crew: 4000, ammo: 40000, fuel: 12000, engine: 160000, transmission: 160000, breech: 220000, traverse: 20000, radio: 6000, optics: 3000, structure: 50000,
};
/** RHA-equivalent mm a HEAT jet loses crossing a component */
const JET_MM: Record<string, number> = {
  crew: 12, ammo: 45, fuel: 30, engine: 140, transmission: 140, breech: 160, traverse: 25, radio: 10, optics: 8, structure: 40,
};

function componentBoxes(tank: Tank): OBB[] {
  const out: OBB[] = [];
  const m = new THREE.Matrix4();
  for (const c of tank.comps) {
    tank.frameToHull(c.def.frame, m);
    const center = c.def.center.clone().applyMatrix4(m);
    const axes: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
      new THREE.Vector3(1, 0, 0).transformDirection(m), new THREE.Vector3(0, 1, 0).transformDirection(m), new THREE.Vector3(0, 0, 1).transformDirection(m),
    ];
    out.push({ comp: c, center, axes, half: c.def.half });
  }
  return out;
}

/** components a ray crosses, ordered by distance */
function alongRay(boxes: OBB[], o: THREE.Vector3, d: THREE.Vector3, len: number) {
  const p1 = o.clone().addScaledVector(d, len);
  const hits: { box: OBB; t: number }[] = [];
  for (const b of boxes) {
    const t = segmentOBB(o, p1, b.center, b.axes, b.half);
    if (t >= 0) hits.push({ box: b, t: t * len });
  }
  hits.sort((x, y) => x.t - y.t);
  return hits;
}

/** distance from an interior point to the inner face of the armour along d (any frame) */
function wallDistance(tank: Tank, o: THREE.Vector3, d: THREE.Vector3): { dist: number; frame: Frame; hit: ArmorHit } | null {
  let best: { dist: number; frame: Frame; hit: ArmorHit } | null = null;
  const m = new THREE.Matrix4();
  for (const f of FRAMES) {
    tank.frameToHull(f, m);
    const inv = m.clone().invert();
    const lo = o.clone().applyMatrix4(inv);
    const ld = d.clone().transformDirection(inv);
    const hit = tank.model.armor[f].raycast(lo.addScaledVector(ld, 0.03), ld, 6, 'inner', (r) => !r.auxiliary);
    if (hit && (!best || hit.distance < best.dist)) best = { dist: hit.distance + 0.03, frame: f, hit };
  }
  return best;
}

function record(report: ImpactReport, label: string | null, comp: CompState) {
  if (!report.hits.some((h) => h.name === comp.def.name)) report.hits.push({ name: comp.def.name, kind: comp.def.kind, status: comp.status });
  else {
    const h = report.hits.find((x) => x.name === comp.def.name)!;
    h.status = comp.status;
  }
  if (label && !report.effects.includes(label)) report.effects.push(label);
}

/**
 * What happens inside: residual penetrator / jet line, spall cone, filler burst — each traced
 * through the actual component volumes. Returns the exit state if the round leaves the vehicle.
 */
function traceInterior(w: World, tank: Tank, frame: Frame, b: BehindArmour, a: AmmoDef, report: ImpactReport, s: ShellLike): { pos: THREE.Vector3; vel: THREE.Vector3 } | null {
  const rng = w.rng;
  const boxes = componentBoxes(tank);
  const o = hullPoint(tank, frame, b.origin);
  const d = hullDir(tank, frame, b.dir).normalize();
  let exit: { pos: THREE.Vector3; vel: THREE.Vector3 } | null = null;
  const wall = wallDistance(tank, o, d);
  const pathLen = wall ? wall.dist : 3.5;

  // ---- residual penetrator (KE)
  if (b.residualV > 0) {
    let E = 0.5 * b.residualMassKg * b.residualV * b.residualV;
    const E0 = E;
    let stopAt = pathLen;
    for (const { box, t } of alongRay(boxes, o, d, pathLen)) {
      if (E <= 0) break;
      const cap = STOP_J[box.comp.def.kind] ?? 20000;
      const label = tank.damageComp(box.comp, Math.min(E, cap * 2), w, 'projectile', true);
      record(report, label, box.comp);
      E -= cap;
      if (E <= 0) stopAt = t;
    }
    const end = o.clone().addScaledVector(d, Math.max(0.05, Math.min(stopAt, pathLen)));
    report.lines.push({ a: o.clone(), b: end, kind: 'residual', hit: true });
    // reaching the far wall with energy left: does it perforate it too?
    if (E > 0 && wall && isKinetic(a)) {
      const v = Math.sqrt((2 * E) / b.residualMassKg);
      const far = wall.hit.region;
      const curve = penCurve(a);
      const capMm = curve.at(v) * Math.pow(clamp(b.residualMassKg / a.massKg.value, 0.05, 1), 0.71);
      if (capMm > far.nominalMm * 1.1 * far.material.keEffectiveness) {
        const vbl = curve.limitVelocity(far.nominalMm);
        const vr = Math.sqrt(Math.max(0, v * v - vbl * vbl));
        if (vr > 50) {
          const wp = end.clone().addScaledVector(d, 0.1).applyMatrix4(tank.root.matrixWorld);
          exit = { pos: wp, vel: d.clone().transformDirection(tank.root.matrixWorld).multiplyScalar(vr) };
          report.effects.push('Exited through the far side');
        }
      }
    }
    void E0;
  }

  // ---- HEAT jet
  if (b.jetMm > 0) {
    let mm = b.jetMm;
    let stopAt = pathLen;
    for (const { box, t } of alongRay(boxes, o, d, pathLen)) {
      if (mm <= 0) break;
      const label = tank.damageComp(box.comp, 50000, w, 'jet', true);
      record(report, label, box.comp);
      mm -= JET_MM[box.comp.def.kind] ?? 30;
      if (mm <= 0) stopAt = t;
    }
    report.lines.push({ a: o.clone(), b: o.clone().addScaledVector(d, Math.min(stopAt, pathLen)), kind: 'jet', hit: true });
  }

  // ---- spall / behind-armour debris cone
  if (b.spallCount > 0) {
    const n = b.spallCount;
    const e = b.spallEnergyJ / n;
    const { u, v } = basisFromNormal(d);
    const half = (b.spallConeDeg * Math.PI) / 180;
    for (let i = 0; i < n; i++) {
      const th = Math.sqrt(rng.next()) * half;
      const ph = rng.range(0, Math.PI * 2);
      const dir = d.clone().multiplyScalar(Math.cos(th)).addScaledVector(u, Math.sin(th) * Math.cos(ph)).addScaledVector(v, Math.sin(th) * Math.sin(ph)).normalize();
      let ei = e * rng.range(0.4, 1.6);
      const reach = Math.min(3.2, (wallDistance(tank, o, dir)?.dist ?? 3));
      let end = reach;
      let any = false;
      for (const { box, t } of alongRay(boxes, o, dir, reach)) {
        if (ei < 30) { end = t; break; }
        const absorbed = ei * box.comp.def.absorb;
        const label = tank.damageComp(box.comp, absorbed, w, 'spall', true);
        record(report, label, box.comp);
        ei -= absorbed;
        any = true;
      }
      report.lines.push({ a: o.clone(), b: o.clone().addScaledVector(dir, end), kind: 'spall', hit: any });
    }
  }

  // ---- explosive filler bursting inside (APHE / APCBC-HE / breaching HE)
  if (b.burstKg > 0) {
    const along = Math.min(b.burstAfterM, Math.max(0.1, pathLen - 0.15));
    const bp = o.clone().addScaledVector(d, along);
    report.lines.push({ a: o.clone(), b: bp.clone(), kind: 'burst', hit: true });
    const caseMass = a.cls === 'HE' ? a.massKg.value * 0.75 : Math.min(a.penetratorMassKg, s.mass) * 0.9;
    const cm = b.burstKg / Math.max(0.1, caseMass);
    const vg = (6900 / 2.97) * Math.sqrt(cm / (1 + cm / 2));
    const nFrag = 28;
    const ef = (0.5 * caseMass * vg * vg) / nFrag;
    for (let i = 0; i < nFrag; i++) {
      const dir = new THREE.Vector3(rng.normal(0, 1), rng.normal(0, 1), rng.normal(0, 1)).normalize();
      let ei = ef * rng.range(0.3, 1.7);
      const reach = Math.min(3, wallDistance(tank, bp, dir)?.dist ?? 2.5);
      let end = reach;
      let any = false;
      for (const { box, t } of alongRay(boxes, bp, dir, reach)) {
        if (ei < 30) { end = t; break; }
        const absorbed = ei * box.comp.def.absorb;
        const label = tank.damageComp(box.comp, absorbed, w, 'blast', true);
        record(report, label, box.comp);
        ei -= absorbed;
        any = true;
      }
      report.lines.push({ a: bp.clone(), b: bp.clone().addScaledVector(dir, end), kind: 'spall', hit: any });
    }
    // blast overpressure
    const rb = 0.9 * Math.cbrt(b.burstKg / 0.02);
    for (const box of boxes) {
      const dist = box.center.distanceTo(bp);
      if (dist < rb) {
        const label = tank.damageComp(box.comp, 9000 * (1 - dist / rb) * Math.cbrt(b.burstKg / 0.02), w, 'blast', true);
        record(report, label, box.comp);
      }
    }
    report.effects.push('Filler detonated inside');
    const wp = bp.clone().applyMatrix4(tank.root.matrixWorld);
    w.effects.particles.glow.spawn({ pos: wp, life: 0.12, size: 2.5, color: 0xffc080, shape: 1 });
    w.effects.light(wp, 0xffb070, 80, 8, 14);
  }

  // smoke escapes through the hole and hatches
  const wp = o.clone().applyMatrix4(tank.root.matrixWorld);
  for (let i = 0; i < 8; i++) {
    w.effects.particles.smoke.spawn({ pos: wp, vel: new THREE.Vector3(rng.normal(0, 0.6), rng.range(0.5, 2), rng.normal(0, 0.6)), life: rng.range(2, 4), size: 0.5, grow: 0.8, color: 0x3a3836, alpha: 0.6, drag: 1.5, rise: 0.4 });
  }
  return exit;
}

/** HE burst near (not on) a tank: tracks, optics and an unbuttoned commander are exposed */
export function nearMissOnTank(w: World, tank: Tank, p: THREE.Vector3, kg: number) {
  const inv = new THREE.Matrix4().copy(tank.root.matrixWorld).invert();
  const lp = p.clone().applyMatrix4(inv);
  const r = 1.2 * Math.cbrt(kg / 0.7);
  for (const part of tank.model.external) {
    if (part.kind !== 'track' || part.frame !== 'hull') continue;
    const dx = Math.max(0, Math.abs(lp.x - part.center.x) - part.half.x);
    const dy = Math.max(0, Math.abs(lp.y - part.center.y) - part.half.y);
    const dz = Math.max(0, Math.abs(lp.z - part.center.z) - part.half.z);
    const dist = Math.hypot(dx, dy, dz);
    if (dist < r && w.rng.chance(0.5 * (1 - dist / r))) tank.breakTrack(part.side ?? 1, w);
  }
  if (!tank.buttoned && tank.state === 'active') {
    const eye = tank.eyeWorld();
    const d = eye.distanceTo(p);
    const lethal = 6 * Math.cbrt(kg / 0.7);
    if (d < lethal && w.rng.chance(0.7 * (1 - d / lethal))) {
      const seat = tank.seat('commander');
      if (seat) tank.damageComp(seat, d < lethal * 0.4 ? 900 : 250, w, 'spall');
    }
  }
  const dist = tank.centerWorld().distanceTo(p);
  if (dist < 4) {
    const optics = tank.comps.find((c) => c.def.kind === 'optics');
    if (optics && w.rng.chance(0.15)) tank.damageComp(optics, 200, w, 'blast');
  }
}

export const EXTERNAL_KINDS: ExternalPart['kind'][] = ['track', 'barrel', 'wheels'];
