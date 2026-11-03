'use strict';
// Reference-generated boards plus independently written animation sequences;
// optional existing real logs and saved pixels. No live capture or game input.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const Route=require('../desktop/lib/arcana/route-log'),Reference=require('../desktop/lib/arcana/timer-reader/route-engine');
const colours=['','green','blue','purple','orange','red','rainbow'],patterns={};
for(const mode of Object.keys(Route.lengths)){
 const result=patterns[mode]={confirmed:0,wrong:0,ambiguous:0};
 for(let seed=1;seed<=100;seed++){
  const board=Reference.makeBoard(mode,Reference.makeRng(seed));
  for(const n of [16,20,32,board.length]){
   const cells=board.slice(0,n),looks=cells.map((t,i)=>[i+1,t.type==='chest'?'chest':['trap','life','question'].includes(t.type)?'icon':'plain']);
   const chests=cells.flatMap((t,i)=>t.type==='chest'?[[i+1,colours.indexOf(t.rarity)]]:[]);
   const r=Route.infer({anchored:true,position:1,total:cells.length,looks},chests);
   if(!r.confirmed)result.ambiguous++;else{result.confirmed++;if(r.type!==mode)result.wrong++;assert.equal(r.type,mode);assert.equal(r.length,board.length);}
  }
 }
 assert.equal(result.wrong,0);assert(result.confirmed>=350,'Mode never became usable automatically');
}
const log=Route.create(),lines=['S9Taro Run'];
for(let i=0;i<16;i++){
 const id=1000+i*10;lines.push(`[Game] ${id}_S9TileIcon Anim_Loop Start`);
 if(i%4===0)lines.push(`[Game] ${id+1}_S9TileIcon Anim_Loop Start`);
 if(i%8===0)lines.push(`Animation not found! Name = Anim_Loop, Id = ${id+1}_S9TileIcon`);
}
assert(log.feed(lines));const initial=log.snapshot();assert(initial.prefixAnchored);assert.equal(initial.anchored,false,'Opening the path claimed tile1 before seeing the marker');assert.equal(initial.total,16);assert.equal(initial.looks[0][1],'chest');assert.equal(initial.looks[4][1],'icon');assert.equal(initial.looks[1][1],'plain');
log.feed(['S9Taro HandleOrderAni Start Step=1 Type=Move','[Game] 900_S9LineShort Anim_D Start','[Game] 901_S9LineShort Anim_D Start','[Game] 902_S9LineShort Anim_Light Start','[Game] 1020_S9TileIcon Anim_Show02 Start','S9Taro HandleOrderAni All done']);
assert.equal(log.snapshot().position,3);assert(log.snapshot().used.includes(3));assert.equal(log.snapshot().moves,1);
const reopened=Route.create();reopened.feed(['S9Taro Run',...Array.from({length:24},(_,i)=>`[Game] ${2000+i*10}_S9TileIcon Anim_Loop Start`)]);assert.equal(reopened.snapshot().anchored,false,'A reopened viewport was silently assumed to start at tile1');
const fresh=Route.create();fresh.feed(['ProtoId = 5551','S9Taro Run',...Array.from({length:24},(_,i)=>`[Game] ${3000+i*10}_S9TileIcon Anim_Loop Start`)]);assert.equal(fresh.snapshot().anchored,true,'An explicit new-run event lost its position anchor');
assert.equal(Route.infer({...initial,anchored:false}).confirmed,false);assert.equal(Route.infer({...initial,position:null}).confirmed,false);
const frameAt=process.argv.indexOf('--frame');let savedFrame=null;
if(frameAt>=0){
 const prefix=path.resolve(process.argv[frameAt+1]),img={...JSON.parse(fs.readFileSync(prefix+'.json')),data:fs.readFileSync(prefix+'.rgba')};
 // Manually labelled reference screenshot: current tile42, one green chest46.
 const board={epoch:1,anchored:true,position:42,total:56,looks:[[37,'icon'],[38,'icon'],[39,'icon'],[40,'plain'],[42,'plain'],[43,'plain'],[44,'icon'],[45,'plain'],[46,'chest'],[47,'plain'],[48,'icon'],[49,'icon'],[50,'plain'],[52,'icon'],[53,'plain']]};
 const reader=require('../desktop/lib/arcana/reader').create();reader.setLogBoard(board);const parsed=reader.read(img);
 assert.equal(parsed.model.position,41);assert.equal(parsed.model.positionConfirmed,true);assert.equal(parsed.model.pathMode.type,'normal');assert.equal(parsed.model.path.length,80);assert.equal(parsed.model.lengthConfirmed,true);assert.equal(parsed.model.confirmed,true,parsed.issues.join(' '));assert.equal(reader.marks().find(m=>m.current).label,'42');
 const restored=require('../desktop/lib/arcana/reader').create();restored.restore(reader.checkpoint());assert.deepEqual(restored.checkpoint().logBoard,board);
 reader.setLogBoard({...board,revision:1,moves:1,position:43});
 const changed={...img,data:Buffer.from(img.data)};changed.data[0]^=1;
 const stale=reader.read(changed);assert.equal(stale.waiting,true,'An old picture with a new log position produced local advice');assert.equal(stale.model.confirmed,false);assert(stale.issues.some(s=>s.includes('current game position')));
 assert.equal(reader.state().frameKey,null,'An edit for the previous position remained confirmable');
 savedFrame={position:42,totalLength:80,manualCorrectionRequired:false,marksUseActualTileNumbers:true};
}
const sessionAt=process.argv.indexOf('--session');let realLog=null;
if(sessionAt>=0){const file=path.resolve(process.argv[sessionAt+1]),r=Route.create();r.feed(fs.readFileSync(file,'utf8').split(/\r?\n/));const b=r.snapshot(),mode=Route.infer(b);assert(b.anchored);assert.equal(b.position,78);assert.equal(mode.type,'normal');assert.equal(mode.length,80);assert(mode.confirmed);realLog={source:path.basename(file),position:b.position,seen:b.total,type:mode.type,length:mode.length};}
fs.writeFileSync(path.join(__dirname,'results/arcana-route.json'),JSON.stringify({version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),patterns,generatedCases:2000,syntheticAnimationTracking:true,unanchoredLogRejected:true,invalidPositionRejected:true,savedFrame,realLog,gameCapture:false,gameInput:false},null,2)+'\n');
console.log('PASS: five route modes/2000 reference-generated observations, exact animation tracking, unanchored-log guard, automatic saved-frame position/length/labels and optional real log replay.');
