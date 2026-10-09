import * as THREE from 'three';
import type { Look, Renderer } from '../render/Renderer';

export type TimeOfDay = 'morning' | 'noon' | 'evening' | 'dusk';
export type Weather = 'clear' | 'overcast' | 'rain' | 'mist';

/**
 * Lighting presets. 'evening' + 'clear' is the sunset battle of the key art: the sun low in the
 * sky behind the field, orange-lit clouds, a warm key light from the viewer's left so the vehicles
 * read, and a rim light from the sun.
 */
export function applyAtmosphere(r: Renderer, tod: TimeOfDay, wx: Weather) {
  const key: Record<TimeOfDay, { dir: [number, number, number]; color: number; I: number }> = {
    morning: { dir: [0.6, 0.32, 0.45], color: 0xffe4c4, I: 2.6 },
    noon: { dir: [0.15, 0.85, 0.35], color: 0xfff4e6, I: 3.1 },
    evening: { dir: [-0.55, 0.4, 0.6], color: 0xffbf86, I: 3.3 },
    dusk: { dir: [-0.8, 0.16, 0.35], color: 0xff9a5a, I: 2.1 },
  };
  const s = key[tod];
  let I = s.I;
  const looks: Record<TimeOfDay, Look> = {
    morning: {
      fog: 0xb9bcb8, density: 0.0034, top: 0x7290b0, mid: 0xbcc4c6, horizon: 0xe2d6bc, hemiSky: 0xc4d0dc, hemiGround: 0x56503e, hemi: 0.7, exposure: 1.0,
      disc: [-0.34, 0.11, -0.93], discColor: 0xffe2b8, discI: 0.8, glow: 0.3, cloudLit: 0xf6e6d6, cloudDark: 0x8a92a2, cloudCover: 0.36,
      rim: 0xffe2c0, rimI: 1.2, env: 0.5, warmth: 0.03, saturation: 1.08, contrast: 0.22, split: 0.7, bloom: 0.45,
    },
    noon: {
      fog: 0xb5bcc2, density: 0.0025, top: 0x5f86b4, mid: 0xa8bccd, horizon: 0xd6dad6, hemiSky: 0xc8d4e0, hemiGround: 0x5b5240, hemi: 0.75, exposure: 0.95,
      disc: [0.1, 0.9, -0.4], discColor: 0xfff6e8, discI: 0.8, glow: 0.1, cloudLit: 0xffffff, cloudDark: 0x9ca2ac, cloudCover: 0.38,
      rim: 0xfff4e6, rimI: 0.5, env: 0.5, warmth: 0.0, saturation: 1.05, contrast: 0.2, split: 0.5, bloom: 0.35,
    },
    evening: {
      fog: 0xb39a80, density: 0.0024, top: 0x5876a0, mid: 0xb39c98, horizon: 0xf3b26e, hemiSky: 0x9aaac8, hemiGround: 0x4a3828, hemi: 0.6, exposure: 1.0,
      disc: [0.28, 0.075, -0.96], discColor: 0xffbb66, discI: 1.25, glow: 0.35, cloudLit: 0xffa860, cloudDark: 0x3e3c4c, cloudCover: 0.58,
      rim: 0xffa458, rimI: 2.4, env: 0.45, warmth: 0.02, saturation: 1.14, contrast: 0.3, split: 0.9, bloom: 0.55,
    },
    dusk: {
      fog: 0x9a7461, density: 0.0045, top: 0x37466a, mid: 0x93787a, horizon: 0xec9058, hemiSky: 0x8a94b8, hemiGround: 0x403024, hemi: 0.55, exposure: 1.08,
      disc: [0.3, 0.018, -0.95], discColor: 0xff7a3a, discI: 1.0, glow: 0.7, cloudLit: 0xff7444, cloudDark: 0x3a3448, cloudCover: 0.56,
      rim: 0xff7a44, rimI: 1.8, env: 0.5, warmth: 0.06, saturation: 1.12, contrast: 0.3, split: 1.2, bloom: 0.65,
    },
  };
  const atm = { ...looks[tod] };
  if (wx === 'overcast' || wx === 'rain') {
    I *= wx === 'rain' ? 0.35 : 0.5;
    atm.fog = wx === 'rain' ? 0x8a8e90 : 0xa4a6a4;
    atm.density *= wx === 'rain' ? 1.6 : 1.25;
    atm.top = 0x7c8288; atm.mid = 0x9ea2a4; atm.horizon = 0xb0b2ae;
    atm.hemi *= 1.5;
    atm.discI = 0; atm.glow = 0;
    atm.cloudCover = 0.96; atm.cloudLit = 0xb8b8b6; atm.cloudDark = 0x6a6e74;
    atm.rimI = (atm.rimI ?? 0) * 0.15;
    atm.saturation = 0.95; atm.split = 0.4; atm.warmth = 0;
  }
  if (wx === 'mist') {
    atm.density *= 2.3;
    atm.fog = 0xc4c4bc;
    atm.cloudCover = 0.7;
    atm.discI = (atm.discI ?? 1) * 0.35;
    atm.rimI = (atm.rimI ?? 0) * 0.5;
    I *= 0.7;
  }
  r.setSun(new THREE.Vector3(...s.dir), s.color, I);
  r.setAtmosphere(atm);
}
