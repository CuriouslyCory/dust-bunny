"""Render contact sheets of the exported models: docs/models-preview.png
(the cm-scale models), docs/models-preview-continent.png (the Continent
models, authored at 1 unit = 100 m), docs/models-preview-globe.png (the
Globe models, 1 unit = 10 km) and docs/models-preview-solar.png (the Solar
System models, 1 unit = 0.0001 AU).

Usage (from the repo root, after build_all.py):
    blender -b --factory-startup --python tools/blender/render_preview.py
    # only the Continent sheet:
    blender -b --factory-startup --python tools/blender/render_preview.py -- --continent
    # only the Globe sheet:
    blender -b --factory-startup --python tools/blender/render_preview.py -- --globe
    # only the Solar System sheet:
    blender -b --factory-startup --python tools/blender/render_preview.py -- --solar
    # debug: bigger tiles of some models to /tmp (add --top for a steep,
    # game-camera-like view)
    blender -b --factory-startup --python tools/blender/render_preview.py -- roomba --top

Each model is imported from its .glb (so the sheet shows what the game gets),
rendered with Workbench from a high three-quarter front view, and the tiles
are stitched into a 5-column grid.
"""

import json
import math
import os
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common  # noqa: E402

TILE_W, TILE_H = 320, 200
COLS = 5
VIEW_DIR = Vector((0.55, -1.0, 1.05)).normalized()  # camera sits front-right-up


def setup_render(scene):
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = TILE_W
    scene.render.resolution_y = TILE_H
    scene.render.film_transparent = False
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    sh = scene.display.shading
    sh.light = "STUDIO"
    sh.color_type = "MATERIAL"
    sh.show_shadows = True
    sh.shadow_intensity = 0.35
    sh.show_cavity = True
    sh.cavity_type = "WORLD"
    scene.display.render_aa = "8"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.exposure = 0.7


def flat_mat(name, hex_color):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*common.hex_rgb(hex_color), 1.0)
    return m


def render_tile(scene, path, label, out, out_label, view_dir=VIEW_DIR):
    common.reset_scene()
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in scene.objects if o.type == "MESH"]
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts),
                 min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts),
                 max(p.z for p in pts)))
    center = (lo + hi) / 2
    size = (hi - lo).length

    # floor
    bpy.ops.mesh.primitive_plane_add(size=size * 6, location=(center.x,
                                                               center.y, lo.z))
    floor = bpy.context.active_object
    floor.data.materials.append(flat_mat("floor", "#d9c4a3"))

    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.location = center + view_dir * size * 3
    cam.rotation_euler = (-view_dir).to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()

    # fit the ortho frame to the projected bounding box
    inv = cam.matrix_world.inverted()
    corners = [inv @ Vector((x, y, z)) for x in (lo.x, hi.x)
               for y in (lo.y, hi.y) for z in (lo.z, hi.z)]
    xs = [c.x for c in corners]
    ys = [c.y for c in corners]
    aspect = TILE_W / TILE_H
    w = max(xs) - min(xs)
    h = (max(ys) - min(ys)) * 1.25  # leave room for the label
    cam_data.ortho_scale = max(w, h * aspect) * 1.12
    shift = cam.matrix_world.to_3x3() @ Vector(
        ((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2 - 0.08 * h, 0))
    cam.location += shift
    cam_data.clip_start = 0.1
    cam_data.clip_end = size * 10

    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)

    # second pass: label only, transparent and shadowless, so the text does
    # not cast a shadow into the tile; composited in main()
    s = cam_data.ortho_scale
    txt_data = bpy.data.curves.new("label", "FONT")
    txt_data.body = label
    txt_data.size = s * 0.055
    txt = bpy.data.objects.new("label", txt_data)
    txt.data.materials.append(flat_mat("label", "#222222"))
    scene.collection.objects.link(txt)
    txt.parent = cam
    txt.location = (-s / 2 + s * 0.02, -s / aspect / 2 + s * 0.02, -0.5)
    for o in scene.objects:
        o.hide_render = o not in (txt, cam)
    scene.render.film_transparent = True
    scene.display.shading.show_shadows = False
    scene.display.shading.light = "FLAT"
    scene.render.filepath = out_label
    bpy.ops.render.render(write_still=True)
    scene.render.film_transparent = False
    scene.display.shading.show_shadows = True
    scene.display.shading.light = "STUDIO"


def load_px(path, w, h):
    img = bpy.data.images.load(path)
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)


def render_sheet(scene, models, out_path, tmp, view_dir=VIEW_DIR):
    tiles = []
    for m in models:
        out = os.path.join(tmp, f"{m['id']}.png")
        out_label = os.path.join(tmp, f"{m['id']}_label.png")
        if m.get("units", "cm") == "cm":
            label = (f"{m['id']}  r{m['footprintRadius']:g} "
                     f"h{m['height']:g} cm  {m['triangles']} tris")
        else:  # Continent / Globe / Solar units, rounded so the label fits the tile
            label = (f"{m['id']}  r{m['footprintRadius']:.0f} "
                     f"h{m['height']:.0f} ({m['units']})  "
                     f"{m['triangles']} tris")
        render_tile(scene, os.path.join(common.REPO, "public", m["file"]),
                    label, out, out_label, view_dir)
        tiles.append((out, out_label))

    cols = min(COLS, len(tiles))
    rows = math.ceil(len(tiles) / cols)
    sheet = np.ones((rows * TILE_H, cols * TILE_W, 4), dtype=np.float32)
    for i, (path, lpath) in enumerate(tiles):
        px = load_px(path, TILE_W, TILE_H)
        lb = load_px(lpath, TILE_W, TILE_H)
        a = lb[:, :, 3:4]
        px[:, :, :3] = lb[:, :, :3] * a + px[:, :, :3] * (1 - a)
        px[:, :, 3] = 1.0
        col, row = i % cols, i // cols
        y0 = (rows - 1 - row) * TILE_H  # Blender images start bottom-left
        sheet[y0:y0 + TILE_H, col * TILE_W:(col + 1) * TILE_W] = px
    out = bpy.data.images.new("sheet", cols * TILE_W, rows * TILE_H)
    out.pixels.foreach_set(sheet.ravel())
    out.filepath_raw = out_path
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)
    print("PREVIEW", out_path)


def main():
    global TILE_W, TILE_H
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    flags = {a for a in args if a.startswith("--")}
    only = [a for a in args if not a.startswith("--")]
    scene = bpy.context.scene
    with open(os.path.join(common.OUT_DIR, "catalog.json")) as f:
        models = json.load(f)["models"]
    tmp = tempfile.mkdtemp(prefix="dustbunny_preview_")
    if only:  # debug: bigger tiles of just these models, written to /tmp
        TILE_W, TILE_H = TILE_W * 2, TILE_H * 2
        setup_render(scene)
        view = (Vector((0.15, -0.45, 1.0)).normalized() if "--top" in flags
                else VIEW_DIR)
        render_sheet(scene, [m for m in models if m["id"] in only],
                     os.path.join(tmp, "debug.png"), tmp, view)
        return
    setup_render(scene)
    sheets = [("cm", "models-preview.png", None),
              ("100 m", "models-preview-continent.png", "--continent"),
              ("10 km", "models-preview-globe.png", "--globe"),
              ("0.0001 AU", "models-preview-solar.png", "--solar")]
    picked = {flag for _, _, flag in sheets} & flags
    for units, name, flag in sheets:
        if picked and flag not in picked:
            continue
        group = [m for m in models if m.get("units", "cm") == units]
        if group:
            render_sheet(scene, group, os.path.join(common.DOCS_DIR, name),
                         tmp)


main()
