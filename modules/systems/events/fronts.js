"use strict";

function createFrontEventSystem(api) {
  function beginKillingGroundEvent(state, card, operation) {
      state.sr = {
          card: card.id,
          remaining: operation.immediate_sr || 0,
          used_units: [],
          selected_unit: null,
          source: "event",
          resume_event: { card: card.id, operation: api.clone(operation) },
      };
      state.active = card.faction;
      state.state = "sr";
  }

  function resolveAutomaticTurkeyEntry(state) {
      const card = api.cardById[703];
      if (state.events[card.event])
          return;
      api.removeCardFromAllPiles(state, api.CP, card.id);
      state.events[card.event] = {
          turn: state.turn,
          faction: api.CP,
          duration: api.cardSpecById[card.id]?.duration || "instant",
          cleanup: api.cardSpecById[card.id]?.cleanup || null,
          automatic: true,
      };
      for (const operation of api.cardSpecById[card.id]?.operations || []) {
          // Automatic entry is not a voluntary play of the event.  The printed
          // VP cost belongs only to the voluntary event branch.
          if (operation.type === "vp")
              continue;
          api.applyEffectOperation(state, card, operation);
      }
      api.moveFront(state, "turkish", 1, "土耳其自动参战");
      const printed = Number(String(card.printed_marker || "").split("/")[0]);
      if (Number.isFinite(printed) && printed > 0) {
          state.war_status.cp += printed;
          state.war_status.combined += printed;
      }
      if (!state.removed.cp.includes(card.id))
          state.removed.cp.push(card.id);
      state.event_history.push({
          card: card.id,
          event: card.event,
          faction: api.CP,
          turn: state.turn,
          round: state.action_round,
          automatic: true,
          operations: [],
      });
      api.log(state, "同盟国进入有限战争：土耳其自动参战并移除该牌。");
  }

  function commitmentRank(commitment) {
      return { mobilization: 0, limited: 1, total: 2 }[commitment] || 0;
  }

  function enterCommitment(state, faction, commitment) {
      if (commitment === "limited") {
          api.addCommitmentCards(state, faction, "limited");
          api.populateVeteranUpgradePool(state, faction);
          state.commitment[faction] = "limited";
          api.log(state, `${api.factionRole(faction)} 进入有限战争。`);
          if (faction === api.CP)
              resolveAutomaticTurkeyEntry(state);
          return;
      }
      api.addCommitmentCards(state, faction, "total");
      state.commitment[faction] = "total";
      if (faction === api.AP)
          delete state.events["cp_福克灾难_禁用空中优势"];
      api.log(state, `${api.factionRole(faction)} 进入全面战争。`);
  }

  function resolveCommitmentStage(state, commitment, lowerThreshold, higherThreshold) {
      const targetRank = commitmentRank(commitment);
      const candidates = [api.AP, api.CP].filter((faction) => commitmentRank(state.commitment[faction]) < targetRank);
      if (!candidates.length)
          return;
      const alreadyEntered = [api.AP, api.CP].some((faction) => commitmentRank(state.commitment[faction]) >= targetRank);
      const apStatus = state.war_status.ap;
      const cpStatus = state.war_status.cp;
      const leaders = apStatus === cpStatus
          ? candidates
          : [apStatus > cpStatus ? api.AP : api.CP].filter((faction) => candidates.includes(faction));
      for (const faction of leaders)
          if (state.war_status[faction] >= higherThreshold)
              enterCommitment(state, faction, commitment);
      if (alreadyEntered ||
          [api.AP, api.CP].some((faction) => commitmentRank(state.commitment[faction]) >= targetRank))
          for (const faction of candidates)
              if (commitmentRank(state.commitment[faction]) < targetRank &&
                  state.war_status[faction] >= lowerThreshold)
                  enterCommitment(state, faction, commitment);
  }

  function resolveWarStatus(state) {
      if (state.turn <= 2) {
          api.log(state, `T${state.turn} 不检查战争状态。`);
          return;
      }
      resolveCommitmentStage(state, "limited", 4, 6);
      resolveCommitmentStage(state, "total", 11, 13);
  }

  return Object.freeze({
    beginKillingGroundEvent,
    commitmentRank,
    enterCommitment,
    resolveAutomaticTurkeyEntry,
    resolveCommitmentStage,
    resolveWarStatus,
  });
}

module.exports = { createFrontEventSystem };
