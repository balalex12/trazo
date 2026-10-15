// Entry of the standalone importer preview: the real import code (parsers, layout, elbow routing), nothing else.
import { importInfra, detectFormat, FORMAT_NAMES } from "../../excalidraw-app/infra/detect";
import { layoutToSkeleton } from "../../excalidraw-app/infra/graph";
import { EXAMPLES } from "./examples.generated";

export const run = (text: string, details: boolean) => {
  const format = detectFormat(text);
  const { layout, summary } = importInfra(text, { details }) as any;
  return {
    format: format ? FORMAT_NAMES[format] : "",
    summary: summary || "",
    notes: layout.notes || [],
    skeleton: layoutToSkeleton(layout),
    bounds: layout.bounds,
  };
};
export { EXAMPLES, FORMAT_NAMES };
