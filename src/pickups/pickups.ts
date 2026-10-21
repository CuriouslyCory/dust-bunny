/**
 * The six design Pickups. Numbers live in src/data/pickups.ts.
 * Timed stat effects use StatBlock timed modifiers (source `pickup:<id>`); re-collecting
 * refreshes them because PickupManager calls undo() (removeSource) before re-applying.
 */
import { PICKUP_EFFECTS as FX, PICKUPS, type PickupData } from '../data/pickups';
import type { StatKey } from '../entities/stats';
import { pickupRegistry, type PickupDef } from './index';
import { createPickupObject } from './view';

const src = (id: string) => `pickup:${id}`;

function def(data: PickupData, apply: PickupDef['apply']): PickupDef {
  return {
    ...data,
    apply,
    createObject: (radius) => createPickupObject(data.color, data.icon, radius),
  };
}

function timedStat(id: string, stat: StatKey, op: 'add' | 'mul', value: number): PickupDef['apply'] {
  return (run, duration) => {
    const stats = run.bunny.stats;
    stats.removeSource(src(id));
    stats.add({ stat, op, value, source: src(id), duration });
    return () => stats.removeSource(src(id));
  };
}

export const PICKUP_DEFS: PickupDef[] = [
  def(PICKUPS.static_charge, timedStat('static_charge', 'magnetRadius', 'add', FX.staticChargeMagnet)),
  def(PICKUPS.sugar_rush, timedStat('sugar_rush', 'speed', 'mul', FX.sugarRushSpeed)),
  def(PICKUPS.glue_dab, timedStat('glue_dab', 'growthMultiplier', 'mul', FX.glueDabGrowth)),
  def(PICKUPS.bubble_wrap, (run) => {
    run.bunny.shield = Math.min(FX.bubbleWrapMaxStacks, run.bunny.shield + 1);
  }),
  def(PICKUPS.crumb_cake, (run) => {
    run.bunny.heal(FX.crumbCakeHeal);
  }),
  def(PICKUPS.dust_cloud, (run) => {
    run.bunny.hiddenFromHazards = true;
    return () => {
      run.bunny.hiddenFromHazards = false;
    };
  }),
];

export function registerPickups(): void {
  for (const d of PICKUP_DEFS) pickupRegistry.register(d);
}
