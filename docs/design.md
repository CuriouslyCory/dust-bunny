# Dust Bunny — Game Design

Terms follow `CONTEXT.md`. Numbers below are starting points; tune them in the data files, not in logic.

## Pitch

Katamari-style growth roguelike on a house floor, rendered in three.js. You start as a 1 cm Speck under the couch, absorbing lint and staples. Every Tier you grow into pulls the camera back, reveals more of the house, and turns former Obstacles into Debris. Roombas, lint rollers, brooms, and other cleaning gear roam the floor and hurt you, until you are big enough to absorb them too. Final goal: absorb the Robo-Vac 9000 boss.

Target: a 10–15 minute demo-quality house, a 5–8 minute neighborhood, a 7–10 minute city, then 4–6 minutes each for the region and the continent, playable on desktop (keyboard/mouse) and mobile (touch).

**Neighborhood phase.** Absorbing the Robo-Vac 9000 no longer ends the Run: the front door at the end of the hallway swings open and a door compass points to it, with a skip button (Enter on a keyboard) that moves on from wherever the Bunny is, so a Bunny too big to reach the door is never stuck. Rolling out of it fades into a seeded suburban street (about 96 × 72 m: a main street and a cross street, seven houses with yards and driveways, a park). Outdoor Debris runs from pinecones and garden gnomes up to bikes, picnic tables and parked cars; houses and big trees stay Obstacles. Absorbing the Street Sweeper (arrives at Tier 7) lifts the road barrier at one end of the main street.

**City phase.** Rolling through the barrier fades into a seeded city at golden hour (about 320 × 240 m: three avenues and four streets with sidewalks and crosswalks, office towers and plazas downtown, apartments, shop rows and brick lofts further out, two parking lots, a park square with a fountain). City Debris runs from trash bags, parking meters and phone booths up to taxis, food trucks, fountains, buses, fire trucks and shipping containers; buildings stay Obstacles and fade when they hide the Bunny. Absorbing the Garbage Truck (arrives at Tier 9) opens the highway on-ramp at the east end of the main avenue.

**Region phase (Act 4, *A State of Emergency*).** The on-ramp fades into the region seen from a few kilometres up, under an overcast noon sky (2 × 1.5 km: motorways, a river with a bridge, patchwork farmland, woods, a city in four quarters and four towns, a landfill in the south-east, wooded hills at the edge). The Run re-bases into the Region's unit (1 world unit = 10 m), so the Bunny arrives at about 0.65–0.9 units and the House's Speck→Fluff curve repeats: Tier 10 at 1 unit, Tier 11 at 3. Region Debris runs from hay bales and dairy cows up to barns, churches, villages, stadiums, small towns and cooling towers; city cores, ridges and hills stay Obstacles. Absorbing the Incinerator (arrives at Tier 11) lifts the barrier across the motorway's west end, where the Bunny came in: the way west out to the Continent.

**Continent phase (Act 5, *Plate Tectonics, Before Lunch*).** Seen from the stratosphere at dusk: a low warm sun in the west casting long shadows, a blue-violet sky, and the ground fading into the fog colour where the planet's limb curves across the top of the view. The map (2,000 × 1,500 km) is a landmass ringed by sea, with beaches, surf and offshore islands: tundra and sea ice in the north (where the ice comes from), a desert with mesa country in the south-west, a cordillera down the middle with two passes, a south-east range and northern highlands, a lake district in the north-east, three rivers, and the ruins of cities joined by what is left of their highways. Floors carry hill-shaded relief and snow on the heights; zone edges fray into each other. 1 world unit = 10 km. The Bunny arrives at the east coast after the size leap (below) at 0.85 units, with snow-capped ranges poking out of its fur; Tier 12 starts at 1 unit and Tier 13 at 3. Continent Debris runs from forests, farmland, hills and ruined suburbs up through lakes, mesas, icebergs, canyons and ruined megacities to mountain ranges, great lakes, sand seas, ice caps, a breadbasket and a small country; the biggest mountain ranges stay Obstacles (the only things that stun the Ice Sheet). Absorbing the Ice Sheet (arrives at Tier 13) wins the Run until the Globe (Act 6) gives the Continent an exit. The Hazards are placeholders from the Act 5 groundwork until the Continent Hazards land (#25).

## Tech

- Vite + TypeScript (strict) + three.js. No game engine, no physics library: movement and collision are 2D circles/AABBs on the XZ floor plane.
- Deployed to Vercel as a static build (`dist/`) plus an optional serverless function in `api/` for the leaderboard (Neon Postgres via `DATABASE_URL`; the game falls back to a local leaderboard when the API is unavailable).
- Debris is rendered with `InstancedMesh` per Debris type; queries go through a spatial hash grid. Budget: 60 fps with ~5,000 Debris on a mid-range laptop.
- Unit tests with Vitest for pure logic (growth, Tier thresholds, absorb rules, RNG, Perk/Upgrade modifiers, save data).
- Audio is synthesized with WebAudio (no audio asset files required).
- Hero models (Hazards, furniture) may be authored in Blender and exported as `.glb` into `public/models/`; every model must have a procedural three.js fallback so the game runs without the asset.

## Core loop

1. Move (WASD / arrows / left stick / touch joystick; optional click-and-hold to steer toward cursor). Dash on Space/Shift.
2. Touch Debris with size ≤ radius × absorb ratio → it is absorbed, sticks to the Bunny surface, and adds volume: `r_new = cbrt(r³ + growthFactor × size³)`.
3. Larger things are Obstacles: the Bunny bumps off them.
4. Reaching a Tier threshold → Tier-up: camera pulls back, fog lifts further, blocked areas open, a Perk draft (pick 1 of 3) pauses the game.
5. Avoid Hazards. Contact deals damage (1 s invulnerability afterwards) and knocks the Bunny back. Some Hazards also shed mass.
6. Death ends the Run → results screen → Fluff awarded → Shop → new Run.

## Tiers

| # | Name       | Radius range (cm) | Typical Debris                                          | View |
|---|------------|-------------------|---------------------------------------------------------|------|
| 1 | Speck      | 1 – 3             | lint, crumbs, hair, sand, staples, sequins              | under the couch |
| 2 | Fluff      | 3 – 8             | paperclips, bobby pins, cereal, coins, buttons, LEGO    | living room |
| 3 | Tumbleweed | 8 – 20            | socks, pens, toy cars, keys, batteries, sponges         | living room + hallway |
| 4 | Dust Devil | 20 – 45           | shoes, books, remotes, slippers, cat toys, lint rollers | most of the house |
| 5 | Dust Titan | 45 – 75           | chairs, laundry baskets, Roombas, the boss; outside: gnomes, pumpkins, cones | whole house / front yard |
| 6 | Dust Storm | 75 – 160          | mailboxes, trash cans, bikes, grills, shrubs, benches   | the block |
| 7 | Dust Cyclone | 160 – 320       | picnic tables, golf carts, swing sets, cars, the Street Sweeper; in the city: trash bags, meters, phone booths, mopeds, hot dog carts | the neighborhood / a few city blocks |
| 8 | Dust Hurricane | 320 – 600     | taxis, police cars, vans, food trucks, city trees, statues, fountains | downtown |
| 9 | Dust Colossus | 600 – 1,000    | buses, fire trucks, cement mixers, trams, shipping containers, the Garbage Truck | the whole city |
| 10 | Dust Sprawl | 10 – 30 m       | hay bales, cars, tractors, silos, farmhouses, lorries, barns, churches | a few farms and a town |
| 11 | Dust Front  | 30 m – 10 km    | motels, wind turbines, strip malls, villages, stadiums, small towns, the Incinerator | the region |
| 12 | Dustmass    | 10 – 30 km      | forests, farmland, lakes, ruined cities, mesas, icebergs, canyons, ruined megacities, mountain ranges | a few hundred kilometres |
| 13 | Dust Pangaea | 30 km +        | volcanoes, metropolis ruins, great lakes, sand seas, a breadbasket, a small country, ice caps, mountain chains, the Ice Sheet | the continent |

Tier thresholds are the Bunny's real radius (cm); in the Region the world unit is 10 m, so Tiers 10 and 11 start at 1 and 3 units, and in the Continent it is 10 km, so Tiers 12 and 13 start at 1 and 3 units. Camera distance and fog distance scale with radius so the visible floor area grows each Tier. Areas are gated physically: e.g. the gap under the couch skirt and closed doors are passable/absorbable only at certain sizes.

## World

- A procedurally assembled house floor (seeded per Run): a set of room templates (living room, kitchen, hallway, bedroom, bathroom) arranged on a grid, with doorways. Furniture is placed per template with jitter; furniture is an Obstacle until the Bunny can absorb it (large pieces like the couch and beds stay permanent Obstacles and walls are never absorbable).
- Debris spawning is data-driven: each Debris type has size, mass multiplier, colour/model, room weights, and a min/max Tier band. Dense small Debris near the start, bigger Debris further out.
- A dynamic spawner tops up absorbable Debris around the Bunny (outside the camera view) so there is always something to eat at the current Tier, and culls Debris that is now far too small to matter.

## Hazards

| Hazard         | From Tier | Size (cm, radius) | Behaviour | Damage |
|----------------|-----------|-------------------|-----------|--------|
| Roomba         | 1         | 17                | wanders, bounces off walls, turns randomly; suction pull within a radius | 1 + knockback |
| Lint Roller    | 1         | 6 × 10 roll       | rolls back and forth along a lane | 1, sticks Bunny for 1 s, sheds mass |
| Broom          | 2         | sweep arc 40      | telegraphed sweeping arc at a fixed spot | 1 + big knockback |
| Spray Bottle   | 2         | 8                 | stationary turret, fires mist droplets at the Bunny | 1 per droplet |
| Mop            | 3         | 15                | follows a path, leaves a wet trail that slows | 1 on contact; trail slows |
| Upright Vacuum | 4         | 30                | slow, strong suction cone in front | 1, sheds mass |
| Robo-Vac 9000  | 5 (boss)  | 36                | hunts the Bunny, telegraphed charge attacks | 1, sheds mass |

**Outdoors (the neighborhood, after the Robo-Vac 9000):**

| Hazard         | From Tier | Size (cm, radius) | Absorbable at r | Behaviour | Damage |
|----------------|-----------|-------------------|-----------------|-----------|--------|
| Robotic Mower  | 5         | 55                | ≈ 79            | Roomba behaviour on a lawn scale, weak blade pull | 1 + knockback |
| Sprinkler      | 5         | 45                | ≈ 64            | turret: head sweeps, aims a lane, fires a burst of water | 1 per droplet, brief slow |
| Leaf Blower    | 5         | 45                | ≈ 64            | amber cone warm-up, then a blast that pushes the Bunny away and blows small Debris | 1 on contact |
| Lawn Mower     | 6         | 65                | ≈ 93            | unmanned push mower patrolling a lane | 1 + knockback, sheds mass |
| Street Sweeper | 7 (boss)  | 150               | ≈ 214 (≈ 155 after two chips) | hunts with suction, telegraphed charges, stunned by houses / trees, summons mini mowers | 1, sheds mass |

**The city (after the Street Sweeper, Bunny r ≈ 175–230 on arrival):**

| Hazard          | From Tier | Size (cm, radius) | Absorbable at r | Behaviour | Damage |
|-----------------|-----------|-------------------|-----------------|-----------|--------|
| Pressure Washer | 7         | 170               | ≈ 243           | turret: head turns, aims a lane, fires a burst of fast water jets | 1 per jet, brief slow |
| Floor Scrubber  | 7         | 190               | ≈ 271           | ride-on scrubber, Roomba behaviour, weak scrub-brush pull | 1 + knockback |
| Litter Vacuum   | 7         | 220               | ≈ 314           | amber cone warm-up, then a suction cone that pulls the Bunny in | 1, sheds mass |
| Street Flusher  | 8         | 300               | ≈ 429           | water truck patrolling a street, wide wet trail that slows | 1 + knockback; trail slows |
| Garbage Truck   | 9 (boss)  | 560               | ≈ 800 (≈ 578 after two chips) | hunts with compactor suction, telegraphed charges, stunned by buildings / the barrier, summons mini scrubbers | 1, sheds mass |

**The Region (after the Garbage Truck; 1 world unit = 10 m, Bunny r ≈ 0.65–0.9 units on arrival):**

| Hazard             | From Tier | Size (units, radius) | Absorbable at r | Behaviour | Damage |
|--------------------|-----------|----------------------|-----------------|-----------|--------|
| Landfill Compactor | 10        | 1.05                 | ≈ 1.5           | Roomba behaviour, packer-wheel pull | 1 + knockback |
| Crop Duster        | 10        | 1.25                 | ≈ 1.8           | turret: circles on the spot, aims a lane, dusts a burst of pesticide | 1 per droplet, 2 s slow |
| River Barge        | 10        | 1.5                  | ≈ 2.1           | patrols the river (placed in `river` zones), wide wake that slows | 1 + knockback; wake slows |
| Snowplow           | 10        | 1.7                  | ≈ 2.4           | lane patrol along a road, plows the Bunny aside | 1 + knockback, sheds mass |
| Water Bomber       | 11        | 2.3                  | ≈ 3.3           | amber cone warm-up, then a water drop that blasts the Bunny away and soaks it | 1 on contact; blast slows |
| Freight Train      | 11        | 2.45                 | ≈ 3.5           | long, fast lane patrol | 1 + knockback, sheds mass |
| The Incinerator    | 11 (boss) | 2.8                  | ≈ 4 (≈ 2.9 after two chips) | hunts with feed-conveyor suction, telegraphed charges, chimney ash volleys, stunned by towns / the map edge, summons mini compactors | 1, sheds mass (ash too) |

**The Continent (after the Incinerator; 1 world unit = 10 km, Bunny r = 0.85 units on arrival).** Hazards are weather. Sizes keep the Region ladder's ratios to the Bunny (the Continent repeats the Region's shape: Tiers at 1 and 3 units, boss absorbable at ≈ 4).

| Hazard          | From Tier | Size (units, radius) | Absorbable at r | Behaviour | Damage |
|-----------------|-----------|----------------------|-----------------|-----------|--------|
| Tornado         | 12        | 1.1                  | ≈ 1.57          | Roomba behaviour: erratic wander (2.2 / 4.4 units/s), wide vortex pull (reach 1.4, 0.3 × max speed), spinning funnel | 1 + knockback |
| Volcano         | 12        | 1.3                  | ≈ 1.86          | static turret: the crater aims (range 9 / 13), lane telegraph (1.1 / 0.9 s), then 3 lobbed lava bombs; ash slows (1.2 s, × 0.7) | 1 per bomb, brief slow |
| River Surge     | 12        | 1.5                  | ≈ 2.14          | fast flood surge (2.2 / 3.4 units/s) patrolling waypoints, wide muddy trail that slows (× 0.5) | 1 + knockback; trail slows |
| Glacier Tongue  | 12        | 1.9                  | ≈ 2.71          | slow, heavy lane patrol (1.4 / 2.4 units/s, lanes 8–30), placed in tundra and mountain zones | 1 + big shove, sheds 8 % |
| Hurricane       | 13        | 2.4                  | ≈ 3.43          | spinning bands; amber warm-up (1.1 s), then a wind cone (range 14) that blasts the Bunny away and soaks it | 1 on contact; blast slows |
| The Ice Sheet   | 13 (boss) | 2.8                  | ≈ 4 (≈ 2.9 after two chips) | slow, enormous, bulldozes the Bunny and Debris ahead, telegraphed surges, stunned only by mountain ranges, calves icebergs | 1, sheds 5 % |

(Per-Tier pairs are Tier 12 / Tier 13.)

| The Ice Sheet (`ICE_SHEET`) | Value | Incinerator, for scale |
|---|---|---|
| Size / contact radius | 2.8 / 3 units (model 5.8 × 3.9 units) | 2.8 / 2.95 |
| Hunt speed / turn rate | 3.2 units/s / 0.7 rad/s | 6 / 1.4 |
| Charge: trigger / telegraph / speed / distance | 30 / 1.8 s / 13 units/s / 36 | 35 / 1.4 / 24 / 45 |
| Stun / recover | 3.5 s / 1.4 s, only from a charge into a mountain range (Abilities and Spiky Dash still stun it) | 3 / 1, towns and the map edge |
| Bulldoze | Bunny within 2.4 units of the front cliff pushed at 0.6 × its max speed; Debris ≤ 1.6 units shoved ahead | suction 0.35 |
| Calving | an iceberg every 9 s of hunting (alternate front corners, 5 s to regrow), both corners on a mountain crash; iceberg = 0.55 × Bunny radius (0.6–2 units, mass 2.4) | summons mini compactors |
| Chips | × 0.85, 8 iceberg pieces | × 0.85, 8 parts |

Mountain ranges for the map: a furniture Obstacle whose def id starts with `mountain`, or furniture standing in a `mountains` zone (the placeholder massifs).

A Hazard whose size ≤ radius × absorb ratio becomes Debris: touching it absorbs it for a big mass gain. Absorbing the Robo-Vac 9000 opens the front door to the neighborhood, the Street Sweeper opens the road to the city, the Garbage Truck the highway on-ramp to the region, the Incinerator the motorway west to the continent, and absorbing the Ice Sheet wins the Run.

## Pacing and scale (Acts 4–9)

Decided with the Region (issue #24; story in `docs/story.md`):

1. **Two Tiers and one boss per Act** after the City, with `AREAS[area].growth` tuned so each Act takes 4 to 6 minutes. Adjust later if it plays off.
2. **Full Runs only.** No chapter checkpoints for now; starting at a later Area is a separate, later feature (`?area=` exists for debugging and is unranked).
3. **No Fluff radius cap and no flat per-Area bonus.** Each Act scales its own progression (Fluff, Area score and the server's per-Area bounds) from growth measured in that Act's unit, with plain floating-point maths. Readouts climb the unit ladder (cm, m, km, Earths, AU, ly; `src/data/units.ts`).

**Units.** Each Area declares `AREAS[area].unit` (cm per world unit): 1 for the House, Neighborhood and City, 1,000 for the Region, 1,000,000 for the Continent. Entering an Area re-bases the Bunny (`Bunny.rebase`: radius, max radius, speeds; stuck Debris rescales in the view) so its real size is unchanged; all of the Area's content is authored in its unit.

**The size leap (decided with Act 5).** The Region ends with the Bunny at roughly 30–45 m (the Incinerator falls at ≈ 4 units), but the Continent's unit is 10 km and the story has it arrive at about 1 unit. A real-size re-base would arrive at ≈ 0.004 units, which is unplayable (a speck on a continent map, and nothing on it small enough to eat). So an Area may declare an **arrival radius** (`AREAS[area].arrivalRadius`, in its unit; the Continent's is 0.85). `run.enterArea` re-bases first, then, if the Bunny is smaller, `Bunny.leapTo` scales it up to that radius (radius, interpolated radius and max radius; `bunnyLeapt`, not `bunnyGrew`). 8.5 km is below Tier 12's 10 km, so the leap triggers no Tier-up and no Perk draft; the chapter card covers the off-screen growth, and the Region's Tier 12 goal is hidden on its HUD (`pastNextArrival`). The leap is not growth earned in either Area:

- **Area stats, Fluff and the Continent Area board** count from the radius after the leap (`AreaStats.radiusIn` = 0.85); the Region's stats close before it. The Continent board's entry bound is the arrival radius (`SCORE_ARRIVAL_RADIUS`).
- **Run board:** `progressRadius` gets a zero band from 50 m (about the most a Region Bunny reaches) to the arrival radius (8.5 km), then counts 100 per Continent unit (1e-4 per cm), like the Region's 100 per 10 m unit. Arriving scores like a 50 m Region Bunny; only Continent growth adds. The server's growth-for-time check reads the same scale, so a real Run through the leap passes (the leap adds at most the Region band up to 50 m). Its rate went from 2 to 2.5 per second: with the Continent's growth on top, a max-Loadout Zap win reached 104% of the old allowance.

| Region tuning (`AREAS.region`) | Value |
|---|---|
| Unit | 10 m (1,000 cm) |
| Debris Tier band | 10–11 |
| Growth multiplier | 0.12 |
| Start scatter / cluster / cluster radius | 2,000 / 120 / 11 units |
| Fluff per unit of growth | 1.5 |
| HUD readout | from m (`14.7 / 30 m`) |
| Area board | 10,000 points per unit grown, par 360 s, growth bound 0.05 units/s + 0.1 |
| Run board | `progressRadius`: a cm counts 1 up to 10 m, then 0.1 (100 per Region unit) up to 50 m |

**Region pacing check** (`pnpm sim --seeds=8 --minutes=45 --validate`, Casual, full Runs): Act time from entering the Region to absorbing the Incinerator, median per Character, next to the City's.

| Character | Region | City | Wins / Runs | Median win |
|---|---|---|---|---|
| Lint | 4:26 | 4:24 | 3 / 8 | 30:24 |
| Tumble | 7:43 | 9:11 | 3 / 8 | 37:30 |
| Zap | 3:09 | 3:58 | 6 / 8 | 20:27 |

Every Run that reached the Incinerator beat it, and all 74 leaderboard submissions validated (closest: 73% of the Run board allowance, 54% of the Region board's, both Zap). `pnpm sim --area=region` (starting at 0.9 units) gives Lint 5:03, Tumble 6:10, Zap 3:14. (Measured before the Region had an exit, when the Incinerator won the Run.)

| Continent tuning (`AREAS.continent`) | Value |
|---|---|
| Unit | 10 km (1,000,000 cm) |
| Arrival radius | 0.85 units (8.5 km), the size leap |
| Debris Tier band | 12–13 |
| Growth multiplier | 0.17 (set with the Continent map and Debris; final tune after the Continent Hazards land) |
| Start scatter / cluster / cluster radius | 2,000 / 120 / 11 units |
| Fluff per unit of growth | 1.5 |
| HUD readout | from km (`8.50 / 10 km`, then `/ 30 km`) |
| Area board | 10,000 points per unit grown from 0.85, par 360 s, growth bound 0.08 units/s + 0.1 (looser than the Region's until the content is tuned) |
| Run board | zero band from 50 m to 8.5 km, then 1e-4 per cm (100 per Continent unit) |

**Continent pacing check** (Continent map and Debris, placeholder Hazards, growth 0.17; `pnpm sim --area=continent --seeds=8`, Casual, starting at the Incinerator-beaten size and leaping to 0.85 units): median Tier 12 / Tier 13 / Act time (arrival to absorbing the Ice Sheet) per Character: Lint 1:20 / 5:09 / 5:28 (8/8 wins), Tumble 1:42 / 7:29 / 7:51 (8/8), Zap 1:07 / 3:54 / 4:19 (8/8). The numbers below are from the placeholder content (growth 0.14), which gave Lint 5:04 (7/8 wins), Tumble 8:08 (8/8), Zap 4:15 (8/8). In full Runs (`pnpm sim --seeds=8 --minutes=55 --validate`), where the Bunny arrives with a whole Run's Perks: Lint 4:20, Tumble 6:18, Zap 2:37; wins 2, 3 and 6 of 8 (median win 38:42, 44:18, 23:24), and all 86 leaderboard submissions validated (closest: 73% of the Run board allowance, 41% of the Continent board's). Tumble starves more on the thinner placeholder Debris ladder; the final tune follows the Continent content. Starting one Area earlier (`--area=region --seeds=4`, so the Continent is entered through the leap with the Region's Perks): Region / Continent Lint 3:44 / 4:16, Tumble 5:49 / 7:01, Zap 2:44 / 4:17. With `--loadout=max` (grade 6) over 10 full Runs, Zap wins 9 and clears the Continent in a median 2:34, Lint 4 and 3:03; all 88 leaderboard submissions validated (closest: 83% of the Run board allowance, 68% of the Continent board's).

**With the Continent Hazards and the Ice Sheet** (#25; still the placeholder map and Debris, growth 0.14): `pnpm sim --area=continent --seeds=8` gives Act medians Lint 5:32, Tumble 7:37, Zap 3:37, 24 / 24 wins and no deaths (the Volcano is the only Hazard that landed hits: 13 over 24 Runs); every Ice Sheet fight was won, most by outgrowing it within 10–30 s of its arrival, a few after one chip. Full Runs (`pnpm sim --seeds=8 --minutes=55 --validate`): every Run that reached the Continent beat the Ice Sheet (Lint 3 / 3, Tumble 3 / 3, Zap 6 / 6), Continent medians Lint 4:04, Tumble 5:31, Zap 2:38, and all 87 leaderboard submissions validated (closest: 70% of the Run board allowance, 37% of the Continent board's).

## Characters

| Character | Fantasy           | Speed | Health | Start radius | Dash CD | Strength | Weakness |
|-----------|-------------------|-------|--------|--------------|---------|----------|----------|
| Lint      | dryer lint, balanced | 1.0 | 3     | 1.0          | 3 s     | no weak spots | no special strength |
| Tumble    | pet-hair tumbleweed  | 0.8 | 5     | 1.2          | 4 s     | tough, knockback resistant | slow, sluggish turning |
| Zap       | static fluff         | 1.3 | 2     | 0.9          | 2 s     | fast, built-in magnet pull | fragile, suction pulls it 1.5× harder |

Each Character has a distinct colour and fur look.

## Difficulty

Picked on Character select (↑/↓ or the Difficulty switch), remembered in the save; `?difficulty=casual|arcade|hardcore` overrides it. Tuning lives in `src/data/difficulty.ts`.

| Difficulty | Hazard speed | Alive budget | Spawn interval | Grace period | Telegraphs, cooldowns, summons | Hearts | Pickups | Heal on new area | Fluff | Score |
|------------|--------------|--------------|----------------|--------------|--------------------------------|--------|---------|------------------|-------|-------|
| Casual (default) | ×1   | ×1    | ×1   | ×1    | ×1    | —  | ×1   | 1 | ×1    | ×1    |
| Arcade           | ×1.2 | ×1.25 | ×0.8 | ×0.6  | ×0.85 | —  | ×1   | 1 | ×2    | ×1.25 |
| Hardcore         | ×1.4 | ×1.6  | ×0.6 | ×0.35 | ×0.7  | −1 (min 1) | ×0.7 | 0 | ×5   | ×1.6 |

Hazard speed covers every movement: patrols, boss hunts and charges, Broom sweeps and spray droplets. Casual is the original balance.

## Upgrades

**Pickups (temporary, timed, glowing on the floor):** Static Charge (magnet pull, 10 s), Sugar Rush (+50 % speed, 8 s), Bubble Wrap (blocks one hit; stacks up to 3 charges), Glue Dab (×2 growth, 10 s), Crumb Cake (heal 1), Dust Cloud (Hazards ignore you, 6 s).

**Perks (per Run, draft 1 of 3 at each Tier-up):** Thick Fur (+1 max health and heal), Aerodynamic (+10 % speed), Sticky Fibers (+0.05 absorb ratio), Static Field (small permanent magnet), Second Wind (revive once), Quick Dash (−30 % dash cooldown), Hoarder (+40 % Pickup duration), Slippery (25 % chance to dodge damage), Glutton (+15 % growth), Lucky Find (more Pickups), Regrowth (heal 1 every 45 s), Spiky Dash (dashing into a Hazard stuns it instead of hurting you). Perks may stack unless marked unique.

**Upgrades (permanent, bought with Fluff in the Shop, saved in localStorage):** Extra Heart (+1 starting health, 2 levels), Fast Feet (+5 % speed, 3 levels), Head Start (+10 % starting radius, 3 levels), Wide Choice (4 Perk options instead of 3, 1 level), Magnetism (base magnet radius, 2 levels), Reroll (one Perk reroll per Run, 1 level), Pickup Luck (+Pickup spawn rate, 2 levels).

Fluff earned per Run ≈ `floor(tierReached × 4 + radius term + debrisAbsorbed / 1000)`, ×1.55 on victory (×1.5 if the region was cleared, ×1.45 if the city was, ×1.35 if the neighborhood was, ×1.25 if only the house was), then × the Difficulty's Fluff multiplier (Arcade ×2, Hardcore ×5). The radius term has no cap: each Area adds its growth measured in its own unit × `AREAS[area].fluffPerUnit` (House 1/30 per cm, Neighborhood 1/60, City 1/120, Region 1.5 per 10 m unit, Continent 1.5 per 10 km unit counted from the radius after the leap; about 2 + 3 + 5 + 5 + 5 for a full Run). Targets: a Casual Run that clears the house pays about 40 Fluff, a Casual win about 115 since the Continent (the sim's full Runs: 114–119), Arcade about twice that and Hardcore about 575. Buying every Upgrade (about 1,545 Fluff) takes about 14 Casual wins or 3 Hardcore wins.

## Keepsakes and Felting

Each boss leaves a **Keepsake** in the fur of the Character that absorbed it. Keepsakes modify that Character's Ability (5 types per Character) and have a **grade** set by the boss: 1 Brush Tangle (Robo-Vac 9000), 2 Gutter Grit (Street Sweeper), 3 Hopper Gunk (Garbage Truck), 4 Cinder Ash (Incinerator), 5 Glacier Silt (Ice Sheet), up to 10 First Dust (Felting only). Data and effect values: `src/data/keepsakes.ts`.

- **Drops:** every boss kill credits 1 Keepsake of the boss's grade with a random type (seeded from the Run seed); Hardcore adds 1. On a Character's first kill of a boss the player chooses 1 of 3 offered types on the results screen instead (the first offer is credited at once; leaving results without choosing keeps it). Keepsakes are credited on the kill, so a Run that then ends in death or a quit keeps them. Runs with `?debug` or started past the house drop nothing. Chipping doesn't change the reward.
- **Loadout:** on Character select two slots take Keepsakes from that Character's **Hoard** (both may hold the same type; copies add up). It is fixed for the Run, remembered per Character on the device, and sent with leaderboard entries.
- **Felting** (Under the Couch): 3 of the same type and grade make 1 of the next grade for 40 × g² Fluff (g = the new grade), and only up to one grade above the best boss that Character has beaten. **Shedding** discards one for 10 × g² Fluff. Neither counts as Fluff earned.
- A narrator caption plays when a Keepsake drops and on the first Felting (Settings → Story captions).

### Keepsake effects

Values run from grade 1 to grade 10 along `v1 + (v10 − v1) × ((g − 1) / 9)^0.7`; grade 4 (the best felt-able today) sits at 46% of the range. Two copies of a type add together. Ranges are in Bunny radii (r).

| Character | Type | g1 → g10 | g4 | How it plays |
|---|---|---|---|---|
| Lint | Long Strand | Decoy +1 → +5 s | +2.9 s | Decoy stays out longer (base 4 s). |
| Lint | Quick Shed | cooldown −10% → −45% | −26% | Of the base 16 s. |
| Lint | Thick Clog | clog stun +0.4 → +2.0 s | +1.1 s | Bosses get half (+0.6 s at g4). |
| Lint | Dinner Bell | wanderers 4 → 12 r; lure range +0% → +60% | 7.7 r; +28% | Roomba-type Hazards (Roombas, Robotic Mowers, Floor Scrubbers and the boss minis) within range steer towards the Decoy; every aiming Hazard is lured from its range × (1 + bonus). |
| Lint | Reclaim | fibre worth 1% → 4% of volume | 2.4% | When the Decoy expires, clogs or is shot, lint fibre lands around it; absorbing all of it gives that volume back. |
| Tumble | Loose Roots | −0.1 → −0.6 s cooldown per second held | −0.33 s | Base 1 s per second held. |
| Tumble | Bristle Back | knockback 2 → 5 r, stun 0.5 → 2.0 s | 3.4 r, 1.2 s | Non-boss Hazards that touch a planted Tumble. The Broom, Lint Roller, Lawn Mower and ranged Hazards are stunned but not moved. |
| Tumble | Snowball | magnet +0.5 → +2.5 while planted | +1.4 | Added after the cap. |
| Tumble | Dead Weight | +0.3 → +1.5 s, +2 → +6 parts | +0.9 s, +4 parts | A boss chipped during a Hunker stun stays stunned that much longer after the chip, and more parts fall off. |
| Tumble | Thick Undercoat | knockback resistance +0.02 → +0.20, suction −3% → −20% | +0.10, −11% | Always on, below the cap. |
| Zap | Live Wire | meter fills +10% → +50% faster | +29% | |
| Zap | Long Reach | range +1 → +4 r | +2.4 r | Base 4 r. |
| Zap | Arc | +1 (g1–4), +2 (g5–8), +3 (g9–10) Hazards | +1 | Non-boss Hazards within 4 r of the first target. |
| Zap | Static Cling | magnet +0.1 → +0.6 while the meter is ≥ 50% | +0.33 | Below the cap. |
| Zap | Grounding | suction −2.5% → −10% while the meter is full | −6% | Below the cap. |

**Floors** (`KEEPSAKE_FLOORS`), so two copies at any grade leave the Ability playable:
- The Decoy cooldown is never shorter than the Decoy's duration. Two Quick Sheds pass it from grade 8 (16 s × 0.21 = 3.4 s becomes 4 s); a Quick Shed beside a Long Strand only when both are grade 10.
- Hunker costs at least 0.2 s of cooldown per second held. Two Loose Roots pass it from grade 6.

The stat effects (Thick Undercoat, Static Cling, Grounding) are bounded by the caps instead; every other effect stays reasonable at two grade-10 copies, so it has no floor.

**Balance check** (`pnpm sim --seeds=60 --minutes=25`, Casual, October 2026). `--loadout=max` is the pair with the most wins over 30 seeds among all 15 grade-4 pairs per Character: Lint Quick Shed + Reclaim, Tumble Snowball ×2, Zap Static Cling + Grounding.

| Character | No Ability: wins / deaths | Ability: wins / deaths, median win, T4 | Max Loadout: wins / deaths, median win, T4 |
|---|---|---|---|
| Lint | 15 / 38 | 27 / 28, 19:51, 5:11 | 26 / 29, 20:34, 5:12 |
| Tumble | 6 / 39 | 7 / 38, 23:18, 6:03 | 13 / 38, 22:03, 6:05 |
| Zap | 28 / 27 | 43 / 16, 15:01, 3:55 | 48 / 12, 14:02, 3:37 |

- A grade-4 Loadout adds at most 10 points of win rate (Tumble) and wins at most 7% faster (Zap), inside the limits of +25 points and 15%.
- Every Run board and Area board submission of these Runs passes validation. The closest any came to the growth limit was 66% of the allowance (a Zap City clear).
- Zap still has the fastest Tier 4. Tumble does **not** have the fewest deaths: the bot dies to Upright Vacuums and Spray Bottles at Tiers 3–4, and Tumble is too slow to leave a vacuum cone. This was already true before Keepsakes and Abilities (no Ability: Lint 38, Tumble 39, Zap 27 deaths).
- Every Loadout with Thick Undercoat cost the bot deaths (17–21 against 15 per 30 seeds). The likely cause is that with less knockback the bot stays in contact with Hazards longer. Worth watching in real play.

## Screens

Title → Character select (Difficulty, Ability card and Loadout) → Run (HUD) → Perk draft (modal on Tier-up) → Pause → Results (death or victory: time, max radius, Debris absorbed, Tier, Fluff earned, Keepsakes kept, leaderboard name entry) → Shop / Under the Couch → back to Character select. Plus Settings (master/music/SFX volume, quality, reduced motion, story captions) and a How-to-Play panel.

HUD: hearts, radius readout, progress bar to next Tier with Tier name, Dash cooldown, active Pickup icons with timers, Perk icons, small Tier-up/absorb toasts ("+ Sock!").

## Art direction

Cozy, warm, toy-like low poly with soft shadows. Wooden plank floor (procedural canvas texture), rugs, tiles in kitchen/bathroom, baseboards on walls. The Bunny is a grey fuzzy ball (shell-texture fur or noisy displaced sphere) with two cute eyes; absorbed Debris visibly sticks to its surface (cap the count rendered for performance). Hazards read clearly as dangerous: warning colours, telegraph indicators on the floor before attacks.
