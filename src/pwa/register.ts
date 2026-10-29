/**
 * Registers the offline service worker (src/pwa/sw.ts, built to /sw.js) in production builds.
 * `pnpm dev` and `?debug` sessions never register it and unregister any left from earlier visits,
 * so development never runs stale code; a page an old worker still controls reloads once. Until
 * then the old worker passes a `?debug` page and its requests straight to the network (src/pwa/sw.ts).
 */
export function installServiceWorker(opts: { debug: boolean }): void {
  if (!('serviceWorker' in navigator)) return;
  const container = navigator.serviceWorker;
  if (import.meta.env.DEV || opts.debug) {
    // Unregistering doesn't release a page the worker already controls: reload once, uncontrolled
    // (a registration being removed never controls a new page load, so this can't loop).
    void container
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .then(() => {
        if (container.controller) location.reload();
      });
    return;
  }
  container
    .register('/sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      // An installed app can stay open for days: look for a new deploy whenever it comes back.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update().catch(() => {});
      });
    })
    .catch((err) => console.warn('[pwa] service worker registration failed', err));
}
