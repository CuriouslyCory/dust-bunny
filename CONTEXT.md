# Dust Bunny — Domain Glossary

- **Bunny** — the player character: a fuzzy sphere of dust. Its size is its **radius** (world units are centimetres).
- **Character** — one of three starting Bunny archetypes chosen before a Run (Lint, Tumble, Zap). Each has different base stats.
- **Run** — one play session from spawn to death or victory (absorbing the Garbage Truck, the City boss). Runs are procedurally generated from a seed.
- **Debris** — any floor object the Bunny can absorb once it is big enough (lint, staples, coins, socks, shoes, chairs…). Do not call it "food" or "loot".
- **Absorb** — the act of the Bunny picking up Debris (or a shrunken Hazard). Absorbed Debris sticks visibly to the Bunny and adds mass.
- **Absorb ratio** — the largest Debris size the Bunny can absorb, as a fraction of its radius (default 0.7).
- **Obstacle** — Debris or furniture too big to absorb; it blocks movement.
- **Area** — the world a Run is in: first **the House**, then **the Neighborhood** (the street outside, reached through the **front door** once the Robo-Vac 9000 is absorbed), then **the City** (reached through the **road barrier** at the end of the main street once the Street Sweeper is absorbed). Outdoors, **zones** (yard, street, sidewalk, driveway, park; in the city avenue, pavement, plaza, parking, square) take the place of rooms.
- **Tier** — a growth stage (Speck, Fluff, Tumbleweed, Dust Devil, Dust Titan in the House; Dust Storm, Dust Cyclone in the Neighborhood; Dust Hurricane, Dust Colossus in the City). Crossing a Tier threshold widens the camera view, unlocks new areas of the floor, and offers a Perk draft.
- **Hazard** — a roaming cleaning device or supply (Roomba, Lint Roller, Broom, Spray Bottle, Mop, Upright Vacuum, Robo-Vac 9000 boss; outdoors: Robotic Mower, Lawn Mower, Leaf Blower, Sprinkler, Street Sweeper boss; in the city: Floor Scrubber, Pressure Washer, Litter Vacuum, Street Flusher, Garbage Truck boss) that damages the Bunny. Hazards small enough relative to the Bunny can be absorbed.
- **Health** — whole hit points shown as hearts. Reaching zero ends the Run.
- **Pickup** — a temporary, timed power-up found on the floor during a Run (Static Charge, Sugar Rush, Bubble Wrap, Glue Dab, Crumb Cake, Dust Cloud).
- **Perk** — a run-long upgrade chosen from a draft of three at each Tier-up. Lost when the Run ends.
- **Upgrade** — a permanent meta-progression improvement bought in the Shop with Fluff. Persists across Runs.
- **Fluff** — the meta currency earned at the end of each Run.
- **Dash** — a short speed burst on a cooldown.
