"use strict";

const { createFrontEventSystem } = require("./events/fronts.js");

const { createReplacementEventSystem } = require("./events/replacement.js");

const { createCombatEventSystem } = require("./events/combat.js");

const { createMovementEventSystem } = require("./events/movement.js");

const { createReinforcementEventSystem } = require("./events/reinforcements.js");

const REINFORCEMENT_EVENT_NATION = Object.freeze({
  603: "br", 604: "br", 605: "br", 617: "br", 618: "br", 619: "br", 645: "br",
  607: "fr", 615: "fr", 616: "fr",
  715: "ge", 717: "ge", 735: "ge", 747: "ge", 749: "ge",
  649: "us", 650: "us",
});

function createEventSystem(api) {
  let own = null;
  const eventContext = new Proxy(api, {
    get(target, property) {
      if (own && property in own) return own[property];
      return target[property];
    },
  });
  const frontEvents = createFrontEventSystem(eventContext);
  const {
    beginKillingGroundEvent,
    commitmentRank,
    enterCommitment,
    resolveAutomaticTurkeyEntry,
    resolveCommitmentStage,
    resolveWarStatus,
  } = frontEvents;
  const replacementEvents = createReplacementEventSystem(eventContext);
  const {
    beginImmediateRpUse,
    chooseImmediateRpMode,
    desertionImmediateCandidates,
    finishImmediateRpUse,
    immediateReplacementOptions,
    immediateRpGrant,
    italyEntryRestorationCandidates,
    spendImmediateRp,
  } = replacementEvents;
  const combatEvents = createCombatEventSystem(eventContext);
  const {
    beginDesertionImmediateLoss,
    beginMassAttritionEvent,
    commitFrenchDoctrine,
    frenchDoctrineCandidates,
    massAttritionCandidates,
    massAttritionMoChoices,
    massAttritionRequired,
  } = combatEvents;
  const movementEvents = createMovementEventSystem(eventContext);
  const {
    addHindenburgDefenseMo,
    advanceWhiteFeatherSr,
    augustBelgianSpaces,
    augustGunsUnits,
    beginHindenburgLineEvent,
    beginRegionalRotationEvent,
    beginSpaceRuleEvent,
    beginWhiteFeatherSearch,
    beginWhiteFeatherSr,
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
  } = movementEvents;
  const reinforcementEvents = createReinforcementEventSystem(eventContext);
  const {
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
    selectPiaveExchange,
    stagedReinforcementView,
  } = reinforcementEvents;
  const { cardSpecById, data } = api;
  function ruleModifier(card) {
    return cardSpecById[card?.id]?.operations?.find(
      (operation) => operation.type === "rule_modifier",
    ) || null;
  }

  function activeRule(state, key) {
    for (const [event, status] of Object.entries(state.events)) {
      if (!status) continue;
      if (status.rule?.key === key) return status.rule;
      const card = data.cards.find((candidate) => candidate.event === event);
      const rule = card && ruleModifier(card);
      if (rule?.key === key) return rule;
    }
    return null;
  }

  

  function enterNation(state, nation) {
      state.events[`entry_${nation}`] = true;
      const waiting = state.entry_reserve?.[nation] || [];
      for (const unit of waiting) {
          api.hydrateUnit(unit);
          unit.moved = false;
          unit.attacked = false;
          state.units.push(unit);
      }
      if (state.entry_reserve)
          state.entry_reserve[nation] = [];
      if (waiting.length)
          api.log(state, `${nation.toUpperCase()} entry: deployed ${waiting.length} setup units.`);
  }

  function eventLegal(state, card) {
      if (!card || !card.event)
          return false;
      const reinforcementNation = REINFORCEMENT_EVENT_NATION[card.id];
      if (reinforcementNation) {
          const used = state.reinforcement_events_this_turn?.[card.faction] || [];
          if (used.includes(reinforcementNation)) return false;
          if (reinforcementNation === "us" && !state.events[api.cardById[646].event])
              return false;
      }
      if (card.id === 723 && state.events[api.cardById[746].event] &&
          state.state !== "naval_choice" && !state.naval?.resolving)
          return false;
      for (const activeEvent of Object.keys(state.events || {})) {
          const activeCard = api.data.cards.find((candidate) => candidate.event === activeEvent);
          if (!activeCard)
              continue;
          for (const operation of api.cardSpecById[activeCard.id]?.operations || []) {
              if ((operation.prohibit_future && operation.prohibit_card === card.id) ||
                  operation.prohibits_card === card.id ||
                  operation.prohibits_event === card.event)
                  return false;
          }
      }
      if (card.commitment === "limited" &&
          state.commitment[card.faction] === "mobilization")
          return false;
      if (card.commitment === "total" && state.commitment[card.faction] !== "total")
          return false;
      if (card.combat_card && state.state !== "combat_card_window")
          return false;
      const definition = api.data.events[card.event];
      const prerequisites = api.cardSpecById[card.id]?.prerequisites || {};
      const spec = api.cardSpecById[card.id];
      if (spec?.obsolete?.prohibit_event && api.obsoleteCardRuleApplies(state, card))
          return false;
      if (spec?.duration === "until_used" && state.events[card.event])
          return false;
      const operations = api.cardSpecById[card.id]?.operations || [];
      const choices = api.cardSpecById[card.id]?.choices || [];
      if (card.id === 613 && choices.length && !choices.some((choice) =>
          choice.select?.kind !== "units" || eventSelectionAvailable(state, choice.select)))
          return false;
      const delayed = operations.find((operation) => operation.type === "delay_units");
      if (delayed && !delayedUnitSelectionAvailable(state, delayed))
          return false;
      const usesTurkishFront = operations.some((operation) => (operation.type === "front" && operation.track === "turkish") ||
          operation.alternative_front?.track === "turkish" ||
          operation.track === "turkish" ||
          JSON.stringify(operation).includes("turkish_front"));
      if (card.id !== 703 && usesTurkishFront && !api.turkishFrontActive(state))
          return false;
      const minTurn = prerequisites.min_turn || definition?.min_turn;
      const maxTurn = prerequisites.max_turn || definition?.max_turn;
      const requiredEvent = prerequisites.requires_event || definition?.requires_event;
      const requiredAny = prerequisites.requires_any_event?.length
          ? prerequisites.requires_any_event
          : definition?.requires_any_event;
      const minFront = prerequisites.min_front || definition?.min_front;
      if (minTurn && state.turn < minTurn)
          return false;
      if (maxTurn && state.turn > maxTurn)
          return false;
      if (prerequisites.action_round &&
          state.action_round !== prerequisites.action_round)
          return false;
      if (prerequisites.forbids_event && state.events[prerequisites.forbids_event])
          return false;
      if (prerequisites.min_combined_war_status &&
          state.war_status.combined < prerequisites.min_combined_war_status)
          return false;
      if (prerequisites.min_combined_war_status_or_turn &&
          state.war_status.combined < prerequisites.min_combined_war_status_or_turn.status &&
          state.turn < prerequisites.min_combined_war_status_or_turn.turn)
          return false;
      if (prerequisites.maximum_commitment) {
          const rank = { mobilization: 0, limited: 1, total: 2 };
          if (rank[state.commitment[card.faction]] >
              rank[prerequisites.maximum_commitment])
              return false;
      }
      if (prerequisites.min_turn_or_event_count &&
          state.turn < prerequisites.min_turn_or_event_count.turn) {
          const count = prerequisites.min_turn_or_event_count.events.filter((event) => state.events[event]).length;
          if (count < prerequisites.min_turn_or_event_count.count)
              return false;
      }
      if (requiredEvent && !state.events[requiredEvent])
          return false;
      if (requiredAny?.length &&
          !requiredAny.some((event) => state.events[event]) &&
          !Object.entries(definition?.allow_if_front_at_most || {}).some(([front, maximum]) => state.fronts[front] <= maximum))
          return false;
      if (minFront &&
          Object.entries(minFront).some(([front, value]) => state.fronts[front] < value))
          return false;
      const eventCost = api.cardSpecById[card.id]?.operations?.find((operation) => operation.type === "event_cost");
      if (eventCost &&
          !state.events[eventCost.requires_event] &&
          state.fronts[eventCost.alternative_front.track] +
              eventCost.alternative_front.amount <
              0)
          return false;
      const rule = api.ruleModifier(card);
      if (rule?.key === "sack_belgium" && sackBelgiumCandidates(state).length < rule.remove_count)
          return false;
      if (rule?.key === "august_guns" &&
          !spaceRuleCandidates(state, { operation: rule }).length)
          return false;
      if (rule?.key === "french_offensive_doctrine" &&
          frenchDoctrineCandidates(state).length < rule.attack_spaces)
          return false;
      if (rule?.key === "hindenburg_line" &&
          (!hindenburgStackCandidates(state).length ||
              hindenburgMarkerCandidates(state, { markers: [] }).length <
                  (rule.marker_count || 2)))
          return false;
      if (api.cardSpecById[card.id]?.combat?.somme_marker &&
          !spaceRuleCandidates(state, { operation: { key: "somme" } }).length)
          return false;
      if (rule?.key === "desertion" && state.events[api.cardById[627].event] &&
          desertionImmediateCandidates(state, "lcu").length < rule.cadorna_immediate_losses &&
          desertionImmediateCandidates(state, "scu").length < rule.cadorna_immediate_losses)
          return false;
      return !state.events[card.event] || !card.remove;
  }

  function gorlitzMoChoices(state, pending = state.pending_event) {
      const requirement = pending?.operation?.complete_mo;
      if (pending?.kind !== "gorlitz_mo" || !requirement)
          return [];
      return (state.mo.current[requirement.nation] || []).filter((id) => {
          const definition = api.moDefinition(state, id);
          return definition?.kind === "task" &&
              !api.moIsResolved(state, requirement.nation, id);
      });
  }

  function entryGapVpCost(state, card) {
      const rule = api.cardSpecById[card?.id]?.entry_gap_vp_cost;
      if (!rule)
          return 0;
      const track = Number(state.entry_tracks?.[rule.track]) || 0;
      const comparison = rule.compare === "combined_war_status"
          ? Number(state.war_status?.combined) || 0
          : 0;
      const gap = Math.max(0, comparison - track);
      const divisor = Math.max(1, Number(rule.divisor) || 1);
      return rule.round === "ceil"
          ? Math.ceil(gap / divisor)
          : Math.floor(gap / divisor);
  }

  function applyEffectOperation(state, card, operation) {
      if (operation.type === "noop")
          return;
      if (operation.type === "vp" &&
          (!operation.min_turn || state.turn >= operation.min_turn) &&
          (!operation.max_turn || state.turn <= operation.max_turn))
          api.adjustVp(state, operation.amount);
      else if (operation.type === "rp") {
          if (operation.unless_event && state.events[operation.unless_event])
              return;
          const faction = operation.faction || card.faction;
          state.rp[faction][operation.nation] = Math.max(0, (state.rp[faction][operation.nation] || 0) + operation.amount);
      }
      else if (operation.type === "front") {
          if (operation.track === "turkish" && !api.turkishFrontActive(state))
              return;
          const locked = Object.keys(state.events).some((event) => {
              if (event === card.event)
                  return false;
              if (api.data.events[event]?.lock_front === operation.track)
                  return true;
              const eventCard = api.data.cards.find((candidate) => candidate.event === event);
              return (eventCard &&
                  (api.cardSpecById[eventCard.id]?.combat?.lock_front === operation.track ||
                      api.ruleModifier(eventCard)?.lock_front === operation.track));
          });
          const turnLocked = operation.track === "turkish" &&
              state.turn_flags.turkish_front_locked === state.turn &&
              card.id !== 728;
          if (!locked && !turnLocked) {
              api.moveFront(state, operation.track, operation.amount, card.title);
              if (operation.track === "turkish" && operation.amount > 0)
                  state.turn_flags.turkish_front_advanced = state.turn;
          }
      }
      else if (operation.type === "entry")
          enterNation(state, operation.nation);
      else if (operation.type === "event_cost") {
          if (!state.events[operation.requires_event]) {
              const cost = operation.alternative_front;
              api.moveFront(state, cost.track, cost.amount, `${card.title} event cost`);
          }
      }
      else if (operation.type === "entry_track") {
          if (operation.recurring) {
              const status = state.events[card.event];
              if (status) {
                  status.recurring_entry_tracks ||= [];
                  status.recurring_entry_tracks.push({
                      track: operation.track,
                      amount: operation.amount,
                      unless_event: operation.unless_event || null,
                  });
              }
          }
          else
              state.entry_tracks[operation.track] = Math.max(0, (state.entry_tracks[operation.track] || 0) + operation.amount);
      }
      else if (operation.type === "cancel_event")
          delete state.events[operation.event];
      else if (operation.type === "replacement_bonus") {
          const status = state.events[card.event];
          if (status) {
              status.replacement_bonus = api.clone(operation.values);
              status.free_upgrade = api.clone(operation.free_upgrade || null);
              const immediate = operation.immediate_if_commitment;
              if (immediate &&
                  state.commitment[immediate.faction] === immediate.level)
                  state.rp[immediate.faction][immediate.nation] =
                      (state.rp[immediate.faction][immediate.nation] || 0) +
                          immediate.amount;
          }
      }
      else if (operation.type === "end_vp") {
          const status = state.events[card.event];
          if (status)
              status.end_vp = operation.amount;
      }
      else if (operation.type === "recurring_rp_loss") {
          const status = state.events[card.event];
          if (status)
              status.recurring_rp_loss = api.clone(operation.values);
      }
      else if (operation.type === "war_status") {
          const activeCount = (operation.first_of_events || []).filter((event) => state.events[event]).length;
          if (!operation.first_of_events || activeCount === 1) {
              const faction = operation.faction || card.faction;
              state.war_status[faction] += operation.amount;
              state.war_status.combined += operation.amount;
          }
      }
      else if (operation.type === "step_loss") {
          const candidates = [
              ...state.units.map((entry) => ({ entry, zone: "map" })),
              ...state.reserves[operation.faction].map((entry) => ({
                  entry,
                  zone: "reserve",
              })),
          ].filter((token) => token.entry.piece === operation.piece);
          const token = candidates.find((candidate) => !candidate.entry.reduced) || candidates[0];
          let replacement = false;
          if (token && !token.entry.reduced)
              token.entry.reduced = true;
          else {
              if (token?.zone === "map")
                  api.eliminateUnit(state, token.entry.id, card.title);
              else if (token) {
                  state.reserves[operation.faction].splice(state.reserves[operation.faction].findIndex((entry) => entry.id === token.entry.id), 1);
                  token.entry.reduced = true;
                  delete token.entry.location;
                  api.placeEliminatedUnit(state, token.entry, card.title);
              }
              replacement = true;
          }
          if (!token &&
              state.eliminated[operation.faction].some((entry) => entry.piece === operation.piece))
              replacement = true;
          if (replacement && operation.replacement_piece) {
              const unit = {
                  id: `u${state.next_unit_id++}`,
                  piece: operation.replacement_piece,
                  reduced: false,
                  tts_guid: null,
              };
              api.hydrateUnit(unit);
              api.normalizeOffMapUnit(unit);
              state.reserves[operation.faction].push(unit);
          }
      }
      else if (operation.type === "mo_modify")
          applyMoModification(state, card, operation);
      else if (operation.type === "mo_unlock") {
          const definition = (api.data.mo[operation.nation] || [])
              .find((entry) => entry.id === operation.id);
          if (!definition)
              throw new Error(`Unknown MO ${operation.id}`);
      }
      else if (operation.type === "rule_modifier") {
          const status = state.events[card.event];
          if (status)
              status.rule = api.clone(operation);
          if (operation.persist_separately)
              state.events[`${card.event}_permanent`] = {
                  turn: state.turn,
                  faction: card.faction,
                  persistent: true,
                  duration: "game",
                  rule: api.clone(operation),
              };
          if (status && operation.key === "race_to_sea")
              status.expires = "action_round";
          if (operation.key === "zeppelin_raids") {
              for (const [faction, nations] of Object.entries(operation.recurring_rp_loss || {}))
                  for (const [nation, amount] of Object.entries(nations))
                      state.rp[faction][nation] = Math.max(0, (state.rp[faction][nation] || 0) - amount);
              for (let offset = 1; offset < operation.turns; offset++)
                  state.scheduled_events.push({
                      kind: "rp_adjustment",
                      source_card: card.id,
                      due_turn: state.turn + offset,
                      adjustments: api.clone(operation.recurring_rp_loss),
                  });
          }
          if (operation.key === "uboat_offensive") {
              const unrestricted = state.events[api.cardById[746].event];
              if (!unrestricted && operation.damaged_british_reinforcements)
                  state.turn_flags.british_reinforcements_reduced = state.turn;
          }
          if (operation.key === "allenby" &&
              state.turn_flags.turkish_front_locked === state.turn)
              delete state.turn_flags.turkish_front_locked;
          if (operation.key === "gallipoli_lock" &&
              !state.events[operation.canceled_by_event])
              state.turn_flags.turkish_front_locked = state.turn;
          if (operation.key === "kemal") {
              state.turn_flags.turkish_front_cost_increase =
                  operation.turkish_front_cost_increase;
              state.turn_flags.turkish_front_cost_turn = state.turn;
          }
          if (operation.key === "victory_or_collapse") {
              state.entry_tracks.us = Math.max(0, state.entry_tracks.us + operation.us_entry);
              if (![740, 744, 748].some((id) => state.events[api.cardById[id].event]))
                  api.adjustVp(state, -1);
          }
          if (operation.key === "gorlitz_tarnow") {
              const requirement = operation.complete_mo;
              if (!requirement.choose)
                for (let count = 0; count < requirement.count; count++) {
                  const pending = (state.mo.current[requirement.nation] || []).find((id) => !api.moIsResolved(state, requirement.nation, id));
                  if (pending)
                      api.completeMo(state, requirement.nation, pending);
                }
          }
          if (operation.key === "bulgaria") {
              for (let offset = 1; offset <= operation.response_turns; offset++)
                  state.scheduled_events.push({
                      kind: "bulgaria_choice",
                      source_card: card.id,
                      due_turn: state.turn + offset,
                      faction: api.AP,
                      remove_nation: operation.remove_nation,
                      remove_type: operation.remove_type,
                      alternative_vp: operation.alternative_vp,
                  });
          }
      }
      else if (operation.type === "combat_modifier" && !card.combat_card) {
          const status = state.events[card.event];
          if (status) {
              status.combat_card = true;
              status.expires = api.cardSpecById[card.id]?.duration || "combat";
              if (api.cardSpecById[card.id]?.combat?.vp_if_no_army_advance)
                  status.army_advanced = false;
          }
      }
  }

  function applyMoModification(state, card, operation) {
      if (operation.conditional_event && !state.events[operation.conditional_event])
          return;
      const nation = operation.nation;
      state.mo.pool[nation] ||= [];
      const wasApplied = state.mo.pool[nation].some((entry) => entry.source_card === card.id);
      const addedIds = [];
      for (const addition of operation.add || [])
          for (let index = 0; index < addition.count; index++) {
              const id = `${card.id}:mo:${addition.key}:${index + 1}`;
              const existing = state.mo.pool[nation].find((entry) => entry.id === id);
              const template = addition.template_id
                  ? api.moById[addition.template_id]
                  : null;
              if (!existing)
                  state.mo.pool[nation].push({
                      id,
                      nation,
                      kind: addition.kind,
                      duration: addition.duration,
                      name: addition.name ||
                          `${card.title}：${addition.key.replaceAll("_", " ")}`,
                      description: addition.description || addition.name || card.effect,
                      template_id: addition.template_id || null,
                      image: template?.image || null,
                      image_source: template?.image_source || null,
                      attacks: addition.attacks || 0,
                      requirement: addition.requirement || null,
                      target: addition.target || null,
                      prohibition: addition.prohibition || null,
                      attack_drm_uses: addition.attack_drm_uses || 0,
                      attack_drm: addition.attack_drm || 0,
                      attack_column_uses: addition.attack_column_uses || 0,
                      attack_column: addition.attack_column || 0,
                      attack_table: addition.attack_table || null,
                      attack_condition: addition.attack_condition || null,
                      distinct_targets: Boolean(addition.distinct_targets),
                      passive: addition.passive || null,
                      drm: addition.drm || 0,
                      reward_rp: addition.reward_rp || 0,
                      source_card: card.id,
                      counts_for_penalty: addition.counts_for_penalty ??
                          addition.kind === "task",
                      expires_turn: operation.duration === "turn" ? state.turn : null,
                  });
              else if (operation.duration === "turn")
                  existing.expires_turn = state.turn;
              addedIds.push(id);
          }
      if (!wasApplied && operation.draw_bonus)
          state.mo.draw_bonus[nation] =
              (state.mo.draw_bonus[nation] || 0) + operation.draw_bonus;
      if (!wasApplied && operation.draw_count != null)
          state.mo.draw_count[nation] = operation.draw_count;
      if (!wasApplied && operation.draw_limit != null)
          state.mo.draw_limit[nation] = operation.draw_limit;
      if (!wasApplied && operation.completion_required != null)
          state.mo.completion_required[nation] = operation.completion_required;
      if (operation.duration === "turn") {
          state.mo.current[nation] ||= [];
          state.mo.completed[nation] ||= [];
          state.mo.progress[nation] ||= {};
          state.mo.drm_used[nation] ||= {};
          for (const id of addedIds)
              if (!state.mo.current[nation].includes(id)) {
                  state.mo.current[nation].push(id);
                  state.mo.progress[nation][id] = 0;
                  state.mo.drm_used[nation][id] = 0;
                  const definition = state.mo.pool[nation].find((entry) => entry.id === id);
                  if (api.moKind(definition) === "prohibition")
                      api.revealMo(state, id);
              }
      }
  }

  function reinforcementOperation(card) {
      return (api.cardSpecById[card.id]?.operations?.find((operation) => operation.type === "reinforcement") || null);
  }

  function beginCardSearchEvent(state, card, operation) {
      const candidates = [
          ...state.decks[card.faction],
          ...state.discard[card.faction],
      ].filter((id) => {
          const reinforcement = reinforcementOperation(api.cardById[id]);
          return reinforcement?.units?.some((unit) => api.pieceById[unit.piece]?.type === "army");
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
      };
      state.active = card.faction;
      state.state = "event";
      return true;
  }

  function finishEvent(state, card, selectedOperations = []) {
      const owner = state.pending_event?.owner || card.faction;
      const eventPlacements = (state.pending_event?.placements || []).map((entry) => entry.space);
      const immediateExtra = api.clone(state.pending_event?.immediate_rp_extra || {});
      state.active = owner;
      const wasPlayed = Boolean(state.events[card.event]) ||
          state.event_history.some((entry) => entry.event === card.event);
      const reinforcementNation = REINFORCEMENT_EVENT_NATION[card.id];
      if (reinforcementNation) {
          state.reinforcement_events_this_turn ||= { ap: [], cp: [] };
          const used = state.reinforcement_events_this_turn[owner] ||= [];
          if (!used.includes(reinforcementNation)) used.push(reinforcementNation);
      }
      const definition = api.data.events[card.event];
      const spec = api.cardSpecById[card.id];
      applyPrintedWarStatus(state, card, wasPlayed);
      state.events[card.event] = {
          turn: state.turn,
          faction: card.faction,
          persistent: definition?.kind === "persistent",
          duration: spec?.duration || "instant",
          cleanup: spec?.cleanup || null,
          first_play: !wasPlayed,
      };
      const entryCost = entryGapVpCost(state, card);
      if (entryCost) {
          api.adjustVp(state, entryCost);
          api.log(state, `${card.title}：美国参战差额 +${entryCost} VP。`);
      }
      for (const operation of [...(spec?.operations || []), ...selectedOperations]) {
          if (state.pending_event?.early_vp && operation.type === "vp")
              continue;
          applyEffectOperation(state, card, operation);
      }
      const rp = wasPlayed
          ? definition?.later_rp
          : definition?.first_rp || definition?.rp;
      if (rp &&
          !(spec?.operations || []).some((operation) => operation.type === "rp"))
          for (const [nation, amount] of Object.entries(rp))
              state.rp[card.faction][nation] =
                  (state.rp[card.faction][nation] || 0) + amount;
      if (definition?.conditional_fronts &&
          state.events[definition.conditional_fronts.event])
          for (const [front, amount] of Object.entries(definition.conditional_fronts))
              if (front !== "event" &&
                  (front !== "turkish" || api.turkishFrontActive(state)))
                  api.moveFront(state, front, amount, card.title);
      const disposition = api.cardUseDisposition(state, card, "event");
      if (disposition === "remove")
          state.removed[owner].push(card.id);
      else
          state.discard[owner].push(card.id);
      state.event_history.push({
          card: card.id,
          event: card.event,
          faction: card.faction,
          turn: state.turn,
          round: state.action_round,
          placements: eventPlacements,
          operations: api.clone(selectedOperations),
      });
      state.pending_event = null;
      api.log(state, `${api.factionRole(state.active)} 事件：${card.title}。`);
      if (beginImmediateRpUse(state, card, wasPlayed, selectedOperations, immediateExtra))
          return;
      if (beginDesertionImmediateLoss(state, card))
          return;
      if (state.naval.resolving) {
          api.continueNavalEvents(state);
          return;
      }
      const reinforcement = reinforcementOperation(card);
      if (reinforcement?.free_sr) {
          const freeSrCount = state.turn === 1 && reinforcement.free_sr.turn_one_count != null
              ? reinforcement.free_sr.turn_one_count
              : reinforcement.free_sr.count;
          state.sr = {
              card: card.id,
              remaining: freeSrCount,
              free: true,
              restriction: api.clone(reinforcement.free_sr),
              destinations: [...new Set(eventPlacements)],
              used_destinations: [],
              used_units: [],
              selected_unit: null,
          };
          state.state = "sr";
          return;
      }
      if (reinforcement?.sr_points) {
          state.sr = {
              card: card.id,
              remaining: reinforcement.sr_points,
              used_units: [],
              selected_unit: null,
          };
          state.state = "sr";
          return;
      }
      const rule = spec?.operations?.find((operation) => operation.type === "rule_modifier");
      if (rule?.key === "trench_capability" ||
          card.color === "yellow" ||
          rule?.key === "august_guns" ||
          (!card.combat_card && spec?.duration === "action_round" && spec?.combat)) {
          api.beginOps(state, card);
          if (rule?.key === "trench_capability")
              state.ops.prohibit_attack = true;
          if (rule?.key === "august_guns") {
              state.ops.total = rule.activate_spaces;
              state.ops.remaining = rule.activate_spaces;
              state.ops.free_activation_cost = 1;
              state.ops.source = "event";
              state.ops.source_id = card.id;
          }
          return;
      }
      api.nextFactionAction(state);
  }

  function applyPrintedWarStatus(state, card, previouslyPlayed = false) {
      const values = String(card.printed_marker || "")
          .split("/")
          .map(Number);
      const amount = previouslyPlayed && values.length > 1 ? values[1] : values[0];
      if (!Number.isFinite(amount) || amount <= 0)
          return 0;
      state.war_status[card.faction] += amount;
      state.war_status.combined += amount;
      return amount;
  }

  function salientChoice(state) {
      for (const [event, status] of Object.entries(state.events || {})) {
          if (!status || status.salient_resolved)
              continue;
          const card = api.cardById[status.source_card] ||
              Object.values(api.cardById).find((candidate) => candidate.event === event);
          const effect = card && api.cardSpecById[card.id]?.combat;
          const spaces = [...new Set(status.salient_candidates || [])]
              .filter((space) => api.spaceById[space]);
          if (effect?.salient_on_advance && spaces.length)
              return { card, status, spaces };
      }
      return null;
  }

  function beginSalientChoice(state) {
      const choice = salientChoice(state);
      if (!choice)
          return false;
      state.pending_event = {
          kind: "salient",
          card: choice.card.id,
          owner: api.CP,
          chooser: api.CP,
          spaces: choice.spaces,
      };
      state.state = "event";
      state.active = api.CP;
      state.phase = "放置突出部";
      return true;
  }

  function commitSalient(state, space) {
      const pending = state.pending_event;
      if (pending?.kind !== "salient" || !pending.spaces.includes(space))
          throw new Error("Illegal salient space");
      const card = api.cardById[pending.card];
      const status = card && state.events[card.event];
      if (!status || status.salient_resolved || !(status.salient_candidates || []).includes(space))
          throw new Error("The salient event is no longer active");
      state.markers.salients ||= [];
      if (!state.markers.salients.some((marker) => marker.source_card === card.id))
          state.markers.salients.push({ space, source_card: card.id });
      status.salient_resolved = true;
      state.pending_event = null;
      api.log(state, `突出部：[[space:${space}]]。`);
      api.nextFactionAction(state);
  }

  function resolveEvent(state, card) {
      if (!eventLegal(state, card))
          throw new Error("Event is not currently legal");
      const spec = api.cardSpecById[card.id];
      const choices = (spec?.choices || []).filter((choice) => {
          if (choice.timing && choice.timing !== "action")
              return false;
          if (card.id === 754 && choice.id === "russian_front" &&
              api.frontMovementLocked(state, "russian"))
              return false;
          return true;
      });
      const rule = api.ruleModifier(card);
      if (rule?.key === "sack_belgium") {
          state.pending_event = {
              card: card.id,
              faction: card.faction,
              owner: card.faction,
              chooser: card.faction,
              kind: "sack_belgium",
              operation: api.clone(rule),
              selected_units: [],
          };
          state.active = card.faction;
          state.state = "event";
          return;
      }
      if (rule?.key === "french_offensive_doctrine") {
          const candidates = frenchDoctrineCandidates(state);
          const required = rule.attack_spaces;
          if (candidates.length < required)
              throw new Error("Two legal French offensive stacks are required");
          state.pending_event = {
              card: card.id,
              faction: card.faction,
              owner: card.faction,
              chooser: api.CP,
              kind: "french_doctrine",
              operation: api.clone(rule),
              candidates,
              spaces: [],
              required,
          };
          state.active = api.CP;
          state.state = "event";
          return;
      }
      if (rule?.key === "italy_entry" && state.turn >= rule.restore_turn) {
          const candidates = italyEntryRestorationCandidates(state, {
              operation: rule,
          });
          const required = Math.min(rule.restore_count, candidates.length);
          if (required) {
              state.pending_event = {
                  card: card.id,
                  faction: card.faction,
                  owner: card.faction,
                  chooser: card.faction,
                  kind: "italy_entry_restore",
                  operation: api.clone(rule),
                  required,
              };
              state.active = card.faction;
              state.state = "event";
              return;
          }
      }
      if (rule?.key === "regional_rotation" && state.events[card.event]) {
          beginRegionalRotationEvent(state, card, rule);
          return;
      }
      if (rule?.key === "influenza") {
          beginMassAttritionEvent(state, card, rule);
          return;
      }
      if (rule?.key === "gorlitz_tarnow" && rule.complete_mo?.choose) {
          state.pending_event = {
              card: card.id,
              faction: card.faction,
              owner: card.faction,
              chooser: card.faction,
              kind: "gorlitz_mo",
              operation: api.clone(rule),
          };
          state.active = card.faction;
          state.state = "event";
          if (gorlitzMoChoices(state).length)
              return;
          finishEvent(state, card);
          return;
      }
      if (rule?.key === "women_labor" && beginCardSearchEvent(state, card, rule))
          return;
      if (rule?.key === "white_feather") {
          beginWhiteFeatherSr(state, card, rule);
          return;
      }
      if (rule?.key === "killing_ground") {
          beginKillingGroundEvent(state, card, rule);
          return;
      }
      if (rule?.key === "hindenburg_line") {
          beginHindenburgLineEvent(state, card, rule);
          return;
      }
      if (rule?.key === "august_guns") {
          beginSpaceRuleEvent(state, card, rule);
          return;
      }
      if (spec?.combat?.somme_marker) {
          beginSpaceRuleEvent(state, card, { key: "somme" });
          return;
      }
      const delayed = delayedUnitOperation(card);
      if (delayed) {
          beginDelayedUnitEvent(state, card, delayed);
          return;
      }
      const reinforcement = reinforcementOperation(card);
      if (reinforcement) {
          beginReinforcementEvent(state, card, reinforcement);
          return;
      }
      if (choices.length) {
          const chooser = choices[0].chooser || card.faction;
          state.pending_event = {
              card: card.id,
              faction: card.faction,
              owner: card.faction,
              chooser,
              choices: choices.map((choice) => choice.id),
              choice: null,
              units: [],
              space: null,
          };
          state.state = "event";
          state.active = chooser;
          api.log(state, `${card.title}：等待事件选择。`);
          return;
      }
      finishEvent(state, card);
  }

  function eventChoice(state, id) {
      const pending = state.pending_event;
      const card = pending && api.cardById[pending.card];
      if (pending?.kind === "killing_ground_maintenance") {
          api.resolveKillingGroundMaintenance(state, id);
          return;
      }
      if (pending?.kind === "immediate_rp") {
          chooseImmediateRpMode(state, id);
          return;
      }
      if (pending?.kind === "reinforcement" && String(id).startsWith("exchange:")) {
          selectPiaveExchange(state, id);
          return;
      }
      if (pending?.kind === "mo_penalty") {
          if (pending.stage !== "mode")
              throw new Error("The MO penalty mode is already selected");
          if (id === "attack") {
              if (!pending.required)
                  throw new Error("No legal forced-attack stack");
              pending.stage = "origin";
              return;
          }
          if (id === "loss") {
              if (!pending.loss_required)
                  throw new Error("No legal non-lethal MO penalty units");
              pending.stage = "loss";
              pending.selected_units = [];
              return;
          }
          if (id === "forward") {
              if (pending.required || !pending.forward_available)
                  throw new Error("Forward movement is available only when two attack markers cannot be placed");
              pending.stage = "forward_origin";
              return;
          }
          throw new Error("Invalid unfulfilled-MO penalty choice");
      }
      if (pending?.kind === "front_maintenance") {
          api.chooseFrontMaintenance(state, id);
          return;
      }
      if (pending?.kind === "front_investment") {
          api.chooseFrontInvestment(state, id);
          return;
      }
      if (pending?.kind === "veteran_upgrade") {
          if (!["reserve", "eliminated"].includes(id))
              throw new Error("Invalid veteran replacement destination");
          api.commitVeteranUpgrade(state, id);
          return;
      }
      if (pending?.kind === "hq_relocation") {
          if (id !== "turn_track")
              throw new Error("Invalid HQ relocation choice");
          api.sendCombatHqToTurnTrack(state, pending);
          return;
      }
      if (pending?.kind === "bulgaria_choice") {
          if (id === "vp") {
              api.adjustVp(state, pending.schedule.alternative_vp);
              api.finishBulgariaChoice(state, pending);
              return;
          }
          if (id !== "remove" || !api.bulgariaChoiceCandidates(state, pending).length)
              throw new Error("Invalid Bulgaria follow-up choice");
          pending.mode = "remove";
          return;
      }
      if (pending?.kind === "bulgaria_front_response") {
          if (id === "use") {
              if (state.rp.cp.ge < 1 || state.fronts.turkish <= 0)
                  throw new Error("Bulgaria front response is no longer affordable");
              state.rp.cp.ge -= 1;
              api.moveFront(state, "turkish", -1, "Bulgaria response");
              state.usage_limits[pending.usage_key] = 1;
          }
          else if (id !== "skip")
              throw new Error("Invalid Bulgaria front response");
          state.pending_event = null;
          api.finishPostReplacement(state);
          return;
      }
      if (pending?.kind === "aef_replacements") {
          throw new Error("AEF replacements are placed on the map or reserve box");
      }
      if (pending?.kind === "mo_counterattack") {
          if (id === "skip") {
              state.pending_event = null;
              state.active = pending.resume.active;
              state.ops = pending.resume.ops;
              state.activations = pending.resume.activations;
              state.state = "ops_activate";
              return;
          }
          if (id !== "use")
              throw new Error("Invalid US MO counterattack choice");
          state.pending_event = null;
          state.active = api.AP;
          state.ops = {
              card: 650,
              total: 0,
              remaining: 0,
              italian_bonus: 0,
              activated: [pending.origin],
              moving: null,
              forced_attacks: [pending.origin],
              required_attackers: { [pending.origin]: pending.units.slice() },
              resume_after_forced: api.clone(pending.resume),
              preactivation_sr_used: [],
              preactivation_sr_units: [],
          };
          state.activations = { [pending.origin]: "attack" };
          state.state = "ops_activate";
          return;
      }
      if (pending?.kind === "precombat_restore") {
          if (id !== "done")
              throw new Error("Invalid pre-combat restoration choice");
          const declaration = api.clone(pending.declaration);
          state.pending_event = null;
          state.active = pending.owner;
          api.openCombatCardWindow(state, declaration);
          return;
      }
      if (pending?.kind === "combat_repair") {
          if (pending.replacement_choice) {
              api.resolveCombatRepairReplacement(state, id);
              return;
          }
          if (id !== "done")
              throw new Error("Invalid combat repair choice");
          api.resumeAfterCombatRepair(state, pending);
          return;
      }
      if (pending?.kind === "combat_hq_reinforcement") {
          if (id !== "skip" || pending.required)
              throw new Error("Invalid combat HQ reinforcement choice");
          api.resolveCombatHqReinforcement(state, null);
          return;
      }
      if (pending?.kind === "combat_fr_rp") {
          if (id !== "done")
              throw new Error("Invalid French RP choice");
          if (!["convert", "repair"].includes(pending.mode))
              throw new Error("French RP flow is awaiting another choice");
          finishCombatFrRp(state, pending);
          return;
      }
      if (pending?.kind === "mass_attrition" && pending.stage === "mo") {
          const [prefix, nation, mo] = String(id).split(":");
          if (prefix !== "mo" ||
              !massAttritionMoChoices(state).some((entry) => entry.nation === nation && entry.id === mo))
              throw new Error("Illegal influenza MO completion");
          pending.mo_selection = { nation, mo };
          pending.stage = "losses";
          state.active = api.AP;
          return;
      }
      if (pending?.kind === "desertion_immediate") {
          if (pending.branch)
              throw new Error("Desertion is selecting units");
          if (!["lcu", "scu"].includes(id))
              throw new Error("Invalid Desertion loss type");
          const candidates = desertionImmediateCandidates(state, id);
          if (candidates.length < pending.required)
              throw new Error("Insufficient Desertion candidates");
          pending.branch = id;
          return;
      }
      if (pending?.kind === "counterattack") {
          if (pending.stage !== "cards")
              throw new Error("Counterattack is selecting an origin");
          const [choice, rawId] = String(id).split(":");
          const selected = Number(rawId);
          if (pending.cards[pending.index] !== selected)
              throw new Error("Invalid counterattack card choice");
          const cardPool = api.cardById[selected].remove
              ? state.removed.cp
              : state.discard.cp;
          const poolIndex = cardPool.indexOf(selected);
          if (choice === "return") {
              if (poolIndex >= 0)
                  cardPool.splice(poolIndex, 1);
              if (!state.hands.cp.includes(selected))
                  state.hands.cp.push(selected);
          }
          else if (choice !== "remove" || !api.cardById[selected].remove)
              throw new Error("Combat card cannot be removed");
          pending.index += 1;
          if (pending.index >= pending.cards.length)
              pending.stage = "origin";
          return;
      }
      if (pending?.kind === "optional_deploy") {
          if (id === "skip") {
              finishEvent(state, card);
              return;
          }
          if (id !== "deploy")
              throw new Error("Invalid optional deployment choice");
          pending.mode = "deploy";
          return;
      }
      if (pending?.kind === "august_reposition") {
          if (id !== "done")
              throw new Error("Invalid August Guns response");
          finishEvent(state, card);
          return;
      }
      if (pending?.kind === "ohl") {
          if (pending.stage === "discard") {
              if (id === "skip") {
                  state.usage_limits[`ohl:${state.turn}`] = 1;
                  state.pending_event = null;
                  api.resolveAttrition(state, [api.AP]);
                  return;
              }
              const selected = Number(id);
              const index = state.hands.cp.indexOf(selected);
              if (index < 0 || !pending.cards.includes(selected))
                  throw new Error("Invalid OHL discard");
              state.hands.cp.splice(index, 1);
              state.discard.cp.push(selected);
              pending.stage = "take";
              pending.cards = state.discard.cp.filter((cardId) => api.cardById[cardId]?.combat_card);
              return;
          }
          const selected = Number(id);
          if (!pending.cards.includes(selected))
              throw new Error("Invalid OHL combat card");
          state.discard.cp.splice(state.discard.cp.indexOf(selected), 1);
          state.scheduled_events.push({
              kind: "card_return",
              source_card: 713,
              due_turn: state.turn + pending.operation.return_turns,
              faction: api.CP,
              card: selected,
          });
          state.usage_limits[`ohl:${state.turn}`] = 1;
          state.pending_event = null;
          api.resolveAttrition(state, [api.AP]);
          return;
      }
      if (pending?.kind === "regional_rotation") {
          if (id === "skip") {
              finishEvent(state, card);
              return;
          }
          if (id !== "reduce" || !regionalRotationCandidates(state).length)
              throw new Error("Invalid rotation choice");
          pending.mode = "reduce";
          return;
      }
      if (pending?.kind === "card_search") {
          const selected = Number(id);
          if (!pending.cards.includes(selected))
              throw new Error("Invalid searched card");
          for (const pool of [
              state.decks[pending.owner],
              state.discard[pending.owner],
          ]) {
              const index = pool.indexOf(selected);
              if (index >= 0)
                  pool.splice(index, 1);
          }
          state.hands[pending.owner].push(selected);
          finishEvent(state, card);
          return;
      }
      if (pending?.kind === "white_feather_sr") {
          if (id !== "skip" || whiteFeatherCandidates(state, pending).length)
              throw new Error("A required reserve corps is available");
          advanceWhiteFeatherSr(state, pending, card);
          return;
      }
      if (pending?.kind === "gorlitz_mo") {
          const selected = String(id);
          if (!gorlitzMoChoices(state, pending).includes(selected))
              throw new Error("Invalid German MO completion");
          api.completeMo(state, pending.operation.complete_mo.nation, selected, "event");
          finishEvent(state, card);
          return;
      }
      const spec = card && api.cardSpecById[card.id];
      const choice = spec?.choices?.find((candidate) => candidate.id === id && pending.choices.includes(candidate.id));
      if (!choice)
          throw new Error("Invalid event choice");
      if (choice.select?.kind === "units" &&
          !eventSelectionAvailable(state, choice.select))
          throw new Error("Not enough legal event units");
      pending.choice = choice.id;
      pending.units = [];
      pending.space = null;
      if (!choice.select)
          finishEvent(state, card, choice.effects || []);
  }

  function eventToken(state, id) {
      const mapUnit = state.units.find((unit) => unit.id === id);
      if (mapUnit)
          return { zone: "map", entry: mapUnit, piece: api.pieceById[mapUnit.piece] };
      for (const faction of [api.AP, api.CP]) {
          const reserve = state.reserves[faction].find((unit) => unit.id === id);
          if (reserve)
              return {
                  zone: `${faction}_reserve`,
                  entry: reserve,
                  piece: api.pieceById[reserve.piece],
              };
          const upgrade = state.upgrade_pool[faction].find((unit) => unit.id === id);
          if (upgrade)
              return {
                  zone: `${faction}_upgrade`,
                  entry: upgrade,
                  piece: api.pieceById[upgrade.piece],
              };
          const eliminated = state.eliminated[faction].find((unit) => unit.id === id);
          if (eliminated)
              return {
                  zone: `${faction}_eliminated`,
                  entry: eliminated,
                  piece: api.pieceById[eliminated.piece],
              };
      }
      return null;
  }

  function eventPieceExists(state, piece) {
      return [
          state.units,
          state.reserves.ap,
          state.reserves.cp,
          state.upgrade_pool.ap,
          state.upgrade_pool.cp,
          state.eliminated.ap,
          state.eliminated.cp,
          state.permanently_removed_units,
          state.hq_turn_track.ap,
          state.hq_turn_track.cp,
      ].some((pool) => (pool || []).some((unit) => unit.piece === piece));
  }

  function combatFrRpHqSpaces(state, pending = state.pending_event) {
      if (pending?.kind !== "combat_fr_rp" || pending.mode !== "hq")
          return [];
      const piece = api.pieceById[pending.hq_piece];
      if (!piece || eventPieceExists(state, piece.id))
          return [];
      const target = state.combat?.target;
      const candidates = new Set(target ? [target] : []);
      for (const space of api.data.spaces)
          if (api.nationalSupplySource(state, api.AP, "fr", space))
              candidates.add(space.id);
      const probe = { id: "__petain__", piece: piece.id, faction: api.AP, nation: "fr", type: "hq" };
      return [...candidates].filter((space) =>
          state.control[space] === api.AP &&
          !api.unitsAt(state, space, api.CP).length &&
          api.stackLegal(state, space, probe));
  }

  function placeCombatFrRpHq(state, space) {
      const pending = state.pending_event;
      if (!combatFrRpHqSpaces(state, pending).includes(space))
          throw new Error("Illegal Petain reinforcement space");
      const piece = api.pieceById[pending.hq_piece];
      const unit = {
          id: `u${state.next_unit_id++}`,
          piece: piece.id,
          faction: api.AP,
          nation: piece.nation,
          type: piece.type,
          location: space,
          reduced: false,
          moved: false,
          attacked: false,
          supplied: true,
      };
      api.hydrateUnit(unit);
      state.units.push(unit);
      pending.mode = "convert";
      api.log(state, `[[unit:${unit.id}]]部署到[[space:${space}]]。`);
  }

  function combatFrRpConversionCandidates(state, pending = state.pending_event) {
      if (pending?.kind !== "combat_fr_rp" || pending.mode !== "convert")
          return [];
      return state.units
          .filter((unit) => unit.faction === api.AP && unit.nation === "fr" &&
              api.isCombatUnit(unit) && api.unitRepairCost(unit) <= pending.remaining)
          .map((unit) => unit.id);
  }

  function placeEventArmyReplacement(state, pending, id) {
      const replacement = pending.replacement;
      const pool = state.reserves[replacement.faction];
      const index = pool.findIndex((unit) =>
          unit.id === id && replacement.options.includes(unit.id));
      if (index < 0)
          throw new Error("Illegal event army replacement");
      const [unit] = pool.splice(index, 1);
      api.hydrateUnit(unit);
      unit.location = replacement.location;
      unit.moved = false;
      unit.attacked = false;
      state.units.push(unit);
      api.log(state, `[[unit:${replacement.army}]]由[[unit:${unit.id}]]替换。`);
      pending.replacement = null;
      pending.mode = replacement.resume_mode;
      state.active = replacement.return_active;
  }

  function eliminateEventArmy(state, pending, unit, resumeMode) {
      const index = state.units.findIndex((candidate) => candidate.id === unit.id);
      if (index < 0)
          return;
      const eliminated = api.clone(unit);
      api.eliminateUnit(state, unit.id, "事件消灭");
      const options = api.combatReplacementOptions(state, eliminated);
      if (!options.length)
          return;
      const replacement = {
          army: eliminated.id,
          faction: eliminated.faction,
          location: eliminated.location,
          options: options.map((candidate) => candidate.id),
          resume_mode: resumeMode,
          return_active: state.active,
      };
      if (replacement.options.length === 1) {
          pending.replacement = replacement;
          placeEventArmyReplacement(state, pending, replacement.options[0]);
          return;
      }
      pending.replacement = replacement;
      pending.mode = "replacement";
      state.active = eliminated.faction;
  }

  function continueMassAttritionLosses(state, pending = state.pending_event) {
      if (pending?.kind !== "mass_attrition")
          throw new Error("No influenza losses are pending");
      if (pending.mo_selection && !pending.mo_completed) {
          api.completeMo(
              state,
              pending.mo_selection.nation,
              pending.mo_selection.mo,
              "influenza",
          );
          pending.mo_completed = true;
      }
      pending.mode = "mass_losses";
      while (pending.loss_index < pending.loss_queue.length) {
          const id = pending.loss_queue[pending.loss_index++];
          const unit = state.units.find((candidate) => candidate.id === id);
          if (!unit)
              continue;
          const startedFull = pending.initial[unit.faction].full.includes(id);
          if (startedFull) {
              if (!unit.reduced)
                  unit.reduced = true;
              continue;
          }
          if (unit.reduced && unit.type === "army") {
              eliminateEventArmy(state, pending, api.clone(unit), "mass_losses");
              if (pending.mode === "replacement")
                  return;
          }
      }
      const card = api.cardById[pending.card];
      finishEvent(state, card);
  }

  function convertCombatFrRpStep(state, id) {
      const pending = state.pending_event;
      if (!combatFrRpConversionCandidates(state, pending).includes(id))
          throw new Error("Illegal French step conversion");
      const unit = state.units.find((candidate) => candidate.id === id);
      const cost = api.unitRepairCost(unit);
      if (unit.reduced && unit.type === "army")
          eliminateEventArmy(state, pending, api.clone(unit), "convert");
      else if (unit.reduced)
          api.eliminateUnit(state, id, "他们无法通过");
      else
          unit.reduced = true;
      pending.remaining -= cost;
      pending.gained += cost;
      state.rp.ap.fr += cost;
  }

  function combatFrReplacementOptions(state, pending = state.pending_event) {
      if (pending?.kind !== "combat_fr_rp" || pending.mode !== "repair")
          return [];
      const units = [...state.units, ...state.eliminated.ap];
      const options = [];
      for (const unit of units)
          if (unit.nation === "fr")
              for (const kind of ["flip", "upgrade", "rebuild"]) {
                  const option = api.replacementOption(state, { kind, unit: unit.id, key: "fr" });
                  if (option && option.cost <= pending.remaining)
                      options.push({ kind, unit: unit.id, key: "fr", cost: option.cost });
              }
      return options;
  }

  function spendCombatFrRp(state, token) {
      const pending = state.pending_event;
      const [kind, unit, key] = String(token).split(":");
      const option = combatFrReplacementOptions(state, pending)
          .find((entry) => entry.kind === kind && entry.unit === unit && entry.key === key);
      if (!option)
          throw new Error("Illegal temporary French RP expenditure");
      const parent = api.clone(pending);
      api.spendReplacement(state, { kind, unit, key });
      if (state.pending_event?.kind === "replacement_rebuild") {
          state.pending_event.resume_combat_fr_rp = parent;
          state.pending_event.immediate_rp_key = key;
          state.pending_event.immediate_rp_cost = option.cost;
          return;
      }
      if (state.pending_event?.kind === "veteran_upgrade") {
          state.pending_event.resume_combat_fr_rp = parent;
          state.pending_event.immediate_rp_key = key;
          state.pending_event.immediate_rp_cost = option.cost;
          return;
      }
      pending.remaining -= option.cost;
  }

  function finishCombatFrRp(state, pending = state.pending_event) {
      if (pending?.kind !== "combat_fr_rp")
          throw new Error("No temporary French RP flow");
      if (pending.mode === "convert") {
          pending.mode = "repair";
          pending.remaining = pending.gained;
          if (pending.remaining && combatFrReplacementOptions(state, pending).length)
              return;
      }
      if (pending.mode === "repair")
          state.rp.ap.fr = Math.max(0, state.rp.ap.fr - pending.remaining);
      api.resumeAfterCombatRepair(state, pending);
  }

  function permanentlyRemovePiece(state, pieceId, removedBy) {
      for (const pool of [
          state.units,
          state.reserves.ap,
          state.reserves.cp,
          state.upgrade_pool.ap,
          state.upgrade_pool.cp,
          state.eliminated.ap,
          state.eliminated.cp,
      ]) {
          const index = pool.findIndex((unit) => unit.piece === pieceId);
          if (index < 0)
              continue;
          const [unit] = pool.splice(index, 1);
          delete unit.location;
          state.permanently_removed_units.push({
              ...api.clone(unit),
              removed_by: removedBy,
              removed_turn: state.turn,
          });
          return unit;
      }
      return null;
  }

  function effectiveEventSelection(state, selection) {
      const effective = api.clone(selection || {});
      const extra = effective.additional_if_missing_event;
      if (!extra || state.events[extra.event])
          return effective;
      effective.count = (effective.count || 0) + (extra.count || 0);
      effective.nations = [...new Set([...(effective.nations || []), ...(extra.nations || [])])];
      effective.types = [...new Set([...(effective.types || []), ...(extra.types || [])])];
      effective.groups = [...(effective.groups || []), ...(extra.groups || [])];
      return effective;
  }

  function eventUnitCandidates(state, selection) {
      selection = effectiveEventSelection(state, selection);
      const ids = [
          ...state.units.map((unit) => unit.id),
          ...state.reserves.ap.map((unit) => unit.id),
          ...state.reserves.cp.map((unit) => unit.id),
          ...state.upgrade_pool.ap.map((unit) => unit.id),
          ...state.upgrade_pool.cp.map((unit) => unit.id),
          ...state.eliminated.ap.map((unit) => unit.id),
          ...state.eliminated.cp.map((unit) => unit.id),
      ];
      return ids.filter((id) => {
          const token = eventToken(state, id);
          if (!token?.piece)
              return false;
          const faction = token.entry.faction || token.piece.faction;
          if (selection.zones?.length && !selection.zones.includes(token.zone))
              return false;
          if (selection.faction && faction !== selection.faction)
              return false;
          if (selection.nations?.length &&
              !selection.nations.includes(token.piece.nation))
              return false;
          if (selection.types?.length && !selection.types.includes(token.piece.type))
              return false;
          if (selection.exclude_pieces?.includes(token.piece.id))
              return false;
          if (selection.veteran != null &&
              Boolean(token.piece.veteran) !== Boolean(selection.veteran))
              return false;
          const name = `${token.piece.name || ""} ${token.piece.id || ""}`.toLowerCase();
          if (selection.exclude?.some((term) => name.includes(term.toLowerCase()) ||
              (term === "bef" && /远征/.test(name))))
              return false;
          return true;
      });
  }

  function sackBelgiumCandidates(state) {
      return eventUnitCandidates(state, {
          faction: api.AP,
          nations: ["be"],
          types: ["corps"],
          zones: ["map", "ap_reserve", "ap_eliminated"],
      });
  }

  function eventSelectionAvailable(state, selection) {
      selection = effectiveEventSelection(state, selection);
      const candidates = eventUnitCandidates(state, selection);
      if (candidates.length < selection.count)
          return false;
      return (selection.groups || []).every((group) => candidates.filter((id) => {
          const piece = eventToken(state, id)?.piece;
          return piece && (!group.nations?.length || group.nations.includes(piece.nation)) &&
              (!group.types?.length || group.types.includes(piece.type));
      }).length >= group.count);
  }

  function permanentlyRemoveEventUnit(state, id, card) {
      const token = eventToken(state, id);
      if (!token)
          throw new Error("Event unit not found");
      if (token.zone === "map")
          state.units.splice(state.units.findIndex((unit) => unit.id === id), 1);
      else {
          const [faction, zone] = token.zone.split("_");
          const pool = zone === "reserve"
              ? state.reserves[faction]
              : zone === "upgrade"
                  ? state.upgrade_pool[faction]
                  : state.eliminated[faction];
          pool.splice(pool.findIndex((unit) => unit.id === id), 1);
      }
      state.permanently_removed_units.push({
          ...api.clone(token.entry),
          removed_by: card.id,
          removed_turn: state.turn,
      });
  }

  function eventUnits(state, ids) {
      const pending = state.pending_event;
      const card = pending && api.cardById[pending.card];
      if (pending?.kind === "sack_belgium") {
          const legal = new Set(sackBelgiumCandidates(state));
          if (!Array.isArray(ids) ||
              ids.length !== pending.operation.remove_count ||
              new Set(ids).size !== ids.length ||
              ids.some((id) => !legal.has(id)))
              throw new Error("Invalid Belgian SCU removal");
          for (const id of ids)
              permanentlyRemoveEventUnit(state, id, card);
          const piece = api.pieceById[pending.operation.place_eliminated_piece];
          const unit = {
              id: `u${state.next_unit_id++}`,
              piece: piece.id,
              reduced: false,
              tts_guid: null,
              reinforcement_card: card.id,
          };
          api.hydrateUnit(unit);
          api.normalizeOffMapUnit(unit);
          state.eliminated[piece.faction].push(unit);
          finishEvent(state, card);
          return;
      }
      if (pending?.kind === "mo_penalty") {
          if (pending.stage === "forward_leave") {
              const legal = new Set(api.moPenaltyForwardOptions(state, pending.penalized)
                  .filter((entry) => entry.origin === pending.origin)
                  .map((entry) => entry.leave));
              if (!Array.isArray(ids) || ids.length !== 1 || !legal.has(ids[0]))
                  throw new Error("Choose one combat unit to remain behind");
              pending.leave = ids[0];
              pending.stage = "forward_target";
              return;
          }
          throw new Error("Use the server-owned MO penalty selection actions");
      }
      if (pending?.kind === "bulgaria_choice") {
          if (pending.mode !== "remove" ||
              !Array.isArray(ids) ||
              ids.length !== 1 ||
              !api.bulgariaChoiceCandidates(state, pending).includes(ids[0]))
              throw new Error("Invalid Bulgaria permanent removal");
          const unit = api.removeUnit(state, ids[0]);
          state.permanently_removed_units.push({
              ...api.clone(unit),
              removed_by: pending.card,
              removed_turn: state.turn,
          });
          api.finishBulgariaChoice(state, pending);
          return;
      }
      if (pending?.kind === "italy_entry_restore") {
          const legal = new Set(italyEntryRestorationCandidates(state, pending));
          if (!Array.isArray(ids) ||
              ids.length !== pending.required ||
              new Set(ids).size !== ids.length ||
              ids.some((id) => !legal.has(id)))
              throw new Error("Invalid Italian restoration");
          for (const id of ids) {
              const unit = [...state.units, ...(state.entry_reserve?.it || [])].find((candidate) => candidate.id === id);
              unit.reduced = false;
          }
          finishEvent(state, card);
          return;
      }
      if (pending?.kind === "reinforcement_rebuild")
          throw new Error("Reinforcement rebuild selection is handled by its event state");
      if (pending?.kind === "precombat_restore") {
          if (!Array.isArray(ids) ||
              ids.length !== 1 ||
              pending.remaining <= 0 ||
              !pending.candidates.includes(ids[0]))
              throw new Error("Illegal pre-combat restoration");
          const unit = state.units.find((candidate) => candidate.id === ids[0]);
          if (!unit?.reduced)
              throw new Error("Unit is not reduced");
          unit.reduced = false;
          pending.candidates = pending.candidates.filter((id) => id !== unit.id);
          pending.remaining -= 1;
          state.usage_limits[pending.usage_key] =
              (state.usage_limits[pending.usage_key] || 0) + 1;
          if (!pending.remaining || !pending.candidates.length) {
              const declaration = api.clone(pending.declaration);
              state.pending_event = null;
              state.active = pending.owner;
              api.openCombatCardWindow(state, declaration);
          }
          return;
      }
      if (pending?.kind === "combat_repair") {
          if (!Array.isArray(ids) || ids.length !== 1)
              throw new Error("Choose one combat unit to repair");
          api.repairCombatUnit(state, pending, ids[0]);
          if (!pending.remaining || !api.combatRepairCandidates(state, pending).length)
              api.resumeAfterCombatRepair(state, pending);
          return;
      }
      if (pending?.kind === "combat_fr_rp") {
          if (!Array.isArray(ids) || ids.length !== 1)
              throw new Error("Choose one French combat unit");
          if (pending.mode === "replacement")
              placeEventArmyReplacement(state, pending, ids[0]);
          else if (pending.mode === "convert")
              convertCombatFrRpStep(state, ids[0]);
          else
              throw new Error("French RP flow is not selecting a unit");
          if (pending.mode === "convert" && !pending.remaining)
              finishCombatFrRp(state, pending);
          return;
      }
      if (pending?.kind === "desertion_immediate") {
          if (!pending.branch ||
              !Array.isArray(ids) ||
              ids.length !== pending.required)
              throw new Error("Choose the required Desertion units");
          const legal = new Set(desertionImmediateCandidates(state, pending.branch));
          if (new Set(ids).size !== ids.length || ids.some((id) => !legal.has(id)))
              throw new Error("Illegal Desertion unit");
          for (const id of ids) {
              const unit = state.units.find((candidate) => candidate.id === id);
              if (pending.branch === "lcu" && !unit.reduced)
                  unit.reduced = true;
              else
                  api.eliminateUnit(state, id, "Desertion");
          }
          const resumeOpsCard = pending.resume_ops_card;
          state.pending_event = null;
          state.active = pending.owner;
          if (resumeOpsCard)
              api.beginOps(state, api.effectiveCard(state, api.cardById[resumeOpsCard]));
          else {
              state.state = "action_card";
              api.nextFactionAction(state);
          }
          return;
      }
      if (pending?.kind === "desertion_combat_loss") {
          if (!Array.isArray(ids) ||
              ids.length !== 1 ||
              !pending.candidates.includes(ids[0]))
              throw new Error("Illegal post-combat Desertion unit");
          const unit = state.units.find((candidate) => candidate.id === ids[0]);
          if (!unit)
              throw new Error("Desertion unit is no longer on the map");
          if (unit.reduced)
              api.eliminateUnit(state, unit.id, "Desertion");
          else
              unit.reduced = true;
          pending.candidates = pending.candidates.filter((id) => id !== unit.id);
          pending.remaining -= 1;
          if (pending.remaining > 0 &&
              pending.candidates.some((id) => state.units.some((candidate) => candidate.id === id)))
              return;
          state.pending_event = null;
          state.active = state.combat.attacker;
          if (pending.resume === "finish_combat_sequence")
              api.finishCombatSequence(state);
          else {
              state.state = "combat_losses";
              api.finishCombatLosses(state);
          }
          return;
      }
      if (pending?.kind === "mass_attrition") {
          if (pending.mode === "replacement") {
              if (!Array.isArray(ids) || ids.length !== 1)
                  throw new Error("Choose one influenza replacement SCU");
              placeEventArmyReplacement(state, pending, ids[0]);
              continueMassAttritionLosses(state, pending);
              return;
          }
          if (pending.stage !== "losses")
              throw new Error("Complete an AP MO first");
          const required = massAttritionRequired(state, pending, state.active);
          const legal = new Set(massAttritionCandidates(state, state.active));
          const requiredFull = pending.initial[state.active].full.length < required
              ? pending.initial[state.active].full
              : [];
          if (!Array.isArray(ids) ||
              ids.length !== required ||
              new Set(ids).size !== ids.length ||
              ids.some((id) => !legal.has(id)) ||
              requiredFull.some((id) => !ids.includes(id)))
              throw new Error("Illegal influenza losses");
          pending.selections[state.active] = ids.slice();
          if (state.active === api.AP) {
              state.active = api.CP;
              return;
          }
          pending.loss_queue = [
              ...pending.selections.ap,
              ...pending.selections.cp,
          ];
          pending.loss_index = 0;
          continueMassAttritionLosses(state, pending);
          return;
      }
      if (pending?.kind === "regional_rotation") {
          if (pending.mode !== "reduce" ||
              !Array.isArray(ids) ||
              ids.length !== 1 ||
              !regionalRotationCandidates(state).includes(ids[0]))
              throw new Error("Illegal rotation unit");
          eventToken(state, ids[0]).entry.reduced = true;
          state.rp.ap.fr += pending.operation.maximum_step_rp;
          pending.immediate_rp_extra ||= {};
          pending.immediate_rp_extra.fr =
              (pending.immediate_rp_extra.fr || 0) + pending.operation.maximum_step_rp;
          finishEvent(state, card);
          return;
      }
      if (pending?.kind === "white_feather_sr") {
          if (pending.unit ||
              !Array.isArray(ids) ||
              ids.length !== 1 ||
              !whiteFeatherCandidates(state, pending).includes(ids[0]))
              throw new Error("Illegal White Feather reserve corps");
          pending.unit = ids[0];
          if (!whiteFeatherSpaces(state, pending).length)
              throw new Error("No legal White Feather SR destination");
          return;
      }
      if (pending?.kind === "delay_units") {
          if (!Array.isArray(ids) ||
              ids.length !== 1 ||
              !delayedUnitCandidates(state, pending).includes(ids[0]))
              throw new Error("Illegal delayed unit");
          pending.units.push(ids[0]);
          pending.index += 1;
          return;
      }
      const choice = api.cardSpecById[card?.id]?.choices?.find((candidate) => candidate.id === pending.choice);
      if (!choice?.select || choice.select.kind !== "units")
          throw new Error("Event is not selecting units");
      const selection = effectiveEventSelection(state, choice.select);
      if (!Array.isArray(ids) ||
          ids.length !== selection.count ||
          new Set(ids).size !== ids.length)
          throw new Error("Wrong number of event units");
      const legal = new Set(eventUnitCandidates(state, selection));
      if (ids.some((id) => !legal.has(id)))
          throw new Error("Illegal event unit");
      for (const group of selection.groups || []) {
          const count = ids.filter((id) => {
              const piece = eventToken(state, id)?.piece;
              return piece && (!group.nations?.length || group.nations.includes(piece.nation)) &&
                  (!group.types?.length || group.types.includes(piece.type));
          }).length;
          if (count !== group.count)
              throw new Error("Event unit groups do not match");
      }
      for (const id of ids)
          permanentlyRemoveEventUnit(state, id, card);
      pending.units = ids.slice();
      finishEvent(state, card, choice.effects || []);
  }

  function cancelEvent(state) {
      const pending = state.pending_event;
      if (!pending)
          throw new Error("No pending event");
      if (state.active !== pending.owner)
          throw new Error("The responding player cannot cancel this event");
      if (Number.isInteger(pending.next_unit_id_before))
          state.next_unit_id = pending.next_unit_id_before;
      if (pending.early_vp)
          api.adjustVp(state, -pending.early_vp);
      state.hands[pending.owner].push(pending.card);
      state.pending_event = null;
      if (state.naval.resolving) {
          api.log(state, "取消海军事件选择，卡牌返回手牌。");
          api.continueNavalEvents(state);
          return;
      }
      api.clearCurrentActionHistory(state, pending.owner);
      state.state = "action_card";
      api.log(state, "取消事件选择，卡牌返回手牌。");
  }

  function removeCardFromAllPiles(state, faction, cardId) {
      for (const pool of [
          state.hands[faction],
          state.decks[faction],
          state.discard[faction],
      ]) {
          let index;
          while ((index = pool.indexOf(cardId)) >= 0)
              pool.splice(index, 1);
      }
  }
return Object.freeze(own = {
    activeRule,
    addHindenburgDefenseMo,
    advanceWhiteFeatherSr,
    applyEffectOperation,
    applyMoModification,
    applyPrintedWarStatus,
    augustBelgianSpaces,
    augustGunsUnits,
    beginCardSearchEvent,
    beginDelayedUnitEvent,
    beginDesertionImmediateLoss,
    beginHindenburgLineEvent,
    beginImmediateRpUse,
    beginKillingGroundEvent,
    beginMassAttritionEvent,
    beginRegionalRotationEvent,
    beginReinforcementEvent,
    beginSpaceRuleEvent,
    beginSalientChoice,
    beginWhiteFeatherSearch,
    cancelEvent,
    chooseImmediateRpMode,
    commitAugustBelgianRelocation,
    commitAugustGunsReposition,
    commitDelayedUnits,
    commitNavalPostFortifications,
    commitFrenchDoctrine,
    commitOptionalDeployment,
    commitPiaveExchangeDestination,
    commitReinforcementRebuild,
    commitReinforcements,
    commitSpaceRule,
    commitSalient,
    commitmentRank,
    combatFrReplacementOptions,
    combatFrRpConversionCandidates,
    combatFrRpHqSpaces,
    confirmHindenburgLine,
    delayedUnitCandidates,
    delayedUnitOperation,
    delayedUnitSelectionAvailable,
    desertionImmediateCandidates,
    distanceFromAny,
    enterCommitment,
    enterNation,
    entryGapVpCost,
    eventChoice,
    eventLegal,
    eventSelectionAvailable,
    eventPieceExists,
    eventToken,
    eventUnitCandidates,
    eventUnits,
    finishEvent,
    finishCombatFrRp,
    finishImmediateRpUse,
    frenchDoctrineCandidates,
    gorlitzMoChoices,
    hindenburgCanStop,
    hindenburgMarkerCandidates,
    hindenburgMovementFrame,
    hindenburgRetreatCandidates,
    hindenburgStackCandidates,
    immediateReplacementOptions,
    immediateRpGrant,
    isFrenchBorderSpace,
    italyEntryRestorationCandidates,
    massAttritionCandidates,
    massAttritionMoChoices,
    massAttritionRequired,
    continueMassAttritionLosses,
    nearestEnemyUnitDistance,
    optionalDeploySpaces,
    permanentlyRemoveEventUnit,
    permanentlyRemovePiece,
    piaveExchangeCandidates,
    piaveReturnSpaces,
    placeCombatFrRpHq,
    placeEventArmyReplacement,
    regionalRotationCandidates,
    reinforcementOperation,
    reinforcementPlacementId,
    reinforcementRebuildCandidates,
    reinforcementRebuildSpaces,
    reinforcementReduced,
    reinforcementSpaces,
    navalPostFortificationSpaces,
    removeCardFromAllPiles,
    resolveAutomaticTurkeyEntry,
    resolveCommitmentStage,
    resolveEvent,
    resolveWarStatus,
    resumeEventAfterSr,
    ruleModifier,
    sackBelgiumCandidates,
    selectHindenburgSpace,
    selectPiaveExchange,
    spaceRuleCandidates,
    spendImmediateRp,
    spendCombatFrRp,
    stagedReinforcementView,
    convertCombatFrRpStep,
    whiteFeatherCandidates,
    whiteFeatherSpaces,
  });
}

module.exports = { createEventSystem };
