/** Upgrade cost curve and conversion of owned Upgrade levels into Run stat modifiers. */
import { getUpgrade, UPGRADES, type UpgradeData } from '../data/upgrades';
import type { StatModifier } from '../entities/stats';

export type UpgradeLevels = Readonly<Record<string, number>>;

/** Fluff cost to buy the next level, or null when maxed. */
export function upgradeCost(u: UpgradeData, currentLevel: number): number | null {
  if (currentLevel >= u.maxLevel) return null;
  return Math.max(5, Math.round((u.baseCost * u.costGrowth ** currentLevel) / 5) * 5);
}

export function levelOf(levels: UpgradeLevels, id: string): number {
  const u = getUpgrade(id);
  if (!u) return 0;
  const n = Math.floor(levels[id] ?? 0);
  return Math.max(0, Math.min(u.maxLevel, Number.isFinite(n) ? n : 0));
}

/** Permanent modifiers for game.nextRunConfig.modifiers (source `upgrade:<id>`). */
export function upgradeModifiers(levels: UpgradeLevels): StatModifier[] {
  const out: StatModifier[] = [];
  for (const u of UPGRADES) {
    const lvl = levelOf(levels, u.id);
    if (lvl <= 0) continue;
    out.push({
      stat: u.stat,
      op: u.op,
      value: u.op === 'add' ? u.perLevel * lvl : 1 + u.perLevel * lvl,
      source: `upgrade:${u.id}`,
    });
  }
  return out;
}
