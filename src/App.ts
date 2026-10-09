import { Input } from './core/Input';
import { Renderer } from './render/Renderer';
import { AudioSys } from './audio/Audio';
import { Session, type Mode } from './game/Session';
import { CampaignNormandy } from './game/modes/Campaign';
import { SkirmishMode, type SkirmishConfig } from './game/modes/Skirmish';
import { DuelMode, type DuelConfig } from './game/modes/Duel';
import { FiringRangeMode } from './game/modes/FiringRange';
import { GarageScene } from './ui/GarageScene';
import { Menus } from './ui/Menus';
import { applyRewards, computeRewards, loadProfile, newProfile, saveProfile, type Profile } from './progression/Profile';

const STEP = 1 / 60;

/** Top-level flow: menus / garage ↔ battle, fixed-step simulation, rewards. */
export class App {
  readonly renderer: Renderer;
  readonly input: Input;
  readonly audio = new AudioSys();
  profile: Profile;
  readonly garage3d: GarageScene;
  readonly menus: Menus;
  session: Session | null = null;
  private acc = 0;
  private last = performance.now();
  private garageOn = true;
  fps = 60;

  constructor(container: HTMLElement) {
    this.renderer = new Renderer(container);
    this.input = new Input(this.renderer.renderer.domElement);
    this.profile = loadProfile();
    this.garage3d = new GarageScene(container);
    this.menus = new Menus(this);
    this.applySettings();
    this.menus.main();
    requestAnimationFrame((t) => this.frame(t));
    window.addEventListener('pointerdown', () => this.audio.start(), { once: true });
  }

  applySettings() {
    const s = this.profile.settings;
    this.audio.setVolume(s.volume);
    this.renderer.bloom.enabled = s.quality === 'high';
    this.renderer.sun.shadow.mapSize.set(s.quality === 'high' ? 4096 : 2048, s.quality === 'high' ? 2048 : 1024);
  }

  resetProfile() {
    this.profile = newProfile();
    saveProfile(this.profile);
  }

  showGarage(vehicleId: string, upgrades: string[] = []) {
    this.garageOn = true;
    this.garage3d.show(vehicleId, upgrades);
    this.renderer.setView(this.garage3d.scene, this.garage3d.camera);
  }

  /* ------------------------------------------------------------------ battles */

  private start(mode: Mode) {
    this.menus.clear();
    this.audio.start();
    this.garageOn = false;
    this.renderer.setView(this.renderer.scene, this.renderer.camera);
    const s = new Session(this.renderer, this.audio, this.input, mode, this.profile.settings.realism);
    s.hud.onExit = () => this.endBattle();
    this.session = s;
    this.acc = 0;
    this.renderer.renderer.domElement.style.cursor = 'none';
  }

  startCampaign() {
    this.start(new CampaignNormandy(this.profile));
  }

  startSkirmish(c: SkirmishConfig) {
    this.start(new SkirmishMode(this.profile, c));
  }

  startDuel(c: DuelConfig) {
    this.start(new DuelMode(this.profile, c));
  }

  startRange(vehicleId: string) {
    this.start(new FiringRangeMode(this.profile, vehicleId));
  }

  endBattle() {
    const s = this.session;
    if (!s) return;
    const mode = s.mode;
    let stats = null, rewards = null;
    if (!mode.sandbox) {
      const withdrew = !mode.result;
      if (!mode.result) { mode.result = 'lose'; mode.resultText = 'You withdrew from the battle.'; }
      stats = s.battleStats();
      stats.withdrew = withdrew;
      rewards = computeRewards(stats);
      applyRewards(this.profile, s.playerVehicleId, stats, rewards);
    }
    s.dispose();
    this.session = null;
    this.renderer.renderer.domElement.style.cursor = '';
    if (mode.sandbox) this.menus.garage();
    else this.menus.debrief(mode.title, mode.result, mode.resultText ?? (mode.result === 'win' ? 'Mission accomplished.' : 'Withdrawn.'), stats, rewards);
  }

  /* ------------------------------------------------------------------ loop */

  private frame(t: number) {
    requestAnimationFrame((tt) => this.frame(tt));
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    this.fps += (1 / Math.max(1e-3, dt) - this.fps) * 0.05;
    const s = this.session;
    if (s) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < 5) {
        s.update(STEP);
        this.acc -= STEP;
        n++;
      }
      if (n === 5) this.acc = 0;
      if (this.session === s) s.render(dt);
    } else {
      this.input.endStep();
      const c = this.renderer.renderer.domElement;
      this.garage3d.update(dt, c.clientWidth / Math.max(1, c.clientHeight));
      this.renderer.render(t / 1000, dt);
    }
  }
}
