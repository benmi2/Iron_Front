import * as THREE from 'three';
import { RNG } from '../core/rng';

/**
 * Procedural Canvas-2D painting helpers (technique adapted from Dead Meridian's TextureFactory /
 * paint.ts: every texture is painted at runtime, nothing is loaded from disk).
 */

export type Ctx = CanvasRenderingContext2D;

export function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: false })!;
  return [c, ctx];
}

const texCache = new Map<string, THREE.Texture>();

/** Paint once, cache by key, return a sRGB CanvasTexture. */
export function paintTexture(key: string, w: number, h: number, painter: (ctx: Ctx, w: number, h: number) => void, opts: { repeat?: boolean; srgb?: boolean; aniso?: number; mip?: boolean } = {}) {
  const cached = texCache.get(key);
  if (cached) return cached;
  const [c, ctx] = canvas(w, h);
  painter(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = opts.aniso ?? 8;
  if (opts.mip === false) {
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
  }
  t.needsUpdate = true;
  texCache.set(key, t);
  return t;
}

/* ------------------------------------------------------------------ value noise (tileable) */

export class Noise2 {
  private p: Float32Array;
  constructor(seed: number, private period = 256) {
    const r = new RNG(seed);
    this.p = new Float32Array(period * period);
    for (let i = 0; i < this.p.length; i++) this.p[i] = r.next();
  }
  private v(x: number, y: number) {
    const P = this.period;
    return this.p[(((y % P) + P) % P) * P + (((x % P) + P) % P)];
  }
  /** smooth value noise, tileable with the given period (in lattice units) */
  sample(x: number, y: number, period = this.period) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const w = (a: number) => ((a % period) + period) % period;
    const a = this.v(w(xi), w(yi)), b = this.v(w(xi + 1), w(yi));
    const c = this.v(w(xi), w(yi + 1)), d = this.v(w(xi + 1), w(yi + 1));
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  /** fBm, tileable when (x,y) span exactly `period` lattice units at octave 0 */
  fbm(x: number, y: number, oct = 4, period = this.period, gain = 0.5) {
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      s += amp * this.sample(x * f, y * f, period * f);
      norm += amp;
      amp *= gain;
      f *= 2;
    }
    return s / norm;
  }
}

/** Fill a canvas pixel-wise from a function returning [r,g,b,a] in 0..255. */
export function pixels(ctx: Ctx, w: number, h: number, fn: (x: number, y: number) => [number, number, number, number?]) {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fn(x, y);
      const i = (y * w + x) * 4;
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = a ?? 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const mixRgb = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function rgba(c: [number, number, number], a = 1) {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

export function shade(hex: string, f: number) {
  const c = hexRgb(hex);
  const t = f < 0 ? [0, 0, 0] : [255, 255, 255];
  const k = Math.abs(f);
  return rgba([c[0] + (t[0] - c[0]) * k, c[1] + (t[1] - c[1]) * k, c[2] + (t[2] - c[2]) * k]);
}

/** Soft radial blob. */
export function blob(ctx: Ctx, x: number, y: number, r: number, color: string, alpha = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}
