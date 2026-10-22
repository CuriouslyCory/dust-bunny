/**
 * Hazard content. Importing this module registers every Hazard (and its procedural model): each
 * behaviour file registers its house, neighborhood, city, region and continent variants (e.g.
 * roomba.ts: Roomba, Robotic Mower, Floor Scrubber, Landfill Compactor, Tornado and the boss minis;
 * robovac.ts: every area boss but the Ice Sheet, which subclasses it in iceSheet.ts).
 * Headless-safe; imported by the Run assembly (src/game/assembly.ts).
 */
import './broom';
import './lintRoller';
import './mop';
import './robovac';
import './iceSheet';
import './roomba';
import './sprayBottle';
import './uprightVacuum';
