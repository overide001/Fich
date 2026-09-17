"use strict";

/* ==========================================================================
   Fish  —  living-ecosystem AI
   --------------------------------------------------------------------------
   Public interface (constructor + method names) matches the original class.
   Everything downstream (particles, evolution UI, shop, ecosystem) keeps
   working. Only the internals — perception, memory, decision-making, combat —
   have been replaced with a richer simulation.
   ========================================================================== */

class Shoal{
  constructor(lineageKey){
    this.lineageKey=lineageKey;
    this.members=[];
    this.center={x:0,y:0};
    this.vel={x:0,y:0};
    this.heading=0;
    this.radius=0;
    this.wanderAngle=Math.random()*Math.PI*2;
    this.wanderTimer=2+Math.random()*3;
    this.fleeDir=null;
    this.threat=null;
    this.alarm=null;
    this.roles=new Map();
    this._dead=false;
  }
  get size(){return this.members.length;}
  add(f){
    if(!f||this.members.indexOf(f)!==-1)return;
    this.members.push(f);f.shoal=this;this._recalc(true);
  }
  remove(f){
    const i=this.members.indexOf(f);
    if(i===-1)return;
    this.members.splice(i,1);
    if(f.shoal===this)f.shoal=null;
    if(!this.members.length)this._dead=true;
    else this._recalc(true);
  }
  _recalc(hard){
    const n=this.members.length;
    if(!n)return;
    let cx=0,cy=0,vx=0,vy=0,hx=0,hy=0;
    for(const f of this.members){
      cx+=f.pos.x;cy+=f.pos.y;vx+=f.vel.x;vy+=f.vel.y;
      hx+=Math.cos(f.angle);hy+=Math.sin(f.angle);
    }
    this.center.x=cx/n;this.center.y=cy/n;
    this.vel.x=vx/n;this.vel.y=vy/n;
    this.heading=Math.atan2(hy,hx);
    if(hard){
      let r2=0;
      for(const f of this.members){
        const dx=f.pos.x-this.center.x,dy=f.pos.y-this.center.y;
        r2=Math.max(r2,dx*dx+dy*dy);
      }
      this.radius=Math.sqrt(r2);
    }
  }
  updateShared(dt){
    this._recalc(false);
    this.wanderTimer-=dt;
    if(this.wanderTimer<=0){
      this.wanderTimer=2.5+Math.random()*3.5;
      this.wanderAngle+=(Math.random()-0.5);
    }
    if(this.threat&&(!this.threat.alive||this.threat.shoal===this))this.threat=null;
    if(this.alarm){
      this.alarm.age+=dt;
      this.alarm.confidence*=Math.exp(-dt*0.55);
      if(this.alarm.age>4||this.alarm.confidence<0.08)this.alarm=null;
    }
    this.fleeDir=this.threat
      ?Math.atan2(this.center.y-this.threat.pos.y,this.center.x-this.threat.pos.x)
      :null;
  }
  reportThreat(threat){
    if(!threat||!threat.alive)return;
    if(!this.threat){this.threat=threat;return;}
    const dNew=Math.hypot(threat.pos.x-this.center.x,threat.pos.y-this.center.y);
    const dOld=Math.hypot(this.threat.pos.x-this.center.x,this.threat.pos.y-this.center.y);
    if(dNew<dOld*0.75)this.threat=threat;
  }
  reportAlarm(source,threat,danger){
    if(!threat||!threat.pos)return;
    const confidence=clamp(danger,0.15,1);
    if(!this.alarm||confidence>this.alarm.confidence*0.8){
      this.alarm={source,threat, x:threat.pos.x,y:threat.pos.y,
        vx:threat.vel?threat.vel.x:0,vy:threat.vel?threat.vel.y:0,
        danger:confidence,confidence,age:0};
    }
    this.reportThreat(threat);
  }
  roleFor(f){
    if(!f)return 'FOLLOWER';
    const existing=this.roles.get(f);
    if(existing)return existing;
    const leadership=f.psy.intelligence*0.55+f.psy.bravery*0.3+f.psy.curiosity*0.15;
    const role=leadership>0.72?'SCOUT':f.psy.sociality>0.68?'DEFENDER':
      f.psy.aggression>0.65?'ATTACKER':'FOLLOWER';
    this.roles.set(f,role);return role;
  }
  accepts(f){
    if(!f||!f.alive||f.lineageKey!==this.lineageKey||!f._isShoalFish())return false;
    if(!this.members.length)return true;
    let avg=0;
    for(const member of this.members)avg+=member.size;
    const ratio=f.size/Math.max(0.001,avg/this.members.length);
    return ratio>=0.72&&ratio<=1.38;
  }
}

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

    this.turnRate=0;
    this._wakeTimer=Math.random()*CFG.WAKE_INTERVAL;

    /* ---------------------- NEW: individual mind & body --------------------- */
    this._initPersonality();
    this._initMemory();
    this._initBody();
    this._initBehaviorCaches();

    this.shoal=null;
    this.shoalCooldown=0;
    this._shoalMateList=[];

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

    // A fish gets one enduring behavioural disposition.  It is not cosmetic:
    // these values are consumed by the utility scorer, escape planner and movement.
    const roll=Math.random();
    let kind='FORAGER';
    if(this.lineageKey==='swift')kind=roll<0.62?'RUNNER':roll<0.82?'SCOUT':'HUNTER';
    else if(this.lineageKey==='abyss')kind=roll<0.70?'AMBUSHER':roll<0.90?'HUNTER':'LONER';
    else if(this.lineageKey==='serpent')kind=roll<0.56?'AMBUSHER':roll<0.84?'HUNTER':'TERRITORIAL';
    else if(this.lineageKey==='predator')kind=roll<0.62?'HUNTER':roll<0.83?'PACK_HUNTER':'GUARDIAN';
    else if(this.lineageKey==='armor')kind=roll<0.48?'GUARDIAN':roll<0.75?'TERRITORIAL':'HUNTER';
    else if(roll<0.3)kind='RUNNER';
    this.temperament=kind;
    this.intent={hunt:0,escape:0,social:0,territory:0,ambush:0};
    if(kind==='HUNTER'||kind==='PACK_HUNTER'){
      this.intent.hunt=0.38;this.psy.aggression=clamp(this.psy.aggression+0.20,0,1);
      this.psy.bravery=clamp(this.psy.bravery+0.12,0,1);this.psy.riskTolerance=clamp(this.psy.riskTolerance+0.14,0,1);
    }else if(kind==='AMBUSHER'){
      this.intent.hunt=0.24;this.intent.ambush=0.45;this.psy.patience=clamp(this.psy.patience+0.25,0,1);
      this.psy.intelligence=clamp(this.psy.intelligence+0.12,0,1);
    }else if(kind==='RUNNER'){
      this.intent.escape=0.48;this.psy.speedPreference=clamp(this.psy.speedPreference+0.25,0,1);
      this.psy.bravery=clamp(this.psy.bravery-0.18,0,1);this.psy.riskTolerance=clamp(this.psy.riskTolerance-0.18,0,1);
    }else if(kind==='GUARDIAN'){
      this.intent.social=0.30;this.intent.territory=0.26;this.psy.sociality=clamp(this.psy.sociality+0.18,0,1);
      this.psy.bravery=clamp(this.psy.bravery+0.18,0,1);
    }else if(kind==='TERRITORIAL'){
      this.intent.territory=0.42;this.psy.territoriality=clamp(this.psy.territoriality+0.28,0,1);
    }

    this.huntStrategy=this._chooseStrategy();
    this.fear=0;
    this.anger=0;
  }

  _chooseStrategy(){
    if(this.temperament==='AMBUSHER')return this.lineageKey==='serpent'?'AMBUSH':'STALK';
    if(this.temperament==='PACK_HUNTER')return 'PACK';
    if(this.temperament==='RUNNER')return 'INTERCEPT';
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
    this.maxMemory=48;
    this._nextMemoryId=1;
    this.knowledge={entities:new Map(), places:[], preyTypes:new Map(), routes:new Map()};
    this.experience={
      huntsStarted:0,huntsWon:0,huntsLost:0,
      escapes:0,escapeFailures:0,
      attacksReceived:0,foodFound:0,
      strategy:{AMBUSH:0,STALK:0,INTERCEPT:0,CHASE:0,EXHAUST:0,CORNER:0,PACK:0},
      strategyWins:{AMBUSH:0,STALK:0,INTERCEPT:0,CHASE:0,EXHAUST:0,CORNER:0,PACK:0}
    };
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
    this.memory.push({id:this._nextMemoryId++,type,x,y,strength,ttl,age:0,
      confidence:clamp(strength/1.5,0.1,1),outcome:null,event:type,
      emotionalWeight:strength,familiarity:0});
  }

  _rememberEntity(type,entity,event,outcome,strength,ttl,extra={}){
    if(!entity||!entity.pos)return;
    const id=entity._fishId||(entity._fishId='fish-'+Math.random().toString(36).slice(2));
    let best=null;
    for(const memory of this.memory){
      if(memory.type===type&&memory.entityId===id){best=memory;break;}
    }
    if(!best){
      if(this.memory.length>=this.maxMemory)this.memory.shift();
      best={id:this._nextMemoryId++,type,entityId:id,age:0,encounters:0,
        confidence:0.25};
      this.memory.push(best);
    }
    const prior=best.outcome;
    Object.assign(best,extra,{x:entity.pos.x,y:entity.pos.y,event,outcome,
      entityLineage:entity.lineageKey,entitySize:entity.size,
      lastVelocity:entity.vel?{x:entity.vel.x,y:entity.vel.y}:{x:0,y:0},
      strength:Math.max(best.strength||0,strength),ttl:Math.max(best.ttl||0,ttl),
      age:0,encounters:(best.encounters||0)+1,
      confidence:clamp((best.confidence||0.25)+0.12,0,1)});
    const relation=best.relationship || (type==='danger'?'threat':type==='prey'?'prey':'neutral');
    best.relationship=relation;
    best.emotionalWeight=clamp((best.emotionalWeight||0)*0.75+strength+(outcome==='failed'?0.25:0),0,2);
    const identity=this.knowledge.entities.get(id)||{id,encounters:0,trust:0,threat:0,escaped:0,helped:0};
    identity.encounters++; identity.lastSeen={x:entity.pos.x,y:entity.pos.y};
    identity.lastVelocity=best.lastVelocity; identity.lineage=entity.lineageKey;
    identity.strengthEstimate=entity.defSize?entity.defSize():entity.size;
    if(type==='danger'||event==='attack')identity.threat=clamp(identity.threat+strength*0.45,0,2);
    if(outcome==='failed'&&type==='prey')identity.escaped++;
    if(event==='help')identity.helped++;
    if(prior==='success'&&outcome==='success')identity.familiarity=(identity.familiarity||0)+0.2;
    this.knowledge.entities.set(id,identity);
    const typeKnow=this.knowledge.preyTypes.get(entity.lineageKey)||{attempts:0,wins:0,escape:0};
    if(type==='prey'&&event==='hunt-end'){
      typeKnow.attempts++; if(outcome==='success')typeKnow.wins++; else typeKnow.escape++;
      this.knowledge.preyTypes.set(entity.lineageKey,typeKnow);
    }
  }

  _learn(strategy,success){
    if(!strategy||this.experience.strategy[strategy]===undefined)return;
    this.experience.strategy[strategy]++;
    if(success)this.experience.strategyWins[strategy]++;
  }

  _entityKnowledge(entity){
    return entity&&entity._fishId?this.knowledge.entities.get(entity._fishId):null;
  }

  _receiveAlarm(source,threat,danger){
    if(!threat||!threat.pos||source===this)return;
    const d=Math.hypot(source.pos.x-this.pos.x,source.pos.y-this.pos.y);
    const confidence=clamp(danger*(1-d/Math.max(1,this.visionRange*1.35)),0,1);
    if(confidence<0.08)return;
    const old=this._heardAlarm;
    if(!old||confidence>old.confidence){
      this._heardAlarm={threat,x:threat.pos.x,y:threat.pos.y,danger,confidence,age:0};
      this._rememberEntity('danger',threat,'heard-alarm','warning',confidence,18,
        {dangerLevel:danger,relationship:'threat'});
    }
  }

  _rememberPlace(type,x,y,value,ttl=75){
    this._remember(type,x,y,value,ttl);
    this.knowledge.places.push({type,x,y,value,age:0,ttl});
    if(this.knowledge.places.length>18)this.knowledge.places.shift();
  }

  _strategyReliability(strategy){
    const attempts=this.experience.strategy[strategy]||0;
    if(!attempts)return 0.5;
    return clamp((this.experience.strategyWins[strategy]+1)/(attempts+2),0.12,0.92);
  }

  _maintainShoal(eco){
    if(!this._isShoalFish()||this.psy.sociality<=0.2)return false;
    if(this.shoal&&!this.shoal._dead){
      const d=Math.hypot(this.pos.x-this.shoal.center.x,this.pos.y-this.shoal.center.y);
      if(d>this.visionRange*1.9&&this.psy.sociality<0.55)this._leaveShoal('drift');
      else return true;
    }
    if(this.shoal||this.shoalCooldown>0||!this._shoalMateList.length)return false;
    let bestShoal=null,bestD=Infinity;
    for(const mate of this._shoalMateList){
      if(!mate.shoal||mate.shoal._dead||mate.shoal.members.length>=24)continue;
      const d=this._distTo(mate);
      if(d<bestD){bestD=d;bestShoal=mate.shoal;}
    }
    if(bestShoal&&bestShoal.accepts(this)){
      bestShoal.add(this);
      return true;
    }
    if(this._shoalMateList.length>=CFG.SHOAL_MIN_ALLIES){
      const shoal=new Shoal(this.lineageKey);
      shoal.add(this);
      if(eco&&!eco.shoals)eco.shoals=[];
      if(eco)eco.shoals.push(shoal);
      for(const mate of this._shoalMateList){
        if(!mate.shoal&&shoal.accepts(mate))shoal.add(mate);
      }
      return true;
    }
    return false;
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
    for(let i=this.knowledge.places.length-1;i>=0;i--){
      const p=this.knowledge.places[i];p.age+=dt;p.value*=Math.exp(-dt/p.ttl);
      if(p.age>=p.ttl||p.value<0.04)this.knowledge.places.splice(i,1);
    }
    if(this._heardAlarm){
      this._heardAlarm.age+=dt;this._heardAlarm.confidence*=Math.exp(-dt*0.7);
      if(this._heardAlarm.age>4||this._heardAlarm.confidence<0.08)this._heardAlarm=null;
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
  _isApex(){return this.size>=CFG.MAX_SIZE*0.68||this.stage>=4;}
  _spd(){
    let s=Math.max(CFG.SPD_MIN,CFG.SPD+CFG.SPD_SZ*this.size);
    s*=this.lineage.spdMul;
    if(this.isPlayer)s*=CFG.P_SPD;
    const agePenalty=1-Math.min(0.35,this.age*0.0009);
    const injPenalty=this.injured?0.78:1;
    const sizeT=clamp(this.size/CFG.MAX_SIZE,0,1);
    const bulkPenalty=1-CFG.SPD_TAPER*sizeT*sizeT;
    return s*agePenalty*injPenalty*bulkPenalty;
  }
  speedRatio(){return Math.hypot(this.vel.x,this.vel.y)/Math.max(1,this._spd());}
  _vis(){
    let raw=(CFG.VIS_BASE+CFG.VIS_SZ*this.size)*this.lineage.visMul;
    if(this._isApex())raw*=1.38;
    if(this.injured)raw*=0.9;
    if(this.bleeding>0.5)raw*=0.88;
    if(raw>CFG.VIS_SOFT_START){
      const over=raw-CFG.VIS_SOFT_START;
      raw=CFG.VIS_SOFT_START+(CFG.VIS_CAP-CFG.VIS_SOFT_START)
        *(1-Math.exp(-over/Math.max(1,CFG.VIS_CAP-CFG.VIS_SOFT_START)));
    }
    return raw;
  }

  _clampToWorld(){
    const margin=Math.max(4,this.size*CFG.BODY_MARGIN_MUL);
    this.pos.x=clamp(this.pos.x,margin,CFG.W-margin);
    this.pos.y=clamp(this.pos.y,margin,CFG.H-margin);
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

    if(this.shoalCooldown>0)this.shoalCooldown-=dt;
    if(this.shoal&&this.shoal._dead)this.shoal=null;

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

    const prevAngle=this.angle;
    // Network rooms assign an input source per player; solo mode keeps the
    // ecosystem-wide keyboard input exactly as before.
    if(this.isPlayer)this.playerInput(this.netInput||eco.input,dt,eco);
    else{this.decide(dt,eco);this.moveAI(dt);}
    this.turnRate=wrapA(this.angle-prevAngle)/Math.max(dt,0.0001);

    // AI auto-attack
    if(!this.isPlayer)this._autoCombat(dt,eco);

    // camouflage state
    const spdNow=Math.hypot(this.vel.x,this.vel.y);
    this.camouflaged=!!(this.lineage.ambush&&this.state!=='ATTACK'&&this.state!=='FLEE'
                       &&spdNow<this._spd()*0.4);

    // lazy territory
    if(this.territory===null&&(this.psy.territoriality>0.62||this._isApex())){
      this.territory={x:this.homeX,y:this.homeY,r:this.visionRange*1.8};
    }

    this._wakeTimer-=dt;
    if(spdNow>CFG.WAKE_MIN_SPD&&this._wakeTimer<=0&&eco&&eco.spawnWake){
      eco.spawnWake(this);
      const speedFactor=clamp(spdNow/Math.max(1,this._spd()),0.5,2.2);
      this._wakeTimer=CFG.WAKE_INTERVAL/speedFactor;
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
    this._shoalMateList.length=0;
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

    const fovHalf=this._isApex()?Math.PI:0.82+this.psy.intelligence*0.32+
      (this.temperament==='RUNNER'?0.22:0);
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
        if(this._isShoalMate(f))this._shoalMateList.push(f);
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
    // Similar-size members of a lineage are rivals/allies, not imaginary predators.
    // Treating every aggressive neighbour as a threat made apex fish panic in packs.
    if(o.lineageKey===this.lineageKey)return 'NEUTRAL';
    if(o.aggression()>0.7&&o.defSize()>this.defSize()*1.08)return 'THREAT';
    return 'NEUTRAL';
  }

  _isAlly(f){
    if(f===this||!f.alive)return false;
    if(f.lineageKey!==this.lineageKey)return false;
    const r=f.size/Math.max(0.01,this.size);
    return r>0.66&&r<1.52;
  }

  _isShoalFish(){
    return this.size<=CFG.SHOAL_MAX_SIZE;
  }

  _isShoalMate(f){
    if(!this._isShoalFish()||!f||!f.alive||f===this)return false;
    if(f.lineageKey!==this.lineageKey||!f._isShoalFish())return false;
    const r=f.size/Math.max(0.001,this.size);
    return r>=0.72&&r<=1.38;
  }

  /* =========================================================================
     DECISION BRAIN
     ========================================================================= */
  _bestHuntStrategy(prey){
    const d=prey?this._distTo(prey):this.visionRange;
    const hunger=1-this.energy/this.maxEnergy;
    const speed=prey&&prey.vel?Math.hypot(prey.vel.x,prey.vel.y):0;
    const base={
      AMBUSH:(1-this.psy.speedPreference)*0.45+this.psy.patience*0.55,
      STALK:this.psy.patience*0.42+this.psy.intelligence*0.28,
      INTERCEPT:speed/Math.max(1,this._spd())*0.65+this.psy.intelligence*0.35,
      CHASE:this.psy.aggression*0.38+this.psy.speedPreference*0.32,
      EXHAUST:(1-this.psy.patience)*0.25+(prey&&prey.stamina<CFG.STAM_MAX*0.45?0.65:0),
      CORNER:this.psy.territoriality*0.35+(this._envRef&&this._envRef.props?0.2:0),
      PACK:this.psy.sociality*0.38+(this._allyList.length>=2?0.55:0)
    };
    let best=this.huntStrategy,bestScore=-Infinity;
    for(const key in base){
      let score=base[key]+this._strategyReliability(key)*0.65;
      score+=hunger*0.12-d/Math.max(1,this.visionRange)*0.08;
      if(key==='CHASE'&&this.experience.huntsLost>this.experience.huntsWon)score-=0.25;
      if(key==='AMBUSH'&&this.lineage.ambush)score+=0.35;
      if(key==='PACK'&&this._allyList.length<2)score-=0.3;
      if(score>bestScore){bestScore=score;best=key;}
    }
    return best;
  }

  _applyDecision(action,eco){
    const priorAction=this._decisionAction;
    const priorTarget=this.target;
    this._decisionAction=action.key;
    this._decisionCommitment=action.commitment||0.8;
    if(action.key==='FLEE'){
      this.state='FLEE';this.behavior='FLEE';this.target=this.bestThreat;
      if(this.bestThreat)this.updateFleeDir(this.bestThreat,eco);
      if(this.bestThreat&&this.shoal)this.shoal.reportThreat(this.bestThreat);
      return;
    }
    if(action.key==='SCHOOL'){
      this.state='SCHOOL';this.behavior='SCHOOL';return;
    }
    if(action.key==='HUNT'){
      this.target=action.target||this.bestPrey;
      if(!this.target)return;
      const isNewHunt=priorAction!=='HUNT'||priorTarget!==this.target;
      if(isNewHunt)this.huntStrategy=this._bestHuntStrategy(this.target);
      const d=this._distTo(this.target);
      const reach=(this.defSize()+this.target.defSize())*1.4;
      if(d<reach)this.state='ATTACK';
      else if(this.huntStrategy==='AMBUSH'||this.huntStrategy==='STALK')this.state='STALK';
      else if(this.huntStrategy==='INTERCEPT')this.state='INTERCEPT';
      else this.state='CHASE';
      this.behavior='HUNT';
      if(isNewHunt){
        this.experience.huntsStarted++;this._huntStartedAt=this.age;
        this._rememberEntity('prey',this.target,'hunt-start','pending',0.7,30,
          {strategy:this.huntStrategy,relationship:'prey'});
      }
      return;
    }
    if(action.key==='DEFEND'){
      this.target=action.target;this.state='ATTACK';this.behavior='DEFEND';return;
    }
    if(action.key==='REST'){
      this.state='REST';this.behavior='REST';this.target=null;return;
    }
    if(action.key==='FOOD'||action.key==='SCAVENGE'){
      this.state='SEEK_FOOD';this.behavior=action.key;this.bestFood=action.target||this.bestFood;
      if(this.bestFood)this.wanderAngle=Math.atan2(this.bestFood.pos.y-this.pos.y,this.bestFood.pos.x-this.pos.x);
      return;
    }
    if(action.key==='PATROL'||action.key==='RETURN'){
      this.state=action.key;this.behavior='PATROL';return;
    }
    if(action.key==='INVESTIGATE'){
      this.state='SEARCH';this.behavior='INVESTIGATE';
      if(action.target)this.wanderAngle=Math.atan2(action.target.pos.y-this.pos.y,action.target.pos.x-this.pos.x);
      return;
    }
    this.state='WANDER';this.behavior='WANDER';this.target=null;
  }

  decide(dt,eco){
    this._aiTick+=dt;
    if(this._aiTick<this._aiInterval)return;
    this._aiTick=0;
    this._aiInterval=Math.max(0.07,0.16+Math.random()*0.09-this.psy.intelligence*0.05);
    this.fear=Math.max(0,this.fear-0.14);
    this.anger=Math.max(0,this.anger-0.10);
    this._decisionCommitment=Math.max(0,(this._decisionCommitment||0)-this._aiInterval);
    if(this._decisionAction==='HUNT'&&(!this.target||!this.target.alive||
       (!this.perceived.has(this.target)&&this.targetMemory<=0))){
      this.experience.huntsLost++;this._learn(this.huntStrategy,false);
      if(this.target)this._rememberEntity('prey',this.target,'hunt-end','failed',0.8,52,
        {strategy:this.huntStrategy,relationship:'elusive-prey'});
      this.target=null;this._decisionAction=null;
    }

    const hunger=clamp(1-this.energy/this.maxEnergy,0,1);
    const health=clamp(this.hp/this.maxHp,0,1);
    const stamina=clamp(this.stamina/CFG.STAM_MAX,0,1);
    const alarm=(this.shoal&&this.shoal.alarm)||this._heardAlarm;
    const directDanger=this._threatUtility(this.bestThreat,this.bestThreatD);
    const alarmDanger=alarm ? alarm.danger*alarm.confidence*(0.45+this.psy.sociality*0.35) : 0;
    const danger=Math.max(directDanger,alarmDanger,this._memoryDanger(this.pos.x,this.pos.y,this.visionRange)*0.28);
    let prey=this._choosePrey(eco);
    // A committed hunter keeps its quarry unless the replacement is materially better.
    if(this._decisionAction==='HUNT'&&this.target&&this.target.alive&&this.perceived.has(this.target)){
      const oldEval=this._evaluatePrey(this.target,eco);
      const candidateEval=prey?this._evaluatePrey(prey,eco):null;
      const oldValue=oldEval.success*oldEval.reward-oldEval.cost-oldEval.risk;
      const newValue=candidateEval?candidateEval.success*candidateEval.reward-candidateEval.cost-candidateEval.risk:-Infinity;
      if(!candidateEval||prey===this.target||newValue<oldValue+0.22+this.psy.patience*0.12)prey=this.target;
    }
    const preyEval=prey?this._evaluatePrey(prey,eco):null;
    const support=clamp(this._allyList.length/5,0,1);
    const inShoal=this._maintainShoal(eco);
    const current=this._decisionAction;
    const actions=[];
    const add=(key,score,target=null,commitment=0.8)=>{
      const hysteresis=current===key?(this._decisionCommitment||0)*0.32:0;
      actions.push({key,target,commitment,score:score+hysteresis});
    };

    // All drives are evaluated together. Scores are expected value, not a priority list.
    const fleeUrgency=danger*(1.2+(1-health)*0.95+(1-stamina)*0.25+this.intent.escape)
      *(this._isApex()?0.54:1.2-this.psy.bravery*0.42-this.psy.riskTolerance*0.18);
    add('FLEE',fleeUrgency,this.bestThreat||(alarm&&alarm.threat),0.55);
    if(directDanger>0.22&&this.bestThreat&&this._canCounter(this.bestThreat))
      add('DEFEND',directDanger*(this.psy.bravery+this.psy.aggression*0.65+support*0.35),this.bestThreat,0.7);
    add('SCHOOL',support*(this.psy.sociality*1.25+this.psy.intelligence*0.25+this.intent.social)
      +(inShoal?0.52:0)-danger*0.35-(this._isApex()?0.65:0), null,1.8);
    if(preyEval&&!this.injured){
      const hungerDrive=hunger*(1.55-this.psy.hungerTolerance*0.45);
      const huntValue=preyEval.success*preyEval.reward*(0.55+hungerDrive)
        *(0.55+this.psy.aggression*0.8+this.psy.bravery*0.35+support*0.22)
        -preyEval.cost-preyEval.risk*(1-this.psy.riskTolerance*0.65)
        +this.intent.hunt+hunger*0.18+(this._isApex()?0.88:0);
      add('HUNT',huntValue,prey,1.6+this.psy.patience*0.8);
    }
    add('REST',(1-stamina)*0.85+(1-health)*0.45-danger*0.08, null,1.3);
    const foodTarget=this._findFood(eco);
    if(foodTarget)add('FOOD',hunger*(0.9+(1-this.psy.hungerTolerance)*0.6)+(1-stamina)*0.18-danger*0.22,
      foodTarget,1.0);
    const corpse=eco&&eco.corpses&&eco.corpses.find(c=>!c.eaten);
    if(corpse)add('SCAVENGE',hunger*0.65+(this.psy.riskTolerance<0.5?0.25:0)
      -danger*0.22,corpse,1.1);
    if(this.territory){
      const homeD=Math.hypot(this.pos.x-this.territory.x,this.pos.y-this.territory.y);
      add('RETURN',(homeD>this.territory.r?this.psy.territoriality*1.1:0.05)+danger*0.16+this.intent.territory,null,1.2);
      add('PATROL',this.psy.territoriality*0.45+this.intent.territory+(this._isApex()?0.42:0)
        -(preyEval&&this._isApex()?0.72:0)-danger*0.3,null,1.0);
    }
    const unknown=this.nearby.find(f=>this.perceived.get(f)==='NEUTRAL');
    add('INVESTIGATE',this.psy.curiosity*0.75+this.psy.exploration*0.35-danger*0.5,unknown,0.9);
    add('WANDER',0.22+this.psy.exploration*0.45+this.psy.patience*0.12-danger*0.25-(this.intent.hunt*0.22),null,0.7);

    actions.sort((a,b)=>b.score-a.score);
    let choice=actions[0];
    const old=actions.find(a=>a.key===current);
    if(old&&this._decisionCommitment>0&&choice.score<old.score+0.18)choice=old;
    if(choice.key==='FLEE'){
      this.experience.escapes++;
      if(this.bestThreat)this._rememberEntity('danger',this.bestThreat,'alarm','active',1.1,28,
        {dangerLevel:danger});
      if(this.shoal)this.shoal.reportAlarm(this,this.bestThreat,danger);
      for(const ally of this._allyList){
        if(Math.hypot(ally.pos.x-this.pos.x,ally.pos.y-this.pos.y)<this.visionRange*0.72)
          ally._receiveAlarm(this,this.bestThreat,danger);
      }
    }
    this._applyDecision(choice,eco);
  }

  decideLegacy(dt,eco){
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

    if(this._isShoalFish()&&this.psy.sociality>0.30){
      if(this.shoal&&!this.shoal._dead){
        const d=Math.hypot(this.pos.x-this.shoal.center.x,this.pos.y-this.shoal.center.y);
        if(d>this.visionRange*1.9&&this.psy.sociality<0.55){
          this._leaveShoal('drift');
        }else{
          this.state='SCHOOL';this.behavior='SCHOOL';return;
        }
      }

      if(!this.shoal&&this.shoalCooldown<=0&&this._shoalMateList.length){
        let bestShoal=null,bestD=Infinity;
        for(const mate of this._shoalMateList){
          if(!mate.shoal||mate.shoal.members.length>=24)continue;
          const d=this._distTo(mate);
          if(d<bestD){bestD=d;bestShoal=mate.shoal;}
        }
        if(bestShoal&&bestShoal.accepts(this)){
          bestShoal.add(this);
          this.state='SCHOOL';this.behavior='SCHOOL';return;
        }
      }

      if(!this.shoal&&this.shoalCooldown<=0
         &&this._shoalMateList.length>=CFG.SHOAL_MIN_ALLIES){
        const shoal=new Shoal(this.lineageKey);
        shoal.add(this);
        if(eco&&!eco.shoals)eco.shoals=[];
        if(eco)eco.shoals.push(shoal);
        for(const mate of this._shoalMateList){
          if(!mate.shoal&&shoal.accepts(mate))shoal.add(mate);
        }
        this.state='SCHOOL';this.behavior='SCHOOL';return;
      }

      if(this._shoalMateList.length){
        this.state='SCHOOL';this.behavior='SCHOOL';return;
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
        this._leaveShoal('hunt');
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

  _leaveShoal(reason){
    if(!this.shoal)return;
    this.shoal.remove(this);
    this.shoalCooldown=2+Math.random()*2;
  }

  /* =========================================================================
     PREY SELECTION
     ========================================================================= */
  _threatUtility(threat,distance){
    if(!threat)return 0;
    const gap=threat.defSize()/Math.max(1,this.defSize());
    const proximity=clamp(1-(distance||this._distTo(threat))/Math.max(1,this.visionRange),0,1);
    const known=this._entityKnowledge(threat);
    return proximity*(0.5+gap*0.62+(threat.psy?threat.psy.aggression:0.5)*0.25
      +(known?known.threat*0.3:0));
  }

  _canCounter(threat){
    const ratio=this.defSize()/Math.max(1,threat.defSize());
    return ratio>0.72 && this.hp/this.maxHp>0.48 && this.stamina>CFG.STAM_MAX*0.24
      && (this.psy.bravery+this.psy.aggression*0.45+this._allyList.length*0.08)>0.72;
  }

  _evaluatePrey(f,eco){
    const d=this._distTo(f), vis=Math.max(1,this.visionRange);
    const fHp=f.maxHp?clamp(f.hp/f.maxHp,0,1):1;
    const fStam=clamp((f.stamina===undefined?CFG.STAM_MAX:f.stamina)/CFG.STAM_MAX,0,1);
    const theirSpeed=f.vel?Math.hypot(f.vel.x,f.vel.y):0;
    const speedGap=this._spd()/Math.max(1,theirSpeed||f._spd&&f._spd()||1);
    const known=this._entityKnowledge(f);
    const type=this.knowledge.preyTypes.get(f.lineageKey);
    const typeSuccess=type&&type.attempts?type.wins/type.attempts:0.5;
    let nearbyAllies=0;
    for(const n of this.nearby)if(n!==f&&this._isAlly(n) && Math.hypot(n.pos.x-f.pos.x,n.pos.y-f.pos.y)<90)nearbyAllies++;
    const routeRisk=this._escapeRouteScore(f);
    const terrain=this._envRef&&this._envRef.losBlocked?0.08:0;
    const vulnerability=(1-fHp)*0.55+(1-fStam)*0.3+(f.injured?0.28:0);
    const familiarity=known ? -known.escaped*0.08+((known.familiarity||0)*0.05) : 0;
    const success=clamp(0.22+vulnerability+speedGap*0.2+(1-d/vis)*0.15+
      this.psy.intelligence*0.18+typeSuccess*0.18+familiarity-routeRisk*0.3-nearbyAllies*0.07+terrain,0.03,0.97);
    let predatorRisk=0;
    for(const t of this._threatList)predatorRisk=Math.max(predatorRisk,this._threatUtility(t,Math.hypot(t.pos.x-f.pos.x,t.pos.y-f.pos.y))*0.7);
    const reward=clamp(f.size/Math.max(1,this.size),0.18,1.5)*(0.65+vulnerability*0.5);
    const cost=(d/vis)*0.55+Math.max(0,1-speedGap)*0.42+(1-this.stamina/CFG.STAM_MAX)*0.32;
    return {success,reward,cost,risk:predatorRisk+routeRisk*0.22,distance:d};
  }

  _escapeRouteScore(f){
    let score=0;
    const a=f.vel?Math.atan2(f.vel.y,f.vel.x):0;
    const aheadX=f.pos.x+Math.cos(a)*85,aheadY=f.pos.y+Math.sin(a)*85;
    if(aheadX<70||aheadX>CFG.W-70||aheadY<70||aheadY>CFG.H-70)score-=0.18;
    if(this._envRef&&this._envRef.props){
      for(const p of this._envRef.props){
        const d=Math.hypot(aheadX-p.x,aheadY-p.y);
        if(p.blocks&&d<p.r+35)score-=0.2;
        if(p.conceal&&d<p.r+55)score+=0.18;
      }
    }
    return clamp(score+0.35,0,1);
  }

  _choosePrey(eco){
    let best=null,score=-Infinity;
    for(const f of this._preyList){
      const e=this._evaluatePrey(f,eco);
      const value=e.success*e.reward-e.cost-e.risk*(1-this.psy.riskTolerance*0.6);
      if(value>score){score=value;best=f;}
    }
    // A dedicated hunter evaluates marginal prey rather than pretending it is absent;
    // the drive scorer then decides whether the expected pursuit is worth taking.
    const noticeThreshold=(this._isApex()||this.intent.hunt>0.2)?-0.42:0.04;
    return score>noticeThreshold?best:null;
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
    if(!threat||!threat.pos)return;
    const awayA=Math.atan2(this.pos.y-threat.pos.y,this.pos.x-threat.pos.x);
    const cover=this._findCover(eco&&eco.env,threat);
    let best={score:-Infinity,a:awayA};
    // Candidate escape routes: direct, lateral jukes, cover, allies, territory.
    const candidates=[awayA,awayA+0.58,awayA-0.58,awayA+1.15,awayA-1.15];
    if(cover)candidates.push(Math.atan2(cover.y-this.pos.y,cover.x-this.pos.x));
    if(this._allyList.length){
      const ally=this._allyList[0];candidates.push(Math.atan2(ally.pos.y-this.pos.y,ally.pos.x-this.pos.x));
    }
    if(this.territory)candidates.push(Math.atan2(this.territory.y-this.pos.y,this.territory.x-this.pos.x));
    for(const a of candidates){
      const px=this.pos.x+Math.cos(a)*90,py=this.pos.y+Math.sin(a)*90;
      let score=Math.cos(a-awayA)*1.3;
      score+=clamp(Math.min(px-10,CFG.W-10-px,py-10,CFG.H-10-py)/70,-1,1)*0.8;
      for(const t of this._threatList){
        const d=Math.hypot(px-t.pos.x,py-t.pos.y);score+=clamp(d/150,0,1)*0.55;
      }
      if(cover)score+=Math.exp(-Math.hypot(px-cover.x,py-cover.y)/80)*(0.25+this.psy.intelligence*0.65);
      if(this.psy.sociality>0.55&&this._allyList.length)score+=0.2;
      score-=this._memoryDanger(px,py,130)*0.3;
      if(score>best.score)best={score,a};
    }
    const juke=(this.psy.bravery<0.4||this.injured?0.24:0.1)*(Math.random()-0.5);
    this.fleeDir={x:Math.cos(best.a+juke),y:Math.sin(best.a+juke)};
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
      const sh=this.shoal;
      if(sh&&!sh._dead&&sh.fleeDir!==null){
        const awayX=Math.cos(sh.fleeDir),awayY=Math.sin(sh.fleeDir);
        let cx=sh.center.x-this.pos.x,cy=sh.center.y-this.pos.y;
        const cd=Math.hypot(cx,cy)||1;cx/=cd;cy/=cd;
        desX=awayX*1.55+cx*1.05;desY=awayY*1.55+cy*1.05;
        const dm=Math.hypot(desX,desY)||1;desX/=dm;desY/=dm;
        spdMult=1.2+0.30*stFrac+this.psy.bravery*0.1;
      }else{
        desX=this.fleeDir.x;desY=this.fleeDir.y;
        spdMult=1.0+0.30*stFrac+this.psy.bravery*0.12;
      }
      if(this.bestThreat&&this.bestThreatD<this.size*3.2)spdMult+=0.35;
    }
    else if(st==='CHASE'||st==='INTERCEPT'||st==='ATTACK'||st==='STALK'){
      const aim=this.aimPos();
      if(aim){
        let tx=aim.x,ty=aim.y;
        if(st==='ATTACK'&&this.target&&this.target.alive){
          tx=this.target.pos.x;ty=this.target.pos.y;
        }
        const strategy=this.huntStrategy;
        if(this.target&&this.target.alive&&strategy==='AMBUSH'){
          // Wait ahead of the prey's path; a patient ambusher does not tail it.
          const tv=this.target.vel||{x:0,y:0};
          const lead=clamp(this._distTo(this.target)/Math.max(1,this._spd()),0.35,1.5);
          tx=this.target.pos.x+tv.x*lead;ty=this.target.pos.y+tv.y*lead;
          const d=this._distTo(this.target);
          if(d<this.visionRange*0.28&&Math.abs(wrapA(Math.atan2(this.target.pos.y-this.pos.y,this.target.pos.x-this.pos.x)-this.angle))>0.7){
            tx=this.pos.x;ty=this.pos.y; // remain concealed until an approach opens
          }
        }else if(this.target&&this.target.alive&&strategy==='STALK'){
          const tv=this.target.vel||{x:0,y:0};
          const behind=this._norm(-tv.x||this.pos.x-this.target.pos.x,-tv.y||this.pos.y-this.target.pos.y);
          tx=this.target.pos.x+behind.x*(this.defSize()+this.target.defSize())*3.2;
          ty=this.target.pos.y+behind.y*(this.defSize()+this.target.defSize())*3.2;
        }else if(this.target&&this.target.alive&&strategy==='CORNER'){
          const toEdgeX=this.target.pos.x<CFG.W/2?0:CFG.W;
          const toEdgeY=this.target.pos.y<CFG.H/2?0:CFG.H;
          tx=this.target.pos.x+(toEdgeX-this.target.pos.x)*0.42;
          ty=this.target.pos.y+(toEdgeY-this.target.pos.y)*0.42;
        }else if(this.target&&this.target.alive&&strategy==='PACK'&&this.shoal){
          const members=this.shoal.members,rank=Math.max(0,members.indexOf(this));
          const flank=(rank%3-1)*0.8, ta=Math.atan2(this.target.vel.y||0,this.target.vel.x||0)+Math.PI/2;
          tx=this.target.pos.x+Math.cos(ta)*flank*55;ty=this.target.pos.y+Math.sin(ta)*flank*55;
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
      if(this.huntStrategy==='EXHAUST')spdMult=0.92+this.psy.patience*0.16;
      if(this.huntStrategy==='CORNER')spdMult=1.06;
      if(this.huntStrategy==='PACK')spdMult=1.02;
      if(this.lineage.ambush&&st==='STALK')spdMult*=0.65;
    }
    else if(st==='SCHOOL'){
      const sh=this.shoal;
      if(sh&&!sh._dead){
        let cx=sh.center.x-this.pos.x,cy=sh.center.y-this.pos.y;
        const cd=Math.hypot(cx,cy)||1;cx/=cd;cy/=cd;
        const cohesionW=cd>sh.radius*0.55?1.75:0.85;
        const alignX=Math.cos(sh.heading),alignY=Math.sin(sh.heading);
        const driftX=Math.cos(sh.wanderAngle),driftY=Math.sin(sh.wanderAngle);
        let sx=0,sy=0;
        const personalR=this.size*2.6,personalR2=personalR*personalR;
        for(const f of this._shoalMateList){
          const dx=this.pos.x-f.pos.x,dy=this.pos.y-f.pos.y,d2=dx*dx+dy*dy;
          if(d2>0.0001&&d2<personalR2){
            const d=Math.sqrt(d2),w=(personalR-d)/personalR;
            sx+=dx/d*w;sy+=dy/d*w;
          }
        }
        desX=cx*cohesionW+alignX*0.95+driftX*0.35+sx*1.05;
        desY=cy*cohesionW+alignY*0.95+driftY*0.35+sy*1.05;
        const dm=Math.hypot(desX,desY)||1;
        desX/=dm;desY/=dm;
        spdMult=0.85+stFrac*0.1;
        const shoalSpeed=Math.hypot(sh.vel.x,sh.vel.y);
        if(shoalSpeed>20)spdMult+=Math.min(0.2,shoalSpeed*0.0009);
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
    const m=Math.max(CFG.EDGE,this.size*CFG.EDGE_STEER_MUL);
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

    this._clampToWorld();

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
    this._clampToWorld();

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
    const relation=this.perceived.get(this.target);
    if(relation!=='PREY'&&!(this.behavior==='DEFEND'&&this._canCounter(this.target)))return;

    const dx=this.target.pos.x-this.pos.x,dy=this.target.pos.y-this.pos.y;
    const d=Math.hypot(dx,dy);
    const reach=(this.defSize()+this.target.defSize())*1.25;
    if(d>reach)return;

    const a=Math.atan2(dy,dx);
    if(Math.abs(wrapA(a-this.angle))>Math.PI*0.6)return;

    if(relation==='PREY'&&this.canEat(this.target)&&this.target.hp<=this.biteDmg*1.4){
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
      this._rememberEntity('prey',target,'attack',target.alive?'hit':'killed',0.8,32,
        {strategy:this.huntStrategy});
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
    this.experience.attacksReceived++;

    if(attacker){
      this._remember('danger',attacker.pos.x,attacker.pos.y,1.0,28);
      this._rememberEntity('danger',attacker,'attacked','negative',1.25,70,
        {relationship:'attacker',dangerLevel:this._threatUtility(attacker,this._distTo(attacker))});
    }

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

    if(this.behavior==='HUNT'||this._decisionAction==='HUNT'){
      this.experience.huntsLost++;
      this._learn(this.huntStrategy,false);
      if(this.target)this._rememberEntity('prey',this.target,'hunt-end','failed',0.9,36,
        {strategy:this.huntStrategy});
    }

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
    const burstFactor=1+clamp(this.speedRatio()-0.55,-0.35,0.55)*0.4;
    for(let i=0;i<n;i++){
      const p=this.spine[i];
      const prev=this.spine[Math.max(0,i-1)];
      const next=this.spine[Math.min(n-1,i+1)];
      let dx=next.x-prev.x,dy=next.y-prev.y;
      const d=Math.hypot(dx,dy)||1;dx/=d;dy/=d;
      const px=-dy,py=dx;
      const t=i/(n-1);
      const waveAmp=this.size*waveScale*t*t*eatStretch*attackStretch*burstFactor;
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
    if(this._decisionAction==='HUNT'||this.behavior==='HUNT'){
      this.experience.huntsWon++;
      this._learn(this.huntStrategy,true);
      this._rememberEntity('prey',prey,'hunt-end','success',1.2,48,
        {strategy:this.huntStrategy});
      this._decisionAction=null;
    }
    prey.die(eco,'eaten');
    this.energy=Math.min(this.maxEnergy,this.energy+prey.size*CFG.EAT_ENERGY);
    this.grow(prey.size*CFG.EAT_GROWTH*eco.profile.growthMult);
    this.kills++;
    this.feedTimer=0.35;this.state='FEED';this.lungeTimer=0.15;

    this._rememberPlace('kill',prey.pos.x,prey.pos.y,0.75,40);
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
    if(fd&&fd.pos)this._rememberPlace('food',fd.pos.x,fd.pos.y,0.5,60);
    if(eco&&eco.spawnParticles)eco.spawnParticles(fd.pos,2,'ai');
  }

  grow(a){
    if(a>0&&this.size<CFG.MAX_SIZE){
      const t=clamp(this.size/CFG.MAX_SIZE,0,1);
      const taper=Math.max(CFG.GROWTH_TAPER_FLOOR,
        Math.pow(1-t,CFG.GROWTH_TAPER_POW));
      this.size=Math.min(CFG.MAX_SIZE,this.size+a*taper);
    }
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
