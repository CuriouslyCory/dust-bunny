/**
 * One Postgres pool per function instance (node-postgres over TCP, as Neon recommends for Vercel
 * Fluid compute). `attachDatabasePool` closes idle connections before Vercel suspends the instance.
 * Needs DATABASE_URL (injected by the Vercel Neon integration); without it every call throws a
 * 503 `unavailable` HttpError, which the leaderboard client treats as "use local scores".
 */
import { attachDatabasePool } from '@vercel/functions';
import pg from 'pg';
import { HttpError } from './http.js';
import { SCHEMA } from './schema.js';

let pool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool(): pg.Pool {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new HttpError(503, 'unavailable', 'The database is not configured.');
  pool = new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 5000 });
  // An idle client losing its connection must not crash the instance; the pool replaces it.
  pool.on('error', (err) => console.error('[db] idle client error', err));
  attachDatabasePool(pool);
  return pool;
}

export async function query<T>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await getPool().query(text, params);
  return res.rows as T[];
}

/** Applies SCHEMA once per instance (retried on the next call if it fails). */
export function ensureSchema(): Promise<void> {
  schemaReady ??= (async () => {
    for (const stmt of SCHEMA) await query(stmt);
  })().catch((err: unknown) => {
    schemaReady = null;
    throw err;
  });
  return schemaReady;
}

/** Tests only: drop the pool so the next call reconnects (e.g. with a different DATABASE_URL). */
export async function resetDbForTests(): Promise<void> {
  const p = pool;
  pool = null;
  schemaReady = null;
  await p?.end();
}
