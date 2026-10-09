// close framing, both tanks firing at each other
app.startCampaign();
await sleep(2500);
const s = app.session;
const w = s.world;
const me = s.player.tank;
me.pos.x = 300; me.pos.z = -1.2; me.heading = 0;
const pz = w.tanks.find(t => t.team === 'axis');
pz.pos.x = 330; pz.pos.z = -8; pz.heading = Math.PI;
for (const t of w.tanks) if (t !== me && t !== pz) t.pos.x += 2000;
for (const so of w.soldiers) so.pos.x += 2000;
for (const [t, ai] of s.tankAIs) ai.suspended = true;
s.visibleToPlayer = () => true;
const fog = s.renderer.scene.fog;
for (let i = 0; i < 1500; i++) s.effects.update(1 / 60, fog);
s.cam.zoom = 0.5; s.cam.autoZoom = 0;
const cam = s.renderer.camera;
const point = (p) => { const v = p.clone().project(cam); app.input.ndcX = v.x; app.input.ndcY = v.y; app.input.mouseX = (v.x*0.5+0.5)*innerWidth; app.input.mouseY = (-v.y*0.5+0.5)*innerHeight; };
for (let i = 0; i < 120; i++) { point(pz.centerWorld()); s.cam.autoZoom = 0; await sleep(25); }
await window.__shot('aim');
me.tryFire(w);
await sleep(60);
await window.__shot('fire');
await sleep(260);
await window.__shot('impact');
await sleep(1200);
await window.__shot('after');
return { fps: Math.round(app.fps), rep: w.reports.slice(-1).map(r => r.headline) };
