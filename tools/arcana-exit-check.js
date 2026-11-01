'use strict';
const assert=require('node:assert/strict'),E=require('../desktop/lib/arcana/engine'),S=require('../desktop/lib/arcana/solver');
function solve(s,verify=3){const j=S.createJob(s,{samples:16,verify,verifySamples:32});while(!j.step(16)){}return j.result();}
function fixture(hand,chests){const s={...E.blank(24),position:0,life:2,die:1,hand,chests,confirmed:true,lengthConfirmed:true};s.path=s.path.map(()=>({kind:'trap',amount:2}));return s;}
for(const verify of [0,3]){
 const s=fixture([11,204],[4]),unchanged=JSON.stringify(s);const r=solve(s,verify);assert.equal(JSON.stringify(s),unchanged,'Exit planning changed the observed board');assert.equal(r.best.action.kind,'card');assert.equal(r.best.action.index,1);assert.equal(r.best.mean,10);assert.equal(r.best.guaranteedExit,true);
 const before=JSON.stringify(s);let steps=0;
 while(!s.ended&&steps++<10){const next=solve(s,verify).best;E.apply(s,next.action,E.rng(1));}
 assert(s.ended);assert.equal(E.score(s),10);assert.notEqual(JSON.stringify(s),before);
 const chain=fixture([11,201,202],[1]),first=solve(chain,verify).best;
 assert.equal(first.action.id,201,'Zero immediate points hid the first step of an upgrade chain');assert.equal(first.mean,3);
 let chainSteps=0;while(!chain.ended&&chainSteps++<10)E.apply(chain,solve(chain,verify).best.action,E.rng(1));
 assert(chain.ended);assert.equal(E.score(chain),3);
 const finished=solve(fixture([204],[6]),verify);assert.equal(finished.best.action.kind,'end','A useless upgrade delayed finishing');
 const progressing=fixture([],[]);progressing.path=progressing.path.map(()=>({kind:'empty'}));progressing.path[1]={kind:'chest',tier:6};assert.equal(solve(progressing,verify).best.action.kind,'die','The exit guard replaced a productive continuation');
}
console.log('PASS: finishing cannot discard a deterministic profitable upgrade; original hand indices, useless upgrades and productive moves remain correct in both solver paths.');
