/**
 * The Keepsake reward moment (browser only): on `keepsakesDropped`, fibre particles in the best
 * drop's rarity colour stream into the Bunny, then the Run pauses on the Keepsake reveal
 * (src/ui/screens/keepsakeReveal.ts: what was won, the narrator caption, a first kill's choice).
 * The reveal opens REVEAL_DELAY s after the kill, once play is on screen (a Perk draft, chapter card
 * or pause menu goes first), so it comes before the Bunny can roll out of the Area. The area-cleared
 * banner `exitOpened` shows at the same moment is held while the reveal is up (`hud.holdBanner`) and
 * resumes where it was when it closes (the reveal's `exit` releases it).
 */
import { Color } from 'three';
import { bossNameFor, getRarity } from '../data/keepsakes';
import type { Game } from '../game/game';
import { dropCaption, getKeepsakeTracker } from '../meta/keepsakes';
import { narrate } from './keepsakeUi';
import { openKeepsakeReveal } from './screens/keepsakeReveal';

/** Seconds before the reveal: the area-cleared banner (src/ui/areaHud.ts) shows meanwhile. */
const REVEAL_DELAY = 3.7;
/** Seconds between checks while another screen (Perk draft, chapter card, pause) is up. */
const RETRY = 0.25;
const WHITE = new Color(1, 1, 1);

export function installKeepsakeHud(game: Game): void {
  const color = new Color();
  game.events.on('keepsakesDropped', (e) => {
    const run = game.run;
    if (!run) return;
    const rarity = getRarity(e.rarity);

    // Fibres tangle into the Bunny over about a second.
    color.set(rarity.color).lerp(WHITE, 0.35); // lighter, so the fibres read on dark floors
    for (let i = 0; i < 6; i++) {
      window.setTimeout(() => {
        if (game.run !== run || !game.view) return;
        const b = run.bunny;
        game.view.puffs.emitInward(b.x, b.radius, b.z, 16, b.radius * 0.9, b.radius * 2.8, color, 1.4);
      }, i * 140);
    }

    const record = getKeepsakeTracker()?.current;
    const caption = dropCaption(e.bossId, bossNameFor(e.bossId));
    // A Run-winning boss ends the Run in the same event chain: no reveal then, caption at once.
    queueMicrotask(() => {
      if (run.ended) narrate(game, caption);
    });
    const show = (): void => {
      // The Run may have ended (the last boss wins it): the results screen lists the drop instead.
      if (game.run !== run || run.ended || !record) return;
      // The cleared line waits behind the reveal rather than hold it back (released on close).
      game.hud.holdBanner();
      if (!openKeepsakeReveal(game, { run: record, drops: e.drops, firstKill: e.firstKill, caption })) {
        game.hud.releaseBanner();
        window.setTimeout(show, RETRY * 1000);
      }
    };
    window.setTimeout(show, REVEAL_DELAY * 1000);
  });
}
