"use strict";

require("dotenv").config();

const http=require("node:http");
const fs=require("node:fs");
const path=require("node:path");
const {Server}=require("socket.io");
const {loadGameRuntime}=require("./runtime");
const {RunPersistence}=require("./persistence");
const {RoomManager,ROOM_CAPACITY}=require("./game-room");

process.on("uncaughtException",error=>{
  console.error("[uncaughtException]", error);
});
process.on("unhandledRejection",reason=>{
  console.error("[unhandledRejection]", reason);
});

const root=path.resolve(__dirname,"..");
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8"};
const allowedOrigins=(process.env.ALLOWED_ORIGINS||"").split(",").map(value=>value.trim()).filter(Boolean);
const getClientIp=(socket)=>{
  const forwarded=(socket.request&&socket.request.headers&&socket.request.headers["x-forwarded-for"]);
  if(typeof forwarded==="string")return forwarded.split(",")[0].trim();
  return socket.request&&socket.request.socket?socket.request.socket.remoteAddress||"unknown":"unknown";
};
const rateLimitMap=new Map();
const connectionLimitMap=new Map();
const rateLimitWindowMs=1000;
const rateLimit=(key,limit,windowMs=rateLimitWindowMs)=>{
  const now=Date.now();
  const bucket=rateLimitMap.get(key);
  if(!bucket){
    rateLimitMap.set(key,{count:1,resetAt:now+windowMs});
    return false;
  }
  if(now>bucket.resetAt){
    bucket.count=1;bucket.resetAt=now+windowMs;return false;
  }
  bucket.count+=1;
  return bucket.count>limit;
};

const server=http.createServer((req,res)=>{
  const rawUrl=req.url||"/";
  let requested="/index.html";
  try{
    requested=rawUrl==="/"?"/index.html":decodeURIComponent(rawUrl.split("?")[0]);
  }catch(_error){
    requested=rawUrl.split("?")[0]||"/index.html";
  }
  if(requested.startsWith("/socket.io/"))return;
  const blocked=(value)=>value==="/.env"||value==="/server"||value.startsWith("/server/")||value==="/data"||value.startsWith("/data/")||value==="/package.json"||value==="/package-lock.json"||value==="/.env.example"||value.endsWith(".env")||value.includes(".env");
  if(blocked(requested)){res.writeHead(403,{"Content-Type":"text/plain; charset=utf-8","X-Content-Type-Options":"nosniff"});res.end("Forbidden");return;}
  const file=path.resolve(root,"."+requested);
  const relative=path.relative(root,file);
  const allowed=relative==="index.html"||relative.startsWith("css"+path.sep)||relative.startsWith("js"+path.sep);
  if(!file.startsWith(root+path.sep)||!allowed){res.writeHead(403,{"Content-Type":"text/plain; charset=utf-8","X-Content-Type-Options":"nosniff"});res.end("Forbidden");return;}
  fs.readFile(file,(error,content)=>{
    if(error){res.writeHead(error.code==="ENOENT"?404:500,{"Content-Type":"text/plain; charset=utf-8","X-Content-Type-Options":"nosniff"});res.end(error.code==="ENOENT"?"Not found":"Server error");return;}
    const ext=path.extname(file);
    res.writeHead(200,{
      "Content-Type":mime[ext]||"application/octet-stream",
      "Cache-Control":"no-cache",
      "X-Content-Type-Options":"nosniff",
      "X-Frame-Options":"SAMEORIGIN",
      "Referrer-Policy":"strict-origin-when-cross-origin",
      "Content-Security-Policy":"default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; font-src 'self' data:;"
    });
    res.end(content);
  });
});
const io=new Server(server,{serveClient:true,cors:{
  origin:(origin,callback)=>{
    if(!origin){callback(null,true);return;}
    if(allowedOrigins.length===0){callback(new Error("Origin not allowed"));return;}
    callback(allowedOrigins.includes(origin)?null:false, allowedOrigins.includes(origin));
  },
  methods:["GET","POST"],
  credentials:true
}});
const manager=new RoomManager(loadGameRuntime(root),new RunPersistence());

io.on("connection",socket=>{
  const ip=getClientIp(socket);
  const limit=Number(process.env.MAX_CONNECTIONS_PER_IP)||4;
  const current=connectionLimitMap.get(ip)||0;
  if(current>=limit){
    console.warn(`[security] connection limit reached for ${ip}`);
    socket.emit("room:error","Too many connections from this IP.");
    socket.disconnect(true);
    return;
  }
  connectionLimitMap.set(ip,current+1);

  socket.on("room:join",data=>{
    if(socket.data.joined)return;
    const joinKey=`join:${ip}`;
    if(rateLimit(joinKey,3,5000)){
      socket.emit("room:error","Too many room join attempts. Please wait a moment.");
      return;
    }
    const fish=manager.join(socket,data&&data.lineage);
    if(!fish){socket.emit("room:error","No room is available.");return;}
    socket.data.joined=true;
  });

  socket.on("player:input",input=>{
    if(rateLimit(`input:${ip}`,40,1000)){
      socket.emit("room:error","Input rate limit exceeded.");
      return;
    }
    manager.receiveInput(socket.id,input);
  });

  socket.on("disconnect",()=>{
    const before=connectionLimitMap.get(ip)||0;
    if(before<=1){connectionLimitMap.delete(ip);}else{connectionLimitMap.set(ip,before-1);}
    manager.leave(socket);
  });
});

const port=Number(process.env.PORT)||3000;
server.listen(port,()=>console.log(`Predation.io listening on http://localhost:${port} (${ROOM_CAPACITY} players per ocean)`));
