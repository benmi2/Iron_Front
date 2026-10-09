import * as THREE from 'three';
import { canvas, type Ctx } from '../../render/Paint';

/**
 * Side-view weapon sprites painted procedurally (facing +x). Geometry is in METRES relative to
 * the trigger grip (0,0), +x forward, +y up; the sprite is placed so these anchors line up with
 * the soldier's hands and shoulder.
 */
export interface WeaponArtDef {
  id: string;
  tex: THREE.Texture;
  /** sprite rectangle in metres relative to the grip */
  x0: number;
  y0: number;
  w: number;
  h: number;
  butt: [number, number];
  fore: [number, number];
  muzzle: [number, number];
}

const PXM = 320; // painting resolution, px per metre
const cache = new Map<string, WeaponArtDef>();

const WOOD = '#6e4a2a';
const WOOD_D = '#4e3219';
const STEEL = '#2e3032';
const STEEL_L = '#4a4d50';
const OD = '#4f5236';
const FG = '#555a4c';

type Draw = (ctx: Ctx, m: (x: number, y: number) => [number, number]) => void;

function make(id: string, x0: number, y0: number, w: number, h: number, butt: [number, number], fore: [number, number], muzzle: [number, number], draw: Draw): WeaponArtDef {
  const hit = cache.get(id);
  if (hit) return hit;
  const [c, ctx] = canvas(Math.ceil(w * PXM), Math.ceil(h * PXM));
  // metres → canvas px (y flipped)
  const m = (x: number, y: number): [number, number] => [(x - x0) * PXM, (y0 + h - y) * PXM];
  draw(ctx, m);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const def = { id, tex, x0, y0, w, h, butt, fore, muzzle };
  cache.set(id, def);
  return def;
}

function poly(ctx: Ctx, m: (x: number, y: number) => [number, number], pts: [number, number][], fill: string, stroke?: string) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const [px, py] = m(x, y);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function bar(ctx: Ctx, m: (x: number, y: number) => [number, number], xa: number, xb: number, y: number, hh: number, fill: string) {
  poly(ctx, m, [[xa, y - hh], [xb, y - hh], [xb, y + hh], [xa, y + hh]], fill);
  // highlight
  const [p0x, p0y] = m(xa, y + hh * 0.6);
  const [p1x] = m(xb, y);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(p0x, p0y, p1x - p0x, Math.max(1, hh * PXM * 0.4));
}

function grain(ctx: Ctx) {
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = `rgba(30,15,5,${0.08 + Math.random() * 0.08})`;
    ctx.beginPath();
    const y = Math.random() * ctx.canvas.height;
    ctx.moveTo(0, y);
    ctx.lineTo(ctx.canvas.width, y + (Math.random() - 0.5) * 6);
    ctx.stroke();
  }
  ctx.restore();
}

export function weaponArt(id: string): WeaponArtDef {
  switch (id) {
    case 'garand':
    case 'carbine': {
      const L = id === 'garand' ? 1 : 0.82;
      return make(id, -0.4 * L, -0.08, 1.16 * L, 0.18, [-0.37 * L, -0.015], [0.25 * L, 0.0], [0.73 * L, 0.045], (ctx, m) => {
        poly(ctx, m, [[-0.37 * L, 0.03], [-0.06, 0.035], [0.02, 0.0], [0.5 * L, 0.02], [0.5 * L, -0.005], [0.06, -0.02], [-0.05, -0.055], [-0.37 * L, -0.06]], WOOD, WOOD_D);
        grain(ctx);
        bar(ctx, m, -0.06, 0.73 * L, 0.04, 0.009, STEEL);
        bar(ctx, m, -0.08, 0.08, 0.03, 0.016, STEEL_L);
        poly(ctx, m, [[0.68 * L, 0.05], [0.69 * L, 0.065], [0.7 * L, 0.05]], STEEL);
        poly(ctx, m, [[-0.005, -0.02], [0.01, -0.045], [0.02, -0.02]], STEEL);
        if (id === 'carbine') poly(ctx, m, [[0.02, -0.02], [0.06, -0.02], [0.06, -0.07], [0.02, -0.07]], STEEL);
      });
    }
    case 'kar98k':
      return make(id, -0.42, -0.08, 1.16, 0.18, [-0.4, -0.02], [0.24, 0.0], [0.71, 0.05], (ctx, m) => {
        poly(ctx, m, [[-0.4, 0.025], [-0.07, 0.035], [0.0, 0.0], [0.55, 0.02], [0.55, -0.002], [0.05, -0.02], [-0.06, -0.05], [-0.4, -0.065]], WOOD, WOOD_D);
        grain(ctx);
        bar(ctx, m, -0.05, 0.71, 0.04, 0.008, STEEL);
        bar(ctx, m, -0.07, 0.07, 0.032, 0.014, STEEL_L);
        // turned-down bolt handle
        poly(ctx, m, [[-0.04, 0.035], [-0.03, 0.035], [-0.025, -0.005], [-0.04, -0.01]], STEEL_L);
        poly(ctx, m, [[-0.005, -0.02], [0.01, -0.045], [0.02, -0.02]], STEEL);
      });
    case 'thompson':
      return make(id, -0.38, -0.2, 0.86, 0.28, [-0.36, -0.01], [0.17, -0.06], [0.45, 0.03], (ctx, m) => {
        poly(ctx, m, [[-0.36, 0.02], [-0.1, 0.03], [-0.07, -0.02], [-0.36, -0.06]], WOOD, WOOD_D);
        bar(ctx, m, -0.1, 0.12, 0.03, 0.025, STEEL_L);
        bar(ctx, m, 0.1, 0.45, 0.03, 0.011, STEEL);
        poly(ctx, m, [[-0.03, 0.005], [0.0, 0.005], [-0.005, -0.07], [-0.04, -0.07]], WOOD, WOOD_D); // rear grip
        poly(ctx, m, [[0.15, 0.01], [0.19, 0.01], [0.185, -0.08], [0.15, -0.08]], WOOD, WOOD_D); // fore grip
        poly(ctx, m, [[0.04, 0.0], [0.08, 0.0], [0.09, -0.19], [0.05, -0.19]], STEEL); // 30-rd magazine
      });
    case 'mp40':
      return make(id, -0.36, -0.2, 0.9, 0.28, [-0.33, 0.0], [0.12, -0.03], [0.5, 0.04], (ctx, m) => {
        // folding stock struts
        ctx.strokeStyle = STEEL;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(...m(-0.33, 0.02)); ctx.lineTo(...m(-0.05, 0.03)); ctx.moveTo(...m(-0.33, -0.03)); ctx.lineTo(...m(-0.05, 0.0)); ctx.stroke();
        poly(ctx, m, [[-0.34, 0.03], [-0.32, 0.03], [-0.32, -0.05], [-0.34, -0.05]], STEEL);
        bar(ctx, m, -0.06, 0.2, 0.03, 0.02, STEEL);
        bar(ctx, m, 0.2, 0.5, 0.035, 0.01, STEEL_L);
        poly(ctx, m, [[-0.04, 0.01], [-0.005, 0.01], [-0.01, -0.07], [-0.045, -0.07]], '#3a2a1e'); // bakelite grip
        poly(ctx, m, [[0.1, 0.01], [0.135, 0.01], [0.135, -0.19], [0.1, -0.19]], STEEL); // magazine
      });
    case 'bar':
      return make(id, -0.4, -0.1, 1.26, 0.2, [-0.38, -0.02], [0.3, 0.0], [0.83, 0.04], (ctx, m) => {
        poly(ctx, m, [[-0.38, 0.03], [-0.08, 0.035], [-0.05, -0.04], [-0.38, -0.06]], WOOD, WOOD_D);
        grain(ctx);
        bar(ctx, m, -0.08, 0.2, 0.025, 0.028, STEEL_L);
        bar(ctx, m, 0.2, 0.42, 0.015, 0.022, WOOD);
        bar(ctx, m, 0.2, 0.83, 0.04, 0.01, STEEL);
        poly(ctx, m, [[0.02, -0.005], [0.12, -0.005], [0.12, -0.08], [0.02, -0.08]], STEEL); // 20-rd magazine
        // bipod legs folded
        ctx.strokeStyle = STEEL;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(...m(0.75, 0.035)); ctx.lineTo(...m(0.45, 0.0)); ctx.stroke();
      });
    case 'mg42':
      return make(id, -0.36, -0.12, 1.3, 0.24, [-0.33, 0.0], [0.15, 0.06], [0.89, 0.04], (ctx, m) => {
        poly(ctx, m, [[-0.34, 0.03], [-0.1, 0.035], [-0.09, -0.04], [-0.33, -0.05]], '#2b2420');
        bar(ctx, m, -0.1, 0.25, 0.035, 0.035, STEEL);
        // ventilated barrel jacket
        bar(ctx, m, 0.25, 0.85, 0.04, 0.022, STEEL_L);
        for (let x = 0.3; x < 0.8; x += 0.06) poly(ctx, m, [[x, 0.03], [x + 0.035, 0.03], [x + 0.035, 0.05], [x, 0.05]], '#111');
        bar(ctx, m, 0.85, 0.9, 0.04, 0.014, STEEL);
        poly(ctx, m, [[-0.04, 0.0], [-0.005, 0.0], [-0.01, -0.07], [-0.045, -0.07]], '#2b2420');
        // belt hanging
        poly(ctx, m, [[0.02, 0.0], [0.08, 0.0], [0.05, -0.11], [0.0, -0.1]], '#8a7a40');
        ctx.strokeStyle = STEEL;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(...m(0.6, 0.02)); ctx.lineTo(...m(0.45, -0.1)); ctx.stroke();
      });
    case 'bazooka':
      return make(id, -0.8, -0.14, 1.5, 0.3, [-0.1, 0.08], [0.18, -0.02], [0.62, 0.085], (ctx, m) => {
        bar(ctx, m, -0.75, 0.62, 0.085, 0.032, OD);
        poly(ctx, m, [[0.56, 0.12], [0.64, 0.13], [0.64, 0.04], [0.56, 0.05]], OD); // flared muzzle guard
        bar(ctx, m, -0.75, -0.7, 0.085, 0.04, '#3a3c28');
        poly(ctx, m, [[-0.03, 0.055], [0.01, 0.055], [0.0, -0.06], [-0.035, -0.06]], WOOD, WOOD_D); // pistol grip
        poly(ctx, m, [[0.16, 0.055], [0.2, 0.055], [0.2, -0.05], [0.16, -0.05]], WOOD, WOOD_D); // fore grip
        poly(ctx, m, [[-0.35, 0.055], [-0.12, 0.055], [-0.14, 0.02], [-0.33, 0.02]], WOOD, WOOD_D); // shoulder stock
        ctx.fillStyle = '#c8b860';
        const [bx, by] = m(-0.2, 0.125);
        ctx.fillRect(bx, by, 0.12 * PXM, 3); // battery box marking
      });
    case 'panzerschreck':
      return make(id, -0.86, -0.16, 1.74, 0.42, [-0.1, 0.09], [0.22, -0.02], [0.82, 0.09], (ctx, m) => {
        bar(ctx, m, -0.82, 0.82, 0.09, 0.05, FG);
        for (const x of [-0.6, -0.2, 0.3, 0.7]) bar(ctx, m, x, x + 0.03, 0.09, 0.055, '#3e4236');
        // blast shield (RPzB 54) with sight window
        poly(ctx, m, [[0.05, 0.25], [0.12, 0.25], [0.12, -0.06], [0.05, -0.06]], FG, '#2a2c25');
        poly(ctx, m, [[0.07, 0.2], [0.1, 0.2], [0.1, 0.16], [0.07, 0.16]], '#9fb0b8');
        poly(ctx, m, [[-0.03, 0.04], [0.01, 0.04], [0.0, -0.08], [-0.035, -0.08]], WOOD, WOOD_D);
        poly(ctx, m, [[0.2, 0.04], [0.24, 0.04], [0.24, -0.06], [0.2, -0.06]], WOOD, WOOD_D);
      });
    case 'panzerfaust':
      return make(id, -0.66, -0.1, 1.1, 0.24, [-0.3, 0.02], [0.08, 0.0], [0.4, 0.03], (ctx, m) => {
        bar(ctx, m, -0.62, 0.22, 0.02, 0.025, '#5f6a40');
        // over-calibre warhead
        poly(ctx, m, [[0.2, 0.0], [0.24, 0.09], [0.34, 0.1], [0.43, 0.04], [0.43, 0.0], [0.34, -0.06], [0.24, -0.05]], '#5a4a32', '#2a2016');
        poly(ctx, m, [[0.0, 0.045], [0.03, 0.08], [0.06, 0.045]], '#2a2a2a'); // sight leaf / trigger
        ctx.fillStyle = '#e6d070';
        const [tx, ty] = m(-0.3, 0.032);
        ctx.font = '10px sans-serif';
        ctx.fillText('Achtung!', tx, ty);
      });
    case 'pistol':
    default:
      return make('pistol', -0.06, -0.12, 0.26, 0.18, [-0.05, 0.0], [0.0, 0.0], [0.17, 0.03], (ctx, m) => {
        bar(ctx, m, -0.04, 0.17, 0.03, 0.014, STEEL);
        poly(ctx, m, [[-0.04, 0.02], [0.0, 0.02], [-0.01, -0.09], [-0.05, -0.08]], '#2e2620');
      });
  }
}
