'use strict';
// Offline inspection of local JSONL metadata. No game access, capture or input.
const fs=require('node:fs'),path=require('node:path');
function summarize(directory){
 const files=fs.readdirSync(directory).filter(n=>/^vorax-[0-9a-f-]+\.jsonl$/.test(n)),runs=new Map();let invalidLines=0;
 for(const file of files){for(const line of fs.readFileSync(path.join(directory,file),'utf8').split(/\r?\n/)){
  if(!line.trim())continue;let r;try{r=JSON.parse(line);}catch{invalidLines++;continue;}if(r.schema!==1||!r.runId)continue;
  if(!runs.has(r.runId))runs.set(r.runId,{id:r.runId,files:[],entries:[]});const run=runs.get(r.runId);if(!run.files.includes(file))run.files.push(file);run.entries.push(r);
 }}
 const rows=[];
 for(const run of runs.values()){
  const entries=run.entries.sort((a,b)=>a.sequence-b.sequence),start=entries.find(r=>r.type==='run_start'),end=entries.findLast(r=>r.type==='run_end'),completion=entries.findLast(r=>r.type==='completion'),observations=entries.filter(r=>r.type==='observation'),transitions=entries.filter(r=>r.type==='transition'),last=observations.at(-1);
  const actions=transitions.filter(r=>r.action),knownComparisons=actions.filter(r=>typeof r.matchesAdvice==='boolean');
  const times=key=>observations.map(r=>r.timing?.[key]).filter(Number.isFinite).sort((a,b)=>a-b),percentile=(xs,p)=>xs.length?xs[Math.min(xs.length-1,Math.floor((xs.length-1)*p))]:null;
  const final=entries.findLast(r=>r.type==='terminal_result'&&r.source==='observed_reward_screen'&&r.sure===true&&Number.isSafeInteger(r.activity));
  rows.push({runId:run.id,files:run.files,version:start?.version||last?.version,backendSha256:start?.backend?.backendSha256||null,partial:start?.partial!==false,ended:!!end,reason:end?.reason||null,preparationCompleted:completion?.preparationCompleted??end?.preparationCompleted??false,
   observations:observations.length,duplicates:end?.duplicates||0,dropped:end?.dropped||0,observedDurationMs:start&&end?end.at-start.at:null,lastRound:last?.state?.round??null,lastObservedActivity:last?.activity?.value??null,lastObservedActivitySure:last?.activity?.sure===true,lastObservedTargetReached:last?.activity?.sure===true?last.activity.value>=840000:null,
   finalActivity:final?.activity??null,targetReached:final?final.activity>=840000:null,
   observedActions:actions.length,unknownActions:transitions.length-actions.length,matchingRecommendations:knownComparisons.filter(r=>r.matchesAdvice).length,comparedRecommendations:knownComparisons.length,
   interpretation:'Matching an observed action to a recommendation does not establish that the recommendation was available when the player acted. Last observed activity is not a terminal reward.',
   uncertainReadings:observations.filter(r=>!r.activity?.sure||(r.recognition?.problems||[]).length).length,
   solveMs:{median:percentile(times('solveMs'),.5),p95:percentile(times('solveMs'),.95)},totalMs:{median:percentile(times('totalMs'),.5),p95:percentile(times('totalMs'),.95)},
   review:observations.filter(r=>(r.recognition?.problems||[]).length||r.diagnostics?.referenceRetained||r.diagnostics?.closeDecision).map(r=>({observation:r.observation,round:r.state.round,uncertain:(r.recognition?.problems||[]).length>0,referenceRetained:r.diagnostics?.referenceRetained===true,closeDecision:r.diagnostics?.closeDecision===true}))});
 }
 const confirmed=rows.filter(r=>r.finalActivity!==null);
 return {schema:1,kind:'vorax_journal_summary',generatedAt:new Date().toISOString(),files:files.length,runs:rows.length,completedPreparations:rows.filter(r=>r.preparationCompleted).length,confirmedFinalResults:confirmed.length,confirmedGoalReached:confirmed.filter(r=>r.targetReached).length,invalidLines,scope:'Local recorded observations and normalized UI events. Unknown actions and missing terminal results are excluded from confirmed outcome statistics. No live-game input or capture.',rows};
}
if(require.main===module){try{const at=process.argv.indexOf('--dir');if(at<0)throw Error('Usage: node tools/vorax-journal-report.js --dir <logs/vorax> [--out report.json]');const report=summarize(path.resolve(process.argv[at+1])),outAt=process.argv.indexOf('--out'),text=JSON.stringify(report,null,2)+'\n';if(outAt>=0)fs.writeFileSync(path.resolve(process.argv[outAt+1]),text);else process.stdout.write(text);}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={summarize};
