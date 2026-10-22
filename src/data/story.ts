/**
 * Narrator lines for the storyline (docs/story.md). Data only: src/story/ picks a variant per
 * Run seed and decides where each beat shows. Voice: deadpan, present tense, no exclamation marks.
 *
 * A line is one caption or a sequence of captions shown one after another; every caption fits
 * two lines (≤ STORY_CAPTION_MAX characters). Each beat lists its variants; a Run picks one.
 */
import type { AreaId } from '../world/types';

export const STORY_CAPTION_MAX = 140;

export type StoryLine = string | readonly string[];

/** One card of a scripted sequence (the intro now, the ending later). */
export interface StoryPanel {
  caption: string;
  /** Second caption, shown under the first after a beat. */
  caption2?: string;
  /** Seconds on screen when not skipped. */
  hold: number;
}

/** The chapter that an Area is. Its chapter number is its position in AREA_ORDER. */
export interface AreaStory {
  /** Chapter title on the chapter card and the results screen. */
  title: string;
  /** Chapter card line on arriving (unused for the first Area: the intro covers it). */
  entered: readonly StoryLine[];
  /** Exit-opened banner line (for the last Area: the victory line on the results screen). */
  cleared: readonly StoryLine[];
  /** Boss-arrival banner line. */
  boss: readonly StoryLine[];
}

export interface Story {
  intro: readonly StoryPanel[];
  /** Tier-up lines keyed by Tier id (src/data/tiers.ts); every Tier after the first has some. */
  tiers: Readonly<Record<string, readonly StoryLine[]>>;
  /** Every Area must have a chapter: adding an AreaId without one does not compile. */
  areas: Readonly<Record<AreaId, AreaStory>>;
  /** One-off lines for absorbing a particular Debris type (first time per Run), keyed by type id. */
  debris: Readonly<Record<string, readonly StoryLine[]>>;
}

export const STORY: Story = {
  intro: [
    { caption: 'This is a floor.', hold: 3 },
    { caption: 'Every day, people drop things on it.', hold: 4 },
    { caption: 'Nobody picks them up.', hold: 3 },
    { caption: 'Under the couch, the dropped things reach a density the universe has no procedure for.', hold: 4.5 },
    { caption: 'Physics does not have an explanation for what happens next.', caption2: 'Physics has decided not to look.', hold: 4.5 },
    { caption: 'It has one instinct.', caption2: 'Grow.', hold: 3.5 },
  ],

  tiers: {
    // Act 1 · The House
    fluff: ['It has eaten a staple. It feels nothing about the staple. It wants another.', 'It eats a LEGO brick. Somewhere, a parent is spared.'],
    tumbleweed: ['Coins are now Debris. The economy has not been informed.'],
    dust_devil: ['The mystery of the missing socks is solved. No one will ever know.', 'A remote control. The one that was lost. It was here the whole time.'],
    dust_titan: ['The house has noticed. The house has sent the vacuum.', 'The couch is too big to eat. It makes a note.'],
    // Act 2 · The Neighborhood
    dust_storm: [
      'Garden gnomes. Mailboxes. A bicycle someone was going to fix. Nothing is spared, because nothing was ever picked up.',
      'It has absorbed a sprinkler. It is damp and larger. Both are fine.',
    ],
    dust_cyclone: [
      "The homeowners' association has filed a complaint. The complaint is absorbed.",
      'A parked car. The parking ticket is still on it. The ticket is absorbed first.',
    ],
    // Act 3 · The City
    dust_hurricane: [
      'Local news calls it "a weather event." Local news is parked on 5th Street. Local news is absorbed.',
      'The fire department arrives. The fire department is red and about 12 metres long.',
    ],
    dust_colossus: ['Pedestrians are advised to remain indoors. Indoors is advised to remain pedestrians.'],
    // Act 4 · The Region
    dust_sprawl: ['It has eaten a town. The town was, by most accounts, fine.', 'A stadium. Mid-game. The home team was losing.'],
    dust_front: [
      'Regional authorities declare a state of emergency. The state is absorbed.',
      'The evening forecast shows a grey front moving across three counties. The front is not weather.',
    ],
    // Act 5 · The Continent
    dustmass: [
      'There is a word for a dust bunny the size of a country. The word has not been invented. Everyone who might invent it is busy.',
      'A mountain range. It had a name. It has a new one now: inside.',
    ],
    dust_pangaea: ['Plate tectonics usually takes two hundred million years to move this much material. It did it before lunch.'],
    // Act 6 · The Globe
    dust_moon: ['It has absorbed the Moon. The tides have questions.'],
    dust_planet: ['From orbit, Earth is a pale blue marble. It is the marble now.', 'The Great Barrier Reef is absorbed. It was going anyway.'],
  },

  areas: {
    house: {
      title: 'Under the Couch',
      entered: [],
      cleared: ['The front door was built for people. It is not clear that a dust bunny is not a person.'],
      boss: ['The Robo-Vac 9000 was built for exactly this. It was not built for exactly this much.'],
    },
    neighborhood: {
      title: 'The Front Door Was Built for People',
      entered: ['It rolls outside. The outside is also a floor.'],
      cleared: ['The road barrier was meant to keep traffic out. Traffic was never the problem.'],
      boss: ['The city sends a Street Sweeper. It is the biggest broom it owns.'],
    },
    city: {
      title: 'Where People Drop Things Professionally',
      entered: ['The city is where people go to drop things professionally.'],
      cleared: ['The city is gone. The thing that used to be a dust bunny rolls on. There is more ground.'],
      boss: ['The Garbage Truck is the largest thing people built to make dropped things go away. It is about to learn where they go.'],
    },
    region: {
      title: 'A State of Emergency',
      entered: [
        'From up here the cities look like crumbs. They are, from its point of view, crumbs.',
        'The highway goes on for hours. It does not take hours.',
      ],
      cleared: ['Satellite imagery shows a grey smear moving west. The satellites are next.'],
      boss: [
        [
          'At the landfill stands the Incinerator, the last machine built for this exact problem.',
          'It burns things so they go away. It is about to learn where they go.',
        ],
      ],
    },
    continent: {
      title: 'Plate Tectonics, Before Lunch',
      entered: ['The planet has run out of machines. It falls back on weather.'],
      cleared: ['There is no more land. There is, however, up.'],
      boss: ['The planet tries the oldest cleaning method it knows: ice. It worked on the mammoths.'],
    },
    globe: {
      title: 'The Marble',
      entered: ['It leaves the atmosphere. The atmosphere does not try to stop it. The atmosphere is also Debris.'],
      cleared: ['Earth is gone. This is reported by no one.'],
      boss: [
        [
          "Humanity's final appliance is, fittingly, a vacuum cleaner for space.",
          'Humanity is, at this point, mostly absorbed. They would have wanted it this way. They would not have, actually.',
        ],
      ],
    },
  },

  debris: {
    stadium: ['It has eaten a stadium. The match has been postponed. Both teams are claiming the win.'],
    metropolis_ruins: ['What is left of a capital city. Its last ordinance concerned littering. It was not enforced.'],
    small_country: ['It has absorbed a small country. The neighbouring countries issue a joint statement. The statement is absorbed.'],
  },
};
