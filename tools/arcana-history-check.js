'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const History=require('../desktop/lib/arcana/log-history'),Arcana=require('../desktop/lib/arcana-runtime'),Suite=require('../desktop/lib/unified-runtime');
const root=path.resolve(__dirname,'../sandbox/arcana-history-'+process.pid);fs.mkdirSync(root,{recursive:true});
const prefix=['S9Taro Run',...Array.from({length:16},(_,i)=>`[Game] ${1000+i*10}_S9TileIcon Anim_Loop Start`),'S9Taro HandleOrderAni Start Step=1 Type=Move','[Game] 900_S9LineShort Anim_D Start','[Game] 901_S9LineShort Anim_D Start','[Game] 902_S9LineShort Anim_Light Start','[Game] 1020_S9TileIcon Anim_Show02 Start','S9Taro HandleOrderAni All done'];
const noise='unrelated padding line\n'.repeat(20000),cases=[];
for(const encoding of ['utf8','utf16le']){
 const dir=path.join(root,encoding);fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'UE_game.log');fs.writeFileSync(file,Buffer.from((encoding==='utf16le'?'\uFEFF':'')+noise+prefix.join('\n')+'\n'+noise,encoding));
 const workers=[];class Fake extends EventEmitter{constructor(_file,options){super();this.options=options;this.messages=[];workers.push(this);}postMessage(m){this.messages.push(m);}terminate(){return Promise.resolve(0);}}
 const arcana=Arcana.create({game:()=>({window:123}),library:'owned-missing.dll',WorkerClass:Fake,notify(){}}),config={mode:'auto',consent:{version:4}};
 const suite=Suite.create({executable:'owned-missing.exe',config:()=>config,game:()=>({running:true,window:123}),arcana,userData:dir,notify(){},note(){},spawnWorker(){throw Error('Unexpected native backend in Arcana history test');}});
 try{
  suite.setLog(file);assert.equal(suite.mode,'arcana','The opening outside the live256KB tail was lost');assert.equal(arcana.info().history.position,3);assert.equal(arcana.info().history.moves,1);assert(arcana.info().history.bytes>262144);
  suite.manual();const worker=workers[0];assert(worker);assert.equal(worker.options.workerData.logBoard.position,3);assert(worker.options.workerData.logBoard.used.includes(3));
  const next=['S9Taro HandleOrderAni Start Step=1 Type=Move','[Game] 910_S9LineShort Anim_D Start','[Game] 911_S9LineShort Anim_Light Start','S9Taro HandleOrderAni All done'].join('\n');
  const bytes=Buffer.from(next,encoding);fs.appendFileSync(file,bytes.subarray(0,bytes.length-1));suite.poll();fs.appendFileSync(file,Buffer.concat([bytes.subarray(bytes.length-1),Buffer.from('\n',encoding)]));suite.poll();
  const live=worker.messages.filter(m=>m.cmd==='log-state').at(-1).value;assert.equal(live.position,4,'Catch-up duplicated a move or lost a split encoded line');assert.equal(live.moves,2);
  const before=fs.statSync(file),identity=before.ino+':'+before.birthtimeMs;fs.appendFileSync(file,Buffer.from('S9Taro Hide\n',encoding));const fenced=History.read(file,{end:before.size,identity});assert.equal(fenced.mode,'arcana','The byte fence included later events');assert.equal(History.read(file).mode,'idle');
  const bounded=History.read(file,{maxBytes:2048});assert(bounded.bytes<=2048);assert.equal(History.read(file,{identity:'stale-file'}),null);assert.equal(History.read(file,{end:fs.statSync(file).size+1}),null);
  assert.equal(arcana.primeLog({file:path.join(dir,'not-a-log')}),null,'A missing log escaped the fallback');cases.push({encoding,restoredPosition:3,continuedPosition:4,moves:2,historyBytes:arcana.info().history.bytes,duplicateMoves:0});
 }finally{suite.close();}
}
const report={version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),cases,openingOutsideLiveTailRestored:true,exactByteFence:true,partialUtf8AndUtf16Preserved:true,invalidFileIdentityRejected:true,boundedHistory:true,gameCapture:false,gameInput:false};fs.writeFileSync(path.join(__dirname,'results/arcana-history.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS: Arcana catch-up beyond256KB, exact live-tail boundary, no duplicate moves, UTF8/UTF16 split lines and bounded/missing/rotated-log guards.');
