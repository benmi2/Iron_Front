export type Team = 'allies' | 'axis';

export const enemyOf = (t: Team): Team => (t === 'allies' ? 'axis' : 'allies');

export const TEAM_LABEL: Record<Team, string> = { allies: 'Allied Forces', axis: 'Axis Forces' };
