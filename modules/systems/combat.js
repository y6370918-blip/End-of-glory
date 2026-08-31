"use strict";

function reason(code, label = null, importance = "normal") {
  return { code, label, importance };
}

function createCombatSystem(api) {
  function candidateSpaces(_state, origins) {
    return [...origins].flatMap((origin) => api.landNeighbors(origin));
  }

  function explainSpace(state, destination, origins) {
    if (![...origins].some((origin) => api.connectionAllows(origin, destination, "attack", state.active)))
      return reason("connection_mode");
    if (!api.unitsAt(state, destination, api.other(state.active)).some(api.isCombatUnit) && !intactFort(state, destination))
      return reason("enemy_blocked", "目标地区没有可攻击的敌军或完整要塞");
    const selected = state.ops?.attack_selection || [];
    if (!selected.length) return reason("rule_forbidden", "必须先选择战斗单位");
    try {
      validateAttackDeclaration(state, { attackers: selected, target: destination, flank: false });
    } catch (error) {
      return reason("rule_forbidden", error.message);
    }
    return reason("rule_forbidden");
  }

  function explainPiece(state, unit) {
    if (!unit || unit.faction !== state.active) return reason("nationality");
    if (unit.attacked) return reason("already_attacked");
    if (!api.isAttackParticipant(unit)) return reason("rule_forbidden", "该棋子不能参战");
    if (!api.unitIsActivated(state, unit, ["attack"]) && !unit.attack_eligible)
      return reason("rule_forbidden", "该单位没有进攻激活");
    if (unit.type === "hq") return reason("hq_escort", "将领须与同地战斗单位共同进攻");
    return reason("rule_forbidden", "该单位与当前组合没有共同目标");
  }

  

  function intactFort(state, spaceId) {
      const strength = Number(api.spaceById[spaceId]?.fort) || 0;
      return strength > 0 && !state.destroyed_forts.includes(spaceId)
          ? strength
          : 0;
  }

  function fortCombatStrength(state, spaceId) {
      const printed = intactFort(state, spaceId);
      if (!printed)
          return 0;
      const marker = state.markers.killing_ground;
      const rule = marker && api.ruleModifier(api.cardById[marker.source_card || 720]);
      return marker?.space === spaceId ? Number(rule?.fort_fire) || 0 : printed;
  }

  function canBesiegeWithUnits(units, lossFactor) {
      const combatUnits = units.filter(api.isCombatUnit);
      return (combatUnits.some((unit) => unit.type === "army") ||
          combatUnits.filter((unit) => unit.type === "corps").length >= lossFactor);
  }

  function canBesiege(state, spaceId, faction, excluded = []) {
      const lossFactor = intactFort(state, spaceId);
      if (!lossFactor || api.spaceById[spaceId]?.faction === faction)
          return false;
      const excludedIds = new Set(excluded);
      return canBesiegeWithUnits(api.unitsAt(state, spaceId, faction).filter((unit) => !excludedIds.has(unit.id)), lossFactor);
  }

  function refreshBesiegedSpace(state, spaceId) {
      const lossFactor = intactFort(state, spaceId);
      const owner = api.spaceById[spaceId]?.faction;
      const besieger = owner && api.other(owner);
      const besieged = lossFactor && besieger && canBesiege(state, spaceId, besieger);
      if (besieged) {
          if (!state.besieged.includes(spaceId))
              state.besieged.push(spaceId);
      }
      else
          state.besieged = state.besieged.filter((id) => id !== spaceId);
      return Boolean(besieged);
  }

  function refreshBesieged(state) {
      for (const space of api.data.spaces.filter((candidate) => Number(candidate.fort) > 0))
          refreshBesiegedSpace(state, space.id);
  }

  function destroyFort(state, spaceId, reason = "Fort destroyed", addFortification = true) {
      if (!intactFort(state, spaceId))
          return false;
      state.destroyed_forts.push(spaceId);
      state.besieged = state.besieged.filter((id) => id !== spaceId);
      const occupier = state.units.find((unit) => unit.location === spaceId &&
          api.isCombatUnit(unit) &&
          unit.faction !== api.spaceById[spaceId]?.faction);
      if (occupier)
          api.captureSpace(state, spaceId, occupier.faction);
      if (addFortification)
          state.fortifications[spaceId] = Math.max(1, Number(state.fortifications[spaceId]) || 0);
      api.log(state, `${api.spaceById[spaceId]?.name || spaceId}: ${reason}.`);
      return true;
  }

  function cleanupEmptyFortifications(state) {
      for (const space of Object.keys(state.fortifications))
          if (!api.unitsAt(state, space).some(api.isCombatUnit))
              delete state.fortifications[space];
  }

  function assignedDestroyMoQualifies(state, combat, nation, id, destroyedUnit) {
      const definition = api.moDefinition(state, id);
      if (definition?.requirement !== "destroy_enemy_army" ||
          (definition.target && definition.target !== destroyedUnit.nation))
          return false;
      const markerOrigins = new Set(combat.mo_marker_origins?.[nation] || []);
      if (!markerOrigins.size)
          return false;
      const participants = combat.participant_units || [];
      return (combat.attackers || []).some((unitId) => {
          const unit = participants.find((candidate) => candidate.id === unitId) ||
              state.units.find((candidate) => candidate.id === unitId);
          const origin = combat.origins?.[unitId] || unit?.location;
          return unit?.nation === nation &&
              api.isCombatUnit(unit) &&
              markerOrigins.has(origin);
      });
  }

  function eliminateUnit(state, id, reason = "消灭") {
      const index = state.units.findIndex((unit) => unit.id === id);
      if (index < 0)
          return;
      const [unit] = state.units.splice(index, 1);
      const destination = api.placeEliminatedUnit(state, unit, reason);
      if (Number(api.spaceById[unit.location]?.fort) > 0)
          refreshBesiegedSpace(state, unit.location);
      if (unit.type === "army") {
          const combat = state.combat;
          if (combat) {
              const assignments = combat.mo_assignments || {};
              if (unit.faction === combat.attacker) {
                  const id = assignments[unit.nation];
                  if (api.moDefinition(state, id)?.requirement === "lose_friendly_army")
                      api.progressMoById(state, unit.nation, id, 1, "combat_loss");
              }
              else {
                  for (const [nation, id] of Object.entries(assignments))
                      if (assignedDestroyMoQualifies(state, combat, nation, id, unit))
                          api.progressMoById(state, nation, id, 1, "enemy_army_destroyed");
              }
          }
      }
      api.log(state, `${reason}：${api.pieceById[unit.piece]?.name || unit.id}${destination === "permanent" ? "（永久移除）" : ""}。`);
  }

  function removeUnit(state, id) {
      const index = state.units.findIndex((unit) => unit.id === id);
      if (index < 0)
          return null;
      return state.units.splice(index, 1)[0];
  }

  function reduceUnit(state, id) {
      const unit = state.units.find((candidate) => candidate.id === id);
      if (!unit)
          return 0;
      const piece = api.pieceById[unit.piece];
      if (unit.reduced) {
          const loss = piece?.reduced_loss || 1;
          eliminateUnit(state, id, "伤亡");
          return loss;
      }
      unit.reduced = true;
      return piece?.loss || 1;
  }

  function permanentlyEliminateCombatArmy(state, army, reason) {
      const pool = state.eliminated[army.faction];
      const index = pool.findIndex((unit) => unit.id === army.id);
      if (index >= 0)
          pool.splice(index, 1);
      state.permanently_removed_units.push({
          ...api.clone(army),
          removed_by: reason,
          removed_turn: state.turn,
      });
  }

  function placeCombatReplacement(state, pending, id) {
      const pool = state.reserves[pending.faction];
      const index = pool.findIndex((unit) => unit.id === id);
      if (index < 0 || !pending.options.includes(id))
          throw new Error("Illegal army replacement corps");
      const [replacement] = pool.splice(index, 1);
      api.hydrateUnit(replacement);
      replacement.location = pending.location;
      replacement.moved = true;
      replacement.attacked = true;
      state.units.push(replacement);
      const sideIds = pending.side === state.combat.attacker
          ? state.combat.attackers
          : state.combat.defenders;
      if (!sideIds.includes(replacement.id))
          sideIds.push(replacement.id);
      if (pending.resume === "retreat_overstack" && state.pending_retreat) {
          const retreat = state.pending_retreat;
          retreat.units = (retreat.units || []).map((unitId) =>
              unitId === pending.army ? replacement.id : unitId);
          retreat.remaining ||= {};
          retreat.paths ||= {};
          retreat.remaining[replacement.id] = retreat.remaining[pending.army];
          retreat.paths[replacement.id] = (retreat.paths[pending.army] || [pending.location]).slice();
          delete retreat.remaining[pending.army];
          delete retreat.paths[pending.army];
          if (retreat.overstack_loss_paid?.[pending.army]) {
              retreat.overstack_loss_paid[replacement.id] = true;
              delete retreat.overstack_loss_paid[pending.army];
          }
          if (retreat.selected_unit === pending.army)
              retreat.selected_unit = replacement.id;
          if (retreat.overstack) {
              retreat.overstack.group = (retreat.overstack.group || []).map((unitId) =>
                  unitId === pending.army ? replacement.id : unitId);
              if (retreat.overstack.unit === pending.army)
                  retreat.overstack.unit = replacement.id;
          }
      }
      state.combat.resolution_events ||= [];
      state.combat.resolution_events.push({
          kind: "replace",
          side: pending.side,
          unit: pending.army,
          replacement: replacement.id,
          space: pending.location,
          reduced: Boolean(replacement.reduced),
      });
      api.log(state, `${api.pieceById[pending.army_piece]?.name || pending.army}由${api.pieceById[replacement.piece]?.name || replacement.id}（${replacement.reduced ? "减员" : "满员"}）替换。`);
  }

  function reduceCombatUnit(state, id) {
      const unit = state.units.find((candidate) => candidate.id === id);
      if (!unit)
          return 0;
      const piece = api.pieceById[unit.piece];
      const applied = unit.reduced ? piece?.reduced_loss || 1 : piece?.loss || 1;
      if (!unit.reduced) {
          unit.reduced = true;
          state.combat.resolution_events ||= [];
          state.combat.resolution_events.push({
              kind: "reduce",
              side: state.combat.pending_side,
              unit: unit.id,
              space: unit.location,
          });
          return applied;
      }
      const army = unit.type === "army" ? api.clone(unit) : null;
      const permanent = Boolean(army) && api.permanentOnElimination(army);
      const outOfSupply = Boolean(army) && !unit.supplied && !unit.limited_supply && !unit.fort_limited_supply;
      const replacementOptions = army && !outOfSupply ? api.combatReplacementOptions(state, unit) : [];
      reduceUnit(state, id);
      state.combat.resolution_events ||= [];
      state.combat.resolution_events.push({
          kind: "eliminate",
          side: state.combat.pending_side,
          unit: id,
          space: army?.location || unit.location,
          permanent: outOfSupply || permanent,
      });
      if (!army)
          return applied;
      if (outOfSupply && !permanent) {
          permanentlyEliminateCombatArmy(state, army, "combat_out_of_supply");
          api.log(state, `${api.pieceById[army.piece]?.name || army.id}完全断补，永久移除且不替换。`);
      }
      if (!outOfSupply && replacementOptions.length) {
          const pending = {
              army: army.id,
              army_piece: army.piece,
              faction: army.faction,
              side: state.combat.pending_side,
              location: army.location,
              options: replacementOptions.map((candidate) => candidate.id),
              resume: state.state === "retreat_overstack" ? "retreat_overstack" : undefined,
          };
          if (pending.options.length === 1)
              placeCombatReplacement(state, pending, pending.options[0]);
          else {
              state.pending_replacement = pending;
              state.state = "combat_replacement";
          }
      }
      else if (!outOfSupply)
          api.log(state, `${api.pieceById[army.piece]?.name || army.id}进入消灭区；预备区无合格SCU，不发生替换。`);
      return applied;
  }

  function lossModelReplacementOptions(model, army) {
      return api.replacementOptionsFromPool(model.reserves, army);
  }

  function buildCombatLossPaths(model, remaining, picked, paths) {
      let branched = false;
      for (let index = 0; index < model.units.length; index++) {
          const unit = model.units[index];
          const piece = api.pieceById[unit.piece];
          const loss = unit.reduced ? piece?.reduced_loss || 1 : piece?.loss || 1;
          if (loss > remaining)
              continue;
          branched = true;
          if (!unit.reduced) {
              const units = model.units.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, reduced: true } : candidate);
              buildCombatLossPaths({ ...model, units }, remaining - loss, [...picked, unit.id], paths);
              continue;
          }
          const units = model.units.filter((_, candidateIndex) => candidateIndex !== index);
          const replacements = unit.type === "army" && (unit.supplied || unit.limited_supply || unit.fort_limited_supply)
              ? lossModelReplacementOptions(model, unit)
              : [];
          if (!replacements.length) {
              buildCombatLossPaths({ ...model, units }, remaining - loss, [...picked, unit.id], paths);
              continue;
          }
          for (const replacement of replacements)
              buildCombatLossPaths({
                  ...model,
                  units: [...units, api.clone(replacement)],
                  reserves: model.reserves.filter((candidate) => candidate.id !== replacement.id),
              }, remaining - loss, [...picked, unit.id], paths);
      }
      if (!model.units.length && model.fort > 0 && model.fort <= remaining) {
          branched = true;
          buildCombatLossPaths({ ...model, fort: 0 }, remaining - model.fort, [...picked, api.FORT_LOSS], paths);
      }
      if (!branched)
          paths.push({ picked, remaining });
  }

  function combatLossChoices(state) {
      const combat = state.combat;
      if (!combat || combat.remaining_loss <= 0)
          return [];
      const ids = combat.pending_side === combat.attacker
          ? combat.attackers
          : combat.defenders;
      const units = ids
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(api.isCombatUnit)
          .map(api.clone);
      const faction = combat.pending_side;
      const fort = faction !== combat.attacker &&
          combat.fort &&
          intactFort(state, combat.target)
          ? combat.fort.loss_factor
          : 0;
      const paths = [];
      buildCombatLossPaths({
          units,
          reserves: state.reserves[faction].map(api.clone),
          fort,
      }, combat.remaining_loss, [], paths);
      if (!paths.length)
          return [];
      const minimumRemaining = Math.min(...paths.map((path) => path.remaining));
      return [
          ...new Set(paths
              .filter((path) => path.remaining === minimumRemaining)
              .map((path) => path.picked[0])
              .filter(Boolean)),
      ];
  }

  function legalCombatLossUnitIds(state) {
      return combatLossChoices(state).filter((id) => id !== api.FORT_LOSS);
  }

  function fireResult(table, strength, die, columnShift = 0) {
      const definition = api.data.crt[table];
      let column = 0;
      for (let index = 0; index < definition.columns.length; index++) {
          if (strength >= definition.columns[index])
              column = index;
      }
      column = Math.max(0, Math.min(definition.columns.length - 1, column + columnShift));
      return definition.rows[Math.max(1, Math.min(6, die)) - 1][column];
  }

  function combatStrength(state, ids) {
      return ids.reduce((sum, id) => {
          const unit = state.units.find((candidate) => candidate.id === id);
          const piece = unit && api.pieceById[unit.piece];
          if (!unit || !piece)
              return sum;
          return sum + (unit.reduced ? piece.reduced_combat : piece.combat);
      }, 0);
  }

  function combatTable(state, ids) {
      return ids.some((id) => state.units.find((unit) => unit.id === id)?.type === "army")
          ? "army"
          : "corps";
  }

  function fireColumn(table, strength, columnShift = 0) {
      const definition = api.data.crt[table];
      let index = 0;
      for (let candidate = 0; candidate < definition.columns.length; candidate++)
          if (strength >= definition.columns[candidate])
              index = candidate;
      index = Math.max(0, Math.min(definition.columns.length - 1, index + columnShift));
      return { index, value: definition.columns[index] };
  }

  function combatHqs(state, faction, combatUnits, defending = false) {
      const locations = new Set(combatUnits.map((unit) => unit.location));
      return state.units.filter((hq) => {
          if (hq.type !== "hq" ||
              hq.faction !== faction ||
              !locations.has(hq.location))
              return false;
          if (!defending &&
              state.activations[hq.location] &&
              !api.unitIsActivated(state, hq, ["attack"]))
              return false;
          return combatUnits.some((unit) => unit.location === hq.location &&
              api.nationalityGroup(unit.nation) === api.nationalityGroup(hq.nation));
      });
  }

  function combatEffectEligible(state, effect, declaration, attackingUnits, defenders) {
      const attacker = state.combat_window?.attacker || state.combat?.attacker || state.active;
      const defender = api.other(attacker);
      if (effect.required_attacker_faction && effect.required_attacker_faction !== attacker)
          return false;
      if (effect.required_defender_faction && effect.required_defender_faction !== defender)
          return false;
      if (effect.requires_target_fort && !api.spaceById[declaration.target]?.fort)
          return false;
      if (effect.italian_front_only && api.theaterOf(declaration.target) !== "italian")
          return false;
      if (effect.attacker_army_nations_any?.length &&
          !attackingUnits.some((unit) => api.isCombatUnit(unit) &&
              unit.type === "army" && effect.attacker_army_nations_any.includes(unit.nation)))
          return false;
      if (effect.defender_nations_all?.length &&
          (!defenders.length || defenders.some((unit) =>
              !api.isCombatUnit(unit) || !effect.defender_nations_all.includes(unit.nation))))
          return false;
      const required = effect.required_faction_nations || {};
      const units = [...attackingUnits, ...defenders].filter(api.isCombatUnit);
      for (const [faction, nations] of Object.entries(required))
          if (!units.some((unit) => unit.faction === faction && nations.includes(unit.nation)))
              return false;
      return true;
  }

  function multinationalAttackValid(units, state = null) {
      const combatUnits = units.filter(api.isCombatUnit);
      const groups = new Set(combatUnits.map((unit) => api.nationalityGroup(unit.nation)));
      if (groups.size <= 1)
          return true;
      const origins = new Map();
      for (const unit of combatUnits) {
          const batch = state && api.spaceById[unit.location]?.large_area
              ? api.regionActivationBatchForUnit(state, unit.id, ["attack"])
              : null;
          const key = batch ? `${unit.location}:${batch.stack.order}` : unit.location;
          if (!origins.has(key)) origins.set(key, new Set());
          origins.get(key).add(api.nationalityGroup(unit.nation));
      }
      return [...origins.values()].some((present) =>
          [...groups].every((group) => present.has(group)));
  }

  function optionalCombatEventChoices(state, declaration = state.ops?.pending_attack) {
      if (!declaration || state.active !== api.AP)
          return [];
      const result = [];
      const decisions = declaration.optional_event_decisions || {};
      const royal = api.cardById[640];
      const diaz = api.cardById[641];
      const royalKey = `optional_combat_event:640:${state.turn}:${state.action_round}`;
      if (state.events[royal.event] && !state.usage_limits[royalKey] &&
          !Object.prototype.hasOwnProperty.call(decisions, 640))
          result.push({ id: 640, key: royalKey, label: royal.title });
      if (state.events[diaz.event] && api.theaterOf(declaration.target) === "italian" &&
          !Object.prototype.hasOwnProperty.call(decisions, 641))
          result.push({ id: 641, key: "optional_combat_event:641", label: diaz.title });
      return result;
  }

  function diazHqSpaces(state, declaration = state.ops?.pending_attack) {
      const status = state.events[api.cardById[641].event];
      if (!declaration || !status?.first_play || api.eventPieceExists(state, "component-003"))
          return [];
      const piece = api.pieceById["component-003"];
      const attackers = declaration.attackers
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(api.isCombatUnit);
      const candidate = {
          id: "diaz-hq",
          piece: piece.id,
          faction: piece.faction,
          nation: piece.nation,
          type: piece.type,
      };
      return [...new Set(attackers.map((unit) => unit.location))]
          .filter((space) => attackers.some((unit) => unit.location === space &&
              api.nationalityGroup(unit.nation) === api.nationalityGroup(piece.nation)))
          .filter((space) => api.stackLegal(state, space, candidate));
  }

  function chooseOptionalCombatEvent(state, token) {
      const declaration = state.ops?.pending_attack;
      const match = /^(640|641):(use|skip)$/.exec(String(token));
      if (!declaration || state.state !== "optional_combat_event" || !match)
          throw new Error("Invalid optional combat event choice");
      const id = Number(match[1]);
      const choice = optionalCombatEventChoices(state, declaration)[0];
      if (!choice || choice.id !== id)
          throw new Error("This combat event is not awaiting a choice");
      const use = match[2] === "use";
      const selectedUnits = declaration.attackers
          .map((unitId) => state.units.find((unit) => unit.id === unitId))
          .filter(Boolean);
      if (!use && id === 641 && !multinationalAttackValid(selectedUnits, state))
          throw new Error("Armando Diaz is required for this multinational attack");
      declaration.optional_event_decisions ||= {};
      declaration.optional_event_decisions[id] = use;
      if (use) {
          declaration.event_effects ||= [];
          if (!declaration.event_effects.includes(id)) declaration.event_effects.push(id);
      }
      if (use && id === 641 && diazHqSpaces(state, declaration).length) {
          declaration.optional_hq_card = 641;
          return;
      }
      commitPendingAttack(state, declaration);
  }

  function attackModeForDeclaration(state, declaration, suppliedUnits = null) {
      const supplied = new Map((suppliedUnits || []).map((unit) => [unit.id, unit]));
      const combatUnits = (declaration?.attackers || [])
          .map((id) => supplied.get(id) || state.units.find((unit) => unit.id === id))
          .filter((unit) => unit && api.isCombatUnit(unit));
      if (!combatUnits.length)
          return "normal";
      const forced = new Set(state.ops?.forced_attacks || []);
      const marked = new Set(state.ops?.attack_marker_spaces || []);
      const declaredMarkerOrigins = new Set(Object.values(declaration?.mo_marker_origins || {}).flat());
      const hasRealAttackMarker = combatUnits.some((unit) =>
          state.activations?.[unit.location] === "attack" ||
          (state.ops && api.unitIsActivated(state, unit, ["attack"])) ||
          forced.has(unit.location) ||
          marked.has(unit.location) ||
          declaredMarkerOrigins.has(unit.location)) ||
          (declaration?.attack_origin?.kind && declaration.attack_origin.kind !== "normal");
      return !hasRealAttackMarker && combatUnits.every((unit) =>
          unit.moved && unit.attack_eligible)
          ? "movement"
          : "normal";
  }

  function placeOptionalCombatHq(state, space) {
      const declaration = state.ops?.pending_attack;
      if (state.state !== "optional_combat_event" || declaration?.optional_hq_card !== 641 ||
          !diazHqSpaces(state, declaration).includes(space))
          throw new Error("Illegal Diaz HQ origin");
      const unit = {
          id: `u${state.next_unit_id++}`,
          piece: "component-003",
          location: space,
          reduced: false,
          moved: false,
          attacked: false,
          tts_guid: null,
      };
      api.hydrateUnit(unit);
      unit.attack_eligible = true;
      state.units.push(unit);
      declaration.attackers.push(unit.id);
      delete declaration.optional_hq_card;
      api.log(state, `[[unit:${unit.id}]]部署到[[space:${space}]]并参加进攻。`);
      commitPendingAttack(state, declaration);
  }

  function combatModifiers(state, declaration, attackingUnits, defenders) {
      const attacker = state.combat_window?.attacker || state.active;
      const target = declaration.target;
      const terrain = api.spaceById[target]?.terrain;
      const attackCombatUnits = attackingUnits.filter(api.isCombatUnit);
      const origins = [
          ...new Set(attackCombatUnits.map((unit) => unit.location)),
      ];
      const crossesRiver = origins.length > 0 &&
          origins.every((origin) => api.connectionRule(origin, target, "river"));
      const result = {
          attack_drm: 0,
          defense_drm: 0,
          attack_column: 0,
          defense_column: 0,
          attack_table: null,
          defense_table: null,
          ignore_trench: false,
          ignore_fortification: false,
          clear_fortification: false,
          cancel_attack: false,
          prohibit_advance: [],
          cancel_retreat: [],
          cancel_advance: [],
          advance_limit: null,
          damaged_advance: false,
          fortification_after: false,
          ignore_natural_terrain: false,
          attack_loss_adjust: 0,
          defense_loss_adjust: 0,
          fort_fire_adjust: 0,
          first_fire: null,
          minimum_retreat: 0,
          retreat_choice: null,
          prohibit_damaged_retreat_cancel: false,
          virtual_trench: 0,
          crosses_river: crossesRiver,
          cards: [],
          mo_attacks: {},
          mo_effects: [],
          modifier_sources: [],
      };
      const movementAttack = attackModeForDeclaration(state, declaration, attackCombatUnits) === "movement";
      if (movementAttack) {
          result.attack_column -= 1;
          result.modifier_sources.push({
              side: "attacker",
              kind: "column",
              amount: -1,
              label: "移动后进攻",
          });
      }
      if (attackCombatUnits.some((unit) => unit.limited_supply || unit.fort_limited_supply)) {
          result.attack_column -= 1;
          result.modifier_sources.push({
              side: "attacker",
              kind: "column",
              amount: -1,
              label: "有限补给",
          });
      }
      if (state.ops?.source === "mo_penalty") {
          const markedOrigins = new Set(state.ops.forced_attacks || []);
          const forcedColumns = new Set(attackCombatUnits
              .map((unit) => unit.location)
              .filter((origin) => markedOrigins.has(origin))).size;
          result.attack_column -= forcedColumns;
          if (forcedColumns)
              result.modifier_sources.push({
                  side: "attacker",
                  kind: "column",
                  amount: -forcedColumns,
                  label: "未完成MO强制进攻",
              });
      }
      const attackingHqs = attackingUnits.filter((unit) => unit.type === "hq" && unit.faction === attacker);
      const defendingHqs = combatHqs(state, api.other(attacker), defenders, true);
      result.attack_hqs = attackingHqs.map((unit) => unit.id);
      result.defense_hqs = defendingHqs.map((unit) => unit.id);
      result.attack_drm += attackingHqs.reduce((sum, unit) => sum + (api.pieceById[unit.piece]?.attack_drm || 0), 0);
      result.defense_drm += defendingHqs.reduce((sum, unit) => sum + (api.pieceById[unit.piece]?.defense_drm || 0), 0);
      for (const hq of attackingHqs) {
          const amount = api.pieceById[hq.piece]?.attack_drm || 0;
          if (amount)
              result.modifier_sources.push({
                  side: "attacker",
                  kind: "drm",
                  amount,
                  label: api.pieceById[hq.piece]?.name || hq.id,
                  unit: hq.id,
              });
      }
      for (const hq of defendingHqs) {
          const amount = api.pieceById[hq.piece]?.defense_drm || 0;
          if (amount)
              result.modifier_sources.push({
                  side: "defender",
                  kind: "drm",
                  amount,
                  label: api.pieceById[hq.piece]?.name || hq.id,
                  unit: hq.id,
              });
      }
      for (const nation of new Set(attackCombatUnits.map((unit) => unit.nation))) {
          const effect = api.moAttackEffect(state, nation, attackCombatUnits, declaration);
          if (effect) {
              result.attack_drm += effect.drm;
              result.attack_column += effect.column;
              if (effect.table)
                  result.attack_table = effect.table;
              result.mo_attacks[nation] = effect.id;
              if (effect.drm || effect.column || effect.table)
                  result.mo_effects.push({
                      nation,
                      id: effect.id,
                      label: api.moDefinition(state, effect.id)?.name || effect.id,
                      drm: effect.drm,
                      column: effect.column,
                      table: effect.table,
                  });
          }
          for (const passive of api.passiveMoModifiers(state, nation, "national_attack_drm"))
              result.attack_drm += passive.drm || 0;
      }
      for (const nation of new Set(defenders.map((unit) => unit.nation)))
          for (const passive of api.passiveMoModifiers(state, nation, "national_defense_drm"))
              result.defense_drm += passive.drm || 0;
      const opsEffect = state.ops?.combat_effect;
      const opsCard = api.cardById[state.ops?.card];
      const italianCombat = api.theaterOf(target) === "italian";
      if (opsEffect &&
          attacker === state.active &&
          (!italianCombat ||
              opsCard?.color !== "yellow" ||
              opsEffect.italian_front_only)) {
          result.attack_column += opsEffect.attack_column || 0;
          if (opsEffect.ignore_trench_with_nation &&
              attackCombatUnits.some((unit) => unit.nation === opsEffect.ignore_trench_with_nation))
              result.ignore_trench = true;
      }
      if (attacker === api.AP && state.turn < 12 && declaration.all_out_group) {
          const choice = allOutAttackChoices(state, declaration)
              .find((entry) => entry.id === declaration.all_out_group);
          if (choice) {
              result.ignore_trench = true;
              result.usage_keys ||= [];
              result.usage_keys.push(choice.usage_key);
          }
      }
      const combatEffectIds = new Set(api.combatCardIds(state));
      for (const id of declaration.event_effects || []) combatEffectIds.add(id);
      for (const id of combatEffectIds) {
          const card = api.cardById[id];
          const effect = api.effectiveCombatEffect(state, id);
          const cardOwner = state.combat_window?.card_owners?.[id] ||
              state.combat?.played_cards?.find((entry) => entry.id === id)?.faction ||
              api.combatCardOwner(state, card);
          if (!card || !effect)
              continue;
          if (effect.optional_once && !(declaration.event_effects || []).includes(id))
              continue;
          if (!combatEffectEligible(state, effect, declaration, attackingUnits, defenders))
              continue;
          if (italianCombat && card.color === "yellow" &&
              !effect.italian_front_only && !effect.all_theaters)
              continue;
          if (!card.combat_card &&
              card.faction !== attacker &&
              effect.applies_to !== attacker)
              continue;
          if (effect.min_turn_for_effect && state.turn < effect.min_turn_for_effect)
              continue;
          if (effect.western_front_only &&
              !["fr", "be", "ge"].includes(api.spaceById[target]?.nation))
              continue;
          if (effect.italian_front_only &&
              api.spaceById[target]?.nation !== "it" &&
              ![...attackingUnits, ...defenders].some((unit) => unit.nation === "it"))
              continue;
          if (effect.only_french_defenders &&
              defenders.some((unit) => unit.nation !== "fr"))
              continue;
          if (effect.attacker_nation &&
              !attackingUnits.some((unit) => unit.nation === effect.attacker_nation))
              continue;
          if (effect.defender_nation &&
              !defenders.some((unit) => unit.nation === effect.defender_nation))
              continue;
          const ownerIsAttacker = effect.applies_to
              ? effect.applies_to === attacker
              : cardOwner === attacker;
          const friendlyDrm = ownerIsAttacker ? "attack_drm" : "defense_drm";
          const enemyDrm = ownerIsAttacker ? "defense_drm" : "attack_drm";
          const friendlyColumn = ownerIsAttacker ? "attack_column" : "defense_column";
          const enemyColumn = ownerIsAttacker ? "defense_column" : "attack_column";
          result[friendlyDrm] += effect.attack_drm || 0;
          result[enemyDrm] += effect.defense_drm || 0;
          if (effect.attack_drm_if_trenched && (state.trenches[target] || 0) > 0)
              result[friendlyDrm] += Number(effect.attack_drm_if_trenched) || 0;
          if (effect.attack_drm_if_defender_nation &&
              defenders.some((unit) => unit.nation === effect.attack_drm_if_defender_nation))
              result[friendlyDrm] += 1;
          if (effect.french_fort_fire_drm &&
              api.spaceById[target]?.nation === "fr" &&
              api.spaceById[target]?.fort) {
              result.fort_fire_adjust += effect.french_fort_fire_drm;
              result.modifier_sources.push({
                  side: "defender",
                  kind: "fort",
                  amount: effect.french_fort_fire_drm,
                  label: `${card.title}：法国要塞火力`,
              });
          }
          if (effect.italian_fort_fire_drm &&
              api.theaterOf(target) === "italian" &&
              api.spaceById[target]?.fort)
              result[enemyDrm] += effect.italian_fort_fire_drm;
          const terrainMatches = !effect.terrain?.length || effect.terrain.includes(terrain);
          const adjacentTerrainMatches = !effect.terrain_or_adjacent?.length ||
              effect.terrain_or_adjacent.includes(terrain) ||
              api.landNeighbors(target).some((space) =>
                  effect.terrain_or_adjacent.includes(api.spaceById[space]?.terrain));
          if (terrainMatches && adjacentTerrainMatches) {
              result[friendlyColumn] += effect.attack_column || 0;
              result[enemyColumn] += effect.defense_column || 0;
              if (effect.attack_column_if_event?.event &&
                  state.events[effect.attack_column_if_event.event])
                  result[friendlyColumn] += Number(effect.attack_column_if_event.amount) || 0;
              if (effect.marker_attack_column && state.markers.somme?.space === target)
                  result[friendlyColumn] += effect.marker_attack_column;
          }
          if (effect.tables?.attacker)
              result.attack_table = effect.tables.attacker;
          if (effect.tables?.defender)
              result.defense_table = effect.tables.defender;
          if (effect.force_table)
              result[ownerIsAttacker ? "attack_table" : "defense_table"] =
                  effect.force_table;
          if (effect.british_attack_corps_table &&
              attackCombatUnits.some((unit) => ["br", "in", "ca", "be"].includes(unit.nation)) &&
              attackCombatUnits.every((unit) => ["br", "in", "ca", "be"].includes(unit.nation)))
              result.attack_table = "corps";
          if (effect.french_attack_column &&
              ownerIsAttacker &&
              attackingUnits.some((unit) => unit.nation === "fr"))
              result.attack_column += effect.french_attack_column;
          if (effect.british_mixed_column &&
              attackCombatUnits.some((unit) => ["br", "in", "ca", "be"].includes(unit.nation)) &&
              attackCombatUnits.some((unit) => !["br", "in", "ca", "be"].includes(unit.nation)))
              result.attack_column += effect.british_mixed_column;
          const hasGeAhArmy = [...attackingUnits, ...defenders].some((unit) => unit.type === "army" && ["ge", "ah"].includes(unit.nation));
          result.ignore_trench ||=
              Boolean(effect.ignore_trench) ||
                  Boolean(effect.ignore_trench_unless_ge_ah_army && !hasGeAhArmy);
          result.ignore_fortification ||= Boolean(effect.ignore_fortification);
          result.clear_fortification ||= Boolean(effect.clear_fortification);
          result.ignore_natural_terrain ||=
              Boolean(effect.ignore_natural_terrain) ||
                  Boolean(effect.ignore_terrain_column) ||
                  Boolean(effect.ignore_terrain_unless_ge_ah_army && !hasGeAhArmy);
          if ((effect.conditional_ignore_fieldworks ||
              effect.ignore_fieldworks_if_defenders_not_all_armies) &&
              defenders.some((unit) => unit.type !== "army")) {
              result.ignore_trench = true;
              result.ignore_fortification = true;
          }
          if (effect.extra_enemy_loss)
              result[ownerIsAttacker ? "defense_loss_adjust" : "attack_loss_adjust"] +=
                  effect.extra_enemy_loss;
          if (effect.defender_loss_adjust)
              result[ownerIsAttacker ? "defense_loss_adjust" : "attack_loss_adjust"] +=
                  effect.defender_loss_adjust;
          if (effect.defender_inflicted_loss_adjust)
              result.attack_loss_adjust += effect.defender_inflicted_loss_adjust;
          result.cancel_attack ||=
              Boolean(effect.cancel_attack) &&
                  state.combat_window?.counterattack_card !== id;
          result.damaged_advance ||= Boolean(effect.damaged_advance);
          if (effect.advance_limit != null)
              result.advance_limit =
                  result.advance_limit == null
                      ? effect.advance_limit
                      : Math.min(result.advance_limit, effect.advance_limit);
          if (effect.prohibit_advance)
              result.prohibit_advance.push(effect.prohibit_advance);
          if (effect.prohibit_advance_if === "river" && crossesRiver)
              result.prohibit_advance.push(attacker);
          if (effect.minimum_retreat != null)
              result.minimum_retreat = Math.max(result.minimum_retreat, effect.minimum_retreat);
          if (effect.retreat_choice)
              result.retreat_choice = effect.retreat_choice.slice();
          if (effect.prohibit_damaged_retreat_cancel)
              result.prohibit_damaged_retreat_cancel = true;
          if (effect.first_fire && !result.first_fire)
              result.first_fire = effect.first_fire;
          if (effect.cancel_retreat)
              result.cancel_retreat.push(effect.cancel_retreat);
          if (effect.cancel_advance)
              result.cancel_advance.push(effect.cancel_advance);
          if (effect.fortification_after)
              result.fortification_after = effect.fortification_after;
          if (effect.virtual_trench) {
              if ((state.trenches[target] || 0) > 0) {
                  const amount = Number(effect.attack_column_if_trenched) || 0;
                  result.attack_column += amount;
                  if (amount)
                      result.modifier_sources.push({
                          side: "attacker",
                          kind: "column",
                          amount,
                          label: card.title,
                      });
              }
              else
                  result.virtual_trench = Math.max(result.virtual_trench,
                      Number(effect.virtual_trench) || 0);
          }
          result.cards.push({
              id,
              title: card.title,
              faction: cardOwner,
              effect: api.clone(effect),
          });
          if (effect.optional_once) {
              result.usage_keys ||= [];
              result.usage_keys.push(id === 640
                  ? `optional_combat_event:640:${state.turn}:${state.action_round}`
                  : `optional_combat_event:${id}`);
          }
      }
      return result;
  }

  function applyCombatOutcomeEffects(state, combat) {
      if (combat.outcome_effects_applied)
          return;
      combat.outcome_effects_applied = true;
      for (const entry of combat.modifiers.cards) {
          const effect = entry.effect;
          const ownerIsAttacker = entry.faction === combat.attacker;
          const ownLoss = ownerIsAttacker ? combat.attack_loss : combat.defense_loss;
          const enemyLoss = ownerIsAttacker
              ? combat.defense_loss
              : combat.attack_loss;
          const won = enemyLoss > ownLoss;
          const tied = enemyLoss === ownLoss;
          if (effect.result_vp && (won || tied))
              api.adjustVp(state, won ? effect.result_vp.win || 0 : effect.result_vp.tie || 0);
      }
      const participants = combat.participant_units ||
          [...combat.attackers, ...combat.defenders]
              .map((id) => state.units.find((unit) => unit.id === id))
              .filter(Boolean);
      const attackers = participants.filter((unit) => combat.attackers.includes(unit.id));
      const defenders = participants.filter((unit) => combat.defenders.includes(unit.id));
      if (combat.defense_loss > combat.attack_loss) {
          for (const nation of new Set(attackers.map((unit) => unit.nation))) {
              if (api.attackQualifiesForMo(attackers, nation)) {
                  const assigned = combat.mo_assignments?.[nation];
                  if (["attack_win", "combat_win"].includes(api.moDefinition(state, assigned)?.requirement))
                      api.progressMoById(state, nation, assigned, 1, api.moDefinition(state, assigned).requirement);
              }
          }
      }
      else if (combat.attack_loss > combat.defense_loss) {
          for (const nation of new Set(defenders.map((unit) => unit.nation))) {
              if (!api.attackQualifiesForMo(defenders, nation))
                  continue;
              const id = combat.defense_mo_assignments?.[nation];
              const requirement = api.moDefinition(state, id)?.requirement;
              if (!["defense_win", "combat_win", "defense_win_counterattack"].includes(requirement))
                  continue;
              api.progressMoById(state, nation, id, 1, requirement);
              if (nation === "us" && id && combat.attacker === api.CP)
                  combat.mo_counterattack = {
                      mo: id,
                      origin: combat.target,
                      units: combat.defenders.slice(),
                  };
          }
      }
  }

  function resolveDeferredFire(state, combat) {
      const deferred = combat.deferred_fire;
      if (!deferred || deferred.resolved)
          return;
      deferred.resolved = true;
      // First-fire casualties may create replacement SCU. Those replacements
      // were not participants when the return-fire roll was made and must not
      // be appended to the deferred firing group.
      const firingIds = deferred.firing_ids || (deferred.firing_side === combat.attacker
          ? combat.attackers
          : combat.defenders);
      const survivors = firingIds.filter((id) => state.units.some((unit) => unit.id === id));
      const fortStrength = deferred.firing_side === api.other(combat.attacker) &&
          intactFort(state, combat.target)
          ? Number(combat.fort?.strength) || 0
          : 0;
      const loss = survivors.length || fortStrength
          ? Math.max(0, fireResult(deferred.table ||
              (fortStrength ? "army" : combatTable(state, survivors)), combatStrength(state, survivors) + fortStrength, deferred.roll, deferred.column) + deferred.loss_adjust)
          : 0;
      if (deferred.target_side === combat.attacker)
          combat.attack_loss = loss;
      else
          combat.defense_loss = loss;
      api.log(state, `>> ${deferred.firing_side === combat.attacker ? "进攻方" : "防守方"}还击：${survivors.map((id) => `[[unit:${id}]]`).join("、") || (fortStrength ? "要塞" : "无幸存开火单位")}，造成 ${loss} 损失。`);
      applyCombatOutcomeEffects(state, combat);
  }

  function beginCounterattackEvent(state, cardId, declaration, attackingUnits) {
      const cpCards = (state.combat_window?.cards || []).filter((id) => id !== cardId && api.cardById[id]?.faction === api.CP);
      for (const id of cpCards)
          delete state.events[api.cardById[id].event];
      // Miracle on the Marne interrupts, but does not end, the current CP
      // operation.  Keep that operation completely separate from the AP
      // counterattack so combat cleanup cannot reinterpret CP activations as
      // AP activations or advance the action round with AP still active.
      for (const unit of attackingUnits)
          unit.attacked = true;
      if (state.ops) {
          const participating = new Set(attackingUnits.map((unit) => unit.location));
          state.ops.forced_attacks = (state.ops.forced_attacks || [])
              .filter((space) => !participating.has(space));
          state.ops.pending_attack = null;
          state.ops.attack_selection = [];
      }
      const origins = [...new Set(attackingUnits.map((unit) => unit.location))]
          .filter((origin) =>
              api.unitsAt(state, origin, api.CP).some(api.isCombatUnit) &&
              state.units.some((unit) =>
                  unit.faction === api.AP &&
                  api.isCombatUnit(unit) &&
                  attacksTarget(state, unit, origin)));
      state.pending_event = {
          kind: "counterattack",
          card: cardId,
          owner: api.AP,
          stage: cpCards.length ? "cards" : "origin",
          cards: cpCards,
          index: 0,
          origins,
          original_target: declaration.target,
          resume: {
              active: state.active,
              ops: api.clone(state.ops),
              activations: api.clone(state.activations),
          },
      };
      state.ops = null;
      state.activations = {};
      state.combat_window = null;
      state.combat = null;
      api.enterEventFlow(state);
      api.setActiveFaction(state, cpCards.length ? api.CP : api.AP);
  }

  function attacksTarget(state, unit, target) {
      if (!api.spaceCanActivate(state, unit.location) ||
          !api.spaceCanActivate(state, target))
          return false;
      if (unit.location === target &&
          state.besieged.includes(target) &&
          intactFort(state, target) &&
          api.spaceById[target]?.faction !== unit.faction)
          return true;
      if (state.besieged.includes(target) &&
          intactFort(state, target) &&
          api.spaceById[target]?.faction !== unit.faction)
          return false;
      return api.connectionAllows(unit.location, target, "attack", unit.faction);
  }

  function defendedAttackTarget(state, target) {
      return (api.unitsAt(state, target, api.other(state.active)).some(api.isCombatUnit) ||
          (intactFort(state, target) &&
              api.spaceById[target]?.faction !== state.active &&
              (!state.besieged.includes(target) ||
                  state.units.some((unit) => unit.faction === state.active && unit.location === target))));
  }

  function geometricAttackTargets(state, attackingUnits) {
      attackingUnits = attackingUnits.filter(api.isCombatUnit);
      if (!attackingUnits.length)
          return [];
      let targets = null;
      for (const unit of attackingUnits) {
          const candidates = [...api.neighborsFor(unit.location, "attack", unit.faction)];
          if (state.besieged.includes(unit.location) &&
              intactFort(state, unit.location) &&
              api.spaceById[unit.location]?.faction !== unit.faction)
              candidates.push(unit.location);
          const legal = new Set(candidates.filter((target) => attacksTarget(state, unit, target) &&
              defendedAttackTarget(state, target)));
          targets =
              targets == null
                  ? legal
                  : new Set([...targets].filter((target) => legal.has(target)));
      }
      return [...(targets || [])].filter((target) =>
          channelAttackSupported(state, attackingUnits, target));
  }

  function channelAttackSupported(state, attackingUnits, target) {
      const combatUnits = attackingUnits.filter(api.isCombatUnit);
      const usesChannel = combatUnits.some((unit) =>
          api.connectionRule(unit.location, target, "requires_land_attack_support"));
      return !usesChannel || combatUnits.some((unit) =>
          !api.connectionRule(unit.location, target, "requires_land_attack_support"));
  }

  function eligibleAttackUnitIds(state) {
      const earlyOrigin = state.turn <= 3 ? state.ops?.execution_origin || null : null;
      const earlyKind = earlyOrigin ? state.activations[earlyOrigin] : null;
      const earlyStackIds = earlyOrigin
          ? new Set(api.earlyStackUnitIds(state, earlyOrigin))
          : null;
      const eligible = state.units
          .filter((unit) => unit.faction === state.active &&
          api.isAttackParticipant(unit) &&
          !unit.attacked &&
          (!earlyStackIds || earlyStackIds.has(unit.id)) &&
          (earlyKind === "move"
              ? unit.moved && unit.attack_eligible
              : api.unitIsActivated(state, unit, ["attack"]) ||
                  unit.attack_eligible));
      const combatUnits = eligible.filter((unit) => api.isCombatUnit(unit) &&
          api.neighborsFor(unit.location, "attack", unit.faction)
              .some((target) => attacksTarget(state, unit, target) && defendedAttackTarget(state, target)));
      const hqs = eligible.filter((unit) => unit.type === "hq" &&
          combatUnits.some((combatUnit) => combatUnit.location === unit.location &&
              api.nationalityGroup(combatUnit.nation) === api.nationalityGroup(unit.nation)));
      return [...combatUnits, ...hqs].map((unit) => unit.id);
  }

  function requiredAttackersByOrigin(state, attackerIds = eligibleAttackUnitIds(state)) {
      return Object.fromEntries((state.ops?.forced_attacks || [])
          .map((space) => [
          space,
          forcedAttackRequiredIds(state, space).filter((id) => attackerIds.includes(id)).length
              ? forcedAttackRequiredIds(state, space).filter((id) => attackerIds.includes(id))
              : attackerIds.filter((id) => {
                  const unit = state.units.find((candidate) => candidate.id === id);
                  return unit?.location === space && api.isCombatUnit(unit);
              }),
      ])
          .filter(([, ids]) => ids.length));
  }

  function forcedAttackRequiredIds(state, origin) {
      const saved = state.ops?.required_attackers?.[origin];
      if (Array.isArray(saved) && saved.length)
          return saved.slice();
      if (state.ops?.source === "nivelle")
          return api.unitsAt(state, origin, api.AP)
              .filter((unit) => unit.nation === "fr" && api.isCombatUnit(unit))
              .map((unit) => unit.id);
      return api.unitsAt(state, origin, state.active)
          .filter(api.isCombatUnit)
          .map((unit) => unit.id);
  }

  function legalTargetsForAttackers(state, attackerIds) {
      if (!attackerIds.length || new Set(attackerIds).size !== attackerIds.length)
          return [];
      const attackingUnits = attackerIds
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(Boolean);
      if (attackingUnits.length !== attackerIds.length)
          return [];
      return geometricAttackTargets(state, attackingUnits).filter((target) => {
          try {
              validateAttackDeclaration(state, {
                  attackers: attackerIds,
                  target,
                  flank: false,
              });
              return true;
          }
          catch {
              return false;
          }
      });
  }

  function attackSelectionActions(state) {
      const eligible = eligibleAttackUnitIds(state);
      const requiredAttackers = requiredAttackersByOrigin(state, eligible);
      const selected = (state.ops?.attack_selection || []).filter((id) => eligible.includes(id));
      const requiredIds = new Set(Object.values(requiredAttackers).flat());
      const targets = legalTargetsForAttackers(state, selected);
      return {
          eligible,
          selected,
          targets,
          requiredAttackers,
          selectable: eligible.filter((id) => !selected.includes(id) &&
              legalTargetsForAttackers(state, [...selected, id]).length),
          deselectable: selected.filter((id) => !requiredIds.has(id)),
      };
  }

  function pruneOrphanAttackHqs(state, ids) {
      const units = ids
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(Boolean);
      const combatUnits = units.filter(api.isCombatUnit);
      return units
          .filter((unit) => unit.type !== "hq" ||
          combatUnits.some((combatUnit) => combatUnit.location === unit.location &&
              api.nationalityGroup(combatUnit.nation) ===
                  api.nationalityGroup(unit.nation)))
          .map((unit) => unit.id);
  }

  function pendingAttackOriginCount(state, declaration = state.ops?.pending_attack) {
      return new Set((declaration?.attackers || [])
          .map((id) => state.units.find((unit) => unit.id === id)?.location)
          .filter(Boolean)).size;
  }

  function allOutAttackChoices(state, declaration = state.ops?.pending_attack) {
      if (!declaration || state.active !== api.AP || state.turn >= 12 ||
          !(state.trenches[declaration.target] > 0))
          return [];
      const rule = api.activeRule(state, "all_out_war");
      if (!rule?.selective_trench_nations)
          return [];
      const attackers = (declaration.attackers || [])
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(api.isCombatUnit);
      const ids = ["br", "fr_us"];
      return rule.selective_trench_nations.flatMap((nations, index) => {
          const usageKey = `all_out_trench:${state.turn}:${state.action_round}:${nations.join("-")}`;
          if (state.usage_limits[usageKey] ||
              !attackers.some((unit) => nations.includes(unit.nation)))
              return [];
          return [{ id: ids[index] || nations.join("_"), nations, usage_key: usageKey }];
      });
  }

  function legalFlankFinals(state) {
      const pending = state.ops?.pending_attack;
      if (!pending)
          return [];
      const count = pendingAttackOriginCount(state, pending);
      const result = [];
      for (let finalDrm = 0; finalDrm <= count; finalDrm++) {
          const declaration = {
              ...pending,
              flank: true,
              flank_final: finalDrm,
          };
          try {
              validateAttackDeclaration(state, declaration);
              result.push(finalDrm);
          }
          catch {
              // This allocation is not a legal flank declaration.
          }
      }
      return result;
  }

  function commitPendingAttack(state, declaration = state.ops?.pending_attack) {
      if (!declaration)
          throw new Error("No pending attack");
      validateAttackDeclaration(state, declaration);
      declaration = {
          ...declaration,
          attack_mode: attackModeForDeclaration(state, declaration),
          mo_marker_origins: api.computeMoMarkerOrigins(state, declaration),
      };
      if (declaration.all_out_decision == null && allOutAttackChoices(state, declaration).length) {
          state.ops.pending_attack = api.clone(declaration);
          state.state = "all_out_attack";
          return;
      }
      const optional = optionalCombatEventChoices(state, declaration);
      if (optional.length) {
          state.ops.pending_attack = api.clone(declaration);
          state.state = "optional_combat_event";
          return;
      }
      declaration.optional_events_resolved = true;
      validateAttackDeclaration(state, declaration);
      api.snapshot(state, "Declare attack");
      state.ops.pending_attack = null;
      beginCombat(state, declaration);
  }

  function resolveCombat(state, declaration) {
      if (state.combat_window && !state.combat_window.cards_revealed)
          api.revealCommittedCombatCards(state);
      // The combat-card window temporarily hands control to each side.  At
      // resolution time state.active can therefore be the last side that
      // passed, rather than the faction that declared the attack.  Combat
      // ownership (including card DRMs and first fire) must stay fixed to the
      // declaration.
      const attacker = state.combat_window?.attacker || state.active;
      const attackers = declaration.attackers || [];
      const target = declaration.target;
      const attackingUnits = attackers
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(Boolean);
      const attackMode = attackModeForDeclaration(state, declaration, attackingUnits);
      declaration.attack_mode = attackMode;
      const moveAttackers = attackMode === "movement"
          ? attackingUnits.filter((unit) => api.isCombatUnit(unit) && unit.moved && unit.attack_eligible)
          : [];
      if (!attackingUnits.length ||
          attackingUnits.some((unit) => unit.faction !== attacker))
          throw new Error("Invalid attackers");
      if (!attackingUnits.every((unit) => attacksTarget(state, unit, target)))
          throw new Error("Attacker is not adjacent");
      const defenders = api.unitsAt(state, target, api.other(attacker)).filter(api.isCombatUnit);
      if (!defenders.length && !intactFort(state, target))
          throw new Error("No defender");
      declaration.mo_marker_origins = api.computeMoMarkerOrigins(state, declaration);
      for (const [nation, id] of Object.entries(declaration.mo_assignments || {}))
          if (id && !api.attackMoCandidates(state, nation, attackingUnits, declaration).includes(id))
              delete declaration.mo_assignments[nation];
      const defendingIds = defenders.map((unit) => unit.id);
      const modifiers = combatModifiers(state, declaration, attackingUnits, defenders);
      state.combat_modifiers = api.clone(modifiers);
      if (modifiers.cancel_attack) {
          const counterattack = modifiers.cards.find((entry) => entry.effect.counterattack);
          if (counterattack) {
              beginCounterattackEvent(state, counterattack.id, declaration, attackingUnits);
              return;
          }
          const canceledMoPenalty = declaration.attack_origin?.kind === "mo_penalty" &&
              modifiers.cards.some((entry) => entry.effect.cancel_mo_attacks);
          if (canceledMoPenalty && state.ops)
              state.ops.forced_attacks = [];
          for (const id of state.combat_window.cards) {
              const effect = api.effectiveCombatEffect(state, id);
              if (!effect?.return_other_combat_cards)
                  continue;
              for (const otherId of state.combat_window.cards.filter((candidate) => candidate !== id)) {
                  const card = api.cardById[otherId];
                  // A remove-on-reveal combat card has already been used.  A
                  // later cancellation may return ordinary cards, but cannot
                  // recover this card from the removed pool.
                  if (card.remove)
                      continue;
                  const source = state.combat_window.card_sources?.[otherId] || "hand";
                  api.removeCardFromPublicPools(state, card.faction, otherId);
                  if (source === "retained")
                      state.retained_combat_cards[card.faction].push(otherId);
                  else if (source === "discard")
                      state.discard[card.faction].push(otherId);
                  else if (!state.hands[card.faction].includes(otherId))
                      state.hands[card.faction].push(otherId);
                  delete state.events[card.event];
              }
          }
          state.combat_window = null;
          api.log(state, `战斗 ${target} 被战斗牌取消。`);
          api.clearCombatEvents(state);
          if (canceledMoPenalty) {
              api.finishOps(state);
              return;
          }
          state.state = "ops_activate";
          return;
      }
      const preCombatFortDestruction = modifiers.cards.some((entry) => entry.effect.destroy_belgian_fort &&
          api.spaceById[target]?.nation === "be" &&
          intactFort(state, target));
      if (preCombatFortDestruction)
          destroyFort(state, target, "fort destroyed before combat", false);
      const printedFortLossFactor = intactFort(state, target);
      const defendingFortPresent = Boolean(printedFortLossFactor);
      const fortLossFactor = printedFortLossFactor
          ? Math.max(0, printedFortLossFactor + (Number(modifiers.fort_fire_adjust) || 0))
          : 0;
      const fortStrength = printedFortLossFactor
          ? Math.max(0, fortCombatStrength(state, target) + (Number(modifiers.fort_fire_adjust) || 0))
          : 0;
      if (state.ops?.forced_attacks?.length) {
          const participating = new Set(attackingUnits.map((unit) => unit.location));
          state.ops.forced_attacks = state.ops.forced_attacks.filter((space) => !participating.has(space));
      }
      if (modifiers.clear_fortification)
          delete state.fortifications[target];
      let attackDrm = modifiers.attack_drm;
      let defenseDrm = modifiers.defense_drm;
      const trenchLevel = Math.max(state.trenches[target] || 0,
          modifiers.virtual_trench || 0);
      if (!modifiers.ignore_trench &&
          trenchLevel > 0 &&
          (defenders.length || !defendingFortPresent)) {
          modifiers.attack_column -= 1;
          modifiers.defense_column += trenchLevel;
          modifiers.modifier_sources.push({ side: "attacker", kind: "column", amount: -1, label: "战壕" }, {
              side: "defender",
              kind: "column",
              amount: trenchLevel,
              label: modifiers.virtual_trench && !(state.trenches[target] > 0)
                  ? "1914年精神：视为一级战壕"
                  : `战壕等级 ${trenchLevel}`,
          });
      }
      if (!modifiers.ignore_fortification &&
          (state.fortifications[target] ||
              attackingUnits.some((unit) => state.fortifications[unit.location]))) {
          attackDrm -= 1;
          modifiers.modifier_sources.push({
              side: "attacker",
              kind: "drm",
              amount: -1,
              label: "防御工事",
          });
      }
      if (!modifiers.ignore_natural_terrain) {
          const terrain = api.spaceById[target]?.terrain;
          if (modifiers.crosses_river) {
              modifiers.attack_column -= 1;
              modifiers.modifier_sources.push({
                  side: "attacker",
                  kind: "column",
                  amount: -1,
                  label: "跨河进攻",
              });
          }
          if (terrain === "mountain") {
              modifiers.attack_column -= 1;
              modifiers.modifier_sources.push({
                  side: "attacker",
                  kind: "column",
                  amount: -1,
                  label: "山地",
              });
          }
          if (terrain === "swamp") {
              modifiers.attack_column -= 2;
              modifiers.modifier_sources.push({
                  side: "attacker",
                  kind: "column",
                  amount: -2,
                  label: "沼泽目标",
              });
          }
          if (attackingUnits.every((unit) => api.spaceById[unit.location]?.terrain === "swamp")) {
              modifiers.attack_column -= 1;
              modifiers.modifier_sources.push({
                  side: "attacker",
                  kind: "column",
                  amount: -1,
                  label: "从沼泽发起进攻",
              });
          }
      }
      const cavalryAttack = attackingUnits.some((unit) => api.pieceById[unit.piece]?.cavalry);
      const cavalryDefense = defenders.some((unit) => api.pieceById[unit.piece]?.cavalry);
      if (cavalryAttack &&
          !cavalryDefense &&
          !state.trenches[target] &&
          !fortLossFactor) {
          attackDrm += 1;
          modifiers.modifier_sources.push({
              side: "attacker",
              kind: "drm",
              amount: 1,
              label: "骑兵优势",
          });
      }
      if (cavalryDefense &&
          !cavalryAttack &&
          !state.trenches[target] &&
          !fortLossFactor) {
          defenseDrm += 1;
          modifiers.modifier_sources.push({
              side: "defender",
              kind: "drm",
              amount: 1,
              label: "骑兵优势",
          });
      }
      const mountainAttack = attackingUnits.some((unit) => api.pieceById[unit.piece]?.mountain);
      const mountainDefense = defenders.some((unit) => api.pieceById[unit.piece]?.mountain);
      const mountainTerrain = api.spaceById[target]?.terrain === "mountain" ||
          attackingUnits.some((unit) => api.spaceById[unit.location]?.terrain === "mountain");
      if (mountainTerrain && mountainAttack && !mountainDefense) {
          attackDrm += 1;
          modifiers.modifier_sources.push({
              side: "attacker",
              kind: "drm",
              amount: 1,
              label: "山地部队优势",
          });
      }
      if (mountainTerrain && mountainDefense && !mountainAttack) {
          defenseDrm += 1;
          modifiers.modifier_sources.push({
              side: "defender",
              kind: "drm",
              amount: 1,
              label: "山地部队优势",
          });
      }
      const origins = [...new Set(attackingUnits.map((unit) => unit.location))];
      const crossesRiver = modifiers.crosses_river;
      if (declaration.flank &&
          (defenders.length || !defendingFortPresent) &&
          new Set(attackingUnits.map((unit) => unit.location)).size > 1) {
          const finalDrm = declaration.flank_final;
          let flankDrm = origins.length - finalDrm;
          if (cavalryAttack && !cavalryDefense)
              flankDrm += 1;
          if (api.spaceById[target]?.terrain === "forest" || crossesRiver)
              flankDrm -= 1;
          const flankRoll = api.roll(state);
          const success = flankRoll + flankDrm >= 4;
          if (success)
              attackDrm += finalDrm;
          else
              defenseDrm += 1;
          modifiers.flank = {
              roll: flankRoll,
              drm: flankDrm,
              final_drm: finalDrm,
              success,
          };
      }
      if (attackingUnits.some((unit) => api.connectionRule(unit.location, target, "alpine")))
          modifiers.attack_table = "corps";
      modifiers.attack_drm = attackDrm;
      modifiers.defense_drm = defenseDrm;
      state.combat_modifiers = api.clone(modifiers);
      const attackRawRoll = api.roll(state);
      const defenseRawRoll = api.roll(state);
      const attackRoll = Math.max(1, Math.min(6, attackRawRoll + attackDrm));
      const defenseRoll = Math.max(1, Math.min(6, defenseRawRoll + defenseDrm));
      const defenseTable = modifiers.defense_table ||
          (defendingFortPresent ? "army" : combatTable(state, defendingIds));
      const attackTable = modifiers.attack_table || combatTable(state, attackers);
      const attackStrength = combatStrength(state, attackers);
      const defenseStrength = combatStrength(state, defendingIds) + fortStrength;
      const attackBaseColumn = fireColumn(attackTable, attackStrength);
      const defenseBaseColumn = fireColumn(defenseTable, defenseStrength);
      const attackFinalColumn = fireColumn(attackTable, attackStrength, modifiers.attack_column);
      const defenseFinalColumn = fireColumn(defenseTable, defenseStrength, modifiers.defense_column);
      let attackLoss = defenseStrength > 0
          ? fireResult(defenseTable, defenseStrength, defenseRoll, modifiers.defense_column)
          : 0;
      let defenseLoss = fireResult(attackTable, attackStrength, attackRoll, modifiers.attack_column);
      attackLoss = Math.max(0, attackLoss + modifiers.attack_loss_adjust);
      defenseLoss = Math.max(0, defenseLoss + modifiers.defense_loss_adjust);
      if (declaration.forced_loss_adjust)
          defenseLoss = Math.max(0, defenseLoss + declaration.forced_loss_adjust);
      if (preCombatFortDestruction)
          state.fortifications[target] = Math.max(1, Number(state.fortifications[target]) || 0);
      const firstFire = modifiers.first_fire;
      let deferredFire = null;
      let lossOrder = null;
      if (firstFire === attacker) {
          deferredFire = {
              firing_side: api.other(attacker),
              target_side: attacker,
              firing_ids: defendingIds.slice(),
              roll: defenseRoll,
              table: defenseTable,
              column: modifiers.defense_column,
              loss_adjust: modifiers.attack_loss_adjust,
              resolved: false,
          };
          attackLoss = 0;
          lossOrder = [api.other(attacker), attacker];
      }
      else if (firstFire === api.other(attacker)) {
          deferredFire = {
              firing_side: attacker,
              target_side: api.other(attacker),
              firing_ids: attackers.slice(),
              roll: attackRoll,
              table: attackTable,
              column: modifiers.attack_column,
              loss_adjust: modifiers.defense_loss_adjust +
                  (declaration.forced_loss_adjust || 0),
              resolved: false,
          };
          defenseLoss = 0;
          lossOrder = [attacker, api.other(attacker)];
      }
      state.combat = {
          attacker,
          attackers,
          target,
          defenders: defendingIds,
          attack_raw_roll: attackRawRoll,
          defense_raw_roll: defenseRawRoll,
          attack_roll: attackRoll,
          defense_roll: defenseRoll,
          attack_strength: attackStrength,
          defense_strength: defenseStrength,
          attack_table: attackTable,
          defense_table: defenseTable,
          attack_base_column: attackBaseColumn.value,
          defense_base_column: defenseBaseColumn.value,
          attack_final_column: attackFinalColumn.value,
          defense_final_column: defenseFinalColumn.value,
          attack_loss: attackLoss,
          defense_loss: defenseLoss,
          pending_side: lossOrder ? lossOrder[0] : attacker,
          remaining_loss: lossOrder
              ? lossOrder[0] === attacker
                  ? attackLoss
                  : defenseLoss
              : attackLoss,
          loss_order: lossOrder,
          loss_order_index: 0,
          deferred_fire: deferredFire,
          declaration,
          mo_assignments: api.clone(declaration.mo_assignments || {}),
          mo_marker_origins: api.clone(declaration.mo_marker_origins || {}),
          defense_mo_assignments: api.clone(declaration.defense_mo_assignments || {}),
          mo_advance_recorded: [],
          resolution_events: [],
          modifiers,
          played_cards: (state.combat_window?.cards || []).map((id) => ({
              id,
              faction: state.combat_window?.card_owners?.[id] || api.combatCardOwner(state, id),
              source: state.combat_window?.card_sources?.[id] || "hand",
              canceled: Boolean(state.combat_window?.canceled_cards?.includes(id)),
          })),
          participant_units: api.clone([...attackingUnits, ...defenders]),
          fort: defendingFortPresent
              ? { space: target, strength: fortStrength, loss_factor: fortLossFactor }
              : null,
          same_space_fort: attackingUnits.every((unit) => unit.location === target),
          origins: Object.fromEntries([...attackers, ...defendingIds].map((id) => [
              id,
              state.units.find((unit) => unit.id === id)?.location,
          ])),
          move_attackers: moveAttackers.map((unit) => unit.id),
          attack_mode: attackMode,
          counterattack_resume: api.clone(state.combat_window?.counterattack_resume || null),
      };
      if (attacker === api.CP && target === "paris") {
          state.campaign_flags ||= {};
          state.campaign_flags.paris_attacked = true;
      }
      // Dice have been rolled and the combat result is now public information.
      // Ordinary undo must never cross this information boundary; later
      // post-combat advances create their own, newer snapshots.
      api.clearUndo(state);
      // Mutual rollback must obey the same public-information boundary. A new
      // action-round checkpoint will be created after this combat is complete.
      state.rollback.length = 0;
      for (const [nation, id] of Object.entries(state.combat.mo_assignments)) {
          const definition = api.moDefinition(state, id);
          if (definition &&
              (definition.attack_drm ||
                  definition.attack_column ||
                  definition.attack_table)) {
              api.revealMo(state, id);
              api.log(state, `${nation.toUpperCase()} 强制进攻 [[mo:${id}]] 的战斗修正生效。`);
          }
      }
      for (const key of modifiers.usage_keys || [])
          state.usage_limits[key] = 1;
      if ((declaration.event_effects || []).includes(641))
          delete state.events[api.cardById[641].event];
      if (!deferredFire)
          applyCombatOutcomeEffects(state, state.combat);
      for (const unit of attackingUnits)
          unit.attacked = true;
      for (const nation of new Set(attackingUnits.map((unit) => unit.nation))) {
          const id = declaration.mo_assignments?.[nation] || modifiers.mo_attacks?.[nation];
          if (id) {
              const definition = api.moDefinition(state, id);
              if (nation === "ge" &&
                  state.combat.target === state.markers.killing_ground?.space)
                  api.completeMo(state, nation, id, "killing_ground");
              else if (!definition?.requirement)
                  api.markMoForAttack(state, nation, id, declaration);
              if ((definition?.attack_drm_uses || 0) > 0 ||
                  (definition?.attack_column_uses || 0) > 0) {
                  state.mo.drm_used[nation] ||= {};
                  state.mo.drm_used[nation][id] =
                      (state.mo.drm_used[nation][id] || 0) + 1;
              }
          }
      }
      api.setActiveFaction(state, state.combat.pending_side);
      state.state = "combat_losses";
      state.combat_window = null;
      api.log(state, "");
      api.log(state, `#${state.combat.attacker} 战斗：[[space:${target}]]`);
      api.log(state, "*进攻方：");
      for (const origin of origins) {
          const originAttackers = attackers.filter((id) => state.units.find((unit) => unit.id === id)?.location === origin);
          if (originAttackers.length)
              api.log(state, `>> ${originAttackers.map((id) => `[[unit:${id}]]`).join("、")}（[[space:${origin}]]）`);
      }
      api.log(state, "*防守方：");
      api.log(state, `>> ${defendingIds.map((id) => `[[unit:${id}]]`).join("、") || "要塞"}${fortStrength ? `，要塞 ${fortStrength}` : ""}`);
      for (const line of api.combatModifierLines(modifiers))
          api.log(state, `> ${line.label}${line.kind === "card" ? ` [[card:${line.card}]]` : ` ${line.amount >= 0 ? "+" : ""}${line.amount}`}`);
      api.log(state, `>> 进攻 [[die:${state.combat.attacker}:${attackRawRoll}]]${attackDrm ? `${attackDrm >= 0 ? "+" : ""}${attackDrm}` : ""}=${attackRoll}，${attackTable} ${attackFinalColumn.value}列，造成 ${defenseLoss} 损失。`);
      api.log(state, `>> 防守 [[die:${api.other(state.combat.attacker)}:${defenseRawRoll}]]${defenseDrm ? `${defenseDrm >= 0 ? "+" : ""}${defenseDrm}` : ""}=${defenseRoll}，${defenseTable} ${defenseFinalColumn.value}列，造成 ${attackLoss} 损失。`);
      if (firstFire)
          api.log(state, `> ${firstFire === attacker ? "进攻方" : "防守方"}优先开火；另一方将在先发损失结算后以幸存单位还击。`);
      if (state.combat.remaining_loss === 0)
          advanceCombatLosses(state);
  }

  function validateAttackDeclaration(state, declaration) {
      const attackers = declaration?.attackers || [];
      const target = declaration?.target;
      if (!Array.isArray(attackers) ||
          !attackers.length ||
          new Set(attackers).size !== attackers.length ||
          !api.spaceById[target])
          throw new Error("Invalid attack declaration");
      const attackingUnits = attackers
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(Boolean);
      const combatUnits = attackingUnits.filter(api.isCombatUnit);
      const attackingHqs = attackingUnits.filter((unit) => unit.type === "hq");
      if (attackingUnits.length !== attackers.length ||
          !combatUnits.length ||
          attackingUnits.some((unit) => unit.faction !== state.active || !api.isAttackParticipant(unit)))
          throw new Error("Invalid attackers");
      if (attackingUnits.some((unit) => unit.attacked ||
          (!api.unitIsActivated(state, unit, ["attack"]) &&
              !unit.attack_eligible)))
          throw new Error("Attacker is not attack-activated");
      if (!combatUnits.every((unit) => attacksTarget(state, unit, target)))
          throw new Error("Attacker is not adjacent");
      if (!channelAttackSupported(state, combatUnits, target))
          throw new Error("A Channel attack requires a non-Channel attacking origin");
      if (attackingHqs.some((hq) => !combatUnits.some((unit) => unit.location === hq.location &&
          api.nationalityGroup(unit.nation) === api.nationalityGroup(hq.nation))))
          throw new Error("An attacking HQ requires a matching combat unit");
      if (!multinationalAttackValid(combatUnits, state) &&
          !(declaration.event_effects || []).includes(641)) {
          const mayUseDiaz = !declaration.optional_events_resolved &&
              state.active === api.AP &&
              state.events[api.cardById[641].event] &&
              api.theaterOf(target) === "italian";
          if (!mayUseDiaz)
              throw new Error("A multinational attack requires one origin containing every participating nationality");
      }
      for (const origin of new Set(combatUnits.map((unit) => unit.location))) {
          if (origin !== target &&
              state.besieged.includes(origin) &&
              intactFort(state, origin) &&
              !canBesiege(state, origin, state.active, combatUnits
                  .filter((unit) => unit.location === origin)
                  .map((unit) => unit.id)))
              throw new Error("Attack would leave an enemy fort without a sufficient siege force");
      }
      if (!api.unitsAt(state, target, api.other(state.active)).some(api.isCombatUnit) &&
          !intactFort(state, target))
          throw new Error("No defender");
      if (declaration.flank) {
          const origins = [...new Set(combatUnits.map((unit) => unit.location))];
          const finalDrm = Number(declaration.flank_final);
          const terrain = api.spaceById[target]?.terrain;
          if (origins.length < 2 ||
              state.trenches[target] ||
              intactFort(state, target) ||
              !["clear", "forest"].includes(terrain) ||
              origins.some((origin) => api.connectionRule(origin, target, "alpine")) ||
              !Number.isInteger(finalDrm) ||
              finalDrm < 0 ||
              finalDrm > origins.length)
              throw new Error("Illegal flank attack allocation");
      }
      else if (declaration.flank_final != null) {
          throw new Error("A regular attack cannot allocate flank origins");
      }
      const forcedOrigins = new Set((state.ops?.forced_attacks || []).filter((space) => combatUnits.some((unit) => unit.location === space)));
      for (const origin of forcedOrigins) {
          const required = forcedAttackRequiredIds(state, origin);
          if (required.some((id) => !attackers.includes(id)))
              throw new Error("Every required unit in a forced-attack space must attack");
      }
      return attackingUnits;
  }

  function beginCombat(state, declaration) {
      const attackers = declaration.attackers || [];
      const attackingUnits = validateAttackDeclaration(state, declaration);
      const forcedOrigins = new Set((state.ops?.forced_attacks || []).filter((space) => attackingUnits.some((unit) => unit.location === space)));
      for (const origin of forcedOrigins) {
          const required = forcedAttackRequiredIds(state, origin);
          if (required.some((id) => !attackers.includes(id)))
              throw new Error("Every required unit in a forced-attack space must attack");
      }
      if (forcedOrigins.size && state.ops?.forced_loss_adjust)
          declaration = {
              ...declaration,
              forced_loss_adjust: state.ops.forced_loss_adjust,
          };
      const restoreEffect = api.cardSpecById[628]?.combat;
      const usageKey = `combat_restore:${628}:${state.turn}:${state.action_round}`;
      const remaining = Math.max(0, (restoreEffect?.restore_attackers_before || 0) -
          (state.usage_limits[usageKey] || 0));
      const candidates = attackingUnits
          .filter(api.isCombatUnit)
          .filter((unit) => unit.reduced)
          .map((unit) => unit.id);
      if (state.active === api.AP &&
          state.events[api.cardById[628].event] &&
          remaining &&
          candidates.length) {
          state.pending_event = {
              kind: "precombat_restore",
              card: 628,
              owner: state.active,
              declaration: api.clone(declaration),
              candidates,
              remaining,
              usage_key: usageKey,
          };
          api.enterEventFlow(state);
          return;
      }
      api.openCombatCardWindow(state, declaration);
  }

  function advanceCombatLosses(state) {
      const combat = state.combat;
      if (!combat)
          return;
      if (combat.loss_order) {
          if (combat.loss_order_index === 0) {
              resolveDeferredFire(state, combat);
              combat.loss_order_index = 1;
              combat.pending_side = combat.loss_order[1];
              combat.remaining_loss =
                  combat.pending_side === combat.attacker
                      ? combat.attack_loss
                      : combat.defense_loss;
              if (combat.remaining_loss > 0) {
                  api.setActiveFaction(state, combat.pending_side);
                  return;
              }
          }
          finishCombatLosses(state);
          return;
      }
      if (combat.pending_side === combat.attacker) {
          combat.pending_side = api.other(combat.attacker);
          combat.remaining_loss = combat.defense_loss;
          if (combat.remaining_loss > 0) {
              api.setActiveFaction(state, combat.pending_side);
              return;
          }
      }
      finishCombatLosses(state);
  }

  function applyPostCombatRules(state, combat) {
      if (combat.post_rules_applied)
          return false;
      combat.post_rules_applied = true;
      const desertion = api.activeRule(state, "desertion");
      const italianAttack = combat.attackers.some((id) => {
          const unit = state.units.find((candidate) => candidate.id === id);
          return api.isCombatUnit(unit) && unit.nation === "it";
      });
      if (desertion && italianAttack) {
          const origins = [...new Set(combat.attackers
              .map((id) => combat.origins?.[id])
              .filter(Boolean))];
          const candidates = state.units.filter((unit) =>
              api.isCombatUnit(unit) && unit.nation === "it" &&
              origins.includes(unit.location)).map((unit) => unit.id);
          if (candidates.length) {
              state.pending_event = {
                  kind: "desertion_combat_loss",
                  card: 756,
                  owner: combat.attacker,
                  chooser: combat.attacker,
                  candidates,
                  origins,
                  remaining: desertion.italian_attack_step_loss,
                  resume: "finish_combat_sequence",
              };
              api.setActiveFaction(state, combat.attacker);
              api.enterEventFlow(state);
              return true;
          }
      }
      return false;
  }

  function combatRepairResolutionEvent(state, id, kinds = null) {
      const allowed = kinds ? new Set(kinds) : null;
      return [...(state.combat?.resolution_events || [])]
          .reverse()
          .find((entry) => entry.unit === id && (!allowed || allowed.has(entry.kind))) || null;
  }

  function combatRepairOrigin(state, id) {
      const event = combatRepairResolutionEvent(state, id, ["eliminate", "replace", "reduce"]);
      const participant = (state.combat?.participant_units || [])
          .find((unit) => unit.id === id);
      return event?.space || state.combat?.origins?.[id] ||
          participant?.location || state.combat?.target || null;
  }

  function combatRepairToken(state, id, pending = null, allowAnyPermanent = false) {
      const token = api.eventToken(state, id);
      if (token)
          return token;
      const entry = (state.permanently_removed_units || [])
          .find((unit) => unit.id === id);
      if (!entry)
          return null;
      if (allowAnyPermanent)
          return { zone: "permanent", entry, piece: api.pieceById[entry.piece] };
      if (Number(pending?.card) !== 714)
          return null;
      const eliminatedHere = combatRepairResolutionEvent(state, id, ["eliminate"]);
      if (!eliminatedHere || !api.permanentOnElimination(entry) ||
          !api.acceptsReplacementPoints(entry))
          return null;
      return { zone: "permanent", entry, piece: api.pieceById[entry.piece] };
  }

  function combatRepairReplacementToken(state, armyId) {
      const event = [...(state.combat?.resolution_events || [])]
          .reverse()
          .find((entry) => entry.kind === "replace" && entry.unit === armyId);
      if (!event)
          return null;
      return combatRepairToken(state, event.replacement, null, true);
  }

  function combatRepairCandidates(state, pending) {
      const combat = state.combat;
      if (!combat)
          return [];
      return pending.units.filter((id) => {
          const token = combatRepairToken(state, id, pending);
          if (!token)
              return false;
          if (!api.isCombatUnit(token.entry) ||
              (pending.owner && token.entry.faction !== pending.owner))
              return false;
          if (!api.acceptsReplacementPoints(token.entry))
              return false;
          if (pending.nation && token.piece?.nation !== pending.nation)
              return false;
          if (combatRepairCost(pending, token.entry) > pending.remaining + 1e-9)
              return false;
          if (token.zone === "map")
              return token.entry.reduced;
          if (!token.zone.endsWith("_eliminated") && token.zone !== "permanent")
              return false;
          const origin = combatRepairOrigin(state, id);
          if (!origin)
              return false;
          if (api.stackLegal(state, origin, token.entry))
              return true;
          const replacement = combatRepairReplacementToken(state, id);
          if (!replacement || replacement.zone !== "map" ||
              replacement.entry.location !== origin)
              return false;
          const field = api.unitsAt(state, origin, token.entry.faction)
              .filter(api.isCombatUnit).length;
          return Boolean(api.spaceById[origin]?.large_area || field <= 3);
      });
  }

  function combatRepairCost(pending, unit) {
      if (!pending?.uses_rp_cost)
          return 1;
      return api.unitRepairCost(unit);
  }

  function combatRepairReplacement(state, armyId) {
      return combatRepairReplacementToken(state, armyId)?.entry || null;
  }

  function combatRepairPending(state, cardId, amount, resume = "combat") {
      const combat = state.combat;
      const card = api.cardById[cardId];
      const effect = api.effectiveCombatEffect(state, cardId);
      if (!combat || !card || !effect)
          return null;
      const participants = effect.repair_attackers_only
          ? combat.attackers
          : [...combat.attackers, ...combat.defenders];
      const units = [...new Set(participants)];
      return {
          kind: "combat_repair",
          card: cardId,
          owner: card.faction,
          units,
          remaining: amount,
          resume,
          attackers_only: Boolean(effect.repair_attackers_only),
          replacement_corps: Boolean(effect.repair_replacement_corps),
          uses_rp_cost: Boolean(effect.repair_uses_rp_cost),
          replacement_choice: null,
      };
  }

  function combatRepairAvailable(state, cardId, amount) {
      const pending = combatRepairPending(state, cardId, amount);
      return Boolean(pending && combatRepairCandidates(state, pending).length);
  }

  function beginCombatRepair(state, cardId, amount, resume = "combat") {
      const pending = combatRepairPending(state, cardId, amount, resume);
      if (!pending || !combatRepairCandidates(state, pending).length)
          return false;
      state.pending_event = pending;
      api.setActiveFaction(state, pending.owner);
      api.enterEventFlow(state);
      return true;
  }

  function repairCombatUnit(state, pending, id) {
      const token = combatRepairToken(state, id, pending);
      if (!token || !combatRepairCandidates(state, pending).includes(id))
          throw new Error("Illegal combat repair");
      if (token.zone === "map") {
          token.entry.reduced = false;
          pending.remaining = Math.max(0,
              pending.remaining - combatRepairCost(pending, token.entry));
          return;
      }
      const replacement = pending.replacement_corps
          ? combatRepairReplacementToken(state, id)
          : null;
      const origin = combatRepairOrigin(state, id);
      const canKeep = api.stackLegal(state, origin, token.entry);
      if (replacement?.zone === "map" && canKeep) {
          pending.replacement_choice = {
              army: id,
              replacement: replacement.entry.id,
              origin,
          };
          return;
      }
      if (!canKeep && (!replacement || replacement.zone !== "map" ||
          replacement.entry.location !== origin))
          throw new Error("Rebuilt army would exceed stacking limits");
      if (replacement)
          returnCombatReplacementToReserve(state, replacement.entry.id);
      rebuildCombatUnit(state, pending, id);
  }

  function rebuildCombatUnit(state, pending, id) {
      const token = combatRepairToken(state, id, pending);
      if (!token || (!token.zone.endsWith("_eliminated") && token.zone !== "permanent"))
          throw new Error("Combat unit is no longer eliminated");
      const pool = token.zone === "permanent"
          ? state.permanently_removed_units
          : state.eliminated[token.entry.faction];
      const index = pool.findIndex((unit) => unit.id === id);
      if (index < 0)
          throw new Error("Combat unit repair pool changed");
      pool.splice(index, 1);
      api.hydrateUnit(token.entry);
      token.entry.location = combatRepairOrigin(state, id);
      token.entry.reduced = true;
      const participant = (state.combat.participant_units || [])
          .find((unit) => unit.id === id);
      token.entry.moved = Boolean(participant?.moved);
      token.entry.attacked = token.entry.faction === state.combat.attacker ||
          Boolean(participant?.attacked);
      state.units.push(token.entry);
      const side = token.entry.faction === state.combat.attacker
          ? state.combat.attackers
          : state.combat.defenders;
      if (!side.includes(id))
          side.push(id);
      pending.remaining = Math.max(0,
          pending.remaining - combatRepairCost(pending, token.entry));
      api.log(state, `${api.pieceById[token.entry.piece]?.name || id}在${api.spaceById[token.entry.location]?.name || token.entry.location}重建。`);
  }

  function returnCombatReplacementToReserve(state, id) {
      const token = combatRepairToken(state, id, null, true);
      if (!token)
          throw new Error("Replacement corps is no longer available");
      const unit = token.entry;
      if (token.zone === "map")
          state.units.splice(state.units.findIndex((candidate) => candidate.id === id), 1);
      else if (token.zone.endsWith("_eliminated")) {
          const pool = state.eliminated[unit.faction];
          pool.splice(pool.findIndex((candidate) => candidate.id === id), 1);
      }
      else if (token.zone === "permanent")
          state.permanently_removed_units.splice(
              state.permanently_removed_units.findIndex((candidate) => candidate.id === id), 1);
      else if (token.zone.endsWith("_reserve"))
          return;
      else
          throw new Error("Replacement corps is in an invalid zone");
      api.normalizeOffMapUnit(unit);
      if (!state.reserves[unit.faction].some((candidate) => candidate.id === id))
          state.reserves[unit.faction].push(unit);
      state.combat.attackers = state.combat.attackers.filter((unitId) => unitId !== id);
      state.combat.defenders = state.combat.defenders.filter((unitId) => unitId !== id);
      api.log(state, `${api.pieceById[unit.piece]?.name || id}返回预备区（${unit.reduced ? "减员" : "满员"}）。`);
  }

  function resolveCombatRepairReplacement(state, choice) {
      const pending = state.pending_event;
      const replacement = pending?.replacement_choice;
      if (pending?.kind !== "combat_repair" || !replacement ||
          !["keep", "return"].includes(choice))
          throw new Error("Invalid replacement-corps decision");
      if (choice === "return")
          returnCombatReplacementToReserve(state, replacement.replacement);
      rebuildCombatUnit(state, pending, replacement.army);
      pending.replacement_choice = null;
      if (!pending.remaining || !combatRepairCandidates(state, pending).length)
          resumeAfterCombatRepair(state, pending);
  }

  function resumeAfterCombatRepair(state, pending) {
      state.pending_event = null;
      if (pending.resume === "post_window") {
          state.state = "post_combat_card_window";
          api.setActiveFaction(state, state.post_combat_window.side);
          return;
      }
      state.state = "combat_losses";
      finishCombatLosses(state);
  }

  function nivelleMarkerCandidates(state) {
      const nivelleEffect = api.cardSpecById[739]?.combat || {};
      return api.data.spaces
          .filter((space) => api.unitsAt(state, space.id, api.AP).some((unit) => unit.nation === "fr" && unit.type === "army"))
          .filter((space) => {
          const commandSpaces = new Set([space.id, ...api.landNeighbors(space.id)]);
          return !state.units.some((unit) => unit.faction === api.AP &&
              unit.type === "hq" &&
              (!nivelleEffect.excluded_hq_piece ||
                  unit.piece === nivelleEffect.excluded_hq_piece) &&
              commandSpaces.has(unit.location));
      })
          .filter((space) => api.neighborsFor(space.id, "attack", api.AP).some((target) => api.unitsAt(state, target, api.CP).length || api.spaceById[target]?.fort))
          .map((space) => space.id);
  }

  function hqRelocationSpaces(state, hq) {
      return api.supplySources(state, hq.faction, hq.nation).filter((space) => api.spaceCanActivate(state, space) && api.stackLegal(state, space, hq));
  }

  function beginCombatHqRelocation(state, combat, resume = null) {
      if (combat.hq_relocation_complete)
          return false;
      const affected = new Set([
          combat.target,
          ...Object.values(combat.origins || {}),
      ]);
      const queue = api.orphanHqs(state)
          .filter((hq) => affected.has(hq.location))
          .map((hq) => hq.id);
      if (!queue.length) {
          combat.hq_relocation_complete = true;
          return false;
      }
      const first = state.units.find((unit) => unit.id === queue[0]);
      state.pending_event = {
          kind: "hq_relocation",
          owner: first.faction,
          queue,
          index: 0,
          resume,
      };
      api.setActiveFaction(state, first.faction);
      api.enterEventFlow(state);
      return true;
  }

  function currentPendingHq(state, pending) {
      return state.units.find((unit) => unit.id === pending.queue[pending.index]);
  }

  function advanceCombatHqRelocation(state, pending) {
      pending.index += 1;
      while (pending.index < pending.queue.length &&
          !currentPendingHq(state, pending))
          pending.index += 1;
      if (pending.index < pending.queue.length) {
          const hq = currentPendingHq(state, pending);
          pending.owner = hq.faction;
          api.setActiveFaction(state, hq.faction);
          return;
      }
      state.pending_event = null;
      if (pending.resume === "finish_delayed_event") {
          const card = api.cardById[pending.resume_card];
          if (!card)
              throw new Error("Delayed event HQ relocation lost its source card");
          api.finishEvent(state, card);
          return;
      }
      state.combat.hq_relocation_complete = true;
      api.setActiveFaction(state, state.combat.attacker);
      if (pending.resume === "post_retreat_advance")
          beginPostRetreatAdvance(state);
      else
          finishCombatSequence(state);
  }

  function relocateCombatHq(state, pending, space) {
      const hq = currentPendingHq(state, pending);
      if (!hq || !hqRelocationSpaces(state, hq).includes(space))
          throw new Error("Illegal HQ relocation");
      hq.location = space;
      hq.moved = true;
      advanceCombatHqRelocation(state, pending);
  }

  function sendCombatHqToTurnTrack(state, pending) {
      const hq = currentPendingHq(state, pending);
      if (!hq)
          throw new Error("HQ is no longer on the map");
      const index = state.units.findIndex((unit) => unit.id === hq.id);
      state.units.splice(index, 1);
      delete hq.location;
      hq.moved = false;
      hq.attacked = false;
      hq.due_turn = state.turn;
      state.hq_turn_track[hq.faction].push(hq);
      advanceCombatHqRelocation(state, pending);
  }

  function finishCombatSequence(state) {
      const combat = state.combat;
      if (combat && beginCombatHqRelocation(state, combat))
          return;
      if (combat && applyPostCombatRules(state, combat))
          return;
      if (combat?.target && state.fortifications[combat.target]) {
          state.fortifications[combat.target] -= 1;
          if (state.fortifications[combat.target] <= 0)
              delete state.fortifications[combat.target];
      }
      if (combat?.modifiers?.fortification_after === "participants" &&
          !combat.post_combat_fortifications_applied) {
          combat.post_combat_fortifications_applied = true;
          const locations = new Set([...combat.attackers, ...combat.defenders]
              .map((id) => state.units.find((unit) => unit.id === id))
              .filter((unit) => unit && api.isCombatUnit(unit) && unit.location)
              .map((unit) => unit.location));
          for (const location of locations)
              state.fortifications[location] = Math.min(6, (state.fortifications[location] || 0) + 1);
          if (locations.size)
              api.log(state, `伊普尔阻击：${[...locations].map(api.spaceName).join("、")} 防御工事 +1。`);
      }
      const nivelle = combat?.modifiers?.cards?.find((entry) => entry.effect.forced_french_attacks_after);
      const miracleResume = api.clone(combat?.counterattack_resume || null);
      const moCounterattack = combat?.mo_counterattack;
      const counterattackUnits = (moCounterattack?.units || []).filter((id) => state.units.some((unit) => unit.id === id && unit.location === moCounterattack.origin));
      const counterattackTargets = api.neighborsFor(moCounterattack?.origin, "attack", api.AP).filter((space) => api.unitsAt(state, space, api.CP).length || api.spaceById[space]?.fort);
      const counterattackResume = moCounterattack && counterattackUnits.length && counterattackTargets.length
          ? {
              active: combat.attacker,
              ops: api.clone(state.ops),
              activations: api.clone(state.activations),
          }
          : null;
      if (combat)
          api.setActiveFaction(state, combat.attacker);
      api.log(state, "");
      state.pending_retreat = null;
      state.combat = null;
      state.post_combat_window = null;
      api.clearCombatEvents(state);
      if (miracleResume) {
          api.setActiveFaction(state, miracleResume.active);
          state.ops = miracleResume.ops;
          state.activations = miracleResume.activations || {};
          if (!state.ops) {
              state.state = "action_card";
              return;
          }
          if (state.ops.execution_phase === "attack") {
              api.prepareOpsAttackSelection(state);
              state.state = "ops_attack";
          }
          else if (state.ops.execution_phase === "move")
              state.state = "ops_move";
          else if (state.ops.execution_phase === "construct")
              state.state = "ops_construct";
          else
              state.state = "ops_activate";
          return;
      }
      if (nivelle) {
          const candidates = nivelleMarkerCandidates(state);
          const required = Math.min(nivelle.effect.forced_french_attacks_after, candidates.length);
          if (required) {
              state.pending_event = {
                  kind: "nivelle_attacks",
                  card: nivelle.id,
                  owner: api.CP,
                  chooser: api.CP,
                  candidates,
                  spaces: [],
                  required,
                  loss_adjust: nivelle.effect.forced_attack_loss_adjust || 0,
              };
              api.setActiveFaction(state, api.CP);
              api.enterEventFlow(state);
              return;
          }
      }
      if (counterattackResume) {
          state.pending_event = {
              kind: "mo_counterattack",
              card: 650,
              owner: api.AP,
              chooser: api.AP,
              origin: moCounterattack.origin,
              units: counterattackUnits,
              targets: counterattackTargets,
              resume: counterattackResume,
          };
          api.setActiveFaction(state, api.AP);
          api.enterEventFlow(state);
          return;
      }
      if (state.ops?.forced_attacks?.length) {
          state.ops.forced_attacks = (state.ops.forced_attacks || []).filter((origin) => {
              const required = forcedAttackRequiredIds(state, origin);
              const attackers = required
                  .map((id) => state.units.find((unit) => unit.id === id))
                  .filter((unit) => unit &&
                  unit.location === origin &&
                  unit.faction === state.active &&
                  api.isCombatUnit(unit));
              const targets = [origin, ...api.neighborsFor(origin, "attack", state.active)];
              const hasTarget = targets.some((target) => attackers.every((unit) => attacksTarget(state, unit, target)) &&
                  (api.unitsAt(state, target, api.other(state.active)).some(api.isCombatUnit) ||
                      (intactFort(state, target) &&
                          api.spaceById[target]?.faction !== state.active)));
              if (!attackers.length || !hasTarget)
                  api.log(state, `${api.spaceById[origin]?.name || origin} 的强制进攻已无合法目标，移除标记。`);
              return Boolean(attackers.length && hasTarget);
          });
      }
      if (state.ops?.execution_phase === "attack") {
          api.prepareOpsAttackSelection(state);
          state.state = "ops_attack";
      }
      else
          state.state = "ops_activate";
  }

  function resolveFortCombatLoss(state, combat) {
      if (combat.fort_loss_resolved)
          return;
      combat.fort_loss_resolved = true;
      if (!combat.fort || !intactFort(state, combat.target))
          return;
      const survivingDefenders = combat.defenders.filter((id) => state.units.some((unit) => unit.id === id));
      if (survivingDefenders.length ||
          combat.remaining_loss < combat.fort.loss_factor)
          return;
      combat.remaining_loss -= combat.fort.loss_factor;
      combat.fort_destroyed = destroyFort(state, combat.target, "fort destroyed in combat");
  }

  function potentialAdvanceUnitIds(state, combat, rules) {
      if (rules.prohibit_advance.includes("both") ||
          rules.prohibit_advance.includes(combat.attacker) ||
          rules.cancel_advance.includes(combat.attacker) ||
          (rules.advance_limit != null && Number(rules.advance_limit) === 0))
          return [];
      if (!api.canOccupyByEarlyWarDepth(state, combat.attacker, combat.target))
          return [];
      const movedAttackers = new Set(combat.move_attackers || []);
      const candidates = combat.attackers
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter((unit) => unit &&
              api.isCombatUnit(unit) &&
              !movedAttackers.has(unit.id) &&
              (rules.damaged_advance || !unit.reduced) &&
              api.connectionAllows(unit.location, combat.target, "advance", combat.attacker) &&
              api.spaceCanActivate(state, combat.target));
      const targetUnits = api.unitsAt(state, combat.target, combat.attacker).filter(api.isCombatUnit);
      const stackSlots = api.spaceById[combat.target]?.large_area
          ? Infinity
          : Math.max(0, 3 - targetUnits.length);
      const maximum = rules.advance_limit == null
          ? stackSlots
          : Math.min(stackSlots, Number(rules.advance_limit));
      if (maximum <= 0)
          return [];
      const fortLossFactor = intactFort(state, combat.target);
      const mustBesiege = fortLossFactor &&
          api.spaceById[combat.target]?.faction === api.other(combat.attacker) &&
          !state.besieged.includes(combat.target);
      const byOrigin = new Map();
      for (const unit of candidates) {
          if (!byOrigin.has(unit.location)) byOrigin.set(unit.location, []);
          byOrigin.get(unit.location).push(unit);
      }
      const result = [];
      for (const units of byOrigin.values()) {
          if (mustBesiege) {
              const hasArmy = units.some((unit) => unit.type === "army");
              const corps = units.filter((unit) => unit.type === "corps").length;
              if (!hasArmy && (corps < fortLossFactor || maximum < fortLossFactor))
                  continue;
          }
          result.push(...units);
      }
      const eligibleOrigins = new Map();
      for (const unit of result) {
          const group = api.nationalityGroup(unit.nation);
          if (!eligibleOrigins.has(unit.location)) eligibleOrigins.set(unit.location, new Set());
          eligibleOrigins.get(unit.location).add(group);
      }
      const hqs = combat.attackers
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter((unit) => unit?.type === "hq" &&
              unit.faction === combat.attacker &&
              api.connectionAllows(unit.location, combat.target, "advance", combat.attacker) &&
              eligibleOrigins.get(unit.location)?.has(api.nationalityGroup(unit.nation)));
      return [...result, ...hqs].map((unit) => unit.id);
  }

  function finishCombatLosses(state) {
      const combat = state.combat;
      resolveFortCombatLoss(state, combat);
      if (!combat.action_repair_complete) {
          combat.action_repair_complete = true;
          const repair = combat.modifiers.cards.find((entry) => entry.effect.repair_after);
          if (repair &&
              beginCombatRepair(state, repair.id, repair.effect.repair_after))
              return;
      }
      if (!combat.card_dispositions_complete) {
          if (api.prepareCombatCardDispositions(state, combat))
              return;
          combat.card_dispositions_complete = true;
      }
      if (!combat.post_combat_complete) {
          if (api.startPostCombatWindow(state))
              return;
          combat.post_combat_complete = true;
      }
      const defenderFaction = api.other(combat.attacker);
      const defenders = api.unitsAt(state, combat.target, defenderFaction).filter(api.isCombatUnit);
      const defendingHqs = api.unitsAt(state, combat.target, defenderFaction)
          .filter((unit) => unit.type === "hq");
      const retreaters = [...defenders, ...defendingHqs];
      api.setActiveFaction(state, combat.attacker);
      const rules = combat.modifiers || {};
      const potentialAdvanceUnits = potentialAdvanceUnitIds(state, combat, rules);
      const attackMode = combat.attack_mode ||
          attackModeForDeclaration(state, combat.declaration, combat.participant_units);
      combat.attack_mode = attackMode;
      // A force already fighting inside a besieged fort has nowhere to
      // advance.  An adjacent attacker that eliminates the field defenders,
      // however, may advance into an intact fort when the selected group can
      // establish a legal siege.  potentialAdvanceUnitIds() already enforces
      // that siege-strength requirement.
      if (combat.same_space_fort) {
          finishCombatSequence(state);
          return;
      }
      if (!defenders.length && potentialAdvanceUnits.length) {
          state.pending_retreat = {
              from: combat.attackers
                  .map((id) => state.units.find((unit) => unit.id === id)?.location)
                  .filter(Boolean),
              target: combat.target,
              units: potentialAdvanceUnits,
              maximum: rules.advance_limit,
              advanced: 0,
              advanced_ids: [],
              selected_advance_units: [],
              advance_mode: "vacant",
              advance_max_steps: 1,
              retreat_paths: [],
          };
          // Eliminating the last combat unit can leave a defending HQ alone
          // in the battle space.  The HQ must relocate before the attackers
          // enter, but the relocation is only an interruption of the already
          // established advance.  Resuming through finishCombatSequence()
          // used to discard this pending advance entirely.
          if (beginCombatHqRelocation(state, combat, "post_retreat_advance"))
              return;
          state.state = "advance_select";
      }
      else if (retreaters.length && attackMode === "movement") {
          state.pending_retreat = {
              faction: defenderFaction,
              mode: "movement_optional",
              selected_unit: null,
              declined_units: [],
              units: retreaters.map((unit) => unit.id),
              steps: 1,
              choices: null,
              from: combat.target,
              remaining: Object.fromEntries(retreaters.map((unit) => [unit.id, 1])),
              paths: Object.fromEntries(retreaters.map((unit) => [unit.id, [combat.target]])),
              advance_units: [],
              advanced_ids: [],
              maximum: 0,
              advanced: 0,
              retreat_paths: [],
              advance_max_steps: 1,
              can_cancel_with_loss: false,
              prohibit_damaged_cancel: true,
          };
          api.setActiveFaction(state, defenderFaction);
          state.state = "retreat";
      }
      else if (defenders.length &&
          potentialAdvanceUnits.length &&
          (combat.defense_loss > combat.attack_loss || rules.minimum_retreat > 0) &&
          !rules.cancel_retreat.includes(api.other(combat.attacker))) {
          const margin = combat.defense_loss - combat.attack_loss;
          const marginProhibition = rules.cards.some((entry) => entry.effect.prohibit_damaged_retreat_cancel_if_margin &&
              margin >= entry.effect.prohibit_damaged_retreat_cancel_if_margin);
          const retreatSteps = Math.min(2, Math.max(rules.minimum_retreat || 0, 1, margin));
          state.pending_retreat = {
              faction: defenders[0].faction,
              mode: "mandatory",
              selected_unit: null,
              declined_units: [],
              units: retreaters.map((unit) => unit.id),
              steps: rules.retreat_choice ? null : retreatSteps,
              choices: rules.retreat_choice ? rules.retreat_choice.slice() : null,
              from: combat.target,
              remaining: Object.fromEntries(retreaters.map((unit) => [
                  unit.id,
                  rules.retreat_choice ? null : retreatSteps,
              ])),
              paths: Object.fromEntries(retreaters.map((unit) => [unit.id, [combat.target]])),
              advance_units: potentialAdvanceUnits,
              advanced_ids: [],
              maximum: rules.advance_limit,
              advanced: 0,
              retreat_paths: [],
              advance_max_steps: retreatSteps,
              can_cancel_with_loss: (["forest", "mountain", "swamp"].includes(api.spaceById[combat.target]?.terrain) ||
                  ((state.trenches[combat.target] || 0) > 0 && !rules.ignore_trench)),
              prohibit_damaged_cancel: Boolean(rules.prohibit_damaged_retreat_cancel) || marginProhibition,
          };
          api.setActiveFaction(state, defenders[0].faction);
          state.state = state.pending_retreat.can_cancel_with_loss &&
              retreaters.some((unit) => canCancelRetreatWithUnit(state, unit.id))
              ? "retreat_cancel"
              : "retreat";
      }
      else {
          finishCombatSequence(state);
      }
  }

  function retreatFinalStackLegal(state, space, units) {
      if (api.spaceById[space]?.large_area)
          return retreatEndpointHqsLegal(state, space, units);
      const selected = new Set(units.map((unit) => unit.id));
      const existing = api.unitsAt(state, space, units[0]?.faction).filter((unit) => !selected.has(unit.id));
      return ([...existing, ...units].filter(api.isCombatUnit).length <= 3 &&
          [...existing, ...units].filter((unit) => unit.type === "hq").length <= 1 &&
          retreatEndpointHqsLegal(state, space, units));
  }

  function retreatEndpointHqsLegal(state, space, units) {
      if (!units.some((unit) => unit.type === "hq"))
          return true;
      const locations = units.map((unit) => unit.location);
      try {
          for (const unit of units)
              unit.location = space;
          const hqs = api.unitsAt(state, space, units[0]?.faction)
              .filter((unit) => unit.type === "hq");
          return hqs.length <= 1 && hqs.every((hq) =>
              api.hqEndLegal(state, hq, space) ||
              pendingRetreatEscortCanReach(state, hq, space));
      }
      finally {
          units.forEach((unit, index) => {
              unit.location = locations[index];
          });
      }
  }

  function pendingRetreatUnitDistances(pending, id) {
      if (pending.remaining?.[id] != null)
          return [Number(pending.remaining[id])];
      return (pending.choices || [Number(pending.steps || 1)])
          .map(Number)
          .filter((distance) => Number.isInteger(distance) && distance > 0);
  }

  function pendingRetreatEscortCanReach(state, hq, space, excludedId = null) {
      const pending = state.pending_retreat;
      if (!pending)
          return false;
      return (pending.units || []).some((id) => {
          if (id === hq.id || id === excludedId)
              return false;
          const escort = state.units.find((unit) => unit.id === id);
          if (!escort || !api.isCombatUnit(escort) ||
              api.nationalityGroup(escort.nation) !== api.nationalityGroup(hq.nation))
              return false;
          const path = (pending.paths?.[id] || [escort.location]).slice();
          return pendingRetreatUnitDistances(pending, id).some((steps) =>
              retreatUnitRoutes(state, id, steps, path, { ignoreWaitingHqs: true })
                  .some((route) => route.at(-1) === space));
      });
  }

  function waitingRetreatHqsResolvable(state, movingUnit, destination) {
      const pending = state.pending_retreat;
      const waiting = pending?.waiting_hqs || [];
      if (!waiting.length || !api.isCombatUnit(movingUnit))
          return true;
      const origin = movingUnit.location;
      try {
          movingUnit.location = destination;
          return waiting.every((id) => {
              const hq = state.units.find((unit) => unit.id === id);
              return !hq || api.hqEndLegal(state, hq, hq.location) ||
                  pendingRetreatEscortCanReach(state, hq, hq.location, movingUnit.id);
          });
      }
      finally {
          movingUnit.location = origin;
      }
  }

  function retreatBaseDestinations(state, units, space, visited, _finalStep) {
      if (!units.length)
          return [];
      const faction = units[0].faction;
      let options = api.neighborsFor(space, "retreat", faction).filter((destination) => !visited.has(destination) &&
          api.spaceCanActivate(state, destination) &&
          !api.unitsAt(state, destination, api.other(faction)).length &&
          !(intactFort(state, destination) &&
              api.spaceById[destination]?.faction === api.other(faction) &&
              !state.besieged.includes(destination)));
      // POG 12.4.5: use a friendly controlled retreat space when one exists.
      const friendly = options.filter((destination) => state.control[destination] === faction ||
          state.besieged.includes(destination));
      if (friendly.length)
          options = friendly;
      // POG also prefers a supplied destination when the group has one available.
      const suppliedByNation = new Map();
      const supplied = options.filter((destination) => units.every((unit) => {
          if (!suppliedByNation.has(unit.nation))
              suppliedByNation.set(unit.nation, api.suppliedSpaces(state, faction, unit.nation));
          return suppliedByNation.get(unit.nation).has(destination);
      }));
      if (supplied.length)
          options = supplied;
      if (_finalStep)
          options = options.filter((destination) =>
              retreatEndpointHqsLegal(state, destination, units));
      return options;
  }

  function retreatUnitRoutes(state, id, steps, path = null, options = {}) {
      const unit = state.units.find((candidate) => candidate.id === id);
      if (!unit || steps <= 0)
          return [];
      const route = path || [unit.location];
      const search = (space, remaining, visited) => {
          if (remaining === 0) {
              if (!options.ignoreWaitingHqs &&
                  !waitingRetreatHqsResolvable(state, unit, space))
                  return [];
              return [route.slice()];
          }
          const routes = [];
          for (const destination of retreatBaseDestinations(state, [unit], space, visited, remaining === 1)) {
              const nextVisited = new Set(visited);
              nextVisited.add(destination);
              route.push(destination);
              routes.push(...search(destination, remaining - 1, nextVisited));
              route.pop();
          }
          return routes;
      };
      return search(route.at(-1), steps, new Set(route));
  }

  function retreatDestinations(state, unit) {
      if (!unit)
          return [];
      const pending = state.pending_retreat;
      const path = (pending?.paths?.[unit.id] || [unit.location]).slice();
      const steps = Number(pending?.remaining?.[unit.id]);
      if (!pending?.units?.includes(unit.id) || !Number.isInteger(steps) || steps <= 0)
          return [];
      return [
          ...new Set(retreatUnitRoutes(state, unit.id, steps, path).map((route) => route[path.length])),
      ].filter(Boolean);
  }

  function retreatUnitHasRoute(state, id, steps) {
      const unit = state.units.find((candidate) => candidate.id === id);
      if (!unit || !state.pending_retreat?.units?.includes(id)) return false;
      const path = (state.pending_retreat.paths?.[id] || [unit.location]).slice();
      return retreatUnitRoutes(state, id, Number(steps), path).length > 0;
  }

  function deferUnroutableRetreatHqs(state) {
      const pending = state.pending_retreat;
      if (state.state !== "retreat" || !pending || pending.mode !== "mandatory" || pending.selected_unit)
          return false;
      if ((pending.units || []).some((id) => {
          const unit = state.units.find((candidate) => candidate.id === id);
          return unit && api.isCombatUnit(unit);
      }))
          return false;
      const deferred = [];
      for (const id of pending.units || []) {
          const unit = state.units.find((candidate) => candidate.id === id);
          if (unit?.type !== "hq")
              continue;
          const distances = pending.remaining?.[id] != null
              ? [Number(pending.remaining[id])]
              : (pending.choices || [Number(pending.steps || 1)]);
          if (!distances.some((steps) => retreatUnitHasRoute(state, id, steps)))
              deferred.push(id);
      }
      if (!deferred.length)
          return false;
      pending.deferred_hqs ||= [];
      for (const id of deferred)
          if (!pending.deferred_hqs.includes(id)) pending.deferred_hqs.push(id);
      pending.units = pending.units.filter((id) => !deferred.includes(id));
      if (deferred.includes(pending.selected_unit)) pending.selected_unit = null;
      if (!pending.units.length)
          finishAllRetreats(state);
      return true;
  }

  function canCancelRetreatWithUnit(state, id) {
      const pending = state.pending_retreat;
      const unit = state.units.find((candidate) => candidate.id === id);
      if (!pending?.can_cancel_with_loss || !retreatCancellationTerrainAllowed(state, pending) ||
          !pending.units?.includes(id) || !unit || !api.isCombatUnit(unit))
          return false;
      if (pending.prohibit_damaged_cancel && unit.reduced)
          return false;
      if (!unit.reduced)
          return true;
      if (unit.type === "army" &&
          (unit.supplied || unit.limited_supply || unit.fort_limited_supply) &&
          api.combatReplacementOptions(state, unit).length > 0)
          return true;
      const space = pending.from || state.combat?.target;
      return api.unitsAt(state, space, pending.faction)
          .filter((candidate) => api.isCombatUnit(candidate) && candidate.id !== id)
          .length > 0;
  }

  function retreatCancellationTerrainAllowed(state, pending = state.pending_retreat) {
      if (!pending || pending.mode !== "mandatory")
          return false;
      const space = pending.from || state.combat?.target;
      const terrain = api.spaceById[space]?.terrain;
      if (["forest", "mountain", "swamp"].includes(terrain))
          return true;
      return Number(state.trenches?.[space] || 0) > 0 &&
          !state.combat?.modifiers?.ignore_trench;
  }

  function retreatSpaceOverstacked(state, space, faction) {
      if (!space || api.spaceById[space]?.large_area)
          return false;
      return api.unitsAt(state, space, faction).filter(api.isCombatUnit).length > 3;
  }

  function retreatOverstackLossCandidates(state, pending = state.pending_retreat) {
      const space = pending?.overstack?.space;
      if (!space)
          return [];
      const group = new Set(pending.overstack.group || []);
      const candidates = api.unitsAt(state, space, pending.faction)
          .filter((unit) => api.isCombatUnit(unit) && group.has(unit.id))
          .map((unit) => unit.id);
      return candidates;
  }

  function advanceGroupStackLegal(state, space, ids, faction) {
      if (api.spaceById[space]?.large_area)
          return true;
      const selected = new Set(ids);
      const existing = api.unitsAt(state, space, faction).filter((unit) => !selected.has(unit.id));
      const incoming = ids
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(Boolean);
      return ([...existing, ...incoming].filter(api.isCombatUnit).length <= 3 &&
          [...existing, ...incoming].filter((unit) => unit.type === "hq").length <= 1);
  }

  function advanceCountedUnitCount(state, ids) {
      return (ids || [])
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(api.isCombatUnit).length;
  }

  function advanceHqsEscorted(state, ids) {
      const units = (ids || [])
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(Boolean);
      const combatUnits = units.filter(api.isCombatUnit);
      return units
          .filter((unit) => unit.type === "hq")
          .every((hq) => combatUnits.some((unit) =>
              unit.location === hq.location &&
              api.nationalityGroup(unit.nation) === api.nationalityGroup(hq.nation)));
  }

  function advanceSelectionHqsCompletable(state, pending, ids) {
      const units = (ids || [])
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(Boolean);
      const combatUnits = units.filter(api.isCombatUnit);
      const remainingCount = pending.maximum == null
          ? Infinity
          : Number(pending.maximum) -
              advanceCountedUnitCount(state, pending.advanced_ids) -
              advanceCountedUnitCount(state, ids);
      return units
          .filter((unit) => unit.type === "hq")
          .every((hq) => combatUnits.some((unit) =>
              unit.location === hq.location &&
              api.nationalityGroup(unit.nation) === api.nationalityGroup(hq.nation)) ||
              (remainingCount > 0 && (pending.units || []).some((candidateId) => {
                  if (ids.includes(candidateId))
                      return false;
                  const candidate = state.units.find((unit) => unit.id === candidateId);
                  return candidate && api.isCombatUnit(candidate) &&
                      candidate.location === hq.location &&
                      api.nationalityGroup(candidate.nation) === api.nationalityGroup(hq.nation);
              })));
  }

  function advanceLeavesUnselectedHqsLegal(state, pending, ids) {
      if (!pending || pending.advance_group?.length)
          return true;
      const selected = new Set(ids || []);
      const selectedUnits = (ids || [])
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(Boolean);
      const origins = new Set(selectedUnits.map((unit) => unit.location));
      for (const origin of origins) {
          const unselectedHqs = api.unitsAt(state, origin, selectedUnits[0].faction)
              .filter((unit) => unit.type === "hq" && !selected.has(unit.id));
          if (unselectedHqs.some((hq) => !api.hqEndLegal(state, hq, origin, selected)))
              return false;
      }
      return true;
  }

  function advanceUnitInto(state, pending, unit, destination) {
      const origin = unit.location;
      const destroysKillingGround = unit.faction === api.CP &&
          state.markers?.killing_ground?.space === destination;
      const entersEnemyFort = Boolean(intactFort(state, destination) &&
          api.spaceById[destination]?.faction === api.other(unit.faction) &&
          !state.besieged.includes(destination) &&
          !destroysKillingGround);
      const enteredApItaly = unit.nation === "ah" &&
          api.spaceById[destination]?.nation === "it" &&
          state.control[destination] === api.AP;
      unit.location = destination;
      state.combat.resolution_events ||= [];
      state.combat.resolution_events.push({
          kind: "advance",
          side: unit.faction,
          unit: unit.id,
          from: origin,
          to: destination,
      });
      api.log(state, `${api.pieceById[unit.piece]?.name || unit.id}挺进：${api.spaceById[origin]?.name || origin} → ${api.spaceById[destination]?.name || destination}。`);
      // An intact enemy fort remains enemy-controlled while besieged.  The
      // complete advancing group is validated before movement and the siege
      // marker is established after every member has entered.
      if (!entersEnemyFort)
          api.captureSpace(state, destination, unit.faction);
      if (enteredApItaly)
          api.markMoRequirement(state, "ah", "enter_enemy_italy");
      if (api.isCombatUnit(unit))
          api.markAdvanceMo(state, unit.nation);
      if (unit.type === "army")
          pending.army_advanced = true;
      if (!pending.advanced_ids.includes(unit.id))
          pending.advanced_ids.push(unit.id);
      const salient = state.combat?.modifiers?.cards?.find((entry) => entry.effect.salient_on_advance);
      if (salient) {
          const event = api.cardById[salient.id]?.event;
          const status = event && state.events[event];
          if (status) {
              status.salient_candidates ||= [];
              if (!status.salient_candidates.includes(destination))
                  status.salient_candidates.push(destination);
          }
      }
      for (const entry of state.combat?.modifiers?.cards || [])
          if (entry.effect.vp_if_no_army_advance && unit.type === "army") {
              const event = api.cardById[entry.id]?.event;
              if (state.events[event])
                  state.events[event].army_advanced = true;
          }
  }

  function advanceCanEnter(state, ids, destination, allowOverstack = false) {
      const movedAttackers = new Set(state.combat?.move_attackers || []);
      if (ids.some((id) => movedAttackers.has(id)))
          return false;
      const units = ids
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(Boolean);
      if (!units.length || units.length !== ids.length)
          return false;
      const faction = units[0].faction;
      if (units.some((unit) => unit.faction !== faction ||
          !api.connectionAllows(unit.location, destination, "advance", faction)) ||
          !advanceHqsEscorted(state, ids) ||
          !advanceLeavesUnselectedHqsLegal(state, state.pending_retreat, ids) ||
          !api.canOccupyByEarlyWarDepth(state, faction, destination) ||
          !api.spaceCanActivate(state, destination) ||
          api.unitsAt(state, destination, api.other(faction)).length)
          return false;
      const lossFactor = intactFort(state, destination);
      if (lossFactor &&
          api.spaceById[destination]?.faction === api.other(faction) &&
          !state.besieged.includes(destination)) {
          const selected = new Set(ids);
          const besiegers = [
              ...api.unitsAt(state, destination, faction).filter((unit) => !selected.has(unit.id)),
              ...units,
          ];
          if (!canBesiegeWithUnits(besiegers, lossFactor))
              return false;
      }
      return allowOverstack || advanceGroupStackLegal(state, destination, ids, faction);
  }

  function advanceSelectionCanAdd(state, pending, ids) {
      const movedAttackers = new Set(state.combat?.move_attackers || []);
      if (ids.some((id) => movedAttackers.has(id)))
          return false;
      const units = ids
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(Boolean);
      if (!units.length || units.length !== ids.length)
          return false;
      const faction = units[0].faction;
      return (units.every((unit) => unit.faction === faction &&
          api.connectionAllows(unit.location, pending.target, "advance", faction)) &&
          advanceSelectionHqsCompletable(state, pending, ids) &&
          api.canOccupyByEarlyWarDepth(state, faction, pending.target) &&
          api.spaceCanActivate(state, pending.target) &&
          !api.unitsAt(state, pending.target, api.other(faction)).length &&
          advanceGroupStackLegal(state, pending.target, ids, faction));
  }

  function advanceTerrainAllowsSecondStep(state, pending) {
      return !["forest", "mountain", "swamp", "desert"].includes(api.spaceById[pending.target]?.terrain);
  }

  function secondAdvanceDestinations(state, pending, ids) {
      if ((pending.advance_group?.length || 0) !== 1 ||
          Number(pending.advance_max_steps || 1) < 2 ||
          !advanceTerrainAllowsSecondStep(state, pending))
          return [];
      return [...new Set((pending.retreat_paths || []).map((path) => path?.[1]))]
          .filter(Boolean)
          .filter((destination) => advanceCanEnter(state, ids, destination));
  }

  function advanceDestinations(state, pending = state.pending_retreat) {
      const ids = pending?.selected_advance_units || [];
      if (!ids.length)
          return [];
      if (pending.advance_group?.length)
          return secondAdvanceDestinations(state, pending, ids);
      return advanceCanEnter(state, ids, pending.target)
          ? [pending.target]
          : [];
  }

  function finishAdvanceGroup(state) {
      const pending = state.pending_retreat;
      pending.advance_group = null;
      pending.selected_advance_units = [];
      api.setActiveFaction(state, state.combat.attacker);
      state.state = "advance_select";
  }

  function beginPostRetreatAdvance(state) {
      const pending = state.pending_retreat;
      const combat = state.combat;
      if (!pending || !combat || pending.advance_complete) {
          finishCombatSequence(state);
          return;
      }
      const rules = combat.modifiers || {};
      if (rules.prohibit_advance?.includes("both") ||
          rules.prohibit_advance?.includes(combat.attacker) ||
          rules.cancel_advance?.includes(combat.attacker)) {
          api.clearUndo(state);
          finishCombatSequence(state);
          return;
      }
      pending.target ||= combat.target;
      const movedAttackers = new Set(combat.move_attackers || []);
      pending.units = (pending.advance_units || pending.units || []).filter((id) => {
          const unit = state.units.find((candidate) => candidate.id === id);
          return unit && api.isAttackParticipant(unit) && !movedAttackers.has(id);
      });
      pending.selected_advance_units = [];
      pending.advance_group = null;
      const completedRetreatLengths = (pending.retreat_paths || []).map((path) => Math.max(0, path.length - 1));
      pending.advance_max_steps = completedRetreatLengths.length
          ? Math.max(1, ...completedRetreatLengths)
          : Number(pending.advance_max_steps || pending.steps || 1);
      if (!pending.units.length || api.unitsAt(state, pending.target, api.other(combat.attacker)).length) {
          api.clearUndo(state);
          finishCombatSequence(state);
          return;
      }
      api.setActiveFaction(state, combat.attacker);
      state.state = "advance_select";
  }

  function finishAllRetreats(state) {
      const pending = state.pending_retreat;
      pending.phase = "advance";
      api.setActiveFaction(state, state.combat.attacker);
      if (beginCombatHqRelocation(state, state.combat, "post_retreat_advance"))
          return;
      beginPostRetreatAdvance(state);
  }

  function returnToRetreat(state) {
      const pending = state.pending_retreat;
      if (pending.waiting_hqs?.length) {
          const completed = [];
          for (const id of pending.waiting_hqs) {
              const hq = state.units.find((unit) => unit.id === id);
              if (!hq || api.hqEndLegal(state, hq, hq.location))
                  completed.push(id);
          }
          if (completed.length) {
              pending.retreat_paths ||= [];
              for (const id of completed) {
                  const path = pending.paths?.[id];
                  if (path?.length) pending.retreat_paths.push(path.slice());
              }
              pending.units = (pending.units || []).filter((id) => !completed.includes(id));
              pending.waiting_hqs = pending.waiting_hqs.filter((id) => !completed.includes(id));
          }
      }
      pending.units = (pending.units || []).filter((id) => state.units.some((unit) => unit.id === id));
      pending.selected_unit = null;
      if (!pending.units.length) {
          finishAllRetreats(state);
          return;
      }
      api.setActiveFaction(state, pending.faction);
      state.state = "retreat";
  }

  function finishRetreatUnit(state, id) {
      const pending = state.pending_retreat;
      const unit = state.units.find((candidate) => candidate.id === id);
      if (unit?.type === "hq" && !api.hqEndLegal(state, unit, unit.location)) {
          pending.waiting_hqs ||= [];
          if (!pending.waiting_hqs.includes(id)) pending.waiting_hqs.push(id);
          returnToRetreat(state);
          return;
      }
      const path = pending.paths?.[id];
      pending.units = pending.units.filter((candidate) => candidate !== id && state.units.some((unit) => unit.id === candidate));
      pending.retreat_paths ||= [];
      if (path?.length) pending.retreat_paths.push(path.slice());
      returnToRetreat(state);
  }

  function finishRetreatOverstack(state) {
      const pending = state.pending_retreat;
      const overstack = pending.overstack;
      const group = (overstack?.group || []).filter((id) =>
          state.units.some((unit) => unit.id === id));
      pending.overstack = null;
      const stillOverstacked = retreatSpaceOverstacked(
          state,
          overstack?.space,
          pending.faction,
      );
      if (overstack?.loss_paid && stillOverstacked && group.length) {
          pending.overstack_loss_paid ||= {};
          for (const id of group)
              pending.overstack_loss_paid[id] = true;
          if (overstack.final)
              for (const id of group)
                  pending.remaining[id] = Math.max(1, Number(pending.remaining[id]) || 0);
          pending.selected_unit = null;
          api.setActiveFaction(state, pending.faction);
          state.state = "retreat";
          return;
      }
      if (pending.overstack_loss_paid)
          for (const id of group) delete pending.overstack_loss_paid[id];
      if (overstack?.final) {
          pending.retreat_paths ||= [];
          for (const id of group) {
              const path = pending.paths?.[id];
              if (path?.length) pending.retreat_paths.push(path.slice());
          }
          pending.units = (pending.units || []).filter((id) => !group.includes(id));
          returnToRetreat(state);
          return;
      }
      pending.selected_unit = null;
      api.setActiveFaction(state, pending.faction);
      state.state = "retreat";
  }

  function resolveSieges(state) {
      refreshBesieged(state);
      for (const spaceId of state.besieged.slice()) {
          const space = api.spaceById[spaceId];
          const lossFactor = intactFort(state, spaceId);
          if (!lossFactor)
              continue;
          const drm = 0;
          const die = api.roll(state);
          const result = die + drm;
          api.log(state, `${space.name} siege: ${die}${drm ? ` ${drm}` : ""} = ${result}.`);
          if (result > lossFactor) {
              destroyFort(state, spaceId, "fort surrendered");
          }
      }
  }
return Object.freeze({
    allOutAttackChoices,
    assignedDestroyMoQualifies,
    advanceCanEnter,
    advanceCountedUnitCount,
    advanceCombatHqRelocation,
    advanceCombatLosses,
    advanceDestinations,
    advanceGroupStackLegal,
    advanceSelectionCanAdd,
    advanceTerrainAllowsSecondStep,
    advanceUnitInto,
    applyCombatOutcomeEffects,
    applyPostCombatRules,
    attackSelectionActions,
    attackModeForDeclaration,
    attacksTarget,
    beginCombat,
    beginCombatHqRelocation,
    beginCombatRepair,
    beginCounterattackEvent,
    beginPostRetreatAdvance,
    buildCombatLossPaths,
    canCancelRetreatWithUnit,
    canBesiege,
    canBesiegeWithUnits,
    candidateSpaces,
    cleanupEmptyFortifications,
    combatHqs,
    combatEffectEligible,
    combatLossChoices,
    combatModifiers,
    combatRepairAvailable,
    combatRepairCandidates,
    combatRepairReplacement,
    combatStrength,
    combatTable,
    commitPendingAttack,
    chooseOptionalCombatEvent,
    currentPendingHq,
    defendedAttackTarget,
    deferUnroutableRetreatHqs,
    destroyFort,
    diazHqSpaces,
    eligibleAttackUnitIds,
    eliminateUnit,
    explainPiece,
    explainSpace,
    finishAdvanceGroup,
    finishAllRetreats,
    finishCombatLosses,
    finishCombatSequence,
    forcedAttackRequiredIds,
    finishRetreatUnit,
    finishRetreatOverstack,
    fireColumn,
    fireResult,
    fortCombatStrength,
    geometricAttackTargets,
    hqRelocationSpaces,
    intactFort,
    legalCombatLossUnitIds,
    legalFlankFinals,
    legalTargetsForAttackers,
    lossModelReplacementOptions,
    multinationalAttackValid,
    nivelleMarkerCandidates,
    pendingAttackOriginCount,
    optionalCombatEventChoices,
    permanentlyEliminateCombatArmy,
    placeOptionalCombatHq,
    placeCombatReplacement,
    pruneOrphanAttackHqs,
    reduceCombatUnit,
    reduceUnit,
    refreshBesieged,
    refreshBesiegedSpace,
    relocateCombatHq,
    removeUnit,
    repairCombatUnit,
    requiredAttackersByOrigin,
    resolveCombat,
    resolveCombatRepairReplacement,
    resolveDeferredFire,
    resolveFortCombatLoss,
    resolveSieges,
    resumeAfterCombatRepair,
    retreatBaseDestinations,
    retreatCancellationTerrainAllowed,
    retreatDestinations,
    retreatFinalStackLegal,
    retreatUnitHasRoute,
    retreatOverstackLossCandidates,
    retreatSpaceOverstacked,
    returnToRetreat,
    secondAdvanceDestinations,
    sendCombatHqToTurnTrack,
    validateAttackDeclaration,
  });
}

module.exports = { createCombatSystem };
