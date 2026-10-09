// close garage views of both tanks for the detail pass
const g = app.garage3d;
const out = {};
for (const id of ['m4a3_75w', 'pz4h']) {
  app.menus.garageVehicle = id;
  if (id === 'pz4h') app.profile.selected.GER = 'pz4h'; else app.profile.selected.USA = id;
  app.menus.garage();
  await sleep(2000);
  g.auto = false;
  for (const [n, yaw, pitch, dist] of [['fl', -0.7, 0.22, 9], ['rr', 2.3, 0.35, 8.5], ['side', -1.5708, 0.12, 8]]) {
    g.yaw = yaw; g.pitch = pitch; g.dist = dist;
    await sleep(400);
    await window.__shot(id + '_' + n);
  }
}
return out;
