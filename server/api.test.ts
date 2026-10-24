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
import savedRunApi from '../api/saved-run';
import { computeAreaScore, computeScore, scoreTierForRadius } from '../src/shared/score';
import type { Progress } from '../src/shared/progress';
import { MAX_SAVED_RUN_BYTES, SNAPSHOT_VERSION } from '../src/shared/savedRun';
import { authOptions, resetAuthForTests } from './auth';
import { query, resetDbForTests } from './db';

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
      expect(await put.json()).toEqual({ stored: true, replaced: null });
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
