/**
 * Pause hand-off: who owns a paused Run (issue #53). Pausing stores the Run as the saved Run
 * (`SavedRuns.pause`, src/meta/savedRuns.ts) under a fresh `handoffId` that only this page knows;
 * while it is paused any other tab or window can pick it up with Resume run. Unpausing takes it
 * back only if the slot still holds that id. If not, the Run carried on elsewhere and this page
 * steps aside (`onLost`): it disposes its copy without `runEnded`, so nothing is played or credited
 * twice.
 *
 * All of "is this paused Run still mine" lives here, so Game (src/game/game.ts) only says when to
 * store and when to take back. `SavedRuns` does the rest: the saved Run lock (a store and a later
 * take back run in request order, so neither can be overtaken by another tab's take), the
 * Account's copy (uploaded on store, taken on the server in the background on take back; a server
 * that says another device has the Run makes the page step aside too, `otherDevice`), and the
 * store still waiting for the lock when the page goes away (`SavedRuns.flush`, pagehide). Save &
 * quit lets go of a store still waiting and leaves it to be written under the lock.
 */
import type { PausedRunState } from '../meta/suspendedRun';
import type { SavedRuns } from '../meta/savedRuns';
import { newHandoffId, type RunSnapshot } from './snapshot';

/** Why a paused Run is no longer this page's (see `PausedRunState`; `otherDevice`: the Account's copy, src/meta/savedRuns.ts). */
export type HandoffLoss = Exclude<PausedRunState, 'mine'> | 'otherDevice';

/** What stored the Run: the paused screen, or the tab being hidden on another in-Run screen. */
export type HandoffReason = 'pause' | 'hidden';

export interface RunHandoffOptions {
  /** The saved Run (src/meta/savedRuns.ts). */
  runs: Pick<SavedRuns, 'slot' | 'pause' | 'pauseWaiting' | 'dropPause' | 'pausedState' | 'takeBack'>;
  /** The paused Run was picked up (or replaced) elsewhere: the page must drop its copy uncredited. */
  onLost(why: HandoffLoss): void;
}

interface Held {
  handoffId: string;
  runKey: string;
  by: HandoffReason;
}

export class RunHandoff {
  private held: Held | null = null;
  private taking: Promise<boolean> | null = null;
  private readonly runs: RunHandoffOptions['runs'];
  private readonly onLost: (why: HandoffLoss) => void;

  constructor(opts: RunHandoffOptions) {
    this.runs = opts.runs;
    this.onLost = opts.onLost;
    // Another tab took (or replaced) it: step aside at once rather than on Resume.
    this.runs.slot.onChange((c) => {
      if (c.external) this.check();
    });
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
    this.held = { handoffId: newHandoffId(), runKey: snapshot.runKey, by };
    this.runs.pause(snapshot, this.held.handoffId);
  }

  /** Where this page's paused Run stands (null: it holds none, or its store isn't written yet). */
  state(): PausedRunState | null {
    const h = this.held;
    if (!h || this.runs.pauseWaiting(h.handoffId)) return null;
    return this.runs.pausedState(h.handoffId, h.runKey);
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
   * Takes the paused Run back (unpause, End run, Quit to title): clears the slot if it still holds
   * this page's Run. Resolves true when the page owns the Run again (or held none); false when it
   * was picked up elsewhere (`onLost` was called) or forgotten meanwhile. A take back already in
   * flight is shared.
   */
  takeBack(): Promise<boolean> {
    const h = this.held;
    if (!h) return Promise.resolve(true);
    if (this.taking) return this.taking;
    const taking = this.runs.takeBack(h.handoffId, h.runKey).then((st) => this.settle(h, st));
    this.taking = taking;
    return taking;
  }

  private settle(h: Held, st: PausedRunState): boolean {
    this.taking = null;
    if (this.held !== h) return false;
    this.held = null;
    if (st === 'mine') return true; // optimistic: the page plays on now; the server take only reports back if it is refused
    this.onLost(st);
    return false;
  }

  /**
   * Save & quit from pause: the Run stays in the slot as an ordinary saved Run, and this page lets
   * go of it. Returns why it already isn't this page's (null: it is, none was held, or its store is
   * still waiting for the lock: it is written under the lock as queued, not here outside it).
   */
  leaveStored(): HandoffLoss | null {
    const st = this.state();
    this.held = null;
    return st === null || st === 'mine' ? null : st;
  }

  /** Drops what this page holds without touching the slot (a new Run, stepping aside); a store still waiting for the lock is dropped too. */
  forget(): void {
    if (this.held) this.runs.dropPause(this.held.handoffId);
    this.held = null;
  }
}
