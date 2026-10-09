// fixed composition for the visual pass: our Sherman and a Pz IV in the band, the village behind
app.startCampaign();
await sleep(2500);
const s = app.session;
const w = s.world;
const me = s.player.tank;
me.pos.x = 300; me.pos.z = -1.2; me.heading = 0;
const pz = w.tanks.find(t => t.team === 'axis');
pz.pos.x = 322; pz.pos.z = -9; pz.heading = Math.PI;
const ally = w.tanks.find(t => t.team === 'allies' && t !== me);
ally.pos.x = 286; ally.pos.z = -8;
for (const t of w.tanks) if (t !== me && t !== pz && t !== ally) t.pos.x += 2000;
for (const so of w.soldiers) so.pos.x += 2000;
s.visibleToPlayer = () => true;
await sleep(600);
s.paused = true;
// let fires and smoke columns develop
const fog = s.renderer.scene.fog;
for (let i = 0; i < 1500; i++) s.effects.update(1 / 60, fog);
s.cam.zoom = Number(globalThis.__zoom ?? 0.75);
s.cam.lookAhead = 6;
await sleep(1500);
const t0 = performance.now(); let frames = 0;
await new Promise(res => { const f = () => { frames++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
await window.__shot('a');
return { fps: Math.round(frames / 2), smoke: s.effects.particles.smoke.count, fire: s.effects.particles.fire.count, glow: s.effects.particles.glow.count };
