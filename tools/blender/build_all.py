"""Rebuild every Dust Bunny model and export public/models/<id>.glb.

Usage (from the repo root):
    blender -b --factory-startup --python tools/blender/build_all.py
    blender -b --factory-startup --python tools/blender/build_all.py -- roomba mop

Also writes public/models/catalog.json (sizes, triangle counts, node pivots)
and regenerates docs/models.md from it.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common  # noqa: E402
import furniture  # noqa: E402
import hazards  # noqa: E402
import outdoor  # noqa: E402

CATEGORIES = [("hazard", hazards.BUILDERS), ("furniture", furniture.BUILDERS),
              ("prop", furniture.PROPS),
              # neighbourhood (outside the front door)
              ("hazard", outdoor.HAZARDS), ("furniture", outdoor.FURNITURE),
              ("prop", outdoor.PROPS)]
MANIFEST = os.path.join(common.OUT_DIR, "catalog.json")
DOC = os.path.join(common.DOCS_DIR, "models.md")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    manifest = {}
    if argv and os.path.exists(MANIFEST):
        with open(MANIFEST) as f:
            manifest = {m["id"]: m for m in json.load(f)["models"]}
    order = []
    for cat, builders in CATEGORIES:
        for fn in builders:
            order.append(fn.__name__)
            if argv and fn.__name__ not in argv:
                continue
            common.reset_scene()
            info = common.export(fn())
            info["category"] = cat
            manifest[info["id"]] = info
            print(f"BUILT {info['id']:16s} tris={info['triangles']:5d} "
                  f"r={info['footprintRadius']:6.1f} h={info['height']:6.1f} "
                  f"{info['bytes'] / 1024:6.1f} KB")
    models = [manifest[i] for i in order if i in manifest]
    with open(MANIFEST, "w") as f:
        json.dump({
            "units": "cm",
            "up": "+Y",
            "forward": "+Z",
            "origin": "bottom centre at floor contact (broom: top of handle)",
            "models": models,
        }, f, indent=2)
    write_doc(models)


def write_doc(models):
    total = sum(m["bytes"] for m in models)
    lines = [
        "# Models",
        "",
        "Procedural low-poly models for Dust Bunny, built with Blender "
        "(`tools/blender/`) and exported as glTF binary to `public/models/`.",
        "",
        "## Conventions",
        "",
        "- Units: 1 unit = 1 cm, so load at scale 1 in the cm-based world.",
        "- Axes: +Y up, forward is +Z (Blender -Y is exported as +Z).",
        "- Origin: bottom centre at the floor contact point (y = 0). "
        "The broom is the exception: see its row.",
        "- No Draco, no textures: Principled BSDF base colour, roughness, "
        "metallic, and emissive (roomba button, Robo-Vac eye, vacuum lamp "
        "and power light, street sweeper beacon and headlights).",
        "- Each file has one root node named after the id. Static geometry "
        "is a single `body` mesh child; parts the game may animate are "
        "separate children whose origin is their pivot (listed below).",
        "- Footprint radius is the largest horizontal distance from the "
        "origin to any vertex; height is the vertical extent.",
        "- `public/models/catalog.json` holds the same numbers in "
        "machine-readable form (plus X/Z extents and node pivots).",
        "",
        "## Rebuild",
        "",
        "```sh",
        "blender -b --factory-startup --python tools/blender/build_all.py",
        "# only some models:",
        "blender -b --factory-startup --python tools/blender/build_all.py -- "
        "roomba broom",
        "# contact sheet -> docs/models-preview.png",
        "blender -b --factory-startup --python tools/blender/render_preview.py",
        "```",
        "",
        "## Catalogue",
        "",
        "| id | category | file | footprint radius (cm) | height (cm) | "
        "size X × Z (cm) | forward | pivot / notes | triangles | KB |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for m in models:
        nodes = [f"`{n}` at {tuple(v['pivot'])}" for n, v in m["nodes"].items()
                 if n != "body"]
        notes = m["notes"]
        if nodes:
            notes += " Animated nodes: " + ", ".join(nodes) + "."
        lines.append(
            f"| `{m['id']}` | {m['category']} | `public/{m['file']}` | "
            f"{m['footprintRadius']:g} | {m['height']:g} | "
            f"{m['sizeX']:g} × {m['sizeZ']:g} | +Z | {notes} | "
            f"{m['triangles']} | {m['bytes'] / 1024:.1f} |")
    lines += [
        "",
        f"Total: {len(models)} models, "
        f"{sum(m['triangles'] for m in models)} triangles, "
        f"{total / 1024:.0f} KB.",
        "",
        "![Contact sheet](models-preview.png)",
        "",
    ]
    with open(DOC, "w") as f:
        f.write("\n".join(lines))


main()
