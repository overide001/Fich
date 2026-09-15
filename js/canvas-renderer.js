"use strict";

class Renderer{
  constructor(canvas,eco){this.canvas=canvas;this.ctx=canvas.getContext('2d');this.eco=eco;}
  fit(){
    const s=Math.min(window.innerWidth/CFG.W,window.innerHeight/CFG.H)*0.98;
    this.canvas.style.width=(CFG.W*s)+'px';
    this.canvas.style.height=(CFG.H*s)+'px';
  }
  render(){
    const ctx=this.ctx;
    ctx.fillStyle='#000';ctx.fillRect(0,0,CFG.W,CFG.H);
    this.drawGrid(ctx);
    this.drawFood(ctx);
    this.drawIntentLines(ctx);
    this.drawShockwaves(ctx);
    const sorted=this.eco.fish.slice().sort((a,b)=>a.size-b.size);
    for(const f of sorted)this.drawFish(ctx,f);
    this.drawParticles(ctx);
    this.drawCoinPops(ctx);
    if(this.eco.flicker>0){
      ctx.fillStyle=`rgba(255,255,255,${this.eco.flickerStrength*0.5})`;
      ctx.fillRect(0,0,CFG.W,CFG.H);
    }
  }
  drawGrid(ctx){
    ctx.fillStyle='rgba(40,40,40,0.7)';
    const s=60;
    for(let x=s;x<CFG.W;x+=s)for(let y=s;y<CFG.H;y+=s)ctx.fillRect(x,y,1,1);
    ctx.strokeStyle='rgba(255,255,255,0.06)';ctx.lineWidth=1;
    ctx.strokeRect(1,1,CFG.W-2,CFG.H-2);
  }
  drawFood(ctx){
    const t=performance.now()/700;
    for(const f of this.eco.food){
      const a=0.5+0.5*Math.sin(t+f.phase);
      const b=Math.floor(140+60*a);
      ctx.fillStyle=`rgb(${b},${b},${b})`;
      ctx.fillRect(f.pos.x-f.r,f.pos.y-f.r,f.r*2,f.r*2);
    }
  }
  drawIntentLines(ctx){
    const p=this.eco.player;if(!p||!p.alive)return;
    const R=p.visionRange*1.1,r2=R*R;
    ctx.lineWidth=1;
    for(const f of this.eco.fish){
      if(!f.alive||f.isPlayer)continue;
      if(v.d2(f.pos,p.pos)>r2)continue;
      if(f.state==='CHASE'||f.state==='INTERCEPT'||f.state==='ATTACK'){
        if(f.target&&f.target.alive){
          const aim=f.predict(f.target);
          ctx.strokeStyle='rgba(255,255,255,0.30)';
          ctx.setLineDash([4,5]);
          ctx.beginPath();ctx.moveTo(f.pos.x,f.pos.y);ctx.lineTo(aim.x,aim.y);ctx.stroke();
          ctx.setLineDash([]);
        }
      } else if(f.state==='FLEE'){
        if(f.target&&f.target.alive){
          ctx.strokeStyle='rgba(160,160,160,0.22)';
          ctx.setLineDash([2,6]);
          ctx.beginPath();ctx.moveTo(f.pos.x,f.pos.y);ctx.lineTo(f.target.pos.x,f.target.pos.y);ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
  }
  drawShockwaves(ctx){
    for(const s of this.eco.shockwaves){
      const a=s.life/s.maxLife;
      ctx.strokeStyle=`rgba(255,255,255,${a*0.7})`;
      ctx.lineWidth=1.5;
      ctx.beginPath();ctx.arc(s.pos.x,s.pos.y,s.r,0,Math.PI*2);ctx.stroke();
    }
  }
  drawCoinPops(ctx){
    ctx.save();
    ctx.textAlign='center';ctx.textBaseline='middle';
    for(const c of this.eco.coinPops){
      const a=clamp(c.life/c.maxLife,0,1);
      ctx.fillStyle=`rgba(255,204,68,${a})`;
      ctx.font='bold 20px "Courier New", monospace';
      ctx.fillText(c.text,c.pos.x,c.pos.y);
    }
    ctx.restore();
  }

  drawFish(ctx,fish){
    const sp=fish.renderSpine();
    const n=sp.length;
    const top=new Array(n),bot=new Array(n);
    for(let i=0;i<n;i++){
      const p=sp[i];
      const prev=sp[Math.max(0,i-1)],next=sp[Math.min(n-1,i+1)];
      let dx=next.x-prev.x,dy=next.y-prev.y;
      const d=Math.hypot(dx,dy)||1;dx/=d;dy/=d;
      const px=-dy,py=dx;
      const t=i/(n-1);
      const w=widthAt(fish.profileKey(),t)*fish.size;
      top[i]={x:p.x+px*w,y:p.y+py*w};
      bot[i]={x:p.x-px*w,y:p.y-py*w};
    }
    const alpha=fish.spawnTimer>0?clamp(1-fish.spawnTimer/0.5,0,1):1;
    if(alpha<=0)return;

    const isP=fish.isPlayer;
    const bodyColor=fish.colorKey();       /* amber if player */
    const accent=fish.accentKey();

    ctx.save();
    ctx.globalAlpha=alpha;

    /* Skin visual modifiers */
    const skin=isP?fish.skin:null;
    let glowMul=isP?1:0.45;
    let bodyAlphaMul=1;
    let outlineStyle=isP?'#ffea99':'#ffffff';
    let outlineWidth=1.1;
    let outlineDash=null;
    let striped=false;
    let outlineOffset=0;

    if(skin==='ghost'){ glowMul=1.6; bodyAlphaMul=0.55; outlineWidth=0.8; }
    else if(skin==='glitch'){
      const jx=Math.sin(fish.glitchPhase*1.7)*1.8;
      const jy=Math.cos(fish.glitchPhase*2.1)*1.8;
      ctx.translate(jx,jy);
      outlineWidth=1.4;
    }
    else if(skin==='scanline'){ striped=true; }
    else if(skin==='dotted'){ outlineDash=[3,3]; outlineWidth=1.5; }
    else if(skin==='solid'){ outlineWidth=0; }
    else if(skin==='holo'){ outlineWidth=2.2; outlineOffset=3; }
    else if(skin==='reverse'){ bodyAlphaMul=0; outlineWidth=2.0; }

    /* Glow — colored for player, white for AI */
    const glowR=fish.size*2.6;
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    const gA=(isP?0.32:0.10)*alpha*glowMul;
    ctx.fillStyle=isP?`${PLAYER_GLOW}${gA})`:`rgba(255,255,255,${gA})`;
    ctx.beginPath();ctx.arc(fish.pos.x,fish.pos.y,glowR,0,Math.PI*2);ctx.fill();
    ctx.restore();

    /* Evolution rings — colored for player */
    if(fish.evolveAnim>0){
      const t=1-fish.evolveAnim/CFG.EVO_DUR;
      for(let i=0;i<3;i++){
        const lt=(t+i*0.2)%1;
        const rr=fish.size*1.6+lt*fish.size*5;
        const aa=(1-lt)*0.85*alpha;
        ctx.strokeStyle=isP?`${PLAYER_GLOW}${aa})`:`rgba(255,255,255,${aa})`;
        ctx.lineWidth=2;
        ctx.beginPath();ctx.arc(fish.pos.x,fish.pos.y,rr,0,Math.PI*2);ctx.stroke();
      }
    }

    /* Holo offset shadow first */
    if(skin==='holo'){
      ctx.save();
      ctx.globalAlpha=alpha*0.55;
      ctx.beginPath();
      ctx.moveTo(top[0].x+outlineOffset,top[0].y+outlineOffset);
      for(let i=1;i<n;i++)ctx.lineTo(top[i].x+outlineOffset,top[i].y+outlineOffset);
      for(let i=n-1;i>=0;i--)ctx.lineTo(bot[i].x+outlineOffset,bot[i].y+outlineOffset);
      ctx.closePath();
      ctx.strokeStyle=isP?`${PLAYER_GLOW}0.6)`:'rgba(255,255,255,0.55)';
      ctx.lineWidth=1;
      ctx.stroke();
      ctx.restore();
    }

    /* Body */
    ctx.beginPath();
    ctx.moveTo(top[0].x,top[0].y);
    for(let i=1;i<n;i++)ctx.lineTo(top[i].x,top[i].y);
    for(let i=n-1;i>=0;i--)ctx.lineTo(bot[i].x,bot[i].y);
    ctx.closePath();
    ctx.globalAlpha=alpha*bodyAlphaMul;
    ctx.fillStyle=bodyColor;
    ctx.fill();
    ctx.globalAlpha=alpha;
    ctx.strokeStyle=outlineStyle;
    ctx.lineWidth=outlineWidth;
    if(outlineDash){ctx.setLineDash(outlineDash);}
    if(outlineWidth>0)ctx.stroke();
    if(outlineDash){ctx.setLineDash([]);}

    if(striped){
      ctx.save();
      ctx.clip();
      ctx.strokeStyle=isP?'rgba(0,0,0,0.7)':'rgba(0,0,0,0.9)';
      ctx.lineWidth=1.4;
      const step=5;
      for(let y=fish.pos.y-fish.size*1.2;y<fish.pos.y+fish.size*1.2;y+=step){
        ctx.beginPath();ctx.moveTo(fish.pos.x-fish.size*2,y);ctx.lineTo(fish.pos.x+fish.size*2,y);ctx.stroke();
      }
      ctx.restore();
    }

    this.drawDorsal(ctx,fish,sp,top,bodyColor,outlineStyle);
    this.drawTail(ctx,fish,sp,bodyColor,outlineStyle);
    this.drawPectoral(ctx,fish,sp,bodyColor,outlineStyle);
    this.drawEye(ctx,fish,sp,isP);
    if(fish.lineage.lure)this.drawLure(ctx,fish,sp);

    /* Player ring */
    if(isP){
      ctx.strokeStyle=`${PLAYER_GLOW}0.7)`;
      ctx.lineWidth=1;
      ctx.setLineDash([5,4]);
      ctx.beginPath();ctx.arc(fish.pos.x,fish.pos.y,fish.size*1.7,0,Math.PI*2);ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle=`${PLAYER_GLOW}0.14)`;
      ctx.beginPath();ctx.arc(fish.pos.x,fish.pos.y,fish.visionRange,0,Math.PI*2);ctx.stroke();
    }
    ctx.restore();
  }

  drawLure(ctx,fish,sp){
    const head=sp[0];
    const prev=sp[1]||sp[0];
    let dx=head.x-prev.x,dy=head.y-prev.y;
    const d=Math.hypot(dx,dy)||1;dx/=d;dy/=d;
    const px=-dy,py=dx;
    const sway=Math.sin(fish.lurePhase)*0.5;
    const reach=fish.size*1.6;
    const lx=head.x+dx*reach+px*sway*fish.size*0.6;
    const ly=head.y+dy*reach+py*sway*fish.size*0.6;
    const isP=fish.isPlayer;
    ctx.strokeStyle=isP?`${PLAYER_GLOW}0.5)`:'rgba(255,255,255,0.35)';
    ctx.lineWidth=0.8;
    ctx.beginPath();ctx.moveTo(head.x,head.y);ctx.lineTo(lx,ly);ctx.stroke();
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    const pulse=0.6+0.4*Math.sin(fish.lurePhase*2);
    const r=Math.max(2,fish.size*0.4)*pulse;
    const g=ctx.createRadialGradient(lx,ly,0,lx,ly,r*3);
    if(isP){
      g.addColorStop(0,'rgba(255,220,120,0.95)');
      g.addColorStop(0.4,'rgba(255,204,68,0.45)');
      g.addColorStop(1,'rgba(255,204,68,0)');
    } else {
      g.addColorStop(0,'rgba(255,255,255,0.95)');
      g.addColorStop(0.4,'rgba(255,255,255,0.45)');
      g.addColorStop(1,'rgba(255,255,255,0)');
    }
    ctx.fillStyle=g;
    ctx.beginPath();ctx.arc(lx,ly,r*3,0,Math.PI*2);ctx.fill();
    ctx.restore();
    ctx.fillStyle=isP?PLAYER_COLOR:'#fff';
    ctx.beginPath();ctx.arc(lx,ly,r*0.6,0,Math.PI*2);ctx.fill();
  }

  drawDorsal(ctx,fish,sp,top,bodyColor,outlineStyle){
    const style=fish.dorsalKey();
    if(style==='none')return;
    let t=0.35;
    if(style==='rear')t=0.72;
    if(style==='crest')t=0.5;
    const idx=Math.floor(t*(sp.length-1));
    const p=top[idx];
    const prev=top[Math.max(0,idx-2)];
    const next=top[Math.min(sp.length-1,idx+2)];
    let dx=next.x-prev.x,dy=next.y-prev.y;
    const d=Math.hypot(dx,dy)||1;dx/=d;dy/=d;
    const px=-dy,py=dx;
    const c=sp[idx];
    const toOutX=p.x-c.x,toOutY=p.y-c.y;
    const dot=px*toOutX+py*toOutY;
    const nx=dot<0?-px:px,ny=dot<0?-py:py;
    const sz=fish.size;
    ctx.fillStyle=bodyColor;
    ctx.strokeStyle=outlineStyle;ctx.lineWidth=1;

    if(style==='tiny'){
      ctx.beginPath();
      ctx.moveTo(p.x-nx*sz*0.15,p.y-ny*sz*0.15);
      ctx.lineTo(p.x+nx*sz*0.28,p.y+ny*sz*0.28);
      ctx.lineTo(p.x+dx*sz*0.28+nx*sz*0.05,p.y+dy*sz*0.28+ny*sz*0.05);
      ctx.closePath();ctx.fill();ctx.stroke();
    } else if(style==='spiny'){
      ctx.beginPath();
      const segs=4,span=sz*0.9;
      ctx.moveTo(p.x-nx*sz*0.05-dx*span*0.4,p.y-ny*sz*0.05-dy*span*0.4);
      for(let i=0;i<segs;i++){
        const f=(i+0.5)/segs;
        ctx.lineTo(p.x+dx*span*(f-0.4)+nx*sz*0.45,p.y+dy*span*(f-0.4)+ny*sz*0.45);
        ctx.lineTo(p.x+dx*span*(f-0.4+0.15)+nx*sz*0.05,p.y+dy*span*(f-0.4+0.15)+ny*sz*0.05);
      }
      ctx.lineTo(p.x+dx*span*0.5+nx*sz*0.05,p.y+dy*span*0.5+ny*sz*0.05);
      ctx.closePath();ctx.fill();ctx.stroke();
    } else if(style==='rear'){
      ctx.beginPath();
      ctx.moveTo(p.x-nx*sz*0.1-dx*sz*0.2,p.y-ny*sz*0.1-dy*sz*0.2);
      ctx.lineTo(p.x+nx*sz*0.35-dx*sz*0.1,p.y+ny*sz*0.35-dy*sz*0.1);
      ctx.lineTo(p.x-nx*sz*0.1+dx*sz*0.2,p.y-ny*sz*0.1+dy*sz*0.2);
      ctx.closePath();ctx.fill();ctx.stroke();
    } else if(style==='spike'){
      const segs=3,span=sz*1.1;
      ctx.beginPath();
      ctx.moveTo(p.x-dx*span*0.5,p.y-dy*span*0.5);
      for(let i=0;i<segs;i++){
        const f=(i+0.5)/segs;
        ctx.lineTo(p.x+dx*span*(f-0.5)+nx*sz*0.85,p.y+dy*span*(f-0.5)+ny*sz*0.85);
        ctx.lineTo(p.x+dx*span*(f-0.5+0.18)+nx*sz*0.05,p.y+dy*span*(f-0.5+0.18)+ny*sz*0.05);
      }
      ctx.lineTo(p.x+dx*span*0.5,p.y+dy*span*0.5);
      ctx.closePath();ctx.fill();ctx.stroke();
    } else if(style==='crest'){
      ctx.beginPath();
      const startIdx=Math.floor(sp.length*0.15);
      const endIdx=Math.floor(sp.length*0.9);
      const startTop=top[startIdx];
      ctx.moveTo(startTop.x,startTop.y);
      for(let i=startIdx;i<=endIdx;i++){
        const tt=i/(sp.length-1);
        const pt=top[i];
        const h=sz*(0.35+0.25*Math.sin((tt-0.15)*Math.PI/0.75));
        const prevT=top[Math.max(0,i-1)],nextT=top[Math.min(sp.length-1,i+1)];
        let ddx=nextT.x-prevT.x,ddy=nextT.y-prevT.y;
        const dl=Math.hypot(ddx,ddy)||1;ddx/=dl;ddy/=dl;
        ctx.lineTo(pt.x-ddy*h,pt.y+ddx*h);
      }
      for(let i=endIdx;i>=startIdx;i--)ctx.lineTo(top[i].x,top[i].y);
      ctx.closePath();ctx.fill();ctx.stroke();
    }
  }

  drawTail(ctx,fish,sp,bodyColor,outlineStyle){
    const n=sp.length;
    const tp=sp[n-1],tp2=sp[n-2];
    let dx=tp.x-tp2.x,dy=tp.y-tp2.y;
    const d=Math.hypot(dx,dy)||1;dx/=d;dy/=d;
    const px=-dy,py=dx;
    const sz=fish.size*1.5;
    const style=fish.shapeKey();
    ctx.fillStyle=bodyColor;
    ctx.strokeStyle=outlineStyle;ctx.lineWidth=1;
    if(style==='forked'){
      ctx.beginPath();
      ctx.moveTo(tp.x,tp.y);
      ctx.lineTo(tp.x+dx*sz*0.2+px*sz*0.65,tp.y+dy*sz*0.2+py*sz*0.65);
      ctx.lineTo(tp.x+dx*sz*0.55,tp.y+dy*sz*0.55);
      ctx.lineTo(tp.x+dx*sz*0.2-px*sz*0.65,tp.y+dy*sz*0.2-py*sz*0.65);
      ctx.closePath();ctx.fill();ctx.stroke();
    } else if(style==='fan'){
      ctx.beginPath();
      ctx.moveTo(tp.x,tp.y);
      ctx.quadraticCurveTo(tp.x+dx*sz*0.7+px*sz*0.85,tp.y+dy*sz*0.7+py*sz*0.85,tp.x+dx*sz*1.05,tp.y+dy*sz*1.05);
      ctx.quadraticCurveTo(tp.x+dx*sz*0.7-px*sz*0.85,tp.y+dy*sz*0.7-py*sz*0.85,tp.x,tp.y);
      ctx.closePath();ctx.fill();ctx.stroke();
    } else if(style==='crescent'){
      ctx.beginPath();
      ctx.moveTo(tp.x,tp.y);
      ctx.quadraticCurveTo(tp.x+dx*sz*0.4+px*sz*1.1,tp.y+dy*sz*0.4+py*sz*1.1,
                            tp.x+dx*sz*1.15+px*sz*0.45,tp.y+dy*sz*1.15+py*sz*0.45);
      ctx.lineTo(tp.x+dx*sz*0.7,tp.y+dy*sz*0.7);
      ctx.lineTo(tp.x+dx*sz*1.15-px*sz*0.45,tp.y+dy*sz*1.15-py*sz*0.45);
      ctx.quadraticCurveTo(tp.x+dx*sz*0.4-px*sz*1.1,tp.y+dy*sz*0.4-py*sz*1.1,tp.x,tp.y);
      ctx.closePath();ctx.fill();ctx.stroke();
    } else if(style==='spike'){
      ctx.beginPath();
      ctx.moveTo(tp.x,tp.y);
      ctx.lineTo(tp.x+dx*sz*0.3+px*sz*0.9,tp.y+dy*sz*0.3+py*sz*0.9);
      ctx.lineTo(tp.x+dx*sz*0.55+px*sz*0.35,tp.y+dy*sz*0.55+py*sz*0.35);
      ctx.lineTo(tp.x+dx*sz*0.7,tp.y+dy*sz*0.7);
      ctx.lineTo(tp.x+dx*sz*0.55-px*sz*0.35,tp.y+dy*sz*0.55-py*sz*0.35);
      ctx.lineTo(tp.x+dx*sz*0.3-px*sz*0.9,tp.y+dy*sz*0.3-py*sz*0.9);
      ctx.closePath();ctx.fill();ctx.stroke();
    }
  }

  drawPectoral(ctx,fish,sp,bodyColor,outlineStyle){
    const idx=Math.floor(sp.length*0.28);
    const p=sp[idx];
    const prev=sp[Math.max(0,idx-1)];
    let dx=p.x-prev.x,dy=p.y-prev.y;
    const d=Math.hypot(dx,dy)||1;dx/=d;dy/=d;
    const px=-dy,py=dx;
    const sz=fish.size*0.5;
    const flap=Math.sin(fish.swimPhase*1.8)*0.35;
    ctx.save();
    ctx.translate(p.x,p.y);
    ctx.rotate(Math.atan2(py,px)+flap);
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.lineTo(sz*0.5,sz*0.6);
    ctx.lineTo(-sz*0.2,sz*0.5);
    ctx.closePath();
    ctx.fillStyle=bodyColor;
    ctx.strokeStyle=outlineStyle;ctx.lineWidth=0.8;
    ctx.globalAlpha*=0.75;
    ctx.fill();ctx.stroke();
    ctx.restore();
  }

  drawEye(ctx,fish,sp,isP){
    const idx=1;
    const p=sp[idx];
    const prev=sp[0];
    let dx=p.x-prev.x,dy=p.y-prev.y;
    const d=Math.hypot(dx,dy)||1;dx/=d;dy/=d;
    const px=-dy,py=dx;
    const ex=p.x+px*fish.size*0.32;
    const ey=p.y+py*fish.size*0.32;
    const r=Math.max(1.1,fish.size*0.15);
    if(fish.aggression()>0.7||isP){
      ctx.save();
      ctx.globalCompositeOperation='lighter';
      ctx.fillStyle=isP?`${PLAYER_GLOW}0.6)`:'rgba(255,255,255,0.4)';
      ctx.beginPath();ctx.arc(ex,ey,r*2.4,0,Math.PI*2);ctx.fill();
      ctx.restore();
    }
    if(fish.blinkAnim>0){
      ctx.strokeStyle='#000';ctx.lineWidth=1.5;
      ctx.beginPath();ctx.moveTo(ex-r,ey);ctx.lineTo(ex+r,ey);ctx.stroke();
    } else {
      ctx.fillStyle=isP?'#fff':'#fff';
      ctx.beginPath();ctx.arc(ex,ey,r,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=isP?'#221100':'#000';
      ctx.beginPath();ctx.arc(ex+r*0.15,ey,r*0.55,0,Math.PI*2);ctx.fill();
    }
  }

  drawParticles(ctx){
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    for(const p of this.eco.particles){
      const a=clamp(p.life/p.maxLife,0,1);
      const sz=1.2+a*1.4;
      ctx.fillStyle=p.player?`${PLAYER_GLOW}${a})`:`rgba(255,255,255,${a})`;
      ctx.fillRect(p.pos.x-sz*0.5,p.pos.y-sz*0.5,sz,sz);
    }
    ctx.restore();
  }
}


