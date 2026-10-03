"use strict";

/* ==========================================================================
   server/runtime.js
   Loads the browser-oriented game simulation files into a single Node `vm`
   context so the server can reuse the *same* Fish / Eco rules as the browser.

   Contract with the game files:
     - js/game-world-config.js   → publishes CFG, LINEAGES, LINEAGE_KEYS,
                                    clamp, rand, rInt, lerp, wrapA, TAU,
                                    PLAYER_COLOR, PLAYER_DARK on globalThis
     - js/fish-behavior.js       → publishes Fish on globalThis
     - js/ecosystem-simulation.js→ publishes Eco, SPAWN_WEIGHTS, POP_CAPS
                                    on globalThis
   ========================================================================== */

const fs   = require("node:fs");
const path = require("node:path");
const vm   = require("node:vm");

/* Load order matters:
     config first  (defines CFG / LINEAGES / utilities)
     fish registry next (builds a design map for every fish)
     Fish second  (uses CFG / LINEAGES / utilities at class definition time? no,
                   but uses them in its constructor, so order is safe either way —
                   keep config first anyway to be explicit)
     Eco third    (uses CFG / LINEAGES / LINEAGE_KEYS / Fish) */
const GAME_FILES = [
  "js/game-world-config.js",
  "js/fish/registry.js",
  "js/fish-behavior.js",
  "js/ecosystem-simulation.js"
];

/* Every symbol runtime.js promises to hand back to index.js. */
const REQUIRED_EXPORTS = [
  "CFG",
  "LINEAGES",
  "LINEAGE_KEYS",
  "Fish",
  "Eco",
  "clamp",
  "rand",
  "rInt"
];

/* Browser-only globals we deliberately do NOT provide.
   The game logic files must not reference these — the render/input layers do. */
const FORBIDDEN_GLOBALS = [
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "navigator",
  "Image",
  "Audio"
];

function loadGameRuntime(projectRoot) {
  const FISH_DIR = path.join(projectRoot, "js", "fish");
  const FISH_FILES = fs.existsSync(FISH_DIR)
    ? fs.readdirSync(FISH_DIR)
        .filter((file) => file.endsWith(".js") && file !== "registry.js")
        .sort()
        .map((file) => path.posix.join("js", "fish", file))
    : [];

  const gameFiles = [
    "js/game-world-config.js",
    "js/fish/registry.js",
    ...FISH_FILES,
    "js/fish-behavior.js",
    "js/ecosystem-simulation.js"
  ];

  /* Build a sandbox. Anything not listed here is either a V8 built-in
     (Object, Array, Map, JSON, Date, Math, Promise, Error, …) or unavailable.
     We intentionally do NOT expose require / process / Buffer to game code. */
  const sandbox = {
    console,
    Math,
    Date,
    JSON,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };

  /* Guard rail: if any game file tries to touch a browser-only global,
     fail loudly here rather than crashing later at simulation time. */
  for (const name of FORBIDDEN_GLOBALS) {
    Object.defineProperty(sandbox, name, {
      configurable: false,
      enumerable: false,
      get() {
        throw new Error(
          `Game code tried to access browser-only global '${name}' inside the Node VM. ` +
          `Keep rendering / input code out of js/game-world-config.js, ` +
          `js/fish-behavior.js and js/ecosystem-simulation.js.`
        );
      }
    });
  }

  const context = vm.createContext(sandbox, {
    name: "predation-game-runtime"
  });

  /* Evaluate each file in order. Wrap read + eval so failures name the file. */
  for (const file of gameFiles) {
    const abs = path.join(projectRoot, file);

    let source;
    try {
      source = fs.readFileSync(abs, "utf8");
    } catch (err) {
      throw new Error(
        `Failed to read game runtime file '${file}' at ${abs}: ${err.message}`
      );
    }

    try {
      vm.runInContext(source, context, {
        filename: file,
        displayErrors: true
      });
    } catch (err) {
      throw new Error(
        `Failed to evaluate game runtime file '${file}': ${err.message}\n` +
        (err.stack || "")
      );
    }
  }

  /* Explicit global API boundary — no scope-chain accidents. */
  let runtime;
  try {
    runtime = vm.runInContext(
      `({
         CFG:          globalThis.CFG,
         LINEAGES:     globalThis.LINEAGES,
         LINEAGE_KEYS: globalThis.LINEAGE_KEYS,
         Fish:         globalThis.Fish,
         Eco:          globalThis.Eco,
         clamp:        globalThis.clamp,
         rand:         globalThis.rand,
         rInt:         globalThis.rInt
       })`,
      context,
      { filename: "runtime-export" }
    );
  } catch (err) {
    throw new Error(
      `Failed to extract game runtime exports from VM context: ${err.message}\n` +
      (err.stack || "")
    );
  }

  /* Validate every promised export. */
  const missing = [];
  for (const name of REQUIRED_EXPORTS) {
    const value = runtime[name];
    if (value === undefined || value === null) {
      missing.push(name);
    }
  }
  if (missing.length) {
    throw new Error(
      `Game runtime export missing: ${missing.join(", ")}. ` +
      `Each name must be published on globalThis by one of: ` +
      GAME_FILES.join(", ")
    );
  }

  /* Shape sanity — cheap, catches "exists but has no fields" bugs early. */
  if (typeof runtime.CFG.W !== "number" || typeof runtime.CFG.H !== "number") {
    throw new Error(
      "Game runtime CFG is present but malformed: CFG.W / CFG.H must be numbers."
    );
  }
  if (!Array.isArray(runtime.LINEAGE_KEYS) || runtime.LINEAGE_KEYS.length === 0) {
    throw new Error(
      "Game runtime LINEAGE_KEYS is present but empty — check LINEAGES in js/game-world-config.js."
    );
  }
  if (typeof runtime.Fish !== "function") {
    throw new Error("Game runtime Fish is not a constructor.");
  }
  if (typeof runtime.Eco !== "function") {
    throw new Error("Game runtime Eco is not a constructor.");
  }

  return runtime;
}

module.exports = { loadGameRuntime };