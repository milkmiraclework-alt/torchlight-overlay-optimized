//! Paired offline evaluations. Search never gets the simulated game's hidden RNG.
use rayon::prelude::*;
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;
use vorax::advisor::{self, Best, ScreenMonster, ScreenPhase, ScreenState, Work};
use vorax::bot::{self, Opt, Pick};
use vorax::game::{create_game, dispatch, ultimate_activity};
use vorax::smart;
use vorax::{Action, GameState, Phase};

fn screen(s: &GameState) -> ScreenState {
    let d = vorax::data();
    ScreenState {
        tanks: s.tanks.iter().map(|m| m.map(|m| ScreenMonster { archetype: m.archetype, rarity: m.rarity, activity: m.activity, quantity: m.quantity })).collect(),
        hand: s.hand.iter().map(|c| match c.kind {
            vorax::CardKind::Potion => d.potion(c.id).name.clone(),
            vorax::CardKind::Instrument => d.instrument(c.id).unwrap().name.clone(),
        }).collect(),
        instruments: s.instruments.iter().map(|e| d.instrument(e.id).unwrap().name.clone()).collect(),
        instrument_rounds: Some(s.instruments.iter().map(|e| e.acquired_round).collect()),
        phase: if s.phase == Phase::PotionSelect { ScreenPhase::Potion } else { ScreenPhase::Instrument },
        round: Some(s.round), potion_refreshes: Some(s.potion_refreshes), instrument_refreshes: Some(s.instrument_refreshes), shelley: Some(6),context:Some(advisor::RunContext::from_state(s)),
    }
}
fn play(s: &GameState, best: &Best) -> GameState {
    match best {
        Best::Refresh => dispatch(s, Action::Refresh),
        Best::Card(r) => bot::play_opt(s, &Opt::card(r.index, &r.targets)),
        Best::Nothing => bot::play_opt(s, &bot::options(s)[0]),
    }
}
fn as_opt(best: &Best) -> Opt {
    match best {
        Best::Refresh => Opt::Refresh,
        Best::Card(r) => Opt::card(r.index, &r.targets),
        Best::Nothing => panic!("No scored choice on an evaluation position"),
    }
}
fn same_choice(a: &Best, b: &Best) -> bool { as_opt(a) == as_opt(b) }

fn frozen_choice(x:&ScreenState,exe:&str)->Best{
    use std::io::Write;
    use std::process::{Command,Stdio};
    let mut child=Command::new(exe).args(["advise","--smart","--single"]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().expect("Baseline CLI");
    let mut input=child.stdin.take().unwrap();input.write_all(&serde_json::to_vec(x).unwrap()).unwrap();drop(input);
    let output=child.wait_with_output().unwrap();assert!(output.status.success(),"Baseline CLI failed");let value:serde_json::Value=serde_json::from_slice(&output.stdout).unwrap();let choice=&value["advice"]["best"];
    if choice.as_str()==Some("refresh"){Best::Refresh}else if choice.is_null(){Best::Nothing}else{Best::Card(serde_json::from_value(choice.clone()).unwrap())}
}

fn position_audit(count: usize, futures: u32, seed: u32, profile: smart::Profile, baseline_smart: bool,baseline_exe:Option<&str>) {
    // One position per independent game, not many correlated positions from a
    // handful of runs. Include basic/advanced instruments and early/late potions.
    let positions: Vec<_> = (0..count as u32).into_par_iter().map(|game| {
        let mut s = create_game(vorax::data().default_settings, None, Some(seed.wrapping_add(game)));
        let wanted_round = [2, 4, 7, 9][game as usize % 4];
        let mut last = screen(&s);
        for _ in 0..300 {
            if s.phase == Phase::GameOver { break }
            if s.phase == Phase::RoundEnd { s = dispatch(&s, Action::Confirm); continue }
            let x = screen(&s);
            last = x.clone();
            let wanted = if game % 5 == 0 {
                s.phase == Phase::InstrumentSelect && (game % 10 == 0 || !s.instruments.is_empty())
            } else { s.phase == Phase::PotionSelect && s.round == wanted_round };
            if wanted { return (game, x) }
            let a = advisor::advise_plan(&x, None, false);
            s = play(&s, &a.best);
        }
        (game, last)
    }).collect();
    let done = AtomicUsize::new(0);
    let results: Vec<_> = positions.par_iter().enumerate().map(|(i, (game, x))| {
        let before = Instant::now();
        let baseline = if let Some(exe)=baseline_exe{frozen_choice(x,exe)}else if baseline_smart { smart::calculate_profile(x,false,smart::Profile::Balanced).advice.best } else { advisor::advise_plan(x, None, false).best };
        let baseline_ms = before.elapsed().as_secs_f64() * 1000.0;
        let before = Instant::now();
        let improved = smart::calculate_profile(x, false, profile);
        let smart_ms = before.elapsed().as_secs_f64() * 1000.0;
        let actions = [as_opt(&baseline), as_opt(&improved.advice.best)];
        let mut unknown = Vec::new();
        let s = advisor::to_state(x, &mut unknown);
        // New seed domain and future range, disjoint from search. Both choices
        // use the exact same complete futures and the same continuation policy.
        let hold_seed = bot::mix(seed ^ 0xd152_a84f, i as u32);
        let work = if s.phase == Phase::PotionSelect {
            Work::Potion { s, seed: hold_seed, la: bot::LookAhead { inner_samples: Some(4), ..advisor::LOOK_AHEAD }, opts: actions.iter().map(|&o| (o, 0.0)).collect(), futures }
        } else {
            Work::Instrument { s, seed: hold_seed, choices: actions.iter().map(|o| match o { Opt::Refresh => Pick::Refresh, Opt::Card { index, .. } => Pick::Card(*index as usize) }).collect(), futures }
        };
        let evaluated = advisor::play_work(&work, 10000, 10000 + futures, false);
        let avg = |k: usize| evaluated[k].goal / evaluated[k].n as f64;
        let reach = |k: usize| evaluated[k].reached as f64 / evaluated[k].n as f64;
        let n = done.fetch_add(1, Ordering::Relaxed) + 1;
        if n % 8 == 0 { eprintln!("positions {n}/{}", positions.len()); }
        json!({"game":game,"round":x.round,"phase":x.phase,"changed":!same_choice(&baseline,&improved.advice.best),"baseline":baseline,"smart":improved.advice.best,"baselineValue":avg(0),"smartValue":avg(1),"baselineReach":reach(0),"smartReach":reach(1),"baselineMs":baseline_ms,"smartMs":smart_ms,"diagnostics":improved.diagnostics})
    }).collect();
    let n = results.len() as f64;
    let sum = |key: &str| results.iter().map(|r| r[key].as_f64().unwrap()).sum::<f64>() / n;
    println!("{}", serde_json::to_string_pretty(&json!({"kind":"positions","profile":profile,"baselineSmart":baseline_smart,"seed":seed,"futuresPerChoice":futures,"positions":results.len(),"changed":results.iter().filter(|r|r["changed"]==true).count(),"baselineMean":sum("baselineValue"),"smartMean":sum("smartValue"),"baselineReach":sum("baselineReach"),"smartReach":sum("smartReach"),"rows":results})).unwrap());
}

fn one_game(seed: u32, improved: bool, profile: smart::Profile, baseline_smart: bool, futures: Option<u32>, baseline_exe: Option<&str>) -> (i64, f64, usize) {
    let begin = Instant::now();
    let mut s = create_game(vorax::data().default_settings, None, Some(seed));
    let mut decisions = 0;
    for _ in 0..300 {
        if s.phase == Phase::GameOver { return (ultimate_activity(&s), begin.elapsed().as_secs_f64(), decisions) }
        if s.phase == Phase::RoundEnd { s = dispatch(&s, Action::Confirm); continue }
        let x = screen(&s);
        let best = if !improved && baseline_exe.is_some() {
            frozen_choice(&x,baseline_exe.unwrap())
        } else {let a = if improved { smart::calculate_profile(&x, false, profile).advice } else if baseline_smart { smart::calculate_profile(&x, false, smart::Profile::Balanced).advice } else { advisor::advise_plan(&x, futures, false) };a.best};
        decisions += 1;
        s = play(&s, &best);
    }
    panic!("Simulation did not finish, seed {seed}");
}
fn games_audit(games: usize, seed: u32, profile: smart::Profile, baseline_smart: bool, futures: Option<u32>, baseline_exe: Option<&str>) {
    let done = AtomicUsize::new(0);
    let rows: Vec<_> = (0..games).into_par_iter().map(|i| {
        let game_seed = seed.wrapping_add(i as u32);
        // Alternate the order to reduce thermal/timing bias.
        let (baseline, smart) = if i % 2 == 0 { (one_game(game_seed, false, profile, baseline_smart, futures, baseline_exe), one_game(game_seed, true, profile, baseline_smart, futures, baseline_exe)) } else {
            let smart = one_game(game_seed, true, profile, baseline_smart, futures, baseline_exe); (one_game(game_seed, false, profile, baseline_smart, futures, baseline_exe), smart)
        };
        let n = done.fetch_add(1, Ordering::Relaxed) + 1;
        if n % 4 == 0 { eprintln!("games {n}/{games}"); }
        json!({"seed":game_seed,"baseline":baseline.0,"smart":smart.0,"baselineSeconds":baseline.1,"smartSeconds":smart.1,"baselineDecisions":baseline.2,"smartDecisions":smart.2})
    }).collect();
    let n = rows.len() as f64;
    let mean = |key: &str| rows.iter().map(|r|r[key].as_f64().unwrap()).sum::<f64>()/n;
    let capped = |key: &str| rows.iter().map(|r|r[key].as_i64().unwrap().min(vorax::value::TARGET) as f64).sum::<f64>()/n;
    let reached = |key: &str| rows.iter().filter(|r|r[key].as_i64().unwrap()>=vorax::value::TARGET).count() as f64/n;
    println!("{}",serde_json::to_string_pretty(&json!({"kind":"games","profile":profile,"baselineSmart":baseline_smart,"baselineFutures":futures,"games":games,"seed":seed,"baselineMean":mean("baseline"),"smartMean":mean("smart"),"baselineCapped":capped("baseline"),"smartCapped":capped("smart"),"baselineReach":reached("baseline"),"smartReach":reached("smart"),"rows":rows})).unwrap());
}
pub fn run(args: &[String]) {
    let count = super::arg(args, "--count").unwrap_or(32usize).max(1);
    let seed = super::arg(args, "--seed").unwrap_or(8_100_000u32);
    if args.iter().any(|a|a=="--wide"){super::fail("Wide was not promoted; replay that experiment with its frozen executable.");}
    let profile = if args.iter().any(|a| a == "--deep") { smart::Profile::Deep } else { smart::Profile::Balanced };
    if args.iter().any(|a| a == "--games") { let baseline_exe=super::arg::<String>(args,"--baseline-exe");games_audit(count, seed, profile, args.iter().any(|a|a=="--baseline-smart"), super::arg(args,"--baseline-futures"),baseline_exe.as_deref()) } else {
        let baseline_exe=super::arg::<String>(args,"--baseline-exe");position_audit(count, super::arg(args, "--futures").unwrap_or(1024u32).max(1), seed, profile, args.iter().any(|a|a=="--baseline-smart"),baseline_exe.as_deref())
    }
}
