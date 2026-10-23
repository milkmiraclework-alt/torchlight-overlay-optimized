'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {classify,LogTail}=require('../desktop/lib/mode-router'),{create}=require('../desktop/lib/unified-runtime');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 assert.equal(classify('LogDataTable: unrelated S13 icon'),null);
 for(const l of ['S13GamePlayMain Run','ProtoId = 5619','S13GamePlayMain_C_RefreshBtn'])assert.equal(classify(l),'vorax');
 for(const l of ['S16BoardMain Run','S16BoardRelicPop Run','Btn_S16Board_ActionCell'])assert.equal(classify(l),'tartarus');
 for(const l of ['S13GamePlayMain Hide','ProtoId = 5621','UI_S16_Riot_Interface','LogLoad: LoadMap: other'])assert.equal(classify(l),'idle');
 const dir=path.join(__dirname,'../sandbox/router-'+process.pid);fs.mkdirSync(dir,{recursive:true});const log=path.join(dir,'UE_game.log');fs.writeFileSync(log,'');
 const config={consent:{version:4},mode:'auto',shelley:6,threads:0,overlayOn:true};let running=true;const children=[],notes=[];
 const spawn=(exe,args,options)=>{const c=new EventEmitter();c.pid=1000+children.length;c.killed=false;c.stdout=new PassThrough();c.stderr=new PassThrough();c.writes=[];c.stdin=new PassThrough();c.stdin.on('data',v=>c.writes.push(JSON.parse(String(v))));c.kill=()=>{if(!c.killed){c.killed=true;queueMicrotask(()=>c.emit('exit',0));}};c.options=options;c.args=args;children.push(c);return c;};
 const app=create({executable:'test-backend.exe',config:()=>config,game:()=>({running,window:123}),userData:dir,spawnWorker:spawn,notify(){},note:(...a)=>notes.push(a)});
 const feed=async line=>{fs.appendFileSync(log,line+'\n');app.poll();await Promise.resolve();};
 try{
  app.setLog(log);await feed('S16BoardMain Run');assert.equal(app.mode,'tartarus');assert.equal(children.length,0);
  config.consent={withdrawn:true};await feed('S13GamePlayMain Run');assert.equal(app.mode,'vorax');assert.equal(children.length,0,'Disabled capture spawned a worker');
  config.consent={version:4};app.sync();assert.equal(children.length,1);const first=children[0];
  assert.ok(Number(first.options.env.RAYON_NUM_THREADS)>=1);assert.equal(first.options.env.TORCHLIGHT_GAME_HWND,'123');assert.equal(first.options.windowsHide,true);
  first.stdout.write(JSON.stringify({event:'ready'})+'\n');await feed('S13GamePlayMain Run');await feed('Play_UI_S13_KYZ_Card_some_animation');await pause(450);
  assert.equal(first.writes.filter(x=>x.cmd==='read').length,1);assert.equal(first.writes.find(x=>x.cmd==='read').trigger,'screen','Animation discarded screen-reset trigger');
  const beforeIdle=first.writes.length;for(let i=0;i<100;i++)app.sync();assert.equal(first.writes.length,beforeIdle,'Unchanged log/status polls caused repeated overlay redraws');
  assert.equal(first.writes.find(x=>x.cmd==='read').now,false,'Automatic capture must retain stable-frame waiting');
  app.manual();assert.equal(first.writes.at(-1).now,true,'Manual capture gained an unnecessary animation wait');
  await feed('ProtoId = 5619');app.manual();const afterManual=first.writes.length;await pause(450);assert.equal(first.writes.length,afterManual,'Manual capture left a duplicate automatic read pending');
  config.overlayOn=false;app.sync();assert.equal(first.writes.at(-1).shown,false);
  await feed('S16BoardMain Run');assert.equal(first.killed,true);assert.equal(app.info().children,0);
  first.stdout.write(JSON.stringify({event:'read',kind:'animating'})+'\n');await pause(750);assert.equal(children.length,1,'Old worker restarted another generation');
  await feed('S13GamePlayMain Run');const second=children[1];assert.ok(second);config.consent={withdrawn:true};app.sync();await Promise.resolve();assert.equal(second.killed,true);assert.equal(app.info().children,0);
  config.consent={version:4};app.sync();const third=children[2];third.stdout.write(JSON.stringify({event:'ready'})+'\n');running=false;app.sync();await Promise.resolve();assert.equal(third.killed,true);
  running=true;config.mode='vorax';config.threads=3;app.sync();assert.equal(children.at(-1).options.env.RAYON_NUM_THREADS,'3');
  app.close();await Promise.resolve();assert.equal(app.info().children,0);assert.ok(children.every(c=>c.killed));
  // Rotation, large existing logs, partial UTF-8 and no replay of old lines.
  const parts=[];const tail=new LogTail(lines=>parts.push(...lines));fs.writeFileSync(log,('noise\n').repeat(60000)+'S16BoardMain Run\n');tail.setPath(log);assert.equal(parts.at(-1),'S16BoardMain Run');const count=parts.length;tail.poll();assert.equal(parts.length,count);
  fs.appendFileSync(log,'S13GamePlay');tail.poll();assert.equal(parts.length,count);fs.appendFileSync(log,'Main Run\n');tail.poll();assert.equal(parts.at(-1),'S13GamePlayMain Run');
  fs.writeFileSync(log,'LogLoad: LoadMap: reset\n');tail.poll();assert.equal(parts.at(-1),'LogLoad: LoadMap: reset');
  console.log('PASS: automatic mode routing, shared capture stop, screen reset through animation, stale worker isolation, game close, CPU auto/manual threads, bounded log tail/rotation and zero owned children after shutdown.');
 }finally{app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
