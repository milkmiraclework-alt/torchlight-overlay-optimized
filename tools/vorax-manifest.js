'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),sources={};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const sourceHash=f=>sha(/\.(png|ico)$/.test(f)?fs.readFileSync(path.join(root,f)):fs.readFileSync(path.join(root,f),'utf8').replace(/\r\n/g,'\n'));
function walk(dir){for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const f=dir+'/'+e.name;if(e.isDirectory())walk(f);else if(/\.(rs|toml|lock|json|rc|png|ico)$/.test(f)||e.name==='LICENSE')sources[f]=sourceHash(f);}}
walk('vorax/crates');walk('vorax/data');for(const f of ['vorax/Cargo.toml','vorax/Cargo.lock','vorax/LICENSE'])sources[f]=sourceHash(f);
const current={backendSha256:sha(fs.readFileSync(path.join(root,'desktop/native/vorax-backend.exe'))),sources};
const dest=path.join(root,'desktop/native/vorax-build.json');
if(process.argv.includes('--write')){fs.writeFileSync(dest,JSON.stringify(current,null,2)+'\n');fs.copyFileSync(path.join(root,'vorax/LICENSE'),path.join(root,'desktop/native/VORAX-LICENSE.txt'));}
else assert.deepEqual(JSON.parse(fs.readFileSync(dest)),current,'Vorax backend sources changed: rebuild tools/build-vorax-backend.ps1');
module.exports=current;
