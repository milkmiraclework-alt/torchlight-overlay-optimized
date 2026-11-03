'use strict';
// Fitted probabilities from Timer's authorised model, applied through the
// corresponding local-game effects. This is a prior, not measured server odds.
const R=require('./timer-reader/route-engine'),E=require('./engine'),W=require('./world-sampler');
const uniform=Object.keys(E.DATA.events).map(Number).filter(id=>id>=9201&&id<=9225);
const groups={
 chests_on_cells:[9223,9224,9225],
 traps_to_chests_near:[8001],traps_to_heals_near:[8002,8003,8004],
 traps_to_cards_near:[8005,8006,8007],traps_to_upgrades_near:[8008,8009,8010,8011],
 upgrade_owned:[9201,9202,9203],upgrade_owned_all:[9204],upgrade_map_all:[9217],
 life:[9205,9206,9207],movement_notes:[9208,9209,9210],
 choose_back_notes:[9211,9212,9213],choose_any_notes:[9214,9215,9216],
 upgrade_card:[9220],map_all_red:[9218],map_all_rainbow:[9219],
 remove_traps:[9221],traps_to_chests:[9222]
};
const outcomes=Object.entries(R.DEFAULT_RULES.question).flatMap(([name,rule])=>{
 const ids=groups[name];if(!ids?.length)throw Error('Unmapped fitted question: '+name);
 return ids.map(id=>{if(!E.DATA.events[id])throw Error('Missing local question effect '+id);return {id,weight:rule.weight/ids.length};});
});
const total=outcomes.reduce((n,o)=>n+o.weight,0);
function sample(s,r){
 if(!W.available(s))return E.pick(uniform,r);
 let value=r()*total;for(const o of outcomes){value-=o.weight;if(value<0)return o.id;}
 return outcomes.at(-1).id;
}
module.exports={sample,outcomes};
