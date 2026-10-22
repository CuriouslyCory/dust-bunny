"""Solar System models (Act 7): the Sun's Hazards (a rogue asteroid, comets,
a sunspot turret, a solar flare), the Sun itself (the boss, with a face) and
Solar System Debris (asteroids, comet nuclei, Voyager 1, moons, the planets,
a dwarf planet, prominence chips).

Scale: 1 Blender unit = 0.0001 AU (about 15,000 km). One Solar System world
unit is 0.01 AU = 100 BU, so the game loads these files at scale 0.01
(manifest.json "scale": 0.01), like the Continent and Globe models. Debris
props are normalised to their Debris size by the game, so they are drawn at a
convenient size (planets: radius 100) and only their proportions matter.
Everything else follows the shared conventions: X right, -Y forward
(exported as glTF +Z), Z up, origin at the bottom centre where the model
touches the floor.

The game camera looks down at about 54 degrees from the +Z side, so the
upper, front-facing (-Y) half of every model carries the read: the Sun's
eyes, Jupiter's Great Red Spot and Pluto's heart all sit there.
"""

import math
import random
from contextlib import contextmanager

import bmesh
from mathutils import Matrix, Vector

from common import M, Model, mat, polar
from continent import _surface

UNITS = "0.0001 AU"
SCALE_NOTE = ("Solar scale: 1 unit = 0.0001 AU (about 15,000 km), load at "
              "scale 0.01.")
PROP_NOTE = (f"{SCALE_NOTE} Debris prop (normalised to its Debris size, only "
             "proportions matter).")
TAU = 2 * math.pi

# name: (hex colour, roughness, metallic, emission hex or None, strength)
PAL = {
    # rock and ice
    "sol_rock": ("#8a8077", 0.95, 0.0, None, 0),
    "sol_rock_light": ("#ada296", 0.95, 0.0, None, 0),
    "sol_rock_dark": ("#5e5650", 0.95, 0.0, None, 0),
    "sol_crater": ("#4a443f", 0.95, 0.0, None, 0),
    "sol_nucleus": ("#55504c", 0.9, 0.0, None, 0),
    "sol_nucleus_dark": ("#3b3734", 0.9, 0.0, None, 0),
    "sol_frost": ("#e4eef2", 0.5, 0.0, None, 0),
    # comet glow
    "sol_coma": ("#e8fbff", 0.3, 0.0, "#c8f4ff", 3.0),
    "sol_coma_blue": ("#a4e6ff", 0.3, 0.0, "#70d2ff", 2.5),
    "sol_dust": ("#f8ecd2", 0.4, 0.0, "#f6e2b4", 1.8),
    "sol_dust_dim": ("#e6d3aa", 0.5, 0.0, "#d2b882", 0.9),
    "sol_ion": ("#86c8ff", 0.3, 0.0, "#4aa8ff", 2.6),
    "sol_ion_dim": ("#5d9fe2", 0.4, 0.0, "#3a80d4", 1.2),
    "sol_ice_trail": ("#d8f4ff", 0.3, 0.0, "#a8e4ff", 1.6),
    # the Sun and its plasma
    "sol_sun_white": ("#fff4b8", 0.3, 0.0, "#ffeb8a", 4.0),
    "sol_sun_yellow": ("#ffd640", 0.4, 0.0, "#ffc41c", 3.5),
    "sol_sun_gold": ("#ffb52e", 0.4, 0.0, "#ff9e12", 3.5),
    "sol_sun_orange": ("#ff8c22", 0.4, 0.0, "#ff7410", 3.5),
    "sol_umbra": ("#2a1307", 0.8, 0.0, None, 0),
    "sol_penumbra": ("#a84716", 0.7, 0.0, "#8a3008", 0.8),
    "sol_penumbra_light": ("#c9601e", 0.7, 0.0, "#a8420c", 1.0),
    "sol_glint": ("#fffbea", 0.2, 0.0, "#fff6d2", 6.0),
    "sol_plasma_white": ("#fff6dc", 0.3, 0.0, "#fff0c0", 6.0),
    "sol_plasma_yellow": ("#ffd84a", 0.3, 0.0, "#ffc820", 5.0),
    "sol_plasma_orange": ("#ff9a2a", 0.3, 0.0, "#ff7a10", 5.0),
    "sol_plasma_red": ("#f0501e", 0.4, 0.0, "#e03810", 4.0),
    # planets
    "sol_grey": ("#d6d6d3", 0.9, 0.0, None, 0),
    "sol_grey_light": ("#ebebe8", 0.9, 0.0, None, 0),
    "sol_grey_dark": ("#b2b2ae", 0.9, 0.0, None, 0),
    "sol_moon": ("#a9a7a2", 0.95, 0.0, None, 0),
    "sol_moon_light": ("#cdcbc6", 0.95, 0.0, None, 0),
    "sol_moon_dark": ("#7a7874", 0.95, 0.0, None, 0),
    "sol_ice_white": ("#eef1f2", 0.6, 0.0, None, 0),
    "sol_ice_cream": ("#e6dccb", 0.6, 0.0, None, 0),
    "sol_ice_crack": ("#b0784a", 0.8, 0.0, None, 0),
    "sol_mars": ("#c4532a", 0.9, 0.0, None, 0),
    "sol_mars_light": ("#dc7a46", 0.9, 0.0, None, 0),
    "sol_mars_dark": ("#86361a", 0.9, 0.0, None, 0),
    "sol_polar_cap": ("#f6f3ee", 0.6, 0.0, None, 0),
    "sol_venus": ("#eadb9e", 0.7, 0.0, None, 0),
    "sol_venus_light": ("#f6eccb", 0.7, 0.0, None, 0),
    "sol_venus_dark": ("#d2b878", 0.7, 0.0, None, 0),
    "sol_jup_white": ("#f3ead6", 0.7, 0.0, None, 0),
    "sol_jup_cream": ("#e6d2ac", 0.7, 0.0, None, 0),
    "sol_jup_tan": ("#c8a47a", 0.7, 0.0, None, 0),
    "sol_jup_brown": ("#a87452", 0.7, 0.0, None, 0),
    "sol_jup_rust": ("#a35c38", 0.7, 0.0, None, 0),
    "sol_jup_pole": ("#a99a88", 0.7, 0.0, None, 0),
    "sol_jup_spot": ("#c8462a", 0.7, 0.0, None, 0),
    "sol_jup_spot_rim": ("#eab48a", 0.7, 0.0, None, 0),
    "sol_sat": ("#ecdcae", 0.7, 0.0, None, 0),
    "sol_sat_light": ("#f6ecca", 0.7, 0.0, None, 0),
    "sol_sat_dark": ("#d2b680", 0.7, 0.0, None, 0),
    "sol_sat_pole": ("#b8b08e", 0.7, 0.0, None, 0),
    "sol_ring_a": ("#cbb990", 0.7, 0.0, None, 0),
    "sol_ring_b": ("#e8d9b0", 0.7, 0.0, None, 0),
    "sol_ring_b2": ("#d8c69a", 0.7, 0.0, None, 0),
    "sol_ring_c": ("#9d8d6e", 0.7, 0.0, None, 0),
    "sol_ice_giant": ("#8edbe4", 0.5, 0.0, None, 0),
    "sol_ice_giant_light": ("#aee9ef", 0.5, 0.0, None, 0),
    "sol_ice_giant_dark": ("#6fc4d4", 0.5, 0.0, None, 0),
    "sol_ice_ring": ("#9cb8bc", 0.7, 0.0, None, 0),
    "sol_pluto": ("#d2b08a", 0.8, 0.0, None, 0),
    "sol_pluto_light": ("#e2c8a6", 0.8, 0.0, None, 0),
    "sol_pluto_dark": ("#74503a", 0.8, 0.0, None, 0),
    "sol_pluto_heart": ("#f5eee2", 0.6, 0.0, None, 0),
    # Voyager
    "sol_dish": ("#f2f1ec", 0.5, 0.1, None, 0),
    "sol_bus": ("#9a9a98", 0.4, 0.6, None, 0),
    "sol_gold": ("#d9a83e", 0.35, 0.7, None, 0),
    "sol_boom": ("#c8c8c4", 0.5, 0.4, None, 0),
    "sol_rtg": ("#4c4c4e", 0.6, 0.4, None, 0),
}


def S(key):
    """Material from the Solar palette."""
    color, rough, metal, emit, strength = PAL[key]
    return mat(key, color, rough, metal, emit, strength)


# --------------------------------------------------------------------------
# Shared helpers
# --------------------------------------------------------------------------

_ND = [Vector(v).normalized() for v in
       ((0.8, 0.3, 0.5), (-0.4, 0.9, 0.2), (0.1, -0.5, 0.85),
        (0.6, -0.7, -0.3), (-0.7, -0.2, 0.65))]
_NW = (0.32, 0.26, 0.2, 0.13, 0.09)


def _noise(n, f=3.0, s=0.0):
    """Smooth deterministic noise on the unit sphere, about [-1, 1]."""
    return sum(_NW[k] * math.sin(f * (1 + 0.55 * k) * n.dot(d) + s * (1.7 + k)
                                 + 1.3 * k) for k, d in enumerate(_ND))


def _dir(lon, lat):
    """Unit vector: lon 0 = forward (-Y, glTF +Z), 90 = right (+X); lat up."""
    lo, la = math.radians(lon), math.radians(lat)
    return Vector((math.cos(la) * math.sin(lo), -math.cos(la) * math.cos(lo),
                   math.sin(la)))


def _latlon(n):
    lat = math.degrees(math.asin(max(-1.0, min(1.0, n.z))))
    lon = math.degrees(math.atan2(n.x, -n.y))
    return lat, lon


@contextmanager
def _frame(p, origin, e1, e2, e3):
    """Push a local frame (x = e1, y = e2, z = e3) at `origin`."""
    mx = Matrix((
        (e1.x, e2.x, e3.x, origin[0]),
        (e1.y, e2.y, e3.y, origin[1]),
        (e1.z, e2.z, e3.z, origin[2]),
        (0, 0, 0, 1)))
    p._stack.append(p._stack[-1] @ mx)
    try:
        yield
    finally:
        p._stack.pop()


def _ico(p, subdiv, classify, center, scale, disp=None, rot=(0, 0, 0)):
    """Icosphere on the unit sphere, displaced radially by disp(n) (relative),
    faces coloured by classify(n), then scaled/placed. Returns the verts."""
    res = bmesh.ops.create_icosphere(p.bm, subdivisions=subdiv, radius=1.0,
                                     matrix=Matrix.Identity(4))
    verts = res["verts"]
    for v in verts:
        n = v.co.normalized()
        v.co = n * (1 + (disp(n) if disp else 0.0))
    faces = {f for v in verts for f in v.link_faces}
    for f in faces:
        f.material_index = p._slot(classify(
            f.calc_center_median().normalized()))
    bmesh.ops.transform(p.bm, matrix=p._m(center, rot, scale), verts=verts)
    bmesh.ops.recalc_face_normals(p.bm, faces=list(faces))
    return verts


def _globe(p, R, classify, u=40, v=24, tilt=0.0, center=None):
    """UV sphere of radius R (rows of latitude, so bands stay crisp) resting
    on the floor; the axis is tilted `tilt` degrees about X (negative tips
    the north pole away from the camera). classify(lat, lon) -> material."""
    rows = [[(0.0, 0.0, -1.0)]]
    for i in range(1, v):
        lat = -90 + 180 * i / v
        rows.append([tuple(_dir(360 * j / u, lat)) for j in range(u)])
    rows.append([(0.0, 0.0, 1.0)])
    c = center if center is not None else (0, 0, R)
    with p.xform(c, (tilt, 0, 0), (R, R, R)):
        _surface(p, rows, lambda i, j, cc: classify(
            *_latlon(Vector(cc).normalized())), wrap=True, orient="recalc")


def _rest(verts, floor=0.0):
    """Shift verts so their lowest point sits on the floor. Returns the
    shift."""
    low = min(v.co.z for v in verts)
    for v in verts:
        v.co.z += floor - low
    return floor - low


def _craters(seed, n, rmin, rmax, up=0.7):
    """Random crater list [(direction, angular radius)], biased upwards."""
    rnd = random.Random(seed)
    out = []
    for k in range(n):
        zc = (rnd.uniform(0.0, 1.0) ** 0.6 if k < n * up
              else rnd.uniform(-1.0, 0.2))
        th = rnd.uniform(0, TAU)
        rr = math.sqrt(max(0.0, 1 - zc * zc))
        d = Vector((rr * math.cos(th), rr * math.sin(th), zc)).normalized()
        out.append((d, math.radians(rnd.uniform(rmin, rmax))))
    return out


def _crater_disp(craters, depth=0.22, rim=0.07):
    def f(n):
        dr = 0.0
        for d, rho in craters:
            x = n.angle(d) / rho
            if x < 1.0:
                dr -= rho * depth * (1 - x * x)
            if x < 1.7:
                dr += rho * rim * math.exp(-((x - 1.0) / 0.22) ** 2)
        return dr
    return f


def _crater_at(craters, n):
    """'floor', 'rim' or None for a direction."""
    for d, rho in craters:
        x = n.angle(d) / rho
        if x < 0.72:
            return "floor"
        if x < 1.1:
            return "rim"
    return None


def _frames(pts):
    """Parallel-transport frames (tangent, normal, binormal) along pts."""
    n = len(pts)
    T = [(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
         for i in range(n)]
    ref = Vector((0, 0, 1)) if abs(T[0].z) < 0.9 else Vector((1, 0, 0))
    N = [(ref - T[0] * ref.dot(T[0])).normalized()]
    for i in range(1, n):
        N.append((N[-1] - T[i] * N[-1].dot(T[i])).normalized())
    B = [T[i].cross(N[i]) for i in range(n)]
    return T, N, B


def _tube(p, pts, radii, material, segs=8):
    """Closed tube swept along pts (radii: a number or one per point)."""
    pts = [Vector(q) for q in pts]
    _, N, B = _frames(pts)
    rs = radii if isinstance(radii, (list, tuple)) else [radii] * len(pts)
    rows = [[tuple(pts[0])]]
    for i, c in enumerate(pts):
        rows.append([tuple(c + (N[i] * math.cos(TAU * k / segs)
                                + B[i] * math.sin(TAU * k / segs)) * rs[i])
                     for k in range(segs)])
    rows.append([tuple(pts[-1])])
    mfn = material if callable(material) else (lambda i, j, c: material)
    return _surface(p, rows, mfn, wrap=True, orient="recalc")


def _flux(p, centre, strands, spread, radius, turns, mats, segs=6):
    """Twisted rope of `strands` tubes round a centreline (a magnetic flux
    tube / plasma loop). spread and radius are functions of s in [0, 1]."""
    centre = [Vector(q) for q in centre]
    _, N, B = _frames(centre)
    n = len(centre)
    for k in range(strands):
        pts, rs = [], []
        for i, c in enumerate(centre):
            s = i / (n - 1)
            ph = TAU * (k / strands + turns * s)
            pts.append(c + (N[i] * math.cos(ph) + B[i] * math.sin(ph))
                       * spread(s))
            rs.append(radius(s))
        _tube(p, pts, rs, mats[k % len(mats)], segs=segs)


def _bez(p0, p1, p2, p3, n):
    p0, p1, p2, p3 = (Vector(q) for q in (p0, p1, p2, p3))
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append(p0 * u ** 3 + p1 * 3 * u * u * t + p2 * 3 * u * t * t
                   + p3 * t ** 3)
    return out


def _arch(a, b, h, n, bulge=(0, 0, 0)):
    """Points on a half-ellipse arch from a to b, peaking h above the chord,
    pushed sideways by `bulge` at the top."""
    a, b, bu = Vector(a), Vector(b), Vector(bulge)
    up = Vector((0, 0, h))
    return [a + (b - a) * (i / n) + (up + bu) * math.sin(math.pi * i / n)
            for i in range(n + 1)]


def _dome_strip(p, centre, widths, heights, mat_fn, segs=8, z0=0.0):
    """A half-tube lying on the floor along the (x, y) centreline: comet
    tails, flame tongues. The first end is closed. mat_fn(i, j, c): i is the
    station (0 = the closing cap row), j the strip across."""
    rows = [[(centre[0][0], centre[0][1], z0)]]
    n = len(centre)
    for i, (x, y) in enumerate(centre):
        a, b = centre[max(i - 1, 0)], centre[min(i + 1, n - 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        L = math.hypot(tx, ty) or 1.0
        sx, sy = ty / L, -tx / L
        row = []
        for k in range(segs + 1):
            u = -1 + 2 * k / segs
            z = z0 + heights[i] * math.sqrt(max(0.0, 1 - u * u))
            row.append((x + sx * u * widths[i], y + sy * u * widths[i], z))
        rows.append(row)
    return _surface(p, rows, mat_fn, orient="up")


def _lumpy_rock(p, center, radii, seed, subdiv=2, crater_n=5, lump=0.13,
                mats=("sol_rock", "sol_rock_light", "sol_rock_dark",
                      "sol_crater")):
    """Potato-shaped cratered rock (an ellipsoid with radii (x, y, z))."""
    rnd = random.Random(seed)
    craters = _craters(seed, crater_n, 14, 30)
    cd = _crater_disp(craters, depth=0.3, rim=0.08)
    s = rnd.uniform(0, 10)

    def disp(n):
        return lump * _noise(n, 2.2, s) + 0.05 * _noise(n, 5.5, s + 3) + cd(n)

    def classify(n):
        c = _crater_at(craters, n)
        if c == "floor":
            return S(mats[3])
        if c == "rim":
            return S(mats[1])
        v = _noise(n, 4.0, s + 7)
        return S(mats[2] if v < -0.35 else mats[1] if v > 0.4 else mats[0])

    rot = (rnd.uniform(-20, 20), rnd.uniform(-20, 20), rnd.uniform(0, 360))
    return _ico(p, subdiv, classify, center, radii, disp, rot)


# --------------------------------------------------------------------------
# Hazards
# --------------------------------------------------------------------------

def rogue_asteroid():
    RC = 40.0
    m = Model("rogue_asteroid",
              f"{SCALE_NOTE} Wanderer that pulls. A lumpy, cratered rock "
              "(about 140 x 115 x 80) with four pebbles caught in its "
              "gravity at r 80 to 105; scattered gravel on the floor in body. "
              "rock node (the rock and its pebbles) spins about its local Y "
              f"axis; pivot at the rock centre (0, {RC:g}, 0).")
    r = m.part("rock", pivot=(0, 0, RC))
    verts = _lumpy_rock(r, (0, 0, RC), (70, 58, 40), seed=7, subdiv=4,
                        crater_n=7, lump=0.12)
    _rest(verts)
    rnd = random.Random(11)
    for k, (a, d, z, rad) in enumerate(((35, 92, 26, 10), (150, 84, 50, 8),
                                        (230, 100, 34, 11), (305, 88, 56, 7))):
        x, y, _ = polar(a, d)
        _lumpy_rock(r, (x, y, z), (rad, rad * 0.85, rad * 0.75), seed=20 + k,
                    subdiv=2, crater_n=0, lump=0.18)
    b = m.part("body")
    for k in range(9):
        a = k * 40 + rnd.uniform(-12, 12)
        x, y, _ = polar(a, rnd.uniform(72, 104))
        g = rnd.uniform(3, 5)
        _lumpy_rock(b, (x, y, g * 0.6), (g, g, g * 0.6), seed=40 + k,
                    subdiv=1, crater_n=0, lump=0.2)
    return m


def comet():
    NR, NC = 60.0, 60.0
    m = Model("comet",
              f"{SCALE_NOTE} Lane patrol riding an orbit. Comet moving +Z: an "
              f"icy dark nucleus (radius {NR:g}, centre (0, {NC:g}, 0)) with "
              "frost patches and sunward jets, inside a glowing coma skirt "
              "(r 100); a curved cream dust tail and a straight blue ion tail "
              "stream back to -Z (to z = -375). tail node (both tails) has "
              f"its pivot at the nucleus centre (0, {NC:g}, 0); scale it "
              "along Z / flutter it about Y. Nucleus radius 60 = 0.6 world "
              "units at scale 0.01.")
    b = m.part("body")
    craters = _craters(5, 5, 12, 22)
    cd = _crater_disp(craters, 0.25, 0.06)

    def nuc_mat(n):
        if _crater_at(craters, n) == "floor":
            return S("sol_nucleus_dark")
        v = _noise(n, 3.2, 2.0)
        if v > 0.42 and n.z > -0.2:
            return S("sol_frost")
        return S("sol_nucleus_dark" if v < -0.3 else "sol_nucleus")

    _ico(b, 4, nuc_mat, (0, 0, NC), (NR, NR * 0.92, NR),
         lambda n: 0.08 * _noise(n, 2.4, 1.0) + cd(n), rot=(0, 0, 30))
    # coma: a glowing skirt flaring from the nucleus waist to the floor
    b.lathe([(NR * 0.88, NC - 18), (72, 16), (84, 4), (0, 4)],
            S("sol_coma"), segs=32)
    b.lathe([(80, 9), (100, 3), (104, 0), (76, 0)], S("sol_coma_blue"),
            segs=32)
    # sunward jets (+Z = -Y)
    for a, el in ((-25, 20), (10, 35), (40, 12)):
        d = _dir(a, el)
        base = Vector((0, 0, NC)) + d * NR * 0.85
        b.rod(tuple(base), tuple(base + d * 42), 7, S("sol_coma"), segs=6,
              r2=1.5)
    t = m.part("tail", pivot=(0, 0, NC))
    n = 14
    # dust tail: wide, curving to +X, cream
    cen, wid, hei = [], [], []
    for i in range(n + 1):
        s = i / n
        cen.append((55 * s ** 1.7, 40 + 315 * s))
        wid.append(44 + 52 * s ** 0.8)
        hei.append(6 + 58 * (1 - s) ** 0.8)

    def dust_mat(i, j, c):
        s = (i - 1) / n
        if j in (0, 7) or (s > 0.55 and j in (1, 6)) or s > 0.85:
            return S("sol_dust_dim")
        return S("sol_dust")

    _dome_strip(t, cen, wid, hei, dust_mat, segs=8)
    # ion tail: narrow, straight back, blue, slightly to -X, riding higher
    cen, wid, hei = [], [], []
    for i in range(n + 1):
        s = i / n
        cen.append((-28 - 18 * s, 30 + 345 * s))
        wid.append(24 + 22 * s)
        hei.append(8 + 74 * (1 - s) ** 1.1)

    def ion_mat(i, j, c):
        s = (i - 1) / n
        streak = j in (2, 3) or (s < 0.5 and j in (1, 4))
        return S("sol_ion" if streak and s < 0.85 else "sol_ion_dim")

    _dome_strip(t, cen, wid, hei, ion_mat, segs=6)
    return m


def sunspot():
    m = Model("sunspot", "")
    b = m.part("body")
    rnd = random.Random(3)
    ph = [rnd.uniform(0, TAU) for _ in range(3)]

    def outline(a):
        ar = math.radians(a)
        return 106 * (1 + 0.07 * math.sin(3 * ar + ph[0])
                      + 0.05 * math.sin(5 * ar + ph[1])
                      + 0.03 * math.sin(8 * ar + ph[2]))

    segs = 48
    spec = [(1.08, 0.0), (1.08, 1.0), (1.0, 2.6), (0.5, 3.0), (0.46, 4.4),
            (0.2, 4.6), (0, 4.6)]
    rows = []
    for s, z in spec:
        if s <= 0:
            rows.append([(0.0, 0.0, z)])
            continue
        rows.append([polar(360 * j / segs,
                           outline(360 * j / segs) * s
                           * (1 + (0.04 if z < 2 and j % 2 else 0)))[:2] + (z,)
                     for j in range(segs)])

    def mat_fn(i, j, c):
        if i == 0:  # bright faculae fringe round the spot
            return S("sol_sun_yellow" if j % 3 else "sol_sun_white")
        if i == 1:
            return S("sol_sun_gold")
        if i == 2:  # filamentary penumbra
            return S("sol_penumbra_light" if j % 2 else "sol_penumbra")
        return S("sol_umbra")

    _surface(b, rows, mat_fn, wrap=True)
    # the emitter: a twisted magnetic flux tube rising from the back of the
    # umbra, arching over and ending in a muzzle that points forward (+Z)
    h = m.part("head")
    p0, p1, p2, p3 = (0, 38, 2), (0, 40, 74), (0, -26, 66), (0, -64, 46)
    cl = _bez(p0, p1, p2, p3, 22)
    _flux(h, cl, 3, lambda s: 7.5 * (0.6 + 0.4 * s), lambda s: 6.5 - 1.5 * s,
          1.6, [S("sol_plasma_yellow"), S("sol_plasma_orange"),
                S("sol_plasma_red")], segs=6)
    h.sphere(16, p0, S("sol_umbra"), u=10, v=6, scale=(1.4, 1.4, 0.5))
    tan = (Vector(p3) - Vector(p2)).normalized()
    mouth = Vector(p3) + tan * 6
    q = Vector((0, 0, 1)).rotation_difference(tan).to_euler()
    rot = tuple(math.degrees(r) for r in q)
    with h.xform(tuple(mouth), rot):
        h.lathe([(9, -8), (13, 2), (16, 8), (13, 9), (0, 4)],
                S("sol_plasma_white"), segs=12)
        h.torus(15, 2.5, (0, 0, 8), S("sol_plasma_orange"), segs=12, rsegs=4)
    muzzle = mouth + tan * 9
    mz = (round(muzzle.x, 1) + 0.0, round(muzzle.z, 1), round(-muzzle.y, 1))
    m.notes = (f"{SCALE_NOTE} Turret that fires flare bolts. A dark umbra "
               "(r 50) in a filamentary orange penumbra (r 106) with a bright "
               "faculae rim, flat on the floor. head node: a twisted "
               "magnetic flux tube (three emissive strands) rising from the "
               "back of the umbra and arching forward to a white-hot muzzle "
               "facing +Z; it turns about Y through its pivot at the origin "
               f"(0, 0, 0). Muzzle at ({mz[0]:g}, {mz[1]:g}, {mz[2]:g}) in "
               "model space.")
    return m


def sungrazer():
    HZ, HY = 22.0, -46.0
    m = Model("sungrazer",
              f"{SCALE_NOTE} Trail-layer that lays an icy trail. A sungrazing "
              "comet moving +Z: a small white-hot head (r 20) at "
              f"(0, {HZ:g}, {-HY:g}) in a yellow coma collar, and a short, "
              "wide tail fanning back to -Z (white, then orange, then icy "
              "blue at the end, where the trail continues).")
    b = m.part("body")
    b.sphere(20, (0, HY, HZ), S("sol_plasma_white"), u=14, v=8)
    b.lathe([(0, -26), (14, -18), (27, -2), (30, 10), (25, 22), (0, 30)],
            S("sol_plasma_yellow"), segs=16, center=(0, HY + 2, HZ),
            rot=(-90, 0, 0), scale=(0.9, 0.85, 0.9))
    n = 12
    cen, wid, hei = [], [], []
    for i in range(n + 1):
        s = i / n
        cen.append((6 * math.sin(s * 3), HY + 8 + 168 * s))
        wid.append(22 + 44 * math.sin(min(1.0, s * 1.4) * math.pi / 2))
        hei.append(4 + 30 * (1 - s) ** 0.9)

    def tail_mat(i, j, c):
        s = (i - 1) / n
        mid = j in (3, 4)
        if s < 0.3:
            return S("sol_plasma_white" if mid else "sol_plasma_yellow")
        if s < 0.6:
            return S("sol_plasma_yellow" if mid else "sol_plasma_orange")
        return S("sol_ice_trail" if mid or j in (2, 5) else "sol_coma_blue")

    _dome_strip(b, cen, wid, hei, tail_mat, segs=8)
    return m


def solar_flare():
    m = Model("solar_flare",
              f"{SCALE_NOTE} Cone blaster (blow). A bright flare ribbon "
              "patch (r 90) with two dark footpoints at x = +-58, and five "
              "flame tongues licking out to +Z (to r 240): the blast faces "
              "+Z. loop node: an arcade of three twisted emissive plasma "
              "loops (the tallest 120 high) rooted at the footpoints; it "
              "pulses / spins about its local Y axis; pivot at the origin "
              "(0, 0, 0).")
    b = m.part("body")
    rnd = random.Random(9)
    segs = 40
    ph = [rnd.uniform(0, TAU) for _ in range(3)]

    def outline(a):
        ar = math.radians(a)
        return 88 * (1 + 0.1 * math.sin(2 * ar + ph[0])
                     + 0.06 * math.sin(5 * ar + ph[1]))

    spec = [(1.0, 0.0), (1.0, 1.5), (0.62, 3.0), (0.3, 3.4), (0, 3.4)]
    rows = []
    for s, z in spec:
        if s <= 0:
            rows.append([(0.0, 0.0, z)])
        else:
            rows.append([polar(360 * j / segs, outline(360 * j / segs) * s)[:2]
                         + (z,) for j in range(segs)])

    _surface(b, rows, lambda i, j, c: S(
        ("sol_plasma_orange", "sol_sun_gold", "sol_plasma_yellow",
         "sol_plasma_white")[min(i, 3)]), wrap=True)
    for x in (-58, 58):
        b.cyl(15, 3, (x, 0, 4), S("sol_umbra"), segs=10)
    # flame tongues fanning out forward (-Y = glTF +Z)
    for k, a in enumerate((-32, -16, 0, 16, 32)):
        L = 240 if k == 2 else 205 if k in (1, 3) else 170
        n = 10
        cen, wid, hei = [], [], []
        for i in range(n + 1):
            s = i / n
            aa = a + 8 * math.sin(s * 3 + k) * s
            x, y, _ = polar(aa, 50 + (L - 60) * s)
            cen.append((x, y))
            wid.append(22 * (1 - s) ** 0.7 + 3)
            hei.append(20 * (1 - s) ** 0.8 + 2)

        def tongue(i, j, c, k=k):
            s = (i - 1) / 10
            if s < 0.3:
                return S("sol_plasma_white" if j in (2, 3) else
                         "sol_plasma_yellow")
            if s < 0.7:
                return S("sol_plasma_orange")
            return S("sol_plasma_red")

        _dome_strip(b, cen, wid, hei, tongue, segs=6, z0=0.5)
    lp = m.part("loop")
    mats = [S("sol_plasma_yellow"), S("sol_plasma_orange"),
            S("sol_plasma_white")]
    _flux(lp, _arch((-58, 0, 2), (58, 0, 2), 104, 24, bulge=(0, -14, 0)), 3,
          lambda s: 6.0, lambda s: 6.5, 1.5, mats, segs=6)
    _flux(lp, _arch((-50, 10, 2), (44, -22, 2), 78, 18, bulge=(0, -24, 0)),
          2, lambda s: 4.5, lambda s: 5.0, 1.2,
          [S("sol_plasma_orange"), S("sol_plasma_red")], segs=6)
    _flux(lp, _arch((-40, -18, 2), (52, 16, 2), 60, 16, bulge=(0, 10, 0)), 2,
          lambda s: 4.0, lambda s: 4.5, 1.0,
          [S("sol_plasma_red"), S("sol_plasma_yellow")], segs=6)
    return m


def the_sun():
    R, SQ = 270.0, 0.7
    C = R * SQ
    m = Model("the_sun", "")
    b = m.part("body")
    b.smooth_angle = math.radians(60)

    def classify(n):
        v = _noise(n, 7.0, 1.0) + 0.3 * _noise(n, 13.0, 2.0)
        v -= 0.6 * max(0.0, -n.z - 0.1)  # limb darkening below the equator
        if v > 0.55:
            return S("sol_sun_white")
        if v > -0.05:
            return S("sol_sun_yellow")
        if v > -0.5:
            return S("sol_sun_gold")
        return S("sol_sun_orange")

    _ico(b, 5, classify, (0, 0, C), (R, R, R * SQ),
         lambda n: 0.012 * _noise(n, 14.0, 4.0))

    def surf(lon, lat):
        d = _dir(lon, lat)
        pt = Vector((R * d.x, R * d.y, C + R * SQ * d.z))
        nn = Vector((d.x, d.y, d.z / SQ)).normalized()
        return pt, nn

    # the face: two sunspot eyes on the camera side, each with a glint
    eyes = []
    for side in (-1, 1):
        pt, nn = surf(side * 25, 31)
        e1 = Vector((0, 0, 1)).cross(nn).normalized()  # screen right (+X)
        e2 = nn.cross(e1).normalized()  # screen up
        with _frame(b, pt, e1, e2, nn):
            b.lathe([(0, 2), (56, 2), (66, -16), (0, -16)],
                    S("sol_penumbra"), segs=20)
            b.lathe([(0, 6), (34, 6), (44, 3), (44, 1), (0, 1)],
                    S("sol_umbra"), segs=20, scale=(0.92, 1.1, 1))
            b.sphere(9, (10, 15, 7), S("sol_glint"), u=8, v=5,
                     scale=(1, 1, 0.5))
            b.sphere(4, (-12, -10, 6.5), S("sol_glint"), u=6, v=4,
                     scale=(1, 1, 0.5))
            # a heavy brow of dark penumbra over each eye (angled inwards)
            b.box((70, 12, 8), (side * -6, 62, 0), S("sol_penumbra"),
                  rot=(0, 0, side * 14))
        eyes.append((round(pt.x, 1) + 0.0, round(pt.z, 1),
                     round(-pt.y, 1) + 0.0))
    # corona: a fringe of flame tongues round the equator
    co = m.part("corona", pivot=(0, 0, C))
    rnd = random.Random(21)
    nfl = 32
    for i in range(nfl):
        a = 360 * i / nfl + rnd.uniform(-3, 3)
        L = 22 if i % 2 else 14
        L += rnd.uniform(-2, 2)
        dz = (12 if i % 3 == 0 else -8 if i % 3 == 1 else 2)
        base = Vector(polar(a, R - 14, C + dz * 0.3))
        tip = Vector(polar(a + (6 if i % 2 else -4), R + L, C + dz))
        co.rod(tuple(base), tuple(tip), 26 if i % 2 else 20,
               S("sol_plasma_orange" if i % 2 else "sol_plasma_yellow"),
               segs=5, r2=1.0)
    # prominences: two twisted loops over the shoulders (left / right)
    for name, side in (("prominence_l", -1), ("prominence_r", 1)):
        pa, na = surf(side * 84, 14)
        pb, nb = surf(side * 96, 52)
        mid, nm = surf(side * 90, 33)
        p = m.part(name, pivot=tuple(round(c, 2) for c in mid))
        cl = _bez(pa - na * 6, pa + na * 70, pb + nb * 70, pb - nb * 6, 20)
        _flux(p, cl, 3, lambda s: 7 + 3 * math.sin(math.pi * s),
              lambda s: 7.5 - 2 * math.sin(math.pi * s), 1.3,
              [S("sol_plasma_red"), S("sol_plasma_orange"),
               S("sol_plasma_yellow")], segs=6)
    m.notes = (f"{SCALE_NOTE} Boss. The Sun: a granulated emissive ball "
               f"(radius {R:g}, squashed to {SQ:g} in Y: height {2 * C:g}, "
               f"centre (0, {C:g}, 0)) with a face on the +Z side: two dark "
               "sunspot eyes with white glints under heavy penumbra brows "
               f"(eye centres at ({eyes[0][0]:g}, {eyes[0][1]:g}, "
               f"{eyes[0][2]:g}) and ({eyes[1][0]:g}, {eyes[1][1]:g}, "
               f"{eyes[1][2]:g})). corona node: a fringe of 32 flame tongues "
               f"round the equator (to r 294), spins about Y; pivot at the "
               f"centre (0, {C:g}, 0). prominence_l / prominence_r: twisted "
               "plasma loops over the left (-X) / right (+X) shoulders, "
               "pivot on the surface midway between their roots; hide them "
               "when chipped.")
    return m


# --------------------------------------------------------------------------
# Debris props
# --------------------------------------------------------------------------

def asteroid():
    m = Model("asteroid", f"{PROP_NOTE} A lumpy, cratered potato of grey-"
              "brown rock (about 120 x 100 x 80).")
    b = m.part("body")
    verts = _lumpy_rock(b, (0, 0, 40), (60, 44, 35), seed=101, subdiv=4,
                        crater_n=6)
    _rest(verts)
    return m


def asteroid_cluster():
    m = Model("asteroid_cluster", f"{PROP_NOTE} A loose clump of six rocks "
              "of different sizes, the biggest in the middle.")
    b = m.part("body")
    for k, (x, y, r) in enumerate(((0, 0, 34), (52, -18, 22), (-46, 22, 24),
                                   (14, 50, 16), (-30, -44, 15),
                                   (66, 34, 11))):
        verts = _lumpy_rock(b, (x, y, r), (r, r * 0.85, r * 0.7),
                            seed=200 + k, subdiv=3, crater_n=2 if r > 20
                            else 0)
        _rest(verts)
    return m


def comet_nucleus():
    m = Model("comet_nucleus", f"{PROP_NOTE} A two-lobed dark comet nucleus "
              "(a rubber duck like 67P) with white frost patches and two "
              "pale sunward jets.")
    b = m.part("body")

    def nuc(seed):
        def f(n):
            v = _noise(n, 3.0, seed)
            if v > 0.38 and n.z > -0.3:
                return S("sol_frost")
            return S("sol_nucleus_dark" if v < -0.35 else "sol_nucleus")
        return f

    _ico(b, 4, nuc(1.0), (-22, 8, 36), (52, 42, 36),
              lambda n: 0.07 * _noise(n, 2.5, 1.0))
    _ico(b, 4, nuc(4.0), (38, -10, 36), (34, 31, 29),
              lambda n: 0.08 * _noise(n, 2.8, 3.0), rot=(0, 0, 25))
    sh = _rest(list(b.bm.verts))
    for base, d in (((-30, -20, 60), (-0.3, -0.7, 0.6)),
                    ((40, -30, 52), (0.2, -0.8, 0.5))):
        bb = Vector(base) + Vector((0, 0, sh))
        dd = Vector(d).normalized()
        b.rod(tuple(bb), tuple(bb + dd * 30), 6, S("sol_coma"), segs=6, r2=1)
    return m


def voyager_1():
    m = Model("voyager_1", f"{PROP_NOTE} Voyager 1: a big white dish "
              "facing up on a ten-sided silver bus with a gold record, the "
              "RTG boom (three dark power cylinders) to -X, the science boom "
              "and scan platform to +X, and the long magnetometer boom "
              "trailing back to -Z.")
    b = m.part("body")
    b.cyl(17, 12, (0, 0, 12), S("sol_bus"), segs=10)
    b.cyl(17.4, 4, (0, 0, 13), S("sol_gold"), segs=10)
    with b.xform((0, -17.6, 12), (90, 0, 0)):
        b.cyl(5.5, 1, (0, 0, 0), S("sol_gold"), segs=12)
    b.lathe([(0, 18), (20, 19.5), (40, 27), (38, 28.5), (19, 21.5),
             (0, 20)], S("sol_dish"), segs=24)
    for a in (0, 120, 240):
        x, y, _ = polar(a, 30)
        b.rod((x, y, 25), (0, 0, 38), 0.9, S("sol_boom"), segs=4)
    b.cyl(4.5, 3, (0, 0, 38.5), S("sol_dish"), segs=10)
    # RTG boom to -X
    b.rod((-15, 2, 10), (-72, 8, 10), 1.8, S("sol_boom"), segs=6)
    for k in range(3):
        x = -44 - k * 11
        y = 2 + 6 * (44 + k * 11 - 15) / 57
        b.cyl(5, 9, (x, y, 10), S("sol_rtg"), segs=8, rot=(0, 90, 0))
        b.box((9, 1.2, 15), (x, y, 10), S("sol_rtg"))
        b.box((9, 15, 1.2), (x, y, 10), S("sol_rtg"))
    # science boom to +X with the scan platform
    b.rod((15, -2, 11), (64, -8, 11), 1.8, S("sol_boom"), segs=6)
    b.box((12, 10, 10), (68, -9, 11), S("sol_bus"))
    b.cyl(3.5, 10, (70, -16, 13), S("sol_rtg"), segs=8, rot=(90, 0, 0))
    b.cyl(2.5, 8, (64, -15, 16), S("sol_dish"), segs=8, rot=(90, 0, 0))
    # magnetometer boom trailing back (+Y = glTF -Z)
    b.rod((4, 15, 9), (14, 96, 9), 1.1, S("sol_boom"), segs=4)
    for k in range(1, 6):
        t = k / 6
        b.torus(2.2, 0.6, (4 + 10 * t, 15 + 81 * t, 9), S("sol_boom"),
                segs=6, rsegs=3, rot=(90, 0, 7))
    b.box((4, 6, 4), (14, 97, 9), S("sol_gold"))
    # plasma wave antennas
    b.rod((-8, -10, 18), (-40, -48, 30), 0.6, S("sol_boom"), segs=3)
    b.rod((8, -10, 18), (40, -48, 30), 0.6, S("sol_boom"), segs=3)
    return m


def moonlet():
    R = 100.0
    m = Model("moonlet", f"{PROP_NOTE} A small grey moon: a cratered "
              "sphere (radius 100) resting on the floor, darker crater "
              "floors and pale rims.")
    b = m.part("body")
    craters = _craters(12, 18, 7, 18)

    def classify(n):
        c = _crater_at(craters, n)
        if c:
            return S("sol_moon_dark" if c == "floor" else "sol_moon_light")
        return S("sol_moon_light" if _noise(n, 3.0, 2.0) > 0.4
                 else "sol_moon")

    v = _ico(b, 4, classify, (0, 0, R), (R, R, R), _crater_disp(craters))
    _rest(v)
    return m


def icy_moon():
    R = 100.0
    m = Model("icy_moon", f"{PROP_NOTE} An icy moon like Europa: a white "
              "and cream sphere (radius 100) criss-crossed by tan-brown "
              "crack lines.")
    b = m.part("body")
    rnd = random.Random(31)

    def classify(n):
        v = _noise(n, 3.5, 5.0)
        return S("sol_ice_cream" if v > 0.3 else "sol_ice_white")

    _ico(b, 4, classify, (0, 0, R), (R, R, R))
    for k in range(10):
        ax = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1),
                     rnd.uniform(-0.5, 0.5))).normalized()
        u = ax.cross(Vector((0, 0, 1)) if abs(ax.z) < 0.9
                     else Vector((1, 0, 0))).normalized()
        v = ax.cross(u)
        off = rnd.uniform(-0.35, 0.35)
        t0 = rnd.uniform(0, TAU)
        span = rnd.uniform(1.6, 2.8)
        dirs = []
        for i in range(25):
            t = t0 + span * i / 24
            wob = 0.03 * math.sin(t * 7 + k)
            dirs.append((u * math.cos(t) + v * math.sin(t)
                         + ax * (off + wob)).normalized())
        _drape_line(b, R, (0, 0, R), dirs, 3.2 if k % 3 else 5.0, 0.5,
                    S("sol_ice_crack"))
    return m


def rocky_planet():
    R = 100.0
    m = Model("rocky_planet", f"{PROP_NOTE} A generic terrestrial planet: a "
              "light grey sphere (radius 100) with paler highlands, darker "
              "plains and a few craters; light so per-instance tints "
              "recolour it (if listed in GLB_TINTED).")
    b = m.part("body")
    craters = _craters(44, 8, 5, 10)

    def classify(n):
        c = _crater_at(craters, n)
        if c:
            return S("sol_grey_dark" if c == "floor" else "sol_grey_light")
        v = _noise(n, 2.6, 6.0)
        return S("sol_grey_dark" if v < -0.35 else
                 "sol_grey_light" if v > 0.4 else "sol_grey")

    _ico(b, 4, classify, (0, 0, R), (R, R, R),
         lambda n: 0.6 * _crater_disp(craters)(n))
    return m


def mars():
    R = 100.0
    m = Model("mars", f"{PROP_NOTE} Mars: a rust-red sphere (radius 100) "
              "with a white north polar cap on top, dark albedo markings, "
              "paler deserts and the dark gash of Valles Marineris on the "
              "camera side.")
    b = m.part("body")

    def classify(n):
        lat, lon = _latlon(n)
        if lat > 62 + 5 * math.sin(math.radians(lon * 3)):
            return S("sol_polar_cap")
        if (abs(lat - 8 - 4 * math.sin(math.radians(lon * 4))) < 3.5
                and -40 < lon < 30):
            return S("sol_mars_dark")
        v = _noise(n, 2.4, 3.0)
        if v < -0.32 and lat < 50:
            return S("sol_mars_dark")
        return S("sol_mars_light" if v > 0.35 else "sol_mars")

    _globe(b, R, lambda lat, lon: classify(_dir(lon, lat)), u=44, v=28)
    return m


def venus():
    R = 100.0
    m = Model("venus", f"{PROP_NOTE} Venus: a pale yellow sphere (radius "
              "100) wrapped in swirling cloud bands (a sideways Y pattern).")
    b = m.part("body")

    def classify(n):
        lat, lon = _latlon(n)
        w = (lat + 14 * math.sin(math.radians(lon * 1.0 + 30))
             * math.cos(math.radians(lat)) + 6 * _noise(n, 3.0, 2.0))
        band = math.sin(math.radians(w * 7))
        return S("sol_venus_light" if band > 0.45 else
                 "sol_venus_dark" if band < -0.55 else "sol_venus")

    _globe(b, R, lambda lat, lon: classify(_dir(lon, lat)), u=36, v=22)
    return m


JUP_BANDS = [(-90, "sol_jup_pole"), (-58, "sol_jup_tan"),
             (-44, "sol_jup_cream"), (-36, "sol_jup_brown"),
             (-29, "sol_jup_cream"), (-18, "sol_jup_rust"),
             (-7, "sol_jup_white"), (7, "sol_jup_rust"),
             (19, "sol_jup_cream"), (27, "sol_jup_brown"),
             (35, "sol_jup_cream"), (44, "sol_jup_tan"), (58, "sol_jup_pole")]


def _jupiter_mat(lat, lon, spot=True):
    if spot:
        # Great Red Spot: an oval at 22 S on the camera-facing meridian
        dl = (lon - 0.0) / 17.0
        dt = (lat + 22.0) / 7.5
        e = dl * dl + dt * dt
        if e < 1.0:
            return S("sol_jup_spot")
        if e < 1.6:
            return S("sol_jup_spot_rim")
    w = lat + 1.8 * math.sin(math.radians(lon * 3 + lat * 5))
    name = JUP_BANDS[0][1]
    for start, key in JUP_BANDS:
        if w >= start:
            name = key
    return S(name)


def _decal(p, R, centre, n, e1, e2, rings, segs=24, shape=None):
    """Oval patch draped on a sphere of radius R centred at `centre`, round
    the surface direction n (tangents e1, e2). rings: [(rx, ry, lift,
    material)] from the middle outwards (rx, ry in units along the
    surface)."""
    c = Vector(centre)
    rows = [[tuple(c + n * (R + rings[0][2]))]]
    for rx, ry, h, _ in rings:
        row = []
        for k in range(segs):
            a = TAU * k / segs
            sx, sy = shape(a) if shape else (math.cos(a), math.sin(a))
            d = (n + e1 * (rx * sx / R) + e2 * (ry * sy / R)).normalized()
            row.append(tuple(c + d * (R + h)))
        rows.append(row)
    faces = _surface(p, rows,
                     lambda i, j, cc: rings[min(i, len(rings) - 1)][3],
                     wrap=True, orient="up")
    nw = (p._stack[-1].to_3x3() @ n).normalized()
    for f in faces:  # face the way the surface does, one by one
        f.normal_update()
        if f.normal.dot(nw) < 0:
            f.normal_flip()


def _drape_line(p, R, centre, dirs, width, lift, material):
    """Thin strip draped on a sphere along unit directions `dirs`."""
    c = Vector(centre)
    rows = []
    for i, d in enumerate(dirs):
        t = (dirs[min(i + 1, len(dirs) - 1)] - dirs[max(i - 1, 0)])
        side = d.cross(t).normalized() * (width / 2 / R)
        rows.append([tuple(c + (d + side).normalized() * (R + lift)),
                     tuple(c + (d - side).normalized() * (R + lift))])
    _surface(p, rows, lambda i, j, cc: material, orient="recalc")


def jupiter():
    R = 100.0
    m = Model("jupiter", f"{PROP_NOTE} Jupiter: a banded sphere (radius 100; "
              "cream zones, rust and brown belts, greyish poles) with the "
              "Great Red Spot; the axis is tipped 42 deg back (away from the "
              "camera) so the bands run across the face the camera sees and "
              "the Red Spot sits just below its middle.")
    b = m.part("body")
    _globe(b, R, lambda lat, lon: _jupiter_mat(lat, lon, spot=False),
           u=48, v=30, tilt=-42)
    rot = Matrix.Rotation(math.radians(-42), 3, "X")
    n = (rot @ _dir(0, -22)).normalized()
    e1 = Vector((1, 0, 0))
    e2 = n.cross(e1).normalized()
    _decal(b, R, (0, 0, R), n, e1, e2,
           [(12, 6, 1.2, S("sol_jup_spot")), (20, 10.5, 1.0,
                                                S("sol_jup_spot")),
            (25, 14, 0.6, S("sol_jup_spot_rim")),
            (28, 16.5, -0.6, S("sol_jup_spot_rim"))])
    return m


def saturn():
    R = 100.0
    m = Model("saturn", f"{PROP_NOTE} Saturn: a pale gold banded sphere "
              "(radius 100) with a flat ring system in the XZ plane round "
              "its equator (C ring 124-152, B ring 153-195, Cassini gap, A "
              "ring 203-228).")
    b = m.part("body")
    bands = [(-90, "sol_sat_pole"), (-50, "sol_sat_dark"), (-36, "sol_sat"),
             (-22, "sol_sat_dark"), (-10, "sol_sat_light"),
             (10, "sol_sat_dark"), (22, "sol_sat"), (36, "sol_sat_dark"),
             (50, "sol_sat_light"), (64, "sol_sat_pole")]

    def classify(lat, lon):
        w = lat + 1.2 * math.sin(math.radians(lon * 4))
        name = bands[0][1]
        for start, key in bands:
            if w >= start:
                name = key
        return S(name)

    _globe(b, R, classify, u=40, v=26)
    for r0, r1, key in ((124, 152, "sol_ring_c"), (153, 172, "sol_ring_b"),
                        (172, 195, "sol_ring_b2"), (203, 228, "sol_ring_a")):
        b.band(r0, r1, R - 0.8, R + 0.8, 0, 360, S(key), segs=64)
    return m


def ice_giant():
    R = 100.0
    m = Model("ice_giant", f"{PROP_NOTE} An ice giant (Uranus / Neptune): a "
              "smooth cyan sphere (radius 100) with faint paler and darker "
              "bands and one thin, faint flat ring (r 150-158).")
    b = m.part("body")

    def classify(lat, lon):
        w = lat + 2 * math.sin(math.radians(lon * 2))
        if 18 < w < 26 or -34 < w < -28:
            return S("sol_ice_giant_light")
        if abs(w) > 66:
            return S("sol_ice_giant_light")
        if -12 < w < -4:
            return S("sol_ice_giant_dark")
        return S("sol_ice_giant")

    _globe(b, R, classify, u=36, v=22)
    b.band(150, 158, R - 0.6, R + 0.6, 0, 360, S("sol_ice_ring"), segs=56)
    return m


def dwarf_planet():
    R = 100.0
    m = Model("dwarf_planet", f"{PROP_NOTE} Pluto: a tan sphere (radius 100) "
              "with a dark reddish-brown equatorial belt and the pale "
              "heart (Tombaugh Regio) on the camera side.")
    b = m.part("body")
    hc = _dir(0, 30)  # heart centre, facing the camera
    e1 = Vector((1, 0, 0))
    e2 = hc.cross(e1).normalized()

    def classify(n):
        lat, lon = _latlon(n)
        v = _noise(n, 3.0, 8.0)
        if abs(lat + 4 * math.sin(math.radians(lon * 2))) < 16 and v > -0.3 \
                and not (-60 < lon < 40):
            return S("sol_pluto_dark")
        if -18 < lat < -2 and -100 < lon < -45:
            return S("sol_pluto_dark")
        return S("sol_pluto_light" if v > 0.35 else "sol_pluto")

    _globe(b, R, lambda lat, lon: classify(_dir(lon, lat)), u=44, v=28)

    def heart(a):
        return (math.sin(a) ** 3,
                (13 * math.cos(a) - 5 * math.cos(2 * a) - 2 * math.cos(3 * a)
                 - math.cos(4 * a)) / 16 + 0.15)

    _decal(b, R, (0, 0, R), hc, e1, e2,
           [(14, 14, 1.2, S("sol_pluto_heart")),
            (28, 28, 1.2, S("sol_pluto_heart")),
            (42, 42, 1.2, S("sol_pluto_heart")),
            (45, 45, -0.8, S("sol_pluto_heart"))], segs=40, shape=heart)
    return m


def prominence():
    m = Model("prominence", f"{PROP_NOTE} A chip of the Sun: a twisted "
              "plasma arc (yellow, orange and red strands) rooted in a "
              "glowing orange patch, spanning X.")
    b = m.part("body")
    b.cyl(60, 3, (0, 0, 1.5), S("sol_plasma_orange"), segs=16,
          scale=(1, 0.45, 1))
    b.cyl(40, 1.6, (0, 0, 3.2), S("sol_plasma_yellow"), segs=14,
          scale=(1, 0.4, 1))
    _flux(b, _arch((-46, 0, 2), (46, 0, 2), 70, 20, bulge=(0, -8, 0)), 3,
          lambda s: 6.0, lambda s: 6.5 - 1.5 * math.sin(math.pi * s), 1.4,
          [S("sol_plasma_yellow"), S("sol_plasma_orange"),
           S("sol_plasma_red")], segs=6)
    return m


HAZARDS = [rogue_asteroid, comet, sunspot, sungrazer, solar_flare, the_sun]
PROPS = [asteroid, asteroid_cluster, comet_nucleus, voyager_1, moonlet,
         icy_moon, rocky_planet, mars, venus, jupiter, saturn, ice_giant,
         dwarf_planet, prominence]
