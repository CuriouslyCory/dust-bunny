/** Rendering for one Run: house, Debris instances, Bunny, and the Run's entityRoot. */
import { Group, type Scene } from 'three';
import { lerp } from '../core/math';
import { getCharacter } from '../data/characters';
import { BunnyView } from '../entities/bunnyView';
import { DebrisRenderer } from '../entities/debrisRenderer';
import type { CameraRig } from '../systems/camera';
import { HouseView } from '../world/houseView';
import type { Run } from './run';

export class RunView {
  readonly root = new Group();
  readonly house: HouseView;
  readonly debris: DebrisRenderer;
  readonly bunny: BunnyView;

  constructor(
    readonly run: Run,
    scene: Scene,
  ) {
    this.house = new HouseView(run.house);
    this.debris = new DebrisRenderer(run.debris);
    this.bunny = new BunnyView(run.bunny, run.events, getCharacter(run.config.characterId).color);
    this.root.add(this.house.root, this.debris.root, this.bunny.root, run.entityRoot);
    scene.add(this.root);
  }

  render(alpha: number, frameDt: number, rig: CameraRig): void {
    const b = this.run.bunny;
    this.debris.sync();
    this.bunny.update(alpha, frameDt);
    const x = lerp(b.prevX, b.x, alpha);
    const z = lerp(b.prevZ, b.z, alpha);
    const r = lerp(b.prevRadius, b.radius, alpha);
    rig.update(frameDt, x, z, r, this.run.tier);
    this.house.update(frameDt, rig.camera.position, x, r, z, r);
  }

  dispose(): void {
    this.bunny.dispose();
    this.debris.dispose();
    this.house.dispose();
    this.run.entityRoot.removeFromParent();
    this.root.removeFromParent();
  }
}
