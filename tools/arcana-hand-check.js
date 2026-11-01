'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),V=require('../desktop/lib/arcana/vision');
const prefixes=process.argv.flatMap((arg,i)=>arg==='--frame'?[process.argv[i+1]]:[]);if(!prefixes.length)throw Error('Supply --frame <saved hand RGBA prefix>; repeat for neighbouring frames');
const cases=[];
for(const p of prefixes){
const source={...JSON.parse(fs.readFileSync(p+'.json')),data:fs.readFileSync(p+'.rgba')};
for(const scale of [1,.75,.625]){
 const width=Math.round(source.width*scale),height=Math.round(source.height*scale),data=Buffer.alloc(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const rgb=V.sample(source,Math.min(source.width-1,(x+.5)/scale-.5),Math.min(source.height-1,(y+.5)/scale-.5));const i=(y*width+x)*4;data[i]=rgb[0];data[i+1]=rgb[1];data[i+2]=rgb[2];data[i+3]=255;}
 const start=performance.now(),read=V.cards({width,height,data});
 assert.deepEqual(read.hand,[22,13,4,21],`Wrong hand at ${width}x${height}`);assert.equal(read.die,6);assert.equal(read.handConfident,true,'Correct cards remained blocked');
 assert.equal(read.handMatches.length,4,'Refill die leaked into the hand');
 if(scale===1)assert.equal(read.handCount,4,'The complete 4/10 counter was not recognised');
 cases.push({frame:require('node:path').basename(p),width,height,hand:read.hand,refillDie:read.die,confident:read.handConfident,counter:read.handCount});
 console.log(`PASS: saved 222112 frame ${width}x${height}, four cards in order, separate refill die, ${Math.round(performance.now()-start)}ms.`);
}
const covered={...source,data:Buffer.from(source.data)};
for(let y=Math.floor(source.height*.894);y<source.height;y++)for(let x=Math.floor(source.width*.383);x<source.width*.428;x++)covered.data.fill(0,(y*source.width+x)*4,(y*source.width+x)*4+4);
const incomplete=V.cards(covered);assert.equal(incomplete.handConfident,false,'A covered first card was silently removed from the hand');assert.equal(incomplete.handCount,4,'The counter was lost when a card face was covered');
for(const offset of [1,2]){
 const width=source.width+offset*2,height=source.height+offset*2,data=Buffer.alloc(width*height*4);
 for(let y=0;y<source.height;y++)source.data.copy(data,((y+offset)*width+offset)*4,y*source.width*4,(y+1)*source.width*4);
 const shifted=V.cards({width,height,data});assert.deepEqual(shifted.hand,[22,13,4,21],'A capture-border shift changed the hand');assert.equal(shifted.handConfident,true);
}
const counter=V.cards(source).counterMatch;assert(counter);
const malformed={...source,data:Buffer.from(source.data)};
for(let y=Math.floor(counter.box.y-counter.box.h*.5);y<counter.box.y+counter.box.h*1.5;y++)for(let x=Math.floor(counter.box.x+counter.box.w*3.2);x<counter.box.x+counter.box.w*4.8;x++)malformed.data.fill(0,(y*source.width+x)*4,(y*source.width+x)*4+4);
assert.equal(require('../desktop/lib/arcana/digits').handCount(malformed,{x:counter.box.x+counter.box.w*.95,y:counter.box.y-counter.box.h*.5,w:counter.box.w*5,h:counter.box.h*2}),null,'An incomplete x/10 counter was accepted');
const parsed=require('../desktop/lib/arcana/reader').create().read(source);
assert.deepEqual(parsed.model.hand,[22,13,4,21]);assert.equal(parsed.model.die,6);assert.equal(parsed.model.life,2,'The blue life digit was rejected');
assert.equal(parsed.issues.some(issue=>issue.includes('card faces')||issue.includes('refill die')),false,'The actual reader still rejected the correctly recognised hand');
assert(parsed.issues.some(issue=>issue.includes('path length')),'Hand recovery bypassed initial path confirmation');
}
assert.equal(V.cards({width:640,height:360,data:Buffer.alloc(640*360*4)}).handConfident,false,'An empty picture passed hand confirmation');
fs.writeFileSync(require('node:path').resolve(__dirname,'results/arcana-hand.json'),JSON.stringify({version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),source:'Existing saved hand frames; images remain outside the repository.',gameCapture:false,gameInput:false,cases,emptyFrameRejected:true,coveredCardRejected:true,completeCounterVerified:true},null,2)+'\n');
