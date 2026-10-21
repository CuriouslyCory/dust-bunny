/** Starting Bunny archetypes. Character select UI is not built yet; Lint is the default. */
import type { BunnyStatValues } from '../entities/stats';

export interface CharacterDef {
  id: string;
  name: string;
  description: string;
  /** Fur colour. */
  color: string;
  /** Overrides on top of BASE_BUNNY_STATS. */
  stats: Partial<BunnyStatValues>;
}

export const CHARACTERS: readonly CharacterDef[] = [
  {
    id: 'lint',
    name: 'Lint',
    description: 'Dryer lint. Balanced, no weak spots.',
    color: '#a9adb3',
    stats: {},
  },
  {
    id: 'tumble',
    name: 'Tumble',
    description: 'Pet-hair tumbleweed. Tough and hard to knock around, but slow.',
    color: '#b08a5e',
    stats: { speed: 0.8, acceleration: 0.7, maxHealth: 5, startRadius: 1.2, dashCooldown: 4, knockbackResistance: 0.5 },
  },
  {
    id: 'zap',
    name: 'Zap',
    description: 'Static fluff. Fast with a built-in magnet, but fragile and easily sucked up.',
    color: '#c9c2f2',
    stats: { speed: 1.3, maxHealth: 2, startRadius: 0.9, dashCooldown: 2, magnetRadius: 0.6, suctionMultiplier: 1.5 },
  },
];

export const DEFAULT_CHARACTER_ID = 'lint';

export function getCharacter(id: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0]!;
}
