/**
 * Globe Hazards (Act 6, Tiers 14–15, Globe units: 1 = 1,000 km). PLACEHOLDER: each reuses a
 * Continent behaviour and tuning (the Globe is "start at ~1, grow to ~3" like the Continent, so the
 * numbers carry over unit for unit) until the Globe's own tuning, models and boss land.
 */
import { GLACIER_TONGUE, HURRICANE, ICE_SHEET, RIVER_SURGE, TORNADO, VOLCANO } from '../data/hazards';
import { IceSheet } from './iceSheet';
import { hazardRegistry, tuningFootprint } from './index';
import { LintRoller } from './lintRoller';
import { Mop } from './mop';
import { Roomba } from './roomba';
import { SprayBottle } from './sprayBottle';
import { UprightVacuum } from './uprightVacuum';

export const debrisSatelliteDef = hazardRegistry.register({
  id: 'debris_satellite',
  name: 'Debris-Field Satellite',
  footprint: tuningFootprint(TORNADO),
  mass: TORNADO.mass,
  modelId: TORNADO.modelId,
  create(_run, x, z, id, rng) {
    return new Roomba(id, this, x, z, rng, TORNADO);
  },
});

export const spaceStationDef = hazardRegistry.register({
  id: 'space_station',
  name: 'Space Station',
  footprint: tuningFootprint(GLACIER_TONGUE),
  mass: GLACIER_TONGUE.mass,
  modelId: GLACIER_TONGUE.modelId,
  create(run, x, z, id, rng) {
    return new LintRoller(id, this, run, x, z, rng, GLACIER_TONGUE);
  },
});

export const asatLaserDef = hazardRegistry.register({
  id: 'asat_laser',
  name: 'Anti-Satellite Laser',
  footprint: tuningFootprint(VOLCANO),
  mass: VOLCANO.mass,
  modelId: VOLCANO.modelId,
  create(_run, x, z, id, rng) {
    return new SprayBottle(id, this, x, z, rng, VOLCANO);
  },
});

export const reentryBurnDef = hazardRegistry.register({
  id: 'reentry_burn',
  name: 'Re-entry Burn',
  footprint: tuningFootprint(RIVER_SURGE),
  mass: RIVER_SURGE.mass,
  modelId: RIVER_SURGE.modelId,
  create(run, x, z, id, rng) {
    return new Mop(id, this, run, x, z, rng, RIVER_SURGE);
  },
});

export const globeHurricaneDef = hazardRegistry.register({
  id: 'globe_hurricane',
  name: 'Hurricane',
  footprint: tuningFootprint(HURRICANE),
  mass: HURRICANE.mass,
  modelId: HURRICANE.modelId,
  create(_run, x, z, id, rng) {
    return new UprightVacuum(id, this, x, z, rng, HURRICANE);
  },
});

export const orbitalSweeperDef = hazardRegistry.register({
  id: 'orbital_sweeper',
  name: 'Orbital Sweeper',
  boss: true,
  footprint: { radius: ICE_SHEET.contactRadius, height: ICE_SHEET.height },
  mass: ICE_SHEET.mass,
  modelId: ICE_SHEET.modelId,
  create(_run, x, z, id, rng) {
    return new IceSheet(id, this, x, z, rng, ICE_SHEET);
  },
});
