/**
 * "account" screen (sign in / out, cloud save status) and the title screen's account chip.
 * Params: `{ back?: screenId }` (default 'title').
 */
import type { Game } from '../../game/game';
import { account as defaultAccount, type AccountClient, type AccountState } from '../../net/account';
import { getCloudSave, type CloudSaveStatus } from '../../meta/cloudSave';
import { button, focusFirst, handleMenuKeys, isKey, panel } from '../components';
import { h, registerScreen } from '../screens';
import { avatar, providerButtons } from './widgets';

export interface AccountParams {
  back?: string;
}

const SYNC_TEXT: Record<CloudSaveStatus, string> = {
  off: '',
  syncing: 'Syncing your Fluff and Upgrades…',
  synced: 'Fluff and Upgrades are saved to your account.',
  error: 'Could not reach the server. Your progress is safe on this device and will sync later.',
};

export function registerAccountScreen(client: AccountClient = defaultAccount): void {
  registerScreen({
    id: 'account',
    create(game: Game) {
      let back = 'title';
      const body = h('div', { className: 'acct-body' });
      const msg = h('p', { className: 'acct-msg' });
      msg.setAttribute('role', 'status');
      const sync = h('p', { className: 'acct-sync' });
      const providers = providerButtons(client);
      const signOut = button('Sign out', () => void doSignOut(), { variant: 'ghost', className: 'acct-signout' });
      const done = button('Back', () => game.go(back), { variant: 'primary' });

      async function doSignOut(): Promise<void> {
        signOut.disabled = true;
        await getCloudSave()
          ?.flush()
          .catch(() => undefined);
        await client.signOut().catch(() => undefined);
        signOut.disabled = false;
      }

      function render(s: AccountState): void {
        msg.className = `acct-msg${s.error ? ' error' : ''}`;
        msg.textContent = s.error ?? (s.pending ? 'Finish signing in in the pop-up window…' : '');
        if (s.status === 'signedIn' && s.user) {
          body.replaceChildren(
            h('div', { className: 'acct-who' }, avatar(s.user, 'lg'), h('div', {}, h('strong', { textContent: s.user.name || 'Signed in' }), h('span', { className: 'acct-verified', textContent: '✓ Your leaderboard scores are verified' }))),
            sync,
            signOut,
          );
        } else if (s.status === 'signedOut') {
          body.replaceChildren(
            h('p', { className: 'acct-pitch', textContent: 'Sign in to keep your Fluff and Upgrades on every device and get a ✓ next to your leaderboard scores.' }),
            providers,
            h('p', { className: 'acct-fine', textContent: 'No account needed to play: without one, scores post as anonymous. We never show your email.' }),
          );
        } else {
          body.replaceChildren(
            h('p', {
              className: 'acct-pitch',
              textContent: s.status === 'unknown' ? 'Checking…' : 'Accounts are not available right now. Keep playing: scores post as anonymous and progress stays on this device.',
            }),
          );
        }
      }

      const el = panel({ title: 'Account', className: 'account-panel' }, body, msg, h('div', { className: 'panel-actions' }, done));
      let offAccount: (() => void) | null = null;
      let offSync: (() => void) | null = null;
      return {
        el,
        enter(params) {
          back = (params as AccountParams | undefined)?.back ?? 'title';
          offAccount = client.subscribe(render);
          offSync =
            getCloudSave()?.onStatus((st) => {
              sync.className = `acct-sync ${st}`;
              sync.textContent = SYNC_TEXT[st];
            }) ?? null;
          void client.refresh();
          focusFirst(el, done);
        },
        exit() {
          offAccount?.();
          offSync?.();
        },
        onKey(e) {
          if (!e.repeat && isKey(e, 'Escape')) {
            game.go(back);
            return true;
          }
          return handleMenuKeys(e, el);
        },
      };
    },
  });
}

/** Title screen corner button: "Sign in", or the signed-in player's avatar and name. Hidden when accounts are unavailable. */
export function accountChip(game: Game, client: AccountClient = defaultAccount): HTMLElement {
  const el = h('button', { type: 'button', className: 'btn acct-chip' });
  el.addEventListener('click', () => game.go('account', { back: 'title' }));
  client.subscribe((s) => {
    el.hidden = s.status === 'unknown' || s.status === 'unavailable';
    if (s.status === 'signedIn' && s.user) {
      el.replaceChildren(avatar(s.user), h('span', { className: 'acct-chip-name', textContent: s.user.name || 'Account' }));
      el.setAttribute('aria-label', `Account: signed in as ${s.user.name}`);
    } else {
      el.replaceChildren(h('span', { className: 'acct-chip-icon', textContent: '👤' }), h('span', { className: 'acct-chip-name', textContent: 'Sign in' }));
      el.setAttribute('aria-label', 'Sign in');
    }
  });
  return el;
}
