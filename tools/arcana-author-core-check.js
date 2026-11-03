'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),crypto=require('node:crypto');
if(!process.versions.electron){const r=cp.spawnSync(require('../desktop/node_modules/electron'),[__filename,...process.argv.slice(2)],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,stdio:'inherit'});process.exit(r.status??1);}
const packageAt=process.argv.indexOf('--package'),archive=packageAt>=0?path.resolve(process.argv[packageAt+1]):null,arcanaDir=archive?path.join(archive,'lib/arcana'):path.resolve(__dirname,'../desktop/lib/arcana');
const E=require(path.join(arcanaDir,'engine')),A=require(path.join(arcanaDir,'author-solver')),S=require(path.join(arcanaDir,'solver')),W=require(path.join(arcanaDir,'world-sampler'));
const dir=path.join(arcanaDir,'timer-solver'),meta=require(path.join(dir,'source.json'));
assert.equal(process.versions.electron,meta.electron);assert.equal(process.versions.node,meta.node);
for(const [name,expected]of Object.entries(meta.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,name))).digest('hex'),expected,'Modified authorised core: '+name);
require(path.join(dir,'jsc-loader'));const R=require(path.join(dir,'core/engine.jsc')),RS=require(path.join(dir,'core/solver.jsc'));
const colours=['','green','blue','purple','orange','red','rainbow'];
function cardId(c){if(c.type==='move')return c.n;if(c.type==='back')return c.n+10;if(c.type==='upgrade')return 201+['blue','purple','orange','red'].indexOf(c.from)+10*((c.count||1)-1);return {move_odd:21,move_even:22,back_any:23,move_any:24}[c.type];}
function model(s,type){
 const v=R.view(s),m={...E.blank(s.total),position:v.pos,maxPosition:v.maxPos,turns:v.steps,life:v.life,die:v.currentMove,hand:v.hand.map(cardId),chests:v.collected.map(t=>colours.indexOf(t)),confirmed:true,lengthConfirmed:true,fieldMods:v.mods||[],pathMode:{type,length:s.total,source:'game-log-patterns',confirmed:true,confidence:1}};
 m.path=v.tiles.map(t=>{
  let local;if(t.type==='hidden')local={kind:'unknown',...(t.hint?{look:t.hint}:{})};
  else if(t.type==='chest')local={kind:'chest',tier:colours.indexOf(t.rarity)};
  else if(t.type==='trap')local={kind:'trap',amount:1};
  else if(t.type==='life')local={kind:'heal',amount:t.fixedN||1};
  else if(t.type==='question')local={kind:'random'};
  else if(t.type==='movement')local=t.fixedN?{kind:'grant',id:t.fixedN}:{kind:'effect',id:1020+(t.cardCount||1)};
  else if(t.type==='upgrade')local={kind:'effect',id:1099+colours.indexOf(t.fixedFrom)};
  else if(t.type==='start'||t.type==='empty')local={kind:'empty'};
  else throw Error('Unsupported test observation '+t.type);
  if(t.used)local.used=true;return local;
 });return E.normalize(m);
}
const settings=seed=>({objective:'rarity',points:{green:1,blue:1,purple:3,orange:5,red:10,rainbow:25},target:10,rollouts:150,deathLosesLoot:false,search:'halving',verify:3,verifyTimes:1.5,seed,weights:{...RS.weightsFor('rarity'),upgrade_gate:1}});
const actionKey=a=>JSON.stringify([a.kind,a.index,a.id,a.selected]);let cases=0,legalMappings=0;
for(const type of ['normal','special4'])for(let seed=1;seed<=12;seed++){
 const state=R.newState(R.makeBoard(type,R.makeRng(seed)),R.makeRng(seed*719),{handSize:5}),random=R.makeRng(seed*967);
 state.boardType=type;
 for(let step=0;step<seed%7&&!state.done;step++){const actions=R.actions(state).filter(a=>a.kind!=='end');if(!actions.length)break;R.step(state,actions[Math.floor(random()*actions.length)],random);}
 if(state.dead||state.done)continue;
 const m=model(state,type),before=JSON.stringify(m),converted=A.state(m),canonical=R.view(state);
 assert.equal(converted.maxPos,canonical.maxPos);assert.equal(converted.steps,canonical.steps);assert.deepEqual(converted.mods,canonical.mods||[]);
 // The only inert representation difference is that our normalizer marks
 // the current start cell settled. It changes no reward or random draw.
 canonical.tiles[canonical.pos].used=true;if(canonical.pos===0)canonical.tiles[0].used=true;
 canonical.mods=canonical.mods||[];const {lastQuestion,...semantic}=canonical;assert.deepEqual(converted,semantic,'Observed-state mapping differs from the author view on '+type+'/'+seed);
 const expected=RS.evaluate(canonical,settings(seed)),job=A.createJob(m,{seed},{target:S.target});assert(job);assert(job.step());const actual=job.result();assert(actual.authorCore);
 assert.equal(JSON.stringify(m),before,'The native core changed observed state');assert.equal(actual.options.length,expected.length);
 for(let i=0;i<expected.length;i++){
  const a=actual.options[i],e=expected[i];if(actionKey(a.action)!==actionKey(A.action(e.action,m)))fs.writeFileSync(path.resolve(__dirname,'../sandbox/arcana-native-parity-difference.json'),JSON.stringify({type,seed,canonical,converted,expected,actual},null,2));assert.equal(actionKey(a.action),actionKey(A.action(e.action,m)),'Mapped advice differs from the original on '+type+'/'+seed);
  assert(Math.abs(a.rankValue-e.mean)<1e-9,'The original ranking changed');assert(Math.abs(a.mean-(e.mean-e.avgValue*.001))<1e-9,'A heuristic tie-break was shown as actual rarity');assert.equal(a.rainbows,null,'Gold+ count was mislabeled as rainbow');assert.equal(a.deathRisk,e.deadRate);assert.equal(a.samples,e.samples);legalMappings++;
 }
 const filtered=A.createJob(m,{seed,allowReroll:false,rerollBudget:0},{target:S.target});assert(filtered.step());assert(filtered.result().options.every(o=>o.action.kind!=='reroll'));
 cases++;
}
for(const id of E.DATA.cards.filter(c=>c.tag!==99).map(c=>c.id)){
 const c=A.card(id);if(!c)continue;assert.equal(cardId(c),id,'A held note was mapped to another colour/count');
 const state=R.newState(R.makeBoard('normal',R.makeRng(1)),R.makeRng(2),{handSize:0});Object.assign(state,{pos:15,maxPos:15,hand:[c]});const m=model(state,'normal'),legal=E.actions(m);
 for(const a of R.actions(state)){const mapped=A.action(a,m);assert(legal.some(x=>actionKey(x)===actionKey(mapped)),JSON.stringify({id,a,mapped}));legalMappings++;}
}
const basic=model(R.newState(R.makeBoard('normal',R.makeRng(44)),R.makeRng(45),{handSize:4}),'normal');
assert.equal(A.createJob({...basic,lengthConfirmed:false}),null);assert.equal(A.createJob({...basic,localHorizon:true}),null);assert.equal(A.createJob({...basic,pathMode:{...basic.pathMode,confidence:.5}}),null);assert.equal(A.createJob({...basic,pending:{kind:'copy',cards:[1]}}),null);
const unsupported=structuredClone(basic);unsupported.path[2]={kind:'copy'};assert.equal(A.createJob(unsupported),null,'An unsupported local effect silently changed its rules');
for(const type of ['special1','special2','special3'])assert.equal(A.createJob({...E.normalize({...E.blank(W.lengths[type]),position:0,life:2,die:1,hand:[],chests:[],confirmed:true,lengthConfirmed:true}),pathMode:{type,length:W.lengths[type],source:'game-log-patterns',confirmed:true,confidence:1}}),null,'A mode-specific local strategy was replaced');
// A controlled final value proves the score decomposition independently of
// copying it from the original result row.
for(const tier of [1,2,3,4,5,6]){
 const m=structuredClone(basic);m.hand=[];m.chests=[tier];m.path=m.path.map(()=>({kind:'empty'}));const j=A.createJob(m,{seed:7},{target:S.target});assert(j.step());for(const row of j.result().options)assert(Math.abs(row.mean-E.POINTS[tier])<1e-8);
}
fs.writeFileSync(path.join(__dirname,archive?'results/arcana-author-core-packaged.json':'results/arcana-author-core.json'),JSON.stringify({version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),packagedArchive:archive,electron:process.versions.electron,node:process.versions.node,originalByteHashesVerified:true,cases,legalMappings,originalActionsRanksAndSamplesMatch:true,actualRaritySeparatedFromHeuristic:true,goldCountNeverShownAsRainbow:true,unknownRoutesAndLocalEffectsFallBack:true,threeImprovedModesPreserved:true,inputUnchanged:true,gameCapture:false,gameInput:false},null,2)+'\n');console.log('PASS: '+cases+' actual compiled-core decisions and '+legalMappings+' legal mappings, original ranking and true rarity display.');
