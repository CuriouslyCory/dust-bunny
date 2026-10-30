/**
 * Build-time rules for the native app builds, shared by vite.config.ts and scripts/capCheck.ts.
 * Pure (no file system), so src/native/build.test.ts covers them.
 */

/** The deployed site: the API the apps call unless VITE_API_ORIGIN says otherwise. */
export const PRODUCTION_ORIGIN = 'https://dustbunny.curiouslycory.com';

/** Marker prefix of the E2E build's console lines and status line (src/e2e/index.ts). */
export const E2E_MARKER = '[e2e]';

export interface BuildEnv {
  /** Vite mode: `native` for the apps. */
  mode: string;
  command: 'build' | 'serve';
  /** VITE_API_ORIGIN. */
  apiOrigin?: string;
  /** VITE_E2E: an end-to-end test build. */
  e2e?: string;
  /** VERCEL_ENV, to tell a production deploy. */
  vercelEnv?: string;
  /** VERCEL_PROJECT_PRODUCTION_URL (a host): the production deploy's own address, also production. */
  vercelProductionUrl?: string;
}

/**
 * The API origin a build's clients call: VITE_API_ORIGIN, else the production site for the apps and
 * '' (same origin) for the website. Throws for a value that isn't a bare origin, and for an E2E build
 * that would reach the production API (its Runs would post real scores).
 */
export function resolveApiOrigin(env: BuildEnv): string {
  const set = env.apiOrigin?.trim().replace(/\/+$/, '') ?? '';
  if (set) {
    let parsed: URL;
    try {
      parsed = new URL(set);
    } catch {
      throw new Error(`VITE_API_ORIGIN must be an origin such as https://example.com, not "${env.apiOrigin}".`);
    }
    if (parsed.origin !== set) throw new Error(`VITE_API_ORIGIN must be an origin such as https://example.com, not "${env.apiOrigin}".`);
  }
  const origin = set || (env.mode === 'native' ? PRODUCTION_ORIGIN : '');
  if (env.e2e && env.command === 'build') {
    const productionOrigins = [PRODUCTION_ORIGIN, ...(env.vercelProductionUrl ? [`https://${env.vercelProductionUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`] : [])];
    const production = origin ? productionOrigins.includes(origin) : env.vercelEnv === 'production';
    if (production) {
      throw new Error(`VITE_E2E builds must not call the production API (${PRODUCTION_ORIGIN}): set VITE_API_ORIGIN to a dev server or a preview.`);
    }
  }
  return origin;
}

/** Output files (path → text) of a build without VITE_E2E that still contain E2E code. */
export function filesWithE2E(files: Iterable<[string, string]>): string[] {
  const out: string[] = [];
  for (const [name, text] of files) if (text.includes(E2E_MARKER)) out.push(name);
  return out;
}

/**
 * A release sync must not carry an E2E build (`cap sync` after `pnpm cap:*:test` leaves one in the
 * native projects): problems with a synced `capacitor.config.json` and web build's files.
 */
export function releaseSyncProblems(capConfig: string, files: Iterable<[string, string]>): string[] {
  const problems: string[] = [];
  let config: { server?: { cleartext?: boolean }; android?: { allowMixedContent?: boolean } };
  try {
    config = JSON.parse(capConfig) as typeof config;
  } catch {
    return ['capacitor.config.json is missing or not JSON'];
  }
  if (config.server?.cleartext) problems.push('capacitor.config.json allows cleartext (server.cleartext)');
  if (config.android?.allowMixedContent) problems.push('capacitor.config.json allows mixed content (android.allowMixedContent)');
  for (const f of filesWithE2E(files)) problems.push(`E2E code in ${f}`);
  return problems;
}

/** Native projects `cap sync` copies the web build into, and where its models land. */
export const NATIVE_MODEL_DIRS = {
  ios: 'ios/App/App/public/models',
  android: 'android/app/src/main/assets/public/models',
} as const;

/** Each native project's synced `capacitor.config.json`. */
export const NATIVE_CONFIG_FILES = {
  ios: 'ios/App/App/capacitor.config.json',
  android: 'android/app/src/main/assets/capacitor.config.json',
} as const;

export type NativePlatform = keyof typeof NATIVE_MODEL_DIRS;

/** Model files the manifest lists that `exists` can't find under `dir` (paths relative to the models folder). */
export function missingModels(files: readonly string[], dir: string, exists: (path: string) => boolean): string[] {
  return files.filter((f) => !exists(`${dir}/${f}`));
}
