"use strict";
(function(){
  var KEY = "predation_device_id_v1";

  function uuidv4(){
    if(typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"){
      return crypto.randomUUID();
    }
    var b = new Uint8Array(16);
    if(typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function"){
      crypto.getRandomValues(b);
    } else {
      for(var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = [];
    for(var j = 0; j < 16; j++) h.push((b[j] + 0x100).toString(16).slice(1));
    return h.slice(0,4).join("") + "-" + h.slice(4,6).join("") + "-" +
           h.slice(6,8).join("") + "-" + h.slice(8,10).join("") + "-" +
           h.slice(10,16).join("");
  }

  function getDeviceId(){
    var id = null;
    try { id = localStorage.getItem(KEY); } catch(e){}
    if(!id){
      id = uuidv4();
      try { localStorage.setItem(KEY, id); } catch(e){}
    }
    return id;
  }

  // Attach to window (classic-script style, matches the rest of js/*.js).
  window.getDeviceId = getDeviceId;
  window.PredationDevice = { KEY: KEY, getDeviceId: getDeviceId };
})();