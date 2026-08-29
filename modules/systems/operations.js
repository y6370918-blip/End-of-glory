"use strict";

function reason(code, label = null, importance = "normal") {
  return { code, label, importance };
}

function createOperationsSystem(api) {
  function candidateSpaces(state, action, origins) {
    if (action === "sr_destination") {
      const id = state.sr?.selected_unit;
      const unit = state.units.find((candidate) => candidate.id === id) ||
        state.reserves[state.active]?.find((candidate) => candidate.id === id);
      if (!unit) return [];
      if (!unit.location)
        return api.data.spaces.filter((space) => !space.ui?.hidden)
          .map((space) => space.id);
      return [...new Set([
        ...api.suppliedSpaces(state, unit.faction, unit.nation),
        ...api.landNeighbors(unit.location),
      ])];
    }
    if (action === "advance_destination") {
      const pending = state.pending_retreat;
      return [
        pending?.target,
        ...(pending?.retreat_paths || []).flatMap((path) => path || []),
      ].filter(Boolean);
    }
    return [...origins].flatMap((origin) => api.landNeighbors(origin));
  }

  function explainSpace(state, action, destination, origins) {
    const faction = state.active;
    if (!api.spaceById[destination]) return reason("rule_forbidden", "地图中不存在该地区");
    if (!api.spaceCanActivate(state, destination)) return reason("theater_inactive", null, "important");
    if (action === "move") {
      const movement = movementContext(state);
      if (![...origins].some((origin) => api.connectionAllows(origin, destination, "move", faction)))
        return reason("connection_mode");
      if (!canOccupyByEarlyWarDepth(state, faction, destination))
        return reason("early_occupation_depth", "超出占领纵深", "important");
      if (api.unitsAt(state, destination, api.other(faction)).length)
        return reason("enemy_blocked");
      const moving = (movement?.active_units || [])
        .map((id) => state.units.find((unit) => unit.id === id)).filter(Boolean);
      if (moving.some((unit) => !canPotentiallyEnterFort(state, unit, destination, movement.path.length + 1)))
        return reason("fort_blocked", "当前编队不足以进入该敌方要塞");
      if (moving.some((unit) => !earlyEntryAllowed(state, unit, destination)))
        return reason("event_restriction", "回合或战区限制禁止进入该地区", "important");
      if (!groupStepKeepsHqsResolvable(state, movement, destination))
        return reason("hq_escort", "该步会令将领失去合格护送");
      const routeMatches = (movement?.active_units || []).every((id) =>
        (movement.routes_by_unit?.[id] || []).some((route) =>
          route.length > movement.path.length &&
          routeHasPrefix(route, movement.path) &&
          route[movement.path.length] === destination));
      if (!routeMatches) return reason("movement_points");
      if (!groupStepCanOccupy(state, movement, destination) &&
          !groupCanLeaveDestination(movement, destination))
        return reason("overstack", "编队既不能在此合法停下，也没有共同的下一步");
      return reason("rule_forbidden", "编队没有共同合法的后续路径");
    }
    if (action === "sr_destination") {
      const id = state.sr?.selected_unit;
      const unit = state.units.find((candidate) => candidate.id === id) ||
        state.reserves[state.active]?.find((candidate) => candidate.id === id);
      if (!unit) return reason("rule_forbidden", "尚未选择战略调动单位");
      if (unit.location && !unit.supplied) return reason("supply");
      if (!earlySrDestinationAllowed(state, unit, destination))
        return reason("event_restriction", "当前回合或事件限制该战略调动目的地", "important");
      if (!crossTheaterSrDestinationAllowed(state, unit, destination))
        return reason("theater_inactive", "该单位不能跨战区战略调动", "important");
      if (!api.stackLegal(state, destination, unit)) return reason("overstack");
      if (!api.friendlySpace(state, destination, faction)) return reason("control_blocked");
      return reason("rule_forbidden", "目的地不在该单位的合法补给或运输网络中");
    }
    if (action === "retreat_destination") {
      if (![...origins].some((origin) => api.connectionAllows(origin, destination, "retreat", faction)))
        return reason("connection_mode");
      if (api.unitsAt(state, destination, api.other(faction)).length)
        return reason("enemy_blocked");
      if (api.intactFort(state, destination) && api.spaceById[destination]?.faction === api.other(faction) && !state.besieged.includes(destination))
        return reason("fort_blocked");
      return reason("rule_forbidden", "撤退优先级、已走路径或最终堆叠限制该地区");
    }
    if (action === "advance_destination") {
      const ids = state.pending_retreat?.selected_advance_units || [];
      const advancingFaction = ids.length
        ? state.units.find((unit) => unit.id === ids[0])?.faction
        : state.combat?.attacker || faction;
      if (api.unitsAt(state, destination, api.other(faction)).length)
        return reason("enemy_blocked");
      if (!canOccupyByEarlyWarDepth(state, advancingFaction, destination))
        return reason("early_occupation_depth", "超出占领纵深", "important");
      if (!api.advanceCanEnter(state, ids, destination)) {
        if (!api.advanceGroupStackLegal(state, destination, ids, faction)) return reason("overstack");
        if (api.intactFort(state, destination)) return reason("fort_blocked");
        return reason("connection_mode", "该地区不在本次合法挺进路径上");
      }
    }
    return reason("rule_forbidden");
  }

  function explainPiece(state, action, unit) {
    if (!unit || unit.faction !== state.active) return reason("nationality", "只能选择当前行动方单位");
    if (action === "select_move_unit") {
      const selection = state.ops?.move_selection;
      if (selection?.origin && unit.location !== selection.origin) return reason("rule_forbidden", "编队单位必须来自同一地区");
      if (unit.moved) return reason("already_moved");
      if (!unitIsActivated(state, unit, ["move"])) return reason("rule_forbidden", "该单位没有移动激活");
      if (!movementRoutes(state, unit, selection?.selected || []).length)
        return reason(unit.type === "hq" ? "hq_escort" : "movement_points", "该单位没有合法移动路径");
    }
    if (action === "select_sr_unit") {
      if (state.sr?.used_units?.includes(unit.id)) return reason("already_used_sr");
      if (unit.location && !unit.supplied) return reason("supply");
      const cost = state.sr?.free ? 1 : unit.type === "army" ? 3 : 1;
      if (Number(state.sr?.remaining || 0) < cost) return reason("sr_points");
      if (state.sr?.free && (unit.nation !== state.sr.restriction?.nation || unit.type !== state.sr.restriction?.type))
        return reason("event_restriction", "单位不符合本次免费战略调动限制", "important");
      if (!legalSrDestinations(state, unit).length)
        return reason(unit.type === "hq" ? "hq_escort" : "rule_forbidden", "该单位没有合法战略调动目的地");
    }
    if (["select_retreat_unit", "select_retreat_one", "select_retreat_two"].includes(action)) {
      const pending = state.pending_retreat;
      if (!pending?.units?.includes(unit.id)) return reason("rule_forbidden", "该单位不属于本次撤退");
      const distance = action === "select_retreat_one"
        ? 1
        : action === "select_retreat_two"
          ? 2
          : Number(pending.remaining?.[unit.id] ?? pending.steps ?? 1);
      if (!api.retreatUnitHasRoute(state, unit.id, distance))
        return reason("rule_forbidden", "该单位没有完整的合法撤退路径");
    }
    if (action === "select_advance_unit") {
      const pending = state.pending_retreat;
      if (!pending?.units?.includes(unit.id)) return reason("rule_forbidden", "该单位不属于本次挺进候选");
      if (!api.advanceSelectionCanAdd(state, pending, [...(pending.selected_advance_units || []), unit.id]))
        return reason("overstack", "加入该单位后没有合法共同挺进目的地");
    }
    return reason("rule_forbidden");
  }

  

  function activationCandidates(state, spaceId) {
      return api.unitsAt(state, spaceId, state.active).filter((unit) =>
          !unit.moved && !unit.attacked && !regionUnitActivated(state, unit.id));
  }

  function ensureRegionActivations(state) {
      state.ops.region_activations ||= { move: {}, attack: {}, construct: {} };
      for (const kind of ["move", "attack", "construct"])
          state.ops.region_activations[kind] ||= {};
      return state.ops.region_activations;
  }

  function regionActivationStacks(state, kind, space) {
      return ensureRegionActivations(state)[kind]?.[space] || [];
  }

  function regionActivationBatchForUnit(state, unitId, kinds = ["move", "attack", "construct"]) {
      for (const kind of kinds)
          for (const [space, stacks] of Object.entries(ensureRegionActivations(state)[kind] || {}))
              for (const stack of stacks || [])
                  if (stack.units?.includes(unitId)) return { kind, space, stack };
      return null;
  }

  function regionUnitActivated(state, unitId) {
      return Boolean(state.ops?.region_activations && regionActivationBatchForUnit(state, unitId));
  }

  function hasActivationKind(state, kind) {
      if (Object.values(state.activations || {}).includes(kind)) return true;
      const mode = state.ops?.region_activations?.[kind] || {};
      return Object.values(mode).some((stacks) => stacks?.length);
  }

  function activationSpacesForKinds(state, kinds) {
      const result = new Set(Object.entries(state.activations || {})
          .filter(([, kind]) => kinds.includes(kind))
          .map(([space]) => space));
      for (const kind of kinds)
          for (const [space, stacks] of Object.entries(state.ops?.region_activations?.[kind] || {}))
              if (stacks?.length) result.add(space);
      return [...result];
  }

  function refreshRegionActivationMarker(state, space) {
      const regions = ensureRegionActivations(state);
      if (regions.attack[space]?.length) state.activations[space] = "attack";
      else if (regions.move[space]?.length) state.activations[space] = "move";
      else if (regions.construct[space]?.length) state.activations[space] = "construct";
      else delete state.activations[space];
  }

  function activationSelectionSpec(state, spaceId, kind) {
      const candidates = activationCandidates(state, spaceId).filter((unit) => kind !== "construct" || api.isCombatUnit(unit));
      const largeArea = Boolean(api.spaceById[spaceId]?.large_area);
      const required = largeArea ? [] : candidates.map((unit) => unit.id);
      return {
          space: spaceId,
          kind,
          candidates: candidates.map((unit) => unit.id),
          required,
          minimum: largeArea ? Math.min(1, candidates.length) : candidates.length,
          maximum: largeArea ? Math.min(3, candidates.length) : candidates.length,
          large_area: largeArea,
      };
  }

  function selectedActivationUnits(state, spaceId, unitIds = null) {
      const candidates = activationCandidates(state, spaceId);
      if (!unitIds)
          return candidates;
      const selected = new Set(unitIds);
      return candidates.filter((unit) => selected.has(unit.id));
  }

  function hqHasNationalStack(state, hq, space = hq.location) {
      const nationality = api.nationalityGroup(hq.nation);
      return api.unitsAt(state, space, hq.faction).some((unit) => api.isCombatUnit(unit) && api.nationalityGroup(unit.nation) === nationality);
  }

  function hqAtSupplySource(state, hq, space = hq.location) {
      // The HQ exception is a friendly-controlled supply source, not a
      // same-nationality supply source. Ordinary ports do not count.
      const source = api.spaceById[space];
      if (!source || state.control[space] !== hq.faction ||
          api.unitsAt(state, space, api.other(hq.faction)).length)
          return false;
      if (source.supply && source.faction === hq.faction)
          return true;
      return space === "brussels";
  }

  function hqEndLegal(state, hq, space = hq.location) {
      return (hqHasNationalStack(state, hq, space) || hqAtSupplySource(state, hq, space));
  }

  function movementDestinationKeepsHqsResolvable(state, unit, destination) {
      if (unit.type === "hq")
          return true;
      const existing = new Set(orphanHqs(state).map((hq) => hq.id));
      const origin = unit.location;
      unit.location = destination;
      const stranded = orphanHqs(state).filter((hq) => hq.faction === unit.faction && !existing.has(hq.id));
      const resolvable = stranded.every((hq) => {
          if (hq.moved || !unitIsActivated(state, hq, ["move"]))
              return false;
          const companions = api.unitsAt(state, hq.location, hq.faction).filter(api.isCombatUnit);
          const moved = companions.map((companion) => companion.moved);
          for (const companion of companions)
              companion.moved = true;
          const destinations = movementDestinations(state, hq);
          for (let index = 0; index < companions.length; index++)
              companions[index].moved = moved[index];
          return destinations.length > 0;
      });
      unit.location = origin;
      return resolvable;
  }

  function orphanHqs(state) {
      return state.units.filter((unit) => unit.type === "hq" && !hqEndLegal(state, unit));
  }

  function earlyEntryAllowed(state, unit, space) {
      const destination = api.spaceById[space];
      if (!destination)
          return false;
      if (state.turn > 2)
          return true;
      if (unit.faction === api.AP && destination.nation === "ge")
          return false;
      const belgiumOpened = Boolean(state.events[api.cardById[611].event]);
      if (destination.nation === "be" &&
          ["br", "fr"].includes(unit.nation) &&
          !belgiumOpened)
          return false;
      return true;
  }

  function earlySrDestinationAllowed(state, unit, space) {
      if (!earlyEntryAllowed(state, unit, space))
          return false;
      if (state.turn > 2)
          return true;
      return (api.nationalityGroup(unit.nation) === api.nationalityGroup(api.spaceById[space]?.nation));
  }

  function activationNationalityCount(units) {
      const compatibility = units.map((unit) => {
          const combined = api.pieceById[unit.piece]?.combined_nations;
          const nations = Array.isArray(combined) && combined.length
              ? combined
              : [unit.nation];
          return {
              combined: Array.isArray(combined) && combined.length > 0,
              nations: new Set(nations.map((nation) => api.nationalityGroup(nation))),
          };
      });
      const groups = [];
      for (const entry of compatibility.filter((candidate) => !candidate.combined)) {
          const nation = [...entry.nations][0];
          if (!groups.some((group) => group.size === 1 && group.has(nation)))
              groups.push(new Set([nation]));
      }
      for (const entry of compatibility.filter((candidate) => candidate.combined)) {
          if (groups.some((group) => [...entry.nations].some((nation) => group.has(nation))))
              continue;
          groups.push(entry.nations);
      }
      return groups.length;
  }

  function activationCost(state, spaceId, kind, unitIds = null) {
      const selected = selectedActivationUnits(state, spaceId, unitIds);
      if (api.spaceById[spaceId]?.large_area)
          return selected.length ? 1 : Number.POSITIVE_INFINITY;
      const nationalityCount = activationNationalityCount(selected);
      const sommeNationality = state.active === api.AP &&
          kind === "attack" &&
          state.markers.somme?.space &&
          api.cardSpecById[state.markers.somme.source_card]?.combat
              ?.ignore_nationality_at_marker &&
          api.connectionAllows(spaceId, state.markers.somme.space, "attack", api.AP);
      const ignoresNationality = Object.entries(state.events).some(([event, status]) => {
          if (status?.faction !== state.active)
              return false;
          const card = api.data.cards.find((candidate) => candidate.event === event);
          return Boolean(card && api.cardSpecById[card.id]?.combat?.ignore_activation_nationality);
      });
      const allOut = api.activeRule(state, "all_out_war");
      const allOutAvailable = state.active === api.AP &&
          allOut?.ignore_activation_nationality_once &&
          !(state.usage_limits[`all_out_activation:${state.turn}:${state.action_round}`] || 0);
      const base = kind === "construct"
          ? nationalityCount > 1 && !ignoresNationality
              ? 1
              : 0.5
          : state.ops?.free_activation_cost
              ? state.ops.free_activation_cost
              : ignoresNationality || sommeNationality || allOutAvailable
                  ? 1
                  : Math.max(1, nationalityCount);
      let cost = kind === "construct"
          ? base
          : api.spaceById[spaceId]?.large_area
              ? Math.max(1, base / 2)
              : base;
      return cost;
  }

  function minimumActivationUnitIds(state, spaceId, kind) {
      const spec = activationSelectionSpec(state, spaceId, kind);
      return spec.required;
  }

  function unitIsActivated(state, unit, kinds) {
      if (api.spaceById[unit.location]?.large_area) {
          if (regionActivationBatchForUnit(state, unit.id, kinds)) return true;
          const hasNewRegionData = kinds.some((kind) =>
              regionActivationStacks(state, kind, unit.location).length);
          if (hasNewRegionData) return false;
          // Saves and event-created activations from before region stacks used
          // the ordinary marker plus activated_units representation.
      }
      if (!kinds.includes(state.activations[unit.location]))
          return false;
      const selected = state.ops?.activated_units?.[unit.location];
      return !selected || selected.includes(unit.id);
  }

  function legalActivationSpaces(state, kind = "move") {
      if (!state.ops)
          return [];
      return api.data.spaces
          .filter((space) => api.spaceCanActivate(state, space.id))
          .filter((space) => !state.ops.combat_effect?.nation ||
          space.nation === state.ops.combat_effect.nation)
          .filter((space) => !state.ops.combat_effect?.theater ||
          api.theaterOf(space.id) === state.ops.combat_effect.theater)
          .filter(() => !state.ops.combat_effect?.attack_only || kind === "attack")
          .filter((space) => space.large_area || !state.activations[space.id])
          .filter((space) => state.turn > 3 || !space.large_area ||
              !state.activations[space.id] || state.activations[space.id] === kind)
          .filter((space) => activationCandidates(state, space.id).length)
          .filter((space) => kind !== "attack" ||
          activationCandidates(state, space.id).some(api.isCombatUnit))
          .filter((space) => kind !== "attack" ||
          activationCandidates(state, space.id).some((unit) => api.isCombatUnit(unit) &&
              api.geometricAttackTargets(state, [unit]).length))
          .filter((space) => {
          if (kind !== "construct")
              return true;
          const units = activationCandidates(state, space.id).filter(api.isCombatUnit);
          if (!units.length)
              return false;
          const groups = new Map();
          for (const unit of units) {
              const key = api.nationalityGroup(unit.nation);
              if (!groups.has(key))
                  groups.set(key, []);
              groups.get(key).push(unit);
          }
          const canCombine = [...groups.values()].some((group) => group.some((unit) => unit.type === "army" && unit.reduced) &&
              group.some((unit) => unit.type === "corps"));
          const terrain = space.terrain;
          const level = state.trenches[space.id] || 0;
          const maximum = constructionMaximumTrench(state, space.id);
          const hindenburg = state.active === api.CP && api.activeRule(state, "hindenburg_line");
          const canEntrench = Boolean(trenchRule(state, state.active)) &&
              terrain !== "swamp" &&
              ((["mountain", "alpine"].includes(terrain) &&
                  (state.fortifications[space.id] || 0) < 2) ||
                  level < maximum ||
                  (level === 2 &&
                      hindenburg?.fortify_level_two_trench &&
                      (state.fortifications[space.id] || 0) < 6));
          return canCombine || canEntrench;
      })
          .filter((space) => {
          const bonus = space.nation === "it" ? state.ops.italian_bonus || 0 : 0;
          const spec = activationSelectionSpec(state, space.id, kind);
          const unitIds = spec.required.length ? spec.required : spec.candidates.slice(0, 1);
          return (unitIds.length &&
              activationCost(state, space.id, kind, unitIds) <=
                  state.ops.remaining + bonus);
      })
          .map((space) => space.id);
  }

  function trenchRule(state, faction) {
      const card = api.cardById[faction === api.AP ? 608 : 708];
      const status = state.events[card.event];
      const rule = status && (status.rule || api.ruleModifier(card));
      return rule?.key === "trench_capability" ? rule : null;
  }

  function constructionUnits(state, space) {
      return api.unitsAt(state, space, state.active).filter((unit) => api.isCombatUnit(unit) &&
          !unit.limited_supply &&
          !unit.fort_limited_supply &&
          !unit.moved &&
          !unit.attacked &&
          unitIsActivated(state, unit, ["move", "construct"]));
  }

  function constructionMaximumTrench(state, space) {
      const terrain = api.spaceById[space]?.terrain;
      if (terrain === "mountain" || terrain === "alpine" || terrain === "swamp")
          return 0;
      const rule = trenchRule(state, state.active);
      if (!rule)
          return 0;
      return state.commitment[state.active] === rule.level_two_commitment
          ? 2
          : Number(rule.level_one);
  }

  function constructionAvailable(state, space) {
      const units = constructionUnits(state, space);
      if (!units.length)
          return false;
      if (!trenchRule(state, state.active))
          return false;
      const terrain = api.spaceById[space]?.terrain;
      if (terrain === "swamp")
          return false;
      const level = state.trenches[space] || 0;
      const maximum = constructionMaximumTrench(state, space);
      const hindenburg = state.active === api.CP && api.activeRule(state, "hindenburg_line");
      if (terrain === "mountain" || terrain === "alpine")
          return (state.fortifications[space] || 0) < 2;
      if (level < maximum)
          return true;
      if (level === 2 && hindenburg?.fortify_level_two_trench)
          return (state.fortifications[space] || 0) < 6;
      return false;
  }

  function earlyStackUnitIds(state, origin = state.ops?.execution_origin) {
      if (!origin)
          return [];
      const selected = state.ops?.activated_units?.[origin];
      if (selected?.length)
          return selected.slice();
      return api.unitsAt(state, origin, state.active)
          .filter((unit) => !unit.moved && !unit.attacked)
          .map((unit) => unit.id);
  }

  function legalMoveUnitIds(state) {
      const earlyStackIds = state.turn <= 3 && state.ops?.execution_origin
          ? new Set(earlyStackUnitIds(state))
          : null;
      return state.units
          .filter((unit) => unit.faction === state.active &&
          (!earlyStackIds || earlyStackIds.has(unit.id)) &&
          unitIsActivated(state, unit, ["move"]) &&
          !unit.moved)
          .map((unit) => unit.id);
  }

  function legalConstructionSpaces(state) {
      return activationSpacesForKinds(state, ["move", "construct"])
          .filter((space) => state.turn > 3 ||
          !state.ops?.execution_origin ||
          space === state.ops.execution_origin)
          .filter((space) => constructionAvailable(state, space) &&
          !state.ops.entrench_attempted?.includes(space));
  }

  function legalCombinationGroups(state) {
      const earlyStackIds = state.turn <= 3 && state.ops?.execution_origin
          ? new Set(earlyStackUnitIds(state))
          : null;
      const combinableBySpace = {};
      for (const unit of state.units.filter((unit) => unit.faction === state.active &&
          (!earlyStackIds || earlyStackIds.has(unit.id)) &&
          !unit.moved &&
          !unit.attacked &&
          (unit.type === "corps" || (unit.type === "army" && unit.reduced)) &&
          unitIsActivated(state, unit, ["move", "construct"]))) {
          const key = `${unit.location}:${api.nationalityGroup(unit.nation)}`;
          if (!combinableBySpace[key])
              combinableBySpace[key] = [];
          combinableBySpace[key].push(unit);
      }
      return Object.values(combinableBySpace).flatMap((units) => {
          const armies = units.filter((unit) => unit.type === "army" && unit.reduced);
          const corps = units.filter((unit) => unit.type === "corps");
          return armies.flatMap((army) => corps.map((unit) => [army.id, unit.id]));
      });
  }

  function beginOps(state, card, oneOp = false) {
      const cardRule = card && api.ruleModifier(card);
      const schlieffen = cardRule?.key === "schlieffen_plan" ? api.clone(cardRule) : null;
      const italy = api.activeRule(state, "italy_entry");
      const printedOps = oneOp ? 1 : card.ops;
      const italyOffset = italy && state.commitment[state.active] === "total"
          ? (italy.total_war_free_ops_offset ?? italy.free_ops_offset)
          : italy?.free_ops_offset;
      const opsEffect = api.clone(api.cardSpecById[card?.id]?.ops || null);
      state.ops = {
          card: card?.id || null,
          total: printedOps,
          remaining: printedOps,
          italian_bonus: italy && !opsEffect?.no_italian_bonus
              ? Math.max(0, printedOps - italyOffset)
              : 0,
          combat_effect: opsEffect,
          activated: [],
          moving: null,
          schlieffen,
          preactivation_sr_used: [],
          preactivation_sr_units: [],
          preactivation_sr_selected: null,
          entrench_attempted: [],
          pending_siege: null,
          pending_attack: null,
          attack_selection: [],
          activated_units: {},
          region_activations: { move: {}, attack: {}, construct: {} },
          attack_marker_spaces: [],
          pending_activation: null,
      };
      state.state = "ops_activate";
      api.log(state, card
          ? `[[card:${card.id}]] — 行动点 (${printedOps})`
          : `1 OP — 行动点 (${printedOps})`);
  }

  function finishOps(state) {
      if (state.ops?.forced_attacks?.length)
          throw new Error("Converted attack activations must be executed");
      if (state.ops?.pending_siege)
          throw new Error("The pending siege force must finish entering the fort");
      if (orphanHqs(state).some((unit) => unit.faction === state.active))
          throw new Error("Every HQ must finish with a national combat unit or at a supply source");
      api.refreshBesieged(state);
      const returnAfterForced = state.ops?.return_after_forced;
      const resumeAfterForced = api.clone(state.ops?.resume_after_forced || null);
      if (state.ops?.schlieffen?.allow_temporary_overstack) {
          const candidates = schlieffenOverstackCandidates(state);
          if (candidates.length) {
              state.state = "schlieffen_overstack";
              return;
          }
      }
      state.ops = null;
      state.activations = {};
      if (resumeAfterForced) {
          state.active = resumeAfterForced.active;
          state.ops = resumeAfterForced.ops;
          state.activations = resumeAfterForced.activations;
          state.state = "ops_activate";
          return;
      }
      if (returnAfterForced === "ap_action") {
          state.active = api.AP;
          state.state = "action_card";
          return;
      }
      if (returnAfterForced === "mo_penalty") {
          api.advanceMoPenalty(state);
          return;
      }
      api.nextFactionAction(state);
  }

  function forcedAttackRequiredUnits(state, faction, space, options = {}) {
      const combatUnits = api.unitsAt(state, space, faction).filter(api.isCombatUnit);
      const required = combatUnits.slice();
      if (options.includeCompatibleHqs) {
          required.push(...api.unitsAt(state, space, faction).filter((unit) =>
              unit.type === "hq" && combatUnits.some((combatUnit) =>
                  api.nationalityGroup(combatUnit.nation) ===
                      api.nationalityGroup(unit.nation))));
      }
      return required.map((unit) => unit.id);
  }

  function forcedAttackCandidates(state, faction, selectedSpaces = [], options = {}) {
      const selected = new Set(selectedSpaces);
      return api.data.spaces
          .filter((space) => !selected.has(space.id))
          .filter((space) => {
              const combatUnits = api.unitsAt(state, space.id, faction).filter(api.isCombatUnit);
              if (!combatUnits.length ||
                  (options.nation && !combatUnits.some((unit) => unit.nation === options.nation)) ||
                  (options.requireSupply && combatUnits.some((unit) =>
                      !unit.supplied && !unit.limited_supply && !unit.fort_limited_supply)))
                  return false;
              return api.neighborsFor(space.id, "attack", faction).some((target) =>
                  combatUnits.every((unit) => api.attacksTarget(state, unit, target)) &&
                  (api.unitsAt(state, target, api.other(faction)).some(api.isCombatUnit) ||
                      (api.intactFort(state, target) && api.spaceById[target]?.faction !== faction)));
          })
          .map((space) => space.id);
  }

  function commitForcedAttackMarkers(state, options) {
      const spaces = [...new Set(options.spaces || [])];
      if (!spaces.length || spaces.length !== (options.spaces || []).length)
          throw new Error("Forced attack markers require different spaces");
      const legal = new Set(forcedAttackCandidates(
          state,
          options.faction,
          [],
          options.candidateOptions || {},
      ));
      if (spaces.some((space) => !legal.has(space)))
          throw new Error("A forced attack marker is no longer legal");
      const requiredAttackers = Object.fromEntries(spaces.map((space) => [
          space,
          forcedAttackRequiredUnits(
              state,
              options.faction,
              space,
              options.requiredOptions || {},
          ),
      ]));
      for (const ids of Object.values(requiredAttackers))
          for (const id of ids) {
              const unit = state.units.find((candidate) => candidate.id === id);
              if (unit) {
                  unit.attacked = false;
                  unit.attack_eligible = true;
              }
          }
      state.active = options.faction;
      state.activations = Object.fromEntries(spaces.map((space) => [space, "attack"]));
      state.ops = {
          card: options.card ?? null,
          total: 0,
          remaining: 0,
          source: options.source,
          source_id: options.sourceId ?? null,
          activated: spaces.slice(),
          moving: null,
          forced_attacks: spaces.slice(),
          required_attackers: requiredAttackers,
          return_after_forced: options.returnAfterForced,
          italian_bonus: 0,
          preactivation_sr_used: [],
          preactivation_sr_units: [],
          execution_phase: "attack",
      };
      prepareOpsAttackSelection(state);
      state.state = "ops_attack";
  }

  function prepareOpsAttackSelection(state) {
      if (!state.ops)
          return;
      const eligible = api.eligibleAttackUnitIds(state);
      const combatEligible = eligible.filter((id) => api.isCombatUnit(state.units.find((unit) => unit.id === id)));
      let required = api.requiredAttackersByOrigin(state, eligible);
      if (state.ops.forced_attacks?.length) {
          state.ops.forced_attacks = state.ops.forced_attacks.filter((origin) => {
              const ids = required[origin] || [];
              const valid = ids.length && api.legalTargetsForAttackers(state, ids).length;
              if (!valid && state.ops.source === "mo_penalty")
                  throw new Error("A required MO-penalty attack became invalid");
              if (!valid)
                  api.log(state, `${api.spaceById[origin]?.name || origin} 的强制进攻已无合法目标，移除标记。`);
              return Boolean(valid);
          });
          required = api.requiredAttackersByOrigin(state, eligible);
      }
      const forced = Object.values(required).find((ids) => ids.length && api.legalTargetsForAttackers(state, ids).length);
      const attackersByOrigin = {};
      for (const id of combatEligible) {
          const unit = state.units.find((candidate) => candidate.id === id);
          if (!unit?.location)
              continue;
          (attackersByOrigin[unit.location] ||= []).push(id);
      }
      const legalOriginGroups = Object.values(attackersByOrigin).filter((ids) => ids.length && api.legalTargetsForAttackers(state, ids).length);
      const automatic = legalOriginGroups.length === 1 ? legalOriginGroups[0] : [];
      state.ops.attack_selection = (forced || automatic).slice();
  }

  function beginSequentialOpsResolution(state) {
      state.ops.attack_selection = [];
      if (hasActivationKind(state, "move") || hasActivationKind(state, "construct")) {
          state.ops.execution_phase = "move";
          state.state = "ops_move";
          return;
      }
      if (hasActivationKind(state, "attack")) {
          state.ops.execution_phase = "attack";
          prepareOpsAttackSelection(state);
          state.state = "ops_attack";
          return;
      }
      finishOps(state);
  }

  function advanceSequentialOpsResolution(state) {
      if (state.ops.execution_phase === "move") {
          if (legalConstructionSpaces(state).length) {
              state.ops.execution_phase = "construct";
              state.state = "ops_construct";
              return;
          }
          state.ops.execution_phase = "construct";
      }
      if (state.ops.execution_phase === "construct") {
          if (hasActivationKind(state, "attack")) {
              state.ops.execution_phase = "attack";
              prepareOpsAttackSelection(state);
              state.state = "ops_attack";
              return;
          }
      }
      finishOps(state);
  }

  function earlyStackHasAttackers(state) {
      return api.eligibleAttackUnitIds(state).length > 0;
  }

  function finishEarlyStack(state) {
      const origin = state.ops.execution_origin;
      state.ops.unresolved_stacks = (state.ops.unresolved_stacks || []).filter((space) => space !== origin);
      delete state.ops.execution_origin;
      delete state.ops.execution_phase;
      state.ops.attack_selection = [];
      if (!state.ops.unresolved_stacks.length)
          finishOps(state);
      else
          state.state = "ops_choose_stack";
  }

  function beginEarlyStack(state, origin) {
      if (!(state.ops.unresolved_stacks || []).includes(origin))
          throw new Error("Choose an unresolved activated stack");
      state.ops.activated_units ||= {};
      if (!state.ops.activated_units[origin]?.length)
          state.ops.activated_units[origin] = api.unitsAt(state, origin, state.active)
              .filter((unit) => !unit.moved && !unit.attacked)
              .map((unit) => unit.id);
      state.ops.execution_origin = origin;
      state.ops.attack_selection = [];
      const kind = state.activations[origin];
      if (kind === "move") {
          state.ops.execution_phase = "move";
          state.state = "ops_move";
          return;
      }
      if (kind === "construct") {
          state.ops.execution_phase = "construct";
          state.state = "ops_construct";
          return;
      }
      state.ops.execution_phase = "attack";
      prepareOpsAttackSelection(state);
      if (earlyStackHasAttackers(state))
          state.state = "ops_attack";
      else
          finishEarlyStack(state);
  }

  function beginEarlyStackResolution(state) {
      state.ops.unresolved_stacks = state.ops.activated.slice();
      delete state.ops.execution_origin;
      delete state.ops.execution_phase;
      if (state.ops.unresolved_stacks.length)
          state.state = "ops_choose_stack";
      else
          finishOps(state);
  }

  function advanceEarlyStackResolution(state) {
      const kind = state.activations[state.ops.execution_origin];
      if (state.ops.execution_phase === "move") {
          if (legalConstructionSpaces(state).length) {
              state.ops.execution_phase = "construct";
              state.state = "ops_construct";
              return;
          }
          state.ops.execution_phase = "construct";
      }
      if (state.ops.execution_phase === "construct" && kind === "move") {
          state.ops.execution_phase = "attack";
          prepareOpsAttackSelection(state);
          if (earlyStackHasAttackers(state)) {
              state.state = "ops_attack";
              return;
          }
      }
      finishEarlyStack(state);
  }

  function resumeOpsExecutionState(state) {
      if (!state.ops?.execution_phase)
          return "ops_activate";
      return `ops_${state.ops.execution_phase}`;
  }

  function earlyActivationAvailable(state) {
      return ["move", "attack", "construct"].some((kind) => legalActivationSpaces(state, kind).length);
  }

  function requestOpsFinish(state) {
      if (state.turn <= 3 && earlyActivationAvailable(state))
          throw new Error("All available OP must be spent before resolving stacks");
      if (state.turn <= 3 && !state.ops?.execution_phase) {
          beginEarlyStackResolution(state);
          return;
      }
      if (state.turn >= 4 && !state.ops?.execution_phase) {
          beginSequentialOpsResolution(state);
          return;
      }
      finishOps(state);
  }

  function schlieffenSrActions(state) {
      if (!state.ops?.schlieffen?.preactivation_sr_corps || state.active !== api.CP)
          return [];
      const destinations = Object.keys(state.activations).filter((space) => !state.ops.preactivation_sr_used.includes(space) &&
          state.control[space] === api.CP &&
          api.unitsAt(state, space, api.AP).length === 0);
      if (!destinations.length)
          return [];
      return state.reserves.cp
          .filter((unit) => api.pieceById[unit.piece]?.type === "corps")
          .flatMap((unit) => destinations.map((destination) => ({ unit: unit.id, destination })));
  }

  function schlieffenSrUnits(state) {
      return api.unique(schlieffenSrActions(state).map((action) => action.unit));
  }

  function schlieffenSrDestinations(state, unitId) {
      return schlieffenSrActions(state)
          .filter((action) => action.unit === unitId)
          .map((action) => action.destination);
  }

  function schlieffenSr(state, arg) {
      if (!schlieffenSrActions(state).some((action) => action.unit === arg?.unit && action.destination === arg?.destination))
          throw new Error("Illegal Schlieffen pre-activation SR");
      const index = state.reserves.cp.findIndex((unit) => unit.id === arg.unit);
      const [unit] = state.reserves.cp.splice(index, 1);
      api.hydrateUnit(unit);
      unit.location = arg.destination;
      unit.moved = false;
      unit.attacked = false;
      state.units.push(unit);
      state.ops.preactivation_sr_used.push(arg.destination);
      state.ops.preactivation_sr_units.push(unit.id);
      state.ops.preactivation_sr_selected = null;
  }

  function earlyWarOccupationLimit(state, faction) {
      const race = api.activeRule(state, "race_to_sea");
      return faction === api.CP && race
          ? Number(race.occupation_depth_limit) || 3
          : 2;
  }

  function occupationDepths(state, faction) {
      const snapshot = state.action_start_control;
      if (!snapshot || snapshot.actor !== faction || !snapshot.spaces)
          return new Map();
      const depths = new Map();
      const queue = [];
      for (const [space, controller] of Object.entries(snapshot.spaces)) {
          if (controller !== faction || !api.spaceCanActivate(state, space))
              continue;
          depths.set(space, 0);
          queue.push(space);
      }
      while (queue.length) {
          const current = queue.shift();
          const depth = depths.get(current);
          for (const next of api.neighborsFor(current, "move", faction)) {
              if (depths.has(next) || !api.spaceCanActivate(state, next))
                  continue;
              depths.set(next, depth + 1);
              queue.push(next);
          }
      }
      return depths;
  }

  function occupationDepth(state, faction, space, depths = occupationDepths(state, faction)) {
      return depths.get(space) ?? Number.POSITIVE_INFINITY;
  }

  function canOccupyByEarlyWarDepth(state, faction, space, depths = occupationDepths(state, faction)) {
      if (!state.action_start_control || state.action_start_control.actor !== faction)
          return true;
      return occupationDepth(state, faction, space, depths) <= earlyWarOccupationLimit(state, faction);
  }

  function schlieffenOverstackCandidates(state) {
      const imported = new Set(state.ops?.preactivation_sr_units || []);
      return state.units
          .filter((unit) => imported.has(unit.id) &&
              !api.spaceById[unit.location]?.large_area &&
              api.unitsAt(state, unit.location, api.CP).filter(api.isCombatUnit).length > 3)
          .map((unit) => unit.id);
  }

  function returnSchlieffenUnit(state, id) {
      if (!schlieffenOverstackCandidates(state).includes(id))
          throw new Error("This Schlieffen corps does not have to return");
      api.snapshot(state, "施里芬超堆叠返回");
      const index = state.units.findIndex((candidate) => candidate.id === id);
      const [unit] = state.units.splice(index, 1);
      const origin = unit.location;
      api.normalizeOffMapUnit(unit);
      state.reserves.cp.push(unit);
      api.log(state, `施里芬计划超堆叠：${api.pieceById[unit.piece]?.name || unit.id}从${api.spaceById[origin]?.name || origin}返回预备区。`);
  }

  function canLeaveBesiegedFort(state, unit) {
      if (!state.besieged.includes(unit.location) ||
          !api.intactFort(state, unit.location) ||
          api.spaceById[unit.location]?.faction === unit.faction)
          return true;
      return api.canBesiege(state, unit.location, unit.faction, [unit.id]);
  }

  function canPotentiallyEnterFort(state, unit, spaceId, distance = 1) {
      const lossFactor = api.intactFort(state, spaceId);
      if (!lossFactor ||
          api.spaceById[spaceId]?.faction === unit.faction ||
          state.besieged.includes(spaceId))
          return true;
      if (unit.type === "army")
          return true;
      if (unit.type !== "corps")
          return false;
      const corpsAtFort = api.unitsAt(state, spaceId, unit.faction).filter((candidate) => candidate.type === "corps").length;
      const availableCorps = api.unitsAt(state, unit.location, unit.faction).filter((candidate) => candidate.type === "corps" &&
          !candidate.moved &&
          (api.pieceById[candidate.piece]?.movement || 0) >= distance &&
          unitIsActivated(state, candidate, ["move"])).length;
      return corpsAtFort + availableCorps >= lossFactor;
  }

  function movementPaths(state, unit) {
      const piece = api.pieceById[unit.piece];
      const max = piece?.movement || 0;
      const supplied = unit.fort_limited_supply
          ? api.suppliedSpaces(state, unit.faction, unit.nation)
          : null;
      if (!api.spaceCanActivate(state, unit.location))
          return {};
      if (!canLeaveBesiegedFort(state, unit))
          return {};
      const seen = new Map([[unit.location, []]]);
      const occupationDepthBySpace = occupationDepths(state, unit.faction);
      const queue = [unit.location];
      while (queue.length) {
          const current = queue.shift();
          const path = seen.get(current);
          if (path.length >= max)
              continue;
          if (unit.fort_limited_supply && path.length && !supplied.has(current))
              continue;
          const currentFort = current !== unit.location &&
              api.intactFort(state, current) &&
              !state.besieged.includes(current) &&
              state.control[current] === api.other(unit.faction);
          if (currentFort)
              continue;
          for (const next of api.neighborsFor(current, "move", unit.faction)) {
              if (seen.has(next))
                  continue;
              if (!api.spaceCanActivate(state, next))
                  continue;
              if (api.unitsAt(state, next, api.other(unit.faction)).length)
                  continue;
              const nextPath = [...path, next];
              if (!canOccupyByEarlyWarDepth(state, unit.faction, next, occupationDepthBySpace))
                  continue;
              if (!canPotentiallyEnterFort(state, unit, next, nextPath.length))
                  continue;
              if (!earlyEntryAllowed(state, unit, next))
                  continue;
              seen.set(next, nextPath);
              queue.push(next);
          }
      }
      seen.delete(unit.location);
      // As in POG, a friendly full stack may be crossed during movement, but a
      // moving unit may not finish there. Keep those spaces in the route search
      // above, then remove them only from the legal endpoints.
      for (const destination of [...seen.keys()])
          if (!api.stackLegal(state, destination, unit))
              seen.delete(destination);
      if (unit.type === "hq")
          for (const destination of [...seen.keys()])
              if (!hqEndLegal(state, unit, destination))
                  seen.delete(destination);
      if (api.isCombatUnit(unit))
          for (const destination of [...seen.keys()])
              if (!movementDestinationKeepsHqsResolvable(state, unit, destination))
                  seen.delete(destination);
      if (state.ops?.pending_siege) {
          const target = state.ops.pending_siege.space;
          const path = seen.get(target);
          return path ? { [target]: path } : {};
      }
      return Object.fromEntries(seen);
  }

  function movementRoutes(state, unit, groupIds = []) {
      const piece = api.pieceById[unit.piece];
      const max = piece?.movement || 0;
      const supplied = unit.fort_limited_supply
          ? api.suppliedSpaces(state, unit.faction, unit.nation)
          : null;
      if (!api.spaceCanActivate(state, unit.location))
          return [];
      if (!canLeaveBesiegedFort(state, unit))
          return [];
      const origin = unit.location;
      const occupationDepthBySpace = occupationDepths(state, unit.faction);
      const routes = [];
      const queue = [{ current: origin, path: [] }];
      while (queue.length) {
          const { current, path } = queue.shift();
          if (path.length >= max)
              continue;
          if (unit.fort_limited_supply && path.length && !supplied.has(current))
              continue;
          const currentFort = current !== origin &&
              api.intactFort(state, current) &&
              !state.besieged.includes(current) &&
              state.control[current] === api.other(unit.faction);
          if (currentFort)
              continue;
          for (const next of api.neighborsFor(current, "move", unit.faction)) {
              if (next === origin || path.includes(next))
                  continue;
              if (!api.spaceCanActivate(state, next))
                  continue;
              if (api.unitsAt(state, next, api.other(unit.faction)).length)
                  continue;
              const nextPath = [...path, next];
              if (!canOccupyByEarlyWarDepth(state, unit.faction, next, occupationDepthBySpace))
                  continue;
              if (!canPotentiallyEnterFort(state, unit, next, nextPath.length))
                  continue;
              if (!earlyEntryAllowed(state, unit, next))
                  continue;
              const grouped = groupIds.length > 1 && groupIds.includes(unit.id);
              const endpointLegal = api.stackLegal(state, next, unit) &&
                  (grouped || unit.type !== "hq" || hqEndLegal(state, unit, next)) &&
                  (grouped ||
                      !api.isCombatUnit(unit) ||
                      movementDestinationKeepsHqsResolvable(state, unit, next));
              if (endpointLegal)
                  routes.push(nextPath);
              queue.push({ current: next, path: nextPath });
          }
      }
      if (state.ops?.pending_siege) {
          const target = state.ops.pending_siege.space;
          return routes.filter((route) => route.at(-1) === target);
      }
      return routes;
  }

  function movementDestinations(state, unit) {
      return Object.keys(movementPaths(state, unit));
  }

  function validateMovementPath(state, unit, requested) {
      const canonical = movementPaths(state, unit);
      const path = Array.isArray(requested)
          ? requested.slice()
          : canonical[requested];
      if (!path?.length)
          throw new Error("Illegal movement path");
      if (path[0] === unit.location)
          path.shift();
      const piece = api.pieceById[unit.piece];
      const maximum = piece?.movement || 0;
      const supplied = unit.fort_limited_supply
          ? api.suppliedSpaces(state, unit.faction, unit.nation)
          : null;
      const occupationDepthBySpace = occupationDepths(state, unit.faction);
      if (!canLeaveBesiegedFort(state, unit))
          throw new Error("Movement would leave an enemy fort without a sufficient siege force");
      if (!path.length ||
          path.length > maximum ||
          new Set([unit.location, ...path]).size !== path.length + 1)
          throw new Error("Illegal movement path");
      let current = unit.location;
      for (let index = 0; index < path.length; index++) {
          const next = path[index];
          if (unit.fort_limited_supply && index > 0 && !supplied.has(path[index - 1]))
              throw new Error("A unit leaving an isolated fort must stop unless it regains supply");
          if (!api.MapRules.connectionBetween(current, next))
              throw new Error("Movement path is not connected");
          if (!api.connectionAllows(current, next, "move", unit.faction))
              throw new Error("This faction cannot use the connection");
          if (!canOccupyByEarlyWarDepth(state, unit.faction, next, occupationDepthBySpace))
              throw new Error("Movement exceeds the occupation depth");
          if (!api.spaceCanActivate(state, next))
              throw new Error("The Italian theater is not active");
          if (api.unitsAt(state, next, api.other(unit.faction)).length)
              throw new Error("Movement path crosses enemy units");
          if (index === path.length - 1 && !api.stackLegal(state, next, unit))
              throw new Error("Movement cannot end in an overstacked space");
          if (!canPotentiallyEnterFort(state, unit, next, index + 1))
              throw new Error("Movement cannot enter an enemy fort without a sufficient siege force");
          if (!earlyEntryAllowed(state, unit, next))
              throw new Error("This unit cannot enter the destination in turns 1-2");
          const intactEnemyFort = api.intactFort(state, next) &&
              !state.besieged.includes(next) &&
              state.control[next] === api.other(unit.faction);
          if (intactEnemyFort && index !== path.length - 1)
              throw new Error("Movement cannot pass through an enemy fort");
          current = next;
      }
      if (unit.type === "hq" && !hqEndLegal(state, unit, path.at(-1)))
          throw new Error("An HQ must finish movement with a national combat unit or at a supply source");
      if (api.isCombatUnit(unit) &&
          !movementDestinationKeepsHqsResolvable(state, unit, path.at(-1)))
          throw new Error("Movement would leave an HQ without a legal national stack");
      return path;
  }

  function routeHasPrefix(route, prefix) {
      return prefix.every((space, index) => route[index] === space);
  }

  function movementSelectionCandidates(state, selection = state.ops?.move_selection) {
      const legal = legalMoveUnitIds(state);
      if (!selection?.origin)
          return legal;
      let candidates = legal.filter((id) => state.units.find((unit) => unit.id === id)?.location === selection.origin);
      if (api.spaceById[selection.origin]?.large_area && selection.selected?.length) {
          const batch = regionActivationBatchForUnit(state, selection.selected[0], ["move"]);
          if (batch) candidates = candidates.filter((id) => batch.stack.units.includes(id));
      }
      return candidates;
  }

  function beginMovementSelection(state, id) {
      const unit = state.units.find((candidate) => candidate.id === id);
      if (!unit || !legalMoveUnitIds(state).includes(id))
          throw new Error("Unit cannot be selected for movement");
      state.ops.move_selection = { origin: unit.location, selected: [id] };
      state.state = "movement_units";
  }

  function groupMovementCanBegin(state, ids) {
      return movementSelectionDestinations(state, ids).length > 0;
  }

  function movementSelectionDestinations(state, ids = state.ops?.move_selection?.selected || []) {
      if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length)
          return [];
      const units = ids
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(Boolean);
      const origin = units[0]?.location;
      if (!origin ||
          units.length !== ids.length ||
          units.some((unit) => unit.location !== origin))
          return [];
      const routesByUnit = Object.fromEntries(units.map((unit) => [unit.id, movementRoutes(state, unit, ids)]));
      if (Object.values(routesByUnit).some((routes) => !routes.length))
          return [];
      const movement = {
          active_units: ids.slice(),
          path: [],
          routes_by_unit: routesByUnit,
          endpoints_by_unit: Object.fromEntries(ids.map((id) => [id, [...new Set(routesByUnit[id].map((route) => route.at(-1)))]])),
      };
      return movementStepDestinations(state, movement);
  }

  function beginGroupMovement(state, ids) {
      if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length)
          throw new Error("Select at least one movement unit");
      if (!groupMovementCanBegin(state, ids))
          throw new Error("The selected group has no legal first movement step");
      const legal = new Set(movementSelectionCandidates(state));
      const units = ids
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(Boolean);
      const origin = units[0]?.location;
      if (units.length !== ids.length ||
          units.some((unit) => unit.location !== origin || !legal.has(unit.id)))
          throw new Error("Selected units must share one activated origin and escort every HQ");
      if (state.ops.pending_siege &&
          units.some((unit) => unit.type !== "corps" ||
              unit.location !== state.ops.pending_siege.origin ||
              !movementDestinations(state, unit).includes(state.ops.pending_siege.space)))
          throw new Error("The pending siege force must finish entering the fort");
      const routesByUnit = {};
      const endpointsByUnit = {};
      for (const unit of units) {
          const routes = movementRoutes(state, unit, ids);
          if (!routes.length)
              throw new Error("A selected unit has no legal movement route");
          routesByUnit[unit.id] = routes;
          endpointsByUnit[unit.id] = [...new Set(routes.map((route) => route.at(-1)))];
      }
      state.ops.moving = ids[0];
      state.ops.movement = {
          unit: ids[0],
          units: ids.slice(),
          active_units: ids.slice(),
          stopped_units: [],
          origin,
          path: [],
          routes_by_unit: routesByUnit,
          endpoints_by_unit: endpointsByUnit,
          activation_kind: regionActivationBatchForUnit(state, ids[0], ["move"])?.kind ||
              state.activations[origin],
          began_in_fort_limited_supply: Object.fromEntries(units.map((unit) => [unit.id, Boolean(unit.fort_limited_supply)])),
          began_in_limited_supply: Object.fromEntries(units.map((unit) => [unit.id, Boolean(unit.limited_supply)])),
          began_adjacent_enemy: Object.fromEntries(units.map((unit) => [unit.id,
              api.landNeighbors(origin).some((space) =>
                  api.unitsAt(state, space, api.other(unit.faction)).some(api.isCombatUnit))])),
          spent_by_unit: Object.fromEntries(ids.map((id) => [id, 0])),
      };
      state.state = "movement";
      return state.ops.movement;
  }

  function beginUnitMovement(state, unit) {
      state.ops.move_selection = { origin: unit.location, selected: [unit.id] };
      return beginGroupMovement(state, [unit.id]);
  }

  function movementContext(state) {
      return state.ops?.movement || null;
  }

  function groupStepKeepsHqsResolvable(state, movement, destination) {
      const moving = (movement.active_units || [])
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(Boolean);
      const existing = new Set(orphanHqs(state).map((hq) => hq.id));
      const locations = moving.map((unit) => unit.location);
      try {
          for (const unit of moving)
              unit.location = destination;
          return !orphanHqs(state).some((hq) => !existing.has(hq.id));
      }
      finally {
          moving.forEach((unit, index) => {
              unit.location = locations[index];
          });
      }
  }

  function groupStepCanOccupy(state, movement, destination) {
      const moving = (movement.active_units || [])
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(Boolean);
      const locations = moving.map((unit) => unit.location);
      try {
          for (const unit of moving)
              unit.location = destination;
          if (api.spaceById[destination]?.large_area)
              return true;
          const stack = api.unitsAt(state, destination, moving[0]?.faction);
          return (stack.filter(api.isCombatUnit).length <= 3 &&
              stack.filter((unit) => unit.type === "hq").length <= 1);
      }
      finally {
          moving.forEach((unit, index) => {
              unit.location = locations[index];
          });
      }
  }

  function groupCanEnterEnemyFort(state, movement, destination) {
      const lossFactor = api.intactFort(state, destination);
      const moving = (movement.active_units || [])
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(Boolean);
      const faction = moving[0]?.faction;
      if (!lossFactor ||
          !faction ||
          state.besieged.includes(destination) ||
          api.spaceById[destination]?.faction === faction)
          return true;
      const locations = moving.map((unit) => unit.location);
      try {
          for (const unit of moving)
              unit.location = destination;
          return api.canBesiege(state, destination, faction);
      }
      finally {
          moving.forEach((unit, index) => {
              unit.location = locations[index];
          });
      }
  }

  function groupContinuationPossible(movement, destination) {
      const prefix = [...movement.path, destination];
      const continuing = movement.active_units.filter((id) => !(movement.endpoints_by_unit[id] || []).includes(destination));
      if (!continuing.length)
          return true;
      let common = null;
      for (const id of continuing) {
          const next = new Set((movement.routes_by_unit[id] || [])
              .filter((route) => route.length > prefix.length && routeHasPrefix(route, prefix))
              .map((route) => route[prefix.length]));
          common = common == null ? next : new Set([...common].filter((space) => next.has(space)));
      }
      return Boolean(common?.size);
  }

  function groupCanLeaveDestination(movement, destination) {
      const prefix = [...movement.path, destination];
      let common = null;
      for (const id of movement.active_units) {
          const next = new Set((movement.routes_by_unit[id] || [])
              .filter((route) => route.length > prefix.length && routeHasPrefix(route, prefix))
              .map((route) => route[prefix.length]));
          common = common == null ? next : new Set([...common].filter((space) => next.has(space)));
      }
      return Boolean(common?.size);
  }

  function movementStepDestinations(state, movement = movementContext(state)) {
      if (!movement?.active_units?.length)
          return [];
      const index = movement.path.length;
      let common = null;
      for (const id of movement.active_units) {
          const next = new Set((movement.routes_by_unit[id] || [])
              .filter((route) => route.length > index && routeHasPrefix(route, movement.path))
              .map((route) => route[index]));
          common = common == null ? next : new Set([...common].filter((space) => next.has(space)));
      }
      return [...(common || [])].filter((space) => {
          if (!groupCanEnterEnemyFort(state, movement, space))
              return false;
          if (!groupStepKeepsHqsResolvable(state, movement, space))
              return false;
          const mayStop = groupStepCanOccupy(state, movement, space);
          // A friendly full stack may be crossed, but cannot be used as an endpoint.
          // If this step temporarily over-stacks the space, every active unit must
          // share a legal next step that takes the group onward.
          if (!mayStop)
              return groupCanLeaveDestination(movement, space);
          return groupContinuationPossible(movement, space);
      });
  }

  function movementEndpointLegal(state, movement, ids = movement.active_units) {
      if (!movement.path.length || !ids.length)
          return false;
      const units = ids
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(Boolean);
      const location = units[0]?.location;
      if (!location || units.some((unit) => unit.location !== location))
          return false;
      if (units.some((unit) => !(movement.endpoints_by_unit[unit.id] || []).includes(location)))
          return false;
      if (!api.spaceById[location]?.large_area) {
          const stack = api.unitsAt(state, location, units[0].faction);
          if (stack.filter(api.isCombatUnit).length > 3)
              return false;
          if (stack.filter((unit) => unit.type === "hq").length > 1)
              return false;
      }
      return !orphanHqs(state).some((hq) => hq.faction === units[0].faction);
  }

  function canFinishUnitMovement(state) {
      const movement = movementContext(state);
      return Boolean(movement && movementEndpointLegal(state, movement));
  }

  function finalizeMovementUnit(state, unit, movement) {
      const enteredAttackMarker = [movement.origin, ...movement.path].some((space) =>
          (state.ops?.attack_marker_spaces || []).includes(space) ||
          (state.ops?.forced_attacks || []).includes(space) ||
          state.activations?.[space] === "attack");
      unit.movement_path = movement.path.slice();
      unit.moved = true;
      unit.attack_eligible =
          state.turn <= 3 &&
              movement.activation_kind === "move" &&
              !movement.began_in_fort_limited_supply[unit.id] &&
              !movement.began_in_limited_supply?.[unit.id] &&
              !movement.began_adjacent_enemy?.[unit.id] &&
              !enteredAttackMarker;
      api.log(state, `[[unit:${unit.id}]]：${[
          movement.origin,
          ...movement.path,
      ]
          .map((space) => `[[space:${space}]]`)
          .join(" → ")}。`);
  }

  function finishMovementUnits(state, ids) {
      const movement = movementContext(state);
      for (const id of ids) {
          const unit = state.units.find((candidate) => candidate.id === id);
          if (!unit || !movement.active_units.includes(id))
              continue;
          finalizeMovementUnit(state, unit, movement);
          movement.active_units = movement.active_units.filter((unitId) => unitId !== id);
          if (!movement.stopped_units.includes(id))
              movement.stopped_units.push(id);
      }
      state.ops.moving = movement.active_units[0] || null;
      if (Number(api.spaceById[movement.origin]?.fort) > 0)
          api.refreshBesiegedSpace(state, movement.origin);
      for (const space of new Set(ids.map((id) => state.units.find((unit) => unit.id === id)?.location).filter(Boolean)))
          if (Number(api.spaceById[space]?.fort) > 0)
              api.refreshBesiegedSpace(state, space);
      api.updateSupply(state);
  }

  function finishUnitMovement(state) {
      const movement = movementContext(state);
      if (!movementEndpointLegal(state, movement))
          throw new Error("The selected units cannot end movement in this space");
      finishMovementUnits(state, movement.active_units.slice());
      state.ops.moving = null;
      state.ops.movement = null;
      state.ops.move_selection = null;
      state.state = resumeOpsExecutionState(state);
  }

  function moveUnitOneSpace(state, unit, requested, options = {}) {
      if (Array.isArray(requested)) {
          if (requested.length !== 1)
              throw new Error("Movement must be executed one space at a time");
          requested = requested[0];
      }
      if (typeof requested !== "string")
          throw new Error("Choose one adjacent movement space");
      const movement = movementContext(state);
      if (!movement || !movement.active_units.includes(unit.id))
          throw new Error("Moving unit not found");
      const activeUnits = movement.active_units
          .map((id) => state.units.find((candidate) => candidate.id === id))
          .filter(Boolean);
      const current = activeUnits[0]?.location;
      if (!api.MapRules.connectionBetween(current, requested))
          throw new Error("Movement must be executed one adjacent space at a time");
      if (!api.connectionAllows(current, requested, "move", unit.faction))
          throw new Error("This faction cannot use the connection");
      if (!movementStepDestinations(state).includes(requested))
          throw new Error("Illegal movement step");
      if (!options.skip_undo) api.snapshot(state, "逐格移动");
      const enteredApItaly = activeUnits.some((movingUnit) => movingUnit.nation === "ah" &&
          api.spaceById[requested]?.nation === "it" &&
          state.control[requested] === api.AP);
      for (const movingUnit of activeUnits) {
          movingUnit.location = requested;
          movement.spent_by_unit[movingUnit.id] =
              (movement.spent_by_unit[movingUnit.id] || 0) + 1;
      }
      movement.path.push(requested);
      for (const movingUnit of activeUnits)
          movingUnit.movement_path = movement.path.slice();
      if (enteredApItaly)
          api.markMoRequirement(state, "ah", "enter_enemy_italy");
      if (activeUnits.some((movingUnit) => movingUnit.faction === api.CP) &&
          state.markers.killing_ground?.space === requested) {
          const marker = state.markers.killing_ground;
          if (!state.destroyed_forts.includes(requested))
              state.destroyed_forts.push(requested);
          api.adjustVp(state, marker.destroy_vp);
          const removedIndex = state.removed.cp.indexOf(marker.source_card);
          if (removedIndex >= 0) {
              state.removed.cp.splice(removedIndex, 1);
              state.discard.cp.push(marker.source_card);
          }
          delete state.events[api.cardById[marker.source_card].event];
          delete state.markers.killing_ground;
      }
      const intactEnemyFort = api.intactFort(state, requested) &&
          state.control[requested] === api.other(unit.faction);
      if (intactEnemyFort) {
          const completed = api.refreshBesiegedSpace(state, requested);
          if (!completed)
              throw new Error("The selected group cannot begin a siege");
          state.ops.pending_siege = null;
      }
      else if (activeUnits.some(api.isCombatUnit))
          api.captureSpace(state, requested, unit.faction);
      api.updateSupply(state);
      const exhausted = movement.active_units.filter((id) => {
          const movingUnit = state.units.find((candidate) => candidate.id === id);
          return (movingUnit &&
              movement.spent_by_unit[id] >= (api.pieceById[movingUnit.piece]?.movement || 0));
      });
      if (exhausted.length)
          finishMovementUnits(state, exhausted);
      if (!movement.active_units.length) {
          state.ops.moving = null;
          state.ops.movement = null;
          state.ops.move_selection = null;
          state.state = resumeOpsExecutionState(state);
          return;
      }
      if (intactEnemyFort || movementStepDestinations(state).length === 0) {
          if (!movementEndpointLegal(state, movement))
              throw new Error("The selected units cannot stop in this space");
          finishUnitMovement(state);
      }
  }

  function crossTheaterSrDestinationAllowed(state, unit, destination) {
      const originTheater = unit.location ? api.theaterOf(unit.location) : "western";
      const destinationTheater = api.theaterOf(destination);
      if (originTheater === destinationTheater)
          return true;
      if (!api.italianTheaterActive(state))
          return false;
      if (originTheater !== "western" || destinationTheater !== "italian")
          return false;
      if (unit.type !== "corps")
          return false;
      const nationality = api.nationalityGroup(unit.nation);
      const space = api.spaceById[destination];
      const matchingSupplySource = api.nationalSupplySource(state, unit.faction, unit.nation, space);
      const nationalStack = api.unitsAt(state, destination, unit.faction).some((candidate) => api.isCombatUnit(candidate) &&
          api.nationalityGroup(candidate.nation) === nationality);
      return matchingSupplySource || nationalStack;
  }

  function overlandSrSpaces(state, unit) {
      const seen = new Set([unit.location]);
      const queue = [unit.location];
      while (queue.length) {
          const current = queue.shift();
          for (const next of api.neighborsFor(current, "sr", unit.faction)) {
              if (seen.has(next) ||
                  !api.spaceCanActivate(state, next) ||
                  !api.friendlySpace(state, next, unit.faction))
                  continue;
              seen.add(next);
              queue.push(next);
          }
      }
      return seen;
  }

  function srDestinations(state, unit) {
      if (!unit.supplied)
          return [];
      if (!api.spaceCanActivate(state, unit.location))
          return [];
      const supplied = api.suppliedSpaces(state, unit.faction, unit.nation);
      const overland = overlandSrSpaces(state, unit);
      const blockade = api.activeRule(state, "channel_blockade");
      const destinations = [...supplied].filter((space) => space !== unit.location &&
          api.spaceCanActivate(state, space) &&
          earlySrDestinationAllowed(state, unit, space) &&
          crossTheaterSrDestinationAllowed(state, unit, space) &&
          (unit.type !== "hq" || hqEndLegal(state, unit, space)) &&
          (overland.has(space) ||
              api.theaterOf(unit.location) !== api.theaterOf(space)) &&
          api.stackLegal(state, space, unit) &&
          !(unit.faction === blockade?.blocked_faction &&
              api.spaceById[space]?.port &&
              ["br", "fr", "be"].includes(api.spaceById[space]?.nation)));
      if (unit.type === "corps" && canLeaveBesiegedFort(state, unit))
          destinations.push("reserve");
      return destinations;
  }

  function reserveSrDestinations(state, unit) {
      if (unit.type !== "corps")
          return [];
      const supplied = api.suppliedSpaces(state, unit.faction, unit.nation);
      return [...supplied].filter((space) => {
          if (!api.spaceCanActivate(state, space) ||
              !earlySrDestinationAllowed(state, unit, space) ||
              !crossTheaterSrDestinationAllowed(state, unit, space) ||
              !api.stackLegal(state, space, unit))
              return false;
          const nationality = api.nationalityGroup(unit.nation);
          const nationalSource = api.nationalSupplySource(state, unit.faction, unit.nation, api.spaceById[space]);
          const suppliedNationalUnit = api.unitsAt(state, space, unit.faction).some((candidate) => api.isCombatUnit(candidate) &&
              candidate.supplied &&
              api.nationalityGroup(candidate.nation) === nationality);
          const usFrenchPort = unit.nation === "us" &&
              api.spaceById[space]?.nation === "fr" &&
              Boolean(api.spaceById[space]?.port);
          return nationalSource || suppliedNationalUnit || usFrenchPort;
      });
  }

  function srDestinationKeepsHqsResolvable(state, unit, destination) {
      if (!unit.location || unit.type === "hq")
          return true;
      const existing = new Set(orphanHqs(state).map((hq) => hq.id));
      const origin = unit.location;
      if (destination === "reserve")
          delete unit.location;
      else
          unit.location = destination;
      const stranded = orphanHqs(state).filter((hq) => hq.faction === unit.faction && !existing.has(hq.id));
      let resolvable = true;
      if (stranded.length) {
          if (state.sr.free ||
              state.sr.remaining - (unit.type === "army" ? 3 : 1) < stranded.length)
              resolvable = false;
          else
              resolvable = stranded.every((hq) => hq.supplied && srDestinations(state, hq).length);
      }
      unit.location = origin;
      return resolvable;
  }

  function legalSrDestinations(state, unit) {
      const destinations = unit.location
          ? srDestinations(state, unit)
          : reserveSrDestinations(state, unit);
      return destinations.filter((space) => srDestinationKeepsHqsResolvable(state, unit, space));
  }

  function resolveEntrench(state, space) {
      if (state.ops?.execution_phase !== "construct")
          throw new Error("Construction is not the current operations phase");
      if (!activationSpacesForKinds(state, ["move", "construct"]).includes(space))
          throw new Error("Space is not activated for construction");
      const activated = constructionUnits(state, space);
      if (!activated.length)
          throw new Error("No unit can construct in this space");
      const rule = trenchRule(state, state.active);
      if (!rule)
          throw new Error("Trench construction has not been enabled");
      state.ops.entrench_attempted ||= [];
      if (state.ops.entrench_attempted.includes(space))
          throw new Error("This activation has already constructed fieldworks");
      if (!constructionAvailable(state, space))
          throw new Error("No fieldworks can be built here");
      api.snapshot(state, "修筑");
      const terrain = api.spaceById[space]?.terrain;
      const level = state.trenches[space] || 0;
      const maximum = constructionMaximumTrench(state, space);
      state.ops.entrench_attempted.push(space);
      const veteranCorps = activated.filter((unit) => unit.type === "corps" && api.pieceById[unit.piece]?.veteran).length;
      const veteranAuto = rule.veteran_auto &&
          state.commitment[state.active] === "total" &&
          level === 0 &&
          ["fr", "be", "ge"].includes(api.spaceById[space]?.nation) &&
          (activated.some((unit) => unit.type === "army" && api.pieceById[unit.piece]?.veteran) ||
              veteranCorps >= 2);
      if (veteranAuto) {
          state.trenches[space] = 1;
          delete state.fortifications[space];
      }
      else {
          // Construction is calculated once per activated space.  LCU and SCU
          // construction values are alternatives, not cumulative: any LCU
          // contributes 3 points on the West Front and 2 in Italy; otherwise
          // each SCU contributes 1.
          const points = activated.some((unit) => unit.type === "army")
              ? (api.theaterOf(space) === "italian" ? 2 : 3)
              : activated.filter((unit) => unit.type === "corps").length;
          const cap = ["mountain", "alpine"].includes(terrain) ? 2 : 6;
          const total = Math.min(cap, (state.fortifications[space] || 0) + points);
          if (total >= 6 && level < maximum) {
              state.trenches[space] = level + 1;
              delete state.fortifications[space];
          }
          else
              state.fortifications[space] = total;
      }
      api.log(state, `${api.spaceById[space]?.name} 修筑防御工事。`);
  }

  function resolveCombination(state, ids) {
      if (state.ops?.execution_phase !== "move")
          throw new Error("Combination is not available outside the movement phase");
      if (!Array.isArray(ids) || ids.length !== 2 || new Set(ids).size !== 2)
          throw new Error("Choose one reduced army and one corps");
      const selected = ids
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(Boolean);
      if (selected.length !== ids.length ||
          selected.some((unit) => unit.faction !== state.active))
          throw new Error("Only friendly units may combine");
      if (selected.some((unit) => unit.moved ||
          unit.attacked ||
          !unitIsActivated(state, unit, ["move", "construct"])))
          throw new Error("Every combining unit must be move-activated and unmoved");
      if (new Set(selected.map((unit) => unit.location)).size !== 1 ||
          new Set(selected.map((unit) => api.nationalityGroup(unit.nation))).size !== 1)
          throw new Error("Combined units must share a space and nationality");
      const army = selected.find((unit) => unit.type === "army" && unit.reduced);
      const corps = selected.find((unit) => unit.type === "corps");
      if (!army || !corps)
          throw new Error("Combination requires a reduced army and a corps");
      api.snapshot(state, "组合单位");
      army.reduced = false;
      api.eliminateUnit(state, corps.id, "Combination");
      api.log(state, `${api.spaceById[army.location]?.name}：减员 LCU 与 SCU 完成组合。`);
  }

  function commitActivation(state, space, kind, unitIds) {
      const spec = activationSelectionSpec(state, space, kind);
      if (!Array.isArray(unitIds) ||
          new Set(unitIds).size !== unitIds.length ||
          unitIds.length < spec.minimum ||
          unitIds.length > spec.maximum ||
          unitIds.some((id) => !spec.candidates.includes(id)) ||
          spec.required.some((id) => !unitIds.includes(id)))
          throw new Error("Invalid activation unit selection");
      const selected = selectedActivationUnits(state, space, unitIds);
      const cost = activationCost(state, space, kind, unitIds);
      const allOut = api.activeRule(state, "all_out_war");
      const nationalityCount = activationNationalityCount(selected);
      if (state.active === api.AP &&
          allOut?.ignore_activation_nationality_once &&
          nationalityCount > 1)
          state.usage_limits[`all_out_activation:${state.turn}:${state.action_round}`] = 1;
      const italianBonus = api.spaceById[space]?.nation === "it" ? state.ops.italian_bonus || 0 : 0;
      const bonusSpent = Math.min(cost, italianBonus);
      const normalCost = cost - bonusSpent;
      if (normalCost > state.ops.remaining)
          throw new Error("Insufficient OP");
      api.snapshot(state, "激活");
      state.ops.italian_bonus = Math.max(0, italianBonus - bonusSpent);
      state.ops.remaining -= normalCost;
      if (api.spaceById[space]?.large_area) {
          const regions = ensureRegionActivations(state);
          const stacks = regions[kind][space] ||= [];
          stacks.push({
              units: unitIds.slice(),
              cost,
              order: (state.ops.region_activation_order =
                  (Number(state.ops.region_activation_order) || 0) + 1),
          });
          refreshRegionActivationMarker(state, space);
          if (!state.ops.activated.includes(space)) state.ops.activated.push(space);
      }
      else {
          state.activations[space] = kind;
          state.ops.activated.push(space);
      }
      if (kind === "attack") {
          state.ops.attack_marker_spaces ||= [];
          if (!state.ops.attack_marker_spaces.includes(space))
              state.ops.attack_marker_spaces.push(space);
      }
      state.ops.activated_units ||= {};
      state.ops.activated_units[space] = [
          ...new Set([...(state.ops.activated_units[space] || []), ...unitIds]),
      ];
      state.state = "ops_activate";
      if (state.active === api.AP && kind === "attack") {
          const french = selected.some((unit) => unit.nation === "fr");
          const american = selected.some((unit) => unit.nation === "us");
          if (french && !american) {
              const penalty = (state.mo.current.fr || []).filter((id) => {
                  const mo = api.moDefinition(state, id);
                  return state.mo.revealed.includes(id) &&
                      (mo?.passive === "fr_attack_without_us_rp_loss" ||
                      (mo?.source_card === 743 && mo.prohibition === "attack"));
              }).length;
              if (penalty) {
                  state.rp.ap.fr = Math.max(0, state.rp.ap.fr - penalty);
                  api.log(state, `法军兵变：法军进攻标记消耗 ${penalty} FR:RP。`);
              }
          }
      }
  }

  function activate(state, space, kind) {
      if (!["move", "attack", "construct"].includes(kind))
          throw new Error("Invalid activation type");
      if (state.ops?.execution_phase)
          throw new Error("Activation is closed while resolving stacks");
      if (!legalActivationSpaces(state, kind).includes(space))
          throw new Error("Space cannot be activated");
      if (state.activations[space] && !api.spaceById[space]?.large_area)
          throw new Error("Space is already activated");
      if (state.ops.prohibit_attack && kind === "attack")
          throw new Error("This event's OP cannot be used for attacks");
      const spec = activationSelectionSpec(state, space, kind);
      if (spec.large_area) {
          state.ops.pending_activation = {
              space,
              kind,
              candidates: spec.candidates.slice(),
              selected: [],
          };
          state.state = "activation_region";
          return;
      }
      commitActivation(state, space, kind, spec.candidates);
  }

  function pendingRegionActivationLegal(state) {
      const pending = state.ops?.pending_activation;
      if (!pending || !api.spaceById[pending.space]?.large_area) return false;
      const selected = pending.selected || [];
      if (!selected.length || selected.length > 3 ||
          selected.some((id) => !pending.candidates.includes(id)) ||
          selected.some((id) => regionUnitActivated(state, id))) return false;
      const units = selected.map((id) => state.units.find((unit) => unit.id === id)).filter(Boolean);
      if (units.length !== selected.length || units.some((unit) => unit.location !== pending.space)) return false;
      if (pending.kind === "attack") {
          const combatUnits = units.filter(api.isCombatUnit);
          if (!combatUnits.length || units.some((unit) => unit.type === "hq" &&
              !combatUnits.some((combat) =>
                  api.nationalityGroup(combat.nation) === api.nationalityGroup(unit.nation)))) return false;
          if (!api.geometricAttackTargets(state, combatUnits).length) return false;
      }
      if (pending.kind === "construct" && !units.some(api.isCombatUnit)) return false;
      return activationCost(state, pending.space, pending.kind, selected) <= state.ops.remaining +
          (api.spaceById[pending.space]?.nation === "it" ? state.ops.italian_bonus || 0 : 0);
  }

  function selectRegionActivationUnit(state, id) {
      const pending = state.ops?.pending_activation;
      if (!pending || !pending.candidates.includes(id) || pending.selected.includes(id) || pending.selected.length >= 3)
          throw new Error("Illegal large-area activation unit");
      pending.selected.push(id);
  }

  function deselectRegionActivationUnit(state, id) {
      const pending = state.ops?.pending_activation;
      if (!pending?.selected.includes(id)) throw new Error("Unit is not selected");
      pending.selected = pending.selected.filter((unitId) => unitId !== id);
  }

  function confirmRegionActivation(state) {
      const pending = state.ops?.pending_activation;
      if (!pendingRegionActivationLegal(state)) throw new Error("Illegal large-area activation stack");
      const { space, kind, selected } = pending;
      state.ops.pending_activation = null;
      commitActivation(state, space, kind, selected);
  }

  function cancelRegionActivation(state) {
      if (!state.ops?.pending_activation) throw new Error("No large-area activation selection");
      state.ops.pending_activation = null;
      state.state = "ops_activate";
  }

  function resolveSrDestination(state, destination) {
      const selectedUnit = state.sr.selected_unit;
      const mapIndex = state.units.findIndex((candidate) => candidate.id === selectedUnit && candidate.faction === state.active);
      const reserveIndex = state.reserves[state.active].findIndex((candidate) => candidate.id === selectedUnit);
      const unit = mapIndex >= 0
          ? state.units[mapIndex]
          : reserveIndex >= 0
              ? state.reserves[state.active][reserveIndex]
              : null;
      if (!unit)
          throw new Error("Unit not found");
      state.sr.used_units ||= [];
      if (state.sr.used_units.includes(unit.id))
          throw new Error("Unit has already used strategic redeployment");
      api.updateSupply(state);
      let destinations = legalSrDestinations(state, unit);
      let cost = unit.type === "army" ? 3 : 1;
      if (state.sr.free) {
          if (unit.nation !== state.sr.restriction.nation ||
              unit.type !== state.sr.restriction.type)
              throw new Error("Unit does not match free SR restriction");
          destinations = destinations.filter((space) => state.sr.destinations.includes(space) &&
              !state.sr.used_destinations.includes(space));
          cost = 1;
      }
      if (state.sr.remaining < cost || !destinations.includes(destination))
          throw new Error("Illegal strategic redeployment");
      api.snapshot(state, "战略调动");
      state.sr.remaining -= cost;
      if (mapIndex >= 0 && destination === "reserve") {
          const origin = unit.location;
          state.units.splice(mapIndex, 1);
          api.normalizeOffMapUnit(unit);
          state.reserves[state.active].push(unit);
          if (Number(api.spaceById[origin]?.fort) > 0)
              api.refreshBesiegedSpace(state, origin);
      }
      else if (reserveIndex >= 0) {
          state.reserves[state.active].splice(reserveIndex, 1);
          unit.location = destination;
          unit.moved = false;
          unit.attacked = false;
          state.units.push(unit);
      }
      else {
          const origin = unit.location;
          unit.location = destination;
          if (Number(api.spaceById[origin]?.fort) > 0)
              api.refreshBesiegedSpace(state, origin);
          if (Number(api.spaceById[unit.location]?.fort) > 0)
              api.refreshBesiegedSpace(state, unit.location);
      }
      state.sr.used_units.push(unit.id);
      if (state.sr.free)
          state.sr.used_destinations.push(destination);
      state.sr.selected_unit = null;
      api.updateSupply(state);
  }
return Object.freeze({
    activate,
    activationCandidates,
    activationCost,
    activationSelectionSpec,
    advanceEarlyStackResolution,
    advanceSequentialOpsResolution,
    beginEarlyStack,
    beginEarlyStackResolution,
    beginGroupMovement,
    beginMovementSelection,
    beginOps,
    beginSequentialOpsResolution,
    beginUnitMovement,
    canFinishUnitMovement,
    canLeaveBesiegedFort,
    canPotentiallyEnterFort,
    candidateSpaces,
    commitActivation,
    confirmRegionActivation,
    cancelRegionActivation,
    constructionAvailable,
    constructionMaximumTrench,
    constructionUnits,
    crossTheaterSrDestinationAllowed,
    earlyActivationAvailable,
    earlyEntryAllowed,
    earlySrDestinationAllowed,
    earlyStackHasAttackers,
    earlyStackUnitIds,
    canOccupyByEarlyWarDepth,
    earlyWarOccupationLimit,
    explainPiece,
    explainSpace,
    finalizeMovementUnit,
    finishEarlyStack,
    finishMovementUnits,
    finishOps,
    finishUnitMovement,
    forcedAttackCandidates,
    forcedAttackRequiredUnits,
    commitForcedAttackMarkers,
    groupCanLeaveDestination,
    groupContinuationPossible,
    groupMovementCanBegin,
    groupStepCanOccupy,
    groupStepKeepsHqsResolvable,
    hqAtSupplySource,
    hqEndLegal,
    hqHasNationalStack,
    legalActivationSpaces,
    legalCombinationGroups,
    legalConstructionSpaces,
    legalMoveUnitIds,
    legalSrDestinations,
    minimumActivationUnitIds,
    moveUnitOneSpace,
    movementContext,
    pendingRegionActivationLegal,
    movementDestinationKeepsHqsResolvable,
    movementDestinations,
    movementEndpointLegal,
    movementPaths,
    movementRoutes,
    movementSelectionCandidates,
    movementSelectionDestinations,
    movementStepDestinations,
    orphanHqs,
    overlandSrSpaces,
    prepareOpsAttackSelection,
    requestOpsFinish,
    regionActivationBatchForUnit,
    regionActivationStacks,
    selectRegionActivationUnit,
    deselectRegionActivationUnit,
    reserveSrDestinations,
    resolveCombination,
    resolveEntrench,
    resolveSrDestination,
    resumeOpsExecutionState,
    occupationDepth,
    occupationDepths,
    routeHasPrefix,
    schlieffenSr,
    schlieffenSrActions,
    schlieffenSrDestinations,
    schlieffenSrUnits,
    schlieffenOverstackCandidates,
    returnSchlieffenUnit,
    selectedActivationUnits,
    srDestinationKeepsHqsResolvable,
    srDestinations,
    trenchRule,
    unitIsActivated,
    validateMovementPath,
  });
}

module.exports = { createOperationsSystem };
