# Third-party notices and credits

This project is an independent derivative of Excalidraw. It is **not affiliated with, endorsed by or sponsored by
Excalidraw or Esri**. Product and company names are trademarks of their owners and are used only to describe
compatibility.

## Excalidraw (the base of this project)

- Project: https://github.com/excalidraw/excalidraw
- License: MIT — "Copyright (c) 2020 Excalidraw". The upstream license text and copyright notice are kept unchanged in [LICENSE](LICENSE); this project's own additions are under the same MIT license.
- The full upstream git history (all contributors' commits) is preserved in this repository.
- Bundled fonts (Excalifont, Virgil, Cascadia Code, Nunito, Lilita One, Liberation Sans, Xiaolai, Comic Shanns, Assistant) come from upstream Excalidraw under their own licenses (primarily the SIL Open Font License). A per-font license audit is an open task in [docs/ROADMAP.md](docs/ROADMAP.md).
- Hand-drawn rendering uses [Rough.js](https://roughjs.com/) (MIT) and the other open-source dependencies of Excalidraw (see `yarn.lock`).

## Icons and logos

| Asset | Where | Source | License | Redistributed here? |
|---|---|---|---|---|
| ArcGIS Architecture Center icons (Enterprise Components, Data Stores, General, IT Components, Containers & Labels, User Personas, User Types) | `assets/esri-icons/*.svg`, library sections "Esri Architecture Center · …" | Esri, *ArcGIS Architecture Center → Diagramming resources* (`ArcGIS_Visio_Toolkit.zip`, updated 2024-12-19) — https://architecture.arcgis.com/en/framework/architecture-practices/diagramming-resources.html | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) © Esri | **Yes**, with attribution; adapted only by converting Visio geometry to SVG (`tools/visio_to_svg.py`) |
| Calcite UI icons (Utility Network and service/SDK glyphs, container badges) | generated library only | `@esri/calcite-ui-icons` 4.6.0-next.21 via jsDelivr | Esri Master License Agreement (use/redistribute **without modification**) | **No.** Downloaded by `tools/fetch-calcite.mjs` into git-ignored `assets/calcite/` and embedded unmodified (byte-for-byte) in the locally generated library; neither is committed |
| Project mark / app icons | `public/favicon*`, `public/*chrome*`, welcome screen | original artwork by this project (`tools/make-icons.cjs`) | MIT | yes |

Attribution for the CC BY 4.0 icons: *"ArcGIS architecture icons © Esri, licensed under CC BY 4.0
(https://creativecommons.org/licenses/by/4.0/). Converted from the official Visio toolkit to SVG."*

## Runtime and vendored software

| Component | Use | License | Notes |
|---|---|---|---|
| ArcGIS Maps SDK for JavaScript 4.31 | interactive maps in `viewer/` | © Esri, Esri license terms | **Loaded at runtime from `js.arcgis.com`**; not redistributed. Users must comply with Esri's terms and keep map attributions |
| mp4-muxer 5.1.3 | MP4 export | MIT (© Vanilagy) | vendored `public/vendor/mp4-muxer.js`, sha256 `e239cb3fa122c48bc9cefda504c301a52edafbc27c1506f19f8c33480084bdf7` |
| gifenc 1.0.3 | GIF export | MIT (© Matt DesLauriers) | vendored `public/vendor/gifenc.js`, sha256 `217761244379253ba5815510d3048a4fb1f4c4dbe9fb51a5cfbfe26f34eec093` |
| nginx | serving static files in Docker | BSD-2-Clause | official image, not modified |

## Community libraries (downloaded at build time, not redistributed)

These libraries come from the community catalog at https://libraries.excalidraw.com (repository
[excalidraw/excalidraw-libraries](https://github.com/excalidraw/excalidraw-libraries), MIT). Excalidraw's publishing flow
states that submitted libraries are published under the **MIT License**, and each belongs to its author. They are **not
committed here**: `libraries/community.json` lists them and `tools/fetch-community-libraries.mjs` downloads them from the
official repository when you run `node tools/build-library.js`. Each one appears in the panel as its own section
"Community · <name> (<author>)".

| Library | Author(s) | Source file in the catalog | Items | Contains third-party brand logos |
|---|---|---|---|---|
| Architecture diagram components | [Anna Pastushko](https://www.linkedin.com/in/annpastushko) | `anna-pastushko/architecture-diagram-components.excalidrawlib` | 11 | no |
| Charts | [NicolasGoudry@G.Script](https://github.com/g-script) | `g-script/charts.excalidrawlib` | 4 | no |
| Computers | [EI d'AU](https://github.com/ei-au) | `ei-au/computers.excalidrawlib` | 4 | no |
| Data Platform | [Chu Quang Bach](https://github.com/chuqbach) | `chuqbach/data-platform.excalidrawlib` | 33 | **yes** |
| Data processing | Erlina | `erlina/data-processing.excalidrawlib` | 8 | no |
| Data Science logos | [Fares Hasan](https://github.com/farisology), [Sarhan Samat](https://github.com/SarhanAS) | `farisology/data-science.excalidrawlib` | 7 | **yes** |
| Deep learning | [Yuelfei.wu](https://github.com/yuelfei) | `yuelfei/deep-learning.excalidrawlib` | 12 | no |
| GitHub Git Icons | [marwinburesch](https://github.com/marwinburesch) | `marwinburesch/github-icons.excalidrawlib` | 7 | **yes** |
| Math Teacher Library | [Yatrik Patel](https://www.yatrik.dev/) | `https-github-com-ytrkptl/math-teacher-library.excalidrawlib` | 12 | no |
| Microsoft Fabric Architecture Icons | [Miles Cole](https://milescole.dev/) | `mwc360/microsoft-fabric-architecture-icons.excalidrawlib` | 135 | **yes** |
| Network topology icons | [dwelle](https://twitter.com/dluzar) | `dwelle/network-topology-icons.excalidrawlib` | 10 | no |
| Robots | [Kaligule](https://schauderbasis.de) | `kaligule/robots.excalidrawlib` | 7 | no |
| Shapes for UML & ER Diagrams | [BjoernKW](https://github.com/BjoernKW) | `BjoernKW/UML-ER-library.excalidrawlib` | 21 | no |
| Software Architecture | [Youri Tjang](https://github.com/youritjang) | `youritjang/software-architecture.excalidrawlib` | 7 | no |
| Stick Figures | [Youri Tjang](https://github.com/youritjang) | `youritjang/stick-figures.excalidrawlib` | 9 | no |
| System Design Components | [Rohan Pithadiya](https://github.com/Rohanpithadiya) | `rohanp/system-design.excalidrawlib` | 24 | no |

"Contains third-party brand logos": the MIT license a library author grants does **not** cover the trademarks of the
companies whose logos/icons are drawn (e.g. Microsoft, GitHub, database and ML vendors). Those libraries are skipped by
`node tools/build-library.js --profile=public` (use it for anything you publish) and are used locally under each
vendor's own brand guidelines. See [docs/LIBRARIES.md](docs/LIBRARIES.md).

## Inspiration (no code copied)

- *Excalidraw Smart Presentation* (MIT) — frames-as-slides with automatic interpolation.
- *HyperFrames* by HeyGen (Apache-2.0) — HTML-to-video; considered for a future audio/narration export.
