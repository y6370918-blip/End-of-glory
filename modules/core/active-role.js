"use strict";

const { AP, AP_ROLE, CP, CP_ROLE, NONE } = require("./constants.js");

function roleFaction(value) {
  if (value === AP || value === AP_ROLE) return AP;
  if (value === CP || value === CP_ROLE) return CP;
  if (value == null || value === NONE) return null;
  return undefined;
}

function factionRole(faction) {
  if (faction === AP) return AP_ROLE;
  if (faction === CP) return CP_ROLE;
  if (faction == null) return NONE;
  throw new Error(`Unknown active faction: ${String(faction)}`);
}

function resolveActiveFaction(state) {
  if (!state || typeof state !== "object") return null;
  const hasActive = Object.prototype.hasOwnProperty.call(state, "active");
  const fromActive = roleFaction(state.active);
  const fromFaction = roleFaction(state.active_faction);
  if (fromActive === undefined)
    throw new Error(`Unknown active role: ${String(state.active)}`);
  if (fromFaction === undefined)
    throw new Error(`Unknown active faction: ${String(state.active_faction)}`);
  // The root RTT field is authoritative when present. This also lets an
  // explicit "None" clear a stale active_faction at game end.
  return hasActive ? fromActive : (fromFaction ?? null);
}

function activeFaction(state) {
  return resolveActiveFaction(state);
}

function setActiveFaction(state, faction) {
  const normalized = roleFaction(faction);
  if (normalized === undefined)
    throw new Error(`Unknown active faction: ${String(faction)}`);
  state.active_faction = normalized;
  // Rules code uses the compact faction token while it is executing.
  state.active = normalized ?? NONE;
  return normalized;
}

function normalizeRttActive(state) {
  if (!state || typeof state !== "object") return state;
  setActiveFaction(state, resolveActiveFaction(state));
  return state;
}

function syncRttActive(state) {
  if (!state || typeof state !== "object") return state;
  const faction = resolveActiveFaction(state);
  state.active_faction = faction;
  state.active = factionRole(faction);
  return state;
}

function syncStoredSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  return syncRttActive(snapshot);
}

module.exports = {
  activeFaction,
  normalizeRttActive,
  setActiveFaction,
  syncRttActive,
  syncStoredSnapshot,
};
