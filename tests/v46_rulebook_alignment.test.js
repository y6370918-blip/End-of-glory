"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const data = require("../data.js");
const rules = require("../rules.js");
const { setupGame } = require("./setup_game.js");

const AP_ROLE = "Allied Powers";
const CP_ROLE = "Central Powers";

function piece(nation, type, predicate = () => true) {
  const model = data.pieces.find((entry) =>
    entry.nation === nation && entry.type === type && predicate(entry));
  assert.ok(model);
  return model;
}

function unit(id, model, location, reduced = false) {
  return {
    id,
    piece: model.id,
    faction: model.faction,
    nation: model.nation,
    type: model.type,
    location,
    reduced,
    moved: false,
    attacked: false,
    supplied: true,
    limited_supply: false,
    fort_limited_supply: false,
  };
}

function neutralFinalState(seed, vp) {
  const state = setupGame(seed);
  state.turn = 15;
  state.vp = vp;
  state.control = Object.fromEntries(data.spaces.map((space) => [space.id, null]));
  state.units = [];
  state.naval.track = 0;
  state.events = {};
  state.campaign_flags = { paris_attacked: false };
  return state;
}

test("v46 final victory uses the ten-VP boundary and applies both Paris bonuses", () => {
  const ap = neutralFinalState(4601, 10);
  assert.equal(rules._test.checkVictory(ap), true);
  assert.equal(ap.result, AP_ROLE);

  const cp = neutralFinalState(4602, 11);
  assert.equal(rules._test.checkVictory(cp), true);
  assert.equal(cp.result, CP_ROLE);

  const nearParis = neutralFinalState(4603, 10);
  const origin = rules._test.landNeighbors("paris")[0];
  nearParis.units = [unit("cp-near-paris", piece("ge", "army"), origin)];
  assert.equal(rules._test.checkVictory(nearParis), true);
  assert.equal(nearParis.result, CP_ROLE);

  const attackedParis = neutralFinalState(4604, 10);
  attackedParis.campaign_flags.paris_attacked = true;
  assert.equal(rules._test.checkVictory(attackedParis), true);
  assert.equal(attackedParis.result, CP_ROLE);
});

test("v46 armistice ends the game immediately when combined war status reaches its marker", () => {
  const state = neutralFinalState(4605, 10);
  state.turn = 6;
  state.entry_tracks.armistice = 2;
  state.war_status.combined = 41;
  assert.equal(rules._test.checkVictory(state, { armisticeOnly: true }), false);
  state.war_status.combined = 42;
  assert.equal(rules._test.checkVictory(state, { armisticeOnly: true }), true);
  assert.equal(state.state, "game_over");
});

test("v46 attrition permanently removes both out-of-supply armies and corps", () => {
  const state = setupGame(4606);
  const army = unit("ap-oos-army", piece("fr", "army"), "metz");
  const corps = unit("ap-oos-corps", piece("fr", "corps"), "metz");
  for (const entry of [army, corps]) {
    entry.supplied = false;
    entry.limited_supply = false;
    entry.fort_limited_supply = false;
  }
  state.units = [army, corps];
  state.eliminated.ap = [];
  state.permanently_removed_units = [];
  rules._test.resolveFactionAttrition(state, "ap");
  assert.deepEqual(new Set(state.permanently_removed_units.map((entry) => entry.id)),
    new Set([army.id, corps.id]));
  assert.equal(state.eliminated.ap.length, 0);
});

test("v46 a PE unit destroyed only because it cannot retreat uses the ordinary eliminated box", () => {
  const state = setupGame(4607);
  const cavalry = unit("pe-retreat", piece("it", "corps", (entry) =>
    entry.permanent_on_elimination && entry.accepts_replacement_points), "udine", true);
  state.units = [cavalry];
  state.eliminated.ap = [];
  state.permanently_removed_units = [];
  rules._test.eliminateUnit(state, cavalry.id, "unable_to_retreat");
  assert.equal(state.eliminated.ap.some((entry) => entry.id === cavalry.id), true);
  assert.equal(state.permanently_removed_units.some((entry) => entry.id === cavalry.id), false);
});

test("v46 limited supply blocks replacement and applies the combat column penalty", () => {
  const state = setupGame(4608);
  const attacker = unit("limited-attacker", piece("ge", "army"), "ypres", true);
  const defender = unit("swamp-defender", piece("fr", "army"), "kortrijk");
  attacker.supplied = false;
  attacker.limited_supply = true;
  state.units = [attacker, defender];
  state.active = "cp";
  state.state = "replacement";
  state.replacement_active = "cp";
  state.rp.cp.ge = 3;
  for (const nation of Object.keys(state.mo.current)) state.mo.current[nation] = [];
  assert.equal((rules.view(state, CP_ROLE).actions.spend_flip || []).includes(attacker.id), false);

  state.state = "combat_card_window";
  state.combat_window = {
    attacker: "cp", defender: "ap", side: "cp", cards: [], cards_revealed: true,
    declaration: { attackers: [attacker.id], target: defender.location },
  };
  rules._test.resolveCombat(state, state.combat_window.declaration);
  assert.equal(state.combat_modifiers.modifier_sources.some((entry) => entry.label === "有限补给"), true);
  assert.equal(state.combat_modifiers.attack_column, -4);
});

test("v46 occupation depth remains active after turn three", () => {
  const state = setupGame(4609);
  state.turn = 8;
  state.action_start_control = {
    actor: "cp",
    spaces: Object.fromEntries(data.spaces.map((space) => [space.id, null])),
  };
  state.action_start_control.spaces.metz = "cp";
  const depths = rules._test.occupationDepths(state, "cp");
  const distanceThree = [...depths].find(([, distance]) => distance === 3)?.[0];
  assert.ok(distanceThree);
  assert.equal(rules._test.canOccupyByEarlyWarDepth(state, "cp", distanceThree), false);
});

test("v45 saves migrate to v46 without inferring a historical Paris attack", () => {
  const state = setupGame(4610);
  state.version = 45;
  delete state.campaign_flags;
  rules.view(state, CP_ROLE);
  assert.equal(state.version, 46);
  assert.deepEqual(state.campaign_flags, { paris_attacked: false });
});
