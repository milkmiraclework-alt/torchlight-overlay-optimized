//! The cards' printed names (src/solver/scan/titles.ts), read by a text reader (OCR) and matched to the known
//! names. A clearly read name outranks the picture match; when two names fit about as well, the picture picks
//! between them; when nothing is read, the picture's answer stands.

use crate::cards::read_at;
use crate::data::ScanData;
use crate::layout::{card_face, layout_at, CardPos};
use crate::pixels::{clamp_u8, patch, Img, Rect};
use crate::reading::{FieldRead, Fields, Problem, Reading};
use std::collections::HashMap;

const MIN_Q: f64 = 6.0;
const GAP: f64 = 3.0;

fn letters(t: &str) -> Vec<char> {
    t.to_lowercase().chars().filter(|c| c.is_ascii_lowercase()).collect()
}

/// For each start of p, the fewest edits that match it somewhere inside t.
fn prefix_costs(p: &[char], t: &[char]) -> Vec<usize> {
    let mut prev = vec![0usize; t.len() + 1];
    let mut best = vec![0];
    for i in 1..=p.len() {
        let mut row = vec![i; t.len() + 1];
        for j in 1..=t.len() {
            row[j] = (prev[j] + 1).min(row[j - 1] + 1).min(prev[j - 1] + usize::from(p[i - 1] != t[j - 1]));
        }
        best.push(*row.iter().min().unwrap());
        prev = row;
    }
    best
}

/// How much of a name the text shows: its letters matched, less two per mistake, less a half per missing letter at its end.
pub fn name_fit(name: &str, text: &str) -> f64 {
    let p = letters(name);
    let t = letters(text);
    if t.is_empty() {
        return f64::NEG_INFINITY;
    }
    let c = prefix_costs(&p, &t);
    let mut q = f64::NEG_INFINITY;
    for i in p.len().min(6)..=p.len() {
        q = q.max(i as f64 - 2.0 * c[i] as f64 - 0.5 * (p.len() - i) as f64);
    }
    q
}

const TITLE_AREA: Rect = Rect::new(-140.0, -110.0, 280.0, 150.0);
const ZOOM: f64 = 2.0;
const BLUR: usize = 8;

/// A card's title area, straightened and enlarged, as dark text on white.
pub fn title_crop(img: &Img, c: &CardPos, k: f64) -> Img {
    let r = Rect::new(TITLE_AREA.x * ZOOM, TITLE_AREA.y * ZOOM, TITLE_AREA.w * ZOOM, TITLE_AREA.h * ZOOM);
    let p = patch(img, c.cx, c.cy, c.angle, r, k / ZOOM);
    let (w, h) = (p.width, p.height);
    let g: Vec<f32> = (0..w * h).map(|i| p.data[i * 4].max(p.data[i * 4 + 1]).max(p.data[i * 4 + 2]) as f32).collect();
    let mut sum = vec![0f64; (w + 1) * (h + 1)];
    for y in 0..h {
        for x in 0..w {
            sum[(y + 1) * (w + 1) + x + 1] = g[y * w + x] as f64 + sum[y * (w + 1) + x + 1] + sum[(y + 1) * (w + 1) + x] - sum[y * (w + 1) + x];
        }
    }
    let mut lift = vec![0f32; w * h];
    let mut top = 1.0f64;
    for y in 0..h {
        for x in 0..w {
            let (x0, x1, y0, y1) = (x.saturating_sub(BLUR), w.min(x + BLUR + 1), y.saturating_sub(BLUR), h.min(y + BLUR + 1));
            let mean = (sum[y1 * (w + 1) + x1] - sum[y0 * (w + 1) + x1] - sum[y1 * (w + 1) + x0] + sum[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0)) as f64;
            lift[y * w + x] = (g[y * w + x] as f64 - mean).max(0.0) as f32;
            top = top.max(lift[y * w + x] as f64);
        }
    }
    let mut out = Img::new(w, h);
    for i in 0..w * h {
        let v = clamp_u8(255.0 - (lift[i] as f64 / top * 400.0).min(255.0));
        out.data[i * 4] = v;
        out.data[i * 4 + 1] = v;
        out.data[i * 4 + 2] = v;
        out.data[i * 4 + 3] = 255;
    }
    out
}

/// A second, title-only exposure. The broad upstream crop includes the bottle and
/// description; on a small, overlapping fan these can confuse Windows OCR.
/// Keep this off the normal path and don't reuse its pixels as artwork evidence.
fn focused_title_crop(img: &Img, c: &CardPos, k: f64) -> Img {
    const Z: f64 = 3.0;
    let mut p = patch(img, c.cx, c.cy, c.angle, Rect::new(-115.0 * Z, -60.0 * Z, 230.0 * Z, 65.0 * Z), k / Z);
    for pixel in p.data.chunks_exact_mut(4) {
        // Titles are pale/neutral. The maximum channel turns a saturated red
        // Ultimate card's background into dark OCR ink, hiding its white name.
        // The shared channel keeps pale letters and suppresses coloured panels.
        let gray = pixel[0].min(pixel[1]).min(pixel[2]) as f64;
        let v = clamp_u8(255.0 - ((gray - 45.0) * 2.0).clamp(0.0, 255.0));
        pixel.copy_from_slice(&[v, v, v, 255]);
    }
    p
}

/// Recover a missing middle of a long title only when its first and last words
/// are both intact and identify exactly one known card. Never settle on a lone
/// creature name ("Sentry") or a shared prefix ("Twin Hormone").
fn anchored_title(data: &ScanData, phase: &str, text: &str) -> Option<String> {
    let words = |s: &str| -> Vec<String> {
        s.to_ascii_lowercase().split(|c: char| !c.is_ascii_alphabetic())
            .filter(|w| !w.is_empty()).map(str::to_owned).collect()
    };
    let read = words(text);
    let first = read.first()?;
    let mut matched = names_for(data, phase).iter().filter(|name| {
        let title = words(name);
        title.len() >= 3 && title.first() == Some(first)
            && first.len() >= 4 && title.last().is_some_and(|last| {
                last.len() >= 4 && first.len() + last.len() >= 10
                    && read.last() == Some(last)
            })
    });
    let name = matched.next()?.clone();
    matched.next().is_none().then_some(name)
}

// The English client uses this printed title for the model's Purest Holy
// Water. Keep client-name aliases at the live OCR boundary, not in rule data
// or the upstream-compatible reader. Require the complete title.
fn live_title_alias(data: &ScanData, phase: &str, text: &str) -> Option<String> {
    if phase != "potion" { return None; }
    let mut title = String::new();
    for line in text.lines().take(2) {
        title.extend(letters(line));
        if title == "theholiestwater" {
            return data.names.potion.iter().find(|name| name.as_str() == "Purest Holy Water").cloned();
        }
    }
    None
}

fn names_for<'a>(data: &'a ScanData, phase: &str) -> &'a [String] {
    match phase {
        "potion" => &data.names.potion,
        "instrument" => &data.names.instrument,
        _ => &data.names.protocol,
    }
}

fn ranked(data: &ScanData, phase: &str, text: &str) -> Vec<(String, f64)> {
    let mut r: Vec<(String, f64)> = names_for(data, phase).iter().map(|n| (n.clone(), name_fit(n, text))).collect();
    r.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    r
}

fn settled(r: &[(String, f64)]) -> bool {
    r[0].1 >= MIN_Q && r[0].1 - r.get(1).map_or(f64::NEG_INFINITY, |x| x.1) >= GAP
}

/// Some of a hand's cards matched by their pictures: per position, the best few cards, its field, and whether
/// no picture was close enough.
#[derive(Clone, Debug)]
pub struct PictureRead {
    pub ranks: Vec<(String, f64)>,
    pub field: Option<FieldRead>,
    pub unknown: bool,
}

/// The pictures of the given card positions, read as the reading's own would be.
/// `hand_dy`: the reading's hand_dy (0 where the layout puts the hand); `ui`: its interface scale.
pub fn pictures(img: &Img, data: &ScanData, phase: &str, size: usize, slots: &[usize], hand_dy: f64, ui: f64) -> HashMap<usize, PictureRead> {
    let l = layout_at(img.width, img.height, ui).shifted_hand(hand_dy);
    let r = read_at(img, &l, size, phase, data, Some(slots));
    slots
        .iter()
        .map(|&j| {
            let key = format!("hand{j}");
            let unknown = r.problems.iter().any(|p| matches!(p, Problem::UnknownArt { field, .. } if *field == key));
            (j, PictureRead { ranks: r.ranks[j].clone(), field: r.fields.get(&key).cloned(), unknown })
        })
        .collect()
}

const PHASES: [&str; 3] = ["potion", "instrument", "protocol"];

/// The reading with each card's printed name added. `read_text` reads a title crop (OCR); `pictures` matches
/// the cards whose names can't be settled, when the reading left them out.
pub fn read_titles(img: &Img, reading: Reading, data: &ScanData, read_text: &mut dyn FnMut(&Img) -> String, pictures_of: Option<&dyn Fn(&str, usize, &[usize]) -> HashMap<usize, PictureRead>>) -> Reading {
    read_titles_impl(img, reading, data, read_text, pictures_of, false)
}

/// Live reader's bounded OCR recovery; `read_titles` retains upstream parity.
pub fn read_titles_live(img: &Img, reading: Reading, data: &ScanData, read_text: &mut dyn FnMut(&Img) -> String, pictures_of: Option<&dyn Fn(&str, usize, &[usize]) -> HashMap<usize, PictureRead>>) -> Reading {
    read_titles_impl(img, reading, data, read_text, pictures_of, true)
}

fn read_titles_impl(img: &Img, reading: Reading, data: &ScanData, read_text: &mut dyn FnMut(&Img) -> String, pictures_of: Option<&dyn Fn(&str, usize, &[usize]) -> HashMap<usize, PictureRead>>, recover: bool) -> Reading {
    let read = reading.hand_ranks.as_ref().map_or(0, |r| r.len());
    if (read == 0 && reading.hand_pending != Some(true)) || reading.has(|p| matches!(p, Problem::NotFound | Problem::Animating)) {
        return reading;
    }
    let l = layout_at(img.width, img.height, reading.ui()).shifted_hand(reading.hand_dy.unwrap_or(0.0));
    let header = match reading.state.phase {
        vorax::advisor::ScreenPhase::Potion => "potion",
        vorax::advisor::ScreenPhase::Instrument => "instrument",
        vorax::advisor::ScreenPhase::Protocol => "protocol",
    };
    let phases: Vec<&str> = if reading.fields.get("phase").is_some_and(|f| f.sure) { vec![header] } else { PHASES.to_vec() };
    let size = if read > 0 { read } else { reading.hand_size.unwrap_or(3) };
    let mut texts: Vec<String> = l.hand_at(size).iter().map(|c| read_text(&title_crop(img, c, l.k))).collect();
    let mut best: Option<(&str, Vec<Vec<(String, f64)>>, f64)> = None;
    for phase in phases {
        let slots: Vec<Vec<(String, f64)>> = texts.iter().map(|t| ranked(data, phase, t)).collect();
        let fit = slots.iter().fold(0.0, |s, r| s + r[0].1.max(0.0));
        if best.as_ref().is_none_or(|b| fit > b.2) {
            best = Some((phase, slots, fit));
        }
    }
    let (phase, mut slots, _) = best.unwrap();
    let pos = l.hand_at(size);

    let mut recovered = HashMap::new();
    if recover {
        for (j, ranks) in slots.iter_mut().enumerate() {
            if let Some(name) = live_title_alias(data, phase, &texts[j]) {
                recovered.insert(j, name);
                continue;
            }
            if settled(ranks) { continue; }
            let retry = read_text(&focused_title_crop(img, &pos[j], l.k));
            let retry_ranks = ranked(data, phase, &retry);
            if let Some(name) = live_title_alias(data, phase, &retry) {
                recovered.insert(j, name);
                texts[j] = retry;
            } else if settled(&retry_ranks) {
                *ranks = retry_ranks;
                texts[j] = retry;
            } else if let Some(name) = anchored_title(data, phase, &retry) {
                recovered.insert(j, name);
                texts[j] = retry;
            }
        }
    }

    let need: Vec<usize> = slots.iter().enumerate().filter(|(j, r)| !settled(r) && !recovered.contains_key(j)).map(|(j, _)| j).collect();
    let from_reading = read == size && phase == header;
    let pics: HashMap<usize, PictureRead> = if from_reading {
        need.iter()
            .map(|&j| {
                let key = format!("hand{j}");
                let unknown = reading.problems.iter().any(|p| matches!(p, Problem::UnknownArt { field, .. } if *field == key));
                (j, PictureRead { ranks: reading.hand_ranks.as_ref().unwrap()[j].clone(), field: reading.fields.get(&key).cloned(), unknown })
            })
            .collect()
    } else if !need.is_empty() {
        pictures_of.map(|f| f(phase, size, &need)).unwrap_or_default()
    } else {
        HashMap::new()
    };

    let mut fields: Fields = reading.fields.iter().filter(|(k, _)| !(k.len() == 5 && k.starts_with("hand") && k.as_bytes()[4].is_ascii_digit())).map(|(k, v)| (k.clone(), v.clone())).collect();
    let mut hand = Vec::new();
    let mut unknown = Vec::new();
    for (j, r) in slots.iter().enumerate() {
        let (top, second) = (&r[0], r.get(1));
        let key = format!("hand{j}");
        let pic = pics.get(&j);
        let mut name: Option<String> = None;
        if let Some(recovery) = recovered.get(&j) {
            name = Some(recovery.clone());
            fields.insert(key, FieldRead { sure: true, guess: name.clone(), score: None, second: None });
        } else if settled(r) {
            name = Some(top.0.clone());
            fields.insert(key, FieldRead { sure: true, guess: name.clone(), score: Some(top.1), second: second.map(|s| s.1) });
        } else if top.1 >= MIN_Q {
            let close: Vec<&String> = r.iter().filter(|(_, q)| *q >= top.1 - GAP).map(|(n, _)| n).collect();
            let n = pic.and_then(|p| p.ranks.iter().find(|(n, _)| close.contains(&n)).map(|x| x.0.clone())).unwrap_or_else(|| top.0.clone());
            let sure = pic.is_some_and(|p| p.ranks.first().is_some_and(|x| x.0 == n) && p.field.as_ref().is_some_and(|f| f.sure));
            fields.insert(key, FieldRead { sure, guess: Some(n.clone()), score: Some(top.1), second: second.map(|s| s.1) });
            name = Some(n);
        } else if let Some(p) = pic.filter(|p| !p.unknown && p.field.as_ref().is_some_and(|f| f.guess.is_some())) {
            name = p.field.as_ref().unwrap().guess.clone();
            fields.insert(key, p.field.clone().unwrap());
        } else {
            fields.insert(key, pic.and_then(|p| p.field.clone()).unwrap_or(FieldRead::sure(false)));
        }
        match name {
            Some(n) => hand.push(n),
            None => unknown.push(j),
        }
    }
    let mut problems: Vec<Problem> = reading.problems.iter().filter(|p| !matches!(p, Problem::UnknownArt { .. })).cloned().collect();
    for &j in &unknown {
        let text = texts[j].trim();
        problems.push(Problem::UnknownArt { field: format!("hand{j}"), crop: card_face(&pos[j], l.k), hand: (size == 5).then_some(5), text: (!text.is_empty()).then(|| text.to_string()) });
    }
    if phase != header {
        fields.insert("phase".into(), FieldRead { sure: unknown.is_empty(), guess: Some(phase.into()), ..Default::default() });
    }
    let mut state = reading.state.clone();
    state.phase = match phase {
        "potion" => vorax::advisor::ScreenPhase::Potion,
        "instrument" => vorax::advisor::ScreenPhase::Instrument,
        _ => vorax::advisor::ScreenPhase::Protocol,
    };
    state.hand = hand;
    // a refresh count read under the header's kind of pick belongs to the one the names show
    if phase != header && phase != "protocol" {
        let left = if header == "potion" { reading.state.potion_refreshes } else { reading.state.instrument_refreshes };
        if phase == "potion" {
            state.potion_refreshes = left;
        } else {
            state.instrument_refreshes = left;
        }
    }
    Reading { state, fields, problems, hand_ranks: Some((0..pos.len()).map(|j| pics.get(&j).map(|p| p.ranks.clone()).unwrap_or_default()).collect()), hand_pending: None, ..reading }
}

#[cfg(test)]
mod recovery_tests {
    use super::*;
    use crate::reading::empty_state;

    fn pending() -> Reading {
        let mut fields = Fields::new();
        fields.insert("phase".into(), FieldRead { sure: true, guess: Some("potion".into()), score: None, second: None });
        Reading { state: empty_state(), fields, problems: vec![], frame: None,
            instrument_ranks: None, hand_ranks: None, icons_known: None,
            hand_pending: Some(true), hand_size: Some(3), ui: None, debug: None, hand_dy: None }
    }

    #[test]
    fn live_client_water_title_is_canonical_and_needs_no_extra_ocr() {
        let texts = ["Probiotic Enzyme Solution", "Twin Hormone - Bone Sentry", "The Holiest Water\nAll Agitos awaken"];
        let mut calls = 0;
        let mut read = |_: &Img| { let text = texts[calls].to_string(); calls += 1; text };
        let got = read_titles_live(&Img::new(1280, 728), pending(), crate::scan_data(), &mut read, None);
        assert_eq!(calls, 3);
        assert_eq!(got.state.hand, ["Probiotic Enzyme Solution", "Twin Hormone - Bone Sentry", "Purest Holy Water"]);
        assert!(got.fields["hand2"].sure);
        assert!(got.problems.is_empty());
        for bad in ["Water", "Holiest Water", "The Water", "First Rite Holy Water: Confession", "Unknown The Holiest Water", "Select The Holiest Water"] {
            assert_eq!(live_title_alias(crate::scan_data(), "potion", bad), None);
        }
        assert_eq!(live_title_alias(crate::scan_data(), "instrument", "The Holiest Water"), None);
    }

    #[test]
    fn two_intact_title_anchors_recover_missing_middle() {
        let data = crate::scan_data();
        assert_eq!(anchored_title(data, "potion", "Twin Ho ne - go\nSentry"), Some("Twin Hormone - Bone Sentry".into()));
        for text in ["Sentry", "Twin Hormone", "Twin Hormone - Pest", "Select 1 group of Bone Sentry", "Twin Sentrv", "Anesthetic Tincture", "Twin Sentry Select 1 group"] {
            assert_eq!(anchored_title(data, "potion", text), None, "{text}");
        }
        let mut data = ScanData::embedded().unwrap();
        data.names.potion.push("Twin Other Sentry".into());
        assert_eq!(anchored_title(&data, "potion", "Twin Ho ne Sentry"), None, "ambiguous anchors must not settle");
    }

    #[test]
    fn focused_retry_recovers_card_before_wrong_art_fallback() {
        let texts = ["Twin HCl go\nSentry\nSelect I group(s) o", "AnesthctirTinctur\nAgito", "Xcnopurge Powder", "Twin Ho ne - go\nSentry"];
        let mut calls = 0;
        let mut read = |_: &Img| { let text = texts[calls].to_string(); calls += 1; text };
        let wrong_art = |_: &str, _: usize, _: &[usize]| -> HashMap<usize, PictureRead> { panic!("recovered title must bypass misleading artwork") };
        let got = read_titles_live(&Img::new(1280, 702), pending(), crate::scan_data(), &mut read, Some(&wrong_art));
        assert_eq!(calls, 4, "one retry, only for the unreadable title");
        assert_eq!(got.state.hand, ["Twin Hormone - Bone Sentry", "Anesthetic Tincture - Agito", "Xenopurge Powder"]);
        assert!(got.fields["hand0"].sure);
        assert!(got.problems.is_empty());
    }

    #[test]
    fn clear_titles_need_no_retry() {
        let names = ["Twin Hormone - Bone Sentry", "Anesthetic Tincture - Agito", "Xenopurge Powder"];
        let mut calls = 0;
        let mut read = |_: &Img| { let text = names[calls].to_string(); calls += 1; text };
        let got = read_titles_live(&Img::new(1280, 702), pending(), crate::scan_data(), &mut read, None);
        assert_eq!(calls, 3);
        assert_eq!(got.state.hand, names);
    }

    #[test]
    fn failed_retry_keeps_unknown_card_and_remaining_slot_numbers() {
        let texts = ["", "Anesthetic Tincture - Agito", "Xenopurge Powder", "Sentry"];
        let mut calls = 0;
        let mut read = |_: &Img| { let text = texts[calls].to_string(); calls += 1; text };
        let got = read_titles_live(&Img::new(1280, 702), pending(), crate::scan_data(), &mut read, None);
        assert_eq!(got.state.hand.len(), 2);
        assert!(got.problems.iter().any(|p| matches!(p, Problem::UnknownArt { field, .. } if field == "hand0")));
        assert_eq!(got.fields["hand1"].guess.as_deref(), Some("Anesthetic Tincture - Agito"));
    }
}
