"use strict";

function createMovementStates(api) {
  return {
    ops_move: {
      message: "选择移动单位。",
      prompt(state, builder) {
        const units = api.legalMoveUnitIds(state);
        builder.addAll("select_move_unit", units);
        builder.addAll("select_combine_lcu", api.legalCombinationArmies(state));
        builder.enable("finish");
      },
      select_move_unit: api.beginMovementSelection,
      select_combine_lcu: api.beginCombinationSelection,
      finish(state) {
        if (state.ops?.pending_siege)
          throw new Error("The pending siege force must finish entering the fort");
        if (state.turn <= 3) api.advanceEarlyStackResolution(state);
        else api.advanceSequentialOpsResolution(state);
      },
    },

    combine_select_scu: {
      message: "组合：选择同地合法SCU。",
      prompt(state, builder) {
        const selected = state.ops?.combine_selection?.army_id;
        if (!selected) return;
        builder.addAll("select_combine_scu", api.legalCombinationCorps(state, selected));
        builder.enable("cancel");
      },
      select_combine_scu(state, id) {
        const armyId = state.ops?.combine_selection?.army_id;
        if (!armyId) throw new Error("No LCU selected for combination");
        api.resolveCombination(state, armyId, id);
      },
      cancel: api.cancelCombinationSelection,
    },

    movement_units: {
      message: "选择共同移动单位。",
      prompt(state, builder) {
        const selection = state.ops?.move_selection;
        if (!selection) return;
        const candidates = api.movementSelectionCandidates(state, selection);
        builder.addAll(
          "select_move_unit",
          candidates.filter((id) => !selection.selected.includes(id)),
        );
        builder.addAll("deselect_move_unit", selection.selected);
        builder.addAll(
          "move",
          api.movementSelectionDestinations(state, selection.selected),
        );
        builder.enable("cancel");
        builder.enable("finish");
      },
      select_move_unit(state, id) {
        const selection = state.ops?.move_selection;
        if (!selection || !api.movementSelectionCandidates(state).includes(id))
          throw new Error("Unit cannot join this movement");
        if (!selection.selected.includes(id)) selection.selected.push(id);
      },
      deselect_move_unit(state, id) {
        const selection = state.ops?.move_selection;
        if (!selection?.selected.includes(id))
          throw new Error("Movement unit is not selected");
        selection.selected = selection.selected.filter((unitId) => unitId !== id);
        if (!selection.selected.length) {
          state.ops.move_selection = null;
          state.state = "ops_move";
        }
      },
      move(state, destination) {
        const selection = state.ops?.move_selection;
        if (!selection?.selected.length)
          throw new Error("No movement units selected");
        if (!api.movementSelectionDestinations(state, selection.selected).includes(destination))
          throw new Error("Illegal first movement step");
        api.snapshot(state, "逐格移动");
        api.beginGroupMovement(state, selection.selected);
        const unit = api.findUnit(state, state.ops.moving);
        api.moveUnitOneSpace(state, unit, destination, { skip_undo: true });
      },
      cancel(state) {
        state.ops.move_selection = null;
        state.state = "ops_move";
      },
      finish(state) {
        state.ops.move_selection = null;
        if (state.ops?.pending_siege)
          throw new Error("The pending siege force must finish entering the fort");
        if (state.turn <= 3) api.advanceEarlyStackResolution(state);
        else api.advanceSequentialOpsResolution(state);
      },
    },

    movement: {
      message: "移动。",
      prompt(state, builder) {
        const movement = api.movementContext(state);
        if (!movement) return;
        builder.addAll("move", api.movementStepDestinations(state));
        builder.addAll("drop_move_unit", api.droppableMovementUnitIds(state));
        if (api.canFinishUnitMovement(state)) builder.enable("stop");
        if (!movement.path.length) builder.enable("cancel");
      },
      move(state, destination) {
        const unit = api.findUnit(state, state.ops.moving);
        if (!unit) throw new Error("Moving unit not found");
        api.moveUnitOneSpace(state, unit, destination);
      },
      drop_move_unit(state, id) {
        api.snapshot(state, "放下移动单位");
        api.dropMovementUnit(state, id);
      },
      stop(state) {
        api.snapshot(state, "结束移动");
        api.finishUnitMovement(state);
      },
      cancel(state) {
        const movement = api.movementContext(state);
        if (movement?.path.length)
          throw new Error("Use end movement after moving a unit");
        state.ops.move_selection = {
          origin: movement.origin,
          selected: movement.units.slice(),
        };
        state.ops.moving = null;
        state.ops.movement = null;
        state.state = "movement_units";
      },
    },

    sr: {
      message: (state) => `${state.sr?.remaining ?? 0} SR`,
      prompt(state, builder) {
        api.updateSupply(state);
        const unresolvedHqs = new Set(
          api.orphanHqs(state)
            .filter((unit) => unit.faction === state.active)
            .map((unit) => unit.id),
        );
        const units = [...state.units, ...state.reserves[state.active]]
          .filter((unit) => unit.faction === state.active && (!unit.location || unit.supplied))
          .filter((unit) => !state.sr.used_units?.includes(unit.id))
          .filter((unit) => !unresolvedHqs.size || unresolvedHqs.has(unit.id))
          .filter(
            (unit) =>
              state.sr.remaining >= (state.sr.free ? 1 : unit.type === "army" ? 3 : 1),
          )
          .filter(
            (unit) =>
              !state.sr.free ||
              (unit.nation === state.sr.restriction.nation &&
                unit.type === state.sr.restriction.type),
          );
        const destinations = new Map(
          units
            .map((unit) => [unit.id, api.legalSrDestinations(state, unit)])
            .map(([id, spaces]) => [
              id,
              spaces.filter(
                (space) =>
                  !state.sr.free ||
                  (state.sr.destinations.includes(space) &&
                    !state.sr.used_destinations.includes(space)),
              ),
            ])
            .filter(([, spaces]) => spaces.length),
        );
        const selected = state.sr.selected_unit;
        if (selected && destinations.has(selected)) {
          builder.addAll("sr_destination", destinations.get(selected));
          builder.enable("cancel_sr_unit");
        } else builder.addAll("select_sr_unit", [...destinations.keys()]);
        if (state.sr.free || !unresolvedHqs.size) builder.enable("finish");
      },
      select_sr_unit(state, id) {
        state.sr.selected_unit = id;
      },
      cancel_sr_unit(state) {
        state.sr.selected_unit = null;
      },
      sr_destination(state, destination) {
        api.resolveSrDestination(state, destination);
      },
      finish(state) {
        if (
          !state.sr.free &&
          state.sr.source !== "front_end" &&
          api.orphanHqs(state).some((unit) => unit.faction === state.active)
        )
          throw new Error(
            "Every HQ must finish SR with a national combat unit or at a supply source",
          );
        if (state.sr.source === "front_end") api.finishFrontEndSr(state);
        else if (state.sr.resume_event) {
          const resume = state.sr.resume_event;
          state.sr = null;
          api.resumeEventAfterSr(state, resume);
        }
        else {
          state.sr = null;
          api.nextFactionAction(state);
        }
      },
    },
  };
}

module.exports = { createMovementStates };
