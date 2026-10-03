(function (global) {
  "use strict";

  registerFish({
    key: "jelly",
    name: "JELLY",
    stats: {
      spdMul: 0.65,
      visMul: 1.00,
      defMul: 1.30,
      stamMul: 1.30,
      aggrMul: 0.55,
      metab: 0.70,
      turn: 0.90,
    },
    passive: { sting: 0.50 },
    ai: {
      bias: { agg: -0.22, brv: -0.08, soc: 0.10, ter: -0.10 },
      danger: 0.14,
      temperaments: [["LONER", 0.7], ["GUARDIAN", 0.3]],
      strategies: [["CHASE", 1]],
      canHunt: false,
      shoalSizeMul: 0.6,
    },
    spawn: { weight: 8, cap: null, sizes: [6, 14, 26, 50] },
    body: {
      type: "bell",
      segments: 10,
      swim: "pulse",
      tentacles: { count: 8, len: 2.6 },
    },
    look: {
      fill: "translucent",
      pattern: "rings",
      glow: 1.6,
      outline: "thin",
      palette: [["#b080c0", "#f4d3ff"], ["#c49ad0", "#f7e7ff"], ["#d8b4e0", "#f9eeff"], ["#f0d8f8", "#fff9ff"]],
    },
    parts: {
      eye: "none",
      tail: "none",
      dorsal: "none",
      pectoral: "none",
      head: "bell",
      extras: ["tentacles"],
    },
    stages: [
      { size: 6, color: "#b080c0", profile: "je1", shape: "fan", dorsal: "tiny" },
      { size: 14, color: "#c49ad0", profile: "je2", shape: "fan", dorsal: "tiny" },
      { size: 26, color: "#d8b4e0", profile: "je3", shape: "fan", dorsal: "rear" },
      { size: 50, color: "#f0d8f8", profile: "je4", shape: "spike", dorsal: "rear" },
    ],
  });
})(typeof window !== "undefined" ? window : globalThis);
