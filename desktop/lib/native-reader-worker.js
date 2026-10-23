'use strict';
const {parentPort,workerData}=require('node:worker_threads');
const path=require('node:path');
const {kernels,capture}=require('./native-reader-kernels').create(workerData.library);
const S=require(path.join(workerData.site,'js/scan.js'));
require(path.join(workerData.site,'js/scan-data.js'));
require(path.join(workerData.site,'js/pick-data.js'));
const R=require(path.join(workerData.site,'js/frame-readiness.js'));
const Tracker=require(path.join(workerData.site,'js/scan-tracker.js'));
S.setKernels(kernels);
const ref=S.withPanelIcons(globalThis.TARTARUS_SCAN,globalThis.TARTARUS_PICK),tracker=Tracker.create(S);
const detector=R.create({visualOnly:true}),semantic=R.create({semanticOnly:true});
let handle=null,serial=0,frames=new Map(),checkedEpoch=null,lastSample=null,semanticMode=false,retryAt=0,menuCache=null;
let fixtureImg=null;
// Offline harness supplies this only when constructing its own worker. The
// production IPC has no command accepting files or pixels from a renderer.
if(workerData.fixture){
  const fs=require('node:fs'),meta=JSON.parse(fs.readFileSync(workerData.fixture+'.json','utf8'));
  const data=new Uint8ClampedArray(fs.readFileSync(workerData.fixture+'.rgba'));
  if(data.length!==meta.width*meta.height*4)throw Error('Invalid saved frame');
  fixtureImg={width:meta.width,height:meta.height,data};
  frames.set(++serial,{img:fixtureImg});
}
function clear(){if(handle)capture.destroy(handle);handle=null;frames.clear();tracker.reset();detector.calibrate(null);semantic.calibrate(null);menuCache=null;}
function calibrate(calibration,result){
  const old=detector.calibration;
  if(result?.ok&&result.chain&&old?.controls&&!calibration?.controls&&(!calibration||calibration.width===old.width&&calibration.height===old.height))return;
  detector.calibrate(calibration);semantic.calibrate(calibration);checkedEpoch=null;lastSample=null;semanticMode=false;retryAt=0;menuCache=null;
}
function read(frame,lang='en'){
  if(frame.result&&frame.lang===lang)return frame.result;
  const t=Date.now(),img=frame.img,{gray,sharp}=frame.pixels||S.preparePixels(img);
  let prepared=S.prepareBoardSearch(img,gray,ref,sharp,1),loc=tracker.locate(prepared,img);
  const fromProbe=lang==='en'?frame.prepared:null;
  if(fromProbe)loc=fromProbe.loc;
  if(!loc)loc=S.locateBoard(img,gray,ref,sharp);
  let pre=null;
  if(loc&&loc.score>=0.65){
    const reuse=lang==='en'?tracker.panels(img,loc):{},board=fromProbe?.board||S.readBoardCells(img,sharp,loc,ref);
    if(fromProbe){reuse.doors=fromProbe.doors;reuse.days=fromProbe.days;}
    if(lang!=='en'||reuse.doors?.hidden?.length)delete reuse.doors;
    pre={board,panels:{doors:Object.hasOwn(reuse,'doors')?reuse.doors:S.readDoors(img,sharp,loc,ref,lang!=='en',board.cells),
      days:Object.hasOwn(reuse,'days')?reuse.days:S.readDays(img,sharp,loc,ref),
      tools:Object.hasOwn(reuse,'tools')?reuse.tools:S.readTools(img,loc,ref),
      chromatic:Object.hasOwn(reuse,'chromatic')?reuse.chromatic:S.readChromatic(img,loc)},...(fromProbe?{decision:fromProbe.decision}:{})};
  }
  let result=S.scanLocated(img,ref,gray,sharp,loc,t,pre,{lang});
  if(tracker.info().mode==='tracked'&&(!result.ok||!result.warden||result.cells.some(c=>c.conf<0.2))){
    tracker.reset();result=S.scan(img,ref,{lang});
  }
  tracker.remember(img,result);
  if(result.tools?.tools){for(const tool of result.tools.tools){Object.assign(tool,ref.toolNames[tool.id]||{});for(const alt of tool.alts||[])alt.sim=ref.toolNames[alt.id]?.sim;}
    result.tools.sims=[...new Set(ref.tools.map(r=>ref.toolNames[r.id]?.sim).filter(Boolean))];}
  const calibration=result.ok&&result.warden&&!result.loc.byLabels?{loc:result.loc,width:img.width,height:img.height,
    sample:R.sampleFast(img,result.loc,S),controls:R.controlsFor(result)}:null;
  calibrate(calibration,result);frame.result=result;frame.lang=lang;
  return result;
}
function probe(frame,epoch){
  const C=detector.calibration,img=frame.img;
  if(!C?.controls||img.width!==C.width||img.height!==C.height)return {ready:null,reason:'uncalibrated'};
  const sample=R.sampleFast(img,C.loc,S),now=performance.now();
  const stable=detector.observe({epoch,time:now,valid:true,sample});
  if(checkedEpoch!==epoch){checkedEpoch=epoch;retryAt=0;lastSample=null;semanticMode=false;}
  const motion=lastSample&&R.difference(lastSample,sample),changed=R.difference(C.sample,sample).changed>=0.01;
  if(changed&&motion&&(motion.changed>0.004||motion.mean>1))semanticMode=true;
  lastSample=sample;
  if((!stable&&!semanticMode)||now<retryAt)return {ready:false,reason:changed?'collecting':'unchanged'};
  const {gray,sharp}=S.preparePixels(img),prepared=S.prepareBoardSearch(img,gray,ref,sharp,1),fit=S.scoreBoardAt(prepared,C.loc);
  const valid=fit.score>=0.82&&fit.quarters.every(score=>score>=0.68);
  let controls='',doors=null,decision=null,board=null;
  if(valid){
    if(menuCache&&Tracker.sameRegion(img,menuCache.img,menuCache.box))({doors,decision}=menuCache);
    else{
      const bottom=Math.max(S.at(C.loc,0,3)[1],S.at(C.loc,5,3)[1])+30*C.loc.s,bounds={top:Math.floor(bottom)};
      doors=S.readDoors(img,sharp,C.loc,ref);decision=doors&&doors.conf>=0.85?null:S.readDecision(img,C.loc,bounds);
      menuCache={img,doors,decision,box:[0,Math.min(bottom,bounds.top)-4,img.width-1,img.height-1]};
    }
    if(doors&&doors.conf>=0.85||decision&&decision.title){board=S.readBoardCells(img,sharp,C.loc,ref);controls=R.controlsFor({...board,doors,decision});}
  }
  const candidate=valid&&!!controls&&controls!==C.controls;
  const consensus=semantic.observe({epoch,time:performance.now(),valid:candidate,controls});
  if(!candidate)retryAt=performance.now()+250;
  const ready=candidate&&(stable||consensus);
  if(ready){frame.pixels={gray,sharp};frame.prepared={loc:{...C.loc,score:fit.score},board,doors,decision,days:S.readDays(img,sharp,C.loc,ref)};}
  return {ready,reason:!valid?'weak-fit':!controls?'missing-controls':!candidate?'same-controls':'state-consensus'};
}
parentPort.on('message',({id,cmd,...args})=>{
  try{
    let result;
    if(cmd==='connect'){clear();handle=fixtureImg?null:capture.create(args.hwnd);if(!handle&&!fixtureImg)throw Error('Direct window capture is unavailable');result=true;}
    else if(cmd==='close'){clear();result=true;}
    else if(cmd==='grab'){
      const size=new Int32Array(2);if(fixtureImg){size[0]=fixtureImg.width;size[1]=fixtureImg.height;}else if(!handle||!capture.size(handle,size))throw Error('Window unavailable or outside native size limit');
      const [width,height]=size,data=new Uint8ClampedArray(width*height*4),t=performance.now();
      if(fixtureImg)data.set(fixtureImg.data);else if(Number(capture.grab(handle,data,data.length))!==data.length)throw Error('Direct window capture failed');
      let blank=true;for(let y=0;y<16;y++)for(let x=0;x<16;x++){const p=(Math.floor(y*height/16)*width+Math.floor(x*width/16))*4;if(data[p]>12||data[p+1]>12||data[p+2]>12)blank=false;}
      if(blank)throw Error('Direct capture returned a black frame');
      const token=++serial;frames.set(token,{img:{width,height,data}});while(frames.size>3)frames.delete(frames.keys().next().value);
      result={native:true,token,width,height,captureMs:performance.now()-t,blank:false};
    }else if(cmd==='release'){frames.delete(args.token);result=true;}
    else{
      const frame=frames.get(args.token);if(!frame)throw Error('Native frame expired');
      if(cmd==='probe')result=probe(frame,args.epoch);
      else if(cmd==='read'){
        result={result:read(frame,args.lang),tracking:{...tracker.info(),native:true}};
        if(result.result.objective){
          const img=frame.img,[a,b,c,d]=result.result.objective.map(Math.round),width=c-a,height=d-b;
          if(width>0&&height>0&&width<2600&&height<2600){
            const data=new Uint8ClampedArray(width*height*4);
            for(let y=0;y<height;y++)for(let x=0;x<width;x++){
              const sx=a+x,sy=b+y;
              if(sx>=0&&sy>=0&&sx<img.width&&sy<img.height)data.set(img.data.subarray((sy*img.width+sx)*4,(sy*img.width+sx)*4+4),(y*width+x)*4);
            }
            result.corner={width,height,buffer:data.buffer};
          }
        }
      }
      else if(cmd==='pixels'){const {width,height,data}=frame.img;result={width,height,buffer:data.buffer.slice(0)};parentPort.postMessage({id,result},[result.buffer]);return;}
      else throw Error('Unknown native reader command');
    }
    parentPort.postMessage({id,result});
  }catch(error){parentPort.postMessage({id,error:String(error.message||error)});}
});
parentPort.postMessage({event:'ready'});
