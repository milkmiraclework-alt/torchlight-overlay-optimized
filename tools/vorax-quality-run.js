'use strict';
// Offline simulation only; no overlay, capture or input code is executed.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),arg=(n,d)=>{const i=process.argv.indexOf(n);return i<0?d:process.argv[i+1];};
const args=['quality','--games','--count',arg('--games','32'),'--seed',arg('--seed','8600000'),'--threads',arg('--threads','6'),process.argv.includes('--balanced')?'--balanced':process.argv.includes('--wide')?'--wide':'--deep','--baseline-smart'];
if(process.argv.includes('--terminal-samples'))args.push('--terminal-samples',arg('--terminal-samples','0'));
if(process.argv.includes('--terminal-ties'))args.push('--terminal-ties');
if(process.argv.includes('--positions')){args.splice(args.indexOf('--games'),1);args.push('--futures',arg('--futures','1024'));}
const out=path.resolve(arg('--out','tools/results/vorax-deep-pilot-20261102.json')),files=['vorax/crates/vorax/src/smart.rs','vorax/crates/vorax-cli/src/main.rs','vorax/crates/vorax-cli/src/quality.rs','vorax/crates/vorax/src/bot.rs','vorax/crates/vorax/src/advisor.rs','vorax/crates/vorax/src/session.rs','vorax/crates/vorax/src/continuation.rs','vorax/crates/vorax/src/value.rs'];
const hashes=()=>Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')])),before=hashes();
const sourceExe=path.resolve(arg('--exe','vorax/target/release/vorax.exe')),snapshot=path.join(root,'sandbox','vorax-quality-'+Date.now()+'-'+process.pid);fs.mkdirSync(snapshot,{recursive:true});
const exe=path.join(snapshot,'vorax.exe');fs.copyFileSync(sourceExe,exe);for(const file of files){const copy=path.join(snapshot,file);fs.mkdirSync(path.dirname(copy),{recursive:true});fs.copyFileSync(path.join(root,file),copy);}
const baselineArg=arg('--baseline-exe',null);let baselineBinarySha256=null;
if(baselineArg){const frozen=path.join(snapshot,'baseline.exe');fs.copyFileSync(path.resolve(baselineArg),frozen);baselineBinarySha256=crypto.createHash('sha256').update(fs.readFileSync(frozen)).digest('hex');args.push('--baseline-exe',frozen);}
const binaryHash=crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex'),env={...process.env};delete env.VORAX_DATA;
const child=spawn(exe,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',errors='';
child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{errors+=b;process.stdout.write(b);});child.on('error',e=>{console.error(e);process.exitCode=1;});
child.on('close',code=>{
 try{if(code!==0)throw Error(errors||'Quality process failed');if(crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex')!==binaryHash||files.some(file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(snapshot,file))).digest('hex')!==before[file]))throw Error('Frozen binary or source snapshot changed during comparison');
 const r=JSON.parse(output),target=840000,positions=r.kind==='positions',d=r.rows.map(p=>positions?p.smartValue-p.baselineValue:Math.min(target,p.smart)-Math.min(target,p.baseline)),mean=d.reduce((a,b)=>a+b,0)/d.length,half=1.96*Math.sqrt(d.reduce((a,b)=>a+(b-mean)**2,0)/(d.length-1)/d.length);
 Object.assign(r,{terminalSamples:Number(arg('--terminal-samples','0')),terminalTies:process.argv.includes('--terminal-ties'),checkedAt:new Date().toISOString(),scope:positions?'Candidate versus Balanced decisions on independent positions; disjoint 1024-future continuation evaluation. Not live profit.':'Candidate versus Balanced advisers on seeded full local-rule games. Not live profit or calibrated server performance.',code:before,binarySha256:binaryHash,baselineBinarySha256,pairedCappedDifference:mean,approx95CI:[mean-half,mean+half],baselineSeconds:r.rows.reduce((n,p)=>n+(positions?p.baselineMs/1000:p.baselineSeconds),0)/r.rows.length,candidateSeconds:r.rows.reduce((n,p)=>n+(positions?p.smartMs/1000:p.smartSeconds),0)/r.rows.length});
 fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({...r,rows:undefined,code:undefined}));
 }catch(e){console.error(e.message);process.exitCode=1;}
});
