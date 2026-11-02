'use strict';
// Final local release gate: inspect concrete artifacts and scoped test reports.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8')),version=read('desktop/package.json').version,dist='desktop/dist/builds/'+version;
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
cp.execFileSync(process.execPath,[path.join(__dirname,'standalone-manifest.js'),'--dist',path.join(root,dist)],{cwd:root});
cp.execFileSync(process.execPath,[path.join(__dirname,'tartarus-baseline-check.js')],{cwd:root});
const sources=read('tools/results/checks.json'),packaged=read('tools/results/packaged-checks.json');
assert.equal(sources.version,version);assert.equal(packaged.version,version);
for(const name of ['arcana-refill','arcana-endgame','gpu-capture','window-capture','terminal-reward','prey-rebuild','assessment-model','solver-cache','worker-lifecycle','usurp-pool'])assert(sources.checks.includes(name),'Missing source gate: '+name);
for(const name of ['arcana-game','arcana-hand','arcana-refill','arcana-fallback','suite','overlay','lifecycle','instruments','updates','portable','native-reader'])assert(packaged.checks.includes(name),'Missing packaged gate: '+name);
const gpu=read('tools/results/arcana-gpu-e2e.json'),hand=read('tools/results/arcana-gpu-hand-e2e.json'),capture=read('tools/results/wgc-capture.json');
for(const report of [gpu,hand]){assert.equal(report.version,version);assert(report.actualWindowsGraphicsCapture&&report.handDieLifeChecksCleared&&report.zeroCaptureChildrenAfterStop);assert.equal(report.gameCapture,false);}
assert(gpu.adviceAfterInitialConfirmation);assert.deepEqual(hand.hand,[22,13,4,21]);assert.equal(hand.die,6);assert.equal(hand.life,2);
const refill=read('tools/results/arcana-refill.json'),refillGpu=read('tools/results/arcana-gpu-refill-e2e.json');
assert.equal(refill.version,version);assert.equal(refill.cases.length,18);assert(refill.missingRefillRejected&&refill.coveredCardRejected&&refill.lastMovementCardPreserved);assert(refill.cases.every(c=>c.life===2));
assert.equal(refillGpu.version,version);assert(refillGpu.actualWindowsGraphicsCapture&&refillGpu.handDieLifeChecksCleared&&refillGpu.zeroCaptureChildrenAfterStop);assert.equal(refillGpu.die,1);assert.deepEqual(refillGpu.hand,[22,13,4,21]);
assert(capture.updatesBehindBlackCover&&capture.minimizedWindowRejected&&capture.zeroCaptureChildren);
const endgame=read('tools/results/arcana-endgame.json'),terminal=read('tools/results/tartarus-terminal-reward.json'),vorax=read('tools/results/vorax-objective-counterexample.json');
assert.equal(endgame.version,version);assert(endgame.independentOracleAgreement&&endgame.completed>=100&&endgame.budgetFallback&&endgame.croppedAbsoluteTarget);assert(endgame.improvedCounterexamples.every(r=>r.after>r.before));
assert.equal(terminal.version,version);assert(terminal.activeAssessmentUnchanged&&terminal.endedRedBonusRemoved);assert.equal(terminal.corrected.length,3);for(const seed of terminal.corrected){assert.equal(seed.options[0].id,'horn');assert.equal(seed.options[0].rainbows,1);}
assert(vorax.objectiveRankCorrected);assert.equal(vorax.after.end.activity,840000);assert.equal(vorax.after.end.reached,1);assert(vorax.before.end.reached<1);
assert(fs.readFileSync(path.join(root,'desktop/lib/unified-runtime.js'),'utf8').includes("VORAX_SMART_PROFILE:'balanced'"),'Unvalidated profile became default');
assert(!fs.existsSync(path.join(root,'desktop/lib/arcana/upgrade-value.js')),'Rejected heuristic candidate leaked into product');
const portable=read('desktop/dist/portable-smoke.json'),build=read(dist+'/standalone-build.json');assert.equal(portable.version,version);assert.equal(portable.sha256,sha(dist+'/'+portable.executable));assert(portable.portableRelaunchPreservesResources&&portable.portableReaderFilesVerifiedOnDisk&&portable.externalHttpBlocked&&portable.originalInstallUnavailable);
assert.equal(build.artifacts.length,2);for(const artifact of build.artifacts)assert.equal(artifact.sha256,sha(dist+'/'+artifact.file));
const report={version,checkedAt:new Date().toISOString(),sourceGroups:sources.checks.length,packagedGroups:packaged.checks.length,arcana:{freshGpuCapture:true,updatesBehindBlackCover:true,minimizedRejected:true,userHandChecksCleared:true,adviceAfterInitialPathConfirmation:true,exactEndgameOracleAgreement:true,improvedCounterexamples:endgame.improvedCounterexamples},tartarus:{terminalRewardCorrected:true,activeReferenceModelPreserved:true,preyRebuildChecked:true,readerBaselineRetained:true},vorax:{finalObjectivePreferenceCorrected:true,fastBalancedProfileRetained:true},artifacts:build.artifacts,appAsarSha256:build.appAsarSha256,portableDoubleLaunchVerified:true,scope:'Saved frames, owned GPU test windows and local-rule simulations. No live-game capture/input, no claim of universal hardware/screen support or verified profit increase. Initial Arcana board confirmation remains required.'};
report.arcana.refillDiceCases=refill.cases.length;report.arcana.oddRefillGpuChecked=true;report.arcana.blueLifeAcrossRefillCases=true;
fs.writeFileSync(path.join(root,'tools/results/release-audit.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS: final source/artifact fingerprints, '+report.sourceGroups+' source and '+report.packagedGroups+' packaged groups, actual GPU hand/advice chain, odd refill recovery and all three adviser corrections.');
