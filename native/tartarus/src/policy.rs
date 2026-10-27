use crate::{engine as e, model::*};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};
use std::sync::OnceLock;
use Id::*;

// Bounded per worker; all entries are released with the calculation job.
const CHAIN_CACHE_LIMIT: usize = 65_536;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    #[serde(default)]
    pub assessment: bool,
    pub tier_base: f64,
    pub rainbow_mult: f64,
    pub w_open: f64,
    pub w_now: f64,
    pub w_walk: f64,
    pub w_step: f64,
    pub w_nest: f64,
    pub w_chain: f64,
    pub w_goal: f64,
    pub w_incident: f64,
    pub w_pass: f64,
    pub w_office_incident: f64,
    pub w_consume: f64,
    pub w_consume_walk: f64,
    pub w_usurp: f64,
    pub w_instigate: f64,
    pub w_crow: f64,
    pub w_short: f64,
    pub w_keys: f64,
    pub w_forged: f64,
    pub w_fire: f64,
    pub w_cage: f64,
    pub reroll_margin: f64,
    pub w_stair: f64,
    pub min_devour: f64,
    pub stop_margin: f64,
    pub swap_max_tier: i32,
    pub swap_margin: f64,
    pub maiden_swap_tier: i32,
    pub exec_margin: f64,
    pub accept_chain: bool,
    pub tool_rank: Vec<Id>,
    pub tool_sets: bool,
    pub office: Option<Office>,
    pub gift_rank: Option<Vec<Id>>,
    pub gift_chain: bool,
    #[serde(default)]
    pub prey_survival: bool,
    #[serde(default)]
    pub gift_adaptive: bool,
    #[serde(default)]
    pub terminal_gifts: bool,
    /// Differential quality audit only; normal jobs use corrected chain math.
    #[serde(default)]
    pub legacy_wolf_chains: bool,
}
#[derive(Deserialize)]
pub struct ComboData {
    pub ids: Vec<Id>,
    pub base: f64,
    pub v: HashMap<String, f64>,
}
#[derive(Deserialize)]
struct Data {
    defaults: serde_json::Value,
    profiles: HashMap<String, serde_json::Value>,
    combos: ComboData,
}
fn data() -> &'static Data {
    static DATA: OnceLock<Data> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(include_str!("../data/policy.json")).unwrap())
}
pub fn policy(s: &State, overrides: Option<&serde_json::Value>) -> Policy {
    let d = data();
    let mut value = d.defaults.clone();
    let extra = overrides.filter(|v| !v.is_null()).unwrap_or(
        &d.profiles[if s.params.rewards {
            "rewards"
        } else {
            "notools"
        }],
    );
    if let Some(fields) = extra.as_object() {
        for (k, v) in fields {
            value[k] = v.clone()
        }
    }
    serde_json::from_value(value).unwrap()
}
pub fn normalize(w: &[f64]) -> Vec<f64> {
    let sum = w.iter().fold(0., |a, x| a + x.max(0.));
    let sum = if sum == 0. { 1. } else { sum };
    w.iter().map(|x| x.max(0.) / sum).collect()
}
#[derive(Clone, Copy, Hash, PartialEq, Eq)]
struct ChainKey {
    mask: u16,
    tier: u8,
    beast: u8,
    crowd: u8,
    threshold: i32,
    comp: [u8; 20],
    rainbow: u64,
}
#[derive(Default)]
struct ChainHasher(u64);
impl Hasher for ChainHasher {
    fn finish(&self) -> u64 {
        self.0 ^ (self.0 >> 29)
    }
    fn write(&mut self, bytes: &[u8]) {
        // Keys contain only bounded board counts and rule bits. The map
        // still checks full key equality, so collisions cannot change math.
        for chunk in bytes.chunks(8) {
            let mut word = [0u8; 8];
            word[..chunk.len()].copy_from_slice(chunk);
            self.0 = (self.0 ^ u64::from_le_bytes(word).wrapping_add(0x9e3779b97f4a7c15))
                .rotate_left(27)
                .wrapping_mul(0x3c79ac492ba7b653);
        }
    }
}
#[derive(Default)]
pub struct Cache {
    chains: HashMap<ChainKey, f64, BuildHasherDefault<ChainHasher>>,
    tables: Option<ContextTables>,
    pub hits: u64,
    pub misses: u64,
    pub clears: u64,
}
#[derive(Clone, Copy)]
struct ContextTables {
    base: u64,
    weights: [u64; 5],
    v: [f64; 6],
    open_dist: [[f64; 5]; 2],
    open_value: [f64; 2],
}
impl Cache {
    fn tables(&mut self, st: &State, p: &Policy) -> ContextTables {
        let base = p.tier_base.to_bits();
        let weights = std::array::from_fn(|i| st.params.tier_weights[i].to_bits());
        if let Some(t) = self
            .tables
            .filter(|t| t.base == base && t.weights == weights)
        {
            return t;
        }
        let v = std::array::from_fn(|t| p.tier_base.powi(t as i32));
        let open_dist = std::array::from_fn(|hook| {
            let mut w: [f64; 5] = std::array::from_fn(|i| st.params.tier_weights[i]);
            if hook == 1 && w.iter().skip(1).any(|&x| x > 0.) {
                w[0] = 0.;
            }
            let sum = w.iter().fold(0., |a, x| a + x.max(0.));
            let sum = if sum == 0. { 1. } else { sum };
            w.map(|x| x.max(0.) / sum)
        });
        let open_value =
            open_dist.map(|dist| dist.iter().enumerate().fold(0., |a, (t, &x)| a + x * v[t]));
        let tables = ContextTables {
            base,
            weights,
            v,
            open_dist,
            open_value,
        };
        self.tables = Some(tables);
        tables
    }
}
pub struct Context<'a> {
    tool_mask: u64,
    chain_mask: u16,
    swap_values: [std::cell::Cell<Option<f64>>; 6],
    pub st: &'a State,
    pub p: &'a Policy,
    pub v: [f64; 6],
    pub r: f64,
    pub open_dist: [f64; 5],
    pub open_value: f64,
    pub sealed: usize,
    pub crowd: usize,
    pub lift: f64,
    pub lift2: f64,
    pub all_lift2: f64,
    pub swap_cap: i32,
    pub scapegoat: Option<f64>,
    pub maiden: Option<[i32; 5]>,
    pub goal: i32,
    pub incidents: i32,
    pub consumes: i32,
    pub fight: bool,
    pub double_from: i32,
    pub cache: &'a mut Cache,
}
pub fn composition(s: &State, exclude: Option<usize>) -> ([i32; 24], usize) {
    let mut comp = [0; 24];
    let mut crowd = 0;
    for c in &s.cells {
        if c.sealed {
            continue;
        }
        let Some(i) = c.inmate else { continue };
        crowd += 1;
        if Some(c.n) == exclude || i.tier >= 5 {
            continue;
        }
        comp[i.tier as usize * 4 + i.beast.index()] += 1
    }
    (comp, crowd)
}
impl<'a> Context<'a> {
    pub fn new(st: &'a State, p: &'a Policy, cache: &'a mut Cache) -> Self {
        let tool_mask = st
            .tools
            .iter()
            .fold(0u64, |mask, id| mask | (1u64 << *id as usize));
        let tables = cache.tables(st, p);
        let v = tables.v;
        let r = if st.vault.len() >= 10 {
            v[4]
        } else {
            v[5] * p.rainbow_mult
        };
        let hook = usize::from(st.has(Hook));
        let open_dist = tables.open_dist[hook];
        let open_value = tables.open_value[hook];
        // Keep cell order and floating-point operation order unchanged while
        // counting the board directly, without allocating temporary lists.
        let (mut count, mut sealed, mut others) = (0, 0, 0);
        let (mut lift, mut all_lift2, mut other_value) = (0., 0., 0.);
        let mut counts = [0; 5];
        for c in &st.cells {
            if c.sealed {
                sealed += 1;
                continue;
            }
            let Some(i) = c.inmate.filter(|i| i.tier < 5) else {
                continue;
            };
            let t = i.tier as usize;
            count += 1;
            counts[t] += 1;
            lift = lift + (if t + 1 >= 5 { r } else { v[t + 1] }) - v[t];
            all_lift2 = all_lift2 + (if t + 2 >= 5 { r } else { v[t + 2] }) - v[t];
            if c.n != st.position {
                others += 1;
                other_value += v[t];
            }
        }
        let lift = lift / count.max(1) as f64;
        let scapegoat = if st.has(Scapegoat) && others >= 2 && others < count {
            Some(2. * other_value / others as f64)
        } else {
            None
        };
        let swap_cap = if p.swap_max_tier < 0 {
            -1
        } else if st.has(Scapegoat) && count >= 3 {
            4
        } else {
            (if st.has(Maiden) {
                p.swap_max_tier.max(p.maiden_swap_tier)
            } else {
                p.swap_max_tier
            })
            .max(if st.has(Stake) { 2 } else { 0 })
        };
        let left = if !st.milestone && st.params.rewards {
            st.objective.id.need() - st.objective.progress
        } else {
            0
        };
        let mut chain_mask = 0u16;
        for (i, id) in [Saw, Whip, Muzzle, Skewer, Crown, Maul, Collar, Revenge]
            .into_iter()
            .enumerate()
        {
            if st.has(id) && (id != Revenge || sealed > 0) {
                chain_mask |= 1 << i;
            }
        }
        chain_mask |= (st.fight() as u16) << 8;
        chain_mask |= (st.params.chain_stop as u16) << 9;
        chain_mask |= ((st.has(Guillotine) && !p.legacy_wolf_chains) as u16) << 10;
        Self {
            tool_mask,
            chain_mask,
            swap_values: std::array::from_fn(|_| std::cell::Cell::new(None)),
            st,
            p,
            v,
            r,
            open_dist,
            open_value,
            sealed,
            crowd: count,
            lift: if count > 0 { lift } else { 0. },
            lift2: if count > 0 {
                all_lift2 / count as f64
            } else {
                0.
            },
            all_lift2,
            swap_cap,
            scapegoat,
            maiden: st.has(Maiden).then_some(counts),
            goal: if st.objective.id == ObjectiveId::Walk {
                left
            } else {
                0
            },
            incidents: if st.objective.id == ObjectiveId::Incident {
                left
            } else {
                0
            },
            consumes: if st.objective.id == ObjectiveId::Consume {
                left
            } else {
                0
            },
            fight: st.fight(),
            double_from: if st.fight() {
                0
            } else {
                st.params.double_eat_tier
            },
            cache,
        }
    }
    #[inline]
    fn has(&self, id: Id) -> bool {
        self.tool_mask & (1u64 << id as usize) != 0
    }
    fn lower_wolf(&self) -> bool {
        self.has(Guillotine) && !self.p.legacy_wolf_chains
    }
    fn foods(&self, t: i32, b: usize, counters: bool) -> ([usize; 4], usize) {
        if !counters && b == 1 && self.has(Crown) {
            return ([0, 1, 2, 3], 4);
        }
        let mut out = [0; 4];
        out[0] = (b + 1) % 4;
        let mut n = 1;
        if b == 3 && self.has(Skewer) {
            out[n] = 3;
            n += 1
        }
        if t >= self.double_from && (b == 0 || b == 1) {
            let second = b + 2;
            if !out[..n].contains(&second) {
                out[n] = second;
                n += 1
            }
        }
        (out, n)
    }
    fn top(&self, t: i32, b: usize) -> i32 {
        if self.has(Maul) && b == 0 {
            4
        } else {
            t
        }
    }
    fn rise(&mut self, t: i32, comp: &mut [i32; 24], crowd: usize, keep: Option<usize>) -> f64 {
        if t >= 5 {
            return self.r;
        }
        // Average rises and individual chains use separate key namespaces.
        // Both depend on the same composition, rules and Rainbow value.
        let key = self.chain_key(t, keep.unwrap_or(4), comp, crowd, true);
        if let Some(&value) = self.cache.chains.get(&key) {
            self.cache.hits += 1;
            return value;
        }
        self.cache.misses += 1;
        let mut sum = 0.;
        let count = if keep.is_some() { 1 } else { 4 };
        for index in 0..count {
            let b = keep.unwrap_or(index);
            if self.has(Revenge) && self.sealed > 0 {
                let (foods, n) = self.foods(t, b, false);
                let mut spawned = 0.;
                for &f in &foods[..n] {
                    let at = t as usize * 4 + f;
                    comp[at] += 1;
                    spawned += self.v[t as usize] + self.feed(t, b, comp, crowd + 1);
                    comp[at] -= 1;
                }
                sum += 0.3 * spawned / n as f64 + 0.7 * self.feed(t, b, comp, crowd)
            } else {
                sum += self.feed(t, b, comp, crowd)
            }
        }
        let value = sum / count as f64;
        if self.cache.chains.len() >= CHAIN_CACHE_LIMIT {
            self.cache.chains.clear();
            self.cache.clears += 1;
        }
        self.cache.chains.insert(key, value);
        value
    }
    fn chain_key(&self, t: i32, b: usize, comp: &[i32; 24], crowd: usize, rise: bool) -> ChainKey {
        let mut packed = [0; 20];
        for i in if self.fight || self.lower_wolf() {
            0
        } else {
            t as usize * 4
        }..20
        {
            packed[i] = comp[i] as u8
        }
        ChainKey {
            mask: self.chain_mask | ((rise as u16) << 11),
            tier: t as u8,
            beast: b as u8,
            crowd: if self.has(Muzzle) { crowd as u8 } else { 0 },
            threshold: self.double_from,
            comp: packed,
            rainbow: self.r.to_bits(),
        }
    }
    fn feed(&mut self, t: i32, b: usize, comp: &mut [i32; 24], crowd: usize) -> f64 {
        if !self.fight && !(self.has(Maul) && b == 0) && !(self.lower_wolf() && b == 2) {
            let (fs, n) = self.foods(t, b, false);
            if !fs[..n].iter().any(|&f| comp[t as usize * 4 + f] > 0) {
                return self.v[t as usize];
            }
        }
        let key = self.chain_key(t, b, comp, crowd, false);
        if let Some(&hit) = self.cache.chains.get(&key) {
            self.cache.hits += 1;
            return hit;
        }
        self.cache.misses += 1;
        let mut out = f64::NEG_INFINITY;
        for mt in if self.fight || (self.lower_wolf() && b == 2) {
            0
        } else {
            t
        }..=self.top(t, b)
        {
            let (fs, n) = self.foods(t, b, mt != t);
            for &f in &fs[..n] {
                let at = mt as usize * 4 + f;
                if comp[at] == 0 {
                    continue;
                }
                comp[at] -= 1;
                out = out.max(self.bite(t, b, comp, crowd, 0, true, mt));
                comp[at] += 1
            }
        }
        if out == f64::NEG_INFINITY
            || (self.st.params.chain_stop && out - self.v[t as usize] < self.p.stop_margin)
        {
            out = self.v[t as usize]
        }
        if self.cache.chains.len() >= CHAIN_CACHE_LIMIT {
            self.cache.chains.clear();
            self.cache.clears += 1
        }
        self.cache.chains.insert(key, out);
        out
    }
    fn sawed(&mut self, t: i32, b: usize, comp: &mut [i32; 24], crowd: usize, gain: i32) -> f64 {
        let s = if self.has(Saw) { 0.25 } else { 0. };
        let w = if self.has(Whip) { 0.35 } else { 0. };
        let keep = if self.fight { Some(b) } else { None };
        let a = self.rise((t + gain).min(5), comp, crowd.saturating_sub(1), keep);
        if s == 0. && w == 0. {
            return a;
        }
        // Evaluate even zero-weight branches, as the reference formula does.
        let b1 = self.rise((t + gain + 1).min(5), comp, crowd.saturating_sub(1), keep);
        let b2 = self.rise((t + gain + 2).min(5), comp, crowd.saturating_sub(1), keep);
        (1. - s) * (1. - w) * a + (s + w - 2. * s * w) * b1 + s * w * b2
    }
    fn bite(
        &mut self,
        t: i32,
        b: usize,
        comp: &mut [i32; 24],
        crowd: usize,
        extra: i32,
        chained: bool,
        mt: i32,
    ) -> f64 {
        let mut gain = if self.has(Maul) && b == 0 {
            (mt + 2 - t).max(1)
        } else {
            1
        } + extra;
        if self.has(Muzzle) && crowd <= 4 {
            gain += 2
        }
        if self.has(Skewer) && b == 3 {
            gain += 1
        }
        if self.has(Crown) && b == 1 {
            gain += 2
        }
        let v = if chained && self.has(Collar) {
            0.2 * self.sawed(t, b, comp, crowd, gain)
                + 0.8 * self.sawed(t, b, comp, crowd, gain + 1)
        } else {
            self.sawed(t, b, comp, crowd, gain)
        };
        -self.v[mt as usize] + v
    }
    fn devour_delta(
        &mut self,
        t: i32,
        b: usize,
        meal: usize,
        scratch: bool,
        comp: &mut [i32; 24],
        crowd: usize,
        chained: bool,
        mt: i32,
    ) -> f64 {
        let at = mt as usize * 4 + meal;
        if !scratch {
            comp[at] -= 1
        }
        let value = self.bite(
            t,
            b,
            comp,
            if scratch { crowd + 1 } else { crowd },
            if scratch {
                1 + self.st.params.scratch_stacks_base as i32
            } else {
                0
            },
            chained,
            mt,
        ) - self.v[t as usize];
        if !scratch {
            comp[at] += 1
        }
        value
    }
    fn best_meal(&mut self, t: i32, b: usize, comp: &mut [i32; 24], crowd: usize) -> f64 {
        let mut best = f64::NEG_INFINITY;
        for mt in if self.fight || (self.lower_wolf() && b == 2) {
            0
        } else {
            t
        }..=self.top(t, b)
        {
            let (fs, n) = self.foods(t, b, mt != t);
            for &f in &fs[..n] {
                if comp[mt as usize * 4 + f] == 0 {
                    continue;
                }
                let v = self.devour_delta(t, b, f, false, comp, crowd, false, mt);
                if v > best {
                    best = v
                }
            }
        }
        best
    }
    fn swap_dist(&self, old: i32) -> Vec<f64> {
        let mut w = self.st.params.swap_weights.clone();
        if self.has(Rope) {
            w[0] = 0.;
            w[1] = 0.
        }
        let mut dist = if self.scapegoat.is_some() {
            let higher: Vec<_> = w
                .iter()
                .enumerate()
                .map(|(t, &x)| if t as i32 > old { x } else { 0. })
                .collect();
            if higher.iter().any(|&x| x > 0.) {
                normalize(&higher)
            } else {
                (0..6)
                    .map(|t| if t == (old + 1).min(5) { 1. } else { 0. })
                    .collect()
            }
        } else {
            normalize(&w)
        };
        if self.has(Stake) && old < 3 {
            for p in &mut dist {
                *p *= 0.6
            }
            dist[3] += 0.4
        }
        dist
    }
    fn maiden_bonus(&self, tier: i32) -> f64 {
        let Some(mut counts) = self.maiden else {
            return 0.;
        };
        if counts[tier as usize] > 0 {
            counts[tier as usize] -= 1
        }
        let above: i32 = counts
            .iter()
            .enumerate()
            .filter(|&(t, _)| t as i32 > tier)
            .map(|(_, n)| n)
            .sum();
        let below: i32 = counts
            .iter()
            .enumerate()
            .filter(|&(t, _)| (t as i32) < tier)
            .map(|(_, n)| n)
            .sum();
        if above != below {
            return 0.;
        }
        self.swap_dist(tier)
            .iter()
            .enumerate()
            .fold(0., |a, (t, &p)| {
                a + p
                    * ((if t + 3 >= 5 { self.r } else { self.v[t + 3] })
                        - (if t >= 5 { self.r } else { self.v[t] }))
            })
    }
    fn swap_value(&self, tier: i32) -> f64 {
        if let Some(value) = self.swap_values[tier as usize].get() {
            return value;
        }
        let dist = self.swap_dist(tier);
        let mut v = dist.iter().enumerate().fold(0., |a, (t, &p)| {
            a + p * if t >= 5 { self.r } else { self.v[t] }
        }) - self.v[tier as usize];
        if self.has(Axe) {
            v += dist
                .iter()
                .enumerate()
                .fold(0., |a, (t, &p)| a + if t as i32 > tier { p } else { 0. })
                * self.sealed.min(2) as f64
                * self.p.w_open
                * self.open_value
        }
        v -= self.scapegoat.unwrap_or(0.);
        let value = v + self.maiden_bonus(tier);
        self.swap_values[tier as usize].set(Some(value));
        value
    }
    fn stair_delta(&self, comp: &[i32; 24], t: i32, b: usize, sign: i32) -> f64 {
        if self.p.w_stair == 0. || t >= 5 {
            return 0.;
        }
        let offset = t as usize * 4;
        let count = comp[offset + b];
        if (count > 0) == (count + sign > 0) {
            return 0.;
        }
        let mut changed = 0;
        for who in 0..4 {
            let (fs, n) = self.foods(t, who, false);
            let mut eats = false;
            let mut other = false;
            for &f in &fs[..n] {
                if f == b {
                    eats = true
                } else if comp[offset + f] > 0 {
                    other = true
                }
            }
            if eats && !other {
                changed += sign
            }
        }
        self.p.w_stair * (changed as f64 / 4.) * self.v[t as usize]
    }
    fn stair_fresh(&self, dist: &[f64], comp: &[i32; 24]) -> f64 {
        if self.p.w_stair == 0. {
            return 0.;
        }
        let mut sum = 0.;
        for (t, &p) in dist.iter().enumerate() {
            for b in 0..4 {
                if p != 0. {
                    sum += (p / 4.) * self.stair_delta(comp, t as i32, b, 1)
                }
            }
        }
        sum
    }
    fn activation(
        &mut self,
        t: i32,
        b: usize,
        comp: &mut [i32; 24],
        crowd: usize,
        swap_left: bool,
    ) -> f64 {
        let mut v = 0.0f64;
        if t < 5 {
            v = v.max(self.best_meal(t, b, comp, crowd))
        }
        if swap_left && t <= self.swap_cap {
            v = v.max(self.swap_value(t))
        }
        v
    }
    fn fresh_activation(
        &mut self,
        dist: &[f64],
        comp: &mut [i32; 24],
        crowd: usize,
        swap_left: bool,
    ) -> f64 {
        let mut sum = 0.;
        for (t, &p) in dist.iter().enumerate() {
            if p == 0. {
                continue;
            }
            for b in 0..4 {
                sum += (p / 4.) * self.activation(t as i32, b, comp, crowd, swap_left)
            }
        }
        sum
    }
    fn tagged(&self, dist: &[f64]) -> Vec<f64> {
        if !self.has(Dogtag) {
            return dist.to_vec();
        }
        let mut out: Vec<_> = dist.iter().map(|p| 0.75 * p).collect();
        for (t, &p) in dist.iter().enumerate() {
            let at = (t + 1).min(out.len() - 1);
            out[at] += 0.25 * p
        }
        out
    }
    fn fresh_value(
        &mut self,
        dist: &[f64],
        comp: &mut [i32; 24],
        crowd: usize,
        swap_left: bool,
    ) -> f64 {
        let worth = dist
            .iter()
            .enumerate()
            .fold(0., |a, (t, &p)| a + p * self.v[t]);
        self.p.w_open * worth
            + self.p.w_now * self.fresh_activation(dist, comp, crowd, swap_left)
            + self.stair_fresh(dist, comp)
    }
    fn execution(&self, t: i32, b: usize, comp: &[i32; 24]) -> f64 {
        let mut count = 0;
        let mut lost = 0.;
        for mt in 0..=if self.st.params.execution_same_tier {
            t
        } else {
            t - 1
        } {
            if self.st.params.execution_same_tier && mt != t {
                continue;
            }
            let f = (b + 1) % 4;
            count += comp[mt as usize * 4 + f];
            lost += comp[mt as usize * 4 + f] as f64 * self.v[mt as usize]
        }
        if count == 0 {
            return 0.;
        }
        let to = (t + count).min(5);
        (if to >= 5 { self.r } else { self.v[to as usize] }) - self.v[t as usize] - lost
    }
    fn trickster(&self, dist: &[f64]) -> f64 {
        dist.iter().enumerate().fold(0., |a, (t, &p)| {
            a + p * (self.v[4] - self.v[t.min(4)]).max(0.)
        })
    }
    fn appetite(&self, low: usize, dist: &[f64]) -> f64 {
        let val = |t: usize| if t >= 5 { self.r } else { self.v[t] };
        let mut sum = 0.;
        for (t, &p) in dist.iter().enumerate() {
            if p == 0. {
                continue;
            }
            let from = t.min(low);
            let mut choose = 1.;
            for k in 0..=5 {
                if k > 0 {
                    choose = choose * (5 - k + 1) as f64 / k as f64
                }
                sum += p
                    * choose
                    * 0.5f64.powi(k as i32)
                    * 0.5f64.powi((5 - k) as i32)
                    * (val((from + k).min(5)) - val(from))
            }
        }
        sum
    }
    fn event_worth(&self, id: EventKind, comp: &[i32; 24]) -> f64 {
        use EventKind::*;
        let p = self.p;
        match id {
            Execution => {
                let mut v = 0.;
                for (t, &mass) in self.open_dist.iter().enumerate() {
                    for b in 0..4 {
                        v += (mass / 4.)
                            * (self.execution(t as i32, b, comp) - p.exec_margin).max(0.)
                    }
                }
                v
            }
            Chain => p.w_chain,
            Trickster => self.trickster(&self.open_dist),
            Appetite => {
                let low = (0..20)
                    .find(|&i| comp[i] > 0)
                    .map(|i| i / 4)
                    .unwrap_or(usize::MAX);
                self.appetite(low, &self.open_dist)
            }
            Convict => p.w_open * self.v[3],
            Crow => p.w_crow,
            Freedom => 3. * p.w_open * self.open_value,
            Usurp1 => self.lift + 2. * self.lift * p.w_usurp,
            Usurp2 => 2. * self.lift + 2. * self.lift2 * p.w_usurp,
            Usurp3 => 2. * self.lift2 + self.all_lift2 * p.w_usurp,
            Usurp4 => self.all_lift2,
            Portion => self.crowd.min(3) as f64 * self.lift,
            Ratway => p.w_open * self.open_value,
            Hunt => p.w_crow * (self.sealed as f64 / 4.).max(1.),
        }
    }
    fn office_values(&self, comp: &[i32; 24]) -> (f64, f64, f64) {
        let mut bestow = 0.;
        let mut count = 0;
        for c in &self.st.cells {
            if c.sealed {
                continue;
            }
            let Some(i) = c.inmate.filter(|i| i.tier < 5) else {
                continue;
            };
            let t = i.tier as usize;
            bestow += (if t + 1 >= 5 { self.r } else { self.v[t + 1] }) - self.v[t];
            count += 1
        }
        bestow /= count.max(1) as f64;
        let free = e::instigate_cells(self.st).len();
        let each = self
            .st
            .event_pool
            .iter()
            .fold(0., |a, &id| a + self.event_worth(id, comp))
            / self.st.event_pool.len() as f64;
        let extra = if self.st.start_event == Some(StartEvent::Tyranny) {
            3
        } else {
            0
        };
        let first = e::instigate_count(self.st);
        let tyranny = if extra > 0 {
            extra as f64 * bestow + (first + extra - 1).min(free) as f64 * each * self.p.w_instigate
        } else {
            0.
        };
        let made = (if extra > 0 { 1 } else { first }).min(free);
        let goal = if self.incidents != 0 {
            self.p.w_office_incident * (made as i32).min(self.incidents) as f64
                / self.incidents as f64
        } else {
            0.
        };
        (
            bestow,
            made as f64 * each * self.p.w_instigate + goal,
            tyranny,
        )
    }
    fn link_value(&self, link: &Prey) -> f64 {
        let rounds = link.rounds.min(self.st.max_days - self.st.day).max(0);
        if rounds == 0 {
            return 0.;
        }
        let mut value = 0.;
        for id in [link.lion, link.prey] {
            if let Some(n) = self.st.cell_of(id) {
                let t = self.st.cells[n].inmate.unwrap().tier;
                let to = (t + rounds).min(5);
                value += (if to >= 5 { self.r } else { self.v[to as usize] }) - self.v[t as usize]
            }
        }
        value
    }
    fn link_loss(&self, i: Inmate, certain: bool, option: Option<Meal>) -> f64 {
        let Some(link) = self.st.link_of(i.id) else {
            return 0.;
        };
        if !self.p.prey_survival {
            return self.link_value(link)
                * if certain || link.prey == i.id {
                    1.
                } else {
                    0.75
                };
        }
        let Some(option) = option.filter(|_| !certain) else {
            return self.link_value(link);
        };
        let meal = if option.scratch {
            self.st.cells[option.cell].hidden
        } else {
            self.st.cells[option.cell].inmate
        }
        .unwrap();
        let mut gain = if option.scratch {
            2 + self.st.params.scratch_stacks_base as i32
        } else if i.beast == Beast::Mammoth && self.has(Maul) {
            (meal.tier + 2 - i.tier).max(1)
        } else {
            1
        };
        if self.has(Muzzle) && self.st.board_iter().count() <= 4 {
            gain += 2;
        }
        if self.has(Skewer) && i.beast == Beast::Rat {
            gain += 1;
        }
        if self.has(Crown) && i.beast == Beast::Lion {
            gain += 2;
        }
        let kept = if link.lion == i.id {
            Beast::Lion
        } else {
            link.prey_beast
        };
        let weights = &self.st.params.beast_weights;
        let sum = weights.iter().fold(0., |s, w| s + w.max(0.));
        let same = if sum > 0. {
            weights[kept.index()].max(0.) / sum
        } else {
            (kept == Beast::Mammoth) as u8 as f64
        };
        let odds = [
            if self.has(Saw) { 0.25 } else { 0. },
            if self.has(Whip) { 0.35 } else { 0. },
            if self.st.chaining.is_some() && self.has(Collar) {
                0.8
            } else {
                0.
            },
        ];
        let mut loss = 0.;
        for a in 0..2 {
            for b in 0..2 {
                for c in 0..2 {
                    let p = (if a != 0 { odds[0] } else { 1. - odds[0] })
                        * (if b != 0 { odds[1] } else { 1. - odds[1] })
                        * (if c != 0 { odds[2] } else { 1. - odds[2] });
                    let rainbow = i.tier + gain + a + b + c >= 5;
                    loss += p * if rainbow {
                        (self.st.vault.len() < 10) as u8 as f64
                    } else if self.fight {
                        0.
                    } else {
                        1. - same
                    };
                }
            }
        }
        self.link_value(link) * loss
    }
    fn best_hunt(&self) -> Option<(usize, f64)> {
        if !e::can_hunt(self.st) {
            return None;
        }
        let lion = self.st.cells[self.st.position].inmate.unwrap();
        let mut best = None;
        for n in e::hunt_targets(self.st) {
            let prey = self.st.cells[n].inmate.unwrap();
            let value = 0.8
                * self.link_value(&Prey {
                    lion: lion.id,
                    prey: prey.id,
                    rounds: self.st.params.prey_rounds,
                    prey_beast: prey.beast,
                    next: self.st.day + 1,
                });
            if best.is_none_or(|(_, v)| value > v) {
                best = Some((n, value))
            }
        }
        best
    }
    pub fn devour_scores(&mut self) -> Vec<(usize, f64)> {
        let here = self.st.cells[self.st.position];
        let Some(i) = here.inmate.filter(|_| !here.sealed) else {
            return vec![];
        };
        let (mut comp, crowd) = composition(self.st, Some(here.n));
        let chained = self.st.chaining.is_some();
        let mut out = vec![];
        for o in if chained {
            e::chain_options(self.st)
        } else {
            e::start_options(self.st)
        } {
            let target = self.st.cells[o.cell];
            let own = self.link_loss(i, false, Some(o));
            let meal = if o.scratch {
                target.hidden.unwrap()
            } else {
                target.inmate.unwrap()
            };
            let ml = if o.scratch {
                0.
            } else {
                self.link_loss(meal, true, None)
            };
            let same = own != 0.
                && ml != 0.
                && self.st.link_of(i.id).map(|p| p.lion)
                    == self.st.link_of(meal.id).map(|p| p.lion);
            let loss = if same { own.max(ml) } else { own + ml };
            let stair = if o.scratch {
                0.
            } else {
                self.stair_delta(&comp, meal.tier, meal.beast.index(), -1)
            };
            let cage = if self.has(Cage) {
                self.p.w_cage * 0.4 * self.p.w_open * self.open_value
            } else {
                0.
            };
            let value = self.devour_delta(
                i.tier,
                i.beast.index(),
                meal.beast.index(),
                o.scratch,
                &mut comp,
                crowd,
                chained,
                if o.scratch { i.tier } else { meal.tier },
            ) - loss
                + stair
                + cage;
            out.push((o.cell, value));
        }
        out.sort_by(|a, b| b.1.total_cmp(&a.1));
        out
    }
    fn swap_gain(&self) -> f64 {
        let here = self.st.cells[self.st.position];
        let Some(i) = here
            .inmate
            .filter(|_| !here.sealed && self.st.can_swap() && self.swap_cap >= 0)
        else {
            return f64::NEG_INFINITY;
        };
        let mut gain = self.swap_value(i.tier) - self.link_loss(i, true, None);
        if here.ivory {
            let board: Vec<_> = self
                .st
                .board()
                .into_iter()
                .filter_map(|n| self.st.cells[n].inmate.filter(|i| i.tier < 5))
                .collect();
            let lift = board.iter().fold(0., |a, i| {
                a + self.v[i.tier as usize + 1] - self.v[i.tier as usize]
            }) / board.len().max(1) as f64;
            gain += self.st.params.ivory_count.min(board.len()) as f64 * lift;
            return gain;
        }
        if i.tier <= self.swap_cap {
            gain
        } else {
            f64::NEG_INFINITY
        }
    }
    pub fn patrol_scores(&mut self) -> Vec<(usize, f64)> {
        let s = self.st;
        let (mut comp, crowd) = composition(s, None);
        let swap_left = s.can_swap();
        let mut fresh = None;
        let mut average = None;
        let mut out = vec![];
        let range = s.params.patrol_range.min(15);
        for &n in &s.destinations {
            let c = s.cells[n];
            let d = if !s.ratway && steps(s.position, n) <= range {
                steps(s.position, n)
            } else {
                0
            };
            let mut score = self.p.w_step * d as f64;
            if s.chain && !s.ratway {
                let path = if d > 0 { e::path(s, n) } else { vec![n] };
                let sealed = path.iter().filter(|&&k| s.cells[k].sealed).count();
                score += self.p.w_open * (sealed - c.sealed as usize) as f64 * self.open_value
                    + if c.sealed {
                        self.fresh_cached(&mut fresh, &mut comp, crowd, swap_left)
                    } else if c.inmate.is_some() {
                        self.p.w_walk * self.known(n, swap_left)
                    } else {
                        0.
                    };
            } else if c.sealed && c.nest.is_some() {
                score += self.p.w_nest
            } else if c.sealed {
                let dist = if c.known != 0 && c.hidden.is_some() {
                    Some(
                        (0..5)
                            .map(|t| {
                                if t == c.hidden.unwrap().tier.min(4) {
                                    1.
                                } else {
                                    0.
                                }
                            })
                            .collect::<Vec<_>>(),
                    )
                } else if c.at_least > 0 {
                    let kept: Vec<_> = self
                        .open_dist
                        .iter()
                        .enumerate()
                        .map(|(t, &p)| if t as i32 >= c.at_least { p } else { 0. })
                        .collect();
                    Some(if kept.iter().any(|&p| p > 0.) {
                        normalize(&kept)
                    } else {
                        self.open_dist.to_vec()
                    })
                } else {
                    None
                };
                score += if let Some(dist) = dist {
                    let dist = self.tagged(&dist);
                    self.fresh_value(&dist, &mut comp, crowd + 1, swap_left)
                } else {
                    self.fresh_cached(&mut fresh, &mut comp, crowd, swap_left)
                };
                if self.has(Blacklist) && self.sealed.saturating_sub(1) <= 5 {
                    score += 2. * self.lift
                }
                if self.has(Keys) && self.p.w_keys != 0. {
                    let beside = [(n + 15) % 16, (n + 1) % 16]
                        .iter()
                        .filter(|&&k| s.cells[k].sealed)
                        .count();
                    score += self.p.w_keys * 0.8 * beside as f64 * self.p.w_open * self.open_value
                }
                if self.has(Forged) && self.p.w_forged != 0. && self.sealed > 1 {
                    score += self.p.w_forged * 0.5 * self.p.w_open * self.open_value
                }
                if self.has(Fire) && self.p.w_fire != 0. && self.sealed > 1 {
                    score += self.p.w_fire * 0.35 * self.p.w_open * self.open_value
                }
                if let Some(event) = c.event {
                    score += if !c.event_known {
                        self.average_event(&mut average, &comp)
                    } else {
                        self.event_worth(event, &comp)
                    }
                }
            } else if n == 0 {
                let (a, b, t) = self.office_values(&comp);
                score += a.max(b) + t
            } else if c.inmate.is_some() {
                score += self.p.w_walk * self.known(n, swap_left);
                if self.consumes != 0 && self.p.w_consume_walk != 0. && e::has_meal(s, n) {
                    score += self.p.w_consume_walk / self.consumes as f64
                }
                if let Some(event) = c.event {
                    score += if !c.event_known {
                        self.average_event(&mut average, &comp)
                    } else {
                        self.event_worth(event, &comp)
                    }
                }
            }
            if self.has(Shackles) && self.lift != 0. && d >= 4 {
                score += 0.4 * self.lift
            }
            if self.has(Shortchain) && (1..=3).contains(&d) && self.sealed > c.sealed as usize {
                score += self.p.w_short * 0.5 * self.p.w_open * self.open_value
            }
            if self.goal != 0 {
                score += self.p.w_goal * (d as i32).min(self.goal) as f64
            }
            if self.incidents != 0 {
                let incident = |k: usize| {
                    s.cells[k].event.is_some() && (s.cells[k].sealed || s.cells[k].inmate.is_some())
                };
                if incident(n) {
                    score += self.p.w_incident / self.incidents as f64
                }
                if d > 1 && self.p.w_pass != 0. {
                    let passed = e::path(s, n)
                        .iter()
                        .filter(|&&k| k != n && incident(k))
                        .count();
                    score -= self.p.w_pass * passed as f64 / self.incidents as f64
                }
            }
            out.push((n, score));
        }
        out.sort_by(|a, b| b.1.total_cmp(&a.1));
        out
    }
    fn fresh_cached(
        &mut self,
        value: &mut Option<f64>,
        comp: &mut [i32; 24],
        crowd: usize,
        swap_left: bool,
    ) -> f64 {
        if let Some(v) = *value {
            return v;
        }
        let dist = self.tagged(&self.open_dist);
        let v = self.fresh_value(&dist, comp, crowd + 1, swap_left);
        *value = Some(v);
        v
    }
    fn average_event(&self, value: &mut Option<f64>, comp: &[i32; 24]) -> f64 {
        *value.get_or_insert_with(|| {
            self.st
                .event_pool
                .iter()
                .fold(0., |a, &id| a + self.event_worth(id, comp))
                / self.st.event_pool.len() as f64
        })
    }
    fn known(&mut self, n: usize, swap_left: bool) -> f64 {
        let (mut comp, crowd) = composition(self.st, Some(n));
        let i = self.st.cells[n].inmate.unwrap();
        self.activation(i.tier, i.beast.index(), &mut comp, crowd, swap_left)
    }
}

fn board_value(st: &State, v: &[f64; 6], r: f64) -> f64 {
    let mut value = st.vault.len() as f64 * r;
    for n in st.board_iter() {
        let i = st.cells[n].inmate.unwrap();
        value += v[i.tier as usize] * if e::has_meal(st, n) { 1.25 } else { 1. }
    }
    value
}
fn pick_gift(st: &State, ctx: &Context, options: &[Id], rng: &mut u32) -> Id {
    let p = ctx.p;
    if let Some(rank) = &p.gift_rank {
        return rank
            .iter()
            .find(|id| options.contains(id))
            .copied()
            .unwrap_or(options[0]);
    }
    let last = st.day >= st.max_days
        && st.chaining.is_none()
        && !st.can_devour()
        && !st.can_swap()
        && !e::can_hunt(st);
    let final_gift = st.phase == Phase::Manage && st.event.is_none() && st.pending.len() == 1;
    if p.terminal_gifts
        && last
        && final_gift
        && options.contains(&Horn)
        && !st.cells.iter().any(|c| c.n != 0 && c.sealed)
        && st.board_iter().any(|n| e::has_meal(st, n))
    {
        return Horn;
    }
    if last && (!p.terminal_gifts || final_gift) {
        let mut best = None;
        for &id in options {
            let mut gain = 0;
            for _ in 0..3 {
                let mut trial = st.clone();
                trial.rng = (random(rng) * 4294967296.) as u32;
                if e::apply(&mut trial, &Action::Choose { id }) {
                    gain += trial.vault.len() as i32 - st.vault.len() as i32
                }
            }
            if gain > 0 && best.is_none_or(|(_, g)| gain > g) {
                best = Some((id, gain))
            }
        }
        if let Some((id, _)) = best {
            return id;
        }
        if options.contains(&Ring) {
            return Ring;
        }
    }
    if p.gift_chain {
        let left = st
            .pending
            .iter()
            .filter(|c| c.kind == ChoiceKind::Gift)
            .count();
        if options.contains(&Horn) {
            for _ in 0..3 {
                let mut trial = st.clone();
                trial.rng = (random(rng) * 4294967296.) as u32;
                if e::apply(&mut trial, &Action::Choose { id: Horn })
                    && trial.vault.len() > st.vault.len()
                {
                    return Horn;
                }
            }
        }
        if left >= 3 && options.contains(&Ring) && st.cells.iter().any(|c| c.n != 0 && c.sealed) {
            return Ring;
        }
        if left >= 2
            && options.contains(&Wine)
            && st
                .cells
                .iter()
                .any(|c| !c.sealed && c.inmate.is_some_and(|i| i.tier < 3))
        {
            return Wine;
        }
    }
    if p.gift_adaptive {
        return paired_gift(st, ctx, options, rng);
    }
    let mut best = None;
    for &id in options {
        let mut value = 0.;
        let samples = if id == Ring || id == Horn { 3 } else { 1 };
        for _ in 0..samples {
            let mut trial = st.clone();
            trial.rng = (random(rng) * 4294967296.) as u32;
            if !e::apply(&mut trial, &Action::Choose { id }) {
                continue;
            }
            let r = if trial.vault.len() >= 10 {
                ctx.v[4]
            } else {
                ctx.v[5] * p.rainbow_mult
            };
            value += board_value(&trial, &ctx.v, r)
        }
        value /= samples as f64;
        if best.is_none_or(|(_, v)| value > v) {
            best = Some((id, value))
        }
    }
    best.map(|(id, _)| id).unwrap_or(options[0])
}
fn paired_gift(st: &State, ctx: &Context, options: &[Id], rng: &mut u32) -> Id {
    let mut vals: Vec<Vec<f64>> = options.iter().map(|_| Vec::with_capacity(6)).collect();
    let mut means = vec![0.; options.len()];
    let sample =
        |indices: &[usize], rng: &mut u32, vals: &mut Vec<Vec<f64>>, means: &mut Vec<f64>| {
            for _ in 0..3 {
                let seed = (random(rng) * 4294967296.) as u32;
                for &i in indices {
                    let value = if options[i] == Wine && !vals[i].is_empty() {
                        vals[i][0]
                    } else {
                        let mut trial = st.clone();
                        trial.rng = seed;
                        if !e::apply(&mut trial, &Action::Choose { id: options[i] }) {
                            0.
                        } else {
                            let r = if trial.vault.len() >= 10 {
                                ctx.v[4]
                            } else {
                                ctx.v[5] * ctx.p.rainbow_mult
                            };
                            board_value(&trial, &ctx.v, r)
                        }
                    };
                    vals[i].push(value);
                }
            }
            for &i in indices {
                means[i] = vals[i].iter().sum::<f64>() / vals[i].len() as f64;
            }
        };
    let mut indices: Vec<_> = (0..options.len()).collect();
    sample(&indices, rng, &mut vals, &mut means);
    indices.sort_by(|&a, &b| means[b].total_cmp(&means[a]));
    if indices.len() > 1 {
        let (a, b) = (indices[0], indices[1]);
        let gap = means[a] - means[b];
        let n = vals[a].len() as f64;
        let se = (vals[a]
            .iter()
            .zip(&vals[b])
            .map(|(&x, &y)| (x - y - gap).powi(2))
            .sum::<f64>()
            / (n * (n - 1.)))
            .sqrt();
        if se > 0. && gap < 1.96 * se {
            sample(&indices[..2], rng, &mut vals, &mut means);
        }
    }
    let mut best = 0;
    for i in 1..options.len() {
        if means[i] > means[best] {
            best = i;
        }
    }
    options[best]
}
fn combo_value(ids: &[Id]) -> Option<f64> {
    let d = &data().combos;
    if ids.is_empty() {
        return Some(d.base);
    }
    let mut key: Vec<_> = ids
        .iter()
        .map(|id| d.ids.iter().position(|x| x == id).map(|n| (97 + n) as u8))
        .collect::<Option<Vec<_>>>()?;
    key.sort_unstable();
    d.v.get(std::str::from_utf8(&key).ok()?).copied()
}
struct ComboLookup {
    largest: usize,
    single: [Option<f64>; 31],
    pairs: [[Option<f64>; 31]; 31],
}
fn combo_lookup() -> &'static ComboLookup {
    static LOOKUP: OnceLock<ComboLookup> = OnceLock::new();
    LOOKUP.get_or_init(|| {
        let mut table = ComboLookup {
            largest: data().combos.v.keys().map(|s| s.len()).max().unwrap_or(1),
            single: [None; 31],
            pairs: [[None; 31]; 31],
        };
        for i in 0..31 {
            table.single[i] = combo_value(&[Id::TOOLS[i]]);
            for j in 0..31 {
                table.pairs[i][j] = combo_value(&[Id::TOOLS[i], Id::TOOLS[j]])
            }
        }
        table
    })
}
fn subsets(held: &[Id], from: usize, size: usize, chosen: &mut Vec<Id>, out: &mut Vec<Vec<Id>>) {
    if chosen.len() == size {
        out.push(chosen.clone());
        return;
    }
    for i in from..held.len() {
        chosen.push(held[i]);
        subsets(held, i + 1, size, chosen, out);
        chosen.pop();
    }
}
pub fn tool_gains(st: &State, options: &[Id]) -> Option<Vec<f64>> {
    let d = &data().combos;
    if !options.iter().all(|id| d.ids.contains(id)) {
        return None;
    }
    let held: Vec<_> = st
        .tools
        .iter()
        .copied()
        .filter(|id| d.ids.contains(id))
        .collect();
    let table = combo_lookup();
    let largest = table.largest;
    if largest <= 2 {
        let mut gains = Vec::with_capacity(options.len());
        for &id in options {
            if id as usize >= 31 {
                return None;
            }
            let value = if held.is_empty() || largest == 1 {
                table.single[id as usize]? - d.base
            } else {
                let mut sum = 0.;
                for &other in &held {
                    sum += table.pairs[other as usize][id as usize]? - table.single[other as usize]?
                }
                sum / held.len() as f64
            };
            gains.push(value)
        }
        return Some(gains);
    }
    let size = held.len().min(largest.saturating_sub(1));
    let mut subs = vec![];
    subsets(&held, 0, size, &mut vec![], &mut subs);
    let mut gains = vec![];
    for &id in options {
        let mut sum = 0.;
        let mut count = 0;
        for sub in &subs {
            let mut more = sub.clone();
            more.push(id);
            if let (Some(a), Some(b)) = (combo_value(&more), combo_value(sub)) {
                sum += a - b;
                count += 1
            }
        }
        if count == 0 {
            return None;
        }
        gains.push(sum / count as f64)
    }
    Some(gains)
}
fn gains_for(st: &State, options: &[Id], assessment: bool) -> Option<Vec<f64>> {
    if assessment {
        crate::assessment::tool_gains(st, options)
    } else {
        tool_gains(st, options)
    }
}
fn reroll_odds(st: &State, options: &[Id], assessment: bool) -> Option<(f64, f64)> {
    let mut pool: Vec<_> = Id::TOOLS
        .into_iter()
        .filter(|id| !st.tools.contains(id) && !options.contains(id))
        .collect();
    if pool.len() < 3 {
        pool = Id::TOOLS
            .into_iter()
            .filter(|id| !st.tools.contains(id))
            .collect()
    }
    let mut all = options.to_vec();
    for &id in &pool {
        if !all.contains(&id) {
            all.push(id)
        }
    }
    let gains = gains_for(st, &all, assessment)?;
    if pool.len() < 3 {
        return None;
    }
    let gain = |id: &Id| gains[all.iter().position(|x| x == id).unwrap()];
    let pool_gains: Vec<_> = pool.iter().map(gain).collect();
    let w: Vec<_> = pool.iter().map(|&id| e::tool_weight(st, id)).collect();
    let total = w.iter().sum::<f64>();
    let mut next = 0.;
    let mut mass = 0.;
    for i in 0..pool.len() {
        for j in 0..pool.len() {
            if j == i || total - w[i] <= 0. {
                continue;
            }
            let pij = (w[i] / total) * (w[j] / (total - w[i]));
            let best_pair = pool_gains[i].max(pool_gains[j]);
            let rest = total - w[i] - w[j];
            if rest <= 0. {
                continue;
            }
            for k in 0..pool.len() {
                if k == i || k == j {
                    continue;
                }
                let p = pij * (w[k] / rest);
                next += p * best_pair.max(pool_gains[k]);
                mass += p
            }
        }
    }
    Some((
        options.iter().map(gain).fold(f64::NEG_INFINITY, f64::max),
        if mass > 0. { next / mass } else { 0. },
    ))
}
pub fn decide(st: &State, p: &Policy, rng: &mut u32, cache: &mut Cache) -> Option<Action> {
    if st.phase == Phase::Ended {
        return None;
    }
    if let Some(choice) = st.pending.first() {
        if choice.kind == ChoiceKind::Gift {
            let ctx = Context::new(st, p, cache);
            return Some(Action::Choose {
                id: pick_gift(st, &ctx, &choice.options, rng),
            });
        }
        if e::can_reroll(st)
            && p.tool_sets
            && reroll_odds(st, &choice.options, p.assessment)
                .is_some_and(|(now, next)| next > now + p.reroll_margin)
        {
            return Some(Action::Reroll);
        }
        if p.tool_sets {
            if let Some(g) = gains_for(st, &choice.options, p.assessment) {
                let mut best = 0;
                for i in 1..g.len() {
                    if g[i] > g[best] {
                        best = i
                    }
                }
                return Some(Action::Choose {
                    id: choice.options[best],
                });
            }
        }
        return Some(Action::Choose {
            id: p
                .tool_rank
                .iter()
                .find(|id| choice.options.contains(id))
                .copied()
                .unwrap_or(choice.options[0]),
        });
    }
    // These decisions never consult board scores. Avoid preparing all scores
    // for forced End/office moves and events with a fixed policy answer.
    if st.chaining.is_none() {
        if st.phase == Phase::Manage && !st.can_devour() && !st.can_swap() && !e::can_hunt(st) {
            return Some(Action::End);
        }
        if st.phase == Phase::Office {
            if let Some(choice) = st.used.office_only.or(p.office) {
                return Some(Action::Office { choice });
            }
        }
        if st.phase == Phase::Event {
            if let Some(event) = st.event {
                let accept = match event.kind {
                    EventKind::Execution => None,
                    EventKind::Chain => Some(p.accept_chain),
                    EventKind::Trickster => {
                        Some(st.cells[event.cell].inmate.is_some_and(|i| i.tier < 4))
                    }
                    _ => Some(true),
                };
                if let Some(accept) = accept {
                    return Some(Action::Event { accept });
                }
            }
        }
    }
    let mut ctx = Context::new(st, p, cache);
    if st.chaining.is_some() {
        let options = ctx.devour_scores();
        if st.params.chain_stop && (options.is_empty() || options[0].1 < p.stop_margin) {
            return Some(Action::Stopchain);
        }
        return Some(
            options
                .first()
                .map(|&(to, _)| Action::Chain { to })
                .unwrap_or(Action::End),
        );
    }
    if st.phase == Phase::Office {
        if let Some(choice) = st.used.office_only.or(p.office) {
            return Some(Action::Office { choice });
        }
        let (a, b, _) = ctx.office_values(&composition(st, None).0);
        return Some(Action::Office {
            choice: if a >= b {
                Office::Bestow
            } else {
                Office::Instigate
            },
        });
    }
    if st.phase == Phase::Event {
        if let Some(event) = st.event {
            use EventKind::*;
            let accept = match event.kind {
                Chain => p.accept_chain,
                Appetite | Convict | Crow | Freedom | Usurp1 | Usurp2 | Usurp3 | Usurp4
                | Ratway | Hunt | Portion => true,
                Trickster => st.cells[event.cell].inmate.is_some_and(|i| i.tier < 4),
                _ => st.cells[event.cell].inmate.is_some_and(|i| {
                    ctx.execution(
                        i.tier,
                        i.beast.index(),
                        &composition(st, Some(event.cell)).0,
                    ) > p.exec_margin
                }),
            };
            return Some(Action::Event { accept });
        }
    }
    if st.phase == Phase::Patrol {
        return Some(
            ctx.patrol_scores()
                .first()
                .map(|&(cell, _)| Action::Patrol { cell })
                .unwrap_or(Action::End),
        );
    }
    let swap = ctx.swap_gain();
    let hunt = ctx.best_hunt();
    if st.can_devour() {
        let mut devours = ctx.devour_scores();
        if !devours.is_empty() && ctx.consumes != 0 && p.w_consume != 0. {
            devours[0].1 += p.w_consume / ctx.consumes as f64
        }
        if let Some(&(to, score)) = devours.first().filter(|(_, v)| *v >= p.min_devour) {
            if let Some((target, v)) = hunt {
                if v > score && v > swap {
                    return Some(Action::Hunt { to: target });
                }
            }
            if swap > 0. && swap > score + p.swap_margin {
                return Some(Action::Swap);
            }
            return Some(Action::Devour { to });
        }
    }
    if let Some((to, v)) = hunt {
        if v > 0. && v > swap {
            return Some(Action::Hunt { to });
        }
    }
    if swap > 0. {
        return Some(Action::Swap);
    }
    Some(Action::End)
}
pub fn playout(st: &mut State, p: &Policy, rng: &mut u32, cache: &mut Cache) -> bool {
    for _ in 0..2000 {
        if st.phase == Phase::Ended || st.vault.len() >= 10 {
            return true;
        }
        let Some(action) = decide(st, p, rng, cache) else {
            return true;
        };
        if !e::apply(st, &action) && !(action != Action::End && e::apply(st, &Action::End)) {
            return false;
        }
    }
    false
}
