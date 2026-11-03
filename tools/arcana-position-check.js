'use strict';
// Independent game-grid coordinates and reference-generated appearances.
// Existing images/logs only; no capture, live game or input automation.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Route=require('../desktop/lib/arcana/route-log'),R=require('../desktop/lib/arcana/timer-reader/route-engine');
const coarse=t=>t.type==='chest'?'chest':['trap','life','question'].includes(t.type)?'icon':'plain';
const tile=t=>t.type==='chest'?{kind:'chest',tier:1}:t.type==='trap'?{kind:'trap'}:t.type==='life'?{kind:'heal'}:t.type==='question'?{kind:'random'}:['movement','upgrade'].includes(t.type)?{kind:'effect'}:{kind:'empty'};
const xy=(index,firstRow)=>{const row=Math.floor(index/4),column=row%2?index%4:3-index%4;return {x:500+80*column+110*(row-firstRow),y:450+46*column-64*(row-firstRow)};};
const grid=row=>({origin:{x:500,y:450},u:{x:80,y:46},v:{x:110,y:-64},width:82,count:16,first:32+(row%2?4:0),relative:true,trusted:true});
const firstRows=[];
for(let position=1;position<=4;position++){
 const b={anchored:false,prefixAnchored:true,total:16,looks:Array.from({length:16},(_,i)=>[i+1,'plain'])},obs=Array.from({length:16},(_,i)=>({p:xy(i,0),tile:{kind:'empty'}}));
 const aligned=Route.align(b,grid(0),xy(position-1,0),obs);assert(aligned);assert.equal(aligned.position,position);assert.equal(aligned.first,0);firstRows.push(position);
 assert.equal(Route.align({...b,prefixAnchored:false},grid(0),xy(position-1,0),obs),null);
 assert.equal(Route.align({...b,anchored:true},grid(0),xy(position-1,0),obs),null,'Visual matching replaced an authoritative log position');
 assert.equal(Route.align({...b,animating:true},grid(0),xy(position-1,0),obs),null);
 assert.equal(Route.align({...b,total:15},grid(0),xy(position-1,0),obs),null,'An incomplete prefix became a position anchor');
 assert.equal(Route.align({...b,total:24,looks:Array.from({length:24},(_,i)=>[i+1,'plain'])},grid(0),xy(position-1,0),obs),null,'Repeated plain rows were assigned an arbitrary absolute position');
}
const patterns={};let cases=0;
for(const mode of Object.keys(Route.lengths)){
 const stats=patterns[mode]={recovered:0,ambiguous:0,wrong:0};
 for(let seed=1;seed<=100;seed++){
  const tiles=R.makeBoard(mode,R.makeRng(seed));
  for(let firstRow=0;firstRow<tiles.length/4-1;firstRow+=2){
   const position=Math.min(tiles.length-1,(firstRow+1)*4+(seed%4)),total=Math.min(tiles.length,(Math.floor(position/4)+4)*4);
   const board={anchored:false,prefixAnchored:true,total,looks:tiles.slice(0,total).map((t,i)=>[i+1,coarse(t)])};
   const observations=tiles.slice(firstRow*4,Math.min(total,(firstRow+5)*4)).map((t,i)=>({p:xy(firstRow*4+i,firstRow),tile:firstRow*4+i<=position?{kind:'empty',used:true}:tile(t)}));
   const found=Route.align(board,grid(firstRow),xy(position,firstRow),observations);cases++;
   if(!found)stats.ambiguous++;else{stats.recovered++;if(found.position!==position+1||found.first!==firstRow*4)stats.wrong++;assert.equal(found.position,position+1,mode+' seed '+seed+' row '+firstRow);assert.equal(found.first,firstRow*4);}
  }
 }
 assert(stats.recovered>0,mode+' never recovered a cold-open position');
}
// A picture-confirmed anchor must be committed to the host parser, so the
// next empty-cell move is counted from the real position rather than tile1.
const log=Route.create();log.feed(['S9Taro Run',...Array.from({length:24},(_,i)=>`[Game] ${1000+i*10}_S9TileIcon Anim_Loop Start`)]);
const opened=log.snapshot();assert(opened.prefixAnchored&&!opened.anchored);
assert.equal(log.anchor({epoch:opened.epoch-1,revision:opened.revision,position:8}),false);
assert.equal(log.anchor({epoch:opened.epoch,revision:opened.revision-1,position:8}),false);
assert.equal(log.anchor({epoch:opened.epoch,revision:opened.revision,position:25}),false);
assert(log.anchor({epoch:opened.epoch,revision:opened.revision,position:8}));assert(log.snapshot().anchored);assert.equal(log.snapshot().position,8);assert(log.snapshot().used.includes(8));
log.feed(['S9Taro HandleOrderAni Start Step=1 Type=Move','[Game] 900_S9LineShort Anim_D Start','[Game] 901_S9LineShort Anim_Light Start','S9Taro HandleOrderAni All done']);assert.equal(log.snapshot().position,9,'An empty-cell move lost the visual anchor');
const report={version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),firstRowPositions:firstRows,generatedCases:cases,patterns,ambiguousPrefixesRejected:true,partialPrefixRejected:true,staleEpochAndRevisionRejected:true,anchorSurvivesEmptyMove:true,gameCapture:false,gameInput:false};
fs.writeFileSync(path.join(__dirname,'results/arcana-position.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS: first-row positions1–4, '+cases+' cold windows across five modes, ambiguity/stale guards and host-parser continuation.');console.log(JSON.stringify(patterns));
