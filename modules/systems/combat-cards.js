"use strict";

function createCombatCardSystem(api) {
  function combatCardUsedThisAction(state, id) {
      return Boolean(state.action_state?.used_combat_cards?.includes(Number(id)));
  }

  function markCombatCardUsed(state, id) {
      state.action_state ||= {
          turn: state.turn,
          round: state.action_round,
          actor: state.combat_window?.attacker || state.active,
          used_combat_cards: [],
      };
      state.action_state.used_combat_cards ||= [];
      id = Number(id);
      if (!state.action_state.used_combat_cards.includes(id))
          state.action_state.used_combat_cards.push(id);
  }

  function unmarkCombatCardUsed(state, id) {
      if (!state.action_state?.used_combat_cards)
          return;
      state.action_state.used_combat_cards = state.action_state.used_combat_cards
          .filter((entry) => entry !== Number(id));
  }
  function combatCardOwner(state, cardOrId) {
    const card = typeof cardOrId === "object" ? cardOrId : api.cardById[Number(cardOrId)];
    return state.card_owners?.[card?.id] || card?.faction || null;
  }

  function removeCardEverywhere(state, id) {
    for (const faction of [api.AP, api.CP])
      for (const pool of [
        state.hands[faction], state.decks[faction], state.discard[faction],
        state.removed[faction], state.retained_combat_cards[faction],
      ]) {
        let index;
        while ((index = pool.indexOf(id)) >= 0) pool.splice(index, 1);
      }
  }

  function combatCardDisposition(state, card) {
      const disposition = api.effectiveCombatEffect(state, card)?.disposition || null;
      const effect = api.effectiveCombatEffect(state, card);
      if (effect?.force_discard)
          return { ...(disposition || {}), after_combat: "discard", retain_on_win: false, win_draw: null };
    if (effect?.transfer_after_use)
      return { ...(disposition || {}), after_combat: "transfer", retain_on_win: false, win_draw: null };
    if (effect?.remove_if_opponent_total &&
        state.commitment[api.other(combatCardOwner(state, card))] === "total")
      return { ...(disposition || {}), after_combat: "remove", retain_on_win: false, win_draw: null };
    if (disposition && api.cardUseDisposition(state, card, "combat") === "remove")
      return { ...disposition, after_combat: "remove", retain_on_win: false, win_draw: null };
    return disposition;
  }

  function combatWinner(combat) {
    if (!combat || combat.attack_loss === combat.defense_loss) return null;
    return combat.defense_loss > combat.attack_loss
      ? combat.attacker
      : api.other(combat.attacker);
  }

  

  function removeCardFromPublicPools(state, faction, id) {
      for (const pool of [
          state.discard[faction],
          state.removed[faction],
          state.retained_combat_cards[faction],
      ]) {
          const index = pool.indexOf(id);
          if (index >= 0)
              pool.splice(index, 1);
      }
  }

  function placeCombatCard(state, faction, id, destination) {
      removeCardFromPublicPools(state, faction, id);
      const pool = destination === "remove"
          ? state.removed[faction]
          : destination === "retain"
              ? state.retained_combat_cards[faction]
              : state.discard[faction];
      if (!pool.includes(id))
          pool.push(id);
  }

  function revealCommittedCombatCards(state) {
      const window = state.combat_window;
      if (!window || window.cards_revealed)
          return;
      api.clearUndo(state);
      for (const id of window.cards || []) {
          const card = api.cardById[id];
          const owner = window.card_owners?.[id] || combatCardOwner(state, card);
          const disposition = combatCardDisposition(state, card);
          placeCombatCard(state, owner, id,
              disposition?.after_combat === "remove" ? "remove" : "discard");
      }
      window.cards_revealed = true;
  }

  function prepareCombatCardDispositions(state, combat) {
      if (combat.card_dispositions_prepared)
          return Boolean(state.pending_combat_card_disposition);
      combat.card_dispositions_prepared = true;
      const winner = combatWinner(combat);
      const tied = !winner;
      const optional = [];
      for (const played of combat.played_cards || []) {
          const card = api.cardById[played.id];
          const spec = api.cardSpecById[played.id] || {};
          const effect = api.effectiveCombatEffect(state, card);
          const disposition = combatCardDisposition(state, card);
          if (!card || !disposition)
              continue;
          const owner = played.faction || combatCardOwner(state, card);
          if (disposition.after_combat === "transfer") {
              removeCardEverywhere(state, card.id);
              if (effect.remove_if_any_total &&
                  [api.AP, api.CP].some((side) => state.commitment[side] === "total")) {
                  state.removed[owner].push(card.id);
                  api.log(state, `[[card:${card.id}]]永久移除。`);
              }
              else {
                  const recipient = api.other(owner);
                  state.card_owners ||= {};
                  state.card_owners[card.id] = recipient;
                  state.decks[recipient] = api.shuffle(state, [...state.decks[recipient], card.id]);
                  api.log(state, `[[card:${card.id}]]洗入${api.factionRole(recipient)}牌库。`);
              }
              continue;
          }
          if (played.canceled) {
              placeCombatCard(state, owner, card.id,
                  disposition.after_combat === "remove" ? "remove" : "discard");
              continue;
          }
          if (disposition.after_combat === "remove") {
              placeCombatCard(state, owner, card.id, "remove");
              continue;
          }
          if ((spec.duration || "combat") !== "combat")
              continue;
          const ownerWon = winner === owner;
          const drawEligible = ownerWon || (tied && effect.draw_on_non_loss);
          if (disposition.win_draw === "mandatory" && drawEligible) {
              placeCombatCard(state, owner, card.id, "discard");
              api.drawCards(state, owner, state.hands[owner].length + 1);
              api.log(state, `[[card:${card.id}]] 弃置并抽取一张牌。`);
              continue;
          }
          if (!ownerWon || disposition.after_combat === "discard") {
              placeCombatCard(state, owner, card.id, "discard");
              continue;
          }
          if (disposition.win_draw === "optional") {
              optional.push(card.id);
              continue;
          }
          if (disposition.retain_on_win) {
              placeCombatCard(state, owner, card.id, "retain");
              api.log(state, `[[card:${card.id}]] 由胜方保留。`);
          }
      }
      if (!optional.length)
          return false;
      state.pending_combat_card_disposition = {
          cards: optional,
          index: 0,
          owner: winner,
      };
      api.setActiveFaction(state, winner);
      state.state = "combat_card_disposition";
      return true;
  }

  function resolveCombatCardDisposition(state, id, choice) {
      const pending = state.pending_combat_card_disposition;
      const expected = pending?.cards?.[pending.index];
      id = Number(id);
      if (!pending || id !== expected || state.active !== pending.owner)
          throw new Error("Invalid combat-card disposition");
      const card = api.cardById[id];
      if (choice === "retain") {
          placeCombatCard(state, card.faction, id, "retain");
          api.log(state, `[[card:${id}]] 由胜方保留。`);
      }
      else {
          placeCombatCard(state, card.faction, id, "discard");
          api.drawCards(state, card.faction, state.hands[card.faction].length + 1);
          api.log(state, `[[card:${id}]] 弃置并抽取一张牌。`);
      }
      pending.index += 1;
      if (pending.index < pending.cards.length)
          return;
      state.pending_combat_card_disposition = null;
      state.state = "combat_losses";
      api.setActiveFaction(state, state.combat?.pending_side || state.active);
      api.finishCombatLosses(state);
  }

  function combatCardIds(state) {
      const ids = new Set(state.combat_window?.cards || []);
      for (const [event, status] of Object.entries(state.events))
          if (status) {
              const card = api.data.cards.find((candidate) => candidate.event === event);
              const lifetime = status.expires || status.duration;
              if (card &&
                  api.cardSpecById[card.id]?.combat &&
                  ["combat", "action_round", "turn"].includes(lifetime))
                  ids.add(card.id);
          }
      const canceledEvents = new Set([...ids]
          .map((id) => api.cardSpecById[id]?.combat?.cancel_event)
          .filter(Boolean));
      return [...ids].filter((id) => !canceledEvents.has(api.cardById[id]?.event));
  }

  function startCombatCardCommitments(state) {
      if (!state.combat_window)
          throw new Error("No pending combat");
      state.combat_window.declaration.defense_mo_assignments = api.clone(state.combat_window.defense_mo_assignments || {});
      api.setActiveFaction(state, state.combat_window.attacker);
      state.combat_window.side = state.active;
      state.state = "combat_card_window";
      api.log(state, "战斗牌窗口：进攻方先承诺战斗牌。");
  }

  function openCombatCardWindow(state, declaration) {
      declaration = {
          ...declaration,
          attack_origin: declaration.attack_origin || { kind: "normal", source: null },
      };
      const attackers = declaration.attackers || [];
      const target = declaration.target;
      const attackingUnits = attackers
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(Boolean);
      if (!attackingUnits.length ||
          attackingUnits.some((unit) => unit.faction !== state.active))
          throw new Error("Invalid attackers");
      if (!attackingUnits.every((unit) => api.attacksTarget(state, unit, target)))
          throw new Error("Attacker is not adjacent");
      if (!api.unitsAt(state, target, api.other(state.active)).some(api.isCombatUnit) &&
          !api.intactFort(state, target))
          throw new Error("No defender");
      state.combat_window = {
          declaration: api.clone(declaration),
          attacker: state.active,
          defender: api.other(state.active),
          side: state.active,
          cards: [],
          card_sources: {},
          defense_mo_assignments: {},
          defense_mo_decisions: {},
      };
      if (api.defenseMoChoices(state).length) {
          api.setActiveFaction(state, state.combat_window.defender);
          state.combat_window.side = state.active;
          state.state = "defense_mo";
          api.log(state, "防守方选择本次战斗使用的强制进攻标记。");
          return;
      }
      return startCombatCardCommitments(state);
  }

  function playCombatCard(state, id) {
      const card = api.cardById[Number(id)];
      const owner = combatCardOwner(state, card);
      const hand = state.hands[state.active];
      const index = hand.indexOf(Number(id));
      const retained = state.retained_combat_cards[state.active];
      const retainedIndex = retained.indexOf(Number(id));
      const cambrai = state.active === api.AP &&
          state.events[api.cardById[638].event] &&
          !state.combat_window.discard_card_used;
      const discardIndex = cambrai ? state.discard.ap.indexOf(Number(id)) : -1;
      if ((index < 0 && retainedIndex < 0 && discardIndex < 0) ||
          !combatCardLegal(state, card))
          throw new Error("Invalid combat card");
      let source = "hand";
      if (index >= 0)
          hand.splice(index, 1);
      else if (retainedIndex >= 0) {
          retained.splice(retainedIndex, 1);
          source = "retained";
      }
      else {
          state.discard.ap.splice(discardIndex, 1);
          state.combat_window.discard_card_used = true;
          source = "discard";
      }
      markCombatCardUsed(state, card.id);
      const effect = api.effectiveCombatEffect(state, card);
      if (effect.remove_piece_before_combat)
          api.permanentlyRemovePiece(state, effect.remove_piece_before_combat, card.id);
      if (effect.cancel_event) {
          delete state.events[effect.cancel_event];
          state.combat_window.canceled_cards ||= [];
          for (const otherId of state.combat_window.cards) {
              if (api.cardById[otherId]?.event === effect.cancel_event &&
                  !state.combat_window.canceled_cards.includes(otherId))
                  state.combat_window.canceled_cards.push(otherId);
          }
      }
      if (effect.cancel_current_event_before_total &&
          state.commitment[api.other(owner)] !== "total") {
          state.combat_window.canceled_cards ||= [];
          for (const otherId of state.combat_window.cards)
              if (api.cardById[otherId]?.event === effect.cancel_current_event_before_total &&
                  !state.combat_window.canceled_cards.includes(otherId))
                  state.combat_window.canceled_cards.push(otherId);
          delete state.events[effect.cancel_current_event_before_total];
      }
      if (effect.persistent_prohibition_before_total &&
          state.commitment[api.other(owner)] !== "total")
          state.events["cp_福克灾难_禁用空中优势"] = {
              turn: state.turn,
              faction: owner,
              persistent: true,
              duration: "until_ap_total",
              prohibits_card: effect.persistent_prohibition_before_total,
          };
      if (effect.ignore_trench)
          returnCommittedTrenchCards(state);
      for (const operation of api.cardSpecById[card.id]?.operations || [])
          if (operation.type === "mo_modify")
              api.applyMoModification(state, card, operation);
      if (effect.rp)
          for (const [nation, amount] of Object.entries(effect.rp)) {
              const faction = ["ge", "ah", "east"].includes(nation) ? api.CP : api.AP;
              state.rp[faction][nation] = Math.max(0, (state.rp[faction][nation] || 0) + amount);
          }
      if (card.printed_marker) {
          const key = `combat_printed_marker:${card.id}`;
          api.applyPrintedWarStatus(state, card, Boolean(state.usage_limits[key]));
          state.usage_limits[key] = (state.usage_limits[key] || 0) + 1;
      }
      if (effect.choice?.includes("restore_before")) {
          const restoreSide = effect.restore_side || card.faction;
          for (const unit of state.units)
              if (unit.faction === restoreSide &&
                  (state.combat_window.declaration.attackers.includes(unit.id) ||
                      unit.location === state.combat_window.declaration.target))
                  unit.reduced = false;
      }
      state.combat_window.cards.push(card.id);
      state.combat_window.card_sources ||= {};
      state.combat_window.card_sources[card.id] = source;
      state.combat_window.card_owners ||= {};
      state.combat_window.card_owners[card.id] = owner;
      const duration = api.cardSpecById[card.id]?.duration || "combat";
      state.events[card.event] = {
          turn: state.turn,
          round: state.action_round,
          faction: owner,
          combat_card: true,
          expires: duration,
      };
      api.log(state, `${api.factionRole(state.active)} 战斗牌：[[card:${card.id}]]。`);
      if (effect.optional_hq_reinforcement) {
          const pending = {
              kind: "combat_hq_reinforcement",
              card: card.id,
              owner: card.faction,
              piece: effect.optional_hq_reinforcement.piece,
              resume_side: state.combat_window.side,
          };
          if (combatHqReinforcementSpaces(state, pending).length) {
              state.pending_event = pending;
              api.enterEventFlow(state);
          }
      }
      if (effect.first_use_hq &&
          !state.usage_limits[`combat_card_first:${card.id}`]) {
          state.combat_window.pending_hq_reinforcement = {
              kind: "combat_hq_reinforcement",
              card: card.id,
              owner,
              piece: effect.first_use_hq.piece,
              placement: owner === state.combat_window.attacker
                  ? effect.first_use_hq.attack_placement
                  : effect.first_use_hq.defense_placement,
              required: Boolean(effect.first_use_hq.required),
              resume: "resolve",
          };
      }
  }

  function returnCommittedTrenchCards(state) {
      const cards = (state.combat_window?.cards || []).filter((id) =>
          api.cardSpecById[id]?.combat?.requires_trench);
      for (const id of cards) {
          const card = api.cardById[id];
          const owner = state.combat_window.card_owners?.[id] || combatCardOwner(state, card);
          const source = state.combat_window.card_sources?.[id] || "hand";
          removeCardFromPublicPools(state, owner, id);
          if (source === "retained")
              state.retained_combat_cards[owner].push(id);
          else if (source === "discard")
              state.discard[owner].push(id);
          else
              state.hands[owner].push(id);
          state.combat_window.cards = state.combat_window.cards.filter((entry) => entry !== id);
          delete state.combat_window.card_sources?.[id];
          delete state.combat_window.card_owners?.[id];
          delete state.events[card.event];
          unmarkCombatCardUsed(state, id);
          api.log(state, `${api.factionRole(owner)}一张需要战壕的战斗牌退回原来源。`);
      }
  }

  function combatPieceExists(state, piece) {
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

  function combatHqReinforcementSpaces(state, pending = state.pending_event) {
      const window = state.combat_window;
      if (pending?.kind !== "combat_hq_reinforcement" || !window ||
          combatPieceExists(state, pending.piece))
          return [];
      const attackers = window.declaration.attackers
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter((unit) => unit && api.isCombatUnit(unit));
      const piece = api.pieceById[pending.piece];
      const candidate = {
          id: "combat-hq-reinforcement",
          piece: pending.piece,
          faction: piece?.faction,
          nation: piece?.nation,
          type: piece?.type,
      };
      if (pending.placement === "target") {
          const target = window.declaration.target;
          const defenders = api.unitsAt(state, target, window.defender)
              .filter(api.isCombatUnit);
          return defenders.some((unit) =>
              api.nationalityGroup(unit.nation) === api.nationalityGroup(piece?.nation)) &&
              api.stackLegal(state, target, candidate)
              ? [target]
              : [];
      }
      if (window.attacker !== pending.owner)
          return [];
      const origins = [...new Set(attackers.map((unit) => unit.location))];
      return origins.filter((space) =>
          attackers.some((unit) => unit.location === space &&
              api.nationalityGroup(unit.nation) === api.nationalityGroup(piece?.nation)) &&
          api.stackLegal(state, space, candidate));
  }

  function resolveCombatHqReinforcement(state, space = null) {
      const pending = state.pending_event;
      if (pending?.kind !== "combat_hq_reinforcement")
          throw new Error("No combat HQ reinforcement is pending");
      if (space !== null) {
          if (!combatHqReinforcementSpaces(state, pending).includes(space))
              throw new Error("Illegal combat HQ reinforcement origin");
          const unit = {
              id: `u${state.next_unit_id++}`,
              piece: pending.piece,
              location: space,
              reduced: false,
              moved: false,
              attacked: false,
              tts_guid: null,
          };
          api.hydrateUnit(unit);
          state.units.push(unit);
          if (pending.placement !== "target")
              state.combat_window.declaration.attackers.push(unit.id);
          api.log(state, `[[unit:${unit.id}]]部署到[[space:${space}]]并参加战斗。`);
      }
      state.pending_event = null;
      if (pending.resume === "resolve") {
          api.setActiveFaction(state, state.combat_window.attacker);
          api.resolveCombat(state, state.combat_window.declaration);
          return;
      }
      api.setActiveFaction(state, pending.resume_side);
      state.combat_window.side = pending.resume_side;
      state.state = "combat_card_window";
  }

  function passCombatCard(state) {
      if (state.active === state.combat_window.attacker) {
          api.setActiveFaction(state, state.combat_window.defender);
          state.combat_window.side = state.active;
          api.log(state, "防御方承诺战斗牌。");
          return;
      }
      api.setActiveFaction(state, state.combat_window.attacker);
      revealCommittedCombatCards(state);
      for (const id of state.combat_window.cards || []) {
          if ((state.combat_window.canceled_cards || []).includes(id))
              continue;
          const effect = api.effectiveCombatEffect(state, api.cardById[id]);
          const unlock = effect.first_reveal_unlock_mo;
          if (!unlock)
              continue;
          const owner = state.combat_window.card_owners?.[id] ||
              combatCardOwner(state, api.cardById[id]);
          state.events[unlock.event] ||= {
              turn: state.turn,
              faction: owner,
              persistent: true,
              duration: "game",
              unlock_mo: unlock.id,
          };
      }
      const reinforcement = state.combat_window.pending_hq_reinforcement;
      if (reinforcement) {
          delete state.combat_window.pending_hq_reinforcement;
          state.usage_limits[`combat_card_first:${reinforcement.card}`] = 1;
          if (!combatPieceExists(state, reinforcement.piece)) {
              const spaces = combatHqReinforcementSpaces(state, reinforcement);
              if (!spaces.length && reinforcement.required)
                  throw new Error("Required combat HQ reinforcement has no legal space");
              if (spaces.length) {
                  reinforcement.resume_side = state.combat_window.attacker;
                  state.pending_event = reinforcement;
                  api.setActiveFaction(state, reinforcement.owner);
                  api.enterEventFlow(state);
                  return;
              }
          }
      }
      const declaration = state.combat_window.declaration;
      api.resolveCombat(state, declaration);
  }

  function combatCardLegal(state, card) {
      const owner = combatCardOwner(state, card);
      if (!card?.combat_card ||
          owner !== state.active ||
          !state.combat_window)
          return false;
      if (combatCardUsedThisAction(state, card.id))
          return false;
      if (state.combat_window.prohibit_combat_cards)
          return false;
      const effect = api.effectiveCombatEffect(state, card);
      if (effect.after_defense)
          return false;
      if (effect.forbidden_by_event && state.events[effect.forbidden_by_event])
          return false;
      const declaration = state.combat_window.declaration;
      const attackers = (declaration.attackers || [])
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(Boolean);
      const defenders = api.unitsAt(state, declaration.target, state.combat_window.defender).filter(api.isCombatUnit);
      if (effect.attacker_nations_any?.length &&
          !attackers.some((unit) => api.isCombatUnit(unit) &&
              effect.attacker_nations_any.includes(unit.nation)))
          return false;
      const terrain = api.spaceById[declaration.target]?.terrain;
      if (card.id === 621 && state.commitment.ap !== "total" &&
          state.events["cp_福克灾难_禁用空中优势"])
          return false;
      if (state.active === state.combat_window.defender && !defenders.length)
          return false;
      const cancelsCommittedCard = effect.cancel_current_event_before_total &&
          state.combat_window.cards.some((otherId) =>
              api.cardById[otherId]?.event === effect.cancel_current_event_before_total);
      if (!api.combatEffectEligible(state, effect, declaration, attackers, defenders) &&
          !cancelsCommittedCard)
          return false;
      if (effect.required_attacker_faction &&
          state.combat_window.attacker !== effect.required_attacker_faction) {
          if (!cancelsCommittedCard)
              return false;
      }
      if (effect.required_defender_faction &&
          state.combat_window.defender !== effect.required_defender_faction)
          return false;
      if (effect.dynamic_owner && owner !== state.combat_window.attacker)
          return false;
      if (effect.defender_only && owner !== state.combat_window.defender)
          return false;
      if (effect.cancel_non_event_attack && declaration.attack_origin?.kind === "event")
          return false;
      if (effect.retreat_choice &&
          (owner !== state.combat_window.defender ||
              state.combat_window.attacker !== api.CP))
          return false;
      if (effect.requires_commitment &&
          state.commitment[owner] !== effect.requires_commitment)
          return false;
      if (effect.requires_trench && !(state.trenches[declaration.target] > 0))
          return false;
      if (effect.requires_trench &&
          state.combat_window.cards.some((id) => api.cardSpecById[id]?.combat?.ignore_trench))
          return false;
      if (effect.terrain?.length && !effect.terrain.includes(terrain))
          return false;
      if (effect.terrain_or_adjacent?.length &&
          !effect.terrain_or_adjacent.includes(terrain) &&
          !api.landNeighbors(declaration.target).some((space) =>
              effect.terrain_or_adjacent.includes(api.spaceById[space]?.terrain)))
          return false;
      if (effect.attacker_army_nations_any?.length &&
          !attackers.some((unit) => api.isCombatUnit(unit) && unit.type === "army" &&
              effect.attacker_army_nations_any.includes(unit.nation)))
          return false;
      if (effect.defender_nations_all?.length &&
          (!defenders.length || defenders.some((unit) =>
              !effect.defender_nations_all.includes(unit.nation))))
          return false;
      if (effect.target_nation &&
          api.spaceById[declaration.target]?.nation !== effect.target_nation)
          return false;
      if (effect.attacker_nation &&
          !attackers.some((unit) => unit.nation === effect.attacker_nation))
          return false;
      if (effect.defender_nation &&
          !defenders.some((unit) => unit.nation === effect.defender_nation))
          return false;
      if (effect.italian_front_only &&
          api.theaterOf(declaration.target) !== "italian")
          return false;
      if (effect.requires_target_fort && !api.spaceById[declaration.target]?.fort)
          return false;
      if (state.combat_window.cards.some((id) =>
          api.cardSpecById[id]?.combat?.cancel_event === card.event))
          return false;
      if (effect.cancel_event && !state.events[effect.cancel_event])
          return false;
      if (effect.counterattack &&
          (state.combat_window.attacker !== api.CP ||
              !attackers.some((unit) => unit.nation === "ge") ||
              ![...new Set(attackers.map((unit) => unit.location))].some((origin) => state.units.some((unit) => unit.faction === api.AP &&
                  ["army", "corps"].includes(unit.type) &&
                  api.connectionAllows(unit.location, origin, "attack", api.AP)))))
          return false;
      if (effect.adjacent_hq_required) {
          if (owner !== state.combat_window.attacker)
              return false;
          const origins = new Set(attackers.map((unit) => unit.location));
          const commandSpaces = new Set(origins);
          for (const origin of origins)
              for (const adjacent of api.landNeighbors(origin))
                  commandSpaces.add(adjacent);
          if (!state.units.some((unit) => unit.faction === owner &&
              unit.type === "hq" &&
              (!effect.required_hq_piece || unit.piece === effect.required_hq_piece) &&
              commandSpaces.has(unit.location)))
              return false;
      }
      if (effect.first_use_hq &&
          !state.usage_limits[`combat_card_first:${card.id}`] &&
          !combatPieceExists(state, effect.first_use_hq.piece)) {
          const placement = owner === state.combat_window.attacker
              ? effect.first_use_hq.attack_placement
              : effect.first_use_hq.defense_placement;
          const probe = {
              kind: "combat_hq_reinforcement",
              card: card.id,
              owner,
              piece: effect.first_use_hq.piece,
              placement,
          };
          if (!combatHqReinforcementSpaces(state, probe).length)
              return false;
      }
      return true;
  }

  function clearCombatEvents(state, expires = "combat") {
      for (const [event, status] of Object.entries(state.events))
          if (status?.expires === expires || status?.duration === expires) {
              const card = api.data.cards.find((candidate) => candidate.event === event);
              const effect = card && api.effectiveCombatEffect(state, card);
              if (expires === "action_round" &&
                  effect?.vp_if_no_army_advance &&
                  !status.army_advanced)
                  api.adjustVp(state, effect.vp_if_no_army_advance);
              if (expires === "action_round" && effect?.remove_piece_at_expiry) {
                  for (const pool of [
                      state.units,
                      state.reserves.ap,
                      state.reserves.cp,
                      state.upgrade_pool.ap,
                      state.upgrade_pool.cp,
                      state.eliminated.ap,
                      state.eliminated.cp,
                  ]) {
                      const index = pool.findIndex((unit) => unit.piece === effect.remove_piece_at_expiry);
                      if (index < 0)
                          continue;
                      const [unit] = pool.splice(index, 1);
                      state.permanently_removed_units.push({
                          ...api.clone(unit),
                          removed_by: card.id,
                          removed_turn: state.turn,
                      });
                      break;
                  }
              }
              delete state.events[event];
          }
  }

  function postCombatCardLegal(state, card, faction = state.active) {
      const owner = combatCardOwner(state, card);
      if (!card?.combat_card ||
          owner !== faction ||
          !state.combat ||
          !state.post_combat_window)
          return false;
      if (combatCardUsedThisAction(state, card.id))
          return false;
      const effect = api.effectiveCombatEffect(state, card);
      if (effect.after_defense)
          return (faction === api.AP &&
              state.combat.attacker === api.CP &&
              state.combat.defenders.some((id) => api.eventToken(state, id)?.piece?.nation === "fr") &&
              (!effect.first_use_hq || state.usage_limits[`combat_card_first:${card.id}`] ||
                  api.eventPieceExists(state, effect.first_use_hq) ||
                  api.combatFrRpHqSpaces(state, {
                      kind: "combat_fr_rp",
                      mode: "hq",
                      hq_piece: effect.first_use_hq,
                  }).length > 0));
      if (effect.choice?.includes("repair_after"))
          return api.combatRepairAvailable(state, card.id, effect.repair_rp);
      if (effect.post_combat_prohibit_advance) {
          const rules = state.combat.modifiers || {};
          const defenders = api.unitsAt(state, state.combat.target, api.other(state.combat.attacker))
              .filter(api.isCombatUnit);
          return state.combat.attacker === effect.post_combat_prohibit_advance &&
              !rules.prohibit_advance.includes(state.combat.attacker) &&
              !rules.prohibit_advance.includes("both") &&
              !rules.cancel_advance.includes(state.combat.attacker) &&
              (!defenders.length || state.combat.defense_loss > state.combat.attack_loss ||
                  rules.minimum_retreat > 0);
      }
      return false;
  }

  function startPostCombatWindow(state) {
      const combat = state.combat;
      const defender = api.other(combat.attacker);
      const factions = [defender, combat.attacker];
      if (!factions.some((faction) => state.hands[faction].some((id) => postCombatCardLegal({ ...state, post_combat_window: { side: faction } }, api.cardById[id], faction))))
          return false;
      state.post_combat_window = {
          attacker: combat.attacker,
          defender,
          side: defender,
          passes: 0,
      };
      api.setActiveFaction(state, defender);
      state.state = "post_combat_card_window";
      return true;
  }

  function playPostCombatCard(state, id) {
      const card = api.cardById[Number(id)];
      if (!postCombatCardLegal(state, card))
          throw new Error("Invalid post-combat card");
      const index = state.hands[state.active].indexOf(card.id);
      if (index < 0)
          throw new Error("Post-combat card is not in hand");
      const firstUseKey = `combat_card_first:${card.id}`;
      const firstUse = !state.usage_limits[firstUseKey];
      state.usage_limits[firstUseKey] = 1;
      state.hands[state.active].splice(index, 1);
      markCombatCardUsed(state, card.id);
      const disposition = api.cardUseDisposition(state, card, "combat");
      state[disposition === "remove" ? "removed" : "discard"][state.active].push(card.id);
      state.events[card.event] = {
          turn: state.turn,
          round: state.action_round,
          faction: card.faction,
          combat_card: true,
          expires: "combat",
      };
      const effect = api.effectiveCombatEffect(state, card);
      if (effect.cancel_retreat)
          state.combat.modifiers.cancel_retreat.push(effect.cancel_retreat);
      if (effect.cancel_advance)
          state.combat.modifiers.cancel_advance.push(effect.cancel_advance);
      if (effect.post_combat_prohibit_advance)
          state.combat.modifiers.cancel_advance.push(effect.post_combat_prohibit_advance);
      if (effect.draw_on_non_loss) {
          const ownLoss = card.faction === state.combat.attacker
              ? state.combat.attack_loss
              : state.combat.defense_loss;
          const enemyLoss = card.faction === state.combat.attacker
              ? state.combat.defense_loss
              : state.combat.attack_loss;
          if (ownLoss <= enemyLoss)
              api.drawCards(state, card.faction, state.hands[card.faction].length + 1);
      }
      if (effect.convert_fr_steps_to_rp) {
          state.pending_event = {
              kind: "combat_fr_rp",
              card: card.id,
              owner: card.faction,
              remaining: effect.convert_fr_steps_to_rp,
              gained: 0,
              mode: firstUse && effect.first_use_hq &&
                  !api.eventPieceExists(state, effect.first_use_hq)
                  ? "hq"
                  : "convert",
              hq_piece: effect.first_use_hq || null,
              resume: "post_window",
          };
          api.enterEventFlow(state);
          return;
      }
      if (effect.repair_rp) {
          if (!api.beginCombatRepair(state, card.id, effect.repair_rp, "post_window"))
              throw new Error("Post-combat repair no longer has a legal unit");
          return;
      }
  }

  function passPostCombatCard(state) {
      const window = state.post_combat_window;
      if (state.active === window.defender) {
          window.side = window.attacker;
          api.setActiveFaction(state, window.attacker);
          return;
      }
      state.post_combat_window = null;
      state.combat.post_combat_complete = true;
      api.setActiveFaction(state, state.combat.attacker);
      state.state = "combat_losses";
      api.finishCombatLosses(state);
  }
return Object.freeze({
    clearCombatEvents,
    combatCardDisposition,
    combatCardOwner,
    combatCardIds,
    combatCardLegal,
    combatHqReinforcementSpaces,
    combatWinner,
    openCombatCardWindow,
    passCombatCard,
    passPostCombatCard,
    placeCombatCard,
    playCombatCard,
    playPostCombatCard,
    postCombatCardLegal,
    prepareCombatCardDispositions,
    revealCommittedCombatCards,
    removeCardFromPublicPools,
    resolveCombatCardDisposition,
    resolveCombatHqReinforcement,
    startCombatCardCommitments,
    startPostCombatWindow,
  });
}

module.exports = { createCombatCardSystem };
