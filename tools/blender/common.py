"""Shared helpers for building Dust Bunny models procedurally in Blender.

Conventions (Blender side):
  * 1 Blender unit = 1 cm.
  * Z is up, the floor is z = 0, the model origin is the bottom centre.
  * "Forward" is -Y in Blender. The glTF exporter (+Y up) maps Blender -Y to
    glTF +Z, so models face +Z in three.js.

Geometry is written straight into bmesh objects (no bpy.ops modelling), so the
scripts run headless and deterministically.
"""

import math
import os
from contextlib import contextmanager

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
OUT_DIR = os.path.join(REPO, "public", "models")
DOCS_DIR = os.path.join(REPO, "docs")

SMOOTH_ANGLE = math.radians(40)


# --------------------------------------------------------------------------
# Scene / materials
# --------------------------------------------------------------------------

def reset_scene():
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials,
                 bpy.data.cameras, bpy.data.lights, bpy.data.curves,
                 bpy.data.images):
        for item in list(coll):
            coll.remove(item)


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(hex_str):
    h = hex_str.lstrip("#")
    return tuple(_srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


def mat(name, color, rough=0.6, metal=0.0, emit=None, emit_strength=3.0):
    """Get or create a Principled BSDF material. Colours are sRGB hex strings."""
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    rgb = hex_rgb(color)
    m.diffuse_color = (*rgb, 1.0)
    m.roughness = rough
    m.metallic = metal
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*hex_rgb(emit), 1.0)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    return m


# name: (hex colour, roughness, metallic, emission hex or None, emission strength)
PALETTE = {
    # hazard accents
    "hazard_red": ("#e63946", 0.45, 0.0, None, 0),
    "hazard_orange": ("#f77f00", 0.45, 0.0, None, 0),
    "hazard_yellow": ("#ffc300", 0.45, 0.0, None, 0),
    "rubber": ("#2b2d33", 0.85, 0.0, None, 0),
    "glass_black": ("#101218", 0.15, 0.0, None, 0),
    "eye_white": ("#fbfbf7", 0.3, 0.0, None, 0),
    "eye_black": ("#15161a", 0.3, 0.0, None, 0),
    "glow_cyan": ("#48e5ff", 0.3, 0.0, "#48e5ff", 3.0),
    "glow_red": ("#ff2a2a", 0.3, 0.0, "#ff1a1a", 6.0),
    "lamp_yellow": ("#fff1a8", 0.3, 0.0, "#ffe680", 2.0),
    # hazard bodies
    "roomba_shell": ("#4a5260", 0.4, 0.1, None, 0),
    "roomba_top": ("#6c7787", 0.35, 0.1, None, 0),
    "gunmetal": ("#30353d", 0.35, 0.6, None, 0),
    "boss_red": ("#b5121b", 0.4, 0.2, None, 0),
    "spike": ("#d6dbe3", 0.25, 0.9, None, 0),
    "sticky_white": ("#f6f3ea", 0.7, 0.0, None, 0),
    "straw": ("#d9a441", 0.8, 0.0, None, 0),
    "liquid_blue": ("#57c7f2", 0.2, 0.0, None, 0),
    "mop_strand": ("#efe9db", 0.9, 0.0, None, 0),
    "mop_wet": ("#c4dde8", 0.9, 0.0, None, 0),
    "plastic_blue": ("#3a86ff", 0.4, 0.0, None, 0),
    "metal": ("#c0c5cc", 0.3, 0.9, None, 0),
    "bin_clear": ("#bcd9e6", 0.15, 0.0, None, 0),
    "dust": ("#8f8a82", 0.95, 0.0, None, 0),
    # furniture
    "wood": ("#c08552", 0.6, 0.0, None, 0),
    "wood_light": ("#d9a86c", 0.6, 0.0, None, 0),
    "wood_dark": ("#6f4a2f", 0.6, 0.0, None, 0),
    "fabric_teal": ("#3d8b8b", 0.95, 0.0, None, 0),
    "fabric_teal_light": ("#52a3a0", 0.95, 0.0, None, 0),
    "fabric_terracotta": ("#c8553d", 0.95, 0.0, None, 0),
    "fabric_terracotta_light": ("#d86f55", 0.95, 0.0, None, 0),
    "fabric_lavender": ("#8f86d9", 0.95, 0.0, None, 0),
    "linen": ("#f4efe4", 0.9, 0.0, None, 0),
    "cabinet_sage": ("#87a878", 0.55, 0.0, None, 0),
    "stone": ("#e9e5dc", 0.4, 0.0, None, 0),
    "appliance_white": ("#eef1f2", 0.3, 0.0, None, 0),
    "porcelain": ("#f8f8f3", 0.15, 0.0, None, 0),
    "water": ("#8fd3f0", 0.05, 0.0, None, 0),
    "rug_red": ("#b8473a", 0.95, 0.0, None, 0),
    "rug_cream": ("#f2d6a2", 0.95, 0.0, None, 0),
    "rug_rose": ("#e07a5f", 0.95, 0.0, None, 0),
    "wicker": ("#d2a679", 0.85, 0.0, None, 0),
    "cloth_pink": ("#f4a6b8", 0.95, 0.0, None, 0),
    "cloth_blue": ("#7fb7e6", 0.95, 0.0, None, 0),
    "cloth_white": ("#f3f3ef", 0.95, 0.0, None, 0),
    "shoe_blue": ("#3f6fb5", 0.7, 0.0, None, 0),
    "toy_red": ("#e63946", 0.35, 0.0, None, 0),
    "window_blue": ("#a8dcf5", 0.1, 0.0, None, 0),
    "book_blue": ("#2a6f97", 0.7, 0.0, None, 0),
    "paper": ("#f5ecd2", 0.9, 0.0, None, 0),
    "remote_black": ("#26282e", 0.5, 0.0, None, 0),
    "button_grey": ("#8a8f99", 0.5, 0.0, None, 0),
    "book_a": ("#e76f51", 0.7, 0.0, None, 0),
    "book_b": ("#2a9d8f", 0.7, 0.0, None, 0),
    "book_c": ("#e9c46a", 0.7, 0.0, None, 0),
    "book_d": ("#264653", 0.7, 0.0, None, 0),
    "book_e": ("#9b5de5", 0.7, 0.0, None, 0),
    # neighbourhood: houses and trees
    "siding_blue": ("#a9c6de", 0.8, 0.0, None, 0),
    "siding_yellow": ("#f4d98c", 0.8, 0.0, None, 0),
    "brick_red": ("#b0503a", 0.9, 0.0, None, 0),
    "trim_white": ("#f7f5ef", 0.6, 0.0, None, 0),
    "roof_grey": ("#535961", 0.85, 0.0, None, 0),
    "roof_brown": ("#5e3626", 0.85, 0.0, None, 0),
    "roof_dark": ("#3a3a40", 0.85, 0.0, None, 0),
    "door_red": ("#b8383b", 0.5, 0.0, None, 0),
    "door_green": ("#2f6b4f", 0.5, 0.0, None, 0),
    "shutter_navy": ("#34506f", 0.6, 0.0, None, 0),
    "concrete": ("#c8c3b9", 0.9, 0.0, None, 0),
    "garage_gap": ("#8a877f", 0.8, 0.0, None, 0),
    "flower_pink": ("#f28dad", 0.8, 0.0, None, 0),
    "bark": ("#7a5536", 0.9, 0.0, None, 0),
    "leaf_green": ("#5f9e47", 0.85, 0.0, None, 0),
    "leaf_light": ("#7cb85a", 0.85, 0.0, None, 0),
    "pine_green": ("#3e7a4c", 0.85, 0.0, None, 0),
    "pine_dark": ("#2f6340", 0.85, 0.0, None, 0),
    # neighbourhood: street props (car_paint / bike_frame are tinted per
    # instance in game, so they stay light neutral)
    "car_paint": ("#e8e8e8", 0.35, 0.0, None, 0),
    "bike_frame": ("#e6e6e6", 0.4, 0.0, None, 0),
    "bumper_grey": ("#5d636b", 0.6, 0.0, None, 0),
    "tail_red": ("#d62828", 0.35, 0.0, None, 0),
    "mailbox_slate": ("#4f5b69", 0.45, 0.2, None, 0),
    "bin_green": ("#3d8b4f", 0.6, 0.0, None, 0),
    "bin_lid": ("#2e6f3e", 0.6, 0.0, None, 0),
    "skin": ("#f2c49e", 0.6, 0.0, None, 0),
    "skin_pink": ("#ee9f86", 0.6, 0.0, None, 0),
    "rock_grey": ("#a19d94", 0.9, 0.0, None, 0),
    "hydrant_red": ("#d93a32", 0.45, 0.0, None, 0),
    # neighbourhood: hazards
    "mower_lime": ("#9bcb3b", 0.45, 0.0, None, 0),
    "mower_grey": ("#58606b", 0.5, 0.0, None, 0),
    "bag_green": ("#6c8a4c", 0.95, 0.0, None, 0),
    "brass": ("#c9a33a", 0.35, 0.8, None, 0),
    "hose_green": ("#43a047", 0.5, 0.0, None, 0),
    "sweeper_white": ("#f3f1ea", 0.45, 0.0, None, 0),
    "glow_amber": ("#ffb000", 0.3, 0.0, "#ffa000", 5.0),
    "glow_head": ("#fff3c4", 0.3, 0.0, "#ffe9a0", 4.0),
}


def M(key):
    """Material from the shared palette."""
    color, rough, metal, emit, strength = PALETTE[key]
    return mat(key, color, rough, metal, emit, strength)


def polar(angle_deg, radius, z=0.0):
    """Point on a circle. Angle 0 = forward (-Y), 90 = right (+X)."""
    a = math.radians(angle_deg)
    return (radius * math.sin(a), -radius * math.cos(a), z)


# --------------------------------------------------------------------------
# Parts: one mesh object each, built in model space
# --------------------------------------------------------------------------

def _matrix(center=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    rot = Euler(tuple(math.radians(r) for r in rot), "XYZ")
    return (Matrix.Translation(Vector(center)) @ rot.to_matrix().to_4x4()
            @ Matrix.Diagonal((*scale, 1.0)))


class Part:
    def __init__(self, name, pivot=(0, 0, 0)):
        self.name = name
        self.pivot = Vector(pivot)
        self.bm = bmesh.new()
        self.mats = []
        self._stack = [Matrix.Identity(4)]

    # -- transform stack ---------------------------------------------------
    @contextmanager
    def xform(self, center=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
        self._stack.append(self._stack[-1] @ _matrix(center, rot, scale))
        try:
            yield
        finally:
            self._stack.pop()

    def _m(self, center, rot, scale):
        return self._stack[-1] @ _matrix(center, rot, scale)

    def _slot(self, material):
        if material not in self.mats:
            self.mats.append(material)
        return self.mats.index(material)

    def _finish(self, verts, material, bevel=0.0, seg=1, bevel_angle=30):
        verts = list(verts)
        faces = {f for v in verts for f in v.link_faces}
        idx = self._slot(material)
        for f in faces:
            f.material_index = idx
        bmesh.ops.recalc_face_normals(self.bm, faces=list(faces))
        if bevel > 0:
            edges = {e for v in verts for e in v.link_edges}
            thr = math.radians(bevel_angle)
            edges = [e for e in edges if len(e.link_faces) == 2
                     and e.calc_face_angle(0) > thr]
            if edges:
                bmesh.ops.bevel(self.bm, geom=edges, offset=bevel,
                                offset_type="OFFSET", segments=seg,
                                profile=0.5, affect="EDGES", material=idx,
                                clamp_overlap=True)
        return faces

    # -- primitives ----------------------------------------------------------
    def box(self, size, center, material, bevel=0.0, seg=1, rot=(0, 0, 0)):
        """Axis box of `size` (x, y, z) centred on `center`."""
        r = bmesh.ops.create_cube(self.bm, size=1.0,
                                  matrix=self._m(center, rot, size))
        return self._finish(r["verts"], material, bevel, seg)

    def boxb(self, size, base, material, **kw):
        """Box whose bottom-centre sits at `base`."""
        x, y, z = base
        return self.box(size, (x, y, z + size[2] / 2), material, **kw)

    def cyl(self, r, depth, center, material, segs=16, r2=None, bevel=0.0,
            seg=1, rot=(0, 0, 0), scale=(1, 1, 1)):
        """Cylinder / truncated cone along local Z, centred on `center`."""
        res = bmesh.ops.create_cone(
            self.bm, cap_ends=True, cap_tris=False, segments=segs,
            radius1=r, radius2=r if r2 is None else r2, depth=depth,
            matrix=self._m(center, rot, scale))
        return self._finish(res["verts"], material, bevel, seg)

    def rod(self, a, b, r, material, segs=8, r2=None, bevel=0.0, seg=1):
        """Cylinder from point a to point b."""
        a, b = Vector(a), Vector(b)
        d = b - a
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        M = (self._stack[-1] @ Matrix.Translation((a + b) / 2)
             @ q.to_matrix().to_4x4())
        res = bmesh.ops.create_cone(
            self.bm, cap_ends=True, cap_tris=False, segments=segs,
            radius1=r, radius2=r if r2 is None else r2, depth=d.length,
            matrix=M)
        return self._finish(res["verts"], material, bevel, seg)

    def cone(self, r, depth, center, material, segs=8, rot=(0, 0, 0)):
        res = bmesh.ops.create_cone(
            self.bm, cap_ends=True, cap_tris=True, segments=segs,
            radius1=r, radius2=0.0, depth=depth,
            matrix=self._m(center, rot, (1, 1, 1)))
        return self._finish(res["verts"], material)

    def sphere(self, r, center, material, u=12, v=8, scale=(1, 1, 1),
               rot=(0, 0, 0)):
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=u, v_segments=v,
                                        radius=r,
                                        matrix=self._m(center, rot, scale))
        return self._finish(res["verts"], material)

    def prism(self, points, depth, center, material, rot=(0, 0, 0),
              bevel=0.0, seg=1):
        """Extrude a 2D polygon (local XY) along local Z, centred on `center`.

        rot=(90, 0, 90) maps local X -> world Y and local Y -> world Z, so a
        side profile (y, z) is extruded along X; rot=(90, 0, 0) maps local
        Y -> world Z, so a front profile (x, z) is extruded along Y."""
        M = self._m(center, rot, (1, 1, 1))
        bm = self.bm
        lo = [bm.verts.new(M @ Vector((x, y, -depth / 2))) for x, y in points]
        hi = [bm.verts.new(M @ Vector((x, y, depth / 2))) for x, y in points]
        bm.faces.new(list(reversed(lo)))
        bm.faces.new(hi)
        n = len(points)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
        return self._finish(lo + hi, material, bevel, seg)

    def lathe(self, profile, material, segs=16, center=(0, 0, 0),
              rot=(0, 0, 0), scale=(1, 1, 1), bevel=0.0, seg=1):
        """Revolve a (radius, z) profile around local Z. Points with radius 0
        become poles; otherwise ends are capped with n-gons."""
        M = self._m(center, rot, scale)
        bm = self.bm
        rings = []
        for (pr, pz) in profile:
            if pr <= 1e-6:
                rings.append([bm.verts.new(M @ Vector((0, 0, pz)))])
            else:
                ring = []
                for i in range(segs):
                    a = 2 * math.pi * i / segs
                    ring.append(bm.verts.new(
                        M @ Vector((pr * math.sin(a), -pr * math.cos(a), pz))))
                rings.append(ring)
        allv = [v for ring in rings for v in ring]
        for ra, rb in zip(rings, rings[1:]):
            for i in range(segs):
                j = (i + 1) % segs
                if len(ra) == 1 and len(rb) == 1:
                    continue
                if len(ra) == 1:
                    bm.faces.new((ra[0], rb[j], rb[i]))
                elif len(rb) == 1:
                    bm.faces.new((ra[i], ra[j], rb[0]))
                else:
                    bm.faces.new((ra[i], ra[j], rb[j], rb[i]))
        if len(rings[0]) > 1:
            bm.faces.new(list(reversed(rings[0])))
        if len(rings[-1]) > 1:
            bm.faces.new(rings[-1])
        bm.normal_update()
        return self._finish(allv, material, bevel, seg)

    def band(self, r_in, r_out, z0, z1, a0, a1, material, segs=12,
             bevel=0.0, seg=1):
        """Solid ring segment between angles a0..a1 (degrees, 0 = forward)."""
        bm = self.bm
        M = self._stack[-1]
        full = abs((a1 - a0) - 360) < 1e-6
        n = segs if full else segs + 1
        cols = []
        for i in range(n):
            a = a0 + (a1 - a0) * i / segs
            cols.append([bm.verts.new(M @ Vector(polar(a, rr, zz)))
                         for (rr, zz) in ((r_in, z0), (r_out, z0),
                                          (r_out, z1), (r_in, z1))])
        pairs = list(zip(cols, cols[1:]))
        if full:
            pairs.append((cols[-1], cols[0]))
        for ca, cb in pairs:
            for k in range(4):
                l = (k + 1) % 4
                bm.faces.new((ca[k], cb[k], cb[l], ca[l]))
        if not full:
            bm.faces.new(list(reversed(cols[0])))
            bm.faces.new(cols[-1])
        bmesh.ops.recalc_face_normals(bm, faces=list(
            {f for c in cols for v in c for f in v.link_faces}))
        return self._finish([v for c in cols for v in c], material, bevel, seg)

    def torus(self, R, r, center, material, segs=16, rsegs=6,
              rot=(0, 0, 0), scale=(1, 1, 1)):
        M = self._m(center, rot, scale)
        bm = self.bm
        grid = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            ring = []
            for k in range(rsegs):
                b = 2 * math.pi * k / rsegs
                rr = R + r * math.cos(b)
                ring.append(bm.verts.new(M @ Vector(
                    (rr * math.cos(a), rr * math.sin(a), r * math.sin(b)))))
            grid.append(ring)
        for i in range(segs):
            for k in range(rsegs):
                i2, k2 = (i + 1) % segs, (k + 1) % rsegs
                bm.faces.new((grid[i][k], grid[i2][k], grid[i2][k2],
                              grid[i][k2]))
        return self._finish([v for g in grid for v in g], material)


class Model:
    def __init__(self, model_id, notes=""):
        self.id = model_id
        self.notes = notes
        self.parts = {}

    def part(self, name="body", pivot=(0, 0, 0)):
        if name not in self.parts:
            self.parts[name] = Part(name, pivot)
        return self.parts[name]

    def build(self):
        """Turn the parts into Blender objects under a root empty."""
        scene = bpy.context.scene
        root = bpy.data.objects.new(self.id, None)
        scene.collection.objects.link(root)
        objs = []
        for p in self.parts.values():
            bm = p.bm
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
            bmesh.ops.translate(bm, vec=-p.pivot, verts=bm.verts)
            me = bpy.data.meshes.new(f"{self.id}_{p.name}")
            bm.to_mesh(me)
            bm.free()
            for m in p.mats:
                me.materials.append(m)
            me.shade_smooth()
            me.set_sharp_from_angle(angle=SMOOTH_ANGLE)
            ob = bpy.data.objects.new(p.name, me)
            ob.location = p.pivot
            ob.parent = root
            scene.collection.objects.link(ob)
            objs.append(ob)
        return root, objs


# --------------------------------------------------------------------------
# Export + stats
# --------------------------------------------------------------------------

def bl_to_gltf(v):
    """Blender (x, y, z) -> glTF/three.js (x, y, z) with +Y up."""
    return tuple(round(c, 2) + 0.0 for c in (v[0], v[2], -v[1]))


def stats(objs):
    tris = 0
    rmax = 0.0
    zmin, zmax = float("inf"), float("-inf")
    xs, ys = [], []
    for ob in objs:
        me = ob.data
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        for v in me.vertices:
            w = ob.matrix_world @ v.co
            rmax = max(rmax, math.hypot(w.x, w.y))
            zmin, zmax = min(zmin, w.z), max(zmax, w.z)
            xs.append(w.x)
            ys.append(w.y)
    return {
        "triangles": tris,
        "footprintRadius": round(rmax, 1),
        "height": round(zmax - zmin, 1),
        "minY": round(zmin, 1),
        "maxY": round(zmax, 1),
        # glTF axes: size along X (width) and Z (depth, forward axis)
        "sizeX": round(max(xs) - min(xs), 1),
        "sizeZ": round(max(ys) - min(ys), 1),
    }


def export(model):
    """Build `model`, export public/models/<id>.glb, return its stats dict."""
    bpy.context.view_layer.update()
    root, objs = model.build()
    bpy.context.view_layer.update()
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f"{model.id}.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
        export_texcoords=False,
        export_normals=True,
        export_draco_mesh_compression_enable=False,
    )
    info = stats(objs)
    info["id"] = model.id
    info["file"] = f"models/{model.id}.glb"
    info["bytes"] = os.path.getsize(path)
    info["notes"] = model.notes
    info["nodes"] = {
        ob.name: {"pivot": bl_to_gltf(ob.location)} for ob in objs
    }
    return info
