// close-ups of trees and village houses for prop modelling (enemies hold fire)
app.startCampaign();
await sleep(2500);
const s = app.session, w = s.world;
for (const m of w.soldiers) if (m.team !== s.playerTeam) { m.ai = null; m.ctl.fire = false; }
for (const t of w.tanks) if (t.team !== s.playerTeam) { s.suspendAI(t); t.ctl.fire = false; t.ctl.mg = false; }
const me = s.player.tank;
const go = async (x, z, zoom, name, wait = 2500) => {
  me.pos.x = x; me.pos.z = z;
  s.player.edgePan = 0;
  app.input.ndcX = 0; app.input.mouseX = innerWidth / 2;
  s.cam.zoom = zoom;
  await sleep(wait);
  await window.__shot(name);
};
await go(135, 0, 0.6, 'trees_poplar');
await go(315, -4, 0.6, 'trees_round');
await go(500, -4, 0.75, 'village_a');
await go(590, -4, 0.75, 'village_b');
await go(700, -4, 0.8, 'trees_mixed');
return 'ok';
