// Compose -> laid out diagram. The layout itself is generic and lives in graph.ts; this keeps the old entry point.
import { composeToGraph } from "./compose";
import { layoutGraph } from "./graph";

import type { ComposeModel } from "./compose";
import type { Layout } from "./graph";

export { ROLE_STYLE, edgeEnds, layoutGraph, layoutToSkeleton } from "./graph";
export type {
  Graph,
  Layout,
  LayoutEdge,
  LayoutNode,
  Role,
  Skeleton,
} from "./graph";

export const layoutCompose = (model: ComposeModel): Layout =>
  layoutGraph(composeToGraph(model));
