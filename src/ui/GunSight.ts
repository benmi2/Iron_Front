import * as THREE from 'three';

/**
 * Gunner's telescope: a magnified picture-in-picture view from the player's turret toward the
 * locked target, or — while the right mouse button is held — a free telescope steered by the
 * mouse, with a gun marker showing where the barrel is actually laid. Drawn into a scissored
 * viewport with a period-style reticle — US M70 (cross and mil scale) or German TZF 5f
 * (aiming triangles). Lets the player see and engage targets far off the side-view screen.
 */
export class GunSight {
  readonly camera = new THREE.PerspectiveCamera(6, 1.75, 2, 4000);
  readonly frame: HTMLElement;
  private label: HTMLElement;
  private title: HTMLElement;
  private gunMark: HTMLElement;
  active = false;
  manual: boolean | null = null;

  constructor(parent: HTMLElement, german: boolean) {
    this.frame = document.createElement('div');
    this.frame.className = 'gun-sight hidden';
    this.frame.innerHTML = (german ? GERMAN : US) + '<div class="gs-gun"></div><div class="gs-label"></div><div class="gs-title"></div>';
    this.label = this.frame.querySelector('.gs-label') as HTMLElement;
    this.title = this.frame.querySelector('.gs-title') as HTMLElement;
    this.gunMark = this.frame.querySelector('.gs-gun') as HTMLElement;
    parent.appendChild(this.frame);
  }

  /** place the telescope at `eye` looking at `target`; magnification grows with range */
  aim(eye: THREE.Vector3, target: THREE.Vector3, text: string) {
    const d = eye.distanceTo(target);
    const dir = target.clone().sub(eye).normalize();
    // start a few metres forward so our own gun and hull are not in the picture
    this.camera.position.copy(eye).addScaledVector(dir, 4);
    this.camera.lookAt(target);
    // ≈14 m of field at the target, between 3° and 20° — a 3–5× telescope at combat ranges
    const fov = THREE.MathUtils.clamp((2 * Math.atan(7 / Math.max(10, d)) * 180) / Math.PI, 2.2, 20);
    this.camera.fov = fov;
    this.label.textContent = text;
  }

  /** free sight: look from `eye` along `dir` with a fixed field of view (deg) */
  aimDir(eye: THREE.Vector3, dir: THREE.Vector3, fovDeg: number, text: string) {
    this.camera.position.copy(eye).addScaledVector(dir, 4);
    this.camera.lookAt(this.camera.position.clone().add(dir));
    this.camera.fov = fovDeg;
    this.label.textContent = text;
  }

  /** where the gun would put a round right now, drawn as a ring in the sight (null hides it) */
  setGunMark(p: THREE.Vector3 | null, laid: boolean) {
    const m = this.gunMark;
    const rect = this.frame.getBoundingClientRect();
    if (!p || rect.width < 10) {
      m.style.display = 'none';
      return;
    }
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    const v = p.clone().project(this.camera);
    // behind the telescope the projection mirrors: flip it so the ring points the right way
    const back = v.z > 1;
    const x = ((back ? -v.x : v.x) * 0.5 + 0.5) * rect.width, y = (-(back ? -v.y : v.y) * 0.5 + 0.5) * rect.height;
    // off the picture: pin to the edge so the player sees which way the turret is still turning
    const off = back || x < 0 || x > rect.width || y < 0 || y > rect.height;
    m.style.display = 'block';
    m.style.left = `${THREE.MathUtils.clamp(x, 12, rect.width - 12)}px`;
    m.style.top = `${THREE.MathUtils.clamp(y, 12, rect.height - 12)}px`;
    m.classList.toggle('laid', laid && !off);
    m.classList.toggle('off', off);
  }

  show(on: boolean, manual = false) {
    this.active = on;
    this.frame.classList.toggle('hidden', !on);
    if (manual !== this.manual) {
      this.manual = manual;
      this.frame.classList.toggle('manual', manual);
      this.title.textContent = manual ? 'GUNNER\'S SIGHT · mouse traverse · wheel magnification · LMB fire' : 'GUNNER\'S SIGHT · E lock / cycle target · hold RMB for free sight';
    }
  }

  /** screen centre of the sight picture (CSS px) */
  centre() {
    const r = this.frame.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    if (!this.active) return;
    const rect = this.frame.getBoundingClientRect();
    if (rect.width < 10) return;
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
    const H = renderer.domElement.clientHeight;
    const y = H - rect.bottom;
    renderer.setScissorTest(true);
    renderer.setScissor(rect.left, y, rect.width, rect.height);
    renderer.setViewport(rect.left, y, rect.width, rect.height);
    renderer.clearDepth();
    renderer.render(scene, this.camera);
    renderer.setScissorTest(false);
  }

  dispose() {
    this.frame.remove();
  }
}

const US = `<svg class="gs-reticle" viewBox="0 0 400 230" preserveAspectRatio="none">
  <line x1="0" y1="115" x2="170" y2="115" /><line x1="230" y1="115" x2="400" y2="115" />
  <line x1="200" y1="0" x2="200" y2="95" /><line x1="200" y1="135" x2="200" y2="230" />
  ${[-4, -3, -2, -1, 1, 2, 3, 4].map((i) => `<line x1="${200 + i * 22}" y1="110" x2="${200 + i * 22}" y2="120" />`).join('')}
  ${[1, 2, 3, 4].map((i) => `<line x1="194" y1="${115 + i * 18}" x2="206" y2="${115 + i * 18}" />`).join('')}
</svg>`;

const GERMAN = `<svg class="gs-reticle" viewBox="0 0 400 230" preserveAspectRatio="none">
  <polygon points="200,115 190,135 210,135" />
  ${[-3, -2, -1, 1, 2, 3].map((i) => `<polygon points="${200 + i * 40},120 ${193 + i * 40},134 ${207 + i * 40},134" />`).join('')}
  <line x1="0" y1="135" x2="400" y2="135" />
</svg>`;
