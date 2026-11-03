'use strict';
// Timer's authorised layout model supplies hidden worlds. Local transitions,
// scoring and observed cells stay in our engine; sampled cells never become
// confirmed observations. A logged appearance overrides a regional prior.
const Reference=require('./timer-reader/route-engine');
const lengths=Object.fromEntries(['normal','special1','special2','special3','special4'].map(type=>[type,Reference.makeBoard(type,Reference.makeRng(1)).length]));
const colours=['','green','blue','purple','orange','red','rainbow'];
function available(s){const m=s.pathMode;return !!s.lengthConfirmed&&!s.localHorizon&&m?.confirmed&&m.source==='game-log-patterns'&&m.confidence>=.97&&m.length===s.path.length&&lengths[m.type]===s.path.length;}
function observed(t,i){
 if(!i)return {type:'start'};
 if(t.kind==='unknown')return t.look==='chest'?{type:'chest',rarity:null}:{type:'hidden',...(t.look?{hint:t.look}:{})};
 if(t.kind==='chest')return {type:'chest',rarity:colours[t.tier]};
 if(t.kind==='trap')return {type:'trap'};
 if(t.kind==='heal')return {type:'life',fixedN:t.amount||1};
 if(t.kind==='random')return {type:'question'};
 if(t.kind==='draw')return {type:'movement',cardCount:t.amount||1};
 if(t.kind==='grant')return t.id>=1&&t.id<=6?{type:'movement',fixedN:t.id}:{type:'movement',cardCount:1};
 if(t.kind==='effect'&&t.id>=1021&&t.id<=1023)return {type:'movement',cardCount:t.id-1020};
 if(t.kind==='effect'&&t.id>=1101&&t.id<=1104)return {type:'upgrade',fixedFrom:colours[t.id-1099]};
 // A known effect outside the fitted model is still a known cell. The
 // sampler does not replace it; count it as plain for hidden-layout fitting.
 return {type:'empty'};
}
function input(t,i){
 // A consumed chest is no longer collectible, but it still counts among the
 // route's observed chests. Erasing its original type makes the conditional
 // generator invent those rewards again in the remaining hidden prefix.
 let out=observed(t,i);
 if(t.used&&t.kind==='empty'&&t.look)out=t.look==='chest'?{type:'chest',rarity:null}:{type:'hidden',hint:t.look};
 return t.used?{...out,used:true}:out;
}
function tile(t){
 if(t.type==='chest'){const tier=colours.indexOf(t.rarity);if(tier<1)throw Error('Unknown sampled chest rarity');return {kind:'chest',tier};}
 if(t.type==='trap')return {kind:'trap',amount:1};
 if(t.type==='life')return {kind:'heal',amount:t.fixedN||1};
 if(t.type==='question')return {kind:'random'};
 if(t.type==='upgrade'){const tier=colours.indexOf(t.fixedFrom);if(tier<2||tier>5)throw Error('Unknown sampled upgrade note');return {kind:'effect',id:1099+tier};}
 if(t.type==='movement')return t.fixedN?{kind:'grant',id:t.fixedN}:{kind:'effect',id:1020+(t.cardCount||1)};
 if(t.type==='empty'||t.type==='start')return {kind:'empty'};
 throw Error('Unsupported hidden-world tile: '+t.type);
}
function fits(t,look){if(!look)return true;if(look==='chest')return t.type==='chest';if(look==='plain')return ['empty','start','movement','upgrade'].includes(t.type);return ['trap','life','question','movement'].includes(t.type);}
function sample(s,r){
 if(!available(s))return null;
 const tiles=s.path.map(input),seed=Math.floor(r()*0x100000000),random=Reference.makeRng(seed),world={total:tiles.length,tiles,boardType:s.pathMode.type,futureUpgrade:0};Reference.determinize(world,random);
 const mismatched=s.path.flatMap((t,i)=>t.kind==='unknown'&&!t.used&&!fits(world.tiles[i],t.look)?[i]:[]);
 if(mismatched.length){
  // Special layouts can have consumed/mutated cells inconsistent with their
  // original stage. Use the reference's appearance-conditioned general model
  // for those cells, rather than inventing a chest behind a logged plain cell.
  const fallback={total:tiles.length,tiles:s.path.map((t,i)=>mismatched.includes(i)?input(t,i):{type:'empty'}),boardType:'normal',futureUpgrade:0};Reference.determinize(fallback,random);
  for(const i of mismatched){if(!fits(fallback.tiles[i],s.path[i].look))throw Error('Sampled world contradicts a logged appearance');world.tiles[i]=fallback.tiles[i];}
 }
 return s.path.map((t,i)=>t.kind==='unknown'?(t.used?{kind:'empty',used:true,sampled:true}:{...tile(world.tiles[i]),used:false,sampled:true}):t);
}
module.exports={available,sample,lengths};
