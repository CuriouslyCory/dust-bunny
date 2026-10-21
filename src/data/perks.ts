/** Perk tuning (run-long upgrades drafted on Tier-up). Effects live in src/perks/perks.ts. */

export interface PerkData {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** Only once per Run. */
  unique?: boolean;
  /** Stack cap for stackable Perks. */
  maxStacks?: number;
  /** Relative draft weight (default 1). */
  weight?: number;
}

export const PERKS = {
  thick_fur: { id: 'thick_fur', name: 'Thick Fur', icon: '🧶', description: '+1 max heart and heal 1', maxStacks: 3 },
  aerodynamic: { id: 'aerodynamic', name: 'Aerodynamic', icon: '💨', description: '+10% speed', maxStacks: 5 },
  sticky_fibers: { id: 'sticky_fibers', name: 'Sticky Fibers', icon: '🕸️', description: 'Absorb Debris 5% bigger (relative to your size)', maxStacks: 3 },
  static_field: { id: 'static_field', name: 'Static Field', icon: '⚡', description: 'Small permanent magnet pull', maxStacks: 3 },
  second_wind: { id: 'second_wind', name: 'Second Wind', icon: '💞', description: 'Revive once with full hearts', unique: true, weight: 0.7 },
  quick_dash: { id: 'quick_dash', name: 'Quick Dash', icon: '⏩', description: '−30% Dash cooldown', maxStacks: 3 },
  hoarder: { id: 'hoarder', name: 'Hoarder', icon: '🎒', description: '+40% Pickup duration', maxStacks: 3 },
  slippery: { id: 'slippery', name: 'Slippery', icon: '🧼', description: '25% chance to dodge damage', maxStacks: 3 },
  glutton: { id: 'glutton', name: 'Glutton', icon: '😋', description: '+15% growth', maxStacks: 5 },
  lucky_find: { id: 'lucky_find', name: 'Lucky Find', icon: '🍀', description: 'Pickups appear 50% more often', maxStacks: 3 },
  regrowth: { id: 'regrowth', name: 'Regrowth', icon: '🌱', description: 'Heal 1 heart every 45 s (faster per stack)', maxStacks: 3 },
  spiky_dash: { id: 'spiky_dash', name: 'Spiky Dash', icon: '🦔', description: 'Dashing into a Hazard stuns it instead of hurting you', unique: true, weight: 0.8 },
} satisfies Record<string, PerkData>;

export const PERK_EFFECTS = {
  thickFurHealth: 1,
  aerodynamicSpeed: 1.1,
  stickyFibersRatio: 0.05,
  staticFieldMagnet: 0.35,
  quickDashCooldown: 0.7,
  hoarderDuration: 0.4,
  slipperyDodge: 0.25,
  gluttonGrowth: 1.15,
  luckyFindLuck: 0.5,
  /** Seconds between Regrowth heals at 1 stack (divided by stacks). */
  regrowthInterval: 45,
  /** Seconds a Spiky Dash stuns a Hazard. */
  spikyStun: 2.5,
};
