# Glasswake

A real-time strategy game for the browser, built on three.js. You fight over a glass desert at dusk. Two survey consortia harvest resonance from singing vents, weave structures inside a lattice field, and try to break each other's bases.

The engine follows the same architectural ideas as classic data-driven RTS engines:

- actors made of traits
- YAML rules with inheritance and conditions
- activity queues
- orders executed in lockstep, so multiplayer and replays work by sending only player input

All code is written from scratch in JavaScript. All game content (setting, factions, units, models, sounds, maps) is original to Glasswake.

## Run it

### Single player (any static server)

```bash
python -m http.server 8000
```

Then open http://localhost:8000. Browsers block ES modules on `file://`, so you need a server of some kind.

### Multiplayer (relay server, Node 18+)

```bash
npm install
npm start
```

Open http://localhost:8080 and choose **Multiplayer → Host a game**, then share the four-letter code. Friends on the same network open `http://<your-ip>:8080` and **Join** with the code. Each lobby slot can be a player or a bot (easy, normal or hard), and extra joiners spectate. To play over the internet, run the relay on a machine your friends can reach. Options: `PORT=9000 npm start`, or `LATENCY=8` for more order delay on slow connections.

### Tests

```bash
npm test
```

```bash
npm run missions
```

```bash
npm run selfplay
```

```bash
npm run check
```

- `npm test` runs two clients over a simulated laggy network with random orders, checks that every frame's sync hash matches, replays the recording, and plays a bot match. It then runs the mission checks.
- `npm run missions` runs only the campaign mission checks.
- `npm run selfplay` lets the AI play skirmishes and the whole campaign headless and reports the results.
- `npm run check` lints the simulation code for anything that could differ between browsers.

## Debug tools

Press `` ` `` or F9 in any game, or choose **Menu → Developer tools**, to open the developer panel.

| Section | What it does |
| --- | --- |
| Performance | FPS, ticks per second, simulation time per tick, draw calls, triangles, actor/projectile/particle counts, the sync hash, and each player's resources, supply and bot state. Network stalls and desyncs appear here too. |
| View | Overlays for movement paths and waypoints, weapon / scan / heal / sight ranges, unit labels (id, type, activity, stance), passability (obsidian, structures, crystal) and lattice fields. **Reveal map** removes fog, and **View as** shows any player's fog. These are display-only, so they are safe in multiplayer. |
| Time | Speeds from 0.25× to 8×, pause, and single-step one tick. |
| Cheats | +5000 resonance, fast build (12×), autopilot, instant win or loss, spawn any actor at a click, and kill / damage / heal / give away the selection. |
| Camera & capture | Cinematic camera, hide HUD, letterbox, and video recording. |
| Inspector | The selected actor's position, facing, health, conditions, activity chain, queue, stance and every trait (disabled traits are marked `-`). |
| Event log | Orders as they execute (frame, client, order) plus deaths, dialogue and objective changes. |

Cheats are sent as **world orders** through the normal order pipeline. They stay deterministic, they are recorded in replays, and a replay with cheats plays back exactly. They are only available when the game's `dev` setting is on, which it is for skirmish, campaign and spectator games, but not multiplayer.

Keys that work everywhere:

| Key | Action |
| --- | --- |
| F9 or `` ` `` | Debug panel |
| F8 | Hide HUD |
| F7 | Cinematic camera |
| F6 | Start/stop recording |
| Shift + wheel | Tilt the camera |

## The AI plays the game

- **Watch AI** (title screen) runs a full match between two bots, each set to easy, normal or hard, with the cinematic camera.
- **Autopilot** hands your side to the AI mid-game. Use **Menu → Autopilot**, the debug panel, or `?autopilot`. It works in skirmish and in every campaign mission: mission scripts give the bot their objectives with `m.botGoals()`.
- `npm run selfplay` plays a skirmish matrix (several seeds × matchups) and the whole campaign on autopilot headless, then reports winners, game lengths and stalemates. Add `campaign hard` or `skirmish` to run one part.

Current self-play results:

- **Skirmish:** every game ends with a winner. Hard beats normal 5–0, normal vs normal splits 3–2, hard beats easy 5–0.
- **Campaign on autopilot:** the AI wins all five missions on easy and normal. On hard it wins three of the five.

How the bots are built:

- Bots are modules on the player actor.
- Difficulty profiles in `rules/player.yaml` control think rate, harvest bonus, attack timing and wave sizes, Foundry count and expansion timing.
- Two settings make a bot attack only when it has the advantage: `AttackRatio` and `RetreatRatio`. The hard bot and the autopilot use them.
- Missions can retune enemy profiles in their `Rules:` section.

## Recording trailers and gameplay

**In the browser:**

1. Press F6, or use **Record video** in the debug panel.
2. Recording captures only the 3D view (never the HUD), plus game audio.
3. Press F6 again to save a `.webm` file.

Combine this with F8 (clean view), F7 (cinematic camera), letterbox and the speed controls.

**Scripted**, through URL options:

```
?spectate&seed=77&a=accord:hard&b=combine:normal
?mission=m05-wake&difficulty=normal&autopilot
?skirmish&autopilot&seed=1207
?replayurl=clips/match.gwreplay.json
```

Any of these can be extended with:

| Option | Effect |
| --- | --- |
| `&cinematic` | Cinematic camera |
| `&clean` | Hide the HUD |
| `&letterbox` | 2.39:1 letterbox |
| `&reveal` | Show the whole map |
| `&speed=2` | Game speed |
| `&debug` | Open the debug panel |
| `&mute` | No audio |
| `&record=90` | Record for 90 seconds, then download |

**Fully automated**, with a real browser through Playwright:

```bash
npm start
```

In a second terminal:

```bash
npm install --no-save playwright && npx playwright install chromium
```

```bash
node tools/capture.js --seconds 90 --seed 77 --out clips/ai-match.webm --headed
```

```bash
node tools/capture.js --mission m05-wake --autopilot --reveal --seconds 120 --out clips/wake.webm --headed
```

```bash
node tools/capture.js --replay clips/match.gwreplay.json --speed 2 --out clips/replay.webm --headed
```

Use `--headed` on a machine with a GPU for smooth 60 fps. Headless capture works, but it renders in software.

A good trailer workflow:

1. Run `npm run selfplay` or watch AI matches until you find a good game.
2. Save its replay from the end screen.
3. Record the replay several times with different camera settings. Replays re-simulate exactly, so every take shows the same battle.

MediaRecorder files have no duration header. To fix that, or to get an MP4:

```bash
ffmpeg -i clip.webm -c copy fixed.webm
```

```bash
ffmpeg -i clip.webm -c:v libx264 -crf 18 -c:a aac clip.mp4
```

## Engine architecture

```
           UI / bots ──► Orders ──► OrderManager ──(lockstep, all clients)──► World.tick()
                                        │                                       │
                               NetClient / Local / Replay              actors · traits · activities
                                                                                │ fx events
                                                    WorldRenderer (three.js) ◄──┘ reads only
```

| Concept | Where | What it does |
| --- | --- | --- |
| Fixed tick | `engine/ordermanager.js` | The simulation advances in 40 ms ticks (25 per second). Rendering interpolates between ticks. |
| Integer world | `engine/math.js` | 1024 world units per cell, 1024 angle units per turn, table-based sin/cos and atan. No floats leak into game state. |
| Seeded RNG | `engine/random.js` | `world.rng` is the only randomness the simulation may use. |
| World | `engine/world.js` | Actors in id order, trait index, spatial queries, fog checks, placement rules, crowd separation, sync hash. |
| Actor and traits | `engine/actor.js`, `engine/traits.js` | An actor is an id, an owner, a position and a list of traits built from its rules. |
| Rules | `engine/miniyaml.js`, `engine/rules.js`, `rules/*.yaml` | YAML with `Inherits`, `-Removal` and `Trait@instance`. Unknown traits or fields fail at load time. |
| Conditions | `RequiresCondition: !weaving` | Turn traits on and off at runtime, for example while a structure is still being built, or for bot difficulty. |
| Activities | `engine/activity.js`, `activities/` | Each actor has a queue of tasks with child activities and cancel. Examples: MoveTo, Attack, AttackMove, harvest loop. |
| Orders | `engine/order.js` | Compact JSON input. The UI asks each selected actor's traits what they would do with a target (`orderFor`), and the chosen orders are resolved by the traits' `resolveOrder` on the scheduled frame. |
| Lockstep | `engine/ordermanager.js` | Orders issued on frame F execute on frame F + latency on every client. Each packet carries a sync hash to detect desyncs. Disconnects become a deterministic surrender. |
| Replays | same | A replay is the game settings plus the list of orders. Playback re-simulates the game. Save one from the end screen and load it with **Watch replay**. |
| Weapons | `engine/weapons.js`, `rules/weapons.yaml` | A weapon is a projectile (InstantHit, Bolt, Shell) plus warheads (SpreadDamage with Versus percentages, CreateEffect). |
| Players | `engine/player.js`, `traits/player.js` | A player actor with resources, supply, tech tree, weaver slots, shroud, statistics and victory conditions. |
| Bots | `traits/bot.js` | Modules on the player actor (harvester, base builder, unit builder, squad manager), enabled by `bot-*` conditions. They run inside the simulation, so they cost no network traffic. |
| Rendering | `render/` | Reads the world, interpolates, and turns simulation events (beams, explosions, deaths) into particles and sound. It never writes to the simulation. |
| UI | `ui/` | Camera, selection, order generators (normal, placement, attack-move), HUD and minimap. |
| Networking | `engine/netclient.js`, `server/relay.js` | The relay hosts lobbies and forwards packets. It never simulates anything. |

### Campaign and mission scripting

The campaign, *The Choir Beneath*, has five missions. Each one is a data file plus a script:

```
campaign/campaign.yaml            mission order, speakers (name, role, colour), intro, epilogue
campaign/missions/<id>.yaml       briefing, map spec, players, placed actors, rule overrides
campaign/missions/<id>.js         the mission script (runs inside the deterministic simulation)
```

The **map spec** in a mission file describes a generated map. You set the size, seed and obsidian percentage, then add spawns, vents, forced clearings, carved paths and walls. Every coordinate is in cells.

**Players** are either `Playable: true` or bots. A bot can be `passive` (only harvests), `easy`, `normal` or `hard`, or `campaign`, which uses the difficulty the player picked.

**Actors** are placed with `Actor@name` entries. Each name becomes available to the script through `m.actor(name)`.

The **Rules** section is merged on top of the normal rules. For example, `uplink:` with `-Buildable:` keeps the Uplink out of the build menu in that mission.

A script exports `worldLoaded(m)` (and optionally `tick(m)`). Everything goes through `m`:

| Area | API |
| --- | --- |
| Time | `m.frame`, `m.seconds(n)`, `m.minutes(n)`, `m.after(ticks, fn)`, `m.every(ticks, fn)` |
| Triggers | `m.when(testFn, fn)`, `m.onKilled(actors, fn)`, `m.onEachKilled(actors, fn)`, `m.onEnter(cell, range, player, fn)`, `m.onBuilt(player, type, fn)` |
| Actors | `m.actor(name)`, `m.actors(player, type)`, `m.near(cell, range, player)`, `m.spawn(type, player, cell, opts)`, `m.reinforce(player, types, from, to)`, `m.transfer(actors, player)`, `m.give(player, cash)` |
| Orders | `m.move`, `m.attackMove`, `m.attack`, `m.hold`, `m.order(actors, name, target, extra)` |
| Objectives | `m.objective(text, { primary, deadline, expire })`, `m.updateObjective`, `m.complete`, `m.fail`, `m.isDone`, `m.win()`, `m.lose()` |
| Presentation | `m.say(speaker, text)`, `m.hint(text)`, `m.focus(cell)`, `m.reveal(cell, range, ticks)`, `m.storm(y0, y1, ticks, warning)`, `m.damageBand(y0, y1, amount)` |
| Misc | `m.you` (the player), `m.player(id)`, `m.difficulty`, `m.pick(easy, normal, hard)`, `m.rng`, `m.state` (scratch space) |

How a mission ends:

- **Victory** is always declared by the script with `m.win()`, because missions add objectives in stages.
- **Failing** a primary objective ends the mission as a loss.
- **Losing every unit and structure** also ends it as a loss.

`npm run missions` loads every mission, checks placements, runs it idle, forces its victory path and checks determinism.

Campaign progress is saved in the browser. Add `?unlock` to the URL to open every mission.

### Trait hooks

A trait opts into engine events just by defining the method:

| Hook | When it runs |
| --- | --- |
| `created` | All traits on the actor exist. |
| `addedToWorld` / `removedFromWorld` | The actor enters or leaves the world. |
| `worldLoaded` | After players and the map are set up (world and player actors only). |
| `tick` | Once per simulation tick while enabled. |
| `idle` | The actor has no activity this tick. |
| `damaged` / `killed` | The actor took damage or died. |
| `actorDamaged` | One of the owner's actors took damage (player traits only). |
| `resolveOrder` | An order addressed to this actor runs. |
| `orderFor` | The UI asks what this trait would do with a target. |
| `enable` / `disable` | `RequiresCondition` changed. |

### Adding a unit

Add it to `rules/units.yaml`. Any trait from `src/traits/` can be used, and you can inherit and override:

```yaml
lancer:
	Inherits: ^Unit
	Inherits@armed: ^Armed
	Tooltip:
		Name: Lancer
		Description: Long-range glass spear thrower.
	Valued:
		Cost: 140
	Buildable:
		BuildDuration: 300
		Prerequisites: uplink
		Hotkey: L
		BuildPaletteOrder: 45
	Health:
		HP: 18000
	Mobile:
		Speed: 95
	Armament:
		Weapon: Lens
	WithModel:
		Model: needle
```

The new unit appears in the Foundry's build menu automatically. To give it its own look, add a builder to `src/render/models.js` and an icon to `src/ui/hud.js`.

### Determinism rules for simulation code

These apply to everything in `engine/`, `traits/` and `activities/`:

- **State is integers.** Use the helpers in `engine/math.js` (`isqrt`, `angleOf`, `sin`/`cos` tables). Avoid `Math.sin`, `Math.atan2`, `Math.hypot` and `**`.
- **Randomness comes only from `world.rng`.** Never `Math.random`, and never the clock.
- **Iterate in a stable order.** Actors are in id order; sort by id when gathering from maps or sets.
- **Never let the UI or renderer change state directly.** Send an order.

`npm run check` enforces most of this mechanically.

## Campaign: The Choir Beneath

| # | Mission | Type |
| --- | --- | --- |
| 1 | Landfall | Tutorial: squad combat, then build a base and raze a scrap camp |
| 2 | Choir Station | Defend a research Siphon against timed waves for six minutes |
| 3 | Glass Shadows | Squad only, no base: cut three relays in narrow canyons and rescue a lost crew |
| 4 | Furnace Line | Full base battle against the Combine AI |
| 5 | Wake | Destroy the Deep Drill against the clock while glass storms sweep the map |

## How it plays

| Concept | Glasswake |
| --- | --- |
| Resource | **Resonance** glass grown around vents. Cells slowly regrow. |
| Harvester | **Skimmer**. Drops off at a Core or Siphon. |
| Building | **Weaving.** Place a structure and it rises on site. Each Core supplies one weaver. |
| Placement | You can only build inside the **lattice field** of a Core or Pylon. Expand by chaining Pylons. |
| Economy cap | **Supply** from Cores and Resonators, up to 120. |
| Stances | Engage (chase within a leash) or Hold (fire from position). |

**Structures:**

| Key | Structure | Role |
| --- | --- | --- |
| C | Core | HQ |
| P | Pylon | Extends the lattice field |
| R | Resonator | Supply |
| I | Siphon | Forward drop-off; arrives with a free Skimmer |
| F | Foundry | Builds combat units |
| T | Prism Spire | Defensive tower |
| U | Uplink | Unlocks the Bastion |

**Units:**

| Key | Unit | Role |
| --- | --- | --- |
| K | Skimmer | Harvester |
| N | Needle | Raider |
| W | Warden | Line walker |
| M | Mender | Healer |
| B | Bastion | Siege |

### Controls

- **Selecting:** Left-drag to select. Shift-click adds to or removes from the selection. Double-click selects every unit of that type on screen.
- **Orders:** Right-click for the context order: move, attack, harvest, deliver or set a rally point. Shift + right-click queues orders.
- **Order hotkeys:** `A` attack-move, `S` stop, `H` hold stance, `G` engage stance, `X` recycle.
- **Groups:** `Ctrl+1–9` sets a control group, `1–9` recalls it, double-tap to jump the camera to it.
- **Camera:** Arrows, screen edges or middle-drag to pan. `Q`/`E` to rotate. Mouse wheel to zoom. `Space` jumps to the last alert.

### Debugging

- Add `?reveal` to the URL to show the whole map. This affects display only, so it is safe in multiplayer.
- `glasswake.world` and `glasswake.session` expose the live game in the browser console.
- `node tools/headless.js <seed> <minutes>` plays a bot match in the terminal.
