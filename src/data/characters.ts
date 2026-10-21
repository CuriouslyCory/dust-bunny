/** Starting Bunny archetypes (Characters). Lint is the default. See docs/design.md "Characters". */
import type { BunnyStatValues } from '../entities/stats';

/**
 * Visual descriptor consumed by BunnyView (and the character select preview).
 * Only `color` is applied by the current view; the rest are hints for the fur look.
 */
export interface CharacterLook {
  /** Base fur colour. */
  color: string;
  /** Secondary fur tint for shell tips / highlights. */
  tipColor: string;
  /** Fur strand length relative to Lint (1 = default shells). */
  furLength: number;
  /** 0..1 how irregular / wispy the silhouette is (0 = tidy ball, 1 = scraggly). */
  fluffiness: number;
  /** Eye style: 'round' (default), 'sleepy' (half-lidded), 'sparkly' (big shine highlights). */
  eyeStyle: 'round' | 'sleepy' | 'sparkly';
  /** Optional emissive sparkle (Zap's static); 0 = none. */
  glow?: number;
}

export interface CharacterDef {
  id: string;
  name: string;
  /** One-line fantasy. */
  description: string;
  strengths: string[];
  weaknesses: string[];
  /** Fur colour (same as look.color; kept for existing consumers). */
  color: string;
  look: CharacterLook;
  /** Overrides on top of BASE_BUNNY_STATS. */
  stats: Partial<BunnyStatValues>;
}

function character(def: Omit<CharacterDef, 'color'>): CharacterDef {
  return { ...def, color: def.look.color };
}

export const CHARACTERS: readonly CharacterDef[] = [
  character({
    id: 'lint',
    name: 'Lint',
    description: 'Dryer lint. Balanced, no weak spots.',
    strengths: ['No weak spots'],
    weaknesses: ['No special strength'],
    look: { color: '#a9adb3', tipColor: '#c9ccd1', furLength: 1, fluffiness: 0.4, eyeStyle: 'round' },
    stats: {},
  }),
  character({
    id: 'tumble',
    name: 'Tumble',
    description: 'Pet-hair tumbleweed. Tough and hard to knock around.',
    strengths: ['5 hearts', 'Bigger start', 'Knockback resistant'],
    weaknesses: ['Slow', 'Sluggish turning', 'Long Dash cooldown'],
    look: { color: '#b08a5e', tipColor: '#d8b78a', furLength: 1.6, fluffiness: 0.85, eyeStyle: 'sleepy' },
    stats: { speed: 0.8, acceleration: 0.7, maxHealth: 5, startRadius: 1.2, dashCooldown: 4, knockbackResistance: 0.5 },
  }),
  character({
    id: 'zap',
    name: 'Zap',
    description: 'Static fluff. Fast, with a built-in magnet.',
    strengths: ['Fast', 'Built-in magnet pull', 'Short Dash cooldown'],
    weaknesses: ['Only 2 hearts', 'Smaller start', 'Suction pulls 1.5× harder'],
    look: { color: '#c9c2f2', tipColor: '#f2eeff', furLength: 0.8, fluffiness: 0.2, eyeStyle: 'sparkly', glow: 0.15 },
    stats: { speed: 1.3, maxHealth: 2, startRadius: 0.9, dashCooldown: 2, magnetRadius: 0.45, suctionMultiplier: 1.5 },
  }),
];

export const DEFAULT_CHARACTER_ID = 'lint';

export function getCharacter(id: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0]!;
}
