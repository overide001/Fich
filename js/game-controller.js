"use strict";

class Game{
  constructor(){
    window.game=this;
    this.quitController = new QuitController(this);
    this.canvas=document.getElementById('game');
    this.input=new Input();
    this.profile=new Profile();
    this.eco=new Eco(this.profile);
    this.eco.input=this.input;
    this.renderer=new Renderer(this.canvas,this.eco);
    this.last=performance.now();
    this.playerLineage='predator';
    this.running=false;
    this.shopTab='skins';

    this.el={
      hSize:document.getElementById('hSize'),
      hLine:document.getElementById('hLine'),
      hStage:document.getElementById('hStage'),
      hName:document.getElementById('hName'),
      hKills:document.getElementById('hKills'),
      hRunCoins:document.getElementById('hRunCoins'),
      hEnergy:document.getElementById('hEnergy'),
      hStam:document.getElementById('hStam'),
      sCoins:document.getElementById('sCoins'),
      sFish:document.getElementById('sFish'),
      sFood:document.getElementById('sFood'),
      sTime:document.getElementById('sTime'),
      startCoins:document.getElementById('startCoins'),
      shopCoins:document.getElementById('shopCoins'),
      banner:document.getElementById('banner'),
      bText:document.getElementById('bText'),
      bSub:document.getElementById('bSub'),
      toast:document.getElementById('toast'),
      start:document.getElementById('start'),
      shop:document.getElementById('shop'),
      over:document.getElementById('over'),
      shopGrid:document.getElementById('shopGrid'),
      oTime:document.getElementById('oTime'),
      oKills:document.getElementById('oKills'),
      oStage:document.getElementById('oStage'),
      oSize:document.getElementById('oSize'),
      oWho:document.getElementById('oWho'),
      oCoins:document.getElementById('oCoins'),
      oBest:document.getElementById('oBest'),
    };
    this.bannerTimer=0;this.toastTimer=0;

    this.buildShopTabs();

    document.getElementById('startBtn').addEventListener('click',()=>this.startRun());
    document.getElementById('openShop').addEventListener('click',()=>this.openShop());
    document.getElementById('closeShop').addEventListener('click',()=>this.showStart());
    document.getElementById('restartBtn').addEventListener('click',()=>this.startRun());
    document.getElementById('shopFromOver').addEventListener('click',()=>this.openShop());

    window.addEventListener('keydown',e=>{
      const k=e.key.toLowerCase();
      if(this.el.start.classList.contains('on')){
        if(k==='enter'||k===' '){e.preventDefault();this.startRun();}
        else if(k==='s')this.openShop();
      } else if(this.el.shop.classList.contains('on')){
        if(k==='escape'||k==='s')this.showStart();
      } else if(this.el.over.classList.contains('on')){
        if(k==='r'||k==='enter'||k===' '){e.preventDefault();this.startRun();}
        else if(k==='s')this.openShop();
      } else if(this.running){
        /* ============================================
           CHEAT CODE â€” press 8 for +2 instant kills
        ============================================ */
        if(k==='8'){ this.cheatKills(2); }
      }
    });

    this.eco.onPlayerDeath=()=>this.gameOver();
    this.eco.onPlayerEvolve=(a,b)=>this.showEvo(b);

    this.renderer.fit();
    window.addEventListener('resize',()=>this.renderer.fit());

    this.refreshStartCoins();
    requestAnimationFrame(t=>this.loop(t));
  }

  buildShopTabs(){
    document.querySelectorAll('#shop .tabs button').forEach(b=>{
      b.addEventListener('click',()=>{
        document.querySelectorAll('#shop .tabs button').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        this.shopTab=b.dataset.tab;
        this.renderShop();
      });
    });
  }

  refreshStartCoins(){
    this.el.startCoins.textContent=this.profile.data.coins;
    this.el.sCoins.textContent=this.profile.data.coins;
    this.el.shopCoins.textContent=this.profile.data.coins;
  }

  showScreen(name){
    this.el.start.classList.remove('on');
    this.el.shop.classList.remove('on');
    this.el.over.classList.remove('on');
    if(name==='start')this.el.start.classList.add('on');
    if(name==='shop')this.el.shop.classList.add('on');
    if(name==='over')this.el.over.classList.add('on');
  }

  quitToMenu(){
    const earned=this.eco.pendingCoins||0;
    if(earned>0){
      this.profile.addCoins(earned);
      this.showToast(`COINS SAVED · +${earned}`);
    }
    this.eco.pendingCoins=0;
    this.running=false;
    this.showScreen('start');
    this.el.banner.style.opacity='0';
    this.bannerTimer=0;
    this.refreshStartCoins();
  }

  showStart(){
    this.running=false;
    this.showScreen('start');
    this.el.banner.style.opacity='0';
    this.bannerTimer=0;
    this.refreshStartCoins();
  }

  openShop(){
    this.running=false;
    this.showScreen('shop');
    this.refreshStartCoins();
    this.renderShop();
  }

  /* ============================================================
     RANDOM LINEAGE EVERY RUN
  ============================================================ */
  startRun(){
    this.playerLineage=LINEAGE_KEYS[rInt(0,LINEAGE_KEYS.length-1)];
    this.showScreen(null);
    this.eco.reset(this.playerLineage);
    this.eco.onPlayerDeath=()=>this.gameOver();
    this.eco.onPlayerEvolve=(a,b)=>this.showEvo(b);
    this.running=true;
    /* Brief hint to the player which lineage they got */
    this.showToast(`LINEAGE · ${LINEAGES[this.playerLineage].name}`);
  }

  showEvo(stage){
    const name=STAGE_NAMES[Math.min(stage,4)-1];
    const lin=LINEAGES[this.playerLineage].name;
    this.el.bText.textContent='EVOLVED';
    this.el.bSub.textContent=`${lin} · STAGE ${stage} · ${name}`;
    this.el.banner.style.opacity='1';
    this.bannerTimer=1.5;
    this.eco.flicker=Math.max(this.eco.flicker,0.15);
    this.eco.flickerStrength=0.7;
  }

  showToast(msg){
    this.el.toast.textContent=msg;
    this.el.toast.style.opacity='1';
    this.toastTimer=2.2;
  }

  /* ============================================================
    CHEAT — instantly award N kills
     Increments kill counter, adds coins, applies small growth,
     spawns coin popups, flashes the screen.
  ============================================================ */
  cheatKills(n){
    const p=this.eco.player;
    if(!p||!p.alive)return;
    for(let i=0;i<n;i++){
      p.kills++;
      /* Treat as eating a fry (1 coin base) */
      const coins=Math.max(1,Math.round(1*this.profile.coinMult));
      p.coinsEarned+=coins;
      this.eco.pendingCoins+=coins;
      this.eco.spawnCoinPopup(p.pos,coins);
      /* Small growth like eating a fry */
      p.grow(1.0*this.profile.growthMult);
    }
    this.eco.flicker=Math.max(this.eco.flicker,0.12);
    this.eco.flickerStrength=0.6;
    this.eco.spawnParticles(p.pos,12,'player');
    this.showToast(`CHEAT · +${n} KILLS`);
  }

  gameOver(){
    const p=this.eco.player;
    const earned=this.eco.pendingCoins;
    this.profile.addCoins(earned);
    this.profile.recordRun({
      time:Math.floor(this.eco.time),
      kills:p.kills,
      size:+p.size.toFixed(1),
      coins:earned,
    });
    this.el.oTime.textContent=Math.floor(this.eco.time);
    this.el.oKills.textContent=p.kills;
    this.el.oStage.textContent=p.stage;
    this.el.oSize.textContent=p.size.toFixed(1);
    this.el.oWho.textContent=p.deathReason==='starved'?'You starved.':'You were eaten.';
    this.el.oCoins.textContent=earned;
    const b=this.profile.data.best;
    this.el.oBest.innerHTML=
      `BEST · TIME ${b.time}s · KILLS ${b.kills} · SIZE ${b.size.toFixed(1)} · COINS ${b.coins}<br>`+
      `TOTAL · RUNS ${this.profile.data.totalRuns} · KILLS ${this.profile.data.totalKills}`;
    this.showScreen('over');
    this.running=false;
    this.refreshStartCoins();
  }

  renderShop(){
    this.el.shopCoins.textContent=this.profile.data.coins;
    const grid=this.el.shopGrid;
    grid.innerHTML='';
    if(this.shopTab==='skins')this.renderSkins(grid);
    else this.renderUpgrades(grid);
  }

  renderSkins(grid){
    const owned=this.profile.data.skins;
    const active=this.profile.data.activeSkin;
    const coins=this.profile.data.coins;
    for(const key in SKINS){
      const s=SKINS[key];
      const isOwned=owned.includes(key);
      const isActive=active===key;
      const affordable=coins>=s.cost;
      const card=document.createElement('div');
      card.className='item'+(isActive?' equipped':'')+(isOwned?' owned':(affordable?'':' locked'));
      card.innerHTML=`
        <div class="iname">${s.name}</div>
        <div class="idesc">${s.desc}</div>
        <div class="iprice ${isActive?'equipped':(isOwned?'owned':'')}">
          ${isActive?'EQUIPPED':(isOwned?'OWNED':'◆ '+s.cost)}
        </div>
        <button>${isActive?'EQUIPPED':(isOwned?'EQUIP':'BUY')}</button>
      `;
      const btn=card.querySelector('button');
      if(isActive){ btn.disabled=true; btn.style.opacity='0.5'; btn.style.cursor='default'; }
      else if(isOwned){
        btn.addEventListener('click',()=>{
          this.profile.equipSkin(key);
          this.showToast('EQUIPPED · '+s.name);
          this.renderShop();
        });
      } else {
        btn.addEventListener('click',()=>{
          if(this.profile.data.coins<s.cost){this.showToast('NOT ENOUGH COINS');return;}
          if(this.profile.spendCoins(s.cost)){
            this.profile.buySkin(key);
            this.profile.equipSkin(key);
            this.showToast('UNLOCKED · '+s.name);
            this.renderShop();
            this.refreshStartCoins();
          }
        });
      }
      grid.appendChild(card);
    }
  }

  renderUpgrades(grid){
    const upg=this.profile.data.upgrades;
    const coins=this.profile.data.coins;
    for(const key in UPGRADES){
      const u=UPGRADES[key];
      const lvl=upg[key]||0;
      const maxed=lvl>=u.max;
      const cost=maxed?0:u.cost[lvl];
      const affordable=!maxed&&coins>=cost;
      const card=document.createElement('div');
      card.className='item'+(maxed?' owned':(affordable?'':' locked'));
      let dots='';
      for(let i=0;i<u.max;i++)dots+=i<lvl?'●':'○';
      card.innerHTML=`
        <div class="iname">${u.name}</div>
        <div class="idesc">${u.desc}</div>
        <div class="lvlDots">${dots} ${lvl}/${u.max}</div>
        <div class="iprice ${maxed?'owned':''}">
          ${maxed?'MAXED':'◆ '+cost}
        </div>
        <button>${maxed?'MAXED':'UPGRADE'}</button>
      `;
      const btn=card.querySelector('button');
      if(maxed){ btn.disabled=true; btn.style.opacity='0.5'; btn.style.cursor='default'; }
      else {
        btn.addEventListener('click',()=>{
          if(this.profile.data.coins<cost){this.showToast('NOT ENOUGH COINS');return;}
          if(this.profile.buyUpgrade(key,cost)){
            this.showToast('UPGRADED · '+u.name);
            this.renderShop();
            this.refreshStartCoins();
          }
        });
      }
      grid.appendChild(card);
    }
  }

  loop(t){
    const dt=Math.min((t-this.last)/1000,0.05);
    this.last=t;
    if(this.running){
      this.eco.update(dt);
      this.renderer.render();
      this.updateHUD(dt);
    }
    if(this.toastTimer>0){
      this.toastTimer-=dt;
      if(this.toastTimer<=0)this.el.toast.style.opacity='0';
    }
    requestAnimationFrame(tt=>this.loop(tt));
  }

  updateHUD(dt){
    const p=this.eco.player;
    if(p){
      this.el.hSize.textContent=p.size.toFixed(1);
      this.el.hLine.textContent=p.lineage.name;
      this.el.hStage.textContent=p.stage;
      this.el.hName.textContent=STAGE_NAMES[Math.min(p.stage,4)-1];
      this.el.hKills.textContent=p.kills;
      this.el.hRunCoins.textContent=p.coinsEarned;
      this.el.hEnergy.style.width=clamp((p.energy/p.maxEnergy)*100,0,100)+'%';
      this.el.hStam.style.width=clamp((p.stamina/CFG.STAM_MAX)*100,0,100)+'%';
    }
    const s=this.eco.stats();
    this.el.sFish.textContent=s.fish;
    this.el.sFood.textContent=s.food;
    this.el.sTime.textContent=s.time;
    this.el.sCoins.textContent=this.profile.data.coins+this.eco.pendingCoins;
    if(this.bannerTimer>0){
      this.bannerTimer-=dt;
      if(this.bannerTimer<=0)this.el.banner.style.opacity='0';
    }
  }
}

window.addEventListener('load',()=>new Game());

