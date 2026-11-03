'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
module.exports=solver=>Object.fromEntries(['solver.js','engine.js','endgame.js','world-sampler.js','capacity-plan.js','question-model.js','fixed-reward.js','rollout-values.json','game-data.json','timer-reader/route-engine.js'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(name==='solver.js'&&solver?path.resolve(solver):path.resolve(__dirname,'../desktop/lib/arcana',name))).digest('hex')]));
