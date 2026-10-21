/**
 * Static batch: merges walls and furniture (any number of meshes and colours) into one mesh with
 * one material, so the whole house costs one draw call plus one per shadow pass.
 *
 * Per-vertex data replaces per-material state: `color` (base colour), `rm` (roughness,
 * metalness) and `fadeId` (which source object the vertex came from). A small R8 texture holds
 * one visibility flag per source object; hidden objects are discarded in both the colour and
 * the shadow pass. HouseView hides an object here while it shows the original (unbatched)
 * object with real transparency for the occlusion fade.
 */
import {
  DataTexture,
  Matrix4,
  Mesh,
  MeshDepthMaterial,
  MeshStandardMaterial,
  NearestFilter,
  RedFormat,
  UnsignedByteType,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { bakeParts, mergeParts } from './meshBake';

const FADE_VERT_PARS = /* glsl */ `
attribute float fadeId;
varying float vFadeId;
`;
const FADE_FRAG_PARS = /* glsl */ `
uniform sampler2D fadeTex;
varying float vFadeId;
`;
const FADE_DISCARD = /* glsl */ `
if (texelFetch(fadeTex, ivec2(int(vFadeId + 0.5), 0), 0).r < 0.5) discard;
`;

export class StaticBatch {
  readonly mesh: Mesh;
  private readonly parts: BufferGeometry[] = [];
  private readonly flags: Uint8Array;
  private readonly fadeTex: DataTexture;
  private count = 0;
  private readonly inverseRoot = new Matrix4();

  constructor(
    readonly name: string,
    capacity = 1024,
    root?: Object3D,
  ) {
    this.flags = new Uint8Array(capacity).fill(255);
    this.fadeTex = new DataTexture(this.flags, capacity, 1, RedFormat, UnsignedByteType);
    this.fadeTex.magFilter = this.fadeTex.minFilter = NearestFilter;
    this.fadeTex.needsUpdate = true;
    if (root) {
      root.updateMatrixWorld(true);
      this.inverseRoot.copy(root.matrixWorld).invert();
    }

    const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
    const fadeTex = this.fadeTex;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.fadeTex = { value: fadeTex };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${FADE_VERT_PARS}\nattribute vec2 rm;\nvarying vec2 vRm;`)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFadeId = fadeId;\nvRm = rm;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FADE_FRAG_PARS}\nvarying vec2 vRm;`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FADE_DISCARD}`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRm.x;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRm.y;');
    };
    material.customProgramCacheKey = () => 'static-batch';

    const depth = new MeshDepthMaterial();
    depth.onBeforeCompile = (shader) => {
      shader.uniforms.fadeTex = { value: fadeTex };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${FADE_VERT_PARS}`)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFadeId = fadeId;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FADE_FRAG_PARS}`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FADE_DISCARD}`);
    };
    depth.customProgramCacheKey = () => 'static-batch-depth';

    this.mesh = new Mesh(undefined, material);
    this.mesh.name = name;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.customDepthMaterial = depth;
  }

  /** Bakes `object` (at its current world transform) into the batch; returns its fade id. */
  add(object: Object3D): number {
    if (this.count >= this.flags.length) throw new Error(`StaticBatch ${this.name}: capacity exceeded`);
    const id = this.count++;
    const parts = bakeParts(object, {
      transform: this.inverseRoot,
      attributes: [
        { name: 'rm', itemSize: 2, value: (_m, mat) => [mat.roughness ?? 0.8, mat.metalness ?? 0] },
        { name: 'fadeId', itemSize: 1, value: () => [id] },
      ],
    });
    for (const p of parts) this.parts.push(p.geometry);
    return id;
  }

  /** Merges everything added so far into the batch mesh. */
  build(): Mesh {
    const g = mergeParts(this.parts);
    this.parts.length = 0;
    if (g) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = g;
    }
    return this.mesh;
  }

  /** Show or hide one source object inside the batch. */
  setVisible(id: number, visible: boolean): void {
    const v = visible ? 255 : 0;
    if (this.flags[id] === v) return;
    this.flags[id] = v;
    this.fadeTex.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
    this.mesh.customDepthMaterial?.dispose();
    this.fadeTex.dispose();
  }
}
