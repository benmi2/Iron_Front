import * as THREE from 'three';
import { ammo as getAmmo, CLASS_LABEL, type AmmoDef } from '../data/ammo';
import { ROLE_LABEL } from '../data/vehicles';
import { estimatePenAt } from '../ballistics/Penetration';
import { rangeTable } from '../ballistics/Flight';
import { presentedArmour } from '../ai/Tactics';
import type { Session } from '../game/Session';
import type { ImpactReport } from '../vehicles/DamageModel';
import type { Tank } from '../vehicles/Tank';
import type { Team } from '../world/Team';
import type { LogLevel } from '../world/World';
import { XRayView } from './XRay';
import { Minimap } from './Minimap';
import { GunSight } from './GunSight';

const el = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const STAR_SVG = `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="29" fill="none" stroke="#e8e6da" stroke-width="3"/><polygon fill="#e8e6da" points="32,7 38,25 57,25 42,36 47,55 32,44 17,55 22,36 7,25 26,25"/></svg>`;
const CROSS_SVG = `<svg viewBox="0 0 64 64"><path fill="#ece9e0" d="M24 4h16v20h20v16H40v20H24V40H4V24h20z"/><path fill="#16171a" d="M27 8h10v19h19v10H37v19H27V37H8V27h19z"/></svg>`;

const SHELL_ICON = (cls: string) => {
  const c = cls === 'HE' ? '#c8a050' : cls === 'HEAT' ? '#d07a40' : cls === 'APCR' ? '#a0b8d0' : cls === 'SMOKE' ? '#c8c8c8' : '#d8d2c0';
  const tip = cls === 'HE' || cls === 'SMOKE' ? 'M10 4 Q12 0 14 4' : 'M9 6 Q12 -2 15 6';
  return `<svg viewBox="0 0 24 48"><path d="${tip} L15 8 L9 8 Z" fill="${c}"/><rect x="9" y="8" width="6" height="20" fill="${c}"/><rect x="8.5" y="27" width="7" height="3" fill="#8a6a30"/><rect x="8" y="30" width="8" height="16" rx="1" fill="#b08a40"/></svg>`;
};

/**
 * In-battle HUD. Information comes from the simulation (crew, components, laid range, documented
 * penetration) — no hit-point bar exists; the compact condition bar is derived from crew and
 * component states. Realism mode strips hit markers and penetration hints.
 */
export class HUD {
  root = el('div', 'hud');
  private top = el('div', 'hud-top');
  private timer = el('div', 'hud-timer');
  private objRow = el('div', 'hud-objs');
  private objText = el('div', 'hud-objtext');
  private teamL = el('div', 'team-panel left');
  private teamR = el('div', 'team-panel right');
  private slots = el('div', 'ammo-slots');
  private card = el('div', 'veh-card');
  private dmg = el('div', 'dmg-panel');
  private cross = el('div', 'crosshair');
  private crossInfo = el('div', 'cross-info');
  private gunMark = el('div', 'gun-marker');
  private intelLayer = el('div', 'intel-layer');
  private intelEls: HTMLElement[] = [];
  private ctlCard = el('div', 'ctl-card');
  private threatLayer = el('div', 'threat-layer');
  private threatEls: HTMLElement[] = [];
  private lockMark = el('div', 'lock-mark');
  private sight: GunSight | null = null;
  private ctlT = 0;
  private selfMark = el('div', 'self-marker');
  private logEl = el('div', 'radio-log');
  private feed = el('div', 'kill-feed');
  private prompt = el('div', 'prompt');
  private markers = el('div', 'markers');
  private xrayBox = el('div', 'xray-box');
  private xrayInfo = el('div', 'xray-info');
  private endBox = el('div', 'end-box hidden');
  private pauseBox = el('div', 'pause-box hidden');
  private hurtFx = el('div', 'hurt-fx');
  private help = el('div', 'help-box hidden');
  private mapBig = el('div', 'tac-map hidden');
  private minimap: Minimap;
  private bigMap: Minimap;
  private xray = new XRayView();
  xrayOn = true;
  private logLines: { e: HTMLElement; t: number }[] = [];
  private lastSlotsKey = '';
  private hurtA = 0;
  private dmgOn = true;
  onExit: (() => void) | null = null;

  constructor(private s: Session) {
    this.minimap = new Minimap(s, 300, 170, false);
    this.bigMap = new Minimap(s, 1100, 420, true);
  }

  build() {
    const s = this.s;
    const r = this.root;
    document.getElementById('ui')!.appendChild(r);
    const ally = s.playerTeam === 'allies';
    this.teamL.innerHTML = `<div class="emblem">${STAR_SVG}</div><div class="tp-body"><div class="tp-name">Allied Forces</div><div class="tp-bar"><div class="fill blue"></div><span class="score">0</span></div><div class="tp-tanks"></div></div>`;
    this.teamR.innerHTML = `<div class="tp-body"><div class="tp-name">Axis Forces</div><div class="tp-bar"><span class="score">0</span><div class="fill red"></div></div><div class="tp-tanks"></div></div><div class="emblem">${CROSS_SVG}</div>`;
    const mid = el('div', 'hud-mid');
    mid.append(this.timer, this.objRow, this.objText);
    this.top.append(this.teamL, mid, this.teamR);
    const mm = el('div', 'minimap');
    mm.appendChild(this.minimap.canvas);
    this.xrayBox.innerHTML = '<div class="xr-title">X-RAY · last impact <span class="xr-key">[X]</span></div>';
    this.xrayBox.appendChild(this.xrayInfo);
    this.mapBig.appendChild(this.bigMap.canvas);
    this.help.innerHTML = HELP_HTML;
    this.pauseBox.innerHTML = `<h2>Paused</h2><button data-a="resume">Resume</button><button data-a="help">Controls</button><button data-a="realism">Realism mode: <b>${s.world.realism ? 'ON' : 'OFF'}</b></button><button data-a="quit">Leave battle</button>`;
    this.pauseBox.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('button')?.dataset.a;
      if (a === 'resume') this.togglePause(false);
      if (a === 'help') this.help.classList.toggle('hidden');
      if (a === 'realism') {
        s.world.realism = !s.world.realism;
        (e.target as HTMLElement).closest('button')!.innerHTML = `Realism mode: <b>${s.world.realism ? 'ON' : 'OFF'}</b>`;
      }
      if (a === 'quit') this.onExit?.();
    });
    r.append(this.threatLayer, this.lockMark, this.intelLayer, this.ctlCard, this.gunMark, this.selfMark, this.top, mm, this.slots, this.card, this.dmg, this.logEl, this.feed, this.prompt, this.markers, this.xrayBox, this.cross, this.endBox, this.pauseBox, this.hurtFx, this.help, this.mapBig);
    this.cross.appendChild(this.crossInfo);
    this.cross.insertAdjacentHTML('afterbegin', '<svg class="reload-ring" viewBox="0 0 44 44"><circle cx="22" cy="22" r="18" class="bg"/><circle cx="22" cy="22" r="18" class="fg"/></svg><div class="dot"></div>');
    this.sight = new GunSight(r, s.playerTeam === 'axis');
    this.s.renderer.overlays.push((rr) => this.sight?.render(rr, this.s.renderer.scene));
    this.s.renderer.overlays.push((rr) => {
      if (!this.xrayOn || !this.s.xray) return;
      const rect = this.xrayBox.getBoundingClientRect();
      const inner = new DOMRect(rect.left + 6, rect.top + 26, rect.width - 12, rect.height - 120);
      this.xray.render(rr, inner, 1 / 60);
    });
    void ally;
  }

  /* ------------------------------------------------------------------ events */

  log(msg: string, team: Team | null, level: LogLevel) {
    if (team && team !== this.s.playerTeam && level !== 'good' && level !== 'bad') return;
    const e = el('div', `ll ${level}`, msg);
    this.logEl.prepend(e);
    this.logLines.unshift({ e, t: 0 });
    while (this.logLines.length > 7) this.logLines.pop()!.e.remove();
  }

  hitMarker(r: ImpactReport, outgoing: boolean) {
    const s = this.s;
    if (s.world.realism && outgoing) return;
    const p = r.target.root.localToWorld(r.entry.clone());
    const v = p.clone().project(s.renderer.camera);
    const x = (v.x * 0.5 + 0.5) * window.innerWidth, y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const color = r.severity >= 3 ? 'crit' : r.severity === 2 ? 'pen' : r.headline === 'RICOCHET' ? 'rico' : 'nopen';
    const sub = r.effects.slice(0, 3).join(' · ');
    const m = el('div', `hit-marker ${color} ${outgoing ? '' : 'incoming'}`, `<b>${outgoing ? '' : 'HIT! '}${r.headline}</b>${sub ? `<span>${sub}</span>` : ''}`);
    m.style.left = `${x}px`;
    m.style.top = `${y}px`;
    this.markers.appendChild(m);
    setTimeout(() => m.remove(), 2600);
  }

  killFeed(t: Tank, killer: Tank | null) {
    const e = el('div', 'kf', `${killer ? `<b>${killer.callsign}</b> ⟶ ` : ''}${t.spec.short} <i>${t.state === 'destroyed' ? 'destroyed' : t.state === 'abandoned' ? 'abandoned' : 'knocked out'}</i>`);
    this.feed.prepend(e);
    setTimeout(() => e.remove(), 9000);
  }

  hurt(n: number) {
    this.hurtA = Math.min(1, this.hurtA + n / 60);
  }

  togglePause(p?: boolean) {
    this.s.paused = p ?? !this.s.paused;
    this.pauseBox.classList.toggle('hidden', !this.s.paused);
  }

  showEnd() {
    const m = this.s.mode;
    this.endBox.classList.remove('hidden');
    this.endBox.innerHTML = `<h1 class="${m.result}">${m.result === 'win' ? 'VICTORY' : 'DEFEAT'}</h1><p>${m.resultText ?? ''}</p><button data-a="debrief">Debriefing ▸</button>`;
    this.endBox.querySelector('button')!.addEventListener('click', () => this.onExit?.());
  }

  /* ------------------------------------------------------------------ per frame */

  /** key handling — called from the fixed step so edges are never missed */
  keys() {
    const s = this.s;
    const input = s.input;
    if (input.pressed('Escape')) this.togglePause();
    if (input.pressed('X')) this.xrayOn = !this.xrayOn;
    if (input.pressed('C') && s.player.tank) this.dmgOn = !this.dmgOn;
    if (input.pressed('F1')) this.help.classList.toggle('hidden');
  }

  update(dt: number) {
    const s = this.s;
    const input = s.input;
    this.mapBig.classList.toggle('hidden', !input.down('Tab'));
    if (input.down('Tab')) this.bigMap.draw();
    if (s.world.realism) {
      if (input.wheel !== 0 && input.down('Shift')) { s.manualRange = Math.max(100, Math.min(2500, s.manualRange - Math.sign(input.wheel) * 50)); input.wheel = 0; }
    }
    this.updateTop();
    this.minimap.draw();
    this.updateUnitPanels();
    this.updateCrosshair();
    this.updateXRay();
    this.updateIntel();
    this.updateThreats();
    this.ctlT += dt;
    const onFoot = !s.player.tank;
    this.ctlCard.innerHTML = onFoot
      ? '<b>On foot</b> A/D move · W/S depth · Shift sprint · C crouch · LMB fire · G grenade · F board a tank'
      : '<b>A / D</b> drive (hold the other way to reverse) · <b>double-tap</b> turn around · <b>W / S</b> lane · <b>E</b> lock target · <b>LMB</b> fire · red arrows = enemies off-screen · <b>F1</b> help';
    this.ctlCard.style.opacity = String(this.ctlT < 25 ? 1 : Math.max(0, 1 - (this.ctlT - 25) / 3));
    for (const l of this.logLines) {
      l.t += dt;
      l.e.style.opacity = String(Math.max(0, 1 - Math.max(0, l.t - 9) / 3));
    }
    this.hurtA = Math.max(0, this.hurtA - dt * 0.6);
    this.hurtFx.style.opacity = String(this.hurtA);
  }

  private teamScore(team: Team) {
    let sc = 0;
    for (const t of this.s.world.tanks) if (t.team === team && t.alive) sc += Math.round(60 * t.condition);
    for (const x of this.s.world.soldiers) if (x.team === team && x.alive) sc += 5;
    return sc;
  }

  private updateTop() {
    const s = this.s;
    const left = Math.max(0, s.mode.timeLimit - s.time);
    this.timer.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    const a = this.teamScore('allies'), x = this.teamScore('axis');
    const max = Math.max(1, a, x);
    const setTeam = (p: HTMLElement, team: Team, score: number) => {
      (p.querySelector('.score') as HTMLElement).textContent = String(score);
      (p.querySelector('.fill') as HTMLElement).style.width = `${(score / max) * 100}%`;
      const tanks = s.world.tanks.filter((t) => t.team === team);
      const known = team === s.playerTeam ? tanks : tanks.filter((t) => s.visibleToPlayer(t) || t.state !== 'active');
      (p.querySelector('.tp-tanks') as HTMLElement).innerHTML = known.map((t) => `<i class="ti ${t.alive ? 'ok' : 'dead'}"></i>`).join('');
    };
    setTeam(this.teamL, 'allies', a);
    setTeam(this.teamR, 'axis', x);
    this.objRow.innerHTML = s.objectives.map((o) => {
      const own = o.owner === 'allies' ? 'blue' : o.owner === 'axis' ? 'red' : 'grey';
      return `<div class="obj ${own} ${o.contested ? 'contested' : ''}" title="${o.label}"><span>${o.id}</span><i style="--p:${Math.abs(o.progress)}"></i></div>`;
    }).join('');
    this.objText.textContent = s.mode.objectivesText(s);
  }

  private updateUnitPanels() {
    const s = this.s;
    const p = s.player;
    const t = p.tank;
    if (t) {
      // ammunition slots like the reference: icon, number key, count
      const keys = Object.keys(t.ammoCount);
      const key = keys.map((k) => `${k}:${t.ammoCount[k]}`).join('|') + `|${t.selected}|${t.loaded?.id}`;
      if (key !== this.lastSlotsKey) {
        this.lastSlotsKey = key;
        this.slots.innerHTML = keys.slice(0, 5).map((k, i) => {
          const a = getAmmo(k);
          return `<div class="slot ${t.selected === k ? 'sel' : ''} ${t.loaded?.id === k ? 'loaded' : ''}" title="${a.designation}">${SHELL_ICON(a.cls)}<div class="sn">${a.name}</div><div class="sc">${t.ammoCount[k]}</div><div class="sk">${i + 1}</div></div>`;
        }).join('') + `<div class="slot mg ${t.mgAmmo > 0 ? '' : 'empty'}"><div class="sn">MG</div><div class="sc">${t.mgAmmo}</div><div class="sk">␣</div></div>`;
      }
      const kmh = Math.abs(t.speed) * 3.6;
      const cond = t.condition;
      const loadPct = Math.round(t.reloadFraction * 100);
      this.card.innerHTML = `<div class="vc-name">${t.spec.short}<small>${t.gunDef.name}</small></div>
        <div class="vc-row"><div class="cond"><div style="width:${cond * 100}%" class="${cond > 0.6 ? 'g' : cond > 0.3 ? 'y' : 'r'}"></div></div><div class="spd"><b>${kmh.toFixed(0)}</b> km/h</div></div>
        <div class="vc-row small"><span>${t.loaded ? `Loaded: <b>${t.loaded.name}</b>` : t.loading ? `Loading ${t.loading.name} ${loadPct}%` : 'No round'}</span><span>${t.traverseMode !== 'powered' ? `Traverse: <b class="warn">${t.traverseMode}</b>` : `Ready rack ${Math.floor(t.readyRounds)}`}</span></div>
        <div class="vc-row small"><span>${t.buttoned ? 'Buttoned up' : '<b class="warn">Head out</b>'} [B]</span><span>${t.spec.stabilizer ? `Gyro ${t.ctl.stabilizer ? 'on' : 'off'} [G]` : ''}</span>${s.world.realism ? `<span>Range drum <b>${s.manualRange} m</b></span>` : ''}</div>`;
      this.dmg.classList.toggle('hidden', !this.dmgOn);
      this.dmg.innerHTML = this.damagePanel(t);
      this.prompt.textContent = t.state !== 'active' ? 'Vehicle knocked out — [F] bail out' : '';
    } else {
      const so = p.soldier;
      const w = so.weapon;
      this.slots.innerHTML = so.weapons.map((ws, i) => `<div class="slot wpn ${so.current === i ? 'sel' : ''}"><div class="sn">${ws.def.name}</div><div class="sc">${ws.mag} / ${ws.reserve}</div><div class="sk">${i + 1}</div></div>`).join('') +
        `<div class="slot wpn"><div class="sn">Grenades [G]</div><div class="sc">${so.grenades} · smoke ${so.smokes}</div></div>`;
      this.lastSlotsKey = '';
      this.card.innerHTML = `<div class="vc-name">${so.rank} ${so.name}<small>${w.def.name} · ${w.def.caliber}</small></div>
        <div class="vc-row"><div class="cond"><div style="width:${Math.max(0, so.health)}%" class="${so.health > 60 ? 'g' : so.health > 30 ? 'y' : 'r'}"></div></div><div class="spd">${so.state === 'wounded' ? '<b class="warn">wounded</b>' : so.crouch > 0.5 ? 'crouched' : 'standing'}</div></div>
        <div class="vc-row small"><span>${so.reloadT > 0 ? 'Reloading…' : ''}</span><span>Suppression ${(so.suppression * 100).toFixed(0)}%</span></div>`;
      this.dmg.classList.add('hidden');
      const et = p.enterTarget;
      this.prompt.textContent = et ? `[F] ${et.state === 'abandoned' ? 'Re-crew' : 'Take command of'} ${et.callsign}${et.tracksBroken.L || et.tracksBroken.R ? ' · hold [E] to help repair the track' : ''}` : '';
    }
    if (p.dead) this.prompt.textContent = 'You have been killed — transferring command…';
  }

  private damagePanel(t: Tank) {
    const crew = (['commander', 'gunner', 'loader', 'driver', 'radio'] as const).map((role) => {
      const seat = t.seat(role);
      const m = seat?.occupant;
      const st = !m ? 'empty' : m.state;
      const stand = m && m.role !== role ? ` <i>(${m.role})</i>` : '';
      return `<div class="crew ${st}"><span class="ci"></span>${ROLE_LABEL[role]}${stand}<em>${m ? m.name.split(' ').pop() : '—'}</em></div>`;
    }).join('');
    const mod = (label: string, st: string) => `<div class="mod ${st}">${label}</div>`;
    const comp = (k: Parameters<Tank['compStatus']>[0]) => t.compStatus(k);
    const mods = [
      mod('Engine', comp('engine')), mod('Transmission', comp('transmission')),
      mod(`Track L`, t.tracksBroken.L ? 'destroyed' : 'ok'), mod(`Track R`, t.tracksBroken.R ? 'destroyed' : 'ok'),
      mod('Gun', t.barrelDestroyed ? 'destroyed' : comp('breech') !== 'ok' ? comp('breech') : t.barrelDamaged ? 'damaged' : 'ok'),
      mod('Traverse', t.turretJammed ? 'destroyed' : comp('traverse')), mod('Optics', comp('optics')), mod('Radio', comp('radio')),
      mod('Ammo', comp('ammo')), mod('Fuel', comp('fuel')),
    ].join('');
    const fire = t.fire ? `<div class="fire">FIRE — ${t.fire.where === 'engine' ? 'engine compartment' : t.fire.where === 'ammo' ? 'AMMUNITION' : 'fighting compartment'}</div>` : '';
    const repair = t.tracksBroken.L || t.tracksBroken.R ? `<div class="repair">Track repair <i style="width:${t.repairProgress * 100}%"></i></div>` : '';
    return `<div class="dp-title">Crew & components <span class="xr-key">[C]</span></div>${fire}<div class="crew-list">${crew}</div><div class="mods">${mods}</div>${repair}`;
  }

  private updateCrosshair() {
    const s = this.s;
    const p = s.player;
    const input = s.input;
    // looking through the free sight the cursor is captured: the ring sits on the sight's centre
    const sc = p.manualSight && this.sight ? this.sight.centre() : null;
    this.cross.style.left = `${sc ? sc.x : input.mouseX}px`;
    this.cross.style.top = `${sc ? sc.y : input.mouseY}px`;
    const ring = this.cross.querySelector('.fg') as SVGCircleElement;
    const t = p.tank;
    const aim = p.aim;
    let info = '';
    // gun marker: where the round would land right now (turret and gun lag behind the cursor)
    this.gunMark.style.display = 'none';
    if (t && aim && t.alive) {
      const muzzle = t.muzzleWorld();
      const d = aim.point.distanceTo(muzzle);
      const round = t.loaded ?? getAmmo(t.selected);
      const gp = muzzle.clone().addScaledVector(t.boreDirWorld(), d);
      gp.y -= d * Math.tan(rangeTable(round).superelevation(d));
      const v = gp.project(s.renderer.camera);
      if (v.z < 1) {
        const gx = (v.x * 0.5 + 0.5) * window.innerWidth, gy = (-v.y * 0.5 + 0.5) * window.innerHeight;
        this.gunMark.style.display = 'block';
        this.gunMark.style.left = `${gx}px`;
        this.gunMark.style.top = `${gy}px`;
        this.gunMark.classList.toggle('on', Math.hypot(gx - input.mouseX, gy - input.mouseY) < 10);
        if (p.manualSight) this.gunMark.style.display = 'none';
      }
    }
    // our own unit off-screen: arrow at the screen edge
    const me = p.unit;
    const mv = me.pos.clone().add(new THREE.Vector3(0, 1.5, 0)).project(s.renderer.camera);
    const sx = (mv.x * 0.5 + 0.5) * window.innerWidth;
    if (sx < 0 || sx > window.innerWidth) {
      const right = sx > window.innerWidth;
      const dist = Math.round(Math.abs(me.pos.x - (s.cam.focus.x + s.cam.lookAhead)));
      this.selfMark.className = `self-marker ${right ? 'right' : 'left'}`;
      this.selfMark.style.display = 'block';
      this.selfMark.style.top = `${Math.min(window.innerHeight - 220, Math.max(140, (-mv.y * 0.5 + 0.5) * window.innerHeight))}px`;
      this.selfMark.textContent = right ? `YOU  ${dist} m  ▶` : `◀  YOU  ${dist} m`;
    } else this.selfMark.style.display = 'none';
    if (t && aim) {
      const frac = t.reloadFraction;
      ring.style.strokeDashoffset = String(113 * (1 - frac));
      this.cross.classList.toggle('ready', !!t.loaded && t.layT > 0.2);
      const range = aim.point.distanceTo(t.muzzleWorld());
      info = `<b>${range.toFixed(0)} m</b>`;
      if (!s.world.realism && aim.unit && aim.unit.kind === 'tank' && aim.unit.team !== t.team) {
        const a: AmmoDef = t.loaded ?? getAmmo(t.selected);
        const pa = presentedArmour(aim.unit, t.centerWorld());
        const pen = estimatePenAt(a, rangeTable(a).velocity(range), 0);
        const ok = pen > pa.mm * 1.1 ? 'ok' : pen > pa.mm * 0.85 ? 'maybe' : 'no';
        info += `<span class="pen ${ok}">${CLASS_LABEL[a.cls]} ${pen.toFixed(0)} mm vs ≈${pa.mm} (${pa.aspect})</span><span class="tgt">${aim.unit.spec.short}</span>`;
      }
      if (t.traverseMode === 'jammed') info += '<span class="pen no">TURRET JAMMED</span>';
      if (!t.gunOperable) info += '<span class="pen no">GUN OUT OF ACTION</span>';
    } else if (aim) {
      const so = p.soldier;
      ring.style.strokeDashoffset = so.reloadT > 0 ? String(113 * (so.reloadT / Math.max(0.1, so.weapon.def.reloadS))) : '0';
      this.cross.classList.toggle('ready', so.reloadT <= 0);
      info = `<b>${aim.point.distanceTo(so.pos).toFixed(0)} m</b>`;
      if (aim.unit && aim.unit.kind === 'tank' && aim.unit.team !== so.team) info += `<span class="tgt">${aim.unit.spec.short}</span>`;
    }
    this.crossInfo.innerHTML = info;
  }

  /** off-screen enemy tanks the player can see: arrows at the screen edge with type and range;
   *  the lock bracket; the gunner's sight */
  private updateThreats() {
    const s = this.s;
    const cam = s.renderer.camera;
    const W = window.innerWidth, H = window.innerHeight;
    const me = s.player.unit;
    let n = 0;
    const th = s.threat && s.time - s.threat.t < 8 ? s.threat.u : null;
    for (const t of s.world.tanks) {
      if (t.team === s.playerTeam || t.state !== 'active' || !s.visibleToPlayer(t)) continue;
      const v = t.centerWorld().project(cam);
      const x = (v.x * 0.5 + 0.5) * W;
      if (v.z < 1 && x > 0 && x < W) continue;
      const right = v.z < 1 ? x > W : t.pos.x > me.pos.x;
      let m = this.threatEls[n];
      if (!m) { m = el('div', 'threat-arrow'); this.threatLayer.appendChild(m); this.threatEls.push(m); }
      const fired = t.revealT > 9 || t === th;
      m.className = `threat-arrow ${right ? 'right' : 'left'} ${fired ? 'fired' : ''} ${s.player.lock === t ? 'locked' : ''}`;
      m.style.display = 'block';
      m.style.top = `${Math.min(H - 260, Math.max(150, (-v.y * 0.5 + 0.5) * H)) + n * 30}px`;
      const name = s.playerTeam === 'allies' && t.spec.id === 'pz4h' ? 'Mark IV' : t.spec.short;
      const d = Math.round(t.pos.distanceTo(me.pos));
      m.textContent = right ? `${name} ${d} m ▶` : `◀ ${name} ${d} m`;
      n++;
    }
    for (let k = n; k < this.threatEls.length; k++) this.threatEls[k].style.display = 'none';
    // lock bracket on the target
    const L = s.player.lock;
    if (L) {
      const c = (L.kind === 'tank' ? L.centerWorld() : L.center).project(cam);
      const x = (c.x * 0.5 + 0.5) * W, y = (-c.y * 0.5 + 0.5) * H;
      const on = c.z < 1 && x > 0 && x < W;
      this.lockMark.style.display = on ? 'block' : 'none';
      this.lockMark.style.left = `${x}px`;
      this.lockMark.style.top = `${y}px`;
    } else this.lockMark.style.display = 'none';
    // gunner's sight: on a lock, or while the right mouse button is held over a target
    const t = s.player.tank;
    const aimU = s.player.aim?.unit;
    const tgt = L ?? (s.input.rmb && aimU && aimU.team !== s.playerTeam ? aimU : null);
    if (this.sight) {
      const aim = s.player.aim;
      if (t && s.player.manualSight && aim) {
        // free sight: the telescope follows the mouse; the gun marker shows where the barrel is laid
        const u = aim.unit && aim.unit.team !== s.playerTeam ? aim.unit : null;
        const name = u ? (u.kind === 'tank' ? u.spec.short : u.role === 'at' || u.role === 'faust' ? 'AT team' : 'infantry') + ' · ' : '';
        const range = aim.point.distanceTo(t.muzzleWorld());
        this.sight.aimDir(s.player.sightEye, s.player.sightDir, s.player.sightFov, `${name}${Math.round(range)} m · ${(4 * (8 / s.player.sightFov)).toFixed(1)}× · ${t.loaded ? t.loaded.name + ' loaded' : 'loading…'}`);
        const round = t.loaded ?? getAmmo(t.selected);
        const muzzle = t.muzzleWorld();
        const gp = muzzle.clone().addScaledVector(t.boreDirWorld(), range);
        gp.y -= range * Math.tan(rangeTable(round).superelevation(range));
        this.sight.setGunMark(gp, t.layT > 0.2);
        this.sight.show(true, true);
      } else if (t && tgt) {
        const p = tgt.kind === 'tank' ? tgt.centerWorld() : tgt.center;
        const name = tgt.kind === 'tank' ? tgt.spec.short : tgt.role === 'at' || tgt.role === 'faust' ? 'AT team' : 'infantry';
        this.sight.aim(t.eyeWorld(), p, `${name} · ${Math.round(p.distanceTo(t.muzzleWorld()))} m · ${t.loaded ? t.loaded.name + ' loaded' : 'loading…'}`);
        this.sight.setGunMark(null, false);
        this.sight.show(true, false);
      } else this.sight.show(false, false);
    }
  }

  /** enemies the team knows about but the player cannot see right now: red "last seen" markers */
  private updateIntel() {
    const s = this.s;
    const cam = s.renderer.camera;
    const W = window.innerWidth, H = window.innerHeight;
    let n = 0;
    for (const i of s.world.perception.intel(s.playerTeam)) {
      const e = i.e;
      if (s.visibleToPlayer(e)) continue;
      if (e.kind === 'soldier' && !e.alive) continue;
      if (e.kind === 'tank' && e.state === 'destroyed') continue;
      const age = s.world.time - i.lastSeen;
      if (age > 30) continue;
      const v = i.pos.clone().add(new THREE.Vector3(0, e.kind === 'tank' ? 1.5 : 1, 0)).project(cam);
      if (v.z > 1) continue;
      const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
      if (x < -40 || x > W + 40) continue;
      let m = this.intelEls[n];
      if (!m) { m = el('div', 'intel-mark'); this.intelLayer.appendChild(m); this.intelEls.push(m); }
      m.style.display = 'block';
      m.style.left = `${x}px`;
      m.style.top = `${y}px`;
      m.style.opacity = String(Math.max(0.25, 1 - age / 30));
      m.className = `intel-mark ${e.kind}`;
      m.textContent = e.kind === 'tank' ? (i.heard ? 'tank?' : 'TANK') : i.heard ? '?' : '';
      n++;
    }
    for (let k = n; k < this.intelEls.length; k++) this.intelEls[k].style.display = 'none';
  }

  private updateXRay() {
    const r = this.s.xray;
    this.xrayBox.classList.toggle('hidden', !this.xrayOn || !r);
    if (!r || !this.xrayOn) return;
    this.xray.show(r);
    const o = r.outcome;
    const lines: string[] = [];
    lines.push(`<div class="xr-head ${r.severity >= 2 ? 'pen' : 'nopen'}">${r.headline}</div>`);
    lines.push(`<div><b>${r.ammo.name}</b> (${CLASS_LABEL[r.ammo.cls]}) from ${r.shooter} · ${r.range.toFixed(0)} m</div>`);
    if (o) {
      lines.push(`<div>${o.regionName}: ${o.nominalMm.toFixed(0)} mm ${o.material} · obliquity ${o.angleDeg.toFixed(0)}° · LoS ${o.losMm.toFixed(0)} mm</div>`);
      lines.push(`<div>Strike ${o.velocity.toFixed(0)} m/s · effective <b>${o.effectiveMm.toFixed(0)}</b> vs capability <b>${o.capabilityMm.toFixed(0)}</b> mm</div>`);
    } else if (r.partName) lines.push(`<div>${r.partName}</div>`);
    if (r.effects.length) lines.push(`<div class="xr-fx">${r.effects.join(' · ')}</div>`);
    this.xrayInfo.innerHTML = lines.join('');
  }

  dispose() {
    this.sight?.dispose();
    this.root.remove();
    this.s.renderer.overlays.length = 0;
  }
}

const HELP_HTML = `<h3>Controls</h3><div class="cols"><div><h4>Tank</h4>
<p><b>A / D</b> drive left / right — holding the other way reverses (slowly, as the real tanks did)</p><p><b>Double-tap A / D</b> or <b>T</b> turn around</p><p><b>W / S</b> change depth lane</p>
<p><b>Cursor at the screen edge</b> look further along the battlefield · <b>Q</b> recentre</p>
<p><b>Mouse</b> aim turret · <b>LMB</b> fire · <b>Space</b> coaxial MG</p><p><b>E</b> lock the nearest visible enemy (press again to cycle): the gun tracks it, the camera frames it and the gunner's sight opens</p><p><b>RMB</b> (hold, in a tank) free gunner's sight: the mouse turns the telescope, the turret follows, the ring shows where the gun is laid; <b>Wheel</b> magnification in the sight</p><p>On foot: <b>RMB</b> binocular view · <b>Wheel</b> zoom</p>
<p><b>1–5</b> next round (same key again: unload &amp; reload) · <b>R</b> swap round</p><p><b>B</b> button up / head out · <b>G</b> gyrostabilizer</p>
<p><b>F</b> leave the vehicle · <b>C</b> crew panel · <b>X</b> X-ray · <b>Tab</b> tactical map</p></div>
<div><h4>On foot</h4><p><b>A / D</b> move · <b>W / S</b> depth · <b>Shift</b> sprint</p><p><b>C</b> crouch · <b>LMB</b> fire · <b>R</b> reload · <b>1 / 2</b> weapons</p>
<p><b>G</b> grenade at cursor (Shift+G smoke)</p><p><b>F</b> board / re-crew a friendly vehicle · hold <b>E</b> help repair tracks</p>
<h4>Squads</h4><p><b>Z</b> follow me · <b>H</b> hold · <b>V</b> advance to cursor</p><p><b>Esc</b> pause · <b>F1</b> this help</p>
<p class="small">Realism mode: no hit markers or penetration hints; set the gun's range drum with <b>Shift+Wheel</b>.</p></div></div>`;

export { HELP_HTML };
export type { THREE };
