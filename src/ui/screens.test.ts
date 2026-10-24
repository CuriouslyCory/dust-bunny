/** ScreenManager.leave: exits a screen ahead of the next go (Game.stepAside disposes the Run in between). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Game } from '../game/game';
import { registerScreen, ScreenManager } from './screens';

const fakeEl = () => ({ hidden: false, append() {}, appendChild() {} });

describe('ScreenManager.leave', () => {
  const g = globalThis as { document?: unknown };
  let saved: unknown;
  beforeEach(() => {
    saved = g.document;
    g.document = { createElement: fakeEl };
  });
  afterEach(() => {
    g.document = saved;
  });

  it('exits the current screen once, while the caller still has what it needs, and go then reports it as previous', () => {
    const log: string[] = [];
    let alive = true;
    const screen = (id: string) => ({
      id,
      create: () => ({
        el: fakeEl() as unknown as HTMLElement,
        enter: () => void log.push(`enter ${id}`),
        // Like the story intro: its exit uses the Run's view.
        exit: () => void log.push(`exit ${id}${alive ? '' : ' (after dispose!)'}`),
      }),
    });
    registerScreen(screen('leaveTestIntro'));
    registerScreen(screen('leaveTestTitle'));
    const screens = new ScreenManager({} as Game, fakeEl() as unknown as HTMLElement);
    screens.go('leaveTestIntro');
    screens.leave();
    alive = false; // the Run and its view are disposed here
    screens.leave(); // nothing left to exit
    const prev = screens.go('leaveTestTitle');
    expect(prev?.id).toBe('leaveTestIntro');
    expect(log).toEqual(['enter leaveTestIntro', 'exit leaveTestIntro', 'enter leaveTestTitle']);
  });
});
