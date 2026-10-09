const errors = [];
window.addEventListener('error', (e) => errors.push(e.message));
app.startCampaign();
await sleep(2000);
const s = app.session;
const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
const cam = s.renderer.camera;
const point = (p) => { const v = p.clone().project(cam); app.input.ndcX = v.x; app.input.ndcY = v.y; app.input.mouseX = (v.x*0.5+0.5)*innerWidth; app.input.mouseY = (-v.y*0.5+0.5)*innerHeight; };
key('KeyD', true);
const snaps = [];
for (let i = 0; i < 160; i++) {
  await sleep(500);
  const me = s.player.tank;
  if (me) {
    // aim at the nearest spotted enemy and fire
    const enemies = s.world.tanks.filter(t => t.team === 'axis' && t.alive && s.visibleToPlayer(t)).concat(s.world.soldiers.filter(x => x.team === 'axis' && x.alive && s.visibleToPlayer(x)));
    enemies.sort((a, b) => a.pos.distanceTo(me.pos) - b.pos.distanceTo(me.pos));
    if (enemies[0]) { point(enemies[0].kind === 'tank' ? enemies[0].centerWorld() : enemies[0].center); app.input.lmb = enemies[0].pos.distanceTo(me.pos) < 600; }
    else { app.input.lmb = false; point(me.pos.clone().add(new me.pos.constructor(60, 2, 0))); }
    // stop near objectives to let the infantry work
    const ahead = s.world.tanks.some(t => t.team === 'axis' && t.alive && s.visibleToPlayer(t) && t.pos.distanceTo(me.pos) < 500);
    key('KeyD', !ahead);
  }
  if (i % 30 === 29) { await window.__shot(`t${i}`); snaps.push(i); }
}
key('KeyD', false);
app.input.lmb = false;
return { errors, time: s.time.toFixed(0), fps: Math.round(app.fps), result: s.mode.result, objs: s.objectives.map(o => `${o.id}:${o.owner}`), stats: s.stats, me: s.player.tank ? { x: s.player.tank.pos.x.toFixed(0), state: s.player.tank.state, cond: s.player.tank.condition.toFixed(2) } : 'on foot', tanks: s.world.tanks.map(t => `${t.callsign}:${t.team}:${t.state}:${t.pos.x.toFixed(0)}`), soldiers: { allies: s.world.soldiers.filter(x => x.team==='allies' && x.alive).length, axis: s.world.soldiers.filter(x => x.team==='axis' && x.alive).length }, log: [...document.querySelectorAll('.ll')].map(e => e.textContent) };
