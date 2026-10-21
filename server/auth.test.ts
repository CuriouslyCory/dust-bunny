import { describe, expect, it } from 'vitest';
import { allowedHosts, configuredProviders } from './auth';

describe('auth config', () => {
  it('offers a provider only when both its id and secret are set', () => {
    expect(configuredProviders({})).toEqual([]);
    expect(configuredProviders({ DISCORD_CLIENT_ID: 'id' })).toEqual([]);
    expect(configuredProviders({ DISCORD_CLIENT_ID: 'id', DISCORD_CLIENT_SECRET: 's', GOOGLE_CLIENT_ID: 'g' })).toEqual(['discord']);
    expect(configuredProviders({ GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's', DISCORD_CLIENT_ID: 'd', DISCORD_CLIENT_SECRET: 's' })).toEqual(['google', 'discord']);
  });

  it('allows the canonical and Vercel hosts, and loopback only outside production', () => {
    const vercel = {
      BETTER_AUTH_URL: 'https://dustbunny.example/',
      VERCEL_PROJECT_PRODUCTION_URL: 'dust-bunny.vercel.app',
      VERCEL_BRANCH_URL: 'dust-bunny-git-feat-x.vercel.app',
      VERCEL_URL: 'dust-bunny-abc123.vercel.app',
    };
    expect(allowedHosts({ ...vercel, VERCEL_ENV: 'production' })).toEqual([
      'dustbunny.example',
      'dust-bunny.vercel.app',
      'dust-bunny-git-feat-x.vercel.app',
      'dust-bunny-abc123.vercel.app',
    ]);
    expect(allowedHosts({ ...vercel, VERCEL_ENV: 'preview' })).toContain('localhost:*');
    expect(allowedHosts({})).toEqual(['localhost:*', '127.0.0.1:*']);
  });
});
