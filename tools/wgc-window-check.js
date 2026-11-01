'use strict';
// Own GPU-rendered window only, including updates behind an owned black cover.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {create}=require('../desktop/lib/window-capture'),{sourceExecutable}=require('./overlay-runtime');
const pause=ms=>new Promise(r=>setTimeout(r,ms)),root=path.resolve(__dirname,'..');
const folder=path.join(root,'sandbox','wgc-window-'+Date.now());fs.mkdirSync(folder,{recursive:true});
const script=path.join(folder,'main.cjs');
const commandFile=path.join(folder,'command.json');
fs.writeFileSync(script,`const {app,BrowserWindow}=require('electron');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');let win,cover;
function send(x){process.stdout.write(JSON.stringify(x)+'\\n');}
app.whenReady().then(async()=>{win=new BrowserWindow({width:320,height:240,x:40,y:40,frame:false,show:false,skipTaskbar:true,webPreferences:{backgroundThrottling:false}});
await win.loadURL('data:text/html,<canvas id="c" width="320" height="240"></canvas><style>body{margin:0}</style><script>const gl=c.getContext("webgl");window.paint=(r,g,b)=>{if(gl){gl.clearColor(r/255,g/255,b/255,1);gl.clear(gl.COLOR_BUFFER_BIT);}else{c.style.background="rgb("+[r,g,b]+")";}};paint(210,35,60);</script>');win.showInactive();
setTimeout(()=>send({hwnd:Number(win.getNativeWindowHandle().readBigUInt64LE())}),200);
let last;setInterval(async()=>{let c;try{c=JSON.parse(require('fs').readFileSync(${JSON.stringify(commandFile)},'utf8'));}catch{return;}if(c.id===last)return;last=c.id;if(c.quit){cover?.destroy();win.destroy();app.quit();return;}if(c.cover){cover=new BrowserWindow({width:320,height:240,x:40,y:40,frame:false,show:false,skipTaskbar:true,alwaysOnTop:true,backgroundColor:'#000000'});await cover.loadURL('data:text/html,<body style="background:black">');cover.showInactive();}if(c.color)await win.webContents.executeJavaScript('paint('+c.color.join(',')+')');setTimeout(()=>send({done:c.id}),250);},50);});`);
(async()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(sourceExecutable(),[script,'--user-data-dir='+path.join(folder,'profile')],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
 const capture=create(path.join(root,'desktop/native/vorax-backend.exe'));let out='',errors='';const events=[];
 child.stdout.on('data',b=>{out+=b;let i;while((i=out.indexOf('\n'))>=0){const line=out.slice(0,i);out=out.slice(i+1);try{events.push(JSON.parse(line));}catch{}}});child.stderr.on('data',b=>errors=(errors+b).slice(-4000));
 const wait=async pred=>{for(let n=0;n<300;n++){const event=events.find(pred);if(event)return event;if(child.exitCode!==null)throw Error(errors);await pause(50);}throw Error('Own GPU test window timed out: '+JSON.stringify(events)+' '+errors);};
 const times=[];try{
  const {hwnd}=await wait(e=>e.hwnd);
  for(const [id,color,cover]of [[1,[210,35,60],false],[2,[25,190,65],false],[3,[30,60,220],true]]){
   fs.writeFileSync(commandFile,JSON.stringify({id,color,cover}));await wait(e=>e.done===id);
   const start=performance.now(),image=await capture.grab(hwnd);times.push(performance.now()-start);
   assert(Math.abs(image.width/image.height-320/240)<.02,'Client aspect changed with DPI');const p=(Math.floor(image.height/2)*image.width+Math.floor(image.width/2))*4;
   for(let c=0;c<3;c++)assert(Math.abs(image.data[p+c]-color[c])<=3,JSON.stringify({id,expected:color,actual:[...image.data.slice(p,p+4)]}));
  }
  assert.equal(capture.info().children,0);
  fs.mkdirSync(path.join(root,'tools/results'),{recursive:true});fs.writeFileSync(path.join(root,'tools/results/wgc-capture.json'),JSON.stringify({checkedAt:new Date().toISOString(),gameCapture:false,gameInput:false,ownedWebGLWindow:true,liveColorsVerified:3,updatesBehindBlackCover:true,zeroCaptureChildren:true,times},null,2)+'\n');
  console.log('PASS: fresh RGBA frames from owned WebGL window, two content changes including one behind black cover, exact client geometry and no surviving capture child. '+JSON.stringify(times));
 }finally{capture.close();fs.writeFileSync(commandFile,JSON.stringify({id:99,quit:true}));for(let n=0;n<80&&child.exitCode===null;n++)await pause(50);if(child.exitCode===null)child.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
