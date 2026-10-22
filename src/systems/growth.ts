/** Watches the Bunny radius; per Tier crossed it queues a Perk draft, then emits tierUp. */
import { getTier, tierForRadius } from '../data/tiers';
import { SYSTEM_ORDER, type System } from '../game/system';

export const growthSystem: System = {
  id: 'growth',
  order: SYSTEM_ORDER.growth,
  update(_dt, run) {
    const target = tierForRadius(run.bunny.realRadius).index;
    while (run.tier < target) {
      const previousTier = run.tier;
      run.tier++;
      run.tierTimes[run.tier] ??= run.time;
      // Before tierUp, so every listener (the draft screen, the balance bot) sees the draft.
      run.perkDraft.queue();
      run.events.emit('tierUp', { tier: run.tier, previousTier, tierName: getTier(run.tier).name });
    }
  },
};
