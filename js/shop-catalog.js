"use strict";

const SKINS={
  default:{ name:'DEFAULT', cost:0, desc:'Standard issue predator.' },
  ghost:  { name:'GHOST',   cost:25,  desc:'Translucent body. Brighter glow.' },
  glitch: { name:'GLITCH',  cost:60,  desc:'Jittering body position.' },
  scanline:{name:'SCANLINE',cost:100, desc:'Horizontal scanline stripes.' },
  dotted: { name:'DOTTED',  cost:150, desc:'Dotted outline.' },
  solid:  { name:'SOLID',   cost:220, desc:'No outline. Pure solid body.' },
  holo:   { name:'HOLOGRAM',cost:350, desc:'Double outline with drift offset.' },
  reverse:{ name:'REVERSE', cost:500, desc:'Hollow body — outline only.' },
};
const UPGRADES={
  startStage:{ name:'ADVANCED SPAWN', max:2, cost:[80,220], desc:'Start each run one stage higher. Second level starts you at stage 3.' },
  extraEnergy:{ name:'BIG LUNGS', max:3, cost:[40,90,180], desc:'+25% starting & max energy per level.' },
  growthBoost:{ name:'FAST GROWTH', max:3, cost:[60,140,300], desc:'+15% size gained from food & kills per level.' },
  coinMult:{ name:'SCAVENGER', max:3, cost:[100,250,500], desc:'+25% coins earned per level.' },
};
