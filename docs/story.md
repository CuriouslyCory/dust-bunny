# Dust Bunny — Story

Terms follow `CONTEXT.md`; Tier/Area numbers follow `docs/design.md`. This doc is the storyboard for the storyline and the plan for weaving it into play. Nothing here changes a gameplay number: the story is dressing on top of the existing loop, and every piece of it is skippable.

## Premise

People drop things. They drop so many things, for so long, in so many places, that under one particular couch the dropped things reach a density the universe has no procedure for. Chaos plus quantum physics does the rest. A dust bunny wakes up. It has exactly one instinct: **grow**.

The cleaning crew (Roombas, brooms, sweepers, garbage trucks, and eventually glaciers, suns and the expansion of space itself) is the universe's immune response. It is never enough, because nothing was ever picked up.

The run ends when everything that was ever dropped is in one place, which turns out to be how universes start. A planet cools. Something clever discovers fire. It drops its wrapper.

## Voice and rules

The narrator is **deadpan**: a nature documentary that has stopped being surprised. Short declarative sentences, present tense, no exclamation marks, no jokes that announce themselves. The humour is in the gap between the scale of what is happening and the flatness of the report. The Bunny never speaks and is never given thoughts beyond its one instinct.

Rules for every story element:

- **Two lines maximum, ~140 characters per caption.** A longer beat is split into captions shown in sequence (boss intros below are usually two).
- **Never block input that isn't already blocked.** Story rides on moments the game already pauses (Perk draft, Area fade, results) or on passive banners. The only new stops are the intro, the chapter card on an Area change and the ending, all skippable with Space / Enter / tap.
- **Skippable and silenceable.** A `Story captions` toggle in Settings (default on). Speedrunners and `?autostart` see none of it.
- **Variations, not repeats.** Each beat has 2–4 alternate lines; the Run's seeded RNG picks one, so a tenth run still reads fresh.
- **Captions appear whole.** No typewriter effect (deadpan arrives all at once). Fade in 200 ms, hold, fade out 300 ms. Respect `reduced motion`.
- **Paced for a 10-year-old reader.** Narration that leaves the screen without input stays up for at least 100 words per minute (0.6 s a word) plus 0.5 s to find it, never less than 2.5 s and with no upper cap (`captionHold` in `src/story/narrator.ts`). A chapter card's first caption also covers its title; an intro panel's second caption waits until the first has been read. Status text (absorb toasts, Pickups, combat banners) is not narration and keeps its own timing. Faster readers aren't held to it: every in-play banner has a ✕ (Enter on a keyboard) that dismisses it, caption and all, and on phones banners are about half size and sit above the Bunny.

## The arc at a glance

| Act | Area | Tiers | Boss (cleaning crew) | Chapter title | What the narrator is reporting |
|---|---|---|---|---|---|
| 1 | The House | 1–5 | Robo-Vac 9000 | *Under the Couch* | Something woke up |
| 2 | The Neighborhood | 6–7 | Street Sweeper | *The Front Door Was Built for People* | It got out |
| 3 | The City | 8–9 | Garbage Truck | *Where People Drop Things Professionally* | Local news notices |
| 4 | The Region | 10–11 | The Incinerator | *A State of Emergency* | Government notices |
| 5 | The Continent | 12–13 | The Ice Sheet | *Plate Tectonics, Before Lunch* | The planet notices |
| 6 | The Globe | 14–15 | Orbital Sweeper | *The Marble* | Humanity's last appliance |
| 7 | The Solar System | 16–17 | The Sun | *A Very Large Leaf Blower* | Physics notices |
| 8 | The Galaxy | 18–19 | Sagittarius A* | *The Biggest Vacuum There Is* | It becomes the thing it fears |
| 9 | The Universe | 20–21 | The Expansion | *One Place* | Everything, then nothing, then everything |
| — | Epilogue | — | — | *The End?* | A biped, a fire, a wrapper |

All nine Acts exist, with their story in the game: Act 8 (the Galaxy) with its spiral disc, black-hole Bunny and Sagittarius A*, and Act 9 (the Universe) with the cosmic web, the Bunny as a cluster of black holes, the Expansion's tug-of-war fight and the ending sequence (`src/data/story.ts`, `src/story/`; see Story in `docs/architecture.md`; each Act's tuning is in `docs/design.md`). They were tracked as #24 (Region, with the unit re-basing and pacing groundwork), #25 (Continent), #26 (Globe), #27 (Solar System), #28 (Galaxy) and #29 (Universe and the ending); the diegetic intro is #30.

---

## Intro sequence

Plays once per save on the first `Play` (stored as `introSeen` in settings) while Story captions are on, after character select, and from `Settings → Replay intro` on the title (which starts a new Run with it, captions on or off; with them off the shots play without the words). Skipped by `?autostart` (which also hides Replay intro), and by Runs that start outside the House. Space / Enter / tap advances a panel; holding skips the whole thing. Total length ~38 s unskipped (the ~s column below is the authored minimum; panels hold longer when their captions need it to be read at 100 WPM).

**It is diegetic.** The intro is a scripted camera move inside the real Run, not a separate cutscene: the Run is created, the camera starts at human eye height, and it dives under the couch to the actual spawn point where the Bunny's eyes open and the player gets control. The transition from story to gameplay is a single continuous shot.

| # | Shot | Caption | Sound | ~s |
|---|---|---|---|---|
| 1 | Black. Fade up on the living-room floor from standing height (out in the room, looking at the floor in front of one end of the couch), soft afternoon light, the couch at frame left. Nothing moves. | *This is a floor.* | Room tone. Clock. | 3 |
| 2 | Same shot; the lens pushes in slowly. Things fall into frame and land: a crumb, a staple, a coin that rolls and settles, a sock that just drops. Each lands with a small dust puff (existing particle system). | *Every day, people drop things on it.* | Tick · tink · thud, dry and close. | 4 |
| 3 | A pair of slippers steps through frame, over the debris, and out along the couch, between it and the coffee table. The debris stays. | *Nobody picks them up.* | Footsteps, receding. | 3 |
| 4 | Camera lowers and pushes toward the gap under the couch skirt. The dark under there is full of lint. A faint shimmer runs across it (reuse Zap's `glow`). | *Under the couch, the dropped things reach a density the universe has no procedure for.* | Low hum rises. | 4 |
| 5 | Hold on the lint pile. The shimmer gathers. Two eyes blink open in it. | *Physics does not have an explanation for what happens next.* <br> *Physics has decided not to look.* | Hum cuts to silence on the blink. | 4 |
| 6 | Camera settles into the normal gameplay distance for Tier 1 (`cameraScale` 13). HUD fades in around the frame. | *It has one instinct.* <br><br> **Grow.** | A single soft bass note. Music loop starts on "Grow." | 3 |
| 7 | Control unlocks. No further text; the first Debris absorbed pops the ordinary `+ Lint!` toast. | — | — | — |

Notes: shot 2 is the thesis of the whole game and should be the most carefully animated thing in the intro. Shots 1–3 are one camera position, worked out from wherever the couch is (`src/story/introScript.ts`); the lens pushes in during shot 2 so things the size of a crumb read from standing height. The dropped things are real Debris once they settle and stay for the Run. Advancing early lands whatever is still falling and lets the camera catch up; skipping always ends at the Tier 1 gameplay camera with control unlocked. With reduced motion the camera does not travel: it holds the close framing for shots 1–3 and cuts through black to the lint pile (shot 4) and to the gameplay camera (shot 6).

---

## Progression beats

Two kinds, both short:

1. **Tier beats** — one narrator line on every Tier-up. Shown as a caption in the header of the Perk draft modal (the game is already paused and the player is already reading). When there is no draft pending (every Perk owned), the line goes in the existing Tier-up banner's subtitle instead.
2. **Area beats** — a chapter card on every Area change. The `areaEntered` fade grows from a quick dip to a 2.5 s black card with the chapter title and one line, skippable. The `exitOpened` ("House cleared!") banner keeps its headline and gets a narrator subtitle. Boss arrival (`bossSpawned`) opens a boss intro card that pauses the Run and introduces the boss in the same voice.

Lines below are the primary variant; alternates live in `src/data/story.ts`.

### Act 1 · The House — *Under the Couch*

| Beat | Line |
|---|---|
| Tier 1 → 2 (Fluff) | *It has eaten a staple. It feels nothing about the staple. It wants another.* |
| Tier 2 → 3 (Tumbleweed) | *Coins are now Debris. The economy has not been informed.* |
| Tier 3 → 4 (Dust Devil) | *The mystery of the missing socks is solved. No one will ever know.* |
| Tier 4 → 5 (Dust Titan) | *The house has noticed. The house has sent the vacuum.* |
| Robo-Vac 9000 arrives | *The Robo-Vac 9000 was built for exactly this. It was not built for exactly this much.* |
| House cleared (`exitOpened`) | *The front door was built for people. It is not clear that a dust bunny is not a person.* |

### Act 2 · The Neighborhood — *The Front Door Was Built for People*

| Beat | Line |
|---|---|
| Area entered | *It rolls outside. The outside is also a floor.* |
| Tier 5 → 6 (Dust Storm) | *Garden gnomes. Mailboxes. A bicycle someone was going to fix. Nothing is spared, because nothing was ever picked up.* |
| Tier 6 → 7 (Dust Cyclone) | *The homeowners' association has filed a complaint. The complaint is absorbed.* |
| Street Sweeper arrives | *The city sends a Street Sweeper. It is the biggest broom it owns.* |
| Neighborhood cleared | *The road barrier was meant to keep traffic out. Traffic was never the problem.* |

### Act 3 · The City — *Where People Drop Things Professionally*

| Beat | Line |
|---|---|
| Area entered | *The city is where people go to drop things professionally.* |
| Tier 7 → 8 (Dust Hurricane) | *Local news calls it "a weather event." Local news is parked on 5th Street. Local news is absorbed.* |
| Tier 8 → 9 (Dust Colossus) | *Pedestrians are advised to remain indoors. Indoors is advised to remain pedestrians.* |
| Garbage Truck arrives | *The Garbage Truck is the largest thing people built to make dropped things go away. It is about to learn where they go.* |
| City cleared | *The city is gone. The thing that used to be a dust bunny rolls on. There is more ground.* |

> Absorbing the Garbage Truck opens the highway on-ramp (the City cleared line plays on its banner). `victory` comes when the Expansion collapses at the end of Act 9, and the ending plays before the results.

### Act 4 · The Region — *A State of Emergency*

Several cities, the highways between them, farmland, a landfill. Seen from a few kilometres up. The run's first "the world is smaller than you thought" moment: whole towns are Debris.

| Beat | Line |
|---|---|
| Area entered | *From up here the cities look like crumbs. They are, from its point of view, crumbs.* |
| Tier 9 → 10 (Dust Sprawl) | *It has eaten a town. The town was, by most accounts, fine.* |
| Tier 10 → 11 (Dust Front) | *Regional authorities declare a state of emergency. The state is absorbed.* |
| The Incinerator arrives | *At the landfill stands the Incinerator, the last machine built for this exact problem. It burns things so they go away. It is about to learn where they go.* |
| Region cleared | *Satellite imagery shows a grey smear moving west. The satellites are next.* |

> Absorbing the Incinerator opens the motorway west (the Region cleared line plays on its banner); the Bunny leaves along it and arrives on the Continent after the size leap.

### Act 5 · The Continent — *Plate Tectonics, Before Lunch*

The whole landmass from the stratosphere; the horizon curves. Debris: mountain ranges, lakes, what is left of the cities. Hazards are weather: the planet has run out of machines and is using what it has.

| Beat | Line |
|---|---|
| Area entered | *The planet has run out of machines. It falls back on weather.* |
| Tier 11 → 12 (Dustmass) | *There is a word for a dust bunny the size of a country. The word has not been invented. Everyone who might invent it is busy.* |
| Tier 12 → 13 (Dust Pangaea) | *Plate tectonics usually takes two hundred million years to move this much material. It did it before lunch.* |
| The Ice Sheet arrives | *The planet tries the oldest cleaning method it knows: ice. It worked on the mammoths.* |
| Continent cleared | *There is no more land. There is, however, up.* |

### Act 6 · The Globe — *The Marble*

Black sky, starfield, the Earth's limb below. Debris: islands, oceans, the Moon, satellites. The Bunny is lit from one side by the Sun and from below by Earth-shine.

| Beat | Line |
|---|---|
| Area entered | *It leaves the atmosphere. The atmosphere does not try to stop it. The atmosphere is also Debris.* |
| Tier 13 → 14 (Dust Moon) | *It has absorbed the Moon. The tides have questions.* |
| Tier 14 → 15 (Dust Planet) | *From orbit, Earth is a pale blue marble. It is the marble now.* |
| Orbital Sweeper arrives | *Humanity's final appliance is, fittingly, a vacuum cleaner for space. Humanity is, at this point, mostly absorbed. They would have wanted it this way. They would not have, actually.* |
| Globe cleared | *Earth is gone. This is reported by no one.* |

### Act 7 · The Solar System — *A Very Large Leaf Blower*

The ecliptic plane: conveniently flat. Debris: asteroids, comets, moons, planets. Jupiter is an Obstacle until Tier 17 and stuns the boss's charges. Voyager 1 is a one-off tiny Debris with its own line.

| Beat | Line |
|---|---|
| Area entered | *The solar system is a disc of leftover dust that never got picked up. It feels at home.* |
| Tier 15 → 16 (Dust Giant) | *It eats Mars. Mars was supposed to be the backup plan.* |
| Tier 16 → 17 (Dust Star) | *Jupiter has spent four billion years vacuuming up comets so Earth wouldn't have to. Jupiter is absorbed by a dust bunny. Irony is not a force of nature. It should be.* |
| Voyager 1 absorbed (one-off) | *Voyager 1 carried a golden record of humanity's greatest achievements. It is now, technically, inside a dust bunny.* |
| The Sun arrives | *The Sun has been blowing dust out of the solar system for 4.6 billion years. It is a very large leaf blower. It is also, technically, Debris.* |
| Solar System cleared | *The light goes out. It does not need the light.* |

> Absorbing the Sun opens the heliopause, a gate on the ecliptic's north edge (the way Voyager 1 went), onto the Galaxy; the light still goes out, and the cleared line plays on the exit's banner.

### Act 8 · The Galaxy — *The Biggest Vacuum There Is*

The galactic disc: also flat. Debris: stars, star clusters, nebulae, rogue planets. Black holes appear as Hazards (suction, the purest vacuum) and foreshadow what the Bunny is becoming. A rogue planet drifts beside the arrival point, a one-off with its own line (any rogue planet, the first absorbed), and a sock floats nearby for the Tier 18 line. After Sagittarius A* the Bunny's look changes for the rest of the Run: a dark core, an accretion disc of lint, a lensing shimmer; the eyes stay.

| Beat | Line |
|---|---|
| Area entered | *Astronomers on a distant world classify it as a nebula. They are not wrong.* |
| Tier 17 → 18 (Dust Nebula) | *It is now mostly hydrogen, lint, and a sock.* |
| Rogue planet absorbed (one-off) | *A rogue planet, drifting between stars for a billion years. Finally, something happens to it.* |
| Tier 18 → 19 (Dust Cluster) | *The Milky Way contains between 100 and 400 billion stars. It is going to find out exactly how many.* |
| Sagittarius A* arrives | *At the centre of the galaxy is a hole four million times heavier than the Sun. It has been quietly cleaning the galactic core for thirteen billion years. It is the biggest vacuum there is. It is not big enough.* |
| Galaxy cleared | *It has absorbed the thing that absorbs things. It is now that thing, with fur.* |

### Act 9 · The Universe — *One Place*

The cosmic web as a floor: filaments of galaxies, dark voids between. The Bunny is a cluster of supermassive black holes with lint caught between them. The boss is not a chaser: the Expansion pushes every piece of Debris outward, and the player has to out-absorb it until gravity wins.

| Beat | Line |
|---|---|
| Area entered | *Everything that was ever dropped is out here somewhere. It intends to check.* |
| Tier 19 → 20 (Dust Singularity) | *It has stopped being a dust bunny in any sense a dust bunny would recognise. It does not recognise anything. It has one instinct.* |
| Tier 20 → 21 (Everything) | *Everything that was ever dropped is here now. Everything that was ever dropped is it.* |
| The Expansion arrives | *The universe has one cleaning method left: spread everything out so thin that nothing is anywhere. Given enough time it always works. It does not have enough time.* |
| Victory | → Ending sequence |

---

## Ending sequence

Triggers on absorbing the Expansion, before the results screen. ~30 s, skippable after shot 3 (the Bang should land once).

Status: built (`ending` screen, `STORY.ending`, `src/fx/ending.ts`, `src/audio/ending.ts`; see Story in `docs/architecture.md`), a Universe victory routes to it through `afterRunEnded` once the cleared line has been read; `__game.debugTools.playEnding()` plays it on demand.

| # | Shot | Caption | Sound | ~s |
|---|---|---|---|---|
| 1 | The last galaxy filament is absorbed. The Bunny fills the frame; the starfield behind it is empty. Camera slowly pushes in. | *Everything is in one place.* | Music thins to a single held note. | 4 |
| 2 | Push in continues into the dark core until the screen is black. | *This has happened before.* | The note stops. True silence. | 3 |
| 3 | **Bang.** White frame, then a burst of particles outward from centre (the title screen's dust motes, thousands of them, fast). | — | One enormous soft thump; a long shimmer tail. | 3 |
| 4 | Time-lapse: motes gather into swirls, swirls into a disc, a glowing ball in the disc cools from white to orange to grey. Blue creeps across it. Then green. | *Eventually, somewhere, a planet cools.* | Music returns, quiet, the Tier 1 theme. | 6 |
| 5 | Cut to a shore. Low poly, cozy, same art direction as the house. A biped squats with two rocks. Strikes them. A small fire. It looks pleased. | *Eventually, something clever figures out fire.* | Rocks clacking; fire crackle. | 5 |
| 6 | It roasts something on a stick. Eats it. Drops the stick on the ground and walks off. Camera pushes in on the stick on the ground. | *It does not pick up after itself.* | Footsteps, receding. Same cue as intro shot 3. | 4 |
| 7 | Hold on the stick. In the dirt beside it, almost nothing: a speck of something fuzzy. | — | Room tone. A faint hum. | 2 |
| 8 | Title card, cream on black: **The End** | — | — | 2 |
| 9 | Same card. A **?** fades in after the period. Then **…** | — | A single staple landing, very small. | 3 |
| 10 | Fade to results. | — | — | — |

After the first ending, the title screen's tagline changes to *Universe 2 · Roll. Absorb. Grow.* and the save stores `universes`. The leaderboard and results get a "Universes" stat. It is the only permanent mark the story leaves: proof you've done it, and a joke that gets drier every time the number goes up.

---

## How it looks in play

### Delivery surfaces (what hangs where)

| Moment | Existing hook | Story element | Shape on screen |
|---|---|---|---|
| First Play | `playFromMenu` → `intro` screen (`simulate: false`) | Intro panels 1–7 | Today: static cards over the dust motes. Diegetic (#30): lower-third caption, full-bleed scene |
| Tier-up | `tierUp` → `perkDraft` modal | Tier beat | One italic line under the modal's title: "Tier 4 · Dust Devil — *The house has noticed…*" |
| Tier-up, no draft left | `tierUp` → `hud.banner` | Tier beat | Banner subtitle |
| Boss arrives | `bossSpawned` → `bossIntro` screen | Boss intro | Card: "⚠ Boss incoming" tag over the turning boss model, boss name, description, the line in italics, hits; held for the reading time at 100 WPM |
| Area cleared | `exitOpened` → `hud.banner` ("House cleared!") | Clear line | Replaces the current "The front door is open" subtitle; the compass still shows the way |
| Area entered | `areaEntered` → `chapter` screen | Chapter card | Dark card for the line's reading time (the Run waits behind it); "Chapter N" (small caps), amber rule, title, line; Space/Enter/tap cuts it short, then the card fades off the new Area |
| One-off Debris (Voyager, the Moon…) | `debrisAbsorbed` with a `STORY.debris` entry, first time per Run | Easter-egg line | Banner `+ Voyager 1` with the line as its caption |
| Death | `runEnded` (`died`) → results | Where the story stopped | Results sub-line: "Swept up in Chapter 3 · *Where People Drop Things Professionally*" ("Stopped in…" for a quit Run; until #29, a win shows the last Area's cleared line) |
| Victory | `victory` → new `ending` screen → results | Ending panels | Full screen, then results |
| Title after a win | `title` screen `enter()` | Universe counter | Tagline swap |

Caption styling matches the HUD and screens: Nunito 800 italic for narrator lines, Fredoka for chapter titles, cream `#fff7ec` on the dark `rgba(42,29,23,…)` card the HUD pills already use, a thin amber `#f6b860` rule above the chapter title. No portrait, no speaker label, no typewriter.

### Data shape

```ts
// src/data/story.ts
export type StoryLine = string | readonly string[];  // one caption, or captions shown in turn
export interface StoryPanel { caption: string; caption2?: string; hold: number }
export interface AreaStory { title: string; entered: StoryLine[]; cleared: StoryLine[]; boss: StoryLine[] }
export const STORY: {
  intro: StoryPanel[];
  tiers: Record<string, StoryLine[]>;        // keyed by Tier id; variants
  areas: Record<AreaId, AreaStory>;          // a new AreaId doesn't compile without its chapter
  debris: Record<string, StoryLine[]>;       // one-offs, keyed by Debris type id
};
// The ending's panels join STORY with Act 9 (#29), played by the same `storyCards` player as the intro.
```

The `story` module (`src/story/`) picks a variant from the Run seed and the beat (`pickLine`), says whether the narrator speaks (`narrate`: off with the setting or `?autostart`) and owns the intro and chapter screens; the existing banners, Perk draft header and results screen host the other lines. Tests: every Tier after the first and every Area has lines; no caption exceeds 140 characters; the chosen variant is deterministic for a seed.

### Scale without breaking floats

World units are centimetres and the Bunny ends the City at r ≈ 800 cm. Acts 4–9 don't extend that number; each Area declares a **unit** and the Run re-bases on entry, exactly as the camera already pulls back on Tier-up:

| Area | 1 world unit = | Arrival radius (units) | Tier thresholds (units) | HUD readout |
|---|---|---|---|---|
| Region | 10 m | ~0.85 (re-based, same real size) | 10: 1 · 11: 3 | `8.5 m` → `40 m` |
| Continent | 10 km | 0.85 (the size leap) | 12: 1 · 13: 3 | `8.5 km` → `45 km` |
| Globe | 1,000 km | 0.85 (the second size leap) | 14: 1 · 15: 3 | `0.13 Earths` → `≈ 0.6 Earths` (Earth radii: 1 unit = 0.157 Earths) |
| Solar System | 0.01 AU | 0.85 (the third size leap) | 16: 1 · 17: 3 | `0.0085 AU` → `≈ 0.04 AU` |
| Galaxy | 100 ly | 0.85 (the fourth size leap) | 18: 1 · 19: 3 | `85 ly` → `≈ 450 ly` |
| Universe | 10 Mly | ~1 | 20: 1 · 21: 3 | `30 Mly` → `everything` |

The Region ends at ≈ 40 m, far below 1 Continent unit, so the Continent declares an arrival radius (and the Globe another: the Continent ends at ≈ 45 km, 0.045 Globe units; and the Solar System a third: the Globe ends at ≈ 4,500 km, 0.003 Solar System units; and the Galaxy a fourth: the Solar System ends at ≈ 0.045 AU, ≈ 7e-9 Galaxy units) and the Bunny leaps to it off screen behind the chapter card (`docs/design.md`, "The size leap"). Every Act after the City is "start at ~1, grow to ~3, boss at Tier +1" in its own units, which is the House's Speck→Fluff curve, so Hazard sizes, absorb ratios and camera scales all reuse the same shape. The only new code is the unit ladder for the radius readout, which is itself a running gag: the progress pill goes from `1.47 / 3 cm` to `1.47 / 3 Earths` without changing layout.

### The floor stays a floor

The game is a 2D plane and the later Areas are chosen so that stays true: a Region and a Continent are maps; the ecliptic and the galactic disc are literally flat; the cosmic web reads fine as a plane of filaments. The one awkward case is the Globe. Recommended: a flat, wrap-around map (roll off the east edge, arrive from the west) with the curvature sold by the sky, the lighting and the chapter card's artwork rather than by real spherical geometry. The sphere appears for real only in ending shot 4.

### Look per Area (sky, light, Bunny)

| Area | Sky and light (`game.ts` / `lighting.ts`) | Floor | Bunny look (`BunnyView`) |
|---|---|---|---|
| Region | Overcast noon from altitude; soft shadows; haze at distance | Patchwork fields, highways as lanes, river as a wet trail | Fur with rooftops and cars stuck in it |
| Continent | Dusk from the stratosphere; horizon curve in the fog colour; long shadows | Terrain relief, coastlines, snow caps | Fur with mountain peaks poking out |
| Globe | Black sky, starfield, blue Earth-shine from below, hard sun from one side | Wrap-around map, ocean specular | Faint atmosphere glow; the Moon as a visible lump |
| Solar System | Point light at the Sun; lens bloom; dust-lane backdrop | Faint orbit rings as "lanes"; asteroid belt as a cluttered zone | Begins to glow from within (plasma) |
| Galaxy | Nebula skybox, cool blues and magentas; stars as instanced points | Spiral-arm lanes, dark dust lanes between | Dark core appears after Sagittarius A*; lint accretion disc; lensing shimmer |
| Universe | Near black; faint filaments of light; CMB-orange tint at the edges | Cosmic web: bright filaments, empty voids that slow | A cluster of black holes with fur between them; eyes still there |

The eyes stay the whole way. That is the one visual rule: however cosmic it gets, it is still the thing from under the couch.

### Hazards and bosses per new Area (sketch)

Each later Area reuses one of the five existing Hazard behaviours (wanderer with pull, lane patrol, turret, trail-layer, cone blaster) and one boss state machine, reskinned. Names first; numbers later in `docs/design.md`.

| Area | Wanderer (Roomba) | Lane patrol (Lint Roller / Mower) | Turret (Spray Bottle) | Trail (Mop / Flusher) | Cone (Leaf Blower / Litter Vac) | Boss |
|---|---|---|---|---|---|---|
| Region | Landfill Compactor | Freight train, Snowplow | Crop duster | River barge (wet trail) | Water bomber | **The Incinerator** — rail-mounted waste plant; feed conveyor pulls, chimney fires ash (sheds mass); stunned when it charges into a city; summons mini compactors |
| Continent | Tornado | Glacier tongue | Volcano | River | Hurricane | **The Ice Sheet** — slow, enormous, pushes everything in front of it; stunned only by mountain ranges; hits calve off absorbable icebergs |
| Globe | Debris-field satellite | Space station in orbit lane | Anti-satellite laser | Re-entry burn (fire trail, sheds mass) | Hurricane seen from above | **Orbital Sweeper** — net-and-laser cleanup satellite; charges; stunned by the Moon; summons a Kessler swarm of mini sweepers |
| Solar System | Rogue asteroid | Comet (ice-tail trail) | Pulsar-like flare from the Sun | Comet tail | Solar flare | **The Sun** — CMEs as telegraphed charges; solar wind as a constant push; stunned when it charges into Jupiter (eclipse); hits knock prominences loose |
| Galaxy | Black hole (strong suction, the real vacuum) | Globular cluster orbit | Pulsar (rotating beam) | Supernova remnant (slow) | Supernova (blast) | **Sagittarius A*** — suction so strong it bends the camera; stunned when it eats a star cluster too fast; hits knock jets loose |
| Universe | Quasar | Galaxy on a collision course | Gamma-ray burst | Void (slows) | Dark-energy gust | **The Expansion** — not a chaser: pushes all Debris outward; a tug-of-war bar (gravity vs expansion) replaces its health; absorb faster than it spreads and it collapses |

### Pacing

A full run today is roughly 25–30 minutes. Twelve more Tiers at the same pace would make an hour-plus run, which is too long for a browser roguelike. Decisions:

1. **Two Tiers and one boss per Act** after the City (as tabled above), with `AREAS[area].growth` tuned so each Act takes 4–6 minutes: the story beats are dense enough that short Acts still feel like chapters. Adjust if it plays off.
2. **Full Runs only.** Chapter checkpoints (starting at an Area reached before) are a later feature, not part of the Acts.
3. **Each Act scales its own progression.** No Fluff radius cap with a flat per-Area bonus: Fluff, Area score and the server's per-Area bounds grow from progress measured in that Act's units, with plain floating-point maths. Sizes start in cm and climb through the scientific units that suit each scale (m, km, Earth radii, AU, light-years), so the numbers stay readable and well inside float precision.

### Order of work

1. `src/data/story.ts` with Acts 1–3 lines + the `story` module (captions on `tierUp`, `exitOpened`, `areaEntered`, `bossSpawned`), the Settings toggle and the results sub-line. Ships against the current game with no new Areas. ~1 day.
2. The intro screen (static-card version first; diegetic camera as a follow-up). ~1 day.
3. The Region as the first new Area, proving the unit re-basing and the chapter card. Everything after is content.
4. The ending screen, built once the Universe exists, with "Universe N" on the title.

---

## Appendix: alternate lines

Spares for rotation, same voice. Add to `STORY.tiers[...]` as they are approved.

- *It eats a LEGO brick. Somewhere, a parent is spared.* (Fluff)
- *A remote control. The one that was lost. It was here the whole time.* (Dust Devil)
- *The couch is too big to eat. It makes a note.* (Dust Titan)
- *It has absorbed a sprinkler. It is damp and larger. Both are fine.* (Dust Storm)
- *A parked car. The parking ticket is still on it. The ticket is absorbed first.* (Dust Cyclone)
- *The fire department arrives. The fire department is red and about 12 metres long.* (Dust Hurricane)
- *A stadium. Mid-game. The home team was losing.* (Dust Sprawl)
- *A mountain range. It had a name. It has a new one now: inside.* (Dustmass)
- *The Great Barrier Reef is absorbed. It was going anyway.* (Dust Planet)
- *Saturn's rings are, strictly speaking, also dust that never got picked up. It feels seen.* (Dust Giant)
- *A galaxy with 300 billion stars and, probably, someone's couch.* (Dust Singularity)
