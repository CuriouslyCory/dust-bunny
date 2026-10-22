"""Continent models (Act 5): weather hazards, the Ice Sheet boss and
continental Debris (icebergs, mountain ranges, lakes, city ruins, mesas,
forests).

Scale: unlike the other modules, 1 Blender unit = 100 m here. One Continent
world unit is 10 km = 100 BU, so the game loads these files at scale 0.01
(manifest.json "scale": 0.01). Everything else follows the shared conventions:
X right, -Y forward (exported as glTF +Z), Z up, origin at the bottom centre
where the model touches the ground.

Most shapes are terrain-like surfaces built from rows of points (_surface), so
they read from the high, nearly top-down game camera: colour is assigned per
face from height, slope or a pattern.
"""

import math
import random

import bmesh
from mathutils import Vector

from common import M, Model, polar

UNITS = "100 m"
SCALE_NOTE = "Continent scale: 1 unit = 100 m, load at scale 0.01."
TAU = 2 * math.pi


# --------------------------------------------------------------------------
# Shared helpers
# --------------------------------------------------------------------------

def _wave(x, y, s=0.0):
    """Smooth deterministic pseudo-noise in about [-1, 1]."""
    return (0.5 * math.sin(1.7 * x + 0.9 * y + 2.1 * s)
            + 0.3 * math.sin(-1.1 * x + 2.3 * y + 3.7 * s)
            + 0.2 * math.sin(3.1 * x - 2.7 * y + 5.3 * s))


def _surface(p, rows, mat_fn, wrap=False, orient="up", cap_first=False):
    """Skin consecutive rows of points into quads (a row of one point is a
    pole). mat_fn(i, j, centre) picks each face's material. Normals:
    "up" flips the whole sheet so it faces +Z on balance; "recalc" lets bmesh
    orient a closed shell (use cap_first to close the first row)."""
    bm, mx = p.bm, p._stack[-1]
    vs = [[bm.verts.new(mx @ Vector(pt)) for pt in row] for row in rows]
    faces = []
    for i in range(len(rows) - 1):
        ra, rb, pa, pb = vs[i], vs[i + 1], rows[i], rows[i + 1]
        n = max(len(ra), len(rb))
        for j in range(n if wrap else n - 1):
            j2 = (j + 1) % n
            if len(ra) == 1:
                fv, pts = (ra[0], rb[j], rb[j2]), (pa[0], pb[j], pb[j2])
            elif len(rb) == 1:
                fv, pts = (ra[j], ra[j2], rb[0]), (pa[j], pa[j2], pb[0])
            else:
                fv = (ra[j], ra[j2], rb[j2], rb[j])
                pts = (pa[j], pa[j2], pb[j2], pb[j])
            f = bm.faces.new(fv)
            c = tuple(sum(q[k] for q in pts) / len(pts) for k in range(3))
            f.material_index = p._slot(mat_fn(i, j, c))
            faces.append(f)
    if cap_first and len(vs[0]) > 2:
        f = bm.faces.new(list(reversed(vs[0])))
        f.material_index = faces[0].material_index
        faces.append(f)
    if orient == "recalc":
        bmesh.ops.recalc_face_normals(bm, faces=faces)
    else:
        s = 0.0
        for f in faces:
            f.normal_update()
            s += f.normal.z * f.calc_area()
        if s < 0:
            bmesh.ops.reverse_faces(bm, faces=faces)
    return faces


def _rock(p, center, r, mat, seed, scale=(1.0, 1.0, 0.6)):
    """Faceted boulder: a jittered icosahedron."""
    rnd = random.Random(seed)
    rot = (rnd.uniform(0, 40), rnd.uniform(0, 40), rnd.uniform(0, 360))
    res = bmesh.ops.create_icosphere(p.bm, subdivisions=1, radius=r,
                                     matrix=p._m(center, rot, scale))
    c = Vector(center)
    for v in res["verts"]:
        v.co = c + (v.co - c) * rnd.uniform(0.8, 1.15)
    low = min(v.co.z for v in res["verts"])
    if low < 0:  # never poke through the ground
        for v in res["verts"]:
            v.co.z -= low
    return p._finish(res["verts"], mat)


def _bolt(p, pts, r, mat):
    """Zigzag lightning bolt through `pts`."""
    for a, b in zip(pts, pts[1:]):
        p.rod(a, b, r, mat, segs=4)


def _berg(p, cx, cy, r, h, seed, n=9):
    """Jagged ice block standing on z = 0, centred on (cx, cy): dirty blue
    waterline, faceted white/blue sides, tilted top with an off-centre peak."""
    rnd = random.Random(seed)
    radii = [r * rnd.uniform(0.72, 1.0) for _ in range(n)]
    angs = [360 * k / n + rnd.uniform(-12, 12) for k in range(n)]
    tilt = rnd.uniform(0, 360)
    rows = []
    for scale, zf in ((1.0, 0.0), (1.03, 0.08), (1.06, 0.4), (0.93, 0.8),
                      (0.58, 1.0)):
        row = []
        for k in range(n):
            jag = rnd.uniform(0.86, 1.1) if zf else 1.0
            x, y, _ = polar(angs[k], radii[k] * scale * jag)
            lean = 1 + 0.12 * math.cos(math.radians(angs[k] - tilt)) * zf
            row.append((cx + x, cy + y, h * zf * lean * rnd.uniform(0.93, 1.0)
                        if zf else 0.0))
        rows.append(row)
    px, py, _ = polar(tilt, r * 0.2)
    rows.append([(cx + px, cy + py, h * 1.12)])

    def mat_fn(i, j, c):
        if i == 0:
            return M("ice_deep")
        if i >= 3:
            return M("ice_white")
        return M("ice_blue" if (i + j) % 2 else "ice_white")

    _surface(p, rows, mat_fn, wrap=True, orient="recalc", cap_first=True)


def _polar_rows(spec, segs, outline, jitter=None):
    """Rows for a polar surface: spec is [(radius scale or 0 for a pole, z)];
    outline(a_deg) gives the base radius per angle; jitter(a_deg, i) an
    optional extra radius factor."""
    rows = []
    for i, (s, z) in enumerate(spec):
        if s <= 0:
            rows.append([(0.0, 0.0, z)])
            continue
        row = []
        for j in range(segs):
            a = 360 * j / segs
            f = jitter(a, i) if jitter else 1.0
            x, y, _ = polar(a, outline(a) * s * f)
            row.append((x, y, z))
        rows.append(row)
    return rows


# --------------------------------------------------------------------------
# Hazards (weather: the planet has run out of machines)
# --------------------------------------------------------------------------

def tornado():
    H = 400.0
    m = Model("tornado",
              f"{SCALE_NOTE} Wanderer that pulls. Twisting funnel under a "
              "wall-cloud cap (r 130); the funnel node (funnel, cap, flying "
              "debris and a lightning bolt) spins about its local Y axis "
              "through the origin (positive = counter-clockwise from above). "
              "Static debris skirt and dust puffs (r 150) in body.")
    f = m.part("funnel")
    segs = 20
    rows = []
    n = 22
    for i in range(n + 1):
        t = i / n
        rows.append((12 + 78 * t ** 2.2, H * t, 2.6 * math.pi * t,
                     16 * math.sin(math.pi * t)))
    cap = [(112, H + 5), (124, H + 18), (113, H + 32), (84, H + 42),
           (45, H + 47)]
    for k, (r, z) in enumerate(cap):
        rows.append((r, z, 2.6 * math.pi + 0.45 * (k + 1), 0.0))
    pts = []
    for (r, z, tw, bend) in rows:
        row = []
        for j in range(segs):
            a = TAU * j / segs
            lump = 1 + 0.14 * math.sin(3 * a)
            if z > H:
                lump *= 1 + 0.06 * math.sin(5 * a + z * 0.1)
            ang = a + tw
            row.append((bend * 0.8 + r * lump * math.sin(ang),
                        bend * 0.6 - r * lump * math.cos(ang), z))
        pts.append(row)
    pts.append([(0.0, 0.0, H + 49)])
    nf = n

    def funnel_mat(i, j, c):
        stripe = math.sin(3 * TAU * (j + 0.5) / segs) > 0.35
        if i >= nf:  # cap
            return M("cloud_dark" if stripe else "cloud_grey")
        if c[2] < 0.3 * H:
            return M("moraine_dark" if stripe else "storm_dust")
        return M("cloud_dark" if stripe else "cloud_grey")

    _surface(f, pts, funnel_mat, wrap=True, orient="recalc", cap_first=True)
    # debris caught in the vortex
    rnd = random.Random(7)
    for k in range(10):
        t = 0.08 + 0.07 * k
        r = 12 + 78 * t ** 2.2 + rnd.uniform(10, 18)
        x, y, _ = polar(k * 137.5, r)
        _rock(f, (x, y, H * t), rnd.uniform(3, 6),
              M(("storm_dust", "bark", "roof_grey")[k % 3]), seed=k,
              scale=(1.3, 0.8, 0.6))
    _bolt(f, [(112, -30, H + 2), (100, -42, H - 40), (122, -50, H - 70),
              (108, -64, H - 110), (126, -70, H - 150)], 2.0,
          M("glow_lightning"))

    b = m.part("body")
    spec = [(14, 0), (24, 14), (45, 30), (75, 26), (110, 12), (150, 0)]
    sk = []
    for (r, z) in spec:
        row = []
        for j in range(32):
            a = 360 * j / 32
            ar = math.radians(a)
            w = _wave(ar * 3, r / 20)
            rr = r * (1 + 0.06 * w) if r < 150 else r * (0.94 + 0.06 * w)
            x, y, _ = polar(a, rr)
            row.append((x, y, max(0.0, z * (1 + 0.35 * w))))
        sk.append(row)
    _surface(b, sk, lambda i, j, c: M(
        "dust" if _wave(c[0] / 30, c[1] / 30) > 0.2 else "storm_dust"),
        wrap=True)
    for k in range(10):
        r = 60 + 40 * ((k * 0.37) % 1)
        x, y, _ = polar(k * 36 + 10, r)
        rad = 18 + 8 * ((k * 0.61) % 1)
        b.sphere(rad, (x, y, rad * 0.55),
                 M("storm_dust" if k % 2 else "dust"), u=8, v=5,
                 scale=(1.3, 1.0, 0.55), rot=(0, 0, k * 36))
    return m


def glacier_tongue():
    m = Model("glacier_tongue",
              f"{SCALE_NOTE} Lane patrol: moves along its long axis (+Z). "
              "Tongue of ice about 230 long x 80 wide (246 x 100 with the "
              "terminal moraine) with curved transverse "
              "crevasses, lateral and medial moraine stripes, and a "
              "terminal moraine of rubble at the snout (+Z end).")
    b = m.part("body")
    BACK, FRONT = 118.0, -112.0

    def hw(y):
        w = 36 + 4 * (y - FRONT) / (BACK - FRONT)
        for end, cap in ((FRONT, 30.0), (BACK, 26.0)):
            d = abs(y - end)
            if d < cap:
                w *= math.sqrt(max(0.02, 1 - ((cap - d) / cap) ** 2))
        return w

    def thick(y):
        t = 9 + 7 * (y - FRONT) / (BACK - FRONT)
        for end, cap in ((FRONT, 16.0), (BACK, 24.0)):
            d = abs(y - end)
            if d < cap:
                t *= math.sqrt(max(0.0, 1 - ((cap - d) / cap) ** 2))
        return t

    us = [-1, -0.9, -0.78, -0.55, -0.3, -0.06, 0.06, 0.3, 0.55, 0.78, 0.9,
          1]
    # rows back -> front; crevasses are thin rows (edge, floor, edge)
    rows = []  # (y0, crevasse span or None)
    for d in (0, 5, 11, 18):
        rows.append((BACK - d, None))
    y = BACK - 28
    rnd = random.Random(25)
    while y > FRONT + 26:
        lo, hi = sorted((rnd.uniform(-0.85, -0.2), rnd.uniform(0.2, 0.85)))
        span = (lo, hi)
        rows += [(y, None), (y - 1.6, span), (y - 3.2, None)]
        y -= 3.2 + rnd.uniform(7, 12)
    for d in (26, 18, 11, 5, 2, 0):
        rows.append((FRONT + d, None))
    pts, spans = [], []
    for (y0, span) in rows:
        bow = 10 * max(0.0, min(1.0, (BACK - 30 - abs(y0)) / 20))
        row = []
        for u in us:
            yy = y0 - bow * (1 - u * u)
            z = thick(yy) * max(0.0, 1 - abs(u) ** 2.5) ** 0.6
            z += 0.8 * _wave(u * 3, yy / 20) * (1 - abs(u) ** 4)
            if span and span[0] <= u <= span[1]:
                z -= 3.5
            row.append((u * hw(yy), yy, max(0.0, z)))
        pts.append(row)
        spans.append(span)

    def mat_fn(i, j, c):
        u0, u1 = us[j], us[j + 1]
        span = spans[i] or spans[i + 1]
        if span and span[0] <= u0 and u1 <= span[1]:
            return M("ice_deep")
        if j in (0, len(us) - 2):
            return M("moraine")
        if j == 5:
            return M("moraine_dark")
        if c[1] < FRONT + 20:
            return M("ice_blue")
        return M("ice_blue" if _wave(c[0] / 12, c[1] / 18) > 0.55
                 else "ice_white")

    _surface(b, pts, mat_fn)
    # terminal moraine: a low rubble ridge hugging the snout, plus boulders
    ridge = []
    for d, z in ((-4, 2.0), (4, 6.0), (12, 0.0)):
        row = []
        for k in range(17):
            a = -95 + 190 * k / 16
            r = 30 + d
            x, y2, _ = polar(a, r)
            zz = z * (1 - (abs(a) / 95) ** 4) * (1 + 0.3 * math.sin(k * 2.1))
            row.append((x * 1.2, FRONT + 26 + y2, zz))
        ridge.append(row)
    _surface(b, ridge, lambda i, j, c: M("moraine_dark" if j % 3 == 0
                                         else "moraine"))
    for k in range(14):
        a = -80 + 160 * k / 13
        x, y2, _ = polar(a, 34 + 4 * math.sin(k * 1.7))
        _rock(b, (x * 1.2, FRONT + 26 + y2, 2.0), 4 + 2.5 * ((k * 0.43) % 1),
              M("moraine_dark" if k % 2 else "rock_grey"), seed=100 + k)
    return m


def volcano():
    H, RIM, R = 110.0, 34.0, 200.0
    VENT = H - 14
    m = Model("volcano",
              f"{SCALE_NOTE} Turret that fires. Cone with a breached rim, "
              "glowing lava streaks down the flanks and a lava pool in the "
              "crater: the crater node (emissive) sits at the vent, so "
              "projectiles launch from about (0, "
              f"{VENT:g}, 0) in model space (upwards out of the crater).")
    b = m.part("body")
    segs = 36
    radii = [200, 186, 170, 152, 132, 112, 94, 78, 64, 52, 43, 37, RIM]
    inner = [(31, H - 3), (26, H - 10), (21, VENT - 2)]
    streaks = {3: 150, 12: 96, 20: 128, 29: 82}
    rows = []
    for r in radii:
        t = (r - RIM) / (R - RIM)
        z = H * (1 - t) ** 1.7
        row = []
        for j in range(segs):
            a = 360 * j / segs
            ar = math.radians(a)
            gully = 1 + 0.06 * math.sin(9 * ar + 0.7) * min(1.0, t * 3)
            rr = r * (1 + 0.035 * _wave(ar * 2, t * 4)) if r < R else r
            zz = z * gully
            if r == RIM and j in streaks:
                zz -= 5
            x, y, _ = polar(a, rr)
            row.append((x, y, zz if r < R else 0.0))
        rows.append(row)
    for r, z in inner:
        rows.append([polar(360 * j / segs, r, z) for j in range(segs)])
    rows.append([(0.0, 0.0, VENT - 3)])
    n_out = len(radii) - 1

    def mat_fn(i, j, c):
        rc = math.hypot(c[0], c[1])
        if i >= n_out:
            return M("lava_flow" if i >= n_out + 2 else "lava_crust")
        for j0, low in streaks.items():
            col = (j0 + (1 if (rc // 34) % 2 else 0)) % segs
            if j == col and rc < low:
                return M("lava_flow")
        if rc > 176:
            return M("foothill_green")
        if rc > 122:
            return M("ash_brown")
        return M("basalt")

    _surface(b, rows, mat_fn, wrap=True, orient="recalc", cap_first=True)
    c = m.part("crater", pivot=(0, 0, VENT))
    c.cyl(22.5, 2.0, (0, 0, VENT - 0.5), M("lava_glow"), segs=18)
    for k in range(4):
        x, y, _ = polar(k * 97 + 20, 6 + 3 * k)
        c.sphere(2.6 + 0.6 * k, (x, y, VENT + 0.6), M("lava_glow"), u=8, v=4,
                 scale=(1, 1, 0.6))
    return m


def river_surge():
    m = Model("river_surge",
              f"{SCALE_NOTE} Trail-layer that leaves a wet trail. Flood-surge "
              "head moving +Z: a curling brown wave front with a foam crest "
              "along the leading edge, churning muddy water with blue streaks "
              "and floating logs behind (the trail continues from the -Z "
              "end).")
    b = m.part("body")
    W = 110.0
    us = [-1 + 2 * k / 20 for k in range(21)]
    vs = [0, 0.03, 0.07, 0.11, 0.16, 0.22, 0.3, 0.38, 0.47, 0.56, 0.65, 0.74,
          0.83, 0.91, 1.0]
    prof = [0, 9, 15, 13, 9, 7, 7.5, 6, 5.5, 5, 4.5, 4, 3, 1.5, 0]
    rows = []
    for v, zp in zip(vs, prof):
        row = []
        for u in us:
            yf = -95 + 28 * u * u
            yb = 95 - 15 * u * u
            y = yf + (yb - yf) * v
            x = u * W * (1 - 0.3 * v)
            e = 1 - abs(u) ** 4
            z = zp * (0.35 + 0.65 * e) * e
            if 0 < v < 1 and abs(u) < 1:
                z += 2.5 * _wave(u * 6, v * 10) * min(1.0, z / 3)
            row.append((x, y, max(0.0, z)))
        rows.append(row)

    def mat_fn(i, j, c):
        v = vs[i]
        u = (us[j] + us[j + 1]) / 2
        if v < 0.11:
            return M("foam")
        if v < 0.22:
            return M("silt" if _wave(u * 7, v * 20) < 0.4 else "foam")
        # flow streaks: continuous along the direction of travel
        w = math.sin(u * 8 + 0.6 * math.sin(v * 6))
        if w > 0.8:
            return M("silt")
        if w < -0.88:
            return M("flood_blue")
        return M("mud_brown")

    _surface(b, rows, mat_fn)
    for k in range(11):
        u = -0.82 + 1.64 * k / 10
        y = -95 + 28 * u * u + 190 * 0.07
        z = 15 * (0.35 + 0.65 * (1 - abs(u) ** 4)) * (1 - abs(u) ** 4)
        b.sphere(6 + 2.5 * ((k * 0.57) % 1), (u * W * 0.98, y - 2, z),
                 M("foam"), u=8, v=4, scale=(1.4, 1.0, 0.6), rot=(0, 0, k * 23))
    for k in range(6):
        u = -0.6 + 1.2 * ((k * 0.37) % 1)
        v = 0.3 + 0.1 * k
        y = -95 + 28 * u * u + (190 - 43 * u * u) * v
        b.box((14, 2.2, 2.2), (u * W * (1 - 0.3 * v), y, 6.2 - 0.4 * k),
              M("bark"), rot=(0, 0, k * 47 + 10))
    return m


def hurricane():
    R, EYE = 300.0, 38.0
    m = Model("hurricane",
              f"{SCALE_NOTE} Cone blaster. Flat spiral cloud bands (r 300) "
              "around a clear eye (r 38, open to the ground). bands node "
              "(dense overcast, four spiral arms, lightning) spins about its "
              "local Y axis through the origin (positive = counter-clockwise "
              "from above, the way the arms trail). body is the eyewall. The "
              "wind cone blows +Z from the front of the eyewall at about "
              "(0, 20, 60) in model space.")
    b = m.part("body")
    segs = 40
    spec = [(EYE, 1), (42, 18), (48, 30), (56, 37), (66, 38), (78, 32)]
    rows = [[polar(360 * j / segs, r * (1 + 0.03 * math.sin(j * 1.9)),
                   z * (1 + 0.06 * _wave(j * 0.7, r)))
             for j in range(segs)] for r, z in spec]
    _surface(b, rows, lambda i, j, c: M(
        ("cloud_dark", "cloud_grey", "cloud_grey")[i] if i < 3
        else "cloud_white"), wrap=True)
    _bolt(b, [(-30, -48, 38.6), (-18, -54, 38.8), (-22, -60, 38.6),
              (-8, -66, 38.4)], 1.2, M("glow_lightning"))
    _bolt(b, [(44, 30, 38.4), (50, 20, 38.8), (56, 24, 38.6),
              (62, 12, 37.8)], 1.2, M("glow_lightning"))

    bd = m.part("bands")
    K = 190.0 / math.log(290 / 120)  # degrees of spiral per ln(r)

    def groove(a_deg, r):
        return math.sin(math.radians(4 * (a_deg + K * math.log(r / 70))))

    segs = 56
    cdo = [70, 85, 100, 115, 130, 145, 160, 175]
    rows = []
    for r in cdo:
        base = 34 - 26 * ((r - 70) / 105) ** 1.5
        row = []
        for j in range(segs):
            a = 360 * j / segs
            rr = r * (1 + 0.04 * groove(a, r)) if r < 175 else r * (
                1 + 0.06 * groove(a, r))
            z = base + (3.5 * groove(a, r) if r < 175 else 0)
            row.append(polar(a, rr, max(2.0, z)))
        rows.append(row)

    def cdo_mat(i, j, c):
        a = math.degrees(math.atan2(c[0], -c[1]))
        r = math.hypot(c[0], c[1])
        g = groove(a, r)
        if g < -0.45:
            return M("cloud_grey")
        return M("cloud_white")

    _surface(bd, rows, cdo_mat, wrap=True)
    across = [(-1, 0.1), (-0.5, 0.75), (0, 1.0), (0.5, 0.75), (1, 0.1)]
    for arm in range(4):
        a0 = arm * 90 + 20
        rows = []
        n = 24
        for i in range(n + 1):
            t = i / n
            r = 120 * (290 / 120) ** t
            a = a0 - K * math.log(r / 120)
            w = 44 * math.sqrt(max(0.0, 1 - t)) * min(1.0, 0.5 + t * 3) + 4
            top = 20 * (1 - t) + 5 + 2.5 * _wave(t * 9, arm)
            row = []
            for s, zf in across:
                x, y, _ = polar(a, r + s * w / 2)
                row.append((x, y, max(1.5, top * zf)))
            rows.append(row)
        _surface(bd, rows, lambda i, j, c: M(
            "cloud_white" if j in (1, 2) and i < 20 else "cloud_grey"))
    for k, (a, r) in enumerate(((35, 110), (160, 140), (260, 95))):
        pts = []
        for q in range(4):
            x, y, _ = polar(a + q * 4 + (6 if q % 2 else 0), r + q * 7)
            base = 34 - 26 * ((r + q * 7 - 70) / 105) ** 1.5
            pts.append((x, y, base + 4.5))
        _bolt(bd, pts, 1.4, M("glow_lightning"))
    return m


def ice_sheet():
    m = Model("ice_sheet",
              f"{SCALE_NOTE} Boss. A slab of continental ice 600 wide "
              "pushing a bulldozed ridge of rubble at its front (+Z) cliff. "
              "Cracked blue-white surface; crevasses glow faintly "
              "(emissive); two glowing crevasse eyes with pressure-ridge "
              "brows near the front edge and a glowing crack mouth along the "
              "cliff. calving_l / calving_r are ice chunks at the front "
              "corners; their origin is their base centre on the ground, so "
              "they can tip or slide off when they calve.")
    b = m.part("body")
    HW, HD, OFF, H = 300.0, 185.0, 15.0, 55.0

    def sheet(u, v):
        x = HW * u * math.sqrt(1 - 0.3 * v * v)
        y = HD * v * math.sqrt(1 - 0.3 * u * u) + OFF
        es = max(0.0, 1 - abs(u)) / 0.16
        eb = max(0.0, 1 - v) / 0.25
        ef = max(0.0, 1 + v) / 0.014
        z = H * (0.72 + 0.28 * (v + 1) / 2) * (0.92 + 0.08 * (1 - u * u))
        z *= min(1.0, es) ** 0.5 * min(1.0, eb) ** 0.5 * min(1.0, ef) ** 0.8
        if z > 0:
            z += 1.5 * _wave(u * 6, v * 5) * min(1.0, es, eb)
        return (x, y, max(0.0, z))

    us = ([-1, -0.97, -0.92, -0.85] + [-0.85 + 1.7 * k / 22
                                       for k in range(1, 22)]
          + [0.85, 0.92, 0.97, 1])
    vs = ([-1, -0.99, -0.975, -0.95, -0.9] + [-0.9 + 1.6 * k / 15
                                              for k in range(1, 16)]
          + [0.82, 0.92, 0.97, 1])
    vs = sorted(set(round(v, 4) for v in vs))
    rows = [[sheet(u, v) for u in us] for v in vs]

    # crack network in (u, v), mostly running back from the front edge
    rnd = random.Random(55)
    cracks = []
    for u0 in (-0.8, -0.55, -0.36, 0.0, 0.4, 0.6, 0.83):
        pts = [(u0, -0.985)]
        u, v = u0, -0.985
        for _ in range(rnd.randint(4, 7)):
            u += rnd.uniform(-0.07, 0.07)
            v += rnd.uniform(0.1, 0.16)
            if v > 0.9:
                break
            pts.append((u, v))
        cracks.append(pts)
    for (u0, v0, u1, v1) in ((-0.7, 0.2, -0.2, 0.35), (0.15, 0.45, 0.65, 0.3),
                             (-0.45, 0.6, 0.05, 0.7), (0.3, -0.3, 0.75, -0.2),
                             (-0.75, -0.35, -0.4, -0.15)):
        cracks.append([(u0 + (u1 - u0) * k / 3,
                        v0 + (v1 - v0) * k / 3 + 0.03 * math.sin(k * 2.3))
                       for k in range(4)])
    segs3 = []
    for pts in cracks:
        for (ua, va), (ub, vb) in zip(pts, pts[1:]):
            segs3.append((sheet(ua, va), sheet(ub, vb)))

    def mat_fn(i, j, c):
        if i <= 1:
            return M("ice_blue")  # front cliff
        if c[2] < 6:
            return M("ice_blue")
        return M("ice_white")

    _surface(b, rows, mat_fn)
    for a, bb in segs3:
        b.rod((a[0], a[1], a[2] + 0.6), (bb[0], bb[1], bb[2] + 0.6), 3.4,
              M("crevasse_glow"), segs=4)

    # face: glowing crevasse eyes, pressure-ridge brows, cracked mouth
    for sx in (-1, 1):
        ex, ey, ez = sheet(sx * 0.2, -0.83)
        lens = [(math.cos(TAU * k / 12) * 42,
                 math.sin(TAU * k / 12) * 15 * (1 - 0.25 * math.cos(
                     TAU * k / 12) * sx)) for k in range(12)]
        b.prism([(x * 1.18, y * 1.35) for x, y in lens], 6,
                (ex, ey, ez - 2.6), M("ice_deep"), rot=(0, 0, sx * 14))
        b.prism(lens, 6, (ex, ey, ez - 2.2), M("glow_ice"),
                rot=(0, 0, sx * 14))
        b.prism([(x * 0.2, y * 0.8) for x, y in lens], 6,
                (ex - sx * 4, ey - 2, ez - 1.6), M("ice_deep"),
                rot=(0, 0, sx * 14))
        bx, by, bz = sheet(sx * 0.22, -0.6)
        b.box((96, 13, 8), (bx, by, bz + 1.0), M("ice_deep"), bevel=2.0,
              rot=(0, 0, sx * 16))
    mouth = []
    for k in range(13):
        u = -0.42 + 0.84 * k / 12
        x, y, _ = sheet(u, -1)
        mouth.append((x, y - 0.8, 16 if k % 2 else 22))
    _bolt(b, mouth, 2.4, M("crevasse_glow"))

    # bulldozed rubble ridge in front of the cliff
    ridge = []
    for d, z in ((-2, 9.0), (8, 15.0), (18, 10.0), (32, 0.0)):
        row = []
        for k in range(29):
            u = -0.95 + 1.9 * k / 28
            x0, y0, _ = sheet(u - 0.01, -1)
            x1, y1, _ = sheet(u + 0.01, -1)
            tx, ty = x1 - x0, y1 - y0
            L = math.hypot(tx, ty) or 1.0
            nx, ny = ty / L, -tx / L  # outward (front) normal
            xc, yc, _ = sheet(u, -1)
            taper = 1 - (abs(u) / 0.95) ** 6
            zz = z * taper * (1 + 0.25 * _wave(u * 11, d * 0.2))
            row.append((xc + nx * d, yc + ny * d, max(0.0, zz)))
        ridge.append(row)

    def ridge_mat(i, j, c):
        w = _wave(c[0] / 25, c[1] / 10)
        if w > 0.55:
            return M("forest_mid")
        if w < -0.5:
            return M("ruin_grey")
        return M("moraine" if j % 2 else "rock_brown")

    _surface(b, ridge, ridge_mat)
    for k in range(12):
        u = -0.8 + 1.6 * k / 11
        xc, yc, _ = sheet(u, -1)
        _rock(b, (xc, yc - 12 - 10 * ((k * 0.41) % 1), 9),
              4 + 3 * ((k * 0.67) % 1),
              M(("moraine_dark", "rock_grey", "rock_brown")[k % 3]),
              seed=300 + k)

    # calving chunks at the front corners (pivot at their base centre)
    for name, sx in (("calving_l", -1), ("calving_r", 1)):
        cx, cy = sx * 232.0, -122.0
        p = m.part(name, pivot=(cx, cy, 0))
        p.smooth_angle = math.radians(12)
        _berg(p, cx, cy, 50, 56, seed=11 if sx < 0 else 12)
    return m


# --------------------------------------------------------------------------
# Debris props (absorbable)
# --------------------------------------------------------------------------

def iceberg():
    m = Model("iceberg",
              f"{SCALE_NOTE} Chip that calves off the Ice Sheet: jagged ice "
              "block with a dirty blue base and a smaller chunk beside it.")
    b = m.part("body")
    b.smooth_angle = math.radians(12)
    _berg(b, -4, 2, 32, 30, seed=3)
    _berg(b, 24, -20, 12, 13, seed=4, n=7)
    return m


def mountain_range():
    m = Model("mountain_range",
              f"{SCALE_NOTE} Elongated ridge of peaks, long axis along X: "
              "green foothills, brown and grey rock, snow caps above about "
              "22 units.")
    b = m.part("body")
    L, WD = 92.0, 30.0
    peaks = [(-0.78, 18, 0.12), (-0.55, 30, 0.13), (-0.3, 24, 0.1),
             (-0.08, 40, 0.14), (0.15, 30, 0.1), (0.38, 36, 0.12),
             (0.62, 26, 0.11), (0.82, 16, 0.1)]
    nu, nv = 56, 14
    rows = []
    for i in range(nv + 1):
        s = -1 + 2 * i / nv
        row = []
        for j in range(nu + 1):
            u = -1 + 2 * j / nu
            hw = WD * (0.35 + 0.65 * math.sqrt(max(0.0, 1 - u * u)))
            spine = 5 * math.sin(u * 3.2 + 0.4)
            ridge = 6 * (1 - u * u) + sum(
                h * math.exp(-((u - pu) / w) ** 2) for pu, h, w in peaks)
            ac = max(0.0, 1 - abs(s)) ** 1.4
            z = ridge * ac + 2.0 * _wave(u * 9, s * 3) * ac * (1 - ac)
            z *= 1 - u ** 8
            row.append((u * L, spine + s * hw, max(0.0, z)))
        rows.append(row)

    def mat_fn(i, j, c):
        z = c[2]
        if z > 22 + 2.5 * _wave(c[0] / 9, c[1] / 7):
            return M("snow")
        if z > 12:
            return M("rock_grey" if _wave(c[0] / 6, c[1] / 5) > -0.2
                     else "rock_brown")
        if z > 4.5:
            return M("rock_brown")
        return M("foothill_green")

    _surface(b, rows, mat_fn)
    return m


def lake():
    m = Model("lake",
              f"{SCALE_NOTE} Nearly flat lake: deep and shallow water set "
              "just below a sandy shore ring and a grass ring, with a small "
              "wooded island.")
    b = m.part("body")
    segs = 48

    def outline(a):
        ar = math.radians(a)
        return 80 * (1 + 0.12 * math.sin(3 * ar + 1) + 0.08 * math.sin(
            5 * ar + 2.2) + 0.05 * math.sin(8 * ar))

    spec = [(1.0 + 26 / 80, 0.0), (1.0 + 14 / 80, 1.0), (1.0 + 7 / 80, 1.3),
            (1.0, 1.2), (0.995, 0.5), (0.85, 0.5), (0.5, 0.45), (0, 0.45)]
    rows = _polar_rows(spec, segs, outline)
    names = ["grass_green", "grass_green", "sand", "sand", "lake_shallow",
             "lake_blue", "lake_blue"]
    _surface(b, rows, lambda i, j, c: M(names[i]), wrap=True,
             orient="recalc", cap_first=True)
    # island
    ix, iy = 22.0, 14.0
    isl = _polar_rows([(1.0, 0.45), (0.8, 1.6), (0.4, 2.6), (0, 2.8)], 10,
                      lambda a: 12 * (1 + 0.15 * math.sin(math.radians(3 * a))))
    isl = [[(x + ix, y + iy, z) for x, y, z in row] for row in isl]
    _surface(b, isl, lambda i, j, c: M("sand" if i == 0 else "grass_green"),
             wrap=True)
    for k in range(4):
        x, y, _ = polar(k * 90 + 30, 4 + (k % 2) * 2)
        b.cone(2.2, 4, (ix + x, iy + y, 4.2), M("forest_mid"), segs=5)
    return m


def city_ruins():
    m = Model("city_ruins",
              f"{SCALE_NOTE} What is left of a city: a cracked grey pad with "
              "a cluster of tiny broken grey towers, scorched blocks and "
              "rubble piles.")
    b = m.part("body")
    segs = 32

    def outline(a):
        ar = math.radians(a)
        return 50 * (1 + 0.1 * math.sin(3 * ar + 0.4) + 0.06 * math.sin(
            7 * ar + 1.1))

    rows = _polar_rows([(1.0 + 8 / 50, 0.0), (1.0, 1.2), (0.6, 1.4),
                        (0, 1.4)], segs, outline)
    def pad_mat(i, j, c):
        if i == 0:
            return M("moraine")
        return M("ruin_dark" if _wave(c[0] / 9, c[1] / 9) > 0.45
                 else "concrete")

    _surface(b, rows, pad_mat, wrap=True, orient="recalc", cap_first=True)
    rnd = random.Random(42)
    placed = []
    tries = 0
    while len(placed) < 30 and tries < 2000:
        tries += 1
        a = rnd.uniform(0, 360)
        r = 44 * math.sqrt(rnd.random())
        if r > outline(a) * 0.82:
            continue
        x, y, _ = polar(a, r)
        if any(math.hypot(x - px, y - py) < 8.5 for px, py in placed):
            continue
        placed.append((x, y))
    for k, (x, y) in enumerate(placed):
        d = math.hypot(x, y)
        h = (22 - 0.32 * d) * rnd.uniform(0.45, 1.0) + 3
        w = rnd.uniform(4, 7)
        dd = rnd.uniform(4, 7)
        tilt = (rnd.uniform(-6, 6), rnd.uniform(-6, 6), rnd.uniform(0, 90))
        mat = M(("ruin_grey", "ruin_dark", "granite", "scorch")[k % 4])
        b.boxb((w, dd, h), (x, y, 1.0), mat, rot=tilt)
        if k % 3 == 0:  # broken top: a tilted slab leaning off the tower
            b.box((w * 0.9, dd * 0.5, 1.5), (x + 1, y, h + 0.8),
                  M("ruin_grey"), rot=(rnd.uniform(15, 35), 0,
                                       rnd.uniform(0, 180)))
        elif k % 3 == 1 and h > 10:  # stepped remains
            b.boxb((w * 0.6, dd * 0.6, h * 0.25), (x - 0.5, y + 0.5, h),
                   mat, rot=tilt)
    for k in range(14):
        a = k * 137.5
        x, y, _ = polar(a, 8 + 36 * ((k * 0.61) % 1))
        _rock(b, (x, y, 1.4), 2.5 + 2.5 * ((k * 0.37) % 1),
              M("ruin_dark" if k % 2 else "rock_grey"), seed=500 + k,
              scale=(1.3, 1.0, 0.45))
    return m


def mesa():
    m = Model("mesa",
              f"{SCALE_NOTE} Red flat-topped plateau: banded cliff strata "
              "over a tan talus apron, scrubby flat top, a small butte beside "
              "it and fallen boulders.")
    b = m.part("body")

    def make(cx, cy, R0, H, segs, seed):
        def outline(a):
            ar = math.radians(a)
            return R0 * (1 + 0.1 * math.sin(2 * ar + 0.5 + seed)
                         + 0.07 * math.sin(5 * ar + 1.3 * seed)
                         + 0.04 * math.sin(9 * ar))

        f = H / 35.0
        spec = [(1.28, 0), (1.12, 5 * f), (1.03, 9 * f), (1.02, 15 * f),
                (1.015, 20 * f), (1.01, 27 * f), (1.0, 31 * f), (1.0, 34 * f),
                (0.96, 35 * f), (0.6, 35.4 * f), (0, 35.6 * f)]
        rows = _polar_rows(
            spec, segs, outline,
            jitter=lambda a, i: 1 + (0.035 * _wave(a / 20, i * 1.3, seed)
                                     if 2 <= i <= 7 else 0))
        rows = [[(x + cx, y + cy, z) for x, y, z in row] for row in rows]
        names = ["scrub", "mesa_tan", "mesa_red", "mesa_tan", "mesa_orange",
                 "mesa_red", "mesa_tan", "mesa_top", "mesa_top", "mesa_top"]

        def mat_fn(i, j, c):
            if i == 9 and _wave(c[0] / 8, c[1] / 8) > 0.5:
                return M("scrub")
            return M(names[i])

        _surface(b, rows, mat_fn, wrap=True, orient="recalc", cap_first=True)

    make(0, 0, 48, 35, 40, 0.0)
    make(58, 30, 9, 24, 12, 2.0)
    for k in range(8):
        x, y, _ = polar(k * 47 + 15, 66 + 4 * math.sin(k))
        _rock(b, (x, y, 1.5), 2.5 + 2 * ((k * 0.53) % 1),
              M("mesa_red" if k % 2 else "mesa_orange"), seed=700 + k)
    return m


def forest_patch():
    m = Model("forest_patch",
              f"{SCALE_NOTE} Dense clump of tiny dark-green conifer cones on "
              "a forest-floor patch.")
    b = m.part("body")

    def outline(a):
        ar = math.radians(a)
        return 58 * (1 + 0.1 * math.sin(3 * ar + 0.8) + 0.07 * math.sin(
            5 * ar + 2.0))

    rows = _polar_rows([(1.12, 0.0), (1.0, 0.8), (0.5, 1.0), (0, 1.0)], 32,
                       outline)
    _surface(b, rows, lambda i, j, c: M("forest_floor" if i else "moraine"),
             wrap=True, orient="recalc", cap_first=True)
    rnd = random.Random(9)
    placed = []
    tries = 0
    while len(placed) < 130 and tries < 6000:
        tries += 1
        a = rnd.uniform(0, 360)
        r = 60 * math.sqrt(rnd.random())
        if r > outline(a) * 0.93:
            continue
        x, y, _ = polar(a, r)
        if any(math.hypot(x - px, y - py) < 6.2 for px, py, _ in placed):
            continue
        placed.append((x, y, r / outline(a)))
    for k, (x, y, edge) in enumerate(placed):
        h = (14 - 6 * edge) * rnd.uniform(0.75, 1.1)
        r = h * rnd.uniform(0.32, 0.4)
        mat = M(("forest_dark", "forest_mid", "pine_dark")[k % 3])
        b.cone(r, h, (x, y, 0.6 + h / 2), mat, segs=5,
               rot=(0, 0, rnd.uniform(0, 72)))
    return m


HAZARDS = [tornado, glacier_tongue, volcano, river_surge, hurricane,
           ice_sheet]
PROPS = [iceberg, mountain_range, lake, city_ruins, mesa, forest_patch]
