'use strict';
// Record completed native checks; this script does not run or control a game.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),arg=process.argv.indexOf('--log');assert(arg>=0,'Supply --log <completed native build log>');
const logBytes=fs.readFileSync(path.resolve(process.argv[arg+1])),log=logBytes.toString(logBytes[0]===255&&logBytes[1]===254?'utf16le':'utf8'),summaries=[...log.matchAll(/test result: ok\. (\d+) passed; (\d+) failed;/g)];assert(summaries.length>=10,'Native test run is incomplete');assert(summaries.every(m=>Number(m[2])===0));
const required=['whole_games_match','advisor_matches','strategy_matches','engine_traces_match','kit_context_survives_refresh_and_is_cleared_by_playing_a_potion','simultaneous_thresholds_preserve_both_instrument_picks','conditional_tool_and_its_remaining_ticks_are_evaluated_by_the_engine','periodic_combo_uses_the_real_acquisition_round','final_goal_is_not_sacrificed_to_make_the_board_change','unequal_futures_use_a_matched_gap_and_keep_identical_prefixes_close','parallelism_does_not_change_samples_or_choices','readings_match','reopening_preserves_only_a_confirmed_continuing_run'];
required.push('terminal_tie_break_preserves_the_reference_primary_order');
for(const name of required)assert(log.includes(name+' ... ok'),'Missing native gate: '+name);
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex'),before=JSON.parse(fs.readFileSync(path.join(__dirname,'results/vorax-strategy-audit-20261102.json'))),unchanged=['vorax/data/game.json','vorax/data/boardValue.json','vorax/crates/vorax/src/game.rs','vorax/crates/vorax/src/effects.rs','vorax/crates/vorax/src/bot.rs','vorax/crates/vorax/src/value.rs'];
for(const f of unchanged.filter(f=>before.sourceSha256[f]))assert.equal(sha(f),before.sourceSha256[f],'Reference model/rules changed: '+f);
require('./vorax-manifest');
const native=JSON.parse(fs.readFileSync(path.join(root,'desktop/native/vorax-build.json'))),report={version:require('../desktop/package.json').version,checkedAt:new Date().toISOString(),passed:summaries.reduce((n,m)=>n+Number(m[1]),0),groups:summaries.length,checks:required,backendSha256:native.backendSha256,referenceParityPreserved:true,referenceModelAndRulesPreserved:true,gameCapture:false,gameInput:false};
fs.writeFileSync(path.join(__dirname,'results/vorax-native-checks.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
