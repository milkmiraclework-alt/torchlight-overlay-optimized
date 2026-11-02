use vorax::{
    bot, continuation,
    game::{create_game, dispatch, ultimate_activity},
    types::*,
};
fn board(tools: Vec<Equipped>) -> GameState {
    let mut s = create_game(
        vorax::data().default_settings,
        Some(&SandboxSetup {
            instruments: tools,
            start_round: 10,
            thresholds_used: (true, true),
            forced_hand: vec![7],
            ..Default::default()
        }),
        Some(4321),
    );
    s.phase = Phase::RoundEnd;
    s.tanks = [Some(Monster {
        archetype: Archetype::Pest,
        rarity: Rarity::Normal,
        activity: 100,
        quantity: 100,
    }); 6];
    s
}
#[test]
fn conditional_tool_and_its_remaining_ticks_are_evaluated_by_the_engine() {
    let mut a = board(vec![Equipped {
        id: 4,
        acquired_round: 1,
    }]);
    a.tanks[0].as_mut().unwrap().archetype = Archetype::Agito;
    a.tanks[0].as_mut().unwrap().rarity = Rarity::Rare;
    let mut b = a;
    b.tanks[0].as_mut().unwrap().rarity = Rarity::Normal;
    b.tanks[2].as_mut().unwrap().rarity = Rarity::Rare;
    assert_eq!(
        vorax::value::board_value(&a),
        vorax::value::board_value(&b),
        "This case must expose the learned model's missing joint prerequisite"
    );
    assert_eq!(continuation::passive_value(&a, 1), Some(92000.));
    assert_eq!(continuation::passive_value(&b, 1), Some(60000.));
}
#[test]
fn periodic_combo_uses_the_real_acquisition_round() {
    let a = board(vec![
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
    ]);
    let mut b = a;
    b.instruments.as_mut_slice()[1].acquired_round = 2;
    assert_eq!(vorax::value::board_value(&a), vorax::value::board_value(&b));
    let mut differences = 0;
    for seed in 1..=128 {
        let x = GameState {
            rng_state: seed,
            ..a
        };
        let y = GameState {
            rng_state: seed,
            ..b
        };
        let expected = |s: &GameState| {
            let mut next = *s;
            while next.phase != Phase::GameOver {
                next = dispatch(&next, Action::Confirm)
            }
            bot::goal_score(ultimate_activity(&next))
        };
        let vx = continuation::passive_value(&x, 999).unwrap();
        let vy = continuation::passive_value(&y, 999).unwrap();
        assert_eq!(vx, expected(&x));
        assert_eq!(vy, expected(&y));
        differences += (vx != vy) as usize;
    }
    assert!(differences > 0);
}
#[test]
fn terminal_projection_never_consumes_a_future_potion_or_changes_the_input() {
    let mut s = board(vec![Equipped {
        id: 7,
        acquired_round: 1,
    }]);
    s.phase = Phase::PotionSelect;
    let before = s;
    assert_eq!(continuation::passive_value(&s, 1), None);
    assert_eq!(s, before);
    let model = vorax::advisor::LOOK_AHEAD;
    let work = vorax::advisor::Work::Potion {
        s,
        seed: 456,
        la: model,
        opts: vec![(bot::options(&s)[0], 0.)],
        futures: 16,
    };
    let one = continuation::play_work(&work, 0, 16, false);
    let many = continuation::play_work(&work, 0, 16, true);
    assert_eq!(one, many);
    assert_eq!(s, before);
}
