"use strict";

class Input{
  constructor(){
    this.keys=Object.create(null);
    window.addEventListener('keydown',e=>{
      const k=e.key.toLowerCase();this.keys[k]=true;
      if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k))e.preventDefault();
    });
    window.addEventListener('keyup',e=>{this.keys[e.key.toLowerCase()]=false;});
    window.addEventListener('blur',()=>{this.keys=Object.create(null);});
  }
  getDir(){
    let x=0,y=0;
    if(this.keys['a']||this.keys['arrowleft'])x-=1;
    if(this.keys['d']||this.keys['arrowright'])x+=1;
    if(this.keys['w']||this.keys['arrowup'])y-=1;
    if(this.keys['s']||this.keys['arrowdown'])y+=1;
    return{x,y};
  }
  dash(){return !!this.keys.shift;}
  bite(){return !!this.keys[' '];}
}
