//! Metadata from an already completed reading/calculation. No capture or simulation.
use serde_json::{json, Value};
use vorax::advisor::{Advice, ScreenPhase};
use vorax_scan::reading::Reading;

pub fn snapshot(reading: &Reading, advice: &Advice, diagnostics: Option<&vorax::smart::Diagnostics>) -> Value {
    let state=&reading.state;
    let activity:i64=state.tanks.iter().flatten().map(|m|m.activity*m.quantity).sum();
    let activity_sure=state.tanks.len()==6&&(0..6).all(|i|{
        let sure=|field:&str|reading.fields.get(&format!("tank{i}.{field}")).is_some_and(|f|f.sure);
        if state.tanks[i].is_none(){sure("empty")}else{sure("activity")&&sure("quantity")}
    });
    let hand:Vec<Value>=state.hand.iter().enumerate().map(|(index,name)|{
        let id=if state.phase==ScreenPhase::Instrument{vorax::data().instrument_by_name(name)}else{vorax::data().potion_by_name(name)};
        let kit=id.filter(|_|state.phase==ScreenPhase::Potion).is_some_and(|id|matches!(vorax::data().potion(id).targeting,vorax::data::Targeting::Box(_)));
        json!({"index":index,"name":name,"id":id,"kit":kit})
    }).collect();
    json!({"state":state,"advice":advice,"diagnostics":diagnostics,"handDefinitions":hand,
        "activity":{"value":activity,"sure":activity_sure,"kind":"observed_board_not_terminal_result"},
        "recognition":{"fields":reading.fields,"problems":reading.problems,"handRanks":reading.hand_ranks,"instrumentRanks":reading.instrument_ranks,"handSize":reading.hand_size,"ui":reading.ui,"frame":reading.frame}})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn telemetry_keeps_protocol_activity_separate_from_adviser_zero_and_terminal_score(){
        use vorax_scan::reading::{FieldRead,Fields};
        let mut r=Reading{state:vorax_scan::reading::empty_state(),fields:Fields::new(),problems:vec![],frame:None,instrument_ranks:None,hand_ranks:None,icons_known:None,hand_pending:None,hand_size:None,ui:None,debug:None,hand_dy:None};
        r.state.tanks=vec![None;6];
        r.state.tanks[0]=Some(vorax::advisor::ScreenMonster{archetype:vorax::types::Archetype::Agito,rarity:vorax::types::Rarity::Normal,activity:120,quantity:30});
        r.state.phase=ScreenPhase::Protocol;
        let advice=vorax::advisor::advise_plan(&r.state,None,false);
        let v=snapshot(&r,&advice,None);
        assert_eq!(v["activity"]["value"],3600);assert_eq!(v["advice"]["board"],0);assert_eq!(v["activity"]["sure"],false);
        for i in 1..6{r.fields.insert(format!("tank{i}.empty"),FieldRead::sure(true));}
        for field in ["activity","quantity"]{r.fields.insert(format!("tank0.{field}"),FieldRead::sure(true));}
        assert_eq!(snapshot(&r,&advice,None)["activity"]["sure"],true);
        assert_eq!(v["activity"]["kind"],"observed_board_not_terminal_result");
        assert!(v.get("pixels").is_none());
    }
}
