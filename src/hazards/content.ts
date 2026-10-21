/**
 * Hazard content. Importing this module registers every Hazard (and its procedural model): each
 * behaviour file registers its house, neighborhood and city variants (e.g. roomba.ts: Roomba,
 * Robotic Mower, Floor Scrubber and the boss minis; robovac.ts: all three area bosses).
 * Headless-safe; imported by the Run assembly (src/game/assembly.ts).
 */
import './broom';
import './lintRoller';
import './mop';
import './robovac';
import './roomba';
import './sprayBottle';
import './uprightVacuum';
