//! Simulation rules. Presentation, logs, lab editors and retired contracts are
//! intentionally absent. Random draw order matches the reference engine.
use crate::model::*;
use Beast::*;
use Id::*;

pub fn diets(s: &State, b: Beast, tier: Option<i32>) -> Vec<Beast> {
    let mut out = vec![Beast::ALL[(b.index() + 1) % 4]];
    if tier.is_some_and(|t| {
        t >= if s.fight() {
            0
        } else {
            s.params.double_eat_tier
        }
    }) {
        if b == Mammoth {
            out.push(Wolf);
        } else if b == Lion {
            out.push(Rat);
        }
    }
    out
}
pub fn can_eat(s: &State, a: Inmate, b: Inmate) -> bool {
    if a.id == b.id || a.tier >= 5 {
        return false;
    }
    let first = Beast::ALL[(a.beast.index() + 1) % 4] == b.beast;
    let second = (s.fight() || a.tier >= s.params.double_eat_tier)
        && match a.beast {
            Mammoth => b.beast == Wolf,
            Lion => b.beast == Rat,
            _ => false,
        };
    let counters = first || second || (a.beast == Rat && b.beast == Rat && s.has(Skewer));
    if a.tier != b.tier {
        if b.tier < a.tier && counters && s.fight() {
            return true;
        }
        if b.tier > a.tier && counters && a.beast == Mammoth && s.has(Maul) {
            return true;
        }
        return a.tier > b.tier && a.beast == Wolf && s.has(Guillotine) && b.beast == Rat;
    }
    counters || (a.beast == Lion && s.has(Crown))
}
pub fn meals(s: &State, n: usize) -> Vec<Meal> {
    let Some(cell) = s.cells.get(n) else {
        return vec![];
    };
    let Some(eater) = cell.inmate.filter(|_| !cell.sealed) else {
        return vec![];
    };
    s.cells
        .iter()
        .filter_map(|c| {
            if c.n == n {
                return None;
            }
            if !c.sealed && c.inmate.is_some_and(|m| can_eat(s, eater, m)) {
                return Some(Meal {
                    cell: c.n,
                    scratch: false,
                });
            }
            if c.sealed
                && c.scratch
                && eater.beast == Wolf
                && eater.tier < 5
                && c.hidden.is_some_and(|m| m.tier == eater.tier)
            {
                return Some(Meal {
                    cell: c.n,
                    scratch: true,
                });
            }
            None
        })
        .collect()
}
pub fn framed(s: &State, options: Vec<Meal>) -> Vec<Meal> {
    match &s.used.meal_only {
        Some(ns) => options
            .into_iter()
            .filter(|m| ns.contains(&m.cell))
            .collect(),
        None => options,
    }
}
pub fn start_options(s: &State) -> Vec<Meal> {
    if s.can_devour() && s.phase == Phase::Manage {
        framed(s, meals(s, s.position))
    } else {
        vec![]
    }
}
pub fn chain_options(s: &State) -> Vec<Meal> {
    s.chaining
        .as_ref()
        .and_then(|c| s.board_cell_of(c.eater))
        .map(|n| framed(s, meals(s, n)))
        .unwrap_or_default()
}
pub fn hunt_targets(s: &State) -> Vec<usize> {
    let c = s.cells[s.position];
    let Some(lion) = c
        .inmate
        .filter(|i| !c.sealed && i.beast == Lion && s.has(Trap))
    else {
        return vec![];
    };
    if let Some(ns) = &s.used.hunt_only {
        return ns
            .iter()
            .copied()
            .filter(|&n| n < 16 && n != c.n && !s.cells[n].sealed && s.cells[n].inmate.is_some())
            .collect();
    }
    if s.link_of(lion.id).is_some() {
        return vec![];
    }
    s.board()
        .into_iter()
        .filter(|&n| {
            n != c.n
                && s.cells[n]
                    .inmate
                    .is_some_and(|i| can_eat(s, lion, i) && s.link_of(i.id).is_none() && !i.marked)
        })
        .collect()
}
pub fn can_hunt(s: &State) -> bool {
    s.phase == Phase::Manage
        && s.chaining.is_none()
        && s.used.devour < 1
        && s.used.swap < 1
        && s.used.hunt == 0
        && !s.used.no_hunt
        && !hunt_targets(s).is_empty()
}
pub fn can_reroll(s: &State) -> bool {
    s.pending
        .first()
        .is_some_and(|p| p.kind == ChoiceKind::Tool && p.rerolls > 0)
}
pub fn instigate_cells(s: &State) -> Vec<usize> {
    s.cells
        .iter()
        .filter(|c| {
            c.n != 0
                && c.event.is_none()
                && if c.sealed {
                    c.nest.is_none()
                } else {
                    c.inmate.is_some()
                }
        })
        .map(|c| c.n)
        .collect()
}
pub fn instigate_count(s: &State) -> usize {
    if s.cells.iter().any(|c| c.event.is_some()) {
        1
    } else {
        2
    }
}
pub fn path(s: &State, to: usize) -> Vec<usize> {
    if s.position == to {
        return vec![to];
    }
    (1..=steps(s.position, to))
        .map(|d| (s.position + d) % 16)
        .collect()
}
pub fn tool_weight(s: &State, id: Id) -> f64 {
    if id.beast_tool() {
        s.params.beast_tool_odds.max(0.) / 100.
    } else {
        1.
    }
}
pub fn draw_tools(s: &mut State, mut pool: Vec<Id>, k: usize) -> Vec<Id> {
    let mut out = Vec::with_capacity(k);
    while out.len() < k && !pool.is_empty() {
        let w: Vec<_> = pool.iter().map(|&id| tool_weight(s, id)).collect();
        let at = pick_index(&mut s.rng, &w);
        out.push(pool.remove(at));
    }
    out
}
fn make(s: &mut State, beast: Beast, tier: i32) -> Inmate {
    let id = s.next_id;
    s.next_id += 1;
    Inmate {
        id,
        beast,
        tier: tier.clamp(0, 5),
        marked: false,
    }
}
fn door_weights(s: &State, n: usize) -> Vec<f64> {
    let mut w = s.params.tier_weights.clone();
    if s.has(Hook) && w.iter().skip(1).any(|&x| x > 0.) {
        w[0] = 0.
    }
    let kept: Vec<_> = w
        .iter()
        .enumerate()
        .map(|(t, &x)| {
            if t as i32 >= s.cells[n].at_least {
                x
            } else {
                0.
            }
        })
        .collect();
    if kept.iter().any(|&x| x > 0.) {
        kept
    } else {
        w
    }
}
fn roll(s: &mut State, w: &[f64]) -> Inmate {
    let tier = pick_index(&mut s.rng, w) as i32;
    let b = pick_index(&mut s.rng, &s.params.beast_weights);
    make(s, Beast::ALL[b], tier)
}
pub fn hidden(s: &mut State, n: usize) -> Inmate {
    if let Some(i) = s.cells[n].hidden {
        return i;
    }
    let w = door_weights(s, n);
    let i = roll(s, &w);
    s.cells[n].hidden = Some(i);
    i
}
fn empty(s: &mut State, n: usize) {
    let c = &mut s.cells[n];
    c.inmate = None;
    c.hidden = None;
    c.known = 0;
    c.at_least = 0;
    c.scratch = false;
    c.nest = None;
    c.ivory = false;
    c.sealed = s.params.reusable_cells;
    c.seen = false;
    c.event = None;
}
pub fn check_prey(s: &mut State) {
    let good: Vec<_> = s
        .prey
        .iter()
        .copied()
        .filter(|p| {
            let a = s.board_cell_of(p.lion).and_then(|n| s.cells[n].inmate);
            let b = s.board_cell_of(p.prey).and_then(|n| s.cells[n].inmate);
            a.is_some_and(|i| i.beast == Lion) && b.is_some_and(|i| i.beast == p.prey_beast)
        })
        .collect();
    s.prey = good;
}
fn event_roll(s: &mut State) -> EventKind {
    pick(&mut s.rng, &s.event_pool).unwrap_or(EventKind::Chain)
}
fn spawn(s: &mut State, chance: f64) {
    if chance <= 0. || random(&mut s.rng) * 100. >= chance {
        return;
    }
    let free: Vec<_> = s
        .cells
        .iter()
        .filter(|c| c.n != 0 && c.sealed && c.event.is_none() && c.nest.is_none())
        .map(|c| c.n)
        .collect();
    if free.is_empty() {
        return;
    }
    let n = pick(&mut s.rng, &free).unwrap();
    let e = event_roll(s);
    s.cells[n].event = Some(e);
    s.cells[n].seen = true;
}
fn follow_event(s: &mut State) {
    if s.params.event_follow_chance <= 0.
        || random(&mut s.rng) * 100. >= s.params.event_follow_chance
    {
        return;
    }
    let free: Vec<_> = instigate_cells(s)
        .into_iter()
        .filter(|&n| n != s.position)
        .collect();
    if let Some(n) = (!free.is_empty()).then(|| pick(&mut s.rng, &free).unwrap()) {
        let event = event_roll(s);
        s.cells[n].event = Some(event);
        s.cells[n].seen = true;
    }
}
fn meet(s: &mut State) {
    s.milestone = true;
    if s.params.rewards {
        let pool = Id::TOOLS.into_iter().filter(|&t| !s.has(t)).collect();
        let options = draw_tools(s, pool, 3);
        if !options.is_empty() {
            s.pending.push(Choice {
                kind: ChoiceKind::Tool,
                options,
                rerolls: 0,
                start: false,
            })
        }
    }
}
fn count(s: &mut State, id: ObjectiveId) {
    if s.objective.id != id || s.milestone {
        return;
    }
    s.objective.progress = (s.objective.progress + 1).min(id.need());
    if s.objective.progress >= id.need() {
        meet(s)
    }
}
fn growth(s: &mut State, mut i: Inmate) -> Inmate {
    if i.tier >= 5 && s.vault.len() >= 10 {
        i.tier = 4
    }
    if let Some(n) = s.cell_of(i.id) {
        s.cells[n].inmate = Some(i)
    }
    s.stats.best = s.stats.best.max(i.tier);
    if s.objective.id == ObjectiveId::King && !s.milestone && i.tier >= 4 {
        meet(s)
    }
    if i.tier < 5 {
        return i;
    }
    let Some(n) = s.cell_of(i.id) else { return i };
    empty(s, n);
    s.vault.push(Vault {
        id: i.id,
        beast: i.beast,
        day: s.day,
    });
    s.cache += 1;
    if s.params.rewards {
        for _ in 0..if s.start_event == Some(StartEvent::Opulence) {
            3
        } else {
            1
        } {
            s.pending.push(Choice {
                kind: ChoiceKind::Gift,
                options: Id::GIFTS.to_vec(),
                rerolls: 0,
                start: false,
            })
        }
    }
    i
}
fn promote(s: &mut State, mut i: Inmate, by: i32, reroll: bool) -> Inmate {
    i.tier = (i.tier + by).clamp(0, 5);
    if reroll && i.tier < 5 {
        i.beast = Beast::ALL[pick_index(&mut s.rng, &s.params.beast_weights)]
    }
    growth(s, i)
}
fn open(s: &mut State, n: usize, patrol: bool, forced: Option<(Beast, i32)>) -> Option<EventKind> {
    if !s.cells[n].sealed {
        return None;
    }
    let event = s.cells[n].event;
    let i = if let Some((b, t)) = forced {
        make(s, b, t)
    } else if let Some(h) = s.cells[n]
        .hidden
        .filter(|h| h.tier > 0 || s.cells[n].known != 0 || !s.has(Hook))
    {
        h
    } else {
        let w = door_weights(s, n);
        roll(s, &w)
    };
    {
        let c = &mut s.cells[n];
        c.sealed = false;
        c.inmate = Some(i);
        c.hidden = None;
        c.known = 0;
        c.at_least = 0;
        c.scratch = false;
        c.nest = None;
        c.event = None;
    }
    s.stats.opened += 1;
    count(s, ObjectiveId::Doors);
    let i = growth(s, i);
    if patrol
        && s.has(Dogtag)
        && s.cells[n].inmate.is_some_and(|a| a.id == i.id)
        && i.tier < 5
        && random(&mut s.rng) < 0.25
    {
        promote(s, i, 1, false);
    }
    if patrol && s.has(Blacklist) && s.sealed().len() <= 5 {
        let pool: Vec<_> = s
            .board()
            .iter()
            .filter_map(|&n| s.cells[n].inmate.filter(|i| i.tier < 5))
            .collect();
        for who in shuffle(&mut s.rng, pool).into_iter().take(2) {
            if s.board_cell_of(who.id).is_some() {
                promote(s, who, 1, false);
            }
        }
    }
    // The original engine keeps a reference to this inmate through tool growth.
    let live = s.cell_of(i.id).and_then(|at| s.cells[at].inmate);
    if patrol && s.has(Fire) && random(&mut s.rng) < 0.35 && live.is_some() {
        let sealed = s.sealed();
        if !sealed.is_empty() {
            let at = pick(&mut s.rng, &sealed).unwrap();
            let who = live.unwrap();
            open(s, at, false, Some((who.beast, who.tier)));
        }
    }
    if patrol && s.has(Keys) && random(&mut s.rng) < 0.8 {
        for at in [(n + 15) % 16, (n + 1) % 16] {
            open(s, at, false, None);
        }
    }
    if patrol && s.has(Forged) && random(&mut s.rng) < 0.5 {
        let sealed = s.sealed();
        if !sealed.is_empty() {
            let at = pick(&mut s.rng, &sealed).unwrap();
            open(s, at, false, None);
        }
    }
    if patrol {
        event
    } else {
        None
    }
}
fn destination_limit(s: &State) -> usize {
    (if s.dest_base > 0 {
        s.dest_base
    } else {
        s.params.destinations
    })
    .saturating_sub(s.has(Forged) as usize + s.has(Whip) as usize + s.has(Stake) as usize)
    .max(1)
}
fn roll_destinations(s: &mut State) {
    let fewer = random(&mut s.rng) * 100. < s.params.fewer_doors_chance;
    s.dest_base = s.params.destinations.saturating_sub(fewer as usize).max(1);
    let range = s.params.patrol_range.min(15);
    let mut ahead: Vec<_> = (1..=range).map(|d| (s.position + d) % 16).collect();
    let mut ns = Vec::new();
    for _ in 0..destination_limit(s) {
        if ahead.is_empty() {
            break;
        }
        let weights: Vec<_> = ahead
            .iter()
            .map(|&n| {
                if n == 0 {
                    s.params.office_door_odds / 100.
                } else {
                    1.
                }
            })
            .collect();
        if !ns.is_empty() && !weights.iter().any(|&w| w > 0.) {
            break;
        }
        let at = pick_index(&mut s.rng, &weights);
        ns.push(ahead.remove(at));
    }
    if s.params.event_two_doors
        && ns
            .iter()
            .any(|&n| s.cells[n].sealed && s.cells[n].event.is_some() && s.cells[n].seen)
    {
        ns.sort_by_key(|&n| !s.cells[n].sealed || s.cells[n].event.is_none() || !s.cells[n].seen);
        ns.truncate(2);
    }
    ns.sort_by_key(|&n| steps(s.position, n));
    s.destinations = ns;
}
fn begin_day(s: &mut State) {
    s.phase = Phase::Patrol;
    s.used = Used::default();
    check_prey(s);
    for mut link in s.prey.clone() {
        if link.next > s.day {
            continue;
        }
        let a = s.board_cell_of(link.lion).and_then(|n| s.cells[n].inmate);
        let b = s.board_cell_of(link.prey).and_then(|n| s.cells[n].inmate);
        link.rounds -= 1;
        link.next = s.day + 1;
        if let Some(at) = s
            .prey
            .iter()
            .position(|p| p.lion == link.lion && p.prey == link.prey)
        {
            if link.rounds <= 0 {
                s.prey.remove(at);
            } else {
                s.prey[at] = link;
            }
        }
        if let Some(a) = a {
            promote(s, a, 1, false);
        }
        if let Some(b) = b {
            promote(s, b, 1, false);
        }
    }
    check_prey(s);
    for n in 0..16 {
        if s.cells[n].nest.is_some_and(|nest| nest.due <= s.day) {
            open(s, n, false, Some((Rat, s.params.nest_tier)));
        }
    }
    if s.has(Tongs) {
        let pool: Vec<_> = s
            .board()
            .into_iter()
            .filter(|&n| s.cells[n].inmate.unwrap().beast == Mammoth && !s.cells[n].ivory)
            .collect();
        if !pool.is_empty() {
            let n = pick(&mut s.rng, &pool).unwrap();
            s.cells[n].ivory = true;
        }
    }
    if s.has(Claws) {
        let free: Vec<_> = s
            .sealed()
            .into_iter()
            .filter(|&n| !s.cells[n].scratch && s.cells[n].nest.is_none())
            .collect();
        if !free.is_empty() {
            let n = pick(&mut s.rng, &free).unwrap();
            hidden(s, n);
            s.cells[n].scratch = true;
            s.cells[n].known = s.cells[n].known.max(1);
        }
    }
    if s.has(Ironbox) {
        let free: Vec<_> = s
            .sealed()
            .into_iter()
            .filter(|&n| s.cells[n].nest.is_none())
            .collect();
        if !free.is_empty() {
            let n = pick(&mut s.rng, &free).unwrap();
            s.cells[n].nest = Some(Nest {
                due: s.day + s.params.nest_days,
            });
        }
    }
    if s.has(Ravenous) {
        ravenous(s)
    }
    if s.has(Coin) {
        coin(s)
    }
    if s.day > 1 {
        spawn(s, s.params.event_morning_chance)
    }
    roll_destinations(s);
}
fn coin(s: &mut State) {
    let board = s.board();
    let mut counts = [0; 24];
    for &n in &board {
        let i = s.cells[n].inmate.unwrap();
        counts[i.tier as usize * 4 + i.beast.index()] += 1;
    }
    let matching: Vec<_> = board
        .into_iter()
        .filter(|&n| {
            let i = s.cells[n].inmate.unwrap();
            counts[i.tier as usize * 4 + i.beast.index()] >= 2
        })
        .collect();
    if matching.is_empty() || random(&mut s.rng) >= 0.6 {
        return;
    }
    let gone = pick(&mut s.rng, &matching).unwrap();
    let g = s.cells[gone].inmate.unwrap();
    let lucky: Vec<_> = matching
        .into_iter()
        .filter(|&n| {
            n != gone
                && s.cells[n]
                    .inmate
                    .is_some_and(|i| i.beast == g.beast && i.tier == g.tier)
        })
        .collect();
    let at = pick(&mut s.rng, &lucky).unwrap();
    let i = s.cells[at].inmate.unwrap();
    empty(s, gone);
    check_prey(s);
    promote(s, i, 2, false);
}
fn ravenous(s: &mut State) {
    let board = s.board();
    let Some(top) = board.iter().map(|&n| s.cells[n].inmate.unwrap().tier).max() else {
        return;
    };
    let best: Vec<_> = board
        .into_iter()
        .filter(|&n| s.cells[n].inmate.unwrap().tier == top)
        .collect();
    let n = pick(&mut s.rng, &best).unwrap();
    let eater = s.cells[n].inmate.unwrap();
    let sides: Vec<_> = [(n + 15) % 16, (n + 1) % 16]
        .into_iter()
        .filter(|&n| !s.cells[n].sealed && s.cells[n].inmate.is_some())
        .collect();
    let mut rises = 0;
    for at in sides {
        empty(s, at);
        if random(&mut s.rng) < 0.4 {
            rises += 1
        }
    }
    check_prey(s);
    if rises > 0 {
        promote(s, eater, rises, false);
    }
}
fn instigate(s: &mut State) {
    let free = instigate_cells(s);
    let count = instigate_count(s);
    for n in shuffle(&mut s.rng, free).into_iter().take(count) {
        let e = event_roll(s);
        s.cells[n].event = Some(e);
        s.cells[n].seen = true;
    }
}
fn bestow(s: &mut State) {
    let pool: Vec<_> = s
        .board()
        .iter()
        .filter_map(|&n| s.cells[n].inmate.filter(|i| i.tier < 5))
        .collect();
    if !pool.is_empty() {
        let i = pick(&mut s.rng, &pool).unwrap();
        promote(s, i, 1, false);
    }
}
fn walked(s: &mut State, d: usize) {
    if s.has(Shortchain) && d <= 3 && random(&mut s.rng) < 0.5 {
        let ns = s.sealed();
        if !ns.is_empty() {
            let n = pick(&mut s.rng, &ns).unwrap();
            open(s, n, false, None);
        }
    }
    if s.has(Shackles) && d >= 4 && random(&mut s.rng) < 0.4 {
        bestow(s)
    }
    if s.objective.id == ObjectiveId::Walk && !s.milestone {
        s.objective.progress = (s.objective.progress + d as i32).min(18);
        if s.objective.progress >= 18 {
            meet(s)
        }
    }
}
fn guard(s: &State, need: Phase) -> bool {
    s.phase != Phase::Ended
        && s.pending.is_empty()
        && s.chaining.is_none()
        && s.phase != Phase::Office
        && s.phase != Phase::Event
        && (if need == Phase::Patrol {
            s.phase == Phase::Patrol
        } else {
            s.phase != Phase::Patrol
        })
}
fn patrol(s: &mut State, n: usize) -> bool {
    if !guard(s, Phase::Patrol) || !s.destinations.contains(&n) {
        return false;
    }
    let ratway = s.ratway;
    s.ratway = false;
    let d = if ratway { 0 } else { steps(s.position, n) };
    if !ratway {
        s.stats.patrols += 1
    }
    let mut e = None;
    if s.chain && !ratway {
        for at in path(s, n) {
            open(s, at, false, None);
        }
        s.chain = false;
    } else if s.cells[n].sealed {
        e = open(s, n, true, None)
    }
    if e.is_none() && !s.cells[n].sealed && s.cells[n].inmate.is_some() {
        e = s.cells[n].event.take()
    }
    s.position = n;
    check_prey(s);
    if !ratway {
        walked(s, d)
    }
    spawn(s, s.params.event_walk_chance);
    if let Some(kind) = e.filter(|_| s.cells[n].inmate.is_some()) {
        s.phase = Phase::Event;
        s.event = Some(Event { kind, cell: n });
        count(s, ObjectiveId::Incident)
    } else {
        s.phase = if n == 0 { Phase::Office } else { Phase::Manage };
        if n == 0 && s.start_event == Some(StartEvent::Tyranny) {
            for _ in 0..3 {
                instigate(s);
                bestow(s)
            }
        }
    }
    true
}
fn resolve(s: &mut State, accept: bool) -> bool {
    if s.phase != Phase::Event || s.event.is_none() || !s.pending.is_empty() {
        return false;
    }
    let e = s.event.unwrap();
    let n = e.cell;
    if !accept {
        s.event = None;
        s.phase = Phase::Manage;
        return true;
    }
    use EventKind::*;
    match e.kind {
        Ratway => {
            s.event = None;
            s.phase = Phase::Patrol;
            s.ratway = true;
            s.destinations = (1..16).collect();
            return true;
        }
        Chain => s.chain = true,
        Trickster => {
            let Some(mut i) = s.cells[n].inmate else {
                return false;
            };
            let mut counts = [0; 4];
            for at in s.board() {
                counts[s.cells[at].inmate.unwrap().beast.index()] += 1
            }
            let low = *counts.iter().min().unwrap();
            let bs: Vec<_> = Beast::ALL
                .into_iter()
                .filter(|b| counts[b.index()] == low)
                .collect();
            i.beast = pick(&mut s.rng, &bs).unwrap();
            i.tier = 4;
            s.cells[n].inmate = Some(i);
            check_prey(s);
            growth(s, i);
        }
        Crow => {
            let mut done = 0;
            for d in 1..16 {
                let at = (n + d) % 16;
                if !s.cells[at].sealed || s.cells[at].nest.is_some() {
                    continue;
                }
                hidden(s, at);
                s.cells[at].known = s.cells[at].known.max(1);
                done += 1;
                if done == 4 {
                    break;
                }
            }
        }
        Hunt => {
            for at in 0..16 {
                if !s.cells[at].sealed || s.cells[at].nest.is_some() {
                    continue;
                }
                let i = hidden(s, at);
                if i.tier < 2 {
                    s.cells[at].known = s.cells[at].known.max(1)
                } else {
                    s.cells[at].at_least = s.cells[at].at_least.max(2)
                }
            }
        }
        Portion | Usurp1 | Usurp2 | Usurp3 | Usurp4 => {
            let pool: Vec<_> = s
                .board()
                .iter()
                .filter_map(|&n| s.cells[n].inmate.filter(|i| i.tier < 5))
                .collect();
            let (count, by, next) = match e.kind {
                Portion => (3, 1, None),
                Usurp1 => (1, 1, Some(Usurp2)),
                Usurp2 => (2, 1, Some(Usurp3)),
                Usurp3 => (2, 2, Some(Usurp4)),
                _ => (usize::MAX, 2, None),
            };
            let picked = if e.kind == Usurp4 {
                pool
            } else {
                shuffle(&mut s.rng, pool)
            };
            for i in picked.into_iter().take(count) {
                if s.board_cell_of(i.id).is_some() {
                    promote(s, i, by, false);
                }
            }
            if e.kind != Portion {
                s.event_pool.retain(|&id| id != e.kind);
                if let Some(next) = next {
                    if !s.event_pool.contains(&next) {
                        s.event_pool.push(next)
                    }
                    let ns = instigate_cells(s);
                    if !ns.is_empty() {
                        let at = pick(&mut s.rng, &ns).unwrap();
                        s.cells[at].event = Some(next);
                        s.cells[at].seen = true;
                    }
                }
            }
        }
        Freedom => {
            let ns = s.sealed();
            for at in shuffle(&mut s.rng, ns).into_iter().take(3) {
                open(s, at, false, None);
            }
        }
        Convict => {
            let ns = s.sealed();
            if !ns.is_empty() {
                let at = pick(&mut s.rng, &ns).unwrap();
                let weights: Vec<_> = s
                    .params
                    .tier_weights
                    .iter()
                    .enumerate()
                    .map(|(t, &w)| if t >= 3 { w } else { 0. })
                    .collect();
                let t = if weights.iter().any(|&w| w > 0.) {
                    pick_index(&mut s.rng, &weights) as i32
                } else {
                    3
                };
                let b = Beast::ALL[pick_index(&mut s.rng, &s.params.beast_weights)];
                open(s, at, false, Some((b, t)));
            }
        }
        Appetite => {
            let board = s.board();
            if let Some(low) = board.iter().map(|&n| s.cells[n].inmate.unwrap().tier).min() {
                let pool: Vec<_> = board
                    .into_iter()
                    .filter_map(|n| s.cells[n].inmate.filter(|i| i.tier == low))
                    .collect();
                let i = pick(&mut s.rng, &pool).unwrap();
                let mut gain = 0;
                for _ in 0..5 {
                    if random(&mut s.rng) < 0.5 {
                        gain += 1
                    }
                }
                if gain > 0 {
                    promote(s, i, gain, false);
                }
            }
        }
        Execution => {
            let Some(i) = s.cells[n].inmate else {
                return false;
            };
            let victims: Vec<_> = s
                .board()
                .into_iter()
                .filter(|&at| {
                    let m = s.cells[at].inmate.unwrap();
                    at != n
                        && diets(s, i.beast, None).contains(&m.beast)
                        && if s.params.execution_same_tier {
                            m.tier == i.tier
                        } else {
                            m.tier < i.tier
                        }
                })
                .collect();
            let count = victims.len();
            for at in victims {
                empty(s, at)
            }
            s.stats.executions += 1;
            check_prey(s);
            if count > 0 {
                promote(s, i, count as i32, s.params.execution_rerolls);
            }
        }
    }
    s.event = None;
    s.phase = Phase::Manage;
    true
}
fn do_devour(s: &mut State, from: usize, option: Meal, chained: bool) {
    let eater = s.cells[from].inmate.unwrap();
    let meal = if s.cells[option.cell].sealed {
        s.cells[option.cell].hidden.unwrap()
    } else {
        s.cells[option.cell].inmate.unwrap()
    };
    count(s, ObjectiveId::Consume);
    let crowd = s.board().len();
    empty(s, option.cell);
    let mut gain = if option.scratch {
        2 + s.params.scratch_stacks_base as i32
    } else {
        1
    };
    if !option.scratch && eater.beast == Mammoth && s.has(Maul) {
        gain = (meal.tier + 2 - eater.tier).max(1)
    }
    if s.has(Muzzle) && crowd <= 4 {
        gain += 2
    }
    if s.has(Skewer) && eater.beast == Rat {
        gain += 1
    }
    if s.has(Crown) && eater.beast == Lion {
        gain += 2
    }
    if s.has(Saw) && random(&mut s.rng) < 0.25 {
        gain += 1
    }
    if s.has(Whip) && random(&mut s.rng) < 0.35 {
        gain += 1
    }
    if chained && s.has(Collar) && random(&mut s.rng) < 0.8 {
        gain += 1
    }
    let revenge = s.has(Revenge) && random(&mut s.rng) < 0.3;
    let eater = promote(s, eater, gain, !s.fight());
    s.stats.devours += 1;
    check_prey(s);
    if revenge && s.board_cell_of(eater.id).is_some() {
        let ns = s.sealed();
        if !ns.is_empty() {
            let n = pick(&mut s.rng, &ns).unwrap();
            let foods = diets(s, eater.beast, Some(eater.tier));
            let b = pick(&mut s.rng, &foods).unwrap();
            open(s, n, false, Some((b, eater.tier)));
        }
    }
    if s.has(Cage) && s.cells[option.cell].sealed && random(&mut s.rng) < 0.4 {
        open(s, option.cell, false, None);
    }
}
fn go_chain(s: &mut State) {
    let id = s.chaining.as_ref().unwrap().eater;
    while let Some(n) = s.board_cell_of(id) {
        let ms = meals(s, n);
        if ms.is_empty() {
            break;
        }
        if ms.len() > 1 || s.params.chain_stop {
            return;
        }
        do_devour(s, n, ms[0], true);
        s.stats.chains += 1;
    }
    s.chaining = None;
}
fn swap(s: &mut State) -> bool {
    let n = s.position;
    if !guard(s, Phase::Manage)
        || s.cells[n].sealed
        || s.cells[n].inmate.is_none()
        || s.used.devour > 0
        || s.used.swap >= s.params.swaps_per_day
        || s.used.no_swap
    {
        return false;
    }
    let mut weights = s.params.swap_weights.clone();
    if s.has(Rope) {
        weights[0] = 0.;
        weights[1] = 0.
    }
    if !weights.iter().any(|&w| w > 0.) {
        return false;
    }
    let old = s.cells[n].inmate.unwrap();
    let others: Vec<_> = s
        .board()
        .into_iter()
        .filter_map(|at| s.cells[at].inmate.filter(|i| i.id != old.id))
        .collect();
    let level = s.has(Maiden)
        && others.iter().filter(|i| i.tier > old.tier).count()
            == others.iter().filter(|i| i.tier < old.tier).count();
    s.cells[n].inmate = None;
    check_prey(s);
    let mut above = false;
    if s.has(Scapegoat) {
        let others = s.board();
        if others.len() >= 2 {
            for at in shuffle(&mut s.rng, others).into_iter().take(2) {
                empty(s, at)
            }
            check_prey(s);
            above = true
        }
    }
    let higher: Vec<_> = weights
        .iter()
        .enumerate()
        .map(|(t, &w)| if t as i32 > old.tier { w } else { 0. })
        .collect();
    let mut fresh = roll(
        s,
        if above && higher.iter().any(|&w| w > 0.) {
            &higher
        } else {
            &weights
        },
    );
    if above && fresh.tier <= old.tier {
        fresh.tier = (old.tier + 1).min(5)
    }
    if s.has(Stake) && old.tier < 3 && random(&mut s.rng) < 0.4 && fresh.tier != 3 {
        fresh.tier = 3
    }
    if s.params.swap_new_beast && fresh.beast == old.beast {
        let others: Vec<_> = Beast::ALL.into_iter().filter(|&b| b != old.beast).collect();
        let weights: Vec<_> = others
            .iter()
            .map(|b| s.params.beast_weights[b.index()])
            .collect();
        fresh.beast = others[pick_index(&mut s.rng, &weights)];
    }
    if s.has(Pestle) {
        fresh.beast = old.beast
    }
    s.cells[n].inmate = Some(fresh);
    s.used.swap += 1;
    s.stats.swaps += 1;
    if level {
        fresh = promote(s, fresh, 3, false)
    }
    fresh = growth(s, fresh);
    if s.has(Axe) && fresh.tier > old.tier {
        let ns = s.sealed();
        for at in shuffle(&mut s.rng, ns).into_iter().take(2) {
            open(s, at, false, None);
        }
    }
    if s.has(Scales) && random(&mut s.rng) < 0.8 {
        scout(s)
    }
    if s.cells[n].ivory && s.board_cell_of(fresh.id).is_some() {
        let pool: Vec<_> = s
            .board()
            .into_iter()
            .filter_map(|at| {
                s.cells[at]
                    .inmate
                    .filter(|i| s.params.ivory_includes_swapped || i.id != fresh.id)
            })
            .collect();
        for who in shuffle(&mut s.rng, pool)
            .into_iter()
            .take(s.params.ivory_count)
        {
            if s.board_cell_of(who.id).is_some() {
                promote(s, who, 1, false);
            }
        }
    }
    true
}
fn scout(s: &mut State) {
    let ns: Vec<_> = s
        .sealed()
        .into_iter()
        .filter(|&n| s.cells[n].nest.is_none())
        .collect();
    if ns.is_empty() {
        return;
    }
    for &n in &ns {
        hidden(s, n);
    }
    let top = ns
        .iter()
        .map(|&n| s.cells[n].hidden.unwrap().tier)
        .max()
        .unwrap();
    let pool: Vec<_> = ns
        .into_iter()
        .filter(|&n| s.cells[n].hidden.unwrap().tier == top)
        .collect();
    let n = pick(&mut s.rng, &pool).unwrap();
    s.cells[n].known = 2;
}
fn gift(s: &mut State, id: Id) {
    match id {
        Ring => {
            let ns = s.sealed();
            for n in shuffle(&mut s.rng, ns).into_iter().take(3) {
                open(s, n, false, None);
            }
        }
        Horn => {
            let ids: Vec<_> = s
                .board()
                .into_iter()
                .filter(|&n| !meals(s, n).is_empty())
                .map(|n| s.cells[n].inmate.unwrap().id)
                .collect();
            for id in ids {
                let Some(n) = s.board_cell_of(id) else {
                    continue;
                };
                let ms: Vec<_> = meals(s, n).into_iter().filter(|m| !m.scratch).collect();
                if !ms.is_empty() {
                    let m = pick(&mut s.rng, &ms).unwrap();
                    do_devour(s, n, m, false);
                }
            }
        }
        Wine => {
            let pool: Vec<_> = s
                .board()
                .into_iter()
                .filter_map(|n| s.cells[n].inmate.filter(|i| i.tier < 3))
                .collect();
            for i in pool {
                if s.board_cell_of(i.id).is_some() {
                    promote(s, i, 1, false);
                }
            }
        }
        Brand => {
            let pool: Vec<_> = s
                .board()
                .into_iter()
                .filter(|&n| meals(s, n).is_empty())
                .map(|n| s.cells[n].inmate.unwrap())
                .collect();
            for i in shuffle(&mut s.rng, pool).into_iter().take(4) {
                let Some(n) = s.board_cell_of(i.id) else {
                    continue;
                };
                if !meals(s, n).is_empty() {
                    continue;
                }
                let bs: Vec<_> = Beast::ALL
                    .into_iter()
                    .filter(|&b| {
                        s.board().iter().any(|&at| {
                            can_eat(s, Inmate { beast: b, ..i }, s.cells[at].inmate.unwrap())
                        })
                    })
                    .collect();
                if !bs.is_empty() {
                    s.cells[n].inmate.as_mut().unwrap().beast = pick(&mut s.rng, &bs).unwrap();
                }
            }
            check_prey(s);
        }
        _ => {}
    }
}
fn choose(s: &mut State, id: Id) -> bool {
    if !s.pending.first().is_some_and(|p| p.options.contains(&id)) {
        return false;
    }
    let choice = s.pending.remove(0);
    if choice.kind == ChoiceKind::Gift {
        gift(s, id)
    } else {
        s.tools.push(id);
        if s.phase == Phase::Patrol {
            s.destinations.truncate(destination_limit(s));
        }
    }
    if s.phase == Phase::Event && s.event.is_some_and(|e| s.cells[e.cell].inmate.is_none()) {
        s.event = None;
        s.phase = Phase::Manage
    }
    true
}
pub fn apply(s: &mut State, action: &Action) -> bool {
    let following = match (action, s.phase, s.event) {
        (Action::Event { accept }, Phase::Event, Some(event)) => Some((event.kind, *accept)),
        _ => None,
    };
    let acted = matches!(
        action,
        Action::Event { .. }
            | Action::Devour { .. }
            | Action::Chain { .. }
            | Action::Stopchain
            | Action::Swap
            | Action::Hunt { .. }
    );
    let ok = match *action {
        Action::Choose { id } => choose(s, id),
        Action::Reroll => {
            if !can_reroll(s) {
                false
            } else {
                let offered = s.pending[0].options.clone();
                let mut pool: Vec<_> = Id::TOOLS
                    .into_iter()
                    .filter(|&id| !s.has(id) && !offered.contains(&id))
                    .collect();
                if pool.len() < 3 {
                    pool = Id::TOOLS.into_iter().filter(|&id| !s.has(id)).collect()
                }
                let options = draw_tools(s, pool, 3);
                s.pending[0].options = options;
                s.pending[0].rerolls -= 1;
                true
            }
        }
        Action::Event { accept } => resolve(s, accept),
        Action::Patrol { cell } => patrol(s, cell),
        Action::Devour { to } => {
            if !guard(s, Phase::Manage) || !s.can_devour() {
                false
            } else if let Some(m) = start_options(s).into_iter().find(|m| m.cell == to) {
                s.used.devour += 1;
                s.used.meal_only = None;
                s.chaining = Some(Chaining {
                    eater: s.cells[s.position].inmate.unwrap().id,
                });
                do_devour(s, s.position, m, false);
                go_chain(s);
                true
            } else {
                false
            }
        }
        Action::Chain { to } => {
            if !s.pending.is_empty() {
                false
            } else if let Some(m) = chain_options(s).into_iter().find(|m| m.cell == to) {
                let n = s.board_cell_of(s.chaining.as_ref().unwrap().eater).unwrap();
                s.used.meal_only = None;
                do_devour(s, n, m, true);
                s.stats.chains += 1;
                go_chain(s);
                true
            } else {
                false
            }
        }
        Action::Stopchain => {
            if s.chaining.is_some() && s.params.chain_stop && s.pending.is_empty() {
                s.chaining = None;
                true
            } else {
                false
            }
        }
        Action::Office { choice } => {
            if s.phase != Phase::Office
                || !s.pending.is_empty()
                || s.used.office_only.is_some_and(|c| c != choice)
            {
                false
            } else {
                match choice {
                    Office::Instigate => instigate(s),
                    Office::Bestow => bestow(s),
                }
                s.phase = Phase::Manage;
                true
            }
        }
        Action::Swap => swap(s),
        Action::Hunt { to } => {
            if !guard(s, Phase::Manage)
                || s.used.devour > 0
                || s.used.swap > 0
                || s.used.hunt > 0
                || s.used.no_hunt
                || !hunt_targets(s).contains(&to)
            {
                false
            } else {
                let a = s.cells[s.position].inmate.unwrap();
                let b = s.cells[to].inmate.unwrap();
                s.used.hunt = 1;
                s.prey.push(Prey {
                    lion: a.id,
                    prey: b.id,
                    prey_beast: b.beast,
                    rounds: s.params.prey_rounds,
                    next: s.day + 1,
                });
                true
            }
        }
        Action::End => {
            if !guard(s, Phase::Manage) {
                false
            } else {
                if s.day >= s.max_days {
                    s.phase = Phase::Ended;
                    s.destinations.clear();
                    s.event = None;
                    s.chain = false
                } else {
                    s.day += 1;
                    begin_day(s)
                }
                true
            }
        }
    };
    if ok
        && following.is_some_and(|(kind, accept)| {
            !(accept
                && matches!(
                    kind,
                    EventKind::Usurp1 | EventKind::Usurp2 | EventKind::Usurp3
                ))
        })
    {
        follow_event(s);
    }
    if ok && acted && s.chaining.is_none() {
        spawn(s, s.params.event_action_chance)
    }
    ok
}
pub fn candidates(s: &State) -> Vec<Action> {
    if s.phase == Phase::Ended {
        return vec![];
    }
    if let Some(p) = s.pending.first() {
        let mut out: Vec<_> = p.options.iter().map(|&id| Action::Choose { id }).collect();
        if can_reroll(s) {
            out.push(Action::Reroll)
        }
        return out;
    }
    if s.chaining.is_some() {
        let mut out: Vec<_> = chain_options(s)
            .into_iter()
            .map(|m| Action::Chain { to: m.cell })
            .collect();
        if s.params.chain_stop {
            out.push(Action::Stopchain)
        }
        return out;
    }
    if s.phase == Phase::Office {
        return [Office::Bestow, Office::Instigate]
            .into_iter()
            .filter(|&c| s.used.office_only.is_none_or(|only| c == only))
            .map(|choice| Action::Office { choice })
            .collect();
    }
    if s.phase == Phase::Event && s.event.is_some() {
        return if s.event.unwrap().kind == EventKind::Hunt {
            vec![Action::Event { accept: true }]
        } else {
            vec![
                Action::Event { accept: true },
                Action::Event { accept: false },
            ]
        };
    }
    if s.phase == Phase::Patrol {
        return s
            .destinations
            .iter()
            .map(|&cell| Action::Patrol { cell })
            .collect();
    }
    let mut out: Vec<_> = start_options(s)
        .into_iter()
        .map(|m| Action::Devour { to: m.cell })
        .collect();
    if s.can_swap() && !s.cells[s.position].sealed && s.cells[s.position].inmate.is_some() {
        out.push(Action::Swap)
    }
    if can_hunt(s) {
        out.extend(hunt_targets(s).into_iter().map(|to| Action::Hunt { to }))
    }
    out.push(Action::End);
    out
}
pub fn hide_future(s: &mut State, seed: u32) {
    let mut rng = seed;
    s.rng = (random(&mut rng) * 4294967296.) as u32;
    if s.initial_inmates_pending {
        s.initial_inmates_pending = false;
        if s.day == 1
            && s.position == 0
            && s.tools.is_empty()
            && s.cells.iter().all(|c| {
                c.n == 0
                    || (c.sealed
                        && c.inmate.is_none()
                        && c.hidden.is_none()
                        && c.event.is_none()
                        && c.nest.is_none()
                        && !c.scratch
                        && c.at_least == 0)
            })
        {
            spawn(s, s.params.event_start_chance);
            let mut world = seed ^ 0x243f6a88;
            let count = s.params.start_inmates.saturating_sub(
                (random(&mut world) * 100. < s.params.start_inmates_fewer) as usize,
            );
            let free: Vec<_> = s
                .cells
                .iter()
                .filter(|c| c.n != 0 && c.sealed && c.event.is_none())
                .map(|c| c.n)
                .collect();
            for n in shuffle(&mut world, free).into_iter().take(count) {
                let b = Beast::ALL[pick_index(&mut world, &s.params.beast_weights)];
                let tier = pick_index(&mut world, &s.params.start_weights) as i32;
                let inmate = make(s, b, tier);
                s.cells[n] = Cell {
                    n,
                    sealed: false,
                    inmate: Some(inmate),
                    event_known: true,
                    ..Cell::default()
                };
                s.stats.best = s.stats.best.max(tier);
            }
            begin_day(s);
        }
    }
    for c in &mut s.cells {
        if c.event.is_some() && !c.event_known {
            c.event = pick(&mut rng, &s.event_pool)
        }
        if !c.sealed || c.hidden.is_none() || c.known >= 2 {
            continue;
        }
        if c.known == 1 {
            c.hidden.as_mut().unwrap().beast = Beast::ALL[(random(&mut rng) * 4.) as usize]
        } else {
            c.hidden = None
        }
    }
}
