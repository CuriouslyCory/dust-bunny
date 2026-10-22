"""Region models (Act 4, after the City): heavy machinery, vehicles and the
Incinerator boss. Blender coords: X right, -Y forward (the way a vehicle
drives / a plane flies), Z up, 1 BU = 1 cm. All models are real-size; the
game scales hazards by size / modelSize, so footprint radius matters."""

import math

import bmesh
from mathutils import Vector

from city import AXLE, FRONT, SIDE, _wheel
from common import M, Model


# --------------------------------------------------------------------------
# Shared helpers
# --------------------------------------------------------------------------

def _loft(p, sections, mats):
    """Closed tube through cross-section loops. sections: [(y, [(x, z)...])]
    with the same point count; mats: one material, or one per loop edge
    (edge i runs from point i to i + 1). Both ends are capped."""
    bm, mx = p.bm, p._stack[-1]
    if not isinstance(mats, (list, tuple)):
        mats = [mats]
    rings = [[bm.verts.new(mx @ Vector((x, y, z))) for x, z in pts]
             for y, pts in sections]
    n = len(rings[0])
    faces = []
    for ra, rb in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((ra[i], ra[j], rb[j], rb[i]))
            f.material_index = p._slot(mats[i % len(mats)])
            faces.append(f)
    for ring in (rings[0], rings[-1]):
        f = bm.faces.new(ring)
        f.material_index = p._slot(mats[0])
        faces.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=faces)


def _ellipse(w, z0, z1, n=10, square=0.6):
    """Rounded-rectangle loop (x, z): half-width w between heights z0..z1.
    square < 1 pushes the points towards the corners."""
    zm, hh = (z0 + z1) / 2, (z1 - z0) / 2
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n
        s, c = math.sin(a), -math.cos(a)
        out.append((w * math.copysign(abs(s) ** square, s),
                    zm + hh * math.copysign(abs(c) ** square, c)))
    return out


def _sleepers_and_rails(b, half_len, gauge, sleeper_w, pitch, rail_z=0.0,
                        sleeper=(24, 14), rail=(10, 16)):
    """Track section along Y: sleepers on the floor, two rails on top.
    Returns the rail-top height."""
    st, sh = sleeper
    n = int(2 * (half_len - st / 2) // pitch)
    y0 = -n * pitch / 2
    for k in range(n + 1):
        b.boxb((sleeper_w, st, sh), (0, y0 + k * pitch, rail_z), M("sleeper"))
    rw, rh = rail
    for sx in (-1, 1):
        b.boxb((rw * 1.8, 2 * half_len, 3), (sx * gauge, 0, rail_z + sh),
               M("metal"))
        b.boxb((rw, 2 * half_len, rh), (sx * gauge, 0, rail_z + sh + 3),
               M("metal"))
    return rail_z + sh + 3 + rh


def _airfoil(chord, thick, le=0.0):
    """Side profile (y, z) of a wing section: leading edge at y = le (front,
    -Y), trailing edge at le + chord, bottom at z = 0."""
    c, t = chord, thick
    return [(le, t * 0.3), (le + c * 0.06, t * 0.82), (le + c * 0.28, t),
            (le + c * 0.65, t * 0.7), (le + c, t * 0.12), (le + c, 0),
            (le + c * 0.5, 0), (le + c * 0.08, t * 0.05)]


# --------------------------------------------------------------------------
# Region hazards
# --------------------------------------------------------------------------

def _spiked_drum(b, x, y, r, w, n=10, spike=14, rows=2):
    """Steel compactor drum (axle along X) with staggered rows of tapered
    spikes; the lowest spike tip touches the floor."""
    z = r + spike
    b.cyl(r, w, (x, y, z), M("drum_steel"), segs=16, rot=AXLE)
    b.cyl(r * 0.42, w + 8, (x, y, z), M("cat_yellow"), segs=8, rot=AXLE)
    for row in range(rows):
        xo = x + (row - (rows - 1) / 2) * (w * 0.55)
        for k in range(n):
            a = math.radians(360 * k / n + row * 180 / n)
            d = Vector((0, math.sin(a), -math.cos(a)))
            c = Vector((xo, y, z))
            b.rod(c + d * (r - 2), c + d * (r + spike), 6, M("spike"), segs=4,
                  r2=1.2)
    return z


def landfill_compactor():
    m = Model("landfill_compactor", "Landfill compactor (CAT 836 style), "
              "front +Z: yellow articulated body, cab over the hinge, four "
              "spiked steel drums, dozer blade with a trash rack at the front. "
              "beacon node (amber, half lit) spins about its local Y axis on "
              "the cab roof. mini_compactor reuses this file.")
    b = m.part("body")
    yel, g, dark = M("cat_yellow"), M("gunmetal"), M("rubber")
    glass = M("glass_black")
    # drums, fenders
    zc = 0
    for y in (-150, 165):
        for sx in (-1, 1):
            zc = _spiked_drum(b, sx * 125, y, 80, 70)
            with b.xform(center=(sx * 125, y, zc), rot=AXLE):
                b.band(98, 104, -37, 37, -165, -15, yel, segs=8)
    # front frame, hinge, rear frame
    b.boxb((160, 260, 80), (0, -140, 70), yel, bevel=6)
    b.boxb((120, 80, 60), (0, 10, 80), g)
    b.cyl(20, 70, (0, 10, 110), M("metal"), segs=10)
    b.boxb((160, 220, 90), (0, 175, 70), yel, bevel=6)
    # engine hood over the rear drums, radiator grille at the back
    b.boxb((290, 270, 110), (0, 180, 200), yel, bevel=10, seg=2)
    b.boxb((200, 8, 80), (0, 316, 215), dark)
    for k in range(5):
        b.boxb((190, 10, 4), (0, 318, 222 + 15 * k), g)
    for sx in (-1, 1):
        b.box((14, 4, 18), (sx * 120, 316, 260), M("tail_red"))
    b.boxb((180, 120, 14), (0, 220, 310), g)
    b.rod((70, 150, 310), (70, 150, 362), 7, M("metal"), segs=8)
    b.cyl(8, 4, (70, 150, 364), dark, segs=8)
    b.cyl(14, 30, (-70, 150, 325), dark, segs=10)
    # cab on a platform over the hinge
    b.boxb((230, 150, 16), (0, -10, 186), g)
    b.boxb((160, 140, 34), (0, -10, 202), yel, bevel=3)
    b.boxb((150, 130, 92), (0, -10, 236), glass, bevel=3)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.boxb((10, 10, 92), (sx * 72, -10 + sy * 62, 236), yel)
    b.boxb((170, 160, 14), (0, -10, 328), yel, bevel=4)
    for sx in (-1, 1):
        b.rod((sx * 112, -80, 194), (sx * 112, 60, 194), 2.5, dark, segs=4)
        for y in (-80, 60):
            b.rod((sx * 112, y, 194), (sx * 112, y, 230), 2.5, dark, segs=4)
        b.box((20, 6, 12), (sx * 60, -88, 318), M("glow_head"))
        # steps up the side
        for k in range(3):
            b.boxb((30, 30, 4), (sx * 125, 40, 60 + 40 * k), g)
    # dozer blade with push arms, lift rams and trash rack
    prof = [(-262, 8), (-256, 196), (-312, 208), (-296, 160), (-288, 100),
            (-292, 46), (-308, 8)]
    b.prism(prof, 330, (0, 0, 0), yel, rot=SIDE)
    b.boxb((334, 18, 10), (0, -302, 0), g)
    for sx in (-1, 1):
        b.box((8, 60, 200), (sx * 166, -282, 104), yel)
        b.rod((sx * 100, -262, 60), (sx * 70, -160, 100), 12, yel, segs=6)
        b.rod((sx * 60, -262, 170), (sx * 60, -170, 150), 7, M("metal"),
              segs=6)
    b.rod((-160, -258, 262), (160, -258, 262), 4, g, segs=4)
    for k in range(9):
        x = -160 + 40 * k
        b.rod((x, -256, 196), (x, -258, 262), 3, g, segs=4)
    # spinning beacon: lit half + dark half so the rotation reads
    b.cyl(13, 6, (0, -10, 345), g, segs=10)
    hub = (0, -10, 348)
    s = m.part("beacon", pivot=hub)
    with s.xform(center=hub):
        s.band(1, 14, 0, 20, 0, 180, M("glow_amber"), segs=6)
        s.band(1, 14, 0, 20, 180, 360, M("hazard_orange"), segs=6)
    s.sphere(14, (0, -10, 368), M("glow_amber"), u=12, v=4,
             scale=(1, 1, 0.5))
    return m


def freight_train():
    m = Model("freight_train", "Diesel freight locomotive (one unit), long "
              "axis along Z, cab at +Z: navy body with a yellow nose and sill "
              "stripe, two three-axle bogies on a short section of track "
              "(rails 144 cm apart, top of rail at y = 33). Headlights are "
              "emissive.")
    b = m.part("body")
    navy, yel, g = M("loco_navy"), M("loco_yellow"), M("gunmetal")
    dark, glass, metal = M("rubber"), M("glass_black"), M("metal")
    b.boxb((290, 2180, 6), (0, 0, 0), M("rock_grey"))
    top = _sleepers_and_rails(b, 1090, 72, 250, 62, rail_z=6,
                              sleeper=(24, 12), rail=(10, 12))
    wr = 46
    for yb in (-640, 640):
        for o in (-170, 0, 170):
            for sx in (-1, 1):
                b.cyl(wr, 12, (sx * 72, yb + o, top + wr), M("iron_black"),
                      segs=14, rot=AXLE)
            b.rod((-80, yb + o, top + wr), (80, yb + o, top + wr), 8, g,
                  segs=6)
        for sx in (-1, 1):
            b.boxb((16, 520, 46), (sx * 92, yb, top + 26), g)
            for o in (-85, 85):
                b.cyl(10, 30, (sx * 92, yb + o, top + 87), metal, segs=8)
        b.boxb((210, 80, 34), (0, yb, top + 72), g)
    # underframe, fuel tank, sill stripe
    zf = 140
    b.boxb((300, 2000, 30), (0, 0, zf), g)
    b.boxb((302, 2000, 14), (0, 0, zf + 6), yel)
    b.boxb((240, 560, 70), (0, 0, 66), dark, bevel=18, seg=2)
    deck = zf + 30
    # long hood with door seams, radiators and fans
    b.boxb((236, 1500, 250), (0, 240, deck), navy, bevel=10, seg=2)
    for sx in (-1, 1):
        for k in range(7):
            b.boxb((2, 6, 210), (sx * 118.5, -420 + 160 * k, deck + 20), g)
        b.box((2, 300, 70), (sx * 118.5, 830, deck + 190), M("iron_black"))
    b.boxb((230, 300, 20), (0, 830, deck + 250), M("iron_black"))
    for y in (740, 900):
        b.cyl(46, 8, (0, y, deck + 270), g, segs=12)
    b.boxb((200, 260, 24), (0, 200, deck + 250), navy, bevel=6)
    b.boxb((50, 30, 34), (0, -300, deck + 250), M("iron_black"))
    # cab: navy sides, yellow front, windshields, roof
    b.boxb((300, 330, 255), (0, -680, deck), navy, bevel=8)
    b.boxb((302, 8, 255), (0, -846, deck), yel)
    b.boxb((290, 320, 12), (0, -680, deck + 255), navy, bevel=4)
    for sx in (-1, 1):
        b.box((110, 6, 60), (sx * 68, -851, deck + 200), glass)
        b.box((6, 110, 56), (sx * 151, -720, deck + 196), glass)
    b.cyl(10, 20, (60, -640, deck + 277), metal, segs=8, rot=(90, 0, 0))
    # nose (short hood), pilot, couplers, headlights
    b.prism([(-1000, deck), (-846, deck), (-846, deck + 160),
             (-1000, deck + 130)], 260, (0, 0, 0), yel, rot=SIDE)
    b.box((60, 4, 20), (0, -1001, deck + 110), M("glow_head"))
    for sx in (-1, 1):
        b.box((22, 4, 16), (sx * 110, -1021, 100), M("glow_head"))
        b.rod((sx * 148, -840, deck + 100), (sx * 148, 990, deck + 100), 2.5,
              yel, segs=4)
        for y in range(-840, 991, 260):
            b.rod((sx * 148, y, deck), (sx * 148, y, deck + 100), 2.5, yel,
                  segs=4)
    for sy in (-1, 1):
        b.prism([(-150, 50), (150, 50), (150, 140), (-150, 140)], 22,
                (0, sy * 1008, 0), g, rot=FRONT)
        b.boxb((40, 60, 26), (0, sy * 1030, 96), dark)
        b.boxb((280, 10, 20), (0, sy * 1015, 48),
               M("hazard_yellow"))
    return m


def snowplow():
    m = Model("snowplow", "Municipal snowplow truck, front +Z: orange cab "
              "and dump body heaped with salt, yellow plough blade angled "
              "across the front (right end forward), salt spreader disc at "
              "the back. Amber light bar and headlights are emissive.")
    b = m.part("body")
    # shifted 20 cm back so the plough and spreader balance about the origin
    with b.xform(center=(0, 20, 0)):
        _snowplow_body(b)
    return m


def _snowplow_body(b):
    org, g, dark = M("plow_orange"), M("gunmetal"), M("rubber")
    glass, metal = M("glass_black"), M("metal")
    b.boxb((110, 830, 24), (0, 40, 62), g)
    for y in (-250, 230, 340):
        for sx in (-1, 1):
            _wheel(b, sx * 100, y, 52, 32, segs=16, bevel=2,
                   hub_mat="metal")
    for sx in (-1, 1):
        with b.xform(center=(sx * 100, -250, 52), rot=AXLE):
            b.band(55, 61, -18, 18, -170, -10, org, segs=8)
        b.boxb((44, 220, 8), (sx * 104, 285, 112), g)
    # hood, grille, bumper
    b.prism([(-385, 110), (-200, 110), (-200, 232), (-372, 206)], 206,
            (0, 0, 0), org, rot=SIDE)
    b.boxb((120, 180, 30), (0, -290, 86), g)
    b.boxb((150, 6, 90), (0, -386, 104), M("iron_black"))
    for sx in (-1, 1):
        b.boxb((30, 6, 14), (sx * 86, -384, 170), M("glow_head"))
    b.boxb((256, 22, 34), (0, -392, 44), g)
    # cab
    b.boxb((240, 170, 200), (0, -115, 90), org, bevel=10, seg=2)
    b.box((216, 6, 70), (0, -201, 245), glass, bevel=2)
    for sx in (-1, 1):
        b.box((6, 110, 60), (sx * 120, -120, 240), glass, bevel=2)
        b.rod((sx * 120, -190, 230), (sx * 132, -196, 230), 1.8, g, segs=6)
        b.box((5, 8, 30), (sx * 133, -196, 222), g, bevel=1)
    b.boxb((200, 30, 10), (0, -150, 290), g)
    b.boxb((190, 26, 12), (0, -150, 298), M("glow_amber"))
    for sx in (-1, 1):
        b.sphere(10, (sx * 88, -150, 312), M("glow_amber"), u=10, v=4,
                 scale=(1, 1, 0.8))
    b.rod((128, -26, 110), (128, -26, 346), 6, metal, segs=8)
    b.cyl(7, 4, (128, -26, 348), dark, segs=8)
    # dump body with salt, cab shield, ribs
    b.boxb((246, 400, 170), (0, 180, 125), org, bevel=6)
    b.boxb((250, 404, 10), (0, 180, 290), g)
    b.sphere(1, (0, 185, 296), M("salt"), u=14, v=6, scale=(110, 175, 24))
    b.boxb((246, 60, 14), (0, -10, 296), org)
    for sx in (-1, 1):
        for y in (40, 140, 240, 340):
            b.boxb((6, 10, 160), (sx * 124, y, 128), org)
        b.box((12, 4, 22), (sx * 100, 382, 110), M("tail_red"))
    # salt spreader: chute, hopper, spinner disc with fins
    b.boxb((70, 50, 50), (0, 400, 90), g)
    b.cyl(18, 30, (0, 440, 90), M("hazard_yellow"), segs=12, r2=40)
    b.rod((0, 440, 74), (0, 440, 54), 4, metal, segs=6)
    b.cyl(42, 4, (0, 440, 52), M("hazard_yellow"), segs=14)
    for k in range(4):
        with b.xform(center=(0, 440, 56), rot=(0, 0, 45 + 90 * k)):
            b.box((4, 34, 8), (0, -20, 0), dark)
    # plough: curved yellow moldboard angled 20 deg, rubber cutting edge
    with b.xform(center=(0, -460, 0), rot=(0, 0, -15)):
        prof = [(18, 8), (26, 125), (-22, 134), (-6, 96), (0, 56),
                (-8, 24), (-20, 8)]
        b.prism(prof, 340, (0, 0, 0), M("hazard_yellow"), rot=SIDE)
        b.boxb((340, 14, 10), (0, -14, 0), dark)
        for k in range(5):
            b.boxb((4, 6, 110), (-136 + 68 * k, 22, 12), g)
        for sx in (-1, 1):
            b.rod((sx * 166, 22, 120), (sx * 166, 22, 210), 1.6, metal,
                  segs=4)
            b.cyl(3, 14, (sx * 166, 22, 214), M("hazard_orange"), segs=6)
    # push frame from the bumper to the plough
    for sx in (-1, 1):
        b.rod((sx * 60, -436 - sx * 16, 60), (sx * 60, -400, 56), 6, g,
              segs=6)
    b.rod((0, -430, 100), (0, -400, 70), 5, metal, segs=6)


def crop_duster():
    m = Model("crop_duster", "Single-engine crop-dusting plane (Air Tractor "
              "style), nose +Z, on its taildragger gear with the thrust line "
              "level at y = 150: yellow low wing with spray booms along the "
              "trailing edge. propeller node (three blades with yellow "
              "tips) spins about its local Z axis; pivot at the spinner.")
    b = m.part("body")
    yel, g, dark = M("duster_yellow"), M("gunmetal"), M("rubber")
    glass, metal, black = M("glass_black"), M("metal"), M("iron_black")
    zc = 150
    # fuselage: long turbine nose, hopper, cockpit, tapered tail boom
    secs = [(-332, _ellipse(26, zc - 26, zc + 26)),
            (-300, _ellipse(40, zc - 40, zc + 40)),
            (-230, _ellipse(44, zc - 46, zc + 46)),
            (-160, _ellipse(50, zc - 52, zc + 54)),
            (-60, _ellipse(54, zc - 56, zc + 64)),
            (60, _ellipse(50, zc - 52, zc + 58)),
            (200, _ellipse(30, zc - 22, zc + 38)),
            (330, _ellipse(12, zc + 12, zc + 36)),
            (370, _ellipse(6, zc + 20, zc + 34))]
    _loft(b, secs, yel)
    # black anti-glare panel on the nose, exhausts
    b.box((54, 130, 8), (0, -240, zc + 44), black, rot=(-2, 0, 0))
    for sx in (-1, 1):
        b.rod((sx * 40, -255, zc + 6), (sx * 54, -235, zc - 10), 6, dark,
              segs=6)
    # hopper lid and cockpit canopy with a roll bar
    b.boxb((60, 60, 10), (0, -140, zc + 52), black, bevel=3)
    b.boxb((84, 118, 54), (0, -50, zc + 58), glass, bevel=14, seg=2)
    b.rod((-38, -10, zc + 60), (0, -10, zc + 112), 3, yel, segs=4)
    b.rod((38, -10, zc + 60), (0, -10, zc + 112), 3, yel, segs=4)
    b.box((60, 40, 10), (0, 20, zc + 70), yel, rot=(-10, 0, 0))
    # low wing with dihedral; spray booms under the trailing edge
    zw = zc - 52
    for sx in (-1, 1):
        with b.xform(center=(0, 0, zw), rot=(0, -sx * 4, 0)):
            b.prism(_airfoil(170, 18, le=-110), 548, (sx * 274, 0, 0), yel,
                    rot=SIDE)
            b.prism(_airfoil(172, 19, le=-111), 10, (sx * 548, 0, 0),
                    black, rot=SIDE)
            b.rod((sx * 40, 70, -5), (sx * 530, 70, -5), 3.5, metal, segs=6)
            for k in range(9):
                x = sx * (70 + 56 * k)
                b.rod((x, 60, 2), (x, 70, -5), 1.4, metal, segs=4)
                b.cyl(2.6, 8, (x, 70, -11), M("brass"), segs=6)
    b.rod((0, 40, zw - 20), (0, -60, zw - 30), 6, metal, segs=8)
    b.box((8, 30, 30), (0, -70, zw - 30), g)
    # tail: horizontal stabiliser with braces, fin with a black rudder edge
    b.prism(_airfoil(80, 8, le=290), 350, (0, 0, zc + 22), yel, rot=SIDE)
    for sx in (-1, 1):
        b.rod((sx * 6, 300, zc + 10), (sx * 100, 320, zc + 28), 1.2, metal,
              segs=4)
    b.prism([(270, zc + 34), (372, zc + 30), (380, 300), (336, 300)], 8,
            (0, 0, 0), yel, rot=SIDE)
    b.prism([(372, zc + 30), (382, zc + 30), (382, 300), (378, 300)], 9,
            (0, 0, 0), black, rot=SIDE)
    # main gear (spring legs), tailwheel
    for sx in (-1, 1):
        b.rod((sx * 30, -80, zc - 50), (sx * 140, -86, 30), 4, g, segs=6)
        b.cyl(30, 14, (sx * 145, -86, 30), dark, segs=14, rot=AXLE)
        b.cyl(12, 16, (sx * 145, -86, 30), metal, segs=8, rot=AXLE)
    b.rod((0, 335, zc + 14), (0, 356, 12), 2.5, g, segs=6)
    b.cyl(12, 6, (0, 356, 12), dark, segs=10, rot=AXLE)
    # propeller: spinner + three blades in the XZ plane
    hub = (0, -345, zc)
    s = m.part("propeller", pivot=hub)
    s.lathe([(0, 30), (12, 24), (22, 10), (24, 0)], g, segs=12,
            center=(0, -335, zc), rot=(90, 0, 0))
    for k in range(3):
        with s.xform(center=hub, rot=(0, k * 120, 0)):
            s.box((14, 3, 112), (0, 0, 70), black, rot=(0, 0, 0))
            s.box((12, 3.4, 22), (0, 0, 129), yel)
    return m


def river_barge():
    m = Model("river_barge", "River barge, bow +Z: long dark hull with four "
              "red covered-hopper loads, push-tug at the stern (-Z) with "
              "push knees against the barge, a white three-deck house and "
              "a tall wheelhouse. Hull bottom on the floor (no water).")
    b = m.part("body")
    hull, red, white = M("hull_dark"), M("barge_red"), M("sweeper_white")
    g, dark, glass = M("gunmetal"), M("rubber"), M("glass_black")
    # barge hull with a raked bow, yellow deck edge
    b.prism([(-610, 0), (398, 0), (398, 88), (-690, 88), (-690, 76)], 300,
            (0, 0, 0), hull, rot=SIDE)
    for sx in (-1, 1):
        b.boxb((6, 1086, 8), (sx * 148, -146, 80), M("hazard_yellow"))
    b.boxb((280, 1030, 8), (0, -140, 88), g)
    # covered hoppers
    cover = [(-132, 0), (132, 0), (132, 56), (100, 82), (0, 94),
             (-100, 82), (-132, 56)]
    for k in range(4):
        y = -530 + k * 250
        b.prism(cover, 236, (0, y, 96), red, rot=FRONT)
        b.boxb((268, 6, 6), (0, y - 118, 96), g)
    for x, y in ((-130, -665), (130, -665), (-130, 380), (130, 380),
                 (-138, -140), (138, -140)):
        b.cyl(7, 14, (x, y, 95), M("iron_black"), segs=8)
    # tug hull, push knees, rub rail, tyre fenders
    b.prism([(404, 0), (650, 0), (690, 36), (690, 92), (404, 92)], 262,
            (0, 0, 0), M("hazard_red"), rot=SIDE)
    b.boxb((266, 290, 12), (0, 547, 80), M("iron_black"))
    for sx in (-1, 1):
        b.boxb((22, 22, 120), (sx * 84, 412, 92), M("iron_black"))
        b.rod((sx * 84, 412, 160), (sx * 130, 380, 92), 1.5, g, segs=4)
        for k in range(4):
            b.cyl(13, 10, (sx * 134, 450 + 60 * k, 70), dark, segs=8,
                  rot=(0, 90, 0))
    # deckhouse, second deck, wheelhouse
    b.boxb((220, 190, 80), (0, 565, 92), white, bevel=3)
    b.boxb((180, 140, 60), (0, 560, 172), white, bevel=3)
    b.boxb((150, 100, 58), (0, 540, 232), white, bevel=3)
    b.boxb((152, 102, 26), (0, 540, 256), glass)
    b.boxb((180, 124, 8), (0, 540, 290), M("hazard_red"))
    for sx in (-1, 1):
        b.box((3, 100, 26), (sx * 111, 565, 140), glass)
        b.rod((sx * 60, 625, 232), (sx * 60, 625, 284), 9, M("iron_black"),
              segs=8)
        b.cyl(9.6, 10, (sx * 60, 625, 270), M("hazard_red"), segs=8)
        b.rod((sx * 90, 490, 232), (sx * 90, 630, 232), 1.4, g, segs=4)
    b.box((100, 3, 26), (0, 469, 140), glass)
    b.box((70, 8, 3), (0, 560, 300), g)
    b.box((20, 12, 10), (40, 490, 297), M("lamp_yellow"))
    return m


def water_bomber():
    m = Model("water_bomber", "Amphibious water-bomber (Canadair CL-415 "
              "style), nose +Z, standing on its wheels: yellow upper body, "
              "red boat hull, high straight wing with two turboprops, red "
              "wingtip floats, high tailplane on the fin.")
    b = m.part("body")
    yel, red, g = M("bomber_yellow"), M("bomber_red"), M("gunmetal")
    dark, glass, metal, black = (M("rubber"), M("glass_black"), M("metal"),
                                 M("iron_black"))

    def hull(w, kz, tz):
        h = tz - kz
        right = [(0.6 * w, kz + 0.12 * h), (w, kz + 0.28 * h),
                 (w, kz + 0.5 * h), (w, kz + 0.72 * h),
                 (0.75 * w, kz + 0.93 * h), (0.35 * w, tz)]
        return ([(0, kz)] + right + [(0, tz + 0.02 * h)]
                + [(-x, z) for x, z in reversed(right)])

    secs = [(-955, hull(30, 215, 285)), (-910, hull(84, 152, 330)),
            (-820, hull(118, 118, 378)), (-660, hull(130, 102, 402)),
            (-300, hull(132, 98, 408)), (40, hull(132, 98, 408)),
            (60, hull(130, 128, 408)), (320, hull(112, 180, 404)),
            (620, hull(78, 262, 402)), (900, hull(34, 330, 412)),
            (958, hull(16, 352, 410))]
    # loop edges 0-2 and 11-13 are the hull below the waterline (red)
    _loft(b, secs, [red] * 3 + [yel] * 8 + [red] * 3)
    # cockpit glazing, cabin windows, scoop probes
    b.box((170, 6, 50), (0, -880, 352), glass, rot=(-48, 0, 0))
    for sx in (-1, 1):
        b.box((6, 90, 40), (sx * 114, -800, 340), glass, rot=(0, 0, -sx * 8))
        for k in range(4):
            b.box((4, 34, 28), (sx * 131, -500 + 120 * k, 320), glass)
        b.rod((sx * 40, 60, 104), (sx * 40, 120, 80), 3, metal, segs=4)
    # wing on a pylon fairing, red tips
    zw = 408
    b.boxb((150, 380, 30), (0, -30, zw - 10), yel, bevel=10)
    b.prism(_airfoil(300, 42, le=-170), 2620, (0, 0, zw), yel, rot=SIDE)
    for sx in (-1, 1):
        b.prism(_airfoil(300, 42, le=-170), 60, (sx * 1340, 0, zw), red,
                rot=SIDE)
        # wingtip float on struts
        b.sphere(1, (sx * 1150, -60, 262), red, u=12, v=6,
                 scale=(34, 140, 32))
        for y in (-110, 0):
            b.rod((sx * 1150, y, 284), (sx * 1150, y + 10, zw + 4), 4, yel,
                  segs=4)
        # engine nacelle through the wing, 4-blade propeller (static)
        x = sx * 330
        b.lathe([(0, 290), (22, 284), (48, 252), (58, 160), (58, -60),
                 (40, -200), (12, -262)], yel, segs=14,
                center=(x, -100, 430), rot=(90, 0, 0))
        b.box((40, 120, 6), (x, -230, 489), black)
        b.cone(22, 40, (x, -410, 430), g, segs=10, rot=(90, 0, 0))
        for k in range(4):
            with b.xform(center=(x, -400, 430), rot=(0, 45 + k * 90, 0)):
                b.box((20, 4, 160), (0, 0, 100), black, rot=(0, 0, 12))
                b.box((18, 4.4, 24), (0, 0, 184), yel, rot=(0, 0, 12))
    # tail: fin (yellow, red top) and high tailplane
    b.prism([(620, 400), (952, 400), (958, 600), (774, 600)], 22,
            (0, 0, 0), yel, rot=SIDE)
    b.prism([(774, 600), (958, 600), (962, 700), (842, 700)], 22,
            (0, 0, 0), red, rot=SIDE)
    b.prism(_airfoil(130, 16, le=812), 760, (0, 0, 606), yel, rot=SIDE)
    for sx in (-1, 1):
        b.prism(_airfoil(130, 16, le=812), 50, (sx * 405, 0, 606), red,
                rot=SIDE)
    # landing gear: twin nose wheels, main wheels in side sponsons
    b.rod((0, -760, 140), (0, -760, 40), 5, metal, segs=6)
    for sx in (-1, 1):
        b.cyl(36, 14, (sx * 16, -760, 36), dark, segs=12, rot=AXLE)
        b.boxb((50, 200, 70), (sx * 140, 60, 150), yel, bevel=14, seg=2)
        b.rod((sx * 150, 60, 160), (sx * 172, 60, 55), 7, metal, segs=6)
        _wheel(b, sx * 180, 60, 55, 26, segs=14, hub_mat="metal")
    return m


def incinerator():
    m = Model("incinerator", "Boss. The Incinerator: rail-mounted "
              "waste-to-energy plant, front +Z. Grey plant hall on four rail "
              "bogies (rails at x = +/-460 along Z), boiler house and a brick "
              "and steel chimney with a soot-black rim (top centre at "
              "(0, 2600, -600)), feed conveyor rising into an intake mouth "
              "that glows orange (emissive furnace). brush_l / brush_r are "
              "the two upright intake roller drums at the front corners; "
              "they spin about local Y, pivots at their centres.")
    b = m.part("body")
    grey, pd, g = M("plant_grey"), M("plant_dark"), M("gunmetal")
    dark, glass, metal = M("rubber"), M("glass_black"), M("metal")
    yel, blk, glow = M("hazard_yellow"), M("eye_black"), M("glow_furnace")
    # track and bogies
    top = _sleepers_and_rails(b, 1700, 460, 1150, 170, sleeper=(40, 18),
                              rail=(22, 24))
    for yb in (-1050, -350, 350, 1050):
        for sx in (-1, 1):
            for o in (-120, 120):
                b.cyl(56, 22, (sx * 460, yb + o, top + 56), M("iron_black"),
                      segs=14, rot=AXLE)
            b.boxb((30, 400, 70), (sx * 500, yb, top + 30), g)
            b.cyl(16, 34, (sx * 500, yb, top + 116), metal, segs=8)
        b.boxb((1100, 120, 40), (0, yb, top + 100), g)
    # undercarriage girder with hazard stripes front and back
    zg = top + 140
    b.boxb((1300, 2900, 130), (0, 50, zg), pd)
    for sy in (-1, 1):
        for k in range(8):
            b.boxb((160, 8, 110), (-560 + 160 * k, 50 + sy * 1451, zg + 10),
                   yel if k % 2 == 0 else blk)
    zp = zg + 130
    # main hall: corrugated ribs, window band, roof
    b.boxb((1400, 2000, 900), (0, 250, zp), grey)
    for sx in (-1, 1):
        for k in range(10):
            b.boxb((8, 30, 900), (sx * 702, -650 + 210 * k, zp), pd)
        b.boxb((6, 1900, 70), (sx * 702, 250, zp + 640), glass)
    b.boxb((1420, 2020, 30), (0, 250, zp + 900), pd)
    # boiler house, flue duct, roof fans
    b.boxb((1000, 700, 480), (0, -50, zp + 930), grey)
    b.boxb((1010, 710, 24), (0, -50, zp + 1410), pd)
    for sx in (-1, 1):
        b.boxb((6, 640, 50), (sx * 502, -50, zp + 1250), glass)
    b.rod((0, 300, zp + 1260), (0, 470, zp + 1260), 70, metal, segs=10)
    for x, y in ((-450, 700), (-450, 1000), (450, 1000)):
        b.cyl(80, 40, (x, y, zp + 950), g, segs=12)
        b.cyl(66, 4, (x, y, zp + 972), blk, segs=12)
    b.rod((450, 650, zp + 930), (450, 650, zp + 1100), 40, metal, segs=8)
    # chimney: brick shaft, steel bands, steel top, soot-black rim
    cy = 600
    b.lathe([(175, zp + 920), (150, 2200)], M("brick_red"), segs=16,
            center=(0, cy, 0))
    for z in (1700, 2000):
        r = 175 - 25 * (z - zp - 920) / (2200 - zp - 920)
        b.cyl(r + 6, 30, (0, cy, z), metal, segs=16)
    b.lathe([(152, 2200), (136, 2540)], grey, segs=16, center=(0, cy, 0))
    b.lathe([(118, 2540), (146, 2540), (146, 2600), (118, 2600)],
            M("soot"), segs=16, center=(0, cy, 0))
    for a in (0, 120, 240):
        x, y = 140 * math.sin(math.radians(a)), -140 * math.cos(
            math.radians(a))
        b.box((14, 14, 14), (x, cy + y, 2480), M("glow_red"))
    # front feed hall: pillars and lintel around the intake mouth
    yf = -1300
    zf = zp + 500
    b.boxb((350, 550, 500), (-525, yf + 275, zp), grey)
    b.boxb((350, 550, 500), (525, yf + 275, zp), grey)
    b.boxb((700, 550, 110), (0, yf + 275, zf - 110), grey)
    b.boxb((1420, 560, 20), (0, yf + 275, zf), pd)
    for k in range(8):
        b.boxb((88, 6, 70), (-308 + 88 * k, yf - 3, zf - 92),
               yel if k % 2 == 0 else blk)
    # mouth: dark lining, glowing furnace wall and grate
    b.boxb((700, 20, 390), (0, yf + 540, zp), glow)
    b.boxb((700, 300, 6), (0, yf + 390, zp), glow)
    b.boxb((690, 6, 10), (0, yf + 6, zf - 120), blk)
    for sx in (-1, 1):
        b.boxb((10, 540, 390), (sx * 344, yf + 275, zp), M("iron_black"))
        b.box((30, 30, 30), (sx * 680, yf - 10, zf + 40), M("glow_amber"))
    # control cab on the feed hall roof
    b.boxb((240, 200, 150), (-480, yf + 160, zf + 20), grey)
    b.boxb((246, 206, 60), (-480, yf + 160, zf + 90), glass)
    b.boxb((260, 220, 16), (-480, yf + 160, zf + 170), pd)
    # feed conveyor rising into the mouth
    lo, hi = Vector((0, -1720, 40)), Vector((0, yf + 60, zp + 40))
    d = hi - lo
    ang = math.degrees(math.atan2(d.z, d.y))
    with b.xform(center=(lo + hi) / 2, rot=(ang, 0, 0)):
        L = d.length
        b.box((600, L, 16), (0, 0, 0), dark)
        for sx in (-1, 1):
            b.box((30, L, 50), (sx * 315, 0, 10), yel)
        for k in range(int((L - 60) // 70)):
            b.box((580, 8, 8), (0, -L / 2 + 40 + 70 * k, 12), blk)
    b.boxb((660, 40, 30), (0, -1730, 0), yel)
    for sx in (-1, 1):
        b.rod((sx * 280, -1500, 0), (sx * 280, -1500, 190), 10, g, segs=6)
    # roller drum mounts: arms from the feed hall to the drum tops
    zt = 470
    for name, sx in (("brush_l", -1), ("brush_r", 1)):
        x, y = sx * 560, -1500
        b.boxb((60, 220, 40), (x, -1390, zt), pd)
        b.cyl(34, 70, (x, y, zt + 30), g, segs=10)
        hub = (x, y, 240)
        s = m.part(name, pivot=hub)
        s.cyl(140, 420, (x, y, 240), M("drum_steel"), segs=16)
        s.cyl(150, 14, (x, y, 443), M("hazard_orange"), segs=16)
        s.cyl(150, 14, (x, y, 37), M("hazard_orange"), segs=16)
        for k in range(8):
            a0, a1 = 45 * k, 45 * k + 40 * sx
            p0 = Vector((x, y, 0)) + Vector((150 * math.sin(math.radians(a0)),
                                             -150 * math.cos(math.radians(a0)),
                                             44))
            p1 = Vector((x, y, 0)) + Vector((150 * math.sin(math.radians(a1)),
                                             -150 * math.cos(math.radians(a1)),
                                             436))
            s.rod(p0, p1, 12, yel, segs=4)
    return m


HAZARDS = [landfill_compactor, freight_train, snowplow, crop_duster,
           river_barge, water_bomber, incinerator]
