import * as THREE from 'three';
import type { World } from '../world/World';
import type { Tank } from '../vehicles/Tank';
import type { Soldier } from '../infantry/Soldier';

export interface PickResult {
  point: THREE.Vector3;
  unit: Tank | Soldier | null;
  dist: number;
}

const _box = new THREE.Box3();
const _inv = new THREE.Matrix4();
const _r = new THREE.Ray();

/** what the mouse cursor points at: tank hull boxes, soldiers, obstacles, then the ground */
export function pick(w: World, ray: THREE.Ray, ignore: (Tank | Soldier)[] = [], maxDist = 2600, onlyVisible?: (u: Tank | Soldier) => boolean): PickResult {
  // ground: march with a growing step, then refine
  let tGround = maxDist;
  let prev = 0;
  for (let t = 1; t < maxDist; t += Math.max(0.4, t * 0.012)) {
    const p = ray.at(t, new THREE.Vector3());
    if (p.y < w.terrain.height(p.x, p.z)) {
      let lo = prev, hi = t;
      for (let i = 0; i < 12; i++) {
        const m = (lo + hi) / 2;
        const q = ray.at(m, new THREE.Vector3());
        if (q.y < w.terrain.height(q.x, q.z)) hi = m;
        else lo = m;
      }
      tGround = hi;
      break;
    }
    prev = t;
  }
  let best: PickResult = { point: ray.at(tGround, new THREE.Vector3()), unit: null, dist: tGround };
  if (tGround >= maxDist - 1) {
    // cursor over the sky: aim along the battlefield instead of at a point kilometres up
    const t = (-4 - ray.origin.z) / (ray.direction.z || -1e-6);
    if (t > 0 && t < maxDist) {
      const p = ray.at(t, new THREE.Vector3());
      best = { point: p, unit: null, dist: t };
    }
  }
  for (const t of w.tanks) {
    if (ignore.includes(t)) continue;
    if (onlyVisible && !onlyVisible(t)) continue;
    _inv.copy(t.root.matrixWorld).invert();
    _r.copy(ray).applyMatrix4(_inv);
    _box.set(new THREE.Vector3(-t.model.halfLength, 0.3, -t.model.halfWidth), new THREE.Vector3(t.model.halfLength, t.model.height, t.model.halfWidth));
    const hit = _r.intersectBox(_box, new THREE.Vector3());
    if (hit) {
      const wp = hit.applyMatrix4(t.root.matrixWorld);
      const d = wp.distanceTo(ray.origin);
      // aim at the centre of mass of the presented silhouette, not the box face
      if (d < best.dist) best = { point: t.centerWorld().add(new THREE.Vector3(0, 0.25, 0)), unit: t, dist: d };
    }
  }
  const end = ray.at(best.dist, new THREE.Vector3());
  for (const s of w.soldiersNearSegment(ray.origin, end)) {
    if (ignore.includes(s) || !s.alive) continue;
    if (onlyVisible && !onlyVisible(s)) continue;
    const t = s.hitSegment(ray.origin, end);
    if (t >= 0) {
      const d = t * best.dist;
      if (d < best.dist) best = { point: s.center, unit: s, dist: d };
    }
  }
  for (const o of w.obstaclesOnSegment(ray.origin, end)) {
    if (o.destroyed && o.kind !== 'rubble') continue;
    if (o.kind === 'hedge' || o.kind === 'fence' || o.kind === 'wire') continue;
    const r = o.segment(ray.origin, end);
    if (r && r[0] * best.dist < best.dist - 0.5 && best.unit === null) {
      best = { point: ray.at(r[0] * best.dist, new THREE.Vector3()), unit: null, dist: r[0] * best.dist };
    }
  }
  return best;
}
