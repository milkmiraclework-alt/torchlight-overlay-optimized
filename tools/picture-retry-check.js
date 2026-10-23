'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../desktop/lib/fast-runtime.js'),'utf8');
async function harness(failures,{firstMissing=false,missingCaptures=0,kind='instruments',deferConnect=false}={}){
 let now=0,nextTimer=1,ocrPrepared=0;const timers=new Map(),handlers={},commands={},reads=[],status=[],captures=[],connections=[],settings={consent:{version:4},activeMode:'tartarus'};
 const time=(fn,ms)=>{const id=nextTimer++;timers.set(id,{fn,at:now+ms});return id;};
 const A={probeFrame:()=>false,prepare(){},prepareOCR(){ocrPrepared++;},setForecastEnabled(){},suspend(){},setReadStatus:(...args)=>status.push(args),invalidate(){},onDesktopChange(){},desktopSnapshot:()=>({}),captureImage:()=>null};
 const C={DEFAULT_RULES:'',CONSENT_VERSION:4,state:{window:deferConnect?'off':'on',log:'on'},on:(name,fn)=>handlers[name]=fn,setReadinessProbe(){},setRules(){},setWatch(){},setPace(){},agreed:()=>true,useHandle(){},stopWindow(){C.state.window='off';},stopLog(){},connectWindow:()=>deferConnect?new Promise(r=>connections.push(r)):Promise.resolve(),captureNow:async(kind,retry)=>{captures.push({kind,retry});await handlers.frame({kind,hits:retry.hits,retryAttempt:retry.attempt,frame:captures.length<=missingCaptures?null:{close(){}}});}};
 const D={fast:true,record(){},follow(){},onLogChanged(){},logStat:async()=>({}),logRead:async()=>new ArrayBuffer(0),riot(){},run(){},trigger(){},setFastSettings(){},onCommand:fn=>commands.command=fn,onGame:fn=>commands.game=fn,onFastSettings:fn=>commands.settings=fn,fastSettings:async()=>settings,game:async()=>({running:true,window:123})};
 const Auto={cancel(){},receive:async(m,reply)=>{reads.push(m);reply({read:reads.length<=failures?{ok:false,pick:true,reason:'Offer is still animating'}:{ok:true,pick:true,names:['Saw']}});}};
 const window={TartarusDesktop:D,TartarusCapture:C,TartarusAnalyzer:A,TartarusAuto:Auto,addEventListener(){}};
 vm.runInNewContext(source,{window,localStorage:{getItem:()=>null,setItem(){}},performance:{now:()=>now},setTimeout:time,clearTimeout:id=>timers.delete(id),setInterval(){},Date,JSON,DOMException,OffscreenCanvas:function(){}});
 const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};await flush();
 await handlers.hit({kind});
 const hits=[{kind,text:'check cur=0',at:'2026.10.23-09.00.00:000'}];
 await handlers.frame({kind,hits,frame:firstMissing?null:{close(){}}});
 async function advance(ms){now+=ms;for(let guard=0;guard<8;guard++){const due=[...timers].filter(([,v])=>v.at<=now);if(!due.length)break;for(const [id,t]of due){timers.delete(id);await t.fn();await flush();}}}
 return {reads,status,captures,handlers,commands,advance,settings,connections,flush,ocrPrepared};
}
(async()=>{
 const recovered=await harness(2);await recovered.advance(250);await recovered.advance(250);
 assert.equal(recovered.reads.length,3);assert.equal(recovered.captures.length,2);
 assert.ok(recovered.reads.every(m=>m.fresh),'Start-of-run metadata lost');
 assert.deepEqual(recovered.reads.map(m=>m.retryOffer),[true,true,true]);
 assert.equal(recovered.status.at(-1)[1].ok,true);
 const exhausted=await harness(99);await exhausted.advance(250);await exhausted.advance(250);await exhausted.advance(99999);
 assert.equal(exhausted.reads.length,3);assert.equal(exhausted.status.at(-1)[1].ok,false);
 const newer=await harness(2);newer.handlers.hit({kind:'board'});await newer.advance(500);assert.equal(newer.captures.length,0);
 const exited=await harness(2);exited.handlers.seen({line:'LogLoad: LoadMap: elsewhere'});await exited.advance(500);assert.equal(exited.captures.length,0);
 const switched=await harness(2);switched.commands.settings({...switched.settings,activeMode:'vorax'});await switched.advance(500);assert.equal(switched.captures.length,0);
 const cold=await harness(0,{firstMissing:true});await cold.advance(250);assert.equal(cold.captures.length,1);assert.equal(cold.reads.length,1);assert.equal(cold.status.at(-1)[1].ok,true);
 const manualCold=await harness(0,{firstMissing:true,kind:'manual'});await manualCold.advance(250);assert.equal(manualCold.reads.length,1);assert.equal(manualCold.status.at(-1)[1].ok,true);
 const objective=await harness(0,{firstMissing:true,kind:'objective'});assert.equal(objective.ocrPrepared,1);await objective.advance(250);assert.equal(objective.reads.length,1);
 const missing=await harness(0,{firstMissing:true,missingCaptures:2});await missing.advance(250);await missing.advance(250);await missing.advance(99999);assert.equal(missing.captures.length,2);assert.equal(missing.reads.length,0);assert.equal(missing.status.at(-1)[0],null);
 const connecting=await harness(0,{deferConnect:true});assert.equal(connecting.connections.length,1);connecting.handlers.seen({line:'LogLoad: LoadMap: other'});connecting.handlers.hit({kind:'board'});assert.equal(connecting.connections.length,2);connecting.connections[0]();await connecting.flush();connecting.handlers.hit({kind:'board'});assert.equal(connecting.connections.length,2,'Stale sharing promise cleared a replacement');connecting.connections[1]();await connecting.flush();
 // The actual Auto module must avoid a multi-second full-board search on
 // the first two explicitly named offer retries and close each input bitmap.
 let full=0,closed=0;const replies=[];
 const C={agreed:()=>true,on(){}};
 const A={readPick:async()=>({ok:false,pick:true,reason:'not settled'}),readFrameDirect:async()=>{full++;return {ok:false,reason:'no board'};}};
 const w={TartarusCapture:C,TartarusAnalyzer:A,TartarusDesktop:{fast:true},addEventListener(){}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/auto.js'),'utf8'),{window:w,document:{hasFocus:()=>false,addEventListener(){},getElementById:()=>null},BroadcastChannel:function(){},setInterval(){},setTimeout,clearTimeout,Date,Math});
 for(let i=0;i<3;i++)await w.TartarusAuto.receive({kind:'instruments',retryOffer:true,bitmap:{close(){closed++;}}},r=>replies.push(r));
 assert.equal(full,0);assert.equal(closed,3);assert.equal(replies[0].read.retryable,true);
 console.log('PASS: bounded cold/missing-frame and picture retries, early objective OCR, original offer metadata, final failure, new-event/exit/mode cancellation, stale-share fences, no wrong-screen full-board search and bitmap cleanup.');
})().catch(e=>{console.error(e);process.exitCode=1;});
