import * as THREE from 'three';
import { clamp, damp } from '../core/math';

/**
 * Side-view camera with subtle perspective: it looks across the battlefield from the +Z side,
 * slightly elevated, follows the controlled unit, leads toward where the player is aiming and
 * pulls back when aiming far (right mouse button = binoculars / gunner's sight view).
 */
export class CameraRig {
  focus = new THREE.Vector3();
  private cur = new THREE.Vector3();
  private lookCur = new THREE.Vector3();
  zoom = 1;
  /** framing zoom requested by the game (target lock / incoming fire); the larger of the two wins */
  autoZoom = 1;
  private zoomCur = 1;
  lookAhead = 0;
  private lookAheadCur = 0;
  shake = 0;
  private shakeT = 0;
  /** extra pull-back while the right mouse button is held */
  scope = 0;
  private scopeCur = 0;
  baseDist = 50;
  initialized = false;

  constructor(readonly cam: THREE.PerspectiveCamera) {}

  update(dt: number) {
    this.zoomCur += (Math.max(this.zoom, this.autoZoom) - this.zoomCur) * damp(3, dt);
    this.scopeCur += (this.scope - this.scopeCur) * damp(4, dt);
    this.lookAheadCur += (this.lookAhead - this.lookAheadCur) * damp(3.2, dt);
    const dist = this.baseDist * this.zoomCur * (1 + this.scopeCur * 1.6);
    const tx = this.focus.x + this.lookAheadCur;
    // frame the playable depth band: keep the focus depth partly, bias to the band centre
    const tz = this.focus.z * 0.55 - 3.5;
    // low eye, shallow pitch: the horizon sits about a third of the way down the frame, sky above
    const target = new THREE.Vector3(tx, this.focus.y + 2.0 + dist * 0.05, tz);
    const pos = new THREE.Vector3(tx, this.focus.y + 2.2 + dist * 0.125, tz + dist);
    if (!this.initialized) {
      this.cur.copy(pos);
      this.lookCur.copy(target);
      this.initialized = true;
    }
    this.cur.lerp(pos, damp(6, dt));
    this.lookCur.lerp(target, damp(7, dt));
    this.shakeT += dt;
    this.shake = Math.max(0, this.shake - dt * 1.8);
    const s = Math.min(1.2, this.shake) * 0.35;
    const off = new THREE.Vector3(Math.sin(this.shakeT * 53) * s, Math.sin(this.shakeT * 47 + 1) * s, 0);
    this.cam.position.copy(this.cur).add(off);
    this.cam.lookAt(this.lookCur.clone().add(off.multiplyScalar(0.5)));
  }

  /** current distance multiplier (zoom and binocular pull-back) */
  get effectiveZoom() {
    return this.zoomCur * (1 + this.scopeCur * 1.6);
  }

  setZoomStep(dir: number) {
    this.zoom = clamp(this.zoom * (dir > 0 ? 1.15 : 1 / 1.15), 0.55, 4);
  }

  /** view width at zoom 1 (no scope) */
  get baseWidth() {
    return 2 * this.baseDist * Math.tan((this.cam.fov * Math.PI) / 360) * this.cam.aspect;
  }

  get viewWidth() {
    const dist = this.baseDist * this.zoomCur * (1 + this.scopeCur * 1.6);
    return 2 * dist * Math.tan((this.cam.fov * Math.PI) / 360) * this.cam.aspect;
  }
}
