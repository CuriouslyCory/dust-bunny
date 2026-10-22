/**
 * GPU-animated particles, one draw call each:
 *  - PuffParticles: ring buffer of short-lived soft puffs (absorb, Dash, hits). Motion is
 *    evaluated in the vertex shader from spawn data, so emitting is the only CPU work.
 *  - DustMotes: a field of drifting motes that wraps around the camera target, scaled with the
 *    camera distance so they read at every Tier.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, NormalBlending, Points, ShaderMaterial, Vector3 } from 'three';

const PUFF_VERT = /* glsl */ `
uniform float uTime;
uniform float uScale;
attribute vec3 aVel;
attribute vec4 aData; // start, life, size, spin
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float t = uTime - aData.x;
  float life = aData.y;
  if (t < 0.0 || t > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vAlpha = 0.0; return; }
  float k = 3.5;
  vec3 p = position + aVel * (1.0 - exp(-k * t)) / k;
  p.y += aData.z * 0.6 * t; // drift up
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float u = t / life;
  float size = aData.z * (0.6 + 1.2 * u);
  gl_PointSize = size * uScale / max(0.001, -mv.z);
  vAlpha = smoothstep(0.0, 0.06, t) * (1.0 - u) * (1.0 - u);
  vColor = aColor;
}
`;

const PUFF_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = smoothstep(1.0, 0.2, d) * vAlpha * 0.75;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}
`;

export class PuffParticles {
  readonly points: Points;
  private readonly material: ShaderMaterial;
  private readonly pos: BufferAttribute;
  private readonly vel: BufferAttribute;
  private readonly data: BufferAttribute;
  private readonly color: BufferAttribute;
  private next = 0;
  private time = 0;

  constructor(readonly capacity = 600) {
    const g = new BufferGeometry();
    this.pos = new BufferAttribute(new Float32Array(capacity * 3), 3);
    this.vel = new BufferAttribute(new Float32Array(capacity * 3), 3);
    this.data = new BufferAttribute(new Float32Array(capacity * 4).fill(-1e6), 4);
    this.color = new BufferAttribute(new Float32Array(capacity * 3), 3);
    g.setAttribute('position', this.pos);
    g.setAttribute('aVel', this.vel);
    g.setAttribute('aData', this.data);
    g.setAttribute('aColor', this.color);
    this.material = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 600 } },
      vertexShader: PUFF_VERT,
      fragmentShader: PUFF_FRAG,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    this.points = new Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.name = 'fx:puffs';
    this.points.renderOrder = 2;
  }

  /** Emits `n` puffs around (x, y, z). `size` is the puff size in cm, `speed` in cm/s. */
  emit(x: number, y: number, z: number, n: number, size: number, speed: number, color: Color, life = 0.7, spread = size): void {
    for (let i = 0; i < n; i++) {
      const k = this.next;
      this.next = (this.next + 1) % this.capacity;
      const a = Math.random() * Math.PI * 2;
      const up = 0.2 + Math.random() * 0.8;
      const s = speed * (0.5 + Math.random() * 0.7);
      this.pos.setXYZ(k, x + Math.cos(a) * spread * 0.3, y, z + Math.sin(a) * spread * 0.3);
      this.vel.setXYZ(k, Math.cos(a) * s, s * up, Math.sin(a) * s);
      this.data.setXYZW(k, this.time + Math.random() * 0.05, life * (0.7 + Math.random() * 0.6), size * (0.7 + Math.random() * 0.6), 0);
      const l = 0.85 + Math.random() * 0.3;
      this.color.setXYZ(k, color.r * l, color.g * l, color.b * l);
    }
    this.pos.needsUpdate = this.vel.needsUpdate = this.data.needsUpdate = this.color.needsUpdate = true;
  }

  /**
   * Particles that start on a ring of `radius` around (x, z) and stream in to the centre (they
   * travel `vel / k`, so the inward speed is set to land on the centre), e.g. Keepsake fibres
   * tangling into the Bunny.
   */
  emitInward(x: number, y: number, z: number, n: number, size: number, radius: number, color: Color, life = 0.9): void {
    const k = 3.5;
    for (let i = 0; i < n; i++) {
      const slot = this.next;
      this.next = (this.next + 1) % this.capacity;
      const a = Math.random() * Math.PI * 2;
      const d = radius * (0.8 + Math.random() * 0.4);
      const h = y + (Math.random() - 0.3) * radius * 0.6;
      this.pos.setXYZ(slot, x + Math.cos(a) * d, h, z + Math.sin(a) * d);
      this.vel.setXYZ(slot, -Math.cos(a) * d * k, (y - h) * k - size * 0.6, -Math.sin(a) * d * k);
      this.data.setXYZW(slot, this.time + Math.random() * 0.25, life * (0.8 + Math.random() * 0.4), size * (0.6 + Math.random() * 0.8), 0);
      const l = 0.9 + Math.random() * 0.2;
      this.color.setXYZ(slot, color.r * l, color.g * l, color.b * l);
    }
    this.pos.needsUpdate = this.vel.needsUpdate = this.data.needsUpdate = this.color.needsUpdate = true;
  }

  /** `viewportHeight` in device pixels, `fov` in degrees: keeps point sizes in world units. */
  update(dt: number, viewportHeight: number, fovDeg: number): void {
    this.time += dt;
    this.material.uniforms.uTime!.value = this.time;
    this.material.uniforms.uScale!.value = viewportHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
    this.points.removeFromParent();
  }
}

const MOTE_VERT = /* glsl */ `
uniform float uTime;
uniform float uScale;
uniform vec3 uCenter;
uniform float uSize;
uniform float uMote;
attribute vec4 aSeed;
varying float vAlpha;
void main() {
  vec3 drift = vec3(0.013, 0.006, -0.009) * uTime + aSeed.w * 0.03 * vec3(sin(uTime * 0.3 + aSeed.x * 20.0), cos(uTime * 0.23 + aSeed.y * 20.0), sin(uTime * 0.27 + aSeed.z * 20.0));
  vec3 cell = fract(aSeed.xyz + drift - uCenter / uSize);
  vec3 p = uCenter + (cell - 0.5) * uSize;
  p.y = (cell.y) * uSize * 0.55;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, uMote * (0.5 + aSeed.w) * uScale / max(0.001, -mv.z));
  // Fade at the edges of the wrapping volume and twinkle.
  vec3 e = abs(cell - 0.5) * 2.0;
  float edge = 1.0 - smoothstep(0.7, 1.0, max(e.x, e.z));
  vAlpha = edge * (0.55 + 0.45 * sin(uTime * (1.0 + aSeed.w * 2.0) + aSeed.x * 40.0));
}
`;

const MOTE_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d) * vAlpha * 0.5;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * a, a);
  #include <colorspace_fragment>
}
`;

export class DustMotes {
  readonly points: Points;
  private readonly material: ShaderMaterial;
  private time = 0;

  constructor(count = 260) {
    const g = new BufferGeometry();
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    g.setAttribute('aSeed', new BufferAttribute(seed, 4));
    g.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    this.material = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 600 },
        uCenter: { value: new Vector3() },
        uSize: { value: 100 },
        uMote: { value: 0.3 },
        uColor: { value: new Color('#ffe9c4') },
      },
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.name = 'fx:motes';
    this.points.renderOrder = 3;
  }

  update(dt: number, center: Vector3, cameraDistance: number, viewportHeight: number, fovDeg: number): void {
    this.time += dt;
    const u = this.material.uniforms;
    u.uTime!.value = this.time;
    (u.uCenter!.value as Vector3).copy(center).setY(0);
    u.uSize!.value = cameraDistance * 2.2;
    u.uMote!.value = cameraDistance * 0.006;
    u.uScale!.value = viewportHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
    this.points.removeFromParent();
  }
}
