//! Offline diagnostic harness. Never captures a window or sends game input.
use serde_json::{json, Value};
use vorax::{
    advisor::{self, Best, ScreenMonster, ScreenPhase, ScreenState, Work},
    bot,
    data::Targeting,
    game::{create_game, dispatch, ultimate_activity},
    *,
};

fn screen(s: &GameState) -> ScreenState {
    let d = vorax::data();
    ScreenState {
        tanks: s
            .tanks
            .iter()
            .map(|m| {
                m.map(|m| ScreenMonster {
                    archetype: m.archetype,
                    rarity: m.rarity,
                    activity: m.activity,
                    quantity: m.quantity,
                })
            })
            .collect(),
        hand: s
            .hand
            .iter()
            .map(|c| match c.kind {
                CardKind::Potion => d.potion(c.id).name.clone(),
                CardKind::Instrument => d.instrument(c.id).unwrap().name.clone(),
            })
            .collect(),
        instruments: s
            .instruments
            .iter()
            .map(|e| d.instrument(e.id).unwrap().name.clone())
            .collect(),
        instrument_rounds: Some(s.instruments.iter().map(|e| e.acquired_round).collect()),
        phase: if s.phase == Phase::PotionSelect {
            ScreenPhase::Potion
        } else {
            ScreenPhase::Instrument
        },
        round: Some(s.round),
        potion_refreshes: Some(s.potion_refreshes),
        instrument_refreshes: Some(s.instrument_refreshes),
        shelley: Some(6),
        context:None,
    }
}
fn setup(round: i32, tools: Vec<Equipped>, hand: Vec<u8>) -> GameState {
    create_game(
        vorax::data().default_settings,
        Some(&SandboxSetup {
            instruments: tools,
            start_round: round,
            thresholds_used: (true, true),
            forced_hand: hand,
            ..Default::default()
        }),
        Some(12345),
    )
}
fn box_state() -> Value {
    let start = setup(
        5,
        vec![Equipped {
            id: 7,
            acquired_round: 1,
        }],
        vec![33],
    );
    let actual = bot::play_opt(&start, &bot::Opt::card(0, &[]));
    assert_eq!(actual.hand.len(), 5);
    assert_eq!(actual.open_box, Some(33));
    let rebuilt = advisor::to_state(&screen(&actual), &mut vec![]);
    assert_eq!(rebuilt.open_box, None);
    let true_refresh = dispatch(&actual, Action::Refresh);
    let model_refresh = dispatch(&rebuilt, Action::Refresh);
    assert_eq!(true_refresh.hand.len(), 5);
    assert_eq!(model_refresh.hand.len(), 3);
    let mut leaked_kits = 0;
    for seed in 1..=512 {
        let a = dispatch(
            &GameState {
                rng_state: seed,
                ..actual
            },
            Action::Refresh,
        );
        let b = dispatch(
            &GameState {
                rng_state: seed,
                ..rebuilt
            },
            Action::Refresh,
        );
        assert!(a
            .hand
            .iter()
            .all(|c| !matches!(vorax::data().potion(c.id).targeting, Targeting::Box(_))));
        leaked_kits += b
            .hand
            .iter()
            .filter(|c| matches!(vorax::data().potion(c.id).targeting, Targeting::Box(_)))
            .count();
    }
    assert!(leaked_kits > 0);
    let mut fixed_screen=screen(&actual);vorax::session::enrich(&mut fixed_screen,None,true);
    let fixed=advisor::to_state(&fixed_screen,&mut vec![]);let fixed_refresh=dispatch(&fixed,Action::Refresh);assert_eq!(fixed_refresh.hand.len(),5);assert_eq!(fixed.open_box,actual.open_box);
    json!({"confirmed":true,"actualOpenBox":actual.open_box,"rebuiltOpenBox":rebuilt.open_box,"actualRefreshedCards":true_refresh.hand.len(),"rebuiltRefreshedCards":model_refresh.hand.len(),"fixedRefreshedCards":fixed_refresh.hand.len(),"fixedOpenBox":fixed.open_box,"forbiddenKitCardsIn512RebuiltRefreshes":leaked_kits,"screen":screen(&actual)})
}
fn pending_instruments() -> Value {
    let mut before = setup(
        3,
        vec![Equipped {
            id: 7,
            acquired_round: 1,
        }],
        vec![7],
    );
    before.tanks = [Some(Monster {
        archetype: Archetype::Pest,
        rarity: Rarity::Normal,
        activity: 100,
        quantity: 60,
    }); 6];
    before.phase = Phase::RoundEnd;
    before.t8000 = false;
    before.t28000 = false;
    let actual = dispatch(&before, Action::Confirm);
    assert_eq!(actual.phase, Phase::InstrumentSelect);
    assert_eq!(actual.pending_picks, 2);
    let rebuilt = advisor::to_state(&screen(&actual), &mut vec![]);
    let a = bot::play_opt(&actual, &bot::Opt::card(0, &[]));
    let b = bot::play_opt(&rebuilt, &bot::Opt::card(0, &[]));
    assert_eq!(a.phase, Phase::InstrumentSelect);
    assert_eq!(b.phase, Phase::PotionSelect);
    let mut fixed_screen=screen(&actual);vorax::session::enrich(&mut fixed_screen,None,true);let fixed=advisor::to_state(&fixed_screen,&mut vec![]);let fixed_after=bot::play_opt(&fixed,&bot::Opt::card(0,&[]));assert_eq!(fixed.pending_picks,2);assert_eq!(fixed_after.phase,a.phase);
    json!({"confirmed":true,"thresholdCrossingScore":ultimate_activity(&before),"actualPendingPicks":actual.pending_picks,"rebuiltPendingPicks":rebuilt.pending_picks,"actualAfterFirstPick":a.phase,"rebuiltAfterFirstPick":b.phase,"fixedPendingPicks":fixed.pending_picks,"fixedAfterFirstPick":fixed_after.phase,"actualThresholds":[actual.t8000,actual.t28000],"rebuiltThresholds":[rebuilt.t8000,rebuilt.t28000],"screen":screen(&actual)})
}
fn periodic_model() -> Value {
    let mut a = setup(
        10,
        vec![
            Equipped {
                id: 7,
                acquired_round: 1,
            },
            Equipped {
                id: 20,
                acquired_round: 1,
            },
            Equipped {
                id: 24,
                acquired_round: 2,
            },
        ],
        vec![7],
    );
    a.phase = Phase::RoundEnd;
    a.tanks = [Some(Monster {
        archetype: Archetype::Pest,
        rarity: Rarity::Normal,
        activity: 100,
        quantity: 100,
    }); 6];
    let mut b = a;
    b.instruments.as_mut_slice()[1].acquired_round = 2;
    let va = vorax::value::board_value(&a);
    let vb = vorax::value::board_value(&b);
    assert_eq!(va, vb);
    let mut changed = 0;
    let mut due_sum = 0i64;
    let mut not_due_sum = 0i64;
    for seed in 1..=256 {
        let x = dispatch(
            &GameState {
                rng_state: seed,
                ..a
            },
            Action::Confirm,
        );
        let y = dispatch(
            &GameState {
                rng_state: seed,
                ..b
            },
            Action::Confirm,
        );
        changed += (x.tanks != y.tanks) as usize;
        due_sum += ultimate_activity(&x);
        not_due_sum += ultimate_activity(&y);
    }
    assert!(changed > 0);
    let fixed_values=[vorax::continuation::passive_value(&a,1),vorax::continuation::passive_value(&b,1)];assert_ne!(fixed_values[0],fixed_values[1]);
    json!({"confirmed":true,"kind":"heuristic limitation; fixed final-stage policy resolves actual remaining effects","instruments":["Aberrant Sprout","Aberrant Stinger","Nettle Toggle"],"periodicInstrument":"Aberrant Stinger","currentRound":10,"acquiredRounds":[1,2],"sameHeuristicValues":[va,vb],"differentEndOfRoundBoardsOutOf256":changed,"meanNextScoreWhenDue":due_sum as f64/256.,"meanNextScoreWhenNotDue":not_due_sum as f64/256.,"fixedTerminalProjection":fixed_values})
}
fn conditional_model() -> Value {
    let mut a = setup(
        10,
        vec![Equipped {
            id: 4,
            acquired_round: 1,
        }],
        vec![7],
    );
    a.phase = Phase::RoundEnd;
    a.tanks = std::array::from_fn(|i| {
        Some(Monster {
            archetype: if i < 2 {
                Archetype::Agito
            } else {
                Archetype::Pest
            },
            rarity: if i == 0 { Rarity::Rare } else { Rarity::Normal },
            activity: 100,
            quantity: 100,
        })
    });
    let mut b = a;
    b.tanks[0].as_mut().unwrap().rarity = Rarity::Normal;
    b.tanks[2].as_mut().unwrap().rarity = Rarity::Rare;
    let va = vorax::value::board_value(&a);
    let vb = vorax::value::board_value(&b);
    assert_eq!(va, vb);
    let after_a = dispatch(&a, Action::Confirm);
    let after_b = dispatch(&b, Action::Confirm);
    let sa = ultimate_activity(&after_a);
    let sb = ultimate_activity(&after_b);
    assert_eq!(sa, 68000);
    assert_eq!(sb, 60000);
    let fixed=[vorax::continuation::passive_value(&a,1),vorax::continuation::passive_value(&b,1)];assert_eq!(fixed,[Some(92000.),Some(60000.)]);
    json!({"confirmed":true,"kind":"learned heuristic misses a joint prerequisite; fixed final-stage policy uses actual remaining effects","instrument":"Hypertrophic Pituitary","currentRound":10,"beforeScore":ultimate_activity(&a),"sameHeuristicValues":[va,vb],"scoreAfterTickWithRareAgito":sa,"scoreAfterTickWithRarePest":sb,"fixedTerminalProjection":fixed,"sameArchetypeCounts":true,"sameRarityCounts":true})
}
fn play_to_round(mut s: GameState, wanted: i32) -> Option<GameState> {
    let p = bot::Policy {
        samples: 2,
        horizon: 0,
        roll_samples: None,
        steer: None,
        value: Some(true),
    };
    for n in 0..300u32 {
        if s.phase == Phase::GameOver {
            return None;
        }
        if s.round == wanted && s.phase == Phase::PotionSelect && s.open_box.is_none() {
            return Some(s);
        }
        if s.phase == Phase::RoundEnd {
            s = dispatch(&s, Action::Confirm);
            continue;
        }
        if s.phase == Phase::InstrumentSelect {
            s = match bot::value_pick(&s) {
                bot::Pick::Refresh => dispatch(&s, Action::Refresh),
                bot::Pick::Card(i) => bot::play_opt(&s, &bot::Opt::card(i, &[])),
            };
            continue;
        }
        let c = bot::choose(&s, &p, bot::mix(99999, n));
        if s.open_box.is_none()
            && c.value <= c.stay.unwrap_or(ultimate_activity(&s) as f64)
            && vorax::game::can_refresh(&s)
        {
            s = dispatch(&s, Action::Refresh)
        } else {
            s = bot::play_opt(&s, &c.best?)
        }
    }
    None
}
fn kit_priority() -> Value {
    let mut found = Vec::new();
    let mut tested = 0;
    for seed in 17000000..17000064 {
        let Some(mut s) = play_to_round(
            create_game(vorax::data().default_settings, None, Some(seed)),
            10,
        ) else {
            continue;
        };
        let mut cards: Vec<_> = s
            .hand
            .iter()
            .filter(|c| !matches!(vorax::data().potion(c.id).targeting, Targeting::Box(_)))
            .copied()
            .take(2)
            .collect();
        cards.insert(
            0,
            Card {
                kind: CardKind::Potion,
                id: 33,
            },
        );
        s.hand = Hand::from_slice(&cards);
        s.potion_refreshes = 1;
        let x = screen(&s);
        let current = vorax::smart::calculate(&x, false);
        tested += 1;
        let Best::Card(best) = &current.advice.best else {
            continue;
        };
        let Some(refresh) = current.advice.refresh_end else {
            continue;
        };
        let Some(end) = best.end else { continue };
        if best.index != 0 || refresh.activity <= end.activity {
            continue;
        }
        let hold = Work::Potion {
            s: advisor::to_state(&x, &mut vec![]),
            seed: 0xa71d4493,
            la: advisor::LOOK_AHEAD,
            opts: vec![(bot::Opt::card(0, &[]), 0.), (bot::Opt::Refresh, 0.)],
            futures: 2048,
        };
        let values = advisor::play_work(&hold, 10000, 12048, false);
        let mean = |i: usize| values[i].goal / values[i].n as f64;
        found.push(json!({"seed":seed,"boardScore":ultimate_activity(&s),"selected":"Potion Kit (Large)","searchKit":end.activity,"searchRefresh":refresh.activity,"independentKit":mean(0),"independentRefresh":mean(1),"independentFutures":2048,"screen":x,"diagnostics":current.diagnostics}));
        if found.len() >= 3 {
            break;
        }
    }
    json!({"testedConstructedOffers":tested,"scope":"Seeded valid boards at round 10; offer replaced with a legal kit and other potion choices; disjoint evaluation uses the same continuation policy, not live-game outcomes.","examples":found})
}
fn verification_guard()->Value {
    let x:ScreenState=serde_json::from_value(json!({"tanks":(0..6).map(|i|json!({"archetype":if i==0{"boneSentry"}else{"agito"},"rarity":"normal","activity":500,"quantity":if i==0{280}else{284}})).collect::<Vec<_>>(),"hand":["Viviparous Hormone","Osteogenic Powder","Spinal Solution - Agito"],"instruments":["Aberrant Sprout","Prismatic Liver","Beak of the Twice-Born"],"instrumentRounds":[1,4,8],"phase":"potion","round":10,"potionRefreshes":0,"instrumentRefreshes":0,"shelley":6})).unwrap();
    let result=vorax::smart::calculate(&x,false);assert!(result.diagnostics.guaranteed_target||result.diagnostics.objective_rank_corrected&&result.diagnostics.switch_verified);let Best::Card(best)=result.advice.best else{panic!("Expected safe choice")};assert_eq!(best.end.unwrap().activity,840000.);
    json!({"corrected":true,"provedOptimal":result.diagnostics.guaranteed_target,"independentlyVerified":result.diagnostics.switch_verified,"verificationFutures":result.diagnostics.verification_futures,"verificationGain":result.diagnostics.verification_gain,"verificationError":result.diagnostics.verification_error,"expectedFinal":best.end.unwrap().activity,"expectedReached":best.end.unwrap().reached})
}
fn passive_monotonicity()->Value{
    let d=vorax::data();let basic:Vec<_>=d.instruments.iter().filter(|i|matches!(i.pool,vorax::data::Pool::Basic)).collect();let advanced:Vec<_>=d.instruments.iter().filter(|i|matches!(i.pool,vorax::data::Pool::Advanced)).collect();let mut cases=0;
    for basic in &basic{for a in 0..advanced.len(){for b in a+1..advanced.len(){for pattern in 0..3{for seed in [1,99173]{
        let mut s=setup(10,vec![Equipped{id:basic.id,acquired_round:1},Equipped{id:advanced[a].id,acquired_round:4},Equipped{id:advanced[b].id,acquired_round:8}],vec![7]);s.phase=Phase::RoundEnd;s.rng_state=seed;
        s.tanks=std::array::from_fn(|i|Some(Monster{archetype:if pattern==0{Archetype::Pest}else{[Archetype::Pest,Archetype::Aemberon,Archetype::BoneSentry,Archetype::Agito][i%4]},rarity:if pattern==1{Rarity::Magic}else{Rarity::Normal},activity:700,quantity:200}));
        while s.phase!=Phase::GameOver{let before=ultimate_activity(&s);s=dispatch(&s,Action::Confirm);assert!(ultimate_activity(&s)>=before,"Passive score fell with instruments {},{},{}",basic.name,advanced[a].name,advanced[b].name);}cases+=1;
    }}}}}
    json!({"passed":true,"cases":cases,"everyLegalInstrumentTriple":true,"scope":"Constructed nonnegative boards at the capped goal, three archetype/rarity patterns and two seeds; every remaining tick dispatched through the reference engine"})
}
fn trace_choice(x:&ScreenState,exe:&str)->Best{
    use std::io::Write;use std::process::{Command,Stdio};
    let mut child=Command::new(exe).args(["advise","--smart","--single"]).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();let mut input=child.stdin.take().unwrap();input.write_all(&serde_json::to_vec(x).unwrap()).unwrap();drop(input);let out=child.wait_with_output().unwrap();assert!(out.status.success());let value:Value=serde_json::from_slice(&out.stdout).unwrap();let best=&value["advice"]["best"];if best.as_str()==Some("refresh"){Best::Refresh}else if best.is_null(){Best::Nothing}else{Best::Card(serde_json::from_value(best.clone()).unwrap())}
}
fn trace_play(s:&GameState,best:&Best)->GameState{match best{Best::Refresh=>dispatch(s,Action::Refresh),Best::Card(r)=>bot::play_opt(s,&bot::Opt::card(r.index,&r.targets)),Best::Nothing=>bot::play_opt(s,&bot::options(s)[0])}}
fn trace_run(seed:u32,baseline:Option<&str>)->(Vec<(GameState,Best)>,i64){
    let mut s=create_game(vorax::data().default_settings,None,Some(seed));let mut rows=Vec::new();for _ in 0..300{if s.phase==Phase::GameOver{return(rows,ultimate_activity(&s))}if s.phase==Phase::RoundEnd{s=dispatch(&s,Action::Confirm);continue}let mut x=screen(&s);x.context=Some(advisor::RunContext::from_state(&s));let best=if let Some(exe)=baseline{trace_choice(&x,exe)}else{vorax::smart::calculate(&x,false).advice.best};rows.push((s,best.clone()));s=trace_play(&s,&best);}panic!("Trace did not finish")
}
fn trace(seed:u32,baseline:&str)->Value{
    let(a,score_a)=trace_run(seed,Some(baseline));let(b,score_b)=trace_run(seed,None);let mut first=None;
    for(i,((sa,ba),(sb,bb)))in a.iter().zip(&b).enumerate(){assert_eq!(sa,sb,"State diverged before a different choice");if trace_play(sa,ba)!=trace_play(sb,bb){first=Some((i,*sa,ba.clone(),bb.clone()));break}}
    let mut evaluation=Value::Null;if let Some((i,s,before,after))=first{
        let opt=|b:&Best|match b{Best::Refresh=>bot::Opt::Refresh,Best::Card(r)=>bot::Opt::card(r.index,&r.targets),_=>panic!("No action")};
        let work=if s.phase==Phase::PotionSelect{Work::Potion{s,seed:0x11d7da05,la:bot::LookAhead{inner_samples:Some(4),..advisor::LOOK_AHEAD},opts:vec![(opt(&before),0.),(opt(&after),0.)],futures:4096}}else{Work::Instrument{s,seed:0x11d7da05,choices:[&before,&after].iter().map(|b|match opt(b){bot::Opt::Refresh=>bot::Pick::Refresh,bot::Opt::Card{index,..}=>bot::Pick::Card(index as usize)}).collect(),futures:4096}};
        let values=advisor::play_work(&work,10000,14096,false);evaluation=json!({"decision":i,"round":s.round,"phase":s.phase,"screen":screen(&s),"actualContext":advisor::RunContext::from_state(&s),"before":before,"after":after,"independentFutures":4096,"beforeValue":values[0].goal/4096.,"afterValue":values[1].goal/4096.,"beforeReach":values[0].reached as f64/4096.,"afterReach":values[1].reached as f64/4096.});
    }
    json!({"seed":seed,"terminalSamples":vorax::continuation::terminal_samples(),"baselineScore":score_a,"candidateScore":score_b,"firstDivergence":evaluation,"baselineDecisions":a.len(),"candidateDecisions":b.len(),"gameCapture":false,"gameInput":false})
}
fn main() {
    let args:Vec<String>=std::env::args().collect();if let Some(i)=args.iter().position(|a|a=="--trace-seed"){let seed=args[i+1].parse().unwrap();let at=args.iter().position(|a|a=="--baseline-exe").unwrap();println!("{}",serde_json::to_string_pretty(&trace(seed,&args[at+1])).unwrap());return}
    let report = json!({"gameCapture":false,"gameInput":false,"openBoxState":box_state(),"pendingInstrumentState":pending_instruments(),"periodicHeuristic":periodic_model(),"conditionalHeuristic":conditional_model(),"verificationGuard":verification_guard(),"passiveMonotonicity":passive_monotonicity(),"forcedKitPriority":if std::env::args().any(|a|a=="--verify-fixes"){json!({"unchanged":"Prior independent audit did not establish that removing this rule improves choices"})}else{kit_priority()}});
    println!("{}", serde_json::to_string_pretty(&report).unwrap());
}
