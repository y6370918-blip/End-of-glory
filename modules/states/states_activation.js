"use strict";

function createActivationStates(api) {
  return {
    ops_activate: {
      message: (state) => {
        const remaining = state.ops?.remaining ?? 0;
        const italian = Math.max(0, Number(state.ops?.italian_bonus) || 0);
        return italian > 0
          ? `${remaining} OP + 意大利战场免费 ${italian} OP`
          : `${remaining} OP`;
      },
      prompt(state, builder) {
        if (!state.ops) return;
        const selected = state.ops?.preactivation_sr_selected;
        if (selected) {
          builder.addAll("sr_destination", api.schlieffenSrDestinations(state, selected));
          builder.enable("cancel_sr_unit");
          return;
        }
        builder.addAll("activate_move", api.legalActivationSpaces(state, "move"));
        if (!state.ops.prohibit_attack)
          builder.addAll("activate_attack", api.legalActivationSpaces(state, "attack"));
        builder.addAll("activate_construct", api.legalActivationSpaces(state, "construct"));
        builder.addAll("select_sr_unit", api.schlieffenSrUnits(state));
        if (
          !state.ops.pending_siege &&
          (state.turn >= 4 || !api.earlyActivationAvailable(state))
        )
          builder.enable("finish");
      },
      activate_move: (state, space) => api.activate(state, space, "move"),
      activate_attack: (state, space) => api.activate(state, space, "attack"),
      activate_construct: (state, space) => api.activate(state, space, "construct"),
      select_sr_unit(state, id) {
        if (!api.schlieffenSrUnits(state).includes(id))
          throw new Error("Illegal Schlieffen reserve corps");
        state.ops.preactivation_sr_selected = id;
      },
      cancel_sr_unit(state) {
        state.ops.preactivation_sr_selected = null;
      },
      sr_destination(state, destination) {
        const unit = state.ops?.preactivation_sr_selected;
        if (!unit || !api.schlieffenSrDestinations(state, unit).includes(destination))
          throw new Error("Illegal Schlieffen SR destination");
        api.snapshot(state, "Schlieffen free SR");
        api.schlieffenSr(state, { unit, destination });
      },
      finish: api.requestOpsFinish,
    },

    activation_region: {
      message: (state) => {
        const pending = state.ops?.pending_activation;
        const name = api.spaceById[pending?.space]?.name || pending?.space || "大区";
        const selected = pending?.selected || [];
        const combat = api.regionActivationCountedUnitCount(state, selected);
        const hq = api.regionActivationHqCount(state, selected);
        return `${name}：战斗单位 ${combat}/3，HQ ${hq}/1（1 OP）`;
      },
      prompt(state, builder) {
        const pending = state.ops?.pending_activation;
        if (!pending) return;
        const selected = pending.selected || [];
        builder.addAll(
          "select_activation_unit",
          pending.candidates.filter(
            (id) => !selected.includes(id) && api.regionActivationCanAddUnit(state, selected, id),
          ),
        );
        builder.addAll("deselect_activation_unit", selected);
        if (selected.length && api.pendingRegionActivationLegal(state))
          builder.enable("activation_confirm");
        builder.enable("activation_cancel");
      },
      select_activation_unit: api.selectRegionActivationUnit,
      deselect_activation_unit: api.deselectRegionActivationUnit,
      activation_confirm: api.confirmRegionActivation,
      activation_cancel: api.cancelRegionActivation,
    },

    ops_choose_stack: {
      message: "选择结算地块。",
      prompt(state, builder) {
        builder.addAll("resolve_stack", state.ops?.unresolved_stacks || []);
      },
      resolve_stack: api.beginEarlyStack,
    },

    schlieffen_overstack: {
      message: "施里芬计划：消除超堆叠。",
      prompt(state, builder) {
        const candidates = api.schlieffenOverstackCandidates(state);
        builder.addAll("return_schlieffen_unit", candidates);
        if (!candidates.length) builder.enable("finish");
      },
      return_schlieffen_unit(state, id) {
        api.returnSchlieffenUnit(state, id);
      },
      finish(state) {
        if (api.schlieffenOverstackCandidates(state).length)
          throw new Error("Every Schlieffen overstack must be resolved first");
        api.finishOps(state);
      },
    },

    ops_construct: {
      message: "修筑。",
      prompt(state, builder) {
        builder.addAll("entrench", api.legalConstructionSpaces(state));
        builder.addAll("select_combine_lcu", api.legalCombinationArmies(state));
        builder.enable("finish");
      },
      entrench: api.resolveEntrench,
      select_combine_lcu: api.beginCombinationSelection,
      finish(state) {
        if (state.turn <= 3) api.advanceEarlyStackResolution(state);
        else api.advanceSequentialOpsResolution(state);
      },
    },
  };
}

module.exports = { createActivationStates };
