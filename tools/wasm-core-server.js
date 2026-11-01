'use strict';
// Offline JSON-line adapter for a frozen copy of our own WASM simulator.
const fs=require('node:fs'),readline=require('node:readline');
const ready=require('../js/rust-solver').fromBytes(fs.readFileSync(process.argv[2]));let queue=ready;
readline.createInterface({input:process.stdin}).on('line',line=>{queue=queue.then(core=>{try{process.stdout.write(JSON.stringify(core.request(JSON.parse(line)))+'\n');}catch(e){process.stdout.write(JSON.stringify({error:e.message})+'\n');}return core;});});
