"""Hazard models. Blender coords: X right, -Y forward, Z up, 1 BU = 1 cm."""

import math

from common import M, Model, polar


def roomba():
    m = Model("roomba", "side_brush node spins about its local Y (up) axis.")
    b = m.part("body")
    b.cyl(14.5, 1.2, (0, 0, 0.6), M("rubber"), segs=24)
    b.cyl(16.6, 7.2, (0, 0, 4.6), M("roomba_shell"), segs=32, bevel=1.6, seg=2)
    b.cyl(13.5, 0.8, (0, 0, 8.4), M("roomba_top"), segs=32, bevel=0.3)
    # front bumper (warning orange)
    b.band(16.2, 17.3, 1.4, 6.8, -95, 95, M("hazard_orange"), segs=16,
           bevel=0.4)
    # big top button with glowing core
    b.cyl(3.2, 0.8, (0, 1.5, 9.0), M("hazard_yellow"), segs=16, bevel=0.3)
    b.cyl(1.4, 0.4, (0, 1.5, 9.5), M("glow_cyan"), segs=12)
    # mischievous eyes + brows near the front
    for sx in (-1, 1):
        b.cyl(2.2, 0.4, (sx * 4.2, -8.0, 9.0), M("eye_white"), segs=12)
        b.cyl(1.1, 0.4, (sx * 4.0, -8.6, 9.3), M("eye_black"), segs=10)
        b.box((4.0, 0.9, 0.4), (sx * 4.4, -11.0, 9.0), M("eye_black"),
              rot=(0, 0, sx * -18))
    # side brush (separate node so the game can spin it)
    hub = polar(40, 12.0, 0.6)
    s = m.part("side_brush", pivot=hub)
    s.cyl(1.6, 0.8, hub, M("rubber"), segs=10)
    for k in range(3):
        with s.xform(center=hub, rot=(0, 0, k * 120)):
            s.box((0.7, 6.0, 0.35), (0, -3.6, 0), M("hazard_yellow"))
            s.cone(0.6, 1.2, (0, -6.8, 0), M("hazard_yellow"), segs=4,
                   rot=(90, 0, 0))
    return m


def robovac_9000():
    m = Model("robovac_9000",
              "Boss. brush_l / brush_r nodes spin about local Y. Red visor eye "
              "uses an emissive material.")
    b = m.part("body")
    b.cyl(27.0, 3.0, (0, 0, 1.5), M("rubber"), segs=32)
    b.cyl(28.5, 11.0, (0, 0, 8.0), M("gunmetal"), segs=32, bevel=1.5, seg=2)
    # armour plates with spikes, leaving the front open for the ram
    for a0 in (42, 102, 162, 222, 282):
        b.band(28.2, 30.4, 3.5, 12.5, a0, a0 + 50, M("boss_red"), segs=6,
               bevel=0.5)
        b.cone(2.0, 5.0, polar(a0 + 25, 32.6, 8.0), M("spike"), segs=6,
               rot=(90, 0, a0 + 25))
    # yellow/black hazard-striped ram across the front
    n = 8
    for i in range(n):
        a = -38 + 76 * i / n
        b.band(28.2, 31.0, 3.0, 9.5, a, a + 76 / n,
               M("hazard_yellow" if i % 2 == 0 else "eye_black"), segs=2)
    for a in (-24, 0, 24):
        b.cone(1.8, 4.0, polar(a, 32.6, 6.2), M("spike"), segs=6,
               rot=(90, 0, a))
    # raised top deck
    b.lathe([(0, 13.4), (25.0, 13.4), (24.0, 15.0), (19.0, 17.0),
             (0, 17.6)], M("gunmetal"), segs=32)
    # visor: dark glass band with a glowing red eye
    b.band(20.0, 24.2, 13.8, 16.6, -62, 62, M("glass_black"), segs=12,
           bevel=0.4)
    b.sphere(2.6, polar(0, 24.0, 15.2), M("glow_red"), u=12, v=6,
             scale=(1.9, 0.6, 0.7))
    for a in (-34, 34):
        b.sphere(1.2, polar(a, 24.1, 15.2), M("glow_red"), u=8, v=4,
                 scale=(1.4, 0.6, 0.6))
    # angry brow plate over the visor
    b.band(19.0, 24.8, 16.6, 17.8, -40, 40, M("boss_red"), segs=6, bevel=0.3)
    # top core: hazard ring + glowing button
    b.cyl(10.0, 0.8, (0, 3, 18.0), M("hazard_yellow"), segs=24, bevel=0.3)
    b.cyl(7.0, 0.8, (0, 3, 18.6), M("eye_black"), segs=24)
    b.cyl(3.4, 0.8, (0, 3, 19.2), M("glow_red"), segs=16)
    # top spikes
    for a in (60, 180, 300):
        b.cone(1.6, 4.0, polar(a, 14.5, 18.4), M("spike"), segs=6)
    # twin saw brushes
    for name, side in (("brush_l", -1), ("brush_r", 1)):
        hub = polar(side * 48, 23.0, 1.0)
        s = m.part(name, pivot=hub)
        s.cyl(2.2, 1.0, hub, M("gunmetal"), segs=10)
        for k in range(5):
            with s.xform(center=hub, rot=(0, 0, k * 72)):
                s.box((1.4, 8.5, 0.5), (0, -4.6, 0), M("boss_red"))
                s.cone(0.9, 1.8, (0, -9.4, 0), M("spike"), segs=4,
                       rot=(90, 0, 0))
    return m


def lint_roller():
    m = Model("lint_roller",
              "Roller axis along X. drum node pivots on the roller axis at "
              "y = 3 cm; spin it about local X while rolling along Z.")
    d = m.part("drum", pivot=(0, 0, 3.0))
    d.cyl(3.0, 10.0, (0, 0, 3.0), M("sticky_white"), segs=18, bevel=0.4,
          rot=(0, 90, 0))
    d.cyl(3.06, 0.25, (2.0, 0, 3.0), M("hazard_yellow"), segs=18,
          rot=(0, 90, 0))
    for sx in (-1, 1):
        d.cyl(2.3, 0.8, (sx * 5.3, 0, 3.0), M("hazard_red"), segs=12,
              rot=(0, 90, 0))
    h = m.part("body")
    for sx in (-1, 1):
        h.cyl(1.1, 0.8, (sx * 6.0, 0, 3.0), M("rubber"), segs=8,
              rot=(0, 90, 0))
        h.rod((sx * 6.2, 0, 3.0), (sx * 6.2, 5.5, 3.8), 0.7, M("hazard_red"),
              segs=8)
    h.rod((-6.4, 5.5, 3.8), (6.4, 5.5, 3.8), 0.8, M("hazard_red"), segs=8)
    h.rod((0, 5.5, 3.8), (0, 13.0, 6.2), 1.2, M("hazard_red"), segs=10)
    h.rod((0, 13.0, 6.2), (0, 21.0, 8.6), 1.6, M("rubber"), segs=10,
          bevel=0.3)
    h.sphere(1.6, (0, 21.0, 8.6), M("hazard_yellow"), u=10, v=6)
    return m


def broom():
    # Pivot at the top of the handle; floor is at z = -FLOOR.
    floor = 113.0
    reach = 40.0
    m = Model("broom",
              "Origin is the sweep pivot at the TOP of the handle; the floor "
              f"is at y = -{floor:g}. The head rests on the floor {reach:g} cm "
              "forward (+Z). Rotate about Y through the origin to sweep.")
    b = m.part("body")
    top = (0, 0, 0)
    head_top = (0, -reach, -floor + 13.0)
    b.rod(top, head_top, 1.3, M("wood"), segs=10)
    b.sphere(1.7, top, M("hazard_red"), u=10, v=6)
    # red/yellow warning bands up the handle
    for t0, key in ((0.04, "hazard_yellow"), (0.12, "hazard_red"),
                    (0.88, "hazard_yellow")):
        p0 = [top[i] + (head_top[i] - top[i]) * t0 for i in range(3)]
        p1 = [top[i] + (head_top[i] - top[i]) * (t0 + 0.05) for i in range(3)]
        b.rod(p0, p1, 1.5, M(key), segs=10)
    with b.xform(center=(0, -reach, -floor)):
        b.boxb((30, 6.5, 4.0), (0, 0, 9.0), M("hazard_red"), bevel=0.8, seg=2)
        b.cyl(2.2, 3.0, (0, 0, 14.0), M("hazard_red"), segs=10, r2=1.6)
        with b.xform(center=(0, 0, 4.5), scale=(30, 7, 1)):
            b.cyl(0.7071 * 1.2, 9.0, (0, 0, 0), M("straw"), segs=4,
                  r2=0.7071, rot=(0, 0, 45))
        for z in (6.2, 8.0):
            b.box((32.2, 7.8, 0.6), (0, 0, z), M("hazard_red"))
    return m


def spray_bottle():
    m = Model("spray_bottle", "Nozzle points +Z; spray emits from about "
              "(0, 21.8, 8.5) in model space.")
    b = m.part("body")
    b.lathe([(0, 0), (4.6, 0), (5.0, 0.6), (5.0, 11.0), (4.7, 13.0),
             (3.6, 15.0), (1.8, 16.5), (1.8, 17.5), (0, 17.5)],
            M("liquid_blue"), segs=16)
    b.cyl(5.12, 6.0, (0, 0, 6.5), M("hazard_yellow"), segs=16)
    b.box((2.8, 0.4, 2.8), (0, -5.1, 6.5), M("hazard_red"), rot=(0, 45, 0))
    b.box((0.45, 0.3, 1.2), (0, -5.38, 6.85), M("eye_white"))
    b.box((0.45, 0.3, 0.4), (0, -5.38, 5.85), M("eye_white"))
    b.cyl(2.4, 2.0, (0, 0, 18.3), M("hazard_red"), segs=14, bevel=0.3)
    b.box((3.8, 9.4, 4.8), (0, -2.0, 22.1), M("hazard_red"), bevel=0.9, seg=2)
    b.cyl(1.2, 1.6, (0, -7.4, 21.8), M("hazard_orange"), segs=10,
          rot=(90, 0, 0))
    b.cyl(0.5, 0.4, (0, -8.3, 21.8), M("eye_black"), segs=8, rot=(90, 0, 0))
    b.box((2.2, 1.6, 6.0), (0, -5.4, 18.0), M("hazard_yellow"), bevel=0.5,
          seg=2, rot=(-15, 0, 0))
    return m


def mop():
    m = Model("mop", "Head footprint radius ~15 cm; stub handle leans back.")
    b = m.part("body")
    n = 28
    for k in range(n):
        a = k * 360 / n
        key = "mop_strand" if k % 3 else "mop_wet"
        b.rod(polar(a, 3.0, 2.6), polar(a + 9, 14.0, 1.0), 1.0, M(key),
              segs=6)
    n2 = 16
    for k in range(n2):
        a = k * 360 / n2 + 11
        key = "mop_wet" if k % 2 else "mop_strand"
        b.rod(polar(a, 2.0, 4.2), polar(a + 12, 10.5, 2.4), 1.0, M(key),
              segs=6)
    b.lathe([(0, 3.0), (6.0, 3.0), (5.8, 5.0), (4.4, 7.0), (0, 7.4)],
            M("plastic_blue"), segs=16)
    p0, p1 = (0, 0, 6.5), (0, 6.0, 46.0)
    k_n = 5
    for i in range(k_n):
        t0, t1 = i / k_n, (i + 1) / k_n
        a = [p0[j] + (p1[j] - p0[j]) * t0 for j in range(3)]
        c = [p0[j] + (p1[j] - p0[j]) * t1 for j in range(3)]
        b.rod(a, c, 1.4, M("hazard_red" if i % 2 else "hazard_yellow"),
              segs=10)
    b.sphere(1.6, p1, M("hazard_red"), u=10, v=6)
    return m


def upright_vacuum():
    m = Model("upright_vacuum", "Intake slot on the front of the base (+Z).")
    b = m.part("body")
    red, dark = M("hazard_red"), M("rubber")
    # nozzle base
    b.boxb((30, 26, 9), (0, -4, 1.2), red, bevel=2.0, seg=2)
    b.boxb((26, 4, 1.2), (0, -13, 0), dark)
    b.box((30.6, 3.0, 4.0), (0, -16.6, 3.3), dark, bevel=0.8)
    b.box((24, 0.6, 1.6), (0, -18.2, 3.0), M("glass_black"))
    b.box((10, 0.6, 1.8), (0, -17.0, 7.0), M("lamp_yellow"))
    b.box((30.4, 22, 1.2), (0, -3, 10.0), M("hazard_yellow"))
    for sx in (-1, 1):
        b.cyl(5.5, 3.5, (sx * 13.5, 8, 5.5), dark, segs=16, rot=(0, 90, 0),
              bevel=0.6)
        b.cyl(2.5, 3.8, (sx * 13.5, 8, 5.5), M("hazard_yellow"), segs=12,
              rot=(0, 90, 0))
    b.cyl(6.0, 22, (0, 8, 9.5), M("gunmetal"), segs=16, rot=(0, 90, 0))
    with b.xform(center=(0, 8, 9.5), rot=(-8, 0, 0)):
        b.boxb((12, 10, 6), (0, 0, 3), M("gunmetal"), bevel=1.0)
        b.boxb((24, 16, 48), (0, 1, 8), red, bevel=3.0, seg=2)
        b.box((16, 3, 28), (0, -7.4, 28), M("bin_clear"), bevel=1.0)
        b.box((14.5, 0.6, 11), (0, -9.0, 20), M("dust"))
        b.box((24.4, 16.4, 2.5), (0, 1, 47), M("hazard_yellow"))
        b.cyl(1.6, 1.0, (0, -7.2, 52), M("glow_red"), segs=12,
              rot=(90, 0, 0))
        b.rod((0, 10.6, 12), (0, 10.6, 52), 1.8, M("gunmetal"), segs=8)
        b.rod((0, 3, 56), (0, 3, 90), 1.6, M("metal"), segs=10)
        b.torus(5.0, 1.4, (0, 3, 95.0), dark, segs=16, rsegs=6,
                rot=(90, 0, 0))
    return m


BUILDERS = [roomba, lint_roller, broom, spray_bottle, mop, upright_vacuum,
            robovac_9000]
