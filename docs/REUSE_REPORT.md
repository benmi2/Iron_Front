# Reuse report — Ballistic Lab and Dead Meridian

Both source projects were found and read. Neither was modified: Iron Front copies or adapts code into its own tree.

| Project | Path | Stack | State when read (2026-10-08) |
|---|---|---|---|
| Ballistic Armour Lab | `C:\Users\benmi\Documents\ballistic-armour-lab` | Vite + TS + three 0.186 | 6 commits; uncommitted HE/RPG/ATGM work present (left untouched) |
| Dead Meridian | `C:\Users\benmi\Documents\dead-meridian` | Vite + TS + Phaser 3.90 | v0.4.0, release prep |

## Ballistic Lab → what was reused

| Lab file | What it is | How Iron Front uses it |
|---|---|---|
| `tanks/armor/ArmorMesh.ts` | Armour as closed prisms (outer tri + inner tri), Möller–Trumbore raycast, true smooth normals, `traceExit` for line-of-sight thickness, `flatPlate` / `loftShell` builders | **Ported nearly verbatim** (`src/ballistics/ArmorMesh.ts`). Each tank has three armour frames (hull / turret / gun) so the turret armour rotates with the turret. |
| `physics/PenetrationSolver.ts` | `keCapability` (de Marre scaling), `keEffectiveThickness` (obliquity exponent with overmatch relaxation), `shatterFactor`, `ricochetAngle`, ballistic limit | **Ported** as the analytic core of `src/ballistics/Penetration.ts`. The Lab integrates each impact at 1 µs steps, which is too slow for a game with dozens of shells in flight. The game keeps the same equations and drops the per-microsecond crater and fragment simulation. |
| `physics/BallisticsEngine.ts` | Point-mass flight with a Cd(Mach) table | **Ported**. It is used twice: in real time, where each shell is integrated with gravity and drag every physics step, and offline, to turn documented range tables into penetration-vs-velocity curves. |
| `physics/Explosives.ts` | Gurney, Mott, and the FM 5-250 breach rule | `heBreachThickness` **ported** for HE shells against thin plate (roofs, decks, tracks). |
| `physics/MaterialModel.ts` | RHA / CHA / HHA / FHA / mild / track steel factors | **Ported**, with every factor tagged as a simulation approximation. |
| `physics/RicochetSolver.ts` | Ricochet outgoing direction and speed | The outgoing-velocity formula is **ported**. The time-stepped gouge visuals are not. |
| `data/ammo.ts` | Ammunition with `penRefMm` fits | Masses, velocities and Cd were **re-checked**. The game stores the **documented range tables themselves** (with source and criterion) instead of a single reference point. The 75 mm **M61 APC was missing** from the Lab and has been added. |
| `tanks/ShermanM4A3.ts` | M4A3(75)W armour stations (47° glacis, cast nose 51–108 mm, D50878 turret, rotor shield) | **Station data reused** for the game Sherman. The visual mesh was rebuilt for a game LOD with weathered paint. |
| `tanks/TigerI.ts`, `PantherG.ts` | Detailed plate layouts | Kept for Stage 3 (both have complete armour stations). |
| `tanks/T34_85.ts` | **Placeholder only** | Not usable. The T-34-85 must be built from scratch. |
| `tanks/TankBuilder.ts` | Wheel / sprocket / track-link / barrel helpers, static-mesh baking | Helper approach **adapted**. The Lab's clip-plane and section-cap shader patches were dropped because the game has no cutaway view. |

**Errors and doubts found in the Lab:**
1. **M61 missing.** The Lab gave the 75 mm M3 only M72 AP and M48 HE. The M61 APC was the standard 1944 AP round for that gun.
2. **M48 HE velocity.** The Lab uses 575 m/s (the 1,885 ft/s supercharge figure). Wikipedia gives 594 m/s for the M3. The game keeps 594 m/s and records the disagreement.
3. **BR-365 / BR-365P and the M79 shatter gap** were left unfitted on purpose (the Lab's own notes say so). They are flagged *unverified* until refit.
4. **Pzgr. 39 at 0°.** The Lab fit gives about 128 mm at 0° near the muzzle. The 0° table on Wikipedia (labelled "calculated, 50 % criterion") gives 135 mm at 100 m. The 30° table is reproduced within about 3 %. The game fits the 30° table, the documented test condition, and stores both tables.
5. **Material factors** (e.g. HHA ×1.05, cast ×0.9) are educational approximations. They are tagged `approximation`, not `verified`.

## Dead Meridian → what was reused

| DM file | What it is | How Iron Front uses it |
|---|---|---|
| `rendering/CharacterRig.ts` (`Pose`, `forwardKinematics`, `standingPose`) | Angle-based 2-D skeleton (hip, torso, head, thigh/shin/foot, upper arm/forearm, weapon) | **Ported** to `src/infantry/rig/Skeleton.ts`. The Phaser sprite container was replaced by textured quads in a Three.js group placed at the soldier's depth (z). |
| `rendering/Locomotion.ts` | Hand-keyed walk / sprint / crouch gait cycles (Catmull-Rom), planted-foot cycle length, idle / half-kneel stance | **Ported verbatim** (pure math). |
| `rendering/CharacterPainter.ts` + `paint.ts` | Procedural Canvas-2D painting of limbs (shaded cylinders, creases, stitching, camo) | The **technique was adapted** in a new `SoldierPainter` that paints US M1943 / HBT and German M43 field-grey uniforms, the M1 helmet and the M35/M40 Stahlhelm. DM's civilian and zombie looks were not used. |
| `npc/Raider.ts` | Perception (sight builds awareness, hearing redirects), rally, burst fire with plant/crouch, cover selection by score, retreat threshold, cover soaking hits | **Behaviours adapted** in `SoldierAI`. Zombie-specific chase, melee and gore were dropped. The behaviours are rewritten around squads, depth lanes, cover objects, tank threat and suppression. |
| `combat/Firearm.ts`, `Projectile.ts`, `Hitbox.ts` | Magazine/reload state, projectile bullets, per-limb hitboxes | The **concepts were reused**: bullets are swept segments with per-zone hitboxes, magazine reload. The data comes from WWII small arms. |
| `player/PlayerController.ts` / `PlayerAnimator.ts` | Aim-driven upper-body pose (arms to weapon anchors, recoil kick) | The aim-pose approach (shoulder → hands on weapon anchors, recoil kick) is **adapted**. |

Not reused: Phaser itself (the game runs on Three.js), zombie AI, survival, quests, inventory, gore, and DM's modern-gun painters (WWII weapons are painted fresh).
