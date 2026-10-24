/**
 * The Ability System: one per Run, driving the current Character's Ability (Lint · Decoy,
 * Tumble · Amass, Zap · Discharge). Order 90, before movement, so an Amass that starts this tick
 * already slows the Bunny. Reads input from `run.inputState` (`ability` edge, `abilityHeld`).
 *
 * Shared rules owned here:
 *   - every tunable comes from `params` (resolveAbilityParams, see ./params.ts; resolved again
 *     on keepsakeTuckedIn and whenever a Perk is applied, so controllers read it each time rather
 *     than keeping a copy);
 * Stuns, clogs and Grounded go through run.hazards.status (src/hazards/status.ts), which also
 * holds the boss rules (the 6 s Ability limit, one Hit per stun).
 *
 * Hooks for later effects (Keepsakes): the params modifiers, the events in ./events.ts
 * (abilityUsed, abilityEnded, hazardClogged, hazardSwallowed, bossCrashedIntoAmass,
 * amassCollapsed, hazardShorted, staticFull, bossStunned with `cause`), and the `hooks` callbacks below, which get object references.
 */
import type { InputState } from '../core/input';
import type { Rng } from '../core/rng';
import { getAbility, type AbilityData, type AbilityId } from '../data/abilities';
import { getCharacter } from '../data/characters';
import type { Debris } from '../entities/debris';
import type { Run } from '../game/run';
import { SYSTEM_ORDER, type System } from '../game/system';
import type { Hazard } from '../hazards';
import { RoboVac9000, type BossStunCause } from '../hazards/robovac';
import { isAbilityCause } from '../hazards/status';
import { resolveAbilityParams, type AbilityParams } from './params';
import type { AbilityEndReason } from './events';
import './events';

export const ABILITY_SYSTEM_ID = 'ability';

/** What the HUD widget and the touch button draw. */
export interface AbilityHudState {
  id: AbilityId;
  name: string;
  icon: string;
  /** Can be used right now (off cooldown / meter full). */
  ready: boolean;
  /** Currently out / held (Decoy on the floor, Amass channelling). */
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
  /** An Ability (or Emergency Discharge) stunned a boss. */
  bossStunned?(run: Run, boss: RoboVac9000, cause: BossStunCause, seconds: number): void;
  /** A Discharge hit these Hazards (first target first). */
  discharged?(run: Run, targets: readonly Hazard[]): void;
  /** The scrap one Discharge left (every target's pieces) (Recharge Snack). */
  dischargeScrap?(run: Run, pieces: readonly Debris[]): void;
}

export type ControllerFactory = (system: AbilitySystem) => AbilityController;

const factories = new Map<AbilityId, ControllerFactory>();

/** Registers the controller for an Ability id (./decoy.ts, ./amass.ts, ./discharge.ts). */
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
  readonly controller: AbilityController;
  readonly rng: Rng;
  readonly hooks: AbilityHooks = {};
  private area: string;
  private resolved: AbilityParams;
  /** run.perkVersion the params were last resolved at (Character Perks edit them too). */
  private resolvedPerks: number;

  constructor(readonly run: Run) {
    this.data = getAbility(getCharacter(run.config.characterId).ability);
    this.resolved = resolveAbilityParams(run);
    this.resolvedPerks = run.perkVersion;
    // A Keepsake tucked in mid-Run changes the numbers from the next read on.
    run.disposables.add(run.events.on('keepsakeTuckedIn', () => (this.resolved = resolveAbilityParams(run))));
    run.disposables.add(
      run.events.on('bossStunned', (e) => {
        if (!isAbilityCause(e.cause) || !this.hooks.bossStunned) return;
        const boss = run.hazards.hazards.find((h) => h.id === e.hazardId);
        if (boss && isBoss(boss)) this.hooks.bossStunned(run, boss, e.cause, e.seconds);
      }),
    );
    this.rng = run.rng.fork('ability');
    this.area = run.area;
    const factory = factories.get(this.data.id);
    if (!factory) throw new Error(`No controller registered for Ability "${this.data.id}"`);
    this.controller = factory(this);
  }

  /** Every tunable the Ability reads (re-resolved when a Keepsake is tucked in mid-Run or a Perk is taken, resumed ones included). */
  get params(): AbilityParams {
    const perks = this.run.perkVersion;
    if (perks !== this.resolvedPerks) {
      this.resolvedPerks = perks;
      this.resolved = resolveAbilityParams(this.run);
    }
    return this.resolved;
  }

  update(dt: number, run: Run): void {
    if (run.area !== this.area) {
      this.area = run.area;
      this.controller.areaChanged();
    }
    this.controller.update(dt, run.inputState);
  }

  /** True if an Ability may stun this boss now (the 6 s limit, HazardStatus.canStun). */
  canStunBoss(boss: Hazard): boolean {
    return this.run.hazards.status.canStun(boss, 'discharge');
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
