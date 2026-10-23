use serde_json::Value;
use vorax::advisor::{self, Best, ScreenPhase, ScreenState};
use vorax::{bot, smart};

fn screens() -> Vec<ScreenState> {
    include_str!("../../../fixtures/advisor.jsonl").lines().map(|line| {
        let row: Value = serde_json::from_str(line).unwrap();
        serde_json::from_value(row["screen"].clone()).unwrap()
    }).collect()
}

#[test]
fn all_targets_screened_and_more_samples_without_changing_the_board() {
    for screen in screens() {
        let before = serde_json::to_vec(&screen).unwrap();
        let mut unknown = Vec::new();
        let state = advisor::to_state(&screen, &mut unknown);
        let result = smart::calculate(&screen, true);
        let reference = advisor::advise_plan(&screen, None, true);
        assert_eq!(before, serde_json::to_vec(&screen).unwrap());
        if result.diagnostics.candidates == 0 { continue }
        assert!(result.diagnostics.min_futures >= 128);
        assert!(result.diagnostics.max_futures <= 512);
        let same_action = match (&result.advice.best, &reference.best) {
            (Best::Card(a), Best::Card(b)) => a.index == b.index && a.targets == b.targets,
            (Best::Refresh, Best::Refresh) | (Best::Nothing, Best::Nothing) => true,
            _ => false,
        };
        if !same_action { assert!(result.diagnostics.switch_verified); }
        if result.diagnostics.reference_retained { assert!(same_action); }
        if result.diagnostics.switch_verified {
            assert!(result.diagnostics.verification_futures >= 64);
            assert!(result.diagnostics.verification_gain > 2.0 * result.diagnostics.verification_error + 1_000.0);
        }
        assert_eq!(result.diagnostics.min_futures % 8, 0);
        if screen.phase == ScreenPhase::Potion {
            assert_eq!(result.diagnostics.options_screened, bot::options(&state).len() + (state.potion_refreshes > 0) as usize);
        }
        if let Best::Card(best) = &result.advice.best {
            assert!(best.index < screen.hand.len());
            assert!(best.targets.iter().all(|&t| screen.tanks[t as usize].is_some()));
        }
        for row in &result.advice.ranking {
            let end = row.end.unwrap();
            assert!((0.0..=1.0).contains(&end.reached));
            assert!(end.activity >= 0.0 && end.activity <= vorax::value::TARGET as f64);
        }
    }
}

#[test]
fn parallelism_does_not_change_samples_or_choices() {
    for screen in screens() {
        let mut one = smart::calculate(&screen, false);
        let mut many = smart::calculate(&screen, true);
        one.advice.ms = 0;
        many.advice.ms = 0;
        assert_eq!(serde_json::to_value(one).unwrap(), serde_json::to_value(many).unwrap());
    }
}

#[test]
fn cache_is_exact_and_a_changed_board_is_recalculated() {
    let mut screen = screens().remove(0);
    // Unique fixture variant avoids sharing a cache entry with another test.
    screen.tanks[0].as_mut().unwrap().quantity += 173;
    let first = smart::advise(&screen);
    assert!(!first.diagnostics.cache_hit);
    let second = smart::advise(&screen);
    assert!(second.diagnostics.cache_hit);
    assert_eq!(second.advice.ms, 0);
    assert_eq!(serde_json::to_value(first.advice.best).unwrap(), serde_json::to_value(second.advice.best).unwrap());
    screen.tanks[0].as_mut().unwrap().quantity += 1;
    assert!(!smart::advise(&screen).diagnostics.cache_hit);
}

#[test]
fn unsupported_specials_and_protocols_keep_reference_behavior() {
    let mut screen = screens().remove(0);
    screen.hand = vec!["Xenopanacea: Osteotrophy".into()];
    assert_eq!(smart::calculate(&screen, true).diagnostics.total_futures, 0);
    screen.phase = ScreenPhase::Protocol;
    assert_eq!(smart::calculate(&screen, true).advice.best, Best::Nothing);
}

#[test]
fn deep_profile_has_a_distinct_budget_and_keeps_legal_actions() {
    for screen in screens().into_iter().take(2) {
        let result = smart::calculate_profile(&screen, true, smart::Profile::Deep);
        assert!(result.diagnostics.min_futures >= 128);
        assert!(result.diagnostics.max_futures <= 512);
        if let Best::Card(best) = result.advice.best {
            assert!(best.index < screen.hand.len());
            assert!(best.targets.iter().all(|&t| screen.tanks[t as usize].is_some()));
        }
    }
}
