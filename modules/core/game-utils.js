"use strict";

function findUnit(state, id) {
  return state.units?.find((unit) => unit.id === id) || null;
}

function findReserveUnit(state, faction, id) {
  return state.reserves?.[faction]?.find((unit) => unit.id === id) || null;
}

module.exports = { findUnit, findReserveUnit };
