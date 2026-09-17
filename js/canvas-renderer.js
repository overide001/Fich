"use strict";

/* ================================================================
   RENDERER  —  rework v4 (CRT TV shader + glowing food rework)
   ----------------------------------------------------------------
   External contract kept intact:
     new Renderer(canvas, eco)
     renderer.fit() / renderer.render()
   Consumed fish API unchanged:
     renderSpine() profileKey() colorKey() accentKey()
     dorsalKey() shapeKey() defSize() predict() aggression()
     pos vel angle size state target alive isPlayer spawnTimer
     swimPhase blinkAnim evolveAnim glitchPhase lurePhase
     lineage.lure skin visionRange energy maxEnergy

   New in this rework:
     • Full scene renders to an offscreen buffer, then is
       composited to the visible canvas through a CRT pass:
         – horizontal scanlines + aperture-grille tint
         – chromatic-aberration ghosting
         – phosphor bloom
         – vignette / tube rim
         – rolling refresh bar
         – subtle high-frequency flicker
       Toggleable at runtime: renderer.crtEnabled, renderer.crtIntensity
     • Food pellets now use a pre-rendered glow sprite (soft
       blue-white halo + warm ivory core + 4-point sparkle) drawn
       with 'lighter' compositing, plus per-pellet bob / pulse /
       wobble.  No more flat grey squares.
     • Eat-pop buffer kept, palette retuned to match.
   ================================================================ */

class Renderer{
  constructor(canvas, eco){
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d', { alpha: false });
    this.eco    = eco;

    /* ---------- timing / quality ---------- */
    this.frame    = 0;
    this.quality  = 2;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._lastTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this._dt       = 1/60;
    this._time     = this._lastTime * 0.001;

    /* ---------- sorted fish cache ---------- */
    this._sortedFish = null;
    this._lastFishCount = -1;
    this._sortFrame = 0;

    /* ---------- grow-only geometry buffers ---------- */
    this._cx = []; this._cy = [];
    this._nx = []; this._ny = [];
    this._hw = []; this._sw = [];
    this._tx = []; this._ty = [];
    this._bx = []; this._by = [];
    this._minX = 0; this._maxX = 0; this._minY = 0; this._maxY = 0;

    /* ---------- pre-rendered background ---------- */
    this._bg = null;
    this._bgCtx = null;
    this._bgW = 0;
    this._bgH = 0;

    /* ---------- ambient drifting motes ---------- */
    this._ambient = [];
    this._seedAmbient(70);

    /* ---------- intent line scratch ---------- */
    this._intentPool = [];

    /* ---------- last known canvas CSS size ---------- */
    this._lastFitW = 0;
    this._lastFitH = 0;

    /* ---------- camera ---------- */
    this.camera = { x: CFG.W * 0.5, y: CFG.H * 0.5, zoom: 1 };
    this._view  = { left: 0, right: CFG.VIEW_W, top: 0, bottom: CFG.VIEW_H };

    /* ================================================================
       SCENE BUFFER  —  everything game-related renders here first,
       then _present() blits it to the visible canvas through the CRT
       post-process.  Sized to CFG.VIEW_* (the same coords the drawing
       code already uses).
       ================================================================ */
    this._scene = document.createElement('canvas');
    this._scene.width  = CFG.VIEW_W;
    this._scene.height = CFG.VIEW_H;
    this._sceneCtx = this._scene.getContext('2d', { alpha: false });

    /* ================================================================
       CRT RESOURCES
       ================================================================ */
    this.crtEnabled   = true;
    this.crtIntensity = 1.0;         /* 0..2 recommended */
    this._scanlines   = null;
    this._vignette    = null;
    this._crtRoll     = 0;
    this._buildScanlines();
    this._buildVignette();

    /* ================================================================
       FOOD SPRITE  (pre-rendered glowing pellet)
       ================================================================ */
    this._foodSprite = this._buildFoodSprite();

    /* ================================================================
       FOOD DIFF  —  two alternating Sets detect eaten pellets every
       frame and spawn an eat-pop at the last known position.  No
       external hook required; works for SP, MP, snapshots.
       ================================================================ */
    this._foodSeenA = new Set();
    this._foodSeenB = new Set();
    this._foodPops  = [];      /* { x, y, r, life, maxLife, phase } */
  }

  /* ============================================================
     CRT ASSET BUILDERS
     ============================================================ */
  _buildScanlines(){
    const W = CFG.VIEW_W, H = CFG.VIEW_H;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');

    /* horizontal dark scanlines every 3 px + faint bright edge */
    for(let y = 0; y < H; y += 3){
      g.fillStyle = 'rgba(0,0,0,0.32)';
      g.fillRect(0, y, W, 1);
      g.fillStyle = 'rgba(255,255,255,0.028)';
      g.fillRect(0, y + 1, W, 1);
    }
    /* aperture-grille tint: whisper of red and blue on alternating rows */
    for(let y = 1; y < H; y += 3){
      g.fillStyle = 'rgba(255,40,40,0.020)';
      g.fillRect(0, y, W, 1);
    }
    for(let y = 2; y < H; y += 3){
      g.fillStyle = 'rgba(40,140,255,0.020)';
      g.fillRect(0, y, W, 1);
    }
    this._scanlines = c;
  }

  _buildVignette(){
    const W = CFG.VIEW_W, H = CFG.VIEW_H;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');

    const grad = g.createRadialGradient(
      W * 0.5, H * 0.5, Math.min(W, H) * 0.30,
      W * 0.5, H * 0.5, Math.max(W, H) * 0.72
    );
    grad.addColorStop(0.00, 'rgba(0,0,0,0)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.10)');
    grad.addColorStop(0.80, 'rgba(0,0,0,0.42)');
    grad.addColorStop(1.00, 'rgba(0,0,0,0.85)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    /* faint cool rim glow top/bottom — reads as tube curvature highlight */
    const rim = g.createLinearGradient(0, 0, 0, H);
    rim.addColorStop(0.00, 'rgba(170,205,255,0.055)');
    rim.addColorStop(0.10, 'rgba(0,0,0,0)');
    rim.addColorStop(0.90, 'rgba(0,0,0,0)');
    rim.addColorStop(1.00, 'rgba(120,160,220,0.045)');
    g.fillStyle = rim;
    g.fillRect(0, 0, W, H);

    this._vignette = c;
  }

  _buildFoodSprite(){
    const S = 64;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    const cx = S * 0.5, cy = S * 0.5;

    /* --- soft outer glow: cool blue-white fading to nothing --- */
    const outer = g.createRadialGradient(cx, cy, 0, cx, cy, S * 0.5);
    outer.addColorStop(0.00, 'rgba(255,252,235,0.95)');
    outer.addColorStop(0.10, 'rgba(255,248,215,0.60)');
    outer.addColorStop(0.26, 'rgba(200,232,255,0.24)');
    outer.addColorStop(0.55, 'rgba(150,205,255,0.08)');
    outer.addColorStop(1.00, 'rgba(100,170,255,0)');
    g.fillStyle = outer;
    g.fillRect(0, 0, S, S);

    /* --- bright warm core --- */
    const core = g.createRadialGradient(cx, cy, 0, cx, cy, S * 0.16);
    core.addColorStop(0.0, 'rgba(255,255,255,1)');
    core.addColorStop(0.5, 'rgba(255,250,220,0.85)');
    core.addColorStop(1.0, 'rgba(255,240,200,0)');
    g.fillStyle = core;
    g.fillRect(0, 0, S, S);

    /* --- 4-point sparkle --- */
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.translate(cx, cy);
    for(let k = 0; k < 4; k++){
      g.rotate(Math.PI * 0.5);
      const grad = g.createLinearGradient(0, 0, 0, -S * 0.45);
      grad.addColorStop(0.0, 'rgba(255,255,255,0.75)');
      grad.addColorStop(0.4, 'rgba(255,250,220,0.35)');
      grad.addColorStop(1.0, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(-1.1, 0);
      g.lineTo( 0.0, -S * 0.45);
      g.lineTo( 1.1, 0);
      g.closePath();
      g.fill();
    }
    g.restore();

    return c;
  }

  /* ============================================================
     AMBIENT MOTES
     ============================================================ */
  _seedAmbient(n){
    this._ambient.length = 0;
    const W = CFG.W, H = CFG.H;
    for(let i = 0; i < n; i++){
      this._ambient.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 6 - 2,
        r: 0.4 + Math.random() * 1.4,
        a: 0.03 + Math.random() * 0.09,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  /* ============================================================
     FIT
     ============================================================ */
  fit(){
    const s = Math.min(window.innerWidth / CFG.VIEW_W, window.innerHeight / CFG.VIEW_H) * 0.98;
    const w = (CFG.VIEW_W * s) | 0;
    const h = (CFG.VIEW_H * s) | 0;
    if(w === this._lastFitW && h === this._lastFitH) return;
    this._lastFitW = w; this._lastFitH = h;
    this.canvas.style.width  = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  /* ============================================================
     TIMING + ADAPTIVE QUALITY
     ============================================================ */
  _tick(){
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const dt  = (now - this._lastTime) / 1000;
    this._lastTime = now;
    this._dt   = (dt > 0 && dt < 0.5) ? dt : 1/60;
    this._time = now * 0.001;

    this._fpsAccum += this._dt;
    this._fpsFrames++;

    if(this._fpsFrames >= 24){
      const avgDt = this._fpsAccum / this._fpsFrames;
      const fps = 1 / Math.max(0.001, avgDt);
      const nFish = this.eco && this.eco.fish ? this.eco.fish.length : 0;

      const multiplayer=!!(typeof window !== 'undefined'&&window.game&&window.game.online);
      let q;
      if(fps < 38 || nFish > (multiplayer?56:240)) q = 0;
      else if(fps < 52 || nFish > (multiplayer?72:150)) q = 1;
      else q = multiplayer ? 1 : 2;

      if(q < this.quality) this.quality = Math.max(q, this.quality - 1);
      else if(q > this.quality) this.quality = Math.min(q, this.quality + 1);

      this._fpsAccum = 0;
      this._fpsFrames = 0;
    }
  }

  /* ============================================================
     BACKGROUND
     ============================================================ */
  _buildBackground(){
    const W = CFG.VIEW_W, H = CFG.VIEW_H;
    if(this._bg && this._bgW === W && this._bgH === H) return;

    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');

    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#020305');
    grad.addColorStop(0.45, '#010204');
    grad.addColorStop(1, '#000000');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    const vg = g.createRadialGradient(
      W * 0.5, H * 0.5, Math.min(W, H) * 0.15,
      W * 0.5, H * 0.5, Math.max(W, H) * 0.75
    );
    vg.addColorStop(0, 'rgba(45,60,78,0.055)');
    vg.addColorStop(0.55, 'rgba(22,30,42,0.03)');
    vg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);

    g.fillStyle = 'rgba(48,52,58,0.55)';
    const s = 60;
    for(let x = s; x < W; x += s) for(let y = s; y < H; y += s) g.fillRect(x, y, 1, 1);

    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.lineWidth = 1;
    g.strokeRect(1, 1, W - 2, H - 2);

    this._bg = c;
    this._bgCtx = g;
    this._bgW = W;
    this._bgH = H;
  }

  /* ============================================================
     MAIN RENDER  —  scene → offscreen, then CRT present
     ============================================================ */
  render(){
    this.frame++;
    this._tick();
    this._buildBackground();

    const eco = this.eco;
    if(!eco) return;

    const ctx = this._sceneCtx;

    this._updateCamera(eco.player);

    /* Food diff runs before drawing so pops show the same frame a
       pellet disappears.  Cheap even at 60 fps with 360 pellets. */
    this._syncFoodPops();
    this._ageFoodPops(this._dt);

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.setLineDash([]);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineJoin = 'round';
    ctx.lineCap  = 'round';

    /* 1. background */
    ctx.drawImage(this._bg, 0, 0);

    ctx.save();
    ctx.translate(
      CFG.VIEW_W * 0.5 - this.camera.x * this.camera.zoom,
      CFG.VIEW_H * 0.5 - this.camera.y * this.camera.zoom
    );
    ctx.scale(this.camera.zoom, this.camera.zoom);

    /* 2. ambient */
    this._drawAmbient(ctx);

    /* 3. food + eat-pop buffer */
    this.drawFood(ctx);

    /* 4. intent */
    this.drawIntentLines(ctx);

    /* 5. fish */
    const list = this._sortedFishFor(eco.fish);
    const player = eco.player;

    if(this.quality > 0){
      for(let i = 0; i < list.length; i++){
        const f = list[i];
        if(!f.alive || !this._visible(f.pos, f.size * 4)) continue;
        this.drawFishShadow(ctx, f, player);
      }
    }
    for(let i = 0; i < list.length; i++){
      const f = list[i];
      if(!f.alive || !this._visible(f.pos, f.size * 4)) continue;
      this.drawFish(ctx, f);
    }

    /* 6. effects */
    this.drawShockwaves(ctx);
    this.drawParticles(ctx);
    this.drawCoinPops(ctx);

    ctx.restore();

    /* 7. screen-space overlays — still on the scene buffer so they
       get the CRT treatment too */
    this.drawOtherPlayerPointers(ctx, player);

    if(eco.flicker > 0){
      ctx.fillStyle = 'rgba(255,255,255,' + (eco.flickerStrength * 0.5) + ')';
      ctx.fillRect(0, 0, CFG.VIEW_W, CFG.VIEW_H);
    }

    /* 8. present through CRT shader */
    this._present();
  }

  /* ============================================================
     PRESENT  —  CRT post-process compositor
     ------------------------------------------------------------
     Order:
       black base  →  scene  →  chromatic-aberration ghosts
                   →  phosphor bloom  →  scanlines
                   →  vignette  →  rolling refresh bar  →  flicker
     ============================================================ */
  _present(){
    const ctx   = this.ctx;
    const scene = this._scene;
    const W     = CFG.VIEW_W;
    const H     = CFG.VIEW_H;
    const t     = this._time;
    const q     = this.quality;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.setLineDash([]);
    ctx.lineJoin = 'round';
    ctx.lineCap  = 'round';

    const multiplayer=!!(typeof window !== 'undefined'&&window.game&&window.game.online);
    if(!this.crtEnabled||multiplayer||q===0){
      ctx.drawImage(scene, 0, 0);
      return;
    }

    const k = this.crtIntensity;

    /* --- black base --- */
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    /* --- scene --- */
    ctx.drawImage(scene, 0, 0);

    /* --- chromatic aberration (two faint shifted ghosts) --- */
    if(q >= 1){
      const ca = 1.4 * k;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.080 * k;
      ctx.drawImage(scene, -ca, 0);
      ctx.globalAlpha = 0.060 * k;
      ctx.drawImage(scene,  ca, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    /* --- phosphor bloom (slightly enlarged faint copy) --- */
    if(q >= 2){
      const bl = 3;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.05 * k;
      ctx.drawImage(scene, -bl, -bl, W + bl * 2, H + bl * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    /* --- scanlines (multiply) --- */
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.90 * k;
    ctx.drawImage(this._scanlines, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    /* --- vignette --- */
    ctx.globalAlpha = 0.95 * k;
    ctx.drawImage(this._vignette, 0, 0);
    ctx.globalAlpha = 1;

    /* --- rolling refresh bar --- */
    if(q >= 1){
      this._crtRoll = (this._crtRoll + 1.9) % (H + 260);
      const rollY  = this._crtRoll - 130;
      const bandH  = 110;
      const rollGrad = ctx.createLinearGradient(0, rollY - bandH * 0.5, 0, rollY + bandH * 0.5);
      rollGrad.addColorStop(0.00, 'rgba(255,255,255,0)');
      rollGrad.addColorStop(0.45, 'rgba(180,220,255,' + (0.035 * k) + ')');
      rollGrad.addColorStop(0.55, 'rgba(210,235,255,' + (0.045 * k) + ')');
      rollGrad.addColorStop(1.00, 'rgba(255,255,255,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rollGrad;
      ctx.fillRect(0, rollY - bandH * 0.5, W, bandH);
      ctx.globalCompositeOperation = 'source-over';
    }

    /* --- subtle high-frequency flicker --- */
    if(q >= 1){
      const f  = 0.5 + 0.5 * Math.sin(t * 47.0) * Math.sin(t * 11.7);
      const fA = f * 0.020 * k;
      if(fA > 0.001){
        ctx.globalAlpha = fA;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
    }
  }

  /* ============================================================
     FOOD DIFF  —  detect eaten pellets, spawn fade pops
     ============================================================ */
  _syncFoodPops(){
    const prev = this._foodSeenA;
    const next = this._foodSeenB;

    next.clear();

    const food = this.eco && this.eco.food ? this.eco.food : null;
    if(food && food.length){
      for(let i = 0; i < food.length; i++){
        const fd = food[i];
        if(fd) next.add(fd);
      }
    }

    if(prev.size){
      for(const fd of prev){
        if(next.has(fd)) continue;
        const p = fd.pos || fd;
        if(!p || !isFinite(p.x) || !isFinite(p.y)) continue;

        this._foodPops.push({
          x: p.x,
          y: p.y,
          r: fd.r || 1.4,
          life: 0.32,
          maxLife: 0.32,
          phase: fd.phase || Math.random() * Math.PI * 2,
        });
      }
    }

    this._foodSeenA = next;
    this._foodSeenB = prev;
  }

  _ageFoodPops(dt){
    const arr = this._foodPops;
    if(!arr.length) return;
    let w = 0;
    for(let i = 0; i < arr.length; i++){
      const p = arr[i];
      p.life -= dt;
      if(p.life <= 0) continue;
      arr[w++] = p;
    }
    arr.length = w;
  }

  /* ============================================================
     FOOD  —  glowing sprite renderer + eat-pops
     ============================================================ */
  drawFood(ctx){
    const food = this.eco.food;
    const q = this.quality;
    const t = this._time;
    const sprite = this._foodSprite;

    /* ------------------------------------------------------------
       1. Draw live pellets.
       ------------------------------------------------------------ */
    if(food && food.length){
      const pulseT = t * 1.43;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      for(let i = 0; i < food.length; i++){
        const fd = food[i];
        if(!fd) continue;

        /* Accept both {pos:{x,y}} and flat {x,y} shapes so
           multiplayer pellets never get silently skipped. */
        const px = (fd.pos && isFinite(fd.pos.x)) ? fd.pos.x
                 : (isFinite(fd.x) ? fd.x : NaN);
        const py = (fd.pos && isFinite(fd.pos.y)) ? fd.pos.y
                 : (isFinite(fd.y) ? fd.y : NaN);
        if(!isFinite(px) || !isFinite(py)) continue;

        const baseR = fd.r || 1.4;

        /* per-pellet phase — use the field if provided, else derive
           one from the pellet's index so multiplayer food still
           shimmers instead of pulsing in lockstep. */
        const phase = (typeof fd.phase === 'number')
          ? fd.phase
          : (i * 1.37 + baseR * 3.1);

        const bob    = Math.sin(t * 1.9 + phase) * 0.35;
        const wobble = 1 + 0.08 * Math.sin(t * 3.1 + phase * 1.7);
        const pulse  = 0.5 + 0.5 * Math.sin(pulseT + phase);

        const x = px;
        const y = py + bob;

        if(q >= 1){
          /* Sprite is 64×64; its visible core is ~8 % of half-size.
             Scale so the visible pellet is a hair bigger than its
             collision radius, with the soft halo bleeding outward. */
          const half = baseR * (4.5 + 1.5 * pulse) * wobble;
          const d    = half * 2;
          const a    = 0.72 + 0.28 * pulse;

          ctx.globalAlpha = a;
          ctx.drawImage(sprite, x - half, y - half, d, d);
        } else {
          ctx.globalAlpha = 1;
          ctx.fillStyle = 'rgba(230,240,250,' + (0.75 + 0.25 * pulse) + ')';
          const r = baseR;
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    /* ------------------------------------------------------------
       2. Draw eat-pops (pellets that disappeared this frame).
       ------------------------------------------------------------ */
    const pops = this._foodPops;
    if(pops && pops.length){
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      for(let i = 0; i < pops.length; i++){
        const p  = pops[i];
        const lt = 1 - p.life / p.maxLife;    /* 0 → 1 */
        if(lt >= 1) continue;

        const alpha  = (1 - lt) * (1 - lt);   /* quick fade */
        const rr     = p.r * (1 + lt * 4.0);  /* expanding ring */
        const centre = p.r * (1 - lt * 0.6);  /* shrinking core */

        /* expanding ring — warm cream to match the pellet glow */
        ctx.strokeStyle = 'rgba(255,248,205,' + (alpha * 0.9) + ')';
        ctx.lineWidth   = 1.4 + (1 - lt) * 1.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
        ctx.stroke();

        /* cool outer echo */
        ctx.strokeStyle = 'rgba(180,220,255,' + (alpha * 0.35) + ')';
        ctx.lineWidth   = 0.9;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr * 1.35, 0, Math.PI * 2);
        ctx.stroke();

        /* bright inner flash */
        ctx.fillStyle = 'rgba(255,255,235,' + (alpha * 0.6) + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.2, centre), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  /* ============================================================
     INTENT LINES
     ============================================================ */
  drawIntentLines(ctx){
    const p = this.eco.player;
    if(!p || !p.alive || this.quality === 0) return;

    const R = p.visionRange * 1.05;
    const r2 = R * R;
    const fish = this.eco.fish;
    if(!fish) return;
    const pool = this._intentPool;
    pool.length = 0;

    const pDef = p.defSize ? p.defSize() : p.size;
    const px = p.pos.x, py = p.pos.y;

    for(let i = 0; i < fish.length; i++){
      const f = fish[i];
      if(!f.alive || f.isPlayer) continue;
      const dx = f.pos.x - px, dy = f.pos.y - py;
      const d2 = dx * dx + dy * dy;
      if(d2 > r2) continue;
      const d = Math.sqrt(d2);

      const st = f.state;
      if(st === 'CHASE' || st === 'INTERCEPT' || st === 'ATTACK' || st === 'STALK'){
        const fDef = f.defSize ? f.defSize() : f.size;
        const targetingPlayer = (f.target === p) ||
                                (f.target && f.target.alive && f.target.isPlayer);
        const bigger = fDef > pDef * 1.15;
        if(!targetingPlayer && !bigger) continue;
        const priority = (targetingPlayer ? 300 : 120) - d;
        pool.push({ src: f, dst: f.target, kind: 0, priority, dist: d });
      } else if(st === 'FLEE'){
        const fDef = f.defSize ? f.defSize() : f.size;
        if(fDef < pDef * 0.9) continue;
        pool.push({ src: f, dst: f.target, kind: 1, priority: 60 - d, dist: d });
      }
    }

    if(!pool.length) return;
    pool.sort((a, b) => b.priority - a.priority);
    const maxLines = this.quality >= 2 ? 12 : 6;
    const count = Math.min(maxLines, pool.length);

    ctx.lineWidth = 1;
    const invR = 1 / R;

    for(let i = 0; i < count; i++){
      const it = pool[i];
      const f = it.src;
      if(!f.alive) continue;
      const dst = it.dst;
      let tx, ty;
      if(dst && dst.alive && typeof f.predict === 'function'){
        const aim = f.predict(dst);
        if(aim && isFinite(aim.x) && isFinite(aim.y)){ tx = aim.x; ty = aim.y; }
      }
      if(tx === undefined){
        tx = f.pos.x + Math.cos(f.angle) * 90;
        ty = f.pos.y + Math.sin(f.angle) * 90;
      }
      const fade = 1 - Math.min(1, it.dist * invR);
      const a = fade * (it.kind === 0 ? 0.30 : 0.20);
      if(a < 0.02) continue;
      ctx.strokeStyle = 'rgba(255,255,255,' + a + ')';
      ctx.setLineDash(it.kind === 0 ? [4, 5] : [2, 6]);
      ctx.beginPath();
      ctx.moveTo(f.pos.x, f.pos.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  /* ============================================================
     SHOCKWAVES
     ============================================================ */
  drawShockwaves(ctx){
    const arr = this.eco.shockwaves;
    if(!arr || !arr.length) return;
    for(let i = 0; i < arr.length; i++){
      const s = arr[i];
      if(!s || !s.pos) continue;
      if(!isFinite(s.r) || s.r <= 0) continue;
      const life = s.maxLife > 0 ? clamp(s.life / s.maxLife, 0, 1) : 0;
      if(life <= 0.01) continue;

      const a = life * 0.75;
      ctx.strokeStyle = 'rgba(255,255,255,' + a + ')';
      ctx.lineWidth = 1 + 2.2 * life;
      ctx.beginPath();
      ctx.arc(s.pos.x, s.pos.y, s.r, 0, Math.PI * 2);
      ctx.stroke();

      if(this.quality >= 1 && s.r > 12){
        ctx.strokeStyle = 'rgba(170,215,255,' + (a * 0.42) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(s.pos.x, s.pos.y, s.r * 0.72, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  /* ============================================================
     COIN POPS
     ============================================================ */
  drawCoinPops(ctx){
    const arr = this.eco.coinPops;
    if(!arr || !arr.length) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 20px "Courier New", monospace';
    for(let i = 0; i < arr.length; i++){
      const c = arr[i];
      if(!c || !c.pos) continue;
      const a = clamp(c.life / c.maxLife, 0, 1);
      if(a <= 0.02) continue;
      ctx.fillStyle = 'rgba(0,0,0,' + (a * 0.5) + ')';
      ctx.fillText(c.text, c.pos.x + 1, c.pos.y + 1);
      ctx.fillStyle = 'rgba(255,204,68,' + a + ')';
      ctx.fillText(c.text, c.pos.x, c.pos.y);
    }
    ctx.restore();
  }

  /* ============================================================
     FISH SHADOW
     ============================================================ */
  drawFishShadow(ctx, fish, player){
    if(this.quality === 0) return;
    const sz = fish.size;
    if(!isFinite(sz) || sz <= 0) return;

    const r = Math.min(sz * 1.05, 240);

    if(!fish.isPlayer && player && player.alive && player.pos){
      const dx = fish.pos.x - player.pos.x;
      const dy = fish.pos.y - player.pos.y;
      if(this.quality < 2 && (dx * dx + dy * dy) > 540 * 540) return;
    }
    const off = 1 + Math.min(3, sz * 0.05);
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.beginPath();
    ctx.ellipse(fish.pos.x + off, fish.pos.y + off * 1.3, r, r * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ============================================================
     GEOMETRY PIPELINE
     ============================================================ */
  _grow(a, n){ while(a.length < n) a.push(0); }

  _resampleSpine(sp, len, sps){
    const CX = this._cx, CY = this._cy;
    const total = (len - 1) * sps + 1;
    this._grow(CX, total); this._grow(CY, total);

    let m = 0;
    for(let i = 0; i < len - 1; i++){
      const p0 = sp[i > 0 ? i - 1 : i];
      const p1 = sp[i];
      const p2 = sp[i + 1];
      const p3 = sp[i + 2 < len ? i + 2 : i + 1];
      const x0 = p0.x, y0 = p0.y;
      const x1 = p1.x, y1 = p1.y;
      const x2 = p2.x, y2 = p2.y;
      const x3 = p3.x, y3 = p3.y;
      const a0x = 2 * x1, a1x = x2 - x0, a2x = 2 * x0 - 5 * x1 + 4 * x2 - x3, a3x = -x0 + 3 * x1 - 3 * x2 + x3;
      const a0y = 2 * y1, a1y = y2 - y0, a2y = 2 * y0 - 5 * y1 + 4 * y2 - y3, a3y = -y0 + 3 * y1 - 3 * y2 + y3;
      for(let s = 0; s < sps; s++){
        const t = s / sps, t2 = t * t, t3 = t2 * t;
        CX[m] = 0.5 * (a0x + a1x * t + a2x * t2 + a3x * t3);
        CY[m] = 0.5 * (a0y + a1y * t + a2y * t2 + a3y * t3);
        m++;
      }
    }
    CX[m] = sp[len - 1].x;
    CY[m] = sp[len - 1].y;
    return m + 1;
  }

  _computeNormals(m){
    const CX = this._cx, CY = this._cy, NX = this._nx, NY = this._ny;
    this._grow(NX, m); this._grow(NY, m);
    for(let i = 0; i < m; i++){
      const i0 = i > 0 ? i - 1 : i;
      const i1 = i < m - 1 ? i + 1 : i;
      let dx = CX[i1] - CX[i0], dy = CY[i1] - CY[i0];
      const d = Math.hypot(dx, dy);
      if(d > 1e-6){ dx /= d; dy /= d; } else { dx = 1; dy = 0; }
      NX[i] = -dy; NY[i] = dx;
    }
  }

  _undulate(m, amp, phase, freq){
    if(!(amp > 0.01) || m < 3) return;
    const CX = this._cx, CY = this._cy, NX = this._nx, NY = this._ny;
    const inv = 1 / (m - 1);
    for(let i = 1; i < m; i++){
      const t = i * inv;
      const w = t * t;
      const off = amp * w * Math.sin(phase - t * freq);
      CX[i] += NX[i] * off;
      CY[i] += NY[i] * off;
    }
  }

  _computeWidths(m, profileKey, sz, phase){
    const CX = this._cx, CY = this._cy, HW = this._hw, SW = this._sw;
    this._grow(HW, m); this._grow(SW, m);

    const breathe = 1 + 0.02 * Math.sin(this._time * 2.1 + phase * 0.5);
    const hardMax = sz * 1.45;

    for(let i = 0; i < m; i++){
      const t = i / (m - 1);
      let w = widthAt(profileKey, t) * sz * breathe;
      if(!isFinite(w) || w < 0) w = 0;
      if(w > hardMax) w = hardMax;
      HW[i] = w;
    }

    for(let i = 1; i < m - 1; i++){
      const ax = CX[i] - CX[i - 1], ay = CY[i] - CY[i - 1];
      const bx = CX[i + 1] - CX[i], by = CY[i + 1] - CY[i];
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if(la < 1e-5 || lb < 1e-5) continue;
      let c = (ax * bx + ay * by) / (la * lb);
      if(c > 1) c = 1; else if(c < -1) c = -1;
      const ang = Math.acos(c);
      if(ang < 1e-4) continue;
      const R = ((la + lb) * 0.5) / (2 * Math.sin(ang * 0.5));
      const lim = R * 0.85;
      if(HW[i] > lim) HW[i] = lim;
    }

    for(let i = 0; i < m; i++) SW[i] = HW[i];
    for(let i = 1; i < m - 1; i++){
      HW[i] = SW[i] * 0.6 + (SW[i - 1] + SW[i + 1]) * 0.2;
    }
  }

  _buildOutline(m){
    const CX = this._cx, CY = this._cy, NX = this._nx, NY = this._ny, HW = this._hw;
    const TX = this._tx, TY = this._ty, BX = this._bx, BY = this._by;
    this._grow(TX, m); this._grow(TY, m); this._grow(BX, m); this._grow(BY, m);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for(let i = 0; i < m; i++){
      const w = HW[i], x = CX[i], y = CY[i];
      const ox = NX[i] * w, oy = NY[i] * w;
      const tx = x + ox, ty = y + oy, bx = x - ox, by = y - oy;
      TX[i] = tx; TY[i] = ty; BX[i] = bx; BY[i] = by;
      if(tx < minX) minX = tx;
      if(tx > maxX) maxX = tx;
      if(bx < minX) minX = bx;
      if(bx > maxX) maxX = bx;
      if(ty < minY) minY = ty;
      if(ty > maxY) maxY = ty;
      if(by < minY) minY = by;
      if(by > maxY) maxY = by;
    }
    this._minX = minX; this._maxX = maxX; this._minY = minY; this._maxY = maxY;
  }

  _curveForward(ctx, x, y, m){
    for(let i = 1; i < m - 1; i++){
      const mx = (x[i] + x[i + 1]) * 0.5;
      const my = (y[i] + y[i + 1]) * 0.5;
      ctx.quadraticCurveTo(x[i], y[i], mx, my);
    }
    if(m > 1) ctx.lineTo(x[m - 1], y[m - 1]);
  }
  _curveBackward(ctx, x, y, m){
    for(let i = m - 2; i > 0; i--){
      const mx = (x[i] + x[i - 1]) * 0.5;
      const my = (y[i] + y[i - 1]) * 0.5;
      ctx.quadraticCurveTo(x[i], y[i], mx, my);
    }
    if(m > 1) ctx.lineTo(x[0], y[0]);
  }

  _bodyPath(ctx, m){
    ctx.beginPath();
    ctx.moveTo(this._tx[0], this._ty[0]);
    this._curveForward(ctx, this._tx, this._ty, m);
    ctx.lineTo(this._bx[m - 1], this._by[m - 1]);
    this._curveBackward(ctx, this._bx, this._by, m);
    ctx.closePath();
  }

  /* ============================================================
     SORTED FISH
     ============================================================ */
  _sortedFishFor(fish){
    if(!fish) return [];
    const n = fish.length;
    const needResort =
      this._sortedFish === null ||
      this._lastFishCount !== n ||
      (this.frame - this._sortFrame) >= 12;

    if(needResort){
      if(this._sortedFish === null || this._sortedFish.length !== n){
        this._sortedFish = new Array(n);
      }
      for(let i = 0; i < n; i++) this._sortedFish[i] = fish[i];
      const a = this._sortedFish;
      for(let i = 1; i < n; i++){
        const v = a[i];
        let j = i - 1;
        while(j >= 0 && a[j].size > v.size){ a[j + 1] = a[j]; j--; }
        a[j + 1] = v;
      }
      this._lastFishCount = n;
      this._sortFrame = this.frame;
    }
    return this._sortedFish;
  }

  /* ============================================================
     AMBIENT PARTICLES
     ============================================================ */
  _drawAmbient(ctx){
    if(this.quality === 0) return;
    const arr = this._ambient;
    const dt = this._dt;
    const t = this._time;
    const W = CFG.W, H = CFG.H;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for(let i = 0; i < arr.length; i++){
      const p = arr[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if(p.x < -6) p.x = W + 6; else if(p.x > W + 6) p.x = -6;
      if(p.y < -6) p.y = H + 6; else if(p.y > H + 6) p.y = -6;
      const a = p.a * (0.55 + 0.45 * Math.sin(t * 0.7 + p.phase));
      ctx.fillStyle = 'rgba(180,200,220,' + a + ')';
      ctx.fillRect(p.x, p.y, p.r, p.r);
    }
    ctx.restore();
  }

  /* ============================================================
     CAMERA
     ============================================================ */
  _updateCamera(player){
    const target = (player && player.pos) ? player.pos : { x: CFG.W * 0.5, y: CFG.H * 0.5 };
    const stage = (player && player.stage) ? clamp(player.stage, 1, 4) : 1;
    const stageT = (stage - 1) / 3;
    const targetZoom = lerp(CFG.CAM_ZOOM_NEAR, CFG.CAM_ZOOM_FAR, stageT);
    this.camera.zoom = lerp(this.camera.zoom, targetZoom, CFG.CAM_LERP);
    const halfW = CFG.VIEW_W * 0.5 / this.camera.zoom;
    const halfH = CFG.VIEW_H * 0.5 / this.camera.zoom;
    this.camera.x = clamp(target.x, halfW, CFG.W - halfW);
    this.camera.y = clamp(target.y, halfH, CFG.H - halfH);
    this._view.left   = this.camera.x - halfW;
    this._view.right  = this.camera.x + halfW;
    this._view.top    = this.camera.y - halfH;
    this._view.bottom = this.camera.y + halfH;
  }

  _visible(pos, pad = 0){
    return pos &&
      pos.x >= this._view.left - pad &&
      pos.x <= this._view.right + pad &&
      pos.y >= this._view.top - pad &&
      pos.y <= this._view.bottom + pad;
  }

  /* ============================================================
     OTHER-PLAYER POINTERS  (now takes ctx; called on scene buffer)
     ============================================================ */
  drawOtherPlayerPointers(ctx, player){
    if(!player || !player.pos || !this.eco || !this.eco.fish) return;
    const cx = CFG.VIEW_W * 0.5, cy = CFG.VIEW_H * 0.5;
    const halfW = CFG.VIEW_W * 0.5 - 30, halfH = CFG.VIEW_H * 0.5 - 30;
    const pulse = 0.82 + Math.sin(this._time * 5) * 0.18;
    const zoom = this.camera.zoom;

    for(const fish of this.eco.fish){
      if(!fish.alive || !fish.isNetworkPlayer || !fish.pos) continue;
      const sx = cx + (fish.pos.x - this.camera.x) * zoom;
      const sy = cy + (fish.pos.y - this.camera.y) * zoom;
      const dx = sx - cx, dy = sy - cy;
      if(Math.abs(dx) <= halfW && Math.abs(dy) <= halfH) continue;
      const scale = Math.min(
        halfW / Math.max(1, Math.abs(dx)),
        halfH / Math.max(1, Math.abs(dy))
      );
      const x = cx + dx * scale, y = cy + dy * scale;
      const angle = Math.atan2(dy, dx);

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.22 * pulse;
      ctx.fillStyle = '#ffcc44';
      ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.95 * pulse;
      ctx.fillStyle = '#ffcc44';
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-8, -7);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-8, 7);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#fff3b0';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ============================================================
     FISH RENDER  (unchanged from v3)
     ============================================================ */
  drawFish(ctx, fish){
    if(!fish || !fish.alive) return;
    if(typeof fish.renderSpine !== 'function') return;

    const sp = fish.renderSpine();
    if(!sp) return;
    const n = sp.length;
    if(n < 2) return;

    const sz = fish.size;
    if(!isFinite(sz) || sz <= 0) return;

    for(let i = 0; i < n; i++){
      const p = sp[i];
      if(!p || !isFinite(p.x) || !isFinite(p.y)) return;
    }

    const isP = fish.isPlayer === true;
    const player = this.eco.player;

    let detail = 3;
    if(!isP){
      if(player && player.alive && player.pos){
        const dx = fish.pos.x - player.pos.x, dy = fish.pos.y - player.pos.y;
        const d2 = dx * dx + dy * dy;
        if(d2 > 940 * 940) detail = 0;
        else if(d2 > 600 * 600) detail = 1;
        else if(d2 > 300 * 300) detail = 2;
      } else detail = 2;
    }
    if(this.quality === 0) detail = detail > 1 ? 1 : detail;
    else if(this.quality === 1) detail = detail > 2 ? 2 : detail;

    const t = this._time;
    const phase = isFinite(fish.swimPhase) ? fish.swimPhase : t * 6;
    const vx = fish.vel ? fish.vel.x : 0;
    const vy = fish.vel ? fish.vel.y : 0;
    const speed = Math.hypot(vx, vy);
    const speedT = Math.min(1, speed / 280);
    const moving = speed > 4;

    const maxSamples = this.quality >= 2 ? 96 : 64;
    let sps = 1;
    if(sz > 16 && this.quality >= 1) sps = sz > 44 ? 3 : 2;
    if((n - 1) * sps + 1 > maxSamples) sps = Math.max(1, Math.floor((maxSamples - 1) / (n - 1)));

    const m = this._resampleSpine(sp, n, sps);
    if(m < 2) return;

    this._computeNormals(m);
    const undAmp = sz * (0.045 + 0.055 * speedT) * (isP ? 1.2 : 1) * (moving ? 1 : 0.45);
    this._undulate(m, undAmp, phase, 3.4 + 2.6 * speedT);
    this._computeNormals(m);

    this._computeWidths(m, fish.profileKey(), sz, phase);
    this._buildOutline(m);

    const alpha = fish.spawnTimer > 0 ? clamp(1 - fish.spawnTimer / 0.5, 0, 1) : 1;
    if(alpha <= 0.01) return;

    const bodyColor = fish.colorKey();
    const outlineStyle = isP ? '#ffea99' : '#ffffff';

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    let glowMul = isP ? 1 : 0.45;
    let bodyAlphaMul = 1;
    let outlineWidth = isP ? 1.4 : 1.1;
    let outlineDash = null;
    let striped = false;
    let holo = false;
    let reverse = false;
    const outlineOffset = 3;

    const skin = isP ? fish.skin : null;
    if(skin === 'ghost'){ glowMul = 1.6; bodyAlphaMul = 0.55; outlineWidth = 0.8; }
    else if(skin === 'glitch'){
      const gp = isFinite(fish.glitchPhase) ? fish.glitchPhase : t * 9;
      ctx.translate(Math.sin(gp * 1.7) * 1.8, Math.cos(gp * 2.1) * 1.8);
      outlineWidth = 1.4;
    }
    else if(skin === 'scanline'){ striped = true; }
    else if(skin === 'dotted'){ outlineDash = [3, 3]; outlineWidth = 1.5; }
    else if(skin === 'solid'){ outlineWidth = 0; }
    else if(skin === 'holo'){ outlineWidth = 2.2; holo = true; }
    else if(skin === 'reverse'){ bodyAlphaMul = 0; outlineWidth = 2.0; reverse = true; }

    if(this.quality >= 1 && (isP || detail >= 2)){
      const cap = this.quality >= 2 ? 150 : 80;
      const glowR = Math.min(sz * 2.4, cap);
      if(glowR > 1){
        const pulse = 0.85 + 0.15 * Math.sin(t * 2.6 + phase);
        const gA = (isP ? 0.30 : 0.09) * alpha * glowMul * pulse;
        if(gA > 0.004){
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = isP ? ('rgba(255,204,68,' + gA + ')') : ('rgba(200,225,255,' + gA + ')');
          ctx.beginPath();
          ctx.arc(fish.pos.x, fish.pos.y, glowR, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }

    if(fish.evolveAnim > 0 && this.quality >= 1){
      const et = 1 - fish.evolveAnim / CFG.EVO_DUR;
      const rings = this.quality >= 2 ? 3 : 2;
      const reach = Math.min(sz * 5, 260);
      for(let i = 0; i < rings; i++){
        const lt = (et + i * 0.2) % 1;
        const rr = sz * 1.6 + lt * reach;
        if(!isFinite(rr) || rr <= 0) continue;
        const aa = (1 - lt) * 0.85 * alpha;
        ctx.strokeStyle = isP ? ('rgba(255,204,68,' + aa + ')') : ('rgba(255,255,255,' + aa + ')');
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(fish.pos.x, fish.pos.y, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if(holo){
      ctx.save();
      ctx.globalAlpha = alpha * 0.55;
      ctx.translate(outlineOffset, outlineOffset);
      this._bodyPath(ctx, m);
      ctx.strokeStyle = isP ? 'rgba(255,204,68,0.6)' : 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    this._bodyPath(ctx, m);

    if(bodyAlphaMul > 0){
      ctx.globalAlpha = alpha * bodyAlphaMul;
      ctx.fillStyle = bodyColor;
      ctx.fill();
    }
    ctx.globalAlpha = alpha;

    if(detail >= 2 && this.quality >= 1 && bodyAlphaMul > 0){
      const CX = this._cx, CY = this._cy;

      ctx.beginPath();
      ctx.moveTo(this._tx[0], this._ty[0]);
      this._curveForward(ctx, this._tx, this._ty, m);
      ctx.lineTo(CX[m - 1], CY[m - 1]);
      for(let i = m - 2; i >= 0; i--) ctx.lineTo(CX[i], CY[i]);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(this._bx[0], this._by[0]);
      this._curveForward(ctx, this._bx, this._by, m);
      ctx.lineTo(CX[m - 1], CY[m - 1]);
      for(let i = m - 2; i >= 0; i--) ctx.lineTo(CX[i], CY[i]);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fill();
    }

    this._bodyPath(ctx, m);
    if(reverse){
      ctx.strokeStyle = isP ? PLAYER_COLOR : '#dcdcdc';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    } else if(outlineWidth > 0){
      ctx.strokeStyle = outlineStyle;
      ctx.lineWidth = outlineWidth;
      if(outlineDash) ctx.setLineDash(outlineDash);
      ctx.stroke();
      if(outlineDash) ctx.setLineDash([]);
    }

    if(detail >= 3 && this.quality >= 2 && bodyAlphaMul > 0){
      ctx.beginPath();
      ctx.moveTo(this._tx[0], this._ty[0]);
      this._curveForward(ctx, this._tx, this._ty, m);
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if(striped && detail >= 2){
      ctx.save();
      this._bodyPath(ctx, m);
      ctx.clip();
      ctx.strokeStyle = isP ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.9)';
      ctx.lineWidth = 1.4;
      const step = 5;
      const y0 = this._minY, y1 = this._maxY;
      const x0 = this._minX - 4, x1 = this._maxX + 4;
      for(let y = y0; y < y1; y += step){
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
      }
      ctx.restore();
    }

    if(detail >= 1){
      this.drawDorsal(ctx, fish, m, bodyColor, outlineStyle);
      this.drawTail(ctx, fish, m, bodyColor, outlineStyle);
    }
    if(detail >= 2){
      this.drawPectoral(ctx, fish, m, bodyColor, outlineStyle);
      this.drawEye(ctx, fish, m, isP, phase);
    }
    if(fish.lineage && fish.lineage.lure && detail >= 1){
      this.drawLure(ctx, fish, m);
    }

    if(isP){
      ctx.strokeStyle = 'rgba(255,204,68,0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(fish.pos.x, fish.pos.y, fish.size * 1.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      if(this.quality >= 1){
        ctx.strokeStyle = 'rgba(255,204,68,0.06)';
        ctx.beginPath();
        ctx.arc(fish.pos.x, fish.pos.y, fish.visionRange, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  /* ============================================================
     LURE
     ============================================================ */
  drawLure(ctx, fish, m){
    if(m < 2) return;
    const CX = this._cx, CY = this._cy;
    const headX = CX[0], headY = CY[0];
    let dx = headX - CX[1], dy = headY - CY[1];
    const d = Math.hypot(dx, dy);
    if(d < 1e-5){ dx = 1; dy = 0; } else { dx /= d; dy /= d; }
    const px = -dy, py = dx;

    const sz = fish.size;
    const lp = isFinite(fish.lurePhase) ? fish.lurePhase : this._time * 4;
    const sway = Math.sin(lp) * 0.5;
    const reach = Math.min(sz * 1.6, 120);
    const lx = headX + dx * reach + px * sway * sz * 0.6;
    const ly = headY + dy * reach + py * sway * sz * 0.6;
    const isP = fish.isPlayer === true;

    ctx.strokeStyle = isP ? 'rgba(255,204,68,0.5)' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(headX, headY);
    ctx.lineTo(lx, ly);
    ctx.stroke();

    const pulse = 0.6 + 0.4 * Math.sin(lp * 2);
    const r = Math.max(2, Math.min(sz * 0.4, 26)) * pulse;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gA = 0.35 * pulse;
    ctx.fillStyle = isP ? ('rgba(255,204,68,' + gA + ')') : ('rgba(255,255,255,' + gA + ')');
    ctx.beginPath();
    ctx.arc(lx, ly, r * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = isP ? PLAYER_COLOR : '#fff';
    ctx.beginPath();
    ctx.arc(lx, ly, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ============================================================
     DORSAL FIN
     ============================================================ */
  drawDorsal(ctx, fish, m, bodyColor, outlineStyle){
    const style = (typeof fish.dorsalKey === 'function') ? fish.dorsalKey() : 'none';
    if(style === 'none' || m < 5) return;

    let pos = 0.35;
    if(style === 'rear') pos = 0.74;
    else if(style === 'crest') pos = 0.5;

    const CX = this._cx, CY = this._cy, TX = this._tx, TY = this._ty;
    const idx = Math.max(1, Math.min(m - 2, Math.round(pos * (m - 1))));
    const pX = TX[idx], pY = TY[idx];

    let dx = CX[idx + 1] - CX[idx - 1], dy = CY[idx + 1] - CY[idx - 1];
    const d = Math.hypot(dx, dy);
    if(d < 1e-5){ dx = 1; dy = 0; } else { dx /= d; dy /= d; }
    const nx = -dy, ny = dx;

    const sgn = (nx * (pX - CX[idx]) + ny * (pY - CY[idx])) >= 0 ? 1 : -1;
    const ox = nx * sgn, oy = ny * sgn;

    const sz = fish.size;
    const ph = isFinite(fish.swimPhase) ? fish.swimPhase : this._time * 6;
    const sway = Math.sin(ph * 1.35) * 0.10;

    ctx.fillStyle = bodyColor;
    ctx.strokeStyle = outlineStyle;
    ctx.lineWidth = 0.9;

    if(style === 'crest'){
      const i0 = Math.max(1, Math.round(m * 0.16));
      const i1 = Math.max(i0 + 1, Math.round(m * 0.92));
      ctx.beginPath();
      ctx.moveTo(TX[i0], TY[i0]);
      for(let i = i0; i <= i1; i++){
        const tt = (i - i0) / (i1 - i0);
        const h = sz * (0.30 + 0.30 * Math.sin(tt * Math.PI) + sway * (0.5 + 0.5 * tt));
        const a0 = i > 1 ? i - 1 : i;
        const a1 = i < m - 1 ? i + 1 : i;
        let tx1 = TX[a1] - TX[a0], ty1 = TY[a1] - TY[a0];
        const dl = Math.hypot(tx1, ty1);
        if(dl < 1e-5){ tx1 = 1; ty1 = 0; } else { tx1 /= dl; ty1 /= dl; }
        let onx = -ty1, ony = tx1;
        if(onx * (TX[i] - CX[i]) + ony * (TY[i] - CY[i]) < 0){ onx = -onx; ony = -ony; }
        ctx.lineTo(TX[i] + onx * h, TY[i] + ony * h);
      }
      for(let i = i1; i >= i0; i--) ctx.lineTo(TX[i], TY[i]);
      ctx.closePath();
      ctx.fill();
      if(outlineStyle) ctx.stroke();
      return;
    }

    if(style === 'tiny'){
      const h = sz * (0.28 + sway * 0.4);
      ctx.beginPath();
      ctx.moveTo(pX - dx * sz * 0.26 - ox * sz * 0.02, pY - dy * sz * 0.26 - oy * sz * 0.02);
      ctx.lineTo(pX + ox * h, pY + oy * h);
      ctx.lineTo(pX + dx * sz * 0.26 - ox * sz * 0.02, pY + dy * sz * 0.26 - oy * sz * 0.02);
      ctx.closePath();
      ctx.fill();
      if(outlineStyle) ctx.stroke();
      return;
    }

    if(style === 'rear'){
      const h = sz * (0.35 + sway * 0.5);
      ctx.beginPath();
      ctx.moveTo(pX - dx * sz * 0.20 - ox * sz * 0.05, pY - dy * sz * 0.20 - oy * sz * 0.05);
      ctx.quadraticCurveTo(pX + ox * h + dx * sz * 0.05, pY + oy * h + dy * sz * 0.05,
                           pX + dx * sz * 0.22, pY + dy * sz * 0.22);
      ctx.closePath();
      ctx.fill();
      if(outlineStyle) ctx.stroke();
      return;
    }

    const segs = style === 'spike' ? 3 : 4;
    const span = sz * (style === 'spike' ? 1.1 : 0.95);
    const baseH = style === 'spike' ? 0.85 : 0.5;
    ctx.beginPath();
    ctx.moveTo(pX - dx * span * 0.45, pY - dy * span * 0.45);
    for(let i = 0; i < segs; i++){
      const f = (i + 0.5) / segs;
      const taper = 1 - 0.45 * Math.abs(f - 0.5) * 2;
      const h = sz * (baseH + sway * 1.2) * taper;
      const bx0 = pX + dx * span * (f - 0.45);
      const by0 = pY + dy * span * (f - 0.45);
      ctx.quadraticCurveTo(bx0 + ox * h * 0.35, by0 + oy * h * 0.35,
                           bx0 + ox * h, by0 + oy * h);
      ctx.lineTo(bx0 + dx * span * 0.14, by0 + dy * span * 0.14);
    }
    ctx.lineTo(pX + dx * span * 0.55, pY + dy * span * 0.55);
    ctx.closePath();
    ctx.fill();
    if(outlineStyle) ctx.stroke();
  }

  /* ============================================================
     TAIL
     ============================================================ */
  drawTail(ctx, fish, m, bodyColor, outlineStyle){
    if(m < 2) return;
    const CX = this._cx, CY = this._cy;
    const t0 = m - 1, t1 = m - 2;
    let dx = CX[t0] - CX[t1], dy = CY[t0] - CY[t1];
    const d = Math.hypot(dx, dy);
    if(d < 1e-5){ dx = 1; dy = 0; } else { dx /= d; dy /= d; }
    const px = -dy, py = dx;

    const sz = fish.size;
    const style = (typeof fish.shapeKey === 'function') ? fish.shapeKey() : 'forked';
    const ph = isFinite(fish.swimPhase) ? fish.swimPhase : this._time * 6;
    const speed = fish.vel ? Math.hypot(fish.vel.x, fish.vel.y) : 0;

    const sweep = Math.sin(ph * 1.6 - 0.9) * (0.08 + Math.min(0.26, speed * 0.0055));
    const cs = Math.cos(sweep), sn = Math.sin(sweep);
    const fdx = dx * cs - px * sn, fdy = dy * cs - py * sn;
    const fpx = -fdy, fpy = fdx;

    const rootX = CX[t0], rootY = CY[t0];
    const L = Math.min(sz * 1.35, 160);
    const S = Math.min(sz * (style === 'fan' ? 1.25 : 1.0), 150);

    const rip = Math.sin(ph * 2.2) * 0.12;
    const upS = S * (0.85 + rip);
    const dnS = S * (0.85 - rip);

    const tipLx = rootX + fdx * L * 0.65 + fpx * upS, tipLy = rootY + fdy * L * 0.65 + fpy * upS;
    const tipRx = rootX + fdx * L * 0.65 - fpx * dnS, tipRy = rootY + fdy * L * 0.65 - fpy * dnS;
    const notchX = rootX + fdx * L * 0.48, notchY = rootY + fdy * L * 0.48;
    const endX = rootX + fdx * L, endY = rootY + fdy * L;

    ctx.fillStyle = bodyColor;
    ctx.strokeStyle = outlineStyle;
    ctx.lineWidth = 1;

    ctx.beginPath();
    if(style === 'fan'){
      ctx.moveTo(rootX, rootY);
      ctx.quadraticCurveTo(rootX + fdx * L * 0.5 + fpx * S * 0.9,
                           rootY + fdy * L * 0.5 + fpy * S * 0.9, endX, endY);
      ctx.quadraticCurveTo(rootX + fdx * L * 0.5 - fpx * S * 0.9,
                           rootY + fdy * L * 0.5 - fpy * S * 0.9, rootX, rootY);
    } else if(style === 'crescent'){
      ctx.moveTo(rootX, rootY);
      ctx.quadraticCurveTo(rootX + fdx * L * 0.35 + fpx * S * 1.15,
                           rootY + fdy * L * 0.35 + fpy * S * 1.15, tipLx, tipLy);
      ctx.quadraticCurveTo(rootX + fdx * L * 0.72, rootY + fdy * L * 0.72, notchX, notchY);
      ctx.quadraticCurveTo(rootX + fdx * L * 0.72, rootY + fdy * L * 0.72, tipRx, tipRy);
      ctx.quadraticCurveTo(rootX + fdx * L * 0.35 - fpx * S * 1.15,
                           rootY + fdy * L * 0.35 - fpy * S * 1.15, rootX, rootY);
    } else if(style === 'spike'){
      ctx.moveTo(rootX, rootY);
      ctx.lineTo(tipLx, tipLy);
      ctx.lineTo(rootX + fdx * L * 0.62 + fpx * S * 0.28, rootY + fdy * L * 0.62 + fpy * S * 0.28);
      ctx.lineTo(rootX + fdx * L * 0.95, rootY + fdy * L * 0.95);
      ctx.lineTo(rootX + fdx * L * 0.62 - fpx * S * 0.28, rootY + fdy * L * 0.62 - fpy * S * 0.28);
      ctx.lineTo(tipRx, tipRy);
    } else {
      ctx.moveTo(rootX, rootY);
      ctx.quadraticCurveTo(rootX + fdx * L * 0.3 + fpx * S * 0.55,
                           rootY + fdy * L * 0.3 + fpy * S * 0.55, tipLx, tipLy);
      ctx.lineTo(notchX, notchY);
      ctx.lineTo(tipRx, tipRy);
      ctx.quadraticCurveTo(rootX + fdx * L * 0.3 - fpx * S * 0.55,
                           rootY + fdy * L * 0.3 - fpy * S * 0.55, rootX, rootY);
    }
    ctx.closePath();
    ctx.fill();
    if(outlineStyle) ctx.stroke();
  }

  /* ============================================================
     PECTORAL FINS
     ============================================================ */
  drawPectoral(ctx, fish, m, bodyColor, outlineStyle){
    if(m < 5) return;
    const CX = this._cx, CY = this._cy;
    const idx = Math.max(1, Math.min(m - 2, Math.round(m * 0.30)));
    const pX = CX[idx], pY = CY[idx];

    let dx = CX[idx + 1] - CX[idx - 1], dy = CY[idx + 1] - CY[idx - 1];
    const d = Math.hypot(dx, dy);
    if(d < 1e-5){ dx = 1; dy = 0; } else { dx /= d; dy /= d; }
    const nx = -dy, ny = dx;

    const sz = fish.size;
    const ph = isFinite(fish.swimPhase) ? fish.swimPhase : this._time * 6;
    const st = fish.state;

    let amp = 0.35, freq = 1.8;
    if(st === 'FLEE'){ amp = 0.62; freq = 3.0; }
    else if(st === 'CHASE' || st === 'ATTACK' || st === 'INTERCEPT'){ amp = 0.52; freq = 2.6; }
    else if(st === 'STALK'){ amp = 0.20; freq = 1.2; }

    const sides = (this.quality >= 2 && m > 9) ? 2 : 1;

    for(let s = 0; s < sides; s++){
      const sgn = s === 0 ? 1 : -1;
      const flap = Math.sin(ph * freq + sgn * 1.1) * amp;
      const ax = nx * sgn, ay = ny * sgn;
      const ang = Math.atan2(ay, ax) + flap * sgn;

      ctx.save();
      ctx.translate(pX, pY);
      ctx.rotate(ang);
      ctx.globalAlpha *= (s === 0 ? 0.85 : 0.6);

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(sz * 0.55, sz * 0.45, sz * 0.75, sz * 0.10);
      ctx.quadraticCurveTo(sz * 0.40, -sz * 0.25, -sz * 0.10, 0);
      ctx.closePath();

      ctx.fillStyle = bodyColor;
      ctx.fill();
      if(outlineStyle){
        ctx.strokeStyle = outlineStyle;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /* ============================================================
     EYE
     ============================================================ */
  drawEye(ctx, fish, m, isP, phase){
    if(m < 3) return;
    const CX = this._cx, CY = this._cy;
    const pX = CX[1], pY = CY[1];

    let dx = pX - CX[0], dy = pY - CY[0];
    const d = Math.hypot(dx, dy);
    if(d < 1e-5){ dx = 1; dy = 0; } else { dx /= d; dy /= d; }
    const nx = -dy, ny = dx;

    const sz = fish.size;
    const r = Math.max(1.2, Math.min(sz * 0.16, sz * 0.10 + Math.sqrt(sz) * 0.55));

    const hw1 = this._hw[1] !== undefined ? this._hw[1] : sz * 0.4;
    const off = Math.min(sz * 0.30, hw1 * 0.55);
    const ex = pX + nx * off, ey = pY + ny * off;

    let lookX = dx, lookY = dy;
    const tg = fish.target;
    if(tg && tg.pos && isFinite(tg.pos.x) && isFinite(tg.pos.y)){
      const ax = tg.pos.x - ex, ay = tg.pos.y - ey;
      const al = Math.hypot(ax, ay);
      if(al > 1e-3){ lookX = ax / al; lookY = ay / al; }
    }

    const lowE = fish.maxEnergy > 0 && (fish.energy / fish.maxEnergy) < 0.22;
    const aggressive = (typeof fish.aggression === 'function' && fish.aggression() > 0.7)
                     || isP || fish.state === 'ATTACK';
    const alert = (fish.state === 'FLEE' || fish.state === 'STALK');

    if(aggressive && !lowE){
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = isP ? 'rgba(255,204,68,0.55)' : 'rgba(255,255,255,0.36)';
      ctx.beginPath();
      ctx.arc(ex, ey, r * 2.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if(alert){
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(220,220,220,0.22)';
      ctx.beginPath();
      ctx.arc(ex, ey, r * 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if(fish.blinkAnim > 0){
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ex - r, ey);
      ctx.lineTo(ex + r, ey);
      ctx.stroke();
      return;
    }

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ex, ey, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = isP ? '#221100' : '#000';
    ctx.beginPath();
    ctx.arc(ex + lookX * r * 0.30, ey + lookY * r * 0.30, r * 0.55, 0, Math.PI * 2);
    ctx.fill();

    if(r > 1.8 && this.quality >= 1){
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(ex + lookX * r * 0.30 - r * 0.18,
              ey + lookY * r * 0.30 - r * 0.18, r * 0.17, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ============================================================
     PARTICLES
     ============================================================ */
  drawParticles(ctx){
    const arr = this.eco.particles;
    if(!arr || !arr.length) return;
    const q = this.quality;
    const cap = q === 0 ? 200 : (q === 1 ? 500 : 900);
    const n = Math.min(arr.length, cap);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for(let i = 0; i < n; i++){
      const p = arr[i];
      if(!p || !p.pos) continue;
      const a = clamp(p.life / p.maxLife, 0, 1);
      if(a <= 0.02) continue;

      const isFood = p.food === true;
      const sz = isFood ? (1.2 + a * 1.4) : (0.95 + a * 1.15);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.player
        ? ('rgba(255,204,68,' + a + ')')
        : ('rgba(255,255,255,' + a + ')');
      ctx.fillRect(p.pos.x - sz * 0.5, p.pos.y - sz * 0.5, sz, sz);
    }
    ctx.restore();
  }
}