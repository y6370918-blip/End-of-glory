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
        state.active = review.owner;
        state.phase = review.return_phase;
        state.supply_warnings = null;
        state.pending_supply_warning_review = null;
        api.continueNextFactionAction(state);
      },
    },

    review_rollback_proposal: {
      message: "审查回滚。",
      prompt(_state, builder) {
        builder.enable("accept_rollback");
        builder.enable("reject_rollback");
      },
      accept_rollback: api.acceptRollbackProposal,
      reject_rollback: api.rejectRollbackProposal,
    },

    confirm_rollback: {
      message: "确认回滚。",
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
