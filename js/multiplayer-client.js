"use strict";

// Thin client: it sends intent, never position, score, size, or damage.
// Those values always arrive from the authoritative multiplayer server.
class MultiplayerClient{
  constructor(game){
    this.game=game;this.socket=null;this.playerId=null;this.roomId=null;
    this._sendClock=0;this._connected=false;
  }

  join(lineage){
    if(typeof window.io!=="function")return Promise.reject(new Error("Open the game through the multiplayer server."));
    if(this.socket)this.leave();
    return new Promise((resolve,reject)=>{
      const socket=this.socket=window.io({transports:["websocket","polling"],timeout:5000});
      const timeout=setTimeout(()=>reject(new Error("Could not reach the multiplayer server.")),6000);
      socket.once("connect",()=>socket.emit("room:join",{lineage}));
      socket.once("room:joined",info=>{
        clearTimeout(timeout);this._connected=true;this.playerId=info.playerId;this.roomId=info.roomId;resolve(info);
      });
      socket.once("room:error",message=>{clearTimeout(timeout);reject(new Error(message));});
      socket.on("player:joined",info=>this.game.playerJoined(info));
      socket.on("player:left",info=>this.game.playerLeft(info));
      socket.once("connect_error",()=>{clearTimeout(timeout);reject(new Error("Could not reach the multiplayer server."));});
      socket.on("world:snapshot",snapshot=>{
        if(this.game.online)this.game.applyMultiplayerSnapshot(snapshot,this.playerId);
        else this._pendingSnapshot=snapshot;
      });
      socket.on("player:eliminated",result=>this.game.onlineEliminated(result));
      socket.on("disconnect",()=>{
        this._connected=false;
        if(this.game.online)this.game.showToast("CONNECTION LOST · RETURNING TO SOLO");
      });
    });
  }

  start(){
    if(this._pendingSnapshot){this.game.applyMultiplayerSnapshot(this._pendingSnapshot,this.playerId);this._pendingSnapshot=null;}
  }

  update(dt){
    if(!this._connected||!this.socket)return;
    this._sendClock-=dt;
    if(this._sendClock<=0){
      this._sendClock=0.05;
      const d=this.game.input.getDir();
      this.socket.emit("player:input",{x:d.x,y:d.y,dash:this.game.input.dash(),bite:this.game.input.bite()});
    }
    for(const fish of this.game._networkFish.values()){
      if(!fish._networkTarget)continue;
      const target=fish._networkTarget;
      fish.pos.x+=(target.x-fish.pos.x)*0.44;
      fish.pos.y+=(target.y-fish.pos.y)*0.44;
      fish.angle+=wrapA(target.angle-fish.angle)*0.44;
      fish.vel.x=target.vx;fish.vel.y=target.vy;fish.updateSpine();
      const speed=Math.hypot(fish.vel.x,fish.vel.y);
      fish.swimPhase+=dt*(3+speed*0.055);
      fish.lurePhase+=dt*3;
      fish.glitchPhase+=dt*13;
      fish.blinkTimer-=dt;
      if(fish.blinkTimer<=0){fish.blinkAnim=0.12;fish.blinkTimer=2.5+Math.random()*3.5;}
      if(fish.blinkAnim>0)fish.blinkAnim-=dt;
      if(fish.feedTimer>0)fish.feedTimer-=dt;
      if(fish._attackAnim>0)fish._attackAnim-=dt;
      if(fish.evolveAnim>0)fish.evolveAnim-=dt;
    }
    this.game.eco.updateParticles(dt);
    if(this.game.eco.flicker>0){
      this.game.eco.flicker-=dt;
      this.game.eco.flickerStrength*=0.86;
      if(this.game.eco.flicker<=0)this.game.eco.flickerStrength=0;
    }
  }

  leave(){
    if(this.socket)this.socket.disconnect();
    this.socket=null;this._connected=false;this.playerId=null;this.roomId=null;
  }
}
