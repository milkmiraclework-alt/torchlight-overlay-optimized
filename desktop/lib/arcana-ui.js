'use strict';
const D=window.TartarusDesktop,$=id=>document.getElementById(id);
let snapshot=null,model=null,definitions=[],effects=[],editing=-1,frame=null,aligning=false,points=[],saving=false,dirty=false;
const tierNames=['?','Green','Blue','Purple','Gold','Red','Rainbow'];
function status(text,warn=false){$('status').textContent=text;$('status').classList.toggle('warn',warn);}
async function command(cmd,value){try{return await D.arcana(cmd,value);}catch(error){status(error.message,true);throw error;}}
function current(){
 const next=structuredClone(model);
 const number=id=>$(id).value.trim()===''?null:Number($(id).value);
 const position=number('position');next.position=position===null?null:position-1;next.life=number('life');next.die=number('die');
 const length=number('length');if(Number.isInteger(length)&&length>=2&&length<=400)next.path=Array.from({length},(_,i)=>next.path[i]||{kind:'unknown'});
 next.lengthConfirmed=$('length-confirmed').checked;
 next.chests=$('chests').value.trim()?$('chests').value.trim().split(/[\s,;]+/).map(Number):[];
 const pending=$('pending-kind').value;
 next.pending=pending?{kind:pending,cards:pending==='copy'?next.hand.slice():(model.pending?.cards||[]).slice()}:null;
 if(pending==='choose'&&$('pending-source').value!==''&&Number($('pending-source').value)>=0)next.pending.source=Number($('pending-source').value);
 next.confirmed=$('confirmed').checked;return next;
}
function render(s){
 if(!s){status('Arcana is inactive. Select Arcana in Settings.');return;}
 snapshot=s;definitions=s.cards||definitions;effects=s.tileEffects||effects;if(s.model&&!saving&&!dirty){model=structuredClone(s.model);renderModel();}
 const names={waiting:'Waiting for the Tarot Path screen.',reading:'Reading the Arcana picture…',thinking:'Comparing paths and card use…',advice:s.move,check:s.reason,error:s.reason};
 status(names[s.phase]||s.phase,s.phase==='check'||s.phase==='error');
 $('move').textContent=s.move||'Advice';$('expected').textContent=s.expected||'';$('notice').textContent=s.notice||'';
 $('options').textContent=(s.options||[]).slice(0,8).map(o=>`${o.label}: ${o.mean.toFixed(2)} rarity points`).join('\n');
}
function renderModel(){
 $('position').value=model.position+1;$('life').value=model.life;$('die').value=model.die??'';
 $('length').value=model.path.length;$('length-confirmed').checked=!!model.lengthConfirmed;
 $('preset').value=[80,60,96,56].includes(model.path.length)?String(model.path.length):'custom';
 $('chests').value=model.chests.join(' ');$('confirmed').checked=!!model.confirmed;
 $('card').replaceChildren(...definitions.map(c=>new Option(c.name,String(c.id))));
 $('pending-kind').value=model.pending?.kind||'';
 $('source-label').hidden=model.pending?.kind!=='choose';
 $('pending-source').replaceChildren(new Option('Already spent','-1'),...model.hand.flatMap((id,i)=>{const c=definitions.find(c=>c.id===id);return c?.choices?.length?[new Option(`${i+1}: ${c.name}`,String(i))]:[];}));
 $('pending-source').value=String(model.pending?.source??-1);
 if(model.pending?.kind==='copy')model.pending.cards=model.hand.slice();
 $('offered').replaceChildren(...(model.pending?.cards||[]).map((id,i)=>{const b=document.createElement('button');b.type='button';b.textContent=(definitions.find(c=>c.id===id)?.name||id)+' ×';b.disabled=model.pending?.kind==='copy';b.onclick=()=>{model=current();model.pending.cards.splice(i,1);dirty=true;renderModel();};return b;}));
 $('hand').replaceChildren(...model.hand.map((id,i)=>{
  const b=document.createElement('button');b.textContent=`${i+1}: `+(definitions.find(c=>c.id===id)?.name||`Card ${id}`)+' ×';b.title='Drag to reorder; click to remove';b.draggable=true;
  b.ondragstart=e=>e.dataTransfer.setData('text/plain',String(i));b.ondragover=e=>e.preventDefault();
  b.ondrop=e=>{
   e.preventDefault();const from=Number(e.dataTransfer.getData('text/plain'));if(!Number.isInteger(from)||from<0||from>=model.hand.length||from===i)return;
   model=current();const source=model.pending?.source;
   if(source!==undefined){if(source===from)model.pending.source=i;else if(from<source&&i>=source)model.pending.source--;else if(from>source&&i<=source)model.pending.source++;}
   const [card]=model.hand.splice(from,1);model.hand.splice(i,0,card);model.confirmed=false;dirty=true;renderModel();
  };
  b.onclick=()=>{model=current();if(model.pending?.source!==undefined){if(model.pending.source===i)delete model.pending.source;else if(model.pending.source>i)model.pending.source--;}model.hand.splice(i,1);model.confirmed=false;dirty=true;renderModel();};return b;
 }));
 const known=model.path.flatMap((tile,index)=>tile&&tile.kind!=='unknown'?[index]:[]),center=model.position;
 const low=Math.max(0,Math.floor((Math.min(center,...known.filter(i=>i>=center-12)))/4)*4),high=Math.min(model.path.length,Math.max(low+24,...known.map(i=>i+1)));
 const nodes=[];
 // Display the logical path order; the game picture supplies exact on-screen
 // positions and can be aligned independently of this correction grid.
 for(let i=low;i<high;i++){
  const tile=model.path[i]||{kind:'unknown'},b=document.createElement('button');
  b.textContent=`${i+1}: ${tile.kind==='chest'?tierNames[tile.tier]:tile.kind}`;
  b.className=(tile.kind==='chest'?`tier${tile.tier}`:'')+(i===center?' current':'')+(snapshot?.target===i?' best':'');
  b.onclick=()=>edit(i);nodes.push(b);
 }
 $('tiles').replaceChildren(...nodes);$('coverage').textContent=`${known.length} / ${model.path.length} tiles known. Hidden tiles are not treated as confirmed rewards.`;
}
function edit(index){
 model=current();editing=index;const tile=model.path[index]||{kind:'unknown'};
 $('tile-title').textContent='Tile '+(index+1);
 $('tile-kind').replaceChildren(...['unknown','empty','chest','trap','heal','draw','effect','copy','random','end'].map(x=>new Option(x,x)));
 $('tile-effect').replaceChildren(...effects.map(t=>new Option(t.name,String(t.id))));
 if(tile.kind==='effect'&&!effects.some(t=>t.id===tile.id))$('tile-effect').add(new Option('Current effect',String(tile.id)));
 $('tile-effect').value=String(tile.id||effects[0]?.id||'');
 $('tile-kind').value=tile.kind;$('effect-label').hidden=tile.kind!=='effect';$('tile-tier').value=tile.tier||1;$('tile-amount').value=tile.amount||1;$('editor').hidden=false;
}
$('tile-kind').onchange=()=>{$('effect-label').hidden=$('tile-kind').value!=='effect';};
$('editor').querySelector('form').onsubmit=e=>{e.preventDefault();model.path[editing]={kind:$('tile-kind').value,tier:Number($('tile-tier').value),amount:Number($('tile-amount').value),id:Number($('tile-effect').value)};model.confirmed=false;dirty=true;$('editor').hidden=true;renderModel();};
$('cancel-tile').onclick=()=>{$('editor').hidden=true;};
$('read').onclick=()=>{dirty=false;void command('read').catch(()=>{});};
$('new').onclick=()=>{dirty=false;void command('reset').catch(()=>{});};
$('add').onclick=()=>{if(!model)return;model=current();if(model.hand.length>=10){status('The hand already has 10 cards.',true);return;}model.hand.push(Number($('card').value));model.confirmed=false;dirty=true;renderModel();};
$('pending-kind').onchange=()=>{if(!model)return;model=current();dirty=true;renderModel();};
$('pending-source').onchange=()=>{if(!model)return;model=current();dirty=true;};
$('add-offer').onclick=()=>{if(!model)return;model=current();if(model.pending?.kind!=='choose')model.pending={kind:'choose',cards:[]};if(model.pending.cards.length>=10)return;model.pending.cards.push(Number($('card').value));dirty=true;renderModel();};
$('preset').onchange=()=>{if($('preset').value!=='custom')$('length').value=$('preset').value;dirty=true;$('length-confirmed').checked=true;};
$('apply').onclick=async()=>{if(!model)return;model=current();saving=true;try{await command('correct',model);dirty=false;}catch{}finally{saving=false;}};
async function picture(){const p=await command('picture');if(!p?.data){status('No picture yet. Read the screen first.',true);return;}frame=p;const canvas=$('canvas');canvas.width=p.width;canvas.height=p.height;canvas.hidden=false;canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(p.data),p.width,p.height),0,0);}
$('picture').onclick=()=>{void picture().catch(()=>{});};
$('align').onclick=async()=>{try{await picture();aligning=true;points=[];$('calibration').textContent='Click the leftmost tile, its neighbour down/right, then the tile up/right from the first. Set First visible tile to the index of the first click.';}catch{}};
$('clear-align').onclick=()=>{void command('calibrate',null).catch(()=>{});};
$('canvas').onclick=async e=>{
 if(!aligning||!frame)return;const r=e.target.getBoundingClientRect();points.push({x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height});
 if(points.length<3){$('calibration').textContent=`${points.length}/3 alignment points selected.`;return;}
 aligning=false;try{await command('calibrate',{points,first:Number($('first-tile').value)-1});$('calibration').textContent='Alignment saved for this board. Read the screen again.';}catch{}
};
D.onArcana(render);D.arcana('get').then(value=>{render(value.state);if(!value.active)status('Select Arcana in Settings and enable game capture.',true);}).catch(e=>status(e.message,true));
document.addEventListener('input',e=>{if(['position','life','die','chests','length','length-confirmed','confirmed'].includes(e.target.id))dirty=true;});
