/** Pickup tuning (temporary floor power-ups). Effects live in src/pickups/pickups.ts. */

export interface PickupData {
  id: string;
  name: string;
  icon: string;
  description: string;
  color: string;
  /** Seconds (omit for instant effects). */
  duration?: number;
  spawnWeight: number;
}

export const PICKUPS = {
  static_charge: {
    id: 'static_charge',
    name: 'Static Charge',
    icon: '🧲',
    description: 'Magnet pull for 10 s',
    color: '#8fd3ff',
    duration: 10,
    spawnWeight: 1,
  },
  sugar_rush: {
    id: 'sugar_rush',
    name: 'Sugar Rush',
    icon: '🍬',
    description: '+50% speed for 8 s',
    color: '#ff8fc8',
    duration: 8,
    spawnWeight: 1,
  },
  bubble_wrap: {
    id: 'bubble_wrap',
    name: 'Bubble Wrap',
    icon: '🫧',
    description: 'Blocks the next hit (stacks to 3)',
    color: '#c8f0ff',
    spawnWeight: 0.8,
  },
  glue_dab: {
    id: 'glue_dab',
    name: 'Glue Dab',
    icon: '🧴',
    description: '×2 growth for 10 s',
    color: '#fff3a0',
    duration: 10,
    spawnWeight: 0.9,
  },
  crumb_cake: {
    id: 'crumb_cake',
    name: 'Crumb Cake',
    icon: '🍰',
    description: 'Heal 1 heart',
    color: '#ffb36b',
    spawnWeight: 0.8,
  },
  dust_cloud: {
    id: 'dust_cloud',
    name: 'Dust Cloud',
    icon: '☁️',
    description: 'Hazards ignore you for 6 s',
    color: '#d6d0c8',
    duration: 6,
    spawnWeight: 0.6,
  },
} satisfies Record<string, PickupData>;

export const PICKUP_EFFECTS = {
  /** Static Charge: added to magnetRadius (Bunny radii). */
  staticChargeMagnet: 1.6,
  sugarRushSpeed: 1.5,
  glueDabGrowth: 2,
  crumbCakeHeal: 1,
  /** Bubble Wrap: each pickup adds one shield charge, up to this many. */
  bubbleWrapMaxStacks: 3,
};

/** Floor spawning (see src/pickups/director.ts). */
export const PICKUP_SPAWN = {
  /** Base seconds between spawns (divided by the pickupLuck stat). */
  interval: 14,
  /** First spawn after this many seconds. */
  firstDelay: 6,
  maxOnFloor: 4,
  /** Spawn ring as a fraction of the camera view radius. */
  inner: 0.35,
  outer: 0.9,
  /** Floor Pickups despawn after this many seconds, or when farther than despawnView × view radius. */
  lifetime: 60,
  despawnView: 2.2,
  /** Floor Pickup radius as a fraction of the Bunny radius (tracks growth). */
  radiusRatio: 0.55,
};
