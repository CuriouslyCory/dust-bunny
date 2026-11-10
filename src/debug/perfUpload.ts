/**
 * Rules for `POST /__perf`, the dev server's frame-report upload (the `devPerfReports` plugin in
 * vite.config.ts writes the file). Pure, so perfUpload.test.ts covers them; the server, not the
 * client, builds the file name.
 */
export const PERF_ROUTE = '/__perf';
/** Folder under the project root (git-ignored). */
export const PERF_DIR = 'perf-reports';
export const PERF_MAX_BYTES = 2 * 1024 * 1024;

export type PerfUploadCheck = { ok: true; platform: string } | { ok: false; status: number; error: string };

/** Checks an upload's size and shape: JSON with a numeric `schema`. */
export function checkPerfUpload(body: string, bytes: number): PerfUploadCheck {
  if (bytes > PERF_MAX_BYTES) return { ok: false, status: 413, error: `report over ${PERF_MAX_BYTES} bytes` };
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, status: 400, error: 'not JSON' };
  }
  if (!json || typeof json !== 'object' || typeof (json as { schema?: unknown }).schema !== 'number') return { ok: false, status: 400, error: 'no numeric schema' };
  const meta = (json as { meta?: { platform?: unknown } }).meta;
  return { ok: true, platform: safePlatform(meta?.platform) };
}

/** `[a-z]+`, at most 16 letters, else `unknown`. */
export function safePlatform(p: unknown): string {
  const s = typeof p === 'string' ? p.toLowerCase().replace(/[^a-z]/g, '').slice(0, 16) : '';
  return s || 'unknown';
}

/** `2026-11-09T14-32-05Z-android.json` (UTC, no colons); `n` > 0 adds `-n` for a same-second clash. */
export function perfReportFileName(at: Date, platform: string, n = 0): string {
  const ts = `${at.toISOString().slice(0, 19).replace(/:/g, '-')}Z`;
  return `${ts}-${safePlatform(platform)}${n ? `-${n}` : ''}.json`;
}
