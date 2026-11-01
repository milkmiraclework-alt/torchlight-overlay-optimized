'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const baseline=require('./tartarus-working-baseline.json');
for(const [file,expected]of Object.entries(baseline.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'..',file),'utf8').replace(/\r\n/g,'\n')).digest('hex'),expected,'Tartarus differs from the restored working reader/analyzer: '+file);
console.log('PASS: Tartarus screenshot/instrument readers and native reader hosts match the working 1.2.1 source baseline; analyzer progression has a separate regression check.');
