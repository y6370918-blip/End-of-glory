"use strict";

const zlib = require("node:zlib");
const { Buffer } = require("node:buffer");
const { clone, factionRole, roleFaction } = require("./utils.js");
const { activeFaction, syncStoredSnapshot } = require("./active-role.js");

const ROLLBACK_STATE_PREFIX = "eog-rb-v44:";

function compactHistoryState(source) {
  const copy = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (["undo", "rollback", "rollback_state", "combat_rollback_pending", "log"].includes(key)) continue;
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
  if (!entry || entry.available === false || !snapshot || typeof snapshot.state !== "string") return false;
  if (entry.turn != null && entry.turn !== snapshot.turn) return false;
  if ((entry.round ?? 0) !== (snapshot.action_round ?? 0)) return false;
  if (entry.action != null && entry.action !== snapshot.action_round) return false;
  if (entry.log_cursor != null && (!Number.isInteger(entry.log_cursor) || entry.log_cursor < 0)) return false;
  try {
    if (entry.actor != null &&
        activeFaction({ active: entry.actor }) !== activeFaction(snapshot)) return false;
    if (entry.active != null &&
        activeFaction({ active: entry.active }) !== activeFaction(snapshot)) return false;
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
    const snapshot = entry?.state || snapshots[offset + index];
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
  delete state.combat_rollback_pending;
  setRollbackSnapshots(state, []);
}

function setRollbackSnapshots(state, snapshots) {
  state.rollback_state = encodeRollbackStates(snapshots);
}

// PUG's category windows are independent; combat children live only as long
// as their action_round parent. EOG keeps the existing compressed-file format.
function rollbackLimits(state) {
  const positive = (value, fallback) => Number.isInteger(value) ? Math.max(0, value) : fallback;
  return {
    max_turns: positive(state.options?.max_rollback_turns, 2),
    max_action_rounds: positive(state.options?.max_rollback_action_rounds, 4),
  };
}

function rollbackActionKey(entry) {
  return `${entry.turn}|${roleFaction(entry.active ?? entry.actor)}|${entry.action ?? entry.round ?? 1}`;
}

function rollbackLabel(entry) {
  if (entry.kind === "unavailable") return "无效检查点";
  if (entry.kind === "turn_start") return `回合 ${entry.turn} 起始`;
  if (entry.kind === "pre_replacement") return `回合 ${entry.turn} 补员阶段前`;
  const faction = roleFaction(entry.active ?? entry.actor) === "ap" ? "协约国" : "同盟国";
  const action = `回合 ${entry.turn} ${faction} 第 ${entry.action ?? entry.round ?? 1} 行动轮`;
  if (entry.kind === "combat") return `${action}：${entry.space_name || `第 ${entry.combat_index} 场`} 战斗前`;
  return action;
}

function makeRollbackEntry(state, kind, extra = {}) {
  const entry = {
    kind, turn: state.turn, active: factionRole(activeFaction(state)),
    actor: factionRole(activeFaction(state)), action: state.action_round,
    round: state.action_round, log_index: state.log.length,
    log_cursor: state.log.length, events: [], turn_start: kind === "turn_start",
    ...extra,
  };
  entry.label = rollbackLabel(entry);
  return entry;
}

function pruneRollbackHistory(state, snapshots) {
  const limits = rollbackLimits(state);
  for (const [kind, limit] of [["turn_start", limits.max_turns], ["action_round", limits.max_action_rounds], ["pre_replacement", limits.max_turns]]) {
    while (state.rollback.filter((entry) => entry.kind === kind).length > limit) {
      const index = state.rollback.findIndex((entry) => entry.kind === kind);
      const [removed] = state.rollback.splice(index, 1);
      snapshots.splice(index, 1);
      if (kind === "action_round" && index > 0)
        (state.rollback[index - 1].events ||= []).push(...(removed.events || []));
    }
  }
  const parents = new Set(state.rollback.filter((entry) => entry.kind === "action_round").map(rollbackActionKey));
  for (let index = state.rollback.length - 1; index >= 0; --index) {
    if (state.rollback[index].kind === "combat" && !parents.has(rollbackActionKey(state.rollback[index]))) {
      state.rollback.splice(index, 1);
      snapshots.splice(index, 1);
    }
  }
}

function saveRollbackPoint(state, kind, snapshot = null) {
  if (state.options?.no_supply_warnings) return;
  kind = ({ turn: "turn_start", "action-round": "action_round" })[kind] || kind;
  if (!["turn_start", "action_round", "pre_replacement"].includes(kind))
    throw new Error(`Unknown rollback checkpoint kind: ${kind}`);
  delete state.combat_rollback_pending;
  const snapshots = rollbackSnapshots(state);
  state.rollback.push(makeRollbackEntry(state, kind));
  snapshots.push(snapshot || compactHistoryState(state));
  pruneRollbackHistory(state, snapshots);
  setRollbackSnapshots(state, snapshots);
}

function saveCombatRollbackPoint(state, declaration, spaceName) {
  if (state.options?.no_supply_warnings || !state.ops || !declaration?.target) return;
  const actor = state.action_state?.actor || activeFaction(state);
  const record = (state.action_history || []).find((entry) => entry.turn === state.turn && entry.round === state.action_round && entry.faction === actor);
  if (record?.type !== "ops" || !record.card || activeFaction(state) !== actor) return;
  const entry = makeRollbackEntry(state, "combat", { space: declaration.target, space_name: spaceName });
  const key = rollbackActionKey(entry);
  if (!state.rollback.some((point) => point.kind === "action_round" && rollbackActionKey(point) === key)) {
    delete state.combat_rollback_pending;
    return;
  }
  const combatIndex = (state.ops.rollback_combat_count || 0) + 1;
  const snapshot = combatIndex <= 5 ? compactHistoryState(state) : null;
  state.ops.rollback_combat_count = combatIndex;
  if (combatIndex > 5) return;
  entry.combat_index = combatIndex;
  entry.label = rollbackLabel(entry);
  const exists = (index) => state.rollback.some((point) => point.kind === "combat" && rollbackActionKey(point) === key && point.combat_index === index);
  if (exists(combatIndex)) return;
  let pending = state.combat_rollback_pending;
  if (pending && rollbackActionKey(pending.rollback) !== key) {
    delete state.combat_rollback_pending;
    pending = null;
  }
  if (pending?.rollback.combat_index === combatIndex) return;
  // Resuming here re-confirms the already-paid declaration, never cardUse().
  snapshot.state = "rollback_combat_start";
  snapshot.ops.pending_attack = clone(declaration);
  if (!pending && !state.rollback.some((point) => point.kind === "combat" && rollbackActionKey(point) === key)) {
    state.combat_rollback_pending = { rollback: entry, snapshot };
    return;
  }
  const snapshots = rollbackSnapshots(state);
  if (pending && !exists(pending.rollback.combat_index)) {
    state.rollback.push(pending.rollback);
    snapshots.push(pending.snapshot);
  }
  delete state.combat_rollback_pending;
  state.rollback.push(entry);
  snapshots.push(snapshot);
  setRollbackSnapshots(state, snapshots);
}

function migrateRollbackHistory(state) {
  repairRollbackHistory(state);
  const snapshots = rollbackSnapshots(state);
  // Never prune/reindex during load: a review in progress refers to this index.
  for (let index = 0; index < state.rollback.length; ++index) {
    const entry = state.rollback[index];
    const snapshot = snapshots[index];
    const legacyKind = entry.kind;
    entry.kind = ({ turn: "turn_start", "action-round": "action_round" })[legacyKind] || legacyKind;
    entry.active = entry.actor;
    entry.action = entry.round;
    entry.log_index = entry.log_cursor;
    entry.events ||= [];
    entry.turn_start = entry.kind === "turn_start";
    const resumable = snapshot && activeFaction(snapshot) && snapshot.action_round >= 1 &&
      ((entry.kind === "action_round" && snapshot.state === "action_card") ||
       (legacyKind === "turn_start" && snapshot.state === "action_card" && snapshot.action_round === 1) ||
       (entry.kind === "combat" && snapshot.state === "rollback_combat_start") ||
       (entry.kind === "pre_replacement" && snapshot.state === "rollback_turn_end"));
    if (!resumable) entry.available = false;
    entry.label = rollbackLabel(entry);
    if (snapshot) snapshot.version = 57;
    delete entry.state;
  }
  setRollbackSnapshots(state, snapshots);
  for (const entry of state.undo || []) if (entry.state) entry.state.version = 57;
}

function rollbackMeta(state) {
  const points = state.rollback || [];
  const count = (kind) => points.filter((entry) => entry.kind === kind).length;
  return { ...rollbackLimits(state), total_points: points.length,
    turn_points: count("turn_start"), action_points: count("action_round"),
    combat_points: count("combat"), pre_replacement_points: count("pre_replacement"),
    total_events: points.reduce((sum, entry) => sum + (entry.events?.length || 0), 0),
    state_compressed: typeof state.rollback_state === "string",
  };
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
  rollbackActionKey,
  rollbackLabel,
  rollbackLimits,
  rollbackMeta,
  migrateRollbackHistory,
  saveRollbackPoint,
  saveCombatRollbackPoint,
};
