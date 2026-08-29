"use strict";

function createCombatStates(api) {
  function continueAttackDeclaration(state) {
    const pending = state.ops?.pending_attack;
    if (!pending) throw new Error("No pending attack");
    api.validateAttackDeclaration(state, pending);
    if (!api.attackMoChoicesComplete(state, pending)) {
      state.state = "attack_mo";
      return;
    }
    if (
      api.pendingAttackOriginCount(state, pending) >= 2 &&
      api.legalFlankFinals(state).length
    ) {
      state.state = "attack_mode";
      return;
    }
    api.commitPendingAttack(state, { ...pending, flank: false });
  }

  function advanceToDestination(state, destination) {
    const pending = state.pending_retreat;
    if (!api.advanceDestinations(state, pending).includes(destination))
      throw new Error("Illegal advance destination");
    const ids = pending.selected_advance_units.slice();
    const units = ids.map((id) => api.findUnit(state, id)).filter(Boolean);
    if (!units.length || units.length !== ids.length)
      throw new Error("Advance units no longer exist");
    const continuing = Boolean(pending.advance_group?.length);
    if (!api.advanceCanEnter(state, ids, destination))
      throw new Error("Advance is no longer legal");
    if (!continuing && !pending.advanced_ids.length) api.clearUndo(state);
    api.snapshot(state, "Post-combat advance");
    for (const unit of units) api.advanceUnitInto(state, pending, unit, destination);
    if (api.intactFort(state, destination) &&
        api.spaceById[destination]?.faction === api.other(units[0].faction) &&
        !api.refreshBesiegedSpace(state, destination))
      throw new Error("The advancing group cannot establish the required siege");
    pending.advanced = pending.advanced_ids.length;
    if (!continuing) {
      pending.units = pending.units.filter((id) => !ids.includes(id));
      pending.advance_group = [destination];
    } else pending.advance_group.push(destination);
    if (api.secondAdvanceDestinations(state, pending, ids).length)
      state.state = "advance_select";
    else api.finishAdvanceGroup(state);
  }

  return {
    ops_attack: {
      message: "选择进攻单位和目标。",
      prompt(state, builder) {
        const selection = api.attackSelectionActions(state);
        builder.addAll("select_attacker", selection.selectable);
        builder.addAll("deselect_attacker", selection.deselectable);
        if (selection.selected.length)
          builder.addAll("declare_attack", selection.targets);
        if (!state.ops.forced_attacks?.length) builder.enable("finish");
      },
      select_attacker(state, id) {
        const selection = api.attackSelectionActions(state);
        if (!selection.selectable.includes(id))
          throw new Error("Unit cannot join this attack");
        state.ops.attack_selection = [...selection.selected, id];
      },
      deselect_attacker(state, id) {
        const selection = api.attackSelectionActions(state);
        if (!selection.deselectable.includes(id))
          throw new Error("Unit must remain in this attack");
        state.ops.attack_selection = api.pruneOrphanAttackHqs(
          state,
          selection.selected.filter((candidate) => candidate !== id),
        );
      },
      declare_attack(state, target) {
        const selection = api.attackSelectionActions(state);
        if (!selection.targets.includes(target))
          throw new Error("Attack declaration does not match the server selection");
        const declaration = {
          attackers: selection.selected.slice(),
          target,
          flank: false,
          attack_origin: {
            kind:
              state.ops?.source === "mo_penalty"
                ? "mo_penalty"
                : state.ops?.source === "event"
                  ? "event"
                  : "normal",
            source: state.ops?.source_id ?? state.ops?.card ?? null,
          },
          mo_assignments: {},
          mo_decisions: {},
        };
        declaration.mo_marker_origins = api.computeMoMarkerOrigins(state, declaration);
        api.validateAttackDeclaration(state, declaration);
        state.ops.pending_attack = declaration;
        continueAttackDeclaration(state);
      },
      finish(state) {
        if (state.ops?.forced_attacks?.length)
          throw new Error("Converted attack activations must be executed");
        if (state.turn <= 3) api.advanceEarlyStackResolution(state);
        else api.finishOps(state);
      },
    },

    attack_mo: {
      message(state) {
        const pending = state.ops?.pending_attack;
        const next = api.attackMoChoices(state, pending).find(
          (entry) =>
            !Object.prototype.hasOwnProperty.call(
              pending?.mo_decisions || {},
              entry.nation,
            ),
        );
        return next
          ? `${next.nation.toUpperCase()}：选择MO。`
          : "确认战斗。";
      },
      prompt(state, builder) {
        const pending = state.ops?.pending_attack;
        const choices = api.attackMoChoices(state, pending);
        const next = choices.find(
          (entry) =>
            !Object.prototype.hasOwnProperty.call(
              pending?.mo_decisions || {},
              entry.nation,
            ),
        );
        if (next)
          builder.addAll("select_attack_mo", [
            ...next.candidates.map((id) => api.attackMoOptionId(next.nation, id)),
            ...(next.required ? [] : [api.attackMoOptionId(next.nation, null)]),
          ]);
        builder.enable("cancel");
      },
      select_attack_mo(state, option) {
        api.selectAttackMo(state, option);
        continueAttackDeclaration(state);
      },
      cancel(state) {
        if (!state.ops?.pending_attack) throw new Error("No pending attack");
        state.ops.pending_attack = null;
        state.state = "ops_attack";
      },
    },

    attack_mode: {
      message: "选择进攻方式。",
      prompt(state, builder) {
        builder.enable("regular_attack");
        if (api.legalFlankFinals(state).length) builder.enable("flank_attack");
        builder.enable("cancel");
      },
      regular_attack(state) {
        const pending = state.ops?.pending_attack;
        if (!pending) throw new Error("No pending attack");
        api.commitPendingAttack(state, { ...pending, flank: false });
      },
      flank_attack(state) {
        if (!state.ops?.pending_attack || !api.legalFlankFinals(state).length)
          throw new Error("Flank attack is not available");
        state.state = "flank_final";
      },
      cancel(state) {
        if (!state.ops?.pending_attack) throw new Error("No pending attack");
        state.ops.pending_attack = null;
        state.state = "ops_attack";
      },
    },

    flank_final: {
      message: "选择侧翼分配。",
      prompt(state, builder) {
        builder.addAll("choose_flank_final", api.legalFlankFinals(state));
        builder.enable("cancel");
      },
      choose_flank_final(state, value) {
        const finalDrm = Number(value);
        if (!api.legalFlankFinals(state).includes(finalDrm))
          throw new Error("Illegal flank allocation");
        api.commitPendingAttack(state, {
          ...state.ops.pending_attack,
          flank: true,
          flank_final: finalDrm,
        });
      },
      cancel(state) {
        state.state = "attack_mode";
      },
    },

    all_out_attack: {
      message: "选择是否忽略战壕。",
      prompt(state, builder) {
        for (const choice of api.allOutAttackChoices(state))
          builder.add(
            "choose_all_out_attack",
            choice.id,
            choice.id === "br" ? "英国系进攻" : "法国／美国进攻",
          );
        builder.enable("skip_all_out_attack");
      },
      choose_all_out_attack(state, id) {
        const choice = api.allOutAttackChoices(state).find((entry) => entry.id === id);
        if (!choice) throw new Error("This All Out War allowance is not available");
        api.commitPendingAttack(state, {
          ...state.ops.pending_attack,
          all_out_decision: true,
          all_out_group: choice.id,
        });
      },
      skip_all_out_attack(state) {
        if (!state.ops?.pending_attack) throw new Error("No pending attack");
        api.commitPendingAttack(state, {
          ...state.ops.pending_attack,
          all_out_decision: false,
          all_out_group: null,
        });
      },
    },

    optional_combat_event: {
      message(state) {
        const pending = state.ops?.pending_attack;
        if (pending?.optional_hq_card === 641) return "部署迪亚兹。";
        return "选择战斗事件。";
      },
      prompt(state, builder) {
        const pending = state.ops?.pending_attack;
        if (pending?.optional_hq_card === 641) {
          builder.addAll("event_space", api.diazHqSpaces(state, pending));
          return;
        }
        const choice = api.optionalCombatEventChoices(state, pending)[0];
        if (!choice) return;
        builder.add("event_choose", `${choice.id}:use`, `使用${choice.label}`);
        const units = (pending.attackers || [])
          .map((id) => state.units.find((unit) => unit.id === id))
          .filter(Boolean);
        if (choice.id !== 641 || api.multinationalAttackValid(units))
          builder.add("event_choose", `${choice.id}:skip`, "保留");
      },
      event_choose: api.chooseOptionalCombatEvent,
      event_space: api.placeOptionalCombatHq,
    },

    defense_mo: {
      message: "选择防御MO。",
      prompt(state, builder) {
        const window = state.combat_window;
        const next = api.defenseMoChoices(state, window).find(
          (entry) =>
            !Object.prototype.hasOwnProperty.call(
              window?.defense_mo_decisions || {},
              entry.nation,
            ),
        );
        if (next)
          builder.addAll("select_defense_mo", [
            ...next.candidates.map((id) => api.attackMoOptionId(next.nation, id)),
            api.attackMoOptionId(next.nation, null),
          ]);
        if (Object.keys(window?.defense_mo_decisions || {}).length)
          builder.enable("reset_defense_mo");
      },
      select_defense_mo(state, option) {
        api.selectDefenseMo(state, option);
        if (api.defenseMoChoicesComplete(state))
          api.startCombatCardCommitments(state);
      },
      reset_defense_mo(state) {
        if (!state.combat_window) throw new Error("No pending combat");
        state.combat_window.defense_mo_assignments = {};
        state.combat_window.defense_mo_decisions = {};
      },
    },

    combat_card_window: {
      message(state) {
        const window = state.combat_window;
        const target = window?.declaration?.target;
        const place = api.spaceById[target]?.name || target || "未知地区";
        const side = state.active === window?.attacker ? "进攻方" : "防守方";
        return `战斗：${place}（${side}选择战斗牌）`;
      },
      prompt(state, builder) {
        const legal = [
          ...state.hands[state.active],
          ...state.retained_combat_cards[state.active],
        ].filter((id) => api.combatCardLegal(state, api.cardById[id]));
        if (
          state.active === api.AP &&
          state.events[api.cardById[638].event] &&
          !state.combat_window.discard_card_used
        )
          legal.push(
            ...state.discard.ap.filter(
              (id) => !legal.includes(id) && api.combatCardLegal(state, api.cardById[id]),
            ),
          );
        builder.addAll("combat_card", legal);
        builder.enable("pass");
      },
      combat_card: api.playCombatCard,
      pass: api.passCombatCard,
    },

    combat_card_disposition: {
      message: "处理战斗牌。",
      prompt(state, builder) {
        const pending = state.pending_combat_card_disposition;
        const id = pending?.cards?.[pending.index];
        if (id == null) return;
        builder.add("retain_combat_card", id);
        builder.add("discard_combat_card_for_draw", id);
      },
      retain_combat_card(state, id) {
        api.resolveCombatCardDisposition(state, id, "retain");
      },
      discard_combat_card_for_draw(state, id) {
        api.resolveCombatCardDisposition(state, id, "draw");
      },
    },

    post_combat_card_window: {
      message(state) {
        const place = api.spaceById[state.combat?.target]?.name || state.combat?.target || "未知地区";
        return `战斗：${place}（选择战后战斗牌）`;
      },
      prompt(state, builder) {
        builder.addAll(
          "combat_card",
          state.hands[state.active].filter((id) =>
            api.postCombatCardLegal(state, api.cardById[id]),
          ),
        );
        builder.enable("pass");
      },
      combat_card: api.playPostCombatCard,
      pass: api.passPostCombatCard,
    },

    combat_losses: {
      message(state) {
        const combat = state.combat;
        if (!combat) return "承受损失。";
        const total =
          combat.pending_side === combat.attacker
            ? combat.attack_loss
            : combat.defense_loss;
        return `损失 ${Math.max(0, total - (combat.remaining_loss || 0))}/${total}`;
      },
      prompt(state, builder) {
        const units = api.legalCombatLossUnitIds(state);
        builder.addAll("take_loss", units);
      },
      take_loss(state, id) {
        const combat = state.combat;
        if (!api.legalCombatLossUnitIds(state).includes(id))
          throw new Error("Unit cannot take this loss");
        api.snapshot(state, "承受战斗损失");
        const applied = api.reduceCombatUnit(state, id);
        combat.remaining_loss = Math.max(0, combat.remaining_loss - applied);
        if (state.pending_replacement) return;
        if (combat.remaining_loss === 0) state.state = "combat_loss_confirm";
      },
    },

    combat_loss_confirm: {
      message(state) {
        const combat = state.combat;
        if (!combat) return "确认损失。";
        const total =
          combat.pending_side === combat.attacker
            ? combat.attack_loss
            : combat.defense_loss;
        const applied = Math.max(0, total - (combat.remaining_loss || 0));
        return `损失 ${applied}/${total}，确认后继续。`;
      },
      prompt(_state, builder) {
        builder.enable("confirm_losses");
      },
      confirm_losses(state) {
        state.state = "combat_losses";
        api.advanceCombatLosses(state);
      },
    },

    combat_replacement: {
      message: "选择替代SCU。",
      prompt(state, builder) {
        builder.addAll("choose_replacement", state.pending_replacement?.options || []);
      },
      choose_replacement(state, id) {
        const pending = state.pending_replacement;
        if (!pending) throw new Error("No pending army replacement");
        api.snapshot(state, "选择替代SCU");
        api.placeCombatReplacement(state, pending, id);
        state.pending_replacement = null;
        if (pending.resume === "retreat_overstack") {
          state.state = "retreat_overstack";
          const retreat = state.pending_retreat;
          if (!retreat.overstack.final ||
              !api.retreatSpaceOverstacked(state, retreat.overstack.space, retreat.faction)) {
            api.finishRetreatOverstack(state);
          }
          return;
        }
        if (pending.resume === "cancel_retreat") {
          api.finishCombatSequence(state);
          return;
        }
        state.state = "combat_losses";
        if (state.combat.remaining_loss === 0)
          state.state = "combat_loss_confirm";
      },
    },

    retreat_cancel: {
      message(state) {
        return api.retreatCancellationTerrainAllowed(state)
          ? "防守方可以承受一步损失取消整次撤退。"
          : "逐单位撤退。";
      },
      prompt(state, builder) {
        const pending = state.pending_retreat;
        if (!api.retreatCancellationTerrainAllowed(state)) {
          builder.enable("proceed_retreat");
          return;
        }
        builder.addAll("cancel_retreat", (pending.units || []).filter((id) =>
          api.canCancelRetreatWithUnit(state, id),
        ));
        builder.enable("proceed_retreat");
      },
      cancel_retreat(state, id) {
        const pending = state.pending_retreat;
        if (pending?.mode !== "mandatory" || !api.canCancelRetreatWithUnit(state, id))
          throw new Error("This unit cannot cancel the retreat");
        api.snapshot(state, "取消撤退损失");
        state.combat.pending_side = pending.faction;
        api.reduceCombatUnit(state, id);
        if (state.pending_replacement) {
          state.pending_replacement.resume = "cancel_retreat";
          return;
        }
        api.finishCombatSequence(state);
      },
      proceed_retreat(state) {
        const pending = state.pending_retreat;
        if (pending?.mode !== "mandatory")
          throw new Error("Only a mandatory retreat may proceed from this state");
        api.snapshot(state, "继续撤退");
        pending.cancel_stage_complete = true;
        state.state = "retreat";
      },
    },

    retreat: {
      message: "逐单位撤退。",
      prompt(state, builder) {
        const pending = state.pending_retreat;
        const selected = pending.selected_unit;
        if (selected) {
          builder.add("deselect_retreat_unit", selected);
          builder.addAll("retreat_destination", api.retreatDestinations(state, api.findUnit(state, selected)));
          if (pending.mode === "movement_optional")
            builder.enable("decline_optional_retreat");
          return;
        }
        for (const id of pending.units || []) {
          const unit = api.findUnit(state, id);
          if (!unit) continue;
          const remaining = Number(pending.remaining?.[id]);
          if (Number.isInteger(remaining) && remaining > 0) {
            if (pending.mode === "movement_optional" || api.retreatUnitHasRoute(state, id, remaining))
              builder.add("select_retreat_unit", id);
            else if (api.isCombatUnit(unit))
              builder.add("eliminate", id);
            continue;
          }
          const legalDistances = (pending.choices || []).filter((distance) =>
            api.retreatUnitHasRoute(state, id, distance),
          );
          if (legalDistances.includes(1)) builder.add("select_retreat_one", id);
          if (legalDistances.includes(2)) builder.add("select_retreat_two", id);
          if (!legalDistances.length && api.isCombatUnit(unit)) builder.add("eliminate", id);
        }
      },
      select_retreat_unit(state, id) {
        const pending = state.pending_retreat;
        const remaining = Number(pending.remaining?.[id]);
        if (pending?.selected_unit || !pending?.units?.includes(id) ||
            !Number.isInteger(remaining) || remaining <= 0 ||
            (pending.mode !== "movement_optional" && !api.retreatUnitHasRoute(state, id, remaining)))
          throw new Error("Unit has no complete legal retreat path");
        pending.selected_unit = id;
      },
      select_retreat_one(state, id) {
        const pending = state.pending_retreat;
        if (pending?.selected_unit || !pending.choices?.includes(1) ||
            pending.remaining?.[id] != null || !api.retreatUnitHasRoute(state, id, 1))
          throw new Error("One-space retreat is not legal");
        pending.remaining[id] = 1;
        pending.selected_unit = id;
      },
      select_retreat_two(state, id) {
        const pending = state.pending_retreat;
        if (pending?.selected_unit || !pending.choices?.includes(2) ||
            pending.remaining?.[id] != null || !api.retreatUnitHasRoute(state, id, 2))
          throw new Error("Two-space retreat is not legal");
        pending.remaining[id] = 2;
        pending.selected_unit = id;
      },
      deselect_retreat_unit(state, id) {
        const pending = state.pending_retreat;
        if (pending?.selected_unit !== id) throw new Error("Unit is not selected");
        pending.selected_unit = null;
      },
      decline_optional_retreat(state) {
        const pending = state.pending_retreat;
        const id = pending?.selected_unit;
        if (pending?.mode !== "movement_optional" || !id || !pending.units.includes(id))
          throw new Error("No optional retreat unit is selected");
        api.snapshot(state, "该单位不撤退");
        pending.declined_units ||= [];
        if (!pending.declined_units.includes(id)) pending.declined_units.push(id);
        pending.units = pending.units.filter((unitId) => unitId !== id);
        pending.selected_unit = null;
        api.log(state, `[[unit:${id}]]选择不撤退。`);
        if (!pending.units.length) api.finishAllRetreats(state);
      },
      eliminate(state, id) {
        const pending = state.pending_retreat;
        const unit = api.findUnit(state, id);
        if (pending?.mode !== "mandatory" || !pending.units.includes(id) || !api.isCombatUnit(unit))
          throw new Error("Unit is not subject to mandatory retreat elimination");
        const distances = pending.remaining?.[id] != null
          ? [Number(pending.remaining[id])]
          : (pending.choices || [Number(pending.steps || 1)]);
        if (distances.some((steps) => api.retreatUnitHasRoute(state, id, steps)))
          throw new Error("A unit may be eliminated only when it has no legal retreat");
        api.snapshot(state, "无法撤退消灭");
        api.eliminateUnit(state, id, "无法撤退");
        pending.units = pending.units.filter((unitId) => unitId !== id);
        if (pending.selected_unit === id) pending.selected_unit = null;
        if (!pending.units.length) api.finishAllRetreats(state);
      },
      retreat_destination(state, destination) {
        const pending = state.pending_retreat;
        const id = pending?.selected_unit;
        const unit = id && api.findUnit(state, id);
        if (!unit || !api.retreatDestinations(state, unit).includes(destination))
          throw new Error("Illegal retreat destination");
        const firstRetreatStep = !Object.values(pending.paths || {}).some(
          (path) => Array.isArray(path) && path.length > 1,
        );
        if (firstRetreatStep) api.clearUndo(state);
        api.snapshot(state, "撤退一步");
        const origin = unit.location;
        unit.location = destination;
        state.combat.resolution_events ||= [];
        state.combat.resolution_events.push({ kind: "retreat", side: unit.faction, unit: id, from: origin, to: destination });
        pending.paths[id] ||= [pending.from];
        pending.paths[id].push(destination);
        pending.remaining[id] = Math.max(0, Number(pending.remaining[id]) - 1);
        pending.selected_unit = null;
        api.log(state, `[[unit:${id}]]撤退：[[space:${origin}]] → [[space:${destination}]]。`);
        const final = pending.remaining[id] === 0;
        if (api.retreatSpaceOverstacked(state, destination, pending.faction)) {
          pending.overstack = { space: destination, unit: id, group: [id], final };
          api.setActiveFaction(state, pending.faction);
          state.state = "retreat_overstack";
        } else if (final) api.finishRetreatUnit(state, id);
        else {
          api.setActiveFaction(state, pending.faction);
          state.state = "retreat";
        }
      },
    },

    retreat_overstack: {
      message: "处理超堆叠。",
      prompt(state, builder) {
        builder.addAll("retreat_loss", api.retreatOverstackLossCandidates(state));
      },
      retreat_loss(state, id) {
        const pending = state.pending_retreat;
        if (!api.retreatOverstackLossCandidates(state, pending).includes(id))
          throw new Error("Unit cannot take the overstack retreat loss");
        const previousState = state.state;
        const previousSide = state.combat.pending_side;
        api.snapshot(state, "撤退超堆叠损失");
        state.combat.pending_side = pending.faction;
        api.reduceCombatUnit(state, id);
        state.combat.pending_side = previousSide;
        if (state.pending_replacement) {
          state.pending_replacement.resume = "retreat_overstack";
          return;
        }
        state.state = previousState;
        if (!pending.overstack.final ||
            !api.retreatSpaceOverstacked(state, pending.overstack.space, pending.faction)) {
          api.finishRetreatOverstack(state);
        }
      },
    },

    advance_select: {
      message: "选择挺进单位。",
      prompt(state, builder) {
        const pending = state.pending_retreat;
        const selected = pending.selected_advance_units || [];
        const selectedOrigin = selected.length ? api.findUnit(state, selected[0])?.location : null;
        const candidates = (pending.advance_group?.length ? [] : pending.units).filter((id) => {
          const unit = api.findUnit(state, id);
          return (
            unit &&
            (!selectedOrigin || unit.location === selectedOrigin) &&
            (selected.includes(id) ||
              pending.maximum == null ||
              unit.type === "hq" ||
              api.advanceCountedUnitCount(state, pending.advanced_ids) +
                api.advanceCountedUnitCount(state, selected) < pending.maximum) &&
            api.advanceSelectionCanAdd(state, pending, [...selected, id])
          );
        });
        builder.addAll("select_advance_unit", candidates.filter((id) => !selected.includes(id)));
        if (selected.length && api.advanceDestinations(state, pending).length)
          builder.addAll("advance_destination", api.advanceDestinations(state, pending));
        if (
          !pending.advance_group?.length ||
          api.advanceGroupStackLegal(
            state,
            pending.advance_group.at(-1),
            selected,
            state.combat.attacker,
          )
        )
          builder.enable("decline_advance");
      },
      select_advance_unit(state, id) {
        const pending = state.pending_retreat;
        if (!pending.units.includes(id)) throw new Error("Unit cannot advance");
        if (pending.advance_group?.length)
          throw new Error("No new unit may join an advance already in progress");
        const unit = api.findUnit(state, id);
        if (
          pending.maximum != null &&
          unit?.type !== "hq" &&
          api.advanceCountedUnitCount(state, pending.advanced_ids) +
            api.advanceCountedUnitCount(state, pending.selected_advance_units) >= pending.maximum &&
          !pending.selected_advance_units.includes(id)
        )
          throw new Error("Advance limit reached");
        const selectedUnits = pending.selected_advance_units
          .map((unitId) => api.findUnit(state, unitId))
          .filter(Boolean);
        if (selectedUnits.length && selectedUnits[0].location !== unit.location)
          throw new Error("An advance group must begin in one attack space");
        const projected = [...pending.selected_advance_units, id];
        if (!api.advanceSelectionCanAdd(state, pending, projected))
          throw new Error("Advance would violate stacking, connection, fort, or occupancy limits");
        if (!pending.selected_advance_units.includes(id)) {
          pending.selected_advance_units.push(id);
          // Ordinary vacant spaces retain the PUG one-click advance.  Against
          // an intact fort, corps may need to be accumulated until the group
          // reaches the printed siege strength; the last required click then
          // performs the advance automatically.
          const supportStillAvailable = pending.units.some((candidateId) => {
            if (pending.selected_advance_units.includes(candidateId)) return false;
            const candidate = api.findUnit(state, candidateId);
            return candidate?.type === "hq" &&
              api.advanceSelectionCanAdd(state, pending, [
                ...pending.selected_advance_units,
                candidateId,
              ]);
          });
          if (!supportStillAvailable && api.advanceDestinations(state, pending).includes(pending.target))
            advanceToDestination(state, pending.target);
        }
      },
      advance_destination: advanceToDestination,
      decline_advance(state) {
        const pending = state.pending_retreat;
        if (pending.advance_group?.length) {
          if (
            !api.advanceGroupStackLegal(
              state,
              pending.advance_group.at(-1),
              pending.selected_advance_units,
              state.combat.attacker,
            )
          )
            throw new Error("The advancing group may not stop overstacked");
          api.finishAdvanceGroup(state);
        } else {
          if (!(pending.advanced_ids || []).length) api.clearUndo(state);
          api.finishCombatSequence(state);
        }
      },
    },

    advance_destination: {
      message: "选择挺进地区。",
      prompt(state, builder) {
        builder.addAll("advance_destination", api.advanceDestinations(state));
        builder.enable("cancel");
      },
      advance_destination(state, destination) {
        advanceToDestination(state, destination);
      },
      cancel(state) {
        state.state = "advance_select";
      },
    },
  };
}

module.exports = { createCombatStates };
