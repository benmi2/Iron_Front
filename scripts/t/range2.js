app.startRange('m4a3_75w');
await sleep(2500);
const s = app.session;
const t = s.player.tank;
const cam = s.renderer.camera;
const point = (p) => { const v = p.clone().project(cam); app.input.ndcX = v.x; app.input.ndcY = v.y; };
const out = [];
s.mode.cfg.distance = 300; s.mode.cfg.yaw = 90; s.mode.spawnTarget();
const tg = s.mode.target;
for (let i = 0; i < 200; i++) { point(tg.centerWorld()); await sleep(30); }
out.push({ loaded: t.loaded && t.loaded.id, layT: t.layT, aim: s.player.aim && s.player.aim.point.toArray().map(v=>+v.toFixed(1)), aimUnit: s.player.aim && s.player.aim.unit && s.player.aim.unit.callsign, tg: tg.pos.toArray().map(v=>+v.toFixed(1)), yaw: t.turretYaw, elev: t.gunElev });
const fired = t.tryFire(s.world);
const sh = s.world.shells.shells[0];
const track = [];
for (let i = 0; i < 12; i++) { await sleep(60); if (sh) track.push([sh.pos.x.toFixed(1), sh.pos.y.toFixed(2), sh.pos.z.toFixed(2), sh.alive]); }
out.push({ fired, track, reports: s.world.reports.map(r => r.headline) });
return out;
