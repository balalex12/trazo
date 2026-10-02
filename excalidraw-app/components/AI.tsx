import { TTDDialog } from "@excalidraw/excalidraw";

import { streamChat } from "../ai/llm";
import { TTDIndexedDBAdapter } from "../data/TTDStorage";

// "Text to diagram" backed by the user's own LLM (opt-in, see ai/llm.ts). Excalidraw's hosted AI
// backend and the diagram-to-code feature were removed: this build never calls hosted services.
export const AIComponents = () => (
  <TTDDialog
    onTextSubmit={streamChat}
    persistenceAdapter={TTDIndexedDBAdapter}
  />
);
