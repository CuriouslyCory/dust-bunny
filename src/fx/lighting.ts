/**
 * Warm afternoon lighting: hemisphere fill + a low "window" sun with soft PCF shadows that
 * follow the camera target. The shadow frustum scales with camera distance (so with Tier) and
 * snaps to whole shadow texels to avoid shimmering while the Bunny moves.
 */
import { AmbientLight, DirectionalLight, HemisphereLight, Vector3, type Scene, type WebGLRenderer } from 'three';
import type { AreaId } from '../world/types';
import type { Quality } from './quality';

const _v = new Vector3();

const AREA_LIGHT: Record<AreaId, { sky: string; ground: string; sun: string; intensity: number; dir: [number, number, number] }> = {
  house: { sky: '#ffeedd', ground: '#7a5f4a', sun: '#ffe2b8', intensity: 2.6, dir: [-0.55, 1.15, 0.42] },
  neighborhood: { sky: '#e4f0ff', ground: '#5e7a45', sun: '#fff1d6', intensity: 2.9, dir: [-0.45, 1.5, 0.5] },
  city: { sky: '#ffe2c4', ground: '#5d5a5f', sun: '#ffc98a', intensity: 3.0, dir: [-0.7, 1.05, 0.35] },
  // Overcast noon from altitude: a high, soft sun and a bright grey sky fill.
  region: { sky: '#eef1f3', ground: '#6b7458', sun: '#f4f2ec', intensity: 2.2, dir: [-0.25, 1.9, 0.3] },
};

export class Lighting {
  readonly hemi = new HemisphereLight('#ffeedd', '#7a5f4a', 1.25);
  readonly ambient = new AmbientLight('#ffe8d0', 0.18);
  readonly sun = new DirectionalLight('#ffe2b8', 2.6);
  /** Sun direction (from target towards the light). */
  private readonly dir = new Vector3(-0.55, 1.15, 0.42).normalize();
  private extent = 0;

  constructor(scene: Scene) {
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 3;
    this.sun.shadow.blurSamples = 8;
    scene.add(this.hemi, this.ambient, this.sun, this.sun.target);
  }

  /**
   * Indoors: the warm window light. Neighborhood: brighter, whiter sky fill and a higher sun.
   * City: golden-hour light, a lower amber sun and a cooler fill bouncing off concrete.
   * Region: overcast noon seen from a few kilometres up (soft, high light).
   */
  setArea(area: AreaId): void {
    const L = AREA_LIGHT[area];
    this.hemi.color.set(L.sky);
    this.hemi.groundColor.set(L.ground);
    this.sun.color.set(L.sun);
    this.sun.intensity = L.intensity;
    this.dir.set(...L.dir).normalize();
  }

  applyQuality(renderer: WebGLRenderer, q: Quality): void {
    const shadows = q === 'high';
    renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    renderer.shadowMap.needsUpdate = true;
    // Without shadows the scene reads flatter; lift the fill a little.
    this.hemi.intensity = shadows ? 1.25 : 1.45;
  }

  /** Follow the camera target; `distance` is the camera distance (scales with Tier). */
  update(target: Vector3, distance: number): void {
    const cam = this.sun.shadow.camera;
    const ext = distance * 1.35;
    if (Math.abs(this.extent - ext) > ext * 0.02) {
      this.extent = ext;
      cam.left = -ext;
      cam.right = ext;
      cam.top = ext;
      cam.bottom = -ext;
      cam.near = distance * 0.1;
      cam.far = distance * 5;
      cam.updateProjectionMatrix();
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = distance * 0.0025;
    }
    // Snap the target to the shadow texel grid (in the light's view plane) to stop swimming.
    const texel = (2 * ext) / this.sun.shadow.mapSize.x;
    _v.copy(target);
    _v.x = Math.round(_v.x / texel) * texel;
    _v.z = Math.round(_v.z / texel) * texel;
    this.sun.target.position.copy(_v);
    this.sun.position.copy(_v).addScaledVector(this.dir, distance * 2.2);
  }
}
