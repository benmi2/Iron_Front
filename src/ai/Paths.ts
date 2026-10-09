import * as THREE from 'three';
import type { World } from '../world/World';
import type { Tank } from '../vehicles/Tank';
import type { Team } from '../world/Team';

/**
 * Simple battlefield path checks for the side-view band: is a lane clear for a vehicle of a
 * given half-width between two x positions, and is a line of fire free of friendly troops.
 */

/** true when no tank-blocking obstacle (or wreck) intersects the corridor [x0,x1] × [z−hw, z+hw] */
export function laneClear(w: World, self: Tank, x0: number, x1: number, z: number, hw: number) {
  const a = Math.min(x0, x1), b = Math.max(x0, x1);
  for (const o of w.obstaclesNear((a + b) / 2, (b - a) / 2 + 15)) {
    if (o.destroyed || !o.blocksTanks || o.crushable) continue;
    if (o.kind === 'hedge' && self.upgrades.has('culin_cutter')) continue;
    // AABB of the (possibly rotated) box
    const ex = Math.abs(o.cos) * o.hx + Math.abs(o.sin) * o.hz;
    const ez = Math.abs(o.sin) * o.hx + Math.abs(o.cos) * o.hz;
    if (o.cx + ex < a || o.cx - ex > b) continue;
    if (o.cz + ez < z - hw || o.cz - ez > z + hw) continue;
    return false;
  }
  for (const t of w.tanks) {
    if (t === self || (t.state === 'active' && t.team === self.team)) continue;
    if (t.state === 'active') continue;
    if (t.pos.x + t.model.halfLength < a || t.pos.x - t.model.halfLength > b) continue;
    if (Math.abs(t.pos.z - z) > hw + t.model.halfWidth) continue;
    return false;
  }
  return true;
}

const _inv = new THREE.Matrix4();
const _box = new THREE.Box3();
const _ray = new THREE.Ray();

/** a friendly unit stands in (or close to) the line of fire */
export function friendlyInLine(w: World, team: Team, from: THREE.Vector3, to: THREE.Vector3, ignore: unknown, soldierMargin = 1.4) {
  const d = to.clone().sub(from);
  const len = d.length();
  d.multiplyScalar(1 / len);
  for (const t of w.tanks) {
    if (t === ignore || t.team !== team || t.state === 'destroyed') continue;
    if (t.centerWorld().distanceTo(from) > len + 8) continue;
    _inv.copy(t.root.matrixWorld).invert();
    _ray.set(from, d).applyMatrix4(_inv);
    _box.set(new THREE.Vector3(-t.model.halfLength - 0.3, 0, -t.model.halfWidth - 0.3), new THREE.Vector3(t.model.halfLength + 0.3, t.model.height + 0.3, t.model.halfWidth + 0.3));
    const hit = _ray.intersectBox(_box, new THREE.Vector3());
    if (hit && hit.length() < len) return true;
  }
  const seg = new THREE.Line3(from, to);
  const q = new THREE.Vector3();
  for (const s of w.soldiers) {
    if (s === ignore || s.team !== team || !s.alive || s.inTank) continue;
    const c = s.center;
    if (c.distanceTo(from) < 1.2) continue;
    seg.closestPointToPoint(c, true, q);
    if (q.distanceTo(c) < soldierMargin && q.distanceTo(to) > 0.5) return true;
  }
  return false;
}
