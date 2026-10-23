# Local Smart advisor

Based on DinoRaos/vorax-rs at `f117a01d4f1913684094753aa34291e8b2044852`, itself a port of tidewarden/tli-vorax-simulator at `7881e7fa0dbde2ed9b99eb600cfc6ac987ad1cca`. Original README and MIT notices are preserved. This is a local derivative, not an official upstream release.

The game engine, random generator, trained board-value model and reference advisor are unchanged. `crates/vorax/src/smart.rs` adds an independent advisor. All reference parity tests remain enabled and compare the original public API to the original traces.

- Pilot complete futures for every legal potion/target combination; preserve every original shortlisted candidate and add other promising targets.
- At least 128 complete futures per retained candidate, up to 256 in Balanced mode. Deep mode uses up to 512 and a more expensive continuation policy. Shared random futures and paired differences guide work allocation; this is not a calibrated statistical confidence guarantee.
- Continue RNG indices when allocating more futures; do not replay previously counted outcomes.
- Before replacing the reference action, test the challenger against it on 64–256 fresh paired futures from a different seed domain. If the estimated gain does not exceed the paired uncertainty allowance plus 1,000 activity, retain the reference action. The gate is a conservative heuristic, not a guarantee of improvement in the actual game.
- Cache 32 exact recognised boards in process memory. Any input change gets a different entry; no screenshots are stored by this cache.
- The overlay marks a close decision and withholds card/reroll advice if an offered card was not recognised. Ctrl+Alt+X retries reading.
- `vorax advise --smart` prints advice and work diagnostics; `--deep` selects Deep mode. Plain `vorax advise` keeps the original advisor, for regression checks.
- `vorax quality --count 32 --futures 1024` compares choices on independently seeded future outcomes. `vorax quality --games --count 64` compares whole simulated games. Neither accesses the real game or its input.

Build from the parent checkout with `powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-vorax.ps1`. Requires Rust and Windows build tools. Output is installed into a new `local/vorax/builds/` directory, so a running binary is never overwritten. `Start-Vorax-Overlay.cmd --reference` runs the original downloaded release.

`Start-Vorax-Overlay.cmd --deep` selects the more expensive mode. Balanced is the default to keep response time low.

The objective remains expected final activity capped at 840,000. This is not measured real-game profit per hour. More simulation is not by itself proof of better decisions; quality measurements belong in the parent checkout's `tools/results/` reports.
