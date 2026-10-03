(function (global) {
  "use strict";

  const DEFAULT_SPAWN_WEIGHTS = {
    koi: 14,
    swift: 12,
    armor: 9,
    manta: 9,
    serpent: 7,
    eel: 7,
    jelly: 8,
    puffer: 6,
    predator: 9,
    piranha: 6,
    barracuda: 5,
    swordfish: 4,
    angler: 4,
    abyss: 3,
    leviathan: 1,
  };

  const DEFAULT_POP_CAPS = {
    leviathan: 2,
    abyss: 4,
    swordfish: 5,
    angler: 5,
    barracuda: 6,
    piranha: 12,
  };

  const store = new Map();
  const order = [];

  function pickStageColor(stage) {
    if (stage && typeof stage === "object") {
      if (typeof stage.color === "string" && stage.color) return stage.color;
      if (stage.profile && typeof stage.profile === "string") return "#ffffff";
    }
    return "#ffffff";
  }

  function normalizeDesign(raw) {
    const key = String(raw && raw.key || "").trim();
    if (!key) throw new Error("registerFish requires a non-empty key.");

    const stages = Array.isArray(raw.stages) ? raw.stages.map((stage, index) => ({
      size: Number(stage && stage.size) || (index + 1) * 8,
      color: stage && stage.color || "#ffffff",
      profile: stage && stage.profile || "",
      shape: stage && stage.shape || "forked",
      dorsal: stage && stage.dorsal || "tiny",
      ...stage,
    })) : [];

    const basePalette = Array.isArray(raw.look && raw.look.palette) && raw.look.palette.length
      ? raw.look.palette.slice()
      : stages.map((stage) => [stage.color, "#ffffff"]);

    return {
      key,
      name: raw.name || key.toUpperCase(),
      stats: {
        spdMul: Number((raw.stats && raw.stats.spdMul) != null ? raw.stats.spdMul : 1),
        visMul: Number((raw.stats && raw.stats.visMul) != null ? raw.stats.visMul : 1),
        defMul: Number((raw.stats && raw.stats.defMul) != null ? raw.stats.defMul : 1),
        stamMul: Number((raw.stats && raw.stats.stamMul) != null ? raw.stats.stamMul : 1),
        aggrMul: Number((raw.stats && raw.stats.aggrMul) != null ? raw.stats.aggrMul : 1),
        metab: Number((raw.stats && raw.stats.metab) != null ? raw.stats.metab : 1),
        turn: Number((raw.stats && raw.stats.turn) != null ? raw.stats.turn : 1),
      },
      passive: Object.assign({}, raw.passive || {}),
      ai: {
        bias: Object.assign({ agg: 0, brv: 0, soc: 0, ter: 0 }, raw.ai && raw.ai.bias || {}),
        danger: Number((raw.ai && raw.ai.danger) != null ? raw.ai.danger : 0.5),
        temperaments: Array.isArray(raw.ai && raw.ai.temperaments) ? raw.ai.temperaments.slice() : [],
        strategies: Array.isArray(raw.ai && raw.ai.strategies) ? raw.ai.strategies.slice() : [],
        canHunt: raw.ai && raw.ai.canHunt !== undefined ? !!raw.ai.canHunt : true,
        shoalSizeMul: Number((raw.ai && raw.ai.shoalSizeMul) != null ? raw.ai.shoalSizeMul : 1),
      },
      spawn: {
        weight: Number((raw.spawn && raw.spawn.weight) != null ? raw.spawn.weight : 1),
        cap: raw.spawn && raw.spawn.cap != null ? Number(raw.spawn.cap) : null,
        sizes: Array.isArray(raw.spawn && raw.spawn.sizes) ? raw.spawn.sizes.slice() : [4, 20],
      },
      body: Object.assign({
        type: "spine",
        segments: 12,
        swim: "carangiform",
      }, raw.body || {}),
      look: Object.assign({
        fill: "solid",
        pattern: "none",
        glow: 0,
        outline: "thin",
        palette: basePalette,
      }, raw.look || {}),
      parts: Object.assign({
        eye: "round",
        tail: "forked",
        dorsal: "tiny",
        pectoral: "fan",
        head: "standard",
        extras: [],
      }, raw.parts || {}),
      stages,
    };
  }

  function registerFish(raw) {
    const normalized = normalizeDesign(raw);
    if (!store.has(normalized.key)) order.push(normalized.key);
    store.set(normalized.key, normalized);

    if (global.LINEAGES && global.LINEAGES[normalized.key]) {
      const legacy = global.LINEAGES[normalized.key];
      legacy.design = normalized;
      legacy.stats = normalized.stats;
      legacy.ai = normalized.ai;
      legacy.body = normalized.body;
      legacy.look = normalized.look;
      legacy.parts = normalized.parts;
      legacy.spawn = normalized.spawn;
      if (normalized.stages.length) {
        legacy.stages = normalized.stages.map((stage) => Object.assign({}, legacy.stages[0] || {}, stage));
      }
    }

    return normalized;
  }

  function migrateLegacyLineages() {
    if (!global.LINEAGES) return;
    for (const key of Object.keys(global.LINEAGES)) {
      const lineage = global.LINEAGES[key];
      const defaultWeight = DEFAULT_SPAWN_WEIGHTS[key] || 1;
      const defaultCap = Object.prototype.hasOwnProperty.call(DEFAULT_POP_CAPS, key) ? DEFAULT_POP_CAPS[key] : null;
      const stageList = Array.isArray(lineage.stages) ? lineage.stages.map((stage) => ({
        size: Number(stage && stage.size) || 8,
        color: stage && stage.color || pickStageColor(stage),
        profile: stage && stage.profile || "",
        shape: stage && stage.shape || "forked",
        dorsal: stage && stage.dorsal || "tiny",
      })) : [];

      registerFish({
        key,
        name: lineage.name || key.toUpperCase(),
        stats: {
          spdMul: lineage.spdMul || 1,
          visMul: lineage.visMul || 1,
          defMul: lineage.defMul || 1,
          stamMul: lineage.stamMul || 1,
          aggrMul: lineage.aggrMul || 1,
          metab: 1,
          turn: 1,
        },
        passive: {
          ambush: !!lineage.ambush,
          swarm: !!lineage.swarm,
          apex: !!lineage.apex,
          lure: !!lineage.lure,
          reflect: Number(lineage.reflect) || 0,
          sting: Number(lineage.sting) || 0,
          dash: Number(lineage.dash) || 0
        },
        ai: {
          bias: { agg: lineage.aggrMul ? (lineage.aggrMul - 1) * 0.7 : 0, brv: 0, soc: lineage.swarm ? 0.3 : 0, ter: lineage.ambush ? 0.2 : 0 },
          danger: 0.5,
          temperaments: [],
          strategies: [],
          canHunt: true,
          shoalSizeMul: lineage.swarm ? 1.25 : 0.8,
        },
        spawn: {
          weight: defaultWeight,
          cap: defaultCap,
          sizes: stageList.map((stage) => stage.size),
        },
        body: {
          type: "spine",
          segments: Math.max(8, Math.round(10 + stageList.length * 2)),
          swim: "carangiform",
        },
        look: {
          fill: "solid",
          pattern: "none",
          glow: 0,
          outline: "thin",
          palette: stageList.map((stage) => [stage.color, "#ffffff"]),
        },
        parts: {
          eye: "round",
          tail: "forked",
          dorsal: "tiny",
          pectoral: "fan",
          head: "standard",
          extras: lineage.lure ? ["lure"] : [],
        },
        stages: stageList,
      });
    }
  }

  function get(key) {
    return store.get(key) || (global.LINEAGES && global.LINEAGES[key] ? { key, ...global.LINEAGES[key] } : null);
  }

  function all() {
    return order.map((key) => store.get(key)).filter(Boolean);
  }

  function spawnWeights() {
    const out = {};
    for (const entry of all()) {
      if (entry.spawn && entry.spawn.weight) out[entry.key] = entry.spawn.weight;
    }
    if (!Object.keys(out).length && global.LINEAGES) {
      for (const key of Object.keys(global.LINEAGES)) out[key] = DEFAULT_SPAWN_WEIGHTS[key] || 1;
    }
    return out;
  }

  function spawnCaps() {
    const out = {};
    for (const entry of all()) {
      if (entry.spawn && entry.spawn.cap != null) out[entry.key] = entry.spawn.cap;
    }
    if (!Object.keys(out).length && global.LINEAGES) {
      for (const key of Object.keys(global.LINEAGES)) {
        if (Object.prototype.hasOwnProperty.call(DEFAULT_POP_CAPS, key)) out[key] = DEFAULT_POP_CAPS[key];
      }
    }
    return out;
  }

  migrateLegacyLineages();

  const api = {
    registerFish,
    get,
    all,
    keys: () => order.slice(),
    spawnWeights,
    spawnCaps,
  };

  Object.assign(global, {
    FishRegistry: api,
    FISH_REGISTRY: store,
    registerFish,
  });

  if (!global.LINEAGE_KEYS && global.LINEAGES) {
    global.LINEAGE_KEYS = Object.keys(global.LINEAGES);
  }

  if (!global.SPAWN_WEIGHTS) {
    global.SPAWN_WEIGHTS = spawnWeights();
  }

  if (!global.POP_CAPS) {
    global.POP_CAPS = spawnCaps();
  }
})(typeof window !== "undefined" ? window : globalThis);
