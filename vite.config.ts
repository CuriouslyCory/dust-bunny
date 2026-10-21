/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
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
