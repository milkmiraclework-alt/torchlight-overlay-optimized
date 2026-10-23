# Tartarus calculation core

This is a Rust implementation of the live drill rules and continuation policy,
compiled to `js/solver-core.wasm`. There is no embedded JS interpreter or
per-move call back into the reference engine. The desktop UI stays in Electron.

The hot loop owns a fixed 16-cell board, shared immutable parameters, tools,
pending choices, hidden-state RNG, policy and a bounded chain table. Copies
contain game data only: no log strings, UI state or training histories. Measured
instrument pairs use fixed lookup tables. The chain hash table checks full key
equality, including rule bits, counts and Rainbow value; hashing cannot change
the numerical result.

`model.rs` contains typed state/ABI data and the exact wrapping Mulberry32 RNG.
`engine.rs` applies patrols, all instruments/events/gifts, prey/scratch/nest
markers, objectives, day flow and the 10-Rainbow cap. `policy.rs` values chains,
patrols, actions, tool offers/rerolls and gifts. `job.rs` owns each complete
Monte Carlo stream. `api.rs` provides batched operations and time slices.

The JS worker sends one JSON state when a job starts and receives only new
samples at slice boundaries. Pause retains the Rust job. Promotion changes the
worker request ID without resetting its RNG; family projection removes rows
without discarding their accumulated samples. Predictions use the Rust engine
without replacing an active job. Browser discovery and polling are not needed.

The JS rules/solver remain as the renderer's correction/label API, the readable
differential reference and a compatibility fallback. Merging worker samples,
ranking summaries and displaying explanations remain in JS. The fallback keeps
the complete calculation budget too.

## Rebuild

From the repository root, with Node and Rust installed:

```
rustup target add wasm32-unknown-unknown
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-rust-solver.ps1
```

Add `-Native` for the line-oriented diagnostic CLI. Cargo.lock pins dependency
versions. `tools/generate-rust-data.js` exports the shared measured weights and
instrument-set data; rules and policies themselves are implemented in Rust.
`js/solver-core.build.json` fingerprints normalized Rust/data sources and the
WASM bytes. Standalone packaging refuses an out-of-date module. Users running
release EXEs do not need a Rust installation.

## Verify

```
node tools/rust-solver-check.js --wasm
node tools/rust-solver-check.js
node tools/rust-worker-check.js
node tools/rust-solver-quality.js
node tools/overlay-check.js --standalone "desktop/dist/win-unpacked/Tartarus Optimized.exe" --rust-bench
```

The second command needs `-Native`. Differential checks exercise 264 complete
seeded runs, explicit held-tool fixtures, analyzer-only card restrictions,
unknown events/doors, alternate legal actions, raw Monte Carlo values and
ranking inputs. Fixture setup asserts instruments were actually added; an
unresolved starting offer must not silently prevent their setup.

The quality audit separately compares the corrected lower-tier Wolf chain
model with the frozen pre-port policy on paired seeds. A diagnostic
`legacyWolfChains` policy flag exists only to reproduce that comparison; normal
jobs use the corrected math. Legacy samples/RNG are checked against the frozen
JS reference before using it for the larger audit. Reported simulation gains
are not measurements of game profit/hour.

All tests use generated states, fake windows/logs and isolated profiles. They
never send game input, capture the user's real game, install an app into their
account or change startup settings.
