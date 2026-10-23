/* Extend compact panel references from explicitly labelled saved frames.
 * Raw images and machine paths are never written to the repository. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
function readSamples(manifest) {
  return JSON.parse(fs.readFileSync(manifest, 'utf8')).map(row => ({ tools: row.tools, learnOnly: row.learnOnly, boxes: row.boxes,
    name: path.basename(row.file), url: 'data:image/webp;base64,' + fs.readFileSync(row.file).toString('base64') }));
}
async function browserPanels(labels, check) {
  for (const file of ['scan.js','scan-data.js','pick-data.js']) await new Promise((resolve,reject) => {
    const script=document.createElement('script');script.src='js/'+file;script.onload=resolve;script.onerror=reject;document.head.append(script);
  });
  const S=window.TartarusScan,ref=S.withPanelIcons(window.TARTARUS_SCAN,window.TARTARUS_PICK),names={},icons=[],results=[];
  for(const label of labels){
    if(!Array.isArray(label.tools)||label.tools.some(id=>!window.Tartarus.TOOLS[id]))throw new Error('Invalid labels');
    const bitmap=await createImageBitmap(await(await fetch(label.url)).blob()),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);bitmap.close();
    const img=ctx.getImageData(0,0,canvas.width,canvas.height),loc=S.locateBoard(img,S.grayOf(img),ref);
    if(!loc||loc.score<.8)throw new Error('No saved board: '+label.name);
    const panel=S.readTools(img,loc,ref),actual=panel.tools.map(t=>({sim:ref.toolNames[t.id]?.sim||t.id,conf:t.conf,score:t.score,margin:t.margin}));
    results.push({name:label.name,expected:label.tools,actual});
    if(!label.boxes&&panel.tools.length!==label.tools.length)throw new Error('Wrong icon count: '+label.name);
    if(check){if(actual.some((t,i)=>t.sim!==label.tools[i]||t.conf<.9))throw new Error('Wrong/uncertain panel: '+JSON.stringify(results.at(-1)));continue;}
    const source=label.boxes?label.boxes.map(box=>box?{box}:null):panel.tools;
    source.forEach((icon,i)=>{
      const sim=label.tools[i];if(label.learnOnly&&!label.learnOnly.includes(sim))return;
      if(!icon||icon.box.length!==4||!icon.box.every(Number.isFinite))throw new Error('Explicit saved icon box missing');
      const id=Object.keys(ref.toolNames).find(id=>ref.toolNames[id].sim===sim)||sim,feat=S.artFeature(img,...icon.box);
      names[id]={sim,name:window.Tartarus.toolName(sim)};
      icons.push({id,from:'confirmed-panel',w:Math.round(icon.box[2]-icon.box[0]),feat:{grid:feat.grid.map(v=>Math.round(v*10)/10),hist:feat.hist.map(v=>Math.round(v*1000)/1000)}});
    });
  }
  return {names,icons,results};
}
function save(samples) {
  const file=path.resolve(__dirname,'../js/pick-data.js'),previous=require(file);
  // Keep every existing reference: an incremental learning run must never
  // discard older confirmed-panel samples that lack a separate manifest.
  const output={...previous,names:{...previous.names,...samples.names},icons:[...new Map(previous.icons.concat(samples.icons).map(icon=>[JSON.stringify(icon),icon])).values()]};
  fs.writeFileSync(file,'/* Generated instrument references; compact saved-panel samples. */\n(function(root){root.TARTARUS_PICK='+JSON.stringify(output)+';if(typeof module===\'object\'&&module.exports)module.exports=root.TARTARUS_PICK;})(typeof window!==\'undefined\'?window:typeof self!==\'undefined\'?self:globalThis);\n');
}
module.exports={readSamples,browserPanels,save};
