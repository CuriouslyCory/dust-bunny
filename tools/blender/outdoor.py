"""Neighbourhood models (outside the front door): houses, trees, street props
and garden hazards. Blender coords: X right, -Y forward (the street side / the
way a vehicle drives), Z up, 1 BU = 1 cm."""

import math

from common import M, Model, polar

SIDE = (90, 0, 90)  # prism(): side profile (y, z) extruded along X


# --------------------------------------------------------------------------
# House helpers. Houses fill their footprint box exactly (eaves and the front
# step reach the edge, nothing goes past it) so "fit": "xz" scales them by 1.
# --------------------------------------------------------------------------

def _shell(b, hw, hd, wall_h, wall, trim, bands=()):
    """Plinth, walls, corner boards and horizontal trim bands."""
    b.boxb((2 * hw + 8, 2 * hd + 8, 24), (0, 0, 0), M("concrete"))
    b.boxb((2 * hw, 2 * hd, wall_h), (0, 0, 0), wall)
    for z in bands:
        b.boxb((2 * hw + 6, 2 * hd + 6, 10), (0, 0, z), trim)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.boxb((12, 12, wall_h - 24), (sx * hw, sy * hd, 24), trim)


def _gable_roof(b, roof_len, wall_len, half_d, eave, wall_h, ridge, roof,
                wall, trim, thick=14.0):
    """Gable roof with the ridge along X: attic infill, roof slabs, white
    bargeboards on the gable ends and fascia boards along the eaves."""
    s = (ridge - thick - wall_h) / half_d
    zo = ridge - s * eave
    b.prism([(-half_d, wall_h), (half_d, wall_h), (0, ridge - thick)],
            wall_len, (0, 0, 0), wall, rot=SIDE)
    b.prism([(-eave, zo - thick), (-eave, zo), (0, ridge), (eave, zo),
             (eave, zo - thick), (0, ridge - thick)],
            roof_len, (0, 0, 0), roof, rot=SIDE)
    lo = zo - thick
    strip = [(-eave, lo - 10), (-eave, lo), (0, ridge - thick), (eave, lo),
             (eave, lo - 10), (0, ridge - thick - 10)]
    for sx in (-1, 1):
        b.prism(strip, 8, (sx * (roof_len / 2 - 4), 0, 0), trim, rot=SIDE)
    for sy in (-1, 1):
        b.box((roof_len, 6, 10), (0, sy * (eave - 3), lo - 5), trim)
    return s


def _window(b, pos, rotz, w, h, frame, shutter=None, box=None):
    """Window on a wall. `pos` is the centre on the wall surface; rotz turns
    the outward normal from -Y (front) to +X (90), +Y (180) or -X (-90)."""
    with b.xform(center=pos, rot=(0, 0, rotz)):
        b.box((w + 12, 6, h + 12), (0, -1, 0), frame)
        b.box((w, 6, h), (0, -2, 0), M("window_blue"))
        b.box((4, 6, h), (0, -2.5, 0), frame)
        b.box((w, 6, 4), (0, -2.5, 0), frame)
        b.box((w + 20, 10, 5), (0, -3, -h / 2 - 7), frame)
        if shutter is not None:
            for sx in (-1, 1):
                b.box((w * 0.42, 4, h + 8), (sx * (w * 0.71 + 7), -1, 0),
                      shutter)
        if box is not None:
            b.boxb((w + 8, 14, 12), (0, -9, -h / 2 - 22), box)
            for k in range(3):
                b.sphere(6, ((k - 1) * w * 0.32, -10, -h / 2 - 8),
                         M("flower_pink"), u=6, v=4)


def _door(b, pos, rotz, w, h, color, frame):
    """Door with frame, small glazing and a knob. pos z = door bottom."""
    with b.xform(center=pos, rot=(0, 0, rotz)):
        b.boxb((w + 16, 6, h + 8), (0, -1, 0), frame)
        b.boxb((w, 6, h), (0, -2, 0), color)
        b.boxb((w * 0.5, 6, h * 0.2), (0, -2.5, h * 0.66), M("window_blue"))
        b.boxb((w * 0.6, 6, h * 0.28), (0, -2.5, h * 0.12), color)
        b.sphere(3.5, (w * 0.34, -6, h * 0.47), M("brass"), u=8, v=4)


def _step(b, x, hd, w):
    """Two-tread concrete step in front of a door; reaches y = -(hd + 30)."""
    b.boxb((w + 100, 30, 12), (x, -hd - 15, 0), M("concrete"))
    b.boxb((w + 60, 18, 24), (x, -hd - 9, 0), M("concrete"))


def _chimney(b, x, y, z0, z1, size=64):
    b.boxb((size, size, z1 - z0), (x, y, z0), M("brick_red"))
    b.boxb((size + 10, size + 10, 8), (x, y, z1), M("roof_dark"))


def house_a():
    m = Model("house_a", "Two-storey gable house, ridge along X. Fills the "
              "1000 x 800 footprint exactly; front door centred on +Z with a "
              "step.")
    b = m.part("body")
    wall, trim, door = M("siding_blue"), M("trim_white"), M("door_red")
    hw, hd, wh = 480, 370, 560
    _shell(b, hw, hd, wh, wall, trim, bands=(276,))
    _gable_roof(b, 1000, 2 * hw, hd, 400, wh, 750, M("roof_grey"), wall, trim)
    _chimney(b, 320, 170, 520, 770)
    # entry: step, door, little canopy and a porch lamp
    _step(b, 0, hd, 100)
    _door(b, (0, -hd, 24), 0, 100, 220, door, trim)
    b.boxb((180, 28, 8), (0, -hd - 14, 262), trim)
    for sx in (-1, 1):
        b.box((6, 24, 24), (sx * 80, -hd - 12, 250), trim, rot=(45, 0, 0))
    b.box((10, 8, 16), (-90, -hd - 4, 190), M("lamp_yellow"))
    nav = M("shutter_navy")
    w, h = 100, 130
    for x in (-260, 260):
        _window(b, (x, -hd, 150), 0, w, h, trim, shutter=nav)
    for x in (-260, 0, 260):
        _window(b, (x, -hd, 420), 0, w, h, trim, shutter=nav)
        for z in (150, 420):
            _window(b, (x, hd, z), 180, w, h, trim)
    for sx in (-1, 1):
        for y in (-170, 170):
            for z in (150, 420):
                _window(b, (sx * hw, y, z), sx * 90, w, h, trim)
        _window(b, (sx * hw, 0, 630), sx * 90, 56, 56, trim)
    return m


def house_b():
    m = Model("house_b", "Single-storey bungalow, ridge along X. Fills the "
              "1200 x 800 footprint exactly; garage door on the +X half of "
              "the +Z face, front door (with step) on the -X half.")
    b = m.part("body")
    wall, trim = M("siding_yellow"), M("trim_white")
    hw, hd, wh = 580, 370, 280
    _shell(b, hw, hd, wh, wall, trim)
    _gable_roof(b, 1200, 2 * hw, hd, 400, wh, 520, M("roof_brown"), wall,
                trim)
    _chimney(b, -420, 150, 300, 540, size=56)
    # garage (+X half): frame, dark gap, four white panels with top windows
    gx = 300
    b.boxb((344, 8, 244), (gx, -hd - 1, 0), trim)
    b.boxb((320, 8, 232), (gx, -hd - 2, 0), M("garage_gap"))
    for i in range(4):
        b.boxb((312, 8, 52), (gx, -hd - 3, 4 + i * 56.5), trim)
    for i in range(4):
        b.boxb((56, 8, 24), (gx - 114 + i * 76, -hd - 4, 186), M("window_blue"))
    b.box((14, 8, 18), (gx - 190, -hd - 4, 200), M("lamp_yellow"))
    # front door (-X half)
    dx = -300
    _step(b, dx, hd, 100)
    _door(b, (dx, -hd, 24), 0, 100, 220, M("door_green"), trim)
    b.boxb((170, 26, 8), (dx, -hd - 13, 258), trim)
    nav, wood = M("shutter_navy"), M("wood")
    for x in (-480, -110):
        _window(b, (x, -hd, 150), 0, 100, 120, trim, shutter=nav, box=wood)
    for x in (-420, -140, 140, 420):
        _window(b, (x, hd, 150), 180, 100, 120, trim)
    for sx in (-1, 1):
        for y in (-150, 150):
            _window(b, (sx * hw, y, 150), sx * 90, 100, 120, trim)
    _window(b, (-hw, 0, 410), -90, 50, 50, trim)
    _window(b, (hw, 0, 410), 90, 50, 50, trim)
    return m


def house_c():
    m = Model("house_c", "Brick two-storey with a pyramid roof. Fills the "
              "900 x 900 footprint exactly; front door centred on +Z under a "
              "white portico.")
    b = m.part("body")
    brick, trim = M("brick_red"), M("trim_white")
    hw, hd, wh = 430, 420, 560
    b.boxb((2 * hw + 8, 2 * hd + 8, 24), (0, 0, 0), M("concrete"))
    b.boxb((2 * hw, 2 * hd, wh), (0, 0, 0), brick)
    b.boxb((2 * hw + 6, 2 * hd + 6, 10), (0, 0, 278), trim)
    b.boxb((2 * hw + 16, 2 * hd + 16, 16), (0, 0, wh - 16), trim)
    # white quoins up the corners
    for sx in (-1, 1):
        for sy in (-1, 1):
            for k in range(6):
                z = 40 + k * 82
                long_x = k % 2 == 0
                b.boxb((40 if long_x else 22, 22 if long_x else 40, 34),
                       (sx * (hw - (20 if long_x else 11) + 2),
                        sy * (hd - (11 if long_x else 20) + 2), z), trim)
    # pyramid roof reaching the footprint edge (450 cm half-side)
    b.cone(450 * math.sqrt(2), 240, (0, 0, wh + 120), M("roof_dark"), segs=4,
           rot=(0, 0, 45))
    _chimney(b, 230, 160, 600, 760, size=60)
    # portico: step, columns, pediment
    b.boxb((240, 30, 12), (0, -hd - 15, 0), M("concrete"))
    b.boxb((200, 30, 24), (0, -hd - 15, 0), M("concrete"))
    _door(b, (0, -hd, 24), 0, 104, 224, M("shutter_navy"), trim)
    for sx in (-1, 1):
        b.cyl(7, 220, (sx * 82, -hd - 18, 134), trim, segs=10)
    b.boxb((220, 30, 12), (0, -hd - 15, 244), trim)
    b.prism([(-114, 256), (114, 256), (0, 300)], 30, (0, -hd - 15, 0), trim,
            rot=(90, 0, 0))
    b.box((10, 8, 16), (-72, -hd - 4, 200), M("lamp_yellow"))
    w, h = 96, 130
    for x in (-250, 250):
        _window(b, (x, -hd, 150), 0, w, h, trim)
    for x in (-250, 0, 250):
        _window(b, (x, -hd, 420), 0, w, h, trim)
        for z in (150, 420):
            _window(b, (x, hd, z), 180, w, h, trim)
    for sx in (-1, 1):
        for y in (-200, 200):
            for z in (150, 420):
                _window(b, (sx * hw, y, z), sx * 90, w, h, trim)
    return m


# --------------------------------------------------------------------------
# Trees (collision is the trunk only; the canopy spreads far beyond it)
# --------------------------------------------------------------------------

def tree_oak():
    m = Model("tree_oak", "Collision is the trunk only (radius 25 at the "
              "base); the lumpy canopy spreads to about r = 260.")
    b = m.part("body")
    bark = M("bark")
    b.lathe([(0, 0), (25, 0), (21, 30), (17, 140), (16, 360), (0, 360)], bark,
            segs=10)
    for a, z, reach in ((30, 280, 110), (160, 300, 100), (270, 320, 105)):
        b.rod((0, 0, z), polar(a, reach, z + 110), 9, bark, segs=6, r2=5)
    blobs = [
        ((0, 0, 540), 200, "leaf_green"),
        ((130, 30, 470), 125, "leaf_light"),
        ((-120, 55, 480), 120, "leaf_green"),
        ((30, -130, 480), 120, "leaf_light"),
        ((-40, 130, 500), 120, "leaf_light"),
        ((90, 95, 620), 130, "leaf_green"),
        ((-80, -70, 630), 130, "leaf_light"),
        ((20, 10, 700), 110, "leaf_green"),
    ]
    for c, r, key in blobs:
        b.sphere(r, c, M(key), u=10, v=7, scale=(1, 1, 0.9))
    return m


def tree_pine():
    m = Model("tree_pine", "Collision is the trunk only (radius 20 at the "
              "base); stacked-cone canopy spreads to r = 180.")
    b = m.part("body")
    b.lathe([(0, 0), (20, 0), (16, 40), (13, 300), (0, 300)], M("bark"),
            segs=8)
    tiers = [(180, 110, 280), (150, 280, 250), (116, 440, 230), (80, 590, 200),
             (46, 730, 170)]
    for i, (r, z0, h) in enumerate(tiers):
        b.lathe([(r * 0.72, z0), (r, z0 + 20), (0, z0 + h)],
                M("pine_green" if i % 2 == 0 else "pine_dark"), segs=12)
    return m


# --------------------------------------------------------------------------
# Street props (instanced Debris)
# --------------------------------------------------------------------------

def car():
    m = Model("car", "Compact hatchback, front +Z. car_paint (light neutral) "
              "is the largest material and is tinted per instance.")
    b = m.part("body")
    paint, glass, dark = M("car_paint"), M("glass_black"), M("rubber")
    b.boxb((170, 386, 58), (0, 0, 22), paint, bevel=10, seg=2)
    # greenhouse: dark glass block, painted roof slab and pillars
    b.prism([(-70, 78), (-5, 136), (150, 136), (186, 94), (188, 78)], 150,
            (0, 0, 0), glass, rot=SIDE)
    b.prism([(-8, 134), (152, 134), (150, 146), (-4, 146)], 158, (0, 0, 0),
            paint, rot=SIDE, bevel=3)
    for sx in (-1, 1):
        x = sx * 76
        b.rod((x, -72, 80), (x, -5, 138), 3.5, paint, segs=6)
        b.box((7, 9, 58), (x, 62, 108), paint)
        b.rod((x, 150, 138), (x, 188, 84), 4.5, paint, segs=6)
        b.box((8, 12, 8), (sx * 85, -60, 92), paint, bevel=2)
        # wheels sit in dark wheel wells
        for y in (-128, 128):
            b.cyl(34, 2, (sx * 85.2, y, 30), dark, segs=12, rot=(0, 90, 0))
            b.cyl(30, 24, (sx * 78, y, 30), dark, segs=16, rot=(0, 90, 0))
            b.cyl(15, 24.6, (sx * 78, y, 30), M("metal"), segs=8,
                  rot=(0, 90, 0))
        b.box((2, 14, 3), (sx * 85.2, 10, 72), dark)
        b.box((2, 14, 3), (sx * 85.2, 92, 72), dark)
        b.box((34, 4, 14), (sx * 55, -193, 64), M("lamp_yellow"), bevel=1.5)
        b.box((24, 4, 26), (sx * 64, 193, 68), M("tail_red"), bevel=1.5)
        b.box((14, 4, 6), (sx * 62, -198, 30), M("lamp_yellow"))
    b.box((70, 4, 16), (0, -193.5, 46), glass, bevel=1.5)
    for sy in (-1, 1):
        b.box((172, 10, 16), (0, sy * 195, 32), M("bumper_grey"), bevel=4)
        b.box((40, 2, 12), (0, sy * 200.5, 50 if sy > 0 else 32), M("paper"))
    for sx in (-1, 1):
        b.rod((sx * 58, 10, 147), (sx * 58, 140, 147), 2.2, dark, segs=6)
    return m


def mailbox():
    m = Model("mailbox", "Wooden post with a rounded US-style mailbox; door "
              "faces +Z, red flag on the +X side.")
    b = m.part("body")
    wood, slate = M("wood"), M("mailbox_slate")
    b.boxb((10, 10, 95), (0, 0, 0), wood, bevel=1)
    b.boxb((16, 16, 4), (0, 0, 0), M("wood_dark"), bevel=1)
    b.rod((0, -4, 72), (0, -18, 93), 2.2, M("wood_dark"), segs=6)
    b.boxb((16, 42, 3), (0, -10, 92), wood, bevel=0.5)
    b.boxb((18, 46, 10), (0, -10, 95), slate, bevel=1)
    b.cyl(9, 46, (0, -10, 105), slate, segs=14, rot=(90, 0, 0))
    b.cyl(9.5, 1.6, (0, -33.4, 105), slate, segs=14, rot=(90, 0, 0))
    b.boxb((19, 1.6, 10.5), (0, -33.4, 94.5), slate)
    b.box((3, 2, 4), (0, -34.8, 110), M("metal"))
    b.cyl(1.6, 1.2, (9.6, -2, 104), M("metal"), segs=8, rot=(0, 90, 0))
    b.boxb((1.2, 1.4, 20), (10.4, -2, 100), M("hazard_red"))
    b.box((1.2, 12, 7), (10.4, -7.4, 116.4), M("hazard_red"))
    return m


def trash_can():
    m = Model("trash_can", "Green wheelie bin; lid hinges at the back (-Z) "
              "where the two wheels and the handle are.")
    b = m.part("body")
    green, lid = M("bin_green"), M("bin_lid")
    with b.xform(center=(0, 0, 53.5), scale=(52, 60, 1)):
        b.cyl(0.7071, 89, (0, 0, 0), green, segs=4, r2=0.7071 * 1.1,
              rot=(0, 0, 45))
    b.boxb((60, 68, 5), (0, 0, 98), lid, bevel=1.5)
    b.box((36, 3, 5), (0, -34.5, 98), lid, bevel=1)
    b.rod((-26, 35.5, 102.5), (26, 35.5, 102.5), 2.2, lid, segs=8)
    for sx in (-1, 1):
        b.box((6, 8, 10), (sx * 23, 33, 97), lid)
        b.cyl(10, 6, (sx * 24, 29, 10), M("rubber"), segs=14, rot=(0, 90, 0))
        b.cyl(4.5, 6.4, (sx * 24, 29, 10), M("button_grey"), segs=8,
              rot=(0, 90, 0))
    b.rod((-21, 29, 10), (21, 29, 10), 1.6, M("metal"), segs=6)
    b.boxb((40, 6, 9), (0, -24, 0), M("rubber"))
    b.box((22, 0.8, 16), (0, -30.4, 72), M("paper"), rot=(-1.9, 0, 0))
    b.box((10, 0.8, 4), (0, -30.6, 76), M("bin_lid"), rot=(-1.9, 0, 0))
    return m


def bicycle():
    m = Model("bicycle", "Upright on its kickstand, front wheel +Z. "
              "bike_frame (light neutral) is the largest material and is "
              "tinted per instance.")
    b = m.part("body")
    frame, dark, metal = M("bike_frame"), M("rubber"), M("metal")
    R, r = 32.5, 2.6
    zc = R + r
    rear, front = (0, 52, zc), (0, -52, zc)
    for hub, a0, a1 in ((rear, -195, -40), (front, -150, -15)):
        b.torus(R, r, hub, dark, segs=18, rsegs=5, rot=(0, 90, 0))
        b.torus(R - 3, 1.0, hub, metal, segs=16, rsegs=3, rot=(0, 90, 0))
        b.cyl(2.6, 9, hub, metal, segs=6, rot=(0, 90, 0))
        for k in range(6):
            a = math.radians(k * 60 + 30)
            rim = (0, hub[1] + (R - 3) * math.cos(a),
                   hub[2] + (R - 3) * math.sin(a))
            b.rod(hub, rim, 0.45, metal, segs=3)
        with b.xform(center=hub, rot=(0, 90, 0)):
            b.band(R + 4, R + 5.5, -3.5, 3.5, a0, a1, frame, segs=10)
    bb, st, ht, hb = (0, 8, 30), (0, 22, 80), (0, -36, 82), (0, -40, 66)
    tube = 2.8
    for a, c in ((bb, st), (st, ht), (bb, hb), (hb, ht)):
        b.rod(a, c, tube, frame, segs=8)
    for sx in (-1, 1):
        b.rod((sx * 4, 8, 30), (sx * 4.5, 52, zc), 2.0, frame, segs=6)
        b.rod((sx * 2, 22, 79), (sx * 4.5, 52, zc), 2.0, frame, segs=6)
        b.rod((sx * 2, -40, 67), (sx * 4.5, -52, zc), 2.4, frame, segs=6)
    # chain guard and rear rack in frame colour
    b.box((1.6, 46, 9), (6.5, 30, 32), frame, rot=(4, 0, 0), bevel=0.6)
    b.box((14, 34, 1.6), (0, 56, 74), frame)
    for sx in (-1, 1):
        b.rod((sx * 6, 70, 74), (sx * 5, 52, zc), 1.0, frame, segs=4)
    # seat, bars, cranks, kickstand
    b.rod(st, (0, 25, 90), 1.6, metal, segs=6)
    b.box((13, 24, 5), (0, 28, 92), dark, bevel=2)
    b.rod(ht, (0, -38, 96), 1.8, metal, segs=6)
    b.rod((-26, -40, 97), (26, -40, 97), 1.4, metal, segs=6)
    for sx in (-1, 1):
        b.rod((sx * 18, -40, 97), (sx * 28, -40, 97), 2.4, dark, segs=6)
    b.cyl(9, 1.4, (5.5, 8, 30), metal, segs=14, rot=(0, 90, 0))
    for sx, dz in ((1, -1), (-1, 1)):
        p = (sx * 7.5, 8 + dz * 7, 30 + dz * 13)
        b.rod((sx * 6, 8, 30), p, 1.0, metal, segs=4)
        b.box((8, 4, 2), (sx * 11, p[1], p[2]), dark)
    b.rod((3, 14, 28), (14, 22, 0.8), 1.0, M("gunmetal"), segs=4)
    b.box((2.5, 1.2, 1.2), (-6.5, -46, 72), M("lamp_yellow"))
    return m


def garden_gnome():
    m = Model("garden_gnome", "Red pointy hat, white beard, blue coat; faces "
              "+Z on a small stone base.")
    b = m.part("body")
    skin = M("skin")
    b.cyl(9, 2, (0, 0, 1), M("rock_grey"), segs=12, bevel=0.6)
    for sx in (-1, 1):
        b.sphere(2.4, (sx * 2.6, -1.6, 3.0), M("wood_dark"), u=8, v=4,
                 scale=(1, 1.5, 0.7))
        b.rod((sx * 4.6, 0, 17), (sx * 5.8, -3.6, 11.5), 1.4,
              M("plastic_blue"), segs=6)
        b.sphere(1.5, (sx * 5.8, -3.9, 10.8), skin, u=8, v=4)
        b.sphere(0.55, (sx * 1.5, -3.8, 23.6), M("eye_black"), u=6, v=4)
    b.lathe([(0, 2.5), (7.2, 2.5), (7.0, 5), (5.2, 17), (3.2, 20), (0, 20.5)],
            M("plastic_blue"), segs=12)
    b.cyl(6.6, 1.6, (0, 0, 10.5), M("eye_black"), segs=12)
    b.box((2.4, 0.8, 2.0), (0, -6.6, 10.5), M("hazard_yellow"))
    b.sphere(4.2, (0, 0, 22.2), skin, u=10, v=6)
    b.sphere(1.0, (0, -2.6, 18.6), M("cloth_white"), u=10, v=6,
             scale=(4.0, 2.6, 5.4))
    b.sphere(1.3, (0, -4.4, 22.4), M("skin_pink"), u=8, v=4)
    with b.xform(center=(0, 0, 24.8), rot=(10, 0, 0)):
        b.cyl(4.9, 1.6, (0, 0, 0), M("toy_red"), segs=12)
        b.cone(4.7, 15.5, (0, 0, 8.4), M("toy_red"), segs=12)
    return m


def fire_hydrant():
    m = Model("fire_hydrant", "Red hydrant with silver caps: pumper cap faces "
              "+Z, hose caps on +/-X.")
    b = m.part("body")
    red, metal = M("hydrant_red"), M("metal")
    b.cyl(15, 4, (0, 0, 2), red, segs=16, bevel=1)
    for k in range(6):
        b.cyl(1.2, 2, polar(k * 60 + 30, 12.5, 4.6), metal, segs=6)
    b.cyl(10.5, 46, (0, 0, 27), red, segs=16)
    b.cyl(12.5, 4, (0, 0, 52), red, segs=16, bevel=0.8)
    b.lathe([(11, 54), (10.5, 58), (7, 64), (3.5, 66.5), (0, 67)], red,
            segs=16)
    b.cyl(3, 6, (0, 0, 70), metal, segs=5)
    b.cyl(2.2, 2, (0, 0, 74), metal, segs=8)
    for sx in (-1, 1):
        b.cyl(4.5, 6, (sx * 12.5, 0, 40), red, segs=10, rot=(0, 90, 0))
        b.cyl(5.2, 3, (sx * 16.5, 0, 40), metal, segs=10, rot=(0, 90, 0),
              bevel=0.4)
        b.cyl(1.8, 2, (sx * 18.8, 0, 40), metal, segs=5, rot=(0, 90, 0))
    b.cyl(6.5, 6, (0, -12.5, 36), red, segs=12, rot=(90, 0, 0))
    b.cyl(7.2, 4, (0, -16.5, 36), metal, segs=12, rot=(90, 0, 0), bevel=0.5)
    b.cyl(2.2, 2, (0, -19.4, 36), metal, segs=5, rot=(90, 0, 0))
    return m


# --------------------------------------------------------------------------
# Garden hazards (true gameplay size)
# --------------------------------------------------------------------------

def robo_mower():
    m = Model("robo_mower", "Robotic lawn mower, front +Z. blade node spins "
              "about its local Y axis (pivot under the centre).")
    b = m.part("body")
    lime, grey = M("mower_lime"), M("mower_grey")
    with b.xform(scale=(1, 1.15, 1)):
        b.cyl(44, 10, (0, 0, 9), grey, segs=24)
        b.lathe([(0, 12), (45, 12), (45.5, 16), (41, 23), (30, 27), (0, 28)],
                lime, segs=24)
        b.band(44.5, 46.6, 6, 15, -60, 60, M("rubber"), segs=10, bevel=0.5)
        b.band(43.8, 44.8, 17, 20, -40, 40, M("glass_black"), segs=8)
        b.band(44.5, 46.0, 7, 13, 150, 210, grey, segs=6)
    for sx in (-1, 1):
        b.cyl(11, 7, (sx * 40, 24, 11), M("rubber"), segs=16, rot=(0, 90, 0),
              bevel=1)
        b.cyl(5, 7.4, (sx * 40, 24, 11), lime, segs=10, rot=(0, 90, 0))
        # roomba-style eyes and brows on the flat top
        b.cyl(3.8, 0.6, (sx * 7.5, -24, 27.6), M("eye_white"), segs=12)
        b.cyl(1.8, 0.6, (sx * 7.2, -25.2, 27.9), M("eye_black"), segs=10)
        b.box((6.5, 1.3, 0.6), (sx * 8.0, -29.2, 27.7), M("eye_black"),
              rot=(0, 0, sx * -18))
    b.cyl(4, 5, (0, -40, 4), M("rubber"), segs=10, rot=(0, 90, 0))
    b.cyl(12, 1, (0, 10, 28), grey, segs=16)
    b.cyl(4.5, 2.4, (0, 10, 29.2), M("hazard_red"), segs=12, bevel=0.4)
    b.rod((16, 28, 24), (16, 30, 30.2), 0.6, grey, segs=6)
    b.sphere(1.0, (16, 30, 30.4), M("hazard_red"), u=6, v=4)
    hub = (0, 0, 2.2)
    s = m.part("blade", pivot=hub)
    s.cyl(16, 0.8, hub, M("metal"), segs=16)
    s.cyl(4, 1.6, hub, grey, segs=10)
    for k in range(3):
        with s.xform(center=hub, rot=(0, 0, k * 120)):
            s.box((3.5, 8, 0.5), (0, -17, 0), M("spike"))
    return m


def lawn_mower():
    m = Model("lawn_mower", "Unmanned red push mower; deck centred on the "
              "origin, front +Z, handle and grass bag rise towards -Z.")
    b = m.part("body")
    red, dark = M("hazard_red"), M("rubber")
    b.lathe([(0, 6), (34, 6), (35, 9), (34, 19), (29, 22), (0, 22)], red,
            segs=20)
    b.band(34.5, 36, 6, 12, -40, 40, dark, segs=6)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.cyl(10, 6, (sx * 35, sy * 24, 10), dark, segs=14,
                  rot=(0, 90, 0), bevel=1)
            b.cyl(4.5, 6.4, (sx * 35, sy * 24, 10), M("hazard_yellow"),
                  segs=8, rot=(0, 90, 0))
    b.box((14, 18, 9), (31, 14, 15), dark, bevel=2, rot=(0, 0, 20))
    # engine
    b.cyl(13, 14, (0, 2, 29), M("metal"), segs=14)
    b.cyl(14, 4, (0, 2, 38), red, segs=14, bevel=1)
    b.box((12, 8, 6), (0, -8, 42), dark, bevel=1.5)
    b.cyl(2.4, 2.5, (7, 6, 41), M("hazard_yellow"), segs=8)
    b.box((7, 3, 3), (-5, 10, 42), dark, bevel=1)
    # handle, bail lever, crossbars
    g = M("gunmetal")
    for sx in (-1, 1):
        b.rod((sx * 22, 22, 20), (sx * 22, 60, 96), 1.6, g, segs=8)
        b.box((5, 8, 8), (sx * 22, 23, 20), g)
    b.rod((-22, 60, 96), (22, 60, 96), 1.6, g, segs=8)
    b.rod((-16, 60.5, 96.5), (16, 60.5, 96.5), 2.4, dark, segs=8)
    b.rod((-22, 41, 58), (22, 41, 58), 1.2, g, segs=6)
    b.rod((-19, 56, 90), (19, 56, 90), 1.0, M("metal"), segs=6)
    b.rod((-5, 10, 42), (-20, 50, 78), 0.4, dark, segs=4)
    # grass bag behind the deck
    b.box((34, 26, 26), (0, 44, 31), M("bag_green"), bevel=5, seg=2,
          rot=(-20, 0, 0))
    b.box((36, 4, 28), (0, 31, 31), g, bevel=1, rot=(-20, 0, 0))
    return m


def leaf_blower():
    m = Model("leaf_blower", "Orange backpack leaf blower set down on the "
              "ground; the blower tube runs along the floor to the nozzle at "
              "about (0, 4.5, 45) in model space, blowing +Z.")
    b = m.part("body")
    orange, g, dark = M("hazard_orange"), M("gunmetal"), M("rubber")
    b.boxb((38, 28, 3), (0, 22, 0), g, bevel=1)
    b.boxb((34, 5, 37), (0, 36, 3), dark, bevel=1.5)
    for sx in (-1, 1):
        b.box((5, 2, 26), (sx * 10, 39.5, 24), dark, rot=(-10, 0, 0))
    # fan volute (axis along X) with intake grille on -X
    b.cyl(16, 16, (-3, 18, 18.5), orange, segs=18, rot=(0, 90, 0), bevel=2)
    b.cyl(10, 1, (-11.4, 18, 18.5), dark, segs=14, rot=(0, 90, 0))
    b.cyl(3, 1.6, (-11.6, 18, 18.5), M("metal"), segs=8, rot=(0, 90, 0))
    # engine, recoil starter, fuel tank
    b.boxb((14, 16, 16), (12, 22, 8), g, bevel=2)
    b.cyl(6, 2, (19.5, 22, 16), orange, segs=12, rot=(0, 90, 0))
    b.box((2, 6, 2.5), (21, 22, 16), dark)
    b.boxb((14, 12, 8), (12, 24, 24), M("bin_clear"), bevel=1.5)
    b.cyl(2.2, 1.6, (12, 24, 32.6), M("hazard_yellow"), segs=8)
    # carry handle on top
    b.rod((-8, 30, 38.4), (10, 30, 38.4), 1.6, dark, segs=8)
    for x in (-8, 10):
        b.rod((x, 30, 38.4), (x, 34, 33), 1.4, dark, segs=6)
    # outlet, ribbed flexible hose, rigid tube, nozzle
    b.rod((-3, 10, 6), (-3, 0, 6), 4.6, orange, segs=10)
    b.rod((-3, 0, 5.6), (-3, -14, 5.2), 4.0, dark, segs=10)
    for i in range(4):
        b.cyl(4.8, 1.8, (-3, -1.5 - 3.4 * i, 5.5), dark, segs=10,
              rot=(90, 0, 0))
    b.rod((-3, -14, 5.0), (0, -40, 4.5), 4.0, orange, segs=10, r2=3.6)
    b.rod((0, -40, 4.5), (0, -45, 4.5), 3.6, dark, segs=10, r2=3.2)
    b.box((5, 10, 8), (-2, -22, 11), dark, bevel=1.5)
    b.box((2, 3, 4), (-1.8, -20, 6.5), M("hazard_red"))
    return m


def sprinkler():
    m = Model("sprinkler", "Impact sprinkler on a tripod. head node turns "
              "about the vertical axis through the origin; nozzle points +Z "
              "with its tip at about (0, 62.9, 13.7) in model space (head at "
              "rest).")
    b = m.part("body")
    g = M("gunmetal")
    for k in range(3):
        a = k * 120 + 60
        b.rod(polar(a, 4, 38), polar(a, 42, 1.4), 1.2, g, segs=6)
        b.sphere(2.5, polar(a, 42, 1.2), M("rubber"), u=8, v=4,
                 scale=(1, 1, 0.5))
    b.cyl(5, 6, (0, 0, 38), g, segs=10)
    b.cyl(3, 4, (0, 2, 33), M("hazard_yellow"), segs=8, rot=(60, 0, 0))
    hose = M("hose_green")
    b.rod((0, 3, 32), (0, 12, 3), 1.8, hose, segs=8)
    b.rod((0, 12, 3), (0, 38, 1.8), 1.8, hose, segs=8)
    b.rod((0, 0, 41), (0, 0, 50.5), 1.3, M("metal"), segs=8)
    pivot = (0, 0, 50)
    h = m.part("head", pivot=pivot)
    brass = M("brass")
    h.cyl(2.6, 4, (0, 0, 52), brass, segs=10)
    h.box((4, 6, 6), (0, 0, 57), brass, bevel=0.8)
    h.rod((0, -1, 57), (0, -13, 62.5), 1.1, brass, segs=8)
    h.cyl(1.5, 1.2, (0, -13.2, 62.6), brass, segs=8, rot=(65, 0, 0))
    h.rod((0, 0, 58), (0, 0, 69.5), 0.6, M("metal"), segs=6)
    h.torus(1.6, 0.5, (0, 0, 62), M("metal"), segs=8, rsegs=4)
    h.rod((0, 5, 65), (0, -11, 65), 0.8, g, segs=6)
    h.box((3, 3, 1.2), (0, -12, 64), M("metal"))
    h.sphere(1.8, (0, 5.5, 65), brass, u=8, v=4)
    return m


def street_sweeper():
    m = Model("street_sweeper", "Boss. Municipal street sweeper, front +Z. "
              "brush_l / brush_r nodes spin about local Y. Rooftop beacon and "
              "headlights use emissive materials.")
    b = m.part("body")
    white, orange, g = M("sweeper_white"), M("hazard_orange"), M("gunmetal")
    dark, glass = M("rubber"), M("glass_black")
    b.boxb((170, 290, 22), (0, 5, 30), g)
    # wheels with flared orange fenders
    for y in (-88, 95):
        for sx in (-1, 1):
            b.cyl(33, 26, (sx * 88, y, 33), dark, segs=16, rot=(0, 90, 0),
                  bevel=3)
            b.cyl(16, 27, (sx * 88, y, 33), M("metal"), segs=10,
                  rot=(0, 90, 0))
            b.cyl(5, 28, (sx * 88, y, 33), orange, segs=6, rot=(0, 90, 0))
            with b.xform(center=(sx * 88, y, 33), rot=(0, 90, 0)):
                b.band(35, 40, -15, 15, -170, -10, orange, segs=8)
    # cab
    b.boxb((200, 105, 140), (0, -92.5, 52), white, bevel=12, seg=2)
    b.boxb((202, 107, 12), (0, -92.5, 80), orange)
    b.box((168, 6, 60), (0, -145, 150), glass, bevel=3)
    b.box((176, 16, 8), (0, -143, 186), orange, rot=(-12, 0, 0))
    for sx in (-1, 1):
        b.box((6, 64, 50), (sx * 100, -95, 150), glass, bevel=2)
        b.cyl(11, 1.6, (sx * 100.4, -95, 108), M("hazard_yellow"), segs=14,
              rot=(0, 90, 0))
        # angry headlights under slanted brows
        with b.xform(center=(sx * 64, -146, 112), rot=(0, -sx * 15, 0)):
            b.box((42, 4, 18), (0, 0, 0), g)
            b.box((36, 4, 12), (0, -1, -1), M("glow_head"))
        b.box((48, 6, 7), (sx * 62, -148, 127), dark, rot=(0, -sx * 24, 0))
        # mirrors
        b.rod((sx * 100, -118, 150), (sx * 108, -126, 150), 1.6, g, segs=6)
        b.box((5, 6, 24), (sx * 109, -126, 144), g, bevel=1)
    # grille with teeth, hazard-striped bumper
    b.boxb((120, 6, 34), (0, -146, 62), g)
    for i in range(6):
        b.cone(6, 13, (-50 + 20 * i, -149.5, 90), M("spike"), segs=4,
               rot=(180, 0, 45))
    for i in range(6):
        b.boxb((30, 14, 20), (-75 + 30 * i, -144, 32),
               M("hazard_yellow" if i % 2 == 0 else "eye_black"))
    # roof beacon
    b.boxb((120, 30, 6), (0, -95, 192), g)
    b.cyl(11, 18, (0, -95, 207), M("glow_amber"), segs=14)
    b.sphere(11, (0, -95, 216), M("glow_amber"), u=14, v=6,
             scale=(1, 1, 0.75))
    b.cyl(3, 4, (0, -95, 226), g, segs=8)
    for sx in (-1, 1):
        b.boxb((22, 16, 9), (sx * 45, -95, 198), M("glow_amber"), bevel=2)
    b.rod((-84, -32, 150), (-84, -32, 208), 5, g, segs=10)
    b.cyl(6.5, 4, (-84, -32, 208), dark, segs=10)
    # hopper body
    b.boxb((196, 190, 128), (0, 55, 52), white, bevel=14, seg=2)
    b.boxb((198, 176, 12), (0, 55, 80), orange)
    for sx in (-1, 1):
        b.boxb((2, 80, 54), (sx * 98.5, 60, 108), M("button_grey"))
        b.boxb((3, 70, 4), (sx * 98.8, 60, 150), g)
    for i in range(5):
        b.box((12, 3, 70), (-60 + 30 * i, 151, 112), orange, rot=(0, 30, 0))
    for sx in (-1, 1):
        b.box((12, 3, 18), (sx * 76, 151, 76), M("glow_red"))
    b.boxb((140, 8, 14), (0, 152, 30), dark)
    # main roller broom under the middle
    b.cyl(18, 120, (0, 10, 18), M("hazard_yellow"), segs=12, rot=(0, 90, 0))
    for name, sx in (("brush_l", -1), ("brush_r", 1)):
        b.rod((sx * 68, -110, 44), (sx * 75, -120, 12), 3.5, g, segs=8)
        hub = (sx * 75, -120, 5)
        s = m.part(name, pivot=hub)
        s.cyl(9, 8, (sx * 75, -120, 8), g, segs=12)
        s.cyl(5, 2, (sx * 75, -120, 12.5), orange, segs=10)
        s.lathe([(8, 3), (30, 0.4), (31, 2.2), (9, 7)], M("hazard_yellow"),
                segs=16, center=(sx * 75, -120, 0))
        for k in range(6):
            with s.xform(center=hub, rot=(0, 0, k * 60)):
                s.rod((0, -6, 1.5), (0, -31, -3.6), 2.4, M("eye_black"),
                      segs=5)
    return m


FURNITURE = [house_a, house_b, house_c, tree_oak, tree_pine]
PROPS = [car, mailbox, trash_can, bicycle, garden_gnome, fire_hydrant]
HAZARDS = [robo_mower, lawn_mower, leaf_blower, sprinkler, street_sweeper]
