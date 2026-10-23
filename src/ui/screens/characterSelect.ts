/**
 * Character select: Title → here → Run. Shows each Character's stats (including owned
 * Upgrades and the Difficulty's heart change) as bars, strengths and weaknesses, plus the
 * Difficulty picker; remembers both choices in the save.
 * Under the stats: the Character's Ability card (numbers with the Loadout applied) and two
 * Keepsake slots; a slot opens a picker filtered to that Character's Hoard. The Loadout is
 * remembered per Character (synced by the cloud save) and set as game.nextRunConfig.loadout. Stat bars carry
 * a tick at the Character's cap, with the cap's reason on hover.
 * Keys: ←/→ (A/D) or 1–3 to choose, ↑/↓ for the Difficulty, Enter/Space to start, S for the
 * Shop, U for Under the Couch, Esc for the title.
 * Phone-sized viewports show the cards as small picker chips plus one detail card for the
 * selected Character (.char-detail). There the Ability card and Keepsake slots move into the
 * scrolling body, so the details keep their height on short (landscape) screens.
 */
import { CHARACTERS, DEFAULT_CHARACTER_ID, type CharacterDef } from '../../data/characters';
import { getRarity, keepsakeLabel, LOADOUT_SLOTS, type KeepsakeRef } from '../../data/keepsakes';
import { DIFFICULTIES, DIFFICULTY_IDS, difficultyModifiers, getDifficulty, type DifficultyDef, type DifficultyId } from '../../data/difficulty';
import { BASE_BUNNY_STATS, computeStats, type BunnyStatValues, type StatKey } from '../../entities/stats';
import type { Game } from '../../game/game';
import { hoardEntries } from '../../meta/hoard';
import { getMeta } from '../../meta/meta';
import { COMPACT_QUERY, handleMenuKeys, isCompact, scrollArea, segmented } from '../components';
import { abilityCard, keepsakeChip } from '../keepsakeUi';
import { h, registerScreen } from '../screens';
import '../roguelike.css';

interface Bar {
  label: string;
  value: (s: BunnyStatValues) => number;
  /** Maps the stat to 0..1. */
  norm: (v: number) => number;
  fmt: (v: number) => string;
  /** Stat whose per-Character cap gets a tick on the bar. */
  cap?: StatKey;
}

const BARS: Bar[] = [
  { label: 'Speed', value: (s) => s.speed, norm: (v) => v / 1.6, fmt: (v) => `×${v.toFixed(2)}`, cap: 'speed' },
  { label: 'Hearts', value: (s) => Math.round(s.maxHealth), norm: (v) => v / 7, fmt: (v) => String(v), cap: 'maxHealth' },
  { label: 'Size', value: (s) => s.startRadius, norm: (v) => v / 1.6, fmt: (v) => `${v.toFixed(2)} cm` },
  { label: 'Dash', value: (s) => s.dashCooldown, norm: (v) => (5 - v) / 4, fmt: (v) => `${v.toFixed(1)} s`, cap: 'dashCooldown' },
  { label: 'Magnet', value: (s) => s.magnetRadius, norm: (v) => v / 1.2, fmt: (v) => (v > 0 ? `${v.toFixed(2)} r` : '—'), cap: 'magnetRadius' },
];

/** Tick at the Character's cap for a bar (null when the stat has no cap). */
function capTick(c: CharacterDef, b: Bar): { el: HTMLElement; title: string } | null {
  const cap = b.cap ? c.caps[b.cap] : undefined;
  const limit = cap?.max ?? cap?.min;
  if (!cap || limit === undefined) return null;
  const tick = h('i', { className: 'rl-cap-tick' });
  tick.style.left = `${Math.round(Math.max(0, Math.min(1, b.norm(limit))) * 100)}%`;
  const title = `${cap.max !== undefined ? 'Cap' : 'Floor'} ${b.fmt(limit)}: ${cap.reason}`;
  tick.title = title;
  return { el: tick, title };
}

export function characterStats(c: CharacterDef, difficulty: DifficultyDef = DIFFICULTIES.casual): BunnyStatValues {
  return computeStats({ ...BASE_BUNNY_STATS, ...c.stats }, [...difficultyModifiers(difficulty), ...getMeta().runModifiers()]);
}

function furBall(c: CharacterDef): HTMLElement {
  const ball = h('div', { className: `rl-fur rl-eyes-${c.look.eyeStyle}` }, h('i'), h('i'));
  ball.style.setProperty('--fur', c.look.color);
  ball.style.setProperty('--fur-tip', c.look.tipColor);
  ball.style.setProperty('--fluff', String(c.look.fluffiness));
  return ball;
}

export function registerCharacterSelectScreen(): void {
  registerScreen({
    id: 'characterSelect',
    create(game: Game) {
      const meta = getMeta();
      const cardsEl = h('div', { className: 'char-cards' });
      const detailEl = h('div', { className: 'char-detail' });
      detailEl.setAttribute('aria-live', 'polite');
      const start = h('button', { className: 'btn primary char-start', type: 'button' });
      const back = h('button', { className: 'btn', type: 'button', textContent: 'Back' });
      const shop = h('button', { className: 'btn', type: 'button' });
      const diffDesc = h('p', { className: 'char-diff-desc' });
      diffDesc.setAttribute('aria-live', 'polite');
      let index = 0;
      let difficulty = getDifficulty(game.nextRunConfig.difficulty ?? meta.data.lastDifficulty);
      const loadoutEl = h('div', { className: 'ks-loadout' });
      const picker = h('div', { className: 'ks-picker' });
      picker.hidden = true;
      picker.setAttribute('role', 'dialog');
      picker.setAttribute('aria-modal', 'true');
      let pickerReturn: HTMLElement | null = null;

      const setLoadout = (c: CharacterDef, slots: Array<KeepsakeRef | null>) => {
        game.nextRunConfig.loadout = meta.setLastLoadout(c.id, slots.filter((k): k is KeepsakeRef => k !== null));
        renderLoadout();
      };

      const closePicker = () => {
        picker.hidden = true;
        picker.replaceChildren();
        pickerReturn?.focus({ preventScroll: true });
      };

      /** Picker for one slot: "Empty" plus every Hoard cell with a copy not in the other slot. */
      const openPicker = (slot: number, from: HTMLElement) => {
        const c = CHARACTERS[index]!;
        const current: Array<KeepsakeRef | null> = [...meta.lastLoadout(c.id)];
        while (current.length < LOADOUT_SLOTS) current.push(null);
        const other = current.filter((_, i) => i !== slot);
        const entries = hoardEntries(c.id, meta.hoardOf(c.id));
        const pick = (ref: KeepsakeRef | null) => {
          current[slot] = ref;
          pickerReturn = null;
          closePicker();
          setLoadout(c, current);
          (loadoutEl.querySelectorAll<HTMLElement>('.ks-slot')[Math.min(slot, LOADOUT_SLOTS - 1)])?.focus({ preventScroll: true });
        };
        const empty = h('button', { className: 'ks-pick ks-pick-empty', type: 'button', textContent: 'Empty slot' });
        empty.onclick = () => pick(null);
        const options = entries.map((e) => {
          const used = other.filter((k) => k && k.type === e.type && k.rarity === e.rarity).length;
          const left = e.count - used;
          const b = h('button', { className: 'ks-pick', type: 'button' }, keepsakeChip(e, { count: left, describe: true }));
          b.disabled = left < 1;
          const cur = current[slot];
          if (cur && cur.type === e.type && cur.rarity === e.rarity) b.classList.add('selected');
          b.onclick = () => pick({ type: e.type, rarity: e.rarity });
          return b;
        });
        const cancel = h('button', { className: 'btn', type: 'button', textContent: 'Cancel' });
        cancel.onclick = closePicker;
        picker.replaceChildren(
          h('h3', { textContent: `Tuck into ${c.name}'s fur · slot ${slot + 1}` }),
          h(
            'div',
            { className: 'ks-pick-list' },
            empty,
            ...options,
            ...(entries.length ? [] : [h('p', { className: 'ks-pick-none', textContent: `${c.name} has no Keepsakes yet. Bosses leave them in the fur of the Bunny that absorbs them.` })]),
          ),
          h('div', { className: 'rl-row' }, cancel),
        );
        pickerReturn = from;
        picker.hidden = false;
        ((picker.querySelector('.ks-pick.selected') ?? empty) as HTMLElement).focus({ preventScroll: true });
      };

      /** Ability card and the two Keepsake slots for the selected Character. */
      const renderLoadout = () => {
        const c = CHARACTERS[index]!;
        const l = meta.lastLoadout(c.id);
        game.nextRunConfig.loadout = l;
        const slots = Array.from({ length: LOADOUT_SLOTS }, (_, i) => {
          const k = l[i];
          const b = h('button', { className: `ks-slot${k ? ' filled' : ''}`, type: 'button' });
          if (k) {
            b.append(keepsakeChip(k, { describe: true }));
            b.style.setProperty('--rarity', getRarity(k.rarity).color);
            b.setAttribute('aria-label', `Slot ${i + 1}: ${keepsakeLabel(k)}. Change`);
          } else {
            b.append(h('span', { className: 'ks-slot-empty', textContent: '＋ Tuck in a Keepsake' }));
            b.setAttribute('aria-label', `Slot ${i + 1}: empty. Tuck in a Keepsake`);
          }
          b.onclick = () => openPicker(i, b);
          return b;
        });
        const couch = h('button', { className: 'btn btn-sm ks-couch', type: 'button', textContent: '🛋 Under the Couch' });
        couch.onclick = () => game.go('underTheCouch', { back: 'characterSelect', characterId: c.id });
        loadoutEl.replaceChildren(abilityCard(c.ability, l), h('div', { className: 'ks-slots' }, ...slots, couch));
      };

      const setDifficulty = (id: DifficultyId) => {
        difficulty = getDifficulty(id);
        game.nextRunConfig.difficulty = difficulty.id;
        meta.setLastDifficulty(difficulty.id);
        diffPicker.set(difficulty.id);
        diffDesc.textContent = difficulty.description;
        refreshDetails();
      };
      const diffPicker = segmented<DifficultyId>({
        label: 'Difficulty',
        value: difficulty.id,
        options: DIFFICULTY_IDS.map((id) => ({ value: id, label: DIFFICULTIES[id].name })),
        onChange: setDifficulty,
      });
      diffPicker.el.classList.add('char-diff');
      diffPicker.el.querySelectorAll<HTMLElement>('.segment').forEach((b) => (b.title = getDifficulty(b.dataset.value).description));
      const cycleDifficulty = (step: number) => {
        const i = DIFFICULTY_IDS.indexOf(difficulty.id);
        setDifficulty(DIFFICULTY_IDS[(i + step + DIFFICULTY_IDS.length) % DIFFICULTY_IDS.length]!);
      };

      const select = (i: number) => {
        index = (i + CHARACTERS.length) % CHARACTERS.length;
        const c = CHARACTERS[index]!;
        game.nextRunConfig.characterId = c.id;
        meta.setLastCharacter(c.id);
        [...cardsEl.children].forEach((el, j) => {
          el.classList.toggle('selected', j === index);
          el.setAttribute('aria-pressed', String(j === index));
        });
        start.textContent = `Start as ${c.name}`;
        detailEl.replaceChildren(...details(c));
        renderLoadout();
      };

      const play = () => {
        select(index);
        game.startRun();
      };

      /** Description, stat bars and traits: inside each card, and in the compact detail card. */
      const details = (c: CharacterDef): HTMLElement[] => {
        const s = characterStats(c, difficulty);
        const bars = BARS.map((b) => {
          const v = b.value(s);
          const fill = h('div', { className: 'rl-bar-fill' });
          fill.style.width = `${Math.round(Math.max(0.04, Math.min(1, b.norm(v))) * 100)}%`;
          const tick = capTick(c, b);
          const stat = h(
            'div',
            { className: 'rl-stat' },
            h('span', { className: 'rl-stat-label', textContent: b.label }),
            h('div', { className: 'rl-bar' }, fill, ...(tick ? [tick.el] : [])),
            h('span', { className: 'rl-stat-val', textContent: b.fmt(v) }),
          );
          if (tick) stat.title = tick.title;
          return stat;
        });
        return [
          h('p', { className: 'char-desc', textContent: c.description }),
          h('div', { className: 'rl-stats' }, ...bars),
          h('ul', { className: 'char-traits' }, ...c.strengths.map((t) => h('li', { className: 'good', textContent: t })), ...c.weaknesses.map((t) => h('li', { className: 'bad', textContent: t }))),
        ];
      };

      /** Hearts depend on the Difficulty: re-render the stats in place (keeps focus on the cards). */
      const refreshDetails = () => {
        cardsEl.querySelectorAll('.char-card-details').forEach((el, i) => el.replaceChildren(...details(CHARACTERS[i]!)));
        detailEl.replaceChildren(...details(CHARACTERS[index]!));
      };

      const build = () => {
        cardsEl.replaceChildren(
          ...CHARACTERS.map((c, i) => {
            const card = h(
              'button',
              { className: 'char-card', type: 'button' },
              h('span', { className: 'perk-key', textContent: String(i + 1) }),
              furBall(c),
              h('h3', { textContent: c.name }),
              h('div', { className: 'char-card-details' }, ...details(c)),
            );
            // Clicking the chosen card starts the Run; compact chips only select (no accidental starts).
            card.onclick = () => (index === i && !isCompact() ? play() : select(i));
            return card;
          }),
        );
      };

      const body = scrollArea('char-body', cardsEl, detailEl);
      const placeLoadout = () => (isCompact() ? body.append(loadoutEl) : body.after(loadoutEl));
      if (typeof matchMedia === 'function') matchMedia(COMPACT_QUERY).addEventListener('change', placeLoadout);

      start.onclick = play;
      back.onclick = () => game.go('title');
      shop.onclick = () => game.go('shop', { back: 'characterSelect' });

      return {
        el: h(
          'div',
          { className: 'panel rl-panel char-select' },
          h('h2', { textContent: 'Choose your Bunny' }),
          body,
          loadoutEl,
          picker,
          h(
            'div',
            { className: 'char-foot' },
            h('div', { className: 'char-diff-row' }, diffPicker.el, diffDesc),
            h('div', { className: 'rl-row char-actions' }, back, shop, start),
          ),
          h('p', { className: 'hint key-hint', textContent: '←/→ or 1–3 to choose · ↑/↓ difficulty · Enter to start · S Shop · U Under the Couch' }),
        ),
        enter() {
          placeLoadout();
          difficulty = getDifficulty(game.nextRunConfig.difficulty ?? meta.data.lastDifficulty);
          game.nextRunConfig.difficulty = difficulty.id;
          diffPicker.set(difficulty.id);
          diffDesc.textContent = difficulty.description;
          build();
          const want = game.nextRunConfig.characterId ?? meta.data.lastCharacterId ?? DEFAULT_CHARACTER_ID;
          select(Math.max(0, CHARACTERS.findIndex((c) => c.id === want)));
          shop.textContent = `Shop · ${meta.fluff} Fluff`;
          start.focus({ preventScroll: true });
        },
        onKey(e) {
          if (!picker.hidden) {
            if (e.code === 'Escape') {
              closePicker();
              return true;
            }
            return handleMenuKeys(e, picker);
          }
          if (e.repeat) return false;
          // A focused Difficulty segment, Back or Shop handles Enter/Space itself (native click),
          // and ←/→ move along the Difficulty switch instead of changing the Character.
          const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          const onSegment = !!focused?.closest('.char-diff');
          if ((e.code === 'Enter' || e.code === 'Space') && focused?.matches('button:not(.char-card):not(.char-start)')) return false;
          if (onSegment && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
            cycleDifficulty(e.code === 'ArrowLeft' ? -1 : 1);
            (diffPicker.el.querySelector(`[data-value="${difficulty.id}"]`) as HTMLElement | null)?.focus();
            return true;
          }
          const n = /^Digit([1-9])$/.exec(e.code);
          if (n && Number(n[1]) <= CHARACTERS.length) {
            select(Number(n[1]) - 1);
            return true;
          }
          switch (e.code) {
            case 'ArrowLeft':
            case 'KeyA':
              select(index - 1);
              return true;
            case 'ArrowRight':
            case 'KeyD':
              select(index + 1);
              return true;
            case 'ArrowUp':
              cycleDifficulty(-1);
              return true;
            case 'ArrowDown':
              cycleDifficulty(1);
              return true;
            case 'Enter':
            case 'Space':
              play();
              return true;
            case 'KeyS':
              game.go('shop', { back: 'characterSelect' });
              return true;
            case 'KeyU':
              game.go('underTheCouch', { back: 'characterSelect', characterId: CHARACTERS[index]!.id });
              return true;
            case 'Escape':
              game.go('title');
              return true;
          }
          return false;
        },
      };
    },
  });
}
