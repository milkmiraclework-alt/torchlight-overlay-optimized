use crate::{
    engine,
    job::Job,
    model::*,
    policy::{self, Cache},
};
use serde_json::{json, Value};
#[cfg(not(target_arch = "wasm32"))]
use std::time::Instant;
#[derive(Default)]
pub struct Core {
    pub job: Option<Job>,
}
#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
extern "C" {
    fn now() -> f64;
}
#[cfg(target_arch = "wasm32")]
fn clock() -> f64 {
    unsafe { now() }
}
#[cfg(not(target_arch = "wasm32"))]
fn clock() -> f64 {
    static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.
}
fn state(v: &Value) -> Result<State, String> {
    let s: State = serde_json::from_value(v.clone()).map_err(|e| format!("Invalid state: {e}"))?;
    if s.position >= 16
        || s.cells.iter().enumerate().any(|(n, c)| {
            n != c.n
                || c.inmate.is_some_and(|i| i.tier < 0 || i.tier > 5)
                || c.hidden.is_some_and(|i| i.tier < 0 || i.tier > 5)
        })
        || s.destinations.iter().any(|&n| n >= 16)
    {
        return Err("Invalid board cells".into());
    }
    if s.params.tier_weights.len() != 5
        || s.params.swap_weights.len() != 5
        || s.params.beast_weights.len() != 4
        || s.event_pool.is_empty()
    {
        return Err("Invalid rule weights/event pool".into());
    }
    Ok(s)
}
impl Core {
    pub fn handle(&mut self, v: Value) -> Result<Value, String> {
        let op = v["op"].as_str().unwrap_or("solve");
        match op {
            "init" | "solve" => {
                let s = state(&v["state"])?;
                let target = v["rollouts"].as_u64().unwrap_or(400) as usize;
                if target > 100_000 {
                    return Err("Rollout limit exceeded".into());
                }
                let seed = v["seed"].as_u64().unwrap_or(1) as u32;
                let stream = v["stream"].as_u64().unwrap_or(0) as u32;
                let mut job = Job::new(s, target, seed, stream, v.get("params"));
                if op == "solve" {
                    while !job.done() {
                        job.one_round()?
                    }
                }
                let out =
                    json!({"rounds":job.round,"done":job.done(),"goal":"rainbows","rows":job.rows});
                self.job = Some(job);
                Ok(out)
            }
            "step" => {
                let job = self.job.as_mut().ok_or("No current job")?;
                let from = job.round;
                let begin = clock();
                let ms = v["ms"].as_f64().unwrap_or(50.);
                let rounds = v["rounds"].as_u64().map(|x| x as usize);
                while !job.done()
                    && rounds
                        .map(|n| job.round - from < n)
                        .unwrap_or_else(|| clock() - begin < ms)
                {
                    job.one_round()?
                }
                let rows:Vec<_>=job.rows.iter().map(|row|json!({"vals":row.vals[from..].iter().map(|x|if x.is_nan(){Value::Null}else{json!(x)}).collect::<Vec<_>>(),"best":row.best,"pass":0,"points":0})).collect();
                Ok(json!({"rounds":job.round,"done":job.done(),"goal":"rainbows","rows":rows}))
            }
            "select" => {
                let indices: Vec<usize> =
                    serde_json::from_value(v["indices"].clone()).map_err(|e| e.to_string())?;
                self.job
                    .as_mut()
                    .ok_or("No current job")?
                    .select(&indices)?;
                Ok(json!({"ok":true}))
            }
            "cancel" => {
                self.job = None;
                Ok(json!({"ok":true}))
            }
            "candidates" => Ok(json!(engine::candidates(&state(&v["state"])?))),
            "predict" => {
                let base = state(&v["state"])?;
                let action: Action =
                    serde_json::from_value(v["action"].clone()).map_err(|e| e.to_string())?;
                let o = &v["options"];
                let samples = o["samples"].as_u64().unwrap_or(48).clamp(1, 96);
                let mut rng = o["seed"].as_u64().filter(|&x| x != 0).unwrap_or(1) as u32;
                let mut out = vec![];
                for _ in 0..samples {
                    let mut next = base.clone();
                    engine::hide_future(&mut next, (random(&mut rng) * 4294967296.) as u32);
                    if !engine::apply(&mut next, &action) || next.phase == Phase::Ended {
                        continue;
                    }
                    if o["autoDay"].as_bool() == Some(true)
                        && next.phase == Phase::Manage
                        && next.chaining.is_none()
                        && next.pending.is_empty()
                        && (next.used.devour > 0 || engine::meals(&next, next.position).is_empty())
                        && engine::candidates(&next) == vec![Action::End]
                    {
                        engine::apply(&mut next, &Action::End);
                    }
                    if next.phase == Phase::Ended {
                        continue;
                    }
                    let family = o["patrolFamilies"].as_bool() == Some(true)
                        && next.phase == Phase::Patrol
                        && !next.ratway
                        && next.pending.is_empty();
                    if family {
                        next.destinations = (1..=next.params.patrol_range)
                            .map(|d| (next.position + d) % 16)
                            .collect()
                    }
                    out.push(json!({"state":next,"patrolFamily":family}));
                }
                Ok(json!(out))
            }
            "decide" => {
                let s = state(&v["state"])?;
                let p = policy::policy(&s, v.get("params"));
                let mut rng = v["seed"].as_u64().unwrap_or(1) as u32;
                let action = policy::decide(&s, &p, &mut rng, &mut Cache::default());
                Ok(json!({"action":action,"rng":rng}))
            }
            "scores" => {
                let s = state(&v["state"])?;
                let p = policy::policy(&s, v.get("params"));
                let mut cache = Cache::default();
                let mut c = policy::Context::new(&s, &p, &mut cache);
                Ok(json!({"patrol":c.patrol_scores(),"devour":c.devour_scores()}))
            }
            "apply" => {
                let mut s = state(&v["state"])?;
                let a: Action =
                    serde_json::from_value(v["action"].clone()).map_err(|e| e.to_string())?;
                let ok = engine::apply(&mut s, &a);
                Ok(json!({"ok":ok,"state":s}))
            }
            "playout" => {
                let mut s = state(&v["state"])?;
                let p = policy::policy(&s, v.get("params"));
                let mut rng = v["seed"].as_u64().unwrap_or(1) as u32;
                let ok = policy::playout(&mut s, &p, &mut rng, &mut Cache::default());
                Ok(json!({"ok":ok,"state":s,"rng":rng}))
            }
            "trajectory" => {
                let mut s = state(&v["state"])?;
                let p = policy::policy(&s, v.get("params"));
                let mut rng = v["seed"].as_u64().unwrap_or(1) as u32;
                let mut out = vec![];
                let mut cache = Cache::default();
                for _ in 0..2000 {
                    if s.phase == Phase::Ended {
                        break;
                    }
                    let a = policy::decide(&s, &p, &mut rng, &mut cache).ok_or("No action")?;
                    let ok = engine::apply(&mut s, &a);
                    out.push(json!({"action":a,"ok":ok,"state":s}));
                    if !ok {
                        break;
                    }
                }
                Ok(json!({"steps":out,"rng":rng}))
            }
            _ => Err(format!("Unknown operation: {op}")),
        }
    }
}
