"use strict";

function createMovementEventSystem(api) {
  function beginWhiteFeatherSearch(state, card, operation) {
      const candidates = [...state.decks.cp, ...state.discard.cp].filter((id) => {
          if (operation.cp_search.includes("war_industry") && id === 724)
              return true;
          const reinforcement = api.reinforcementOperation(api.cardById[id], state);
          return (operation.cp_search.includes("ge_reinforcement") &&
              reinforcement?.units?.some((unit) => api.pieceById[unit.piece]?.nation === "ge"));
      });
      if (!candidates.length)
          return false;
      state.pending_event = {
          card: card.id,
          faction: card.faction,
          owner: card.faction,
          chooser: card.faction,
          kind: "card_search",
          operation: api.clone(operation),
          cards: [...new Set(candidates)],
          locked: true,
      };
      api.setActiveFaction(state, card.faction);
      api.enterEventFlow(state);
      return true;
  }

  function beginWhiteFeatherSr(state, card, operation) {
      state.pending_event = {
          card: card.id,
          faction: card.faction,
          owner: card.faction,
          chooser: api.AP,
          kind: "white_feather_sr",
          operation: api.clone(operation),
          queue: Object.entries(operation.required_sr_corps || {})
              .flatMap(([nation, count]) => Array.from({ length: count }, () => nation)),
          index: 0,
          unit: null,
          locked: true,
      };
      api.setActiveFaction(state, api.AP);
      api.enterEventFlow(state);
      if (!state.pending_event.queue.length) {
          if (!beginWhiteFeatherSearch(state, card, operation))
              api.finishEvent(state, card);
      }
      return true;
  }

  function whiteFeatherUnitSpaces(state, unit) {
      const piece = api.pieceById[unit?.piece];
      if (!piece)
          return [];
      const movingUnit = {
          ...unit,
          faction: piece.faction,
          nation: piece.nation,
          type: piece.type,
      };
      const supplied = api.suppliedSpaces(state, api.AP, movingUnit);
      return api.data.spaces
          .filter((space) => supplied.has(space.id) &&
          state.control[space.id] === api.AP &&
          api.unitsAt(state, space.id, api.CP).length === 0 &&
          !space.ui?.hidden &&
          api.stackLegal(state, space.id, movingUnit))
          .map((space) => space.id);
  }

  function whiteFeatherCandidates(state, pending) {
      const nation = pending.queue[pending.index];
      if (!nation)
          return [];
      return state.reserves.ap
          .filter((unit) => {
          const piece = api.pieceById[unit.piece];
          return piece?.nation === nation && piece?.type === "corps" &&
              whiteFeatherUnitSpaces(state, unit).length > 0;
      })
          .map((unit) => unit.id);
  }

  function whiteFeatherSpaces(state, pending) {
      const unit = state.reserves.ap.find((candidate) => candidate.id === pending.unit);
      if (!unit)
          return [];
      return whiteFeatherUnitSpaces(state, unit);
  }

  function advanceWhiteFeatherSr(state, pending, card) {
      pending.unit = null;
      pending.index += 1;
      if (pending.index >= pending.queue.length &&
          !beginWhiteFeatherSearch(state, card, pending.operation))
          api.finishEvent(state, card);
  }

  function beginRegionalRotationEvent(state, card, operation) {
      state.pending_event = {
          card: card.id,
          faction: card.faction,
          owner: card.faction,
          chooser: card.faction,
          kind: "regional_rotation",
          operation: api.clone(operation),
          mode: null,
          remaining_step_rp: Number(operation.maximum_step_rp) || 0,
          gained_step_rp: 0,
          immediate_rp_extra: {},
      };
      api.setActiveFaction(state, card.faction);
      api.enterEventFlow(state);
  }

  function beginSpaceRuleEvent(state, card, operation) {
      state.pending_event = {
          card: card.id,
          faction: card.faction,
          owner: card.faction,
          chooser: card.faction,
          kind: "space_rule",
          operation: api.clone(operation),
          space: null,
      };
      api.setActiveFaction(state, card.faction);
      api.enterEventFlow(state);
  }

  function nearestEnemyUnitDistance(state, origin, faction) {
      const targets = new Set(state.units
          .filter((unit) => unit.faction === api.other(faction))
          .map((unit) => unit.location));
      if (!targets.size)
          return Number.POSITIVE_INFINITY;
      const seen = new Set([origin]);
      const queue = [[origin, 0]];
      while (queue.length) {
          const [space, distance] = queue.shift();
          if (targets.has(space))
              return distance;
          for (const next of api.landNeighbors(space)) {
              if (seen.has(next))
                  continue;
              seen.add(next);
              queue.push([next, distance + 1]);
          }
      }
      return Number.POSITIVE_INFINITY;
  }

  function isFrenchBorderSpace(spaceId) {
      return api.landNeighbors(spaceId).some((adjacent) => api.spaceById[adjacent]?.nation !== "fr");
  }

  function hindenburgMarkerCandidates(state, pending = state.pending_event) {
      const selected = new Set(pending?.markers || []);
      return api.data.spaces
          .filter((space) => space.nation === "fr" &&
          !space.ui?.hidden &&
          !space.vp &&
          !isFrenchBorderSpace(space.id) &&
          state.control[space.id] === api.CP &&
          api.unitsAt(state, space.id, api.CP).length > 0 &&
          !selected.has(space.id))
          .map((space) => space.id);
  }

  function hindenburgStackCandidates(state) {
      const spaces = [
          ...new Set(state.units
              .filter((unit) => unit.faction === api.CP && unit.nation === "ge")
              .map((unit) => unit.location)),
      ];
      return spaces.filter((space) => {
          const stack = api.unitsAt(state, space, api.CP);
          if (!stack.length || stack.some((unit) => unit.nation !== "ge"))
              return false;
          const ids = stack.map((unit) => unit.id);
          return api.groupMovementCanBegin(state, ids);
      });
  }

  function beginHindenburgLineEvent(state, card, operation) {
      state.pending_event = {
          card: card.id,
          faction: card.faction,
          owner: card.faction,
          chooser: card.faction,
          kind: "hindenburg_line",
          stage: "stack",
          operation: api.clone(operation),
          origin: null,
          current: null,
          units: [],
          path: [],
          routes_by_unit: {},
          endpoints_by_unit: {},
          origin_enemy_distance: null,
          markers: [],
      };
      api.setActiveFaction(state, card.faction);
      api.enterEventFlow(state);
  }

  function hindenburgMovementFrame(pending) {
      return {
          active_units: pending.units.slice(),
          path: pending.path.slice(),
          routes_by_unit: pending.routes_by_unit,
          endpoints_by_unit: pending.endpoints_by_unit,
      };
  }

  function hindenburgRetreatCandidates(state, pending = state.pending_event) {
      if (pending?.kind !== "hindenburg_line" || pending.stage !== "retreat")
          return [];
      return api.movementStepDestinations(state, hindenburgMovementFrame(pending));
  }

  function hindenburgCanStop(state, pending = state.pending_event) {
      if (pending?.kind !== "hindenburg_line" ||
          pending.stage !== "retreat" ||
          !pending.path.length)
          return false;
      const frame = hindenburgMovementFrame(pending);
      if (!api.movementEndpointLegal(state, frame, pending.units))
          return false;
      return (nearestEnemyUnitDistance(state, pending.current, api.CP) >=
          pending.origin_enemy_distance);
  }

  function selectHindenburgSpace(state, space) {
      const pending = state.pending_event;
      if (pending?.kind !== "hindenburg_line")
          throw new Error("Hindenburg Line is not active");
      if (pending.stage === "stack") {
          if (!hindenburgStackCandidates(state).includes(space))
              throw new Error("Illegal German stack");
          const units = api.unitsAt(state, space, api.CP);
          const ids = units.map((unit) => unit.id);
          pending.origin = space;
          pending.current = space;
          pending.units = ids;
          pending.origin_enemy_distance = nearestEnemyUnitDistance(state, space, api.CP);
          pending.routes_by_unit = Object.fromEntries(units.map((unit) => [unit.id, api.movementRoutes(state, unit, ids)]));
          pending.endpoints_by_unit = Object.fromEntries(units.map((unit) => [
              unit.id,
              [
                  ...new Set(pending.routes_by_unit[unit.id].map((route) => route.at(-1))),
              ],
          ]));
          pending.stage = "retreat";
          return;
      }
      if (pending.stage === "retreat") {
          if (!hindenburgRetreatCandidates(state, pending).includes(space))
              throw new Error("Illegal Hindenburg retreat step");
          const from = pending.current;
          for (const id of pending.units) {
              const unit = state.units.find((candidate) => candidate.id === id);
              if (!unit || unit.location !== from)
                  throw new Error("The German stack is no longer intact");
              unit.location = space;
          }
          pending.current = space;
          pending.path.push(space);
          api.log(state, `兴登堡防线撤退：${api.spaceById[from]?.name || from} → ${api.spaceById[space]?.name || space}。`);
          return;
      }
      if (pending.stage === "markers") {
          if (!hindenburgMarkerCandidates(state, pending).includes(space))
              throw new Error("Illegal Hindenburg Line marker space");
          pending.markers.push(space);
          return;
      }
      throw new Error("Hindenburg Line has no space selection now");
  }

  function addHindenburgDefenseMo(state, card, operation) {
      const addition = operation.add_mo;
      if (!addition)
          return;
      api.applyMoModification(state, card, {
          type: "mo_modify",
          nation: addition.nation,
          add: [
              {
                  key: "hindenburg_defense_drm",
                  name: addition.name,
                  description: addition.name,
                  kind: addition.kind || "passive",
                  duration: "game",
                  count: 1,
                  template_id: addition.template_id || "ge-7",
                  passive: "national_defense_drm",
                  drm: addition.defense_drm || 0,
              },
          ],
      });
  }

  function confirmHindenburgLine(state) {
      const pending = state.pending_event;
      const card = pending && api.cardById[pending.card];
      if (pending?.kind !== "hindenburg_line" || !card)
          throw new Error("Hindenburg Line is not active");
      if (pending.stage === "retreat") {
          if (!hindenburgCanStop(state, pending))
              throw new Error("The stack must stop at least as far from the nearest AP unit");
          state.trenches[pending.current] = Math.min(2, (state.trenches[pending.current] || 0) + 1);
          pending.stage = "markers";
          return;
      }
      if (pending.stage !== "markers" || pending.markers.length !== 2)
          throw new Error("Place both Hindenburg Line markers");
      state.markers.hindenburg ||= [];
      state.markers.hindenburg = [
          ...new Set([...state.markers.hindenburg, ...pending.markers]),
      ];
      addHindenburgDefenseMo(state, card, pending.operation);
      api.finishEvent(state, card);
  }

  function resumeEventAfterSr(state, resume) {
      const card = api.cardById[resume?.card];
      if (!card || !resume?.operation)
          throw new Error("Invalid event continuation after SR");
      beginSpaceRuleEvent(state, card, resume.operation);
  }

  function spaceRuleCandidates(state, pending) {
      if (pending.operation.key === "killing_ground")
          return api.data.spaces
              .filter((space) => space.fort &&
              space.nation === "fr" &&
              !state.destroyed_forts.includes(space.id))
              .map((space) => space.id);
      if (pending.operation.key === "hindenburg_line")
          return api.data.spaces
              .filter((space) => ["fr", "be", "ge"].includes(space.nation) &&
              state.control[space.id] === api.CP &&
              !space.ui?.hidden)
              .map((space) => space.id);
      if (pending.operation.key === "somme")
          return api.data.spaces
              .filter((space) => api.unitsAt(state, space.id, api.CP).some((unit) => unit.nation === "ge" && unit.type === "army") &&
              api.neighborsFor(space.id, "attack", api.AP).some((adjacent) =>
                  api.unitsAt(state, adjacent, api.AP).some((unit) =>
                      api.isCombatUnit(unit) &&
                      api.connectionAllows(unit.location, space.id, "attack", api.AP))))
              .map((space) => space.id);
      if (pending.operation.key === "august_guns" &&
          pending.operation.destroy_adjacent_belgian_fort)
          return api.data.spaces
              .filter((space) => space.fort &&
              space.nation === "be" &&
              !state.destroyed_forts.includes(space.id) &&
              api.neighborsFor(space.id, "move", api.CP).some((adjacent) => api.unitsAt(state, adjacent, api.CP).length))
              .filter((space) => api.unitsAt(state, space.id, api.AP)
                  .filter((unit) => unit.nation === "be" && unit.type === "corps")
                  .every((unit) => augustBelgianSpaces(state, {
                      space: space.id,
                      belgian_units: [unit.id],
                      belgian_index: 0,
                  }).length))
              .map((space) => space.id);
      return [];
  }

  function commitSpaceRule(state, pending) {
      if (pending.operation.key === "killing_ground") {
          state.markers.killing_ground = {
              space: pending.space,
              cost: pending.operation.escalating_ge_rp,
              destroy_vp: pending.operation.destroy_vp,
              source_card: pending.card,
          };
      }
      if (pending.operation.key === "hindenburg_line") {
          state.markers.hindenburg ||= [];
          if (!state.markers.hindenburg.includes(pending.space))
              state.markers.hindenburg.push(pending.space);
          state.trenches[pending.space] = Math.max(1, state.trenches[pending.space] || 0);
      }
      if (pending.operation.key === "somme")
          state.markers.somme = {
              space: pending.space,
              source_card: pending.card,
              turn: state.turn,
          };
      if (pending.operation.key === "august_guns" &&
          pending.operation.destroy_adjacent_belgian_fort) {
          if (!state.destroyed_forts.includes(pending.space))
              state.destroyed_forts.push(pending.space);
          pending.belgian_units = api.unitsAt(state, pending.space, api.AP)
              .filter((unit) => unit.nation === "be" && unit.type === "corps")
              .map((unit) => unit.id);
          pending.belgian_index = 0;
      }
  }

  function augustBelgianSpaces(state, pending) {
      const id = pending?.belgian_units?.[pending.belgian_index];
      const unit = state.units.find((candidate) => candidate.id === id);
      if (!unit)
          return [];
      return api.data.spaces
          .filter((space) => space.nation === "be" &&
              space.id !== pending.space &&
              state.control[space.id] === api.AP &&
              api.unitsAt(state, space.id, api.CP).length === 0 &&
              api.stackLegal(state, space.id, unit))
          .map((space) => space.id);
  }

  function commitAugustBelgianRelocation(state, pending, destination) {
      if (!augustBelgianSpaces(state, pending).includes(destination))
          throw new Error("Illegal Belgian redeployment space");
      const id = pending.belgian_units[pending.belgian_index];
      const unit = state.units.find((candidate) => candidate.id === id);
      const origin = unit.location;
      unit.location = destination;
      pending.belgian_index += 1;
      api.log(state, `八月炮火：${api.pieceById[unit.piece]?.name || id} ${api.spaceById[origin]?.name || origin} → ${api.spaceById[destination]?.name || destination}。`);
      if (pending.belgian_index >= pending.belgian_units.length) {
          pending.kind = "august_reposition";
          pending.units = [];
          pending.selected_units = [];
          pending.owner = api.CP;
          pending.chooser = api.CP;
          api.setActiveFaction(state, api.CP);
      }
  }

  function augustGunsUnits(state, pending) {
      if (!pending?.space)
          return [];
      const adjacent = new Set(api.neighborsFor(pending.space, "move", api.CP));
      const selected = pending.selected_units || [];
      return state.units
          .filter((unit) => unit.faction === api.CP &&
          adjacent.has(unit.location) &&
          !(pending.units || []).includes(unit.id) &&
          !selected.includes(unit.id) &&
          api.advanceGroupStackLegal(state, pending.space, [...selected, unit.id], api.CP))
          .map((unit) => unit.id);
  }

  function commitAugustGunsReposition(state, pending, destination) {
      const selected = (pending.selected_units || []).slice();
      if (destination !== pending.space ||
          !selected.length ||
          selected.some((id) => !state.units.some((unit) => unit.id === id) ||
              !api.neighborsFor(pending.space, "move", api.CP).includes(state.units.find((unit) => unit.id === id).location)) ||
          !api.advanceGroupStackLegal(state, pending.space, selected, api.CP))
          throw new Error("Illegal August Guns reposition group");
      for (const id of selected) {
          const unit = state.units.find((candidate) => candidate.id === id);
          const origin = unit.location;
          unit.location = pending.space;
          if (!pending.units.includes(id))
              pending.units.push(id);
          api.log(state, `八月炮火重部署：${api.pieceById[unit.piece]?.name || id} ${api.spaceById[origin]?.name || origin} → ${api.spaceById[pending.space]?.name || pending.space}。`);
      }
      // August Guns destroys the fort before the CP stack is redeployed.  The
      // ordinary fort-destruction helper therefore cannot see an occupier at
      // that earlier point.  Capture the now-empty destroyed fort as soon as
      // the first CP combat unit enters it, then refresh supply through the
      // newly controlled space.
      if (selected.some((id) => {
          const unit = state.units.find((candidate) => candidate.id === id);
          return unit && api.isCombatUnit(unit);
      }))
          api.captureSpace(state, pending.space, api.CP);
      api.updateSupply(state);
      pending.selected_units = [];
  }

  function regionalRotationCandidates(state, pending = state.pending_event) {
      const maximum = Number(pending?.operation?.maximum_step_rp) || 1;
      const remaining = pending?.mode === "reduce"
          ? Number(pending.remaining_step_rp ?? maximum)
          : maximum;
      return state.units
          .filter((unit) => unit.faction === api.AP && unit.nation === "fr" &&
              api.isCombatUnit(unit) && !unit.reduced &&
              api.acceptsReplacementPoints(unit) &&
              api.unitRepairCost(unit) <= remaining + 1e-9)
          .map((unit) => unit.id);
  }

  return Object.freeze({
    addHindenburgDefenseMo,
    advanceWhiteFeatherSr,
    augustBelgianSpaces,
    augustGunsUnits,
    beginHindenburgLineEvent,
    beginWhiteFeatherSr,
    beginRegionalRotationEvent,
    beginSpaceRuleEvent,
    beginWhiteFeatherSearch,
    commitAugustGunsReposition,
    commitAugustBelgianRelocation,
    commitSpaceRule,
    confirmHindenburgLine,
    hindenburgCanStop,
    hindenburgMarkerCandidates,
    hindenburgMovementFrame,
    hindenburgRetreatCandidates,
    hindenburgStackCandidates,
    isFrenchBorderSpace,
    nearestEnemyUnitDistance,
    regionalRotationCandidates,
    resumeEventAfterSr,
    selectHindenburgSpace,
    spaceRuleCandidates,
    whiteFeatherCandidates,
    whiteFeatherSpaces,
  });
}

module.exports = { createMovementEventSystem };
