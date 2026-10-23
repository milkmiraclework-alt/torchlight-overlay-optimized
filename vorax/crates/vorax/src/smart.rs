//! An additional advisor; the reference engine, RNG, model and advisor stay unchanged.
//! Screen every legal target by complete futures, retain the reference shortlist,
//! then use paired outcomes to spend more work on close decisions. Never sends input.
use crate::advisor::{self, Advice, Best, Prepared, ScreenState, Work};
use crate::bot::{options, Opt, Pick, Tally};
use rayon::prelude::*;
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

const PROBE: u32 = 16;
const BASE: u32 = 128;
const MAX: u32 = 512;
const BLOCK: u32 = 8;
const CANDIDATES: usize = 8;
const CACHE_SIZE: usize = 32;

#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Profile {
    #[default]
    Balanced,
    Deep,
}
impl Profile {
    fn max(self) -> u32 { match self { Profile::Balanced => 256, Profile::Deep => MAX } }
    fn inner(self) -> u32 { match self { Profile::Balanced => 2, Profile::Deep => 4 } }
    fn configured() -> Self {
        if std::env::var("VORAX_SMART_PROFILE").as_deref() == Ok("deep") { Self::Deep } else { Self::Balanced }
    }
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub profile: Profile,
    pub options_screened: usize,
    pub candidates: usize,
    pub min_futures: u32,
    pub max_futures: u32,
    pub total_futures: u32,
    pub refinements: usize,
    /// Heuristic paired-sample check, not a calibrated confidence guarantee.
    pub close_decision: bool,
    pub cache_hit: bool,
    pub verification_futures: u32,
    pub verification_gain: f64,
    pub verification_error: f64,
    pub switch_verified: bool,
    pub reference_retained: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct Result {
    pub advice: Advice,
    pub diagnostics: Diagnostics,
}

#[derive(Clone, Default)]
struct Samples {
    tally: Tally,
    blocks: Vec<f64>,
}
impl Samples {
    fn add(&mut self, tally: Tally) {
        self.tally.goal += tally.goal;
        self.tally.reached += tally.reached;
        self.tally.n += tally.n;
        self.blocks.push(tally.goal / tally.n as f64);
    }
    fn mean(&self) -> f64 { self.tally.goal / self.tally.n.max(1) as f64 }
}

fn batches(work: &Work, from: u32, to: u32, parallel: bool) -> Vec<Vec<Tally>> {
    let starts: Vec<u32> = (from..to).step_by(BLOCK as usize).collect();
    let run = |start: &u32| advisor::play_work(work, *start, (*start + BLOCK).min(to), false);
    // Parallelise blocks, not floating-point reductions: stable answers on any CPU.
    if parallel { starts.par_iter().map(run).collect() } else { starts.iter().map(run).collect() }
}
fn add_batches(samples: &mut [Samples], blocks: Vec<Vec<Tally>>) {
    for block in blocks {
        for (sample, tally) in samples.iter_mut().zip(block) { sample.add(tally); }
    }
}
fn subset(work: &Work, indices: &[usize]) -> Work {
    match work {
        Work::Potion { s, seed, la, opts, futures } => Work::Potion {
            s: *s, seed: *seed, la: *la,
            opts: indices.iter().map(|&i| opts[i]).collect(), futures: *futures,
        },
        Work::Instrument { s, seed, choices, futures } => Work::Instrument {
            s: *s, seed: *seed,
            choices: indices.iter().map(|&i| choices[i]).collect(), futures: *futures,
        },
    }
}

/// Standard error of the difference on shared random futures. Batches reduce
/// bookkeeping; this is a work-allocation heuristic, not a formal hypothesis test.
fn difference(a: &Samples, b: &Samples) -> (f64, f64) {
    let n = a.blocks.len().min(b.blocks.len());
    if n < 2 { return (a.mean() - b.mean(), f64::INFINITY) }
    let diffs: Vec<f64> = a.blocks.iter().zip(&b.blocks).map(|(a, b)| a - b).collect();
    let mean = diffs.iter().sum::<f64>() / n as f64;
    let variance = diffs.iter().map(|d| (d - mean).powi(2)).sum::<f64>() / (n - 1) as f64;
    (a.mean() - b.mean(), (variance / n as f64).sqrt())
}
fn close(a: &Samples, b: &Samples) -> bool {
    let (gap, se) = difference(a, b);
    if gap == 0.0 && se == 0.0 { return false }
    gap <= 2.5 * se + 2_000.0
}
fn order(samples: &[Samples]) -> Vec<usize> {
    let mut indices: Vec<usize> = (0..samples.len()).collect();
    indices.sort_by(|&a, &b| samples[b].mean().total_cmp(&samples[a].mean()).then(a.cmp(&b)));
    indices
}

fn chosen_arm(work: &Work, screen: &ScreenState, best: &Best) -> Option<usize> {
    let model_index = match best {
        Best::Card(r) => Some(screen.hand.iter().take(r.index).filter(|n| match work {
            Work::Potion { .. } => crate::data().potion_by_name(n).is_some(),
            Work::Instrument { .. } => crate::data().instrument_by_name(n).is_some(),
        }).count()),
        _ => None,
    };
    match work {
        Work::Potion { opts, .. } => opts.iter().position(|(o, _)| match (o, best) {
            (Opt::Refresh, Best::Refresh) => true,
            (Opt::Card { index, targets }, Best::Card(r)) => Some(*index as usize) == model_index && targets.as_slice() == r.targets.as_slice(),
            _ => false,
        }),
        Work::Instrument { choices, .. } => choices.iter().position(|p| match (p, best) {
            (Pick::Refresh, Best::Refresh) => true,
            (Pick::Card(i), Best::Card(_)) => Some(*i) == model_index,
            _ => false,
        }),
    }
}

fn verify_switch(work: &Work, incumbent: usize, challenger: usize, parallel: bool, diagnostics: &mut Diagnostics) -> bool {
    let mut check = subset(work, &[incumbent, challenger]);
    match &mut check {
        Work::Potion { seed, .. } | Work::Instrument { seed, .. } => *seed = crate::bot::mix(*seed, 0x4348_454b),
    }
    let mut validation = vec![Samples::default(); 2];
    let mut from = 0;
    // Independent of the samples that nominated the challenger. More samples
    // alone can turn a lucky estimate into a different but worse recommendation.
    for to in [64, 128, 256] {
        add_batches(&mut validation, batches(&check, from, to, parallel));
        diagnostics.total_futures += 2 * (to - from);
        diagnostics.verification_futures = to;
        let (gain, error) = difference(&validation[1], &validation[0]);
        diagnostics.verification_gain = gain;
        diagnostics.verification_error = error;
        if gain > 2.0 * error + 1_000.0 { return true }
        if gain + 2.0 * error < 0.0 || (to >= 128 && gain <= 0.0) { return false }
        from = to;
    }
    false
}

/// A fresh calculation, exposed separately so quality tests do not hit the UI cache.
pub fn calculate(screen: &ScreenState, parallel: bool) -> Result {
    calculate_profile(screen, parallel, Profile::Balanced)
}
pub fn calculate_profile(screen: &ScreenState, parallel: bool, profile: Profile) -> Result {
    let start = Instant::now();
    let (original, unknown) = match advisor::prepare(screen, None) {
        Prepared::Done(advice) => return Result { advice, diagnostics: Diagnostics { profile, ..Diagnostics::default() } },
        Prepared::Work { work, unknown, .. } => (work, unknown),
    };
    let mut diagnostics = Diagnostics { profile, ..Diagnostics::default() };
    let (work, mut samples) = match &original {
        Work::Potion { s, seed, la, opts: original_opts, .. } => {
            let mut opts: Vec<(Opt, f64)> = options(s).iter().map(|o| (*o, 0.0)).collect();
            if original_opts.iter().any(|o| o.0 == Opt::Refresh) { opts.push((Opt::Refresh, 0.0)); }
            if opts.is_empty() {
                return Result { advice: advisor::advise_plan(screen, None, parallel), diagnostics };
            }
            let all = Work::Potion {
                s: *s, seed: *seed,
                la: crate::bot::LookAhead { inner_samples: Some(profile.inner()), ..*la },
                opts, futures: profile.max(),
            };
            let count = match &all { Work::Potion { opts, .. } => opts.len(), _ => unreachable!() };
            diagnostics.options_screened = count;
            let mut probes = vec![Samples::default(); count];
            add_batches(&mut probes, batches(&all, 0, PROBE, parallel));
            diagnostics.total_futures += count as u32 * PROBE;
            let all_opts = match &all { Work::Potion { opts, .. } => opts, _ => unreachable!() };
            // Keep EVERY reference candidate, even if its short pilot was unlucky.
            let mut keep: Vec<usize> = original_opts.iter().filter_map(|o| all_opts.iter().position(|p| p.0 == o.0)).collect();
            let limit = CANDIDATES.max(keep.len());
            for i in order(&probes) {
                if keep.len() >= limit { break }
                if !keep.contains(&i) { keep.push(i); }
            }
            let work = subset(&all, &keep);
            let mut selected: Vec<Samples> = keep.iter().map(|&i| probes[i].clone()).collect();
            add_batches(&mut selected, batches(&work, PROBE, BASE, parallel));
            diagnostics.total_futures += selected.len() as u32 * (BASE - PROBE);
            (work, selected)
        }
        Work::Instrument { choices, .. } => {
            let mut samples = vec![Samples::default(); choices.len()];
            add_batches(&mut samples, batches(&original, 0, BASE, parallel));
            diagnostics.options_screened = choices.len();
            diagnostics.total_futures = choices.len() as u32 * BASE;
            (original.clone(), samples)
        }
    };
    diagnostics.candidates = samples.len();
    // Spend additional futures only where shared outcomes don't separate the arms.
    for target in [256, MAX].into_iter().filter(|&n| n <= profile.max()) {
        let sorted = order(&samples);
        let Some(&best) = sorted.first() else { break };
        let rivals: Vec<usize> = sorted.iter().copied().skip(1).filter(|&i| close(&samples[best], &samples[i])).collect();
        if rivals.is_empty() { break }
        let mut active = vec![best];
        active.extend(rivals);
        // Arms can re-enter after the leader changes. Continue each arm's own
        // RNG index; never discard/replay already completed samples.
        for from in [BASE, 256] {
            let indices: Vec<usize> = active.iter().copied().filter(|&i| samples[i].tally.n == from && from < target).collect();
            if indices.is_empty() { continue }
            let sub = subset(&work, &indices);
            let to = (from * 2).min(target);
            let collected = batches(&sub, from, to, parallel);
            for block in collected {
                for (&i, tally) in indices.iter().zip(block) { samples[i].add(tally); }
            }
            diagnostics.total_futures += indices.len() as u32 * (to - from);
        }
        diagnostics.refinements += 1;
    }
    let sorted = order(&samples);
    diagnostics.close_decision = sorted.len() > 1 && close(&samples[sorted[0]], &samples[sorted[1]]);
    diagnostics.min_futures = samples.iter().map(|s| s.tally.n).min().unwrap_or(0);
    diagnostics.max_futures = samples.iter().map(|s| s.tally.n).max().unwrap_or(0);
    let tallies: Vec<Tally> = samples.iter().map(|s| s.tally).collect();
    let mut advice = advisor::conclude(&work, screen, unknown.clone(), start, &tallies);
    // Recover the original decision from the already completed first 64 futures
    // whenever the continuation policy matches. Only Deep potions need another
    // reference calculation because their continuation policy is different.
    let count = match &original { Work::Potion { opts, .. } => opts.len(), Work::Instrument { choices, .. } => choices.len() };
    let original_tallies: Vec<Tally> = if matches!(profile, Profile::Deep) && matches!(&original, Work::Potion { .. }) {
        diagnostics.total_futures += count as u32 * 64;
        advisor::play_work(&original, 0, 64, parallel)
    } else {
        samples.iter().take(count).map(|s| Tally { goal: s.blocks.iter().take(8).sum::<f64>() * BLOCK as f64, reached: 0, n: 64 }).collect()
    };
    let reference = advisor::conclude(&original, screen, unknown, start, &original_tallies);
    if let (Some(incumbent), Some(challenger)) = (chosen_arm(&work, screen, &reference.best), chosen_arm(&work, screen, &advice.best)) {
        if incumbent != challenger {
            diagnostics.switch_verified = verify_switch(&work, incumbent, challenger, parallel, &mut diagnostics);
            if !diagnostics.switch_verified {
                diagnostics.reference_retained = true;
                diagnostics.close_decision = true;
                advice.best = match &reference.best {
                    Best::Card(r) => advice.ranking.iter().find(|p| p.index == r.index && p.targets == r.targets).cloned().map(Best::Card).unwrap_or_else(|| reference.best.clone()),
                    _ => reference.best.clone(),
                };
            }
        }
    }
    advice.ms = start.elapsed().as_millis() as u64;
    Result { advice, diagnostics }
}

static CACHE: OnceLock<Mutex<VecDeque<(Vec<u8>, Result)>>> = OnceLock::new();
pub fn advise(screen: &ScreenState) -> Result {
    let profile = Profile::configured();
    let mut key = serde_json::to_vec(screen).unwrap_or_default();
    key.push(match profile { Profile::Balanced => 0, Profile::Deep => 1 });
    let cache = CACHE.get_or_init(|| Mutex::new(VecDeque::new()));
    if let Ok(mut entries) = cache.lock() {
        if let Some(i) = entries.iter().position(|(k, _)| k == &key) {
            let entry = entries.remove(i).unwrap();
            let mut result = entry.1.clone();
            entries.push_front(entry);
            result.diagnostics.cache_hit = true;
            result.advice.ms = 0;
            return result;
        }
    }
    let result = calculate_profile(screen, true, profile);
    if let Ok(mut entries) = cache.lock() {
        entries.push_front((key, result.clone()));
        entries.truncate(CACHE_SIZE);
    }
    result
}

/// Preserve the original advisor for comparisons and an explicit fallback.
pub fn configured(screen: &ScreenState) -> Advice {
    configured_result(screen).advice
}
pub fn configured_result(screen: &ScreenState) -> Result {
    if std::env::var("VORAX_ADVISOR").as_deref() == Ok("reference") {
        Result { advice: advisor::advise_plan(screen, None, true), diagnostics: Diagnostics::default() }
    } else {
        advise(screen)
    }
}
