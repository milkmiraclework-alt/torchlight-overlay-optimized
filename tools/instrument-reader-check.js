/* Actual OCR input/cancellation functions; no real game or image capture. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const T=require('../js/engine.js'),S=require('../js/solver.js');
let recognize, calls=0;
const window={Tartarus:T,TartarusSolver:S,TartarusDesktop:{fast:true},Tesseract:{createWorker:async()=>({recognize:(...args)=>{calls++;return recognize(...args);}})},addEventListener(){}};
function canvas(){return {width:0,height:0,toBlob(){throw new Error('Idle PNG encoder used');},getContext(){const c=this;return {drawImage(){},getImageData(){const data=new Uint8ClampedArray(c.width*c.height*4);for(let i=0;i<data.length;i+=4){data[i]=71;data[i+1]=83;data[i+2]=97;data[i+3]=255;}return {data};}};}};}
const element=()=>({classList:{toggle(){},add(){},remove(){}},replaceChildren(){},addEventListener(){}});
const context=vm.createContext({window,document:{currentScript:null,createElement:()=>canvas(),getElementById:()=>element(),hasFocus:()=>false},navigator:{hardwareConcurrency:2},localStorage:{getItem:()=>null},TextEncoder,Uint8Array,Uint8ClampedArray,setTimeout,clearTimeout,queueMicrotask,performance,console,Date,Math,BroadcastChannel:class{}});
const source=fs.readFileSync(require.resolve('../js/analyze.js'),'utf8').replace(/\r\n/g,'\n'),init='  buildBoard();\n  bind();\n  render();';assert.ok(source.includes(init));
vm.runInContext(source.replace(init,'  window.checkReader = { ocrPixels, readCardNames, readPick, cancelPickRead, reader, pickReadingIssue };'),context);
const A=window.checkReader;
const raw={width:2,height:1,getContext:()=>({getImageData:()=>({data:new Uint8ClampedArray([17,29,43,255,90,120,150,255])})})};
assert.deepEqual(Buffer.from(A.ocrPixels(raw)),Buffer.concat([Buffer.from('P6\n2 1\n255\n'),Buffer.from([17,29,43,90,120,150])]));
const names=['Forged Key','Long-Chained Shackles',"Hangman's Noose"];
function bytes(input){assert.ok(ArrayBuffer.isView(input));assert.equal(Buffer.from(input).subarray(0,3).toString(),'P6\n');}
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
(async()=>{
 recognize=async input=>{bytes(input);return {data:{text:names[(calls-1)%3]}};};
 const read=await A.readCardNames({width:1920,height:1080},1);
 assert.equal(read.map(n=>n.id).join(),'forged,shackles,rope');assert.equal(calls,3);
 const certain=['axe','forged','muzzle'].map(sim=>({sim,conf:1,by:'name'}));
 assert.equal(A.pickReadingIssue({cards:certain}),'');
 assert.ok(A.pickReadingIssue({cards:[certain[0],certain[1],certain[1]]}),'Duplicate names were accepted');
 assert.ok(A.pickReadingIssue({cards:[{sim:'shackles',conf:.45,score:.89,margin:.005,by:'art'},certain[1],certain[2]]}),'A missing, uncertain Shackles was advised');
 assert.ok(A.pickReadingIssue({cards:[{sim:'shackles',conf:1,score:.97,margin:.01,by:'art'},certain[1],certain[2]]}),'A small-margin art match bypassed the guard');
 A.reader.worker={postMessage(m){queueMicrotask(()=>{const done=A.reader.picks.get(m.id);A.reader.picks.delete(m.id);done({ok:true,ui:1,cards:[{sim:'shackles',conf:.4,score:.88,margin:.005},{sim:'forged',conf:1,score:.99,margin:.1},{sim:'dogtag',conf:.7,score:.93,margin:.015}],ms:1});});}};
 recognize=async input=>{bytes(input);return {data:{text:''}};};
 const uncertain=await A.readPick({width:1920,height:1080});assert.equal(uncertain.ok,false);assert.equal(uncertain.instrumentReading,true);assert.equal(uncertain.retryable,true);assert.equal(uncertain.unsure,2);
 let valid=true,finish;
 recognize=input=>{bytes(input);return new Promise(resolve=>{finish=resolve;});};
 const pending=A.readCardNames({width:1920,height:1080},1,()=>valid);await flush();assert.ok(finish);const before=calls;valid=false;finish({data:{text:names[0]}});assert.equal(await pending,null);assert.equal(calls,before,'Cancelled OCR queued the other two titles');
 A.reader.worker={postMessage(m){queueMicrotask(()=>{const done=A.reader.picks.get(m.id);A.reader.picks.delete(m.id);done({ok:true,ui:1,cards:['forged','shackles','rope'].map(sim=>({sim,conf:1})),ms:1});});}};
 let closed=0,reported=0;finish=null;
 window.TartarusAnalyzer={readPick:A.readPick,cancelPickRead:A.cancelPickRead};window.TartarusCapture={agreed:()=>true};
 vm.runInContext(fs.readFileSync(require.resolve('../js/auto.js'),'utf8'),context);
 const auto=window.TartarusAuto.receive({kind:'instruments',bitmap:{width:1920,height:1080,close(){closed++;}}},()=>{reported++;});
 await flush();assert.ok(finish,'Actual readPick did not reach OCR');window.TartarusAuto.cancel();
 await Promise.race([auto,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Cancellation waited on OCR')),200))]);
 assert.equal(closed,1);assert.equal(reported,0);const count=calls;finish({data:{text:names[0]}});await flush();assert.equal(calls,count,'Cancelled actual offer queued more OCR');
 console.log('PASS: exact RGB bytes and three actual names without PNG; weak, duplicate and ambiguous art offers block advice and request a fresh picture; stale title loop stops and cancellation releases its bitmap before unfinished OCR resolves.');
})().catch(e=>{console.error(e);process.exitCode=1;});
