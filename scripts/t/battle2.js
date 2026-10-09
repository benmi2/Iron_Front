app.startCampaign();
await sleep(3000);
await window.__shot('start');
const s = app.session;
s.cam.zoom = 2.2;
await sleep(1500);
await window.__shot('wide');
return { fps: app.fps };
