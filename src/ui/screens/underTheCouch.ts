/**
 * Under the Couch: the Bunny's hoard. One tab per Character; its Hoard as a grid of Keepsake types
 * (rows) by rarity (columns) with counts. Choosing a cell shows the Keepsake with Felt (3 → 1 of the
 * next rarity, for 3× the inputs' shed value, up to one rarity above the peak of the best boss that Character
 * has beaten) and Shed (discard one for 40 × r² Fluff). Compact (phone) layouts show one list per type with
 * the buttons inline. Reachable from Character select and results (key U).
 *
 * Params: `{ back?: screenId, characterId?: string }` (default back: 'characterSelect').
 * Keys: 1–3 or Q/E switch Character, arrows move in the grid, F felts, X sheds, Esc / U go back.
 */
import { CHARACTERS, DEFAULT_CHARACTER_ID, getCharacter } from '../../data/characters';
import { AREA_BOSSES } from '../../data/hazards';
import { BOSS_DROP_TABLES, FELT_INPUT, getRarity, keepsakeLabel, keepsakeTypesFor, MAX_RARITY, peakRarityForBoss, shedValue, type KeepsakeRef } from '../../data/keepsakes';
import type { Game } from '../../game/game';
import { hoardEntries } from '../../meta/hoard';
import { FIRST_FELT_CAPTION } from '../../meta/keepsakes';
import { getMeta, type FeltCheck } from '../../meta/meta';
import { COMPACT_QUERY, handleMenuKeys, isCompact, scrollArea } from '../components';
import { rarityPip, keepsakeChip, narrate } from '../keepsakeUi';
import { h, registerScreen } from '../screens';
import '../roguelike.css';

export interface UnderTheCouchParams {
  back?: string;
  characterId?: string;
}

/** Why a Felt is blocked, in words (null when it can go ahead). */
export function feltBlockedReason(characterId: string, check: FeltCheck, count: number, fluff: number): string | null {
  if (check.ok) return null;
  const name = getCharacter(characterId).name;
  switch (check.reason) {
    case 'unknown':
      return 'Not one of this Bunny’s Keepsakes.';
    case 'max':
      return `${getRarity(MAX_RARITY).name} is the highest rarity.`;
    case 'count':
      return `Felting takes ${FELT_INPUT} of a kind (you have ${count}).`;
    case 'ceiling': {
      if (check.ceiling === 0) return `Beat a boss with ${name} to start felting.`;
      const top = `${name} can felt up to ${getRarity(check.ceiling).name}`;
      // The first boss whose peak reaches the ceiling raises it.
      const boss = BOSS_DROP_TABLES.find((t) => (peakRarityForBoss(t.bossId) ?? 0) >= check.ceiling);
      if (!boss) return `${top}.`;
      const the = /^The /.test(boss.bossName) ? `the ${boss.bossName.slice(4)}` : `the ${boss.bossName}`;
      const built = Object.values(AREA_BOSSES).some((b) => b.id === boss.bossId);
      return built ? `${top}. Beat ${the} to go higher.` : `${top} until ${the} arrives.`;
    }
    case 'full':
      return `Already holding 99 ${check.result ? keepsakeLabel(check.result) : ''}.`;
    case 'poor':
      return `Needs ${check.cost} Fluff (you have ${fluff}).`;
  }
}

export function registerUnderTheCouchScreen(): void {
  registerScreen({
    id: 'underTheCouch',
    create(game: Game) {
      const meta = getMeta();
      let back = 'characterSelect';
      let charIndex = 0;
      /** Selected cell: type row and rarity. */
      let row = 0;
      let rarity = 1;
      let active = false;
      let compact = isCompact();

      const wallet = h('div', { className: 'rl-wallet' });
      const tabs = h('div', { className: 'utc-tabs' });
      tabs.setAttribute('role', 'tablist');
      const ceilingLine = h('p', { className: 'utc-ceiling' });
      const body = h('div', { className: 'utc-body' });
      const detail = h('div', { className: 'utc-detail' });
      detail.setAttribute('aria-live', 'polite');
      const status = h('p', { className: 'utc-status' });
      status.setAttribute('aria-live', 'polite');
      const done = h('button', { className: 'btn primary', type: 'button', textContent: 'Back' });
      done.onclick = () => game.go(back);

      const character = () => CHARACTERS[charIndex]!;
      const types = () => keepsakeTypesFor(character().id);
      const selected = (): KeepsakeRef => ({ type: types()[row]!.id, rarity });

      /** Rarities shown as columns: all five. */
      const columns = (): number => MAX_RARITY;

      const felt = (ref: KeepsakeRef) => {
        const r = meta.felt(character().id, ref);
        if (!r.ok) return;
        status.textContent = `Felted three into ${keepsakeLabel(r.result)} for ${r.cost} Fluff.`;
        if (r.first) narrate(game, FIRST_FELT_CAPTION);
        rarity = r.result.rarity;
        render();
      };
      const shed = (ref: KeepsakeRef) => {
        const r = meta.shed(character().id, ref);
        if (r.ok) status.textContent = `Shed one ${keepsakeLabel(ref)} for ${r.fluff} Fluff.`;
      };

      /** Felt and Shed buttons for one cell, plus the blocked reason. */
      const actions = (ref: KeepsakeRef, small: boolean) => {
        const id = character().id;
        const count = meta.keepsakeCount(id, ref);
        const check = meta.feltCheck(id, ref);
        const next = ref.rarity < MAX_RARITY ? getRarity(ref.rarity + 1) : null;
        const feltBtn = h('button', {
          className: `btn btn-sm ${check.ok ? 'btn-primary primary' : 'btn-secondary'} utc-felt`,
          type: 'button',
          textContent: next ? `Felt ${FELT_INPUT} → ${next.name} · ${check.cost ?? 0} ☁` : 'Felt',
        });
        feltBtn.disabled = !check.ok;
        feltBtn.onclick = () => felt(ref);
        const shedBtn = h('button', { className: `btn btn-sm btn-secondary utc-shed${small ? ' utc-compact-btn' : ''}`, type: 'button', textContent: `Shed 1 · +${shedValue(ref.rarity)} ☁` });
        if (small) feltBtn.classList.add('utc-compact-btn');
        shedBtn.disabled = count < 1;
        shedBtn.onclick = () => shed(ref);
        const reason = feltBlockedReason(id, check, count, meta.fluff);
        return { feltBtn, shedBtn, reason, count };
      };

      const renderTabs = () => {
        tabs.replaceChildren(
          ...CHARACTERS.map((c, i) => {
            const n = Object.values(meta.hoardOf(c.id).hoard).reduce((a, b) => a + b, 0);
            const b = h('button', { className: 'utc-tab', type: 'button' }, h('span', { className: 'utc-tab-key key-hint', textContent: String(i + 1) }), `${c.name}`, h('span', { className: 'utc-tab-count', textContent: String(n) }));
            b.setAttribute('role', 'tab');
            b.setAttribute('aria-selected', String(i === charIndex));
            b.onclick = () => setCharacter(i);
            return b;
          }),
        );
      };

      const renderGrid = () => {
        const id = character().id;
        const cols = columns();
        if (rarity > cols) rarity = cols;
        const head = h('tr', {}, h('th', { className: 'utc-type-h', textContent: 'Keepsake' }));
        for (let g = 1; g <= cols; g++) {
          const th = h('th', { className: 'utc-rarity-h' }, rarityPip(g), h('span', { className: 'utc-rarity-name', textContent: getRarity(g).name }));
          head.append(th);
        }
        const ceiling = meta.feltCeiling(id);
        const rows = types().map((t, r) => {
          const tr = h('tr', {}, h('th', { className: 'utc-type', scope: 'row' }, h('span', { className: 'utc-type-icon', textContent: t.icon }), t.name));
          for (let g = 1; g <= cols; g++) {
            const ref = { type: t.id, rarity: g };
            const n = meta.keepsakeCount(id, ref);
            const cell = h('button', { className: 'utc-cell', type: 'button', textContent: n ? String(n) : '·' });
            cell.style.setProperty('--rarity', getRarity(g).color);
            cell.classList.toggle('has', n > 0);
            cell.classList.toggle('can-felt', n >= FELT_INPUT && g + 1 <= ceiling);
            const sel = r === row && g === rarity;
            cell.classList.toggle('selected', sel);
            cell.setAttribute('aria-pressed', String(sel));
            cell.setAttribute('aria-label', `${keepsakeLabel(ref)}: ${n}`);
            cell.onclick = () => {
              row = r;
              rarity = g;
              render();
              (body.querySelector('.utc-cell.selected') as HTMLElement | null)?.focus({ preventScroll: true });
            };
            tr.append(h('td', {}, cell));
          }
          return tr;
        });
        body.replaceChildren(h('table', { className: 'utc-grid' }, h('thead', {}, head), h('tbody', {}, ...rows)));

        const ref = selected();
        const a = actions(ref, false);
        detail.hidden = false;
        detail.replaceChildren(
          keepsakeChip(ref, { count: a.count, describe: true }),
          h('div', { className: 'utc-detail-actions' }, a.feltBtn, a.shedBtn),
          ...(a.reason ? [h('p', { className: 'utc-reason', textContent: a.reason })] : []),
        );
      };

      const renderLists = () => {
        const id = character().id;
        detail.hidden = true;
        body.replaceChildren(
          ...types().map((t) => {
            const owned: KeepsakeRef[] = [];
            for (let g = 1; g <= MAX_RARITY; g++) if (meta.keepsakeCount(id, { type: t.id, rarity: g }) > 0) owned.push({ type: t.id, rarity: g });
            return h(
              'section',
              { className: 'utc-list' },
              h('h3', { className: 'utc-list-head' }, h('span', { className: 'utc-type-icon', textContent: t.icon }), t.name),
              ...(owned.length
                ? owned.map((ref) => {
                    const a = actions(ref, true);
                    const item = h('div', { className: 'utc-list-item' }, keepsakeChip(ref, { count: a.count }), h('div', { className: 'utc-detail-actions' }, a.feltBtn, a.shedBtn));
                    if (a.reason && a.count >= FELT_INPUT) item.append(h('p', { className: 'utc-reason', textContent: a.reason }));
                    return item;
                  })
                : [h('p', { className: 'utc-empty', textContent: 'None yet.' })]),
            );
          }),
        );
      };

      const render = () => {
        const c = character();
        wallet.textContent = `☁ ${meta.fluff} Fluff`;
        const ceiling = meta.feltCeiling(c.id);
        ceilingLine.textContent =
          ceiling === 0 ? `${c.name} hasn't beaten a boss yet. Bosses leave Keepsakes in the fur of the Bunny that absorbs them.` : `${c.name} can felt up to ${getRarity(ceiling).name}.`;
        renderTabs();
        if (compact) renderLists();
        else renderGrid();
      };

      /** Starts on the first cell the Hoard holds (or the top-left one). */
      const selectFirstOwned = () => {
        const first = hoardEntries(character().id, meta.hoardOf(character().id))[0];
        row = first ? Math.max(0, types().findIndex((t) => t.id === first.type)) : 0;
        rarity = first?.rarity ?? 1;
      };

      const setCharacter = (i: number) => {
        charIndex = (i + CHARACTERS.length) % CHARACTERS.length;
        selectFirstOwned();
        status.textContent = '';
        render();
      };

      meta.store.onChange(() => {
        if (active) render();
      });
      const mq = typeof matchMedia === 'function' ? matchMedia(COMPACT_QUERY) : null;
      mq?.addEventListener?.('change', () => {
        compact = mq.matches;
        if (active) render();
      });

      const el = h(
        'div',
        { className: 'panel rl-panel utc' },
        h('div', { className: 'shop-head' }, h('h2', { textContent: 'Under the Couch' }), wallet),
        tabs,
        ceilingLine,
        scrollArea('utc-scroll', body),
        detail,
        status,
        h('div', { className: 'rl-row' }, done),
        h('p', { className: 'hint key-hint', textContent: '1–3 Bunny · arrows choose · F felt · X shed · Esc back' }),
      );

      return {
        el,
        enter(params) {
          const p = (params as UnderTheCouchParams | undefined) ?? {};
          back = p.back ?? 'characterSelect';
          done.textContent = back === 'characterSelect' ? 'Continue' : 'Back';
          const want = p.characterId ?? game.nextRunConfig.characterId ?? meta.data.lastCharacterId ?? DEFAULT_CHARACTER_ID;
          charIndex = Math.max(0, CHARACTERS.findIndex((c) => c.id === want));
          compact = isCompact();
          active = true;
          selectFirstOwned();
          status.textContent = '';
          render();
          ((compact ? null : body.querySelector('.utc-cell.selected')) as HTMLElement | null ?? done).focus({ preventScroll: true });
        },
        exit() {
          active = false;
        },
        onKey(e) {
          if (e.repeat && !e.code.startsWith('Arrow')) return false;
          const n = /^Digit([1-9])$/.exec(e.code);
          if (n && Number(n[1]) <= CHARACTERS.length) {
            setCharacter(Number(n[1]) - 1);
            return true;
          }
          switch (e.code) {
            case 'Escape':
            case 'KeyU':
              game.go(back);
              return true;
            case 'KeyQ':
              setCharacter(charIndex - 1);
              return true;
            case 'KeyE':
              setCharacter(charIndex + 1);
              return true;
          }
          if (compact) return handleMenuKeys(e, el);
          const focusCell = () => (body.querySelector('.utc-cell.selected') as HTMLElement | null)?.focus({ preventScroll: true });
          switch (e.code) {
            case 'ArrowLeft':
              rarity = Math.max(1, rarity - 1);
              break;
            case 'ArrowRight':
              rarity = Math.min(columns(), rarity + 1);
              break;
            case 'ArrowUp':
              row = Math.max(0, row - 1);
              break;
            case 'ArrowDown':
              row = Math.min(types().length - 1, row + 1);
              break;
            case 'KeyF':
              felt(selected());
              break;
            case 'KeyX':
              shed(selected());
              break;
            default:
              return false;
          }
          render();
          focusCell();
          return true;
        },
      };
    },
  });
}
