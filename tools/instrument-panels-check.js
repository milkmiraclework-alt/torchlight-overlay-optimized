/* Read-only checks against explicitly labelled, saved instrument panels. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
function readSamples(manifest) {
  return JSON.parse(fs.readFileSync(manifest, 'utf8').replace(/^\uFEFF/, '')).map((row) => ({
    tools: row.tools, name: row.name || path.basename(row.file), sha256: crypto.createHash('sha256').update(fs.readFileSync(row.file)).digest('hex'),
    url: `data:image/${path.extname(row.file).slice(1)};base64,${fs.readFileSync(row.file).toString('base64')}`,
  }));
}
async function browserPanels(labels, audit = false, negatives = false) {
  for (const file of ['scan.js', 'scan-data.js', 'pick-data.js']) if (!window[{ 'scan.js': 'TartarusScan', 'scan-data.js': 'TARTARUS_SCAN', 'pick-data.js': 'TARTARUS_PICK' }[file]]) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = 'js/' + file;
      script.onload = resolve; script.onerror = reject; document.head.append(script);
    });
  }
  const S = window.TartarusScan, ref = S.withPanelIcons(window.TARTARUS_SCAN, window.TARTARUS_PICK), results = [];
  for (const label of labels) {
    const bitmap = await createImageBitmap(await (await fetch(label.url)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0); bitmap.close();
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height), start = performance.now();
    const loc = S.locateBoard(img, S.grayOf(img), ref);
    if (!loc || loc.score < 0.8) {
      if(audit){results.push({name:label.name,sha256:label.sha256,expected:label.tools,actual:[],ok:false,reason:'No confident prison layout'});continue;}
      throw new Error('No confident prison layout: ' + label.name);
    }
    const panel = S.readTools(img, loc, ref);
    const actual = panel.tools.map((t) => ({ sim: ref.toolNames[t.id]?.sim || t.id, conf: t.conf, score: t.score, margin: t.margin }));
    if (actual.length !== label.tools.length || actual.some((t, i) => t.sim !== label.tools[i] || t.conf < 0.9)) {
      const debug=[];S.findToolIcons(img,loc,debug,ref);
      for(const d of debug)if(d.box&&d.box.every(Number.isFinite))d.match=S.matchToolFeature(S.artFeature(img,...d.box),d.box[2]-d.box[0],ref);
      const compactDebug=[];S.findToolIcons(img,loc,compactDebug,ref,{label:panel.label,step:5.05});
      if(audit){results.push({name:label.name,sha256:label.sha256,expected:label.tools,actual,ok:false,debug,compactDebug});continue;}
      throw new Error('Wrong or uncertain saved panel: ' + JSON.stringify({ name: label.name, expected: label.tools, actual, loc, label:panel.label, debug }));
    }
    results.push({ name: label.name, sha256:label.sha256, expected: label.tools, actual, ok:true, ms: Math.round(performance.now() - start) });
  }
  if(negatives){
    for(const kind of ['tooltip','sparkles']){
      const label=labels.find(row=>row.tools.length===1&&row.tools[0]===(kind==='tooltip'?'coin':'rope'));
      if(!label)throw new Error('Missing negative-control frame');
      const bitmap=await createImageBitmap(await(await fetch(label.url)).blob()),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);bitmap.close();
      const initial=ctx.getImageData(0,0,canvas.width,canvas.height),loc=S.locateBoard(initial,S.grayOf(initial),ref),before=S.readTools(initial,loc,ref),h=(before.label.x1-before.label.x0)/12.2;
      if(kind==='tooltip'){
        const x=before.label.x0+5*h,y=before.label.y1+1.1*h;
        ctx.fillStyle='#101010';ctx.fillRect(x,y,12*h,10*h);ctx.fillStyle='white';ctx.font=Math.round(.65*h)+'px Arial';
        for(let i=0;i<7;i++)ctx.fillText(i%2?'Requires opening a cell':'When an Inmate is Consumed',x+5,y+(i+1)*h);
      }else{
        const box=before.tools[0].box;ctx.fillStyle='white';ctx.fillRect(box[2]+12,box[1]-10,3,3);ctx.fillRect(box[0]-8,box[3]+5,2,2);
      }
      const after=S.readTools(ctx.getImageData(0,0,canvas.width,canvas.height),loc,ref),actual=after.tools.map(t=>({sim:ref.toolNames[t.id]?.sim||t.id,conf:t.conf}));
      const ok=kind==='tooltip'?actual.every(t=>t.conf<.9||label.tools.includes(t.sim)):actual.length===1&&actual[0].sim==='rope'&&actual[0].conf>=.9;
      results.push({name:kind+'-negative-control',synthetic:true,expected:label.tools,actual,ok});
      if(!ok&&!audit)throw new Error('Instrument negative control failed: '+JSON.stringify(results.at(-1)));
    }
  }
  return results;
}
module.exports = { readSamples, browserPanels };
if (require.main === module) {
  const result = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, 'overlay-check.js'), '--instrument-panels', ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
  process.exitCode = result.status === null ? 1 : result.status;
}
