'use strict';
// Optional integration against an existing, explicitly supplied saved frame.
// Never captures a window and never distributes the source screenshot.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const R=require('../desktop/lib/arcana/reader'),V=require('../desktop/lib/arcana/vision');
const at=process.argv.indexOf('--frame');if(at<0)throw Error('Supply --frame <RGBA fixture prefix> (the labelled tile-42 Arcana frame)');
const prefix=path.resolve(process.argv[at+1]),source={...JSON.parse(fs.readFileSync(prefix+'.json','utf8').replace(/^\uFEFF/,'')),data:fs.readFileSync(prefix+'.rgba')};
if(source.data.length!==source.width*source.height*4)throw Error('Invalid saved frame');
function resize(img,scale){if(scale===1)return {...img,data:Buffer.from(img.data)};const width=Math.round(img.width*scale),height=Math.round(img.height*scale),data=Buffer.alloc(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const rgb=V.sample(img,Math.min(img.width-1,(x+.5)/scale-.5),Math.min(img.height-1,(y+.5)/scale-.5))||[0,0,0],p=(y*width+x)*4;data[p]=rgb[0];data[p+1]=rgb[1];data[p+2]=rgb[2];data[p+3]=255;}return {width,height,data};}
const cases=[];
for(const scale of [1,.85,1.25]){
 const img=resize(source,scale),r=R.create(),first=r.read(img);
 assert.ok(first.issues.some(s=>s.includes('path length')),'Unconfirmed path type was accepted');
 assert.equal(first.model.life,2,'Incorrect life');assert.equal(first.model.die,1,'Incorrect refill die');assert.deepEqual(first.model.hand,[1,204,213,201],'Incorrect hand order/count/pips');assert.deepEqual(first.model.chests,[3,2,2,1],'Incorrect collected chests');
 assert.throws(()=>r.correct({...r.state(),position:0,confirmed:true,lengthConfirmed:true}),/position does not match/,'A clearly inconsistent manual row was accepted');
 const correction={...r.state(),position:41,confirmed:true,lengthConfirmed:true};r.correct(correction);
 const data=Buffer.from(img.data);data[4]++;
 const next=r.read({...img,data});assert.equal(next.model.position,41,'A changed picture moved the absolute row');assert.equal(next.model.confirmed,true,next.issues.join(' '));assert.deepEqual(next.model.path[45],{kind:'chest',tier:1});
 // Blur can leave a distant animated effect unknown. It must never be
 // confidently relabelled as an empty/other tile. Current landing options
 // still have to be read correctly before automatic advice is allowed.
 assert.ok(['heal','unknown'].includes(next.model.path[50].kind));if(next.model.path[50].kind==='heal')assert.equal(next.model.path[50].amount,1);
 assert.ok(['random','unknown'].includes(next.model.path[37].kind));assert.equal(next.model.path[42].kind,'empty');
 assert.throws(()=>r.correct(correction),/picture changed/,'Stale edits were accepted');
 r.expectChange();const animated=Buffer.from(data);animated[8]++;
 const waiting=r.read({...img,data:animated});assert.equal(waiting.waiting,true,'Unrelated animation must not count as a completed move');assert.equal(waiting.model.confirmed,false);
 r.correct({...r.state(),confirmed:true});
 cases.push({width:img.width,height:img.height,automaticAfterInitialSetup:true,life:2,die:1,hand:[1,204,213,201],collected:[3,2,2,1],positionInternal:41,positionDisplayed:42,knownTiles:next.model.path.filter(t=>t.kind!=='unknown').length,distantHealRecognised:next.model.path[50].kind==='heal',readingMs:next.ms,staleEditRejected:true,animationDoesNotCompleteMove:true});
 console.log(`PASS: saved Arcana frame ${img.width}×${img.height}, absolute tile 42, complete hand/chests, automatic re-read and move/animation guard.`);
}
async function workerCheck(){
 const {Worker}=require('node:worker_threads'),worker=new Worker(path.resolve(__dirname,'../desktop/lib/arcana/worker.js'),{workerData:{fixture:prefix}}),messages=[];let error;
 worker.on('message',m=>messages.push(m));worker.on('error',e=>error=e);
 const wait=async predicate=>{for(let i=0;i<600;i++){if(error)throw error;const found=messages.find(predicate);if(found)return found;await new Promise(r=>setTimeout(r,25));}throw Error('Saved-frame worker timeout');};
 try{
  worker.postMessage({cmd:'read'});const checked=await wait(m=>m.state?.phase==='check');assert.equal(checked.state.model.life,2);
  worker.postMessage({id:1,cmd:'correct',value:{...checked.state.model,position:41,lengthConfirmed:true,confirmed:true}});
  const advice=await wait(m=>m.state?.phase==='advice');assert.equal(advice.state.model.position,41);assert.equal(advice.state.samples,128);
  worker.postMessage({cmd:'read'});await wait(m=>m.state?.phase==='advice'&&m.state.cached===true);
  const before=messages.length;worker.postMessage({cmd:'invalidate',changed:true});worker.postMessage({cmd:'read'});
  for(let i=0;i<400&&!messages.slice(before).some(m=>m.state?.phase==='check');i++){if(error)throw error;await new Promise(r=>setTimeout(r,25));}
  assert.ok(messages.slice(before).some(m=>m.state?.phase==='check'));assert.ok(!messages.slice(before).some(m=>m.state?.phase==='advice'),'Old saved frame produced advice after a move');
 }finally{await worker.terminate();}
 console.log('PASS: actual worker reads saved game frame, solves, reuses identical state and blocks the old frame after a move.');
}
workerCheck().then(()=>fs.writeFileSync(path.resolve(__dirname,'results/arcana-vision.json'),JSON.stringify({version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),scope:'Existing saved game image and in-memory resizes; labelled manually, no capture/input. Resolution checks do not prove arbitrary UI scales or live animation coverage.',gameCapture:false,gameInput:false,actualWorker:true,semanticCache:true,oldFrameBlockedAfterMove:true,cases},null,2)+'\n')).catch(e=>{console.error(e);process.exitCode=1;});
