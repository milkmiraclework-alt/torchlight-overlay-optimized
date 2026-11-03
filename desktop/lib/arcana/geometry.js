'use strict';
const median=xs=>xs.length?xs.sort((a,b)=>a-b)[Math.floor(xs.length/2)]:0;
const center=m=>({x:m.box.x+m.box.w/2,y:m.box.y+m.box.h/2});
function grid(bases){
 const points=bases.filter(b=>b.score>.84).map(center),width=median(bases.map(b=>b.box.w));if(points.length<5||!width)return null;
 const us=[],vs=[];
 for(const a of points)for(const b of points){const dx=b.x-a.x,dy=b.y-a.y;if(dx>width*.7&&dx<width*1.4&&dy>width*.3&&dy<width*.9)us.push({x:dx,y:dy});if(dx>width*1.0&&dx<width*1.9&&dy<-width*.3&&dy>-width*1.1)vs.push({x:dx,y:dy});}
 if(us.length<2||vs.length<2)return null;
 const u={x:median(us.map(p=>p.x)),y:median(us.map(p=>p.y))},v={x:median(vs.map(p=>p.x)),y:median(vs.map(p=>p.y))},det=u.x*v.y-u.y*v.x;
 if(Math.abs(det)<width*width*.3)return null;
 let best=null;
 for(const p of points){
  const mapped=points.map(q=>{const dx=q.x-p.x,dy=q.y-p.y;return {c:(dx*v.y-dy*v.x)/det,r:(u.x*dy-u.y*dx)/det};});
  const good=mapped.filter(q=>Math.abs(q.c-Math.round(q.c))<.13&&Math.abs(q.r-Math.round(q.r))<.13);
  const minc=Math.min(...good.map(q=>Math.round(q.c))),maxc=Math.max(...good.map(q=>Math.round(q.c))),minr=Math.min(...good.map(q=>Math.round(q.r)));
  if(maxc-minc>3||good.length<5)continue;
  const origin={x:p.x+minc*u.x+minr*v.x,y:p.y+minc*u.y+minr*v.y};
  if(!best||good.length>best.count)best={origin,u,v,width,count:good.length,first:0,trusted:false};
 }
 return best;
}
// The first game row starts at its down/right end (tile 1), then goes up/left.
// Alternate rows run in the opposite direction. This is anchored to the game
// layout, rather than merely checking that our two conversions round-trip.
function at(g,index){const row=Math.floor(index/4),globalRow=Math.floor(g.first/4)+row,col=globalRow%2?index%4:3-index%4;return {x:g.origin.x+g.u.x*col+g.v.x*row,y:g.origin.y+g.u.y*col+g.v.y*row};}
function cell(g,p){const dx=p.x-g.origin.x,dy=p.y-g.origin.y,det=g.u.x*g.v.y-g.u.y*g.v.x;if(Math.abs(det)<1)return null;const c=(dx*g.v.y-dy*g.v.x)/det,r=(g.u.x*dy-g.u.y*dx)/det,cc=Math.round(c),rr=Math.round(r);if(cc<0||cc>3||Math.abs(c-cc)>.25||Math.abs(r-rr)>.25)return null;const row=Math.floor(g.first/4)+rr;return row<0?null:row*4+(row%2?cc:3-cc);}
function calibration(value,img){
 if(!value)return null;
 if(!Array.isArray(value.points)||value.points.length!==3||value.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1)||!Number.isInteger(value.first)||value.first<0||value.first>399)throw Error('Invalid Arcana alignment.');
 const [a,b,c]=value.points.map(p=>({x:p.x*img.width,y:p.y*img.height})),u={x:b.x-a.x,y:b.y-a.y},v={x:c.x-a.x,y:c.y-a.y};
 if(u.x<10||u.y<0||v.x<10||v.y>0||Math.abs(u.x*v.y-u.y*v.x)<100)throw Error('Click the leftmost tile, its neighbour down/right, then the tile up/right from the first.');
 return {origin:a,u,v,width:Math.hypot(u.x,u.y)*.82,first:Math.floor(value.first/4)*4,trusted:true};
}
// Infer only the snake's direction from visible connectors. This deliberately
// does not invent a global row number or a total server-side path length.
function localGrid(img,g,bases,sample){
 if(!g)return null;
 const coords=bases.map(center).map(p=>{const dx=p.x-g.origin.x,dy=p.y-g.origin.y,d=g.u.x*g.v.y-g.u.y*g.v.x;return {c:(dx*g.v.y-dy*g.v.x)/d,r:(g.u.x*dy-g.u.y*dx)/d};});
 const rows=Math.min(5,Math.max(...coords.filter(p=>Math.abs(p.r-Math.round(p.r))<.2).map(p=>Math.round(p.r))));
 const point=(c,r)=>({x:g.origin.x+g.u.x*c+g.v.x*r,y:g.origin.y+g.u.y*c+g.v.y*r});
 const light=(x,y)=>{const p=sample(img,x,y);return p?(p[0]+p[1]+p[2])/3:0;};
 function edge(a,b){const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),nx=-dy/len,ny=dx/len;let best=-Infinity;
  for(let shift=-Math.max(2,g.width*.025);shift<=Math.max(2,g.width*.025);shift+=1){let contrast=0;for(const t of [.32,.4,.48,.56,.64,.72]){const x=a.x+dx*t+nx*shift,y=a.y+dy*t+ny*shift;contrast+=(light(x+nx*g.width*.08,y+ny*g.width*.08)+light(x-nx*g.width*.08,y-ny*g.width*.08))/2-light(x,y);}best=Math.max(best,contrast/6);}return best;
 }
 const votes=[];
 for(let r=0;r<rows;r++){
  const a=point(0,r),b=point(0,r+1),c=point(3,r),d=point(3,r+1);
  if([a,b,c,d].some(p=>p.x<img.width*.12||p.x>img.width*.88||p.y<img.height*.07||p.y>img.height*.76))continue;
  const left=edge(a,b),right=edge(c,d),gap=(left-right)*(r%2?-1:1);
  if(Math.max(left,right)>8&&Math.abs(gap)>6)votes.push(gap);
 }
 const positive=votes.filter(x=>x>0),negative=votes.filter(x=>x<0),winning=positive.length>=negative.length?positive:negative;
 if(winning.length<2||winning.length!==votes.length||Math.abs(winning.reduce((a,b)=>a+b,0)/winning.length)<10)return null;
 return {...g,first:32+(winning[0]>0?0:4),trusted:true,relative:true,source:'visible-connectors',connectorPairs:winning.length};
}
module.exports={median,center,grid,at,cell,calibration,localGrid};
