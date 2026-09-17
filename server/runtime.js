"use strict";

// The simulation files were authored for the browser. Loading them in one VM
// context lets the authoritative server run the same Fish and Eco rules.
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

function loadGameRuntime(projectRoot){
  const context=vm.createContext({console,Math,setTimeout,clearTimeout});
  for(const file of ["js/game-world-config.js","js/fish-behavior.js","js/ecosystem-simulation.js"]){
    vm.runInContext(fs.readFileSync(path.join(projectRoot,file),"utf8"),context,{filename:file});
  }
  return vm.runInContext("({CFG,LINEAGES,LINEAGE_KEYS,Fish,Eco,clamp,rand,rInt})",context);
}

module.exports={loadGameRuntime};
