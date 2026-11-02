//! Visible transitions supplement state that a single screenshot cannot show.
//! Never assumes that the player followed the previous recommendation.
use crate::advisor::{RunContext, ScreenPhase, ScreenState};
use crate::data::{data, Targeting};

fn kit_size(id: u8) -> Option<usize> {
    data()
        .potions
        .iter()
        .find(|p| p.id == id)
        .and_then(|p| match p.targeting {
            Targeting::Box(n) => Some(n as usize),
            _ => None,
        })
}
fn has_kit(x: &ScreenState) -> bool {
    x.hand.iter().any(|n| {
        data()
            .potion_by_name(n)
            .is_some_and(|id| kit_size(id).is_some())
    })
}
fn same_board(a: &ScreenState, b: &ScreenState) -> bool {
    a.tanks.len() == b.tanks.len()
        && a.tanks.iter().zip(&b.tanks).all(|(a, b)| match (a, b) {
            (None, None) => true,
            (Some(a), Some(b)) => {
                a.archetype == b.archetype
                    && a.rarity == b.rarity
                    && a.activity == b.activity
                    && a.quantity == b.quantity
            }
            _ => false,
        })
        && a.instruments == b.instruments
}

pub fn enrich(current: &mut ScreenState, previous: Option<&ScreenState>, transition_sure: bool) {
    if current.context.is_some() {
        return;
    }
    let mut open_box = None;
    if current.phase == ScreenPhase::Potion && !has_kit(current) {
        // The ordinary offer has three cards. A complete five-card hand is a
        // large kit even when the application was opened midway through it.
        if current.hand.len() == 5 {
            open_box = data()
                .potions
                .iter()
                .find(|p| matches!(p.targeting, Targeting::Box(5)))
                .map(|p| p.id);
        } else if let Some(old) =
            previous.filter(|p| p.phase == ScreenPhase::Potion && p.round == current.round)
        {
            let carry = old
                .context
                .as_ref()
                .and_then(|c| c.open_box)
                .filter(|id| kit_size(*id) == Some(current.hand.len()));
            if carry.is_some()
                && same_board(old, current)
                && current.potion_refreshes <= old.potion_refreshes
                && (transition_sure
                    || old.hand == current.hand && old.potion_refreshes == current.potion_refreshes)
            {
                open_box = carry;
            } else if transition_sure
                && same_board(old, current)
                && old.potion_refreshes.is_some()
                && old.potion_refreshes == current.potion_refreshes
                && old.hand != current.hand
            {
                open_box = old
                    .hand
                    .iter()
                    .filter_map(|n| data().potion_by_name(n))
                    .find(|id| kit_size(*id) == Some(current.hand.len()));
            }
        }
    }
    current.context = Some(RunContext::infer(current, open_box));
}
