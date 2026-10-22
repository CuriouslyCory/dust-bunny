/**
 * Hazard content. Importing this module registers every Hazard (and its procedural model): each
 * behaviour file registers its house, neighborhood, city and region variants (e.g. roomba.ts: Roomba,
 * Robotic Mower, Floor Scrubber, Landfill Compactor and the boss minis; robovac.ts: every area boss).
 * Headless-safe; imported by the Run assembly (src/game/assembly.ts).
 */
import './broom';
import './lintRoller';
import './mop';
import './robovac';
import './roomba';
import './sprayBottle';
import './uprightVacuum';
