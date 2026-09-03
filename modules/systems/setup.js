"use strict";

// These are card-testing starts, not reconstructed historical midgame saves.
// The only deployment source remains rules.js's manually maintained setup.
const TEST_SCENARIOS = Object.freeze({
  "LIMITED WAR": Object.freeze({
    turn: 5, commitment: "limited", war_status: 6,
    russian: 4, turkish: 1, us_entry: 0, italy: false,
  }),
  "TOTAL WAR": Object.freeze({
    turn: 10, commitment: "total", war_status: 14,
    russian: 8, turkish: 3, us_entry: 24, italy: true,
  }),
});

function createSetupSystem(api) {
  function presetEvent(state, id, turn = state.turn - 1) {
    const card = api.cardById[id];
    const spec = api.cardSpecById[id];
    state.events[card.event] = {
      turn, faction: card.faction,
      duration: spec.duration, cleanup: spec.cleanup || null,
      scenario_preset: true,
      ...(id === 703 ? { automatic: true } : {}),
    };
  }

  function setupTestScenario(state, scenario) {
    const profile = TEST_SCENARIOS[scenario];
    if (!profile) throw new Error(`Unsupported public scenario: ${scenario}`);
    state.scenario = scenario;
    state.turn = profile.turn;
    api.log(state, `${scenario} 测试剧本：T${profile.turn}，Historical基础部署；非历史中期或平衡剧本。`);

    // Set only durable results. finishEvent/resolveWarStatus would also replay
    // immediate rewards, create pending choices, or record invented history.
    for (const id of [600, 606, 608, 708, 703]) presetEvent(state, id);
    api.enterNation(state, "tu");
    if (profile.italy) {
      presetEvent(state, 625, 5);
      api.enterNation(state, "it");
    }
    state.war_status = {
      ap: profile.war_status, cp: profile.war_status,
      combined: 2 * profile.war_status,
    };
    state.fronts = { russian: profile.russian, turkish: profile.turkish };
    state.entry_tracks.us = profile.us_entry;
    state.vp = 10;

    for (const faction of [api.AP, api.CP]) {
      state.commitment[faction] = profile.commitment;
      api.populateVeteranUpgradePool(state, faction);
      const cards = api.data.cards.filter((card) => card.faction === faction);
      state.removed[faction] = cards
        .filter((card) => api.commitmentRank(card.commitment) < api.commitmentRank(profile.commitment))
        .map((card) => card.id);
      state.decks[faction] = api.shuffle(state, cards
        .filter((card) => card.commitment === profile.commitment)
        .map((card) => card.id));
      api.drawCards(state, faction);
    }

    api.log(state, `预置：双方战争状态 ${profile.war_status}/${profile.war_status}，VP 10；俄国战线 ${profile.russian}，土耳其战线 ${profile.turkish}，美国参战轨 ${profile.us_entry}。`);
    api.log(state, "预置持续效果：战争援助、皇家海军封锁、双方战壕与防御工事、土耳其自动参战；不补发历史收益。");
    if (profile.italy)
      api.log(state, "意大利按T5已参战部署，保留初设受损面；美国尚未参战。");
    api.log(state, "双方各9张当前阶段手牌；旧阶段牌移除不代表其事件已经发生。其余前置条件与后续结算遵守正常规则。");
    api.updateSupply(state);
    api.beginMoPhase(state);
    api.assertCardConservation(state);
  }

  return Object.freeze({ setupTestScenario });
}

module.exports = { TEST_SCENARIOS, createSetupSystem };
