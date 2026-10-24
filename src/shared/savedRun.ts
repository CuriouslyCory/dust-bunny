/**
 * The saved Run as the client and the Vercel functions both see it (api/saved-run.ts): the
 * snapshot version, its migrations and the checks the server runs before it stores a signed-in
 * player's saved Run. The full validation (Characters, Areas, every field) is `parseRunSnapshot`
 * in src/game/snapshot.ts, which imports game data the API build doesn't carry; the client runs it
 * on everything it reads back. Pure and dependency-free (see the note in `./score.ts`).
 *
 * Versions follow docs/adr/0001: a snapshot from an older version is migrated to this one
 * (`migrateRunSnapshot`), never dropped; one from a newer version is kept as it is, unread.
 */
import { parseLoadout } from './keepsakes.js';

/** The `RunSnapshot` shape's version (src/game/snapshot.ts). Bump it, with a migration, for any change an older reader would misread. */
export const SNAPSHOT_VERSION = 1;

/**
 * Body cap for `PUT /api/saved-run`. Measured: a snapshot is about 1.3–1.6 KB, and the list of
 * absorbed fixed Debris placements adds at most ~2.5 KB (the Solar System's 661, all absorbed), so
 * a Run through every Area stays under 8 KB. The cap leaves room and stays well under the 64 KB a
 * `keepalive` request may carry.
 */
export const MAX_SAVED_RUN_BYTES = 32_768;

/** Leases (hand-off ids) and Run keys: random ids, or legacy keys like `lb:…` / `seed:…`. */
const MAX_ID_LENGTH = 200;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function isSavedRunId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH;
}

/** A stored snapshot's version (null: not a snapshot at all). */
export function snapshotVersion(raw: unknown): number | null {
  return isObj(raw) && Number.isInteger(raw.version) && (raw.version as number) >= 1 ? (raw.version as number) : null;
}

/** True for a snapshot written by a newer build than this one: keep it, don't read or replace it. */
export function isNewerSnapshot(raw: unknown): boolean {
  const v = snapshotVersion(raw);
  return v !== null && v > SNAPSHOT_VERSION;
}

/**
 * One step per older version: `MIGRATIONS[v]` turns a version-`v` snapshot into version `v + 1`.
 * Empty while version 1 is the only one; add the step (and a test with a stored example of the old
 * shape) with the next bump.
 */
const MIGRATIONS: Record<number, (s: Record<string, unknown>) => Record<string, unknown>> = {};

/**
 * Brings an older snapshot up to `SNAPSHOT_VERSION` (a copy; the input is untouched). This
 * version's and newer ones come back as they are. Null when it isn't a snapshot, or an older
 * version has no migration (a bug: every bump must add one).
 */
export function migrateRunSnapshot(raw: unknown): Record<string, unknown> | null {
  const v = snapshotVersion(raw);
  if (v === null || !isObj(raw)) return null;
  if (v >= SNAPSHOT_VERSION) return raw;
  let s: Record<string, unknown> = structuredClone(raw);
  for (let at = v; at < SNAPSHOT_VERSION; at++) {
    const step = MIGRATIONS[at];
    if (!step) return null;
    s = { ...step(s), version: at + 1 };
  }
  return s;
}

/** A `PUT /api/saved-run` body, checked. */
export interface SavedRunUpload {
  runKey: string;
  lease: string;
  /** The lease held before a take the caller hasn't heard back about (it may or may not have landed). */
  prevLease?: string;
  /** Migrated to `SNAPSHOT_VERSION` when it was older; a newer one exactly as sent. */
  snapshot: Record<string, unknown>;
  version: number;
}

export type SavedRunCheck<T> = { ok: true; value: T } | { ok: false; message: string; field?: string };

const fail = (message: string, field?: string): { ok: false; message: string; field?: string } => ({ ok: false, message, field });

/**
 * The checks the server can make without game data: the ids, a snapshot of a known version for
 * the same Run, and (for this version) its basic fields and a Loadout `parseLoadout` accepts. A
 * newer version is accepted as it is (only its version and `runKey` are read).
 */
export function validateSavedRunUpload(body: unknown): SavedRunCheck<SavedRunUpload> {
  if (!isObj(body)) return fail('Body must be an object.');
  if (!isSavedRunId(body.runKey)) return fail('runKey must be a non-empty string.', 'runKey');
  if (!isSavedRunId(body.lease)) return fail('lease must be a non-empty string.', 'lease');
  if (body.prevLease !== undefined && !isSavedRunId(body.prevLease)) return fail('prevLease must be a non-empty string.', 'prevLease');
  const version = snapshotVersion(body.snapshot);
  if (version === null) return fail('snapshot must be a Run snapshot with a version.', 'snapshot');
  const snapshot = migrateRunSnapshot(body.snapshot);
  if (!snapshot) return fail(`snapshot version ${version} can't be read.`, 'snapshot');
  if (snapshot.runKey !== undefined && snapshot.runKey !== body.runKey) return fail("snapshot.runKey doesn't match runKey.", 'snapshot.runKey');
  if (version <= SNAPSHOT_VERSION) {
    if (typeof snapshot.characterId !== 'string') return fail('snapshot.characterId must be a string.', 'snapshot.characterId');
    if (typeof snapshot.savedAt !== 'number' || !Number.isFinite(snapshot.savedAt)) return fail('snapshot.savedAt must be a number.', 'snapshot.savedAt');
    if (!isObj(snapshot.stats)) return fail('snapshot.stats must be an object.', 'snapshot.stats');
    if (parseLoadout(snapshot.characterId, snapshot.loadout) === null) return fail('snapshot.loadout is not a valid Loadout.', 'snapshot.loadout');
  }
  return {
    ok: true,
    value: { runKey: body.runKey, lease: body.lease, ...(body.prevLease !== undefined ? { prevLease: body.prevLease as string } : {}), snapshot, version: Math.max(version, SNAPSHOT_VERSION) },
  };
}

/** A `POST /api/saved-run` (take) or `DELETE /api/saved-run` body. */
export interface SavedRunClaim {
  runKey: string;
  lease: string;
  /** Take only: the lease the caller holds from now on. */
  newLease?: string;
  /** End only: also matches this lease (an unconfirmed take, see `SavedRunUpload.prevLease`). */
  prevLease?: string;
}

export function validateSavedRunClaim(body: unknown, needNewLease: boolean): SavedRunCheck<SavedRunClaim> {
  if (!isObj(body)) return fail('Body must be an object.');
  if (!isSavedRunId(body.runKey)) return fail('runKey must be a non-empty string.', 'runKey');
  if (!isSavedRunId(body.lease)) return fail('lease must be a non-empty string.', 'lease');
  if (needNewLease && !isSavedRunId(body.newLease)) return fail('newLease must be a non-empty string.', 'newLease');
  if (body.prevLease !== undefined && !isSavedRunId(body.prevLease)) return fail('prevLease must be a non-empty string.', 'prevLease');
  return {
    ok: true,
    value: {
      runKey: body.runKey,
      lease: body.lease,
      ...(needNewLease ? { newLease: body.newLease as string } : {}),
      ...(body.prevLease !== undefined ? { prevLease: body.prevLease as string } : {}),
    },
  };
}

/** What `GET /api/saved-run` (and a refused take) says about the Account's saved Run row. */
export interface ServerSavedRun {
  runKey: string;
  /** Whoever holds the Run now. */
  lease: string;
  /** The stored snapshot's version (null while a device is playing it). */
  version: number | null;
  /** The stored snapshot (null while a device is playing it: taken, not stored again yet). */
  snapshot: Record<string, unknown> | null;
  updatedAt: string;
}
