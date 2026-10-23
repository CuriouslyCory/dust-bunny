/**
 * The Orbital Sweeper (globe boss; ORBITAL_SWEEPER in src/data/hazards.ts): the bosses'
 * state machine (RoboVac9000: intro, hunt, telegraphed charge, stun, hit, absorb) reskinned as a
 * net-and-laser cleanup satellite, humanity's final appliance.
 *
 * - **The net.** No radial suction: while it hunts, a Bunny ahead of it (within `net.halfAngle` of
 *   its facing) and within `net.reach` of the net tip is pulled towards the tip.
 * - **The lasers.** Its twin lenses fire the `ash` volley in red: a red lane locks on the Bunny,
 *   then a burst of laser bolts flies along it; a hit deals 1 and sheds mass.
 * - **The Kessler swarm.** It summons mini sweepers (`mini_sweeper`, Roomba behaviour), three at a
 *   time, up to six alive.
 * - **Only the Moon stuns it.** The Globe has no obstacles; the poles (the map's north and south
 *   bounds) just end a charge. A charge that runs into a Moon (Debris type `moon.typeId`) the Bunny
 *   can't absorb yet stops against it and stuns it (`chargeBlocked`, `crashStuns`); such a Moon
 *   also blocks it while it hunts. Abilities and Spiky Dash still stun it as usual.
 * - **The Moon swings round.** When it arrives, and every `moon.interval` s while it hunts, if no
 *   Moon the Bunny can't absorb is within `moon.range` of the Bunny, one lands near the Bunny
 *   (between the Bunny and the Sweeper the first time): at least the type's size and `moon.margin`
 *   × the largest size the Bunny can absorb, so a Bunny standing behind it baits a charge into it.
 *
 * Absorbing it clears the Globe (`run.clearArea()`; the last built Area, so the Run is won).
 */
import type { Rng } from '../core/rng';
import { ORBITAL_SWEEPER, type OrbitalSweeperTuning } from '../data/hazards';
import type { Debris } from '../entities/debris';
import type { Run } from '../game/run';
import { canAbsorb } from '../systems/absorb';
import { isFloorFree } from '../systems/spawner';
import { applySuction, bunnySheltered, suctionFalloff, suctionReachFor, wrapAngle, yawOf } from './common';
import { hazardRegistry, type HazardDef } from './index';
import { RoboVac9000 } from './robovac';

const _debris: Debris[] = [];
/** Moon collision disc as a fraction of its size (the Bunny's Debris collision uses 0.85). */
const MOON_DISC = 0.9;

/** True if `d` is a Moon of type `typeId` that the Bunny can't absorb yet (it blocks and stuns the Sweeper). */
export function isBlockingMoon(run: Run, d: Debris, typeId = ORBITAL_SWEEPER.moon.typeId): boolean {
  return d.alive && d.type.id === typeId && !canAbsorb(run.bunny.radius, run.bunny.stats.get('absorbRatio'), d.size);
}

/** The first blocking Moon whose disc is within `slack` of a disc at (x, z) of `radius`, or null. */
export function blockingMoonAt(run: Run, x: number, z: number, radius: number, slack = 0, typeId = ORBITAL_SWEEPER.moon.typeId): Debris | null {
  _debris.length = 0;
  run.debris.queryOverlapping(x, z, radius + slack, _debris);
  for (const d of _debris) {
    if (isBlockingMoon(run, d, typeId) && Math.hypot(d.x - x, d.z - z) < radius + d.size * MOON_DISC + slack) return d;
  }
  return null;
}

export class OrbitalSweeper extends RoboVac9000 {
  private readonly sweep: OrbitalSweeperTuning;
  private moonTimer = 0;
  private moonPlaced = false;
  /** Moons it has swung round so far, and charges the Moon has stopped. */
  moons = 0;
  moonStuns = 0;

  constructor(id: number, def: HazardDef, x: number, z: number, rng: Rng, cfg: OrbitalSweeperTuning = ORBITAL_SWEEPER) {
    super(id, def, x, z, rng, cfg);
    this.sweep = cfg;
  }

  /** Model-unit lengths (NetTuning) to world units: full-size model scale × `scale` (1: hits don't shrink it). */
  private get k(): number {
    return (this.cfg.size / this.cfg.modelSize) * this.scale;
  }

  /** The net tip on the floor plane. */
  get netTip(): { x: number; z: number } {
    const f = this.sweep.net.front * this.k;
    return { x: this.x + Math.sin(this.yaw) * f, z: this.z + Math.cos(this.yaw) * f };
  }

  protected override tick(dt: number, run: Run): void {
    super.tick(dt, run);
    const radius = this.cfg.contactRadius * this.scale;
    // A Moon blocks it like an obstacle (the charge is stopped in chargeBlocked).
    if (this.state !== 'charge') this.pushOutOfMoon(run, radius);
    if (this.state === 'hunt') {
      this.pullNet(dt, run);
      this.moonTimer -= dt;
      if (!this.moonPlaced || this.moonTimer <= 0) {
        this.keepMoon(run, !this.moonPlaced);
        this.moonPlaced = true;
        this.moonTimer = this.sweep.moon.interval;
      }
    }
    // Wings flap a little (the model allows ±10° about Z).
    const wings = this.model.getObjectByName('wings');
    if (wings) wings.rotation.z = Math.sin(this.time * 1.3) * (this.state === 'stunned' ? 0.17 : 0.08);
  }

  /** The capture net: pulls a Bunny ahead of it towards the net tip. */
  private pullNet(dt: number, run: Run): void {
    const n = this.sweep.net;
    const b = run.bunny;
    if (bunnySheltered(run, this.cfg.height)) return;
    if (Math.abs(wrapAngle(yawOf(b.x - this.x, b.z - this.z) - this.yaw)) > n.halfAngle) return;
    const tip = this.netTip;
    const reach = suctionReachFor(n.reach * this.k, b.stats.get('suctionMultiplier'));
    const falloff = suctionFalloff(Math.hypot(b.x - tip.x, b.z - tip.z) - b.radius, 0, reach);
    applySuction(run, tip.x, tip.z, n.strength, falloff, dt);
  }

  /** Moves it out of a blocking Moon it overlaps, to just touching. True if there was one. */
  private pushOutOfMoon(run: Run, radius: number): boolean {
    const d = blockingMoonAt(run, this.x, this.z, radius);
    if (!d) return false;
    const dx = this.x - d.x;
    const dz = this.z - d.z;
    const dist = Math.hypot(dx, dz);
    const nx = dist > 1e-6 ? dx / dist : -Math.sin(this.yaw);
    const nz = dist > 1e-6 ? dz / dist : -Math.cos(this.yaw);
    const touch = radius + d.size * MOON_DISC;
    this.x = d.x + nx * touch;
    this.z = d.z + nz * touch;
    return true;
  }

  /** A charge that runs into a Moon the Bunny can't absorb stops against it. */
  protected override chargeBlocked(run: Run, radius: number): boolean {
    return this.pushOutOfMoon(run, radius);
  }

  /** Only the Moon stuns it: the poles (the map bounds) just end the charge. */
  protected override crashStuns(run: Run, radius: number): boolean {
    return blockingMoonAt(run, this.x, this.z, radius, Math.max(0.05, radius * 0.02)) !== null;
  }

  protected override onCrashStun(_run: Run): void {
    this.moonStuns++;
  }

  /**
   * Makes sure a Moon the Bunny can't absorb is within `moon.range` of the Bunny: if none is, one
   * lands `gap` beyond the Bunny's edge (towards the Sweeper on `first`, else at a random bearing),
   * clear of the Sweeper. False if there was no need, no `moon` type or no room.
   */
  keepMoon(run: Run, first = false): boolean {
    const m = this.sweep.moon;
    const index = run.debris.types.findIndex((t) => t.id === m.typeId);
    if (index < 0) return false;
    const b = run.bunny;
    _debris.length = 0;
    run.debris.query(b.x, b.z, m.range, _debris);
    if (_debris.some((d) => isBlockingMoon(run, d, m.typeId))) return false;
    const type = run.debris.types[index]!;
    const size = Math.max(type.size, b.radius * b.stats.get('absorbRatio') * m.margin);
    const dist = b.radius + m.gap + size;
    const clear = this.cfg.contactRadius * this.scale + size + 1;
    const base = first ? Math.atan2(this.z - b.z, this.x - b.x) : this.rng.range(0, Math.PI * 2);
    for (let i = 0; i < 12; i++) {
      // Alternate either side of the preferred bearing, widening.
      const a = base + (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 6);
      const x = b.x + Math.cos(a) * dist;
      const z = b.z + Math.sin(a) * dist;
      if (Math.hypot(x - this.x, z - this.z) < clear || !isFloorFree(run.house, x, z, size)) continue;
      if (!run.debris.spawn(index, x, z, this.rng, { size })) return false;
      this.moons++;
      return true;
    }
    return false;
  }
}

export const orbitalSweeperDef = hazardRegistry.register({
  id: 'orbital_sweeper',
  name: 'Orbital Sweeper',
  boss: true,
  // Full-size contact radius (hits never shrink it).
  footprint: { radius: ORBITAL_SWEEPER.contactRadius, height: ORBITAL_SWEEPER.height },
  mass: ORBITAL_SWEEPER.mass,
  modelId: ORBITAL_SWEEPER.modelId,
  create(_run, x, z, id, rng: Rng) {
    return new OrbitalSweeper(id, this, x, z, rng, ORBITAL_SWEEPER);
  },
});
