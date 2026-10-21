"""City models (the area after the Neighbourhood): buildings, street props and
city cleaning hazards. Blender coords: X right, -Y forward (the street side /
the way a vehicle drives), Z up, 1 BU = 1 cm."""

import math

from mathutils import Vector

from common import M, Model, polar

SIDE = (90, 0, 90)   # prism(): side profile (y, z) extruded along X
FRONT = (90, 0, 0)   # prism(): front profile (x, z) extruded along Y
AXLE = (0, 90, 0)    # cyl(): axis along X (wheels)


# --------------------------------------------------------------------------
# Shared helpers
# --------------------------------------------------------------------------

def _wheel(b, x, y, r, w, z=None, hub=None, hub_mat="metal", segs=16,
           bevel=0.0):
    """Tyre with its axle along X and a hub cap poking out of both sides."""
    z = r if z is None else z
    b.cyl(r, w, (x, y, z), M("rubber"), segs=segs, rot=AXLE, bevel=bevel)
    b.cyl(hub or r * 0.5, w + 0.8, (x, y, z), M(hub_mat), segs=8, rot=AXLE)


def _bez(p0, p1, p2, p3, n):
    """n + 1 points along a cubic Bezier curve."""
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append(tuple(u ** 3 * a + 3 * u * u * t * b + 3 * u * t * t * c
                         + t ** 3 * d for a, b, c, d in zip(p0, p1, p2, p3)))
    return out


def _hose(p, pts, r, mat, ring=None, segs=10):
    """Tube through `pts`; optional ribs (`ring` material) hide the joints."""
    for a, c in zip(pts, pts[1:]):
        p.rod(a, c, r, mat, segs=segs)
    if ring is not None:
        for i, c in enumerate(pts[1:-1], 1):
            d = (Vector(pts[i + 1]) - Vector(pts[i - 1])).normalized()
            c = Vector(c)
            p.rod(c - d * 1.6, c + d * 1.6, r * 1.15, ring, segs=segs)


def _gores(p, apex, r, rim_z, mats, n=8, thick=2.0):
    """Umbrella canopy: n flat gores from `apex` down to a rim of radius r,
    alternating `mats`. Each gore is a thin closed wedge."""
    bm, mx = p.bm, p._stack[-1]
    ax, ay, az = apex
    for i in range(n):
        a0, a1 = 360 * i / n + 0.4, 360 * (i + 1) / n - 0.4
        mid = (a0 + a1) / 2
        o = polar(mid, 0.6)
        top = [Vector((ax + o[0], ay + o[1], az)),
               Vector(polar(a0, r, rim_z)) + Vector((ax, ay, 0)),
               Vector(polar(a1, r, rim_z)) + Vector((ax, ay, 0))]
        vt = [bm.verts.new(mx @ v) for v in top]
        vb = [bm.verts.new(mx @ (v - Vector((0, 0, thick)))) for v in top]
        bm.faces.new(vt)
        bm.faces.new(list(reversed(vb)))
        for k in range(3):
            l = (k + 1) % 3
            bm.faces.new((vt[k], vb[k], vb[l], vt[l]))
        p._finish(vt + vb, mats[i % len(mats)])


def _brows_and_lights(b, x, y, z, w, sx, frame):
    """Angry slanted headlight (emissive) with a dark brow above it."""
    with b.xform(center=(x, y, z), rot=(0, -sx * 15, 0)):
        b.box((w + 6, 4, 18), (0, 0, 0), frame)
        b.box((w, 4, 12), (0, -1, -1), M("glow_head"))
    b.box((w + 12, 6, 7), (x - sx * 2, y - 2, z + 15), M("rubber"),
          rot=(0, -sx * 24, 0))


# --------------------------------------------------------------------------
# Building helpers. Buildings fill their footprint box exactly: the outermost
# trim (corner piers, bands, sills, parapets, awning edges) reaches the
# footprint edge and nothing goes past it, so "fit": "xz" scales them by 1.
# Wall surfaces sit 10 cm inside the edge so windows can be set into them.
# --------------------------------------------------------------------------

def _win(b, pos, rotz, w, h, frame, glass, fw=8, cross=False):
    """Window whose wall's outer bound (the footprint edge) passes through
    `pos` (window centre). rotz turns the outward normal from -Y (front) to
    +X (90), +Y (180) or -X (-90). Reaches 1 cm short of the edge."""
    with b.xform(center=pos, rot=(0, 0, rotz)):
        b.box((w + 2 * fw, 10, h + 2 * fw), (0, 7, 0), frame)
        b.box((w, 10, h), (0, 6, 0), glass)
        if cross:
            b.box((5, 2, h), (0, 1.2, 0), frame)
            b.box((w, 2, 5), (0, 1.2, h * 0.12), frame)


def _arch_pts(w, h, base=0.0, segs=4):
    """Round-headed opening outline (x, z): width w, total height h."""
    r = w / 2
    pts = [(-r, base), (r, base)]
    for i in range(segs + 1):
        a = math.pi * i / segs
        pts.append((r * math.cos(a), base + h - r + r * math.sin(a)))
    return pts


def _arch(b, pos, rotz, w, h, surround, fill, rim=12):
    """Arched window/door; pos = bottom centre on the footprint edge."""
    with b.xform(center=pos, rot=(0, 0, rotz)):
        b.prism(_arch_pts(w + 2 * rim, h + 2 * rim, -rim), 10, (0, 7, 0),
                surround, rot=FRONT)
        b.prism(_arch_pts(w, h), 10, (0, 6, 0), fill, rot=FRONT)


def _ring(b, hw, hd, z, h, mat, t=10):
    """Perimeter band (four boxes) of thickness t flush with the edge."""
    b.boxb((2 * hw, t, h), (0, -hd + t / 2, z), mat)
    b.boxb((2 * hw, t, h), (0, hd - t / 2, z), mat)
    b.boxb((t, 2 * hd - 2 * t, h), (-hw + t / 2, 0, z), mat)
    b.boxb((t, 2 * hd - 2 * t, h), (hw - t / 2, 0, z), mat)


# --------------------------------------------------------------------------
# Buildings (furniture, "fit": "xz")
# --------------------------------------------------------------------------

def building_office():
    m = Model("building_office", "Glass-and-steel office tower. Fills the "
              "2400 x 2400 footprint exactly; banded teal curtain wall, "
              "recessed glass lobby behind a steel colonnade with a revolving "
              "door and canopy centred on +Z, mechanical plant on the roof.")
    b = m.part("body")
    glass, steel, dark = M("office_glass"), M("steel_light"), M("glass_black")
    E = 1200
    b.boxb((2 * E, 2 * E, 12), (0, 0, 0), M("concrete"))
    # lobby: glass box recessed 150 cm behind a colonnade
    b.boxb((2 * E - 300, 2 * E - 300, 600), (0, 0, 12), glass)
    spots = set()
    for t in (-1170, -780, -390, 0, 390, 780, 1170):
        spots |= {(t, -1170), (t, 1170), (-1170, t), (1170, t)}
    spots.discard((0, -1170))
    for x, y in sorted(spots):
        b.boxb((60, 60, 590), (x, y, 12), steel)
    for sx in (-1, 1):
        for x in (390, 780):
            b.boxb((8, 8, 586), (sx * x, -1052, 12), steel)
    # entrance: revolving door, side doors, canopy, name plate
    yd = -E + 150
    b.cyl(112, 16, (0, yd, 20), steel, segs=16)
    b.cyl(110, 264, (0, yd, 160), dark, segs=16)
    b.cyl(112, 16, (0, yd, 300), steel, segs=16)
    for sx in (-1, 1):
        b.boxb((150, 8, 270), (sx * 210, yd - 4, 12), steel)
        b.boxb((130, 8, 250), (sx * 210, yd - 6, 12), dark)
    b.boxb((900, 150, 24), (0, yd - 75, 400), steel)
    for sx in (-1, 0, 1):
        b.box((40, 40, 2), (sx * 300, yd - 75, 399), M("glow_head"))
    # transfer band over the lobby
    b.boxb((2 * E - 12, 2 * E - 12, 70), (0, 0, 600), M("granite"))
    b.boxb((560, 6, 44), (0, -E + 4, 613), dark)
    b.boxb((60, 6, 30), (-220, -E + 3, 620), glass)
    b.boxb((360, 6, 10), (60, -E + 3, 630), M("eye_white"))
    # curtain wall: glass core, floor bands, mullions, corner columns
    z0, z1 = 670, 5640
    b.boxb((2 * E - 20, 2 * E - 20, z1 - z0), (0, 0, z0), glass)
    for k in range(1, 14):
        b.boxb((2 * E, 2 * E, 36), (0, 0, z0 + k * 360 - 36), steel)
    for t in range(-900, 901, 300):
        b.boxb((16, 10, z1 - z0), (t, -E + 5, z0), steel)
        b.boxb((16, 10, z1 - z0), (t, E - 5, z0), steel)
        b.boxb((10, 16, z1 - z0), (-E + 5, t, z0), steel)
        b.boxb((10, 16, z1 - z0), (E - 5, t, z0), steel)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.boxb((50, 50, z1 - z0), (sx * (E - 25), sy * (E - 25), z0),
                   steel)
    # crown band, roof, parapet
    b.boxb((2 * E, 2 * E, 80), (0, 0, z1), steel)
    b.boxb((2 * E - 60, 2 * E - 60, 4), (0, 0, z1 + 80), M("roof_dark"))
    _ring(b, E, E, z1 + 80, 70, steel, t=30)
    # rooftop plant: penthouse, two cooling towers with fans, ducts
    zr = z1 + 84
    mech = M("mech_grey")
    b.boxb((1000, 700, 220), (-300, 200, zr), mech)
    for z in (60, 120):
        b.boxb((1004, 704, 14), (-300, 200, zr + z), M("bumper_grey"))
    b.boxb((180, 8, 160), (-500, -154, zr), M("door_green"))
    for y in (-420, 40):
        b.boxb((360, 360, 246), (560, y, zr), mech)
        b.cyl(150, 30, (560, y, 5985), M("bumper_grey"), segs=16)
        b.cyl(120, 1, (560, y, 5999.5), M("rubber"), segs=16)
        b.boxb((360, 362, 16), (560, y, zr + 150), M("bumper_grey"))
    b.boxb((80, 600, 80), (300, -190, zr), steel)
    b.boxb((260, 200, 120), (-600, -600, zr), mech)
    b.cyl(30, 140, (-200, -600, zr + 70), steel, segs=10)
    return m


def building_tower():
    m = Model("building_tower", "Slim glass skyscraper. Fills the 2000 x 2000 "
              "footprint exactly; granite podium with a recessed lobby "
              "(entrance centred on +Z), vertical-pier curtain wall, three "
              "setbacks under a pyramid crown topped at 9000 cm, then an "
              "antenna with a red beacon (emissive) to 9500 cm.")
    b = m.part("body")
    glass, steel, granite = M("tower_glass"), M("steel_light"), M("granite")
    dark = M("glass_black")
    E = 1000
    b.boxb((2 * E, 2 * E, 12), (0, 0, 0), M("concrete"))
    # podium: piers flush with the edge, lobby glass recessed 120 cm
    b.boxb((2 * E - 240, 2 * E - 240, 800), (0, 0, 12), M("office_glass"))
    for t in (-600, -200, 200, 600):
        for x, y in ((t, -E + 25), (t, E - 25), (-E + 25, t), (E - 25, t)):
            if y == -E + 25 and abs(t) == 200:
                continue
            b.boxb((50, 50, 800), (x, y, 12), granite)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.boxb((120, 120, 800), (sx * (E - 60), sy * (E - 60), 12),
                   granite)
    b.boxb((2 * E, 2 * E, 60), (0, 0, 812), granite)
    yd = -E + 120
    b.boxb((420, 10, 320), (0, yd - 5, 12), steel)
    for sx in (-1, 1):
        b.boxb((180, 10, 290), (sx * 100, yd - 9, 12), dark)
    b.boxb((560, 120, 20), (0, yd - 60, 380), steel)
    b.boxb((500, 6, 40), (0, -E + 4, 822), dark)
    b.boxb((420, 6, 10), (0, -E + 3, 837), M("brass"))
    # shaft: glass core, steel piers every 200 cm, granite corners
    z0, z1 = 872, 7000
    b.boxb((2 * E - 20, 2 * E - 20, z1 - z0), (0, 0, z0), glass)
    for z in range(z0 + 380, z1 - 100, 400):
        b.boxb((2 * E - 8, 2 * E - 8, 22), (0, 0, z), dark)
    for t in range(-800, 801, 200):
        b.boxb((22, 10, z1 - z0), (t, -E + 5, z0), steel)
        b.boxb((22, 10, z1 - z0), (t, E - 5, z0), steel)
        b.boxb((10, 22, z1 - z0), (-E + 5, t, z0), steel)
        b.boxb((10, 22, z1 - z0), (E - 5, t, z0), steel)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.boxb((60, 60, z1 - z0), (sx * (E - 30), sy * (E - 30), z0),
                   granite)
    # setbacks
    prev, z = E, z1
    for hw, h in ((800, 760), (600, 520), (420, 360)):
        b.boxb((2 * prev, 2 * prev, 40), (0, 0, z), granite)
        z += 40
        b.boxb((2 * hw - 16, 2 * hw - 16, h), (0, 0, z), glass)
        for t in range(-hw + 200, hw - 199, 200):
            b.boxb((22, 8, h), (t, -hw + 4, z), steel)
            b.boxb((22, 8, h), (t, hw - 4, z), steel)
            b.boxb((8, 22, h), (-hw + 4, t, z), steel)
            b.boxb((8, 22, h), (hw - 4, t, z), steel)
        for sx in (-1, 1):
            for sy in (-1, 1):
                b.boxb((50, 50, h), (sx * (hw - 25), sy * (hw - 25), z),
                       granite)
        z += h
        prev = hw
    # crown: lit band, pyramid cap, antenna and beacon
    b.boxb((2 * prev, 2 * prev, 40), (0, 0, z), granite)
    b.boxb((2 * prev - 30, 2 * prev - 30, 14), (0, 0, z - 30),
           M("glow_warm"))
    z += 40
    b.cone(prev * math.sqrt(2), 9000 - z, (0, 0, (9000 + z) / 2), steel,
           segs=4, rot=(0, 0, 45))
    b.rod((0, 0, 8940), (0, 0, 9480), 10, steel, segs=8, r2=3)
    for zz, rr in ((9120, 40), (9280, 26)):
        b.rod((-rr, 0, zz), (rr, 0, zz), 2.5, steel, segs=6)
        b.rod((0, -rr, zz), (0, rr, zz), 2.5, steel, segs=6)
    b.sphere(10, (0, 0, 9490), M("glow_red"), u=8, v=5)
    return m


def building_apartment():
    m = Model("building_apartment", "Five-storey brick apartment block. Fills "
              "the 2000 x 1600 footprint exactly; stoop in a recessed entry "
              "centred on +Z, fire escape in a recessed bay on the +X side, "
              "wooden water tank on the roof reaching 3200 cm.")
    b = m.part("body")
    brick, trim, stone = M("brick_brown"), M("trim_white"), M("stucco_cream")
    glass, iron = M("window_blue"), M("iron_black")
    hw, hd, top = 1000, 800, 2640
    w_in = 10
    bx = 920          # +X bay wall plane (bay spans y -450..450)
    by = -650         # entry recess back wall (x -160..160, z < 420)
    # brick mass, built round the entry recess and the side bay
    b.boxb((bx + hw - w_in, 2 * hd - 2 * w_in - 140, top),
           ((bx - hw + w_in) / 2, 70, 0), brick)
    for x0, x1 in ((-hw + w_in, -160), (160, bx)):
        b.boxb((x1 - x0, 140, top), ((x0 + x1) / 2, -hd + w_in + 70, 0), brick)
    b.boxb((320, 140, top - 420), (0, -hd + w_in + 70, 420), brick)
    for y0, y1 in ((-hd + w_in, -450), (450, hd - w_in)):
        b.boxb((hw - w_in - bx, y1 - y0, top),
               ((bx + hw - w_in) / 2, (y0 + y1) / 2, 0), brick)
    # stone base course and floor belt courses (skip the recesses)
    floors = [120, 620, 1120, 1620, 2120]

    def course(z, h, mat, entry=True):
        if entry:
            b.boxb((2 * hw, 10, h), (0, -hd + 5, z), mat)
        else:
            for x0, x1 in ((-hw, -160), (160, hw)):
                b.boxb((x1 - x0, 10, h), ((x0 + x1) / 2, -hd + 5, z), mat)
        b.boxb((2 * hw, 10, h), (0, hd - 5, z), mat)
        b.boxb((10, 2 * hd - 20, h), (-hw + 5, 0, z), mat)
        for y0, y1 in ((-hd + 10, -450), (450, hd - 10)):
            b.boxb((10, y1 - y0, h), (hw - 5, (y0 + y1) / 2, z), mat)
    course(0, 110, stone, entry=False)
    for z in floors[1:]:
        course(z - 14, 14, stone)
    # cornice and roof
    b.boxb((2 * hw, 2 * hd, 50), (0, 0, top), stone)
    b.boxb((2 * hw - 20, 2 * hd - 20, 30), (0, 0, top + 50), trim)
    roof = top + 80
    b.boxb((2 * hw - 80, 2 * hd - 80, 4), (0, 0, roof), M("roof_dark"))
    _ring(b, hw - 10, hd - 10, roof, 70, brick, t=30)
    _ring(b, hw - 6, hd - 6, roof + 70, 10, stone, t=40)
    # windows: 7 columns front, 6 back, 4 on -X, 2 in the +X bay
    W, H = 110, 220
    for i, z in enumerate(floors):
        zc = z + 250 if i == 0 else z + 230
        for x in (-780, -520, -260, 0, 260, 520, 780):
            if i == 0 and x == 0:
                continue
            _win(b, (x, -hd, zc), 0, W, H, trim, glass)
        for x in (-640, -320, 0, 320, 640):
            _win(b, (x, hd, zc), 180, W, H, trim, glass)
        for y in (-480, 0, 480):
            _win(b, (-hw, y, zc), -90, W, H, trim, glass)
        for y in (-200, 200):
            _win(b, (bx + 10, y, zc), 90, W, H, trim, glass)
    # entry: stoop rising to the door at z 120, door, railings, lamp, lintel
    for k in range(4):
        y0 = -hd + 35 * k
        b.boxb((300, by - y0, 30), (0, (y0 + by) / 2, 30 * k), stone)
    b.boxb((150, 8, 250), (0, by - 2, 120), trim)
    b.boxb((120, 8, 230), (0, by - 4, 120), M("door_green"))
    b.boxb((70, 8, 50), (0, by - 6, 280), glass)
    b.sphere(3.5, (40, by - 9, 230), M("brass"), u=8, v=4)
    for sx in (-1, 1):
        b.rod((sx * 145, -hd + 2, 90), (sx * 145, by, 210), 3, iron, segs=6)
        for k in range(3):
            y = -hd + 10 + 50 * k
            b.rod((sx * 145, y, 30 * k), (sx * 145, y, 30 * k + 95), 2.2,
                  iron, segs=4)
        b.box((14, 10, 22), (sx * 110, by - 6, 330), M("glow_warm"))
    b.boxb((360, 10, 40), (0, -hd + 5, 420), stone)
    # fire escape in the +X bay: platforms, rails, stairs, drop ladder
    xo = hw - 6
    for i, z in enumerate(floors[1:]):
        b.boxb((xo - bx, 860, 6), ((bx + xo) / 2, 0, z - 6), iron)
        b.rod((xo, -430, z + 90), (xo, 430, z + 90), 2.5, iron, segs=4)
        b.rod((xo, -430, z + 45), (xo, 430, z + 45), 1.5, iron, segs=4)
        for y in (-430, -215, 0, 215, 430):
            b.rod((xo, y, z), (xo, y, z + 90), 1.8, iron, segs=4)
        for y in (-430, 430):
            b.rod((bx, y, z + 90), (xo, y, z + 90), 1.8, iron, segs=4)
        if i < 3:
            ys, ye = (-380, 140) if i % 2 == 0 else (380, -140)
            with b.xform(center=((bx + xo) / 2 + 4, (ys + ye) / 2,
                                 z + 250)):
                ang = math.degrees(math.atan2(500, abs(ye - ys)))
                ang = ang if ye > ys else -ang
                b.box((50, math.hypot(500, ye - ys), 8), (0, 0, 0), iron,
                      rot=(ang, 0, 0))
    b.rod((xo - 30, -400, 614), (xo - 30, -400, 250), 1.8, iron, segs=4)
    b.rod((xo - 30, -340, 614), (xo - 30, -340, 250), 1.8, iron, segs=4)
    for z in range(280, 600, 60):
        b.rod((xo - 30, -400, z), (xo - 30, -340, z), 1.2, iron, segs=4)
    # roof: water tank on a steel stand, stair bulkhead, vent
    tx, ty = -480, 260
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.boxb((12, 12, 150), (tx + sx * 70, ty + sy * 70, roof), iron)
    b.boxb((200, 200, 12), (tx, ty, roof + 150), iron)
    b.lathe([(0, roof + 162), (110, roof + 162), (106, roof + 392),
             (0, roof + 392)], M("wood"), segs=12)
    for z in (40, 120, 200):
        b.cyl(109 - z * 0.017, 8, (tx, ty, roof + 162 + z), iron, segs=12)
    b.cone(118, 88, (tx, ty, roof + 392 + 44), M("roof_dark"), segs=12)
    b.boxb((220, 180, 230), (460, -300, roof), brick)
    b.boxb((236, 196, 12), (460, -300, roof + 230), stone)
    b.boxb((90, 8, 190), (460, -394, roof), M("door_green"))
    b.cyl(14, 80, (100, 400, roof + 40), M("metal"), segs=8)
    return m


def building_shops():
    m = Model("building_shops", "Two-storey shop row. Fills the 2400 x 1400 "
              "footprint exactly; three shopfronts on +Z recessed 120 cm "
              "under red / green / blue striped awnings that reach the "
              "edge, flat roof behind a parapet.")
    b = m.part("body")
    wall, trim, glass = M("stucco_cream"), M("trim_white"), M("window_blue")
    shop_glass, frame = M("bin_clear"), M("iron_black")
    hw, hd = 1200, 700
    yr = -hd + 120          # recessed shopfront plane
    g_top, top = 540, 1100
    # masses: recessed ground floor, full upper floor
    b.boxb((2 * hw - 20, hd - 10 - yr, g_top), (0, (yr + hd - 10) / 2, 0),
           wall)
    b.boxb((2 * hw - 20, 2 * hd - 20, top - g_top), (0, 0, g_top), wall)
    b.boxb((2 * hw, 2 * hd, 20), (0, 0, g_top), trim)
    # piers between the shops reach the edge
    for x in (-hw + 25, -400, 400, hw - 25):
        b.boxb((50 if abs(x) > 1000 else 40, 120, g_top), (x, -hd + 60, 0),
               trim)
    shops = (("awning_red", -800), ("awning_green", 0), ("awning_blue", 800))
    for key, cx in shops:
        col = M(key)
        # sign board, lettering and shopfront
        b.boxb((750, 10, 80), (cx, yr - 5, 440), col)
        for k in range(5):
            b.boxb((60, 4, 40), (cx - 200 + 100 * k, yr - 11, 460),
                   M("eye_white"))
        b.boxb((740, 8, 380), (cx, yr - 4, 0), frame)
        b.boxb((440, 8, 280), (cx - 120, yr - 6, 70), shop_glass)
        b.boxb((140, 8, 300), (cx + 240, yr - 6, 10), shop_glass)
        b.boxb((8, 10, 300), (cx + 240, yr - 11, 10), frame)
        b.boxb((40, 6, 6), (cx + 225, yr - 12, 150), M("metal"))
        # window display: a few coloured goods on a shelf
        b.boxb((420, 30, 6), (cx - 120, yr + 20, 90), M("wood"))
        for k, kk in enumerate(("book_a", "book_b", "book_c", "book_e")):
            b.boxb((50, 20, 40 + 15 * (k % 2)),
                   (cx - 280 + 105 * k, yr + 20, 96), M(kk))
        # striped awning from the shopfront to the footprint edge
        prof = [(yr, 400), (-hd, 330), (-hd, 296), (-hd + 6, 296),
                (-hd + 6, 324), (yr, 392)]
        n = 8
        sw = 740 / n
        for i in range(n):
            b.prism(prof, sw - 0.4, (cx - 370 + sw * (i + 0.5), 0, 0),
                    col if i % 2 == 0 else trim, rot=SIDE)
        # upper windows
        for dx in (-200, 200):
            _win(b, (cx + dx, -hd, 810), 0, 150, 220, trim, glass,
                 cross=True)
            _win(b, (cx + dx, hd, 810), 180, 150, 220, trim, glass)
    for sx in (-1, 1):
        for y in (-300, 300):
            _win(b, (sx * hw, y, 810), sx * 90, 150, 220, trim, glass)
    # back: service doors
    for cx in (-800, 0, 800):
        b.boxb((110, 10, 220), (cx + 250, hd - 5, 0), M("mailbox_slate"))
    # cornice, parapet, roof
    b.boxb((2 * hw, 2 * hd, 30), (0, 0, top - 40), trim)
    b.boxb((2 * hw - 40, 2 * hd - 40, 4), (0, 0, top), M("roof_dark"))
    _ring(b, hw, hd, top - 10, 95, wall, t=24)
    _ring(b, hw, hd, top + 85, 15, trim, t=30)
    b.boxb((180, 120, 80), (-600, 250, top + 4), M("mech_grey"))
    b.cyl(40, 4, (-600, 250, top + 86), M("rubber"), segs=12)
    b.boxb((120, 90, 70), (500, 300, top + 4), M("mech_grey"))
    b.cyl(10, 60, (150, 400, top + 34), M("metal"), segs=8)
    return m


def building_brick():
    m = Model("building_brick", "Old four-storey brick warehouse / loft. "
              "Fills the 2200 x 2000 footprint exactly; arched windows, two "
              "arched loading doors and a central entrance on +Z, corbelled "
              "cornice and parapet.")
    b = m.part("body")
    brick, stone, glass = M("brick_red"), M("stucco_cream"), M("loft_glass")
    hw, hd = 1100, 1000
    top = 1880
    b.boxb((2 * hw - 20, 2 * hd - 20, top), (0, 0, 0), brick)
    _ring(b, hw, hd, 0, 80, M("granite"))
    # pilasters at the corners
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.boxb((80, 80, top), (sx * (hw - 40), sy * (hd - 40), 0), brick)
    floors = [80, 530, 980, 1430]
    for z in floors[1:]:
        _ring(b, hw, hd, z - 12, 12, stone)
    # cornice: corbel band, dentils, cap; parapet with coping
    _ring(b, hw, hd, top - 40, 40, brick, t=10)
    _ring(b, hw, hd, top, 30, stone, t=10)
    b.boxb((2 * hw - 40, 2 * hd - 40, 4), (0, 0, top + 30), M("roof_dark"))
    _ring(b, hw, hd, top + 30, 70, brick, t=30)
    _ring(b, hw, hd, 1985, 15, stone, t=40)
    b.boxb((700, 10, 50), (0, -hd + 5, 1935), stone)
    # windows
    W, H = 150, 300
    for i, z in enumerate(floors):
        zb = z + 70
        if i == 0:
            for sx in (-1, 1):
                _arch(b, (sx * 800, -hd, zb), 0, W, H, stone, glass)
                _arch(b, (sx * 420, -hd, z), 0, 300, 380, stone,
                      M("door_green"))
            _arch(b, (0, -hd, z), 0, 160, 300, stone, M("wood_dark"))
        else:
            for x in (-800, -400, 0, 400, 800):
                _arch(b, (x, -hd, zb), 0, W, H, stone, glass)
        for x in (-660, -220, 220, 660):
            _arch(b, (x, hd, zb), 180, W, H, stone, glass)
        for y in (-600, -200, 200, 600):
            _arch(b, (-hw, y, zb), -90, W, H, stone, glass)
            _arch(b, (hw, y, zb), 90, W, H, stone, glass)
    b.boxb((200, 10, 60), (0, -hd + 5, 400), stone)
    b.box((14, 10, 22), (-130, -hd + 5, 300), M("glow_warm"))
    b.box((14, 10, 22), (130, -hd + 5, 300), M("glow_warm"))
    # roof: skylight, chimney stack, hatch
    roof = top + 34
    b.boxb((400, 260, 30), (300, 200, roof), stone)
    b.prism([(-130, 30), (130, 30), (0, 80)], 400, (300, 200, roof),
            glass, rot=SIDE)
    b.boxb((120, 120, 30), (-500, -400, roof), M("mech_grey"))
    return m


# --------------------------------------------------------------------------
# City hazards (true gameplay size, "fit": "none", "collapse": true)
# --------------------------------------------------------------------------

def floor_scrubber():
    m = Model("floor_scrubber", "Ride-on sidewalk scrubber, front +Z. brush "
              "node (scrub disc under the front) spins about its local Y "
              "axis. Orange roof beacon and headlights are emissive.")
    b = m.part("body")
    yel, g, dark = M("hazard_yellow"), M("mower_grey"), M("rubber")
    b.boxb((88, 140, 50), (0, 8, 14), yel, bevel=8, seg=2)
    b.boxb((90, 142, 8), (0, 8, 30), g)
    b.boxb((92, 8, 14), (0, -66, 12), dark, bevel=2)
    # front console with headlights, steering
    b.boxb((80, 34, 34), (0, -44, 62), yel, bevel=6, seg=2)
    for sx in (-1, 1):
        b.box((14, 3, 8), (sx * 26, -61.4, 82), M("glow_head"))
    b.boxb((50, 20, 6), (0, -38, 96), g)
    b.rod((0, -36, 96), (0, -24, 116), 2.4, dark, segs=8)
    b.torus(13, 1.8, (0, -23, 117), dark, segs=14, rsegs=5, rot=(-30, 0, 0))
    b.rod((-12, -23, 117), (12, -23, 117), 1.2, dark, segs=4)
    # water tank, seat
    b.boxb((84, 74, 30), (0, 38, 64), M("bin_clear"), bevel=5)
    b.boxb((86, 76, 4), (0, 38, 92), g)
    b.cyl(9, 4, (-26, 60, 96), M("plastic_blue"), segs=10)
    b.boxb((46, 36, 8), (0, 28, 96), dark, bevel=3)
    b.box((46, 8, 32), (0, 50, 120), dark, rot=(-10, 0, 0), bevel=3)
    for sx in (-1, 1):
        b.box((4, 30, 4), (sx * 25, 28, 108), g)
    # beacon mast
    b.rod((30, 70, 96), (30, 70, 126), 1.8, g, segs=6)
    b.cyl(6, 8, (30, 70, 130), M("glow_amber"), segs=10)
    b.sphere(6, (30, 70, 134), M("glow_amber"), u=10, v=4,
             scale=(1, 1, 0.9))
    # wheels, squeegee
    for sx in (-1, 1):
        _wheel(b, sx * 40, 48, 16, 10, hub_mat="mower_grey", segs=14)
        _wheel(b, sx * 34, -50, 9, 7, hub_mat="mower_grey", segs=10)
        b.rod((sx * 30, 72, 18), (sx * 42, 76, 6), 1.6, g, segs=6)
    b.boxb((95, 6, 8), (0, 77, 1), dark)
    b.boxb((92, 4, 4), (0, 77, 9), g)
    for sx in (-1, 1):
        b.cyl(3, 4, (sx * 45, 77, 4), dark, segs=8, rot=AXLE)
    # deck housing above the scrub disc
    b.cyl(36, 10, (0, -38, 13), g, segs=18)
    hub = (0, -38, 5)
    s = m.part("brush", pivot=hub)
    s.cyl(33, 4, (0, -38, 6), M("plastic_blue"), segs=18)
    s.cyl(34, 3, (0, -38, 2.5), dark, segs=18)
    s.cyl(8, 3, (0, -38, 8.5), M("hazard_orange"), segs=10)
    for k in range(4):
        with s.xform(center=hub, rot=(0, 0, k * 90)):
            s.box((5, 28, 1.2), (0, -18, 3.2), M("hazard_yellow"))
    return m


def pressure_washer():
    m = Model("pressure_washer", "Wheeled gas pressure washer cart. head node "
              "turns about the vertical axis through the origin; the spray "
              "wand points +Z with its nozzle tip at about (0, 92.8, 45) in "
              "model space (head at rest). Hose runs from the pump to the "
              "swivel post.")
    b = m.part("body")
    frame, dark, red = M("iron_black"), M("rubber"), M("hazard_red")
    grey, yel = M("mower_grey"), M("hazard_yellow")
    # tubular frame, feet and wheels
    for sx in (-1, 1):
        b.rod((sx * 24, -32, 6), (sx * 24, 30, 14), 1.8, frame, segs=6)
        b.box((8, 8, 6), (sx * 24, -33, 3), dark)
        _wheel(b, sx * 31, 28, 15, 7, hub_mat="hazard_yellow", segs=14)
        b.rod((sx * 24, 30, 14), (sx * 24, 40, 104), 1.8, frame, segs=6)
    b.rod((-31, 28, 15), (31, 28, 15), 1.4, frame, segs=6)
    b.rod((-24, 40, 104), (24, 40, 104), 1.8, frame, segs=6)
    b.rod((-18, 40.2, 104), (18, 40.2, 104), 2.8, dark, segs=8)
    b.boxb((50, 60, 3), (0, 0, 10), frame)
    # engine, fuel tank, recoil starter, muffler, air filter
    b.boxb((34, 26, 26), (0, 17, 13), grey, bevel=3)
    b.boxb((30, 20, 13), (0, 18, 39), red, bevel=4)
    b.cyl(3, 3, (6, 18, 53), dark, segs=8)
    b.cyl(9, 3, (18.5, 17, 26), red, segs=12, rot=AXLE)
    b.box((2, 6, 2.5), (20.5, 17, 26), dark)
    b.cyl(5, 12, (-21, 18, 26), M("metal"), segs=10, rot=(90, 0, 0))
    b.boxb((10, 12, 12), (-14, 6, 34), dark, bevel=2)
    # pump and hose to the swivel post
    b.cyl(6, 16, (-12, -6, 22), yel, segs=10, rot=(90, 0, 0))
    b.cyl(3, 4, (-12, -15, 22), M("brass"), segs=8, rot=(90, 0, 0))
    hose = _bez((-12, -16, 22), (-12, -30, 24), (0, -18, 14), (0, -4, 15), 5)
    _hose(b, hose, 1.6, dark, segs=6)
    # coiled spare hose hung on the handle
    b.torus(13, 1.8, (0, 41.5, 78), dark, segs=14, rsegs=4, rot=(90, 0, 0))
    b.torus(10, 1.8, (0, 42.5, 76), dark, segs=12, rsegs=4, rot=(90, 0, 0))
    # swivel post up to the head
    b.cyl(4, 6, (0, 0, 16), M("metal"), segs=10)
    b.rod((0, 0, 16), (0, 0, 86), 2.2, M("metal"), segs=8)
    pivot = (0, 0, 90)
    h = m.part("head", pivot=pivot)
    h.cyl(4.2, 8, (0, 0, 88), yel, segs=10)
    h.box((6, 14, 8), (0, -2, 95), dark, bevel=1.5)
    h.box((4, 6, 12), (0, 3, 88), dark, rot=(20, 0, 0), bevel=1)
    h.box((1.5, 4, 5), (0, -1, 88), red)
    h.rod((0, -9, 95), (0, -38, 93), 1.8, M("metal"), segs=6)
    h.cyl(3, 5, (0, -40.5, 92.9), M("hazard_orange"), segs=8,
          rot=(92, 0, 0))
    h.cyl(1.4, 2, (0, -44, 92.8), M("metal"), segs=6, rot=(92, 0, 0))
    return m


def street_flusher():
    m = Model("street_flusher", "Municipal street-flusher water truck, front "
              "+Z: white and blue tank body, cab at the front, spray bar "
              "with seven nozzles across the front bumper (bar at y = 38, "
              "z = 346; nozzles aim forward-down from z = 350). Amber light "
              "bar and headlights are emissive.")
    b = m.part("body")
    white, blue, g = M("sweeper_white"), M("flusher_blue"), M("gunmetal")
    dark, glass = M("rubber"), M("glass_black")
    b.boxb((120, 620, 24), (0, 10, 52), g)
    for y in (-250, 160, 262):
        for sx in (-1, 1):
            _wheel(b, sx * 100, y, 48, 30, segs=16, bevel=2,
                   hub_mat="metal")
    for sx in (-1, 1):
        with b.xform(center=(sx * 100, -250, 48), rot=AXLE):
            b.band(50, 56, -18, 18, -170, -10, blue, segs=8)
        b.boxb((40, 210, 8), (sx * 104, 211, 100), g)
    # cab
    b.boxb((240, 160, 180), (0, -262, 68), white, bevel=12, seg=2)
    b.boxb((242, 162, 20), (0, -262, 100), blue)
    b.box((206, 6, 72), (0, -342, 200), glass, bevel=3)
    for sx in (-1, 1):
        b.box((6, 100, 60), (sx * 120, -268, 196), glass, bevel=2)
        b.rod((sx * 120, -320, 190), (sx * 128, -326, 190), 1.8, g, segs=6)
        b.box((5, 6, 30), (sx * 129, -326, 184), g, bevel=1)
        b.boxb((36, 6, 18), (sx * 86, -344, 120), g)
        b.boxb((30, 6, 12), (sx * 86, -346, 123), M("glow_head"))
        b.box((6, 6, 6), (sx * 116, -343, 236), M("glow_amber"))
    b.boxb((110, 6, 40), (0, -344, 76), g)
    for i in range(5):
        b.boxb((96, 7, 3), (0, -345, 80 + i * 7), M("metal"))
    b.boxb((244, 14, 22), (0, -336, 46), M("metal"))
    b.boxb((180, 30, 10), (0, -262, 248), g)
    b.boxb((170, 26, 12), (0, -262, 256), M("glow_amber"))
    # spray bar with nozzles across the front bumper
    b.rod((-118, -346, 38), (118, -346, 38), 3, M("metal"), segs=8)
    for i in range(7):
        x = -105 + 35 * i
        b.cyl(2.2, 6, (x, -350, 35), M("brass"), segs=6, rot=(-60, 0, 0))
    for sx in (-1, 1):
        b.rod((sx * 60, -336, 46), (sx * 60, -346, 38), 2, g, segs=6)
    # tank: oval cylinder with blue bands and domed ends
    zt = 180
    with b.xform(center=(0, 85, zt), rot=(90, 0, 0), scale=(1.08, 0.8, 1)):
        b.cyl(110, 440, (0, 0, 0), white, segs=20)
        for z in (-170, 0, 170):
            b.cyl(112, 18, (0, 0, z), blue, segs=20)
        b.sphere(110, (0, 0, -220), white, u=20, v=8, scale=(1, 1, 0.22))
        b.sphere(110, (0, 0, 220), white, u=20, v=8, scale=(1, 1, 0.22))
    b.boxb((130, 400, 30), (0, 85, 72), g)
    b.boxb((60, 60, 14), (0, 50, 266), g)
    b.cyl(20, 6, (0, 50, 283), M("metal"), segs=12)
    for sx in (-1, 1):
        b.rod((sx * 50, -100, 280), (sx * 50, 250, 280), 1.6, M("metal"),
              segs=6)
        for y in (-100, 75, 250):
            b.rod((sx * 50, y, 262), (sx * 50, y, 280), 1.4, M("metal"),
                  segs=4)
    # blue water drop decal on each side
    for sx in (-1, 1):
        b.sphere(16, (sx * 117, 85, 160), blue, u=8, v=6,
                 scale=(0.25, 1, 1))
        b.cone(13, 22, (sx * 117, 85, 182), blue, segs=6,
               rot=(0, 0, 0))
    # rear: ladder, tail lights, rear nozzles
    for sx in (-1, 1):
        b.rod((sx * 20, 326, 70), (sx * 20, 316, 270), 1.6, M("metal"),
              segs=4)
        b.box((14, 4, 18), (sx * 100, 336, 90), M("tail_red"))
    for z in range(90, 270, 30):
        b.rod((-20, 324 - (z - 70) * 0.05, z), (20, 324 - (z - 70) * 0.05, z),
              1.2, M("metal"), segs=4)
    b.boxb((220, 12, 16), (0, 330, 60), dark)
    return m


def litter_vacuum():
    m = Model("litter_vacuum", "Electric litter-vacuum cart (Glutton style), "
              "front +Z: green and white cart with a big ribbed intake hose "
              "arcing forward and down to a nozzle on the ground; the "
              "nozzle is centred at about (0, 5, 78) in model space with "
              "its mouth lip at z = 88.")
    b = m.part("body")
    green, white, g = M("glutton_green"), M("sweeper_white"), M("gunmetal")
    dark = M("rubber")
    # chassis and wheels
    b.boxb((70, 110, 14), (0, 20, 14), g, bevel=2)
    for sx in (-1, 1):
        _wheel(b, sx * 39, 50, 19, 9, hub_mat="glutton_green", segs=14)
        _wheel(b, sx * 30, -24, 8, 6, segs=10)
    # collection body: green lower, white upper hood
    b.boxb((78, 96, 70), (0, 22, 26), green, bevel=8, seg=2)
    b.boxb((80, 98, 8), (0, 22, 60), g)
    b.boxb((74, 88, 46), (0, 22, 96), white, bevel=10, seg=2)
    b.boxb((50, 40, 10), (0, 36, 140), white, bevel=4)
    b.box((60, 4, 26), (0, -27, 76), M("glass_black"), bevel=2)
    b.box((8, 3, 4), (-18, -29.2, 84), M("glow_cyan"))
    b.box((40, 2, 10), (0, 71.2, 50), M("eye_white"))
    # handlebar and control box at the back
    for sx in (-1, 1):
        b.rod((sx * 30, 66, 40), (sx * 30, 84, 100), 1.8, g, segs=6)
    b.rod((-34, 84, 100), (34, 84, 100), 2.6, dark, segs=8)
    b.box((24, 10, 14), (0, 76, 92), g, bevel=2, rot=(-20, 0, 0))
    b.box((4, 1.5, 4), (-5, 70.6, 95), M("glow_cyan"), rot=(-20, 0, 0))
    b.box((4, 1.5, 4), (5, 70.6, 95), M("hazard_red"), rot=(-20, 0, 0))
    # orange flag on a whip
    b.rod((-34, 62, 110), (-34, 66, 148), 0.6, g, segs=4)
    b.prism([(0, 0), (14, -4), (0, -10)], 0.8, (-34, 66, 148),
            M("hazard_orange"), rot=(90, 0, 90))
    # intake hose: collar on the hood, ribbed arc, rigid drop to the nozzle
    b.cyl(12, 8, (0, -6, 128), g, segs=12)
    pts = _bez((0, -6, 130), (0, -34, 175), (0, -86, 150), (0, -76, 42), 10)
    _hose(b, pts, 8, M("bumper_grey"), ring=dark, segs=10)
    b.rod((0, -76, 42), (0, -78, 16), 7, M("glutton_green"), segs=10)
    # nozzle: flared mouth on the ground
    b.boxb((34, 18, 10), (0, -78, 2), green, bevel=2)
    b.cyl(9, 8, (0, -78, 15), green, segs=12, r2=7)
    b.boxb((40, 4, 6), (0, -86, 0.5), dark)
    for sx in (-1, 1):
        b.cyl(3, 3, (sx * 21, -76, 3), dark, segs=8, rot=AXLE)
    # support arm from the chassis to the nozzle
    b.rod((0, -26, 22), (0, -70, 12), 2.2, g, segs=6)
    return m


def garbage_truck():
    m = Model("garbage_truck", "Boss. Rear-loader garbage truck, cab +Z, "
              "compactor at -Z. brush_l / brush_r nodes (gutter brushes "
              "under the front bumper corners) spin about local Y. Amber "
              "roof beacons and headlights are emissive.")
    b = m.part("body")
    green, white, g = M("garbage_green"), M("sweeper_white"), M("gunmetal")
    dark, glass, metal = M("rubber"), M("glass_black"), M("metal")
    b.boxb((120, 860, 26), (0, 0, 56), g)
    # wheels with fenders
    for y in (-330, 210, 318):
        for sx in (-1, 1):
            _wheel(b, sx * 104, y, 55, 34, segs=16, bevel=3,
                   hub_mat="hazard_yellow")
    for sx in (-1, 1):
        with b.xform(center=(sx * 104, -330, 55), rot=AXLE):
            b.band(58, 64, -19, 19, -170, -10, green, segs=8)
        b.boxb((44, 240, 10), (sx * 106, 264, 116), g)
    # cab (cab-over), white roof stripe, windows
    b.boxb((256, 200, 200), (0, -342, 70), green, bevel=14, seg=2)
    b.boxb((258, 202, 16), (0, -342, 108), white)
    b.box((220, 6, 80), (0, -443, 210), glass, bevel=3)
    b.box((228, 18, 9), (0, -441, 255), white, rot=(-12, 0, 0))
    for sx in (-1, 1):
        b.box((6, 100, 70), (sx * 128, -350, 208), glass, bevel=2)
        _brows_and_lights(b, sx * 74, -444, 150, 40, sx, g)
        b.rod((sx * 128, -410, 210), (sx * 134, -420, 210), 1.8, g, segs=6)
        b.box((5, 8, 36), (sx * 134, -420, 202), g, bevel=1)
        b.rod((sx * 128, -280, 120), (sx * 128, -280, 240), 1.6, metal,
              segs=6)
    # toothy grille and hazard-striped bumper
    b.boxb((130, 6, 46), (0, -444, 80), g)
    for i in range(6):
        b.cone(7, 16, (-55 + 22 * i, -448, 116), M("spike"), segs=4,
               rot=(180, 0, 45))
    for i in range(7):
        b.boxb((36, 14, 24), (-108 + 36 * i, -443, 40),
               M("hazard_yellow" if i % 2 == 0 else "eye_black"))
    # roof beacons and light bar
    b.boxb((160, 30, 8), (0, -342, 270), g)
    for sx in (-1, 1):
        b.cyl(12, 14, (sx * 60, -342, 285), M("glow_amber"), segs=12)
        b.sphere(12, (sx * 60, -342, 292), M("glow_amber"), u=12, v=5,
                 scale=(1, 1, 0.75))
    b.boxb((60, 20, 10), (0, -342, 278), M("glow_amber"))
    # exhaust stack behind the cab
    b.rod((110, -232, 120), (110, -232, 300), 6, metal, segs=10)
    b.cyl(7, 4, (110, -232, 302), dark, segs=10)
    # body: green box with vertical ribs and a white stripe
    b.boxb((250, 520, 270), (0, 25, 82), green, bevel=10, seg=2)
    b.boxb((252, 522, 30), (0, 25, 200), white)
    for y in range(-195, 260, 75):
        for sx in (-1, 1):
            b.boxb((6, 12, 262), (sx * 125, y, 86), green)
    b.boxb((240, 500, 8), (0, 25, 352), M("bin_lid"))
    # compactor tailgate with hopper, hydraulic rams, steps
    prof = [(285, 84), (285, 372), (340, 380), (430, 300), (452, 180),
            (440, 90)]
    b.prism(prof, 250, (0, 0, 0), green, rot=SIDE)
    b.boxb((210, 18, 100), (0, 448, 96), dark)
    b.boxb((226, 26, 12), (0, 446, 90), g)
    b.box((226, 10, 14), (0, 445, 200), M("hazard_yellow"),
          rot=(-30, 0, 0))
    for sx in (-1, 1):
        b.rod((sx * 127, 300, 140), (sx * 127, 420, 300), 5, metal, segs=8)
        b.rod((sx * 127, 300, 140), (sx * 127, 360, 220), 7, g, segs=8)
        b.boxb((50, 30, 6), (sx * 90, 452, 60), metal)
        b.rod((sx * 110, 452, 120), (sx * 110, 452, 260), 2, metal, segs=6)
        b.box((14, 4, 24), (sx * 115, 455, 300), M("tail_red"))
        b.box((10, 6, 8), (sx * 70, 372, 377), M("glow_amber"))
    # gutter brushes under the front bumper corners
    for name, sx in (("brush_l", -1), ("brush_r", 1)):
        b.rod((sx * 95, -436, 40), (sx * 100, -428, 14), 4, g, segs=8)
        hub = (sx * 100, -428, 5)
        s = m.part(name, pivot=hub)
        s.cyl(9, 8, (sx * 100, -428, 8), g, segs=12)
        s.cyl(5, 2, (sx * 100, -428, 12.5), M("hazard_orange"), segs=10)
        s.lathe([(8, 3), (28, 0.4), (29, 2.2), (9, 7)], M("hazard_yellow"),
                segs=16, center=(sx * 100, -428, 0))
        for k in range(6):
            with s.xform(center=hub, rot=(0, 0, k * 60)):
                s.rod((0, -6, 1.5), (0, -29, -2.4), 2.4, M("eye_black"),
                      segs=5)
    return m


# --------------------------------------------------------------------------
# City props (instanced Debris)
# --------------------------------------------------------------------------

def taxi():
    m = Model("taxi", "Yellow sedan cab with a roof sign and checker band, "
              "front +Z. Always yellow (not tinted).")
    b = m.part("body")
    paint, glass, dark = M("taxi_yellow"), M("glass_black"), M("rubber")
    b.boxb((182, 452, 54), (0, 0, 24), paint, bevel=10, seg=2)
    b.prism([(-80, 76), (-18, 126), (96, 126), (150, 86), (156, 76)], 160,
            (0, 0, 0), glass, rot=SIDE)
    b.prism([(-20, 124), (98, 124), (96, 132), (-16, 132)], 166, (0, 0, 0),
            paint, rot=SIDE, bevel=3)
    for sx in (-1, 1):
        x = sx * 79
        b.rod((x, -78, 78), (x, -17, 128), 3.5, paint, segs=6)
        b.box((7, 9, 50), (x, 40, 102), paint)
        b.rod((x, 95, 128), (x, 152, 80), 4.5, paint, segs=6)
        b.box((8, 12, 8), (sx * 92, -66, 86), paint, bevel=2)
        for y in (-142, 142):
            b.cyl(33, 2, (sx * 91.2, y, 34), dark, segs=12, rot=AXLE)
            b.cyl(31, 24, (sx * 82, y, 31), dark, segs=16, rot=AXLE)
            b.cyl(15, 24.6, (sx * 82, y, 31), M("metal"), segs=8, rot=AXLE)
        # checker band along the doors
        b.boxb((2, 220, 16), (sx * 91.2, 0, 56), M("eye_white"))
        for i in range(11):
            for row in (0, 1):
                if (i + row) % 2 == 0:
                    b.boxb((2.4, 20, 8),
                           (sx * 91.2, -100 + 20 * i, 56 + 8 * row),
                           M("eye_black"))
        b.box((2, 14, 3), (sx * 91.2, 0, 72), dark)
        b.box((34, 4, 14), (sx * 56, -224, 62), M("lamp_yellow"), bevel=1.5)
        b.box((26, 4, 20), (sx * 66, 224, 64), M("tail_red"), bevel=1.5)
    b.box((80, 4, 16), (0, -224.5, 46), glass, bevel=1.5)
    for sy in (-1, 1):
        b.box((184, 10, 16), (0, sy * 226, 32), M("bumper_grey"), bevel=4)
        b.box((40, 2, 12), (0, sy * 231.5, 48 if sy > 0 else 32), M("paper"))
    # roof sign
    b.boxb((50, 12, 4), (0, 40, 132), dark)
    b.boxb((66, 26, 18), (0, 40, 136), M("glow_white"), bevel=3)
    b.boxb((44, 27, 6), (0, 40, 142), M("eye_black"))
    return m


def city_bus():
    m = Model("city_bus", "City bus, front +Z, doors on the -X side. "
              "car_paint (light neutral) is the largest material and is "
              "tinted per instance.")
    b = m.part("body")
    paint, glass, dark = M("car_paint"), M("glass_black"), M("rubber")
    L = 1190
    b.boxb((250, L, 258), (0, 0, 30), paint, bevel=14, seg=2)
    b.boxb((252, L - 20, 20), (0, 0, 30), M("bumper_grey"))
    # windows: continuous band on +X, split round the doors on -X
    b.boxb((2, 960, 96), (125.6, 30, 170), glass)
    b.boxb((2, 80, 96), (-125.6, -430, 170), glass)
    b.boxb((2, 370, 96), (-125.6, -165, 170), glass)
    b.boxb((2, 420, 96), (-125.6, 340, 170), glass)
    for y in range(-440, 520, 120):
        b.boxb((3, 6, 96), (125.6, y, 170), paint)
    for y0, y1 in ((-575, -480), (40, 130)):
        b.boxb((3, y1 - y0, 222), (-125.6, (y0 + y1) / 2, 40), glass)
        b.boxb((3.4, 4, 222), (-125.6, (y0 + y1) / 2, 40), paint)
    # front: windscreen, destination sign, lights, bumper, mirrors
    b.boxb((226, 3, 140), (0, -L / 2 - 1, 110), glass)
    b.boxb((180, 3, 24), (0, -L / 2 - 1.4, 256), M("glow_amber"))
    b.boxb((200, 3, 4), (0, -L / 2 - 1.6, 250), dark)
    for sx in (-1, 1):
        b.box((30, 3, 14), (sx * 95, -L / 2 - 1, 72), M("glow_head"))
        b.box((24, 3, 30), (sx * 100, L / 2 + 1, 80), M("tail_red"))
        b.rod((sx * 124, -560, 250), (sx * 130, -582, 240), 1.8, dark,
              segs=6)
        b.box((5, 10, 32), (sx * 130, -584, 228), dark, bevel=1)
    b.boxb((254, 14, 22), (0, -L / 2 - 4, 30), dark)
    b.boxb((254, 14, 22), (0, L / 2 + 4, 30), dark)
    # rear: engine grille and window
    b.boxb((180, 3, 70), (0, L / 2 + 1, 140), glass)
    b.boxb((150, 3, 50), (0, L / 2 + 1, 64), M("bumper_grey"))
    # roof: air conditioning pod and hatches
    b.boxb((190, 320, 22), (0, 150, 288), paint, bevel=8)
    b.boxb((80, 80, 6), (0, -300, 288), M("bumper_grey"))
    # wheels in dark wells
    for y in (-380, 330):
        for sx in (-1, 1):
            b.cyl(54, 2, (sx * 125.4, y, 55), dark, segs=14, rot=AXLE)
            _wheel(b, sx * 108, y, 50, 32, segs=16, hub=24)
    return m


def food_truck():
    m = Model("food_truck", "Step-van food truck, front +Z. Serving hatch "
              "with a propped awning on the +X side. car_paint (light "
              "neutral) is the largest material and is tinted per instance.")
    b = m.part("body")
    paint, glass, dark = M("car_paint"), M("glass_black"), M("rubber")
    hx = 107
    # box body and cab
    b.boxb((2 * hx, 480, 244), (0, 80, 36), paint, bevel=10, seg=2)
    b.boxb((2 * hx, 150, 210), (0, -235, 36), paint, bevel=10, seg=2)
    b.boxb((200, 50, 90), (0, -290, 36), paint, bevel=12, seg=2)
    b.box((190, 6, 90), (0, -311, 196), glass, bevel=2, rot=(-8, 0, 0))
    for sx in (-1, 1):
        b.box((4, 80, 70), (sx * hx, -240, 190), glass, bevel=2)
        b.box((30, 4, 14), (sx * 70, -315, 100), M("glow_head"))
        b.box((22, 4, 30), (sx * 80, 321, 90), M("tail_red"))
        b.rod((sx * hx, -290, 200), (sx * 115, -300, 200), 1.6, dark, segs=6)
        b.box((5, 8, 26), (sx * 116, -301, 192), dark, bevel=1)
    b.boxb((100, 6, 40), (0, -316, 60), M("bumper_grey"))
    b.boxb((216, 12, 20), (0, -320, 28), dark)
    b.boxb((216, 12, 20), (0, 322, 28), dark)
    b.boxb((2 * hx + 2, 470, 16), (0, 80, 36), M("bumper_grey"))
    # serving hatch on +X: opening, counter, menu, condiments
    y0, y1 = -110, 170
    yc = (y0 + y1) / 2
    b.boxb((4, y1 - y0, 100), (hx + 0.5, yc, 130), M("eye_black"))
    b.boxb((4, y1 - y0 + 16, 8), (hx + 1, yc, 126), M("metal"))
    b.boxb((4, y1 - y0 + 16, 6), (hx + 1, yc, 230), M("metal"))
    b.boxb((30, y1 - y0, 5), (hx + 15, yc, 126), M("metal"))
    for k, key in enumerate(("hazard_red", "hazard_yellow", "hazard_red")):
        b.cyl(4, 16, (hx + 18, y0 + 40 + 30 * k, 139), M(key), segs=8)
    b.boxb((3, 100, 70), (hx + 1, 230, 140), M("eye_black"))
    for k in range(4):
        b.boxb((3.4, 80, 5), (hx + 1.2, 230, 150 + 14 * k), M("eye_white"))
    # propped awning panel above the hatch
    with b.xform(center=(hx + 2, yc, 238), rot=(0, -20, 0)):
        b.box((46, y1 - y0 + 20, 4), (23, 0, 0), M("hazard_red"))
        b.box((4, y1 - y0 + 20, 12), (45, 0, -4), M("eye_white"))
    for y in (y0, y1):
        b.rod((hx + 2, y, 200), (hx + 41, y, 252), 1.2, M("metal"), segs=4)
    # roof: vent hood and a big sign
    b.boxb((80, 80, 26), (0, 200, 280), M("metal"))
    b.boxb((60, 160, 16), (0, -60, 280), M("hazard_yellow"), bevel=4)
    b.sphere(12, (0, -60, 297), M("hazard_red"), u=10, v=6,
             scale=(1, 4, 0.55))
    # wheels
    for y in (-235, 230):
        for sx in (-1, 1):
            b.cyl(42, 2, (sx * (hx + 0.4), y, 42), dark, segs=14, rot=AXLE)
            _wheel(b, sx * 92, y, 38, 26, segs=16, hub=18)
    return m


def dumpster():
    m = Model("dumpster", "Green steel dumpster with two black lids; slanted "
              "front faces +Z, fork pockets on the sides.")
    b = m.part("body")
    green, dark = M("dumpster_green"), M("rubber")
    prof = [(-46, 12), (55, 12), (55, 112), (-58, 112)]
    b.prism(prof, 180, (0, 0, 0), green, rot=SIDE, bevel=2)
    b.prism([(-60, 104), (57, 104), (57, 114), (-60, 114)], 186, (0, 0, 0),
            green, rot=SIDE)
    for sx in (-1, 1):
        b.boxb((6, 70, 16), (sx * 92, 0, 72), green)
        b.boxb((7, 50, 10), (sx * 92.5, 0, 75), M("eye_black"))
        for sy in (-1, 1):
            b.boxb((10, 10, 6), (sx * 78, sy * 44, 6), M("iron_black"))
            b.cyl(6, 5, (sx * 78, sy * 44, 6), dark, segs=10, rot=AXLE)
        # lids hinge at the back
        b.box((88, 120, 5), (sx * 46, -2, 119), dark, rot=(4, 0, 0),
              bevel=1.5)
        b.box((60, 4, 3), (sx * 46, -62, 116), dark)
    b.rod((-90, 58, 116), (90, 58, 116), 2.5, M("iron_black"), segs=8)
    b.box((60, 2, 26), (0, -53, 72), M("eye_white"), rot=(-1.6, 0, 0))
    b.box((44, 2, 6), (0, -54, 72), M("dumpster_green"), rot=(-1.6, 0, 0))
    return m


def newspaper_box():
    m = Model("newspaper_box", "Coin-op newspaper box on a pedestal; window "
              "and pull handle face +Z.")
    b = m.part("body")
    blue, metal = M("news_blue"), M("metal")
    b.boxb((34, 34, 3), (0, 0, 0), M("iron_black"))
    b.boxb((9, 9, 46), (0, 0, 3), M("iron_black"))
    b.boxb((42, 40, 46), (0, 0, 48), blue, bevel=1.5)
    # sloped top with the window door
    b.prism([(-20, 94), (20, 94), (20, 104), (-12, 110), (-20, 110)], 42,
            (0, 0, 0), blue, rot=SIDE, bevel=1)
    b.box((34, 2, 30), (0, -20.6, 78), M("window_blue"))
    b.box((26, 1, 20), (0, -21.8, 76), M("paper"))
    b.box((20, 1, 3), (0, -22.2, 82), M("eye_black"))
    for k in range(3):
        b.box((9, 1, 1.2), (-5.5, -22.2, 77 - 3 * k), M("button_grey"))
    b.box((8, 1, 8), (6, -22.2, 74), M("book_b"))
    b.box((14, 3, 3), (0, -22, 62), metal)
    b.boxb((16, 10, 6), (6, 0, 104), metal)
    b.box((3, 1, 1), (6, -5.2, 107), M("eye_black"))
    b.box((30, 1.4, 8), (0, -20.6, 54), M("eye_white"))
    return m


def hot_dog_cart():
    m = Model("hot_dog_cart", "Stainless hot dog cart with a red and yellow "
              "umbrella; wheels at the -Z end, push handle at -Z, service "
              "side faces +Z along the long axis.")
    b = m.part("body")
    steel, dark = M("metal"), M("rubber")
    b.boxb((80, 130, 70), (0, -5, 26), steel, bevel=3)
    b.boxb((84, 134, 6), (0, -5, 96), steel)
    b.boxb((70, 30, 4), (0, -30, 102), M("iron_black"))
    b.lathe([(0, 102), (14, 102), (14, 112), (12, 116), (0, 116)],
            steel, segs=10, center=(0, 30, 0))
    b.lathe([(0, 102), (14, 102), (14, 112), (12, 116), (0, 116)],
            steel, segs=10, center=(0, -8, 0))
    # sign panels with a hot dog
    for sx in (-1, 1):
        b.boxb((2, 110, 40), (sx * 40.4, -5, 44), M("hazard_red"))
        b.boxb((2.4, 70, 10), (sx * 40.6, -5, 62), M("hazard_yellow"))
        b.boxb((2.6, 50, 6), (sx * 40.8, -5, 64), M("wood_dark"))
    # condiments
    for k, key in enumerate(("hazard_red", "hazard_yellow", "pine_green")):
        b.cyl(3.5, 16, (-28 + 10 * k, 52, 110), M(key), segs=8)
        b.cone(2.5, 5, (-28 + 10 * k, 52, 120.5), M(key), segs=6)
    # wheels, leg, handle
    for sx in (-1, 1):
        _wheel(b, sx * 42, 40, 26, 6, segs=16, hub_mat="metal")
        b.boxb((4, 4, 26), (sx * 34, -66, 0), steel)
        b.rod((sx * 30, 60, 80), (sx * 30, 88, 96), 1.6, steel, segs=6)
    b.rod((-30, 88, 96), (30, 88, 96), 2.2, dark, segs=8)
    # umbrella
    b.rod((0, -5, 102), (0, -5, 214), 2.2, steel, segs=6)
    _gores(b, (0, -5, 214), 88, 178, [M("hazard_red"), M("hazard_yellow")],
           n=8)
    b.sphere(3.5, (0, -5, 216.5), steel, u=8, v=4)
    return m


def street_lamp():
    m = Model("street_lamp", "Cast-iron city lamp post with a lantern head; "
              "the lantern glass is emissive warm white.")
    b = m.part("body")
    iron = M("iron_black")
    b.lathe([(0, 0), (20, 0), (20, 8), (16, 12), (15, 40), (11, 52), (12, 60),
             (8, 70), (0, 70)], iron, segs=12)
    b.lathe([(0, 70), (7, 70), (5, 330), (0, 330)], iron, segs=10)
    for z in (120, 330):
        b.cyl(8.5, 6, (0, 0, z), iron, segs=10, bevel=1)
    # ladder rest crossbar with ball ends
    b.rod((-17, 0, 316), (17, 0, 316), 1.8, iron, segs=6)
    for sx in (-1, 1):
        b.sphere(3, (sx * 18, 0, 316), iron, u=8, v=4)
    # lantern: base, glowing glass, cage posts, roof, finial
    b.lathe([(0, 333), (6, 333), (13, 360), (0, 360)], iron, segs=8)
    b.lathe([(0, 360), (13, 360), (18, 410), (0, 410)], M("glow_warm"),
            segs=6)
    for k in range(6):
        a = k * 60
        p0, p1 = polar(a, 13.5, 360), polar(a, 18.6, 410)
        b.rod(p0, p1, 1.3, iron, segs=4)
    b.cyl(14.5, 4, (0, 0, 360), iron, segs=6)
    b.lathe([(0, 410), (22, 410), (21, 416), (8, 432), (0, 434)], iron,
            segs=6)
    b.sphere(4, (0, 0, 438), iron, u=8, v=4)
    b.cone(2.5, 10, (0, 0, 445), iron, segs=6)
    return m


def phone_booth():
    m = Model("phone_booth", "Red phone booth; glazed door with handle "
              "faces +Z, lit TELEPHONE signs (emissive) on all four sides.")
    b = m.part("body")
    red, glass = M("booth_red"), M("window_blue")
    b.boxb((100, 100, 10), (0, 0, 0), M("concrete"))
    b.boxb((90, 90, 6), (0, 0, 10), red)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.boxb((12, 12, 200), (sx * 40, sy * 40, 16), red)
    # four glazed sides with glazing bars
    for rz in (0, 90, 180, 270):
        with b.xform(rot=(0, 0, rz)):
            b.boxb((68, 4, 170), (0, -40, 28), glass)
            b.boxb((70, 5, 14), (0, -40, 16), red)
            for x in (-12, 12):
                b.boxb((3, 5.4, 170), (x, -40, 28), red)
            for k in range(1, 8):
                b.boxb((68, 5.4, 3), (0, -40, 26 + 21.5 * k), red)
            b.boxb((70, 6, 4), (0, -40, 198), red)
            b.boxb((60, 2, 12), (0, -48.4, 204), M("glow_white"))
            b.boxb((44, 1, 4), (0, -49.4, 208), M("eye_black"))
    b.boxb((96, 96, 20), (0, 0, 200), red)
    b.box((3, 3, 26), (34, -44, 110), M("metal"))
    # crown roof: two crossing barrel vaults
    b.boxb((100, 100, 8), (0, 0, 220), red)
    b.cyl(50, 100, (0, 0, 228), red, segs=16, rot=AXLE, scale=(0.44, 1, 1))
    b.cyl(50, 100, (0, 0, 228), red, segs=16, rot=(90, 0, 0),
          scale=(1, 0.44, 1))
    # phone inside on the back wall
    b.boxb((20, 10, 24), (0, 32, 120), M("eye_black"))
    b.box((6, 6, 18), (-14, 30, 130), M("eye_black"))
    return m


def fire_truck():
    m = Model("fire_truck", "Red fire engine, front +Z: crew cab, silver "
              "equipment lockers, ladder along the roof, red/white light "
              "bar (emissive).")
    b = m.part("body")
    red, white, metal = M("engine_red"), M("trim_white"), M("metal")
    glass, dark, g = M("glass_black"), M("rubber"), M("gunmetal")
    b.boxb((120, 880, 24), (0, 10, 56), g)
    for y in (-310, 250, 350):
        for sx in (-1, 1):
            _wheel(b, sx * 102, y, 50, 32, segs=16, bevel=2,
                   hub_mat="metal")
    for sx in (-1, 1):
        with b.xform(center=(sx * 102, -310, 50), rot=AXLE):
            b.band(52, 58, -18, 18, -170, -10, red, segs=8)
    # crew cab
    b.boxb((246, 230, 214), (0, -345, 62), red, bevel=14, seg=2)
    b.boxb((248, 232, 12), (0, -345, 120), white)
    b.box((216, 6, 80), (0, -461, 214), glass, bevel=3)
    for sx in (-1, 1):
        for y in (-400, -300):
            b.box((6, 80, 64), (sx * 123, y, 214), glass, bevel=2)
        b.boxb((36, 6, 18), (sx * 84, -463, 120), g)
        b.boxb((30, 6, 12), (sx * 84, -465, 123), M("glow_head"))
        b.rod((sx * 123, -440, 200), (sx * 132, -452, 200), 1.8, metal,
              segs=6)
        b.box((5, 8, 34), (sx * 133, -452, 192), metal, bevel=1)
    b.boxb((120, 6, 50), (0, -463, 66), metal)
    b.boxb((250, 18, 22), (0, -462, 36), metal)
    b.boxb((200, 30, 10), (0, -345, 276), g)
    for k in range(5):
        b.boxb((36, 28, 12), (-80 + 40 * k, -345, 286),
               M("glow_red" if k % 2 == 0 else "glow_white"))
    # body with silver lockers
    b.boxb((246, 640, 186), (0, 135, 62), red, bevel=8, seg=2)
    for sx in (-1, 1):
        for y0 in (-200, -60, 80, 300):
            b.boxb((3, 120, 140), (sx * 123.5, y0 + 60, 90), metal)
            for k in range(6):
                b.boxb((3.6, 120, 2), (sx * 123.6, y0 + 60, 100 + 22 * k), g)
        b.boxb((3, 640, 12), (sx * 123.5, 135, 72), white)
        b.box((14, 4, 24), (sx * 100, 456, 110), M("tail_red"))
    b.boxb((240, 6, 120), (0, 455, 100), metal)
    # roof: ladder on supports, turntable, hose reel
    b.boxb((200, 600, 6), (0, 130, 248), g)
    b.cyl(60, 20, (0, 400, 264), metal, segs=16)
    b.cyl(40, 16, (0, 400, 282), red, segs=14)
    for y in (-150, 150):
        b.boxb((140, 10, 30), (0, y, 254), g)
    for sx in (-1, 1):
        b.rod((sx * 40, -260, 292), (sx * 40, 420, 300), 3.5, white, segs=6)
        b.rod((sx * 52, -260, 298), (sx * 52, 420, 306), 2.5, white, segs=6)
    for k in range(14):
        y = -240 + 48 * k
        zz = 292 + (y + 260) / 680 * 8
        b.rod((-40, y, zz), (40, y, zz), 1.6, metal, segs=4)
    for sx in (-1, 1):
        b.cyl(30, 30, (sx * 70, -180, 280), M("hazard_yellow"), segs=12,
              rot=AXLE)
    return m


FURNITURE = [building_office, building_tower, building_apartment,
             building_shops, building_brick]
HAZARDS = [floor_scrubber, pressure_washer, street_flusher, litter_vacuum,
           garbage_truck]
PROPS = [taxi, city_bus, food_truck, dumpster, newspaper_box, hot_dog_cart,
         street_lamp, phone_booth, fire_truck]
