/* Advice bridge for the bundled corrector. No recording or cross-page channel. */
(function(){
 'use strict';
 const D=window.TartarusDesktop,A=window.TartarusAnalyzer;
 if(!D||!A||window.__unifiedAdviceBridge)return;window.__unifiedAdviceBridge=true;
 let last='',queued=false;
 function post(){queued=false;const data=A.desktopSnapshot(),key=JSON.stringify(data);if(key!==last){last=key;D.advice(data);}}
 function soon(){if(!queued){queued=true;queueMicrotask(post);}}
 A.onDesktopChange(soon);soon();
 const click=id=>{const el=document.getElementById(id);if(!el||el.disabled)return false;el.click();return true;};
 D.onCommand(cmd=>{
  if(cmd==='fix'){if(!click('az-fix'))document.getElementById('az-game')?.scrollIntoView({block:'center'});}
  else if(cmd==='recheck'){if(!click('az-recheck'))click('az-go');}
  else if(cmd==='tools-ok')click('az-tools-ok');
  else if(cmd==='tools')A.openTools();
  else if(cmd==='treasure-now')click('az-treasure-now');
  else if(cmd==='run-over'){click('az-clear');click('az-clear');}
  soon();
 });
})();
