/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { join, relative, resolve, sep } from 'node:path';
import { build, defineConfig, loadEnv, type Plugin } from 'vite';
import { manifestModelFiles, precacheUrls } from './src/pwa/rules';

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

/** Function file in api/ for a request path (mirrors vercel.json's `/api/auth/*` rewrite). */
function apiFunctionFor(path: string): string | null {
  if (path === '/api/auth' || path.startsWith('/api/auth/')) return 'auth';
  if (path === '/api/leaderboard' || path === '/api/progress') return path.slice('/api/'.length);
  return null;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/**
 * `pnpm dev` also serves the Vercel functions in api/ when `.env` sets DATABASE_URL (accounts also
 * need BETTER_AUTH_SECRET). Without it /api 404s and the game uses its local leaderboard.
 */
function devApi(): Plugin {
  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '');
      if (!env.DATABASE_URL) return;
      for (const [k, v] of Object.entries(env)) process.env[k] ??= v;
      server.middlewares.use(async (req, res, next) => {
        const file = apiFunctionFor((req.url ?? '').split('?')[0]!);
        if (!file) return next();
        try {
          const mod = (await server.ssrLoadModule(`/api/${file}.ts`)) as { default: { fetch(r: Request): Promise<Response> } };
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
          const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
          const request = new Request(new URL(req.url!, `http://${req.headers.host}`), { method: req.method, headers, body: hasBody ? new Uint8Array(await readBody(req)) : undefined });
          const response = await mod.default.fetch(request);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => {
            if (k !== 'set-cookie') res.setHeader(k, v);
          });
          const cookies = response.headers.getSetCookie();
          if (cookies.length) res.setHeader('set-cookie', cookies);
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

/** Static pages in public/ served without `.html` (mirrors vercel.json's `/privacy` and `/terms` rewrites). */
function devStaticPages(): Plugin {
  const pages = new Set(['/privacy', '/terms']);
  return {
    name: 'dev-static-pages',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [path, query] = (req.url ?? '').split('?');
        if (pages.has(path!)) req.url = `${path}.html${query === undefined ? '' : `?${query}`}`;
        next();
      });
    },
  };
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'));
}

/**
 * Builds the offline service worker (src/pwa/sw.ts) into dist/sw.js once the app is written. Its
 * precache is the build files `precacheUrls` picks (src/pwa/rules.ts); its version hashes them and
 * the worker's source, so every deploy that changes a precached file ships a new worker.
 */
function serviceWorker(): Plugin {
  let root = process.cwd();
  let outDir = 'dist';
  return {
    name: 'service-worker',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle: {
      sequential: true,
      order: 'post',
      async handler() {
        const files = await listFiles(outDir);
        const manifest = JSON.parse(await readFile(join(outDir, 'models/manifest.json'), 'utf8')) as Record<string, unknown>;
        const urls = precacheUrls(files, manifestModelFiles(manifest));
        const hash = createHash('sha256');
        for (const src of ['src/pwa/sw.ts', 'src/pwa/rules.ts']) hash.update(await readFile(join(root, src)));
        for (const url of urls) hash.update(url).update(await readFile(join(outDir, url)));
        await build({
          configFile: false,
          root,
          publicDir: false,
          logLevel: 'warn',
          define: { __SW_PRECACHE__: JSON.stringify(urls), __SW_VERSION__: JSON.stringify(hash.digest('hex').slice(0, 16)) },
          build: {
            outDir,
            emptyOutDir: false,
            copyPublicDir: false,
            target: 'es2022',
            lib: { entry: resolve(root, 'src/pwa/sw.ts'), formats: ['iife'], name: 'dustBunnyServiceWorker', fileName: () => 'sw.js' },
          },
        });
      },
    },
  };
}

export default defineConfig({
  plugins: [absoluteSocialUrls(), devApi(), devStaticPages(), serviceWorker()],
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
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    environment: 'node',
  },
});
