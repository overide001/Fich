(function (global) {
  "use strict";

  registerFish({
    key: "koi",
    name: "KOI",
    stats: { spdMul: 0.90, visMul: 1.10, defMul: 1.05, stamMul: 1.20, aggrMul: 0.75, metab: 1.00, turn: 1.15 },
    passive: { social: 0.25 },
    ai: { bias: { agg: -0.12, brv: -0.10, soc: 0.35, ter: -0.15 }, danger: 0.30, temperaments: [["SCOUT", 0.7], ["GUARDIAN", 0.3]], strategies: [["INTERCEPT", 0.4], ["CHASE", 0.6]], canHunt: false, shoalSizeMul: 1.15 },
    spawn: { weight: 14, cap: 18, sizes: [6, 12, 24, 46] },
    body: { type: "wing", segments: 11, swim: "carangiform" },
    look: { fill: "solid", pattern: "bands", glow: 0.2, outline: "thin", palette: [["#ff8d5c", "#fff0e9"], ["#ffb74d", "#fff4d4"], ["#ff7043", "#ffe0d3"], ["#ffd166", "#fff6d9"]] },
    parts: { eye: "round", tail: "fan", dorsal: "tiny", pectoral: "fan", head: "standard", extras: [] },
    stages: [
      { size: 6, color: "#ff8d5c", profile: "ko1", shape: "fan", dorsal: "tiny" },
      { size: 12, color: "#ffb74d", profile: "ko2", shape: "fan", dorsal: "tiny" },
      { size: 24, color: "#ff7043", profile: "ko3", shape: "forked", dorsal: "rear" },
      { size: 46, color: "#ffd166", profile: "ko4", shape: "crescent", dorsal: "spike" },
    ],
  });

  registerFish({
    key: "swift",
    name: "SWIFT",
    stats: { spdMul: 1.25, visMul: 1.08, defMul: 0.92, stamMul: 1.00, aggrMul: 0.85, metab: 1.10, turn: 1.30 },
    passive: { quick: 0.35 },
    ai: { bias: { agg: -0.08, brv: -0.16, soc: 0.30, ter: -0.18 }, danger: 0.42, temperaments: [["RUNNER", 0.6], ["SCOUT", 0.4]], strategies: [["INTERCEPT", 0.5], ["CHASE", 0.5]], canHunt: true, shoalSizeMul: 1.18 },
    spawn: { weight: 12, cap: 16, sizes: [7, 14, 26, 52] },
    body: { type: "ribbon", segments: 12, swim: "carangiform" },
    look: { fill: "solid", pattern: "stripes", glow: 0.1, outline: "thin", palette: [["#75d6ff", "#e8fbff"], ["#6ecbf4", "#e2f9ff"], ["#94f0ff", "#ebffff"], ["#d9ffff", "#f5ffff"]] },
    parts: { eye: "round", tail: "crescent", dorsal: "tiny", pectoral: "fan", head: "standard", extras: [] },
    stages: [
      { size: 7, color: "#75d6ff", profile: "sw1", shape: "crescent", dorsal: "tiny" },
      { size: 14, color: "#6ecbf4", profile: "sw2", shape: "fan", dorsal: "tiny" },
      { size: 26, color: "#94f0ff", profile: "sw3", shape: "forked", dorsal: "rear" },
      { size: 52, color: "#d9ffff", profile: "sw4", shape: "crescent", dorsal: "spike" },
    ],
  });

  registerFish({
    key: "armor",
    name: "ARMOR",
    stats: { spdMul: 0.82, visMul: 0.90, defMul: 1.55, stamMul: 1.35, aggrMul: 0.88, metab: 0.95, turn: 0.85 },
    passive: { shield: 0.35 },
    ai: { bias: { agg: 0.00, brv: 0.25, soc: -0.05, ter: 0.28 }, danger: 0.52, temperaments: [["GUARDIAN", 0.7], ["TERRITORIAL", 0.3]], strategies: [["STALK", 0.45], ["CHASE", 0.55]], canHunt: true, shoalSizeMul: 0.92 },
    spawn: { weight: 9, cap: 12, sizes: [8, 16, 30, 60] },
    body: { type: "inflate", segments: 12, swim: "carangiform" },
    look: { fill: "solid", pattern: "spots", glow: 0.15, outline: "thick", palette: [["#87a66e", "#ecf4d8"], ["#a3be82", "#edf4d6"], ["#c5d8a5", "#f6f9e8"], ["#e0eac0", "#fdfef0"]] },
    parts: { eye: "round", tail: "spike", dorsal: "rear", pectoral: "fan", head: "standard", extras: [] },
    stages: [
      { size: 8, color: "#87a66e", profile: "ar1", shape: "rear", dorsal: "tiny" },
      { size: 16, color: "#a3be82", profile: "ar2", shape: "rear", dorsal: "spiny" },
      { size: 30, color: "#c5d8a5", profile: "ar3", shape: "spike", dorsal: "rear" },
      { size: 60, color: "#e0eac0", profile: "ar4", shape: "spike", dorsal: "spike" },
    ],
  });

  registerFish({
    key: "manta",
    name: "MANTA",
    stats: { spdMul: 0.95, visMul: 1.22, defMul: 0.95, stamMul: 1.10, aggrMul: 0.72, metab: 0.95, turn: 1.05 },
    passive: { glide: 0.40 },
    ai: { bias: { agg: -0.10, brv: -0.08, soc: 0.28, ter: -0.14 }, danger: 0.30, temperaments: [["SCOUT", 0.7], ["RUNNER", 0.3]], strategies: [["INTERCEPT", 0.55], ["PACK", 0.45]], canHunt: false, shoalSizeMul: 1.30 },
    spawn: { weight: 8, cap: 9, sizes: [10, 18, 34, 70] },
    body: { type: "wing", segments: 10, swim: "pulse" },
    look: { fill: "solid", pattern: "rings", glow: 0.25, outline: "thin", palette: [["#9bb7ff", "#edf3ff"], ["#7fa4f8", "#e5efff"], ["#c7d9ff", "#f3f8ff"], ["#edf5ff", "#ffffff"]] },
    parts: { eye: "none", tail: "fan", dorsal: "tiny", pectoral: "fan", head: "standard", extras: [] },
    stages: [
      { size: 10, color: "#9bb7ff", profile: "ma1", shape: "fan", dorsal: "tiny" },
      { size: 18, color: "#7fa4f8", profile: "ma2", shape: "fan", dorsal: "tiny" },
      { size: 34, color: "#c7d9ff", profile: "ma3", shape: "fan", dorsal: "rear" },
      { size: 70, color: "#edf5ff", profile: "ma4", shape: "crescent", dorsal: "rear" },
    ],
  });

  registerFish({
    key: "serpent",
    name: "SERPENT",
    stats: { spdMul: 1.05, visMul: 1.15, defMul: 0.90, stamMul: 1.12, aggrMul: 1.00, metab: 1.05, turn: 1.40 },
    passive: { ambush: 0.35 },
    ai: { bias: { agg: 0.14, brv: 0.04, soc: -0.18, ter: 0.32 }, danger: 0.65, temperaments: [["AMBUSHER", 0.7], ["TERRITORIAL", 0.3]], strategies: [["AMBUSH", 0.55], ["STALK", 0.45]], canHunt: true, shoalSizeMul: 0.75 },
    spawn: { weight: 7, cap: 10, sizes: [6, 18, 32, 54] },
    body: { type: "ribbon", segments: 16, swim: "pulse" },
    look: { fill: "solid", pattern: "bands", glow: 0.1, outline: "thin", palette: [["#6256d6", "#f3eaff"], ["#8577ea", "#f5f0ff"], ["#8f7ef0", "#efeaff"], ["#e2dbff", "#ffffff"]] },
    parts: { eye: "round", tail: "crescent", dorsal: "tiny", pectoral: "none", head: "serpent", extras: [] },
    stages: [
      { size: 6, color: "#6256d6", profile: "se1", shape: "crescent", dorsal: "tiny" },
      { size: 18, color: "#8577ea", profile: "se2", shape: "fan", dorsal: "tiny" },
      { size: 32, color: "#8f7ef0", profile: "se3", shape: "crescent", dorsal: "rear" },
      { size: 54, color: "#e2dbff", profile: "se4", shape: "spike", dorsal: "spike" },
    ],
  });

  registerFish({
    key: "eel",
    name: "EEL",
    stats: { spdMul: 1.08, visMul: 1.00, defMul: 0.85, stamMul: 1.16, aggrMul: 0.96, metab: 1.08, turn: 1.52 },
    passive: { weave: 0.30 },
    ai: { bias: { agg: 0.08, brv: 0.06, soc: -0.20, ter: 0.42 }, danger: 0.52, temperaments: [["AMBUSHER", 0.5], ["TERRITORIAL", 0.5]], strategies: [["AMBUSH", 0.6], ["STALK", 0.4]], canHunt: true, shoalSizeMul: 0.80 },
    spawn: { weight: 7, cap: 11, sizes: [5, 14, 28, 48] },
    body: { type: "ribbon", segments: 18, swim: "pulse" },
    look: { fill: "solid", pattern: "stripes", glow: 0.08, outline: "thin", palette: [["#5c8d74", "#eafaf4"], ["#66a282", "#edfef4"], ["#7fc29b", "#f5fff8"], ["#d0f5df", "#ffffff"]] },
    parts: { eye: "round", tail: "crescent", dorsal: "none", pectoral: "none", head: "serpent", extras: [] },
    stages: [
      { size: 5, color: "#5c8d74", profile: "ee1", shape: "crescent", dorsal: "tiny" },
      { size: 14, color: "#66a282", profile: "ee2", shape: "fan", dorsal: "tiny" },
      { size: 28, color: "#7fc29b", profile: "ee3", shape: "crescent", dorsal: "rear" },
      { size: 48, color: "#d0f5df", profile: "ee4", shape: "spike", dorsal: "rear" },
    ],
  });

  registerFish({
    key: "puffer",
    name: "PUFFER",
    stats: { spdMul: 0.70, visMul: 0.95, defMul: 1.40, stamMul: 1.30, aggrMul: 0.78, metab: 0.90, turn: 0.78 },
    passive: { inflate: 0.40 },
    ai: { bias: { agg: -0.16, brv: 0.38, soc: -0.06, ter: 0.22 }, danger: 0.42, temperaments: [["GUARDIAN", 0.6], ["TERRITORIAL", 0.4]], strategies: [["STALK", 0.65], ["AMBUSH", 0.35]], canHunt: true, shoalSizeMul: 0.80 },
    spawn: { weight: 6, cap: 8, sizes: [8, 18, 30, 52] },
    body: { type: "inflate", segments: 10, swim: "pulse" },
    look: { fill: "solid", pattern: "spots", glow: 0.18, outline: "thick", palette: [["#ec7d89", "#fff0f1"], ["#ff9cac", "#fff2f4"], ["#f8b7be", "#fff7f8"], ["#ffe1e7", "#ffffff"]] },
    parts: { eye: "round", tail: "tiny", dorsal: "tiny", pectoral: "fan", head: "standard", extras: [] },
    stages: [
      { size: 8, color: "#ec7d89", profile: "pu1", shape: "rear", dorsal: "tiny" },
      { size: 18, color: "#ff9cac", profile: "pu2", shape: "rear", dorsal: "tiny" },
      { size: 30, color: "#f8b7be", profile: "pu3", shape: "spike", dorsal: "rear" },
      { size: 52, color: "#ffe1e7", profile: "pu4", shape: "spike", dorsal: "spike" },
    ],
  });

  registerFish({
    key: "barracuda",
    name: "BARRACUDA",
    stats: { spdMul: 1.18, visMul: 1.10, defMul: 0.96, stamMul: 1.00, aggrMul: 1.05, metab: 1.05, turn: 1.20 },
    passive: { lunge: 0.35 },
    ai: { bias: { agg: 0.20, brv: 0.16, soc: -0.06, ter: 0.06 }, danger: 0.72, temperaments: [["HUNTER", 0.6], ["RUNNER", 0.4]], strategies: [["INTERCEPT", 0.55], ["CHASE", 0.45]], canHunt: true, shoalSizeMul: 0.85 },
    spawn: { weight: 5, cap: 7, sizes: [10, 20, 36, 58] },
    body: { type: "spine", segments: 12, swim: "carangiform" },
    look: { fill: "solid", pattern: "stripes", glow: 0.05, outline: "thin", palette: [["#d8d08c", "#fffbe5"], ["#f1d484", "#fff8d9"], ["#f7df8d", "#fff9e7"], ["#fff4bb", "#ffffff"]] },
    parts: { eye: "round", tail: "forked", dorsal: "tiny", pectoral: "fan", head: "standard", extras: [] },
    stages: [
      { size: 10, color: "#d8d08c", profile: "ba1", shape: "forked", dorsal: "tiny" },
      { size: 20, color: "#f1d484", profile: "ba2", shape: "fan", dorsal: "spiny" },
      { size: 36, color: "#f7df8d", profile: "ba3", shape: "forked", dorsal: "rear" },
      { size: 58, color: "#fff4bb", profile: "ba4", shape: "crescent", dorsal: "spike" },
    ],
  });

  registerFish({
    key: "angler",
    name: "ANGLER",
    stats: { spdMul: 0.88, visMul: 1.45, defMul: 0.90, stamMul: 1.00, aggrMul: 1.00, metab: 0.85, turn: 0.90 },
    passive: { lure: 0.50 },
    ai: { bias: { agg: 0.12, brv: -0.06, soc: -0.34, ter: 0.32 }, danger: 0.58, temperaments: [["AMBUSHER", 0.8], ["LONER", 0.2]], strategies: [["AMBUSH", 0.7], ["STALK", 0.3]], canHunt: true, shoalSizeMul: 0.55 },
    spawn: { weight: 4, cap: 6, sizes: [9, 18, 30, 58] },
    body: { type: "inflate", segments: 12, swim: "pulse" },
    look: { fill: "solid", pattern: "rings", glow: 0.32, outline: "thin", palette: [["#7f5bc8", "#f4ecff"], ["#8a6dd8", "#f4efff"], ["#b79de7", "#f6f3ff"], ["#e6d9ff", "#ffffff"]] },
    parts: { eye: "round", tail: "fan", dorsal: "tiny", pectoral: "fan", head: "standard", extras: ["lure"] },
    stages: [
      { size: 9, color: "#7f5bc8", profile: "an1", shape: "fan", dorsal: "tiny" },
      { size: 18, color: "#8a6dd8", profile: "an2", shape: "fan", dorsal: "tiny" },
      { size: 30, color: "#b79de7", profile: "an3", shape: "forked", dorsal: "rear" },
      { size: 58, color: "#e6d9ff", profile: "an4", shape: "crescent", dorsal: "spike" },
    ],
  });

  registerFish({
    key: "abyss",
    name: "ABYSS",
    stats: { spdMul: 0.92, visMul: 1.25, defMul: 1.10, stamMul: 1.06, aggrMul: 1.02, metab: 0.92, turn: 1.00 },
    passive: { dark: 0.30 },
    ai: { bias: { agg: 0.08, brv: -0.06, soc: -0.30, ter: 0.18 }, danger: 0.68, temperaments: [["AMBUSHER", 0.6], ["HUNTER", 0.4]], strategies: [["AMBUSH", 0.55], ["STALK", 0.45]], canHunt: true, shoalSizeMul: 0.60 },
    spawn: { weight: 3, cap: 5, sizes: [12, 22, 38, 64] },
    body: { type: "wing", segments: 11, swim: "pulse" },
    look: { fill: "solid", pattern: "bands", glow: 0.25, outline: "thin", palette: [["#2c4c7a", "#dfefff"], ["#416ca0", "#eaf4ff"], ["#5a8cc1", "#edf7ff"], ["#9dc7ff", "#ffffff"]] },
    parts: { eye: "round", tail: "crescent", dorsal: "tiny", pectoral: "fan", head: "standard", extras: [] },
    stages: [
      { size: 12, color: "#2c4c7a", profile: "ab1", shape: "fan", dorsal: "tiny" },
      { size: 22, color: "#416ca0", profile: "ab2", shape: "fan", dorsal: "tiny" },
      { size: 38, color: "#5a8cc1", profile: "ab3", shape: "crescent", dorsal: "rear" },
      { size: 64, color: "#9dc7ff", profile: "ab4", shape: "crescent", dorsal: "spike" },
    ],
  });

  registerFish({
    key: "swordfish",
    name: "SWORDFISH",
    stats: { spdMul: 1.25, visMul: 1.18, defMul: 1.00, stamMul: 1.06, aggrMul: 1.08, metab: 1.10, turn: 1.25 },
    passive: { pierce: 0.40 },
    ai: { bias: { agg: 0.18, brv: 0.22, soc: -0.08, ter: -0.04 }, danger: 0.80, temperaments: [["HUNTER", 0.7], ["RUNNER", 0.3]], strategies: [["CHASE", 0.6], ["INTERCEPT", 0.4]], canHunt: true, shoalSizeMul: 0.90 },
    spawn: { weight: 4, cap: 5, sizes: [12, 24, 40, 68] },
    body: { type: "spine", segments: 11, swim: "carangiform" },
    look: { fill: "solid", pattern: "none", glow: 0.08, outline: "thin", palette: [["#8f9aa6", "#edf7ff"], ["#bac3ce", "#f5faff"], ["#dfe7ee", "#ffffff"], ["#f7fbff", "#ffffff"]] },
    parts: { eye: "round", tail: "forked", dorsal: "spike", pectoral: "fan", head: "standard", extras: [] },
    stages: [
      { size: 12, color: "#8f9aa6", profile: "sf1", shape: "forked", dorsal: "tiny" },
      { size: 24, color: "#bac3ce", profile: "sf2", shape: "forked", dorsal: "spiny" },
      { size: 40, color: "#dfe7ee", profile: "sf3", shape: "crescent", dorsal: "rear" },
      { size: 68, color: "#f7fbff", profile: "sf4", shape: "crescent", dorsal: "spike" },
    ],
  });

  registerFish({
    key: "leviathan",
    name: "LEVIATHAN",
    stats: { spdMul: 0.88, visMul: 1.18, defMul: 1.50, stamMul: 1.35, aggrMul: 1.08, metab: 0.90, turn: 0.80 },
    passive: { apex: 0.55 },
    ai: { bias: { agg: 0.22, brv: 0.32, soc: -0.16, ter: 0.30 }, danger: 0.92, temperaments: [["TERRITORIAL", 0.5], ["GUARDIAN", 0.5]], strategies: [["STALK", 0.55], ["CHASE", 0.45]], canHunt: true, shoalSizeMul: 0.55 },
    spawn: { weight: 1, cap: 2, sizes: [16, 30, 52, 84] },
    body: { type: "inflate", segments: 12, swim: "carangiform" },
    look: { fill: "solid", pattern: "bands", glow: 0.30, outline: "thick", palette: [["#5b6b7f", "#ecf6ff"], ["#7a8ea6", "#edf8ff"], ["#a6bfd4", "#f2fbff"], ["#dbeeff", "#ffffff"]] },
    parts: { eye: "round", tail: "fan", dorsal: "spike", pectoral: "fan", head: "standard", extras: [] },
    stages: [
      { size: 16, color: "#5b6b7f", profile: "lv1", shape: "rear", dorsal: "tiny" },
      { size: 30, color: "#7a8ea6", profile: "lv2", shape: "spike", dorsal: "rear" },
      { size: 52, color: "#a6bfd4", profile: "lv3", shape: "crescent", dorsal: "spike" },
      { size: 84, color: "#dbeeff", profile: "lv4", shape: "spike", dorsal: "spike" },
    ],
  });
})(typeof window !== "undefined" ? window : globalThis);
