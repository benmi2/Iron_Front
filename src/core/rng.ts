/** Deterministic seeded RNG (mulberry32). Ported from Ballistic Armour Lab. */
export class RNG {
  private s: number;
  constructor(seed = 1) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number) {
    return Math.floor(this.range(a, b + 1));
  }
  /** Standard normal via Box–Muller. */
  normal(mean = 0, sd = 1) {
    let u = this.next();
    if (u < 1e-12) u = 1e-12;
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  lognormal(median: number, sigma: number) {
    return median * Math.exp(this.normal(0, sigma));
  }
  /** Mott fragment mass distribution: N(>m) ∝ exp(-sqrt(m/mu)). Mean mass = 2·mu. */
  mott(mu: number) {
    let u = this.next();
    if (u < 1e-9) u = 1e-9;
    const l = -Math.log(u);
    return mu * l * l;
  }
  chance(p: number) {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  }
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
  fork(salt: number) {
    return new RNG((this.s ^ Math.imul(salt + 0x9e3779b9, 0x85ebca6b)) >>> 0);
  }
}

/** Cheap smooth 1D value noise over an angle (periodic), used for irregular fracture boundaries. */
export class AngularNoise {
  private vals: number[];
  constructor(rng: RNG, private n = 16, amp = 1) {
    this.vals = [];
    for (let i = 0; i < n; i++) this.vals.push(rng.range(-1, 1) * amp);
  }
  sample(theta: number) {
    const t = (((theta / (Math.PI * 2)) % 1) + 1) % 1 * this.n;
    const i0 = Math.floor(t) % this.n;
    const i1 = (i0 + 1) % this.n;
    const f = t - Math.floor(t);
    const s = f * f * (3 - 2 * f);
    return this.vals[i0] * (1 - s) + this.vals[i1] * s;
  }
}
