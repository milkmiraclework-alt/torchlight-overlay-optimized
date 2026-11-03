'use strict';
const fs=require('node:fs');
// Chromium creates this file before closing its write handle. On Windows
// existence does not yet mean it can be read, or that the port line is done.
module.exports=file=>{
 let text;try{text=fs.readFileSync(file,'utf8');}catch(error){if(['ENOENT','EBUSY'].includes(error.code))return null;throw error;}
 const lines=text.trim().split(/\r?\n/),port=/^\d+$/.test(lines[0])?Number(lines[0]):0,route=lines[1];
 return Number.isInteger(port)&&port>0&&port<=65535&&/^\/devtools\/browser\/[^\s]+$/.test(route||'')?{port,route}:null;
};
