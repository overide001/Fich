"use strict";

const v={
  add:(a,b)=>({x:a.x+b.x,y:a.y+b.y}),
  sub:(a,b)=>({x:a.x-b.x,y:a.y-b.y}),
  scale:(a,s)=>({x:a.x*s,y:a.y*s}),
  len:(a)=>Math.hypot(a.x,a.y),
  norm:(a)=>{const l=Math.hypot(a.x,a.y)||1;return{x:a.x/l,y:a.y/l}},
  d2:(a,b)=>{const dx=a.x-b.x,dy=a.y-b.y;return dx*dx+dy*dy},
  d:(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),
};
const clamp=(x,a,b)=>x<a?a:(x>b?b:x);
const lerp=(a,b,t)=>a+(b-a)*t;
const rand=(a,b)=>a+Math.random()*(b-a);
const rInt=(a,b)=>Math.floor(rand(a,b+1));
const wrapA=(a)=>{while(a>Math.PI)a-=Math.PI*2;while(a<-Math.PI)a+=Math.PI*2;return a};

const PLAYER_COLOR='#ffcc44';
const PLAYER_GLOW='rgba(255,204,68,';
const PLAYER_DARK='#8a6a00';

const CFG={
  W:1600,H:900,EDGE:110,
  SIZE_RATIO:1.25,
  EAT_GROWTH:0.22,EAT_ENERGY:9,
  METAB:0.45,METAB_SZ:0.055,
  SPD:150,SPD_SZ:0.06,SPD_MIN:60,
  TURN_AI:4.2,TURN_PLR:13,
  VIS_BASE:210,VIS_SZ:4.5,
  STAM_MAX:100,STAM_DRAIN_FLEE:42,STAM_DRAIN_CHASE:11,STAM_REGEN:14,
  PREDICT_CAP:1.0,MEMORY:1.8,
  HUNGER:0.15,
  EV_2:12,EV_3:26,EV_4:52,
  FOOD_TGT:180,FOOD_RATE:16,FOOD_NRJ:7,FOOD_GROW:0.06,
  MAX_FISH:70,SPAWN_T:1.6,
  P_SIZE:8,P_NRJ:140,P_SPD:1.08,
  EVO_DUR:1.5,
  AI_START_ENERGY:0.65,
  BITE_RADIUS:(a,b)=>(a+b)*0.65,
};
const STAGE_NAMES=['FRY','JUVENILE','HUNTER','APEX'];

const PROFILES={
  pr1:[0.14,0.26,0.24,0.18,0.10,0.03], pr2:[0.30,0.55,0.66,0.56,0.34,0.10],
  pr3:[0.18,0.30,0.34,0.30,0.22,0.08], pr4:[0.58,0.98,1.12,0.94,0.62,0.20],
  sw1:[0.10,0.18,0.16,0.12,0.07,0.02], sw2:[0.12,0.20,0.18,0.14,0.09,0.03],
  sw3:[0.16,0.24,0.22,0.18,0.11,0.04], sw4:[0.20,0.30,0.28,0.22,0.13,0.05],
  ar1:[0.26,0.40,0.38,0.30,0.18,0.06], ar2:[0.38,0.64,0.68,0.60,0.40,0.14],
  ar3:[0.46,0.78,0.84,0.70,0.44,0.16], ar4:[0.55,0.95,1.05,0.88,0.55,0.20],
  se1:[0.12,0.16,0.18,0.18,0.14,0.08], se2:[0.14,0.18,0.20,0.20,0.16,0.09],
  se3:[0.18,0.24,0.26,0.24,0.20,0.10], se4:[0.26,0.36,0.38,0.36,0.28,0.14],
  ab1:[0.20,0.32,0.30,0.24,0.14,0.04], ab2:[0.28,0.46,0.50,0.42,0.24,0.08],
  ab3:[0.38,0.64,0.68,0.58,0.34,0.12], ab4:[0.52,0.88,0.94,0.78,0.48,0.16],
};
function widthAt(key,t){
  const a=PROFILES[key]||PROFILES.pr2;
  const n=a.length-1,s=t*n,i=Math.floor(s),f=s-i;
  if(i>=n)return a[n];
  return a[i]+(a[i+1]-a[i])*f;
}

const LINEAGES={
  predator:{ name:'PREDATOR', desc:'Balanced · Pack hunter', spdMul:1.00, defMul:1.00, aggrMul:1.00, visMul:1.00, stamMul:1.00,
    stages:[
      { profile:'pr1', shape:'forked', dorsal:'tiny', color:'#9a9a9a', aggr:0.40, size:8 },
      { profile:'pr2', shape:'fan', dorsal:'spiny', color:'#c0c0c0', aggr:0.60, size:16 },
      { profile:'pr3', shape:'forked', dorsal:'rear', color:'#e0e0e0', aggr:0.80, size:30 },
      { profile:'pr4', shape:'crescent', dorsal:'spike', color:'#ffffff', aggr:0.95, size:60 } ] },
  swift:{ name:'SWIFT', desc:'Fast · Hit and run', spdMul:1.28, defMul:0.95, aggrMul:0.70, visMul:1.05, stamMul:0.55,
    stages:[
      { profile:'sw1', shape:'forked', dorsal:'tiny', color:'#8a8a8a', aggr:0.30, size:6 },
      { profile:'sw2', shape:'forked', dorsal:'tiny', color:'#a8a8a8', aggr:0.50, size:14 },
      { profile:'sw3', shape:'crescent', dorsal:'rear', color:'#d0d0d0', aggr:0.70, size:28 },
      { profile:'sw4', shape:'crescent', dorsal:'rear', color:'#f0f0f0', aggr:0.85, size:55 } ] },
  armor:{ name:'ARMOR', desc:'Tanky · Slow bruiser', spdMul:0.82, defMul:1.22, aggrMul:0.90, visMul:0.95, stamMul:1.10,
    stages:[
      { profile:'ar1', shape:'fan', dorsal:'tiny', color:'#8f8f8f', aggr:0.40, size:8 },
      { profile:'ar2', shape:'fan', dorsal:'spiny', color:'#b0b0b0', aggr:0.60, size:18 },
      { profile:'ar3', shape:'spike', dorsal:'spiny', color:'#d8d8d8', aggr:0.80, size:34 },
      { profile:'ar4', shape:'spike', dorsal:'spike', color:'#ffffff', aggr:0.95, size:70 } ] },
  serpent:{ name:'SERPENT', desc:'Long · Wide vision', spdMul:0.95, defMul:1.00, aggrMul:0.85, visMul:1.30, stamMul:1.00,
    stages:[
      { profile:'se1', shape:'forked', dorsal:'rear', color:'#8a8a8a', aggr:0.40, size:8 },
      { profile:'se2', shape:'forked', dorsal:'rear', color:'#a8a8a8', aggr:0.60, size:18 },
      { profile:'se3', shape:'forked', dorsal:'crest', color:'#d0d0d0', aggr:0.75, size:34 },
      { profile:'se4', shape:'crescent', dorsal:'crest', color:'#ffffff', aggr:0.90, size:65 } ] },
  abyss:{ name:'ABYSS', desc:'Ambush · Huge jaws', spdMul:0.88, defMul:1.05, aggrMul:1.05, visMul:0.90, stamMul:1.00, ambush:true, lure:true,
    stages:[
      { profile:'ab1', shape:'forked', dorsal:'tiny', color:'#7a7a7a', aggr:0.60, size:8 },
      { profile:'ab2', shape:'fan', dorsal:'spiny', color:'#9a9a9a', aggr:0.75, size:18 },
      { profile:'ab3', shape:'fan', dorsal:'spike', color:'#c8c8c8', aggr:0.90, size:34 },
      { profile:'ab4', shape:'crescent', dorsal:'spike', color:'#ffffff', aggr:1.00, size:70 } ] },
};
const LINEAGE_KEYS=['predator','swift','armor','serpent','abyss'];
