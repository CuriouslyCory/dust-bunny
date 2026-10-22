/**
 * The ending's pictures (browser only; docs/story.md "Ending sequence"): one Scene and camera that
 * Game renders instead of the Run while the `ending` screen is up (src/story/endingScreen.ts drives
 * it shot by shot, the shots and holds are `STORY.ending`, the shared beats `ENDING_BEATS`).
 *
 * - Space: the Bunny in its black-hole form (a BunnyView of its own over a still stand-in Bunny) on
 *   an almost empty sky; the camera pushes in, then into the dark core.
 * - The Bang and the time-lapse: thousands of motes (one Points draw, moved in the vertex shader)
 *   burst out, gather into two swirling arms, flatten into a disc; a ball in it cools from white to
 *   orange to grey, then oceans creep across it and land turns green (the game's only real sphere).
 * - The shore: low-poly and flat-shaded in the house's warm light. A biped built from boxes strikes
 *   two rocks, lights a fire, roasts something on a stick, eats it, drops the stick and walks off.
 *   Beside the stick sits a dust bunny the size of a speck.
 *
 * Reduced motion: slower pushes, a soft fade instead of the white flash and a slower burst.
 * `update` returns the veil (a full-screen colour over the canvas) that the screen draws.
 */
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DodecahedronGeometry,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Points,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Material,
  type WebGLRenderer,
} from 'three';
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import type { EndingShot } from '../data/story';
import type { Bunny } from '../entities/bunny';
import { BunnyView } from '../entities/bunnyView';
import { ENDING_BEATS } from '../story/ending';

export type EndingLook = ConstructorParameters<typeof BunnyView>[2];

export interface EndingOptions {
  /** The Run's Bunny look (its Character's), for the Bunny and the speck. */
  look?: EndingLook;
  reducedMotion?: boolean;
  /** Fewer motes on low quality. */
  low?: boolean;
}

/** A full-screen colour over the canvas: the fade to black, the Bang's white frame. */
export interface EndingVeil {
  color: 'black' | 'white';
  opacity: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const easeOut = (t: number): number => 1 - (1 - clamp01(t)) ** 3;

/** A Bunny that never moves, for a BunnyView outside a Run. */
function stillBunny(radius: number, form: 'dust' | 'black_hole'): Bunny {
  return {
    x: 0,
    z: 0,
    prevX: 0,
    prevZ: 0,
    vx: 0,
    vz: 0,
    radius,
    prevRadius: radius,
    realRadius: radius,
    unit: 1,
    speed: 0,
    heading: 0,
    dashing: false,
    squeeze: 1,
    hunkered: false,
    invulnerable: 0,
    staticCharge: null,
    rollQuat: new Quaternion(),
    form,
  } as unknown as Bunny;
}

// ── Motes: the Bang, the swirl, the disc ─────────────────────────────────────

const MOTE_VERT = /* glsl */ `
uniform float uTime;
uniform float uBurstK;
uniform float uGather;
uniform float uFlat;
uniform float uInfall;
uniform float uScale;
uniform float uFade;
attribute vec3 aDir;
attribute vec4 aSeed; // speed, disc radius, angle, stagger
attribute float aSize;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float t = max(uTime, 0.0);
  // The Bang: out from the centre, fast, easing off.
  vec3 burst = aDir * aSeed.x * 9.0 * (1.0 - exp(-uBurstK * t));
  // The swirl: two arms wound round the centre, turning faster inside; it flattens into a disc.
  float r = aSeed.y * (1.0 - uInfall * smoothstep(1.9, 0.4, aSeed.y));
  float arm = step(0.5, fract(aSeed.z * 7.13)) * 3.14159;
  float ang = arm + log(max(aSeed.y, 0.2)) * 2.3 + (aSeed.z - 0.5) * 0.9 - t * 1.6 / pow(max(aSeed.y, 0.4), 1.5);
  float puff = (1.0 - uFlat) * 0.9 + 0.06;
  vec3 swirl = vec3(cos(ang) * r, aDir.y * puff * r * 0.35, sin(ang) * r);
  float g = clamp(uGather * 1.5 - aSeed.w * 0.5, 0.0, 1.0);
  g = g * g * (3.0 - 2.0 * g);
  vec3 p = mix(burst, swirl, g);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(0.05, -mv.z), 1.0, 24.0);
  // Hot cream at the Bang, then warm amber inside the disc and lavender-blue at its rim.
  vec3 hot = vec3(1.0, 0.95, 0.86);
  vec3 warm = vec3(1.0, 0.66, 0.34);
  vec3 cool = vec3(0.62, 0.66, 1.0);
  vec3 disc = mix(warm, cool, smoothstep(0.6, 3.6, aSeed.y));
  vColor = mix(hot, disc, g);
  float swallowed = uInfall * smoothstep(1.4, 0.6, aSeed.y);
  vAlpha = uFade * (1.0 - swallowed) * (0.55 + 0.45 * fract(aSeed.w * 13.7));
}`;

const MOTE_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  gl_FragColor = vec4(vColor * a * a * vAlpha, 1.0); // additive
}`;

// ── The planet ───────────────────────────────────────────────────────────────

const PLANET_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vViewW;
void main() {
  vObj = normalize(position);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewW = normalize(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const PLANET_FRAG = /* glsl */ `
uniform float uHeat;
uniform float uOcean;
uniform float uLand;
uniform vec3 uSunDir;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vViewW;
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash(i), n100 = hash(i + vec3(1, 0, 0)), n010 = hash(i + vec3(0, 1, 0)), n110 = hash(i + vec3(1, 1, 0));
  float n001 = hash(i + vec3(0, 0, 1)), n101 = hash(i + vec3(1, 0, 1)), n011 = hash(i + vec3(0, 1, 1)), n111 = hash(i + vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
void main() {
  float h = fbm(vObj * 2.1 + 3.0);
  float cracks = fbm(vObj * 5.0 + 11.0);
  vec3 rock = mix(vec3(0.34, 0.32, 0.31), vec3(0.52, 0.49, 0.45), h);
  // Oceans fill the basins first and creep across from one side; land greens behind them.
  float sweep = 0.5 + 0.5 * vObj.x;
  float sea = smoothstep(0.0, 0.04, uOcean * 0.62 - h + 0.25 * (1.0 - sweep) * (1.0 - uOcean));
  vec3 ocean = mix(vec3(0.12, 0.34, 0.62), vec3(0.2, 0.52, 0.74), smoothstep(0.2, 0.45, h));
  float green = smoothstep(0.0, 0.05, uLand * 1.2 - fbm(vObj * 3.3 + 7.0) - 0.15 * (1.0 - sweep));
  vec3 land = mix(rock, mix(vec3(0.36, 0.6, 0.27), vec3(0.55, 0.68, 0.33), h), green);
  vec3 surface = mix(land, ocean, sea);
  float lit = max(dot(normalize(vNormalW), normalize(uSunDir)), 0.0);
  vec3 col = surface * (0.22 + 0.95 * lit);
  // Heat: white-hot, then orange with glowing cracks, then out.
  vec3 glow = mix(vec3(1.0, 0.38, 0.08), vec3(1.0, 0.95, 0.85), smoothstep(0.55, 1.0, uHeat));
  float crackGlow = smoothstep(0.08, 0.0, abs(cracks - 0.5)) * smoothstep(0.0, 0.35, uHeat);
  float heat = smoothstep(0.15, 0.7, uHeat);
  col = mix(col, glow * 1.6, heat) + vec3(1.0, 0.42, 0.1) * crackGlow * (1.0 - heat) * 1.4;
  // Air: a blue rim once there is water.
  float rim = pow(1.0 - max(dot(normalize(vNormalW), vViewW), 0.0), 3.0);
  col += vec3(0.45, 0.7, 1.0) * rim * (0.25 + 0.75 * uOcean) * 0.9 + glow * rim * heat * 0.8;
  gl_FragColor = vec4(col, 1.0);
}`;

const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
  gl_Position = projectionMatrix * mv;
}`;

const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 2.2) * uStrength;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSun;
uniform vec3 uSunDir;
varying vec3 vDir;
void main() {
  float y = clamp(vDir.y, -0.2, 1.0);
  vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.55, y));
  float s = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
  col += uSun * (pow(s, 24.0) * 0.6 + pow(s, 4.0) * 0.18);
  gl_FragColor = vec4(col, 1.0);
}`;

// ── The biped ────────────────────────────────────────────────────────────────

/** Joint angles (radians, about x unless named) and hip height of the biped. */
interface Pose {
  hipY: number;
  lean: number;
  headX: number;
  headZ: number;
  lShoulder: number;
  lShoulderZ: number;
  lElbow: number;
  rShoulder: number;
  rShoulderZ: number;
  rElbow: number;
  lHip: number;
  lKnee: number;
  rHip: number;
  rKnee: number;
}

const STAND: Pose = { hipY: 0.66, lean: 0, headX: 0, headZ: 0, lShoulder: 0, lShoulderZ: 0.12, lElbow: -0.15, rShoulder: 0, rShoulderZ: -0.12, rElbow: -0.15, lHip: 0, lKnee: 0, rHip: 0, rKnee: 0 };
/** Squatting, forearms on the knees and the hands out front. */
const SQUAT: Pose = { hipY: 0.4, lean: 0.38, headX: -0.3, headZ: 0, lShoulder: -1.0, lShoulderZ: 0.25, lElbow: -0.7, rShoulder: -1.0, rShoulderZ: -0.25, rElbow: -0.7, lHip: -1.55, lKnee: 1.55, rHip: -1.45, rKnee: 1.45 };

function mixPose(a: Pose, b: Pose, t: number): Pose {
  const out = { ...a };
  for (const k of Object.keys(a) as Array<keyof Pose>) out[k] = lerp(a[k], b[k], t);
  return out;
}

class Biped {
  readonly root = new Group();
  private readonly hips = new Group();
  private readonly torso = new Group();
  private readonly head = new Group();
  private readonly shoulders: [Group, Group];
  private readonly elbows: [Group, Group];
  private readonly legs: [Group, Group];
  private readonly knees: [Group, Group];
  readonly hands: [Group, Group];
  private readonly eyes: Mesh[] = [];
  private readonly mouth: Mesh;
  readonly mouthAnchor = new Object3D();

  constructor(mat: (color: string) => MeshStandardMaterial) {
    const skin = mat('#d9a27a');
    const tunic = mat('#8a5a3b');
    const hair = mat('#4a3426');
    const dark = new MeshBasicMaterial({ color: '#2a1a12' });
    const box = (w: number, h: number, d: number, m: Material, y = -h / 2): Mesh => {
      const mesh = new Mesh(new BoxGeometry(w, h, d), m);
      mesh.position.y = y;
      mesh.castShadow = true;
      return mesh;
    };
    this.root.add(this.hips);
    // Torso: a chunky tunic, wider at the bottom.
    this.hips.add(this.torso);
    const body = new Mesh(new CylinderGeometry(0.19, 0.25, 0.52, 6), tunic);
    body.position.y = 0.24;
    body.castShadow = true;
    this.torso.add(body);
    const neck = new Mesh(new CylinderGeometry(0.06, 0.07, 0.08, 5), skin);
    neck.position.y = 0.53;
    this.torso.add(neck);
    // Head with a mop of hair, two dot eyes and a mouth.
    this.head.position.y = 0.72;
    this.head.scale.setScalar(1.25);
    this.torso.add(this.head);
    const skull = new Mesh(new IcosahedronGeometry(0.17, 1), skin);
    skull.castShadow = true;
    this.head.add(skull);
    const mop = new Mesh(new IcosahedronGeometry(0.175, 0), hair);
    mop.scale.set(1.08, 0.7, 1.05);
    mop.position.set(0, 0.07, -0.03);
    this.head.add(mop);
    const nose = new Mesh(new IcosahedronGeometry(0.035, 0), skin);
    nose.position.set(0, -0.01, 0.17);
    this.head.add(nose);
    for (const x of [-0.065, 0.065]) {
      const eye = new Mesh(new SphereGeometry(0.022, 8, 6), dark);
      eye.position.set(x, 0.03, 0.155);
      this.head.add(eye);
      this.eyes.push(eye);
    }
    this.mouth = new Mesh(new BoxGeometry(0.07, 0.014, 0.02), dark);
    this.mouth.position.set(0, -0.075, 0.15);
    this.head.add(this.mouth);
    this.mouthAnchor.position.set(0, -0.07, 0.25);
    this.head.add(this.mouthAnchor);

    const arm = (side: number): [Group, Group, Group] => {
      const shoulder = new Group();
      shoulder.position.set(side * 0.25, 0.44, 0);
      shoulder.add(box(0.1, 0.27, 0.1, skin));
      const elbow = new Group();
      elbow.position.y = -0.27;
      shoulder.add(elbow);
      elbow.add(box(0.09, 0.25, 0.09, skin));
      const hand = new Group();
      hand.position.y = -0.28;
      elbow.add(hand);
      const fist = new Mesh(new IcosahedronGeometry(0.06, 0), skin);
      fist.castShadow = true;
      hand.add(fist);
      this.torso.add(shoulder);
      return [shoulder, elbow, hand];
    };
    const [ls, le, lh] = arm(1);
    const [rs, re, rh] = arm(-1);
    this.shoulders = [ls, rs];
    this.elbows = [le, re];
    this.hands = [lh, rh];

    const leg = (side: number): [Group, Group] => {
      const hip = new Group();
      hip.position.set(side * 0.11, 0, 0);
      hip.add(box(0.13, 0.3, 0.13, tunic));
      const knee = new Group();
      knee.position.y = -0.3;
      hip.add(knee);
      knee.add(box(0.11, 0.3, 0.11, skin));
      const foot = box(0.13, 0.06, 0.2, hair, -0.3);
      foot.position.z = 0.04;
      knee.add(foot);
      this.hips.add(hip);
      return [hip, knee];
    };
    const [lg, lk] = leg(1);
    const [rg, rk] = leg(-1);
    this.legs = [lg, rg];
    this.knees = [lk, rk];
    this.pose(STAND);
  }

  pose(p: Pose): void {
    this.hips.position.y = p.hipY;
    this.torso.rotation.x = p.lean;
    this.head.rotation.set(p.headX, 0, p.headZ);
    this.shoulders[0].rotation.set(p.lShoulder, 0, p.lShoulderZ);
    this.shoulders[1].rotation.set(p.rShoulder, 0, p.rShoulderZ);
    this.elbows[0].rotation.x = p.lElbow;
    this.elbows[1].rotation.x = p.rElbow;
    this.legs[0].rotation.x = p.lHip;
    this.legs[1].rotation.x = p.rHip;
    this.knees[0].rotation.x = p.lKnee;
    this.knees[1].rotation.x = p.rKnee;
  }

  /** 0 plain, 1 pleased: eyes squeezed into happy slits and a wide mouth. */
  mood(pleased: number): void {
    for (const e of this.eyes) e.scale.set(1 + pleased * 0.2, 1 - pleased * 0.7, 1);
    this.mouth.scale.set(1 + pleased * 0.8, 1 + pleased * 1.5, 1);
  }
}

// ── The scene ────────────────────────────────────────────────────────────────

const SPACE_BG = new Color('#030208');
const SHORE = {
  top: new Color('#b7a6d8'),
  horizon: new Color('#ffd9b4'),
  sun: new Color('#ffcf9a'),
  sunDir: new Vector3(-0.6, 0.32, -0.75).normalize(),
};
/** Where the stick lands, and the speck beside it. */
const STICK_LENGTH = 0.62;
const STICK_REST = new Vector3(-0.3, 0.02, 0.5);
/** The stick lies pointing away from the fire, along the sand towards the camera's right. */
const STICK_YAW = 1.0;
const STICK_REST_Q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), STICK_YAW);
const STICK_MID = STICK_REST.clone().add(new Vector3(Math.sin(STICK_YAW), 0, Math.cos(STICK_YAW)).multiplyScalar(STICK_LENGTH * 0.5));
/** The speck sits in the sand beside the stick's far half, on the camera's side. */
const SPECK_AT = STICK_REST.clone()
  .add(new Vector3(Math.sin(STICK_YAW), 0, Math.cos(STICK_YAW)).multiplyScalar(STICK_LENGTH * 0.72))
  .add(new Vector3(-Math.cos(STICK_YAW), 0, Math.sin(STICK_YAW)).multiplyScalar(0.1));
/** Where the biped squats by the fire, and which way it faces. */
const BIPED_AT = new Vector3(-0.72, 0, 0.05);
const BIPED_YAW = Math.PI / 2 - 0.55;
/** The Bang shot's authored hold: the time-lapse carries its motes on from there. */
const ENDING_BANG_SECONDS = 3;

export class EndingScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(40, 1, 0.01, 400);
  private readonly reduced: boolean;
  private readonly disposables: Array<{ dispose(): void }> = [];

  private readonly space = new Group();
  private readonly bunnyView: BunnyView;
  private readonly cosmos = new Group();
  private readonly motes: Points;
  private readonly moteU: Record<string, { value: number }>;
  private readonly planet: Mesh;
  private readonly planetU: Record<string, { value: unknown }>;
  private readonly planetGlow: Mesh;
  private readonly planetGlowU: Record<string, { value: unknown }>;
  private readonly bangGlow: Mesh;
  private readonly bangGlowU: Record<string, { value: unknown }>;

  private readonly shore = new Group();
  private readonly water: Mesh;
  private readonly waterBase: Float32Array;
  private readonly biped: Biped;
  private readonly rocks: [Mesh, Mesh];
  private readonly flames: Mesh[] = [];
  private readonly fireLight: PointLight;
  private readonly fireGlow: Mesh;
  private readonly fireGlowU: Record<string, { value: unknown }>;
  private readonly sparks: Points;
  private readonly sparkVel: Float32Array;
  private sparkAge = 9;
  private readonly stick = new Group();
  private readonly lump: Mesh;
  private readonly speckView: BunnyView;
  private readonly speck = new Group();
  private readonly groundRocks: Mesh[] = [];

  private shot: EndingShot = 'bunny';
  private time = 0;
  private dropFrom: { p: Vector3; q: Quaternion } | null = null;

  constructor(opts: EndingOptions = {}) {
    this.reduced = !!opts.reducedMotion;
    this.scene.background = SPACE_BG.clone();
    this.scene.add(this.space, this.cosmos, this.shore);
    const mat = (color: string, extra: Partial<MeshStandardMaterial> = {}): MeshStandardMaterial => {
      const m = new MeshStandardMaterial({ color, roughness: 1, flatShading: true });
      Object.assign(m, extra);
      this.disposables.push(m);
      return m;
    };
    const rng = new Rng('ending');

    // ── Space: the Bunny, lit from one side, on a sky with almost nothing left in it.
    this.bunnyView = new BunnyView(stillBunny(1, 'black_hole'), new EventBus(), opts.look);
    this.space.add(this.bunnyView.root);
    const key = new DirectionalLight('#ffe2c4', 1.6);
    key.position.set(-3, 4, 5);
    const rim = new DirectionalLight('#b9a8ff', 2.2);
    rim.position.set(2, 2, -5);
    this.space.add(key, rim, new HemisphereLight('#6a5a9a', '#1a1020', 0.5));
    {
      const n = 60;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const v = new Vector3(rng.range(-1, 1), rng.range(-0.6, 1), rng.range(-1, -0.2)).normalize().multiplyScalar(120);
        pos.set([v.x, v.y, v.z], i * 3);
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      const stars = new Points(geo, new ShaderMaterial({
        vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_PointSize = 2.0; }',
        fragmentShader: 'void main(){ float d = length(gl_PointCoord-0.5)*2.0; gl_FragColor = vec4(vec3(0.55,0.55,0.7)*(1.0-d), 1.0); }',
        blending: AdditiveBlending,
        depthWrite: false,
      }));
      this.space.add(stars);
      this.track(stars);
    }

    // ── Cosmos: motes, the planet and its glow.
    {
      const n = opts.low ? 3000 : 7000;
      const dir = new Float32Array(n * 3);
      const seed = new Float32Array(n * 4);
      const size = new Float32Array(n);
      const v = new Vector3();
      for (let i = 0; i < n; i++) {
        v.set(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1));
        if (v.lengthSq() < 1e-4) v.set(0, 1, 0);
        v.normalize();
        dir.set([v.x, v.y, v.z], i * 3);
        seed.set([0.08 + rng.next() ** 1.6 * 0.92, 0.35 + rng.next() ** 1.6 * 3.6, rng.next(), rng.next()], i * 4);
        size[i] = rng.range(0.6, 2.2);
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
      geo.setAttribute('aDir', new BufferAttribute(dir, 3));
      geo.setAttribute('aSeed', new BufferAttribute(seed, 4));
      geo.setAttribute('aSize', new BufferAttribute(size, 1));
      this.moteU = { uTime: { value: 0 }, uBurstK: { value: 2.4 }, uGather: { value: 0 }, uFlat: { value: 0 }, uInfall: { value: 0 }, uScale: { value: 300 }, uFade: { value: 1 } };
      this.motes = new Points(geo, new ShaderMaterial({ uniforms: this.moteU, vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, blending: AdditiveBlending, depthWrite: false, transparent: true }));
      this.motes.frustumCulled = false;
      this.cosmos.add(this.motes);
      this.track(this.motes);

      this.planetU = { uHeat: { value: 1 }, uOcean: { value: 0 }, uLand: { value: 0 }, uSunDir: { value: new Vector3(-0.8, 0.5, 0.6).normalize() } };
      this.planet = new Mesh(new SphereGeometry(1, 64, 48), new ShaderMaterial({ uniforms: this.planetU, vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG }));
      this.planet.rotation.z = 0.35;
      this.cosmos.add(this.planet);
      this.track(this.planet);
      this.planetGlowU = { uColor: { value: new Color('#ffd8a8') }, uStrength: { value: 1 } };
      this.planetGlow = new Mesh(
        new PlaneGeometry(2, 2),
        new ShaderMaterial({ uniforms: this.planetGlowU, vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, blending: AdditiveBlending, depthWrite: false, transparent: true }),
      );
      this.planetGlow.frustumCulled = false;
      this.cosmos.add(this.planetGlow);
      this.track(this.planetGlow);
      this.bangGlowU = { uColor: { value: new Color('#fff1dc') }, uStrength: { value: 0 } };
      this.bangGlow = new Mesh(
        new PlaneGeometry(2, 2),
        new ShaderMaterial({ uniforms: this.bangGlowU, vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, blending: AdditiveBlending, depthWrite: false, transparent: true }),
      );
      this.bangGlow.frustumCulled = false;
      this.cosmos.add(this.bangGlow);
      this.track(this.bangGlow);
    }

    // ── The shore: sand, grass, the sea behind, a warm low sun.
    {
      const sky = new Mesh(
        new SphereGeometry(150, 24, 12),
        new ShaderMaterial({
          uniforms: { uTop: { value: SHORE.top }, uHorizon: { value: SHORE.horizon }, uSun: { value: SHORE.sun }, uSunDir: { value: SHORE.sunDir } },
          vertexShader: SKY_VERT,
          fragmentShader: SKY_FRAG,
          side: BackSide,
          depthWrite: false,
          fog: false,
        }),
      );
      this.shore.add(sky);
      this.track(sky);

      // Ground: a low-poly sheet, sand near the water, grass behind, sloping under the sea.
      const ground = new PlaneGeometry(60, 60, 48, 48);
      ground.rotateX(-Math.PI / 2);
      const gp = ground.getAttribute('position');
      const colors = new Float32Array(gp.count * 3);
      const sand = new Color('#e8c995');
      const wet = new Color('#c9a674');
      const grass = new Color('#9cb763');
      const c = new Color();
      for (let i = 0; i < gp.count; i++) {
        const x = gp.getX(i);
        const z = gp.getZ(i);
        const shoreLine = -3.2 + Math.sin(x * 0.35) * 0.6;
        const bump = Math.sin(x * 1.3 + z * 0.7) * 0.05 + Math.sin(x * 0.4 - z * 0.9) * 0.08 + rng.range(-0.03, 0.03);
        const under = Math.min(0, z - shoreLine) * 0.18;
        const rise = Math.max(0, z - 2.5) * 0.06 + Math.max(0, Math.abs(x) - 7) * 0.05;
        gp.setY(i, bump + under + rise);
        const toGrass = smooth(1.6, 3.2, z + Math.sin(x * 0.8) * 0.5);
        c.copy(sand).lerp(wet, smooth(shoreLine + 1.2, shoreLine, z)).lerp(grass, toGrass);
        c.offsetHSL(0, 0, rng.range(-0.025, 0.025));
        colors.set([c.r, c.g, c.b], i * 3);
      }
      ground.setAttribute('color', new BufferAttribute(colors, 3));
      ground.computeVertexNormals();
      const groundMesh = new Mesh(ground, mat('#ffffff', { vertexColors: true }));
      groundMesh.receiveShadow = true;
      this.shore.add(groundMesh);
      this.track(groundMesh);

      const water = new PlaneGeometry(80, 40, 40, 20);
      water.rotateX(-Math.PI / 2);
      water.translate(0, -0.08, -23);
      this.waterBase = Float32Array.from(water.getAttribute('position').array as Float32Array);
      this.water = new Mesh(water, mat('#5aa9bf', { transparent: true, opacity: 0.88, roughness: 0.55 }));
      this.water.receiveShadow = true;
      this.shore.add(this.water);
      this.track(this.water);

      // Rocks, bushes and trees round the camp.
      const rockMat = mat('#a59a8c');
      const rockGeo = new DodecahedronGeometry(1, 0);
      this.disposables.push(rockGeo);
      const place = (m: Mesh, x: number, z: number, s: number, ry = 0): Mesh => {
        m.position.set(x, s * 0.35, z);
        m.scale.setScalar(s);
        m.rotation.y = ry;
        m.castShadow = true;
        m.receiveShadow = true;
        this.shore.add(m);
        return m;
      };
      for (const [x, z, s] of [[-2.6, -1.4, 0.45], [-3.3, -0.6, 0.25], [2.4, -1.8, 0.35], [3.4, 0.4, 0.2], [1.6, 2.6, 0.3], [-1.9, 2.2, 0.18]] as const) {
        const r = place(new Mesh(rockGeo, rockMat), x, z, s, rng.range(0, 6));
        r.scale.y *= 0.65;
      }
      const trunk = mat('#7a5638');
      const leafA = mat('#6f9a4a');
      const leafB = mat('#86ab55');
      const trunkGeo = new CylinderGeometry(0.07, 0.1, 1, 5);
      const crownGeo = new IcosahedronGeometry(1, 0);
      this.disposables.push(trunkGeo, crownGeo);
      const tree = (x: number, z: number, s: number): void => {
        const g = new Group();
        const t = new Mesh(trunkGeo, trunk);
        t.position.y = 0.5;
        t.castShadow = true;
        g.add(t);
        for (const [dx, dy, dz, cs, m] of [[0, 1.25, 0, 0.62, leafA], [0.3, 1.0, 0.15, 0.42, leafB], [-0.28, 1.05, -0.1, 0.4, leafB]] as const) {
          const crown = new Mesh(crownGeo, m);
          crown.position.set(dx, dy, dz);
          crown.scale.setScalar(cs);
          crown.castShadow = true;
          g.add(crown);
        }
        g.position.set(x, 0, z);
        g.scale.setScalar(s);
        g.rotation.y = rng.range(0, 6);
        this.shore.add(g);
      };
      tree(2.5, -1.9, 1.25);
      tree(3.4, -0.9, 0.95);
      tree(-2.9, -2.3, 1.4);
      tree(-4.6, -0.6, 1.1);
      tree(5.6, 1.2, 1.2);
      for (const [x, z] of [[2.2, 2.0], [-2.6, 1.4], [4.6, -0.6], [-1.2, 3.6]] as const) {
        const bush = new Mesh(crownGeo, leafB);
        bush.position.set(x, 0.15, z);
        bush.scale.set(0.42, 0.3, 0.42);
        bush.castShadow = true;
        this.shore.add(bush);
      }

      // The fire pit: a ring of stones, crossed sticks, flames that grow in, a flickering light.
      const stoneGeo = new DodecahedronGeometry(0.075, 0);
      this.disposables.push(stoneGeo);
      const stoneMat = mat('#8f877d');
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const s = new Mesh(stoneGeo, stoneMat);
        s.position.set(Math.cos(a) * 0.24, 0.04, Math.sin(a) * 0.24);
        s.rotation.set(a, a * 2, 0);
        s.castShadow = true;
        this.shore.add(s);
      }
      const woodMat = mat('#6b4a2f');
      const logGeo = new CylinderGeometry(0.025, 0.03, 0.36, 5);
      this.disposables.push(logGeo);
      for (let i = 0; i < 4; i++) {
        const log = new Mesh(logGeo, woodMat);
        log.position.y = 0.07;
        log.rotation.set(0, (i / 4) * Math.PI, 1.15);
        log.rotateOnWorldAxis(new Vector3(0, 1, 0), (i / 4) * Math.PI);
        log.castShadow = true;
        this.shore.add(log);
      }
      const flameGeo = new ConeGeometry(1, 1, 5);
      flameGeo.translate(0, 0.5, 0);
      this.disposables.push(flameGeo);
      for (const [x, z, s, col] of [[0, 0, 1, '#ff8a2a'], [0.05, 0.03, 0.7, '#ffc24a'], [-0.05, -0.02, 0.6, '#ff6a1a'], [0.01, -0.04, 0.45, '#fff0a0']] as const) {
        const f = new Mesh(flameGeo, new MeshBasicMaterial({ color: col, transparent: true, opacity: 0.92 }));
        this.disposables.push(f.material as Material);
        f.position.set(x, 0.08, z);
        f.userData.size = s;
        this.flames.push(f);
        this.shore.add(f);
      }
      this.fireGlowU = { uColor: { value: new Color('#ffb060') }, uStrength: { value: 0 } };
      this.fireGlow = new Mesh(
        new PlaneGeometry(2, 2),
        new ShaderMaterial({ uniforms: this.fireGlowU, vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, blending: AdditiveBlending, depthWrite: false, transparent: true }),
      );
      this.fireGlow.position.set(0, 0.22, 0);
      this.fireGlow.scale.setScalar(0.55);
      this.fireGlow.renderOrder = 3;
      this.shore.add(this.fireGlow);
      this.track(this.fireGlow);
      this.fireLight = new PointLight('#ff9a4a', 0, 4.5, 1.6);
      this.fireLight.position.set(0, 0.35, 0);
      this.shore.add(this.fireLight);
      {
        const n = 24;
        const geo = new BufferGeometry();
        geo.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
        this.sparkVel = new Float32Array(n * 3);
        this.sparks = new Points(geo, new ShaderMaterial({
          uniforms: { uFade: { value: 0 } },
          vertexShader: 'void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = 18.0 / max(0.2, -mv.z); }',
          fragmentShader: 'uniform float uFade; void main(){ float d = length(gl_PointCoord-0.5)*2.0; gl_FragColor = vec4(vec3(1.0,0.75,0.35)*(1.0-d)*uFade, 1.0); }',
          blending: AdditiveBlending,
          depthWrite: false,
          transparent: true,
        }));
        this.sparks.frustumCulled = false;
        this.shore.add(this.sparks);
        this.track(this.sparks);
      }

      // The biped, its rocks and its stick (with something to roast on the end).
      this.biped = new Biped((color) => mat(color));
      this.biped.root.position.copy(BIPED_AT);
      this.biped.root.rotation.y = BIPED_YAW;
      this.shore.add(this.biped.root);
      const rockA = new Mesh(new DodecahedronGeometry(0.065, 0), mat('#8a8279'));
      const rockB = new Mesh(new DodecahedronGeometry(0.06, 0), mat('#9a9188'));
      this.disposables.push(rockA.geometry, rockB.geometry);
      rockA.position.y = -0.05;
      rockB.position.y = -0.05;
      rockA.castShadow = rockB.castShadow = true;
      this.biped.hands[0].add(rockA);
      this.biped.hands[1].add(rockB);
      this.rocks = [rockA, rockB];

      const stickGeo = new CylinderGeometry(0.011, 0.015, STICK_LENGTH, 5);
      stickGeo.rotateX(Math.PI / 2);
      stickGeo.translate(0, 0, STICK_LENGTH / 2);
      this.disposables.push(stickGeo);
      const stickMesh = new Mesh(stickGeo, mat('#7d5a3a'));
      stickMesh.castShadow = true;
      this.stick.add(stickMesh);
      this.lump = new Mesh(new CylinderGeometry(0.035, 0.035, 0.11, 6), mat('#e9a38a'));
      this.disposables.push(this.lump.geometry);
      this.lump.rotation.x = Math.PI / 2;
      this.lump.position.z = STICK_LENGTH - 0.07;
      this.lump.castShadow = true;
      this.stick.add(this.lump);
      this.shore.add(this.stick);

      // The speck: a dust bunny no bigger than a crumb, sat in the sand by the stick.
      this.speckView = new BunnyView(stillBunny(0.017, 'dust'), new EventBus(), opts.look);
      // BunnyView places its root at the Bunny's position (the origin): move a parent instead.
      this.speck.position.copy(SPECK_AT);
      this.speck.rotation.y = 0.6;
      this.speck.add(this.speckView.root);
      this.shore.add(this.speck);
      // The rocks, put down beside where it squatted once the fire is going.
      for (const [i, [x, z]] of ([[-0.42, 0.32], [-0.5, 0.42]] as const).entries()) {
        const r = new Mesh(this.rocks[i]!.geometry, this.rocks[i]!.material);
        r.position.set(x, 0.035, z);
        r.castShadow = true;
        this.groundRocks.push(r);
        this.shore.add(r);
      }

      const sun = new DirectionalLight('#ffd9a8', 2.4);
      sun.position.copy(SHORE.sunDir).multiplyScalar(8).setY(5);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.camera.left = sun.shadow.camera.bottom = -4;
      sun.shadow.camera.right = sun.shadow.camera.top = 4;
      sun.shadow.camera.near = 0.5;
      sun.shadow.camera.far = 20;
      sun.shadow.bias = -0.0008;
      sun.shadow.normalBias = 0.02;
      this.shore.add(sun, sun.target, new HemisphereLight('#ffeedd', '#7a5f4a', 1.25));
    }

    this.setShot('bunny');
  }

  private track(o: Mesh | Points): void {
    this.disposables.push(o.geometry, o.material as Material);
  }

  /** A shot starts: shows its set. */
  setShot(shot: EndingShot): void {
    this.shot = shot;
    const inSpace = shot === 'bunny' || shot === 'core';
    const inCosmos = shot === 'bang' || shot === 'planet';
    const onShore = shot === 'fire' || shot === 'stick' || shot === 'speck';
    this.space.visible = inSpace;
    this.cosmos.visible = inCosmos;
    this.shore.visible = onShore;
    this.scene.background = onShore ? SHORE.horizon : SPACE_BG;
    this.scene.fog = onShore ? new Fog(SHORE.horizon, 14, 60) : null;
    if (shot === 'stick') this.dropFrom = null;
    if (shot === 'fire') this.sparkAge = 9;
  }

  /**
   * Advances shot `shot` to `t` seconds of `hold` and places the camera. Returns the veil for
   * the screen to draw over the canvas.
   */
  update(dt: number, shot: EndingShot, t: number, hold: number): EndingVeil {
    if (shot !== this.shot) this.setShot(shot);
    this.time += dt;
    const u = hold > 0 ? clamp01(t / hold) : 1;
    const slow = this.reduced ? 0.6 : 1;
    switch (shot) {
      case 'bunny': {
        this.bunnyView.update(1, dt);
        const d = lerp(7.2, 4.4, easeOut(u) * slow + (1 - slow) * u * 0.5);
        this.lookFrom(new Vector3(0, 1.0, 0), d, 0.28, 0.05);
        return { color: 'black', opacity: 1 - smooth(0, 0.8, t) };
      }
      case 'core': {
        this.bunnyView.update(1, dt);
        const start = lerp(7.2, 4.4, this.reduced ? 0.8 : 1);
        const d = lerp(start, this.reduced ? 2.2 : 1.15, smooth(0, 1, u));
        this.lookFrom(new Vector3(0, lerp(1.0, 0.8, smooth(0, 1, u)), 0), d, 0.28 * (1 - u * 0.8), 0.05);
        return { color: 'black', opacity: smooth(0.35, 0.92, u) };
      }
      case 'bang': {
        const delay = this.reduced ? ENDING_BEATS.bang.atReduced : ENDING_BEATS.bang.at;
        this.moteU.uTime!.value = t - delay;
        this.moteU.uBurstK!.value = this.reduced ? 0.9 : 2.4;
        this.moteU.uGather!.value = 0;
        this.moteU.uFlat!.value = 0;
        this.moteU.uInfall!.value = 0;
        this.moteU.uFade!.value = t < delay ? 0 : 1;
        this.planet.visible = false;
        this.planetGlow.visible = false;
        // A hot core where it all came from, fading as the motes fly.
        this.bangGlow.visible = t >= delay;
        this.bangGlow.scale.setScalar(lerp(2, 7, easeOut((t - delay) / (this.reduced ? 2 : 0.8))));
        this.bangGlowU.uStrength!.value = 1.4 * (1 - smooth(delay, delay + (this.reduced ? 2.6 : 1.8), t));
        this.camera.position.set(0, 0.6, 9);
        this.camera.lookAt(0, 0, 0);
        this.moteU.uScale!.value = this.pointScale();
        if (this.reduced) return { color: 'white', opacity: 0.55 * smooth(0, 0.4, t) * (1 - smooth(0.5, 1.6, t)) };
        return { color: 'white', opacity: t < delay ? 1 : 1 - smooth(delay, delay + 0.7, t) };
      }
      case 'planet': {
        // Paced for a 6 s shot (a longer caption stretches it).
        const k6 = hold / 6;
        const at = (sec: number): number => sec * k6;
        this.moteU.uTime!.value = ENDING_BANG_SECONDS + t;
        this.moteU.uGather!.value = smooth(0, at(1.8), t);
        this.moteU.uFlat!.value = smooth(at(1.2), at(2.8), t);
        this.moteU.uInfall!.value = smooth(at(2.2), at(3.6), t);
        this.moteU.uFade!.value = 1 - smooth(hold - 2.2, hold, t) * 0.7;
        this.moteU.uScale!.value = this.pointScale();
        // The ball forms in the disc, cools (white, orange, grey), then the sea and the green come.
        const grow = easeOut((t - at(2.0)) / at(1.3));
        this.planet.visible = grow > 0;
        this.planet.scale.setScalar(Math.max(0.001, grow) * 0.9);
        this.planet.rotation.y += dt * 0.25;
        this.planetU.uHeat!.value = 1 - smooth(at(2.8), at(4.4), t);
        this.planetU.uOcean!.value = smooth(at(4.2), at(5.1), t);
        this.planetU.uLand!.value = smooth(at(4.9), at(5.8), t);
        this.planetGlow.visible = this.planet.visible;
        this.planetGlow.scale.setScalar(grow * 2.6);
        this.planetGlowU.uStrength!.value = 0.2 + 0.9 * (this.planetU.uHeat!.value as number);
        (this.planetGlowU.uColor!.value as Color).set('#ffd8a8').lerp(new Color('#7fb2ff'), this.planetU.uOcean!.value as number);
        this.bangGlow.visible = false;
        // From above the disc, down and in towards the planet (sat a little high, above the caption).
        const k = this.reduced ? smooth(0, 1, u) : easeOut(u);
        this.camera.position.set(lerp(1.2, 0.6, k), lerp(4.6, 0.75, k), lerp(7.6, 3.1, k));
        this.camera.lookAt(0, lerp(0, -0.28, k), 0);
        return { color: 'black', opacity: 0 };
      }
      case 'fire':
        this.updateFire(dt, t);
        return { color: 'black', opacity: 0 };
      case 'stick':
        this.updateStick(dt, t, hold);
        return { color: 'black', opacity: 0 };
      case 'speck': {
        // Nobody is left: the stick on the sand, the fire behind it and the speck beside it.
        this.biped.root.visible = false;
        this.stick.visible = true;
        this.lump.visible = false;
        this.stick.position.copy(STICK_REST);
        this.stick.quaternion.copy(STICK_REST_Q);
        this.speck.visible = true;
        for (const r of this.groundRocks) r.visible = true;
        this.animateShore(dt);
        this.speckView.update(1, dt);
        const k = smooth(0, 1, u) * (this.reduced ? 0.4 : 1);
        const at = new Vector3().lerpVectors(STICK_MID, SPECK_AT, 0.5).setY(0.02);
        this.camera.position.set(at.x + lerp(0.17, 0.13, k), lerp(0.1, 0.075, k), at.z + lerp(0.4, 0.3, k));
        this.camera.lookAt(at);
        return { color: 'black', opacity: 0 };
      }
      default:
        return { color: 'black', opacity: 1 };
    }
  }

  /** Points are sized in world units: pixels per unit at distance 1. */
  private pointScale(): number {
    return 0.02 * (window.innerHeight || 720) / Math.tan((this.camera.fov * Math.PI) / 360);
  }

  /** Camera at `dist` from `target`, raised by `rise` × dist and off to the side by `side` × dist. */
  private lookFrom(target: Vector3, dist: number, rise: number, side: number): void {
    const dir = new Vector3(side, rise, 1).normalize();
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.camera.lookAt(target);
  }

  /** Water ripples and the fire's flicker (once lit). */
  private animateShore(dt: number, fire = 1): void {
    const pos = this.water.geometry.getAttribute('position') as BufferAttribute;
    const base = this.waterBase;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3]!;
      const z = base[i * 3 + 2]!;
      pos.setY(i, base[i * 3 + 1]! + Math.sin(x * 0.9 + this.time * 1.3) * 0.03 + Math.sin(z * 1.4 - this.time * 0.9) * 0.025);
    }
    pos.needsUpdate = true;
    this.water.geometry.computeVertexNormals();
    for (const [i, f] of this.flames.entries()) {
      const s = (f.userData.size as number) * fire;
      const flick = 1 + Math.sin(this.time * (11 + i * 3.1) + i) * 0.12 + Math.sin(this.time * (23 + i * 5.3)) * 0.07;
      f.visible = s > 0.01;
      f.scale.set(0.12 * s, 0.36 * s * flick, 0.12 * s);
      f.rotation.y = this.time * (0.6 + i * 0.4);
    }
    const flicker = 1 + Math.sin(this.time * 13) * 0.13 + Math.sin(this.time * 31) * 0.08;
    this.fireLight.intensity = fire * 2.6 * flicker;
    this.fireGlowU.uStrength!.value = fire * 0.55 * flicker;
    if (this.sparkAge < 2) {
      this.sparkAge += dt;
      const p = this.sparks.geometry.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        p.setXYZ(i, p.getX(i) + this.sparkVel[i * 3]! * dt, p.getY(i) + this.sparkVel[i * 3 + 1]! * dt, p.getZ(i) + this.sparkVel[i * 3 + 2]! * dt);
        this.sparkVel[i * 3 + 1]! -= 3 * dt;
      }
      p.needsUpdate = true;
      (this.sparks.material as ShaderMaterial).uniforms.uFade!.value = Math.max(0, 1 - this.sparkAge * 3.5);
    }
  }

  private spark(at: Vector3): void {
    this.sparkAge = 0;
    const p = this.sparks.geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      p.setXYZ(i, at.x, at.y, at.z);
      const a = Math.random() * Math.PI * 2;
      const s = 0.4 + Math.random() * 0.9;
      this.sparkVel.set([Math.cos(a) * s, 0.6 + Math.random() * 1.2, Math.sin(a) * s], i * 3);
    }
    p.needsUpdate = true;
  }

  private updateFire(dt: number, t: number): void {
    const B = ENDING_BEATS.fire;
    const lit = smooth(B.lit, B.lit + 0.7, t);
    // Squat, then strike: the hands come together on each beat and part again.
    let strike = 0;
    for (const s of B.strikes) strike = Math.max(strike, Math.exp(-(((t - s) / 0.09) ** 2)));
    const ready = smooth(0.3, 0.9, t) * (1 - smooth(B.lit + 0.2, B.lit + 0.8, t));
    const pleased = smooth(B.lit + 0.5, B.lit + 1.2, t);
    const pose = { ...SQUAT };
    pose.lShoulderZ = lerp(0.35, -0.12, strike) + ready * 0.1;
    pose.rShoulderZ = lerp(-0.35, 0.12, strike) - ready * 0.1;
    pose.lShoulder = pose.rShoulder = lerp(-0.9, -1.25, ready) - strike * 0.1;
    // Pleased: sits back, chin up, hands up a little, a small bounce.
    pose.lean = lerp(SQUAT.lean, -0.05, pleased);
    pose.headX = lerp(SQUAT.headX, -0.05, pleased);
    pose.headZ = Math.sin(this.time * 3) * 0.1 * pleased;
    pose.lShoulder = lerp(pose.lShoulder, -1.9, pleased);
    pose.rShoulder = lerp(pose.rShoulder, -1.9, pleased);
    pose.lShoulderZ = lerp(pose.lShoulderZ, 0.5, pleased);
    pose.rShoulderZ = lerp(pose.rShoulderZ, -0.5, pleased);
    pose.hipY += Math.abs(Math.sin(this.time * 6)) * 0.03 * pleased;
    this.biped.pose(pose);
    this.biped.mood(pleased);
    this.rocks[0].visible = this.rocks[1].visible = true;
    for (const r of this.groundRocks) r.visible = false;
    this.stick.visible = false;
    this.speck.visible = false;
    this.biped.root.visible = true;
    this.biped.root.position.copy(BIPED_AT);
    this.biped.root.rotation.y = BIPED_YAW;
    for (const s of B.strikes) {
      if (t - dt < s && t >= s) {
        const hand = new Vector3();
        this.biped.hands[0].getWorldPosition(hand);
        const other = new Vector3();
        this.biped.hands[1].getWorldPosition(other);
        this.spark(hand.lerp(other, 0.5));
      }
    }
    this.animateShore(dt, lit);
    const k = this.reduced ? t * 0.02 : t * 0.04;
    this.camera.position.set(0.55 - k, 1.05, 2.9 - k);
    this.camera.lookAt(-0.32, 0.42, -0.05);
  }

  private updateStick(dt: number, t: number, hold: number): void {
    const B = ENDING_BEATS.stick;
    this.rocks[0].visible = this.rocks[1].visible = false;
    for (const r of this.groundRocks) r.visible = true;
    this.speck.visible = false;
    this.stick.visible = true;
    this.biped.root.visible = true;
    const eating = smooth(B.eat - 0.35, B.eat, t) * (1 - smooth(B.drop - 0.25, B.drop, t));
    const rise = smooth(B.walk - 0.2, B.walk + 0.25, t);
    const walk = Math.max(0, t - B.walk - 0.15);
    // Roasting: right arm out over the fire, then up to the mouth; then up and away.
    const pose = mixPose(SQUAT, STAND, rise);
    pose.rShoulder = lerp(lerp(-1.25, -1.15, eating), STAND.rShoulder, rise);
    pose.rShoulderZ = lerp(lerp(-0.05, 0.25, eating), STAND.rShoulderZ, rise);
    pose.rElbow = lerp(lerp(-0.25, -0.9, eating), STAND.rElbow, rise);
    pose.headX = lerp(lerp(-0.25, 0.1, eating), 0, rise);
    const chew = t > B.eat && t < B.drop ? Math.abs(Math.sin((t - B.eat) * 14)) * 0.08 : 0;
    pose.headX += chew;
    if (walk > 0) {
      const ph = walk * 7.5;
      pose.lHip = Math.sin(ph) * 0.5;
      pose.rHip = -Math.sin(ph) * 0.5;
      pose.lKnee = Math.max(0, -Math.sin(ph)) * 0.7;
      pose.rKnee = Math.max(0, Math.sin(ph)) * 0.7;
      pose.lShoulder = -Math.sin(ph) * 0.4;
      pose.rShoulder = Math.sin(ph) * 0.4;
      pose.hipY = STAND.hipY + Math.abs(Math.cos(ph)) * 0.025;
    }
    this.biped.pose(pose);
    this.biped.mood(smooth(B.eat + 0.2, B.eat + 0.5, t) * 0.8);
    // Turn away from the fire and walk off along the beach.
    const turn = smooth(B.walk - 0.1, B.walk + 0.35, t);
    this.biped.root.rotation.y = lerp(BIPED_YAW, -Math.PI / 2 - 0.5, turn);
    const dir = new Vector3(Math.sin(this.biped.root.rotation.y), 0, Math.cos(this.biped.root.rotation.y));
    this.biped.root.position.copy(BIPED_AT).addScaledVector(dir, walk * 1.25);
    this.biped.root.updateMatrixWorld(true);

    // The stick: in the right hand pointing at the fire (or the mouth), then dropped.
    const hand = new Vector3();
    this.biped.hands[1].getWorldPosition(hand);
    if (t < B.drop) {
      const fireTip = new Vector3(0, 0.36, 0);
      const mouth = new Vector3();
      this.biped.mouthAnchor.getWorldPosition(mouth);
      // Over the fire the hand holds the end; to eat, the stick slides through the hand to the mouth.
      const tip = fireTip.lerp(mouth, eating);
      const along = tip.clone().sub(hand).normalize();
      this.stick.position.copy(hand).lerp(tip.clone().addScaledVector(along, -STICK_LENGTH), eating);
      this.stick.lookAt(tip);
      // It browns over the fire and goes in two bites.
      (this.lump.material as MeshStandardMaterial).color.set('#e9a38a').lerp(new Color('#8a4a28'), smooth(0, B.eat - 0.3, t));
      const bites = t < B.eat ? 1 : t < B.eat + 0.35 ? 0.55 : 0;
      this.lump.visible = bites > 0;
      this.lump.scale.set(1, bites || 1, 1);
      this.dropFrom = null;
    } else {
      this.lump.visible = false;
      this.dropFrom ??= { p: this.stick.position.clone(), q: this.stick.quaternion.clone() };
      const f = clamp01((t - B.drop) / 0.4);
      const fall = f * f;
      const bounce = f >= 1 ? Math.max(0, Math.sin((t - B.drop - 0.4) * 18) * 0.02 * Math.exp(-(t - B.drop - 0.4) * 8)) : 0;
      this.stick.position.lerpVectors(this.dropFrom.p, STICK_REST, fall).setY(lerp(this.dropFrom.p.y, STICK_REST.y, fall) + bounce);
      this.stick.quaternion.slerpQuaternions(this.dropFrom.q, STICK_REST_Q, easeOut(f));
    }
    this.animateShore(dt);
    // Push in on the stick on the ground.
    const push = smooth(B.drop - 0.2, hold, t) * (this.reduced ? 0.7 : 1);
    const from = new Vector3(0.45, 1.0, 2.6);
    const to = new Vector3(STICK_MID.x + 0.28, 0.3, STICK_MID.z + 0.62);
    this.camera.position.lerpVectors(from, to, push);
    const look = new Vector3(-0.3, 0.38, 0).lerp(STICK_MID, push);
    this.camera.lookAt(look);
  }

  /** Draws the ending (call instead of the Run's render). */
  render(renderer: WebGLRenderer): void {
    const el = renderer.domElement;
    const aspect = el.width / Math.max(1, el.height);
    if (Math.abs(this.camera.aspect - aspect) > 1e-3) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.bunnyView.dispose();
    this.speckView.dispose();
    for (const d of this.disposables) d.dispose();
    this.scene.clear();
  }
}
