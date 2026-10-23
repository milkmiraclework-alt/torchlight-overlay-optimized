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
