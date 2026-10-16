# Third-party notices and credits

This project is an independent derivative of Excalidraw. It is **not affiliated with, endorsed by or sponsored by Excalidraw or Esri**. Product and company names are trademarks of their owners and are used only to describe compatibility.

## Excalidraw (the base of this project)

- Project: https://github.com/excalidraw/excalidraw
- License: MIT: "Copyright (c) 2020 Excalidraw". The upstream license text and copyright notice are kept unchanged in [LICENSE](LICENSE); this project's own additions are under the same MIT license.
- The full upstream git history (all contributors' commits) is preserved in this repository.
- Bundled fonts come from upstream Excalidraw, each under its own license (see the next section).
- Hand-drawn rendering uses [Rough.js](https://roughjs.com/) (MIT) and the other open-source dependencies of Excalidraw (see `yarn.lock`).

## Bundled fonts

Audited on 2026-10-02 from the license data embedded in each font file (`packages/excalidraw/fonts/`), plus the upstream project page where the file carried no license text. The fonts are unmodified copies from upstream Excalidraw.

| Font | License | Copyright and notes |
| --- | --- | --- |
| Assistant | SIL OFL 1.1 | © The Assistant Project Authors; includes Source Sans Pro (© The Source Sans Pro Authors, reserved name "Source") |
| Cascadia Code | SIL OFL 1.1 | © 2020 Microsoft Corporation. The embedded text is generic and its license URL points to the OFL; the upstream project ([microsoft/cascadia-code](https://github.com/microsoft/cascadia-code)) is OFL 1.1 |
| Comic Shanns | MIT | © 2018 Shannon Miwa and later contributors; the MIT notice is embedded in the font |
| Excalifont | SIL OFL 1.1 | © 2024 Excalidraw. The file has no license text; the [official Excalifont page](https://plus.excalidraw.com/excalifont) states OFL 1.1 |
| Arimo (used as "Liberation Sans") | SIL OFL 1.1 | © 2020 The Arimo Project Authors. Unmodified subsets (latin, latin-ext, cyrillic, cyrillic-ext, greek, greek-ext, vietnamese) from [@fontsource/arimo](https://fontsource.org/fonts/arimo) 5.3.0; the license text is `packages/excalidraw/fonts/Liberation/OFL-Arimo.txt`. Metric-compatible with Liberation Sans 2 and Arial. It replaces Liberation Sans 1.05 (GPL v2 with the font exception), which was the only font here that was not OFL or MIT. It is the private fallback family for Helvetica in exports |
| Lilita One | SIL OFL 1.1 | © 2011 Juan Montoreano, reserved name "Lilita One" |
| Nunito | SIL OFL 1.1 | © The Nunito Project Authors |
| Virgil | SIL OFL 1.1 | © 2011 Your Own Font Foundry; full license embedded |
| Xiaolai SC | SIL OFL 1.1 | © 2020 LXGW; derived from SetoFont ([lxgw/kose-font](https://github.com/lxgw/kose-font)). The file has no license text. Reserved names: Xiaolai, Kose |

Helvetica and Emoji have no font files here (system fonts). The full text of the SIL OFL 1.1 is at https://openfontlicense.org/open-font-license-official-text/.

## Icons and logos

| Asset | Where | Source | License | Redistributed here? |
| --- | --- | --- | --- | --- |
| ArcGIS Architecture Center icons (Enterprise Components, Data Stores, General, IT Components, Containers & Labels, User Personas, User Types) | `assets/esri-icons/*.svg`, library sections "Esri Architecture Center · …" | Esri, _ArcGIS Architecture Center → Diagramming resources_ (`ArcGIS_Visio_Toolkit.zip`, updated 2024-12-19): https://architecture.arcgis.com/en/framework/architecture-practices/diagramming-resources.html | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) © Esri | **Yes**, with attribution; adapted only by converting Visio geometry to SVG (`tools/visio_to_svg.py`) |
| Calcite UI icons (Utility Network and service/SDK glyphs, container badges) | generated library only | `@esri/calcite-ui-icons` 4.6.0-next.21 via jsDelivr | Esri Master License Agreement (use/redistribute **without modification**) | **No.** Downloaded by `tools/fetch-calcite.mjs` into git-ignored `assets/calcite/` and embedded unmodified (byte-for-byte) in the locally generated library; neither is committed. **The releases and published images are built with `--profile=public`, which leaves them out** |
| Own icon packs ("Trazo · GIS & Spatial Data", "Trazo · Data Engineering", "Trazo · Machine Learning", 63 glyphs) | `tools/own-icons/icons.cjs`, library sections "Trazo · …" | original neutral drawings made from geometric primitives by this project; no vendor logos or artwork. Names may mention tools (FME, GeoPandas, GDAL…) only to say what a glyph stands for | MIT | yes |
| Project mark / app icons | `public/favicon*`, `public/*chrome*`, welcome screen | original artwork by this project (`tools/make-icons.cjs`) | MIT | yes |

Attribution for the CC BY 4.0 icons: _"ArcGIS architecture icons © Esri, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Converted from the official Visio toolkit to SVG."_

## Runtime and vendored software

| Component | Use | License | Notes |
| --- | --- | --- | --- |
| ArcGIS Maps SDK for JavaScript 4.31 | interactive maps in `viewer/` | © Esri, Esri license terms | **Loaded at runtime from `js.arcgis.com`**; not redistributed. Users must comply with Esri's terms and keep map attributions |
| mp4-muxer 5.1.3 | MP4 export | MIT (© Vanilagy) | vendored `public/vendor/mp4-muxer.js`, sha256 `e239cb3fa122c48bc9cefda504c301a52edafbc27c1506f19f8c33480084bdf7` |
| gifenc 1.0.3 | GIF export | MIT (© Matt DesLauriers) | vendored `public/vendor/gifenc.js`, sha256 `217761244379253ba5815510d3048a4fb1f4c4dbe9fb51a5cfbfe26f34eec093` |
| Pyodide 314.0.6 | Python in the browser (notebooks, optional) | MPL-2.0 (© the Pyodide contributors); its packages keep their own licenses (NumPy, pandas, SciPy, scikit-learn, matplotlib… BSD/PSF-style) | **Downloaded at build time** by `tools/build-jupyterlite.mjs` into git-ignored `assets/jupyterlite/`; not committed. Pinned SHA-256 in that file |
| JupyterLite 0.8.6, JupyterLab, Jupyter Notebook | notebook interface (optional) | BSD-3-Clause (© the Jupyter contributors) | built at build time from pinned pip packages; not committed |
| nginx | serving static files in Docker | BSD-2-Clause | official image, not modified |

## Community libraries (downloaded at build time, not redistributed)

These libraries come from the community catalog at https://libraries.excalidraw.com (repository [excalidraw/excalidraw-libraries](https://github.com/excalidraw/excalidraw-libraries), MIT). Excalidraw's publishing flow states that submitted libraries are published under the **MIT License**, and each belongs to its author. They are **not committed here**: `libraries/community.json` lists them and `tools/fetch-community-libraries.mjs` downloads them from the official repository when you run `node tools/build-library.js`. Each one appears in the panel as its own section "Community · <name> (<author>)".

| Library | Author(s) | Source file in the catalog | Items | Contains third-party brand logos |
| --- | --- | --- | --- | --- |
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

"Contains third-party brand logos": the MIT license a library author grants does **not** cover the trademarks of the companies whose logos/icons are drawn (e.g. Microsoft, GitHub, database and ML vendors). Those libraries are skipped by `node tools/build-library.js --profile=public` (use it for anything you publish) and are used locally under each vendor's own brand guidelines. See [docs/LIBRARIES.md](docs/LIBRARIES.md).

## Inspiration (no code copied)

- _Excalidraw Smart Presentation_ (MIT): frames-as-slides with automatic interpolation.
- _HyperFrames_ by HeyGen (Apache-2.0): HTML-to-video; considered for a future audio/narration export.
