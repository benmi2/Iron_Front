import * as THREE from 'three';

/**
 * Painted-steel material with procedural weathering done in OBJECT space (the armour geometry
 * has no UVs): paint mottling, optional disruptive camouflage, dust on upward faces, mud and
 * grime toward the running gear, cast-steel roughness. Inspired by Ballistic Lab's
 * MaterialPatches, rewritten for game LOD.
 */

export interface PaintScheme {
  base: number;
  /** disruptive camo colours (German 1943–44 ambush scheme etc.) */
  camo?: number[];
  camoScale?: number;
  /** relative amount of mud on the lower hull */
  mud?: number;
  dust?: number;
  /** Zimmerit anti-magnetic paste ridges (normal perturbation) */
  zimmerit?: boolean;
}

const NOISE_GLSL = /* glsl */ `
  float wHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float wNoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(wHash(i+vec3(0,0,0)), wHash(i+vec3(1,0,0)), f.x), mix(wHash(i+vec3(0,1,0)), wHash(i+vec3(1,1,0)), f.x), f.y),
               mix(mix(wHash(i+vec3(0,0,1)), wHash(i+vec3(1,0,1)), f.x), mix(wHash(i+vec3(0,1,1)), wHash(i+vec3(1,1,1)), f.x), f.y), f.z); }
  float wFbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * wNoise(p); p *= 2.07; a *= 0.5; } return s; }
`;

export function paintMaterial(scheme: PaintScheme, opts: { rough?: number; metal?: number; cast?: boolean; dark?: number; key?: string } = {}) {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(scheme.base).multiplyScalar(opts.dark ?? 1),
    roughness: opts.rough ?? 0.78,
    metalness: opts.metal ?? 0.12,
  });
  const camo = scheme.camo ?? [];
  const uniforms = {
    camoA: { value: new THREE.Color(camo[0] ?? scheme.base) },
    camoB: { value: new THREE.Color(camo[1] ?? scheme.base) },
    camoOn: { value: camo.length ? 1 : 0 },
    camoScale: { value: scheme.camoScale ?? 0.9 },
    mudAmt: { value: scheme.mud ?? 0.6 },
    dustAmt: { value: scheme.dust ?? 0.5 },
    zimmerit: { value: scheme.zimmerit ? 1 : 0 },
    castOn: { value: opts.cast ? 1 : 0 },
    burnt: { value: 0 },
  };
  m.userData.weather = uniforms;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;\nvarying vec3 vObjN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;\nvObjN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vObj; varying vec3 vObjN;
        uniform vec3 camoA, camoB; uniform float camoOn, camoScale, mudAmt, dustAmt, zimmerit, castOn, burnt;
        ${NOISE_GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 P = vObj;
        float mott = wFbm(P * 3.1);
        diffuseColor.rgb *= 0.86 + 0.26 * mott;
        if (camoOn > 0.5) {
          float c1 = wFbm(P * camoScale + vec3(3.1, 0.0, 7.7));
          float c2 = wFbm(P * camoScale * 1.3 + vec3(11.0, 5.0, 1.0));
          // hand-sprayed edges: soft, slightly mottled
          float eA = smoothstep(0.52, 0.56, c1 + 0.04 * (mott - 0.5));
          float eB = smoothstep(0.55, 0.59, c2 + 0.04 * (mott - 0.5));
          diffuseColor.rgb = mix(diffuseColor.rgb, camoA * (0.9 + 0.2 * mott), eA);
          diffuseColor.rgb = mix(diffuseColor.rgb, camoB * (0.9 + 0.2 * mott), eB * (1.0 - eA * 0.6));
        }
        float up = clamp(vObjN.y, 0.0, 1.0);
        float dust = smoothstep(0.55, 0.95, up) * dustAmt * (0.55 + 0.45 * wFbm(P * 5.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.24, 0.15), dust * 0.5);
        // mud & grime: thicker toward the running gear, splattered pattern
        float low = 1.0 - smoothstep(0.35, 1.35, P.y);
        float splat = smoothstep(0.42, 0.62, wFbm(P * vec3(6.0, 9.0, 6.0)) + low * 0.25);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.055, 0.04, 0.025), clamp(low * mudAmt * (0.35 + 0.65 * splat), 0.0, 0.85));
        // rain streaks / grime down vertical faces
        float vert = 1.0 - abs(vObjN.y);
        float streak = smoothstep(0.6, 0.85, wNoise(vec3(P.x * 14.0, P.y * 1.2, P.z * 14.0)));
        diffuseColor.rgb *= 1.0 - vert * streak * 0.13;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012, 0.01, 0.009) * (0.7 + 0.6 * mott), burnt);
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + 0.12 * (wFbm(vObj * 9.0) - 0.5) + castOn * 0.06, 0.2, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (castOn > 0.5) {
          float e = 0.012;
          float h0 = wFbm(vObj * 22.0);
          vec3 g = vec3(wFbm((vObj + vec3(e,0,0)) * 22.0) - h0, wFbm((vObj + vec3(0,e,0)) * 22.0) - h0, wFbm((vObj + vec3(0,0,e)) * 22.0) - h0);
          normal = normalize(normal - (viewMatrix * vec4(g, 0.0)).xyz * 0.45);
        }
        if (zimmerit > 0.5 && vObj.y < 1.95) {
          // vertical ridges of the trowelled paste, in short horizontal bands
          float band = floor(vObj.y * 11.0);
          float ph = (vObj.x + vObj.z) * 260.0 + band * 1.7 + wNoise(vObj * 30.0) * 2.0;
          float ridge = sin(ph);
          vec3 zg = vec3(cos(ph), 0.0, cos(ph)) * 0.1;
          normal = normalize(normal + (viewMatrix * vec4(zg, 0.0)).xyz * (1.0 - abs(vObjN.y)));
          diffuseColor.rgb *= 0.985 + 0.015 * ridge;
        }`);
  };
  m.customProgramCacheKey = () => `paint-${opts.key ?? ''}-${camo.length}-${scheme.zimmerit ? 1 : 0}-${opts.cast ? 1 : 0}`;
  return m;
}

/** Sherman: US olive drab (FS 33070 family), dusty and muddy from the bocage. */
export const SCHEME_OD: PaintScheme = { base: 0x55573a, mud: 0.75, dust: 0.55 };
/** German 1944 three-tone ambush scheme: Dunkelgelb base with Olivgrün and Rotbraun. */
export const SCHEME_GER_3TONE: PaintScheme = { base: 0xa08f5e, camo: [0x4b5a33, 0x6a4430], camoScale: 0.95, mud: 0.7, dust: 0.45, zimmerit: true };

export function setBurnt(root: THREE.Object3D, amount: number) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const w = (mat as THREE.MeshStandardMaterial).userData?.weather;
      if (w) w.burnt.value = amount;
      else if ((mat as THREE.MeshStandardMaterial).color && !(mat as THREE.Material).userData.noBurn) {
        const sm = mat as THREE.MeshStandardMaterial;
        if (!sm.userData.origColor) sm.userData.origColor = sm.color.clone();
        sm.color.copy(sm.userData.origColor).lerp(new THREE.Color(0x0e0c0a), amount * 0.85);
      }
    }
  });
}
