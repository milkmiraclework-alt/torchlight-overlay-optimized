'use strict';
const D=window.TartarusDesktop,$=id=>document.getElementById(id);
function render(s){if(!s)return;const enabled=s.consent?.version===4&&!s.consent.withdrawn;
 $('status').textContent=(enabled?'Capture enabled':'Capture stopped')+' · Active mode: '+(s.activeMode||'idle')+(s.suite?' · '+s.suite.threads+' Vorax threads':'');
 if(s.suite?.lastStatus?.event==='error')$('status').textContent+=' · '+s.suite.lastStatus.reason;
 $('mode').value=s.mode||'auto';$('speed').checked=!!s.speed;$('shelley').value=s.shelley||6;$('threads').value=s.threads||0;
}
$('enable').onclick=()=>D.setConsent({version:4,at:new Date().toISOString()});
$('disable').onclick=()=>D.setConsent({withdrawn:true,at:new Date().toISOString()});
$('mode').onchange=()=>D.setFastSettings({mode:$('mode').value});
$('speed').onchange=()=>D.setFastSettings({speed:$('speed').checked});
$('shelley').onchange=()=>D.setFastSettings({shelley:Number($('shelley').value)});
$('threads').onchange=()=>D.setFastSettings({threads:Math.min(128,Math.max(0,Math.trunc(Number($('threads').value)||0)))});
$('read').onclick=()=>D.readNow();$('log').onclick=()=>D.pickLog();
D.fastSettings().then(render);D.onFastSettings(render);
function renderUpdate(s){if(!s)return;
 const labels={idle:'Ready to check.',checking:'Checking for updates…',current:'You have the latest version.',available:'Update '+s.version+' is available.',downloading:'Downloading '+s.version+': '+s.percent+'%',ready:'Update '+s.version+' is downloaded. Restart when ready.',error:'Update failed: '+s.error,unsupported:'Use the Portable EXE or Setup to enable updates; unpacked development builds are not replaced.'};
 $('update-status').textContent='Version '+s.current+' · '+(labels[s.phase]||s.phase);
 $('auto-updates').checked=s.enabled;$('auto-updates').disabled=!s.supported;
 $('update-check').disabled=!s.supported||['checking','downloading'].includes(s.phase);
 $('update-download').hidden=!s.version||!['available','error'].includes(s.phase);
 $('update-install').hidden=s.phase!=='ready';
}
$('auto-updates').onchange=()=>D.updateCommand('enabled',$('auto-updates').checked);
for(const action of ['check','download','install'])$('update-'+action).onclick=()=>D.updateCommand(action);
D.updates().then(renderUpdate);D.onUpdate(renderUpdate);
