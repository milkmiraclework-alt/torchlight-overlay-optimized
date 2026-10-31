'use strict';
// The common host owns this worker, its capture session and every calculation.
// Nothing runs outside Arcana or after the player's capture consent is withdrawn.
const {Worker}=require('node:worker_threads');
const path=require('node:path');
function create({game,library,notify,note=()=>{},WorkerClass=Worker,fixture=null,fallback=null}){
 let worker=null,active=false,closed=false,revision=0,request=0,timer=null,last=null,resume=null,lastHwnd=0,fallbackReads=0;
 const pending=new Map(),retiring=new Set();
 let animationTypes=[];
 function publish(value){last=value;notify(value);}
 function stop(){
  revision++;clearTimeout(timer);timer=null;animationTypes=[];
  const old=worker;worker=null;
  if(old){const done=old.terminate();retiring.add(done);Promise.resolve(done).finally(()=>retiring.delete(done));}
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Arcana session stopped'));}pending.clear();
 }
 function start(){
  if(worker||!active||closed)return;
  const hwnd=Number(game().window);if(hwnd!==lastHwnd)resume=null;lastHwnd=hwnd;
  const current=new WorkerClass(path.join(__dirname,'arcana/worker.js'),{workerData:{library,hwnd,fixture,resume}});worker=current;
  current.on('message',message=>{
   if(current!==worker)return;
   if(message.id){const p=pending.get(message.id);if(p){pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(message.error)):p.resolve(message.result);}return;}
   if(message.event==='checkpoint'){resume=message.value;return;}
   if(message.event==='fallback'&&fallback){
    fallbackReads++;
    const mine=revision;
    Promise.resolve(fallback()).then(frame=>{if(mine===revision&&worker===current&&active)current.postMessage({cmd:'frame',frame,requestRevision:message.requestRevision});}).catch(error=>{if(mine===revision)publish({phase:'error',reason:error.message});});return;
   }
   if(message.event==='status'){publish(message.state);if(message.state.phase==='error')note('Arcana:',message.state.reason);}
  });
  const gone=error=>{if(worker!==current)return;if(error)note('Arcana worker:',error.message);stop();publish({phase:'error',reason:'Arcana stopped. Read the screen again.'});};
  current.on('error',gone);current.on('exit',()=>gone(null));
 }
 function read(){if(!active||closed)return;clearTimeout(timer);timer=null;start();worker?.postMessage({cmd:'read'});}
 function schedule(delay=280){clearTimeout(timer);const mine=revision;timer=setTimeout(()=>{timer=null;if(mine===revision)read();},delay);}
 function call(cmd,args={}){
  if(!active||closed)return Promise.reject(Error('Enable capture and select Arcana first.'));
  start();const id=++request;
  return new Promise((resolve,reject)=>{const t=setTimeout(()=>{pending.delete(id);reject(Error('Arcana request timed out'));},8000);pending.set(id,{resolve,reject,timer:t});worker.postMessage({id,cmd,...args});});
 }
 return {
  sync(on){on=!!on&&!closed;if(on===active)return;active=on;if(!on){stop();last=null;notify(null);}else{publish({phase:'waiting'});schedule();}},
  feed(lines,{initial=false}={}){
   if(!active)return;
   // Exact game UI triggers are supplied by the Arcana event parser. Asset
   // loading and unrelated gameplay must never start a screenshot loop.
   const events=require('./arcana/events').parse(lines);
   for(const event of events){
    if(event.kind==='animation'){
     if(event.step===1){animationTypes=[];worker?.postMessage({cmd:'invalidate',changed:true});publish({phase:'reading'});schedule(380);}
     animationTypes.push(event.type);continue;
    }
    if(event.kind==='settled'){worker?.postMessage({cmd:'settled',value:{refillOnly:animationTypes.length>0&&animationTypes.every(type=>type==='CardGroupAdd')}});animationTypes=[];schedule(40);continue;}
    if(event.kind==='new'&&!initial){start();worker.postMessage({cmd:'reset',fresh:true});}
    if(event.kind==='choice'||event.kind==='choice-close'){start();worker.postMessage({cmd:'popup',value:event.kind==='choice'?'choose':null});}
    if(event.kind==='close'){clearTimeout(timer);timer=null;worker?.postMessage({cmd:'suspend'});}
    else{worker?.postMessage({cmd:'invalidate',changed:event.kind==='move'});publish({phase:'reading'});schedule(event.kind==='move'?380:220);}
   }
   if(initial&&events.length)schedule();
  },
  read,
  async command(cmd,args){
   if(cmd==='get')return {active,state:last};
   if(cmd==='picture')return call('view');
   if(cmd==='read'){read();return true;}
   if(!['correct','calibrate','reset'].includes(cmd))throw Error('Unsupported Arcana command');
   return call(cmd,{value:args});
  },
  info:()=>({active,running:!!worker,pending:pending.size,retiring:retiring.size,phase:last?.phase||'off',revision,fallbackReads}),
  close(){closed=true;active=false;stop();}
 };
}
module.exports={create};
