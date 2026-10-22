/** Starting Bunny archetypes (Characters). Lint is the default. See docs/design.md "Characters". */
import type { BunnyStatValues, StatKey } from '../entities/stats';
import type { AbilityId } from './abilities';

/**
 * A per-Character stat cap: `max` for stats where more is better, `min` (a floor) for
 * dashCooldown and suctionMultiplier. Applied at runtime after base + Shop + Keepsakes + Perks
 * (priority CAP_PRIORITY) and before timed / Ability-state effects, so play styles stay apart.
 */
export interface StatCap {
  max?: number;
  min?: number;
  /** Shown on hover on the stat bar's cap tick. */
  reason: string;
}

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
  /** The Character's Ability (unlocked from the first Run). */
  ability: AbilityId;
  /** Stat caps that keep the archetypes apart (see docs/design.md "Stat caps"). */
  caps: Partial<Record<StatKey, StatCap>>;
}

/** Modifier priority of the cap stage: after Upgrades, Keepsakes and Perks (≤ 200), before timed effects (≥ 300). */
export const CAP_PRIORITY = 250;

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
    ability: 'decoy',
    caps: {
      speed: { max: 1.25, reason: 'Lint is quick, but Zap is quicker.' },
      maxHealth: { max: 7, reason: 'Lint is sturdy, but Tumble is sturdier.' },
      dashCooldown: { min: 1.5, reason: 'Lint can only shed so fast.' },
      magnetRadius: { max: 1, reason: 'Lint has no static charge of its own.' },
      knockbackResistance: { max: 0.35, reason: 'Lint is light. A good shove still moves it.' },
      suctionMultiplier: { min: 0.8, reason: 'Lint is loose fluff. Vacuums always get a grip.' },
    },
  }),
  character({
    id: 'tumble',
    name: 'Tumble',
    description: 'Pet-hair tumbleweed. Tough and hard to knock around.',
    strengths: ['5 hearts', 'Bigger start', 'Knockback resistant'],
    weaknesses: ['Slow', 'Sluggish turning', 'Long Dash cooldown'],
    look: { color: '#b08a5e', tipColor: '#d8b78a', furLength: 1.6, fluffiness: 0.85, eyeStyle: 'sleepy' },
    stats: { speed: 0.8, acceleration: 0.7, maxHealth: 5, startRadius: 1.2, dashCooldown: 4, knockbackResistance: 0.5 },
    ability: 'hunker',
    caps: {
      speed: { max: 1.05, reason: 'Pet hair is heavy. Tumble never outruns Lint.' },
      maxHealth: { max: 10, reason: 'Even a tumbleweed has limits.' },
      dashCooldown: { min: 2.5, reason: 'Tumble needs a moment to get rolling again.' },
      magnetRadius: { max: 0.75, reason: 'Pet hair has no static. Zap always pulls further.' },
      knockbackResistance: { max: 0.9, reason: 'Nothing is completely immovable.' },
      suctionMultiplier: { min: 0.6, reason: 'Even a heavy tumbleweed gets sucked up eventually.' },
    },
  }),
  character({
    id: 'zap',
    name: 'Zap',
    description: 'Static fluff. Fast, with a built-in magnet.',
    strengths: ['Fast', 'Built-in magnet pull', 'Short Dash cooldown'],
    weaknesses: ['Only 2 hearts', 'Smaller start', 'Suction pulls 1.5× harder'],
    look: { color: '#c9c2f2', tipColor: '#f2eeff', furLength: 0.8, fluffiness: 0.2, eyeStyle: 'sparkly', glow: 0.15 },
    stats: { speed: 1.3, maxHealth: 2, startRadius: 0.9, dashCooldown: 2, magnetRadius: 0.45, suctionMultiplier: 1.5 },
    ability: 'discharge',
    caps: {
      speed: { max: 2, reason: 'Static fluff can only go so fast.' },
      maxHealth: { max: 4, reason: 'Static fluff is fragile. Zap never outlasts Tumble.' },
      dashCooldown: { min: 0.7, reason: 'Even static needs a moment to build up.' },
      magnetRadius: { max: 2.2, reason: 'Static only reaches so far.' },
      knockbackResistance: { max: 0.1, reason: 'Zap weighs nothing. Every hit sends it flying.' },
      suctionMultiplier: { min: 1.2, reason: 'Static fluff clings to every vacuum. Zap is always pulled hardest.' },
    },
  }),
];

export const DEFAULT_CHARACTER_ID = 'lint';

export function getCharacter(id: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0]!;
}
