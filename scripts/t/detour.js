app.startCampaign();
await sleep(2500);
const s = app.session, w = s.world;
const log = [];
// enemies hold fire so the test men are not shot on the way
for (const m of w.soldiers) if (m.team !== s.playerTeam) { m.ai = null; m.ctl.fire = false; }
for (const t of w.tanks) if (t.team !== s.playerTeam) { s.suspendAI(t); t.ctl.fire = false; t.ctl.mg = false; }
const runs = [
  { name: 'straight at house, centre', x: 455, z: -15, mx: 1, mz: 0 },
  { name: 'straight at house, back edge', x: 455, z: -17.5, mx: 1, mz: 0 },
  { name: 'from far side going left', x: 482, z: -14, mx: -1, mz: 0 },
  { name: 'diagonal into house', x: 458, z: -10, mx: 1, mz: -0.6 },
];
for (const r of runs) {
  const so = w.soldiers.find((m) => m.state === 'ok' && !m.isPlayer && m.team === s.playerTeam && !m.inTank && m.ai);
  so.ai = null;
  so.pos.set(r.x, w.terrain.height(r.x, r.z), r.z);
  so.vel.set(0, 0, 0);
  const t0 = performance.now();
  let passed = null;
  while (performance.now() - t0 < 20000) {
    so.ctl.moveX = r.mx; so.ctl.moveZ = r.mz; so.ctl.sprint = false; so.ctl.crouch = false;
    await sleep(100);
    if ((r.mx > 0 && so.pos.x > 478) || (r.mx < 0 && so.pos.x < 462)) { passed = ((performance.now() - t0) / 1000).toFixed(1); break; }
  }
  log.push(`${r.name} [${so.state}]: ${passed ? 'got past in ' + passed + ' s' : 'STUCK'} at x=${so.pos.x.toFixed(1)} z=${so.pos.z.toFixed(1)}`);
  so.ctl.moveX = so.ctl.moveZ = 0;
}
return log;
