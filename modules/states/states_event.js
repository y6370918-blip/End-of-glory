"use strict";

function createEventStates(api) {
  const {
    advanceWhiteFeatherSr,
    aefPortSpaces,
    AP,
    augustBelgianSpaces,
    augustGunsUnits,
    bulgariaChoiceCandidates,
    cancelEvent,
    cardById,
    cardSpecById,
    combatHqReinforcementSpaces,
    combatFrReplacementOptions,
    combatFrRpConversionCandidates,
    combatFrRpHqSpaces,
    combatRepairCandidates,
    commitAugustGunsReposition,
    commitAugustBelgianRelocation,
    commitDelayedUnits,
    commitFrenchDoctrine,
    commitMoPenaltyAttacks,
    commitMoPenaltyForwardMove,
    commitMoPenaltyLoss,
    commitOptionalDeployment,
    commitNavalPostFortifications,
    commitPiaveExchangeDestination,
    commitReplacementRebuild,
    commitVeteranUpgrade,
    commitReinforcementRebuild,
    commitReinforcements,
    commitScheduledReturns,
    commitSalient,
    commitSpaceRule,
    connectionAllows,
    CP,
    currentPendingHq,
    delayedUnitCandidates,
    desertionImmediateCandidates,
    eventChoice,
    eventSelectionAvailable,
    eventUnitCandidates,
    eventUnits,
    eventUnitSelectionCount,
    finishAefReplacements,
    finishEvent,
    frenchDoctrineCandidates,
    gorlitzMoChoices,
    frontInvestmentPaymentChoices,
    frontUnitPaymentCandidates,
    frontMaintenanceEventChoices,
    frontMaintenanceLossCandidates,
    hqRelocationSpaces,
    hqReturnSpaces,
    hindenburgCanStop,
    hindenburgMarkerCandidates,
    hindenburgRetreatCandidates,
    hindenburgStackCandidates,
    hydrateUnit,
    italyEntryRestorationCandidates,
    immediateReplacementOptions,
    massAttritionCandidates,
    massAttritionMoChoices,
    moPenaltyAttackSelectionOptions,
    moPenaltyForwardOptions,
    moPenaltyLossCandidates,
    moPenaltyLossSelectionComplete,
    moPenaltyLossValue,
    moPenaltySelectedValue,
    optionalDeploySpaces,
    payFrontWithUnit,
    pendingReturnHq,
    placeReturningHq,
    piaveExchangeCandidates,
    piaveReturnSpaces,
    placeCombatFrRpHq,
    regionalRotationCandidates,
    replacementRebuildReserveAllowed,
    replacementRebuildSpaces,
    sackBelgiumCandidates,
    selectHindenburgSpace,
    reinforcementPlacementId,
    reinforcementRebuildCandidates,
    reinforcementRebuildSpaces,
    reinforcementSpaces,
    navalPostFortificationSpaces,
    relocateCombatHq,
    resolveCombatHqReinforcement,
    spaceRuleCandidates,
    spendImmediateRp,
    spendCombatFrRp,
    takeFrontMaintenanceLoss,
    confirmHindenburgLine,
    unitsAt,
    veteranUpgradeEliminatedAllowed,
    veteranUpgradeReserveAllowed,
    veteranUpgradeSpaces,
    whiteFeatherCandidates,
    whiteFeatherSpaces,
  } = api;

  function addEventChoices(builder, options) {
    for (const option of (options || []).filter(Boolean))
      builder.add(
        "event_choose",
        typeof option === "object" ? String(option.id) : option,
        typeof option === "object" ? option.label : undefined,
      );
  }

  function addEventUnits(state, builder, candidates) {
    const legal = [...new Set(candidates || [])];
    const selected = (state.pending_event?.selected_units || []).filter((id) =>
      legal.includes(id),
    );
    const count = eventUnitSelectionCount(state, legal);
    builder.addAll(
      "select_event_unit",
      legal.filter((id) => !selected.includes(id)),
    );
    builder.addAll("deselect_event_unit", selected);
    if (
      state.pending_event?.kind === "reinforcement_rebuild" ||
      selected.length === count
    )
      builder.enable("event_units_confirm");
  }

  function eventUnitActionCandidates(state) {
    const actions = Object.create(null);
    const builder = {
      actions,
      add(action, arg) {
        if (arg === undefined) {
          actions[action] = 1;
          return;
        }
        if (!Array.isArray(actions[action])) actions[action] = [];
        actions[action].push(arg);
      },
      addAll(action, args) {
        for (const arg of args || []) this.add(action, arg);
      },
      enable(action) {
        actions[action] = 1;
      },
    };
    event.prompt(state, builder);
    return [
      ...(actions.select_event_unit || []),
      ...(actions.deselect_event_unit || []),
    ];
  }

  function eventUnitSelectionAutoContinues(state, candidates) {
    const pending = state.pending_event;
    if (!pending || [
      "reinforcement_rebuild",
      "precombat_restore",
      "combat_repair",
      "combat_fr_rp",
      "regional_rotation",
    ].includes(pending.kind)) return false;
    const choice = cardSpecById[pending.card]?.choices?.find(
      (entry) => entry.id === pending.choice,
    );
    if (choice?.select?.optional) return false;
    return (pending.selected_units || []).length ===
      eventUnitSelectionCount(state, candidates);
  }
  const event = {
    message(state) {
      const pending = state.pending_event;
      const card = cardById[pending?.card];
      if (pending?.kind === "reinforcement") return `${card?.title || "增援"}：部署单位。`;
      if (pending?.kind === "replacement_rebuild") {
        if (pending.resume_immediate_rp || pending.resume_combat_fr_rp || card)
          return `${card?.title || "事件"}：选择重建位置。`;
        return "补员：选择重建位置。";
      }
      if (pending?.kind === "veteran_upgrade")
        return "补员：选择老兵替换位置。";
      if (pending?.kind === "scheduled_return") return "部署返场单位。";
      if (pending?.kind === "mo_penalty") return "处理未完成MO。";
      if (pending?.kind === "august_reposition") return "八月炮火：重部署。";
      return card?.title || "事件。";
    },
    event_choose(state, id) {
      if (["front_maintenance", "front_investment"].includes(state.pending_event?.kind))
        api.snapshot(state, "战线支付");
      eventChoice(state, id);
    },
    spend_flip(state, id) {
      const combatTemporary = state.pending_event?.kind === "combat_fr_rp";
      const option = (combatTemporary
        ? combatFrReplacementOptions(state)
        : immediateReplacementOptions(state)).find(
        (candidate) => candidate.kind === "flip" && candidate.unit === id,
      );
      if (!option) throw new Error("Illegal immediate RP repair");
      api.snapshot(state, "补员修复");
      (combatTemporary ? spendCombatFrRp : spendImmediateRp)(state, `flip:${id}:${option.key}`);
    },
    spend_upgrade(state, id) {
      const combatTemporary = state.pending_event?.kind === "combat_fr_rp";
      const option = (combatTemporary
        ? combatFrReplacementOptions(state)
        : immediateReplacementOptions(state)).find(
        (candidate) => candidate.kind === "upgrade" && candidate.unit === id,
      );
      if (!option) throw new Error("Illegal immediate RP upgrade");
      api.snapshot(state, "老兵升级");
      (combatTemporary ? spendCombatFrRp : spendImmediateRp)(state, `upgrade:${id}:${option.key}`);
    },
    spend_rebuild(state, id) {
      const combatTemporary = state.pending_event?.kind === "combat_fr_rp";
      const option = (combatTemporary
        ? combatFrReplacementOptions(state)
        : immediateReplacementOptions(state)).find(
        (candidate) => candidate.kind === "rebuild" && candidate.unit === id,
      );
      if (!option) throw new Error("Illegal immediate RP rebuild");
      api.snapshot(state, "单位重建");
      (combatTemporary ? spendCombatFrRp : spendImmediateRp)(state, `rebuild:${id}:${option.key}`);
    },
    spend_option(state, token) {
      api.snapshot(state, "补员支付");
      if (state.pending_event?.kind === "combat_fr_rp") spendCombatFrRp(state, token);
      else spendImmediateRp(state, token);
    },
    front_unit_payment(state, id) {
      api.snapshot(state, "俄国战线单位支付");
      payFrontWithUnit(state, id);
    },
    front_maintenance_loss(state, token) {
      api.snapshot(state, "战线维持损耗");
      takeFrontMaintenanceLoss(state, token);
    },
    replacement_to_reserve(state) {
      api.snapshot(state, "放入预备区");
      if (state.pending_event?.kind === "veteran_upgrade")
        commitVeteranUpgrade(state, "reserve");
      else
        commitReplacementRebuild(state, "reserve");
    },
    replacement_to_eliminated(state) {
      api.snapshot(state, "留在消灭区");
      commitVeteranUpgrade(state, "eliminated");
    },
    select_mo_penalty_unit(state, id) {
      const pending = state.pending_event;
      const legal = moPenaltyLossCandidates(
        state,
        pending?.penalized,
        pending?.nation,
      );
      if (
        pending?.kind !== "mo_penalty" ||
        pending.stage !== "loss" ||
        !legal.includes(id)
      )
        throw new Error("Illegal MO penalty unit");
      pending.selected_units ||= [];
      if (
        !pending.selected_units.includes(id) &&
        moPenaltySelectedValue(state, pending) +
          moPenaltyLossValue(state, id) >
          pending.loss_required
      )
        throw new Error("MO penalty selection exceeds the required RP value");
      if (!pending.selected_units.includes(id)) pending.selected_units.push(id);
    },
    deselect_mo_penalty_unit(state, id) {
      const pending = state.pending_event;
      if (!pending?.selected_units?.includes(id))
        throw new Error("MO penalty unit is not selected");
      pending.selected_units = pending.selected_units.filter(
        (candidate) => candidate !== id,
      );
    },
    confirm_mo_penalty_loss: commitMoPenaltyLoss,
    reinforcement_to_reserve(state) {
      const pending = state.pending_event;
      if (pending?.kind === "aef_replacements") {
        if (pending.stage !== "place" || pending.index >= pending.units.length)
          throw new Error("No AEF replacement is awaiting placement");
        pending.placements.push({ destination: "reserve" });
        pending.index += 1;
        return;
      }
      if (
        pending?.kind === "reinforcement_rebuild" &&
        pending.rebuild_stage === "place"
      ) {
        const id = pending.selected_units?.[pending.rebuild_index || 0];
        const unit = state.eliminated[pending.operation.rebuild.faction].find(
          (candidate) => candidate.id === id,
        );
        if (unit?.type !== "corps")
          throw new Error("Only an SCU may rebuild into the reserve box");
        pending.rebuild_placements.push({ id, destination: "reserve" });
        pending.rebuild_index += 1;
        return;
      }
      const current = pending?.queue?.[pending.index];
      if (
        !["reinforcement", "scheduled_return"].includes(pending?.kind) ||
        !current?.reserve_optional
      )
        throw new Error("This reinforcement cannot enter the reserve box");
      pending.placements.push({
        id: reinforcementPlacementId(state, current),
        piece: current.piece,
        reduced: current.reduced,
        definition_index: current.definition_index,
        copy_index: current.copy_index,
        destination: "reserve",
      });
      pending.index += 1;
    },
    select_event_unit(state, id) {
      const candidates = eventUnitActionCandidates(state);
      if (!candidates.includes(id)) throw new Error("Illegal event unit");
      const pending = state.pending_event;
      pending.selected_units ||= [];
      if (pending.selected_units.includes(id)) return;
      const maximum = eventUnitSelectionCount(state, candidates);
      if (pending.selected_units.length >= maximum)
        throw new Error("Too many event units selected");
      pending.selected_units.push(id);
      const refreshed = eventUnitActionCandidates(state);
      if (eventUnitSelectionAutoContinues(state, refreshed))
        event.event_units_confirm(state);
    },
    deselect_event_unit(state, id) {
      const pending = state.pending_event;
      if (!pending?.selected_units?.includes(id))
        throw new Error("Event unit is not selected");
      pending.selected_units = pending.selected_units.filter(
        (unitId) => unitId !== id,
      );
    },
    select_august_unit(state, id) {
      const pending = state.pending_event;
      if (
        pending?.kind !== "august_reposition" ||
        !augustGunsUnits(state, pending).includes(id)
      )
        throw new Error("Illegal August Guns unit");
      pending.selected_units ||= [];
      pending.selected_units.push(id);
    },
    deselect_august_unit(state, id) {
      const pending = state.pending_event;
      if (
        pending?.kind !== "august_reposition" ||
        !pending.selected_units?.includes(id)
      )
        throw new Error("August Guns unit is not selected");
      pending.selected_units = pending.selected_units.filter(
        (unitId) => unitId !== id,
      );
    },
    finish_august_reposition(state) {
      const pending = state.pending_event;
      if (pending?.kind !== "august_reposition")
        throw new Error("August Guns reposition is not active");
      if (pending.selected_units?.length)
        throw new Error("Place or deselect the selected units first");
      finishEvent(state, cardById[pending.card]);
    },
    event_units_confirm(state) {
      const pending = state.pending_event;
      if (!pending) throw new Error("No pending event");
      if (pending.kind === "reinforcement_rebuild") {
        const legal = new Set(reinforcementRebuildCandidates(state, pending));
        const selected = (pending.selected_units || []).slice();
        if (
          selected.length > pending.maximum ||
          new Set(selected).size !== selected.length ||
          selected.some((id) => !legal.has(id))
        )
          throw new Error("Invalid reinforcement rebuild selection");
        pending.rebuild_stage = "place";
        pending.rebuild_index = 0;
        pending.rebuild_placements = [];
        return;
      }
      const selected = (pending.selected_units || []).slice();
      delete pending.selected_units;
      eventUnits(state, selected);
    },
    event_space(state, space) {
      const pending = state.pending_event;
      const card = pending && cardById[pending.card];
      if (pending?.kind === "salient") {
        commitSalient(state, space);
        return;
      }
      if (pending?.kind === "mo_penalty") {
        if (pending.stage === "forward_origin") {
          if (
            !moPenaltyForwardOptions(state, pending.penalized).some(
              (entry) => entry.origin === space,
            )
          )
            throw new Error("Illegal forward-movement stack");
          pending.origin = space;
          pending.stage = "forward_leave";
          return;
        }
        if (pending.stage === "forward_target") {
          commitMoPenaltyForwardMove(state, pending, space);
          return;
        }
        if (pending.stage === "origin") {
          if (!moPenaltyAttackSelectionOptions(state, pending).includes(space))
            throw new Error("Illegal forced-attack origin");
          pending.selected.push(space);
          pending.stage =
            pending.selected.length === pending.required ? "confirm" : "origin";
          return;
        }
        throw new Error("The MO penalty is not selecting a space");
      }
      if (pending?.kind === "combat_hq_reinforcement") {
        resolveCombatHqReinforcement(state, space);
        return;
      }
      if (pending?.kind === "combat_fr_rp" && pending.mode === "hq") {
        placeCombatFrRpHq(state, space);
        return;
      }
      if (pending?.kind === "hq_relocation") {
        relocateCombatHq(state, pending, space);
        return;
      }
      if (pending?.kind === "hq_return") {
        placeReturningHq(state, pending, space);
        return;
      }
      if (pending?.kind === "counterattack") {
        if (pending.stage !== "origin" || !pending.origins.includes(space))
          throw new Error("Illegal counterattack origin");
        const attackers = state.units
          .filter(
            (unit) =>
              unit.faction === AP &&
              ["army", "corps"].includes(unit.type) &&
              connectionAllows(unit.location, space, "attack", AP),
          )
          .map((unit) => unit.id);
        if (!attackers.length || !unitsAt(state, space, CP).length)
          throw new Error("Counterattack has no legal participants");
        state.pending_event = null;
        state.active = AP;
        state.combat_window = {
          declaration: { attackers, target: space },
          attacker: AP,
          defender: CP,
          side: AP,
          cards: [],
          counterattack_card: card.id,
          prohibit_combat_cards: true,
        };
        state.state = "combat_card_window";
        return;
      }
      if (pending?.kind === "nivelle_attacks") {
        if (
          !pending.candidates.includes(space) ||
          pending.spaces.includes(space) ||
          pending.spaces.length >= pending.required
        )
          throw new Error("Illegal Nivelle attack marker");
        pending.spaces.push(space);
        return;
      }
      if (pending?.kind === "french_doctrine") {
        if (
          !frenchDoctrineCandidates(state, pending).includes(space) ||
          pending.spaces.length >= pending.required
        )
          throw new Error("Illegal French offensive marker");
        pending.spaces.push(space);
        return;
      }
      if (pending?.kind === "aef_replacements") {
        if (
          pending.stage !== "place" ||
          !aefPortSpaces(state, pending).includes(space)
        )
          throw new Error("Illegal AEF port");
        pending.placements.push({ destination: "map", space });
        pending.index += 1;
        return;
      }
      if (pending?.kind === "replacement_rebuild") {
        commitReplacementRebuild(state, space);
        return;
      }
      if (pending?.kind === "veteran_upgrade") {
        commitVeteranUpgrade(state, space);
        return;
      }
      if (
        pending?.kind === "reinforcement_rebuild" &&
        pending.rebuild_stage === "place"
      ) {
        if (!reinforcementRebuildSpaces(state, pending).includes(space))
          throw new Error("Illegal reinforcement rebuild space");
        const id = pending.selected_units[pending.rebuild_index || 0];
        pending.rebuild_placements.push({ id, destination: "map", space });
        pending.rebuild_index += 1;
        return;
      }
      if (
        pending?.kind === "reinforcement" &&
        pending.index >= pending.queue.length &&
        pending.naval_event &&
        pending.operation.naval_post_fortification
      ) {
        if (!navalPostFortificationSpaces(state, pending).includes(space))
          throw new Error("Illegal naval fortification space");
        pending.post_fortification_spaces ||= [];
        pending.post_fortification_spaces.push(space);
        return;
      }
      if (["reinforcement", "scheduled_return"].includes(pending?.kind)) {
        if (pending.kind === "reinforcement" && pending.exchange) {
          commitPiaveExchangeDestination(state, pending, space);
          return;
        }
        if (!reinforcementSpaces(state, pending).includes(space))
          throw new Error("Illegal reinforcement space");
        const current = pending.queue[pending.index];
        pending.placements.push({
          id:
            pending.kind === "reinforcement"
              ? reinforcementPlacementId(state, current)
              : undefined,
          piece: current.piece,
          reduced: current.reduced,
          definition_index: current.definition_index,
          copy_index: current.copy_index,
          destination: "map",
          space,
        });
        pending.index += 1;
        return;
      }
      if (pending?.kind === "hindenburg_line") {
        selectHindenburgSpace(state, space);
        return;
      }
      if (pending?.kind === "space_rule") {
        if (!spaceRuleCandidates(state, pending).includes(space))
          throw new Error("Illegal event space");
        pending.space = space;
        return;
      }
      if (pending?.kind === "optional_deploy") {
        if (
          pending.mode !== "deploy" ||
          !optionalDeploySpaces(state, pending).includes(space)
        )
          throw new Error("Illegal optional reinforcement space");
        pending.placements.push({ space });
        pending.index += 1;
        return;
      }
      if (pending?.kind === "white_feather_sr") {
        if (!whiteFeatherSpaces(state, pending).includes(space))
          throw new Error("Illegal White Feather SR destination");
        const index = state.reserves.ap.findIndex(
          (unit) => unit.id === pending.unit,
        );
        if (index < 0)
          throw new Error("White Feather reserve corps is no longer available");
        const [unit] = state.reserves.ap.splice(index, 1);
        hydrateUnit(unit);
        unit.location = space;
        unit.moved = false;
        unit.attacked = false;
        state.units.push(unit);
        advanceWhiteFeatherSr(state, pending, card);
        return;
      }
      if (pending?.kind === "august_reposition") {
        commitAugustGunsReposition(state, pending, space);
        return;
      }
      if (pending?.kind === "august_belgian_relocation") {
        commitAugustBelgianRelocation(state, pending, space);
        return;
      }
      const choice = cardSpecById[card?.id]?.choices?.find(
        (candidate) => candidate.id === pending.choice,
      );
      if (!choice?.select || choice.select.kind !== "space")
        throw new Error("Event is not selecting a space");
      if (!(choice.select.spaces || []).includes(space))
        throw new Error("Illegal event space");
      pending.space = space;
    },
    event_confirm(state) {
      const pending = state.pending_event;
      const card = pending && cardById[pending.card];
      if (pending?.kind === "mo_penalty") {
        if (pending.stage !== "confirm")
          throw new Error("Select every forced attack first");
        commitMoPenaltyAttacks(state, pending);
        return;
      }
      if (pending?.kind === "nivelle_attacks") {
        if (pending.spaces.length !== pending.required)
          throw new Error("Place every Nivelle attack marker");
        state.ops ||= { remaining: 0, activated: [], forced_attacks: [] };
        state.ops.source = "nivelle";
        state.ops.source_id = pending.card;
        state.ops.forced_attacks = [
          ...new Set([...(state.ops.forced_attacks || []), ...pending.spaces]),
        ];
        state.ops.forced_loss_adjust = pending.loss_adjust;
        for (const space of pending.spaces) state.activations[space] = "attack";
        state.pending_event = null;
        state.active = AP;
        state.state = "ops_activate";
        return;
      }
      if (pending?.kind === "french_doctrine") {
        commitFrenchDoctrine(state, pending);
        return;
      }
      if (pending?.kind === "aef_replacements") {
        if (pending.index !== pending.units.length)
          throw new Error("Place every AEF replacement first");
        finishAefReplacements(state, pending);
        return;
      }
      if (pending?.kind === "scheduled_return") {
        if (pending.index !== pending.queue.length)
          throw new Error("Place every returning unit first");
        commitScheduledReturns(state, pending);
        return;
      }
      if (pending?.kind === "reinforcement") {
        if (pending.index !== pending.queue.length)
          throw new Error("Place every reinforcement first");
        const postFortification =
          pending.naval_event && pending.operation.naval_post_fortification;
        if (
          postFortification &&
          (pending.post_fortification_spaces || []).length !==
            postFortification.count
        )
          throw new Error("Select every naval fortification space");
        if (pending.operation.rebuild) {
          pending.kind = "reinforcement_rebuild";
          pending.rebuild_stage = "select";
          pending.maximum = Math.min(
            pending.operation.rebuild.count,
            reinforcementRebuildCandidates(state, pending).length,
          );
          pending.selected_units = [];
          pending.rebuild_placements = [];
          pending.rebuild_index = 0;
          return;
        }
        const created = commitReinforcements(state, pending);
        commitNavalPostFortifications(state, pending);
        const optional = pending.operation.optional_deploy;
        const requiredEvent =
          optional && cardById[optional.requires_event_card]?.event;
        if (
          optional &&
          state.events[requiredEvent] &&
          state.rp[optional.rp.faction][optional.rp.nation] >=
            optional.rp.amount
        ) {
          pending.kind = "optional_deploy";
          pending.units = created
            .filter(
              (unit) =>
                unit.piece === optional.piece &&
                state.eliminated[unit.faction].some(
                  (entry) => entry.id === unit.id,
                ),
            )
            .slice(0, optional.count);
          pending.index = 0;
          pending.placements = [];
          return;
        }
        finishEvent(state, card);
        return;
      }
      if (pending?.kind === "reinforcement_rebuild") {
        if (
          pending.rebuild_stage !== "place" ||
          pending.rebuild_index !== (pending.selected_units || []).length
        )
          throw new Error("Place every reinforcement rebuild first");
        commitReinforcementRebuild(state, pending);
        commitReinforcements(state, pending);
        commitNavalPostFortifications(state, pending);
        finishEvent(state, card);
        return;
      }
      if (pending?.kind === "optional_deploy") {
        if (pending.index !== pending.units.length)
          throw new Error("Place every optional reinforcement");
        commitOptionalDeployment(state, pending);
        finishEvent(state, card);
        return;
      }
      if (pending?.kind === "delay_units") {
        if (pending.index !== pending.queue.length)
          throw new Error("Select every delayed unit");
        commitDelayedUnits(state, pending);
        finishEvent(state, card);
        return;
      }
      if (pending?.kind === "hindenburg_line") {
        confirmHindenburgLine(state);
        return;
      }
      if (pending?.kind === "space_rule") {
        if (!pending.space) throw new Error("Choose an event space first");
        commitSpaceRule(state, pending);
        if (pending.operation.key === "august_guns") {
          if (pending.belgian_units?.length) {
            pending.kind = "august_belgian_relocation";
            pending.chooser = AP;
            state.active = AP;
          } else {
            pending.kind = "august_reposition";
            pending.units = [];
            pending.selected_units = [];
          }
          return;
        }
        finishEvent(state, card);
        return;
      }
      const choice = cardSpecById[card?.id]?.choices?.find(
        (candidate) => candidate.id === pending.choice,
      );
      if (!choice) throw new Error("Choose an event option first");
      finishEvent(state, card, choice.effects || []);
    },
    event_cancel: cancelEvent,
  };
  event.prompt = function promptEvent(state, builder) {
    const actions = builder.actions;
      const pending = state.pending_event;
      const card = pending && cardById[pending.card];
      const spec = card && cardSpecById[card.id];
      const choice = spec?.choices?.find(
        (candidate) => candidate.id === pending.choice,
      );
      if (
        state.active === pending.owner &&
        !pending.locked &&
        ![
          "scheduled_return",
          "ohl",
          "optional_deploy",
          "august_reposition",
          "august_belgian_relocation",
          "precombat_restore",
          "combat_repair",
          "combat_fr_rp",
          "desertion_immediate",
          "desertion_combat_loss",
          "counterattack",
          "nivelle_attacks",
          "bulgaria_front_response",
          "aef_replacements",
          "mo_counterattack",
          "hq_relocation",
          "hq_return",
          "front_maintenance",
          "front_investment",
          "veteran_upgrade",
          "replacement_rebuild",
          "mo_penalty",
          "immediate_rp",
          "killing_ground_maintenance",
          "salient",
        ].includes(pending.kind)
      )
        actions.event_cancel = 1;
      if (pending.kind === "hindenburg_line" && pending.stage !== "stack")
        delete actions.event_cancel;
      if (pending.kind === "replacement_rebuild") {
        actions.event_space = replacementRebuildSpaces(state, pending);
        if (replacementRebuildReserveAllowed(state, pending))
          actions.replacement_to_reserve = 1;
      } else if (pending.kind === "salient") {
        actions.event_space = pending.spaces.slice();
      } else if (pending.kind === "mo_penalty") {
        if (pending.stage === "mode") {
          const options = [];
          if (pending.required)
            options.push({
              id: "attack",
              label: `放置 ${pending.required} 个强制进攻标记`,
            });
          if (pending.forward_available)
            options.push({
              id: "forward",
              label: "留下一个战斗单位，其余向前移动一格",
            });
          if (pending.loss_required)
            options.push({
              id: "loss",
              label: `改为非致命减员 ${pending.loss_required} RP`,
            });
          addEventChoices(builder, options);
        } else if (pending.stage === "forward_origin") {
          actions.event_space = [
            ...new Set(
              moPenaltyForwardOptions(state, pending.penalized).map(
                (entry) => entry.origin,
              ),
            ),
          ];
        } else if (pending.stage === "forward_leave") {
          addEventUnits(state, builder, [
            ...new Set(
              moPenaltyForwardOptions(state, pending.penalized)
                .filter((entry) => entry.origin === pending.origin)
                .map((entry) => entry.leave),
            ),
          ]);
        } else if (pending.stage === "forward_target") {
          actions.event_space =
            moPenaltyForwardOptions(state, pending.penalized).find(
              (entry) =>
                entry.origin === pending.origin &&
                entry.leave === pending.leave,
            )?.targets || [];
        } else if (pending.stage === "origin") {
          actions.event_space = moPenaltyAttackSelectionOptions(state, pending);
        } else if (pending.stage === "confirm") actions.event_confirm = 1;
        else if (pending.stage === "loss") {
          const candidates = moPenaltyLossCandidates(
            state,
            pending.penalized,
            pending.nation,
          );
          const selected = pending.selected_units || [];
          actions.select_mo_penalty_unit = candidates.filter(
            (id) =>
              !selected.includes(id) &&
              moPenaltySelectedValue(state, pending) +
                moPenaltyLossValue(state, id) <=
                pending.loss_required,
          );
          actions.deselect_mo_penalty_unit = selected.slice();
          if (moPenaltyLossSelectionComplete(state, pending))
            actions.confirm_mo_penalty_loss = 1;
        }
      } else if (pending.kind === "immediate_rp") {
        if (pending.mode === "choice")
          addEventChoices(builder, [
            { id: "spend", label: "立即使用" },
            { id: "bank", label: "留到补员阶段" },
          ]);
        else {
          const options = immediateReplacementOptions(state);
          for (const kind of ["flip", "upgrade", "rebuild"]) {
            const grouped = new Map();
            for (const option of options.filter((entry) => entry.kind === kind)) {
              if (!grouped.has(option.unit)) grouped.set(option.unit, []);
              grouped.get(option.unit).push(option);
            }
            for (const [unit, entries] of grouped)
              if (entries.length === 1) builder.add(`spend_${kind}`, unit);
              else
                for (const entry of entries)
                  builder.add(
                    "spend_option",
                    `${kind}:${unit}:${entry.key}`,
                    `${kind} ${unit} / ${entry.key.toUpperCase()}`,
                  );
          }
          addEventChoices(builder, [{ id: "done", label: "完成" }]);
        }
      } else if (pending.kind === "sack_belgium") {
        addEventUnits(state, builder, sackBelgiumCandidates(state));
      } else if (pending.kind === "gorlitz_mo") {
        addEventChoices(
          builder,
          gorlitzMoChoices(state, pending).map((id) => ({
            id,
            label: api.moDefinition(state, id)?.name || id,
          })),
        );
      } else if (pending.kind === "front_maintenance") {
        addEventChoices(builder, frontMaintenanceEventChoices(state, pending));
        for (const token of frontMaintenanceLossCandidates(state, pending)) {
          const [id, key] = token.split(":");
          const unit = [...state.units, ...(state.reserves[pending.owner] || [])]
            .find((candidate) => candidate.id === id);
          builder.add(
            "front_maintenance_loss",
            token,
            `减损 ${api.pieceById[unit?.piece]?.name || id}（${key.toUpperCase()}:RP）`,
          );
        }
      } else if (pending.kind === "killing_ground_maintenance") {
        const options = [{ id: "abandon", label: "放弃处刑地" }];
        if (state.rp.cp.ge >= pending.cost)
          options.unshift({
            id: "maintain",
            label: `支付 ${pending.cost} GE:RP`,
          });
        addEventChoices(builder, options);
      } else if (pending.kind === "front_investment") {
        addEventChoices(builder, frontInvestmentPaymentChoices(state, pending));
        builder.addAll("front_unit_payment", frontUnitPaymentCandidates(state, pending));
      } else if (pending.kind === "veteran_upgrade") {
        actions.event_space = veteranUpgradeSpaces(state, pending);
        if (veteranUpgradeReserveAllowed(state, pending))
          actions.replacement_to_reserve = 1;
        if (veteranUpgradeEliminatedAllowed(state, pending))
          actions.replacement_to_eliminated = 1;
      } else if (pending.kind === "hq_relocation") {
        const hq = currentPendingHq(state, pending);
        actions.event_space = hq ? hqRelocationSpaces(state, hq) : [];
        addEventChoices(builder, [
          {
            id: "turn_track",
            label: "将领放置到回合轨",
          },
        ]);
      } else if (pending.kind === "hq_return") {
        const hq = pendingReturnHq(state, pending);
        actions.event_space = hq ? hqReturnSpaces(state, hq) : [];
      } else if (pending.kind === "bulgaria_choice") {
        if (pending.mode === "remove")
          addEventUnits(state, builder, bulgariaChoiceCandidates(state, pending));
        else {
          const options = [
            {
              id: "vp",
              label: `同盟国 +${pending.schedule.alternative_vp} VP`,
            },
          ];
          if (bulgariaChoiceCandidates(state, pending).length)
            options.unshift({
              id: "remove",
              label: "永久移除 1 个法国 LCU",
            });
          addEventChoices(builder, options);
        }
      } else if (pending.kind === "bulgaria_front_response") {
        addEventChoices(builder, [
          { id: "use", label: "支付 1 GE:RP，土耳其战线后退 1 格" },
          { id: "skip", label: "不使用保加利亚战线响应" },
        ]);
      } else if (pending.kind === "aef_replacements") {
        if (pending.index < pending.units.length) {
          actions.event_space = aefPortSpaces(state, pending);
          actions.reinforcement_to_reserve = 1;
        } else actions.event_confirm = 1;
      } else if (pending.kind === "mo_counterattack") {
        addEventChoices(builder, [
          { id: "use", label: "立即以此堆发动美国 MO 反击" },
          { id: "skip", label: "不发动反击" },
        ]);
      } else if (pending.kind === "italy_entry_restore") {
        addEventUnits(state, builder, italyEntryRestorationCandidates(state, pending));
      } else if (pending.kind === "reinforcement_rebuild") {
        if (pending.rebuild_stage === "select")
          addEventUnits(state, builder, reinforcementRebuildCandidates(state, pending));
        else if (pending.rebuild_index < (pending.selected_units || []).length) {
          actions.event_space = reinforcementRebuildSpaces(state, pending);
          const id = pending.selected_units[pending.rebuild_index || 0];
          const unit = state.eliminated[pending.operation.rebuild.faction].find(
            (candidate) => candidate.id === id,
          );
          if (unit?.type === "corps") actions.reinforcement_to_reserve = 1;
        } else actions.event_confirm = 1;
      } else if (pending.kind === "precombat_restore") {
        addEventUnits(state, builder, pending.candidates.slice());
        addEventChoices(builder, [{ id: "done", label: "不再恢复，继续战斗" }]);
      } else if (pending.kind === "combat_repair") {
        if (pending.replacement_choice)
          addEventChoices(builder, [
            { id: "return", label: "将替代SCU送回预备区" },
            { id: "keep", label: "保留替代SCU" },
          ]);
        else {
          addEventUnits(state, builder, combatRepairCandidates(state, pending));
          addEventChoices(builder, [{ id: "done", label: "完成战斗后修复" }]);
        }
      } else if (pending.kind === "combat_hq_reinforcement") {
        actions.event_space = combatHqReinforcementSpaces(state, pending);
        if (!pending.required)
          addEventChoices(builder, [{ id: "skip", label: "不部署将领" }]);
      } else if (pending.kind === "combat_fr_rp") {
        if (pending.mode === "hq")
          actions.event_space = combatFrRpHqSpaces(state, pending);
        else if (pending.mode === "replacement")
          addEventUnits(state, builder, pending.replacement?.options || []);
        else if (pending.mode === "convert") {
          addEventUnits(state, builder, combatFrRpConversionCandidates(state, pending));
          addEventChoices(builder, [{ id: "done", label: "结束减损" }]);
        } else {
          for (const option of combatFrReplacementOptions(state, pending))
            builder.add(`spend_${option.kind}`, option.unit);
          addEventChoices(builder, [{ id: "done", label: "完成" }]);
        }
      } else if (pending.kind === "desertion_immediate") {
        if (!pending.branch) {
          const options = [];
          if (
            desertionImmediateCandidates(state, "lcu").length >=
            pending.required
          )
            options.push({
              id: "lcu",
              label: `减损 ${pending.required} 个意大利 LCU`,
            });
          if (
            desertionImmediateCandidates(state, "scu").length >=
            pending.required
          )
            options.push({
              id: "scu",
              label: `消灭 ${pending.required} 个意大利 SCU`,
            });
          addEventChoices(builder, options);
        } else
          addEventUnits(
            state,
            builder,
            desertionImmediateCandidates(state, pending.branch),
          );
      } else if (pending.kind === "desertion_combat_loss") {
        addEventUnits(
          state,
          builder,
          pending.candidates.filter((id) =>
            state.units.some((unit) => unit.id === id),
          ),
        );
      } else if (pending.kind === "counterattack") {
        if (pending.stage === "cards") {
          const id = pending.cards[pending.index];
          const options = [
            { id: `return:${id}`, label: `将 ${cardById[id].title} 返回手牌` },
          ];
          if (cardById[id].remove)
            options.push({
              id: `remove:${id}`,
              label: `移除 ${cardById[id].title}`,
            });
          addEventChoices(builder, options);
        } else actions.event_space = pending.origins.slice();
      } else if (pending.kind === "nivelle_attacks") {
        actions.event_space =
          pending.spaces.length < pending.required
            ? pending.candidates.filter(
                (space) => !pending.spaces.includes(space),
              )
            : [];
        if (pending.spaces.length === pending.required)
          actions.event_confirm = 1;
      } else if (pending.kind === "french_doctrine") {
        actions.event_space =
          pending.spaces.length < pending.required
            ? frenchDoctrineCandidates(state, pending)
            : [];
        if (pending.spaces.length === pending.required)
          actions.event_confirm = 1;
      } else if (["reinforcement", "scheduled_return"].includes(pending.kind)) {
        if (pending.index < pending.queue.length) {
          actions.event_space =
            pending.kind === "reinforcement" && pending.exchange
              ? piaveReturnSpaces(state, pending)
              : reinforcementSpaces(state, pending);
          if (pending.kind === "reinforcement" && !pending.exchange)
            addEventChoices(
              builder,
              piaveExchangeCandidates(state, pending).map((id) => ({
                id: `exchange:${id}`,
                label: `替换 ${id}`,
              })),
            );
          if (
            pending.kind === "reinforcement" &&
            pending.queue[pending.index]?.reserve_optional
          )
            actions.reinforcement_to_reserve = 1;
        } else {
          const post =
            pending.kind === "reinforcement" &&
            pending.naval_event &&
            pending.operation.naval_post_fortification;
          if (
            post &&
            (pending.post_fortification_spaces || []).length < post.count
          )
            actions.event_space = navalPostFortificationSpaces(state, pending);
          else actions.event_confirm = 1;
        }
      } else if (pending.kind === "card_search") {
        addEventChoices(builder, pending.cards.map((id) => ({
          id: String(id),
          label: cardById[id].title,
        })));
      } else if (pending.kind === "white_feather_sr") {
        const candidates = whiteFeatherCandidates(state, pending);
        if (pending.unit)
          actions.event_space = whiteFeatherSpaces(state, pending);
        else if (candidates.length) addEventUnits(state, builder, candidates);
        else
          addEventChoices(builder, [
            { id: "skip", label: "该国预备役没有可用 SCU，跳过" },
          ]);
      } else if (pending.kind === "august_reposition") {
        const selected = pending.selected_units || [];
        actions.select_august_unit = augustGunsUnits(state, pending);
        actions.deselect_august_unit = selected.slice();
        if (selected.length) actions.event_space = [pending.space];
        else actions.finish_august_reposition = 1;
      } else if (pending.kind === "august_belgian_relocation") {
        actions.event_space = augustBelgianSpaces(state, pending);
      } else if (pending.kind === "ohl") {
        const options = pending.cards.map((id) => ({
          id: String(id),
          label: `${pending.stage === "discard" ? "弃置" : "取回"}：${cardById[id].title}`,
        }));
        if (pending.stage === "discard")
          options.push({ id: "skip", label: "不使用最高统帅部" });
        addEventChoices(builder, options);
      } else if (pending.kind === "regional_rotation") {
        if (pending.mode === "reduce")
          addEventUnits(state, builder, regionalRotationCandidates(state));
        else {
          const options = [
            { id: "skip", label: "仅获得本回合 1 FR:RP" },
          ];
          if (regionalRotationCandidates(state).length)
            options.unshift({
              id: "reduce",
              label: "减损 1 个法国单位，额外获得 1 FR:RP",
            });
          addEventChoices(builder, options);
        }
      } else if (pending.kind === "hindenburg_line") {
        if (pending.stage === "stack")
          actions.event_space = hindenburgStackCandidates(state);
        else if (pending.stage === "retreat") {
          actions.event_space = hindenburgRetreatCandidates(state, pending);
          if (hindenburgCanStop(state, pending)) actions.event_confirm = 1;
        } else if (pending.stage === "markers") {
          if (pending.markers.length < (pending.operation.marker_count || 2))
            actions.event_space = hindenburgMarkerCandidates(state, pending);
          if (pending.markers.length === (pending.operation.marker_count || 2))
            actions.event_confirm = 1;
        }
      } else if (pending.kind === "space_rule") {
        if (pending.space) actions.event_confirm = 1;
        else actions.event_space = spaceRuleCandidates(state, pending);
      } else if (pending.kind === "optional_deploy") {
        if (pending.mode !== "deploy")
          addEventChoices(builder, [
            { id: "deploy", label: "支付 4 AH:RP，部署 2 个奥匈 LCU" },
            { id: "skip", label: "保留在消灭区" },
          ]);
        else if (pending.index < pending.units.length)
          actions.event_space = optionalDeploySpaces(state, pending);
        else actions.event_confirm = 1;
      } else if (pending.kind === "mass_attrition") {
        if (pending.stage === "mo")
          addEventChoices(builder, massAttritionMoChoices(state).map((entry) => ({
            id: `mo:${entry.nation}:${entry.id}`,
            label: `${entry.nation.toUpperCase()}：${api.moDefinition(state, entry.id)?.name || entry.id}`,
          })));
        else if (pending.mode === "replacement")
          addEventUnits(state, builder, pending.replacement?.options || []);
        else
          addEventUnits(state, builder, massAttritionCandidates(state, state.active));
      } else if (pending.kind === "delay_units") {
        if (pending.index < pending.queue.length)
          addEventUnits(state, builder, delayedUnitCandidates(state, pending));
        else actions.event_confirm = 1;
      } else if (!choice) {
        addEventChoices(builder, (spec?.choices || [])
          .filter((candidate) => pending.choices.includes(candidate.id))
          .filter(
            (candidate) =>
              candidate.select?.kind !== "units" ||
              eventSelectionAvailable(state, candidate.select),
          )
          .map((candidate) => ({ id: candidate.id, label: candidate.label })));
      } else if (choice.select?.kind === "units")
        addEventUnits(state, builder, eventUnitCandidates(state, choice.select));
      else if (choice.select?.kind === "space") {
        actions.event_space = choice.select.spaces || [];
        if (pending.space) actions.event_confirm = 1;
      } else actions.event_confirm = 1;
  };
  return { event };
}

module.exports = { createEventStates };
