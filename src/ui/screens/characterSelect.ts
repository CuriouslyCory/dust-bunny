/**
 * Character select: Title → here → Run. Shows each Character's stats (including owned
 * Upgrades) as bars, strengths and weaknesses; remembers the last choice in the save.
 * Keys: ←/→ (A/D) or 1–3 to choose, Enter/Space to start, S for the Shop, Esc for the title.
 * Phone-sized viewports show the cards as small picker chips plus one detail card for the
 * selected Character (.char-detail), so nothing has to scroll.
 */
import { CHARACTERS, DEFAULT_CHARACTER_ID, type CharacterDef } from '../../data/characters';
import { BASE_BUNNY_STATS, computeStats, type BunnyStatValues } from '../../entities/stats';
import type { Game } from '../../game/game';
import { getMeta } from '../../meta/meta';
import { isCompact, scrollArea } from '../components';
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

export function characterStats(c: CharacterDef): BunnyStatValues {
  return computeStats({ ...BASE_BUNNY_STATS, ...c.stats }, getMeta().runModifiers());
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
      let index = 0;

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
        const s = characterStats(c);
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
          h('div', { className: 'rl-row char-actions' }, back, shop, start),
          h('p', { className: 'hint key-hint', textContent: '←/→ or 1–3 to choose · Enter to start · S for the Shop' }),
        ),
        enter() {
          build();
          const want = game.nextRunConfig.characterId ?? meta.data.lastCharacterId ?? DEFAULT_CHARACTER_ID;
          select(Math.max(0, CHARACTERS.findIndex((c) => c.id === want)));
          shop.textContent = `Shop · ${meta.fluff} Fluff`;
          start.focus({ preventScroll: true });
        },
        onKey(e) {
          if (e.repeat) return false;
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
