"use strict";

function createReplacementEventSystem(api) {
  function immediateRpGrant(state, card, wasPlayed, selectedOperations = [], extra = {}) {
      const operations = [
          ...(api.cardSpecById[card.id]?.operations || []),
          ...selectedOperations,
      ];
      const remaining = { ...extra };
      let optional = false;
      for (const operation of operations) {
          if (operation.type === "rp" && (operation.immediate || operation.immediate_choice)) {
              if (operation.unless_event && state.events[operation.unless_event])
                  continue;
              remaining[operation.nation] =
                  (remaining[operation.nation] || 0) + operation.amount;
              optional ||= Boolean(operation.immediate_choice);
          }
          if (operation.type === "rule_modifier" && operation.immediate_rp) {
              const amount = wasPlayed ? operation.later_rp : operation.first_rp;
              if (amount) {
                  remaining[operation.nation] =
                      (remaining[operation.nation] || 0) + amount;
              }
          }
      }
      return { remaining, optional };
  }

  function beginImmediateRpUse(state, card, wasPlayed, selectedOperations = [], extra = {}) {
      const grant = immediateRpGrant(state, card, wasPlayed, selectedOperations, extra);
      if (!Object.values(grant.remaining).some((amount) => amount > 0))
          return false;
      state.pending_event = {
          kind: "immediate_rp",
          card: card.id,
          owner: card.faction,
          chooser: card.faction,
          remaining: grant.remaining,
          mode: grant.optional ? "choice" : "spend",
          resume_naval: Boolean(state.naval.resolving),
          resume_ops_card: !state.naval.resolving && card.color === "yellow"
              ? card.id
              : null,
      };
      api.setActiveFaction(state, card.faction);
      api.enterEventFlow(state);
      return true;
  }

  function immediateReplacementOptions(state, pending = state.pending_event) {
      if (pending?.kind !== "immediate_rp" || pending.mode !== "spend")
          return [];
      const units = [...state.units, ...(state.eliminated[state.active] || [])];
      const options = [];
      for (const unit of units)
          // Immediately granted RP can repair or rebuild units, but veteran
          // replacement is reserved for the formal end-of-turn replacement
          // phase.
          for (const kind of ["flip", "rebuild"])
              for (const key of api.replacementKeys(unit)) {
                  const option = api.replacementOption(state, { kind, unit: unit.id, key });
                  if (option &&
                      option.cost > 0 &&
                      (pending.remaining[key] || 0) >= option.cost)
                      options.push({ kind, unit: unit.id, key, cost: option.cost });
              }
      return options;
  }

  function finishImmediateRpUse(state) {
      const pending = state.pending_event;
      if (pending?.kind !== "immediate_rp")
          throw new Error("No immediate RP event is pending");
      const resumeNaval = pending.resume_naval;
      const resumeOpsCard = pending.resume_ops_card;
      state.pending_event = null;
      if (resumeNaval)
          api.continueNavalEvents(state);
      else if (resumeOpsCard)
          api.beginOps(state, api.effectiveCard(state, api.cardById[resumeOpsCard]), false, { event: true });
      else
          api.nextFactionAction(state);
  }

  function chooseImmediateRpMode(state, id) {
      const pending = state.pending_event;
      if (pending?.kind !== "immediate_rp")
          throw new Error("No immediate RP event is pending");
      if (pending.mode === "choice") {
          if (id === "bank")
              return finishImmediateRpUse(state);
          if (id !== "spend")
              throw new Error("Invalid immediate RP choice");
          pending.mode = "spend";
          return;
      }
      if (id !== "done")
          throw new Error("Invalid immediate RP choice");
      finishImmediateRpUse(state);
  }

  function spendImmediateRp(state, token) {
      const pending = state.pending_event;
      const [kind, unit, key] = String(token).split(":");
      const choice = immediateReplacementOptions(state, pending).find((candidate) => candidate.kind === kind && candidate.unit === unit && candidate.key === key);
      if (!choice)
          throw new Error("Illegal immediate RP expenditure");
      const parent = api.clone(pending);
      api.spendReplacement(state, { kind, unit, key });
      if (state.pending_event?.kind === "replacement_rebuild") {
          state.pending_event.resume_immediate_rp = parent;
          state.pending_event.immediate_rp_key = key;
          state.pending_event.immediate_rp_cost = choice.cost;
          return;
      }
      pending.remaining[key] = Math.max(0, pending.remaining[key] - choice.cost);
  }

  function desertionImmediateCandidates(state, kind) {
      const type = kind === "lcu" ? "army" : "corps";
      return state.units
          .filter((unit) => unit.faction === api.AP && unit.nation === "it" &&
          unit.type === type && (kind !== "lcu" || !unit.reduced))
          .map((unit) => unit.id);
  }

  function italyEntryRestorationCandidates(state, pending = null) {
      const rule = pending?.operation || api.ruleModifier(api.cardById[625]);
      return [...state.units, ...(state.entry_reserve?.it || [])]
          .filter((unit) => unit.faction === api.AP &&
          unit.nation === rule.restore_nation &&
          unit.type === rule.restore_type &&
          unit.reduced)
          .map((unit) => unit.id);
  }

  return Object.freeze({
    beginImmediateRpUse,
    chooseImmediateRpMode,
    desertionImmediateCandidates,
    finishImmediateRpUse,
    immediateReplacementOptions,
    immediateRpGrant,
    italyEntryRestorationCandidates,
    spendImmediateRp,
  });
}

module.exports = { createReplacementEventSystem };
