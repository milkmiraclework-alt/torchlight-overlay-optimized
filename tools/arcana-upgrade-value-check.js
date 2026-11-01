'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),E=require('../desktop/lib/arcana/engine'),U=require('./arcana-upgrade-value');
const spec=id=>{const e=E.DATA.events[E.CARDS.get(id).events[0]];return {e,n:e.a[0]};};
function brute(chests,ids){let best=E.score({chests});for(let i=0;i<ids.length;i++){const q=spec(ids[i]),s={chests:chests.slice()};E.upgrade(s,q.n,q.e.p[0],q.e.c.length?q.e.c:null);best=Math.max(best,brute(s.chests,ids.filter((_,j)=>j!==i)));}return best;}
const cases=[{chests:[2,3,2,2],hand:[213,53],expected:32},{chests:[2,2,3,3,3],hand:[223,58,222,59],expected:125},{chests:[1,1],hand:[212,54,213,53,201],expected:35},{chests:[2,5,3,5,1],hand:[51,58,51,58],expected:110}];
for(const c of cases){assert.equal(brute(c.chests,c.hand),c.expected);assert.equal(U.score(c.chests,c.hand.map(spec)),c.expected);}
const ids=[51,52,53,54,55,56,57,58,59,201,202,203,204,211,212,213,214,221,222,223,224],r=E.rng(0x2a2026);
for(let n=0;n<256;n++){
 const chests=Array.from({length:1+Math.floor(r()*7)},()=>1+Math.floor(r()*6)),hand=Array.from({length:1+Math.floor(r()*5)},()=>E.pick(ids,r)),before=JSON.stringify([chests,hand]);
 assert.equal(U.score(chests,hand.map(spec)),brute(chests,hand),'Exact upgrade value differs from every-order enumeration');
 assert.equal(U.score(chests.slice().reverse(),hand.slice().reverse().map(spec)),brute(chests,hand),'Inventory order leaked into memo');assert.equal(JSON.stringify([chests,hand]),before);
}
fs.writeFileSync('tools/results/arcana-upgrade-value.json',JSON.stringify({checkedAt:new Date().toISOString(),scope:'Owned inventory, deterministic upgrade chains; not a profit measurement',counterexamples:cases,randomInventories:256,bruteForceAgreement:true,orderIndependentCache:true,inputUnchanged:true},null,2)+'\n');
console.log('PASS: exact upgrade value on four heuristic counterexamples and 256 inventories against independent every-order enumeration; order-independent cache and immutable inputs.');
