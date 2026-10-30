/**
 * Capacitor 8 apps for iOS (ios/) and Android (android/). They bundle the web build in
 * `dist-native/` (`pnpm cap:build`, Vite mode `native`): the game is served from inside the app,
 * not from the website. `pnpm cap:sync` builds it and copies it into both projects.
 *
 * E2E builds (VITE_E2E set when syncing, scripts/cap-test.sh) call a plain-http dev server, so they
 * alone allow mixed content and cleartext on Android. Release syncs never do: this file is read at
 * `cap sync`, and the copies it writes into the native projects are git-ignored.
 */
import type { CapacitorConfig } from '@capacitor/cli';

const e2e = Boolean(process.env.VITE_E2E);

const config: CapacitorConfig = {
  appId: 'com.curiouslycory.dustbunny',
  appName: 'Dust Bunny',
  webDir: 'dist-native',
  backgroundColor: '#3b2a22',
  ...(e2e ? { server: { cleartext: true } } : {}),
  android: { allowMixedContent: e2e },
};

export default config;
