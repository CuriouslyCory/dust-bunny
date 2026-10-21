/** Rendering for one Run: house, Debris instances, Bunny, ambient FX, and the Run's entityRoot. */
import { Color, Group, type Scene } from 'three';
import { Disposables } from '../core/events';
import { lerp } from '../core/math';
import { getCharacter } from '../data/characters';
import { getDebrisType } from '../data/debris';
import { TUNING } from '../data/tuning';
import { BunnyView } from '../entities/bunnyView';
import { DebrisRenderer } from '../entities/debrisRenderer';
import { DustMotes, PuffParticles } from '../fx/particles';
import { getQuality } from '../fx/quality';
import { Sunbeams } from '../fx/sunbeams';
import type { CameraRig } from '../systems/camera';
import { HouseView } from '../world/houseView';
import type { Run } from './run';

const DUST = new Color('#cfc6ba');
const _c = new Color();

export class RunView {
  readonly root = new Group();
  readonly house: HouseView;
  readonly debris: DebrisRenderer;
  readonly bunny: BunnyView;
  readonly puffs: PuffParticles;
  readonly motes: DustMotes;
  readonly sunbeams: Sunbeams;
  private readonly disposables = new Disposables();

  constructor(
    readonly run: Run,
    scene: Scene,
  ) {
    const low = getQuality() === 'low';
    this.house = new HouseView(run.house);
    this.debris = new DebrisRenderer(run.debris);
    this.bunny = new BunnyView(run.bunny, run.events, getCharacter(run.config.characterId).look);
    this.puffs = new PuffParticles(low ? 300 : 600);
    this.motes = new DustMotes(low ? 90 : 240);
    this.sunbeams = new Sunbeams(run.house, low ? 15 : 40);
    this.root.add(this.house.root, this.sunbeams.root, this.debris.root, this.bunny.root, run.entityRoot, this.puffs.points, this.motes.points);
    scene.add(this.root);

    const fur = new Color(this.bunny.look.color);
    this.disposables.add(
      run.events.on('debrisAbsorbed', (e) => {
        const type = e.kind === 'debris' ? getDebrisType(e.typeId) : undefined;
        _c.copy(DUST).lerp(fur, 0.3);
        if (type) _c.lerp(new Color(type.colors[0]), 0.25);
        const s = Math.max(e.size, e.radius * 0.12);
        this.puffs.emit(e.position.x, Math.max(e.size * 0.5, 0.05), e.position.z, e.kind === 'hazard' ? 18 : 7, s * 1.1, s * 2.5, _c, 0.6);
      }),
    );
    this.disposables.add(
      run.events.on('dashStarted', () => {
        const b = run.bunny;
        const back = b.radius * 0.8;
        const hx = Math.sin(b.heading);
        const hz = Math.cos(b.heading);
        _c.copy(DUST).lerp(fur, 0.4);
        this.puffs.emit(b.x - hx * back, b.radius * 0.2, b.z - hz * back, 10, b.radius * 0.5, b.radius * 2.2, _c, 0.55, b.radius);
      }),
    );
    this.disposables.add(
      run.events.on('bunnyDamaged', () => {
        const b = run.bunny;
        this.puffs.emit(b.x, b.radius, b.z, 14, b.radius * 0.45, b.radius * 3, fur, 0.5, b.radius);
      }),
    );
  }

  render(alpha: number, frameDt: number, rig: CameraRig, viewportHeight = 720): void {
    const b = this.run.bunny;
    this.debris.sync();
    this.bunny.update(alpha, frameDt);
    const x = lerp(b.prevX, b.x, alpha);
    const z = lerp(b.prevZ, b.z, alpha);
    const r = lerp(b.prevRadius, b.radius, alpha);
    rig.update(frameDt, x, z, r, this.run.tier);
    const cam = rig.camera;
    const vi = (this.run.viewInfo ??= { distance: rig.distance, aspect: cam.aspect, fovDeg: cam.fov });
    vi.distance = rig.distance;
    vi.aspect = cam.aspect;
    vi.fovDeg = cam.fov;
    this.house.update(frameDt, rig.camera.position, x, r, z, r);
    const fov = TUNING.camera.fov;
    this.puffs.update(frameDt, viewportHeight, fov);
    this.motes.update(frameDt, rig.target, rig.distance, viewportHeight, fov);
    this.sunbeams.update(frameDt, viewportHeight, fov);
  }

  dispose(): void {
    this.disposables.dispose();
    this.bunny.dispose();
    this.debris.dispose();
    this.house.dispose();
    this.puffs.dispose();
    this.motes.dispose();
    this.sunbeams.dispose();
    this.run.entityRoot.removeFromParent();
    this.root.removeFromParent();
  }
}
