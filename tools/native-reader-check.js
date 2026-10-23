'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{Worker}=require('node:worker_threads');
const {EventEmitter}=require('node:events');
const root=path.resolve(__dirname,'..'),koffi=require('../desktop/node_modules/koffi');
const {kernels}=require('../desktop/lib/native-reader-kernels').create(path.join(root,'desktop/native/tartarus-reader.dll'),koffi);
const S=require('../js/scan'),A=require('../js/scan-accelerator');
require('./native-reader-manifest');
const ref=S.withPanelIcons(require('../js/scan-data'),require('../js/pick-data'));
const clean=r=>{r=structuredClone(r);delete r.ms;return r;};
(async()=>{
  const wasm=A.create((await WebAssembly.instantiate(fs.readFileSync(path.join(root,'js/scan-kernels.wasm')))).instance);
  for(const [w,h]of [[1,1],[31,17],[73,51]]){
    const img={width:w,height:h,data:Uint8ClampedArray.from({length:w*h*4},(_,i)=>i*73%256)};
    assert.deepEqual(kernels.preparePixels(img),wasm.preparePixels(img));
    for(const r of [1,3,9])assert.deepEqual(kernels.blur(S.grayOf(img),w,h,r),wasm.blur(S.grayOf(img),w,h,r));
    for(const saturation of [.2,.5,1.01])assert.deepEqual(kernels.textComponents({rgba:img.data,w,h,x0:3.25,y0:-7.5},3,saturation),wasm.textComponents({rgba:img.data,w,h,x0:3.25,y0:-7.5},3,saturation));
  }
  for(let bits=0;bits<512;bits++){
    const a=Uint8Array.from({length:9},(_,i)=>bits>>>i&1),b=a.slice();
    assert.deepEqual(kernels.maskBlobs(a,3,3,2,-4),wasm.maskBlobs(b,3,3,2,-4));assert.deepEqual(a,b);
  }
  for(const [width,height]of [[160,100],[640,360]])for(const uniform of [false,true]){
    const img={width,height,data:Uint8ClampedArray.from({length:width*height*4},(_,i)=>uniform?73:i*17%251)};
    S.setKernels(wasm);const prepared=S.prepareBoardSearch(img,S.grayOf(img),ref),expected=S.coarseBoardSearch(prepared);
    S.setKernels(kernels);assert.deepEqual(S.coarseBoardSearch(prepared),expected,'Native SSE2 search changed clipping, score order or tied winners');
  }
  class FakeWorker extends EventEmitter{postMessage(m){this.last=m;}terminate(){this.ended=true;return Promise.resolve();}}
  let allowed=true,lastWorker;
  class Owned extends FakeWorker{constructor(){super();lastWorker=this;}}
  const runtime=require('../desktop/lib/native-reader').create({site:root,library:'unused',allowed:()=>allowed,WorkerClass:Owned});
  const waiting=runtime.request('grab');const stale=lastWorker;runtime.stop();await assert.rejects(waiting,/stopped/);assert(stale.ended);assert.equal(runtime.info().pending,0);
  allowed=false;await assert.rejects(runtime.request('grab'),/disabled/);assert(!runtime.info().running);
  allowed=true;
  const connected=runtime.request('connect');lastWorker.emit('message',{id:lastWorker.last.id,result:true});const session=(await connected).session;
  runtime.stop();
  const fresh=runtime.request('connect');lastWorker.emit('message',{id:lastWorker.last.id,result:true});await fresh;
  await assert.rejects(runtime.request('release',{session,token:1}),/session expired/);
  assert(runtime.info().running,'An old frame stopped the new capture session');
  stale.emit('error',Error('late old worker error'));assert(runtime.info().running);
  const crashed=runtime.request('grab');lastWorker.emit('error',Error('injected current failure'));await assert.rejects(crashed,/stopped/);
  assert(!runtime.info().running);assert.equal(runtime.info().pending,0);
  const folderAt=process.argv.indexOf('--frames');
  if(folderAt>=0){
    const folder=path.resolve(process.argv[folderAt+1]);
    for(const name of fs.readdirSync(folder).filter(f=>f.endsWith('.webp.json'))){
      const file=path.join(folder,name.slice(0,-5)),meta=JSON.parse(fs.readFileSync(file+'.json'));
      const img={...meta,data:new Uint8ClampedArray(fs.readFileSync(file+'.rgba'))};
      S.setKernels(wasm);const start=performance.now(),expected=S.scan(img,ref,{lang:'en'}),wasmMs=performance.now()-start;
      S.setKernels(kernels);const n=performance.now(),actual=S.scan(img,ref,{lang:'en'}),nativeMs=performance.now()-n;
      assert.deepEqual(clean(actual),clean(expected),name+' native recognition changed');
      const worker=new Worker(path.join(root,'desktop/lib/native-reader-worker.js'),{workerData:{site:root,library:path.join(root,'desktop/native/tartarus-reader.dll'),fixture:file}});
      const jobs=new Map();let seq=0;
      const ask=(cmd,args={})=>new Promise((resolve,reject)=>{const id=++seq;jobs.set(id,{resolve,reject});worker.postMessage({id,cmd,...args});});
      worker.on('message',m=>{const job=jobs.get(m.id);if(job){jobs.delete(m.id);m.error?job.reject(Error(m.error)):job.resolve(m.result);}});
      try{
        const first=await ask('read',{token:1}),second=await ask('read',{token:1});
        // Runtime decoration adds simulator names; pure cell/panel readings must agree.
        // Compare every semantic field; runtime-only decoration is verified below.
        for(const field of ['loc','cells','warden','doors','days','badge','chromatic','objective','chain','decision','statusView','notes'])assert.deepEqual(first.result[field],expected[field],name+': '+field);
        const tools=structuredClone(expected.tools);
        if(tools?.tools){for(const t of tools.tools){Object.assign(t,ref.toolNames[t.id]||{});for(const alt of t.alts||[])alt.sim=ref.toolNames[alt.id]?.sim;}tools.sims=[...new Set(ref.tools.map(r=>ref.toolNames[r.id]?.sim).filter(Boolean))];}
        assert.deepEqual(first.result.tools,tools,'Instrument identity/confidence decoration changed');
        assert.deepEqual(first,second,'Same immutable frame changed');
        const probe=await ask('probe',{token:1,epoch:11});assert.equal(probe.ready,false,'Unchanged screen accepted as next move');
        const pixels=await ask('pixels',{token:1});assert.deepEqual(new Uint8ClampedArray(pixels.buffer),img.data);
        await ask('release',{token:1});await assert.rejects(ask('read',{token:1}),/expired/);
        console.log(JSON.stringify({frame:name,wasmMs,nativeMs}));
      }finally{await worker.terminate();}
    }
  }
  console.log('PASS: native Rust/Win32 reader kernels, exact masks/gray/blur/text, worker lifecycle, consent, saved-frame reading and unchanged-frame rejection.');
})().catch(e=>{console.error(e);process.exitCode=1;});
