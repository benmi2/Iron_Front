app.startCampaign();
await sleep(2500);
const s = app.session;
const t = s.player.tank;
const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
const log = [];
const st = (label) => log.push(`${label}: x=${t.pos.x.toFixed(1)} z=${t.pos.z.toFixed(1)} hdg=${(t.heading*180/Math.PI).toFixed(0)} v=${(t.speed*3.6).toFixed(1)}km/h facing=${t.facing}`);
st('start');
// drive right
key('KeyD', true); await sleep(4000); st('D 4s'); key('KeyD', false); await sleep(1500);
// lane change toward camera while driving
key('KeyD', true); key('KeyS', true); await sleep(2500); st('D+S'); key('KeyS', false); await sleep(1500); st('D straight'); key('KeyD', false); await sleep(2000);
// press A: brake, turn around, drive left
key('KeyA', true); await sleep(9000); st('A 9s'); key('KeyA', false); await sleep(1500);
// shift+D: reverse toward the right keeping facing left
key('ShiftLeft', true); key('KeyD', true); await sleep(3000); st('Shift+D'); key('KeyD', false); key('ShiftLeft', false);
// edge scroll: cursor at the right edge for 3 s
app.input.ndcX = 0.97; app.input.ndcY = 0; app.input.mouseX = innerWidth * 0.985; app.input.mouseY = innerHeight / 2;
await sleep(3000);
log.push(`edge pan ${s.player.edgePan.toFixed(0)} m, lookAhead ${s.cam.lookAhead.toFixed(0)} m, view ${s.cam.viewWidth.toFixed(0)} m`);
await window.__shot('edge');
app.input.ndcX = 0.4; app.input.mouseX = innerWidth * 0.7;
await sleep(1200);
await window.__shot('aim');
return log;
