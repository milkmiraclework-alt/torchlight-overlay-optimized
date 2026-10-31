'use strict';
const fs=require('node:fs'),{StringDecoder}=require('node:string_decoder');
function classify(line){
  if(/LogLoad: LoadMap:/.test(line))return 'idle';
  if(/S13GamePlayMain Hide|ProtoId = 5621\b|S13GamePlayReward_C_(?:Fight|GiveUp)Btn/.test(line))return 'idle';
  if(/S16GamePlayEntry Run|S16GamePlayCheckOut Run|UI_S16_Riot_Interface|Btn_S16GamePlay_CheckOut_(?:Abandon|Start)Challenge/.test(line))return 'idle';
  if(/\bS9Taro Hide\b|\bS9Challenge Run\b|\bS9FinalPlayStart\b|\bS9AbandonPlay\b|ProtoId = 555[56]\b/.test(line))return 'idle';
  if(/\bS9Taro Run\b|\bS9ChooseCard Run\b|S9Taro_C_|\bS9CardPlayStart\b|ProtoId = 555[1-4]\b/.test(line)&&!/LogDataTable|AssetLoad@|LoadObject/.test(line))return 'arcana';
  if(/S13GamePlayMain Run|S13GamePlay_C_StartGameBtn|ProtoId = 5619\b|S13GamePlayMain_C_RefreshBtn/.test(line))return 'vorax';
  if(/S16BoardMain Run|Btn_S16GamePlay_Start|S16Board(?:Task|Relic|Colored)Pop Run|S16BoardRelicPop_C|Btn_S16Board_ActionCell|UI_S16_Click_(?:Eat|Cancel)\b/.test(line))return 'tartarus';
  return null;
}
class LogTail{
  constructor(feed){this.feed=feed;this.path=null;this.offset=0;this.identity='';this.rest='';this.decoder=new StringDecoder('utf8');}
  setPath(file){if(file===this.path)return;this.path=file;this.offset=0;this.identity='';this.rest='';this.decoder=new StringDecoder('utf8');this.poll(true);}
  poll(initial=false){
    if(!this.path)return;
    let fd;
    try{
      const stat=fs.statSync(this.path),identity=stat.ino+':'+stat.birthtimeMs;
      const reset=identity!==this.identity||stat.size<this.offset;
      if(reset){this.identity=identity;this.offset=Math.max(0,stat.size-262144);this.rest='';this.decoder=new StringDecoder('utf8');}
      if(stat.size===this.offset)return;
      const start=this.offset,bytes=Buffer.alloc(Math.min(262144,stat.size-start));
      fd=fs.openSync(this.path,'r');const n=fs.readSync(fd,bytes,0,bytes.length,start);this.offset+=n;
      let text=this.rest+this.decoder.write(bytes.subarray(0,n));
      if(reset&&start>0)text=text.slice(text.indexOf('\n')+1);
      const lines=text.split(/\r?\n/);this.rest=(lines.pop()||'').slice(-8192);
      this.feed(lines,{initial:initial||reset});
    }catch{/* Missing/rotated logs are retried by the common watcher. */}finally{if(fd!==undefined)fs.closeSync(fd);}
  }
}
module.exports={classify,LogTail};
