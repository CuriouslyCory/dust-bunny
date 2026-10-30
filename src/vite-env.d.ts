/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin for the clients ('' = same origin); set by vite.config.ts (src/platform.ts). */
  readonly VITE_API_ORIGIN?: string;
  /** End-to-end test build for the native apps ('' in release builds; src/e2e/index.ts). */
  readonly VITE_E2E?: string;
  /** E2E builds: models in public/models/manifest.json at build time (src/e2e/index.ts). */
  readonly VITE_E2E_MODELS?: string;
}
