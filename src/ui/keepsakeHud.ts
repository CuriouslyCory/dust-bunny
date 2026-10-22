/**
 * The Keepsake reward moment (browser only): on `keepsakesDropped`, fibre particles in the grade's
 * colour stream into the Bunny, a narrator caption plays, and a `good` banner names the Keepsake
 * ("Thick Clog · Brush Tangle", "Tangled into Lint's fur"). The banner waits for the area-cleared
 * banner that `exitOpened` shows at the same moment. A first kill's banner says a choice waits
 * on the results screen; the Run is never paused.
 */
import { Color } from 'three';
import { getCharacter } from '../data/characters';
import { getGrade, keepsakeLabel } from '../data/keepsakes';
import type { Game } from '../game/game';
import { dropCaption } from '../meta/keepsakes';
import { narrate } from './keepsakeUi';

/** Seconds the area-cleared banner (src/ui/areaHud.ts) stays up before ours replaces it. */
const BANNER_DELAY = 3.7;
const WHITE = new Color(1, 1, 1);

export function installKeepsakeHud(game: Game): void {
  const color = new Color();
  game.events.on('keepsakesDropped', (e) => {
    const run = game.run;
    if (!run) return;
    const grade = getGrade(e.grade);
    narrate(game, dropCaption(e.bossId, grade.bossName, grade.material));

    // Fibres tangle into the Bunny over about a second.
    color.set(grade.color).lerp(WHITE, 0.35); // lighter, so the fibres read on dark floors
    for (let i = 0; i < 6; i++) {
      window.setTimeout(() => {
        if (game.run !== run || !game.view) return;
        const b = run.bunny;
        game.view.puffs.emitInward(b.x, b.radius, b.z, 16, b.radius * 0.9, b.radius * 2.8, color, 1.4);
      }, i * 140);
    }

    const name = getCharacter(e.characterId).name;
    const title = e.firstKill ? `New Keepsake · ${grade.material}` : e.drops.map((d) => keepsakeLabel(d.ref)).join(' + ');
    const subtitle = e.firstKill ? `Tangled into ${name}'s fur · choose its type on the results screen` : `Tangled into ${name}'s fur`;
    window.setTimeout(() => {
      // The Run may have ended (the City boss wins it): the results screen lists the drop instead.
      if (game.run !== run || run.ended) return;
      game.hud.banner(title, { subtitle, variant: 'good', duration: 3.4 });
    }, BANNER_DELAY * 1000);
  });
}
