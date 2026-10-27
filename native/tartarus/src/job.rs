use crate::{
    engine,
    model::*,
    policy::{self, Cache, Policy},
};
use serde::Serialize;

#[derive(Serialize)]
pub struct RainbowTotals {
    pub sum: f64,
    pub square: f64,
}
#[derive(Serialize)]
pub struct Row {
    pub action: Action,
    pub vals: Vec<f64>,
    pub best: i32,
    pub policy: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rainbow: Option<RainbowTotals>,
}
pub struct Job {
    pub base: State,
    pub p: Policy,
    pub rows: Vec<Row>,
    pub round: usize,
    pub target: usize,
    rng: u32,
    pub cache: Cache,
    pub assessment: bool,
}
impl Job {
    pub fn new(
        st: State,
        target: usize,
        seed: u32,
        stream: u32,
        params: Option<&serde_json::Value>,
        assessment: bool,
    ) -> Self {
        let p = if assessment {
            crate::assessment::policy(&st, params)
        } else {
            policy::policy(&st, params)
        };
        let mut policy_rng = seed ^ 0x5bd1e995;
        let pick = policy::decide(&st, &p, &mut policy_rng, &mut Cache::default());
        let rows = engine::candidates(&st)
            .into_iter()
            .map(|a| Row {
                policy: pick.as_ref() == Some(&a),
                action: a,
                vals: Vec::with_capacity(target),
                rainbow: assessment.then_some(RainbowTotals {
                    sum: 0.,
                    square: 0.,
                }),
                best: 0,
            })
            .collect();
        Self {
            base: st,
            p,
            rows,
            round: 0,
            target,
            rng: if stream != 0 {
                seed ^ stream.wrapping_mul(0x9e3779b1)
            } else {
                seed
            },
            cache: Cache::default(),
            assessment,
        }
    }
    pub fn done(&self) -> bool {
        self.round >= self.target || self.rows.len() <= 1
    }
    pub fn one_round(&mut self) -> Result<(), String> {
        let seed = (random(&mut self.rng) * 4294967296.) as u32;
        for row in &mut self.rows {
            let mut trial = self.base.clone();
            engine::hide_future(&mut trial, seed);
            if !engine::apply(&mut trial, &row.action) {
                row.vals.push(f64::NAN);
                continue;
            }
            let mut rng = seed ^ 0x9e3779b9;
            let ok = if self.assessment {
                crate::assessment::playout(
                    &mut trial,
                    &self.p,
                    &mut rng,
                    &mut self.cache,
                    self.base.day + 3,
                )
            } else {
                policy::playout(&mut trial, &self.p, &mut rng, &mut self.cache)
            };
            if !ok {
                return Err("Playout stopped before its terminal state".into());
            }
            if self.assessment {
                let expected = crate::assessment::rainbows(&trial);
                let totals = row.rainbow.as_mut().unwrap();
                totals.sum += expected;
                totals.square += expected * expected;
                row.vals
                    .push(crate::assessment::score(&trial, self.base.vault.len()));
            } else {
                row.vals.push(trial.vault.len() as f64);
            }
            row.best += trial
                .cells
                .iter()
                .filter(|c| !c.sealed)
                .filter_map(|c| c.inmate.map(|i| i.tier))
                .max()
                .unwrap_or(0)
                .max(if trial.vault.is_empty() { 0 } else { 5 });
        }
        self.round += 1;
        Ok(())
    }
    pub fn select(&mut self, indices: &[usize]) -> Result<(), String> {
        if indices.iter().any(|&i| i >= self.rows.len()) {
            return Err("Invalid promoted row index".into());
        }
        let mut old: Vec<_> = self.rows.drain(..).map(Some).collect();
        for &i in indices {
            self.rows
                .push(old[i].take().ok_or("Duplicate promoted row index")?)
        }
        Ok(())
    }
}
