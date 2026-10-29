/**
 * Deleting an Account (`POST /api/auth/delete-user`, Better Auth's route; wired in ./auth.ts as
 * `user.deleteUser.beforeDelete`). One transaction removes everything the Account owns:
 *
 * - the user row, and through `ON DELETE CASCADE` its sessions, linked Google/Discord accounts, the
 *   cloud save (`player_progress`), the saved Run (`saved_runs`), the Run credit ledger
 *   (`run_credits`) and the holder records (`run_holders`);
 * - its Verified scores stay on the boards as anonymous entries: user id, name and IP hash are
 *   cleared. Only the entries the boards showed are kept, the player's best per board and
 *   Character filter (a signed-in player is listed once per board, with their best; anonymous
 *   entries are listed one by one, so keeping every Run they posted would fill the boards with
 *   them). The rest are deleted.
 *
 * The user row is locked first, so a score posted while this runs either lands before the
 * anonymising (and is anonymised) or fails its foreign key afterwards. Better Auth's own delete
 * then finds nothing left and clears the session cookie.
 */
import { FALLBACK_NAME } from '../src/shared/leaderboard.js';
import { transaction } from './db.js';

/** The anonymous name a deleted Account's kept scores show. */
export const DELETED_ACCOUNT_NAME = FALLBACK_NAME;

export async function deleteAccount(userId: string): Promise<void> {
  await transaction(async (q) => {
    const [user] = await q<{ id: string }>('SELECT "id" FROM "user" WHERE "id" = $1 FOR UPDATE', [userId]);
    if (!user) return;
    // The Run board lists by Character (or all of them, whose best is one of those).
    await q(
      `DELETE FROM leaderboard_scores WHERE user_id = $1 AND id NOT IN (
         SELECT DISTINCT ON (character) id FROM leaderboard_scores WHERE user_id = $1 ORDER BY character, score DESC, id ASC)`,
      [userId],
    );
    // Area boards list by Area, then Character.
    await q(
      `DELETE FROM area_scores WHERE user_id = $1 AND id NOT IN (
         SELECT DISTINCT ON (area, character) id FROM area_scores WHERE user_id = $1 ORDER BY area, character, score DESC, id ASC)`,
      [userId],
    );
    for (const table of ['leaderboard_scores', 'area_scores']) {
      await q(`UPDATE ${table} SET user_id = NULL, name = $2, ip_hash = NULL WHERE user_id = $1`, [userId, DELETED_ACCOUNT_NAME]);
    }
    await q('DELETE FROM "user" WHERE "id" = $1', [userId]);
  });
}
