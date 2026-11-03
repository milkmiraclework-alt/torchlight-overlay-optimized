'use strict';
// Click-through annotations owned by the common shell. No capture or game input.
const path=require('node:path');
function create({BrowserWindow,bounds,active,visible,icon}){
 let win=null,last=null,loaded=false,key='',closed=false;
 function dispose(){if(win&&!win.isDestroyed())win.destroy();win=null;loaded=false;key='';}
 function sync(){
  if(closed)return;
  if(!active()){dispose();last=null;return;}
  const marks=last?.marks||[],rect=bounds();
  if(!marks.length||!rect||!visible()){if(win&&!win.isDestroyed())win.hide();return;}
  if(!win||win.isDestroyed()){
   win=new BrowserWindow({x:rect.x,y:rect.y,width:rect.width,height:rect.height,show:false,transparent:true,frame:false,focusable:false,resizable:false,skipTaskbar:true,hasShadow:false,alwaysOnTop:true,title:'Arcana tile marks',icon,webPreferences:{preload:path.join(__dirname,'overlay-preload.js'),contextIsolation:true,sandbox:true,backgroundThrottling:true}});
   win.setIgnoreMouseEvents(true,{forward:true});win.setContentProtection(true);win.setAlwaysOnTop(true,'screen-saver');
   win.webContents.on('will-navigate',e=>e.preventDefault());win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   const created=win;win.webContents.on('did-finish-load',()=>{if(created!==win)return;loaded=true;key='';sync();});
   win.loadFile(path.join(__dirname,'arcana-marks.html'));
  }
  const b=win.getBounds();if(['x','y','width','height'].some(k=>b[k]!==rect[k]))win.setBounds(rect);
  const next=JSON.stringify(last);if(loaded&&next!==key){key=next;win.webContents.send('arcana:state',last);}
  if(loaded&&!win.isVisible())win.showInactive();
 }
 return {update(state){if(closed)return;last=state?{phase:state.phase,target:state.target??null,marks:(state.marks||[]).slice(0,40).filter(m=>Number.isInteger(m.index)&&Number.isFinite(m.x)&&Number.isFinite(m.y)&&m.x>0&&m.x<1&&m.y>0&&m.y<1).map(m=>({index:m.index,x:m.x,y:m.y,label:String(m.label).slice(0,12),current:!!m.current,unknown:!!m.unknown}))}:null;sync();},sync,close(){closed=true;last=null;dispose();},info:()=>({window:!!win&&!win.isDestroyed(),marks:last?.marks.length||0})};
}
module.exports={create};
