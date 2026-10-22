"""Furniture and set-piece models. Blender coords: X right, -Y forward (the
side a person would face / approach), Z up, 1 BU = 1 cm."""

import math
import random

import bmesh
from mathutils import Vector

from common import M, Model


def _sofa(m, width, depth, height, arm_w, n_cushions, fabric, fabric_light,
          gap=6.0):
    """Shared couch/armchair layout with a `gap` cm skirt gap underneath.

    The gap and leg positions (centre 6 cm in from each side, radius 3) match
    the collision data in src/world/furniture.ts (clearance, legs inset 3 size
    6)."""
    b = m.part("body")
    half_w, half_d = width / 2, depth / 2
    inner_w = width - 2 * arm_w
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.cyl(2.5, gap, (sx * (half_w - 6), sy * (half_d - 6), gap / 2),
                  M("wood_dark"), segs=8, r2=3.0)
        b.boxb((arm_w, depth, 62 - gap), (sx * (half_w - arm_w / 2), 0, gap),
               fabric, bevel=4.0, seg=2)
    b.boxb((inner_w, depth, 36 - gap), (0, 0, gap), fabric, bevel=2.0, seg=2)
    back_d = 20.0
    b.boxb((inner_w, back_d, height - 36), (0, half_d - back_d / 2, 36),
           fabric, bevel=3.0, seg=2)
    seat_d = depth - back_d
    cw = inner_w / n_cushions
    for i in range(n_cushions):
        x = -inner_w / 2 + cw * (i + 0.5)
        b.boxb((cw - 1.5, seat_d, 14), (x, -half_d + seat_d / 2, 36),
               fabric_light, bevel=3.5, seg=2)
        with b.xform(center=(x, half_d - back_d - 6, 50), rot=(-10, 0, 0)):
            b.boxb((cw - 3, 13, height - 52), (0, 0, 0), fabric_light,
                   bevel=4.0, seg=2)
    return b


def couch():
    m = Model("couch", "Skirt gap 6 cm under the frame (Bunny can slip under).")
    _sofa(m, 200, 90, 85, 18, 3, M("fabric_teal"), M("fabric_teal_light"))
    return m


def armchair():
    m = Model("armchair", "Skirt gap 9 cm under the frame.")
    _sofa(m, 90, 85, 85, 16, 1, M("fabric_terracotta"),
          M("fabric_terracotta_light"), gap=9.0)
    return m


def coffee_table():
    m = Model("coffee_table", "Open underneath: 38 cm clearance below the top "
              "(no shelf or apron, so a Bunny under 38 cm can roll under).")
    b = m.part("body")
    b.boxb((110, 60, 4), (0, 0, 38), M("wood"), bevel=1.0, seg=2)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.cyl(2.0, 38, (sx * 47, sy * 22, 19), M("wood_dark"), segs=10,
                  r2=2.6)
    return m


def bookshelf():
    m = Model("bookshelf", "Open front faces +Z.")
    b = m.part("body")
    wood, dark = M("wood"), M("wood_dark")
    for sx in (-1, 1):
        b.boxb((2, 30, 180), (sx * 39, 0, 0), wood, bevel=0.5)
    b.boxb((80, 30, 2), (0, 0, 178), wood, bevel=0.5)
    b.boxb((76, 30, 6), (0, 0, 0), dark)
    b.boxb((76, 1, 172), (0, 14.5, 6), dark)
    shelves = [6, 42, 78, 114, 150]
    for z in shelves:
        b.boxb((76, 29, 2), (0, -0.5, z), wood)
    rng = random.Random(7)
    colors = ["book_a", "book_b", "book_c", "book_d", "book_e", "book_blue"]
    tops = shelves[1:] + [178]
    for z, top in zip(shelves, tops):
        space = top - (z + 2)
        x = -37.0
        while True:
            w = rng.uniform(2.5, 5.0)
            if x + w > 37 - rng.uniform(0, 14):
                break
            h = rng.uniform(0.6, 0.9) * space
            d = rng.uniform(19, 24)
            b.boxb((w - 0.3, d, h), (x + w / 2, 13.5 - d / 2, z + 2),
                   M(rng.choice(colors)))
            x += w
        # a small lying stack at the end of the shelf
        if x < 26:
            for k in range(rng.randint(1, 3)):
                b.boxb((14, 19, 2.6), (30, 3, z + 2 + 2.6 * k),
                       M(rng.choice(colors)), rot=(0, 0, rng.uniform(-6, 6)))
    return m


def bed():
    m = Model("bed", "Foot of the bed faces +Z; 24 cm clearance underneath. "
              "Footprint 160 x 205 including head- and footboard.")
    b = m.part("body")
    wood = M("wood")
    c = 24.0  # clearance under the frame
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.cyl(3.0, c, (sx * 73, sy * 95.5, c / 2), M("wood_dark"), segs=8)
    b.boxb((156, 194, 13), (0, 0, c), wood, bevel=1.5, seg=2)
    b.boxb((150, 188, 20), (0, 1, c + 13), M("linen"), bevel=4.0, seg=2)
    b.boxb((156, 132, 22), (0, -28, c + 12), M("fabric_lavender"), bevel=3.0,
           seg=2)
    b.boxb((156, 13, 22.5), (0, 44, c + 12), M("linen"), bevel=3.0, seg=2)
    for sx in (-1, 1):
        b.boxb((60, 34, 12), (sx * 36, 74, c + 33), M("linen"), bevel=5.0,
               seg=2)
    b.boxb((160, 6, 105), (0, 99.5, 0), wood, bevel=2.0, seg=2)
    b.boxb((146, 2, 50), (0, 96, c + 30), M("wood_light"), bevel=1.0)
    b.boxb((160, 5, 26), (0, -100, c), wood, bevel=1.5, seg=2)
    return m


def dining_table():
    m = Model("dining_table", "Open underneath (71 cm clearance below the "
              "top; legs 6 x 6 cm, 6 cm in from the edges).")
    b = m.part("body")
    b.boxb((160, 90, 4), (0, 0, 71), M("wood_light"), bevel=1.0, seg=2)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.boxb((6, 6, 71), (sx * 71, sy * 36, 0), M("wood"), bevel=0.8)
    return m


def chair():
    m = Model("chair", "Seat faces +Z (backrest at -Z).")
    b = m.part("body")
    wood = M("wood")
    b.boxb((45, 46, 5), (0, -2, 40), M("wood_light"), bevel=1.0, seg=2)
    b.boxb((40, 40, 3), (0, -3, 45), M("fabric_terracotta"), bevel=1.2, seg=2)
    for sx in (-1, 1):
        b.boxb((4, 4, 40), (sx * 19.5, -21, 0), wood, bevel=0.5)
        b.boxb((4, 4, 90), (sx * 19.5, 19, 0), wood, bevel=0.5)
    b.box((43, 3.5, 10), (0, 19, 83), wood, bevel=1.0, seg=2)
    for x in (-8, 0, 8):
        b.boxb((4, 2, 33), (x, 19, 45), wood)
    return m


def kitchen_counter():
    m = Model("kitchen_counter", "Cabinet doors face +Z; worktop at 90 cm.")
    b = m.part("body")
    b.boxb((120, 54, 76), (0, 3, 10), M("wood_light"))
    b.boxb((116, 48, 10), (0, 6, 0), M("rubber"))
    b.boxb((122, 62, 4), (0, 0, 86), M("stone"), bevel=0.6)
    b.boxb((42, 32, 0.4), (-26, 1, 90), M("metal"))
    b.boxb((36, 26, 0.5), (-26, 1, 90), M("glass_black"))
    door = M("cabinet_sage")
    for sx in (-1, 1):
        x = sx * 29.5
        b.boxb((57, 1.6, 11.5), (x, -24.8, 72.5), door, bevel=0.6)
        b.boxb((57, 1.6, 59), (x, -24.8, 11.5), door, bevel=0.6)
        b.box((10, 1.4, 1.4), (x, -26.2, 78.2), M("metal"), bevel=0.4)
        b.cyl(1.0, 1.6, (sx * 6, -26.2, 62), M("metal"), segs=8,
              rot=(90, 0, 0))
    return m


def fridge():
    m = Model("fridge", "Doors face +Z.")
    b = m.part("body")
    w = M("appliance_white")
    b.boxb((70, 60, 4), (0, 4, 0), M("rubber"))
    b.boxb((75, 66, 176), (0, 2, 4), w, bevel=4.0, seg=2)
    b.boxb((73, 3, 48), (0, -32, 129), w, bevel=1.5, seg=2)
    b.boxb((73, 3, 121), (0, -32, 6), w, bevel=1.5, seg=2)
    for z0, z1 in ((133, 160), (88, 122)):
        b.rod((-31, -36, z0), (-31, -36, z1), 1.2, M("metal"), segs=8)
        for z in (z0 + 1, z1 - 1):
            b.box((2, 3, 2), (-31, -34.5, z), M("metal"))
    b.boxb((10, 0.3, 12), (14, -33.7, 92), M("paper"))
    b.cyl(2.2, 0.8, (14, -34.2, 102), M("book_a"), segs=10, rot=(90, 0, 0))
    b.cyl(2.0, 0.8, (-6, -33.9, 112), M("book_b"), segs=10, rot=(90, 0, 0))
    b.box((4, 0.8, 4), (8, -33.9, 150), M("book_c"), rot=(0, 20, 0))
    return m


def toilet():
    m = Model("toilet", "Bowl faces +Z, tank at the back (-Z).")
    b = m.part("body")
    p = M("porcelain")
    b.lathe([(0, 0), (12, 0), (11, 3), (9, 12), (10, 26), (0, 26)], p,
            segs=16, center=(0, -4, 0), scale=(1, 1.25, 1))
    b.lathe([(0, 22), (14, 24), (18, 32), (18.5, 39), (0, 39)], p, segs=20,
            center=(0, -9, 0), scale=(1, 1.3, 1))
    b.cyl(19.0, 2.0, (0, -9, 40), p, segs=20, scale=(1, 1.3, 1), bevel=0.6)
    b.cyl(18.0, 2.0, (0, -9.5, 42), M("cloth_blue"), segs=20,
          scale=(1, 1.3, 1), bevel=0.8, seg=2)
    b.boxb((24, 16, 18), (0, 12, 24), p, bevel=2.0)
    b.boxb((40, 18, 36), (0, 24, 40), p, bevel=2.5, seg=2)
    b.boxb((42, 20, 3), (0, 24, 76), p, bevel=1.0, seg=2)
    b.box((6, 1.2, 1.4), (-13, 14.4, 71), M("metal"), bevel=0.3)
    return m


def bathtub():
    m = Model("bathtub", "Long axis along X; tap end at +X. Includes a "
              "rubber duck.")
    b = m.part("body")
    p = M("porcelain")
    for sy in (-1, 1):
        b.boxb((170, 7, 52), (0, sy * 34, 6), p, bevel=2.5, seg=2)
    for sx in (-1, 1):
        b.boxb((7, 62, 52), (sx * 81.5, 0, 6), p, bevel=2.5, seg=2)
        for sy in (-1, 1):
            b.cyl(3.0, 6, (sx * 72, sy * 28, 3), M("metal"), segs=8, r2=4.0)
    b.boxb((158, 62, 6), (0, 0, 6), p)
    b.boxb((157, 61, 1), (0, 0, 40), M("water"))
    # tap
    b.rod((80, 0, 56), (80, 0, 63), 1.3, M("metal"), segs=8)
    b.rod((80, 0, 63), (72, 0, 63), 1.3, M("metal"), segs=8)
    b.sphere(1.3, (80, 0, 63), M("metal"), u=8, v=4)
    for sy in (-1, 1):
        b.cyl(1.8, 2.0, (80, sy * 8, 59), M("metal"), segs=8)
    # duck
    b.sphere(4.0, (-30, 8, 42.5), M("hazard_yellow"), u=12, v=6,
             scale=(1, 1.3, 0.8))
    b.sphere(2.6, (-30, 4, 46.5), M("hazard_yellow"), u=10, v=6)
    b.cone(1.0, 2.0, (-30, 1.2, 46.2), M("hazard_orange"), segs=6,
           rot=(90, 0, 0))
    return m


def rug():
    m = Model("rug", "Flat (about 1 cm). Fringe along the X ends.")
    b = m.part("body")
    b.boxb((200, 140, 0.6), (0, 0, 0), M("rug_red"), bevel=0.2)
    b.boxb((184, 124, 0.25), (0, 0, 0.6), M("rug_cream"))
    b.boxb((172, 112, 0.3), (0, 0, 0.62), M("rug_rose"))
    b.cyl(24, 0.3, (0, 0, 1.0), M("rug_cream"), segs=24, scale=(1.5, 1, 1))
    b.cyl(12, 0.3, (0, 0, 1.15), M("rug_red"), segs=16, scale=(1.5, 1, 1))
    for sx in (-1, 1):
        for i in range(16):
            y = -63 + 126 * i / 15
            b.boxb((7, 1.2, 0.35), (sx * 103, y, 0), M("rug_cream"))
    return m


def laundry_basket():
    m = Model("laundry_basket", "Round wicker basket with clothes piled in.")
    b = m.part("body")
    wk = M("wicker")
    b.lathe([(0, 0), (22, 0), (25, 42), (23.5, 42), (20.5, 3), (0, 3)], wk,
            segs=20)
    for z in (13, 27):
        r = 22 + 3 * z / 42
        b.band(r - 0.4, r + 0.7, z, z + 2.5, 0, 360, M("wood"), segs=20)
    b.torus(24.3, 1.3, (0, 0, 42), M("wood"), segs=20, rsegs=6)
    for sx in (-1, 1):
        b.sphere(2.2, (sx * 24.4, 0, 36), M("eye_black"), u=8, v=4,
                 scale=(0.4, 2.0, 0.7))
    b.sphere(10, (-6, 4, 41), M("cloth_pink"), u=12, v=6, scale=(1.3, 1, 0.5))
    b.sphere(9, (8, -5, 42), M("cloth_blue"), u=12, v=6, scale=(1.2, 1, 0.55))
    b.sphere(8, (3, 9, 44), M("cloth_white"), u=12, v=6, scale=(1.2, 1, 0.5))
    b.sphere(7, (-9, -9, 43), M("cloth_blue"), u=10, v=6, scale=(1.2, 1, 0.5))
    # a shirt sleeve flopped over the rim
    with b.xform(rot=(0, 0, 35)):
        b.box((8, 6, 1.6), (0, -21.5, 43.2), M("cloth_pink"), bevel=0.6,
              rot=(25, 0, 0))
        b.box((7, 1.6, 9), (0, -25.6, 38.5), M("cloth_pink"), bevel=0.6,
              rot=(-6, 0, 0))
    return m


def shoe():
    m = Model("shoe", "Sneaker, toe points +Z.")
    b = m.part("body")
    white, blue, red = M("eye_white"), M("shoe_blue"), M("toy_red")
    b.boxb((10, 28, 3), (0, 0, 0), white, bevel=1.2, seg=2)
    # upper: tall heel block, lower mid block, rounded toe box
    b.boxb((9, 13, 8.5), (0, 7, 2.5), blue, bevel=3.0, seg=2)
    b.boxb((9, 11, 6), (0, -2.5, 2.5), blue, bevel=2.5, seg=2)
    b.sphere(1.0, (0, -8.5, 3.2), blue, u=12, v=8, scale=(4.5, 5.5, 3.4))
    b.sphere(1.0, (0, -11.5, 2.6), white, u=12, v=6, scale=(4.3, 2.6, 1.9))
    # tongue rising from the laces to the collar
    b.box((5, 9, 1.4), (0, -0.5, 8.4), blue, bevel=0.5, rot=(-14, 0, 0))
    for y in (-3.5, -1.5, 0.5, 2.5):
        b.box((5.8, 0.8, 0.5), (0, y, 8.9 + (y + 3.5) * 0.25), white)
    b.box((6.2, 5.5, 1.0), (0, 8.5, 10.6), M("eye_black"))
    b.box((9.3, 7, 1.6), (0, 6, 6.5), red, rot=(-20, 0, 0))
    b.box((3, 2, 4), (0, 13.6, 8.5), red, bevel=0.5)
    return m


def sock():
    m = Model("sock", "Lying flat, L-shaped.")
    b = m.part("body")
    white = M("cloth_white")
    with b.xform(center=(-6.9, -2.2, 0)):
        b.boxb((9, 17, 2.4), (0, 5.5, 0), white, bevel=1.0, seg=2)
        b.boxb((9.2, 3, 2.6), (0, 12.8, 0), M("book_b"), bevel=0.8)
        for y in (8.0, 4.5):
            b.boxb((9.2, 1.6, 2.5), (0, y, 0), M("toy_red"), bevel=0.4)
        b.boxb((18, 8.5, 2.2), (4.5, -6.25, 0), white, bevel=1.0, seg=2)
        b.sphere(4.3, (13.5, -6.25, 1.1), M("toy_red"), u=10, v=6,
                 scale=(1, 1, 0.3))
        b.sphere(4.3, (-1.5, -6.6, 1.15), M("toy_red"), u=10, v=6,
                 scale=(1, 1, 0.3))
    return m


def _smooth(a, b, t):
    t = min(1.0, max(0.0, t))
    return a + (b - a) * t * t * (3 - 2 * t)


def _slipper_outline(x):
    """Right-foot sole outline at x (toe +X, heel -X, 26 cm long): returns
    (centre y, half-width). The big-toe (medial) side is +Y, so the toe tip
    sits a little towards +Y."""
    c = 0.7 * _smooth(0, 1, (x - 1) / 12)
    if x <= -9.4:  # round heel, radius 3.6
        w = math.sqrt(max(0.0, 3.6 ** 2 - (x + 9.4) ** 2))
    elif x <= -3:
        w = 3.6
    elif x <= 4.5:
        w = _smooth(3.6, 5.0, (x + 3) / 7.5)
    elif x <= 8:
        w = _smooth(5.0, 4.85, (x - 4.5) / 3.5)
    else:  # round toe
        w = 4.85 * math.sqrt(max(0.0, 1 - ((x - 8) / 5) ** 2))
    return c, w


def _slipper_xs(n):
    """n + 1 stations heel -> toe, denser at the rounded ends."""
    return [-13 + 26 * (1 - math.cos(math.pi * i / n)) / 2
            for i in range(n + 1)]


def _skin(p, rows, material, wrap=True):
    """Quads between consecutive rows (a one-point row is a pole); returns
    the faces and the vertex rows."""
    bm, mx = p.bm, p._stack[-1]
    vs = [[bm.verts.new(mx @ Vector(pt)) for pt in row] for row in rows]
    idx = p._slot(material)
    faces = []
    for ra, rb in zip(vs, vs[1:]):
        n = max(len(ra), len(rb))
        for j in range(n if wrap else n - 1):
            j2 = (j + 1) % n
            if len(ra) == 1:
                fv = (ra[0], rb[j], rb[j2])
            elif len(rb) == 1:
                fv = (ra[j], ra[j2], rb[0])
            else:
                fv = (ra[j], ra[j2], rb[j2], rb[j])
            f = bm.faces.new(fv)
            f.material_index = idx
            faces.append(f)
    return faces, vs


def slipper():
    m = Model("slipper", "Right house slipper, used for both feet. Toe "
              "along +X like the recipe (not +Z). Thick rounded sole, padded "
              "plush toe box over the front half with a fluffy rolled trim "
              "and a pom, open heel. The plush upper is the largest material "
              "(the one a GLB_TINTED id takes the instance colour on).")
    b = m.part("body")
    b.smooth_angle = math.radians(70)  # soft plush shading
    plush, fluff = M("slipper_plush"), M("slipper_fluff")

    # sole: outsole + cushioned footbed, both following the foot outline
    xs = _slipper_xs(14)
    lateral = [(x, _slipper_outline(x)[0] - _slipper_outline(x)[1])
               for x in xs]
    medial = [(x, _slipper_outline(x)[0] + _slipper_outline(x)[1])
              for x in reversed(xs[1:-1])]
    outline = lateral + medial
    # Same outline and bevel, so the outsole's top cap and the footbed's
    # bottom cap coincide: drop both (hidden) and the bevels leave a seam.
    for (h, zc, mat, up) in ((1.0, 0.5, "slipper_sole", 1),
                             (1.6, 1.8, "slipper_bed", -1)):
        b.prism(outline, h, (0, 0, zc), M(mat), bevel=0.45, seg=2)
        b.bm.normal_update()
        cap = max((f for f in b.bm.faces if f.normal.z * up > 0.99
                   and abs(f.calc_center_median().z - 1.0) < 1e-3),
                  key=lambda f: f.calc_area())
        bmesh.ops.delete(b.bm, geom=[cap], context="FACES_ONLY")

    # toe box: a padded dome stitched to the outsole (it hides the front of
    # the footbed), with squarish arched cross-sections; the opening (throat)
    # leans back from x = -2.5 at the sole to x = 2.5 on top. Its outline is
    # the sole's stretched to `tip`, so the soft toe bulges just past the sole
    # and covers the footbed's front.
    z0, z_bed, x_base, x_top, tip = 1.0, 2.6, -2.5, 2.5, 13.4
    arch = 12

    def height(x):
        h = _smooth(5.5, 4.7, (x - x_top) / 7.5)
        if x > 8.5:
            h *= math.sqrt(max(0.0, 1 - ((x - 8.5) / (tip - 8.5)) ** 2))
        return h

    def section(x, k, swell=0.35):
        a = math.pi * k / arch
        c, w = _slipper_outline(x * 13 / tip)
        w += swell * min(1.0, w / 2)
        ca, sa = math.cos(a), math.sin(a)
        y = c - w * math.copysign(abs(ca) ** 0.7, ca)
        z = z0 + height(x) * abs(sa) ** 0.7
        return y, z

    rows = []
    n_len = 11
    for i in range(n_len):
        s = i / n_len
        row = []
        for k in range(arch + 1):
            sa = math.sin(math.pi * k / arch)
            x0 = x_base + (x_top - x_base) * sa
            x = x0 + (tip - x0) * math.sin(math.pi * s / 2)
            y, z = section(x, k)
            row.append((x, y, z))
        rows.append(row)
    rows.append([(tip, _slipper_outline(13)[0], z0)])
    faces, vs = _skin(b, rows, plush)
    throat = vs[0]
    cap = b.bm.faces.new(list(reversed(throat)))
    cap.material_index = b._slot(plush)
    faces.append(cap)
    bmesh.ops.recalc_face_normals(b.bm, faces=faces)

    # the dark opening, just proud of the throat face, down to the footbed
    u = Vector((x_top - x_base, 0, height(x_top)))  # up the throat plane
    n = Vector((-u.z, 0, u.x)).normalized()
    pts = [Vector(r) for r in rows[0]]
    base = (pts[0] + pts[-1]) / 2
    hole = []
    for p in pts:
        d = p - base
        dy = Vector((0, d.y, 0))
        h = base + dy * 0.8 + (d - dy) * 0.86 + n * 0.06
        if h.z < z_bed + 0.1:
            h += u * ((z_bed + 0.1 - h.z) / u.z)
        hole.append(h)
    hv = [b.bm.verts.new(h) for h in hole]
    f = b.bm.faces.new(hv)
    f.normal_update()
    if f.normal.dot(n) < 0:
        f.normal_flip()
    f.material_index = b._slot(M("slipper_inside"))

    # fluffy rolled trim round the opening: a bobbly tube on the throat edge
    edge = [Vector(r) + n * 0.3 for r in rows[0]]
    trim = [edge[0]]
    for a, c in zip(edge, edge[1:]):
        trim += [(a + c) / 2, c]
    rings = []
    for i, c in enumerate(trim):
        t = (trim[min(i + 1, len(trim) - 1)] - trim[max(i - 1, 0)]).normalized()
        side = t.cross(n).normalized()
        r = 1.1 if i % 2 == 0 else 0.85
        rings.append([tuple(c + r * (math.cos(2 * math.pi * j / 8) * n
                                     + math.sin(2 * math.pi * j / 8) * side))
                      for j in range(8)])
    tube, tv = _skin(b, rings, fluff)
    for ring in (tv[0], tv[-1]):
        e = b.bm.faces.new(ring)
        e.material_index = b._slot(fluff)
        tube.append(e)
    bmesh.ops.recalc_face_normals(b.bm, faces=tube)

    # a pom on the vamp
    px = 7.6
    py, pz = section(px, arch // 2)
    res = bmesh.ops.create_icosphere(b.bm, subdivisions=2, radius=1.0)
    for v in res["verts"]:
        d = v.co.normalized()
        bump = 1 + 0.12 * math.sin(7 * d.x + 3) * math.sin(6 * d.y + 1) \
            * math.sin(5 * d.z + 2)
        v.co = Vector((px, py, pz + 0.4)) + Vector(
            (d.x, d.y, d.z * 0.85)) * 1.6 * bump
    b._finish(res["verts"], fluff)
    return m


def toy_car():
    m = Model("toy_car", "Front faces +Z.")
    b = m.part("body")
    red = M("toy_red")
    b.boxb((5.6, 12, 2.2), (0, 0, 1.0), red, bevel=0.6, seg=2)
    b.boxb((4.8, 5.5, 1.8), (0, 1.0, 3.0), red, bevel=0.6, seg=2)
    b.box((4.6, 5.6, 1.0), (0, 1.0, 3.9), M("window_blue"))
    b.box((4.9, 4.4, 1.0), (0, 1.0, 3.9), M("window_blue"))
    b.boxb((1.2, 12.1, 0.1), (0, 0, 3.15), M("eye_white"))
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.cyl(1.2, 1.0, (sx * 2.6, sy * 3.8, 1.2), M("rubber"), segs=12,
                  rot=(0, 90, 0))
            b.cyl(0.55, 1.1, (sx * 2.65, sy * 3.8, 1.2), M("hazard_yellow"),
                  segs=8, rot=(0, 90, 0))
        b.box((1.0, 0.3, 0.6), (sx * 1.8, -6.05, 2.4), M("lamp_yellow"))
    return m


def book():
    m = Model("book", "Lying flat, spine on -X.")
    b = m.part("body")
    blue = M("book_blue")
    b.boxb((14.2, 22.2, 2.4), (0.3, 0, 0.3), M("paper"))
    b.boxb((15, 23, 0.3), (0, 0, 0), blue)
    b.boxb((15, 23, 0.3), (0, 0, 2.7), blue)
    b.boxb((0.6, 23, 3), (-7.3, 0, 0), blue, bevel=0.25, seg=2)
    b.boxb((9, 3, 0.1), (0.5, -5, 3.0), M("book_c"))
    return m


def tv_remote():
    m = Model("tv_remote", "IR end points +Z.")
    b = m.part("body")
    b.boxb((5, 18, 1.8), (0, 0, 0), M("remote_black"), bevel=0.7, seg=2)
    b.cyl(0.7, 0.4, (1.3, -7.4, 1.85), M("hazard_red"), segs=10)
    b.cyl(1.5, 0.3, (0, -3.6, 1.8), M("button_grey"), segs=12)
    b.cyl(0.6, 0.4, (0, -3.6, 1.95), M("eye_white"), segs=10)
    for i in (-1, 0, 1):
        for j in range(4):
            b.box((0.9, 0.7, 0.3), (i * 1.3, 0.4 + 1.4 * j, 1.85),
                  M("button_grey"))
    b.box((2.5, 0.3, 0.8), (0, -9.05, 1.0), M("glass_black"))
    return m


BUILDERS = [couch, armchair, coffee_table, bookshelf, bed, dining_table, chair,
            kitchen_counter, fridge, toilet, bathtub, rug, laundry_basket]
PROPS = [shoe, sock, slipper, toy_car, book, tv_remote]
