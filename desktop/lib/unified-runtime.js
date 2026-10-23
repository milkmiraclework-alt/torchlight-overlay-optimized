'use strict';
const {spawn}=require('node:child_process'),os=require('node:os'),{classify,LogTail}=require('./mode-router');
function create({executable,config,game,notify,note,userData,test=false,spawnWorker=spawn}){
 let detected='idle',mode='idle',child=null,ready=false,pending=null,timer=0,retry=0,epoch=0,closed=false,lastStatus=null,failedAt=0,settleStarted=0,settleKind='board',lastShown=null;
 const children=new Set();
 const enabled=()=>{const s=config();return s.consent?.version===4&&!s.consent.withdrawn&&game().running;};
 const threads=()=>Math.max(1,Math.min(128,Math.trunc(config().threads)||((os.availableParallelism?.()||os.cpus().length)-1)));
 const send=m=>{if(child&&!child.killed&&child.stdin.writable)child.stdin.write(JSON.stringify(m)+'\n');};
 function stop(){clearTimeout(timer);timer=0;pending=null;epoch++;ready=false;lastShown=null;const old=child;child=null;if(old){old.stdin.end();old.kill();}}
 function sync(){
  if(closed)return;
  const selected=config().mode||'auto';const next=selected==='auto'?detected:selected;
  if(next!==mode){mode=next;note('mode:',mode);if(mode!=='vorax')stop();notify();}
  if(!enabled()||mode!=='vorax'){if(child)stop();return;}
  if(!child&&Date.now()-failedAt>3000){
   const env={...process.env,TORCHLIGHT_GAME_HWND:String(game().window),TORCHLIGHT_USER_DATA:userData,RAYON_NUM_THREADS:String(threads()),VORAX_ADVISOR:'smart',VORAX_SMART_PROFILE:'balanced',VORAX_CAPTURE_VISIBLE:config().hideFromCaptures===false?'1':'0'};
   // Only this child is owned by the host. No existing overlay is terminated.
   const current=spawnWorker(executable,['--hosted','--shelley',String(config().shelley||6),'--accent',String(config().accent||0)],{windowsHide:true,stdio:['pipe','pipe','pipe'],env});
   child=current;children.add(current);let rest='';
   current.stdin.on('error',error=>note('Vorax pipe:',error.message));
   current.stdout.on('data',bytes=>{
    rest+=String(bytes);let nl;
    while((nl=rest.indexOf('\n'))>=0){
     const line=rest.slice(0,nl);rest=rest.slice(nl+1);
     try{
      const message=JSON.parse(line);if(child!==current)continue;lastStatus=message;
      if(message.event==='ready'){
       ready=true;lastShown=config().overlayOn!==false;send({cmd:'shown',shown:lastShown});
       if(pending){const p=pending;pending=null;send({cmd:'read',...p});}
      }else if(message.event==='read'){
       note('Vorax read:',message);
       if((message.kind==='animating'||message.kind==='no-frame')&&retry<3){retry++;schedule('board',700,false);}
       else if(message.relook)schedule('relook',1500,false);
      }else if(message.event==='error'){note('Vorax error:',message.reason);notify();}
     }catch{note('Vorax:',line.slice(0,300));}
    }
   });
   current.stderr.on('data',bytes=>note('Vorax:',String(bytes).slice(0,400)));
   const gone=(code)=>{children.delete(current);if(child===current){child=null;ready=false;failedAt=Date.now();note('Vorax stopped:',code);notify();}};
   current.on('error',error=>{note('Vorax startup:',error.message);gone(-1);});current.on('exit',gone);
  }
  const shown=config().overlayOn!==false;
  if(ready&&shown!==lastShown){lastShown=shown;send({cmd:'shown',shown});}
 }
 function read(trigger='board',now=false){
  sync();if(!enabled()||mode!=='vorax'||!child)return;
  if(trigger==='relook'){trigger='board';now=true;}
  if(ready)send({cmd:'read',trigger,now});else pending={trigger,now};
 }
 function schedule(trigger,delay=400,fresh=true){
  if(fresh){settleKind=trigger==='screen'||(timer&&settleKind==='screen')?'screen':trigger;settleStarted=Date.now();epoch++;retry=0;}
  else if(!timer){settleKind=trigger;settleStarted=Date.now();}
  clearTimeout(timer);
  const revision=epoch,kind=settleKind;
  timer=setTimeout(()=>{timer=0;if(revision===epoch&&mode==='vorax')read(kind);},Math.min(delay,Math.max(0,settleStarted+3000-Date.now())));
 }
 const tail=new LogTail((lines,{initial})=>{
  for(const line of lines){const next=classify(line);if(next){detected=next;}}
  sync();
  if(mode!=='vorax')return;
  if(initial){if(detected==='vorax')schedule('screen');return;}
  for(const line of lines){
   if(/S13GamePlayMain Run|S13GamePlay_C_StartGameBtn/.test(line))schedule('screen');
   else if(/ProtoId = 5619\b/.test(line))schedule('board');
   else if(/KYZ_Card_Figure_Refresh/.test(line)&&timer)schedule(settleKind,150,false);
   else if(/Play_UI_S13_KYZ_Card_/.test(line)&&!/KYZ_Card_Selected'|KYZ_Card_Selected_Confirm|KYZ_Card_Agentia_Use/.test(line)&&timer)schedule('board',400,false);
  }
 });
 const poll=()=>{if(!closed){tail.poll();sync();}};
 const backup=setInterval(poll,1000);backup.unref();
 return {get mode(){return mode;},setLog:file=>tail.setPath(file),poll,sync,
  manual(){
   if((config().mode||'auto')==='auto'&&mode==='idle'){detected='tartarus';sync();}
   if(mode==='vorax'){
    const trigger=timer&&settleKind==='screen'?'screen':'board';
    clearTimeout(timer);timer=0;epoch++;retry=0;read(trigger,true);
   }
   return mode;
  },
  reconfigure(){if(child)stop();sync();if(mode==='vorax')schedule('board',0);},
  info:()=>({mode,detected,enabled:enabled(),voraxPid:child?.pid||0,ready,threads:threads(),children:children.size,lastStatus}),
  close(){closed=true;clearInterval(backup);stop();for(const c of children)c.kill();}
 };
}
module.exports={create};
