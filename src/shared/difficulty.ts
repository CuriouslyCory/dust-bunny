/**
 * Difficulty ids and leaderboard score multipliers, shared by the client and the Vercel
 * function (see the import note in `./score.ts`). Gameplay tuning per Difficulty lives in
 * `src/data/difficulty.ts`.
 */

export const DIFFICULTY_IDS = ['casual', 'arcade', 'hardcore'] as const;
export type DifficultyId = (typeof DIFFICULTY_IDS)[number];

/** The original balance; also what older saves, Runs and leaderboard rows count as. */
export const DEFAULT_DIFFICULTY: DifficultyId = 'casual';

/** Leaderboard score multiplier per Difficulty (harder Runs grow slower but score more). */
export const DIFFICULTY_SCORE_MULTIPLIER: Readonly<Record<DifficultyId, number>> = {
  casual: 1,
  arcade: 1.25,
  hardcore: 1.6,
};

export function isDifficultyId(v: unknown): v is DifficultyId {
  return typeof v === 'string' && (DIFFICULTY_IDS as readonly string[]).includes(v);
}
