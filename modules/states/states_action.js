"use strict";

function createActionStates(api) {
  return {
    flag_supply_warnings: {
      message: "标记补给警告。",
      prompt(state, builder) {
        const selected = state.supply_warning_editor?.selected || [];
        const candidates = api.supplyWarningSpaces();
        builder.addAll(
          "select_supply_warning",
          candidates.filter((space) => !selected.includes(space)),
        );
        builder.addAll("deselect_supply_warning", selected);
        builder.enable("finish_supply_warnings");
        builder.enable("cancel");
      },
      select_supply_warning(state, space) {
        const editor = state.supply_warning_editor;
        if (!editor || !api.supplyWarningSpaces().includes(space))
          throw new Error("Illegal supply-warning space");
        if (!editor.selected.includes(space)) editor.selected.push(space);
      },
      deselect_supply_warning(state, space) {
        const editor = state.supply_warning_editor;
        if (!editor?.selected.includes(space))
          throw new Error("Supply-warning space is not selected");
        editor.selected = editor.selected.filter((id) => id !== space);
      },
      finish_supply_warnings: api.finishSupplyWarningEditor,
      cancel(state) {
        const editor = state.supply_warning_editor;
        if (!editor) throw new Error("No supply-warning editor is active");
        state.state = editor.return_state;
        state.phase = editor.return_phase;
        state.supply_warning_editor = null;
      },
    },

    review_supply_warnings: {
      message: "确认补给警告。",
      prompt(_state, builder) {
        builder.enable("acknowledge_supply_warnings");
      },
      acknowledge_supply_warnings(state) {
        const review = state.pending_supply_warning_review;
        if (!review || review.reviewer !== state.active)
          throw new Error("No supply warning is awaiting confirmation");
        api.setActiveFaction(state, review.owner);
        state.phase = review.return_phase;
        state.supply_warnings = null;
        state.pending_supply_warning_review = null;
        api.continueNextFactionAction(state);
      },
    },

    review_rollback_proposal: {
      message: (state) => api.rollbackSnapshot(state, state.rollback_proposal?.index)
        ? "审查回滚。"
        : "检查点存档不可用，请拒绝此回滚提议。",
      prompt(state, builder) {
        if (api.rollbackSnapshot(state, state.rollback_proposal?.index))
          builder.enable("accept_rollback");
        builder.enable("reject_rollback");
      },
      accept_rollback: api.acceptRollbackProposal,
      reject_rollback: api.rejectRollbackProposal,
    },

    confirm_rollback: {
      message: (state) => `${state.rollback_confirmation?.message || "已回滚"}。请确认继续。`,
      prompt(_state, builder) {
        builder.enable("confirm_rollback");
      },
      confirm_rollback(state) {
        const confirmation = state.rollback_confirmation;
        if (!confirmation) throw new Error("No rollback confirmation is active");
        api.log(state, confirmation.message);
        state.state = confirmation.return_state;
        state.phase = confirmation.return_phase;
        state.rollback_confirmation = null;
      },
    },

    rollback_turn_end: {
      message: "补员阶段前：继续回合末结算。",
      prompt(_state, builder) { builder.enable("done"); },
      done: api.continueTurnEnd,
    },

    rollback_combat_start: {
      message: "战斗前：确认或取消本场进攻。",
      prompt(_state, builder) {
        builder.enable("done");
        builder.enable("cancel");
      },
      done(state) {
        const declaration = state.ops?.pending_attack;
        if (!declaration) throw new Error("Rollback combat declaration is missing");
        api.validateAttackDeclaration(state, declaration);
        state.ops.rollback_combat_count = (state.ops.rollback_combat_count || 0) + 1;
        state.ops.pending_attack = null;
        api.beginCombat(state, declaration);
      },
      cancel(state) {
        state.ops.pending_attack = null;
        state.state = "ops_attack";
      },
    },

    action_card: {
      message: (state) => `行动轮 ${state.action_round}`,
      prompt(state, builder) {
        builder.enable("one_op");
        builder.addAll("card_ops", state.hands[state.active]);
        if (state.last_action_use?.[state.active] !== "sr")
          builder.addAll("card_sr", state.hands[state.active]);
        if (state.last_action_use?.[state.active] !== "rp")
          builder.addAll("card_rp", state.hands[state.active]);
        builder.addAll(
          "card_event",
          state.hands[state.active].filter(
            (id) => !api.cardById[id]?.combat_card && api.eventLegal(state, api.cardById[id]),
          ),
        );
      },
      card_ops: (state, id) => api.cardUse(state, id, "ops"),
      card_sr: (state, id) => api.cardUse(state, id, "sr"),
      card_rp: (state, id) => api.cardUse(state, id, "rp"),
      card_event: (state, id) => api.cardUse(state, id, "event"),
      one_op(state) {
        api.snapshot(state, "1 OP");
        api.recordActionHistory(state, "one_op");
        api.noteFormalActionUse(state, "one_op");
        api.beginOps(state, null, true);
      },
    },
  };
}

module.exports = { createActionStates };
