# Libraries, icons and logos

## What ships

`node tools/build-library.js` generates `public/arcgis.excalidrawlib` (git-ignored) with ~150 items in sections:

| Section (as shown in the panel) | Source | License |
| --- | --- | --- |
| Interactive ArcGIS Maps | this project (an embed element) | MIT |
| Utility Network (Esri Calcite icons) | Esri Calcite UI icons | Esri MLA, **fetched at build time, embedded unmodified, not committed** |
| Esri Architecture Center · General / Enterprise Components / Data Stores / IT Components / Containers & Labels / User Types / User Personas | Esri ArcGIS Architecture Center diagramming toolkit, converted from Visio to SVG (`tools/visio_to_svg.py`) | CC BY 4.0 © Esri |
| Services & SDKs (Esri Calcite icons) | Esri Calcite UI icons | Esri MLA, fetched at build time |

Item names are English and prefixed by their section (`<Source · Category> / <Name>`), so search works ("utility", "geodatabase", "persona"). Ids are stable (`arcgis:…`): reloading replaces items, never duplicates them.

The _Containers_ are native rectangles (the toolkit's containers are outline-only boxes) with an icon badge. Calcite glyphs used as badges/Utility Network concepts are **approximations by meaning** (Esri publishes no official icon for several Utility Network concepts, e.g. Device = `switch`). Change a mapping in `tools/build-library.js`.

## Icon licensing rules (read before redistributing)

- **Esri Architecture Center icons**: CC BY 4.0: redistribution and adaptation allowed **with attribution** (kept in README, About dialog, `THIRD_PARTY_NOTICES.md`). The conversion only changes the file format.
- **Esri Calcite icons**: the Esri MLA allows use/redistribution **without modification**. They are embedded **byte-for-byte as downloaded** (no recoloring) into the generated library, which is git-ignored: each user generates it locally and the glyphs are never committed. Because they stay unmodified, the Esri MLA's "redistribute without modification" condition is respected; still, get a legal review before publishing a public Docker image that contains them.
- Do not use "Esri"/"ArcGIS" as a product name or logo; describing compatibility is fine.

## Community libraries (built in)

`libraries/community.json` lists 16 libraries from the public catalog (authors, source file, item counts; see [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for the table). `node tools/build-library.js`:

1. downloads them from `excalidraw/excalidraw-libraries` into `assets/community/` (git-ignored, never committed);
2. adds each as its own panel section **"Community · <name> (<author>)"** with stable ids `lib:<slug>:<id>`;
3. records the original item ids and a content fingerprint of every item, so on load the app **replaces copies you had imported by hand** (same items, different ids) instead of duplicating them. Items that are not in the pack (your own drawings) are never touched.

**Profiles.** The default profile (`local`) includes everything. `--profile=public` (or `LIBRARY_PROFILE=public`) skips libraries flagged `brandLogos` in the manifest because their logos are third-party trademarks the MIT license of the library does not cover. Use the public profile for any published image/artifact.

### Adding or removing a library

Edit `libraries/community.json` (keep `name`, `authors`, `source` exactly as in the catalog, set `brandLogos` honestly, `items` = number of items) and run `node tools/build-library.js`. To list what is in your own browser's library and find which catalog libraries it came from, export it (library menu → ⋮ → Export library) and compare ids with the catalog (the method used to build the manifest: items keep the ids of the catalog files; older imports are matched by content).

### Importing something else

Library panel → **Browse libraries** (opens libraries.excalidraw.com, a normal link) or ⋮ → Open to import a file. Anything imported goes to the standard _Personal_/_Excalidraw library_ sections below the Trazo sections. Check each library's license before redistributing it.
