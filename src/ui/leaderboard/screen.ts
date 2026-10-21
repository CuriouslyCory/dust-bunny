/** "leaderboard" screen (from the title): browse the top 20, no submission. */
import { h, registerScreen } from '../screens';
import { createLeaderboardPanel } from './panel';

export function registerLeaderboardScreen(): void {
  registerScreen({
    id: 'leaderboard',
    create(game) {
      const board = createLeaderboardPanel();
      const back = h('button', { className: 'btn', textContent: 'Back' });
      back.onclick = () => game.go('title');
      return {
        el: h('div', { className: 'panel' }, board.el, back),
        enter() {
          void board.refresh();
          back.focus();
        },
        onKey(e) {
          if (!e.repeat && (e.code === 'Escape' || e.code === 'Backspace')) {
            game.go('title');
            return true;
          }
          return false;
        },
      };
    },
  });
}
