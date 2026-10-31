'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
if(!process.versions.electron){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const r=cp.spawnSync(path.resolve(__dirname,'../desktop/node_modules/electron/dist/electron.exe'),[__filename,...process.argv.slice(2)],{windowsHide:true,encoding:'utf8',env});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exit(r.status??1);}
const {app,BrowserWindow}=require('electron');
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});
 await win.loadURL('data:text/html,<html><body></body></html>');
 const fontAt=process.argv.indexOf('--font'),font=fontAt<0?null:fs.readFileSync(process.argv[fontAt+1]);
 const glyphs=await win.webContents.executeJavaScript(`(async()=>{
  ${font?`const face=new FontFace('ArcanaGame',${JSON.stringify('url(data:font/ttf;base64,'+font.toString('base64')+')')});await face.load();document.fonts.add(face);`:''}
  const out=[],c=document.createElement('canvas');c.width=80;c.height=80;const x=c.getContext('2d');
  for(const font of ['Arial','Segoe UI','Tahoma','Verdana','Bahnschrift','Arial Narrow'${font?",'ArcanaGame'":''}])for(const weight of [400,600,700])for(const style of ['','italic '])for(const size of [8,9,10,11,12,14,18,24])for(let d=0;d<=9;d++){
   x.clearRect(0,0,80,80);x.font=style+weight+' '+size+'px "'+font+'"';x.fillStyle='white';x.fillText(String(d),8,42);const p=x.getImageData(0,0,80,80).data;
   for(const threshold of [110,180]){
    let l=80,t=80,r=0,b=0;
    for(let y=0;y<80;y++)for(let z=0;z<80;z++)if(p[(y*80+z)*4+3]>threshold){l=Math.min(l,z);r=Math.max(r,z);t=Math.min(t,y);b=Math.max(b,y);}
    if(r<l||b<t)continue;const bits=[];
    for(let y=0;y<18;y++)for(let z=0;z<12;z++){const a=Math.min(r,Math.floor(l+(z+.5)*(r-l+1)/12)),j=Math.min(b,Math.floor(t+(y+.5)*(b-t+1)/18));bits.push(p[(j*80+a)*4+3]>threshold?1:0);}
    out.push({digit:d,aspect:(r-l+1)/(b-t+1),bits:bits.join('')});
   }
  }return out;
 })()`);
 const unique=[...new Map(glyphs.map(g=>[g.digit+':'+g.bits,g])).values()];
 fs.writeFileSync(path.resolve(__dirname,'../desktop/lib/arcana/digits.json'),JSON.stringify({revision:2,source:'Digits rendered independently from system fonts and optional local-game font by tools/build-arcana-digits.js.',fontSha256:font?require('node:crypto').createHash('sha256').update(font).digest('hex'):null,glyphs:unique})+'\n');
 console.log('Arcana: '+unique.length+' independent digit signatures.');win.destroy();app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
