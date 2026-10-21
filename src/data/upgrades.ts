/** Permanent Shop Upgrades (bought with Fluff). Cost of level n+1 = baseCost × costGrowth^n, rounded to 5. */
import type { StatKey } from '../entities/stats';

export interface UpgradeData {
  id: string;
  name: string;
  icon: string;
  description: string;
  maxLevel: number;
  baseCost: number;
  costGrowth: number;
  /** Stat modifier applied per level (value × level for `add`, 1 + perLevel × level for `mul`). */
  stat: StatKey;
  op: 'add' | 'mul';
  perLevel: number;
}

export const UPGRADES: readonly UpgradeData[] = [
  { id: 'extra_heart', name: 'Extra Heart', icon: '❤️', description: '+1 starting heart', maxLevel: 2, baseCost: 80, costGrowth: 2.2, stat: 'maxHealth', op: 'add', perLevel: 1 },
  { id: 'fast_feet', name: 'Fast Feet', icon: '👟', description: '+5% speed', maxLevel: 3, baseCost: 40, costGrowth: 1.8, stat: 'speed', op: 'mul', perLevel: 0.05 },
  { id: 'head_start', name: 'Head Start', icon: '🌱', description: '+10% starting radius', maxLevel: 3, baseCost: 50, costGrowth: 1.8, stat: 'startRadius', op: 'mul', perLevel: 0.1 },
  { id: 'wide_choice', name: 'Wide Choice', icon: '🃏', description: '4 Perk options instead of 3', maxLevel: 1, baseCost: 220, costGrowth: 1, stat: 'perkChoices', op: 'add', perLevel: 1 },
  { id: 'magnetism', name: 'Magnetism', icon: '🧲', description: 'Base magnet pull', maxLevel: 2, baseCost: 70, costGrowth: 2, stat: 'magnetRadius', op: 'add', perLevel: 0.2 },
  { id: 'reroll', name: 'Reroll', icon: '🎲', description: 'One Perk reroll per Run', maxLevel: 1, baseCost: 140, costGrowth: 1, stat: 'perkRerolls', op: 'add', perLevel: 1 },
  { id: 'pickup_luck', name: 'Pickup Luck', icon: '🍀', description: '+35% Pickup spawn rate', maxLevel: 2, baseCost: 60, costGrowth: 2, stat: 'pickupLuck', op: 'add', perLevel: 0.35 },
];

export function getUpgrade(id: string): UpgradeData | undefined {
  return UPGRADES.find((u) => u.id === id);
}
