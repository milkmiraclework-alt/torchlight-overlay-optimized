'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const code=fs.readFileSync(require.resolve('../js/analyze.js'),'utf8');
const start=code.indexOf('  async function readNativeScreen('),end=code.indexOf('\n  function runScan(',start);
assert(start>=0&&end>start);
const fn=code.slice(start,end);
const harness={};vm.runInNewContext(fn+'; globalThis.read=readNativeScreen;',harness);
(async()=>{
 for(const kind of ['instruments','objective','treasure']){
  for(const result of [{ok:true},{ok:false,reason:'No cards in this non-black frame'},{ok:false,skipped:true}]){
   const frame={native:true},bitmap={closed:0,close(){this.closed++;}};
   harness.nativeBitmap=async()=>bitmap;
   const got=await harness.read(frame,async input=>{assert.equal(input,bitmap);return result;},kind);
   assert.equal(got,result);assert.equal(bitmap.closed,1);
   assert.equal(!!frame.unreadable,!result.ok&&!result.skipped,'Unrecognised non-black frame did not request compatible capture');
   if(frame.unreadable)assert.equal(frame.captureFailure,kind);
  }
  for(const stage of ['pixels','reader']){
   const frame={native:true},bitmap={closed:0,close(){this.closed++;}};
   harness.nativeBitmap=async()=>{if(stage==='pixels')throw Error('Injected pixel transfer failure');return bitmap;};
   const result=await harness.read(frame,async()=>{throw Error('Injected OCR failure');},kind);
   assert.equal(result.ok,false);assert(frame.unreadable);assert.equal(frame.captureFailure,kind);assert(result.retryable);
   assert.equal(bitmap.closed,stage==='pixels'?0:1);
  }
 }
 for(const [name,kind]of [['readPick','instruments'],['readObjective','objective'],['readTreasure','treasure']])
  assert(code.includes(`return readNativeScreen(source, ${name}, '${kind}')`),name+' bypasses the fallback guard');
 console.log('PASS: native instrument/objective/treasure failures request compatible capture; successful/cancelled reads retain native capture; pixel/OCR failures close owned bitmaps and remain retryable.');
})().catch(error=>{console.error(error);process.exitCode=1;});
