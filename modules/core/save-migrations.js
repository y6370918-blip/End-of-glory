"use strict";

const { CP } = require("./constants.js");
const { clone, unique } = require("./utils.js");

function captureLegacyMiracleResume(state) {
  const attackerIds = unique([
    ...(state.ops?.pending_attack?.attackers || []),
    ...(state.ops?.attack_selection || []),
  ]);
  const origins = new Set();
  for (const id of attackerIds) {
    const unit = state.units.find((candidate) => candidate.id === id);
    if (!unit) continue;
    unit.attacked = true;
    if (unit.location) origins.add(unit.location);
  }
  const ops = clone(state.ops);
  ops.forced_attacks = (ops.forced_attacks || []).filter(
    (space) => !origins.has(space),
  );
  ops.pending_attack = null;
  ops.attack_selection = [];
  return {
    active: CP,
    ops,
    activations: clone(state.activations || {}),
  };
}

module.exports = { captureLegacyMiracleResume };
