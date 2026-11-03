'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {create,transition,gameEvent}=require('../desktop/lib/vorax-journal'),{summarize}=require('./vorax-journal-report');
const root=path.resolve(__dirname,'..'),base=path.join(root,'sandbox','vorax-journal-'+process.pid),clone=x=>JSON.parse(JSON.stringify(x));
const fields=()=>Object.fromEntries(['round','refreshes','instrument0','instrument1',...Array.from({length:6},(_,i)=>'tank'+i+'.empty')].map(n=>[n,{sure:true}]));
const fixture=()=>({state:{round:5,phase:'potion',tanks:Array(6).fill(null),instruments:['Basic'],instrumentRounds:[1],hand:['Potion A','Potion B','Large Kit'],potionRefreshes:3,instrumentRefreshes:2,context:{openBox:null,pendingPicks:0,thresholds:[false,false]}},activity:{value:12000,sure:true,kind:'observed_board_not_terminal_result'},advice:{best:{index:0,targets:[2]},ranking:[{index:0,targets:[2],end:{activity:500000,reached:.3}}]},diagnostics:{profile:'balanced',cacheHit:false,totalFutures:256},handDefinitions:[{index:2,name:'Large Kit',id:33,kit:true}],recognition:{fields:fields(),problems:[]}});
const packet=a=>({event:'read',kind:'advice',capturedAt:1000,readMs:25,solveMs:30,totalMs:80,analysis:a});
async function main(){
 fs.mkdirSync(base,{recursive:true});let now=10000;const notes=[],dir=path.join(base,'main'),j=create({directory:dir,version:'test',clock:()=>now,note:(...p)=>notes.push(p),flushDelay:10000});
 const a=fixture(),b=clone(a);b.state.round=6;b.state.hand=['Next 1','Next 2','Next 3'];b.activity.value=60000;
 assert.equal(transition(a,b).action,null,'An ordinary potion transition invented the chosen card');assert.equal(transition(a,b).matchesAdvice,null);
 j.read(packet(a));j.read(packet(a));now+=500;j.feed(['[2026.11.02-16.09.10:093] S13GamePlayMain_C_ComfirmBtn']);j.read(packet(b));
 const reroll=clone(b);reroll.state.potionRefreshes--;reroll.state.hand=['Other 1','Other 2','Other 3'];assert.equal(transition(b,reroll).action.kind,'refresh');j.read(packet(reroll));
 const kit=clone(a);kit.state.context.openBox=33;kit.state.hand=['Kit 1','Kit 2','Kit 3','Kit 4','Kit 5'];assert.equal(transition(a,kit).action.index,2);
 const skipped=clone(kit);skipped.state.potionRefreshes--;assert.equal(transition(a,skipped).action,null,'Opening a kit plus a reroll became one identified move');
 const inst=fixture();inst.state.phase='instrument';inst.state.hand=['Tool X','Tool Y','Tool Z'];inst.advice.best={index:1,targets:[]};const picked=clone(inst);picked.state.phase='potion';picked.state.instruments.push('Tool Y');assert.equal(transition(inst,picked).action.index,1);assert.equal(transition(inst,picked).matchesAdvice,true);
 picked.recognition.fields.instrument1.sure=false;assert.equal(transition(inst,picked).action,null,'Uncertain equipped icon became a confirmed player action');
 picked.recognition.fields.instrument1.sure=true;picked.state.round++;assert.equal(transition(inst,picked).action,null,'An instrument pick plus a played potion became one identified move');
 const protocol=clone(reroll);protocol.state.round=13;protocol.state.phase='protocol';protocol.advice.board=0;protocol.activity.value=910000;j.read(packet(protocol));
 j.finish('mode_exit');now+=100;j.feed(['[2026.11.02-16.09.51:469] S13GamePlayReward Run']);await j.close();
 const rows=fs.readdirSync(dir).flatMap(n=>fs.readFileSync(path.join(dir,n),'utf8').trim().split('\n').map(JSON.parse));
 assert(rows.some(r=>r.type==='ui_event'&&r.kind==='confirm'));assert.equal(rows.filter(r=>r.type==='observation').length,4);assert.equal(rows.find(r=>r.type==='run_end').duplicates,1);assert.equal(rows.find(r=>r.type==='run_end').finalActivity,null);assert.equal(rows.find(r=>r.type==='run_end').lastObserved.activity.value,910000);
 assert(rows.some(r=>r.type==='completion'&&r.preparationCompleted));assert.equal(summarize(dir).confirmedFinalResults,0);assert.equal(summarize(dir).completedPreparations,1);assert.equal(summarize(dir).rows[0].partial,true);assert.equal(notes.length,0);
 assert.equal(gameEvent('unrelated S13 texture loaded'),null);assert.equal(gameEvent('S13GamePlayMain_C_RefreshBtn').kind,'refresh');
 // Disk and queue caps remain bounded; only owned journal names may be removed.
 const rotation=path.join(base,'rotation');fs.mkdirSync(rotation,{recursive:true});fs.writeFileSync(path.join(rotation,'keep.jsonl'),'UNRELATED');
 const r=create({directory:rotation,version:'test',maxFiles:2,maxBytes:30000,maxRunBytes:24000,maxQueueBytes:10000,flushDelay:10000});
 for(let i=0;i<8;i++){r.read(packet(fixture()));r.finish('fixture');await r.flush();}await r.close();assert(fs.readdirSync(rotation).filter(n=>n.startsWith('vorax-')).length<=2);assert.equal(fs.readFileSync(path.join(rotation,'keep.jsonl'),'utf8'),'UNRELATED');
 const capped=create({directory:path.join(base,'capped'),version:'test',maxRunBytes:20000,maxQueueBytes:5000,flushDelay:10000});for(let i=0;i<50;i++){const x=fixture();x.state.hand[0]='Unique '+i;capped.read(packet(x));}await capped.close();assert(capped.info().dropped>0);for(const n of fs.readdirSync(path.join(base,'capped')))assert(fs.statSync(path.join(base,'capped',n)).size<22000);
 const failed=create({directory:path.join(base,'failed'),version:'test',note:(...p)=>notes.push(p),io:{...fs.promises,mkdir:async()=>{throw Error('injected disk failure');}},flushDelay:10000});failed.read(packet(fixture()));await failed.close();assert.equal(failed.info().failed,true);assert.equal(notes.length,1);
 // Real runtime wiring: a fake backend transmits metadata without new captures,
 // and public lastStatus/debug logs retain just their existing small summaries.
 const {create:runtime}=require('../desktop/lib/unified-runtime'),runtimeDir=path.join(base,'runtime'),log=path.join(runtimeDir,'UE_game.log');fs.mkdirSync(runtimeDir,{recursive:true});fs.writeFileSync(log,'');const children=[],runtimeNotes=[];
 const spawn=()=>{const c=new EventEmitter();c.pid=222;c.killed=false;c.stdout=new PassThrough();c.stderr=new PassThrough();c.stdin=new PassThrough();c.kill=()=>{c.killed=true;};children.push(c);return c;};
 const app=runtime({executable:'fake.exe',config:()=>({mode:'vorax',consent:{version:4},shelley:6}),game:()=>({running:true,window:123}),userData:runtimeDir,spawnWorker:spawn,notify(){},note:(...p)=>runtimeNotes.push(p)});
 app.sync();children[0].stdout.write(JSON.stringify(packet(fixture()))+'\n');assert.equal(app.info().lastStatus.analysis,undefined);assert.equal(runtimeNotes.find(p=>p[0]==='Vorax read:')[1].analysis,undefined);await app.close();assert(children[0].killed);assert.equal(summarize(path.join(runtimeDir,'logs','vorax')).rows[0].observations,1);
 fs.writeFileSync(path.join(dir,'vorax-'+cryptoId()+'.jsonl'),'BROKEN TAIL');assert.equal(summarize(dir).invalidLines,1);
 const report={version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),deduplicates:true,unknownPotionNeverAssumed:true,observedActionsVerified:true,protocolNotTerminal:true,completionAfterModeExit:true,asyncFlush:true,boundedDiskAndQueue:true,diskFailureIsolated:true,fullNativePayloadThroughRuntime:true,publicStatusBounded:true,gameCapture:false,gameInput:false};
 fs.writeFileSync(path.join(root,'tools/results/vorax-journal.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS: bounded asynchronous Vorax journal, observations/rankings, honest action evidence, partial/unknown outcomes, mode-exit completion, deduplication, disk failures and runtime transport.');
}
function cryptoId(){return require('node:crypto').randomUUID();}
main().catch(e=>{console.error(e);process.exitCode=1;});
