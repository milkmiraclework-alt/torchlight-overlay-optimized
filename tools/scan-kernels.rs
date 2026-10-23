// Pixel kernels for js/scan.js. Build with tools/build-scan-kernels.ps1.
// Keep IEEE double arithmetic and iteration order identical to JavaScript.
// No fast math, SIMD reductions or approximate matching thresholds.
#![allow(clippy::missing_safety_doc)]
use core::arch::wasm32::*;

#[no_mangle]
pub extern "C" fn revision() -> u32 { 1 }

#[no_mangle]
pub unsafe extern "C" fn unvisit_text_mask(mask: *mut u8, n: usize) {
    for i in 0..n { if *mask.add(i) == 2 { *mask.add(i) = 1; } }
}

#[no_mangle]
pub unsafe extern "C" fn mask_blobs(mask: *mut u8, stack: *mut u32, out: *mut f64, cap: usize, w: usize, h: usize) -> usize {
    let mut count = 0;
    for i in 0..w * h {
        if *mask.add(i) != 1 { continue; }
        *mask.add(i) = 2;
        *stack = i as u32;
        let mut len = 1;
        let (mut n, mut sx, mut sy) = (0u64, 0u64, 0u64);
        let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0, 0);
        while len > 0 {
            len -= 1;
            let j = *stack.add(len) as usize;
            let (x, y) = (j % w, j / w);
            n += 1; sx += x as u64; sy += y as u64;
            x0 = x0.min(x); y0 = y0.min(y); x1 = x1.max(x); y1 = y1.max(y);
            for k in [if x > 0 { Some(j-1) } else { None },
                if x+1 < w { Some(j+1) } else { None },
                if y > 0 { Some(j-w) } else { None },
                if y+1 < h { Some(j+w) } else { None }].into_iter().flatten() {
                if *mask.add(k) == 1 { *mask.add(k) = 2; *stack.add(len) = k as u32; len += 1; }
            }
        }
        if count < cap {
            let p = out.add(count * 7);
            for (k, value) in [n as f64, sx as f64, sy as f64, x0 as f64, y0 as f64, x1 as f64, y1 as f64].into_iter().enumerate() { *p.add(k) = value; }
        }
        count += 1;
    }
    count
}

#[no_mangle]
pub unsafe extern "C" fn rgba_gray(input: *const u8, out: *mut f32, n: usize) {
    for i in 0..n {
        let p = input.add(i * 4);
        *out.add(i) = (0.299 * *p as f64 + 0.587 * *p.add(1) as f64
            + 0.114 * *p.add(2) as f64) as f32;
    }
}

#[no_mangle]
pub unsafe extern "C" fn text_mask(rgba: *const u8, lum: *const f32, around: *const f32, mask: *mut u8, n: usize, saturation: f64) {
    for i in 0..n {
        *mask.add(i) = 0;
        let l = *lum.add(i) as f64;
        let a = *around.add(i) as f64;
        if l < 45. || l - a < 16.0f64.max(0.3 * a) { continue; }
        let p = rgba.add(i * 4);
        let (r, g, b) = (*p, *p.add(1), *p.add(2));
        let max = r.max(g).max(b);
        let sat = if max == 0 { 0. } else { (max - r.min(g).min(b)) as f64 / max as f64 };
        if sat < saturation { *mask.add(i) = 1; }
    }
}

#[no_mangle]
pub unsafe extern "C" fn box_blur(
    input: *const f32, tmp: *mut f32, out: *mut f32, sums: *mut f64,
    w: usize, h: usize, r: usize,
) {
    let span = (2 * r + 1) as f64;
    for y in 0..h {
        let mut acc = 0.0;
        for x in -(r as isize)..=r as isize {
            acc += *input.add(y * w + x.clamp(0, w as isize - 1) as usize) as f64;
        }
        for x in 0..w {
            *tmp.add(y * w + x) = (acc / span) as f32;
            acc += *input.add(y * w + (x + r + 1).min(w - 1)) as f64
                - *input.add(y * w + x.saturating_sub(r)) as f64;
        }
    }
    for x in 0..w { *sums.add(x) = 0.0; }
    for y in -(r as isize)..=r as isize {
        let row = y.clamp(0, h as isize - 1) as usize * w;
        for x in 0..w { *sums.add(x) += *tmp.add(row + x) as f64; }
    }
    for y in 0..h {
        let next = (y + r + 1).min(h - 1) * w;
        let prev = y.saturating_sub(r) * w;
        for x in 0..w {
            *out.add(y * w + x) = (*sums.add(x) / span) as f32;
            *sums.add(x) += *tmp.add(next + x) as f64 - *tmp.add(prev + x) as f64;
        }
    }
}

#[no_mangle]
#[target_feature(enable = "simd128")]
pub unsafe extern "C" fn search(
    pixels: *const f32, xs: *const i32, ys: *const i32, offsets: *const i32,
    interior_x: *const u8, interior_y: *const u8, weights: *const f32,
    cn: usize, w: i32, nx: usize, ny: usize, ox0: i32, oy0: i32, out: *mut f64,
) {
    let mut best = f64::NEG_INFINITY;
    let mut bx = ox0;
    let mut by = oy0;
    for y in 0..ny {
        let mut x = 0;
        while x < nx {
            // Adjacent candidate positions read adjacent pixels. Evaluate
            // two independent candidates per vector, retaining each lane's
            // original sum order (unlike a horizontal SIMD reduction).
            if x + 1 < nx && *interior_y.add(y) != 0
                && *interior_x.add(x) != 0 && *interior_x.add(x + 1) != 0 {
                let origin = (oy0 + y as i32) * w + ox0 + x as i32;
                let mut sx = f64x2_splat(0.0);
                let mut sxx = sx;
                let mut sxt = sx;
                for j in 0..cn {
                    let p = pixels.offset((origin + *offsets.add(j)) as isize);
                    let v = f64x2_promote_low_f32x4(v128_load64_zero(p.cast()));
                    sx = f64x2_add(sx, v);
                    sxx = f64x2_add(sxx, f64x2_mul(v, v));
                    sxt = f64x2_add(sxt, f64x2_mul(v, f64x2_splat(*weights.add(j) as f64)));
                }
                let variance = f64x2_sub(sxx, f64x2_div(f64x2_mul(sx, sx), f64x2_splat(cn as f64)));
                let scores = f64x2_div(sxt, f64x2_sqrt(variance));
                for (lane, variance, score) in [
                    (0, f64x2_extract_lane::<0>(variance), f64x2_extract_lane::<0>(scores)),
                    (1, f64x2_extract_lane::<1>(variance), f64x2_extract_lane::<1>(scores)),
                ] {
                    let score = if variance > 1e-6 { score } else { -1.0 };
                    if score > best { best = score; bx = ox0 + x as i32 + lane; by = oy0 + y as i32; }
                }
                x += 2;
                continue;
            }
            let mut sx = 0.0;
            let mut sxx = 0.0;
            let mut sxt = 0.0;
            if *interior_x.add(x) != 0 && *interior_y.add(y) != 0 {
                let origin = (oy0 + y as i32) * w + ox0 + x as i32;
                for j in 0..cn {
                    let v = *pixels.offset((origin + *offsets.add(j)) as isize) as f64;
                    sx += v; sxx += v * v; sxt += v * *weights.add(j) as f64;
                }
            } else {
                for j in 0..cn {
                    let v = *pixels.offset((*ys.add(y * cn + j) + *xs.add(x * cn + j)) as isize) as f64;
                    sx += v; sxx += v * v; sxt += v * *weights.add(j) as f64;
                }
            }
            let variance = sxx - sx * sx / cn as f64;
            let score = if variance > 1e-6 { sxt / variance.sqrt() } else { -1.0 };
            if score > best { best = score; bx = ox0 + x as i32; by = oy0 + y as i32; }
            x += 1;
        }
    }
    *out = bx as f64; *out.add(1) = by as f64; *out.add(2) = best;
}
