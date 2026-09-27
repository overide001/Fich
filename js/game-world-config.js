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
    undulateAmp: 0.055,
    undulateAmpMoving: 0.075,
    undulateSpeed: 6.0,
    undulateFreq: 3.4,
    undulateFreqFast: 5.2,
    idleMotion: 0.35,
    tailLag: 0.95,
    tailSweepBase: 0.10,
    tailSweepMax: 0.28,
    tailSweepSpeed: 0.0055,
    tailRipple: 0.12,
    finFlapIdle: 1.6,
    finFlapCruise: 2.2,
    finFlapChase: 2.8,
    finFlapFlee: 3.6,
    finFlapStalk: 1.2,
    finFlapAmpIdle: 0.30,
    finFlapAmpChase: 0.55,
    finFlapAmpFlee: 0.65,
    finFlapAmpStalk: 0.18,
    dorsalSway: 0.10,
    dorsalSwayFreq: 1.35,
    eyeBlinkMin: 2.5,
    eyeBlinkMax: 7.0,
    pupilTrack: 0.30,
    breatheAmp: 0.020,
    breatheFreq: 2.1,
    glowPulseAmp: 0.15,
    glowPulseFreq: 2.6,
    evoRingCount: 3,
    evoRingReach: 5.0,
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
   Index 0 = nose, index 11 = tail peduncle.  Every lineage's curve
   is a genuinely different silhouette CLASS, not a scaled copy:

     pr  fusiform  — classic torpedo, symmetric rise/fall, mid peak
     sw  spindle   — mass shifted to 25–30%, thin rear, needle nose
     ar  boxy      — near-constant width 15–65%, blunt drop-off
     se  ribbon-lt — very low, slight swelling at 40–60%, no peak
     ab  jaw       — peak at 5–10% (head), steep straight taper
     pu  disc      — wide plateau 30–70%, abrupt stub-tail
     sf  bill      — near-zero 0–15% (bill), sudden rise, mid mass
     pi  blunt-disc— blunt high nose, deep mid, shorter than puffer
     an  bell-jaw  — peak AT THE NOSE, long thin trailing rear third
     mn  diamond   — thin core, wide mid (wings are finSpan, not width)
     ee  ribbon    — near-constant thin line, lowest variation of all
     je  bell      — fat rounded dome 0–25%, long thin tendril rear
     ba  pike      — nearly straight, uniform, sharpest/leanest
     ko  oval      — smooth full-body oval, thick tail base, no points
     le  colossus  — thick through 70%, heavy tail base, huge overall
   ================================================================ */
const PROFILES = {
  /* predator — classic torpedo, peak at 40% */
  pr1: [0.06, 0.18, 0.28, 0.36, 0.40, 0.40, 0.36, 0.28, 0.20, 0.12, 0.05, 0.02],
  pr2: [0.07, 0.22, 0.36, 0.48, 0.54, 0.54, 0.48, 0.38, 0.27, 0.16, 0.07, 0.02],
  pr3: [0.08, 0.24, 0.40, 0.52, 0.60, 0.60, 0.54, 0.42, 0.30, 0.18, 0.08, 0.03],
  pr4: [0.09, 0.26, 0.44, 0.58, 0.68, 0.68, 0.60, 0.48, 0.34, 0.20, 0.09, 0.03],

  /* swift — thin, mass forward at ~27%, very lean rear */
  sw1: [0.04, 0.12, 0.19, 0.22, 0.20, 0.17, 0.13, 0.09, 0.06, 0.03, 0.02, 0.01],
  sw2: [0.05, 0.15, 0.23, 0.27, 0.25, 0.21, 0.16, 0.11, 0.07, 0.04, 0.02, 0.01],
  sw3: [0.06, 0.18, 0.28, 0.33, 0.31, 0.26, 0.20, 0.14, 0.09, 0.05, 0.02, 0.01],
  sw4: [0.07, 0.21, 0.33, 0.39, 0.37, 0.31, 0.24, 0.17, 0.11, 0.06, 0.03, 0.01],

  /* armor — boxy, plateau 15–65%, blunt drop-off */
  ar1: [0.14, 0.26, 0.32, 0.34, 0.35, 0.35, 0.34, 0.32, 0.26, 0.16, 0.07, 0.02],
  ar2: [0.16, 0.30, 0.38, 0.42, 0.43, 0.43, 0.42, 0.39, 0.32, 0.20, 0.09, 0.03],
  ar3: [0.18, 0.34, 0.44, 0.48, 0.50, 0.50, 0.48, 0.44, 0.36, 0.24, 0.10, 0.03],
  ar4: [0.20, 0.38, 0.50, 0.54, 0.56, 0.56, 0.54, 0.50, 0.42, 0.28, 0.12, 0.04],

  /* serpent — near-flat, gentle swell 40–60%, no real peak */
  se1: [0.06, 0.08, 0.10, 0.11, 0.12, 0.13, 0.12, 0.11, 0.09, 0.07, 0.04, 0.02],
  se2: [0.07, 0.10, 0.12, 0.14, 0.15, 0.16, 0.15, 0.13, 0.11, 0.08, 0.05, 0.02],
  se3: [0.08, 0.12, 0.15, 0.17, 0.19, 0.20, 0.19, 0.16, 0.13, 0.10, 0.06, 0.03],
  se4: [0.09, 0.14, 0.18, 0.21, 0.23, 0.24, 0.22, 0.19, 0.15, 0.11, 0.07, 0.03],

  /* abyss — huge head, peak at 5–10%, long straight taper to thin tail */
  ab1: [0.20, 0.30, 0.32, 0.29, 0.24, 0.19, 0.15, 0.11, 0.08, 0.05, 0.03, 0.01],
  ab2: [0.26, 0.40, 0.44, 0.40, 0.33, 0.26, 0.20, 0.15, 0.11, 0.07, 0.04, 0.01],
  ab3: [0.30, 0.46, 0.50, 0.46, 0.38, 0.30, 0.23, 0.17, 0.12, 0.08, 0.04, 0.02],
  ab4: [0.34, 0.52, 0.58, 0.53, 0.44, 0.35, 0.27, 0.20, 0.14, 0.09, 0.05, 0.02],

  /* puffer — disc, plateau 30–70%, abrupt stub tail */
  pu1: [0.12, 0.28, 0.42, 0.52, 0.56, 0.56, 0.52, 0.42, 0.30, 0.18, 0.07, 0.02],
  pu2: [0.14, 0.32, 0.48, 0.60, 0.64, 0.64, 0.60, 0.48, 0.34, 0.20, 0.08, 0.02],
  pu3: [0.16, 0.36, 0.54, 0.68, 0.72, 0.72, 0.68, 0.54, 0.38, 0.22, 0.09, 0.02],
  pu4: [0.18, 0.40, 0.60, 0.76, 0.80, 0.80, 0.76, 0.60, 0.42, 0.24, 0.10, 0.02],

  /* swordfish — bill 0–15%, sudden rise, deep mid, thin whip tail */
  sf1: [0.01, 0.02, 0.10, 0.22, 0.30, 0.32, 0.28, 0.22, 0.15, 0.09, 0.04, 0.01],
  sf2: [0.01, 0.03, 0.14, 0.30, 0.40, 0.44, 0.38, 0.30, 0.20, 0.12, 0.05, 0.01],
  sf3: [0.01, 0.04, 0.18, 0.38, 0.50, 0.54, 0.48, 0.38, 0.26, 0.15, 0.06, 0.02],
  sf4: [0.02, 0.05, 0.22, 0.46, 0.60, 0.64, 0.58, 0.46, 0.32, 0.18, 0.08, 0.02],

  /* piranha — blunt high nose, deep disc, steep rear drop */
  pi1: [0.18, 0.36, 0.48, 0.54, 0.54, 0.50, 0.42, 0.32, 0.22, 0.13, 0.05, 0.01],
  pi2: [0.20, 0.40, 0.54, 0.62, 0.62, 0.56, 0.46, 0.34, 0.23, 0.13, 0.05, 0.01],
  pi3: [0.22, 0.44, 0.60, 0.68, 0.68, 0.60, 0.48, 0.35, 0.24, 0.13, 0.05, 0.01],
  pi4: [0.24, 0.48, 0.66, 0.74, 0.74, 0.64, 0.50, 0.36, 0.24, 0.13, 0.05, 0.01],

  /* angler — bulbous head, peak AT THE NOSE, long thin rear third */
  an1: [0.26, 0.36, 0.34, 0.28, 0.22, 0.17, 0.13, 0.10, 0.07, 0.05, 0.03, 0.01],
  an2: [0.32, 0.44, 0.42, 0.35, 0.27, 0.21, 0.16, 0.12, 0.09, 0.06, 0.03, 0.01],
  an3: [0.36, 0.50, 0.48, 0.40, 0.31, 0.24, 0.18, 0.14, 0.10, 0.06, 0.03, 0.01],
  an4: [0.40, 0.56, 0.54, 0.45, 0.35, 0.27, 0.20, 0.15, 0.11, 0.07, 0.04, 0.01],

  /* manta — thin body core; the WINGS come from finSpan, not width */
  mn1: [0.05, 0.10, 0.16, 0.20, 0.22, 0.22, 0.20, 0.16, 0.11, 0.07, 0.04, 0.02],
  mn2: [0.06, 0.13, 0.20, 0.26, 0.28, 0.28, 0.26, 0.20, 0.14, 0.09, 0.05, 0.02],
  mn3: [0.07, 0.16, 0.25, 0.32, 0.35, 0.35, 0.32, 0.25, 0.17, 0.11, 0.06, 0.02],
  mn4: [0.08, 0.19, 0.30, 0.38, 0.42, 0.42, 0.38, 0.30, 0.20, 0.13, 0.07, 0.03],

  /* eel — uniform thin ribbon, near-zero variation */
  ee1: [0.05, 0.06, 0.07, 0.08, 0.08, 0.08, 0.08, 0.07, 0.07, 0.06, 0.05, 0.03],
  ee2: [0.06, 0.07, 0.08, 0.09, 0.10, 0.10, 0.09, 0.09, 0.08, 0.07, 0.06, 0.03],
  ee3: [0.07, 0.08, 0.10, 0.11, 0.12, 0.12, 0.11, 0.11, 0.10, 0.09, 0.07, 0.04],
  ee4: [0.08, 0.10, 0.12, 0.13, 0.14, 0.14, 0.13, 0.13, 0.12, 0.10, 0.08, 0.04],

  /* jelly — fat rounded dome 0–25%, long thin tendril rear */
  je1: [0.20, 0.36, 0.42, 0.40, 0.30, 0.20, 0.13, 0.08, 0.05, 0.03, 0.02, 0.01],
  je2: [0.24, 0.42, 0.50, 0.46, 0.35, 0.23, 0.15, 0.09, 0.06, 0.04, 0.02, 0.01],
  je3: [0.28, 0.48, 0.58, 0.54, 0.40, 0.27, 0.17, 0.11, 0.07, 0.04, 0.02, 0.01],
  je4: [0.32, 0.54, 0.66, 0.60, 0.45, 0.30, 0.19, 0.12, 0.08, 0.05, 0.03, 0.01],

  /* barracuda — long, uniform, nearly straight, sharpest lean */
  ba1: [0.04, 0.10, 0.14, 0.16, 0.16, 0.15, 0.13, 0.11, 0.09, 0.06, 0.04, 0.01],
  ba2: [0.05, 0.12, 0.17, 0.20, 0.20, 0.19, 0.16, 0.13, 0.11, 0.08, 0.05, 0.02],
  ba3: [0.06, 0.14, 0.21, 0.24, 0.24, 0.22, 0.19, 0.16, 0.13, 0.09, 0.05, 0.02],
  ba4: [0.07, 0.17, 0.25, 0.28, 0.28, 0.26, 0.22, 0.18, 0.15, 0.10, 0.06, 0.02],

  /* koi — smooth full oval, thick tail base, no sharp features */
  ko1: [0.10, 0.24, 0.36, 0.44, 0.48, 0.48, 0.44, 0.38, 0.30, 0.22, 0.14, 0.06],
  ko2: [0.12, 0.28, 0.42, 0.52, 0.56, 0.56, 0.52, 0.44, 0.36, 0.26, 0.16, 0.07],
  ko3: [0.13, 0.30, 0.46, 0.58, 0.64, 0.64, 0.58, 0.50, 0.40, 0.30, 0.18, 0.08],
  ko4: [0.14, 0.32, 0.50, 0.64, 0.72, 0.72, 0.64, 0.56, 0.46, 0.34, 0.20, 0.09],

  /* leviathan — thick through 70%, heavy tail base, huge overall */
  le1: [0.16, 0.32, 0.44, 0.50, 0.52, 0.52, 0.50, 0.46, 0.40, 0.30, 0.18, 0.07],
  le2: [0.20, 0.40, 0.54, 0.62, 0.66, 0.66, 0.62, 0.56, 0.48, 0.36, 0.22, 0.09],
  le3: [0.24, 0.46, 0.62, 0.72, 0.76, 0.76, 0.72, 0.64, 0.54, 0.40, 0.24, 0.10],
  le4: [0.28, 0.52, 0.70, 0.82, 0.88, 0.88, 0.82, 0.74, 0.62, 0.46, 0.28, 0.11],
};

/* ================================================================
   7.  PROFILE SAMPLING
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

function sampleProfile(key, n = 32) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = widthAt(key, i / (n - 1));
  return out;
}

function blendProfiles(keyA, keyB, t) {
  t = clamp01(t);
  const N = 24;
  const a = sampleProfile(keyA, N);
  if (t <= 0) return a;
  const b = sampleProfile(keyB, N);
  for (let i = 0; i < N; i++) a[i] += (b[i] - a[i]) * t;
  return a;
}

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
   Numeric trait flags (read as multipliers by fish-behavior.js):
     dash    — speed multiplier applied during ATTACK; 0/false disables
     reflect — fraction of incoming damage reflected to the attacker
     sting   — fraction of incoming damage added as bleeding on attacker
   Boolean trait flags (read as plain booleans):
     ambush, swarm, apex, lure

   Visual params (per lineage and per stage overrides):
     shape      — tail silhouette ('forked'|'fan'|'crescent'|'spike')
     dorsal     — dorsal style ('tiny'|'spiny'|'rear'|'spike'|'crest')
     tailMult   — tail length multiplier
     tailWidth  — tail thickness multiplier
     finSpan    — pectoral / wing span multiplier
     dorsalPos  — dorsal position along the spine (0 = nose, 1 = tail)
     waveAmp, waveFreq, finFlap, eyeScale — animation + face
   ================================================================ */
const LINEAGES = {

  /* ------------------------------------------------------------
     PREDATOR — classic torpedo, forked tail, mid dorsal.
     ------------------------------------------------------------ */
  predator: {
    name: 'PREDATOR',
    desc: 'Balanced · Pack hunter',
    spdMul: 1.00, defMul: 1.00, aggrMul: 1.00, visMul: 1.00, stamMul: 1.00,
    ambush: false, dash: false, swarm: true, apex: false,
    reflect: false, sting: false, lure: false,
    waveAmp: 1.00, waveFreq: 1.00, tailMult: 1.25, tailWidth: 1.00,
    finSpan: 1.00, finFlap: 1.00, dorsalPos: 0.38, eyeScale: 1.00,
    glowTint: [255, 255, 255], accent: '#ffffff',
    stages: [
      { profile: 'pr1', shape: 'forked',   dorsal: 'tiny',  color: '#9a9a9a', aggr: 0.40, size: 8,
        tailMult: 1.10, tailWidth: 0.90, finSpan: 0.85, dorsalPos: 0.34 },
      { profile: 'pr2', shape: 'forked',   dorsal: 'spiny', color: '#c0c0c0', aggr: 0.60, size: 16,
        tailMult: 1.20, tailWidth: 1.00, finSpan: 1.00, dorsalPos: 0.36 },
      { profile: 'pr3', shape: 'forked',   dorsal: 'rear',  color: '#e0e0e0', aggr: 0.80, size: 30,
        tailMult: 1.30, tailWidth: 1.05, finSpan: 1.10, dorsalPos: 0.40 },
      { profile: 'pr4', shape: 'crescent', dorsal: 'spike', color: '#ffffff', aggr: 0.95, size: 60,
        tailMult: 1.40, tailWidth: 1.15, finSpan: 1.20, dorsalPos: 0.42 },
    ],
  },

  /* ------------------------------------------------------------
     SWIFT — needle-thin, mass forward, small fins, DEEPLY forked tail.
     Fork is long AND narrow so it reads as scissors, not a fan.
     ------------------------------------------------------------ */
  swift: {
    name: 'SWIFT',
    desc: 'Fast · Hit and run',
    spdMul: 1.28, defMul: 0.95, aggrMul: 0.70, visMul: 1.05, stamMul: 0.55,
    ambush: false, dash: 1.45, swarm: false, apex: false,
    reflect: false, sting: false, lure: false,
    waveAmp: 1.30, waveFreq: 1.35, tailMult: 1.75, tailWidth: 0.55,
    finSpan: 0.55, finFlap: 1.40, dorsalPos: 0.24, eyeScale: 0.95,
    glowTint: [200, 230, 255], accent: '#dff2ff',
    stages: [
      { profile: 'sw1', shape: 'forked', dorsal: 'tiny', color: '#7fa8c8', aggr: 0.30, size: 6,
        tailMult: 1.60, tailWidth: 0.50, finSpan: 0.45, dorsalPos: 0.22 },
      { profile: 'sw2', shape: 'forked', dorsal: 'tiny', color: '#93c0e0', aggr: 0.50, size: 14,
        tailMult: 1.70, tailWidth: 0.55, finSpan: 0.50, dorsalPos: 0.23 },
      { profile: 'sw3', shape: 'forked', dorsal: 'rear', color: '#b6d8f2', aggr: 0.70, size: 28,
        tailMult: 1.80, tailWidth: 0.55, finSpan: 0.55, dorsalPos: 0.24, waveFreq: 1.40 },
      { profile: 'sw4', shape: 'forked', dorsal: 'rear', color: '#dff2ff', aggr: 0.85, size: 55,
        tailMult: 1.90, tailWidth: 0.60, finSpan: 0.60, dorsalPos: 0.25, waveFreq: 1.45 },
    ],
  },

  /* ------------------------------------------------------------
     ARMOR — boxy. Thick body, wide blunt fan tail, LONG thick spiky
     dorsal that runs most of the back.
     ------------------------------------------------------------ */
  armor: {
    name: 'ARMOR',
    desc: 'Tanky · Slow bruiser',
    spdMul: 0.82, defMul: 1.22, aggrMul: 0.90, visMul: 0.95, stamMul: 1.10,
    ambush: false, dash: false, swarm: false, apex: false,
    reflect: 0.20, sting: false, lure: false,
    waveAmp: 0.65, waveFreq: 0.80, tailMult: 0.70, tailWidth: 1.65,
    finSpan: 1.25, finFlap: 0.75, dorsalPos: 0.38, eyeScale: 0.85,
    glowTint: [255, 235, 200], accent: '#f6e5c8',
    stages: [
      { profile: 'ar1', shape: 'fan',   dorsal: 'spiny', color: '#8a7f6a', aggr: 0.40, size: 8,
        tailMult: 0.65, tailWidth: 1.50, finSpan: 1.10, dorsalPos: 0.34 },
      { profile: 'ar2', shape: 'fan',   dorsal: 'spiny', color: '#a89a80', aggr: 0.60, size: 18,
        tailMult: 0.70, tailWidth: 1.60, finSpan: 1.20, dorsalPos: 0.36 },
      { profile: 'ar3', shape: 'fan',   dorsal: 'spiny', color: '#c8b898', aggr: 0.80, size: 34,
        tailMult: 0.72, tailWidth: 1.70, finSpan: 1.30, dorsalPos: 0.38, waveAmp: 0.60 },
      { profile: 'ar4', shape: 'fan',   dorsal: 'spike', color: '#f6e5c8', aggr: 0.95, size: 70,
        tailMult: 0.75, tailWidth: 1.80, finSpan: 1.40, dorsalPos: 0.40, waveAmp: 0.55, eyeScale: 0.80 },
    ],
  },

  /* ------------------------------------------------------------
     SERPENT — long low ribbon. NO real tail (small forked), long
     low continuous crest running the WHOLE back.
     ------------------------------------------------------------ */
  serpent: {
    name: 'SERPENT',
    desc: 'Long · Wide vision',
    spdMul: 0.95, defMul: 1.00, aggrMul: 0.85, visMul: 1.30, stamMul: 1.00,
    ambush: true, dash: false, swarm: false, apex: false,
    reflect: false, sting: false, lure: false,
    waveAmp: 1.20, waveFreq: 1.65, tailMult: 0.55, tailWidth: 0.45,
    finSpan: 0.55, finFlap: 1.05, dorsalPos: 0.52, eyeScale: 0.90,
    glowTint: [210, 255, 220], accent: '#dcffe4',
    stages: [
      { profile: 'se1', shape: 'forked',   dorsal: 'crest', color: '#6f9a78', aggr: 0.40, size: 8,
        tailMult: 0.50, tailWidth: 0.40, finSpan: 0.50, dorsalPos: 0.50 },
      { profile: 'se2', shape: 'forked',   dorsal: 'crest', color: '#87b490', aggr: 0.60, size: 18,
        tailMult: 0.55, tailWidth: 0.45, finSpan: 0.55, dorsalPos: 0.52 },
      { profile: 'se3', shape: 'crescent', dorsal: 'crest', color: '#a8d0b0', aggr: 0.75, size: 34,
        tailMult: 0.60, tailWidth: 0.50, finSpan: 0.60, dorsalPos: 0.54, waveFreq: 1.70 },
      { profile: 'se4', shape: 'crescent', dorsal: 'crest', color: '#dcffe4', aggr: 0.90, size: 65,
        tailMult: 0.65, tailWidth: 0.55, finSpan: 0.65, dorsalPos: 0.56, waveFreq: 1.75, waveAmp: 1.25 },
    ],
  },

  /* ------------------------------------------------------------
     ABYSS — front-loaded jaw-heavy. Small fan tail, spiky dorsal
     that sits BACK on the huge head, big eyes, lure.
     ------------------------------------------------------------ */
  abyss: {
    name: 'ABYSS',
    desc: 'Ambush · Huge jaws',
    spdMul: 0.88, defMul: 1.05, aggrMul: 1.05, visMul: 0.90, stamMul: 1.00,
    ambush: true, dash: false, swarm: false, apex: true,
    reflect: false, sting: false, lure: true,
    waveAmp: 0.75, waveFreq: 0.95, tailMult: 0.75, tailWidth: 1.45,
    finSpan: 1.15, finFlap: 0.85, dorsalPos: 0.45, eyeScale: 1.25,
    glowTint: [220, 180, 255], accent: '#e6c8ff',
    stages: [
      { profile: 'ab1', shape: 'fan',      dorsal: 'tiny',  color: '#6a5a80', aggr: 0.60, size: 8,
        tailMult: 0.70, tailWidth: 1.30, finSpan: 1.00, dorsalPos: 0.42, eyeScale: 1.30 },
      { profile: 'ab2', shape: 'fan',      dorsal: 'spiny', color: '#8a76a8', aggr: 0.75, size: 18,
        tailMult: 0.75, tailWidth: 1.40, finSpan: 1.10, dorsalPos: 0.44, eyeScale: 1.25 },
      { profile: 'ab3', shape: 'fan',      dorsal: 'spike', color: '#b09ad0', aggr: 0.90, size: 34,
        tailMult: 0.78, tailWidth: 1.50, finSpan: 1.15, dorsalPos: 0.46, eyeScale: 1.20, waveAmp: 0.70 },
      { profile: 'ab4', shape: 'fan',      dorsal: 'spike', color: '#e6c8ff', aggr: 1.00, size: 70,
        tailMult: 0.80, tailWidth: 1.55, finSpan: 1.20, dorsalPos: 0.48, eyeScale: 1.15, waveAmp: 0.68 },
    ],
  },

  /* ------------------------------------------------------------
     PUFFER — near-circular. Tiny STUB tail (spike-shape), tiny
     fins, short spiky dorsal sitting behind the midpoint.
     ------------------------------------------------------------ */
  puffer: {
    name: 'PUFFER',
    desc: 'Inflates · Spiny defense',
    spdMul: 0.70, defMul: 1.45, aggrMul: 0.60, visMul: 0.90, stamMul: 1.20,
    ambush: false, dash: false, swarm: false, apex: false,
    reflect: 0.35, sting: 0.25, lure: false,
    waveAmp: 0.45, waveFreq: 1.10, tailMult: 0.25, tailWidth: 1.45,
    finSpan: 0.45, finFlap: 1.50, dorsalPos: 0.52, eyeScale: 1.15,
    glowTint: [255, 230, 160], accent: '#ffeeb0',
    stages: [
      { profile: 'pu1', shape: 'spike', dorsal: 'tiny',  color: '#c8a040', aggr: 0.30, size: 7,
        tailMult: 0.22, tailWidth: 1.30, finSpan: 0.40, dorsalPos: 0.50 },
      { profile: 'pu2', shape: 'spike', dorsal: 'spiny', color: '#d8b45a', aggr: 0.45, size: 16,
        tailMult: 0.24, tailWidth: 1.40, finSpan: 0.42, dorsalPos: 0.52 },
      { profile: 'pu3', shape: 'spike', dorsal: 'spiny', color: '#e8cc80', aggr: 0.60, size: 30,
        tailMult: 0.26, tailWidth: 1.50, finSpan: 0.45, dorsalPos: 0.54, waveAmp: 0.40, finFlap: 1.55 },
      { profile: 'pu4', shape: 'spike', dorsal: 'spike', color: '#ffeeb0', aggr: 0.75, size: 58,
        tailMult: 0.28, tailWidth: 1.60, finSpan: 0.48, dorsalPos: 0.56, waveAmp: 0.38, finFlap: 1.60, eyeScale: 1.20 },
    ],
  },

  /* ------------------------------------------------------------
     SWORDFISH — the bill + tall crescent tail do the talking.
     Crest dorsal sits WAY forward, near the eye-line.
     ------------------------------------------------------------ */
  swordfish: {
    name: 'SWORDFISH',
    desc: 'Bill · Devastating dash',
    spdMul: 1.35, defMul: 0.95, aggrMul: 0.95, visMul: 1.10, stamMul: 0.65,
    ambush: false, dash: 1.55, swarm: false, apex: true,
    reflect: false, sting: false, lure: false,
    waveAmp: 1.35, waveFreq: 1.15, tailMult: 1.85, tailWidth: 1.05,
    finSpan: 0.90, finFlap: 1.20, dorsalPos: 0.20, eyeScale: 1.00,
    glowTint: [180, 215, 255], accent: '#b8d8f0',
    stages: [
      { profile: 'sf1', shape: 'forked',   dorsal: 'tiny',  color: '#4a6a8a', aggr: 0.55, size: 8,
        tailMult: 1.60, tailWidth: 0.90, finSpan: 0.80, dorsalPos: 0.18 },
      { profile: 'sf2', shape: 'forked',   dorsal: 'spiny', color: '#5e86ac', aggr: 0.70, size: 18,
        tailMult: 1.75, tailWidth: 1.00, finSpan: 0.85, dorsalPos: 0.19 },
      { profile: 'sf3', shape: 'crescent', dorsal: 'crest', color: '#82a8cc', aggr: 0.85, size: 36,
        tailMult: 1.90, tailWidth: 1.10, finSpan: 0.90, dorsalPos: 0.20, waveAmp: 1.40 },
      { profile: 'sf4', shape: 'crescent', dorsal: 'crest', color: '#b8d8f0', aggr: 1.00, size: 72,
        tailMult: 2.00, tailWidth: 1.15, finSpan: 0.95, dorsalPos: 0.21, waveAmp: 1.45 },
    ],
  },

  /* ------------------------------------------------------------
     PIRANHA — short disc. Blunt round nose in the profile, deep
     body, short forked tail, spiny dorsal running rear-half.
     ------------------------------------------------------------ */
  piranha: {
    name: 'PIRANHA',
    desc: 'Swarm · Frenzied bites',
    spdMul: 1.10, defMul: 0.85, aggrMul: 1.15, visMul: 1.00, stamMul: 0.85,
    ambush: false, dash: false, swarm: true, apex: false,
    reflect: false, sting: false, lure: false,
    waveAmp: 1.25, waveFreq: 1.45, tailMult: 0.95, tailWidth: 1.15,
    finSpan: 0.85, finFlap: 1.50, dorsalPos: 0.42, eyeScale: 1.10,
    glowTint: [255, 160, 160], accent: '#e88080',
    stages: [
      { profile: 'pi1', shape: 'forked', dorsal: 'tiny',  color: '#8a3030', aggr: 0.60, size: 5,
        tailMult: 0.90, tailWidth: 1.00, finSpan: 0.75, dorsalPos: 0.40 },
      { profile: 'pi2', shape: 'forked', dorsal: 'spiny', color: '#a84040', aggr: 0.75, size: 11,
        tailMult: 0.95, tailWidth: 1.10, finSpan: 0.85, dorsalPos: 0.41 },
      { profile: 'pi3', shape: 'forked', dorsal: 'spiny', color: '#c85858', aggr: 0.90, size: 20,
        tailMult: 1.00, tailWidth: 1.15, finSpan: 0.90, dorsalPos: 0.42, waveFreq: 1.55, finFlap: 1.55 },
      { profile: 'pi4', shape: 'forked', dorsal: 'spiny', color: '#e88080', aggr: 1.05, size: 38,
        tailMult: 1.05, tailWidth: 1.20, finSpan: 0.95, dorsalPos: 0.43, waveFreq: 1.60, finFlap: 1.60, eyeScale: 1.15 },
    ],
  },

  /* ------------------------------------------------------------
     ANGLER — bulbous head. Small fan tail, tall spike dorsal sits
     mid-head, big eyes, lure.
     ------------------------------------------------------------ */
  angler: {
    name: 'ANGLER',
    desc: 'Lure · Deep ambusher',
    spdMul: 0.85, defMul: 1.00, aggrMul: 1.10, visMul: 0.80, stamMul: 1.05,
    ambush: true, dash: false, swarm: false, apex: false,
    reflect: false, sting: false, lure: true,
    waveAmp: 0.80, waveFreq: 0.90, tailMult: 0.80, tailWidth: 0.95,
    finSpan: 0.90, finFlap: 0.85, dorsalPos: 0.38, eyeScale: 1.30,
    glowTint: [200, 170, 255], accent: '#9a86a8',
    stages: [
      { profile: 'an1', shape: 'fan',   dorsal: 'tiny',  color: '#3a3040', aggr: 0.65, size: 7,
        tailMult: 0.75, tailWidth: 0.85, finSpan: 0.80, dorsalPos: 0.36, eyeScale: 1.35 },
      { profile: 'an2', shape: 'fan',   dorsal: 'spiny', color: '#4e4258', aggr: 0.80, size: 15,
        tailMult: 0.80, tailWidth: 0.90, finSpan: 0.85, dorsalPos: 0.37, eyeScale: 1.30 },
      { profile: 'an3', shape: 'fan',   dorsal: 'spike', color: '#6a5a78', aggr: 0.95, size: 30,
        tailMult: 0.85, tailWidth: 0.95, finSpan: 0.90, dorsalPos: 0.38, eyeScale: 1.25, waveAmp: 0.75 },
      { profile: 'an4', shape: 'fan',   dorsal: 'spike', color: '#9a86a8', aggr: 1.05, size: 62,
        tailMult: 0.88, tailWidth: 1.00, finSpan: 0.95, dorsalPos: 0.39, eyeScale: 1.20, waveAmp: 0.72 },
    ],
  },

  /* ------------------------------------------------------------
     MANTA — thin core body, ENORMOUS fin span (the wings), no
     visible tail stalk (very long thin whip tail). tiny dorsal.
     ------------------------------------------------------------ */
  manta: {
    name: 'MANTA',
    desc: 'Glider · Wide wings',
    spdMul: 1.05, defMul: 1.10, aggrMul: 0.70, visMul: 1.15, stamMul: 1.15,
    ambush: false, dash: false, swarm: false, apex: true,
    reflect: false, sting: false, lure: false,
    waveAmp: 0.65, waveFreq: 0.55, tailMult: 2.10, tailWidth: 0.30,
    finSpan: 2.40, finFlap: 0.55, dorsalPos: 0.15, eyeScale: 0.95,
    glowTint: [170, 220, 240], accent: '#7cb0c8',
    stages: [
      { profile: 'mn1', shape: 'forked',   dorsal: 'tiny', color: '#2e4a5a', aggr: 0.35, size: 10,
        tailMult: 1.90, tailWidth: 0.25, finSpan: 2.10, dorsalPos: 0.14 },
      { profile: 'mn2', shape: 'forked',   dorsal: 'tiny', color: '#3e6274', aggr: 0.50, size: 22,
        tailMult: 2.00, tailWidth: 0.28, finSpan: 2.25, dorsalPos: 0.15 },
      { profile: 'mn3', shape: 'crescent', dorsal: 'tiny', color: '#56889c', aggr: 0.60, size: 42,
        tailMult: 2.10, tailWidth: 0.30, finSpan: 2.40, dorsalPos: 0.16, waveFreq: 0.52 },
      { profile: 'mn4', shape: 'crescent', dorsal: 'tiny', color: '#7cb0c8', aggr: 0.75, size: 72,
        tailMult: 2.20, tailWidth: 0.32, finSpan: 2.55, dorsalPos: 0.17, waveFreq: 0.50, waveAmp: 0.60 },
    ],
  },

  /* ------------------------------------------------------------
     EEL — uniform ribbon. Crest runs the whole length, tiny
     fins, no real tail, high undulation.
     ------------------------------------------------------------ */
  eel: {
    name: 'EEL',
    desc: 'Ribbon · Electric ambush',
    spdMul: 0.90, defMul: 1.05, aggrMul: 0.90, visMul: 1.20, stamMul: 1.00,
    ambush: true, dash: false, swarm: false, apex: false,
    reflect: false, sting: 0.30, lure: false,
    waveAmp: 1.45, waveFreq: 1.80, tailMult: 0.60, tailWidth: 0.35,
    finSpan: 0.35, finFlap: 1.25, dorsalPos: 0.55, eyeScale: 0.85,
    glowTint: [200, 255, 190], accent: '#a0b880',
    stages: [
      { profile: 'ee1', shape: 'forked',   dorsal: 'crest', color: '#4a5a3a', aggr: 0.45, size: 7,
        tailMult: 0.55, tailWidth: 0.30, finSpan: 0.30, dorsalPos: 0.52 },
      { profile: 'ee2', shape: 'forked',   dorsal: 'crest', color: '#5e7248', aggr: 0.60, size: 16,
        tailMult: 0.58, tailWidth: 0.33, finSpan: 0.32, dorsalPos: 0.54 },
      { profile: 'ee3', shape: 'crescent', dorsal: 'crest', color: '#7a9260', aggr: 0.75, size: 32,
        tailMult: 0.60, tailWidth: 0.35, finSpan: 0.35, dorsalPos: 0.56, waveFreq: 1.85, waveAmp: 1.50 },
      { profile: 'ee4', shape: 'crescent', dorsal: 'crest', color: '#a0b880', aggr: 0.90, size: 64,
        tailMult: 0.65, tailWidth: 0.38, finSpan: 0.38, dorsalPos: 0.58, waveFreq: 1.90, waveAmp: 1.55, finFlap: 1.30 },
    ],
  },

  /* ------------------------------------------------------------
     JELLY — bell-front, tendril rear. Almost no tail, almost no
     fins, tall spike dorsal sits at the very front like a bell rim.
     ------------------------------------------------------------ */
  jelly: {
    name: 'JELLY',
    desc: 'Drifter · Numbing sting',
    spdMul: 0.65, defMul: 1.30, aggrMul: 0.55, visMul: 1.00, stamMul: 1.30,
    ambush: false, dash: false, swarm: false, apex: false,
    reflect: false, sting: 0.50, lure: false,
    waveAmp: 0.35, waveFreq: 1.25, tailMult: 0.35, tailWidth: 0.35,
    finSpan: 0.25, finFlap: 1.65, dorsalPos: 0.12, eyeScale: 0.70,
    glowTint: [235, 190, 255], accent: '#f0d8f8',
    stages: [
      { profile: 'je1', shape: 'spike', dorsal: 'tiny', color: '#b080c0', aggr: 0.25, size: 6,
        tailMult: 0.30, tailWidth: 0.30, finSpan: 0.22, dorsalPos: 0.10 },
      { profile: 'je2', shape: 'spike', dorsal: 'tiny', color: '#c49ad0', aggr: 0.40, size: 14,
        tailMult: 0.32, tailWidth: 0.32, finSpan: 0.24, dorsalPos: 0.11 },
      { profile: 'je3', shape: 'spike', dorsal: 'rear', color: '#d8b4e0', aggr: 0.55, size: 26,
        tailMult: 0.35, tailWidth: 0.35, finSpan: 0.26, dorsalPos: 0.12, waveAmp: 0.32, waveFreq: 1.30 },
      { profile: 'je4', shape: 'spike', dorsal: 'rear', color: '#f0d8f8', aggr: 0.70, size: 50,
        tailMult: 0.38, tailWidth: 0.38, finSpan: 0.28, dorsalPos: 0.13, waveAmp: 0.30, waveFreq: 1.35, finFlap: 1.75 },
    ],
  },

  /* ------------------------------------------------------------
     BARRACUDA — long, thin, straight. Sharp forked tail, minimal
     dorsal (tiny/spiny), minimal fins, flat profile.
     ------------------------------------------------------------ */
  barracuda: {
    name: 'BARRACUDA',
    desc: 'Pike · Lightning strike',
    spdMul: 1.30, defMul: 0.90, aggrMul: 1.10, visMul: 1.05, stamMul: 0.60,
    ambush: true, dash: 1.50, swarm: false, apex: true,
    reflect: false, sting: false, lure: false,
    waveAmp: 1.10, waveFreq: 1.20, tailMult: 1.55, tailWidth: 0.70,
    finSpan: 0.50, finFlap: 1.25, dorsalPos: 0.26, eyeScale: 1.05,
    glowTint: [200, 225, 200], accent: '#b8ccb8',
    stages: [
      { profile: 'ba1', shape: 'forked', dorsal: 'tiny',  color: '#5a6a5a', aggr: 0.60, size: 8,
        tailMult: 1.40, tailWidth: 0.60, finSpan: 0.42, dorsalPos: 0.24 },
      { profile: 'ba2', shape: 'forked', dorsal: 'tiny',  color: '#728472', aggr: 0.75, size: 17,
        tailMult: 1.50, tailWidth: 0.65, finSpan: 0.46, dorsalPos: 0.25 },
      { profile: 'ba3', shape: 'forked', dorsal: 'spiny', color: '#90a490', aggr: 0.90, size: 34,
        tailMult: 1.60, tailWidth: 0.70, finSpan: 0.50, dorsalPos: 0.26, waveAmp: 1.15 },
      { profile: 'ba4', shape: 'forked', dorsal: 'spiny', color: '#b8ccb8', aggr: 1.05, size: 68,
        tailMult: 1.70, tailWidth: 0.75, finSpan: 0.55, dorsalPos: 0.27, waveAmp: 1.20 },
    ],
  },

  /* ------------------------------------------------------------
     KOI — smooth full oval. Thick rounded fan tail base, small
     dorsal, no sharp features anywhere.
     ------------------------------------------------------------ */
  koi: {
    name: 'KOI',
    desc: 'Enduring · Calm and hardy',
    spdMul: 0.90, defMul: 1.15, aggrMul: 0.45, visMul: 1.10, stamMul: 1.20,
    ambush: false, dash: false, swarm: true, apex: false,
    reflect: false, sting: false, lure: false,
    waveAmp: 0.90, waveFreq: 0.90, tailMult: 1.05, tailWidth: 1.35,
    finSpan: 1.05, finFlap: 1.00, dorsalPos: 0.42, eyeScale: 0.95,
    glowTint: [255, 210, 170], accent: '#ffd0a0',
    stages: [
      { profile: 'ko1', shape: 'fan', color: '#d07040', dorsal: 'tiny',  aggr: 0.20, size: 8,
        tailMult: 1.00, tailWidth: 1.20, finSpan: 0.95, dorsalPos: 0.40 },
      { profile: 'ko2', shape: 'fan', color: '#e08850', dorsal: 'spiny', aggr: 0.35, size: 18,
        tailMult: 1.05, tailWidth: 1.30, finSpan: 1.00, dorsalPos: 0.41 },
      { profile: 'ko3', shape: 'fan', color: '#f0a068', dorsal: 'rear',  aggr: 0.50, size: 34,
        tailMult: 1.10, tailWidth: 1.40, finSpan: 1.05, dorsalPos: 0.42, waveAmp: 0.85 },
      { profile: 'ko4', shape: 'fan', color: '#ffd0a0', dorsal: 'rear',  aggr: 0.65, size: 66,
        tailMult: 1.15, tailWidth: 1.50, finSpan: 1.15, dorsalPos: 0.43, waveAmp: 0.80 },
    ],
  },

  /* ------------------------------------------------------------
     LEVIATHAN — colossal. Thick through 70%, huge crescent tail,
     tall spike dorsal, biggest fins, heaviest tail base.
     ------------------------------------------------------------ */
  leviathan: {
    name: 'LEVIATHAN',
    desc: 'Apex · Colossal terror',
    spdMul: 0.95, defMul: 1.35, aggrMul: 1.20, visMul: 1.25, stamMul: 1.40,
    ambush: true, dash: false, swarm: false, apex: true,
    reflect: 0.25, sting: false, lure: false,
    waveAmp: 0.85, waveFreq: 0.75, tailMult: 1.65, tailWidth: 1.55,
    finSpan: 1.55, finFlap: 0.80, dorsalPos: 0.42, eyeScale: 1.20,
    glowTint: [150, 200, 255], accent: '#7a9cb8',
    stages: [
      { profile: 'le1', shape: 'forked',   dorsal: 'tiny',  color: '#2a3a4a', aggr: 0.70, size: 10,
        tailMult: 1.55, tailWidth: 1.40, finSpan: 1.40, dorsalPos: 0.40 },
      { profile: 'le2', shape: 'fan',      dorsal: 'spiny', color: '#3c5062', aggr: 0.85, size: 24,
        tailMult: 1.60, tailWidth: 1.45, finSpan: 1.45, dorsalPos: 0.41 },
      { profile: 'le3', shape: 'spike',    dorsal: 'spike', color: '#54708a', aggr: 1.00, size: 44,
        tailMult: 1.65, tailWidth: 1.50, finSpan: 1.55, dorsalPos: 0.42, waveAmp: 0.80 },
      { profile: 'le4', shape: 'crescent', dorsal: 'spike', color: '#7a9cb8', aggr: 1.20, size: 72,
        tailMult: 1.75, tailWidth: 1.60, finSpan: 1.65, dorsalPos: 0.43, waveAmp: 0.75, eyeScale: 1.25 },
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
   8b.  Merged visual params
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

const cloneVisVal = (val) => Array.isArray(val) ? val.slice() : val;

const STAGE_PARAMS = (() => {
  const out = {};
  for (const lk in LINEAGES) {
    const L = LINEAGES[lk];
    out[lk] = L.stages.map((st) => {
      const merged = {};
      for (const k in VISUAL_DEFAULTS) merged[k] = cloneVisVal(VISUAL_DEFAULTS[k]);
      for (const k in VISUAL_DEFAULTS) if (L[k] !== undefined)  merged[k] = cloneVisVal(L[k]);
      for (const k in VISUAL_DEFAULTS) if (st[k] !== undefined) merged[k] = cloneVisVal(st[k]);
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

function stageForSize(lineageKey, size) {
  const th = STAGE_THRESHOLDS[lineageKey] || STAGE_THRESHOLDS[PLAYER_LINEAGE];
  if (size < th[0]) return 0;
  if (size < th[1]) return 1;
  if (size < th[2]) return 2;
  return 3;
}

function lineageStageData(lineageKey, size) {
  const L = getLineage(lineageKey);
  return L.stages[stageForSize(lineageKey, size)];
}

function resolveVisualParams(lineageKey, size) {
  const stages = STAGE_PARAMS[lineageKey] || STAGE_PARAMS[PLAYER_LINEAGE];
  return stages[stageForSize(lineageKey, size)];
}

function visualParam(lineageKey, size, param, fallback = 1.0) {
  const p = resolveVisualParams(lineageKey, size)[param];
  return p !== undefined ? p : fallback;
}

/* ================================================================
   10.  EXPORTS
   ================================================================ */
if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, {
    v, clamp, clamp01, lerp, invLerp, remap,
    smoothstep, smootherstep,
    easeOutCubic, easeInCubic, easeInOutCubic,
    easeOutQuad, easeInQuad, easeOutSine, easeInSine,
    rand, rInt, sign, approach,
    wrapA, wrapAFast, angleDiff, angleLerp,
    TAU, HALF_PI,

    PLAYER_COLOR, PLAYER_GLOW, PLAYER_DARK, PLAYER_LINEAGE,

    CFG, STAGE_NAMES, STAGE_SIZES,

    PROFILES, PROFILE_LUT, PROFILE_LUT_SIZE,
    widthAt, sampleProfile, blendProfiles, profilePeak,

    LINEAGES, LINEAGE_KEYS,
    STAGE_THRESHOLDS, VISUAL_DEFAULTS, STAGE_PARAMS,
    getLineage, getStage, stageForSize, lineageStageData,
    visualParam, resolveVisualParams,
  });
}

/* ================================================================
   11.  LOAD-TIME SANITY CHECK
   ----------------------------------------------------------------
   Fires a loud console warning if the roster isn't 15/15/60.
   If this appears in DevTools, you're loading a stale copy.
   ================================================================ */
if (typeof console !== 'undefined' && console.warn) {
  const EXPECTED_LINEAGES = 15;
  const EXPECTED_PROFILES = 60;
  const gotL = Object.keys(LINEAGES).length;
  const gotK = LINEAGE_KEYS.length;
  const gotP = Object.keys(PROFILES).length;
  if (gotL !== EXPECTED_LINEAGES || gotK !== EXPECTED_LINEAGES || gotP !== EXPECTED_PROFILES) {
    console.warn(
      '[game-world-config] Roster mismatch — expected ' +
      EXPECTED_LINEAGES + ' lineages / ' + EXPECTED_LINEAGES + ' keys / ' + EXPECTED_PROFILES + ' profiles, got ' +
      gotL + ' / ' + gotK + ' / ' + gotP +
      '. A stale or partial copy of this file is likely being served.',
      { LINEAGE_KEYS: LINEAGE_KEYS.slice() }
    );
  }
}