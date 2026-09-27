"use strict";

/* ================================================================
   Eco — rework v3 (Shoal removed)
   ================================================================ */

(function () {
  "use strict";

  const SPAWN_WEIGHTS = {
    koi:        14,
    swift:      12,
    armor:       9,
    manta:       9,
    serpent:     7,
    eel:         7,
    jelly:       8,
    puffer:      6,
    predator:    9,
    piranha:     6,
    barracuda:   5,
    swordfish:   4,
    angler:      4,
    abyss:       3,
    leviathan:   1,
  };

  const SPAWN_KEYS  = Object.keys(SPAWN_WEIGHTS);
  const SPAWN_TOTAL = SPAWN_KEYS.reduce((s, k) => s + SPAWN_WEIGHTS[k], 0);

  const POP_CAPS = {
    leviathan: 2,
    abyss:     4,
    swordfish: 5,
    angler:    5,
    barracuda: 6,
    piranha:  12,
  };

  class Eco {
    constructor(profile){
      this.profile = profile;

      this.fish       = [];
      this.food       = [];
      this.particles  = [];
      this.shockwaves = [];
      this.coinPops   = [];
      this.corpses    = [];

      // Legacy compatibility: game-controller still clears this.
      // Eco v3 removed the Shoal system, but startOnline() still does:
      // this.eco.shoals.length = 0;
      this.shoals     = [];

      this.input  = null;
      this.player = null;

      this.flicker        = 0;
      this.flickerStrength= 0;
      this.spawnTimer     = 0;
      this.foodAccum      = 0;
      this.time           = 0;
      this.playerParticleTimer = 0;
      this.gameOver       = false;
      this.pendingCoins   = 0;
      this._openingDensity= true;
      this.onPlayerDeath  = null;
      this.onPlayerEvolve = null;

      this._cell    = 96;
      this._cols    = Math.ceil(CFG.W / this._cell);
      this._rows    = Math.ceil(CFG.H / this._cell);
      this._cellN   = this._cols * this._rows;
      this._fishGrid = new Array(this._cellN);
      this._foodGrid = new Array(this._cellN);
      for(let i = 0; i < this._cellN; i++){
        this._fishGrid[i] = [];
        this._foodGrid[i] = [];
      }
      this._foodGridStamp = -1;

      this._particlePool = [];
      this._particlePoolMax = 1024;

      this.perf = { predChecks: 0, foodChecks: 0, gridFrame: 0 };

      this._removedFish   = [];
      this._removedFood   = [];
    }

    reset(playerLineage){
      this.fish.length       = 0;
      this.food.length       = 0;
      this.particles.length  = 0;
      this.shockwaves.length = 0;
      this.coinPops.length   = 0;
      this.corpses.length    = 0;

      // Legacy compatibility: game-controller still clears this.
      this.shoals.length     = 0;

      for(let i = 0; i < this._cellN; i++){
        this._fishGrid[i].length = 0;
        this._foodGrid[i].length = 0;
      }
      this._foodGridStamp = -1;

      this.time = 0;
      this.gameOver = false;
      this._openingDensity = true;
      this.flicker = 0;
      this.flickerStrength = 0;
      this.spawnTimer = 0;
      this.foodAccum = 0;
      this.pendingCoins = 0;
      this.playerParticleTimer = 0;

      const lin = LINEAGES[playerLineage];
      const stageIdx = Math.min(this.profile.startStage, lin.stages.length - 1);
      const startSize = lin.stages[stageIdx].size;

      const p = new Fish(CFG.W / 2, CFG.H / 2, startSize, playerLineage, true, this.profile.skin);
      p.maxEnergy = (100 + p.size * 10) * this.profile.energyMult;
      p.energy    = CFG.P_NRJ * this.profile.energyMult;
      p.onEvolve  = (a, b) => { if(this.onPlayerEvolve) this.onPlayerEvolve(a, b); };
      p.checkEvolve();
      this.player = p;
      this.fish.push(p);

      for(let i = this.food.length; i < CFG.FOOD_OPENING_TGT; i++) this.spawnFood(true);

      this._seedOpeningPopulation(playerLineage);

      this._openingDensity = false;
    }

    pickLineage(){
      let r = Math.random() * SPAWN_TOTAL;
      for(let i = 0; i < SPAWN_KEYS.length; i++){
        r -= SPAWN_WEIGHTS[SPAWN_KEYS[i]];
        if(r <= 0) return SPAWN_KEYS[i];
      }
      return SPAWN_KEYS[0];
    }

    _atCap(lk){
      const cap = POP_CAPS[lk];
      if(cap === undefined) return false;
      let n = 0;
      const list = this.fish;
      for(let i = 0; i < list.length; i++){
        if(list[i].lineageKey === lk && list[i].alive && !list[i].isPlayer){
          if(++n >= cap) return true;
        }
      }
      return false;
    }

    _seedOpeningPopulation(playerLineage){
      const target = Math.min(CFG.MAX_FISH - 6, 62);

      for(const lk of LINEAGE_KEYS){
        if(this.fish.length >= target) break;
        this.spawnFish(lk, rand(4, 9), true);
      }

      for(let i = 0; i < 4 && this.fish.length < target; i++){
        this.spawnFish(playerLineage, i < 2 ? rand(4, 9) : rand(12, 20), true);
      }

      let guard = 0;
      while(this.fish.length < target && guard++ < 300){
        const lk = this.pickLineage();
        if(this._atCap(lk)) continue;
        const roll = Math.random();
        const size = roll < 0.72 ? rand(4, 9)
                   : roll < 0.94 ? rand(13, 20)
                   :                rand(24, 34);
        this.spawnFish(lk, size, true);
      }

      if(this.fish.length < CFG.MAX_FISH){
        const apexPool = ['abyss','leviathan','serpent','armor','predator'];
        const apex = apexPool[rInt(0, apexPool.length - 1)];
        this.spawnFish(apex, rand(58, 72), false);
      }
    }

    spawnFood(nearPlayer = !!this.player){
      const target = nearPlayer ? CFG.FOOD_OPENING_TGT : CFG.FOOD_TGT;
      if(this.food.length >= target) return;

      let x, y;
      if(nearPlayer && this.player){
        const a = Math.random() * TAU;
        const d = rand(CFG.FOOD_OPENING_MIN_DISTANCE, CFG.FOOD_OPENING_RADIUS);
        x = clamp(this.player.pos.x + Math.cos(a) * d, 30, CFG.W - 30);
        y = clamp(this.player.pos.y + Math.sin(a) * d, 30, CFG.H - 30);
      } else {
        x = rand(30, CFG.W - 30);
        y = rand(30, CFG.H - 30);
      }

      this.food.push({
        pos:   { x, y },
        r:     rand(0.9, 1.8),
        phase: Math.random() * TAU,
        drift: { x: rand(-4, 4), y: rand(-4, 4) },
      });
      this._foodGridStamp = -1;
    }

    spawnFish(lineageKey, size, nearPlayer = this._openingDensity){
      if(this.fish.length >= CFG.MAX_FISH) return null;

      const m = 60;
      let x, y, tries = 0;

      if(nearPlayer && this.player){
        do{
          const a = Math.random() * TAU;
          const d = rand(CFG.START_FISH_MIN_DISTANCE, CFG.START_FISH_RADIUS);
          x = clamp(this.player.pos.x + Math.cos(a) * d, m, CFG.W - m);
          y = clamp(this.player.pos.y + Math.sin(a) * d, m, CFG.H - m);
          tries++;
        } while(Math.hypot(x - this.player.pos.x, y - this.player.pos.y) < CFG.START_FISH_MIN_DISTANCE && tries < 14);
      } else {
        do{
          const side = rInt(0, 3);
          if(side === 0){ x = rand(m, CFG.W - m); y = m; }
          else if(side === 1){ x = CFG.W - m; y = rand(m, CFG.H - m); }
          else if(side === 2){ x = rand(m, CFG.W - m); y = CFG.H - m; }
          else { x = m; y = rand(m, CFG.H - m); }
          tries++;
        } while(this.player && Math.hypot(x - this.player.pos.x, y - this.player.pos.y) < 300 && tries < 14);
      }

      const f = new Fish(x, y, size, lineageKey, false);
      this.fish.push(f);
      this._spawnParticlesAt(x, y, 5, 'ai');
      return f;
    }

    /* Cheat: spawn a cluster of fish of one lineage. No Shoal object. */
    spawnShoal(lineageKey, count = CFG.CHEAT_SHOAL_COUNT){
      if(!this.player || !this.player.alive) return 0;
      const m = 60;

      const centreA = Math.random() * TAU;
      const centreD = rand(CFG.CHEAT_SHOAL_MIN_DISTANCE + 60, CFG.CHEAT_SHOAL_RADIUS);
      const cx = clamp(this.player.pos.x + Math.cos(centreA) * centreD, m, CFG.W - m);
      const cy = clamp(this.player.pos.y + Math.sin(centreA) * centreD, m, CFG.H - m);

      let spawned = 0;
      for(let i = 0; i < count && this.fish.length < CFG.MAX_FISH; i++){
        const a = Math.random() * TAU;
        const d = rand(20, CFG.CHEAT_SHOAL_RADIUS * 0.35);
        const x = clamp(cx + Math.cos(a) * d, m, CFG.W - m);
        const y = clamp(cy + Math.sin(a) * d, m, CFG.H - m);

        const f = new Fish(x, y, rand(4, 9), lineageKey, false);
        f.angle       = a + Math.PI;
        f.wanderAngle = f.angle;
        this.fish.push(f);
        this._spawnParticlesAt(x, y, 3, 'ai');
        spawned++;
      }
      return spawned;
    }

    _spawnParticlesAt(x, y, n, kind){
      const isPlayer = kind === 'player';
      const isFood   = kind === 'food';
      const pool     = this._particlePool;
      const parts    = this.particles;

      for(let i = 0; i < n; i++){
        const a  = Math.random() * TAU;
        const sp = isPlayer ? rand(12, 75) : rand(40, 160);

        let p;
        if(pool.length){
          p = pool.pop();
        } else {
          p = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 },
                life: 0, maxLife: 1, player: false, food: false };
        }
        p.pos.x = x; p.pos.y = y;
        p.vel.x = Math.cos(a) * sp; p.vel.y = Math.sin(a) * sp;
        p.life    = isPlayer ? rand(0.65, 1.25) : rand(0.35, 0.8);
        p.maxLife = isPlayer ? 1.25 : 0.8;
        p.player  = isPlayer;
        p.food    = isFood;
        parts.push(p);
      }
    }

    spawnParticles(pos, n, kind){
      this._spawnParticlesAt(pos.x, pos.y, n, kind);
    }

    spawnShockwave(pos, r){
      this.shockwaves.push({
        pos: { x: pos.x, y: pos.y },
        r,
        maxR: r * 2.4,
        life: 0.5,
        maxLife: 0.5,
      });
    }

    spawnCoinPopup(pos, amount){
      this.coinPops.push({
        pos: { x: pos.x, y: pos.y },
        vy: -38,
        life: 1.1,
        maxLife: 1.1,
        text: '+' + amount,
      });
    }

    _cellIndex(x, y){
      const cx = (x / this._cell) | 0;
      const cy = (y / this._cell) | 0;
      if(cx < 0 || cy < 0 || cx >= this._cols || cy >= this._rows) return -1;
      return cy * this._cols + cx;
    }

    _rebuildFishGrid(){
      const grid = this._fishGrid;
      for(let i = 0; i < this._cellN; i++) grid[i].length = 0;

      const list = this.fish;
      for(let i = 0; i < list.length; i++){
        const f = list[i];
        if(!f.alive) continue;
        if(!isFinite(f.pos.x) || !isFinite(f.pos.y)) continue;
        const c = this._cellIndex(f.pos.x, f.pos.y);
        if(c < 0) continue;
        grid[c].push(f);
      }
    }

    _rebuildFoodGrid(){
      const grid = this._foodGrid;
      for(let i = 0; i < this._cellN; i++) grid[i].length = 0;

      const list = this.food;
      for(let i = 0; i < list.length; i++){
        const fd = list[i];
        if(!fd || !fd.pos) continue;
        const c = this._cellIndex(fd.pos.x, fd.pos.y);
        if(c < 0) continue;
        grid[c].push(fd);
      }
      this._foodGridStamp = this.time;
    }

    update(dt){
      if(this.gameOver){
        this.updateParticles(dt);
        if(this.flicker > 0){ this.flicker -= dt; this.flickerStrength *= 0.85; }
        return;
      }

      this.time += dt;
      this.perf.predChecks = 0;
      this.perf.foodChecks = 0;
      this.perf.gridFrame++;

      if(this.player && this.player.alive){
        this.playerParticleTimer -= dt;
        if(this.playerParticleTimer <= 0){
          this.playerParticleTimer = CFG.PLAYER_PARTICLE_INTERVAL;
          this._spawnParticlesAt(this.player.pos.x, this.player.pos.y,
            CFG.PLAYER_PARTICLES_PER_BURST, 'player');
        }
      }

      const list = this.fish;
      for(let i = 0; i < list.length; i++){
        const f = list[i];
        if(!f.alive) continue;
        f.update(dt, this);
      }

      this._rebuildFishGrid();

      this.handlePredation();
      this.handleFood();

      let w = 0;
      for(let i = 0; i < list.length; i++){
        const f = list[i];
        if(f.alive) list[w++] = f;
      }
      list.length = w;

      this.updateParticles(dt);

      this.foodAccum += dt * CFG.FOOD_RATE;
      while(this.foodAccum >= 1){
        this.foodAccum -= 1;
        this.spawnFood(true);
      }
      const food = this.food;
      for(let i = 0; i < food.length; i++){
        const fd = food[i];
        fd.pos.x += fd.drift.x * dt;
        fd.pos.y += fd.drift.y * dt;
        if(fd.pos.x < 10 || fd.pos.x > CFG.W - 10) fd.drift.x *= -1;
        if(fd.pos.y < 10 || fd.pos.y > CFG.H - 10) fd.drift.y *= -1;
      }

      this.spawnTimer -= dt;
      if(this.spawnTimer <= 0){
        this.spawnTimer = CFG.SPAWN_T;
        this.balance();
      }

      if(this.flicker > 0){
        this.flicker -= dt;
        this.flickerStrength *= 0.86;
        if(this.flicker <= 0) this.flickerStrength = 0;
      }

      if(this.player && !this.player.alive && !this.gameOver){
        this.gameOver = true;
        if(this.onPlayerDeath) this.onPlayerDeath();
      }
    }

    updateParticles(dt){
      const parts = this.particles;
      const pool  = this._particlePool;
      let w = 0;
      for(let i = 0; i < parts.length; i++){
        const p = parts[i];
        p.life -= dt;
        if(p.life <= 0){
          if(pool.length < this._particlePoolMax) pool.push(p);
          continue;
        }
        p.pos.x += p.vel.x * dt;
        p.pos.y += p.vel.y * dt;
        p.vel.x *= 0.93;
        p.vel.y *= 0.93;
        parts[w++] = p;
      }
      parts.length = w;

      const sw = this.shockwaves;
      w = 0;
      for(let i = 0; i < sw.length; i++){
        const s = sw[i];
        s.life -= dt;
        if(s.life <= 0) continue;
        s.r = lerp(s.r, s.maxR, 0.14);
        sw[w++] = s;
      }
      sw.length = w;

      const cp = this.coinPops;
      w = 0;
      for(let i = 0; i < cp.length; i++){
        const c = cp[i];
        c.life -= dt;
        if(c.life <= 0) continue;
        c.pos.y += c.vy * dt;
        c.vy *= 0.94;
        cp[w++] = c;
      }
      cp.length = w;
    }

    handlePredation(){
      const list = this.fish;
      const grid = this._fishGrid;
      const cols = this._cols, rows = this._rows;
      const cell = this._cell;
      const biteR = CFG.BITE_RADIUS;

      for(let i = 0; i < list.length; i++){
        const a = list[i];
        if(!a.alive) continue;
        const aHead = a.spine[0];
        if(!aHead || !isFinite(aHead.x) || !isFinite(aHead.y)) continue;

        const r0 = biteR(a.size, a.size * 4);
        const r0sq = r0 * r0;

        const c0x = Math.max(0, ((aHead.x - r0) / cell) | 0);
        const c1x = Math.min(cols - 1, ((aHead.x + r0) / cell) | 0);
        const c0y = Math.max(0, ((aHead.y - r0) / cell) | 0);
        const c1y = Math.min(rows - 1, ((aHead.y + r0) / cell) | 0);

        for(let cy = c0y; cy <= c1y; cy++){
          const rowBase = cy * cols;
          for(let cx = c0x; cx <= c1x; cx++){
            const bucket = grid[rowBase + cx];
            for(let bi = 0; bi < bucket.length; bi++){
              const b = bucket[bi];
              if(b === a || !b.alive) continue;
              if(b.size >= a.size) continue;
              if(!a.canEat(b)) continue;

              this.perf.predChecks++;

              const hdx = b.spine[0].x - aHead.x;
              const hdy = b.spine[0].y - aHead.y;
              if(hdx * hdx + hdy * hdy > r0sq) continue;

              const r  = biteR(a.size, b.size);
              const r2 = r * r;

              let aHits = false;
              const bSpine = b.spine;
              for(let k = 0; k < bSpine.length; k++){
                const p = bSpine[k];
                const dx = p.x - aHead.x, dy = p.y - aHead.y;
                if(dx * dx + dy * dy < r2){ aHits = true; break; }
              }
              if(!aHits) continue;

              if(b.canEat(a)){
                const bHead = b.spine[0];
                let bHits = false;
                const aSpine = a.spine;
                for(let k = 0; k < aSpine.length; k++){
                  const p = aSpine[k];
                  const dx = p.x - bHead.x, dy = p.y - bHead.y;
                  if(dx * dx + dy * dy < r2){ bHits = true; break; }
                }
                if(bHits){
                  if(b.size > a.size * 1.05){ b.eat(a, this); break; }
                }
              }

              a.eat(b, this);
              break;
            }
          }
        }
      }
    }

    handleFood(){
      if(this._foodGridStamp !== this.time) this._rebuildFoodGrid();

      const list = this.fish;
      const grid = this._foodGrid;
      const cols = this._cols, rows = this._rows;
      const cell = this._cell;

      const toRemove = this._removedFood;
      toRemove.length = 0;

      for(let i = 0; i < list.length; i++){
        const f = list[i];
        if(!f.alive) continue;
        const mouth = f.spine[0];
        if(!mouth || !isFinite(mouth.x) || !isFinite(mouth.y)) continue;

        const r  = f.size * 0.9 + 5;
        const r2 = r * r;

        const c0x = Math.max(0, ((mouth.x - r) / cell) | 0);
        const c1x = Math.min(cols - 1, ((mouth.x + r) / cell) | 0);
        const c0y = Math.max(0, ((mouth.y - r) / cell) | 0);
        const c1y = Math.min(rows - 1, ((mouth.y + r) / cell) | 0);

        for(let cy = c0y; cy <= c1y; cy++){
          const rowBase = cy * cols;
          for(let cx = c0x; cx <= c1x; cx++){
            const bucket = grid[rowBase + cx];
            for(let bi = 0; bi < bucket.length; bi++){
              const fd = bucket[bi];
              if(!fd || fd.eaten) continue;

              this.perf.foodChecks++;

              const dx = fd.pos.x - mouth.x;
              const dy = fd.pos.y - mouth.y;
              if(dx * dx + dy * dy < r2){
                fd.eaten = true;
                f.eatFood(fd, this);
                toRemove.push(fd);
              }
            }
          }
        }
      }

      if(toRemove.length){
        const live = this.food;
        let w = 0;
        for(let i = 0; i < live.length; i++){
          const fd = live[i];
          if(fd.eaten) continue;
          live[w++] = fd;
        }
        live.length = w;
        this._foodGridStamp = -1;
      }
    }

    balance(){
      let prey = 0, mid = 0, pred = 0, apex = 0;
      const list = this.fish;
      for(let i = 0; i < list.length; i++){
        const f = list[i];
        if(f.isPlayer || !f.alive) continue;
        if(f.size < CFG.EV_2) prey++;
        else if(f.size < CFG.EV_3) mid++;
        else if(f.size < CFG.EV_4) pred++;
        else apex++;
      }

      const pc = prey + mid;

      let nearby = 0;
      if(this.player && this.player.alive){
        const px = this.player.pos.x, py = this.player.pos.y;
        const r2 = CFG.START_FISH_RADIUS * CFG.START_FISH_RADIUS;
        for(let i = 0; i < list.length; i++){
          const f = list[i];
          if(f === this.player || !f.alive) continue;
          const dx = f.pos.x - px, dy = f.pos.y - py;
          if(dx * dx + dy * dy < r2) nearby++;
        }
      }

      if(nearby < 22){
        const add = Math.min(5, 22 - nearby);
        for(let i = 0; i < add; i++){
          const lk = this.pickLineage();
          if(this._atCap(lk)) continue;
          const small = Math.random() < 0.78;
          this.spawnFish(lk, small ? rand(4, 10) : rand(12, 20), true);
        }
      }

      if(pc < 30){
        const n = rInt(3, 6);
        for(let i = 0; i < n; i++){
          const lk = this.pickLineage();
          if(this._atCap(lk)) continue;
          this.spawnFish(lk, rand(4, 9), true);
        }
      }

      if(mid < 6 && Math.random() < 0.70){
        const lk = this.pickLineage();
        if(!this._atCap(lk)) this.spawnFish(lk, rand(13, 20));
      }

      if(pred < 3 && Math.random() < 0.35){
        const hunterPool = ['predator','barracuda','swordfish','piranha','angler','eel'];
        const lk = Math.random() < 0.7
          ? hunterPool[rInt(0, hunterPool.length - 1)]
          : this.pickLineage();
        if(!this._atCap(lk)) this.spawnFish(lk, rand(28, 38));
      }

      if(apex < 1 && Math.random() < 0.18){
        const apexPool = ['abyss','leviathan','serpent','armor','predator'];
        const lk = apexPool[rInt(0, apexPool.length - 1)];
        if(!this._atCap(lk)) this.spawnFish(lk, rand(58, 80));
      }

      if(pc > 0 && (pred + apex) / pc > 0.55){
        let big = null;
        for(let i = 0; i < list.length; i++){
          const f = list[i];
          if(f.isPlayer || f.size < CFG.EV_3) continue;
          if(!big || f.size > big.size) big = f;
        }
        if(big && Math.random() < 0.4) big.energy -= 50;
      }
    }

    stats(){
      let c = 0;
      const list = this.fish;
      for(let i = 0; i < list.length; i++) if(list[i].alive) c++;
      return { fish: c, food: this.food.length, time: Math.floor(this.time) };
    }
  }

  if(typeof globalThis !== 'undefined'){
    globalThis.Eco          = Eco;
    globalThis.SPAWN_WEIGHTS= SPAWN_WEIGHTS;
    globalThis.POP_CAPS     = POP_CAPS;
  }
})();