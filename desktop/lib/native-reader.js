'use strict';
const {Worker}=require('node:worker_threads');
const path=require('node:path');
function create({site,library,allowed,note=()=>{},WorkerClass=Worker,fixture=null}){
  let worker=null,sequence=0,revision=0;const pending=new Map();
  function stop(){revision++;const old=worker;worker=null;if(old)old.terminate();for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Native reader stopped'));}pending.clear();}
  async function request(cmd,args={}){
    if(!allowed()){stop();throw Error('Capture is disabled');}
    if(args.session!==undefined&&args.session!==revision)throw Error('Native capture session expired');
    if(!worker){
      const current=new WorkerClass(path.join(__dirname,'native-reader-worker.js'),{workerData:{site,library,fixture}});worker=current;
      current.on('message',message=>{if(worker!==current)return;const p=pending.get(message.id);if(p){pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(message.error)):p.resolve(message.result);}});
      current.on('error',error=>{if(worker===current){note('Native reader:',error.message);stop();}});
      current.on('exit',()=>{if(worker===current)stop();});
    }
    const id=++sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{note('Native reader timeout:',cmd);stop();},5000);
      const session=revision;
      pending.set(id,{resolve:result=>resolve(cmd==='connect'?{session}:cmd==='grab'?{...result,session}:result),reject,timer});
      try{worker.postMessage({id,cmd,...args});}catch(error){pending.delete(id);clearTimeout(timer);reject(error);}
    });
  }
  return {request,stop,info:()=>({running:!!worker,pending:pending.size,revision})};
}
module.exports={create};
