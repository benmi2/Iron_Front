import * as THREE from 'three';
import { thicknessColor } from '../ballistics/Materials';
import type { ImpactReport } from '../vehicles/DamageModel';
import type { Frame } from '../vehicles/TankBuilder';

/**
 * X-ray damage replay: the struck vehicle's armour shell coloured by thickness, its interior
 * components coloured by condition, and the traced projectile / spall / jet / burst lines,
 * orbiting slowly. Rendered into a scissored viewport over the battlefield.
 */
export class XRayView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
  private content = new THREE.Group();
  private report: ImpactReport | null = null;
  private t = 0;
  private center = new THREE.Vector3();

  constructor() {
    this.scene.background = new THREE.Color(0x0d1014);
    this.scene.add(new THREE.HemisphereLight(0xb8c4d0, 0x202428, 1.4));
    const d = new THREE.DirectionalLight(0xffffff, 1.6);
    d.position.set(3, 6, 5);
    this.scene.add(d);
    const grid = new THREE.GridHelper(12, 24, 0x2a3440, 0x1a2028);
    this.scene.add(grid);
    this.scene.add(this.content);
  }

  show(r: ImpactReport | null) {
    if (r === this.report) return;
    this.report = r;
    this.content.clear();
    if (!r) return;
    const t = r.target;
    // armour shells of the three frames, in the hull frame
    for (const f of ['hull', 'turret', 'gun'] as Frame[]) {
      const m = t.frameToHull(f, new THREE.Matrix4());
      for (const reg of t.model.armor[f].regions) {
        const pos: number[] = [];
        const col: number[] = [];
        const c = thicknessColor(reg.nominalMm);
        for (const fc of reg.facets) {
          for (const v of [fc.a, fc.b, fc.c]) {
            const p = v.clone().applyMatrix4(m);
            pos.push(p.x, p.y, p.z);
            col.push(c[0], c[1], c[2]);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        g.computeVertexNormals();
        const struck = r.outcome && reg.name === r.outcome.regionName;
        const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
          vertexColors: true, transparent: true, opacity: struck ? 0.55 : reg.auxiliary ? 0.12 : 0.22, side: THREE.DoubleSide, depthWrite: false,
          emissive: struck ? new THREE.Color(0x553311) : new THREE.Color(0), roughness: 0.6,
        }));
        (mesh.material as THREE.MeshStandardMaterial).toneMapped = false;
        this.content.add(mesh);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), new THREE.LineBasicMaterial({ color: 0x8aa0b4, transparent: true, opacity: 0.25 }));
        this.content.add(edges);
      }
    }
    // interior components
    const hitNames = new Set(r.hits.map((h) => h.name));
    for (const c of t.comps) {
      const m = t.frameToHull(c.def.frame, new THREE.Matrix4());
      const box = new THREE.Mesh(new THREE.BoxGeometry(c.def.half.x * 2, c.def.half.y * 2, c.def.half.z * 2), new THREE.MeshStandardMaterial({
        color: compColor(c.def.kind, c.status, c.def.kind === 'crew' ? c.occupant?.state ?? 'dead' : undefined),
        transparent: true, opacity: hitNames.has(c.def.name) ? 0.95 : 0.55, roughness: 0.7,
        emissive: hitNames.has(c.def.name) ? new THREE.Color(0x401000) : new THREE.Color(0),
      }));
      box.position.copy(c.def.center).applyMatrix4(m);
      box.quaternion.setFromRotationMatrix(m);
      this.content.add(box);
    }
    // traced lines
    const colors: Record<string, number> = { shell: 0xffffff, residual: 0xffd23a, spall: 0xff8a2a, jet: 0x4ad8ff, burst: 0xff3aa0, ricochet: 0x9ad0ff };
    for (const l of r.lines) {
      const g = new THREE.BufferGeometry().setFromPoints([l.a, l.b]);
      const mat = new THREE.LineBasicMaterial({ color: colors[l.kind], transparent: true, opacity: l.kind === 'spall' && !l.hit ? 0.35 : 1 });
      this.content.add(new THREE.Line(g, mat));
    }
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
    dot.position.copy(r.entry);
    this.content.add(dot);
    // the normal at the entry point
    this.content.add(new THREE.ArrowHelper(r.normal.clone().normalize(), r.entry, 0.6, 0x60ff90, 0.12, 0.06));
    this.center.set(0, t.model.height * 0.45, 0).lerp(r.entry, 0.35);
    this.t = Math.atan2(-r.inDir.z, -r.inDir.x);
  }

  render(renderer: THREE.WebGLRenderer, rect: DOMRect, dt: number) {
    if (!this.report || rect.width < 10) return;
    this.t += dt * 0.25;
    const R = 7.5;
    this.camera.position.set(this.center.x + Math.cos(this.t) * R, this.center.y + 3.2, this.center.z + Math.sin(this.t) * R);
    this.camera.lookAt(this.center);
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
    const canvas = renderer.domElement;
    const H = canvas.clientHeight;
    const y = H - rect.bottom;
    renderer.setScissorTest(true);
    renderer.setScissor(rect.left, y, rect.width, rect.height);
    renderer.setViewport(rect.left, y, rect.width, rect.height);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
  }
}

function compColor(kind: string, status: string, crewState?: string) {
  if (kind === 'crew') return crewState === 'dead' ? 0xd02020 : crewState === 'wounded' ? 0xf0b030 : crewState === 'bailed' ? 0x606060 : 0x40c060;
  if (status === 'destroyed') return 0xe02a1a;
  if (status === 'damaged') return 0xf0a020;
  const base: Record<string, number> = { ammo: 0xc8b040, fuel: 0x8a4a3a, engine: 0x6a7480, transmission: 0x5a6470, breech: 0x8a8f98, traverse: 0x7090a0, radio: 0x5a8060, optics: 0x60a0c0, structure: 0x404850 };
  return base[kind] ?? 0x6a7a8a;
}
