"use strict";

/* ================================================================
   CORE DATA / MATH / CONFIG LAYER  —  rework v2
   ----------------------------------------------------------------
   Backward-compatible surface (all original names kept):
     v.add/sub/scale/len/norm/d2/d
     clamp / lerp / rand / rInt / wrapA
     PLAYER_COLOR / PLAYER_GLOW / PLAYER_DARK
     CFG.* (every key preserved, no removals)
     STAGE_NAMES / STAGE_SIZES
     PROFILES[pr1..ab4] / widthAt(key, t)
     LINEAGES[key].stages[i]
     LINEAGE_KEYS
     getLineage / getStage / stageForSize / lineageStageData / visualParam

   New in this rework:
     • Pre-baked profile LUTs — widthAt() is now a single lerp.
       (This is called per-sample per-fish per-frame; the old
        Catmull-Rom path was the hottest scalar in the pipeline.)
     • resolveVisualParams(lk, size) — one cached, frozen record
       per (lineage, stage) so the renderer doesn't walk
       stage → lineage → fallback eight times per fish per frame.
     • O(1) stageForSize via a pre-built threshold table.
     • More mutating vector ops (moveTowards, distSq, limitTo,
       perpTo, rotTo) so hot loops never allocate.
     • Additional easing + wrap helpers used by the motion system.
     • CFG.ANIM / CFG.VIS — animation tuning + scale-safe caps.
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
  dot:     (a, b) => a.x * b.x + a.y * b.y,
  cross:   (a, b) => a.x * b.y - a.y * b.x,
  angle:   (a) => Math.atan2(a.y, a.x),
  perp:    (a) => ({ x: -a.y, y: a.x }),
  fromAngle:(a, l = 1) => ({ x: Math.cos(a) * l, y: Math.sin(a) * l }),
  rot:     (a, r) => { const c = Math.cos(r), s = Math.sin(r); return { x: a.x * c - a.y * s, y: a.x * s + a.y * c }; },
  lerp:    (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }),
  isZero:  (a, e = 1e-9) => Math.abs(a.x) < e && Math.abs(a.y) < e,
  clampLen:(a, max) => {
    const l = Math.hypot(a.x, a.y);
    if (l <= max || l < 1e-9) return { x: a.x, y: a.y };
    const s = max / l;
    return { x: a.x * s, y: a.y * s };
  },
  dist:    (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
  finite:  (a) => isFinite(a.x) && isFinite(a.y),
  midpoint:(a, b) => ({ x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 }),

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
const invLerp = (a, b, v) => (b - a) ? ((v - a) / (b - a)) : 0;
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

const rand = (a, b) => a + Math.random() * (b - a);
const rInt = (a, b) => Math.floor(rand(a, b + 1));
const sign = (x) => x < 0 ? -1 : (x > 0 ? 1 : 0);
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
   All original keys preserved.  New keys are grouped at the end
   under ANIM (tuning) and VIS (scale-safe caps) so nothing breaks.
   ================================================================ */
const CFG = {
  /* ---- world ---- */
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
  TURN_AI: 4.2,
  TURN_PLR: 13,
  SPD_TAPER: 0.22,

  /* ---- vision ---- */
  VIS_BASE: 210,
  VIS_SZ: 4.5,
  VIS_SOFT_START: 280,
  VIS_CAP: 430,

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
  PLAYER_PARTICLE_INTERVAL: 0.06,
  PLAYER_PARTICLES_PER_BURST: 8,
  FOOD_OPENING_TGT: 360,
  FOOD_OPENING_RADIUS: 1200,
  FOOD_OPENING_MIN_DISTANCE: 140,

  /* ---- scale-safe effect aliases ---- */
  GLOW_R_CAP: 150,
  RING_R_CAP: 210,

  /* ---- stamina ---- */
  STAM_MAX: 100,
  STAM_DRAIN_FLEE: 42,
  STAM_DRAIN_CHASE: 11,
  STAM_REGEN: 14,

  /* ---- AI ---- */
  PREDICT_CAP: 1.0,
  MEMORY: 1.8,
  HUNGER: 0.15,
  AI_START_ENERGY: 0.65,

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
   12-point half-width curves, head (t=0) → tail (t=1).
   Distinct silhouettes per lineage:
     predator — balanced torpedo, peak near 45–55 %
     swift    — thin dart,        peak near 30–35 %
     armor    — chunky tank,      peak near 40–50 %, wide
     serpent  — long eel,         almost uniform
     abyss    — bulky jaw,        peak near 25–35 %, sharp taper
   ================================================================ */
const PROFILES = {
  /* ---------- PREDATOR ---------- */
  pr1:[0.09,0.18,0.26,0.31,0.32,0.31,0.27,0.22,0.16,0.10,0.05,0.02],
  pr2:[0.10,0.22,0.36,0.48,0.54,0.53,0.46,0.36,0.24,0.14,0.06,0.02],
  pr3:[0.08,0.18,0.32,0.46,0.55,0.56,0.50,0.40,0.27,0.16,0.07,0.02],
  pr4:[0.06,0.16,0.32,0.52,0.66,0.72,0.68,0.54,0.36,0.19,0.07,0.02],

  /* ---------- SWIFT ---------- */
  sw1:[0.07,0.14,0.20,0.22,0.21,0.18,0.14,0.10,0.06,0.03,0.01,0.00],
  sw2:[0.08,0.16,0.24,0.27,0.26,0.22,0.17,0.12,0.07,0.03,0.01,0.00],
  sw3:[0.09,0.20,0.32,0.37,0.36,0.31,0.23,0.15,0.08,0.04,0.01,0.00],
  sw4:[0.10,0.22,0.38,0.46,0.45,0.39,0.30,0.20,0.11,0.05,0.02,0.00],

  /* ---------- ARMOR ---------- */
  ar1:[0.11,0.22,0.30,0.34,0.33,0.30,0.25,0.19,0.13,0.07,0.03,0.01],
  ar2:[0.13,0.28,0.42,0.52,0.54,0.51,0.44,0.34,0.22,0.12,0.05,0.01],
  ar3:[0.15,0.32,0.52,0.68,0.74,0.72,0.62,0.48,0.31,0.16,0.06,0.01],
  ar4:[0.17,0.38,0.64,0.84,0.94,0.92,0.80,0.62,0.40,0.20,0.07,0.02],

  /* ---------- SERPENT ---------- */
  se1:[0.08,0.10,0.12,0.14,0.15,0.15,0.14,0.12,0.10,0.07,0.04,0.01],
  se2:[0.09,0.12,0.15,0.17,0.18,0.18,0.17,0.15,0.12,0.09,0.05,0.02],
  se3:[0.10,0.14,0.19,0.22,0.24,0.24,0.22,0.19,0.15,0.11,0.06,0.03],
  se4:[0.12,0.17,0.23,0.29,0.32,0.32,0.30,0.26,0.20,0.14,0.08,0.03],

  /* ---------- ABYSS ---------- */
  ab1:[0.10,0.18,0.24,0.26,0.24,0.20,0.15,0.10,0.06,0.03,0.01,0.00],
  ab2:[0.14,0.28,0.40,0.46,0.45,0.39,0.30,0.20,0.12,0.06,0.02,0.00],
  ab3:[0.18,0.38,0.56,0.66,0.64,0.55,0.42,0.28,0.16,0.08,0.03,0.00],
  ab4:[0.22,0.48,0.72,0.88,0.86,0.76,0.58,0.38,0.22,0.10,0.03,0.00],
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
   Per-lineage multipliers preserved exactly.
   Each stage keeps {profile, shape, dorsal, color, aggr, size} and
   may override any motion param the renderer reads:

     waveAmp   — body undulation amplitude multiplier
     waveFreq  — wave count multiplier
     tailMult  — tail length multiplier
     tailWidth — tail width multiplier
     finSpan   — pectoral fin size multiplier
     finFlap   — fin flap frequency multiplier
     dorsalPos — dorsal fin position along body (0..1)
     eyeScale  — eye size multiplier
     glowTint  — [r,g,b] aura tint
   ================================================================ */
const LINEAGES = {
  predator: {
    name: 'PREDATOR',
    desc: 'Balanced · Pack hunter',
    spdMul: 1.00, defMul: 1.00, aggrMul: 1.00, visMul: 1.00, stamMul: 1.00,
    waveAmp: 1.00, waveFreq: 1.00, tailMult: 1.20, tailWidth: 1.00,
    finSpan: 1.00, finFlap: 1.00, dorsalPos: 0.35, eyeScale: 1.00,
    glowTint: [255, 255, 255], accent: '#ffffff',
    stages: [
      { profile:'pr1', shape:'forked',   dorsal:'tiny',  color:'#9a9a9a', aggr:0.40, size:8,
        waveAmp:1.05, tailMult:1.10, eyeScale:1.05 },
      { profile:'pr2', shape:'fan',      dorsal:'spiny', color:'#c0c0c0', aggr:0.60, size:16,
        waveAmp:1.00, tailMult:1.20, dorsalPos:0.38 },
      { profile:'pr3', shape:'forked',   dorsal:'rear',  color:'#e0e0e0', aggr:0.80, size:30,
        waveAmp:0.95, tailMult:1.25, dorsalPos:0.40 },
      { profile:'pr4', shape:'crescent', dorsal:'spike', color:'#ffffff', aggr:0.95, size:60,
        waveAmp:0.90, tailMult:1.35, dorsalPos:0.42, finSpan:1.15 },
    ],
  },

  swift: {
    name: 'SWIFT',
    desc: 'Fast · Hit and run',
    spdMul: 1.28, defMul: 0.95, aggrMul: 0.70, visMul: 1.05, stamMul: 0.55,
    waveAmp: 1.25, waveFreq: 1.25, tailMult: 1.35, tailWidth: 0.85,
    finSpan: 0.90, finFlap: 1.30, dorsalPos: 0.30, eyeScale: 0.95,
    glowTint: [200, 230, 255], accent: '#dff2ff',
    stages: [
      { profile:'sw1', shape:'forked',   dorsal:'tiny', color:'#8a8a8a', aggr:0.30, size:6 },
      { profile:'sw2', shape:'forked',   dorsal:'tiny', color:'#a8a8a8', aggr:0.50, size:14 },
      { profile:'sw3', shape:'crescent', dorsal:'rear', color:'#d0d0d0', aggr:0.70, size:28,
        waveFreq:1.30, tailMult:1.40 },
      { profile:'sw4', shape:'crescent', dorsal:'rear', color:'#f0f0f0', aggr:0.85, size:55,
        waveFreq:1.35, tailMult:1.45, finSpan:0.95 },
    ],
  },

  armor: {
    name: 'ARMOR',
    desc: 'Tanky · Slow bruiser',
    spdMul: 0.82, defMul: 1.22, aggrMul: 0.90, visMul: 0.95, stamMul: 1.10,
    waveAmp: 0.65, waveFreq: 0.80, tailMult: 0.95, tailWidth: 1.30,
    finSpan: 1.20, finFlap: 0.80, dorsalPos: 0.45, eyeScale: 0.85,
    glowTint: [255, 235, 200], accent: '#f6e5c8',
    stages: [
      { profile:'ar1', shape:'fan',   dorsal:'tiny',  color:'#8f8f8f', aggr:0.40, size:8 },
      { profile:'ar2', shape:'fan',   dorsal:'spiny', color:'#b0b0b0', aggr:0.60, size:18 },
      { profile:'ar3', shape:'spike', dorsal:'spiny', color:'#d8d8d8', aggr:0.80, size:34,
        waveAmp:0.60, finSpan:1.30 },
      { profile:'ar4', shape:'spike', dorsal:'spike', color:'#ffffff', aggr:0.95, size:70,
        waveAmp:0.55, finSpan:1.40, eyeScale:0.80 },
    ],
  },

  serpent: {
    name: 'SERPENT',
    desc: 'Long · Wide vision',
    spdMul: 0.95, defMul: 1.00, aggrMul: 0.85, visMul: 1.30, stamMul: 1.00,
    waveAmp: 1.15, waveFreq: 1.55, tailMult: 1.05, tailWidth: 0.75,
    finSpan: 0.75, finFlap: 1.10, dorsalPos: 0.55, eyeScale: 0.90,
    glowTint: [210, 255, 220], accent: '#dcffe4',
    stages: [
      { profile:'se1', shape:'forked',   dorsal:'rear',  color:'#8a8a8a', aggr:0.40, size:8 },
      { profile:'se2', shape:'forked',   dorsal:'rear',  color:'#a8a8a8', aggr:0.60, size:18 },
      { profile:'se3', shape:'forked',   dorsal:'crest', color:'#d0d0d0', aggr:0.75, size:34,
        waveFreq:1.60, dorsalPos:0.55 },
      { profile:'se4', shape:'crescent', dorsal:'crest', color:'#ffffff', aggr:0.90, size:65,
        waveFreq:1.65, waveAmp:1.20, dorsalPos:0.58 },
    ],
  },

  abyss: {
    name: 'ABYSS',
    desc: 'Ambush · Huge jaws',
    spdMul: 0.88, defMul: 1.05, aggrMul: 1.05, visMul: 0.90, stamMul: 1.00,
    ambush: true, lure: true,
    waveAmp: 0.80, waveFreq: 0.95, tailMult: 1.15, tailWidth: 1.15,
    finSpan: 1.10, finFlap: 0.90, dorsalPos: 0.50, eyeScale: 1.25,
    glowTint: [220, 180, 255], accent: '#e6c8ff',
    stages: [
      { profile:'ab1', shape:'forked',   dorsal:'tiny',  color:'#7a7a7a', aggr:0.60, size:8,
        eyeScale:1.30 },
      { profile:'ab2', shape:'fan',      dorsal:'spiny', color:'#9a9a9a', aggr:0.75, size:18,
        eyeScale:1.25 },
      { profile:'ab3', shape:'fan',      dorsal:'spike', color:'#c8c8c8', aggr:0.90, size:34,
        eyeScale:1.20, waveAmp:0.75 },
      { profile:'ab4', shape:'crescent', dorsal:'spike', color:'#ffffff', aggr:1.00, size:70,
        eyeScale:1.15, waveAmp:0.70, tailMult:1.20 },
    ],
  },
};

const LINEAGE_KEYS = ['predator', 'swift', 'armor', 'serpent', 'abyss'];

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
   Precedence: visualDefaults  <  lineage  <  stage

   The renderer wants a single flat record so it doesn't have to
   walk the fallback chain for every param on every fish, every
   frame.  5 lineages × 4 stages = 20 records, built once.
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

const STAGE_PARAMS = (() => {
  const out = {};
  for (const lk in LINEAGES) {
    const L = LINEAGES[lk];
    out[lk] = L.stages.map((st) => {
      const merged = {};
      /* defaults → lineage → stage */
      for (const k in VISUAL_DEFAULTS) merged[k] = VISUAL_DEFAULTS[k];
      for (const k in VISUAL_DEFAULTS) if (L[k] !== undefined)  merged[k] = L[k];
      for (const k in VISUAL_DEFAULTS) if (st[k] !== undefined) merged[k] = st[k];
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
   EXPORTS
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
    getLineage, getStage, stageForSize, lineageStageData,
    visualParam, resolveVisualParams,
  });
}
