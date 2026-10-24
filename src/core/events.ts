/**
 * Typed event bus. One bus lives on the Game and outlives Runs, so long-lived
 * subscribers (audio, UI, analytics) subscribe once at boot.
 *
 * To add events from another module, augment the interface:
 *
 *   declare module '../core/events' {
 *     interface GameEvents { hazardStunned: { hazardId: number } }
 *   }
 */
import type { AreaStats, RunEndReason, RunStats } from '../game/runStats';
import type { RunSnapshot } from '../game/snapshot';
import type { KeepsakeRef } from '../data/keepsakes';
import type { DifficultyId } from '../shared/difficulty';
import type { AreaId } from '../world/types';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface GameEvents {
  /** A new Run has been created and is about to start simulating (`resumed`: a saved Run put back, see `Game.resumeRun`). */
  runStarted: { seed: string; characterId: string; resumed?: boolean };
  /**
   * The Run is about to be stored in the saved Run slot: on pause, or a hidden tab on another
   * in-Run screen (`Game.checkpointRun`, the Run goes on), or Save & quit (`Game.saveAndQuit`, it
   * is disposed). May fire several times per Run. Listeners may write their own fields into
   * `snapshot` (the Keepsake tracker, leaderboard posting).
   */
  runSuspended: { snapshot: RunSnapshot };
  /** Debris (or anything absorbable) was absorbed by the Bunny. */
  debrisAbsorbed: {
    typeId: string;
    /** Debris radius in cm. */
    size: number;
    position: Vec3Like;
    /** Bunny radius after absorbing. */
    radius: number;
    kind: 'debris' | 'hazard';
  };
  /** Bunny radius changed (growth or shrink). */
  bunnyGrew: { radius: number; previousRadius: number };
  /**
   * The Run moved to an Area with another world unit: every world length was multiplied by
   * `factor` (old unit / new unit). Views holding sizes (stuck Debris) rescale; no growth happened.
   */
  bunnyRebased: { factor: number; unit: number };
  /**
   * Entering an Area with an arrival radius (`AREAS[area].arrivalRadius`, the Continent) scaled the
   * Bunny up off screen, after the re-base: `radius` from `previousRadius` (world units). Not
   * growth (no bunnyGrew, no Tier-up): views holding sizes refresh, nothing is awarded.
   */
  bunnyLeapt: { radius: number; previousRadius: number };
  /** Crossed a Tier threshold upward. Emitted once per Tier crossed. */
  tierUp: { tier: number; previousTier: number; tierName: string };
  bunnyDamaged: { amount: number; source: string; health: number; maxHealth: number };
  bunnyHealed: { amount: number; health: number; maxHealth: number };
  bunnyDied: { source: string };
  dashStarted: { cooldown: number };
  /** The Run is over. `runKey` tells Runs apart: a Run is credited once per key (src/meta/meta.ts). */
  runEnded: { runKey: string; reason: RunEndReason; stats: RunStats };
  /** Simulation stopped (user pause, modal screen, tab hidden). `reason` is the screen id. */
  paused: { reason: string };
  resumed: { reason: string };
  screenChanged: { from: string | null; to: string };
  hazardSpawned: { hazardId: number; defId: string };
  hazardRemoved: { hazardId: number; defId: string; absorbed: boolean };
  pickupSpawned: { pickupId: number; defId: string };
  pickupCollected: { pickupId: number; defId: string };
  pickupExpired: { defId: string };
  perkApplied: { perkId: string; stacks: number };
  /** A Keepsake was tucked into an open Loadout slot mid-Run (`Run.tuckIn`); `loadout` is the Run's whole Loadout now. */
  keepsakeTuckedIn: { characterId: string; ref: KeepsakeRef; loadout: KeepsakeRef[] };
  /** An Area's exit opened (after its boss). Position = centre of the opening. */
  exitOpened: { area: AreaId; x: number; z: number };
  /** The Bunny left a cleared Area for the next one (emitted just before areaEntered). */
  areaCompleted: { stats: AreaStats; characterId: string; difficulty: DifficultyId };
  /** The Bunny left for another area; the Run has swapped `run.house` and repopulated Debris. */
  areaEntered: { area: AreaId; timeSec: number };
  /** The cheat code was entered (src/cheats): the Run stops counting for leaderboards and Keepsakes. Once per Run. */
  cheatsUnlocked: { timeSec: number };
}

export type GameEventName = keyof GameEvents;
export type Handler<K extends GameEventName> = (payload: GameEvents[K]) => void;

export class EventBus<E extends object = GameEvents> {
  private handlers = new Map<keyof E, Set<(payload: never) => void>>();

  on<K extends keyof E>(type: K, handler: (payload: E[K]) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as (payload: never) => void);
    return () => this.off(type, handler);
  }

  once<K extends keyof E>(type: K, handler: (payload: E[K]) => void): () => void {
    const off = this.on(type, (p) => {
      off();
      handler(p);
    });
    return off;
  }

  off<K extends keyof E>(type: K, handler: (payload: E[K]) => void): void {
    this.handlers.get(type)?.delete(handler as (payload: never) => void);
  }

  /** Handlers run synchronously; a throwing handler is logged and does not stop the others. */
  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (!set || set.size === 0) return;
    for (const h of [...set]) {
      try {
        (h as (p: E[K]) => void)(payload);
      } catch (err) {
        console.error(`[events] handler for "${String(type)}" threw`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

/** Collects unsubscribe functions so a Run/view can drop all its listeners at once. */
export class Disposables {
  private fns: Array<() => void> = [];
  add(fn: () => void): void {
    this.fns.push(fn);
  }
  dispose(): void {
    for (const fn of this.fns.splice(0).reverse()) fn();
  }
}
