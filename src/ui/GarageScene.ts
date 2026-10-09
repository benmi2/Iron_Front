import * as THREE from 'three';
import { thicknessColor } from '../ballistics/Materials';
import { TANK_BUILDERS } from '../vehicles/Tank';
import type { TankModel, Frame } from '../vehicles/TankBuilder';
import { Noise2, paintTexture, pixels } from '../render/Paint';

/**
 * Garage / workshop 3-D view: the selected vehicle on a turntable under workshop lights,
 * orbit with the mouse, optional armour-thickness overlay built from the ballistic armour.
 */
export class GarageScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 400);
  private holder = new THREE.Group();
  private model: TankModel | null = null;
  private armourOverlay = new THREE.Group();
  private yaw = -0.7;
  private pitch = 0.22;
  private dist = 11.5;
  private drag: { x: number; y: number } | null = null;
  auto = true;
  current = '';
  armourView = false;

  constructor(private dom: HTMLElement) {
    this.scene.background = new THREE.Color(0x1d1b18);
    this.scene.fog = new THREE.Fog(0x1d1b18, 25, 70);
    const floorTex = paintTexture('concrete', 512, 512, (ctx, w, h) => {
      const n = new Noise2(3, 64);
      pixels(ctx, w, h, (x, y) => {
        const v = 0.42 + 0.18 * n.fbm((x / w) * 8, (y / h) * 8, 5, 8) + (((x % 128) < 2 || (y % 128) < 2) ? -0.12 : 0);
        return [v * 200, v * 192, v * 180];
      });
    }, { repeat: true });
    floorTex.repeat.set(8, 8);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85 }));
    floor.receiveShadow = true;
    this.scene.add(floor);
    const brick = paintTexture('brickwall', 512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#4a3c32';
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 32) for (let x = (y / 32) % 2 ? -32 : 0; x < w; x += 64) {
        const c = 90 + Math.random() * 40;
        ctx.fillStyle = `rgb(${c},${c * 0.62},${c * 0.48})`;
        ctx.fillRect(x + 2, y + 2, 60, 28);
      }
    }, { repeat: true });
    brick.repeat.set(10, 3);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 18), new THREE.MeshStandardMaterial({ map: brick, roughness: 0.95 }));
    wall.position.set(0, 9, -14);
    this.scene.add(wall);
    const turntable = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.4, 0.18, 64), new THREE.MeshStandardMaterial({ color: 0x3a3a38, roughness: 0.5, metalness: 0.6 }));
    turntable.position.y = 0.09;
    turntable.receiveShadow = true;
    this.scene.add(turntable);
    this.holder.position.y = 0.18;
    this.scene.add(this.holder);
    this.scene.add(new THREE.HemisphereLight(0xd8d0c0, 0x2a241e, 0.9));
    const key = new THREE.SpotLight(0xffe2c0, 400, 40, 0.6, 0.5, 1.6);
    key.position.set(6, 12, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    this.scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0x9fb4d0, 1.2);
    rim.position.set(-8, 6, -6);
    this.scene.add(rim);
    // workshop clutter
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x5a4a32, roughness: 0.9 }));
      c.position.set(-9 + (i % 3) * 0.8, 0.25 + Math.floor(i / 3) * 0.5, -10);
      c.castShadow = true;
      this.scene.add(c);
    }
    for (let i = 0; i < 5; i++) {
      const j = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.46, 0.34), new THREE.MeshStandardMaterial({ color: 0x4a5236, roughness: 0.7 }));
      j.position.set(8 + i * 0.22, 0.23, -9);
      this.scene.add(j);
    }
    dom.addEventListener('mousedown', (e) => { if ((e.target as HTMLElement).id === 'gl' || (e.target as HTMLElement).classList.contains('garage-drag')) { this.drag = { x: e.clientX, y: e.clientY }; this.auto = false; } });
    window.addEventListener('mouseup', () => (this.drag = null));
    window.addEventListener('mousemove', (e) => {
      if (!this.drag) return;
      this.yaw += (e.clientX - this.drag.x) * 0.008;
      this.pitch = Math.max(0.02, Math.min(1.2, this.pitch + (e.clientY - this.drag.y) * 0.005));
      this.drag = { x: e.clientX, y: e.clientY };
    });
    dom.addEventListener('wheel', (e) => { this.dist = Math.max(6, Math.min(22, this.dist * (e.deltaY > 0 ? 1.08 : 0.93))); });
  }

  show(vehicleId: string, upgrades: string[]) {
    const key = `${vehicleId}|${upgrades.join(',')}`;
    if (key === this.current) return;
    this.current = key;
    this.holder.clear();
    this.armourOverlay = new THREE.Group();
    const build = TANK_BUILDERS[vehicleId];
    if (!build) return;
    this.model = build(7, vehicleId === 'pz4h' ? '312' : '', new Set(upgrades));
    this.model.turret.rotation.y = 0.25;
    this.model.gun.rotation.z = 0.03;
    this.model.root.updateMatrixWorld(true);
    this.holder.add(this.model.root);
    // armour thickness overlay (outer faces, coloured by nominal thickness)
    const m = this.model;
    for (const f of ['hull', 'turret', 'gun'] as Frame[]) {
      const frameObj = f === 'hull' ? m.hull : f === 'turret' ? m.turret : m.gun;
      for (const reg of m.armor[f].regions) {
        const pos: number[] = [], col: number[] = [];
        const c = thicknessColor(reg.nominalMm);
        for (const fc of reg.facets) for (const v of [fc.a, fc.b, fc.c]) { pos.push(v.x, v.y, v.z); col.push(c[0], c[1], c[2]); }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        g.computeVertexNormals();
        const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide, toneMapped: false }));
        mesh.visible = this.armourView;
        mesh.userData.armour = true;
        frameObj.add(mesh);
      }
    }
    this.setArmourView(this.armourView);
  }

  setArmourView(on: boolean) {
    this.armourView = on;
    this.model?.root.traverse((o) => {
      if (o.userData.armour) o.visible = on;
    });
  }

  update(dt: number, aspect: number) {
    if (this.auto) this.yaw += dt * 0.12;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const c = new THREE.Vector3(0.4, 1.3, 0);
    this.camera.position.set(c.x + Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist, c.y + Math.sin(this.pitch) * this.dist, c.z + Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist);
    this.camera.lookAt(c);
  }
}
