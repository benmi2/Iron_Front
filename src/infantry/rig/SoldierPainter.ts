import * as THREE from 'three';
import { RNG } from '../../core/rng';
import { canvas, hexRgb, mixRgb, rgba, type Ctx } from '../../render/Paint';

/**
 * Procedural soldier textures — technique from Dead Meridian's CharacterPainter (shaded limb
 * cylinders, creases, stitching) re-applied to 1944 uniforms:
 *   US: M1 helmet (often netted), M1941 field jacket / HBT, OD wool trousers, canvas leggings,
 *       M1923 cartridge belt and suspenders; tank crews: Rawlings tanker helmet, HBT coveralls.
 *   German: M40/M42 Stahlhelm, M43 field-grey tunic, Y-straps, bread bag, ankle boots with
 *       gaiters or jackboots; Panzer crews: black wrap jacket and Feldmütze.
 * Painted at 2× and cached per look.
 */

export type HelmetKind = 'm1' | 'm1net' | 'tanker_us' | 'm40' | 'm40camo' | 'feldmutze' | 'schirmmutze';

export interface SoldierLook {
  nation: 'USA' | 'GER';
  kind: 'infantry' | 'crew' | 'officer' | 'medic';
  skin: string;
  helmet: HelmetKind;
  tunic: string;
  trousers: string;
  boots: 'leggings' | 'jackboots' | 'gaiters';
  pack: boolean;
  seed: number;
}

export interface PartTex {
  tex: THREE.Texture;
  w: number;
  h: number;
  ox: number;
  oy: number;
}

export interface RigTextures {
  head: PartTex;
  torso: PartTex;
  upperArm: PartTex;
  foreArm: PartTex;
  hand: PartTex;
  thigh: PartTex;
  shin: PartTex;
  foot: PartTex;
  pack: PartTex | null;
}

const SCALE = 2;
const cache = new Map<string, RigTextures>();

const SKINS = ['#e0b896', '#d6a882', '#c9966f', '#b98460', '#e8c4a4', '#a8724e'];

export function lookFor(nation: 'USA' | 'GER', kind: SoldierLook['kind'], seed: number): SoldierLook {
  const r = new RNG(seed);
  const skin = r.pick(SKINS.slice(0, 5));
  if (nation === 'USA') {
    if (kind === 'crew') return { nation, kind, skin, helmet: 'tanker_us', tunic: '#7d7356', trousers: '#6f6a4f', boots: 'leggings', pack: false, seed };
    const hbt = r.chance(0.35);
    return {
      nation, kind, skin, helmet: r.chance(0.55) ? 'm1net' : 'm1', tunic: hbt ? '#6b6a4a' : r.pick(['#8a7d5c', '#857a58', '#7f7454']),
      trousers: hbt ? '#62613f' : r.pick(['#5d5a45', '#625c46']), boots: 'leggings', pack: kind !== 'officer' && r.chance(0.7), seed,
    };
  }
  if (kind === 'crew') return { nation, kind, skin, helmet: 'feldmutze', tunic: '#26272a', trousers: '#232427', boots: 'gaiters', pack: false, seed };
  return {
    nation, kind, skin, helmet: kind === 'officer' ? 'schirmmutze' : r.chance(0.4) ? 'm40camo' : 'm40',
    tunic: r.pick(['#5d6150', '#596052', '#646754']), trousers: r.pick(['#555a4c', '#5a5c50']),
    boots: r.chance(0.5) ? 'jackboots' : 'gaiters', pack: kind !== 'officer' && r.chance(0.6), seed,
  };
}

function part(key: string, w: number, h: number, ox: number, oy: number, paint: (ctx: Ctx, w: number, h: number) => void): PartTex {
  const [c, ctx] = canvas(w * SCALE, h * SCALE);
  ctx.scale(SCALE, SCALE);
  paint(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.name = key;
  return { tex, w, h, ox, oy };
}

/** shaded cylinder fill (lit from the upper left, like DM's cylGrad) */
function cyl(ctx: Ctx, x0: number, x1: number, color: string, light = 0.25, dark = -0.45) {
  const c = hexRgb(color);
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, rgba(mixRgb(c, [0, 0, 0], -dark * 0.6)));
  g.addColorStop(0.3, rgba(mixRgb(c, [255, 245, 225], light * 0.6)));
  g.addColorStop(0.65, rgba(c));
  g.addColorStop(1, rgba(mixRgb(c, [0, 0, 0], -dark)));
  return g;
}

function limbPath(ctx: Ctx, w: number, topW: number, botW: number, len: number, top: number) {
  const cx = w / 2;
  ctx.beginPath();
  ctx.moveTo(cx - topW / 2, top);
  ctx.quadraticCurveTo(cx - topW / 2 - 1, top - 4, cx, top - 5);
  ctx.quadraticCurveTo(cx + topW / 2 + 1, top - 4, cx + topW / 2, top);
  ctx.lineTo(cx + botW / 2, top + len);
  ctx.quadraticCurveTo(cx, top + len + 4, cx - botW / 2, top + len);
  ctx.closePath();
}

function crease(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, a = 0.2) {
  ctx.strokeStyle = `rgba(0,0,0,${a})`;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo((x0 + x1) / 2 + 2, (y0 + y1) / 2, x1, y1);
  ctx.stroke();
}

function noiseFabric(ctx: Ctx, w: number, h: number, seed: number, amt = 0.07) {
  const r = new RNG(seed);
  for (let i = 0; i < w * h * 0.08; i++) {
    ctx.fillStyle = r.chance(0.5) ? `rgba(255,255,255,${amt})` : `rgba(0,0,0,${amt * 1.4})`;
    ctx.fillRect(r.range(0, w), r.range(0, h), 1, 1);
  }
}

function dirt(ctx: Ctx, w: number, h: number, seed: number, fromBottom = true) {
  const g = ctx.createLinearGradient(0, fromBottom ? h : 0, 0, fromBottom ? h * 0.5 : h);
  g.addColorStop(0, 'rgba(70,55,35,0.45)');
  g.addColorStop(1, 'rgba(70,55,35,0)');
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  void seed;
}

export function soldierTextures(look: SoldierLook): RigTextures {
  const key = JSON.stringify(look);
  const hit = cache.get(key);
  if (hit) return hit;
  const L = look;
  const seed = L.seed;

  /* ------------------------------------------------------------------ head (profile, facing +x) */
  const head = part(`${key}h`, 50, 58, 20 / 50, 50 / 58, (ctx) => {
    const cx = 22, cy = 32;
    // neck
    ctx.fillStyle = cyl(ctx, cx - 7, cx + 7, L.skin);
    ctx.fillRect(cx - 6, cy + 8, 12, 14);
    // skull + face profile
    ctx.fillStyle = L.skin;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 13, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath(); // jaw / chin toward +x
    ctx.moveTo(cx + 4, cy + 14);
    ctx.quadraticCurveTo(cx + 13, cy + 12, cx + 14, cy + 4);
    ctx.lineTo(cx + 16, cy - 1); // nose
    ctx.lineTo(cx + 13, cy - 3);
    ctx.lineTo(cx + 12, cy - 8);
    ctx.lineTo(cx, cy - 6);
    ctx.closePath();
    ctx.fill();
    // shading
    const g = ctx.createRadialGradient(cx + 4, cy - 4, 2, cx, cy, 18);
    g.addColorStop(0, 'rgba(255,240,220,0.25)');
    g.addColorStop(1, 'rgba(60,30,20,0.35)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 13, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    // ear, eye, brow, stubble
    ctx.fillStyle = rgba(mixRgb(hexRgb(L.skin), [90, 40, 30], 0.25));
    ctx.beginPath(); ctx.ellipse(cx - 3, cy + 1, 3, 4.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a1e18';
    ctx.fillRect(cx + 9, cy - 4, 2.2, 1.6);
    ctx.fillStyle = 'rgba(40,25,15,0.6)';
    ctx.fillRect(cx + 7, cy - 6.5, 5, 1.2);
    ctx.fillStyle = 'rgba(40,30,25,0.18)';
    ctx.beginPath(); ctx.ellipse(cx + 8, cy + 8, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(90,40,30,0.5)';
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(cx + 9, cy + 7); ctx.lineTo(cx + 13, cy + 6.5); ctx.stroke();
    // headgear
    paintHeadgear(ctx, L, cx, cy, seed);
  });

  /* ------------------------------------------------------------------ torso (upright, hip at bottom) */
  const tw = 70, th = 86;
  const torso = part(`${key}t`, tw, th, 0.5, 78 / 86, (ctx) => {
    const cx = tw / 2;
    // jacket body: shoulders (top) to hips (bottom)
    ctx.beginPath();
    ctx.moveTo(cx - 13, 80);
    ctx.lineTo(cx - 15, 40);
    ctx.quadraticCurveTo(cx - 18, 14, cx - 12, 10);
    ctx.quadraticCurveTo(cx, 6, cx + 12, 10);
    ctx.quadraticCurveTo(cx + 19, 16, cx + 16, 42);
    ctx.lineTo(cx + 14, 80);
    ctx.closePath();
    ctx.fillStyle = cyl(ctx, cx - 18, cx + 18, L.tunic);
    ctx.fill();
    ctx.save();
    ctx.clip();
    noiseFabric(ctx, tw, th, seed);
    crease(ctx, cx - 6, 30, cx + 4, 46);
    crease(ctx, cx - 8, 52, cx + 6, 62, 0.15);
    // collar
    ctx.fillStyle = rgba(mixRgb(hexRgb(L.tunic), [0, 0, 0], 0.25));
    ctx.fillRect(cx - 9, 8, 18, 5);
    // front placket & buttons (toward +x)
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.moveTo(cx + 12, 14); ctx.lineTo(cx + 13, 76); ctx.stroke();
    ctx.fillStyle = 'rgba(40,30,20,0.6)';
    for (let i = 0; i < 4; i++) ctx.fillRect(cx + 11, 22 + i * 13, 2, 2);
    // pockets
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.strokeRect(cx + 1, 24, 11, 10);
    ctx.strokeRect(cx + 1, 54, 12, 12);
    if (L.kind === 'crew' && L.nation === 'GER') {
      // Panzer wrap jacket: double breast, pink Waffenfarbe piping
      ctx.strokeStyle = 'rgba(200,120,140,0.6)';
      ctx.beginPath(); ctx.moveTo(cx - 9, 13); ctx.lineTo(cx + 9, 13); ctx.stroke();
    }
    // belt
    ctx.fillStyle = L.nation === 'USA' ? '#7a6e4c' : '#1e1a16';
    ctx.fillRect(cx - 18, 64, 36, 6);
    ctx.fillStyle = L.nation === 'USA' ? '#9a9070' : '#6b6a66';
    ctx.fillRect(cx + 9, 64.5, 4, 5);
    if (L.kind !== 'crew') {
      if (L.nation === 'USA') {
        // M1923 cartridge belt pouches & suspenders
        ctx.fillStyle = '#7d7150';
        for (let i = 0; i < 3; i++) ctx.fillRect(cx - 12 + i * 7, 63, 6, 9);
        ctx.strokeStyle = '#6d6345';
        ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(cx - 4, 10); ctx.lineTo(cx + 4, 64); ctx.stroke();
      } else {
        // Y-straps, cartridge pouches (front), bread bag hint
        ctx.strokeStyle = '#2a2420';
        ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.moveTo(cx - 6, 10); ctx.lineTo(cx + 6, 64); ctx.stroke();
        ctx.fillStyle = '#2b2622';
        ctx.fillRect(cx + 6, 58, 9, 9);
        ctx.fillRect(cx - 4, 58, 8, 9);
      }
    }
    if (L.kind === 'medic') {
      ctx.fillStyle = '#e8e4da';
      ctx.fillRect(cx - 14, 20, 10, 8);
      ctx.fillStyle = '#b02020';
      ctx.fillRect(cx - 10.5, 21, 3, 6);
      ctx.fillRect(cx - 12, 22.5, 6, 3);
    }
    dirt(ctx, tw, th, seed);
    ctx.restore();
  });

  const sleeve = L.tunic;
  const upperArm = part(`${key}ua`, 26, 44, 0.5, 6 / 44, (ctx, w) => {
    limbPath(ctx, w, 15, 12, 32, 6);
    ctx.fillStyle = cyl(ctx, 4, w - 4, sleeve);
    ctx.fill();
    ctx.save(); ctx.clip(); noiseFabric(ctx, w, 44, seed + 1); crease(ctx, 8, 20, 18, 26); ctx.restore();
  });
  const foreArm = part(`${key}fa`, 24, 42, 0.5, 5 / 42, (ctx, w) => {
    limbPath(ctx, w, 12, 10, 30, 5);
    ctx.fillStyle = cyl(ctx, 4, w - 4, sleeve);
    ctx.fill();
    ctx.save(); ctx.clip(); noiseFabric(ctx, w, 42, seed + 2);
    // cuff
    ctx.fillStyle = rgba(mixRgb(hexRgb(sleeve), [0, 0, 0], 0.2));
    ctx.fillRect(0, 30, w, 5);
    ctx.restore();
  });
  const hand = part(`${key}hd`, 14, 16, 0.5, 0.3, (ctx) => {
    ctx.fillStyle = L.kind === 'crew' && L.nation === 'USA' ? '#6a5236' : L.skin;
    ctx.beginPath();
    ctx.ellipse(7, 8, 5, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(8, 10, 3, 4, 0, 0, Math.PI * 2); ctx.fill();
  });
  const thigh = part(`${key}th`, 30, 56, 0.5, 7 / 56, (ctx, w) => {
    limbPath(ctx, w, 20, 15, 46, 7);
    ctx.fillStyle = cyl(ctx, 4, w - 4, L.trousers);
    ctx.fill();
    ctx.save(); ctx.clip(); noiseFabric(ctx, w, 56, seed + 3); crease(ctx, 8, 30, 20, 40); crease(ctx, 10, 44, 22, 50, 0.14);
    if (L.nation === 'USA' && L.kind !== 'crew') { ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.strokeRect(w / 2 + 1, 16, 8, 9); }
    ctx.restore();
  });
  const shin = part(`${key}sh`, 26, 56, 0.5, 6 / 56, (ctx, w) => {
    limbPath(ctx, w, 15, 12, 46, 6);
    ctx.fillStyle = cyl(ctx, 4, w - 4, L.trousers);
    ctx.fill();
    ctx.save(); ctx.clip();
    noiseFabric(ctx, w, 56, seed + 4);
    if (L.boots === 'leggings') {
      // US M1938 canvas leggings over the lower shin, laced on the outside
      ctx.fillStyle = cyl(ctx, 4, w - 4, '#a19270');
      ctx.fillRect(0, 26, w, 30);
      ctx.strokeStyle = 'rgba(60,45,25,0.6)';
      for (let y = 30; y < 52; y += 4) { ctx.beginPath(); ctx.moveTo(w / 2 - 3, y); ctx.lineTo(w / 2 + 3, y + 2); ctx.stroke(); }
    } else if (L.boots === 'jackboots') {
      ctx.fillStyle = cyl(ctx, 4, w - 4, '#1c1814', 0.35);
      ctx.fillRect(0, 18, w, 40);
    } else {
      ctx.fillStyle = cyl(ctx, 4, w - 4, '#4d4b40');
      ctx.fillRect(0, 34, w, 24);
      ctx.fillStyle = '#2a2420';
      ctx.fillRect(w / 2 - 6, 36, 12, 2);
      ctx.fillRect(w / 2 - 6, 44, 12, 2);
    }
    dirt(ctx, w, 56, seed);
    ctx.restore();
  });
  const bootColor = L.nation === 'USA' ? '#4a3220' : '#1c1814';
  const foot = part(`${key}ft`, 32, 16, 8 / 32, 3 / 16, (ctx) => {
    ctx.fillStyle = bootColor;
    ctx.beginPath();
    ctx.moveTo(3, 1);
    ctx.lineTo(13, 1);
    ctx.quadraticCurveTo(15, 7, 24, 8);
    ctx.quadraticCurveTo(30, 9, 29, 13);
    ctx.lineTo(3, 13.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#120e0a';
    ctx.fillRect(3, 12, 27, 2.5);
    ctx.fillStyle = 'rgba(255,240,220,0.12)';
    ctx.fillRect(14, 6, 10, 2);
  });
  const pack = L.pack ? part(`${key}pk`, 30, 40, 0.5, 0.5, (ctx) => {
    if (L.nation === 'USA') {
      ctx.fillStyle = cyl(ctx, 4, 26, '#7a7054');
      ctx.fillRect(5, 4, 20, 30);
      ctx.fillStyle = '#6a6046';
      ctx.fillRect(4, 30, 22, 8); // entrenching tool cover
    } else {
      ctx.fillStyle = cyl(ctx, 4, 26, '#4d4a3e');
      ctx.fillRect(6, 6, 18, 24);
      ctx.fillStyle = '#5c6a5c';
      ctx.beginPath(); ctx.ellipse(15, 33, 8, 5, 0, 0, Math.PI * 2); ctx.fill(); // mess tin
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.strokeRect(5, 4, 20, 30);
  }) : null;

  const t: RigTextures = { head, torso, upperArm, foreArm, hand, thigh, shin, foot, pack };
  cache.set(key, t);
  return t;
}

function paintHeadgear(ctx: Ctx, L: SoldierLook, cx: number, cy: number, seed: number) {
  const r = new RNG(seed + 9);
  switch (L.helmet) {
    case 'm1':
    case 'm1net': {
      const c = '#4f5236';
      ctx.fillStyle = cyl(ctx, cx - 16, cx + 16, c, 0.35);
      ctx.beginPath();
      ctx.moveTo(cx - 17, cy - 1);
      ctx.quadraticCurveTo(cx - 17, cy - 22, cx, cy - 22);
      ctx.quadraticCurveTo(cx + 17, cy - 22, cx + 17, cy - 1);
      ctx.lineTo(cx + 19, cy);
      ctx.lineTo(cx - 19, cy);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#3d3f2a';
      ctx.fillRect(cx - 19, cy - 1, 38, 2.5);
      if (L.helmet === 'm1net') {
        ctx.strokeStyle = 'rgba(40,40,25,0.7)';
        ctx.lineWidth = 0.6;
        for (let i = -16; i < 18; i += 4) { ctx.beginPath(); ctx.moveTo(cx + i, cy - 22); ctx.lineTo(cx + i + 6, cy); ctx.stroke(); }
        for (let i = -16; i < 18; i += 4) { ctx.beginPath(); ctx.moveTo(cx + i, cy - 22); ctx.lineTo(cx + i - 6, cy); ctx.stroke(); }
        ctx.fillStyle = 'rgba(70,80,40,0.8)';
        for (let i = 0; i < 6; i++) ctx.fillRect(cx + r.range(-14, 12), cy + r.range(-20, -6), 3, 2);
      }
      // chin strap hanging loose
      ctx.strokeStyle = '#5a4a30';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(cx + 2, cy); ctx.quadraticCurveTo(cx + 6, cy + 12, cx + 10, cy + 6); ctx.stroke();
      break;
    }
    case 'tanker_us': {
      ctx.fillStyle = cyl(ctx, cx - 15, cx + 15, '#5a4630', 0.3);
      ctx.beginPath();
      ctx.ellipse(cx, cy - 6, 15, 15, 0, Math.PI, 0);
      ctx.lineTo(cx + 15, cy + 2);
      ctx.lineTo(cx - 15, cy + 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#3a2c1c';
      for (let i = -12; i <= 12; i += 6) ctx.fillRect(cx + i, cy - 20, 3, 18);
      ctx.fillStyle = '#2c241a';
      ctx.beginPath(); ctx.ellipse(cx - 2, cy + 1, 5, 6, 0, 0, Math.PI * 2); ctx.fill(); // earphone
      // goggles on the brow
      ctx.fillStyle = '#6a5a3a';
      ctx.fillRect(cx + 4, cy - 12, 11, 4);
      ctx.fillStyle = '#9ab0b0';
      ctx.fillRect(cx + 9, cy - 11.5, 5, 3);
      break;
    }
    case 'm40':
    case 'm40camo': {
      const c = '#4a4e44';
      ctx.fillStyle = cyl(ctx, cx - 17, cx + 17, c, 0.3);
      ctx.beginPath();
      // coal-scuttle: flared skirt at the back (−x) and over the ears
      ctx.moveTo(cx + 15, cy - 4);
      ctx.quadraticCurveTo(cx + 16, cy - 22, cx - 1, cy - 22);
      ctx.quadraticCurveTo(cx - 17, cy - 21, cx - 17, cy - 4);
      ctx.lineTo(cx - 21, cy + 4);
      ctx.lineTo(cx - 13, cy + 2);
      ctx.lineTo(cx + 6, cy - 2);
      ctx.lineTo(cx + 17, cy - 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#3a3d35';
      ctx.beginPath(); ctx.arc(cx - 6, cy - 9, 1.2, 0, Math.PI * 2); ctx.fill();
      if (L.helmet === 'm40camo') {
        // helmet net / chicken wire with foliage
        ctx.fillStyle = 'rgba(80,95,50,0.9)';
        for (let i = 0; i < 14; i++) {
          ctx.beginPath();
          ctx.ellipse(cx + r.range(-15, 13), cy + r.range(-22, -6), r.range(2, 4), r.range(1.5, 3), r.range(0, 3), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'feldmutze': {
      ctx.fillStyle = '#1e1f22';
      ctx.beginPath();
      ctx.moveTo(cx - 14, cy - 8);
      ctx.lineTo(cx + 14, cy - 10);
      ctx.lineTo(cx + 10, cy - 19);
      ctx.lineTo(cx - 12, cy - 17);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#b8b8b0';
      ctx.fillRect(cx + 5, cy - 15, 3, 3);
      // headphones
      ctx.fillStyle = '#2b2b2b';
      ctx.beginPath(); ctx.ellipse(cx - 3, cy + 1, 5, 5.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - 4, cy - 14, 2, 12);
      break;
    }
    case 'schirmmutze': {
      ctx.fillStyle = '#4c5246';
      ctx.fillRect(cx - 14, cy - 18, 28, 8);
      ctx.fillStyle = '#5a6052';
      ctx.beginPath(); ctx.ellipse(cx, cy - 18, 16, 4, -0.08, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#151515';
      ctx.beginPath(); ctx.moveTo(cx + 8, cy - 10); ctx.lineTo(cx + 19, cy - 8); ctx.lineTo(cx + 8, cy - 8); ctx.fill();
      break;
    }
  }
}
