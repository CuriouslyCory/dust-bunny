import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fallbackPage, installCacheMode, isDebugUrl, isPrecached, manifestModelFiles, precacheUrls, routeFor } from './rules';

const ORIGIN = 'https://dustbunny.example';
const route = (path: string, opts: { method?: string; navigate?: boolean } = {}) =>
  routeFor(opts.method ?? 'GET', new URL(path, ORIGIN), ORIGIN, opts.navigate ?? false);

describe('precache list', () => {
  const models = new Set(['couch.glb', 'roomba.glb']);

  it('takes the app shell, hashed chunks and the manifest models', () => {
    const files = [
      'index.html',
      'manifest.webmanifest',
      'favicon.svg',
      'icon-192.png',
      'icon-512.png',
      'privacy.html',
      'assets/index-abc.js',
      'assets/three-def.js',
      'assets/GLTFLoader-123.js',
      'assets/index-abc.css',
      'models/manifest.json',
      'models/couch.glb',
      'models/roomba.glb',
    ];
    expect(precacheUrls(files, models)).toEqual([...files].map((f) => `/${f}`).sort());
  });

  it('leaves out source maps, unlisted models, the catalog, social images, the auth popup page and the worker', () => {
    for (const file of ['assets/index-abc.js.map', 'models/unused.glb', 'models/catalog.json', 'og.png', 'auth-complete.html', 'sw.js']) {
      expect(isPrecached(file, models), file).toBe(false);
    }
  });

  it('reads model files from the manifest, skipping "$" comments', () => {
    const manifest = { $comment: 'x', couch: { file: 'couch.glb', fit: 'xz' }, roomba: 'roomba.glb', broken: { fit: 'xz' } };
    expect([...manifestModelFiles(manifest)].sort()).toEqual(['couch.glb', 'roomba.glb']);
  });

  it('covers every model in public/models/manifest.json that exists on disk', () => {
    const manifest = JSON.parse(readFileSync('public/models/manifest.json', 'utf8')) as Record<string, unknown>;
    const listed = manifestModelFiles(manifest);
    const onDisk = new Set(readdirSync('public/models'));
    for (const file of listed) expect(onDisk.has(file), file).toBe(true);
    const files = [...onDisk].map((f) => `models/${f}`);
    expect(precacheUrls(files, listed)).toHaveLength(listed.size + 1);
  });

  it('revalidates everything but hashed assets when installing', () => {
    expect(installCacheMode('/assets/three-def.js')).toBe('default');
    expect(installCacheMode('/index.html')).toBe('no-cache');
    expect(installCacheMode('/models/couch.glb')).toBe('no-cache');
    expect(installCacheMode('/models/manifest.json')).toBe('no-cache');
  });
});

describe('routeFor', () => {
  it('never handles the API, page loads included', () => {
    expect(route('/api/leaderboard')).toBe('bypass');
    expect(route('/api/progress?x=1')).toBe('bypass');
    expect(route('/api')).toBe('bypass');
    expect(route('/api/auth/callback/google?code=1', { navigate: true })).toBe('bypass');
    expect(route('/api/leaderboard', { method: 'POST' })).toBe('bypass');
  });

  it('bypasses anything but GET', () => {
    expect(route('/assets/index-abc.js', { method: 'HEAD' })).toBe('bypass');
    expect(route('/', { method: 'POST', navigate: true })).toBe('bypass');
  });

  it('bypasses the worker script and other origins', () => {
    expect(route('/sw.js')).toBe('bypass');
    expect(routeFor('GET', new URL('https://cdn.example/x.js'), ORIGIN, false)).toBe('bypass');
    expect(routeFor('GET', new URL('http://fonts.gstatic.com/f.woff2'), ORIGIN, false)).toBe('bypass');
  });

  it('caches Google Fonts at runtime', () => {
    expect(routeFor('GET', new URL('https://fonts.googleapis.com/css2?family=Fredoka'), ORIGIN, false)).toBe('font');
    expect(routeFor('GET', new URL('https://fonts.gstatic.com/s/fredoka/v1/a.woff2'), ORIGIN, false)).toBe('font');
  });

  it('loads pages network first', () => {
    expect(route('/', { navigate: true })).toBe('navigate');
    expect(route('/?seed=abc', { navigate: true })).toBe('navigate');
    expect(route('/privacy', { navigate: true })).toBe('navigate');
  });

  it('bypasses ?debug page loads', () => {
    expect(route('/?debug', { navigate: true })).toBe('bypass');
    expect(route('/?debug&autostart&seed=x', { navigate: true })).toBe('bypass');
    expect(isDebugUrl(new URL('/?seed=a&debug', ORIGIN))).toBe(true);
    expect(isDebugUrl(new URL('/?seed=debug', ORIGIN))).toBe(false);
  });

  it('loads models network first and serves the rest from the precache', () => {
    expect(route('/models/manifest.json')).toBe('revalidate');
    expect(route('/models/couch.glb')).toBe('revalidate');
    expect(route('/assets/three-def.js')).toBe('precache');
    expect(route('/favicon.svg')).toBe('precache');
  });
});

describe('fallbackPage', () => {
  it('falls back to the game, or the static page a path names', () => {
    expect(fallbackPage('/')).toBe('/index.html');
    expect(fallbackPage('/index.html')).toBe('/index.html');
    expect(fallbackPage('/whatever')).toBe('/index.html');
    expect(fallbackPage('/auth-complete.html')).toBe('/index.html');
    expect(fallbackPage('/privacy')).toBe('/privacy.html');
    expect(fallbackPage('/terms.html')).toBe('/terms.html');
  });
});
