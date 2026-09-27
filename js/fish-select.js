"use strict";

/* ================================================================
   FISH-SELECT CONTROLLER
   ----------------------------------------------------------------
   Renders the "SELECT FISH" character-select screen:

     • a 5x3 responsive grid of lineage "stands" (one per key in
       LINEAGE_KEYS), each showing a LIVE, CONTINUOUSLY ANIMATED
       fish of that lineage at stage-0 (fry) size, drawn with the
       real Renderer fish-drawing pipeline via FishPainter
       (see canvas-renderer.js) — same body fill, outline, glow,
       tail sweep, fin flap and blink as in-game fish;
     • a "RANDOM" stand as the first cell that clears the locked-in
       lineage and restores the original random-every-run behavior;
     • a floating hover preview that appears next to the hovered
       stand and shows a live, GROWING fish — starting at fry size
       and evolving through stages 1→2→3→4 with the same
       evolveAnim ring burst the real game plays, holding ~2 s at
       each new stage, then resetting to fry size and looping;
       the current stage name + live size are shown below the
       canvas and update in real time;
     • click-to-select with an amber "selected" highlight; clicking
       the currently-selected lineage toggles back to RANDOM;
     • a CONFIRM / PLAY button that starts a run using the current
       choice (RANDOM or the locked-in lineage).

   Performance:
     • ONE shared requestAnimationFrame loop drives every stand
       plus the hover preview.  No per-stand timers.
     • Preview fish use a stripped-idle update path only: swimPhase,
       angle drift, blink, evolveAnim, lurePhase, spine rebuild.
       No AI (decide() / perceive() / _autoCombat) is ever called —
       there is nothing for them to react to on this screen.

   Lifecycle:
     • Loop and preview state are torn down by BACK / CONFIRM and
       restarted cleanly by refresh() every time the screen opens.
   ================================================================ */

class FishSelectController {
  constructor(game) {
    this.game = game;

    this.root          = document.getElementById('fishSelect');
    this.gridEl        = document.getElementById('fishSelectGrid');
    this.previewEl     = document.getElementById('fishHoverPreview');
    this.previewCanvas = document.getElementById('fishHoverCanvas');
    this.previewName   = document.getElementById('fishHoverName');
    this.previewStage  = document.getElementById('fishHoverStage');
    this.previewSize   = document.getElementById('fishHoverSize');
    this.confirmBtn    = document.getElementById('fishSelectConfirm');
    this.backBtn       = document.getElementById('fishSelectBack');

    this.stands = new Map();         // lineageKey -> { el, canvas, ctx, fish, scale, seed }
    this.randomEl = null;            // the RANDOM stand element
    this.selectedKey = null;         // lineage key, or null for RANDOM
    this._selectedEl = null;

    /* ---- hover preview state ---- */
    this._hoverKey     = null;
    this._previewFish  = null;
    this._previewState = null;       // { stageIdx, phase, pauseTimer, growRate }
    this._previewSeed  = 0;
    this._previewScale = 1;

    /* ---- shared painter (uses Renderer's drawing pipeline) ---- */
    this.painter = (typeof FishPainter === 'function') ? new FishPainter() : null;

    /* ---- dedicated preview canvas ---- */
    if (this.previewCanvas) {
      this.previewCanvas.width  = 320;
      this.previewCanvas.height = 200;
    }
    this._previewCtx = this.previewCanvas
      ? this.previewCanvas.getContext('2d')
      : null;

    /* ---- shared rAF loop state ---- */
    this._rafId    = null;
    this._running  = false;
    this._lastTime = 0;

    this._buildStands();
    this._wireUI();
    this.refresh();
  }

  /* ------------------------------------------------------------
     Build the RANDOM stand + one stand per lineage.
     LINEAGE_KEYS order = UI order (RANDOM is always first).
     ------------------------------------------------------------ */
  _buildStands() {
    if (!this.gridEl) return;
    this.gridEl.innerHTML = '';

    /* ---- RANDOM stand ---- */
    {
      const stand = document.createElement('div');
      stand.className = 'fishStand fishStandRandom';
      stand.dataset.lineage = '__RANDOM__';

      const canvas = document.createElement('canvas');
      canvas.width = 180;
      canvas.height = 110;
      canvas.className = 'fishStandCanvas';

      const name = document.createElement('div');
      name.className = 'fishStandName';
      name.textContent = 'RANDOM';

      stand.appendChild(canvas);
      stand.appendChild(name);
      this.gridEl.appendChild(stand);

      this._drawRandom(canvas);
      this.randomEl = stand;

      stand.addEventListener('click', () => this._selectRandom());
    }

    /* ---- lineage stands ---- */
    for (const key of LINEAGE_KEYS) {
      const lineage = LINEAGES[key];
      if (!lineage) continue;

      const stand = document.createElement('div');
      stand.className = 'fishStand';
      stand.dataset.lineage = key;

      const canvas = document.createElement('canvas');
      canvas.width = 180;
      canvas.height = 110;
      canvas.className = 'fishStandCanvas';

      const name = document.createElement('div');
      name.className = 'fishStandName';
      name.textContent = lineage.name;

      stand.appendChild(canvas);
      stand.appendChild(name);
      this.gridEl.appendChild(stand);

      const ctx = canvas.getContext('2d');
      const fish = this._makeFish(key, 0);
      const scale = this._fitScale(canvas, fish.size);

      this.stands.set(key, {
        el: stand,
        canvas,
        ctx,
        fish,
        scale,
        seed: Math.random() * Math.PI * 2,
      });

      // Hover-preview events
      stand.addEventListener('mouseenter', () => this._beginHover(key, stand));
      stand.addEventListener('mousemove',  () => this._positionPreview(stand));
      stand.addEventListener('mouseleave', () => this._endHover());

      // Selection (toggles to RANDOM if already selected)
      stand.addEventListener('click', () => this._select(key, stand));
    }
  }

  /* ------------------------------------------------------------
     Wire CONFIRM / BACK buttons.
     ------------------------------------------------------------ */
  _wireUI() {
    if (this.confirmBtn) {
      this.confirmBtn.addEventListener('click', () => this._confirm());
    }
    if (this.backBtn) {
      this.backBtn.addEventListener('click', () => {
        this._endHover();
        this._stopLoop();
        this.game.showStart();
      });
    }
  }

  /* ------------------------------------------------------------
     Sync UI with any previously-chosen lineage on Game.
     Called by Game.openFishSelect() each time the screen opens.
     Also (re)starts the shared animation loop cleanly.
     ------------------------------------------------------------ */
  refresh() {
    const key = this.game.selectedLineage;
    if (key && this.stands.has(key)) {
      this._applySelection(key, this.stands.get(key).el);
    } else {
      this._applySelection(null, this.randomEl);
    }

    /* Restart the loop from a clean slate. */
    this._stopLoop();
    this._startLoop();
  }

  /* ------------------------------------------------------------
     Apply selection state: highlight, remember, propagate to Game,
     update the start-screen subtitle and confirm-button label.
     Pass key=null to select RANDOM.
     ------------------------------------------------------------ */
  _applySelection(key, el) {
    if (this._selectedEl) this._selectedEl.classList.remove('selected');
    this._selectedEl = el || null;
    if (this._selectedEl) this._selectedEl.classList.add('selected');

    this.selectedKey = key || null;
    this.game.selectedLineage = key || null;

    if (this.confirmBtn) {
      this.confirmBtn.style.display = '';
      this.confirmBtn.textContent = this.selectedKey
        ? 'PLAY AS THIS FISH'
        : 'PLAY WITH RANDOM LINEAGE';
    }

    /* Keep the #start screen subtitle in sync. */
    if (typeof this.game.updateStartSubtitle === 'function') {
      this.game.updateStartSubtitle();
    }
  }

  /* ============================================================
     FISH FACTORY  —  builds a real, alive Fish instance for a
     preview.  No Eco, no AI; the shared idle updater below drives
     its animation.
     ============================================================ */
  _makeFish(lineageKey, stageIdx) {
    const lineage = LINEAGES[lineageKey];
    const st = lineage.stages[Math.max(0, Math.min(lineage.stages.length - 1, stageIdx))];
    const fish = new Fish(0, 0, st.size, lineageKey, false, null);

    fish.pos.x = 0;
    fish.pos.y = 0;
    fish.angle = 0;
    fish.vel.x = 40;
    fish.vel.y = 0;
    fish.spawnTimer = 0;                // no fade-in
    fish.swimPhase = Math.random() * Math.PI * 2;
    fish.blinkTimer = 1.5 + Math.random() * 3.5;
    fish._previewSeed = Math.random() * Math.PI * 2;

    fish.spineLen = fish.size * 3.4;
    this._rebuildSpine(fish);
    return fish;
  }

  /* Rebuild a straight spine along fish.angle.  Called each frame
     so the fish visually turns without needing moveAI / pos updates. */
  _rebuildSpine(fish) {
    const n = fish.numSeg;
    if (!fish.spine || fish.spine.length !== n) return;
    const len = fish.spineLen;
    const cos = Math.cos(fish.angle);
    const sin = Math.sin(fish.angle);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      fish.spine[i].x = fish.pos.x - cos * len * t;
      fish.spine[i].y = fish.pos.y - sin * len * t;
    }
  }

  /* Striped idle update: swimPhase, angle wobble, blink, evolve
     timer, lure phase, gentle vel so the spine animates; then
     rebuilds the spine.  No AI. */
  _idleFish(fish, dt, t) {
    const seed = fish._previewSeed || 0;

    /* gentle left/right drift so it looks like it's idly turning */
    fish.angle += Math.sin(t * 0.55 + seed) * 0.35 * dt;

    /* advance swimPhase with a slow cadence so the tail sweeps */
    fish.swimPhase += dt * (3.4 + 1.4 * Math.sin(t * 0.8 + seed * 1.3));

    /* blink */
    fish.blinkTimer -= dt;
    if (fish.blinkTimer <= 0) {
      fish.blinkAnim = 0.12;
      fish.blinkTimer = 2.5 + Math.random() * 3.5;
    }
    if (fish.blinkAnim > 0) fish.blinkAnim -= dt;

    /* evolution ring timer (drives the burst in drawFish) */
    if (fish.evolveAnim > 0) fish.evolveAnim -= dt;

    /* lure bob (only used by lineages with lure:true) */
    fish.lurePhase += dt * 3;

    /* glitch skin phase (harmless; no preview fish use it) */
    fish.glitchPhase += dt * 13;

    /* fake a gentle velocity so drawFish uses the "moving" branch
       (higher undulation amplitude) but we never actually move pos */
    const spd = 45;
    fish.vel.x = Math.cos(fish.angle) * spd;
    fish.vel.y = Math.sin(fish.angle) * spd;

    /* keep the spine length in sync (size can grow in preview) */
    fish.spineLen = fish.size * 3.4;
    this._rebuildSpine(fish);
  }

  /* Compute a scale that fits a fish of `size` nicely in a canvas. */
  _fitScale(canvas, size) {
    const W = canvas.width;
    const H = canvas.height;
    /* visual body bounds: roughly -3.4*size (tail) .. +1.5*size (nose) */
    const len = size * 4.6;
    const hgt = size * 2.4;
    const s = Math.min((W * 0.85) / len, (H * 0.75) / hgt);
    return Math.max(0.5, Math.min(s, 6));
  }

  /* ============================================================
     SHARED ANIMATION LOOP
     ============================================================ */
  _startLoop() {
    if (this._running) return;
    if (!this.painter) return;
    this._running = true;
    this._lastTime = (typeof performance !== 'undefined'
      ? performance.now()
      : Date.now()) * 0.001;

    const tick = (ts) => {
      if (!this._running) return;
      const now = ts * 0.001;
      let dt = now - this._lastTime;
      this._lastTime = now;
      if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
      if (dt > 0.1) dt = 0.1;

      try { this._frame(dt, now); }
      catch (e) { console.error('[fish-select] frame error', e); }

      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _stopLoop() {
    this._running = false;
    if (this._rafId != null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _frame(dt, now) {
    if (!this.painter) return;
    this.painter.step(dt);

    /* ---- draw every stand every frame (15 small canvases, cheap) ---- */
    for (const entry of this.stands.values()) {
      const fish = entry.fish;
      if (!fish) continue;

      this._idleFish(fish, dt, now + entry.seed);

      const ctx = entry.ctx;
      const W = entry.canvas.width;
      const H = entry.canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      this._drawFishCentered(ctx, fish, W, H, entry.scale);
    }

    /* ---- hover preview (if active) ---- */
    if (this._hoverKey && this._previewFish && this._previewCtx) {
      this._updatePreviewFish(dt, now);

      const ctx = this._previewCtx;
      const c = this.previewCanvas;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, c.width, c.height);
      this._drawFishCentered(ctx, this._previewFish, c.width, c.height, this._previewScale);

      this._updatePreviewLabels();
    }
  }

  /* Translates so the fish's visual mass is centered, scales, then
     hands off to FishPainter.draw() which runs Renderer.drawFish. */
  _drawFishCentered(ctx, fish, W, H, scale) {
    const s = (isFinite(scale) && scale > 0) ? scale : 1;
    /* The fish's spine root sits at (0,0) with the body extending
       backwards; shifting a little right of centre puts its visual
       center of mass on the canvas center. */
    const offsetX = W * 0.5 + fish.size * 0.95 * s;
    ctx.save();
    ctx.translate(offsetX, H * 0.5);
    ctx.scale(s, s);
    this.painter.drawFish(ctx, fish);
    ctx.restore();
  }

  /* ============================================================
     HOVER PREVIEW  —  live, growing Fish
     ============================================================ */
  _beginHover(key, standEl) {
    this._hoverKey = key;
    if (!this.previewEl) return;

    const lineage = LINEAGES[key];
    if (!lineage) return;
    const sizes = lineage.stages.map(s => s.size);
    const frySize  = sizes[0];
    const apexSize = sizes[sizes.length - 1];

    /* Fresh live fish at fry size */
    this._previewFish = this._makeFish(key, 0);
    this._previewSeed = Math.random() * Math.PI * 2;
    this._previewFish._previewSeed = this._previewSeed;

    /* Growth state machine — cycles fry → apex → fry forever */
    this._previewState = {
      stageIdx:  0,
      phase:     'grow',           /* 'grow' | 'settle' */
      pauseTimer: 0,
      /* tune so pure growth takes ~2 s; with three 2 s settles the
         whole cycle lands right around the requested 8 s. */
      growRate:  Math.max(4, (apexSize - frySize) / 2.0),
    };

    /* Fixed scale so the growth is actually visible on screen */
    if (this.previewCanvas) {
      const W = this.previewCanvas.width;
      const H = this.previewCanvas.height;
      const len = apexSize * 4.6;
      const hgt = apexSize * 2.4;
      this._previewScale = Math.max(0.4, Math.min((W * 0.85) / len, (H * 0.75) / hgt));
    }

    this.previewEl.classList.add('on');
    this._positionPreview(standEl);
    this._updatePreviewLabels();
  }

  _endHover() {
    this._hoverKey = null;
    this._previewFish = null;
    this._previewState = null;
    if (this.previewEl) this.previewEl.classList.remove('on');
  }

  _positionPreview(standEl) {
    if (!this.previewEl || !standEl) return;
    const rect = standEl.getBoundingClientRect();
    const pw = this.previewEl.offsetWidth  || 340;
    const ph = this.previewEl.offsetHeight || 240;
    const pad = 14;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    /* Prefer right of the stand, flip to left if it would overflow. */
    let px = rect.right + pad;
    if (px + pw > vw - 8) px = rect.left - pw - pad;
    if (px < 8) px = 8;

    /* Vertically center on the stand, clamp inside the viewport. */
    let py = rect.top + Math.max(0, (rect.height - ph) / 2);
    if (py + ph > vh - 8) py = vh - ph - 8;
    if (py < 8) py = 8;

    this.previewEl.style.left = px + 'px';
    this.previewEl.style.top  = py + 'px';
  }

  /* ---- Preview growth + idle update ---------------------------------- */
  _updatePreviewFish(dt, now) {
    const fish = this._previewFish;
    const lineage = LINEAGES[this._hoverKey];
    const st = this._previewState;
    if (!fish || !lineage || !st) return;

    const sizes = lineage.stages.map(s => s.size);
    const apexSize = sizes[sizes.length - 1];

    if (st.phase === 'grow') {
      /* grow via direct size + fish.grow(0) to refresh derived stats
         (maxHp / maxEnergy / biteDmg) and fire checkEvolve() safely */
      fish.size = Math.min(apexSize, fish.size + st.growRate * dt);
      fish.grow(0);

      /* lineage-based stage index (checkEvolve uses global CFG
         thresholds which don't always match lineage stages) */
      let idx = 0;
      for (let i = sizes.length - 1; i >= 0; i--) {
        if (fish.size >= sizes[i]) { idx = i; break; }
      }
      if (idx > st.stageIdx) {
        st.stageIdx = idx;
        fish.stage = idx + 1;
        /* guarantee the ring burst plays even for lineages whose
           CFG-threshold evolution already fired earlier */
        if (fish.evolveAnim <= 0) {
          fish.evolveAnim = CFG.EVO_DUR;
          fish.evolveFrom = idx;
          fish.evolveTo   = idx + 1;
        }
        st.phase = 'settle';
        st.pauseTimer = 2.0;
      }
    } else if (st.phase === 'settle') {
      st.pauseTimer -= dt;
      if (st.pauseTimer <= 0) {
        if (st.stageIdx >= sizes.length - 1) {
          /* reset to fry and loop */
          fish.size = sizes[0];
          fish.stage = 1;
          fish.evolveAnim = 0;
          fish.maxEnergy = 100 + fish.size * 10;
          fish.maxHp     = 60 + fish.size * 14;
          fish.hp        = fish.maxHp;
          fish.biteDmg   = 6 + fish.size * 1.5;
          fish.spineLen  = fish.size * 3.4;
          st.stageIdx = 0;
          st.phase = 'grow';
        } else {
          st.phase = 'grow';
        }
      }
    }

    /* idle motion (rebuilds the spine at the current size) */
    this._idleFish(fish, dt, now + this._previewSeed);
  }

  _updatePreviewLabels() {
    const fish = this._previewFish;
    const lineage = LINEAGES[this._hoverKey];
    if (!fish || !lineage) return;

    const st = this._previewState;
    const stageIdx = st ? st.stageIdx : 0;

    if (this.previewName)  this.previewName.textContent  = lineage.name;
    if (this.previewStage) this.previewStage.textContent =
      STAGE_NAMES[stageIdx] || ('STAGE ' + (stageIdx + 1));
    if (this.previewSize)  this.previewSize.textContent =
      String(Math.round(fish.size * 10) / 10);
  }

  /* ============================================================
     SELECTION
     ============================================================ */
  _select(key, standEl) {
    /* Clicking the already-selected lineage toggles back to RANDOM. */
    if (this.selectedKey === key) {
      this._applySelection(null, this.randomEl);
    } else {
      this._applySelection(key, standEl);
    }
  }

  _selectRandom() {
    /* RANDOM is idempotent — clicking it again just keeps it selected. */
    this._applySelection(null, this.randomEl);
  }

  _confirm() {
    /* Both RANDOM (null) and a lineage are valid final choices;
       selectedLineage is already up to date from _applySelection. */
    this._endHover();
    this._stopLoop();
    // Same entry point as the PLAY button so we inherit the
    // exact same multiplayer / single-player fallback flow.
    this.game.startOnline();
  }

  /* ============================================================
     RANDOM STAND THUMBNAIL (static glyph — no animated fish)
     ============================================================ */
  _drawRandom(canvas) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // Dashed amber outline to hint "anything / surprise".
    ctx.strokeStyle = 'rgba(255,204,68,0.55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(10.5, 10.5, W - 21, H - 21);
    ctx.setLineDash([]);

    // Big amber "?" glyph.
    ctx.fillStyle = '#ffcc44';
    ctx.font = 'bold 62px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', W / 2, H / 2 - 2);
  }
}