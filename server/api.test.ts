/**
 * Integration tests for the Vercel functions (api/auth.ts, api/leaderboard.ts, api/progress.ts,
 * api/saved-run.ts)
 * against a real Postgres. Skipped unless TEST_DATABASE_URL is set; point it at a throwaway Neon
 * branch, never production:
 *
 *   TEST_DATABASE_URL='postgresql://…' pnpm test server
 *
 * Sessions come from Better Auth's email + password sign-up, enabled only in these tests (the game
 * itself offers social sign-in only). Rows created here are deleted afterwards.
 */
import { randomUUID } from 'node:crypto';
import { getMigrations } from 'better-auth/db/migration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import authApi from '../api/auth';
import leaderboardApi from '../api/leaderboard';
import progressApi from '../api/progress';
import runCreditApi from '../api/run-credit';
import savedRunApi from '../api/saved-run';
import { computeAreaScore, computeScore, SCORE_TIER_MIN_RADII, scoreTierForRadius } from '../src/shared/score';
import type { Progress } from '../src/shared/progress';
import { CREDIT_STATS_BOUNDS, MAX_RUN_CREDIT_BYTES, RUN_CREDIT_LIST_MAX, type RunCredit } from '../src/shared/runCredit';
import { MAX_SAVED_RUN_BYTES, SNAPSHOT_VERSION } from '../src/shared/savedRun';
import { authOptions, resetAuthForTests } from './auth';
import { ensureSchema, query, resetDbForTests } from './db';
import { SCHEMA_PROBE } from './schema';

const DB = process.env.TEST_DATABASE_URL;
const ORIGIN = 'http://localhost:5173';
const RUN = randomUUID().slice(0, 8);
const EMAIL_DOMAIN = `test-${RUN}.dust-bunny.invalid`;
/** A fresh fake client IP per test run, so the per-IP rate limit never trips across runs. */
const IP = `198.51.100.${Math.floor(Math.random() * 250) + 1}-${RUN}`;

type Handler = { fetch(r: Request): Promise<Response> };

function call(handler: Handler, path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', IP);
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return handler.fetch(new Request(ORIGIN + path, { ...init, headers }));
}

/** Signs up a throwaway user and returns its session cookie. */
async function signUp(name: string): Promise<string> {
  const res = await call(authApi, '/api/auth/sign-up/email', {
    method: 'POST',
    body: JSON.stringify({ name, email: `${name.toLowerCase()}@${EMAIL_DOMAIN}`, password: `pw-${RUN}-${randomUUID()}` }),
  });
  expect(res.status).toBe(200);
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]);
  const cookie = cookies.find((c) => c.includes('session_token'));
  expect(cookie).toBeTruthy();
  return cookies.join('; ');
}

function submission(name: string, extra: { maxRadius?: number; runId?: string } = {}) {
  const maxRadius = extra.maxRadius ?? 1.5;
  const fields = { maxRadius, debrisAbsorbed: 40, tierReached: scoreTierForRadius(maxRadius), durationMs: 45_000, victory: false, difficulty: 'casual' as const };
  return { name, character: 'lint', ...fields, score: computeScore(fields), ...(extra.runId ? { runId: extra.runId } : {}) };
}

/** An Area clear over 400 s (the house caps at 160 cm; the City allows ~1110 cm from 190 cm in that time). */
function areaSub(name: string, extra: { maxRadius?: number; runId?: string; area?: 'house' | 'city' } = {}) {
  const area = extra.area ?? 'house';
  const fields = { area, radiusIn: area === 'house' ? 1 : 190, maxRadius: extra.maxRadius ?? 50, debrisAbsorbed: 900, durationMs: 400_000, difficulty: 'casual' as const };
  return { name, character: 'zap', ...fields, score: computeAreaScore(fields), ...(extra.runId ? { runId: extra.runId } : {}) };
}

/** Posts from a second fake IP, so these tests stay clear of the per-IP limits the others use up. */
const post = (path: string, body: unknown, cookie?: string) =>
  call(leaderboardApi, path, { method: 'POST', cookie, body: JSON.stringify(body), headers: { 'x-forwarded-for': `${IP}-boards` } });

const progress = (fluff: number, totalFluffEarned: number, runs: number, upgrades: Record<string, number> = {}, characters: Progress['characters'] = {}, universes = 0): Progress => ({
  fluff,
  upgrades,
  characters,
  universes,
  stats: { runs, wins: 0, bestRadius: 2.5, bestTier: 2, totalFluffEarned, keepsakesEarned: 0 },
});

/** The fields the server checks; the client validates the rest (parseRunSnapshot). */
const runSnapshot = (runKey: string, extra: Record<string, unknown> = {}) => ({
  version: SNAPSHOT_VERSION,
  savedAt: 1_700_000_000_000,
  runKey,
  seed: 'saved',
  characterId: 'zap',
  loadout: [{ type: 'arc', rarity: 2 }],
  stats: { seed: 'saved', timeSec: 30, maxRadius: 2, tierReached: 2, area: 'house' },
  ...extra,
});

describe.skipIf(!DB)('API integration (TEST_DATABASE_URL)', () => {
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.DATABASE_URL = DB;
    process.env.BETTER_AUTH_SECRET = `test-secret-${randomUUID()}`;
    process.env.BETTER_AUTH_URL = ORIGIN;
    process.env.GOOGLE_CLIENT_ID = 'test-google-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
    process.env.DISCORD_CLIENT_ID = 'test-discord-id';
    process.env.DISCORD_CLIENT_SECRET = 'test-discord-secret';
    await resetDbForTests();
    // Better Auth skips its origin checks under test by default; keep them on, as in production.
    resetAuthForTests({ emailAndPassword: { enabled: true }, advanced: { disableOriginCheck: false } });
  });

  afterAll(async () => {
    await query(`DELETE FROM leaderboard_scores WHERE name LIKE $1`, [`T${RUN}%`]);
    await query(`DELETE FROM area_scores WHERE name LIKE $1`, [`T${RUN}%`]);
    await query(`DELETE FROM "user" WHERE email LIKE $1`, [`%@${EMAIL_DOMAIN}`]); // cascades to sessions, accounts, progress
    await resetDbForTests();
    process.env = saved;
  });

  it('reports the configured providers', async () => {
    const res = await call(authApi, '/api/auth/providers');
    expect(await res.json()).toEqual({ enabled: true, providers: ['google', 'discord'] });
  });

  it('skips the DDL once the newest schema objects exist, and applies it when one is missing', async () => {
    await ensureSchema();
    const probe = async () => (await query<{ ready: boolean }>(SCHEMA_PROBE))[0]!.ready;
    expect(await probe()).toBe(true);
    // A database from before the credit ledger, or before holder records: the probe says no, and
    // the next instance applies the DDL.
    for (const ddl of [`DROP INDEX run_credits_user_idx`, `DROP TABLE run_holders`]) {
      await query(ddl);
      expect(await probe()).toBe(false);
      await resetDbForTests();
      await ensureSchema();
      expect(await probe()).toBe(true);
    }
  });

  it('creates every table Better Auth expects', async () => {
    await call(authApi, '/api/auth/get-session'); // runs ensureSchema
    const { toBeCreated, toBeAdded } = await getMigrations(authOptions());
    expect(toBeCreated.map((t) => t.table)).toEqual([]);
    expect(toBeAdded.map((t) => t.table)).toEqual([]);
  });

  it.each(['google', 'discord'])('starts %s sign-in with our callback URL', async (provider) => {
    const res = await call(authApi, '/api/auth/sign-in/social', { method: 'POST', body: JSON.stringify({ provider, callbackURL: '/', disableRedirect: true }) });
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    const auth = new URL(url);
    expect(auth.host).toBe(provider === 'google' ? 'accounts.google.com' : 'discord.com');
    expect(auth.searchParams.get('client_id')).toBe(`test-${provider}-id`);
    expect(auth.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/callback/${provider}`);
  });

  it('rejects a callback URL on another origin', async () => {
    const res = await call(authApi, '/api/auth/sign-in/social', { method: 'POST', body: JSON.stringify({ provider: 'discord', callbackURL: 'https://evil.example/' }) });
    expect(res.status).toBe(403);
  });

  it('returns the session for a signed-in cookie', async () => {
    const cookie = await signUp(`Sess${RUN}`);
    const res = await call(authApi, '/api/auth/get-session', { cookie });
    const body = (await res.json()) as { user: { name: string } } | null;
    expect(body?.user.name).toBe(`Sess${RUN}`);
  });

  it('marks leaderboard entries verified only for signed-in players', async () => {
    const cookie = await signUp(`Lb${RUN}`);
    const anon = await call(leaderboardApi, '/api/leaderboard', { method: 'POST', body: JSON.stringify(submission(`T${RUN}a`)) });
    expect(anon.status).toBe(201);
    expect(((await anon.json()) as { entry: { verified: boolean } }).entry.verified).toBe(false);

    const signed = await call(leaderboardApi, '/api/leaderboard', { method: 'POST', cookie, body: JSON.stringify(submission(`T${RUN}v`)) });
    expect(signed.status).toBe(201);
    const { entry } = (await signed.json()) as { entry: { id: string; verified: boolean } };
    expect(entry.verified).toBe(true);

    // A garbage cookie is just anonymous, not an error.
    const forged = await call(leaderboardApi, '/api/leaderboard', { method: 'POST', cookie: 'better-auth.session_token=forged.value', body: JSON.stringify(submission(`T${RUN}f`)) });
    expect(((await forged.json()) as { entry: { verified: boolean } }).entry.verified).toBe(false);

    const rows = await query<{ name: string; verified: boolean }>(`SELECT name, user_id IS NOT NULL AS verified FROM leaderboard_scores WHERE name LIKE $1 ORDER BY id`, [`T${RUN}%`]);
    expect(rows).toEqual([
      { name: `T${RUN}a`, verified: false },
      { name: `T${RUN}v`, verified: true },
      { name: `T${RUN}f`, verified: false },
    ]);
    const top = (await (await call(leaderboardApi, '/api/leaderboard')).json()) as { entries: Array<{ verified: unknown }> };
    expect(top.entries.every((e) => typeof e.verified === 'boolean')).toBe(true);
  });

  it('stores and returns the Loadout; older clients without one are still accepted', async () => {
    // Its own fake IP, clear of the per-IP limits the other tests use.
    const post = (path: string, body: unknown) =>
      call(leaderboardApi, path, { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': `${IP}-loadout` } });
    const loadout = [{ type: 'thick_clog', rarity: 2 }, { type: 'thick_clog', rarity: 2 }];
    // Entries also carry `grade` (rarity × 2) for tabs still running the bundle from before rarities.
    const returned = loadout.map((k) => ({ ...k, grade: k.rarity * 2 }));
    const withLoadout = await post('/api/leaderboard', { ...submission(`T${RUN}k`), loadout });
    expect(withLoadout.status).toBe(201);
    expect(((await withLoadout.json()) as { entry: { loadout?: unknown } }).entry.loadout).toEqual(returned);
    // A client from before rarities sends grades 1–10: stored as rarities.
    const legacy = await post('/api/leaderboard', { ...submission(`T${RUN}g`), loadout: [{ type: 'thick_clog', grade: 7 }] });
    expect(legacy.status).toBe(201);
    expect(((await legacy.json()) as { entry: { loadout?: unknown } }).entry.loadout).toEqual([{ type: 'thick_clog', rarity: 4, grade: 8 }]);
    const older = await post('/api/leaderboard', submission(`T${RUN}o`));
    expect(older.status).toBe(201);
    expect('loadout' in ((await older.json()) as { entry: object }).entry).toBe(false);
    const bad = await post('/api/leaderboard', { ...submission(`T${RUN}b`), loadout: [{ type: 'arc', rarity: 1 }] });
    expect(bad.status).toBe(400);
    const area = await post('/api/leaderboard?board=house', { ...areaSub(`T${RUN}ka`), loadout: [{ type: 'grounding', rarity: 1 }] });
    expect(area.status).toBe(201);
    expect(((await area.json()) as { entry: { loadout?: unknown } }).entry.loadout).toEqual([{ type: 'grounding', rarity: 1, grade: 2 }]);
    const top = (await (await call(leaderboardApi, '/api/leaderboard?character=lint')).json()) as { entries: Array<{ name: string; loadout?: unknown }> };
    expect(top.entries.find((e) => e.name === `T${RUN}k`)?.loadout ?? returned).toEqual(returned);
  });

  it('stores and returns universes on the Run board; older clients without it are still accepted', async () => {
    const post = (body: unknown) =>
      call(leaderboardApi, '/api/leaderboard', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': `${IP}-universes` } });
    const withCount = await post({ ...submission(`T${RUN}u`), universes: 2 });
    expect(withCount.status).toBe(201);
    expect(((await withCount.json()) as { entry: { universes?: unknown } }).entry.universes).toBe(2);
    const older = await post(submission(`T${RUN}uo`));
    expect(older.status).toBe(201);
    expect('universes' in ((await older.json()) as { entry: object }).entry).toBe(false);
    expect((await post({ ...submission(`T${RUN}ub`), universes: -1 })).status).toBe(400);
    const top = (await (await call(leaderboardApi, '/api/leaderboard?character=lint')).json()) as { entries: Array<{ name: string; universes?: unknown }> };
    const listed = top.entries.find((e) => e.name === `T${RUN}u`);
    if (listed) expect(listed.universes).toBe(2);
  });

  it('keeps Area boards separate from the Run board and from each other', async () => {
    const res = await post('/api/leaderboard?board=house', areaSub(`T${RUN}h`, { maxRadius: 159 }));
    expect(res.status).toBe(201);
    const { entry, rank } = (await res.json()) as { entry: { id: string; area: string; radiusIn: number; maxRadius: number; verified: boolean }; rank: number };
    expect(entry).toMatchObject({ area: 'house', radiusIn: 1, maxRadius: 159, verified: false });
    expect(rank).toBe(1);

    const house = (await (await call(leaderboardApi, '/api/leaderboard?board=house')).json()) as { entries: Array<{ id: string }> };
    expect(house.entries[0]?.id).toBe(entry.id);
    // Ids come from separate sequences per table, so compare names.
    const city = (await (await call(leaderboardApi, '/api/leaderboard?board=city')).json()) as { entries: Array<{ name: string }> };
    expect(city.entries.some((e) => e.name === `T${RUN}h`)).toBe(false);
    const run = (await (await call(leaderboardApi, '/api/leaderboard')).json()) as { entries: Array<{ name: string }> };
    expect(run.entries.some((e) => e.name === `T${RUN}h`)).toBe(false);

    // The body's Area must match the board it is posted to.
    expect((await post('/api/leaderboard?board=city', areaSub(`T${RUN}x`))).status).toBe(400);
    expect((await call(leaderboardApi, '/api/leaderboard?board=moon')).status).toBe(400);
  });

  it('returns the stored entry when the same Run posts again', async () => {
    const runId = `run-${RUN}-dupe`;
    const first = await post('/api/leaderboard', submission(`T${RUN}d`, { runId }));
    expect(first.status).toBe(201);
    const again = await post('/api/leaderboard', submission(`T${RUN}d`, { runId }));
    expect(again.status).toBe(200);
    const a = (await first.json()) as { entry: { id: string } };
    const b = (await again.json()) as { entry: { id: string } };
    expect(b.entry.id).toBe(a.entry.id);
    // Same Run id on an Area board is a different entry.
    expect((await post('/api/leaderboard?board=house', areaSub(`T${RUN}d`, { runId }))).status).toBe(201);
    expect((await post('/api/leaderboard?board=house', areaSub(`T${RUN}d`, { runId }))).status).toBe(200);
    const rows = await query<{ n: number }>(`SELECT count(*)::int AS n FROM area_scores WHERE run_id = $1`, [runId]);
    expect(rows[0]?.n).toBe(1);
  });

  it('lists a signed-in player once, with their best entry', async () => {
    const cookie = await signUp(`Best${RUN}`);
    const huge = 1100; // near the plausibility bound for 400 s in the City, so these lead its Zap board
    const lo = (await (await post('/api/leaderboard?board=city', areaSub(`T${RUN}b1`, { area: 'city', maxRadius: huge - 1 }), cookie)).json()) as { entry: { id: string }; rank: number };
    const hi = (await (await post('/api/leaderboard?board=city', areaSub(`T${RUN}b2`, { area: 'city', maxRadius: huge }), cookie)).json()) as { entry: { id: string }; rank: number };
    const anon = (await (await post('/api/leaderboard?board=city', areaSub(`T${RUN}b3`, { area: 'city', maxRadius: huge - 0.5 }))).json()) as { entry: { id: string }; rank: number };
    const top = (await (await call(leaderboardApi, '/api/leaderboard?board=city&character=zap')).json()) as { entries: Array<{ id: string }> };
    const ids = top.entries.map((e) => e.id);
    expect(ids.slice(0, 2)).toEqual([hi.entry.id, anon.entry.id]);
    expect(ids).not.toContain(lo.entry.id);
    expect(hi.rank).toBe(1);
    expect(anon.rank).toBe(2);
    // A later, weaker Run ranks where it would sit in that list: under the player's own best.
    const later = (await (await post('/api/leaderboard?board=city', areaSub(`T${RUN}b4`, { area: 'city', maxRadius: huge - 0.75 }), cookie)).json()) as { rank: number };
    expect(later.rank).toBe(3);
  });

  it('requires a session for progress', async () => {
    expect((await call(progressApi, '/api/progress')).status).toBe(401);
    expect((await call(progressApi, '/api/progress', { method: 'PUT', body: JSON.stringify(progress(1, 1, 1)) })).status).toBe(401);
  });

  it('stores progress and refuses to overwrite it with less', async () => {
    const cookie = await signUp(`Prog${RUN}`);
    const get = async () => (await (await call(progressApi, '/api/progress', { cookie })).json()) as { progress: Progress | null };
    const put = async (p: Progress) => (await (await call(progressApi, '/api/progress', { method: 'PUT', cookie, body: JSON.stringify(p) })).json()) as { accepted: boolean; progress: Progress };

    expect((await get()).progress).toBeNull();

    const first = progress(120, 150, 3, { fast_feet: 1 });
    expect(await put(first)).toMatchObject({ accepted: true, progress: first });

    // Another device with less lifetime progress: rejected, and it gets the stored copy back.
    const stale = progress(500, 100, 9);
    expect(await put(stale)).toMatchObject({ accepted: false, progress: first });

    // Spending Fluff keeps the totals: accepted.
    const spent = progress(40, 150, 3, { fast_feet: 2 });
    expect(await put(spent)).toMatchObject({ accepted: true, progress: spent });
    expect((await get()).progress).toEqual(spent);

    const bad = await call(progressApi, '/api/progress', { method: 'PUT', cookie, body: JSON.stringify({ ...spent, fluff: -5 }) });
    expect(bad.status).toBe(400);
  });

  it('syncs Keepsake Hoards and keeps them when an older bundle omits the field', async () => {
    const cookie = await signUp(`Ks${RUN}`);
    const put = async (p: unknown) => (await (await call(progressApi, '/api/progress', { method: 'PUT', cookie, body: JSON.stringify(p) })).json()) as { accepted: boolean; progress: Progress };
    const hoards = { lint: { hoard: { 'reclaim:common': 3 }, bossesBeaten: ['robovac_9000'] } };
    const first = { ...progress(100, 100, 2, {}, hoards), stats: { ...progress(100, 100, 2).stats, keepsakesEarned: 3 } };
    expect(await put(first)).toMatchObject({ accepted: true, progress: first });
    // An older bundle: no characters, no keepsakesEarned.
    const { characters: _c, ...older } = progress(120, 130, 3);
    const { keepsakesEarned: _k, ...olderStats } = older.stats;
    const res = await put({ ...older, stats: olderStats });
    expect(res.accepted).toBe(true);
    expect(res.progress.characters).toEqual(hoards);
    expect(res.progress.stats.keepsakesEarned).toBe(3);
    expect(res.progress.fluff).toBe(120);
    // Felting (fewer Keepsakes, less Fluff, same counters) still syncs.
    const felted = progress(0, 130, 3, {}, { lint: { hoard: { 'reclaim:rare': 1 }, bossesBeaten: ['robovac_9000'] } });
    expect((await put(felted)).progress.characters).toEqual(felted.characters);
    // A bundle from before rarities uploads grades 1–10: stored as rarities, two grades to one.
    const legacy = progress(0, 140, 4, {}, { lint: { hoard: { 'reclaim:3': 1, 'reclaim:4': 1 }, bossesBeaten: ['robovac_9000'] } });
    expect((await put(legacy)).progress.characters).toEqual({ lint: { hoard: { 'reclaim:rare': 2 }, bossesBeaten: ['robovac_9000'] } });
    const bad = await call(progressApi, '/api/progress', { method: 'PUT', cookie, body: JSON.stringify({ ...felted, characters: { lint: { hoard: { 'arc:1': 1 }, bossesBeaten: [] } } }) });
    expect(bad.status).toBe(400);
  });

  it('syncs Loadouts and keeps them when an older bundle omits the field', async () => {
    const cookie = await signUp(`Lo${RUN}`);
    const get = async () => (await (await call(progressApi, '/api/progress', { cookie })).json()) as { progress: Progress | null };
    const put = async (p: unknown) => (await (await call(progressApi, '/api/progress', { method: 'PUT', cookie, body: JSON.stringify(p) })).json()) as { accepted: boolean; progress: Progress };
    const hoards = { lint: { hoard: { 'reclaim:rare': 2 }, bossesBeaten: ['robovac_9000'] } };
    // A row stored without Loadouts reads back without the field.
    await put(progress(100, 100, 2, {}, hoards));
    expect((await get()).progress).not.toHaveProperty('loadouts');
    const loadouts = { lint: [{ type: 'reclaim', rarity: 2 }, { type: 'reclaim', rarity: 2 }] };
    // Tucking in changes no counter: a tie, stored like spending.
    expect(await put({ ...progress(100, 100, 2, {}, hoards), loadouts })).toMatchObject({ accepted: true, progress: { loadouts } });
    // An older bundle (no loadouts) keeps them.
    expect((await put(progress(120, 130, 3, {}, hoards))).progress.loadouts).toEqual(loadouts);
    // Emptied on a device: stored empty.
    expect((await put({ ...progress(120, 130, 3, {}, hoards), loadouts: {} })).progress.loadouts).toEqual({});
    const bad = await call(progressApi, '/api/progress', { method: 'PUT', cookie, body: JSON.stringify({ ...progress(120, 130, 3), loadouts: { lint: [{ type: 'arc', rarity: 1 }] } }) });
    expect(bad.status).toBe(400);
  });

  it('never lowers universes, even when an upload is refused or an older bundle omits it', async () => {
    const cookie = await signUp(`Uni${RUN}`);
    const put = async (p: unknown) => (await (await call(progressApi, '/api/progress', { method: 'PUT', cookie, body: JSON.stringify(p) })).json()) as { accepted: boolean; progress: Progress };
    expect(await put(progress(100, 100, 2, {}, {}, 2))).toMatchObject({ accepted: true, progress: { universes: 2 } });
    // Accepted with a lower count (another device): the stored count stays.
    expect(await put(progress(120, 130, 3, {}, {}, 1))).toMatchObject({ accepted: true, progress: { universes: 2 } });
    // An older bundle without the field.
    const { universes: _u, ...older } = progress(130, 140, 4);
    expect(await put(older)).toMatchObject({ accepted: true, progress: { universes: 2 } });
    // Refused (less lifetime progress), but its higher count is kept.
    expect(await put(progress(0, 10, 1, {}, {}, 5))).toMatchObject({ accepted: false, progress: { fluff: 130, universes: 5 } });
    expect((await call(progressApi, '/api/progress', { method: 'PUT', cookie, body: JSON.stringify({ ...older, universes: 1.5 }) })).status).toBe(400);
  });

  describe('saved Run (api/saved-run.ts)', () => {
    const send = (cookie: string | undefined, method: string, body?: unknown) =>
      call(savedRunApi, '/api/saved-run', { method, cookie, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const getRun = async (cookie: string) => ((await (await send(cookie, 'GET')).json()) as { savedRun: { runKey: string; lease: string; version: number | null; snapshot: Record<string, unknown> | null } | null }).savedRun;

    it('requires a session', async () => {
      expect((await send(undefined, 'GET')).status).toBe(401);
      expect((await send(undefined, 'PUT', { runKey: 'r', lease: 'l', snapshot: runSnapshot('r') })).status).toBe(401);
      expect((await send(undefined, 'POST', { runKey: 'r', lease: 'l', newLease: 'm' })).status).toBe(401);
      expect((await send(undefined, 'DELETE', { runKey: 'r', lease: 'l' })).status).toBe(401);
    });

    it('stores, returns, takes and refuses a stale lease', async () => {
      const cookie = await signUp(`Sr${RUN}`);
      expect(await getRun(cookie)).toBeNull();
      // Pause on device A.
      const put = await send(cookie, 'PUT', { runKey: 'run-1', lease: 'a1', snapshot: runSnapshot('run-1') });
      expect(put.status).toBe(200);
      expect(await put.json()).toEqual({ stored: true, replaced: null, credits: [] });
      expect(await getRun(cookie)).toMatchObject({ runKey: 'run-1', lease: 'a1', version: SNAPSHOT_VERSION, snapshot: runSnapshot('run-1') });
      // Pausing again under the same lease just stores it.
      expect((await send(cookie, 'PUT', { runKey: 'run-1', lease: 'a1', snapshot: runSnapshot('run-1', { savedAt: 2 }) })).status).toBe(200);
      // Device B resumes it: the snapshot comes back, the row stays with B's lease and no snapshot.
      const take = await send(cookie, 'POST', { runKey: 'run-1', lease: 'a1', newLease: 'b1' });
      expect(take.status).toBe(200);
      expect(await take.json()).toMatchObject({ taken: true, snapshot: { runKey: 'run-1', savedAt: 2 } });
      expect(await getRun(cookie)).toMatchObject({ runKey: 'run-1', lease: 'b1', snapshot: null, version: null });
      // Retrying the take that won (a lost response) still succeeds.
      expect((await send(cookie, 'POST', { runKey: 'run-1', lease: 'a1', newLease: 'b1' })).status).toBe(200);
      // A unpauses: its take back is refused, and so is a later store under its old lease.
      const stale = await send(cookie, 'POST', { runKey: 'run-1', lease: 'a1', newLease: 'a2' });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ error: 'carried_on', savedRun: { runKey: 'run-1', lease: 'b1' } });
      const late = await send(cookie, 'PUT', { runKey: 'run-1', lease: 'a1', snapshot: runSnapshot('run-1') });
      expect(late.status).toBe(409);
      expect(((await late.json()) as { error: string }).error).toBe('carried_on');
      // B pauses with a take it never heard back from (prevLease): accepted, and the lease is B's new one.
      expect((await send(cookie, 'PUT', { runKey: 'run-1', lease: 'b2', prevLease: 'b1', snapshot: runSnapshot('run-1') })).status).toBe(200);
      expect((await getRun(cookie))?.lease).toBe('b2');
      // Ending the Run deletes the row, only for the lease that holds it.
      expect(await (await send(cookie, 'DELETE', { runKey: 'run-1', lease: 'a1' })).json()).toMatchObject({ deleted: false });
      expect(await (await send(cookie, 'DELETE', { runKey: 'run-1', lease: 'b2' })).json()).toMatchObject({ deleted: true, snapshot: { runKey: 'run-1' } });
      expect(await getRun(cookie)).toBeNull();
    });

    it('remembers a Run that ended, so a device that fell behind can’t store or take it again', async () => {
      const cookie = await signUp(`Sre${RUN}`);
      await send(cookie, 'PUT', { runKey: 'done', lease: 'a1', snapshot: runSnapshot('done') });
      expect((await send(cookie, 'POST', { runKey: 'done', lease: 'a1', newLease: 'b1' })).status).toBe(200);
      expect(await (await send(cookie, 'DELETE', { runKey: 'done', lease: 'b1' })).json()).toMatchObject({ deleted: true });
      expect(await getRun(cookie)).toBeNull();
      // A's upload under the lease it had (and B's own, late) are refused: the Run is over.
      for (const body of [
        { runKey: 'done', lease: 'a2', prevLease: 'a1', snapshot: runSnapshot('done') },
        { runKey: 'done', lease: 'b1', snapshot: runSnapshot('done') },
      ]) {
        const late = await send(cookie, 'PUT', body);
        expect(late.status).toBe(409);
        expect(((await late.json()) as { error: string }).error).toBe('run_ended');
      }
      const take = await send(cookie, 'POST', { runKey: 'done', lease: 'b1', newLease: 'b2' });
      expect(take.status).toBe(409);
      expect(await take.json()).toMatchObject({ error: 'carried_on', savedRun: { runKey: 'done', snapshot: null } });
      expect(await (await send(cookie, 'DELETE', { runKey: 'done', lease: 'b1' })).json()).toMatchObject({ deleted: false });
      expect(await getRun(cookie)).toBeNull();
      // Another Run is stored over it as over an empty slot (nothing to credit).
      expect(await (await send(cookie, 'PUT', { runKey: 'next', lease: 'c1', snapshot: runSnapshot('next') })).json()).toEqual({ stored: true, replaced: null, credits: [] });
      expect(await getRun(cookie)).toMatchObject({ runKey: 'next', lease: 'c1' });
    });

    it('records a Run abandoned before its upload arrived as ended, without touching a Run still going', async () => {
      const cookie = await signUp(`Sra${RUN}`);
      expect(await (await send(cookie, 'DELETE', { runKey: 'early', lease: 'a1' })).json()).toMatchObject({ deleted: false });
      expect(await getRun(cookie)).toBeNull();
      expect((await send(cookie, 'PUT', { runKey: 'early', lease: 'a1', snapshot: runSnapshot('early') })).status).toBe(409);
      // A Run another device stored is left alone by a delete for a different one.
      await send(cookie, 'PUT', { runKey: 'kept', lease: 'b1', snapshot: runSnapshot('kept') });
      expect(await (await send(cookie, 'DELETE', { runKey: 'early', lease: 'a1' })).json()).toMatchObject({ deleted: false });
      expect(await getRun(cookie)).toMatchObject({ runKey: 'kept', lease: 'b1', snapshot: { runKey: 'kept' } });
    });

    it('replaces a different Run and returns it for the quit credit; keeps one from a newer version', async () => {
      const cookie = await signUp(`Srr${RUN}`);
      await send(cookie, 'PUT', { runKey: 'old-run', lease: 'x', snapshot: runSnapshot('old-run') });
      const res = await send(cookie, 'PUT', { runKey: 'new-run', lease: 'y', snapshot: runSnapshot('new-run') });
      expect(await res.json()).toMatchObject({ stored: true, replaced: { runKey: 'old-run', snapshot: { runKey: 'old-run' } } });
      // A newer build's Run (unknown fields and all) is stored as it is...
      const newer = { ...runSnapshot('newer-run'), version: SNAPSHOT_VERSION + 1, characterId: 7, somethingNew: { a: 1 } };
      expect((await send(cookie, 'PUT', { runKey: 'newer-run', lease: 'z', snapshot: newer })).status).toBe(200);
      expect(await getRun(cookie)).toMatchObject({ runKey: 'newer-run', version: SNAPSHOT_VERSION + 1, snapshot: newer });
      // ...and an older build can't replace it.
      const refused = await send(cookie, 'PUT', { runKey: 'other-run', lease: 'w', snapshot: runSnapshot('other-run') });
      expect(refused.status).toBe(409);
      expect(((await refused.json()) as { error: string }).error).toBe('newer_saved_run');
      expect((await getRun(cookie))?.snapshot).toEqual(newer);
    });

    it('lets exactly one of two racing takes win', async () => {
      const cookie = await signUp(`Srx${RUN}`);
      await send(cookie, 'PUT', { runKey: 'race', lease: 'a', snapshot: runSnapshot('race') });
      const results = await Promise.all(['b', 'c', 'd', 'e'].map((l) => send(cookie, 'POST', { runKey: 'race', lease: 'a', newLease: l })));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 409, 409, 409]);
      const winner = ['b', 'c', 'd', 'e'][results.findIndex((r) => r.status === 200)];
      expect((await getRun(cookie))?.lease).toBe(winner);
    });

    it('validates the body and caps its size', async () => {
      const cookie = await signUp(`Srv${RUN}`);
      expect((await send(cookie, 'PUT', { runKey: '', lease: 'l', snapshot: runSnapshot('') })).status).toBe(400);
      expect((await send(cookie, 'PUT', { runKey: 'r', lease: 'l', snapshot: { ...runSnapshot('r'), version: 'one' } })).status).toBe(400);
      expect((await send(cookie, 'PUT', { runKey: 'r', lease: 'l', snapshot: runSnapshot('other') })).status).toBe(400);
      expect((await send(cookie, 'PUT', { runKey: 'r', lease: 'l', snapshot: runSnapshot('r', { loadout: [{ type: 'reclaim', rarity: 1 }] }) })).status).toBe(400);
      expect((await send(cookie, 'POST', { runKey: 'r', lease: 'l' })).status).toBe(400);
      const huge = runSnapshot('r', { placementsGone: Array.from({ length: MAX_SAVED_RUN_BYTES / 4 }, (_, i) => i) });
      const tooBig = await send(cookie, 'PUT', { runKey: 'r', lease: 'l', snapshot: huge });
      expect(tooBig.status).toBe(413);
      expect(await getRun(cookie)).toBeNull();
      expect((await send(cookie, 'PATCH', {})).status).toBe(405);
    });
  });

  describe('Run credit ledger (api/run-credit.ts, docs/adr/0003)', () => {
    const stats = { maxRadius: 120, debrisAbsorbed: 80, tierReached: 4, area: 'house' };
    const send = (cookie: string | undefined, method: string, body?: unknown, path = '/api/run-credit') =>
      call(runCreditApi, path, { method, cookie, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const savedRun = (cookie: string, method: string, body?: unknown) =>
      call(savedRunApi, '/api/saved-run', { method, cookie, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const claimed = async (cookie: string, body: Record<string, unknown>) => {
      const res = await send(cookie, 'POST', { reason: 'died', stats, ...body });
      return { status: res.status, body: (await res.json()) as { credit?: RunCredit; created?: boolean; error?: string } };
    };
    const listed = async (cookie: string, limit?: number) => ((await (await send(cookie, 'GET', undefined, limit === undefined ? undefined : `/api/run-credit?limit=${limit}`)).json()) as { credits: RunCredit[] }).credits;
    /** A snapshot whose stats crediting can read. */
    const snap = (runKey: string) => runSnapshot(runKey, { stats: { ...stats, seed: 'saved', timeSec: 30 } });

    it('requires a session', async () => {
      expect((await send(undefined, 'GET')).status).toBe(401);
      expect((await send(undefined, 'POST', { runKey: 'r', lease: 'l', reason: 'died', stats })).status).toBe(401);
    });

    it('credits the holder once, marks the row ended, and gives every later claim the same row', async () => {
      const cookie = await signUp(`Rc${RUN}`);
      await savedRun(cookie, 'PUT', { runKey: 'run-1', lease: 'a1', snapshot: snap('run-1') });
      // Another device holds it: refused, nothing written.
      const other = await claimed(cookie, { runKey: 'run-1', lease: 'b1' });
      expect(other.status).toBe(409);
      expect(other.body.error).toBe('carried_on');
      expect(await listed(cookie)).toEqual([]);
      // The holder (under a take it never heard back from) claims it: credited, with the picked stats.
      const first = await claimed(cookie, { runKey: 'run-1', lease: 'a2', prevLease: 'a1' });
      expect(first.status).toBe(200);
      expect(first.body.created).toBe(true);
      expect(first.body.credit).toMatchObject({ runKey: 'run-1', reason: 'died', stats });
      expect((first.body.credit!.stats as Record<string, unknown>).seed).toBeUndefined();
      // The row is ended: a take or an upload of the Run is refused, GET shows none.
      expect((await savedRun(cookie, 'POST', { runKey: 'run-1', lease: 'a1', newLease: 'c1' })).status).toBe(409);
      const late = await savedRun(cookie, 'PUT', { runKey: 'run-1', lease: 'a1', snapshot: snap('run-1') });
      expect(late.status).toBe(409);
      expect(((await late.json()) as { error: string }).error).toBe('run_ended');
      expect(((await (await savedRun(cookie, 'GET')).json()) as { savedRun: unknown }).savedRun).toBeNull();
      // A retry (a lost answer), and a claim from any other lease with other stats: the same row, not created again.
      for (const body of [
        { runKey: 'run-1', lease: 'a2', prevLease: 'a1' },
        { runKey: 'run-1', lease: 'zzz', reason: 'quit', stats: { ...stats, tierReached: 9 } },
      ]) {
        const again = await claimed(cookie, body);
        expect(again.status).toBe(200);
        expect(again.body.created).toBe(false);
        expect(again.body.credit).toEqual(first.body.credit);
      }
      expect(await listed(cookie)).toEqual([first.body.credit]);
    });

    it('credits a Run the server never had, and remembers it as ended without touching a Run still going', async () => {
      const cookie = await signUp(`Rn${RUN}`);
      await savedRun(cookie, 'PUT', { runKey: 'kept', lease: 'k1', snapshot: snap('kept') });
      const res = await claimed(cookie, { runKey: 'never-uploaded', lease: 'n1', reason: 'victory' });
      expect(res.status).toBe(200);
      expect(res.body.created).toBe(true);
      // The stored Run is left alone; the never-uploaded one can't be stored late.
      expect(((await (await savedRun(cookie, 'GET')).json()) as { savedRun: { runKey: string } }).savedRun).toMatchObject({ runKey: 'kept', lease: 'k1' });
      expect((await savedRun(cookie, 'PUT', { runKey: 'never-uploaded', lease: 'n1', snapshot: snap('never-uploaded') })).status).toBe(409);
    });

    it('refuses to credit a Run an older client ended and credited itself', async () => {
      const cookie = await signUp(`Ro${RUN}`);
      await savedRun(cookie, 'PUT', { runKey: 'old-way', lease: 'o1', snapshot: snap('old-way') });
      expect(await (await savedRun(cookie, 'DELETE', { runKey: 'old-way', lease: 'o1' })).json()).toMatchObject({ deleted: true });
      const res = await claimed(cookie, { runKey: 'old-way', lease: 'o1' });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('run_ended');
      expect(await listed(cookie)).toEqual([]);
    });

    it('records a replaced Run as a quit only for a ledger client, and refuses a ledgered Run whatever the row holds', async () => {
      const cookie = await signUp(`Rr${RUN}`);
      // A client from before the ledger replaces: `replaced` comes back, nothing in the ledger.
      await savedRun(cookie, 'PUT', { runKey: 'run-a', lease: 'a1', snapshot: snap('run-a') });
      const plain = (await (await savedRun(cookie, 'PUT', { runKey: 'run-b', lease: 'b1', snapshot: snap('run-b') })).json()) as { replaced: unknown; credits: unknown[] };
      expect(plain.replaced).toMatchObject({ runKey: 'run-a' });
      expect(plain.credits).toEqual([]);
      expect(await listed(cookie)).toEqual([]);
      // A ledger client replaces run-b: the ledger gets run-b's quit, with the stored snapshot's stats.
      const ledger = (await (await savedRun(cookie, 'PUT', { runKey: 'run-c', lease: 'c1', snapshot: snap('run-c'), ledger: true })).json()) as { replaced: unknown; credits: RunCredit[] };
      expect(ledger.replaced).toMatchObject({ runKey: 'run-b' });
      expect(ledger.credits).toHaveLength(1);
      expect(ledger.credits[0]).toMatchObject({ runKey: 'run-b', reason: 'quit', stats });
      expect(await listed(cookie)).toEqual(ledger.credits);
      // The device that fell behind on run-b (now that run-c is stored) can't store it over run-c: the ledger remembers.
      const late = await savedRun(cookie, 'PUT', { runKey: 'run-b', lease: 'b1', snapshot: snap('run-b'), ledger: true });
      expect(late.status).toBe(409);
      expect(((await late.json()) as { error: string }).error).toBe('run_ended');
      expect(((await (await savedRun(cookie, 'GET')).json()) as { savedRun: { runKey: string } }).savedRun).toMatchObject({ runKey: 'run-c' });
      // Its own claim for run-b gets the replace's row, not a second credit.
      const claim = await claimed(cookie, { runKey: 'run-b', lease: 'b1', reason: 'quit' });
      expect(claim.status).toBe(200);
      expect(claim.body.created).toBe(false);
      expect(claim.body.credit).toEqual(ledger.credits[0]);
      // Storing the same Run again under the same lease (a second pause) credits nothing.
      const again = (await (await savedRun(cookie, 'PUT', { runKey: 'run-c', lease: 'c1', snapshot: snap('run-c'), ledger: true })).json()) as { credits: unknown[] };
      expect(again.credits).toEqual([]);
    });

    it('credits a Universe-sized Run with its stats intact: radii are real centimetres', async () => {
      const cookie = await signUp(`Ru${RUN}`);
      const universe = { maxRadius: SCORE_TIER_MIN_RADII[SCORE_TIER_MIN_RADII.length - 1]! * 1.5, debrisAbsorbed: 3_000_000, tierReached: SCORE_TIER_MIN_RADII.length, area: 'universe', universeCleared: true,
        areas: [{ area: 'galaxy', radiusIn: 9.461e19, maxRadius: 2.9e20, debrisAbsorbed: 5000, cleared: true }, { area: 'universe', radiusIn: 9.461e24, maxRadius: 2.9e25, debrisAbsorbed: 7000, cleared: true }] };
      // The holder's claim keeps every number.
      const won = await claimed(cookie, { runKey: 'big', lease: 'u1', reason: 'victory', stats: universe });
      expect(won.status).toBe(200);
      expect(won.body.credit!.stats).toEqual(universe);
      // A replace credits the stored Universe Run from its snapshot, not from zeros.
      await savedRun(cookie, 'PUT', { runKey: 'big-2', lease: 'u2', snapshot: runSnapshot('big-2', { stats: { ...universe, seed: 'saved', timeSec: 9000 } }) });
      const res = (await (await savedRun(cookie, 'PUT', { runKey: 'next', lease: 'u3', snapshot: snap('next'), ledger: true })).json()) as { credits: RunCredit[] };
      expect(res.credits[0]).toMatchObject({ runKey: 'big-2', reason: 'quit', stats: universe });
      // Past the bound is still garbage.
      expect((await send(cookie, 'POST', { runKey: 'absurd', lease: 'x', reason: 'died', stats: { ...stats, maxRadius: CREDIT_STATS_BOUNDS.radius * 10 } })).status).toBe(400);
    });

    it('salvages a stored copy whose stats do not read whole, falling back to zeros only for nothing at all', async () => {
      const cookie = await signUp(`Rs${RUN}`);
      // A snapshot whose maxRadius is broken but whose other numbers are fine.
      await savedRun(cookie, 'PUT', { runKey: 'odd', lease: 'o1', snapshot: runSnapshot('odd', { stats: { seed: 's', timeSec: 1, maxRadius: 'big', debrisAbsorbed: 77, tierReached: 3, characterId: 'zap' } }) });
      let res = (await (await savedRun(cookie, 'PUT', { runKey: 'odd-2', lease: 'o2', snapshot: runSnapshot('odd-2', { stats: { seed: 'none' } }), ledger: true })).json()) as { credits: RunCredit[] };
      expect(res.credits[0]).toMatchObject({ runKey: 'odd', stats: { maxRadius: 0, debrisAbsorbed: 77, tierReached: 3, characterId: 'zap' } });
      // No stats at all: zeros, but still credited.
      res = (await (await savedRun(cookie, 'PUT', { runKey: 'odd-3', lease: 'o3', snapshot: snap('odd-3'), ledger: true })).json()) as { credits: RunCredit[] };
      expect(res.credits[0]).toMatchObject({ runKey: 'odd-2', stats: { maxRadius: 0, debrisAbsorbed: 0, tierReached: 0 } });
    });

    it('refuses a ledger client’s claim for a Run a client from before the ledger replaced or ended (credited there), for good', async () => {
      const cookie = await signUp(`Rleg${RUN}`);
      // An old tab replaces run-x without `ledger`: it credits `replaced` locally; the server writes no ledger row.
      await savedRun(cookie, 'PUT', { runKey: 'run-x', lease: 'x1', snapshot: snap('run-x') });
      const plain = (await (await savedRun(cookie, 'PUT', { runKey: 'run-y', lease: 'y1', snapshot: snap('run-y') })).json()) as { replaced: unknown; credits: unknown[] };
      expect(plain.replaced).toMatchObject({ runKey: 'run-x' });
      expect(await listed(cookie)).toEqual([]);
      // A new tab with a stale synced copy of run-x claims it: already credited elsewhere, so run_ended and no row.
      const claim = await claimed(cookie, { runKey: 'run-x', lease: 'x1', reason: 'quit' });
      expect(claim.status).toBe(409);
      expect(claim.body.error).toBe('run_ended');
      expect(await listed(cookie)).toEqual([]);
      // Nor can it be stored or taken again, even after the slot has moved on through other Runs.
      expect((await savedRun(cookie, 'PUT', { runKey: 'run-z', lease: 'z1', snapshot: snap('run-z'), ledger: true })).status).toBe(200);
      const late = await savedRun(cookie, 'PUT', { runKey: 'run-x', lease: 'x1', snapshot: snap('run-x'), ledger: true });
      expect(late.status).toBe(409);
      expect(((await late.json()) as { error: string }).error).toBe('run_ended');
      expect((await claimed(cookie, { runKey: 'run-x', lease: 'x1' })).status).toBe(409);
      // The same for a Run an old tab ended with DELETE, once another Run has taken its slot.
      await savedRun(cookie, 'PUT', { runKey: 'run-d', lease: 'd1', snapshot: snap('run-d') });
      expect(await (await savedRun(cookie, 'DELETE', { runKey: 'run-d', lease: 'd1' })).json()).toMatchObject({ deleted: true });
      await savedRun(cookie, 'PUT', { runKey: 'run-e', lease: 'e1', snapshot: snap('run-e'), ledger: true });
      const dead = await claimed(cookie, { runKey: 'run-d', lease: 'd1' });
      expect(dead.status).toBe(409);
      expect(dead.body.error).toBe('run_ended');
      expect((await listed(cookie)).map((c) => c.runKey)).toEqual(['run-y']);
    });

    it('keeps a Run with the device playing it when another device’s new Run replaces it in the slot', async () => {
      const cookie = await signUp(`Rabc${RUN}`);
      // A pauses X; B resumes it (X in play on B); C synced a copy of X while it was stored under A's lease.
      await savedRun(cookie, 'PUT', { runKey: 'X', lease: 'a1', snapshot: snap('X') });
      expect((await savedRun(cookie, 'POST', { runKey: 'X', lease: 'a1', newLease: 'b1' })).status).toBe(200);
      // A starts a new Run Y and pauses it: Y replaces X in the slot. X was in play, so nothing is credited.
      const putY = (await (await savedRun(cookie, 'PUT', { runKey: 'Y', lease: 'a2', snapshot: snap('Y'), ledger: true })).json()) as { replaced: unknown; credits: unknown[] };
      expect(putY).toMatchObject({ replaced: null, credits: [] });
      // C, holding its stale copy of X, claims it: X is B's, so refused, and nothing written.
      const stale = await claimed(cookie, { runKey: 'X', lease: 'a1', reason: 'quit' });
      expect(stale.status).toBe(409);
      expect(stale.body.error).toBe('carried_on');
      expect(await listed(cookie)).toEqual([]);
      // C can't store it or take it back either.
      expect((await savedRun(cookie, 'PUT', { runKey: 'X', lease: 'a1', snapshot: snap('X'), ledger: true })).status).toBe(409);
      expect((await savedRun(cookie, 'POST', { runKey: 'X', lease: 'a1', newLease: 'c1' })).status).toBe(409);
      // B pauses X: stored again (over Y, which is credited as a quit, as any stored Run a pause replaces).
      const putX = (await (await savedRun(cookie, 'PUT', { runKey: 'X', lease: 'b1', snapshot: snap('X'), ledger: true })).json()) as { replaced: { runKey: string } | null; credits: RunCredit[] };
      expect(putX.replaced).toMatchObject({ runKey: 'Y' });
      expect(putX.credits.map((c) => c.runKey)).toEqual(['Y']);
      // B resumes and finishes X: credited once, to B; C's claim then gets that row.
      expect((await savedRun(cookie, 'POST', { runKey: 'X', lease: 'b1', newLease: 'b2' })).status).toBe(200);
      const done = await claimed(cookie, { runKey: 'X', lease: 'b2', stats: { ...stats, tierReached: 7 } });
      expect(done.status).toBe(200);
      expect(done.body.created).toBe(true);
      const again = await claimed(cookie, { runKey: 'X', lease: 'a1', reason: 'quit' });
      expect(again.status).toBe(200);
      expect(again.body.created).toBe(false);
      expect(again.body.credit).toEqual(done.body.credit);
    });

    it('lets the device playing a Run end it (and claim it) after another Run replaced it in the slot', async () => {
      const cookie = await signUp(`Rbd${RUN}`);
      await savedRun(cookie, 'PUT', { runKey: 'X', lease: 'a1', snapshot: snap('X') });
      expect((await savedRun(cookie, 'POST', { runKey: 'X', lease: 'a1', newLease: 'b1' })).status).toBe(200);
      await savedRun(cookie, 'PUT', { runKey: 'Y', lease: 'a2', snapshot: snap('Y'), ledger: true });
      // B dies on X: credited, and Y (A's, stored) is left alone.
      const died = await claimed(cookie, { runKey: 'X', lease: 'b1' });
      expect(died.status).toBe(200);
      expect(died.body.created).toBe(true);
      expect(((await (await savedRun(cookie, 'GET')).json()) as { savedRun: { runKey: string } }).savedRun).toMatchObject({ runKey: 'Y', snapshot: { runKey: 'Y' } });
      // The same with an old-client DELETE: the holder decides, so B's end counts, and a later claim is refused.
      await savedRun(cookie, 'PUT', { runKey: 'P', lease: 'p1', snapshot: snap('P') });
      expect((await savedRun(cookie, 'POST', { runKey: 'P', lease: 'p1', newLease: 'q1' })).status).toBe(200);
      await savedRun(cookie, 'PUT', { runKey: 'R', lease: 'r1', snapshot: snap('R'), ledger: true });
      expect(await (await savedRun(cookie, 'DELETE', { runKey: 'P', lease: 'q1' })).json()).toMatchObject({ deleted: true, snapshot: null });
      expect((await claimed(cookie, { runKey: 'P', lease: 'q1' })).body.error).toBe('run_ended');
      expect((await listed(cookie)).map((c) => c.runKey)).toEqual(['X']);
    });

    it('never leaves a Run both credited and resumable when a store and a claim for it race', async () => {
      const cookie = await signUp(`Rrace${RUN}`);
      // The pagehide flush: a pause (PUT) and a quit claim for the same Run leave together, from an empty slot.
      for (let i = 0; i < 6; i++) {
        const key = `flush-${i}`;
        const [put, claim] = await Promise.all([
          savedRun(cookie, 'PUT', { runKey: key, lease: `l${i}`, snapshot: snap(key), ledger: true }),
          claimed(cookie, { runKey: key, lease: `l${i}`, reason: 'quit' }),
        ]);
        expect(claim.status).toBe(200);
        expect([200, 409]).toContain(put.status);
        // Whichever went first, the Run is credited once and not stored: GET shows none, a take is refused.
        expect(((await (await savedRun(cookie, 'GET')).json()) as { savedRun: unknown }).savedRun).toBeNull();
        expect((await savedRun(cookie, 'POST', { runKey: key, lease: `l${i}`, newLease: `m${i}` })).status).toBe(409);
        expect((await listed(cookie)).filter((c) => c.runKey === key)).toHaveLength(1);
      }
    });

    it('credits a stored Run once when another Run’s store and its holder’s claim race', async () => {
      const cookie = await signUp(`Rrace2${RUN}`);
      for (let i = 0; i < 6; i++) {
        const key = `held-${i}`;
        await savedRun(cookie, 'PUT', { runKey: key, lease: `h${i}`, snapshot: snap(key) });
        const [put, claim] = await Promise.all([
          savedRun(cookie, 'PUT', { runKey: `other-${i}`, lease: `o${i}`, snapshot: snap(`other-${i}`), ledger: true }),
          claimed(cookie, { runKey: key, lease: `h${i}` }),
        ]);
        expect(put.status).toBe(200);
        expect(claim.status).toBe(200);
        const credits = ((await put.json()) as { credits: RunCredit[] }).credits.filter((c) => c.runKey === key);
        // Exactly one of the two created the row; the other got it back.
        expect(credits.length + (claim.body.created ? 1 : 0)).toBe(1);
        expect((await listed(cookie)).filter((c) => c.runKey === key)).toHaveLength(1);
      }
    });

    it('lets exactly one of racing claims create the row', async () => {
      const cookie = await signUp(`Rx${RUN}`);
      const results = await Promise.all(['a', 'b', 'c', 'd'].map((l) => claimed(cookie, { runKey: 'race', lease: l })));
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      expect(results.filter((r) => r.body.created).length).toBe(1);
      expect(new Set(results.map((r) => r.body.credit!.id)).size).toBe(1);
    });

    it('lists the newest first, bounded', async () => {
      const cookie = await signUp(`Rl${RUN}`);
      for (let i = 0; i < 3; i++) await claimed(cookie, { runKey: `run-${i}`, lease: `l${i}` });
      expect((await listed(cookie)).map((c) => c.runKey)).toEqual(['run-2', 'run-1', 'run-0']);
      expect((await listed(cookie, 2)).map((c) => c.runKey)).toEqual(['run-2', 'run-1']);
      expect((await listed(cookie, RUN_CREDIT_LIST_MAX + 100)).length).toBe(3);
      expect((await listed(cookie, -4)).length).toBe(3);
    });

    it('validates the body and caps its size', async () => {
      const cookie = await signUp(`Rv${RUN}`);
      expect((await send(cookie, 'POST', { runKey: '', lease: 'l', reason: 'died', stats })).status).toBe(400);
      expect((await send(cookie, 'POST', { runKey: 'r', lease: 'l', reason: 'won', stats })).status).toBe(400);
      expect((await send(cookie, 'POST', { runKey: 'r', lease: 'l', reason: 'died', stats: { maxRadius: 1 } })).status).toBe(400);
      const huge = { runKey: 'r', lease: 'l', reason: 'died', stats: { ...stats, perks: Array.from({ length: MAX_RUN_CREDIT_BYTES / 4 }, (_, i) => i) } };
      expect((await send(cookie, 'POST', huge)).status).toBe(413);
      expect(await listed(cookie)).toEqual([]);
      expect((await send(cookie, 'DELETE', {})).status).toBe(405);
    });

    it('keeps creditedRuns with the progress copy, and the stored set when an older bundle omits it', async () => {
      const cookie = await signUp(`Rp${RUN}`);
      const progress = (over: Partial<Progress> = {}, total = 100): Progress => ({
        fluff: total,
        upgrades: {},
        characters: {},
        universes: 0,
        stats: { runs: 1, wins: 0, bestRadius: 10, bestTier: 2, totalFluffEarned: total, keepsakesEarned: 0 },
        ...over,
      });
      const put = async (body: unknown) => (await (await call(progressApi, '/api/progress', { method: 'PUT', cookie, body: JSON.stringify(body) })).json()) as { accepted: boolean; progress: Progress };
      const first = await put(progress({ creditedRuns: ['k1'] }));
      expect(first.accepted).toBe(true);
      expect(first.progress.creditedRuns).toEqual(['k1']);
      // An older bundle (no field) with more progress: accepted, the stored set kept.
      const older = await put(progress({}, 150));
      expect(older.accepted).toBe(true);
      expect(older.progress.creditedRuns).toEqual(['k1']);
      // A copy with the field replaces the set along with the Fluff.
      const next = await put(progress({ creditedRuns: ['k1', 'k2'] }, 200));
      expect(next.progress.creditedRuns).toEqual(['k1', 'k2']);
      const got = (await (await call(progressApi, '/api/progress', { cookie })).json()) as { progress: Progress };
      expect(got.progress.creditedRuns).toEqual(['k1', 'k2']);
    });
  });

  it('keeps the leaderboard working, anonymous only, when accounts are not configured', async () => {
    const cookie = await signUp(`Off${RUN}`);
    const secret = process.env.BETTER_AUTH_SECRET;
    delete process.env.BETTER_AUTH_SECRET;
    try {
      expect(await (await call(authApi, '/api/auth/providers')).json()).toEqual({ enabled: false, providers: [] });
      expect((await call(authApi, '/api/auth/get-session', { cookie })).status).toBe(503);
      const res = await call(leaderboardApi, '/api/leaderboard', { method: 'POST', cookie, body: JSON.stringify(submission(`T${RUN}o`)) });
      expect(res.status).toBe(201);
      expect(((await res.json()) as { entry: { verified: boolean } }).entry.verified).toBe(false);
    } finally {
      process.env.BETTER_AUTH_SECRET = secret;
    }
  });

  it('signs out', async () => {
    const cookie = await signUp(`Out${RUN}`);
    const res = await call(authApi, '/api/auth/sign-out', { method: 'POST', cookie, body: '{}' });
    expect(res.status).toBe(200);
    const after = await call(authApi, '/api/auth/get-session', { cookie });
    expect(await after.json()).toBeNull();
  });
});
