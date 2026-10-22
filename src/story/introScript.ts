/**
 * The diegetic intro's script (docs/story.md "Intro sequence"), headless: where the camera stands
 * for each shot, where the four dropped things land and where the slippers walk, all worked out
 * from the House layout round the couch the Bunny spawns under. src/story/intro.ts plays it.
 *
 * Couch frame: `C` is the middle of the couch's front edge, `f` its facing (into the room), `u`
 * the lateral axis chosen so that, from the standing camera, the couch is at frame left. A point
 * (u, v) in the frame is C + u × lateral + v × f, in cm.
 */
import { clamp, rectContains, type Rect } from '../core/math';
import { TUNING } from '../data/tuning';
import { facing } from '../world/rooms';
import type { FurnitureInstance, HouseLayout } from '../world/types';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CameraPose {
  position: Vec3;
  look: Vec3;
  /** Vertical fov (degrees); absent: the gameplay camera's. */
  fov?: number;
}

/** One of shot 2's dropped things: falls from `fallHeight` to (x, z); the coin then rolls to (toX, toZ). */
export interface IntroDrop {
  typeId: 'crumb' | 'staple' | 'coin' | 'sock';
  x: number;
  z: number;
  rotY: number;
  /** Seconds into shot 2 at which it is let go. */
  at: number;
  /** Where it ends up after rolling (the coin), else (x, z). */
  toX: number;
  toZ: number;
}

export interface IntroStage {
  /** Middle of the couch's front edge, the couch's facing, and the lateral axis (couch at frame left). */
  front: { x: number; z: number };
  facing: { x: number; z: number };
  lateral: { x: number; z: number };
  /** Where the Bunny is (its spawn, under the couch). */
  spawn: { x: number; z: number };
  /** Shots 1 to 3: standing height, looking at the floor in front of the couch. */
  standing: CameraPose;
  /** End of shot 4: down at the gap under the couch, looking in at the lint. */
  gap: CameraPose;
  /** Shot 5: close on the lint pile (the Bunny). */
  lint: CameraPose;
  drops: IntroDrop[];
  /** Shot 3: the slippers' path across the floor (a polyline, in walking order), feet `gauge` apart. */
  walk: { path: Array<{ x: number; z: number }>; gauge: number };
}

/** Shot timing (seconds) and heights. Each shot lasts its caption panel (STORY.intro); these are the beats inside it. */
export const INTRO = {
  /** Shot 1: fade up from black. */
  fadeUp: 1.6,
  /** Eye height of the standing camera (cm), and its lens: narrow, so small things read on the floor. */
  eyeHeight: 150,
  standingFov: 30,
  /** Shot 2: the lens pushes in on the dropped things to this fov over `push` seconds; shot 3 holds it. */
  closeFov: 15,
  push: 3,
  /** Shot 2: how far things fall (cm) and gravity (cm/s²). */
  fallHeight: 95,
  gravity: 980,
  /** The coin's roll after it lands (s). */
  coinRoll: 0.9,
  /** Shot 3: the slippers' walk (s) and step (cm between one slipper's print and the other's). */
  walkSeconds: 3,
  step: 58,
  /** Shot 3: how high a slipper lifts (cm). */
  stepLift: 7,
  /** Shot 4: the camera's dive to the gap takes this long, or the whole shot if shorter (s). */
  dive: 6,
  /** Shot 5: seconds before the second caption at which the eyes blink open. */
  blinkLead: 0.7,
  /** Shot 6: the swing to the gameplay camera takes this long, or until "Grow." (s). */
  settle: 3,
  /** Skip: the camera's hand-back to the gameplay pose (s; reduced motion: at once). */
  skipRelease: 1.1,
  /** Reduced motion: a cut through black instead of a camera move, each way (s). */
  dip: 0.35,
} as const;

/** Shots in caption-panel order (STORY.intro); shot 7 is control unlocking. */
export const SHOT = { floor: 0, drops: 1, slippers: 2, dive: 3, eyes: 4, grow: 5 } as const;

/** The couch the Bunny spawned under (null: none, e.g. a layout without one). */
export function spawnCouch(layout: HouseLayout): FurnitureInstance | null {
  const { spawn } = layout;
  return layout.furniture.find((f) => f.defId === 'couch' && rectContains(f.rect, spawn.x, spawn.z)) ?? null;
}

/** The standing camera's spot and the floor point it looks at, in the couch frame (cm). */
const STAND = { u: -60, v: 235 };
const LOOK = { u: -88, v: 34 };

/** Point (u, v) in the couch frame. */
const pt = (front: { x: number; z: number }, f: { x: number; z: number }, l: { x: number; z: number }, u: number, v: number) => ({
  x: front.x + l.x * u + f.x * v,
  z: front.z + l.z * u + f.z * v,
});

/** Distance from (x, z) to the nearest furniture footprint other than `except` (Infinity if none). */
function clearance(layout: HouseLayout, x: number, z: number, except: FurnitureInstance): number {
  let best = Infinity;
  for (const f of layout.furniture) {
    if (f === except) continue;
    const dx = Math.max(f.rect.minX - x, 0, x - f.rect.maxX);
    const dz = Math.max(f.rect.minZ - z, 0, z - f.rect.maxZ);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

/**
 * The intro's stage for a House layout, or null when the Bunny does not start under a couch (the
 * intro then is not played in this Run).
 */
export function introStage(layout: HouseLayout): IntroStage | null {
  const couch = spawnCouch(layout);
  const room = layout.rooms.find((r) => r.id === layout.spawn.roomId);
  if (!couch || !room) return null;
  const f = facing(couch.quarterTurns);
  const front = { x: couch.x + f.x * (couch.d / 2), z: couch.z + f.z * (couch.d / 2) };
  // Stand out in the room beyond the coffee table, looking at the floor in front of one end of
  // the couch: try both ends, prefer one that puts the couch at frame left, then the one whose
  // standing spot is inside the room with more space round it.
  const inner: Rect = { minX: room.rect.minX + 30, minZ: room.rect.minZ + 30, maxX: room.rect.maxX - 30, maxZ: room.rect.maxZ - 30 };
  const candidates = [-1, 1].map((sign) => {
    const l = { x: f.z * sign, z: -f.x * sign };
    const stand = pt(front, f, l, STAND.u, STAND.v);
    const look = pt(front, f, l, LOOK.u, LOOK.v);
    const inside = rectContains(inner, stand.x, stand.z);
    return { l, left: couchAtLeft(stand, look, couch), score: (inside ? 1000 : 0) + Math.min(200, clearance(layout, stand.x, stand.z, couch)) };
  });
  const l = [...candidates].sort((a, b) => Number(b.left) - Number(a.left) || b.score - a.score)[0]!.l;
  const at = (u: number, v: number) => pt(front, f, l, u, v);
  const inRoom = (p: { x: number; z: number }) => ({ x: clamp(p.x, inner.minX, inner.maxX), z: clamp(p.z, inner.minZ, inner.maxZ) });

  const spawn = { x: layout.spawn.x, z: layout.spawn.z };
  const stand = inRoom(at(STAND.u, STAND.v));
  const focus = at(LOOK.u, LOOK.v);
  const gapCam = { x: front.x + f.x * 18, z: front.z + f.z * 18 };
  const lintCam = { x: spawn.x + f.x * 9, z: spawn.z + f.z * 9 };
  const drop = (typeId: IntroDrop['typeId'], u: number, v: number, rotY: number, time: number, to?: { x: number; z: number }): IntroDrop => {
    const p = at(u, v);
    return { typeId, x: p.x, z: p.z, rotY, at: time, toX: to?.x ?? p.x, toZ: to?.z ?? p.z };
  };
  // The slippers come in from the room below the frame, turn in over the dropped things, walk
  // away along the couch's front (between it and the coffee table, clear of an armchair at either
  // end) and back out into the room past the far end.
  const end = couch.w / 2;
  const lane = 18;
  const walk = roundCorners([at(-end, 150), at(-end, lane), at(end, lane), at(end, 150)], 22).map(inRoom);

  return {
    front,
    facing: f,
    lateral: l,
    spawn,
    standing: { position: { x: stand.x, y: INTRO.eyeHeight, z: stand.z }, look: { x: focus.x, y: 0, z: focus.z }, fov: INTRO.standingFov },
    gap: { position: { x: gapCam.x, y: 3.2, z: gapCam.z }, look: { x: spawn.x, y: 1.2, z: spawn.z } },
    lint: { position: { x: lintCam.x, y: 1.9, z: lintCam.z }, look: { x: spawn.x, y: 1, z: spawn.z } },
    drops: [
      drop('crumb', -80, 22, 0.6, 0.35),
      drop('staple', -100, 32, 2.1, 1.05),
      drop('coin', -74, 44, 0, 1.75, at(-90, 24)),
      drop('sock', -104, 46, 1.2 + Math.atan2(l.x, l.z), 2.75),
    ],
    walk: { path: walk, gauge: 17 },
  };
}

/** A polyline with each inner corner replaced by a quarter-ish arc of `radius` (a few points). */
function roundCorners(points: Array<{ x: number; z: number }>, radius: number): Array<{ x: number; z: number }> {
  const out = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const [a, b, c] = [points[i - 1]!, points[i]!, points[i + 1]!];
    const ab = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const bc = Math.hypot(c.x - b.x, c.z - b.z) || 1;
    const r = Math.min(radius, ab / 2, bc / 2);
    const p0 = { x: b.x - ((b.x - a.x) / ab) * r, z: b.z - ((b.z - a.z) / ab) * r };
    const p1 = { x: b.x + ((c.x - b.x) / bc) * r, z: b.z + ((c.z - b.z) / bc) * r };
    // Quadratic Bézier through the corner.
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      out.push({ x: (1 - t) ** 2 * p0.x + 2 * t * (1 - t) * b.x + t * t * p1.x, z: (1 - t) ** 2 * p0.z + 2 * t * (1 - t) * b.z + t * t * p1.z });
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

/** True if, from `cam` looking at `look`, the couch's middle is on the left of the frame. */
function couchAtLeft(cam: { x: number; z: number }, look: { x: number; z: number }, couch: FurnitureInstance): boolean {
  // Screen right on the floor is forward × up = (-forward.z, forward.x).
  const fx = look.x - cam.x;
  const fz = look.z - cam.z;
  return (couch.x - cam.x) * -fz + (couch.z - cam.z) * fx < 0;
}

/** Fov between two poses (absent: the gameplay camera's TUNING fov). */
function lerpFov(a: number | undefined, b: number | undefined, t: number): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  const fa = a ?? TUNING.camera.fov;
  return fa + ((b ?? TUNING.camera.fov) - fa) * t;
}

/** Smootherstep 0..1. */
export function ease(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

const mix = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

/**
 * The scripted camera at `t` seconds into `shot` (a panel lasting `hold` seconds; `reveal` is when
 * its second caption shows). `weight` is the hand-back to the gameplay camera (CameraRig.script).
 * With reduced motion the camera does not travel: it cuts to the lint pile at shot 4 and to the
 * gameplay camera at shot 6, each cut fading in from black (`dip`, 0..1).
 */
export function shotCamera(stage: IntroStage, shot: number, t: number, hold: number, reveal: number, reducedMotion = false): CameraPose & { weight: number; dip: number } {
  const still = (p: CameraPose, weight = 0, dip = 0) => ({ position: p.position, look: p.look, fov: p.fov, weight, dip });
  if (shot === SHOT.floor) return still(stage.standing);
  if (shot === SHOT.drops || shot === SHOT.slippers) {
    // A slow push in on the floor as things land (reduced motion: the close framing throughout).
    const k = shot === SHOT.slippers || reducedMotion ? 1 : ease(t / INTRO.push);
    return { ...still(stage.standing), fov: lerpFov(stage.standing.fov, INTRO.closeFov, k) };
  }
  if (shot === SHOT.dive) {
    if (reducedMotion) return still(stage.lint, 0, dipAt(t));
    const k = ease(t / Math.min(INTRO.dive, hold));
    // Lower first, then push in: the height eases faster than the travel.
    const pos = mix(stage.standing.position, stage.gap.position, k);
    pos.y = stage.standing.position.y + (stage.gap.position.y - stage.standing.position.y) * ease(Math.min(1, (t / Math.min(INTRO.dive, hold)) * 1.25));
    const fov = lerpFov(INTRO.closeFov, stage.gap.fov, k);
    return { position: pos, look: mix(stage.standing.look, stage.gap.look, k), fov, weight: 0, dip: 0 };
  }
  if (shot === SHOT.eyes) {
    if (reducedMotion) return still(stage.lint);
    // A slow creep in from the gap to the lint pile.
    const k = ease(t / Math.max(1, hold * 0.6));
    return { position: mix(stage.gap.position, stage.lint.position, k), look: mix(stage.gap.look, stage.lint.look, k), fov: stage.lint.fov, weight: 0, dip: 0 };
  }
  // Shot 6: settle into the gameplay camera by "Grow."
  if (reducedMotion) return still(stage.lint, 1, dipAt(t));
  return still(stage.lint, ease(t / Math.max(0.5, Math.min(INTRO.settle, reveal > 0 ? reveal : hold))));
}

/** Reduced motion's cut: black at the start of the shot, fading back in over 2 × INTRO.dip. */
function dipAt(t: number): number {
  return Math.max(0, 1 - t / (2 * INTRO.dip));
}

/** Distance from (px, pz) to the segment a → b on the floor. */
function segmentDistance(px: number, pz: number, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz || 1;
  const t = clamp(((px - a.x) * dx + (pz - a.z) * dz) / len2, 0, 1);
  return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
}

/**
 * The stage with the camera under the couch moved sideways, if need be, so no Debris bigger than
 * the lint pile stands between it and the Bunny (a marble or a tennis ball filling the frame).
 * Tries small lateral offsets nearest first; keeps the stage as is when none is clear.
 */
export function aimUnderCouch(stage: IntroStage, debris: Iterable<{ x: number; z: number; size: number }>): IntroStage {
  const blockers = [...debris].filter((d) => d.size >= 0.8 && Math.hypot(d.x - stage.spawn.x, d.z - stage.spawn.z) > 1.5);
  const { lateral: l, spawn } = stage;
  const clear = (p: Vec3): boolean => blockers.every((d) => segmentDistance(d.x, d.z, p, spawn) > d.size + 0.8);
  for (const u of [0, -6, 6, -12, 12, -18, 18, -26, 26]) {
    const shift = (p: Vec3): Vec3 => ({ x: p.x + l.x * u, y: p.y, z: p.z + l.z * u });
    const gap = shift(stage.gap.position);
    const lint = shift(stage.lint.position);
    if (clear(gap) && clear(lint)) return u === 0 ? stage : { ...stage, gap: { ...stage.gap, position: gap }, lint: { ...stage.lint, position: lint } };
  }
  return stage;
}
