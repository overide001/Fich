"use strict";

const STORE_KEY='predation_profile_v1';
const DEFAULT_PROFILE={
  coins:0,
  skins:['default'],
  activeSkin:'default',
  upgrades:{ startStage:0, extraEnergy:0, growthBoost:0, coinMult:0 },
  best:{ time:0, kills:0, size:0, coins:0 },
  totalKills:0,totalRuns:0,totalCoinsEarned:0,
};

class Profile{
  constructor(){ this.data=this.load(); }
  load(){
    try{
      const raw=localStorage.getItem(STORE_KEY);
      if(!raw)return JSON.parse(JSON.stringify(DEFAULT_PROFILE));
      const p=JSON.parse(raw);
      const merged=JSON.parse(JSON.stringify(DEFAULT_PROFILE));
      Object.assign(merged,p);
      Object.assign(merged.upgrades,{...DEFAULT_PROFILE.upgrades,...(p.upgrades||{})});
      Object.assign(merged.best,{...DEFAULT_PROFILE.best,...(p.best||{})});
      if(!Array.isArray(merged.skins)||!merged.skins.length)merged.skins=['default'];
      if(!merged.skins.includes('default'))merged.skins.push('default');
      return merged;
    }catch(e){ return JSON.parse(JSON.stringify(DEFAULT_PROFILE)); }
  }
  save(){ try{ localStorage.setItem(STORE_KEY,JSON.stringify(this.data)); }catch(e){} }
  addCoins(n){ this.data.coins+=n; this.data.totalCoinsEarned+=n; this.save(); }
  spendCoins(n){ if(this.data.coins<n)return false; this.data.coins-=n; this.save(); return true; }
  buySkin(k){ if(this.data.skins.includes(k))return false; this.data.skins.push(k); this.save(); return true; }
  equipSkin(k){ if(!this.data.skins.includes(k))return false; this.data.activeSkin=k; this.save(); return true; }
  buyUpgrade(k,cost){ if(!this.spendCoins(cost))return false; this.data.upgrades[k]=(this.data.upgrades[k]||0)+1; this.save(); return true; }
  recordRun(r){
    this.data.totalRuns++;this.data.totalKills+=r.kills;
    const b=this.data.best;
    if(r.time>b.time)b.time=r.time;
    if(r.kills>b.kills)b.kills=r.kills;
    if(r.size>b.size)b.size=r.size;
    if(r.coins>b.coins)b.coins=r.coins;
    this.save();
  }
  get startStage(){ return this.data.upgrades.startStage||0; }
  get energyMult(){ return 1 + 0.25*(this.data.upgrades.extraEnergy||0); }
  get growthMult(){ return 1 + 0.15*(this.data.upgrades.growthBoost||0); }
  get coinMult(){ return 1 + 0.25*(this.data.upgrades.coinMult||0); }
  get skin(){ return this.data.activeSkin; }
}
