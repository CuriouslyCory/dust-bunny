/**
 * Self-contained leaderboard panel: board tabs (Full run, then one Area board per Area), a
 * character filter, the top-20 table (this Run's entry highlighted) and an online/local indicator.
 * Online names carry a ✓ (verified: posted while signed in) or an "anon" tag.
 *
 * In results mode (`submit: true`) it also shows this Run's entries (see ./posting.ts): signed-in
 * players' entries post automatically and the tabs show their ranks; anonymous players get one
 * name field that submits all of the Run's entries, and inline sign-in buttons (signing in posts
 * the waiting entries verified).
 *
 *   const board = createLeaderboardPanel({ submit: true });
 *   parent.append(board.el);
 *   board.showRun(runEndedPayload);   // results screen: this Run's entries, Full run board first
 *   board.refresh();                  // leaderboard screen: just reload the table
 */
import type { GameEvents } from '../../core/events';
import { CHARACTERS, getCharacter } from '../../data/characters';
import { getDifficulty, isDifficultyId } from '../../data/difficulty';
import { getTier } from '../../data/tiers';
import { account as defaultAccount, type AccountClient } from '../../net/account';
import { leaderboard as defaultClient, type LeaderboardClient } from '../../net/leaderboard';
import { DIFFICULTY_SCORE_MULTIPLIER } from '../../shared/difficulty';
import { BOARD_IDS, cleanName, NAME_MAX_LENGTH, type AnyLeaderboardEntry, type AreaLeaderboardEntry, type BoardId, type LeaderboardEntry } from '../../shared/leaderboard';
import { anonymousMark, providerButtons, verifiedMark } from '../account/widgets';
import { h } from '../screens';
import { boardName, getLeaderboardPosting, RunPosts, type BoardPost, type LeaderboardPosting } from './posting';
import './leaderboard.css';

export interface LeaderboardPanelOptions {
  /** Results mode: this Run's entries, the name form and posting status. */
  submit?: boolean;
  client?: LeaderboardClient;
  account?: AccountClient;
  /** Defaults to the installed tracker (`getLeaderboardPosting()`). */
  posting?: LeaderboardPosting | null;
}

export interface LeaderboardPanel {
  el: HTMLElement;
  /** Shows a finished Run's entries and reloads the table (Full run board). */
  showRun(e: GameEvents['runEnded']): void;
  refresh(): Promise<void>;
  /** Focus the name input if the form is showing; returns whether it did. */
  focusName(): boolean;
}

const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Small badge after the Bunny name for non-casual entries (casual and unknown show none). */
function difficultyBadge(difficulty: unknown): HTMLElement | null {
  if (!isDifficultyId(difficulty) || difficulty === 'casual') return null;
  const label = getDifficulty(difficulty).name;
  return h('span', {
    className: `lb-diff lb-diff-${difficulty}`,
    textContent: label,
    title: `${label} difficulty (score ×${DIFFICULTY_SCORE_MULTIPLIER[difficulty]})`,
  });
}

const COLUMNS: Record<'run' | 'area', string[]> = {
  run: ['#', 'Name', 'Bunny', 'Score', 'Tier', 'Time'],
  area: ['#', 'Name', 'Bunny', 'Score', 'Size', 'Time'],
};

/** One line about this Run's entry on a board. */
function postLine(p: BoardPost | undefined, board: BoardId): { text: string; error?: boolean } {
  if (!p) return { text: board === 'run' ? '' : `This run didn't clear the ${boardName(board)}.` };
  if (p.state === 'unsent') return { text: 'Not submitted yet.' };
  if (p.state === 'posting') return { text: 'Submitting…' };
  if (p.state === 'invalid') return { text: `Not eligible: ${p.error ?? 'rejected by the server.'}` };
  if (p.state === 'failed') return { text: p.error ?? 'Could not submit the score.', error: true };
  const r = p.result!;
  const where = r.online ? '' : ' on this device';
  // What the server stored, not what the "Posting as" line expected (a failed session lookup posts anonymously).
  const how = r.online ? (r.entry.verified ? ' · ✓ verified' : ' · anonymous') : '';
  return { text: `${r.rank ? `Rank #${r.rank}${where}` : `Saved${where}`} · ${r.entry.score.toLocaleString()} pts${how}${r.nameCensored ? ' (name replaced)' : ''}` };
}

export function createLeaderboardPanel(opts: LeaderboardPanelOptions = {}): LeaderboardPanel {
  const client = opts.client ?? defaultClient;
  const account = opts.account ?? defaultAccount;
  const posting = opts.posting === undefined ? getLeaderboardPosting() : opts.posting;
  let posts: RunPosts | null = null;
  let unsubscribe: (() => void) | null = null;
  let board: BoardId = 'run';
  let filter = '';
  let loadToken = 0;

  const status = h('span', { className: 'lb-status', textContent: '…' });
  const head = h('div', { className: 'lb-head' }, h('h3', { textContent: 'Leaderboards' }), status);

  // Name entry. Key events stop here so the game's window-level handlers (movement keys
  // that preventDefault Space, results-screen Enter, debug keys) don't see typing.
  const input = h('input', { className: 'lb-name', type: 'text', maxLength: NAME_MAX_LENGTH, placeholder: 'Your name', spellcheck: false });
  input.setAttribute('aria-label', 'Name for the leaderboard');
  input.setAttribute('autocomplete', 'nickname');
  input.addEventListener('keydown', (e) => e.stopPropagation());
  const submitBtn = h('button', { className: 'btn primary lb-submit', type: 'submit', textContent: 'Submit' });
  const form = h('form', { className: 'lb-form' }, input, submitBtn);
  form.hidden = true;
  const msg = h('p', { className: 'lb-msg' });
  msg.setAttribute('role', 'status');

  // "Posting as …": automatic and verified when signed in, otherwise anonymous with sign-in buttons.
  const postingAs = h('p', { className: 'lb-as' });
  const signInButtons = providerButtons(account, { size: 'compact' });

  // Board tabs: Full run, then each Area. In results mode each shows this Run's rank.
  const boards = h('div', { className: 'lb-boards' });
  boards.setAttribute('role', 'tablist');
  boards.setAttribute('aria-label', 'Leaderboard');
  const boardTabs = BOARD_IDS.map((id) => {
    const chip = h('span', { className: 'lb-chip' });
    const b = h('button', { className: 'lb-board', type: 'button' }, h('span', { textContent: boardName(id) }), chip);
    b.setAttribute('role', 'tab');
    b.onclick = () => {
      if (board === id) return;
      board = id;
      renderPosts();
      void refresh();
    };
    return { id, b, chip };
  });
  boards.append(...boardTabs.map((t) => t.b));

  const tabs = h('div', { className: 'lb-tabs' });
  tabs.setAttribute('aria-label', 'Filter by Bunny');
  const tabDefs: Array<[string, string]> = [['', 'All'], ...CHARACTERS.map((c): [string, string] => [c.id, c.name])];
  const tabButtons = tabDefs.map(([id, label]) => {
    const b = h('button', { className: 'lb-tab', type: 'button', textContent: label });
    b.onclick = () => {
      filter = id;
      void refresh();
    };
    return { id, b };
  });
  tabs.append(...tabButtons.map((t) => t.b));

  const headRow = h('tr');
  const tbody = h('tbody');
  const table = h('table', { className: 'lb-table' }, h('thead', {}, headRow), tbody);
  const empty = h('p', { className: 'lb-empty' });
  const wrap = h('div', { className: 'lb-table-wrap' }, table, empty);

  const el = h('section', { className: 'leaderboard' }, head, postingAs, form, boards, msg, tabs, wrap);
  if (!opts.submit) {
    form.remove();
    postingAs.remove();
    msg.remove();
  }

  function setStatus(online: boolean | null): void {
    status.className = `lb-status ${online === null ? '' : online ? 'online' : 'offline'}`;
    status.textContent = online === null ? '…' : online ? 'Online' : 'Local only';
    status.title = online === false ? 'Leaderboard server unavailable: scores are saved on this device.' : '';
  }

  /** Form, message and tab chips from this Run's entries. */
  function renderPosts(): void {
    if (!opts.submit) return;
    const list = posts?.list() ?? [];
    const busy = list.some((p) => p.state === 'posting');
    const waiting = list.filter((p) => p.state === 'unsent' || p.state === 'failed');
    const auto = posting?.auto ?? false;
    // Signed in, entries post by themselves; the form only comes back to retry a failure.
    form.hidden = waiting.length === 0 || (auto && !waiting.some((p) => p.state === 'failed'));
    input.disabled = submitBtn.disabled = busy;
    submitBtn.textContent = waiting.some((p) => p.state === 'failed') && !waiting.some((p) => p.state === 'unsent')
      ? 'Retry'
      : waiting.length > 1 ? `Submit ${waiting.length} scores` : 'Submit score';
    const line = postLine(posts?.get(board), board);
    msg.className = `lb-msg${line.error ? ' error' : ''}`;
    msg.textContent = line.text;
    for (const t of boardTabs) {
      const p = posts?.get(t.id);
      const rank = p?.state === 'posted' ? p.result?.rank : null;
      t.chip.textContent = rank ? `#${rank}` : p ? '•' : '';
      t.chip.title = p ? `This run: ${postLine(p, t.id).text}` : '';
      t.b.classList.toggle('has-entry', Boolean(p));
    }
  }

  /** Local-only boards have no accounts, so their names get no mark. */
  let marks = false;

  function row(e: AnyLeaderboardEntry, rank: number | string, mine: boolean): HTMLTableRowElement {
    const badge = difficultyBadge(e.difficulty);
    const mark = marks ? [e.verified ? verifiedMark() : anonymousMark()] : [];
    const area = 'area' in e;
    const run = e as LeaderboardEntry;
    return h(
      'tr',
      { className: mine ? 'lb-mine' : '' },
      h('td', { textContent: String(rank) }),
      h('td', { className: 'lb-n' }, h('span', { className: 'lb-name-text', textContent: e.name }), ...mark),
      h('td', { className: 'lb-bunny' }, getCharacter(e.character).name, ...(badge ? [badge] : [])),
      h('td', { className: 'lb-score', textContent: e.score.toLocaleString() }),
      area
        ? h('td', { textContent: `${Math.round(e.maxRadius)} cm`, title: `Grew from ${(e as AreaLeaderboardEntry).radiusIn.toFixed(1)} cm` })
        : h('td', { textContent: run.victory ? '★' : String(run.tierReached), title: getTier(run.tierReached).name }),
      h('td', { textContent: fmtTime(e.durationMs), title: area ? 'Time in the area' : 'Run time' }),
    );
  }

  function render(entries: AnyLeaderboardEntry[]): void {
    const cols = COLUMNS[board === 'run' ? 'run' : 'area'];
    headRow.replaceChildren(...cols.map((t) => h('th', { textContent: t })));
    const mine = posts?.get(board);
    const mineEntry = mine?.state === 'posted' ? mine.result!.entry : null;
    const rows = entries.map((e, i) => row(e, i + 1, e.id === mineEntry?.id));
    const mineShown = entries.some((e) => e.id === mineEntry?.id);
    if (mineEntry && !mineShown && (!filter || mineEntry.character === filter)) {
      const gap = h('tr', { className: 'lb-gap' }, h('td', { colSpan: cols.length, textContent: '⋯' }));
      rows.push(gap, row(mineEntry, filter ? '–' : (mine!.result!.rank ?? '–'), true));
    }
    tbody.replaceChildren(...rows);
    empty.textContent = board === 'run' ? 'No scores yet. Be the first!' : `Nobody has cleared the ${boardName(board)} yet. Be the first!`;
    empty.hidden = rows.length > 0;
    table.hidden = rows.length === 0;
    for (const t of boardTabs) t.b.setAttribute('aria-selected', String(t.id === board));
    for (const t of tabButtons) t.b.setAttribute('aria-pressed', String(t.id === filter));
    el.querySelector('.lb-mine')?.scrollIntoView?.({ block: 'nearest' });
  }

  async function refresh(): Promise<void> {
    const token = ++loadToken;
    const character = filter || undefined;
    try {
      const { entries, online } = board === 'run'
        ? await client.getTop({ character })
        : await client.getAreaTop({ area: board, character });
      if (token !== loadToken) return;
      setStatus(online);
      marks = online;
      render(entries);
    } catch (err) {
      if (token !== loadToken) return;
      setStatus(client.isOnline());
      if (opts.submit) msg.textContent = err instanceof Error ? err.message : 'Could not load the leaderboard.';
    }
  }

  // Reload the table when an entry on the board being viewed lands, so it shows highlighted.
  let shownPosted = '';
  function onPostsChanged(): void {
    renderPosts();
    const p = posts?.get(board);
    const key = p?.state === 'posted' ? `${board}:${p.result?.entry.id}` : '';
    if (key && key !== shownPosted) {
      shownPosted = key;
      void refresh();
    }
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!posts) return;
    const name = input.value;
    if (!cleanName(name).name) {
      msg.className = 'lb-msg error';
      msg.textContent = 'Name must contain 1–16 letters or digits.';
      return;
    }
    client.setPlayerName(name);
    await posts.post(name, undefined, { local: !(posting?.auto ?? false) });
    const run = posts.get('run');
    if (run?.state === 'posted') input.value = run.result!.entry.name;
  });

  // Subscribed last: it runs at once and renders into everything above.
  let postingKey = '';
  account.subscribe((s) => {
    postingAs.hidden = s.status === 'unknown' || s.status === 'unavailable';
    // Rebuild only when who is posting changes, so focus on the sign-in buttons survives.
    const key = `${s.status}|${s.user?.id}|${s.user?.name}`;
    if (key === postingKey) return;
    postingKey = key;
    if (s.status === 'signedIn') {
      postingAs.replaceChildren(h('span', {}, 'Scores post automatically as ', h('strong', { textContent: '✓ verified' }), ` (${s.user?.name || 'signed in'})`));
      // First visit after signing in: suggest the account's name.
      if (!input.value && !input.disabled) input.value = cleanName(s.user?.name ?? '').name;
    } else {
      postingAs.replaceChildren(h('span', { textContent: 'Posting as anonymous. Sign in for a ✓ and automatic posting:' }), signInButtons);
    }
    renderPosts();
  });

  return {
    el,
    showRun(e) {
      unsubscribe?.();
      posts = posting ? posting.forResult(e) : (() => {
        const p = new RunPosts(client, e.stats.characterId, e.stats.difficulty, true, e.stats.loadout ?? []);
        p.finish(e);
        return p;
      })();
      unsubscribe = posts.subscribe(onPostsChanged);
      shownPosted = '';
      board = 'run';
      filter = '';
      input.value = client.getPlayerName() || (account.state.status === 'signedIn' ? cleanName(account.state.user?.name ?? '').name : '');
      renderPosts();
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
