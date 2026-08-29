"use strict";

function createCombatEventSystem(api) {
  function beginMassAttritionEvent(state, card, operation) {
      const armies = (faction) => state.units
          .filter((unit) => unit.faction === faction && unit.type === "army");
      const vpOperation = api.cardSpecById[card.id]?.operations
          ?.find((candidate) => candidate.type === "vp");
      if (vpOperation?.amount) api.adjustVp(state, vpOperation.amount);
      state.pending_event = {
          card: card.id,
          faction: card.faction,
          owner: card.faction,
          chooser: api.AP,
          kind: "mass_attrition",
          operation: api.clone(operation),
          selections: { ap: [], cp: [] },
          initial: Object.fromEntries([api.AP, api.CP].map((faction) => {
              const units = armies(faction);
              return [faction, {
                  full: units.filter((unit) => !unit.reduced).map((unit) => unit.id),
                  reduced: units.filter((unit) => unit.reduced).map((unit) => unit.id),
              }];
          })),
          stage: "mo",
          early_vp: vpOperation?.amount || 0,
      };
      if (!massAttritionMoChoices(state).length)
          state.pending_event.stage = "losses";
      state.active = api.AP;
      api.enterEventFlow(state);
  }

  function massAttritionCandidates(state, faction) {
      const pending = state.pending_event;
      const initial = pending?.initial?.[faction];
      if (!initial)
          return [];
      const required = massAttritionRequired(state, pending, faction);
      return initial.full.length >= required
          ? initial.full.slice()
          : [...initial.full, ...initial.reduced];
  }

  function massAttritionRequired(state, pending, faction = state.active) {
      const initial = pending?.initial?.[faction] || { full: [], reduced: [] };
      return Math.min(
          pending.operation.full_armies_per_faction,
          initial.full.length + initial.reduced.length,
      );
  }

  function massAttritionMoChoices(state) {
      return Object.entries(state.mo.current || {})
          .filter(([nation]) => !["ge", "ah"].includes(nation))
          .flatMap(([nation, ids]) => (ids || [])
              .filter((id) => !api.moIsResolved(state, nation, id))
              .filter((id) => api.moDefinition(state, id)?.kind === "task")
              .map((id) => ({ nation, id })));
  }

  function frenchDoctrineCandidates(state, pending = null) {
      return api.forcedAttackCandidates(state, api.AP, pending?.spaces || [], {
          nation: "fr",
      });
  }

  function commitFrenchDoctrine(state, pending) {
      if (pending.spaces.length !== pending.required)
          throw new Error("Place every French offensive marker");
      const card = api.cardById[pending.card];
      const spaces = pending.spaces.slice();
      api.finishEvent(state, card);
      api.commitForcedAttackMarkers(state, {
          spaces,
          faction: api.AP,
          card: card.id,
          source: "event",
          sourceId: card.id,
          returnAfterForced: "ap_action",
          candidateOptions: { nation: "fr" },
          requiredOptions: { includeCompatibleHqs: true },
      });
  }

  function beginDesertionImmediateLoss(state, card) {
      const operation = api.cardSpecById[card.id]?.operations?.find((candidate) => candidate.type === "rule_modifier" && candidate.key === "desertion");
      if (!operation || !state.events[api.cardById[627].event])
          return false;
      const required = operation.cadorna_immediate_losses || 0;
      if (!required)
          return false;
      state.pending_event = {
          kind: "desertion_immediate",
          card: card.id,
          owner: card.faction,
          chooser: api.AP,
          required,
          branch: null,
          resume_ops_card: card.color === "yellow" ? card.id : null,
      };
      state.active = api.AP;
      api.enterEventFlow(state);
      return true;
  }

  return Object.freeze({
    beginDesertionImmediateLoss,
    beginMassAttritionEvent,
    commitFrenchDoctrine,
    frenchDoctrineCandidates,
    massAttritionCandidates,
    massAttritionMoChoices,
    massAttritionRequired,
  });
}

module.exports = { createCombatEventSystem };
