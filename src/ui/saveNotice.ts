/**
 * The page-wide notice for a device save this build may not write (docs/adr/0001, issue #66).
 *
 * An old tab left open after a deploy finds the save written by the newer build. It keeps
 * working: the save is read (Fluff, Upgrades and Hoards show as they are) and play goes on, but
 * nothing done here is saved, since writing would downgrade the newer save (`SaveStore` refuses).
 * So while that lasts a small banner on every screen says so and offers Reload, which loads the
 * newer build. It is non-blocking on purpose: a Run in progress can still be played out, and the
 * player chooses when to reload. It appears as soon as the newer save arrives (another tab's
 * `storage` event, or the re-read before a write) and goes away if the save becomes writable again.
 */
import type { MetaProgress } from '../meta/meta';
import { button } from './components';
import { h } from './screens';

export const SAVE_NOTICE_TEXT = 'A newer version of Dust Bunny saved your progress. Nothing you do in this tab is saved until you reload.';

export function installSaveNotice(meta: MetaProgress, parent: HTMLElement): () => void {
  const reload = button('Reload', () => location.reload(), { variant: 'primary', size: 'sm' });
  const el = h('div', { className: 'save-notice' }, h('span', { textContent: SAVE_NOTICE_TEXT }), reload);
  el.setAttribute('role', 'status');
  const show = (): void => {
    el.hidden = meta.saveStatus !== 'newer';
  };
  show();
  parent.append(el);
  const off = meta.store.onChange(show);
  return () => {
    off();
    el.remove();
  };
}
