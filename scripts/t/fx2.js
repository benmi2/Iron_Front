app.startRange('m4a3_75w');
await sleep(2000);
const s = app.session;
const P = s.effects.particles;
const p = s.player.tank.pos.clone(); p.x += 8; p.y = s.world.terrain.height(p.x, p.z);
s.world.explode(p, 0.68, null, true);
const t0 = performance.now();
const samples = [];
for (let i = 0; i < 8; i++) { await sleep(150); samples.push([Math.round(performance.now() - t0), P.fire.count, P.glow.count, P.smoke.count, Math.round(app.fps)]); }
return samples;
