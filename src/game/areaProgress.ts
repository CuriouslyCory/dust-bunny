/**
 * Area progress: which Areas of a Run are cleared (their boss absorbed; the last one: the Run won)
 * and the Run second each was entered. One value inside `Run`, stated in terms of `AREA_ORDER`, so
 * adding an Area needs no change here.
 *
 * Saved and sent data keep their flat shape (ADR 0001): `clearedFlags()` writes the `houseCleared`
 * … `universeCleared` fields of `RunStats` / `CreditStats` (and so of the Run snapshot), and
 * `entryTimes()` the snapshot's `areaTimes`. `AreaProgress.fromFlags` reads the flat fields back,
 * for the code that only has a Run's stats (Fluff, the results screen).
 */
import { AREA_ORDER, type AreaId } from '../world/types';

type Camel<S extends string> = S extends `${infer A}_${infer B}` ? `${A}${Capitalize<Camel<B>>}` : S;

/** A Run's flat "cleared" field for one Area: `houseCleared`, `solarSystemCleared`, … */
export type ClearedFlag = `${Camel<AreaId>}Cleared`;

/** Every Area's flat "cleared" field, as `RunStats` carries them (in `AREA_ORDER`). */
export type ClearedFlags = Record<ClearedFlag, boolean>;

/** `area`'s flat "cleared" field name (`solar_system` → `solarSystemCleared`). */
export function clearedFlag(area: AreaId): ClearedFlag {
  return `${area.replace(/_(\w)/g, (_, c: string) => c.toUpperCase())}Cleared` as ClearedFlag;
}

/**
 * The Area whose boss turns the Bunny into a black hole (Sagittarius A*): while it counts as
 * cleared the Bunny's Form is a black hole (CONTEXT.md, Form).
 */
const BLACK_HOLE_AFTER: AreaId = 'galaxy';

const FIRST = AREA_ORDER[0]!;
const index = (area: AreaId) => AREA_ORDER.indexOf(area);

export class AreaProgress {
  private readonly cleared = new Set<AreaId>();
  /** Run second each Area was entered (the first Area has none: the Run starts there). */
  private readonly entered = new Map<AreaId, number>();

  /** Reads the flat fields of a Run's stats (`RunStats`, `CreditStats`); a missing one is not cleared. */
  static fromFlags(stats: Partial<Record<ClearedFlag, boolean | undefined>>): AreaProgress {
    const p = new AreaProgress();
    for (const a of AREA_ORDER) if (stats[clearedFlag(a)]) p.cleared.add(a);
    return p;
  }

  /** Enters `area` at Run second `sec`: every Area before it counts as cleared. */
  enter(area: AreaId, sec: number): void {
    for (const a of AREA_ORDER.slice(0, index(area))) this.cleared.add(a);
    this.setTime(area, sec);
  }

  /** `area`'s boss was absorbed (in the last Area: the Run was won). */
  clear(area: AreaId): void {
    this.cleared.add(area);
  }

  /**
   * Back to `area` at Run second `sec` (the cheats' jump): it and every Area after it count as not
   * cleared again, and the later ones as never entered.
   */
  rewindTo(area: AreaId, sec: number): void {
    for (const a of AREA_ORDER.slice(index(area))) {
      this.cleared.delete(a);
      this.entered.delete(a);
    }
    this.setTime(area, sec);
  }

  /**
   * A saved Run in `area` (Save & quit → Resume): every Area before it counts as cleared and `times`
   * are the snapshot's `areaTimes` (unknown Areas are skipped).
   */
  resume(area: AreaId, times: Readonly<Partial<Record<string, number>>>): void {
    for (const a of AREA_ORDER.slice(0, index(area))) this.cleared.add(a);
    for (const a of AREA_ORDER) {
      const t = times[a];
      if (t !== undefined) this.setTime(a, t);
    }
  }

  isCleared(area: AreaId): boolean {
    return this.cleared.has(area);
  }

  /** Run second `area` was entered (null before, and for the first Area). */
  timeEntered(area: AreaId): number | null {
    return this.entered.get(area) ?? null;
  }

  /** The latest Area in `AREA_ORDER` that counts as cleared and passes `where` (null: none). */
  furthestCleared(where: (area: AreaId) => boolean = () => true): AreaId | null {
    for (let i = AREA_ORDER.length - 1; i >= 0; i--) {
      const a = AREA_ORDER[i]!;
      if (this.cleared.has(a) && where(a)) return a;
    }
    return null;
  }

  /** The Bunny is a black hole from now on (Sagittarius A* absorbed). */
  get blackHole(): boolean {
    return this.cleared.has(BLACK_HOLE_AFTER);
  }

  /** The flat fields `RunStats` carries, every Area in `AREA_ORDER`. */
  clearedFlags(): ClearedFlags {
    const out = {} as ClearedFlags;
    for (const a of AREA_ORDER) out[clearedFlag(a)] = this.cleared.has(a);
    return out;
  }

  /** The snapshot's `areaTimes`: entry seconds of the Areas entered, in `AREA_ORDER`. */
  entryTimes(): Partial<Record<AreaId, number>> {
    const out: Partial<Record<AreaId, number>> = {};
    for (const a of AREA_ORDER) {
      const t = this.entered.get(a);
      if (t !== undefined) out[a] = t;
    }
    return out;
  }

  private setTime(area: AreaId, sec: number): void {
    if (area !== FIRST) this.entered.set(area, sec);
  }
}

/** What a Run shows of its Area progress (changes go through the Run, so the Form follows them). */
export type AreaProgressView = Pick<AreaProgress, 'isCleared' | 'timeEntered' | 'furthestCleared' | 'blackHole' | 'clearedFlags' | 'entryTimes'>;
