app.startRange('m4a3_75w');
await sleep(2500);
const s = app.session;
const t = s.player.tank;
const target = s.world.tanks.find(x => x !== t);
const cam = s.renderer.camera;
const point = (p) => { const v = p.clone().project(cam); app.input.ndcX = v.x; app.input.ndcY = v.y; app.input.mouseX = (v.x*0.5+0.5)*innerWidth; app.input.mouseY = (-v.y*0.5+0.5)*innerHeight; };
const results = [];
for (const [dist, yaw, ammoKey] of [[300, 0, '1'], [300, 90, '1'], [500, 0, '2'], [150, 0, '1']]) {
  // place target
  const panel = document.querySelector('.range-panel');
  s.mode.cfg.distance = dist; s.mode.cfg.yaw = yaw; s.mode.spawnTarget();
  const tg = s.mode.target;
  t.selectAmmo(Object.keys(t.ammoCount)[Number(ammoKey)-1], true);
  for (let i = 0; i < 400; i++) { point(tg.centerWorld().add(new tg.pos.constructor(0, 0.3, 0))); await sleep(30); if (t.loaded && t.loaded.id === t.selected && t.layT > 0.5 && i > 40) break; }
  const before = s.world.reports.length;
  t.tryFire(s.world);
  await sleep(1500);
  const r = s.world.reports.slice(before);
  results.push({ dist, yaw, ammo: t.selected, reports: r.map(x => ({ h: x.headline, part: x.partName, o: x.outcome && { region: x.outcome.regionName, ang: +x.outcome.angleDeg.toFixed(1), los: +x.outcome.losMm.toFixed(0), eff: +x.outcome.effectiveMm.toFixed(0), cap: +x.outcome.capabilityMm.toFixed(0), v: +x.outcome.velocity.toFixed(0) }, fx: x.effects })) });
  await window.__shot(`d${dist}_y${yaw}`);
}
return results;
