'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
const sources=['tools/scan-kernels.rs','tools/native-window-capture.rs','tools/build-native-reader.ps1','desktop/lib/native-reader-kernels.js'];
const current={architecture:'x64',librarySha256:sha(fs.readFileSync(path.join(root,'desktop/native/tartarus-reader.dll'))),sources:Object.fromEntries(sources.map(f=>[f,sha(fs.readFileSync(path.join(root,f),'utf8').replace(/\r\n/g,'\n'))]))};
const file=path.join(root,'desktop/native/tartarus-reader.build.json');
if(process.argv.includes('--write'))fs.writeFileSync(file,JSON.stringify(current,null,2)+'\n');
else assert.deepEqual(JSON.parse(fs.readFileSync(file)),current,'Rebuild the native reader with tools/build-native-reader.ps1');
module.exports=current;
