/**
 * Hazard content. Importing this module registers every Hazard (and its procedural model): each
 * behaviour file registers its house, neighborhood, city, region, continent, globe, solar system, galaxy and universe variants
 * (e.g. roomba.ts: Roomba, Robotic Mower, Floor Scrubber, Landfill Compactor, Tornado, Debris-Field
 * Satellite and the boss minis; robovac.ts: every area boss but the Ice Sheet, the Orbital
 * Sweeper, the Sun and Sagittarius A*, which subclass it in iceSheet.ts, orbitalSweeper.ts,
 * theSun.ts and sagittariusA.ts; the Galaxy's turret, the Pulsar, has its own beam class in pulsar.ts
 * and the Universe's, the Gamma-ray burst, in gammaRayBurst.ts; the Expansion is its own state
 * machine in theExpansion.ts, not a body).
 * Headless-safe; imported by the Run assembly (src/game/assembly.ts).
 */
import './broom';
import './lintRoller';
import './mop';
import './robovac';
import './iceSheet';
import './orbitalSweeper';
import './theSun';
import './sagittariusA';
import './theExpansion';
import './roomba';
import './sprayBottle';
import './pulsar';
import './gammaRayBurst';
import './uprightVacuum';
