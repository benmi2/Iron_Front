# Historical data — verification sheet

Tags: **V** verified (stated by the cited source), **I** interpreted (derived from or chosen between sources), **E** estimated (no source found yet; needs review), **S** simulation approximation (a model parameter, not a historical fact).
The machine-readable versions are `src/data/*.ts`. Every value there carries its tag and source ids. Research was done on 2026-10-09.

## Ammunition: documented tables and the simulated reproduction

At load time each documented penetration table is flown through the game's drag model. The firing range prints documented vs simulated values side by side. Drag coefficients were fitted with `scripts` (scratch `fitcd.mjs`) so that de Marre scaling reproduces each table's slope.

| Round | Gun | Mass | MV | Table used | Sim. reproduction | Cd fit | Tags |
|---|---|---|---|---|---|---|---|
| M61 APC | 75 mm M3 | 6.63 kg | 617 m/s | US, 30°: 66/60/55/50 mm at 500/1000/1500/2000 yd | 66/60/55/50 (exact) | 0.300 | V (Wikipedia "75 mm gun M2/M3/M6", TM 9-1907) |
| M72 AP | 75 mm M3 | 6.32 kg | 619 m/s | US, 30°: 76/63/51/43 | 75/63/52/42 | 0.545 (Lab: 0.55) | V |
| M48 HE | 75 mm M3 | 6.76 kg, 0.68 kg TNT | 594 m/s | — | — | 0.36 S | I: MV 594 (Wikipedia) vs 575 (Lab, 1,885 ft/s) |
| M89 HC smoke | 75 mm M3 | 3.0 kg | 259 m/s | — | — | 0.4 S | V (1944 firing-table extract) |
| Pzgr. 39 | KwK 40 L/48 | 6.8 kg | 750 m/s | German, 30°: 106/96/85/74/64 at 100–2000 m | 106/96/85/74/64 | 0.44 (Lab: 0.44) | V (Wikipedia "7.5 cm KwK 40"; Jentz) |
| Pzgr. 40 | KwK 40 L/48 | 4.1 kg | 930 m/s | German, 30°: 143/120/97/77 at 100–1500 m | 143/121/97/77 | 0.425 | V |
| Gr. 38 Hl/C | KwK 40 L/48 | ≈4.8 kg | 450 m/s | 100 mm at 30° (≈115 mm LoS) at any range | 115 mm jet | — | I |
| Sprgr. 34 | KwK 40 L/48 | 5.74 kg, 0.686 kg amatol | 550 m/s | — | — | 0.36 S | I: Wikipedia lists 4.42 kg; Jentz/Lab 5.74 kg |
| Nebelgranate | KwK 40 L/48 | 6.2 kg | 540 m/s | — | — | — | **E**: only a game-wiki figure found |

The 0° tables are stored for comparison only. The source labels them "estimated / calculated" (M61: 88/81/73/65/59 mm; Pzgr. 39: 135/123/109/97/86 mm).

## M4A3(75)W Sherman

| Item | Value | Tag | Source / note |
|---|---|---|---|
| Upper glacis | 63.5 mm @ 47° | V | TM 9-759, Hunnicutt |
| Lower nose (cast) | 51–108 mm, curved | V | Hunnicutt (via Ballistic Lab stations) |
| Hull sides / rear | 38 mm | V | TM 9-759 |
| Turret front / sides | 76 mm cast @ ≈30° / 51 mm | V | Hunnicutt |
| Mantlet (M34A1 rotor shield) | 89 mm | V | Hunnicutt |
| Combat weight | 31.0 t | I | sources give 30.3–31.6 t |
| Ford GAA | 336 kW (450 hp gross) | V | Wikipedia "M4 Sherman" |
| Max speed | 42 km/h | I | 26 mph governed |
| Reverse speed | 5 km/h | **E** | not yet sourced |
| Turning radius | 9.4 m | I | 62 ft circle |
| Traverse | 24°/s (≈15 s / 360°) | I | Hunnicutt |
| Elevation | −10° … +25° | I | M34A1 mount |
| Stowage | 104 rounds, wet | V | TM 9-759 |
| Loading cycle | 3.0 s ready rack / 5.0 s stowage | I | from the documented 12–20 rpm |

## Pz.Kpfw. IV Ausf. H

| Item | Value | Tag | Source / note |
|---|---|---|---|
| Nose plate | 80 mm @ 14° | I | thickness V (Wikipedia); angle 12–14° by source |
| Driver's front plate | 80 mm @ 10° | V | single plate on later H (tanks-encyclopedia) |
| Glacis (brake hatches) | 20 mm @ 72° | I | 20–25 mm by source (War Thunder wiki used only as a cross-check) |
| Lower nose | 20 mm @ ≈55° | **E** | not yet sourced |
| Sides | 30 mm | V | Wikipedia |
| Rear | 20 mm | V | Wikipedia |
| Roof / floor | 16 / 10 mm | I | infobox gives 10 mm; text gives 16 and 25 mm roof segments on the H |
| Turret front / sides / rear | 50 mm @ 11° / 30 mm @ 25° / 30 mm @ 15° | V | Wikipedia; side angle 23–26° by source |
| Mantlet | 50 mm | I | |
| Schürzen | 5 mm hull / 8 mm turret | V | Wikipedia, tanks-encyclopedia |
| Mass | 25.0 t | V | |
| Engine | 220 kW (300 PS @ 3000 rpm) | V | 265 PS at the governed 2,600 rpm (Panzerworld) |
| Max / off-road speed | 38 / 16 km/h | V | tanks-encyclopedia gives 25 km/h cross-country |
| Traverse | 16°/s electric; ≈3°/s by hand | I | Heereswaffenamt D 653/8 via Panzerworld |
| Elevation | −8° … +20° | I | −8 to −10 by source |
| Stowage | 87 rounds | V | |
| Reverse / turning radius | 5 km/h / 5.9 m | **E** | not yet sourced |

## Simulation approximations (S)

Material factors are RHA 1.0, cast 0.9, HHA 1.05 and sand 0.05. The obliquity exponents and the shatter-gap shape come from Ballistic Lab. Obstacle shell resistance is masonry ≈ 1/12 of its thickness in RHA, packed earth ≈ 1/25 and sand ≈ 1/20. Component energy thresholds, spall-cone sizes and fire probabilities (gasoline 0.45, wet ammunition stowage 0.12 vs dry 0.55) are game-tuned and are not historical statistics.
