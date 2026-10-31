'use strict';
const {parentPort,workerData}=require('node:worker_threads'),fs=require('node:fs');
const E=require('./engine'),Solver=require('./solver'),Reader=require('./reader');
const reader=Reader.create();
reader.restore(workerData.resume);
let capture=null,handle=null,revision=0,retryTimer=null,job=null,lastAdvice=null,lastSolvedKey=null,frame=null,fallbackPending=false,fallbackAttempt=0,closed=false;
let cycleContext=null,cycleAttempts=0,cycleCounted=false;
const cards=E.DATA.cards.filter(c=>c.tag!==99).map(c=>({id:c.id,name:c.name,sort:c.sort,choices:c.choices})).sort((a,b)=>a.sort-b.sort||a.id-b.id);
const tileEffects=Object.entries(E.DATA.tiles).filter(([id,t])=>t.events.length&&![1000,1051,1052,1053].includes(Number(id))).map(([id,t])=>({id:Number(id),name:t.events.map(e=>E.DATA.events[e]?.text).filter(Boolean).join('; ')||(Number(id)===1001?'Draw 1–3 random notes':'')})).filter(t=>t.name);
const status=state=>{parentPort.postMessage({event:'checkpoint',value:reader.checkpoint()});parentPort.postMessage({event:'status',state:{...state,cards,tileEffects,model:reader.state()}});};
function invalidate(){revision++;job=null;fallbackPending=false;clearTimeout(retryTimer);retryTimer=null;}
function grab(){
 if(workerData.fixture){const m=JSON.parse(fs.readFileSync(workerData.fixture+'.json','utf8').replace(/^\uFEFF/,'')),data=new Uint8ClampedArray(fs.readFileSync(workerData.fixture+'.rgba'));if(!Number.isInteger(m.width)||!Number.isInteger(m.height)||m.width<64||m.height<64||data.length!==m.width*m.height*4)throw Error('Invalid Arcana saved frame');return {...m,data};}
 if(!capture)capture=require('../native-reader-kernels').create(workerData.library).capture;
 if(!handle)handle=capture.create(workerData.hwnd);
 if(!handle)throw Error('Direct game capture unavailable');
 const size=new Int32Array(2);if(!capture.size(handle,size))throw Error('Game window unavailable');
 const [width,height]=size,data=new Uint8ClampedArray(width*height*4);
 if(Number(capture.grab(handle,data,data.length))!==data.length)throw Error('Could not capture the Arcana picture');
 let bright=false;for(let i=0;i<data.length;i+=128)if(data[i]+data[i+1]+data[i+2]>80){bright=true;break;}if(!bright)throw Error('Black game picture');
 return {width,height,data};
}
function solve(){
 invalidate();const mine=revision,model=reader.state(),start=performance.now();
 try{
  if(!model.confirmed){status({phase:'check',reason:'Check the Arcana reading.'});return;}
  const context=model.position===model.path.length-1?JSON.stringify([model.position,model.hand,model.chests,model.pending]):null;
  if(context!==cycleContext||context===null){cycleAttempts=0;cycleContext=context;cycleCounted=false;}
  if(model.life<=0){status({phase:'advice',move:'Start Fateful Contest',why:'Life is depleted. The collected chests are kept.',expected:`${E.score(model)} collected rarity points.`});return;}
  const modelKey=JSON.stringify(E.normalize(model))+'|cycles:'+cycleAttempts;
  if(lastAdvice&&modelKey===lastSolvedKey){status({...lastAdvice,calculationMs:0,cached:true});return;}
  job=Solver.createJob(model,{samples:128,allowReroll:cycleAttempts<3,rerollBudget:Math.max(0,3-cycleAttempts)});status({phase:'thinking'});
  function step(){
   if(mine!==revision||closed||!job)return;
   try{
    const done=job.step(4);if(!done){setImmediate(step);return;}
    const result=job.result();job=null;
    cycleCounted=false;lastAdvice={phase:'advice',action:result.best.action,cycleAttempts,move:result.best.label,target:result.target,summary:`Tile ${model.position+1} · ${model.life} life · ${model.chests.length}/7 chests`,
     why:result.exact?'Uses the best order of the remaining chest upgrades.':'Compares alternative continuations, chest rarity, available notes and remaining life.',
     expected:`${result.exact?'Final':'Estimated'} ${result.best.mean.toFixed(2)} rarity points · ${result.best.rainbows.toFixed(2)} rainbow chests · ${Math.round(result.best.deathRisk*100)}% life-depletion risk`,
     notice:result.exact?'The remaining upgrades are calculated exactly.':result.unknownEvents?'Preview: question outcomes use equally weighted effects from local game data; server odds are unknown. Read again after the event.':result.estimatedHidden?'Preview: hidden tiles use the observed board plus a small independent prior. Server layout odds are not calibrated.':'Preview: strategy needs live-game validation.',
     options:result.options,calculationMs:performance.now()-start,samples:result.samples,totalRollouts:result.totalRollouts,verifiedCandidates:result.verifiedCandidates,learningRollouts:result.learningRollouts||0,screenSamples:result.screenSamples||0,continuationStates:result.continuationStates||0,exact:!!result.exact};lastSolvedKey=modelKey;status(lastAdvice);
   }catch(error){job=null;status({phase:'error',reason:error.message});}
  }
  setImmediate(step);
 }catch(error){status({phase:'check',reason:error.message});}
}
function processFrame(img,attempt=0){
 if(!img||!Number.isInteger(img.width)||!Number.isInteger(img.height)||img.width<64||img.height<64||img.width*img.height>16777216||img.data?.length!==img.width*img.height*4)throw Error('Invalid Arcana frame dimensions');
 frame={width:img.width,height:img.height,data:new Uint8ClampedArray(img.data)};const reading=reader.read(frame);
 if(reading.model.confirmed){solve();return;}
 status({phase:'check',reason:reading.issues.slice(0,3).join(' ')+(reading.issues.length>3?` ${reading.issues.length-3} more checks in Board.`:''),readingMs:reading.ms,issues:reading.issues});
 // A fixed, bounded retry waits for entering animations; unclear recognition
 // cannot create an endless background screenshot loop.
 if(attempt<2&&!workerData.fixture&&(reading.waiting||reading.bases<5)){const mine=revision;retryTimer=setTimeout(()=>{if(mine===revision)read(attempt+1);},220);}
}
function read(attempt=0){
 invalidate();status({phase:'reading'});
 try{processFrame(grab(),attempt);}catch(error){if(!fallbackPending&&!workerData.fixture){fallbackPending=true;fallbackAttempt=attempt;parentPort.postMessage({event:'fallback',reason:error.message,requestRevision:revision});}else status({phase:'error',reason:error.message});}
}
parentPort.on('message',message=>{
 const {id,cmd,value}=message;
 try{
  let result=true;
  if(cmd==='read')read();
  else if(cmd==='frame'){if(message.requestRevision!==revision||!fallbackPending)return;fallbackPending=false;processFrame(message.frame,fallbackAttempt);}
  else if(cmd==='invalidate'){if(message.changed&&!cycleCounted&&cycleContext&&lastAdvice?.action?.kind==='reroll'){cycleAttempts++;cycleCounted=true;}invalidate();if(message.changed)reader.expectChange();}
  else if(cmd==='settled'){if(value?.refillOnly&&cycleCounted&&cycleContext&&lastAdvice?.action?.kind==='reroll')reader.settleCycle();}
  else if(cmd==='reset'){invalidate();reader.reset(!!message.fresh);lastAdvice=null;lastSolvedKey=null;cycleContext=null;cycleAttempts=0;cycleCounted=false;status({phase:'waiting'});}
  else if(cmd==='suspend'){invalidate();status({phase:'waiting'});}
  else if(cmd==='popup'){invalidate();reader.setPopup(value);}
  else if(cmd==='correct'){invalidate();result=reader.correct(value);solve();}
  else if(cmd==='calibrate'){invalidate();result=reader.calibrate(value);status({phase:'check',reason:'Alignment saved. Read the screen and check the state.'});}
  else if(cmd==='view'){
   if(frame){const data=frame.data.slice();parentPort.postMessage({id,result:{width:frame.width,height:frame.height,data}},[data.buffer]);return;}
   result=null;
  }else throw Error('Unsupported Arcana worker command');
  if(id)parentPort.postMessage({id,result});
 }catch(error){if(id)parentPort.postMessage({id,error:error.message});else status({phase:'error',reason:error.message});}
});
process.once('exit',()=>{closed=true;invalidate();if(handle)capture?.destroy(handle);});
