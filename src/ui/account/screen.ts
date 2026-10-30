/**
 * "account" screen (sign in / out, cloud save status, Delete account) and the title screen's
 * account chip. Params: `{ back?: screenId, deleteAccount?: true }` (default 'title'; `deleteAccount`
 * opens straight on the deletion confirmation, after signing in if needed).
 *
 * While the deletion flow is open the address carries `?account=delete` (`DELETE_ACCOUNT_PARAM`),
 * the page the public link `/delete-account` redirects to (vercel.json): a sign-in that falls back
 * to a full-page redirect comes back into the flow.
 */
import type { Game } from '../../game/game';
import { account as defaultAccount, type AccountClient, type AccountState } from '../../net/account';
import { getCloudSave, type CloudSaveStatus } from '../../meta/cloudSave';
import { button, focusFirst, handleMenuKeys, isKey, panel } from '../components';
import { h, registerScreen } from '../screens';
import { avatar, providerButtons } from './widgets';

export interface AccountParams {
  back?: string;
  deleteAccount?: boolean;
}

/** `?account=delete`: the page opens on Delete account (src/main.ts). */
export const DELETE_ACCOUNT_PARAM = { name: 'account', value: 'delete' } as const;

/** Adds or removes `?account=delete` in the address bar, without a reload. */
function markDeleteUrl(on: boolean): void {
  if (typeof location === 'undefined' || typeof history === 'undefined') return;
  const url = new URL(location.href);
  if (on) url.searchParams.set(DELETE_ACCOUNT_PARAM.name, DELETE_ACCOUNT_PARAM.value);
  else if (url.searchParams.get(DELETE_ACCOUNT_PARAM.name) === DELETE_ACCOUNT_PARAM.value) url.searchParams.delete(DELETE_ACCOUNT_PARAM.name);
  if (url.href !== location.href) history.replaceState(history.state, '', url);
}

/**
 * Where the deletion flow stands: `confirm` (what goes and what stays, then Delete my account),
 * `reauth` (the server wants a recent sign-in first) or `deleting` (the request is out).
 */
type DeleteStep = 'none' | 'confirm' | 'reauth' | 'deleting';

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
      const deleteBtn = button('Delete account', () => setStep('confirm'), { variant: 'ghost', size: 'sm', className: 'acct-delete' });
      const confirmDelete = button('Delete my account', () => void doDelete(), { variant: 'danger' });
      const cancelDelete = button('Cancel', () => setStep('none'), { variant: 'ghost' });
      const reauthProviders = providerButtons(client);

      let step: DeleteStep = 'none';
      /** The Account the deletion flow was opened for (null: opened signed out, from the link). */
      let stepUser: string | null = null;
      /** Shown in place of the status line until the next account change: "Your account was deleted." */
      let notice: string | null = null;
      let wasPending = false;

      function setStep(next: DeleteStep): void {
        step = next;
        stepUser = next === 'none' ? null : (client.state.user?.id ?? null);
        markDeleteUrl(next !== 'none');
        render(client.state);
      }

      async function doDelete(): Promise<void> {
        if (step !== 'confirm') return;
        step = 'deleting';
        render(client.state);
        const result = await client.deleteAccount();
        if (result === 'deleted') {
          notice = 'Your account was deleted. You can keep playing without one.';
          setStep('none');
        } else if (result === 'reauth') setStep('reauth');
        else if (result === 'changed') {
          // Another tab signed in as someone else: nothing was deleted, and this one starts over.
          notice = 'You are signed in to a different account now. Nothing was deleted.';
          setStep('none');
        }
        else setStep('confirm'); // the error is shown; try again
      }

      /** Set after a failed flush: the next Sign out press goes ahead anyway. */
      let forceSignOut = false;

      async function doSignOut(): Promise<void> {
        signOut.disabled = true;
        try {
          const synced = (await getCloudSave()?.flush().catch(() => false)) ?? true;
          if (!synced && !forceSignOut) {
            // Signing out now would strand these changes on this device (another account signing in here replaces them).
            forceSignOut = true;
            sync.className = 'acct-sync error';
            sync.textContent = 'Your latest progress has not reached the server yet. Try again in a moment, or press Sign out again to sign out anyway.';
            return;
          }
          await client.signOut().catch(() => undefined); // failure: stays signed in, error shown
          forceSignOut = false;
        } finally {
          signOut.disabled = false;
        }
      }

      /** What the body currently shows; it is rebuilt only when this changes (keeps focus). */
      let shown = '';

      /** Changes the step from inside render (which then draws it). */
      function setStepQuiet(next: DeleteStep): void {
        step = next;
        stepUser = null;
        markDeleteUrl(next !== 'none');
      }

      function render(s: AccountState): void {
        if (s.pending || s.error) notice = null;
        // The flow belongs to one Account: signing in as another (or out) ends it. Opened signed out
        // (the public link), it is for whoever signs in. A finished re-sign-in goes back to confirm.
        if (step !== 'none' && s.status === 'signedIn' && s.user) {
          if (stepUser === null) stepUser = s.user.id;
          else if (stepUser !== s.user.id) setStepQuiet('none');
          if (step === 'reauth' && wasPending && !s.pending) step = 'confirm';
        } else if (step !== 'none' && s.status === 'signedOut' && stepUser !== null) setStepQuiet('none');
        wasPending = s.pending;

        msg.className = `acct-msg${s.error ? ' error' : ''}`;
        msg.textContent = s.error ?? (s.pending ? 'Finish signing in in the pop-up window…' : (notice ?? ''));
        const key = `${s.status}|${s.user?.id}|${s.user?.name}|${s.user?.image}|${step}`;
        if (key === shown) return;
        shown = key;
        confirmDelete.disabled = cancelDelete.disabled = step === 'deleting';
        if (s.status === 'signedIn' && s.user && step === 'reauth') {
          body.replaceChildren(
            h('p', { className: 'acct-pitch', textContent: 'For your safety, sign in again to delete your account.' }),
            reauthProviders,
            cancelDelete,
          );
          focusFirst(body);
        } else if (s.status === 'signedIn' && s.user && step !== 'none') {
          body.replaceChildren(
            h('div', { className: 'acct-who' }, avatar(s.user, 'lg'), h('div', {}, h('strong', { textContent: 'Delete your account?' }), h('span', { className: 'acct-fine', textContent: s.user.name || 'Signed in' }))),
            deletionSummary(),
            h('div', { className: 'acct-delete-actions' }, cancelDelete, confirmDelete),
          );
          if (step === 'confirm') focusFirst(body, cancelDelete);
        } else if (s.status === 'signedIn' && s.user) {
          body.replaceChildren(
            h('div', { className: 'acct-who' }, avatar(s.user, 'lg'), h('div', {}, h('strong', { textContent: s.user.name || 'Signed in' }), h('span', { className: 'acct-verified', textContent: '✓ Your leaderboard scores are verified' }))),
            sync,
            signOut,
            deleteBtn,
          );
        } else if (s.status === 'signedOut' && step !== 'none') {
          body.replaceChildren(
            h('p', { className: 'acct-pitch', textContent: 'Sign in with the account you want to delete. You will be asked to confirm before anything is deleted.' }),
            providers,
          );
          focusFirst(body);
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
          const p = params as AccountParams | undefined;
          back = p?.back ?? 'title';
          notice = null;
          step = 'none';
          stepUser = null;
          if (p?.deleteAccount) setStepQuiet('confirm');
          shown = '';
          offAccount = client.subscribe(render);
          offSync =
            getCloudSave()?.onStatus((st) => {
              sync.className = `acct-sync ${st}`;
              sync.textContent = SYNC_TEXT[st];
            }) ?? null;
          void client.refresh();
          if (step === 'none') focusFirst(el, done); // the deletion steps focus their own controls (render)
        },
        exit() {
          offAccount?.();
          offSync?.();
          if (step !== 'none') setStepQuiet('none');
        },
        onKey(e) {
          if (!e.repeat && isKey(e, 'Escape')) {
            if (step === 'confirm' || step === 'reauth') setStep('none');
            else if (step !== 'deleting') game.go(back);
            return true;
          }
          return handleMenuKeys(e, el);
        },
      };
    },
  });
}

/** What Delete account removes and what it leaves (server/accountDeletion.ts). */
function deletionSummary(): HTMLElement {
  const list = (items: string[]) => h('ul', {}, ...items.map((t) => h('li', { textContent: t })));
  return h(
    'div',
    { className: 'acct-delete-summary' },
    h('p', { textContent: 'Deleted for good:' }),
    list([
      'Your account and its Google / Discord sign-ins',
      'Your cloud save: Fluff, Upgrades, Keepsakes and stats',
      'Your saved run and run history',
    ]),
    h('p', { textContent: 'What stays:' }),
    list([
      'Your best leaderboard scores, as anonymous entries ("Anonymous Bunny", no ✓). Your other scores are removed.',
      'Progress on this device, for playing without an account',
    ]),
    h('p', { className: 'acct-delete-warn', textContent: 'This can’t be undone.' }),
  );
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
