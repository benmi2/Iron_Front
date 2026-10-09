import * as THREE from 'three';
import { clamp } from '../../core/math';
import { armIK, BODY, forwardKinematics, PX, standingPose, type Joints, type Pose, type Vec2 } from './Skeleton';
import { gaitCycleLength, gaitLegs, groundedHipY, idleLegs, mixLegs, applyLegs, type GaitWeights } from './Locomotion';
import { soldierTextures, type PartTex, type RigTextures, type SoldierLook } from './SoldierPainter';
import { weaponArt, type WeaponArtDef } from './WeaponArt';
import type { HoldStyle } from '../../data/smallarms';
import { glowTexture } from '../../render/Textures';

/**
 * Soldier rendered from Dead Meridian's side-view skeleton: each body part is a textured quad
 * in a Three.js group placed at the soldier's depth (z). The group is mirrored (scale.x = −1) to
 * face left, exactly like DM's container.
 */

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function partMat(t: THREE.Texture, back: boolean) {
  const key = `${t.uuid}${back}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.92, color: back ? 0x9a9a9a : 0xffffff });
    matCache.set(key, m);
  }
  return m;
}

const geoCache = new Map<string, THREE.PlaneGeometry>();
function partGeo(p: PartTex) {
  const key = `${p.w}x${p.h}@${p.ox},${p.oy}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.PlaneGeometry(p.w * PX, p.h * PX);
    // pivot: image (ox, oy) from the top-left → origin
    g.translate((0.5 - p.ox) * p.w * PX, (p.oy - 0.5) * p.h * PX, 0);
    geoCache.set(key, g);
  }
  return g;
}

let shadowMat: THREE.MeshBasicMaterial | null = null;

export interface AnimInput {
  dt: number;
  /** signed speed along facing, m/s */
  speed: number;
  crouch: number;
  /** aim angle in rig space (radians, y-down, 0 = level forward, negative = up) */
  aim: number;
  aiming: boolean;
  hold: HoldStyle;
  kick: number;
  reload: number;
  throwT: number;
  dead: number;
  wounded: boolean;
}

export class SoldierRig {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private parts: Record<string, THREE.Mesh> = {};
  private tex: RigTextures;
  private art: WeaponArtDef | null = null;
  private weaponMesh: THREE.Mesh | null = null;
  private cycle = 0;
  joints: Joints;
  facing: 1 | -1 = 1;
  /** last computed weapon placement (rig px) */
  private wOrigin: Vec2 = { x: 0, y: 0 };
  private wAngle = 0;
  private flash: THREE.Sprite;
  flashT = 0;

  constructor(look: SoldierLook) {
    this.tex = soldierTextures(look);
    this.group.add(this.body);
    const order: [string, PartTex | null, boolean][] = [
      ['armBU', this.tex.upperArm, true], ['armBF', this.tex.foreArm, true], ['handB', this.tex.hand, true],
      ['legBT', this.tex.thigh, true], ['legBS', this.tex.shin, true], ['footB', this.tex.foot, true],
      ['pack', this.tex.pack, false],
      ['legFT', this.tex.thigh, false], ['legFS', this.tex.shin, false], ['footF', this.tex.foot, false],
      ['torso', this.tex.torso, false], ['head', this.tex.head, false],
      ['weapon', null, false],
      ['armFU', this.tex.upperArm, false], ['armFF', this.tex.foreArm, false], ['handF', this.tex.hand, false],
    ];
    order.forEach(([name, t, back], i) => {
      if (name === 'weapon') return;
      if (!t) return;
      const m = new THREE.Mesh(partGeo(t), partMat(t.tex, back));
      m.castShadow = true;
      m.position.z = (i - 8) * 0.004;
      m.userData.z = m.position.z;
      this.body.add(m);
      this.parts[name] = m;
    });
    if (!shadowMat) shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false, map: glowTexture() });
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5).rotateX(-Math.PI / 2), shadowMat);
    sh.position.y = 0.03;
    sh.renderOrder = 1;
    this.group.add(sh);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffc070, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.scale.setScalar(0.45);
    this.flash.visible = false;
    this.body.add(this.flash);
    this.joints = forwardKinematics(standingPose());
  }

  setWeapon(artId: string | null) {
    if (this.weaponMesh) {
      this.weaponMesh.removeFromParent();
      this.weaponMesh = null;
    }
    this.art = artId ? weaponArt(artId) : null;
    if (!this.art) return;
    const a = this.art;
    const g = new THREE.PlaneGeometry(a.w, a.h);
    g.translate(a.x0 + a.w / 2, a.y0 + a.h / 2, 0);
    this.weaponMesh = new THREE.Mesh(g, partMat(a.tex, false));
    this.weaponMesh.castShadow = true;
    this.weaponMesh.position.z = 0.02;
    this.body.add(this.weaponMesh);
  }

  /** advance animation and place every part */
  animate(o: AnimInput) {
    const p = standingPose();
    const run = clamp(Math.abs(o.speed) / 4.5, 0, 1);
    const moving = Math.abs(o.speed) > 0.15;
    const w: GaitWeights = { walk: (1 - o.crouch) * (1 - run), sprint: (1 - o.crouch) * run, crouch: o.crouch };
    const pxSpeed = o.speed / PX;
    this.cycle += (pxSpeed * o.dt) / gaitCycleLength(w);
    let legs = moving ? gaitLegs(w, this.cycle) : idleLegs(o.crouch);
    if (moving && Math.abs(o.speed) < 0.6) legs = mixLegs(idleLegs(o.crouch), legs, Math.abs(o.speed) / 0.6);
    applyLegs(p, legs);
    p.hipY = groundedHipY(legs);
    if (moving) p.hipY += Math.sin(this.cycle * Math.PI * 4) * 1.5 * run;
    // torso lean: forward when running / crouched / aiming
    const lean = 0.06 + run * 0.22 * (o.aiming ? 0.4 : 1) + o.crouch * 0.25 + (o.aiming ? 0.05 : 0);
    p.torso = -Math.PI / 2 + lean + (o.wounded ? 0.12 : 0);
    const aim = o.aiming ? clamp(o.aim, -1.1, 1.0) : moving && run > 0.5 ? 0.75 : 0.5;
    p.head = -Math.PI / 2 + clamp(aim * 0.6, -0.5, 0.45) + 0.05;
    const j0 = forwardKinematics(p);
    this.placeWeaponAndArms(p, j0, aim, o);
    if (o.throwT > 0) {
      // overarm throw: near arm swings from behind the head forward
      const t = o.throwT;
      const sw = t < 0.5 ? -2.6 + t * 1.2 : -2.0 + (t - 0.5) * 4.2;
      p.uArmF = sw;
      p.fArmF = sw - 0.4 + (t > 0.5 ? 0.6 : 0);
    }
    this.joints = forwardKinematics(p);
    this.apply(p, this.joints, o);
  }

  private placeWeaponAndArms(p: Pose, j: Joints, aim: number, o: AnimInput) {
    const a = this.art;
    const sh = j.shoulder;
    if (!a) {
      // empty hands swing with the gait
      const s = Math.sin(this.cycle * Math.PI * 2) * 0.5 * clamp(Math.abs(o.speed) / 2, 0, 1);
      p.uArmF = Math.PI / 2 + s; p.fArmF = Math.PI / 2 + s - 0.2;
      p.uArmB = Math.PI / 2 - s; p.fArmB = Math.PI / 2 - s - 0.2;
      return;
    }
    const ca = Math.cos(aim), sa = Math.sin(aim);
    // rotate a weapon-space point (metres, y up) into rig px (y down) at angle `ang`
    const rot = (m: [number, number], ang: number): Vec2 => {
      const x = m[0] / PX, y = -m[1] / PX;
      const c = Math.cos(ang), s = Math.sin(ang);
      return { x: x * c - y * s, y: x * s + y * c };
    };
    let ang = aim;
    let anchor: Vec2;
    let anchorPt: [number, number];
    if (o.hold === 'tube') {
      anchor = { x: sh.x - 2, y: sh.y - 3 };
      anchorPt = [a.butt[0], a.butt[1] - 0.04];
    } else if (o.hold === 'faust') {
      anchor = { x: sh.x + 2, y: sh.y + 16 };
      anchorPt = a.butt;
      ang = aim * 0.6 + (o.aiming ? 0 : 0.3);
    } else if (o.hold === 'pistol') {
      anchor = { x: sh.x + Math.cos(aim) * 52, y: sh.y + Math.sin(aim) * 52 };
      anchorPt = [0, 0];
    } else {
      // shouldered rifle / SMG / MG; carried lower when not aiming
      anchor = o.aiming ? { x: sh.x + 1, y: sh.y + 3 } : { x: sh.x - 2, y: sh.y + 18 };
      anchorPt = a.butt;
    }
    if (o.reload > 0) ang += 0.45;
    // recoil kick: back along the bore and muzzle climb
    ang -= o.kick * 0.12;
    const kickBack: Vec2 = { x: -Math.cos(ang) * o.kick * 5, y: -Math.sin(ang) * o.kick * 5 };
    const ap = rot(anchorPt, ang);
    const origin = { x: anchor.x - ap.x + kickBack.x, y: anchor.y - ap.y + kickBack.y };
    this.wOrigin = origin;
    this.wAngle = ang;
    const grip = origin;
    let fore = { x: origin.x + rot(a.fore, ang).x, y: origin.y + rot(a.fore, ang).y };
    if (o.reload > 0) {
      const wob = Math.sin(o.reload * Math.PI * 4) * 4;
      fore = { x: origin.x + rot([0.06, -0.08], ang).x, y: origin.y + rot([0.06, -0.08], ang).y + wob };
    }
    [p.uArmF, p.fArmF] = armIK(sh, grip, true);
    if (o.hold === 'pistol') {
      p.uArmB = Math.PI / 2 - 0.1;
      p.fArmB = Math.PI / 2 - 0.3;
    } else [p.uArmB, p.fArmB] = armIK(sh, fore, true);
    void ca; void sa;
  }

  private place(m: THREE.Mesh | undefined, at: Vec2, angle: number) {
    if (!m) return;
    m.position.x = at.x * PX;
    m.position.y = -at.y * PX;
    m.rotation.z = -angle;
  }

  private apply(p: Pose, j: Joints, o: AnimInput) {
    const P = this.parts;
    const D = Math.PI / 2;
    this.place(P.legBT, j.hip, p.thighB - D);
    this.place(P.legBS, j.kneeB, p.shinB - D);
    this.place(P.footB, j.footB, p.footB);
    this.place(P.legFT, j.hip, p.thighF - D);
    this.place(P.legFS, j.kneeF, p.shinF - D);
    this.place(P.footF, j.footF, p.footF);
    this.place(P.torso, j.hip, p.torso + D);
    this.place(P.head, j.neck, p.head + D);
    this.place(P.armBU, j.shoulderB ?? j.shoulder, p.uArmB - D);
    this.place(P.armBF, j.elbowB, p.fArmB - D);
    this.place(P.handB, j.handB, p.fArmB - D);
    this.place(P.armFU, j.shoulder, p.uArmF - D);
    this.place(P.armFF, j.elbowF, p.fArmF - D);
    this.place(P.handF, j.handF, p.fArmF - D);
    if (P.pack) {
      const back = { x: j.hip.x + Math.cos(p.torso) * 38 - Math.sin(p.torso) * -14, y: j.hip.y + Math.sin(p.torso) * 38 + Math.cos(p.torso) * -14 };
      this.place(P.pack, back, p.torso + D);
    }
    if (this.weaponMesh) {
      this.weaponMesh.position.set(this.wOrigin.x * PX, -this.wOrigin.y * PX, 0.02);
      this.weaponMesh.rotation.z = -this.wAngle;
      this.weaponMesh.visible = o.throwT <= 0 || o.throwT > 0.95;
    }
    // muzzle flash
    if (this.flashT > 0 && this.art) {
      this.flashT -= o.dt;
      const mz = this.muzzleRig();
      this.flash.position.set(mz.x * PX, -mz.y * PX, 0.05);
      this.flash.visible = true;
    } else this.flash.visible = false;
    // death: the body falls backwards about the feet
    this.body.rotation.z = o.dead > 0 ? o.dead * D * 0.98 : 0;
    this.body.position.y = o.dead > 0 ? Math.sin(o.dead * D) * 0.15 : 0;
  }

  /** muzzle position in rig px */
  muzzleRig(): Vec2 {
    if (!this.art) return { x: this.joints.handF.x, y: this.joints.handF.y };
    const c = Math.cos(this.wAngle), s = Math.sin(this.wAngle);
    const x = this.art.muzzle[0] / PX, y = -this.art.muzzle[1] / PX;
    return { x: this.wOrigin.x + x * c - y * s, y: this.wOrigin.y + x * s + y * c };
  }

  /** world position of a rig point */
  rigToWorld(p: Vec2, out = new THREE.Vector3()) {
    out.set(p.x * PX, -p.y * PX, 0);
    return this.body.localToWorld(out);
  }

  muzzleWorld(out = new THREE.Vector3()) {
    return this.rigToWorld(this.muzzleRig(), out);
  }

  headWorld(out = new THREE.Vector3()) {
    return this.rigToWorld({ x: this.joints.head.x, y: this.joints.head.y - 4 }, out);
  }

  setFacing(f: 1 | -1) {
    this.facing = f;
    this.body.scale.x = f;
  }

  setPosition(x: number, y: number, z: number) {
    this.group.position.set(x, y, z);
  }

  dispose() {
    this.group.removeFromParent();
  }
}

export const STAND_HEIGHT = (BODY.thigh + BODY.shin + BODY.ankle + BODY.torso + 34) * PX;
