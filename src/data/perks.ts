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
  /** Character id: only that Character's drafts offer it (a Character Perk). Omit for everyone. */
  character?: string;
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

/**
 * Character Perks: drafted only by their Character, alongside the shared Perks above. Each
 * non-unique one has three stacks. Effects live in src/perks/lint.ts, tumble.ts and zap.ts;
 * numbers in CHARACTER_PERK_EFFECTS below (per-stack arrays are indexed by stacks − 1).
 */
export const CHARACTER_PERKS = {
  // Lint
  well_rounded: { id: 'well_rounded', name: 'Well-Rounded', icon: '🧦', description: "Raises Lint's caps: speed +0.1, +1 heart, magnet +0.25, knockback resistance +0.1", maxStacks: 3, character: 'lint' },
  smother: { id: 'smother', name: 'Smother', icon: '🫧', description: 'Touch a clogged Hazard up to 1.1× your absorb limit to absorb it', unique: true, character: 'lint' },
  loose_threads: { id: 'loose_threads', name: 'Loose Threads', icon: '🪢', description: 'A Hazard drops 1 / 2 / 3 fibre pieces when its clog ends', maxStacks: 3, character: 'lint' },
  lint_trail: { id: 'lint_trail', name: 'Lint Trail', icon: '🌀', description: 'Dashing leaves a 2 s fluff streak that clogs the first Hazard to cross it', maxStacks: 3, character: 'lint' },
  unnoticed: { id: 'unnoticed', name: 'Unnoticed', icon: '👻', description: 'A Hazard ignores you for 1.5 / 2 / 2.5 s after its clog ends', maxStacks: 3, character: 'lint' },
  // Tumble
  snowballing: { id: 'snowballing', name: 'Snowballing', icon: '🛞', description: '+0.1 acceleration (top speed unchanged)', maxStacks: 3, character: 'tumble' },
  matted_coat: { id: 'matted_coat', name: 'Matted Coat', icon: '🧥', description: 'A fur shield blocks one hit and its knockback; recharges after 20 / 15 / 10 s unhurt', maxStacks: 3, character: 'tumble' },
  shedding: { id: 'shedding', name: 'Shedding', icon: '🐾', description: 'Losing a heart drops 2 / 3 / 4 hair clumps, each worth 0.5% of your volume', maxStacks: 3, character: 'tumble' },
  heavy_pull: { id: 'heavy_pull', name: 'Heavy Pull', icon: '🧲', description: 'Magnet +1 / +2 / +3 r while Amassing (within your magnet cap)', maxStacks: 3, character: 'tumble' },
  heavy_landing: { id: 'heavy_landing', name: 'Heavy Landing', icon: '🌋', description: 'Ending a Dash sends a shockwave that stuns Hazards within 1.5 / 2 / 2.5 r', maxStacks: 3, character: 'tumble' },
  // Zap
  emergency_discharge: { id: 'emergency_discharge', name: 'Emergency Discharge', icon: '⚡', description: 'A full meter negates a hit and stuns Hazards within 2 / 3 / 4 r (6 / 5 / 4 s cooldown)', maxStacks: 3, character: 'zap' },
  hyper_charge: { id: 'hyper_charge', name: 'Hyper Charge', icon: '⚡', description: 'Dashing fills the Static meter 3× / 4× / 5× (instead of 2×)', maxStacks: 3, character: 'zap' },
  thunderstruck: { id: 'thunderstruck', name: 'Thunderstruck', icon: '🌩️', description: 'Discharge kills leave a 3 s static patch (1 / 1.5 / 2 r) that stuns Hazards entering it', maxStacks: 3, character: 'zap' },
  recharge_snack: { id: 'recharge_snack', name: 'Recharge Snack', icon: '🍬', description: 'Discharge scrap refunds 4 / 7 / 10% of the meter per piece (up to 50%)', maxStacks: 3, character: 'zap' },
  capacitor: { id: 'capacitor', name: 'Capacitor', icon: '🔋', description: 'The meter only drains after 2 / 3 / 4 s below 20% speed', maxStacks: 3, character: 'zap' },
} satisfies Record<string, PerkData>;

/** Character Perk numbers. Ranges and sizes are in Bunny radii (r); per-stack arrays are indexed by stacks − 1. */
export const CHARACTER_PERK_EFFECTS = {
  /** Well-Rounded: added to Lint's caps per stack (it grants none of these stats). */
  wellRoundedCaps: { speed: 0.1, maxHealth: 1, magnetRadius: 0.25, knockbackResistance: 0.1 },
  /** Smother: a clogged non-boss Hazard up to this × Lint's absorb limit is absorbed on touch. */
  smotherRatio: 1.1,
  /** Loose Threads: fibre pieces a Hazard drops when its clog ends. */
  looseThreadsPieces: [1, 2, 3],
  /** Lint Trail: seconds the streak lasts, and the clog it gives (s). */
  lintTrailDuration: 2,
  lintTrailClog: [0.6, 0.8, 1.0],
  /** Unnoticed: seconds a Hazard ignores Lint after its clog ends. */
  unnoticedFor: [1.5, 2.0, 2.5],
  /** Snowballing: acceleration added per stack. */
  snowballingAccel: 0.1,
  /** Matted Coat: seconds without damage to recharge the fur shield. */
  mattedCoatRecharge: [20, 15, 10],
  /** Shedding: hair clumps dropped per heart lost, each worth this fraction of the Bunny's volume. */
  sheddingPieces: [2, 3, 4],
  sheddingVolume: 0.005,
  /** Heavy Pull: magnet radius added while Amassing (r), below the cap stage. */
  heavyPullMagnet: [1, 2, 3],
  /** Heavy Landing: shockwave reach from Tumble's surface (r) and stun (s) on non-boss Hazards. */
  heavyLandingRadius: [1.5, 2.0, 2.5],
  heavyLandingStun: [0.6, 0.8, 1.0],
  /** Emergency Discharge: stun reach (r), stun (s; bosses get bossStunShare of it) and internal cooldown (s). */
  emergencyRadius: [2, 3, 4],
  emergencyStun: 1,
  emergencyBossStunShare: 0.5,
  emergencyCooldown: [6, 5, 4],
  /** Hyper Charge: the Discharge dash multiplier (base 2). */
  hyperChargeDash: [3, 4, 5],
  /** Thunderstruck: patch lifetime (s), radius (r) and the once-per-patch stun (s). */
  thunderstruckDuration: 3,
  thunderstruckRadius: [1, 1.5, 2],
  thunderstruckStun: 0.8,
  /** Recharge Snack: meter refunded per Discharge scrap piece absorbed, capped per Discharge. */
  rechargeSnackRefund: [0.04, 0.07, 0.1],
  rechargeSnackCap: 0.5,
  /** Capacitor: seconds below drainSpeedFraction of max speed before the meter drains. */
  capacitorDelay: [2, 3, 4],
} as const;

/** A per-stack value: `values[stacks − 1]`, clamped to the array (0 stacks → undefined). */
export function perStack<T>(values: readonly T[], stacks: number): T | undefined {
  if (stacks <= 0 || values.length === 0) return undefined;
  return values[Math.min(values.length, Math.floor(stacks)) - 1];
}

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
