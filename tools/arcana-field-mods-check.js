'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../desktop/lib/arcana/engine'),W=require('../desktop/lib/arcana/world-sampler'),Route=require('../desktop/lib/arcana/route-log'),Mods=require('../desktop/lib/arcana/field-mods'),R=require('../desktop/lib/arcana/timer-reader/route-engine');
const colours=['','green','blue','purple','orange','red','rainbow'];
const changes=[{kind:'map_chests',plus:1},{kind:'map_chests',to:'red'},{kind:'map_chests',to:'rainbow'},{kind:'no_traps'},{kind:'traps_to_chests'}];
let worlds=0,compared=0;
for(const type of Object.keys(W.lengths))for(const change of changes)for(let seed=1;seed<=40;seed++){
 const n=W.lengths[type],s=E.normalize({...E.blank(n),position:10,life:3,die:1,hand:[3],chests:[4],confirmed:true,lengthConfirmed:true,pathMode:{type,length:n,confirmed:true,source:'game-log-patterns',confidence:1},fieldMods:[{from:10,...change}]});
 s.path[0]={kind:'empty',used:true};s.path[3]={kind:'chest',tier:2,used:true};s.path[15]={kind:'chest',tier:4};
 const before=JSON.stringify(s),random=E.rng(Math.imul(seed,0x9e3779b9)),source={total:n,boardType:type,futureUpgrade:0,mods:s.fieldMods,tiles:Array.from({length:n},(_,i)=>i===0?{type:'start',used:true}:i===3?{type:'chest',rarity:'blue',used:true}:i===10?{type:'empty',used:true}:i===15?{type:'chest',rarity:'orange'}:{type:'hidden'})};
 R.determinize(source,R.makeRng(Math.floor(random()*0x100000000)));
 const got=W.sample(s,E.rng(Math.imul(seed,0x9e3779b9)));
 assert.equal(JSON.stringify(s),before,'Sampling mutated the observed board');assert.deepEqual(got[15],s.path[15],'A visible chest was changed twice');assert.deepEqual(got[3],s.path[3],'A consumed reward changed');
 for(let i=1;i<n;i++)if(![3,10,15].includes(i)){
  const expected=source.tiles[i],actual=got[i];
  if(expected.type==='chest'){assert.equal(actual.kind,'chest');assert.equal(actual.tier,colours.indexOf(expected.rarity));}
  else if(expected.type==='trap')assert.equal(actual.kind,'trap');
  else if(expected.type==='empty')assert.equal(actual.kind,'empty');
  if(i>10&&change.kind==='no_traps')assert.notEqual(actual.kind,'trap');
  if(i>10&&change.to&&actual.kind==='chest')assert.equal(actual.tier,colours.indexOf(change.to));
  compared++;
 }
 assert.deepEqual(E.normalize(s).fieldMods,s.fieldMods);worlds++;
}
// Appearance hints may describe the original traps. A completed transformation
// changes what can occupy them; it must not be "corrected" back into a trap.
for(const kind of ['no_traps','traps_to_chests']){
 const s=E.normalize({...E.blank(80),position:10,life:2,die:1,hand:[],chests:[],confirmed:true,lengthConfirmed:true,pathMode:{type:'normal',length:80,source:'game-log-patterns',confirmed:true,confidence:1},fieldMods:[{from:10,kind}]});
 for(let i=11;i<80;i++)s.path[i]={kind:'unknown',look:'icon'};
 for(let seed=1;seed<=100;seed++)assert(W.sample(s,E.rng(Math.imul(seed,7919))).slice(11).every(t=>t.kind!=='trap'),'A removed trap reappeared behind an original icon hint');
}
function open(anchored=true){const r=Route.create();r.feed([...(anchored?['ProtoId = 5551']:[]),'S9Taro Run',...Array.from({length:16},(_,i)=>`[Game] ${1000+i*10}_S9TileIcon Anim_Loop Start`)]);return r;}
function event(r,id,{done=true,move=true}={}){r.feed(['S9Taro HandleOrderAni Start Step=1 Type=Move',...(move?['[Game] 900_S9LineShort Anim_D Start','[Game] 901_S9LineShort Anim_Light Start']:[]),'[Game] 1010_S9TileIcon Anim_Show02 Start',`MsgMgr@:Show MsgValue = ${E.DATA.events[id].text}`,done?'S9Taro HandleOrderAni All done':'S9Taro HandleOrderAni timeout']);}
for(const [i,id]of [9217,9218,9219,9221,9222].entries()){
 const r=open();event(r,id);assert.deepEqual(r.snapshot().fieldMods,[{from:1,...changes[i]}]);assert(r.snapshot().worldRevision>0);
 r.feed(['[Game] 1010_S9TileIcon Anim_Loop Start']);assert.equal(r.snapshot().fieldMods.length,1,'A repeated image duplicated a modifier');
 event(r,id,{move:false});assert.equal(r.snapshot().fieldMods.length,1,'Retreating onto a consumed event applied it twice');
 r.feed(['CloseTraoView','ProtoId = 5551','S9Taro Run']);assert.deepEqual(r.snapshot().fieldMods,[],'A new run inherited an old map effect');
 const timeout=open();event(timeout,id,{done:false});assert.deepEqual(timeout.snapshot().fieldMods,[],'An unfinished animation became a confirmed field change');
 const unanchored=open(false);unanchored.feed(['S9Taro HandleOrderAni Start Step=1 Type=Move',`MsgMgr@:Show MsgValue = ${E.DATA.events[id].text}`,'S9Taro HandleOrderAni All done']);assert.deepEqual(unanchored.snapshot().fieldMods,[]);
}
const unrelated=open();unrelated.feed([`MsgMgr@:Show MsgValue = ${E.DATA.events[9219].text}`]);assert.deepEqual(unrelated.snapshot().fieldMods,[],'An unrelated message changed the route');
assert.equal(Mods.fromText('not actually '+E.DATA.events[9219].text,10),null);assert.deepEqual(Mods.normalize([{from:-1,kind:'no_traps'},{from:800,kind:'no_traps'},{from:10,kind:'map_chests',plus:4},{from:10,kind:'map_chests',to:'invalid'}],80),[]);
// Effects are chronological: a later red transformation really downgrades a
// previous rainbow one, while an upgrade after red raises it to rainbow.
for(const [mods,tier]of [[[{from:10,kind:'map_chests',to:'rainbow'},{from:12,kind:'map_chests',to:'red'}],5],[[{from:10,kind:'map_chests',to:'red'},{from:12,kind:'map_chests',plus:1}],6]]){
 const s=E.normalize({...E.blank(80),position:12,life:2,die:1,hand:[],chests:[],confirmed:true,lengthConfirmed:true,pathMode:{type:'normal',length:80,source:'game-log-patterns',confirmed:true,confidence:1},fieldMods:mods});
 for(let seed=1;seed<=40;seed++)for(const t of W.sample(s,E.rng(seed)).slice(13))if(t.kind==='chest')assert.equal(t.tier,tier);
}
const result={version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),worlds,comparedHiddenCells:compared,fiveObservedEffects:true,referenceConditionalWorldsMatch:true,knownAndConsumedCellsUnchanged:true,originalTrapHintsHandled:true,effectOrderPreserved:true,unanchoredTimeoutAndUnrelatedMessagesRejected:true,newRunResetsEffects:true,gameCapture:false,gameInput:false};
fs.writeFileSync(path.join(__dirname,'results/arcana-field-mods.json'),JSON.stringify(result,null,2)+'\n');console.log('PASS: '+worlds+' authorised conditional worlds; observed map changes survive new calculations without double-applying to read cells.');
