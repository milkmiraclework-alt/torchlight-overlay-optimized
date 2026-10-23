use serde::{Deserialize, Serialize};
use std::sync::Arc;

macro_rules! symbols {
    ($name:ident { $($variant:ident => $text:literal),+ $(,)? }) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
        pub enum $name { $(#[serde(rename = $text)] $variant),+ }
    }
}
symbols!(Beast { Mammoth => "mammoth", Lion => "lion", Wolf => "wolf", Rat => "rat" });
impl Beast {
    pub const ALL: [Self; 4] = [Self::Mammoth, Self::Lion, Self::Wolf, Self::Rat];
    pub fn index(self) -> usize {
        self as usize
    }
}
impl Default for Beast {
    fn default() -> Self {
        Self::Mammoth
    }
}
symbols!(Id {
    Revenge => "revenge", Muzzle => "muzzle", Saw => "saw", Keys => "keys", Rope => "rope", Fire => "fire",
    Ironbox => "ironbox", Skewer => "skewer", Hook => "hook", Pestle => "pestle", Scales => "scales",
    Tongs => "tongs", Guillotine => "guillotine", Axe => "axe", Shackles => "shackles", Collar => "collar",
    Forged => "forged", Dogtag => "dogtag", Cage => "cage", Blacklist => "blacklist", Shortchain => "shortchain",
    Maiden => "maiden", Whip => "whip", Ravenous => "ravenous", Scapegoat => "scapegoat", Stake => "stake",
    Coin => "coin", Crown => "crown", Maul => "maul", Claws => "claws", Trap => "trap",
    Ring => "ring", Horn => "horn", Wine => "wine", Brand => "brand"
});
impl Id {
    pub const TOOLS: [Self; 31] = [
        Self::Revenge,
        Self::Muzzle,
        Self::Saw,
        Self::Keys,
        Self::Rope,
        Self::Fire,
        Self::Ironbox,
        Self::Skewer,
        Self::Hook,
        Self::Pestle,
        Self::Scales,
        Self::Tongs,
        Self::Guillotine,
        Self::Axe,
        Self::Shackles,
        Self::Collar,
        Self::Forged,
        Self::Dogtag,
        Self::Cage,
        Self::Blacklist,
        Self::Shortchain,
        Self::Maiden,
        Self::Whip,
        Self::Ravenous,
        Self::Scapegoat,
        Self::Stake,
        Self::Coin,
        Self::Crown,
        Self::Maul,
        Self::Claws,
        Self::Trap,
    ];
    pub const GIFTS: [Self; 4] = [Self::Ring, Self::Horn, Self::Wine, Self::Brand];
    pub fn beast_tool(self) -> bool {
        matches!(
            self,
            Self::Trap
                | Self::Crown
                | Self::Maul
                | Self::Tongs
                | Self::Claws
                | Self::Guillotine
                | Self::Skewer
                | Self::Ironbox
        )
    }
}
symbols!(EventKind { Chain => "chain", Execution => "execution", Trickster => "trickster", Appetite => "appetite",
    Convict => "convict", Crow => "crow", Freedom => "freedom", Usurp1 => "usurp1", Usurp2 => "usurp2",
    Usurp3 => "usurp3", Usurp4 => "usurp4", Ratway => "ratway", Hunt => "hunt", Portion => "portion" });
impl EventKind {
    pub const POOL: [Self; 11] = [
        Self::Chain,
        Self::Execution,
        Self::Trickster,
        Self::Appetite,
        Self::Convict,
        Self::Crow,
        Self::Freedom,
        Self::Usurp1,
        Self::Ratway,
        Self::Hunt,
        Self::Portion,
    ];
}
symbols!(Phase { Patrol => "patrol", Manage => "manage", Office => "office", Event => "event", Ended => "ended" });
impl Default for Phase {
    fn default() -> Self {
        Self::Patrol
    }
}
symbols!(StartEvent { Cagefight => "cagefight", Ironlaw => "ironlaw", Tyranny => "tyranny", Opulence => "opulence" });
symbols!(ObjectiveId { King => "king", Walk => "walk", Consume => "consume", Incident => "incident", Doors => "doors", Other => "other" });
impl Default for ObjectiveId {
    fn default() -> Self {
        Self::King
    }
}
impl ObjectiveId {
    pub fn need(self) -> i32 {
        match self {
            Self::Walk => 18,
            Self::Consume => 4,
            Self::Incident => 2,
            Self::Doors => 10,
            _ => 0,
        }
    }
}
symbols!(Office { Bestow => "bestow", Instigate => "instigate" });
symbols!(ChoiceKind { Tool => "tool", Gift => "gift" });

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Params {
    pub drill_days: i32,
    pub destinations: usize,
    pub patrol_range: usize,
    pub event_two_doors: bool,
    pub fewer_doors_chance: f64,
    pub swaps_per_day: i32,
    pub reusable_cells: bool,
    pub chain_stop: bool,
    pub tier_weights: Vec<f64>,
    pub swap_weights: Vec<f64>,
    pub swap_new_beast: bool,
    pub beast_weights: Vec<f64>,
    pub start_inmates: usize,
    pub start_inmates_fewer: f64,
    pub start_weights: Vec<f64>,
    pub office_door_odds: f64,
    pub double_eat_tier: i32,
    pub event_start_chance: f64,
    pub event_follow_chance: f64,
    pub event_morning_chance: f64,
    pub event_walk_chance: f64,
    pub event_action_chance: f64,
    pub execution_same_tier: bool,
    pub execution_rerolls: bool,
    pub ivory_count: usize,
    pub ivory_includes_swapped: bool,
    pub prey_rounds: i32,
    pub scratch_stacks_base: bool,
    pub nest_days: i32,
    pub nest_tier: i32,
    pub rewards: bool,
    pub start_tools: usize,
    pub beast_tool_odds: f64,
}
impl Default for Params {
    fn default() -> Self {
        Self {
            drill_days: 20,
            destinations: 3,
            patrol_range: 6,
            event_two_doors: false,
            fewer_doors_chance: 0.,
            swaps_per_day: 1,
            reusable_cells: true,
            chain_stop: true,
            tier_weights: vec![40., 38., 12., 8., 2.],
            swap_weights: vec![42., 34., 11.5, 9.5, 2.5],
            swap_new_beast: true,
            beast_weights: vec![25.; 4],
            start_inmates: 4,
            start_inmates_fewer: 5.,
            start_weights: vec![44.5, 35., 10.5, 8., 2.],
            office_door_odds: 37.,
            double_eat_tier: 0,
            event_start_chance: 72.,
            event_follow_chance: 88.,
            event_morning_chance: 0.,
            event_walk_chance: 0.,
            event_action_chance: 0.,
            execution_same_tier: false,
            execution_rerolls: false,
            ivory_count: 4,
            ivory_includes_swapped: true,
            prey_rounds: 3,
            scratch_stacks_base: true,
            nest_days: 2,
            nest_tier: 2,
            rewards: true,
            start_tools: 1,
            beast_tool_odds: 12.,
        }
    }
}
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Inmate {
    pub id: u32,
    pub beast: Beast,
    pub tier: i32,
    #[serde(skip_serializing_if = "is_false")]
    pub marked: bool,
}
fn is_false(v: &bool) -> bool {
    !*v
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Nest {
    pub due: i32,
}
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Cell {
    pub n: usize,
    pub sealed: bool,
    pub inmate: Option<Inmate>,
    pub hidden: Option<Inmate>,
    pub known: i32,
    pub at_least: i32,
    pub scratch: bool,
    pub nest: Option<Nest>,
    pub event: Option<EventKind>,
    pub ivory: bool,
    pub seen: bool,
    #[serde(default = "yes")]
    pub event_known: bool,
}
fn yes() -> bool {
    true
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Vault {
    pub id: u32,
    pub beast: Beast,
    pub day: i32,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prey {
    pub lion: u32,
    pub prey: u32,
    pub prey_beast: Beast,
    pub rounds: i32,
    pub next: i32,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Event {
    pub kind: EventKind,
    pub cell: usize,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Used {
    pub swap: i32,
    pub devour: i32,
    pub hunt: i32,
    pub no_devour: bool,
    pub no_swap: bool,
    pub no_hunt: bool,
    pub devour_after_swap: bool,
    pub hunt_only: Option<Vec<usize>>,
    pub meal_only: Option<Vec<usize>>,
    pub office_only: Option<Office>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Choice {
    pub kind: ChoiceKind,
    pub options: Vec<Id>,
    #[serde(default)]
    pub rerolls: i32,
    #[serde(default)]
    pub start: bool,
}
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Objective {
    pub id: ObjectiveId,
    pub progress: i32,
}
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Stats {
    pub patrols: i32,
    pub opened: i32,
    pub devours: i32,
    pub chains: i32,
    pub swaps: i32,
    pub executions: i32,
    pub best: i32,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Chaining {
    pub eater: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    #[serde(default, skip_serializing_if = "is_false")]
    pub initial_inmates_pending: bool,
    pub rng: u32,
    pub params: Arc<Params>,
    pub day: i32,
    pub max_days: i32,
    pub start_event: Option<StartEvent>,
    pub phase: Phase,
    pub position: usize,
    pub destinations: Vec<usize>,
    pub chain: bool,
    pub event: Option<Event>,
    pub cells: [Cell; 16],
    pub vault: Vec<Vault>,
    pub cache: i32,
    pub tools: Vec<Id>,
    pub pending: Vec<Choice>,
    pub objective: Objective,
    pub milestone: bool,
    pub used: Used,
    pub chaining: Option<Chaining>,
    #[serde(default = "event_pool")]
    pub event_pool: Vec<EventKind>,
    pub prey: Vec<Prey>,
    pub next_id: u32,
    pub stats: Stats,
    #[serde(default)]
    pub ratway: bool,
    #[serde(default)]
    pub dest_base: usize,
}
fn event_pool() -> Vec<EventKind> {
    EventKind::POOL.to_vec()
}
impl State {
    #[inline]
    pub fn has(&self, id: Id) -> bool {
        self.tools.contains(&id)
    }
    pub fn fight(&self) -> bool {
        self.start_event == Some(StartEvent::Cagefight)
    }
    pub fn board(&self) -> Vec<usize> {
        self.cells
            .iter()
            .filter(|c| !c.sealed && c.inmate.is_some())
            .map(|c| c.n)
            .collect()
    }
    pub fn sealed(&self) -> Vec<usize> {
        self.cells
            .iter()
            .filter(|c| c.sealed)
            .map(|c| c.n)
            .collect()
    }
    pub fn cell_of(&self, id: u32) -> Option<usize> {
        self.cells
            .iter()
            .position(|c| c.inmate.is_some_and(|i| i.id == id))
    }
    pub fn board_cell_of(&self, id: u32) -> Option<usize> {
        self.cell_of(id).filter(|&n| !self.cells[n].sealed)
    }
    pub fn link_of(&self, id: u32) -> Option<&Prey> {
        self.prey.iter().find(|p| p.lion == id || p.prey == id)
    }
    pub fn can_devour(&self) -> bool {
        self.used.devour < 1
            && self.used.hunt == 0
            && !self.used.no_devour
            && (self.used.swap < 1 || self.used.devour_after_swap)
    }
    pub fn can_swap(&self) -> bool {
        self.used.devour < 1
            && self.used.hunt == 0
            && !self.used.no_swap
            && self.used.swap < self.params.swaps_per_day
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Meal {
    pub cell: usize,
    pub scratch: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Action {
    Choose { id: Id },
    Reroll,
    Event { accept: bool },
    Patrol { cell: usize },
    Devour { to: usize },
    Chain { to: usize },
    Stopchain,
    Office { choice: Office },
    Swap,
    Hunt { to: usize },
    End,
}

#[inline]
pub fn random(rng: &mut u32) -> f64 {
    *rng = rng.wrapping_add(0x6d2b79f5);
    let mut t = *rng;
    t = (t ^ (t >> 15)).wrapping_mul(t | 1);
    t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
    (t ^ (t >> 14)) as f64 / 4294967296.
}
pub fn pick_index(rng: &mut u32, weights: &[f64]) -> usize {
    let total = weights.iter().fold(0., |a, w| a + w.max(0.));
    if total <= 0. {
        return 0;
    }
    let mut r = random(rng) * total;
    for (i, w) in weights.iter().enumerate() {
        r -= w.max(0.);
        if r < 0. {
            return i;
        }
    }
    weights.len().saturating_sub(1)
}
pub fn pick<T: Copy>(rng: &mut u32, list: &[T]) -> Option<T> {
    // JavaScript pickOne consumes a random draw even for an empty list.
    let at = (random(rng) * list.len() as f64).floor() as usize;
    list.get(at).copied()
}
pub fn shuffle<T>(rng: &mut u32, mut list: Vec<T>) -> Vec<T> {
    for i in (1..list.len()).rev() {
        let j = (random(rng) * (i + 1) as f64).floor() as usize;
        list.swap(i, j);
    }
    list
}
pub fn steps(from: usize, to: usize) -> usize {
    (to + 16 - from) % 16
}
