/**
 * Cloud save: keeps a signed-in player's Fluff, Upgrades and lifetime stats on the server
 * (api/progress.ts), so they follow the account between devices. Settings, last Character and
 * Difficulty stay on the device.
 *
 * - On sign-in: download, then keep whichever copy has more progress (rule in
 *   src/shared/progress.ts). Progress made before signing in is uploaded to the account.
 * - While signed in: every save change is uploaded (debounced). If the server already holds more
 *   progress (another device), that copy replaces the local one.
 * - The device remembers which account it last synced. Signing in to a different account loads that
 *   account's progress (or a fresh save) instead of handing it the previous player's.
 */
import type { AccountClient, AccountState } from '../net/account';
import { compareProgress, isEmptyProgress, sameProgress, validateProgress, type Progress } from '../shared/progress';
import type { MetaProgress } from './meta';
import { browserStorage, defaultSave, type KeyValueStorage, type SaveData } from './save';

/** localStorage key: id of the account this device's save was last synced with. */
export const CLOUD_USER_KEY = 'dust-bunny:cloud-user';

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
  return { fluff: d.fluff, upgrades: { ...d.upgrades }, stats: { ...d.stats } };
}

const freshProgress = (): Progress => progressOf(defaultSave());

interface ProgressResponse {
  accepted?: boolean;
  progress: Progress | null;
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

  async function call(init?: RequestInit): Promise<Progress | null> {
    const res = await doFetch(baseUrl, { credentials: 'same-origin', ...init, headers: { Accept: 'application/json', ...init?.headers } });
    if (!res.ok) throw new Error(`progress ${res.status}`);
    const body = (await res.json()) as ProgressResponse;
    if (body.progress === null) return null;
    const v = validateProgress(body.progress);
    if (!v.ok) throw new Error(`bad progress: ${v.message}`);
    return v.value;
  }

  /** Replaces the synced fields of the local save (the store's listeners see it as one change). */
  function adopt(p: Progress): void {
    lastSynced = p;
    if (sameProgress(progressOf(meta.data), p)) return;
    meta.store.update((d) => {
      d.fluff = p.fluff;
      d.upgrades = { ...p.upgrades };
      d.stats = { ...p.stats };
    });
  }

  /** Uploads; when the server refuses (it holds more progress), adopts its copy. */
  async function upload(p: Progress): Promise<void> {
    const stored = await call({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
    if (stored) adopt(stored);
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
        if (userId === forUser) {
          setStatus('error');
          schedule(retryMs);
        }
      }
    });
    return chain;
  }

  async function connect(id: string): Promise<void> {
    const remote = await call();
    if (userId !== id) return;
    const local = progressOf(meta.data);
    const previous = storage?.getItem(CLOUD_USER_KEY) ?? null;
    if (previous && previous !== id) {
      // This device's save belongs to another account: start from this account's copy.
      adopt(remote ?? freshProgress());
    } else if (!remote) {
      if (!isEmptyProgress(local)) await upload(local);
      else lastSynced = local;
    } else if (compareProgress(local, remote) > 0) {
      await upload(local);
    } else {
      adopt(remote);
    }
    try {
      storage?.setItem(CLOUD_USER_KEY, id);
    } catch {
      /* storage blocked: next sign-in just merges again */
    }
    if (userId === id) connected = true;
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
    if (!userId || !connected || !lastSynced) return; // not connected yet: connect() reconciles everything
    if (sameProgress(progressOf(meta.data), lastSynced)) return;
    schedule(debounceMs);
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
    /** Uploads pending changes now (call before signing out). */
    flush(): Promise<void> {
      if (!connected) return chain;
      if (timer) clearTimeout(timer);
      timer = null;
      return pushIfChanged();
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
