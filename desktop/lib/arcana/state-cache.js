'use strict';
// One bounded local observation checkpoint. No pictures, raw log lines or
// simulated futures. A timestamped opening and every physical UI order must
// match before a previous hand/life/inventory can be used behind a popup.
const fs=require('node:fs'),path=require('node:path'),E=require('./engine');
const LIMIT=256*1024,hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const metadata=['positionConfirmed','positionSource','routeMoves','worldRevision','localHorizon','manualPath','lifeFresh','handFresh','dieFresh','chestsFresh'];
function create({file=null,note=()=>{}}={}){
 let loaded=false,record=null,pending=null,writing=null,closed=false,lastError='';
 const fail=error=>{if(lastError!==error.message){lastError=error.message;note('Arcana state cache:',error.message);}};
 function read(){
  if(loaded||!file)return;loaded=true;
  try{if(fs.statSync(file).size>LIMIT)return;const raw=JSON.parse(fs.readFileSync(file,'utf8'));if(raw.schema===1&&hex(raw.runKey)&&hex(raw.stateStamp))record=raw;}
  catch(error){if(error.code!=='ENOENT')fail(error);}
 }
 function pump(){
  if(writing||!pending||!file)return writing||Promise.resolve();
  writing=(async()=>{
   try{
    await fs.promises.mkdir(path.dirname(file),{recursive:true});
    while(pending){const text=pending;pending=null;const temporary=file+'.'+process.pid+'.tmp';await fs.promises.writeFile(temporary,text,'utf8');await fs.promises.rename(temporary,file);}
   }catch(error){pending=null;fail(error);}
  })().finally(()=>{writing=null;if(pending)pump();});return writing;
 }
 function save(checkpoint,board,window){
  if(!file||closed||!board?.anchored||board.animating||!hex(board.runKey)||!hex(board.stateStamp)||!Number.isSafeInteger(window)||window<=0)return false;
  const m=checkpoint?.model;
  if(!m?.confirmed||!m.positionConfirmed||!m.lifeFresh||!m.handFresh||!m.dieFresh||!m.chestsFresh||m.routeEpoch!==board.epoch||m.routeMoves!==board.moves||m.position+1!==board.position||(m.worldRevision||0)!==(board.worldRevision||0))return false;
  try{
   const model=E.normalize(m);for(const name of metadata)if(m[name]!==undefined)model[name]=m[name];
   const next={schema:1,runKey:board.runKey,stateStamp:board.stateStamp,window,worldRevision:board.worldRevision||0,total:board.total,looks:board.looks,model};
   const text=JSON.stringify(next);if(Buffer.byteLength(text)>LIMIT)return false;
   loaded=true;if(record&&JSON.stringify(record)===text)return true;record=next;pending=text;pump();return true;
  }catch(error){fail(error);return false;}
 }
 function load(board,window){
  read();const r=record;
  if(!r||closed||!board?.prefixAnchored||board.animating||!hex(board.runKey)||!hex(board.stateStamp)||r.runKey!==board.runKey||r.stateStamp!==board.stateStamp||r.window!==window||r.total!==board.total||r.worldRevision!==(board.worldRevision||0)||JSON.stringify(r.looks)!==JSON.stringify(board.looks))return null;
  try{
   const model=E.normalize(r.model);
   if(!r.model.positionConfirmed||!r.model.lifeFresh||!r.model.handFresh||!r.model.dieFresh||!r.model.chestsFresh||model.position>=board.total||board.anchored&&model.position+1!==board.position)return null;
   if(JSON.stringify(model.fieldMods||[])!==JSON.stringify(board.fieldMods||[]))return null;
   for(const name of metadata)if(r.model[name]!==undefined)model[name]=r.model[name];
   model.routeEpoch=board.epoch;model.routeMoves=board.moves;model.confirmed=false;
   return {position:model.position+1,checkpoint:{model,grid:null,previousSize:null,key:null,confirmedKey:null,established:true,pathHistory:structuredClone(model.path),historyEpoch:board.epoch,historyRevision:board.worldRevision||0,lastReliableLife:model.life,lastReliableHand:model.hand.slice(),lastReliableDie:model.die,lastReliableChests:model.chests.slice(),chestAnchor:{epoch:board.epoch,sequence:board.chestSequence||0,chests:model.chests.slice()},popup:board.popup||null}};
  }catch(error){fail(error);return null;}
 }
 return {save,load,flush:()=>pump(),close(){closed=true;return pump();},info:()=>({enabled:!!file,writing:!!writing,pending:!!pending,hasObservation:!!record})};
}
module.exports={create,LIMIT};
