// Runs Trazo from this folder, on your own computer, with the same three local servers as the desktop app and Docker:
//   the app http://127.0.0.1:3000, the ArcGIS map viewer http://127.0.0.1:3001, the Python notebooks http://127.0.0.1:3002
// All of them listen on 127.0.0.1 only. Needs Node.js 18 or newer.
//
//   node serve.cjs        (or double click start-trazo.bat on Windows, run ./start-trazo.sh on Linux and macOS)
//
// Next to this file: site-server.cjs, stack.cjs and the folders site/, viewer/ and jupyterlite/.
"use strict";
const { startStack } = require("./stack.cjs");

startStack(__dirname).then(
  ({ started }) => {
    console.log("Trazo is running (Ctrl+C to stop):");
    console.log("  the app         http://127.0.0.1:3000   <- open this one");
    for (const [name, url] of [
      ["viewer", "http://127.0.0.1:3001"],
      ["notebooks", "http://127.0.0.1:3002"],
    ]) {
      console.log(
        `  ${name.padEnd(15)} ${url}${
          started.includes(name)
            ? ""
            : "   (not available: its folder is missing or its port is taken)"
        }`,
      );
    }
  },
  (e) => {
    console.error(
      e && e.code === "EADDRINUSE"
        ? "Port 3000 is in use. Close what uses it (maybe Trazo in Docker or the desktop app) and try again."
        : String((e && e.message) || e),
    );
    process.exit(1);
  },
);
