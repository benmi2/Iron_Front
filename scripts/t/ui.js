app.startCampaign();
await sleep(2500);
const s = app.session;
s.cam.zoom = 0.42;
const sq = s.world.soldiers.filter(x => x.team === 'allies' && x.role !== 'crew');
s.player.exitTank();
s.player.soldier.pos.set(sq[3].pos.x + 2, 0, sq[3].pos.z + 1);
await sleep(2500);
await window.__shot('inf');
app.endBattle();
await sleep(800);
await window.__shot('debrief');
app.menus.garage();
await sleep(1200);
for (const tab of ['armour', 'crew', 'upgrades', 'ammo']) {
  document.querySelector(`[data-tab="${tab}"]`).click();
  await sleep(500);
  if (tab === 'armour') document.querySelector('[data-armour]').click();
  await sleep(600);
  await window.__shot(`g_${tab}`);
}
return 'ok';
