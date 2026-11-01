'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),V=require('../desktop/lib/arcana/vision');
const at=process.argv.indexOf('--frame');if(at<0)throw Error('Supply --frame <saved 222112 RGBA prefix>');
const p=process.argv[at+1],source={...JSON.parse(fs.readFileSync(p+'.json')),data:fs.readFileSync(p+'.rgba')};
const cases=[];
for(const scale of [1,.75,.625]){
 const width=Math.round(source.width*scale),height=Math.round(source.height*scale),data=Buffer.alloc(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const rgb=V.sample(source,Math.min(source.width-1,(x+.5)/scale-.5),Math.min(source.height-1,(y+.5)/scale-.5));const i=(y*width+x)*4;data[i]=rgb[0];data[i+1]=rgb[1];data[i+2]=rgb[2];data[i+3]=255;}
 const start=performance.now(),read=V.cards({width,height,data});
 assert.deepEqual(read.hand,[22,13,4,21],`Wrong hand at ${width}x${height}`);assert.equal(read.die,6);assert.equal(read.handConfident,true,'Correct cards remained blocked');
 assert.equal(read.handMatches.length,4,'Refill die leaked into the hand');
 cases.push({width,height,hand:read.hand,refillDie:read.die,confident:read.handConfident});
 console.log(`PASS: saved 222112 frame ${width}x${height}, four cards in order, separate refill die, ${Math.round(performance.now()-start)}ms.`);
}
assert.equal(V.cards({width:640,height:360,data:Buffer.alloc(640*360*4)}).handConfident,false,'An empty picture passed hand confirmation');
const parsed=require('../desktop/lib/arcana/reader').create().read(source);
assert.deepEqual(parsed.model.hand,[22,13,4,21]);assert.equal(parsed.model.die,6);
assert.equal(parsed.issues.some(issue=>issue.includes('card faces')||issue.includes('refill die')),false,'The actual reader still rejected the correctly recognised hand');
assert(parsed.issues.some(issue=>issue.includes('path length')),'Hand recovery bypassed initial path confirmation');
fs.writeFileSync(require('node:path').resolve(__dirname,'results/arcana-hand.json'),JSON.stringify({version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),source:'User-supplied saved 222112 frame; image remains outside the repository.',gameCapture:false,gameInput:false,cases,emptyFrameRejected:true},null,2)+'\n');
