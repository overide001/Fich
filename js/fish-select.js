"use strict";

/* ================================================================
   FISH-SELECT CONTROLLER
   ----------------------------------------------------------------
   Renders the "SELECT FISH" character-select screen:

     • a 5x3 responsive grid of lineage "stands" (one per key in
       LINEAGE_KEYS), each showing that lineage's stage-0 fry
       silhouette on its own small canvas, with the lineage's
       display name underneath;
     • a floating hover preview that appears next to the hovered
       stand and cycles through the lineage's 4 stages every
       2 seconds, showing the current stage name + size below;
     • click-to-select with an amber "selected" highlight that
       stores the choice on Game.selectedLineage;
     • a CONFIRM / PLAY-AS-THIS-FISH button that appears once a
       lineage is chosen and starts a run using it.

   Self-contained: builds its own DOM/canvas contents and attaches
   its own listeners. Constructed by Game in game-controller.js.
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

    this.stands = new Map();         // lineageKey -> { el, canvas }
    this.selectedKey = null;
    this._selectedEl = null;

    this._hoverKey = null;
    this._previewTimer = null;
    this._previewStageIdx = 0;

    this._buildStands();
    this._wireUI();
    this.refresh();
  }

  /* ------------------------------------------------------------
     Build one stand per lineage (LINEAGE_KEYS order = UI order).
     ------------------------------------------------------------ */
  _buildStands() {
    if (!this.gridEl) return;
    this.gridEl.innerHTML = '';

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

      this.stands.set(key, { el: stand, canvas });

      // Draw the fry (stage 0) pose as the stand thumbnail.
      this._drawStage(canvas, key, 0);

      // Hover-preview events
      stand.addEventListener('mouseenter', () => this._beginHover(key, stand));
      stand.addEventListener('mousemove',  () => this._positionPreview(stand));
      stand.addEventListener('mouseleave', () => this._endHover());

      // Selection
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
        this.game.showStart();
      });
    }
  }

  /* ------------------------------------------------------------
     Sync UI with any previously-chosen lineage on Game.
     Called by Game.openFishSelect() each time the screen opens.
     ------------------------------------------------------------ */
  refresh() {
    const key = this.game.selectedLineage;
    if (key && this.stands.has(key)) {
      this.selectedKey = key;
      this._selectedEl = this.stands.get(key).el;
      for (const [k, s] of this.stands) {
        s.el.classList.toggle('selected', k === key);
      }
      if (this.confirmBtn) this.confirmBtn.style.display = '';
    } else {
      this.selectedKey = null;
      this._selectedEl = null;
      for (const [, s] of this.stands) s.el.classList.remove('selected');
      if (this.confirmBtn) this.confirmBtn.style.display = 'none';
    }
  }

  /* ------------------------------------------------------------
     HOVER PREVIEW
     Floats a small panel next to the hovered stand. Cycles
     stages 0..3 every 2 seconds with setInterval; timer is
     cleared on mouseleave so previews never pile up.
     ------------------------------------------------------------ */
  _beginHover(key, standEl) {
    this._hoverKey = key;
    this._previewStageIdx = 0;

    if (!this.previewEl) return;

    // Show first so offsetWidth/Height are valid for positioning.
    this.previewEl.classList.add('on');
    this._drawPreviewStage();
    this._positionPreview(standEl);

    if (this._previewTimer) clearInterval(this._previewTimer);
    this._previewTimer = setInterval(() => {
      this._previewStageIdx = (this._previewStageIdx + 1) % 4;
      this._drawPreviewStage();
    }, 2000);
  }

  _endHover() {
    this._hoverKey = null;
    if (this._previewTimer) {
      clearInterval(this._previewTimer);
      this._previewTimer = null;
    }
    if (this.previewEl) this.previewEl.classList.remove('on');
  }

  _positionPreview(standEl) {
    if (!this.previewEl || !standEl) return;
    const rect = standEl.getBoundingClientRect();
    const pw = this.previewEl.offsetWidth  || 240;
    const ph = this.previewEl.offsetHeight || 200;
    const pad = 14;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Prefer right of the stand, flip to left if it would overflow.
    let px = rect.right + pad;
    if (px + pw > vw - 8) px = rect.left - pw - pad;
    if (px < 8) px = 8;

    // Vertically center on the stand, clamp inside the viewport.
    let py = rect.top + Math.max(0, (rect.height - ph) / 2);
    if (py + ph > vh - 8) py = vh - ph - 8;
    if (py < 8) py = 8;

    this.previewEl.style.left = px + 'px';
    this.previewEl.style.top  = py + 'px';
  }

  _drawPreviewStage() {
    if (!this.previewCanvas || !this._hoverKey) return;
    const lineage = LINEAGES[this._hoverKey];
    if (!lineage) return;

    const idx = this._previewStageIdx;
    this._drawStage(this.previewCanvas, this._hoverKey, idx);

    const st = lineage.stages[idx];
    if (this.previewName)  this.previewName.textContent  = lineage.name;
    if (this.previewStage) this.previewStage.textContent = STAGE_NAMES[idx] || ('STAGE ' + (idx + 1));
    if (this.previewSize)  this.previewSize.textContent  =
      String(st && st.size != null ? st.size : '');
  }

  /* ------------------------------------------------------------
     SELECTION
     ------------------------------------------------------------ */
  _select(key, standEl) {
    if (this._selectedEl) this._selectedEl.classList.remove('selected');
    this._selectedEl = standEl;
    standEl.classList.add('selected');
    this.selectedKey = key;
    this.game.selectedLineage = key;
    if (this.confirmBtn) this.confirmBtn.style.display = '';
  }

  _confirm() {
    if (!this.selectedKey) return;
    this.game.selectedLineage = this.selectedKey;
    this._endHover();
    // Same entry point as the PLAY button so we inherit the
    // exact same multiplayer / single-player fallback flow.
    this.game.startOnline();
  }

  /* ------------------------------------------------------------
     STATIC SILHOUETTE DRAWING
     ------------------------------------------------------------
     Simplified pose (not the animated spine sim from
     canvas-renderer.js): symmetric closed body path sampled
     from widthAt(profile, t), a tail shape driven by `shape`,
     and a dorsal fin driven by `dorsal`. Fish faces right.
     ------------------------------------------------------------ */
  _drawStage(canvas, lineageKey, stageIdx) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // CRT background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const L = LINEAGES[lineageKey];
    if (!L) return;
    const st = L.stages[Math.max(0, Math.min(L.stages.length - 1, stageIdx))];
    if (!st) return;

    const profile = st.profile;
    const color   = st.color || '#cfcfcf';

    // Sample body half-widths once.
    const SAMPLES = 24;
    const widths = new Array(SAMPLES + 1);
    let wmax = 1e-4;
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const w = widthAt(profile, t);
      widths[i] = w;
      if (w > wmax) wmax = w;
    }

    // Visual params — per-stage first, then per-lineage fallback.
    const tailMul   = _fsNum(st.tailMult,   L.tailMult,   1.0);
    const tailWidth = _fsNum(st.tailWidth,  L.tailWidth,  1.0);
    const finSpan   = _fsNum(st.finSpan,    L.finSpan,    1.0);
    const dorsalPos = _fsNum(st.dorsalPos,  L.dorsalPos,  0.4);
    const shape     = st.shape  || 'forked';
    const dorsal    = st.dorsal || 'tiny';

    // Layout: nose on the right, tail on the left.
    const marginX = W * 0.06;
    const usableW = W - marginX * 2;

    let tailFrac = 0.16 + 0.10 * clamp(tailMul, 0.2, 2.4);
    if (shape === 'spike')    tailFrac = Math.min(tailFrac, 0.16);
    if (shape === 'fan')      tailFrac = Math.max(tailFrac, 0.20);
    if (shape === 'crescent') tailFrac = Math.max(tailFrac, 0.22);
    tailFrac = clamp(tailFrac, 0.10, 0.40);

    const bodyLen  = usableW * (1 - tailFrac);
    const tailLen  = usableW * tailFrac;
    const totalLen = bodyLen + tailLen;

    const noseX = W / 2 + totalLen / 2;
    const rootX = noseX - bodyLen;
    const cy    = H / 2 + H * 0.03;

    const maxHalfPx = H * 0.30;
    const scale = maxHalfPx / wmax;

    // -------- BODY --------
    ctx.beginPath();
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const x = noseX - t * bodyLen;
      const y = cy - widths[i] * scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (let i = SAMPLES; i >= 0; i--) {
      const t = i / SAMPLES;
      const x = noseX - t * bodyLen;
      const y = cy + widths[i] * scale;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // -------- TAIL --------
    const rootTop  = cy - widths[SAMPLES] * scale;
    const rootBot  = cy + widths[SAMPLES] * scale;
    const rootHalf = (rootBot - rootTop) / 2;
    const tailHalfY = Math.max(rootHalf * 0.9, tailLen * 0.60 * tailWidth);

    ctx.fillStyle = color;
    ctx.beginPath();
    if (shape === 'forked') {
      ctx.moveTo(rootX, rootTop);
      ctx.lineTo(rootX - tailLen,        cy - tailHalfY);
      ctx.lineTo(rootX - tailLen * 0.55, cy);
      ctx.lineTo(rootX - tailLen,        cy + tailHalfY);
      ctx.lineTo(rootX, rootBot);
      ctx.closePath();
    } else if (shape === 'fan') {
      ctx.moveTo(rootX, rootTop);
      ctx.lineTo(rootX - tailLen,        cy - tailHalfY * 1.15);
      ctx.lineTo(rootX - tailLen * 1.05, cy);
      ctx.lineTo(rootX - tailLen,        cy + tailHalfY * 1.15);
      ctx.lineTo(rootX, rootBot);
      ctx.closePath();
    } else if (shape === 'crescent') {
      ctx.moveTo(rootX, rootTop);
      ctx.quadraticCurveTo(
        rootX - tailLen * 1.20, cy - tailHalfY * 1.30,
        rootX - tailLen * 0.85, cy
      );
      ctx.quadraticCurveTo(
        rootX - tailLen * 1.20, cy + tailHalfY * 1.30,
        rootX, rootBot
      );
      ctx.closePath();
    } else { // 'spike'
      ctx.moveTo(rootX, rootTop);
      ctx.lineTo(rootX - tailLen, cy);
      ctx.lineTo(rootX, rootBot);
      ctx.closePath();
    }
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.stroke();

    // -------- DORSAL --------
    const dorsalT = clamp(dorsalPos, 0, 1);
    const dorsalX = noseX - dorsalT * bodyLen;
    const bodyTopAtDorsal = cy - widthAt(profile, dorsalT) * scale;
    const dorsalWidth  = bodyLen * 0.22;
    const dorsalHeight = H * 0.24 * (0.7 + 0.4 * clamp(finSpan, 0.3, 2.0) / 2);

    ctx.fillStyle = color;
    if (dorsal === 'tiny') {
      ctx.beginPath();
      ctx.moveTo(dorsalX - dorsalWidth * 0.35, bodyTopAtDorsal + 1);
      ctx.lineTo(dorsalX,                      bodyTopAtDorsal - dorsalHeight * 0.40);
      ctx.lineTo(dorsalX + dorsalWidth * 0.35, bodyTopAtDorsal + 1);
      ctx.closePath();
      ctx.fill();
    } else if (dorsal === 'spiny') {
      const n = 5;
      const startX = dorsalX - dorsalWidth * 0.55;
      ctx.beginPath();
      ctx.moveTo(startX, bodyTopAtDorsal + 1);
      for (let i = 0; i < n; i++) {
        const t0 = startX + dorsalWidth * ((i + 0.5) / n);
        const t1 = startX + dorsalWidth * ((i + 1) / n);
        ctx.lineTo(t0, bodyTopAtDorsal - dorsalHeight * 0.85);
        ctx.lineTo(t1, bodyTopAtDorsal + 1);
      }
      ctx.closePath();
      ctx.fill();
    } else if (dorsal === 'spike') {
      ctx.beginPath();
      ctx.moveTo(dorsalX - dorsalWidth * 0.55, bodyTopAtDorsal + 1);
      ctx.lineTo(dorsalX,                      bodyTopAtDorsal - dorsalHeight * 1.30);
      ctx.lineTo(dorsalX + dorsalWidth * 0.55, bodyTopAtDorsal + 1);
      ctx.closePath();
      ctx.fill();
    } else if (dorsal === 'rear') {
      ctx.beginPath();
      ctx.moveTo(dorsalX - dorsalWidth * 0.55, bodyTopAtDorsal + 1);
      ctx.quadraticCurveTo(
        dorsalX + dorsalWidth * 0.10, bodyTopAtDorsal - dorsalHeight * 1.05,
        dorsalX + dorsalWidth * 0.75, bodyTopAtDorsal + 2
      );
      ctx.closePath();
      ctx.fill();
    } else if (dorsal === 'crest') {
      const startT = 0.18;
      const endT   = 0.86;
      const N = 12;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const t = startT + (endT - startT) * (i / N);
        const x = noseX - t * bodyLen;
        const yBody = cy - widthAt(profile, t) * scale;
        const bump = Math.sin(Math.PI * (i / N));
        const y = yBody - dorsalHeight * 0.45 * bump;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      for (let i = N; i >= 0; i--) {
        const t = startT + (endT - startT) * (i / N);
        const x = noseX - t * bodyLen;
        const yBody = cy - widthAt(profile, t) * scale;
        ctx.lineTo(x, yBody);
      }
      ctx.closePath();
      ctx.fill();
    }

    // -------- EYE DOT --------
    const eyeX = noseX - bodyLen * 0.12;
    const eyeY = cy - widths[Math.round(SAMPLES * 0.12)] * scale * 0.35;
    const eyeR = Math.max(1.2, H * 0.02);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* Small numeric helper — first finite number wins.
   Prefixed to avoid clashing with anything on window scope. */
function _fsNum(a, b, fallback) {
  if (typeof a === 'number' && isFinite(a)) return a;
  if (typeof b === 'number' && isFinite(b)) return b;
  return fallback;
}