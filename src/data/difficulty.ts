/**
 * Difficulty tuning (data only). Casual is the original balance (every multiplier 1); Arcade
 * and Hardcore scale the Hazards (speed, numbers, reaction time) and trim the Bunny's safety
 * net. Chosen on character select, remembered in the save, `?difficulty=` overrides it.
 * Leaderboard score multipliers live in `src/shared/difficulty.ts` (the server needs them).
 */
import type { StatModifier } from '../entities/stats';
import { DEFAULT_DIFFICULTY, DIFFICULTY_IDS, isDifficultyId, type DifficultyId } from '../shared/difficulty';

export { DEFAULT_DIFFICULTY, DIFFICULTY_IDS, isDifficultyId, type DifficultyId };

export interface DifficultyDef {
  id: DifficultyId;
  name: string;
  /** One line for the picker. */
  description: string;
  /** × every Hazard's movement: patrols, boss hunts and charges, sweeps, projectiles. */
  hazardSpeed: number;
  /** × the director's alive Hazard budget (rounded). */
  hazardBudget: number;
  /** × seconds between Hazard spawns. */
  spawnInterval: number;
  /** × the Hazard-free grace period at the start of each area. */
  graceSeconds: number;
  /** × attack wind-ups (telegraphs, warm-ups), turret cooldowns and boss summon intervals. */
  attackTiming: number;
  /** Hearts added to the Character's max health (negative removes; at least 1 remains). */
  maxHealth: number;
  /** × Pickup spawn rate (the pickupLuck stat). */
  pickupRate: number;
  /** Hearts restored on reaching a new area. */
  areaHeal: number;
  /** × Fluff earned by a Run. */
  fluff: number;
}

export const DIFFICULTIES: Readonly<Record<DifficultyId, DifficultyDef>> = {
  casual: {
    id: 'casual',
    name: 'Casual',
    description: 'The relaxed, original pace.',
    hazardSpeed: 1,
    hazardBudget: 1,
    spawnInterval: 1,
    graceSeconds: 1,
    attackTiming: 1,
    maxHealth: 0,
    pickupRate: 1,
    areaHeal: 1,
    fluff: 1,
  },
  arcade: {
    id: 'arcade',
    name: 'Arcade',
    description: 'Faster Hazards, more of them, quicker attacks.',
    hazardSpeed: 1.2,
    hazardBudget: 1.25,
    spawnInterval: 0.8,
    graceSeconds: 0.6,
    attackTiming: 0.85,
    maxHealth: 0,
    pickupRate: 1,
    areaHeal: 1,
    fluff: 1.25,
  },
  hardcore: {
    id: 'hardcore',
    name: 'Hardcore',
    description: 'Relentless Hazards, one heart fewer, fewer Pickups, no heal between areas.',
    hazardSpeed: 1.4,
    hazardBudget: 1.6,
    spawnInterval: 0.6,
    graceSeconds: 0.35,
    attackTiming: 0.7,
    maxHealth: -1,
    pickupRate: 0.7,
    areaHeal: 0,
    fluff: 1.6,
  },
};

export function getDifficulty(id: string | null | undefined): DifficultyDef {
  return DIFFICULTIES[isDifficultyId(id) ? id : DEFAULT_DIFFICULTY];
}

/** Bunny stat modifiers a Difficulty applies at Run start (none on Casual). */
export function difficultyModifiers(d: DifficultyDef): StatModifier[] {
  const out: StatModifier[] = [];
  const source = `difficulty:${d.id}`;
  if (d.maxHealth !== 0) out.push({ stat: 'maxHealth', op: 'add', value: d.maxHealth, source });
  if (d.pickupRate !== 1) out.push({ stat: 'pickupLuck', op: 'mul', value: d.pickupRate, source });
  return out;
}
