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

const RECLASSIFIED_CP_TOTAL_WAR_CARDS = [734, 735, 736, 737, 738, 739];

function removeCard(pool, id) {
  if (!Array.isArray(pool)) return 0;
  let removed = 0;
  let index;
  while ((index = pool.indexOf(id)) >= 0) {
    pool.splice(index, 1);
    removed += 1;
  }
  return removed;
}

// Cards 35-40 were corrected from Limited War to Total War.  Existing games
// may already have an unplayed copy in the live deck, hand, or discard pile.
// Keep completed/in-flight uses intact, but return every untouched copy to the
// implicit future-card zone.  A removed hand card is replaced from the current
// deck without shuffling, so loading a save never changes the random seed.
function reconcileReclassifiedCards(state, cardById) {
  if (state.commitment?.cp === "total" || !state.decks?.cp || !state.hands?.cp)
    return;
  let replacementDraws = 0;
  for (const id of RECLASSIFIED_CP_TOTAL_WAR_CARDS) {
    const event = cardById[id]?.event;
    const inFlight =
      Number(state.pending_event?.card) === id ||
      state.combat_window?.cards?.includes(id) ||
      state.combat?.played_cards?.some((entry) => Number(entry?.id) === id) ||
      Object.values(state.naval?.pending_fleet_cards || {}).some((entry) => Number(entry) === id);
    const completed =
      state.removed?.cp?.includes(id) ||
      Boolean(event && state.events?.[event]) ||
      state.event_history?.some((entry) => Number(entry?.card) === id);
    if (inFlight || completed) continue;
    replacementDraws += removeCard(state.hands.cp, id);
    removeCard(state.decks.cp, id);
    removeCard(state.discard?.cp, id);
    removeCard(state.retained_combat_cards?.cp, id);
    state.scheduled_events = (state.scheduled_events || []).filter(
      (entry) => !(entry?.kind === "card_return" && Number(entry.card) === id),
    );
  }
  while (replacementDraws > 0 && state.decks.cp.length > 0) {
    state.hands.cp.push(state.decks.cp.pop());
    replacementDraws -= 1;
  }
}

module.exports = { captureLegacyMiracleResume, reconcileReclassifiedCards };
