import { describe, expect, it } from 'vitest';
import { filesWithE2E, missingModels, PRODUCTION_ORIGIN, releaseSyncProblems, resolveApiOrigin } from './build';

describe('resolveApiOrigin', () => {
  it('is relative on the web and the production site in the apps', () => {
    expect(resolveApiOrigin({ mode: 'production', command: 'build' })).toBe('');
    expect(resolveApiOrigin({ mode: 'native', command: 'build' })).toBe(PRODUCTION_ORIGIN);
  });

  it('takes VITE_API_ORIGIN, without a trailing slash', () => {
    expect(resolveApiOrigin({ mode: 'native', command: 'build', apiOrigin: 'http://localhost:5173/' })).toBe('http://localhost:5173');
    expect(resolveApiOrigin({ mode: 'production', command: 'build', apiOrigin: 'https://preview.example' })).toBe('https://preview.example');
  });

  it('refuses something that is not an origin', () => {
    expect(() => resolveApiOrigin({ mode: 'native', command: 'build', apiOrigin: 'localhost:5173' })).toThrow(/origin/);
    expect(() => resolveApiOrigin({ mode: 'native', command: 'build', apiOrigin: 'https://example.com/api' })).toThrow(/origin/);
  });

  it('refuses an E2E build that would call the production API', () => {
    expect(() => resolveApiOrigin({ mode: 'native', command: 'build', e2e: 'submit' })).toThrow(/production API/);
    expect(() => resolveApiOrigin({ mode: 'native', command: 'build', e2e: 'submit', apiOrigin: `${PRODUCTION_ORIGIN}/` })).toThrow(/production API/);
    expect(() => resolveApiOrigin({ mode: 'production', command: 'build', e2e: '1', vercelEnv: 'production' })).toThrow(/production API/);
    expect(() =>
      resolveApiOrigin({ mode: 'native', command: 'build', e2e: '1', apiOrigin: 'https://dust-bunny.vercel.app', vercelProductionUrl: 'dust-bunny.vercel.app' }),
    ).toThrow(/production API/);
  });

  it('allows an E2E build against a dev server or a preview', () => {
    expect(resolveApiOrigin({ mode: 'native', command: 'build', e2e: 'submit', apiOrigin: 'http://localhost:5173' })).toBe('http://localhost:5173');
    expect(resolveApiOrigin({ mode: 'production', command: 'build', e2e: '1', vercelEnv: 'preview' })).toBe('');
    expect(resolveApiOrigin({ mode: 'development', command: 'serve', e2e: 'submit' })).toBe('');
  });
});

describe('filesWithE2E', () => {
  it('lists output files that contain an E2E marker', () => {
    expect(filesWithE2E([['assets/index.js', 'console.log("[e2e] title-ready")'], ['index.html', '<html>']])).toEqual(['assets/index.js']);
    expect(filesWithE2E([['assets/index.js', 'e2e']])).toEqual([]);
  });
});

describe('releaseSyncProblems', () => {
  const release = JSON.stringify({ appId: 'x', android: { allowMixedContent: false } });
  it('passes a release sync', () => {
    expect(releaseSyncProblems(release, [['assets/index.js', 'game']])).toEqual([]);
  });

  it('flags what an E2E sync leaves behind', () => {
    const e2e = JSON.stringify({ server: { cleartext: true }, android: { allowMixedContent: true } });
    expect(releaseSyncProblems(e2e, [['assets/e2e.js', 'console.log("[e2e] x")']])).toEqual([
      'capacitor.config.json allows cleartext (server.cleartext)',
      'capacitor.config.json allows mixed content (android.allowMixedContent)',
      'E2E code in assets/e2e.js',
    ]);
    expect(releaseSyncProblems('', [])).toEqual(['capacitor.config.json is missing or not JSON']);
  });
});

describe('missingModels', () => {
  it('lists manifest files absent from a native project', () => {
    const present = new Set(['ios/models/a.glb', 'ios/models/sub/b.glb']);
    expect(missingModels(['a.glb', 'sub/b.glb', 'c.glb'], 'ios/models', (p) => present.has(p))).toEqual(['c.glb']);
  });
});
