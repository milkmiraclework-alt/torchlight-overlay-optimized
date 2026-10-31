'use strict';
// Independently rendered high-resolution game textures, not our reduced
// classifier signatures. No real window is captured or receives input.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
if(!process.versions.electron){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const r=cp.spawnSync(path.resolve(__dirname,'../desktop/node_modules/electron/dist/electron.exe'),[__filename,...process.argv.slice(2)],{env,encoding:'utf8',windowsHide:true});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exit(r.status??1);}
const {app,nativeImage}=require('electron');
app.whenReady().then(()=>{
 const at=process.argv.indexOf('--textures');if(at<0)throw Error('Supply --textures <extracted game PNG directory>');
 const input=path.resolve(process.argv[at+1]),files=[];function visit(p){for(const d of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,d.name);if(d.isDirectory())visit(f);else files.push(f);}}visit(input);
 const width=1600,height=900,data=Buffer.alloc(width*height*4);for(let p=0;p<data.length;p+=4){data[p]=30;data[p+1]=16;data[p+2]=48;data[p+3]=255;}
 for(const [i,n]of [20,22,24].entries()){
  const file=files.find(f=>path.basename(f)===`UI_S9Gameplay_Card_${n}.png`);assert.ok(file,'Missing full game card texture');
  const original=nativeImage.createFromPath(file),size=original.getSize(),w=180,h=Math.round(w*size.height/size.width),bitmap=original.resize({width:w,height:h,quality:'best'}).toBitmap(),x0=420+i*240,y0=190;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const a=(y*w+x)*4,p=((y0+y)*width+x0+x)*4,alpha=bitmap[a+3]/255;for(let c=0;c<3;c++)data[p+c]=bitmap[a+2-c]*alpha+data[p+c]*(1-alpha);}
 }
 const V=require('../desktop/lib/arcana/vision'),Reader=require('../desktop/lib/arcana/reader'),E=require('../desktop/lib/arcana/engine'),S=require('../desktop/lib/arcana/solver'),img={width,height,data};
 const offers=V.offers(img);assert.equal(offers.confident,true,JSON.stringify(offers));assert.deepEqual(offers.cards,[1,3,5]);
 const reader=Reader.create();reader.setPopup('choose');const reading=reader.read(img);assert.deepEqual(reading.model.pending,{kind:'choose',cards:[1,3,5]});assert.equal(reading.model.confirmed,false,'A popup cannot invent life/position from an occluded board');
 const model={...E.blank(8),position:6,life:2,die:2,hand:[21],chests:[5],path:Array.from({length:8},()=>({kind:'empty'})),pending:{kind:'choose',cards:[1,3,5],source:0},confirmed:true,lengthConfirmed:true};
 const j=S.createJob(model,{samples:32});while(!j.step(8)){}assert.equal(j.result().best.action.kind,'choose');
 E.apply(model,{kind:'choose',id:3,index:1},E.rng(4));assert.deepEqual(model.hand,[3]);assert.equal(model.position,6);assert.equal(model.pending,null);
 fs.writeFileSync(path.resolve(__dirname,'results/arcana-popup.json'),JSON.stringify({version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),scope:'Synthetic popup composited from full independent local-game PNG textures; not proof of live popup layout coverage.',offeredNotes:[1,3,5],realTextureDetection:true,unknownUnderlyingBoardBlocked:true,choiceAddsNoteWithoutPlaying:true,gameCapture:false,gameInput:false},null,2)+'\n');
 console.log('PASS: high-resolution game-texture popup, all offered pips, underlying-board confidence guard, source-card consumption and selected note added without playing.');app.quit();
}).catch(e=>{console.error(e.message);app.exit(1);});
