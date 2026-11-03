'use strict';
// Pure reader timing inside the shipped Electron VM, on existing RGBA files.
// No Electron app/windows, game capture, network or game input are started.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),crypto=require('node:crypto');
if(!process.versions.electron){const child=cp.spawnSync(require('../desktop/node_modules/electron'),[__filename,...process.argv.slice(2)],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,stdio:'inherit'});process.exit(child.status??1);}
try{require('node:os').setPriority(0,10);}catch{}
const V=require('../desktop/lib/arcana/vision'),G=require('../desktop/lib/arcana/geometry'),F=require('../desktop/lib/arcana/fast-hand');
const frames=process.argv.flatMap((arg,i)=>arg==='--frame'?[path.resolve(process.argv[i+1])]:[]);assert(frames.length,'Supply saved --frame <RGBA prefix>');
const cases=[],samples=7,median=xs=>xs.slice().sort((a,b)=>a-b)[Math.floor(xs.length/2)];
for(const prefix of frames){
 const label=path.basename(prefix);assert(['user-193821','user-222100','user-222106','user-222112','reference-play'].includes(label),'No independent labels for '+label);
 const img={...JSON.parse(fs.readFileSync(prefix+'.json','utf8')),data:fs.readFileSync(prefix+'.rgba')},expected=label==='reference-play'?[1,204,213,201]:label==='user-193821'?[13]:[22,13,4,21],die=label==='reference-play'?1:6;
 const fast=F.create(),grid=G.grid(V.findBases(img));
 const check=result=>{assert(result);assert.equal(result.handConfident,true);assert.deepEqual(result.hand,expected);assert.equal(result.die,die);};
 check(fast.read(img,grid));check(V.cards(img));
 const trained=[],templates=[];
 for(let trial=0;trial<samples;trial++)for(const kind of trial%2?['templates','trained']:['trained','templates']){
  const start=performance.now(),result=kind==='trained'?fast.read(img,grid):V.cards(img),ms=performance.now()-start;check(result);(kind==='trained'?trained:templates).push(ms);
 }
 cases.push({frame:label,width:img.width,height:img.height,hand:expected,die,trainedMedianMs:median(trained),templateMedianMs:median(templates),ratio:median(templates)/median(trained),trainedMs:trained,templateMs:templates});
}
const files=['desktop/lib/arcana/fast-hand.js','desktop/lib/arcana/digits.js','desktop/lib/arcana/vision.js','desktop/lib/arcana/timer-reader/source.json'];
const sourceSha256=Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'..',file))).digest('hex')]));
const report={version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),electron:process.versions.electron,node:process.versions.node,samplesPerMethod:samples,method:'Alternating method order, one warm-up per method; calibrated hand and refill only. Existing saved pixels, independently labelled hand/die. No complete-screen/advice latency, FPS or quality inference.',sourceSha256,cases,gameCapture:false,gameInput:false};
fs.writeFileSync(path.join(__dirname,'results/arcana-performance.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS: '+cases.length+' labelled frames, '+samples+' alternating warm trials per reader in Electron '+process.versions.electron+'.');console.log(JSON.stringify(cases.map(({frame,trainedMedianMs,templateMedianMs,ratio})=>({frame,trainedMedianMs,templateMedianMs,ratio}))));
