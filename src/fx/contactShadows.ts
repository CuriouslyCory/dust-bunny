/**
 * Soft contact shadows / fake ambient occlusion on the floor: rounded rectangles whose edges fade
 * out over `soft` cm, all in one mesh and one draw call. Shape is computed per pixel from a
 * signed distance, so any number of sizes share a single material.
 */
import { BufferGeometry, Float32BufferAttribute, Mesh, ShaderMaterial, UniformsLib, UniformsUtils } from 'three';
import type { Rect } from '../core/math';

const vertexShader = /* glsl */ `
attribute vec2 aLocal;
attribute vec2 aHalf;
attribute vec3 aParams; // soft, strength, corner radius
varying vec2 vLocal;
varying vec2 vHalf;
varying vec3 vParams;
#include <fog_pars_vertex>
void main() {
  vLocal = aLocal;
  vHalf = aHalf;
  vParams = aParams;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 shadowColor;
uniform float opacity;
varying vec2 vLocal;
varying vec2 vHalf;
varying vec3 vParams;
#include <fog_pars_fragment>
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  float soft = vParams.x;
  float d = sdRoundBox(vLocal, vHalf, min(vParams.z, min(vHalf.x, vHalf.y)));
  float a = 1.0 - smoothstep(0.0, soft, d);
  a = a * a * vParams.y * opacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(shadowColor, a);
  #include <fog_fragment>
}
`;

export function contactShadowMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog, { shadowColor: { value: [0.09, 0.06, 0.04] }, opacity: { value: 1 } }]),
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

export class ContactShadows {
  private pos: number[] = [];
  private local: number[] = [];
  private half: number[] = [];
  private params: number[] = [];
  private index: number[] = [];

  /**
   * Adds a shadow for an axis-aligned floor rect. `soft` = fade distance outside the shape (cm),
   * `grow` expands (+) or shrinks (−) the fully dark core relative to the rect.
   */
  addRect(r: Rect, soft: number, strength: number, grow = 0, corner = 2, y = 0.2): void {
    const hx = Math.max(0.1, (r.maxX - r.minX) / 2 + grow);
    const hz = Math.max(0.1, (r.maxZ - r.minZ) / 2 + grow);
    this.add((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2, hx, hz, soft, strength, corner, y);
  }

  add(cx: number, cz: number, hx: number, hz: number, soft: number, strength: number, corner: number, y = 0.2): void {
    const ex = hx + soft;
    const ez = hz + soft;
    const base = this.pos.length / 3;
    for (const [sx, sz] of [
      [-1, -1],
      [-1, 1],
      [1, 1],
      [1, -1],
    ] as const) {
      this.pos.push(cx + sx * ex, y, cz + sz * ez);
      this.local.push(sx * ex, sz * ez);
      this.half.push(hx, hz);
      this.params.push(soft, strength, corner);
    }
    this.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build(): Mesh {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aLocal', new Float32BufferAttribute(this.local, 2));
    g.setAttribute('aHalf', new Float32BufferAttribute(this.half, 2));
    g.setAttribute('aParams', new Float32BufferAttribute(this.params, 3));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    const mesh = new Mesh(g, contactShadowMaterial());
    mesh.renderOrder = -1;
    mesh.frustumCulled = false;
    return mesh;
  }
}
