'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function sourceHelpers() {
  const window = { Tartarus: require('../js/engine.js'), TartarusSolver: require('../js/solver.js') };
  const source = fs.readFileSync(require.resolve('../js/analyze.js'), 'utf8').replace(/\r\n/g, '\n');
  const init = '  buildBoard();\n  bind();\n  render();';
  if (!source.includes(init)) throw new Error('Analyzer init changed');
  vm.runInNewContext(source.replace(init, '  window.ocrHelpers = { ocrPixels, nameFromText, editDistance };'), { window, document: { currentScript: null }, navigator: { hardwareConcurrency: 4 }, localStorage: { getItem: () => null } });
  return Object.values(window.ocrHelpers).map(fn => fn.toString()).join('\n');
}
function readSamples(manifest) {
  return JSON.parse(fs.readFileSync(manifest, 'utf8')).map(row => ({ ...row, name: path.basename(row.file), file: undefined,
    url: 'data:image/webp;base64,' + fs.readFileSync(row.file).toString('base64') }));
}
async function browserOffers(labels, encode, parseName) {
  for (const file of ['scan.js', 'scan-data.js', 'pick-data.js']) if (!window[{ 'scan.js': 'TartarusScan', 'scan-data.js': 'TARTARUS_SCAN', 'pick-data.js': 'TARTARUS_PICK' }[file]]) await new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'js/' + file; script.onload = resolve; script.onerror = reject; document.head.append(script);
  });
  const S = window.TartarusScan, worker = await TartarusAnalyzer.prepareOCR(), results = [];
  for (const label of labels) {
    const bitmap = await createImageBitmap(await (await fetch(label.url)).blob());
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bitmap, 0, 0); bitmap.close();
    const pick = S.scanPick(ctx.getImageData(0, 0, canvas.width, canvas.height), window.TARTARUS_SCAN, window.TARTARUS_PICK);
    if (!pick.ok) throw new Error('No saved offer: ' + label.name);
    const s = pick.ui, top = canvas.height / 2 - 540 * s, timings = [];
    for (const mode of ['png', 'rgb-bytes']) {
      const names = [], start = performance.now();
      for (let k = -1; k <= 1; k++) {
        const z = Math.max(1, 1 / s), c = canvas.width / 2 + k * 480 * s, crop = document.createElement('canvas');
        crop.width = Math.round(430*s*z); crop.height = Math.round(130*s*z);
        crop.getContext('2d').drawImage(canvas, Math.round(c-215*s), Math.round(top+420*s), Math.round(430*s), Math.round(130*s), 0, 0, crop.width, crop.height);
        const before = performance.now(), { data } = await (mode === 'png' ? worker.recognize(crop) : worker.recognize(encode(crop), {}, { text: true, blocks: false, hocr: false, tsv: false }));
        names.push({ sim: parseName(data.text || '')?.id || null, text: data.text.trim(), ms: Math.round(performance.now()-before) });
      }
      timings.push({ mode, names, ms: Math.round(performance.now()-start) });
    }
    results.push({ name: label.name, expected: label.tools, ui: s, timings });
  }
  for(const result of results)for(const timing of result.timings)if(timing.names.some((n,i)=>n.sim!==result.expected[i]))throw new Error('Wrong saved offer name: '+JSON.stringify(result));
  return results.map(result=>({...result,sameText:result.timings[0].names.every((n,i)=>n.text===result.timings[1].names[i].text),timings:result.timings.map(t=>({...t,names:t.names.map(({sim,ms})=>({sim,ms}))}))}));
}
async function browserPackagedOffers(labels, boardURL) {
  const A=window.TartarusAnalyzer,T=window.Tartarus,Auto=window.TartarusAuto,results=[];
  const check=(ok,message)=>{if(!ok)throw new Error(message);},pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const bitmap=async url=>createImageBitmap(await(await fetch(url)).blob());
  const saved=()=>JSON.parse(localStorage.getItem('tartarus-sim:analyzer:v1')).model;
  const originalBlob=HTMLCanvasElement.prototype.toBlob;
  let blobCalls=0;
  HTMLCanvasElement.prototype.toBlob=function(){blobCalls++;throw new Error('Hidden-page PNG encoder used');};
  try {
    for(const label of labels){const image=await bitmap(label.url),read=await A.readPick(image);image.close();
      check(read.ok&&read.cards.every((c,i)=>c.sim===label.tools[i]),'Wrong actual offer: '+JSON.stringify({name:label.name,expected:label.tools,read}));
      results.push({name:label.name,expected:label.tools,actual:read.cards.map(c=>({sim:c.sim,by:c.by,conf:c.conf})),ms:read.ms,artMs:read.artMs,namesMs:read.namesMs});
    }
    const worker=await A.prepareOCR(),recognize=worker.recognize;
    let finish;
    worker.recognize=()=>new Promise(resolve=>{finish=resolve;});
    const image=await bitmap(labels[0].url),pending=A.readPick(image);
    for(let i=0;i<100&&!finish;i++)await pause(5);
    check(finish,'Cancellation fixture did not reach OCR');A.cancelPickRead();
    const cancelled=await Promise.race([pending,pause(500).then(()=>{throw new Error('Cancel waited for OCR');})]);image.close();
    check(cancelled.skipped,'An obsolete offer was accepted');worker.recognize=recognize;
    finish({data:{text:"Hangman's Noose"}});
    A.suspend();
    const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker{constructor(url,...args){super(url,...args);if(String(url).includes('scan-worker.js'))this.addEventListener('message',({data})=>{
      if(data.kind==='pick'&&data.result?.ok)data.result.cards[0]={...data.result.cards[0],sim:'shackles',conf:.4,score:.88,margin:.005};
    });}};
    try {
      const weakOCR=await A.prepareOCR(),normal=weakOCR.recognize;
      weakOCR.recognize=async()=>({data:{text:''}});
      const rejected=[];await Auto.receive({kind:'instruments',fresh:true,retryOffer:true,bitmap:await bitmap(labels[0].url)},patch=>rejected.push(patch));
      check(rejected.some(p=>p.read?.instrumentReading&&!p.read.ok)&&!rejected.some(p=>p.asked||p.state==='used'),'An uncertain Shackles offer produced advice');
      check(saved().toolsOffer?.unread&&!A.desktopSnapshot().move,'A failed instrument offer retained advice');
      weakOCR.recognize=normal;
    }finally{window.Worker=NativeWorker;A.suspend();}
    const recovered=[];await Auto.receive({kind:'instruments',fresh:true,retryOffer:true,bitmap:await bitmap(labels[0].url)},patch=>recovered.push(patch));
    check(recovered.some(p=>p.read?.ok)&&saved().choice.options.join()===labels[0].tools.join()&&!saved().toolsOffer.unread,'A clear fresh offer did not replace the rejected guess');
    A.suspend();
    let dropNew=true;
    const OriginalWorker=window.Worker;
    window.Worker=class extends OriginalWorker{constructor(url,...args){super(url,...args);if(String(url).includes('scan-worker.js'))this.addEventListener('message',({data})=>{
      if(!data.kind&&data.result?.ok&&dropNew){data.result.tools.tools=data.result.tools.tools.filter(t=>t.sim!=='rope');data.calibration=null;}
    });}};
    try {
      const state=T.newGame({seed:'REROLLED-INSTRUMENT',params:{drillDays:20,rewards:false}});
      state.day=4;state.phase='patrol';state.pending=[];state.tools=['ravenous'];state.destinations=[2];
      localStorage.setItem('tartarus-sim:save:v2',T.serialize(state));document.getElementById('az-load-run').click();document.getElementById('az-tools-ok').click();
      A.expectInstrumentOffer();A.usePick({ok:true,cards:['forged','shackles','rope'].map(sim=>({sim,name:T.toolName(sim),conf:1})),names:['Forged Key','Long-Chained Shackles',"Hangman's Noose"],reroll:false},false,true);
      const replies=[];
      A.invalidate();await Auto.receive({kind:'board',bitmap:await bitmap(boardURL),dayClock:{day:4,maxDays:20}},patch=>{if(patch.read)replies.push(patch.read);});
      check(replies.at(-1)?.instrumentReading&&!replies.at(-1)?.ok,'An incomplete post-selection panel was not retried: '+JSON.stringify(replies));
      check(saved().tools.join()==='ravenous'&&saved().toolsOffer,'An unknown selection was assumed');
      dropNew=false;A.invalidate();await Auto.receive({kind:'board',bitmap:await bitmap(boardURL),dayClock:{day:4,maxDays:20}},patch=>{if(patch.read)replies.push(patch.read);});
      const m=saved();check(replies.at(-1)?.ok&&m.tools.join()==='ravenous,rope'&&!m.toolsOffer&&!m.toolsUncertain,'The actual later Noose panel did not recover: '+JSON.stringify({replies,m}));
    }finally{window.Worker=OriginalWorker;A.suspend();}
    check(blobCalls===0,'OCR used the idle canvas encoder');
    return {offers:results,canvasBlobCalls:blobCalls,unfinishedOcrCancelled:true,uncertainOfferBlocked:true,clearOfferRecovered:true,rerolledNooseRecoveredFromFreshPixels:true};
  }finally{HTMLCanvasElement.prototype.toBlob=originalBlob;A.suspend();}
}
module.exports = { readSamples, browserOffers, browserPackagedOffers, sourceHelpers };
