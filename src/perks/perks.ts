/**
 * The twelve design Perks. Numbers live in src/data/perks.ts. Stat Perks add one modifier per
 * stack (source `perk:<id>`); Second Wind, Regrowth and Spiky Dash use the combat hooks in
 * ./combat.ts (bunny.revives, run.perkStacks('regrowth'), bunny.spikyDash).
 */
import { PERK_EFFECTS as FX, PERKS, type PerkData } from '../data/perks';
import type { StatKey } from '../entities/stats';
import type { Run } from '../game/run';
import { perkRegistry, type PerkDef } from './index';
import { LINT_PERK_DEFS } from './lint';
import { TUMBLE_PERK_DEFS } from './tumble';
import { ZAP_PERK_DEFS } from './zap';

const stat =
  (id: string, key: StatKey, op: 'add' | 'mul', value: number) =>
  (run: Run): void => {
    run.bunny.stats.add({ stat: key, op, value, source: `perk:${id}` });
  };

const def = (data: PerkData, apply: (run: Run, stacks: number) => void, capStats?: readonly StatKey[]): PerkDef => ({ ...data, apply, ...(capStats ? { capStats } : {}) });

/** A Perk that only adds one stat modifier per stack (hidden from the draft once that stat is at cap). */
const statPerk = (data: PerkData, key: StatKey, op: 'add' | 'mul', value: number): PerkDef => def(data, stat(data.id, key, op, value), [key]);

export const PERK_DEFS: PerkDef[] = [
  // Thick Fur also heals, so it stays on offer at the heart cap.
  def(PERKS.thick_fur, (run) => {
    stat('thick_fur', 'maxHealth', 'add', FX.thickFurHealth)(run);
    run.bunny.heal(FX.thickFurHealth);
  }),
  statPerk(PERKS.aerodynamic, 'speed', 'mul', FX.aerodynamicSpeed),
  statPerk(PERKS.sticky_fibers, 'absorbRatio', 'add', FX.stickyFibersRatio),
  statPerk(PERKS.static_field, 'magnetRadius', 'add', FX.staticFieldMagnet),
  def(PERKS.second_wind, (run) => {
    run.bunny.revives++;
  }),
  statPerk(PERKS.quick_dash, 'dashCooldown', 'mul', FX.quickDashCooldown),
  statPerk(PERKS.hoarder, 'pickupDuration', 'add', FX.hoarderDuration),
  statPerk(PERKS.slippery, 'dodgeChance', 'add', FX.slipperyDodge),
  statPerk(PERKS.glutton, 'growthMultiplier', 'mul', FX.gluttonGrowth),
  statPerk(PERKS.lucky_find, 'pickupLuck', 'add', FX.luckyFindLuck),
  // Regrowth heals from CombatSystem, reading run.perkStacks('regrowth').
  def(PERKS.regrowth, () => {}),
  def(PERKS.spiky_dash, (run) => {
    run.bunny.spikyDash = true;
  }),
];

/** Character Perks (drafted only by their Character): ./lint.ts, ./tumble.ts, ./zap.ts. */
export const CHARACTER_PERK_DEFS: PerkDef[] = [...LINT_PERK_DEFS, ...TUMBLE_PERK_DEFS, ...ZAP_PERK_DEFS];

export function registerPerks(): void {
  for (const d of [...PERK_DEFS, ...CHARACTER_PERK_DEFS]) perkRegistry.register(d);
}
