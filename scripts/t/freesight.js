app.startCampaign();
await sleep(2500);
const s = app.session;
const t = s.player.tank;
const cv = document.querySelector('canvas');
const D = 180 / Math.PI;
const log = [];
const gm = () => { const g = document.querySelector('.gs-gun'); const r = g.getBoundingClientRect(); return `gun ring ${getComputedStyle(g).display} ${g.className} at ${r.left.toFixed(0)},${r.top.toFixed(0)} ${r.width}x${r.height}`; };
const st = (l) => log.push(`${l}: sightYaw=${(s.player.sightYaw*D).toFixed(1)} turretYaw=${(t.turretYaw*D).toFixed(1)} | ${gm()}`);
cv.dispatchEvent(new MouseEvent('mousedown', { button: 2, clientX: 800, clientY: 450, bubbles: true }));
await sleep(400); st('open');
for (let i = 0; i < 10; i++) { cv.dispatchEvent(new MouseEvent('mousemove', { movementX: 150, movementY: 0, bubbles: true })); await sleep(16); }
await sleep(150); st('moved +1500px');
await window.__shot('slew');
await sleep(3000); st('3 s later');
window.dispatchEvent(new MouseEvent('mouseup', { button: 2 }));
return log;
