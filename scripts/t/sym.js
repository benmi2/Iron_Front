app.startCampaign();
await sleep(2500);
const s = app.session;
const w = s.world;
const me = s.player.tank;
const rows = [];
for (const x of [250, 330, 430, 500, 560]) {
  me.pos.x = x; me.pos.z = -3; me.speed = 0;
  await sleep(3500);
  const enemies = w.tanks.filter(t => t.team === 'axis' && t.alive).concat(w.soldiers.filter(so => so.team === 'axis' && so.alive));
  const near = enemies.filter(e => e.pos.distanceTo(me.pos) < 700);
  const iSee = near.filter(e => s.visibleToPlayer(e)).length;
  const seeMe = w.perception.known.axis.get(me);
  const shooters = near.filter(e => (e.kind === 'tank' ? (s.tankAIs.get(e)||{}).target === me : e.ai && e.ai.target === me)).length;
  rows.push(`x=${x}: enemies<700m ${near.length}, I see ${iSee}, enemy knows me: ${seeMe ? (seeMe.visible ? 'yes' : 'last seen') : 'no'}, enemies targeting me ${shooters}`);
}
return rows;
