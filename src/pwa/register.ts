/**
 * Registers the offline service worker (src/pwa/sw.ts, built to /sw.js) in production builds.
 * `pnpm dev` and `?debug` sessions never register it and unregister any left from earlier visits,
 * so development never runs stale code.
 */
export function installServiceWorker(opts: { debug: boolean }): void {
  if (!('serviceWorker' in navigator)) return;
  const container = navigator.serviceWorker;
  if (import.meta.env.DEV || opts.debug) {
    void container.getRegistrations().then((regs) => Promise.all(regs.map((r) => r.unregister())));
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
