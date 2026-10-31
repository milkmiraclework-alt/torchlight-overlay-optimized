'use strict';
// Exact optimization check against an explicitly supplied snapshot of our
// own solver. No third-party policy, game capture or input.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const at=process.argv.indexOf('--baseline');if(at<0)throw Error('Supply --baseline <our historical solver directory>');
const file=path.join(path.resolve(process.argv[at+1]),'solver.js'),Old=require(file),S=require('../desktop/lib/arcana/solver'),E=require('../desktop/lib/arcana/engine'),r=E.rng(0x243adef),pool=E.DATA.cards.filter(c=>c.tag!==99&&c.weight>0).map(c=>c.id);
function solve(solver,s,seed){const job=solver.createJob(s,{samples:32,verifySamples:64,seed});while(!job.step(8)){}const v=job.result();return {options:v.options,target:v.target,totalRollouts:v.totalRollouts,verifiedCandidates:v.verifiedCandidates};}
let decisions=0;
for(let i=0;i<80;i++){
 const s={...E.blank(24+i%4*8),position:i%3===0?0:i%3===1?12:23,life:1+Math.floor(r()*6),die:1+Math.floor(r()*6),hand:Array.from({length:2+i%8},()=>E.pick(pool,r)),chests:Array.from({length:i%8},()=>1+Math.floor(r()*6)),confirmed:true,lengthConfirmed:true};
 s.path=s.path.map((_,k)=>{if(k>20&&i%2)return {kind:'unknown'};const n=r();return n<.2?{kind:'chest',tier:1+Math.floor(r()*6)}:n<.35?{kind:'trap',amount:1}:n<.45?{kind:'heal',amount:1}:n<.65?{kind:'effect',id:E.pick([1021,1101,1102,1103,1104],r)}:{kind:'empty'};});
 const seed=Math.floor(r()*0xffffffff),expected=solve(Old,s,seed),actual=solve(S,s,seed);assert.deepEqual(actual,expected,`Optimization changed candidate totals on fixture ${i}`);decisions++;
}
fs.writeFileSync(path.resolve(__dirname,'results/arcana-solver-parity.json'),JSON.stringify({version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),source:'Exact totals against our own pre-optimization solver snapshot.',baselineSha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),solverSha256:crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../desktop/lib/arcana/solver.js'))).digest('hex'),decisions,exactCandidateTotals:true,gameCapture:false,gameInput:false},null,2)+'\n');
console.log(`PASS: all candidate totals and selected actions match our pre-optimization solver on ${decisions} fixtures.`);
