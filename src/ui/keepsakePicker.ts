/**
 * The Keepsake picker: a dialog over Character select that fills one Loadout slot from the
 * Character's Hoard. A Type list (chips on phones) and five rarity toggles narrow the list; Sort
 * shows it best rarity first or by type. Each row shows its copies and whether another slot holds
 * them (a row whose every copy is in another slot is disabled). With no Keepsakes it explains where
 * they come from instead.
 * Layouts: a centred dialog; on phones in portrait a bottom sheet; in phone landscape a full-screen
 * sheet with the filters down the left. The data comes from keepsakePickerModel.ts.
 * Keys: ↑/↓ move between rows, Enter tucks one in, 1–5 pick a type (0 for all), T switches the
 * sort, Esc cancels.
 */
import { BOSS_DROP_TABLES, describeKeepsake, getKeepsakeType, getRarity, keepsakeLabel, keepsakeTypesFor, MAX_RARITY, type KeepsakeRef, type KeepsakeTypeId } from '../data/keepsakes';
import type { CharacterDef } from '../data/characters';
import { COMPACT_QUERY, handleMenuKeys, isCompact, segmented } from './components';
import { rarityPip } from './keepsakeUi';
import { pickerModel, rarityList, type PickerFilter, type PickerGroup, type PickerModel, type PickerRow, type PickerSort } from './keepsakePickerModel';
import { h } from './screens';
import './keepsakePicker.css';

/** Phone landscape (as Character select uses it): the filters move down the left. */
const LANDSCAPE_QUERY = '(max-height: 560px) and (min-width: 600px)';
type Layout = 'wide' | 'portrait' | 'landscape';
const layout = (): Layout => (!isCompact() ? 'wide' : matchMedia(LANDSCAPE_QUERY).matches ? 'landscape' : 'portrait');

const CLOSE_ICON = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>';

export interface KeepsakePickerOptions {
  /** Where the overlay goes (the screen wrapper, so it covers the whole screen). */
  host: HTMLElement;
  /** Made inert while the picker is open. */
  behind: HTMLElement;
  character: CharacterDef;
  /** The Character's fur ball, for the "no Keepsakes yet" state. */
  art: HTMLElement;
  /** Every Loadout slot (null for an empty one) and the one being filled. */
  slots: ReadonlyArray<KeepsakeRef | null>;
  slot: number;
  entries: ReadonlyArray<KeepsakeRef & { count: number }>;
  feltCeiling: number;
  bossesBeaten: readonly string[];
  /** A Keepsake, or null to take this slot's Keepsake out (a later slot's moves up). The picker has closed already. */
  onPick(ref: KeepsakeRef | null): void;
  /** Cancelled (Esc, ✕, Cancel). The picker has closed already. */
  onCancel(): void;
}

export interface KeepsakePicker {
  readonly isOpen: boolean;
  open(opts: KeepsakePickerOptions): void;
  close(): void;
  onKey(e: KeyboardEvent): boolean;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const typeName = (t: KeepsakeTypeId | null, long: boolean): string => (t ? (getKeepsakeType(t)?.name ?? t) : long ? 'All Keepsakes' : 'All');

/** Data key for a focusable, so focus survives a re-render. */
function keyed<T extends HTMLElement>(el: T, k: string): T {
  el.dataset.k = k;
  return el;
}

export function createKeepsakePicker(): KeepsakePicker {
  const overlay = h('div', { className: 'ks-pk' });
  const dlg = h('section', { className: 'ks-pk-dlg' });
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  dlg.setAttribute('aria-labelledby', 'ks-pk-title');
  overlay.append(dlg);
  // Clicking the dimmed backdrop cancels.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cancel();
  });

  let opts: KeepsakePickerOptions | null = null;
  let filter: PickerFilter = { type: null, rarities: [] };
  /** Kept between opens. */
  let sort: PickerSort = 'best';
  let list: HTMLElement | null = null;
  const media = typeof matchMedia === 'function' ? [matchMedia(COMPACT_QUERY), matchMedia(LANDSCAPE_QUERY)] : [];
  const onMedia = () => render();

  const close = () => {
    if (!opts) return;
    opts.behind.inert = false;
    overlay.remove();
    for (const m of media) m.removeEventListener('change', onMedia);
    opts = null;
    list = null;
  };
  const cancel = () => {
    const o = opts;
    close();
    o?.onCancel();
  };
  const pick = (ref: KeepsakeRef | null) => {
    const o = opts;
    close();
    o?.onPick(ref);
  };

  const setType = (t: KeepsakeTypeId | null) => {
    filter = { ...filter, type: t };
    render();
  };
  const toggleRarity = (r: number) => {
    filter = { ...filter, rarities: filter.rarities.includes(r) ? filter.rarities.filter((x) => x !== r) : [...filter.rarities, r] };
    render();
  };
  const setSort = (s: PickerSort) => {
    sort = s;
    render();
  };

  // --- Pieces ---

  const closeButton = () => {
    const x = keyed(h('button', { className: 'ks-pk-x', type: 'button' }), 'x');
    x.innerHTML = CLOSE_ICON;
    x.setAttribute('aria-label', 'Cancel');
    x.onclick = cancel;
    return x;
  };

  /** Title and the slots line ("Slot 1 holds Arc · Mythic · Slot 2 holds …"). */
  const titles = (o: KeepsakePickerOptions, mode: Layout) => {
    const label = (k: KeepsakeRef | null | undefined) => (k ? keepsakeLabel(k) : null);
    const sub = h('p', { className: 'ks-pk-sub' });
    if (mode === 'wide') {
      o.slots.forEach((k, i) => {
        if (i > 0) sub.append(' · ');
        const l = label(k);
        sub.append(...(l ? [`Slot ${i + 1} holds `, h('b', { textContent: l })] : [`Slot ${i + 1} is empty`]));
      });
    } else {
      sub.append(`Slot ${o.slot + 1} · `, h('b', { textContent: label(o.slots[o.slot]) ?? 'empty' }));
      o.slots.forEach((k, i) => {
        if (i === o.slot) return;
        const l = label(k);
        sub.append(l ? ` · slot ${i + 1} holds ${l}` : ` · slot ${i + 1} empty`);
      });
    }
    return h('div', { className: 'ks-pk-titles' }, h('h2', { className: 'ks-pk-title', id: 'ks-pk-title', textContent: `Tuck into ${o.character.name}'s fur` }), sub);
  };

  const emptyButton = (o: KeepsakePickerOptions, mode: Layout): HTMLElement[] => {
    if (!o.slots[o.slot]) return [];
    // The Loadout is saved without gaps: with a later slot filled, its Keepsake moves up into this one.
    const next = o.slots.findIndex((k, i) => i > o.slot && k);
    const text = next >= 0 ? 'Take it out' : mode === 'landscape' ? 'Empty slot' : 'Empty the slot';
    const b = keyed(h('button', { className: 'btn btn-ghost ks-pk-empty', type: 'button', textContent: text }), 'empty');
    if (next >= 0) b.title = `Slot ${next + 1}'s Keepsake moves up into slot ${o.slot + 1}`;
    b.onclick = () => pick(null);
    return [b];
  };

  const cancelButton = (text = 'Cancel') => {
    const b = keyed(h('button', { className: 'btn ks-pk-cancel', type: 'button', textContent: text }), 'cancel');
    b.onclick = cancel;
    return b;
  };

  /** "All Keepsakes" and one button per type: a list (wide, landscape) or chips (portrait). */
  const typeButtons = (m: PickerModel, mode: Layout) =>
    m.types.map((t) => {
      const icon = t.type ? (getKeepsakeType(t.type)?.icon ?? '') : '';
      const on = filter.type === t.type;
      const b = keyed(h('button', { className: mode === 'portrait' ? 'ks-pk-chip' : 'ks-pk-type', type: 'button' }), `type:${t.type ?? 'all'}`);
      b.setAttribute('aria-pressed', String(on));
      b.disabled = t.type !== null && t.count === 0;
      b.append(h('span', { className: 'ks-pk-type-icon', textContent: icon }), h('span', { className: 'ks-pk-type-name', textContent: typeName(t.type, mode === 'wide') }));
      const count = h('span', { className: 'ks-pk-n', textContent: String(t.count) });
      if (mode === 'wide') b.append(h('span', { className: 'ks-pk-type-end' }, ...(t.best ? [rarityPip(t.best, { small: true })] : []), count));
      else b.append(count);
      b.onclick = () => setType(on && t.type !== null ? null : t.type);
      return b;
    });

  const rarityToggles = () => {
    const group = h('div', { className: 'ks-pk-togs' });
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Rarity');
    for (let r = 1; r <= MAX_RARITY; r++) {
      const g = getRarity(r);
      const b = keyed(h('button', { className: 'ks-pk-tog', type: 'button', textContent: g.name[0]!, title: g.name }), `rar:${r}`);
      b.style.setProperty('--rarity', g.color);
      b.setAttribute('aria-label', g.name);
      b.setAttribute('aria-pressed', String(filter.rarities.includes(r)));
      b.onclick = () => toggleRarity(r);
      group.append(b);
    }
    return group;
  };

  /** "14 kinds · 24 Keepsakes", or "2 of 14 kinds · 5 Keepsakes" and Clear filters. */
  const countLine = (m: PickerModel, mode: Layout) => {
    const kinds = m.filtered ? `${m.shownKinds} of ${plural(m.kinds, 'kind')}` : plural(m.kinds, 'kind');
    const owned = mode === 'landscape' ? ` · ${m.shownOwned}` : ` · ${plural(m.shownOwned, 'Keepsake')}`;
    const line = h('div', { className: 'ks-pk-countline' }, h('p', { className: 'ks-pk-count' }, h('b', { textContent: kinds }), owned));
    if (m.filtered && mode !== 'landscape') {
      const clear = keyed(h('button', { className: 'ks-pk-clear', type: 'button', textContent: 'Clear filters' }), 'clear');
      clear.onclick = () => {
        filter = { type: null, rarities: [] };
        render();
      };
      line.append(clear);
    }
    return line;
  };

  const sortControl = () => {
    const s = segmented<PickerSort>({
      label: 'Sort',
      value: sort,
      options: [
        { value: 'best', label: 'Best first' },
        { value: 'type', label: 'By type' },
      ],
      onChange: setSort,
    });
    s.el.classList.add('ks-pk-sort');
    s.el.querySelectorAll<HTMLElement>('.segment').forEach((b) => keyed(b, `sort:${b.dataset.value}`));
    return s.el;
  };

  const row = (r: PickerRow, byType: boolean) => {
    const t = getKeepsakeType(r.type);
    const g = getRarity(r.rarity);
    const desc = describeKeepsake(r);
    const b = keyed(h('button', { className: `ks-pk-row${byType ? ' by-type' : ''}${r.selected ? ' sel' : ''}`, type: 'button' }), `row:${r.type}:${r.rarity}`);
    b.style.setProperty('--rarity', g.color);
    b.disabled = r.disabled;
    b.setAttribute('aria-pressed', String(r.selected));
    b.setAttribute('aria-label', `${keepsakeLabel(r)}, ${r.count} owned${r.tag ? `, ${r.tag.toLowerCase()}` : ''}. ${desc}`);
    const badge = h('span', { className: 'ks-pk-badge', textContent: g.name });
    const meta = h('span', { className: 'ks-pk-meta' }, h('span', { className: 'ks-pk-cnt', textContent: `×${r.count}` }), h('span', { className: 'ks-pk-tag', textContent: r.tag }));
    if (byType) b.append(badge, h('span', { className: 'ks-pk-ds', textContent: desc }), meta);
    else
      b.append(
        h('span', { className: 'ks-pk-ic', textContent: t?.icon ?? '?' }),
        h('span', { className: 'ks-pk-txt' }, h('span', { className: 'ks-pk-nm' }, h('span', { textContent: t?.name ?? r.type }), badge), h('span', { className: 'ks-pk-ds', textContent: desc })),
        meta,
      );
    b.onclick = () => pick({ type: r.type, rarity: r.rarity });
    return b;
  };

  const groupHead = (g: PickerGroup) => {
    const head = h('div', { className: 'ks-pk-grp' });
    if (g.rarity) head.append(rarityPip(g.rarity), h('span', { className: 'ks-pk-gn', textContent: getRarity(g.rarity).name }));
    else if (g.type) {
      const t = getKeepsakeType(g.type);
      head.classList.add('by-type');
      head.append(h('span', { className: 'ks-pk-gi', textContent: t?.icon ?? '' }), h('span', { className: 'ks-pk-gn', textContent: t?.name ?? g.type }));
    }
    head.append(h('span', { className: 'ks-pk-gc', textContent: g.countLabel }));
    return head;
  };

  const rowList = (m: PickerModel) => {
    const el = h('div', { className: 'ks-pk-list' });
    el.setAttribute('aria-label', 'Keepsakes');
    for (const g of m.groups) el.append(h('div', { className: 'ks-pk-group' }, groupHead(g), ...g.rows.map((r) => row(r, sort === 'type'))));
    const notes = [m.groups.length ? null : 'No Keepsakes match these filters.', m.hiddenNote, m.feltTip].filter((s): s is string => !!s);
    if (notes.length) el.append(h('p', { className: 'hint ks-pk-note', textContent: notes.join(' ') }));
    el.addEventListener('scroll', () => updateFade(el), { passive: true });
    list = el;
    return el;
  };

  /** Fades the list's bottom edge while there is more below. */
  const updateFade = (el: HTMLElement) => el.classList.toggle('fade', el.scrollTop + el.clientHeight < el.scrollHeight - 2);

  const rarityLabel = (mode: Layout) => {
    const n = filter.rarities.length;
    if (mode === 'wide') return h('p', { className: 'hint ks-pk-hint', textContent: n ? rarityList(filter.rarities) : 'Any rarity · tap to narrow' });
    return h('span', { className: 'ks-pk-lbl', textContent: n === 0 ? 'Any rarity' : n <= 2 ? rarityList(filter.rarities) : `${n} rarities` });
  };

  const label = (text: string) => h('span', { className: 'ks-pk-lbl', textContent: text });

  /** No Keepsakes yet: where they come from, and a ghost of the slot. */
  const none = (o: KeepsakePickerOptions) => {
    const c = o.character;
    const first = keepsakeTypesFor(c.id)[0];
    const how = o.bossesBeaten.length === 0 && BOSS_DROP_TABLES[0] ? `Absorb the ${BOSS_DROP_TABLES[0].bossName} as ${c.name} to tuck in your first.` : `Absorb another boss as ${c.name} to find more.`;
    return h(
      'div',
      { className: 'ks-pk-none' },
      o.art,
      h(
        'div',
        { className: 'ks-pk-none-text' },
        h('h3', { textContent: `${c.name} has no Keepsakes yet.` }),
        h('p', { textContent: `Bosses leave them tangled in the fur of the Bunny that absorbs them. ${how}` }),
      ),
      ...(first ? [h('div', { className: 'ks-pk-ghost' }, h('span', { className: 'ks-pk-ghost-icon', textContent: first.icon }), h('span', { textContent: `${keepsakeLabel({ type: first.id, rarity: 1 })} would go here` }))] : []),
    );
  };

  // --- Layouts ---

  const build = (o: KeepsakePickerOptions, m: PickerModel, mode: Layout): HTMLElement[] => {
    const grab = h('div', { className: 'ks-pk-grab' });
    grab.setAttribute('aria-hidden', 'true');
    if (o.entries.length === 0) {
      return [
        ...(mode === 'portrait' ? [grab] : []),
        h('div', { className: 'ks-pk-head' }, titles(o, mode), closeButton()),
        none(o),
        h('div', { className: 'ks-pk-foot' }, ...emptyButton(o, mode), cancelButton(`Back to ${o.character.name}`)),
      ];
    }
    if (mode === 'wide') {
      const keys = `↑/↓ move · Enter tuck in · 1–${m.types.length - 1} type · T sort · Esc cancel`;
      return [
        h('div', { className: 'ks-pk-head' }, titles(o, mode), ...emptyButton(o, mode), closeButton()),
        h(
          'div',
          { className: 'ks-pk-body' },
          h(
            'div',
            { className: 'ks-pk-side' },
            h('div', { className: 'ks-pk-types' }, label('Type'), ...typeButtons(m, mode)),
            h('div', { className: 'ks-pk-rarity' }, label('Rarity'), rarityToggles(), rarityLabel(mode)),
          ),
          h('div', { className: 'ks-pk-main' }, h('div', { className: 'ks-pk-bar' }, countLine(m, mode), sortControl()), rowList(m)),
        ),
        h('div', { className: 'ks-pk-foot' }, h('p', { className: 'hint ks-pk-keys', textContent: keys }), cancelButton()),
      ];
    }
    if (mode === 'landscape') {
      return [
        h('div', { className: 'ks-pk-head' }, titles(o, mode), countLine(m, mode), sortControl(), closeButton()),
        h(
          'div',
          { className: 'ks-pk-body' },
          h('div', { className: 'ks-pk-side' }, h('div', { className: 'ks-pk-types' }, ...typeButtons(m, mode)), rarityToggles(), h('div', { className: 'ks-pk-foot' }, ...emptyButton(o, mode), cancelButton())),
          rowList(m),
        ),
      ];
    }
    return [
      grab,
      h('div', { className: 'ks-pk-head' }, titles(o, mode), closeButton()),
      h('div', { className: 'ks-pk-chips' }, ...typeButtons(m, mode)),
      h('div', { className: 'ks-pk-rarity' }, rarityToggles(), rarityLabel(mode)),
      h('div', { className: 'ks-pk-bar' }, countLine(m, mode), sortControl()),
      rowList(m),
      h('div', { className: 'ks-pk-foot' }, ...emptyButton(o, mode), cancelButton()),
    ];
  };

  function render(focusKey?: string): void {
    const o = opts;
    if (!o) return;
    const active = document.activeElement instanceof HTMLElement && dlg.contains(document.activeElement) ? document.activeElement : null;
    const want = focusKey ?? active?.dataset.k;
    const listScroll = list?.scrollTop ?? 0;
    const m = pickerModel({ characterId: o.character.id, entries: o.entries, slots: o.slots, slot: o.slot, filter, sort, feltCeiling: o.feltCeiling });
    const mode = layout();
    overlay.className = `ks-pk ks-pk-${mode}`;
    dlg.replaceChildren(...build(o, m, mode));
    const l = list;
    if (l) {
      l.scrollTop = listScroll;
      requestAnimationFrame(() => updateFade(l));
    }
    const target =
      (want ? dlg.querySelector<HTMLElement>(`[data-k="${CSS.escape(want)}"]:not(:disabled)`) : null) ??
      dlg.querySelector<HTMLElement>('.ks-pk-row.sel') ??
      dlg.querySelector<HTMLElement>('.ks-pk-row:not(:disabled)') ??
      dlg.querySelector<HTMLElement>('.ks-pk-cancel');
    // A filter or sort control keeps focus without jumping the list; a row scrolls into view.
    target?.focus({ preventScroll: !!want && !want.startsWith('row:') });
  }

  /** ↑/↓: the next enabled row (from outside the list, the selected or first one). */
  const moveRow = (dir: number) => {
    const rows = [...dlg.querySelectorAll<HTMLElement>('.ks-pk-row:not(:disabled)')];
    if (!rows.length) return;
    const i = rows.indexOf(document.activeElement as HTMLElement);
    const next = i < 0 ? (dlg.querySelector<HTMLElement>('.ks-pk-row.sel:not(:disabled)') ?? rows[0]!) : rows[(i + dir + rows.length) % rows.length]!;
    next.focus();
  };

  return {
    get isOpen() {
      return opts !== null;
    },
    open(o) {
      close();
      opts = o;
      filter = { type: null, rarities: [] };
      o.host.append(overlay);
      o.behind.inert = true;
      for (const m of media) m.addEventListener('change', onMedia);
      render('');
    },
    close,
    onKey(e) {
      if (!opts) return false;
      if (e.code === 'Escape') {
        cancel();
        return true;
      }
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        moveRow(e.code === 'ArrowUp' ? -1 : 1);
        return true;
      }
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') return handleMenuKeys(e, dlg);
      if (e.repeat || opts.entries.length === 0) return false;
      const digit = /^Digit(\d)$/.exec(e.code);
      if (digit) {
        const types = keepsakeTypesFor(opts.character.id);
        const n = Number(digit[1]);
        if (n === 0) setType(null);
        else if (n <= types.length) {
          const t = types[n - 1]!.id;
          if (opts.entries.some((x) => x.type === t)) setType(filter.type === t ? null : t);
        }
        return true;
      }
      if (e.code === 'KeyT') {
        setSort(sort === 'best' ? 'type' : 'best');
        return true;
      }
      return false;
    },
  };
}
