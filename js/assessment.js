/* Continuation model and rollout policy from the pinned Giboork reference.
 * No third-party executable or process is required at runtime. */
(function(root){
  'use strict';
  const T=root.Tartarus||(typeof require==='function'?require('./engine'):null);
  const data=root.TartarusAssessmentData||(typeof require==='function'?require('./assessment-data'):null);
  const solver=()=>root.TartarusSolver||(typeof require==='function'?require('./solver'):null);
  const events=['chain','execution','trickster','appetite','convict','crow','freedom','usurp1','usurp2','usurp3','usurp4','ratway','hunt','portion'];
  const objectives=['king','walk','consume','incident','doors','other'],starts=['cagefight','ironlaw','tyranny','opulence'];
  const key=ids=>ids.map(id=>String.fromCharCode(97+T.TOOL_IDS.indexOf(id))).sort().join('');
  const lookup=ids=>data.combos[key(ids)];
  function toolValue(ids){const tools=ids.filter(id=>T.TOOL_IDS.includes(id));if(!tools.length)return 0;if(tools.length<3)return (lookup(tools)??data.base)-data.base;let best=0;for(let i=0;i<tools.length;i++)for(let j=i+1;j<tools.length;j++)best=Math.max(best,(lookup([tools[i],tools[j]])??data.base)-data.base);return best;}
  function toolGains(st,options){const held=st.tools.filter(id=>T.TOOL_IDS.includes(id)),out={};for(const id of options){if(!T.TOOL_IDS.includes(id))return null;let v;if(!held.length)v=lookup([id])-data.base;else v=held.reduce((sum,other)=>sum+lookup([other,id])-lookup([other]),0)/held.length;if(!Number.isFinite(v))return null;out[id]=v;}return out;}
  function features(st){const f=Array(113).fill(0);f[0]=st.vault.length/10;f[1]=+(st.vault.length>=10);let max=-1,knownSum=0;
    for(const c of st.cells){if(!c.sealed&&c.inmate&&c.inmate.tier<5){const i=c.inmate;f[2+i.tier]++;f[7+i.tier*4+T.BEASTS.indexOf(i.beast)]++;max=Math.max(max,i.tier);}}
    for(let t=0;t<5;t++){const c=f.slice(7+4*t,11+4*t);f[27+2*t]=c.filter(n=>n>0).length;f[28+2*t]=Math.min(6,c[0]*c[1]+c[1]*c[2]+c[2]*c[3]+c[0]*c[3]);}
    f[37]=max*.25;f[38]=f[5]+f[6];
    for(const c of st.cells){if(c.n===0)continue;if(c.sealed){f[39]++;const i=c.hidden||c.inmate;const tier=c.known&&i?i.tier:c.atLeast||0;if(c.known&&i||tier){knownSum+=tier;f[40]++;}}if(c.nest)f[42]++;if(c.ivory)f[43]++;if(c.scratch)f[44]++;if(c.event)f[46+events.indexOf(c.event)]++;}
    f[39]/=15;if(f[40])f[41]=knownSum/f[40];f[45]=st.prey.length;
    for(let d=1;d<=6;d++){const c=st.cells[(st.position+d)%16];if(c.sealed)f[60]++;else if(c.inmate)f[61]++;}const office=16-st.position;f[62]=office>6?1.5:office/6;
    T.TOOL_IDS.forEach((id,i)=>f[63+i]=+st.tools.includes(id));f[94]=toolValue(st.tools);f[95]=st.tools.length;if(!st.milestone)f[96+objectives.indexOf(st.objective.id)]=1;f[102]=+st.milestone;const need={walk:18,consume:4,incident:2,doors:10}[st.objective.id];if(!st.milestone&&need)f[103]=Math.min(1,st.objective.progress/need);f[104]=+!!st.ratway;['usurp1','usurp2','usurp3','usurp4'].forEach((id,i)=>f[105+i]=+st.eventPool.includes(id));if(st.startEvent)f[109+starts.indexOf(st.startEvent)]=1;
    const t=Math.max(0,st.maxDays-st.day+1)/20,out=[1,t,t*t];for(const x of f)out.push(x,x*t);return out;
  }
  function remaining(st){if(st.phase==='ended')return 0;return Math.max(0,features(st).reduce((sum,x,i)=>sum+x*data.weights[i],0));}
  const rainbows=st=>Math.min(10,st.vault.length+remaining(st));
  const reds=st=>st.cells.filter(c=>!c.sealed&&c.inmate&&c.inmate.tier===4&&!c.inmate.marked).length;
  const score=(st,initial)=>rainbows(st)+.3*(st.vault.length-initial)+.25*reds(st);
  const params=st=>({...solver().paramsFor(st),assessment:true,preySurvival:false,terminalGifts:false,giftAdaptive:false});
  function decide(st,P,rng,adaptive=true,policy){const S=solver(),c=st.pending[0];if(adaptive&&c&&c.kind==='gift'){let best=null;for(const id of c.options){let sum=0;for(let n=0;n<3;n++){const trial=S.clone(st);trial.rng=(rng()*4294967296)>>>0;if(S.apply(trial,{type:'choose',id}).ok)sum+=trial.vault.length+remaining(trial);}if(!best||sum>best.sum)best={id,sum};}return best?{type:'choose',id:best.id}:null;}return S.decide(st,P,rng,policy);}
  function playout(st,P,rng,until,policy){const S=solver();for(let i=0;i<400;i++){if(st.phase==='ended'||st.phase==='patrol'&&st.day>until&&!st.pending.length)return;const a=decide(st,P,rng,true,policy);if(!a)return;if(!S.apply(st,a).ok&&!(a.type!=='end'&&S.apply(st,{type:'end'}).ok))throw Error('Assessment playout rejected a legal continuation');}}
  const api={features,remaining,rainbows,reds,score,toolValue,toolGains,params,decide,playout};if(typeof module==='object'&&module.exports)module.exports=api;root.TartarusAssessment=api;
})(typeof self!=='undefined'?self:globalThis);
