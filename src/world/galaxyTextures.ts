/**
 * The Galaxy's floor (browser only). `buildGalaxySurface` paints the galactic disc as one plane
 * covering the map and `MARGIN` units round it (the zone floors are not drawn under it), seen from
 * above: a nebula backdrop of cool blues and magentas in the dark past the disc (and faintly
 * through it), the disc's soft starlight falling off from the centre, the spiral arms (the same
 * spiral as the zones, `armDensity`, roughened with noise) in blue-white young starlight studded
 * with pink star-forming knots, ragged dark dust lanes hugging the arms' inner edges, the warm
 * bulge and bar round Sagittarius A* (its dark spot at the centre), the thin halo past the disc, a
 * faint line along the map's edge and darker space past it. A tiled starfield (`STAR_TILE` units)
 * is added in the shader so space stays crisp close up, denser where the painting is brighter.
 * The painting is mostly emissive (the disc is its own light) but still takes the light and
 * shadows. The instanced starfield over it (and the deep field under it) is src/fx/galaxy.ts.
 * Canvas +x is world +x (east) and canvas +y is world +z (south).
 */
import { CanvasTexture, Group, Mesh, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, type Texture } from 'three';
import { Rng } from '../core/rng';
import { GALAXY, armDensity, barAngleFor, galacticCentre } from './galaxy';
import { canvas, fbm, paint, repeatTexture, smooth } from './globeTextures';
import type { HouseLayout } from './types';

/** Painting margin round the map (units), its texture size (px) and the tiled starfield's size (units). */
const MARGIN = 120;
const TEX = 2048;
const STAR_TILE = 20;

/** Tileable starfield: a few bright stars, many faint; blue-white with some warm ones. */
function starTile(): Texture {
  const S = 512;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  const rng = new Rng('galaxy-stars');
  for (let i = 0; i < 520; i++) {
    const b = rng.next();
    const r = b > 0.97 ? 1.6 : b > 0.85 ? 1.05 : 0.65;
    const a = 0.22 + b * b * 0.78;
    const tint = rng.next();
    ctx.fillStyle = tint > 0.84 ? `rgba(255,206,160,${a})` : tint > 0.55 ? `rgba(176,200,255,${a})` : `rgba(240,244,255,${a})`;
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    for (const dx of [-S, 0, S]) {
      for (const dy of [-S, 0, S]) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return repeatTexture(c);
}

export interface GalaxySurfaceView {
  object: Group;
  dispose(): void;
}

export function buildGalaxySurface(layout: HouseLayout): GalaxySurfaceView {
  const b = layout.bounds;
  const c0 = galacticCentre(layout);
  const barAngle = barAngleFor(layout.seed);
  const bc = Math.cos(barAngle);
  const bs = Math.sin(barAngle);
  const E = b.maxX - b.minX + 2 * MARGIN;
  const x0 = b.minX - MARGIN;
  const z0 = b.minZ - MARGIN;
  const px = E / TEX;
  const rng = new Rng(layout.seed).fork('galaxy:paint');
  const neb = fbm(rng.fork('neb'), [[3, 1], [7, 0.6], [17, 0.3]]);
  const neb2 = fbm(rng.fork('neb2'), [[4, 1], [11, 0.5], [23, 0.25]]);
  const warp = fbm(rng.fork('warp'), [[9, 1], [21, 0.5]]);
  const clumps = fbm(rng.fork('clumps'), [[36, 1], [80, 0.6]]);
  const knots = fbm(rng.fork('knots'), [[120, 1], [260, 0.6]]);
  const dustN = fbm(rng.fork('dust'), [[14, 1], [40, 0.7], [90, 0.35]]);
  const G = GALAXY;

  const [colorCanvas, ctx] = canvas(TEX);
  paint(ctx, TEX, TEX, (ix, iy, o) => {
    const x = x0 + (ix + 0.5) * px;
    const z = z0 + (iy + 0.5) * px;
    const u = (ix + 0.5) / TEX;
    const v = (iy + 0.5) / TEX;
    const dx = x - c0.x;
    const dz = z - c0.z;
    const d = Math.hypot(dx, dz);
    const ang = Math.atan2(dz, dx);
    // The nebula backdrop: magenta and blue clouds, strongest past the disc, faint through it.
    const n1 = neb(u, v) ** 2;
    const n2 = neb2(u, v) ** 2;
    const outside = smooth(G.disc - 30, G.disc + 30, d);
    const backdrop = 0.35 + 0.65 * outside;
    let r = 3 + (34 * n1 + 6 * n2) * backdrop;
    let g = 3 + (6 * n1 + 14 * n2) * backdrop;
    let bl = 10 + (40 * n1 + 46 * n2) * backdrop;
    // The disc's soft light, falling off outwards and fading at its edge.
    const discEdge = 1 - smooth(G.disc - 25, G.disc + 15, d);
    const disc = Math.exp(-d / 62) * discEdge;
    r += 30 * disc;
    g += 28 * disc;
    bl += 44 * disc;
    // The spiral arms (roughened), young blue-white starlight with clumps.
    const wobble = (warp(u, v) - 0.5) * 0.35;
    const arm = d > G.core * 0.7 ? armDensity(d, ang + wobble, barAngle) * smooth(G.core * 0.7, G.barLength * 0.9, d) * discEdge : 0;
    const fall = Math.exp(-d / 150);
    const cl = 0.45 + 0.9 * clumps(u, v);
    const armLight = arm * fall * cl;
    r += 62 * armLight;
    g += 82 * armLight;
    bl += 132 * armLight;
    // Pink star-forming knots along the arms.
    const k = smooth(0.66, 0.84, knots(u, v)) * arm * arm * discEdge;
    r += 120 * k;
    g += 30 * k;
    bl += 80 * k;
    // The bulge and the bar: warm old starlight.
    const along = dx * bc + dz * bs;
    const across = -dx * bs + dz * bc;
    const bulge = Math.exp(-((d / (G.core * 1.1)) ** 2));
    const barGlow = Math.exp(-((along / (G.barLength * 0.95)) ** 2) - (across / (G.barWidth * 0.95)) ** 2);
    const warm = bulge * 1.0 + barGlow * 0.6 + Math.exp(-d / 26) * 0.25;
    r += 235 * warm;
    g += 168 * warm;
    bl += 92 * warm;
    // Dust lanes: dark ragged filaments on the arms' inner edges (and wisps across the bulge).
    const inner = armDensity(d * 1.13, ang + wobble, barAngle) * smooth(G.core, G.barLength, d) * discEdge;
    const lane = Math.max(0, inner - armDensity(d, ang + wobble, barAngle) * 0.7);
    const dn = dustN(u, v);
    const dust = Math.min(1, lane * 1.6 * smooth(0.3, 0.65, dn) + bulge * 0.45 * smooth(0.5, 0.75, dn));
    const keep = 1 - 0.82 * dust;
    r = r * keep + 10 * dust;
    g = g * keep + 5 * dust;
    bl = bl * keep + 4 * dust;
    // Sagittarius A*'s dark spot at the very centre, in a hot ring.
    const hole = Math.exp(-((d / 1.4) ** 2));
    const ring = Math.exp(-(((d - 2.2) / 0.8) ** 2));
    r = r * (1 - 0.92 * hole) + 60 * ring;
    g = g * (1 - 0.92 * hole) + 36 * ring;
    bl = bl * (1 - 0.92 * hole) + 18 * ring;
    // The map's edge: a faint line, darker space past it.
    const ex = Math.max(b.minX - x, x - b.maxX, 0);
    const ez = Math.max(b.minZ - z, z - b.maxZ, 0);
    const out = Math.hypot(ex, ez);
    const toEdge = out > 0 ? out : Math.min(x - b.minX, b.maxX - x, z - b.minZ, b.maxZ - z);
    const line = Math.exp(-((toEdge / 0.5) ** 2));
    if (out > 0) {
      const dim = 0.4 + 0.35 * Math.exp(-out / 30);
      r *= dim;
      g *= dim;
      bl *= dim;
    }
    o[0] = Math.min(255, r + 34 * line);
    o[1] = Math.min(255, g + 30 * line);
    o[2] = Math.min(255, bl + 70 * line);
  });

  const map = new CanvasTexture(colorCanvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  const stars = starTile();
  const mat = new MeshStandardMaterial({ map, color: '#5a5a5a', emissiveMap: map, emissive: '#ffffff', emissiveIntensity: 0.85, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.starMap = { value: stars };
    shader.uniforms.starRepeat = { value: E / STAR_TILE };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D starMap;\nuniform float starRepeat;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += texture2D(starMap, vMapUv * starRepeat).rgb * (0.5 + 4.0 * dot(texture2D(emissiveMap, vMapUv).rgb, vec3(0.3, 0.5, 0.2)));',
      );
  };
  mat.customProgramCacheKey = () => 'galaxy-surface';
  const plane = new Mesh(new PlaneGeometry(E, E), mat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(x0 + E / 2, 0.01, z0 + E / 2);
  plane.receiveShadow = true;
  // Drawn first: the deep starfield (src/fx/galaxy.ts) goes over it, everything else after.
  plane.renderOrder = -2;
  plane.name = 'galaxySurface';

  const object = new Group();
  object.name = 'galaxy';
  object.add(plane);
  return {
    object,
    dispose() {
      map.dispose();
      stars.dispose();
      mat.dispose();
      plane.geometry.dispose();
    },
  };
}
