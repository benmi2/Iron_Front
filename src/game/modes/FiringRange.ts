import type { TerrainDef } from '../../world/Terrain';
import type { Mode, Session } from '../Session';
import type { Profile } from '../../progression/Profile';
import { ensureVehicle } from '../../progression/Profile';
import { VEHICLES } from '../../data/vehicles';
import { ammo as getAmmo, CLASS_LABEL } from '../../data/ammo';
import { penCurve } from '../../ballistics/PenCurve';
import { rangeTable } from '../../ballistics/Flight';
import type { Tank } from '../../vehicles/Tank';
import { addTree } from '../../world/Props';
import type { ImpactReport } from '../../vehicles/DamageModel';

const RANGE_TERRAIN: TerrainDef = {
  x0: 0, x1: 2400, seed: 3, roadZ: -4, roadHalf: 3, hills: [], mud: [], farRiverZ: -170, village: [],
};

/**
 * Sandbox ballistics test: put any modelled vehicle at any range and angle, fire any round and
 * read the plate, obliquity, line-of-sight and effective thickness against the round's
 * capability — plus a side-by-side check of the simulated penetration against the documented
 * range table.
 */
export class FiringRangeMode implements Mode {
  id = 'range';
  title = 'Firing Range';
  subtitle = 'Ballistics test ground';
  terrain = RANGE_TERRAIN;
  timeLimit = 24 * 3600;
  tod = 'noon' as const;
  weather = 'clear' as const;
  playerTeam = 'allies' as const;
  result: 'win' | 'lose' | null = null;
  sandbox = true;
  briefing = ['Choose a target, its range and its angle; fire and inspect each impact in the X-ray view.'];
  private panel: HTMLElement | null = null;
  private target: Tank | null = null;
  private cfg = { model: 'pz4h', distance: 500, yaw: 0, z: -4 };
  private s!: Session;
  private shots: ImpactReport[] = [];

  constructor(private profile: Profile, private shooterId: string) {}

  setup(s: Session) {
    this.s = s;
    for (let x = 100; x < 2400; x += 100) addTree(s.world, x, -16, x, 'poplar');
    const rec = ensureVehicle(this.profile, this.shooterId)!;
    const pt = s.spawnTank(this.shooterId, 'allies', 80, -4, 0, { crew: rec.crew, upgrades: rec.upgrades, loadout: Object.fromEntries(Object.keys(rec.loadout).map((k) => [k, 99])), callsign: 'Range gun' });
    const me = s.spawnSoldier('allies', 'crew', 80, -4, 0.7, false);
    me.crewRecord = pt.seat('commander')?.occupant ?? null;
    s.setPlayer(me, pt);
    this.spawnTarget();
    s.world.events.tankHit = (t, r) => {
      if (t !== this.target) return;
      s.xray = r;
      s.hud.hitMarker(r, true);
      this.shots.unshift(r);
      this.renderLog();
    };
    this.buildPanel();
  }

  private spawnTarget() {
    const s = this.s;
    if (this.target) s.world.removeTank(this.target);
    // yaw 0 = facing the gun (the gun is to the west)
    const heading = Math.PI - (this.cfg.yaw * Math.PI) / 180;
    this.target = s.spawnTank(this.cfg.model, 'axis', 80 + this.cfg.distance, this.cfg.z, heading, { ai: false, crewLevel: 0.5 });
    this.target.buttoned = true;
  }

  private buildPanel() {
    const p = document.createElement('div');
    p.className = 'range-panel';
    const opts = Object.values(VEHICLES).filter((v) => v.status === 'playable').map((v) => `<option value="${v.id}" ${v.id === this.cfg.model ? 'selected' : ''}>${v.short}</option>`).join('');
    p.innerHTML = `<h3>Firing range</h3>
      <label>Target <select data-k="model">${opts}</select></label>
      <label>Range <input type="range" min="25" max="2000" step="25" value="${this.cfg.distance}" data-k="distance"><b data-v="distance">${this.cfg.distance} m</b></label>
      <label>Target angle <input type="range" min="0" max="180" step="5" value="${this.cfg.yaw}" data-k="yaw"><b data-v="yaw">${this.cfg.yaw}°</b></label>
      <div class="hint">0° = frontal, 90° = full side, 180° = rear</div>
      <div class="btns"><button data-a="spawn">Place target</button><button data-a="clear">Clear log</button></div>
      <div class="table-check"></div>
      <div class="shotlog"></div>`;
    p.addEventListener('input', (e) => {
      const i = e.target as HTMLInputElement;
      const k = i.dataset.k as keyof typeof this.cfg;
      if (!k) return;
      if (k === 'model') this.cfg.model = i.value;
      else (this.cfg as Record<string, number | string>)[k] = Number(i.value);
      const v = p.querySelector(`[data-v="${k}"]`);
      if (v) v.textContent = k === 'distance' ? `${i.value} m` : `${i.value}°`;
    });
    p.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).dataset.a;
      if (a === 'spawn') this.spawnTarget();
      if (a === 'clear') { this.shots = []; this.renderLog(); }
    });
    // keep keyboard focus off the sliders so the game controls keep working
    p.addEventListener('change', () => (document.activeElement as HTMLElement | null)?.blur());
    document.getElementById('ui')!.appendChild(p);
    this.panel = p;
    this.renderTableCheck();
  }

  private renderTableCheck() {
    const t = this.s.player?.tank;
    if (!t || !this.panel) return;
    const a = getAmmo(t.selected);
    const box = this.panel.querySelector('.table-check')!;
    if (!a.pen) {
      box.innerHTML = `<div class="tc-title">${a.name} (${CLASS_LABEL[a.cls]})${a.heat ? ` — shaped charge, ${a.heat.penMm} mm regardless of range` : ''}</div>`;
      return;
    }
    const c = penCurve(a);
    const rows = a.pen.rangesM.map((rg, i) => {
      const v = rangeTable(a).velocity(rg);
      const sim = c.atAngle(v, a.pen!.angleDeg);
      return `<tr><td>${rg} m</td><td>${v.toFixed(0)}</td><td>${a.pen!.mm[i]}</td><td>${sim.toFixed(0)}</td></tr>`;
    }).join('');
    box.innerHTML = `<div class="tc-title">${a.name}: documented vs simulated at ${a.pen.angleDeg}°</div><table><tr><th>Range</th><th>m/s</th><th>Doc.</th><th>Sim.</th></tr>${rows}</table><div class="src">${a.pen.criterion}</div>`;
  }

  private renderLog() {
    if (!this.panel) return;
    const box = this.panel.querySelector('.shotlog')!;
    box.innerHTML = this.shots.slice(0, 8).map((r) => {
      const o = r.outcome;
      return `<div class="shot ${r.severity >= 2 ? 'pen' : 'nopen'}"><b>${r.ammo.name}</b> ${r.range.toFixed(0)} m — ${r.headline}${o ? `<br>${o.regionName} ${o.nominalMm.toFixed(0)} mm @ ${o.angleDeg.toFixed(0)}° · LoS ${o.losMm.toFixed(0)} · eff ${o.effectiveMm.toFixed(0)} vs ${o.capabilityMm.toFixed(0)}` : ''}${r.effects.length ? `<br><i>${r.effects.join(', ')}</i>` : ''}</div>`;
    }).join('');
  }

  objectivesText() {
    return 'Sandbox — no objectives';
  }

  private lastSel = '';
  update() {
    const t = this.s.player?.tank;
    if (t && t.selected !== this.lastSel) {
      this.lastSel = t.selected;
      this.renderTableCheck();
    }
  }

  dispose() {
    this.panel?.remove();
  }
}
