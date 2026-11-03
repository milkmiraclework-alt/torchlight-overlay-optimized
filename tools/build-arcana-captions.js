'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
if(!process.versions.electron){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const r=cp.spawnSync(require('../desktop/node_modules/electron'),[__filename,...process.argv.slice(2)],{env,encoding:'utf8',windowsHide:true});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exit(r.status??1);}
const {app,BrowserWindow}=require('electron');
app.whenReady().then(async()=>{
 const at=process.argv.indexOf('--font'),font=at<0?null:fs.readFileSync(process.argv[at+1]),win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});
 await win.loadURL('data:text/html,<html><body></body></html>');
 const signatures=await win.webContents.executeJavaScript(`(async()=>{
  ${font?`const face=new FontFace('ArcanaGame','url(data:font/ttf;base64,${font.toString('base64')})');await face.load();document.fonts.add(face);`:''}
  const out=[],c=document.createElement('canvas');c.width=480;c.height=80;const x=c.getContext('2d');
  for(const text of ['Abandon Contest','Start Contest'])for(const font of ['Arial','Segoe UI','Tahoma','Arial Narrow'${font?",'ArcanaGame'":''}])for(const weight of [600,700])for(const style of ['','italic '])for(const size of [12,16,20,26]){
   x.clearRect(0,0,c.width,c.height);x.font=style+weight+' '+size+'px "'+font+'"';x.fillStyle='white';x.fillText(text,8,44);const p=x.getImageData(0,0,c.width,c.height).data;
   for(const threshold of [110,180]){let l=c.width,r=-1,t=c.height,b=-1;for(let y=0;y<c.height;y++)for(let z=0;z<c.width;z++)if(p[(y*c.width+z)*4+3]>threshold){l=Math.min(l,z);r=Math.max(r,z);t=Math.min(t,y);b=Math.max(b,y);}if(r<l)continue;let bits='';for(let y=0;y<14;y++)for(let z=0;z<80;z++){const a=Math.min(r,Math.floor(l+(z+.5)*(r-l+1)/80)),j=Math.min(b,Math.floor(t+(y+.5)*(b-t+1)/14));bits+=p[(j*c.width+a)*4+3]>threshold?'1':'0';}out.push({text,aspect:(r-l+1)/(b-t+1),bits});}
  }return out;
 })()`);
 const unique=[...new Map(signatures.map(s=>[s.text+':'+s.bits,s])).values()];
 fs.writeFileSync(path.resolve(__dirname,'../desktop/lib/arcana/captions.json'),JSON.stringify({revision:1,source:'English game captions rendered independently from system fonts and optional local-game font; no screenshot pixels.',fontSha256:font?crypto.createHash('sha256').update(font).digest('hex'):null,signatures:unique})+'\n');
 console.log('Arcana: '+unique.length+' independent caption glyph masks.');win.destroy();app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
