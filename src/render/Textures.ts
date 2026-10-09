import * as THREE from 'three';
import { RNG } from '../core/rng';
import { Noise2, blob, hexRgb, mixRgb, paintTexture, pixels, rgba, type Ctx } from './Paint';

/**
 * The game's painted texture library. Everything is generated procedurally at startup.
 */

const N1 = new Noise2(11, 64);
const N2 = new Noise2(23, 64);
const N3 = new Noise2(37, 64);

/* ======================================================================== ground */

export function grassTexture() {
  return paintTexture('grass', 512, 512, (ctx, w, h) => {
    const dark = hexRgb('#4a5a2c'), mid = hexRgb('#6f7a3a'), dry = hexRgb('#9a9256');
    pixels(ctx, w, h, (x, y) => {
      const u = (x / w) * 8, v = (y / h) * 8;
      const n = N1.fbm(u, v, 5, 8);
      const m = N2.fbm(u * 0.5, v * 0.5, 3, 4);
      let c = mixRgb(dark, mid, n);
      c = mixRgb(c, dry, Math.max(0, m - 0.45) * 1.6);
      const g = 0.85 + 0.3 * N3.sample(u * 8, v * 8, 64);
      return [c[0] * g, c[1] * g, c[2] * g];
    });
    // blades
    const r = new RNG(5);
    for (let i = 0; i < 5000; i++) {
      const x = r.range(0, w), y = r.range(0, h);
      const l = r.range(3, 9);
      ctx.strokeStyle = r.chance(0.5) ? 'rgba(130,140,70,0.35)' : 'rgba(40,50,20,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + r.range(-2, 2), y - l);
      ctx.stroke();
    }
  }, { repeat: true });
}

export function dirtTexture() {
  return paintTexture('dirt', 512, 512, (ctx, w, h) => {
    const a = hexRgb('#5a4630'), b = hexRgb('#7d6446'), c2 = hexRgb('#3e3022');
    pixels(ctx, w, h, (x, y) => {
      const u = (x / w) * 8, v = (y / h) * 8;
      const n = N2.fbm(u, v, 5, 8);
      const m = N3.fbm(u * 2, v * 2, 3, 16);
      let c = mixRgb(a, b, n);
      c = mixRgb(c, c2, Math.max(0, m - 0.55) * 2);
      const g = 0.85 + 0.3 * N1.sample(u * 8, v * 8, 64);
      return [c[0] * g, c[1] * g, c[2] * g];
    });
    const r = new RNG(9);
    for (let i = 0; i < 900; i++) {
      const x = r.range(0, w), y = r.range(0, h), s = r.range(1, 3.5);
      ctx.fillStyle = r.chance(0.5) ? 'rgba(150,130,100,0.5)' : 'rgba(40,30,20,0.5)';
      ctx.beginPath();
      ctx.ellipse(x, y, s, s * 0.7, r.range(0, 3), 0, Math.PI * 2);
      ctx.fill();
    }
  }, { repeat: true });
}

export function mudTexture() {
  return paintTexture('mud', 512, 512, (ctx, w, h) => {
    const a = hexRgb('#3b3024'), b = hexRgb('#55473a'), wet = hexRgb('#2a241e');
    pixels(ctx, w, h, (x, y) => {
      const u = (x / w) * 8, v = (y / h) * 8;
      const n = N3.fbm(u, v, 5, 8);
      const m = N1.fbm(u * 0.7, v * 0.7, 3, 8);
      let c = mixRgb(a, b, n);
      c = mixRgb(c, wet, Math.max(0, m - 0.5) * 2);
      return c;
    });
    // track ruts and puddle glints
    const r = new RNG(3);
    for (let i = 0; i < 60; i++) {
      ctx.strokeStyle = 'rgba(25,20,15,0.35)';
      ctx.lineWidth = r.range(2, 6);
      ctx.beginPath();
      const y = r.range(0, h);
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(w * 0.3, y + r.range(-20, 20), w * 0.6, y + r.range(-20, 20), w, y);
      ctx.stroke();
    }
  }, { repeat: true });
}

/** Weathered 1940s tarmac with patched edges. u along the road, v across (0..1). */
export function roadTexture() {
  return paintTexture('road', 1024, 256, (ctx, w, h) => {
    const a = hexRgb('#4b4842'), b = hexRgb('#5d5952'), c2 = hexRgb('#38352f');
    pixels(ctx, w, h, (x, y) => {
      const u = (x / w) * 32, v = (y / h) * 8;
      const n = N1.fbm(u, v, 5, 32);
      const m = N2.fbm(u * 0.25, v * 0.25, 3, 8);
      let c = mixRgb(a, b, n);
      c = mixRgb(c, c2, Math.max(0, m - 0.5) * 1.5);
      // dusty, broken edges
      const e = Math.min(y, h - y) / h;
      const edge = Math.max(0, 0.12 - e) / 0.12;
      const dust = hexRgb('#7a6a50');
      c = mixRgb(c, dust, edge * (0.5 + 0.5 * N3.sample(u * 2, v * 4, 64)));
      const g = 0.9 + 0.2 * N3.sample(u * 4, v * 4, 128);
      return [c[0] * g, c[1] * g, c[2] * g];
    });
    const r = new RNG(77);
    // cracks
    for (let i = 0; i < 70; i++) {
      ctx.strokeStyle = 'rgba(20,18,15,0.55)';
      ctx.lineWidth = r.range(0.6, 1.6);
      ctx.beginPath();
      let x = r.range(0, w), y = r.range(h * 0.1, h * 0.9);
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += r.range(-14, 14);
        y += r.range(-10, 10);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // patched repairs
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = r.chance(0.5) ? 'rgba(40,38,34,0.55)' : 'rgba(90,85,75,0.35)';
      ctx.fillRect(r.range(0, w), r.range(h * 0.15, h * 0.8), r.range(20, 80), r.range(10, 40));
    }
    // tyre / track wear bands
    for (const band of [0.3, 0.7]) {
      const gr = ctx.createLinearGradient(0, h * (band - 0.08), 0, h * (band + 0.08));
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(0.5, 'rgba(25,22,18,0.25)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(0, h * (band - 0.08), w, h * 0.16);
    }
  }, { repeat: true });
}

/* ======================================================================== masonry */

/** Normandy rubble-stone masonry (irregular stones, lime mortar). */
export function stoneTexture(seed = 1, tint = '#a59a86') {
  return paintTexture(`stone${seed}${tint}`, 512, 512, (ctx, w, h) => {
    const base = hexRgb(tint);
    ctx.fillStyle = rgba(mixRgb(base, [200, 190, 170], 0.25));
    ctx.fillRect(0, 0, w, h);
    const r = new RNG(seed * 31 + 7);
    let y = 0;
    while (y < h) {
      const rowH = r.range(26, 52);
      let x = -r.range(0, 40);
      while (x < w) {
        const sw = r.range(34, 90);
        const c = mixRgb(base, r.chance(0.3) ? [120, 110, 95] : [190, 180, 160], r.range(0, 0.45));
        const k = r.range(0.75, 1.15);
        const drawStone = (ox: number) => {
          ctx.fillStyle = rgba([c[0] * k, c[1] * k, c[2] * k]);
          ctx.beginPath();
          const cx = x + ox + sw / 2, cy = y + rowH / 2;
          const n = 9;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            const rx = (sw / 2 - 3) * r.range(0.85, 1.05), ry = (rowH / 2 - 3) * r.range(0.8, 1.05);
            const px = cx + Math.cos(a) * rx, py = cy + Math.sin(a) * ry;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          // top light / bottom shade
          const g = ctx.createLinearGradient(0, cy - rowH / 2, 0, cy + rowH / 2);
          g.addColorStop(0, 'rgba(255,250,235,0.18)');
          g.addColorStop(1, 'rgba(0,0,0,0.25)');
          ctx.fillStyle = g;
          ctx.fill();
        };
        drawStone(0);
        if (x + sw > w) drawStone(-w);
        x += sw + r.range(2, 5);
      }
      y += rowH + r.range(2, 5);
    }
    // grime & lichen
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const i = (py * w + px) * 4;
        const n = N2.fbm((px / w) * 6, (py / h) * 6, 4, 6);
        const g = 0.82 + 0.3 * n;
        d[i] *= g; d[i + 1] *= g; d[i + 2] *= g * 0.97;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, { repeat: true });
}

/** Lime plaster with patches fallen off showing stone; streaks of weathering. */
export function plasterTexture(seed = 1, tint = '#cbbd9e') {
  const stone = stoneTexture(seed + 50).image as HTMLCanvasElement;
  return paintTexture(`plaster${seed}${tint}`, 512, 512, (ctx, w, h) => {
    ctx.drawImage(stone, 0, 0, w, h);
    const base = hexRgb(tint);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const ns = new Noise2(seed * 13 + 1, 64);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const patch = ns.fbm((x / w) * 4, (y / h) * 4, 4, 4);
        const streak = N3.fbm((x / w) * 16, (y / h) * 2, 3, 16);
        if (patch > 0.38) {
          const g = 0.88 + 0.18 * N1.fbm((x / w) * 10, (y / h) * 10, 3, 10) - 0.18 * Math.max(0, streak - 0.55);
          const edge = Math.min(1, (patch - 0.38) * 14);
          d[i] = d[i] * (1 - edge) + base[0] * g * edge;
          d[i + 1] = d[i + 1] * (1 - edge) + base[1] * g * edge;
          d[i + 2] = d[i + 2] * (1 - edge) + base[2] * g * edge;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }, { repeat: true });
}

export function roofTileTexture(seed = 1, tint = '#8a4a32') {
  return paintTexture(`roof${seed}${tint}`, 512, 512, (ctx, w, h) => {
    const base = hexRgb(tint);
    ctx.fillStyle = rgba(mixRgb(base, [30, 20, 15], 0.5));
    ctx.fillRect(0, 0, w, h);
    const r = new RNG(seed + 100);
    const rowH = 24;
    for (let row = 0; row * rowH < h + rowH; row++) {
      const off = (row % 2) * 16;
      for (let x = -32 + off; x < w + 32; x += 32) {
        const c = mixRgb(base, r.chance(0.3) ? [70, 50, 40] : [170, 110, 80], r.range(0, 0.45));
        const y = row * rowH;
        const g = ctx.createLinearGradient(0, y, 0, y + rowH + 6);
        g.addColorStop(0, rgba(mixRgb(c, [255, 230, 200], 0.15)));
        g.addColorStop(0.75, rgba(c));
        g.addColorStop(1, rgba(mixRgb(c, [0, 0, 0], 0.5)));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x + 1, y);
        ctx.lineTo(x + 31, y);
        ctx.lineTo(x + 30, y + rowH + 4);
        ctx.quadraticCurveTo(x + 16, y + rowH + 8, x + 2, y + rowH + 4);
        ctx.closePath();
        ctx.fill();
      }
    }
    // moss & soot
    pixelsOver(ctx, w, h, (x, y, c) => {
      const n = N2.fbm((x / w) * 5, (y / h) * 5, 4, 5);
      const m = Math.max(0, n - 0.55) * 1.8;
      return [c[0] * (1 - m * 0.5), c[1] * (1 - m * 0.3), c[2] * (1 - m * 0.6)];
    });
  }, { repeat: true });
}

export function woodTexture(seed = 1, tint = '#6b5236') {
  return paintTexture(`wood${seed}${tint}`, 256, 256, (ctx, w, h) => {
    const base = hexRgb(tint);
    const r = new RNG(seed + 5);
    const plank = 32;
    for (let x = 0; x < w; x += plank) {
      const c = mixRgb(base, [0, 0, 0], r.range(0, 0.3));
      ctx.fillStyle = rgba(c);
      ctx.fillRect(x, 0, plank, h);
      for (let i = 0; i < 14; i++) {
        ctx.strokeStyle = `rgba(30,20,10,${r.range(0.1, 0.3)})`;
        ctx.lineWidth = r.range(0.5, 1.5);
        ctx.beginPath();
        const gx = x + r.range(2, plank - 2);
        ctx.moveTo(gx, 0);
        ctx.bezierCurveTo(gx + r.range(-3, 3), h * 0.3, gx + r.range(-3, 3), h * 0.7, gx, h);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(15,10,5,0.6)';
      ctx.fillRect(x, 0, 2, h);
    }
  }, { repeat: true });
}

function pixelsOver(ctx: Ctx, w: number, h: number, fn: (x: number, y: number, c: [number, number, number]) => [number, number, number]) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const o = fn(x, y, [d[i], d[i + 1], d[i + 2]]);
      d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2];
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function sandbagTexture() {
  return paintTexture('sandbag', 256, 128, (ctx, w, h) => {
    const base = hexRgb('#8c7d5a');
    pixels(ctx, w, h, (x, y) => {
      const n = N1.fbm((x / w) * 8, (y / h) * 4, 4, 8);
      const weave = ((x + y) % 4 < 2 ? 0.95 : 1.05) * ((x - y + 1000) % 4 < 2 ? 0.97 : 1.03);
      const c = mixRgb(base, [60, 52, 38], n * 0.6);
      return [c[0] * weave, c[1] * weave, c[2] * weave];
    });
  }, { repeat: true });
}

/* ======================================================================== particles & decals */

/** Soft billowing smoke puff (white with alpha) — tinted per particle. */
export function smokeTexture() {
  return paintTexture('smoke', 128, 128, (ctx, w, h) => {
    pixels(ctx, w, h, (x, y) => {
      const u = x / w - 0.5, v = y / h - 0.5;
      const d = Math.sqrt(u * u + v * v) * 2;
      const n = N2.fbm(x / 16, y / 16, 4, 8);
      const a = Math.max(0, 1 - d * (0.8 + 0.6 * n)) ** 1.4;
      const shadeV = 0.75 + 0.35 * (1 - (v + 0.5)) + 0.15 * (n - 0.5);
      const s = Math.max(0, Math.min(255, 255 * shadeV));
      return [s, s, s, Math.min(255, a * 255 * 1.2)];
    });
  }, { srgb: true });
}

export function fireTexture() {
  return paintTexture('fire', 128, 128, (ctx, w, h) => {
    pixels(ctx, w, h, (x, y) => {
      const u = x / w - 0.5, v = y / h - 0.5;
      const d = Math.sqrt(u * u + v * v) * 2;
      const n = N3.fbm(x / 12, y / 12, 4, 8);
      const a = Math.max(0, 1 - d * (0.7 + 0.8 * n)) ** 1.2;
      return [255, 200 * (0.6 + 0.4 * (1 - d)), 120 * (1 - d), a * 255];
    });
  });
}

export function glowTexture() {
  return paintTexture('glow', 64, 64, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

export function craterTexture() {
  return paintTexture('crater', 256, 256, (ctx, w, h) => {
    pixels(ctx, w, h, (x, y) => {
      const u = x / w - 0.5, v = y / h - 0.5;
      const ang = Math.atan2(v, u);
      const n = N1.fbm(Math.cos(ang) * 3 + 10, Math.sin(ang) * 3 + 10, 3, 64);
      const d = Math.sqrt(u * u + v * v) * 2 / (0.75 + 0.35 * n);
      if (d > 1) return [0, 0, 0, 0];
      // dark centre, raised lighter rim of thrown earth
      const rim = Math.exp(-((d - 0.78) ** 2) / 0.012);
      const centre = Math.max(0, 1 - d / 0.62);
      const c = mixRgb([58, 46, 34], [30, 24, 18], centre);
      const cc = mixRgb(c, [110, 92, 70], rim * 0.7);
      const a = d > 0.85 ? (1 - d) / 0.15 : 1;
      const speck = N3.sample(x / 3, y / 3, 64) > 0.7 ? 0.8 : 1;
      return [cc[0] * speck, cc[1] * speck, cc[2] * speck, a * 235];
    });
  });
}

export function scorchTexture() {
  return paintTexture('scorch', 128, 128, (ctx, w, h) => {
    pixels(ctx, w, h, (x, y) => {
      const u = x / w - 0.5, v = y / h - 0.5;
      const d = Math.sqrt(u * u + v * v) * 2;
      const n = N2.fbm(x / 10, y / 10, 4, 16);
      const a = Math.max(0, 1 - d * (0.7 + 0.6 * n));
      return [12, 10, 8, a * 220];
    });
  });
}

/** Penetration hole / gouge decal on armour. */
export function holeTexture() {
  return paintTexture('hole', 64, 64, (ctx, w) => {
    blob(ctx, w / 2, w / 2, w / 2, 'rgba(70,60,50,0.9)');
    blob(ctx, w / 2, w / 2, w * 0.3, 'rgba(140,120,100,0.9)');
    ctx.fillStyle = 'rgb(8,6,5)';
    ctx.beginPath();
    ctx.arc(w / 2, w / 2, w * 0.17, 0, Math.PI * 2);
    ctx.fill();
  });
}

export function gougeTexture() {
  return paintTexture('gouge', 64, 32, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(180,170,155,0)');
    g.addColorStop(0.2, 'rgba(200,190,170,0.9)');
    g.addColorStop(1, 'rgba(120,110,100,0.2)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w / 2, h * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

/* ======================================================================== foliage */

/** Painted foliage cluster sprite: deciduous canopy lit from the upper left. */
export function foliageTexture(seed: number, tint = '#4f6a2e', shape: 'round' | 'poplar' | 'hedge' = 'round') {
  return paintTexture(`foliage${seed}${tint}${shape}`, 256, shape === 'poplar' ? 512 : 256, (ctx, w, h) => {
    const r = new RNG(seed * 7 + 3);
    const base = hexRgb(tint);
    const light = mixRgb(base, [220, 230, 140], 0.35);
    const dark = mixRgb(base, [10, 20, 10], 0.6);
    const n = shape === 'poplar' ? 520 : shape === 'hedge' ? 520 : 420;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < n; i++) {
        let x: number, y: number;
        if (shape === 'poplar') {
          const t = r.next();
          y = h * (0.04 + 0.92 * t);
          const half = w * 0.36 * Math.sin(Math.PI * Math.pow(t, 0.8)) + 4;
          x = w / 2 + r.range(-half, half);
        } else if (shape === 'hedge') {
          x = r.range(w * 0.03, w * 0.97);
          y = h * 0.95 - r.range(0, h * 0.75) * Math.pow(Math.sin((x / w) * Math.PI), 0.3);
        } else {
          const a = r.range(0, Math.PI * 2), rr = Math.sqrt(r.next()) * w * 0.42;
          x = w / 2 + Math.cos(a) * rr;
          y = h * 0.5 + Math.sin(a) * rr * 0.85;
        }
        const s = r.range(5, 13);
        const lightAmt = 1 - (y / h) * 0.9 + (0.5 - x / w) * 0.3;
        const c = pass === 0 ? dark : pass === 1 ? base : mixRgb(base, light, Math.max(0, lightAmt));
        if (pass === 2 && r.chance(0.55)) continue;
        ctx.fillStyle = rgba(mixRgb(c, [0, 0, 0], r.range(0, 0.15)), 0.95);
        ctx.beginPath();
        ctx.ellipse(x + (pass === 2 ? -2 : 0), y + (pass === 2 ? -3 : 0), s, s * 0.75, r.range(0, 3), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

export function barkTexture() {
  return paintTexture('bark', 128, 256, (ctx, w, h) => {
    pixels(ctx, w, h, (x, y) => {
      const n = N1.fbm((x / w) * 6, (y / h) * 2, 4, 6);
      const ridge = Math.abs(Math.sin((x / w) * 40 + n * 6));
      const c = mixRgb([70, 60, 50], [40, 34, 28], ridge * 0.7 + n * 0.3);
      return c;
    });
  }, { repeat: true });
}

/* ======================================================================== markings */

/** US Army white star in a circle ("invasion star") — 1944 Normandy marking. */
export function usStarTexture() {
  return paintTexture('usstar', 256, 256, (ctx, w) => {
    ctx.clearRect(0, 0, w, w);
    const c = w / 2;
    ctx.strokeStyle = 'rgba(232,230,218,0.95)';
    ctx.lineWidth = w * 0.05;
    ctx.beginPath();
    ctx.arc(c, c, w * 0.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(232,230,218,0.95)';
    star(ctx, c, c, w * 0.42, w * 0.16);
    weatherAlpha(ctx, w, w, 0.35);
  });
}

export function balkenkreuzTexture() {
  return paintTexture('balken', 256, 256, (ctx, w) => {
    const c = w / 2;
    const arm = w * 0.42, t = w * 0.12;
    ctx.fillStyle = 'rgba(235,235,230,0.95)';
    ctx.fillRect(c - arm, c - t - w * 0.05, arm * 2, (t + w * 0.05) * 2);
    ctx.fillRect(c - t - w * 0.05, c - arm, (t + w * 0.05) * 2, arm * 2);
    ctx.fillStyle = 'rgba(20,20,20,0.95)';
    ctx.fillRect(c - arm + w * 0.05, c - t, (arm - w * 0.05) * 2, t * 2);
    ctx.fillRect(c - t, c - arm + w * 0.05, t * 2, (arm - w * 0.05) * 2);
    weatherAlpha(ctx, w, w, 0.3);
  });
}

export function numberTexture(text: string, color = '#c23a2a', outline = '#e8e4d8') {
  return paintTexture(`num${text}${color}`, 256, 128, (ctx, w, h) => {
    ctx.font = `bold ${h * 0.8}px "Arial Black", Impact, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = outline;
    ctx.strokeText(text, w / 2, h / 2 + 4);
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2 + 4);
    weatherAlpha(ctx, w, h, 0.35);
  });
}

function star(ctx: Ctx, cx: number, cy: number, R: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? R : r;
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/** chip paint: knock alpha out where noise is high */
function weatherAlpha(ctx: Ctx, w: number, h: number, amount: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const n = N3.fbm(x / 9, y / 9, 3, 64);
      if (n > 1 - amount * 0.6) d[i + 3] *= 0.25;
      else d[i + 3] *= 0.85 + 0.15 * n;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** text sign (road signs, shop names) */
export function signTexture(text: string, bg = '#e9e2cf', fg = '#1f2a44', w = 512, h = 128) {
  return paintTexture(`sign${text}${bg}${fg}${w}`, w, h, (ctx) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = fg;
    ctx.font = `bold ${h * 0.5}px Georgia, "Times New Roman", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 2);
    weatherAlpha(ctx, w, h, 0.25);
  });
}

/** large painted lettering directly on a wall (ghost sign) */
export function wallLetteringTexture(lines: string[], color = 'rgba(236,228,206,0.85)') {
  return paintTexture(`wall${lines.join('|')}`, 512, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lh = h / (lines.length + 0.6);
    ctx.font = `bold ${lh * 0.7}px Impact, "Arial Narrow", sans-serif`;
    lines.forEach((l, i) => ctx.fillText(l, w / 2, lh * (i + 0.8)));
    weatherAlpha(ctx, w, h, 0.5);
  });
}

export function setRepeat(t: THREE.Texture, rx: number, ry: number) {
  const c = t.clone();
  c.needsUpdate = true;
  c.wrapS = c.wrapT = THREE.RepeatWrapping;
  c.repeat.set(rx, ry);
  return c;
}

/** churned country road after rain: brown mud, two wet ruts with track-link imprints, gravel */
export function mudRoadTexture() {
  return paintTexture('mudroad', 1024, 256, (ctx, w, h) => {
    const a = hexRgb('#5b4a37'), b = hexRgb('#6d5b44'), wet = hexRgb('#30271d'), edge = hexRgb('#75664b');
    pixels(ctx, w, h, (x, y) => {
      const u = (x / w) * 32, v = (y / h) * 8;
      const n = N1.fbm(u, v, 5, 32);
      let c = mixRgb(a, b, n);
      // ruts: the wheel and track lines, wetter and darker, wandering slightly
      const vv = y / h + (N2.fbm(u * 0.2, 1.3, 2, 8) - 0.5) * 0.08;
      const rut = Math.exp(-(((vv - 0.3) / 0.075) ** 2)) + Math.exp(-(((vv - 0.7) / 0.075) ** 2));
      c = mixRgb(c, wet, Math.min(1, rut * 0.75) * (0.7 + 0.3 * N3.sample(u * 3, v * 3, 128)));
      // the crown between the ruts and the verges are drier and paler
      const e = Math.min(y, h - y) / h;
      c = mixRgb(c, edge, Math.max(0, 0.14 - e) / 0.14 * (0.5 + 0.5 * N3.sample(u * 2, v * 4, 64)));
      const g = 0.86 + 0.28 * N3.sample(u * 6, v * 6, 128);
      return [c[0] * g, c[1] * g, c[2] * g];
    });
    const r = new RNG(91);
    // track-link imprints across both ruts (Sherman / Panzer IV pitch at this scale)
    for (const band of [0.3, 0.7]) {
      for (let x = 0; x < w; x += 7.5) {
        ctx.fillStyle = `rgba(22,17,12,${r.range(0.18, 0.4)})`;
        ctx.fillRect(x + r.range(-0.6, 0.6), h * (band - 0.065), 2.2, h * 0.13);
      }
    }
    // gravel and stones
    for (let i = 0; i < 900; i++) {
      const g = r.range(70, 150);
      ctx.fillStyle = `rgba(${g},${g * 0.93},${g * 0.82},${r.range(0.3, 0.7)})`;
      const s = r.range(1, 3.2);
      ctx.fillRect(r.range(0, w), r.range(0, h), s, s * r.range(0.6, 1));
    }
  }, { repeat: true });
}
