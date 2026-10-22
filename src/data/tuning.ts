/**
 * Tuning constants. Gameplay numbers live here (and in the other data files), not in logic.
 * The object is intentionally mutable so debug tools / QA can tweak values live.
 */
export const TUNING = {
  /** Growth: r' = cbrt(r³ + growthFactor × growthMultiplier × massMult × size³). */
  growthFactor: 0.16,
  /** Bunny never shrinks below this radius (cm). */
  minRadius: 0.6,

  /** Max speed in cm/s = speed stat × speedPerRadius × radius. */
  speedPerRadius: 6,
  /** Acceleration in (max speeds)/s = acceleration stat × accelRate. */
  accelRate: 7,
  /** Velocity damping when there is no input (1/s). */
  friction: 7,
  /** Dash burst length (s). Dash speed = dashSpeed stat × max speed. */
  dashDuration: 0.22,
  /** Invulnerability after taking damage (s). */
  invulnerability: 1.0,

  /** Magnet: absorbable Debris within radius × (1 + magnetRadius) is pulled in at this many radii/s. */
  magnetPullSpeed: 5,
  /** Plus this multiple of the Bunny's own speed (> 1), so a Dash or speed boost can't outrun the pull. */
  magnetChase: 1.5,

  /** Shoving Obstacle Debris that is almost absorbable (see pushDebris in systems/collision.ts). */
  push: {
    /** Debris up to radius × ratio can be pushed (absorbable from radius × absorbRatio). */
    ratio: 1.1,
    /** Fraction of the overlap the Debris takes (the rest pushes the Bunny back). */
    share: 0.8,
    /** Fraction of the velocity into the Debris removed per contact tick. */
    drag: 0.08,
  },

  /** Squeezing into gaps narrower than the Bunny (see gapRadiusAt in systems/collision.ts). */
  squeeze: {
    /** The fur squashes down to radius × min; narrower gaps stay closed. */
    min: 0.4,
    /** Two contacts count as opposite sides of a gap when their normals' dot product is at most this. */
    opposing: -0.2,
  },

  /** Absorbed Debris rendered on the Bunny surface. */
  stuckCap: 150,
  /** Stuck Debris smaller than radius × this is considered buried in the fur and removed. */
  stuckMinRatio: 0.05,

  debris: {
    /** Hard cap on live Debris. */
    cap: 5000,
    /** Spatial hash cell size (cm). */
    cellSize: 16,
    /** Random size jitter applied per instance (fraction of catalogue size). */
    sizeJitter: 0.2,
    // Initial scatter / start cluster sizes are per area: src/data/areas.ts.
    /** Debris at least this big (cm) keeps clutterSpacing from its neighbours (spawner.ts) so it can't box the Bunny in. */
    clutterMinSize: 2,
  },

  spawner: {
    /** Seconds between spawner passes. */
    interval: 0.25,
    /** Desired count of "meaningful" absorbable Debris within spawnRadius of the Bunny. */
    targetCount: 90,
    /** Max spawns per pass. */
    maxPerPass: 24,
    /** Debris smaller than radius × this does not count as meaningful (and may be culled). */
    meaningfulRatio: 0.12,
    /**
     * Spawn distance band in multiples of the camera view radius. Spawn points must also be off
     * screen (camera footprint test), so the inner bound can sit inside the view radius: the
     * floor behind the camera (bottom of the screen) is hidden from ~0.5 view radii.
     */
    spawnInner: 0.45,
    spawnOuter: 1.6,
    /** Random spawn points tried per wanted spawn (most get rejected late in the Run). */
    triesPerSpawn: 8,
    /** Fraction of spawns that may be slightly-too-big "next" Debris (Obstacles for now). */
    obstacleShare: 0.15,
    /** Out-of-view Debris smaller than radius × this is culled. */
    cullRatio: 0.06,
    /** Max culls per pass. */
    maxCullPerPass: 80,
  },

  camera: {
    fov: 50,
    /** Fixed yaw (radians). 0 = camera on +Z looking towards -Z. */
    yaw: 0,
    pitchDeg: 54,
    minDistance: 8,
    maxDistance: 26000,
    /** Smoothing rate for distance changes (1/s). */
    zoomRate: 2.2,
    followRate: 10,
    /** View radius on the floor ≈ distance × viewRadiusFactor (used by the spawner). */
    viewRadiusFactor: 0.85,
    fogNear: 1.1,
    fogFar: 2.8,
  },
};

export type Tuning = typeof TUNING;
