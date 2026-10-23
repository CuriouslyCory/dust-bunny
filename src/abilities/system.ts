/**
 * The Ability System: one per Run, driving the current Character's Ability (Lint · Decoy,
 * Tumble · Hunker, Zap · Discharge). Order 90, before movement, so a Hunker that starts this tick
 * already stops the Bunny. Reads input from `run.inputState` (`ability` edge, `abilityHeld`).
 *
 * Shared rules owned here:
 *   - every tunable comes from `params` (resolveAbilityParams, see ./params.ts);
 *   - the boss limit: a boss can be stunned by an Ability at most once per
 *     params.bossStunInterval seconds (stunBoss). Wall crashes and Spiky Dash don't count;
 *   - Grounded: `hazard.groundedFor` (set by Discharge) counts down here.
 *
 * Hooks for later effects (Keepsakes): the params modifiers, the events in ./events.ts
 * (abilityUsed, abilityEnded, hazardClogged, hazardHitPlanted, hazardShorted, staticFull,
 * bossStunned with `cause`), and the `hooks` callbacks below, which get object references.
 */
import type { InputState } from '../core/input';
import type { Rng } from '../core/rng';
import { getAbility, type AbilityData, type AbilityId } from '../data/abilities';
import { getCharacter } from '../data/characters';
import type { Run } from '../game/run';
import { SYSTEM_ORDER, type System } from '../game/system';
import type { Hazard } from '../hazards';
import { RoboVac9000, type AbilityStunCause, type BossStunCause } from '../hazards/robovac';
import { resolveAbilityParams, type AbilityParams } from './params';
import type { AbilityEndReason } from './events';
import './events';

declare module '../hazards' {
  interface Hazard {
    /** Seconds a boss stays Grounded after a Discharge: it can't be Discharged again meanwhile. */
    groundedFor?: number;
  }
}

export const ABILITY_SYSTEM_ID = 'ability';

/** What the HUD widget and the touch button draw. */
export interface AbilityHudState {
  id: AbilityId;
  name: string;
  icon: string;
  /** Can be used right now (off cooldown / meter full). */
  ready: boolean;
  /** Currently out / held (Decoy on the floor, planted). */
  active: boolean;
  /** Ring fill 0..1: cooldown progress, time left while active, or the Static meter. */
  ring: number;
  /** Short text under the icon: seconds of cooldown, hold time left; null for none. */
  label: string | null;
}

/** One Character's Ability, driven by the System. */
export interface AbilityController {
  readonly id: AbilityId;
  update(dt: number, input: InputState): void;
  hud(): Omit<AbilityHudState, 'id' | 'name' | 'icon'>;
  /** The Run moved to another Area (Hazards and Debris were cleared). */
  areaChanged(): void;
  dispose(): void;
}

/**
 * Callbacks with object references for effects that need more than an event (Keepsakes).
 * All optional; each runs synchronously right after the matching event.
 */
export interface AbilityHooks {
  /** The Decoy ended at (x, z) (Reclaim). */
  decoyEnded?(run: Run, reason: AbilityEndReason, x: number, z: number): void;
  /** A Hazard ran into the planted Tumble (Bristle Back). Bosses: `stunned` when it crashed. */
  plantedTouched?(run: Run, hazard: Hazard, stunned: boolean): void;
  /** An Ability stunned a boss (Dead Weight). */
  bossStunned?(run: Run, boss: RoboVac9000, cause: BossStunCause, seconds: number): void;
  /** A Discharge hit these Hazards (first target first). */
  discharged?(run: Run, targets: readonly Hazard[]): void;
}

export type ControllerFactory = (system: AbilitySystem) => AbilityController;

const factories = new Map<AbilityId, ControllerFactory>();

/** Registers the controller for an Ability id (./decoy.ts, ./hunker.ts, ./discharge.ts). */
export function registerAbilityController(id: AbilityId, factory: ControllerFactory): void {
  factories.set(id, factory);
}

export function isBoss(h: Hazard): h is RoboVac9000 {
  return !!h.def.boss && h instanceof RoboVac9000;
}

/** Disc radius of a Hazard's contact shape. */
export function hazardRadius(h: Hazard): number {
  return h.shape.kind === 'circle' ? h.shape.radius : Math.max(h.shape.halfW, h.shape.halfD);
}

export class AbilitySystem implements System {
  readonly id = ABILITY_SYSTEM_ID;
  readonly order = SYSTEM_ORDER.ability;
  readonly data: AbilityData;
  readonly params: AbilityParams;
  readonly controller: AbilityController;
  readonly rng: Rng;
  readonly hooks: AbilityHooks = {};
  /** Simulated second of each boss's last Ability stun (by Hazard id). */
  private readonly lastBossStun = new Map<number, number>();
  private area: string;

  constructor(readonly run: Run) {
    this.data = getAbility(getCharacter(run.config.characterId).ability);
    this.params = resolveAbilityParams(run);
    this.rng = run.rng.fork('ability');
    this.area = run.area;
    const factory = factories.get(this.data.id);
    if (!factory) throw new Error(`No controller registered for Ability "${this.data.id}"`);
    this.controller = factory(this);
  }

  update(dt: number, run: Run): void {
    if (run.area !== this.area) {
      this.area = run.area;
      this.lastBossStun.clear();
      this.controller.areaChanged();
    }
    for (const h of run.hazards.hazards) if (h.groundedFor && h.groundedFor > 0) h.groundedFor = Math.max(0, h.groundedFor - dt);
    this.controller.update(dt, run.inputState);
  }

  /** True if an Ability may stun this boss now (the 6 s limit). */
  canStunBoss(boss: Hazard): boolean {
    const last = this.lastBossStun.get(boss.id);
    return last === undefined || this.run.time - last >= this.params.bossStunInterval;
  }

  /** Stuns a boss with an Ability if the limit allows (abilityStun, so a hit lands on contact). */
  stunBoss(boss: RoboVac9000, seconds: number, cause: AbilityStunCause): boolean {
    if (!this.canStunBoss(boss)) return false;
    this.lastBossStun.set(boss.id, this.run.time);
    boss.abilityStun(this.run, seconds, cause);
    this.hooks.bossStunned?.(this.run, boss, cause, seconds);
    return true;
  }

  /** Stuns a non-boss Hazard (no movement or attacks) for at least `seconds`. */
  stunHazard(h: Hazard, seconds: number): void {
    h.stunnedFor = Math.max(h.stunnedFor ?? 0, seconds);
    h.stun?.(seconds);
  }

  hud(): AbilityHudState {
    return { id: this.data.id, name: this.data.name, icon: this.data.icon, ...this.controller.hud() };
  }

  dispose(): void {
    this.controller.dispose();
  }
}

/** The Run's Ability System, if installed. */
export function getAbilitySystem(run: Run | null | undefined): AbilitySystem | undefined {
  return run?.getSystem<AbilitySystem>(ABILITY_SYSTEM_ID);
}

/** HUD state of the Run's Ability (null without one). */
export function abilityHud(run: Run | null | undefined): AbilityHudState | null {
  return getAbilitySystem(run)?.hud() ?? null;
}
