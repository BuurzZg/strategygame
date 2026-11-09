# Glasswake

A real-time strategy game for the browser, built on three.js. You fight over a glass desert at dusk. Two survey consortia harvest resonance from singing vents, weave structures inside a lattice field, and try to break each other's bases.

It is a clean-room project. There is no OpenRA code and no Command & Conquer data, art, audio, names or maps. Every model is built procedurally from primitives, every sound is synthesized with WebAudio, and every map is generated from a seed.

## Run it

It is plain ES modules with no build step. three.js r160 is vendored in `lib/`, so it runs offline. The only network fetch is Google Fonts, and it falls back to system fonts.

```bash
cd glasswake
python -m http.server 8000
```

Then open http://localhost:8000. Any static server works (`npx serve`, VS Code Live Server, nginx). Opening `index.html` straight from disk won't work, because browsers block ES modules on `file://`.

Debug helpers: add `?reveal` to the URL to turn off fog of war. `window.glasswake.world` exposes the live simulation in the console.

## How it plays

| Concept | Glasswake |
| --- | --- |
| Resource | **Resonance** glass, grown around vents. Cells slowly regrow. |
| Harvester | **Skimmer**, a hover sled. Drops off at a Core or Siphon. |
| Building | **Weaving.** Pick a structure, place it, and it rises on site over time. Each Core supplies one weaver, so more Cores means more parallel construction. |
| Placement rule | **Lattice field.** You can only build inside the radius of a Core (10 cells) or a Lattice Pylon (7 cells). You expand by chaining pylons toward new vents. |
| Economy cap | **Supply** from Cores and Resonators, up to 120. |
| Sustain | Units slowly self-repair inside their own lattice field. Menders heal in the field too. |

### Structures

| Key | Name | Role |
| --- | --- | --- |
| C | Core | HQ, drop-off, trains Skimmers, +12 supply, field 10 |
| P | Lattice Pylon | Extends the field (radius 7) |
| R | Resonator | +10 supply |
| I | Siphon | Forward drop-off, arrives with a free Skimmer |
| F | Foundry | Trains combat units |
| T | Prism Spire | Defensive beam tower (needs Foundry) |
| U | Uplink | Unlocks the Bastion (needs Foundry) |

### Units

| Key | Name | Role | Weapon |
| --- | --- | --- | --- |
| K | Skimmer | Harvester | none |
| N | Needle | Fast raider | shard (strong vs light) |
| W | Warden | Line walker | beam (strong vs medium) |
| M | Mender | Support | heals allies |
| B | Bastion | Siege mortar | blast (strong vs heavy and structures), minimum range 3 |

### Controls

- **Selecting:** Left-drag to box select. Double-click selects all of that type on screen. Shift-click adds to or removes from the selection.
- **Orders:** Right-click to move, attack, or harvest a crystal field. Right-click a Core or Siphon to send Skimmers home. With a Foundry selected, right-click sets its rally point.
- **Order hotkeys:** `A` attack-move, `S` stop, `H` hold ground, `X` recycle a structure.
- **Groups:** `Ctrl+1–9` sets a control group, `1–9` recalls it, double-tap to jump the camera to it.
- **Camera:** Arrow keys, screen edges or middle-drag to pan. `Q`/`E` or Alt+middle-drag to rotate. Mouse wheel to zoom. `Space` jumps to the last alert, or to your Core.
- **Placement:** Shift-click keeps placing more of the same structure. `Esc` cancels placement or opens the menu.
- **Production:** Right-click a train button to dequeue. Click a queue slot to cancel it.
- **Touch:** Tap to select or order, drag to pan, pinch to zoom.

## Code map

```
index.html        page shell, HUD markup, all CSS
lib/              three.js r160 (MIT, see lib/LICENSE)
src/config.js     every number: units, structures, damage table, difficulty
src/map.js        seeded symmetric map generator, terrain mesh, obsidian, crystals
src/path.js       grid A* (binary heap, octile, no corner cutting) + string-pulling
src/game.js       World: entities, orders, movement/separation, combat, harvesting,
                  weaving, production, supply, fog, victory
src/ai.js         bot: economy, supply, pylon-chain expansion, tech, waves, defence
src/models.js     procedural low-poly models per unit/structure, team materials
src/effects.js    pooled particles, beams, projectiles, shockwaves, order markers
src/fog.js        per-team visibility grid + fog overlay shader
src/input.js      camera rig, picking, selection, orders, placement ghost, touch
src/ui.js         HUD, command card, tooltips, minimap (rotates with camera), overlays
src/audio.js      synthesized WebAudio SFX
src/main.js       renderer, lighting, title demo (AI vs AI), game loop, screens
```

Balance tuning lives entirely in `src/config.js`. The simulation is independent of rendering, so you can run fast headless matches from the console:

```js
const w = glasswake.world; for (let i = 0; i < 30 * 600; i++) w.update(1 / 30);
```

## Ideas for next steps

- Give each faction its own unit roster and abilities. Right now they share one roster and differ only in color and lore.
- Lockstep multiplayer. The simulation already runs on a fixed step and only needs a seeded RNG in place of `Math.random`.
- Hand-authored maps and a map editor that reuses the generator's data format.
- A flow-field pathfinder for large groups.
- Replace procedural models with glTF assets loaded through `GLTFLoader`.
