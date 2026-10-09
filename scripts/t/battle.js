app.startCampaign();
await sleep(3500);
await window.__shot('start');
await sleep(4000);
const s = app.session;
return { fps: app.fps, tanks: s.world.tanks.length, soldiers: s.world.soldiers.length, obstacles: s.world.obstacles.length };
