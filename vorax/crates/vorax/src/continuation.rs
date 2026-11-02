//! Smart's continuation policy. Reference bot/value and all game rules remain
//! unchanged. With no potion decisions remaining, use actual remaining effects
//! rather than asking the learned board model to guess the final instrument ticks.
use crate::{
    advisor::Work,
    bot::{self, Opt, Pick, Tally},
    game::{can_refresh, dispatch, ultimate_activity},
    types::*,
    value::board_value,
};
use rayon::prelude::*;

/// Fixed for a process. The common host pins the validated policy; the offline
/// CLI can compare models without changing engine/model data or rollout seeds.
pub fn terminal_samples() -> u32 {
    static SAMPLES: std::sync::OnceLock<u32> = std::sync::OnceLock::new();
    *SAMPLES.get_or_init(|| {
        std::env::var("VORAX_TERMINAL_SAMPLES")
            .ok()
            .and_then(|v| v.parse().ok())
            .filter(|n| matches!(n, 0 | 2 | 8 | 16))
            .unwrap_or(0)
    })
}
pub fn terminal_ties() -> bool {
    static TIES: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *TIES.get_or_init(|| std::env::var("VORAX_TERMINAL_TIES").as_deref() == Ok("1"))
}

pub fn passive_value(s: &GameState, seed: u32) -> Option<f64> {
    if s.phase == Phase::GameOver {
        return Some(bot::goal_score(ultimate_activity(s)));
    }
    if s.round < crate::game::LAST_POTION_ROUND
        || s.phase == Phase::PotionSelect
        || s.phase == Phase::InstrumentSelect && s.round <= crate::game::LAST_POTION_ROUND
    {
        return None;
    }
    // Remaining instrument ticks only boost, awaken, mutate without changing
    // stats, or combine groups by adding their stats. On nonnegative boards
    // they cannot lower total activity. The capped objective is already exact.
    if ultimate_activity(s) >= crate::value::TARGET
        && s.monsters().all(|m| m.activity >= 0 && m.quantity >= 0)
    {
        return Some(crate::value::TARGET as f64);
    }
    // Instrument choices after the last potion retain the existing Value
    // picker. Every subsequent end-of-round effect uses the real engine.
    let end = bot::finish(
        s,
        seed,
        &bot::Chooser::Ev(bot::Policy::new(2, 0)),
        &bot::Picker::Value,
    );
    Some(bot::goal_score(ultimate_activity(&end)))
}
fn worth(s: &GameState, seed: u32) -> f64 {
    passive_value(s, seed).unwrap_or_else(|| board_value(s))
}
fn expected(s: &GameState, o: &Opt, samples: u32, seed: u32, depth: u32) -> f64 {
    let samples = if s.round >= crate::game::LAST_POTION_ROUND {
        samples.max(terminal_samples())
    } else {
        samples
    };
    let n = if depth == 0 {
        samples
    } else {
        2.max(samples >> 2)
    };
    let mut sum = 0.;
    for k in 0..n {
        let sk = bot::mix(seed, k + 1 + depth * 101);
        let after = bot::play_opt(
            &GameState {
                rng_state: sk,
                ..*s
            },
            o,
        );
        sum += if after.phase == Phase::PotionSelect && after.open_box.is_some() && depth < 2 {
            bot::options(&after)
                .iter()
                .map(|next| expected(&after, next, samples, sk, depth + 1))
                .fold(f64::NEG_INFINITY, f64::max)
        } else {
            worth(&after, sk)
        };
    }
    sum / n as f64
}
fn select(s: &GameState, samples: u32, seed: u32, ties: bool) -> bot::Choice {
    let mut best = None;
    let mut value = f64::NEG_INFINITY;
    let mut tied = bot::Opts::new();
    let policy = bot::Policy {
        samples,
        horizon: 0,
        roll_samples: None,
        steer: None,
        value: Some(true),
    };
    for o in &bot::options(s) {
        let v = if ties {
            bot::expected(s, o, &policy, seed, 0)
        } else {
            expected(s, o, samples, seed, 0)
        };
        if v > value {
            value = v;
            best = Some(*o);
            tied.clear();
            tied.push(*o)
        } else if v == value {
            tied.push(*o)
        }
    }
    let stay = board_value(s);
    if ties
        && s.round >= crate::game::LAST_POTION_ROUND
        && tied.len() > 1
        && !(s.open_box.is_none() && value <= stay && can_refresh(s))
    {
        let mut final_value = f64::NEG_INFINITY;
        for o in &tied {
            let v = expected(s, o, samples, seed, 0);
            if v > final_value {
                final_value = v;
                best = Some(*o)
            }
            if v >= crate::value::TARGET as f64 {
                break;
            }
        }
    }
    bot::Choice {
        best,
        value,
        stay: Some(stay),
    }
}
pub fn finish(s: &GameState, seed: u32, samples: u32) -> GameState {
    let mut s = *s;
    for g in 0..300u32 {
        if s.phase == Phase::GameOver {
            break;
        }
        if s.phase == Phase::RoundEnd {
            s = dispatch(&s, Action::Confirm);
            continue;
        }
        if s.phase == Phase::InstrumentSelect {
            s = match bot::value_pick(&s) {
                Pick::Refresh => dispatch(&s, Action::Refresh),
                Pick::Card(i) => bot::play_opt(&s, &Opt::card(i, &[])),
            };
            continue;
        }
        let choice = select(&s, samples, bot::mix(seed, g), terminal_ties());
        if s.open_box.is_none() && choice.value <= choice.stay.unwrap() && can_refresh(&s) {
            s = dispatch(&s, Action::Refresh)
        } else {
            if let Some(o) = choice.best {
                s = bot::play_opt(&s, &o)
            } else {
                break;
            }
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn terminal_tie_break_preserves_the_reference_primary_order() {
        let mut s = crate::game::create_game(crate::data().default_settings, None, Some(876));
        s.phase = Phase::PotionSelect;
        s.round = 10;
        s.potion_refreshes = 0;
        s.t8000 = true;
        s.t28000 = true;
        s.tanks = std::array::from_fn(|i| {
            Some(Monster {
                archetype: if i == 0 {
                    Archetype::BoneSentry
                } else {
                    Archetype::Agito
                },
                rarity: Rarity::Normal,
                activity: 500,
                quantity: if i == 0 { 280 } else { 284 },
            })
        });
        s.instruments = Equips::from_slice(&[
            Equipped {
                id: 7,
                acquired_round: 1,
            },
            Equipped {
                id: 8,
                acquired_round: 4,
            },
            Equipped {
                id: 23,
                acquired_round: 8,
            },
        ]);
        s.hand = Hand::from_slice(&[
            Card {
                kind: CardKind::Potion,
                id: 10,
            },
            Card {
                kind: CardKind::Potion,
                id: 7,
            },
            Card {
                kind: CardKind::Potion,
                id: 25,
            },
        ]);
        let p = bot::Policy {
            samples: 2,
            horizon: 0,
            roll_samples: None,
            steer: None,
            value: Some(true),
        };
        let mut ties_seen = 0;
        for seed in 1..=64 {
            let old = bot::choose(&s, &p, seed);
            let new = select(&s, 2, seed, true);
            assert_eq!(old.value, new.value);
            assert_eq!(old.stay, new.stay);
            let selected = new.best.unwrap();
            assert_eq!(
                bot::expected(&s, &selected, &p, seed, 0),
                old.value,
                "Tie breaking must not replace a higher primary estimate"
            );
            ties_seen += bot::options(&s)
                .iter()
                .filter(|o| bot::expected(&s, o, &p, seed, 0) == old.value)
                .count()
                .saturating_sub(1);
        }
        // Also exercise a saturated primary model: equal harmless adds are
        // common after a strong run and must retain the capped objective.
        s.tanks = [Some(Monster {
            archetype: Archetype::Agito,
            rarity: Rarity::Boss,
            activity: 2000,
            quantity: 2000,
        }); 6];
        s.hand = Hand::from_slice(&[
            Card {
                kind: CardKind::Potion,
                id: 7,
            },
            Card {
                kind: CardKind::Potion,
                id: 25,
            },
            Card {
                kind: CardKind::Potion,
                id: 30,
            },
        ]);
        let c = select(&s, 2, 876, true);
        assert!(c.best.is_some());
        ties_seen += bot::options(&s)
            .iter()
            .filter(|o| bot::expected(&s, o, &p, 876, 0) == c.value)
            .count()
            .saturating_sub(1);
        assert!(ties_seen > 0);
    }
}
pub fn play_work(work: &Work, from: u32, to: u32, parallel: bool) -> Vec<Tally> {
    let count = match work {
        Work::Potion { opts, .. } => opts.len(),
        Work::Instrument { choices, .. } => choices.len(),
    };
    let one = |i: usize| {
        let mut t = Tally::default();
        for k in from..to {
            let (s, seed, samples, action) = match work {
                Work::Potion {
                    s, seed, la, opts, ..
                } => (
                    s,
                    bot::mix(*seed, 9000 + k),
                    la.inner_samples.unwrap_or(2),
                    opts[i].0,
                ),
                Work::Instrument {
                    s, seed, choices, ..
                } => (
                    s,
                    bot::mix(*seed, 7000 + k),
                    4,
                    match choices[i] {
                        Pick::Refresh => Opt::Refresh,
                        Pick::Card(i) => Opt::card(i, &[]),
                    },
                ),
            };
            let after = bot::play_opt(
                &GameState {
                    rng_state: seed,
                    ..*s
                },
                &action,
            );
            let end = finish(&after, seed, samples);
            let activity = ultimate_activity(&end);
            t.goal += bot::goal_score(activity);
            t.reached += (activity >= crate::value::TARGET) as u32;
            t.n += 1;
        }
        t
    };
    if parallel {
        (0..count).into_par_iter().map(one).collect()
    } else {
        (0..count).map(one).collect()
    }
}
