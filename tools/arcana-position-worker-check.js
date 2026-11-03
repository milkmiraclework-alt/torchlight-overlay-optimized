'use strict';
// Execute the actual reader/solver worker against one previously recorded
// JPEG. Acknowledging its anchor must not trigger another screenshot/read.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
if(!process.versions.electron){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const r=cp.spawnSync(require('../desktop/node_modules/electron'),[__filename,...process.argv.slice(2)],{env,encoding:'utf8',windowsHide:true});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exit(r.status??1);}
const {app,nativeImage}=require('electron'),{Worker}=require('node:worker_threads');
const dir=path.resolve(__dirname,'../sandbox/arcana-position-worker-'+process.pid);fs.mkdirSync(dir,{recursive:true});app.setPath('userData',path.join(dir,'profile'));app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const at=process.argv.indexOf('--session');if(at<0)throw Error('Supply --session <existing saved session>');
 const session=path.resolve(process.argv[at+1]),name=path.basename(session),shots=path.join(session,'arcana-shots-'+name),first=JSON.parse(fs.readFileSync(path.join(shots,'shots.json')))[0],time=Date.parse(first.time),Route=require('../desktop/lib/arcana/route-log'),{logTime}=require('../desktop/lib/arcana/timer-reader/log');
 const route=Route.create(),lines=fs.readFileSync(path.join(session,'arcana-live-'+name+'.log'),'utf8').split(/\r?\n/).filter(line=>logTime(line)!==null&&logTime(line)<=time);route.feed(lines);const opened=route.snapshot();assert(opened.prefixAnchored&&!opened.anchored);assert.equal(opened.total,16);
 const image=nativeImage.createFromPath(path.join(shots,first.file)),size=image.getSize(),pixels=image.toBitmap();for(let i=0;i<pixels.length;i+=4){const r=pixels[i];pixels[i]=pixels[i+2];pixels[i+2]=r;pixels[i+3]=255;}const fixtureAt=process.argv.indexOf('--fixture-out'),prefix=fixtureAt<0?path.join(dir,'saved'):path.resolve(process.argv[fixtureAt+1]);fs.mkdirSync(path.dirname(prefix),{recursive:true});fs.writeFileSync(prefix+'.json',JSON.stringify(size));fs.writeFileSync(prefix+'.rgba',pixels);if(fixtureAt>=0)fs.writeFileSync(prefix+'.log',lines.join('\n')+'\n');
 const worker=new Worker(path.resolve(__dirname,'../desktop/lib/arcana/worker.js'),{workerData:{fixture:prefix,logBoard:opened}}),states=[];let error=null,anchors=0,accepted;
 worker.on('error',e=>error=e);worker.on('message',message=>{
  if(message.event==='status')states.push(message.state);
  if(message.event==='position-anchor'){
   try{anchors++;assert.equal(message.value.position,1);assert(route.anchor(message.value));accepted=route.snapshot();worker.postMessage({cmd:'position-accepted',value:accepted});}catch(e){error=e;}
  }
 });
 try{
  worker.postMessage({cmd:'read'});let advice;
  for(let i=0;i<1000&&!advice;i++){if(error)throw error;advice=states.find(s=>s.phase==='advice');if(!advice)await new Promise(r=>setTimeout(r,30));}
  assert(advice,'The worker did not solve the automatically aligned board');assert.equal(anchors,1);assert.equal(advice.logRevision,accepted.revision);assert(advice.model.confirmed&&advice.model.positionConfirmed&&advice.model.lengthConfirmed);assert.equal(advice.model.position,0);assert.equal(advice.model.path.length,80);
  const aligned=states.find(s=>s.reason==='Aligning the visible path with the game log.');assert(aligned);assert.equal(advice.readingMs,aligned.readingMs,'Accepting the anchor repeated the image recognition');assert(!states.some(s=>s.phase==='check'),'Automatic alignment requested manual correction');
  const report={version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),frame:first.file,actualReaderAndSolverWorker:true,automaticPosition:1,inferredLength:80,anchorAcknowledged:true,noSecondReadAfterAcknowledgement:true,noManualCorrection:true,gameCapture:false,gameInput:false};fs.writeFileSync(path.join(__dirname,'results/arcana-position-worker.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS: saved JPEG → actual reader → host anchor acknowledgement → actual solver advice; no manual edit or second recognition.');
 }finally{await worker.terminate();}
 app.exit();
}).catch(e=>{console.error(e);app.exit(1);});
