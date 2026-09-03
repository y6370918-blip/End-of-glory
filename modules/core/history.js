"use strict";

const zlib = require("node:zlib");
const { Buffer } = require("node:buffer");
const { clone } = require("./utils.js");
const { activeFaction, syncStoredSnapshot } = require("./active-role.js");

const ROLLBACK_STATE_PREFIX = "eog-rb-v44:";

function compactHistoryState(source) {
  const copy = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (["undo", "rollback", "rollback_state", "log"].includes(key)) continue;
    copy[key] = clone(value);
  }
  return syncStoredSnapshot(copy);
}

function encodeRollbackStates(states) {
  const json = JSON.stringify(states || []);
  return ROLLBACK_STATE_PREFIX + zlib
    .deflateSync(Buffer.from(json, "utf8"))
    .toString("base64");
}

function decodeRollbackStates(value) {
  if (Array.isArray(value)) return value.map((entry) => clone(entry));
  if (typeof value !== "string" || !value.length) return [];
  try {
    if (value.startsWith(ROLLBACK_STATE_PREFIX)) {
      const buffer = Buffer.from(value.slice(ROLLBACK_STATE_PREFIX.length), "base64");
      const parsed = JSON.parse(zlib.inflateSync(buffer).toString("utf8"));
      return Array.isArray(parsed) ? parsed : [];
    }
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function checkpointMatches(entry, snapshot) {
  if (!entry || !snapshot || typeof snapshot.state !== "string") return false;
  if (entry.turn != null && entry.turn !== snapshot.turn) return false;
  if ((entry.round ?? 0) !== (snapshot.action_round ?? 0)) return false;
  try {
    if (entry.actor != null &&
        activeFaction({ active: entry.actor }) !== activeFaction(snapshot)) return false;
  } catch {
    return false;
  }
  return true;
}

function pairedRollbackSnapshots(state, snapshots) {
  const entries = state?.rollback || [];
  // Older combat cleanup removed only metadata. The surviving metadata always
  // corresponds to the TAIL of the append-only snapshots, not their beginning.
  const offset = Math.max(0, snapshots.length - entries.length);
  return entries.map((entry, index) => {
    const snapshot = entry.state || snapshots[offset + index];
    return checkpointMatches(entry, snapshot) ? snapshot : null;
  });
}

function rollbackSnapshots(state) {
  return pairedRollbackSnapshots(state, decodeRollbackStates(state?.rollback_state));
}

function rollbackSnapshot(state, index) {
  if (!Number.isInteger(index) || index < 0) return null;
  return rollbackSnapshots(state)[index] || null;
}

function repairRollbackHistory(state) {
  const snapshots = decodeRollbackStates(state.rollback_state);
  if (snapshots.length <= state.rollback.length) return;
  const paired = pairedRollbackSnapshots(state, snapshots);
  // Repair the known offset only when every retained checkpoint matches.
  // Unverifiable entries remain unavailable rather than restoring another turn.
  if (paired.every(Boolean)) setRollbackSnapshots(state, paired);
}

function clearRollback(state) {
  state.rollback = [];
  setRollbackSnapshots(state, []);
}

function setRollbackSnapshots(state, snapshots) {
  state.rollback_state = encodeRollbackStates(snapshots);
}

module.exports = {
  compactHistoryState,
  clearRollback,
  decodeRollbackStates,
  encodeRollbackStates,
  rollbackSnapshot,
  rollbackSnapshots,
  repairRollbackHistory,
  setRollbackSnapshots,
};
