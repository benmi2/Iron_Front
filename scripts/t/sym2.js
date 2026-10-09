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
  const tg = enemies.filter(e => (e.kind === 'tank' ? (s.tankAIs.get(e)||{}).target === me : e.ai && e.ai.target === me));
  const hidden = tg.filter(e => !s.visibleToPlayer(e)).map(e => {
    const eye = me.eyeWorld();
    const p = e.kind === 'tank' ? e.centerWorld() : e.center;
    return `${e.kind === 'tank' ? e.callsign : e.role}@${e.pos.distanceTo(me.pos).toFixed(0)}m vis=${w.visibility(eye, p).toFixed(2)} crouch=${e.crouch ? e.crouch.toFixed(1) : '-'} theirVis=${w.visibility(e.kind === 'tank' ? e.eyeWorld() : e.eye, me.centerWorld()).toFixed(2)}`;
  });
  rows.push(`x=${x}: targeting me ${tg.length}, hidden from me: ${hidden.join(' | ') || 'none'}`);
}
return rows;
