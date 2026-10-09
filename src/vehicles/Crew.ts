import { RNG } from '../core/rng';
import type { Nation } from '../data/ammo';
import type { CrewRole } from '../data/vehicles';

/**
 * Crew skills (0..1). Skills change how well the crew operates the vehicle — ranging, laying,
 * loading rhythm, driving smoothness, observation, repairs — never the physics of the shells.
 */
export interface CrewSkills {
  gunnery: number;
  loading: number;
  driving: number;
  observation: number;
  repair: number;
}

export type CrewState = 'ok' | 'wounded' | 'dead' | 'bailed';

export interface CrewMember {
  id: string;
  name: string;
  rank: string;
  /** trained role */
  role: CrewRole;
  /** station currently manned (after casualties crew move up) */
  station: CrewRole | null;
  skills: CrewSkills;
  xp: number;
  state: CrewState;
  /** accumulated wound energy */
  wound: number;
}

const US_FIRST = ['James', 'Robert', 'John', 'William', 'Charles', 'George', 'Joseph', 'Frank', 'Edward', 'Harold', 'Walter', 'Ray', 'Henry', 'Earl', 'Paul', 'Lloyd', 'Carl', 'Floyd', 'Leo', 'Stanley'];
const US_LAST = ['Miller', 'Kowalski', 'Johnson', 'Hernandez', 'O\'Brien', 'Schultz', 'Walker', 'Rossi', 'Baker', 'Nelson', 'Murphy', 'Lewis', 'Novak', 'Carter', 'Dawson', 'Fisher', 'Hayes', 'Price', 'Reed', 'Sullivan'];
const DE_FIRST = ['Hans', 'Karl', 'Walter', 'Heinz', 'Kurt', 'Werner', 'Helmut', 'Ernst', 'Josef', 'Fritz', 'Otto', 'Günther', 'Willi', 'Rudolf', 'Herbert', 'Gerhard', 'Erich', 'Paul', 'Franz', 'Alfred'];
const DE_LAST = ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Hoffmann', 'Koch', 'Richter', 'Klein', 'Wolf', 'Neumann', 'Braun', 'Zimmermann', 'Krüger', 'Hartmann', 'Lange', 'Werner'];
const RU_FIRST = ['Ivan', 'Nikolai', 'Pyotr', 'Sergei', 'Aleksei', 'Mikhail', 'Vasily', 'Dmitri', 'Grigori', 'Yuri'];
const RU_LAST = ['Ivanov', 'Petrov', 'Smirnov', 'Kuznetsov', 'Popov', 'Sokolov', 'Lebedev', 'Kozlov', 'Novikov', 'Morozov'];

export const RANKS: Record<Nation, Record<CrewRole, string>> = {
  USA: { commander: 'Sgt.', gunner: 'Cpl.', loader: 'Pvt.', driver: 'T/5', radio: 'Pvt.' },
  GER: { commander: 'Fw.', gunner: 'Uffz.', loader: 'Pz.Schtz.', driver: 'Gefr.', radio: 'Gefr.' },
  USSR: { commander: 'Lt.', gunner: 'Sgt.', loader: 'Pvt.', driver: 'Sgt.', radio: 'Cpl.' },
  UK: { commander: 'Sgt.', gunner: 'L/Cpl.', loader: 'Tpr.', driver: 'Tpr.', radio: 'Tpr.' },
};

let crewSeq = 1;

export function makeCrewMember(nation: Nation, role: CrewRole, rng: RNG, level = 0.5): CrewMember {
  const [F, L] = nation === 'GER' ? [DE_FIRST, DE_LAST] : nation === 'USSR' ? [RU_FIRST, RU_LAST] : [US_FIRST, US_LAST];
  const s = () => Math.max(0.1, Math.min(0.95, level + rng.normal(0, 0.08)));
  return {
    id: `c${crewSeq++}_${Math.floor(rng.next() * 1e6)}`,
    name: `${rng.pick(F)} ${rng.pick(L)}`,
    rank: RANKS[nation][role],
    role, station: role,
    skills: { gunnery: s(), loading: s(), driving: s(), observation: s(), repair: s() },
    xp: 0, state: 'ok', wound: 0,
  };
}

/** Effectiveness of a crewman at a station: trained role 1.0, a stand-in is slower / less precise. */
export function stationEfficiency(m: CrewMember | null | undefined, station: CrewRole) {
  if (!m || m.state === 'dead' || m.state === 'bailed') return 0;
  const wounded = m.state === 'wounded' ? 0.6 : 1;
  const trained = m.role === station ? 1 : 0.6;
  return wounded * trained;
}
