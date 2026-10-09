import type { Nation } from './ammo';

/**
 * Research trees. The order is a GAMEPLAY unlock order grouped by historical era — not a claim
 * that one vehicle evolved into the next. `status: 'planned'` vehicles are in the tree (so the
 * progression path is visible) but are not yet modelled with full armour geometry, components
 * and ballistics, and therefore cannot be deployed. Nothing is faked to fill the gap.
 */

export interface TreeNode {
  id: string;
  name: string;
  nation: Nation;
  cls: 'light' | 'medium' | 'heavy' | 'td';
  /** historical service year (first combat use of this variant) */
  year: number;
  /** battle rating used for matchmaking / skirmish limits */
  br: number;
  /** research cost (RP) and purchase price (requisition) */
  rp: number;
  cost: number;
  /** ids that must be researched first */
  requires: string[];
  status: 'playable' | 'planned';
  /** main gun summary (for the tree card) */
  gun: string;
  note?: string;
}

export const TECH_TREE: TreeNode[] = [
  // ---------------------------------------------------------------- USA
  { id: 'm3_stuart', name: 'M3 Stuart', nation: 'USA', cls: 'light', year: 1941, br: 1.7, rp: 0, cost: 0, requires: [], status: 'planned', gun: '37 mm M6' },
  { id: 'm5_stuart', name: 'M5A1 Stuart', nation: 'USA', cls: 'light', year: 1943, br: 2.3, rp: 2500, cost: 9000, requires: ['m3_stuart'], status: 'planned', gun: '37 mm M6' },
  { id: 'm3_lee', name: 'M3 Lee', nation: 'USA', cls: 'medium', year: 1942, br: 2.7, rp: 4000, cost: 14000, requires: ['m3_stuart'], status: 'planned', gun: '75 mm M2 + 37 mm M6' },
  { id: 'm4a3_75w', name: 'M4A3(75)W Sherman', nation: 'USA', cls: 'medium', year: 1944, br: 3.7, rp: 0, cost: 0, requires: [], status: 'playable', gun: '75 mm M3', note: 'Starter vehicle of the Normandy campaign.' },
  { id: 'm4a1_76', name: 'M4A1(76)W Sherman', nation: 'USA', cls: 'medium', year: 1944, br: 4.3, rp: 9000, cost: 26000, requires: ['m4a3_75w'], status: 'planned', gun: '76 mm M1' },
  { id: 'm4a3e2', name: 'M4A3E2 Jumbo', nation: 'USA', cls: 'medium', year: 1944, br: 4.7, rp: 13000, cost: 34000, requires: ['m4a1_76'], status: 'planned', gun: '75 mm M3' },
  { id: 'm4a3e8', name: 'M4A3E8 Sherman', nation: 'USA', cls: 'medium', year: 1944, br: 4.7, rp: 14000, cost: 36000, requires: ['m4a1_76'], status: 'planned', gun: '76 mm M1' },
  { id: 'm26', name: 'M26 Pershing', nation: 'USA', cls: 'heavy', year: 1945, br: 5.7, rp: 26000, cost: 60000, requires: ['m4a3e8'], status: 'planned', gun: '90 mm M3' },
  // ---------------------------------------------------------------- Germany
  { id: 'pz2', name: 'Pz.Kpfw. II Ausf. F', nation: 'GER', cls: 'light', year: 1941, br: 1.3, rp: 0, cost: 0, requires: [], status: 'planned', gun: '2 cm KwK 30' },
  { id: 'pz3', name: 'Pz.Kpfw. III Ausf. J', nation: 'GER', cls: 'medium', year: 1942, br: 2.3, rp: 3000, cost: 10000, requires: ['pz2'], status: 'planned', gun: '5 cm KwK 39' },
  { id: 'pz4f2', name: 'Pz.Kpfw. IV Ausf. F2', nation: 'GER', cls: 'medium', year: 1942, br: 3.3, rp: 5500, cost: 17000, requires: ['pz3'], status: 'planned', gun: '7.5 cm KwK 40 L/43' },
  { id: 'pz4h', name: 'Pz.Kpfw. IV Ausf. H', nation: 'GER', cls: 'medium', year: 1943, br: 3.7, rp: 0, cost: 0, requires: [], status: 'playable', gun: '7.5 cm KwK 40 L/48', note: 'Starter vehicle of the German campaign.' },
  { id: 'stug3g', name: 'StuG III Ausf. G', nation: 'GER', cls: 'td', year: 1943, br: 3.7, rp: 7000, cost: 20000, requires: ['pz4f2'], status: 'planned', gun: '7.5 cm StuK 40 L/48' },
  { id: 'pantherd', name: 'Panther Ausf. D', nation: 'GER', cls: 'medium', year: 1943, br: 5.0, rp: 15000, cost: 40000, requires: ['pz4h'], status: 'planned', gun: '7.5 cm KwK 42 L/70' },
  { id: 'pantherg', name: 'Panther Ausf. G', nation: 'GER', cls: 'medium', year: 1944, br: 5.3, rp: 19000, cost: 47000, requires: ['pantherd'], status: 'planned', gun: '7.5 cm KwK 42 L/70', note: 'Armour stations exist in Ballistic Lab — next to port.' },
  { id: 'tiger1', name: 'Tiger I Ausf. E', nation: 'GER', cls: 'heavy', year: 1942, br: 5.3, rp: 20000, cost: 52000, requires: ['pz4h'], status: 'planned', gun: '8.8 cm KwK 36 L/56', note: 'Armour stations exist in Ballistic Lab — next to port.' },
  { id: 'tiger2', name: 'Tiger II', nation: 'GER', cls: 'heavy', year: 1944, br: 6.3, rp: 32000, cost: 75000, requires: ['tiger1', 'pantherg'], status: 'planned', gun: '8.8 cm KwK 43 L/71' },
  // ---------------------------------------------------------------- USSR
  { id: 'bt7', name: 'BT-7', nation: 'USSR', cls: 'light', year: 1935, br: 1.3, rp: 0, cost: 0, requires: [], status: 'planned', gun: '45 mm 20-K' },
  { id: 't26', name: 'T-26', nation: 'USSR', cls: 'light', year: 1933, br: 1.0, rp: 0, cost: 0, requires: [], status: 'planned', gun: '45 mm 20-K' },
  { id: 't34_40', name: 'T-34 (1940)', nation: 'USSR', cls: 'medium', year: 1941, br: 3.0, rp: 4500, cost: 14000, requires: ['bt7'], status: 'planned', gun: '76 mm L-11' },
  { id: 't34_42', name: 'T-34 (1942)', nation: 'USSR', cls: 'medium', year: 1942, br: 3.7, rp: 7000, cost: 20000, requires: ['t34_40'], status: 'planned', gun: '76 mm F-34' },
  { id: 'kv1', name: 'KV-1 (1941)', nation: 'USSR', cls: 'heavy', year: 1941, br: 4.0, rp: 8000, cost: 24000, requires: ['t34_40'], status: 'planned', gun: '76 mm ZiS-5' },
  { id: 't34_85', name: 'T-34-85', nation: 'USSR', cls: 'medium', year: 1944, br: 5.0, rp: 15000, cost: 40000, requires: ['t34_42'], status: 'planned', gun: '85 mm ZiS-S-53' },
  { id: 'is1', name: 'IS-1', nation: 'USSR', cls: 'heavy', year: 1944, br: 5.3, rp: 18000, cost: 46000, requires: ['kv1'], status: 'planned', gun: '85 mm D-5T' },
  { id: 'is2', name: 'IS-2', nation: 'USSR', cls: 'heavy', year: 1944, br: 6.0, rp: 28000, cost: 68000, requires: ['is1'], status: 'planned', gun: '122 mm D-25T' },
];

export const NODE_BY_ID: Record<string, TreeNode> = Object.fromEntries(TECH_TREE.map((n) => [n.id, n]));

export const NATION_LABEL: Record<Nation, string> = { USA: 'United States', GER: 'Germany', USSR: 'Soviet Union', UK: 'Britain' };
