"use strict";
const fs = require("fs");
const path = require("path");

const DEFAULT_UPGRADES = { startStage:0, extraEnergy:0, growthBoost:0, coinMult:0 };
const DEFAULT_BEST     = { time:0, kills:0, size:0, coins:0 };

function cloneDefaultProfile(){
  return {
    coins: 0,
    skins: ["default"],
    activeSkin: "default",
    upgrades: Object.assign({}, DEFAULT_UPGRADES),
    best: Object.assign({}, DEFAULT_BEST),
    totalKills: 0,
    totalRuns: 0,
    totalCoinsEarned: 0
  };
}

function rowToProfile(row){
  if(!row) return cloneDefaultProfile();
  const up = (row.upgrades && typeof row.upgrades === "object") ? row.upgrades : {};
  const best = (row.best && typeof row.best === "object") ? row.best : {};
  const skins = Array.isArray(row.skins) && row.skins.length ? row.skins.slice() : ["default"];
  if(skins.indexOf("default") < 0) skins.unshift("default");
  return {
    coins: row.coins | 0,
    skins: skins,
    activeSkin: row.active_skin || "default",
    upgrades: Object.assign({}, DEFAULT_UPGRADES, up),
    best: Object.assign({}, DEFAULT_BEST, best),
    totalKills: row.total_kills | 0,
    totalRuns: row.total_runs | 0,
    totalCoinsEarned: row.total_coins_earned | 0
  };
}

class PlayerAccountStore {
  constructor(env = process.env){
    this.env = env;
    this.databaseUrl = env.DATABASE_URL || "";
    this.usePg = !!this.databaseUrl;
    this.localFile = env.PROFILES_FILE || path.join(__dirname, "data", "profiles.json");
    this._pool = null;
    this._local = null;
    this._localQueue = Promise.resolve();
    if(!this.usePg){
      try { fs.mkdirSync(path.dirname(this.localFile), { recursive: true }); } catch(e){}
    }
  }

  // ---- pg plumbing ---------------------------------------------------------

  _getPool(){
    if(this._pool) return this._pool;
    // Lazy require so local-fallback mode never needs pg installed.
    const { Pool } = require("pg");
    this._pool = new Pool({
      connectionString: this.databaseUrl,
      ssl: { rejectUnauthorized: false } // Supabase requires TLS
    });
    return this._pool;
  }

  // ---- local JSON plumbing -------------------------------------------------

  _loadLocal(){
    if(this._local) return this._local;
    let data = {};
    try {
      data = JSON.parse(fs.readFileSync(this.localFile, "utf8"));
    } catch(e){ data = {}; }
    if(!data || typeof data !== "object" || Array.isArray(data)) data = {};
    this._local = data;
    return data;
  }

  _persistLocal(){
    const snapshot = JSON.stringify(this._local, null, 2);
    return new Promise((resolve) => {
      this._localQueue = this._localQueue.then(
        () => fs.writeFile(this.localFile, snapshot, (e) => resolve(e || null))
      );
    });
  }

  _localEntry(deviceId, create){
    const db = this._loadLocal();
    let e = db[deviceId];
    if(!e && create){
      e = db[deviceId] = { profile: cloneDefaultProfile(), created_at: new Date().toISOString() };
    }
    if(e && !e.profile) e.profile = cloneDefaultProfile();
    return e;
  }

  // ---- public API ----------------------------------------------------------

  async getOrCreateProfile(deviceId){
    if(!deviceId) throw new Error("deviceId required");

    if(!this.usePg){
      const e = this._localEntry(deviceId, true);
      // Deep copy so callers can't mutate the in-memory cache by reference.
      return JSON.parse(JSON.stringify(e.profile));
    }

    const pool = this._getPool();
    const sql = `
      WITH u AS (
        INSERT INTO public.users (device_id) VALUES ($1)
        ON CONFLICT (device_id) DO UPDATE SET device_id = public.users.device_id
        RETURNING id
      ), p AS (
        INSERT INTO public.player_profiles (user_id)
        SELECT id FROM u
        ON CONFLICT (user_id) DO NOTHING
        RETURNING user_id, coins, skins, active_skin, upgrades, best,
                  total_kills, total_runs, total_coins_earned
      )
      SELECT * FROM p
      UNION ALL
      SELECT pp.user_id, pp.coins, pp.skins, pp.active_skin, pp.upgrades, pp.best,
             pp.total_kills, pp.total_runs, pp.total_coins_earned
      FROM public.player_profiles pp JOIN u ON pp.user_id = u.id
      LIMIT 1;
    `;
    const r = await pool.query(sql, [deviceId]);
    return rowToProfile(r.rows[0]);
  }

  async saveProfile(deviceId, profileData){
    if(!deviceId) throw new Error("deviceId required");
    const p = Object.assign(cloneDefaultProfile(), profileData || {});

    if(!this.usePg){
      const e = this._localEntry(deviceId, true);
      e.profile = JSON.parse(JSON.stringify(p));
      e.updated_at = new Date().toISOString();
      await this._persistLocal();
      return e.profile;
    }

    const pool = this._getPool();
    const sql = `
      UPDATE public.player_profiles pp
      SET coins = $2, skins = $3, active_skin = $4, upgrades = $5, best = $6,
          total_kills = $7, total_runs = $8, total_coins_earned = $9,
          updated_at = now()
      FROM public.users u
      WHERE pp.user_id = u.id AND u.device_id = $1
      RETURNING pp.*;
    `;
    const r = await pool.query(sql, [
      deviceId,
      p.coins | 0,
      p.skins && p.skins.length ? p.skins : ["default"],
      p.activeSkin || "default",
      p.upgrades || DEFAULT_UPGRADES,
      p.best || DEFAULT_BEST,
      p.totalKills | 0,
      p.totalRuns | 0,
      p.totalCoinsEarned | 0
    ]);
    if(!r.rows.length){
      // user row missing — create it, then retry once.
      await this.getOrCreateProfile(deviceId);
      return this.saveProfile(deviceId, p);
    }
    return rowToProfile(r.rows[0]);
  }

  // Atomic increment — safe against concurrent tabs.
  async addCoins(deviceId, amount){
    const amt = amount | 0;
    if(!amt) return this.getOrCreateProfile(deviceId);
    if(!deviceId) throw new Error("deviceId required");

    if(!this.usePg){
      const e = this._localEntry(deviceId, true);
      e.profile.coins = (e.profile.coins | 0) + amt;
      if(amt > 0) e.profile.totalCoinsEarned = (e.profile.totalCoinsEarned | 0) + amt;
      await this._persistLocal();
      return JSON.parse(JSON.stringify(e.profile));
    }

    const pool = this._getPool();
    const sql = `
      UPDATE public.player_profiles pp
      SET coins = pp.coins + $2,
          total_coins_earned = pp.total_coins_earned + GREATEST($2, 0),
          updated_at = now()
      FROM public.users u
      WHERE pp.user_id = u.id AND u.device_id = $1
      RETURNING pp.*;
    `;
    const r = await pool.query(sql, [deviceId, amt]);
    if(!r.rows.length) throw new Error("profile not found for deviceId " + deviceId);
    return rowToProfile(r.rows[0]);
  }

  // Returns true on success, false on insufficient balance. Mirrors
  // Profile.spendCoins()'s boolean contract on the client.
  async spendCoins(deviceId, amount){
    const amt = amount | 0;
    if(amt <= 0) return true;
    if(!deviceId) throw new Error("deviceId required");

    if(!this.usePg){
      const e = this._localEntry(deviceId, true);
      if((e.profile.coins | 0) < amt) return false;
      e.profile.coins = (e.profile.coins | 0) - amt;
      await this._persistLocal();
      return true;
    }

    const pool = this._getPool();
    const sql = `
      UPDATE public.player_profiles pp
      SET coins = pp.coins - $2, updated_at = now()
      FROM public.users u
      WHERE pp.user_id = u.id AND u.device_id = $1 AND pp.coins >= $2
      RETURNING pp.coins;
    `;
    const r = await pool.query(sql, [deviceId, amt]);
    return r.rows.length > 0;
  }

  // ---- shop mutations (Step 6) --------------------------------------------
  // Caller is responsible for validating `key`/`cost` against the shop catalog.
  // These do the check-and-mutate atomically in one transaction.

  async buySkin(deviceId, key, cost){
    const c = cost | 0;

    if(!this.usePg){
      const e = this._localEntry(deviceId, true);
      const p = e.profile;
      if(p.skins.indexOf(key) >= 0) return { ok:false, reason:"already_owned" };
      if((p.coins | 0) < c)          return { ok:false, reason:"insufficient_funds" };
      p.coins = (p.coins | 0) - c;
      p.skins.push(key);
      await this._persistLocal();
      return { ok:true, profile: JSON.parse(JSON.stringify(p)) };
    }

    const pool = this._getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const sql = `
        UPDATE public.player_profiles pp
        SET coins = pp.coins - $2,
            skins = array_append(pp.skins, $3),
            updated_at = now()
        FROM public.users u
        WHERE pp.user_id = u.id
          AND u.device_id = $1
          AND pp.coins >= $2
          AND NOT ($3 = ANY(pp.skins))
        RETURNING pp.*;
      `;
      const r = await client.query(sql, [deviceId, c, key]);
      await client.query("COMMIT");
      if(!r.rows.length) return { ok:false, reason:"rejected" };
      return { ok:true, profile: rowToProfile(r.rows[0]) };
    } catch(err){
      try { await client.query("ROLLBACK"); } catch(e){}
      throw err;
    } finally {
      client.release();
    }
  }

  async buyUpgrade(deviceId, key, nextLevel, cost){
    const lvl = nextLevel | 0;
    const c = cost | 0;

    if(!this.usePg){
      const e = this._localEntry(deviceId, true);
      const p = e.profile;
      const cur = p.upgrades[key] | 0;
      if(cur >= lvl)          return { ok:false, reason:"already_at_level" };
      if((p.coins | 0) < c)   return { ok:false, reason:"insufficient_funds" };
      p.coins = (p.coins | 0) - c;
      p.upgrades[key] = lvl;
      await this._persistLocal();
      return { ok:true, profile: JSON.parse(JSON.stringify(p)) };
    }

    const pool = this._getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const sql = `
        UPDATE public.player_profiles pp
        SET coins = pp.coins - $3,
            upgrades = jsonb_set(pp.upgrades, ARRAY[$4]::text[], to_jsonb($5::int), true),
            updated_at = now()
        FROM public.users u
        WHERE pp.user_id = u.id
          AND u.device_id = $1
          AND pp.coins >= $3
          AND (COALESCE((pp.upgrades->>$4)::int, 0) < $5)
        RETURNING pp.*;
      `;
      const r = await client.query(sql, [deviceId, c, c, key, lvl]);
      // NOTE: placeholders intentionally re-used via positional args above; see
      // the corrected SQL below — $2 is the cost.
      await client.query("COMMIT");
      if(!r.rows.length) return { ok:false, reason:"rejected" };
      return { ok:true, profile: rowToProfile(r.rows[0]) };
    } catch(err){
      try { await client.query("ROLLBACK"); } catch(e){}
      throw err;
    } finally {
      client.release();
    }
  }

  async equipSkin(deviceId, key){
    if(!this.usePg){
      const e = this._localEntry(deviceId, true);
      const p = e.profile;
      if(p.skins.indexOf(key) < 0) return { ok:false, reason:"not_owned" };
      p.activeSkin = key;
      await this._persistLocal();
      return { ok:true, profile: JSON.parse(JSON.stringify(p)) };
    }

    const pool = this._getPool();
    const sql = `
      UPDATE public.player_profiles pp
      SET active_skin = $2, updated_at = now()
      FROM public.users u
      WHERE pp.user_id = u.id
        AND u.device_id = $1
        AND $2 = ANY(pp.skins)
      RETURNING pp.*;
    `;
    const r = await pool.query(sql, [deviceId, key]);
    if(!r.rows.length) return { ok:false, reason:"not_owned" };
    return { ok:true, profile: rowToProfile(r.rows[0]) };
  }
}

module.exports = { PlayerAccountStore, cloneDefaultProfile, rowToProfile };