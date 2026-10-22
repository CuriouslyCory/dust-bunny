/**
 * Shared Keepsake UI pieces: grade pips, Keepsake chips, the Ability card's numbers with a
 * Loadout applied, and the narrator caption line. Used by Character select, Under the Couch,
 * the results "Kept" section, the HUD reward moment and the leaderboard panel.
 */
import { abilityParamsFor } from '../abilities/keepsakeParams';
import { getAbility, type AbilityId } from '../data/abilities';
import {
  describeKeepsake,
  getGrade,
  getKeepsakeType,
  keepsakeLabel,
  loadoutValue,
  type KeepsakeRef,
  type KeepsakeTypeId,
  type Loadout,
} from '../data/keepsakes';
import type { Game } from '../game/game';
import { h } from './screens';
import { settings } from './settings';
import './keepsakes.css';

const n1 = (x: number): string => (Math.round(x * 10) / 10).toString();

/**
 * The Ability's numbers with a Loadout's Keepsakes applied, as short "label value" parts. Read from
 * the same resolver the Run uses (abilityParamsFor), so the card shows what the Run plays with.
 */
export function abilityNumbers(ability: AbilityId, loadout: Loadout = []): string[] {
  const p = abilityParamsFor(loadout);
  switch (ability) {
    case 'decoy': {
      const d = p.decoy;
      const clog = d.bossClogStun === d.clogStun ? `${n1(d.clogStun)} s clog` : `${n1(d.clogStun)} s clog (bosses ${n1(d.bossClogStun)} s)`;
      return [`lasts ${n1(d.duration)} s`, `${n1(d.cooldown)} s cooldown`, clog];
    }
    case 'hunker': {
      const h = p.hunker;
      return [`hold up to ${n1(h.maxHold)} s`, `cooldown ${n1(h.cooldownBase)} s + ${n1(h.cooldownPerSecondHeld)} s per second held`];
    }
    case 'discharge': {
      const z = p.discharge;
      return [`full after ${n1(z.fillDistance / z.fillRate)} r rolled`, `${n1(z.range)} r range`];
    }
  }
}

/** One line per distinct Keepsake type in a Loadout, with two copies' values added together. */
export function loadoutEffects(loadout: Loadout): string[] {
  const seen = new Set<KeepsakeTypeId>();
  const out: string[] = [];
  for (const k of loadout) {
    if (seen.has(k.type)) continue;
    seen.add(k.type);
    const t = getKeepsakeType(k.type);
    if (t) out.push(`${t.icon} ${t.describe((key) => loadoutValue(loadout, k.type, key))}`);
  }
  return out;
}

/** The Ability card: icon, name, one-line description, numbers with the Loadout applied. */
export function abilityCard(ability: AbilityId, loadout: Loadout): HTMLElement {
  const a = getAbility(ability);
  const effects = loadoutEffects(loadout);
  return h(
    'div',
    { className: 'ks-ability' },
    h('span', { className: 'ks-ability-icon', textContent: a.icon }),
    h(
      'div',
      { className: 'ks-ability-text' },
      h('div', { className: 'ks-ability-name' }, h('b', { textContent: a.name }), h('span', { className: 'ks-ability-trigger', textContent: a.trigger === 'hold' ? 'hold E' : 'tap E' })),
      h('p', { className: 'ks-ability-desc', textContent: a.description }),
      h('p', { className: 'ks-ability-nums', textContent: abilityNumbers(ability, loadout).join(' · ') }),
      ...effects.map((e) => h('p', { className: 'ks-ability-effect', textContent: e })),
    ),
  );
}

/** A grade-coloured pip with the grade number. */
export function gradePip(grade: number, opts: { small?: boolean } = {}): HTMLElement {
  const g = getGrade(grade);
  const pip = h('span', { className: `ks-pip${opts.small ? ' small' : ''}`, textContent: opts.small ? '' : String(g.grade) });
  pip.style.setProperty('--grade', g.color);
  pip.title = `Grade ${g.grade} · ${g.material}`;
  return pip;
}

/** Icon, "Type · Material", grade pip; optional count and description. */
export function keepsakeChip(ref: KeepsakeRef, opts: { count?: number; describe?: boolean } = {}): HTMLElement {
  const t = getKeepsakeType(ref.type);
  const el = h(
    'span',
    { className: 'ks-chip' },
    h('span', { className: 'ks-chip-icon', textContent: t?.icon ?? '?' }),
    h(
      'span',
      { className: 'ks-chip-text' },
      h('span', { className: 'ks-chip-name', textContent: keepsakeLabel(ref) }),
      ...(opts.describe ? [h('span', { className: 'ks-chip-desc', textContent: describeKeepsake(ref) })] : []),
    ),
    gradePip(ref.grade),
    ...(opts.count !== undefined ? [h('span', { className: 'ks-chip-count', textContent: `×${opts.count}` })] : []),
  );
  el.style.setProperty('--grade', getGrade(ref.grade).color);
  return el;
}

let captionEl: HTMLElement | null = null;
let captionTimer = 0;

/**
 * Shows a narrator caption line at the bottom of the screen (over any screen) for a few seconds,
 * unless "Story captions" is off in Settings.
 */
export function narrate(game: Pick<Game, 'uiLayer'>, text: string, seconds = 6): void {
  if (!settings.value.storyCaptions) return;
  if (!captionEl) {
    captionEl = h('p', { className: 'story-caption' });
    captionEl.setAttribute('role', 'status');
    captionEl.setAttribute('aria-live', 'polite');
    game.uiLayer.append(captionEl);
  }
  const el = captionEl;
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(captionTimer);
  captionTimer = window.setTimeout(() => el.classList.remove('show'), seconds * 1000);
}
