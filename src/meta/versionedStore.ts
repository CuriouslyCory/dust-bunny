/**
 * One versioned value in localStorage, kept by docs/adr/0001's rule (issue #66). The caller supplies
 * the key, its current version, a parse function and the migration steps (`VersionedFormat`); this
 * module does the rest:
 *
 * - Reading: the stored JSON's `version` (missing: 0) is brought up to the current version one
 *   migration step at a time, then parsed. Unreadable JSON, or anything that isn't an object, reads
 *   as `corrupt` (the empty value; the next write replaces it).
 * - A newer version (an old tab still open after a deploy, or a cached build) is read as far as
 *   `parse` understands it, and never written: `write` and `remove` leave it byte for byte as it is
 *   and say `newer`. Every write checks what storage holds first, so a newer build's write from
 *   another tab is never overwritten either.
 * - The in-memory fallback: a write that doesn't reach storage (newer data there, storage missing,
 *   full or refusing) is kept in memory, and reads serve it until a later write reaches storage or
 *   the caller drops it (`dropMemory`, e.g. on another tab's `storage` event). A store that holds
 *   its own copy of the value (SaveStore) opts out with `{ memory: false }`.
 * - Storage errors: never thrown; a store with storage that throws reads as `unavailable`.
 */

/** The subset of Storage the stores use (inject a Map-backed one in tests). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  /** Used by `remove` when present; otherwise the key is set to '' (which reads as empty). */
  removeItem?(key: string): void;
}

/**
 * Whether this page's writes reach storage: `ok` they do; `newer` storage holds a newer build's
 * value (read as far as understood, never written); `unavailable` storage is missing, full or refused.
 */
export type StoreStatus = 'ok' | 'newer' | 'unavailable';

/**
 * Where a read came from: storage holding nothing (`empty`), this version (`current`), an older one
 * brought up to it (`migrated`), a newer build's (`newer`), something unreadable (`corrupt`); or
 * this page's own unsaved value (`memory`).
 */
export type StoredFound = 'empty' | 'current' | 'migrated' | 'newer' | 'corrupt' | 'memory';

/** A migration step: turns a version-`v` object into a version-`v + 1` one. */
export type MigrationStep = (stored: Record<string, unknown>) => Record<string, unknown>;

export interface VersionedFormat<T, W = T> {
  readonly key: string;
  /** This build's version, stamped as `version` on every write. */
  readonly version: number;
  /** What an empty, unreadable or missing value reads as. */
  empty(): T;
  /**
   * Builds the value from a stored object at the current version, or a newer one (`version` says
   * which: read what is understood). Must not throw.
   */
  parse(stored: Record<string, unknown>, version: number): T;
  /** `migrations[v]` lifts version `v` to `v + 1`. A version without a step is passed on as it is (`parse` reads it). */
  readonly migrations?: Readonly<Record<number, MigrationStep>>;
  /** The object to store for a written value (`version` is added). Default: the value itself. */
  serialize?(value: W): object;
}

export interface Decoded<T> {
  value: T;
  found: Exclude<StoredFound, 'memory'>;
  /** The stored version (0: unversioned; null: nothing readable). */
  version: number | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The `version` of a stored object: a finite number, or 0 when it has none. */
export function storedVersion(o: Record<string, unknown>): number {
  return typeof o.version === 'number' && Number.isFinite(o.version) ? o.version : 0;
}

/** Reads a stored string (pure: no storage). Never throws. */
export function decodeVersioned<T, W>(format: VersionedFormat<T, W>, raw: string | null | undefined): Decoded<T> {
  if (raw == null || raw === '') return { value: format.empty(), found: 'empty', version: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { value: format.empty(), found: 'corrupt', version: null };
  }
  if (!isObj(parsed)) return { value: format.empty(), found: 'corrupt', version: null };
  const version = storedVersion(parsed);
  if (version > format.version) return { value: format.parse(parsed, version), found: 'newer', version };
  let o = parsed;
  for (let at = Math.floor(version); at < format.version; at++) {
    const step = format.migrations?.[at];
    if (step) o = { ...step(o), version: at + 1 };
  }
  return { value: format.parse(o, format.version), found: version < format.version ? 'migrated' : 'current', version };
}

/** The string a write stores for `value`. */
export function encodeVersioned<T, W>(format: VersionedFormat<T, W>, value: W): string {
  const body = format.serialize ? format.serialize(value) : (value as unknown as object);
  return JSON.stringify({ version: format.version, ...body });
}

/** Whether a stored string is a newer build's (never to be written over). */
function holdsNewer(format: VersionedFormat<unknown, unknown>, raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isObj(parsed) && storedVersion(parsed) > format.version;
  } catch {
    return false;
  }
}

export interface Reading<T> {
  value: T;
  /** Whether a write would reach storage, as far as this read can tell. */
  status: StoreStatus;
  found: StoredFound;
  /** The string read (this page's own for `memory`; undefined: storage couldn't be read). */
  raw: string | null | undefined;
}

export interface VersionedStoreOptions {
  /** Keep a write that doesn't reach storage in memory and read it back (default true). */
  memory?: boolean;
}

export class VersionedStore<T, W = T> {
  /** This page's value that didn't reach storage, and why (null: reads come from storage). */
  private memory: { raw: string | null; status: Exclude<StoreStatus, 'ok'> } | null = null;
  private readonly keepMemory: boolean;

  constructor(
    private readonly storage: KeyValueStorage | null,
    readonly format: VersionedFormat<T, W>,
    opts: VersionedStoreOptions = {},
  ) {
    this.keepMemory = opts.memory ?? true;
  }

  get key(): string {
    return this.format.key;
  }

  /** The stored string (undefined: no storage, or it threw). */
  private readStorage(): string | null | undefined {
    if (!this.storage) return undefined;
    try {
      return this.storage.getItem(this.format.key);
    } catch {
      return undefined;
    }
  }

  read(): Reading<T> {
    if (this.memory) {
      const { value } = decodeVersioned(this.format, this.memory.raw);
      return { value, status: this.memory.status, found: 'memory', raw: this.memory.raw };
    }
    const raw = this.readStorage();
    const { value, found } = decodeVersioned(this.format, raw);
    return { value, status: raw === undefined ? 'unavailable' : found === 'newer' ? 'newer' : 'ok', found, raw };
  }

  /** Where this page's writes go now (reads storage; a value kept in memory says why it is there). */
  get status(): StoreStatus {
    if (this.memory) return this.memory.status;
    const raw = this.readStorage();
    return raw === undefined ? 'unavailable' : holdsNewer(this.format, raw) ? 'newer' : 'ok';
  }

  /** Stores `value`. Anything but `ok`: storage is untouched and the value lives in memory (unless opted out). */
  write(value: W): StoreStatus {
    return this.put(encodeVersioned(this.format, value));
  }

  /** Clears the value (storage's `removeItem`, or ''). A newer build's value is left where it is. */
  remove(): StoreStatus {
    return this.put(null);
  }

  /** Reads come from storage again: this page's value kept in memory is dropped (another tab wrote, or the caller gives it up). */
  dropMemory(): void {
    this.memory = null;
  }

  /** Whether reads are serving this page's own value kept in memory. */
  get inMemory(): boolean {
    return this.memory !== null;
  }

  private put(raw: string | null): StoreStatus {
    const storage = this.storage;
    let status: StoreStatus = 'unavailable';
    if (storage && !holdsNewer(this.format, this.readStorage() ?? null)) {
      try {
        if (raw !== null) storage.setItem(this.format.key, raw);
        else if (storage.removeItem) storage.removeItem(this.format.key);
        else storage.setItem(this.format.key, '');
        this.memory = null;
        return 'ok';
      } catch {
        status = 'unavailable';
      }
    } else if (storage) status = 'newer';
    this.memory = this.keepMemory ? { raw, status } : null;
    return status;
  }
}
