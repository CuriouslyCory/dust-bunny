"""Galaxy models (Act 8): the Galaxy's Hazards (a wandering black hole, a
globular cluster on patrol, a pulsar turret, a supernova remnant, a supernova
blaster), Sagittarius A* (the boss: a supermassive black hole with a face)
and Galaxy Debris (stars, binaries, clusters, nebulae, a rogue planet, a
brown dwarf, a comet cloud, the boss's relativistic jet chips, and the sock).

Scale: 1 Blender unit = 1 light year. One Galaxy world unit is 100 ly =
100 BU, so the game loads these files at scale 0.01 (manifest.json
"scale": 0.01), like the Continent, Globe and Solar System models. Debris
props are normalised to their Debris size by the game, so they are drawn at a
convenient size (stars: ball radius about 60, planets radius 100) and only
their proportions matter. Everything else follows the shared conventions:
X right, -Y forward (exported as glTF +Z), Z up, origin at the bottom centre
where the model touches the floor (space objects float; their lowest point
sits on the floor).

Space is dark, so the look is carried by emissive materials. The game camera
looks down at about 54 degrees from the +Z side, so the upper, front-facing
(-Y) half of every model carries the read: the black holes' and the
supernova's eyes sit there.

Debris props are baked into one vertex-coloured mesh per type
(src/entities/debrisGeometry.ts), which keeps base colours but drops the
per-part emission: their base colours are therefore bright, and the Debris
type should set its own `material.emissive` in the prop's main hue.
"""

import math
import random

from mathutils import Matrix, Vector

from common import Model, mat, polar
from continent import _surface
from solar import _dir, _frame, _noise, _tube, _uvs

UNITS = "1 ly"
SCALE_NOTE = "Galaxy scale: 1 unit = 1 light year, load at scale 0.01."
PROP_NOTE = (f"{SCALE_NOTE} Debris prop (normalised to its Debris size, only "
             "proportions matter).")
TAU = 2 * math.pi

# name: (hex colour, roughness, metallic, emission hex or None, strength)
PAL = {
    # black holes
    "gal_void": ("#06050b", 0.35, 0.0, None, 0),
    "gal_void_rim": ("#1a1230", 0.35, 0.0, None, 0),
    "gal_photon": ("#fffaf0", 0.2, 0.0, "#fff4dc", 7.0),
    "gal_disc_white": ("#fff3d6", 0.3, 0.0, "#ffeab8", 5.0),
    "gal_disc_gold": ("#ffc24a", 0.35, 0.0, "#ffae20", 4.5),
    "gal_disc_orange": ("#ff7b2e", 0.4, 0.0, "#ff6010", 4.0),
    "gal_disc_red": ("#e8443a", 0.4, 0.0, "#d82a20", 3.2),
    "gal_disc_magenta": ("#e0409a", 0.4, 0.0, "#d02a88", 3.0),
    "gal_disc_violet": ("#8a4ae0", 0.45, 0.0, "#6a30d0", 2.4),
    "gal_disc_indigo": ("#4a3aa8", 0.5, 0.0, "#30208a", 1.6),
    # eyes
    "gal_eye": ("#f6f0ff", 0.25, 0.0, "#efe2ff", 3.5),
    "gal_eye_hot": ("#fff6e8", 0.25, 0.0, "#ffe8c8", 4.0),
    "gal_iris": ("#ff3fa6", 0.3, 0.0, "#ff2090", 4.0),
    "gal_pupil": ("#0b0812", 0.4, 0.0, None, 0),
    "gal_glint": ("#ffffff", 0.2, 0.0, "#ffffff", 6.0),
    # jets, pulsar beams, synchrotron glow
    "gal_jet_core": ("#f2fbff", 0.2, 0.0, "#e4f6ff", 7.0),
    "gal_jet_cyan": ("#7fe6ff", 0.3, 0.0, "#4ad8ff", 4.5),
    "gal_jet_blue": ("#4a8cff", 0.35, 0.0, "#2a6cff", 3.5),
    "gal_jet_violet": ("#7a6aff", 0.4, 0.0, "#5a48ff", 2.5),
    "gal_neutron": ("#e6f4ff", 0.2, 0.0, "#d0ecff", 6.0),
    "gal_beam": ("#bff0ff", 0.3, 0.0, "#9ae8ff", 4.0),
    "gal_beam_dim": ("#6ab4ff", 0.4, 0.0, "#4a90ff", 2.2),
    "gal_wind": ("#5a5ad8", 0.45, 0.0, "#4040c0", 1.6),
    "gal_wind_dim": ("#3a3488", 0.5, 0.0, "#28207a", 1.0),
    # stars
    "gal_star_white": ("#fffbe8", 0.3, 0.0, "#fff6d8", 5.0),
    "gal_star_yellow": ("#ffe066", 0.35, 0.0, "#ffd23a", 4.0),
    "gal_star_gold": ("#ffb83a", 0.35, 0.0, "#ff9e1a", 3.5),
    "gal_star_orange": ("#ff8a3a", 0.4, 0.0, "#ff6a1a", 3.2),
    "gal_star_red": ("#ff5a3e", 0.4, 0.0, "#f0402a", 3.0),
    "gal_star_crimson": ("#d8322e", 0.45, 0.0, "#b81e1e", 2.4),
    "gal_star_blue": ("#9fd0ff", 0.3, 0.0, "#80c0ff", 4.5),
    "gal_star_blue_deep": ("#5e9cff", 0.35, 0.0, "#3a80ff", 3.5),
    "gal_star_ice": ("#eef8ff", 0.25, 0.0, "#e0f2ff", 6.0),
    "gal_halo_yellow": ("#ffe9a6", 0.4, 0.0, "#ffdf88", 1.8),
    "gal_halo_red": ("#ff9a7a", 0.45, 0.0, "#ff7050", 1.4),
    "gal_halo_blue": ("#bfe0ff", 0.4, 0.0, "#a0d0ff", 1.8),
    "gal_halo_orange": ("#ffb07a", 0.45, 0.0, "#ff9050", 1.4),
    # brown dwarf
    "gal_bd_dark": ("#4a2a2a", 0.7, 0.0, None, 0),
    "gal_bd_mid": ("#7a4232", 0.7, 0.0, None, 0),
    "gal_bd_light": ("#a8604a", 0.7, 0.0, "#5a1a10", 0.6),
    "gal_bd_magenta": ("#8a3a5a", 0.7, 0.0, "#4a1030", 0.6),
    # nebulae
    "gal_neb_deep": ("#a02a78", 0.6, 0.0, "#801060", 1.4),
    "gal_neb_magenta": ("#e0479c", 0.55, 0.0, "#d02a88", 2.0),
    "gal_neb_pink": ("#ff86c0", 0.5, 0.0, "#ff60a8", 2.4),
    "gal_neb_core": ("#ffd6ec", 0.4, 0.0, "#ffc0e0", 3.2),
    "gal_neb_teal": ("#4fd8d0", 0.5, 0.0, "#2ac8c0", 2.2),
    "gal_neb_blue": ("#6aa8ff", 0.5, 0.0, "#4a88ff", 1.8),
    "gal_neb_haze": ("#8ab8ff", 0.55, 0.0, "#6a98f0", 1.2),
    "gal_dust": ("#2c2030", 0.85, 0.0, None, 0),
    "gal_dust_mid": ("#45303e", 0.85, 0.0, None, 0),
    "gal_rim": ("#ff9a6a", 0.5, 0.0, "#ff7a48", 2.6),
    "gal_rim_pink": ("#ff6aa0", 0.5, 0.0, "#ff4a88", 2.4),
    "gal_ring_teal": ("#5ef0dc", 0.4, 0.0, "#30e0c8", 3.0),
    "gal_ring_orange": ("#ff7a4a", 0.45, 0.0, "#ff5a2a", 2.6),
    "gal_ring_red": ("#c8304a", 0.5, 0.0, "#a81838", 1.6),
    # supernovae
    "gal_sn_white": ("#fffdf0", 0.2, 0.0, "#fff8e0", 8.0),
    "gal_sn_yellow": ("#fff0a0", 0.3, 0.0, "#ffe070", 6.0),
    "gal_shock_cyan": ("#a8f4ff", 0.3, 0.0, "#80eaff", 5.0),
    "gal_shock_blue": ("#5aa0ff", 0.35, 0.0, "#3a80ff", 3.5),
    "gal_shock_violet": ("#9a6aff", 0.4, 0.0, "#7a48ff", 2.6),
    "gal_fil_orange": ("#ff8a4a", 0.45, 0.0, "#ff6a2a", 3.0),
    "gal_fil_red": ("#f04a5a", 0.45, 0.0, "#e0303a", 2.6),
    "gal_fil_pink": ("#ff7ab8", 0.45, 0.0, "#ff5aa0", 2.6),
    "gal_fil_yellow": ("#ffd27a", 0.4, 0.0, "#ffc050", 3.0),
    "gal_synch": ("#8ac8ff", 0.35, 0.0, "#6ab0ff", 2.8),
    "gal_synch_core": ("#d8f0ff", 0.3, 0.0, "#c0e8ff", 4.0),
    # planets, ice, lint
    "gal_rogue": ("#2e3a5a", 0.75, 0.0, None, 0),
    "gal_rogue_dark": ("#1e2640", 0.75, 0.0, None, 0),
    "gal_rogue_frost": ("#a8c8f0", 0.5, 0.0, "#5a80c0", 0.5),
    "gal_lid": ("#d8ecff", 0.4, 0.0, "#a8d0ff", 1.5),
    "gal_ice": ("#d8f2ff", 0.4, 0.0, "#a0dcff", 1.6),
    "gal_ice_dark": ("#6a8ab0", 0.6, 0.0, None, 0),
    "gal_ice_trail": ("#8ad4ff", 0.4, 0.0, "#5ac0ff", 1.8),
    "gal_lint": ("#b8b0c8", 0.95, 0.0, None, 0),
    "gal_lint_light": ("#d8d2e4", 0.95, 0.0, None, 0),
    "gal_lint_dark": ("#857c98", 0.95, 0.0, None, 0),
    "gal_sock_white": ("#f4f2fa", 0.9, 0.0, None, 0),
    "gal_sock_magenta": ("#e84a9a", 0.85, 0.0, None, 0),
    "gal_sock_cyan": ("#3ac8e8", 0.85, 0.0, None, 0),
    "gal_sparkle": ("#fff8d8", 0.3, 0.0, "#fff0b0", 4.0),
}


def G(key):
    """Material from the Galaxy palette."""
    color, rough, metal, emit, strength = PAL[key]
    return mat(key, color, rough, metal, emit, strength)


# --------------------------------------------------------------------------
# Shared helpers
# --------------------------------------------------------------------------

def _rot_to(d):
    """Euler (degrees) that turns local +Z onto direction d."""
    q = Vector((0, 0, 1)).rotation_difference(Vector(d).normalized())
    return tuple(math.degrees(r) for r in q.to_euler())


def _disc(p, radii, segs, mat_fn, z=0.0, zfn=None, wobble=None):
    """Flat, upward-facing annulus sheet: rows at `radii` (a first radius of
    0 makes a fan), heights z + zfn(r); mat_fn(r, angle_deg) picks each
    face's material from its centre. wobble(r, a) scales a row radius."""
    rows = []
    for r in radii:
        if r <= 1e-6:
            rows.append([(0.0, 0.0, z + (zfn(0.0) if zfn else 0.0))])
            continue
        row = []
        for k in range(segs):
            a = 360 * k / segs
            rr = r * (wobble(r, a) if wobble else 1.0)
            row.append(polar(a, rr)[:2] + (z + (zfn(r) if zfn else 0.0),))
        rows.append(row)

    def mfn(i, j, c):
        a = math.degrees(math.atan2(c[0], -c[1])) % 360
        return mat_fn(math.hypot(c[0], c[1]), a)

    return _surface(p, rows, mfn, wrap=True, orient="up")


def _spiral_disc(p, z, radii, segs, bands, arms=3, twist=0.022, flare=0.0,
                 seed=0):
    """Accretion disc: an upward sheet whose faces alternate bright / dim in
    trailing spiral streaks (so its spin reads). bands: [(r_max, bright,
    dim)] from the inside out. The sheet rises by `flare` per unit radius
    (a shallow bowl)."""
    r0 = radii[0]
    rnd = random.Random(seed)
    ph = rnd.uniform(0, TAU)

    def mfn(r, a):
        band = next((b for b in bands if r <= b[0]), bands[-1])
        s = math.sin(arms * math.radians(a) + r * twist * TAU + ph)
        return G(band[1] if s > 0.15 else band[2])

    return _disc(p, radii, segs, mfn, z=z,
                 zfn=lambda r: flare * max(0.0, r - r0))


def _eye(p, centre, R, lon, lat, s, sclera, iris=None, look=(0.0, 0.22),
         brow=None, brow_slant=0.0, side=1, segs=14):
    """A cartoon eye on a sphere (centre, radius R) at (lon, lat): a domed
    disc of radius s with an optional iris ring, a dark pupil looking
    `look` (fractions of s, x right / y up), a glint, and an optional slanted
    brow (a box of material `brow` over the top, tilted inwards)."""
    d = _dir(lon, lat)
    pt = Vector(centre) + d * R
    e1 = Vector((0, 0, 1)).cross(d).normalized()
    e2 = d.cross(e1).normalized()
    lx, ly = look[0] * s, look[1] * s
    with _frame(p, pt, e1, e2, d):
        p.lathe([(0, 0.24 * s), (0.75 * s, 0.18 * s), (s, 0.02 * s),
                 (s, -0.4 * s), (0, -0.4 * s)], G(sclera), segs=segs)
        if iris:
            p.lathe([(0, 0.3 * s), (0.5 * s, 0.27 * s), (0.56 * s, 0.1 * s),
                     (0, 0.1 * s)], G(iris), segs=segs - 2,
                    center=(lx, ly, 0))
        p.lathe([(0, 0.36 * s), (0.3 * s, 0.33 * s), (0.34 * s, 0.14 * s),
                 (0, 0.14 * s)], G("gal_pupil"), segs=10,
                center=(lx, ly, 0))
        p.sphere(0.12 * s, (lx + 0.16 * s, ly + 0.16 * s, 0.38 * s),
                 G("gal_glint"), u=6, v=4, scale=(1, 1, 0.5))
        if brow:
            p.box((2.3 * s, 0.6 * s, 0.7 * s),
                  (side * -0.15 * s, 0.98 * s, 0.1 * s), G(brow),
                  rot=(0, 0, side * brow_slant))
    return pt


def _spike(p, centre, angle, r0, r1, width, material, z=0.0, segs=4):
    """A tapering corona ray in the horizontal plane at height z."""
    a = Vector(polar(angle, r0, z))
    b = Vector(polar(angle, r1, z))
    return p.rod(tuple(Vector(centre) + a), tuple(Vector(centre) + b), width,
                 material, segs=segs, r2=width * 0.12)


def _star(p, R, z, shades, rays=(), halo=None, halo_r=1.3, u=10, v=6,
          seed=0, disp=0.0, centre=(0.0, 0.0)):
    """A glowing star: a low-res ball of radius R centred at height z,
    mottled with `shades` (bright, mid, dark), a flat halo ring round its
    equator and horizontal corona rays [(angle, length / R, width / R,
    material)]."""
    s = random.Random(seed).uniform(0, 10)

    def classify(n):
        # bright cap towards the camera, darker limb underneath, a little
        # granulation
        val = 0.85 * n.z - 0.25 * n.y + 0.3 * _noise(n, 4.0, s)
        if val > 0.38:
            return G(shades[0])
        if val > -0.3:
            return G(shades[1])
        return G(shades[2])

    c = (centre[0], centre[1], z)
    dfn = (lambda n: disp * _noise(n, 3.0, s + 2)) if disp else None
    verts = _uvs(p, u, v, classify, c, (R, R, R), dfn)
    if halo:
        with p.xform((centre[0], centre[1], 0)):
            _disc(p, (R * 0.85, R * halo_r), 16, lambda r, a: G(halo),
                  z=z - 0.12 * R,
                  wobble=lambda r, a: 1 + (0.06 * math.sin(math.radians(
                      a) * 8 + s) if r > R else 0))
    for (a, L, w, m) in rays:
        _spike(p, c, a, R * 0.75, R * L, R * w, G(m), z=z)
    return verts


def _mini(p, centre, r, material, u=4, v=2):
    """A tiny star point: an octahedron by default (2 * u * (v - 1) tris)."""
    _uvs(p, u, v, lambda n: material, centre, (r, r, r))


def _dome(p, centre, rx, ry, h, mat_fn, seed=0, segs=12, lump=0.14,
          rows=((1.0, 0.0), (0.82, 0.55), (0.45, 0.9))):
    """A lumpy, flattened half-blob (a nebula layer) on z = centre.z:
    rows of (radius fraction, height fraction) up to a pole. mat_fn(level)
    picks the material per row band (0 = the rim)."""
    rnd = random.Random(seed)
    ph = [rnd.uniform(0, TAU) for _ in range(3)]
    cx, cy, cz = centre

    def outline(a):
        return 1 + lump * (math.sin(2 * a + ph[0]) * 0.6
                           + math.sin(3 * a + ph[1]) * 0.5
                           + math.sin(5 * a + ph[2]) * 0.35)

    pts = []
    for f, hz in rows:
        row = []
        for k in range(segs):
            a = TAU * k / segs
            o = outline(a + hz)
            row.append((cx + rx * f * o * math.sin(a),
                        cy - ry * f * o * math.cos(a), cz + h * hz))
        pts.append(row)
    pts.append([(cx, cy, cz + h)])
    return _surface(p, pts, lambda i, j, c: mat_fn(i), wrap=True,
                    orient="up")


def _sparkle(p, centre, r, material, z=0.0):
    """A flat four-point sparkle (8 upward triangles) at height z."""
    cx, cy = centre
    pts = []
    for k in range(8):
        rr = r if k % 2 == 0 else r * 0.28
        x, y, _ = polar(45 * k, rr)
        pts.append((cx + x, cy + y, z))
    rows = [[(cx, cy, z + r * 0.12)], pts]
    _surface(p, rows, lambda i, j, c: material, wrap=True, orient="up")


# --------------------------------------------------------------------------
# Hazards
# --------------------------------------------------------------------------

def black_hole():
    R, C = 36.0, 48.0
    m = Model("black_hole", "")
    b = m.part("body")
    b.smooth_angle = math.radians(60)

    def core(n):
        return G("gal_void_rim" if n.z < -0.55 else "gal_void")

    _uvs(b, 16, 10, core, (0, 0, C), (R, R, R))
    # photon ring hugging the hole at the disc's inner edge
    b.torus(R + 4.5, 3.0, (0, 0, C), G("gal_photon"), segs=24, rsegs=4,
            scale=(1, 1, 0.8))
    eyes = []
    for side in (-1, 1):
        pt = _eye(b, (0, 0, C), R, side * 26, 30, 9.5, "gal_eye",
                  iris="gal_iris", look=(0.0, 0.25), side=side)
        eyes.append(pt)
    d = m.part("disk", pivot=(0, 0, C))
    radii = (R + 7, R + 15, R + 27, R + 42, R + 60, R + 82)
    _spiral_disc(d, C, radii, 32,
                 [(R + 16, "gal_disc_white", "gal_disc_gold"),
                  (R + 30, "gal_disc_gold", "gal_disc_orange"),
                  (R + 46, "gal_disc_orange", "gal_disc_red"),
                  (R + 64, "gal_disc_red", "gal_disc_magenta"),
                  (R + 90, "gal_disc_magenta", "gal_disc_violet")],
                 arms=3, twist=0.012, flare=0.09, seed=1)
    ex = [(round(q.x, 1) + 0.0, round(q.z, 1), round(-q.y, 1) + 0.0)
          for q in eyes]
    m.notes = (f"{SCALE_NOTE} Wanderer with strong suction. A dark hole "
               f"(radius {R:g}, centre (0, {C:g}, 0)) ringed by a white-hot "
               f"photon ring (r {R + 4.5:g}), with two glowing hungry eyes "
               f"on the +Z side (centres ({ex[0][0]:g}, {ex[0][1]:g}, "
               f"{ex[0][2]:g}) and ({ex[1][0]:g}, {ex[1][1]:g}, "
               f"{ex[1][2]:g})), looking up. disk node: the accretion disc, "
               f"a flat, slightly bowled sheet from r {R + 7:g} to "
               f"{R + 82:g} streaked white, gold, orange, red, magenta in "
               "three trailing spiral arms; spins about Y; pivot at the hole "
               f"centre (0, {C:g}, 0).")
    return m


def globular_cluster():
    C = 58.0
    m = Model("globular_cluster",
              f"{SCALE_NOTE} Lane patrol on an orbit. A glowing gold-white "
              f"core (r 34, centre (0, {C:g}, 0)) in a golden halo ring "
              "(r 52). swarm node: 64 star points "
              "(white, gold, orange, pale blue) packed densely round the core "
              "out to r 95, thinning outwards; spins about Y; pivot at the "
              f"core centre (0, {C:g}, 0).")
    b = m.part("body")
    _star(b, 34, C, ("gal_star_white", "gal_star_yellow", "gal_star_gold"),
          u=12, v=7, seed=3)
    _disc(b, (30, 52), 20, lambda r, a: G("gal_halo_yellow"), z=C - 6,
          wobble=lambda r, a: 1 + (0.08 * math.sin(math.radians(a) * 6)
                                   if r > 40 else 0))
    s = m.part("swarm", pivot=(0, 0, C))
    rnd = random.Random(17)
    mats = ["gal_star_white", "gal_star_white", "gal_star_yellow",
            "gal_star_gold", "gal_star_orange", "gal_star_blue"]
    n = 64
    for k in range(n):
        # golden-angle spiral directions, radius thinning outwards
        zc = 1 - 1.85 * (k + 0.5) / n
        th = k * 2.399963
        rr = math.sqrt(1 - zc * zc)
        dirn = Vector((rr * math.cos(th), rr * math.sin(th), zc * 0.8))
        dist = 38 + 56 * rnd.random() ** 1.8
        pos = Vector((0, 0, C)) + dirn * dist
        if pos.z < 6:
            pos.z = 6 + rnd.uniform(0, 6)
        size = rnd.uniform(5.5, 9.5) * (1.2 - 0.4 * (dist - 38) / 56)
        _mini(s, tuple(pos), size, G(mats[k % len(mats)]))
    return m


def pulsar():
    H, RS, L = 60.0, 20.0, 150.0
    m = Model("pulsar", "")
    b = m.part("body")
    # pulsar wind nebula on the floor: a soft violet disc with a bright ring
    _disc(b, (0, 30, 62, 84), 20, lambda r, a: G(
        "gal_wind" if r < 32 else "gal_wind_dim" if r > 64 else "gal_synch"),
        z=1.0, wobble=lambda r, a: 1 + 0.07 * math.sin(math.radians(a) * 4))
    h = m.part("head")
    h.smooth_angle = math.radians(60)
    _uvs(h, 14, 8, lambda n: G("gal_neutron"), (0, 0, H), (RS, RS, RS))
    # magnetosphere: a ring round the star, square to the beams
    h.torus(RS + 13, 2.6, (0, 0, H), G("gal_jet_violet"), segs=20, rsegs=4,
            rot=(90, 0, 0))
    h.torus(RS + 6, 1.8, (0, 0, H), G("gal_jet_cyan"), segs=16, rsegs=4,
            rot=(90, 0, 0))
    # two beams along -Y / +Y (glTF +Z / -Z): a hot core inside a wide cone
    for sgn in (-1, 1):
        rot = (90, 0, 0) if sgn < 0 else (-90, 0, 0)
        with h.xform((0, 0, H), rot):
            h.lathe([(3.5, RS * 0.6), (9, L * 0.55), (12, L), (0, L)],
                    G("gal_beam"), segs=8)
            h.lathe([(6, RS * 0.9), (16, L * 0.45), (28, L * 0.9),
                     (22, L * 0.97), (0, L * 0.93)], G("gal_beam_dim"),
                    segs=10)
            h.torus(9, 2.2, (0, 0, RS + 12), G("gal_jet_cyan"), segs=10,
                    rsegs=4)
    m.notes = (f"{SCALE_NOTE} Turret with a rotating beam. head node: a "
               f"white-hot neutron star (radius {RS:g}, centre (0, {H:g}, 0)) "
               "in two magnetosphere rings, with two lighthouse beams "
               f"(cones widening to r 28) along +Z and -Z out to {L:g}; it "
               "turns about Y through its pivot at the origin (0, 0, 0). "
               f"Beams emit from the star surface at (0, {H:g}, +-{RS:g}); "
               f"the +Z beam tip (the muzzle) is at (0, {H:g}, {L:g}). body: "
               "a violet pulsar-wind glow disc (r 84) on the floor.")
    return m


def supernova_remnant():
    RX, RY, RZ = 86.0, 104.0, 56.0
    C = RZ + 2
    m = Model("supernova_remnant",
              f"{SCALE_NOTE} Slow trail-layer. A Crab-like remnant: an "
              f"oval shell of glowing filaments (radii {RX:g} x {RZ:g} x "
              f"{RY:g} along X, Y, Z; centre (0, {C:g}, 0)) round a blue "
              "synchrotron glow with a white pulsar at its heart, on a dim "
              "violet glow that trails off behind it (-Z). shell node: the "
              "filament web; pulses (scale); pivot at the shell centre "
              f"(0, {C:g}, 0).")
    b = m.part("body")
    # synchrotron nebula inside, with the pulsar
    _uvs(b, 12, 7, lambda n: G("gal_synch_core" if n.z > 0.55 else
                               "gal_synch"),
         (0, 0, C - 6), (RX * 0.72, RY * 0.72, RZ * 0.78),
         lambda n: 0.1 * _noise(n, 3.0, 2.0))
    b.sphere(8, (0, 0, C - 6 + RZ * 0.8), G("gal_neutron"), u=8, v=5)
    # glow on the floor, trailing back to -Z (Blender +Y)
    _disc(b, (0, RX * 0.5, RX * 0.72), 20,
          lambda r, a: G("gal_wind_dim" if r > RX * 0.55 else
                         "gal_neb_deep"), z=1.0,
          wobble=lambda r, a: (1 + 0.7 * max(0.0, math.cos(math.radians(
              a - 180))) ** 2 + 0.06 * math.sin(math.radians(a) * 6)))
    sh = m.part("shell", pivot=(0, 0, C))
    # filaments: wiggly ribbons draped over the oval shell, facing outwards
    rnd = random.Random(41)
    fmats = ["gal_fil_orange", "gal_fil_red", "gal_fil_pink",
             "gal_fil_yellow", "gal_fil_orange", "gal_fil_pink"]
    nf, steps = 26, 9
    for k in range(nf):
        # a random great-circle arc, kept to the upper part of the shell
        zc = rnd.uniform(-0.1, 0.95)
        th = rnd.uniform(0, TAU)
        rr = math.sqrt(1 - zc * zc)
        start = Vector((rr * math.cos(th), rr * math.sin(th), zc))
        axis = start.cross(Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1),
                                   rnd.uniform(-1, 1)))).normalized()
        span = rnd.uniform(1.0, 1.9)
        w = rnd.uniform(4.0, 7.0)
        wig = rnd.uniform(0, 10)
        left, right = [], []
        for i in range(steps + 1):
            t = i / steps
            q = Matrix.Rotation(span * (t - 0.5), 3, axis)
            n = (q @ start)
            n = (n + axis * 0.18 * math.sin(t * 7 + wig)).normalized()
            if n.z < -0.25:
                n.z = -0.25
                n.normalize()
            rad = 1 + 0.07 * _noise(n, 3.2, 5.0)
            c = Vector((n.x * RX, n.y * RY, C + n.z * RZ)) * 1.0
            c = Vector((c.x * rad, c.y * rad, C + (c.z - C) * rad))
            side = axis * (w * math.sin(math.pi * (0.1 + 0.8 * t)) + 1.0)
            left.append(tuple(c - side))
            right.append(tuple(c + side))
        _surface(sh, [left, right], lambda i, j, c, mm=fmats[k % 6]: G(mm),
                 orient="up")
    return m


def supernova():
    R, C = 54.0, 58.0
    L = 240.0
    m = Model("supernova", "")
    b = m.part("body")
    # shock ring on the floor
    _disc(b, (R * 0.9, R * 1.25, R * 1.45), 24,
          lambda r, a: G("gal_shock_cyan" if r < R * 1.3 else
                         "gal_shock_blue"), z=1.5,
          wobble=lambda r, a: 1 + 0.05 * math.sin(math.radians(a) * 7))
    # blast: shock tongues fanning out forward (-Y = glTF +Z)
    for k, a in enumerate((-30, -15, 0, 15, 30)):
        Lk = L if k == 2 else L * 0.86 if k in (1, 3) else L * 0.72
        n = 8
        rows = [[polar(a, R * 0.8, 3.0)]]
        for i in range(1, n + 1):
            s = i / n
            aa = a + 6 * math.sin(s * 3 + k) * s
            cx, cy, _ = polar(aa, R * 0.8 + (Lk - R * 0.8) * s)
            w = 18 * (1 - s) ** 0.6 + 14 * math.sin(math.pi * s) + 3
            hgt = 22 * (1 - s) ** 0.8 + 3
            tx, ty = -math.cos(math.radians(aa)), -math.sin(math.radians(aa))
            row = []
            for j in range(7):
                u = -1 + 2 * j / 6
                z = 2 + hgt * math.sqrt(max(0.0, 1 - u * u))
                row.append((cx + tx * u * w, cy + ty * u * w, z))
            rows.append(row)

        def tongue(i, j, c):
            s = i / n
            if s < 0.35:
                return G("gal_sn_white" if j in (2, 3) else "gal_sn_yellow")
            if s < 0.7:
                return G("gal_shock_cyan" if j in (2, 3) else
                         "gal_shock_blue")
            return G("gal_shock_violet")

        _surface(b, rows, tongue, orient="up")
    co = m.part("core", pivot=(0, 0, C))
    co.smooth_angle = math.radians(60)
    _star(co, R, C, ("gal_sn_white", "gal_sn_yellow", "gal_star_gold"),
          u=18, v=11, seed=5, disp=0.05)
    # bulging hot spots straining at the seams
    rnd = random.Random(8)
    for k in range(4):
        lon = 110 + 140 * k / 3 + rnd.uniform(-15, 15)  # the back half
        lat = rnd.uniform(5, 55)
        d = _dir(lon, lat)
        co.sphere(R * 0.28, tuple(Vector((0, 0, C)) + d * R * 0.86),
                  G("gal_sn_white"), u=8, v=5)
    for side in (-1, 1):
        _eye(co, (0, 0, C), R, side * 24, 26, 12, "gal_eye_hot",
             iris="gal_star_orange", look=(0.0, -0.05), brow="gal_star_red",
             brow_slant=20, side=side)
    m.notes = (f"{SCALE_NOTE} Cone blaster. A swelling, overheated star "
               f"(radius {R:g}, centre (0, {C:g}, 0)) with strained, "
               "angry eyes on the +Z side, on a cyan shock ring (r "
               f"{R * 1.45:g}), and five shock tongues fanning out to +Z "
               f"(to r {L:g}, +-30 degrees): the blast faces +Z. core node: "
               "the star; pulses / swells (scale); pivot at its centre "
               f"(0, {C:g}, 0). Nozzle (emit point) on its front surface at "
               f"(0, {C:g}, {R:g}).")
    return m


def sagittarius_a():
    R, C = 100.0, 150.0
    LJ = 260.0
    m = Model("sagittarius_a", "")
    b = m.part("body")
    b.smooth_angle = math.radians(60)

    def core(n):
        return G("gal_void_rim" if n.z < -0.6 else "gal_void")

    _uvs(b, 24, 14, core, (0, 0, C), (R, R, R))
    b.torus(R + 9, 6.5, (0, 0, C), G("gal_photon"), segs=40, rsegs=5,
            scale=(1, 1, 0.75))
    eyes = []
    for side in (-1, 1):
        pt = _eye(b, (0, 0, C), R, side * 27, 30, 23, "gal_eye",
                  iris="gal_iris", look=(-side * 0.08, 0.18),
                  brow="gal_void", brow_slant=24, side=side, segs=16)
        eyes.append(pt)
    # a grim mouth: a thin glowing crescent just above the disc
    with b.xform((0, 0, C)):
        for k in range(9):
            a = -28 + 7 * k
            d = _dir(a, 7 + 6 * (a / 28) ** 2)
            b.sphere(6.0, tuple(d * (R + 0.5)), G("gal_disc_magenta"),
                     u=6, v=4, scale=(1.3, 1.3, 0.8))
    d = m.part("disk", pivot=(0, 0, C))
    radii = (R + 16, R + 28, R + 46, R + 70, R + 100, R + 136, R + 176,
             R + 220)
    _spiral_disc(d, C, radii, 56,
                 [(R + 30, "gal_disc_white", "gal_disc_gold"),
                  (R + 48, "gal_disc_gold", "gal_disc_orange"),
                  (R + 72, "gal_disc_orange", "gal_disc_red"),
                  (R + 102, "gal_disc_red", "gal_disc_magenta"),
                  (R + 140, "gal_disc_magenta", "gal_disc_violet"),
                  (R + 230, "gal_disc_violet", "gal_disc_indigo")],
                 arms=4, twist=0.006, flare=0.07, seed=4)
    # hot clumps riding the inner disc, so the spin reads up close
    rnd = random.Random(31)
    for k in range(7):
        a = k * 360 / 7 + rnd.uniform(-12, 12)
        rr = rnd.uniform(R + 36, R + 90)
        x, y, _ = polar(a, rr)
        d.sphere(rnd.uniform(6, 10), (x, y, C + 0.07 * (rr - R - 16) + 2),
                 G("gal_disc_white"), u=8, v=4, scale=(1.6, 1.6, 0.6))
    # relativistic jets along the spin axis
    top, bot = C + R, C - R
    jn = m.part("jet_n", pivot=(0, 0, top))
    with jn.xform((0, 0, top - 6)):
        jn.lathe([(10, 0), (13, LJ * 0.5), (14, LJ * 0.94), (0, LJ * 1.14)],
                 G("gal_jet_core"), segs=10)
        jn.lathe([(20, 4), (24, LJ * 0.3), (30, LJ * 0.7), (38, LJ * 0.9),
                  (0, LJ * 0.93)], G("gal_jet_cyan"), segs=12)
        for k, f in enumerate((0.28, 0.55, 0.8)):
            jn.torus(30 + 9 * f, 5 - k, (0, 0, LJ * f), G("gal_jet_blue"),
                     segs=14, rsegs=4)
        jn.lathe([(39, LJ * 0.86), (44, LJ * 0.9), (24, LJ * 1.02),
                  (0, LJ * 1.1)], G("gal_jet_violet"), segs=12)
    js = m.part("jet_s", pivot=(0, 0, bot))
    # the south jet points down and splashes into a lobe on the floor
    js.lathe([(0, 2), (96, 2), (70, 10), (30, bot * 0.55), (14, bot + 4),
              (0, bot + 4)], G("gal_jet_cyan"), segs=14)
    js.lathe([(0, 3), (10, bot * 0.5), (8, bot + 6), (0, bot + 6)],
             G("gal_jet_core"), segs=8)
    _disc(js, (96, 140, 170), 24, lambda r, a: G(
        "gal_jet_blue" if r < 140 else "gal_jet_violet"), z=1.0,
        wobble=lambda r, a: 1 + 0.07 * math.sin(math.radians(a) * 5))
    ex = [(round(q.x, 1) + 0.0, round(q.z, 1), round(-q.y, 1) + 0.0)
          for q in eyes]
    m.notes = (f"{SCALE_NOTE} Boss. Sagittarius A*: a supermassive black "
               f"hole (radius {R:g}, centre (0, {C:g}, 0)) in a white-hot "
               f"photon ring (r {R + 9:g}), with two glowing, slit-pupilled "
               "eyes under heavy slanted brows and a thin magenta grin on "
               f"its +Z side (eye centres ({ex[0][0]:g}, {ex[0][1]:g}, "
               f"{ex[0][2]:g}) and ({ex[1][0]:g}, {ex[1][1]:g}, "
               f"{ex[1][2]:g})), looking up. disk node: the accretion disc "
               f"(r {R + 16:g} to {R + 220:g}; white, gold, orange, red, "
               "magenta, violet and indigo in four spiral arms, with hot "
               "clumps); spins about Y; pivot at the hole centre "
               f"(0, {C:g}, 0). jet_n: the north relativistic jet, straight "
               f"up from the pole to y {top - 6 + LJ * 1.14:.0f} (a white core in a cyan "
               "sheath with blue knots and a violet tip); pivot at the "
               f"north pole (0, {top:g}, 0); pulse it (scale Y) or hide it "
               "when chipped. jet_s: the south jet, down from the south "
               "pole into a blue lobe (r 170) on the floor under the disc; "
               f"pivot at the south pole (0, {bot:g}, 0).")
    return m


# --------------------------------------------------------------------------
# Debris props
# --------------------------------------------------------------------------

def red_dwarf():
    m = Model("red_dwarf", f"{PROP_NOTE} A small red star: a mottled red "
              "ball (r 60) with six stubby corona rays (to r 84) and a dim "
              "red halo.")
    b = m.part("body")
    R = 60.0
    rays = [(60 * k + 30, 1.4, 0.2,
             "gal_star_orange" if k % 2 else "gal_star_red")
            for k in range(6)]
    _star(b, R, R, ("gal_star_orange", "gal_star_red", "gal_star_crimson"),
          rays, halo="gal_halo_red", halo_r=1.22, seed=11)
    return m


def yellow_star():
    m = Model("yellow_star", f"{PROP_NOTE} A Sun-like star: a yellow ball "
              "(r 60) with eight corona rays, long and short in turn (to r "
              "96), on a pale yellow halo.")
    b = m.part("body")
    R = 60.0
    rays = [(45 * k, 1.6 if k % 2 == 0 else 1.32, 0.17 if k % 2 == 0
             else 0.14, "gal_star_yellow" if k % 2 == 0 else "gal_star_gold")
            for k in range(8)]
    _star(b, R, R, ("gal_star_white", "gal_star_yellow", "gal_star_gold"),
          rays, halo="gal_halo_yellow", halo_r=1.25, seed=12)
    return m


def blue_giant():
    m = Model("blue_giant", f"{PROP_NOTE} A hot blue giant: a blue-white "
              "ball (r 54) with a long four-point diffraction sparkle (to r "
              "120) and four short diagonal rays, on a pale blue halo.")
    b = m.part("body")
    R = 54.0
    rays = [(90 * k, 2.2, 0.16, "gal_star_blue") for k in range(4)]
    rays += [(90 * k + 45, 1.4, 0.12, "gal_star_blue_deep") for k in range(4)]
    _star(b, R, R * 1.05, ("gal_star_ice", "gal_star_blue",
                           "gal_star_blue_deep"),
          rays, halo="gal_halo_blue", halo_r=1.3, seed=13)
    return m


def red_giant():
    m = Model("red_giant", f"{PROP_NOTE} A bloated red giant: a big, lumpy "
              "ball (r 86) mottled orange and red with convection cells, in "
              "a wavy orange halo (to r 100); no rays.")
    b = m.part("body")
    R = 86.0
    s = 3.3

    def classify(n):
        v = _noise(n, 5.0, s) + 0.4 * _noise(n, 9.0, s + 1)
        v -= 0.5 * max(0.0, -n.z)
        if v > 0.45:
            return G("gal_star_gold")
        if v > -0.1:
            return G("gal_star_orange")
        if v > -0.5:
            return G("gal_star_red")
        return G("gal_star_crimson")

    verts = _uvs(b, 14, 8, classify, (0, 0, R), (R, R, R * 0.92),
                 lambda n: 0.07 * _noise(n, 3.0, s))
    low = min(v.co.z for v in verts)
    for v in verts:
        v.co.z -= low
    _disc(b, (R * 0.9, R * 1.16), 18, lambda r, a: G("gal_halo_orange"),
          z=R * 0.8,
          wobble=lambda r, a: 1 + (0.07 * math.sin(math.radians(a) * 5)
                                   if r > R else 0))
    return m


def white_dwarf():
    m = Model("white_dwarf", f"{PROP_NOTE} A tiny, fierce white dwarf: a "
              "white-hot ball (r 32) inside a wide, thin ring of light (r 56 "
              "to 70) and four thin spikes (to r 100).")
    b = m.part("body")
    R = 32.0
    rays = [(90 * k + 45, 3.1, 0.12, "gal_star_ice") for k in range(4)]
    _star(b, R, 40, ("gal_star_ice", "gal_star_white", "gal_star_blue"),
          rays, halo="gal_halo_blue", halo_r=1.35, seed=14, u=10, v=6)
    _disc(b, (56, 63, 70), 24, lambda r, a: G(
        "gal_star_ice" if r < 63 else "gal_halo_blue"), z=38)
    return m


def brown_dwarf():
    m = Model("brown_dwarf", f"{PROP_NOTE} A failed star: a dim, banded "
              "ball (r 100) in browns and dusky magenta, faintly warm, like "
              "a big gas giant that never lit.")
    b = m.part("body")
    R = 100.0
    lats = [-62, -38, -20, -6, 10, 26, 44, 66]
    bands = ["gal_bd_dark", "gal_bd_mid", "gal_bd_magenta", "gal_bd_light",
             "gal_bd_mid", "gal_bd_magenta", "gal_bd_light", "gal_bd_mid",
             "gal_bd_dark"]
    rows = [[(0.0, 0.0, -1.0)]]
    u = 14
    for lat in lats:
        rows.append([tuple(_dir(360 * j / u, lat + 3 * math.sin(
            math.radians(360 * j / u * 3 + lat)))) for j in range(u)])
    rows.append([(0.0, 0.0, 1.0)])

    def mfn(i, j, c):
        return G(bands[min(i, len(bands) - 1)])

    with b.xform((0, 0, R), (-12, 0, 0), (R, R, R)):
        _surface(b, rows, mfn, wrap=True, orient="recalc")
    return m


def binary_star():
    m = Model("binary_star", f"{PROP_NOTE} Two stars in a shared orbit: a "
              "yellow star (r 40) and a blue-white companion (r 28) on a "
              "pale orbit ring (r 62 to 68), with a glowing stream of gas "
              "between them; spans X.")
    b = m.part("body")
    Z = 42.0
    _star(b, 40, Z, ("gal_star_white", "gal_star_yellow", "gal_star_gold"),
          [(90, 1.45, 0.16, "gal_star_gold"), (270, 1.3, 0.14,
                                                "gal_star_gold")],
          halo="gal_halo_yellow", halo_r=1.2, seed=15, centre=(-42, 4))
    _star(b, 28, Z, ("gal_star_ice", "gal_star_blue", "gal_star_blue_deep"),
          [(0, 1.7, 0.16, "gal_star_blue"), (180, 1.7, 0.16,
                                              "gal_star_blue")],
          halo="gal_halo_blue", halo_r=1.25, seed=16, centre=(52, -4), u=8,
          v=5)
    _disc(b, (62, 68), 28, lambda r, a: G("gal_halo_yellow"), z=Z - 8)
    pts = [Vector((52 - 30, -4, Z)), Vector((20, -22, Z + 4)),
           Vector((-12, -26, Z + 2)), Vector((-30, -18, Z))]
    _tube(b, pts, [6, 5, 4, 3], G("gal_star_blue"), segs=5)
    return m


def open_star_cluster():
    m = Model("open_star_cluster", f"{PROP_NOTE} A loose, young cluster "
              "(Pleiades-like): seven blue-white stars of mixed sizes, the "
              "three brightest with four-point sparkles, over a faint blue "
              "reflection-nebula haze (r 100).")
    b = m.part("body")
    _disc(b, (0, 70, 100), 16, lambda r, a: G(
        "gal_neb_haze" if r < 72 else "gal_neb_blue"), z=1.0,
        wobble=lambda r, a: 1 + 0.12 * math.sin(math.radians(a) * 3 + 1)
        + 0.06 * math.sin(math.radians(a) * 7))
    stars = [(-30, -20, 16, 30, "gal_star_ice", True),
             (34, -6, 13, 26, "gal_star_blue", True),
             (2, 38, 14, 34, "gal_star_ice", True),
             (-58, 28, 8, 18, "gal_star_blue", False),
             (60, 46, 7, 16, "gal_star_white", False),
             (-6, -64, 8, 20, "gal_star_blue", False),
             (66, -48, 6, 14, "gal_star_ice", False)]
    for x, y, r, z, mm, sp in stars:
        _uvs(b, 6, 4, lambda n, mm=mm: G(mm), (x, y, z), (r, r, r))
        if sp:
            _sparkle(b, (x, y), r * 2.4, G("gal_star_blue"), z=z - r * 0.2)
    return m


def star_cluster():
    m = Model("star_cluster", f"{PROP_NOTE} A dense, compact ball of stars "
              "(the snack that stuns Sagittarius A*): a bright gold-white "
              "core (r 40) studded with twenty star points (white, gold, "
              "orange, blue) out to r 66, on a golden halo (r 80).")
    b = m.part("body")
    C = 48.0
    _star(b, 40, C, ("gal_star_white", "gal_star_yellow", "gal_star_gold"),
          seed=17, u=10, v=6)
    _disc(b, (0, 54, 80), 16, lambda r, a: G(
        "gal_halo_yellow" if r < 56 else "gal_star_gold"), z=1.0,
        wobble=lambda r, a: 1 + 0.07 * math.sin(math.radians(a) * 5))
    rnd = random.Random(19)
    mats = ["gal_star_white", "gal_star_yellow", "gal_star_gold",
            "gal_star_orange", "gal_star_blue"]
    n = 20
    for k in range(n):
        zc = 1 - 1.6 * (k + 0.5) / n  # skip the underside
        th = k * 2.399963
        rr = math.sqrt(max(0.0, 1 - zc * zc))
        d = Vector((rr * math.cos(th), rr * math.sin(th), zc))
        pos = Vector((0, 0, C)) + d * rnd.uniform(40, 54)
        _mini(b, tuple(pos), rnd.uniform(6, 10), G(mats[k % len(mats)]))
    return m


def emission_nebula():
    m = Model("emission_nebula", f"{PROP_NOTE} A glowing hydrogen cloud: "
              "soft, lumpy layers stacked off-centre (deep magenta outside, "
              "pink, then a pale pink core), a teal oxygen lobe, and three "
              "young stars peeking out; about 200 x 170, 60 high.")
    b = m.part("body")

    def lay(m0, m1, m2):
        return lambda i: G((m0, m1, m2)[min(i, 2)])

    _dome(b, (0, 0, 0), 100, 84, 22, lay("gal_neb_deep", "gal_neb_deep",
                                         "gal_neb_magenta"), seed=1)
    _dome(b, (-46, 30, 6), 46, 38, 26, lay("gal_neb_teal", "gal_neb_teal",
                                           "gal_neb_blue"), seed=4, segs=10)
    _dome(b, (14, -8, 10), 70, 58, 32, lay("gal_neb_magenta",
                                           "gal_neb_pink", "gal_neb_pink"),
          seed=2)
    _dome(b, (24, -16, 22), 38, 32, 34, lay("gal_neb_pink", "gal_neb_core",
                                            "gal_neb_core"), seed=3,
          segs=10)
    for x, y, z, r in ((30, -22, 58, 7), (-30, 14, 40, 5), (50, 30, 34, 5)):
        _mini(b, (x, y, z), r, G("gal_star_white"), u=6, v=4)
    return m


def dark_nebula():
    m = Model("dark_nebula", f"{PROP_NOTE} A cold cloud of dust: dark, "
              "lumpy billows (about 180 x 150, 60 high) lit from behind, so "
              "a glowing orange-pink rim shows round their edges, with a "
              "horse-head knob and two faint stars.")
    b = m.part("body")
    _dome(b, (0, 0, 0), 96, 80, 12, lambda i: G(
        "gal_rim" if i == 0 else "gal_rim_pink"), seed=6, lump=0.18)
    _dome(b, (4, 2, 8), 82, 66, 36, lambda i: G(
        "gal_dust_mid" if i == 0 else "gal_dust"), seed=7, lump=0.2)
    _dome(b, (-22, -18, 20), 44, 36, 34, lambda i: G(
        "gal_dust" if i < 2 else "gal_dust_mid"), seed=8, segs=10)
    # the horse's head: a dark knob craning up and forward
    _uvs(b, 8, 5, lambda n: G("gal_dust"), (30, -34, 62), (20, 26, 16),
         rot=(-30, 0, 20))
    _uvs(b, 6, 4, lambda n: G("gal_dust_mid"), (36, -52, 54), (11, 14, 9),
         rot=(-30, 0, 20))
    for x, y, z in ((-50, 30, 30), (54, 24, 22)):
        _mini(b, (x, y, z), 5, G("gal_star_white"))
    return m


def planetary_nebula():
    m = Model("planetary_nebula", f"{PROP_NOTE} A Ring Nebula: a flat glowing "
              "ring (r 60, teal inside, orange outside) round a pale blue "
              "disc, a faint red outer shell (r 86 to 98) and a white dwarf "
              "at the centre.")
    b = m.part("body")
    Z = 14.0
    with b.xform((0, 0, Z), scale=(1, 0.86, 0.55)):
        for f in b.torus(60, 18, (0, 0, 0), G("gal_ring_teal"), segs=18,
                         rsegs=6):
            c = f.calc_center_median()
            r = math.hypot(c.x, c.y / 0.86)
            if r > 66 or (r > 58 and c.z > Z):
                f.material_index = b._slot(G("gal_ring_orange"))
    _disc(b, (0, 46), 18, lambda r, a: G("gal_neb_haze"), z=Z - 2,
          wobble=lambda r, a: 1 - 0.14 * abs(math.cos(math.radians(a))))
    _disc(b, (86, 98), 22, lambda r, a: G("gal_ring_red"), z=Z - 6,
          wobble=lambda r, a: 1 - 0.13 * abs(math.cos(math.radians(a)))
          + 0.04 * math.sin(math.radians(a) * 6))
    _uvs(b, 8, 5, lambda n: G("gal_star_ice"), (0, 0, Z + 4), (8, 8, 8))
    return m


def rogue_planet():
    m = Model("rogue_planet", f"{PROP_NOTE} A lonely rogue planet (r 100): "
              "dark slate blue with frosty patches and a frozen cap, eyes "
              "shut, dozing; it has drifted between stars for a billion "
              "years.")
    b = m.part("body")
    R = 100.0
    s = 6.0

    def classify(n):
        if n.z > 0.82:
            return G("gal_rogue_frost")
        v = _noise(n, 4.0, s)
        if v > 0.42:
            return G("gal_rogue_frost")
        return G("gal_rogue_dark" if v < -0.3 or n.z < -0.3 else
                 "gal_rogue")

    _uvs(b, 14, 9, classify, (0, 0, R), (R, R, R))
    # closed, sleepy eyes: two drooping arcs on the camera side
    for side in (-1, 1):
        pts = []
        for k in range(6):
            t = k / 5
            lon = side * 26 + (t - 0.5) * 26
            lat = 24 - 6 * math.sin(math.pi * t)
            pts.append(_dir(lon, lat) * (R + 1.5) + Vector((0, 0, R)))
        _tube(b, pts, 3.4, G("gal_lid"), segs=4)
    return m


def comet_cloud():
    m = Model("comet_cloud", f"{PROP_NOTE} A loose shell of icy comets (an "
              "Oort cloud in miniature): ten small ice chunks with short "
              "glowing tails pointing outward, round a faint icy ring (r 60 "
              "to 96).")
    b = m.part("body")
    _disc(b, (60, 78, 96), 16, lambda r, a: G(
        "gal_ice_trail" if r < 78 else "gal_neb_haze"), z=1.0,
        wobble=lambda r, a: 1 + 0.05 * math.sin(math.radians(a) * 4))
    rnd = random.Random(23)
    for k in range(10):
        a = 36 * k + rnd.uniform(-10, 10)
        dist = rnd.uniform(48, 86)
        z = rnd.uniform(10, 46)
        x, y, _ = polar(a, dist, z)
        r = rnd.uniform(6, 9)
        sv = rnd.uniform(0, 9)
        _uvs(b, 5, 3, lambda n: G("gal_ice" if n.z > -0.1 else
                                  "gal_ice_dark"), (x, y, z), (r, r, r * 0.8),
             lambda n, sv=sv: 0.18 * _noise(n, 3.0, sv))
        tx, ty, _ = polar(a, dist + r * 3.2, z + 3)
        b.rod((x, y, z), (tx, ty, z + 3), r * 0.75, G("gal_ice_trail"),
              segs=3, r2=0.6)
    return m


def relativistic_jet():
    m = Model("relativistic_jet", f"{PROP_NOTE} Sagittarius A*'s chip: a "
              "bolt of jet plasma flying +Z, a white-hot spindle in a cyan "
              "sheath with two blue knots and a bright head; about 160 long, "
              "radius 26.")
    b = m.part("body")
    Z = 27.0
    with b.xform((0, 78, Z), (90, 0, 0)):  # local +Z = Blender -Y
        b.lathe([(0, 0), (5, 14), (10, 80), (12, 128), (0, 152)],
                G("gal_jet_core"), segs=8)
        b.lathe([(0, -6), (9, 10), (17, 70), (24, 118), (26, 134),
                 (0, 150)], G("gal_jet_cyan"), segs=10)
        for zz, rr in ((48, 15), (92, 21)):
            b.torus(rr, 4, (0, 0, zz), G("gal_jet_blue"), segs=10, rsegs=4)
        b.sphere(21, (0, 0, 136), G("gal_jet_core"), u=10, v=6,
                 scale=(1, 1, 1.25))
    return m


def space_sock():
    m = Model("space_sock", f"{PROP_NOTE} Mostly hydrogen, lint and a sock: "
              "a stripy magenta, white and cyan sock lying flat, adrift, with "
              "three little sparkles round it; about 180 long.")
    b = m.part("body")
    T = 16.0
    leg = [Vector((-30, 80, T)), Vector((-30, 50, T)), Vector((-30, 20, T)),
           Vector((-28, -8, T)), Vector((-18, -30, T)), Vector((2, -40, T)),
           Vector((30, -42, T)), Vector((56, -40, T)), Vector((72, -34, T))]
    radii = [21, 20, 19, 19, 20, 19, 18, 17, 12]

    def stripes(i, j, c):
        if i <= 1:
            return G("gal_sock_cyan")  # cuff
        if i >= 7:
            return G("gal_sock_magenta")  # toe
        if i == 5:
            return G("gal_sock_magenta")  # heel
        return G(("gal_sock_white", "gal_sock_magenta", "gal_sock_white",
                  "gal_sock_cyan")[i % 4])

    with b.xform((-12, -16, 0)):  # centred on the origin
        with b.xform(scale=(1, 1, 0.62)):
            _tube(b, leg, radii, stripes, segs=8)
        for x, y, r in ((40, 40, 18), (-66, -20, 14), (80, -72, 11)):
            _sparkle(b, (x, y), r, G("gal_sparkle"), z=10)
    return m


def cosmic_lint():
    m = Model("cosmic_lint", f"{PROP_NOTE} A clump of cosmic lint (the "
              "Bunny's own kind, gone interstellar): a fuzzy lavender-grey "
              "ball (r 56) with stray fibres, in a faint pink hydrogen haze "
              "(r 90).")
    b = m.part("body")
    R, C = 56.0, 52.0
    s = 2.2

    def classify(n):
        v = _noise(n, 6.0, s)
        return G("gal_lint_light" if v > 0.3 else
                 "gal_lint_dark" if v < -0.35 else "gal_lint")

    _uvs(b, 12, 7, classify, (0, 0, C), (R, R, R * 0.85),
         lambda n: 0.1 * _noise(n, 7.0, s) + 0.05 * _noise(n, 13.0, s + 1))
    rnd = random.Random(29)
    for k in range(8):
        lon = 45 * k + rnd.uniform(-15, 15)
        lat = rnd.uniform(-5, 50)
        d = _dir(lon, lat)
        a = Vector((0, 0, C)) + Vector((d.x * R, d.y * R, d.z * R * 0.85)) * 0.9
        tip = a + (d + Vector((rnd.uniform(-.4, .4), rnd.uniform(-.4, .4),
                               0.2))).normalized() * rnd.uniform(22, 34)
        b.rod(tuple(a), tuple(tip), 2.4, G("gal_lint_light"), segs=3,
              r2=1.4)
    _disc(b, (R * 0.8, 90), 16, lambda r, a: G("gal_neb_pink"), z=6,
          wobble=lambda r, a: 1 + (0.1 * math.sin(math.radians(a) * 3)
                                   if r > R else 0))
    return m


HAZARDS = [black_hole, globular_cluster, pulsar, supernova_remnant,
           supernova, sagittarius_a]
PROPS = [red_dwarf, yellow_star, blue_giant, red_giant, white_dwarf,
         brown_dwarf, binary_star, open_star_cluster, star_cluster,
         emission_nebula, dark_nebula, planetary_nebula, rogue_planet,
         comet_cloud, relativistic_jet, space_sock, cosmic_lint]
