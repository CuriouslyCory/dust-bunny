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

**Solar System phase (Act 7, *A Very Large Leaf Blower*).** The ecliptic from above: black space with a starfield and the Milky Way crossing the backdrop as a dust-lane band, faint orbit rings as lanes (Earth's empty and dashed), the Sun at the centre with its corona and glare, and the light coming from the Sun, so planets are lit on their sunward side and shadows fall away from it. The map (360 × 360 units, 3.6 × 3.6 AU, not to scale) is rings round the Sun: the corona, the inner orbits (Mercury, Venus, Earth's empty orbit, Mars), a cluttered asteroid belt (rocks, gravel, two Kirkwood gaps, Trojans at Jupiter's L4 / L5), the outer orbits (Jupiter, Saturn, Uranus, Neptune) and the Kuiper belt thinning into interstellar dark at the edge. 1 world unit = 0.01 AU. The Bunny arrives on Earth's orbit after the third size leap, at 0.85 units, glowing from within (plasma), and meets Voyager 1 on its first screen; Tier 16 (Dust Giant) starts at 1 unit (Mars is food just before it) and Tier 17 (Dust Star) at 3, when Jupiter stops being an Obstacle. When the Sun is absorbed the light goes out: everything fades to black but the Bunny's own glow, and the heliopause opens on the north edge (the way Voyager 1 went) onto the Galaxy.

**Galaxy phase (Act 8, *The Biggest Vacuum There Is*).** The galactic disc from above, Sagittarius A* waiting at the centre in the warm glow of the bulge and the bar: two major spiral arms leave the bar's ends and two minor arms join them further out, blue-white with young stars and pink star-forming knots, with dark ragged dust lanes between them, then a thin halo, all over a nebula backdrop of cool blues and magentas. Stars are points of light on the disc (crowded in the arms and the core) and far below it, sliding by slower than the floor so the disc seems to float over deep space. The light is dim and cool, with a warm light from the core. 1 world unit = 100 ly. The Bunny arrives out on an arm after the fourth size leap, at 0.85 units (85 ly), beside a dozing rogue planet and a drifting sock; Tier 18 (Dust Nebula) starts at 1 unit and Tier 19 (Dust Cluster) at 3. Star clusters crowd the core and the bar (they stun Sagittarius A*). Absorbing Sagittarius A* opens the intergalactic gate on the north edge, out of the halo to the Universe, and turns the Bunny into a black hole for good: a dark core, an accretion disc of lint, a lensing shimmer round it, the same eyes.

**Universe phase (Act 9, *One Place*).** The cosmic web from outside: near-black voids, a dim blue mist of sheets round bright blue-white filaments clumped into knots of galaxies, and warm gold superclusters where three voids meet, with galaxies as points over it and a deeper field of faint ones sliding by below; the light is dim and cool with warm accents at the nodes, and the screen's edges carry a faint orange CMB tint. The voids are nearly empty and slow the Bunny to 0.7 × while it is in one, so the way to grow is along the filaments from node to node. The Bunny is a cluster of black holes with fur between them (small cores with their own accretion discs orbiting in the fur); the eyes stay. The Great Attractor waits on the node up the screen from the spawn, too big to eat until Everything.

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
| 16 | Dust Giant  | 0.01 – 0.03 AU  | Vesta, Mercury, moons, Mars, Ceres, Pluto, Venus, dwarf planets | a few orbits |
| 17 | Dust Star   | 0.03 AU +       | swarms, Jupiter, Uranus, Neptune, Saturn, the Sun | the solar system |
| 18 | Dust Nebula | 100 – 300 ly    | sun-like stars, Bok globules, planetary nebulae, giants, lint clouds, dark nebulae, open clusters, Oort clouds, a sock nebula | a stretch of arm |
| 19 | Dust Cluster | 300 ly +       | supergiants, emission nebulae, stellar nurseries, molecular clouds, hypergiants, star clusters, interstellar lint, Sagittarius A* | the galaxy |
| 20 | Dust Singularity | 10 – 30 Mly | spiral, lenticular, elliptical, barred and starburst galaxies, galaxy pairs, radio galaxies, groups, filament knots, someone's couch, a lint web, giant spirals | a stretch of filament |
| 21 | Everything | 30 Mly + (`everything`) | galaxy clusters, giant ellipticals, the Great Attractor, cluster mergers, superclusters, a great wall, a lint supercluster, the Expansion | everything |

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
| Street Sweeper | 7 (boss)  | 150               | ≈ 214 (or 3 hits) | hunts with suction, telegraphed charges, stunned by houses / trees, summons mini mowers | 1, sheds mass |

**The city (after the Street Sweeper, Bunny r ≈ 175–230 on arrival):**

| Hazard          | From Tier | Size (cm, radius) | Absorbable at r | Behaviour | Damage |
|-----------------|-----------|-------------------|-----------------|-----------|--------|
| Pressure Washer | 7         | 170               | ≈ 243           | turret: head turns, aims a lane, fires a burst of fast water jets | 1 per jet, brief slow |
| Floor Scrubber  | 7         | 190               | ≈ 271           | ride-on scrubber, Roomba behaviour, weak scrub-brush pull | 1 + knockback |
| Litter Vacuum   | 7         | 220               | ≈ 314           | amber cone warm-up, then a suction cone that pulls the Bunny in | 1, sheds mass |
| Street Flusher  | 8         | 300               | ≈ 429           | water truck patrolling a street, wide wet trail that slows | 1 + knockback; trail slows |
| Garbage Truck   | 9 (boss)  | 560               | ≈ 800 (or 3 hits) | hunts with compactor suction, telegraphed charges, stunned by buildings / the barrier, summons mini scrubbers | 1, sheds mass |

**The Region (after the Garbage Truck; 1 world unit = 10 m, Bunny r ≈ 0.65–0.9 units on arrival):**

| Hazard             | From Tier | Size (units, radius) | Absorbable at r | Behaviour | Damage |
|--------------------|-----------|----------------------|-----------------|-----------|--------|
| Landfill Compactor | 10        | 1.05                 | ≈ 1.5           | Roomba behaviour, packer-wheel pull | 1 + knockback |
| Crop Duster        | 10        | 1.25                 | ≈ 1.8           | turret: circles on the spot, aims a lane, dusts a burst of pesticide | 1 per droplet, 2 s slow |
| River Barge        | 10        | 1.5                  | ≈ 2.1           | patrols the river (placed in `river` zones), wide wake that slows | 1 + knockback; wake slows |
| Snowplow           | 10        | 1.7                  | ≈ 2.4           | lane patrol along a road, plows the Bunny aside | 1 + knockback, sheds mass |
| Water Bomber       | 11        | 2.3                  | ≈ 3.3           | amber cone warm-up, then a water drop that blasts the Bunny away and soaks it | 1 on contact; blast slows |
| Freight Train      | 11        | 2.45                 | ≈ 3.5           | long, fast lane patrol | 1 + knockback, sheds mass |
| The Incinerator    | 11 (boss) | 2.8                  | ≈ 4 (or 3 hits) | hunts with feed-conveyor suction, telegraphed charges, chimney ash volleys, stunned by towns / the map edge, summons mini compactors | 1, sheds mass (ash too) |

**The Continent (after the Incinerator; 1 world unit = 10 km, Bunny r = 0.85 units on arrival).** Hazards are weather. Sizes keep the Region ladder's ratios to the Bunny (the Continent repeats the Region's shape: Tiers at 1 and 3 units, boss absorbable at ≈ 4).

| Hazard          | From Tier | Size (units, radius) | Absorbable at r | Behaviour | Damage |
|-----------------|-----------|----------------------|-----------------|-----------|--------|
| Tornado         | 12        | 1.1                  | ≈ 1.57          | Roomba behaviour: erratic wander (2.2 / 4.4 units/s), wide vortex pull (reach 1.4, 0.3 × max speed), spinning funnel | 1 + knockback |
| Volcano         | 12        | 1.3                  | ≈ 1.86          | static turret: the crater aims (range 9 / 13), lane telegraph (1.1 / 0.9 s), then 3 lobbed lava bombs; ash slows (1.2 s, × 0.7) | 1 per bomb, brief slow |
| River Surge     | 12        | 1.5                  | ≈ 2.14          | fast flood surge (2.2 / 3.4 units/s) patrolling waypoints, wide muddy trail that slows (× 0.5) | 1 + knockback; trail slows |
| Glacier Tongue  | 12        | 1.9                  | ≈ 2.71          | slow, heavy lane patrol (1.4 / 2.4 units/s, lanes 8–30), placed in tundra and mountain zones | 1 + big shove, sheds 8 % |
| Hurricane       | 13        | 2.4                  | ≈ 3.43          | spinning bands; amber warm-up (1.1 s), then a wind cone (range 14) that blasts the Bunny away and soaks it | 1 on contact; blast slows |
| The Ice Sheet   | 13 (boss) | 2.8                  | ≈ 4 (or 3 hits) | slow, enormous, bulldozes the Bunny and Debris ahead, telegraphed surges, stunned only by mountain ranges, calves icebergs | 1, sheds 5 % |

(Per-Tier pairs are Tier 12 / Tier 13.)

| The Ice Sheet (`ICE_SHEET`) | Value | Incinerator, for scale |
|---|---|---|
| Size / contact radius | 2.8 / 3 units (model 5.8 × 3.9 units) | 2.8 / 2.95 |
| Hunt speed / turn rate | 3.2 units/s / 0.7 rad/s | 6 / 1.4 |
| Charge: trigger / telegraph / speed / distance | 30 / 1.8 s / 13 units/s / 36 | 35 / 1.4 / 24 / 45 |
| Stun / recover | 3.5 s / 1.4 s, only from a charge into a mountain range (Abilities and Spiky Dash still stun it) | 3 / 1, towns and the map edge |
| Bulldoze | Bunny within 2.4 units of the front cliff pushed at 0.6 × its max speed; Debris ≤ 1.6 units shoved ahead | suction 0.35 |
| Calving | an iceberg every 9 s of hunting (alternate front corners, 5 s to regrow), both corners on a mountain crash; iceberg = 0.55 × Bunny radius (0.6–2 units, mass 2.4) | summons mini compactors |
| Hits | 3, each knocks 8 icebergs loose | 3, 8 parts each |

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
| The Orbital Sweeper    | 15 (boss) | 2.8                  | ≈ 4 (or 3 hits) | net pull at the front, telegraphed charges, twin laser volleys, stunned only by the Moon, summons the Kessler swarm | 1, sheds 4 % (lasers 3 %) |

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
| Hits | 3, 8 parts each | 3, 8 parts each |

The Moon is the only stun source because the Globe has no obstacles. A real-size Moon (1.74 units) is food from r ≈ 2.5, before the boss arrives, so the Sweeper brings its own: big enough to block the Bunny (which can still shove it), so standing behind it baits a charge into it. Sim check with the Bunny started at Tier 15 (`pnpm sim --area=globe --radius=3.05`): 12 / 12 wins (4 Moon stuns, the rest Ability stuns and growth); without Abilities 11 / 12 wins, 7 Moon stuns.

**The Solar System (after the Orbital Sweeper; 1 world unit = 0.01 AU, Bunny r = 0.85 units on arrival).** Hazards are rocks, ice and the Sun's own weather. The Solar System repeats the Globe's shape (Tiers at 1 and 3 units, boss absorbable at ≈ 4), so each Hazard keeps the size and speed of the Globe Hazard whose behaviour it reskins. The map has no obstacles.

| Hazard         | From Tier | Size (units, radius) | Absorbable at r | Behaviour | Damage |
|----------------|-----------|----------------------|-----------------|-----------|--------|
| Rogue Asteroid | 16        | 1.1                  | ≈ 1.57          | Roomba behaviour: tumbling wander (2.4 / 4.2 units/s, turns every 1–2.6 s), gravity pull (reach 1.5, 0.3 × max speed), spinning rock | 1 + knockback |
| Sunspot        | 16        | 1.3                  | ≈ 1.86          | static turret sunward of the Kuiper belt: the flux-tube head sweeps like a pulsar beam out of range (0.9 rad/s), aims (range 10 / 14), lane (1.2 / 1 s), then 3 flare bolts 0.16 s apart (13 / 18 units/s), reload 3.8 / 3 s | 1 per bolt |
| Sungrazer      | 16        | 1.5                  | ≈ 2.14          | comet streaking between waypoints within 24 units of its spawn, across zones (2.8 / 4 units/s); its icy tail trail (7 s, wide) slows to 0.55 × | 1 + knockback |
| Comet          | 16        | 1.6                  | ≈ 2.29          | rides the orbit ring nearest its spawn (within 20 units) one way round, no ends (3.2 / 4.6 units/s), a short lane sliding ahead of it, its tail streaming 7.5 units behind | 1 + big shove, sheds 8 % |
| Solar Flare    | 17        | 2.4                  | ≈ 3.43          | plasma arch: its loop swells through the amber warm-up (1.1 s), then a dry blast cone (range 15, 1.25 × max speed) | 1 on contact |
| The Sun        | 17 (boss) | 2.8                  | ≈ 4 (or 3 hits) | solar wind push, CMEs (telegraphed charges), flare volleys, stunned only by a giant planet (an eclipse), hits knock prominences loose | 1, sheds 5 % (flares 3 %) |

(Per-Tier pairs are Tier 16 / Tier 17.)

| The Sun (`THE_SUN`) | Value | Orbital Sweeper, for scale |
|---|---|---|
| Size / contact radius | 2.8 / 2.6 units (the 270 photosphere × 2.8 / 2.944; model 5.8 across, 3.6 tall) | 2.8 / 2.1 |
| Hunt speed / turn rate | 5 units/s / 1.2 rad/s | 5 / 1.3 |
| CME (charge): trigger / telegraph / speed / distance | 32 / 1.6 s / 22 units/s / 42 | 32 / 1.5 / 22 / 40 |
| Stun / recover | 3.8 s / 1.2 s, only from a charge into a giant planet the Bunny can't absorb yet (Jupiter, also while locked until Tier 17; Saturn, Uranus, Neptune; the Hot Jupiter); the map edge just ends it; Abilities and Spiky Dash still stun it | 3.5 / 1.2, the Moon |
| Solar wind | while it hunts, telegraphs or recovers: a Bunny within 9 units of its surface is pushed away at up to 0.4 × its max speed (fading out; not when Amassing, hidden or able to absorb it); loose Debris ≤ 0.6 there is blown outward at up to 8 units/s | net pull 0.35, front only |
| Flare volleys | every 7 s hunting or recovering on screen: orange lane for 1.1 s, then 3 flares (20 units/s, range 28) from its limb | lasers: 6 s, 1 s, 4 bolts at 26 |
| Eclipse | glow ×0.15 while stunned, no wind | — |
| Hot Jupiter | on arrival and every 8 s of hunting, if no blocking giant is within 26 units of the Bunny, one lands 3 units beyond its edge (between it and the Sun the first time), sized max(2.4, 1.25 × the largest the Bunny can absorb) | the Moon, same rule |
| Minis | none | 3 mini sweepers / 13 s, up to 6 |
| Hits | 3, each knocks 8 prominences loose (0.45 × the Bunny's radius) and hides a prominence arc for 8 s | 3, 8 parts each |

Jupiter unlocks at Tier 17, about when the Sun arrives; Saturn (3.0) and Neptune (2.9) stay too big until r ≈ 4.2, so they and Jupiter (until it is eaten) are what its charges hit, with the Hot Jupiter as the fallback when none is near. Sim check with the Bunny started at Tier 17 (`pnpm sim --area=solar_system --radius=3.05 --seeds=6`): 18 / 18 wins, no deaths, median fight 0:46–0:53 per Character (6 chips); without Abilities 18 / 18, 0:52–0:59 (1 chip: the bot wins mostly by outgrowing it, as on the Globe). (Measured when a ram still chipped the boss smaller, before hits.) The whole Act (`--area=solar_system --seeds=6 --minutes=12`, before the growth pass): 17 / 17 boss kills, no deaths, Act median Lint 6:27, Tumble 8:16, Zap 4:37 (one Lint Run starved in Tier 16).

**The Galaxy (after the Sun; 1 world unit = 100 ly, Bunny r = 0.85 units on arrival).** Hazards are the Galaxy's own vacuums, lighthouses and explosions. The Galaxy repeats the Solar System's shape (Tiers at 1 and 3 units, boss absorbable at ≈ 4), so each Hazard keeps about the size of the Solar System Hazard whose behaviour it reskins. The map has no obstacles.

| Hazard            | From Tier | Size (units, radius) | Absorbable at r | Behaviour | Damage |
|-------------------|-----------|----------------------|-----------------|-----------|--------|
| Black Hole        | 18        | 1.1                  | ≈ 1.57          | Roomba behaviour: slow drifting wander (2 / 3.4 units/s, turns every 2–4 s), strong pull (reach 3.2, 0.55 × max speed); loose Debris ≤ 1.2 within 4 units spirals in (3 units/s) and is swallowed; rings flow inward over the pull | 1 + knockback |
| Pulsar            | 18        | 1.3                  | ≈ 1.86          | static lighthouse: twin beams turn all the time (0.6 / 0.7 rad/s); when a beam is about to reach the Bunny in range (9 / 12) on screen, red lanes and amber wedges (the arc they will sweep) for 1.1 / 0.95 s, then the beams burn 1.3 s, still turning; reload 2.8 / 2.3 s | 1 per burn, knocked onward and out |
| Supernova Remnant | 18        | 1.4                  | ≈ 2.0           | slow filament shell roaming across zones (1.6 / 2.2 units/s, waypoints within 22 units), its shell breathing; its trail of glowing filament rings (10 s) slows to 0.5 × | 1 + knockback |
| Globular Cluster  | 18        | 1.5                  | ≈ 2.14          | rides the galactic orbit ring nearest its spawn one way round (2.8 / 4.2 units/s), its star swarm turning | 1 + big shove, sheds 8 % |
| Supernova         | 19        | 2.3                  | ≈ 3.29          | overheated star: its core swells through the amber warm-up (1.4 s), then a short shock blast (1.1 s, range 14, ±30°, 1.5 × max speed) pushes the Bunny and loose Debris ≤ 1.1 away; off 2.8 s | 1 on contact |
| Sagittarius A*    | 19 (boss) | 2.8                  | ≈ 4 (or 5 hits) | a pull that bends the camera, eats loose Debris, indigestion from star clusters, jet volleys, lunges; hits knock relativistic jets loose | 1, sheds 5 % (jets 3 %) |

(Per-Tier pairs are Tier 18 / Tier 19.)

| Sagittarius A* (`SAGITTARIUS_A`) | Value | The Sun, for scale |
|---|---|---|
| Size / contact radius | 2.8 / 2.5 units; drawn at model scale 1.4 (hole r 1.4, disc r 4.5, 7.6 tall with the north jet) | 2.8 / 2.6 |
| Hunt speed / turn rate | 4.2 units/s / 1 rad/s | 5 / 1.2 |
| Lunge (charge): trigger / telegraph / speed / distance | 24 / 1.6 s / 20 units/s / 28; the map edge ends it without a stun | 32 / 1.6 / 22 / 42 |
| Pull | while it hunts: reach 12 beyond its edge, 0.5 × the Bunny's max speed at the edge (the bosses' suction, scaled by Suction Multiplier; not while hidden or able to absorb it) | solar wind push 0.4 |
| Camera bend | lensing warp round the hole: strength 0.4 idle, up to 1 at full pull (Einstein ring 2 × the hole, fading out by 1.8 × the disc; off while the Bunny is over the disc); at full pull the camera leans 0.22 × the gap towards it (at most a third of the camera distance) and rolls 0.1 rad; reduced motion: no roll, a third of the lean | — |
| Feeding | while it hunts, telegraphs, lunges or recovers: loose Debris ≤ 8 within 14 units of its edge spirals in at up to 7 units/s and is swallowed at its horizon (not the jets its hits knock loose) | blows Debris ≤ 0.6 outward |
| Indigestion | a `star_cluster` swallowed counts 1, an `open_cluster` ½, any cluster ≥ 4.5 counts 2; 2 within 6 s stuns it for 4.2 s (recover 1.2 s): amber ring, the glow sputters, the north jet coughs, the camera lets go | eclipse: a charge into a giant planet, 3.8 s |
| Clusters drift in | on arrival and every 9 s of hunting, if less than 2 meals' worth of clusters is within 22 units of it, 2 star clusters land side by side on the line towards the Bunny (2.5 units short of the Bunny's edge, no further than the cluster's size + 7 from the boss's edge, inside its Debris pull), sized max(2.1, 1.2 × the largest the Bunny can absorb) | the Hot Jupiter, same idea |
| Jets (volley) | every 6.5 s hunting or recovering on screen: violet lane for 1.1 s, then 4 bolts (26 units/s, range 30); the north jet swells while it aims | flares: 7 s, 1.1 s, 3 at 20 |
| Hits | 5, each knocks 8 relativistic jets loose (0.45 × the Bunny's radius) and hides the north jet for 6 s | 3, 8 prominences each |
| Minis | none | none |

Clusters are the only stun source besides Abilities and Spiky Dash: the Galaxy has no obstacles, and natural star clusters (2.1) are food from Tier 19, so the boss's own clusters arrive too big for the Bunny to eat and double as cover against its pull. Leading it across clusters (or waiting behind the ones that drift in) is the fight. Sim check with the Bunny started at Tier 19 (`pnpm sim --area=galaxy --radius=3.05 --seeds=6`): 18 / 18 wins, no deaths, median fight 0:28–0:45 per Character, 43 indigestion stuns; without Abilities 18 / 18, 0:31–0:43, 45 indigestion stuns. The whole Act (`--area=galaxy --seeds=6 --minutes=15`, placeholder ladder and growth, before the world pass): 15 / 15 boss kills, no deaths, 29 indigestion stuns; Tier 19 at Lint 9:29, Tumble 12:39, Zap 7:51 (three Tumble Runs still in Tier 18 at 15 minutes), Act median Lint 10:21, Tumble 12:53, Zap 8:37.

**The Universe (after Sagittarius A*; 1 world unit = 10 Mly, Bunny r = 0.85 units on arrival).** Hazards are the cosmic web's own weather: feeding black holes, merging galaxies, gamma-ray bursts, voids and dark energy. The Universe repeats the Galaxy's shape (Tiers at 1 and 3 units), so each Hazard keeps about the size of the Galaxy Hazard whose behaviour it reskins. The map has no obstacles; the filaments are `layout.routes` of kind 'filament'.

| Hazard            | From Tier | Size (units, radius) | Absorbable at r | Behaviour | Damage |
|-------------------|-----------|----------------------|-----------------|-----------|--------|
| Quasar            | 20        | 1.2                  | ≈ 1.71          | Roomba behaviour: drifting wander (2.2 / 3.6 units/s, turns every 2–4 s), the strongest Hazard pull (reach 4, 0.6 × max speed, a cyan ring); loose Debris ≤ 1.4 within 5 units swirls round it (3.5 units/s) without being eaten; its disc spins, its jets pulse | 1 + knockback |
| Colliding Galaxy  | 20        | 1.5                  | ≈ 2.14          | two galaxies mid-merger patrolling back and forth along the filament nearest its spawn (within 30 units; a planned lane otherwise), lane 16–60 long, 3.4 / 4.8 units/s, its galaxies turning opposite ways | 1 + big shove, sheds 8 % |
| Gamma-ray Burst   | 20        | 1.3                  | ≈ 1.86          | static: its head tracks the Bunny (sweeps 0.45 rad/s out of range); lined up and on screen, the aim locks and a violet lane runs from the muzzle to the end of its range (28 / 36) for 1.3 / 1.1 s while the star swells; then one narrow white beam (0.9 wide) shoots along it at 140 units/s and stays lit 0.35 s; reload 4.2 / 3.4 s | 1 per burst, knocked sideways, sheds 3 % |
| Cosmic Void       | 20        | 1.4                  | ≈ 2.0           | an empty bubble roaming across zones (1.8 / 2.4 units/s, waypoints within 24 units), its shell breathing; its near-black trail (9 s, violet-rimmed) slows to 0.5 × | 1 + knockback |
| Dark-energy Gust  | 21        | 2.4                  | ≈ 3.43          | its core swells through a violet warm-up (1.5 s), then a blast (1.4 s, range 16, ±24°, 1.4 × max speed) pushes the Bunny and loose Debris ≤ 1.4 away; off 2.8 s | 1 on contact |
| The Expansion     | 21 (boss) | —                    | never (not a body) | a lattice round the Bunny; a tug-of-war bar instead of health; pushes every Debris outward | the Big Rip: 1, sheds 6 % |

(Per-Tier pairs are Tier 20 / Tier 21. `UNIVERSE_DIRECTOR`: Tier 20 budget 2 → 4, a spawn every 8 → 6 s; Tier 21 budget 3 → 4, every 7 → 6 s, so the fight stays the main pressure.)

| The Expansion (`THE_EXPANSION`) | Value |
|---|---|
| Body | none (`intangible`): never touched, absorbed, clogged, Discharged or Spiky-Dashed; the lattice centres on the Bunny, its hollow at 3 × the Bunny's radius; unfolds over a 3 s intro (no flow, no drain) |
| Bar | `gravity` starts at 0.3; 1 collapses it. The bar from 0.3 to 1 is cut into 7 notches (its 7 hits, `AREA_BOSSES`): passing one sticks ("Notch n/7") |
| Gravity gain | 0.09 × (size ÷ r₀)³ per thing absorbed (Debris and Hazards; r₀ = the Bunny's radius when it arrived), into a pending pool (≤ 0.35) that flows into the bar at up to 0.02 per s |
| Drain | 0.005 → 0.012 per s, ramping over the first 90 s |
| Hubble flow | Debris within the view radius moves away from the Bunny at H × distance, H 0.05 → 0.15 per s over 90 s, capped at 0.5 × the Bunny's max speed; 3 interleaved slices per tick. Debris carried past the view radius and off screen is gone, so it never piles up just out of view, still counted as food, and stops the spawner topping up |
| Filament strands | every 2.5 s, if fewer than 10 absorbable Debris ≥ 0.3 r (strand pieces included) are within 0.6 × the view radius (or the bar is below 0.5 and fewer than 20 strand pieces are about): 5 pieces of 0.55–0.9 × the largest absorbable size land in a line just beyond the view (ahead of a rolling Bunny) and drift in at 0.45 × its max speed to 0.3 × the view radius, where they wait out of the flow (following a Bunny that rolls off) until eaten |
| Big Rip | at the floor (0 before the first notch, then 0.3 below the last notch passed): 1 damage, sheds 6 %, bar back to 0.25 above the floor with 3 s of no drain; a Rip never takes a notch back |
| Collapse | other Hazards fall in; every Debris within 1.3 × the view radius rushes into the Bunny over 2.4 s (removed, no growth); then `bossDefeated`, `run.clearArea()` → `victory` |

Why the gain is measured against r₀ and capped: measured against the current radius, a slow fight let the Bunny outgrow the Universe's Debris ladder (r 9–12 against a top size of 3.1), every gain vanished and the fight could not be won; against r₀, growing only makes the bar easier. Without `maxRise` Zap won in 0:30–0:40, with it no fight is shorter than about a minute. Strands below half a bar are the comeback: a player who keeps rolling always gets food. Sim check with the Bunny started at Tier 21 (`pnpm sim --area=universe --radius=3.05 --seeds=6 --minutes=5`): 18 / 18 wins, no deaths, fight (spawn → collapse) median Lint 1:19, Tumble 1:36, Zap 1:01 (Lint 1:08–1:20, Zap 1:00–1:04; Tumble 1:19–4:08, its slow seed working Debris piled at the map's edge), 1 Big Rip. The whole Act (`--area=universe --seeds=6 --minutes=15`, the groundwork's placeholder ladder and growth): 16 / 18 wins, no deaths, no Big Rips; fight median Lint 1:20 (1:05–1:38), Tumble 1:25 (1:01–2:04), Zap 1:04 (1:01–1:11); Tier 21 at Lint 8:19, Tumble 12:26, Zap 5:05, Act median Lint 10:01, Tumble 12:38, Zap 6:12. Both losses are Tumble Runs that met the Expansion at 12:54 and 14:08, too late for the 15-minute cap; with `--minutes=20` both win (fights 1:21 and 2:44). Every fight that started with two minutes or more left was won.

A Hazard whose size ≤ radius × absorb ratio becomes Debris: touching it absorbs it for a big mass gain. Absorbing the Robo-Vac 9000 opens the front door to the neighborhood, the Street Sweeper opens the road to the city, the Garbage Truck the highway on-ramp to the region, the Incinerator the motorway west to the continent, the Ice Sheet the launch corridor up to the Globe, the Orbital Sweeper the escape trajectory to the Solar System, the Sun the heliopause to the Galaxy, Sagittarius A* the intergalactic gate to the Universe, and absorbing the Expansion wins the Run.

**The boss phase.** Each Area's boss (`AREA_BOSSES`) arrives by size, not by Tier: a few seconds after the Bunny reaches `lead` × the radius that absorbs it (`AREA_BOSSES`), about a minute of gathering short of it, and a boss intro card (the Run paused) says what it is and how to fight it. The "From Tier" column above is where that usually lands; the Expansion, never absorbed by size, arrives at Tier 21. Then the player chooses: **fight** or **grow**. A boss has health in **hits** (3 for the Robo-Vac 9000 through the Sun, 5 for Sagittarius A*, 7 for the Expansion's notches): ramming it while it is stunned (a crash, indigestion, Spiky Dash or an Ability stun; one hit per stun) lands one and knocks absorbable parts loose, and the last hit breaks it and the Bunny absorbs it whatever its size. Hits never shrink it, so growing still means reaching its full absorb radius; a Bunny that does absorbs it on contact. A health card at top centre shows one pip per hit left and the size that absorbs it outright.

**Quiet Areas.** Once the Bunny reaches 85 % (`QUIET_SHARE`) of the next Area's boss arrival size, the Area goes quiet: no more Debris tops up and no more Hazards spawn (boss summons still come). A Bunny that lingers after its boss can catch up a little, but can't walk into the next Act already on top of the next boss.

## Pacing and scale (Acts 4–9)

Decided with the Region (issue #24; story in `docs/story.md`):

1. **Two Tiers and one boss per Act** after the City, with `AREAS[area].growth` tuned so each Act takes 4 to 6 minutes. Adjust later if it plays off.
2. **Full Runs only.** No chapter checkpoints for now; starting at a later Area is a separate, later feature (`?area=` exists for debugging and is unranked). Save & quit doesn't change this: a resumed Run is the same Run, carried on (same leaderboard run id, same ranking), not a checkpoint start, and its save is used up when it resumes.
3. **No Fluff radius cap and no flat per-Area bonus.** Each Act scales its own progression (Fluff, Area score and the server's per-Area bounds) from growth measured in that Act's unit, with plain floating-point maths. Readouts climb the unit ladder (cm, m, km, Earths, AU, ly, Mly; `src/data/units.ts`; a rung is taken only from 0.01 of it, so the Galaxy stays in ly).

**Units.** Each Area declares `AREAS[area].unit` (cm per world unit): 1 for the House, Neighborhood and City, 1,000 for the Region, 1,000,000 for the Continent. Entering an Area re-bases the Bunny (`Bunny.rebase`: radius, max radius, speeds; stuck Debris rescales in the view) so its real size is unchanged; all of the Area's content is authored in its unit.

**The size leap (decided with Act 5).** The Region ends with the Bunny at roughly 30–45 m (the Incinerator falls at ≈ 4 units), but the Continent's unit is 10 km and the story has it arrive at about 1 unit. A real-size re-base would arrive at ≈ 0.004 units, which is unplayable (a speck on a continent map, and nothing on it small enough to eat). So an Area may declare an **arrival radius** (`AREAS[area].arrivalRadius`, in its unit; the Continent's is 0.85). `run.enterArea` re-bases first, then, if the Bunny is smaller, `Bunny.leapTo` scales it up to that radius (radius, interpolated radius and max radius; `bunnyLeapt`, not `bunnyGrew`). 8.5 km is below Tier 12's 10 km, so the leap triggers no Tier-up and no Perk draft; the chapter card covers the off-screen growth, and the Region's Tier 12 goal is hidden on its HUD (`pastNextArrival`). The leap is not growth earned in either Area:

- **Area stats, Fluff and the Continent Area board** count from the radius after the leap (`AreaStats.radiusIn` = 0.85); the Region's stats close before it. The Continent board's entry bound is the arrival radius (`SCORE_ARRIVAL_RADIUS`).
- **Run board:** `progressRadius` gets a zero band from 50 m (about the most a Region Bunny reaches) to the arrival radius (8.5 km), then counts 100 per Continent unit (1e-4 per cm), like the Region's 100 per 10 m unit. Arriving scores like a 50 m Region Bunny; only Continent growth adds. The server's growth-for-time check reads the same scale, so a real Run through the leap passes (the leap adds at most the Region band up to 50 m). Its rate went from 2 to 2.5 per second: with the Continent's growth on top, a max-Loadout Zap win reached 104% of the old allowance. It went to 2.8 with the Galaxy: a perk-loaded Zap won in 23:21 at 104% of 2.5 per second.

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

| Galaxy tuning (`AREAS.galaxy`) | Value |
|---|---|
| Unit | 100 ly (9.461e19 cm) |
| Arrival radius | 0.85 units (85 ly), the fourth size leap (the Solar System ends at ≈ 0.045 AU, ≈ 7e-9 Galaxy units) |
| Debris Tier band | 18–19 |
| Growth multiplier | 0.21 |
| Map | 360 × 360 units, Sagittarius A* at the centre; galactic core < 16, a bar (half-length 40, half-width 8) at a seeded angle, a logarithmic spiral (pitch 0.25) of two major arms from the bar's ends and two minor arms between them fading in from 62 units out; inner arms (< 95) / outer arms (about half the disc) with dust lanes between, out to the disc's edge at 168, halo beyond; no walls, obstacles or exit |
| Orbits (`layout.routes`, kind `orbit`) | 30, 60, 90, 120, 150 units round the core; width 3 |
| Spawn | on the arm crossing nearest due south (within 45°), 112 units from the core |
| Placements | a rogue planet 6.5 units north-west of the spawn (its own narrator line) and a sock 8 units north-east (both on screen at arrival); 16 star clusters 19–46 units from the centre, alternately along the bar and round the bulge, at least 7 apart |
| Look | painted disc (`galaxyTextures.ts`): nebula backdrop in blues and magentas, blue-white arms with pink knots, dark dust lanes on the arms' inner edges, warm bulge and bar; 42,000 disc stars and 26,000 deep stars (parallax) as points, thinned as the camera pulls back; Sagittarius A* waiting at the centre with a glow; dim cool fill, warm light from the core |

**Galaxy Debris ladder** (`src/data/galaxyDebris.ts`, sizes are radii in Galaxy units; absorbable at size ÷ 0.7). Every type renders a Galaxy Blender prop (by id or `model`; reused props at another size are tinted with `tintAll`) and glows with its own per-part emission (`material.glow` 0.38 × the type's factor). One-offs (‡) are also placed by the map.

| Tier band | Debris (size, mass) | Zones |
|---|---|---|
| 17–18 (arrival, r 0.85–1) | cosmic lint 0.11, red dwarf 0.13, brown dwarf 0.16, comet cloud 0.19, rogue planet‡ (`free_floating_planet`, prop `rogue_planet`) 0.22, white dwarf 0.25, binary star 0.29, space sock‡ 0.33 (masses 1.26–1.5) | stars in the arms and the bar, lint, brown dwarfs and socks in the dust lanes, comet clouds and rogue planets in the halo |
| 18 (Dust Nebula, r 1–3) | sun-like star 0.45, Bok globule 0.5, planetary nebula 0.57, blue giant 0.66, lint cloud 0.75, dark nebula 0.85, red giant 0.95, open cluster 1.05 (masses 2.31–2.9); Oort cloud 1.15, sock nebula 1.25, blue supergiant 1.35 (Tiers 18–19, masses 2.7–2.9) | young stars and open clusters in the arms, globules, lint and dark nebulae in the dust lanes, red giants in the core and the bar, Oort clouds in the halo |
| 19 (Dust Cluster, r ≥ 3) | red supergiant 1.8, emission nebula 2.0, supergiant binary 2.15, stellar nursery 2.3, molecular cloud 2.5, yellow hypergiant 2.6, star cluster‡ 2.8, interstellar lint 3.1 (masses 3.9–4.9); relativistic jet 1.4 (Sagittarius A*'s hit pieces, placed only) | supergiants and nebulae in the arms, star clusters crowding the core and the bar (absorbable from r = 4, about when Sagittarius A* is, so they block its charges for most of the fight), molecular clouds and lint in the dust lanes |

**Galaxy pacing check** (`pnpm sim --area=galaxy --seeds=8`, Hazards on, growth 0.21): Tier 18 at Lint 0:44, Tumble 0:59, Zap 0:36; Tier 19 at 5:34, 6:51, 4:12; Act (arrival to absorbing Sagittarius A*) Lint 6:14, Tumble 7:17, Zap 4:43, 6:07 over all 22 clears (22 wins in 24; the two deaths were to the placeholder Hazards). The groundwork's sparse Tier 18 band took 7:30–12:33; the Tier 18 types are denser, heavier (×1.1, the five biggest a little lighter so Perk-boosted absorb ratios gain less from them) and cover every zone. Growth 0.22 gave 5:36 over all clears (Zap 3:56), 0.2 gave 6:22. Full Runs (`pnpm sim --seeds=6 --minutes=80 --validate`) clear the Galaxy much faster than an `--area` start, as the Solar System does (by Tier 17 a Run carries up to five Gluttons and three Sticky Fibers): Lint 2:37, Tumble 4:42, Zap 2:20 (medians of 3, 2 and 5 clears; the Solar System in the same Runs took 3:29, 4:15, 2:43), and every Run and Area board submission validated (the Galaxy board peaked at 45% of its growth limit, after its rate went from 0.08 to 0.1 units/s: a Zap clear of 52 s had reached 103%). With the real Sagittarius A* fight (`pnpm sim --area=galaxy --seeds=6 --minutes=15`): Tier 19 at Lint 5:28, Tumble 7:13, Zap 4:18; Act Lint 5:58, Tumble 7:47, Zap 4:40; 18 / 18 wins, no deaths. Full Runs (`--seeds=6 --minutes=80 --validate`): Galaxy Act Lint 2:48, Tumble 4:04, Zap 2:00 (3, 2 and 5 clears), Sagittarius A* 10 / 10; one Zap victory in 23:21 reached 104% of the Run board's old 2.5 per second, so it allows 2.8 (all 28 max-Loadout Zap submissions then validated, the Run board at 79%). Full Runs are short here because by the Galaxy a Run carries most of its growth Perks; growth stays tuned for `--area=` starts, which the issue's acceptance names.

| Universe tuning (`AREAS.universe`) | Value |
|---|---|
| Unit | 10 Mly (9.461e24 cm); readout in Mly, `everything` at Tier 21 |
| Arrival radius | 0.85 units (8.5 Mly), the fifth size leap (the Galaxy ends at ≈ 400 ly, ≈ 4e-5 Universe units) |
| Debris Tier band | 20–21 (Tier 20 Dust Singularity at 1 unit, Tier 21 Everything at 3) |
| Growth multiplier | 0.32 |
| Zone density | voids 0.08, sheets 0.45 (`zoneDensity`: the share of spawn attempts kept there) |
| Map | 360 × 360 units on a 3-unit grid: the Voronoi edges of void centres thrown about 66 apart (also 90 past the edge): nodes are `superclusters` (r 4.5–8), the borders between voids straight `filaments` (half-width 2.2–4.6), `sheets` within 7 of a filament's edge, `voids` elsewhere (≈ 53 % voids, 29 % sheets, 14 % filaments, 4 % nodes); no walls, obstacles or exit; `layout.routes` carries the filaments on the map (kind `filament`) |
| Spawn | on a filament near the map's centre, 17 units from a node north of it (the Great Attractor's), a sock 6 units away |
| Voids | slow the Bunny to 0.7 × (`VOID_SLOW`, a `zone:void` speed modifier at `TIMED_PRIORITY` while its centre is in a void) |
| Debris | see the Universe Debris ladder below |
| Look | painted web (`universeTextures.ts`): near-black voids, blue sheets' mist, blue-white filaments with knots, warm gold nodes in violet halos, a tiled field of tiny galaxies; 38,000 web galaxies and 24,000 deep galaxies (parallax) as points, thinned as the camera pulls back; warm glows on the nearest nodes and the key light from the heaviest; a CMB-orange tint at the screen's edges (CSS); the Bunny a cluster of four small black holes in the fur |
| Hazards (`UNIVERSE_DIRECTOR`) | Quasar, Colliding Galaxy, Gamma-ray Burst, Cosmic Void from Tier 20; Dark-energy Gust from Tier 21; the Expansion arrives 4 s after Tier 21 (see the Universe under Hazards) |
| Boss | the Expansion (`THE_EXPANSION`): not a body; a tug-of-war bar (gravity vs expansion) instead of health, a Hubble flow on loose Debris, 7 notches that stick, the Big Rip and the collapse (see the Expansion table above); arrives 4 s after Tier 21; collapsing it wins the Run and drops a Keepsake from its drop table (peak Mythic, 84%) |

**Universe Debris ladder** (`src/data/universeDebris.ts`, sizes are radii in Universe units; absorbable at size ÷ 0.7). Every type renders a Blender prop (the Universe props by id or `model`; the Galaxy's `cosmic_lint`, `space_sock`, `yellow_star` and `emission_nebula`; the House's `couch`) and glows with its own per-part emission (`material.glow` 0.38 × the type's factor; the couch, which has none, a uniform `emissive`). The pale galaxies take `tintAll`, so one prop reads at several sizes and colours. ‡ placed by the map.

| Tier band | Debris (size, mass) | Zones |
|---|---|---|
| 19–20 (arrival, r 0.85–1) | intergalactic lint 0.11, intergalactic star 0.13, hydrogen cloud 0.17, dwarf galaxy 0.22, satellite galaxy 0.27, lost sock‡ 0.33 (masses 1.26–1.5) | everywhere but thinly in the voids (lint, strays and dwarfs) |
| 20 (Dust Singularity, r 1–3) | spiral 0.45, lenticular 0.52, elliptical 0.6, barred spiral 0.68, starburst 0.76, galaxy pair 0.85, radio galaxy 0.95, galaxy group 1.05 (masses 2.31–2.9); filament knot 1.15, someone's couch 1.25 (rare), lint web 1.3, giant spiral 1.35 (Tiers 20–21) | spirals, knots and pairs on the filaments; ellipticals, lenticulars, radio galaxies and groups in the nodes; lint and the couch in the sheets |
| 21 (Everything, r ≥ 3) | galaxy cluster 1.8, giant elliptical 2.0, the Great Attractor‡ 2.2 (placed only, absorbable from r ≈ 3.1), cluster merger 2.3, supercluster 2.6, great wall 2.8, lint supercluster 3.1 (masses 3.9–4.9) | clusters and superclusters in the nodes, the great wall on the filaments |

**Universe pacing check** (`pnpm sim --area=universe --seeds=6 --minutes=15`, Hazards on, the Expansion, growth 0.32): Tier 20 at Lint 0:29, Tumble 0:33, Zap 0:18; Tier 21 at 3:48, 3:58, 2:06; the Expansion (spawn → collapse) 1:14, 1:29, 1:05; Act (arrival to the collapse) Lint 5:04, Tumble 5:20, Zap 3:15; 18 / 18 wins, no deaths, no Big Rips. Growth is a weak knob here (0.30 gave Tier 21 at 3:45, 5:14, 2:10 with the placeholder boss; 0.34 at 3:01, 3:55, 1:58); the supply along the filaments sets the pace, and a Bunny that strays into a void starves and slows. `--area=` starts carry no Perks, so full Runs are faster: `pnpm sim --seeds=4 --minutes=90 --validate` cleared the Universe in Lint 3:10, Tumble 2:30, Zap 1:37 (medians), the Expansion in about 1:00–1:06, and the Bunny ended at 80–146 Mly. Perk-loaded Zap reached 13.9–14.6 units 94 s after arriving, so the Universe board allows 0.25 units/s (a max-Loadout Zap peaked at 98% of 0.2) and the Run board 3.2 per second and the Run board counts a Universe unit past Tier 21 as a tenth (`SCORE_RADIUS_BANDS`).


## Characters

| Character | Fantasy           | Speed | Health | Start radius | Dash CD | Strength | Weakness |
|-----------|-------------------|-------|--------|--------------|---------|----------|----------|
| Lint      | dryer lint, balanced | 1.0 | 3     | 1.0          | 3 s     | no weak spots | no special strength |
| Tumble    | pet-hair tumbleweed  | 0.8 | 5     | 1.2          | 4 s     | tough, knockback resistant | slow, sluggish turning |
| Zap       | static fluff         | 1.3 | 2     | 0.9          | 2 s     | fast, built-in magnet pull | fragile, suction pulls it 1.5× harder |

Each Character has a distinct colour and fur look.

### Abilities

Every Character has its own Ability from the first Run (E, the right mouse button or the touch Ability button). An Ability can stun a boss at most once every 6 s, and landing a hit on a boss always needs contact. Only Keepsakes change how an Ability works; Perks and Shop Upgrades change the Character's stats within its caps.

- **Decoy** (Lint, tap): a lint ball that Hazards aim at; a Hazard that touches it clogs.
- **Amass** (Tumble, hold up to 2 s; cooldown 5 s + 3.5 s per second held, so a tap costs 5 s and a full hold 12 s): Tumble compacts its core into a gravity well.
  - **Pull:** every Debris and non-boss Hazard up to 1.25 × Tumble's radius (r) is pulled in from the whole map, at 8 r/s within 3 r of its centre, falling off to 0.35 of that at the map's farthest corner, leaning 15° off straight inward so it spirals in like an accretion disc. Debris too big to absorb stops at the fur. Anything bigger than 1.25 r, locked Obstacles and bosses only shake in place, so a pull never boxes Tumble in.
  - **While channelling:** 25% of normal speed, no Dash, immune to knockback and pushes, 30% less damage from Hazards, but vacuums and other suction pull 20% harder.
  - **Swallow:** a non-boss Hazard up to 1.15 r that touches Tumble is absorbed (the growth of a normal absorb), bursts into 3 scrap pieces and sends out a shockwave that stuns small Hazards within 2 r for 0.4 s. Their absorb ring lights up while Amass is held.
  - **Bosses:** never pulled. A charging boss that hits an Amassing Tumble crashes as into a wall (stunned, hit at once, 2 extra parts), within the 6 s limit; a hunting boss, or one inside the limit, hits as usual.
  - Replaces **Hunker** (plant in place for up to 10 s), which felt passive in play tests.
- **Discharge** (Zap, tap when the Static meter is full): shorts out the nearest Hazard.

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

Fluff earned per Run ≈ `floor(tierReached × 4 + radius term + debrisAbsorbed / 1000)`, ×1.75 on victory (×1.7 if the galaxy was cleared, ×1.65 if the solar system was cleared, ×1.6 if the globe was, ×1.55 if the continent was, ×1.5 if the region was, ×1.45 if the city was, ×1.35 if the neighborhood was, ×1.25 if only the house was), then × the Difficulty's Fluff multiplier (Arcade ×2, Hardcore ×5). The radius term has no cap: each Area adds its growth measured in its own unit × `AREAS[area].fluffPerUnit` (House 1/30 per cm, Neighborhood 1/60, City 1/120, Region 1.5 per 10 m unit, Continent 1.5 per 10 km unit, Globe 1.5 per 1,000 km, Solar System 1.5 per 0.01 AU and Galaxy 1.5 per 100 ly, each counted from the radius after its leap; about 2 + 3 + 5 + 5 + 5 for a full Run). Targets: a Casual Run that clears the house pays about 40 Fluff, a Casual win about 115 since the Continent (the sim's full Runs: 114–119), Arcade about twice that and Hardcore about 575. Buying every Upgrade (about 1,545 Fluff) takes about 14 Casual wins or 3 Hardcore wins.

## Keepsakes and Felting

Each boss leaves a **Keepsake** in the fur of the Character that absorbed it. Keepsakes modify that Character's Ability (5 types per Character) and have a **rarity**: Common, Rare, Epic, Legendary or Mythic, rolled from the boss's drop table. Data and effect values: `src/data/keepsakes.ts`.

**Drop tables** (`BOSS_DROP_TABLES`, % per rarity; each row sums to 100):

| Act | Boss | Common | Rare | Epic | Legendary | Mythic |
|---|---|---|---|---|---|---|
| 1 | Robo-Vac 9000 | **84** | 10 | 5 | 0.9 | 0.1 |
| 2 | Street Sweeper | 31.4 | **56.6** | 7.9 | 3.5 | 0.6 |
| 3 | Garbage Truck | 7.7 | **56.6** | 28 | 5.8 | 1.9 |
| 4 | Incinerator | 5.6 | 25.7 | **57.5** | 7.7 | 3.5 |
| 5 | Ice Sheet | 4.4 | 8.8 | **73.6** | 8.8 | 4.4 |
| 6 | Orbital Sweeper | 3.5 | 7.7 | **57.5** | 25.7 | 5.6 |
| 7 | The Sun | 1.9 | 5.8 | 28 | **56.6** | 7.7 |
| 8 | Sagittarius A* | 0.6 | 3.5 | 7.9 | **56.6** | 31.4 |
| 9 | The Expansion | 0.1 | 0.9 | 5 | 10 | **84** |

How the rows are built: one falloff by distance from a boss's **peak** rarity (84 / 10 / 5 / 0.9 / 0.1 % at 0–4 rarities away, normalised). The peak moves from Common (Act 1) to Mythic (Act 9) along `peak = 3 + 2·sign(x)·|x|^1.5` with `x = (act − 5) / 4` (1.00, 1.70, 2.29, 2.75, 3.00, 3.25, 3.71, 4.30, 5.00), so Acts 4–6 all peak at Epic. A peak between two rarities blends the two neighbouring peak rows (the Incinerator, peak 2.75, is ¼ the Rare row and ¾ the Epic row). Blending rather than sliding the falloff keeps the chance of "this rarity or better" rising from each boss to the next at every rarity; `src/data/keepsakes.test.ts` checks that, the sums and the symmetry. Until Act 9 ships, Sagittarius A* is the best source of Mythic.

- **Drops:** every boss kill credits 1 Keepsake with a random type (seeded from the Run seed) and a rolled rarity (the seed plus a salt drawn per Run, so replaying a `?seed=` can't farm a lucky Mythic); Hardcore adds 1, with its own rarity roll. Shortly after the kill (once the area-cleared banner is done) the Run pauses on a reveal of what the boss left. On a Character's first kill of a boss the player chooses 1 of 3 offered types there instead (one rarity for all three); the first offer is credited at once, and leaving the reveal locks in the highlighted one. If the Run ends before the reveal shows (a boss that wins the Run), the drop and the choice are on the results screen instead. Keepsakes are credited on the kill, so a Run that then ends in death or a quit keeps them. Runs with `?debug` or started past the house drop nothing. How the boss is beaten (hits or growing) doesn't change the reward.
- **Loadout:** on Character select two slots take Keepsakes from that Character's **Hoard** (both may hold the same type; copies add up). Nothing leaves it during a Run, but an open slot can be filled from the Keepsake reveal: while the Run's Loadout has a free slot, each drop offers **Tuck in** (or T), which puts it in the slot at once for the rest of the Run (a first-kill offer is locked to the highlighted type). A new player with an empty Loadout so plays with the Robo-Vac 9000's Keepsake in their first Run instead of waiting for the next one. The Loadout is remembered per Character on the device (a Keepsake tucked in mid-Run included) and sent with leaderboard entries: the Run board gets the Loadout it ended with, an Area board the one it had when that Area was cleared.
- **Felting** (Under the Couch): 3 of the same type and rarity make 1 of the next rarity for what shedding the three would return, 3 × 40 × r² Fluff (r = the input rarity, 1–4: Rare 120, Epic 480, Legendary 1,080, Mythic 1,920), and only up to one rarity above the peak of the best boss that Character has beaten (Robo-Vac 9000: Rare; Street Sweeper: Epic; Incinerator: Legendary; The Sun: Mythic). **Shedding** discards one for 40 × r² Fluff (Common 40 … Mythic 1,000). Neither counts as Fluff earned.
- **Before rarities** Keepsakes had grades 1–10 named after each boss's filth. Saves, cloud saves and leaderboard Loadouts from then are read two grades to a rarity (1–2 Common, 3–4 Rare, 5–6 Epic, 7–8 Legendary, 9–10 Mythic), counts added together.
- A narrator caption plays when a Keepsake drops and on the first Felting (Settings → Story captions).

### Keepsake effects

Values run from Common to Mythic along `common + (mythic − common) × ((r − 1) / 4)^0.7`: Rare, Epic and Legendary sit at 38%, 62% and 82% of the range. Tumble's Amass Keepsakes use hand-set values per rarity instead (the table lists them). Saves and leaderboard Loadouts holding Hunker-era Keepsakes read them as Lingering Mass (Loose Roots), Collapse (Bristle Back), Feast (Snowball), Dense Core (Dead Weight) and Unmoved (Thick Undercoat), at the same rarity. Two copies of a type add together. Ranges are in Bunny radii (r).

| Character | Type | Common → Mythic | Rare / Epic / Legendary | How it plays |
|---|---|---|---|---|
| Lint | Long Strand | Decoy +1 → +5 s | +2.5 / +3.5 / +4.3 s | Decoy stays out longer (base 4 s). |
| Lint | Quick Shed | cooldown −10% → −45% | −23% / −32% / −39% | Of the base 16 s. |
| Lint | Thick Clog | clog stun +0.4 → +2.0 s | +1.0 / +1.4 / +1.7 s | Bosses get half. |
| Lint | Dinner Bell | wanderers 4 → 12 r; lure range +0% → +60% | 7.0 / 8.9 / 10.5 r; +23 / +37 / +49% | Roomba-type Hazards (Roombas, Robotic Mowers, Floor Scrubbers and the boss minis) within range steer towards the Decoy; every aiming Hazard is lured from its range × (1 + bonus). |
| Lint | Reclaim | fibre worth 1% → 4% of volume | 2.1 / 2.8 / 3.5% | When the Decoy expires, clogs or is shot, lint fibre lands around it; absorbing all of it gives that volume back. |
| Tumble | Dense Core | pull +15% → +65%; core +0.8 → +3.5 r | +25 / +35 / +50%; +1.4 / +2.1 / +2.8 r | Stronger pull, and a wider full-strength core (base 3 r). |
| Tumble | Lingering Mass | channel +0.3 → +1.6 s | +0.6 / +0.9 / +1.2 s | Longer max hold (base 2 s, at most 3.6 s with two copies); cooldown still 5 s + 3.5 s per second held. |
| Tumble | Collapse | 1.6 r / 0.6 s → 4.5 r / 1.6 s | 2.2 r / 0.8 s; 2.9 r / 1.0 s; 3.6 r / 1.3 s | When Amass ends (released or at max hold) the well implodes: every Hazard within the radius of Tumble's surface is stunned that long and non-bosses are knocked back 2.5 r; bosses get half the stun, within the 6 s limit. |
| Tumble | Feast | growth +12% → +60% | +20 / +30 / +42% | Everything absorbed (Debris, swallowed Hazards, scrap) during Amass and 1 s after. A timed effect, above the cap. |
| Tumble | Unmoved | knockback resistance +0.02 → +0.20, suction −3% → −20%; Amass damage −15% more | +0.05 / +0.09 / +0.14; −6 / −10 / −15% | Always on, below the cap. The damage cut is +15% per copy at any rarity. |
| Zap | Live Wire | meter fills +10% → +50% faster | +25 / +35 / +43% | |
| Zap | Long Reach | range +1 → +4 r | +2.1 / +2.8 / +3.5 r | Base 4 r. |
| Zap | Arc | +1 → +3 Hazards | +1 / +2 / +2 | Non-boss Hazards within 4 r of the first target. |
| Zap | Static Cling | magnet +0.1 → +0.6 while the meter is ≥ 50% | +0.29 / +0.41 / +0.51 | Below the cap. |
| Zap | Grounding | suction −2.5% → −10% while the meter is full | −5.3 / −7.1 / −8.6% | Below the cap. |

**Floors** (`KEEPSAKE_FLOORS`), so two copies at any rarity leave the Ability playable:
- The Decoy cooldown is never shorter than the Decoy's duration. Two Legendary Quick Sheds pass it (16 s × 0.23 = 3.7 s becomes 4 s); a Quick Shed beside a Long Strand only when both are Mythic.
- Amass channels at most 3.6 s. Two Legendary Lingering Masses pass it (or a Rare beside a Mythic).

The stat effects (Unmoved, Static Cling, Grounding) are bounded by the caps instead; every other effect stays reasonable at two Mythic copies, so it has no floor.

**Balance check** (`pnpm sim --seeds=60 --minutes=25`, Casual, October 2026). `--loadout=max` is the pair with the most wins over 30 seeds among all 15 pairs per Character at grade 4 of the old 1–10 scale (between Rare and Epic today): Lint Quick Shed + Reclaim, Tumble Snowball ×2, Zap Static Cling + Grounding.

| Character | No Ability: wins / deaths | Ability: wins / deaths, median win, T4 | Max Loadout: wins / deaths, median win, T4 |
|---|---|---|---|
| Lint | 15 / 38 | 27 / 28, 19:51, 5:11 | 26 / 29, 20:34, 5:12 |
| Tumble | 6 / 39 | 7 / 38, 23:18, 6:03 | 13 / 38, 22:03, 6:05 |
| Zap | 28 / 27 | 43 / 16, 15:01, 3:55 | 48 / 12, 14:02, 3:37 |

- A grade-4 Loadout (old scale) adds at most 10 points of win rate (Tumble) and wins at most 7% faster (Zap), inside the limits of +25 points and 15%.
- Every Run board and Area board submission of these Runs passes validation. The closest any came to the growth limit was 66% of the allowance (a Zap City clear).
- With Mythic max Loadouts on full Runs (`pnpm sim --seeds=6 --minutes=80 --validate --loadout=max`, October 2026), 103 of 104 submissions pass; Zap's Run board peaks at 95% of `maxGrowthPerSec`. The one rejection is Zap s3's Globe board (`AREA_RADIUS` cap of 30 units, reached at 30.8 after the bot spent 9 minutes at Tier 15 before absorbing the Orbital Sweeper). The same seed fails the same way on grade-10 Keepsakes before rarities, so it comes from lingering in the Globe, not from the rarities.
- Zap still has the fastest Tier 4. Tumble does **not** have the fewest deaths: the bot dies to Upright Vacuums and Spray Bottles at Tiers 3–4, and Tumble is too slow to leave a vacuum cone. This was already true before Keepsakes and Abilities (no Ability: Lint 38, Tumble 39, Zap 27 deaths).
- Every Loadout with Thick Undercoat cost the bot deaths (17–21 against 15 per 30 seeds). The likely cause is that with less knockback the bot stays in contact with Hazards longer. Worth watching in real play.

**Amass check** (October 2026, after Amass replaced Hunker; `pnpm sim --chars=tumble --seeds=12 --minutes=25 --validate`, the default `feed` policy: Amass for boss charge lanes, a swallowable Hazard within 3 r, or 14+ absorbable Debris within 8 r). The pull speed was tuned on 6 seeds over 10 minutes (Tier 4 median: 8 r/s 1:40, 4 r/s 2:54, 2.5 r/s 4:17, 1.5 r/s 5:05; Lint 5:10, Zap 3:43, Hunker Tumble 7:20) and set to 2 r/s, between Zap and Lint.

| Tumble | Tier 4 | House clears | Deaths | Furthest boss beaten |
|---|---|---|---|---|
| Hunker (before) | 6:57 | 7 / 12 | 5 | Garbage Truck (4 / 4) |
| Amass, no Keepsakes | 4:37 | 10 / 12 | 3 | Orbital Sweeper (4 / 5) |

All 64 leaderboard submissions passed; the closest came to 57% of the growth limit (city board). The Hunker-era max Loadout search is out of date: `--loadout=max` gives Tumble Feast + Dense Core until it is re-run.
