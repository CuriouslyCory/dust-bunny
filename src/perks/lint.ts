/**
 * Lint's Character Perks (drafted only by Lint). Numbers: CHARACTER_PERK_EFFECTS in
 * src/data/perks.ts; sizes and ranges in Bunny radii (r).
 *
 *   Well-Rounded   apply() raises Lint's `max` caps by stacks × wellRoundedCaps (speed, maxHealth,
 *                  magnetRadius, knockbackResistance) with StatBlock.setCapBonus; no stat is granted.
 *                  The System re-syncs it from run.perkStacks each tick.
 *   Smother        a contactOverride (chained before any earlier one): a clogged non-boss Hazard up
 *                  to smotherRatio × Lint's absorb limit is absorbed on touch (HazardManager.absorb).
 *   Loose Threads  when a clog ends, the Hazard (bosses too) drops 1 / 2 / 3 absorbable fibre pieces
 *                  (`lint_ball`, else the closest shed type) of looseThreadsSize r around its edge.
 *   Lint Trail     while Lint dashes it lays a streak (lintTrailWidth r wide) along its path; the
 *                  streak lasts lintTrailDuration s after that Dash ends. The first non-boss,
 *                  tangible, unclogged Hazard whose disc overlaps it is clogged (stunned like the
 *                  Decoy's clog, hazardClogged) and the streak is used up.
 *   Unnoticed      when a clog ends, a non-boss Hazard ignores Lint for 1.5 / 2 / 2.5 s
 *                  (`hazard.ignoresBunnyFor`, see ignoresBunny in src/hazards/common.ts).
 *
 * Clogs: the LintPerks System tracks every clog (hazardClogged with seconds > 0: the Decoy's, or
 * Lint Trail's) as `hazard.cloggedFor`. A clog that lands on a clogged Hazard extends it. When the
 * time runs out the clog ends (Loose Threads, Unnoticed), once per clog; a Hazard that dies or
 * leaves with the Area first gets no end effects.
 */
import { CHARACTER_PERK_EFFECTS as FX, CHARACTER_PERKS, perStack } from '../data/perks';
import type { StatKey } from '../entities/stats';
import type { Run } from '../game/run';
import type { System } from '../game/system';
import { hazardRadius } from '../abilities/system';
import '../abilities/events';
import type { Hazard } from '../hazards';
import { pickShedType, scatterDebris } from '../hazards/shed';
import type { Rng } from '../core/rng';
import type { PerkDef } from './index';
import { LintTrailView } from './lintView';

declare module '../hazards' {
  interface Hazard {
    /** Seconds left of a clog (the Decoy's or Lint Trail's), tracked on Lint Runs (Smother reads it). */
    cloggedFor?: number;
  }
}

export const LINT_PERKS_SYSTEM_ID = 'lintPerks';
/** Debris type Loose Threads drops when the Run has it (else the shed type closest in size). */
const FIBRE_DEBRIS = 'lint_ball';
/** Floor clearance of the fluff streak, in real cm (divided by the Area's unit). */
const TRAIL_Y_CM = 0.25;

/** Sets Well-Rounded's cap bonus for `stacks` (idempotent). */
function wellRounded(run: Run, stacks: number): void {
  for (const [key, per] of Object.entries(FX.wellRoundedCaps) as [StatKey, number][]) run.bunny.stats.setCapBonus(key, per * stacks);
}

export const LINT_PERK_DEFS: PerkDef[] = [
  { ...CHARACTER_PERKS.well_rounded, apply: (run, stacks) => wellRounded(run, stacks) },
  // The rest read run.perkStacks from the LintPerks System.
  { ...CHARACTER_PERKS.smother, apply: () => {} },
  { ...CHARACTER_PERKS.loose_threads, apply: () => {} },
  { ...CHARACTER_PERKS.lint_trail, apply: () => {} },
  { ...CHARACTER_PERKS.unnoticed, apply: () => {} },
];

interface Streak {
  points: { x: number; z: number }[];
  /** World units, from Lint's radius when the Dash started. */
  width: number;
  /** Run second it disappears; null while the Dash is still laying it. */
  endsAt: number | null;
  view: LintTrailView;
}

/** Distance from (px, pz) to the segment a–b. */
function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Clog tracking and Lint's Perk effects (see file header). Order 295: after combat, before Hazards. */
export class LintPerks implements System {
  readonly id = LINT_PERKS_SYSTEM_ID;
  readonly order = 295;
  /** Hazards with a clog running. */
  readonly clogged = new Set<Hazard>();
  readonly streaks: Streak[] = [];
  private readonly rng: Rng;
  private area: string;

  constructor(run: Run) {
    this.rng = run.rng.fork('lintPerks');
    this.area = run.area;
    run.disposables.add(
      run.events.on('hazardClogged', (e) => {
        if (e.seconds <= 0) return;
        const h = run.hazards.hazards.find((x) => x.id === e.hazardId);
        if (h) this.clog(h, e.seconds);
      }),
    );
    // Smother, ahead of any earlier override (Lint has no Amass, but keep the chain).
    const prev = run.hazards.contactOverride;
    run.hazards.contactOverride = (r, h) => this.smother(r, h) || (prev?.(r, h) ?? false);
  }

  /** Starts (or extends) a clog on a Hazard. */
  clog(h: Hazard, seconds: number): void {
    if (h.dead) return;
    h.cloggedFor = Math.max(h.cloggedFor ?? 0, seconds);
    this.clogged.add(h);
  }

  update(dt: number, run: Run): void {
    wellRounded(run, run.perkStacks('well_rounded'));
    if (run.area !== this.area) {
      this.area = run.area;
      this.clearStreaks();
    }
    this.tickClogs(dt, run);
    this.trail(run);
  }

  private tickClogs(dt: number, run: Run): void {
    for (const h of [...this.clogged]) {
      if (h.dead || !run.hazards.hazards.includes(h)) {
        h.cloggedFor = 0;
        this.clogged.delete(h);
        continue;
      }
      h.cloggedFor = Math.max(0, (h.cloggedFor ?? 0) - dt);
      if (h.cloggedFor > 0) continue;
      this.clogged.delete(h);
      this.clogEnded(run, h);
    }
  }

  /** A clog ran out: Loose Threads, then Unnoticed. */
  private clogEnded(run: Run, h: Hazard): void {
    const b = run.bunny;
    const pieces = perStack(FX.looseThreadsPieces, run.perkStacks('loose_threads'));
    if (pieces) {
      const size = Math.min(FX.looseThreadsSize, b.stats.get('absorbRatio') * 0.9) * b.radius;
      const type = run.debris.types.find((t) => t.id === FIBRE_DEBRIS) ?? pickShedType(run.debris.types, size, run.tier, run.area);
      const edge = hazardRadius(h);
      scatterDebris(run, this.rng, h.x, h.z, pieces, size, edge + size, edge + b.radius * FX.looseThreadsSpread, type);
    }
    const ignore = perStack(FX.unnoticedFor, run.perkStacks('unnoticed'));
    if (ignore && !h.def.boss) h.ignoresBunnyFor = Math.max(h.ignoresBunnyFor ?? 0, ignore);
  }

  /** Smother: true if it absorbed the (clogged, non-boss, small enough) Hazard Lint touched. */
  private smother(run: Run, h: Hazard): boolean {
    if (run.perkStacks('smother') <= 0 || h.def.boss || !((h.cloggedFor ?? 0) > 0)) return false;
    const b = run.bunny;
    if (h.size > FX.smotherRatio * b.radius * b.stats.get('absorbRatio')) return false;
    run.hazards.absorb(h);
    return true;
  }

  /** Lint Trail: lays, ages and checks the streaks. */
  private trail(run: Run): void {
    const b = run.bunny;
    const stacks = run.perkStacks('lint_trail');
    let open = this.streaks.find((s) => s.endsAt === null);
    if (stacks > 0 && b.dashing) {
      if (!open) {
        open = { points: [{ x: b.x, z: b.z }, { x: b.x, z: b.z }], width: b.radius * FX.lintTrailWidth, endsAt: null, view: new LintTrailView(run.entityRoot, TRAIL_Y_CM / run.unit) };
        this.streaks.push(open);
      }
      const pts = open.points;
      const n = pts.length;
      // The head follows Lint; a new point is fixed every half a streak width.
      if (Math.hypot(pts[n - 1]!.x - pts[n - 2]!.x, pts[n - 1]!.z - pts[n - 2]!.z) >= open.width * 0.5) pts.push({ x: b.x, z: b.z });
      else pts[n - 1] = { x: b.x, z: b.z };
      open.view.sync(pts, open.width);
    } else if (open) open.endsAt = run.time + FX.lintTrailDuration;

    for (let i = this.streaks.length - 1; i >= 0; i--) {
      const s = this.streaks[i]!;
      const left = s.endsAt === null ? Infinity : s.endsAt - run.time;
      if (left <= 0 || this.crossed(run, s, stacks)) {
        s.view.dispose();
        this.streaks.splice(i, 1);
      } else s.view.fade(left);
    }
  }

  /** Clogs the first eligible Hazard over the streak. True if one was. */
  private crossed(run: Run, s: Streak, stacks: number): boolean {
    const seconds = perStack(FX.lintTrailClog, stacks);
    if (!seconds) return false;
    for (const h of run.hazards.hazards) {
      if (h.dead || h.intangible || h.def.boss || (h.cloggedFor ?? 0) > 0) continue;
      const reach = hazardRadius(h) + s.width / 2;
      let hit = false;
      for (let i = 1; i < s.points.length && !hit; i++) {
        const a = s.points[i - 1]!;
        const c = s.points[i]!;
        hit = segmentDistance(h.x, h.z, a.x, a.z, c.x, c.z) <= reach;
      }
      if (!hit) continue;
      // Stunned like a Decoy clog (AbilitySystem.stunHazard); the event starts the clog above.
      h.stunnedFor = Math.max(h.stunnedFor ?? 0, seconds);
      h.stun?.(seconds);
      run.events.emit('hazardClogged', { hazardId: h.id, defId: h.def.id, boss: false, seconds });
      return true;
    }
    return false;
  }

  private clearStreaks(): void {
    for (const s of this.streaks) s.view.dispose();
    this.streaks.length = 0;
  }

  dispose(): void {
    this.clearStreaks();
    this.clogged.clear();
  }
}

/** Installs Lint's Perk effects on a Lint Run (once). */
export function installLintPerks(run: Run): LintPerks {
  const existing = run.getSystem<LintPerks>(LINT_PERKS_SYSTEM_ID);
  if (existing) return existing;
  const sys = new LintPerks(run);
  run.addSystem(sys);
  return sys;
}

/** The Run's Lint Perk System, if installed (Lint Runs only). */
export function getLintPerks(run: Run): LintPerks | undefined {
  return run.getSystem<LintPerks>(LINT_PERKS_SYSTEM_ID);
}
