"use strict";

const {
  canonicalizeEventState,
  isEventState,
} = require("../core/event-flow.js");

function createDeterministicSystem(api) {
  function stateActions(state) {
    const builder = new api.ActionProtocol.ActionBuilder();
    api.stateEngine.prompt(state, builder);
    return builder.actions;
  }

  function mandatoryEventUnitSelection(state, actions) {
    const pending = state.pending_event;
    if (!isEventState(state.state) || !pending) return null;
    if ([
      "reinforcement_rebuild",
      "precombat_restore",
      "combat_repair",
      "combat_fr_rp",
      "regional_rotation",
    ].includes(pending.kind)) return null;
    const choice = api.cardSpecById[pending.card]?.choices?.find(
      (entry) => entry.id === pending.choice,
    );
    if (choice?.select?.optional) return null;
    const selectable = actions.select_event_unit || [];
    const selected = pending.selected_units || [];
    const candidates = [...new Set([...selected, ...selectable])];
    const count = api.eventUnitSelectionCount(state, candidates);
    if (!count || candidates.length !== count || selected.length >= count)
      return null;
    return selectable.slice();
  }

  function advanceDeterministicStates(state, options = {}) {
    for (let guard = 0; guard < 64; ++guard) {
      if (!state || state.state === "game_over") return;
      canonicalizeEventState(state);

      if (state.state === "retreat") {
        if (api.prepareDefaultRetreatGroup(state)) continue;
        return;
      }

      if (state.state === "advance_select") {
        const actions = stateActions(state);
        if (!(actions.select_advance_unit || []).length &&
            !(actions.advance_destination || []).length &&
            actions.decline_advance === 1) {
          api.stateEngine.dispatch(state, "decline_advance");
          continue;
        }
        return;
      }

      if (state.state === "combat_losses" &&
          !api.legalCombatLossUnitIds(state).length) {
        api.advanceCombatLosses(state);
        continue;
      }

      if (state.state === "combat_replacement") {
        const options = state.pending_replacement?.options || [];
        if (options.length === 1) {
          api.stateEngine.dispatch(state, "choose_replacement", options[0]);
          continue;
        }
        return;
      }

      if (["combat_card_window", "post_combat_card_window"].includes(state.state)) {
        if (options.restoring && state.combat_window?.cards?.length) return;
        const actions = stateActions(state);
        if (!(actions.combat_card || []).length && actions.pass === 1) {
          try {
            api.stateEngine.dispatch(state, "pass");
          } catch {
            // A malformed legacy combat remains inspectable instead of making
            // save loading fail. A legal live combat always settles here.
            return;
          }
          continue;
        }
        return;
      }

      if (state.state === "attack_mo" && state.ops?.pending_attack &&
          api.attackMoChoicesComplete(state, state.ops.pending_attack)) {
        const pending = state.ops.pending_attack;
        api.validateAttackDeclaration(state, pending);
        if (api.pendingAttackOriginCount(state, pending) >= 2 &&
            api.legalFlankFinals(state).length)
          state.state = "attack_mode";
        else
          api.commitPendingAttack(state, { ...pending, flank: false });
        continue;
      }

      if (state.state === "optional_combat_event" &&
          state.ops?.pending_attack?.optional_hq_card !== 641 &&
          !api.optionalCombatEventChoices(state, state.ops.pending_attack).length) {
        api.commitPendingAttack(state, state.ops.pending_attack);
        continue;
      }

      if (state.state === "defense_mo" && api.defenseMoChoicesComplete(state)) {
        api.startCombatCardCommitments(state);
        continue;
      }

      if (state.state === "movement") {
        const actions = stateActions(state);
        if (!(actions.move || []).length && actions.stop === 1) {
          api.stateEngine.dispatch(state, "stop");
          continue;
        }
        return;
      }

      if (state.state === "ops_move") {
        const actions = stateActions(state);
        if ((actions.select_move_unit || []).length === 1) {
          api.stateEngine.dispatch(state, "select_move_unit", actions.select_move_unit[0]);
          continue;
        }
        return;
      }

      if (state.state === "sr" && !state.sr?.selected_unit) {
        const actions = stateActions(state);
        if ((actions.select_sr_unit || []).length === 1) {
          api.stateEngine.dispatch(state, "select_sr_unit", actions.select_sr_unit[0]);
          return;
        }
        return;
      }

      if (isEventState(state.state)) {
        let actions = stateActions(state);
        if (state.pending_event?.kind === "veteran_upgrade" &&
            actions.replacement_to_eliminated === 1 &&
            actions.replacement_to_reserve !== 1 &&
            !(actions.event_space || []).length) {
          api.stateEngine.dispatch(state, "replacement_to_eliminated");
          continue;
        }
        if (state.pending_event?.kind === "front_investment" &&
            state.pending_event.mo &&
            !(actions.event_choose || []).length &&
            !(actions.front_unit_payment || []).length) {
          const faction = state.pending_event.faction;
          state.pending_event = null;
          state.phase = "补员/升级";
          state.state = "replacement";
          state.active = faction;
          state.replacement_active = faction;
          continue;
        }
        const automatic = mandatoryEventUnitSelection(state, actions);
        if (automatic?.length) {
          for (const id of automatic) {
            canonicalizeEventState(state);
            if (!isEventState(state.state)) break;
            const current = stateActions(state).select_event_unit || [];
            if (current.includes(id))
              api.stateEngine.dispatch(state, "select_event_unit", id);
          }
          actions = stateActions(state);
          canonicalizeEventState(state);
          if (isEventState(state.state) && actions.event_units_confirm === 1)
            api.stateEngine.dispatch(state, "event_units_confirm");
          continue;
        }
        return;
      }

      return;
    }
    throw new Error("Deterministic state progression did not settle");
  }

  return Object.freeze({ advanceDeterministicStates });
}

module.exports = { createDeterministicSystem };
