import * as THREE from 'three';
import type { Renderer } from '../render/Renderer';

export type TimeOfDay = 'morning' | 'noon' | 'evening' | 'dusk';
export type Weather = 'clear' | 'overcast' | 'rain' | 'mist';

/** lighting presets; 'evening' + 'clear' reproduces the warm, hazy look of the reference image */
export function applyAtmosphere(r: Renderer, tod: TimeOfDay, wx: Weather) {
  const sun: Record<TimeOfDay, { dir: [number, number, number]; color: number; I: number }> = {
    morning: { dir: [0.6, 0.32, 0.45], color: 0xffe4c4, I: 2.6 },
    noon: { dir: [0.15, 0.85, 0.35], color: 0xfff4e6, I: 3.2 },
    evening: { dir: [-0.62, 0.36, 0.28], color: 0xffcf96, I: 3.6 },
    dusk: { dir: [-0.8, 0.14, 0.2], color: 0xff9a5a, I: 2.2 },
  };
  const s = sun[tod];
  let I = s.I;
  const atm = {
    morning: { fog: 0xb9bcb8, density: 0.0036, top: 0x7e97b0, mid: 0xc2c6c2, horizon: 0xdcd4c0, hemiSky: 0xc4d0dc, hemiGround: 0x56503e, hemi: 1.0, exposure: 1.0 },
    noon: { fog: 0xb5bcc2, density: 0.0026, top: 0x6a8cb4, mid: 0xaebdcb, horizon: 0xd3d6d2, hemiSky: 0xc8d4e0, hemiGround: 0x5b5240, hemi: 1.1, exposure: 0.95 },
    evening: { fog: 0xaaa494, density: 0.0029, top: 0x5f7fa4, mid: 0x9fb0bf, horizon: 0xd6c4a2, hemiSky: 0xc2cbd6, hemiGround: 0x5b4c38, hemi: 1.0, exposure: 1.08 },
    dusk: { fog: 0x9a7c66, density: 0.005, top: 0x4a5a7a, mid: 0x9a8a80, horizon: 0xe0a070, hemiSky: 0x9aa4c0, hemiGround: 0x4a3a2c, hemi: 0.8, exposure: 1.1 },
  }[tod];
  if (wx === 'overcast' || wx === 'rain') {
    I *= wx === 'rain' ? 0.35 : 0.5;
    atm.fog = wx === 'rain' ? 0x8a8e90 : 0xa4a6a4;
    atm.density *= wx === 'rain' ? 1.6 : 1.25;
    atm.top = 0x7c8288; atm.mid = 0x9ea2a4; atm.horizon = 0xb0b2ae;
    atm.hemi *= 1.15;
  }
  if (wx === 'mist') {
    atm.density *= 2.3;
    atm.fog = 0xc4c4bc;
    I *= 0.7;
  }
  r.setSun(new THREE.Vector3(...s.dir), s.color, I);
  r.setAtmosphere(atm);
}
