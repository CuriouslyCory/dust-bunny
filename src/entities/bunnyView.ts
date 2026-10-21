/**
 * Bunny visuals: a lumpy fur ball with shell fur that rolls, eyes that face the heading,
 * and absorbed Debris stuck to the surface (capped at TUNING.stuckCap).
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
} from 'three';
import type { EventBus } from '../core/events';
import { Disposables } from '../core/events';
import { lerp } from '../core/math';
import type { DebrisType } from '../data/debris';
import { getDebrisType } from '../data/debris';
import { TUNING } from '../data/tuning';
import { furTextures } from '../world/materials';
import type { Bunny } from './bunny';
import { debrisColors, debrisGeometry, debrisMaterial } from './debrisGeometry';

interface StuckItem {
  type: DebrisType;
  /** Unit direction in the ball's rolling frame. */
  dir: Vector3;
  spin: number;
  size: number;
  colorIndex: number;
}

const UP = new Vector3(0, 1, 0);
const _m = new Matrix4();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _inv = new Quaternion();

function furBall(): IcosahedronGeometry {
  const g = new IcosahedronGeometry(1, 5);
  const pos = g.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 9.1 + v.y * 7.3) * Math.cos(v.z * 8.7 - v.x * 3.1) * 0.5 + Math.sin(v.y * 23.1 + v.z * 19.7) * 0.25;
    v.multiplyScalar(1 + n * 0.06);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export class BunnyView {
  readonly root = new Group();
  private readonly rollGroup = new Group();
  private readonly eyes = new Group();
  private readonly ball: Mesh;
  private readonly shells: Mesh[] = [];
  private stuck: StuckItem[] = [];
  private stuckMeshes = new Map<string, InstancedMesh>();
  private stuckDirty = true;
  private lastStuckRadius = 0;
  private heading: number;
  private blink = 0;
  private blinkTimer = 2;
  private time = 0;
  private readonly disposables = new Disposables();

  constructor(
    private readonly bunny: Bunny,
    events: EventBus,
    color: string,
  ) {
    this.root.name = 'bunny';
    const fur = furTextures();
    const base = new Color(color);
    this.ball = new Mesh(furBall(), new MeshStandardMaterial({ color: base, map: fur.map, roughness: 1 }));
    this.ball.castShadow = true;
    this.rollGroup.add(this.ball);
    const shellGeo = new SphereGeometry(1, 40, 28);
    for (let i = 1; i <= 4; i++) {
      const m = new MeshStandardMaterial({
        color: base.clone().offsetHSL(0, 0, 0.03 * i),
        alphaMap: fur.alpha,
        alphaTest: 0.25 + i * 0.12,
        transparent: false,
        roughness: 1,
      });
      fur.alpha.repeat.set(3, 2);
      const shell = new Mesh(shellGeo, m);
      shell.userData.k = 1 + i * 0.035;
      this.shells.push(shell);
      this.rollGroup.add(shell);
    }
    this.root.add(this.rollGroup);
    this.buildEyes();
    this.root.add(this.eyes);
    this.heading = bunny.heading;

    this.disposables.add(
      events.on('debrisAbsorbed', (e) => {
        if (e.kind !== 'debris') return;
        const type = getDebrisType(e.typeId);
        if (type) this.stick(type, e.position.x, e.position.z, e.size);
      }),
    );
  }

  private buildEyes(): void {
    const white = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 });
    const black = new MeshStandardMaterial({ color: '#111111', roughness: 0.2 });
    const shine = new MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.6 });
    const eyeGeo = new SphereGeometry(1, 16, 12);
    for (const s of [-1, 1]) {
      const eye = new Group();
      const w = new Mesh(eyeGeo, white);
      w.scale.set(0.2, 0.24, 0.12);
      const p = new Mesh(eyeGeo, black);
      p.scale.set(0.12, 0.15, 0.08);
      p.position.z = 0.07;
      const h = new Mesh(eyeGeo, shine);
      h.scale.setScalar(0.035);
      h.position.set(0.04, 0.06, 0.13);
      eye.add(w, p, h);
      eye.position.set(s * 0.3, 0.32, 0.93);
      eye.lookAt(s * 0.6, 0.5, 3);
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
        _p.copy(s.dir).multiplyScalar(radius * 0.93 - s.size * 0.15);
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
    this.time += frameDt;
    const r = lerp(b.prevRadius, b.radius, alpha);
    const x = lerp(b.prevX, b.x, alpha);
    const z = lerp(b.prevZ, b.z, alpha);
    this.root.position.set(x, r, z);
    this.rollGroup.quaternion.copy(b.rollQuat);
    this.ball.scale.setScalar(r);
    for (const s of this.shells) s.scale.setScalar(r * (s.userData.k as number));
    if (this.stuckDirty || Math.abs(r - this.lastStuckRadius) > this.lastStuckRadius * 0.01) this.rebuildStuck(r);

    // Eyes: smooth yaw towards heading, gentle bob, blink.
    let dh = b.heading - this.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.heading += dh * Math.min(1, frameDt * 10);
    this.eyes.rotation.y = this.heading;
    this.blinkTimer -= frameDt;
    if (this.blinkTimer <= 0) {
      this.blink = 0.12;
      this.blinkTimer = 2 + Math.random() * 3;
    }
    this.blink = Math.max(0, this.blink - frameDt);
    const squash = this.blink > 0 ? 0.15 : 1;
    this.eyes.scale.set(r, r * squash, r);
    this.eyes.position.y = Math.sin(this.time * 6) * r * 0.015 * Math.min(1, b.speed / (r * 3));

    // Invulnerability flicker.
    this.root.visible = b.invulnerable <= 0 || Math.floor(this.time * 15) % 2 === 0;
  }

  dispose(): void {
    this.disposables.dispose();
    for (const m of this.stuckMeshes.values()) m.dispose();
    this.root.removeFromParent();
  }
}
