#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const {
  decodeRollbackStates,
  encodeRollbackStates,
} = require("./modules/core/history.js");
const { syncStoredSnapshot } = require("./modules/core/active-role.js");

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const databaseArg = args.indexOf("--database");
const titleArg = args.indexOf("--title");
const databasePath = path.resolve(
  databaseArg >= 0 ? args[databaseArg + 1] : path.join(moduleDir, "../../db"),
);
const titleId = titleArg >= 0 ? args[titleArg + 1] : "end-of-glory";

if (databaseArg >= 0 && !args[databaseArg + 1])
  throw new Error("--database requires a path");
if (titleArg >= 0 && !args[titleArg + 1])
  throw new Error("--title requires a title id");

function migrateState(state) {
  syncStoredSnapshot(state);
  for (const entry of state.undo || [])
    if (entry?.state) syncStoredSnapshot(entry.state);

  const rollback = decodeRollbackStates(state.rollback_state);
  if (rollback.length) {
    for (const snapshot of rollback) syncStoredSnapshot(snapshot);
    state.rollback_state = encodeRollbackStates(rollback);
  }

  if ((Number(state.version) || 0) >= 46) state.version = 47;
  return state;
}

const db = new Database(databasePath, { readonly: !apply, fileMustExist: true });
try {
  const rows = db.prepare(`
    select g.game_id, g.active, gs.state
      from games g
      join game_state gs using (game_id)
     where g.title_id = ? and g.status = 1
     order by g.game_id
  `).all(titleId);

  const changes = [];
  const errors = [];
  for (const row of rows) {
    try {
      const state = migrateState(JSON.parse(row.state));
      const encoded = JSON.stringify(state);
      if (encoded !== row.state || String(row.active) !== String(state.active))
        changes.push({ gameId: row.game_id, oldActive: row.active, state, encoded });
    } catch (error) {
      errors.push({ gameId: row.game_id, error: error.message });
    }
  }

  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${titleId}`);
  console.log(`Database: ${databasePath}`);
  console.log(`Active games scanned: ${rows.length}`);
  console.log(`Games requiring update: ${changes.length}`);
  for (const change of changes)
    console.log(`  ${change.gameId}: ${change.oldActive} -> ${change.state.active}`);
  for (const failure of errors)
    console.error(`  ERROR ${failure.gameId}: ${failure.error}`);

  if (errors.length) {
    process.exitCode = 1;
  } else if (apply && changes.length) {
    const updateState = db.prepare("update game_state set state = ? where game_id = ?");
    const updateActive = db.prepare("update games set active = ? where game_id = ?");
    db.transaction(() => {
      for (const change of changes) {
        updateState.run(change.encoded, change.gameId);
        // RTT's trigger_active_changed trigger rebuilds players.is_active.
        updateActive.run(change.state.active, change.gameId);
      }
    })();
    console.log(`Updated ${changes.length} game(s).`);
  } else if (!apply && changes.length) {
    console.log("No changes written. Re-run with --apply after backing up the database.");
  }
} finally {
  db.close();
}
