import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * WebGL setup: physically based lights with a low warm sun (Normandy summer evening), atmospheric
 * fog, a painted-gradient sky dome and a light post chain (bloom + filmic grade + vignette + grain)
 * to approach the illustrated look of the reference image.
 */

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    vignette: { value: 0.42 },
    grain: { value: 0.035 },
    warmth: { value: 0.06 },
    desat: { value: 0.12 },
    flash: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float time, vignette, grain, warmth, desat, flash;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(c.rgb, vec3(l), desat);
      c.rgb *= vec3(1.0 + warmth, 1.0 + warmth * 0.35, 1.0 - warmth * 0.6);
      // lift the darks slightly toward a warm brown (illustration feel)
      c.rgb = mix(vec3(0.045, 0.035, 0.028), vec3(1.0), c.rgb);
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d, d) * vignette * 2.2;
      c.rgb *= clamp(v, 0.0, 1.0);
      c.rgb += (hash(vUv * 1024.0 + time) - 0.5) * grain;
      c.rgb += flash * vec3(1.0, 0.85, 0.6);
      gl_FragColor = c;
    }`,
};

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly grade: ShaderPass;
  private renderPass: RenderPass;
  private viewCamera: THREE.PerspectiveCamera;
  private sky: THREE.Mesh;
  /** extra viewports rendered after the main pass (X-ray panel, garage previews) */
  overlays: ((r: THREE.WebGLRenderer) => void)[] = [];
  quality: 'high' | 'medium' = 'high';
  flash = 0;

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.id = 'gl';

    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 4000);
    this.viewCamera = this.camera;

    // atmosphere
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
    this.scene.add(this.sun, this.sun.target);

    this.sky = this.makeSky();
    this.scene.add(this.sky);

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.6, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private makeSky() {
    const g = new THREE.SphereGeometry(3000, 32, 16);
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x6f8aa6) }, mid: { value: new THREE.Color(0xb9b5a8) }, horizon: { value: new THREE.Color(0xd8c3a0) },
        sunDir: { value: new THREE.Vector3(-0.6, 0.35, -0.7).normalize() }, time: { value: 0 },
      },
      vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top, mid, horizon, sunDir; uniform float time; varying vec3 vDir;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=0.5; } return s; }
        void main(){
          float y = clamp(vDir.y, -0.1, 1.0);
          vec3 c = mix(horizon, mid, smoothstep(0.0, 0.05, y));
          c = mix(c, top, smoothstep(0.04, 0.32, y));
          // soft cloud banks
          vec2 uv = vDir.xz / max(0.08, vDir.y + 0.12) * 1.6 + vec2(time * 0.004, 0.0);
          float cl = smoothstep(0.45, 0.85, fbm(uv * 0.6));
          c = mix(c, mix(vec3(0.86, 0.82, 0.76), vec3(0.55, 0.53, 0.52), fbm(uv * 1.3)), cl * 0.55 * smoothstep(0.0, 0.25, y));
          // sun glow
          float s = max(0.0, dot(normalize(vDir), sunDir));
          c += vec3(1.0, 0.75, 0.45) * (pow(s, 24.0) * 0.5 + pow(s, 4.0) * 0.12);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    return mesh;
  }

  /** where the sun shines from (unit vector toward the sun) */
  setSun(dir: THREE.Vector3, color = 0xffdcb0, intensity = 3.1) {
    this.sunDir.copy(dir).normalize();
    this.sun.color.set(color);
    this.sun.intensity = intensity;
    ((this.sky.material as THREE.ShaderMaterial).uniforms.sunDir.value as THREE.Vector3).copy(this.sunDir);
  }
  readonly sunDir = new THREE.Vector3(-0.55, 0.42, 0.3).normalize();

  setAtmosphere(o: { fog: number; density: number; top: number; mid: number; horizon: number; hemiSky: number; hemiGround: number; hemi: number; exposure: number }) {
    const f = this.scene.fog as THREE.FogExp2;
    f.color.set(o.fog);
    f.density = o.density;
    (this.scene.background as THREE.Color).set(o.fog);
    const u = (this.sky.material as THREE.ShaderMaterial).uniforms;
    (u.top.value as THREE.Color).set(o.top);
    (u.mid.value as THREE.Color).set(o.mid);
    (u.horizon.value as THREE.Color).set(o.horizon);
    this.hemi.color.set(o.hemiSky);
    this.hemi.groundColor.set(o.hemiGround);
    this.hemi.intensity = o.hemi;
    this.renderer.toneMappingExposure = o.exposure;
  }

  /** render another scene (garage) or back to the battlefield */
  setView(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.viewCamera = camera;
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
    this.sky.position.copy(this.camera.position);
  }

  render(time: number, dt: number) {
    (this.sky.material as THREE.ShaderMaterial).uniforms.time.value = time;
    this.grade.uniforms.time.value = time % 100;
    this.flash = Math.max(0, this.flash - dt * 6);
    this.grade.uniforms.flash.value = this.flash * 0.25;
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, this.renderer.domElement.width / this.renderer.getPixelRatio(), this.renderer.domElement.height / this.renderer.getPixelRatio());
    this.renderer.clear();
    this.composer.render(dt);
    for (const o of this.overlays) o(this.renderer);
  }
}
