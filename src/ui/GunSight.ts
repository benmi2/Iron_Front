import * as THREE from 'three';

/**
 * Gunner's telescope: a magnified picture-in-picture view from the player's turret toward the
 * locked target (or the aim point while the right mouse button is held), drawn into a scissored
 * viewport with a period-style reticle — US M70 (cross and mil scale) or German TZF 5f
 * (aiming triangles). Lets the player see and engage targets far off the side-view screen.
 */
export class GunSight {
  readonly camera = new THREE.PerspectiveCamera(6, 1.75, 2, 4000);
  readonly frame: HTMLElement;
  private label: HTMLElement;
  active = false;

  constructor(parent: HTMLElement, german: boolean) {
    this.frame = document.createElement('div');
    this.frame.className = 'gun-sight hidden';
    this.frame.innerHTML = (german ? GERMAN : US) + '<div class="gs-label"></div><div class="gs-title">GUNNER\'S SIGHT · E lock / cycle target</div>';
    this.label = this.frame.querySelector('.gs-label') as HTMLElement;
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

  show(on: boolean) {
    this.active = on;
    this.frame.classList.toggle('hidden', !on);
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
