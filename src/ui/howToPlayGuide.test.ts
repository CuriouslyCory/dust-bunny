// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Game } from '../game/game';
import { getAbility } from '../data/abilities';
import { CHARACTERS } from '../data/characters';
import { describeKeepsake, KEEPSAKE_TYPES, RARITIES } from '../data/keepsakes';
import { CHARACTER_PERKS, PERKS, type PerkData } from '../data/perks';
import { PICKUPS } from '../data/pickups';
import { registerMenuScreens } from './screens/menus';
import { screenRegistry, type Screen } from './screens';

describe('How to play reference', () => {
  let screen: Screen;
  let game: Game;
  const go = vi.fn();
  const topic = (label: string): HTMLButtonElement => [...screen.el.querySelectorAll<HTMLButtonElement>('.howto-nav button')].find((b) => b.textContent === label)!;
  const body = (): HTMLElement => screen.el.querySelector('.howto-body')!;

  beforeAll(() => registerMenuScreens());
  beforeEach(() => {
    go.mockClear();
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 0; });
    game = { go, run: null } as unknown as Game;
    screen = screenRegistry.require('howToPlay').create(game);
    document.body.append(screen.el);
    screen.enter?.({ back: 'title' });
  });
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('keeps the basics and exposes named, selected topic controls outside the scrolling content', () => {
    expect(topic('Basics').getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(topic('Basics'));
    expect(body().textContent).toContain('Controls');
    expect(body().textContent).toContain('Rules');
    expect(body().contains(topic('Perks'))).toBe(false);
    body().scrollTop = 200;
    topic('Perks').click();
    expect(topic('Perks').getAttribute('aria-pressed')).toBe('true');
    expect(topic('Basics').getAttribute('aria-pressed')).toBe('false');
    expect(topic('Perks').getAttribute('aria-controls')).toBe(body().id);
    expect(body().getAttribute('aria-label')).toBe('Perks');
    expect(body().scrollTop).toBe(0);
    topic('Basics').click();
    expect(body().textContent).toContain('Controls');
    expect(body().classList.contains('howto-reference')).toBe(false);
    expect(go).not.toHaveBeenCalled();
  });

  it('describes every Character, its base stats, limits and usable Ability', () => {
    topic('Characters').click();
    const cards = [...body().querySelectorAll('.howto-card')];
    expect(cards).toHaveLength(CHARACTERS.length);
    CHARACTERS.forEach((c, i) => {
      expect(cards[i]!.textContent).toContain(c.name);
      expect(cards[i]!.textContent).toContain(c.description);
      expect(cards[i]!.textContent).toContain(getAbility(c.ability).description);
      expect(cards[i]!.textContent).toContain('Base stats (Casual');
      expect(cards[i]!.textContent).toContain('Permanent stat limits');
      expect(cards[i]!.textContent).toContain('touch Ability button');
    });
    expect(cards[0]!.textContent).toContain('3 hearts');
    expect(cards[1]!.textContent).toContain('5 hearts');
    expect(cards[2]!.textContent).toContain('2 hearts');
    expect(body().textContent).not.toContain('undefined');
  });

  it('includes all power-ups, including instant and shield effects', () => {
    topic('Power-ups').click();
    expect(body().querySelectorAll('.howto-card')).toHaveLength(Object.keys(PICKUPS).length);
    for (const p of Object.values(PICKUPS)) {
      expect(body().textContent).toContain(p.name);
      expect(body().textContent).toContain(p.description);
    }
    expect(body().textContent).toContain('refreshes its timer');
    expect(body().textContent).toContain('Bubble Wrap lasts until a hit uses it');
  });

  it('includes every shared and Character Perk, with ownership and stacking limits', () => {
    topic('Perks').click();
    const all: PerkData[] = [...Object.values(PERKS), ...Object.values(CHARACTER_PERKS)];
    expect(body().querySelectorAll('.howto-card')).toHaveLength(all.length);
    for (const p of all) {
      const card = [...body().querySelectorAll('.howto-card')].find((c) => c.querySelector('h4')!.textContent!.includes(p.name))!;
      expect(card.textContent).toContain(p.description);
      expect(card.textContent).toContain(p.unique ? 'Once per Run.' : `Up to ${p.maxStacks} stacks per Run.`);
      expect(card.parentElement!.querySelector('h3')!.textContent).toBe(p.character ? `${CHARACTERS.find((c) => c.id === p.character)!.name} only` : 'All Characters');
    }
  });

  it('shows every Keepsake at every rarity without needing to own it', () => {
    topic('Keepsakes').click();
    const cards = [...body().querySelectorAll('.howto-card')];
    expect(cards).toHaveLength(KEEPSAKE_TYPES.length);
    for (const k of KEEPSAKE_TYPES) {
      const card = cards.find((c) => c.querySelector('h4')!.textContent!.includes(k.name))!;
      expect(card.parentElement!.querySelector('h3')!.textContent).toContain(CHARACTERS.find((c) => c.id === k.characterId)!.name);
      expect([...card.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(RARITIES.map((r) => r.name));
      expect([...card.querySelectorAll('dd')].map((d) => d.textContent)).toEqual(RARITIES.map((r) => describeKeepsake({ type: k.id, rarity: r.rarity })));
    }
    expect(body().textContent).toContain('felt 3');
    expect(body().textContent).toContain('up to 2');
  });

  it('leaves Enter available for topic buttons and returns to the pause menu on Escape or Done', () => {
    screen.enter?.({ back: 'paused' });
    topic('Keepsakes').focus();
    expect(screen.onKey?.(new KeyboardEvent('keydown', { code: 'Enter' }))).toBe(false);
    expect(go).not.toHaveBeenCalled();
    topic('Keepsakes').click();
    expect(screen.onKey?.(new KeyboardEvent('keydown', { code: 'Escape' }))).toBe(true);
    expect(go).toHaveBeenLastCalledWith('paused');
    screen.el.querySelector<HTMLButtonElement>('.panel-actions button')!.click();
    expect(go).toHaveBeenLastCalledWith('paused');
  });

  it('resets the reference on re-entry and infers the correct return menu', () => {
    topic('Keepsakes').click();
    game.run = { ended: false } as Game['run'];
    screen.enter?.();
    expect(topic('Basics').getAttribute('aria-pressed')).toBe('true');
    screen.onKey?.(new KeyboardEvent('keydown', { code: 'Escape' }));
    expect(go).toHaveBeenLastCalledWith('paused');
    game.run = null;
    screen.enter?.();
    screen.onKey?.(new KeyboardEvent('keydown', { code: 'Escape' }));
    expect(go).toHaveBeenLastCalledWith('title');
    expect(screenRegistry.require('howToPlay').simulate).not.toBe(true);
  });
});
