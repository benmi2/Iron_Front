import * as THREE from 'three';
import { ammo as getAmmo, isKinetic, type AmmoDef } from '../data/ammo';
import { rangeTable } from '../ballistics/Flight';
import { estimatePenAt } from '../ballistics/Penetration';
import type { Tank } from '../vehicles/Tank';

/**
 * Crew-level tactical judgement used by the AI: which side of the target is presented, how much
 * armour that is, and whether a round can defeat it at this range. These are ESTIMATES the crew
 * makes — the actual outcome is always decided by the full plate-by-plate ballistic model.
 */

/** representative line-of-sight armour (mm) of the main areas, derived from the armour schedule */
const AREA_MM: Record<string, { front: number; side: number; rear: number }> = {
  // Sherman: glacis 63.5 @ 47° ≈ 93 LoS; cast turret front 76 @ ≈30° ≈ 88 → ≈80 after the cast factor
  m4a3_75w: { front: 80, side: 38, rear: 38 },
  // Pz IV H: driver's plate 80 @ 10°, but the 50 mm turret front is the weak frontal area
  pz4h: { front: 52, side: 30, rear: 20 },
};

export function aspectOf(target: Tank, from: THREE.Vector3): { aspect: 'front' | 'side' | 'rear'; angleDeg: number } {
  const f = target.forward;
  const to = from.clone().sub(target.pos).setY(0).normalize();
  const c = f.dot(to);
  const ang = (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
  if (ang < 45) return { aspect: 'front', angleDeg: ang };
  if (ang > 135) return { aspect: 'rear', angleDeg: 180 - ang };
  return { aspect: 'side', angleDeg: Math.abs(90 - ang) };
}

export function presentedArmour(target: Tank, from: THREE.Vector3) {
  const a = aspectOf(target, from);
  const area = AREA_MM[target.spec.id] ?? { front: 80, side: 40, rear: 30 };
  return { ...a, mm: area[a.aspect] };
}

/** best round (of those carried) to defeat `target` from `from`; null if nothing can */
export function bestAmmoVs(shooter: Tank, target: Tank, from: THREE.Vector3): { ammo: AmmoDef; margin: number } | null {
  const range = from.distanceTo(target.centerWorld());
  const pa = presentedArmour(target, from);
  let best: { ammo: AmmoDef; margin: number } | null = null;
  for (const [id, n] of Object.entries(shooter.ammoCount)) {
    if (n <= 0 && shooter.loaded?.id !== id) continue;
    const a = getAmmo(id);
    if (!(isKinetic(a) || a.cls === 'HEAT')) continue;
    const v = rangeTable(a).velocity(range);
    const pen = estimatePenAt(a, v, pa.angleDeg * 0.6);
    const margin = pen / pa.mm;
    // conserve scarce tungsten: only when standard AP will not do
    const scarce = a.cls === 'APCR' ? 0.92 : 1;
    if (!best || margin * scarce > best.margin) best = { ammo: a, margin: margin * scarce };
  }
  return best;
}

export function heRound(t: Tank) {
  const id = Object.keys(t.ammoCount).find((k) => getAmmo(k).cls === 'HE' && t.ammoCount[k] > 0);
  return id ? getAmmo(id) : null;
}

export function apRound(t: Tank) {
  const id = Object.keys(t.ammoCount).find((k) => (getAmmo(k).cls === 'APC' || getAmmo(k).cls === 'APCBC' || getAmmo(k).cls === 'APHE') && t.ammoCount[k] > 0);
  return id ? getAmmo(id) : null;
}
