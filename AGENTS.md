# Working on Torchlight Overlay

- This is a read-only adviser. Never add game input automation: the player makes every move.
- Both modes share one tray, capture controls and settings. A mode switch must stop the inactive backend; capture stop and application exit must leave no owned child process or calculation workers.
- Keep the Tartarus objective as expected Rainbow in the vault, capped at 10. Vorax uses capped final activity at 840,000. Do not substitute money/hour or silently reduce simulation budgets.
- Preserve the rules and parity checks in `vorax/AGENTS.md`. Do not edit its data or fixtures manually.
- Rebuild and refresh source manifests when changing Rust or native sources. Never publish a binary with stale fingerprints.
- Use simulated states, existing saved frames and isolated fake windows/logs for tests. Never capture or send input to a user's actual game while testing.
- `node tools/check.js` verifies routing/retries and the calculation/reader guards. `node tools/packaged-check.js --frames <saved-frames>` verifies the actual packaged application, including native capture of a test window.
