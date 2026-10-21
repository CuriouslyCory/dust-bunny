/// <reference types="vitest/config" />
import type { IncomingMessage } from 'node:http';
import { defineConfig, loadEnv, type Plugin } from 'vite';

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

export default defineConfig({
  plugins: [absoluteSocialUrls(), devApi(), devStaticPages()],
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
