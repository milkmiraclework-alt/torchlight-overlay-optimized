# Working on Torchlight Overlay

- This is a read-only adviser. Never add game input automation: the player makes every move.
- All modes share one tray, capture controls and settings. A mode switch must stop the inactive backend; capture stop and application exit must leave no owned child process or calculation workers.
- Arcana is experimental. Its independent S9 rules/visual data come from the local game, not Timer's closed helper. The user chose Arcana Helper's published rarity objective (green/blue 1, purple 3, gold 5, red 10, rainbow 25), not its closed code/models. Hidden server layouts are bootstrapped from the current board, not calibrated; do not claim quality parity or verified profit. Uncertain readings and total path length require confirmation, and edits must belong to the current frame.
- Keep the Tartarus objective as expected Rainbow in the vault, capped at 10. Vorax uses capped final activity at 840,000. Do not substitute money/hour or silently reduce simulation budgets.
- The user explicitly requested Giboork's Tartarus assessment. The 1.2.1 preview ranks its four-day/model continuations by Rainbow plus 0.3 per newly vaulted Rainbow and 0.25 per unmarked red. Keep this internal score separate from displayed expected Rainbow. Retain local game rules and move guards; native evaluator parity is not full application parity. The per-action budgets remain 2000 for moves and 8000 for instruments/gifts.
- Preserve the rules and parity checks in `vorax/AGENTS.md`. Do not edit its data or fixtures manually.
- Rebuild and refresh source manifests when changing Rust or native sources. Never publish a binary with stale fingerprints.
- Use simulated states, existing saved frames and isolated fake windows/logs for tests. Never capture or send input to a user's actual game while testing.
- `node tools/check.js` verifies routing/retries and the calculation/reader guards. `node tools/packaged-check.js --frames <saved-frames>` verifies the actual packaged application, including native capture of a test window.
