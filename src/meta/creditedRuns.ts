/**
 * The device's own record of which Runs its progress copy has credited, kept beside the save under
 * a key that builds from before the ledger never write (docs/adr/0003, "Builds from before the
 * ledger on the same device").
 *
 * `SaveData.creditedRuns` is what makes a credit idempotent per copy, but a tab still running a
 * build from before the ledger rewrites the whole save without it (its sanitiser drops fields it
 * doesn't know) while keeping the Fluff. Read back by itself, that save would look like a copy
 * that holds no credit, and the next sweep would add up to 20 ledger rows' Fluff a second time. So
 * every write of `creditedRuns` by this build is mirrored here (`keys`), and a save whose set lacks
 * mirrored keys is repaired as it is read (`MetaProgress`): the keys come back, the Fluff is not
 * touched. A key the mirror remembers but the save lost can therefore only under-credit (a credit
 * whose Fluff the copy may not hold is not applied again), never double credit.
 *
 * The mirror only knows the keys *this device* wrote, though. A copy adopted from the cloud can
 * hold another device's credit under a key the old-build tab then dropped before this build saw
 * it: the mirror can't bring that one back, and the sweep would apply the row again. So a save read
 * without the field at all, on a device whose mirror exists (it has used the ledger), marks the set
 * `unknown`: the sweep stays suspended, uploads omit `creditedRuns` (the server keeps its stored
 * set) and a claim's answer for a row that already existed is not applied, until a cloud adopt of a
 * copy that carries `creditedRuns` restores a known set. Credits this device applies meanwhile
 * still add their key (the set is "at least these").
 *
 * `local` holds keys credited on this device with no Account (no ledger row will ever exist for
 * them, so they are not worth a slot in the synced set, whose `CREDITED_RUNS_MAX` keys must outlast
 * the ledger's newest `RUN_CREDIT_LIST_MAX`). They deduplicate a signed-out Run's credit on this
 * device only.
 *
 * A file from a newer build is read as far as it is understood and never written (docs/adr/0001):
 * this build's changes then live in memory.
 */
import { CREDITED_RUNS_MAX, isRunKey } from '../shared/runCredit';
import type { KeyValueStorage } from './save';

export const CREDITED_RUNS_MIRROR_KEY = 'dust-bunny:credited-runs:v1';
export const CREDITED_RUNS_MIRROR_VERSION = 1;
/** How many signed-out credits the device remembers (they only guard against crediting one Run twice on this device). */
export const LOCAL_CREDITS_MAX = 50;

export interface CreditedRunsMirror {
  /** The synced set (`SaveData.creditedRuns`) as this build last wrote it, oldest first. */
  keys: string[];
  /** Keys credited on this device without an Account, oldest first. */
  local: string[];
  /** The set may be missing keys this device never wrote (see above): sweep and upload hold off. */
  unknown: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const empty = (): CreditedRunsMirror => ({ keys: [], local: [], unknown: false });

function readKeys(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const k of v as unknown[]) if (isRunKey(k) && !out.includes(k)) out.push(k);
  return out.slice(-max);
}

export class CreditedRunsMirrorStore {
  /** The file is a newer build's (never written) or storage is unavailable: this build's record lives here. */
  private memory: CreditedRunsMirror | null = null;

  constructor(private readonly storage: KeyValueStorage | null) {}

  /** Whether this device has a record at all (it has used the ledger): a save without `creditedRuns` then lost the field. */
  exists(): boolean {
    if (this.memory) return true;
    try {
      return !!this.storage?.getItem(CREDITED_RUNS_MIRROR_KEY);
    } catch {
      return false;
    }
  }

  read(): CreditedRunsMirror {
    if (this.memory) return { keys: [...this.memory.keys], local: [...this.memory.local], unknown: this.memory.unknown };
    if (!this.storage) {
      this.memory = empty();
      return empty();
    }
    let parsed: unknown;
    try {
      const raw = this.storage.getItem(CREDITED_RUNS_MIRROR_KEY);
      if (!raw) return empty();
      parsed = JSON.parse(raw);
    } catch {
      return empty();
    }
    if (!isObj(parsed)) return empty();
    const file: CreditedRunsMirror = { keys: readKeys(parsed.keys, CREDITED_RUNS_MAX), local: readKeys(parsed.local, LOCAL_CREDITS_MAX), unknown: parsed.unknown === true };
    if (typeof parsed.version === 'number' && parsed.version > CREDITED_RUNS_MIRROR_VERSION) this.memory = file;
    return { keys: [...file.keys], local: [...file.local], unknown: file.unknown };
  }

  write(m: CreditedRunsMirror): void {
    const next: CreditedRunsMirror = { keys: m.keys.slice(-CREDITED_RUNS_MAX), local: m.local.slice(-LOCAL_CREDITS_MAX), unknown: m.unknown };
    if (this.memory) {
      this.memory = next;
      return;
    }
    try {
      this.storage?.setItem(CREDITED_RUNS_MIRROR_KEY, JSON.stringify({ version: CREDITED_RUNS_MIRROR_VERSION, ...next }));
    } catch {
      this.memory = next; // storage full or refused: this page keeps its record in memory
    }
  }

  /** Keys the mirror remembers in the synced set that `creditedRuns` lacks (the save lost them). */
  missingFrom(creditedRuns: readonly string[]): string[] {
    return this.read().keys.filter((k) => !creditedRuns.includes(k));
  }
}
