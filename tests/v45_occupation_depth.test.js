"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const data = require("../data.js");
const rules = require("../rules.js");
const { setupGame } = require("./setup_game.js");

test("version 44 CP actions preserve the saved action-round control snapshot", () => {
  const state = setupGame(700);
  state.version = 44;
  state.turn = 2;
  state.action_round = 2;
  state.active = "cp";
  state.state = "action_card";
  state.phase = "行动阶段";
  state.action_state = { turn: 2, round: 2, actor: "cp", used_combat_cards: [] };
  state.round_start_control = { ...state.control };
  const changed = data.spaces.find((space) => state.control[space.id] !== "cp");
  assert.ok(changed);
  state.round_start_control[changed.id] = "cp";
  state.control[changed.id] = "ap";
  state.round_enemy_entries = { cp: [changed.id], ap: [] };

  rules.view(state, "Central Powers");
  assert.equal(state.version, 46);
  assert.equal(state.action_start_control.actor, "cp");
  assert.equal(state.action_start_control.spaces[changed.id], "cp");
  assert.equal("round_start_control" in state, false);
  assert.equal("round_enemy_entries" in state, false);
});

test("version 44 AP actions use current control for the one-time compatibility snapshot", () => {
  const state = setupGame(700);
  state.version = 44;
  state.turn = 3;
  state.action_round = 2;
  state.active = "ap";
  state.state = "action_card";
  state.phase = "行动阶段";
  state.action_state = { turn: 3, round: 2, actor: "ap", used_combat_cards: [] };
  state.round_start_control = Object.fromEntries(data.spaces.map((space) => [space.id, "cp"]));
  const changed = data.spaces.find((space) => state.control[space.id] !== "ap");
  assert.ok(changed);
  state.control[changed.id] = "ap";

  rules.view(state, "Allied Powers");
  assert.equal(state.action_start_control.actor, "ap");
  assert.equal(state.action_start_control.spaces[changed.id], "ap");
});
