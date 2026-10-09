import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * WebGL setup in the manner of a painted battle scene: a low sun in a sky with lit clouds, a warm
 * key light so the vehicles read clearly, a rim light from the visible sun, image-based reflections
 * of that sky, multisampled scene rendering with depth of field (soft foreground and horizon, sharp
 * playing band), bloom, and a split-tone colour grade with vignette and grain.
 */

/** everything that defines the look of the battlefield for one time of day / weather */
export interface Look {
  fog: number;
  density: number;
  top: number;
  mid: number;
  horizon: number;
  hemiSky: number;
  hemiGround: number;
  hemi: number;
  exposure: number;
  /** direction of the sun disc drawn in the sky (and of the rim light) */
  disc?: [number, number, number];
  discColor?: number;
  /** sun disc brightness; 0 hides it (overcast) */
  discI?: number;
  glow?: number;
  cloudLit?: number;
  cloudDark?: number;
  cloudCover?: number;
  rim?: number;
  rimI?: number;
  /** strength of the sky reflections / ambient from the environment map */
  env?: number;
  warmth?: number;
  desat?: number;
  saturation?: number;
  contrast?: number;
  split?: number;
  bloom?: number;
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    vignette: { value: 0.5 },
    grain: { value: 0.03 },
    warmth: { value: 0.05 },
    desat: { value: 0.0 },
    saturation: { value: 1.12 },
    contrast: { value: 0.28 },
    split: { value: 1.0 },
    flash: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float time, vignette, grain, warmth, desat, saturation, contrast, split, flash;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, saturation * (1.0 - desat));
      c.rgb *= vec3(1.0 + warmth, 1.0 + warmth * 0.35, 1.0 - warmth * 0.6);
      // filmic S-curve
      vec3 s = clamp(c.rgb, 0.0, 1.0);
      c.rgb = mix(c.rgb, s * s * (3.0 - 2.0 * s), contrast);
      // split toning: cool teal shadows, warm amber highlights
      l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb += split * (vec3(-0.018, 0.006, 0.03) * (1.0 - smoothstep(0.0, 0.45, l))
                      + vec3(0.04, 0.012, -0.035) * smoothstep(0.4, 1.0, l));
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d * vec2(1.0, 1.25), d * vec2(1.0, 1.25)) * vignette * 2.0;
      c.rgb *= clamp(v, 0.0, 1.0);
      c.rgb += (hash(vUv * 1024.0 + time) - 0.5) * grain;
      c.rgb += flash * vec3(1.0, 0.85, 0.6);
      gl_FragColor = vec4(c.rgb, 1.0);
    }`,
};

/**
 * Separable depth-of-field blur. Circle of confusion from the scene depth: zero inside the
 * playable depth band, growing in front of it (foreground dressing) and far behind it (horizon).
 * Gather rule: a sample nearer than the pixel spreads by its own CoC (blurred foreground overlaps
 * what is behind it), otherwise by the pixel's CoC (sharp objects do not bleed into the background).
 */
const DofShader = {
  uniforms: {
    tColor: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    dir: { value: new THREE.Vector2(1, 0) },
    texel: { value: new THREE.Vector2(1 / 1600, 1 / 900) },
    cameraNear: { value: 0.5 },
    cameraFar: { value: 4000 },
    focusNear: { value: 30 },
    focusFar: { value: 90 },
    nearRange: { value: 12 },
    farRange: { value: 400 },
    maxNear: { value: 9 },
    maxFar: { value: 2.5 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tColor, tDepth; uniform vec2 dir, texel;
    uniform float cameraNear, cameraFar, focusNear, focusFar, nearRange, farRange, maxNear, maxFar;
    varying vec2 vUv;
    float viewZ(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar); }
    float coc(float z) {
      float n = clamp((focusNear - z) / nearRange, 0.0, 1.0);
      float f = clamp((z - focusFar) / farRange, 0.0, 1.0);
      return max(n * maxNear, f * maxFar);
    }
    void main() {
      float zc = viewZ(vUv);
      float cc = coc(zc);
      // widen the search for blurred foreground that may overlap this pixel
      float r = cc;
      for (int i = 1; i <= 3; i++) {
        float o = float(i) * maxNear / 3.0;
        float zl = viewZ(vUv - dir * texel * o), zr = viewZ(vUv + dir * texel * o);
        if (zl < zc) r = max(r, min(coc(zl), o + 1.0));
        if (zr < zc) r = max(r, min(coc(zr), o + 1.0));
      }
      vec4 acc = vec4(0.0);
      for (int i = -6; i <= 6; i++) {
        float o = float(i) / 6.0 * r;
        vec2 uv = vUv + dir * texel * o;
        float zs = viewZ(uv);
        float cs = coc(zs);
        float reach = zs < zc - 0.05 ? cs : cc;
        float w = clamp(reach - abs(o) + 1.0, 0.0, 1.0) * exp(-float(i * i) / 18.0);
        acc += vec4(texture2D(tColor, uv).rgb * w, w);
      }
      gl_FragColor = vec4(acc.rgb / max(acc.a, 1e-4), 1.0);
    }`,
};

/** renders the scene multisampled with a depth texture, then (optionally) applies depth of field */
class SceneDofPass extends Pass {
  readonly sceneRT: THREE.WebGLRenderTarget;
  private tmpRT: THREE.WebGLRenderTarget;
  private quad: FullScreenQuad;
  readonly material: THREE.ShaderMaterial;
  private copy: FullScreenQuad;
  dof = true;

  constructor(public scene: THREE.Scene, public camera: THREE.PerspectiveCamera) {
    super();
    this.needsSwap = false;
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.sceneRT.depthTexture = new THREE.DepthTexture(1, 1);
    this.tmpRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.material = new THREE.ShaderMaterial({ ...DofShader, uniforms: THREE.UniformsUtils.clone(DofShader.uniforms), depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(this.material);
    this.copy = new FullScreenQuad(new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false }));
  }

  setSize(w: number, h: number) {
    this.sceneRT.setSize(w, h);
    this.tmpRT.setSize(w, h);
    (this.material.uniforms.texel.value as THREE.Vector2).set(1 / w, 1 / h);
    // blur radii are specified for a 900-pixel-high frame
    this.pxScale = h / 900;
  }
  private pxScale = 1;
  nearPx = 13;
  farPx = 2.4;

  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    renderer.setRenderTarget(this.sceneRT);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    if (!this.dof) {
      (this.copy.material as THREE.MeshBasicMaterial).map = this.sceneRT.texture;
      renderer.setRenderTarget(read);
      this.copy.render(renderer);
      return;
    }
    const u = this.material.uniforms;
    u.tDepth.value = this.sceneRT.depthTexture;
    u.cameraNear.value = this.camera.near;
    u.cameraFar.value = this.camera.far;
    u.maxNear.value = this.nearPx * this.pxScale;
    u.maxFar.value = this.farPx * this.pxScale;
    u.tColor.value = this.sceneRT.texture;
    (u.dir.value as THREE.Vector2).set(1, 0);
    renderer.setRenderTarget(this.tmpRT);
    this.quad.render(renderer);
    u.tColor.value = this.tmpRT.texture;
    (u.dir.value as THREE.Vector2).set(0, 1);
    renderer.setRenderTarget(read);
    this.quad.render(renderer);
  }
}

const SKY_FRAG = /* glsl */ `
  uniform vec3 top, mid, horizon, ground, disc, discColor, cloudLit, cloudDark;
  uniform float time, discI, glow, cloudCover, stretch;
  varying vec3 vDir;
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
  float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
  float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<6;i++){ s+=a*n(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }
  void main(){
    // The side-view camera only sees the lowest ~12 degrees of sky. The dome is stretched vertically
    // so the cloudscape of a ~25-degree view fits into it; the sun disc keeps its true direction.
    vec3 d0 = normalize(vDir);
    vec3 d = normalize(vec3(d0.x, d0.y * stretch, d0.z));
    float y = d.y;
    float sunDot = max(0.0, dot(d0, disc));
    // azimuthal closeness to the sun: the horizon burns brighter on the sun's side
    float az = max(0.0, dot(normalize(d.xz + 1e-4), normalize(disc.xz + 1e-4)));
    // the visible sky is only ~12 degrees tall in the side view: the gradient is compressed into it
    vec3 hz = mix(horizon * 0.7, horizon * 1.05 + discColor * 0.08, pow(az, 4.0));
    vec3 c = mix(hz, mid, smoothstep(0.0, 0.12, y));
    c = mix(c, top, smoothstep(0.08, 0.42, y));
    // cloud deck: streaky stratocumulus projected on a plane, thinning to haze at the horizon
    vec2 uv = d.xz / max(0.03, y + 0.05);
    uv.x *= 0.45;
    uv += vec2(time * 0.006, 0.0);
    float base = fbm(uv * 0.9);
    float dens = smoothstep(1.0 - cloudCover, 1.0 - cloudCover + 0.22, base + 0.22 * (fbm(uv * 3.1) - 0.5));
    // self-shadowing: denser toward the sun -> darker core, thin edges glow
    vec2 toSun = normalize(disc.xz + 1e-4) * 0.05 + vec2(0.0, 0.0);
    float baseS = fbm((uv + vec2(0.0, -0.35)) * 0.9);
    float lit = clamp(0.5 + (base - baseS) * 4.0, 0.0, 1.0);
    // the whole visible sky lies within ~40 degrees of the low sun: light the cloud by that angle.
    // Cloud bodies stay dark against the sky; their sun-facing undersides and edges catch the light.
    float facing = pow(sunDot, 7.0);
    float under = 1.0 - smoothstep(0.0, 0.12, y);
    float rimL = smoothstep(0.45, 0.9, lit);
    vec3 cc = cloudDark * (0.7 + 0.6 * facing) + cloudLit * (rimL * (0.18 + 1.0 * facing) + under * 0.3 * facing);
    // silver lining: thin cloud edges near the sun glow
    cc += discColor * discI * pow(sunDot, 60.0) * (1.0 - dens) * 3.0;
    float above = smoothstep(-0.01, 0.04, y);
    float a = dens * above;
    c = mix(c, cc, a);
    // sun disc and its glow, dimmed where the clouds cover it
    float discMask = smoothstep(0.99962, 0.99978, sunDot);
    c += discColor * discI * (discMask * 16.0 * (1.0 - a * 0.6) + pow(sunDot, 1800.0) * 2.2 * (1.0 - a * 0.4) + pow(sunDot, 24.0) * glow);
    // below the horizon: dark ground for reflections
    c = mix(ground, c, smoothstep(-0.06, 0.0, y));
    gl_FragColor = vec4(c, 1.0);
  }`;

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** key light (casts the shadows) */
  readonly sun: THREE.DirectionalLight;
  /** back light from the visible sun: warm edges and silhouettes */
  readonly rim: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly grade: ShaderPass;
  private scenePass: SceneDofPass;
  private viewCamera: THREE.PerspectiveCamera;
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private roomEnv: THREE.Texture | null = null;
  /** extra viewports rendered after the main pass (X-ray panel, garage previews) */
  overlays: ((r: THREE.WebGLRenderer) => void)[] = [];
  quality: 'high' | 'medium' = 'high';
  flash = 0;

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.id = 'gl';
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 4000);
    this.viewCamera = this.camera;

    const fogColor = new THREE.Color(0xb7ab96);
    this.scene.fog = new THREE.FogExp2(fogColor, 0.0042);
    this.scene.background = fogColor.clone();

    this.hemi = new THREE.HemisphereLight(0xc2cbd6, 0x5b4c38, 1.05);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffdcb0, 3.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 2;
    this.scene.add(this.sun, this.sun.target);
    this.rim = new THREE.DirectionalLight(0xffa864, 0);
    this.scene.add(this.rim, this.rim.target);

    this.skyMat = this.makeSkyMaterial();
    this.sky = this.makeSkyMesh();
    this.scene.add(this.sky);

    this.composer = new EffectComposer(this.renderer);
    this.scenePass = new SceneDofPass(this.scene, this.camera);
    this.composer.addPass(this.scenePass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.5, 0.4, 1.35);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private makeSkyMaterial() {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x6f8aa6) }, mid: { value: new THREE.Color(0xb9b5a8) }, horizon: { value: new THREE.Color(0xd8c3a0) },
        ground: { value: new THREE.Color(0x3a3226) },
        disc: { value: new THREE.Vector3(0.28, 0.07, -0.96).normalize() }, discColor: { value: new THREE.Color(0xffb060) },
        discI: { value: 1 }, glow: { value: 0.35 },
        cloudLit: { value: new THREE.Color(0xf0a868) }, cloudDark: { value: new THREE.Color(0x5a5560) }, cloudCover: { value: 0.45 },
        time: { value: 0 }, stretch: { value: 2.1 },
      },
      vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
      fragmentShader: SKY_FRAG,
    });
  }

  private makeSkyMesh() {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), this.skyMat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    return mesh;
  }

  /** where the key light shines from (unit vector toward the light) */
  setSun(dir: THREE.Vector3, color = 0xffdcb0, intensity = 3.1) {
    this.sunDir.copy(dir).normalize();
    this.sun.color.set(color);
    this.sun.intensity = intensity;
  }
  readonly sunDir = new THREE.Vector3(-0.55, 0.42, 0.3).normalize();
  /** fog density of the current look (the session thins it when the camera pulls back) */
  baseFogDensity = 0.003;
  readonly discDir = new THREE.Vector3(0.28, 0.07, -0.96).normalize();

  setAtmosphere(o: Look) {
    const f = this.scene.fog as THREE.FogExp2;
    f.color.set(o.fog);
    f.density = o.density;
    this.baseFogDensity = o.density;
    (this.scene.background as THREE.Color).set(o.fog);
    const u = this.skyMat.uniforms;
    (u.top.value as THREE.Color).set(o.top);
    (u.mid.value as THREE.Color).set(o.mid);
    (u.horizon.value as THREE.Color).set(o.horizon);
    (u.ground.value as THREE.Color).set(o.hemiGround).multiplyScalar(0.6);
    if (o.disc) this.discDir.set(...o.disc).normalize();
    (u.disc.value as THREE.Vector3).copy(this.discDir);
    (u.discColor.value as THREE.Color).set(o.discColor ?? 0xffc890);
    u.discI.value = o.discI ?? 0.6;
    u.glow.value = o.glow ?? 0.2;
    (u.cloudLit.value as THREE.Color).set(o.cloudLit ?? 0xe8ddd0);
    (u.cloudDark.value as THREE.Color).set(o.cloudDark ?? 0x8a8a90);
    u.cloudCover.value = o.cloudCover ?? 0.4;
    this.hemi.color.set(o.hemiSky);
    this.hemi.groundColor.set(o.hemiGround);
    this.hemi.intensity = o.hemi;
    this.rim.color.set(o.rim ?? 0xffc890);
    this.rim.intensity = o.rimI ?? 0;
    this.renderer.toneMappingExposure = o.exposure;
    const g = this.grade.uniforms;
    g.warmth.value = o.warmth ?? 0.05;
    g.desat.value = o.desat ?? 0;
    g.saturation.value = o.saturation ?? 1.1;
    g.contrast.value = o.contrast ?? 0.25;
    g.split.value = o.split ?? 1;
    this.bloom.strength = o.bloom ?? 0.5;
    this.updateEnvironment(o.env ?? 0.5);
  }

  /** bake the current sky into a prefiltered environment map: reflections on paint, metal, puddles */
  private updateEnvironment(intensity: number) {
    const envScene = new THREE.Scene();
    const m = new THREE.Mesh(this.sky.geometry, this.skyMat);
    envScene.add(m);
    // the disc itself would put a pin-point glare on every rough surface: bake it dimmed
    const u = this.skyMat.uniforms;
    const discI = u.discI.value;
    u.discI.value = discI * 0.12;
    // reflections see the true (unstretched) sky: puddles mirror the warm horizon, not the zenith
    u.stretch.value = 1;
    const rt = this.pmrem.fromScene(envScene, 0, 1, 5000);
    u.discI.value = discI;
    u.stretch.value = 2.1;
    this.envRT?.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = intensity;
  }

  /**
   * Depth of field for the battlefield: the depth band [nearZ, farZ] (world z) stays sharp around
   * the point the camera looks at; the foreground in front and the horizon behind soften.
   */
  setFocusBand(x: number, y: number, nearZ: number, farZ: number) {
    const cam = this.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const depth = (z: number) => new THREE.Vector3(x, y, z).sub(cam.position).dot(fwd);
    const u = this.scenePass.material.uniforms;
    u.focusNear.value = depth(nearZ);
    u.focusFar.value = depth(farZ);
    u.nearRange.value = 10;
    u.farRange.value = 420;
  }

  /** 'high': depth of field, 4K shadows, up to 1.5x pixel density; 'medium': 1x pixels, 2K shadows, no depth of field */
  setQuality(q: 'high' | 'medium') {
    this.quality = q;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(window.devicePixelRatio, 1.5) : 1);
    this.sun.shadow.mapSize.set(q === 'high' ? 4096 : 2048, q === 'high' ? 2048 : 1024);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.scenePass.dof = q === 'high' && this.scenePass.scene === this.scene;
    this.resize();
  }

  /** render another scene (garage) or back to the battlefield */
  setView(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scenePass.scene = scene;
    this.scenePass.camera = camera;
    this.scenePass.dof = scene === this.scene && this.quality === 'high';
    this.viewCamera = camera;
    if (scene !== this.scene && !scene.environment) {
      this.roomEnv ??= this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = this.roomEnv;
      scene.environmentIntensity = 0.45;
    }
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    for (const c of [this.camera, this.viewCamera]) {
      c.aspect = w / h;
      c.updateProjectionMatrix();
    }
  }

  /** keep the shadow frustum centred on what the camera is looking at */
  followShadow(center: THREE.Vector3, span: number) {
    const s = this.sun.shadow.camera;
    const half = Math.max(40, span * 0.62);
    if (Math.abs(s.right - half) > 2) {
      s.left = -half; s.right = half; s.top = half * 0.6; s.bottom = -half * 0.6;
      s.updateProjectionMatrix();
    }
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(this.sunDir, 160);
    this.rim.target.position.copy(center);
    this.rim.position.copy(center).addScaledVector(this.discDir, 160);
    this.sky.position.copy(this.camera.position);
  }

  render(time: number, dt: number) {
    this.skyMat.uniforms.time.value = time;
    this.grade.uniforms.time.value = time % 100;
    this.flash = Math.max(0, this.flash - dt * 6);
    this.grade.uniforms.flash.value = this.flash * 0.25;
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, this.renderer.domElement.width / this.renderer.getPixelRatio(), this.renderer.domElement.height / this.renderer.getPixelRatio());
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    this.composer.render(dt);
    for (const o of this.overlays) o(this.renderer);
  }
}
