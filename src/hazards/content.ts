/**
 * Hazard content. Importing this module registers every Hazard (and its procedural model): each
 * behaviour file registers its house, neighborhood, city, region, continent, globe, solar system and galaxy variants
 * (e.g. roomba.ts: Roomba, Robotic Mower, Floor Scrubber, Landfill Compactor, Tornado, Debris-Field
 * Satellite and the boss minis; robovac.ts: every area boss but the Ice Sheet, the Orbital
 * Sweeper and the Sun, which subclass it in iceSheet.ts, orbitalSweeper.ts and theSun.ts; Sagittarius A*
 * reuses the Sun's class in sagittariusA.ts).
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
import './roomba';
import './sprayBottle';
import './uprightVacuum';
