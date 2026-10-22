/**
 * Leaderboard plausibility with Keepsakes, as a quick CI smoke check (about 3 s): the balance bot
 * (scripts/sim.ts) plays one seeded Zap Run with the max Loadout (Mythic) until just after the
 * house clear, and its Run board and house board submissions must pass validateSubmission /
 * validateAreaSubmission. Zap is the fastest grower and its Discharge scrap and Static Cling add
 * burst growth. The full check (every Character, every Area) is
 * `pnpm sim --seeds=50 --minutes=25 --loadout=max --validate`.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('leaderboard submissions with max Loadouts (balance bot)', () => {
  it('every submission of a short seeded Run validates', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    // s2: the bot clears the house within the 7 minutes, so an Area board entry is checked too.
    const out = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/sim.ts', '--quiet', '--validate', '--loadout=max', '--chars=zap', '--minutes=7', 's2'], {
      cwd: root,
      encoding: 'utf8',
    });
    const lines = out.split('\n').filter((l) => l.includes('submissions valid'));
    expect(lines).toHaveLength(1);
    let checked = 0;
    for (const l of lines) {
      const [, ok, total] = /(\d+)\/(\d+) submissions valid/.exec(l)!;
      expect(ok).toBe(total);
      checked += Number(total);
    }
    expect(checked).toBe(2);
    expect(out).not.toContain('REJECTED');
  }, 60_000);
});
