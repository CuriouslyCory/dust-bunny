/**
 * The twelve design Perks. Numbers live in src/data/perks.ts. Stat Perks add one modifier per
 * stack (source `perk:<id>`); Second Wind, Regrowth and Spiky Dash use the combat hooks in
 * ./combat.ts (bunny.revives, run.perkStacks('regrowth'), bunny.spikyDash).
 */
import { PERK_EFFECTS as FX, PERKS, type PerkData } from '../data/perks';
import type { StatKey } from '../entities/stats';
import type { Run } from '../game/run';
import { perkRegistry, type PerkDef } from './index';

const stat =
  (id: string, key: StatKey, op: 'add' | 'mul', value: number) =>
  (run: Run): void => {
    run.bunny.stats.add({ stat: key, op, value, source: `perk:${id}` });
  };

const def = (data: PerkData, apply: (run: Run, stacks: number) => void): PerkDef => ({ ...data, apply });

export const PERK_DEFS: PerkDef[] = [
  def(PERKS.thick_fur, (run) => {
    stat('thick_fur', 'maxHealth', 'add', FX.thickFurHealth)(run);
    run.bunny.heal(FX.thickFurHealth);
  }),
  def(PERKS.aerodynamic, stat('aerodynamic', 'speed', 'mul', FX.aerodynamicSpeed)),
  def(PERKS.sticky_fibers, stat('sticky_fibers', 'absorbRatio', 'add', FX.stickyFibersRatio)),
  def(PERKS.static_field, stat('static_field', 'magnetRadius', 'add', FX.staticFieldMagnet)),
  def(PERKS.second_wind, (run) => {
    run.bunny.revives++;
  }),
  def(PERKS.quick_dash, stat('quick_dash', 'dashCooldown', 'mul', FX.quickDashCooldown)),
  def(PERKS.hoarder, stat('hoarder', 'pickupDuration', 'add', FX.hoarderDuration)),
  def(PERKS.slippery, stat('slippery', 'dodgeChance', 'add', FX.slipperyDodge)),
  def(PERKS.glutton, stat('glutton', 'growthMultiplier', 'mul', FX.gluttonGrowth)),
  def(PERKS.lucky_find, stat('lucky_find', 'pickupLuck', 'add', FX.luckyFindLuck)),
  // Regrowth heals from CombatSystem, reading run.perkStacks('regrowth').
  def(PERKS.regrowth, () => {}),
  def(PERKS.spiky_dash, (run) => {
    run.bunny.spikyDash = true;
  }),
];

export function registerPerks(): void {
  for (const d of PERK_DEFS) perkRegistry.register(d);
}
