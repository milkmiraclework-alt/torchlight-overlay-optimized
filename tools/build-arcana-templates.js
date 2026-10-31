'use strict';
// Build small, fixed image signatures from extracted game textures. This tool
// uses our Electron image decoder once; recognition itself needs no decoder,
// OCR model, network, Python or game asset extraction on the player's PC.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
if(!process.versions.electron){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const r=cp.spawnSync(path.resolve(__dirname,'../desktop/node_modules/electron/dist/electron.exe'),[__filename,...process.argv.slice(2)],{windowsHide:true,encoding:'utf8',env});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exit(r.status??1);}
const {app,nativeImage}=require('electron');
app.whenReady().then(()=>{
 const at=process.argv.indexOf('--input');if(at<0)throw Error('Supply --input <extracted texture directory>');
 const input=path.resolve(process.argv[at+1]),files=[];
 function visit(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())visit(f);else if(e.name.endsWith('.png'))files.push(f);}}visit(input);
 const signatures=[],dice=[],heals=[];
 for(const file of files){
  const name=path.basename(file,'.png').replace(/_Sprite$/,'');
  let kind;if(/^UI_S9Gameplay_Card_\d+$/.test(name))kind='card';else if(/UI_S9Gameplay_03_ICON_TRBOX\d+$/.test(name))kind='chest';else if(name==='UI_S9Gameplay_00_ICON_LIFE')kind='life';else if(name==='UI_S9Gameplay_00_ICON_CardsNUM')kind='hand-count';else if(/UI_S9Gameplay_00_Dikuai(?:hp\d+|Card\d+)$/.test(name)||/UI_S9Gameplay_00_ICON_(?:SHIJIAN\d+|wenhao128)$/.test(name))kind='tile';else if(/UI_S9Gameplay_00_BG_GZ(?:0[012]|gold)$/.test(name))kind='base';else continue;
  const original=nativeImage.createFromPath(file);if(original.isEmpty())throw Error('Cannot decode '+file);
  const width=kind==='card'?24:24,height=kind==='card'?40:20;
  const reduced=original.resize({width,height,quality:'best'}),bgra=reduced.toBitmap(),rgba=Buffer.alloc(bgra.length);
  for(let i=0;i<rgba.length;i+=4){rgba[i]=bgra[i+2];rgba[i+1]=bgra[i+1];rgba[i+2]=bgra[i];rgba[i+3]=bgra[i+3];}
  const size=original.getSize();signatures.push({name,kind,width,height,aspect:size.width/size.height,pixels:rgba.toString('base64'),sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
  if(/UI_S9Gameplay_Card_(?:1[1-6]|2[0-5])$/.test(name))dice.push({name,aspect:size.width/size.height,pixels:original.resize({width:96,height:160,quality:'best'}).toBitmap()});
  if(/UI_S9Gameplay_00_Dikuaihp0[1-3]$/.test(name))heals.push({name,aspect:size.width/size.height,pixels:original.resize({width:96,height:96,quality:'best'}).toBitmap()});
 }
 signatures.sort((a,b)=>a.name.localeCompare(b.name));
 const pipGroups=[];
 for(const family of ['back','forward']){
  const group=dice.filter(d=>family==='back'?/Card_1[1-6]$/.test(d.name):/Card_2[0-5]$/.test(d.name)),candidates=[],points=[];
  for(let y=30;y<66;y++)for(let x=28;x<63;x++){
   let variance=0;for(let c=0;c<3;c++){const values=group.map(d=>d.pixels[(y*96+x)*4+c]),mean=values.reduce((a,b)=>a+b,0)/values.length;variance+=values.reduce((a,b)=>a+(b-mean)**2,0);}
   candidates.push({x,y,variance});
  }
  candidates.sort((a,b)=>b.variance-a.variance);
  for(const p of candidates){if(points.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<2.5))continue;points.push(p);if(points.length===56)break;}
  pipGroups.push({family,points:points.map(p=>[(p.x+.5)/96,(p.y+.5)/160]),templates:group.map(d=>({name:d.name,aspect:d.aspect,rgb:points.flatMap(p=>{const i=(p.y*96+p.x)*4;return [d.pixels[i+2],d.pixels[i+1],d.pixels[i]];})}))});
 }
 const tileGroups=[];
 if(heals.length===3){
  const candidates=[],points=[];
  for(let y=32;y<67;y++)for(let x=38;x<70;x++){
   let variance=0;for(let c=0;c<3;c++){const values=heals.map(d=>d.pixels[(y*96+x)*4+c]),mean=values.reduce((a,b)=>a+b,0)/values.length;variance+=values.reduce((a,b)=>a+(b-mean)**2,0);}candidates.push({x,y,variance});
  }
  candidates.sort((a,b)=>b.variance-a.variance);for(const p of candidates){if(points.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<2))continue;points.push(p);if(points.length===56)break;}
  tileGroups.push({points:points.map(p=>[(p.x+.5)/96,(p.y+.5)/96]),templates:heals.map(d=>({name:d.name,aspect:d.aspect,rgb:points.flatMap(p=>{const i=(p.y*96+p.x)*4;return [d.pixels[i+2],d.pixels[i+1],d.pixels[i]];})}))});
 }
 const out=path.resolve(__dirname,'../desktop/lib/arcana/templates.json');fs.writeFileSync(out,JSON.stringify({revision:2,source:'Local S9 game textures. Independently generated image signatures.',signatures,pipGroups,tileGroups})+'\n');
 console.log(`Arcana: ${signatures.length} game-image signatures (${fs.statSync(out).size} bytes).`);app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
