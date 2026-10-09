import * as THREE from 'three';
import { rayTriangle } from '../core/math';
import { ARMOR_MATERIALS, type ArmorMaterial } from './Materials';

/**
 * BALLISTIC armour representation (ported from Ballistic Armour Lab). Independent of the visual mesh.
 * Every region is a closed shell of triangular prisms: an OUTER surface triangle, an INNER
 * surface triangle and the steel between them. Ray queries return the true local surface normal.
 */

export type ArmorGroup = 'hull' | 'turret' | 'mantlet' | 'skirt' | 'running' | 'plate' | 'witness' | 'cupola';

export interface ArmorFacet {
  a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; // outer surface
  ia: THREE.Vector3; ib: THREE.Vector3; ic: THREE.Vector3; // inner surface
  n: THREE.Vector3; // flat outward normal of outer tri
  ni: THREE.Vector3; // flat normal of inner tri, pointing AWAY from the steel (into the vehicle)
  na: THREE.Vector3; nb: THREE.Vector3; nc: THREE.Vector3; // smooth outward normals (cast curves)
  region: ArmorRegion;
}

export interface ArmorRegionOptions {
  name: string;
  group: ArmorGroup;
  material: ArmorMaterial | string;
  nominalMm: number;
  /** spaced armour (skirts) — thin, disturbs HEAT jets, triggers HE */
  spaced?: boolean;
  /** not part of the protected volume (tracks, wheels) */
  auxiliary?: boolean;
  /** explosive reactive armour tile: steel / explosive / steel sandwich that a jet detonates */
  era?: boolean;
  /** human-readable nominal angle note e.g. "47°" */
  angleNote?: string;
}

export class ArmorRegion {
  static nextId = 1;
  id = ArmorRegion.nextId++;
  name: string;
  group: ArmorGroup;
  material: ArmorMaterial;
  nominalMm: number;
  spaced: boolean;
  auxiliary: boolean;
  era: boolean;
  angleNote?: string;
  facets: ArmorFacet[] = [];
  bounds = new THREE.Box3();
  /** render mesh (set by ArmorRenderer) */
  mesh?: THREE.Mesh;

  constructor(o: ArmorRegionOptions) {
    this.name = o.name;
    this.group = o.group;
    this.material = typeof o.material === 'string' ? ARMOR_MATERIALS[o.material] : o.material;
    this.nominalMm = o.nominalMm;
    this.spaced = !!o.spaced;
    this.auxiliary = !!o.auxiliary;
    this.era = !!o.era;
    this.angleNote = o.angleNote;
  }

  addFacet(
    a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3,
    ia: THREE.Vector3, ib: THREE.Vector3, ic: THREE.Vector3,
    na?: THREE.Vector3, nb?: THREE.Vector3, nc?: THREE.Vector3,
  ) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (n.lengthSq() < 1e-14) return;
    n.normalize();
    const ni = new THREE.Vector3().subVectors(ib, ia).cross(new THREE.Vector3().subVectors(ic, ia));
    if (ni.lengthSq() < 1e-14) ni.copy(n).negate();
    else ni.normalize().negate(); // same winding as outer → flip to face away from steel
    this.facets.push({
      a, b, c, ia, ib, ic, n, ni,
      na: na ? na.clone().normalize() : n.clone(),
      nb: nb ? nb.clone().normalize() : n.clone(),
      nc: nc ? nc.clone().normalize() : n.clone(),
      region: this,
    });
  }

  finalize() {
    this.bounds.makeEmpty();
    for (const f of this.facets) {
      this.bounds.expandByPoint(f.a).expandByPoint(f.b).expandByPoint(f.c);
      this.bounds.expandByPoint(f.ia).expandByPoint(f.ib).expandByPoint(f.ic);
    }
    this.bounds.expandByScalar(0.002);
  }

  /** Nominal (normal) thickness at a point near facet f, metres. */
  thicknessAt(f: ArmorFacet, p: THREE.Vector3) {
    // distance from p (on outer) along -n to inner plane of the facet
    const d = new THREE.Vector3().subVectors(f.ia, p).dot(f.n);
    return Math.abs(d);
  }
}

export type SurfaceSide = 'outer' | 'inner';

export interface ArmorHit {
  region: ArmorRegion;
  facet: ArmorFacet;
  side: SurfaceSide;
  point: THREE.Vector3;
  distance: number;
  /** flat face normal pointing away from the steel at the hit */
  faceNormal: THREE.Vector3;
  /** interpolated (smooth) surface normal pointing away from the steel */
  normal: THREE.Vector3;
}

const _bary = { u: 0, v: 0 };
const _ray = new THREE.Ray();
const _tmpV = new THREE.Vector3();

export class ArmorSet {
  regions: ArmorRegion[] = [];
  bounds = new THREE.Box3();

  add(r: ArmorRegion) {
    r.finalize();
    if (r.facets.length) this.regions.push(r);
    return r;
  }

  finalize() {
    this.bounds.makeEmpty();
    for (const r of this.regions) {
      r.finalize();
      this.bounds.union(r.bounds);
    }
  }

  /**
   * Find the first surface the ray ENTERS steel through (dir · faceNormal < 0).
   * side: which surfaces to consider (outer for shots from outside, inner for objects inside the vehicle).
   */
  raycast(
    origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number,
    sides: 'outer' | 'inner' | 'both' = 'both',
    filter?: (r: ArmorRegion) => boolean,
  ): ArmorHit | null {
    let best: ArmorHit | null = null;
    let bestT = maxDist;
    _ray.origin.copy(origin);
    _ray.direction.copy(dir);
    for (const r of this.regions) {
      if (filter && !filter(r)) continue;
      const bt = _ray.intersectBox(r.bounds, _tmpV);
      if (!bt && !r.bounds.containsPoint(origin)) continue;
      if (bt && _tmpV.distanceTo(origin) > bestT) continue;
      for (const f of r.facets) {
        if (sides !== 'inner' && dir.dot(f.n) < 0) {
          const t = rayTriangle(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
            f.a.x, f.a.y, f.a.z, f.b.x, f.b.y, f.b.z, f.c.x, f.c.y, f.c.z, _bary);
          if (t >= 0 && t < bestT) {
            bestT = t;
            best = makeHit(r, f, 'outer', origin, dir, t, _bary.u, _bary.v);
          }
        }
        if (sides !== 'outer' && dir.dot(f.ni) < 0) {
          const t = rayTriangle(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
            f.ia.x, f.ia.y, f.ia.z, f.ib.x, f.ib.y, f.ib.z, f.ic.x, f.ic.y, f.ic.z, _bary);
          if (t >= 0 && t < bestT) {
            bestT = t;
            best = makeHit(r, f, 'inner', origin, dir, t, _bary.u, _bary.v);
          }
        }
      }
    }
    return best;
  }

  /**
   * From a point inside the steel, find where the ray LEAVES steel (dir · faceNormal > 0).
   * Searches the given region first, then all regions (welded corners / overlapping slabs).
   */
  traceExit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, prefer?: ArmorRegion): ArmorHit | null {
    const search = (r: ArmorRegion, bestIn: ArmorHit | null, bestTIn: number) => {
      let best = bestIn;
      let bestT = bestTIn;
      for (const f of r.facets) {
        if (dir.dot(f.n) > 0) {
          const t = rayTriangle(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
            f.a.x, f.a.y, f.a.z, f.b.x, f.b.y, f.b.z, f.c.x, f.c.y, f.c.z, _bary);
          if (t > 1e-5 && t < bestT) { bestT = t; best = makeHit(r, f, 'outer', origin, dir, t, _bary.u, _bary.v); }
        }
        if (dir.dot(f.ni) > 0) {
          const t = rayTriangle(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
            f.ia.x, f.ia.y, f.ia.z, f.ib.x, f.ib.y, f.ib.z, f.ic.x, f.ic.y, f.ic.z, _bary);
          if (t > 1e-5 && t < bestT) { bestT = t; best = makeHit(r, f, 'inner', origin, dir, t, _bary.u, _bary.v); }
        }
      }
      return { best, bestT };
    };
    if (prefer) {
      const { best } = search(prefer, null, maxDist);
      if (best) return best;
    }
    let best: ArmorHit | null = null;
    let bestT = maxDist;
    for (const r of this.regions) {
      if (r === prefer) continue;
      if (!r.bounds.containsPoint(origin)) continue;
      const res = search(r, best, bestT);
      best = res.best; bestT = res.bestT;
    }
    return best;
  }

  /** Project along `dir` onto a specific surface of one region (used to conform damage patches). */
  projectOnto(region: ArmorRegion, side: SurfaceSide, origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) {
    let bestT = maxDist;
    let hit: { point: THREE.Vector3; facet: ArmorFacet } | null = null;
    for (const f of region.facets) {
      const A = side === 'outer' ? f.a : f.ia;
      const B = side === 'outer' ? f.b : f.ib;
      const C = side === 'outer' ? f.c : f.ic;
      const t = rayTriangle(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z);
      if (t >= 0 && t < bestT) {
        bestT = t;
        hit = { point: origin.clone().addScaledVector(dir, t), facet: f };
      }
    }
    return hit;
  }
}

function makeHit(r: ArmorRegion, f: ArmorFacet, side: SurfaceSide, o: THREE.Vector3, d: THREE.Vector3, t: number, u: number, v: number): ArmorHit {
  const point = o.clone().addScaledVector(d, t);
  const w = 1 - u - v;
  let normal: THREE.Vector3;
  let faceNormal: THREE.Vector3;
  if (side === 'outer') {
    faceNormal = f.n.clone();
    normal = new THREE.Vector3()
      .addScaledVector(f.na, w).addScaledVector(f.nb, u).addScaledVector(f.nc, v).normalize();
    if (normal.dot(faceNormal) < 0.3) normal.copy(faceNormal);
  } else {
    faceNormal = f.ni.clone();
    normal = f.ni.clone(); // inner surfaces are not smoothed
  }
  return { region: r, facet: f, side, point, distance: t, faceNormal, normal };
}

/* ------------------------------------------------------------------------------------------ */
/* Builders                                                                                    */
/* ------------------------------------------------------------------------------------------ */

export type V3 = [number, number, number];
const V = (p: V3) => new THREE.Vector3(p[0], p[1], p[2]);

/**
 * Flat welded plate. `outer` = convex planar polygon on the OUTER surface (any winding).
 * `interior` = a point inside the vehicle — used to orient the plate and extrude inward.
 */
export function flatPlate(
  set: ArmorSet, o: ArmorRegionOptions, outer: V3[], interior: V3, extrudeDir?: V3,
): ArmorRegion {
  const r = new ArmorRegion(o);
  const pts = outer.map(V);
  const c = pts.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
  // Newell normal
  const n = new THREE.Vector3();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  n.normalize();
  const toInterior = V(interior).sub(c);
  if (n.dot(toInterior) > 0) {
    pts.reverse();
    n.negate();
  }
  const t = o.nominalMm / 1000;
  const off = extrudeDir ? V(extrudeDir).normalize() : n.clone().negate();
  // offset distance so that NORMAL thickness equals t even for a non-normal extrusion
  const k = t / Math.max(0.2, -off.dot(n));
  const inner = pts.map((p) => p.clone().addScaledVector(off, k));
  for (let i = 1; i < pts.length - 1; i++) {
    r.addFacet(pts[0], pts[i], pts[i + 1], inner[0], inner[i], inner[i + 1]);
  }
  set.add(r);
  return r;
}

/**
 * Cast / curved shell from stacked rings (each ring = closed loop, same vertex count,
 * ordered so that ring[i] → ring[i+1] goes "up"). Facets are distributed to regions by
 * `classify(centroid, normal)`; thickness can vary continuously via `thicknessMm(p, n)`.
 */
export function loftShell(
  set: ArmorSet,
  rings: V3[][],
  interior: V3,
  regionDefs: Record<string, ArmorRegionOptions>,
  classify: (c: THREE.Vector3, n: THREE.Vector3) => string,
  thicknessMm: (p: THREE.Vector3, n: THREE.Vector3) => number,
  closed = true,
): Record<string, ArmorRegion> {
  const regions: Record<string, ArmorRegion> = {};
  for (const k of Object.keys(regionDefs)) regions[k] = new ArmorRegion(regionDefs[k]);
  const R = rings.map((ring) => ring.map(V));
  const nr = R.length;
  const nv = R[0].length;
  const segs = closed ? nv : nv - 1;
  const ctr = V(interior);
  // face normals → vertex normals
  const vn: THREE.Vector3[][] = R.map((ring) => ring.map(() => new THREE.Vector3()));
  const faceN = (i: number, j: number) => {
    const j1 = (j + 1) % nv;
    const a = R[i][j], b = R[i][j1], c = R[i + 1][j1], d = R[i + 1][j];
    const n = new THREE.Vector3().subVectors(c, a).cross(new THREE.Vector3().subVectors(d, b));
    if (n.lengthSq() < 1e-16) return n;
    n.normalize();
    const cen = new THREE.Vector3().add(a).add(b).add(c).add(d).multiplyScalar(0.25);
    if (n.dot(cen.clone().sub(ctr)) < 0) n.negate();
    return n;
  };
  for (let i = 0; i < nr - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const n = faceN(i, j);
      const j1 = (j + 1) % nv;
      vn[i][j].add(n); vn[i][j1].add(n); vn[i + 1][j].add(n); vn[i + 1][j1].add(n);
    }
  }
  vn.forEach((ring) => ring.forEach((n) => n.normalize()));
  const inner = R.map((ring, i) => ring.map((p, j) => p.clone().addScaledVector(vn[i][j], -thicknessMm(p, vn[i][j]) / 1000)));
  for (let i = 0; i < nr - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % nv;
      const n = faceN(i, j);
      if (n.lengthSq() < 0.5) continue;
      const cen = new THREE.Vector3().add(R[i][j]).add(R[i][j1]).add(R[i + 1][j1]).add(R[i + 1][j]).multiplyScalar(0.25);
      const reg = regions[classify(cen, n)];
      if (!reg) continue;
      // decide winding so that outer normal points away from interior
      const a = R[i][j], b = R[i][j1], c = R[i + 1][j1], d = R[i + 1][j];
      const ia = inner[i][j], ib = inner[i][j1], ic = inner[i + 1][j1], id = inner[i + 1][j];
      const na = vn[i][j], nb = vn[i][j1], nc = vn[i + 1][j1], nd = vn[i + 1][j];
      const test = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      if (test.dot(n) >= 0) {
        reg.addFacet(a, b, c, ia, ib, ic, na, nb, nc);
        reg.addFacet(a, c, d, ia, ic, id, na, nc, nd);
      } else {
        reg.addFacet(a, c, b, ia, ic, ib, na, nc, nb);
        reg.addFacet(a, d, c, ia, id, ic, na, nd, nc);
      }
    }
  }
  for (const k of Object.keys(regions)) set.add(regions[k]);
  return regions;
}

/** Flat cap (roof) over a ring polygon, offset inward along -up. */
export function capPolygon(set: ArmorSet, o: ArmorRegionOptions, ring: V3[], interior: V3): ArmorRegion {
  return flatPlate(set, o, ring, interior);
}

/** Box-like slab (e.g. test plate) centred at `center`, rotated by `rot`. */
export function slabPlate(
  set: ArmorSet, o: ArmorRegionOptions, width: number, height: number,
  center: THREE.Vector3, rot: THREE.Quaternion,
): ArmorRegion {
  const r = new ArmorRegion(o);
  const t = o.nominalMm / 1000;
  const hw = width / 2, hh = height / 2;
  // outer face at local z = +t/2... we use: outer face at z=0 facing -z (towards shooter at -z)
  const lp = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(rot).add(center);
  const a = lp(-hw, -hh, 0), b = lp(hw, -hh, 0), c = lp(hw, hh, 0), d = lp(-hw, hh, 0);
  const ia = lp(-hw, -hh, t), ib = lp(hw, -hh, t), ic = lp(hw, hh, t), id = lp(-hw, hh, t);
  // outer normal must face -z(local): winding a,c,b
  r.addFacet(a, c, b, ia, ic, ib);
  r.addFacet(a, d, c, ia, id, ic);
  set.add(r);
  return r;
}
