app.startCampaign();
await sleep(2500);
const s = app.session;
const w = s.world;
const me = s.player.tank;
for (const t of w.tanks) if (t.team === 'allies') { t.pos.x += 520; }
for (const so of w.soldiers) if (so.team === 'allies') so.pos.x += 520;
me.pos.z = -1.5;
const pz = w.tanks.find(t => t.callsign === 'Pz 312');
pz.pos.x = 610; pz.pos.z = -10;
const cam = s.renderer.camera;
const point = (p) => { const v = p.clone().project(cam); app.input.ndcX = v.x; app.input.ndcY = v.y; app.input.mouseX = (v.x*0.5+0.5)*innerWidth; app.input.mouseY = (-v.y*0.5+0.5)*innerHeight; };
s.cam.zoom = 1.05;
for (let i = 0; i < 160; i++) { point(pz.centerWorld()); await sleep(30); }
me.tryFire(w);
await sleep(70);
await window.__shot('fire');
await sleep(500);
await window.__shot('impact');
await sleep(2500);
await window.__shot('later');
return { fps: Math.round(app.fps), reports: w.reports.slice(-4).map(r => `${r.shooter}->${r.targetName}: ${r.headline} ${r.effects.join(',')}`) };
