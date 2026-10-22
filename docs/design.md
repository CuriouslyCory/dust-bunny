# Dust Bunny — Game Design

Terms follow `CONTEXT.md`. Numbers below are starting points; tune them in the data files, not in logic.

## Pitch

Katamari-style growth roguelike on a house floor, rendered in three.js. You start as a 1 cm Speck under the couch, absorbing lint and staples. Every Tier you grow into pulls the camera back, reveals more of the house, and turns former Obstacles into Debris. Roombas, lint rollers, brooms, and other cleaning gear roam the floor and hurt you, until you are big enough to absorb them too. Final goal: absorb the Robo-Vac 9000 boss.

Target: a 10–15 minute demo-quality house, a 5–8 minute neighborhood, a 7–10 minute city, then 4–6 minutes each for the region and the continent, playable on desktop (keyboard/mouse) and mobile (touch).

**Neighborhood phase.** Absorbing the Robo-Vac 9000 no longer ends the Run: the front door at the end of the hallway swings open and a door compass points to it, with a skip button (Enter on a keyboard) that moves on from wherever the Bunny is, so a Bunny too big to reach the door is never stuck. Rolling out of it fades into a seeded suburban street (about 96 × 72 m: a main street and a cross street, seven houses with yards and driveways, a park). Outdoor Debris runs from pinecones and garden gnomes up to bikes, picnic tables and parked cars; houses and big trees stay Obstacles. Absorbing the Street Sweeper (arrives at Tier 7) lifts the road barrier at one end of the main street.

**City phase.** Rolling through the barrier fades into a seeded city at golden hour (about 320 × 240 m: three avenues and four streets with sidewalks and crosswalks, office towers and plazas downtown, apartments, shop rows and brick lofts further out, two parking lots, a park square with a fountain). City Debris runs from trash bags, parking meters and phone booths up to taxis, food trucks, fountains, buses, fire trucks and shipping containers; buildings stay Obstacles and fade when they hide the Bunny. Absorbing the Garbage Truck (arrives at Tier 9) opens the highway on-ramp at the east end of the main avenue.

**Region phase (Act 4, *A State of Emergency*).** The on-ramp fades into the region seen from a few kilometres up, under an overcast noon sky (2 × 1.5 km: motorways, a river with a bridge, patchwork farmland, woods, a city in four quarters and four towns, a landfill in the south-east, wooded hills at the edge). The Run re-bases into the Region's unit (1 world unit = 10 m), so the Bunny arrives at about 0.65–0.9 units and the House's Speck→Fluff curve repeats: Tier 10 at 1 unit, Tier 11 at 3. Region Debris runs from hay bales and dairy cows up to barns, churches, villages, stadiums, small towns and cooling towers; city cores, ridges and hills stay Obstacles. Absorbing the Incinerator (arrives at Tier 11) lifts the barrier across the motorway's west end, where the Bunny came in: the way west out to the Continent.

**Continent phase (Act 5, *Plate Tectonics, Before Lunch*).** Seen from the stratosphere at dusk: a low warm sun in the west casting long shadows, a blue-violet sky, and the ground fading into the fog colour where the planet's limb curves across the top of the view. The map (2,000 × 1,500 km) is a landmass ringed by sea, with beaches, surf and offshore islands: tundra and sea ice in the north (where the ice comes from), a desert with mesa country in the south-west, a cordillera down the middle with two passes, a south-east range and northern highlands, a lake district in the north-east, three rivers, and the ruins of cities joined by what is left of their highways. Floors carry hill-shaded relief and snow on the heights; zone edges fray into each other. 1 world unit = 10 km. The Bunny arrives at the east coast after the size leap (below) at 0.85 units, with snow-capped ranges poking out of its fur; Tier 12 starts at 1 unit and Tier 13 at 3. Continent Debris runs from forests, farmland, hills and ruined suburbs up through lakes, mesas, icebergs, canyons and ruined megacities to mountain ranges, great lakes, sand seas, ice caps, a breadbasket and a small country; the biggest mountain ranges stay Obstacles (the only things that stun the Ice Sheet). Absorbing the Ice Sheet (arrives at Tier 13) opens the launch corridor on the north coast: a launch pad whose beam of light climbs up to orbit and the Globe. The Hazards are placeholders from the Act 5 groundwork until the Continent Hazards land (#25).

**Globe phase (Act 6, *The Marble*).** The Earth seen from orbit: black space with a starfield above the planet's limb, a thin glowing band of atmosphere where the planet curves away, a hard white sun from the east (its glare in the top right corner, glinting off the oceans) and blue Earth-shine from below. The map (480,000 × 240,000 km, a stylised Earth at ten times real size) wraps east–west: roll off one edge and arrive on the other. Hand-drawn continents nudged per seed, shelf seas, inland seas, island chains (the Caribbean, the Malay Archipelago, Hawaii, Polynesia, Melanesia), Greenland, the Arctic sea ice and Antarctica along the poles, biomes by latitude (rainforest, savanna, desert belts, temperate green, boreal forest, tundra) and snow-capped ranges (the Rockies, the Andes, the Alps, the Himalaya, the Urals, the Atlas), with clouds drifting above. The date line is open ocean, so the seam never cuts through land. 1 world unit = 1,000 km. The Bunny arrives over the Gulf of Guinea after a second size leap, at 0.85 units (0.13 Earths), wearing a faint atmosphere; from Dust Moon (Tier 14, 1 unit) the Moon sits half-buried in its fur, and Tier 15 (Dust Planet) starts at 3. Globe Debris runs from satellites, spent rocket stages, space junk and weather systems through reefs, atolls, islands and great deserts to archipelagos, cordilleras, inland seas, the Moon, landmasses, ocean basins, a continent and an ocean. The Moon is an Obstacle until r ≈ 2.5 and the only thing that stuns the Orbital Sweeper.

**Solar System phase (Act 7, *A Very Large Leaf Blower*).** The ecliptic from above: black space with a starfield and the Milky Way crossing the backdrop as a dust-lane band, faint orbit rings as lanes (Earth's empty and dashed), the Sun at the centre with its corona and glare, and the light coming from the Sun, so planets are lit on their sunward side and shadows fall away from it. The map (360 × 360 units, 3.6 × 3.6 AU, not to scale) is rings round the Sun: the corona, the inner orbits (Mercury, Venus, Earth's empty orbit, Mars), a cluttered asteroid belt (rocks, gravel, two Kirkwood gaps, Trojans at Jupiter's L4 / L5), the outer orbits (Jupiter, Saturn, Uranus, Neptune) and the Kuiper belt thinning into interstellar dark at the edge. 1 world unit = 0.01 AU. The Bunny arrives on Earth's orbit after the third size leap, at 0.85 units, glowing from within (plasma), and meets Voyager 1 on its first screen; Tier 16 (Dust Giant) starts at 1 unit (Mars is food just before it) and Tier 17 (Dust Star) at 3, when Jupiter stops being an Obstacle. When the Sun is absorbed the light goes out: everything fades to black but the Bunny's own glow.

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
| 14 | Dust Moon   | 1,000 – 3,000 km | satellites, rocket stages, space junk, weather systems, ice floes, reefs, atolls, islands, great deserts, patches of ocean, ice shelves, the Great Barrier Reef, archipelagos, cordilleras, inland seas | a few thousand kilometres of planet |
| 15 | Dust Planet | 3,000 km +      | the Moon, polar ice caps, landmasses, subcontinents, ocean basins, a continent, an ocean, the Orbital Sweeper | a hemisphere |

Tier thresholds are the Bunny's real radius (cm); in the Region the world unit is 10 m, so Tiers 10 and 11 start at 1 and 3 units, in the Continent it is 10 km, so Tiers 12 and 13 start at 1 and 3 units, and on the Globe it is 1,000 km, so Tiers 14 and 15 start at 1 and 3 units. Camera distance and fog distance scale with radius so the visible floor area grows each Tier. Areas are gated physically: e.g. the gap under the couch skirt and closed doors are passable/absorbable only at certain sizes.

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

**The Globe (after the Ice Sheet; 1 world unit = 1,000 km, Bunny r = 0.85 units on arrival).** Hazards are what is left in orbit, or falling out of it. The Globe repeats the Continent's shape (Tiers at 1 and 3 units, boss absorbable at ≈ 4), so each Hazard keeps the size and speed ratios of the Continent Hazard whose behaviour it reskins. The map wraps east–west; every Hazard works across the seam.

| Hazard                 | From Tier | Size (units, radius) | Absorbable at r | Behaviour | Damage |
|------------------------|-----------|----------------------|-----------------|-----------|--------|
| Debris-Field Satellite | 14        | 1.1                  | ≈ 1.57          | Roomba behaviour: tumbling wander (2.4 / 4.2 units/s, turns every 1–2.6 s), debris-field pull (reach 1.2, 0.26 × max speed), spinning panels | 1 + knockback |
| Anti-Satellite Laser   | 14        | 1.3                  | ≈ 1.86          | static turret on landmasses: the head aims (range 10 / 14) and scans out of range, red lane (1.25 / 1.05 s), then 3 fast laser bolts (15 / 20 units/s) | 1 per bolt |
| Re-entry Burn          | 14        | 1.5                  | ≈ 2.14          | capsule streaking between waypoints within 24 units of its spawn, across zones (2.6 / 3.8 units/s); its fire trail (6 s) burns instead of slowing | 1 + knockback; trail sheds 2.5 % every 0.7 s |
| Space Station          | 14        | 1.9                  | ≈ 2.71          | lane patrol along the nearest orbit lane (within 20 units, else a lane through its spawn), east–west, 2.4 / 3.8 units/s, lanes 10–40 | 1 + big shove, sheds 8 % |
| Hurricane              | 15        | 2.4                  | ≈ 3.43          | over oceans and shelf seas; spinning spiral, amber warm-up (1.1 s), then a wind cone (range 14) that blasts the Bunny away and soaks it | 1 on contact; blast slows |
| Mini sweeper           | boss      | 0.6                  | ≈ 0.86          | the Kessler swarm: fast Roomba behaviour (5.5 / 7 units/s), weak intake pull | 1 + knockback |
| The Orbital Sweeper    | 15 (boss) | 2.8                  | ≈ 4 (≈ 2.9 after two chips) | net pull at the front, telegraphed charges, twin laser volleys, stunned only by the Moon, summons the Kessler swarm | 1, sheds 4 % (lasers 3 %) |

(Per-Tier pairs are Tier 14 / Tier 15.)

| The Orbital Sweeper (`ORBITAL_SWEEPER`) | Value | Incinerator, for scale |
|---|---|---|
| Size / contact radius | 2.8 / 2.1 units (model 5.5 × 4.3 units, mostly wings and net) | 2.8 / 2.95 |
| Hunt speed / turn rate | 5 units/s / 1.3 rad/s | 6 / 1.4 |
| Charge: trigger / telegraph / speed / distance | 32 / 1.5 s / 22 units/s / 40 | 35 / 1.4 / 24 / 45 |
| Stun / recover | 3.5 s / 1.2 s, only from a charge into a Moon the Bunny can't absorb yet (the poles just end it; Abilities and Spiky Dash still stun it) | 3 / 1, towns and the map edge |
| Net | Bunny within 0.8 rad of its facing and 3.5 units (× 1.1 model scale) of the net tip, 2.5 units ahead, pulled at 0.35 × its max speed | suction 0.35, all round |
| Lasers | every 6 s hunting or recovering on screen: red lane for 1 s, then 4 bolts (26 units/s, range 30) from the lenses | ash: 5.5 s, 0.9 s, 5 pellets at 17 |
| Kessler swarm | 3 mini sweepers every 13 s of hunting, up to 6 alive | 2 mini compactors / 14 s, up to 4 |
| The Moon | on arrival and every 8 s of hunting, if no Moon the Bunny can't absorb is within 26 units of it, one lands 3 units beyond its edge (between it and the Sweeper the first time), sized max(the `moon` type's size, 1.25 × the largest the Bunny can absorb) | — |
| Chips | × 0.85, 8 parts | × 0.85, 8 parts |

The Moon is the only stun source because the Globe has no obstacles. A real-size Moon (1.74 units) is food from r ≈ 2.5, before the boss arrives at Tier 15, so the Sweeper brings its own: big enough to block the Bunny (which can still shove it), so standing behind it baits a charge into it. Sim check with the Bunny started at Tier 15 (`pnpm sim --area=globe --radius=3.05`): 12 / 12 wins (4 Moon stuns, the rest Ability stuns and growth); without Abilities 11 / 12 wins, 7 Moon stuns.

**The Solar System (after the Orbital Sweeper; 1 world unit = 0.01 AU, Bunny r = 0.85 units on arrival).** Hazards are rocks, ice and the Sun's own weather. The Solar System repeats the Globe's shape (Tiers at 1 and 3 units, boss absorbable at ≈ 4), so each Hazard keeps the size and speed of the Globe Hazard whose behaviour it reskins. The map has no obstacles.

| Hazard         | From Tier | Size (units, radius) | Absorbable at r | Behaviour | Damage |
|----------------|-----------|----------------------|-----------------|-----------|--------|
| Rogue Asteroid | 16        | 1.1                  | ≈ 1.57          | Roomba behaviour: tumbling wander (2.4 / 4.2 units/s, turns every 1–2.6 s), gravity pull (reach 1.5, 0.3 × max speed), spinning rock | 1 + knockback |
| Sunspot        | 16        | 1.3                  | ≈ 1.86          | static turret sunward of the Kuiper belt: the flux-tube head sweeps like a pulsar beam out of range (0.9 rad/s), aims (range 10 / 14), lane (1.2 / 1 s), then 3 flare bolts 0.16 s apart (13 / 18 units/s), reload 3.8 / 3 s | 1 per bolt |
| Sungrazer      | 16        | 1.5                  | ≈ 2.14          | comet streaking between waypoints within 24 units of its spawn, across zones (2.8 / 4 units/s); its icy tail trail (7 s, wide) slows to 0.55 × | 1 + knockback |
| Comet          | 16        | 1.6                  | ≈ 2.29          | rides the orbit ring nearest its spawn (within 20 units) one way round, no ends (3.2 / 4.6 units/s), a short lane sliding ahead of it, its tail streaming 7.5 units behind | 1 + big shove, sheds 8 % |
| Solar Flare    | 17        | 2.4                  | ≈ 3.43          | plasma arch: its loop swells through the amber warm-up (1.1 s), then a dry blast cone (range 15, 1.25 × max speed) | 1 on contact |
| The Sun        | 17 (boss) | 2.8                  | ≈ 4 (≈ 2.9 after two chips) | solar wind push, CMEs (telegraphed charges), flare volleys, stunned only by a giant planet (an eclipse), chips are prominences | 1, sheds 5 % (flares 3 %) |

(Per-Tier pairs are Tier 16 / Tier 17.)

| The Sun (`THE_SUN`) | Value | Orbital Sweeper, for scale |
|---|---|---|
| Size / contact radius | 2.8 / 2.6 units (the 270 photosphere × 2.8 / 2.944; model 5.8 across, 3.6 tall) | 2.8 / 2.1 |
| Hunt speed / turn rate | 5 units/s / 1.2 rad/s | 5 / 1.3 |
| CME (charge): trigger / telegraph / speed / distance | 32 / 1.6 s / 22 units/s / 42 | 32 / 1.5 / 22 / 40 |
| Stun / recover | 3.8 s / 1.2 s, only from a charge into a giant planet the Bunny can't absorb yet (Jupiter, also while locked until Tier 17; Saturn, Uranus, Neptune; the Hot Jupiter); the map edge just ends it; Abilities and Spiky Dash still stun it | 3.5 / 1.2, the Moon |
| Solar wind | while it hunts, telegraphs or recovers: a Bunny within 9 units of its surface is pushed away at up to 0.4 × its max speed (fading out; not when hunkered, hidden or able to absorb it); loose Debris ≤ 0.6 there is blown outward at up to 8 units/s | net pull 0.35, front only |
| Flare volleys | every 7 s hunting or recovering on screen: orange lane for 1.1 s, then 3 flares (20 units/s, range 28) from its limb | lasers: 6 s, 1 s, 4 bolts at 26 |
| Eclipse | glow ×0.15 while stunned, no wind | — |
| Hot Jupiter | on arrival and every 8 s of hunting, if no blocking giant is within 26 units of the Bunny, one lands 3 units beyond its edge (between it and the Sun the first time), sized max(2.4, 1.25 × the largest the Bunny can absorb) | the Moon, same rule |
| Minis | none | 3 mini sweepers / 13 s, up to 6 |
| Chips | × 0.85, 8 prominences (0.45 × the Bunny's radius); each chip hides a prominence arc for 8 s | × 0.85, 8 parts |

Jupiter unlocks at Tier 17 and the Sun arrives 4 s later; Saturn (3.0) and Neptune (2.9) stay too big until r ≈ 4.2, so they and Jupiter (until it is eaten) are what its charges hit, with the Hot Jupiter as the fallback when none is near. Sim check with the Bunny started at Tier 17 (`pnpm sim --area=solar_system --radius=3.05 --seeds=6`): 18 / 18 wins, no deaths, median fight 0:46–0:53 per Character (6 chips); without Abilities 18 / 18, 0:52–0:59 (1 chip: the bot wins mostly by outgrowing it, as on the Globe). The whole Act (`--area=solar_system --seeds=6 --minutes=12`, before the growth pass): 17 / 17 boss kills, no deaths, Act median Lint 6:27, Tumble 8:16, Zap 4:37 (one Lint Run starved in Tier 16).

A Hazard whose size ≤ radius × absorb ratio becomes Debris: touching it absorbs it for a big mass gain. Absorbing the Robo-Vac 9000 opens the front door to the neighborhood, the Street Sweeper opens the road to the city, the Garbage Truck the highway on-ramp to the region, the Incinerator the motorway west to the continent, the Ice Sheet the launch corridor up to the Globe, the Orbital Sweeper the escape trajectory to the Solar System, and absorbing the Sun wins the Run.

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
| Growth multiplier | 0.19 (tuned on full Runs with the final map, Debris, Hazards and Ice Sheet) |
| Start scatter / cluster / cluster radius | 2,000 / 120 / 11 units |
| Fluff per unit of growth | 1.5 |
| HUD readout | from km (`8.50 / 10 km`, then `/ 30 km`) |
| Area board | 10,000 points per unit grown from 0.85, par 360 s, growth bound 0.08 units/s + 0.1 (looser than the Region's until the content is tuned) |
| Run board | zero band from 50 m to 8.5 km, then 1e-4 per cm (100 per Continent unit) |

**Continent pacing check** (final content: map, Debris, weather Hazards and the Ice Sheet; growth 0.19). Full Runs (`pnpm sim --seeds=8 --minutes=60 --validate`, Casual), median Continent Act time (arrival after the leap to absorbing the Ice Sheet): Lint 4:39, Tumble 4:45, Zap 2:06; every Run that reached the Continent beat the Ice Sheet (Lint 3 / 3, Tumble 3 / 3, Zap 6 / 6), and all 88 leaderboard submissions validated (closest: 76% of the Run board allowance, 47% of the Continent board's). Starting in the Continent (`pnpm sim --area=continent --seeds=12`, fewer Perks than a real arrival) is slower: at growth 0.22 Lint 4:56, Tumble 6:38, Zap 3:06. Zap is the quick Character here as in every Act (Region 3:34, City 3:58). The Continent board's growth allowance stays at 0.08 units/s: a max-Loadout Zap win came to 68% of it, which would exceed 0.05.

| Globe tuning (`AREAS.globe`) | Value |
|---|---|
| Unit | 1,000 km (100,000,000 cm) |
| Arrival radius | 0.85 units (850 km, 0.13 Earths), the second size leap |
| Debris Tier band | 14–15 |
| Growth multiplier | 0.20 (tuned on full Runs with Hazards, see below) |
| Start scatter / cluster / cluster radius | 2,400 / 120 / 11 units |
| Map | 480 × 240 units, wraps east–west; open ocean within 14 units of the seam; 5 Moons placed in the open oceans |

**Globe Debris ladder** (`src/data/globeDebris.ts`, sizes are radii in Globe units; absorbable at size ÷ 0.7). Arrival types weigh 0.6 × their zone weights so the larger Tier 14 types lead once the Bunny passes 1 unit. Types marked † render a Blender prop (by id or `model`), the rest recipes.

| Tier band | Debris (size) | Zones |
|---|---|---|
| 13–14 (arrival, r 0.85–1) | satellite† 0.11, weather system† (`cloud_swirl`) 0.12, spent rocket stage† 0.13, space junk† 0.15, ice floe 0.17, volcanic island 0.2, rainforest 0.21, coral reef 0.24, atoll† 0.28, cloud bank† 0.3, island† 0.34 | space hardware everywhere; floes on the ice; reefs, atolls and islands on shelves and archipelagos |
| 14 (Dust Moon, r 1–3) | a great desert 0.48, ice shelf 0.62 (Tier 14 only); patch of ocean† 0.55, the Great Barrier Reef 0.68, storm system† 0.75, archipelago† 0.9, cordillera 1.0, large island† 1.1, inland sea† 1.25, island arc† 1.4 (Tiers 14–15) | deserts and cordilleras on land, ice shelves on the caps, ocean and storms over the oceans, islands in the archipelagos |
| 15 (from r ≈ 2.5) | the Moon† 1.74 (an Obstacle until then; also placed by the map and by the Orbital Sweeper) | every zone, lightly |
| 15 (Dust Planet, r ≥ 3) | polar ice cap 2.0, landmass† 2.2, subcontinent† 2.5, ocean basin† 2.8, a continent† 3.1, an ocean† 3.4 | caps on the ice, land on the landmasses, basins and oceans over the oceans |

**Globe pacing check** (pure growth, `pnpm sim --area=globe --seeds=3 --no-hazards`, starting on the Globe at the arrival size): Tier 15 at Lint 3:15, Tumble 4:17, Zap 2:32 (medians). Growth 0.19 (the Continent's) left the 1 → 3 unit stretch at 6–10 minutes; the Tier 14 masses went up (×1.2–1.3) and the multiplier to 0.34. Starting on the Globe has no Perks, so the multiplier is tuned on full Runs, like the Continent's: at 0.20, full Runs from the house (`pnpm sim --seeds=6 --minutes=80 --validate`) took Lint 5:55 / 3:42, Tumble 5:34, Zap 3:27 / 3:29 from arrival to absorbing the Orbital Sweeper (per seed group), and every Run and Area board submission validated (the Globe board peaked at 31% of its growth limit, the Run board at 80%). Starting on the Globe (`pnpm sim --area=globe --seeds=6`) the same Act took Lint 4:48, Tumble 5:45, Zap 3:32 at 0.30 (17 boss wins in 18 fights), so at 0.20 an `--area=globe` start runs about 1.5× longer than a real Run. The bot needed its path planner to wrap round the seam: without it Runs stalled in Tier 14 at the date line.

| Solar System tuning (`AREAS.solar_system`) | Value |
|---|---|
| Unit | 0.01 AU (1.496e11 cm) |
| Arrival radius | 0.85 units (0.0085 AU), the third size leap |
| Debris Tier band | 16–17 |
| Map | 360 × 360 units, the Sun at the centre; zone rings: corona < 14, inner orbits < 78, asteroid belt < 102, outer orbits < 160, Kuiper belt beyond; no walls or obstacles |
| Orbit rings (`layout.routes`, kind `orbit`) | 22, 36, 50 (Earth's, empty; the spawn), 66, 118 (Jupiter), 136, 150, 166 units; width 3 |
| Placements | Voyager 1 7 units north-east of the spawn; Mercury, Venus, Mars (16–35 units from the spawn), Jupiter (far side of the Sun), Saturn, Uranus, Neptune on their rings; Pluto at 174; 600 belt rocks; 2 × 26 Trojans |

**Solar System Debris ladder** (`src/data/solarDebris.ts`, sizes are radii in Solar System units; absorbable at size ÷ 0.7). Types marked † render a Blender prop (by id or `model`), the rest recipes. Named planets (‡) are placed by the map only, one each.

| Tier band | Debris (size) | Zones |
|---|---|---|
| 15–16 (arrival, r 0.85–1) | Voyager 1† 0.12 (placed), meteoroid† 0.11, asteroid† 0.14, comet† 0.18, moonlet† 0.2, asteroid cluster† 0.24, Kuiper belt object† 0.27, rubble pile† 0.3, Phobos† 0.33 | rocks lead in the belt, comets and ice in the Kuiper belt |
| 16 (Dust Giant, r 1–3) | Vesta† 0.45, Mercury†‡ 0.5, Io† 0.56, Europa† 0.62, Mars†‡ 0.68 (food from r ≈ 0.97), great comet† 0.75, Ceres† 0.78, icy moon† 0.85, Ganymede† 0.95, Titan† 1.05, Pluto†‡ 1.15, Venus†‡ 1.25, dwarf planet† 1.35 | Vesta and Ceres in the belt, the moons in the outer orbits, dwarf planets in the Kuiper belt |
| 17 (Dust Star, r ≥ 3) | comet swarm 1.8, asteroid swarm† 2.0, Jupiter†‡ 2.4 (an Obstacle until Tier 17, then food from r ≈ 3.4), Uranus†‡ 2.6, rogue planet† 2.6, a slice of Saturn's rings 2.8, Neptune†‡ 2.9, Saturn†‡ 3.0, leftover dust 3.1 | swarms where their parts live, the rest everywhere lightly |

Jupiter, Saturn, Uranus and Neptune stop the Sun's charges while the Bunny can't absorb them; Neptune and Saturn stay too big until r ≈ 4.2 (about when the Sun is edible), so they block for most of the fight. Before Tier 17 a dashed amber ring turns round Jupiter; at Tier 17 a toast says it is no longer an Obstacle, and the ring turns green (with a "Jupiter can be absorbed now" toast) once the Bunny is big enough.

**Solar System pacing check** (`pnpm sim --area=solar_system`, 5 seeds, Hazards on, growth 0.2): Tier 16 at Lint 0:58, Tumble 1:30, Zap 0:33; Act (arrival to absorbing the Sun) Lint 7:05, Tumble 7:54, Zap 4:59. An `--area` start has no Perks and ran ≈1.5× a real Run on the Globe, so this is about 3:20–5:20 in a full Run. Tier 16 and 17 masses went up ×1.25 (Tier 15 ×1.15) from the first ladder, which took 5:41–9:54.

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

- **Drops:** every boss kill credits 1 Keepsake of the boss's grade with a random type (seeded from the Run seed); Hardcore adds 1. Shortly after the kill (once the area-cleared banner is done) the Run pauses on a reveal of what the boss left. On a Character's first kill of a boss the player chooses 1 of 3 offered types there instead; the first offer is credited at once, and leaving the reveal locks in the highlighted one. If the Run ends before the reveal shows (a boss that wins the Run), the drop and the choice are on the results screen instead. Keepsakes are credited on the kill, so a Run that then ends in death or a quit keeps them. Runs with `?debug` or started past the house drop nothing. Chipping doesn't change the reward.
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

Title → Character select (Difficulty, Ability card and Loadout) → Run (HUD) → Perk draft (modal on Tier-up) / Keepsake reveal (modal after a boss drop) → Pause → Results (death or victory: time, max radius, Debris absorbed, Tier, Fluff earned, Keepsakes kept, leaderboard name entry) → Shop / Under the Couch → back to Character select. Plus Settings (master/music/SFX volume, quality, reduced motion, story captions) and a How-to-Play panel.

HUD: hearts, radius readout, progress bar to next Tier with Tier name, Dash cooldown, active Pickup icons with timers, Perk icons, small Tier-up/absorb toasts ("+ Sock!").

## Art direction

Cozy, warm, toy-like low poly with soft shadows. Wooden plank floor (procedural canvas texture), rugs, tiles in kitchen/bathroom, baseboards on walls. The Bunny is a grey fuzzy ball (shell-texture fur or noisy displaced sphere) with two cute eyes; absorbed Debris visibly sticks to its surface (cap the count rendered for performance). Hazards read clearly as dangerous: warning colours, telegraph indicators on the floor before attacks.
