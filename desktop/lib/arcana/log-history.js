'use strict';
// One bounded local read at log attachment/rotation. No screenshots, network
// or persistent copy of the raw game log. The live tail supplies its exact
// byte boundary so events appended during catch-up cannot be replayed twice.
const fs=require('node:fs'),{classify}=require('../mode-router');
const {detectEncoding}=require('./timer-reader/log');
const MAX_BYTES=25*1024*1024;
function read(file,{end,identity,encoding,maxBytes=MAX_BYTES}={}){
 if(!Number.isInteger(maxBytes)||maxBytes<64||maxBytes>MAX_BYTES)throw Error('Invalid Arcana history budget');
 const fd=fs.openSync(file,'r');
 try{
  const stat=fs.fstatSync(fd),actual=stat.ino+':'+stat.birthtimeMs;
  if(identity&&identity!==actual)return null;
  const through=end??stat.size;if(!Number.isSafeInteger(through)||through<0||through>stat.size)return null;
  encoding=encoding||detectEncoding(file);if(!['utf8','utf16le'].includes(encoding))throw Error('Unsupported game log encoding');
  let start=Math.max(0,through-maxBytes);if(encoding==='utf16le')start+=start%2;
  const bytes=Buffer.alloc(through-start),n=fs.readSync(fd,bytes,0,bytes.length,start);
  if(n!==bytes.length)return null;
  let text=bytes.toString(encoding);if(start)text=text.slice(text.indexOf('\n')+1);else text=text.replace(/^\uFEFF/,'');
  const lines=text.split(/\r?\n/);lines.pop();let mode=null;for(const line of lines){const next=classify(line);if(next)mode=next;}
  return {lines,mode,bytes:n,start,end:through,identity:actual,encoding};
 }finally{fs.closeSync(fd);}
}
module.exports={read,MAX_BYTES};
