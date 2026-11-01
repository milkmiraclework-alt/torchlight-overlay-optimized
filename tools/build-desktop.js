'use strict';
// The pinned builder does not expose a Portable script option. Replace only
// that target's template in this build process; dependencies stay untouched.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),desktop=path.join(root,'desktop');
const builder=require('../desktop/node_modules/electron-builder');
const {NsisTarget}=require('../desktop/node_modules/app-builder-lib/out/targets/nsis/NsisTarget');
assert.equal(require('../desktop/node_modules/app-builder-lib/package.json').version,'26.16.1','Review the Portable template adapter after changing electron-builder');
const original=NsisTarget.prototype.computeFinalScript,portable=fs.readFileSync(path.join(desktop,'build/portable.nsi'),'utf8');
assert(portable.includes('InitPluginsDir')&&portable.includes('StrCpy $INSTDIR "$PLUGINSDIR\\app"'));
NsisTarget.prototype.computeFinalScript=function(script,...args){return original.call(this,this.isPortable?portable:script,...args);};
const at=process.argv.indexOf('--out'),out=path.resolve(desktop,at<0?'dist':process.argv[at+1]);
assert(out===path.join(desktop,'dist')||out.startsWith(path.join(desktop,'dist')+path.sep),'Build output must stay within desktop/dist');
builder.build({projectDir:desktop,targets:builder.Platform.WINDOWS.createTarget(process.argv.includes('--dir')?['dir']:['nsis','portable'],builder.Arch.x64),config:{directories:{output:out}},publish:'never'}).catch(e=>{console.error(e.message);process.exitCode=1;});
