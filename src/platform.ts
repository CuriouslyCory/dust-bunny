/**
 * Where this build runs, fixed at build time. `pnpm build` is the website; `pnpm cap:build` (Vite
 * mode `native`) is the game bundled into the Capacitor apps (ios/, android/), which serve it from
 * `capacitor://localhost` (iOS) or `https://localhost` (Android). See docs/architecture.md, "Native apps".
 */
// `?.`: Node scripts outside Vite (`pnpm sim`, under tsx) import this too, without `import.meta.env`.
export const NATIVE_APP: boolean = import.meta.env?.MODE === 'native';

/**
 * Origin the API clients call: '' (this site, relative `/api/...`) on the web, the production site
 * in the apps (vite.config.ts, `resolveApiOrigin` in src/native/build.ts).
 */
export const API_ORIGIN: string = import.meta.env?.VITE_API_ORIGIN ?? '';

/** `/api/...` on the API origin. */
export function apiUrl(path: string): string {
  return API_ORIGIN + path;
}
