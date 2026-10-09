import { VEHICLES, ROLE_LABEL, type VehicleSpec } from '../data/vehicles';
import { TECH_TREE, NATION_LABEL, type TreeNode } from '../data/techtree';
import { UPGRADE_BY_ID, upgradesFor, type UpgradeDef } from '../data/upgrades';
import { ammo as getAmmo, CLASS_LABEL, CLASS_DESC, type Nation } from '../data/ammo';
import { GUNS } from '../data/guns';
import { SOURCES, PROV_COLOR, PROV_LABEL, type Cite, type CitedValue } from '../data/provenance';
import {
  ACHIEVEMENTS, buy, buyUpgrade, canBuy, canResearch, ensureVehicle, rankOf, repairCost, repairVehicle, research, saveProfile, type Profile, type Rewards, type BattleStats,
} from '../progression/Profile';
import { DEFAULT_SKIRMISH, type SkirmishConfig } from '../game/modes/Skirmish';
import { DEFAULT_DUEL, type DuelConfig } from '../game/modes/Duel';
import type { App } from '../App';

const h = (html: string) => {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  return d.firstElementChild as HTMLElement;
};

const prov = (c: Cite) => `<span class="prov" style="--pc:${PROV_COLOR[c.prov]}" title="${PROV_LABEL[c.prov]}${c.note ? ' — ' + c.note.replace(/"/g, '&quot;') : ''}&#10;${c.src.map((s) => SOURCES[s]).join('&#10;')}">${PROV_LABEL[c.prov][0]}</span>`;
const cv = (v: CitedValue<number | string>, unit = '') => `${typeof v.value === 'number' ? v.value : v.value}${unit} ${prov(v)}`;

/**
 * Menu flow: main menu → garage (research tree, vehicle, crew, upgrades, loadout, workshop) →
 * mission setup / briefing → battle → debriefing.
 */
export class Menus {
  private root: HTMLElement;
  garageVehicle = 'm4a3_75w';
  private tab = 'specs';
  private treeNation: Nation = 'USA';

  constructor(private app: App) {
    this.root = document.getElementById('ui')!;
  }

  private get p(): Profile {
    return this.app.profile;
  }

  clear() {
    for (const e of [...this.root.querySelectorAll('.screen')]) e.remove();
  }

  private header() {
    const p = this.p;
    const r = rankOf(p);
    const pct = r.next ? ((p.xp - r.prev) / (r.next - r.prev)) * 100 : 100;
    return `<div class="topbar"><div class="logo">IRON FRONT</div>
      <div class="rank"><b>${r.name}</b><div class="xpbar"><i style="width:${pct}%"></i></div><small>${p.xp.toLocaleString()} XP${r.next ? ` / ${r.next.toLocaleString()}` : ''}</small></div>
      <div class="cur"><span title="Research points">RP <b>${p.rp.toLocaleString()}</b></span><span title="Requisition">Req. <b>${p.requisition.toLocaleString()}</b></span></div></div>`;
  }

  /* ================================================================== main menu */

  main() {
    this.clear();
    this.app.showGarage(this.p.selected[this.p.nation] ?? 'm4a3_75w');
    const s = h(`<div class="screen main-menu">${this.header()}
      <div class="mm-body">
        <h1>IRON FRONT</h1><h2>WWII · 2.5D combined-arms tank warfare</h2>
        <div class="mm-buttons">
          <button data-go="campaign" class="big">Historical battle<small>Normandy 1944 — Allied Advance</small></button>
          <button data-go="skirmish">Skirmish<small>configure a battle</small></button>
          <button data-go="duel">Tank duel<small>armour, angles, positioning</small></button>
          <button data-go="range">Firing range<small>ballistics test ground</small></button>
          <button data-go="garage">Garage<small>vehicles · research · crews · upgrades</small></button>
          <button data-go="settings">Settings</button>
          <button data-go="sources">Historical sources &amp; accuracy</button>
        </div>
        <p class="mm-note">Every shell is a simulated projectile; armour is modelled plate by plate from documented thicknesses and angles. Values are tagged <span class="prov" style="--pc:${PROV_COLOR.verified}">V</span> verified, <span class="prov" style="--pc:${PROV_COLOR.interpreted}">I</span> interpreted, <span class="prov" style="--pc:${PROV_COLOR.estimated}">E</span> estimated or <span class="prov" style="--pc:${PROV_COLOR.approximation}">S</span> simulation approximation.</p>
      </div></div>`);
    s.addEventListener('click', (e) => {
      const go = (e.target as HTMLElement).closest('button')?.dataset.go;
      if (!go) return;
      this.app.audio.start();
      if (go === 'campaign') this.briefing('campaign');
      else if (go === 'skirmish') this.briefing('skirmish');
      else if (go === 'duel') this.briefing('duel');
      else if (go === 'range') this.app.startRange(this.garageVehicle);
      else if (go === 'garage') this.garage();
      else if (go === 'settings') this.settings();
      else if (go === 'sources') this.sources();
    });
    this.root.appendChild(s);
  }

  /* ================================================================== garage */

  garage() {
    this.clear();
    const p = this.p;
    if (!p.owned.includes(this.garageVehicle)) this.garageVehicle = p.owned[0];
    const spec = VEHICLES[this.garageVehicle];
    const rec = ensureVehicle(p, this.garageVehicle)!;
    this.app.showGarage(this.garageVehicle, rec.upgrades);
    const s = h(`<div class="screen garage">${this.header()}
      <div class="g-left">
        <div class="nation-tabs">${(['USA', 'GER', 'USSR'] as Nation[]).map((n) => `<button data-nation="${n}" class="${n === this.treeNation ? 'on' : ''}">${NATION_LABEL[n]}</button>`).join('')}</div>
        <div class="tree">${this.tree()}</div>
      </div>
      <div class="g-center garage-drag"><div class="g-title">${spec.name}<small>${spec.nation === 'USA' ? 'United States' : 'Germany'} · ${spec.year} · BR ${spec.br}</small></div>
        <label class="armour-toggle"><input type="checkbox" ${this.app.garage3d.armourView ? 'checked' : ''} data-armour> Armour thickness view</label>
        <div class="legend">${[10, 20, 30, 50, 80, 100, 150].map((mm) => `<span style="--c:${mmColor(mm)}">${mm}</span>`).join('')}<em>mm</em></div></div>
      <div class="g-right">
        <div class="tabs">${['specs', 'armour', 'crew', 'upgrades', 'ammo', 'workshop'].map((t) => `<button data-tab="${t}" class="${t === this.tab ? 'on' : ''}">${t}</button>`).join('')}</div>
        <div class="tab-body">${this.tabBody(spec)}</div>
      </div>
      <div class="g-bottom"><button data-go="back">◂ Main menu</button><button data-go="range">Test at the firing range</button><button data-go="campaign" class="deploy">Deploy ▸</button></div>
    </div>`);
    s.addEventListener('click', (e) => this.garageClick(e));
    s.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.armour !== undefined) this.app.garage3d.setArmourView(t.checked);
      if (t.dataset.ammo) {
        const r = ensureVehicle(this.p, this.garageVehicle)!;
        r.loadout[t.dataset.ammo] = Number(t.value);
        const cap = VEHICLES[this.garageVehicle].ammoCapacity.value;
        const total = Object.values(r.loadout).reduce((a, b) => a + b, 0);
        if (total > cap) r.loadout[t.dataset.ammo] -= total - cap;
        saveProfile(this.p);
        this.garage();
      }
    });
    this.root.appendChild(s);
  }

  private tree() {
    const p = this.p;
    const nodes = TECH_TREE.filter((n) => n.nation === this.treeNation);
    const eras = [...new Set(nodes.map((n) => (n.year <= 1941 ? 'Early war (1939–41)' : n.year <= 1943 ? 'Mid war (1942–43)' : 'Late war (1944–45)')))];
    return eras.map((era) => {
      const list = nodes.filter((n) => (n.year <= 1941 ? 'Early war (1939–41)' : n.year <= 1943 ? 'Mid war (1942–43)' : 'Late war (1944–45)') === era).sort((a, b) => a.br - b.br);
      return `<div class="era"><h4>${era}</h4>${list.map((n) => this.node(n, p)).join('')}</div>`;
    }).join('');
  }

  private node(n: TreeNode, p: Profile) {
    const owned = p.owned.includes(n.id);
    const researched = p.researched.includes(n.id);
    const state = owned ? 'owned' : researched ? 'researched' : n.requires.every((r) => p.researched.includes(r)) ? 'available' : 'locked';
    let act = '';
    if (n.status === 'planned') act = `<span class="planned" title="This vehicle is in the progression tree but its armour geometry, components and ballistics have not been built yet. It cannot be deployed.">in development</span>`;
    else if (owned) act = `<button data-select="${n.id}" class="${this.garageVehicle === n.id ? 'on' : ''}">${this.garageVehicle === n.id ? 'Selected' : 'Select'}</button>`;
    else if (researched) act = `<button data-buy="${n.id}" ${canBuy(p, n.id) ? '' : 'disabled'}>Buy ${n.cost.toLocaleString()}</button>`;
    else act = `<button data-research="${n.id}" ${canResearch(p, n.id) ? '' : 'disabled'}>Research ${n.rp.toLocaleString()} RP</button>`;
    if (n.status === 'planned' && !researched && state !== 'locked') act = `<button data-research="${n.id}" ${canResearch(p, n.id) ? '' : 'disabled'}>Research ${n.rp.toLocaleString()} RP</button>` + act;
    return `<div class="node ${state} ${n.status}"><div class="nn">${n.name}<small>${n.cls} · ${n.year} · BR ${n.br.toFixed(1)}</small></div><div class="ng">${n.gun}</div><div class="na">${act}</div></div>`;
  }

  private tabBody(spec: VehicleSpec) {
    const rec = ensureVehicle(this.p, spec.id)!;
    switch (this.tab) {
      case 'specs': {
        const g = GUNS[spec.gun];
        return `<table class="spec">
          <tr><td>Combat weight</td><td>${cv(spec.massT, ' t')}</td></tr>
          <tr><td>Engine</td><td>${spec.engine}<br>${cv(spec.enginePowerKw, ' kW')}</td></tr>
          <tr><td>Transmission</td><td>${spec.transmission}</td></tr><tr><td>Steering</td><td>${spec.steering}</td></tr>
          <tr><td>Max speed road / off-road</td><td>${cv(spec.maxSpeedKmh, ' km/h')} / ${cv(spec.offroadKmh, ' km/h')}</td></tr>
          <tr><td>Reverse</td><td>${cv(spec.reverseKmh, ' km/h')}</td></tr>
          <tr><td>Turning radius</td><td>${cv(spec.turnRadiusM, ' m')}</td></tr>
          <tr><td>Main gun</td><td>${g.name}</td></tr>
          <tr><td>Elevation</td><td>${spec.elevation.value[0]}° … +${spec.elevation.value[1]}° ${prov(spec.elevation)}</td></tr>
          <tr><td>Turret traverse</td><td>${cv(spec.traverseDegS, '°/s')} powered · ${cv(spec.manualTraverseDegS, '°/s')} by hand</td></tr>
          <tr><td>Rate of fire</td><td>${g.rofRpm.value[0]}–${g.rofRpm.value[1]} rpm ${prov(g.rofRpm)}</td></tr>
          <tr><td>Main-gun rounds</td><td>${cv(spec.ammoCapacity)}</td></tr>
          ${spec.stabilizer ? `<tr><td>Stabilizer</td><td>${spec.stabilizer.value} ${prov(spec.stabilizer)}</td></tr>` : ''}
          <tr><td>Length (hull / gun)</td><td>${cv(spec.dims.lengthHull, ' m')} / ${cv(spec.dims.lengthGun, ' m')}</td></tr>
          <tr><td>Width · height</td><td>${cv(spec.dims.width, ' m')} · ${cv(spec.dims.height, ' m')}</td></tr>
          <tr><td>Crew</td><td>${spec.crew.map((c) => ROLE_LABEL[c]).join(', ')}</td></tr>
        </table><div class="hist">${spec.history.map((t) => `<p>${t}</p>`).join('')}</div>`;
      }
      case 'armour':
        return `<table class="spec armour"><tr><th>Plate</th><th>mm</th><th>Angle</th><th></th></tr>${spec.armour.map((a) => `<tr><td>${a.plate}</td><td><b>${a.mm}</b> <small>${a.material}</small></td><td>${typeof a.angle === 'number' ? `${a.angle}°` : a.angle}</td><td>${prov(a.cite)}</td></tr>`).join('')}</table>
          <p class="small">Angles from vertical. The simulation uses full 3-D plates; this table is the reference schedule they were built from. Toggle the armour view to see thickness on the model.</p>`;
      case 'crew':
        return `<div class="crew-cards">${rec.crew.map((c) => `<div class="cc"><div class="cn">${c.rank} ${c.name}<small>${ROLE_LABEL[c.role]} · ${c.xp} XP</small></div>${(['gunnery', 'loading', 'driving', 'observation', 'repair'] as const).map((k) => `<div class="sk"><span>${k}</span><i style="width:${c.skills[k] * 100}%"></i><b>${Math.round(c.skills[k] * 100)}</b></div>`).join('')}</div>`).join('')}</div>
          <p class="small">Skills change how the crew operates the tank — ranging, laying, loading rhythm, driving, spotting, repairs — never the physics of the shells.</p>`;
      case 'upgrades': {
        const ups = upgradesFor(spec.id);
        const cats = ['firepower', 'mobility', 'protection', 'crew', 'reliability'];
        return cats.map((c) => {
          const list = ups.filter((u) => u.cat === c);
          if (!list.length) return '';
          return `<h4>${c}</h4>${list.map((u) => this.upgradeCard(u, rec.upgrades.includes(u.id))).join('')}`;
        }).join('') + '<p class="small">Upgrades are tagged documented (period production change or field modification), maintenance or training. None changes a shell\'s penetration or a plate\'s thickness beyond what existed.</p>';
      }
      case 'ammo': {
        const g = GUNS[spec.gun];
        const total = Object.values(rec.loadout).reduce((a, b) => a + b, 0);
        // tungsten APCR was rationed; everything else the gun fired was standard issue
        const limit = (id: string) => (id === 'pzgr40_kwk40' ? (rec.upgrades.includes('ammo_pzgr40') ? 6 : 3) : spec.ammoCapacity.value);
        return `<div class="loadout">${g.ammo.map((id) => {
          const a = getAmmo(id);
          const max = limit(id);
          const n = Math.min(max, rec.loadout[id] ?? 0);
          return `<div class="ld"><div class="ln"><b>${a.name}</b> <small>${CLASS_LABEL[a.cls]}</small><br><small>${a.designation}</small></div>
            <div class="lv">${a.massKg.value} kg ${prov(a.massKg)} · ${a.muzzleVelocity.value} m/s ${prov(a.muzzleVelocity)}${a.pen ? `<br>${a.pen.mm[0]} mm @ ${a.pen.rangesM[0]} m, ${a.pen.angleDeg}° ${prov(a.pen.cite)}` : a.heat ? `<br>${a.heat.penMm} mm (any range) ${prov(a.heat.cite)}` : ''}</div>
            <input type="range" min="0" max="${max}" value="${n}" data-ammo="${id}"><b class="cnt">${n}</b>
            <div class="ldesc">${CLASS_DESC[a.cls]}</div></div>`;
        }).join('')}<div class="ltotal">${total} / ${spec.ammoCapacity.value} rounds stowed</div></div>`;
      }
      case 'workshop': {
        const cost = repairCost(rec);
        return `<div class="workshop"><p>Mechanical wear: <b>${Math.round(rec.wear * 100)}%</b> — a worn engine loses up to 10 % of its power and worn sights add dispersion.</p>
          <button data-repair ${cost === 0 || this.p.requisition < cost ? 'disabled' : ''}>Workshop overhaul (${cost} req.)</button>
          <p>Battles: ${rec.battles} · Kills: ${rec.kills} · Vehicle XP: ${rec.xp}</p>
          <h4>Achievements</h4>${Object.entries(ACHIEVEMENTS).map(([k, v]) => `<div class="ach ${this.p.achievements.includes(k) ? 'got' : ''}">${v}</div>`).join('')}</div>`;
      }
    }
    return '';
  }

  private upgradeCard(u: UpgradeDef, owned: boolean) {
    const p = this.p;
    const afford = p.rp >= u.rp && p.requisition >= u.cost;
    return `<div class="up ${owned ? 'owned' : ''}"><div class="un"><b>${u.name}</b> <span class="kind ${u.kind}">${u.kind}</span>${u.cite ? prov(u.cite) : ''}</div><div class="ud">${u.desc}</div><div class="ue">${u.effect}</div>
      ${owned ? '<span class="got">installed</span>' : `<button data-upgrade="${u.id}" ${afford ? '' : 'disabled'}>${u.rp} RP · ${u.cost} req.</button>`}</div>`;
  }

  private garageClick(e: Event) {
    const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!t) return;
    const d = t.dataset;
    const p = this.p;
    if (d.nation) { this.treeNation = d.nation as Nation; this.garage(); }
    if (d.tab) { this.tab = d.tab; this.garage(); }
    if (d.select) {
      this.garageVehicle = d.select;
      p.selected[VEHICLES[d.select].nation] = d.select;
      p.nation = VEHICLES[d.select].nation === 'GER' ? 'GER' : 'USA';
      saveProfile(p);
      this.garage();
    }
    if (d.research) { research(p, d.research); this.garage(); }
    if (d.buy) { buy(p, d.buy); this.garage(); }
    if (d.upgrade) { buyUpgrade(p, this.garageVehicle, d.upgrade); this.garage(); }
    if (d.repair !== undefined) { repairVehicle(p, this.garageVehicle); this.garage(); }
    if (d.go === 'back') this.main();
    if (d.go === 'range') this.app.startRange(this.garageVehicle);
    if (d.go === 'campaign') this.briefing(VEHICLES[this.garageVehicle].nation === 'USA' ? 'campaign' : 'skirmish');
  }

  /* ================================================================== briefing / setup */

  briefing(kind: 'campaign' | 'skirmish' | 'duel') {
    this.clear();
    const p = this.p;
    const owned = p.owned.filter((id) => VEHICLES[id]?.status === 'playable');
    const opt = (list: string[], sel: string) => list.map((id) => `<option value="${id}" ${id === sel ? 'selected' : ''}>${VEHICLES[id].short}</option>`).join('');
    const playable = Object.values(VEHICLES).filter((v) => v.status === 'playable').map((v) => v.id);
    let body = '';
    if (kind === 'campaign') {
      body = `<h2>Normandy 1944 — Allied Advance</h2><h3>Saint-Martin-des-Champs · July 1944</h3>
        <div class="brief">
          <p>July 1944. The bocage south of the beachhead has cost us dearly. Your Sherman leads 2nd Platoon with a rifle company in support.</p>
          <p><b>Objectives:</b> clear the crossroads farm <b>(A)</b>, take the village square <b>(B)</b>, secure the walled château farm <b>(C)</b> and break the German armoured counter-attack.</p>
          <p><b>Intelligence:</b> MG 42 nests, Panzerfaust and Panzerschreck teams in the village; Panzer IV Ausf. H tanks. Expect a counter-attack once the square falls.</p>
          <p><b>Advice:</b> advance with the infantry — they find the anti-tank teams before those find you. Use HE against guns and men in houses, keep M61 for armour. The Panzer IV's 50 mm turret front is its weak spot; its 80 mm hull front is not.</p>
        </div><p class="small">Vehicle: <b>${VEHICLES[p.selected.USA ?? 'm4a3_75w'].short}</b> (from your garage, with its crew, upgrades and loadout).</p>`;
    } else if (kind === 'skirmish') {
      const c = DEFAULT_SKIRMISH;
      body = `<h2>Skirmish</h2><form class="cfg">
        <label>Side <select name="side"><option value="allies">United States</option><option value="axis">Germany</option></select></label>
        <label>Your tank <select name="playerTank">${opt(owned, this.garageVehicle)}</select></label>
        <label>Friendly tanks <input type="number" name="friendlyTanks" min="0" max="5" value="${c.friendlyTanks}"> of <select name="friendlyModel">${opt(playable, c.friendlyModel)}</select></label>
        <label>Enemy tanks <input type="number" name="enemyTanks" min="1" max="6" value="${c.enemyTanks}"> of <select name="enemyModel">${opt(playable, c.enemyModel)}</select></label>
        <label>Infantry squads per side <input type="number" name="squads" min="0" max="4" value="${c.squads}"></label>
        <label>AI crews <select name="difficulty"><option value="0.35">Green</option><option value="0.5" selected>Regular</option><option value="0.7">Veteran</option><option value="0.85">Elite</option></select></label>
        <label>Time of day <select name="tod"><option value="morning">Morning</option><option value="noon">Noon</option><option value="evening" selected>Evening</option><option value="dusk">Dusk</option></select></label>
        <label>Weather <select name="weather"><option value="clear">Clear</option><option value="overcast">Overcast</option><option value="rain">Rain</option><option value="mist">Mist</option></select></label>
        <label>Ammunition <select name="ammo"><option value="full">Full stowage</option><option value="limited">Limited (40 %)</option></select></label>
        <p class="small">Only fully modelled vehicles can be deployed. Opposing side: the other nation's vehicles are used even if you choose the same model.</p></form>`;
    } else {
      const c = DEFAULT_DUEL;
      body = `<h2>Tank duel</h2><form class="cfg">
        <label>Your tank <select name="playerTank">${opt(owned, this.garageVehicle)}</select></label>
        <label>Opponent <select name="enemyModel">${opt(playable, c.enemyModel)}</select></label>
        <label>Tanks per side <input type="number" name="count" min="1" max="3" value="1"></label>
        <label>Starting distance <input type="number" name="distance" min="150" max="1400" step="50" value="${c.distance}"> m</label>
        <label>Enemy crew <select name="difficulty"><option value="0.35">Green</option><option value="0.5" selected>Regular</option><option value="0.75">Veteran</option></select></label>
        <label>Time of day <select name="tod"><option value="morning">Morning</option><option value="noon" selected>Noon</option><option value="evening">Evening</option><option value="dusk">Dusk</option></select></label>
        <label>Weather <select name="weather"><option value="clear">Clear</option><option value="overcast">Overcast</option><option value="mist">Mist</option></select></label></form>`;
    }
    const s = h(`<div class="screen briefing">${this.header()}<div class="b-body">${body}
      <div class="controls-hint">Keys: A/D drive (hold the other way = reverse, double-tap = turn around) · W/S lanes · cursor at screen edge looks further · Q recentre · mouse aim · LMB fire · 1–5 ammo · RMB sight view · F leave/board vehicle · X X-ray · Tab map · Esc pause · F1 help</div>
      <div class="b-btns"><button data-a="back">◂ Back</button><button data-a="go" class="deploy">Begin ▸</button></div></div></div>`);
    s.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('button')?.dataset.a;
      if (a === 'back') this.main();
      if (a === 'go') {
        const f = s.querySelector('form') as HTMLFormElement | null;
        const v = (n: string) => (f?.elements.namedItem(n) as HTMLInputElement | null)?.value;
        if (kind === 'campaign') this.app.startCampaign();
        else if (kind === 'skirmish') {
          const side = v('side') as 'allies' | 'axis';
          let enemyModel = v('enemyModel')!, playerTank = v('playerTank')!, friendlyModel = v('friendlyModel')!;
          // keep nations historically consistent: the axis side fields German vehicles, the allies American
          const usTank = 'm4a3_75w', deTank = 'pz4h';
          if (side === 'allies') { if (VEHICLES[playerTank].nation !== 'USA') playerTank = usTank; if (VEHICLES[friendlyModel].nation !== 'USA') friendlyModel = usTank; if (VEHICLES[enemyModel].nation !== 'GER') enemyModel = deTank; }
          else { if (VEHICLES[playerTank].nation !== 'GER') playerTank = deTank; if (VEHICLES[friendlyModel].nation !== 'GER') friendlyModel = deTank; if (VEHICLES[enemyModel].nation !== 'USA') enemyModel = usTank; }
          const c: SkirmishConfig = {
            side, playerTank, friendlyTanks: Number(v('friendlyTanks')), friendlyModel, enemyTanks: Number(v('enemyTanks')), enemyModel,
            squads: Number(v('squads')), difficulty: Number(v('difficulty')), tod: v('tod') as SkirmishConfig['tod'], weather: v('weather') as SkirmishConfig['weather'], ammo: v('ammo') as 'full' | 'limited',
          };
          this.app.startSkirmish(c);
        } else {
          const playerTank = v('playerTank')!;
          const side = VEHICLES[playerTank].nation === 'GER' ? 'axis' : 'allies';
          let enemyModel = v('enemyModel')!;
          if (VEHICLES[enemyModel].nation === VEHICLES[playerTank].nation) enemyModel = side === 'allies' ? 'pz4h' : 'm4a3_75w';
          const c: DuelConfig = { side, playerTank, enemyModel, count: Number(v('count')), distance: Number(v('distance')), difficulty: Number(v('difficulty')), tod: v('tod') as DuelConfig['tod'], weather: v('weather') as DuelConfig['weather'] };
          this.app.startDuel(c);
        }
      }
    });
    this.root.appendChild(s);
  }

  /* ================================================================== debriefing */

  debrief(title: string, result: 'win' | 'lose' | null, text: string, stats: BattleStats | null, r: Rewards | null) {
    this.clear();
    const s = h(`<div class="screen debrief">${this.header()}<div class="d-body">
      <h1 class="${result ?? ''}">${result === 'win' ? 'VICTORY' : result === 'lose' ? 'DEFEAT' : 'BATTLE ENDED'}</h1><h3>${title}</h3><p>${text}</p>
      ${stats ? `<div class="d-stats"><span>Tanks knocked out <b>${stats.tankKills}</b></span><span>Penetrations <b>${stats.penetrations}</b></span><span>Assists <b>${stats.assists}</b></span><span>Infantry <b>${stats.softKills}</b></span><span>Objectives <b>${stats.objectives}</b></span><span>Time <b>${Math.floor(stats.timeS / 60)}:${String(Math.floor(stats.timeS % 60)).padStart(2, '0')}</b></span></div>` : ''}
      ${r ? `<table class="rewards">${r.lines.map(([l, n]) => `<tr><td>${l}</td><td>+${n} XP</td></tr>`).join('')}<tr class="tot"><td>Total</td><td>+${r.xp} XP · +${r.rp} RP · +${r.requisition} req.</td></tr></table>${r.promoted ? `<div class="promo">Promoted to <b>${r.promoted}</b>!</div>` : ''}` : ''}
      <div class="b-btns"><button data-a="garage">Garage ▸</button><button data-a="menu">Main menu</button></div></div></div>`);
    s.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('button')?.dataset.a;
      if (a === 'garage') this.garage();
      if (a === 'menu') this.main();
    });
    this.root.appendChild(s);
  }

  /* ================================================================== settings & sources */

  settings() {
    this.clear();
    const st = this.p.settings;
    const s = h(`<div class="screen briefing">${this.header()}<div class="b-body"><h2>Settings</h2><form class="cfg">
      <label>Master volume <input type="range" name="volume" min="0" max="1" step="0.05" value="${st.volume}"></label>
      <label>Realism mode (no hit markers / penetration hints, manual range drum) <input type="checkbox" name="realism" ${st.realism ? 'checked' : ''}></label>
      <label>Graphics quality <select name="quality"><option value="high" ${st.quality === 'high' ? 'selected' : ''}>High (bloom, 4K shadows)</option><option value="medium" ${st.quality === 'medium' ? 'selected' : ''}>Medium</option></select></label>
      <label>Reset all progression <button type="button" data-a="reset" class="danger">Reset profile</button></label></form>
      <div class="b-btns"><button data-a="back">◂ Back</button></div></div></div>`);
    s.addEventListener('input', () => {
      const f = s.querySelector('form') as HTMLFormElement;
      st.volume = Number((f.elements.namedItem('volume') as HTMLInputElement).value);
      st.realism = (f.elements.namedItem('realism') as HTMLInputElement).checked;
      st.quality = (f.elements.namedItem('quality') as HTMLSelectElement).value as 'high' | 'medium';
      this.app.applySettings();
      saveProfile(this.p);
    });
    s.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('button')?.dataset.a;
      if (a === 'back') this.main();
      if (a === 'reset' && confirm('Erase all progression (rank, research, vehicles, crews)?')) { this.app.resetProfile(); this.main(); }
    });
    this.root.appendChild(s);
  }

  sources() {
    this.clear();
    const s = h(`<div class="screen briefing">${this.header()}<div class="b-body sources"><h2>Historical sources &amp; accuracy</h2>
      <p>Every number used by the simulation is stored with a provenance tag and its sources. Hover a tag anywhere in the garage to read them.</p>
      <ul class="provs">${(['verified', 'interpreted', 'estimated', 'approximation'] as const).map((k) => `<li><span class="prov" style="--pc:${PROV_COLOR[k]}">${PROV_LABEL[k][0]}</span> <b>${PROV_LABEL[k]}</b> — ${({ verified: 'stated directly by the cited reference(s)', interpreted: 'derived from cited references (conversion, choosing between disagreeing sources)', estimated: 'no reference found yet; a reasoned estimate, flagged for review', approximation: 'a simulation-model parameter, not a historical fact' })[k]}</li>`).join('')}</ul>
      <h3>Penetration model</h3><p>Kinetic rounds use their documented range tables (range, plate angle, test criterion). Each range is flown through the in-game drag model to get the striking velocity; the table becomes a penetration-vs-velocity curve. At impact the true plate obliquity and line-of-sight thickness are measured on 3-D armour plates; the effective thickness uses Ballistic Armour Lab's obliquity model with overmatch, material factors and the shatter gap. HEAT uses documented jet penetration independent of range; HE breaches only thin plate (FM 5-250 steel-cutting rule). Behind the armour, the residual penetrator, spall cone, HEAT jet and HE filler are traced through the crew and component volumes.</p>
      <h3>References</h3><ul class="refs">${Object.entries(SOURCES).map(([k, v]) => `<li><code>${k}</code> ${v}</li>`).join('')}</ul>
      <div class="b-btns"><button data-a="back">◂ Back</button></div></div></div>`);
    s.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')?.dataset.a === 'back') this.main();
    });
    this.root.appendChild(s);
  }
}

function mmColor(mm: number) {
  const stops: [number, string][] = [[0, '#405090'], [20, '#3373cc'], [40, '#26b3b3'], [60, '#59cc59'], [80, '#d9d940'], [110, '#f28c26'], [160, '#e63326'], [250, '#bf268c']];
  let c = stops[0][1];
  for (const [v, col] of stops) if (mm >= v) c = col;
  return c;
}

export { UPGRADE_BY_ID };
