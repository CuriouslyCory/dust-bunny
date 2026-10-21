# Architecture

Map of the code for agents and humans. Terms follow `CONTEXT.md`; gameplay numbers follow `docs/design.md`. World units are **centimetres**; the floor is the **XZ plane** (y up). Camera yaw is fixed (camera on +Z looking towards −Z), so "up" on screen is −Z.

## Module map

| Path | What lives there |
| --- | --- |
| `src/main.ts` | Boot: registers screens, loads GLB overrides, creates `Game`, reads URL params. |
| `src/core/` | Engine-agnostic utilities: `events.ts` (typed `EventBus`, `Disposables`), `loop.ts` (`FixedLoop`), `input.ts` (`InputSource`, keyboard, mouse steer, `CompositeInput`), `rng.ts` (`Rng`, mulberry32), `spatialHash.ts`, `math.ts` (rects, circle-vs-AABB/circle push-out, damp), `registry.ts`. |
| `src/data/` | Tunable data only: `debris.ts` (Debris catalogue), `tiers.ts`, `tuning.ts` (all gameplay constants), `characters.ts`, `pickups.ts`, `perks.ts`, `upgrades.ts`. |
| `src/world/` | `house.ts` (seeded `generateHouse`), `rooms.ts` (room templates), `furniture.ts` (furniture defs + collision boxes), `types.ts` (`HouseLayout` etc.). Browser-only: `houseView.ts` (floors, rugs, walls, furniture, occlusion fade), `staticBatch.ts` (walls + furniture in one draw call), `meshBake.ts` (bake meshes to vertex colours), `materials.ts` (canvas textures), `models.ts` (model registry + GLB loader). |
| `src/entities/` | Sim state: `bunny.ts`, `debris.ts` (`DebrisField`), `stats.ts` (stat modifiers). Views: `bunnyView.ts` (shell fur, eyes, squash & stretch), `bunnyLook.ts` (`BunnyLook` = Character `look`, `resolveLook`), `debrisRenderer.ts`, `debrisGeometry.ts` (recipes or GLB props). |
| `src/systems/` | Per-tick `System`s: `movement.ts` (input, Dash, rolling), `absorb.ts` (absorb rule, growth formula, magnet), `collision.ts`, `growth.ts` (Tier-up), `spawner.ts`. `camera.ts` is render-side (`CameraRig`, aspect framing via `framingForAspect`: portrait viewports get a wider fov, steeper pitch and more distance) plus pure `cameraDistanceFor`/`viewRadiusFor` (aspect-independent, so gameplay is identical on every device) and `floorPointVisible`/`onScreen`/`spawnView` (the real on-screen floor trapezoid, from `run.viewInfo` which `RunView` refreshes each frame; a 16:9 default headless). |
| `src/game/` | `run.ts` (`Run`: one session, headless), `runView.ts` (rendering for a Run), `game.ts` (`Game`: renderer, scene, loop, screens, current Run), `system.ts` (`System`, `SYSTEM_ORDER`), `runStats.ts`. |
| `src/hazards/` | Hazards: `index.ts` (registry, `Hazard`, `HazardManager`), one file per Hazard, `director.ts`, `common.ts` (movement/collision, suction, hits), `decals.ts` (floor telegraphs), `shed.ts` (mass shedding), `models.ts` (procedural fallbacks), `hud.ts` (boss banner), `install.ts`. Tuning in `src/data/hazards.ts`. |
| `src/pickups/`, `src/perks/` | Registries/managers plus content: `pickups.ts` (six Pickups), `director.ts` (floor spawning), `view.ts` (glowing orb); `perks.ts` (twelve Perks), `draft.ts` (draft logic), `combat.ts` (shield / dodge / revive / Dust Cloud / Spiky Dash hooks, Regrowth). |
| `src/meta/` | Meta-progression: `save.ts` (versioned localStorage), `meta.ts` (Fluff wallet, Upgrades, Run awards, settings), `fluff.ts`, `upgrades.ts` (cost curve, Upgrade → stat modifiers), `install.ts` (`installRoguelike(game)`, called from `main.ts`). |
| `src/ui/` | `screens.ts` (screen registry + manager, `h()` DOM helper), `components.ts` (button/panel/slider/toggle/segmented, menu arrow-key nav), `screens/builtin.ts` (title/playing/paused), `screens/results.ts` (results + `registerResultsSection`), `screens/menus.ts` (settings, howToPlay), `screens/characterSelect.ts`, `screens/perkDraft.ts`, `screens/shop.ts`, `hud.ts` (widget HUD, toasts, banners), `roguelikeHud.ts` (charge chips), `settings.ts` + `settingsStorage.ts` (Settings store, persisted in the meta save), `install.ts` (applies quality / reduced motion). Plain DOM + CSS over the canvas: design tokens and shared components in `src/styles.css`; `ui/screens.css`, `ui/hud.css`, `ui/roguelike.css`. |
| `src/audio/` | WebAudio only, no files: `engine.ts` (buses, unlock, synth primitives), `sfx.ts`, `music.ts` (procedural lo-fi loop, intensity by Tier/boss), `voices.ts` (voice limiter, absorb tone mapping), `index.ts` (`installAudio`: event subscribers, M to mute, UI click/hover sounds). |
| `src/input/touch.ts` | Dynamic virtual joystick + Dash button (`InputSource`), gesture blocking, orientation refit. |
| `src/ui/leaderboard/` | Leaderboard panel (`createLeaderboardPanel`, mounted in the results screen) and the `leaderboard` screen (from the title). Own CSS. |
| `src/net/leaderboard.ts` | Leaderboard client: `getTop`, `submitScore`, `isOnline`. Falls back to a localStorage board when `/api/leaderboard` is unavailable (404, non-JSON, 5xx, network, timeout). |
| `src/shared/` | Code shared with the Vercel function: `score.ts` (score formula), `leaderboard.ts` (types, name sanitising, submission validation). No runtime imports from the rest of `src/`; relative imports use `.js`. |
| `api/leaderboard.ts` | Vercel Node function (Neon via `DATABASE_URL`). Type-checked by `tsconfig.api.json`, not bundled by Vite. Schema: `db/schema.sql`. |
| `src/fx/` | Render-side polish: `lighting.ts` (hemisphere + sun, shadow frustum follows the camera), `quality.ts` (`setQuality('low' \| 'high')`, `?quality=low\|high` overrides the saved setting), `perfWatchdog.ts` (drops to Low once after sustained <40 fps on High), `particles.ts` (puffs, dust motes), `sunbeams.ts`, `contactShadows.ts`, `vignette.ts`, `loading.ts`. |
| `src/debug/debug.ts` | `?debug` hooks. |
| `scripts/sim.ts` | Headless balance bot (`pnpm sim [seeds…] [--minutes=N]`). |

**Sim / render split.** `Run` and everything it touches (`Bunny`, `DebrisField`, systems, `generateHouse`) never touch the DOM or WebGL, so they run under Vitest and `pnpm sim`. Rendering reads that state each frame (`RunView`, `BunnyView`, `DebrisRenderer`, `HouseView`). The one exception: `run.entityRoot` (a `THREE.Group`) holds visuals owned by Hazards and Pickups; it's harmless headless.

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
| 500 | `collision` | push-out from walls/furniture AABBs (skipped if `2r < clearance`; walls use a squeezed radius inside doorways, `wallRadiusAt`) and Obstacle Debris circles (Debris up to `radius × TUNING.push.ratio` is shoved instead, `pushDebris`); clamp to bounds |
| 550 | `pickups` (`PickupManager`) | collect floor Pickups, expire timed effects |
| 600 | `growth` | emits `tierUp` per Tier crossed, records `run.tierTimes` |
| 700 | `spawner` (`DebrisSpawner`) | every 0.25 s: cull far tiny Debris, top up meaningful absorbables on floor that is off screen (`floorPointVisible`), reachable (`reachableBy`) and not cluttered (`clutterFree`) |

Add your own with `run.addSystem({ id, order, update(dt, run) })` (e.g. listen to `runStarted` and add it to `game.run`).

- `Game.render`: `RunView.render` (Debris instance sync, Bunny view, camera rig, occlusion fade), sun/shadow follow, HUD, `renderer.render`.

## Core rules (where to tune)

- **Absorb**: `canAbsorb(radius, absorbRatio, size)`, i.e. `size ≤ radius × absorbRatio` (`src/systems/absorb.ts`).
- **Growth**: `growRadius(r, size, mass, growthMultiplier, growthFactor)`, i.e. `cbrt(r³ + growthFactor × growthMultiplier × mass × size³)`. `TUNING.growthFactor` (currently 0.16) × the Tier's `growth` multiplier (`growthFactorAt`, `src/data/tiers.ts`) sets pacing; `pnpm sim` reports Tier times per Character (`--no-hazards` for pure growth, `--god` for Hazards that can't kill).
- **Speed** = `speed stat × TUNING.speedPerRadius × radius` (cm/s). Camera distance = `radius × tier.cameraScale` (smoothed). Fog and the spawner's view radius derive from it.
- **Gating**: furniture with `clearance` lets a Bunny with `2r < clearance` pass underneath (couch 6 cm, armchair 9, bed 24, tables ~40–72). A Bunny that outgrows the gap while underneath is ejected through `obstacle.exitDir` (the furniture front). Doorways (90 cm) are never a gate: the Bunny squeezes through at any size (`bunny.squeeze` drives the view's squash). Big Debris keeps `clutterSpacing` from its neighbours and almost-absorbable Debris can be pushed, so clutter can't box the Bunny in.
- **Run start**: the Bunny spawns under the front edge of the couch. `DebrisSpawner.populate` places template Debris (chairs, baskets, plants), a dense Speck cluster around the spawn, and a scatter whose Tier band rises with distance from the spawn.

## Events (`game.events`, typed in `src/core/events.ts`)

The bus lives on `Game` and outlives Runs: subscribe once at boot. Handlers run synchronously, and a throwing handler is logged without breaking the others.

| Event | Payload | Emitted by |
| --- | --- | --- |
| `runStarted` | `{ seed, characterId }` | `Game.startRun` |
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
| `bossSpawned` / `bossStunned` / `bossHit` | `{ hazardId, absorbRadius }` / `{ hazardId }` / `{ hazardId, size, absorbRadius }` | Robo-Vac 9000 |
| `bossDefeated` / `victory` | `{ hazardId, timeSec }` / `{ timeSec, radius }` | boss `onAbsorbed`, right before `runEnded` (`victory`) |
| `pickupSpawned` / `pickupCollected` / `pickupExpired` | `{ pickupId, defId }` / `{ defId }` | `PickupManager` |
| `perkApplied` | `{ perkId, stacks }` | `Run.applyPerk` |

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
- **Upgrades** (Shop): pass permanent modifiers via `game.nextRunConfig.modifiers` (applied at Run start). `startRadius` is read once at start.
- **Health**: `bunny.damage(amount, source)` respects i-frames (`TUNING.invulnerability`) and `bunny.damageFilters` (return a reduced amount; 0 cancels; use it for Bubble Wrap and Slippery). Also available: `bunny.heal(n)`, `bunny.knockback(dx, dz, strengthInRadiiPerSec)` (scaled by `knockbackResistance`), `bunny.rooted = seconds` (Lint Roller), `bunny.addVolume(dv)` (shed mass when negative).

## Roguelike layer (Characters, Pickups, Perks, Upgrades, save)

`installRoguelike(game)` (`src/meta/install.ts`) registers the Pickups, Perks and the `characterSelect` / `perkDraft` / `shop` screens, then:

- **Run hooks** on `runStarted`: `installRunHooks(run)` adds the combat damage filter (first in `bunny.damageFilters`), the `combat` System (order 290) and the Pickup director. Call it yourself for headless Runs (tests, `pnpm sim`).
- **Perk draft** on each `tierUp`: `game.go('perkDraft')` (queued when several Tiers are crossed at once). It offers `perkChoices` Perks, never an owned unique or maxed one; keys 1–4 / click / tap pick and R rerolls.
- **Upgrades → Run**: `game.nextRunConfig.modifiers = getMeta().runModifiers()` at boot and after every purchase (source `upgrade:<id>`, one modifier per Upgrade). `nextRunConfig.characterId` defaults to the last chosen Character.
- **Fluff** on `runEnded`: `getMeta().awardRun(e)` (idempotent per payload; the results screen calls it too), then `fluffAwarded { amount, total, reason }` is emitted. Formula in `src/meta/fluff.ts`.
- **Save**: `localStorage['dust-bunny:save:v1']` = `{ version: 1, fluff, upgrades, lastCharacterId, settings, stats: { runs, wins, bestRadius, bestTier, totalFluffEarned } }`. `parseSave` never throws: it migrates unversioned data, sanitises fields one by one, and backs corrupt JSON up to `…:corrupt`. Settings: `getMeta().settings` / `getMeta().updateSettings(patch)` (primitive values only). Listen with `getMeta().store.onChange(cb)`.
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

`installHazards(game)` (`src/hazards/install.ts`, called from `main.ts`) registers every Hazard and, on `runStarted`, calls `installRunHazards(run)`: the spawn director plus the absorb effect System. Call `installRunHazards` yourself for headless Runs.

- **Hazards** (`BaseHazard` in `base.ts`): Roomba (wander, wall bounce, suction ring), Lint Roller (lane back and forth, sticks the Bunny ~1 s and sheds mass), Broom (red arc telegraph, then sweep with big knockback), Spray Bottle (turret: aim lane telegraph, burst of droplets), Mop (patrol loop, fading wet trail that slows via a `hazard:wet` speed modifier), Upright Vacuum (amber cone warm-up, then a suction cone), Robo-Vac 9000 (boss) and its mini Roombas. `object3d` is a Group at the world origin; `body` holds the model at the Hazard position, decals are separate world-space meshes. A green ring marks a Hazard the Bunny can absorb.
- **Collision**: `moveCircle` resolves Hazards against walls and furniture whose `clearance` is at most the Hazard's height. A Bunny hiding under furniture the Hazard cannot enter (`bunnySheltered`, e.g. under the couch) gets no contact or suction.
- **Damage** always goes through `bunny.damage()`; knockback, stick and shedding only happen when it returns true. Knockback is a distance: `max(knockbackCm, knockbackRadii × radius)`. Suction pulls at a fraction of the Bunny's max speed × falloff × `suctionMultiplier` (weaker during i-frames). Hazards honour `hiddenFromHazards` (no aiming, chasing or suction) and `stunnedFor` (no movement or attacks). After landing a hit, Roomba / Mop / Upright Vacuum set `recoilFor` (`HAZARD_RECOIL`): they back off and deal no contact damage, so they can't pin the Bunny against a wall; the vacuum also cuts out. Ranged attacks (Spray Bottle shots, boss charges) only start while the Hazard is on screen (`onScreen`).
- **Shedding** (`shed.ts`): removes a fraction of r³ and scatters Debris around the Bunny sized so that re-absorbing every piece gives the volume back.
- **Director** (`director.ts`): `DIRECTOR.tiers` in `src/data/hazards.ts` sets per Tier an alive budget and spawn interval that ramp with Tier progress, plus weighted types with caps. 12 s grace at Run start. Spawns in a ring just outside the view; despawns Hazards that stay far away for 4 s or are out of view and smaller than radius × 0.12. Hazard speeds are per Tier and ramp up to +15 % within a Tier.
- **Boss**: 3 s after reaching Tier 5 the Robo-Vac 9000 arrives (`bossSpawned`, HUD banner and status line). It hunts with mild suction, telegraphs charges with a red lane, summons mini Roombas, and is stunned when a charge hits a wall. Touching it while stunned (or after a Spiky Dash stun) chips it to `size × 0.88` and knocks absorbable parts loose. Size 36 needs radius ≈ 51 to absorb; after one chip ≈ 45, after two ≈ 40. Absorbing it emits `bossDefeated`, `victory`, then `run.end('victory')`.
- **Debug** (`?debug`): `__game.debugTools.spawnHazard(id)`, `spawnBoss()`, `clearHazards()`.

## How to…

**Add a Debris type.** Append to `DEBRIS_TYPES` in `src/data/debris.ts` (or `registerDebrisType()` before a Run starts) with `id, name, size (radius cm), mass, colors, recipe, rooms, tiers`. Recipe parts (`box | sphere | cylinder | cone | torus | capsule | blob`) are in normalised units: `size` maps to 1 and y = 0 is the floor. Final colour is part `color` × an instance colour picked from `colors`. Each type gets one `InstancedMesh`. `tiers: [min, max]` controls when the spawner produces it (one Tier early if already absorbable), and `rooms` holds per-room weights (`any` is the fallback). For a fixed placement (like chairs), call `ctx.placeDebris` in a room template.

**Add a Hazard.** Subclass `BaseHazard` (implement `tick(dt, run)` and `onContact(run)`), register a def with `hazardRegistry.register({ id, name, minTier, spawnWeight, mass, modelId, create })`, import the file from `install.ts`, and add it to `SPAWN_FOOTPRINT` and a `DIRECTOR.tiers` entry. `HazardManager` absorbs a Hazard when `size ≤ radius × absorbRatio` (`run.absorbMass` with the def's `mass`, `hazardAbsorbed`, `onAbsorbed`); otherwise it calls `onContact`.

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

**Add a room / furniture.** Furniture defs go in `src/world/furniture.ts` (`clearance` + `legs` for things you can roll under). Room templates go in `src/world/rooms.ts` and use `FurnishContext` (`placeAgainstWall`, `place`, `placeDebris`, `addRug`, `setSpawn`), which rejects overlaps with doorways and other furniture.

## Debug hooks

URL params: `?debug`, `?seed=<string>` (same seed → same house and initial Debris), `?character=lint|tumble|zap` (otherwise the last chosen Character), `?autostart` (skip the title screen and character select).

With `?debug`:
- `window.__game`: the `Game` (`.run`, `.view`, `.events`, `.loop`, `.screens`…).
- `window.__game.debugTools`: `grow(factor)`, `setRadius(r)`, `nextTier()`, `setTimeScale(s)`, `advance(seconds)` (simulates immediately).
- Keys: `G` grows the radius ×1.25 (`Shift+G` shrinks it), `T` jumps to the next Tier, `]` / `[` doubles / halves sim speed.
- The HUD bottom-left shows fps, draw calls, Debris count, and radius.

For browser tests, load `/?debug&autostart&seed=test`, then use `__game.debugTools.nextTier()` ×4 to reach Tier 5.

## Known gaps

- Fluff is awarded for quit Runs too (per the design formula), so very short Runs still earn ~10 Fluff.
- Walls and furniture are one static batch (~80-120 draw calls at Tier 5 with Hazards). Rugs are one mesh each.
- At Tier 5 the view covers most of the house; the spawner uses whatever floor is still off screen (mostly behind the camera), and Tier 5 growth also comes from absorbable Hazards and boss chips.
- Furniture without a Blender model (tv_stand, stove, nightstand, dresser, desk, sink_cabinet, console_table, shoe_rack) is still procedural.
