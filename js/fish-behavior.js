"use strict";

class Fish{
  constructor(x,y,size,lineageKey,isPlayer=false,skin=null){
    this.pos={x,y};this.vel={x:0,y:0};
    this.angle=Math.random()*Math.PI*2;
    this.size=size;
    this.lineageKey=lineageKey;
    this.lineage=LINEAGES[lineageKey]||LINEAGES.predator;
    this.isPlayer=isPlayer;this.alive=true;
    this.stage=this._stageOf(size);
    this.skin=skin;

    this.maxEnergy=100+size*10;
    this.energy=isPlayer?CFG.P_NRJ:this.maxEnergy*CFG.AI_START_ENERGY;
    this.stamina=CFG.STAM_MAX;
    this.kills=0;this.age=0;
    this.feedTimer=0;this.spawnTimer=0.5;this.deathReason='';
    this.coinsEarned=0;

    this.nearby=[];this.perceived=new Map();
    this.visionRange=this._vis();
    this.target=null;this.targetMemory=0;this.lastKnown=null;

    this.state='WANDER';
    this.wanderAngle=this.angle;
    this.fleeDir={x:1,y:0};

    this.numSeg=lineageKey==='serpent'?14:12;
    this.spineLen=size*3.4;
    this.spine=[];
    for(let i=0;i<this.numSeg;i++){
      const f=i/(this.numSeg-1);
      this.spine.push({x:x-Math.cos(this.angle)*this.spineLen*f,
                       y:y-Math.sin(this.angle)*this.spineLen*f});
    }
    this.swimPhase=Math.random()*Math.PI*2;
    this.evolveAnim=0;this.evolveFrom=1;this.evolveTo=1;
    this.blinkTimer=rand(2,6);this.blinkAnim=0;this.lungeTimer=0;
    this.lurePhase=Math.random()*Math.PI*2;
    this.glitchPhase=Math.random()*100;
  }

  stageDef(){ return this.lineage.stages[Math.min(this.stage-1,this.lineage.stages.length-1)]; }
  aggression(){ return this.stageDef().aggr * this.lineage.aggrMul; }

  _stageOf(s){
    if(s>=CFG.EV_4)return 4;
    if(s>=CFG.EV_3)return 3;
    if(s>=CFG.EV_2)return 2;
    return 1;
  }
  _spd(){
    let s=Math.max(CFG.SPD_MIN,CFG.SPD+CFG.SPD_SZ*this.size);
    s*=this.lineage.spdMul;
    if(this.isPlayer)s*=CFG.P_SPD;
    return s;
  }
  _vis(){ return (CFG.VIS_BASE+CFG.VIS_SZ*this.size)*this.lineage.visMul; }
  _metab(){
    let m=CFG.METAB+this.size*CFG.METAB_SZ;
    if(this.lineage.ambush)m*=0.85;
    return m;
  }
  defSize(){ return this.size*this.lineage.defMul; }

  /* ---- COLOR: player is amber, everyone else grayscale ---- */
  colorKey(){
    if(this.isPlayer) return PLAYER_COLOR;
    return this.stageDef().color;
  }
  accentKey(){
    if(this.isPlayer) return PLAYER_DARK;
    return this.stageDef().color;
  }
  profileKey(){return this.stageDef().profile;}
  shapeKey(){return this.stageDef().shape;}
  dorsalKey(){return this.stageDef().dorsal;}

  update(dt,eco){
    if(!this.alive)return;
    this.age+=dt;
    if(this.spawnTimer>0)this.spawnTimer-=dt;
    if(this.feedTimer>0){this.feedTimer-=dt;if(this.feedTimer<=0&&this.state==='FEED')this.state='WANDER';}
    if(this.evolveAnim>0)this.evolveAnim-=dt;
    if(this.lungeTimer>0)this.lungeTimer-=dt;
    this.blinkTimer-=dt;
    if(this.blinkTimer<=0){this.blinkAnim=0.12;this.blinkTimer=rand(2.5,6);}
    if(this.blinkAnim>0)this.blinkAnim-=dt;
    this.glitchPhase+=dt*13;

    this.energy-=this._metab()*dt;
    if(this.energy<=0){this.die(eco,'starved');return;}

    if(!this.isPlayer){
      const sm=this.lineage.stamMul;
      if(this.state==='FLEE') this.stamina=Math.max(0,this.stamina-CFG.STAM_DRAIN_FLEE*dt*sm);
      else if(this.state==='CHASE'||this.state==='INTERCEPT'||this.state==='ATTACK')
        this.stamina=Math.max(0,this.stamina-CFG.STAM_DRAIN_CHASE*dt*sm);
      else this.stamina=Math.min(CFG.STAM_MAX,this.stamina+CFG.STAM_REGEN*dt);
    }
    this.visionRange=this._vis();
    this.perceive(eco.fish);
    if(this.isPlayer)this.playerInput(eco.input,dt);
    else { this.decide(dt,eco); this.moveAI(dt); }
    this.updateSpine();
    const spd=Math.hypot(this.vel.x,this.vel.y);
    this.swimPhase+=dt*(3+spd*0.055);
    this.lurePhase+=dt*3;
  }

  die(eco,reason){
    if(!this.alive)return;
    this.alive=false;this.deathReason=reason;
    if(eco){
      const n=reason==='eaten'?10+Math.floor(this.size*0.5):8;
      eco.spawnParticles(this.pos,n,this.isPlayer?'player':'ai');
    }
  }

  perceive(all){
    this.nearby.length=0;this.perceived.clear();
    const r2=this.visionRange*this.visionRange;
    for(let i=0;i<all.length;i++){
      const f=all[i];
      if(f===this||!f.alive)continue;
      if(v.d2(this.pos,f.pos)<=r2){
        this.nearby.push(f);
        this.perceived.set(f,this.classify(f));
      }
    }
    if(this.target){
      if(!this.target.alive){this.target=null;this.lastKnown=null;}
      else if(this.perceived.has(this.target)){
        this.lastKnown={x:this.target.pos.x,y:this.target.pos.y};
        this.targetMemory=CFG.MEMORY;
      } else {
        this.targetMemory-=1/60;
        if(this.targetMemory<=0){this.target=null;this.lastKnown=null;}
      }
    }
  }
  classify(o){
    if(this.defSize()>=o.defSize()*CFG.SIZE_RATIO)return 'PREY';
    if(o.defSize()>=this.defSize()*CFG.SIZE_RATIO)return 'THREAT';
    if(o.aggression()>0.7&&o.size>this.size*0.85)return 'THREAT';
    return 'NEUTRAL';
  }

  decide(dt,eco){
    const hunger=1-this.energy/this.maxEnergy;
    let threat=null,bestThreat=0;
    for(const f of this.nearby){
      if(this.perceived.get(f)!=='THREAT')continue;
      const d=v.d(this.pos,f.pos);
      if(d>this.visionRange*0.80)continue;
      const sizeDelta=f.defSize()/this.defSize();
      const closeScore=1-d/this.visionRange;
      const score=closeScore*2+Math.min(sizeDelta,3);
      if(score>bestThreat){bestThreat=score;threat=f;}
    }
    if(threat){
      this.state='FLEE';this.target=threat;
      this.updateFleeDir(threat);return;
    }
    if(this.target&&this.target.alive&&this.perceived.has(this.target)&&
       this.perceived.get(this.target)==='PREY'){
      const d=v.d(this.pos,this.target.pos);
      if(d<(this.size+this.target.size)*1.35)this.state='ATTACK';
      else if(d<this.visionRange*0.85)this.state='INTERCEPT';
      else this.state='CHASE';
      return;
    }
    if(hunger>CFG.HUNGER){
      let prey=null,bestScore=0;
      for(const f of this.nearby){
        if(this.perceived.get(f)!=='PREY')continue;
        const d=v.d(this.pos,f.pos);
        if(d>this.visionRange)continue;
        const distScore=1-d/this.visionRange;
        const foodValue=Math.min(f.size/this.size*1.4,1);
        const vuln=1-f.energy/f.maxEnergy;
        const stam=1-f.stamina/CFG.STAM_MAX;
        const hungerBoost=hunger>0.4?1.35:(hunger>0.2?1.15:1.0);
        const score=(distScore*2.2+foodValue*1.4+vuln*0.9+stam*0.8)*hungerBoost;
        if(score>bestScore){bestScore=score;prey=f;}
      }
      if(prey){
        this.target=prey;
        this.lastKnown={x:prey.pos.x,y:prey.pos.y};
        this.targetMemory=CFG.MEMORY;
        const d=v.d(this.pos,prey.pos);
        if(d<(this.size+prey.size)*1.35)this.state='ATTACK';
        else if(d<this.visionRange*0.85)this.state='INTERCEPT';
        else this.state='CHASE';
        return;
      }
    }
    if(this.target&&this.lastKnown&&this.targetMemory>0){this.state='CHASE';return;}
    this.state='WANDER';this.target=null;
    if(hunger>0.3&&eco.food.length>0&&Math.random()<0.06){
      let best=null,bd=Infinity;
      for(const fd of eco.food){
        const d=v.d2(this.pos,fd.pos);
        if(d<bd){bd=d;best=fd;}
      }
      if(best&&bd<this.visionRange*this.visionRange*3){
        this.wanderAngle=Math.atan2(best.pos.y-this.pos.y,best.pos.x-this.pos.x);
      }
    } else if(Math.random()<0.02){this.wanderAngle+=rand(-0.8,0.8);}
  }

  updateFleeDir(threat){
    let ax=0,ay=0;
    const away=v.norm(v.sub(this.pos,threat.pos));
    ax+=away.x*1.6;ay+=away.y*1.6;
    for(const f of this.nearby){
      if(f===threat)continue;
      if(this.perceived.get(f)!=='THREAT')continue;
      const a2=v.norm(v.sub(this.pos,f.pos));
      ax+=a2.x*0.7;ay+=a2.y*0.7;
    }
    const m=CFG.EDGE;
    if(this.pos.x<m)ax+=1-(this.pos.x/m);
    if(this.pos.x>CFG.W-m)ax-=1-((CFG.W-this.pos.x)/m);
    if(this.pos.y<m)ay+=1-(this.pos.y/m);
    if(this.pos.y>CFG.H-m)ay-=1-((CFG.H-this.pos.y)/m);
    const juke=(Math.random()-0.5)*0.35;
    const n=v.norm({x:ax,y:ay});
    const jA=Math.atan2(n.y,n.x)+juke;
    this.fleeDir={x:Math.cos(jA),y:Math.sin(jA)};
  }

  moveAI(dt){
    let desX=0,desY=0,spdMult=1;
    if(this.state==='FLEE'){
      desX=this.fleeDir.x;desY=this.fleeDir.y;
      const sf=this.stamina/CFG.STAM_MAX;
      spdMult=1.0+0.30*sf;
    } else if(this.state==='CHASE'){
      const aim=this.aimPos();
      if(aim){const n=v.norm(v.sub(aim,this.pos));desX=n.x;desY=n.y;}
      else{desX=Math.cos(this.wanderAngle);desY=Math.sin(this.wanderAngle);}
      spdMult=1.15;
    } else if(this.state==='INTERCEPT'){
      const aim=this.aimPos();
      if(aim){const n=v.norm(v.sub(aim,this.pos));desX=n.x;desY=n.y;}
      else{desX=Math.cos(this.wanderAngle);desY=Math.sin(this.wanderAngle);}
      spdMult=1.30;
    } else if(this.state==='ATTACK'){
      if(this.target&&this.target.alive){
        const n=v.norm(v.sub(this.target.pos,this.pos));
        desX=n.x;desY=n.y;
      } else {desX=Math.cos(this.angle);desY=Math.sin(this.angle);}
      spdMult=1.55;
    } else {
      desX=Math.cos(this.wanderAngle);desY=Math.sin(this.wanderAngle);
      if(this.lineage.ambush)spdMult=0.45;
    }
    const m=CFG.EDGE;
    let bx=0,by=0;
    if(this.pos.x<m)bx+=1-this.pos.x/m;
    if(this.pos.x>CFG.W-m)bx-=1-(CFG.W-this.pos.x)/m;
    if(this.pos.y<m)by+=1-this.pos.y/m;
    if(this.pos.y>CFG.H-m)by-=1-(CFG.H-this.pos.y)/m;
    if(bx||by){desX+=bx*1.4;desY+=by*1.4;}
    const desA=Math.atan2(desY,desX);
    const diff=wrapA(desA-this.angle);
    const maxTurn=CFG.TURN_AI*dt;
    this.angle+=clamp(diff,-maxTurn,maxTurn);
    const spd=this._spd()*spdMult;
    this.vel.x=Math.cos(this.angle)*spd;
    this.vel.y=Math.sin(this.angle)*spd;
    this.pos.x+=this.vel.x*dt;this.pos.y+=this.vel.y*dt;
    this.pos.x=clamp(this.pos.x,4,CFG.W-4);
    this.pos.y=clamp(this.pos.y,4,CFG.H-4);
  }
  aimPos(){
    if(this.target&&this.target.alive&&this.perceived.has(this.target))
      return this.predict(this.target);
    if(this.lastKnown)return this.lastKnown;
    return null;
  }
  predict(t){
    const d=v.d(this.pos,t.pos);
    const tt=Math.min(d/Math.max(1,this._spd()),CFG.PREDICT_CAP);
    return{x:t.pos.x+t.vel.x*tt,y:t.pos.y+t.vel.y*tt};
  }

  playerInput(input,dt){
    const d=input.getDir();
    const m=Math.hypot(d.x,d.y);
    let spdMult=1.0;
    if(m>0.01){
      const na=Math.atan2(d.y,d.x);
      const diff=wrapA(na-this.angle);
      this.angle+=clamp(diff,-CFG.TURN_PLR*dt,CFG.TURN_PLR*dt);
      this.state='ATTACK';
      const sf=this.stamina/CFG.STAM_MAX;
      spdMult=1.0+0.30*sf;
      this.stamina=Math.max(0,this.stamina-CFG.STAM_DRAIN_CHASE*dt*this.lineage.stamMul);
    } else {
      this.state='WANDER';
      this.stamina=Math.min(CFG.STAM_MAX,this.stamina+CFG.STAM_REGEN*dt);
    }
    const spd=this._spd()*spdMult;
    this.vel.x=Math.cos(this.angle)*spd;
    this.vel.y=Math.sin(this.angle)*spd;
    this.pos.x+=this.vel.x*dt;this.pos.y+=this.vel.y*dt;
    this.pos.x=clamp(this.pos.x,4,CFG.W-4);
    this.pos.y=clamp(this.pos.y,4,CFG.H-4);
    this.target=null;
    let bd=Infinity;
    for(const f of this.nearby){
      if(this.perceived.get(f)!=='PREY')continue;
      const dd=v.d2(this.pos,f.pos);
      if(dd<bd){bd=dd;this.target=f;}
    }
  }

  updateSpine(){
    this.spineLen=this.size*3.4;
    this.spine[0].x=this.pos.x;this.spine[0].y=this.pos.y;
    const segLen=this.spineLen/(this.numSeg-1);
    for(let i=1;i<this.numSeg;i++){
      const p=this.spine[i-1],c=this.spine[i];
      let dx=c.x-p.x,dy=c.y-p.y;
      const d=Math.hypot(dx,dy)||1;
      c.x=p.x+(dx/d)*segLen;
      c.y=p.y+(dy/d)*segLen;
    }
  }
  renderSpine(){
    const out=[],n=this.numSeg;
    const eatStretch=this.feedTimer>0?1+this.feedTimer*1.6:1;
    const waveScale=this.lineageKey==='serpent'?0.45:0.28;
    for(let i=0;i<n;i++){
      const p=this.spine[i];
      const prev=this.spine[Math.max(0,i-1)];
      const next=this.spine[Math.min(n-1,i+1)];
      let dx=next.x-prev.x,dy=next.y-prev.y;
      const d=Math.hypot(dx,dy)||1;dx/=d;dy/=d;
      const px=-dy,py=dx;
      const t=i/(n-1);
      const waveAmp=this.size*waveScale*t*t*eatStretch;
      const wave=Math.sin(this.swimPhase-t*Math.PI*2.4)*waveAmp;
      out.push({x:p.x+px*wave,y:p.y+py*wave});
    }
    return out;
  }

  canEat(prey){return this.defSize()>=prey.defSize()*CFG.SIZE_RATIO;}

  eat(prey,eco){
    if(!prey.alive)return;
    prey.die(eco,'eaten');
    this.energy=Math.min(this.maxEnergy,this.energy+prey.size*CFG.EAT_ENERGY);
    this.grow(prey.size*CFG.EAT_GROWTH*eco.profile.growthMult);
    this.kills++;
    this.feedTimer=0.35;this.state='FEED';this.lungeTimer=0.15;
    if(this.isPlayer){
      const base=1+(prey.stage-1);
      const coins=Math.max(1,Math.round(base*eco.profile.coinMult));
      this.coinsEarned+=coins;
      eco.pendingCoins+=coins;
      eco.spawnCoinPopup(prey.pos,coins);
    }
    if(eco){
      const pn=Math.min(24,8+Math.floor(prey.size*0.7));
      eco.spawnParticles(prey.pos,pn,prey.isPlayer?'player':'ai');
      eco.spawnShockwave(prey.pos,prey.size*1.8);
      eco.flicker=Math.max(eco.flicker,0.08);
      eco.flickerStrength=0.55;
    }
  }
  eatFood(fd,eco){
    this.energy=Math.min(this.maxEnergy,this.energy+CFG.FOOD_NRJ);
    this.grow(CFG.FOOD_GROW*eco.profile.growthMult);
    if(eco)eco.spawnParticles(fd.pos,2,'ai');
  }
  grow(a){
    this.size+=a;
    this.maxEnergy=100+this.size*10;
    this.checkEvolve();
  }
  checkEvolve(){
    const ns=this._stageOf(this.size);
    if(ns>this.stage){
      const from=this.stage;
      this.stage=ns;
      this.evolveAnim=CFG.EVO_DUR;
      this.evolveFrom=from;this.evolveTo=ns;
      this.energy=Math.min(this.maxEnergy,this.energy+30);
      if(this.isPlayer&&this.onEvolve)this.onEvolve(from,ns);
    }
  }
}


