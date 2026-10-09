# Iron Front — WWII 2.5D combined-arms tank warfare

A side-view (2.5D) WWII tank game for the browser, built with TypeScript, Three.js and WebGL.
Every shell is a simulated projectile. Armour is modelled plate by plate. Damage is done to crew and components, not to hit points.

```
npm install
npm run dev          # http://localhost:5330
npm run typecheck
npm run build        # production bundle in dist/
```

## What is playable now

| Area | State |
|---|---|
| **Tanks** | **M4A3(75)W Sherman** and **Pz.Kpfw. IV Ausf. H** are complete. Each has 3-D armour plates in hull, turret and gun frames, interior crew and component volumes, its own gun and documented ammunition, and its own mobility figures. |
| **Ballistics** | Shells fly with gravity and Mach-dependent drag at 480 Hz and are swept against terrain, obstacles, armour prisms and soldiers. KE penetration is built from documented range tables, with obliquity, line-of-sight thickness, overmatch, the shatter gap, ricochet and material factors. HEAT and HE use separate models. Behind the armour, the residual penetrator, spall cone, HEAT jet and filler burst are traced through the components. |
| **Damage** | Crew wounded or killed with stand-ins taking over, engine, transmission, tracks (field repair), breech, barrel, traverse (powered, manual or jammed), optics, radio, fuel and ammunition fires, cook-off, catastrophic detonation with the turret thrown off, bail-out, and re-crewing abandoned tanks. |
| **Infantry** | A playable soldier, AI squads (rifle, BAR/MG 42, bazooka, Panzerschreck, Panzerfaust, medic, engineer, officer), suppression, cover, grenades and smoke, and boarding or leaving vehicles. |
| **AI** | Spotting by line of sight (perception, no omniscience). Tank AI picks targets and ammunition, halts briefly to fire, brackets the range after misses, checks its line of fire for friendlies, finds clear lanes, and backs off from fights it can't win. |
| **Modes** | Historical battle "Normandy 1944 — Allied Advance", Skirmish (side, tanks, squads, difficulty, time of day, weather, ammunition), Tank Duel, and the Firing Range. The range shows documented vs simulated penetration side by side. |
| **Progression** | Rank, XP, research points, requisition, research trees for the USA, Germany and the USSR, owned vehicles, per-vehicle crews with skills and XP, upgrades tagged documented / maintenance / training, loadouts, wear and workshop repair, achievements, saved to localStorage. |
| **UI** | HUD laid out like the reference (team banners, timer, A/B/C objective diamonds, minimap, ammunition slots, vehicle card), a crew and component panel, an X-ray impact replay, a tactical map, hit markers, and a realism mode. |

## Not done yet (stated plainly)

- **Four of the six required tanks are not modelled yet:** Tiger I, Panther G, M4A3 76 mm and T-34-85. They appear in the research tree as *in development* and cannot be deployed. Ballistic Lab already has complete armour stations for the Tiger I and Panther G. Its T-34-85 is only a placeholder.
- No towed anti-tank guns (Pak 40, 57 mm), mines or satchel charges yet.
- Infantry don't garrison building interiors yet (window slots exist in the data) and have no prone stance.
- One Normandy map. The British tree and Eastern Front scenarios are not started.
- Audio is fully synthesised and original, with no recorded samples. Radio call-outs are text only.

## Controls

**Tank:** A/D drive · W/S change depth lane · T turn around · mouse aims the turret · LMB fire · Space coaxial MG · RMB sight / binocular view · wheel zoom · 1–5 select the next round (press the same key again to unload and reload) · R swap round · B button up / head out · G gyrostabilizer (Sherman) · F leave the vehicle · C crew panel · X X-ray · Tab tactical map · Esc pause · F1 help

**On foot:** A/D, W/S move · Shift sprint · C crouch · LMB fire · R reload · 1/2 weapons · G grenade (Shift+G smoke) · F board or re-crew a friendly vehicle · hold E to help repair a track

**Squads:** Z follow me · H hold · V advance to the cursor

## Documentation

- [docs/REUSE_REPORT.md](docs/REUSE_REPORT.md): what was taken from Ballistic Armour Lab and Dead Meridian, and the errors found in them
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): systems and data flow
- [docs/HISTORICAL_DATA.md](docs/HISTORICAL_DATA.md): every vehicle and ammunition value, with its source and confidence

## Visual checks

`node scripts/shot.mjs shots/x.png scripts/t/<script>.js` runs a page script against the dev server and saves screenshots. The page script receives `app`, which is `window.__iron`. The scripts in `scripts/t/` cover the menu, the battle, the range, the village, close-ups, on-foot play, the modes and a 150-second AI autopilot campaign.
