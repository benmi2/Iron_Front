import * as THREE from 'three';
import type { Tank } from '../vehicles/Tank';

/**
 * Procedural battlefield audio (WebAudio, no samples): every sound is synthesised, so it is
 * original by construction. Distance attenuation, stereo pan and speed-of-sound delay for
 * distant reports ("you see the flash before you hear the gun").
 */

interface EngineVoice {
  osc: OscillatorNode;
  osc2: OscillatorNode;
  noise: AudioBufferSourceNode;
  nf: BiquadFilterNode;
  clank: GainNode;
  clankOsc: OscillatorNode;
  gain: GainNode;
  pan: StereoPannerNode;
  alive: boolean;
}

export class AudioSys {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private comp!: DynamicsCompressorNode;
  private noiseBuf!: AudioBuffer;
  private engines = new Map<Tank, EngineVoice>();
  private ambT = 3;
  readonly listener = new THREE.Vector3();
  volume = 0.8;
  enabled = true;
  private recent = 0;

  /** must be called from a user gesture */
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.ratio.value = 6;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.comp).connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // wind bed
    const wind = this.noiseSrc(true);
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 380;
    const wg = ctx.createGain();
    wg.gain.value = 0.035;
    wind.connect(wf).connect(wg).connect(this.master);
    wind.start();
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private noiseSrc(loop = false) {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = loop;
    if (!loop) s.playbackRate.value = 0.9 + Math.random() * 0.2;
    return s;
  }

  /** spatial chain → master; returns [input node, start time] or null if inaudible */
  private spatial(pos: THREE.Vector3, loud: number, maxDist = 1500): [GainNode, number] | null {
    if (!this.ctx || !this.enabled) return null;
    const d = pos.distanceTo(this.listener);
    if (d > maxDist) return null;
    const g = this.ctx.createGain();
    g.gain.value = loud / (1 + d / 18) ** 1.15;
    if (g.gain.value < 0.002) return null;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-0.9, Math.min(0.9, (pos.x - this.listener.x) / 45));
    // distance muffles high frequencies
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(500, 16000 / (1 + d / 120));
    g.connect(lp).connect(p).connect(this.master);
    const t = this.ctx.currentTime + Math.min(3, d / 343);
    return [g, t];
  }

  private burst(dst: AudioNode, t: number, dur: number, type: BiquadFilterType, f0: number, f1: number, gain: number, q = 0.7) {
    const ctx = this.ctx!;
    const n = this.noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g).connect(dst);
    n.start(t, Math.random() * 1.5);
    n.stop(t + dur + 0.05);
  }

  private tone(dst: AudioNode, t: number, dur: number, type: OscillatorType, f0: number, f1: number, gain: number, attack = 0.004) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dst);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /* ------------------------------------------------------------------ weapons */

  cannon(pos: THREE.Vector3, caliberMm: number, blast = 1) {
    const s = this.spatial(pos, 1.6 * blast);
    if (!s) return;
    const [g, t] = s;
    const k = caliberMm / 75;
    this.burst(g, t, 0.025, 'highpass', 3000, 2000, 1.2);
    this.tone(g, t, 0.55 * k, 'sine', 70 / k, 28, 1.4);
    this.burst(g, t, 1.4 * k, 'lowpass', 2400, 160, 1.1);
    this.burst(g, t + 0.18, 2.4, 'lowpass', 600, 90, 0.25); // echo off the village
  }

  explosion(pos: THREE.Vector3, kg: number) {
    const s = this.spatial(pos, 1.3 + Math.min(2, kg));
    if (!s) return;
    const [g, t] = s;
    const k = Math.min(3, 0.6 + Math.cbrt(kg));
    this.burst(g, t, 0.04, 'highpass', 2500, 1500, 0.9);
    this.tone(g, t, 0.9 * k, 'sine', 55, 22, 1.5);
    this.burst(g, t, 2.2 * k, 'lowpass', 1800, 70, 1.2);
    this.burst(g, t + 0.3, 3, 'lowpass', 400, 60, 0.3);
  }

  mg(pos: THREE.Vector3, german: boolean) {
    const s = this.spatial(pos, 0.45);
    if (!s) return;
    const [g, t] = s;
    this.burst(g, t, german ? 0.035 : 0.05, 'bandpass', german ? 2200 : 1500, 500, 1.3, 1.2);
    this.tone(g, t, 0.06, 'square', 140, 60, 0.15);
  }

  gunshot(pos: THREE.Vector3, id: string) {
    const s = this.spatial(pos, id === 'garand' || id === 'kar98k' || id === 'bar' ? 0.7 : 0.45);
    if (!s) return;
    const [g, t] = s;
    const rifle = id === 'garand' || id === 'kar98k' || id === 'bar' || id === 'mg42';
    this.burst(g, t, 0.018, 'highpass', 4000, 2500, 1.0);
    this.burst(g, t, rifle ? 0.5 : 0.25, 'lowpass', rifle ? 3000 : 1800, 200, rifle ? 0.9 : 0.6);
    if (id === 'garand' && Math.random() < 0.12) this.tone(g, t + 0.25, 0.25, 'sine', 3200, 3100, 0.12); // en-bloc ping
  }

  rocket(pos: THREE.Vector3) {
    const s = this.spatial(pos, 0.9);
    if (!s) return;
    const [g, t] = s;
    this.burst(g, t, 0.9, 'bandpass', 900, 300, 1.2, 0.6);
    this.tone(g, t, 0.5, 'sawtooth', 120, 60, 0.25);
  }

  reload(pos: THREE.Vector3) {
    const s = this.spatial(pos, 0.25, 60);
    if (!s) return;
    const [g, t] = s;
    this.burst(g, t, 0.05, 'bandpass', 2500, 2000, 0.6, 3);
    this.burst(g, t + 0.5, 0.06, 'bandpass', 1800, 1500, 0.7, 3);
  }

  flyby(pos: THREE.Vector3, speed: number) {
    const s = this.spatial(pos, 0.9, 40);
    if (!s) return;
    const [g, t] = s;
    const sup = speed > 340;
    if (sup) this.burst(g, t, 0.03, 'highpass', 3500, 2500, 0.9);
    this.burst(g, t, 0.45, 'bandpass', 1400, 350, 1.1, 1.5);
  }

  whiz(pos: THREE.Vector3) {
    if (this.recent > 6) return;
    this.recent++;
    const s = this.spatial(pos, 0.35, 10);
    if (!s) return;
    const [g, t] = s;
    this.tone(g, t, 0.12, 'sine', 3400, 1400, 0.2);
    this.burst(g, t, 0.03, 'highpass', 5000, 3000, 0.4);
  }

  ping(pos: THREE.Vector3) {
    const s = this.spatial(pos, 0.25, 120);
    if (!s) return;
    const [g, t] = s;
    this.tone(g, t, 0.18, 'sine', 2600 + Math.random() * 800, 2200, 0.25);
  }

  impact(pos: THREE.Vector3, kind: 'track' | 'ricochet' | 'clang' | 'pen' | 'dirt' | 'masonry' | 'smoke' | 'crunch') {
    const s = this.spatial(pos, kind === 'pen' || kind === 'clang' ? 1.4 : 0.9);
    if (!s) return;
    const [g, t] = s;
    switch (kind) {
      case 'clang':
      case 'track':
        for (const [f, a] of [[410, 0.6], [1130, 0.4], [2210, 0.25], [3370, 0.15]] as [number, number][]) this.tone(g, t, 0.9, 'sine', f * (0.9 + Math.random() * 0.2), f * 0.97, a, 0.002);
        this.burst(g, t, 0.15, 'bandpass', 2400, 900, 1.2, 1);
        break;
      case 'ricochet':
        this.tone(g, t, 0.15, 'sine', 900, 700, 0.6);
        this.tone(g, t + 0.02, 0.7, 'sine', 3600, 700, 0.35, 0.01);
        this.burst(g, t, 0.2, 'bandpass', 3000, 1200, 0.8, 2);
        break;
      case 'pen':
        for (const [f, a] of [[300, 0.7], [870, 0.45], [1900, 0.3]] as [number, number][]) this.tone(g, t, 0.7, 'sine', f, f * 0.95, a, 0.002);
        this.burst(g, t, 0.6, 'lowpass', 2000, 200, 1.4);
        break;
      case 'dirt':
        this.burst(g, t, 0.5, 'lowpass', 1200, 120, 1.0);
        break;
      case 'masonry':
        this.burst(g, t, 0.6, 'lowpass', 2600, 300, 1.1);
        this.burst(g, t + 0.1, 1.0, 'bandpass', 900, 300, 0.4, 1);
        break;
      case 'smoke':
        this.burst(g, t, 0.8, 'bandpass', 800, 1600, 0.4, 0.8);
        break;
      case 'crunch':
        this.burst(g, t, 0.35, 'bandpass', 900, 300, 0.7, 1.4);
        break;
    }
  }

  /* ------------------------------------------------------------------ engines */

  engine(t: Tank, running: boolean, speed: number, throttle: number) {
    if (!this.ctx || !this.enabled) return;
    const d = t.pos.distanceTo(this.listener);
    let v = this.engines.get(t);
    if (!running || d > 260) {
      if (v) { this.stopEngine(v); this.engines.delete(t); }
      return;
    }
    if (!v) {
      v = this.makeEngine(t.spec.id === 'pz4h');
      this.engines.set(t, v);
    }
    const now = this.ctx.currentTime;
    const rpm = 0.35 + 0.65 * Math.min(1, speed / 8 + throttle * 0.35);
    const base = t.spec.id === 'pz4h' ? 46 : 38;
    v.osc.frequency.setTargetAtTime(base * (0.7 + rpm), now, 0.15);
    v.osc2.frequency.setTargetAtTime(base * 1.5 * (0.7 + rpm), now, 0.15);
    v.nf.frequency.setTargetAtTime(300 + rpm * 700, now, 0.2);
    v.clankOsc.frequency.setTargetAtTime(Math.max(0.1, speed * 5.5), now, 0.1);
    v.clank.gain.setTargetAtTime(Math.min(0.5, speed * 0.08), now, 0.1);
    const loud = (t.isPlayer ? 0.55 : 0.4) / (1 + d / 20);
    v.gain.gain.setTargetAtTime(loud * (0.6 + 0.4 * rpm), now, 0.1);
    v.pan.pan.setTargetAtTime(Math.max(-0.9, Math.min(0.9, (t.pos.x - this.listener.x) / 45)), now, 0.1);
  }

  private makeEngine(german: boolean): EngineVoice {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    gain.connect(pan).connect(this.master);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const osc2 = ctx.createOscillator();
    osc2.type = german ? 'square' : 'triangle';
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const og = ctx.createGain();
    og.gain.value = 0.35;
    osc.connect(lp);
    osc2.connect(lp);
    lp.connect(og).connect(gain);
    const noise = this.noiseSrc(true);
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 500;
    const ng = ctx.createGain();
    ng.gain.value = 0.25;
    noise.connect(nf).connect(ng).connect(gain);
    // track clatter: noise gated by a low-frequency square (link impacts)
    const clankNoise = this.noiseSrc(true);
    const cbp = ctx.createBiquadFilter();
    cbp.type = 'bandpass';
    cbp.frequency.value = 1800;
    cbp.Q.value = 1.5;
    const clank = ctx.createGain();
    clank.gain.value = 0;
    const gate = ctx.createGain();
    gate.gain.value = 0;
    const clankOsc = ctx.createOscillator();
    clankOsc.type = 'square';
    clankOsc.frequency.value = 0.1;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    clankOsc.connect(depth).connect(gate.gain);
    clankNoise.connect(cbp).connect(gate).connect(clank).connect(gain);
    osc.start(); osc2.start(); noise.start(); clankNoise.start(); clankOsc.start();
    return { osc, osc2, noise, nf, clank, clankOsc, gain, pan, alive: true };
  }

  private stopEngine(v: EngineVoice) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    v.gain.gain.setTargetAtTime(0, t, 0.2);
    for (const n of [v.osc, v.osc2, v.noise, v.clankOsc]) n.stop(t + 1);
  }

  stopAllEngines() {
    for (const v of this.engines.values()) this.stopEngine(v);
    this.engines.clear();
  }

  /* ------------------------------------------------------------------ ambience */

  update(dt: number) {
    this.recent = Math.max(0, this.recent - dt * 10);
    if (!this.ctx || !this.enabled) return;
    this.ambT -= dt;
    if (this.ambT <= 0) {
      this.ambT = 3 + Math.random() * 9;
      // distant artillery / tank guns beyond the horizon
      const far = this.listener.clone().add(new THREE.Vector3((Math.random() - 0.3) * 2500, 0, -600 - Math.random() * 1500));
      const s = this.spatial(far, 60, 5000);
      if (s) {
        const [g, t] = s;
        this.tone(g, t, 2.5, 'sine', 45, 25, 1);
        this.burst(g, t, 3.5, 'lowpass', 300, 50, 1);
      }
    }
  }
}
