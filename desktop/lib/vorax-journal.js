'use strict';
// Local metadata from existing reads only. This module never captures or plays.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const clone=x=>JSON.parse(JSON.stringify(x));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sure=(a,name)=>a.recognition?.fields?.[name]?.sure===true;
const complete=a=>Array.isArray(a.state?.tanks)&&a.state.tanks.length===6&&a.activity?.sure===true&&sure(a,'round')&&!(a.recognition?.problems||[]).length;
function transition(before,after){
 const a=before.state,b=after.state;let action=null;
 const reliable=complete(before)&&complete(after);
 if(reliable&&a.phase==='instrument'&&a.round===b.round&&!b.context?.openBox&&b.instruments.length===a.instruments.length+1&&a.instruments.every((n,i)=>n===b.instruments[i])){
  const name=b.instruments.at(-1),indices=a.hand.flatMap((n,i)=>n===name?[i]:[]),slot=b.instruments.length-1;
  if(indices.length===1&&sure(after,'instrument'+slot))action={kind:'card',index:indices[0],name,targets:[],evidence:'equipped_instrument_change'};
 }
 const unchangedBoard=same(a.tanks,b.tanks)&&same(a.instruments,b.instruments),counter=a.phase==='instrument'?'instrumentRefreshes':'potionRefreshes';
 if(reliable&&a.phase===b.phase&&a.round===b.round&&unchangedBoard&&a.context?.openBox===b.context?.openBox&&sure(before,'refreshes')&&sure(after,'refreshes')&&Number.isInteger(a[counter])&&b[counter]===a[counter]-1)action={kind:'refresh',evidence:'reroll_counter_decreased_once'};
 if(reliable&&a.phase==='potion'&&b.phase==='potion'&&a.round===b.round&&unchangedBoard&&sure(before,'refreshes')&&sure(after,'refreshes')&&a.potionRefreshes===b.potionRefreshes&&!a.context?.openBox&&b.context?.openBox){
  const kits=(before.handDefinitions||[]).filter(c=>c.kit&&c.id===b.context.openBox);
  if(kits.length===1)action={kind:'card',index:kits[0].index,name:kits[0].name,targets:[],evidence:'confirmed_kit_context'};
 }
 let matchesAdvice=null;
 if(action){const best=before.advice?.best;if(best!==null&&best!==undefined)matchesAdvice=action.kind==='refresh'?best==='refresh':typeof best==='object'?best.index===action.index&&same(best.targets||[],action.targets):false;}
 return {action,matchesAdvice,adviceAvailableBeforeAction:null,confidence:action?'observed':'unknown',reason:action?null:'The selected potion/targets are not identified by the game log; advice is not evidence of a played move.',activityDelta:reliable?after.activity.value-before.activity.value:null};
}
function gameEvent(line){
 let kind=null;
 if(/S13GamePlay_C_StartGameBtn\b/.test(line))kind='new_game';
 else if(/\bS13GamePlayReward Run\b/.test(line))kind='preparation_completed';
 else if(/S13GamePlayReward_C_FightBtn\b/.test(line))kind='fight';
 else if(/S13GamePlayReward_C_GiveUpBtn\b/.test(line))kind='abandon';
 else if(/S13GamePlayMain_C_(?:Comfirm|Confirm)Btn\b/.test(line))kind='confirm';
 else if(/S13GamePlayMain_C_RefreshBtn\b/.test(line))kind='refresh';
 else if(/S13GamePlayCard_C_SelectBtn\b/.test(line))kind='select_card';
 else if(/S13GamePlayMonsterItem_C_SelectBtn\b/.test(line))kind='select_target';
 if(!kind)return null;
 const m=line.match(/^\[(\d{4})\.(\d\d)\.(\d\d)-(\d\d)\.(\d\d)\.(\d\d):(\d{3})\]/);
 const gameAt=m?Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6],+m[7]):null;
 return {kind,gameAt};
}
function create({directory,version,manifestPath=null,note=()=>{},clock=Date.now,io=fs.promises,maxBytes=64*1024*1024,maxFiles=200,maxRunBytes=4*1024*1024,maxQueueBytes=1024*1024,flushDelay=100}){
 directory=path.resolve(directory);let run=null,recent=null,queue=[],queuedBytes=0,timer=null,writing=Promise.resolve(),closed=false,failed=false,lastUI='',closePromise=null,cleanupWanted=true;
 const stats={observations:0,duplicates:0,dropped:0,written:0,errors:0};
 const metadata=manifestPath?io.readFile(manifestPath,'utf8').then(x=>{const m=JSON.parse(x);return {backendSha256:m.backendSha256,sourceManifestSha256:crypto.createHash('sha256').update(x).digest('hex'),solverSources:Object.fromEntries(Object.entries(m.sources||{}).filter(([f])=>f.startsWith('vorax/crates/vorax/src/')||f.startsWith('vorax/data/')))};}).catch(()=>({unavailable:true})):Promise.resolve({unavailable:true});
 function fail(error){if(failed)return;failed=true;stats.errors++;queue=[];queuedBytes=0;note('Vorax journal unavailable:',error.message);}
 function append(r,type,value={},force=false){
  if(!r||failed)return false;
  const entry={schema:1,version,runId:r.id,sequence:++r.sequence,at:clock(),type,...value},line=JSON.stringify(entry)+'\n',bytes=Buffer.byteLength(line);
  if(!force&&(queuedBytes+bytes>maxQueueBytes||r.bytes+bytes>maxRunBytes-16384)){r.dropped++;stats.dropped++;return false;}
  if(bytes>maxRunBytes){r.dropped++;stats.dropped++;return false;}
  r.bytes+=bytes;queue.push({file:r.file,line});queuedBytes+=bytes;
  if(!timer){timer=setTimeout(()=>{timer=null;void flush();},flushDelay);timer.unref?.();}
  return true;
 }
 async function prune(){
  const entries=await io.readdir(directory,{withFileTypes:true}),files=[];
  for(const e of entries){if(!e.isFile()||!/^vorax-[0-9a-f-]+\.jsonl$/.test(e.name))continue;const file=path.join(directory,e.name),s=await io.stat(file);files.push({file,bytes:s.size,time:s.mtimeMs});}
  files.sort((a,b)=>b.time-a.time||b.file.localeCompare(a.file));let bytes=0,count=0;
  for(const f of files){bytes+=f.bytes;count++;if((bytes>maxBytes||count>maxFiles)&&f.file!==run?.file&&f.file!==recent?.file)await io.unlink(f.file);}
 }
 function flush(){
  clearTimeout(timer);timer=null;if(failed)return writing;
  const batch=queue;queue=[];queuedBytes=0;if(!batch.length)return writing;
  writing=writing.then(async()=>{
   await io.mkdir(directory,{recursive:true});const m=await metadata;
   const grouped=new Map();for(const x of batch){if(!grouped.has(x.file))grouped.set(x.file,[]);grouped.get(x.file).push(x.line);}
   for(const [file,lines]of grouped){
    const out=lines.map(line=>{const e=JSON.parse(line);if(e.type==='run_start')e.backend=m;return JSON.stringify(e)+'\n';}).join('');
    await io.appendFile(file,out,'utf8');stats.written+=Buffer.byteLength(out);
   }
   if(cleanupWanted){cleanupWanted=false;await prune();}
  }).catch(fail);return writing;
 }
 function begin(a,context){
  const id=crypto.randomUUID(),fresh=a.state.round===1&&a.state.phase==='instrument'&&a.state.instruments.length===0&&sure(a,'round');
  run={id,file:path.join(directory,'vorax-'+id+'.jsonl'),sequence:0,bytes:0,dropped:0,duplicates:0,last:null,start:clock(),fingerprint:null,uiEvents:[]};recent=null;
  append(run,'run_start',{partial:!fresh,context,indices:'zero_based',objective:{kind:'capped_final_activity',target:840000},dataPolicy:{local:true,screenshots:false,rawGameLog:false},knownLimitations:['A protocol/round-13 board is not an observed terminal score.','Unidentified player choices remain unknown.']});
 }
 function finish(reason='capture_stopped',completion=false){
  if(!run)return;const r=run,last=r.last;
  append(r,'run_end',{reason,preparationCompleted:completion,finalActivity:null,finalActivityStatus:'not_observed',lastObserved:last?{observation:last.observation,round:last.analysis.state.round,phase:last.analysis.state.phase,activity:last.analysis.activity}:null,observations:r.observations||0,duplicates:r.duplicates,dropped:r.dropped},true);
  recent={...r,ended:clock()};run=null;cleanupWanted=true;void flush();
 }
 function read(message,context={}){
  if(closed||failed||message.kind!=='advice'||!message.analysis?.state)return;
  const a=clone(message.analysis),previous=run?.last?.analysis;
  if(previous&&sure(previous,'round')&&sure(a,'round')&&(a.state.round<previous.state.round||a.state.round===1&&a.state.phase==='instrument'&&!a.state.instruments.length&&previous.state.instruments.length))finish('new_game_detected');
  if(!run)begin(a,context);
  const r=run,quality={problems:a.recognition?.problems,fields:Object.fromEntries(Object.entries(a.recognition?.fields||{}).map(([k,v])=>[k,!!v.sure]))};
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify([a.state,quality,a.advice?.best,a.advice?.ranking,a.advice?.refreshEnd])).digest('hex');
  if(r.fingerprint===fingerprint){r.duplicates++;stats.duplicates++;return;}
  const observation=(r.observations||0)+1;
  if(r.last){
   const t=transition(r.last.analysis,a),captured=Number(message.capturedAt)||null;
   const events=r.uiEvents.filter(e=>e.gameAt!==null&&r.last.capturedAt!==null&&e.gameAt>r.last.capturedAt&&captured!==null&&e.gameAt<=captured&&['confirm','refresh'].includes(e.kind));
   if(events.length>1){t.action=null;t.matchesAdvice=null;t.confidence='unknown';t.reason='Multiple confirmations or refreshes occurred between these observations.';}
   if(t.action&&events.length===1){t.actionObservedAt=events[0].gameAt;t.adviceAvailableBeforeAction=r.last.loggedAt<=events[0].gameAt;}
   append(r,'transition',{from:r.last.observation,to:observation,...t});
  }
  const capturedAt=Number(message.capturedAt)||null;
  const accepted=append(r,'observation',{observation,stateKey:fingerprint,capturedAt,adviceLoggedAt:clock(),timing:{readMs:message.readMs,solveMs:message.solveMs,totalMs:message.totalMs},...a});
  r.last={analysis:a,observation,capturedAt,loggedAt:clock()};r.observations=observation;r.fingerprint=fingerprint;stats.observations++;return accepted;
 }
 function feed(lines,{initial=false}={}){
  if(closed||failed||initial)return;
  for(const line of lines){const e=gameEvent(line);if(!e)continue;const key=e.kind+':'+(e.gameAt??line);if(key===lastUI)continue;lastUI=key;
   if(e.kind==='new_game'){finish('new_game_requested');continue;}
   if(run){run.uiEvents.push(e);run.uiEvents=run.uiEvents.slice(-100);append(run,'ui_event',{...e,afterObservation:run.last?.observation??null,actualCard:null,actualTargets:null});if(['preparation_completed','fight','abandon'].includes(e.kind))finish(e.kind,e.kind!=='abandon');}
   else if(recent&&clock()-recent.ended<3000&&['preparation_completed','fight','abandon'].includes(e.kind)){
    append(recent,'completion',{...e,preparationCompleted:e.kind!=='abandon',finalActivity:null,finalActivityStatus:'not_observed'},true);void flush();
   }
  }
 }
 return {read,feed,finish,flush,info:()=>({directory,active:!!run,runId:run?.id||null,queuedBytes,failed,...stats}),close(){if(closePromise)return closePromise;finish('application_exit');closed=true;closePromise=flush();return closePromise;}};
}
module.exports={create,transition,gameEvent};
