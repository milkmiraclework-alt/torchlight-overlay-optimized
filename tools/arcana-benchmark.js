'use strict';
const E=require('../desktop/lib/arcana/engine'),S=require('../desktop/lib/arcana/solver'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const cases=[];
for(const position of [0,36,72,79]){
 const r=E.rng(500+position),s=E.blank(80);Object.assign(s,{position,life:3,die:4,hand:[1,3,11,23,24,201,204,214],chests:position>0?[3,4,5]:[],confirmed:true,lengthConfirmed:true});
 s.path=s.path.map((_,i)=>{const n=r();return n<.20?{kind:'chest',tier:1+Math.floor(r()*6)}:n<.47?{kind:'trap',amount:1}:n<.55?{kind:'heal',amount:1}:{kind:'empty'};});
 if(position===79){s.chests=[5,5,4,3];s.hand=[204,214,11,24];}
 const durations=[];let output;
 for(let repeat=0;repeat<3;repeat++){const start=performance.now(),j=S.createJob(s,{samples:128});while(!j.step(8)){}output=j.result();durations.push(performance.now()-start);}
 durations.sort((a,b)=>a-b);const row={position,learningSamplesPerOption:128,screenSamples:output.screenSamples||0,extraSamplesPerFinalist:256,learningRollouts:output.learningRollouts||0,continuationStates:output.continuationStates||0,exact:!!output.exact,totalRollouts:output.totalRollouts,options:output.options.length,medianMs:durations[1],minMs:durations[0],maxMs:durations[2],move:output.best.label};cases.push(row);console.log(JSON.stringify(row));
}
fs.writeFileSync(path.resolve(__dirname,'results/arcana-performance.json'),JSON.stringify({version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),cpu:os.cpus()[0]?.model,logicalProcessors:os.availableParallelism?.()||os.cpus().length,scope:'Independent single warmed Node solver, synthetic fully observed boards; excludes game capture/recognition/UI. No comparison to Arcana Helper.',gameCapture:false,gameInput:false,cases},null,2)+'\n');
