/**
 * Self-contained leaderboard panel: optional name entry + submit for the Run just ended,
 * character filter, top-20 table (current Run highlighted) and an online/local indicator.
 *
 *   const board = createLeaderboardPanel({ submit: true });
 *   parent.append(board.el);
 *   board.showRun(runEndedPayload);   // results screen: arms the form for this Run
 *   board.refresh();                  // leaderboard screen: just reload the table
 */
import type { GameEvents } from '../../core/events';
import { CHARACTERS, getCharacter } from '../../data/characters';
import { getTier } from '../../data/tiers';
import { leaderboard as defaultClient, LeaderboardError, submissionFromRun, type LeaderboardClient, type LeaderboardEntry } from '../../net/leaderboard';
import { NAME_MAX_LENGTH } from '../../shared/leaderboard';
import { h } from '../screens';
import './leaderboard.css';

export interface LeaderboardPanelOptions {
  /** Show the name entry form (results screen). */
  submit?: boolean;
  client?: LeaderboardClient;
}

export interface LeaderboardPanel {
  el: HTMLElement;
  /** Arms the submit form for a finished Run and reloads the table. */
  showRun(e: GameEvents['runEnded']): void;
  refresh(): Promise<void>;
  /** Focus the name input if the form is armed; returns whether it did. */
  focusName(): boolean;
}

const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function createLeaderboardPanel(opts: LeaderboardPanelOptions = {}): LeaderboardPanel {
  const client = opts.client ?? defaultClient;
  let run: GameEvents['runEnded'] | null = null;
  let submitted: { entry: LeaderboardEntry; rank: number | null } | null = null;
  let filter = '';
  let loadToken = 0;

  const status = h('span', { className: 'lb-status', textContent: '…' });
  const head = h('div', { className: 'lb-head' }, h('h3', { textContent: 'Leaderboard' }), status);

  // Name entry. Key events stop here so the game's window-level handlers (movement keys
  // that preventDefault Space, results-screen Enter, debug keys) don't see typing.
  const input = h('input', { className: 'lb-name', type: 'text', maxLength: NAME_MAX_LENGTH, placeholder: 'Your name', spellcheck: false });
  input.setAttribute('aria-label', 'Name for the leaderboard');
  input.setAttribute('autocomplete', 'nickname');
  input.addEventListener('keydown', (e) => e.stopPropagation());
  const submitBtn = h('button', { className: 'btn primary lb-submit', type: 'submit', textContent: 'Submit score' });
  const form = h('form', { className: 'lb-form' }, input, submitBtn);
  form.hidden = true;
  const msg = h('p', { className: 'lb-msg' });
  msg.setAttribute('role', 'status');

  const tabs = h('div', { className: 'lb-tabs' });
  tabs.setAttribute('role', 'tablist');
  const tabDefs: Array<[string, string]> = [['', 'All'], ...CHARACTERS.map((c): [string, string] => [c.id, c.name])];
  const tabButtons = tabDefs.map(([id, label]) => {
    const b = h('button', { className: 'lb-tab', type: 'button', textContent: label });
    b.setAttribute('role', 'tab');
    b.onclick = () => {
      filter = id;
      void refresh();
    };
    return { id, b };
  });
  tabs.append(...tabButtons.map((t) => t.b));

  const tbody = h('tbody');
  const table = h(
    'table',
    { className: 'lb-table' },
    h('thead', {}, h('tr', {}, ...['#', 'Name', 'Bunny', 'Score', 'Tier', 'Time'].map((t) => h('th', { textContent: t })))),
    tbody,
  );
  const empty = h('p', { className: 'lb-empty', textContent: 'No scores yet. Be the first!' });
  const wrap = h('div', { className: 'lb-table-wrap' }, table, empty);

  const el = h('section', { className: 'leaderboard' }, head, form, msg, tabs, wrap);
  if (!opts.submit) form.remove();

  function setStatus(online: boolean | null): void {
    status.className = `lb-status ${online === null ? '' : online ? 'online' : 'offline'}`;
    status.textContent = online === null ? '…' : online ? 'Online' : 'Local only';
    status.title = online === false ? 'Leaderboard server unavailable: scores are saved on this device.' : '';
  }

  function row(e: LeaderboardEntry, rank: number | string, mine: boolean): HTMLTableRowElement {
    const tr = h(
      'tr',
      { className: mine ? 'lb-mine' : '' },
      h('td', { textContent: String(rank) }),
      h('td', { className: 'lb-n', textContent: e.name }),
      h('td', { textContent: getCharacter(e.character).name }),
      h('td', { className: 'lb-score', textContent: e.score.toLocaleString() }),
      h('td', { textContent: e.victory ? '★' : String(e.tierReached), title: getTier(e.tierReached).name }),
      h('td', { textContent: fmtTime(e.durationMs) }),
    );
    return tr;
  }

  function render(entries: LeaderboardEntry[]): void {
    const mineId = submitted?.entry.id;
    const rows = entries.map((e, i) => row(e, i + 1, e.id === mineId));
    const mineShown = entries.some((e) => e.id === mineId);
    const mineMatches = submitted && (!filter || submitted.entry.character === filter);
    if (submitted && !mineShown && mineMatches) {
      const gap = h('tr', { className: 'lb-gap' }, h('td', { colSpan: 6, textContent: '⋯' }));
      rows.push(gap, row(submitted.entry, filter ? '–' : (submitted.rank ?? '–'), true));
    }
    tbody.replaceChildren(...rows);
    empty.hidden = rows.length > 0;
    table.hidden = rows.length === 0;
    for (const t of tabButtons) t.b.setAttribute('aria-selected', String(t.id === filter));
    el.querySelector('.lb-mine')?.scrollIntoView?.({ block: 'nearest' });
  }

  async function refresh(): Promise<void> {
    const token = ++loadToken;
    try {
      const { entries, online } = await client.getTop({ character: filter || undefined });
      if (token !== loadToken) return;
      setStatus(online);
      render(entries);
    } catch (err) {
      if (token !== loadToken) return;
      setStatus(client.isOnline());
      msg.textContent = err instanceof Error ? err.message : 'Could not load the leaderboard.';
    }
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!run || submitted) return;
    const name = input.value;
    submitBtn.disabled = input.disabled = true;
    msg.className = 'lb-msg';
    msg.textContent = 'Submitting…';
    try {
      const res = await client.submitScore(submissionFromRun(run.stats, run.reason, name));
      client.setPlayerName(name);
      submitted = { entry: res.entry, rank: res.rank };
      input.value = res.entry.name;
      const where = res.online ? '' : ' on this device';
      msg.textContent = `${res.rank ? `Rank #${res.rank}${where}` : `Saved${where}`} · ${res.entry.score.toLocaleString()} pts${res.nameCensored ? ' (name replaced)' : ''}`;
      form.hidden = true;
      setStatus(res.online);
      await refresh();
    } catch (err) {
      msg.className = 'lb-msg error';
      msg.textContent = err instanceof LeaderboardError ? err.message : 'Could not submit the score.';
      submitBtn.disabled = input.disabled = false;
    }
  });

  return {
    el,
    showRun(e) {
      run = e;
      submitted = null;
      filter = '';
      input.value = client.getPlayerName();
      input.disabled = submitBtn.disabled = false;
      form.hidden = !opts.submit;
      msg.className = 'lb-msg';
      msg.textContent = '';
      void refresh();
    },
    refresh,
    focusName() {
      if (form.hidden || !form.isConnected) return false;
      input.focus();
      return true;
    },
  };
}
