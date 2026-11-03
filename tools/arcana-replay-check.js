'use strict';
// Decode existing recorded JPEGs in memory. Never opens/captures a game window.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
if(!process.versions.electron){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const r=cp.spawnSync(require('../desktop/node_modules/electron'),[__filename,...process.argv.slice(2)],{env,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exit(r.status??1);}
const {app,nativeImage}=require('electron');const replayProfile=path.resolve(__dirname,'../sandbox/arcana-replay-profile-'+process.pid);fs.mkdirSync(replayProfile,{recursive:true});app.setPath('userData',replayProfile);app.disableHardwareAcceleration();
app.whenReady().then(()=>{
 const at=process.argv.indexOf('--session');if(at<0)throw Error('Supply --session <existing recorded session directory>');
 const dir=path.resolve(process.argv[at+1]),name=path.basename(dir),shotsDir=path.join(dir,'arcana-shots-'+name),shots=JSON.parse(fs.readFileSync(path.join(shotsDir,'shots.json')));
 const Route=require('../desktop/lib/arcana/route-log'),Reader=require('../desktop/lib/arcana/reader'),Events=require('../desktop/lib/arcana/events'),{logTime}=require('../desktop/lib/arcana/timer-reader/log');
 const records=fs.readFileSync(path.join(dir,'arcana-live-'+name+'.log'),'utf8').split(/\r?\n/).map(line=>({line,time:logTime(line)})).filter(r=>r.time!==null);
 const timeline=shots.flatMap(s=>s.events).filter(e=>Number.isFinite(e.time)).sort((a,b)=>a.time-b.time);
 const cold=process.argv.includes('--cold-open'),route=Route.create(),cases=[];let reader=Reader.create(),cursor=0,eventCursor=0,position=1,life=2,chests=0;
 for(const shot of shots){
  if(!fs.existsSync(path.join(shotsDir,shot.file)))continue;
  const time=Date.parse(shot.time);while(eventCursor<timeline.length&&timeline[eventCursor].time<=time){const event=timeline[eventCursor++];if(event.kind==='move'&&event.pos!==null)position=event.pos;if(event.kind==='life')life=Math.max(0,Math.min(6,life+event.change));if(event.kind==='chest-collected')chests=event.slots??chests+1;}
  const batch=[];while(cursor<records.length&&records[cursor].time<=time)batch.push(records[cursor++].line);route.feed(batch);let board=route.snapshot();
  if(cold){
   // This recorded client's initial prefix is16 cells, i.e.3 rows ahead.
   // Simulate a cold UI open from the recorded original coarse appearances;
   // this is a controlled scenario, not a second real recording of each open.
   const total=Math.min(80,(Math.floor((position-1)/4)+4)*4),consumed=new Set(board.used);reader=Reader.create();board={...board,epoch:cases.length+1,revision:1,anchored:false,prefixAnchored:true,position:1,total,looks:board.looks.filter(([p])=>p<=total).map(([p,look])=>[p,consumed.has(p)?'plain':look]),used:[],moves:0,chestSequence:0,chestEvents:[]};
  }
  reader.setLogBoard(board);if(!cold)for(const event of Events.parse(batch))if(event.kind==='choice'||event.kind==='choice-close')reader.setPopup(event.kind==='choice'?'choose':null);
  const image=nativeImage.createFromPath(path.join(shotsDir,shot.file));if(image.isEmpty())throw Error('Cannot decode '+shot.file);const {width,height}=image.getSize(),data=image.toBitmap();for(let i=0;i<data.length;i+=4){const r=data[i];data[i]=data[i+2];data[i+2]=r;data[i+3]=255;}
  const parsed=reader.read({width,height,data}),m=parsed.model,wrong=[];
  if(m.positionConfirmed&&m.position+1!==position)wrong.push('position');if(m.lifeFresh&&m.life!==life)wrong.push('life');if(m.chestsFresh&&m.chests.length!==chests)wrong.push('chest-count');
  cases.push({file:shot.file,stable:shot.still,expected:{position,life,chests},parsed:{position:m.positionConfirmed?m.position+1:null,life:m.life,chests:m.chests,hand:m.hand,die:m.die,pathType:m.pathMode?.type||null,length:m.lengthConfirmed?m.path.length:null},logPosition:board.position,positionAnchor:reader.positionAnchor(),confirmed:m.confirmed,waiting:!!parsed.waiting,issues:parsed.issues,wrong,reader:reader.recognition()?.cardReader,ms:parsed.ms});
  if(cases.length%10===0)console.log('Replayed '+cases.length+'/'+shots.length+' existing frames');
 }
 const report={version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),session:name,frames:cases.length,confirmed:cases.filter(c=>c.confirmed).length,wrongConfirmed:cases.filter(c=>c.confirmed&&c.wrong.length).length,automaticWaiting:cases.filter(c=>c.waiting&&!c.confirmed).length,withChecks:cases.filter(c=>c.issues.length&&!c.waiting).length,scope:'Previously recorded game pictures paired with recorded events; no live capture/input. Expected position/life/chest counts are reconstructed from those events. Automatic waits are counted separately and are not recognition successes.',cases,gameCapture:false,gameInput:false};
 if(cold){report.coldOpen=true;report.scope+=' Cold-open diagnostic: each picture starts a new reader with a simulated coarse prefix,3 rows ahead as observed in this client. Recorded consumed cells become plain appearances as in S9TaroModel.TransTileMapToUIData. The used set, known position and previous reader history are removed.';}
 const outAt=process.argv.includes('--output')?process.argv.indexOf('--output'):process.argv.indexOf('--out'),out=outAt<0?path.join(__dirname,cold?'results/arcana-cold-replay.json':'results/arcana-replay.json'):path.resolve(process.argv[outAt+1]);fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({frames:report.frames,confirmed:report.confirmed,wrongConfirmed:report.wrongConfirmed,withChecks:report.withChecks,out}));
 app.exit(process.argv.includes('--verify')&&(report.wrongConfirmed||report.withChecks)?1:0);
}).catch(error=>{console.error(error);app.exit(1);});
