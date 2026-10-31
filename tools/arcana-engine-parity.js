'use strict';
// Compare optimized transitions to an explicitly supplied snapshot of our
// own previous engine. No third-party implementation or game capture.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),E=require('../desktop/lib/arcana/engine');
const at=process.argv.indexOf('--baseline');if(at<0)throw Error('Supply --baseline <our historical engine directory>');
const Old=require(path.join(path.resolve(process.argv[at+1]),'engine.js')),random=E.rng(0x5afe1234),pool=E.DATA.cards.filter(c=>c.tag!==99&&c.weight>0).map(c=>c.id);
const clean=s=>{const v=JSON.parse(JSON.stringify(s));delete v._sharedPath;delete v.rerollBudget;return v;};let transitions=0;
for(let trial=0;trial<500;trial++){
 const state={...E.blank(32),position:0,life:2+Math.floor(random()*4),die:1+Math.floor(random()*6),hand:Array.from({length:4},()=>E.pick(pool,random)),chests:Array.from({length:Math.floor(random()*5)},()=>1+Math.floor(random()*6)),confirmed:true,lengthConfirmed:true};
 state.path=state.path.map(()=>{const x=random();return x<.2?{kind:'chest',tier:1+Math.floor(random()*6)}:x<.35?{kind:'trap',amount:1}:x<.45?{kind:'heal',amount:1}:x<.7?{kind:'effect',id:E.pick([1021,1022,1101,1102,1103,1104,4001,4002,4008],random)}:{kind:'empty'};});
 let a=Old.normalize(state),b=E.normalize(state);
 for(let step=0;step<24&&a.life>0&&!a.ended;step++){
  const legal=Old.actions(a).filter(m=>m.kind!=='reroll'&&(step>12||m.kind!=='end'));if(!legal.length)break;
  const action=E.pick(legal,random),seed=1+Math.floor(random()*0x7fffffff),before=JSON.stringify(clean(b)),old=Old.clone(a),next=E.clone(b,true);
  Old.apply(old,action,Old.rng(seed));E.apply(next,action,E.rng(seed));assert.equal(JSON.stringify(clean(b)),before,'Copy-on-write changed the parent world');assert.deepEqual(clean(next),clean(old),`Transition mismatch on trial ${trial}, step ${step}`);a=old;b=next;transitions++;
 }
}
fs.writeFileSync(path.resolve(__dirname,'results/arcana-engine-parity.json'),JSON.stringify({version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),source:'Our own historical engine; non-reroll game-table transitions, not Arcana Helper.',trials:500,transitions,excludedTransitions:['reroll: corrected from a selected face to an actual random die'],internalPlanningFieldsIgnored:['rerollBudget'],copyOnWriteIsolation:true,gameCapture:false,gameInput:false},null,2)+'\n');
console.log(`PASS: ${transitions} optimized game transitions match our historical engine, with independent parent worlds.`);
