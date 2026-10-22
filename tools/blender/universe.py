"""Universe models (Act 9): the Universe's Hazards (a wandering quasar, two
galaxies on a collision course, a gamma-ray burst turret, a cosmic void, a
dark-energy gust), the Expansion (the boss: the fabric of space being
stretched, a glowing metric lattice round the Bunny) and Universe Debris
(spiral, barred, elliptical, lenticular, irregular and dwarf galaxies, an
interacting pair, a group, a cluster, a cosmic-web filament, a supercluster
node, a radio galaxy and the Great Attractor). The sock and the lint reuse
the Galaxy's `space_sock` and `cosmic_lint`.

Scale: 1 Blender unit = 100 kly (100,000 light years). One Universe world
unit is 10 Mly = 100 BU, so the game loads these files at scale 0.01
(manifest.json "scale": 0.01), like the Galaxy models one rung down. Debris
props are normalised to their Debris size by the game, so they are drawn at
a convenient size (footprint radius about 100) and only their proportions
matter. Everything else follows the shared conventions: X right, -Y forward
(exported as glTF +Z), Z up, origin at the bottom centre where the model
touches the floor (the cosmic web is the floor; galaxies lie flat on it).

Space is near black, so the look is carried by emissive materials (the
cosmic web in pale blue, CMB orange accents). Debris props are baked into
one vertex-coloured mesh per type (src/entities/debrisGeometry.ts) with a
per-vertex `emission` attribute, so every prop part is emissive and the
Debris type's `material.glow` lights it. The plain galaxies (spiral, barred,
elliptical, lenticular, irregular, dwarf) are pale so a `tintAll` instance
colour reads on them.
"""

import math
import random

from mathutils import Vector

from common import Model, mat, polar
from continent import _surface
from galaxy import _disc, _mini
from solar import _bez, _dir, _noise, _tube, _uvs

UNITS = "100 kly"
SCALE_NOTE = ("Universe scale: 1 unit = 100 kly (100,000 light years), load "
              "at scale 0.01.")
PROP_NOTE = (f"{SCALE_NOTE} Debris prop (normalised to its Debris size, only "
             "proportions matter).")
TAU = 2 * math.pi
# the game camera looks down from the +Z side (Blender -Y, up)
VIEW = Vector((0.0, -0.6, 0.8)).normalized()

# name: (hex colour, roughness, metallic, emission hex or None, strength)
PAL = {
    # space and the cosmic web
    "uni_void": ("#07060d", 0.4, 0.0, None, 0),
    "uni_void_rim": ("#151230", 0.4, 0.0, "#0c0a24", 0.6),
    "uni_web": ("#a8bcff", 0.4, 0.0, "#8aa2ff", 2.6),
    "uni_web_bright": ("#e6eeff", 0.3, 0.0, "#d0dcff", 4.5),
    "uni_web_dim": ("#5e62c0", 0.5, 0.0, "#4448a8", 1.3),
    "uni_web_faint": ("#34336e", 0.6, 0.0, "#24225a", 0.8),
    # cosmic microwave background accents
    "uni_cmb": ("#ff9a4a", 0.45, 0.0, "#ff7a2a", 2.8),
    "uni_cmb_hot": ("#ffd090", 0.35, 0.0, "#ffb860", 4.5),
    "uni_cmb_dim": ("#b8583a", 0.5, 0.0, "#983a22", 1.4),
    # galaxies (pale, so tints read)
    "uni_core": ("#fff6e0", 0.3, 0.0, "#ffeccc", 5.0),
    "uni_bulge": ("#ffe2a8", 0.35, 0.0, "#ffd488", 3.4),
    "uni_arm": ("#d4e4ff", 0.35, 0.0, "#b8d0ff", 3.0),
    "uni_arm_dim": ("#90acee", 0.45, 0.0, "#7090dc", 1.8),
    "uni_haze": ("#5c6ab4", 0.55, 0.0, "#44529c", 1.0),
    "uni_hii": ("#ff92cc", 0.4, 0.0, "#ff68b4", 3.6),
    "uni_young": ("#a8d4ff", 0.35, 0.0, "#84bcff", 3.6),
    "uni_dust": ("#3a2a3c", 0.8, 0.0, None, 0),
    # warm galaxy (the second of the colliding pair)
    "uni_warm_core": ("#fff0d4", 0.3, 0.0, "#ffe2b8", 5.0),
    "uni_warm_arm": ("#ffd2b0", 0.4, 0.0, "#ffb890", 2.8),
    "uni_warm_dim": ("#d88a7a", 0.45, 0.0, "#c06a5a", 1.6),
    "uni_warm_haze": ("#7a4a6a", 0.55, 0.0, "#5e3252", 0.9),
    # ellipticals
    "uni_ell_core": ("#fff2d6", 0.3, 0.0, "#ffe6b8", 4.6),
    "uni_ell_mid": ("#ffd8a0", 0.35, 0.0, "#ffc478", 3.0),
    "uni_ell_out": ("#e4a878", 0.4, 0.0, "#cc8858", 1.8),
    "uni_ell_halo": ("#9a6e68", 0.5, 0.0, "#7a504a", 1.0),
    # quasar
    "uni_q_white": ("#f6fcff", 0.2, 0.0, "#eaf8ff", 9.0),
    "uni_q_cyan": ("#a6f2ff", 0.3, 0.0, "#78e4ff", 5.0),
    "uni_q_blue": ("#5ea0ff", 0.35, 0.0, "#3a80ff", 3.6),
    "uni_q_violet": ("#8a6aff", 0.4, 0.0, "#6a48ff", 2.6),
    "uni_q_indigo": ("#4a3cb0", 0.5, 0.0, "#302494", 1.6),
    # gamma-ray burst / hypernova
    "uni_grb_beam": ("#f6faff", 0.2, 0.0, "#eef6ff", 9.0),
    "uni_grb_sheath": ("#d2a6ff", 0.3, 0.0, "#b478ff", 4.5),
    "uni_grb_green": ("#b8ffe0", 0.3, 0.0, "#88ffc8", 4.0),
    "uni_hn_white": ("#fffaf0", 0.2, 0.0, "#fff4dc", 8.0),
    "uni_hn_violet": ("#b484ff", 0.35, 0.0, "#9454ff", 3.4),
    "uni_hn_red": ("#ff5e4a", 0.4, 0.0, "#f0402a", 3.0),
    "uni_hn_dark": ("#2a1834", 0.6, 0.0, "#1a0a24", 0.5),
    # dark energy
    "uni_de_core": ("#ece0ff", 0.25, 0.0, "#dcc8ff", 6.0),
    "uni_de_magenta": ("#c864ff", 0.35, 0.0, "#a840f0", 3.6),
    "uni_de_violet": ("#8c5cff", 0.4, 0.0, "#6c3cff", 3.0),
    "uni_de_indigo": ("#4c3cc8", 0.45, 0.0, "#3222a8", 2.0),
    "uni_de_deep": ("#261c5c", 0.55, 0.0, "#18104a", 0.9),
    # hot cluster gas
    "uni_xray": ("#b49cf0", 0.5, 0.0, "#9480dc", 1.3),
    "uni_xray_pink": ("#f0a0d4", 0.5, 0.0, "#dc78b8", 1.5),
    # radio lobes
    "uni_lobe": ("#ff6e4c", 0.45, 0.0, "#f04c2c", 2.6),
    "uni_lobe_hot": ("#ffbc78", 0.35, 0.0, "#ff9c48", 4.0),
    "uni_lobe_deep": ("#c8406e", 0.5, 0.0, "#a8244e", 1.8),
    # the Great Attractor
    "uni_ga_white": ("#fff4dc", 0.25, 0.0, "#ffeccc", 6.5),
    "uni_ga_gold": ("#ffca64", 0.3, 0.0, "#ffb640", 4.2),
    "uni_ga_orange": ("#ff8c3c", 0.4, 0.0, "#ff6c1c", 3.4),
    "uni_ga_red": ("#e0503c", 0.45, 0.0, "#c43420", 2.4),
    # the Expansion
    "uni_grid": ("#8edcff", 0.3, 0.0, "#64ccff", 3.6),
    "uni_grid_dim": ("#4c80dc", 0.4, 0.0, "#3a62cc", 2.0),
    "uni_grid_bright": ("#eafcff", 0.2, 0.0, "#d8f6ff", 6.0),
}


def U(key):
    """Material from the Universe palette."""
    color, rough, metal, emit, strength = PAL[key]
    return mat(key, color, rough, metal, emit, strength)


# --------------------------------------------------------------------------
# Shared helpers
# --------------------------------------------------------------------------

def _settle(m):
    """Shift every part (and its pivot) so the model's lowest point sits on
    the floor. Returns the shift."""
    lo = min(v.co.z for p in m.parts.values() for v in p.bm.verts)
    for p in m.parts.values():
        for v in p.bm.verts:
            v.co.z -= lo
        p.pivot = p.pivot - Vector((0, 0, lo))
    return -lo


def _spiral_disc(p, z, radii, segs, bands, arms=3, twist=0.022, flare=0.0,
                 seed=0):
    """galaxy._spiral_disc with Universe palette keys: an upward sheet whose
    faces alternate bright / dim in trailing spiral streaks. bands:
    [(r_max, bright, dim)] from the inside out."""
    r0 = radii[0]
    ph = random.Random(seed).uniform(0, TAU)

    def mfn(r, a):
        band = next((b for b in bands if r <= b[0]), bands[-1])
        s = math.sin(arms * math.radians(a) + r * twist * TAU + ph)
        return U(band[1] if s > 0.15 else band[2])

    return _disc(p, radii, segs, mfn, z=z,
                 zfn=lambda r: flare * max(0.0, r - r0))


def _ribbon(p, pts, widths, mat_fn, lift=0.0):
    """A flat, upward-facing strip along the horizontal path pts (Vectors);
    widths: half-widths per point. mat_fn(j) picks each quad's material."""
    n = len(pts)
    left, right = [], []
    for i in range(n):
        d = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        d.z = 0
        d.normalize()
        side = Vector((-d.y, d.x, 0)) * widths[i]
        left.append(tuple(pts[i] - side + Vector((0, 0, lift))))
        right.append(tuple(pts[i] + side + Vector((0, 0, lift))))
    return _surface(p, [left, right], lambda i, j, c: mat_fn(j),
                    orient="up")


def _arm_path(cx, cy, z, r0, r1, phase, turns, n=12, sense=1):
    """Points on a logarithmic spiral arm from r0 to r1 over `turns`."""
    out = []
    for i in range(n + 1):
        t = i / n
        r = r0 * (r1 / r0) ** t
        a = phase + sense * turns * TAU * t
        out.append(Vector((cx + r * math.cos(a), cy + r * math.sin(a), z)))
    return out


def _spiral(p, centre, R, z, arms=2, turns=0.85, seed=0, sense=1,
            core="uni_core", bulge="uni_bulge", arm="uni_arm",
            arm_dim="uni_arm_dim", haze="uni_haze", knots="uni_hii",
            bulge_r=0.2, n=12, nknots=4, haze_segs=16):
    """A flat spiral galaxy on z: a domed bulge, a faint haze disc and
    `arms` trailing log-spiral ribbons with pink star-forming knots."""
    cx, cy = centre
    rnd = random.Random(seed)
    ph0 = rnd.uniform(0, TAU)
    with p.xform((cx, cy, 0)):
        _disc(p, (R * 0.12, R * 0.62, R * 0.98), haze_segs,
              lambda r, a: U(arm_dim if r < R * 0.6 else haze), z=z - 1.2,
              wobble=lambda r, a: 1 + 0.05 * math.sin(math.radians(a) * 3
                                                      + ph0))
    rb = R * bulge_r
    _uvs(p, 8, 5, lambda nn: U(core if nn.z > 0.45 else bulge),
         (cx, cy, z), (rb, rb, rb * 0.55))
    for k in range(arms):
        ph = ph0 + TAU * k / arms
        pts = _arm_path(cx, cy, z, rb * 0.8, R, ph, turns, n, sense)
        w = [R * (0.11 - 0.07 * (i / n)) * min(1.0, 0.4 + 2.5 * i / n)
             for i in range(n + 1)]

        def mf(j):
            t = j / n
            return U(bulge if t < 0.2 else arm if t < 0.7 else arm_dim)

        _ribbon(p, pts, w, mf, lift=0.4)
        for kk in range(nknots // arms + (1 if k < nknots % arms else 0)):
            q = pts[rnd.randint(4, n - 1)]
            _mini(p, (q.x, q.y, z + 1.5), R * rnd.uniform(0.04, 0.06),
                  U(knots))


def _elliptical(p, centre, rx, ry, rz, shades=("uni_ell_core", "uni_ell_mid",
                                               "uni_ell_out"), u=12, v=7):
    """A smooth ellipsoid that glows from the middle outwards (faces turned to
    the camera are brightest). Its bottom sits at centre.z - rz."""
    def classify(n):
        d = n.dot(VIEW)
        if d > 0.8:
            return U(shades[0])
        if d > 0.45:
            return U(shades[1])
        return U(shades[2])

    _uvs(p, u, v, classify, centre, (rx, ry, rz))


def _tiny_spiral(p, c, r, disc, core, ang=0.0, tilt=0.0):
    """A tiny galaxy: an S-ish oval disc (8 triangles) with a core point."""
    with p.xform(c, (tilt, 0, ang)):
        _disc(p, (0, r), 8, lambda rr, a: U(disc),
              wobble=lambda rr, a: 1 + 0.3 * math.cos(2 * math.radians(a)))
        _mini(p, (0, 0, r * 0.08), r * 0.32, U(core))


def _tiny_ell(p, c, r, material, ang=0.0):
    """A tiny elliptical galaxy: a squashed octahedron (8 triangles)."""
    with p.xform(c, (0, 0, ang), (1.0, 0.72, 0.6)):
        _mini(p, (0, 0, 0), r, U(material))


def _filament(p, pts, r0, r1, core="uni_web_bright", sheath="uni_web",
              glow="uni_web_dim", glow_w=2.6, segs=5):
    """A strand of the cosmic web: a bright tube thickest in the middle
    (radius r0 there, r1 at the ends) on a wider, dim glow ribbon."""
    n = len(pts)
    rs = [r1 + (r0 - r1) * math.sin(math.pi * i / (n - 1)) for i in range(n)]
    _tube(p, pts, rs, lambda i, j, c: U(
        core if 0.25 < i / (n + 1) < 0.75 else sheath), segs=segs)
    flat = [Vector((q.x, q.y, 0.6)) for q in pts]
    _ribbon(p, flat, [r * glow_w for r in rs], lambda j: U(glow))


def _galaxies_along(p, pts, rnd, count, rmin, rmax, spread):
    """Scatter tiny galaxies along a path, a little to either side."""
    mats = [("uni_arm", "uni_core"), ("uni_young", "uni_core"),
            ("uni_warm_arm", "uni_warm_core")]
    for k in range(count):
        t = (k + 0.5) / count
        q = pts[min(len(pts) - 1, int(t * (len(pts) - 1)))]
        off = Vector((rnd.uniform(-spread, spread),
                      rnd.uniform(-spread, spread), 0))
        r = rnd.uniform(rmin, rmax)
        c = (q.x + off.x, q.y + off.y, max(r * 0.7, q.z + rnd.uniform(-2, 4)))
        if k % 3 == 2:
            _tiny_ell(p, c, r, "uni_ell_mid", rnd.uniform(0, 180))
        else:
            disc, core = mats[k % len(mats)]
            _tiny_spiral(p, c, r, disc, core, rnd.uniform(0, 360),
                         rnd.uniform(-12, 12))


# --------------------------------------------------------------------------
# Hazards
# --------------------------------------------------------------------------

def quasar():
    R, C = 26.0, 96.0
    LJ = 230.0
    m = Model("quasar", "")
    b = m.part("body")
    b.smooth_angle = math.radians(60)

    def core(n):
        v = n.dot(VIEW) + 0.25 * _noise(n, 4.0, 1.0)
        return U("uni_q_white" if v > 0.1 else "uni_q_cyan")

    _uvs(b, 14, 8, core, (0, 0, C), (R, R, R))
    b.torus(R + 5, 2.6, (0, 0, C), U("uni_q_white"), segs=24, rsegs=4,
            scale=(1, 1, 0.8))
    # a four-point glare round the core, flat in the disc plane
    for a in (0, 90, 180, 270):
        x0, y0, _ = polar(a, R * 0.9)
        x1, y1, _ = polar(a, R * 3.6)
        b.rod((x0, y0, C), (x1, y1, C), 5, U("uni_q_cyan"), segs=4, r2=0.6)
    d = m.part("disk", pivot=(0, 0, C))
    radii = (R + 8, R + 18, R + 32, R + 50, R + 72, R + 96)
    _spiral_disc(d, C, radii, 32,
                 [(R + 20, "uni_q_white", "uni_q_cyan"),
                  (R + 34, "uni_q_cyan", "uni_q_blue"),
                  (R + 52, "uni_q_blue", "uni_q_violet"),
                  (R + 74, "uni_q_violet", "uni_q_indigo"),
                  (R + 100, "uni_q_indigo", "uni_cmb_dim")],
                 arms=3, twist=0.014, flare=0.08, seed=7)
    j = m.part("jets", pivot=(0, 0, C))
    # north jet: narrow and long, straight up the spin axis
    with j.xform((0, 0, C + R - 4)):
        j.lathe([(4.5, 0), (5.5, LJ * 0.5), (5.0, LJ * 0.95), (0, LJ)],
                U("uni_q_white"), segs=8)
        j.lathe([(10, 4), (11, LJ * 0.4), (13, LJ * 0.8), (9, LJ * 0.94),
                 (0, LJ * 0.97)], U("uni_q_cyan"), segs=8)
        for k, f in enumerate((0.3, 0.58, 0.84)):
            j.torus(13 + 2 * f, 3.2 - 0.6 * k, (0, 0, LJ * f),
                    U("uni_q_blue"), segs=10, rsegs=4)
    # south jet: down the axis into a splash on the floor
    bot = C - R + 4
    j.lathe([(0, 1.5), (60, 1.5), (40, 7), (12, bot * 0.5), (10, bot),
             (0, bot)], U("uni_q_cyan"), segs=10)
    j.lathe([(0, 2.5), (5, bot * 0.5), (4.5, bot + 2), (0, bot + 2)],
            U("uni_q_white"), segs=8)
    _disc(j, (60, 84), 20, lambda r, a: U("uni_q_violet"), z=1.0,
          wobble=lambda r, a: 1 + 0.08 * math.sin(math.radians(a) * 5))
    m.notes = (f"{SCALE_NOTE} Wanderer with pull. A blazing white-blue core "
               f"(radius {R:g}, centre (0, {C:g}, 0)) in a white ring with a "
               "four-point cyan glare. disk node: the accretion disc, a flat, "
               f"slightly bowled sheet from r {R + 8:g} to {R + 96:g}, "
               "white, cyan, blue, violet and indigo with an orange rim in "
               "three trailing spiral arms; spins about Y; pivot at the core "
               f"centre (0, {C:g}, 0). jets node: twin narrow jets on the "
               f"spin axis, north up to y {C + R - 4 + LJ:g} (white core in a "
               "cyan sheath with blue knots), south down into a violet splash "
               f"(r 84) on the floor; pivot at the core centre (0, {C:g}, 0) "
               "(pulse with scale Y).")
    return m


def colliding_galaxy():
    m = Model("colliding_galaxy", "")
    b = m.part("body")
    A = (-34.0, -46.0, 14.0, 66.0)  # x, y (Blender), z, radius
    B = (40.0, 34.0, 18.0, 56.0)
    rnd = random.Random(23)
    # tidal tails streaming back (Blender +Y = glTF -Z), behind the travel
    tail_a = _bez((A[0] - 40, A[1] + 20, 6), (-120, 30, 6), (-110, 110, 6),
                  (-60, 170, 6), 10)
    tail_b = _bez((B[0] + 44, B[1] - 6, 6), (130, 60, 6), (110, 150, 6),
                  (40, 190, 6), 10)
    for pts, mats in ((tail_a, ("uni_arm", "uni_arm_dim", "uni_haze")),
                      (tail_b, ("uni_warm_arm", "uni_warm_dim",
                                "uni_warm_haze"))):
        n = len(pts) - 1
        w = [14 * (1 - 0.75 * i / n) for i in range(n + 1)]
        _ribbon(b, pts, w, lambda jj, mm=mats, n=n: U(
            mm[0] if jj < n * 0.3 else mm[1] if jj < n * 0.7 else mm[2]))
        _galaxies_along(b, pts[3:], rnd, 3, 4, 6, 10)
    # the bridge of stars and starburst knots where the discs overlap
    bridge = _bez((A[0] + 30, A[1] + 30, 8), (0, -10, 8), (10, 10, 8),
                  (B[0] - 30, B[1] - 26, 8), 6)
    _ribbon(b, bridge, [12, 14, 15, 15, 14, 13, 12], lambda jj: U(
        "uni_hii" if jj in (2, 3) else "uni_arm_dim"))
    for x, y in ((0, -4), (10, 10), (-8, 8), (16, -12)):
        _mini(b, (x, y, 12), rnd.uniform(5, 7), U("uni_hii"))
    ga = m.part("galaxy_a", pivot=(A[0], A[1], A[2]))
    _spiral(ga, (A[0], A[1]), A[3], A[2], arms=2, turns=0.8, seed=3,
            nknots=4)
    gb = m.part("galaxy_b", pivot=(B[0], B[1], B[2]))
    _spiral(gb, (B[0], B[1]), B[3], B[2], arms=2, turns=0.75, seed=5,
            sense=-1, core="uni_warm_core", bulge="uni_warm_core",
            arm="uni_warm_arm", arm_dim="uni_warm_dim",
            haze="uni_warm_haze", nknots=4)
    pa = (A[0], A[2], -A[1])
    pb = (B[0], B[2], -B[1])
    m.notes = (f"{SCALE_NOTE} Lane patrol. Two small spiral galaxies "
               "mid-merger, travelling +Z: galaxy_a (pale blue-white, radius "
               f"{A[3]:g}, in front, pivot at its centre {pa}) and galaxy_b "
               f"(warm peach, radius {B[3]:g}, behind, pivot {pb}), both flat "
               "in XZ, each spinning about its own Y (they turn in opposite "
               "senses: galaxy_b's arms wind the other way). body: a pink "
               "starburst bridge between them and two tidal tails of stars "
               "streaming back to -Z (to z -190).")
    return m


def gamma_ray_burst():
    H, R, L = 58.0, 24.0, 160.0
    m = Model("gamma_ray_burst", "")
    b = m.part("body")
    # the hypernova's ejecta: a glowing floor disc ringed by shell fragments
    _disc(b, (0, 40, 70, 86), 20, lambda r, a: U(
        "uni_hn_dark" if r < 42 else "uni_hn_violet" if r < 72 else
        "uni_cmb_dim"), z=1.0,
        wobble=lambda r, a: 1 + 0.08 * math.sin(math.radians(a) * 5))
    rnd = random.Random(13)
    for k in range(9):
        a0 = k * 40 + rnd.uniform(-6, 6)
        b.band(74, 88, 0.5, rnd.uniform(6, 12), a0, a0 + rnd.uniform(16, 26),
               U("uni_cmb" if k % 2 else "uni_hn_red"), segs=3)
    h = m.part("head")
    h.smooth_angle = math.radians(60)
    s = 3.0

    def star(n):
        # infalling spiral bands on a white-hot collapsing star
        lat, lon = math.asin(max(-1, min(1, n.z))), math.atan2(n.x, -n.y)
        v = math.sin(3 * lon + 5 * lat + s) + 0.4 * _noise(n, 4.0, s)
        if v > 0.55:
            return U("uni_hn_violet")
        if v < -0.9:
            return U("uni_hn_dark")
        return U("uni_hn_white")

    _uvs(h, 14, 8, star, (0, 0, H), (R, R, R),
         lambda n: 0.06 * _noise(n, 5.0, s))
    # the collapsar disc squeezing its waist
    h.torus(R + 7, 3.0, (0, 0, H), U("uni_hn_violet"), segs=20, rsegs=4,
            scale=(1, 1, 0.7))
    h.torus(R + 15, 2.0, (0, 0, H), U("uni_hn_red"), segs=20, rsegs=4,
            scale=(1, 1, 0.7))
    # the beam emitter on +Z (Blender -Y): a flared nozzle and a narrow,
    # collimated beam; a short dim counter-jet on -Z
    with h.xform((0, 0, H), (90, 0, 0)):  # local +Z = Blender -Y
        h.lathe([(9, R * 0.7), (12, R + 6), (16, R + 14), (13, R + 15),
                 (8, R + 9)], U("uni_grb_sheath"), segs=10)
        h.torus(15, 2.4, (0, 0, R + 14), U("uni_grb_green"), segs=10,
                rsegs=4)
        h.lathe([(3.0, R), (3.6, L * 0.6), (2.8, L * 0.97), (0, L)],
                U("uni_grb_beam"), segs=6)
        h.lathe([(6.0, R + 8), (8.0, L * 0.55), (6.0, L * 0.9),
                 (0, L * 0.94)], U("uni_grb_sheath"), segs=8)
    with h.xform((0, 0, H), (-90, 0, 0)):
        h.lathe([(4.0, R * 0.8), (5.0, R + 20), (0, R + 44)],
                U("uni_grb_sheath"), segs=6)
    m.notes = (f"{SCALE_NOTE} Turret. body: the hypernova's ejecta, a dark "
               "violet glow disc (r 86) ringed by orange and red shell "
               "fragments. head node: the collapsing star (radius "
               f"{R:g}, centre (0, {H:g}, 0), white-hot with violet infall "
               "bands) in a violet and red collapsar disc, carrying a flared "
               "nozzle and a narrow white beam in a violet sheath along +Z "
               f"(a short counter-jet on -Z); it aims about Y through its "
               f"pivot at the origin (0, 0, 0). Nozzle mouth at (0, {H:g}, "
               f"{R + 15:g}); beam tip (the muzzle) at (0, {H:g}, {L:g}).")
    return m


def cosmic_void():
    R = 82.0
    C = R
    m = Model("cosmic_void", "")
    b = m.part("body")
    # a CMB-orange glow round its foot on the floor
    _disc(b, (R * 0.7, R * 1.02, R * 1.22), 24, lambda r, a: U(
        "uni_cmb_dim" if r > R else "uni_void_rim"), z=0.8,
        wobble=lambda r, a: 1 + (0.05 * math.sin(math.radians(a) * 6)
                                 if r > R else 0))
    sh = m.part("shell", pivot=(0, 0, C))
    sh.smooth_angle = math.radians(70)
    _uvs(sh, 18, 10, lambda n: U("uni_void_rim" if n.dot(VIEW) < 0.2
                                 else "uni_void"), (0, 0, C), (R, R, R))
    # the thin rim of tiny bright galaxies, hugging the silhouette
    rnd = random.Random(37)
    n = 30
    for k in range(n):
        a = 360 * k / n + rnd.uniform(-4, 4)
        lat = rnd.uniform(-14, 22)
        d = _dir(a, lat)
        c = tuple(Vector((0, 0, C)) + d * (R + 3))
        r = rnd.uniform(4.5, 7.5)
        if k % 3 == 0:
            _tiny_ell(sh, c, r, "uni_ell_core", rnd.uniform(0, 180))
        else:
            _tiny_spiral(sh, c, r, ("uni_arm", "uni_young",
                                    "uni_warm_arm")[k % 3],
                         "uni_core", rnd.uniform(0, 360),
                         rnd.uniform(-20, 20))
    sh.torus(R + 1.5, 1.6, (0, 0, C + 2), U("uni_web_dim"), segs=36,
             rsegs=3)
    # a few faint web strands draped over the dome
    for k in range(3):
        a = 120 * k + 20
        pts = [Vector((0, 0, C)) + _dir(a + 50 * t, 20 + 55 * math.sin(
            math.pi * t)) * (R + 1) for t in (i / 6 for i in range(7))]
        _tube(sh, pts, 1.4, U("uni_web_faint"), segs=3)
    m.notes = (f"{SCALE_NOTE} Trail-layer (slows). A dark bubble (radius "
               f"{R:g}, centre (0, {C:g}, 0)), near-black with a dim indigo "
               "limb and three faint web strands over the top, ringed round "
               "its silhouette by 30 tiny bright galaxies and a thin web "
               "ring. shell node: the bubble and its rim; pulse it (scale); "
               f"pivot at its centre (0, {C:g}, 0). body: a CMB-orange glow "
               f"ring on the floor round its foot (r {R * 1.22:g}).")
    return m


def dark_energy_gust():
    R, C, L = 34.0, 52.0, 230.0
    m = Model("dark_energy_gust", "")
    b = m.part("body")
    # a swirl on the floor
    b_rnd = random.Random(2)
    ph = b_rnd.uniform(0, TAU)

    def swirl(r, a):
        s = math.sin(3 * math.radians(a) - r * 0.06 + ph)
        if r < 30:
            return U("uni_de_violet")
        return U("uni_de_indigo" if s > 0.2 else "uni_de_deep")

    _disc(b, (0, 30, 52, 74, 92), 24, swirl, z=1.0,
          wobble=lambda r, a: 1 + 0.06 * math.sin(math.radians(a) * 4))
    # gusts: three wisps fanning out forward (Blender -Y = glTF +Z), widening
    # into a cone, each ending in a flat curl
    for k, a in enumerate((-24, 0, 24)):
        Lk = L if k == 1 else L * 0.82
        pts = []
        for i in range(10):
            t = i / 9
            aa = a + 7 * math.sin(t * 4 + k * 2) * t
            x, y, _ = polar(aa, R * 0.9 + (Lk - R * 0.9) * t)
            pts.append(Vector((x, y, 3 + 18 * (1 - t) ** 1.5 + k * 0.4)))
        w = [5 + 22 * (i / 9) ** 0.8 for i in range(10)]
        w[-1] *= 0.6
        _ribbon(b, pts, w, lambda jj: U(
            "uni_de_magenta" if jj < 3 else "uni_de_violet" if jj < 6 else
            "uni_de_indigo"))
        # a curl near the tip, swirling the other way on each side
        q = pts[7]
        sense = 1 if k != 0 else -1
        curl = _arm_path(q.x, q.y, q.z + 1.5, 4, 20, math.radians(a * 3), 0.9,
                         8, sense)
        _ribbon(b, curl, [1.5 + 2.5 * i / 8 for i in range(9)],
                lambda jj: U("uni_de_magenta"))
    co = m.part("core", pivot=(0, 0, C))
    co.smooth_angle = math.radians(60)

    def bands(n):
        lat, lon = math.asin(max(-1, min(1, n.z))), math.atan2(n.x, -n.y)
        v = math.sin(2 * lon + 4 * lat)
        if n.dot(VIEW) > 0.85:
            return U("uni_de_core")
        return U("uni_de_magenta" if v > 0.35 else "uni_de_violet"
                 if v > -0.4 else "uni_de_indigo")

    _uvs(co, 14, 8, bands, (0, 0, C), (R, R, R),
         lambda n: 0.07 * _noise(n, 4.0, 3.0))
    # swirling rings round the ball
    co.torus(R + 8, 2.4, (0, 0, C), U("uni_de_magenta"), segs=20, rsegs=4,
             rot=(18, 0, 0))
    co.torus(R + 14, 1.8, (0, 0, C), U("uni_de_violet"), segs=20, rsegs=4,
             rot=(-14, 22, 0))
    # the nozzle: a flared horn on +Z with a bright throat
    with co.xform((0, 0, C), (90, 0, 0)):
        co.lathe([(12, R * 0.8), (14, R + 12), (24, R + 28), (21, R + 30),
                  (10, R + 18)], U("uni_de_indigo"), segs=12)
        co.torus(22, 2.8, (0, 0, R + 29), U("uni_de_magenta"), segs=12,
                 rsegs=4)
        co.lathe([(0, R + 14), (9, R + 16), (0, R + 22)], U("uni_de_core"),
                 segs=8)
    m.notes = (f"{SCALE_NOTE} Cone blaster (blow). body: a violet and indigo "
               "swirl on the floor (r 92) and three curling violet gust "
               f"wisps blowing out to +Z (to r {L:g}, +-22 degrees). core "
               f"node: a swirling violet ball (radius {R:g}, centre "
               f"(0, {C:g}, 0)) with two tilted rings and a flared nozzle "
               "facing +Z; swells (scale); pivot at its centre "
               f"(0, {C:g}, 0). Nozzle mouth (emit point) at (0, {C:g}, "
               f"{R + 30:g}).")
    return m


def the_expansion():
    R0, R1 = 130.0, 300.0  # lattice inner / outer radius

    def lift(r):  # the metric bowl rises outwards, space pulling away
        return 2.0 + 40.0 * ((r - R0) / (R1 - R0)) ** 2

    m = Model("the_expansion", "")
    # a token body: a faint CMB-orange rim on the floor under the ring
    b = m.part("body")
    _disc(b, (R1 + 2, R1 + 18), 48, lambda r, a: U("uni_cmb_dim"), z=0.5)
    g = m.part("grid")
    # concentric circles of the comoving grid, brighter outwards (stretched)
    rings = (R0, 170.0, 210.0, 255.0, R1)
    for k, r in enumerate(rings):
        w = 1.6 + 0.9 * k
        segs = 48
        pts = []
        for i in range(segs + 1):
            x, y, _ = polar(360 * i / segs, r)
            pts.append(Vector((x, y, lift(r))))
        mname = ("uni_grid_dim", "uni_grid_dim", "uni_grid", "uni_grid",
                 "uni_grid_bright")[k]
        _ribbon(g, pts, [w] * len(pts), lambda j, mm=mname: U(mm))
    # radial spokes, each ending in an outward chevron
    for k in range(24):
        a = 15 * k
        pts = []
        for i in range(6):
            r = R0 + (R1 - R0) * i / 5
            x, y, _ = polar(a, r)
            pts.append(Vector((x, y, lift(r) + 0.3)))
        _ribbon(g, pts, [1.4 + 0.5 * i for i in range(6)], lambda j: U(
            "uni_grid_dim" if j < 2 else "uni_grid"))
        if k % 2 == 0:
            tip = Vector(polar(a, R1 + 16, lift(R1) + 1))
            for side in (-1, 1):
                base = Vector(polar(a + side * 4.5, R1 + 4, lift(R1) + 1))
                g.rod(tuple(base), tuple(tip), 2.2, U("uni_cmb_hot"),
                      segs=4)
    # the ring: a glowing CMB-orange band with tick marks, galaxies flying
    # off it outwards with streaks behind them
    rg = m.part("ring")
    RR = R1 + 22
    rg.torus(RR, 4.0, (0, 0, lift(R1) + 4), U("uni_cmb"), segs=64, rsegs=4,
             scale=(1, 1, 0.7))
    for k in range(32):
        a = 360 * k / 32
        big = k % 4 == 0
        rg.rod(polar(a, RR - (9 if big else 6), lift(R1) + 4),
               polar(a, RR + (9 if big else 6), lift(R1) + 4),
               1.6 if big else 1.1, U("uni_cmb_hot" if big else "uni_cmb"),
               segs=4)
    rnd = random.Random(53)
    for k in range(10):
        a = 36 * k + rnd.uniform(-8, 8)
        r = RR + rnd.uniform(20, 42)
        z = lift(R1) + rnd.uniform(8, 22)
        c = Vector(polar(a, r, z))
        if k % 3 == 1:
            _tiny_ell(rg, tuple(c), 7.5, "uni_ell_core", a)
        else:
            _tiny_spiral(rg, tuple(c), rnd.uniform(9, 12),
                         ("uni_arm", "uni_warm_arm")[k % 2], "uni_core",
                         rnd.uniform(0, 360), rnd.uniform(-15, 15))
        # a motion streak trailing back inwards
        s0 = Vector(polar(a, r - 10, z))
        s1 = Vector(polar(a, r - 46, z - 6))
        rg.rod(tuple(s0), tuple(s1), 3.0, U("uni_grid"), segs=4, r2=0.4)
    m.notes = (f"{SCALE_NOTE} Boss (not a body: a frame round the Bunny, "
               f"hollow inside r {R0:g}). grid node: the comoving metric "
               f"lattice, five glowing concentric circles (r {R0:g} to "
               f"{R1:g}) and 24 radial spokes, curving up into a shallow "
               f"bowl (y 2 at r {R0:g} to {lift(R1):g} at r {R1:g}), with 12 "
               "orange chevrons pointing outwards at the rim; scale it "
               "outwards (X/Z) as space stretches; pivot at the origin "
               f"(0, 0, 0). ring node: a CMB-orange band (r {RR:g}) with "
               "tick marks, and ten tiny galaxies flying off it outwards "
               f"(to r about {RR + 50:g}) with streaks behind them; turns "
               "about Y; pivot at the origin. body: a faint orange rim on "
               "the floor under the ring.")
    return m


# --------------------------------------------------------------------------
# Debris props
# --------------------------------------------------------------------------

def spiral_galaxy():
    m = Model("spiral_galaxy", f"{PROP_NOTE} A face-on spiral galaxy lying "
              "flat: a cream bulge, two trailing pale blue-white arms with "
              "pink star-forming knots, on a faint blue haze disc (r 100). "
              "Pale, so a tintAll colour reads.")
    b = m.part("body")
    _spiral(b, (0, 0), 100, 12, arms=2, turns=0.9, seed=1, bulge_r=0.2,
            n=14, nknots=6)
    _settle(m)
    return m


def barred_spiral():
    m = Model("barred_spiral", f"{PROP_NOTE} A barred spiral lying flat: a "
              "cream bulge crossed by a golden bar (along X), with two arms "
              "sweeping from the bar's ends, on a faint haze disc (r 100). "
              "Pale, so a tintAll colour reads.")
    b = m.part("body")
    z = 12.0
    _disc(b, (14, 62, 98), 16, lambda r, a: U(
        "uni_arm_dim" if r < 60 else "uni_haze"), z=z - 1.2)
    _uvs(b, 8, 5, lambda n: U("uni_core" if n.z > 0.45 else "uni_bulge"),
         (0, 0, z), (20, 20, 11))
    _uvs(b, 8, 4, lambda n: U("uni_bulge"), (0, 0, z - 1), (46, 11, 6))
    for k, sgn in enumerate((1, -1)):
        # each arm leaves a bar end and trails round half a turn and more
        pts = _arm_path(0, 0, z, 44, 100, 0 if sgn > 0 else math.pi, 0.62,
                        12)
        w = [10 - 6 * i / 12 for i in range(13)]
        _ribbon(b, pts, w, lambda j: U("uni_arm" if j < 8 else
                                       "uni_arm_dim"), lift=0.4)
        for i in (5, 9):
            q = pts[i]
            _mini(b, (q.x, q.y, z + 1.5), 5, U("uni_hii"))
    _settle(m)
    return m


def elliptical_galaxy():
    m = Model("elliptical_galaxy", f"{PROP_NOTE} A smooth, egg-shaped "
              "elliptical galaxy (100 x 76 x 58) glowing cream at the "
              "middle to amber at the edge, with a few globular-cluster "
              "points and a dim halo ring. Pale, so a tintAll colour reads.")
    b = m.part("body")
    _elliptical(b, (0, 0, 58), 92, 70, 58)
    _disc(b, (80, 100), 24, lambda r, a: U("uni_ell_halo"), z=4)
    rnd = random.Random(4)
    for k in range(6):
        d = _dir(60 * k + rnd.uniform(-15, 15), rnd.uniform(10, 40))
        c = Vector((d.x * 98, d.y * 76, 58 + d.z * 62))
        _mini(b, tuple(c), 4, U("uni_ell_core"))
    _settle(m)
    return m


def lenticular_galaxy():
    m = Model("lenticular_galaxy", f"{PROP_NOTE} A lenticular (S0) galaxy: a "
              "smooth lens-shaped disc (r 100) with a bright round bulge, a "
              "faint outer ring and a thin dust lane, no arms. Pale, so a "
              "tintAll colour reads.")
    b = m.part("body")
    b.lathe([(0, 0), (40, 2), (80, 6), (98, 11), (100, 14), (96, 17),
             (70, 22), (36, 26), (0, 27)], U("uni_ell_mid"), segs=18)
    b.torus(64, 2.0, (0, 0, 23.5), U("uni_dust"), segs=24, rsegs=3,
            scale=(1, 1, 0.4))
    _uvs(b, 10, 6, lambda n: U("uni_ell_core" if n.dot(VIEW) > 0.6 else
                               "uni_bulge"), (0, 0, 26), (36, 36, 24))
    b.torus(88, 2.6, (0, 0, 18), U("uni_ell_out"), segs=28, rsegs=3,
            scale=(1, 1, 0.5))
    _settle(m)
    return m


def irregular_galaxy():
    m = Model("irregular_galaxy", f"{PROP_NOTE} An irregular galaxy "
              "(Magellanic-like): a lopsided clump of lumpy blue-white star "
              "clouds with hot pink star-forming knots and a ragged haze. "
              "Pale, so a tintAll colour reads.")
    b = m.part("body")
    rnd = random.Random(9)
    _disc(b, (0, 60, 98), 14, lambda r, a: U("uni_haze" if r > 62 else
                                             "uni_arm_dim"), z=1.0,
          wobble=lambda r, a: 1 + 0.18 * math.sin(math.radians(a) * 2 + 1)
          + 0.1 * math.sin(math.radians(a) * 5))
    clouds = [(-12, 4, 30), (30, -20, 22), (-46, -26, 18), (16, 40, 20),
              (54, 22, 14), (-30, 50, 12)]
    for k, (x, y, r) in enumerate(clouds):
        s = rnd.uniform(0, 10)
        _uvs(b, 7, 4, lambda n, s=s: U("uni_arm" if _noise(n, 3, s) > -0.1
                                       else "uni_young"),
             (x, y, r * 0.5), (r, r * 0.9, r * 0.55),
             lambda n, s=s: 0.18 * _noise(n, 4.0, s))
    for k in range(7):
        x, y, _ = polar(rnd.uniform(0, 360), rnd.uniform(10, 60))
        _mini(b, (x, y, rnd.uniform(12, 20)), rnd.uniform(4, 6),
              U("uni_hii"))
    _settle(m)
    return m


def dwarf_galaxy():
    m = Model("dwarf_galaxy", f"{PROP_NOTE} A dwarf spheroidal galaxy: a "
              "faint, loose, squashed puff (r 70) with a dozen scattered "
              "star points and a dim halo (r 100). Pale, so a tintAll colour "
              "reads.")
    b = m.part("body")
    _elliptical(b, (0, 0, 30), 64, 56, 30, ("uni_arm", "uni_arm_dim",
                                            "uni_haze"), u=10, v=6)
    _disc(b, (56, 100), 16, lambda r, a: U("uni_web_faint"), z=2,
          wobble=lambda r, a: 1 + 0.08 * math.sin(math.radians(a) * 3))
    rnd = random.Random(12)
    for k in range(12):
        x, y, _ = polar(k * 137.5, rnd.uniform(40, 90))
        _mini(b, (x, y, rnd.uniform(6, 30)), rnd.uniform(3, 4.5),
              U("uni_core"))
    _settle(m)
    return m


def galaxy_pair():
    m = Model("galaxy_pair", f"{PROP_NOTE} An interacting pair: a pale "
              "spiral (r 52) and a smaller warm companion (r 38) linked by a "
              "bridge of stars, with one tidal tail curling away.")
    b = m.part("body")
    _spiral(b, (-40, 10), 52, 10, arms=2, turns=0.8, seed=2, nknots=3,
            n=10, haze_segs=12)
    _spiral(b, (54, -16), 38, 10, arms=2, turns=0.7, seed=6, sense=-1,
            core="uni_warm_core", bulge="uni_warm_core", arm="uni_warm_arm",
            arm_dim="uni_warm_dim", haze="uni_warm_haze", nknots=2, n=8,
            haze_segs=12)
    bridge = _bez((-4, -6, 8), (10, -30, 8), (28, -30, 8), (34, -16, 8), 5)
    _ribbon(b, bridge, [7, 8, 8, 7, 6, 5], lambda j: U("uni_arm_dim"))
    tail = _bez((-60, 50, 8), (-80, 80, 8), (-30, 100, 8), (10, 76, 8), 7)
    _ribbon(b, tail, [9 - i for i in range(8)], lambda j: U(
        "uni_arm_dim" if j < 4 else "uni_haze"))
    _settle(m)
    return m


def galaxy_group():
    m = Model("galaxy_group", f"{PROP_NOTE} A loose group of seven small "
              "galaxies (three spirals, three ellipticals, one edge-on disc) "
              "on a faint web-blue haze (r 100).")
    b = m.part("body")
    _disc(b, (0, 64, 100), 14, lambda r, a: U(
        "uni_web_faint" if r > 66 else "uni_haze"), z=1.0,
        wobble=lambda r, a: 1 + 0.1 * math.sin(math.radians(a) * 3 + 2))
    _spiral(b, (-30, -24), 30, 6, seed=21, nknots=2, n=8, haze_segs=10)
    _spiral(b, (44, 34), 24, 6, seed=22, sense=-1, core="uni_warm_core",
            bulge="uni_warm_core", arm="uni_warm_arm",
            arm_dim="uni_warm_dim", haze="uni_warm_haze", nknots=0, n=7,
            haze_segs=10)
    _tiny_spiral(b, (-56, 44, 8), 16, "uni_young", "uni_core", 40, 6)
    for x, y, r in ((24, -46, 14), (-6, 30, 11), (68, -8, 9)):
        _elliptical(b, (x, y, r * 0.75), r, r * 0.8, r * 0.75, u=8, v=5)
    # an edge-on disc
    b.lathe([(0, -2), (22, 0), (0, 2)], U("uni_arm"), segs=10,
            center=(-70, -30, 10), rot=(0, 0, 30), scale=(1, 0.25, 1.4))
    _mini(b, (-70, -30, 10), 4, U("uni_core"))
    _settle(m)
    return m


def galaxy_cluster():
    m = Model("galaxy_cluster", f"{PROP_NOTE} A rich galaxy cluster: a "
              "giant cream elliptical at the heart of a dense ball of 36 "
              "tiny galaxies (r 66), on a faint violet-pink hot-gas halo "
              "(r 100) with a thin halo ring.")
    b = m.part("body")
    C = 40.0
    _disc(b, (0, 50, 84, 100), 18, lambda r, a: U(
        "uni_xray_pink" if r < 52 else "uni_xray" if r < 86 else
        "uni_web_faint"), z=1.0,
        wobble=lambda r, a: 1 + 0.06 * math.sin(math.radians(a) * 4))
    b.torus(78, 1.8, (0, 0, 4), U("uni_xray_pink"), segs=28, rsegs=3,
            scale=(1, 1, 0.5))
    _elliptical(b, (0, 0, C - 6), 24, 22, 20, u=10, v=6)
    rnd = random.Random(27)
    n = 36
    for k in range(n):
        zc = 1 - 1.55 * (k + 0.5) / n
        th = k * 2.399963
        rr = math.sqrt(max(0.0, 1 - zc * zc))
        d = Vector((rr * math.cos(th), rr * math.sin(th), zc * 0.6))
        pos = Vector((0, 0, C)) + d * (28 + 38 * rnd.random() ** 1.4)
        pos.z = max(pos.z, 8.0)
        r = rnd.uniform(6, 9)
        if k % 2:
            _tiny_ell(b, tuple(pos), r, ("uni_ell_mid", "uni_ell_core")[
                k % 4 == 1], rnd.uniform(0, 180))
        else:
            _tiny_spiral(b, tuple(pos), r * 1.3, ("uni_arm", "uni_warm_arm",
                                                  "uni_young")[k % 3],
                         "uni_core", rnd.uniform(0, 360),
                         rnd.uniform(-25, 25))
    _settle(m)
    return m


def filament_knot():
    m = Model("filament_knot", f"{PROP_NOTE} A short strand of the cosmic "
              "web: a bright pale-blue filament (thickest in the middle) "
              "curving along X on a dim glow ribbon, with a bright knot at "
              "its middle and nine tiny galaxies strung along it.")
    b = m.part("body")
    pts = _bez((-104, 20, 8), (-40, -40, 14), (40, 50, 14), (104, -16, 8),
               12)
    _filament(b, pts, 8, 2.5)
    mid = pts[6]
    _uvs(b, 8, 5, lambda n: U("uni_web_bright"), (mid.x, mid.y, mid.z),
         (14, 14, 12))
    _galaxies_along(b, pts, random.Random(31), 9, 4.5, 7, 14)
    _settle(m)
    return m


def supercluster_node():
    m = Model("supercluster_node", f"{PROP_NOTE} A supercluster node where "
              "four filaments of the cosmic web meet: a bright white-blue "
              "knot ringed with tiny galaxies, filament stubs radiating out "
              "to r 100 with galaxies along them, on a faint glow.")
    b = m.part("body")
    C = 26.0
    _disc(b, (0, 40, 70), 16, lambda r, a: U(
        "uni_web_dim" if r < 42 else "uni_web_faint"), z=0.8)
    rnd = random.Random(41)
    for k, a in enumerate((20, 115, 200, 290)):
        L = rnd.uniform(86, 100)
        e = Vector(polar(a, L, 6 + 4 * (k % 2)))
        mid = Vector(polar(a + rnd.uniform(-20, 20), L * 0.5, C * 0.6))
        pts = _bez((0, 0, C), tuple(mid), tuple(mid), tuple(e), 7)
        _filament(b, pts, 6, 2.2, glow_w=2.2)
        _galaxies_along(b, pts[2:], rnd, 3, 4, 6, 8)
    _uvs(b, 12, 7, lambda n: U("uni_web_bright" if n.dot(VIEW) > 0.3 else
                               "uni_web"), (0, 0, C), (24, 24, 22),
         lambda n: 0.08 * _noise(n, 4.0, 1.0))
    for k in range(10):
        d = _dir(36 * k, rnd.uniform(-10, 40))
        _tiny_ell(b, tuple(Vector((0, 0, C)) + d * 30), 4.5,
                  "uni_ell_core", rnd.uniform(0, 180))
    _settle(m)
    return m


def radio_galaxy():
    m = Model("radio_galaxy", f"{PROP_NOTE} A radio galaxy: a small cream "
              "elliptical with two thin white jets along X feeding two "
              "billowing orange-red radio lobes with hot spots at their outer "
              "ends; spans X (about 200).")
    b = m.part("body")
    Z = 28.0
    _elliptical(b, (0, 0, Z), 26, 22, 22, u=10, v=6)
    rnd = random.Random(44)
    for sgn in (-1, 1):
        b.rod((sgn * 20, 0, Z), (sgn * 62, 0, Z + 2), 2.4,
              U("uni_q_white"), segs=5, r2=3.2)
        s = rnd.uniform(0, 10)

        def lobe(n, s=s, sgn=sgn):
            if n.x * sgn > 0.55:
                return U("uni_lobe_hot")
            return U("uni_lobe" if _noise(n, 3.0, s) > -0.2 else
                     "uni_lobe_deep")

        _uvs(b, 10, 6, lobe, (sgn * 72, 0, Z), (30, 26, 22),
             lambda n, s=s: 0.15 * _noise(n, 3.5, s))
        _mini(b, (sgn * 98, 0, Z + 2), 7, U("uni_cmb_hot"))
    _disc(b, (0, 16, 30), 12, lambda r, a: U("uni_ell_halo"), z=1)
    _settle(m)
    return m


def great_attractor():
    m = Model("great_attractor", f"{PROP_NOTE} The Great Attractor (a "
              "one-off): a big warm glowing knot (r 48) of white, gold and "
              "orange, swarmed by tiny galaxies and fed by five streams of "
              "galaxies spiralling in from r 100, on a warm halo.")
    b = m.part("body")
    C = 50.0
    _disc(b, (0, 56, 84, 100), 20, lambda r, a: U(
        "uni_ga_orange" if r < 58 else "uni_ga_red" if r < 86 else
        "uni_cmb_dim"), z=1.0,
        wobble=lambda r, a: 1 + 0.06 * math.sin(math.radians(a) * 5))

    def core(n):
        v = n.dot(VIEW) + 0.25 * _noise(n, 3.5, 2.0)
        return U("uni_ga_white" if v > 0.7 else "uni_ga_gold" if v > 0.2
                 else "uni_ga_orange")

    _uvs(b, 14, 8, core, (0, 0, C), (46, 46, 44),
         lambda n: 0.06 * _noise(n, 4.0, 2.0))
    rnd = random.Random(61)
    for k in range(5):
        a0 = 72 * k
        pts = []
        for i in range(9):
            t = i / 8
            a = math.radians(a0 + 70 * t)
            r = 100 - 52 * t
            pts.append(Vector((r * math.sin(a), -r * math.cos(a),
                               6 + (C - 12) * t ** 1.5)))
        _tube(b, pts, [2.0 + 2.5 * i / 8 for i in range(9)],
              lambda i, j, c: U("uni_ga_red" if i < 4 else "uni_ga_orange"),
              segs=4)
        _galaxies_along(b, pts[:6], rnd, 2, 4, 5.5, 4)
    for k in range(10):
        d = _dir(36 * k + 18, rnd.uniform(0, 45))
        _mini(b, tuple(Vector((0, 0, C)) + d * 52), rnd.uniform(3.5, 5),
              U("uni_ga_gold"))
    _settle(m)
    return m


HAZARDS = [quasar, colliding_galaxy, gamma_ray_burst, cosmic_void,
           dark_energy_gust, the_expansion]
PROPS = [spiral_galaxy, barred_spiral, elliptical_galaxy, lenticular_galaxy,
         irregular_galaxy, dwarf_galaxy, galaxy_pair, galaxy_group,
         galaxy_cluster, filament_knot, supercluster_node, radio_galaxy,
         great_attractor]
