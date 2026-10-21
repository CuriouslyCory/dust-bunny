/**
 * Character select: Title → here → Run. Shows each Character's stats (including owned
 * Upgrades and the Difficulty's heart change) as bars, strengths and weaknesses, plus the
 * Difficulty picker; remembers both choices in the save.
 * Keys: ←/→ (A/D) or 1–3 to choose, ↑/↓ for the Difficulty, Enter/Space to start, S for the
 * Shop, Esc for the title.
 * Phone-sized viewports show the cards as small picker chips plus one detail card for the
 * selected Character (.char-detail), so nothing has to scroll.
 */
import { CHARACTERS, DEFAULT_CHARACTER_ID, type CharacterDef } from '../../data/characters';
import { DIFFICULTIES, DIFFICULTY_IDS, difficultyModifiers, getDifficulty, type DifficultyDef, type DifficultyId } from '../../data/difficulty';
import { BASE_BUNNY_STATS, computeStats, type BunnyStatValues } from '../../entities/stats';
import type { Game } from '../../game/game';
import { getMeta } from '../../meta/meta';
import { isCompact, scrollArea, segmented } from '../components';
import { h, registerScreen } from '../screens';
import '../roguelike.css';

interface Bar {
  label: string;
  value: (s: BunnyStatValues) => number;
  /** Maps the stat to 0..1. */
  norm: (v: number) => number;
  fmt: (v: number) => string;
}

const BARS: Bar[] = [
  { label: 'Speed', value: (s) => s.speed, norm: (v) => v / 1.6, fmt: (v) => `×${v.toFixed(2)}` },
  { label: 'Hearts', value: (s) => Math.round(s.maxHealth), norm: (v) => v / 7, fmt: (v) => String(v) },
  { label: 'Size', value: (s) => s.startRadius, norm: (v) => v / 1.6, fmt: (v) => `${v.toFixed(2)} cm` },
  { label: 'Dash', value: (s) => s.dashCooldown, norm: (v) => (5 - v) / 4, fmt: (v) => `${v.toFixed(1)} s` },
  { label: 'Magnet', value: (s) => s.magnetRadius, norm: (v) => v / 1.2, fmt: (v) => (v > 0 ? `${v.toFixed(2)} r` : '—') },
];

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
          return h(
            'div',
            { className: 'rl-stat' },
            h('span', { className: 'rl-stat-label', textContent: b.label }),
            h('div', { className: 'rl-bar' }, fill),
            h('span', { className: 'rl-stat-val', textContent: b.fmt(v) }),
          );
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

      start.onclick = play;
      back.onclick = () => game.go('title');
      shop.onclick = () => game.go('shop', { back: 'characterSelect' });

      return {
        el: h(
          'div',
          { className: 'panel rl-panel char-select' },
          h('h2', { textContent: 'Choose your Bunny' }),
          scrollArea('char-body', cardsEl, detailEl),
          h('div', { className: 'char-diff-row' }, diffPicker.el, diffDesc),
          h('div', { className: 'rl-row char-actions' }, back, shop, start),
          h('p', { className: 'hint key-hint', textContent: '←/→ or 1–3 to choose · ↑/↓ difficulty · Enter to start · S for the Shop' }),
        ),
        enter() {
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
