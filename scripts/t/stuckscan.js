// battle running normally: count AI soldiers that want to move but have not moved for 5 s
app.startCampaign();
await sleep(2500);
const s = app.session, w = s.world;
const last = new Map();
const report = [];
for (let k = 0; k < 12; k++) {
  await sleep(5000);
  let moving = 0, stuck = 0;
  const where = [];
  for (const m of w.soldiers) {
    if (!m.alive || m.inTank || m.isPlayer || !m.ai) continue;
    const p = last.get(m);
    const wants = Math.hypot(m.ctl.moveX, m.ctl.moveZ) > 0.3;
    if (wants) moving++;
    if (p && wants && Math.hypot(m.pos.x - p.x, m.pos.z - p.z) < 0.5 && m.suppression < 0.8) { stuck++; where.push(`${m.team[0]}@${m.pos.x.toFixed(0)},${m.pos.z.toFixed(1)}`); }
    last.set(m, { x: m.pos.x, z: m.pos.z });
  }
  report.push(`t=${(k + 1) * 5}s moving=${moving} stuck=${stuck} ${where.slice(0, 6).join(' ')}`);
}
return report;
