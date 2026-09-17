"use strict";

const http=require("node:http");
const fs=require("node:fs");
const path=require("node:path");
const {Server}=require("socket.io");
const {loadGameRuntime}=require("./runtime");
const {RunPersistence}=require("./persistence");
const {RoomManager,ROOM_CAPACITY}=require("./game-room");

const root=path.resolve(__dirname,"..");
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8"};
const server=http.createServer((req,res)=>{
  const requested=req.url==="/"?"/index.html":decodeURIComponent(req.url.split("?")[0]);
  const file=path.resolve(root,"."+requested);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end("Forbidden");return;}
  fs.readFile(file,(error,content)=>{
    if(error){res.writeHead(error.code==="ENOENT"?404:500);res.end("Not found");return;}
    res.writeHead(200,{"Content-Type":mime[path.extname(file)]||"application/octet-stream","Cache-Control":"no-cache"});res.end(content);
  });
});
const io=new Server(server,{serveClient:true,cors:{origin:true,methods:["GET","POST"]}});
const manager=new RoomManager(loadGameRuntime(root),new RunPersistence());

io.on("connection",socket=>{
  socket.on("room:join",data=>{
    if(socket.data.joined)return;
    const fish=manager.join(socket,data&&data.lineage);
    if(!fish){socket.emit("room:error","No room is available.");return;}
    socket.data.joined=true;
  });
  socket.on("player:input",input=>manager.receiveInput(socket.id,input));
  socket.on("disconnect",()=>manager.leave(socket));
});

const port=Number(process.env.PORT)||3000;
server.listen(port,()=>console.log(`Predation.io listening on http://localhost:${port} (${ROOM_CAPACITY} players per ocean)`));
