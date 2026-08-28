"use strict";

function createActionSystem(api) {
  const commitmentRank = { mobilization: 0, limited: 1, total: 2 };

  function matchingTurnVariant(state, variants) {
      return (variants || []).find((variant) =>
          (variant.min_turn == null || state.turn >= variant.min_turn) &&
          (variant.max_turn == null || state.turn <= variant.max_turn)) || null;
  }

  function cardValues(state, card) {
      if (!card)
          return null;
      const variant = matchingTurnVariant(state, api.cardSpecById[card.id]?.values_by_turn);
      return {
          ops: Number(variant?.ops ?? card.ops) || 0,
          sr: Number(variant?.sr ?? card.sr) || 0,
          rp: api.clone(variant?.rp || card.rp || {}),
      };
  }

  function effectiveCard(state, card) {
      const values = cardValues(state, card);
      return card && values ? { ...card, ...values } : card;
  }

  function effectiveCombatEffect(state, cardOrId) {
      const card = typeof cardOrId === "object"
          ? cardOrId
          : api.cardById[Number(cardOrId)];
      const spec = api.cardSpecById[card?.id] || {};
      const base = api.clone(spec.combat || {});
      const variant = matchingTurnVariant(state, spec.combat_by_turn);
      if (!variant)
          return base;
      const disposition = base.disposition;
      const effect = variant.replace
          ? api.clone(variant.combat || {})
          : { ...base, ...api.clone(variant.combat || {}) };
      if (disposition && !effect.disposition)
          effect.disposition = disposition;
      return effect;
  }

  function obsoleteCardRuleApplies(state, card) {
      const obsolete = api.cardSpecById[card?.id]?.obsolete;
      if (!obsolete)
          return false;
      if (obsolete.commitment &&
          commitmentRank[state.commitment[card.faction]] >= commitmentRank[obsolete.commitment])
          return true;
      if (Number.isFinite(obsolete.after_turn) && state.turn > obsolete.after_turn)
          return true;
      return false;
  }

  function cardUseDisposition(state, card, use) {
      const spec = api.cardSpecById[card?.id] || {};
      if (spec.remove_if_event && state.events[spec.remove_if_event])
          return "remove";
      if (Number.isFinite(spec.remove_from_turn) &&
          state.turn >= spec.remove_from_turn &&
          (spec.remove_on_use || []).includes(use))
          return "remove";
      const obsolete = api.cardSpecById[card?.id]?.obsolete;
      if (obsoleteCardRuleApplies(state, card) && obsolete.remove_on_use?.includes(use))
          return "remove";
      if (use === "event")
          return spec.disposition === "remove" || card?.remove ? "remove" : "discard";
      if (use === "combat")
          return spec.combat?.disposition?.after_combat === "remove" ? "remove" : "discard";
      // A printed asterisk removes a card only when it is used as an event
      // (or as a combat card, via its explicit combat disposition).  OPS, SR,
      // RP, and Fleet uses go to the ordinary discard unless a conditional
      // rule above explicitly says otherwise.
      return "discard";
  }

  function placeUsedCard(state, card, use) {
      const disposition = cardUseDisposition(state, card, use);
      state[disposition === "remove" ? "removed" : "discard"][card.faction].push(card.id);
      return disposition;
  }
  

  function recordActionHistory(state, type, card = null) {
      state.action_history ||= [];
      const entry = {
          turn: state.turn,
          round: state.action_round,
          faction: state.active,
          type,
          card: card == null ? null : Number(card),
          log_cursor: state.log.length,
      };
      const existing = state.action_history.findIndex((candidate) => candidate.turn === entry.turn &&
          candidate.round === entry.round &&
          candidate.faction === entry.faction);
      if (existing >= 0)
          state.action_history[existing] = entry;
      else
          state.action_history.push(entry);
  }

  function clearCurrentActionHistory(state, faction = state.active) {
      state.action_history = (state.action_history || []).filter((entry) => entry.turn !== state.turn ||
          entry.round !== state.action_round ||
          entry.faction !== faction);
  }

  function noteFormalActionUse(state, use) {
      state.last_action_use ||= { ap: null, cp: null };
      state.last_action_use[state.active] = use;
  }

  function cardUse(state, id, use) {
      const hand = state.hands[state.active];
      const index = hand.indexOf(Number(id));
      if (index < 0)
          throw new Error("Card is not in the active hand");
      const card = api.cardById[Number(id)];
      if (!card || card.faction !== state.active)
          throw new Error("Invalid card");
      api.snapshot(state, `${card.title} / ${use}`);
      if (!state.naval.resolving && state.state === "action_card")
          recordActionHistory(state, use, card.id);
      if (!state.naval.resolving && state.state === "action_card") {
          if (use === "sr" && state.last_action_use?.[state.active] === "sr")
              throw new Error("The same faction cannot use SR on consecutive actions");
          if (use === "rp" && state.last_action_use?.[state.active] === "rp")
              throw new Error("The same faction cannot use RP on consecutive actions");
          noteFormalActionUse(state, use);
      }
      hand.splice(index, 1);
      const usedCard = effectiveCard(state, card);
      if (use === "ops") {
          placeUsedCard(state, card, use);
          api.beginOps(state, usedCard);
          return;
      }
      if (use === "sr") {
          placeUsedCard(state, card, use);
          state.sr = {
              card: card.id,
              remaining: Math.max(0, (api.ruleModifier(card)?.sr_value || usedCard.sr) - (state.turn <= 2 ? 1 : 0)),
              used_units: [],
              selected_unit: null,
          };
          state.state = "sr";
          api.log(state, `${card.title} 用于战略调动。`);
          return;
      }
      if (use === "rp") {
          for (const [nation, amount] of Object.entries(usedCard.rp))
              state.rp[state.active][nation] += amount;
          placeUsedCard(state, card, use);
          api.log(state, `${card.title} 用于补员。`);
          api.nextFactionAction(state);
          return;
      }
      if (use === "event") {
          api.resolveEvent(state, card);
          return;
      }
      throw new Error(`Unknown card use ${use}`);
  }

  function supplyWarningSpaces() {
      return api.data.spaces
          .filter((space) => !space.ui?.hidden)
          .map((space) => space.id);
  }

  function beginSupplyWarningEditor(state) {
      if (api.AUXILIARY_FLOW_STATES.has(state.state))
          throw new Error("A modal flow is already active");
      const existing = state.supply_warnings?.owner === state.active
          ? state.supply_warnings.spaces.slice()
          : [];
      state.supply_warning_editor = {
          owner: state.active,
          return_state: state.state,
          return_phase: state.phase,
          original_spaces: existing.slice(),
          selected: existing,
      };
      state.state = "flag_supply_warnings";
      state.phase = "标记补给警告";
  }

  function finishSupplyWarningEditor(state) {
      const editor = state.supply_warning_editor;
      if (!editor || editor.owner !== state.active)
          throw new Error("No supply-warning editor is active");
      const selected = [...new Set(editor.selected)].filter((id) => api.spaceById[id]);
      state.supply_warnings = selected.length
          ? { owner: editor.owner, spaces: selected }
          : null;
      state.state = editor.return_state;
      state.phase = editor.return_phase;
      state.supply_warning_editor = null;
  }

  function beginRollbackProposal(state, index) {
      index = Number(index);
      if (!Number.isInteger(index) || !state.rollback[index])
          throw new Error("Rollback checkpoint is no longer available");
      if (api.AUXILIARY_FLOW_STATES.has(state.state))
          throw new Error("A modal flow is already active");
      state.rollback_proposal = {
          proposer: state.active,
          reviewer: api.other(state.active),
          return_state: state.state,
          return_phase: state.phase,
          index,
      };
      state.active = api.other(state.active);
      state.state = "review_rollback_proposal";
      state.phase = "审查回滚提议";
  }

  function rejectRollbackProposal(state) {
      const proposal = state.rollback_proposal;
      if (!proposal || proposal.reviewer !== state.active)
          throw new Error("No rollback proposal is awaiting review");
      state.active = proposal.proposer;
      state.state = proposal.return_state;
      state.phase = proposal.return_phase;
      state.rollback_proposal = null;
  }

  function acceptRollbackProposal(state) {
      const proposal = api.clone(state.rollback_proposal);
      if (!proposal || proposal.reviewer !== state.active)
          throw new Error("No rollback proposal is awaiting review");
      const entry = state.rollback[proposal.index];
      if (!entry)
          throw new Error("Rollback checkpoint is no longer available");
      const rollback = state.rollback.slice();
      const message = `已回滚到：${entry.label}`;
      api.restoreSnapshot(state, entry);
      api.ensureState(state);
      state.rollback = rollback.slice(0, proposal.index);
      state.rollback_proposal = null;
      state.rollback_confirmation = {
          message,
          return_state: state.state,
          return_phase: state.phase,
      };
      state.state = "confirm_rollback";
      state.phase = "确认回滚";
  }

  function actionAllowed(state, current) {
      const faction = api.roleFaction(current);
      return faction && faction === state.active;
  }
return Object.freeze({
    acceptRollbackProposal,
    actionAllowed,
    beginRollbackProposal,
    beginSupplyWarningEditor,
    cardUseDisposition,
    cardValues,
    cardUse,
    clearCurrentActionHistory,
    noteFormalActionUse,
    effectiveCard,
    effectiveCombatEffect,
    finishSupplyWarningEditor,
    obsoleteCardRuleApplies,
    recordActionHistory,
    rejectRollbackProposal,
    supplyWarningSpaces,
  });
}

module.exports = { createActionSystem };
