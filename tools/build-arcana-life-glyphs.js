'use strict';
// Offline training from explicitly labelled, existing game pictures. Runtime
// recognition never assigns labels to itself or relaxes its confidence guards.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
if(!process.versions.electron){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const r=cp.spawnSync(require('../desktop/node_modules/electron'),[__filename,...process.argv.slice(2)],{env,encoding:'utf8',windowsHide:true});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exit(r.status??1);}
const {app,nativeImage}=require('electron');app.disableHardwareAcceleration();app.whenReady().then(()=>{
 const at=process.argv.indexOf('--digit'),digit=at<0?NaN:Number(process.argv[at+1]);if(!Number.isInteger(digit)||digit<0||digit>6)throw Error('Supply --digit <0..6>');
 const files=process.argv.flatMap((a,i)=>a==='--sample'?[path.resolve(process.argv[i+1])]:[]);if(files.length<2)throw Error('Supply at least two independently labelled --sample images');
 const V=require('../desktop/lib/arcana/vision'),D=require('../desktop/lib/arcana/digits'),out=path.resolve(__dirname,'../desktop/lib/arcana/game-life-glyphs.json'),data=JSON.parse(fs.readFileSync(out));
 for(const file of files){
  const image=nativeImage.createFromPath(file);if(image.isEmpty())throw Error('Cannot decode '+file);const size=image.getSize(),pixels=image.toBitmap();for(let i=0;i<pixels.length;i+=4){const r=pixels[i];pixels[i]=pixels[i+2];pixels[i+2]=r;pixels[i+3]=255;}const img={...size,data:pixels},life=V.findLife(img,V.findBases(img));if(!life||life.score<.88)throw Error('Life badge not found in '+file);
  const b=life.box,samples=D.glyphSamples(img,{x:b.x+b.w*1.04,y:b.y-b.h*.1,w:b.w*1.7,h:b.h*1.2});if(samples.length<2)throw Error('Insufficient complete glyph samples in '+file);
  const sha256=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');data.sources.push({file:path.basename(file),digit,sha256});for(const sample of samples)data.glyphs.push({...sample,digit:String(digit)});
 }
 data.glyphs=[...new Map(data.glyphs.map(g=>[g.digit+'|'+g.bits+'|'+g.aspect,g])).values()];data.sources=[...new Map(data.sources.map(s=>[s.sha256,s])).values()];fs.writeFileSync(out,JSON.stringify(data,null,2)+'\n');console.log('Built '+data.glyphs.length+' authentic life glyphs from '+data.sources.length+' labelled saved pictures.');app.exit();
}).catch(error=>{console.error(error);app.exit(1);});
