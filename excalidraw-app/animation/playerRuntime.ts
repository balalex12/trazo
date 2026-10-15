// The bundled player script that goes inside every exported .html animation (built by animation/player/vitePlugin.ts).
// Kept in its own module so only the export button pulls it in, and tests never touch the bundler.
import runtime from "./player/runtime.ts?bundle";

export default runtime;
