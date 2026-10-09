import * as THREE from 'three';
import { convexHull2D } from '../core/math';
import { ArmorSet, flatPlate, loftShell, type ArmorGroup, type ArmorRegion, type ArmorRegionOptions, type V3 } from '../ballistics/ArmorMesh';
import { paintMaterial, type PaintScheme } from './TankMaterials';
import type { CrewRole } from '../data/vehicles';

/**
 * Builds a tank in THREE frames — hull, turret (rotates about the ring centre) and gun
 * (elevates about the trunnions) — each with its own ballistic ArmorSet, visual group and
 * interior components. All coordinates are given in the HULL frame of the drawings
 * (+X front, +Y up, +Z right, ground at y = 0, as in Ballistic Armour Lab) and converted to the
 * active frame, so stations from the Lab models can be reused unchanged.
 */

export type Frame = 'hull' | 'turret' | 'gun';

export type CompKind = 'crew' | 'ammo' | 'fuel' | 'engine' | 'transmission' | 'breech' | 'traverse' | 'radio' | 'optics' | 'structure';

export interface CompDef {
  name: string;
  kind: CompKind;
  frame: Frame;
  /** frame-local box centre / half size */
  center: THREE.Vector3;
  half: THREE.Vector3;
  role?: CrewRole;
  /** wet (water-jacketed) ammunition stowage */
  wet?: boolean;
  /** rounds held (ammo racks) */
  rounds?: number;
  /** ready rack (loader reaches it without digging) */
  ready?: boolean;
  /** fraction of passing fragment energy absorbed */
  absorb: number;
  /** [damaged, destroyed] accumulated energy thresholds (J) */
  thresholds: [number, number];
}

/** External parts a shell can strike before (or instead of) the armour. */
export interface ExternalPart {
  name: string;
  kind: 'track' | 'barrel' | 'wheels';
  frame: Frame;
  center: THREE.Vector3;
  half: THREE.Vector3;
  side?: -1 | 1;
  /** RHA-equivalent mm a KE shell loses crossing it */
  absorbMm: number;
}

export interface TrackRun {
  side: -1 | 1;
  mesh: THREE.InstancedMesh;
  extras: THREE.InstancedMesh[];
  /** path samples (x,y) and cumulative length */
  path: [number, number][];
  cum: number[];
  total: number;
  z: number;
  thickness: number;
  width: number;
  pitch: number;
  n: number;
  offset: number;
  style: 'chevron' | 'plain' | 'cleat';
}

export interface Wheel {
  obj: THREE.Object3D;
  radius: number;
  side: -1 | 1;
}

export interface TankModel {
  root: THREE.Group;
  hull: THREE.Group;
  turret: THREE.Group;
  gun: THREE.Group;
  /** recoiling barrel group (child of gun) */
  barrel: THREE.Group;
  armor: Record<Frame, ArmorSet>;
  /** turret ring centre and trunnion in hull coordinates */
  turretPivot: THREE.Vector3;
  trunnion: THREE.Vector3;
  /** muzzle in GUN frame */
  muzzle: THREE.Vector3;
  components: CompDef[];
  external: ExternalPart[];
  tracks: TrackRun[];
  wheels: Wheel[];
  /** exhaust outlets (hull frame) */
  exhausts: THREE.Vector3[];
  /** commander's head when unbuttoned (turret frame) */
  commanderHatch: THREE.Vector3;
  /** footprint (hull frame): half length / half width for collision */
  halfLength: number;
  halfWidth: number;
  height: number;
  /** materials owned by this instance (for burn tint / dispose) */
  materials: THREE.Material[];
  /** coax / bow MG muzzles */
  coax: THREE.Vector3;
  bow: THREE.Vector3 | null;
  /** hatch lids that open when the crew bails out */
  hatches: THREE.Object3D[];
}

export class TankBuilder {
  readonly root = new THREE.Group();
  readonly groups: Record<Frame, THREE.Group> = { hull: new THREE.Group(), turret: new THREE.Group(), gun: new THREE.Group() };
  readonly barrelGroup = new THREE.Group();
  readonly armor: Record<Frame, ArmorSet> = { hull: new ArmorSet(), turret: new ArmorSet(), gun: new ArmorSet() };
  readonly components: CompDef[] = [];
  readonly external: ExternalPart[] = [];
  readonly tracks: TrackRun[] = [];
  readonly wheels: Wheel[] = [];
  readonly exhausts: THREE.Vector3[] = [];
  readonly hatches: THREE.Object3D[] = [];
  readonly mats: Record<string, THREE.MeshStandardMaterial> = {};
  private armorMats: Record<string, THREE.MeshStandardMaterial> = {};
  frame: Frame = 'hull';
  hullInside: V3 = [0, 1.0, 0];
  turretInside: V3 = [0, 2.2, 0];
  muzzle = new THREE.Vector3();
  coax = new THREE.Vector3();
  bow: THREE.Vector3 | null = null;
  commanderHatch = new THREE.Vector3();

  constructor(readonly turretPivot: THREE.Vector3, readonly trunnion: THREE.Vector3, readonly scheme: PaintScheme) {
    const { hull, turret, gun } = this.groups;
    this.root.add(hull);
    hull.add(turret);
    turret.position.copy(turretPivot);
    turret.add(gun);
    gun.position.copy(trunnion).sub(turretPivot);
    gun.add(this.barrelGroup);
    turret.userData.frame = gun.userData.frame = this.barrelGroup.userData.frame = true;
    hull.name = 'hull';
    turret.name = 'turret';
    gun.name = 'gun';
    const mk = (key: string, color: number, rough = 0.8, metal = 0.1) => {
      this.mats[key] = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    };
    this.mats.paint = paintMaterial(scheme, { key: 'p' });
    this.mats.paintDark = paintMaterial(scheme, { dark: 0.72, key: 'pd' });
    this.armorMats.RHA = this.mats.paint;
    this.armorMats.CHA = paintMaterial(scheme, { cast: true, rough: 0.86, key: 'c' });
    this.armorMats.MILD = this.mats.paint;
    mk('steel', 0x6c7074, 0.55, 0.45);
    mk('darkSteel', 0x3a3c3e, 0.62, 0.45);
    mk('rubber', 0x1d1e1f, 0.95, 0.0);
    mk('track', 0x4a443c, 0.85, 0.35);
    mk('glass', 0x23313a, 0.15, 0.6);
    mk('lamp', 0xd9d4c0, 0.3, 0.2);
    mk('wood', 0x6b5236, 0.9, 0.0);
    mk('canvas', 0x5d5a44, 1.0, 0.0);
    mk('rust', 0x5a3a26, 0.95, 0.2);
    mk('muffler', 0x4a3524, 0.9, 0.35);
    this.mats.wheelPaint = paintMaterial({ ...scheme, mud: Math.min(1, (scheme.mud ?? 0.6) * 1.5) }, { key: 'w' });
  }

  /* ------------------------------------------------------------------ frames */

  setFrame(f: Frame) {
    this.frame = f;
    return this;
  }

  private offset(f = this.frame) {
    return f === 'hull' ? new THREE.Vector3() : f === 'turret' ? this.turretPivot : this.trunnion;
  }

  /** hull-frame point → active-frame point */
  P(p: V3, f = this.frame): V3 {
    const o = this.offset(f);
    return [p[0] - o.x, p[1] - o.y, p[2] - o.z];
  }

  V(p: V3, f = this.frame) {
    const q = this.P(p, f);
    return new THREE.Vector3(q[0], q[1], q[2]);
  }

  private get group() {
    return this.groups[this.frame];
  }

  /* ------------------------------------------------------------------ armour */

  plate(name: string, group: ArmorGroup, material: string, mm: number, outer: V3[], inside?: V3, angleNote?: string, extra: Partial<ArmorRegionOptions> = {}): ArmorRegion {
    const ins = inside ?? (this.frame === 'hull' ? this.hullInside : this.turretInside);
    return flatPlate(this.armor[this.frame], { name, group, material, nominalMm: mm, angleNote, ...extra }, outer.map((p) => this.P(p)), this.P(ins));
  }

  platePair(base: string, group: ArmorGroup, material: string, mm: number, outerRight: V3[], inside?: V3, angleNote?: string, extra: Partial<ArmorRegionOptions> = {}) {
    const mirror = (p: V3): V3 => [p[0], p[1], -p[2]];
    const r = this.plate(`${base} (right)`, group, material, mm, outerRight, inside, angleNote, extra);
    const l = this.plate(`${base} (left)`, group, material, mm, outerRight.map(mirror), inside ? mirror(inside) : undefined, angleNote, extra);
    return { left: l, right: r };
  }

  loft(rings: V3[][], inside: V3, defs: Record<string, ArmorRegionOptions>, classify: (c: THREE.Vector3, n: THREE.Vector3) => string, thickness: (p: THREE.Vector3, n: THREE.Vector3) => number, closed = true) {
    const o = this.offset();
    // classify / thickness callbacks receive HULL-frame points (as in the Lab models)
    const back = (p: THREE.Vector3) => p.clone().add(o);
    return loftShell(this.armor[this.frame], rings.map((r) => r.map((p) => this.P(p))), this.P(inside), defs, (c, n) => classify(back(c), n), (p, n) => thickness(back(p), n), closed);
  }

  sweptProfile(profile: [number, number][], halfWidth: number, zSteps: number, round: (zAbs: number, y: number) => number, inside: V3,
    defs: Record<string, ArmorRegionOptions>, classify: (c: THREE.Vector3, n: THREE.Vector3) => string, thickness: (p: THREE.Vector3, n: THREE.Vector3) => number) {
    const rings: V3[][] = [];
    for (let i = 0; i <= zSteps; i++) {
      const z = -halfWidth + (2 * halfWidth * i) / zSteps;
      rings.push(profile.map(([x, y]) => [x - round(Math.abs(z), y), y, z] as V3));
    }
    return this.loft(rings, inside, defs, classify, thickness, false);
  }

  /* ------------------------------------------------------------------ components */

  component(name: string, kind: CompKind, center: V3, size: V3, o: Partial<CompDef> = {}) {
    const defaults: Record<CompKind, { absorb: number; thresholds: [number, number] }> = {
      crew: { absorb: 0.35, thresholds: [160, 650] },
      ammo: { absorb: 0.7, thresholds: [250, 1500] },
      fuel: { absorb: 0.5, thresholds: [200, 1500] },
      engine: { absorb: 0.9, thresholds: [3000, 14000] },
      transmission: { absorb: 0.9, thresholds: [2500, 12000] },
      breech: { absorb: 0.95, thresholds: [2500, 12000] },
      traverse: { absorb: 0.8, thresholds: [900, 5000] },
      radio: { absorb: 0.6, thresholds: [200, 1200] },
      optics: { absorb: 0.4, thresholds: [80, 500] },
      structure: { absorb: 0.85, thresholds: [1e9, 1e9] },
    };
    this.components.push({
      name, kind, frame: this.frame, center: this.V(center), half: new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2),
      ...defaults[kind], ...o,
    });
  }

  crew(role: CrewRole, name: string, seat: V3, posture: 'seated' | 'standing' = 'seated') {
    // torso + head volume of a seated / standing crewman
    const h = posture === 'seated' ? 0.85 : 1.15;
    this.component(name, 'crew', [seat[0], seat[1] + h / 2 - 0.1, seat[2]], [0.42, h, 0.42], { role });
  }

  externalPart(name: string, kind: ExternalPart['kind'], center: V3, size: V3, absorbMm: number, side?: -1 | 1) {
    this.external.push({ name, kind, frame: this.frame, center: this.V(center), half: new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2), absorbMm, side });
  }

  /* ------------------------------------------------------------------ visual helpers (hull-frame coordinates) */

  add<T extends THREE.Object3D>(o: T, parent: THREE.Object3D = this.group): T {
    parent.add(o);
    return o;
  }

  private placed(mesh: THREE.Object3D, pos: V3) {
    const p = this.P(pos);
    mesh.position.set(p[0], p[1], p[2]);
    return mesh;
  }

  box(size: V3, pos: V3, mat = 'paint', rot?: V3) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), this.mats[mat]);
    this.placed(mesh, pos);
    if (rot) mesh.rotation.set(...rot);
    return this.add(mesh);
  }

  cyl(r0: number, r1: number, len: number, pos: V3, axis: 'x' | 'y' | 'z', mat = 'paint', seg = 20) {
    const g = new THREE.CylinderGeometry(r1, r0, len, seg);
    if (axis === 'x') g.rotateZ(-Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(g, this.mats[mat]);
    this.placed(mesh, pos);
    return this.add(mesh);
  }

  sphere(r: number, pos: V3, mat = 'paint', scale?: V3) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 10), this.mats[mat]);
    this.placed(mesh, pos);
    if (scale) mesh.scale.set(...scale);
    return this.add(mesh);
  }

  /** extrude a side-view polygon (x,y in hull frame) between z0 and z1 */
  extrudeSide(poly: [number, number][], z0: number, z1: number, mat = 'paint') {
    const o = this.offset();
    const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x - o.x, y - o.y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false });
    g.translate(0, 0, z0 - o.z);
    return this.add(new THREE.Mesh(g, this.mats[mat]));
  }

  /** extrude a plan-view polygon (x,z) between y0 and y1 */
  extrudePlan(poly: [number, number][], y0: number, y1: number, mat = 'paint') {
    const o = this.offset();
    const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x - o.x, -(z - o.z))));
    const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, y0 - o.y, 0);
    return this.add(new THREE.Mesh(g, this.mats[mat]));
  }

  lathe(profile: [number, number][], pos: V3, axis: 'x' | 'y' | 'z', mat = 'paint', seg = 24) {
    const g = new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), seg);
    if (axis === 'x') g.rotateZ(-Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(g, this.mats[mat]);
    this.placed(mesh, pos);
    return this.add(mesh);
  }

  /** Road wheel (tyre + disc + hub); animated (rotates with travel). */
  wheel(x: number, y: number, z: number, radius: number, width: number, style: 'pressed' | 'dished' | 'spoked' | 'steel' = 'pressed', outward = 1, animate = true) {
    const g = new THREE.Group();
    this.placed(g, [x, y, z]);
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 26).rotateX(Math.PI / 2), this.mats[style === 'steel' ? 'darkSteel' : 'rubber']);
    tyre.castShadow = true;
    g.add(tyre);
    const discR = style === 'steel' ? radius * 0.97 : radius * 0.84;
    const prof: [number, number][] = style === 'dished'
      ? [[0.001, width * 0.62], [radius * 0.18, width * 0.62], [radius * 0.28, width * 0.45], [discR * 0.8, width * 0.25], [discR, width * 0.52], [discR, -width * 0.5], [0.001, -width * 0.5]]
      : [[0.001, width * 0.58], [radius * 0.2, width * 0.58], [radius * 0.25, width * 0.5], [discR, width * 0.52], [discR, -width * 0.5], [0.001, -width * 0.5]];
    const disc = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([r, h]) => new THREE.Vector2(r, h * outward)), 26).rotateX(Math.PI / 2), this.mats.wheelPaint);
    disc.castShadow = true;
    g.add(disc);
    if (style === 'spoked' || style === 'pressed') {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const hole = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.11, radius * 0.11, width * 1.06, 8).rotateX(Math.PI / 2), this.mats.darkSteel);
        hole.position.set(Math.cos(a) * radius * 0.52, Math.sin(a) * radius * 0.52, 0);
        g.add(hole);
      }
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.17, radius * 0.2, width * 1.25, 12).rotateX(Math.PI / 2), this.mats.darkSteel);
    g.add(hub);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.025, radius * 0.025, width * 1.32, 5).rotateX(Math.PI / 2), this.mats.steel);
      bolt.position.set(Math.cos(a) * radius * 0.13, Math.sin(a) * radius * 0.13, 0);
      g.add(bolt);
    }
    this.add(g);
    if (animate) this.wheels.push({ obj: g, radius, side: z >= 0 ? 1 : -1 });
    g.userData.keep = true;
    return g;
  }

  sprocket(x: number, y: number, z: number, radius: number, width: number, teeth: number) {
    const g = new THREE.Group();
    this.placed(g, [x, y, z]);
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.88, radius * 0.88, width * 0.3, 28).rotateX(Math.PI / 2), this.mats.wheelPaint));
    for (const off of [-width * 0.32, width * 0.32]) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.92, radius * 0.92, width * 0.12, 28).rotateX(Math.PI / 2), this.mats.darkSteel);
      ring.position.z = off;
      g.add(ring);
      for (let i = 0; i < teeth; i++) {
        const a = (i / teeth) * Math.PI * 2;
        const t = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.16, radius * 0.18, width * 0.12), this.mats.darkSteel);
        t.position.set(Math.cos(a) * radius, Math.sin(a) * radius, off);
        t.rotation.z = a;
        g.add(t);
      }
    }
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.36, radius * 0.42, width * 0.9, 16).rotateX(Math.PI / 2), this.mats.wheelPaint));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.2, radius * 0.26, width * 1.1, 12).rotateX(Math.PI / 2), this.mats.darkSteel));
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    this.add(g);
    this.wheels.push({ obj: g, radius, side: z >= 0 ? 1 : -1 });
    g.userData.keep = true;
    return g;
  }

  /**
   * Track run around circles (side view x,y,r). Convex hull of the circles offset by half the
   * link thickness; links are instanced along the path and ANIMATED by shifting the phase.
   */
  track(circles: [number, number, number][], zCenter: number, width: number, pitch: number, thickness: number, style: TrackRun['style'] = 'plain', sag: { x0: number; x1: number; y: number; depth: number } | null = null) {
    const pts: [number, number][] = [];
    for (const [cx, cy, r] of circles) {
      const rr = r + thickness * 0.5;
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
      }
    }
    let hull = convexHull2D(pts);
    // optional sag of the upper run between return rollers (Pz IV, T-34 style)
    if (sag) {
      hull = hull.map(([x, y]) => {
        if (y > sag.y && x > sag.x0 && x < sag.x1) {
          const t = (x - sag.x0) / (sag.x1 - sag.x0);
          return [x, y - Math.sin(t * Math.PI) * sag.depth] as [number, number];
        }
        return [x, y] as [number, number];
      });
    }
    // densify the path
    const path: [number, number][] = [];
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], b = hull[(i + 1) % hull.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(len / 0.05));
      for (let k = 0; k < n; k++) path.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    const cum: number[] = [0];
    for (let i = 1; i <= path.length; i++) {
      const a = path[i - 1], b = path[i % path.length];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = cum[cum.length - 1];
    const n = Math.max(8, Math.round(total / pitch));
    const step = total / n;
    const linkGeo = new THREE.BoxGeometry(step * 0.9, thickness, width);
    const inst = new THREE.InstancedMesh(linkGeo, this.mats.track, n);
    const guideGeo = new THREE.BoxGeometry(step * 0.45, thickness * 1.7, width * 0.1);
    const guides = new THREE.InstancedMesh(guideGeo, this.mats.track, n);
    const extras: THREE.InstancedMesh[] = [guides];
    if (style === 'chevron') extras.push(new THREE.InstancedMesh(new THREE.BoxGeometry(step * 0.55, thickness * 0.55, width * 0.42), this.mats.rubber, n * 2));
    else if (style === 'cleat') extras.push(new THREE.InstancedMesh(new THREE.BoxGeometry(step * 0.22, thickness * 0.6, width * 0.92), this.mats.track, n));
    const o = this.offset();
    const g = new THREE.Group();
    g.position.set(-o.x, -o.y, -o.z);
    g.add(inst, ...extras);
    g.userData.keep = true;
    inst.castShadow = true;
    for (const e of extras) e.castShadow = true;
    this.add(g);
    const run: TrackRun = { side: zCenter >= 0 ? 1 : -1, mesh: inst, extras, path, cum, total, z: zCenter, thickness, width, pitch: step, n, offset: 0, style };
    this.tracks.push(run);
    layoutTrack(run);
    return run;
  }

  hatch(x: number, y: number, z: number, r: number, h = 0.04, sx = 1, sz = 1) {
    const g = new THREE.Group();
    this.placed(g, [x, y, z]);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.02, h, 24), this.mats.paint);
    lid.position.set(0, h / 2, r);
    lid.scale.set(sx, 1, sz);
    const pivot = new THREE.Group();
    pivot.position.set(0, 0, -r);
    pivot.add(lid);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, h * 0.35, 6, 24).rotateX(Math.PI / 2), this.mats.paintDark);
    ring.scale.set(sx, 1, sz);
    ring.position.y = h * 0.2;
    g.add(pivot, ring);
    pivot.userData.keep = true;
    g.userData.keep = true;
    this.hatches.push(pivot);
    return this.add(g);
  }

  periscope(x: number, y: number, z: number, rotY = 0) {
    const g = new THREE.Group();
    this.placed(g, [x, y, z]);
    g.rotation.y = rotY;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.12), this.mats.paint);
    guard.position.y = 0.04;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.08), this.mats.darkSteel);
    head.position.set(0.02, 0.09, 0);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.035, 0.07), this.mats.glass);
    glass.position.set(0.081, 0.09, 0);
    g.add(guard, head, glass);
    return this.add(g);
  }

  headlight(x: number, y: number, z: number) {
    const g = new THREE.Group();
    this.placed(g, [x, y, z]);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.12, 14).rotateZ(Math.PI / 2), this.mats.paint);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.01, 14).rotateZ(Math.PI / 2), this.mats.lamp);
    lens.position.x = 0.065;
    g.add(body, lens);
    for (const s of [-1, 1]) {
      const guard = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.008, 4, 12, Math.PI), this.mats.paint);
      guard.rotation.set(0, Math.PI / 2, s * 0.6);
      guard.position.x = 0.02;
      g.add(guard);
    }
    return this.add(g);
  }

  /** main gun barrel (in the GUN frame, recoils) from `start` along +x */
  barrel(start: V3, length: number, r0: number, r1: number, brake?: { len: number; r: number; style: 'double' | 'single' }) {
    const g = this.barrelGroup;
    const p = this.P(start, 'gun');
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, length, 22).rotateZ(-Math.PI / 2), this.mats.paint);
    tube.position.set(p[0] + length / 2, p[1], p[2]);
    tube.castShadow = true;
    g.add(tube);
    let end = p[0] + length;
    if (brake) {
      const b = new THREE.Group();
      b.position.set(end, p[1], p[2]);
      const chambers = brake.style === 'double' ? 2 : 1;
      const cl = brake.len / (chambers * 2 + 1);
      for (let i = 0; i < chambers * 2 + 1; i++) {
        const solid = i % 2 === 0;
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(solid ? brake.r : brake.r * 0.72, solid ? brake.r : brake.r * 0.72, cl, 18).rotateZ(-Math.PI / 2), this.mats.paint);
        seg.position.x = cl * (i + 0.5);
        seg.castShadow = true;
        b.add(seg);
        if (!solid) {
          for (const s of [-1, 1]) {
            const vane = new THREE.Mesh(new THREE.BoxGeometry(cl * 0.9, brake.r * 1.5, 0.012), this.mats.darkSteel);
            vane.position.set(cl * (i + 0.5), 0, s * brake.r * 0.95);
            b.add(vane);
          }
        }
      }
      g.add(b);
      end += brake.len;
    }
    const bore = new THREE.Mesh(new THREE.CylinderGeometry(r1 * 0.55, r1 * 0.55, 0.01, 14).rotateZ(-Math.PI / 2), this.mats.rubber);
    bore.position.set(end + 0.002, p[1], p[2]);
    g.add(bore);
    this.muzzle.set(end, p[1], p[2]);
    g.userData.keep = true;
    return g;
  }

  /** flat decal on a plate: tex placed at hull-frame `pos` facing `normal` (frame-local) */
  decal(tex: THREE.Texture, pos: V3, normal: V3, w: number, h: number) {
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, roughness: 0.85 });
    mat.userData.noBurn = false;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    const p = this.V(pos);
    const n = new THREE.Vector3(...normal).normalize();
    m.position.copy(p).addScaledVector(n, 0.006);
    m.lookAt(p.clone().add(n));
    m.userData.keep = true;
    return this.add(m);
  }

  /* ------------------------------------------------------------------ finish */

  finish(o: { halfLength: number; halfWidth: number; height: number }): TankModel {
    for (const f of ['hull', 'turret', 'gun'] as Frame[]) {
      this.armor[f].finalize();
      const g = this.groups[f];
      for (const mesh of armorSurfaceMeshes(this.armor[f], this.armorMats)) g.add(mesh);
      bakeStatic(g);
    }
    bakeStatic(this.barrelGroup);
    const materials: THREE.Material[] = [];
    this.root.traverse((ob) => {
      const m = ob as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        const mm = Array.isArray(m.material) ? m.material : [m.material];
        for (const x of mm) if (!materials.includes(x)) materials.push(x);
      }
    });
    return {
      root: this.root, hull: this.groups.hull, turret: this.groups.turret, gun: this.groups.gun, barrel: this.barrelGroup,
      armor: this.armor, turretPivot: this.turretPivot.clone(), trunnion: this.trunnion.clone(), muzzle: this.muzzle.clone(),
      components: this.components, external: this.external, tracks: this.tracks, wheels: this.wheels, exhausts: this.exhausts,
      commanderHatch: this.commanderHatch.clone(), halfLength: o.halfLength, halfWidth: o.halfWidth, height: o.height, materials,
      coax: this.coax.clone(), bow: this.bow?.clone() ?? null, hatches: this.hatches,
    };
  }
}

/** Instance matrices of the track links for the current phase offset. */
export function layoutTrack(run: TrackRun) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  const zAxis = new THREE.Vector3(0, 0, 1);
  const p = new THREE.Vector3();
  const total = run.total;
  let seg = 0;
  const chev = run.style === 'chevron';
  for (let k = 0; k < run.n; k++) {
    let d = (k * run.pitch + run.offset) % total;
    if (d < 0) d += total;
    // binary search segment
    let lo = 0, hi = run.cum.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (run.cum[mid] <= d) lo = mid;
      else hi = mid - 1;
    }
    seg = lo;
    const a = run.path[seg], b = run.path[(seg + 1) % run.path.length];
    const sl = run.cum[seg + 1] - run.cum[seg];
    const t = sl > 0 ? (d - run.cum[seg]) / sl : 0;
    const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    q.setFromAxisAngle(zAxis, ang);
    p.set(x, y, run.z);
    run.mesh.setMatrixAt(k, m.compose(p, q, s));
    const inward = new THREE.Vector3(-Math.sin(ang), Math.cos(ang), 0);
    run.extras[0].setMatrixAt(k, m.compose(p.clone().addScaledVector(inward, run.thickness * 0.9), q, s));
    if (run.extras[1]) {
      const out = inward.clone().negate();
      if (chev) {
        for (const side of [-1, 1]) {
          const bq = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), side * 0.35));
          const bp = new THREE.Vector3(x, y, run.z + side * run.width * 0.24).addScaledVector(out, run.thickness * 0.5);
          run.extras[1].setMatrixAt(k * 2 + (side > 0 ? 1 : 0), m.compose(bp, bq, s));
        }
      } else {
        run.extras[1].setMatrixAt(k, m.compose(p.clone().addScaledVector(out, run.thickness * 0.5), q, s));
      }
    }
  }
  run.mesh.instanceMatrix.needsUpdate = true;
  for (const e of run.extras) e.instanceMatrix.needsUpdate = true;
}

/** Visible outer armour surfaces: one mesh per material, smooth normals for cast regions. */
function armorSurfaceMeshes(set: ArmorSet, mats: Record<string, THREE.MeshStandardMaterial>) {
  const buckets = new Map<THREE.Material, { pos: number[]; nor: number[] }>();
  for (const r of set.regions) {
    if (r.auxiliary && r.group === 'running') continue;
    const mat = mats[r.material.id] ?? mats.RHA;
    let b = buckets.get(mat);
    if (!b) buckets.set(mat, (b = { pos: [], nor: [] }));
    const smooth = r.material.id === 'CHA';
    for (const f of r.facets) {
      const ns = smooth ? [f.na, f.nb, f.nc] : [f.n, f.n, f.n];
      [f.a, f.b, f.c].forEach((v, i) => {
        b!.pos.push(v.x, v.y, v.z);
        b!.nor.push(ns[i].x, ns[i].y, ns[i].z);
      });
      // plate edges: close thin rims so free plate edges are not paper-thin
    }
  }
  const out: THREE.Mesh[] = [];
  for (const [mat, b] of buckets) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'armor-surface';
    mesh.castShadow = mesh.receiveShadow = true;
    out.push(mesh);
  }
  return out;
}

/**
 * Merge static meshes that share a material (Ballistic Lab's bakeStatic): hundreds of small
 * detail parts become a handful of draw calls. Objects flagged userData.keep are left alone.
 */
export function bakeStatic(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<THREE.Material, { pos: number[]; nor: number[] }>();
  const remove: THREE.Object3D[] = [];
  const m = new THREE.Matrix4();
  const nm = new THREE.Matrix3();
  const v = new THREE.Vector3();
  const skip = (o: THREE.Object3D) => {
    for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (p.userData.keep) return true;
    return false;
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || Array.isArray(mesh.material) || mesh.name === 'armor-surface') return;
    if (skip(mesh)) return;
    // only bake meshes that belong directly to this frame (not to child frames)
    let p = mesh.parent;
    while (p && p !== root) {
      if (p.userData.frame) return;
      p = p.parent;
    }
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const pa = g.getAttribute('position');
    let na = g.getAttribute('normal');
    if (!na) { g.computeVertexNormals(); na = g.getAttribute('normal'); }
    m.multiplyMatrices(inv, mesh.matrixWorld);
    nm.getNormalMatrix(m);
    let b = buckets.get(mesh.material);
    if (!b) buckets.set(mesh.material, (b = { pos: [], nor: [] }));
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(m);
      b.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
      b.nor.push(v.x, v.y, v.z);
    }
    if (g !== mesh.geometry) g.dispose();
    mesh.geometry.dispose();
    remove.push(mesh);
  });
  for (const o of remove) o.removeFromParent();
  for (const [mat, b] of buckets) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'baked';
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
}

/** Polygon ring helper for turrets: superellipse plan shape (Ballistic Lab). */
export function turretRing(cx: number, y: number, cz: number, front: number, rear: number, half: number, n: number, pf = 2.4, pr = 2.2): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    const p = c >= 0 ? pf : pr;
    const a = c >= 0 ? front : rear;
    const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / p) * a;
    const z = Math.sign(s) * Math.pow(Math.abs(s), 2 / p) * half;
    out.push([cx + x, y, cz + z]);
  }
  return out;
}
