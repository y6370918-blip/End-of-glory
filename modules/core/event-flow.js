"use strict";

// A pending event may keep detailed, private selections, but the saved state
// name identifies the rule flow that owns those selections.  The legacy
// catch-all `event` name is accepted only long enough to migrate/settle it.
const EVENT_KINDS = Object.freeze([
  "aef_replacements",
  "august_belgian_relocation",
  "august_reposition",
  "bulgaria_choice",
  "bulgaria_front_response",
  "card_return",
  "card_search",
  "combat_fr_rp",
  "combat_hq_reinforcement",
  "combat_repair",
  "counterattack",
  "delay_units",
  "desertion_combat_loss",
  "desertion_immediate",
  "french_doctrine",
  "front_investment",
  "front_maintenance",
  "gorlitz_mo",
  "hindenburg_line",
  "hq_relocation",
  "hq_return",
  "immediate_rp",
  "italy_entry_restore",
  "killing_ground_maintenance",
  "mass_attrition",
  "mo_counterattack",
  "mo_penalty",
  "naval_post_fortification",
  "nivelle_attacks",
  "ohl",
  "optional_deploy",
  "precombat_restore",
  "regional_rotation",
  "reinforcement",
  "reinforcement_rebuild",
  "replacement_rebuild",
  "return_units",
  "rp_adjustment",
  "sack_belgium",
  "salient",
  "scheduled_return",
  "space_rule",
  "veteran_upgrade",
  "white_feather_sr",
]);

const EVENT_KIND_SET = new Set(EVENT_KINDS);
const GENERIC_EVENT_STATE = "event_choice";

function eventStateName(pending) {
  const kind = pending?.kind;
  if (!kind && pending?.card != null) return GENERIC_EVENT_STATE;
  if (!EVENT_KIND_SET.has(kind)) {
    const card = pending?.card ?? "unknown";
    throw new Error(`Unknown pending event flow: card ${card}, kind ${kind || "missing"}`);
  }
  return `event_${kind}`;
}

function isEventState(name) {
  if (name === GENERIC_EVENT_STATE) return true;
  return typeof name === "string" &&
    name.startsWith("event_") &&
    EVENT_KIND_SET.has(name.slice(6));
}

function canonicalizeEventState(state) {
  if (state?.state === "event") state.state = eventStateName(state.pending_event);
  return state?.state;
}

module.exports = {
  EVENT_KINDS,
  GENERIC_EVENT_STATE,
  canonicalizeEventState,
  eventStateName,
  isEventState,
};
