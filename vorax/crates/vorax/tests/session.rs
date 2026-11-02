use vorax::{
    advisor::{self, RunContext, ScreenPhase, ScreenState},
    bot,
    game::{create_game, dispatch},
    session,
    types::*,
};
fn setup(hand: Vec<u8>) -> GameState {
    create_game(
        vorax::data().default_settings,
        Some(&SandboxSetup {
            instruments: vec![Equipped {
                id: 7,
                acquired_round: 1,
            }],
            start_round: 5,
            forced_hand: hand,
            ..Default::default()
        }),
        Some(12345),
    )
}
fn screen(s: &GameState) -> ScreenState {
    let d = vorax::data();
    ScreenState {
        tanks: s
            .tanks
            .iter()
            .map(|m| {
                m.map(|m| advisor::ScreenMonster {
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
                _ => d.instrument(c.id).unwrap().name.clone(),
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
        context: None,
    }
}
#[test]
fn kit_context_survives_refresh_and_is_cleared_by_playing_a_potion() {
    for kit in [33, 34, 40] {
        let start = setup(vec![kit, 7, 25]);
        let mut old = screen(&start);
        session::enrich(&mut old, None, true);
        let opened = bot::play_opt(&start, &bot::Opt::card(0, &[]));
        let mut seen = screen(&opened);
        session::enrich(&mut seen, Some(&old), true);
        assert_eq!(seen.context.as_ref().unwrap().open_box, Some(kit));
        let rebuilt = advisor::to_state(&seen, &mut vec![]);
        assert_eq!(rebuilt.open_box, Some(kit));
        for seed in 1..=64 {
            let a = dispatch(
                &GameState {
                    rng_state: seed,
                    ..opened
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
            assert_eq!(a.hand, b.hand);
            assert_eq!(a.rng_state, b.rng_state);
        }
        let refreshed = dispatch(&opened, Action::Refresh);
        let mut again = screen(&refreshed);
        session::enrich(&mut again, Some(&seen), true);
        assert_eq!(again.context.as_ref().unwrap().open_box, Some(kit));
        let after = bot::play_opt(&opened, &bot::options(&opened)[0]);
        let mut next = screen(&after);
        session::enrich(&mut next, Some(&seen), true);
        assert_eq!(next.context.as_ref().unwrap().open_box, None);
    }
}
#[test]
fn rerolling_an_offer_is_not_opening_the_kit_that_was_in_it() {
    let before = setup(vec![34, 7, 25]);
    let old = screen(&before);
    let mut refreshed = screen(&dispatch(&before, Action::Refresh));
    session::enrich(&mut refreshed, Some(&old), true);
    assert_eq!(refreshed.context.unwrap().open_box, None);
    let opened = bot::play_opt(&before, &bot::Opt::card(0, &[]));
    let mut ambiguous = screen(&opened);
    session::enrich(&mut ambiguous, Some(&old), false);
    assert_eq!(
        ambiguous.context.unwrap().open_box,
        None,
        "Uncertain transitions must not invent small-kit context"
    );
}
#[test]
fn simultaneous_thresholds_preserve_both_instrument_picks() {
    let mut before = setup(vec![7]);
    before.phase = Phase::RoundEnd;
    before.t8000 = false;
    before.t28000 = false;
    before.tanks = [Some(Monster {
        archetype: Archetype::Pest,
        rarity: Rarity::Normal,
        activity: 100,
        quantity: 60,
    }); 6];
    let actual = dispatch(&before, Action::Confirm);
    assert_eq!(actual.pending_picks, 2);
    let mut seen = screen(&actual);
    session::enrich(&mut seen, None, true);
    let rebuilt = advisor::to_state(&seen, &mut vec![]);
    assert_eq!(rebuilt.pending_picks, 2);
    assert_eq!([rebuilt.t8000, rebuilt.t28000], [true, true]);
    let a = bot::play_opt(&actual, &bot::Opt::card(0, &[]));
    let b = bot::play_opt(&rebuilt, &bot::Opt::card(0, &[]));
    assert_eq!(a.phase, Phase::InstrumentSelect);
    assert_eq!(a.phase, b.phase);
    assert_eq!(a.pending_picks, b.pending_picks);
    let mut second = screen(&a);
    session::enrich(&mut second, Some(&seen), true);
    assert_eq!(second.context.as_ref().unwrap().pending_picks, 1);
}
#[test]
fn explicit_context_is_preserved_and_malformed_box_ids_are_rejected() {
    let s = setup(vec![7]);
    let mut x = screen(&s);
    x.context = Some(RunContext {
        open_box: Some(250),
        pending_picks: 999,
        thresholds: [true, false],
    });
    session::enrich(&mut x, None, true);
    let y = advisor::to_state(&x, &mut vec![]);
    assert_eq!(y.open_box, None);
    assert_eq!(y.pending_picks, 0);
}

#[test]
fn context_changes_invalidate_the_smart_cache() {
    let mut x = screen(&setup(vec![7, 25, 30]));
    x.tanks[0].as_mut().unwrap().quantity += 938;
    session::enrich(&mut x, None, true);
    assert!(!vorax::smart::advise(&x).diagnostics.cache_hit);
    assert!(vorax::smart::advise(&x).diagnostics.cache_hit);
    x.context.as_mut().unwrap().open_box = Some(34);
    assert!(!vorax::smart::advise(&x).diagnostics.cache_hit);
}
