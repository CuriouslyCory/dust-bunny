/**
 * Bunny visuals: a fuzzy dust ball (lumpy core + instanced shell fur with soft rim light) that
 * rolls, eyes that look where it is going, squash & stretch on Dash / absorb / hits, absorbed
 * Debris stuck to the surface (capped at TUNING.stuckCap) and a soft contact shadow.
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
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { EventBus } from '../core/events';
import { Disposables } from '../core/events';
import { lerp } from '../core/math';
import type { DebrisType } from '../data/debris';
import { getDebrisType } from '../data/debris';
import { TUNING } from '../data/tuning';
import { ContactShadows } from '../fx/contactShadows';
import { getQuality } from '../fx/quality';
import { furTextures } from '../world/materials';
import type { Bunny } from './bunny';
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
          totalEmissiveRadiance += uTip * uGlow * (0.4 + spark * 5.0) * vShellH;`,
        );
    };
    shellMat.customProgramCacheKey = () => 'bunny-shell-fur';
    this.shells = new InstancedMesh(new SphereGeometry(1, 48, 32), shellMat, shellCount);
    this.shells.frustumCulled = false;
    this.shells.castShadow = false;
    this.shells.receiveShadow = true;
    this.rollGroup.add(this.shells);

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
    this.disposables.add(events.on('dashStarted', () => this.stretch.kick(5.5)));
    this.disposables.add(events.on('bunnyDamaged', () => this.squash.kick(-4)));
    this.disposables.add(events.on('tierUp', () => this.squash.kick(5)));
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
    const sz = (1 + st) * (1 + sq * 0.5);
    const sxy = 1 / Math.sqrt(1 + st);
    const sy = sxy * (1 - sq);
    const sx = sxy * (1 + sq * 0.5);
    this.body.scale.set(sx, sy, sz);
    this.body.rotation.y = this.heading;
    this.root.position.set(x, r * sy, z);

    // Roll in world space: undo the body's yaw.
    _q.setFromAxisAngle(UP, this.heading).invert();
    this.rollGroup.quaternion.copy(_q).multiply(b.rollQuat);
    this.ball.scale.setScalar(r);
    this.shells.scale.setScalar(r);
    if (this.stuckDirty || Math.abs(r - this.lastStuckRadius) > this.lastStuckRadius * 0.01) this.rebuildStuck(r);

    // Fur trails behind the motion (in the rolling frame).
    _v.set(b.vx, 0, b.vz);
    const sp = _v.length();
    if (sp > 1e-4) _v.multiplyScalar(-Math.min(0.12, (sp / Math.max(0.01, r)) * 0.012) / sp);
    _v.y = -0.02;
    _inv.copy(b.rollQuat).invert();
    (this.furUniforms.uDrag!.value as Vector3).lerp(_v.applyQuaternion(_inv), Math.min(1, dt * 6));
    this.furUniforms.uTime!.value = this.time;
    this.rimStrength.value = 0.45 + this.look.glow * 0.8;

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
    this.shells.dispose();
    this.root.removeFromParent();
  }
}
