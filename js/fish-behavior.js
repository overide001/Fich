"use strict";

/* ==========================================================================
   Fish  —  living-ecosystem AI
   --------------------------------------------------------------------------
   Public interface (constructor + method names) matches the original class.
   Everything downstream (particles, evolution UI, shop, ecosystem) keeps
   working. Only the internals — perception, memory, decision-making, combat —
   have been replaced with a richer simulation.
   ========================================================================== */

class Fish{
  constructor(x,y,size,lineageKey,isPlayer=false,skin=null){
    /* --------------------------- CORE (unchanged) --------------------------- */
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

    /* ---------------------- NEW: individual mind & body --------------------- */
    this._initPersonality();
    this._initMemory();
    this._initBody();
    this._initBehaviorCaches();

    this._envRef=null;
    this._ecoRef=null;
    this.homeX=x;this.homeY=y;
    this.territory=null;
  }

  /* =========================================================================
     INITIALIZATION HELPERS
     ========================================================================= */

  _initPersonality(){
    const rnd=(a,b)=>a+Math.random()*(b-a);
    const B={
      predator:{agg: 0.22,brv: 0.10,soc: 0.22,ter: 0.08,exp: 0.02,cur: 0.00},
      swift:   {agg:-0.10,brv:-0.14,soc: 0.34,ter:-0.15,exp: 0.22,cur: 0.06},
      armor:   {agg: 0.00,brv: 0.32,soc:-0.04,ter: 0.24,exp:-0.14,cur:-0.10},
      serpent: {agg: 0.14,brv: 0.04,soc:-0.16,ter: 0.32,exp: 0.00,cur:-0.04},
      abyss:   {agg: 0.08,brv:-0.06,soc:-0.28,ter: 0.20,exp: 0.04,cur: 0.12}
    }[this.lineageKey]||{agg:0,brv:0,soc:0,ter:0,exp:0,cur:0};

    this.psy={
      aggression:      clamp(0.38+rnd(-0.22,0.42)+B.agg,0,1),
      bravery:         clamp(0.45+rnd(-0.28,0.40)+B.brv,0,1),
      curiosity:       clamp(0.45+rnd(-0.25,0.35)+B.cur,0,1),
      intelligence:    clamp(0.42+rnd(-0.22,0.42),0,1),
      sociality:       clamp(0.34+rnd(-0.28,0.44)+B.soc,0,1),
      hungerTolerance: clamp(0.42+rnd(-0.28,0.38),0.06,1),
      riskTolerance:   clamp(0.40+rnd(-0.28,0.40),0,1),
      territoriality:  clamp(0.22+rnd(-0.18,0.44)+B.ter,0,1),
      speedPreference: clamp(0.46+rnd(-0.24,0.34),0,1),
      exploration:     clamp(0.45+rnd(-0.28,0.40)+B.exp,0,1),
      patience:        clamp(0.42+rnd(-0.28,0.38),0,1),
      vengeance:       clamp(0.30+rnd(-0.24,0.40),0,1)
    };

    this.huntStrategy=this._chooseStrategy();
    this.fear=0;
    this.anger=0;
  }

  _chooseStrategy(){
    const a=Math.random();
    switch(this.lineageKey){
      case 'serpent': return a<0.5?'AMBUSH':(a<0.8?'STALK':'INTERCEPT');
      case 'abyss':   return a<0.75?'AMBUSH':'STALK';
      case 'swift':   return a<0.6?'INTERCEPT':'EXHAUST';
      case 'predator':return a<0.35?'PACK':(a<0.75?'INTERCEPT':'CHASE');
      case 'armor':   return a<0.5?'CHASE':'CORNER';
      default:        return a<0.4?'AMBUSH':(a<0.75?'INTERCEPT':'CHASE');
    }
  }

  _initMemory(){
    this.memory=[];
    this.maxMemory=36;
  }

  _initBody(){
    this.maxHp=60+this.size*14;
    this.hp=this.maxHp;
    this.biteCd=0;
    this.biteCdMax=0.6+this.size*0.006;
    this.biteDmg=6+this.size*1.5;
    this.bleeding=0;
    this.stunned=0;
    this.knockX=0;this.knockY=0;
    this.injured=false;
    this.camouflaged=false;
    this.lastAttacker=null;
    this._attackAnim=0;
  }

  _initBehaviorCaches(){
    this._threatList=[];
    this._preyList=[];
    this._allyList=[];
    this.bestThreat=null;this.bestThreatD=Infinity;
    this.bestPrey=null;  this.bestPreyD=Infinity;
    this.bestFood=null;  this.bestFoodD=Infinity;
    this.threatCount=0;this.preyCount=0;this.allyCount=0;

    this._aiTick=0;
    this._aiInterval=0.14+Math.random()*0.12;
    this._qbuf=[];

    this.behavior='WANDER';
  }

  /* =========================================================================
     MATH HELPERS (no external `v` dependency)
     ========================================================================= */
  _norm(x,y){const m=Math.hypot(x,y)||1;return{x:x/m,y:y/m};}
  _distTo(o){return Math.hypot(o.pos.x-this.pos.x,o.pos.y-this.pos.y);}

  /* =========================================================================
     MEMORY
     ========================================================================= */
  _remember(type,x,y,strength,ttl){
    for(let i=0;i<this.memory.length;i++){
      const m=this.memory[i];
      if(m.type!==type)continue;
      const d2=(m.x-x)*(m.x-x)+(m.y-y)*(m.y-y);
      if(d2<100*100){
        m.x=m.x*0.7+x*0.3;m.y=m.y*0.7+y*0.3;
        m.strength=Math.min(2.2,m.strength+strength*0.6);
        m.ttl=Math.max(m.ttl,ttl);m.age=0;
        return;
      }
    }
    if(this.memory.length>=this.maxMemory){
      let wi=0,wv=Infinity;
      for(let i=0;i<this.memory.length;i++){
        const m=this.memory[i],v=m.strength*(m.ttl-m.age);
        if(v<wv){wv=v;wi=i;}
      }
      if(wv>strength*ttl)return;
      this.memory.splice(wi,1);
    }
    this.memory.push({type,x,y,strength,ttl,age:0});
  }

  _recall(type,x,y,maxR){
    let best=null,bs=-Infinity,r2=maxR*maxR;
    for(let i=0;i<this.memory.length;i++){
      const m=this.memory[i];
      if(m.type!==type)continue;
      const d2=(m.x-x)*(m.x-x)+(m.y-y)*(m.y-y);
      if(d2>r2)continue;
      const s=m.strength*140-Math.sqrt(d2);
      if(s>bs){bs=s;best=m;}
    }
    return best;
  }

  _memoryDanger(x,y,r){
    let d=0,r2=r*r;
    for(let i=0;i<this.memory.length;i++){
      const m=this.memory[i];
      if(m.type!=='danger')continue;
      const dd=(m.x-x)*(m.x-x)+(m.y-y)*(m.y-y);
      if(dd<r2)d+=m.strength*(1-Math.sqrt(dd)/r);
    }
    return d;
  }

  _updateMemory(dt){
    for(let i=this.memory.length-1;i>=0;i--){
      const m=this.memory[i];
      m.age+=dt;
      m.strength*=Math.exp(-dt/m.ttl);
      if(m.age>=m.ttl||m.strength<0.05)this.memory.splice(i,1);
    }
  }

  /* =========================================================================
     ORIGINAL INTERFACE (unchanged signatures / behaviour)
     ========================================================================= */

  stageDef(){return this.lineage.stages[Math.min(this.stage-1,this.lineage.stages.length-1)];}
  aggression(){return this.stageDef().aggr*this.lineage.aggrMul;}

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
    const agePenalty=1-Math.min(0.35,this.age*0.0009);
    const injPenalty=this.injured?0.78:1;
    return s*agePenalty*injPenalty;
  }
  _vis(){
    let v=(CFG.VIS_BASE+CFG.VIS_SZ*this.size)*this.lineage.visMul;
    if(this.injured)v*=0.9;
    if(this.bleeding>0.5)v*=0.88;
    return v;
  }
  _metab(){
    let m=CFG.METAB+this.size*CFG.METAB_SZ;
    if(this.lineage.ambush)m*=0.85;
    if(this.energy<this.maxEnergy*0.25)m*=1.12;
    return m;
  }
  defSize(){return this.size*this.lineage.defMul;}

  colorKey(){if(this.isPlayer)return PLAYER_COLOR;return this.stageDef().color;}
  accentKey(){if(this.isPlayer)return PLAYER_DARK;return this.stageDef().color;}
  profileKey(){return this.stageDef().profile;}
  shapeKey(){return this.stageDef().shape;}
  dorsalKey(){return this.stageDef().dorsal;}

  /* =========================================================================
     MAIN UPDATE
     ========================================================================= */
  update(dt,eco){
    if(!this.alive)return;
    this._ecoRef=eco;
    this._envRef=eco?(eco.env||null):null;

    this.age+=dt;
    if(this.spawnTimer>0)this.spawnTimer-=dt;
    if(this.feedTimer>0){this.feedTimer-=dt;if(this.feedTimer<=0&&this.state==='FEED')this.state='WANDER';}
    if(this.evolveAnim>0)this.evolveAnim-=dt;
    if(this.lungeTimer>0)this.lungeTimer-=dt;
    this.blinkTimer-=dt;
    if(this.blinkTimer<=0){this.blinkAnim=0.12;this.blinkTimer=rand(2.5,6);}
    if(this.blinkAnim>0)this.blinkAnim-=dt;
    this.glitchPhase+=dt*13;

    // combat timers
    if(this.biteCd>0)this.biteCd-=dt;
    if(this.stunned>0)this.stunned-=dt;
    if(this._attackAnim>0)this._attackAnim-=dt;

    // bleed damage
    if(this.bleeding>0){
      this.hp-=this.bleeding*dt;
      this.energy-=this.bleeding*0.4*dt;
      this.bleeding*=Math.exp(-dt*0.32);
      if(this.bleeding<0.05)this.bleeding=0;
      if(this.hp<=0){this.die(eco,'bled');return;}
    }

    // injury state
    if(this.hp<this.maxHp*0.5)this.injured=true;
    if(this.hp>this.maxHp*0.85)this.injured=false;
    if(!this.injured&&this.energy>this.maxEnergy*0.5){
      this.hp=Math.min(this.maxHp,this.hp+dt*0.7);
    }

    // stamina (player handled in playerInput)
    if(!this.isPlayer){
      const sm=this.lineage.stamMul;
      if(this.state==='FLEE'||this.behavior==='FLEE')
        this.stamina=Math.max(0,this.stamina-CFG.STAM_DRAIN_FLEE*dt*sm);
      else if(this.state==='CHASE'||this.state==='INTERCEPT'||this.state==='ATTACK'||this.state==='STALK')
        this.stamina=Math.max(0,this.stamina-CFG.STAM_DRAIN_CHASE*dt*sm);
      else this.stamina=Math.min(CFG.STAM_MAX,this.stamina+CFG.STAM_REGEN*dt);
    }

    // metabolism (with aging tax + injury tax)
    let metab=this._metab();
    metab*=1+Math.min(0.6,this.age*0.00055);
    if(this.injured)metab*=1.18;
    this.energy-=metab*dt;
    if(this.energy<=0){this.die(eco,'starved');return;}

    // natural old-age death
    const maxAge=(170+this.size*26)*(0.8+this.psy.patience*0.5);
    if(this.age>maxAge&&Math.random()<dt*0.05){this.die(eco,'aged');return;}

    // memory decay
    if(this.memory.length)this._updateMemory(dt);

    this.visionRange=this._vis();
    this.perceive(eco.fish,eco.env,eco);

    if(this.isPlayer)this.playerInput(eco.input,dt,eco);
    else{this.decide(dt,eco);this.moveAI(dt);}

    // AI auto-attack
    if(!this.isPlayer)this._autoCombat(dt,eco);

    // camouflage state
    const spdNow=Math.hypot(this.vel.x,this.vel.y);
    this.camouflaged=!!(this.lineage.ambush&&this.state!=='ATTACK'&&this.state!=='FLEE'
                       &&spdNow<this._spd()*0.4);

    // lazy territory
    if(this.territory===null&&this.psy.territoriality>0.62){
      this.territory={x:this.homeX,y:this.homeY,r:this.visionRange*1.8};
    }

    this.updateSpine();
    this.swimPhase+=dt*(3+spdNow*0.055);
    this.lurePhase+=dt*3;
  }

  /* =========================================================================
     PERCEPTION  —  FOV + LOS + concealment + spatial hash
     ========================================================================= */
  perceive(all,env,eco){
    this.nearby.length=0;
    this.perceived.clear();
    this._threatList.length=0;
    this._preyList.length=0;
    this._allyList.length=0;
    this.threatCount=0;this.preyCount=0;this.allyCount=0;
    this.bestThreat=null;this.bestThreatD=Infinity;
    this.bestPrey=null;  this.bestPreyD=Infinity;

    const vis=this.visionRange;
    const r2=vis*vis;

    let candidates=all;
    if(eco&&eco.gridFish&&typeof eco.gridFish.queryCircle==='function'){
      this._qbuf.length=0;
      eco.gridFish.queryCircle(this.pos.x,this.pos.y,vis,this._qbuf);
      candidates=this._qbuf;
    }

    const fovHalf=0.62+this.psy.intelligence*0.22;
    const cosH=Math.cos(this.angle),sinH=Math.sin(this.angle);
    const closeR=this.size*2.4;
    const closeR2=closeR*closeR;

    for(let i=0;i<candidates.length;i++){
      const f=candidates[i];
      if(f===this||!f.alive)continue;
      const dx=f.pos.x-this.pos.x,dy=f.pos.y-this.pos.y;
      const d2=dx*dx+dy*dy;
      if(d2>r2)continue;
      const dist=Math.sqrt(d2);

      // FOV
      if(dist>6&&d2>closeR2){
        const dot=(dx*cosH+dy*sinH)/Math.max(0.0001,dist);
        if(dot<Math.cos(fovHalf)&&dist>this.size*2.2)continue;
      }

      // LOS / concealment
      if(env){
        if(env.losBlocked&&env.losBlocked(this.pos.x,this.pos.y,f.pos.x,f.pos.y))continue;
        const cover=env.coverAt?env.coverAt(f.pos.x,f.pos.y):0;
        const camo=(f.camouflaged?0.5:0)+((f.psy?f.psy.intelligence:0.5)*0.05);
        const stealth=Math.min(0.9,cover+camo);
        if(stealth>0.12){
          const detect=(1-stealth)+(1-dist/Math.max(1,vis))*0.55;
          const mvBoost=(f.vel)?Math.min(0.2,Math.hypot(f.vel.x,f.vel.y)*0.012):0;
          if(dist>this.size*2.4&&Math.random()>(detect+mvBoost)*0.95)continue;
        }
      }

      const cls=this.classify(f);
      this.nearby.push(f);
      this.perceived.set(f,cls);

      if(cls==='THREAT'){
        this._threatList.push(f);
        if(dist<this.bestThreatD){this.bestThreatD=dist;this.bestThreat=f;}
      }else if(cls==='PREY'){
        this._preyList.push(f);
        if(dist<this.bestPreyD){this.bestPreyD=dist;this.bestPrey=f;}
      }else if(this._isAlly(f)){
        this._allyList.push(f);
      }
    }

    this.threatCount=this._threatList.length;
    this.preyCount=this._preyList.length;
    this.allyCount=this._allyList.length;

    // target tracking
    if(this.target){
      if(!this.target.alive){this.target=null;this.lastKnown=null;}
      else if(this.perceived.has(this.target)){
        this.lastKnown={x:this.target.pos.x,y:this.target.pos.y};
        this.targetMemory=CFG.MEMORY;
      }else{
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

  _isAlly(f){
    if(f===this||!f.alive)return false;
    if(f.lineageKey!==this.lineageKey)return false;
    const r=f.size/Math.max(0.01,this.size);
    return r>0.62&&r<1.6;
  }

  /* =========================================================================
     DECISION BRAIN
     ========================================================================= */
  decide(dt,eco){
    this._aiTick+=dt;
    if(this._aiTick<this._aiInterval)return;
    this._aiTick=0;
    this._aiInterval=0.16+Math.random()*0.09-this.psy.intelligence*0.05;
    if(this._aiInterval<0.07)this._aiInterval=0.07;

    this.fear=Math.max(0,this.fear-0.14);
    this.anger=Math.max(0,this.anger-0.10);

    const hunger=1-this.energy/this.maxEnergy;
    const health=this.hp/this.maxHp;

    /* --- 1. SURVIVE ------------------------------------------------------- */
    const threat=this.bestThreat;
    if(threat){
      const d=this.bestThreatD;
      const prox=1-d/Math.max(1,this.visionRange);
      const gap=threat.defSize()/Math.max(1,this.defSize());
      const thrAgg=threat.psy?threat.psy.aggression:0.5;
      const dangerScore=prox*(1+Math.min(2.4,gap))*(1+thrAgg*0.6);

      const badlyOutmatched=gap>1.55;
      const lowHealth=health<0.55;
      const threshold=0.9+this.psy.bravery*0.7-this.psy.riskTolerance*0.4;

      if(dangerScore>threshold||badlyOutmatched||(lowHealth&&prox>0.3)){
        this.fear=Math.min(1.5,this.fear+0.55);
        this.state='FLEE';this.behavior='FLEE';
        this.target=threat;
        this.updateFleeDir(threat,eco);
        this._remember('danger',threat.pos.x,threat.pos.y,0.9,24);
        return;
      }
    }

    /* --- 2. CONTINUE EXISTING HUNT --------------------------------------- */
    if(this.target&&this.target.alive&&this.perceived.has(this.target)
       &&this.perceived.get(this.target)==='PREY'){
      const d=this._distTo(this.target);
      const reach=(this.defSize()+this.target.defSize())*1.4;
      if(d<reach){this.state='ATTACK';this.behavior='HUNT';return;}
      if(d<this.visionRange*0.82){
        this.state=this.huntStrategy==='AMBUSH'?'STALK'
                  :this.huntStrategy==='INTERCEPT'?'INTERCEPT':'CHASE';
      }else{this.state='CHASE';}
      this.behavior='HUNT';
      return;
    }

    /* --- 3. OPPORTUNISTIC ATTACK ---------------------------------------- */
    if(this.bestPrey&&!this.injured&&this.psy.aggression>0.55){
      const reach=(this.defSize()+this.bestPrey.defSize())*1.4;
      if(this.bestPreyD<reach&&(hunger>0.15||this.psy.aggression>0.75)){
        this.target=this.bestPrey;this.state='ATTACK';this.behavior='HUNT';return;
      }
    }

    /* --- 4. HUNT IF HUNGRY ---------------------------------------------- */
    const huntThreshold=CFG.HUNGER*(0.55+this.psy.hungerTolerance*0.75);
    if(hunger>huntThreshold&&!this.injured){
      const prey=this._choosePrey(eco);
      if(prey){
        this.target=prey;
        this.lastKnown={x:prey.pos.x,y:prey.pos.y};
        this.targetMemory=CFG.MEMORY;
        const d=this._distTo(prey);
        const reach=(this.defSize()+prey.defSize())*1.4;
        if(d<reach)this.state='ATTACK';
        else if(this.huntStrategy==='AMBUSH'&&d>this.visionRange*0.30)this.state='STALK';
        else if(this.huntStrategy==='INTERCEPT')this.state='INTERCEPT';
        else this.state='CHASE';
        this.behavior='HUNT';
        return;
      }
      if(this.psy.intelligence>0.42){
        const memPrey=this._recall('prey',this.pos.x,this.pos.y,this.visionRange*5);
        if(memPrey){
          this.wanderAngle=Math.atan2(memPrey.y-this.pos.y,memPrey.x-this.pos.x);
          this.state='SEARCH';this.behavior='SEARCH';return;
        }
      }
    }

    /* --- 5. SCHOOLING --------------------------------------------------- */
    if(this.psy.sociality>0.55&&this.allyCount>=2&&this.state!=='FLEE'){
      this.state='SCHOOL';this.behavior='SCHOOL';return;
    }

    /* --- 6. TERRITORIAL PATROL ------------------------------------------ */
    if(this.territory&&this.psy.territoriality>0.62){
      const dHome=Math.hypot(this.pos.x-this.territory.x,this.pos.y-this.territory.y);
      if(dHome>this.territory.r*1.35){this.state='RETURN';this.behavior='PATROL';return;}
      if(Math.random()<0.35){this.state='PATROL';this.behavior='PATROL';return;}
    }

    /* --- 7. FOOD PELLETS ------------------------------------------------ */
    const seekFood=hunger>0.14||this.energy<this.maxEnergy*0.55;
    if(seekFood){
      const food=this._findFood(eco);
      if(food){
        this.bestFood=food;
        this.wanderAngle=Math.atan2(food.pos.y-this.pos.y,food.pos.x-this.pos.x);
        this.state='SEEK_FOOD';this.behavior='SEEK_FOOD';return;
      }
      if(this.psy.intelligence>0.35&&hunger>0.3){
        const memFood=this._recall('food',this.pos.x,this.pos.y,this.visionRange*5);
        if(memFood){
          this.wanderAngle=Math.atan2(memFood.y-this.pos.y,memFood.x-this.pos.x);
          this.state='SEEK_FOOD';this.behavior='SEEK_FOOD';return;
        }
      }
    }

    /* --- 8. SCAVENGE ---------------------------------------------------- */
    if(eco&&eco.corpses&&eco.corpses.length&&hunger>0.32){
      let best=null,bd=Infinity;
      for(let i=0;i<eco.corpses.length;i++){
        const c=eco.corpses[i];
        if(c.eaten)continue;
        const d=Math.hypot(c.pos.x-this.pos.x,c.pos.y-this.pos.y);
        if(d<this.visionRange*1.6&&d<bd){bd=d;best=c;}
      }
      if(best){
        this.wanderAngle=Math.atan2(best.pos.y-this.pos.y,best.pos.x-this.pos.x);
        this.state='SEEK_FOOD';this.behavior='SCAVENGE';return;
      }
    }

    /* --- DEFAULT: WANDER / EXPLORE -------------------------------------- */
    this.state='WANDER';this.behavior='WANDER';this.target=null;

    if(this.psy.curiosity>0.6&&this.nearby.length>0&&Math.random()<0.18){
      const f=this.nearby[(Math.random()*this.nearby.length)|0];
      if(f&&this.perceived.get(f)==='NEUTRAL'){
        this.wanderAngle=Math.atan2(f.pos.y-this.pos.y,f.pos.x-this.pos.x);
        this.behavior='INVESTIGATE';return;
      }
    }
    if(Math.random()<0.02*(1+this.psy.exploration))this.wanderAngle+=rand(-1.0,1.0);
    const danger=this._memoryDanger(this.pos.x,this.pos.y,200);
    if(danger>0.4&&this.psy.intelligence>0.35)this.wanderAngle+=(Math.random()-0.5)*1.6;
  }

  /* =========================================================================
     PREY SELECTION
     ========================================================================= */
  _choosePrey(eco){
    let best=null,bestScore=0;
    const mySize=this.defSize();
    const vis=this.visionRange;
    const hunger=1-this.energy/this.maxEnergy;

    for(let i=0;i<this._preyList.length;i++){
      const f=this._preyList[i];
      const dx=f.pos.x-this.pos.x,dy=f.pos.y-this.pos.y;
      const d=Math.hypot(dx,dy);
      if(d>vis)continue;

      let risk=0;
      for(let j=0;j<this._threatList.length;j++){
        const t=this._threatList[j];
        const dt_=Math.hypot(f.pos.x-t.pos.x,f.pos.y-t.pos.y);
        if(dt_<140)risk+=0.7*(1-dt_/140);
      }
      risk+=this._memoryDanger(f.pos.x,f.pos.y,140)*0.55;
      const riskAversion=this.psy.riskTolerance*(1-hunger*0.4);

      const distScore=1-d/vis;
      const value=Math.min(f.defSize()/mySize*1.5,1.15);
      const fHp=(f.hp!==undefined)?f.hp:(f.maxHp||100);
      const fMaxHp=f.maxHp||100;
      const fStam=(f.stamina!==undefined)?f.stamina:CFG.STAM_MAX;
      const vuln=f.injured?0.7:(1-fHp/fMaxHp)*0.8;
      const stam=1-fStam/CFG.STAM_MAX;
      const allies=f.allyCount||0;
      const isolated=1-Math.min(1,allies*0.22);
      const foodInPrey=Math.min(1,f.size/Math.max(1,this.size));

      let stratBonus=0;
      if(this.huntStrategy==='AMBUSH'&&d<vis*0.5)stratBonus=0.35;
      if(this.huntStrategy==='INTERCEPT'&&f.vel){
        const spd=Math.hypot(f.vel.x,f.vel.y);
        stratBonus=Math.min(0.4,spd*0.014);
      }
      if(this.huntStrategy==='PACK'&&this.allyCount>=2)stratBonus=0.3;
      if(this.huntStrategy==='EXHAUST'&&fStam<CFG.STAM_MAX*0.4)stratBonus=0.4;

      const hungerBoost=hunger>0.6?1.4:hunger>0.35?1.2:1.0;

      const score=(distScore*2.0+value*1.5+vuln+stam*0.7+isolated*0.4+foodInPrey*0.5)
                  *hungerBoost
                  *(1-risk*riskAversion*0.8)
                  +stratBonus;

      if(score>bestScore){bestScore=score;best=f;}
    }
    return bestScore>0.28?best:null;
  }

  _findFood(eco){
    if(!eco||!eco.food||!eco.food.length)return null;
    const vis=this.visionRange,r2=vis*vis;
    let best=null,bs=-Infinity;
    const food=eco.food;
    for(let i=0;i<food.length;i++){
      const fd=food[i];
      const dx=fd.pos.x-this.pos.x,dy=fd.pos.y-this.pos.y;
      const d2=dx*dx+dy*dy;
      if(d2>r2)continue;
      if(this._envRef&&this._envRef.losBlocked
         &&this._envRef.losBlocked(this.pos.x,this.pos.y,fd.pos.x,fd.pos.y))continue;
      const d=Math.sqrt(d2);
      const value=fd.value||1;
      const score=(1-d/vis)*1.6+value*0.3;
      if(score>bs){bs=score;best=fd;}
    }
    return best;
  }

  /* =========================================================================
     FLEEING
     ========================================================================= */
  updateFleeDir(threat,eco){
    let ax=0,ay=0;
    const away=this._norm(this.pos.x-threat.pos.x,this.pos.y-threat.pos.y);
    ax+=away.x*1.6;ay+=away.y*1.6;

    for(let i=0;i<this._threatList.length;i++){
      const f=this._threatList[i];
      if(f===threat)continue;
      const a2=this._norm(this.pos.x-f.pos.x,this.pos.y-f.pos.y);
      ax+=a2.x*0.7;ay+=a2.y*0.7;
    }

    const m=CFG.EDGE;
    if(this.pos.x<m)ax+=1-(this.pos.x/m);
    if(this.pos.x>CFG.W-m)ax-=1-((CFG.W-this.pos.x)/m);
    if(this.pos.y<m)ay+=1-(this.pos.y/m);
    if(this.pos.y>CFG.H-m)ay-=1-((CFG.H-this.pos.y)/m);

    for(let i=0;i<this.memory.length;i++){
      const mm=this.memory[i];
      if(mm.type!=='danger')continue;
      const dd=Math.hypot(this.pos.x-mm.x,this.pos.y-mm.y);
      if(dd<160&&dd>1){
        const dir=this._norm(this.pos.x-mm.x,this.pos.y-mm.y);
        const w=mm.strength*(1-dd/160)*0.9;
        ax+=dir.x*w;ay+=dir.y*w;
      }
    }

    if(eco&&eco.env&&this.psy.intelligence>0.35&&!this.injured){
      const cover=this._findCover(eco.env,threat);
      if(cover){
        const dir=this._norm(cover.x-this.pos.x,cover.y-this.pos.y);
        ax+=dir.x*0.9;ay+=dir.y*0.9;
      }
    }

    let juke=(Math.random()-0.5)*0.35;
    if(this.psy.intelligence>0.65)juke*=1.5;
    if(this.injured)juke+=(Math.random()-0.5)*0.5;

    const n=this._norm(ax,ay);
    const jA=Math.atan2(n.y,n.x)+juke;
    this.fleeDir={x:Math.cos(jA),y:Math.sin(jA)};
  }

  _findCover(env,threat){
    if(!env||!env.props||!env.props.length)return null;
    let best=null,bs=-Infinity;
    const awayA=Math.atan2(this.pos.y-threat.pos.y,this.pos.x-threat.pos.x);
    for(let i=0;i<env.props.length;i++){
      const p=env.props[i];
      if(!p.conceal)continue;
      const d=Math.hypot(this.pos.x-p.x,this.pos.y-p.y);
      if(d>280)continue;
      const a=Math.atan2(p.y-this.pos.y,p.x-this.pos.x);
      const align=Math.cos(a-awayA);
      const score=align*1.6-d/320;
      if(score>bs){bs=score;best=p;}
    }
    return bs>0.35?best:null;
  }

  /* =========================================================================
     MOVEMENT
     ========================================================================= */
  moveAI(dt){
    if(this.stunned>0){
      this.vel.x*=0.85;this.vel.y*=0.85;
      this.pos.x+=(this.vel.x+this.knockX)*dt;
      this.pos.y+=(this.vel.y+this.knockY)*dt;
      this.knockX*=Math.exp(-dt*4);
      this.knockY*=Math.exp(-dt*4);
      this.pos.x=clamp(this.pos.x,4,CFG.W-4);
      this.pos.y=clamp(this.pos.y,4,CFG.H-4);
      return;
    }

    let desX=0,desY=0,spdMult=1;
    const st=this.state;
    const stFrac=this.stamina/CFG.STAM_MAX;

    if(st==='FLEE'||this.behavior==='FLEE'){
      desX=this.fleeDir.x;desY=this.fleeDir.y;
      spdMult=1.0+0.30*stFrac+this.psy.bravery*0.12;
      if(this.bestThreat&&this.bestThreatD<this.size*3.2)spdMult+=0.35;
    }
    else if(st==='CHASE'||st==='INTERCEPT'||st==='ATTACK'||st==='STALK'){
      const aim=this.aimPos();
      if(aim){
        let tx=aim.x,ty=aim.y;
        if(st==='ATTACK'&&this.target&&this.target.alive){
          tx=this.target.pos.x;ty=this.target.pos.y;
        }
        const n=this._norm(tx-this.pos.x,ty-this.pos.y);
        desX=n.x;desY=n.y;
      }else{
        desX=Math.cos(this.wanderAngle);desY=Math.sin(this.wanderAngle);
      }
      if(st==='ATTACK')spdMult=1.55+this.psy.aggression*0.18;
      else if(st==='INTERCEPT')spdMult=1.30;
      else if(st==='CHASE')spdMult=1.15+this.psy.speedPreference*0.15;
      else if(st==='STALK')spdMult=0.55+(1-this.psy.patience)*0.28;
      if(this.lineage.ambush&&st==='STALK')spdMult*=0.65;
    }
    else if(st==='SCHOOL'){
      let ax=0,ay=0,cx=0,cy=0,sxp=0,syp=0,n=0;
      const allies=this._allyList;
      for(let i=0;i<allies.length;i++){
        const f=allies[i];
        const d=Math.hypot(this.pos.x-f.pos.x,this.pos.y-f.pos.y);
        if(d<0.5)continue;
        const sepR=this.size*2.2+f.size*2.2;
        if(d<sepR){
          const sep=(sepR-d)/Math.max(1,sepR);
          sxp+=(this.pos.x-f.pos.x)/d*sep*2.0;
          syp+=(this.pos.y-f.pos.y)/d*sep*2.0;
        }
        cx+=f.pos.x;cy+=f.pos.y;
        if(f.vel){ax+=f.vel.x;ay+=f.vel.y;}
        n++;
      }
      if(n>0){
        cx=cx/n-this.pos.x;cy=cy/n-this.pos.y;
        const cm=Math.hypot(cx,cy)||1;cx/=cm;cy/=cm;
        const am=Math.hypot(ax,ay)||1;ax/=am;ay/=am;
        desX=cx*0.55+ax*0.35+sxp*0.7;
        desY=cy*0.55+ay*0.35+syp*0.7;
        const dm=Math.hypot(desX,desY)||1;
        desX/=dm;desY/=dm;
        spdMult=0.85+stFrac*0.1;
      }else{
        desX=Math.cos(this.wanderAngle);desY=Math.sin(this.wanderAngle);
        spdMult=0.9;
      }
    }
    else if(st==='SEEK_FOOD'||st==='FEED'){
      if(this.bestFood&&this.bestFood.pos){
        const n=this._norm(this.bestFood.pos.x-this.pos.x,this.bestFood.pos.y-this.pos.y);
        desX=n.x;desY=n.y;
      }else{
        desX=Math.cos(this.wanderAngle);desY=Math.sin(this.wanderAngle);
      }
      spdMult=0.85+this.psy.speedPreference*0.15;
    }
    else if(st==='RETURN'){
      if(this.territory){
        const n=this._norm(this.territory.x-this.pos.x,this.territory.y-this.pos.y);
        desX=n.x;desY=n.y;
      }
      spdMult=0.95;
    }
    else if(st==='PATROL'){
      if(this.territory){
        const a=Math.atan2(this.pos.y-this.territory.y,this.pos.x-this.territory.x)+dt*0.5;
        const tx=this.territory.x+Math.cos(a)*this.territory.r*0.85;
        const ty=this.territory.y+Math.sin(a)*this.territory.r*0.85;
        const n=this._norm(tx-this.pos.x,ty-this.pos.y);
        desX=n.x;desY=n.y;
      }
      spdMult=0.72;
    }
    else if(st==='SEARCH'){
      desX=Math.cos(this.wanderAngle);desY=Math.sin(this.wanderAngle);
      spdMult=1.0+this.psy.exploration*0.15;
    }
    else{
      desX=Math.cos(this.wanderAngle);desY=Math.sin(this.wanderAngle);
      if(this.lineage.ambush)spdMult=0.45;
      spdMult*=0.85+this.psy.exploration*0.2;
    }

    // edges
    const m=CFG.EDGE;
    let bx=0,by=0;
    if(this.pos.x<m)bx+=1-this.pos.x/m;
    if(this.pos.x>CFG.W-m)bx-=1-(CFG.W-this.pos.x)/m;
    if(this.pos.y<m)by+=1-this.pos.y/m;
    if(this.pos.y>CFG.H-m)by-=1-(CFG.H-this.pos.y)/m;
    if(bx||by){desX+=bx*1.4;desY+=by*1.4;}

    // obstacle avoidance
    if(this._envRef&&this._envRef.props){
      const props=this._envRef.props;
      for(let i=0;i<props.length;i++){
        const p=props[i];
        if(!p.blocks)continue;
        const dx=this.pos.x-p.x,dy=this.pos.y-p.y;
        const d=Math.hypot(dx,dy);
        const look=p.r+this.size*2+42;
        if(d<look&&d>0.001){
          const w=(1-d/look)*1.7;
          desX+=(dx/d)*w;desY+=(dy/d)*w;
        }
      }
    }

    const desA=Math.atan2(desY,desX);
    const diff=wrapA(desA-this.angle);
    let turnMul=1;
    if(st==='ATTACK')turnMul=1.15;
    if(st==='FLEE')turnMul=1.10;
    if(st==='STALK')turnMul=1.25;
    if(this.lineageKey==='serpent')turnMul*=1.18;
    if(this.lineageKey==='swift')turnMul*=1.06;
    if(this.lineageKey==='armor')turnMul*=0.84;
    const maxTurn=CFG.TURN_AI*dt*turnMul;
    this.angle+=clamp(diff,-maxTurn,maxTurn);

    const spdCap=0.7+0.3*stFrac;
    const spd=this._spd()*spdMult*spdCap;
    this.vel.x=Math.cos(this.angle)*spd;
    this.vel.y=Math.sin(this.angle)*spd;

    this.pos.x+=(this.vel.x+this.knockX)*dt;
    this.pos.y+=(this.vel.y+this.knockY)*dt;
    this.knockX*=Math.exp(-dt*5);
    this.knockY*=Math.exp(-dt*5);

    this.pos.x=clamp(this.pos.x,4,CFG.W-4);
    this.pos.y=clamp(this.pos.y,4,CFG.H-4);

    if(this._envRef&&this._envRef.resolve){
      this._envRef.resolve(this.pos,this.size*0.85);
    }
  }

  aimPos(){
    if(this.target&&this.target.alive&&this.perceived.has(this.target))
      return this.predict(this.target);
    if(this.lastKnown)return this.lastKnown;
    return null;
  }

  predict(t){
    const dx=t.pos.x-this.pos.x,dy=t.pos.y-this.pos.y;
    const d=Math.hypot(dx,dy);
    const tt=Math.min(d/Math.max(1,this._spd()),CFG.PREDICT_CAP);
    return{x:t.pos.x+t.vel.x*tt,y:t.pos.y+t.vel.y*tt};
  }

  /* =========================================================================
     PLAYER INPUT
     ========================================================================= */
  playerInput(input,dt,eco){
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
    }else{
      this.state='WANDER';
      this.stamina=Math.min(CFG.STAM_MAX,this.stamina+CFG.STAM_REGEN*dt);
    }
    if(this.injured)spdMult*=0.78;

    if(input.dash&&input.dash()&&this.stamina>8){
      spdMult*=1.7;
      this.stamina=Math.max(0,this.stamina-32*dt);
    }

    const spd=this._spd()*spdMult;
    this.vel.x=Math.cos(this.angle)*spd;
    this.vel.y=Math.sin(this.angle)*spd;
    this.pos.x+=this.vel.x*dt;this.pos.y+=this.vel.y*dt;
    this.pos.x=clamp(this.pos.x,4,CFG.W-4);
    this.pos.y=clamp(this.pos.y,4,CFG.H-4);

    if(this._envRef&&this._envRef.resolve){
      this._envRef.resolve(this.pos,this.size*0.85);
    }

    this.target=null;
    let bd=Infinity;
    for(const f of this.nearby){
      if(this.perceived.get(f)!=='PREY')continue;
      const dx=f.pos.x-this.pos.x,dy=f.pos.y-this.pos.y;
      const dd=dx*dx+dy*dy;
      if(dd<bd){bd=dd;this.target=f;}
    }

    const wantsBite=(input.bite&&input.bite())||(input.attack&&input.attack());
    if(wantsBite&&this.target)this.bite(this.target,eco||this._ecoRef);
  }

  /* =========================================================================
     COMBAT
     ========================================================================= */
  _autoCombat(dt,eco){
    if(!this.target||!this.target.alive)return;
    if(!this.perceived.has(this.target))return;
    if(this.perceived.get(this.target)!=='PREY')return;

    const dx=this.target.pos.x-this.pos.x,dy=this.target.pos.y-this.pos.y;
    const d=Math.hypot(dx,dy);
    const reach=(this.defSize()+this.target.defSize())*1.25;
    if(d>reach)return;

    const a=Math.atan2(dy,dx);
    if(Math.abs(wrapA(a-this.angle))>Math.PI*0.6)return;

    if(this.canEat(this.target)&&this.target.hp<=this.biteDmg*1.4){
      this.eat(this.target,eco);
      return;
    }
    this.bite(this.target,eco);
  }

  bite(target,eco){
    if(!target||!target.alive)return false;
    if(this.biteCd>0)return false;

    const dx=target.pos.x-this.pos.x,dy=target.pos.y-this.pos.y;
    const d=Math.hypot(dx,dy);
    const reach=(this.defSize()+target.defSize())*1.15;
    if(d>reach)return false;

    const a=Math.atan2(dy,dx);
    if(Math.abs(wrapA(a-this.angle))>Math.PI*0.6)return false;

    this.biteCd=this.biteCdMax;
    this.lungeTimer=0.14;
    this._attackAnim=0.25;

    const defMul=(target.lineage&&target.lineage.defMul)?target.lineage.defMul:1;
    const dmg=this.biteDmg*(1+this.psy.aggression*0.35)*(1-(defMul-1)*0.35);
    if(typeof target.takeDamage==='function'){
      target.takeDamage(Math.max(2,dmg),this,eco);
    }else{
      // fallback for compatibility — treat as instant kill if we can eat it
      if(this.canEat(target))target.die(eco,'eaten');
    }

    const n=this._norm(dx,dy);
    const kb=16+this.size*1.3;
    if(target.knockX!==undefined){target.knockX+=n.x*kb;target.knockY+=n.y*kb;}

    if(eco){
      if(eco.spawnParticles)eco.spawnParticles(target.pos,4,'ai');
      if(eco.spawnShockwave)eco.spawnShockwave(target.pos,this.size*0.8);
      eco.flicker=Math.max(eco.flicker||0,0.05);
    }
    return true;
  }

  takeDamage(amount,attacker,eco){
    if(!this.alive)return;
    this.hp-=amount;
    this.bleeding=Math.min(4.5,this.bleeding+amount*0.16);
    this.stunned=Math.max(this.stunned,0.14);
    this.injured=true;
    this.fear=Math.min(1.6,this.fear+0.5);
    this.lastAttacker=attacker||null;

    if(attacker)this._remember('danger',attacker.pos.x,attacker.pos.y,1.0,28);

    if(eco){
      if(eco.spawnParticles)eco.spawnParticles(this.pos,6,'ai');
      eco.flicker=Math.max(eco.flicker||0,0.06);
      eco.flickerStrength=Math.max(eco.flickerStrength||0,0.4);
    }

    if(this.psy.vengeance>0.68&&this.psy.bravery>0.5&&attacker
       &&this.defSize()>=attacker.defSize()*0.78){
      this.target=attacker;this.anger=1.0;
    }

    if(this.hp<=0)this.die(eco,'killed');
  }

  /* =========================================================================
     DEATH
     ========================================================================= */
  die(eco,reason){
    if(!this.alive)return;
    this.alive=false;this.deathReason=reason;

    if(eco&&eco.corpses&&reason!=='eaten'&&reason!=='aged'){
      eco.corpses.push({
        pos:{x:this.pos.x,y:this.pos.y},
        size:this.size,
        energy:this.size*CFG.EAT_ENERGY*0.55,
        stage:this.stage,
        lineageKey:this.lineageKey,
        age:0,ttl:12+this.size*0.7,
        eaten:false
      });
    }

    if(eco){
      const n=reason==='eaten'?10+Math.floor(this.size*0.5):8;
      if(eco.spawnParticles)eco.spawnParticles(this.pos,n,this.isPlayer?'player':'ai');
      if(eco.spawnShockwave)eco.spawnShockwave(this.pos,this.size*2.2);
    }
  }

  /* =========================================================================
     SPINE + RENDER
     ========================================================================= */
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
    const attackStretch=this._attackAnim>0?1+this._attackAnim*0.6:1;
    const waveScale=this.lineageKey==='serpent'?0.45:0.28;
    for(let i=0;i<n;i++){
      const p=this.spine[i];
      const prev=this.spine[Math.max(0,i-1)];
      const next=this.spine[Math.min(n-1,i+1)];
      let dx=next.x-prev.x,dy=next.y-prev.y;
      const d=Math.hypot(dx,dy)||1;dx/=d;dy/=d;
      const px=-dy,py=dx;
      const t=i/(n-1);
      const waveAmp=this.size*waveScale*t*t*eatStretch*attackStretch;
      const wave=Math.sin(this.swimPhase-t*Math.PI*2.4)*waveAmp;
      out.push({x:p.x+px*wave,y:p.y+py*wave});
    }
    return out;
  }

  /* =========================================================================
     EATING
     ========================================================================= */
  canEat(prey){return this.defSize()>=prey.defSize()*CFG.SIZE_RATIO;}

  eat(prey,eco){
    if(!prey||!prey.alive)return;
    prey.die(eco,'eaten');
    this.energy=Math.min(this.maxEnergy,this.energy+prey.size*CFG.EAT_ENERGY);
    this.grow(prey.size*CFG.EAT_GROWTH*eco.profile.growthMult);
    this.kills++;
    this.feedTimer=0.35;this.state='FEED';this.lungeTimer=0.15;

    this._remember('kill',prey.pos.x,prey.pos.y,0.75,40);
    this.fear=Math.max(0,this.fear-0.35);
    this.hp=Math.min(this.maxHp,this.hp+prey.size*0.6);

    if(this.isPlayer){
      const base=1+(prey.stage-1);
      const coins=Math.max(1,Math.round(base*eco.profile.coinMult));
      this.coinsEarned+=coins;
      eco.pendingCoins+=coins;
      if(eco.spawnCoinPopup)eco.spawnCoinPopup(prey.pos,coins);
    }
    if(eco){
      const pn=Math.min(24,8+Math.floor(prey.size*0.7));
      if(eco.spawnParticles)eco.spawnParticles(prey.pos,pn,prey.isPlayer?'player':'ai');
      if(eco.spawnShockwave)eco.spawnShockwave(prey.pos,prey.size*1.8);
      eco.flicker=Math.max(eco.flicker||0,0.08);
      eco.flickerStrength=0.55;
    }
  }

  eatFood(fd,eco){
    this.energy=Math.min(this.maxEnergy,this.energy+CFG.FOOD_NRJ);
    this.grow(CFG.FOOD_GROW*eco.profile.growthMult);
    if(fd&&fd.pos)this._remember('food',fd.pos.x,fd.pos.y,0.5,60);
    if(eco&&eco.spawnParticles)eco.spawnParticles(fd.pos,2,'ai');
  }

  grow(a){
    this.size+=a;
    this.maxEnergy=100+this.size*10;
    const newMaxHp=60+this.size*14;
    if(newMaxHp>this.maxHp)this.hp+=(newMaxHp-this.maxHp)*0.5;
    this.maxHp=newMaxHp;
    this.biteDmg=6+this.size*1.5;
    this.biteCdMax=0.6+this.size*0.006;
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
      this.hp=this.maxHp;
      this.bleeding=0;
      this.injured=false;
      if(this.isPlayer&&this.onEvolve)this.onEvolve(from,ns);
    }
  }
}