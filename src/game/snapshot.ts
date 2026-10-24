/**
 * Run snapshot: what "Save & quit" keeps of a Run in progress, so it can be resumed later in the
 * Area it was left in (`Run.toSnapshot()` / `Run.restore()`, `Game.saveAndQuit()` / `Game.resumeRun()`).
 *
 * It holds the Run's identity and progression, not its moment-to-moment world: the seed,
 * Character, Difficulty, Upgrades and Keepsake Loadout it started with, the Area and whether its
 * boss has fallen, the Bunny (real size, position, health, shield and revive charges, form), Perks
 * with stacks, active timed Pickups, pending Perk drafts, the clock, counters, per-Area stats and
 * the fixed Debris placements already absorbed in the Area. On resume the Area is rebuilt from the
 * seed and repopulated around the Bunny; live Hazards (a boss mid-fight included) are not kept, so
 * the director starts the Area over with its grace period (a boss that was already absorbed stays
 * gone and the exit stays open).
 *
 * Browser modules add their own fields while the snapshot is taken (`runSuspending`): the Keepsake
 * tracker's rarity salt and drops, the leaderboard's run id (so reposting is idempotent).
 *
 * `runKey` names the Run itself: generated once when it starts (`newRunKey`) and kept through every
 * save and resume, so two saves of the same Run can be told from two different Runs (the saved Run
 * slot credits a Run it replaces, src/meta/suspendedRun.ts). Snapshots saved before it existed get
 * one on read (`legacyRunKey`).
 *
 * `handoffId` marks a Run stored by a pause rather than Save & quit: whichever page holds that id
 * may take the Run back on unpause; anyone else may pick it up (src/game/handoff.ts). Optional and
 * additive (docs/adr/0001): older snapshots and builds read it as absent.
 *
 * `parseRunSnapshot` never throws: anything unreadable, from another version or with a field of
 * the wrong type is rejected (null) rather than half-restored.
 */
import { CHARACTERS } from '../data/characters';
import { isDifficultyId } from '../data/difficulty';
import type { KeepsakeRef } from '../data/keepsakes';
import type { KeepsakeDrop } from '../meta/keepsakes';
import type { StatModifier } from '../entities/stats';
import type { BunnyForm } from '../entities/bunny';
import type { DifficultyId } from '../shared/difficulty';
import { AREA_ORDER, type AreaId } from '../world/types';
import type { AreaStats, RunStats } from './runStats';

export const SNAPSHOT_VERSION = 1;

export interface RunSnapshot {
  version: typeof SNAPSHOT_VERSION;
  /** Wall-clock ms when it was saved (the title's "saved … ago"). */
  savedAt: number;
  /** The Run's identity: the same for every save of one Run, different for any other Run. */
  runKey: string;
  seed: string;
  characterId: string;
  difficulty?: DifficultyId;
  /** The Run's start modifiers (Upgrades owned when it started; Upgrades bought later don't apply). */
  modifiers: StatModifier[];
  /** Keepsakes tucked in for the Run. */
  loadout: KeepsakeRef[];
  area: AreaId;
  /** The Area's boss has been absorbed (its exit is open). */
  areaCleared: boolean;
  /** Simulated seconds. */
  time: number;
  tier: number;
  tierTimes: Record<number, number>;
  debrisAbsorbed: number;
  hazardsAbsorbed: number;
  /** Run second each Area after the house was entered. */
  areaTimes: Partial<Record<AreaId, number>>;
  /** Areas already left. */
  areasDone: AreaStats[];
  /** Where the current Area started. */
  areaStart: { area: AreaId; startSec: number; radiusIn: number; maxRadiusIn: number; debris: number } | null;
  bunny: {
    /** World position in the Area's unit. */
    x: number;
    z: number;
    /** Real radius (cm). */
    realRadius: number;
    /** Largest real radius (cm) this Run. */
    maxRealRadius: number;
    health: number;
    shield: number;
    revives: number;
    form: BunnyForm;
    heading: number;
  };
  /** Perk id → stacks. */
  perks: Record<string, number>;
  perkDraft: { pending: number; rerollsUsed: number };
  /** Active timed Pickups. */
  pickups: { id: string; remaining: number }[];
  /** Indexes into the Area's `debrisPlacements` that are gone (absorbed): not placed again. */
  placementsGone: number[];
  /** The Run's stats when it was saved (the title's summary; Fluff when it is abandoned). */
  stats: RunStats;
  /** The Keepsake tracker's per-Run state (browser). */
  keepsakes?: { salt: string; drops: KeepsakeDrop[] };
  /** The leaderboard entries' run id (browser). */
  leaderboardRunId?: string;
  /** The Run doesn't count for the leaderboards or drop Keepsakes (debug tools; browser). */
  unranked?: boolean;
  /** The Area the Run was started in (`RunConfig.area`, a debug start past the house). */
  startArea?: AreaId;
  /**
   * Stored by a pause (`Game.checkpointRun`): fresh per pause. The pausing page remembers it, and
   * plays on only while the slot still holds it (src/game/handoff.ts). Absent for Save & quit.
   */
  handoffId?: string;
}

/** A fresh Run identity (random, so two Runs on the same seed and Character still differ). */
export function newRunKey(): string {
  return randomId();
}

/** A fresh hand-off id for one pause (`RunSnapshot.handoffId`). */
export function newHandoffId(): string {
  return randomId();
}

function randomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/**
 * The identity of a snapshot saved before `runKey` existed: its leaderboard run id when it has one
 * (random per Run), else its seed and Character. A Run resumed from it keeps this key.
 */
export function legacyRunKey(s: { leaderboardRunId?: string; seed: string; characterId: string }): string {
  return s.leaderboardRunId ? `lb:${s.leaderboardRunId}` : `seed:${s.seed}:${s.characterId}`;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isArea = (v: unknown): v is AreaId => AREA_ORDER.includes(v as AreaId);

const isRef = (k: unknown): boolean => isObj(k) && isStr(k.type) && isNum(k.rarity);

function isAreaStats(v: unknown): v is AreaStats {
  return (
    isObj(v) &&
    isArea(v.area) &&
    isNum(v.startSec) &&
    isNum(v.timeSec) &&
    isNum(v.radiusIn) &&
    isNum(v.maxRadius) &&
    isNum(v.debrisAbsorbed) &&
    typeof v.cleared === 'boolean' &&
    (v.loadout === undefined || (Array.isArray(v.loadout) && v.loadout.every(isRef)))
  );
}

function isNumRecord(v: unknown): v is Record<string, number> {
  return isObj(v) && Object.values(v).every(isNum);
}

/**
 * A stored snapshot, validated (null for anything that can't be resumed safely: wrong version,
 * unknown Character or Area, a missing or mistyped field).
 */
export function parseRunSnapshot(raw: unknown): RunSnapshot | null {
  if (!isObj(raw) || raw.version !== SNAPSHOT_VERSION) return null;
  const s = raw;
  if (!isNum(s.savedAt) || !isStr(s.seed) || !isStr(s.characterId) || !CHARACTERS.some((c) => c.id === s.characterId)) return null;
  if (s.runKey !== undefined && !(isStr(s.runKey) && s.runKey.length > 0)) return null;
  if (s.difficulty !== undefined && !isDifficultyId(s.difficulty)) return null;
  if (!Array.isArray(s.modifiers) || !s.modifiers.every((m) => isObj(m) && isStr(m.stat) && (m.op === 'add' || m.op === 'mul') && isNum(m.value) && isStr(m.source))) return null;
  if (!Array.isArray(s.loadout) || !s.loadout.every(isRef)) return null;
  if (!isArea(s.area) || typeof s.areaCleared !== 'boolean') return null;
  if (!isNum(s.time) || s.time < 0 || !isNum(s.tier) || s.tier < 1 || !isNumRecord(s.tierTimes) || !isNum(s.debrisAbsorbed) || !isNum(s.hazardsAbsorbed)) return null;
  if (!isNumRecord(s.areaTimes) || !Object.keys(s.areaTimes).every(isArea)) return null;
  if (!Array.isArray(s.areasDone) || !s.areasDone.every(isAreaStats)) return null;
  const st = s.areaStart;
  if (st !== null && !(isObj(st) && isArea(st.area) && isNum(st.startSec) && isNum(st.radiusIn) && isNum(st.maxRadiusIn) && isNum(st.debris))) return null;
  const b = s.bunny;
  if (!isObj(b) || ![b.x, b.z, b.realRadius, b.maxRealRadius, b.health, b.shield, b.revives, b.heading].every(isNum) || (b.form !== 'dust' && b.form !== 'black_hole')) return null;
  if (!((b.realRadius as number) > 0)) return null;
  if (!isNumRecord(s.perks)) return null;
  const d = s.perkDraft;
  if (!isObj(d) || !isNum(d.pending) || !isNum(d.rerollsUsed)) return null;
  if (!Array.isArray(s.pickups) || !s.pickups.every((p) => isObj(p) && isStr(p.id) && isNum(p.remaining))) return null;
  if (!Array.isArray(s.placementsGone) || !s.placementsGone.every((i) => Number.isInteger(i) && (i as number) >= 0)) return null;
  if (!isObj(s.stats) || !isStr(s.stats.seed) || !isNum(s.stats.timeSec) || !isNum(s.stats.maxRadius) || !isNum(s.stats.tierReached) || !isArea(s.stats.area)) return null;
  if (s.keepsakes !== undefined && !(isObj(s.keepsakes) && isStr(s.keepsakes.salt) && Array.isArray(s.keepsakes.drops))) return null;
  if (s.leaderboardRunId !== undefined && !isStr(s.leaderboardRunId)) return null;
  if (s.unranked !== undefined && typeof s.unranked !== 'boolean') return null;
  if (s.startArea !== undefined && !isArea(s.startArea)) return null;
  if (s.handoffId !== undefined && !(isStr(s.handoffId) && s.handoffId.length > 0)) return null;
  const out = structuredClone(s) as unknown as RunSnapshot;
  out.runKey ??= legacyRunKey(out);
  return out;
}
