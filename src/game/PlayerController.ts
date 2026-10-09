import * as THREE from 'three';
import { ammo as getAmmo } from '../data/ammo';
import type { Input } from '../core/Input';
import { newDriveState, steerIntent, type DriveState } from '../vehicles/Driving';
import type { Tank } from '../vehicles/Tank';
import { Soldier } from '../infantry/Soldier';
import type { World } from '../world/World';
import type { CameraRig } from '../render/CameraRig';
import { pick, type PickResult } from './Picking';
import type { Session } from './Session';

/**
 * Direct control of one unit at a time — a tank (as its commander) or a soldier on foot —
 * Men-of-War style: leave the tank, fight on foot, climb into another friendly vehicle.
 */
export class PlayerController {
  tank: Tank | null = null;
  soldier: Soldier;
  drive: DriveState = newDriveState();
  aim: PickResult | null = null;
  scope = false;
  enterTarget: Tank | null = null;
  private ray = new THREE.Raycaster();
  private ammoKeys: string[] = [];
  dead = false;
  deadT = 0;
  /** extra camera pan from holding the cursor at the screen edge (m) */
  edgePan = 0;
  /** locked target (E): the gun stays on it and the camera frames it */
  lock: Tank | Soldier | null = null;
  private lockLost = 0;
  /** last tap time of A / D (for double-tap turn-around) */
  private lastTap = { A: -9, D: -9 };

  constructor(private s: Session, soldier: Soldier, tank: Tank | null) {
    this.soldier = soldier;
    soldier.isPlayer = true;
    if (tank) this.board(tank, true);
  }

  get unit(): Tank | Soldier {
    return this.tank ?? this.soldier;
  }

  get world(): World {
    return this.s.world;
  }

  /* ------------------------------------------------------------------ boarding */

  board(t: Tank, initial = false) {
    const w = this.world;
    this.tank = t;
    t.isPlayer = true;
    this.s.suspendAI(t);
    this.soldier.inTank = t;
    this.soldier.rig.group.visible = false;
    this.soldier.vel.set(0, 0, 0);
    // the player is the commander: take the commander's seat
    const seat = t.seat('commander');
    if (seat) {
      if (this.soldier.crewRecord) {
        if (!seat.occupant || seat.occupant.state === 'dead' || seat.occupant.state === 'bailed') {
          this.soldier.crewRecord.state = this.soldier.state === 'wounded' ? 'wounded' : 'ok';
          this.soldier.crewRecord.station = 'commander';
          seat.occupant = this.soldier.crewRecord;
          if (!t.crew.includes(this.soldier.crewRecord)) t.crew.push(this.soldier.crewRecord);
        }
      } else if (seat.occupant) this.soldier.crewRecord = seat.occupant;
    }
    if (t.state === 'abandoned') {
      // bailed-out tankers nearby climb back in
      let remounted = 0;
      for (const s of [...w.soldiers]) {
        if (s === this.soldier || s.team !== t.team || !s.alive || s.role !== 'crew' || !s.crewRecord) continue;
        if (s.pos.distanceTo(t.pos) > 35) continue;
        const free = t.comps.find((c) => c.def.kind === 'crew' && (!c.occupant || c.occupant.state === 'dead' || c.occupant.state === 'bailed'));
        if (!free) break;
        s.crewRecord.state = s.state === 'wounded' ? 'wounded' : 'ok';
        s.crewRecord.station = free.def.role ?? null;
        free.occupant = s.crewRecord;
        if (!t.crew.includes(s.crewRecord)) t.crew.push(s.crewRecord);
        w.removeSoldier(s);
        remounted++;
      }
      t.state = 'active';
      for (const h of t.model.hatches) h.rotation.x = 0;
      w.log(`${t.callsign} re-crewed (${remounted + 1} men)`, t.team, 'good');
      this.s.stats.recovered++;
    }
    this.ammoKeys = Object.keys(t.ammoCount);
    if (!initial) w.log(`Taking command of ${t.callsign}`, t.team, 'info');
  }

  exitTank() {
    const t = this.tank;
    if (!t) return;
    const w = this.world;
    t.isPlayer = false;
    const seat = t.seat('commander');
    if (seat && seat.occupant && seat.occupant === this.soldier.crewRecord) seat.occupant = null;
    // step out on the camera side unless the tank is at the near edge of the band
    const side = t.pos.z > 3 ? -1 : 1;
    this.soldier.pos.set(t.pos.x - t.forward.x * 1.5, 0, t.pos.z + side * (t.model.halfWidth + 1.0));
    this.soldier.pos.y = w.terrain.height(this.soldier.pos.x, this.soldier.pos.z);
    this.soldier.inTank = null;
    this.soldier.rig.group.visible = true;
    this.soldier.state = this.soldier.crewRecord?.state === 'wounded' ? 'wounded' : this.soldier.state;
    this.tank = null;
    t.ctl.throttle = 0;
    t.ctl.fire = false;
    t.ctl.mg = false;
    this.s.resumeAI(t, { kind: 'hold', x: t.pos.x, z: t.pos.z });
    w.log(`Dismounted from ${t.callsign}`, t.team, 'info');
  }

  /** after the player's tank was abandoned with him inside: continue as the bailed commander */
  onBailOut(t: Tank, crew: Soldier[]) {
    if (t !== this.tank) return;
    const me = crew.find((s) => s.crewRecord && s.crewRecord === this.soldier.crewRecord) ?? crew[0];
    this.tank = null;
    t.isPlayer = false;
    if (me) {
      this.soldier.pos.copy(me.pos);
      this.soldier.state = me.state;
      this.soldier.health = me.health;
      this.world.removeSoldier(me);
      this.soldier.inTank = null;
      this.soldier.rig.group.visible = true;
    } else this.onKilled();
  }

  onKilled() {
    if (this.dead) return;
    this.dead = true;
    this.deadT = 0;
  }

  /* ------------------------------------------------------------------ per fixed step */

  update(dt: number, input: Input, cam: CameraRig, camera: THREE.PerspectiveCamera) {
    const w = this.world;
    if (this.dead) {
      this.deadT += dt;
      return;
    }
    // aim point under the cursor
    this.ray.setFromCamera(new THREE.Vector2(input.ndcX, input.ndcY), camera);
    const ignore: (Tank | Soldier)[] = [this.soldier];
    if (this.tank) ignore.push(this.tank);
    this.aim = pick(w, this.ray.ray, ignore, 2600, (u) => u.team === this.unit.team || this.s.visibleToPlayer(u));
    // aim assist (not in realism mode): a spotted enemy near the cursor is taken as the target
    if (!w.realism && (!this.aim.unit || this.aim.unit.team === this.unit.team)) {
      const snap = this.snapTarget(input, camera);
      if (snap) this.aim = { point: snap.kind === 'tank' ? snap.centerWorld().add(new THREE.Vector3(0, 0.25, 0)) : snap.center, unit: snap, dist: snap.pos.distanceTo(camera.position) };
    }
    // target lock: E locks the nearest visible enemy (tanks first) and cycles; the lock holds the
    // aim unless the cursor is over another enemy
    if (input.pressed('E') && this.tank) this.cycleLock();
    const L = this.lock;
    if (L) {
      const gone = L.kind === 'tank' ? L.state !== 'active' : !L.alive;
      this.lockLost = this.s.visibleToPlayer(L) ? 0 : this.lockLost + dt;
      if (gone || this.lockLost > 4 || !this.tank) this.lock = null;
      else if (!(this.aim.unit && this.aim.unit.team !== this.unit.team)) {
        const p = L.kind === 'tank' ? L.centerWorld().add(new THREE.Vector3(0, 0.25, 0)) : L.center;
        this.aim = { point: p, unit: L, dist: p.distanceTo(camera.position) };
      }
    }
    this.scope = input.rmb;
    cam.scope = this.scope ? 1 : 0;
    const wheel = input.consumeWheel();
    if (wheel !== 0) cam.setZoomStep(wheel);
    const focus = this.unit.pos;
    // camera lead from the cursor's SCREEN position (no feedback loop): pointing toward the right
    // edge shows most of a screen further ahead; holding the cursor AT the edge keeps scrolling
    // further (to ~700 m). Looking back the other way, or Q, brings the view home.
    const nx = THREE.MathUtils.clamp(input.ndcX, -1, 1);
    const vw = cam.viewWidth;
    if (Math.abs(nx) > 0.86) this.edgePan += Math.sign(nx) * vw * 1.2 * dt * (0.35 + (Math.abs(nx) - 0.86) / 0.14);
    else if (this.edgePan !== 0 && Math.sign(nx) !== Math.sign(this.edgePan) && Math.abs(nx) > 0.2) this.edgePan *= Math.exp(-dt * 3.5);
    if (input.pressed('Q')) this.edgePan = 0;
    this.edgePan = THREE.MathUtils.clamp(this.edgePan, -700, 700);
    let lead = nx * vw * 0.62 + this.edgePan;
    // frame a locked target, or whoever just hit us, together with our own unit
    const th = this.s.threat;
    const frame = this.lock ?? (th && this.s.time - th.t < 6 && this.s.visibleToPlayer(th.u) ? th.u : null);
    if (frame) {
      const dx = frame.pos.x - focus.x;
      cam.autoZoom = THREE.MathUtils.clamp((Math.abs(dx) + 50) / cam.baseWidth, 1, 7);
      lead = dx / 2 + nx * vw * 0.15;
      this.edgePan = 0;
    } else cam.autoZoom = 1;
    // keep the view inside the map
    cam.lookAhead = THREE.MathUtils.clamp(focus.x + lead, w.x0 + vw * 0.4, w.x1 - vw * 0.4) - focus.x;

    if (this.tank) this.tankControls(dt, input);
    else this.footControls(dt, input);

    // squad orders (every friendly squad near the player)
    if (input.pressed('Z')) this.s.orderSquads('follow', this.unit);
    if (input.pressed('H')) this.s.orderSquads('hold', this.unit);
    if (input.pressed('V') && this.aim) this.s.orderSquads('advance', this.unit, this.aim.point.x);
  }

  private tankControls(dt: number, input: Input) {
    const t = this.tank!;
    const w = this.world;
    if (t.state !== 'active' && t.state !== 'abandoned') {
      // knocked out with the commander alive: get out
      if (input.pressed('F')) this.exitTank();
      return;
    }
    let H = 0, D = 0;
    if (input.down('A')) H -= 1;
    if (input.down('D')) H += 1;
    if (input.down('W')) D -= 1;
    if (input.down('S')) D += 1;
    // Holding a direction drives that way: forward if the tank faces it, otherwise it REVERSES
    // (slowly — the real Sherman backed up at ≈3 mph). Double-tap the direction (or T) to turn
    // the tank around instead.
    const now = this.s.time;
    let turn = input.pressed('T');
    for (const k of ['A', 'D'] as const) {
      if (!input.pressed(k)) continue;
      const dir = k === 'A' ? -1 : 1;
      if (now - this.lastTap[k] < 0.35 && dir !== t.facing) turn = true;
      this.lastTap[k] = now;
    }
    // pressing the other way during a turn cancels it
    if (this.drive.uturn && H !== 0 && H !== (Math.cos(this.drive.uturn.goal) >= 0 ? 1 : -1)) this.drive.uturn = null;
    steerIntent(t, this.drive, H, D, turn);
    t.ctl.brake = H === 0 && D === 0 && !this.drive.uturn;
    t.ctl.aim = this.aim ? this.aim.point.clone() : null;
    t.ctl.fire = input.lmb;
    t.ctl.mg = input.down('Space');
    if (w.realism) t.ctl.manualRange = this.s.manualRange;
    else t.ctl.manualRange = null;
    t.rangeErr = 0;
    // ammunition: number keys pick the next round; pressing the key of the loaded type again
    // (or R) unloads and reloads with the selected type
    const keys = Object.keys(t.ammoCount);
    for (let i = 0; i < Math.min(5, keys.length); i++) {
      if (input.pressed(String(i + 1))) {
        const id = keys[i];
        const again = t.selected === id;
        t.selectAmmo(id, again);
        w.log(`Next round: ${getAmmo(id).name}${again ? ' — unloading' : ''}`, t.team, 'info');
      }
    }
    if (input.pressed('R') && t.loaded && t.loaded.id !== t.selected) t.selectAmmo(t.selected, true);
    if (input.pressed('B')) {
      t.buttoned = !t.buttoned;
      w.log(t.buttoned ? 'Hatches closed (buttoned up)' : 'Commander head out: better view, exposed to fire', t.team, 'info');
    }
    if (input.pressed('G') && t.spec.stabilizer) {
      t.ctl.stabilizer = !t.ctl.stabilizer;
      w.log(`Gyrostabilizer ${t.ctl.stabilizer ? 'ON' : 'OFF'}`, t.team, 'info');
    }
    if (input.pressed('F')) this.exitTank();
    void dt;
  }

  /** E: lock the nearest visible enemy, pressing again cycles through them (then unlocks) */
  cycleLock() {
    const me = this.unit;
    const tanks = this.world.tanks.filter((t) => t.team !== me.team && t.state === 'active' && this.s.visibleToPlayer(t));
    const men = this.world.soldiers.filter((s) => s.team !== me.team && s.alive && this.s.visibleToPlayer(s) && s.pos.distanceTo(me.pos) < 450);
    tanks.sort((a, b) => a.pos.distanceTo(me.pos) - b.pos.distanceTo(me.pos));
    men.sort((a, b) => (b.hasAT() ? 1 : 0) - (a.hasAT() ? 1 : 0) || a.pos.distanceTo(me.pos) - b.pos.distanceTo(me.pos));
    const list: (Tank | Soldier)[] = [...tanks, ...men.slice(0, 6)];
    if (!list.length) {
      this.lock = null;
      this.world.log('No enemy in sight to lock on', me.team, 'info');
      return;
    }
    const i = this.lock ? list.indexOf(this.lock) : -1;
    this.lock = i + 1 < list.length ? list[i + 1] : null;
    this.lockLost = 0;
    if (this.lock) this.world.log(`Target: ${this.lock.kind === 'tank' ? this.lock.spec.short : `${this.lock.role === 'at' || this.lock.role === 'faust' ? 'AT team' : 'infantry'}`} — ${Math.round(this.lock.pos.distanceTo(me.pos))} m`, me.team, 'info');
  }

  /** nearest spotted enemy whose screen position is close to the cursor */
  private snapTarget(input: Input, camera: THREE.PerspectiveCamera): Tank | Soldier | null {
    const W = window.innerWidth, Hh = window.innerHeight;
    let best: Tank | Soldier | null = null;
    let bd = Infinity;
    const test = (u: Tank | Soldier, p: THREE.Vector3, radius: number) => {
      const v = p.clone().project(camera);
      if (v.z > 1) return;
      const d = Math.hypot((v.x * 0.5 + 0.5) * W - input.mouseX, (-v.y * 0.5 + 0.5) * Hh - input.mouseY);
      if (d < radius && d < bd) { bd = d; best = u; }
    };
    for (const t of this.world.tanks) {
      if (t.team === this.unit.team || t.state === 'destroyed' || !this.s.visibleToPlayer(t)) continue;
      test(t, t.centerWorld(), 55);
    }
    if (!best) {
      for (const s of this.world.soldiers) {
        if (s.team === this.unit.team || !s.alive || !this.s.visibleToPlayer(s)) continue;
        test(s, s.center, 22);
      }
    }
    return best;
  }

  private footControls(dt: number, input: Input) {
    const s = this.soldier;
    const w = this.world;
    if (!s.alive) {
      this.onKilled();
      return;
    }
    const c = s.ctl;
    c.moveX = (input.down('D') ? 1 : 0) - (input.down('A') ? 1 : 0);
    c.moveZ = (input.down('S') ? 1 : 0) - (input.down('W') ? 1 : 0);
    c.sprint = input.down('Shift');
    if (input.pressed('C') || input.pressed('Ctrl')) c.crouch = !c.crouch;
    c.aim = this.aim ? this.aim.point.clone() : null;
    c.fire = s.weapon.def.auto ? input.lmb : input.lmbPressed;
    c.reload = input.pressed('R');
    if (input.pressed('1')) c.weapon = 0;
    if (input.pressed('2')) c.weapon = 1;
    if (input.pressed('G') && this.aim) { c.throwAt = this.aim.point.clone(); c.throwSmoke = input.down('Shift'); }
    // nearest friendly vehicle to board
    this.enterTarget = null;
    let bd = 6;
    for (const t of w.tanks) {
      if (t.team !== s.team || t.state === 'destroyed' || t.state === 'knocked-out' || (t.fire && t.fire.intensity > 0.3)) continue;
      const d = Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) - t.model.halfWidth;
      if (d < bd) { bd = d; this.enterTarget = t; }
    }
    if (input.pressed('F') && this.enterTarget) this.board(this.enterTarget);
    // E: help repair a friendly tank's track
    if (input.down('E')) {
      for (const t of w.tanks) {
        if (t.team !== s.team || !(t.tracksBroken.L || t.tracksBroken.R)) continue;
        if (Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) < t.model.halfLength + 2) {
          t.repairT += dt * 1.2;
          c.crouch = true;
        }
      }
    }
  }
}

export type { PickResult };
