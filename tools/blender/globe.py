"""Globe models (Act 6): orbital hazards, the Orbital Sweeper boss and Globe
Debris (islands, atolls, archipelagos, pieces of ocean, a landmass, the Moon,
satellites, rocket stages, space junk, small weather systems).

Scale: 1 Blender unit = 10 km. One Globe world unit is 1,000 km = 100 BU, so
the game loads these files at scale 0.01 (manifest.json "scale": 0.01), like
the Continent models. Everything else follows the shared conventions: X right,
-Y forward (exported as glTF +Z), Z up, origin at the bottom centre where the
model touches the floor.

The game camera looks down from high above, so shapes are wide and flat where
possible and colour carries most of the read: white hulls, gold foil and blue
solar cells over the blue ocean floor, emissive plasma, lasers and eyes.
"""

import math
import random

import bmesh
from mathutils import Matrix, Vector

from common import M, Model, polar
from continent import _bolt, _polar_rows, _rock, _surface, _wave

UNITS = "10 km"
SCALE_NOTE = "Globe scale: 1 unit = 10 km, load at scale 0.01."
TAU = 2 * math.pi


# --------------------------------------------------------------------------
# Shared helpers
# --------------------------------------------------------------------------

def _solar(p, cx, cy, z, w, d, nx, ny, t=1.6, stripes=True):
    """Flat solar panel centred on (cx, cy, z): a light frame (w along X,
    d along Y) with nx x ny raised blue cells."""
    p.box((w, d, t), (cx, cy, z), M("solar_frame"))
    cw, cd = w / nx, d / ny
    g = min(0.14 * min(cw, cd), 2.5)
    for i in range(nx):
        for j in range(ny):
            dark = stripes and (i + j) % 2
            p.box((cw - g, cd - g, t * 0.5),
                  (cx - w / 2 + cw * (i + 0.5), cy - d / 2 + cd * (j + 0.5),
                   z + t * 0.5),
                  M("solar_cell_dark" if dark else "solar_cell"))


def _dish(p, r, depth, center, rot, mat="hull_white", segs=12, feed=True):
    """Parabolic dish (a thin closed shell) opening along local +Z."""
    t = max(0.6, r * 0.07)
    prof = [(0, 0), (r * 0.5, depth * 0.25), (r, depth), (r * 0.9, depth),
            (r * 0.45, depth * 0.25 + t), (0, t)]
    with p.xform(center, rot):
        p.lathe(prof, M(mat), segs=segs)
        if feed:
            p.rod((0, 0, t), (0, 0, depth * 1.4), max(0.4, r * 0.05),
                  M("metal"), segs=4)
            p.sphere(max(0.8, r * 0.1), (0, 0, depth * 1.4), M("metal"),
                     u=6, v=4)


def _arc_rows(stations, phis, axis_z, flat=0.6):
    """Rows for a (partial) tube along Y: stations is [(y, radius, z of the
    axis)], phis the angles round the axis (degrees, 0 = straight down,
    positive towards +X)."""
    rows = []
    for (y, r, za) in stations:
        if r <= 0:
            rows.append([(0.0, y, za)])
            continue
        rows.append([(r * math.sin(math.radians(f)), y,
                      za - r * flat * math.cos(math.radians(f)))
                     for f in phis])
    return rows


def _islet(p, cx, cy, r, h, seed, segs=16, halo=1.35):
    """Small island at (cx, cy): a shallow-water halo, a sand rim and a green
    hill of height h."""
    rnd = random.Random(seed)
    ph = [rnd.uniform(0, TAU) for _ in range(3)]

    def outline(a):
        ar = math.radians(a)
        return r * (1 + 0.14 * math.sin(2 * ar + ph[0])
                    + 0.09 * math.sin(3 * ar + ph[1])
                    + 0.05 * math.sin(5 * ar + ph[2]))

    spec = [(halo, 0.0), (1.08, 0.35), (1.0, 0.6), (0.82, 0.9 + h * 0.08),
            (0.55, h * 0.55), (0.25, h * 0.92), (0, h)]
    rows = _polar_rows(spec, segs, outline)
    rows = [[(x + cx, y + cy, z) for x, y, z in row] for row in rows]
    names = ["lagoon", "lagoon", "sand", "jungle", "jungle", "forest_mid"]

    def mat_fn(i, j, c):
        if i >= 3 and _wave(c[0] / 7, c[1] / 7, seed) > 0.55:
            return M("forest_mid" if i == 3 else "jungle")
        return M(names[i])

    _surface(p, rows, mat_fn, wrap=True)


def _shard(p, center, size, mat, rot):
    """Thin flat fragment (a broken plate)."""
    p.box(size, center, mat, rot=rot)


# --------------------------------------------------------------------------
# Hazards (orbit: the planet's last machines)
# --------------------------------------------------------------------------

def debris_satellite():
    HC = 34.0
    m = Model("debris_satellite",
              f"{SCALE_NOTE} Wanderer that pulls. Dead, tumbling satellite: "
              "gold-foil bus with a dish, a scorched flank and a red beacon; "
              "loose fragments (r 60 to 105, low) in body. panels node (both "
              "solar wings, tilted 25 deg about X, the right one snapped "
              "near the tip) spins about its local Y axis; pivot at the bus "
              f"centre (0, {HC:g}, 0).")
    b = m.part("body")
    b.box((46, 40, 42), (0, 0, HC), M("gold_foil"), bevel=2.0)
    b.box((40, 34, 3), (0, 0, HC + 21.5), M("mli_silver"))
    b.box((18, 14, 4), (-10, 8, HC + 24), M("radiator_white"))
    b.box((20, 1.5, 24), (8, -20.6, HC - 4), M("burnt_metal"), rot=(0, 8, 0))
    b.box((14, 1.5, 10), (-12, -20.6, HC + 9), M("burnt_metal"),
          rot=(0, -14, 0))
    _dish(b, 15, 6, (10, -4, HC + 23), rot=(28, 0, 25))
    b.rod((-14, 12, HC + 23), (-28, 30, HC + 44), 1.2, M("metal"), segs=6)
    b.sphere(2.6, (-28, 30, HC + 44), M("metal"), u=6, v=4)
    b.sphere(3.2, (14, 13, HC + 24.5), M("glow_red"), u=8, v=4)
    b.cyl(7, 8, (0, 24, HC - 8), M("gunmetal"), segs=8, r2=4.5,
          rot=(90, 0, 0))
    # tumbling fragments around it (kept low so the wings clear them)
    rnd = random.Random(31)
    for k in range(10):
        a = (k * 61 + 25) % 360
        if 55 < a < 125 or 235 < a < 305:  # under the wings: push them out
            a += 50
        r = rnd.uniform(60, 100)
        x, y, _ = polar(a, r)
        z = rnd.uniform(4, 12)
        if k % 3 == 0:
            _shard(b, (x, y, z), (rnd.uniform(9, 14), rnd.uniform(6, 9), 1.2),
                   M("solar_cell"), (rnd.uniform(-30, 30), rnd.uniform(-30, 30),
                                     rnd.uniform(0, 180)))
        else:
            _rock(b, (x, y, z), rnd.uniform(2.5, 5),
                  M(("mli_silver", "gold_foil", "burnt_metal")[k % 3]),
                  seed=900 + k, scale=(1.4, 1.0, 0.5))

    pn = m.part("panels", pivot=(0, 0, HC))
    for sx in (-1, 1):
        pn.rod((sx * 23, 0, HC), (sx * 44, 0, HC), 2.0, M("metal"), segs=6)
        pn.box((4, 6, 6), (sx * 42, 0, HC), M("gunmetal"))
        with pn.xform((0, 0, HC), rot=(25, 0, 0)):
            if sx < 0:
                _solar(pn, -92, 0, 0, 92, 48, 4, 2)
            else:
                _solar(pn, 81, 0, 0, 70, 48, 3, 2)
                # the snapped last panel, hanging off the hinge
                with pn.xform((116, 0, 0), rot=(0, 28, -14)):
                    _solar(pn, 11, -4, 0, 22, 38, 1, 2)
    return m


def space_station():
    HC = 24.0
    m = Model("space_station",
              f"{SCALE_NOTE} Lane patrol: long axis along X (the truss, 250 "
              "long), moves along Z. Pressurised white modules run along Z "
              "through the middle (a capsule docked at the +Z end), white "
              "radiators off the truss, red/green nav lights at the truss "
              "ends. arrays node: eight blue solar wings at the truss ends "
              f"(52 out from the truss); pivot on the truss axis (0, {HC:g}, "
              "0); rotate it about local X to sun-track (keep within about "
              "+/-25 deg or the wings dip into the floor). It hovers: the "
              "lowest point is the modules' underside at y = 13.5.")
    b = m.part("body")
    n = 10
    for k in range(n):
        x0 = -125 + 25 * k
        b.box((25, 9, 9), (x0 + 12.5, 0, HC),
              M("mech_grey" if k % 2 else "steel_light"))
    for k in range(20):
        xa = -122 + 12.2 * k
        b.rod((xa, -4.6 if k % 2 else 4.6, HC + 4.7),
              (xa + 12.2, 4.6 if k % 2 else -4.6, HC + 4.7), 0.8,
              M("gunmetal"), segs=4)
    # pressurised modules along Y (game Z)
    for (y0, y1, r) in ((-56, -40, 7.5), (-38, -12, 9.5), (12, 34, 9.0),
                        (36, 54, 8.0)):
        b.cyl(r, y1 - y0, (0, (y0 + y1) / 2, HC), M("hull_white"), segs=10,
              rot=(90, 0, 0))
        b.cyl(r + 0.4, 1.4, (0, y0 + 1.5, HC), M("mech_grey"), segs=10,
              rot=(90, 0, 0))
    for yc in (-39, 0, 35):
        b.sphere(10.5, (0, yc, HC), M("hull_white"), u=12, v=8)
    # cross modules on the forward node (Columbus / Kibo)
    for sx in (-1, 1):
        b.cyl(8.5, 26, (sx * 22, -39, HC), M("hull_white"), segs=12,
              rot=(0, 90, 0))
    b.box((16, 14, 2.4), (-44, -39, HC - 2), M("mech_grey"))
    b.box((12, 10, 3), (-44, -39, HC + 0.5), M("gold_foil"))
    # docked capsule at the front (+Z)
    b.cyl(7.0, 9, (0, -61, HC), M("hull_white"), segs=12, r2=4.0,
          rot=(90, 0, 0))
    b.cyl(7.2, 5, (0, -54.5, HC), M("iron_black"), segs=12, rot=(90, 0, 0))
    # Soyuz-like at the back
    b.cyl(6, 10, (0, 60, HC), M("foothill_green"), segs=10, rot=(90, 0, 0))
    b.sphere(5, (0, 67, HC), M("foothill_green"), u=10, v=6)
    for sx in (-1, 1):
        b.box((14, 6, 0.8), (sx * 13, 60, HC), M("solar_cell"))
    # radiators
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box((14, 30, 1.2), (sx * 44, sy * 22, HC), M("radiator_white"))
            b.rod((sx * 44, sy * 5, HC), (sx * 44, sy * 37, HC), 0.7,
                  M("mech_grey"), segs=4)
    # robotic arm
    b.rod((6, -12, HC + 9), (26, -26, HC + 20), 1.6, M("steel_light"), segs=6)
    b.rod((26, -26, HC + 20), (40, -18, HC + 12), 1.4, M("steel_light"),
          segs=6)
    b.sphere(2.2, (26, -26, HC + 20), M("mech_grey"), u=6, v=4)
    b.sphere(2.0, (-126, 0, HC), M("glow_red"), u=8, v=4)
    b.sphere(2.0, (126, 0, HC), M("glow_cyan"), u=8, v=4)

    a = m.part("arrays", pivot=(0, 0, HC))
    for xc in (-108, -82, 82, 108):
        a.box((7, 8, 12), (xc, 0, HC), M("gunmetal"))
        for sy in (-1, 1):
            a.rod((xc, sy * 4, HC), (xc, sy * 54, HC), 0.8, M("metal"),
                  segs=4)
            _solar(a, xc, sy * 30.5, HC, 20, 45, 1, 4, t=1.2)
    return m


def asat_laser():
    H0 = 20.0
    HB = H0 + 30.0
    TIP = 147.0
    m = Model("asat_laser",
              f"{SCALE_NOTE} Turret that fires. Anti-satellite laser "
              "emplacement: an octagonal armoured pad with a yellow and black "
              "hazard ring, four solar petals, radar domes and red warning "
              "lights. head node (turret drum, tracking dish at the back, "
              "long finned barrel with a red emissive lens) turns about the "
              f"vertical axis through the origin; pivot (0, {H0:g}, 0). The "
              f"barrel points +Z; the muzzle tip is at (0, {HB:g}, {TIP:g}) "
              "in model space (head at rest).")
    b = m.part("body")
    b.lathe([(120, 0), (116, 6), (104, 8)], M("gunmetal"), segs=8,
            rot=(0, 0, 22.5))
    for k in range(16):
        b.band(92, 104, 7.6, 8.8, k * 22.5, (k + 1) * 22.5,
               M("hazard_yellow" if k % 2 else "iron_black"), segs=2)
    b.cyl(86, H0 - 8, (0, 0, 8 + (H0 - 8) / 2), M("plant_dark"), segs=8,
          r2=80, rot=(0, 0, 22.5))
    for k in range(4):
        with b.xform((0, 0, 0), rot=(0, 0, 45 + 90 * k)):
            _solar(b, 0, -132, 5, 30, 40, 2, 3)
            b.rod((0, -100, 6), (0, -114, 5), 1.6, M("metal"), segs=4)
    for k, a in enumerate((65, 115, 245, 295)):
        x, y, _ = polar(a, 64)
        b.sphere(8 if k % 2 else 6.5, (x, y, H0), M("hull_white"), u=10, v=6)
    for k in range(8):
        x, y, _ = polar(k * 45, 110)
        b.sphere(2.4, (x, y, 7.5), M("glow_red"), u=6, v=4)

    h = m.part("head", pivot=(0, 0, H0))
    h.cyl(44, 18, (0, 0, H0 + 9), M("mech_grey"), segs=12, r2=40)
    h.cyl(36, 3, (0, 0, H0 + 19.5), M("plant_dark"), segs=12)
    _dish(h, 22, 8, (0, 26, H0 + 30), rot=(-30, 0, 0), mat="steel_light")
    h.rod((0, 18, H0 + 18), (0, 22, H0 + 28), 3, M("gunmetal"), segs=6)
    # mantlet and barrel
    h.box((30, 44, 24), (0, -14, HB), M("gunmetal"), bevel=2.0)
    h.box((4, 38, 1.2), (0, -14, HB + 12.4), M("glow_laser"))
    blen = TIP - 6 - 36
    h.cyl(8, blen, (0, -(36 + blen / 2), HB), M("plant_dark"), segs=10,
          rot=(90, 0, 0))
    for k in range(5):
        h.cyl(11.5, 3, (0, -(50 + 14 * k), HB), M("metal"), segs=10,
              rot=(90, 0, 0))
    h.cyl(11, 6, (0, -(TIP - 3.5), HB), M("iron_black"), segs=10,
          rot=(90, 0, 0))
    h.cyl(6.5, 1.2, (0, -(TIP - 0.6), HB), M("glow_laser"), segs=10,
          rot=(90, 0, 0))
    return m


def reentry_burn():
    ZC = 25.0
    m = Model("reentry_burn",
              f"{SCALE_NOTE} Trail-layer that lays a fire trail. Re-entry "
              "capsule moving +Z: a white-hot heat shield at the front, the "
              "burnt back shell visible from above, a bow-shock collar of "
              "orange plasma round the front and sides, and a plasma trail "
              "(white core, orange, red, then smoke) streaming back to -Z "
              "with embers (the trail continues from the -Z end).")
    b = m.part("body")
    # capsule: heat shield faces forward (-Y), back shell narrows to +Y
    with b.xform((0, -88, ZC), rot=(90, 0, 0)):
        b.lathe([(0, 4.5), (14, 3.4), (22, 0), (22.5, -1.5), (0, -1.5)],
                M("glow_plasma_white"), segs=16)
        b.lathe([(21.5, -1.5), (14, -24), (8, -27), (0, -28)],
                M("burnt_metal"), segs=16)
        b.cyl(8.5, 1.5, (0, 0, -24.5), M("heat_shield"), segs=12)
    # bow-shock collar: open on top so the capsule reads from above
    phis = [-145 + 290 * k / 16 for k in range(17)]
    st = []
    for k in range(9):
        s = k / 8
        st.append((-106 + 50 * s, 0 if k == 0 else 44 * s ** 0.42, ZC))
    rows = _arc_rows(st, phis, ZC, flat=0.55)

    def collar_mat(i, j, c):
        if i < 2:
            return M("glow_plasma_white")
        edge = j in (0, len(phis) - 2)
        return M("glow_plasma_red" if edge or (i > 5 and j % 3 == 1)
                 else "glow_plasma_orange")

    _surface(b, rows, collar_mat, orient="recalc")
    # the trail: a flattened tube streaming back
    segs = 18
    phis = [360 * k / segs for k in range(segs)]
    st = []
    n = 20
    for i in range(n + 1):
        t = i / n
        y = -60 + 192 * t
        r = (5 + 31 * (t / 0.14) ** 0.6 if t < 0.14
             else 4 + 32 * ((1 - t) / 0.86) ** 0.85)
        st.append((y, r, ZC - 9 * t))
    rows = []
    for i, (y, r, za) in enumerate(st):
        t = i / n
        row = []
        for f in phis:
            fl = 1 + 0.16 * math.sin(math.radians(5 * f) + 9 * t) * min(
                1.0, t * 3)
            fr = math.radians(f)
            row.append((r * fl * math.sin(fr), y + 6 * math.sin(fr * 3) * t,
                        za - r * fl * 0.55 * math.cos(fr)))
        rows.append(row)

    def trail_mat(i, j, c):
        t = i / n
        up = abs(((j + 0.5) / segs) * 360 - 180)  # 0 = top of the tube
        tongue = math.sin(j * 2.4 + i * 0.9) > 0.3
        if t < 0.22 and up < 25:
            return M("glow_plasma_white")
        if t < 0.55:
            return M("glow_plasma_red" if tongue and up > 60
                     else "glow_plasma_orange")
        if t < 0.82:
            return M("glow_plasma_orange" if tongue and up < 70
                     else "glow_plasma_red")
        return M("smoke_grey")

    _surface(b, rows, trail_mat, wrap=True, orient="recalc", cap_first=True)
    rnd = random.Random(17)
    for k in range(12):
        t = 0.15 + 0.7 * k / 11
        y = -60 + 192 * t
        r = 4 + 32 * ((1 - t) / 0.86) ** 0.85
        side = 1 if k % 2 else -1
        b.sphere(rnd.uniform(2, 3.5), (side * (r + rnd.uniform(4, 10)),
                                       y + rnd.uniform(-6, 6),
                                       ZC - 9 * t + rnd.uniform(-4, 6)),
                 M("glow_plasma_orange" if k % 3 else "glow_plasma_white"),
                 u=6, v=4)
    for k in range(5):
        b.sphere(7 + 2 * k % 3, ((k - 2) * 7, 120 + 6 * (k % 2), 8 + k % 2),
                 M("smoke_grey"), u=8, v=5, scale=(1.3, 1.0, 0.6))
    return m


def globe_hurricane():
    EYE = 40.0
    m = Model("globe_hurricane",
              f"{SCALE_NOTE} Cone blaster. A hurricane seen from orbit: flat "
              "white spiral cloud bands (r 330) with blue-grey shadows round "
              "a clear eye (r 40, open to the ocean). spiral node (dense "
              "overcast, five spiral arms, outer feeder bands, lightning) "
              "spins about its local Y axis through the origin (positive = "
              "counter-clockwise from above, the way the arms trail). body "
              "is the eyewall. The wind cone blows +Z from the front of the "
              "eyewall at about (0, 22, 68) in model space.")
    b = m.part("body")
    segs = 40
    spec = [(EYE, 1), (45, 18), (52, 32), (61, 40), (72, 41), (86, 34)]
    rows = [[polar(360 * j / segs, r * (1 + 0.03 * math.sin(j * 1.9)),
                   z * (1 + 0.06 * _wave(j * 0.7, r)))
             for j in range(segs)] for r, z in spec]
    _surface(b, rows, lambda i, j, c: M(
        ("cloud_shadow", "cloud_blue", "cloud_blue")[i] if i < 3
        else "cloud_white"), wrap=True)
    _bolt(b, [(-34, -52, 41.4), (-20, -58, 41.6), (-24, -64, 41.4),
              (-10, -70, 41.0)], 1.2, M("glow_lightning"))

    sp = m.part("spiral")
    K = 210.0 / math.log(300 / 125)

    def groove(a_deg, r):
        return math.sin(math.radians(5 * (a_deg + K * math.log(r / 78))))

    segs = 60
    cdo = [78 + 15 * k for k in range(9)]  # 78 .. 198
    rows = []
    for r in cdo:
        base = 37 - 28 * ((r - 78) / 120) ** 1.5
        row = []
        for j in range(segs):
            a = 360 * j / segs
            rr = r * (1 + 0.045 * groove(a, r)) if r < cdo[-1] else r * (
                1 + 0.07 * groove(a, r))
            z = base + (3.5 * groove(a, r) if r < cdo[-1] else 0)
            row.append(polar(a, rr, max(2.0, z)))
        rows.append(row)

    def cdo_mat(i, j, c):
        a = math.degrees(math.atan2(c[0], -c[1]))
        r = math.hypot(c[0], c[1])
        g = groove(a, r)
        if g < -0.55:
            return M("cloud_shadow")
        if g < -0.1:
            return M("cloud_blue")
        return M("cloud_white")

    _surface(sp, rows, cdo_mat, wrap=True)
    across = [(-1, 0.1), (-0.5, 0.75), (0, 1.0), (0.5, 0.75), (1, 0.1)]
    for arm in range(5):
        a0 = arm * 72 + 15
        rows = []
        n = 26
        r0, r1 = 135.0, 322.0
        for i in range(n + 1):
            t = i / n
            r = r0 * (r1 / r0) ** t
            a = a0 - K * math.log(r / r0)
            w = 46 * math.sqrt(max(0.0, 1 - t)) * min(1.0, 0.5 + t * 3) + 4
            top = 21 * (1 - t) + 5 + 2.5 * _wave(t * 9, arm)
            row = []
            for s, zf in across:
                x, y, _ = polar(a, r + s * w / 2)
                row.append((x, y, max(1.5, top * zf)))
            rows.append(row)
        _surface(sp, rows, lambda i, j, c: M(
            "cloud_white" if j in (1, 2) and i < 21 else "cloud_blue"))
    for k, (a, r) in enumerate(((40, 120), (170, 150), (280, 105))):
        pts = []
        for q in range(4):
            x, y, _ = polar(a + q * 4 + (6 if q % 2 else 0), r + q * 7)
            base = 37 - 28 * ((r + q * 7 - 78) / 120) ** 1.5
            pts.append((x, y, base + 4.5))
        _bolt(sp, pts, 1.4, M("glow_lightning"))
    return m


def orbital_sweeper():
    HC = 58.0
    NET_Y = -50.0      # funnel attachment (Blender y)
    WING_Y = 40.0
    LX, LZ, LTIP = 80.0, HC + 4, 84.0
    m = Model("orbital_sweeper",
              f"{SCALE_NOTE} Boss. The Orbital Sweeper, a net-and-laser "
              "cleanup satellite (a vacuum cleaner for space), front +Z: a "
              "long white octagonal bus with red bands, a dust-bin canister "
              "on its back, a red emissive visor eye, an amber beacon and a "
              "cyan engine glow at the back (-Z). net node: the intake "
              "funnel (flattened, 235 wide, yellow lip, glowing cyan throat) "
              "and the orange capture net domed in front of it; pivot at its "
              f"attachment to the bus, (0, {HC:g}, {-NET_Y:g}). wings node: "
              "two solar wings (6 panels, 490 tip to tip) on booms; pivot on "
              f"the bus axis (0, {HC:g}, {-WING_Y:g}); rotate about local X "
              "to feather (any angle) or about local Z to flap (keep within "
              "+/-10 deg or the tips reach the floor). Two laser emitters on "
              f"pylons beside the bus; lens tips at (+/-{LX:g}, {LZ:g}, "
              f"{LTIP:g}) in model space, firing +Z.")
    b = m.part("body")
    # bus: octagonal prism along Y from y = -50 to y = 130
    with b.xform((0, 30, HC), rot=(90, 0, 0)):
        b.cyl(46, 140, (0, 0, 0), M("hull_white"), segs=8, rot=(0, 0, 22.5))
        for zz in (55, -40):  # red bands (local z = -Blender y)
            b.cyl(47.2, 9, (0, 0, zz), M("boss_red"), segs=8,
                  rot=(0, 0, 22.5))
        b.cyl(48, 10, (0, 0, 75), M("gunmetal"), segs=8, rot=(0, 0, 22.5))
        b.cyl(42, 30, (0, 0, -85), M("gold_foil"), segs=8, rot=(0, 0, 22.5))
        b.lathe([(16, -100), (22, -112), (30, -128), (27, -128),
                 (12, -101)], M("gunmetal"), segs=12)
        b.cyl(20, 1.5, (0, 0, -114), M("glow_cyan"), segs=12)
    # top: visor eye, dust bin, beacon, antennas
    top = HC + 42.5
    b.box((64, 16, 5), (0, -28, top + 1.5), M("gunmetal"), bevel=1.5)
    b.box((54, 9, 3.4), (0, -30, top + 3.2), M("glow_red"))
    b.cyl(26, 34, (0, 58, top + 17), M("bin_clear"), segs=12)
    for zz in (top + 2, top + 33):
        b.cyl(27.5, 3, (0, 58, zz), M("gunmetal"), segs=12)
    rnd = random.Random(77)
    for k in range(7):
        x, y, _ = polar(k * 51, rnd.uniform(6, 18))
        _rock(b, (x, 58 + y, top + 34.5), rnd.uniform(3, 6),
              M(("dust", "mli_silver", "gold_foil", "solar_cell")[k % 4]),
              seed=1200 + k, scale=(1.3, 1.0, 0.5))
    b.cyl(5, 8, (0, 18, top + 4), M("gunmetal"), segs=8)
    b.sphere(5.5, (0, 18, top + 10), M("glow_amber"), u=8, v=6)
    b.rod((-26, 92, top - 2), (-36, 112, top + 22), 1.2, M("metal"), segs=4)
    _dish(b, 14, 5, (28, 100, top - 2), rot=(-30, 0, -20), mat="steel_light")
    # radiator fins along the sides
    for sx in (-1, 1):
        for k in range(3):
            b.box((26, 22, 1.4), (sx * 58, 86 + 22 * k, HC + 10),
                  M("radiator_white"), rot=(0, sx * 18, 0))
    # laser pylons and emitters
    for sx in (-1, 1):
        b.box((44, 22, 10), (sx * 58, -16, LZ), M("gunmetal"), bevel=1.5)
        b.cyl(10, 26, (sx * LX, -40, LZ), M("plant_dark"), segs=10,
              rot=(90, 0, 0))
        b.cyl(5.5, 32, (sx * LX, -67, LZ), M("mech_grey"), segs=10,
              rot=(90, 0, 0))
        for k in range(3):
            b.cyl(7.5, 2.2, (sx * LX, -56 - 8 * k, LZ), M("boss_red"),
                  segs=10, rot=(90, 0, 0))
        b.cyl(4.2, 1.5, (sx * LX, -(LTIP - 0.75), LZ), M("glow_laser"),
              segs=10, rot=(90, 0, 0))
    # grabber arms tucked under the funnel
    for sx in (-1, 1):
        b.rod((sx * 30, -36, HC - 34), (sx * 64, -80, HC - 46), 3,
              M("steel_light"), segs=6)
        b.rod((sx * 64, -80, HC - 46), (sx * 56, -118, HC - 50), 2.6,
              M("steel_light"), segs=6)
        b.sphere(4.2, (sx * 64, -80, HC - 46), M("gunmetal"), u=8, v=5)
        for d in (-1, 1):
            b.rod((sx * 56, -118, HC - 50), (sx * 56 + d * 7, -128, HC - 50),
                  1.8, M("gunmetal"), segs=4)

    # net: funnel + capture net (pivot at the attachment)
    nt = m.part("net", pivot=(0, NET_Y, HC))
    with nt.xform((0, NET_Y, HC), rot=(90, 0, 0), scale=(1.2, 0.55, 1.2)):
        segs = 20
        rings = [(40, 0), (58, 36), (82, 70), (96, 84), (98, 88), (92, 88),
                 (78, 72), (54, 40), (36, 6)]

        def ring_mat(i, j, c):
            if i in (3, 4):
                return M("hazard_yellow" if j % 2 else "iron_black")
            if i <= 2:
                return M("gunmetal" if i % 2 else "plant_dark")
            return M("iron_black" if (j + i) % 2 else "glass_black")

        rows = [[(r * math.cos(TAU * k / segs), r * math.sin(TAU * k / segs),
                  z) for k in range(segs)] for r, z in rings]
        _surface(nt, rows, ring_mat, wrap=True, orient="recalc")
        nt.cyl(37, 1.5, (0, 0, 6), M("glow_cyan"), segs=segs)
        # capture net: meridians and rings over a dome in front of the lip
        def dome(th, s):
            rr = 96 * math.cos(s * math.pi / 2)
            return (rr * math.cos(th), rr * math.sin(th),
                    88 + 62 * math.sin(s * math.pi / 2))

        mer = 12
        for k in range(mer):
            th = TAU * (k + 0.5) / mer
            for q in range(5):
                nt.rod(dome(th, q / 5), dome(th, (q + 1) / 5), 1.4,
                       M("net_orange"), segs=3)
        for s in (0.3, 0.55, 0.78):
            n = 18
            for k in range(n):
                nt.rod(dome(TAU * k / n, s), dome(TAU * (k + 1) / n, s), 1.2,
                       M("net_orange"), segs=3)
        for k in range(6):
            x, y, z = dome(TAU * k / 6, 0)
            nt.sphere(4.5, (x, y, z), M("metal"), u=8, v=5)
    # wings
    w = m.part("wings", pivot=(0, WING_Y, HC))
    for sx in (-1, 1):
        w.rod((sx * 44, WING_Y, HC), (sx * 246, WING_Y, HC), 2.6, M("metal"),
              segs=6)
        w.box((14, 14, 14), (sx * 50, WING_Y, HC), M("gunmetal"), bevel=1.5)
        for k in range(3):
            x0 = 60 + 62 * k
            _solar(w, sx * (x0 + 29), WING_Y, HC, 58, 70, 3, 2, t=2.0)
        w.sphere(4, (sx * 248, WING_Y, HC), M("glow_cyan"), u=8, v=5)
    return m


def mini_sweeper():
    HC = 15.0
    m = Model("mini_sweeper",
              f"{SCALE_NOTE} Kessler-swarm minion of the Orbital Sweeper, "
              "front +Z: a small white hexagonal bus with a red band, a red "
              "emissive eye, an intake funnel with a cyan throat at the "
              "front and two solar wings. Static (no animated nodes).")
    b = m.part("body")
    with b.xform((0, 4, HC), rot=(90, 0, 0)):
        b.cyl(12, 34, (0, 0, 0), M("hull_white"), segs=6)
        b.cyl(12.6, 5, (0, 0, 6), M("boss_red"), segs=6)
    with b.xform((0, -13, HC), rot=(90, 0, 0), scale=(1, 0.65, 1)):
        rows = [[(r * math.cos(TAU * k / 8), r * math.sin(TAU * k / 8), z)
                 for k in range(8)] for r, z in ((11, 0), (22, 20), (19, 20),
                                                 (9, 2))]
        _surface(b, rows, lambda i, j, c: M(
            ("gunmetal", "hazard_yellow", "glass_black")[i]), wrap=True,
            orient="recalc")
        b.cyl(9.5, 0.8, (0, 0, 2.5), M("glow_cyan"), segs=8)
    b.box((14, 5, 2.4), (0, -8, HC + 11.4), M("glow_red"))
    for sx in (-1, 1):
        b.rod((sx * 10, 6, HC), (sx * 18, 6, HC), 1.2, M("metal"), segs=4)
        b.box((32, 16, 1.4), (sx * 34, 6, HC), M("solar_frame"))
        b.box((30, 14, 1.0), (sx * 34, 6, HC + 0.6), M("solar_cell"))
    return m


# --------------------------------------------------------------------------
# Debris props (absorbable)
# --------------------------------------------------------------------------

def island():
    m = Model("island",
              f"{SCALE_NOTE} Tropical island: a jungle-green hill on a sand "
              "beach inside a turquoise lagoon, ringed by a reef with a white "
              "surf line.")
    b = m.part("body")
    segs = 36

    def outline(a):
        ar = math.radians(a)
        return 45 * (1 + 0.1 * math.sin(2 * ar + 0.6)
                     + 0.07 * math.sin(5 * ar + 1.4))

    spec = [(1.0, 0.0), (0.96, 1.3), (0.925, 1.4), (0.88, 0.6), (0.68, 0.6),
            (0.63, 1.2), (0.55, 2.0), (0.48, 3.0), (0.34, 5.5), (0.18, 8.0),
            (0, 9.0)]
    rows = _polar_rows(spec, segs, outline,
                       jitter=lambda a, i: 1 + (0.09 * _wave(a / 25, 1.0)
                                                if i >= 5 else 0))
    names = ["reef_cyan", "foam", "reef_cyan", "lagoon", "sand", "sand",
             "jungle", "jungle", "jungle", "forest_mid"]

    def mat_fn(i, j, c):
        if 6 <= i <= 8 and _wave(c[0] / 6, c[1] / 6) > 0.5:
            return M("forest_mid")
        return M(names[i])

    _surface(b, rows, mat_fn, wrap=True)
    return m


def atoll():
    m = Model("atoll",
              f"{SCALE_NOTE} Ring-shaped coral atoll: a reef ring with a "
              "white surf line and a broken chain of sandy, palm-green islets "
              "round a pale turquoise lagoon with a deeper centre.")
    b = m.part("body")
    segs = 48

    def outline(a):
        ar = math.radians(a)
        return 40 * (1 + 0.12 * math.sin(2 * ar + 0.3)
                     + 0.05 * math.sin(3 * ar + 2.0))

    def islet(a):
        return math.sin(math.radians(4 * a) + 0.8 * math.sin(math.radians(a)))

    spec = [(1.0, 0.0, "reef_cyan"), (0.95, 1.0, "foam"),
            (0.92, 1.1, None), (0.86, 1.4, None), (0.8, 1.1, None),
            (0.75, 0.6, "reef_cyan"), (0.7, 0.35, "lagoon"),
            (0.4, 0.3, "lagoon"), (0.25, 0.2, "lake_shallow"),
            (0, 0.2, None)]
    rows = []
    for (s, z, _) in spec:
        if s <= 0:
            rows.append([(0.0, 0.0, z)])
            continue
        row = []
        for j in range(segs):
            a = 360 * j / segs
            zz = z
            if 0.78 <= s <= 0.92 and islet(a) > 0.1:
                zz += 1.0 if s in (0.92, 0.8) else 1.8
            x, y, _ = polar(a, outline(a) * s)
            row.append((x, y, zz))
        rows.append(row)

    def mat_fn(i, j, c):
        if spec[i][2]:
            return M(spec[i][2])
        a = 360 * (j + 0.5) / segs
        if islet(a) > 0.1:
            return M("jungle" if i == 2 and islet(a) > 0.45 else "sand")
        return M("reef_cyan")

    _surface(b, rows, mat_fn, wrap=True)
    return m


def archipelago():
    m = Model("archipelago",
              f"{SCALE_NOTE} A curved chain of seven small green islands on "
              "sand rims, each in its own turquoise shallows, long axis along "
              "X.")
    b = m.part("body")
    isles = [(-74, 8, 9, 3.0), (-52, -6, 13, 5.0), (-26, -14, 16, 7.0),
             (4, -12, 18, 9.0), (32, -2, 14, 6.0), (56, 10, 10, 4.0),
             (76, 20, 7, 2.5)]
    for k, (x, y, r, h) in enumerate(isles):
        _islet(b, x, y, r, h, seed=40 + k, segs=16 if r > 10 else 12)
    return m


def ocean_patch():
    m = Model("ocean_patch",
              f"{SCALE_NOTE} A lifted lozenge of deep ocean (200 x 144): "
              "dark blue sides, a gently waved deep-blue surface with paler "
              "swells, a white surf rim and wind-streaked whitecaps.")
    b = m.part("body")
    segs = 40

    def outline(a):
        ar = math.radians(a)
        rx, ry = 100.0, 72.0
        base = rx * ry / math.hypot(ry * math.sin(ar), rx * math.cos(ar))
        return base * (1 + 0.03 * math.sin(3 * ar + 0.5))

    TOP = 5.0
    spec = [(1.0, 0.0), (1.0, TOP), (0.96, TOP + 0.3)] + [
        (s, TOP) for s in (0.85, 0.72, 0.58, 0.44, 0.3, 0.16)] + [(0, TOP)]
    rows = _polar_rows(spec, segs, outline)
    rows = [[(x, y, z + (0.9 * _wave(x / 14, y / 11) if i >= 3 else 0.0))
             for (x, y, z) in row] for i, row in enumerate(rows)]

    def mat_fn(i, j, c):
        if i == 0:
            return M("ocean_deep")
        if i == 1:
            return M("foam")
        w = _wave(c[0] / 14, c[1] / 11)
        return M("ocean_mid" if w > 0.25 else "ocean_deep")

    _surface(b, rows, mat_fn, wrap=True, orient="recalc", cap_first=True)
    rnd = random.Random(23)
    placed = 0
    tries = 0
    while placed < 16 and tries < 400:
        tries += 1
        a = rnd.uniform(0, 360)
        r = math.sqrt(rnd.random()) * 0.8
        x, y, _ = polar(a, outline(a) * r)
        z = TOP + 0.9 * _wave(x / 14, y / 11) + 0.4
        b.sphere(rnd.uniform(3.5, 6), (x, y, z), M("foam"), u=8, v=3,
                 scale=(1.8, 0.45, 0.25), rot=(0, 0, 20 + rnd.uniform(-8, 8)))
        placed += 1
    return m


def landmass():
    m = Model("landmass",
              f"{SCALE_NOTE} A continent-sized chunk of land: a pale "
              "continental shelf and sandy coast round green lowlands, "
              "savanna and a tan desert, a lake, and a mountain chain with "
              "snow caps along a diagonal spine.")
    b = m.part("body")
    segs = 64

    def outline(a):
        ar = math.radians(a)
        return 150 * (1 + 0.16 * math.sin(2 * ar + 0.3)
                      + 0.11 * math.sin(3 * ar + 1.9)
                      + 0.06 * math.sin(5 * ar + 0.7)
                      + 0.035 * math.sin(9 * ar + 2.4))

    ridge = [(-95, 55), (-50, 30), (-5, 10), (40, -20), (80, -60)]
    lake_c, lake_r = (40, 50), 17.0

    def seg_dist(x, y):
        best = 1e9
        for (ax, ay), (bx, by) in zip(ridge, ridge[1:]):
            dx, dy = bx - ax, by - ay
            t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy)
                             / (dx * dx + dy * dy)))
            best = min(best, math.hypot(x - ax - t * dx, y - ay - t * dy))
        return best

    def height(x, y, edge):
        d = seg_dist(x, y)
        h = 30 * math.exp(-(d / 20) ** 2) * (1 + 0.3 * _wave(x / 15, y / 15))
        h += 2.5 * (1 + _wave(x / 25, y / 22))
        if math.hypot(x - lake_c[0], y - lake_c[1]) < lake_r:
            h = 0.4
        return 1.4 + h * min(1.0, edge)

    spec = [1.12, 1.05, 1.0, 0.95, 0.88, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2,
            0.1, 0.0]
    rows = []
    for i, s in enumerate(spec):
        if s <= 0:
            rows.append([(0.0, 0.0, height(0, 0, 1))])
            continue
        row = []
        for j in range(segs):
            a = 360 * j / segs
            x, y, _ = polar(a, outline(a) * s)
            if s > 1.01:
                z = 0.0 if i == 0 else 0.6
            elif s >= 1.0:
                z = 1.2
            else:
                z = height(x, y, (1 - s) / 0.15)
            row.append((x, y, z))
        rows.append(row)

    def mat_fn(i, j, c):
        if i == 0:
            return M("reef_cyan")
        if i == 1:
            return M("lagoon")
        if i == 2:
            return M("sand")
        x, y, z = c
        if math.hypot(x - lake_c[0], y - lake_c[1]) < lake_r + 2:
            return M("lake_blue")
        if z > 23 + 2 * _wave(x / 9, y / 7):
            return M("snow")
        if z > 13:
            return M("rock_grey" if _wave(x / 6, y / 5) > -0.2
                     else "rock_brown")
        if z > 9:
            return M("rock_brown")
        # biomes: desert in the south-west lee of the range, jungle north-east
        side = (x - -5) * 0.6 + (y - 10) * 0.8   # across the spine
        w = _wave(x / 30, y / 30)
        if side > 25 and w > -0.6:
            return M("desert_tan" if w > -0.1 else "savanna")
        if side > 5:
            return M("savanna" if w > 0.0 else "grass_green")
        return M("jungle" if w > 0.1 else "grass_green")

    _surface(b, rows, mat_fn, wrap=True)
    return m


def moon():
    R = 174.0
    m = Model("moon",
              f"{SCALE_NOTE} The Moon at true size (radius 1,737 km = 174 "
              "units): a grey cratered sphere resting ON the floor (origin "
              "at the bottom of the sphere), dark maria on the top face, "
              "crater bowls with pale rims.")
    b = m.part("body")
    b.smooth_angle = math.radians(55)
    res = bmesh.ops.create_icosphere(b.bm, subdivisions=5, radius=R,
                                     matrix=b._m((0, 0, R), (0, 0, 0),
                                                 (1, 1, 1)))
    verts = res["verts"]
    rnd = random.Random(1969)
    craters = []
    for k in range(22):
        # biased towards the upper half, which the camera sees
        zc = (rnd.uniform(0.0, 1.0) ** 0.6 if k < 16
              else rnd.uniform(-1.0, 0.2))
        th = rnd.uniform(0, TAU)
        rr = math.sqrt(max(0.0, 1 - zc * zc))
        d = Vector((rr * math.cos(th), rr * math.sin(th), zc)).normalized()
        rho = math.radians(rnd.uniform(5, 13) if k > 3 else rnd.uniform(14, 19))
        craters.append((d, rho))
    maria = [(Vector((0.3, -0.2, 0.93)).normalized(), 0.55),
             (Vector((-0.5, 0.35, 0.8)).normalized(), 0.42),
             (Vector((0.6, 0.55, 0.58)).normalized(), 0.35)]
    centre = Vector((0, 0, R))
    for v in verts:
        n = (v.co - centre).normalized()
        dr = 0.0
        for d, rho in craters:
            x = n.angle(d) / rho
            if x < 1.0:
                dr -= R * rho * 0.22 * (1 - x * x)
            dr += R * rho * 0.07 * math.exp(-((x - 1.0) / 0.22) ** 2)
        v.co = centre + n * (R + dr)

    def classify(n):
        for d, rho in craters:
            x = n.angle(d) / rho
            if x < 0.75:
                return "moon_dark"
            if x < 1.08:
                return "moon_light"
        for d, ang in maria:
            if n.angle(d) < ang * (1 + 0.25 * _wave(n.x * 5, n.y * 5)):
                return "moon_dark"
        return "moon_grey"

    faces = {f for v in verts for f in v.link_faces}
    for f in faces:
        c = f.calc_center_median()
        f.material_index = b._slot(M(classify((c - centre).normalized())))
    low = min(v.co.z for v in verts)
    for v in verts:
        v.co.z -= low
    bmesh.ops.recalc_face_normals(b.bm, faces=list(faces))
    return m


def satellite():
    HC = 7.0
    m = Model("satellite",
              f"{SCALE_NOTE} Small intact satellite: gold-foil bus with a "
              "white dish and an antenna, two blue solar wings along X.")
    b = m.part("body")
    b.box((12, 12, 14), (0, 0, HC), M("gold_foil"), bevel=0.8)
    b.box((11, 11, 1.2), (0, 0, HC + 7.4), M("mli_silver"))
    _dish(b, 6, 2.4, (0, -2, HC + 8), rot=(20, 0, 0), segs=10)
    b.rod((3, 4, HC + 7), (5, 7, HC + 16), 0.4, M("metal"), segs=4)
    for sx in (-1, 1):
        b.rod((sx * 6, 0, HC), (sx * 9, 0, HC), 0.6, M("metal"), segs=4)
        _solar(b, sx * 19.5, 0, HC, 21, 10, 3, 1, t=0.8)
    return m


def rocket_stage():
    ZC = 9.6
    m = Model("rocket_stage",
              f"{SCALE_NOTE} Spent upper stage lying on its side, long axis "
              "along Z: white tank with an orange insulation band and a black "
              "ring, interstage collar at the front (+Z), engine bell at the "
              "back (-Z).")
    b = m.part("body")
    with b.xform((0, 0, ZC), rot=(-90, 0, 0)):  # local +Z -> Blender +Y (back)
        b.cyl(9, 44, (0, 0, -4), M("hull_white"), segs=14)
        b.cyl(9.3, 14, (0, 0, -8), M("stage_orange"), segs=14)
        b.cyl(9.4, 2.5, (0, 0, 9), M("iron_black"), segs=14)
        b.sphere(9, (0, 0, -26), M("hull_white"), u=14, v=8,
                 scale=(1, 1, 0.5))
        b.cyl(9.6, 6, (0, 0, -30), M("mech_grey"), segs=14, r2=9.2)
        b.cyl(4, 5, (0, 0, 20.5), M("gunmetal"), segs=10, r2=3)
        b.lathe([(3, 22), (6, 30), (8.5, 36), (7.8, 36), (2.4, 23)],
                M("burnt_metal"), segs=14)
        for k in range(4):
            a = k * 90 + 45
            b.box((2.4, 2.4, 3), (9.2 * math.cos(math.radians(a)),
                                  9.2 * math.sin(math.radians(a)), 16),
                  M("gunmetal"))
    return m


def space_junk():
    m = Model("space_junk",
              f"{SCALE_NOTE} A loose cluster of orbital junk: a torn solar "
              "panel, a bent truss, a spherical tank, a broken dish and "
              "scraps of foil and hull.")
    b = m.part("body")
    b._stack.append(Matrix.Translation((0, 0, 1.5)))  # lift onto the floor
    with b.xform((-14, -12, 4), rot=(8, -12, 30)):
        _solar(b, 0, 0, 0, 26, 12, 3, 1, t=1.0)
    b.box((8, 6, 0.8), (-2, -26, 2.5), M("solar_cell"), rot=(14, 6, 70))
    for (a, bb) in (((6, -8, 3), (20, -2, 6)), ((20, -2, 6), (30, 10, 4)),
                    ((8, -6, 2), (22, 0, 2)), ((22, 0, 2), (31, 12, 2))):
        b.rod(a, bb, 1.0, M("steel_light"), segs=4)
    for k in range(4):
        b.rod((8 + 4 * k, -7 + 2 * k, 2), (8 + 4 * k, -7 + 2 * k + 1, 6),
              0.6, M("mech_grey"), segs=4)
    b.sphere(6, (10, 18, 6.5), M("mli_silver"), u=12, v=8)
    b.cyl(1.2, 3, (10, 18, 13), M("gunmetal"), segs=6)
    _dish(b, 8, 3, (-22, 16, 3), rot=(50, 20, 0), segs=10, feed=False)
    rnd = random.Random(5)
    for k in range(12):
        a = k * 137.5
        x, y, _ = polar(a, 8 + 26 * ((k * 0.61) % 1))
        mat = M(("gold_foil", "mli_silver", "burnt_metal", "hull_white")[k % 4])
        if k % 2:
            _rock(b, (x, y, 2), rnd.uniform(1.6, 3.2), mat, seed=1500 + k,
                  scale=(1.4, 1.0, 0.5))
        else:
            _shard(b, (x, y, rnd.uniform(1.5, 4)), (rnd.uniform(4, 7),
                                                    rnd.uniform(3, 5), 0.6),
                   mat, (rnd.uniform(-25, 25), rnd.uniform(-25, 25),
                         rnd.uniform(0, 180)))
    return m


def cloud_swirl():
    m = Model("cloud_swirl",
              f"{SCALE_NOTE} A small weather system seen from orbit: a white "
              "cloud spiral (three trailing arms round a puffy core) with "
              "blue-grey shading.")
    b = m.part("body")
    core = _polar_rows([(1.0, 0.0), (0.85, 4.0), (0.55, 7.5), (0.25, 9.0),
                        (0, 9.5)], 18,
                       lambda a: 20 * (1 + 0.1 * math.sin(math.radians(3 * a))))
    _surface(b, core, lambda i, j, c: M("cloud_blue" if i == 0
                                        else "cloud_white"), wrap=True)
    K = 120.0 / math.log(58 / 14)
    across = [(-1, 0.1), (-0.5, 0.7), (0, 1.0), (0.5, 0.7), (1, 0.1)]
    for arm in range(3):
        a0 = arm * 120
        rows = []
        n = 16
        for i in range(n + 1):
            t = i / n
            r = 14 * (58 / 14) ** t
            a = a0 - K * math.log(r / 14) * 1.6
            w = 16 * math.sqrt(max(0.0, 1 - t)) * min(1.0, 0.6 + 2 * t) + 2
            top = 7 * (1 - t) + 1.5 + 0.8 * _wave(t * 7, arm)
            row = []
            for s, zf in across:
                x, y, _ = polar(a, r + s * w / 2)
                row.append((x, y, max(0.6, top * zf)))
            rows.append(row)
        _surface(b, rows, lambda i, j, c: M(
            "cloud_white" if j in (1, 2) and i < 12 else "cloud_blue"))
    return m


HAZARDS = [debris_satellite, space_station, asat_laser, reentry_burn,
           globe_hurricane, orbital_sweeper, mini_sweeper]
PROPS = [island, atoll, archipelago, ocean_patch, landmass, moon, satellite,
         rocket_stage, space_junk, cloud_swirl]
