/**
 * Roomba: wanders, bounces off walls and furniture, turns at random, and pulls the Bunny in
 * with suction (a faint ring on the floor shows the reach). Contact: 1 damage + knockback.
 * The boss's mini Roombas reuse this with MINI_ROOMBA tuning; outdoors the Robotic Mower
 * (ROBO_MOWER, weak blade pull) and the Street Sweeper's mini mowers (MINI_MOWER) do too, and in
 * the city the Floor Scrubber (FLOOR_SCRUBBER, weak scrub-brush pull, spins `brush`) and the
 * Garbage Truck's mini scrubbers (MINI_SCRUBBER); in the region the Landfill Compactor
 * (LANDFILL_COMPACTOR, packer-wheel pull, spins its roof `beacon`) and the Incinerator's mini
 * compactors (MINI_COMPACTOR); in the continent the Tornado (TORNADO: erratic turns, a wide vortex
 * pull, spins its `funnel`); on the Globe the Debris-Field Satellite (DEBRIS_SATELLITE: tumbling
 * turns, a debris-field pull, spins its `panels`) and the Orbital Sweeper's Kessler swarm of mini
 * sweepers (MINI_SWEEPER); in the Solar System the Rogue Asteroid (ROGUE_ASTEROID: tumbling turns,
 * a gravity pull, spins its `rock`); in the Galaxy the Black Hole (BLACK_HOLE: slow drifting turns,
 * a strong long pull, spins its accretion `disk`), whose pull also drags loose Debris into a spiral
 * and swallows it (`debrisPull`), rings flowing inward across the pull on the floor; in the
 * Universe the Quasar (QUASAR: the strongest pull, a cyan ring, drags Debris round without eating
 * it, spins its `disk` and pulses its `jets`, `pulseNode`).
 *
 * Its suction also drags Lint's Decoy in (touching the Decoy clogs it), and a Lure with a
 * `wanderRange` (Keepsake effect) makes it home in on the Decoy.
 */
import type { Rng } from '../core/rng';
import { QUASAR, BLACK_HOLE, DEBRIS_SATELLITE, ROGUE_ASTEROID, FLOOR_SCRUBBER, HAZARD_RECOIL, LANDFILL_COMPACTOR, MINI_COMPACTOR, MINI_MOWER, MINI_ROOMBA, MINI_SCRUBBER, MINI_SWEEPER, ROBO_MOWER, ROOMBA, TORNADO, type DebrisPullTuning, type RoombaTuning } from '../data/hazards';
import type { Debris } from '../entities/debris';
import type { Run } from '../game/run';
import { BaseHazard } from './base';
import { maxSpeedFor } from '../systems/movement';
import { activeLure, applySuction, bunnySheltered, hitBunny, moveCircle, pullLure, randomIn, separateFromBunny, suctionFalloff, suctionReachFor, turnTowards, wrapAngle, yawOf } from './common';
import { isFloorFree } from '../systems/spawner';
import { DECAL_COLORS, ringDecal, type Decal } from './decals';
import { hazardRegistry, tuningFootprint, type HazardDef } from './index';

const _debris: Debris[] = [];

export class Roomba extends BaseHazard {
  private turnTimer: number;
  private readonly suctionRing;
  /** Inward-flowing rings over the Debris pull (the Black Hole). */
  private readonly flowRings: Decal[] = [];
  /** Debris swallowed (the Black Hole's `debrisPull.eat`). */
  swallowed = 0;

  constructor(
    id: number,
    def: HazardDef,
    x: number,
    z: number,
    private readonly rng: Rng,
    private readonly cfg: RoombaTuning,
  ) {
    super(id, def, x, z, cfg.size, cfg.modelId);
    this.recoilHeight = this.cfg.height;
    this.model.scale.setScalar(cfg.size / cfg.modelSize);
    this.yaw = rng.range(-Math.PI, Math.PI);
    this.turnTimer = randomIn(rng, cfg.turnInterval);
    this.suctionRing = this.addDecal(ringDecal(0.97, 1, cfg.ringColor ?? DECAL_COLORS.suction, 0.35, 64));
    if (cfg.debrisPull) for (let i = 0; i < 2; i++) this.flowRings.push(this.addDecal(ringDecal(0.94, 1, '#d9c8ff', 0.3, 64)));
  }

  /** Random turns every few seconds. */
  private steer(dt: number): void {
    this.turnTimer -= dt;
    if (this.turnTimer <= 0) {
      this.turnTimer = randomIn(this.rng, this.cfg.turnInterval);
      this.yaw = wrapAngle(this.yaw + this.rng.range(-this.cfg.turnAngle, this.cfg.turnAngle));
    }
  }

  protected tick(dt: number, run: Run): void {
    this.steer(dt);
    const lure = activeLure(run);
    if (lure && lure.wanderRange > 0 && Math.hypot(lure.x - this.x, lure.z - this.z) < lure.wanderRange) {
      this.yaw = turnTowards(this.yaw, yawOf(lure.x - this.x, lure.z - this.z), 3 * dt);
    }
    const speed = this.tierSpeed(run, this.cfg.speed);
    const m = moveCircle(run.house, this.x, this.z, this.size, this.cfg.height, Math.sin(this.yaw) * speed * dt, Math.cos(this.yaw) * speed * dt);
    this.x = m.x;
    this.z = m.z;
    if (m.hit) {
      // Reflect the heading about the collision normal, with a little jitter.
      const n = Math.hypot(m.nx, m.nz) || 1;
      const nx = m.nx / n;
      const nz = m.nz / n;
      let dx = Math.sin(this.yaw);
      let dz = Math.cos(this.yaw);
      const dot = dx * nx + dz * nz;
      if (dot < 0) {
        dx -= 2 * dot * nx;
        dz -= 2 * dot * nz;
      }
      this.yaw = wrapAngle(Math.atan2(dx, dz) + this.rng.range(-0.5, 0.5));
      this.turnTimer = randomIn(this.rng, this.cfg.turnInterval);
    }
    this.spin(this.cfg.spinNode, dt * this.cfg.spinRate);
    if (this.cfg.pulseNode) this.pulse(this.cfg.pulseNode);

    // Suction towards the Roomba centre.
    const b = run.bunny;
    const reach = this.size + suctionReachFor(this.cfg.suctionReach, b.stats.get('suctionMultiplier'));
    const dist = Math.hypot(b.x - this.x, b.z - this.z);
    if (dist < reach + b.radius && !bunnySheltered(run, this.cfg.height)) {
      applySuction(run, this.x, this.z, this.cfg.suctionStrength, suctionFalloff(dist - b.radius, this.size, reach), dt);
    }
    if (lure) {
      const falloff = suctionFalloff(Math.hypot(lure.x - this.x, lure.z - this.z) - lure.radius, this.size, this.size + this.cfg.suctionReach);
      if (falloff > 0) pullLure(run, this.x, this.z, maxSpeedFor(b) * this.cfg.suctionStrength * falloff, dt);
    }
    this.suctionRing.place(this.x, this.z);
    this.suctionRing.root.scale.set(reach, 1, reach);
    this.suctionRing.setOpacity(0.18 + 0.12 * Math.sin(this.time * 6));
    if (this.cfg.debrisPull) this.pullDebris(dt, run, this.cfg.debrisPull, reach);
  }

  /** Pulses a model node (the Quasar's `jets`): along Y, or every axis. */
  private pulse(name: string): void {
    const node = this.model.getObjectByName(name);
    if (!node) return;
    const c = this.cfg;
    const k = 1 + (c.pulseAmount ?? 0.15) * Math.sin(this.time * (c.pulseRate ?? 6));
    if (c.pulseAxis === 'y') node.scale.set(1, k, 1);
    else node.scale.setScalar(k);
  }

  /**
   * The Black Hole's pull on loose Debris (`debrisPull`): small Debris near it spirals in and,
   * with `eat`, is swallowed at its middle. Rings flow inward across the pull on the floor.
   */
  private pullDebris(dt: number, run: Run, p: DebrisPullTuning, reach: number): void {
    _debris.length = 0;
    run.debris.query(this.x, this.z, this.size + p.reach + p.maxSize, _debris);
    for (const d of _debris) {
      if (!d.alive || d.size > p.maxSize) continue;
      const dx = this.x - d.x;
      const dz = this.z - d.z;
      const dist = Math.hypot(dx, dz) || 1e-6;
      if (p.eat && dist < this.size * 0.35 + d.size * 0.5) {
        run.debris.remove(d);
        this.swallowed++;
        continue;
      }
      const falloff = suctionFalloff(dist - d.size - this.size, 0, p.reach);
      if (falloff <= 0) continue;
      const step = Math.min(dist, p.speed * falloff * dt);
      const nx = d.x + ((dx - dz * p.swirl) / dist) * step;
      const nz = d.z + ((dz + dx * p.swirl) / dist) * step;
      if (isFloorFree(run.house, nx, nz, d.size)) run.debris.move(d, nx, nz);
    }
    // Two rings sliding from the edge of the pull to the hole, half a cycle apart.
    for (let i = 0; i < this.flowRings.length; i++) {
      const ring = this.flowRings[i]!;
      const k = (this.time * 0.7 + i / this.flowRings.length) % 1;
      const r = reach + (this.size - reach) * k;
      ring.place(this.x, this.z);
      ring.root.scale.set(r, 1, r);
      ring.setOpacity(0.35 * Math.sin(k * Math.PI));
    }
  }

  onContact(run: Run): void {
    if (bunnySheltered(run, this.cfg.height)) return;
    if (!this.stunned && this.recoilFor <= 0 && hitBunny(run, this.x, this.z, { damage: this.cfg.damage, source: this.def.id, knockbackCm: this.cfg.knockbackCm, knockbackRadii: this.cfg.knockbackRadii })) {
      // Pause, then drive off the other way instead of pinning the Bunny.
      this.recoilFor = HAZARD_RECOIL;
      this.yaw = yawOf(this.x - run.bunny.x, this.z - run.bunny.z);
    }
    separateFromBunny(run, this, this.size, this.cfg.height);
  }
}

export const roombaDef = hazardRegistry.register({
  id: 'roomba',
  name: 'Roomba',
  footprint: tuningFootprint(ROOMBA),
  mass: ROOMBA.mass,
  modelId: 'roomba',
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, ROOMBA);
  },
});

export const miniRoombaDef = hazardRegistry.register({
  id: 'mini_roomba',
  name: 'Mini Roomba',
  footprint: tuningFootprint(MINI_ROOMBA),
  mass: MINI_ROOMBA.mass,
  modelId: 'roomba',
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, MINI_ROOMBA);
  },
});

export const roboMowerDef = hazardRegistry.register({
  id: 'robo_mower',
  name: 'Robotic Mower',
  footprint: tuningFootprint(ROBO_MOWER),
  mass: ROBO_MOWER.mass,
  modelId: ROBO_MOWER.modelId,
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, ROBO_MOWER);
  },
});

export const miniMowerDef = hazardRegistry.register({
  id: 'mini_mower',
  name: 'Mini Mower',
  footprint: tuningFootprint(MINI_MOWER),
  mass: MINI_MOWER.mass,
  modelId: MINI_MOWER.modelId,
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, MINI_MOWER);
  },
});

export const floorScrubberDef = hazardRegistry.register({
  id: 'floor_scrubber',
  name: 'Floor Scrubber',
  footprint: tuningFootprint(FLOOR_SCRUBBER),
  mass: FLOOR_SCRUBBER.mass,
  modelId: FLOOR_SCRUBBER.modelId,
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, FLOOR_SCRUBBER);
  },
});

export const miniScrubberDef = hazardRegistry.register({
  id: 'mini_scrubber',
  name: 'Mini Scrubber',
  footprint: tuningFootprint(MINI_SCRUBBER),
  mass: MINI_SCRUBBER.mass,
  modelId: MINI_SCRUBBER.modelId,
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, MINI_SCRUBBER);
  },
});

export const landfillCompactorDef = hazardRegistry.register({
  id: 'landfill_compactor',
  name: 'Landfill Compactor',
  footprint: tuningFootprint(LANDFILL_COMPACTOR),
  mass: LANDFILL_COMPACTOR.mass,
  modelId: LANDFILL_COMPACTOR.modelId,
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, LANDFILL_COMPACTOR);
  },
});

export const miniCompactorDef = hazardRegistry.register({
  id: 'mini_compactor',
  name: 'Mini Compactor',
  footprint: tuningFootprint(MINI_COMPACTOR),
  mass: MINI_COMPACTOR.mass,
  modelId: MINI_COMPACTOR.modelId,
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, MINI_COMPACTOR);
  },
});

/** Continent wanderer: a vortex that pulls (TORNADO). */
export const tornadoDef = hazardRegistry.register({
  id: 'tornado',
  name: 'Tornado',
  footprint: tuningFootprint(TORNADO),
  mass: TORNADO.mass,
  modelId: TORNADO.modelId,
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, TORNADO);
  },
});

/** Globe wanderer: a dead satellite tumbling through its debris field, which pulls (DEBRIS_SATELLITE). */
export const debrisSatelliteDef = hazardRegistry.register({
  id: 'debris_satellite',
  name: 'Debris-Field Satellite',
  footprint: tuningFootprint(DEBRIS_SATELLITE),
  mass: DEBRIS_SATELLITE.mass,
  modelId: DEBRIS_SATELLITE.modelId,
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, DEBRIS_SATELLITE);
  },
});

/** The Orbital Sweeper's Kessler swarm (MINI_SWEEPER). */
export const miniSweeperDef = hazardRegistry.register({
  id: 'mini_sweeper',
  name: 'Mini Sweeper',
  footprint: tuningFootprint(MINI_SWEEPER),
  mass: MINI_SWEEPER.mass,
  modelId: MINI_SWEEPER.modelId,
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, MINI_SWEEPER);
  },
});

/** Solar System wanderer: a rogue asteroid whose gravity pulls (ROGUE_ASTEROID). */
export const rogueAsteroidDef = hazardRegistry.register({
  id: 'rogue_asteroid',
  name: 'Rogue Asteroid',
  footprint: tuningFootprint(ROGUE_ASTEROID),
  mass: ROGUE_ASTEROID.mass,
  modelId: ROGUE_ASTEROID.modelId,
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, ROGUE_ASTEROID);
  },
});

/** Galaxy wanderer: a black hole, the real vacuum, with a strong pull (BLACK_HOLE). */
export const blackHoleDef = hazardRegistry.register({
  id: 'black_hole',
  name: 'Black Hole',
  footprint: tuningFootprint(BLACK_HOLE),
  mass: BLACK_HOLE.mass,
  modelId: BLACK_HOLE.modelId,
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, BLACK_HOLE);
  },
});

/** Universe wanderer: a quasar, a feeding black hole with a strong pull that drags loose Debris round it, jets pulsing (QUASAR). */
export const quasarDef = hazardRegistry.register({
  id: 'quasar',
  name: 'Quasar',
  footprint: tuningFootprint(QUASAR),
  mass: QUASAR.mass,
  modelId: QUASAR.modelId,
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, QUASAR);
  },
});
