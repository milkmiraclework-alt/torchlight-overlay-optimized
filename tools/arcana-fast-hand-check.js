'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const V=require('../desktop/lib/arcana/vision'),G=require('../desktop/lib/arcana/geometry'),Fast=require('../desktop/lib/arcana/fast-hand');
const frames=process.argv.flatMap((a,i)=>a==='--frame'?[path.resolve(process.argv[i+1])]:[]);if(!frames.length)throw Error('Supply saved --frame <RGBA prefix>');
function resize(s,scale){if(scale===1)return s;const width=Math.round(s.width*scale),height=Math.round(s.height*scale),data=Buffer.alloc(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([...V.sample(s,Math.max(0,Math.min(s.width-1,(x+.5)/scale-.5)),Math.max(0,Math.min(s.height-1,(y+.5)/scale-.5))),255],(y*width+x)*4);return {width,height,data};}
const cases=[],benchmarks=[];
for(const frame of frames){
 const original={...JSON.parse(fs.readFileSync(frame+'.json')),data:fs.readFileSync(frame+'.rgba')},reference=path.basename(frame)==='reference-play',expected=reference?[1,204,213,201]:path.basename(frame)==='user-193821'?[13]:[22,13,4,21],expectedDie=reference?1:6;
 for(const scale of reference?[1,.75,1.053125]:[1,.75,.625]){const img=resize(original,scale),g=G.grid(V.findBases(img)),result=Fast.create().read(img,g);assert(result,'Fast reader missed '+frame+' scale '+scale);assert.deepEqual(result.hand,expected);assert.equal(result.die,expectedDie);assert.equal(result.handCount,expected.length);cases.push({frame:path.basename(frame),width:img.width,height:img.height,hand:result.hand,die:result.die});}
 for(const offset of [1,2,3,4,5,7]){const img={width:original.width+10,height:original.height+8,data:Buffer.alloc((original.width+10)*(original.height+8)*4)};for(let y=0;y<original.height;y++)original.data.copy(img.data,((y+offset%5)*img.width+offset)*4,y*original.width*4,(y+1)*original.width*4);const r=Fast.create().read(img,G.grid(V.findBases(img)));assert(r,'Fast reader missed border '+offset);assert.deepEqual(r.hand,expected);assert.equal(r.die,expectedDie);cases.push({frame:path.basename(frame),border:offset,hand:r.hand,die:r.die});}
 const grid=G.grid(V.findBases(original)),fast=Fast.create(),first=fast.read(original,grid);assert(first);
 function cover(box){const img={...original,data:Buffer.from(original.data)};for(let y=Math.max(0,Math.floor(box.y));y<Math.min(img.height,Math.ceil(box.y+box.h));y++)for(let x=Math.max(0,Math.floor(box.x));x<Math.min(img.width,Math.ceil(box.x+box.w));x++)img.data.set([35,20,58,255],(y*img.width+x)*4);return img;}
 const card=first.handMatches[Math.min(1,first.handMatches.length-1)].box;assert.equal(Fast.create().read(cover(card),grid),null,'A covered face was confidently accepted');
 const counter=first.counterMatch.box;assert.equal(Fast.create().read(cover({x:counter.x+counter.w*.95,y:counter.y-counter.h*.5,w:counter.w*5,h:counter.h*2}),grid),null,'An unreadable card counter was accepted');
 const fastMs=[],templateMs=[];for(let i=0;i<3;i++){let t=performance.now();assert(fast.read(original,grid));fastMs.push(performance.now()-t);t=performance.now();assert.deepEqual(V.cards(original).hand,expected);templateMs.push(performance.now()-t);}
 const median=a=>a.sort((x,y)=>x-y)[1];benchmarks.push({frame:path.basename(frame),scope:'Hand and refill only; warm calibrated reader, same saved pixels',trainedMedianMs:median(fastMs),templateMedianMs:median(templateMs)});
}
assert.equal(Fast.create().read({width:640,height:360,data:Buffer.alloc(640*360*4)},null),null);
fs.writeFileSync(path.join(__dirname,'results/arcana-fast-hand.json'),JSON.stringify({version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),cases,benchmarks,coveredFaceRejected:true,unreadableCountRejected:true,blankRejected:true,gameCapture:false,gameInput:false},null,2)+'\n');
console.log('PASS: authorised trained hand/die reading, three scales and six border phases, face/counter occlusion guards and same-frame performance measurements.');
