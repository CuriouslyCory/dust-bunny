import { describe, expect, it } from 'vitest';
import { decodeVersioned, encodeVersioned, type KeyValueStorage, type VersionedFormat, VersionedStore } from './versionedStore';

const KEY = 'test:thing:v1';

const memStorage = (init: Record<string, string> = {}): KeyValueStorage & { map: Map<string, string>; full: boolean; locked: boolean } => {
  const map = new Map(Object.entries(init));
  const s = {
    map,
    full: false,
    locked: false,
    getItem: (k: string) => {
      if (s.locked) throw new Error('SecurityError');
      return map.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (s.full || s.locked) throw new Error('QuotaExceededError');
      map.set(k, v);
    },
    removeItem: (k: string) => {
      if (s.full || s.locked) throw new Error('QuotaExceededError');
      map.delete(k);
    },
  };
  return s;
};

interface Thing {
  name: string;
  count: number;
}

/** Version 2. v0 was `{ title }`; v1 was `{ name, n }`. */
const format: VersionedFormat<Thing> = {
  key: KEY,
  version: 2,
  empty: () => ({ name: '', count: 0 }),
  parse: (o) => ({ name: typeof o.name === 'string' ? o.name : '', count: typeof o.count === 'number' ? o.count : 0 }),
  migrations: {
    0: (o) => ({ name: o.title, n: 1 }),
    1: (o) => ({ name: o.name, count: o.n }),
  },
};

describe('decodeVersioned', () => {
  it('reads nothing as empty and unreadable values as corrupt', () => {
    expect(decodeVersioned(format, null)).toEqual({ value: format.empty(), found: 'empty', version: null });
    expect(decodeVersioned(format, '')).toMatchObject({ found: 'empty' });
    for (const raw of ['{"name":', '[]', '"str"', '42', 'null']) expect(decodeVersioned(format, raw)).toEqual({ value: format.empty(), found: 'corrupt', version: null });
  });

  it('migrates stored examples of every older version, one step at a time', () => {
    expect(decodeVersioned(format, JSON.stringify({ title: 'old' }))).toEqual({ value: { name: 'old', count: 1 }, found: 'migrated', version: 0 });
    expect(decodeVersioned(format, JSON.stringify({ version: 1, name: 'mid', n: 4 }))).toEqual({ value: { name: 'mid', count: 4 }, found: 'migrated', version: 1 });
    expect(decodeVersioned(format, JSON.stringify({ version: 2, name: 'now', count: 7 }))).toEqual({ value: { name: 'now', count: 7 }, found: 'current', version: 2 });
  });

  it('reads a newer version as far as parse understands it, and tells parse which version it is', () => {
    const seen: number[] = [];
    const f: VersionedFormat<Thing> = { ...format, parse: (o, v) => (seen.push(v), format.parse(o, v)) };
    expect(decodeVersioned(f, JSON.stringify({ version: 3, name: 'future', count: 2, extra: true }))).toEqual({ value: { name: 'future', count: 2 }, found: 'newer', version: 3 });
    expect(seen).toEqual([3]);
  });

  it('stamps the current version on what it encodes', () => {
    expect(JSON.parse(encodeVersioned(format, { name: 'a', count: 1 }))).toEqual({ version: 2, name: 'a', count: 1 });
    const wrapped: VersionedFormat<string[]> = { key: KEY, version: 1, empty: () => [], parse: () => [], serialize: (list) => ({ list }) };
    expect(encodeVersioned(wrapped, ['x'])).toBe('{"version":1,"list":["x"]}');
  });
});

describe('VersionedStore', () => {
  it('writes and reads back', () => {
    const storage = memStorage();
    const store = new VersionedStore(storage, format);
    expect(store.read()).toMatchObject({ value: format.empty(), status: 'ok', found: 'empty', raw: null });
    expect(store.write({ name: 'a', count: 1 })).toBe('ok');
    expect(store.read()).toMatchObject({ value: { name: 'a', count: 1 }, status: 'ok', found: 'current' });
    expect(store.remove()).toBe('ok');
    expect(storage.map.has(KEY)).toBe(false);
  });

  it('a migrated value is written back at the current version', () => {
    const storage = memStorage({ [KEY]: JSON.stringify({ title: 'old' }) });
    const store = new VersionedStore(storage, format);
    const { value, found } = store.read();
    expect(found).toBe('migrated');
    store.write(value);
    expect(JSON.parse(storage.map.get(KEY)!)).toEqual({ version: 2, name: 'old', count: 1 });
  });

  it('never writes over a newer version: storage is left byte for byte, and this page keeps its value in memory', () => {
    const newer = '{ "version": 3, "name": "future", "count": 9, "later": [1, 2] }';
    const storage = memStorage({ [KEY]: newer });
    const store = new VersionedStore(storage, format);
    expect(store.status).toBe('newer');
    expect(store.read()).toMatchObject({ value: { name: 'future', count: 9 }, status: 'newer', found: 'newer', raw: newer });

    expect(store.write({ name: 'mine', count: 1 })).toBe('newer');
    expect(storage.map.get(KEY)).toBe(newer);
    expect(store.read()).toMatchObject({ value: { name: 'mine', count: 1 }, status: 'newer', found: 'memory' });
    expect(store.inMemory).toBe(true);
    expect(store.remove()).toBe('newer');
    expect(storage.map.get(KEY)).toBe(newer);
    expect(store.read()).toMatchObject({ value: format.empty(), found: 'memory' });

    // Given up (or another tab wrote): reads come from storage again.
    store.dropMemory();
    expect(store.read()).toMatchObject({ value: { name: 'future', count: 9 }, found: 'newer' });
    expect(storage.map.get(KEY)).toBe(newer);
  });

  it('checks storage before every write: a newer build that wrote since this page read is not overwritten', () => {
    const storage = memStorage();
    const store = new VersionedStore(storage, format);
    store.write({ name: 'a', count: 1 });
    const newer = JSON.stringify({ version: 5, name: 'other tab' });
    storage.map.set(KEY, newer);
    expect(store.write({ name: 'b', count: 2 })).toBe('newer');
    expect(storage.map.get(KEY)).toBe(newer);
  });

  it('keeps a write storage refuses in memory, and goes back to storage once a write reaches it', () => {
    const storage = memStorage({ [KEY]: JSON.stringify({ version: 2, name: 'stored', count: 1 }) });
    const store = new VersionedStore(storage, format);
    storage.full = true;
    expect(store.write({ name: 'mine', count: 2 })).toBe('unavailable');
    expect(store.read()).toMatchObject({ value: { name: 'mine', count: 2 }, status: 'unavailable', found: 'memory' });
    expect(store.status).toBe('unavailable');
    expect(JSON.parse(storage.map.get(KEY)!).name).toBe('stored');
    storage.full = false;
    expect(store.write({ name: 'mine', count: 3 })).toBe('ok');
    expect(store.inMemory).toBe(false);
    expect(store.read()).toMatchObject({ value: { name: 'mine', count: 3 }, found: 'current' });
  });

  it('serves its memory while storage can’t be read at all', () => {
    const storage = memStorage();
    const store = new VersionedStore(storage, format);
    storage.locked = true;
    expect(store.read()).toMatchObject({ value: format.empty(), status: 'unavailable', raw: undefined });
    expect(store.write({ name: 'mine', count: 1 })).toBe('unavailable');
    expect(store.read()).toMatchObject({ value: { name: 'mine', count: 1 }, status: 'unavailable', found: 'memory' });
    store.dropMemory();
    expect(store.read()).toMatchObject({ value: format.empty(), status: 'unavailable', raw: undefined });
  });

  it('works in memory without storage', () => {
    const store = new VersionedStore<Thing>(null, format);
    expect(store.read()).toMatchObject({ value: format.empty(), status: 'unavailable' });
    expect(store.write({ name: 'a', count: 1 })).toBe('unavailable');
    expect(store.read()).toMatchObject({ value: { name: 'a', count: 1 }, found: 'memory' });
  });

  it('clears with an empty string when storage has no removeItem', () => {
    const map = new Map<string, string>();
    const store = new VersionedStore({ getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) }, format);
    store.write({ name: 'a', count: 1 });
    expect(store.remove()).toBe('ok');
    expect(map.get(KEY)).toBe('');
    expect(store.read().found).toBe('empty');
  });

  it('with memory off, a refused write is only reported', () => {
    const newer = JSON.stringify({ version: 3, name: 'future' });
    const storage = memStorage({ [KEY]: newer });
    const store = new VersionedStore(storage, format, { memory: false });
    expect(store.write({ name: 'mine', count: 1 })).toBe('newer');
    expect(store.read()).toMatchObject({ value: { name: 'future', count: 0 }, found: 'newer' });
    expect(storage.map.get(KEY)).toBe(newer);
  });
});
