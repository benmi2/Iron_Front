const errors = [];
window.addEventListener('error', (e) => errors.push(e.message + ' ' + (e.error && e.error.stack || '').slice(0, 300)));
app.startCampaign();
await sleep(2000);
const s = app.session;
const me = s.player.tank;
s.resumeAI(me, { kind: 'advance', x: 330, z: -3 });
const samples = [];
for (let i = 0; i < 200; i++) {
  await sleep(500);
  const own = (id) => s.objectives.find(o => o.id === id).owner === 'allies';
  const ai = s.tankAIs.get(me);
  if (ai) ai.order = { kind: 'advance', x: !own('A') ? 340 : !own('B') ? 515 : 850, z: -3 };
  for (const sq of s.squads) if (sq.team === 'allies') sq.order = { kind: 'advance', x: !own('A') ? 350 : !own('B') ? 525 : 860, z: sq.order.z };
  if (i % 40 === 39) { await window.__shot(`a${i}`); samples.push({ t: s.time.toFixed(0), objs: s.objectives.map(o => `${o.id}:${o.owner}:${o.progress.toFixed(2)}`).join(' '), tanks: s.world.tanks.map(t => `${t.callsign}:${t.state[0]}:${t.pos.x.toFixed(0)}:${(s.tankAIs.get(t)||{}).status||''}`).join(' | '), inf: [s.world.soldiers.filter(x => x.team==='allies' && x.alive).length, s.world.soldiers.filter(x => x.team==='axis' && x.alive).length].join('/'), fps: Math.round(app.fps) }); }
  if (s.mode.result) break;
}
return { errors: errors.slice(0, 5), result: s.mode.result, samples, log: [...document.querySelectorAll('.ll')].map(e => e.textContent) };
