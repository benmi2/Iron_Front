import * as THREE from 'three';

export type ObstacleKind = 'house' | 'wall' | 'hedge' | 'sandbags' | 'hedgehog' | 'fence' | 'wreck' | 'tree' | 'crate' | 'wire' | 'rubble' | 'bridge-rail';

/**
 * Anything on the battlefield that matters physically: an oriented box (yaw only) with the
 * properties that decide movement, cover, observation and what a projectile crossing it does.
 *
 * `shellMm` is the RHA-equivalent resistance a kinetic shell meets crossing the whole obstacle.
 * These are SIMULATION APPROXIMATIONS (masonry ≈ 1/12 of its thickness in RHA, packed earth
 * ≈ 1/25, sand ≈ 1/20), not historical data, and are labelled so in the firing range.
 */
export interface ObstacleDef {
  kind: ObstacleKind;
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  yaw?: number;
  /** absolute bottom / top heights (m) */
  y0: number;
  y1: number;
  blocksTanks: boolean;
  blocksFoot: boolean;
  blocksLOS: boolean;
  /** rifle bullets stop in it */
  stopsBullets: boolean;
  shellMm: number;
  hp: number;
  /** tanks drive over it and flatten it */
  crushable?: boolean;
  /** fraction of the box that is actually solid (hedgehogs, trees, wire) — projectiles may pass through gaps */
  solidity?: number;
  label?: string;
}

export class Obstacle {
  static nextId = 1;
  readonly id = Obstacle.nextId++;
  kind: ObstacleKind;
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  yaw: number;
  cos: number;
  sin: number;
  y0: number;
  y1: number;
  blocksTanks: boolean;
  blocksFoot: boolean;
  blocksLOS: boolean;
  stopsBullets: boolean;
  shellMm: number;
  hp: number;
  maxHp: number;
  crushable: boolean;
  solidity: number;
  destroyed = false;
  label: string;
  /** visual root; swapped for rubble when destroyed */
  object: THREE.Object3D | null = null;
  /** garrison firing positions (houses) */
  slots: THREE.Vector3[] = [];
  /** called when hp crosses thresholds */
  onDamage: ((o: Obstacle, frac: number, point: THREE.Vector3) => void) | null = null;
  onDestroyed: ((o: Obstacle) => void) | null = null;

  constructor(d: ObstacleDef) {
    this.kind = d.kind;
    this.cx = d.cx; this.cz = d.cz; this.hx = d.hx; this.hz = d.hz;
    this.yaw = d.yaw ?? 0;
    this.cos = Math.cos(this.yaw);
    this.sin = Math.sin(this.yaw);
    this.y0 = d.y0; this.y1 = d.y1;
    this.blocksTanks = d.blocksTanks;
    this.blocksFoot = d.blocksFoot;
    this.blocksLOS = d.blocksLOS;
    this.stopsBullets = d.stopsBullets;
    this.shellMm = d.shellMm;
    this.hp = this.maxHp = d.hp;
    this.crushable = !!d.crushable;
    this.solidity = d.solidity ?? 1;
    this.label = d.label ?? d.kind;
  }

  /** world → local (x along the box's own x axis) */
  toLocal(x: number, z: number): [number, number] {
    const dx = x - this.cx, dz = z - this.cz;
    return [dx * this.cos - dz * this.sin, dx * this.sin + dz * this.cos];
  }

  contains2(x: number, z: number, pad = 0) {
    const [lx, lz] = this.toLocal(x, z);
    return Math.abs(lx) <= this.hx + pad && Math.abs(lz) <= this.hz + pad;
  }

  /** bounding radius in xz */
  get radius() {
    return Math.hypot(this.hx, this.hz);
  }

  /**
   * Segment vs this box (3-D, yaw-only rotation). Returns entry/exit parameters in [0,1]
   * or null. Uses the slab method in the box's local frame.
   */
  segment(p0: THREE.Vector3, p1: THREE.Vector3): [number, number] | null {
    const [ax, az] = this.toLocal(p0.x, p0.z);
    const [bx, bz] = this.toLocal(p1.x, p1.z);
    let t0 = 0, t1 = 1;
    const slab = (a: number, b: number, lo: number, hi: number) => {
      const d = b - a;
      if (Math.abs(d) < 1e-9) return a >= lo && a <= hi;
      let u0 = (lo - a) / d, u1 = (hi - a) / d;
      if (u0 > u1) { const t = u0; u0 = u1; u1 = t; }
      if (u0 > t0) t0 = u0;
      if (u1 < t1) t1 = u1;
      return t0 <= t1;
    };
    if (!slab(ax, bx, -this.hx, this.hx)) return null;
    if (!slab(az, bz, -this.hz, this.hz)) return null;
    if (!slab(p0.y, p1.y, this.y0, this.y1)) return null;
    return [t0, t1];
  }

  /** push a circle (x,z,r) out of the box; returns the correction or null */
  pushOut(x: number, z: number, r: number): [number, number] | null {
    const [lx, lz] = this.toLocal(x, z);
    const ox = this.hx + r - Math.abs(lx), oz = this.hz + r - Math.abs(lz);
    if (ox <= 0 || oz <= 0) return null;
    let dlx = 0, dlz = 0;
    if (ox < oz) dlx = Math.sign(lx || 1) * ox;
    else dlz = Math.sign(lz || 1) * oz;
    // local → world (inverse rotation)
    return [dlx * this.cos + dlz * this.sin, -dlx * this.sin + dlz * this.cos];
  }

  damage(amount: number, point: THREE.Vector3) {
    if (this.destroyed || this.maxHp <= 0) return;
    this.hp -= amount;
    this.onDamage?.(this, Math.max(0, this.hp / this.maxHp), point);
    if (this.hp <= 0) {
      this.destroyed = true;
      this.onDestroyed?.(this);
    }
  }
}
