/**
 * Service worker: makes the game playable offline after one online visit. Built into dist/sw.js
 * by the `serviceWorker` plugin in vite.config.ts, which defines the precache list and its version
 * (a hash of the precached files). Routing rules live in ./rules.ts.
 *
 * A new deploy means a new sw.js; the new worker precaches the build, takes over at once
 * (skipWaiting + clients.claim) and deletes the older precaches. Page loads go to the network
 * first, so an online launch always runs the deployed build even before the new worker is ready.
 */
import { FONT_CACHE, PRECACHE_PREFIX, fallbackPage, installCacheMode, isDebugUrl, routeFor } from './rules';

declare const __SW_PRECACHE__: string[];
declare const __SW_VERSION__: string;

// Minimal worker types: the project's lib is DOM, which lacks them (and conflicts with WebWorker).
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  readonly request: Request;
  readonly clientId: string;
  respondWith(response: Response | Promise<Response>): void;
}
interface WorkerScope {
  readonly location: Location;
  readonly clients: { claim(): Promise<void>; get(id: string): Promise<{ readonly url: string } | undefined> };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (e: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (e: FetchEvent) => void): void;
}

const sw = self as unknown as WorkerScope;
const CACHE = `${PRECACHE_PREFIX}${__SW_VERSION__}`;

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(__SW_PRECACHE__.map((url) => new Request(url, { cache: installCacheMode(url) })));
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith(PRECACHE_PREFIX) && n !== CACHE).map((n) => caches.delete(n)));
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const route = routeFor(request.method, url, sw.location.origin, request.mode === 'navigate');
  if (route === 'bypass') return;
  event.respondWith(
    (async () => {
      // A ?debug page (src/pwa/register.ts unregisters the worker, but it stays in control of a page
      // it loaded) gets everything from the network, so debugging never runs cached code.
      if (await fromDebugPage(event.clientId)) return fetch(request);
      return respond(route, request, url);
    })(),
  );
});

async function fromDebugPage(clientId: string): Promise<boolean> {
  if (!clientId) return false;
  const client = await sw.clients.get(clientId);
  return !!client && isDebugUrl(new URL(client.url));
}

async function respond(route: Exclude<ReturnType<typeof routeFor>, 'bypass'>, request: Request, url: URL): Promise<Response> {
  switch (route) {
    case 'navigate':
      return networkFirst(request, fallbackPage(url.pathname));
    case 'revalidate':
      return networkFirst(request, url.pathname);
    case 'precache':
      return (await precached(url.pathname)) ?? fetch(request);
    case 'font':
      return font(request);
  }
}

async function precached(path: string): Promise<Response | undefined> {
  const cache = await caches.open(CACHE);
  return cache.match(path);
}

async function networkFirst(request: Request, fallback: string): Promise<Response> {
  try {
    return await fetch(request);
  } catch (err) {
    const cached = await precached(fallback);
    if (cached) return cached;
    throw err;
  }
}

/** Network first (the browser's HTTP cache keeps it cheap), storing each copy for offline launches. */
async function font(request: Request): Promise<Response> {
  const cache = await caches.open(FONT_CACHE);
  try {
    const response = await fetch(request);
    // Opaque responses (the no-cors stylesheet) report status 0 but are cacheable.
    if (response.ok || response.type === 'opaque') await cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}
