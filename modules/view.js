"use strict";

function createViewSystem(api) {
  

  function buildActionView(state, role) {
      const builder = new api.ActionProtocol.ActionBuilder();
      const actions = builder.actions;
      if (!api.actionAllowed(state, role))
          return builder.finish();
      if (!api.AUXILIARY_FLOW_STATES.has(state.state) &&
          !["opening_ap_card", "opening_cp_august_guns"].includes(state.state)) {
          if (api.undoAvailable(state))
              actions.undo = 1;
          if (state.rollback.length)
              actions.propose_rollback = state.rollback.map((_, index) => index);
          actions.flag_supply_warnings = 1;
      }
      api.stateEngine.prompt(state, builder);
      for (const [action, value] of Object.entries(actions)) {
          if (Array.isArray(value) && !value.length) {
              delete actions[action];
              continue;
          }
          if (Array.isArray(value)) {
              actions[action] = [...new Set(value)];
              for (const option of value) {
                  const label = nativeActionLabel(state, action, option);
                  if (label != null) {
                      builder.labels[action] ||= {};
                      builder.labels[action][String(option)] ||= label;
                  }
              }
          }
      }
      return builder.finish();
  }

  function eventUnitSelectionCount(state, candidates) {
      const pending = state.pending_event;
      const spec = api.cardSpecById[pending?.card];
      const choice = spec?.choices?.find((candidate) => candidate.id === pending?.choice);
      if (pending?.kind === "delay_units")
          return 1;
      if (pending?.kind === "mass_attrition" && pending.mode === "replacement")
          return 1;
      if (pending?.kind === "mass_attrition")
          return Math.min(pending.operation.full_armies_per_faction, candidates.length);
      if ([
          "regional_rotation",
          "white_feather_sr",
          "august_reposition",
          "bulgaria_choice",
          "precombat_restore",
          "combat_repair",
          "combat_fr_rp",
          "desertion_combat_loss",
      ].includes(pending?.kind))
          return 1;
      if (pending?.kind === "reinforcement_rebuild")
          return Number(pending.maximum) || 0;
      if ([
          "italy_entry_restore",
          "desertion_immediate",
          "sack_belgium",
      ].includes(pending?.kind))
          return Number(pending.required || pending.operation?.remove_count) || 0;
      const extra = choice?.select?.additional_if_missing_event;
      return (Number(choice?.select?.count) || 0) +
          (extra && !state.events[extra.event] ? Number(extra.count) || 0 : 0);
  }

  function nativeActionLabel(state, action, option) {
      if (["select_attack_mo", "select_defense_mo"].includes(action)) {
          const [, nation, id] = String(option).split(":");
          const definition = id === "none" ? null : api.moDefinition(state, id);
          return id === "none"
              ? `${nation.toUpperCase()}：本次不计入MO`
              : `${nation.toUpperCase()}：${definition?.name || id}`;
      }
      if (action === "propose_rollback") {
          const entry = state.rollback[Number(option)];
          return entry
              ? `${entry.label}（T${entry.turn} AR${entry.round || 0}）`
              : String(option);
      }
      if (action === "event_exchange") {
          const [route, amount] = String(option).split(":");
          const names = {
              br_to_fr: "BR → FR",
              fr_to_br: "FR → BR",
              us_to_fr: "US → FR",
              fr_to_us: "FR → US",
          };
          return `${names[route] || route} ${amount} RP`;
      }
      if (action === "spend_front")
          return option === "russian" ? "推进俄国战线" : "推进土耳其战线";
      if (action === "convert_east_rp")
          return option === "ge"
              ? "1 EAST:RP → 1 GE:RP"
              : "1 EAST:RP → 2 AH:RP";
      if (action === "spend_option") {
          const [kind, unitId, key] = String(option).split(":");
          const unit = state.units
              .concat(state.reserves[state.active] || [])
              .concat(state.eliminated[state.active] || [])
              .find((candidate) => candidate.id === unitId);
          return `${kind === "rebuild" ? "重建" : kind === "flip" ? "补充" : "老兵替换"} ${api.pieceById[unit?.piece]?.name || unitId}（${String(key).toUpperCase()}:RP）`;
      }
      if (action === "event_choose") {
          const choice = api.cardSpecById[state.pending_event?.card]?.choices?.find((candidate) => String(candidate.id) === String(option));
          return choice?.label;
      }
      return undefined;
  }

  function actionSelectionView(state) {
      if (state.supply_warning_editor)
          return {
              kind: "spaces",
              selected: state.supply_warning_editor.selected.slice(),
              required: [],
              minimum: 0,
              maximum: api.supplyWarningSpaces().length,
          };
      if (state.ops?.preactivation_sr_selected)
          return {
              kind: "units",
              selected: [state.ops.preactivation_sr_selected],
              required: [],
              minimum: 1,
              maximum: 1,
          };
      if (state.ops?.pending_activation)
          return {
              kind: "units",
              selected: (state.ops.pending_activation.selected || []).slice(),
              required: [],
              minimum: 1,
              maximum: 4,
              counted_maximum: 3,
              counted_types: ["army", "corps"],
              support_maximum: 1,
              support_types: ["hq"],
          };
      if (state.ops?.combine_selection?.army_id)
          return {
              kind: "units",
              selected: [state.ops.combine_selection.army_id],
              required: [],
              minimum: 1,
              maximum: 1,
          };
      if (state.pending_event?.kind === "august_reposition" &&
          state.pending_event.selected_units?.length)
          return {
              kind: "units",
              selected: state.pending_event.selected_units.slice(),
              required: [],
              minimum: 0,
              maximum: state.pending_event.selected_units.length,
          };
      if (state.ops?.move_selection)
          return {
              kind: "units",
              selected: state.ops.move_selection.selected.slice(),
              required: [],
              minimum: 1,
              maximum: api.movementSelectionCandidates(state).length,
          };
      if (state.ops?.movement)
          return {
              kind: "units",
              selected: state.ops.movement.active_units.slice(),
              required: [],
              minimum: 1,
              maximum: state.ops.movement.units.length,
          };
      if (state.pending_event?.kind === "mo_penalty" &&
          state.pending_event.stage === "loss") {
          const pending = state.pending_event;
          return {
              kind: "units",
              selected: (pending.selected_units || []).slice(),
              required: [],
              minimum: Math.min(pending.loss_required, api.moPenaltyLossCandidates(state, pending.penalized, pending.nation)
                  .length),
              maximum: api.moPenaltyLossCandidates(state, pending.penalized, pending.nation).length,
              value: api.moPenaltySelectedValue(state, pending),
              required_value: pending.loss_required,
          };
      }
      if (state.ops?.attack_selection?.length)
          return {
              kind: "units",
              selected: state.ops.attack_selection.slice(),
              required: [
                  ...new Set(Object.values(state.ops.required_attackers || {}).flat()),
              ].filter((id) => state.ops.attack_selection.includes(id)),
              minimum: 1,
              maximum: state.ops.attack_selection.length,
          };
      if (state.sr?.selected_unit)
          return {
              kind: "units",
              selected: [state.sr.selected_unit],
              required: [],
              minimum: 1,
              maximum: 1,
          };
      if (state.pending_retreat) {
          const selected = state.state === "advance_select"
              ? [state.pending_retreat.selected_follow_unit].filter(Boolean)
              : [state.pending_retreat.selected_unit].filter(Boolean);
          if (selected.length)
              return {
                  kind: "units",
                  selected: selected.slice(),
                  required: [],
                  minimum: 1,
                  maximum: 1,
              };
      }
      if (state.pending_event?.selected_units)
          return {
              kind: "units",
              selected: state.pending_event.selected_units.slice(),
              required: [],
              minimum: 0,
              maximum: state.pending_event.maximum ??
                  state.pending_event.selected_units.length,
          };
      return null;
  }

  function pendingAttackView(state) {
      const pending = state.ops?.pending_attack;
      if (!pending)
          return null;
      const originCount = api.pendingAttackOriginCount(state, pending);
      return {
          attackers: (pending.attackers || []).slice(),
          target: pending.target,
          origin_count: originCount,
          flank_available: originCount >= 2 && api.legalFlankFinals(state).length > 0,
      };
  }

  function combatModifierLines(modifiers) {
      if (!modifiers)
          return [];
      const lines = [];
      for (const [side, key, kind, label] of [
          ["attacker", "attack_column", "column", "进攻列移"],
          ["defender", "defense_column", "column", "防御列移"],
          ["attacker", "attack_drm", "drm", "进攻DRM"],
          ["defender", "defense_drm", "drm", "防御DRM"],
      ])
          if (modifiers[key])
              lines.push({ side, kind, amount: modifiers[key], label });
      for (const source of modifiers.modifier_sources || [])
          lines.push(api.clone(source));
      if (modifiers.flank)
          lines.push({
              side: "attacker",
              kind: "drm",
              amount: modifiers.flank.success ? modifiers.flank.final_drm : -1,
              label: modifiers.flank.success ? "侧翼成功" : "侧翼失败",
          });
      for (const card of modifiers.cards || [])
          lines.push({
              side: card.faction === api.AP ? "ap" : "cp",
              kind: "card",
              amount: 0,
              label: card.title,
              card: card.id,
          });
      for (const effect of modifiers.mo_effects || [])
          lines.push({
              side: "attacker",
              kind: effect.table ? "table" : effect.column ? "column" : "drm",
              amount: effect.column || effect.drm || 0,
              label: effect.label || effect.id,
              mo: effect.id,
          });
      return lines;
  }

  function combatCardsView(state, viewer, actions) {
      const played = { ap: [], cp: [] };
      const hiddenCounts = { ap: 0, cp: 0 };
      const revealed = Boolean(state.combat_window?.cards_revealed || state.combat);
      const playedIds = state.combat_window?.cards ||
          (state.combat?.played_cards || []).map((entry) => entry.id);
      for (const id of playedIds) {
          const faction = state.combat_window?.card_owners?.[id] ||
              state.combat?.played_cards?.find((entry) => entry.id === id)?.faction ||
              api.combatCardOwner(state, id);
          if (!faction)
              continue;
          if (revealed || viewer === faction)
              played[faction].push(id);
          else
              hiddenCounts[faction] += 1;
      }
      const active = Object.entries(state.events || {}).flatMap(([event, status]) => {
          if (!status?.combat_card || status.expires === "combat")
              return [];
          const card = api.data.cards.find((candidate) => candidate.event === event);
          return card ? [{ id: card.id, faction: card.faction, expires: status.expires }] : [];
      });
      return {
          played,
          hidden_counts: hiddenCounts,
          available: Array.isArray(actions?.combat_card) ? actions.combat_card.slice() : [],
          retained: api.clone(state.retained_combat_cards),
          active,
      };
  }

  function privateHands(state, viewer) {
      return {
          ap: viewer === api.AP ? state.hands.ap.slice() : state.hands.ap.length,
          cp: viewer === api.CP ? state.hands.cp.slice() : state.hands.cp.length,
      };
  }

  function publicDeckCards(state) {
      const sorted = (faction) => state.decks[faction].slice().sort((a, b) => {
          const numberA = Number(api.cardById[a]?.number ?? a);
          const numberB = Number(api.cardById[b]?.number ?? b);
          return numberA - numberB || Number(a) - Number(b);
      });
      return { ap: sorted(api.AP), cp: sorted(api.CP) };
  }

  function privatePendingEvent(state, viewer) {
      const pending = api.clone(state.pending_event);
      if (!pending)
          return null;
      // Internal interruption continuations may contain the suspended ops
      // object. They are server state, never player-facing event data.
      if (pending.kind === "counterattack")
          delete pending.resume;
      if (pending.kind === "combat_hq_reinforcement" && viewer !== pending.owner)
          return null;
      const chooser = pending.chooser || pending.owner || pending.faction;
      if (viewer !== chooser && pending.kind === "immediate_rp") {
          delete pending.remaining;
          delete pending.mode;
      }
      if (viewer !== chooser && Array.isArray(pending.choices)) {
          delete pending.choices;
          delete pending.choice;
          delete pending.selected_units;
          delete pending.units;
          delete pending.space;
      }
      if ((pending.kind === "card_search" ||
          (pending.kind === "ohl" && pending.stage === "discard")) &&
          viewer !== chooser &&
          Array.isArray(pending.cards)) {
          pending.card_count = pending.cards.length;
          delete pending.cards;
      }
      if (pending.declaration && viewer !== pending.owner) {
          delete pending.declaration.mo_assignments;
          delete pending.declaration.mo_decisions;
      }
      if (pending.kind === "mass_attrition") {
          const own = viewer === api.AP || viewer === api.CP
              ? (pending.selections?.[viewer] || []).slice()
              : [];
          pending.selection_counts = {
              ap: pending.selections?.ap?.length || 0,
              cp: pending.selections?.cp?.length || 0,
          };
          pending.selections = viewer === api.AP || viewer === api.CP
              ? { [viewer]: own }
              : {};
          delete pending.loss_queue;
          delete pending.initial;
          delete pending.replacement;
          if (viewer !== api.AP)
              delete pending.mo_selection;
      }
      return pending;
  }

  function visibleMoAssignments(state, assignments, viewer, owner) {
      if (viewer === owner)
          return api.clone(assignments || {});
      return Object.fromEntries(Object.entries(assignments || {}).filter(([, id]) => state.mo.revealed.includes(id)));
  }

  function privateCombatView(state, viewer) {
      const combat = api.clone(state.combat);
      if (!combat)
          return null;
      delete combat.counterattack_resume;
      combat.mo_assignments = visibleMoAssignments(state, combat.mo_assignments, viewer, combat.attacker);
      combat.defense_mo_assignments = visibleMoAssignments(state, combat.defense_mo_assignments, viewer, api.other(combat.attacker));
      if (combat.declaration) {
          combat.declaration.mo_assignments = api.clone(combat.mo_assignments);
          combat.declaration.defense_mo_assignments = api.clone(combat.defense_mo_assignments);
          delete combat.declaration.mo_decisions;
      }
      return combat;
  }

  function privateCombatModifiers(state, viewer) {
      const modifiers = api.clone(state.combat_modifiers);
      if (!modifiers)
          return modifiers;
      const owner = state.combat?.attacker || state.combat_window?.attacker || state.active;
      if (modifiers.mo_attacks)
          modifiers.mo_attacks = visibleMoAssignments(state, modifiers.mo_attacks, viewer, owner);
      if (viewer !== owner)
          modifiers.mo_effects = (modifiers.mo_effects || []).filter((effect) => state.mo.revealed.includes(effect.id));
      return modifiers;
  }

  function moSummary(state, nation, id) {
      const definition = api.moDefinition(state, id) || {};
      return {
          id,
          nation,
          name: definition.name || `${nation.toUpperCase()} 强制进攻`,
          description: definition.description || definition.name || "",
          image: definition.image || null,
          source_card: definition.source_card || null,
          kind: api.moKind(definition),
          progress: state.mo.progress[nation]?.[id] || 0,
          required: api.moRequiredCount(definition),
          revealed: state.mo.revealed.includes(id),
      };
  }

  function privateMoView(state, viewer) {
      const ownNations = viewer ? api.MO_NATIONS[viewer] || [] : [];
      const resolved = (nation, id) => (state.mo.completed[nation] || []).includes(id) ||
          (state.mo.waived[nation] || []).includes(id) ||
          (state.mo.penalized[nation] || []).includes(id);
      const own = ownNations.flatMap((nation) => (state.mo.current[nation] || [])
          .filter((id) => !resolved(nation, id) &&
          api.moAvailable(state, api.moDefinition(state, id)))
          .map((id) => {
          const definition = api.moDefinition(state, id);
          const entry = moSummary(state, nation, id);
          if (!api.moIsTask(definition))
              return entry;
          const defending = state.state === "defense_mo";
          const assignments = defending
              ? state.combat_window?.defense_mo_assignments || {}
              : state.ops?.pending_attack?.mo_assignments || {};
          entry.selected = assignments[nation] === id;
          entry.option = api.attackMoOptionId(nation, id);
          entry.action = defending ? "select_defense_mo" : "select_attack_mo";
          const decisions = defending
              ? state.combat_window?.defense_mo_decisions || {}
              : state.ops?.pending_attack?.mo_decisions || {};
          const next = (defending ? api.defenseMoChoices(state) : api.attackMoChoices(state)).find((choice) => !Object.prototype.hasOwnProperty.call(decisions, choice.nation));
          entry.legal = Boolean(viewer === state.active &&
              next?.nation === nation &&
              next.candidates.includes(id));
          if (state.state === "front_mo_commit" && definition.requirement === "advance_front") {
              entry.option = id;
              entry.action = "commit_front_mo";
              entry.legal = Boolean(viewer === state.active &&
                  state.mo.front_commitment_review?.queue?.[
                      state.mo.front_commitment_review.index]?.id === id &&
                  api.frontMoCommitmentCandidates(state, viewer).includes(id));
          }
          entry.committed = Boolean(Object.values(state.mo.front_commitments || {})
              .some((commitment) => commitment?.turn === state.turn &&
                  commitment.id === id && commitment.nation === nation));
          if (entry.committed)
              entry.selected = true;
          return entry;
      }));
      const hiddenNations = viewer
          ? Object.keys(state.mo.current).filter((nation) => !ownNations.includes(nation))
          : Object.keys(state.mo.current);
      const opponentCounts = Object.fromEntries(hiddenNations.map((nation) => [
          nation,
          (state.mo.current[nation] || []).filter((id) => !resolved(nation, id) &&
              api.moAvailable(state, api.moDefinition(state, id)) &&
              api.moIsTask(api.moDefinition(state, id))).length,
      ]));
      const revealed = [];
      for (const [nation, ids] of Object.entries(state.mo.current))
          for (const id of ids || [])
              if (state.mo.revealed.includes(id) &&
                  !resolved(nation, id) &&
                  api.moAvailable(state, api.moDefinition(state, id)))
                  if (api.moIsTask(api.moDefinition(state, id)))
                      revealed.push(moSummary(state, nation, id));
      const activeEffects = [];
      for (const [nation, ids] of Object.entries(state.mo.current))
          for (const id of ids || []) {
              const definition = api.moDefinition(state, id);
              if (state.mo.revealed.includes(id) &&
                  api.moAvailable(state, definition) &&
                  ["passive", "prohibition"].includes(api.moKind(definition)))
                  activeEffects.push(moSummary(state, nation, id));
          }
      const history = (state.mo.history || []).map((entry) => ({
          ...api.clone(entry),
          mo: moSummary(state, entry.nation, entry.id),
      }));
      return {
          review: {
              current_faction: state.state === "mo_review" ? state.active : null,
              confirmed: state.mo.review.confirmed.slice(),
          },
          own,
          opponent_counts: opponentCounts,
          revealed,
          active_effects: activeEffects,
          completed_this_turn: history.filter((entry) => entry.turn === state.turn && entry.outcome === "completed"),
          history,
      };
  }

  function publicUnitView(unit) {
      return {
          ...api.clone(unit),
          zone: "map",
          supply_status: api.ViewExplanations.supplyStatus(unit),
          supply_effects: api.ViewExplanations.supplyEffects(unit),
      };
  }

  function publicOffMapUnitView(unit, zone) {
      const result = { ...api.clone(unit), zone };
      delete result.location;
      delete result.supplied;
      delete result.limited_supply;
      delete result.fort_limited_supply;
      delete result.supply_status;
      delete result.supply_effects;
      delete result.moved;
      delete result.attacked;
      delete result.attack_eligible;
      return result;
  }

  function actionHintsView(state, faction, actions) {
      return api.ViewExplanations.actionHints(state, faction, actions, {
          candidateSpaces(current, action, origins) {
              return action === "declare_attack"
                  ? api.combatRules.candidateSpaces(current, origins)
                  : api.operationsRules.candidateSpaces(current, action, origins);
          },
          connectionAllows: api.connectionAllows,
          explainPieceAction(current, action, unit) {
              return action === "select_attacker"
                  ? api.combatRules.explainPiece(current, unit)
                  : api.operationsRules.explainPiece(current, action, unit);
          },
          explainSpaceAction(current, action, destination, origins) {
              return action === "declare_attack"
                  ? api.combatRules.explainSpace(current, destination, origins)
                  : api.operationsRules.explainSpace(current, action, destination, origins);
          },
          landNeighbors: api.landNeighbors,
          other: api.other,
          spaceCanActivate: api.spaceCanActivate,
          unitsAt: api.unitsAt,
      });
  }

  function prompt(state) {
      return api.stateEngine.message(state) || state.phase;
  }

  function combatContext(state) {
      const declaration = state.combat_window?.declaration ||
          state.pending_event?.declaration ||
          state.ops?.pending_attack ||
          null;
      const target = state.combat?.target || declaration?.target ||
          state.pending_retreat?.target || null;
      if (!target)
          return null;
      const attacker = state.combat?.attacker || state.combat_window?.attacker ||
          state.pending_event?.owner || state.active;
      if (![api.AP, api.CP].includes(attacker))
          return null;
      return {
          target,
          attacker,
          defender: api.other(attacker),
          stage: state.state,
      };
  }

  function contextualPrompt(state, canAct, context) {
      const base = context || canAct || ![api.AP, api.CP].includes(state.active)
          ? prompt(state)
          : `等待 ${state.active.toUpperCase()} 行动。`;
      if (!context || String(base).startsWith("战斗："))
          return base;
      return `战斗：${api.spaceById[context.target]?.name || context.target}（${String(base).replace(/[。.]$/, "")}）`;
  }


  function publicView(state, current) {
      api.ensureState(state);
      const faction = api.roleFaction(current);
      const canAct = api.actionAllowed(state, current);
      const actionView = buildActionView(state, current);
      const currentCombatContext = combatContext(state);
      const naval = api.clone(state.naval);
      const combatWindow = api.clone(state.combat_window);
      if (combatWindow)
          delete combatWindow.counterattack_resume;
      if (state.state === "naval_choice" &&
          faction !== api.CP &&
          state.active === api.AP &&
          naval.selections.cp)
          naval.selections.cp = { kind: "hidden" };
      if (state.state === "naval_choice" && faction !== api.AP && naval.selections.ap)
          naval.selections.ap = { kind: "hidden" };
      if (state.state === "naval_disposition") {
          for (const side of [api.CP, api.AP])
              if (naval.dispositions?.[side] && faction !== side)
                  naval.dispositions[side] = { kind: "hidden" };
      }
      delete naval.legacy_disposition_complete;
      if (["defense_mo", "combat_card_window"].includes(state.state) && combatWindow) {
          if (state.state === "combat_card_window") {
              combatWindow.card_counts = {
                  ap: combatWindow.cards.filter((id) =>
                      (combatWindow.card_owners?.[id] || api.combatCardOwner(state, id)) === api.AP)
                      .length,
                  cp: combatWindow.cards.filter((id) =>
                      (combatWindow.card_owners?.[id] || api.combatCardOwner(state, id)) === api.CP)
                      .length,
              };
              combatWindow.cards = combatWindow.cards.filter((id) =>
                  (combatWindow.card_owners?.[id] || api.combatCardOwner(state, id)) === faction);
          }
          if (combatWindow.declaration && faction !== combatWindow.attacker) {
              delete combatWindow.declaration.mo_assignments;
              delete combatWindow.declaration.mo_decisions;
          }
          if (faction !== combatWindow.defender) {
              delete combatWindow.defense_mo_assignments;
              delete combatWindow.defense_mo_decisions;
              if (combatWindow.declaration)
                  delete combatWindow.declaration.defense_mo_assignments;
          }
      }
      const stagedReinforcements = api.stagedReinforcementView(state);
      const visibleUnits = [
          ...state.units.map(publicUnitView),
          ...stagedReinforcements.units.map(publicUnitView),
      ];
      const visibleReserves = {
          ap: [
              ...state.reserves.ap.map((unit) => publicOffMapUnitView(unit, "reserve")),
              ...stagedReinforcements.reserves.ap.map((unit) => publicOffMapUnitView(unit, "reserve")),
          ],
          cp: [
              ...state.reserves.cp.map((unit) => publicOffMapUnitView(unit, "reserve")),
              ...stagedReinforcements.reserves.cp.map((unit) => publicOffMapUnitView(unit, "reserve")),
          ],
      };
      const view = {
          active: api.factionRole(state.active),
          state: state.state,
          phase: state.phase,
          prompt: contextualPrompt(state, canAct, currentCombatContext),
          action_protocol: api.ActionProtocol.VERSION,
          actions: actionView.actions,
          action_labels: actionView.labels,
          action_hints: actionHintsView(state, faction, actionView.actions),
          selection: actionView.selection || actionSelectionView(state),
          turn: state.turn,
          action_round: state.action_round,
          action_history: api.clone(state.action_history),
          opening_cards: faction === state.active
              ? api.openingCardCandidates(state)
              : [],
          vp: state.vp,
          war_status: api.clone(state.war_status),
          commitment: api.clone(state.commitment),
          card_values: Object.fromEntries(api.data.cards
              .filter((card) => api.cardSpecById[card.id]?.values_by_turn?.length)
              .map((card) => [card.id, api.cardValues(state, card)])),
          rp: api.clone(state.rp),
          fronts: api.clone(state.fronts),
          fronts_active: {
              russian: true,
              turkish: api.turkishFrontActive(state),
          },
          front_storage: api.clone(state.front_storage),
          mo: privateMoView(state, faction),
          naval,
          units: visibleUnits,
          control: api.clone(state.control),
          trenches: api.clone(state.trenches),
          fortifications: api.clone(state.fortifications),
          markers: api.clone(state.markers),
          besieged: state.besieged.slice(),
          destroyed_forts: state.destroyed_forts.slice(),
          activations: api.clone(state.activations),
          hands: privateHands(state, faction),
          discard: { ap: state.discard.ap.slice(), cp: state.discard.cp.slice() },
          removed: { ap: state.removed.ap.slice(), cp: state.removed.cp.slice() },
          deck_count: { ap: state.decks.ap.length, cp: state.decks.cp.length },
          deck_cards: publicDeckCards(state),
          events: api.clone(state.events),
          event_history: api.clone(state.event_history),
          scheduled_events: api.clone(state.scheduled_events),
          pending_event: privatePendingEvent(state, faction),
          turn_flags: api.clone(state.turn_flags),
          usage_limits: api.clone(state.usage_limits),
          entry_tracks: api.clone(state.entry_tracks),
          combat_modifiers: privateCombatModifiers(state, faction),
          combat_context: api.clone(currentCombatContext),
          combat_cards: combatCardsView(state, faction, actionView.actions),
          combat_window: combatWindow,
          post_combat_window: api.clone(state.post_combat_window),
          pending_combat_card_disposition: api.clone(state.pending_combat_card_disposition),
          reserves: visibleReserves,
          upgrade_pool: {
              ap: state.commitment.ap === "mobilization"
                  ? []
                  : (state.upgrade_pool.ap || []).map((unit) => publicOffMapUnitView(unit, "upgrade")),
              cp: state.commitment.cp === "mobilization"
                  ? []
                  : (state.upgrade_pool.cp || []).map((unit) => publicOffMapUnitView(unit, "upgrade")),
          },
          eliminated: {
              ap: (state.eliminated.ap || []).map((unit) => publicOffMapUnitView(unit, "eliminated")),
              cp: (state.eliminated.cp || []).map((unit) => publicOffMapUnitView(unit, "eliminated")),
          },
          permanently_removed_units: (state.permanently_removed_units || [])
              .map((unit) => publicOffMapUnitView(unit, "removed")),
          hq_turn_track: api.clone(state.hq_turn_track),
          combat: privateCombatView(state, faction),
          pending_attack: pendingAttackView(state),
          pending_replacement: api.clone(state.pending_replacement),
          pending_retreat: api.clone(state.pending_retreat),
          supply_warnings: state.supply_warning_editor
              ? {
                  owner: state.supply_warning_editor.owner,
                  spaces: state.supply_warning_editor.selected.slice(),
                  editing: true,
              }
              : api.clone(state.supply_warnings),
          rollback: api.ViewExplanations.rollbackEntries(
              state,
              current,
              20,
              (index) => api.rollbackSnapshot(state, index),
          ),
          rollback_proposal: state.rollback_proposal
              ? {
                  proposer: state.rollback_proposal.proposer,
                  index: state.rollback_proposal.index,
                  label: state.rollback[state.rollback_proposal.index]?.label ||
                      "未知检查点",
              }
              : null,
          rollback_confirmation: api.clone(state.rollback_confirmation),
          log: state.log,
          result: state.result,
          victory: state.victory,
      };
      if (!canAct) {
          delete view.actions;
          delete view.action_labels;
          delete view.action_hints;
          delete view.selection;
      }
      return view;
  }
return Object.freeze({
    actionHintsView,
    actionSelectionView,
    buildActionView,
    combatCardsView,
    combatModifierLines,
    eventUnitSelectionCount,
    moSummary,
    nativeActionLabel,
    pendingAttackView,
    privateCombatModifiers,
    privateCombatView,
    privateHands,
    privateMoView,
    privatePendingEvent,
    prompt,
    publicDeckCards,
    publicUnitView,
    publicView,
    visibleMoAssignments,
  });
}

module.exports = { createViewSystem };
