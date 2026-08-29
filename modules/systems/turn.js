"use strict";

function createTurnSystem(api) {
  

  function cardIds(faction, commitment) {
      const rank = { mobilization: 0, limited: 1, total: 2 };
      return api.data.cards
          .filter((card) => card.faction === faction && rank[card.commitment] <= rank[commitment])
          .map((card) => card.id);
  }

  function setupDeck(state, faction) {
      const initial = api.data.cards
          .filter((card) => card.faction === faction && card.commitment === "mobilization")
          .map((card) => card.id);
      state.decks[faction] = api.shuffle(state, initial);
  }

  function recycleDiscardIntoDeck(state, faction) {
      const activeCombatCards = activeCombatCardIds(state);
      const recyclable = state.discard[faction].filter((id) => !activeCombatCards.has(id));
      if (!recyclable.length)
          return false;
      state.decks[faction] = api.shuffle(state, recyclable);
      state.discard[faction] = state.discard[faction].filter((id) => activeCombatCards.has(id));
      return true;
  }

  function drawCards(state, faction, target = api.data.title.hand_size || 9) {
      while (state.hands[faction].length < target) {
          if (!state.decks[faction].length && !recycleDiscardIntoDeck(state, faction))
              break;
          state.hands[faction].push(state.decks[faction].pop());
      }
  }

  function openingCardCandidates(state) {
      if (state.state === "opening_ap_card")
          return state.decks.ap.filter((id) => {
              const card = api.cardById[id];
              return card?.commitment === "mobilization" && Number(card.ops) === 4;
          });
      if (state.state === "opening_cp_august_guns")
          return state.decks.cp.includes(701) ? [701] : [];
      return [];
  }

  function finishOpeningSelection(state) {
      drawCards(state, api.AP);
      drawCards(state, api.CP);
      api.updateSupply(state);
      api.drawMo(state);
      state.phase = "强制进攻";
      state.state = "mo_review";
      state.active = api.CP;
      api.checkpoint(state, "turn", "T1");
      api.log(state, "《荣耀终结》1914 Historical 开局。");
  }

  function selectOpeningCard(state, id) {
      id = Number(id);
      if (!openingCardCandidates(state).includes(id))
          throw new Error("Illegal opening card");
      const faction = state.state === "opening_ap_card" ? api.AP : api.CP;
      state.decks[faction].splice(state.decks[faction].indexOf(id), 1);
      state.hands[faction].push(id);
      state.opening ||= {};
      state.opening[faction === api.AP ? "ap_card" : "cp_august_guns"] = id;
      if (faction === api.AP) {
          state.state = "opening_cp_august_guns";
          state.active = api.CP;
          return;
      }
      finishOpeningSelection(state);
  }

  function skipAugustGuns(state) {
      if (state.state !== "opening_cp_august_guns")
          throw new Error("August Guns choice is not active");
      state.opening ||= {};
      state.opening.cp_august_guns = null;
      finishOpeningSelection(state);
  }

  function activeCombatCardIds(state) {
      return new Set(Object.entries(state.events || {})
          .filter(([, status]) => status?.combat_card)
          .map(([event]) => api.data.cards.find((card) => card.event === event)?.id)
          .filter(Number.isInteger));
  }

  function discardRetainedCombatCards(state) {
      for (const faction of [api.AP, api.CP]) {
          const retained = state.retained_combat_cards[faction];
          if (!retained.length)
              continue;
          state.discard[faction].push(...retained);
          api.log(state, `${api.factionRole(faction)} 回合末弃置 ${retained.length} 张保留战斗牌。`);
          state.retained_combat_cards[faction] = [];
      }
  }

  function addCommitmentCards(state, faction, commitment) {
      const existing = new Set([
          ...state.decks[faction],
          ...state.hands[faction],
          ...state.discard[faction],
          ...state.removed[faction],
          ...state.retained_combat_cards[faction],
      ]);
      const additions = api.data.cards
          .filter((card) => card.faction === faction &&
          card.commitment === commitment &&
          !existing.has(card.id))
          .map((card) => card.id);
      state.decks[faction] = api.shuffle(state, [
          ...state.decks[faction],
          ...additions,
      ]);
  }

  function populateVeteranUpgradePool(state, faction) {
      const usageKey = `veteran_pool:${faction}`;
      if (state.usage_limits[usageKey])
          return;
      const targets = faction === api.CP
          ? { "component-108": 5, "component-107": 7 }
          : {
              "component-105": 3,
              "component-104": 4,
              "component-091": 2,
              "component-092": 4,
          };
      for (const [piece, target] of Object.entries(targets)) {
          let count = state.upgrade_pool[faction].filter((unit) => unit.piece === piece).length;
          while (count < target) {
              count += 1;
              state.upgrade_pool[faction].push({
                  id: `${faction}-veteran-${piece}-${count}`,
                  piece,
                  reduced: false,
                  rules_created: true,
              });
          }
      }
      state.usage_limits[usageKey] = 1;
  }

  function enterFactionAction(state, faction) {
      state.active = faction;
      state.state = "action_card";
      state.activations = {};
      state.ops = null;
      state.sr = null;
      state.action_state = {
          turn: state.turn,
          round: state.action_round,
          actor: faction,
          used_combat_cards: [],
      };
      state.action_start_control = {
          actor: faction,
          spaces: api.clone(state.control),
      };
  }

  function startActionRound(state) {
      api.clearUndo(state);
      api.clearCombatEvents(state, "action_round");
      api.refreshBesieged(state);
      state.phase = "行动阶段";
      state.action_round += 1;
      enterFactionAction(state, api.CP);
      for (const unit of state.units) {
          unit.moved = false;
          unit.attacked = false;
          unit.attack_eligible = false;
      }
      api.checkpoint(state, "action-round", `T${state.turn} AR${state.action_round}`);
      api.log(state, "");
      if (state.action_round === 1)
          api.log(state, ".h2 行动阶段");
      api.log(state, `.h3cp 行动轮 ${state.action_round}`);
  }

  function continueNextFactionAction(state) {
      // A unilateral undo is local to one player's current action.  Crossing
      // this boundary requires the existing mutual rollback workflow.
      api.clearUndo(state);
      if (state.active === api.CP) {
          if (state.action_round >= (api.data.title.action_rounds || 6)) {
              resolveFactionAttrition(state, api.CP);
              if (beginVoluntaryCleanup(state, api.CP, "ap_action"))
                  return;
          }
          enterFactionAction(state, api.AP);
          api.log(state, "");
          api.log(state, `.h3ap 行动轮 ${state.action_round}`);
          return;
      }
      api.cleanupEmptyFortifications(state);
      if (state.action_round < (api.data.title.action_rounds || 6))
          startActionRound(state);
      else if (checkVictory(state))
          return;
      else if (!api.beginFrontMoCommitmentReview(state) &&
          !api.beginMoPenaltyResolution(state))
          beginAttrition(state);
  }

  function nextFactionAction(state) {
      if (state.active === api.CP && api.beginSalientChoice(state))
          return;
      const warnings = state.supply_warnings;
      if (warnings?.owner === state.active &&
          Array.isArray(warnings.spaces) &&
          warnings.spaces.length) {
          state.pending_supply_warning_review = {
              owner: state.active,
              reviewer: api.other(state.active),
              return_phase: state.phase,
          };
          state.active = api.other(state.active);
          state.state = "review_supply_warnings";
          state.phase = "补给警告确认";
          api.log(state, `${api.factionRole(warnings.owner)}标记补给警告：${warnings.spaces
              .map((id) => api.spaceById[id]?.name || id)
              .join("、")}。`);
          return;
      }
      continueNextFactionAction(state);
  }

  function beginAttrition(state) {
      if (state.markers.somme) {
          if (state.control[state.markers.somme.space] === api.AP)
              api.adjustVp(state, -1);
          delete state.markers.somme;
      }
      const ohl = api.activeRule(state, "ohl");
      const usageKey = `ohl:${state.turn}`;
      const combatCards = state.discard.cp.filter((id) => api.cardById[id]?.combat_card);
      if (ohl?.discard_for_combat_card &&
          !state.usage_limits[usageKey] &&
          state.hands.cp.length &&
          combatCards.length) {
          state.pending_event = {
              card: 713,
              faction: api.CP,
              owner: api.CP,
              chooser: api.CP,
              kind: "ohl",
              operation: api.clone(ohl),
              stage: "discard",
              cards: state.hands.cp.slice(),
          };
          api.enterEventFlow(state);
          state.active = api.CP;
          state.phase = "德军最高统帅部";
          return;
      }
      resolveAttrition(state, [api.AP]);
  }

  function resolveFactionAttrition(state, faction) {
      api.updateSupply(state);
      const lost = state.units.filter((unit) => unit.faction === faction &&
          !unit.supplied && !unit.limited_supply && !unit.fort_limited_supply);
      for (const unit of lost) {
          if (api.isCombatUnit(unit)) {
              const removed = api.permanentlyRemoveOnMapUnit(state, unit.id, "attrition_out_of_supply");
              if (removed)
                  api.log(state, `断补损耗：${api.pieceById[removed.piece]?.name || removed.id}（永久移除）。`);
          }
          else
              api.eliminateUnit(state, unit.id, "断补损耗");
      }
      api.log(state, `${api.factionRole(faction)} 损耗结算：${lost.length} 个单位被消灭。`);
      return lost.length;
  }

  function resolveAttrition(state, factions = [api.CP, api.AP]) {
      state.phase = "损耗阶段";
      state.state = "automatic";
      state.active = api.NONE;
      for (const faction of factions)
          resolveFactionAttrition(state, faction);
      if (factions.includes(api.AP) &&
          beginVoluntaryCleanup(state, api.AP, "post_attrition"))
          return;
      finishAttritionPhases(state);
  }

  function finishAttritionPhases(state) {
      api.resolveSieges(state);
      applyWarStatusEntryTracks(state);
      api.resolveWarStatus(state);
      api.beginReplacement(state);
  }

  function voluntaryCleanupOptions(state, faction) {
      api.updateSupply(state);
      return {
          units: state.units
              .filter((unit) => unit.faction === faction && unit.fort_limited_supply)
              .map((unit) => unit.id),
          fortifications: Object.keys(state.fortifications).filter((space) => state.control[space] === faction && state.fortifications[space] > 0),
          trenches: Object.keys(state.trenches).filter((space) => state.control[space] === faction && state.trenches[space] > 0),
      };
  }

  function beginVoluntaryCleanup(state, faction, continuation) {
      const options = voluntaryCleanupOptions(state, faction);
      if (!Object.values(options).some((entries) => entries.length))
          return false;
      state.voluntary_cleanup = { faction, continuation };
      state.phase = "自愿清理";
      state.state = "voluntary_cleanup";
      state.active = faction;
      return true;
  }

  function finishVoluntaryCleanup(state) {
      const pending = state.voluntary_cleanup;
      if (!pending)
          throw new Error("No voluntary cleanup phase");
      state.voluntary_cleanup = null;
      if (pending.continuation === "ap_action") {
          enterFactionAction(state, api.AP);
          state.phase = "行动阶段";
          api.log(state, `T${state.turn} 行动轮 ${state.action_round}：协约国行动。`);
          return;
      }
      finishAttritionPhases(state);
  }

  function applyWarStatusEntryTracks(state) {
      const usageKey = `entry_tracks:${state.turn}`;
      if (state.usage_limits[usageKey])
          return;
      for (const status of Object.values(state.events))
          for (const adjustment of status?.recurring_entry_tracks || [])
              if (!adjustment.unless_event || !state.events[adjustment.unless_event])
                  state.entry_tracks[adjustment.track] = Math.max(0, (state.entry_tracks[adjustment.track] || 0) + adjustment.amount);
      state.usage_limits[usageKey] = 1;
  }

  function applyRecurringReinforcements(state) {
      const rule = api.activeRule(state, "aef_replacements");
      const usageKey = `aef_replacements:${state.turn}`;
      if (!rule || state.usage_limits[usageKey])
          return false;
      const created = rule.created || 0;
      const count = Math.min(rule.per_turn, Math.max(0, rule.maximum - created));
      const units = [];
      for (let index = 0; index < count; index++) {
          const unit = {
              id: `u${state.next_unit_id++}`,
              piece: rule.piece,
              reduced: false,
              tts_guid: null,
          };
          api.hydrateUnit(unit);
          units.push(unit);
      }
      rule.created = created + count;
      state.usage_limits[usageKey] = 1;
      if (state.turn >= rule.port_turn &&
          units.length &&
          aefPortSpaces(state, { units, index: 0, placements: [] }).length) {
          state.pending_event = {
              card: 646,
              faction: api.AP,
              owner: api.AP,
              chooser: api.AP,
              kind: "aef_replacements",
              stage: "place",
              units,
              index: 0,
              placements: [],
          };
          state.active = api.AP;
          api.enterEventFlow(state);
          return true;
      }
      for (const unit of units) api.normalizeOffMapUnit(unit);
      state.reserves.ap.push(...units);
      return false;
  }

  function aefPortSpaces(state, pending) {
      const unit = pending.units[pending.index];
      if (!unit)
          return [];
      return api.data.spaces
          .filter((space) => space.port &&
          state.control[space.id] === api.AP &&
          api.unitsAt(state, space.id, api.CP).length === 0)
          .filter((space) => {
          const existing = api.unitsAt(state, space.id, api.AP).filter((entry) => entry.type !== "hq").length;
          const staged = pending.placements.filter((entry) => entry.space === space.id).length;
          return existing + staged < 3;
      })
          .map((space) => space.id);
  }

  function finishAefReplacements(state, pending) {
      for (let index = 0; index < pending.units.length; index++) {
          const unit = pending.units[index];
          const placement = pending.placements[index];
          if (placement.destination === "reserve") {
              api.normalizeOffMapUnit(unit);
              state.reserves.ap.push(unit);
          }
          else {
              unit.location = placement.space;
              state.units.push(unit);
          }
      }
      state.pending_event = null;
      state.phase = "补员/升级";
      state.state = "replacement";
      state.active = api.CP;
      state.replacement_active = api.CP;
  }

  function hqReturnSpaces(state, hq) {
      const nationality = api.nationalityGroup(hq.nation);
      const reinforcement = api.cardSpecById[hq.reinforcement_card]?.operations?.find((operation) =>
          operation.type === "reinforcement" &&
          operation.restriction_scope === "generated_army_hq");
      return api.data.spaces
          .filter((space) => api.spaceCanActivate(state, space.id))
          .filter((space) => !reinforcement?.rebuild_theater ||
          api.theaterOf(space.id) === reinforcement.rebuild_theater)
          .filter((space) => state.control[space.id] === hq.faction)
          .filter((space) => api.stackLegal(state, space.id, hq))
          .filter((space) => api.unitsAt(state, space.id, hq.faction).some((unit) => api.isCombatUnit(unit) && api.nationalityGroup(unit.nation) === nationality))
          .map((space) => space.id);
  }

  function pendingReturnHq(state, pending) {
      const id = pending.queue[pending.index];
      return [...state.hq_turn_track.ap, ...state.hq_turn_track.cp].find((unit) => unit.id === id);
  }

  function beginHqReturns(state) {
      const queue = [...state.hq_turn_track.cp, ...state.hq_turn_track.ap]
          .filter((hq) => (hq.due_turn || 0) <= state.turn)
          .filter((hq) => hqReturnSpaces(state, hq).length)
          .map((hq) => hq.id);
      if (!queue.length)
          return false;
      const first = [...state.hq_turn_track.ap, ...state.hq_turn_track.cp].find((unit) => unit.id === queue[0]);
      state.pending_event = {
          kind: "hq_return",
          owner: first.faction,
          queue,
          index: 0,
      };
      state.active = first.faction;
      api.enterEventFlow(state);
      return true;
  }

  function placeReturningHq(state, pending, space) {
      const hq = pendingReturnHq(state, pending);
      if (!hq || !hqReturnSpaces(state, hq).includes(space))
          throw new Error("Illegal HQ return space");
      const pool = state.hq_turn_track[hq.faction];
      pool.splice(pool.findIndex((unit) => unit.id === hq.id), 1);
      delete hq.due_turn;
      hq.location = space;
      hq.moved = false;
      hq.attacked = false;
      state.units.push(hq);
      pending.index += 1;
      if (pending.index < pending.queue.length) {
          const next = pendingReturnHq(state, pending);
          pending.owner = next.faction;
          state.active = next.faction;
          return;
      }
      state.pending_event = null;
      state.phase = "补员/升级";
      state.state = "replacement";
      state.active = api.CP;
      state.replacement_active = api.CP;
      api.continueReplacement(state);
  }

  function beginBulgariaFrontResponse(state) {
      const rule = api.activeRule(state, "bulgaria");
      const usageKey = `bulgaria_front:${state.turn}`;
      if (!rule ||
          !api.turkishFrontActive(state) ||
          state.turn_flags.turkish_front_advanced !== state.turn ||
          state.usage_limits[usageKey] ||
          state.fronts.turkish <= 0 ||
          state.rp.cp.ge < 1)
          return false;
      state.pending_event = {
          card: 725,
          faction: api.CP,
          owner: api.CP,
          chooser: api.CP,
          kind: "bulgaria_front_response",
          usage_key: usageKey,
      };
      state.phase = "保加利亚战线响应";
      api.enterEventFlow(state);
      state.active = api.CP;
      return true;
  }

  function beginDrawPhase(state) {
      state.phase = "抽牌";
      const queue = [api.CP, api.AP].filter((faction) => state.hands[faction].some((id) => api.cardById[id]?.combat_card));
      if (queue.length) {
          state.draw_discard = { queue, index: 0 };
          state.state = "draw_discard";
          state.active = queue[0];
          return;
      }
      finishDrawPhase(state);
  }

  function finishDrawDiscard(state) {
      if (!state.draw_discard)
          throw new Error("No combat-card discard phase");
      state.draw_discard.index += 1;
      if (state.draw_discard.index < state.draw_discard.queue.length) {
          state.active = state.draw_discard.queue[state.draw_discard.index];
          return;
      }
      state.draw_discard = null;
      finishDrawPhase(state);
  }

  function finishDrawPhase(state) {
      state.phase = "抽牌";
      state.state = "automatic";
      state.active = api.NONE;
      discardRetainedCombatCards(state);
      for (const faction of [api.AP, api.CP]) {
          drawCards(state, faction);
      }
      applyEndTurnVp(state);
      api.clearCombatEvents(state, "turn");
      if (checkVictory(state))
          return;
      state.turn += 1;
      state.action_round = 0;
      state.last_action_use = { ap: null, cp: null };
      state.reinforcement_events_this_turn = { ap: [], cp: [] };
      api.checkpoint(state, "turn", `T${state.turn}`);
      if (beginScheduledReturns(state))
          return;
      beginMoPhase(state);
  }

  function beginMoPhase(state) {
      for (const [event, status] of Object.entries(state.events)) {
          const card = api.data.cards.find((candidate) => candidate.event === event);
          const rule = status?.rule || (card && api.ruleModifier(card));
          if (rule?.key === "desertion" && state.turn >= rule.cancel_turn)
              delete state.events[event];
      }
      api.drawMo(state);
      state.phase = "强制进攻";
      state.state = "mo_review";
      state.active = api.CP;
  }

  function beginScheduledReturns(state) {
      const bulgaria = state.scheduled_events.find((entry) => entry.kind === "bulgaria_choice" && entry.due_turn <= state.turn);
      if (bulgaria) {
          state.pending_event = {
              card: bulgaria.source_card,
              faction: api.AP,
              owner: api.AP,
              chooser: api.AP,
              kind: "bulgaria_choice",
              schedule: api.clone(bulgaria),
              mode: null,
          };
          state.phase = "保加利亚后续";
          api.enterEventFlow(state);
          state.active = api.AP;
          return true;
      }
      const cards = state.scheduled_events.filter((entry) => entry.kind === "card_return" && entry.due_turn <= state.turn);
      for (const entry of cards)
          if (!state.hands[entry.faction].includes(entry.card))
              state.hands[entry.faction].push(entry.card);
      if (cards.length)
          state.scheduled_events = state.scheduled_events.filter((entry) => !(entry.kind === "card_return" && entry.due_turn <= state.turn));
      const adjustments = state.scheduled_events.filter((entry) => entry.kind === "rp_adjustment" && entry.due_turn <= state.turn);
      for (const entry of adjustments)
          for (const [faction, nations] of Object.entries(entry.adjustments || {}))
              for (const [nation, amount] of Object.entries(nations))
                  state.rp[faction][nation] = Math.max(0, (state.rp[faction][nation] || 0) - amount);
      if (adjustments.length)
          state.scheduled_events = state.scheduled_events.filter((entry) => !(entry.kind === "rp_adjustment" && entry.due_turn <= state.turn));
      const due = state.scheduled_events.filter((entry) => entry.kind === "return_units" && entry.due_turn <= state.turn);
      if (!due.length)
          return false;
      const faction = due[0].faction;
      const entries = due.filter((entry) => entry.faction === faction);
      const units = entries.flatMap((entry) => entry.units);
      state.pending_event = {
          card: entries[0].source_card,
          faction,
          owner: faction,
          chooser: faction,
          kind: "scheduled_return",
          operation: { placement: entries[0].placement },
          queue: units.map((unit, index) => ({
              id: unit.id,
              piece: unit.piece,
              reduced: unit.reduced,
              definition_index: index,
              copy_index: 0,
              reserve_optional: entries[0].placement === "normal_reinforcement" &&
                  unit.type === "corps",
          })),
          index: 0,
          placements: [],
          return_units: api.clone(units),
          schedule_cards: entries.map((entry) => entry.source_card),
      };
      state.phase = "延迟增援";
      api.enterEventFlow(state);
      state.active = faction;
      api.log(state, `${api.factionRole(faction)} 部署本回合返场单位。`);
      return true;
  }

  function bulgariaChoiceCandidates(state, pending = state.pending_event) {
      return state.units
          .filter((unit) => unit.faction === api.AP &&
          unit.nation === pending.schedule.remove_nation &&
          unit.type === pending.schedule.remove_type)
          .map((unit) => unit.id);
  }

  function finishBulgariaChoice(state, pending) {
      const schedule = pending.schedule;
      const index = state.scheduled_events.findIndex((entry) => entry.kind === "bulgaria_choice" &&
          entry.source_card === schedule.source_card &&
          entry.due_turn === schedule.due_turn);
      if (index >= 0)
          state.scheduled_events.splice(index, 1);
      state.pending_event = null;
      if (!beginScheduledReturns(state))
          beginMoPhase(state);
  }

  function commitScheduledReturns(state, pending) {
      for (let index = 0; index < pending.return_units.length; index++) {
          const unit = pending.return_units[index];
          const placement = pending.placements[index];
          if (placement.destination === "reserve") {
              api.normalizeOffMapUnit(unit);
              state.reserves[unit.faction].push(unit);
          }
          else {
              unit.location = placement.space;
              unit.moved = false;
              unit.attacked = false;
              state.units.push(unit);
          }
      }
      const cards = new Set(pending.schedule_cards);
      state.scheduled_events = state.scheduled_events.filter((entry) => !(entry.kind === "return_units" &&
          entry.due_turn <= state.turn &&
          cards.has(entry.source_card)));
      state.pending_event = null;
      if (!beginScheduledReturns(state))
          beginMoPhase(state);
  }

  function applyEndTurnVp(state) {
      const blockade = api.activeRule(state, "channel_blockade");
      const jutland = api.activeRule(state, "jutland");
      if (blockade &&
          blockade.turns.includes(state.turn) &&
          !(jutland?.suppress_blockade_vp &&
              state.events[api.cardById[755].event]?.turn === state.turn))
          api.adjustVp(state, blockade.periodic_vp);
  }

  function finalTerritoryVp(state) {
      const controlledCount = (nation, faction) => api.data.spaces.filter((space) => space.nation === nation && state.control[space.id] === faction).length;
      const french = controlledCount("fr", api.CP);
      let vp = 0;
      for (const [minimum, award] of [
          [23, 5],
          [19, 4],
          [15, 3],
          [10, 2],
          [6, 1],
      ])
          if (french >= minimum) {
              vp += award;
              break;
          }
      if (controlledCount("it", api.CP) >= 6)
          vp += 1;
      if (controlledCount("be", api.AP) >= 3)
          vp -= 1;
      if (controlledCount("ah", api.AP) >= 2)
          vp -= 1;
      if (controlledCount("ge", api.AP) >= 3)
          vp -= 1;
      if (state.naval.track <= -2)
          vp -= 1;
      return vp;
  }

  function cpArmyNearParis(state) {
      const targets = new Set(state.units
          .filter((unit) => unit.faction === api.CP && unit.type === "army")
          .map((unit) => unit.location));
      if (!targets.size) return false;
      const seen = new Set(["paris"]);
      let frontier = ["paris"];
      for (let distance = 0; distance <= 2; distance++) {
          if (frontier.some((space) => targets.has(space))) return true;
          if (distance === 2) break;
          const next = [];
          for (const space of frontier)
              for (const neighbor of api.landNeighbors(space))
                  if (!seen.has(neighbor)) {
                      seen.add(neighbor);
                      next.push(neighbor);
                  }
          frontier = next;
      }
      return false;
  }

  function checkVictory(state, options = {}) {
      const armisticeThreshold = 40 + Number(state.entry_tracks?.armistice || 0);
      if ((state.war_status?.combined || 0) >= armisticeThreshold)
          return gameOver(state, state.vp > 10 ? api.CP : api.AP,
              `停战协议：VP ${state.vp}`);
      if (options.armisticeOnly || state.turn < 15)
          return false;
      let endVp = Object.entries(state.events).reduce((sum, [event, status]) => sum + (status?.end_vp || api.data.events[event]?.end_vp || 0), 0);
      const burgfrieden = api.activeRule(state, "burgfrieden");
      if (burgfrieden && state.events[api.cardById[burgfrieden.canceled_by_card].event])
          endVp += burgfrieden.end_vp_after_cancel;
      for (const marker of state.markers.salients || [])
          if (state.control[marker.space] === api.CP)
              endVp += 1;
      const hindenburg = api.activeRule(state, "hindenburg_line");
      endVp +=
          (state.markers.hindenburg || []).length *
              (hindenburg?.end_vp_per_marker || 0);
      endVp += finalTerritoryVp(state);
      if (cpArmyNearParis(state)) endVp += 1;
      if (state.campaign_flags?.paris_attacked) endVp += 1;
      const finalVp = state.vp + endVp;
      const winner = finalVp > 10 ? api.CP : api.AP;
      return gameOver(state, winner, `第15回合终局：VP ${finalVp}`);
  }

  function gameOver(state, winner, reason) {
      state.state = "game_over";
      state.phase = "游戏结束";
      state.active = api.NONE;
      state.result = api.factionRole(winner);
      state.victory = reason;
      api.log(state, reason);
      return true;
  }
return Object.freeze({
    activeCombatCardIds,
    addCommitmentCards,
    aefPortSpaces,
    applyEndTurnVp,
    applyRecurringReinforcements,
    applyWarStatusEntryTracks,
    beginAttrition,
    beginBulgariaFrontResponse,
    beginDrawPhase,
    beginHqReturns,
    beginMoPhase,
    beginScheduledReturns,
    beginVoluntaryCleanup,
    bulgariaChoiceCandidates,
    cardIds,
    checkVictory,
    commitScheduledReturns,
    continueNextFactionAction,
    discardRetainedCombatCards,
    drawCards,
    finalTerritoryVp,
    finishAefReplacements,
    finishAttritionPhases,
    finishBulgariaChoice,
    finishDrawDiscard,
    finishDrawPhase,
    finishVoluntaryCleanup,
    gameOver,
    hqReturnSpaces,
    nextFactionAction,
    openingCardCandidates,
    pendingReturnHq,
    placeReturningHq,
    populateVeteranUpgradePool,
    resolveAttrition,
    resolveFactionAttrition,
    setupDeck,
    selectOpeningCard,
    skipAugustGuns,
    startActionRound,
    voluntaryCleanupOptions,
  });
}

module.exports = { createTurnSystem };
