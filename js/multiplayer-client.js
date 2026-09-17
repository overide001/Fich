"use strict";

class MultiplayerClient{
  constructor(game){
    this.game=game;this.socket=null;this.playerId=null;this.roomId=null;this.lineage=null;
    this._connected=false;this._intentionalClose=false;this._joinCancel=null;
    this._sendClock=0;this._inputSeq=0;this._pendingSnapshot=null;
    this._lastSnapshotSeq=-1;this._lastSnapshotTime=0;this._snapshotInterval=0.05;
  }

  join(lineage){
    if(typeof window.io!=="function")return Promise.reject(new Error("Open the game through the multiplayer server."));
    if(this.socket)this.leave();
    this.lineage=lineage;this._intentionalClose=false;this._pendingSnapshot=null;
    this._lastSnapshotSeq=-1;this._lastSnapshotTime=0;this._inputSeq=0;this._sendClock=0;
    return new Promise((resolve,reject)=>{
      let settled=false;
      const timeout=setTimeout(()=>settle(new Error("Could not reach the multiplayer server.")),6000);
      const settle=(error,info)=>{
        if(settled)return;
        settled=true;clearTimeout(timeout);this._joinCancel=null;
        if(error)reject(error);else resolve(info);
      };
      this._joinCancel=()=>settle(new Error("Join cancelled."));
      const socket=this.socket=window.io({
        transports:["websocket","polling"],timeout:5000,reconnection:true,
        reconnectionDelay:400,reconnectionDelayMax:3000,reconnectionAttempts:Infinity,
      });
      const sendJoin=()=>socket.emit("room:join",{lineage:this.lineage});
      socket.on("connect",sendJoin);
      socket.on("room:joined",info=>{
        this._connected=true;this.playerId=info.playerId;this.roomId=info.roomId;settle(null,info);
      });
      socket.on("room:error",message=>{this._connected=false;settle(new Error(message));});
      socket.on("connect_error",()=>settle(new Error("Could not reach the multiplayer server.")));
      socket.on("player:joined",info=>this.game.playerJoined(info));
      socket.on("player:left",info=>this.game.playerLeft(info));
      socket.on("player:eliminated",result=>this.game.onlineEliminated(result));
      socket.on("world:snapshot",snapshot=>this._onSnapshot(snapshot));
      socket.on("disconnect",()=>{
        this._connected=false;
        if(!this._intentionalClose)this.game.showToast("CONNECTION LOST · RECONNECTING");
      });
      socket.on("reconnect",()=>this.game.showToast("RECONNECTED"));
      socket.on("reconnect_failed",()=>{
        this.game.showToast("CONNECTION LOST · RETURNING TO MENU");
        this._intentionalClose=true;this.leave();
      });
    });
  }

  _onSnapshot(snapshot){
    if(!snapshot)return;
    const rawSeq=snapshot.seq!==undefined&&snapshot.seq!==null?snapshot.seq:
      (snapshot.tick!==undefined&&snapshot.tick!==null?snapshot.tick:null);
    if(rawSeq!==null){
      if(this._lastSnapshotSeq>=0&&rawSeq<=this._lastSnapshotSeq)return;
      const now=(typeof performance!=="undefined"?performance.now():Date.now())*0.001;
      if(this._lastSnapshotTime>0){
        const interval=now-this._lastSnapshotTime;
        if(interval>0.005&&interval<0.5)this._snapshotInterval+=(interval-this._snapshotInterval)*0.15;
      }
      this._lastSnapshotTime=now;this._lastSnapshotSeq=rawSeq;
    }
    if(this.game.online)this.game.applyMultiplayerSnapshot(snapshot,this.playerId);
    else this._pendingSnapshot=snapshot;
  }

  start(){
    if(this._pendingSnapshot){
      this.game.applyMultiplayerSnapshot(this._pendingSnapshot,this.playerId);
      this._pendingSnapshot=null;
    }
  }

  update(dt){
    if(!this._connected||!this.socket)return;
    const eco=this.game.eco,player=eco.player;
    if(player&&player.alive){
      eco.playerParticleTimer-=dt;
      if(eco.playerParticleTimer<=0){
        eco.playerParticleTimer=CFG.PLAYER_PARTICLE_INTERVAL;
        eco.spawnParticles(player.pos,CFG.PLAYER_PARTICLES_PER_BURST,"player");
      }
    }
    this._sendClock-=dt;
    if(this._sendClock<=0){
      this._sendClock=0.05;
      const d=this.game.input.getDir();
      this.socket.emit("player:input",{seq:++this._inputSeq,x:d.x,y:d.y,
        dash:this.game.input.dash(),bite:this.game.input.bite()});
    }
    const k=1-Math.exp(-14*dt),snapD2=420*420,snapA=1.4;
    for(const fish of this.game._networkFish.values()){
      const target=fish._networkTarget;
      if(target){
        const dx=target.x-fish.pos.x,dy=target.y-fish.pos.y;
        if(dx*dx+dy*dy>snapD2){fish.pos.x=target.x;fish.pos.y=target.y;}
        else{fish.pos.x+=dx*k;fish.pos.y+=dy*k;}
        const da=wrapA(target.angle-fish.angle);
        fish.angle=Math.abs(da)>snapA?target.angle:fish.angle+da*k;
        fish.vel.x=target.vx;fish.vel.y=target.vy;
      }
      if(typeof fish.updateSpine==="function")fish.updateSpine();
      if(fish.spawnTimer>0)fish.spawnTimer-=dt;
      const speed=Math.hypot(fish.vel.x,fish.vel.y);
      fish.swimPhase+=dt*(3+speed*0.055);fish.lurePhase+=dt*3;fish.glitchPhase+=dt*13;
      fish.blinkTimer-=dt;
      if(fish.blinkTimer<=0){fish.blinkAnim=0.12;fish.blinkTimer=2.5+Math.random()*3.5;}
      if(fish.blinkAnim>0)fish.blinkAnim-=dt;
      if(fish.feedTimer>0)fish.feedTimer-=dt;
      if(fish._attackAnim>0)fish._attackAnim-=dt;
      if(fish.evolveAnim>0)fish.evolveAnim-=dt;
    }
    eco.updateParticles(dt);
    if(eco.flicker>0){
      eco.flicker-=dt;eco.flickerStrength*=0.86;
      if(eco.flicker<=0)eco.flickerStrength=0;
    }
  }

  leave(){
    this._intentionalClose=true;
    if(this._joinCancel){const cancel=this._joinCancel;this._joinCancel=null;try{cancel();}catch(_){} }
    if(this.socket){try{this.socket.removeAllListeners();}catch(_){}try{this.socket.disconnect();}catch(_){} }
    this.socket=null;this._connected=false;this.playerId=null;this.roomId=null;
    this._sendClock=0;this._inputSeq=0;this._pendingSnapshot=null;
    this._lastSnapshotSeq=-1;this._lastSnapshotTime=0;this._snapshotInterval=0.05;
  }

  isConnected(){return this._connected===true&&this.socket!==null&&this.socket.connected===true;}
  estimatedSnapshotInterval(){return this._snapshotInterval;}
  lastSnapshotSeq(){return this._lastSnapshotSeq;}
}