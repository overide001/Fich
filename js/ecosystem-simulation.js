"use strict";

class Eco{
  constructor(profile){
    this.profile=profile;
    this.fish=[];this.food=[];this.particles=[];this.shockwaves=[];this.coinPops=[];
    this.shoals=[];
    this.input=null;this.player=null;
    this.flicker=0;this.flickerStrength=0;
    this.spawnTimer=0;this.foodAccum=0;this.time=0;
    this.playerParticleTimer=0;
    this.gameOver=false;this.pendingCoins=0;
    this._openingDensity=true;
    this.onPlayerDeath=null;this.onPlayerEvolve=null;
  }
  reset(playerLineage){
    this.fish.length=0;this.food.length=0;this.shoals.length=0;
    this.particles.length=0;this.shockwaves.length=0;this.coinPops.length=0;
    this.time=0;this.gameOver=false;
    this._openingDensity=true;
    this.flicker=0;this.flickerStrength=0;
    this.spawnTimer=0;this.foodAccum=0;this.pendingCoins=0;

    const lin=LINEAGES[playerLineage];
    const stageIdx=Math.min(this.profile.startStage,lin.stages.length-1);
    const startSize=lin.stages[stageIdx].size;

    const p=new Fish(CFG.W/2,CFG.H/2,startSize,playerLineage,true,this.profile.skin);
    p.maxEnergy=(100+p.size*10)*this.profile.energyMult;
    p.energy=CFG.P_NRJ*this.profile.energyMult;
    p.onEvolve=(a,b)=>{ if(this.onPlayerEvolve)this.onPlayerEvolve(a,b); };
    p.checkEvolve();
    this.player=p;this.fish.push(p);

    // Begin with an active food field around the player, not a sparse field
    // scattered across the whole world.
    for(let i=this.food.length;i<CFG.FOOD_OPENING_TGT;i++)this.spawnFood(true);

    for(const linKey of LINEAGE_KEYS){
      if(linKey===playerLineage){
        for(let i=0;i<6;i++)this.spawnFish(linKey,rand(4,9));
        for(let i=0;i<3;i++)this.spawnFish(linKey,rand(13,20));
      } else {
        for(let i=0;i<6;i++)this.spawnFish(linKey,rand(4,9));
        for(let i=0;i<3;i++)this.spawnFish(linKey,rand(13,20));
        if(Math.random()<0.6)this.spawnFish(linKey,rand(28,38));
      }
    }
    const bigLin=LINEAGE_KEYS.filter(l=>l!==playerLineage);
    this.spawnFish(bigLin[rInt(0,bigLin.length-1)],rand(58,80));
    this._openingDensity=false;
  }
  spawnFood(nearPlayer=!!this.player){
    const target=nearPlayer?CFG.FOOD_OPENING_TGT:CFG.FOOD_TGT;
    if(this.food.length>=target)return;
    let x,y;
    if(nearPlayer&&this.player){
      const a=Math.random()*Math.PI*2;
      const d=rand(CFG.FOOD_OPENING_MIN_DISTANCE,CFG.FOOD_OPENING_RADIUS);
      x=clamp(this.player.pos.x+Math.cos(a)*d,30,CFG.W-30);
      y=clamp(this.player.pos.y+Math.sin(a)*d,30,CFG.H-30);
    }else{
      x=rand(30,CFG.W-30);
      y=rand(30,CFG.H-30);
    }
    this.food.push({
      pos:{x,y},
      r:rand(0.9,1.8),
      phase:Math.random()*Math.PI*2,
      drift:{x:rand(-4,4),y:rand(-4,4)},
    });
  }
  spawnFish(lineageKey,size,nearPlayer=this._openingDensity){
    if(this.fish.length>=CFG.MAX_FISH)return;
    const m=60;let x,y,tries=0;
    if(nearPlayer&&this.player){
      do{
        const a=Math.random()*Math.PI*2;
        const d=rand(CFG.START_FISH_MIN_DISTANCE,CFG.START_FISH_RADIUS);
        x=clamp(this.player.pos.x+Math.cos(a)*d,m,CFG.W-m);
        y=clamp(this.player.pos.y+Math.sin(a)*d,m,CFG.H-m);
        tries++;
      }while(v.d({x,y},this.player.pos)<CFG.START_FISH_MIN_DISTANCE&&tries<14);
    }else{
    do{
      const side=rInt(0,3);
      if(side===0){x=rand(m,CFG.W-m);y=m;}
      else if(side===1){x=CFG.W-m;y=rand(m,CFG.H-m);}
      else if(side===2){x=rand(m,CFG.W-m);y=CFG.H-m;}
      else{x=m;y=rand(m,CFG.H-m);}
      tries++;
    }while(this.player&&v.d({x,y},this.player.pos)<300&&tries<14);
    }
    const f=new Fish(x,y,size,lineageKey,false);
    this.fish.push(f);
    this.spawnParticles({x,y},5,'ai');
  }
  spawnShoal(lineageKey,count=CFG.CHEAT_SHOAL_COUNT){
    if(!this.player||!this.player.alive)return 0;
    const m=60;
    let spawned=0;
    for(let i=0;i<count&&this.fish.length<CFG.MAX_FISH;i++){
      const a=Math.random()*Math.PI*2;
      const d=rand(CFG.CHEAT_SHOAL_MIN_DISTANCE,CFG.CHEAT_SHOAL_RADIUS);
      const x=clamp(this.player.pos.x+Math.cos(a)*d,m,CFG.W-m);
      const y=clamp(this.player.pos.y+Math.sin(a)*d,m,CFG.H-m);
      const f=new Fish(x,y,rand(4,9),lineageKey,false);
      f.angle=a+Math.PI;
      f.wanderAngle=f.angle;
      this.fish.push(f);
      this.spawnParticles({x,y},3,'ai');
      spawned++;
    }
    return spawned;
  }
  spawnParticles(pos,n,kind){
    const isPlayer=kind==='player';
    for(let i=0;i<n;i++){
      const a=Math.random()*Math.PI*2;
      const sp=isPlayer?rand(12,75):rand(40,160);
      this.particles.push({
        pos:{x:pos.x,y:pos.y},
        vel:{x:Math.cos(a)*sp,y:Math.sin(a)*sp},
        life:isPlayer?rand(0.65,1.25):rand(0.35,0.8),
        maxLife:isPlayer?1.25:0.8,
        player:isPlayer,
      });
    }
  }
  spawnShockwave(pos,r){
    this.shockwaves.push({pos:{x:pos.x,y:pos.y},r,maxR:r*2.4,life:0.5,maxLife:0.5});
  }
  spawnCoinPopup(pos,amount){
    this.coinPops.push({
      pos:{x:pos.x,y:pos.y},
      vy:-38,life:1.1,maxLife:1.1,
      text:'+'+amount,
    });
  }
  update(dt){
    if(this.gameOver){
      this.updateParticles(dt);
      if(this.flicker>0){this.flicker-=dt;this.flickerStrength*=0.85;}
      return;
    }
    this.time+=dt;

    if(this.player&&this.player.alive){
      this.playerParticleTimer-=dt;
      if(this.playerParticleTimer<=0){
        this.playerParticleTimer=CFG.PLAYER_PARTICLE_INTERVAL;
        this.spawnParticles(this.player.pos,CFG.PLAYER_PARTICLES_PER_BURST,'player');
      }
    }

    for(const shoal of this.shoals)shoal.updateShared(dt);
    for(const f of this.fish)f.update(dt,this);
    this.handlePredation();
    this.handleFood();

    if(this.fish.some(f=>!f.alive))this.fish=this.fish.filter(f=>f.alive);
    this.shoals=this.shoals.filter(shoal=>{
      shoal.members=shoal.members.filter(f=>f.alive&&f.shoal===shoal);
      shoal._dead=shoal.members.length===0;
      return !shoal._dead;
    });
    for(const shoal of this.shoals)shoal._recalc(true);

    this.updateParticles(dt);

    this.foodAccum+=dt*CFG.FOOD_RATE;
    while(this.foodAccum>=1){this.foodAccum-=1;this.spawnFood(true);}
    for(const fd of this.food){
      fd.pos.x+=fd.drift.x*dt;fd.pos.y+=fd.drift.y*dt;
      if(fd.pos.x<10||fd.pos.x>CFG.W-10)fd.drift.x*=-1;
      if(fd.pos.y<10||fd.pos.y>CFG.H-10)fd.drift.y*=-1;
    }
    this.spawnTimer-=dt;
    if(this.spawnTimer<=0){this.spawnTimer=CFG.SPAWN_T;this.balance();}
    if(this.flicker>0){this.flicker-=dt;this.flickerStrength*=0.86;if(this.flicker<=0)this.flickerStrength=0;}

    if(this.player&&!this.player.alive&&!this.gameOver){
      this.gameOver=true;
      if(this.onPlayerDeath)this.onPlayerDeath();
    }
  }
  updateParticles(dt){
    for(let i=this.particles.length-1;i>=0;i--){
      const p=this.particles[i];
      p.life-=dt;
      if(p.life<=0){this.particles.splice(i,1);continue;}
      p.pos.x+=p.vel.x*dt;p.pos.y+=p.vel.y*dt;
      p.vel.x*=0.93;p.vel.y*=0.93;
    }
    for(let i=this.shockwaves.length-1;i>=0;i--){
      const s=this.shockwaves[i];
      s.life-=dt;
      if(s.life<=0){this.shockwaves.splice(i,1);continue;}
      s.r=lerp(s.r,s.maxR,0.14);
    }
    for(let i=this.coinPops.length-1;i>=0;i--){
      const c=this.coinPops[i];
      c.life-=dt;
      if(c.life<=0){this.coinPops.splice(i,1);continue;}
      c.pos.y+=c.vy*dt;
      c.vy*=0.94;
    }
  }
  handlePredation(){
    const list=this.fish;
    for(let i=0;i<list.length;i++){
      const a=list[i];if(!a.alive)continue;
      const aHead=a.spine[0];
      for(let j=i+1;j<list.length;j++){
        const b=list[j];if(!b.alive)continue;
        let aToB=Infinity;
        for(let k=0;k<b.spine.length;k++){
          const d2=v.d2(aHead,b.spine[k]);
          if(d2<aToB)aToB=d2;
        }
        const bHead=b.spine[0];
        let bToA=Infinity;
        for(let k=0;k<a.spine.length;k++){
          const d2=v.d2(bHead,a.spine[k]);
          if(d2<bToA)bToA=d2;
        }
        const r=CFG.BITE_RADIUS(a.size,b.size);
        const r2=r*r;
        const aHits=aToB<r2,bHits=bToA<r2;
        if(!aHits&&!bHits)continue;
        if(aHits&&a.canEat(b)){a.eat(b,this);continue;}
        if(bHits&&b.canEat(a)){b.eat(a,this);break;}
      }
    }
  }
  handleFood(){
    for(const f of this.fish){
      if(!f.alive)continue;
      const mouth=f.spine[0];
      const r=f.size*0.9+5;const r2=r*r;
      for(let i=this.food.length-1;i>=0;i--){
        const fd=this.food[i];
        if(v.d2(mouth,fd.pos)<r2){f.eatFood(fd,this);this.food.splice(i,1);}
      }
    }
  }
  balance(){
    let prey=0,mid=0,pred=0,apex=0;
    for(const f of this.fish){
      if(f.isPlayer)continue;
      if(f.size<CFG.EV_2)prey++;
      else if(f.size<CFG.EV_3)mid++;
      else if(f.size<CFG.EV_4)pred++;
      else apex++;
    }
    const pc=prey+mid;
    // Keep the player's moving neighbourhood alive, rather than repopulating
    // only distant map edges after the opening.
    let nearby=0;
    if(this.player&&this.player.alive){
      for(const f of this.fish){
        if(f!==this.player&&f.alive&&v.d(f.pos,this.player.pos)<CFG.START_FISH_RADIUS)nearby++;
      }
    }
    if(nearby<22){
      const add=Math.min(5,22-nearby);
      for(let i=0;i<add;i++){
        const small=Math.random()<0.78;
        this.spawnFish(LINEAGE_KEYS[rInt(0,4)],small?rand(4,10):rand(12,20),true);
      }
    }
    if(pc<30)for(let i=0;i<rInt(3,6);i++)this.spawnFish(LINEAGE_KEYS[rInt(0,4)],rand(4,9),true);
    if(mid<6&&Math.random()<0.7)this.spawnFish(LINEAGE_KEYS[rInt(0,4)],rand(13,20));
    if(pred<3&&Math.random()<0.35)this.spawnFish(LINEAGE_KEYS[rInt(0,4)],rand(28,38));
    if(apex<1&&Math.random()<0.18)this.spawnFish(LINEAGE_KEYS[rInt(0,4)],rand(58,80));
    if(pc>0&&(pred+apex)/pc>0.55){
      let big=null;
      for(const f of this.fish){
        if(f.isPlayer||f.size<CFG.EV_3)continue;
        if(!big||f.size>big.size)big=f;
      }
      if(big&&Math.random()<0.4)big.energy-=50;
    }
  }
  stats(){let c=0;for(const f of this.fish)if(f.alive)c++;return{fish:c,food:this.food.length,time:Math.floor(this.time)};}
}


