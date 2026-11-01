'use strict';
const E=require('../desktop/lib/arcana/engine');
// Exact owned-inventory value only: no hidden tiles or sampled outcomes.
const memo=new Map(),normalized=new WeakMap(),LIMIT=65536;
function normalize(spec){
 let value=normalized.get(spec);if(value)return value;
 const {e,n}=spec;
 if(e.p[2]===2||e.a[0]!==e.a[1])throw Error('Exact upgrade value requires deterministic upgrades');
 value={n,amount:e.p[0],eligible:e.c.length?e.c:null,key:[n,e.p[0],e.c.join('.')].join(':')};normalized.set(spec,value);return value;
}
function best(chests,specs){
 if(!specs.length||!chests.length)return E.score({chests});
 const key=chests.slice().sort((a,b)=>a-b).join(',')+'|'+specs.map(q=>q.key).join(';');
 if(memo.has(key))return memo.get(key);
 let value=E.score({chests});const upper=chests.length*25,seen=new Set();
 for(let i=0;i<specs.length&&value<upper;i++){
  const q=specs[i];if(seen.has(q.key))continue;seen.add(q.key);
  const next={chests:chests.slice()};E.upgrade(next,q.n,q.amount,q.eligible);
  if(next.chests.every((t,j)=>t===chests[j]))continue;
  value=Math.max(value,best(next.chests,specs.filter((_,j)=>j!==i)));
 }
 if(memo.size>=LIMIT)memo.clear();memo.set(key,value);return value;
}
function score(chests,specs){return best(chests,specs.map(normalize).sort((a,b)=>a.key.localeCompare(b.key)));}
module.exports={score,clear:()=>memo.clear(),size:()=>memo.size};
