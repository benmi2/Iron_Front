import * as THREE from 'three';
import { fireTexture, glowTexture, smokeTexture } from './Textures';

/**
 * GPU billboard particles: one InstancedBufferGeometry per blend mode. Each particle has
 * position, velocity (integrated on the CPU — counts are a few thousand), size growth, rotation,
 * colour and an alpha curve. Smoke is lit by the sun direction (darker on the shadow side).
 */

export interface ParticleOpts {
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  life: number;
  size: number;
  grow?: number;
  color: THREE.Color | number;
  alpha?: number;
  /** 0 = fade-in/out curve, 1 = immediate start, fade out */
  shape?: 0 | 1;
  drag?: number;
  gravity?: number;
  /** buoyancy (m/s² upward) for hot smoke */
  rise?: number;
  spin?: number;
  /** stretch along velocity (tracers / sparks) */
  stretch?: number;
}

const MAX = 9000;

class Pool {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private aPos: THREE.InstancedBufferAttribute;
  private aCol: THREE.InstancedBufferAttribute;
  private aMisc: THREE.InstancedBufferAttribute;
  private aVel: THREE.InstancedBufferAttribute;
  // CPU state
  private px = new Float32Array(MAX * 3);
  private pv = new Float32Array(MAX * 3);
  private age = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private grow = new Float32Array(MAX);
  private alpha = new Float32Array(MAX);
  private shape = new Uint8Array(MAX);
  private drag = new Float32Array(MAX);
  private grav = new Float32Array(MAX);
  private rise = new Float32Array(MAX);
  private rot = new Float32Array(MAX);
  private spin = new Float32Array(MAX);
  private stretch = new Float32Array(MAX);
  private col = new Float32Array(MAX * 3);
  count = 0;

  constructor(tex: THREE.Texture, additive: boolean, lit: boolean, sunDir: THREE.Vector3) {
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute('uv', quad.getAttribute('uv'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aMisc = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage); // size, rot, stretch
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iCol', this.aCol);
    g.setAttribute('iMisc', this.aMisc);
    g.setAttribute('iVel', this.aVel);
    g.instanceCount = 0;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, sunDir: { value: sunDir }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec3 iPos; attribute vec4 iCol; attribute vec3 iMisc; attribute vec3 iVel;
        varying vec2 vUv; varying vec4 vCol; varying float vFog; varying vec2 vLight;
        uniform float fogDensity;
        void main(){
          vUv = uv; vCol = iCol;
          vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
          float s = iMisc.x; float r = iMisc.y; float st = iMisc.z;
          vec2 p = position.xy;
          if (st > 0.0) {
            // align the long axis with the screen-space velocity
            vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
            vec2 d = normalize(vv.xy + vec2(1e-5));
            float len = s * (1.0 + st);
            p = vec2(p.x * len, p.y * s);
            p = vec2(d.x * p.x - d.y * p.y, d.y * p.x + d.x * p.y);
          } else {
            float c = cos(r), sn = sin(r);
            p = vec2(c * p.x - sn * p.y, sn * p.x + c * p.y) * s;
          }
          mv.xy += p;
          vLight = vec2(cos(r), sin(r));
          gl_Position = projectionMatrix * mv;
          float dist = length(mv.xyz);
          vFog = 1.0 - exp(-fogDensity * fogDensity * dist * dist);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform vec3 fogColor; uniform vec3 sunDir;
        varying vec2 vUv; varying vec4 vCol; varying float vFog; varying vec2 vLight;
        void main(){
          vec4 t = texture2D(map, vUv);
          vec3 c = vCol.rgb * t.rgb;
          ${lit ? `
          // fake volumetric lighting: the side toward the sun is brighter
          vec2 d = vUv - 0.5;
          vec2 sd = normalize(sunDir.xy + vec2(1e-4));
          float l = 0.62 + 0.55 * clamp(dot(d, sd) * 1.6 + 0.35, 0.0, 1.0);
          c *= l;` : ''}
          float a = t.a * vCol.a;
          if (a < 0.003) discard;
          ${additive ? 'gl_FragColor = vec4(c * a, a);' : 'gl_FragColor = vec4(mix(c, fogColor, vFog * 0.85), a);'}
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    if (additive) {
      mat.blending = THREE.CustomBlending;
      mat.blendSrc = THREE.OneFactor;
      mat.blendDst = THREE.OneFactor;
    }
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 10;
  }

  spawn(o: ParticleOpts) {
    if (this.count >= MAX) return;
    const i = this.count++;
    this.px[i * 3] = o.pos.x; this.px[i * 3 + 1] = o.pos.y; this.px[i * 3 + 2] = o.pos.z;
    const v = o.vel;
    this.pv[i * 3] = v ? v.x : 0; this.pv[i * 3 + 1] = v ? v.y : 0; this.pv[i * 3 + 2] = v ? v.z : 0;
    this.age[i] = 0;
    this.life[i] = o.life;
    this.size[i] = o.size;
    this.grow[i] = o.grow ?? 0;
    this.alpha[i] = o.alpha ?? 1;
    this.shape[i] = o.shape ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.grav[i] = o.gravity ?? 0;
    this.rise[i] = o.rise ?? 0;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.spin[i] = o.spin ?? (Math.random() - 0.5) * 0.6;
    this.stretch[i] = o.stretch ?? 0;
    const c = o.color instanceof THREE.Color ? o.color : _c.set(o.color);
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
  }

  update(dt: number, wind: THREE.Vector3) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        n--;
        this.copy(n, i);
        i--;
        continue;
      }
      const k = Math.exp(-this.drag[i] * dt);
      const j = i * 3;
      this.pv[j] = this.pv[j] * k + wind.x * (1 - k);
      this.pv[j + 1] = this.pv[j + 1] * k + (this.rise[i] - this.grav[i]) * dt;
      this.pv[j + 2] = this.pv[j + 2] * k + wind.z * (1 - k);
      this.px[j] += this.pv[j] * dt;
      this.px[j + 1] += this.pv[j + 1] * dt;
      this.px[j + 2] += this.pv[j + 2] * dt;
      this.rot[i] += this.spin[i] * dt;
    }
    this.count = n;
    const P = this.aPos.array as Float32Array, C = this.aCol.array as Float32Array, M = this.aMisc.array as Float32Array, V = this.aVel.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const t = this.age[i] / this.life[i];
      const a = this.shape[i] === 1 ? 1 - t : Math.min(1, t * 6) * (1 - t) * (1 - t) * 1.6;
      P[i * 3] = this.px[i * 3]; P[i * 3 + 1] = this.px[i * 3 + 1]; P[i * 3 + 2] = this.px[i * 3 + 2];
      V[i * 3] = this.pv[i * 3]; V[i * 3 + 1] = this.pv[i * 3 + 1]; V[i * 3 + 2] = this.pv[i * 3 + 2];
      C[i * 4] = this.col[i * 3]; C[i * 4 + 1] = this.col[i * 3 + 1]; C[i * 4 + 2] = this.col[i * 3 + 2];
      C[i * 4 + 3] = Math.max(0, a) * this.alpha[i];
      M[i * 3] = this.size[i] + this.grow[i] * this.age[i];
      M[i * 3 + 1] = this.rot[i];
      M[i * 3 + 2] = this.stretch[i];
    }
    this.geo.instanceCount = n;
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aMisc.needsUpdate = this.aVel.needsUpdate = true;
    this.aPos.addUpdateRange(0, n * 3);
    this.aCol.addUpdateRange(0, n * 4);
    this.aMisc.addUpdateRange(0, n * 3);
    this.aVel.addUpdateRange(0, n * 3);
  }

  private copy(from: number, to: number) {
    for (const arr of [this.px, this.pv, this.col]) {
      arr[to * 3] = arr[from * 3]; arr[to * 3 + 1] = arr[from * 3 + 1]; arr[to * 3 + 2] = arr[from * 3 + 2];
    }
    for (const arr of [this.age, this.life, this.size, this.grow, this.alpha, this.drag, this.grav, this.rise, this.rot, this.spin, this.stretch]) arr[to] = arr[from];
    this.shape[to] = this.shape[from];
  }

  syncFog(fog: THREE.FogExp2 | null) {
    const u = (this.mesh.material as THREE.ShaderMaterial).uniforms;
    if (fog) {
      (u.fogColor.value as THREE.Color).copy(fog.color);
      u.fogDensity.value = fog.density;
    }
  }

  clear() {
    this.count = 0;
    this.geo.instanceCount = 0;
  }
}

const _c = new THREE.Color();

export class Particles {
  readonly smoke: Pool;
  readonly fire: Pool;
  readonly glow: Pool;
  readonly group = new THREE.Group();
  wind = new THREE.Vector3(0.8, 0, -0.3);

  constructor(sunDir: THREE.Vector3) {
    this.smoke = new Pool(smokeTexture(), false, true, sunDir);
    this.fire = new Pool(fireTexture(), true, false, sunDir);
    this.glow = new Pool(glowTexture(), true, false, sunDir);
    this.group.add(this.smoke.mesh, this.fire.mesh, this.glow.mesh);
  }

  update(dt: number, fog: THREE.FogExp2 | null) {
    for (const p of [this.smoke, this.fire, this.glow]) {
      p.update(dt, this.wind);
      p.syncFog(fog);
    }
  }

  clear() {
    this.smoke.clear();
    this.fire.clear();
    this.glow.clear();
  }
}
