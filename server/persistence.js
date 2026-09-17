"use strict";

const fs=require("node:fs");
const path=require("node:path");

class RunPersistence{
  constructor(env=process.env){
    this.url=env.SUPABASE_URL;
    this.key=env.SUPABASE_SERVICE_ROLE_KEY;
    this.file=path.join(__dirname,"data","runs.json");
  }

  async recordRun(run){
    // Online play is usable with no database. Once server-only Supabase
    // credentials are configured, completed runs are written to Postgres.
    if(!this.url||!this.key){
      try{
        fs.mkdirSync(path.dirname(this.file),{recursive:true});
        let runs=[];
        try{runs=JSON.parse(fs.readFileSync(this.file,"utf8"));}catch(_){ }
        const runId=run.runId||`${run.roomId}:${run.playerId}:${run.duration_seconds}`;
        if(!runs.some(item=>item.runId===runId)){
          runs.push({...run,runId});
          fs.writeFileSync(this.file,JSON.stringify(runs,null,2));
        }
      }catch(error){console.warn("Could not persist local multiplayer run:",error.message);}
      return;
    }
    try{
      await fetch(`${this.url}/rest/v1/runs?on_conflict=run_id`,{
        method:"POST",
        headers:{
          apikey:this.key,
          Authorization:`Bearer ${this.key}`,
          "Content-Type":"application/json",
          Prefer:"return=minimal,resolution=ignore-duplicates"
        },
        body:JSON.stringify(run)
      });
    }catch(error){
      console.warn("Could not persist multiplayer run:",error.message);
    }
  }
}

module.exports={RunPersistence};
