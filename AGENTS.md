# Project instructions

- `rules.js` function `set_up_historical_scenario()` is the authoritative, manually maintained Historical setup.
- Never regenerate, replace, or infer setup locations from coordinates or TTS data unless the user explicitly requests that destructive reset in the current task.
- Preserve the explicit `setup_piece(nation, unit, space, reduced)` calls when changing rules, maps, assets, or generated data.
- Historical setup changes belong in `rules.js`; do not add unit objects, GUIDs, or world coordinates to `data/source/setup.json` or generated `data.js`.
