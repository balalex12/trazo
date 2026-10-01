# Libraries, icons and logos

## What ships

`node tools/build-library.js` generates `public/arcgis.excalidrawlib` (git-ignored) with ~150 items in sections:

| Section (as shown in the panel) | Source | License |
|---|---|---|
| Interactive ArcGIS Maps | this project (an embed element) | MIT |
| Utility Network (Esri Calcite icons) | Esri Calcite UI icons | Esri MLA — **fetched at build time, embedded unmodified, not committed** |
| Esri Architecture Center · General / Enterprise Components / Data Stores / IT Components / Containers & Labels / User Types / User Personas | Esri ArcGIS Architecture Center diagramming toolkit, converted from Visio to SVG (`tools/visio_to_svg.py`) | CC BY 4.0 © Esri |
| Services & SDKs (Esri Calcite icons) | Esri Calcite UI icons | Esri MLA — fetched at build time |

Item names are English and prefixed by their section (`<Source · Category> / <Name>`), so search works
("utility", "geodatabase", "persona"). Ids are stable (`arcgis:…`): reloading replaces items, never duplicates them.

The *Containers* are native rectangles (the toolkit's containers are outline-only boxes) with an icon badge.
Calcite glyphs used as badges/Utility Network concepts are **approximations by meaning** (Esri publishes no official
icon for several Utility Network concepts, e.g. Device = `switch`). Change a mapping in `tools/build-library.js`.

## Icon licensing rules (read before redistributing)

- **Esri Architecture Center icons**: CC BY 4.0 — redistribution and adaptation allowed **with attribution** (kept in README, About dialog, `THIRD_PARTY_NOTICES.md`). The conversion only changes the file format.
- **Esri Calcite icons**: the Esri MLA allows use/redistribution **without modification**. They are embedded **byte-for-byte as downloaded** (no recoloring) into the generated library, which is git-ignored: each user generates it locally and the glyphs are never committed. Because they stay unmodified, the Esri MLA's "redistribute without modification" condition is respected; still, get a legal review before publishing a public Docker image that contains them.
- Do not use "Esri"/"ArcGIS" as a product name or logo; describing compatibility is fine.

## Adding your own libraries (community libraries)

1. In the editor, open the library panel → **Browse libraries** (opens libraries.excalidraw.com), or import a file
   (**⋮ → Open**).
2. Imported libraries go to the standard library sections (*Personal* / *Excalidraw library*), below the Trazo sections.
3. To **ship** a community library with the project, open an issue/PR with the `.excalidrawlib` file and its
   license. Libraries on libraries.excalidraw.com are submitted by third parties: **check each library's license
   before redistributing it** (the site's repository lists the author and a source/license for each entry).
   We will keep them under `libraries/community/<name>/` with `LICENSE` + attribution and show them as their own section.

> Status: the community-library loader is not implemented yet — it will be designed once real libraries are
> provided (ROADMAP). Until then, import them with ⋮ → Open.
