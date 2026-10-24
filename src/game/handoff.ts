/**
 * Pause hand-off: who owns a paused Run (issue #53). Pausing stores the Run in the saved Run slot
 * (src/meta/suspendedRun.ts) under a fresh `handoffId` that only this page knows; while it is
 * paused any other tab or window can pick it up with Resume run. Unpausing takes it back only if
 * the slot still holds that id. If not, the Run carried on elsewhere and this page steps aside
 * (`onLost`): it disposes its copy without `runEnded`, so nothing is played or credited twice.
 *
 * All of "is this paused Run still mine" lives here, so Game (src/game/game.ts) only says when to
 * store and when to take back. For a signed-in player every store is also uploaded to the Account
 * and every take back also takes the Run on the server, in the background (`cloud`,
 * src/meta/accountRun.ts); a server that says another device has the Run makes the page step aside
 * too (`otherDevice`).
 *
 * Every write runs under the saved Run Web Lock (`withSavedRunLock`), in request order, so a store
 * and a later take back can't be overtaken by another tab's take. A store still waiting for the
 * lock when the page goes away is written at once by `flush()` (pagehide), so closing a paused tab
 * keeps its Run. That unlocked write is best effort, for the page going away only: Save & quit
 * lets go of a store still waiting and leaves it to be written under the lock.
 */
import type { MetaProgress } from '../meta/meta';
import {
  creditsReplacedOnDevice,
  pausedRunState,
  storePausedRun,
  takeBackPausedRun,
  withSavedRunLock,
  type LockManagerLike,
  type PausedRunState,
  type SuspendedRunStore,
} from '../meta/suspendedRun';
import { newHandoffId, type RunSnapshot } from './snapshot';

/** Why a paused Run is no longer this page's (see `PausedRunState`; `otherDevice`: the Account's copy, src/meta/accountRun.ts). */
export type HandoffLoss = Exclude<PausedRunState, 'mine'> | 'otherDevice';

/** The Account's copy of the saved Run (`AccountRuns`, src/meta/accountRun.ts); no-ops when signed out. */
export interface HandoffCloud {
  /** Tags a copy about to be written to the device slot with the Account and lease. */
  tag(snapshot: RunSnapshot): void;
  /** The copy is in the device slot (whose replace credited `prevLocalKey` on the device; null: none): upload it. */
  stored(snapshot: RunSnapshot, prevLocalKey: string | null): void;
  /** The device took the Run back: take it on the server too, in the background. */
  takenBack(runKey: string): void;
}

/** What stored the Run: the paused screen, or the tab being hidden on another in-Run screen. */
export type HandoffReason = 'pause' | 'hidden';

export interface RunHandoffOptions {
  store: SuspendedRunStore;
  /** Credits a different Run the store replaces (as a quit). */
  meta: Pick<MetaProgress, 'awardRun'>;
  /** The paused Run was picked up (or replaced) elsewhere: the page must drop its copy uncredited. */
  onLost(why: HandoffLoss): void;
  /** Web Locks (default: `navigator.locks` where available; null: none, everything synchronous). */
  locks?: LockManagerLike | null;
  /** The Account's copy (none: the device slot only). */
  cloud?: HandoffCloud | null;
}

interface Held {
  handoffId: string;
  runKey: string;
  by: HandoffReason;
  /** Waiting for the lock to be written. */
  pending: RunSnapshot | null;
}

export class RunHandoff {
  private held: Held | null = null;
  /** Let go of by Save & quit while still waiting for the lock: written under it all the same. */
  private released: Held | null = null;
  private taking: Promise<boolean> | null = null;
  private readonly slot: SuspendedRunStore;
  private readonly meta: Pick<MetaProgress, 'awardRun'>;
  private readonly onLost: (why: HandoffLoss) => void;
  private readonly locks: LockManagerLike | null | undefined;
  private readonly cloud: HandoffCloud | null;

  constructor(opts: RunHandoffOptions) {
    this.slot = opts.store;
    this.meta = opts.meta;
    this.onLost = opts.onLost;
    this.locks = opts.locks;
    this.cloud = opts.cloud ?? null;
    // Another tab took (or replaced) it: step aside at once rather than on Resume.
    this.slot.onChange((c) => {
      if (c.external) this.check();
    });
  }

  private lock<T>(fn: () => T): Promise<T> {
    return this.locks === undefined ? withSavedRunLock(fn) : withSavedRunLock(fn, this.locks);
  }

  /** What stored the Run this page holds (null: it holds none). */
  get holding(): HandoffReason | null {
    return this.held?.by ?? null;
  }

  /** This page's hand-off id for its paused Run (null: none). */
  get handoffId(): string | null {
    return this.held?.handoffId ?? null;
  }

  /** A take back is in flight: the Run must not simulate or end until it settles. */
  get busy(): boolean {
    return this.taking !== null;
  }

  /**
   * Stores `snapshot` (the Run in progress) under a fresh hand-off id and remembers it. Already
   * holding one: does nothing (the stored copy is still current; nothing changes while paused).
   */
  store(snapshot: RunSnapshot, by: HandoffReason): void {
    if (this.held) return;
    const held: Held = { handoffId: newHandoffId(), runKey: snapshot.runKey, by, pending: snapshot };
    this.held = held;
    const write = (): void => this.write(held);
    void this.lock(write).catch(write);
  }

  private write(held: Held): void {
    if (!held.pending || (this.held !== held && this.released !== held)) return;
    const snapshot = held.pending;
    held.pending = null;
    if (this.released === held) this.released = null;
    this.cloud?.tag(snapshot);
    // A replaced Account copy is credited from the server's answer, not here (`creditsReplacedOnDevice`).
    const prev = this.slot.peek();
    const credited = prev && creditsReplacedOnDevice(prev, snapshot) ? prev.runKey : null;
    // The device first (synchronously), then the Account.
    storePausedRun(this.slot, snapshot, held.handoffId, this.meta);
    this.cloud?.stored(snapshot, credited);
  }

  /** The page is going away: writes a store still waiting for the lock now (pagehide). */
  flush(): void {
    if (this.released) this.write(this.released);
    if (this.held) this.write(this.held);
  }

  /** Where this page's paused Run stands (null: it holds none, or its store isn't written yet). */
  state(): PausedRunState | null {
    const h = this.held;
    if (!h || h.pending) return null;
    return pausedRunState(this.slot, h.handoffId, h.runKey);
  }

  /**
   * Checks the slot (after another tab changed it). Not this page's any more: forgets it, calls
   * `onLost` and returns why. Null while it is still mine, or nothing is held or settling.
   */
  check(): HandoffLoss | null {
    if (this.taking) return null;
    const st = this.state();
    if (st === null || st === 'mine') return null;
    this.held = null;
    this.onLost(st);
    return st;
  }

  /**
   * Takes the paused Run back (unpause, End run, Quit to title): under the lock, clears the slot if
   * it still holds this page's Run. Resolves true when the page owns the Run again (or held none);
   * false when it was picked up elsewhere (`onLost` was called) or forgotten meanwhile. A take back
   * already in flight is shared.
   */
  takeBack(): Promise<boolean> {
    const h = this.held;
    if (!h) return Promise.resolve(true);
    if (this.taking) return this.taking;
    const take = (): PausedRunState => {
      this.write(h);
      return takeBackPausedRun(this.slot, h.handoffId, h.runKey);
    };
    // A lock request that fails (an opaque origin, say) falls back to taking it at once.
    const taking = this.lock(take)
      .catch(take)
      .then((st) => this.settle(h, st));
    this.taking = taking;
    return taking;
  }

  private settle(h: Held, st: PausedRunState): boolean {
    this.taking = null;
    if (this.held !== h) return false;
    this.held = null;
    if (st === 'mine') {
      // Optimistic: the page plays on now; the server take only reports back if it is refused.
      this.cloud?.takenBack(h.runKey);
      return true;
    }
    this.onLost(st);
    return false;
  }

  /**
   * Save & quit from pause: the Run stays in the slot as an ordinary saved Run, and this page lets
   * go of it. Returns why it already isn't this page's (null: it is, none was held, or its store is
   * still waiting for the lock: it is written under the lock as queued, not here outside it).
   */
  leaveStored(): HandoffLoss | null {
    const h = this.held;
    const st = this.state();
    if (h?.pending) this.released = h;
    this.held = null;
    return st === null || st === 'mine' ? null : st;
  }

  /** Drops what this page holds without touching the slot (a new Run, stepping aside). */
  forget(): void {
    this.held = null;
  }
}
