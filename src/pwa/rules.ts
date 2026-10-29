/**
 * What the service worker (src/pwa/sw.ts) precaches and how it answers each request. Shared with
 * the build plugin in vite.config.ts, which lists the precache. No DOM or worker globals here.
 *
 * The cache holds exactly one build: the files `isPrecached` picks plus the GLBs in
 * models/manifest.json. Nothing is added to it at runtime, so an offline launch always gets a
 * matching set of HTML, chunks and models.
 */

/** How the worker answers a request. */
export type Route =
  /** Not handled: the browser goes to the network as if there were no worker. */
  | 'bypass'
  /** A page load: network first, falling back to the precached page (`fallbackPage`). */
  | 'navigate'
  /** Network first (the browser's HTTP cache rules apply), falling back to the precached copy; not stored. */
  | 'revalidate'
  /** The precached copy if there is one, otherwise the network. */
  | 'precache'
  /** Google Fonts: network first, each copy stored in their own cache (`FONT_CACHE`) for offline use. */
  | 'font';

export const PRECACHE_PREFIX = 'dust-bunny-precache-';
export const FONT_CACHE = 'dust-bunny-fonts';

const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

/** Root files of the build (public/ and index.html) that the game needs offline. */
const ROOT_FILES = new Set([
  'index.html',
  'manifest.webmanifest',
  'favicon.svg',
  'favicon.ico',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'privacy.html',
  'terms.html',
]);

/** Pages served without `.html` (vercel.json's rewrites). */
const PAGE_REWRITES: Record<string, string> = { '/privacy': '/privacy.html', '/terms': '/terms.html' };

/**
 * Whether a build output file (path relative to dist/, `/` separators) is precached: the root
 * files above, every hashed chunk and asset under assets/ except source maps, and the models
 * manifest and the GLBs it lists (`modelFiles`, relative to models/).
 */
export function isPrecached(file: string, modelFiles: ReadonlySet<string>): boolean {
  if (ROOT_FILES.has(file)) return true;
  if (file.startsWith('assets/')) return !file.endsWith('.map');
  if (file === 'models/manifest.json') return true;
  if (file.startsWith('models/')) return modelFiles.has(file.slice('models/'.length));
  return false;
}

/** GLB files listed in models/manifest.json (keys starting with "$" are comments). */
export function manifestModelFiles(manifest: Record<string, unknown>): Set<string> {
  const files = new Set<string>();
  for (const [id, spec] of Object.entries(manifest)) {
    if (id.startsWith('$')) continue;
    const file = typeof spec === 'string' ? spec : (spec as { file?: unknown } | null)?.file;
    if (typeof file === 'string') files.add(file);
  }
  return files;
}

/** The precache list: absolute URL paths of the build files `isPrecached` picks, sorted. */
export function precacheUrls(files: readonly string[], modelFiles: ReadonlySet<string>): string[] {
  return files.filter((f) => isPrecached(f, modelFiles)).map((f) => `/${f}`).sort();
}

export function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}

/** A `?debug` page: the worker passes it and everything it requests straight to the network. */
export function isDebugUrl(url: URL): boolean {
  return url.searchParams.has('debug');
}

/**
 * The route for a request. `navigate` is the request's mode === 'navigate'. Anything that isn't a
 * GET, the API (page loads included: OAuth callbacks land under /api/auth), the worker script,
 * `?debug` page loads and other origins (except Google Fonts) are bypassed. Models (the manifest
 * and the GLBs) go network first, so online they stay as consistent as without a worker (the
 * manifest's scales and fits always meet the GLBs they were written for) and offline they come
 * from the precached build together.
 */
export function routeFor(method: string, url: URL, origin: string, navigate: boolean): Route {
  if (method !== 'GET') return 'bypass';
  if (url.origin !== origin) return FONT_HOSTS.has(url.hostname) && url.protocol === 'https:' ? 'font' : 'bypass';
  const path = url.pathname;
  if (isApiPath(path) || path === '/sw.js') return 'bypass';
  if (navigate) return isDebugUrl(url) ? 'bypass' : 'navigate';
  if (path.startsWith('/models/')) return 'revalidate';
  return 'precache';
}

/** The precached page an offline page load falls back to: the static page it names, else the game. */
export function fallbackPage(path: string): string {
  const rewritten = PAGE_REWRITES[path] ?? path;
  return ROOT_FILES.has(rewritten.slice(1)) && rewritten.endsWith('.html') ? rewritten : '/index.html';
}

/**
 * How the worker fetches a precache URL when it installs: hashed assets may come from the HTTP
 * cache (they never change), everything else is revalidated so the cache matches the deploy.
 */
export function installCacheMode(url: string): RequestCache {
  return url.startsWith('/assets/') ? 'default' : 'no-cache';
}
