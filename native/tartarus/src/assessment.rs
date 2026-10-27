//! Giboork's 229-feature continuation estimate. Keep the displayed Rainbow
//! expectation separate from the score used to select a move.
use crate::{
    engine,
    model::*,
    policy::{self, Cache, Policy},
};
use serde::Deserialize;
use std::{collections::HashMap, sync::OnceLock};

#[derive(Deserialize)]
struct Data {
    weights: Vec<f64>,
    base: f64,
    combos: HashMap<String, f64>,
}
fn data() -> &'static Data {
    static DATA: OnceLock<Data> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(include_str!("../data/assessment.json")).unwrap())
}
fn lookup(ids: &[Id]) -> Option<f64> {
    let mut key: Vec<u8> = ids
        .iter()
        .filter(|id| (**id as usize) < 31)
        .map(|id| 97 + *id as u8)
        .collect();
    key.sort_unstable();
    data().combos.get(std::str::from_utf8(&key).ok()?).copied()
}
pub fn tool_value(tools: &[Id]) -> f64 {
    let tools: Vec<_> = tools
        .iter()
        .copied()
        .filter(|id| (*id as usize) < 31)
        .collect();
    if tools.is_empty() {
        return 0.;
    }
    if tools.len() < 3 {
        return lookup(&tools).unwrap_or(data().base) - data().base;
    }
    let mut best: f64 = 0.;
    for i in 0..tools.len() {
        for j in i + 1..tools.len() {
            best = best.max(lookup(&[tools[i], tools[j]]).unwrap_or(data().base) - data().base);
        }
    }
    best
}
pub fn tool_gains(s: &State, options: &[Id]) -> Option<Vec<f64>> {
    let held: Vec<_> = s
        .tools
        .iter()
        .copied()
        .filter(|id| (*id as usize) < 31)
        .collect();
    options
        .iter()
        .map(|&id| {
            if held.is_empty() {
                return Some(lookup(&[id])? - data().base);
            }
            let mut total = 0.;
            for &other in &held {
                total += lookup(&[other, id])? - lookup(&[other])?;
            }
            Some(total / held.len() as f64)
        })
        .collect()
}
pub fn policy(s: &State, overrides: Option<&serde_json::Value>) -> Policy {
    let mut p = policy::policy(s, overrides);
    p.assessment = true;
    p.prey_survival = false;
    p.terminal_gifts = false;
    p.gift_adaptive = false;
    p
}
pub fn decide(
    s: &State,
    p: &Policy,
    rng: &mut u32,
    cache: &mut Cache,
    adaptive: bool,
) -> Option<Action> {
    if adaptive {
        if let Some(c) = s.pending.first().filter(|c| c.kind == ChoiceKind::Gift) {
            let mut best = None;
            for &id in &c.options {
                let mut sum = 0.;
                for _ in 0..3 {
                    let mut trial = s.clone();
                    trial.rng = (random(rng) * 4294967296.) as u32;
                    if engine::apply(&mut trial, &Action::Choose { id }) {
                        sum += trial.vault.len() as f64 + remaining(&trial);
                    }
                }
                if best.is_none_or(|(_, v)| sum > v) {
                    best = Some((id, sum));
                }
            }
            return best.map(|(id, _)| Action::Choose { id });
        }
    }
    policy::decide(s, p, rng, cache)
}
pub fn playout(s: &mut State, p: &Policy, rng: &mut u32, cache: &mut Cache, until: i32) -> bool {
    for _ in 0..400 {
        if s.phase == Phase::Ended
            || (s.phase == Phase::Patrol && s.day > until && s.pending.is_empty())
        {
            return true;
        }
        let Some(a) = decide(s, p, rng, cache, true) else {
            return true;
        };
        if !engine::apply(s, &a) && !(a != Action::End && engine::apply(s, &Action::End)) {
            return false;
        }
    }
    // Like the reference, evaluate the current state if a rare event chain
    // reaches the bounded continuation budget.
    true
}
pub fn features(s: &State) -> [f64; 229] {
    let mut f = [0.; 113];
    f[0] = s.vault.len() as f64 / 10.;
    f[1] = (s.vault.len() >= 10) as u8 as f64;
    let mut max_tier = -1;
    for c in &s.cells {
        if !c.sealed {
            if let Some(i) = c.inmate {
                if i.tier < 5 {
                    f[2 + i.tier as usize] += 1.;
                    f[7 + i.tier as usize * 4 + i.beast.index()] += 1.;
                    max_tier = max_tier.max(i.tier);
                }
            }
        }
    }
    for tier in 0..5 {
        let counts = &f[7 + tier * 4..11 + tier * 4];
        let diversity = counts.iter().filter(|&&n| n > 0.).count() as f64;
        let pairs = (counts[0] * counts[1]
            + counts[1] * counts[2]
            + counts[2] * counts[3]
            + counts[0] * counts[3])
            .min(6.);
        f[27 + tier * 2] = diversity;
        f[28 + tier * 2] = pairs;
    }
    f[37] = max_tier as f64 * 0.25;
    f[38] = f[5] + f[6];
    let mut known_sum = 0.;
    for c in &s.cells {
        if c.n == 0 {
            continue;
        }
        if c.sealed {
            f[39] += 1.;
            let known = if c.known != 0 {
                c.hidden.or(c.inmate).map(|i| i.tier)
            } else {
                None
            };
            if let Some(tier) = known.or_else(|| (c.at_least != 0).then_some(c.at_least)) {
                known_sum += tier as f64;
                f[40] += 1.;
            }
        }
        if c.nest.is_some() {
            f[42] += 1.;
        }
        if c.ivory {
            f[43] += 1.;
        }
        if c.scratch {
            f[44] += 1.;
        }
        if let Some(e) = c.event {
            f[46 + e as usize] += 1.;
        }
    }
    if f[40] > 0. {
        f[41] = known_sum / f[40];
    }
    f[39] /= 15.;
    f[45] = s.prey.len() as f64;
    for d in 1..=6 {
        let c = &s.cells[(s.position + d) % 16];
        if c.sealed {
            f[60] += 1.;
        } else if c.inmate.is_some() {
            f[61] += 1.;
        }
    }
    let office = 16 - s.position;
    f[62] = if office > 6 { 1.5 } else { office as f64 / 6. };
    for (i, id) in Id::TOOLS.iter().enumerate() {
        f[63 + i] = s.has(*id) as u8 as f64;
    }
    f[94] = tool_value(&s.tools);
    f[95] = s.tools.len() as f64;
    if !s.milestone {
        f[96 + s.objective.id as usize] = 1.;
    }
    f[102] = s.milestone as u8 as f64;
    if !s.milestone && s.objective.id.need() > 0 {
        f[103] = (s.objective.progress as f64 / s.objective.id.need() as f64).min(1.);
    }
    f[104] = s.ratway as u8 as f64;
    for (i, e) in [
        EventKind::Usurp1,
        EventKind::Usurp2,
        EventKind::Usurp3,
        EventKind::Usurp4,
    ]
    .iter()
    .enumerate()
    {
        f[105 + i] = s.event_pool.contains(e) as u8 as f64;
    }
    if let Some(e) = s.start_event {
        f[109 + e as usize] = 1.;
    }
    let t = ((s.max_days - s.day + 1).max(0) as f64) / 20.;
    let mut out = [0.; 229];
    out[0] = 1.;
    out[1] = t;
    out[2] = t * t;
    for (i, x) in f.iter().enumerate() {
        out[3 + 2 * i] = *x;
        out[4 + 2 * i] = *x * t;
    }
    out
}
pub fn remaining(s: &State) -> f64 {
    if s.phase == Phase::Ended {
        return 0.;
    }
    let f = features(s);
    f.iter()
        .zip(&data().weights)
        .fold(0., |sum, (x, w)| sum + x * w)
        .max(0.)
}
pub fn rainbows(s: &State) -> f64 {
    (s.vault.len() as f64 + remaining(s)).min(10.)
}
pub fn reds(s: &State) -> usize {
    s.cells
        .iter()
        .filter(|c| !c.sealed && c.inmate.is_some_and(|i| i.tier == 4 && !i.marked))
        .count()
}
pub fn score(s: &State, initial_vault: usize) -> f64 {
    rainbows(s) + 0.3 * (s.vault.len() as f64 - initial_vault as f64) + 0.25 * reds(s) as f64
}
