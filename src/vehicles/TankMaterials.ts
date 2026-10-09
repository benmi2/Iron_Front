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

/** shared per vehicle: inverse of the vehicle root's world matrix, so the weathering knows hull height */
export type RootUniform = { value: THREE.Matrix4 };

export function paintMaterial(scheme: PaintScheme, opts: { rough?: number; metal?: number; cast?: boolean; dark?: number; key?: string; rootInv?: RootUniform; edge?: boolean } = {}) {
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
    rootInv: opts.rootInv ?? { value: new THREE.Matrix4() },
    edgeOn: { value: opts.edge ? 1 : 0 },
  };
  m.userData.weather = uniforms;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;\nvarying vec3 vObjN;\nvarying float vHullY;\nuniform mat4 rootInv;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vObj = position; vObjN = normal;
        #ifdef USE_INSTANCING
          vHullY = (rootInv * modelMatrix * instanceMatrix * vec4(position, 1.0)).y;
        #else
          vHullY = (rootInv * modelMatrix * vec4(position, 1.0)).y;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vObj; varying vec3 vObjN; varying float vHullY;
        uniform vec3 camoA, camoB; uniform float camoOn, camoScale, mudAmt, dustAmt, zimmerit, castOn, burnt, edgeOn;
        float wMud = 0.0, wChip = 0.0;
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
        // sun-faded paint on top surfaces, worn plate edges lighter
        diffuseColor.rgb *= 1.0 + 0.1 * up + edgeOn * 0.35;
        float dust = smoothstep(0.55, 0.95, up) * dustAmt * (0.55 + 0.45 * wFbm(P * 5.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.24, 0.15), dust * 0.5);
        // paint chips: small flecks of primer / bare steel, denser on edges
        float chipN = wFbm(P * 38.0 + vec3(5.3, 1.1, 8.7)) + 0.12 * (wNoise(P * 4.0) - 0.5);
        wChip = smoothstep(0.765 - edgeOn * 0.12, 0.79 - edgeOn * 0.12, chipN) * (1.0 - burnt);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.055, 0.05), wChip * 0.7);
        // mud from the running gear up: wet and dark at the bottom, dried and pale above, splattered edge
        float hy = vHullY;
        float splat = wFbm(P * vec3(5.0, 11.0, 5.0));
        float line = 0.62 + 0.42 * (splat - 0.5) + 0.12 * wNoise(vec3(P.x * 2.0, 0.0, P.z * 2.0));
        float mudF = (1.0 - smoothstep(line - 0.12, line + 0.06, hy)) * mudAmt;
        float spray = smoothstep(0.66, 0.72, wFbm(P * 14.0 + 3.0)) * (1.0 - smoothstep(line, line + 0.55, hy)) * mudAmt;
        float wet = 1.0 - smoothstep(0.22, 0.5, hy);
        vec3 mudC = mix(vec3(0.17, 0.135, 0.09), vec3(0.075, 0.058, 0.04), wet);
        wMud = clamp(max(mudF, spray * 0.7), 0.0, 0.85);
        diffuseColor.rgb = mix(diffuseColor.rgb, mudC * (0.85 + 0.3 * splat), wMud);
        wMud *= wet;
        // rain streaks / grime down vertical faces
        float vert = 1.0 - abs(vObjN.y);
        float streak = smoothstep(0.6, 0.85, wNoise(vec3(P.x * 14.0, P.y * 1.2, P.z * 14.0)));
        diffuseColor.rgb *= 1.0 - vert * streak * 0.13;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012, 0.01, 0.009) * (0.7 + 0.6 * mott), burnt);
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + 0.12 * (wFbm(vObj * 9.0) - 0.5) + castOn * 0.06, 0.2, 1.0);
        roughnessFactor = mix(roughnessFactor, 0.42, wMud * 0.7);
        roughnessFactor = mix(roughnessFactor, 0.45, wChip);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.55, wChip * 0.7);`)
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
  m.customProgramCacheKey = () => `paint2-${opts.key ?? ''}-${camo.length}-${scheme.zimmerit ? 1 : 0}-${opts.cast ? 1 : 0}`;
  return m;
}

/** Sherman: US olive drab (FS 33070 family), dusty and muddy from the bocage. */
export const SCHEME_OD: PaintScheme = { base: 0x5a5c3c, mud: 0.8, dust: 0.55 };
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
