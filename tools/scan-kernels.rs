// Pixel kernels for js/scan.js. Build with tools/build-scan-kernels.ps1.
// Keep IEEE double arithmetic and iteration order identical to JavaScript.
// No fast math, SIMD reductions or approximate matching thresholds.
#![allow(clippy::missing_safety_doc)]
use core::arch::wasm32::*;

#[no_mangle]
pub extern "C" fn revision() -> u32 { 1 }

#[no_mangle]
pub unsafe extern "C" fn rgba_gray(input: *const u8, out: *mut f32, n: usize) {
    for i in 0..n {
        let p = input.add(i * 4);
        *out.add(i) = (0.299 * *p as f64 + 0.587 * *p.add(1) as f64
            + 0.114 * *p.add(2) as f64) as f32;
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
