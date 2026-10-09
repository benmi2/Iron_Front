// look up at the sky (cloud / sun disc tuning)
app.startCampaign();
await sleep(2000);
const s = app.session;
s.paused = true;
s.cam.update = () => {};
const cam = s.renderer.camera;
const sk = s.renderer.skyMat ?? null;
const pitch = Number(window.__pitch ?? 0.12);
cam.position.set(300, 8, 45);
cam.lookAt(300 + 0, 8 + Math.tan(pitch) * 100, 45 - 100);
await sleep(800);
await window.__shot('up');
cam.lookAt(300 + 30, 8 + Math.tan(0.05) * 100, 45 - 100);
await sleep(600);
await window.__shot('sun');
