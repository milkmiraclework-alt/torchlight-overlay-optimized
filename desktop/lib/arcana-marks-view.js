'use strict';
window.Overlay.onArcana(state=>{
 const children=(state?.marks||[]).map(mark=>{const el=document.createElement('div'),target=mark.index===state.target;el.className='tile'+(mark.current?' current':'')+(mark.unknown?' unknown':'')+(target?' target':'');el.style.left=(mark.x*100)+'%';el.style.top=(mark.y*100)+'%';el.textContent=(target?'GO · ':'')+mark.label+(mark.unknown?' ?':'');el.dataset.index=String(mark.index);return el;});
 document.getElementById('marks').replaceChildren(...children);
});
