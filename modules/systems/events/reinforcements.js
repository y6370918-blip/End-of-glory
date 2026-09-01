"use strict";

function createReinforcementEventSystem(api) {
  function reinforcementPieceExists(state, piece) {
      return [
          state.units,
          state.reserves.ap,
          state.reserves.cp,
          state.upgrade_pool.ap,
          state.upgrade_pool.cp,
          state.eliminated.ap,
          state.eliminated.cp,
          state.hq_turn_track?.ap || [],
          state.hq_turn_track?.cp || [],
          state.permanently_removed_units || [],
      ].some((pool) => pool.some((unit) => unit.piece === piece));
  }

  function delayedUnitOperation(card) {
      return (api.cardSpecById[card.id]?.operations?.find((operation) => operation.type === "delay_units") || null);
  }

  function beginDelayedUnitEvent(state, card, operation) {
      const queue = operation.groups.flatMap((group) => Array.from({ length: group.count }, () => ({ types: group.types })));
      state.pending_event = {
          card: card.id,
          faction: card.faction,
          owner: card.faction,
          chooser: operation.chooser,
          kind: "delay_units",
          operation: api.clone(operation),
          queue,
          index: 0,
          units: [],
      };
      api.setActiveFaction(state, operation.chooser);
      api.enterEventFlow(state);
      api.log(state, `${card.title}：选择暂时调离地图的单位。`);
  }

  function delayedUnitCandidates(state, pending) {
      const requirement = pending.queue[pending.index];
      if (!requirement)
          return [];
      const usedSpaces = new Set(pending.units
          .map((id) => state.units.find((unit) => unit.id === id)?.location)
          .filter(Boolean));
      return state.units
          .filter((unit) => unit.faction === pending.operation.target_faction)
          .filter((unit) => requirement.types.includes(unit.type))
          .filter((unit) => api.spaceById[unit.location]?.nation === pending.operation.location_nation)
          .filter((unit) => !pending.units.includes(unit.id))
          .filter((unit) => !pending.operation.distinct_spaces || !usedSpaces.has(unit.location))
          .map((unit) => unit.id);
  }

  function delayedUnitSelectionAvailable(state, operation) {
      const queue = operation.groups.flatMap((group) =>
          Array.from({ length: group.count }, () => ({ types: group.types })));
      function search(index, selected, usedSpaces) {
          if (index >= queue.length)
              return true;
          const requirement = queue[index];
          for (const unit of state.units) {
              if (unit.faction !== operation.target_faction ||
                  !requirement.types.includes(unit.type) ||
                  api.spaceById[unit.location]?.nation !== operation.location_nation ||
                  selected.has(unit.id) ||
                  (operation.distinct_spaces && usedSpaces.has(unit.location)))
                  continue;
              selected.add(unit.id);
              usedSpaces.add(unit.location);
              if (search(index + 1, selected, usedSpaces))
                  return true;
              selected.delete(unit.id);
              usedSpaces.delete(unit.location);
          }
          return false;
      }
      return search(0, new Set(), new Set());
  }

  function commitDelayedUnits(state, pending) {
      const units = pending.units
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(Boolean);
      if (units.length !== pending.queue.length)
          throw new Error("Select every delayed unit");
      const existingOrphans = new Set(api.orphanHqs(state).map((hq) => hq.id));
      const affectedSpaces = new Set(units.map((unit) => unit.location).filter(Boolean));
      for (const unit of units)
          state.units.splice(state.units.findIndex((candidate) => candidate.id === unit.id), 1);
      state.scheduled_events.push({
          kind: "return_units",
          source_card: pending.card,
          due_turn: state.turn + pending.operation.return_after_turns,
          faction: pending.operation.target_faction,
          placement: pending.operation.return_placement,
          units: units.map((unit) => {
              const copy = api.clone(unit);
              delete copy.location;
              return copy;
          }),
      });
      return api.orphanHqs(state)
          .filter((hq) => affectedSpaces.has(hq.location) && !existingOrphans.has(hq.id))
          .map((hq) => hq.id);
  }

  function beginReinforcementEvent(state, card, operation) {
      const nextUnitIdBefore = state.next_unit_id;
      const queue = [];
      const placements = [];
      const navalMapSpace = state.naval.resolving
          ? operation.naval_map_space
          : null;
      if (navalMapSpace) {
          const space = api.spaceById[navalMapSpace];
          if (!space ||
              state.control[navalMapSpace] !== card.faction ||
              api.unitsAt(state, navalMapSpace, api.other(card.faction)).length)
              throw new Error("Naval reinforcement space is not available");
      }
      const conditionalFull = operation.conditional_full &&
          (((operation.conditional_full.occupied_spaces || []).some((space) =>
              state.control[space] === api.other(card.faction))) ||
              (operation.conditional_full.occupied_nation &&
                  api.data.spaces.some((space) =>
                      space.nation === operation.conditional_full.occupied_nation &&
                      state.control[space.id] === api.other(card.faction))) ||
              state.events[api.cardById[operation.conditional_full.event_card]?.event]);
      for (const [definitionIndex, unit] of (operation.units || []).entries()) {
          if (unit.unique && reinforcementPieceExists(state, unit.piece))
              continue;
          const piece = api.pieceById[unit.piece];
          const selectableReserveScu = unit.to === "reserve" && piece?.type === "corps";
          if (unit.to === "map" || selectableReserveScu)
              for (let copyIndex = 0; copyIndex < unit.count; copyIndex++) {
                  const current = {
                      piece: unit.piece,
                      reduced: conditionalFull ? false : Boolean(unit.reduced),
                      definition_index: definitionIndex,
                      copy_index: copyIndex,
                      reserve_optional: selectableReserveScu,
                      placement: unit.placement || null,
                      map_spaces: Array.isArray(unit.map_spaces)
                          ? unit.map_spaces.slice()
                          : null,
                  };
                  if (unit.to === "map" && navalMapSpace) {
                      current.id = `u${state.next_unit_id++}`;
                      placements.push({
                          id: current.id,
                          piece: current.piece,
                          reduced: current.reduced,
                          definition_index: definitionIndex,
                          copy_index: copyIndex,
                          destination: "map",
                          space: navalMapSpace,
                      });
                  }
                  else
                      queue.push(current);
              }
      }
      state.pending_event = {
          card: card.id,
          faction: card.faction,
          owner: card.faction,
          chooser: card.faction,
          kind: "reinforcement",
          operation: api.clone(operation),
          naval_event: Boolean(state.naval.resolving),
          queue,
          index: 0,
          placements,
          next_unit_id_before: nextUnitIdBefore,
      };
      api.setActiveFaction(state, card.faction);
      api.enterEventFlow(state);
      api.log(state, `${card.title}：逐个选择增援部署地区。`);
  }

  function reinforcementPlacementId(state, current) {
      if (!current.id)
          current.id = `u${state.next_unit_id++}`;
      return current.id;
  }

  function reinforcementReduced(state, pending, piece, reduced, destination) {
      let result = Boolean(reduced);
      if (state.turn_flags.british_reinforcements_reduced === state.turn &&
          piece.nation === "br" &&
          piece.type === "army" &&
          destination === "map")
          result = true;
      if (pending.operation.reduced_armies_unless_event &&
          !state.events[pending.operation.reduced_armies_unless_event] &&
          piece.type === "army")
          result = true;
      if (piece.nation === "it" && !state.events.entry_it && destination === "map")
          result = true;
      return result;
  }

  function stagedReinforcementView(state) {
      const pending = state.pending_event;
      const staged = { units: [], reserves: { ap: [], cp: [] } };
      if (pending?.kind === "aef_replacements") {
          for (let index = 0; index < (pending.placements || []).length; index++) {
              const source = pending.units[index];
              const placement = pending.placements[index];
              if (!source || !placement)
                  continue;
              const unit = {
                  ...api.clone(source),
                  staged: true,
                  supplied: true,
              };
              if (placement.destination === "map") {
                  unit.location = placement.space;
                  staged.units.push(unit);
              }
              else {
                  delete unit.location;
                  staged.reserves.ap.push(unit);
              }
          }
          return staged;
      }
      if (!["reinforcement", "reinforcement_rebuild"].includes(pending?.kind))
          return staged;
      for (const placement of pending.placements || []) {
          if (!placement.id)
              continue;
          const piece = api.pieceById[placement.piece];
          if (!piece)
              continue;
          const destination = placement.destination || "map";
          const unit = {
              id: placement.id,
              piece: placement.piece,
              faction: piece.faction,
              nation: piece.nation,
              type: piece.type,
              reduced: reinforcementReduced(state, pending, piece, placement.reduced, destination),
              moved: false,
              attacked: false,
              supplied: true,
              staged: true,
          };
          if (destination === "map") {
              unit.location = placement.space;
              staged.units.push(unit);
          }
          else if (destination === "reserve")
              staged.reserves[piece.faction].push(unit);
      }
      for (const placement of pending.rebuild_placements || []) {
          const source = state.eliminated[pending.operation.rebuild.faction]
              .find((unit) => unit.id === placement.id);
          if (!source)
              continue;
          const unit = {
              ...api.clone(source),
              reduced: true,
              moved: false,
              attacked: false,
              supplied: true,
              staged: true,
          };
          if (placement.destination === "map") {
              unit.location = placement.space;
              staged.units.push(unit);
          }
          else {
              delete unit.location;
              staged.reserves[unit.faction].push(unit);
          }
      }
      return staged;
  }

  function distanceFromAny(startIds, target, maximum) {
      if (startIds.includes(target))
          return 0;
      const seen = new Set(startIds);
      const queue = startIds.map((space) => ({ space, distance: 0 }));
      while (queue.length) {
          const current = queue.shift();
          if (current.distance >= maximum)
              continue;
          for (const next of api.landNeighbors(current.space)) {
              if (seen.has(next))
                  continue;
              if (next === target)
                  return current.distance + 1;
              seen.add(next);
              queue.push({ space: next, distance: current.distance + 1 });
          }
      }
      return Number.POSITIVE_INFINITY;
  }

  function normalReinforcementMapSpace(state, faction, piece, space) {
      return api.placementSources(
          state,
          { ...piece, faction },
          "reinforcement",
      ).includes(space.id);
  }

  function reinforcementStackAllows(state, pending, piece, space, placements) {
      const faction = piece.faction || pending.owner;
      const assigned = placements
          .map((entry) => ({ ...entry, piece: api.pieceById[entry.piece] }))
          .filter((entry) => entry.space === space.id);
      const existing = api.unitsAt(state, space.id, faction);
      const field = existing.filter((unit) => unit.type !== "hq").length +
          assigned.filter((entry) => entry.piece?.type !== "hq").length;
      const hq = existing.filter((unit) => unit.type === "hq").length +
          assigned.filter((entry) => entry.piece?.type === "hq").length;
      if (piece.type !== "hq")
          return space.large_area || field < 3;
      const nationality = api.nationalityGroup(piece.nation);
      const nationalStack = existing.some((unit) => api.isCombatUnit(unit) &&
          api.nationalityGroup(unit.nation) === nationality) ||
          assigned.some((entry) => ["army", "corps"].includes(entry.piece?.type) &&
              api.nationalityGroup(entry.piece?.nation) === nationality);
      return (space.large_area || hq < 1) &&
          (nationalStack || normalReinforcementMapSpace(state, faction, piece, space));
  }

  function reinforcementMapSpaces(state, pending, piece, placement, placements) {
      const faction = piece.faction || pending.owner;
      const mapTheater = pending.operation.map_theater || null;
      const direct = api.data.spaces
          .filter((space) => !space.ui?.hidden)
          .filter((space) => !mapTheater || api.theaterOf(space.id) === mapTheater)
          .filter((space) => api.unitsAt(state, space.id, api.other(faction)).length === 0)
          .filter((space) => {
          if (placement === "friendly_occupied")
              return api.unitsAt(state, space.id, faction).length > 0;
          if (placement === "italian_front")
              return space.nation === "it" && state.control[space.id] === faction;
          if (["ap_port_or_supply", "normal_reinforcement"].includes(placement))
              return state.control[space.id] === faction &&
                  normalReinforcementMapSpace(state, faction, piece, space);
          if (placement === "national_supply")
              return state.control[space.id] === faction &&
                  normalReinforcementMapSpace(state, faction, piece, space);
          if (placement === "within_sources")
              return (state.control[space.id] === faction &&
                  distanceFromAny(pending.operation.sources || [], space.id, pending.operation.max_distance || 0) <= (pending.operation.max_distance || 0));
          return space.supply && state.control[space.id] === faction;
      });
      const result = new Set(direct
          .filter((space) => reinforcementStackAllows(state, pending, piece, space, placements))
          .map((space) => space.id));
      if (["ap_port_or_supply", "normal_reinforcement", "national_supply"].includes(placement))
          for (const source of direct) {
              if (source.port || reinforcementStackAllows(state, pending, piece, source, placements))
                  continue;
              for (const adjacent of api.landNeighbors(source.id)) {
                  const space = api.spaceById[adjacent];
                  if (space && !space.ui?.hidden &&
                      (!mapTheater || api.theaterOf(adjacent) === mapTheater) &&
                      state.control[adjacent] === faction &&
                      !api.unitsAt(state, adjacent, api.other(faction)).length &&
                      reinforcementStackAllows(state, pending, piece, space, placements))
                      result.add(adjacent);
              }
          }
      return [...result];
  }

  function reinforcementSpaces(state, pending) {
      const current = pending.queue[pending.index];
      if (!current)
          return [];
      const piece = api.pieceById[current.piece];
      const spaces = reinforcementMapSpaces(
          state,
          pending,
          piece,
          current.placement || pending.operation.placement,
          pending.placements || [],
      );
      return current.map_spaces?.length
          ? spaces.filter((space) => current.map_spaces.includes(space))
          : spaces;
  }

  function reinforcementRebuildSpaces(state, pending, index = pending.rebuild_index || 0) {
      const id = pending.selected_units?.[index];
      const unit = state.eliminated[pending.operation.rebuild.faction]
          .find((candidate) => candidate.id === id);
      if (!unit)
          return [];
      const placements = [
          ...(pending.placements || []),
          ...(pending.rebuild_placements || []).slice(0, index).map((entry) => ({
              ...entry,
              piece: unit.id === entry.id
                  ? unit.piece
                  : state.eliminated[pending.operation.rebuild.faction]
                      .find((candidate) => candidate.id === entry.id)?.piece,
          })),
      ];
      const spaces = reinforcementMapSpaces(
          state,
          pending,
          api.pieceById[unit.piece],
          pending.operation.rebuild.placement || "normal_reinforcement",
          placements,
      );
      return spaces;
  }

  function navalPostFortificationSpaces(state, pending) {
      const rule = pending?.naval_event && pending.operation.naval_post_fortification;
      if (!rule)
          return [];
      const selected = new Set(pending.post_fortification_spaces || []);
      return api.data.spaces
          .filter((space) => !space.ui?.hidden && !selected.has(space.id))
          .filter((space) => state.control[space.id] === rule.faction)
          .filter((space) => !rule.requires_no_trench || !(state.trenches[space.id] > 0))
          .map((space) => space.id);
  }

  function commitNavalPostFortifications(state, pending) {
      const rule = pending?.naval_event && pending.operation.naval_post_fortification;
      if (!rule)
          return;
      const spaces = pending.post_fortification_spaces || [];
      if (spaces.length !== rule.count || new Set(spaces).size !== spaces.length)
          throw new Error("Select every naval fortification space");
      const legal = new Set(navalPostFortificationSpaces(state, {
          ...pending,
          post_fortification_spaces: [],
      }));
      if (spaces.some((space) => !legal.has(space)))
          throw new Error("Illegal naval fortification space");
      for (const space of spaces)
          state.fortifications[space] = Math.min(6, (state.fortifications[space] || 0) + rule.amount);
  }

  function piaveExchangeCandidates(state, pending = state.pending_event) {
      const exchange = pending?.operation?.exchange;
      const current = pending?.queue?.[pending.index];
      if (pending?.kind !== "reinforcement" ||
          !exchange ||
          !exchange.incoming_pieces.includes(current?.piece) ||
          pending.exchange)
          return [];
      const used = new Set((pending.placements || [])
          .map((placement) => placement.exchange_unit)
          .filter(Boolean));
      return state.units
          .filter((unit) => !used.has(unit.id) &&
          unit.nation === exchange.nation &&
          unit.type === exchange.type &&
          api.theaterOf(unit.location) === "italian")
          .filter((unit) => piaveReturnSpaces(state, pending, unit.id).length)
          .map((unit) => unit.id);
  }

  function piaveReturnSpaces(state, pending = state.pending_event, unitId = null) {
      const id = unitId || pending?.exchange;
      const unit = state.units.find((candidate) => candidate.id === id);
      if (!unit)
          return [];
      return api.supplySources(state, api.AP, unit).filter((space) => state.control[space] === api.AP && api.stackLegal(state, space, unit));
  }

  function selectPiaveExchange(state, token) {
      const pending = state.pending_event;
      const [kind, id] = String(token).split(":");
      if (kind !== "exchange" || !piaveExchangeCandidates(state, pending).includes(id))
          throw new Error("Invalid Piave exchange");
      pending.exchange = id;
  }

  function commitPiaveExchangeDestination(state, pending, space) {
      if (!piaveReturnSpaces(state, pending).includes(space))
          throw new Error("Invalid Italian supply-source destination");
      const current = pending.queue[pending.index];
      const italian = state.units.find((unit) => unit.id === pending.exchange);
      pending.placements.push({
          id: reinforcementPlacementId(state, current),
          piece: current.piece,
          reduced: current.reduced,
          definition_index: current.definition_index,
          copy_index: current.copy_index,
          destination: "map",
          space: italian.location,
          exchange_unit: italian.id,
          return_space: space,
      });
      pending.index += 1;
      delete pending.exchange;
  }

  function commitReinforcements(state, pending) {
      const operation = pending.operation;
      const decisions = new Map(pending.placements.map((entry) => [
          `${entry.definition_index}:${entry.copy_index}`,
          entry,
      ]));
      const created = [];
      for (const decision of pending.placements.filter((entry) => entry.exchange_unit)) {
          const unit = state.units.find((candidate) => candidate.id === decision.exchange_unit);
          if (!unit ||
              unit.location !== decision.space ||
              !piaveReturnSpaces(state, { ...pending, exchange: unit.id }, unit.id).includes(decision.return_space))
              throw new Error("Piave exchange is no longer legal");
          unit.location = decision.return_space;
      }
      for (const [definitionIndex, definition] of (operation.units || []).entries()) {
          if (definition.unique && reinforcementPieceExists(state, definition.piece))
              continue;
          const piece = api.pieceById[definition.piece];
          for (let copyIndex = 0; copyIndex < definition.count; copyIndex++) {
              const decision = decisions.get(`${definitionIndex}:${copyIndex}`);
              const destination = decision?.destination || definition.to;
              const queued = pending.queue.find((entry) => entry.definition_index === definitionIndex &&
                  entry.copy_index === copyIndex);
              const id = decision?.id || queued?.id || `u${state.next_unit_id++}`;
              const unit = {
                  id,
                  piece: definition.piece,
                  faction: piece.faction,
                  nation: piece.nation,
                  type: piece.type,
                  reduced: reinforcementReduced(state, pending, piece, decision?.reduced ?? Boolean(definition.reduced), destination),
                  moved: false,
                  attacked: false,
                  supplied: true,
                  reinforcement_card: pending.card,
              };
              created.push(unit);
              if (destination === "map") {
                  if (!decision?.space)
                      throw new Error("Reinforcement map placement is missing");
                  unit.location = decision.space;
                  state.units.push(unit);
              }
              else {
                  const pool = destination === "upgrade"
                      ? state.upgrade_pool[piece.faction]
                      : destination === "eliminated"
                          ? state.eliminated[piece.faction]
                          : state.reserves[piece.faction];
                  pool.push(unit);
              }
          }
      }
      return created;
  }

  function reinforcementRebuildCandidates(state, pending) {
      const rebuild = pending.operation.rebuild;
      return (state.eliminated[rebuild.faction] || [])
          .filter((unit) => !rebuild.nation || unit.nation === rebuild.nation)
          .filter((unit) => ["army", "corps"].includes(unit.type))
          .map((unit) => unit.id);
  }

  function commitReinforcementRebuild(state, pending) {
      const rebuild = pending.operation.rebuild;
      const legal = new Set(reinforcementRebuildCandidates(state, pending));
      const ids = pending.selected_units || [];
      if (ids.length > rebuild.count ||
          new Set(ids).size !== ids.length ||
          ids.some((id) => !legal.has(id)) ||
          (pending.rebuild_placements || []).length !== ids.length)
          throw new Error("Invalid reinforcement rebuild");
      for (let index = 0; index < ids.length; index++) {
          const id = ids[index];
          const placement = pending.rebuild_placements[index];
          if (placement.destination === "map" &&
              !reinforcementRebuildSpaces(state, pending, index).includes(placement.space))
              throw new Error("Illegal reinforcement rebuild space");
          if (placement.destination === "reserve") {
              const candidate = state.eliminated[rebuild.faction].find((unit) => unit.id === id);
              if (candidate?.type !== "corps")
                  throw new Error("Only an SCU may rebuild into the reserve box");
          }
      }
      for (let index = 0; index < ids.length; index++) {
          const id = ids[index];
          const placement = pending.rebuild_placements[index];
          const pool = state.eliminated[rebuild.faction];
          const poolIndex = pool.findIndex((unit) => unit.id === id);
          const [unit] = pool.splice(poolIndex, 1);
          api.hydrateUnit(unit);
          delete unit.location;
          unit.reduced = Boolean(rebuild.reduced);
          if (placement.destination === "reserve") {
              api.normalizeOffMapUnit(unit);
              state.reserves[rebuild.faction].push(unit);
          }
          else {
              unit.location = placement.space;
              unit.moved = false;
              unit.attacked = false;
              state.units.push(unit);
          }
      }
  }

  function optionalDeploySpaces(state, pending) {
      const unit = pending.units[pending.index];
      if (!unit)
          return [];
      return api.data.spaces
          .filter((space) => space.nation === pending.operation.optional_deploy.nation &&
          state.control[space.id] === pending.owner &&
          !space.ui?.hidden &&
          api.unitsAt(state, space.id, api.other(pending.owner)).length === 0 &&
          api.stackLegal(state, space.id, unit))
          .map((space) => space.id);
  }

  function commitOptionalDeployment(state, pending) {
      const cost = pending.operation.optional_deploy.rp;
      if (state.rp[cost.faction][cost.nation] < cost.amount)
          throw new Error("Insufficient RP");
      state.rp[cost.faction][cost.nation] -= cost.amount;
      for (let index = 0; index < pending.units.length; index++) {
          const unit = pending.units[index];
          const pool = state.eliminated[unit.faction];
          const poolIndex = pool.findIndex((candidate) => candidate.id === unit.id);
          if (poolIndex < 0)
              throw new Error("Optional reinforcement is no longer eliminated");
          pool.splice(poolIndex, 1);
          unit.location = pending.placements[index].space;
          state.units.push(unit);
      }
  }

  return Object.freeze({
    beginDelayedUnitEvent,
    beginReinforcementEvent,
    commitDelayedUnits,
    commitNavalPostFortifications,
    commitOptionalDeployment,
    commitPiaveExchangeDestination,
    commitReinforcementRebuild,
    commitReinforcements,
    delayedUnitCandidates,
    delayedUnitOperation,
    delayedUnitSelectionAvailable,
    distanceFromAny,
    optionalDeploySpaces,
    piaveExchangeCandidates,
    piaveReturnSpaces,
    reinforcementPlacementId,
    reinforcementRebuildCandidates,
    reinforcementRebuildSpaces,
    reinforcementReduced,
    reinforcementSpaces,
    navalPostFortificationSpaces,
    normalReinforcementMapSpace,
    selectPiaveExchange,
    stagedReinforcementView,
  });
}

module.exports = { createReinforcementEventSystem };
