'use strict';
// Existing saved hand + independent full-size local-game textures. No game
// window is captured and no input is sent. Odd refill pips must stay separate.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
if(!process.versions.electron){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const r=cp.spawnSync(require('../desktop/node_modules/electron'),[__filename,...process.argv.slice(2)],{env,encoding:'utf8',windowsHide:true});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exit(r.status??1);}
const {app,nativeImage}=require('electron');
app.whenReady().then(()=>{
 const arg=name=>{const at=process.argv.indexOf(name);if(at<0)throw Error('Supply '+name);return path.resolve(process.argv[at+1]);};
 const prefix=arg('--frame'),textures=arg('--textures'),source={...JSON.parse(fs.readFileSync(prefix+'.json')),data:fs.readFileSync(prefix+'.rgba')},files=[];
 function visit(p){for(const d of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,d.name);if(d.isDirectory())visit(f);else files.push(f);}}visit(textures);
 const V=require('../desktop/lib/arcana/vision'),Digits=require('../desktop/lib/arcana/digits'),expected=[22,13,4,21],cases=[];
 const base={width:2560,height:1440,data:Buffer.alloc(2560*1440*4)};
 assert.equal(source.width,2559);assert.equal(source.height,1439);
 for(let y=0;y<source.height;y++)source.data.copy(base.data,y*base.width*4,y*source.width*4,(y+1)*source.width*4);
 function erase(img){for(let y=1250;y<img.height;y++)for(let x=1840;x<2050;x++)img.data.set([25,15,55,255],(y*img.width+x)*4);}
 function resize(img,scale){if(scale===1)return img;const width=Math.round(img.width*scale),height=Math.round(img.height*scale),data=Buffer.alloc(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const rgb=V.sample(img,Math.min(img.width-1,(x+.5)/scale-.5),Math.min(img.height-1,(y+.5)/scale-.5));data.set([...rgb,255],(y*width+x)*4);}return {width,height,data};}
 for(let die=1;die<=6;die++){
  const img={...base,data:Buffer.from(base.data)};erase(img);
  const file=files.find(f=>path.basename(f)===`UI_S9Gameplay_Card_${19+die}.png`);assert(file,'Missing independent game texture');
  const original=nativeImage.createFromPath(file),size=original.getSize(),w=147,h=Math.round(w*size.height/size.width),rgba=original.resize({width:w,height:h,quality:'best'}).toBitmap();
  for(let y=0;y<h&&y+1296<img.height;y++)for(let x=0;x<w;x++){const a=(y*w+x)*4,p=((y+1296)*img.width+x+1873)*4,alpha=rgba[a+3]/255;for(let c=0;c<3;c++)img.data[p+c]=rgba[a+2-c]*alpha+img.data[p+c]*(1-alpha);}
  if(die===1){const output=path.resolve(__dirname,'../sandbox/arcana-refill-one');fs.writeFileSync(output+'.json',JSON.stringify({width:img.width,height:img.height}));fs.writeFileSync(output+'.rgba',img.data);}
  for(const scale of [1,.75,.625]){
   const scaled=resize(img,scale),r=V.cards(scaled);assert.deepEqual(r.hand,expected,`Refill ${die} leaked into the hand at ${scale}`);assert.equal(r.die,die,`Wrong refill ${die} at ${scale}`);assert.equal(r.handConfident,true,`Hand still blocked for refill ${die} at ${scale}`);assert.equal(r.handMatches.length,4);if(scale===1)assert.equal(r.handCount,4);
   const life=V.findLife(scaled);assert(life,'Life marker missing');const b=life.box,number=Digits.life(scaled,{x:b.x+b.w*1.04,y:b.y-b.h*.1,w:b.w*1.7,h:b.h*1.2});assert.equal(number?.value,2,'Blue life digit lost at '+scale);
   cases.push({die,width:scaled.width,height:scaled.height,hand:r.hand,confident:r.handConfident,life:number.value});
  }
 }
 const missing={...base,data:Buffer.from(base.data)};erase(missing);const rejected=V.cards(missing);assert.equal(rejected.die,null,'A hand card was promoted when the refill slot was absent');assert.deepEqual(rejected.hand,expected);
 const lastMove={...missing,data:Buffer.from(missing.data)},moveTexture=nativeImage.createFromPath(files.find(f=>path.basename(f)==='UI_S9Gameplay_Card_24.png')),moveSize=moveTexture.getSize(),moveW=147,moveH=Math.round(moveW*moveSize.height/moveSize.width),movePixels=moveTexture.resize({width:moveW,height:moveH,quality:'best'}).toBitmap();
 for(let y=1294;y<lastMove.height;y++)for(let x=1315;x<1470;x++)lastMove.data.set([25,15,55,255],(y*lastMove.width+x)*4);
 for(let y=0;y<moveH&&y+1296<lastMove.height;y++)for(let x=0;x<moveW;x++){const a=(y*moveW+x)*4,p=((y+1296)*lastMove.width+x+1315)*4,alpha=movePixels[a+3]/255;for(let c=0;c<3;c++)lastMove.data[p+c]=movePixels[a+2-c]*alpha+lastMove.data[p+c]*(1-alpha);}
 const movementHand=V.cards(lastMove);assert.deepEqual(movementHand.hand,[22,13,4,5]);assert.equal(movementHand.handConfident,true);assert.equal(movementHand.die,null,'The final movement card in the hand was mistaken for the absent refill');
 // A matching hand count is still required: obscuring a real hand card must
 // not become a valid smaller hand after recovering the separate refill.
 const covered={...base,data:Buffer.from(base.data)};
 for(let y=1290;y<covered.height;y++)for(let x=982;x<1090;x++)covered.data.fill(0,(y*covered.width+x)*4,(y*covered.width+x)*4+4);
 assert.equal(V.cards(covered).handConfident,false,'Covered hand card was silently discarded');
 fs.writeFileSync(path.resolve(__dirname,'results/arcana-refill.json'),JSON.stringify({version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),source:'Existing saved hand and full local-game refill textures, composited offline; not a new live game capture.',gameCapture:false,gameInput:false,cases,missingRefillRejected:true,lastMovementCardPreserved:true,coveredCardRejected:true},null,2)+'\n');
 console.log('PASS: all six refill dice at three sizes stay out of the four-card hand; absent refill and covered card remain blocked.');app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
