/**
 * The diegetic intro (docs/story.md "Intro sequence"), played inside the real Run while the
 * `intro` screen holds the simulation: the camera stands over the living-room floor, four things
 * drop onto it, a pair of slippers walks through, the camera dives under the couch to the lint
 * the Bunny is made of, its eyes open, and the camera settles into the Tier 1 gameplay camera.
 *
 * Shots follow the caption panels (STORY.intro): the screen calls `enterShot` as each panel shows
 * and `finish` when the last one ends or the player skips. Whatever a shot leaves behind is made
 * true when it is left early (the dropped things land, the slippers are gone, the eyes are open),
 * and the camera eases rather than cuts, so advancing never jumps. The dropped things are real
 * Debris from the moment they settle and stay for the Run.
 */
import { Color, Euler, Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { getAudio } from '../audio';
import type { Drone } from '../audio/engine';
import type { DropSound } from '../audio/introSounds';
import { Rng } from '../core/rng';
import { getDebrisType } from '../data/debris';
import { debrisColors, debrisGeometry, debrisMaterial } from '../entities/debrisGeometry';
import type { Game } from '../game/game';
import type { CameraScript } from '../systems/camera';
import { ease, INTRO, SHOT, shotCamera, type IntroDrop, type IntroStage } from './introScript';

/** Per dropped thing: colour, landing sound and dust puff (count, size, speed, in cm). */
const DROP_LOOK: Record<IntroDrop['typeId'], { color: number; sound: DropSound; puff: [number, number, number] }> = {
  crumb: { color: 0, sound: 'tick', puff: [7, 3, 9] },
  staple: { color: 0, sound: 'tink', puff: [8, 3.4, 10] },
  coin: { color: 0, sound: 'coin', puff: [10, 4, 12] },
  sock: { color: 1, sound: 'thud', puff: [18, 7, 26] },
};
const DUST = new Color('#cfc6ba');
const SLIPPER_COLOR = 1;
/** The coin's wobble down from its edge once it stops rolling (s). */
const COIN_SETTLE = 0.5;
/** How fast the camera catches up with its scripted pose after a shot is cut short (1/s). */
const CATCH_UP = 2.6;
/** Height (cm) under which the camera is down at the gap under the couch. */
const COUCH_EDGE = 6;
/** The coin recipe's half thickness: it sits on y = 0. */
const COIN_CENTRE = new Matrix4().makeTranslation(0, -0.07, 0);

const _m = new Matrix4();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();

interface Falling {
  drop: IntroDrop;
  mesh: InstancedMesh | null;
  state: 'waiting' | 'falling' | 'rolling' | 'done';
  /** Seconds in the current state. */
  t: number;
}

/** Arc-length walk along a polyline. */
class Path {
  readonly length: number;
  private readonly cum: number[] = [0];
  constructor(private readonly pts: ReadonlyArray<{ x: number; z: number }>) {
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z));
    this.length = this.cum[this.cum.length - 1]!;
  }

  /** Point and unit tangent at distance `s` along the path. */
  at(s: number): { x: number; z: number; tx: number; tz: number } {
    const d = Math.max(0, Math.min(this.length, s));
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i]! < d) i++;
    const a = this.pts[i - 1]!;
    const b = this.pts[i]!;
    const seg = this.cum[i]! - this.cum[i - 1]! || 1;
    const k = (d - this.cum[i - 1]!) / seg;
    return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, tx: (b.x - a.x) / seg, tz: (b.z - a.z) / seg };
  }
}

export class DiegeticIntro {
  /** Black over the frame, 0..1 (the fade up, reduced motion's cuts); the intro screen shows it. */
  black = 1;
  private shot = -1;
  private t = 0;
  private hold = 0;
  private reveal = 0;
  private readonly root = new Group();
  private readonly drops: Falling[];
  private slippers: InstancedMesh | null = null;
  private readonly path: Path;
  private readonly steps: number;
  private lastStep = 0;
  private readonly cam: CameraScript = { position: new Vector3(), look: new Vector3(), weight: 0 };
  private camPlaced = false;
  private room: Drone | null = null;
  private hum: Drone | null = null;
  /** Seconds since the first shot, and when the clock in the room ticks next. */
  private clock = 0;
  private nextTick = 0.6;
  private ticks = 0;
  private blinkAt = Infinity;
  private blinked = false;
  private growAt = Infinity;
  private musicOn = false;
  private hudShown = false;
  private finished = false;
  /** Spawns the dropped things as Debris without touching the Run's own random streams. */
  private readonly rng = new Rng('intro');

  constructor(
    private readonly game: Game,
    private readonly stage: IntroStage,
    private readonly reducedMotion: boolean,
  ) {
    const view = game.view!;
    const run = game.run!;
    view.root.add(this.root);
    this.drops = stage.drops.map((drop) => ({ drop, mesh: null, state: 'waiting', t: 0 }));
    this.path = new Path(stage.walk.path);
    this.steps = Math.max(2, Math.ceil(this.path.length / INTRO.step));
    // The Bunny is a pile of lint facing out from under the couch, eyes shut.
    run.bunny.heading = Math.atan2(stage.facing.x, stage.facing.z);
    view.bunny.introEyes = 0;
    view.bunny.introShimmer = 0;
    view.focus = { x: stage.standing.look.x, y: 0, z: stage.standing.look.z, radius: 30 };
    game.rig.script = this.cam;
    const audio = getAudio();
    audio?.music.hold(true);
    this.room = audio?.intro.roomTone() ?? null;
  }

  /** Panel `index` of the intro is showing for `hold` seconds; its second caption shows at `reveal` (0: none). */
  enterShot(index: number, hold: number, reveal: number): void {
    if (this.finished || index <= this.shot) return;
    for (let s = Math.max(0, this.shot); s < index; s++) this.complete(s);
    this.shot = index;
    this.t = 0;
    this.hold = hold;
    this.reveal = reveal;
    const audio = getAudio();
    switch (index) {
      case SHOT.floor:
        this.room?.set(0.05, 1.5);
        break;
      case SHOT.slippers:
        this.slippers = this.itemMesh('slipper', 2, SLIPPER_COLOR);
        this.lastStep = 0;
        this.placeSlippers(0);
        break;
      case SHOT.dive:
        this.hum = audio?.intro.hum() ?? null;
        this.hum?.set(0.05, hold);
        this.room?.set(0.025, hold);
        break;
      case SHOT.eyes:
        this.blinkAt = Math.max(1, (reveal > 0 ? reveal : hold * 0.6) - INTRO.blinkLead);
        this.hum?.set(0.1, this.blinkAt);
        break;
      case SHOT.grow:
        audio?.intro.bass();
        this.showHud(1.6);
        this.growAt = reveal > 0 ? reveal : hold * 0.7;
        break;
    }
  }

  update(dt: number): void {
    if (this.finished || this.shot < 0) return;
    this.t += dt;
    const t = this.t;
    const pose = shotCamera(this.stage, this.shot, t, this.hold, this.reveal, this.reducedMotion);
    this.moveCamera(pose, dt);
    // Nothing fades while the camera comes down (it passes under the coffee table and stops in front
    // of the couch, which must stay solid): the fade looks from the camera to the focus, so the
    // focus sits at the camera until it is down under the couch's edge, then it is the Bunny.
    if (this.shot === SHOT.dive || this.shot === SHOT.eyes) {
      const p = this.cam.position;
      this.game.view!.focus = this.shot === SHOT.dive || p.y > COUCH_EDGE ? { x: p.x, y: p.y - 0.5, z: p.z, radius: 0.1 } : null;
    }
    this.black = this.shot === SHOT.floor ? Math.max(0, 1 - t / INTRO.fadeUp) : pose.dip;
    this.clock += dt;
    this.updateClock(t);
    this.updateDrops(dt);
    if (this.shot === SHOT.slippers) this.placeSlippers(t);
    const bunny = this.game.view!.bunny;
    if (this.shot === SHOT.dive) bunny.introShimmer = 0.1 + 0.08 * Math.max(0, Math.sin(t * 2.6)) * ease(t / 2);
    if (this.shot === SHOT.eyes) {
      if (t < this.blinkAt) bunny.introShimmer = 0.12 + 0.75 * ease(t / this.blinkAt) + 0.1 * Math.sin(t * 9) * (t / this.blinkAt);
      else {
        if (!this.blinked) this.blink();
        const k = t - this.blinkAt;
        bunny.introShimmer = Math.max(0, 0.87 * (1 - k / 0.8));
        bunny.introEyes = k < 0.8 ? eyesOpen(k) : null;
      }
    }
    if (this.shot === SHOT.grow && t >= this.growAt) this.startMusic();
  }

  /** Ends the intro now: everything lands where the shots would have left it and the camera eases (or cuts) to the gameplay pose. */
  finish(): void {
    if (this.finished) return;
    for (let s = Math.max(0, this.shot); s <= SHOT.grow; s++) this.complete(s);
    this.finished = true;
    this.black = 0;
    const view = this.game.view;
    if (view) {
      view.focus = null;
      view.bunny.introEyes = null;
      view.bunny.introShimmer = 0;
    }
    this.showHud(0.5);
    if (this.game.rig.script === this.cam) this.game.rig.releaseScript(this.reducedMotion ? 0 : INTRO.skipRelease);
    this.room?.stop(0.4);
    this.hum?.stop(0.2);
    this.root.removeFromParent();
  }

  /** Makes shot `s`'s outcome true, as if it had played to the end. */
  private complete(s: number): void {
    switch (s) {
      case SHOT.drops:
        for (const f of this.drops) if (f.state !== 'done') this.settle(f, f.drop.toX, f.drop.toZ, f.drop.rotY);
        break;
      case SHOT.slippers:
        if (this.slippers) {
          this.slippers.removeFromParent();
          this.slippers.dispose();
          this.slippers = null;
        }
        break;
      case SHOT.eyes:
        if (!this.blinked) this.blink();
        this.game.view!.bunny.introEyes = null;
        this.game.view!.bunny.introShimmer = 0;
        break;
      case SHOT.grow:
        this.startMusic();
        break;
    }
  }

  private moveCamera(pose: ReturnType<typeof shotCamera>, dt: number): void {
    const c = this.cam;
    const { position: p, look: l } = pose;
    if (!this.camPlaced || this.reducedMotion) {
      c.position.set(p.x, p.y, p.z);
      c.look.set(l.x, l.y, l.z);
      this.camPlaced = true;
    } else {
      const k = 1 - Math.exp(-CATCH_UP * dt);
      c.position.x += (p.x - c.position.x) * k;
      c.position.y += (p.y - c.position.y) * k;
      c.position.z += (p.z - c.position.z) * k;
      c.look.x += (l.x - c.look.x) * k;
      c.look.y += (l.y - c.look.y) * k;
      c.look.z += (l.z - c.look.z) * k;
    }
    c.weight = pose.weight;
    c.fov = pose.fov;
  }

  /** A clock somewhere in the room, until the camera is under the couch. */
  private updateClock(t: number): void {
    if (this.shot > SHOT.dive || this.clock < this.nextTick) return;
    // It fades as the camera goes down under the couch.
    const gain = this.shot === SHOT.dive ? 1 - ease(t / Math.max(1, this.hold * 0.7)) : 1;
    getAudio()?.intro.clockTick(this.ticks % 2 === 1, gain * 0.8);
    this.ticks++;
    this.nextTick += 1;
  }

  private updateDrops(dt: number): void {
    for (const f of this.drops) {
      const d = f.drop;
      if (f.state === 'waiting') {
        if (this.shot !== SHOT.drops || this.t < d.at) continue;
        f.state = 'falling';
        f.t = 0;
        f.mesh = this.itemMesh(d.typeId, 1, DROP_LOOK[d.typeId].color);
      }
      f.t += dt;
      const type = getDebrisType(d.typeId);
      if (!type || !f.mesh) {
        if (f.state !== 'done') this.settle(f, d.toX, d.toZ, d.rotY);
        continue;
      }
      const size = type.size;
      const coin = d.typeId === 'coin';
      if (f.state === 'falling') {
        const floorY = coin ? size : 0;
        const y = INTRO.fallHeight - 0.5 * INTRO.gravity * f.t * f.t;
        const fall = Math.sqrt((2 * (INTRO.fallHeight - floorY)) / INTRO.gravity);
        const left = Math.max(0, fall - f.t);
        if (coin) this.coinMatrix(f.mesh, size, d.x, Math.max(floorY, y), d.z, d, 0, Math.PI / 2, 0);
        else {
          // A slow tumble that comes to rest flat as it lands.
          _e.set(left * 3.1, d.rotY + left * 2, left * 1.7);
          _q.setFromEuler(_e);
          _m.compose(_p.set(d.x, Math.max(0, y), d.z), _q, _s.setScalar(size));
          f.mesh.setMatrixAt(0, _m);
          f.mesh.instanceMatrix.needsUpdate = true;
        }
        if (y <= floorY) this.land(f);
      } else if (f.state === 'rolling') {
        const dist = Math.hypot(d.toX - d.x, d.toZ - d.z);
        const roll = Math.min(1, f.t / INTRO.coinRoll);
        const s = dist * (1 - (1 - roll) * (1 - roll));
        const k = dist > 0 ? s / dist : 1;
        const x = d.x + (d.toX - d.x) * k;
        const z = d.z + (d.toZ - d.z) * k;
        const settle = Math.max(0, f.t - INTRO.coinRoll) / COIN_SETTLE;
        // Rolling on its edge, then wobbling down flat (faster and faster, like a spun coin).
        const tilt = (Math.PI / 2) * (1 - ease(settle));
        const wobble = settle * settle * 14;
        this.coinMatrix(f.mesh, size, x, size * (Math.sin(tilt) + 0.07 * Math.cos(tilt)), z, d, -s / size, tilt, wobble);
        if (settle >= 1) this.settle(f, d.toX, d.toZ, this.coinYaw(d) + wobble);
      }
    }
  }

  /** The coin: on its edge at `tilt` (π/2 upright, 0 flat), spun `spin` about its axis, travelling towards its roll's end. */
  private coinMatrix(mesh: InstancedMesh, size: number, x: number, y: number, z: number, d: IntroDrop, spin: number, tilt: number, precess: number): void {
    _q.setFromEuler(_e.set(0, this.coinYaw(d) + precess, 0));
    _q2.setFromEuler(_e.set(tilt, 0, 0));
    _q.multiply(_q2);
    _q2.setFromEuler(_e.set(0, spin, 0));
    _q.multiply(_q2);
    _m.compose(_p.set(x, y, z), _q, _s.setScalar(size));
    // The recipe sits on y = 0; centre it so it rolls about its middle.
    _m.multiply(COIN_CENTRE);
    mesh.setMatrixAt(0, _m);
    mesh.instanceMatrix.needsUpdate = true;
  }

  private coinYaw(d: IntroDrop): number {
    return Math.atan2(-(d.toZ - d.z), d.toX - d.x);
  }

  /** It hits the floor: sound and a small dust puff; the coin starts rolling, the rest are Debris now. */
  private land(f: Falling): void {
    const d = f.drop;
    const look = DROP_LOOK[d.typeId];
    const view = this.game.view!;
    const audio = getAudio()?.intro;
    const pan = this.pan(d.x, d.z);
    audio?.drop(look.sound, pan);
    const type = getDebrisType(d.typeId);
    _c.copy(DUST);
    if (type) _c.lerp(new Color(type.colors[look.color] ?? type.colors[0]!), 0.2);
    const [n, size, speed] = look.puff;
    view.puffs.emit(d.x, size * 0.3, d.z, n, size, speed, _c, 0.8, size * 0.8);
    if (d.typeId === 'coin') {
      f.state = 'rolling';
      f.t = 0;
      audio?.coinRoll(INTRO.coinRoll, pan);
    } else this.settle(f, d.x, d.z, d.rotY);
  }

  /** It is at rest: the temporary mesh goes and the real Debris takes its place. */
  private settle(f: Falling, x: number, z: number, rotY: number): void {
    f.state = 'done';
    if (f.mesh) {
      f.mesh.removeFromParent();
      f.mesh.dispose();
      f.mesh = null;
    }
    const run = this.game.run;
    const type = getDebrisType(f.drop.typeId);
    if (!run || !type) return;
    const index = run.debris.types.indexOf(type);
    if (index < 0) return;
    const debris = run.debris.spawn(index, x, z, this.rng, { size: type.size, rotY });
    if (debris) debris.colorIndex = Math.min(DROP_LOOK[f.drop.typeId].color, type.colors.length - 1);
  }

  /** The slippers `t` seconds into shot 3: one foot swings while the other is planted. */
  private placeSlippers(t: number): void {
    const mesh = this.slippers;
    const type = getDebrisType('slipper');
    if (!mesh || !type) return;
    const n = this.steps;
    const dur = INTRO.walkSeconds / n;
    const walkT = Math.max(0, t - 0.2);
    const step = Math.min(n + 1, Math.floor(walkT / dur) + 1);
    const plant = (k: number): number => (Math.max(0, k) / n) * this.path.length;
    for (let foot = 0; foot < 2; foot++) {
      // The last plant this foot made before `step` (both feet start together at 0).
      const prev = (upTo: number): number => {
        let k = upTo - 1;
        while (k > 0 && k % 2 !== foot) k--;
        return Math.max(0, k);
      };
      let s: number;
      let lift = 0;
      if (step <= n && step % 2 === foot) {
        const p = Math.min(1, (walkT - (step - 1) * dur) / dur);
        s = plant(prev(step)) + (plant(step) - plant(prev(step))) * ease(p);
        lift = Math.sin(Math.PI * p);
      } else s = plant(prev(Math.min(step, n + 1)));
      const at = this.path.at(s);
      const side = (foot === 0 ? -1 : 1) * (this.stage.walk.gauge / 2);
      const x = at.x - at.tz * side;
      const z = at.z + at.tx * side;
      _q.setFromEuler(_e.set(0, Math.atan2(-at.tz, at.tx), lift * 0.35, 'YXZ'));
      _m.compose(_p.set(x, lift * INTRO.stepLift, z), _q, _s.setScalar(type.size));
      mesh.setMatrixAt(foot, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    // A step lands: footsteps, quieter as they go.
    if (step - 1 > this.lastStep && step - 1 <= n) {
      this.lastStep = step - 1;
      const at = this.path.at(plant(this.lastStep));
      getAudio()?.intro.footstep(1 - 0.65 * (this.lastStep / n), this.pan(at.x, at.z));
    }
  }

  private blink(): void {
    this.blinked = true;
    // The hum and the room cut to silence on the blink.
    this.hum?.stop(0.03);
    this.room?.stop(0.03);
    this.hum = null;
    this.room = null;
  }

  private startMusic(): void {
    if (this.musicOn) return;
    this.musicOn = true;
    getAudio()?.music.hold(false);
  }

  private showHud(seconds: number): void {
    if (this.hudShown) return;
    this.hudShown = true;
    this.game.hud.fadeIn(seconds);
  }

  /** A temporary copy of a Debris type's mesh (`count` instances) for the scripted props. */
  private itemMesh(typeId: string, count: number, color: number): InstancedMesh | null {
    const type = getDebrisType(typeId);
    if (!type) return null;
    const mesh = new InstancedMesh(debrisGeometry(type), debrisMaterial(type), count);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const colors = debrisColors(type);
    for (let i = 0; i < count; i++) {
      mesh.setColorAt(i, colors[Math.min(color, colors.length - 1)]!);
      mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
    }
    this.root.add(mesh);
    return mesh;
  }

  /** Stereo position of a floor point on screen, -1..1 (scaled down: the room is in front of us). */
  private pan(x: number, z: number): number {
    _p.set(x, 0, z).project(this.game.camera);
    return Math.max(-0.7, Math.min(0.7, _p.x * 0.7));
  }
}

/** The eyes `k` seconds after they first open: open, a slow blink, open. */
export function eyesOpen(k: number): number {
  if (k < 0.16) return ease(k / 0.16);
  if (k < 0.5) return 1;
  if (k < 0.6) return 1 - 0.9 * ease((k - 0.5) / 0.1);
  if (k < 0.75) return 0.1 + 0.9 * ease((k - 0.6) / 0.15);
  return 1;
}
