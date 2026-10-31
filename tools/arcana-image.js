'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
if(!process.versions.electron){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const r=cp.spawnSync(path.resolve(__dirname,'../desktop/node_modules/electron/dist/electron.exe'),[__filename,...process.argv.slice(2)],{windowsHide:true,encoding:'utf8',env});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exit(r.status??1);}
const {app,nativeImage}=require('electron');
app.whenReady().then(()=>{
 const image=nativeImage.createFromPath(process.argv[2]);if(image.isEmpty())throw Error('Invalid saved image');const {width,height}=image.getSize(),b=image.toBitmap(),data=new Uint8ClampedArray(b.length);
 for(let p=0;p<b.length;p+=4){data[p]=b[p+2];data[p+1]=b[p+1];data[p+2]=b[p];data[p+3]=255;}
 const prefix=process.argv[3];if(prefix&&!prefix.startsWith('--')){fs.writeFileSync(prefix+'.rgba',data);fs.writeFileSync(prefix+'.json',JSON.stringify({width,height}));}
 if(process.argv.includes('--scan')){const V=require('../desktop/lib/arcana/vision'),img={width,height,data},start=performance.now(),cards=V.cards(img),cardMs=performance.now()-start,bases=V.findBases(img),baseMs=performance.now()-start-cardMs,life=V.findLife(img);console.log(JSON.stringify({width,height,cardMs,baseMs,totalMs:performance.now()-start,cards,bases,life}));}
 app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
