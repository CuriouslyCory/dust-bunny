import { describe, expect, it } from 'vitest';
import { AREA_ORDER } from '../world/types';
import { BOSS_INTRO_MIN_HOLD, BOSS_INTROS, bossArea, bossHitsLine, bossIntroHold } from './bossIntros';
import { AREA_BOSSES } from './hazards';
import { STORY_CAPTION_MAX } from './story';

describe('boss intro copy', () => {
  it('describes every Area boss in the narrator voice', () => {
    for (const area of AREA_ORDER) {
      const id = AREA_BOSSES[area].id;
      const intro = BOSS_INTROS[id];
      expect(intro, id).toBeDefined();
      expect(intro!.description.length, id).toBeGreaterThan(0);
      expect(intro!.description.length, `${id}: ${intro!.description}`).toBeLessThanOrEqual(STORY_CAPTION_MAX);
      expect(intro!.description, `${id}: no exclamation marks`).not.toContain('!');
      expect(intro!.color, id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(bossArea(id)).toBe(area);
    }
    expect(Object.keys(BOSS_INTROS).length).toBe(AREA_ORDER.length);
  });

  it('says how many hits break each boss', () => {
    expect(bossHitsLine('robovac_9000')).toMatch(/^\d+ hits to break it · or grow big enough to absorb it$/);
    expect(bossHitsLine('the_expansion')).toMatch(/^\d+ notches of gravity to collapse it$/);
    expect(bossHitsLine('roomba')).toBe('');
  });

  it('holds the card for its reading time, never less than the minimum', () => {
    expect(bossIntroHold('X', '')).toBe(BOSS_INTRO_MIN_HOLD);
    const intro = BOSS_INTROS.robovac_9000!;
    const alone = bossIntroHold('Robo-Vac 9000', intro.description);
    expect(alone).toBeGreaterThan(BOSS_INTRO_MIN_HOLD);
    expect(bossIntroHold('Robo-Vac 9000', intro.description, ['One more line to read here.'])).toBeGreaterThan(alone);
  });
});
