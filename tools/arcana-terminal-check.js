'use strict';
// Exhaustive independent action-order enumeration: Monte Carlo must not
// leave deterministic chest upgrades unused or spend them in a worse order.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),E=require('../desktop/lib/arcana/engine'),solverAt=process.argv.indexOf('--solver'),S=require(solverAt<0?'../desktop/lib/arcana/solver':path.resolve(process.argv[solverAt+1]));
const pool=[201,202,203,204,211,212,213,214,221,222,223,224],r=E.rng(0x705723),memo=new Map();let states=0;
function exact(chests,hand){
 const key=chests.slice().sort().join(',')+'|'+hand.slice().sort((a,b)=>a-b).join(',');if(memo.has(key))return memo.get(key);states++;
 let best=E.score({chests});const seen=new Set();
 for(let i=0;i<hand.length;i++){const id=hand[i];if(seen.has(id))continue;seen.add(id);const c=E.CARDS.get(id),e=E.DATA.events[c.events[0]],next={chests:chests.slice()};E.upgrade(next,e.a[0],e.p[0],e.c.length?e.c:null);best=Math.max(best,exact(next.chests,hand.filter((_,j)=>j!==i)));}
 memo.set(key,best);return best;
}
for(let i=0;i<120;i++){
 const s={...E.blank(8),position:7,life:1+Math.floor(r()*6),die:1+Math.floor(r()*6),hand:Array.from({length:2+i%5},()=>E.pick(pool,r)),chests:Array.from({length:1+i%7},()=>1+Math.floor(r()*6)),path:Array.from({length:8},()=>({kind:'empty',used:true})),confirmed:true,lengthConfirmed:true};
 const optimal=exact(s.chests,s.hand),j=S.createJob(s,{samples:8,verifySamples:16,seed:i+1});while(!j.step(8)){}assert.equal(j.result().best.mean,optimal,`Suboptimal terminal upgrade order on fixture ${i}: ${JSON.stringify({hand:s.hand,chests:s.chests})}`);
}
const report={version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),fixtures:120,exhaustiveStates:states,exactOptimalTerminalScore:true,scope:'All permutations of owned capped +1 upgrade cards on the last tile, without backward movement or unknown events.',gameCapture:false,gameInput:false};
fs.writeFileSync(path.resolve(__dirname,'results/arcana-terminal.json'),JSON.stringify(report,null,2)+'\n');console.log(`PASS: final upgrade recommendations match exhaustive optimum on 120 inventories (${states} states).`);
