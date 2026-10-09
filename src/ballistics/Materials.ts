/**
 * Armour & projectile material models (ported from Ballistic Armour Lab).
 * Coefficients are educational approximations — NOT validated engineering data.
 */

export interface ArmorMaterial {
  id: string;
  name: string;
  short: string;
  density: number; // kg/m³
  hardnessBHN: number;
  /** effectiveness vs kinetic penetrators relative to RHA (mm RHA per mm) */
  keEffectiveness: number;
  /** effectiveness vs shaped-charge jets relative to RHA */
  ceEffectiveness: number;
  /** 0..1 normalised hardness coefficient */
  hardness: number;
  /** 0..1, high = tears/petals and bulges, low = cracks and shatters */
  ductility: number;
  /** multiplier on behind-armour debris mass */
  spallTendency: number;
  /** 0..1, high = finer fragmentation (more, smaller fragments) */
  fragmentation: number;
  /** target resistance Rt for hydrodynamic (Tate) penetration, Pa */
  targetResistance: number;
  /** longitudinal sound speed m/s (stress-wave visualisation for HESH) */
  soundSpeed: number;
  /** dynamic spall strength (Pa) — HESH scabbing threshold */
  spallStrength: number;
  color: number;
}

export const ARMOR_MATERIALS: Record<string, ArmorMaterial> = {
  RHA: {
    id: 'RHA', name: 'Rolled homogeneous armour', short: 'RHA',
    density: 7850, hardnessBHN: 280, keEffectiveness: 1.0, ceEffectiveness: 1.0,
    hardness: 0.55, ductility: 0.7, spallTendency: 1.0, fragmentation: 0.5,
    targetResistance: 5.6e9, soundSpeed: 5900, spallStrength: 1.6e9, color: 0x6f7377,
  },
  CHA: {
    id: 'CHA', name: 'Cast homogeneous armour', short: 'CAST',
    density: 7800, hardnessBHN: 250, keEffectiveness: 0.9, ceEffectiveness: 0.95,
    hardness: 0.45, ductility: 0.55, spallTendency: 1.2, fragmentation: 0.45,
    targetResistance: 5.0e9, soundSpeed: 5800, spallStrength: 1.2e9, color: 0x6b6c6a,
  },
  HHA: {
    id: 'HHA', name: 'High-hardness rolled armour (T-34 type)', short: 'HHA',
    density: 7850, hardnessBHN: 430, keEffectiveness: 1.05, ceEffectiveness: 1.0,
    hardness: 0.85, ductility: 0.35, spallTendency: 1.55, fragmentation: 0.75,
    targetResistance: 6.4e9, soundSpeed: 5900, spallStrength: 1.4e9, color: 0x707470,
  },
  RHA_BRITTLE: {
    id: 'RHA_BRITTLE', name: 'Late-war rolled armour (alloy-deficient)', short: 'RHA-L',
    density: 7850, hardnessBHN: 300, keEffectiveness: 0.9, ceEffectiveness: 0.95,
    hardness: 0.6, ductility: 0.38, spallTendency: 1.6, fragmentation: 0.7,
    targetResistance: 5.2e9, soundSpeed: 5900, spallStrength: 1.1e9, color: 0x727068,
  },
  FHA: {
    id: 'FHA', name: 'Face-hardened armour', short: 'FHA',
    density: 7850, hardnessBHN: 500, keEffectiveness: 1.1, ceEffectiveness: 1.0,
    hardness: 0.9, ductility: 0.3, spallTendency: 1.4, fragmentation: 0.7,
    targetResistance: 6.8e9, soundSpeed: 5900, spallStrength: 1.3e9, color: 0x6d6f73,
  },
  MILD: {
    id: 'MILD', name: 'Mild / structural steel', short: 'MILD',
    density: 7850, hardnessBHN: 140, keEffectiveness: 0.55, ceEffectiveness: 0.8,
    hardness: 0.2, ductility: 0.95, spallTendency: 0.6, fragmentation: 0.3,
    targetResistance: 3.0e9, soundSpeed: 5900, spallStrength: 1.0e9, color: 0x77797b,
  },
  AL5083: {
    id: 'AL5083', name: 'Aluminium armour 5083', short: 'AL',
    density: 2660, hardnessBHN: 90, keEffectiveness: 0.33, ceEffectiveness: 0.42,
    hardness: 0.15, ductility: 0.9, spallTendency: 0.7, fragmentation: 0.35,
    targetResistance: 1.4e9, soundSpeed: 6300, spallStrength: 0.9e9, color: 0x9aa0a6,
  },
  SAND: {
    id: 'SAND', name: 'Packed sand (sandbags) — approximation', short: 'SAND',
    density: 1600, hardnessBHN: 0, keEffectiveness: 0.05, ceEffectiveness: 0.12,
    hardness: 0.05, ductility: 1, spallTendency: 0, fragmentation: 0,
    targetResistance: 0.3e9, soundSpeed: 400, spallStrength: 0, color: 0x9a8a60,
  },
  TRACK: {
    id: 'TRACK', name: 'Track / running gear steel', short: 'TRK',
    density: 7800, hardnessBHN: 220, keEffectiveness: 0.45, ceEffectiveness: 0.5,
    hardness: 0.4, ductility: 0.6, spallTendency: 0.8, fragmentation: 0.4,
    targetResistance: 4.2e9, soundSpeed: 5900, spallStrength: 1.0e9, color: 0x55524d,
  },
};

export interface PenetratorMaterial {
  id: string;
  name: string;
  density: number;
  /** dynamic flow strength Yp (Pa) for Tate model */
  flowStrength: number;
  /** 0..1 brittleness: tendency to shatter instead of mushroom */
  brittleness: number;
  color: number;
}

export const PENETRATOR_MATERIALS: Record<string, PenetratorMaterial> = {
  steel: { id: 'steel', name: 'Hardened steel', density: 7850, flowStrength: 1.4e9, brittleness: 0.35, color: 0x8a8d8f },
  steelSoft: { id: 'steelSoft', name: 'Mild steel (cap/body)', density: 7850, flowStrength: 0.6e9, brittleness: 0.05, color: 0x9a9284 },
  aluminium: { id: 'aluminium', name: 'Aluminium alloy (carrier)', density: 2750, flowStrength: 0.35e9, brittleness: 0.05, color: 0xb6b8ba },
  wc: { id: 'wc', name: 'Tungsten carbide', density: 15000, flowStrength: 3.0e9, brittleness: 0.85, color: 0x3d3f44 },
  wha: { id: 'wha', name: 'Tungsten heavy alloy', density: 17600, flowStrength: 1.6e9, brittleness: 0.25, color: 0x4c4f55 },
  copper: { id: 'copper', name: 'Copper liner', density: 8930, flowStrength: 0.3e9, brittleness: 0.0, color: 0xc77a46 },
  explosive: { id: 'explosive', name: 'Plasticised explosive', density: 1650, flowStrength: 0.01e9, brittleness: 0.0, color: 0xd8c27a },
};

/** Thickness-to-colour ramp used by ARMOUR ONLY view (mm). */
export function thicknessColor(mm: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, [0.25, 0.3, 0.55]],
    [20, [0.2, 0.45, 0.8]],
    [40, [0.15, 0.7, 0.7]],
    [60, [0.35, 0.8, 0.35]],
    [80, [0.85, 0.85, 0.25]],
    [110, [0.95, 0.55, 0.15]],
    [160, [0.9, 0.2, 0.15]],
    [250, [0.75, 0.15, 0.55]],
  ];
  if (mm <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (mm <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const t = (mm - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
    }
  }
  return stops[stops.length - 1][1];
}
