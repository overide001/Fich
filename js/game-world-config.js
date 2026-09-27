"use strict";

/* ================================================================
   CORE DATA / MATH / CONFIG LAYER  —  rework v3
   ----------------------------------------------------------------
   Backward-compatible surface (all original names kept):
     v.add/sub/scale/len/norm/d2/d
     clamp / lerp / rand / rInt / wrapA
     PLAYER_COLOR / PLAYER_GLOW / PLAYER_DARK
     CFG.* (every key preserved, no removals)
     STAGE_NAMES / STAGE_SIZES
     PROFILES[pr1..le4] / widthAt(key, t)
     LINEAGES[key].stages[i]
     LINEAGE_KEYS
     getLineage / getStage / stageForSize / lineageStageData / visualParam

   This file is the SINGLE SOURCE OF TRUTH for shared world data.
   It must NOT contain Fish/Shoal classes — those live in
   fish-behavior.js.

   Contents:
     1. Vector math (v)
     2. Scalar math + easing + wrap helpers
     3. Palette / player identity
     4. CFG — world, growth, metabolism, movement, vision,
        shoaling, AI, stamina, food, spawning, camera, combat
     5. Stage names + sizes
     6. PROFILES — 15 lineages x 4 stages = 60 silhouettes
     7. Profile sampling (baked LUT, O(1) widthAt)
     8. LINEAGES — 15 lineages, 4 stages each, trait flags
     9. Cached stage params + accessors
    10. Global exports
   ================================================================ */

/* ================================================================
   1.  VECTOR MATH
   ----------------------------------------------------------------
   Pure ops keep the original allocation-returning signatures.
   Mutating variants (*To) write into `out` and return it, so the
   renderer/sim can run entire frames without allocating a vector.
   ================================================================ */
const v = {
  /* ---- allocation-returning (legacy, unchanged) ---- */
  add:  (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
  sub:  (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
  scale:(a, s) => ({ x: a.x * s, y: a.y * s }),
  len:  (a) => Math.hypot(a.x, a.y),
  norm: (a) => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; },
  d2:   (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; },
  d:    (a, b) => Math.hypot(a.x - b.x, a.y - b.y),

  /* ---- additional pure ops ---- */
  mul:     (a, b) => ({ x: a.x * b.x, y: a.y * b.y }),
  neg:     (a) => ({ x: -a.x, y: -a.y }),
  copy:    (a) => ({ x: a.x, y: a.y }),
  zero:    () => ({ x: 0, y: 0 }),
  lenSq:   (a) => a.x * a.x + a.y * a.y,
  distSq:  (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; },
  dist:    (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
  dot:     (a, b) => a.x * b.x + a.y * b.y,
  cross:   (a, b) => a.x * b.y - a.y * b.x,
  angle:   (a) => Math.atan2(a.y, a.x),
  perp:    (a) => ({ x: -a.y, y: a.x }),
  fromAngle:(a, l = 1) => ({ x: Math.cos(a) * l, y: Math.sin(a) * l }),
  rot:     (a, r) => { const c = Math.cos(r), s = Math.sin(r); return { x: a.x * c - a.y * s, y: a.x * s + a.y * c }; },
  lerp:    (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }),
  midpoint:(a, b) => ({ x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 }),
  isZero:  (a, e = 1e-9) => Math.abs(a.x) < e && Math.abs(a.y) < e,
  finite:  (a) => isFinite(a.x) && isFinite(a.y),
  clampLen:(a, max) => {
    const l = Math.hypot(a.x, a.y);
    if (l <= max || l < 1e-9) return { x: a.x, y: a.y };
    const s = max / l;
    return { x: a.x * s, y: a.y * s };
  },

  /* ---- mutating variants (fast path, no GC) ---- */
  setTo:    (out, a) => { out.x = a.x; out.y = a.y; return out; },
  addTo:    (out, a) => { out.x += a.x; out.y += a.y; return out; },
  subFrom:  (out, a) => { out.x -= a.x; out.y -= a.y; return out; },
  scaleTo:  (out, a, s) => { out.x = a.x * s; out.y = a.y * s; return out; },
  normTo:   (out, a) => { const l = Math.hypot(a.x, a.y) || 1; out.x = a.x / l; out.y = a.y / l; return out; },
  perpTo:   (out, a) => { const x = a.x, y = a.y; out.x = -y; out.y = x; return out; },
  rotTo:    (out, a, r) => {
    const c = Math.cos(r), s = Math.sin(r);
    const x = a.x, y = a.y;
    out.x = x * c - y * s; out.y = x * s + y * c;
    return out;
  },
  lerpTo:   (out, a, b, t) => { out.x = a.x + (b.x - a.x) * t; out.y = a.y + (b.y - a.y) * t; return out; },
  clampLenTo:(out, a, max) => {
    const l = Math.hypot(a.x, a.y);
    if (l <= max || l < 1e-9) { out.x = a.x; out.y = a.y; return out; }
    const s = max / l; out.x = a.x * s; out.y = a.y * s; return out;
  },
  moveTowards:(out, a, b, maxStep) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    if (l <= maxStep || l < 1e-9) { out.x = b.x; out.y = b.y; return out; }
    const s = maxStep / l;
    out.x = a.x + dx * s; out.y = a.y + dy * s;
    return out;
  },
};

/* ================================================================
   2.  SCALAR MATH
   ================================================================ */
const TAU     = Math.PI * 2;
const HALF_PI = Math.PI * 0.5;

const clamp   = (x, a, b) => x < a ? a : (x > b ? b : x);
const clamp01 = (x) => x < 0 ? 0 : (x > 1 ? 1 : x);
const lerp    = (a, b, t) => a + (b - a) * t;
const invLerp = (a, b, val) => (b - a) ? ((val - a) / (b - a)) : 0;
const remap   = (val, a, b, c, d) => lerp(c, d, clamp01(invLerp(a, b, val)));

const smoothstep     = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const smootherstep   = (t) => { t = clamp01(t); return t * t * t * (t * (t * 6 - 15) + 10); };
const easeOutCubic   = (t) => { t = clamp01(t); return 1 - Math.pow(1 - t, 3); };
const easeInCubic    = (t) => { t = clamp01(t); return t * t * t; };
const easeInOutCubic = (t) => { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) * 0.5; };
const easeOutQuad    = (t) => { t = clamp01(t); return 1 - (1 - t) * (1 - t); };
const easeInQuad     = (t) => { t = clamp01(t); return t * t; };
const easeOutSine    = (t) => { t = clamp01(t); return Math.sin(t * HALF_PI); };
const easeInSine     = (t) => { t = clamp01(t); return 1 - Math.cos(t * HALF_PI); };

const rand     = (a, b) => a + Math.random() * (b - a);
const rInt     = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const sign     = (x) => x < 0 ? -1 : (x > 0 ? 1 : 0);
const approach = (cur, target, rate) => cur + (target - cur) * clamp01(rate);

const wrapA     = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const wrapAFast = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const angleDiff = (a, b) => wrapAFast(a - b);
const angleLerp = (a, b, t) => a + angleDiff(b, a) * clamp01(t);

/* ================================================================
   3.  PALETTE / PLAYER IDENTITY
   ================================================================ */
const PLAYER_COLOR   = '#ffcc44';
const PLAYER_GLOW    = 'rgba(255,204,68,';
const PLAYER_DARK    = '#8a6a00';
const PLAYER_LINEAGE = 'predator';

/* ================================================================
   4.  CONFIG
   ----------------------------------------------------------------
   Every key referenced by ecosystem-simulation.js / fish-behavior.js
   is present here.  New tuning blocks are grouped at the end
   under ANIM (animation tuning) and VIS (scale-safe caps).
   ================================================================ */
const CFG = {
  /* ---- world bounds ---- */
  W: 16000,
  H: 9000,
  VIEW_W: 1600,
  VIEW_H: 900,
  EDGE: 110,

  /* ---- growth ---- */
  SIZE_RATIO: 1.25,
  EAT_GROWTH: 0.22,
  EAT_ENERGY: 9,
  MAX_SIZE: 72,
  GROWTH_TAPER_FLOOR: 0.08,
  GROWTH_TAPER_POW: 1.35,

  /* ---- metabolism ---- */
  METAB: 0.45,
  METAB_SZ: 0.055,

  /* ---- movement ---- */
  SPD: 150,
  SPD_SZ: 0.06,
  SPD_MIN: 60,
  SPD_TAPER: 0.22,
  TURN_AI: 4.2,
  TURN_PLR: 13,

  /* ---- vision ---- */
  VIS_BASE: 210,
  VIS_SZ: 4.5,
  VIS_SOFT_START: 280,
  VIS_CAP: 430,

  /* ---- stamina ---- */
  STAM_MAX: 100,
  STAM_DRAIN_FLEE: 42,
  STAM_DRAIN_CHASE: 11,
  STAM_REGEN: 14,

  /* ---- small same-lineage shoals ---- */
  SHOAL_MAX_SIZE: 12,
  SHOAL_MIN_ALLIES: 2,
  SHOAL_SPACING_MUL: 1.45,
  SHOAL_COHESION: 0.85,
  CHEAT_SHOAL_COUNT: 8,
  CHEAT_SHOAL_RADIUS: 420,
  CHEAT_SHOAL_MIN_DISTANCE: 120,

  /* ---- size-aware movement / animation ---- */
  BODY_MARGIN_MUL: 3.4,
  EDGE_STEER_MUL: 3.2,
  WAKE_MIN_SPD: 75,
  WAKE_INTERVAL: 0.08,
  WAKE_LIFE: 0.85,
  WAKE_MAX: 240,

  /* ---- dynamic camera ---- */
  CAM_ZOOM_NEAR: 1.16,
  CAM_ZOOM_FAR: 0.68,
  CAM_LERP: 0.035,
  CAM_PAN_LERP: 0.07,
  CAM_PAN_RANGE: 0.18,

  /* ---- opening encounter density ---- */
  START_FISH_RADIUS: 950,
  START_FISH_MIN_DISTANCE: 220,
  START_FISH_MIN_DIST: 220,          /* alias, kept for safety */
  PLAYER_PARTICLE_INTERVAL: 0.06,
  PLAYER_PARTICLES_PER_BURST: 8,
  FOOD_OPENING_TGT: 360,
  FOOD_OPENING_RADIUS: 1200,
  FOOD_OPENING_MIN_DISTANCE: 140,

  /* ---- scale-safe effect aliases ---- */
  GLOW_R_CAP: 150,
  RING_R_CAP: 210,

  /* ---- AI ---- */
  PREDICT_CAP: 1.0,
  MEMORY: 1.8,
  HUNGER: 0.15,
  AI_START_ENERGY: 0.65,
  THREAT_OPTS_MAX: 6,
  SATIATED_ENERGY_FRAC: 0.82,
  HUNT_HEALTH_MIN: 0.35,
  HUNT_STAM_MIN: 18,

  /* ---- player evolution thresholds ---- */
  EV_2: 12,
  EV_3: 26,
  EV_4: 52,
  EVO_DUR: 1.5,

  /* ---- food ---- */
  FOOD_TGT: 180,
  FOOD_RATE: 16,
  FOOD_NRJ: 7,
  FOOD_GROW: 0.06,

  /* ---- spawning ---- */
  MAX_FISH: 96,
  SPAWN_T: 1.15,

  /* ---- player ---- */
  P_SIZE: 8,
  P_NRJ: 140,
  P_SPD: 1.08,

  /* ---- combat ---- */
  BITE_RADIUS: (a, b) => (a + b) * 0.65,

  /* ------------------------------------------------------------
     ANIMATION TUNING — read by the renderer with safe fallbacks.
     ------------------------------------------------------------ */
  ANIM: {
    /* body undulation */
    undulateAmp: 0.055,
    undulateAmpMoving: 0.075,
    undulateSpeed: 6.0,
    undulateFreq: 3.4,
    undulateFreqFast: 5.2,
    idleMotion: 0.35,

    /* tail */
    tailLag: 0.95,
    tailSweepBase: 0.10,
    tailSweepMax: 0.28,
    tailSweepSpeed: 0.0055,
    tailRipple: 0.12,

    /* fins */
    finFlapIdle: 1.6,
    finFlapCruise: 2.2,
    finFlapChase: 2.8,
    finFlapFlee: 3.6,
    finFlapStalk: 1.2,
    finFlapAmpIdle: 0.30,
    finFlapAmpChase: 0.55,
    finFlapAmpFlee: 0.65,
    finFlapAmpStalk: 0.18,

    /* dorsal */
    dorsalSway: 0.10,
    dorsalSwayFreq: 1.35,

    /* eye */
    eyeBlinkMin: 2.5,
    eyeBlinkMax: 7.0,
    pupilTrack: 0.30,

    /* breathing */
    breatheAmp: 0.020,
    breatheFreq: 2.1,

    /* glow pulses */
    glowPulseAmp: 0.15,
    glowPulseFreq: 2.6,

    /* evolution rings */
    evoRingCount: 3,
    evoRingReach: 5.0,

    /* spawn fade */
    spawnFadeTime: 0.5,
  },

  /* ------------------------------------------------------------
     VISUAL LIMITS — scale-safe clamps for large fish.
     ------------------------------------------------------------ */
  VIS: {
    maxGlowRadius: 150,
    maxShadowRadius: 240,
    maxTailLength: 180,
    maxTailWidth: 150,
    maxEyeRadius: 6.0,
    maxFinSpan: 100,
    maxBodyWidthMult: 1.45,
    maxSpineSamples: 96,
    maxSpineSamplesLow: 64,
    shadowFarCull: 540,
    glowFarCull: 940,
  },
};

/* ================================================================
   5.  STAGE NAMES
   ================================================================ */
const STAGE_NAMES = ['FRY', 'JUVENILE', 'HUNTER', 'APEX'];
const STAGE_SIZES = [8, 16, 30, 60];

/* ================================================================
   6.  BODY PROFILES
   ----------------------------------------------------------------
   12-point half-width curves, head (t = 0) → tail (t = 1).
   One profile per (lineage, stage).  15 lineages × 4 stages.

   Naming: <lineage prefix><stage number>
     pr predator   sw swift     ar armor    se serpent   ab abyss
     pu puffer     sf swordfish pi piranha  an angler    mn manta
     ee eel        je jelly     ba barracuda ko koi       le leviathan
   ================================================================ */
const PROFILES = {
  /* ---------------- PREDATOR — balanced torpedo ---------------- */
  pr1: [0.09, 0.18, 0.26, 0.31, 0.32, 0.31, 0.27, 0.22, 0.16, 0.10, 0.05, 0.02],
  pr2: [0.10, 0.22, 0.36, 0.48, 0.54, 0.53, 0.46, 0.36, 0.24, 0.14, 0.06, 0.02],
  pr3: [0.08, 0.18, 0.32, 0.46, 0.55, 0.56, 0.50, 0.40, 0.27, 0.16, 0.07, 0.02],
  pr4: [0.06, 0.16, 0.32, 0.52, 0.66, 0.72, 0.68, 0.54, 0.36, 0.19, 0.07, 0.02],

  /* ---------------- SWIFT — thin dart ---------------- */
  sw1: [0.07, 0.14, 0.20, 0.22, 0.21, 0.18, 0.14, 0.10, 0.06, 0.03, 0.01, 0.00],
  sw2: [0.08, 0.16, 0.24, 0.27, 0.26, 0.22, 0.17, 0.12, 0.07, 0.03, 0.01, 0.00],
  sw3: [0.09, 0.20, 0.32, 0.37, 0.36, 0.31, 0.23, 0.15, 0.08, 0.04, 0.01, 0.00],
  sw4: [0.10, 0.22, 0.38, 0.46, 0.45, 0.39, 0.30, 0.20, 0.11, 0.05, 0.02, 0.00],

  /* ---------------- ARMOR — chunky tank ---------------- */
  ar1: [0.11, 0.22, 0.30, 0.34, 0.33, 0.30, 0.25, 0.19, 0.13, 0.07, 0.03, 0.01],
  ar2: [0.13, 0.28, 0.42, 0.52, 0.54, 0.51, 0.44, 0.34, 0.22, 0.12, 0.05, 0.01],
  ar3: [0.15, 0.32, 0.52, 0.68, 0.74, 0.72, 0.62, 0.48, 0.31, 0.16, 0.06, 0.01],
  ar4: [0.17, 0.38, 0.64, 0.84, 0.94, 0.92, 0.80, 0.62, 0.40, 0.20, 0.07, 0.02],

  /* ---------------- SERPENT — long, near-uniform ---------------- */
  se1: [0.08, 0.10, 0.12, 0.14, 0.15, 0.15, 0.14, 0.12, 0.10, 0.07, 0.04, 0.01],
  se2: [0.09, 0.12, 0.15, 0.17, 0.18, 0.18, 0.17, 0.15, 0.12, 0.09, 0.05, 0.02],
  se3: [0.10, 0.14, 0.19, 0.22, 0.24, 0.24, 0.22, 0.19, 0.15, 0.11, 0.06, 0.03],
  se4: [0.12, 0.17, 0.23, 0.29, 0.32, 0.32, 0.30, 0.26, 0.20, 0.14, 0.08, 0.03],

  /* ---------------- ABYSS — bulky jaw, sharp taper ---------------- */
  ab1: [0.10, 0.18, 0.24, 0.26, 0.24, 0.20, 0.15, 0.10, 0.06, 0.03, 0.01, 0.00],
  ab2: [0.14, 0.28, 0.40, 0.46, 0.45, 0.39, 0.30, 0.20, 0.12, 0.06, 0.02, 0.00],
  ab3: [0.18, 0.38, 0.56, 0.66, 0.64, 0.55, 0.42, 0.28, 0.16, 0.08, 0.03, 0.00],
  ab4: [0.22, 0.48, 0.72, 0.88, 0.86, 0.76, 0.58, 0.38, 0.22, 0.10, 0.03, 0.00],

  /* ---------------- PUFFER — round inflatable balloon ---------------- */
  pu1: [0.14, 0.30, 0.48, 0.62, 0.68, 0.66, 0.58, 0.46, 0.32, 0.18, 0.07, 0.02],
  pu2: [0.16, 0.36, 0.58, 0.76, 0.84, 0.82, 0.72, 0.58, 0.40, 0.22, 0.09, 0.02],
  pu3: [0.18, 0.42, 0.68, 0.88, 0.98, 0.96, 0.86, 0.70, 0.50, 0.28, 0.11, 0.03],
  pu4: [0.20, 0.48, 0.78, 1.00, 1.12, 1.10, 0.98, 0.80, 0.58, 0.32, 0.12, 0.03],

  /* ---------------- SWORDFISH — long bill, deep mid ---------------- */
  sf1: [0.03, 0.06, 0.12, 0.20, 0.26, 0.27, 0.24, 0.18, 0.12, 0.06, 0.02, 0.00],
  sf2: [0.04, 0.08, 0.16, 0.26, 0.34, 0.35, 0.31, 0.24, 0.16, 0.08, 0.03, 0.00],
  sf3: [0.04, 0.10, 0.20, 0.32, 0.42, 0.44, 0.39, 0.30, 0.20, 0.10, 0.04, 0.00],
  sf4: [0.05, 0.12, 0.24, 0.38, 0.50, 0.52, 0.46, 0.36, 0.24, 0.12, 0.05, 0.01],

  /* ---------------- PIRANHA — deep body, blunt head ---------------- */
  pi1: [0.16, 0.30, 0.42, 0.50, 0.52, 0.49, 0.42, 0.33, 0.23, 0.13, 0.05, 0.01],
  pi2: [0.18, 0.34, 0.48, 0.58, 0.60, 0.56, 0.48, 0.38, 0.26, 0.15, 0.06, 0.01],
  pi3: [0.20, 0.38, 0.54, 0.66, 0.68, 0.64, 0.55, 0.43, 0.30, 0.17, 0.07, 0.01],
  pi4: [0.22, 0.42, 0.60, 0.74, 0.76, 0.71, 0.61, 0.48, 0.33, 0.19, 0.08, 0.02],

  /* ---------------- ANGLER — huge head, tapering body ---------------- */
  an1: [0.16, 0.32, 0.44, 0.50, 0.48, 0.42, 0.34, 0.25, 0.16, 0.09, 0.04, 0.01],
  an2: [0.18, 0.36, 0.50, 0.58, 0.56, 0.49, 0.40, 0.29, 0.19, 0.10, 0.04, 0.01],
  an3: [0.20, 0.40, 0.56, 0.66, 0.64, 0.56, 0.45, 0.33, 0.21, 0.11, 0.05, 0.01],
  an4: [0.22, 0.44, 0.62, 0.74, 0.72, 0.63, 0.51, 0.37, 0.24, 0.13, 0.05, 0.01],

  /* ---------------- MANTA — wide wings ---------------- */
  mn1: [0.12, 0.30, 0.50, 0.66, 0.74, 0.72, 0.62, 0.48, 0.33, 0.19, 0.08, 0.02],
  mn2: [0.14, 0.36, 0.60, 0.80, 0.90, 0.88, 0.76, 0.58, 0.40, 0.23, 0.10, 0.02],
  mn3: [0.16, 0.42, 0.70, 0.94, 1.06, 1.04, 0.90, 0.70, 0.48, 0.27, 0.11, 0.03],
  mn4: [0.18, 0.48, 0.80, 1.08, 1.22, 1.20, 1.04, 0.80, 0.55, 0.31, 0.12, 0.03],

  /* ---------------- EEL — thin ribbon ---------------- */
  ee1: [0.07, 0.09, 0.11, 0.12, 0.13, 0.13, 0.12, 0.11, 0.09, 0.06, 0.03, 0.01],
  ee2: [0.08, 0.11, 0.13, 0.15, 0.16, 0.16, 0.15, 0.13, 0.11, 0.08, 0.04, 0.01],
  ee3: [0.09, 0.12, 0.16, 0.19, 0.20, 0.20, 0.19, 0.16, 0.13, 0.09, 0.05, 0.02],
  ee4: [0.10, 0.15, 0.20, 0.24, 0.26, 0.26, 0.24, 0.21, 0.17, 0.12, 0.07, 0.02],

  /* ---------------- JELLY — bell dome ---------------- */
  je1: [0.20, 0.42, 0.62, 0.74, 0.78, 0.76, 0.68, 0.56, 0.42, 0.27, 0.13, 0.04],
  je2: [0.22, 0.48, 0.70, 0.84, 0.88, 0.86, 0.76, 0.62, 0.46, 0.30, 0.14, 0.04],
  je3: [0.24, 0.54, 0.78, 0.94, 0.98, 0.96, 0.85, 0.70, 0.52, 0.33, 0.16, 0.05],
  je4: [0.26, 0.60, 0.86, 1.04, 1.10, 1.08, 0.95, 0.78, 0.58, 0.37, 0.17, 0.05],

  /* ---------------- BARRACUDA — pike ---------------- */
  ba1: [0.06, 0.10, 0.16, 0.21, 0.23, 0.22, 0.19, 0.15, 0.11, 0.07, 0.03, 0.01],
  ba2: [0.07, 0.12, 0.19, 0.25, 0.28, 0.27, 0.23, 0.18, 0.13, 0.08, 0.04, 0.01],
  ba3: [0.08, 0.14, 0.22, 0.30, 0.34, 0.33, 0.28, 0.22, 0.16, 0.10, 0.04, 0.01],
  ba4: [0.09, 0.16, 0.26, 0.35, 0.40, 0.39, 0.33, 0.26, 0.19, 0.12, 0.05, 0.02],

  /* ---------------- KOI — rounded full body ---------------- */
  ko1: [0.12, 0.24, 0.36, 0.44, 0.48, 0.47, 0.42, 0.34, 0.25, 0.15, 0.06, 0.02],
  ko2: [0.14, 0.28, 0.42, 0.52, 0.56, 0.55, 0.49, 0.40, 0.29, 0.18, 0.08, 0.02],
  ko3: [0.16, 0.32, 0.48, 0.60, 0.66, 0.64, 0.57, 0.47, 0.34, 0.21, 0.09, 0.03],
  ko4: [0.18, 0.36, 0.54, 0.68, 0.74, 0.72, 0.64, 0.52, 0.38, 0.23, 0.10, 0.03],

  /* ---------------- LEVIATHAN — massive apex bulk ---------------- */
  le1: [0.14, 0.28, 0.42, 0.50, 0.52, 0.49, 0.42, 0.33, 0.23, 0.14, 0.06, 0.02],
  le2: [0.16, 0.34, 0.52, 0.64, 0.68, 0.64, 0.55, 0.43, 0.30, 0.18, 0.07, 0.02],
  le3: [0.18, 0.40, 0.62, 0.78, 0.84, 0.80, 0.68, 0.53, 0.37, 0.22, 0.09, 0.03],
  le4: [0.20, 0.46, 0.72, 0.92, 1.00, 0.96, 0.82, 0.64, 0.45, 0.27, 0.11, 0.03],
};

/* ================================================================
   7.  PROFILE SAMPLING — fast LUT path
   ----------------------------------------------------------------
   widthAt() is called per resampled spine sample, per fish, per
   frame.  Instead of running Catmull-Rom every call, we bake each
   profile into a fixed-resolution Float32Array once at load, then
   do a single lerp per lookup.

   PROFILE_LUT_SIZE = 96 matches CFG.VIS.maxSpineSamples, so any
   resampled spine samples the profile at native resolution.
   Raw-array callers still hit the original Catmull-Rom path.
   ================================================================ */
const PROFILE_LUT_SIZE = 96;

const PROFILE_LUT = (() => {
  const out = {};
  for (const key in PROFILES) {
    const a = PROFILES[key];
    const n = a.length - 1;
    const lut = new Float32Array(PROFILE_LUT_SIZE + 1);
    for (let i = 0; i <= PROFILE_LUT_SIZE; i++) {
      const t = i / PROFILE_LUT_SIZE;
      if (t <= 0) { lut[i] = a[0]; continue; }
      if (t >= 1) { lut[i] = a[n]; continue; }

      const s = t * n;
      const j = Math.floor(s);
      const f = s - j;

      const p0 = a[j > 0 ? j - 1 : 0];
      const p1 = a[j];
      const p2 = a[j + 1];
      const p3 = a[j + 2 <= n ? j + 2 : n];

      const f2 = f * f, f3 = f2 * f;
      let w = 0.5 * (
        (2 * p1) +
        (-p0 + p2) * f +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * f3
      );

      /* clamp between the two bracketing samples: no overshoot */
      const lo = p1 < p2 ? p1 : p2;
      const hi = p1 > p2 ? p1 : p2;
      if (w < lo) w = lo;
      if (w > hi) w = hi;
      if (w < 0) w = 0;

      lut[i] = w;
    }
    out[key] = lut;
  }
  return out;
})();

function widthAt(key, t) {
  const lut = (typeof key === 'string') ? (PROFILE_LUT[key] || PROFILE_LUT.pr2) : null;

  if (lut) {
    if (t <= 0) return lut[0];
    if (t >= 1) return lut[PROFILE_LUT_SIZE];
    const s = t * PROFILE_LUT_SIZE;
    const i = s | 0;
    const f = s - i;
    return lut[i] + (lut[i + 1] - lut[i]) * f;
  }

  /* raw-array fallback — original Catmull-Rom path */
  const a = key;
  if (!a || !a.length) return 0;
  if (t <= 0) return a[0];
  if (t >= 1) return a[a.length - 1];

  const n = a.length - 1;
  const s = t * n;
  const i = Math.floor(s);
  const f = s - i;

  const p0 = a[i > 0 ? i - 1 : 0];
  const p1 = a[i];
  const p2 = a[i + 1];
  const p3 = a[i + 2 <= n ? i + 2 : n];

  const f2 = f * f, f3 = f2 * f;
  let w = 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f3);
  const lo = p1 < p2 ? p1 : p2;
  const hi = p1 > p2 ? p1 : p2;
  if (w < lo) w = lo;
  if (w > hi) w = hi;
  return w < 0 ? 0 : w;
}

/* Resample a profile into `n` evenly spaced points (LUT-backed) */
function sampleProfile(key, n = 32) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = widthAt(key, i / (n - 1));
  return out;
}

/* Smooth blend of two profiles — useful for stage morph animations */
function blendProfiles(keyA, keyB, t) {
  t = clamp01(t);
  const N = 24;
  const a = sampleProfile(keyA, N);
  if (t <= 0) return a;
  const b = sampleProfile(keyB, N);
  for (let i = 0; i < N; i++) a[i] += (b[i] - a[i]) * t;
  return a;
}

/* Position of maximum width along the body (0 = nose, 1 = tail) */
function profilePeak(key) {
  const lut = (typeof key === 'string') ? PROFILE_LUT[key] : null;
  if (lut) {
    let mi = 0, mv = lut[0];
    for (let i = 1; i <= PROFILE_LUT_SIZE; i++) if (lut[i] > mv) { mv = lut[i]; mi = i; }
    return mi / PROFILE_LUT_SIZE;
  }
  const a = key;
  if (!a || !a.length) return 0.5;
  let mi = 0, mv = a[0];
  for (let i = 1; i < a.length; i++) if (a[i] > mv) { mv = a[i]; mi = i; }
  return mi / (a.length - 1);
}

/* ================================================================
   8.  LINEAGES
   ----------------------------------------------------------------
   15 lineages, 4 stages each (stage 0 = fry → stage 3 = apex).

   Per-lineage:
     name / desc                 display strings
     spdMul  defMul  aggrMul     simulation multipliers
     visMul  stamMul
     flags: ambush, dash, swarm, apex, reflect, sting, lure
     visual defaults (overridable per stage):
       waveAmp, waveFreq, tailMult, tailWidth,
       finSpan, finFlap, dorsalPos, eyeScale,
       glowTint [r,g,b], accent

   Per-stage:
     { profile, shape, dorsal, color, aggr, size, ...overrides }

   shape  ∈ 'forked' | 'fan' | 'crescent' | 'spike'
   dorsal ∈ 'tiny' | 'spiny' | 'rear' | 'spike' | 'crest'
   ================================================================ */
const LINEAGES = {

  /* ------------------------------------------------------------ */
  predator: {
    name: 'PREDATOR',
    desc: 'Balanced · Pack hunter',
    spdMul: 1.00, defMul: 1.00, aggrMul: 1.00, visMul: 1.00, stamMul: 1.00,
    ambush: false, dash: false, swarm: true, apex: false,
    reflect: false, sting: false, lure: false,
    waveAmp: 1.00, waveFreq: 1.00, tailMult: 1.20, tailWidth: 1.00,
    finSpan: 1.00, finFlap: 1.00, dorsalPos: 0.35, eyeScale: 1.00,
    glowTint: [255, 255, 255], accent: '#ffffff',
    stages: [
      { profile: 'pr1', shape: 'forked',   dorsal: 'tiny',  color: '#9a9a9a', aggr: 0.40, size: 8,
        waveAmp: 1.05, tailMult: 1.10, eyeScale: 1.05 },
      { profile: 'pr2', shape: 'fan',      dorsal: 'spiny', color: '#c0c0c0', aggr: 0.60, size: 16,
        waveAmp: 1.00, tailMult: 1.20, dorsalPos: 0.38 },
      { profile: 'pr3', shape: 'forked',   dorsal: 'rear',  color: '#e0e0e0', aggr: 0.80, size: 30,
        waveAmp: 0.95, tailMult: 1.25, dorsalPos: 0.40 },
      { profile: 'pr4', shape: 'crescent', dorsal: 'spike', color: '#ffffff', aggr: 0.95, size: 60,
        waveAmp: 0.90, tailMult: 1.35, dorsalPos: 0.42, finSpan: 1.15 },
    ],
  },

  /* ------------------------------------------------------------ */
  swift: {
    name: 'SWIFT',
    desc: 'Fast · Hit and run',
    spdMul: 1.28, defMul: 0.95, aggrMul: 0.70, visMul: 1.05, stamMul: 0.55,
    ambush: false, dash: true, swarm: false, apex: false,
    reflect: false, sting: false, lure: false,
    waveAmp: 1.25, waveFreq: 1.25, tailMult: 1.35, tailWidth: 0.85,
    finSpan: 0.90, finFlap: 1.30, dorsalPos: 0.30, eyeScale: 0.95,
    glowTint: [200, 230, 255], accent: '#dff2ff',
    stages: [
      { profile: 'sw1', shape: 'forked',   dorsal: 'tiny', color: '#7fa8c8', aggr: 0.30, size: 6 },
      { profile: 'sw2', shape: 'forked',   dorsal: 'tiny', color: '#93c0e0', aggr: 0.50, size: 14 },
      { profile: 'sw3', shape: 'crescent', dorsal: 'rear', color: '#b6d8f2', aggr: 0.70, size: 28,
        waveFreq: 1.30, tailMult: 1.40 },
      { profile: 'sw4', shape: 'crescent', dorsal: 'rear', color: '#dff2ff', aggr: 0.85, size: 55,
        waveFreq: 1.35, tailMult: 1.45, finSpan: 0.95 },
    ],
  },

  /* ------------------------------------------------------------ */
  armor: {
    name: 'ARMOR',
    desc: 'Tanky · Slow bruiser',
    spdMul: 0.82, defMul: 1.22, aggrMul: 0.90, visMul: 0.95, stamMul: 1.10,
    ambush: false, dash: false, swarm: false, apex: false,
    reflect: true, sting: false, lure: false,
    waveAmp: 0.65, waveFreq: 0.80, tailMult: 0.95, tailWidth: 1.30,
    finSpan: 1.20, finFlap: 0.80, dorsalPos: 0.45, eyeScale: 0.85,
    glowTint: [255, 235, 200], accent: '#f6e5c8',
    stages: [
      { profile: 'ar1', shape: 'fan',   dorsal: 'tiny',  color: '#8a7f6a', aggr: 0.40, size: 8 },
      { profile: 'ar2', shape: 'fan',   dorsal: 'spiny', color: '#a89a80', aggr: 0.60, size: 18 },
      { profile: 'ar3', shape: 'spike', dorsal: 'spiny', color: '#c8b898', aggr: 0.80, size: 34,
        waveAmp: 0.60, finSpan: 1.30 },
      { profile: 'ar4', shape: 'spike', dorsal: 'spike', color: '#f6e5c8', aggr: 0.95, size: 70,
        waveAmp: 0.55, finSpan: 1.40, eyeScale: 0.80 },
    ],
  },

  /* ------------------------------------------------------------ */
  serpent: {
    name: 'SERPENT',
    desc: 'Long · Wide vision',
    spdMul: 0.95, defMul: 1.00, aggrMul: 0.85, visMul: 1.30, stamMul: 1.00,
    ambush: true, dash: false, swarm: false, apex: false,
    reflect: false, sting: false, lure: false,
    waveAmp: 1.15, waveFreq: 1.55, tailMult: 1.05, tailWidth: 0.75,
    finSpan: 0.75, finFlap: 1.10, dorsalPos: 0.55, eyeScale: 0.90,
    glowTint: [210, 255, 220], accent: '#dcffe4',
    stages: [
      { profile: 'se1', shape: 'forked',   dorsal: 'rear',  color: '#6f9a78', aggr: 0.40, size: 8 },
      { profile: 'se2', shape: 'forked',   dorsal: 'rear',  color: '#87b490', aggr: 0.60, size: 18 },
      { profile: 'se3', shape: 'forked',   dorsal: 'crest', color: '#a8d0b0', aggr: 0.75, size: 34,
        waveFreq: 1.60, dorsalPos: 0.55 },
      { profile: 'se4', shape: 'crescent', dorsal: 'crest', color: '#dcffe4', aggr: 0.90, size: 65,
        waveFreq: 1.65, waveAmp: 1.20, dorsalPos: 0.58 },
    ],
  },

  /* ------------------------------------------------------------ */
  abyss: {
    name: 'ABYSS',
    desc: 'Ambush · Huge jaws',
    spdMul: 0.88, defMul: 1.05, aggrMul: 1.05, visMul: 0.90, stamMul: 1.00,
    ambush: true, dash: false, swarm: false, apex: true,
    reflect: false, sting: false, lure: true,
    waveAmp: 0.80, waveFreq: 0.95, tailMult: 1.15, tailWidth: 1.15,
    finSpan: 1.10, finFlap: 0.90, dorsalPos: 0.50, eyeScale: 1.25,
    glowTint: [220, 180, 255], accent: '#e6c8ff',
    stages: [
      { profile: 'ab1', shape: 'forked',   dorsal: 'tiny',  color: '#6a5a80', aggr: 0.60, size: 8,
        eyeScale: 1.30 },
      { profile: 'ab2', shape: 'fan',      dorsal: 'spiny', color: '#8a76a8', aggr: 0.75, size: 18,
        eyeScale: 1.25 },
      { profile: 'ab3', shape: 'fan',      dorsal: 'spike', color: '#b09ad0', aggr: 0.90, size: 34,
        eyeScale: 1.20, waveAmp: 0.75 },
      { profile: 'ab4', shape: 'crescent', dorsal: 'spike', color: '#e6c8ff', aggr: 1.00, size: 70,
        eyeScale: 1.15, waveAmp: 0.70, tailMult: 1.20 },
    ],
  },

  /* ------------------------------------------------------------ */
  puffer: {
    name: 'PUFFER',
    desc: 'Inflates · Spiny defense',
    spdMul: 0.70, defMul: 1.45, aggrMul: 0.60, visMul: 0.90, stamMul: 1.20,
    ambush: false, dash: false, swarm: false, apex: false,
    reflect: true, sting: true, lure: false,
    waveAmp: 0.55, waveFreq: 1.10, tailMult: 0.70, tailWidth: 1.35,
    finSpan: 0.85, finFlap: 1.40, dorsalPos: 0.50, eyeScale: 1.15,
    glowTint: [255, 230, 160], accent: '#ffeeb0',
    stages: [
      { profile: 'pu1', shape: 'fan',   dorsal: 'tiny',  color: '#c8a040', aggr: 0.30, size: 7 },
      { profile: 'pu2', shape: 'fan',   dorsal: 'spiny', color: '#d8b45a', aggr: 0.45, size: 16 },
      { profile: 'pu3', shape: 'spike', dorsal: 'spiny', color: '#e8cc80', aggr: 0.60, size: 30,
        waveAmp: 0.50, finFlap: 1.50 },
      { profile: 'pu4', shape: 'spike', dorsal: 'spike', color: '#ffeeb0', aggr: 0.75, size: 58,
        waveAmp: 0.45, finFlap: 1.55, eyeScale: 1.20 },
    ],
  },

  /* ------------------------------------------------------------ */
  swordfish: {
    name: 'SWORDFISH',
    desc: 'Bill · Devastating dash',
    spdMul: 1.35, defMul: 0.95, aggrMul: 0.95, visMul: 1.10, stamMul: 0.65,
    ambush: false, dash: true, swarm: false, apex: true,
    reflect: false, sting: false, lure: false,
    waveAmp: 1.30, waveFreq: 1.15, tailMult: 1.45, tailWidth: 1.05,
    finSpan: 1.05, finFlap: 1.20, dorsalPos: 0.28, eyeScale: 1.00,
    glowTint: [180, 215, 255], accent: '#b8d8f0',
    stages: [
      { profile: 'sf1', shape: 'forked',   dorsal: 'tiny',  color: '#4a6a8a', aggr: 0.55, size: 8 },
      { profile: 'sf2', shape: 'forked',   dorsal: 'spiny', color: '#5e86ac', aggr: 0.70, size: 18 },
      { profile: 'sf3', shape: 'crescent', dorsal: 'crest', color: '#82a8cc', aggr: 0.85, size: 36,
        waveAmp: 1.35, tailMult: 1.50 },
      { profile: 'sf4', shape: 'crescent', dorsal: 'crest', color: '#b8d8f0', aggr: 1.00, size: 72,
        waveAmp: 1.40, tailMult: 1.55, finSpan: 1.15 },
    ],
  },

  /* ------------------------------------------------------------ */
  piranha: {
    name: 'PIRANHA',
    desc: 'Swarm · Frenzied bites',
    spdMul: 1.10, defMul: 0.85, aggrMul: 1.15, visMul: 1.00, stamMul: 0.85,
    ambush: false, dash: false, swarm: true, apex: false,
    reflect: false, sting: false, lure: false,
    waveAmp: 1.20, waveFreq: 1.40, tailMult: 1.00, tailWidth: 1.10,
    finSpan: 0.95, finFlap: 1.45, dorsalPos: 0.35, eyeScale: 1.10,
    glowTint: [255, 160, 160], accent: '#e88080',
    stages: [
      { profile: 'pi1', shape: 'forked', dorsal: 'tiny',  color: '#8a3030', aggr: 0.60, size: 5 },
      { profile: 'pi2', shape: 'forked', dorsal: 'spiny', color: '#a84040', aggr: 0.75, size: 11 },
      { profile: 'pi3', shape: 'forked', dorsal: 'spiny', color: '#c85858', aggr: 0.90, size: 20,
        waveFreq: 1.45, finFlap: 1.50 },
      { profile: 'pi4', shape: 'crescent', dorsal: 'spike', color: '#e88080', aggr: 1.05, size: 38,
        waveFreq: 1.50, finFlap: 1.55, eyeScale: 1.15 },
    ],
  },

  /* ------------------------------------------------------------ */
  angler: {
    name: 'ANGLER',
    desc: 'Lure · Deep ambusher',
    spdMul: 0.85, defMul: 1.00, aggrMul: 1.10, visMul: 0.80, stamMul: 1.05,
    ambush: true, dash: false, swarm: false, apex: false,
    reflect: false, sting: false, lure: true,
    waveAmp: 0.85, waveFreq: 0.90, tailMult: 0.90, tailWidth: 1.05,
    finSpan: 1.00, finFlap: 0.85, dorsalPos: 0.42, eyeScale: 1.30,
    glowTint: [200, 170, 255], accent: '#9a86a8',
    stages: [
      { profile: 'an1', shape: 'fan',      dorsal: 'tiny',  color: '#3a3040', aggr: 0.65, size: 7,
        eyeScale: 1.35 },
      { profile: 'an2', shape: 'fan',      dorsal: 'spiny', color: '#4e4258', aggr: 0.80, size: 15,
        eyeScale: 1.30 },
      { profile: 'an3', shape: 'spike',    dorsal: 'spike', color: '#6a5a78', aggr: 0.95, size: 30,
        eyeScale: 1.25, waveAmp: 0.80 },
      { profile: 'an4', shape: 'crescent', dorsal: 'spike', color: '#9a86a8', aggr: 1.05, size: 62,
        eyeScale: 1.20, waveAmp: 0.75, tailMult: 0.95 },
    ],
  },

  /* ------------------------------------------------------------ */
  manta: {
    name: 'MANTA',
    desc: 'Glider · Wide wings',
    spdMul: 1.05, defMul: 1.10, aggrMul: 0.70, visMul: 1.15, stamMul: 1.15,
    ambush: false, dash: false, swarm: false, apex: true,
    reflect: false, sting: false, lure: false,
    waveAmp: 0.70, waveFreq: 0.65, tailMult: 1.60, tailWidth: 0.55,
    finSpan: 1.80, finFlap: 0.55, dorsalPos: 0.20, eyeScale: 0.95,
    glowTint: [170, 220, 240], accent: '#7cb0c8',
    stages: [
      { profile: 'mn1', shape: 'fan',      dorsal: 'tiny',  color: '#2e4a5a', aggr: 0.35, size: 10 },
      { profile: 'mn2', shape: 'fan',      dorsal: 'tiny',  color: '#3e6274', aggr: 0.50, size: 22 },
      { profile: 'mn3', shape: 'crescent', dorsal: 'rear',  color: '#56889c', aggr: 0.60, size: 42,
        finSpan: 1.90, waveFreq: 0.60 },
      { profile: 'mn4', shape: 'crescent', dorsal: 'rear',  color: '#7cb0c8', aggr: 0.75, size: 72,
        finSpan: 2.00, waveFreq: 0.55, waveAmp: 0.65 },
    ],
  },

  /* ------------------------------------------------------------ */
  eel: {
    name: 'EEL',
    desc: 'Ribbon · Electric ambush',
    spdMul: 0.90, defMul: 1.05, aggrMul: 0.90, visMul: 1.20, stamMul: 1.00,
    ambush: true, dash: false, swarm: false, apex: false,
    reflect: false, sting: true, lure: false,
    waveAmp: 1.35, waveFreq: 1.75, tailMult: 0.85, tailWidth: 0.60,
    finSpan: 0.55, finFlap: 1.25, dorsalPos: 0.60, eyeScale: 0.85,
    glowTint: [200, 255, 190], accent: '#a0b880',
    stages: [
      { profile: 'ee1', shape: 'forked',   dorsal: 'crest', color: '#4a5a3a', aggr: 0.45, size: 7 },
      { profile: 'ee2', shape: 'forked',   dorsal: 'crest', color: '#5e7248', aggr: 0.60, size: 16 },
      { profile: 'ee3', shape: 'crescent', dorsal: 'crest', color: '#7a9260', aggr: 0.75, size: 32,
        waveFreq: 1.80, waveAmp: 1.40 },
      { profile: 'ee4', shape: 'crescent', dorsal: 'crest', color: '#a0b880', aggr: 0.90, size: 64,
        waveFreq: 1.85, waveAmp: 1.45, finFlap: 1.30 },
    ],
  },

  /* ------------------------------------------------------------ */
  jelly: {
    name: 'JELLY',
    desc: 'Drifter · Numbing sting',
    spdMul: 0.65, defMul: 1.30, aggrMul: 0.55, visMul: 1.00, stamMul: 1.30,
    ambush: false, dash: false, swarm: false, apex: false,
    reflect: false, sting: true, lure: false,
    waveAmp: 0.45, waveFreq: 1.30, tailMult: 0.55, tailWidth: 0.45,
    finSpan: 0.40, finFlap: 1.60, dorsalPos: 0.15, eyeScale: 0.70,
    glowTint: [235, 190, 255], accent: '#f0d8f8',
    stages: [
      { profile: 'je1', shape: 'fan',   dorsal: 'tiny', color: '#b080c0', aggr: 0.25, size: 6 },
      { profile: 'je2', shape: 'fan',   dorsal: 'tiny', color: '#c49ad0', aggr: 0.40, size: 14 },
      { profile: 'je3', shape: 'fan',   dorsal: 'rear', color: '#d8b4e0', aggr: 0.55, size: 26,
        waveAmp: 0.40, waveFreq: 1.35 },
      { profile: 'je4', shape: 'spike', dorsal: 'rear', color: '#f0d8f8', aggr: 0.70, size: 50,
        waveAmp: 0.38, waveFreq: 1.40, finFlap: 1.70 },
    ],
  },

  /* ------------------------------------------------------------ */
  barracuda: {
    name: 'BARRACUDA',
    desc: 'Pike · Lightning strike',
    spdMul: 1.30, defMul: 0.90, aggrMul: 1.10, visMul: 1.05, stamMul: 0.60,
    ambush: true, dash: true, swarm: false, apex: true,
    reflect: false, sting: false, lure: false,
    waveAmp: 1.15, waveFreq: 1.20, tailMult: 1.30, tailWidth: 0.80,
    finSpan: 0.85, finFlap: 1.25, dorsalPos: 0.30, eyeScale: 1.05,
    glowTint: [200, 225, 200], accent: '#b8ccb8',
    stages: [
      { profile: 'ba1', shape: 'forked',   dorsal: 'tiny',  color: '#5a6a5a', aggr: 0.60, size: 8 },
      { profile: 'ba2', shape: 'forked',   dorsal: 'spiny', color: '#728472', aggr: 0.75, size: 17 },
      { profile: 'ba3', shape: 'crescent', dorsal: 'crest', color: '#90a490', aggr: 0.90, size: 34,
        waveAmp: 1.20, tailMult: 1.35 },
      { profile: 'ba4', shape: 'crescent', dorsal: 'crest', color: '#b8ccb8', aggr: 1.05, size: 68,
        waveAmp: 1.25, tailMult: 1.40, finSpan: 0.95 },
    ],
  },

  /* ------------------------------------------------------------ */
  koi: {
    name: 'KOI',
    desc: 'Enduring · Calm and hardy',
    spdMul: 0.90, defMul: 1.15, aggrMul: 0.45, visMul: 1.10, stamMul: 1.20,
    ambush: false, dash: false, swarm: true, apex: false,
    reflect: false, sting: false, lure: false,
    waveAmp: 0.90, waveFreq: 0.90, tailMult: 1.05, tailWidth: 1.20,
    finSpan: 1.15, finFlap: 1.00, dorsalPos: 0.40, eyeScale: 0.95,
    glowTint: [255, 210, 170], accent: '#ffd0a0',
    stages: [
      { profile: 'ko1', shape: 'fan',      dorsal: 'tiny',  color: '#d07040', aggr: 0.20, size: 8 },
      { profile: 'ko2', shape: 'fan',      dorsal: 'spiny', color: '#e08850', aggr: 0.35, size: 18 },
      { profile: 'ko3', shape: 'fan',      dorsal: 'rear',  color: '#f0a068', aggr: 0.50, size: 34,
        waveAmp: 0.85, finSpan: 1.20 },
      { profile: 'ko4', shape: 'crescent', dorsal: 'rear',  color: '#ffd0a0', aggr: 0.65, size: 66,
        waveAmp: 0.80, finSpan: 1.30, tailMult: 1.15 },
    ],
  },

  /* ------------------------------------------------------------ */
  leviathan: {
    name: 'LEVIATHAN',
    desc: 'Apex · Colossal terror',
    spdMul: 0.95, defMul: 1.35, aggrMul: 1.20, visMul: 1.25, stamMul: 1.40,
    ambush: true, dash: false, swarm: false, apex: true,
    reflect: true, sting: false, lure: false,
    waveAmp: 0.85, waveFreq: 0.75, tailMult: 1.40, tailWidth: 1.35,
    finSpan: 1.35, finFlap: 0.80, dorsalPos: 0.45, eyeScale: 1.20,
    glowTint: [150, 200, 255], accent: '#7a9cb8',
    stages: [
      { profile: 'le1', shape: 'forked',   dorsal: 'tiny',  color: '#2a3a4a', aggr: 0.70, size: 10 },
      { profile: 'le2', shape: 'fan',      dorsal: 'spiny', color: '#3c5062', aggr: 0.85, size: 24 },
      { profile: 'le3', shape: 'spike',    dorsal: 'spike', color: '#54708a', aggr: 1.00, size: 44,
        waveAmp: 0.80, finSpan: 1.40 },
      { profile: 'le4', shape: 'crescent', dorsal: 'spike', color: '#7a9cb8', aggr: 1.20, size: 72,
        waveAmp: 0.75, finSpan: 1.50, tailMult: 1.45, eyeScale: 1.25 },
    ],
  },
};

/* Object.keys order defines spawn-table order and UI order. */
const LINEAGE_KEYS = Object.keys(LINEAGES);

/* ----------------------------------------------------------------
   8a.  Pre-built stage thresholds  →  O(1) stageForSize
   ---------------------------------------------------------------- */
const STAGE_THRESHOLDS = (() => {
  const out = {};
  for (const lk in LINEAGES) {
    const s = LINEAGES[lk].stages;
    out[lk] = [s[1].size, s[2].size, s[3].size];
  }
  return out;
})();

/* ----------------------------------------------------------------
   8b.  Merged visual params  →  one frozen record per stage
   ----------------------------------------------------------------
   Precedence: VISUAL_DEFAULTS  <  lineage  <  stage

   15 lineages × 4 stages = 60 records, built once at load.
   ---------------------------------------------------------------- */
const VISUAL_DEFAULTS = {
  waveAmp: 1.00,
  waveFreq: 1.00,
  tailMult: 1.00,
  tailWidth: 1.00,
  finSpan: 1.00,
  finFlap: 1.00,
  dorsalPos: 0.40,
  eyeScale: 1.00,
  glowTint: [255, 255, 255],
  accent: '#ffffff',
};

/* Clone array values so frozen records never share mutable refs. */
const cloneVisVal = (val) => Array.isArray(val) ? val.slice() : val;

const STAGE_PARAMS = (() => {
  const out = {};
  for (const lk in LINEAGES) {
    const L = LINEAGES[lk];
    out[lk] = L.stages.map((st) => {
      const merged = {};
      /* defaults → lineage → stage */
      for (const k in VISUAL_DEFAULTS) merged[k] = cloneVisVal(VISUAL_DEFAULTS[k]);
      for (const k in VISUAL_DEFAULTS) if (L[k] !== undefined)  merged[k] = cloneVisVal(L[k]);
      for (const k in VISUAL_DEFAULTS) if (st[k] !== undefined) merged[k] = cloneVisVal(st[k]);
      /* carry the sim-relevant fields straight through */
      merged.profile = st.profile;
      merged.shape   = st.shape;
      merged.dorsal  = st.dorsal;
      merged.color   = st.color;
      merged.aggr    = st.aggr;
      merged.size    = st.size;
      return Object.freeze(merged);
    });
  }
  return out;
})();

/* ================================================================
   9.  ACCESSORS
   ================================================================ */
function getLineage(key) {
  return LINEAGES[key] || LINEAGES[PLAYER_LINEAGE];
}

function getStage(lineageKey, idx) {
  const L = getLineage(lineageKey);
  return L.stages[clamp(idx | 0, 0, L.stages.length - 1)];
}

/* Stage index (0..3) that best fits this size for this lineage. */
function stageForSize(lineageKey, size) {
  const th = STAGE_THRESHOLDS[lineageKey] || STAGE_THRESHOLDS[PLAYER_LINEAGE];
  if (size < th[0]) return 0;
  if (size < th[1]) return 1;
  if (size < th[2]) return 2;
  return 3;
}

/* Stage record (raw, still with the fallback chain) — legacy API. */
function lineageStageData(lineageKey, size) {
  const L = getLineage(lineageKey);
  return L.stages[stageForSize(lineageKey, size)];
}

/* Cached merged visual record — this is the one the renderer
   should use in hot loops: stage → lineage → default resolved once,
   frozen, no allocation, single lookup per fish per frame. */
function resolveVisualParams(lineageKey, size) {
  const stages = STAGE_PARAMS[lineageKey] || STAGE_PARAMS[PLAYER_LINEAGE];
  return stages[stageForSize(lineageKey, size)];
}

/* Legacy single-param accessor — still works, now LUT-fast. */
function visualParam(lineageKey, size, param, fallback = 1.0) {
  const p = resolveVisualParams(lineageKey, size)[param];
  return p !== undefined ? p : fallback;
}

/* ================================================================
   10.  EXPORTS
   ----------------------------------------------------------------
   Drop-in as a classic script (globalThis) or swap for ES module
   `export { … }` if the project uses a bundler.
   ================================================================ */
if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, {
    /* vectors + math */
    v, clamp, clamp01, lerp, invLerp, remap,
    smoothstep, smootherstep,
    easeOutCubic, easeInCubic, easeInOutCubic,
    easeOutQuad, easeInQuad, easeOutSine, easeInSine,
    rand, rInt, sign, approach,
    wrapA, wrapAFast, angleDiff, angleLerp,
    TAU, HALF_PI,

    /* palette */
    PLAYER_COLOR, PLAYER_GLOW, PLAYER_DARK, PLAYER_LINEAGE,

    /* config + names */
    CFG, STAGE_NAMES, STAGE_SIZES,

    /* profiles (LUT-backed) */
    PROFILES, PROFILE_LUT, PROFILE_LUT_SIZE,
    widthAt, sampleProfile, blendProfiles, profilePeak,

    /* lineages */
    LINEAGES, LINEAGE_KEYS,
    STAGE_THRESHOLDS, VISUAL_DEFAULTS, STAGE_PARAMS,
    getLineage, getStage, stageForSize, lineageStageData,
    visualParam, resolveVisualParams,
  });
}