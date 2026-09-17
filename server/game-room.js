"use strict";

const TICK_MS=50;
const ROOM_CAPACITY=20;
const VIEW_RADIUS=2200;
const FOOD_VIEW_RADIUS=1500;

class GameRoom{
  constructor(id,runtime,persistence){
    this.id=id;this.runtime=runtime;this.persistence=persistence;
    this.clients=new Map();this.botSerial=0;this.time=0;this.snapshotSeq=0;
    this.profile={startStage:0,skin:null,energyMult:1,growthMult:1,coinMult:1};
    this.eco=new runtime.Eco(this.profile);
    this.eco.reset("predator");
    // Remove the browser-only placeholder player; joined clients create their
    // own server-owned fish below.
    this.eco.fish=this.eco.fish.filter(f=>f!==this.eco.player);
    this.eco.player=null;
    for(const fish of this.eco.fish)this._assignBotId(fish);
    this.timer=setInterval(()=>this.tick(),TICK_MS);
  }

  get full(){return this.clients.size>=ROOM_CAPACITY;}
  get empty(){return this.clients.size===0;}

  _assignBotId(fish){
    if(!fish._netId)fish._netId=`bot-${this.id}-${++this.botSerial}`;
    return fish;
  }

  _spawnPoint(){
    const C=this.runtime.CFG;
    const a=Math.random()*Math.PI*2,d=220+Math.random()*480;
    return {x:Math.max(80,Math.min(C.W-80,C.W/2+Math.cos(a)*d)),
      y:Math.max(80,Math.min(C.H-80,C.H/2+Math.sin(a)*d))};
  }

  _refreshSimulationPlayer(){
    const active=Array.from(this.clients.values()).find(entry=>entry.fish.alive);
    this.eco.player=active?active.fish:null;
    this.eco.gameOver=false;
  }

  join(socket,lineage){
    if(this.full)return null;
    const key=this.runtime.LINEAGES[lineage]?lineage:"predator";
    const point=this._spawnPoint();
    const fish=new this.runtime.Fish(point.x,point.y,8,key,true,null);
    fish._netId=socket.id;
    fish.netInput={x:0,y:0,_dash:false,_bite:false,
      getDir(){return{x:this.x,y:this.y};},dash(){return this._dash;},bite(){return this._bite;}};
    this.eco.fish.push(fish);
    if(!this.eco.player)this.eco.player=fish;
    this.clients.set(socket.id,{socket,fish,joinedAt:this.time,lastInputSeq:-1});
    this._refreshSimulationPlayer();
    socket.join(this.id);
    socket.emit("room:joined",{roomId:this.id,playerId:socket.id,tickMs:TICK_MS});
    for(const entry of this.clients.values())entry.socket.emit("player:joined",{playerId:socket.id,lineage:key,playerCount:this.clients.size});
    this.sendSnapshot(socket);
    return fish;
  }

  leave(socketId){
    const entry=this.clients.get(socketId);
    if(!entry)return;
    for(const other of this.clients.values()){
      if(other.socket.id!==socketId)other.socket.emit("player:left",{playerId:socketId,playerCount:this.clients.size-1});
    }
    // A disconnecting player becomes an AI fish. This avoids a disappearing
    // hole in a fight and prevents reconnect abuse.
    entry.fish.isPlayer=false;entry.fish.netInput=null;entry.fish._netId=`bot-${this.id}-${++this.botSerial}`;
    if(this.eco.player===entry.fish)this.eco.player=this.eco.fish.find(f=>f.isPlayer&&f.alive)||null;
    this.clients.delete(socketId);
  }

  receiveInput(socketId,input){
    const entry=this.clients.get(socketId);if(!entry||!input)return;
    if(Number.isInteger(input.seq)&&input.seq<=entry.lastInputSeq)return;
    if(Number.isInteger(input.seq))entry.lastInputSeq=input.seq;
    const x=Number(input.x),y=Number(input.y);
    entry.fish.netInput.x=Number.isFinite(x)?Math.max(-1,Math.min(1,x)):0;
    entry.fish.netInput.y=Number.isFinite(y)?Math.max(-1,Math.min(1,y)):0;
    entry.fish.netInput._dash=!!input.dash;
    entry.fish.netInput._bite=!!input.bite;
  }

  tick(){
    this.time+=TICK_MS/1000;
    this.snapshotSeq++;
    this._refreshSimulationPlayer();
    const previous=new Map();
    for(const fish of this.eco.fish){
      fish._foodEvents=[];
      previous.set(fish._netId,{x:fish.pos.x,y:fish.pos.y,kills:fish.kills,coins:fish.coinsEarned,size:fish.size,stage:fish.stage,alive:fish.alive});
    }
    this.eco.update(TICK_MS/1000);
    const events=[];
    const currentIds=new Set();
    for(const fish of this.eco.fish){
      currentIds.add(fish._netId);
      const old=previous.get(fish._netId);
      if(!old)continue;
      if(fish.kills>old.kills){
        const eatPos=fish._lastEatPos||fish.pos;
        events.push({type:"eat",id:fish._netId,playerId:fish.isPlayer?fish._netId:null,
          coins:fish.coinsEarned-old.coins,size:fish.size,x:eatPos.x,y:eatPos.y});
        fish._lastEatPos=null;
      }
      for(const food of fish._foodEvents||[])events.push({type:"food",id:fish._netId,x:food.x,y:food.y});
      if(fish.stage>old.stage)events.push({type:"evolve",id:fish._netId,stage:fish.stage,x:fish.pos.x,y:fish.pos.y});
    }
    for(const [id,old] of previous){
      if(old.alive&&!currentIds.has(id))events.push({type:"death",id,x:old.x,y:old.y});
    }
    for(const [playerId,entry] of this.clients){
      if(entry.fish.alive)continue;
      const result={roomId:this.id,playerId,lineage:entry.fish.lineageKey,kills:entry.fish.kills,
        size:+entry.fish.size.toFixed(1),coins:entry.fish.coinsEarned,
        runId:`${this.id}:${playerId}:${Math.floor(this.time*1000)}`,
        duration_seconds:Math.floor(this.time)};
      entry.socket.emit("player:eliminated",result);
      this.persistence.recordRun(result);
      this.clients.delete(playerId);
    }
    this._refreshSimulationPlayer();
    for(const fish of this.eco.fish)this._assignBotId(fish);
    for(const entry of this.clients.values())this.sendSnapshot(entry.socket,events);
  }

  sendSnapshot(socket,events=[]){
    const entry=this.clients.get(socket.id);if(!entry)return;
    const origin=entry.fish.pos;
    const fish=[];
    for(const f of this.eco.fish){
      if(!f.alive)continue;
      const dx=f.pos.x-origin.x,dy=f.pos.y-origin.y;
      if(f!==entry.fish&&!f.isPlayer&&dx*dx+dy*dy>VIEW_RADIUS*VIEW_RADIUS)continue;
      fish.push({id:f._netId,x:+f.pos.x.toFixed(2),y:+f.pos.y.toFixed(2),vx:+f.vel.x.toFixed(2),
        vy:+f.vel.y.toFixed(2),angle:+f.angle.toFixed(4),size:+f.size.toFixed(2),
        lineage:f.lineageKey,stage:f.stage,energy:+f.energy.toFixed(2),maxEnergy:+f.maxEnergy.toFixed(2),
        stamina:+f.stamina.toFixed(2),hp:+f.hp.toFixed(2),maxHp:+f.maxHp.toFixed(2),kills:f.kills,
        coinsEarned:f.coinsEarned,state:f.state,isPlayer:f.isPlayer,alive:f.alive});
    }
    const food=[];
    for(const item of this.eco.food){
      const dx=item.pos.x-origin.x,dy=item.pos.y-origin.y;
      if(dx*dx+dy*dy<=FOOD_VIEW_RADIUS*FOOD_VIEW_RADIUS)food.push({pos:{x:item.pos.x,y:item.pos.y},r:item.r,phase:item.phase});
    }
    socket.emit("world:snapshot",{seq:this.snapshotSeq,time:+this.time.toFixed(2),fish,food,events});
  }

  dispose(){clearInterval(this.timer);}
}

class RoomManager{
  constructor(runtime,persistence){this.runtime=runtime;this.persistence=persistence;this.rooms=[];this.serial=0;}
  findRoom(){
    let room=this.rooms.find(candidate=>!candidate.full);
    if(!room){room=new GameRoom(`ocean-${++this.serial}`,this.runtime,this.persistence);this.rooms.push(room);}
    return room;
  }
  join(socket,lineage){return this.findRoom().join(socket,lineage);}
  receiveInput(socketId,input){
    for(const room of this.rooms){
      if(!room.clients.has(socketId))continue;
      room.receiveInput(socketId,input);
      return;
    }
  }
  leave(socket){
    for(const room of this.rooms){
      if(!room.clients.has(socket.id))continue;
      room.leave(socket.id);
      if(room.empty){room.dispose();this.rooms=this.rooms.filter(candidate=>candidate!==room);}
      return;
    }
  }
}

module.exports={RoomManager,ROOM_CAPACITY};
