'use strict';
const assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{create}=require('../desktop/lib/arcana-runtime');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const workers=[],states=[];let allowedGame={window:123},fallbackResolve;
 class Fake extends EventEmitter{constructor(file,options){super();this.file=file;this.options=options;this.messages=[];this.stopped=false;workers.push(this);}postMessage(m){this.messages.push(m);}terminate(){this.stopped=true;return Promise.resolve(0);}}
 const app=create({game:()=>allowedGame,library:'owned.dll',WorkerClass:Fake,notify:s=>states.push(s),fallback:()=>new Promise(r=>{fallbackResolve=r;})});
 try{
  app.sync(false);await app.command('read');assert.equal(workers.length,0,'Disabled Arcana created a thread');
  app.sync(true);app.read();const first=workers[0];assert.equal(first.options.workerData.hwnd,123);
  first.emit('message',{event:'checkpoint',value:{model:{position:5}}});
  first.emit('message',{event:'fallback',requestRevision:9});await pause(1);app.sync(false);fallbackResolve({width:100,height:100,data:[]});await pause(1);assert.equal(first.stopped,true);assert.equal(first.messages.some(m=>m.cmd==='frame'),false,'A fallback delivered pixels after capture stop');
  app.sync(true);app.read();const second=workers[1];assert.equal(second.options.workerData.resume.model.position,5,'Mode switching lost the known board');
  second.emit('message',{event:'status',state:{phase:'advice',move:'synthetic'}});assert.equal(states.at(-1).move,'synthetic');
  const hoverStates=states.length,hoverMessages=second.messages.length;
  app.feed(['S9HandCard_C_OnMouseEnter','S9PreCard_C_OnMouseEnter','S9ChooseCard_C_OnMouseEnter']);
  assert.equal(states.length,hoverStates,'Card hover removed a valid advice');assert.equal(second.messages.length,hoverMessages,'Card hover restarted recognition');
  app.feed(['ProtoId = 5552']);assert.equal(states.at(-1).phase,'reading','A real game move left the previous advice visible');assert.equal(second.messages.at(-1).cmd,'invalidate');
  app.feed(['S9Taro HandleOrderAni Start Step=1 Type=CardGroupAdd','S9Taro HandleOrderAni All done']);assert.equal(second.messages.at(-1).cmd,'settled');assert.equal(second.messages.at(-1).value.refillOnly,true,'A completed default-card refresh was not recognised');
  app.feed(['S9Taro HandleOrderAni Start Step=1 Type=CardDraw','S9Taro HandleOrderAni Start Step=2 Type=Move','S9Taro HandleOrderAni All done']);assert.equal(second.messages.at(-1).value.refillOnly,false,'A real move was mistaken for a same-face refill');
  app.feed(['S9ChooseCard Run']);assert.ok(second.messages.some(m=>m.cmd==='popup'&&m.value==='choose'),'Opening a game choice did not enter popup recognition');app.feed(['S9ChooseCard Hide']);assert.ok(second.messages.some(m=>m.cmd==='popup'&&m.value===null),'Closing a game choice left popup recognition enabled');
  const oldStates=states.length;first.emit('message',{event:'status',state:{phase:'advice',move:'stale'}});assert.equal(states.length,oldStates,'Stopped worker replaced current advice');
  app.sync(false);allowedGame={window:456};app.sync(true);app.read();assert.equal(workers[2].options.workerData.resume,null,'Another window inherited the previous board');
  const promise=app.command('correct',{});app.sync(false);await assert.rejects(promise,/stopped/);await pause(1);assert.equal(app.info().retiring,0);assert.equal(app.info().pending,0);
  app.close();assert.ok(workers.every(w=>w.stopped));await assert.rejects(app.command('correct',{}),/Enable/);
  console.log('PASS: Arcana shared capture consent, stopped/stale workers, fallback isolation, state retention per game window, immediate advice invalidation and pending request cleanup.');
 }finally{app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
