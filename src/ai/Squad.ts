import type { Soldier } from '../infantry/Soldier';
import type { Tank } from '../vehicles/Tank';
import type { Team } from '../world/Team';

export type SquadOrderKind = 'advance' | 'hold' | 'follow' | 'retreat';

export interface SquadOrder {
  kind: SquadOrderKind;
  /** objective x along the battlefield */
  x: number;
  /** preferred depth */
  z?: number;
  /** unit to move with (a tank for "advance with armour", or the player) */
  follow?: Tank | Soldier | null;
}

let seq = 1;

/** A squad: members share an order and a formation; the leader's death makes the next man lead. */
export class Squad {
  readonly id = seq++;
  members: Soldier[] = [];
  order: SquadOrder;
  name: string;
  /** set when the squad has broken (casualties + suppression) */
  broken = false;

  constructor(readonly team: Team, name: string, order: SquadOrder) {
    this.name = name;
    this.order = order;
  }

  add(s: Soldier) {
    this.members.push(s);
    s.squad = this;
  }

  get alive() {
    return this.members.filter((m) => m.alive);
  }

  get leader() {
    return this.alive.find((m) => m.role === 'officer') ?? this.alive[0] ?? null;
  }

  get strength() {
    return this.members.length ? this.alive.length / this.members.length : 0;
  }

  get suppression() {
    const a = this.alive;
    return a.length ? a.reduce((s, m) => s + m.suppression, 0) / a.length : 0;
  }

  /** formation slot (x offset behind the anchor, depth) of a member */
  slot(s: Soldier): { dx: number; z: number } {
    const i = this.alive.indexOf(s);
    const n = Math.max(1, this.alive.length);
    const baseZ = this.order.z ?? -6;
    const row = i % 3;
    const col = Math.floor(i / 3);
    return { dx: -col * 5 - row * 1.5 - (i === 0 ? 0 : 2), z: baseZ + (row - 1) * 4.5 + ((i * 7) % 3) * 0.4 + (n > 6 ? 0 : 0) };
  }
}
