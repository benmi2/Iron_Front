app.startCampaign();
await sleep(2500);
const s = app.session;
const w = s.world;
const me = s.player.tank;
// move the US force up to the edge of the village
const dx = 400;
for (const t of w.tanks) if (t.team === 'allies') t.pos.x += dx;
for (const so of w.soldiers) if (so.team === 'allies') so.pos.x += dx;
for (const o of s.objectives) if (o.id === 'A') { o.owner = 'allies'; o.progress = 1; }
const cam = s.renderer.camera;
const point = (p) => { const v = p.clone().project(cam); app.input.ndcX = v.x; app.input.ndcY = v.y; app.input.mouseX = (v.x*0.5+0.5)*innerWidth; app.input.mouseY = (-v.y*0.5+0.5)*innerHeight; };
await sleep(1500);
point(new me.pos.constructor(me.pos.x + 60, 2, -12));
await window.__shot('a');
s.cam.zoom = 1.6;
await sleep(6000);
await window.__shot('b');
await sleep(8000);
await window.__shot('c');
return { fps: app.fps, log: [...document.querySelectorAll('.ll')].map(e => e.textContent).slice(0, 7), shells: w.shells.shells.length, reports: w.reports.map(r => `${r.shooter} -> ${r.targetName}: ${r.headline} ${r.effects.join(',')}`) };
