/**
 * Cloud save: keeps a signed-in player's Fluff, Upgrades, Keepsake Hoards (per Character, with the
 * bosses it has beaten) and lifetime stats on the server (api/progress.ts), so they follow the
 * account between devices. Settings, last Character, Difficulty and Loadout stay on the device.
 *
 * - On sign-in: download, then keep whichever copy has more progress (rule in
 *   src/shared/progress.ts). Progress made before signing in is uploaded to the account.
 * - While signed in: every save change is uploaded (debounced). If the server already holds more
 *   progress (another device), that copy replaces the local one.
 * - The device remembers which account it last synced. Signing in to a different account loads that
 *   account's progress (or a fresh save) instead of handing it the previous player's.
 * - It also remembers when it has changes the server hasn't confirmed (say, an Upgrade bought
 *   offline). Spending, Felting and shedding change neither lifetime counter, so on such a tie the device's copy wins;
 *   without unsynced changes a tie goes to the server, so a stale device can't undo another
 *   device's purchases.
 */
import type { AccountClient, AccountState } from '../net/account';
import { compareProgress, isEmptyProgress, sameProgress, validateProgress, type Progress } from '../shared/progress';
import type { MetaProgress } from './meta';
import { browserStorage, defaultSave, type KeyValueStorage, type SaveData } from './save';

/** localStorage key: id of the account this device's save was last synced with. */
export const CLOUD_USER_KEY = 'dust-bunny:cloud-user';
/** localStorage key: id of the account with local changes the server hasn't confirmed yet. */
export const CLOUD_DIRTY_KEY = 'dust-bunny:cloud-dirty';

export type CloudSaveStatus = 'off' | 'syncing' | 'synced' | 'error';

export interface CloudSaveOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  storage?: KeyValueStorage | null;
  /** Delay before uploading after a change (ms). */
  debounceMs?: number;
  /** Delay before retrying a failed upload (ms). */
  retryMs?: number;
}

export function progressOf(d: SaveData): Progress {
  const { runs, wins, bestRadius, bestTier, totalFluffEarned, keepsakesEarned } = d.stats;
  const characters: Progress['characters'] = {};
  for (const [id, c] of Object.entries(d.characters)) characters[id] = { hoard: { ...c.hoard }, bossesBeaten: [...c.bossesBeaten] };
  return { fluff: d.fluff, upgrades: { ...d.upgrades }, characters, stats: { runs, wins, bestRadius, bestTier, totalFluffEarned, keepsakesEarned } };
}

const freshProgress = (): Progress => progressOf(defaultSave());

interface ProgressResponse {
  accepted?: boolean;
  progress: Progress | null;
}

class StatusError extends Error {
  constructor(readonly status: number) {
    super(`progress ${status}`);
  }
}

export function createCloudSave(meta: MetaProgress, account: AccountClient, opts: CloudSaveOptions = {}) {
  const baseUrl = opts.baseUrl ?? '/api/progress';
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const storage = opts.storage === undefined ? browserStorage() : opts.storage;
  const debounceMs = opts.debounceMs ?? 1500;
  const retryMs = opts.retryMs ?? 30_000;

  let status: CloudSaveStatus = 'off';
  const listeners = new Set<(s: CloudSaveStatus) => void>();
  /** Signed-in account (null when signed out). */
  let userId: string | null = null;
  /** connect() finished for userId; until then a retry reconnects instead of uploading. */
  let connected = false;
  /** What the server holds, as far as we know. Local changes that equal it aren't uploaded. */
  let lastSynced: Progress | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();

  function setStatus(s: CloudSaveStatus): void {
    if (s === status) return;
    status = s;
    for (const l of listeners) l(s);
  }

  async function call(init?: RequestInit): Promise<{ accepted: boolean; progress: Progress | null }> {
    const res = await doFetch(baseUrl, { credentials: 'same-origin', ...init, headers: { Accept: 'application/json', ...init?.headers } });
    if (!res.ok) throw new StatusError(res.status);
    const body = (await res.json()) as ProgressResponse;
    if (body.progress === null) return { accepted: body.accepted !== false, progress: null };
    const v = validateProgress(body.progress);
    if (!v.ok) throw new Error(`bad progress: ${v.message}`);
    return { accepted: body.accepted !== false, progress: v.value };
  }

  function storageGet(key: string): string | null {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  function storageSet(key: string, value: string): void {
    try {
      storage?.setItem(key, value);
    } catch {
      /* storage blocked: the next sign-in just merges again */
    }
  }

  /** Remember (across reloads) that this account has changes the server hasn't confirmed. */
  function setDirty(dirty: boolean): void {
    if (!userId) return;
    const current = storageGet(CLOUD_DIRTY_KEY);
    if (dirty && current !== userId) storageSet(CLOUD_DIRTY_KEY, userId);
    else if (!dirty && current === userId) storageSet(CLOUD_DIRTY_KEY, '');
  }

  /** Replaces the synced fields of the local save (the store's listeners see it as one change). */
  function adopt(p: Progress): void {
    lastSynced = p;
    if (sameProgress(progressOf(meta.data), p)) return;
    meta.store.update((d) => {
      d.fluff = p.fluff;
      d.upgrades = { ...p.upgrades };
      // Device-only stats (feltings) survive; the synced ones come from the server.
      d.stats = { ...d.stats, ...p.stats };
      d.characters = {};
      for (const [id, c] of Object.entries(p.characters)) d.characters[id] = { hoard: { ...c.hoard }, bossesBeaten: [...c.bossesBeaten] };
    });
  }

  /**
   * Uploads a snapshot. Accepted: remember it as synced; changes made while the request was in
   * flight stay local and upload next. Refused (the server holds more progress): adopt its copy.
   */
  async function upload(p: Progress): Promise<void> {
    const res = await call({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
    if (!res.progress) return;
    if (res.accepted) {
      lastSynced = res.progress;
      if (sameProgress(progressOf(meta.data), res.progress)) setDirty(false);
      else schedule(debounceMs);
    } else if (compareProgress(progressOf(meta.data), res.progress) > 0) {
      // A Run ended while the refused request was in flight: local is ahead again, so send it.
      lastSynced = res.progress;
      schedule(debounceMs);
    } else {
      adopt(res.progress);
      setDirty(false);
    }
  }

  /** Runs sync steps one at a time; a failure marks the status and schedules a retry. */
  function enqueue(step: () => Promise<void>): Promise<void> {
    chain = chain.then(async () => {
      const forUser = userId;
      if (!forUser) return;
      setStatus('syncing');
      try {
        await step();
        if (userId === forUser) setStatus('synced');
      } catch (err) {
        console.warn('[cloudSave]', err);
        if (userId !== forUser) return;
        setStatus('error');
        // Session gone (expired or signed out elsewhere): re-check it instead of retrying.
        if (err instanceof StatusError && err.status === 401) void account.refresh();
        else schedule(retryMs);
      }
    });
    return chain;
  }

  async function connect(id: string): Promise<void> {
    const remote = (await call()).progress;
    if (userId !== id) return;
    const local = progressOf(meta.data);
    const previous = storageGet(CLOUD_USER_KEY);
    if (previous && previous !== id) {
      // This device's save belongs to another account: start from this account's copy.
      adopt(remote ?? freshProgress());
      setDirty(false);
    } else if (!remote) {
      if (!isEmptyProgress(local)) await upload(local);
      else lastSynced = local;
    } else {
      const order = compareProgress(local, remote);
      const unsynced = storageGet(CLOUD_DIRTY_KEY) === id && !sameProgress(local, remote);
      if (order > 0 || (order === 0 && unsynced)) await upload(local);
      else {
        adopt(remote);
        setDirty(false);
      }
    }
    storageSet(CLOUD_USER_KEY, id);
    if (userId !== id) return;
    connected = true;
    // Changes made while connecting were not scheduled (see onChange): pick them up now.
    if (lastSynced && !sameProgress(progressOf(meta.data), lastSynced)) schedule(debounceMs);
  }

  function pushIfChanged(): Promise<void> {
    return enqueue(async () => {
      const p = progressOf(meta.data);
      if (lastSynced && sameProgress(p, lastSynced)) return;
      await upload(p);
    });
  }

  function schedule(ms: number): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const id = userId;
      if (!id) return;
      void (connected ? pushIfChanged() : enqueue(() => connect(id)));
    }, ms);
  }

  function onAccount(s: AccountState): void {
    const id = s.status === 'signedIn' ? (s.user?.id ?? null) : null;
    if (id === userId) return;
    userId = id;
    connected = false;
    lastSynced = null;
    if (timer) clearTimeout(timer);
    timer = null;
    if (!id) {
      setStatus('off');
      return;
    }
    void enqueue(() => connect(id));
  }

  const offStore = meta.store.onChange(() => {
    if (!userId) return;
    if (lastSynced && sameProgress(progressOf(meta.data), lastSynced)) return;
    setDirty(true);
    if (connected) schedule(debounceMs); // not connected yet: connect() reconciles everything
  });
  const offAccount = account.subscribe(onAccount);

  const onPageHide = () => {
    if (!userId || !connected || !lastSynced || sameProgress(progressOf(meta.data), lastSynced)) return;
    // keepalive lets the upload finish after the tab closes.
    void doFetch(baseUrl, { method: 'PUT', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(progressOf(meta.data)) }).catch(() => undefined);
  };
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('pagehide', onPageHide);

  return {
    get status(): CloudSaveStatus {
      return status;
    },
    onStatus(fn: (s: CloudSaveStatus) => void): () => void {
      listeners.add(fn);
      fn(status);
      return () => listeners.delete(fn);
    },
    /**
     * Uploads pending changes now (call before signing out). Resolves true when the server has
     * everything, false when local changes are still unsynced (offline, server error).
     */
    async flush(): Promise<boolean> {
      if (!userId) return true;
      if (timer) clearTimeout(timer);
      timer = null;
      await (connected ? pushIfChanged() : enqueue(() => connect(userId!)));
      return connected && status === 'synced' && lastSynced !== null && sameProgress(progressOf(meta.data), lastSynced);
    },
    dispose(): void {
      offStore();
      offAccount();
      if (timer) clearTimeout(timer);
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') window.removeEventListener('pagehide', onPageHide);
    },
  };
}

export type CloudSave = ReturnType<typeof createCloudSave>;

let singleton: CloudSave | null = null;

/** Starts syncing the browser save with the signed-in account (call once at boot). */
export function installCloudSave(meta: MetaProgress, account: AccountClient): CloudSave {
  singleton ??= createCloudSave(meta, account);
  return singleton;
}

export function getCloudSave(): CloudSave | null {
  return singleton;
}
