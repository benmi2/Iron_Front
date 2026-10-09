# Architecture

```
src/
  core/        math (ported from Ballistic Lab), seeded RNG, keyboard/mouse input
  data/        HISTORICAL DATABASE — provenance.ts (source registry + confidence tags),
               ammo.ts, guns.ts, vehicles.ts, smallarms.ts, techtree.ts, upgrades.ts
  ballistics/  ArmorMesh (Lab port: armour prisms + raycasts), Materials (Lab port), Flight
               (drag model, range tables), PenCurve (documented table → penetration(v)),
               Penetration (KE / HEAT / HE plate resolution), ShellSystem (projectiles)
  vehicles/    TankBuilder (hull / turret / gun frames, armour + visuals + components),
               models/ (Sherman M4A3(75)W, Panzer IV H), Tank (drivetrain, laying, loading,
               crew, components, fire, bail-out), DamageModel (hit test, behind-armour tracing,
               impact reports), Driving (side-view steering), Crew, TankMaterials
  infantry/    rig/ (Dead Meridian skeleton + gait port, SoldierPainter, WeaponArt, SoldierRig),
               Soldier, Bullets (small arms + grenades)
  ai/          Perception (spotting), TankAI, SoldierAI, Squad, Tactics, Paths
  world/       Terrain (heightfield, surfaces, depth band, mud road + puddles), Obstacle,
               Props, Background (tree rows, far village, burning ruins, windmills),
               Foreground (visual-only dressing in front of the band, grass + poppies),
               World (registry, collisions, LOS, explosions, smoke), maps/Normandy
  render/      Renderer (sky, key / rim / hemisphere lights, sky environment map, MSAA scene
               pass with depth of field, bloom, grade), CameraRig, Paint/Textures
               (procedural canvas art), Particles, Effects, Merge (draw-call merging)
  audio/       Audio (procedural WebAudio)
  game/        Session (one battle), PlayerController, Picking, Objectives, Atmosphere, modes/
  progression/ Profile (rank, research, purchases, upgrades, crews, rewards, save)
  ui/          HUD, XRay, Minimap, Menus (garage, briefing, debrief, settings, sources),
               GarageScene, styles.css
```

## Coordinate system

X runs along the battlefield, Y is up, and Z is depth, increasing toward the camera. The playable depth band is `DEPTH_MIN..DEPTH_MAX` (−17 m to +6 m). Tanks keep roughly to the battlefield axis and change lanes by steering up to 32° off-axis with their real turning limits. All combat is fully 3-D, so depth affects cover, line of sight, range and plate obliquity.

Tank models use Ballistic Lab's frame: +X front, +Y up, +Z right, ground at 0. The hull, turret and gun are separate frames, so turret armour and the mantlet rotate and elevate with the gun.

## Simulation step

`App` runs a fixed 60 Hz step. Each `Session.update` does the following in order:

1. Player input
2. Tank and soldier AI
3. `World.update`:
   - perception at 5 Hz
   - tanks
   - soldiers
   - shells at 480 Hz sub-steps
   - bullets
   - smoke
   - debris
4. Objectives
5. Mode logic

Rendering is decoupled and runs once per animation frame.

## Render pipeline

1. **Scene pass** (`SceneDofPass`): the battlefield renders into a 4× multisampled half-float target with a depth texture.
2. **Depth of field**: two separable gather passes. The circle of confusion is zero inside the playable band, from just in front of it to 45 m behind it (`Renderer.setFocusBand`, set every frame by the session). It grows in front of the band (foreground dressing) and far behind it (horizon). A sample nearer than the pixel spreads by its own blur radius, so blurred foreground overlaps what is behind it.
3. **Bloom** (threshold above 1.35 linear: sun disc, fire, muzzle flashes), **OutputPass** (ACES tone mapping, sRGB), then a **grade** pass (saturation, S-curve, teal-shadow / amber-highlight split toning, vignette, grain, hit flash).

The sky is a shader dome. Its vertical axis is stretched ×2.1 because the low side-view camera only sees about 12° of sky; the sun disc keeps its true direction. The environment map is baked from the same sky, unstretched and with the disc dimmed, through `PMREMGenerator` each time the atmosphere changes. That gives sky reflections on paint, metal and puddles.

Lights are a fixed set so shaders never recompile mid-battle: hemisphere, key (shadow-casting, from the viewer's left), rim (from the visible sun), and the effects' pooled point lights. Static scenery is merged per material in 80–120 m chunks (`render/Merge.ts`), so frustum culling still works. Road wheels are merged per wheel.

Tank paint (`TankMaterials`) is weathered in the shader in object space: mottling, camouflage, dust on upward faces, paint chips, sun fading and Zimmerit ridges. The mud line uses the hull height, taken from the vehicle's inverse root matrix, which every paint material shares.

## Shell → damage pipeline

1. **Flight.** `ShellSystem.step` advances each shell with drag and gravity, then sweeps the segment against the terrain, obstacles (shell resistance per obstacle), tanks and soldiers.
2. **Hit test.** `tankHitTest` transforms the segment into the hull, turret and gun frames, raycasts the armour prisms, and tests external parts (tracks, barrel).
3. **Plate resolution.** `analyzeImpact` measures true obliquity and line-of-sight thickness. `resolveImpact` then returns one of: ricochet, non-penetration, shattered, penetration, HE blast or breach, HEAT jet, or through a spaced plate.
4. **Behind the armour.** `traceInterior` traces the residual penetrator or jet line, the spall cone and any filler burst through the component boxes. That damages crew, ammunition, fuel, engine and the other components, which can lead to fires, detonation and bail-out.
5. **Report.** An `ImpactReport` goes to the HUD hit marker, the X-ray view and the firing-range log.
