'use strict';
// Timer's trained card/die readers, connected to our state and counter guards.
// The original recognition files/models are preserved in timer-reader/.
const Screen=require('./timer-reader/screen-reader'),Hand=require('./timer-reader/hand-reader'),Die=require('./timer-reader/die-reader');
const V=require('./vision'),Digits=require('./digits'),E=require('./engine');
Hand.loadModel();Die.loadModel();
let screenLoaded=false;
const counterTemplates=V.templates.filter(t=>t.kind==='hand-count');
const choices={move_odd:21,move_even:22,back_any:23,move_any:24};
const upgradeIcons=new Set(E.DATA.cards.filter(c=>c.id>=201&&c.id<=224).map(c=>c.icon));
const oddEvenIcons=new Set([21,22].map(id=>E.CARDS.get(id).icon));
const forwardIcons=new Set([1,2,3,4,5,6].map(id=>E.CARDS.get(id).icon)),backIcons=new Set([11,12,13,14,15,16].map(id=>E.CARDS.get(id).icon));
function refineNote(img,card,left=0,top=0){
 const allowed=card.card?.type==='move'?forwardIcons:card.card?.type==='back'?backIcons:card.kind==='O'?oddEvenIcons:/^U[bpor]$/.test(card.kind)?upgradeIcons:null;if(!allowed)return null;
 const s=card.box.s,w=91*s,matches=V.topMatches(img,V.templates.filter(t=>allowed.has(t.name)),{x:card.box.x0+left-8*s,y:card.box.y0+top-8*s,w:16*s,h:18*s},[.96,.98,1,1.02,1.04].map(n=>n*w),{stride:2,coarseThreshold:.64,threshold:.91,limit:3}).sort((a,b)=>b.score-a.score);
 const match=['move','back'].includes(card.card?.type)?V.refinePips(img,matches[0]):matches[0];if(!match||match.margin<.03)return null;
 const possible=E.DATA.cards.filter(c=>c.icon===match.name&&c.tag!==99&&c.selection>0);if(possible.length!==1)return null;
 card.refined=match;return possible[0].id;
}
function movement(card){
 if(card?.unsure)return null;
 if(card?.type==='move'&&Number.isInteger(card.n)&&card.n>=1&&card.n<=6)return card.n;
 if(card?.type==='back'&&Number.isInteger(card.n)&&card.n>=1&&card.n<=6)return card.n+10;
 return choices[card?.type]??null;
}
function create(){
 let cal=null,size=null,failure=null,prepared=null;
 const reject=reason=>{failure=reason;return null;};
 return {info:()=>({failure,cal}),hasTile(img,point){return prepared?.img===img&&cal?.score>=Screen.GOOD_BOARD&&Screen.spotScore(prepared.rgb,point.x-prepared.left,point.y-prepared.top,cal.s)>=Screen.GOOD_SPOT;},tileHint(img,point,look,emptyEvidence=false){
  if(look!=='plain'||prepared?.img!==img||!(cal?.score>=Screen.GOOD_BOARD))return null;
  if(!screenLoaded)screenLoaded=!!Screen.loadModel();if(!screenLoaded)return null;
  const features=Screen.features(prepared.rgb,point.x-prepared.left,point.y-prepared.top,cal.s);let probs=Screen.knn(features,'plain');
  // A plain logged cell plus absence of chest/card colours independently
  // excludes the chest alternative admitted by the general screen model.
  if(emptyEvidence&&probs?.empty>=.8&&probs.nearest<=Screen.outlierDistance())probs=Screen.knn(features,'plain',7,{plain:['empty','cards','upgrade']});
  if(!probs||probs.nearest>Screen.outlierDistance())return null;
  if(probs.empty>=.98)return {tile:{kind:'empty'},confidence:probs.empty,distance:probs.nearest};
  const x=point.x-prepared.left,y=point.y-prepared.top;
  if(probs.upgrade>=.98){const cap=Screen.upgradeCapInfo(prepared.rgb,x,y,cal.s),index=['blue','purple','orange','red'].indexOf(cap?.cap);if(index>=0&&cap.conf>=.85)return {tile:{kind:'effect',id:1101+index},confidence:Math.min(probs.upgrade,cap.conf),distance:probs.nearest};}
  if(probs.cards>=.98){const count=Screen.cardCount(prepared.rgb,x,y,cal.s);if(count?.conf>=.9&&count.n>=1&&count.n<=3)return {tile:{kind:'effect',id:1020+count.n},confidence:Math.min(probs.cards,count.conf),distance:probs.nearest};}
  return null;
 },read(img,grid){
  failure=null;
  prepared=null;
  if(!grid||grid.count<8)return reject('grid');
  const started=performance.now();
  // Capture buffers can contain a narrow transparent border. Only alpha-zero
  // padding is cropped; dark game pixels never count as evidence of a border.
  const emptyColumn=x=>{for(let y=0;y<img.height;y++)if(img.data[(y*img.width+x)*4+3])return false;return true;};
  const emptyRow=y=>{for(let x=0;x<img.width;x++)if(img.data[(y*img.width+x)*4+3])return false;return true;};
  let left=0,right=0,top=0,bottom=0;
  while(left<16&&emptyColumn(left))left++;while(right<16&&emptyColumn(img.width-1-right))right++;
  while(top<16&&emptyRow(top))top++;while(bottom<16&&emptyRow(img.height-1-bottom))bottom++;
  if([left,right,top,bottom].some(n=>n===16))return reject('transparent-frame');
  const width=img.width-left-right,height=img.height-top-bottom,pixels=new Uint8Array(width*height*3);
  for(let y=0,j=0;y<height;y++)for(let x=0;x<width;x++,j+=3){const i=((y+top)*img.width+x+left)*4;pixels[j]=img.data[i];pixels[j+1]=img.data[i+1];pixels[j+2]=img.data[i+2];}
  const rgb={width,height,data:pixels},dimensions=width+'x'+height;
  prepared={img,rgb,left,top};
  if(size!==dimensions||!cal||Screen.boardScore(rgb,cal.s,cal.dx,cal.dy)<Screen.GOOD_BOARD){cal=Screen.calibrate(rgb);size=dimensions;}
  if(!(cal?.score>=Screen.GOOD_BOARD))return reject('calibration');
  const row=Hand.readHand(rgb,cal),die=Die.readDie(rgb,cal);
  if(!row||row.n<1||row.n>10||!die||die.conf<.9||!Number.isInteger(die.value)||die.value<1||die.value>6)return reject('layout-or-die');
  const hand=row.cards.map(c=>{
   if(c.conf<.9)return null;
   // The trained model sometimes confuses sparse die faces at a changed
   // raster phase. Verify movement pips against their local texture family.
   if(['move','back'].includes(c.card?.type))return refineNote(img,c,left,top);
   return movement(c.card)??refineNote(img,c,left,top);
  });
  // Unsupported/ambiguous notes retain the full template reader. Upgrade
  // counts require the local shape check; a nearest neighbour is insufficient.
  if(hand.some(id=>id===null))return reject('card-face');
  let countIcon=V.topMatches(img,counterTemplates,V.ratio(img,.38,.80,.24,.075),[.010,.013,.016,.020,.024].map(v=>v*img.height),{stride:2,threshold:.88,coarseThreshold:.5,limit:3}).sort((a,b)=>b.score-a.score)[0];
  const readCount=box=>{
   // A narrow icon-pose error can leave its right edge in the text crop.
   // Both crops still require the complete numerator /10 and agreeing masks.
   const values=[.95,1.3].map(offset=>Digits.handCount(img,{x:box.x+box.w*offset,y:box.y-box.h*.5,w:box.w*5,h:box.h*2})).filter(Boolean);
   return values.length&&values.every(v=>v.value===values[0].value)?values[0]:null;
  };
  let count=countIcon?readCount(countIcon.box):null;
  if(countIcon&&!count){
   // At small scales equally good icon poses can crop the following /10.
   // Refine the icon pose using an independently readable complete counter;
   // the expected hand length is deliberately not part of this selection.
   let best=null;
   for(const scale of [.94,1,1.03,1.06,1.09])for(let dx=-2;dx<=2;dx+=.5)for(const dy of [-1,0,1]){
    const box={x:countIcon.box.x+dx,y:countIcon.box.y+dy,w:countIcon.box.w*scale,h:countIcon.box.h*scale},score=V.fit(img,counterTemplates[0],box);
    if(score<.985||best&&score<=best.score)continue;const number=readCount(box);if(number)best={box,score,number};
   }
   if(best){countIcon={...countIcon,box:best.box,score:best.score};count=best.number;}
  }
  if(count?.value!==hand.length||row.n!==hand.length)return reject('hand-counter: '+(count?.value??'unclear')+' / '+hand.length);
  return {hand,handConfident:true,handCount:count.value,counterMatch:countIcon,rowRegular:true,rowCentered:true,die:die.value,dieMatch:null,source:'timer-trained',ms:performance.now()-started,
   handMatches:row.cards.map((c,i)=>c.refined?{...c.refined,method:'template-region'}:{name:E.CARDS.get(hand[i]).icon,kind:'card',score:c.conf,margin:0,method:'trained',box:{x:c.box.x0+left,y:c.box.y0+top,w:c.box.x1-c.box.x0,h:c.box.y1-c.box.y0}})};
 }};
}
module.exports={create,movement};
