"use strict";

const zlib = require("node:zlib");
const { Buffer } = require("node:buffer");
const { clone } = require("./utils.js");

const ROLLBACK_STATE_PREFIX = "eog-rb-v44:";

function compactHistoryState(source) {
  const copy = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (["undo", "rollback", "rollback_state", "log"].includes(key)) continue;
    copy[key] = clone(value);
  }
  return copy;
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

function rollbackSnapshot(state, index) {
  const snapshots = decodeRollbackStates(state?.rollback_state);
  return snapshots[index] || state?.rollback?.[index]?.state || null;
}

function setRollbackSnapshots(state, snapshots) {
  state.rollback_state = encodeRollbackStates(snapshots);
}

module.exports = {
  compactHistoryState,
  decodeRollbackStates,
  encodeRollbackStates,
  rollbackSnapshot,
  setRollbackSnapshots,
};
