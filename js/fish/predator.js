(function (global) {
  "use strict";

  registerFish({
    key: "predator",
    name: "PREDATOR",
    stats: {
      spdMul: 1.00,
      visMul: 1.00,
      defMul: 1.00,
      stamMul: 1.00,
      aggrMul: 1.00,
      metab: 1.00,
      turn: 1.00,
    },
    passive: { swarm: true, apex: false, dash: 0 },
    ai: {
      bias: { agg: 0.22, brv: 0.10, soc: 0.22, ter: 0.08 },
      danger: 0.55,
      temperaments: [["HUNTER", 0.62], ["PACK_HUNTER", 0.26], ["GUARDIAN", 0.12]],
      strategies: [["PACK", 0.35], ["INTERCEPT", 0.30], ["CHASE", 0.35]],
      canHunt: true,
      shoalSizeMul: 1.25,
    },
    spawn: { weight: 9, cap: null, sizes: [8, 16, 30, 60] },
    body: { type: "spine", segments: 12, swim: "carangiform" },
    look: {
      fill: "solid",
      pattern: "none",
      glow: 0,
      outline: "thin",
      palette: [["#9a9a9a", "#ffffff"], ["#c0c0c0", "#ffffff"], ["#e0e0e0", "#ffffff"], ["#ffffff", "#ffffff"]],
    },
    parts: {
      eye: "round",
      tail: "forked",
      dorsal: "tiny",
      pectoral: "fan",
      head: "standard",
      extras: [],
    },
    stages: [
      { size: 8, color: "#9a9a9a", profile: "pr1", shape: "forked", dorsal: "tiny" },
      { size: 16, color: "#c0c0c0", profile: "pr2", shape: "fan", dorsal: "spiny" },
      { size: 30, color: "#e0e0e0", profile: "pr3", shape: "forked", dorsal: "rear" },
      { size: 60, color: "#ffffff", profile: "pr4", shape: "crescent", dorsal: "spike" },
    ],
  });
})(typeof window !== "undefined" ? window : globalThis);
