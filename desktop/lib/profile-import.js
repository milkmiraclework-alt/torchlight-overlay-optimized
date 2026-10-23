'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const resolve=p=>path.resolve(p).toLowerCase();
function hasLegacyProcess(rows,legacy,systemAppData,currentPid){
 const defaultLegacy=path.join(systemAppData||'','Tartarus Overlay');
 return rows.some(row=>{
  if(Number(row.ProcessId)===currentPid||/--type[= ]/.test(row.CommandLine||''))return false;
  if(!/^(?:Torchlight Overlay|Tartarus Overlay|Tartarus Optimized)\.exe$/i.test(row.Name||''))return false;
  const command=row.CommandLine||'';
  const arg=/"--user-data=([^"\r\n]+)"|--user-data="([^"\r\n]+)"|--user-data=([^\s"]+)/i.exec(command);
  return arg?resolve(arg[1]||arg[2]||arg[3])===resolve(legacy):resolve(legacy)===resolve(defaultLegacy);
 });
}
function processes(){
 const command="[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); @(Get-CimInstance Win32_Process -Filter \"Name='Torchlight Overlay.exe' OR Name='Tartarus Overlay.exe' OR Name='Tartarus Optimized.exe'\" | Select-Object Name,ProcessId,CommandLine) | ConvertTo-Json -Compress";
 const text=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,timeout:4000}).trim();
 const data=text?JSON.parse(text):[];return Array.isArray(data)?data:[data];
}
function importProfile({legacy,target,currentPid=process.pid,systemAppData=process.env.APPDATA,getProcesses=processes}){
 if(resolve(legacy)===resolve(target))throw new Error('Legacy and unified profiles must be separate');
 const marker=path.join(target,'legacy-import.json');
 if(fs.existsSync(marker)){try{return JSON.parse(fs.readFileSync(marker,'utf8'));}catch{}}
 const status={version:1,settings:false,storage:{},at:new Date().toISOString()};
 fs.mkdirSync(target,{recursive:true});
 const oldSettings=path.join(legacy,'settings.json'),newSettings=path.join(target,'settings.json');
 if(!fs.existsSync(newSettings)&&fs.existsSync(oldSettings)){
  try{const s=JSON.parse(fs.readFileSync(oldSettings,'utf8').replace(/^\uFEFF/,''));s.record=false;fs.writeFileSync(newSettings,JSON.stringify(s,null,2));status.settings=true;}catch{status.settingsError=true;}
 }
 const dirs=['Local Storage','IndexedDB'];
 const pending=dirs.filter(d=>fs.existsSync(path.join(legacy,d))&&!fs.existsSync(path.join(target,d)));
 if(pending.length){
  let busy=true;
  try{busy=hasLegacyProcess(getProcesses(),legacy,systemAppData,currentPid);}catch{status.processCheckFailed=true;}
  if(busy){status.storageSkipped='legacy-running-or-unknown';}
  else for(const name of pending){
   const dest=path.join(target,name),temp=path.join(target,'.legacy-import-'+process.pid+'-'+name.replace(/ /g,'-'));
   try{fs.cpSync(path.join(legacy,name),temp,{recursive:true,errorOnExist:true,force:false});fs.renameSync(temp,dest);status.storage[name]='copied';}
   catch{status.storage[name]='failed';if(path.resolve(temp).startsWith(path.resolve(target)+path.sep))fs.rmSync(temp,{recursive:true,force:true});}
  }
 }
 for(const name of dirs)if(!status.storage[name]&&fs.existsSync(path.join(target,name)))status.storage[name]='existing';
 fs.writeFileSync(marker,JSON.stringify(status,null,2));return status;
}
module.exports={importProfile,hasLegacyProcess};
