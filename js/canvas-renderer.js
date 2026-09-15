"use strict";

class Renderer{
  constructor(canvas,eco){
    this.canvas=canvas;
    // alpha:false lets the browser composite faster on opaque canvas
    this.ctx=canvas.getContext('2d',{alpha:false});
    this.eco=eco;

    /* ---------- timing / quality ---------- */
    this.frame=0;
    this.quality=2;                 /* 0 = LOW, 1 = MEDIUM, 2 = HIGH */
    this._fpsAccum=0;
    this._fpsFrames=0;
    this._lastTime=(typeof performance!=='undefined'?performance.now():Date.now());
    this._dt=1/60;

    /* ---------- sorted fish cache ---------- */
    this._sortedFish=null;
    this._lastFishCount=-1;
    this._sortFrame=0;

    /* ---------- reusable geometry buffers ---------- */
    this._top=[];
    this._bot=[];

    /* ---------- pre-rendered background ---------- */
    this._bg=null;
    this._bgCtx=null;
    this._bgW=0;
    this._bgH=0;

    /* ---------- ambient drifting motes ---------- */
    this._ambient=[];
    this._seedAmbient(70);

    /* ---------- intent line scratch ---------- */
    this._intentPool=[];

    /* ---------- last known canvas CSS size, to skip redundant fit() ---------- */
    this._lastFitW=0;
    this._lastFitH=0;
  }

  /* ============================================================
     AMBIENT MOTES  (underwater haze particles)
     ============================================================ */
  _seedAmbient(n){
    this._ambient.length=0;
    const W=CFG.W,H=CFG.H;
    for(let i=0;i<n;i++){
      this._ambient.push({
        x:Math.random()*W,
        y:Math.random()*H,
        vx:(Math.random()-0.5)*6,
        vy:(Math.random()-0.5)*6-2,
        r:0.4+Math.random()*1.4,
        a:0.03+Math.random()*0.09,
        phase:Math.random()*Math.PI*2,
        depth:0.35+Math.random()*0.65
      });
    }
  }

  /* ============================================================
     FIT  —  CSS-only scale, logical resolution unchanged
     ============================================================ */
  fit(){
    const s=Math.min(window.innerWidth/CFG.W,window.innerHeight/CFG.H)*0.98;
    const w=(CFG.W*s)|0,h=(CFG.H*s)|0;
    if(w===this._lastFitW&&h===this._lastFitH)return;
    this._lastFitW=w;this._lastFitH=h;
    this.canvas.style.width=w+'px';
    this.canvas.style.height=h+'px';
  }

  /* ============================================================
     TIMING + ADAPTIVE QUALITY
     ============================================================ */
  _tick(){
    const now=(typeof performance!=='undefined'?performance.now():Date.now());
    const dt=(now-this._lastTime)/1000;
    this._lastTime=now;
    this._dt=(dt>0&&dt<0.5)?dt:1/60;

    this._fpsAccum+=this._dt;
    this._fpsFrames++;

    if(this._fpsFrames>=24){
      const avgDt=this._fpsAccum/this._fpsFrames;
      const fps=1/Math.max(0.001,avgDt);
      const nFish=this.eco&&this.eco.fish?this.eco.fish.length:0;

      let q;
      if(fps<38||nFish>240)q=0;
      else if(fps<52||nFish>150)q=1;
      else q=2;

      /* hysteresis: only step one level per update */
      if(q<this.quality)this.quality=Math.max(q,this.quality-1);
      else if(q>this.quality)this.quality=Math.min(q,this.quality+1);

      this._fpsAccum=0;
      this._fpsFrames=0;
    }
  }

  /* ============================================================
     BACKGROUND  —  cached to offscreen canvas
     ============================================================ */
  _buildBackground(){
    const W=CFG.W,H=CFG.H;
    if(this._bg&&this._bgW===W&&this._bgH===H)return;

    const c=document.createElement('canvas');
    c.width=W;c.height=H;
    const g=c.getContext('2d');

    /* depth gradient */
    const grad=g.createLinearGradient(0,0,0,H);
    grad.addColorStop(0,'#020305');
    grad.addColorStop(0.45,'#010204');
    grad.addColorStop(1,'#000000');
    g.fillStyle=grad;
    g.fillRect(0,0,W,H);

    /* soft vignette haze */
    const vg=g.createRadialGradient(W*0.5,H*0.5,Math.min(W,H)*0.15,
                                     W*0.5,H*0.5,Math.max(W,H)*0.75);
    vg.addColorStop(0,'rgba(45,60,78,0.055)');
    vg.addColorStop(0.55,'rgba(22,30,42,0.03)');
    vg.addColorStop(1,'rgba(0,0,0,0)');
    g.fillStyle=vg;
    g.fillRect(0,0,W,H);

    /* grid dots */
    g.fillStyle='rgba(48,52,58,0.55)';
    const s=60;
    for(let x=s;x<W;x+=s)for(let y=s;y<H;y+=s)g.fillRect(x,y,1,1);

    /* border */
    g.strokeStyle='rgba(255,255,255,0.07)';
    g.lineWidth=1;
    g.strokeRect(1,1,W-2,H-2);

    this._bg=c;
    this._bgCtx=g;
    this._bgW=W;
    this._bgH=H;
  }

  /* ============================================================
     MAIN RENDER
     ============================================================ */
  render(){
    this.frame++;
    this._tick();
    this._buildBackground();

    const ctx=this.ctx;
    const eco=this.eco;

    /* hard reset state every frame — fixes leakage bugs */
    ctx.globalAlpha=1;
    ctx.globalCompositeOperation='source-over';
    ctx.setLineDash([]);
    ctx.setTransform(1,0,0,1,0,0);

    /* 1. background */
    ctx.drawImage(this._bg,0,0);

    /* 2. ambient environment */
    this._drawAmbient(ctx);

    /* 3. food */
    this.drawFood(ctx);

    /* 4. intent information */
    this.drawIntentLines(ctx);

    /* 5. fish — sorted by size, shadows then bodies */
    const list=this._sortedFishFor(eco.fish);
    const player=eco.player;

    if(this.quality>0){
      for(let i=0;i<list.length;i++){
        const f=list[i];
        if(!f.alive)continue;
        this.drawFishShadow(ctx,f,player);
      }
    }

    for(let i=0;i<list.length;i++){
      const f=list[i];
      if(!f.alive)continue;
      this.drawFish(ctx,f);
    }

    /* 6. shockwaves + particles + coin pops */
    this.drawShockwaves(ctx);
    this.drawParticles(ctx);
    this.drawCoinPops(ctx);

    /* 7. screen flicker */
    if(eco.flicker>0){
      ctx.fillStyle='rgba(255,255,255,'+(eco.flickerStrength*0.5)+')';
      ctx.fillRect(0,0,CFG.W,CFG.H);
    }

    /* final state reset */
    ctx.globalAlpha=1;
    ctx.globalCompositeOperation='source-over';
    ctx.setLineDash([]);
  }

  /* ============================================================
     SORTED FISH  —  periodic, not per-frame
     ============================================================ */
  _sortedFishFor(fish){
    const n=fish.length;
    const needResort=
      this._sortedFish===null ||
      this._lastFishCount!==n ||
      (this.frame-this._sortFrame)>=12;

    if(needResort){
      if(this._sortedFish===null||this._sortedFish.length!==n){
        this._sortedFish=new Array(n);
      }
      for(let i=0;i<n;i++)this._sortedFish[i]=fish[i];
      /* insertion sort is very fast on nearly-sorted arrays */
      const a=this._sortedFish;
      for(let i=1;i<n;i++){
        const v=a[i];
        let j=i-1;
        while(j>=0&&a[j].size>v.size){a[j+1]=a[j];j--;}
        a[j+1]=v;
      }
      this._lastFishCount=n;
      this._sortFrame=this.frame;
    }
    return this._sortedFish;
  }

  /* ============================================================
     AMBIENT PARTICLES
     ============================================================ */
  _drawAmbient(ctx){
    if(this.quality===0)return;
    const arr=this._ambient;
    const dt=this._dt;
    const t=(typeof performance!=='undefined'?performance.now():Date.now())/1000;
    const W=CFG.W,H=CFG.H;

    ctx.save();
    ctx.globalCompositeOperation='lighter';
    for(let i=0;i<arr.length;i++){
      const p=arr[i];
      p.x+=p.vx*dt;
      p.y+=p.vy*dt;
      if(p.x<-6)p.x=W+6;else if(p.x>W+6)p.x=-6;
      if(p.y<-6)p.y=H+6;else if(p.y>H+6)p.y=-6;
      const a=p.a*(0.55+0.45*Math.sin(t*0.7+p.phase));
      ctx.fillStyle='rgba(180,200,220,'+a+')';
      ctx.fillRect(p.x,p.y,p.r,p.r);
    }
    ctx.restore();
  }

  /* ============================================================
     FOOD
     ============================================================ */
  drawFood(ctx){
    const food=this.eco.food;
    if(!food||!food.length)return;
    const t=(typeof performance!=='undefined'?performance.now():Date.now())/700;
    const q=this.quality;

    for(let i=0;i<food.length;i++){
      const f=food[i];
      const r=f.r||2;
      if(q>=1){
        const a=0.5+0.5*Math.sin(t+(f.phase||0));
        const b=(140+60*a)|0;
        /* halo */
        ctx.globalAlpha=0.16;
        ctx.fillStyle='#c8c8c8';
        ctx.fillRect(f.pos.x-r*1.6,f.pos.y-r*1.6,r*3.2,r*3.2);
        /* core */
        ctx.globalAlpha=1;
        ctx.fillStyle='rgb('+b+','+b+','+b+')';
        ctx.fillRect(f.pos.x-r,f.pos.y-r,r*2,r*2);
      }else{
        ctx.fillStyle='#999';
        ctx.fillRect(f.pos.x-r,f.pos.y-r,r*2,r*2);
      }
    }
    ctx.globalAlpha=1;
  }

  /* ============================================================
     INTENT LINES  —  filtered, prioritized, capped
     ============================================================ */
  drawIntentLines(ctx){
    const p=this.eco.player;
    if(!p||!p.alive||this.quality===0)return;

    const R=p.visionRange*1.05;
    const r2=R*R;
    const fish=this.eco.fish;
    const pool=this._intentPool;
    pool.length=0;

    const pDef=p.defSize?p.defSize():p.size;
    const px=p.pos.x,py=p.pos.y;

    for(let i=0;i<fish.length;i++){
      const f=fish[i];
      if(!f.alive||f.isPlayer)continue;
      const dx=f.pos.x-px,dy=f.pos.y-py;
      const d2=dx*dx+dy*dy;
      if(d2>r2)continue;
      const d=Math.sqrt(d2);

      const st=f.state;
      if(st==='CHASE'||st==='INTERCEPT'||st==='ATTACK'||st==='STALK'){
        const fDef=f.defSize?f.defSize():f.size;
        const targetingPlayer=(f.target===p)||
                              (f.target&&f.target.alive&&f.target.isPlayer);
        const bigger=fDef>pDef*1.15;
        if(!targetingPlayer&&!bigger)continue;
        const priority=(targetingPlayer?300:120)-d;
        pool.push({src:f,dst:f.target,kind:0,priority:priority,dist:d});
      }else if(st==='FLEE'){
        const fDef=f.defSize?f.defSize():f.size;
        if(fDef<pDef*0.9)continue;
        pool.push({src:f,dst:f.target,kind:1,priority:60-d,dist:d});
      }
    }

    if(!pool.length)return;
    pool.sort((a,b)=>b.priority-a.priority);
    const maxLines=this.quality>=2?12:6;
    const count=Math.min(maxLines,pool.length);

    ctx.lineWidth=1;
    const invR=1/R;

    for(let i=0;i<count;i++){
      const it=pool[i];
      const f=it.src;
      if(!f.alive)continue;
      const dst=it.dst;
      let tx,ty;
      if(dst&&dst.alive&&typeof f.predict==='function'){
        const aim=f.predict(dst);
        tx=aim.x;ty=aim.y;
      }else{
        tx=f.pos.x+Math.cos(f.angle)*90;
        ty=f.pos.y+Math.sin(f.angle)*90;
      }
      const fade=1-Math.min(1,it.dist*invR);
      const a=fade*(it.kind===0?0.30:0.20);
      if(a<0.02)continue;
      ctx.strokeStyle='rgba(255,255,255,'+a+')';
      ctx.setLineDash(it.kind===0?[4,5]:[2,6]);
      ctx.beginPath();
      ctx.moveTo(f.pos.x,f.pos.y);
      ctx.lineTo(tx,ty);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  /* ============================================================
     SHOCKWAVES
     ============================================================ */
  drawShockwaves(ctx){
    const arr=this.eco.shockwaves;
    if(!arr||!arr.length)return;
    for(let i=0;i<arr.length;i++){
      const s=arr[i];
      if(!s||!s.pos)continue;
      if(!isFinite(s.r)||s.r<=0)continue;
      const life=s.maxLife>0?s.life/s.maxLife:0;
      const a=clamp(life,0,1)*0.7;
      if(a<=0.01)continue;
      ctx.strokeStyle='rgba(255,255,255,'+a+')';
      ctx.lineWidth=1.4;
      ctx.beginPath();
      ctx.arc(s.pos.x,s.pos.y,s.r,0,Math.PI*2);
      ctx.stroke();
    }
  }

  /* ============================================================
     COIN POPS
     ============================================================ */
  drawCoinPops(ctx){
    const arr=this.eco.coinPops;
    if(!arr||!arr.length)return;
    ctx.save();
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    ctx.font='bold 20px "Courier New", monospace';
    for(let i=0;i<arr.length;i++){
      const c=arr[i];
      if(!c||!c.pos)continue;
      const a=clamp(c.life/c.maxLife,0,1);
      if(a<=0.02)continue;
      ctx.fillStyle='rgba(255,204,68,'+a+')';
      ctx.fillText(c.text,c.pos.x,c.pos.y);
    }
    ctx.restore();
  }

  /* ============================================================
     FISH SHADOW  —  cheap depth cue
     ============================================================ */
  drawFishShadow(ctx,fish,player){
    if(this.quality===0)return;
    const sz=fish.size;
    const r=sz*1.05;

    if(!fish.isPlayer&&player&&player.alive){
      const dx=fish.pos.x-player.pos.x,dy=fish.pos.y-player.pos.y;
      const d2=dx*dx+dy*dy;
      if(this.quality<2&&d2>520*520)return;
    }
    ctx.fillStyle='rgba(0,0,0,0.34)';
    ctx.beginPath();
    ctx.ellipse(fish.pos.x+2.5,fish.pos.y+3.5,r,r*0.62,0,0,Math.PI*2);
    ctx.fill();
  }

  /* ============================================================
     FISH RENDER
     ============================================================ */
  drawFish(ctx,fish){
    if(!fish||!fish.alive)return;
    if(typeof fish.renderSpine!=='function')return;

    const sp=fish.renderSpine();
    const n=sp.length;
    if(n<2)return;

    /* grow reusable buffers monotonically — never shrink */
    const top=this._top;
    const bot=this._bot;
    while(top.length<n){top.push({x:0,y:0});bot.push({x:0,y:0});}

    const profileKey=fish.profileKey();
    const sz=fish.size;
    if(!isFinite(sz)||sz<=0)return;

    for(let i=0;i<n;i++){
      const p=sp[i];
      const prev=sp[i>0?i-1:i];
      const next=sp[i<n-1?i+1:i];
      let dx=next.x-prev.x,dy=next.y-prev.y;
      const d=Math.hypot(dx,dy);
      if(d<0.0001){dx=1;dy=0;}
      else{dx/=d;dy/=d;}
      const px=-dy,py=dx;
      const t=i/(n-1);
      const w=widthAt(profileKey,t)*sz;
      top[i].x=p.x+px*w;top[i].y=p.y+py*w;
      bot[i].x=p.x-px*w;bot[i].y=p.y-py*w;
    }

    const alpha=fish.spawnTimer>0?clamp(1-fish.spawnTimer/0.5,0,1):1;
    if(alpha<=0.01)return;

    const isP=fish.isPlayer===true;
    const bodyColor=fish.colorKey();
    const accent=fish.accentKey();

    /* distance to player determines detail budget */
    const player=this.eco.player;
    let detail=3;
    if(!isP){
      if(player&&player.alive){
        const dx=fish.pos.x-player.pos.x,dy=fish.pos.y-player.pos.y;
        const d2=dx*dx+dy*dy;
        if(d2>900*900)detail=0;
        else if(d2>560*560)detail=1;
        else if(d2>280*280)detail=2;
        else detail=3;
      }else{
        detail=2;
      }
    }
    /* quality clamp */
    if(this.quality===0)detail=Math.min(detail,1);
    else if(this.quality===1)detail=Math.min(detail,2);

    ctx.save();
    ctx.globalAlpha=alpha;

    /* ---- skin flags ---- */
    let glowMul=isP?1:0.45;
    let bodyAlphaMul=1;
    let outlineStyle=isP?'#ffea99':'#ffffff';
    let outlineWidth=1.1;
    let outlineDash=null;
    let striped=false;
    let outlineOffset=0;
    let holo=false;
    let reverse=false;

    const skin=isP?fish.skin:null;
    if(skin==='ghost'){
      glowMul=1.6;bodyAlphaMul=0.55;outlineWidth=0.8;
    }else if(skin==='glitch'){
      const jx=Math.sin(fish.glitchPhase*1.7)*1.8;
      const jy=Math.cos(fish.glitchPhase*2.1)*1.8;
      ctx.translate(jx,jy);
      outlineWidth=1.4;
    }else if(skin==='scanline'){striped=true;}
    else if(skin==='dotted'){outlineDash=[3,3];outlineWidth=1.5;}
    else if(skin==='solid'){outlineWidth=0;}
    else if(skin==='holo'){outlineWidth=2.2;outlineOffset=3;holo=true;}
    else if(skin==='reverse'){bodyAlphaMul=0;outlineWidth=2.0;reverse=true;}

    /* ---- glow (cheap solid circle, no gradient) ---- */
    if(this.quality>=1&&(isP||detail>=2)){
      const glowR=sz*2.6;
      if(glowR>0&&isFinite(glowR)){
        ctx.save();
        ctx.globalCompositeOperation='lighter';
        const gA=(isP?0.28:0.08)*alpha*glowMul;
        ctx.fillStyle=isP?(PLAYER_GLOW+gA+')'):('rgba(255,255,255,'+gA+')');
        ctx.beginPath();
        ctx.arc(fish.pos.x,fish.pos.y,glowR,0,Math.PI*2);
        ctx.fill();
        ctx.restore();
      }
    }

    /* ---- evolution rings ---- */
    if(fish.evolveAnim>0&&this.quality>=1){
      const t=1-fish.evolveAnim/CFG.EVO_DUR;
      const rings=this.quality>=2?3:2;
      for(let i=0;i<rings;i++){
        const lt=(t+i*0.2)%1;
        const rr=sz*1.6+lt*sz*5;
        if(!isFinite(rr)||rr<=0)continue;
        const aa=(1-lt)*0.85*alpha;
        ctx.strokeStyle=isP?(PLAYER_GLOW+aa+')'):('rgba(255,255,255,'+aa+')');
        ctx.lineWidth=2;
        ctx.beginPath();
        ctx.arc(fish.pos.x,fish.pos.y,rr,0,Math.PI*2);
        ctx.stroke();
      }
    }

    /* ---- holo offset --- */
    if(holo){
      ctx.save();
      ctx.globalAlpha=alpha*0.55;
      ctx.beginPath();
      ctx.moveTo(top[0].x+outlineOffset,top[0].y+outlineOffset);
      for(let i=1;i<n;i++)ctx.lineTo(top[i].x+outlineOffset,top[i].y+outlineOffset);
      for(let i=n-1;i>=0;i--)ctx.lineTo(bot[i].x+outlineOffset,bot[i].y+outlineOffset);
      ctx.closePath();
      ctx.strokeStyle=isP?(PLAYER_GLOW+'0.6)'):'rgba(255,255,255,0.55)';
      ctx.lineWidth=1;
      ctx.stroke();
      ctx.restore();
    }

    /* ---- body path ---- */
    ctx.beginPath();
    ctx.moveTo(top[0].x,top[0].y);
    for(let i=1;i<n;i++)ctx.lineTo(top[i].x,top[i].y);
    for(let i=n-1;i>=0;i--)ctx.lineTo(bot[i].x,bot[i].y);
    ctx.closePath();

    if(bodyAlphaMul>0){
      ctx.globalAlpha=alpha*bodyAlphaMul;
      ctx.fillStyle=bodyColor;
      ctx.fill();
    }
    ctx.globalAlpha=alpha;

    if(reverse){
      ctx.strokeStyle=isP?PLAYER_COLOR:'#dcdcdc';
      ctx.lineWidth=1.6;
      ctx.stroke();
    }else if(outlineWidth>0){
      ctx.strokeStyle=outlineStyle;
      ctx.lineWidth=outlineWidth;
      if(outlineDash)ctx.setLineDash(outlineDash);
      ctx.stroke();
      if(outlineDash)ctx.setLineDash([]);
    }

    /* ---- scanlines ---- */
    if(striped&&detail>=2){
      ctx.save();
      ctx.clip();
      ctx.strokeStyle=isP?'rgba(0,0,0,0.7)':'rgba(0,0,0,0.9)';
      ctx.lineWidth=1.4;
      const step=5;
      const y0=fish.pos.y-sz*1.2,y1=fish.pos.y+sz*1.2;
      const x0=fish.pos.x-sz*2,x1=fish.pos.x+sz*2;
      for(let y=y0;y<y1;y+=step){
        ctx.beginPath();
        ctx.moveTo(x0,y);
        ctx.lineTo(x1,y);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* ---- detail parts ---- */
    if(detail>=1){
      this.drawDorsal(ctx,fish,sp,top,bodyColor,outlineStyle);
      this.drawTail(ctx,fish,sp,bodyColor,outlineStyle);
    }
    if(detail>=2){
      this.drawPectoral(ctx,fish,sp,bodyColor,outlineStyle);
      this.drawEye(ctx,fish,sp,isP);
    }
    if(fish.lineage&&fish.lineage.lure&&detail>=1){
      this.drawLure(ctx,fish,sp);
    }

    /* ---- player indicators ---- */
    if(isP){
      ctx.strokeStyle=(PLAYER_GLOW+'0.7)');
      ctx.lineWidth=1;
      ctx.setLineDash([5,4]);
      ctx.beginPath();
      ctx.arc(fish.pos.x,fish.pos.y,fish.size*1.7,0,Math.PI*2);
      ctx.stroke();
      ctx.setLineDash([]);

      if(this.quality>=1){
        ctx.strokeStyle=(PLAYER_GLOW+'0.06)');
        ctx.beginPath();
        ctx.arc(fish.pos.x,fish.pos.y,fish.visionRange,0,Math.PI*2);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  /* ============================================================
     LURE (abyss lineage)
     ============================================================ */
  drawLure(ctx,fish,sp){
    if(!sp||sp.length<2)return;
    const head=sp[0];
    const prev=sp[1];
    let dx=head.x-prev.x,dy=head.y-prev.y;
    const d=Math.hypot(dx,dy)||1;dx/=d;dy/=d;
    const px=-dy,py=dx;
    const sway=Math.sin(fish.lurePhase)*0.5;
    const reach=fish.size*1.6;
    const lx=head.x+dx*reach+px*sway*fish.size*0.6;
    const ly=head.y+dy*reach+py*sway*fish.size*0.6;
    const isP=fish.isPlayer;

    ctx.strokeStyle=isP?(PLAYER_GLOW+'0.5)'):'rgba(255,255,255,0.35)';
    ctx.lineWidth=0.8;
    ctx.beginPath();
    ctx.moveTo(head.x,head.y);
    ctx.lineTo(lx,ly);
    ctx.stroke();

    ctx.save();
    ctx.globalCompositeOperation='lighter';
    const pulse=0.6+0.4*Math.sin(fish.lurePhase*2);
    const r=Math.max(2,fish.size*0.4)*pulse;
    /* flat glow instead of radial gradient */
    const gA=0.35*pulse;
    ctx.fillStyle=isP?(PLAYER_GLOW+gA+')'):('rgba(255,255,255,'+gA+')');
    ctx.beginPath();
    ctx.arc(lx,ly,r*2.2,0,Math.PI*2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle=isP?PLAYER_COLOR:'#fff';
    ctx.beginPath();
    ctx.arc(lx,ly,r*0.6,0,Math.PI*2);
    ctx.fill();
  }

  /* ============================================================
     DORSAL  —  state-aware subtle animation
     ============================================================ */
  drawDorsal(ctx,fish,sp,top,bodyColor,outlineStyle){
    const style=fish.dorsalKey();
    if(style==='none')return;

    let t=0.35;
    if(style==='rear')t=0.72;
    if(style==='crest')t=0.5;

    const idx=Math.floor(t*(sp.length-1));
    const p=top[idx];
    const prev=top[idx>1?idx-2:0];
    const next=top[idx<sp.length-2?idx+2:sp.length-1];
    let dx=next.x-prev.x,dy=next.y-prev.y;
    const d=Math.hypot(dx,dy)||1;dx/=d;dy/=d;
    const px=-dy,py=dx;
    const c=sp[idx];
    const toOutX=p.x-c.x,toOutY=p.y-c.y;
    const dot=px*toOutX+py*toOutY;
    const nx=dot<0?-px:px,ny=dot<0?-py:py;
    const sz=fish.size;

    /* sway with swim phase */
    const sway=Math.sin(fish.swimPhase*1.4)*0.06;

    ctx.fillStyle=bodyColor;
    ctx.strokeStyle=outlineStyle;
    ctx.lineWidth=1;

    if(style==='tiny'){
      ctx.beginPath();
      ctx.moveTo(p.x-nx*sz*0.15,p.y-ny*sz*0.15);
      ctx.lineTo(p.x+nx*sz*0.28,p.y+ny*sz*0.28);
      ctx.lineTo(p.x+dx*sz*0.28+nx*sz*0.05,p.y+dy*sz*0.28+ny*sz*0.05);
      ctx.closePath();ctx.fill();ctx.stroke();
    }else if(style==='spiny'){
      ctx.beginPath();
      const segs=4,span=sz*0.9;
      ctx.moveTo(p.x-nx*sz*0.05-dx*span*0.4,p.y-ny*sz*0.05-dy*span*0.4);
      for(let i=0;i<segs;i++){
        const f=(i+0.5)/segs;
        const h=sz*(0.45+sway);
        ctx.lineTo(p.x+dx*span*(f-0.4)+nx*h,p.y+dy*span*(f-0.4)+ny*h);
        ctx.lineTo(p.x+dx*span*(f-0.4+0.15)+nx*sz*0.05,p.y+dy*span*(f-0.4+0.15)+ny*sz*0.05);
      }
      ctx.lineTo(p.x+dx*span*0.5+nx*sz*0.05,p.y+dy*span*0.5+ny*sz*0.05);
      ctx.closePath();ctx.fill();ctx.stroke();
    }else if(style==='rear'){
      ctx.beginPath();
      ctx.moveTo(p.x-nx*sz*0.1-dx*sz*0.2,p.y-ny*sz*0.1-dy*sz*0.2);
      ctx.lineTo(p.x+nx*sz*0.35-dx*sz*0.1,p.y+ny*sz*0.35-dy*sz*0.1);
      ctx.lineTo(p.x-nx*sz*0.1+dx*sz*0.2,p.y-ny*sz*0.1+dy*sz*0.2);
      ctx.closePath();ctx.fill();ctx.stroke();
    }else if(style==='spike'){
      const segs=3,span=sz*1.1;
      ctx.beginPath();
      ctx.moveTo(p.x-dx*span*0.5,p.y-dy*span*0.5);
      for(let i=0;i<segs;i++){
        const f=(i+0.5)/segs;
        const h=sz*(0.85+sway*1.4);
        ctx.lineTo(p.x+dx*span*(f-0.5)+nx*h,p.y+dy*span*(f-0.5)+ny*h);
        ctx.lineTo(p.x+dx*span*(f-0.5+0.18)+nx*sz*0.05,p.y+dy*span*(f-0.5+0.18)+ny*sz*0.05);
      }
      ctx.lineTo(p.x+dx*span*0.5,p.y+dy*span*0.5);
      ctx.closePath();ctx.fill();ctx.stroke();
    }else if(style==='crest'){
      ctx.beginPath();
      const startIdx=Math.floor(sp.length*0.15);
      const endIdx=Math.floor(sp.length*0.9);
      const startTop=top[startIdx];
      ctx.moveTo(startTop.x,startTop.y);
      for(let i=startIdx;i<=endIdx;i++){
        const tt=i/(sp.length-1);
        const pt=top[i];
        const h=sz*(0.35+0.25*Math.sin((tt-0.15)*Math.PI/0.75)+sway);
        const prevT=top[i>0?i-1:i],nextT=top[i<sp.length-1?i+1:sp.length-1];
        let ddx=nextT.x-prevT.x,ddy=nextT.y-prevT.y;
        const dl=Math.hypot(ddx,ddy)||1;ddx/=dl;ddy/=dl;
        ctx.lineTo(pt.x-ddy*h,pt.y+ddx*h);
      }
      for(let i=endIdx;i>=startIdx;i--)ctx.lineTo(top[i].x,top[i].y);
      ctx.closePath();ctx.fill();ctx.stroke();
    }
  }

  /* ============================================================
     TAIL
     ============================================================ */
  drawTail(ctx,fish,sp,bodyColor,outlineStyle){
    const n=sp.length;
    if(n<2)return;
    const tp=sp[n-1],tp2=sp[n-2];
    let dx=tp.x-tp2.x,dy=tp.y-tp2.y;
    const d=Math.hypot(dx,dy)||1;dx/=d;dy/=d;
    const px=-dy,py=dx;
    const sz=fish.size*1.5;
    const style=fish.shapeKey();

    /* tail flutter scales with swim speed and state */
    const spd=Math.hypot(fish.vel.x,fish.vel.y);
    const flutter=0.05+Math.min(0.28,spd*0.006);
    const flutterAng=Math.sin(fish.swimPhase*1.6)*flutter;
    const cf=Math.cos(flutterAng),sf=Math.sin(flutterAng);
    const pdx=dx*cf-px*sf,pdy=dy*cf-py*sf;
    const ppx=-pdy,ppy=pdx;

    ctx.fillStyle=bodyColor;
    ctx.strokeStyle=outlineStyle;
    ctx.lineWidth=1;

    if(style==='forked'){
      ctx.beginPath();
      ctx.moveTo(tp.x,tp.y);
      ctx.lineTo(tp.x+pdx*sz*0.2+ppx*sz*0.65,tp.y+pdy*sz*0.2+ppy*sz*0.65);
      ctx.lineTo(tp.x+pdx*sz*0.55,tp.y+pdy*sz*0.55);
      ctx.lineTo(tp.x+pdx*sz*0.2-ppx*sz*0.65,tp.y+pdy*sz*0.2-ppy*sz*0.65);
      ctx.closePath();ctx.fill();ctx.stroke();
    }else if(style==='fan'){
      ctx.beginPath();
      ctx.moveTo(tp.x,tp.y);
      ctx.quadraticCurveTo(tp.x+pdx*sz*0.7+ppx*sz*0.85,tp.y+pdy*sz*0.7+ppy*sz*0.85,
                           tp.x+pdx*sz*1.05,tp.y+pdy*sz*1.05);
      ctx.quadraticCurveTo(tp.x+pdx*sz*0.7-ppx*sz*0.85,tp.y+pdy*sz*0.7-ppy*sz*0.85,tp.x,tp.y);
      ctx.closePath();ctx.fill();ctx.stroke();
    }else if(style==='crescent'){
      ctx.beginPath();
      ctx.moveTo(tp.x,tp.y);
      ctx.quadraticCurveTo(tp.x+pdx*sz*0.4+ppx*sz*1.1,tp.y+pdy*sz*0.4+ppy*sz*1.1,
                           tp.x+pdx*sz*1.15+ppx*sz*0.45,tp.y+pdy*sz*1.15+ppy*sz*0.45);
      ctx.lineTo(tp.x+pdx*sz*0.7,tp.y+pdy*sz*0.7);
      ctx.lineTo(tp.x+pdx*sz*1.15-ppx*sz*0.45,tp.y+pdy*sz*1.15-ppy*sz*0.45);
      ctx.quadraticCurveTo(tp.x+pdx*sz*0.4-ppx*sz*1.1,tp.y+pdy*sz*0.4-ppy*sz*1.1,tp.x,tp.y);
      ctx.closePath();ctx.fill();ctx.stroke();
    }else if(style==='spike'){
      ctx.beginPath();
      ctx.moveTo(tp.x,tp.y);
      ctx.lineTo(tp.x+pdx*sz*0.3+ppx*sz*0.9,tp.y+pdy*sz*0.3+ppy*sz*0.9);
      ctx.lineTo(tp.x+pdx*sz*0.55+ppx*sz*0.35,tp.y+pdy*sz*0.55+ppy*sz*0.35);
      ctx.lineTo(tp.x+pdx*sz*0.7,tp.y+pdy*sz*0.7);
      ctx.lineTo(tp.x+pdx*sz*0.55-ppx*sz*0.35,tp.y+pdy*sz*0.55-ppy*sz*0.35);
      ctx.lineTo(tp.x+pdx*sz*0.3-ppx*sz*0.9,tp.y+pdy*sz*0.3-ppy*sz*0.9);
      ctx.closePath();ctx.fill();ctx.stroke();
    }
  }

  /* ============================================================
     PECTORAL FIN
     ============================================================ */
  drawPectoral(ctx,fish,sp,bodyColor,outlineStyle){
    const n=sp.length;
    if(n<4)return;
    const idx=Math.floor(n*0.28);
    const p=sp[idx];
    const prev=sp[idx>0?idx-1:0];
    let dx=p.x-prev.x,dy=p.y-prev.y;
    const d=Math.hypot(dx,dy)||1;dx/=d;dy/=d;
    const px=-dy,py=dx;
    const sz=fish.size*0.5;

    /* flap amplitude depends on state */
    const st=fish.state;
    let flapAmp=0.35;
    let flapFreq=1.8;
    if(st==='FLEE'){flapAmp=0.6;flapFreq=3.0;}
    else if(st==='CHASE'||st==='ATTACK'||st==='INTERCEPT'){flapAmp=0.5;flapFreq=2.6;}
    else if(st==='STALK'){flapAmp=0.2;flapFreq=1.2;}
    const flap=Math.sin(fish.swimPhase*flapFreq)*flapAmp;

    ctx.save();
    ctx.translate(p.x,p.y);
    ctx.rotate(Math.atan2(py,px)+flap);
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.lineTo(sz*0.5,sz*0.6);
    ctx.lineTo(-sz*0.2,sz*0.5);
    ctx.closePath();
    ctx.fillStyle=bodyColor;
    ctx.strokeStyle=outlineStyle;
    ctx.lineWidth=0.8;
    ctx.globalAlpha*=0.75;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /* ============================================================
     EYE  —  state-aware
     ============================================================ */
  drawEye(ctx,fish,sp,isP){
    const n=sp.length;
    if(n<3)return;
    const p=sp[1];
    const prev=sp[0];
    let dx=p.x-prev.x,dy=p.y-prev.y;
    const d=Math.hypot(dx,dy)||1;dx/=d;dy/=d;
    const px=-dy,py=dx;
    const ex=p.x+px*fish.size*0.32;
    const ey=p.y+py*fish.size*0.32;
    const r=Math.max(1.1,fish.size*0.15);

    const st=fish.state;
    const lowE=fish.maxEnergy>0&&(fish.energy/fish.maxEnergy)<0.22;
    const aggressive=(fish.aggression&&fish.aggression()>0.7)||isP||st==='ATTACK';
    const alert=(st==='FLEE'||st==='STALK');

    if(aggressive&&!lowE){
      ctx.save();
      ctx.globalCompositeOperation='lighter';
      ctx.fillStyle=isP?(PLAYER_GLOW+'0.55)'):'rgba(255,255,255,0.36)';
      ctx.beginPath();
      ctx.arc(ex,ey,r*2.3,0,Math.PI*2);
      ctx.fill();
      ctx.restore();
    }else if(alert){
      ctx.save();
      ctx.globalCompositeOperation='lighter';
      ctx.fillStyle='rgba(220,220,220,0.22)';
      ctx.beginPath();
      ctx.arc(ex,ey,r*1.8,0,Math.PI*2);
      ctx.fill();
      ctx.restore();
    }

    if(fish.blinkAnim>0){
      ctx.strokeStyle='#000';
      ctx.lineWidth=1.5;
      ctx.beginPath();
      ctx.moveTo(ex-r,ey);
      ctx.lineTo(ex+r,ey);
      ctx.stroke();
    }else{
      ctx.fillStyle='#fff';
      ctx.beginPath();
      ctx.arc(ex,ey,r,0,Math.PI*2);
      ctx.fill();
      ctx.fillStyle=isP?'#221100':'#000';
      ctx.beginPath();
      ctx.arc(ex+r*0.15,ey,r*0.55,0,Math.PI*2);
      ctx.fill();
    }
  }

  /* ============================================================
     PARTICLES
     ============================================================ */
  drawParticles(ctx){
    const arr=this.eco.particles;
    if(!arr||!arr.length)return;
    const q=this.quality;
    /* cap particle draws if there are too many */
    const cap=q===0?200:(q===1?500:900);
    const n=Math.min(arr.length,cap);

    ctx.save();
    ctx.globalCompositeOperation='lighter';
    for(let i=0;i<n;i++){
      const p=arr[i];
      if(!p||!p.pos)continue;
      const a=clamp(p.life/p.maxLife,0,1);
      if(a<=0.02)continue;
      const sz=1.2+a*1.4;
      ctx.fillStyle=p.player?(PLAYER_GLOW+a+')'):('rgba(255,255,255,'+a+')');
      ctx.fillRect(p.pos.x-sz*0.5,p.pos.y-sz*0.5,sz,sz);
    }
    ctx.restore();
  }
}