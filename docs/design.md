# Dust Bunny — Game Design

Terms follow `CONTEXT.md`. Numbers below are starting points; tune them in the data files, not in logic.

## Pitch

Katamari-style growth roguelike on a house floor, rendered in three.js. You start as a 1 cm Speck under the couch, absorbing lint and staples. Every Tier you grow into pulls the camera back, reveals more of the house, and turns former Obstacles into Debris. Roombas, lint rollers, brooms, and other cleaning gear roam the floor and hurt you, until you are big enough to absorb them too. Final goal: absorb the Robo-Vac 9000 boss.

Target: a 10–15 minute demo-quality house, a 5–8 minute neighborhood, then a 7–10 minute city finale, playable on desktop (keyboard/mouse) and mobile (touch).

**Neighborhood phase.** Absorbing the Robo-Vac 9000 no longer ends the Run: the front door at the end of the hallway swings open and a door compass points to it, with a skip button (Enter on a keyboard) that moves on from wherever the Bunny is, so a Bunny too big to reach the door is never stuck. Rolling out of it fades into a seeded suburban street (about 96 × 72 m: a main street and a cross street, seven houses with yards and driveways, a park). Outdoor Debris runs from pinecones and garden gnomes up to bikes, picnic tables and parked cars; houses and big trees stay Obstacles. Absorbing the Street Sweeper (arrives at Tier 7) lifts the road barrier at one end of the main street.

**City phase.** Rolling through the barrier fades into a seeded city at golden hour (about 320 × 240 m: three avenues and four streets with sidewalks and crosswalks, office towers and plazas downtown, apartments, shop rows and brick lofts further out, two parking lots, a park square with a fountain). City Debris runs from trash bags, parking meters and phone booths up to taxis, food trucks, fountains, buses, fire trucks and shipping containers; buildings stay Obstacles and fade when they hide the Bunny. Absorbing the Garbage Truck (arrives at Tier 9) wins the Run.

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
| 9 | Dust Colossus | 600+           | buses, fire trucks, cement mixers, trams, shipping containers, the Garbage Truck | the whole city |

Camera distance and fog distance scale with radius so the visible floor area grows each Tier. Areas are gated physically: e.g. the gap under the couch skirt and closed doors are passable/absorbable only at certain sizes.

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

A Hazard whose size ≤ radius × absorb ratio becomes Debris: touching it absorbs it for a big mass gain. Absorbing the Robo-Vac 9000 opens the front door to the neighborhood, the Street Sweeper opens the road to the city, and absorbing the Garbage Truck wins the Run.

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

Fluff earned per Run ≈ `floor(tierReached × 4 + min(maxRadius, 300) / 30 + debrisAbsorbed / 1000)`, ×1.5 on victory (×1.35 if the neighborhood was cleared, ×1.25 if only the house was), then × the Difficulty's Fluff multiplier (Arcade ×2, Hardcore ×5). Targets: a Casual Run that clears the house or wins pays about 40–80 Fluff (one base-level Upgrade), Arcade 80–160, Hardcore 300–400 for Runs that reach the city. Buying every Upgrade (about 1,545 Fluff) takes about 20 Casual wins or 4 Hardcore wins.

## Keepsakes and Felting

Each boss leaves a **Keepsake** in the fur of the Character that absorbed it. Keepsakes modify that Character's Ability (5 types per Character) and have a **grade** set by the boss: 1 Brush Tangle (Robo-Vac 9000), 2 Gutter Grit (Street Sweeper), 3 Hopper Gunk (Garbage Truck), up to 10 First Dust (Felting only). Data and effect values: `src/data/keepsakes.ts`.

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
