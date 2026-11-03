'use strict';
// Only completed, positively located game events create these observations.
// They describe changes already made to unseen terrain, not future effects.
const DATA=require('./game-data.json');
const clean=text=>String(text||'').trim().replace(/[.!]+$/,'').replace(/\s+/g,' ').toLowerCase();
const effects=new Map([
 [9217,{kind:'map_chests',plus:1}],
 [9218,{kind:'map_chests',to:'red'}],
 [9219,{kind:'map_chests',to:'rainbow'}],
 [9221,{kind:'no_traps'}],
 [9222,{kind:'traps_to_chests'}]
].map(([id,mod])=>[clean(DATA.events[id].text),mod]));
function normalize(value,length){
 if(!Array.isArray(value))return [];
 return value.slice(0,400).flatMap(m=>{
  if(!m||!Number.isInteger(m.from)||m.from<0||m.from>=length)return [];
  if(m.kind==='map_chests'){
   if(['red','rainbow'].includes(m.to))return [{from:m.from,kind:m.kind,to:m.to}];
   if(m.plus===1)return [{from:m.from,kind:m.kind,plus:1}];
  }
  return ['no_traps','traps_to_chests'].includes(m.kind)?[{from:m.from,kind:m.kind}]:[];
 });
}
function fromText(text,position){
 const effect=effects.get(clean(text));
 return effect&&Number.isInteger(position)&&position>=0&&position<400?{from:position,...effect}:null;
}
function fits(tile,look,index,mods=[]){
 if(!look)return true;
 let kinds=new Set(look==='chest'?['chest']:look==='plain'?['empty','start','movement','upgrade']:['trap','life','question','movement']);
 for(const m of mods){
  if(index<=m.from)continue;
  if(m.kind==='no_traps'&&kinds.delete('trap'))kinds.add('empty');
  if(m.kind==='traps_to_chests'&&kinds.delete('trap'))kinds.add('chest');
 }
 return kinds.has(tile.type);
}
module.exports={normalize,fromText,fits};
