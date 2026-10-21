/** Placeholder screens: title, playing, paused, results. Polish/replace by re-registering the same ids. */
import { getTier } from '../../data/tiers';
import type { GameEvents } from '../../core/events';
import { getMeta } from '../../meta/meta';
import { h, registerScreen } from '../screens';

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const isKey = (e: KeyboardEvent, ...codes: string[]) => codes.includes(e.code);

export function registerBuiltinScreens(): void {
  registerScreen({
    id: 'title',
    create(game) {
      const play = h('button', { className: 'btn primary', textContent: 'Play' });
      play.onclick = () => game.go('characterSelect');
      const shop = h('button', { className: 'btn', textContent: 'Shop' });
      shop.onclick = () => game.go('shop', { back: 'title' });
      const el = h(
        'div',
        { className: 'panel' },
        h('h1', { textContent: 'Dust Bunny' }),
        h('p', { className: 'sub', textContent: 'Roll. Absorb. Grow. Avoid the cleaning crew.' }),
        play,
        shop,
        h('p', { className: 'hint', textContent: 'WASD / arrows or click-and-hold to roll · Space/Shift to dash · Esc/P to pause' }),
      );
      return {
        el,
        enter: () => play.focus(),
        onKey(e) {
          if (isKey(e, 'Enter', 'Space')) {
            game.go('characterSelect');
            return true;
          }
          return false;
        },
      };
    },
  });

  registerScreen({
    id: 'playing',
    simulate: true,
    hud: true,
    create(game) {
      return {
        el: h('div', { className: 'screen-empty' }),
        onKey(e) {
          if (!e.repeat && isKey(e, 'Escape', 'KeyP')) {
            game.go('paused');
            return true;
          }
          return false;
        },
      };
    },
  });

  registerScreen({
    id: 'paused',
    hud: true,
    create(game) {
      const resume = h('button', { className: 'btn primary', textContent: 'Resume' });
      resume.onclick = () => game.go('playing');
      const quit = h('button', { className: 'btn', textContent: 'End Run' });
      quit.onclick = () => game.quitRun();
      return {
        el: h('div', { className: 'panel' }, h('h2', { textContent: 'Paused' }), resume, quit),
        enter: () => resume.focus(),
        onKey(e) {
          if (!e.repeat && isKey(e, 'Escape', 'KeyP')) {
            game.go('playing');
            return true;
          }
          return false;
        },
      };
    },
  });

  registerScreen({
    id: 'results',
    create(game) {
      const title = h('h2');
      const list = h('dl', { className: 'stats' });
      const again = h('button', { className: 'btn primary', textContent: 'Play again' });
      again.onclick = () => game.startRun();
      const shop = h('button', { className: 'btn', textContent: 'Shop' });
      shop.onclick = () => game.go('shop', { back: 'characterSelect' });
      const toTitle = h('button', { className: 'btn', textContent: 'Title' });
      toTitle.onclick = () => {
        game.disposeRun();
        game.go('title');
      };
      return {
        el: h('div', { className: 'panel' }, title, list, again, shop, toTitle),
        enter(params) {
          const e = params as GameEvents['runEnded'] | undefined;
          if (!e) return;
          title.textContent = e.reason === 'victory' ? 'Victory!' : e.reason === 'died' ? 'Swept up!' : 'Run over';
          const s = e.stats;
          const rows: Array<[string, string]> = [
            ['Time', fmtTime(s.timeSec)],
            ['Max radius', `${s.maxRadius.toFixed(1)} cm`],
            ['Debris absorbed', String(s.debrisAbsorbed)],
            ['Tier reached', `${s.tierReached} · ${getTier(s.tierReached).name}`],
            ['Seed', s.seed],
          ];
          const award = getMeta().awardRun(e);
          rows.push(['Fluff earned', `+${award.fluff}${e.reason === 'victory' ? ' (×1.5)' : ''}`], ['Fluff total', String(award.total)]);
          list.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', { textContent: k }), h('dd', { textContent: v })]));
          again.focus();
        },
        onKey(e) {
          if (isKey(e, 'Enter')) {
            game.startRun();
            return true;
          }
          return false;
        },
      };
    },
  });
}
