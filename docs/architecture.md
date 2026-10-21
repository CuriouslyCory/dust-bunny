# Architecture

Map of the code for agents and humans. Terms follow `CONTEXT.md`; gameplay numbers follow `docs/design.md`. World units are **centimetres**; the floor is the **XZ plane** (y up). Camera yaw is fixed (camera on +Z looking towards −Z), so "up" on screen is −Z.

## Module map

| Path | What lives there |
| --- | --- |
| `src/main.ts` | Boot: registers screens, loads GLB overrides, creates `Game`, reads URL params. |
| `src/core/` | Engine-agnostic utilities: `events.ts` (typed `EventBus`, `Disposables`), `loop.ts` (`FixedLoop`), `input.ts` (`InputSource`, keyboard, mouse steer, `CompositeInput`), `rng.ts` (`Rng`, mulberry32), `spatialHash.ts`, `math.ts` (rects, circle-vs-AABB/circle push-out, damp), `registry.ts`. |
| `src/data/` | Tunable data only: `debris.ts` (Debris catalogue; `outdoorDebris.ts` holds the neighborhood types, `cityDebris.ts` the city types), `areas.ts` (per-area Debris Tier band, start density, growth multiplier), `tiers.ts`, `tuning.ts` (all gameplay constants), `difficulty.ts` (Casual / Arcade / Hardcore multipliers, `getDifficulty`, `difficultyModifiers`), `characters.ts`, `pickups.ts`, `perks.ts`, `upgrades.ts`. |
| `src/world/` | `house.ts` (seeded `generateHouse`, front door + `openExit`), `neighborhood.ts` (seeded `generateNeighborhood`: streets, lots, houses, trees, park, road barrier to the city), `city.ts` (seeded `generateCity`: avenues, sidewalks, building blocks, parking lots, park square), `outdoorModels.ts` (procedural houses/trees), `cityModels.ts` (procedural buildings), `rooms.ts` (room templates), `furniture.ts` (furniture defs + collision boxes), `types.ts` (`HouseLayout` etc.). Browser-only: `houseView.ts` (floors, rugs, walls, furniture, occlusion fade), `staticBatch.ts` (walls + furniture in one draw call), `meshBake.ts` (bake meshes to vertex colours), `materials.ts` (canvas textures), `models.ts` (model registry + GLB loader). |
| `src/entities/` | Sim state: `bunny.ts`, `debris.ts` (`DebrisField`), `stats.ts` (stat modifiers). Views: `bunnyView.ts` (shell fur, eyes, squash & stretch), `bunnyLook.ts` (`BunnyLook` = Character `look`, `resolveLook`), `debrisRenderer.ts`, `debrisGeometry.ts` (recipes or GLB props). |
| `src/systems/` | Per-tick `System`s: `movement.ts` (input, Dash, rolling), `absorb.ts` (absorb rule, growth formula, magnet), `collision.ts`, `growth.ts` (Tier-up), `spawner.ts`. `camera.ts` is render-side (`CameraRig`, aspect framing via `framingForAspect`: portrait viewports get a wider fov, steeper pitch and more distance) plus pure `cameraDistanceFor`/`viewRadiusFor` (aspect-independent, so gameplay is identical on every device) and `floorPointVisible`/`onScreen`/`spawnView` (the real on-screen floor trapezoid, from `run.viewInfo` which `RunView` refreshes each frame; a 16:9 default headless). |
| `src/game/` | `run.ts` (`Run`: one session, headless), `assembly.ts` (`createRun`: the headless Run assembly shared by the browser, `pnpm sim` and the integration tests), `runView.ts` (rendering for a Run), `game.ts` (`Game`: renderer, scene, loop, screens, current Run), `system.ts` (`System`, `SYSTEM_ORDER`), `runStats.ts`. |
| `src/hazards/` | Hazards: `index.ts` (registry, `HazardDef` with its placement `footprint`, `Hazard`, `HazardManager`), one file per Hazard, `director.ts`, `common.ts` (movement/collision, suction, hits), `decals.ts` (floor telegraphs), `shed.ts` (mass shedding), `models.ts` (procedural fallbacks), `hud.ts` (boss banner), `content.ts` (imports every Hazard file, registering them), `install.ts` (browser: boss HUD, debug tools). Tuning in `src/data/hazards.ts`. |
| `src/pickups/`, `src/perks/` | Registries/managers plus content: `pickups.ts` (six Pickups), `director.ts` (floor spawning), `view.ts` (glowing orb); `perks.ts` (twelve Perks), `draft.ts` (draft logic), `combat.ts` (shield / dodge / revive / Dust Cloud / Spiky Dash hooks, Regrowth). |
| `src/meta/` | Meta-progression: `save.ts` (versioned localStorage), `meta.ts` (Fluff wallet, Upgrades, Run awards, settings), `fluff.ts`, `upgrades.ts` (cost curve, Upgrade → stat modifiers), `install.ts` (`installRoguelike(game)`, browser side, called from `main.ts`). |
| `src/ui/` | `screens.ts` (screen registry + manager, `h()` DOM helper), `components.ts` (button/panel/slider/toggle/segmented, menu arrow-key nav, `scrollArea`: a panel's scrolling middle so title and action rows stay on screen; `COMPACT_QUERY` / `isCompact` for phone layouts), `screens/builtin.ts` (title/playing/paused), `screens/results.ts` (results + `registerResultsSection`), `screens/menus.ts` (settings, howToPlay), `screens/characterSelect.ts`, `screens/perkDraft.ts`, `screens/shop.ts`, `hud.ts` (widget HUD, toasts, banners), `roguelikeHud.ts` (charge chips), `settings.ts` + `settingsStorage.ts` (Settings store, persisted in the meta save), `install.ts` (applies quality / reduced motion). Plain DOM + CSS over the canvas: design tokens and shared components in `src/styles.css`; `ui/screens.css`, `ui/hud.css`, `ui/roguelike.css`. |
| `src/audio/` | WebAudio only, no files: `engine.ts` (buses, unlock, synth primitives), `sfx.ts`, `music.ts` (procedural lo-fi loop, intensity by Tier/boss), `voices.ts` (voice limiter, absorb tone mapping), `index.ts` (`installAudio`: event subscribers, M to mute, UI click/hover sounds). |
| `src/input/touch.ts` | Dynamic virtual joystick + Dash button (`InputSource`), gesture blocking, orientation refit. |
| `src/ui/leaderboard/` | Leaderboard panel (`createLeaderboardPanel`, mounted in the results screen) and the `leaderboard` screen (from the title). Own CSS. |
| `src/net/leaderboard.ts` | Leaderboard client: `getTop`, `submitScore`, `isOnline`. Falls back to a localStorage board when `/api/leaderboard` is unavailable (404, non-JSON, 5xx, network, timeout). |
| `src/shared/` | Code shared with the Vercel function: `score.ts` (score formula), `leaderboard.ts` (types, name sanitising, submission validation), `difficulty.ts` (Difficulty ids, score multipliers). No runtime imports from the rest of `src/`; relative imports use `.js`. |
| `api/leaderboard.ts` | Vercel Node function (Neon via `DATABASE_URL`). Type-checked by `tsconfig.api.json`, not bundled by Vite. Schema: `db/schema.sql`. |
| `src/fx/` | Render-side polish: `lighting.ts` (hemisphere + sun, shadow frustum follows the camera), `quality.ts` (`setQuality('low' \| 'high')`, `?quality=low\|high` overrides the saved setting), `perfWatchdog.ts` (drops to Low once after sustained <40 fps on High), `particles.ts` (puffs, dust motes), `sunbeams.ts`, `contactShadows.ts`, `vignette.ts`, `loading.ts`. |
| `src/debug/debug.ts` | `?debug` hooks. |
| `scripts/sim.ts` | Headless balance bot (`pnpm sim [seeds…] [--minutes=N]`); builds its Runs with `createRun`. |

**Areas.** A Run goes house → neighborhood → city (`AREA_ORDER`, `run.area`). Each area's boss opens its exit when absorbed (`BossTuning.onDefeat: 'openExit'`): `run.openExit()` removes the exit obstacle (`layout.exit`: the front door in the hallway's end wall, then the road barrier across one end of the neighborhood's main street), sets `houseCleared` / `neighborhoodCleared` and emits `exitOpened { area }`. When the Bunny touches the open exit, the `exit` System (order 650) calls `run.enterNextArea()` (or the HUD's skip button / Enter calls `run.leaveArea()` from anywhere once `run.canLeaveArea`) → `run.enterArea(next)`, which swaps `run.house` for the next generator's layout (`generateNeighborhood` / `generateCity`, same `HouseLayout` shape: zones play the part of rooms, houses / buildings and trees are furniture, the hedge / concrete barrier is the walls), resets Debris with a bigger spatial-hash cell, clears Hazards and floor Pickups, moves the Bunny to the area spawn (healing 1 heart, none on Hardcore), repopulates and emits `areaEntered`. Size, health, Perks and active Pickups carry over. `RunView` rebuilds the world view, `Game` switches sky/fog/lighting (`Lighting.setArea`) and snaps the camera. Zone types are unique per area (`zoneArea(type)`: house rooms, neighborhood `yard | street | sidewalk | driveway | park`, city `avenue | pavement | plaza | parking | square`); Debris types carry `area` (default `'house'`) and `roomWeight` returns 0 across areas. `AREAS[area].tiers` clamps the spawner's Tier band (house 1–5, neighborhood 5–7, city 7–9) and `AREAS[area].growth` scales growth (0.24 in the neighborhood, 0.11 in the city). The city boss (Garbage Truck, `onDefeat: 'victory'`) wins the Run.

**Sim / render split.** `Run` and everything it touches (`Bunny`, `DebrisField`, systems, `generateHouse`) never touch the DOM or WebGL, so they run under Vitest and `pnpm sim`. Rendering reads that state each frame (`RunView`, `BunnyView`, `DebrisRenderer`, `HouseView`). The one exception: `run.entityRoot` (a `THREE.Group`) holds visuals owned by Hazards and Pickups; it's harmless headless.

**Debris storage and changes.** `DebrisField` owns private dense per-type buckets, spatial indexing and coalesced change tracking. A Debris's `slot` is its current per-type instance index, not a stable identity: removal moves the bucket's last Debris into the vacated slot. `spawn`, `move`, `remove`, `clear` and `reset` keep storage, the spatial hash and pending changes coherent; moves/removals using dead or foreign handles are ignored. Retained change bookkeeping contains no Debris references: at most `cap` dirty slot numbers and `types.length` changed-type markers, independently of mutation count or renderer presence. `pendingChanges` reports both counts for diagnostics. Headless callers never need to consume changes to stay within that bound.

`consumeChanges()` is a destructive **single-consumer** interface for one active renderer. Each batch supplies a `typeIndex`, read-only current `instances` and unique valid `changedSlots`; `instances.length` is authoritative, including zero for empty changed types. Repeated moves collapse to final state, removal discards the old tail slot, and swap-removal marks the surviving occupant's new slot. These are borrowed views: consume them synchronously before the next field mutation, without mutating their contents or retaining them as snapshots. Attach or replace a renderer using `consumeChanges({ full: true })`, which includes every type and live slot even after earlier consumption. `DebrisRenderer` then consumes incremental batches, writing changed transforms and colors, updating counts/visibility for empty types, and filling **all** current instances when a mesh grows. `clear/reset` discard pending slots and invalidate formerly populated types even across repeated resets before synchronization; `reset` may also replace the spatial hash's cell size. The existing renderer remains attached when an Area resets and repopulates the field.

**Run assembly** (`src/game/assembly.ts`). Every Run is built by `createRun(events, config, rules?)`: `Game.startRun` in the browser, `scripts/sim.ts` and the gameplay integration tests (`src/game/assembly.test.ts`) all use it, so they play by the same rules. It imports no DOM, CSS or WebGL code and runs in plain Node. It:

1. registers the content (every Hazard on import, then Pickups and Perks via the idempotent `registerGameplayContent()`) before `new Run` applies `config.perks`;
2. builds the `Run` (Character stats, Difficulty, Upgrade `modifiers`, starting Perks, `area` start, all seeded from `config.seed`);
3. installs the gameplay rules with `installGameplay(run, rules?)`, in this order: the combat hooks (damage filter first in `bunny.damageFilters`, `combat` System at order 290), Hazard spawning (seeded `HazardDirector` as `run.hazards.director`, plus the `hazardFx` absorb effect System) and Pickup spawning (`run.pickups.director`).

`installGameplay` is idempotent: calling it again never adds a second filter or System and never replaces a running director (`getHazardDirector(run)` returns the one in use). `rules` turns optional parts off: `{ hazards: false }` and/or `{ pickups: false }` (the combat hooks are always installed). `pnpm sim --no-hazards` uses both for pure growth. Browser-only wiring stays out of it: `installRoguelike` (screens, Perk drafts, Fluff, HUD widgets) and `installHazards` (boss HUD, debug tools) subscribe to `game.events` at boot, and `runStarted` is emitted only after `createRun` returns, so its observers always see a Run whose rules are installed. Headless code should call `createRun` rather than `new Run` unless a test deliberately wants a bare Run (then `installGameplay(run)` adds the rules).

## Game loop

`FixedLoop` (`src/core/loop.ts`) runs `update(1/60)` up to 5 times per frame, then `render(alpha, frameDt)`.

- `Game.update(dt)` calls `run.update(dt)` only while the active screen has `simulate: true` (only `playing` by default). That's how pause works, along with any other modal screen.
- `Run.update(dt)`: `bunny.snapshot()` (for interpolation), `time += dt`, then each `System` in ascending `order`:

| order | system | does |
| --- | --- | --- |
| 100 | `movement` | input → velocity, Dash, knockback impulse decay, rolling, timers, `stats.tick` |
| 200 | `magnet` | pulls absorbable Debris within `radius × (1 + magnetRadius)` |
| 300 | `hazards` (`HazardManager`) | director, `hazard.update`, contact → absorb or `onContact` |
| 400 | `absorb` | touching Debris with `size ≤ radius × absorbRatio` → `run.absorbDebris` |
| 500 | `collision` | push-out from walls/furniture AABBs (skipped if `2r < clearance`; walls use a squeezed radius inside doorways, `wallRadiusAt`, and walls and furniture a squeezed one when the Bunny is wedged between obstacles on opposite sides, `gapRadiusAt`) and Obstacle Debris circles (Debris up to `radius × TUNING.push.ratio` is shoved instead, `pushDebris`); clamp to bounds |
| 550 | `pickups` (`PickupManager`) | collect floor Pickups, expire timed effects |
| 600 | `growth` | emits `tierUp` per Tier crossed, records `run.tierTimes` |
| 650 | `exit` | once the area's exit is open, touching it moves the Run to the next area |
| 700 | `spawner` (`DebrisSpawner`) | every 0.25 s: cull far tiny Debris, top up meaningful absorbables on floor that is off screen (`floorPointVisible`), reachable (`reachableBy`) and not cluttered (`clutterFree`) |

Add your own with `run.addSystem({ id, order, update(dt, run) })` (e.g. listen to `runStarted` and add it to `game.run`).

- `Game.render`: `RunView.render` (Debris instance sync, Bunny view, camera rig, occlusion fade), sun/shadow follow, HUD, `renderer.render`.

## Core rules (where to tune)

- **Absorb**: `canAbsorb(radius, absorbRatio, size)`, i.e. `size ≤ radius × absorbRatio` (`src/systems/absorb.ts`).
- **Growth**: `growRadius(r, size, mass, growthMultiplier, growthFactor)`, i.e. `cbrt(r³ + growthFactor × growthMultiplier × mass × size³)`. `TUNING.growthFactor` (currently 0.16) × the Tier's `growth` multiplier (`growthFactorAt`, `src/data/tiers.ts`) sets pacing; `pnpm sim` reports Tier times per Character (`--no-hazards` for pure growth, `--god` for Hazards that can't kill).
- **Speed** = `speed stat × TUNING.speedPerRadius × radius` (cm/s). Camera distance = `radius × tier.cameraScale` (smoothed). Fog and the spawner's view radius derive from it.
- **Gating**: furniture with `clearance` lets a Bunny with `2r < clearance` pass underneath (couch 6 cm, armchair 9, bed 24, tables ~40–72). A Bunny that outgrows the gap while underneath is ejected through `obstacle.exitDir` (the furniture front). Doorways (90 cm) are never a gate: the Bunny squeezes through at any size (`bunny.squeeze` drives the view's squash). Corridors aren't either: wedged between obstacles on opposite sides (the hallway walls, a console table and the wall), the fur squeezes down to `TUNING.squeeze.min` (0.4) × radius, so the post-boss Bunny (r ≈ 53–64, wider than the ~106 cm left beside the hallway furniture) still rolls to the front door. Head-on, a gap between two corners only opens from ~1.4 × radius, so small gaps stay closed. Big Debris keeps `clutterSpacing` from its neighbours and almost-absorbable Debris can be pushed, so clutter can't box the Bunny in.
- **Run start**: the Bunny spawns under the front edge of the couch. `DebrisSpawner.populate` places template Debris (chairs, baskets, plants), a dense Speck cluster around the spawn, and a scatter whose Tier band rises with distance from the spawn.

## Events (`game.events`, typed in `src/core/events.ts`)

The bus lives on `Game` and outlives Runs: subscribe once at boot. Handlers run synchronously, and a throwing handler is logged without breaking the others.

| Event | Payload | Emitted by |
| --- | --- | --- |
| `runStarted` | `{ seed, characterId }` | `Game.startRun` (after `createRun` installed the gameplay rules) |
| `debrisAbsorbed` | `{ typeId, size, position {x,y,z}, radius, kind: 'debris' \| 'hazard' }` | `Run.absorbMass` |
| `bunnyGrew` | `{ radius, previousRadius }` | `Bunny.setRadius` (also on shrink) |
| `tierUp` | `{ tier, previousTier, tierName }` | `growthSystem` (once per Tier crossed) |
| `bunnyDamaged` | `{ amount, source, health, maxHealth }` | `Bunny.damage` |
| `bunnyHealed` | `{ amount, health, maxHealth }` | `Bunny.heal` |
| `bunnyDied` | `{ source }` | `Bunny.damage` (Run then ends with `died`) |
| `dashStarted` | `{ cooldown }` | movement system |
| `runEnded` | `{ reason: 'died' \| 'victory' \| 'quit', stats: RunStats }` | `Run.end` (Game shows `results`) |
| `paused` / `resumed` | `{ reason: screenId }` | `Game.go` when simulation stops/starts mid-Run |
| `screenChanged` | `{ from, to }` | `Game.go` |
| `hazardSpawned` / `hazardRemoved` | `{ hazardId, defId }` / `+ absorbed` | `HazardManager` |
| `hazardAbsorbed` | `{ hazardId, defId, size, radius, boss }` | `HazardManager` (before `hazardRemoved`) |
| `hazardTelegraph` | `{ hazardId, defId, attack, duration }` | Hazards, when a floor telegraph starts |
| `bunnyShed` | `{ volume, pieces, source, radius }` | `shedMass` (Lint Roller, Upright Vacuum, boss) |
| `bossSpawned` / `bossStunned` / `bossHit` | `{ hazardId, absorbRadius, name }` / `{ hazardId }` / `{ hazardId, size, absorbRadius }` | Director / area bosses (Robo-Vac 9000, Street Sweeper, Garbage Truck) |
| `bossDefeated` / `victory` | `{ hazardId, defId, timeSec }` / `{ timeSec, radius }` | boss `onAbsorbed`; the Robo-Vac 9000 opens the front door, the Street Sweeper the road barrier, the Garbage Truck emits `victory` right before `runEnded` (`victory`) |
| `pickupSpawned` / `pickupCollected` / `pickupExpired` | `{ pickupId, defId }` / `{ defId }` | `PickupManager` |
| `perkApplied` | `{ perkId, stacks }` | `Run.applyPerk` |
| `exitOpened` | `{ area, x, z }` (exit centre) | `Run.openExit` (after the Robo-Vac 9000 / Street Sweeper) |
| `areaEntered` | `{ area, timeSec }` | `Run.enterArea` |

Add events by augmenting the interface from your module:

```ts
declare module '../core/events' {
  interface GameEvents { hazardStunned: { hazardId: number } }
}
```

Audio should be event-bus subscribers only (e.g. `src/audio/` subscribing in `main.ts`). Use `paused`/`resumed` to duck.

## Bunny stats and modifiers (`src/entities/stats.ts`)

Stats: `speed, acceleration, maxHealth, absorbRatio, growthMultiplier, magnetRadius, dashCooldown, dashSpeed, suctionMultiplier, knockbackResistance, startRadius`, plus roguelike stats `pickupDuration` (Hoarder), `pickupLuck` (Pickup spawn rate), `dodgeChance` (Slippery, max 0.75), `perkChoices` (3; Wide Choice → 4), `perkRerolls` (Reroll Upgrade). Value = base (`BASE_BUNNY_STATS` + Character overrides), then modifiers sorted by `(priority, insertion)`. `add` defaults to priority 100 and `mul` to 200, which gives `(base + Σadd) × Πmul`. Results are clamped by `STAT_LIMITS`.

```ts
const h = run.bunny.stats.add({ stat: 'speed', op: 'mul', value: 1.5, source: 'pickup:sugar_rush', duration: 8 });
run.bunny.stats.remove(h);               // or
run.bunny.stats.removeSource('perk:aerodynamic');
```

- **Characters**: `src/data/characters.ts` (`stats` overrides base values). `game.nextRunConfig.characterId` / `?character=`.
- **Difficulty**: `RunConfig.difficulty` (`game.nextRunConfig.difficulty`, `?difficulty=`, default from the save's `lastDifficulty`) → `run.difficulty` (a `DifficultyDef` from `src/data/difficulty.ts`). It adds stat modifiers at Run start (`difficultyModifiers`: Hardcore −1 `maxHealth`, ×0.7 `pickupLuck`, source `difficulty:<id>`), sets the hearts healed on reaching a new area (`areaHeal`), scales the Hazard director (budget, spawn interval, grace period) and Hazards: use `BaseHazard.tierSpeed` / `speed(run, cmPerSec)` for any movement and `attackTime(run, seconds)` for telegraphs, warm-ups, cooldowns and summon intervals, so new Hazards follow the Difficulty too. `RunStats.difficulty` feeds the Fluff multiplier and the leaderboard score.
- **Upgrades** (Shop): pass permanent modifiers via `game.nextRunConfig.modifiers` (applied at Run start). `startRadius` is read once at start.
- **Health**: `bunny.damage(amount, source)` respects i-frames (`TUNING.invulnerability`) and `bunny.damageFilters` (return a reduced amount; 0 cancels; use it for Bubble Wrap and Slippery). Also available: `bunny.heal(n)`, `bunny.knockback(dx, dz, strengthInRadiiPerSec)` (scaled by `knockbackResistance`), `bunny.rooted = seconds` (Lint Roller), `bunny.addVolume(dv)` (shed mass when negative).

## Roguelike layer (Characters, Pickups, Perks, Upgrades, save)

Pickups, Perks, the combat hooks and the Pickup director belong to the Run assembly (see **Run assembly** above). `installRoguelike(game)` (`src/meta/install.ts`) is the browser side: it registers the `characterSelect` / `perkDraft` / `shop` screens, then:
- **Perk draft** on each `tierUp`: `game.go('perkDraft')` (queued when several Tiers are crossed at once). It offers `perkChoices` Perks, never an owned unique or maxed one; keys 1–4 / click / tap pick and R rerolls.
- **Upgrades → Run**: `game.nextRunConfig.modifiers = getMeta().runModifiers()` at boot and after every purchase (source `upgrade:<id>`, one modifier per Upgrade). `nextRunConfig.characterId` defaults to the last chosen Character.
- **Fluff** on `runEnded`: `getMeta().awardRun(e)` (idempotent per payload; the results screen calls it too), then `fluffAwarded { amount, total, reason }` is emitted. Formula in `src/meta/fluff.ts` (× the Difficulty's `fluff`).
- **Save**: `localStorage['dust-bunny:save:v1']` = `{ version: 1, fluff, upgrades, lastCharacterId, lastDifficulty, settings, stats: { runs, wins, bestRadius, bestTier, totalFluffEarned } }`. `parseSave` never throws: it migrates unversioned data, sanitises fields one by one, and backs corrupt JSON up to `…:corrupt`. Settings: `getMeta().settings` / `getMeta().updateSettings(patch)` (primitive values only). Listen with `getMeta().store.onChange(cb)`.
- **Character look**: `CharacterDef.look = { color, tipColor, furLength, fluffiness, eyeStyle: 'round' | 'sleepy' | 'sparkly', glow? }`. `BunnyView` currently applies only `color`.
- **Events added**: `shieldBlocked`, `damageDodged`, `bunnyRevived`, `hazardStunned`, `fluffAwarded`, `upgradePurchased`.

**Hooks other modules must respect** (fields on `Bunny` / `Hazard`):

| Hook | Set by | Contract |
| --- | --- | --- |
| Damage only via `bunny.damage(amount, source)` | — | Lethal effects (e.g. a vacuum sucking the Bunny up) must call `damage`, never set `health` or call `run.end('died')` directly, or Bubble Wrap / Slippery / Second Wind are skipped. Gate knockback on its return value. |
| `bunny.shield` (charges) | Bubble Wrap | The combat filter consumes one charge per hit and grants i-frames. |
| `bunny.hiddenFromHazards` | Dust Cloud | Hazards must not target, chase or apply suction/pull while true. Contact damage is already cancelled by the filter. |
| `bunny.revives` (charges) | Second Wind | A lethal hit restores full health instead (`bunnyRevived`, 2.5 s i-frames). |
| `bunny.spikyDash` + `bunny.dashing` | Spiky Dash | Contact while dashing deals no damage. The combat System sets `hazard.stunnedFor = 2.5`, calls optional `hazard.stun?(s)`, and counts `stunnedFor` down. Hazards must skip movement/attacks while `stunnedFor > 0`. |
| `bunny.stats.get('suctionMultiplier')` | Zap (1.5) | Scale suction forces by it. |

## Hazards

Importing `src/hazards/content.ts` registers every Hazard; the Run assembly imports it and installs the spawn director plus the absorb effect System on each Run. `installHazards(game)` (`src/hazards/install.ts`, called from `main.ts`) adds only the browser side: the boss HUD and the `?debug` tools.

- **Hazards** (`BaseHazard` in `base.ts`): Roomba (wander, wall bounce, suction ring), Lint Roller (lane back and forth, sticks the Bunny ~1 s and sheds mass), Broom (red arc telegraph, then sweep with big knockback), Spray Bottle (turret: aim lane telegraph, burst of droplets), Mop (patrol loop, fading wet trail that slows via a `hazard:wet` speed modifier), Upright Vacuum (amber cone warm-up, then a suction cone), Robo-Vac 9000 (boss) and its mini Roombas. `object3d` is a Group at the world origin; `body` holds the model at the Hazard position, decals are separate world-space meshes. A green ring marks a Hazard the Bunny can absorb.
- **Outdoor Hazards** reuse those classes with their own tuning (`RoombaTuning`, `LaneTuning`, `TurretTuning`, `AirConeTuning`, `BossTuning` in `src/data/hazards.ts`; outdoor per-Tier values come from `outdoorTiers(t5, t6, t7)`). Robotic Mower (`Roomba`, size 55, weak blade pull, spins `blade`). Lawn Mower (`LintRoller` lane, size 65; no sticking: a hit knocks the Bunny off the lane, sheds mass and pauses the mower). Leaf Blower (`UprightVacuum` in `blow` mode, size 45: amber warm-up, then a blast that pushes the Bunny away from the nozzle (stronger up close) and blows Debris ≤ 20 cm along; only starts on screen). Sprinkler (`SprayBottle`, size 45: only the `head` node turns, it sweeps idly out of range, and a water hit adds a 1.5 s `hazard:wet` slow).
- **City Hazards** do the same with `cityTiers(t7, t8, t9)` and `MopTuning`. Their Blender models are real-size, so every tuning has a `modelSize` (model scale = size / modelSize; 1 for the house and neighborhood ones). Floor Scrubber (`Roomba`, size 190, weak scrub-brush pull, spins `brush`). Pressure Washer (`SprayBottle`, size 170: `head` turns, a burst of five fast water jets, a hit soaks like the Sprinkler; only fires on screen). Litter Vacuum (`UprightVacuum` in suction mode, size 220, contact sheds mass). Street Flusher (`Mop`, size 300, from Tier 8: patrols waypoints within `patrolRange` of its spawn in its zone, leaves a wide wet trail, knockback on contact).
- **Collision**: `moveCircle` resolves Hazards against walls and furniture whose `clearance` is at most the Hazard's height. A Bunny hiding under furniture the Hazard cannot enter (`bunnySheltered`, e.g. under the couch) gets no contact or suction.
- **Damage** always goes through `bunny.damage()`; knockback, stick and shedding only happen when it returns true. Knockback is a distance: `max(knockbackCm, knockbackRadii × radius)`. Suction pulls at a fraction of the Bunny's max speed × falloff × `suctionMultiplier` (weaker during i-frames). Hazards honour `hiddenFromHazards` (no aiming, chasing or suction) and `stunnedFor` (no movement or attacks). After landing a hit, Roomba / Mop / Upright Vacuum set `recoilFor` (`HAZARD_RECOIL`): they back off and deal no contact damage, so they can't pin the Bunny against a wall; the vacuum also cuts out. Ranged attacks (Spray Bottle shots, boss charges) only start while the Hazard is on screen (`onScreen`).
- **Shedding** (`shed.ts`): removes a fraction of r³ and scatters Debris around the Bunny sized so that re-absorbing every piece gives the volume back.
- **Director** (`director.ts`): `DIRECTOR.tiers` in `src/data/hazards.ts` sets per Tier an alive budget and spawn interval that ramp with Tier progress, plus weighted types with caps. 12 s grace at Run start. Spawns in a ring just outside the view, on a spot clear for the def's `footprint`; despawns Hazards that stay far away for 4 s or are out of view and smaller than radius × 0.12. Hazard speeds are per Tier and ramp up to +15 % within a Tier. The Run's Difficulty multiplies the budget, spawn interval, grace period and Hazard speeds (`src/data/difficulty.ts`). In the neighborhood it reads `NEIGHBORHOOD_DIRECTOR.tiers` (Tiers 5–7, 10 s grace after arriving): Robotic Mower, Sprinkler and Leaf Blower from Tier 5, Lawn Mower from Tier 6. In the city, `CITY_DIRECTOR.tiers` (Tiers 7–9): Floor Scrubber, Pressure Washer and Litter Vacuum from Tier 7, Street Flusher from Tier 8. `DIRECTOR_EXCLUDE` keeps bosses and their summons (`mini_roomba`, `mini_mower`, `mini_scrubber`) out of the random picks and the budget.
- **Bosses** (`robovac.ts`, one class driven by `BossTuning`): 3 s after reaching Tier 5 the Robo-Vac 9000 arrives (`bossSpawned`, HUD banner and status line). It hunts with mild suction, telegraphs charges with a red lane, summons mini Roombas, and is stunned when a charge hits a wall. Touching it while stunned (or after a Spiky Dash stun) chips it to `size × 0.88` and knocks absorbable parts loose. Size 36 needs radius ≈ 51 to absorb; after one chip ≈ 45, after two ≈ 40. Absorbing it emits `bossDefeated` and opens the front door (`run.openExit()`).
- **Street Sweeper** (neighborhood boss, `STREET_SWEEPER`): arrives 4 s after Tier 7. Same state machine at street scale (size 150, contact radius 160); houses, trees and the hedge stun its charges, chips are `× 0.85`, and it summons mini mowers. It needs radius ≈ 214 to absorb, ≈ 182 after one chip and ≈ 155 after two (Tier 7 starts at 160). Absorbing it kills its minis, emits `bossDefeated` and opens the road barrier to the city.
- **Garbage Truck** (city boss, `GARBAGE_TRUCK`): arrives 4 s after Tier 9. Size 560, contact radius 590 (model × 1.3); its compactor sucks the Bunny in while it hunts, buildings and the concrete barrier stun its charges, chips are `× 0.85`, and it summons mini scrubbers. It needs radius ≈ 800 to absorb, ≈ 680 after one chip and ≈ 578 after two (Tier 9 starts at 600). Chip pieces are the closest-sized Debris valid at the Bunny's Tier (`pickShedType`), so city Debris (Tiers 7–9) is used once it exists; otherwise the closest size from any area. Absorbing it kills its minis and emits `bossDefeated`, `victory`, then `run.end('victory')`: this wins the Run.
- **Debug** (`?debug`): `__game.debugTools.spawnHazard(id)` (`HazardDirector.spawnNear`: spawns in view next to the Bunny on a spot clear for the def's `footprint`; a boss id goes through `spawnBoss`), `spawnBoss()` (the current area's boss), `clearHazards()`.

## How to…

**Add a Debris type.** Append to `DEBRIS_TYPES` in `src/data/debris.ts` (or `registerDebrisType()` before a Run starts) with `id, name, size (radius cm), mass, colors, recipe, rooms, tiers`. Recipe parts (`box | sphere | cylinder | cone | torus | capsule | blob`) are in normalised units: `size` maps to 1 and y = 0 is the floor. Final colour is part `color` × an instance colour picked from `colors`. Each type gets one `InstancedMesh`. `tiers: [min, max]` controls when the spawner produces it (one Tier early if already absorbable), and `rooms` holds per-room weights (`any` is the fallback). For a fixed placement (like chairs), call `ctx.placeDebris` in a room template.

**Add a Hazard.** Subclass `BaseHazard` (implement `tick(dt, run)` and `onContact(run)`), register a def with `hazardRegistry.register({ id, name, footprint, mass, modelId, create })`, and import the file from `content.ts`. The def is the one place that knows how to build the Hazard and where it fits: `footprint` (`{ radius, height }`, checked with `hazardFloorFree`) is read by director spawns, boss arrivals, boss summons and `debugTools.spawnHazard`. Use `tuningFootprint(cfg)` (the tuning's `size` × `height`) unless the Hazard needs a deliberate envelope (the Broom reserves half its sweep, bosses their contact radius). Then decide when it spawns in the balance data in `src/data/hazards.ts`: a weighted, capped entry in `DIRECTOR.tiers` (house), `NEIGHBORHOOD_DIRECTOR.tiers` (outdoor) or `CITY_DIRECTOR.tiers` (city); or, for a boss or a summon, `AREA_BOSSES` / a `BossTuning.miniId` plus `DIRECTOR_EXCLUDE`. These tables are the only selection data (defs carry no weights, caps or first Tier). Finally add it to the `TUNING` (or `ENVELOPES`) table in `src/hazards/placement.test.ts`, which checks every registered footprint against its tuning. A variant of an existing behaviour is usually just a new tuning object passed to the existing class (see the outdoor Hazards). `HazardManager` absorbs a Hazard when `size ≤ radius × absorbRatio` (`run.absorbMass` with the def's `mass`, `hazardAbsorbed`, `onAbsorbed`); otherwise it calls `onContact`.

**Add a Pickup.** Add data to `src/data/pickups.ts` and a def to `PICKUP_DEFS` in `src/pickups/pickups.ts` (`{ id, name, icon, description, color, duration?, spawnWeight, apply(run, duration) }`). `apply` may return an undo callback that runs on expiry; collecting an active timed Pickup undoes and re-applies it with a fresh timer. Durations are scaled by the `pickupDuration` stat (Hoarder). The director spawns from all registered Pickups by `spawnWeight`; `run.pickups.spawn(defId, x, z)` spawns one directly.

**Add a Perk.** Add data to `src/data/perks.ts` and a def to `PERK_DEFS` in `src/perks/perks.ts` (`{ id, name, icon, description, unique?, maxStacks?, weight?, apply(run, stacks) }`). Apply with `run.applyPerk(id)`. `availablePerks(run)` filters out unique or maxed Perks. Typical apply: `run.bunny.stats.add({ stat, op, value, source: 'perk:<id>' })`.

**Add an Upgrade.** Append to `UPGRADES` in `src/data/upgrades.ts` (`stat`, `op`, `perLevel`, `maxLevel`, `baseCost`, `costGrowth`). The Shop lists it and `upgradeModifiers` applies it.

**Add a screen.** Screens are the game state machine:

```ts
registerScreen({
  id: 'perkDraft', simulate: false, hud: true,
  create(game) { const el = h('div', { className: 'panel' }); return { el, enter(params) {…}, exit() {…}, onKey(e) { return false; } }; },
});
game.go('perkDraft', params);   // Run stops simulating; `paused` is emitted with reason 'perkDraft'
```

Re-registering an existing id (`title`, `playing`, `paused`, `results`) replaces the placeholder, but only if you do it before that screen is first shown. Screen DOM is created lazily. `Esc`/`P` handling lives in each screen's `onKey`. `game.startRun(config?)`, `game.quitRun()`, `game.disposeRun()`, and `game.nextRunConfig` exist for character select and the Shop.

**Add a HUD widget.** `game.hud.addWidget({ id, el, slot, update(game, dt) })` with slot `top-left | top-right | top-center | bottom-left | bottom-right | bottom-center | center | status | perks` (`status` is the row under the Tier card, `perks` the row under the top-right counters). Remove one with `removeWidget(id)`. Also: `game.hud.toast(text, { key, tone })` (batched, rate-limited), `game.hud.banner(title, { subtitle, variant: 'tier' | 'boss' | 'good' | 'info', duration })`, `game.hud.flash(widgetId)`. Active Pickups and taken Perks render automatically from `PickupDef.icon` / `PerkDef.icon`; `registerHudIcon(kind, id, { glyph, svg, color, label })` overrides the art.

**Add UI.** Build screens from `src/ui/components.ts` (or the `.panel`, `.btn .btn-primary|secondary|ghost`, `.menu`, `.menu-grid`, `.field` classes) and the CSS custom properties in `src/styles.css`. Call `handleMenuKeys(e, el)` from `onKey` for arrow-key navigation. Results content goes in `registerResultsSection({ id, slot: 'fluff' | 'leaderboard' | 'extra', render(el, result, game) })`. Settings: `settings.value`, `settings.update(patch)`, `settings.subscribe(fn)` from `src/ui/settings.ts`. Sounds: `getAudio()?.sfx.pickup()` etc.; buttons in `#ui` get hover/click sounds automatically.

**Override a model with a `.glb`.** Put the file in `public/models/` and list it in `public/models/manifest.json`:

```json
{ "couch": { "file": "couch.glb", "fit": "xz" }, "roomba": { "file": "roomba.glb", "fit": "none", "collapse": true } }
```

`loadModelOverrides()` runs at boot (async, 8 s timeout, never throws). `createModel(id, { w, d, h, seed })` returns a clone of the GLB. By default the clone is fitted to the requested footprint box (origin at footprint centre, y = 0 floor, front faces +Z). `fit: "xz"` stretches only X/Z and keeps the authored height (furniture, so clearances stay exact). With `fit: "none"` only `scale` is applied, and a model reaching below y = 0 is lifted onto the floor (the broom's handle-top origin ends up on the floor below the pivot). `collapse: true` merges each node's primitives into one vertex-coloured mesh; named nodes (`side_brush`, `drum`, `brush_l`/`brush_r`) survive cloning. All Blender models are listed in the manifest (see `docs/models.md`). With no override, it falls back to the procedural factory (`registerModel(id, factory)`). Furniture ids: `couch, armchair, coffee_table, tv_stand, bookshelf, dining_table, kitchen_counter, stove, fridge, bed, nightstand, dresser, desk, bathtub, toilet, sink_cabinet, console_table, shoe_rack`. Debris types whose id matches a loaded model (shoe, sock, toy_car, book, tv_remote, chair, laundry_basket) use the baked GLB in their InstancedMesh; others use recipes.

**Add input.** Implement `InputSource.sample(): { moveX, moveZ, dash }` (world XZ, |move| ≤ 1, dash edge-triggered) and call `game.input.add(source)`. `screenToWorld(right, up, TUNING.camera.yaw)` converts a screen-relative stick vector. Mouse steering ignores `pointerType === 'touch'`, leaving touch to a joystick source.

**Add an area.** Add the id to `AreaId` and `AREA_ORDER` (`src/world/types.ts`) plus its zone types, a generator returning a `HouseLayout` (with an `exit` if another area follows), an `AREA_WORLDS` entry in `run.ts`, an `AREAS` entry, an `AREA_DIRECTORS` table and `AREA_BOSSES` entry in `src/data/hazards.ts`, sky/light in `game.ts` / `lighting.ts`, and its exit compass and skip button text in `ui/areaHud.ts`.

**Add a room / furniture.** Furniture defs go in `src/world/furniture.ts` (`clearance` + `legs` for things you can roll under). Room templates go in `src/world/rooms.ts` and use `FurnishContext` (`placeAgainstWall`, `place`, `placeDebris`, `addRug`, `setSpawn`), which rejects overlaps with doorways and other furniture.

## Debug hooks

URL params: `?debug`, `?seed=<string>` (same seed → same house, neighborhood, city and initial Debris), `?character=lint|tumble|zap` (otherwise the last chosen Character), `?difficulty=casual|arcade|hardcore` (otherwise the last chosen Difficulty), `?autostart` (skip the title screen and character select), `?area=neighborhood` (start outside with a house-cleared Bunny, r = 56), `?area=city` (start in the city with a neighborhood-cleared Bunny, r = 185).

With `?debug`:
- `window.__game`: the `Game` (`.run`, `.view`, `.events`, `.loop`, `.screens`…).
- `window.__game.debugTools`: `grow(factor)`, `setRadius(r)`, `nextTier()`, `setTimeScale(s)`, `advance(seconds)` (simulates immediately), `openExit()`, `enterNeighborhood()`, `enterCity()`, `nextArea()`.
- Keys: `G` grows the radius ×1.25 (`Shift+G` shrinks it), `T` jumps to the next Tier, `N` clears the current area and rolls on to the next, `]` / `[` doubles / halves sim speed.
- The HUD bottom-left shows fps, draw calls, Debris count, and radius.

For browser tests, load `/?debug&autostart&seed=test`, then use `__game.debugTools.nextTier()` ×4 to reach Tier 5. For the neighborhood, load `/?debug&autostart&seed=test&area=neighborhood`; for the city, `&area=city`. `pnpm sim --area=neighborhood|city` measures later-area pacing and `--difficulty=arcade|hardcore` a harder Difficulty; in a normal sim Run the bot skips the walk to each exit once an area is cleared.

## Known gaps

- Fluff is awarded for quit Runs too (per the design formula), so very short Runs still earn ~10 Fluff.
- Walls and furniture are one static batch (~80-120 draw calls at Tier 5 with Hazards). Rugs are one mesh each.
- At Tier 5 the view covers most of the house; the spawner uses whatever floor is still off screen (mostly behind the camera), and Tier 5 growth also comes from absorbable Hazards and boss chips.
- Furniture without a Blender model (tv_stand, stove, nightstand, dresser, desk, sink_cabinet, console_table, shoe_rack) is still procedural.
