import type { Session } from '../game/Session';
import { DEPTH_MAX, DEPTH_MIN } from '../world/Terrain';

/**
 * Top-down tactical map: road, hedgerows, buildings, objectives, friendly units and only the
 * enemies someone on our side has spotted (last known positions fade).
 */
export class Minimap {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;

  constructor(private s: Session, w: number, h: number, private full: boolean) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d')!;
  }

  draw() {
    const s = this.s;
    const w = s.world;
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const me = s.player.unit;
    const span = this.full ? w.x1 - w.x0 + 40 : 420;
    const x0 = this.full ? w.x0 - 20 : me.pos.x - span / 2;
    const zSpan = this.full ? 90 : 70;
    const z0 = -46;
    const X = (x: number) => ((x - x0) / span) * W;
    const Z = (z: number) => ((z - z0) / zSpan) * H;
    ctx.fillStyle = '#3b4630';
    ctx.fillRect(0, 0, W, H);
    // field patches
    ctx.fillStyle = '#46543a';
    for (let x = Math.floor(x0 / 60) * 60; x < x0 + span; x += 60) if ((x / 60) % 2 === 0) ctx.fillRect(X(x), 0, (60 / span) * W, H);
    // depth band
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, Z(DEPTH_MIN), W, Z(DEPTH_MAX) - Z(DEPTH_MIN));
    // road
    const d = w.terrain.def;
    ctx.fillStyle = '#8a8270';
    ctx.fillRect(0, Z(d.roadZ - d.roadHalf), W, Z(d.roadZ + d.roadHalf) - Z(d.roadZ - d.roadHalf));
    // obstacles
    for (const o of w.obstacles) {
      if (o.destroyed && o.kind !== 'rubble') continue;
      if (o.cx + o.radius < x0 || o.cx - o.radius > x0 + span) continue;
      ctx.fillStyle = o.kind === 'house' ? '#8a6a4a' : o.kind === 'hedge' ? '#24301c' : o.kind === 'wall' ? '#9a9080' : o.kind === 'rubble' ? '#6a6050' : o.kind === 'wreck' ? '#2a2420' : o.kind === 'tree' ? '#2c3a22' : '#7a7058';
      ctx.fillRect(X(o.cx - o.hx), Z(o.cz - o.hz), Math.max(2, (o.hx * 2 / span) * W), Math.max(2, (o.hz * 2 / zSpan) * H));
    }
    // objectives
    for (const o of s.objectives) {
      const cx = X(o.x), cz = Z(o.z);
      ctx.save();
      ctx.translate(cx, cz);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = o.owner === 'allies' ? '#3a6ad8' : o.owner === 'axis' ? '#c83a32' : '#888';
      ctx.strokeStyle = '#eee';
      ctx.lineWidth = 1.5;
      ctx.fillRect(-7, -7, 14, 14);
      ctx.strokeRect(-7, -7, 14, 14);
      ctx.restore();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px Oswald, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(o.id, cx, cz + 1);
    }
    // units
    const friendly = s.playerTeam;
    for (const so of w.soldiers) {
      if (!so.alive || so.inTank) continue;
      const vis = so.team === friendly || s.visibleToPlayer(so);
      if (!vis) continue;
      ctx.fillStyle = so.team === friendly ? '#9ac0ff' : '#ff7a6a';
      ctx.fillRect(X(so.pos.x) - 1.5, Z(so.pos.z) - 1.5, 3, 3);
    }
    for (const t of w.tanks) {
      const vis = t.team === friendly || s.visibleToPlayer(t);
      let px = t.pos.x, pz = t.pos.z, faded = false;
      if (!vis) {
        const intel = w.perception.known[friendly].get(t);
        if (!intel) continue;
        px = intel.pos.x; pz = intel.pos.z; faded = true;
      }
      ctx.save();
      ctx.translate(X(px), Z(pz));
      ctx.rotate(-t.heading);
      ctx.globalAlpha = faded ? 0.45 : 1;
      ctx.fillStyle = !t.alive ? '#444' : t.team === friendly ? (t.isPlayer ? '#ffffff' : '#3a7aff') : '#ff3a2a';
      ctx.fillRect(-5, -3, 10, 6);
      ctx.fillRect(0, -1, 7, 2);
      ctx.restore();
    }
    if (!this.full) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      const vw = s.cam.viewWidth;
      ctx.strokeRect(X(me.pos.x + s.cam.lookAhead - vw / 2), Z(DEPTH_MIN - 2), (vw / span) * W, Z(DEPTH_MAX + 2) - Z(DEPTH_MIN - 2));
    }
    ctx.strokeStyle = 'rgba(220,210,190,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
  }
}
