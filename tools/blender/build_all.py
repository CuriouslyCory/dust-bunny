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

import city  # noqa: E402
import common  # noqa: E402
import continent  # noqa: E402
import furniture  # noqa: E402
import globe  # noqa: E402
import hazards  # noqa: E402
import outdoor  # noqa: E402
import region  # noqa: E402
import solar  # noqa: E402

CATEGORIES = [("hazard", hazards.BUILDERS), ("furniture", furniture.BUILDERS),
              ("prop", furniture.PROPS),
              # neighbourhood (outside the front door)
              ("hazard", outdoor.HAZARDS), ("furniture", outdoor.FURNITURE),
              ("prop", outdoor.PROPS),
              # city (after the neighbourhood)
              ("hazard", city.HAZARDS), ("furniture", city.FURNITURE),
              ("prop", city.PROPS),
              # region (Act 4, after the city)
              ("hazard", region.HAZARDS),
              # continent (Act 5; 1 unit = 100 m, loaded at scale 0.01)
              ("hazard", continent.HAZARDS), ("prop", continent.PROPS),
              # globe (Act 6; 1 unit = 10 km, loaded at scale 0.01)
              ("hazard", globe.HAZARDS), ("prop", globe.PROPS),
              # solar system (Act 7; 1 unit = 0.0001 AU, loaded at scale 0.01)
              ("hazard", solar.HAZARDS), ("prop", solar.PROPS)]
# ids authored in other units than cm (catalog "units" field)
UNITS = {fn.__name__: mod.UNITS for mod in (continent, globe, solar)
         for fn in mod.HAZARDS + mod.PROPS}
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
            if fn.__name__ in UNITS:
                info["units"] = UNITS[fn.__name__]
            manifest[info["id"]] = info
            print(f"BUILT {info['id']:16s} tris={info['triangles']:5d} "
                  f"r={info['footprintRadius']:6.1f} h={info['height']:6.1f} "
                  f"{info['bytes'] / 1024:6.1f} KB")
    models = [manifest[i] for i in order if i in manifest]
    with open(MANIFEST, "w") as f:
        json.dump({
            "units": "cm (models with a \"units\" field: that unit)",
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
        "- Units: 1 unit = 1 cm, so load at scale 1 in the cm-based world. "
        "Exception: the Continent models (`tools/blender/continent.py`, "
        "rows whose notes start with \"Continent scale\") use 1 unit = 100 m, because one "
        "Continent world unit is 10 km = 100 units; load them at scale 0.01 "
        "(`\"scale\": 0.01` in `manifest.json`). Their sizes in the table "
        "are in those 100 m units, and their catalog entries carry "
        "`\"units\": \"100 m\"`. The Globe models "
        "(`tools/blender/globe.py`, notes starting \"Globe scale\") use "
        "1 unit = 10 km: see Globe scale below. The Solar System models "
        "(`tools/blender/solar.py`, notes starting \"Solar scale\") use "
        "1 unit = 0.0001 AU: see Solar scale below.",
        "- Axes: +Y up, forward is +Z (Blender -Y is exported as +Z).",
        "- Origin: bottom centre at the floor contact point (y = 0). "
        "The broom is the exception: see its row.",
        "- No Draco, no textures: Principled BSDF base colour, roughness, "
        "metallic, and emissive (roomba button, Robo-Vac eye, vacuum lamp "
        "and power light, street sweeper beacon and headlights, city "
        "vehicle beacons, headlights and signs, street lamp and tower "
        "crown lights, region vehicle beacons and light bars, the "
        "Incinerator's furnace glow, volcano lava, Ice Sheet crevasses and "
        "eyes, storm lightning).",
        "- Each file has one root node named after the id. Static geometry "
        "is a single `body` mesh child; parts the game may animate are "
        "separate children whose origin is their pivot (listed below).",
        "- Footprint radius is the largest horizontal distance from the "
        "origin to any vertex; height is the vertical extent.",
        "- `public/models/catalog.json` holds the same numbers in "
        "machine-readable form (plus X/Z extents and node pivots).",
        "",
        "## Globe scale",
        "",
        "One Globe world unit is 1,000 km, so the Globe models "
        "(`tools/blender/globe.py`) are authored at 1 unit = 10 km (100 "
        "units per world unit) and loaded at `\"scale\": 0.01` in "
        "`manifest.json`, the same factor as the Continent. Their catalog "
        "entries carry `\"units\": \"10 km\"` and their table sizes are in "
        "those 10 km units: multiply by 0.01 for Globe world units (the "
        "Orbital Sweeper's 255 footprint radius is 2.55 world units). Hazards "
        "load with fit none + collapse, so the hazard code scales them by "
        "`size / modelSize`; Debris props are normalised to their Debris "
        "size by `src/entities/debrisGeometry.ts`, so only their shape and "
        "proportions matter (the Moon is drawn at its true 1,737 km "
        "radius).",
        "",
        "## Solar scale",
        "",
        "One Solar System world unit is 0.01 AU, so the Solar System models "
        "(`tools/blender/solar.py`) are authored at 1 unit = 0.0001 AU "
        "(about 15,000 km; 100 units per world unit) and loaded at "
        "`\"scale\": 0.01` like the Globe models. Their catalog entries "
        "carry `\"units\": \"0.0001 AU\"` and their table sizes are in "
        "those units: multiply by 0.01 for Solar System world units (the "
        "Sun's 292 footprint radius is 2.92 world units). Hazards load with "
        "fit none + collapse and are scaled by `size / modelSize`; Debris "
        "props are normalised to their Debris size, so they are drawn at a "
        "convenient size (planets: radius 100, resting on the floor, rings "
        "flat in XZ) and only their proportions matter. The camera looks "
        "down from the +Z side, so the Sun's eyes, Jupiter's Great Red Spot "
        "and Pluto's heart face +Z and upwards. Saturn's and the ice "
        "giant's rings count in the footprint radius, so their spheres "
        "draw at 1 / 2.28 and 1 / 1.58 of the Debris size.",
        "",
        "## Rebuild",
        "",
        "```sh",
        "blender -b --factory-startup --python tools/blender/build_all.py",
        "# only some models:",
        "blender -b --factory-startup --python tools/blender/build_all.py -- "
        "roomba broom",
        "# contact sheets -> docs/models-preview.png (cm models), "
        "docs/models-preview-continent.png, docs/models-preview-globe.png "
        "and docs/models-preview-solar.png",
        "blender -b --factory-startup --python tools/blender/render_preview.py",
        "# only the Continent sheet:",
        "blender -b --factory-startup --python tools/blender/render_preview.py"
        " -- --continent",
        "# only the Globe sheet:",
        "blender -b --factory-startup --python tools/blender/render_preview.py"
        " -- --globe",
        "# only the Solar System sheet:",
        "blender -b --factory-startup --python tools/blender/render_preview.py"
        " -- --solar",
        "```",
        "",
        "## Catalogue",
        "",
        "| id | category | file | footprint radius (cm*) | height (cm*) | "
        "size X × Z (cm*) | forward | pivot / notes | triangles | KB |",
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
        "\\* Continent models: units of 100 m (see Conventions). Globe "
        "models: units of 10 km (see Globe scale). Solar System models: "
        "units of 0.0001 AU (see Solar scale).",
        "",
        f"Total: {len(models)} models, "
        f"{sum(m['triangles'] for m in models)} triangles, "
        f"{total / 1024:.0f} KB.",
        "",
        "![Contact sheet](models-preview.png)",
        "",
        "Continent models (Act 5):",
        "",
        "![Continent contact sheet](models-preview-continent.png)",
        "",
        "Globe models (Act 6):",
        "",
        "![Globe contact sheet](models-preview-globe.png)",
        "",
        "Solar System models (Act 7):",
        "",
        "![Solar System contact sheet](models-preview-solar.png)",
        "",
    ]
    with open(DOC, "w") as f:
        f.write("\n".join(lines))


main()
