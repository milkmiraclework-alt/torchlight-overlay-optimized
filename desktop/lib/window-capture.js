'use strict';
// The child owns a short Windows Graphics Capture session, not a game adviser.
const {spawn}=require('node:child_process');
function create(executable,{spawnChild=spawn,timeout=3000}={}){
 const children=new Set();let closed=false;
 return {
  grab(hwnd){
   if(closed||!Number.isSafeInteger(hwnd)||hwnd<=0)return Promise.reject(Error('Invalid capture window'));
   return new Promise((resolve,reject)=>{
    const child=spawnChild(executable,['--capture-window',String(hwnd)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    const chunks=[];let bytes=0,errors='',done=false;
    const finish=(error,image)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(image);};
    const abort=reason=>{child.kill();finish(Error(reason));};
    child.abortCapture=()=>abort('Capture stopped');children.add(child);
    const timer=setTimeout(()=>abort('Windows Graphics Capture timed out'),timeout);
    child.stdout.on('data',b=>{bytes+=b.length;if(bytes>67_108_876){abort('Capture frame too large');return;}chunks.push(b);});
    child.stderr.on('data',b=>{errors=(errors+b).slice(-2048);});
    child.on('error',e=>finish(e));child.on('close',code=>{
     children.delete(child);
     if(done)return;
     if(code!==0){finish(Error(errors||'Windows Graphics Capture failed'));return;}
     const buffer=Buffer.concat(chunks);
     if(buffer.length<12||buffer.toString('ascii',0,4)!=='TLRG'){finish(Error('Invalid capture header'));return;}
     const width=buffer.readUInt32LE(4),height=buffer.readUInt32LE(8);
     if(width<64||height<64||width*height>16_777_216||buffer.length!==12+width*height*4){finish(Error('Invalid capture dimensions'));return;}
     finish(null,{width,height,data:new Uint8ClampedArray(buffer.subarray(12)),captureSource:'windows-graphics-capture'});
    });
   });
  },
  cancel(){for(const child of [...children])child.abortCapture();},
  close(){closed=true;this.cancel();},
  info:()=>({children:children.size,closed})
 };
}
module.exports={create};
