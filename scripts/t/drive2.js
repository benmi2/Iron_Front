app.startCampaign();
await sleep(2500);
const s = app.session;
const t = s.player.tank;
const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
const out = [];
const st = (label) => out.push(`${label}: x=${t.pos.x.toFixed(1)} z=${t.pos.z.toFixed(1)} hdg=${(t.heading*180/Math.PI).toFixed(1)} v=${(t.speed*3.6).toFixed(1)}`);
// wobble check: drive and sample heading
key('KeyD', true);
const hd = [];
for (let i = 0; i < 40; i++) { await sleep(100); hd.push(t.heading * 180 / Math.PI); }
const swings = hd.slice(10).reduce((a, h, i, arr) => a + (i > 1 && Math.sign(arr[i] - arr[i-1]) !== Math.sign(arr[i-1] - arr[i-2]) && Math.abs(arr[i]-arr[i-1]) > 0.05 ? 1 : 0), 0);
out.push(`straight: heading range ${Math.min(...hd.slice(10)).toFixed(2)}..${Math.max(...hd.slice(10)).toFixed(2)} deg, direction swings ${swings}`);
// lane change and back
key('KeyW', true); await sleep(1800); key('KeyW', false);
const hd2 = [];
for (let i = 0; i < 30; i++) { await sleep(100); hd2.push(t.heading * 180 / Math.PI); }
out.push(`after lane change: heading settles ${hd2.slice(-10).map(h => h.toFixed(1)).join(',')}`);
st('lane');
key('KeyD', false); await sleep(2500); st('stopped');
// hold A = reverse
key('KeyA', true); await sleep(3000); st('hold A 3s (reverse)'); key('KeyA', false); await sleep(1500);
// double-tap A = turn around, then hold A drives left
key('KeyA', true); await sleep(80); key('KeyA', false); await sleep(120); key('KeyA', true);
await sleep(10000); st('double-tap A + hold 10s'); key('KeyA', false);
await sleep(500);
// what can the player see ahead?
s.player.tank.pos.x = 280; await sleep(2500);
const vis = s.world.soldiers.filter(x => x.team === 'axis' && x.alive && s.visibleToPlayer(x)).length + '/' + s.world.soldiers.filter(x => x.team === 'axis' && x.alive && x.pos.x < 420).length;
out.push(`at x=280: axis soldiers visible to player ${vis}`);
app.input.ndcX = 0.5; app.input.mouseX = innerWidth * 0.75; app.input.ndcY = -0.1; app.input.mouseY = innerHeight * 0.55;
await sleep(1500);
await window.__shot('see');
return out;
