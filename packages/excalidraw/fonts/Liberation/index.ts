import { GOOGLE_FONTS_RANGES } from "@excalidraw/common";

import { type ExcalidrawFontFaceDescriptor } from "../Fonts";

// The font behind the "Liberation Sans" family (a private fallback for Helvetica in exports) is Arimo, SIL OFL 1.1:
// metric-compatible with Liberation Sans 2 and Arial, same line metrics (see font-metadata.ts). It replaces
// Liberation Sans 1.05, which was GPLv2 with a font exception. The files are Fontsource's unmodified @fontsource/arimo
// 5.3.0 subsets; the license text is OFL-Arimo.txt next to them.
import Cyrillic from "./Arimo-Regular-cyrillic.woff2";
import CyrillicExt from "./Arimo-Regular-cyrillic-ext.woff2";
import Greek from "./Arimo-Regular-greek.woff2";
import GreekExt from "./Arimo-Regular-greek-ext.woff2";
import Latin from "./Arimo-Regular-latin.woff2";
import LatinExt from "./Arimo-Regular-latin-ext.woff2";
import Vietnamese from "./Arimo-Regular-vietnamese.woff2";

/** the Google Fonts ranges that GOOGLE_FONTS_RANGES (shared with the other fonts) does not have */
const GREEK =
  "U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF";
const GREEK_EXT = "U+1F00-1FFF";

export const LiberationFontFaces: ExcalidrawFontFaceDescriptor[] = [
  {
    uri: CyrillicExt,
    descriptors: { unicodeRange: GOOGLE_FONTS_RANGES.CYRILIC_EXT },
  },
  { uri: Cyrillic, descriptors: { unicodeRange: GOOGLE_FONTS_RANGES.CYRILIC } },
  { uri: GreekExt, descriptors: { unicodeRange: GREEK_EXT } },
  { uri: Greek, descriptors: { unicodeRange: GREEK } },
  {
    uri: Vietnamese,
    descriptors: { unicodeRange: GOOGLE_FONTS_RANGES.VIETNAMESE },
  },
  {
    uri: LatinExt,
    descriptors: { unicodeRange: GOOGLE_FONTS_RANGES.LATIN_EXT },
  },
  { uri: Latin, descriptors: { unicodeRange: GOOGLE_FONTS_RANGES.LATIN } },
];
