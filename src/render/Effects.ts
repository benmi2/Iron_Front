import * as THREE from 'three';
import { clamp } from '../core/math';
import { RNG } from '../core/rng';
import { Particles } from './Particles';
import { craterTexture, gougeTexture, holeTexture, scorchTexture } from './Textures';

interface Debris {
  mesh: THREE.InstancedMesh;
  idx: number;
  p: THREE.Vector3;
  v: THREE.Vector3;
  r: THREE.Euler;
  w: THREE.Vector3;
  s: number;
  life: number;
  bounces: number;
  smoke: boolean;
}

interface Emitter {
  pos: THREE.Vector3;
  /** follow a moving object */
  follow?: THREE.Object3D;
  local?: THREE.Vector3;
  kind: 'fire' | 'smoke' | 'smolder' | 'column';
  intensity: number;
  time: number;
  life: number;
  acc: number;
}

const DEBRIS_MAX = 600;

/**
 * Battlefield effects built from Particles: muzzle blast, shell bursts, impacts, burning wrecks,
 * dust trails, debris chunks, decals and short-lived point lights.
 */
export class Effects {
  readonly group = new THREE.Group();
  readonly particles: Particles;
  private rng = new RNG(4242);
  private lights: { l: THREE.PointLight; t: number; peak: number; decay: number }[] = [];
  private debris: Debris[] = [];
  private debrisMeshes: THREE.InstancedMesh[] = [];
  private debrisFree: number[][] = [];
  private emitters: Emitter[] = [];
  private decals: THREE.Mesh[] = [];
  private decalMats = new Map<string, THREE.MeshStandardMaterial>();
  private decalGeo = new THREE.PlaneGeometry(1, 1);
  /** camera shake requests (amplitude), read and cleared by the camera rig */
  shake = 0;
  /** terrain height lookup for debris bounces */
  ground: (x: number, z: number) => number = () => 0;
  cameraPos = new THREE.Vector3();

  constructor(sunDir: THREE.Vector3) {
    this.particles = new Particles(sunDir);
    this.group.add(this.particles.group);
    // a FIXED set of always-enabled lights: changing the number of lights would force every
    // material in the scene to recompile its shader (a multi-second hitch)
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffb060, 0, 30, 2);
      this.group.add(l);
      this.lights.push({ l, t: 0, peak: 0, decay: 1 });
    }
    const mats = [
      new THREE.MeshStandardMaterial({ color: 0x4a3d2c, roughness: 1 }), // earth clods
      new THREE.MeshStandardMaterial({ color: 0x8d8576, roughness: 0.9 }), // stone
      new THREE.MeshStandardMaterial({ color: 0x3a3a36, roughness: 0.6, metalness: 0.6 }), // steel
      new THREE.MeshStandardMaterial({ color: 0x5c4630, roughness: 0.9 }), // wood
    ];
    for (const m of mats) {
      const g = new THREE.DodecahedronGeometry(1, 0);
      const im = new THREE.InstancedMesh(g, m, DEBRIS_MAX);
      im.count = DEBRIS_MAX;
      im.castShadow = true;
      im.frustumCulled = false;
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < DEBRIS_MAX; i++) im.setMatrixAt(i, zero);
      this.group.add(im);
      this.debrisMeshes.push(im);
      this.debrisFree.push(Array.from({ length: DEBRIS_MAX }, (_, i) => DEBRIS_MAX - 1 - i));
    }
  }

  /* ------------------------------------------------------------------ primitives */

  light(pos: THREE.Vector3, color: number, peak: number, decay: number, range = 30) {
    let best = this.lights[0];
    for (const s of this.lights) if (s.l.intensity < best.l.intensity) best = s;
    best.l.position.copy(pos);
    best.l.color.set(color);
    best.l.distance = range;
    best.peak = peak;
    best.t = 0;
    best.decay = decay;
    best.l.intensity = peak;
  }

  private debrisSpawn(kind: 0 | 1 | 2 | 3, p: THREE.Vector3, v: THREE.Vector3, s: number, life = 6, smoke = false) {
    const free = this.debrisFree[kind];
    if (!free.length) return;
    const idx = free.pop()!;
    this.debris.push({
      mesh: this.debrisMeshes[kind], idx, p: p.clone(), v: v.clone(), s, life, bounces: 0, smoke,
      r: new THREE.Euler(this.rng.range(0, 6), this.rng.range(0, 6), 0), w: new THREE.Vector3(this.rng.normal(0, 8), this.rng.normal(0, 8), this.rng.normal(0, 8)),
    });
  }

  emitter(e: Partial<Emitter> & { pos: THREE.Vector3; kind: Emitter['kind'] }) {
    const em: Emitter = { intensity: 1, time: 0, life: Infinity, acc: 0, ...e };
    this.emitters.push(em);
    return em;
  }

  removeEmitter(e: Emitter) {
    const i = this.emitters.indexOf(e);
    if (i >= 0) this.emitters.splice(i, 1);
  }

  decal(tex: THREE.Texture, pos: THREE.Vector3, normal: THREE.Vector3, size: number, parent: THREE.Object3D = this.group, rot = this.rng.range(0, Math.PI * 2), opacity = 1) {
    const key = `${tex.uuid}|${opacity}`;
    let mat = this.decalMats.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1, opacity });
      this.decalMats.set(key, mat);
    }
    const m = new THREE.Mesh(this.decalGeo, mat);
    m.scale.setScalar(size);
    m.position.copy(pos).addScaledVector(normal, 0.02);
    m.lookAt(pos.clone().add(normal));
    m.rotateZ(rot);
    m.receiveShadow = true;
    parent.add(m);
    if (parent === this.group) {
      this.decals.push(m);
      if (this.decals.length > 260) {
        const old = this.decals.shift()!;
        old.removeFromParent();
      }
    }
    return m;
  }

  /* ------------------------------------------------------------------ composite effects */

  /** gun discharge: flash, propellant fire, a big lingering smoke cloud and ground dust */
  muzzleBlast(pos: THREE.Vector3, dir: THREE.Vector3, caliberMm: number, groundY: number) {
    const k = caliberMm / 75;
    const P = this.particles, r = this.rng;
    P.glow.spawn({ pos, life: 0.08, size: 2.6 * k, color: 0xfff0c0, shape: 1 });
    for (let i = 0; i < 10; i++) {
      const v = dir.clone().multiplyScalar(r.range(10, 45)).add(new THREE.Vector3(r.normal(0, 3), r.normal(0, 3), r.normal(0, 3)));
      P.fire.spawn({ pos: pos.clone().addScaledVector(dir, r.range(0, 0.8)), vel: v, life: r.range(0.06, 0.16), size: r.range(0.6, 1.4) * k, grow: 6, color: 0xffa040, shape: 1, drag: 12 });
    }
    // side vents of a muzzle brake / blast ring
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let i = 0; i < 26; i++) {
      const lateral = side.clone().multiplyScalar(r.sign() * r.range(0.3, 1));
      const v = dir.clone().multiplyScalar(r.range(2, 16)).addScaledVector(lateral, r.range(2, 10)).add(new THREE.Vector3(r.normal(0, 1.5), r.normal(0.5, 1.5), r.normal(0, 1.5)));
      const c = new THREE.Color().setScalar(r.range(0.62, 0.8)).multiply(new THREE.Color(1, 0.97, 0.92));
      P.smoke.spawn({ pos: pos.clone().addScaledVector(dir, r.range(0.2, 2.5)), vel: v, life: r.range(2.5, 5.5), size: r.range(0.8, 1.6) * k, grow: r.range(0.7, 1.5), color: c, alpha: 0.55, drag: 2.2, rise: 0.35 });
    }
    // blast lifts dust from the ground under the muzzle
    if (pos.y - groundY < 3.2) {
      for (let i = 0; i < 16; i++) {
        const p = new THREE.Vector3(pos.x + dir.x * r.range(0, 4) + r.normal(0, 1), groundY + 0.2, pos.z + dir.z * r.range(0, 4) + r.normal(0, 1));
        const v = new THREE.Vector3(dir.x * r.range(2, 7) + r.normal(0, 1.5), r.range(0.4, 2), dir.z * r.range(2, 7) + r.normal(0, 1.5));
        P.smoke.spawn({ pos: p, vel: v, life: r.range(2.5, 5), size: r.range(1, 2) * k, grow: 1.1, color: 0x9c8b70, alpha: 0.45, drag: 1.5, rise: 0.15 });
      }
    }
    this.light(pos, 0xffc070, 60 * k, 18, 40);
    this.shakeFrom(pos, 0.25 * k);
  }

  /** HE shell / grenade / ammunition burst. kg = TNT-equivalent filler. */
  explosion(pos: THREE.Vector3, kg: number, onGround: boolean, groundY: number, soil = true) {
    const P = this.particles, r = this.rng;
    const s = clamp(Math.cbrt(Math.max(0.05, kg)) * 1.6, 0.6, 6);
    P.glow.spawn({ pos, life: 0.12, size: 7 * s, color: 0xffe0a0, shape: 1 });
    for (let i = 0; i < 18 * s; i++) {
      const d = new THREE.Vector3(r.normal(0, 1), Math.abs(r.normal(0.6, 1)), r.normal(0, 1)).normalize();
      P.fire.spawn({ pos: pos.clone().addScaledVector(d, r.range(0, 0.6 * s)), vel: d.multiplyScalar(r.range(4, 14) * s), life: r.range(0.18, 0.45), size: r.range(0.8, 1.8) * s, grow: 2 * s, color: r.chance(0.5) ? 0xffa040 : 0xff7a20, shape: 1, drag: 6, rise: 2 });
    }
    // sparks / fragments
    for (let i = 0; i < 26 * Math.sqrt(s); i++) {
      const d = new THREE.Vector3(r.normal(0, 1), Math.abs(r.normal(0.3, 1)), r.normal(0, 1)).normalize();
      P.glow.spawn({ pos, vel: d.multiplyScalar(r.range(30, 90)), life: r.range(0.15, 0.5), size: 0.12, color: 0xffc070, shape: 1, gravity: 9.8, stretch: 6, drag: 1.5 });
    }
    // dark smoke and (on soil) the brown earth plume of the reference image
    const nSmoke = Math.round(24 * s);
    for (let i = 0; i < nSmoke; i++) {
      const d = new THREE.Vector3(r.normal(0, 0.7), Math.abs(r.normal(1, 0.6)), r.normal(0, 0.7)).normalize();
      const earth = soil && onGround && r.chance(0.6);
      const c = earth ? new THREE.Color(0x5a4632).multiplyScalar(r.range(0.8, 1.2)) : new THREE.Color().setScalar(r.range(0.12, 0.3));
      P.smoke.spawn({
        pos: pos.clone().addScaledVector(d, r.range(0, s)), vel: d.multiplyScalar(r.range(2, earth ? 15 : 8) * Math.sqrt(s)),
        life: r.range(3, 8), size: r.range(1.2, 2.4) * s, grow: r.range(0.8, 1.8) * Math.sqrt(s), color: c, alpha: earth ? 0.85 : 0.75,
        drag: 1.8, rise: earth ? 0.2 : 0.7, gravity: earth ? 1.5 : 0,
      });
    }
    if (onGround) {
      for (let i = 0; i < 12 * s; i++) {
        const d = new THREE.Vector3(r.normal(0, 0.6), Math.abs(r.normal(1, 0.4)), r.normal(0, 0.6)).normalize();
        this.debrisSpawn(soil ? 0 : 1, pos.clone().add(new THREE.Vector3(0, 0.2, 0)), d.multiplyScalar(r.range(5, 18) * Math.sqrt(s)), r.range(0.05, 0.16) * Math.sqrt(s), 5);
      }
      if (soil) this.decal(craterTexture(), new THREE.Vector3(pos.x, groundY, pos.z), new THREE.Vector3(0, 1, 0), 2.2 * s);
      else this.decal(scorchTexture(), new THREE.Vector3(pos.x, groundY, pos.z), new THREE.Vector3(0, 1, 0), 2 * s);
    }
    this.light(pos, 0xff9a40, 260 * s, 9, 30 + 14 * s);
    this.shakeFrom(pos, 0.6 * s);
  }

  /** steel-on-steel hit that did not perforate: sparks along the surface + a puff */
  armorSpark(pos: THREE.Vector3, normal: THREE.Vector3, outDir: THREE.Vector3 | null, k = 1) {
    const P = this.particles, r = this.rng;
    for (let i = 0; i < 40 * k; i++) {
      const d = (outDir ? outDir.clone().multiplyScalar(0.8) : new THREE.Vector3()).addScaledVector(normal, r.range(0.2, 1)).add(new THREE.Vector3(r.normal(0, 0.45), r.normal(0, 0.45), r.normal(0, 0.45))).normalize();
      P.glow.spawn({ pos, vel: d.multiplyScalar(r.range(15, 70)), life: r.range(0.1, 0.45), size: 0.09, color: 0xffd090, shape: 1, gravity: 9.8, stretch: 8, drag: 2 });
    }
    P.glow.spawn({ pos, life: 0.07, size: 1.6 * k, color: 0xfff0d0, shape: 1 });
    for (let i = 0; i < 6; i++) {
      P.smoke.spawn({ pos: pos.clone().addScaledVector(normal, 0.2), vel: normal.clone().multiplyScalar(r.range(1, 4)).add(new THREE.Vector3(r.normal(0, 1), r.normal(0, 1), r.normal(0, 1))), life: r.range(1, 2.5), size: 0.5 * k, grow: 0.8, color: 0x8a8378, alpha: 0.5, drag: 2 });
    }
    this.light(pos, 0xffe0b0, 30 * k, 22, 18);
  }

  /** perforation: hot spall flash out of the hole and smoke from inside */
  penetrationFlash(pos: THREE.Vector3, dir: THREE.Vector3) {
    const P = this.particles, r = this.rng;
    P.glow.spawn({ pos, life: 0.1, size: 2.2, color: 0xffffff, shape: 1 });
    for (let i = 0; i < 30; i++) {
      const d = dir.clone().negate().add(new THREE.Vector3(r.normal(0, 0.6), r.normal(0, 0.6), r.normal(0, 0.6))).normalize();
      P.glow.spawn({ pos, vel: d.multiplyScalar(r.range(10, 40)), life: r.range(0.1, 0.35), size: 0.08, color: 0xffc080, shape: 1, gravity: 9.8, stretch: 6 });
    }
    this.light(pos, 0xffd0a0, 50, 15, 20);
  }

  /** dust behind a moving vehicle / running soldier */
  dust(pos: THREE.Vector3, amount: number, color = 0x9c8b70, size = 1.2) {
    const r = this.rng;
    if (amount <= 0 || !r.chance(Math.min(1, amount))) return;
    this.particles.smoke.spawn({
      pos: pos.clone().add(new THREE.Vector3(r.normal(0, 0.3), r.range(0, 0.3), r.normal(0, 0.3))),
      vel: new THREE.Vector3(r.normal(0, 0.6), r.range(0.3, 1.2), r.normal(0, 0.6)),
      life: r.range(2, 4.5), size: size * r.range(0.7, 1.3), grow: 0.9, color, alpha: 0.32 * Math.min(1.5, amount + 0.4), drag: 1.2, rise: 0.12,
    });
  }

  exhaust(pos: THREE.Vector3, rate: number) {
    if (!this.rng.chance(rate)) return;
    const r = this.rng;
    this.particles.smoke.spawn({ pos, vel: new THREE.Vector3(r.normal(0, 0.3), r.range(0.4, 1.2), r.normal(0, 0.3)), life: r.range(1.2, 2.5), size: 0.35, grow: 0.7, color: 0x4a4744, alpha: 0.3, drag: 1, rise: 0.3 });
  }

  /** soft impact on soil/masonry (bullets, small fragments) */
  puff(pos: THREE.Vector3, color = 0x8a7a62, k = 1) {
    const r = this.rng;
    for (let i = 0; i < 3; i++) {
      this.particles.smoke.spawn({ pos, vel: new THREE.Vector3(r.normal(0, 1), r.range(0.5, 2.5), r.normal(0, 1)), life: r.range(0.6, 1.4), size: 0.25 * k, grow: 0.8 * k, color, alpha: 0.6, drag: 3 });
    }
  }

  tracer(pos: THREE.Vector3, vel: THREE.Vector3, color: number, size = 0.18) {
    this.particles.glow.spawn({ pos, vel, life: 0.035, size, color, shape: 1, stretch: 14 });
  }

  smokeScreen(pos: THREE.Vector3, radius: number, duration: number) {
    const em = this.emitter({ pos: pos.clone(), kind: 'smoke', intensity: radius / 9, life: duration });
    return em;
  }

  /** burning vehicle / building */
  burn(pos: THREE.Vector3, intensity: number, life = Infinity, follow?: THREE.Object3D) {
    const local = follow ? follow.worldToLocal(pos.clone()) : undefined;
    return this.emitter({ pos: pos.clone(), kind: 'fire', intensity, life, follow, local });
  }

  holeDecal(parent: THREE.Object3D, worldPos: THREE.Vector3, worldNormal: THREE.Vector3, size: number, gouge = false) {
    const lp = parent.worldToLocal(worldPos.clone());
    const q = new THREE.Quaternion();
    parent.getWorldQuaternion(q);
    const ln = worldNormal.clone().applyQuaternion(q.invert());
    return this.decal(gouge ? gougeTexture() : holeTexture(), lp, ln, size, parent);
  }

  private shakeFrom(pos: THREE.Vector3, amp: number) {
    const d = pos.distanceTo(this.cameraPos);
    this.shake = Math.max(this.shake, amp * clamp(40 / Math.max(10, d), 0, 1.5));
  }

  /* ------------------------------------------------------------------ update */

  update(dt: number, fog: THREE.FogExp2 | null) {
    const r = this.rng;
    for (const s of this.lights) {
      if (s.l.intensity <= 0) continue;
      s.t += dt;
      s.l.intensity = s.peak * Math.exp(-s.t * s.decay);
      if (s.l.intensity < 0.3) s.l.intensity = 0;
    }
    // debris
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.v.y -= 9.81 * dt;
      d.p.addScaledVector(d.v, dt);
      d.r.x += d.w.x * dt; d.r.y += d.w.y * dt; d.r.z += d.w.z * dt;
      const gy = this.ground(d.p.x, d.p.z);
      if (d.p.y < gy + d.s * 0.5) {
        d.p.y = gy + d.s * 0.5;
        if (d.v.y < -1) {
          d.v.y *= -0.3;
          d.v.x *= 0.5; d.v.z *= 0.5;
          d.w.multiplyScalar(0.5);
          d.bounces++;
        } else {
          d.v.set(0, 0, 0);
          d.w.set(0, 0, 0);
        }
      }
      if (d.smoke && r.chance(0.4)) this.particles.smoke.spawn({ pos: d.p, life: 1.2, size: 0.3, grow: 0.6, color: 0x333333, alpha: 0.4, rise: 0.5 });
      const fade = Math.min(1, d.life / 1.0);
      if (d.life <= 0) {
        d.mesh.setMatrixAt(d.idx, m.makeScale(0, 0, 0));
        this.debrisFree[this.debrisMeshes.indexOf(d.mesh)].push(d.idx);
        this.debris.splice(i, 1);
      } else {
        q.setFromEuler(d.r);
        sc.setScalar(d.s * fade);
        d.mesh.setMatrixAt(d.idx, m.compose(d.p, q, sc));
      }
      d.mesh.instanceMatrix.needsUpdate = true;
    }
    // emitters
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      e.time += dt;
      if (e.time > e.life) { this.emitters.splice(i, 1); continue; }
      if (e.follow && e.local) e.pos.copy(e.follow.localToWorld(e.local.clone()));
      const fadeOut = clamp((e.life - e.time) / 8, 0, 1);
      const I = e.intensity * fadeOut;
      e.acc += dt * 60;
      while (e.acc >= 1) {
        e.acc -= 1;
        if (e.kind === 'fire') {
          if (r.chance(0.8)) this.particles.fire.spawn({ pos: e.pos.clone().add(new THREE.Vector3(r.normal(0, 0.35 * I), r.range(0, 0.3), r.normal(0, 0.35 * I))), vel: new THREE.Vector3(r.normal(0, 0.4), r.range(1.5, 3.5) * I, r.normal(0, 0.4)), life: r.range(0.35, 0.8), size: r.range(0.5, 1.1) * I, grow: -0.3, color: r.chance(0.5) ? 0xff9a3a : 0xff6a1a, shape: 0, alpha: 0.9 });
          if (r.chance(0.5)) this.particles.smoke.spawn({ pos: e.pos.clone().add(new THREE.Vector3(r.normal(0, 0.3), 0.8 * I, r.normal(0, 0.3))), vel: new THREE.Vector3(r.normal(0, 0.3), r.range(2, 4) * I, r.normal(0, 0.3)), life: r.range(5, 10), size: r.range(0.8, 1.4) * I, grow: r.range(0.7, 1.3), color: new THREE.Color().setScalar(r.range(0.06, 0.16)), alpha: 0.7, drag: 0.3, rise: 0.25 });
          if (r.chance(0.04)) this.light(e.pos, 0xff8030, 20 * I, 3, 16);
        } else if (e.kind === 'smoke') {
          if (r.chance(0.5)) this.particles.smoke.spawn({ pos: e.pos.clone().add(new THREE.Vector3(r.normal(0, 2.5 * I), r.range(0, 1.5), r.normal(0, 2.5 * I))), vel: new THREE.Vector3(r.normal(0, 0.4), r.range(0.2, 0.7), r.normal(0, 0.4)), life: r.range(6, 10), size: r.range(2.5, 4) * I, grow: 0.5, color: new THREE.Color().setScalar(r.range(0.78, 0.9)), alpha: 0.75 * Math.max(0.2, fadeOut), drag: 0.6, rise: 0.08 });
        } else if (e.kind === 'smolder') {
          if (r.chance(0.18)) this.particles.smoke.spawn({ pos: e.pos.clone().add(new THREE.Vector3(r.normal(0, 0.4), 0, r.normal(0, 0.4))), vel: new THREE.Vector3(r.normal(0, 0.2), r.range(0.8, 1.8), r.normal(0, 0.2)), life: r.range(5, 9), size: 0.8 * I, grow: 0.9, color: new THREE.Color().setScalar(r.range(0.2, 0.32)), alpha: 0.5, drag: 0.3, rise: 0.2 });
        } else if (e.kind === 'column') {
          // distant burning town: tall black columns (slow, big)
          if (r.chance(0.35)) this.particles.smoke.spawn({ pos: e.pos.clone().add(new THREE.Vector3(r.normal(0, 3), 0, r.normal(0, 3))), vel: new THREE.Vector3(r.normal(0.5, 0.5), r.range(4, 7), r.normal(0, 0.5)), life: r.range(14, 22), size: r.range(5, 8) * I, grow: r.range(1.5, 2.5) * I, color: new THREE.Color().setScalar(r.range(0.1, 0.22)), alpha: 0.65, drag: 0.15, rise: 0.1 });
          if (r.chance(0.3)) this.particles.fire.spawn({ pos: e.pos.clone().add(new THREE.Vector3(r.normal(0, 3), r.range(0, 2), r.normal(0, 3))), vel: new THREE.Vector3(0, r.range(2, 5), 0), life: r.range(0.5, 1), size: r.range(2, 4) * I, color: 0xff7a20, alpha: 0.8 });
        }
      }
    }
    this.particles.update(dt, fog);
  }

  clear() {
    this.particles.clear();
    this.emitters.length = 0;
    for (const d of this.decals) d.removeFromParent();
    this.decals.length = 0;
  }
}
