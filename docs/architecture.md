# Architecture

Map of the code for agents and humans. Terms follow `CONTEXT.md`; gameplay numbers follow `docs/design.md`. World units are **centimetres**; the floor is the **XZ plane** (y up). Camera yaw is fixed (camera on +Z looking towards −Z), so "up" on screen is −Z.

## Module map

| Path | What lives there |
| --- | --- |
| `src/main.ts` | Boot: registers screens, loads GLB overrides, creates `Game`, reads URL params. |
| `src/core/` | Engine-agnostic utilities: `events.ts` (typed `EventBus`, `Disposables`), `loop.ts` (`FixedLoop`), `input.ts` (`InputSource`, keyboard, mouse steer, `CompositeInput`), `rng.ts` (`Rng`, mulberry32), `spatialHash.ts`, `math.ts` (rects, circle-vs-AABB/circle push-out, damp), `registry.ts`. |
| `src/data/` | Tunable data only: `debris.ts` (Debris catalogue), `tiers.ts`, `tuning.ts` (all gameplay constants), `characters.ts`. |
| `src/world/` | `house.ts` (seeded `generateHouse`), `rooms.ts` (room templates), `furniture.ts` (furniture defs + collision boxes), `types.ts` (`HouseLayout` etc.). Browser-only: `houseView.ts`, `materials.ts` (canvas textures), `models.ts` (model registry). |
| `src/entities/` | Sim state: `bunny.ts`, `debris.ts` (`DebrisField`), `stats.ts` (stat modifiers). Views: `bunnyView.ts`, `debrisRenderer.ts`, `debrisGeometry.ts`. |
| `src/systems/` | Per-tick `System`s: `movement.ts` (input, Dash, rolling), `absorb.ts` (absorb rule, growth formula, magnet), `collision.ts`, `growth.ts` (Tier-up), `spawner.ts`. `camera.ts` is render-side (`CameraRig`) plus pure `cameraDistanceFor`/`viewRadiusFor`. |
| `src/game/` | `run.ts` (`Run`: one session, headless), `runView.ts` (rendering for a Run), `game.ts` (`Game`: renderer, scene, loop, screens, current Run), `system.ts` (`System`, `SYSTEM_ORDER`), `runStats.ts`. |
| `src/hazards/`, `src/pickups/`, `src/perks/` | Extension points: interfaces, registries and managers. **No content yet.** |
| `src/ui/` | `screens.ts` (screen registry + manager, `h()` DOM helper), `screens/builtin.ts` (title/playing/paused/results), `hud.ts` (widget HUD). Plain DOM + CSS (`src/styles.css`) over the canvas. |
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
| 500 | `collision` | push-out from walls/furniture AABBs (skipped if `2r < clearance`) and Obstacle Debris circles; clamp to bounds |
| 550 | `pickups` (`PickupManager`) | collect floor Pickups, expire timed effects |
| 600 | `growth` | emits `tierUp` per Tier crossed, records `run.tierTimes` |
| 700 | `spawner` (`DebrisSpawner`) | every 0.25 s: cull far tiny Debris, top up meaningful absorbables outside the view |

Add your own with `run.addSystem({ id, order, update(dt, run) })` (e.g. listen to `runStarted` and add it to `game.run`).

- `Game.render`: `RunView.render` (Debris instance sync, Bunny view, camera rig, occlusion fade), sun/shadow follow, HUD, `renderer.render`.

## Core rules (where to tune)

- **Absorb**: `canAbsorb(radius, absorbRatio, size)`, i.e. `size ≤ radius × absorbRatio` (`src/systems/absorb.ts`).
- **Growth**: `growRadius(r, size, mass, growthMultiplier, growthFactor)`, i.e. `cbrt(r³ + growthFactor × growthMultiplier × mass × size³)`. `TUNING.growthFactor` (currently 0.16) sets pacing; `pnpm sim` reports Tier times (the greedy bot reaches Tier 5 in ~6–12 min).
- **Speed** = `speed stat × TUNING.speedPerRadius × radius` (cm/s). Camera distance = `radius × tier.cameraScale` (smoothed). Fog and the spawner's view radius derive from it.
- **Gating**: furniture with `clearance` lets a Bunny with `2r < clearance` pass underneath (couch 6 cm, armchair 9, bed 24, tables ~40–72). A Bunny that outgrows the gap while underneath is ejected through `obstacle.exitDir` (the furniture front).
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

Stats: `speed, acceleration, maxHealth, absorbRatio, growthMultiplier, magnetRadius, dashCooldown, dashSpeed, suctionMultiplier, knockbackResistance, startRadius`. Value = base (`BASE_BUNNY_STATS` + Character overrides), then modifiers sorted by `(priority, insertion)`. `add` defaults to priority 100 and `mul` to 200, which gives `(base + Σadd) × Πmul`. Results are clamped by `STAT_LIMITS`.

```ts
const h = run.bunny.stats.add({ stat: 'speed', op: 'mul', value: 1.5, source: 'pickup:sugar_rush', duration: 8 });
run.bunny.stats.remove(h);               // or
run.bunny.stats.removeSource('perk:aerodynamic');
```

- **Characters**: `src/data/characters.ts` (`stats` overrides base values). `game.nextRunConfig.characterId` / `?character=`.
- **Upgrades** (Shop): pass permanent modifiers via `game.nextRunConfig.modifiers` (applied at Run start). `startRadius` is read once at start.
- **Health**: `bunny.damage(amount, source)` respects i-frames (`TUNING.invulnerability`) and `bunny.damageFilters` (return a reduced amount; 0 cancels; use it for Bubble Wrap and Slippery). Also available: `bunny.heal(n)`, `bunny.knockback(dx, dz, strengthInRadiiPerSec)` (scaled by `knockbackResistance`), `bunny.rooted = seconds` (Lint Roller), `bunny.addVolume(dv)` (shed mass when negative).

## How to…

**Add a Debris type.** Append to `DEBRIS_TYPES` in `src/data/debris.ts` (or `registerDebrisType()` before a Run starts) with `id, name, size (radius cm), mass, colors, recipe, rooms, tiers`. Recipe parts (`box | sphere | cylinder | cone | torus | capsule | blob`) are in normalised units: `size` maps to 1 and y = 0 is the floor. Final colour is part `color` × an instance colour picked from `colors`. Each type gets one `InstancedMesh`. `tiers: [min, max]` controls when the spawner produces it (one Tier early if already absorbable), and `rooms` holds per-room weights (`any` is the fallback). For a fixed placement (like chairs), call `ctx.placeDebris` in a room template.

**Add a Hazard.** Register in `src/hazards/` (e.g. `src/hazards/roomba.ts`, imported from `main.ts`):

```ts
hazardRegistry.register({
  id: 'roomba', name: 'Roomba', minTier: 1, spawnWeight: 1, mass: 2, modelId: 'roomba',
  create(run, x, z, id, rng) {
    const object3d = createModel('roomba', { w: 34, d: 34, h: 9 });
    return { id, def: this, x, z, size: 17, shape: { kind: 'circle', radius: 17 }, object3d,
      update(dt, run) { /* move; sync object3d.position */ },
      onContact(run) { if (run.bunny.damage(1, 'roomba')) run.bunny.knockback(run.bunny.x - this.x, run.bunny.z - this.z, 20); } };
  },
});
```

`HazardManager` (`run.hazards`) handles absorbing: when `size ≤ radius × absorbRatio` it calls `run.absorbMass` and `onAbsorbed`, and sets `dead`. Otherwise it calls `onContact`. Spawning is up to you: set `run.hazards.director = (dt, run, mgr) => …` and call `mgr.spawn(defId, x, z)`. Use `isFloorFree(run.house, x, z, size)` from `systems/spawner.ts` to find valid spots. To win the Run, the boss's `onAbsorbed` calls `run.end('victory')`.

**Add a Pickup.** `pickupRegistry.register({ id, name, description, color, duration?, spawnWeight, apply(run, duration) })` in `src/pickups/`. `apply` may return an undo callback that runs on expiry. Timed stat effects can instead pass `duration` to `stats.add`. Spawn with `run.pickups.spawn(defId, x, z)` or a `run.pickups.director`. `run.pickups.durationScale` is the Hoarder hook. `createObject(radius)` overrides the default glowing sphere.

**Add a Perk.** `perkRegistry.register({ id, name, description, unique?, maxStacks?, weight?, apply(run, stacks) })` in `src/perks/`. Apply with `run.applyPerk(id)`. `availablePerks(run)` filters out unique or maxed Perks. Typical apply: `run.bunny.stats.add({ stat, op, value, source: 'perk:<id>' })`. The draft itself is a screen: subscribe to `tierUp`, then `game.go('perkDraft', choices)`.

**Add a screen.** Screens are the game state machine:

```ts
registerScreen({
  id: 'perkDraft', simulate: false, hud: true,
  create(game) { const el = h('div', { className: 'panel' }); return { el, enter(params) {…}, exit() {…}, onKey(e) { return false; } }; },
});
game.go('perkDraft', params);   // Run stops simulating; `paused` is emitted with reason 'perkDraft'
```

Re-registering an existing id (`title`, `playing`, `paused`, `results`) replaces the placeholder, but only if you do it before that screen is first shown. Screen DOM is created lazily. `Esc`/`P` handling lives in each screen's `onKey`. `game.startRun(config?)`, `game.quitRun()`, `game.disposeRun()`, and `game.nextRunConfig` exist for character select and the Shop.

**Add a HUD widget.** `game.hud.addWidget({ id, el, slot: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center', update(game, dt) })`. Remove one with `removeWidget(id)`.

**Override a model with a `.glb`.** Put the file in `public/models/` and list it in `public/models/manifest.json`:

```json
{ "couch": { "file": "couch.glb" }, "roomba": { "file": "roomba.glb", "fit": "none", "scale": 100 } }
```

`loadModelOverrides()` runs at boot (async, 8 s timeout, never throws). `createModel(id, { w, d, h, seed })` returns a clone of the GLB. By default the clone is fitted to the requested footprint box (origin at footprint centre, y = 0 floor, front faces +Z). With `fit: "none"` only `scale` is applied. With no override, it falls back to the procedural factory (`registerModel(id, factory)`). Furniture ids: `couch, armchair, coffee_table, tv_stand, bookshelf, dining_table, kitchen_counter, stove, fridge, bed, nightstand, dresser, desk, bathtub, toilet, sink_cabinet, console_table, shoe_rack`. Debris uses recipes, not the model registry.

**Add input.** Implement `InputSource.sample(): { moveX, moveZ, dash }` (world XZ, |move| ≤ 1, dash edge-triggered) and call `game.input.add(source)`. `screenToWorld(right, up, TUNING.camera.yaw)` converts a screen-relative stick vector. Mouse steering ignores `pointerType === 'touch'`, leaving touch to a joystick source.

**Add a room / furniture.** Furniture defs go in `src/world/furniture.ts` (`clearance` + `legs` for things you can roll under). Room templates go in `src/world/rooms.ts` and use `FurnishContext` (`placeAgainstWall`, `place`, `placeDebris`, `addRug`, `setSpawn`), which rejects overlaps with doorways and other furniture.

## Debug hooks

URL params: `?debug`, `?seed=<string>` (same seed → same house and initial Debris), `?character=lint|tumble|zap`, `?autostart` (skip the title screen).

With `?debug`:
- `window.__game`: the `Game` (`.run`, `.view`, `.events`, `.loop`, `.screens`…).
- `window.__game.debugTools`: `grow(factor)`, `setRadius(r)`, `nextTier()`, `setTimeScale(s)`, `advance(seconds)` (simulates immediately).
- Keys: `G` grows the radius ×1.25 (`Shift+G` shrinks it), `T` jumps to the next Tier, `]` / `[` doubles / halves sim speed.
- The HUD bottom-left shows fps, draw calls, Debris count, and radius.

For browser tests, load `/?debug&autostart&seed=test`, then use `__game.debugTools.nextTier()` ×4 to reach Tier 5.

## Known gaps

- Hazards, Pickups, Perks, character select, Shop, Perk draft, audio, touch joystick, leaderboard: hooks only.
- Furniture is many small meshes (~500 draw calls at Tier 5 including shadows); merge per material if mid-range GPUs struggle.
- At Tier 5 the view covers the whole house, so the spawner has no off-screen room left to spawn into. Late-game Debris supply relies on the initial scatter.
- Debris has no GLB override path (recipes only).
