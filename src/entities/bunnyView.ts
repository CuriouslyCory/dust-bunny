/**
 * Bunny visuals: a fuzzy dust ball (lumpy core + instanced shell fur with soft rim light) that
 * rolls, eyes that look where it is going, squash & stretch on Dash / absorb / hits, absorbed
 * Debris stuck to the surface (capped at TUNING.stuckCap) and a soft contact shadow. In the
 * Continent, snow-capped mountain peaks poke out of the fur in a few ranges (they grow in after
 * the arrival leap and roll with the ball). On the Globe a faint blue atmosphere glows round the
 * ball (a fresnel shell) and, from Dust Moon (Tier 14) on, the Moon sits half-buried in the fur.
 * In the Solar System the Bunny glows from within (plasma): the fur's roots and core shine warm,
 * a pulsing orange corona shell surrounds it and a point light on it lights what it rolls past
 * (`plasmaBoost` brightens it all when the Sun's light goes out, src/fx/solar.ts). Once it has
 * absorbed Sagittarius A* (`Bunny.form` 'black_hole', for the rest of the Run) the fur and core go
 * dark and an accretion disc of lint and a lensing shimmer surround it (blackHoleLook.ts); the eyes stay.
 * Appearance comes from a BunnyLook (the Character `look`), see bunnyLook.ts.
 *
 * Hierarchy: root (x, r·squashY, z) → body (yaw = heading, squash scale) → roll (fur, Debris)
 *                                                                        → eyes
 */
import {
  Color,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  PointLight,
  MeshStandardMaterial,
  Quaternion,
  ShaderMaterial,
  AdditiveBlending,
  SphereGeometry,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { EventBus } from '../core/events';
import { Disposables } from '../core/events';
import { lerp } from '../core/math';
import { Rng } from '../core/rng';
import { AREAS } from '../data/areas';
import type { DebrisType } from '../data/debris';
import { getDebrisType } from '../data/debris';
import { DISCHARGE } from '../data/abilities';
import { TUNING } from '../data/tuning';
import { getTier } from '../data/tiers';
import { ContactShadows } from '../fx/contactShadows';
import { getQuality } from '../fx/quality';
import { furTextures } from '../world/materials';
import type { Bunny } from './bunny';
import { BlackHoleLook, HOLE } from './blackHoleLook';
import { resolveLook, type BunnyLook } from './bunnyLook';
import { debrisColors, debrisGeometry, debrisMaterial } from './debrisGeometry';

interface StuckItem {
  type: DebrisType;
  /** Unit direction in the ball's rolling frame. */
  dir: Vector3;
  spin: number;
  size: number;
  colorIndex: number;
}

/** Damped spring used for squash & stretch. */
class Spring {
  value = 0;
  vel = 0;
  constructor(
    private readonly k: number,
    private readonly damping: number,
  ) {}
  kick(v: number): void {
    this.vel += v;
  }
  step(dt: number): number {
    // Semi-implicit Euler in small substeps for stability at low frame rates.
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.vel += (-this.k * this.value - this.damping * this.vel) * h;
      this.value += this.vel * h;
    }
    return this.value;
  }
}

const UP = new Vector3(0, 1, 0);
const _m = new Matrix4();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _inv = new Quaternion();
const _v = new Vector3();

/** Fur length at furLength = 1, as a fraction of the radius. */
const FUR_UNIT = 0.17;

/**
 * Mountain ranges in the fur (Continent): how many, their footprint radius as a fraction of the
 * Bunny's radius, how much taller than the model they stand (so they clear the fur), seconds to grow in.
 */
const PEAKS = { count: 9, size: [0.42, 0.6] as const, lift: 2, growSeconds: 1.4 };
/** The Globe's look: the atmosphere shell (radius in ball radii, colour) and the Moon lump (radius, direction in the rolling frame). */
const ORBIT = { glowRadius: 1.3, glow: '#8fd2ff', moonSize: 0.36, moonDir: [0.55, 0.62, -0.56] as const, growSeconds: 1.2 };
/** The Solar System's plasma: colour, inner glow (fur roots, core), corona shell strength, point light (intensity, reach in ball radii). */
const PLASMA = { color: '#ff9a3c', inner: 0.55, core: 0.35, shell: 1.25, light: 1.6, reach: 9 };
/** The black-hole form's colours: fur roots and core near-black, tips dim lint, a warm rim (the photon ring's light). */
const DARK = { root: new Color('#040309'), tip: new Color('#4a4060'), core: new Color('#020104'), rim: new Color('#ffa860') };

/** Fresnel rim shader: transparent face-on, glowing towards the silhouette (additive). */
function atmosphereMaterial(color: string): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uStrength: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uStrength; varying vec3 vN; varying vec3 vV;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float a = pow(f, 2.6) * uStrength;
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

function furCore(fluffiness: number): IcosahedronGeometry {
  const g = new IcosahedronGeometry(1, 5);
  const pos = g.getAttribute('position');
  const v = new Vector3();
  const amp = 0.04 + fluffiness * 0.06;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 9.1 + v.y * 7.3) * Math.cos(v.z * 8.7 - v.x * 3.1) * 0.5 + Math.sin(v.y * 23.1 + v.z * 19.7) * 0.25;
    v.multiplyScalar(1 + n * amp);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Adds a soft fresnel rim (in `rim` colour) to a standard material. */
function addRim(shader: WebGLProgramParametersWithUniforms, rim: { value: Color }, strength: { value: number }): void {
  shader.uniforms.uRim = rim;
  shader.uniforms.uRimStrength = strength;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uRim;\nuniform float uRimStrength;')
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float rimF = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
      totalEmissiveRadiance += uRim * pow(rimF, 2.5) * uRimStrength;`,
    );
}

const SHELL_VERT = /* glsl */ `
uniform float uShellCount;
uniform float uFurLength;
uniform vec3 uDrag;
varying float vShellH;
varying vec3 vFurDir;
`;

const SHELL_FRAG = /* glsl */ `
uniform float uShellCount;
uniform float uDensity;
uniform float uFluff;
uniform float uTime;
uniform float uGlow;
uniform vec3 uPlasma;
uniform vec3 uRoot;
uniform vec3 uTip;
varying float vShellH;
varying vec3 vFurDir;
vec3 furHash(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}
`;

export class BunnyView {
  readonly root = new Group();
  readonly look: Required<BunnyLook>;
  private readonly body = new Group();
  private readonly rollGroup = new Group();
  private readonly eyes = new Group();
  private readonly pupils: Group[] = [];
  private readonly lids: Mesh[] = [];
  private readonly ball: Mesh;
  private readonly shells: InstancedMesh;
  private readonly shadow: Mesh;
  private readonly furUniforms: Record<string, { value: unknown }>;
  private readonly rim = { value: new Color() };
  private readonly rimStrength = { value: 0.55 };
  /** Solar System only: the plasma glow, 0 elsewhere (fur roots and core), and its light. */
  private readonly plasma = new Color(PLASMA.color);
  private readonly coreMat: MeshStandardMaterial;
  private plasmaLight: PointLight | null = null;
  /** 0..1: extra plasma while the Sun's light goes out (set by the Solar System's look, src/fx/solar.ts). */
  plasmaBoost = 0;
  /** Mountain ranges in the fur (Continent only), in the rolling frame at unit radius. */
  private peaks: InstancedMesh | null = null;
  private readonly peakItems: Array<{ dir: Vector3; spin: number; size: number }> = [];
  private peakGrow = 0;
  /** The Globe's atmosphere shell (in the squashing body) and the Moon in the fur (rolling frame). */
  private atmosphere: Mesh | null = null;
  private moon: Group | null = null;
  private moonGrow = 0;
  /** The black-hole form (after Sagittarius A*): its disc and shimmer, 0..1 grown in, and the dust look's colours to darken from. */
  private hole: BlackHoleLook | null = null;
  private holeGrow = 0;
  private readonly dustColors: { root: Color; tip: Color; core: Color; rim: Color };
  private stuck: StuckItem[] = [];
  private stuckMeshes = new Map<string, InstancedMesh>();
  private stuckDirty = true;
  private lastStuckRadius = 0;
  private heading: number;
  private turn = 0;
  private blink = 0;
  private blinkTimer = 2;
  private time = 0;
  private readonly stretch = new Spring(90, 9);
  private readonly squash = new Spring(110, 8);
  private squeezeView = 1;
  /** 0..1 eased Hunker plant (flattens the ball onto the floor). */
  private plantView = 0;
  private wasDashing = false;
  private readonly disposables = new Disposables();

  constructor(
    private readonly bunny: Bunny,
    events: EventBus,
    look?: Partial<BunnyLook> | string,
  ) {
    this.root.name = 'bunny';
    this.look = typeof look === 'string' ? resolveLook(null, look) : resolveLook(look);
    const L = this.look;
    const base = new Color(L.color);
    const tip = new Color(L.tipColor);
    const rootCol = base.clone().multiplyScalar(0.62);
    this.rim.value.copy(tip).lerp(new Color('#fff3e0'), 0.35);
    const fur = furTextures();

    // Core: lumpy ball in the darker root colour (shows between strands).
    const coreMat = new MeshStandardMaterial({ color: rootCol, map: fur.map, roughness: 1 });
    coreMat.onBeforeCompile = (s) => addRim(s, this.rim, { value: 0.25 });
    this.coreMat = coreMat;
    this.ball = new Mesh(furCore(L.fluffiness), coreMat);
    this.ball.castShadow = true;
    this.rollGroup.add(this.ball);

    // Shell fur: one InstancedMesh, instance i = shell i (displaced in the vertex shader).
    const shellCount = getQuality() === 'low' ? 8 : 16;
    this.furUniforms = {
      uShellCount: { value: shellCount },
      uFurLength: { value: FUR_UNIT * L.furLength },
      uDrag: { value: new Vector3() },
      uDensity: { value: 24 - L.fluffiness * 8 },
      uFluff: { value: L.fluffiness },
      uTime: { value: 0 },
      uGlow: { value: L.glow },
      uPlasma: { value: new Color(0, 0, 0) },
      uRoot: { value: rootCol.clone().lerp(base, 0.4) },
      uTip: { value: tip },
    };
    const shellMat = new MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
    shellMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.furUniforms);
      addRim(shader, this.rim, this.rimStrength);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${SHELL_VERT}`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float shellH = (float(gl_InstanceID) + 1.0) / uShellCount;
          vShellH = shellH;
          vFurDir = normalize(position);
          transformed = position * (1.0 + uFurLength * shellH) + uDrag * (shellH * shellH);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${SHELL_FRAG}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          // Strands bend in coherent clumps (more with fluffiness) so the fur reads as soft fluff.
          vec3 clump = furHash(floor(vFurDir * uDensity * 0.35)) - 0.5;
          vec3 bent = normalize(vFurDir - clump * vShellH * vShellH * (0.06 + 0.18 * uFluff));
          vec3 fp = bent * uDensity;
          vec3 cell = floor(fp);
          vec3 rnd = furHash(cell);
          vec3 cdir = normalize(cell + 0.2 + 0.6 * rnd);
          float fd = length(bent - cdir) * uDensity;
          float strandLen = mix(1.0, 0.3 + 0.7 * rnd.x, uFluff);
          float hh = vShellH / strandLen;
          if (hh > 1.0) discard;
          float thick = mix(0.85, 0.6, uFluff) * (1.0 - hh * 0.75);
          if (fd > thick) discard;
          float tone = 0.88 + 0.24 * rnd.z;
          diffuseColor.rgb = mix(uRoot, uTip, smoothstep(0.0, 1.0, vShellH)) * mix(0.72, 1.05, vShellH) * tone;`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float spark = step(0.9, fract(rnd.y * 17.0 + uTime * (2.0 + rnd.z * 3.0))) * hh;
          totalEmissiveRadiance += uTip * uGlow * (0.4 + spark * 5.0) * vShellH;
          totalEmissiveRadiance += uPlasma * (1.0 - vShellH * 0.75) * (0.7 + 0.6 * rnd.x);`,
        );
    };
    shellMat.customProgramCacheKey = () => 'bunny-shell-fur';
    this.shells = new InstancedMesh(new SphereGeometry(1, 48, 32), shellMat, shellCount);
    this.shells.frustumCulled = false;
    this.shells.castShadow = false;
    this.shells.receiveShadow = true;
    this.rollGroup.add(this.shells);

    this.dustColors = { root: (this.furUniforms.uRoot!.value as Color).clone(), tip: tip.clone(), core: coreMat.color.clone(), rim: this.rim.value.clone() };
    // A view built after the change (a later Area) shows it at once.
    if (bunny.form === 'black_hole') this.holeGrow = 1;

    this.body.add(this.rollGroup);
    this.buildEyes();
    this.body.add(this.eyes);
    this.root.add(this.body);

    const cs = new ContactShadows();
    cs.add(0, 0, 0.45, 0.45, 0.75, 0.6, 0.45, 0);
    this.shadow = cs.build();
    this.shadow.name = 'bunnyShadow';
    this.root.add(this.shadow);

    this.heading = bunny.heading;

    this.disposables.add(
      events.on('debrisAbsorbed', (e) => {
        const r = Math.max(0.01, this.bunny.radius);
        this.squash.kick(Math.min(3.5, 0.6 + (e.size / r) * 6));
        if (e.kind !== 'debris') return;
        const type = getDebrisType(e.typeId);
        if (type) this.stick(type, e.position.x, e.position.z, e.size);
      }),
    );
    this.disposables.add(
      events.on('bunnyRebased', (e) => {
        // New Area unit: the Debris stuck in the fur keeps its real size (rooftops and cars in the Region).
        for (const s of this.stuck) s.size *= e.factor;
        this.stuckDirty = true;
      }),
    );
    this.disposables.add(
      events.on('bunnyLeapt', () => {
        // The off-screen leap into the Continent: stuck Debris keeps its size, so the Region's
        // towns drop out of the fur (rebuildStuck culls what is now too small).
        this.stuckDirty = true;
        this.squash.kick(5);
      }),
    );
    this.disposables.add(events.on('dashStarted', () => this.stretch.kick(5.5)));
    this.disposables.add(events.on('bunnyDamaged', () => this.squash.kick(-4)));
    this.disposables.add(events.on('tierUp', () => this.squash.kick(5)));
  }

  /**
   * Mountain ranges poking out of the fur: the Continent's `mountain_range` Debris (its Blender
   * model when loaded: foothills, rock, snow caps) stood up along the surface, spread over the ball.
   * Built on first use, once the models have loaded.
   */
  private buildPeaks(): InstancedMesh | null {
    const type = getDebrisType('mountain_range');
    if (!type) return null;
    const rng = new Rng('bunny-peaks');
    for (let tries = 0; this.peakItems.length < PEAKS.count && tries < 400; tries++) {
      const dir = new Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1));
      if (dir.lengthSq() < 0.05 || dir.lengthSq() > 1) continue;
      dir.normalize();
      if (this.peakItems.some((p) => p.dir.angleTo(dir) < 0.7)) continue;
      this.peakItems.push({ dir, spin: rng.range(0, Math.PI * 2), size: rng.range(...PEAKS.size) });
    }
    const mesh = new InstancedMesh(debrisGeometry(type), debrisMaterial(type), this.peakItems.length);
    const white = new Color('#ffffff');
    for (let i = 0; i < this.peakItems.length; i++) mesh.setColorAt(i, white);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.rollGroup.add(mesh);
    return mesh;
  }

  /** Places the ranges at `grow` (0..1) of their height, their foot just inside the fur's outer shell. */
  private placePeaks(peaks: InstancedMesh, grow: number): void {
    const out = 1 + FUR_UNIT * this.look.furLength * 0.2;
    this.peakItems.forEach((p, i) => {
      _q.setFromUnitVectors(UP, p.dir);
      _q2.setFromAxisAngle(UP, p.spin);
      _q.multiply(_q2);
      _p.copy(p.dir).multiplyScalar(out - p.size * 0.06);
      _s.set(p.size * (0.5 + grow * 0.5), p.size * PEAKS.lift * grow, p.size * (0.5 + grow * 0.5));
      peaks.setMatrixAt(i, _m.compose(_p, _q, _s));
    });
    peaks.instanceMatrix.needsUpdate = true;
  }

  /** The atmosphere: a fresnel shell a little outside the fur, faint blue at the silhouette. */
  private buildAtmosphere(): Mesh {
    const mesh = new Mesh(new SphereGeometry(ORBIT.glowRadius, 48, 24), atmosphereMaterial(ORBIT.glow));
    mesh.renderOrder = 3;
    mesh.name = 'atmosphere';
    this.body.add(mesh);
    return mesh;
  }

  /** The plasma's light: warm, no shadows, a little above the ball, fading out at `PLASMA.reach` ball radii. */
  private buildPlasmaLight(): PointLight {
    const light = new PointLight(PLASMA.color, PLASMA.light, 10, 0);
    light.castShadow = false;
    light.position.set(0, 0.6, 0);
    light.name = 'plasmaLight';
    this.root.add(light);
    return light;
  }

  /** The black-hole form's accretion disc and lensing shimmer, round the ball (not rolling, not squashed). */
  private buildHole(): BlackHoleLook {
    const hole = new BlackHoleLook();
    this.root.add(hole.root);
    return hole;
  }

  /** The Moon (the `moon` Debris: its Blender prop when loaded) half-buried in the fur, rolling with the ball. */
  private buildMoon(): Group | null {
    const type = getDebrisType('moon');
    if (!type) return null;
    const pivot = new Group();
    const dir = new Vector3(...ORBIT.moonDir).normalize();
    pivot.quaternion.setFromUnitVectors(UP, dir);
    const mesh = new Mesh(debrisGeometry(type), debrisMaterial(type));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    pivot.add(mesh);
    pivot.name = 'moonLump';
    // A holder at the ball's radius (the rolling frame is in world units, like the peaks' mesh).
    const holder = new Group();
    holder.add(pivot);
    this.rollGroup.add(holder);
    return pivot;
  }

  /** Places the Moon at `grow` (0..1): its centre just outside the fur, so a little more than half shows. */
  private placeMoon(moon: Group, grow: number): void {
    const s = ORBIT.moonSize * grow;
    const out = 1 + FUR_UNIT * this.look.furLength * 0.2;
    const dir = new Vector3(0, 1, 0).applyQuaternion(moon.quaternion);
    moon.position.copy(dir).multiplyScalar(out - s * 0.8);
    moon.scale.setScalar(Math.max(1e-3, s));
  }

  private buildEyes(): void {
    const L = this.look;
    const sparkly = L.eyeStyle === 'sparkly';
    const sleepy = L.eyeStyle === 'sleepy';
    const white = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.25, emissive: '#ffffff', emissiveIntensity: 0.12 });
    const black = new MeshStandardMaterial({ color: '#141018', roughness: 0.15 });
    const shine = new MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1 });
    const lidMat = new MeshStandardMaterial({ color: new Color(L.color).multiplyScalar(0.85), roughness: 1 });
    const eyeGeo = new SphereGeometry(1, 20, 14);
    const lidGeo = new SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const out = 1 + FUR_UNIT * L.furLength * 0.55;
    const size = sparkly ? 1.12 : 1;
    for (const s of [-1, 1]) {
      const eye = new Group();
      const w = new Mesh(eyeGeo, white);
      w.scale.set(0.2 * size, 0.24 * size, 0.12);
      const pupil = new Group();
      const p = new Mesh(eyeGeo, black);
      p.scale.set((sparkly ? 0.15 : 0.12) * size, (sparkly ? 0.18 : 0.15) * size, 0.08);
      const h = new Mesh(eyeGeo, shine);
      h.scale.setScalar(sparkly ? 0.045 : 0.035);
      h.position.set(0.045, 0.065, 0.09);
      pupil.add(p, h);
      if (sparkly) {
        const h2 = new Mesh(eyeGeo, shine);
        h2.scale.setScalar(0.022);
        h2.position.set(-0.05, -0.05, 0.09);
        pupil.add(h2);
      }
      pupil.position.z = 0.06;
      this.pupils.push(pupil);
      eye.add(w, pupil);
      const lid = new Mesh(lidGeo, lidMat);
      lid.scale.set(0.215 * size, 0.255 * size, 0.135);
      lid.visible = sleepy;
      eye.add(lid);
      this.lids.push(lid);
      const dir = _v.set(s * 0.33, 0.3, 0.9).normalize();
      eye.position.copy(dir).multiplyScalar(out);
      eye.lookAt(dir.x * 3, dir.y * 3 + 0.3, dir.z * 3);
      this.eyes.add(eye);
    }
  }

  private stick(type: DebrisType, wx: number, wz: number, size: number): void {
    const b = this.bunny;
    const dir = new Vector3(wx - b.x, 0, wz - b.z);
    if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
    dir.normalize();
    // Spread over the visible hemisphere rather than only the equator.
    dir.y = Math.random() * 1.6 - 0.5;
    dir.normalize();
    _inv.copy(b.rollQuat).invert();
    dir.applyQuaternion(_inv);
    this.stuck.push({ type, dir, spin: Math.random() * Math.PI * 2, size, colorIndex: Math.floor(Math.random() * type.colors.length) });
    this.stuckDirty = true;
  }

  private rebuildStuck(radius: number): void {
    const minSize = radius * TUNING.stuckMinRatio;
    this.stuck = this.stuck.filter((s) => s.size >= minSize);
    if (this.stuck.length > TUNING.stuckCap) {
      // Keep the biggest (ties: most recent).
      const keep = [...this.stuck].map((s, i) => ({ s, i })).sort((a, b) => b.s.size - a.s.size || b.i - a.i).slice(0, TUNING.stuckCap);
      const set = new Set(keep.map((k) => k.s));
      this.stuck = this.stuck.filter((s) => set.has(s));
    }
    const byType = new Map<string, StuckItem[]>();
    for (const s of this.stuck) {
      let list = byType.get(s.type.id);
      if (!list) byType.set(s.type.id, (list = []));
      list.push(s);
    }
    for (const [id, mesh] of this.stuckMeshes) {
      if (!byType.has(id)) mesh.count = 0;
    }
    const furOut = radius * (1 + FUR_UNIT * this.look.furLength * 0.35);
    for (const [id, list] of byType) {
      let mesh = this.stuckMeshes.get(id);
      if (!mesh || mesh.instanceMatrix.count < list.length) {
        mesh?.removeFromParent();
        mesh?.dispose();
        const type = list[0]!.type;
        mesh = new InstancedMesh(debrisGeometry(type), debrisMaterial(type), Math.max(16, list.length * 2));
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        this.stuckMeshes.set(id, mesh);
        this.rollGroup.add(mesh);
      }
      const colors = debrisColors(list[0]!.type);
      list.forEach((s, i) => {
        _q.setFromUnitVectors(UP, s.dir);
        _q2.setFromAxisAngle(UP, s.spin);
        _q.multiply(_q2);
        _p.copy(s.dir).multiplyScalar(furOut - s.size * 0.3);
        _s.setScalar(s.size);
        mesh!.setMatrixAt(i, _m.compose(_p, _q, _s));
        mesh!.setColorAt(i, colors[s.colorIndex]!);
      });
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.stuckDirty = false;
    this.lastStuckRadius = radius;
  }

  get stuckCount(): number {
    return this.stuck.length;
  }

  update(alpha: number, frameDt: number): void {
    const b = this.bunny;
    const dt = Math.min(frameDt, 0.1);
    this.time += dt;
    const r = lerp(b.prevRadius, b.radius, alpha);
    const x = lerp(b.prevX, b.x, alpha);
    const z = lerp(b.prevZ, b.z, alpha);
    const speedN = Math.min(1.5, b.speed / Math.max(0.01, r * 3));

    // Heading (smoothed) and turn rate for the pupils.
    let dh = b.heading - this.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const step = dh * Math.min(1, dt * 10);
    this.heading += step;
    this.turn = lerp(this.turn, dt > 0 ? step / dt : 0, Math.min(1, dt * 8));

    // Squash & stretch: springs plus a gentle speed stretch and idle breathing.
    if (b.dashing && !this.wasDashing) this.stretch.kick(2);
    this.wasDashing = b.dashing;
    const st = Math.max(-0.35, Math.min(0.5, this.stretch.step(dt) + speedN * 0.06));
    const sq = Math.max(-0.3, Math.min(0.35, this.squash.step(dt) + Math.sin(this.time * 2.4) * 0.012));
    // Squeezing through a doorway: narrower across, longer along the heading (volume kept).
    this.squeezeView = lerp(this.squeezeView, b.squeeze, Math.min(1, dt * 12));
    // Hunker: settle low and wide, like a rock.
    this.plantView = lerp(this.plantView, b.hunkered ? 1 : 0, Math.min(1, dt * 14));
    const plantWide = 1 + this.plantView * 0.12;
    const sz = (((1 + st) * (1 + sq * 0.5)) / this.squeezeView) * plantWide;
    const sxy = 1 / Math.sqrt(1 + st);
    const sy = sxy * (1 - sq) * (1 - this.plantView * 0.24);
    const sx = sxy * (1 + sq * 0.5) * this.squeezeView * plantWide;
    this.body.scale.set(sx, sy, sz);
    this.body.rotation.y = this.heading;
    this.root.position.set(x, r * sy, z);

    // Roll in world space: undo the body's yaw.
    _q.setFromAxisAngle(UP, this.heading).invert();
    this.rollGroup.quaternion.copy(_q).multiply(b.rollQuat);
    this.ball.scale.setScalar(r);
    this.shells.scale.setScalar(r);
    // Mountain peaks in the fur while in the Continent (grow in after the leap).
    const continent = b.unit === AREAS.continent.unit;
    if (continent) this.peaks ??= this.buildPeaks();
    if (this.peaks) {
      if (continent && this.peakGrow < 1) {
        this.peakGrow = Math.min(1, this.peakGrow + dt / PEAKS.growSeconds);
        this.placePeaks(this.peaks, 1 - (1 - this.peakGrow) ** 3);
      } else if (!continent && this.peakGrow > 0) this.peakGrow = 0;
      this.peaks.visible = continent;
      this.peaks.scale.setScalar(r);
    }
    // The Globe: the atmosphere glow, and the Moon in the fur from Dust Moon (Tier 14) on.
    const orbit = b.unit === AREAS.globe.unit;
    // The Solar System: plasma glowing from within, a pulsing corona shell and a light on the Bunny.
    const solar = b.unit === AREAS.solar_system.unit;
    const pulse = solar ? 1 + Math.sin(this.time * 2.3) * 0.12 + Math.sin(this.time * 5.1) * 0.05 : 0;
    const boost = solar ? this.plasmaBoost : 0;
    if (orbit || solar) this.atmosphere ??= this.buildAtmosphere();
    if (this.atmosphere) {
      this.atmosphere.visible = orbit || solar;
      const u = (this.atmosphere.material as ShaderMaterial).uniforms;
      (u.uColor!.value as Color).set(solar ? PLASMA.color : ORBIT.glow);
      u.uStrength!.value = solar ? PLASMA.shell * pulse * (1 + boost) : 0.9;
      this.atmosphere.scale.setScalar(r * (solar ? 1.08 + boost * 0.15 : 1));
    }
    (this.furUniforms.uPlasma!.value as Color).copy(this.plasma).multiplyScalar(solar ? PLASMA.inner * pulse * (1 + boost * 1.5) : 0);
    this.coreMat.emissive.copy(this.plasma).multiplyScalar(solar ? PLASMA.core * pulse * (1 + boost) : 0);
    if (solar) this.plasmaLight ??= this.buildPlasmaLight();
    if (this.plasmaLight) {
      this.plasmaLight.visible = solar;
      this.plasmaLight.intensity = PLASMA.light * pulse * (1 + boost * 1.5);
      this.plasmaLight.distance = r * PLASMA.reach * (1 + boost * 0.5);
      this.plasmaLight.position.y = r * 0.4;
    }
    // The black-hole form: dark fur and core, the accretion disc and the lensing shimmer grow in.
    const holeOn = b.form === 'black_hole';
    if (holeOn) this.hole ??= this.buildHole();
    if (this.hole) {
      this.holeGrow = holeOn ? Math.min(1, this.holeGrow + dt / HOLE.growSeconds) : 0;
      const g = 1 - (1 - this.holeGrow) ** 3;
      const D = this.dustColors;
      (this.furUniforms.uRoot!.value as Color).copy(D.root).lerp(DARK.root, g);
      (this.furUniforms.uTip!.value as Color).copy(D.tip).lerp(DARK.tip, g);
      this.coreMat.color.copy(D.core).lerp(DARK.core, g);
      this.rim.value.copy(D.rim).lerp(DARK.rim, g);
      this.hole.update(dt, r, g, this.time);
    }
    const moonOn = orbit && b.realRadius >= getTier(14).minRadius;
    if (moonOn) this.moon ??= this.buildMoon();
    if (this.moon) {
      if (moonOn && this.moonGrow < 1) {
        this.moonGrow = Math.min(1, this.moonGrow + dt / ORBIT.growSeconds);
        this.placeMoon(this.moon, 1 - (1 - this.moonGrow) ** 3);
      } else if (!moonOn) this.moonGrow = 0;
      this.moon.visible = moonOn;
      this.moon.parent!.scale.setScalar(r);
    }
    if (this.stuckDirty || Math.abs(r - this.lastStuckRadius) > this.lastStuckRadius * 0.01) this.rebuildStuck(r);

    // Fur trails behind the motion (in the rolling frame).
    _v.set(b.vx, 0, b.vz);
    const sp = _v.length();
    if (sp > 1e-4) _v.multiplyScalar(-Math.min(0.12, (sp / Math.max(0.01, r)) * 0.012) / sp);
    _v.y = -0.02;
    _inv.copy(b.rollQuat).invert();
    (this.furUniforms.uDrag!.value as Vector3).lerp(_v.applyQuaternion(_inv), Math.min(1, dt * 6));
    this.furUniforms.uTime!.value = this.time;
    // Zap's glow follows the Static meter (glowBase + glowPerCharge × charge).
    const glow = b.staticCharge === null ? this.look.glow : DISCHARGE.glowBase + DISCHARGE.glowPerCharge * b.staticCharge;
    this.furUniforms.uGlow!.value = glow;
    this.rimStrength.value = 0.45 + glow * 0.8 - this.plantView * 0.15;

    // Eyes: blink, pupils follow turns and look ahead when moving.
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blink = 0.13;
      this.blinkTimer = (this.look.eyeStyle === 'sleepy' ? 3 : 2) + Math.random() * 3;
    }
    this.blink = Math.max(0, this.blink - dt);
    const blinking = this.blink > 0;
    const sleepy = this.look.eyeStyle === 'sleepy';
    // Sleepy eyes blink with their lids; the others squash shut.
    for (const lid of this.lids) lid.rotation.x = blinking ? Math.PI * 0.42 : 0.1 + Math.sin(this.time * 0.7) * 0.06;
    const look = Math.max(-1, Math.min(1, this.turn * 0.25));
    for (const p of this.pupils) p.position.set(look * 0.06, -0.02 * speedN + 0.01, 0.06);
    this.eyes.scale.setScalar(r);
    this.eyes.scale.y = r * (blinking && !sleepy ? 0.18 : 1);
    this.eyes.position.y = Math.sin(this.time * 6) * r * 0.015 * Math.min(1, speedN);

    // Contact shadow on the floor, under the (squashed) ball.
    this.shadow.position.y = -r * sy + 0.05;
    this.shadow.scale.set(r * sx * 1.1, 1, r * sz * 1.1);
    this.shadow.rotation.y = this.heading;

    // Invulnerability flicker.
    this.body.visible = b.invulnerable <= 0 || Math.floor(this.time * 15) % 2 === 0;
  }

  dispose(): void {
    this.disposables.dispose();
    for (const m of this.stuckMeshes.values()) m.dispose();
    // The geometry and material are the shared mountain_range Debris ones (debrisGeometry's cache).
    this.peaks?.dispose();
    if (this.atmosphere) {
      this.atmosphere.geometry.dispose();
      (this.atmosphere.material as ShaderMaterial).dispose();
    }
    this.hole?.dispose();
    this.shells.dispose();
    this.root.removeFromParent();
  }
}
