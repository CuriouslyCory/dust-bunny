# Models

Procedural low-poly models for Dust Bunny, built with Blender (`tools/blender/`) and exported as glTF binary to `public/models/`.

## Conventions

- Units: 1 unit = 1 cm, so load at scale 1 in the cm-based world.
- Axes: +Y up, forward is +Z (Blender -Y is exported as +Z).
- Origin: bottom centre at the floor contact point (y = 0). The broom is the exception: see its row.
- No Draco, no textures: Principled BSDF base colour, roughness, metallic, and emissive (roomba button, Robo-Vac eye, vacuum lamp and power light, street sweeper beacon and headlights, city vehicle beacons, headlights and signs, street lamp and tower crown lights, region vehicle beacons and light bars, the Incinerator's furnace glow).
- Each file has one root node named after the id. Static geometry is a single `body` mesh child; parts the game may animate are separate children whose origin is their pivot (listed below).
- Footprint radius is the largest horizontal distance from the origin to any vertex; height is the vertical extent.
- `public/models/catalog.json` holds the same numbers in machine-readable form (plus X/Z extents and node pivots).

## Rebuild

```sh
blender -b --factory-startup --python tools/blender/build_all.py
# only some models:
blender -b --factory-startup --python tools/blender/build_all.py -- roomba broom
# contact sheet -> docs/models-preview.png
blender -b --factory-startup --python tools/blender/render_preview.py
```

## Catalogue

| id | category | file | footprint radius (cm) | height (cm) | size X × Z (cm) | forward | pivot / notes | triangles | KB |
|---|---|---|---|---|---|---|---|---|---|
| `roomba` | hazard | `public/models/roomba.glb` | 18.3 | 9.7 | 34.5 × 33.9 | +Z | side_brush node spins about its local Y (up) axis. Animated nodes: `side_brush` at (7.71, 0.6, 9.19). | 1456 | 50.5 |
| `lint_roller` | hazard | `public/models/lint_roller.glb` | 22.6 | 10.2 | 13.8 × 25.7 | +Z | Roller axis along X. drum node pivots on the roller axis at y = 3 cm; spin it about local X while rolling along Z. Animated nodes: `drum` at (0.0, 3.0, 0.0). | 688 | 25.6 |
| `broom` | hazard | `public/models/broom.glb` | 47.7 | 114.7 | 36 × 45.9 | +Z | Origin is the sweep pivot at the TOP of the handle; the floor is at y = -113. The head rests on the floor 40 cm forward (+Z). Rotate about Y through the origin to sweep. | 424 | 15.7 |
| `spray_bottle` | hazard | `public/models/spray_bottle.glb` | 8.5 | 24.5 | 10.2 × 13.6 | +Z | Nozzle points +Z; spray emits from about (0, 21.8, 8.5) in model space. | 708 | 25.0 |
| `mop` | hazard | `public/models/mop.glb` | 14.2 | 47.6 | 28.2 × 28.2 | +Z | Head footprint radius ~15 cm; stub handle leans back. | 1224 | 55.2 |
| `upright_vacuum` | hazard | `public/models/upright_vacuum.glb` | 27.5 | 109.5 | 30.8 × 46 | +Z | Intake slot on the front of the base (+Z). | 1116 | 43.3 |
| `robovac_9000` | hazard | `public/models/robovac_9000.glb` | 35.1 | 20.4 | 64.6 × 69.4 | +Z | Boss. brush_l / brush_r nodes spin about local Y. Red visor eye uses an emissive material. Animated nodes: `brush_l` at (-17.09, 1.0, 15.39), `brush_r` at (17.09, 1.0, 15.39). | 2766 | 96.2 |
| `couch` | furniture | `public/models/couch.glb` | 108.1 | 85 | 200 × 90 | +Z | Skirt gap 6 cm under the frame (Bunny can slip under). | 1192 | 36.4 |
| `armchair` | furniture | `public/models/armchair.glb` | 60.2 | 85 | 90 × 85 | +Z | Skirt gap 9 cm under the frame. | 760 | 24.9 |
| `coffee_table` | furniture | `public/models/coffee_table.glb` | 62.3 | 42 | 110 × 60 | +Z | Open underneath: 38 cm clearance below the top (no shelf or apron, so a Bunny under 38 cm can roll under). | 252 | 9.2 |
| `bookshelf` | furniture | `public/models/bookshelf.glb` | 42.5 | 180 | 80 × 30 | +Z | Open front faces +Z. | 1288 | 70.1 |
| `bed` | furniture | `public/models/bed.glb` | 129.4 | 105 | 160 × 205 | +Z | Foot of the bed faces +Z; 24 cm clearance underneath. Footprint 160 x 205 including head- and footboard. | 1004 | 32.8 |
| `dining_table` | furniture | `public/models/dining_table.glb` | 91.4 | 75 | 160 × 90 | +Z | Open underneath (71 cm clearance below the top; legs 6 x 6 cm, 6 cm in from the edges). | 284 | 10.1 |
| `chair` | furniture | `public/models/chair.glb` | 33.2 | 90 | 45 × 46 | +Z | Seat faces +Z (backrest at -Z). | 536 | 18.4 |
| `kitchen_counter` | furniture | `public/models/kitchen_counter.glb` | 68.2 | 90.5 | 122 × 62 | +Z | Cabinet doors face +Z; worktop at 90 cm. | 412 | 18.8 |
| `fridge` | furniture | `public/models/fridge.glb` | 49.6 | 180 | 75 × 72.2 | +Z | Doors face +Z. | 488 | 22.3 |
| `toilet` | furniture | `public/models/toilet.glb` | 39.6 | 79 | 42 × 67.7 | +Z | Bowl faces +Z, tank at the back (-Z). | 944 | 26.9 |
| `bathtub` | furniture | `public/models/bathtub.glb` | 91.9 | 64.3 | 170 × 75 | +Z | Long axis along X; tap end at +X. Includes a rubber duck. | 960 | 34.0 |
| `rug` | furniture | `public/models/rug.glb` | 124 | 1.3 | 213 × 140 | +Z | Flat (about 1 cm). Fringe along the X ends. | 604 | 30.0 |
| `laundry_basket` | furniture | `public/models/laundry_basket.glb` | 27 | 48 | 51.2 × 51.2 | +Z | Round wicker basket with clothes piled in. | 1364 | 41.0 |
| `shoe` | prop | `public/models/shoe.glb` | 14.6 | 11.3 | 10 × 28.7 | +Z | Sneaker, toe points +Z. | 772 | 23.8 |
| `sock` | prop | `public/models/sock.glb` | 16.7 | 2.8 | 23.2 × 25.2 | +Z | Lying flat, L-shaped. | 548 | 16.6 |
| `toy_car` | prop | `public/models/toy_car.glb` | 6.6 | 4.8 | 6.4 × 12.3 | +Z | Front faces +Z. | 564 | 24.6 |
| `book` | prop | `public/models/book.glb` | 13.7 | 3.1 | 15.1 × 23 | +Z | Lying flat, spine on -X. | 156 | 7.9 |
| `tv_remote` | prop | `public/models/tv_remote.glb` | 9.3 | 2.2 | 5 × 18.2 | +Z | IR end points +Z. | 380 | 18.8 |
| `robo_mower` | hazard | `public/models/robo_mower.glb` | 55.2 | 31.4 | 91 × 106.5 | +Z | Robotic lawn mower, front +Z. blade node spins about its local Y axis (pivot under the centre). Animated nodes: `blade` at (0.0, 2.2, 0.0). | 1496 | 53.7 |
| `lawn_mower` | hazard | `public/models/lawn_mower.glb` | 65.4 | 98.6 | 78.2 × 98.9 | +Z | Unmanned red push mower; deck centred on the origin, front +Z, handle and grass bag rise towards -Z. | 1416 | 52.0 |
| `leaf_blower` | hazard | `public/models/leaf_blower.glb` | 45.1 | 40 | 41 × 87.7 | +Z | Orange backpack leaf blower set down on the ground; the blower tube runs along the floor to the nozzle at about (0, 4.5, 45) in model space, blowing +Z. | 916 | 36.9 |
| `sprinkler` | hazard | `public/models/sprinkler.glb` | 44.5 | 69.5 | 77.7 × 68 | +Z | Impact sprinkler on a tripod. head node turns about the vertical axis through the origin; nozzle points +Z with its tip at about (0, 62.9, 13.7) in model space (head at rest). Animated nodes: `head` at (0.0, 50.0, 0.0). | 652 | 30.1 |
| `street_sweeper` | hazard | `public/models/street_sweeper.glb` | 177.5 | 228.5 | 223 × 309.7 | +Z | Boss. Municipal street sweeper, front +Z. brush_l / brush_r nodes spin about local Y. Rooftop beacon and headlights use emissive materials. Animated nodes: `brush_l` at (-75.0, 5.0, 120.0), `brush_r` at (75.0, 5.0, 120.0). | 3034 | 117.9 |
| `house_a` | furniture | `public/models/house_a.glb` | 640.3 | 778 | 1000 × 800 | +Z | Two-storey gable house, ridge along X. Fills the 1000 x 800 footprint exactly; front door centred on +Z with a step. | 1746 | 98.8 |
| `house_b` | furniture | `public/models/house_b.glb` | 721.1 | 548 | 1200 × 800 | +Z | Single-storey bungalow, ridge along X. Fills the 1200 x 800 footprint exactly; garage door on the +X half of the +Z face, front door (with step) on the -X half. | 1458 | 82.1 |
| `house_c` | furniture | `public/models/house_c.glb` | 636.4 | 800 | 900 × 900 | +Z | Brick two-storey with a pyramid roof. Fills the 900 x 900 footprint exactly; front door centred on +Z under a white portico. | 1732 | 95.4 |
| `tree_oak` | furniture | `public/models/tree_oak.glb` | 257.1 | 799 | 477.2 × 494 | +Z | Collision is the trunk only (radius 25 at the base); the lumpy canopy spreads to about r = 260. | 1100 | 24.6 |
| `tree_pine` | furniture | `public/models/tree_pine.glb` | 180 | 900 | 360 × 360 | +Z | Collision is the trunk only (radius 20 at the base); stacked-cone canopy spreads to r = 180. | 278 | 10.4 |
| `car` | prop | `public/models/car.glb` | 216.2 | 153.2 | 180.6 × 403 | +Z | Compact hatchback, front +Z. car_paint (light neutral) is the largest material and is tinted per instance. | 1332 | 53.7 |
| `mailbox` | prop | `public/models/mailbox.glb` | 35.8 | 120 | 20.5 × 48.8 | +Z | Wooden post with a rounded US-style mailbox; door faces +Z, red flag on the +X side. | 376 | 17.4 |
| `trash_can` | prop | `public/models/trash_can.glb` | 47.4 | 104.7 | 60 × 75 | +Z | Green wheelie bin; lid hinges at the back (-Z) where the two wheels and the handle are. | 368 | 19.3 |
| `bicycle` | prop | `public/models/bicycle.glb` | 90.1 | 99.1 | 56 × 178.7 | +Z | Upright on its kickstand, front wheel +Z. bike_frame (light neutral) is the largest material and is tinted per instance. | 1436 | 59.2 |
| `garden_gnome` | prop | `public/models/garden_gnome.glb` | 8.9 | 40.7 | 17.7 × 17.7 | +Z | Red pointy hat, white beard, blue coat; faces +Z on a small stone base. | 912 | 35.0 |
| `fire_hydrant` | prop | `public/models/fire_hydrant.glb` | 20.5 | 75 | 39.6 × 35.4 | +Z | Red hydrant with silver caps: pumper cap faces +Z, hose caps on +/-X. | 1102 | 35.7 |
| `floor_scrubber` | hazard | `public/models/floor_scrubber.glb` | 93 | 139 | 95 × 154 | +Z | Ride-on sidewalk scrubber, front +Z. brush node (scrub disc under the front) spins about its local Y axis. Orange roof beacon and headlights are emissive. Animated nodes: `brush` at (0.0, 5.0, 38.0). | 1504 | 60.9 |
| `pressure_washer` | hazard | `public/models/pressure_washer.glb` | 55.1 | 106.8 | 69.8 × 89.3 | +Z | Wheeled gas pressure washer cart. head node turns about the vertical axis through the origin; the spray wand points +Z with its nozzle tip at about (0, 92.8, 45) in model space (head at rest). Hose runs from the pump to the swivel post. Animated nodes: `head` at (0.0, 90.0, 0.0). | 1236 | 55.1 |
| `street_flusher` | hazard | `public/models/street_flusher.glb` | 369 | 286 | 263 × 691.7 | +Z | Municipal street-flusher water truck, front +Z: white and blue tank body, cab at the front, spray bar with seven nozzles across the front bumper (bar at y = 38, z = 346; nozzles aim forward-down from z = 350). Amber light bar and headlights are emissive. | 3196 | 115.8 |
| `litter_vacuum` | hazard | `public/models/litter_vacuum.glb` | 93 | 160.5 | 87.8 × 174.6 | +Z | Electric litter-vacuum cart (Glutton style), front +Z: green and white cart with a big ribbed intake hose arcing forward and down to a nozzle on the ground; the nozzle is centred at about (0, 5, 78) in model space with its mouth lip at z = 88. | 1752 | 68.7 |
| `garbage_truck` | hazard | `public/models/garbage_truck.glb` | 481 | 381 | 273 × 924.4 | +Z | Boss. Rear-loader garbage truck, cab +Z, compactor at -Z. brush_l / brush_r nodes (gutter brushes under the front bumper corners) spin about local Y. Amber roof beacons and headlights are emissive. Animated nodes: `brush_l` at (-100.0, 5.0, 428.0), `brush_r` at (100.0, 5.0, 428.0). | 3316 | 134.6 |
| `building_office` | furniture | `public/models/building_office.glb` | 1697.1 | 6000 | 2400 × 2400 | +Z | Glass-and-steel office tower. Fills the 2400 x 2400 footprint exactly; banded teal curtain wall, recessed glass lobby behind a steel colonnade with a revolving door and canopy centred on +Z, mechanical plant on the roof. | 1692 | 86.2 |
| `building_tower` | furniture | `public/models/building_tower.glb` | 1414.2 | 9500 | 2000 × 2000 | +Z | Slim glass skyscraper. Fills the 2000 x 2000 footprint exactly; granite podium with a recessed lobby (entrance centred on +Z), vertical-pier curtain wall, three setbacks under a pyramid crown topped at 9000 cm, then an antenna with a red beacon (emissive) to 9500 cm. | 2136 | 114.9 |
| `building_apartment` | furniture | `public/models/building_apartment.glb` | 1280.6 | 3200 | 2000 × 1600 | +Z | Five-storey brick apartment block. Fills the 2000 x 1600 footprint exactly; stoop in a recessed entry centred on +Z, fire escape in a recessed bay on the +X side, wooden water tank on the roof reaching 3200 cm. | 3752 | 197.4 |
| `building_shops` | furniture | `public/models/building_shops.glb` | 1389.2 | 1200 | 2400 × 1400 | +Z | Two-storey shop row. Fills the 2400 x 1400 footprint exactly; three shopfronts on +Z recessed 120 cm under red / green / blue striped awnings that reach the edge, flat roof behind a parapet. | 1920 | 106.8 |
| `building_brick` | furniture | `public/models/building_brick.glb` | 1486.6 | 2000 | 2200 × 2000 | +Z | Old four-storey brick warehouse / loft. Fills the 2200 x 2000 footprint exactly; arched windows, two arched loading doors and a central entrance on +Z, corbelled cornice and parapet. | 3790 | 171.2 |
| `taxi` | prop | `public/models/taxi.glb` | 247.2 | 154 | 192 × 465 | +Z | Yellow sedan cab with a roof sign and checker band, front +Z. Always yellow (not tinted). | 1600 | 68.1 |
| `city_bus` | prop | `public/models/city_bus.glb` | 619.2 | 310 | 265 × 1212 | +Z | City bus, front +Z, doors on the -X side. car_paint (light neutral) is the largest material and is tinted per instance. | 1188 | 52.5 |
| `food_truck` | prop | `public/models/food_truck.glb` | 345.3 | 306 | 275.1 × 654 | +Z | Step-van food truck, front +Z. Serving hatch with a propped awning on the +X side. car_paint (light neutral) is the largest material and is tinted per instance. | 1604 | 65.0 |
| `dumpster` | prop | `public/models/dumpster.glb` | 110.7 | 125.3 | 192 × 124.5 | +Z | Green steel dumpster with two black lids; slanted front faces +Z, fork pockets on the sides. | 460 | 22.2 |
| `newspaper_box` | prop | `public/models/newspaper_box.glb` | 28.3 | 110 | 42 × 43.5 | +Z | Coin-op newspaper box on a pedestal; window and pull handle face +Z. | 252 | 17.1 |
| `hot_dog_cart` | prop | `public/models/hot_dog_cart.glb` | 95.1 | 220 | 176 × 183.2 | +Z | Stainless hot dog cart with a red and yellow umbrella; wheels at the -Z end, push handle at -Z, service side faces +Z along the long axis. | 780 | 38.4 |
| `street_lamp` | prop | `public/models/street_lamp.glb` | 22 | 450 | 42 × 44 | +Z | Cast-iron city lamp post with a lantern head; the lantern glass is emissive warm white. | 800 | 28.8 |
| `phone_booth` | prop | `public/models/phone_booth.glb` | 70.7 | 250 | 100 × 100 | +Z | Red phone booth; glazed door with handle faces +Z, lit TELEPHONE signs (emissive) on all four sides. | 924 | 50.2 |
| `fire_truck` | prop | `public/models/fire_truck.glb` | 487.3 | 310 | 271 × 931 | +Z | Red fire engine, front +Z: crew cab, silver equipment lockers, ladder along the roof, red/white light bar (emissive). | 2980 | 127.9 |
| `landfill_compactor` | hazard | `public/models/landfill_compactor.glb` | 355.3 | 375 | 340 × 635 | +Z | Landfill compactor (CAT 836 style), front +Z: yellow articulated body, cab over the hinge, four spiked steel drums, dozer blade with a trash rack at the front. beacon node (amber, half lit) spins about its local Y axis on the cab roof. mini_compactor reuses this file. Animated nodes: `beacon` at (0.0, 348.0, 10.0). | 2856 | 132.9 |
| `freight_train` | hazard | `public/models/freight_train.glb` | 1099.6 | 457 | 308 × 2180 | +Z | Diesel freight locomotive (one unit), long axis along Z, cab at +Z: navy body with a yellow nose and sill stripe, two three-axle bogies on a short section of track (rails 144 cm apart, top of rail at y = 33). Headlights are emissive. | 2620 | 120.2 |
| `snowplow` | hazard | `public/models/snowplow.glb` | 529.5 | 350 | 340.8 × 1007.2 | +Z | Municipal snowplow truck, front +Z: orange cab and dump body heaped with salt, yellow plough blade angled across the front (right end forward), salt spreader disc at the back. Amber light bar and headlights are emissive. | 2448 | 98.2 |
| `crop_duster` | hazard | `public/models/crop_duster.glb` | 562.3 | 299.4 | 1103.3 × 747 | +Z | Single-engine crop-dusting plane (Air Tractor style), nose +Z, on its taildragger gear with the thrust line level at y = 150: yellow low wing with spray booms along the trailing edge. propeller node (three blades with yellow tips) spins about its local Z axis; pivot at the spinner. Animated nodes: `propeller` at (0.0, 150.0, 345.0). | 1658 | 75.5 |
| `river_barge` | hazard | `public/models/river_barge.glb` | 706.1 | 302 | 302 × 1382 | +Z | River barge, bow +Z: long dark hull with four red covered-hopper loads, push-tug at the stern (-Z) with push knees against the barge, a white three-deck house and a tall wheelhouse. Hull bottom on the floor (no water). | 1016 | 53.7 |
| `water_bomber` | hazard | `public/models/water_bomber.glb` | 1380.5 | 700 | 2740 × 1917 | +Z | Amphibious water-bomber (Canadair CL-415 style), nose +Z, standing on its wheels: yellow upper body, red boat hull, high straight wing with two turboprops, red wingtip floats, high tailplane on the fin. | 2070 | 73.0 |
| `incinerator` | hazard | `public/models/incinerator.glb` | 1780.8 | 2600 | 1443.9 × 3450 | +Z | Boss. The Incinerator: rail-mounted waste-to-energy plant, front +Z. Grey plant hall on four rail bogies (rails at x = +/-460 along Z), boiler house and a brick and steel chimney with a soot-black rim (top centre at (0, 2600, -600)), feed conveyor rising into an intake mouth that glows orange (emissive furnace). brush_l / brush_r are the two upright intake roller drums at the front corners; they spin about local Y, pivots at their centres. Animated nodes: `brush_l` at (-560.0, 240.0, 1500.0), `brush_r` at (560.0, 240.0, 1500.0). | 3798 | 169.2 |

Total: 67 models, 91592 triangles, 3905 KB.

![Contact sheet](models-preview.png)
