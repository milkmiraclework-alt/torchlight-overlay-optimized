'use strict';
// Independent S9 state transitions. Data is extracted from the player's game,
// not from Arcana Helper. Rarities here are 1..6 (game values minus one).
const DATA=require('./game-data.json');
const CARDS=new Map(DATA.cards.map(c=>[c.id,c]));
const POINTS=[0,1,1,3,5,10,25],TIERS=['Unknown','Green','Blue','Purple','Gold','Red','Rainbow'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const integer=(v,a,b,name)=>{if(!Number.isInteger(v)||v<a||v>b)throw Error(`Check ${name}.`);return v;};
function blank(length=80){return {position:0,life:null,die:null,rerollBudget:3,hand:[],chests:[],path:Array.from({length},()=>({kind:'unknown'})),confirmed:false,lengthConfirmed:false,pending:null};}
function normalize(value){
 if(!value||typeof value!=='object')throw Error('No Arcana state.');
 if(!Array.isArray(value.path)||value.path.length<2||value.path.length>400)throw Error('Check the path length (2–400).');
 const s={...blank(value.path.length),position:integer(value.position,0,value.path.length-1,'position'),life:integer(value.life,0,6,'life'),die:integer(value.die,1,6,'refill die'),
  hand:[],chests:[],rerollBudget:integer(value.rerollBudget??3,0,3,'refill planning budget'),confirmed:value.confirmed===true,lengthConfirmed:value.lengthConfirmed===true,pending:null};
 if(!Array.isArray(value.hand)||value.hand.length>10)throw Error('Check the hand (at most 10 cards).');
 s.hand=value.hand.map(id=>{if(!CARDS.has(id)||CARDS.get(id).tag===99)throw Error('Check the hand: unknown card.');return id;});
 if(!Array.isArray(value.chests)||value.chests.length>7)throw Error('Check collected chests (at most 7).');
 s.chests=value.chests.map(t=>integer(t,1,6,'chest rarity'));
 s.path=value.path.map((t,i)=>{
  if(!t||t.kind==='unknown')return {kind:'unknown'};
  if(!['empty','chest','trap','heal','draw','random','end','effect','copy'].includes(t.kind))throw Error(`Check tile ${i}.`);
  const out={kind:t.kind};
  if(t.kind==='chest')out.tier=integer(t.tier,1,6,`tile ${i} rarity`);
  if(['trap','heal','draw'].includes(t.kind))out.amount=integer(t.amount||1,1,10,`tile ${i} amount`);
  if(t.kind==='effect'){if(!DATA.tiles[t.id])throw Error(`Unknown tile ${i} effect.`);out.id=t.id;}
  if(t.used)out.used=true;return out;
 });
 // The current tile has already settled in a confirmed board. A manual
 // correction must not make its chest/effect collectible a second time.
 s.path[s.position]=s.path[s.position].kind==='unknown'?{kind:'empty',used:true}:{...s.path[s.position],used:true};
 if(value.pending){
  if(!['choose','copy'].includes(value.pending.kind)||!Array.isArray(value.pending.cards)||value.pending.cards.length<1||value.pending.cards.length>12)throw Error('Check the card choice.');
  s.pending={kind:value.pending.kind,cards:value.pending.cards.map(id=>{if(!CARDS.has(id))throw Error('Unknown offered card.');return id;})};
  if(value.pending.kind==='choose'&&value.pending.source!==undefined){
   s.pending.source=integer(value.pending.source,0,s.hand.length-1,'spent choice card');
   const allowed=CARDS.get(s.hand[s.pending.source]).choices;
   if(!allowed.length||!s.pending.cards.every(id=>allowed.includes(id)))throw Error('The offered notes do not match the selected choice note. Check the offer, or select Already spent.');
  }
 }
 return s;
}
function rng(seed){let x=seed>>>0||1;const next=()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;};next.state=()=>x>>>0;return next;}
const pick=(xs,r)=>xs[Math.min(xs.length-1,Math.floor(r()*xs.length))];
const range=(a,b)=>Array.from({length:Math.max(0,b-a+1)},(_,i)=>a+i);
function count(a,r){return a.length===2?Math.floor(r()*(a[1]-a[0]+1))+a[0]:pick(a,r)||0;}
function weighted(items,weight,r){const total=items.reduce((s,v)=>s+weight(v),0);if(!(total>0))return null;let x=r()*total;for(const item of items){x-=weight(item);if(x<0)return item;}return items.at(-1);}
function clone(s,cow=false){return {...s,hand:s.hand.slice(),chests:s.chests.slice(),path:cow?s.path.slice():s.path.map(t=>({...t})),pending:s.pending?{...s.pending,cards:s.pending.cards.slice()}:null,...(cow?{_sharedPath:true}:{})};}
function score(s){return s.chests.reduce((v,t)=>v+POINTS[t],0);}
function upgrade(s,n,amount,eligible=null,order='highest',r=Math.random){
 if(order==='highest'&&amount>0){
  // Descending traversal visits every selected chest once: an upgraded
  // chest moves into a tier that this traversal has already passed.
  for(let tier=5;tier>=1&&n>0;tier--){if(eligible&&!eligible.includes(tier+1))continue;for(let i=0;i<s.chests.length&&n>0;i++)if(s.chests[i]===tier){s.chests[i]=clamp(tier+amount,1,6);n--;}}
  return;
 }
 const ids=s.chests.map((tier,i)=>({tier,i})).filter(v=>v.tier<6&&(!eligible||eligible.includes(v.tier+1)));
 if(order==='random'){for(let i=ids.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]];}}
 else ids.sort((a,b)=>b.tier-a.tier||a.i-b.i);
 // Each selected chest is raised once; do not repeatedly promote one chest
 // when a ×2/×3 card names multiple different chests.
 for(const {i} of ids.slice(0,n))s.chests[i]=clamp(s.chests[i]+amount,1,6);
}
const drawPoolCache=new Map();
function draw(s,n,r,allowed=null,tags=null){
 let byTags=drawPoolCache.get(allowed);if(!byTags){byTags=new Map();drawPoolCache.set(allowed,byTags);}
 let pool=byTags.get(tags);if(!pool){const cards=DATA.cards.filter(c=>c.tag!==99&&c.weight>0&&(!allowed||allowed.includes(c.id))&&(!tags||!tags.length||tags.includes(c.tag)));pool={cards,total:cards.reduce((n,c)=>n+c.weight,0)};byTags.set(tags,pool);}
 for(let i=0;i<n&&s.hand.length<10;i++){
  if(!(pool.total>0))break;let x=r()*pool.total,chosen=pool.cards.at(-1);for(const c of pool.cards){x-=c.weight;if(x<0){chosen=c;break;}}s.hand.push(chosen.id);
 }
}
const chestPools=new Map(Object.entries(DATA.tiles).filter(([,t])=>t.type===2).map(([id,t])=>[Number(id),Object.entries(t.rarities||{}).map(([tier,w])=>({tier:Number(tier)-1,w})).filter(t=>t.tier>0&&t.w>0)]));
function tileFromId(id,r){
 const t=DATA.tiles[id];if(!t)return {kind:'unknown'};
 if(t.type===2){const got=weighted(chestPools.get(id),x=>x.w,r);return got?{kind:'chest',tier:got.tier}:{kind:'unknown'};}
 if(id===10000)return {kind:'empty'};
 if(id===1000)return {kind:'trap',amount:1};
 if(id>=1051&&id<=1053)return {kind:'heal',amount:id-1050};
 if(id===1002)return {kind:'copy'};
 return {kind:'effect',id};
}
function effect(s,id,r,depth=0){
 if(depth>8)throw Error('Arcana effect chain limit.');
 const e=DATA.events[id];if(!e)throw Error('Unknown Arcana effect '+id);
 if(e.fn===100){move(s,count(e.a,r),r,depth+1);}
 else if(e.fn===110)s.life=clamp(s.life+e.p[0],0,6);
 else if(e.fn===130){
  const n=count(e.a,r);
  if(e.b.includes(1))upgrade(s,n,e.p[0],e.c.length?e.c:null,e.p[2]===2?'random':'highest',r);
  if(e.b.includes(2)){
   const ids=s.path.map((t,i)=>({t,i})).filter(({t,i})=>i>s.position&&t.kind==='chest'&&(!e.c.length||e.c.includes(t.tier+1)));
   for(const {t,i} of ids.slice(0,n)){if(s._sharedPath)s.path[i]={...t,tier:clamp(t.tier+e.p[0],1,6)};else t.tier=clamp(t.tier+e.p[0],1,6);}
  }
 }else if(e.fn===140){
  if(id===5000){s.die=1+Math.floor(r()*6);return;}
  draw(s,count(e.a,r),r,e.c.length?e.c:null,e.b);
 }else if(e.fn===150){
  const lo=e.b[0]??1,hi=e.b[1]??s.path.length,eligible=s.path.flatMap((t,i)=>{
   const delta=i-s.position;
   if(delta<lo||delta>hi)return [];
   if(!e.c.length)return [i];
   const candidate=t.kind==='empty'?10000:t.kind==='trap'?1000:t.kind==='chest'?2000+t.tier+1:t.id;
   return e.c.includes(candidate)||t.kind==='chest'&&e.c.some(x=>x>=2010&&x<=2015)?[i]:[];
  });
  const n=Math.min(eligible.length,count(e.a,r));
  for(let k=0;k<n;k++){const j=Math.floor(r()*eligible.length),i=eligible.splice(j,1)[0];s.path[i]=tileFromId(e.p[1],r);}
 }else throw Error('Unsupported Arcana effect '+e.fn);
}
function land(s,r,depth=0){
 let t=s.path[s.position];if(!t||t.used)return;
 if(t.kind==='unknown'){s.frontier=true;return;}
 if(s._sharedPath)t=s.path[s.position]={...t};
 // All tile effects are one-shot; crossing a cell does not collect it.
 t.used=true;
 if(t.kind==='chest'){
  // There is no replacement when the seven reward slots are full. The new
  // chest is consumed and lost even when rarer than an already owned chest.
  if(s.chests.length<7)s.chests.push(t.tier);
 }else if(t.kind==='trap')s.life=Math.max(0,s.life-(t.amount||1));
 else if(t.kind==='heal')s.life=Math.min(6,s.life+(t.amount||1));
 else if(t.kind==='draw')draw(s,t.amount||1,r);
 else if(t.kind==='effect')for(const id of DATA.tiles[t.id].events)effect(s,id,r,depth+1);
 // Scenario events exist only inside a sampled world, never in confirmed input.
 else if(t.kind==='scenario-event')effect(s,t.event,r,depth+1);
 else if(t.kind==='random'){s.frontier=true;s.uncertain=true;}
 else if(t.kind==='copy')s.pending={kind:'copy',cards:s.hand.slice()};
}
function move(s,delta,r,depth=0){if(s.life<=0)return;s.position=clamp(s.position+delta,0,s.path.length-1);land(s,r,depth);}
function actions(s){
 if(s.ended||s.life<=0)return [];
 const out=[];
 if(s.pending){
  for(let i=0;i<s.pending.cards.length;i++)out.push({kind:s.pending.kind==='copy'?'copy':'choose',index:i,id:s.pending.cards[i]});
  return out;
 }
 out.push({kind:'end'});
 if(s.die>=1&&s.die<=6&&s.position<s.path.length-1)out.push({kind:'die',delta:s.die});
 else if(s.position===s.path.length-1&&(s.rerollBudget??3)>0&&s.hand.some(id=>{const c=CARDS.get(id);return (c.choices.length?c.choices:[id]).some(note=>CARDS.get(note).events.some(e=>DATA.events[e].fn===100&&DATA.events[e].a[0]<0));}))out.push({kind:'reroll'});
 const seen=new Set();
 for(let i=0;i<s.hand.length;i++){
  const id=s.hand[i];if(seen.has(id))continue;seen.add(id);const c=CARDS.get(id);
  if(c.choices.length){for(const selected of c.choices)out.push({kind:'card',index:i,id,selected});}
  else out.push({kind:'card',index:i,id});
  // Discard is relevant only at the hand limit: incoming notes would be lost.
  if(s.hand.length===10)out.push({kind:'discard',index:i,id});
 }
 return out;
}
function apply(s,a,r){
 if(a.kind==='reroll'){s.die=1+Math.floor(r()*6);s.rerollBudget=Math.max(0,(s.rerollBudget??3)-1);return s;}
 s.rerollBudget=3;
 if(a.kind==='end'){s.ended=true;return s;}
 if(a.kind==='die'){move(s,s.die,r);s.die=1+Math.floor(r()*6);return s;}
 if(a.kind==='copy'){if(s.hand.length<10)s.hand.push(a.id);s.pending=null;return s;}
 let c;
 if(a.kind==='choose'){
  if(s.pending?.source!==undefined)s.hand.splice(s.pending.source,1);
  if(s.hand.length<10)s.hand.push(a.id);s.pending=null;return s;
 }
 else{if(s.hand[a.index]!==a.id)throw Error('Stale Arcana hand.');s.hand.splice(a.index,1);if(a.kind==='discard')return s;c=CARDS.get(a.selected??a.id);}
 if(!c)throw Error('Unknown card.');
 for(const id of c.events)effect(s,id,r);
 return s;
}
function label(a,s){
 if(a.kind==='end')return 'Start Fateful Contest';
 if(a.kind==='die')return `Use refill die ${s.die} → tile ${Math.min(s.path.length-1,s.position+s.die)+1}`;
 if(a.kind==='reroll')return 'Re-roll the refill die';
 if(a.kind==='copy')return `Copy ${CARDS.get(a.id)?.name||a.id}`;
 if(a.kind==='card'){
  const source=CARDS.get(a.id),selected=CARDS.get(a.selected);
  return `Play hand card ${a.index+1}: ${source?.name||a.id}${selected?' → choose '+selected.name:''}`;
 }
 const c=CARDS.get(a.selected??a.id),verb=a.kind==='discard'?'Discard':a.kind==='choose'?'Choose':'Play';
 return `${verb} ${c?.name||a.id}`;
}
module.exports={DATA,CARDS,POINTS,TIERS,blank,normalize,rng,pick,range,clone,score,upgrade,draw,effect,land,move,actions,apply,label,tileFromId};
