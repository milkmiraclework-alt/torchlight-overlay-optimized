'use strict';
// Run the real worker/reader on saved pixels; no live window is captured.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const at=process.argv.indexOf('--frame');if(at<0)throw Error('Supply --frame <saved RGBA prefix>');
const prefix=path.resolve(process.argv[at+1]),good={...JSON.parse(fs.readFileSync(prefix+'.json','utf8').replace(/^\uFEFF/,'')),data:new Uint8ClampedArray(fs.readFileSync(prefix+'.rgba'))};
const bad={width:640,height:360,data:new Uint8ClampedArray(640*360*4).fill(70)};
const root=path.resolve(__dirname,'../desktop/lib/arcana'),source=fs.readFileSync(path.join(root,'worker.js'),'utf8');
function session(native){
 const port=new EventEmitter(),messages=[],timers=new Map();let timerId=0,grabs=0;
 port.postMessage=m=>messages.push(m);
 const capture={create:()=>1,size:(_h,size)=>{size.set([native.width,native.height]);return 1;},grab:(_h,data)=>{grabs++;data.set(native.data);return data.length;},destroy(){}};
 vm.runInNewContext(source,{require:name=>name==='node:worker_threads'?{parentPort:port,workerData:{library:'owned-test.dll',hwnd:123}}:name==='../native-reader-kernels'?{create:()=>({capture})}:name.startsWith('.')?require(path.join(root,name)):require(name),performance,structuredClone,Uint8ClampedArray,Int32Array,process:{once(){}},setImmediate:()=>{} /* Calculation is covered by the actual-worker regression. */,setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)});
 return {send:m=>port.emit('message',m),messages,timers,grabs:()=>grabs,reply(img){const req=messages.filter(m=>m.event==='fallback').at(-1);assert(req);port.emit('message',{cmd:'frame',frame:img,requestRevision:req.requestRevision});}};
}
const s=session(bad);s.send({cmd:'read'});
assert.equal(s.messages.at(-1).event,'fallback','Bright native frame with no anchors did not request independent capture');
s.reply(good);
let status=s.messages.filter(m=>m.event==='status'&&m.state.phase==='thinking').at(-1)?.state;
assert(status?.model.hand.length>0,'Independent saved frame did not recover hand');assert.notEqual(status.model.die,null);assert.notEqual(status.model.life,null);assert.equal(status.recognition.capture,'fallback');
assert.equal(status.model.confirmed,true,'Complete visible frame still requires manual setup');assert.equal(status.model.localHorizon,true);assert.equal(status.model.lengthConfirmed,false,'A relative planning window became a real path length');
s.send({cmd:'read'});assert.equal(s.grabs(),1,'Successful fallback was not retained for subsequent reads');
const stale=s.messages.at(-1).requestRevision;s.send({cmd:'invalidate'});const before=s.messages.length;s.send({cmd:'frame',frame:good,requestRevision:stale});assert.equal(s.messages.length,before,'Stale fallback changed state');
const direct=session(good);direct.send({cmd:'read'});assert.equal(direct.messages.some(m=>m.event==='fallback'),false,'Readable native picture used unnecessary fallback');
const empty=session(bad);empty.send({cmd:'read'});
for(let n=0;n<3;n++){empty.reply(bad);if(n<2){assert.equal(empty.timers.size,1);const [id,fn]=empty.timers.entries().next().value;empty.timers.delete(id);fn();}}
assert.equal(empty.messages.filter(m=>m.event==='fallback').length,3);assert.equal(empty.timers.size,0,'Empty screen caused an unbounded capture loop');
console.log('PASS: bright unusable native picture falls back to saved game pixels; hand/die/life recover, working capture persists, complete visible boards start automatic local planning, stale-frame guards remain, empty-screen retries stop at three.');
