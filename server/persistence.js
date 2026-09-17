"use strict";

class RunPersistence{
  constructor(env=process.env){
    this.url=env.SUPABASE_URL;
    this.key=env.SUPABASE_SERVICE_ROLE_KEY;
  }

  async recordRun(run){
    // Online play is usable with no database. Once server-only Supabase
    // credentials are configured, completed runs are written to Postgres.
    if(!this.url||!this.key)return;
    try{
      await fetch(`${this.url}/rest/v1/runs`,{
        method:"POST",
        headers:{
          apikey:this.key,
          Authorization:`Bearer ${this.key}`,
          "Content-Type":"application/json",
          Prefer:"return=minimal"
        },
        body:JSON.stringify(run)
      });
    }catch(error){
      console.warn("Could not persist multiplayer run:",error.message);
    }
  }
}

module.exports={RunPersistence};
