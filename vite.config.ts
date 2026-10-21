/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';

/**
 * Social cards need absolute image URLs. On Vercel builds, prefix `/og.png` with the production
 * domain (SITE_URL if set, else VERCEL_PROJECT_PRODUCTION_URL); locally they stay relative.
 */
function absoluteSocialUrls(): Plugin {
  const host = process.env.SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const origin = host ? (host.startsWith('http') ? host : `https://${host}`).replace(/\/$/, '') : '';
  return {
    name: 'absolute-social-urls',
    transformIndexHtml(html) {
      if (!origin) return html;
      return html
        .replace(/(<meta (?:property|name)="(?:og|twitter):image" content=")\//g, `$1${origin}/`)
        .replace('</head>', `  <meta property="og:url" content="${origin}/" />\n  </head>`);
    },
  };
}

export default defineConfig({
  plugins: [absoluteSocialUrls()],
  build: {
    outDir: 'dist',
    target: 'es2022',
    // three.js core alone is ~560 kB minified (~140 kB gzip) and can't be split further;
    // the warning limit sits just above it so any other chunk that grows past that still warns.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // three.js core in its own long-cached chunk (game code changes more often).
            // GLTFLoader (three/examples) stays a separate lazy chunk.
            { name: 'three', test: /node_modules[\\/]three[\\/]build[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
