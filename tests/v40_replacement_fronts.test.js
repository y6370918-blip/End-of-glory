"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const rules = require("../rules.js");
const data = require("../data.js");

const AP = "Allied Powers";

function eliminateForReplacement(state, predicate) {
  const index = state.units.findIndex(predicate);
  assert.ok(index >= 0);
  const [unit] = state.units.splice(index, 1);
  unit.location = "liege";
  unit.supplied = false;
  unit.fort_limited_supply = false;
  unit.moved = true;
  unit.attacked = true;
  unit.reduced = true;
  state.eliminated.ap.push(unit);
  return unit;
}

test("v40 clears map and supply state from every off-map unit", () => {
  const state = rules.setup(40001);
  const unit = eliminateForReplacement(
    state,
    (candidate) => candidate.faction === "ap" && candidate.type === "army",
  );
  state.version = 39;

  const view = rules.view(state, AP);
  const publicUnit = view.eliminated.ap.find((candidate) => candidate.id === unit.id);
  assert.equal(state.version, 46);
  for (const key of ["location", "supplied", "fort_limited_supply", "moved", "attacked"])
    assert.equal(key in unit, false);
  assert.equal(publicUnit.zone, "eliminated");
  assert.equal("supply_status" in publicUnit, false);
  assert.equal("supply_effects" in publicUnit, false);
});

test("eliminated LCU rebuilds by clicking a legal national supply source", () => {
  const state = rules.setup(40002);
  const unit = eliminateForReplacement(
    state,
    (candidate) => candidate.faction === "ap" && candidate.nation === "fr" && candidate.type === "army",
  );
  state.state = "replacement";
  state.phase = "补员/升级";
  state.active = "ap";
  state.replacement_active = "ap";
  state.rp.ap.fr = 10;

  const before = state.rp.ap.fr;
	const undoBeforeSelection = state.undo.length;
  assert.ok(rules.view(state, AP).actions.spend_rebuild.includes(unit.id));
  rules.action(state, AP, "spend_rebuild", unit.id);
	assert.equal(state.undo.length, undoBeforeSelection);
  assert.equal(state.pending_event.card, undefined);
  assert.equal(rules._test.assertCardConservation(state), true);
  const rebuildView = rules.view(state, AP);
  assert.equal(rebuildView.prompt, "补员：选择重建位置。");
  const spaces = rebuildView.actions.event_space;
  assert.ok(spaces.length > 0);
  assert.ok(spaces.every((space) => ["paris", "orleans", "chaumont"].includes(space)));
  rules.action(state, AP, "event_space", spaces[0]);
  assert.equal(rules._test.assertCardConservation(state), true);

  assert.equal(state.eliminated.ap.some((candidate) => candidate.id === unit.id), false);
  assert.equal(state.units.find((candidate) => candidate.id === unit.id).location, spaces[0]);
  assert.equal(state.units.find((candidate) => candidate.id === unit.id).reduced, true);
  assert.ok(state.rp.ap.fr < before);
	rules.action(state, AP, "undo");
	assert.equal(state.pending_event.kind, "replacement_rebuild");
	assert.equal(state.pending_event.unit, unit.id);
	assert.equal(state.eliminated.ap.some((candidate) => candidate.id === unit.id), true);
	assert.equal(state.rp.ap.fr, before);
});

test("eliminated SCU can rebuild directly into the printed reserve box", () => {
  const state = rules.setup(40003);
  const unit = eliminateForReplacement(
    state,
    (candidate) => candidate.faction === "ap" && candidate.nation === "fr" &&
      candidate.type === "corps" &&
      !data.pieces.find((piece) => piece.id === candidate.piece)?.permanent_on_elimination,
  );
  state.state = "replacement";
  state.phase = "补员/升级";
  state.active = "ap";
  state.replacement_active = "ap";
  state.rp.ap.fr = 10;

  rules.action(state, AP, "spend_rebuild", unit.id);
  assert.equal(rules._test.assertCardConservation(state), true);
  assert.equal(rules.view(state, AP).actions.replacement_to_reserve, 1);
  rules.action(state, AP, "replacement_to_reserve");
  assert.equal(rules._test.assertCardConservation(state), true);

  const reserve = state.reserves.ap.find((candidate) => candidate.id === unit.id);
  assert.ok(reserve);
  assert.equal(reserve.reduced, true);
  assert.equal("location" in reserve, false);
  assert.equal("supplied" in reserve, false);
});

test("front maintenance spends expiring credit before native RP", () => {
  const state = rules.setup(40004);
  const card = data.cards.find((candidate) => candidate.id === 704);
  state.events[card.event] = {
    faction: "cp",
    duration: "game",
    rule: data.card_effects[704].operations.find((operation) => operation.type === "rule_modifier"),
  };
  state.fronts.russian = 0;
  state.fronts.turkish = 0;
  state.rp.cp.east = 3;
  state.rp.cp.ah = 0;
  state.rp.cp.ge = 0;

  assert.equal(rules._test.beginFrontMaintenance(state), true);
  const east = state.pending_event.obligations.find(
    (obligation) => obligation.track === "russian" && obligation.pool === "east",
  );
  assert.equal(east.remaining, 0);
  assert.equal(state.pending_event.credit.remaining, 0);
  assert.equal(state.rp.cp.east, 3);
});

test("front maintenance automatically deducts native RP before conversions", () => {
  const state = rules.setup(40005);
  state.fronts.russian = 0;
  state.fronts.turkish = 0;
  state.rp.cp.east = 3;
  state.rp.cp.ah = 0;
  state.rp.cp.ge = 0;

  assert.equal(rules._test.beginFrontMaintenance(state), true);
  const east = state.pending_event.obligations.find(
    (obligation) => obligation.track === "russian" && obligation.pool === "east",
  );
  assert.equal(east.remaining, 0);
  assert.equal(state.rp.cp.east, 2);
});

test("Turkish-front maintenance automatically spends BR before A RP", () => {
  const state = rules.setup(40006);
  state.events.entry_tu = true;
  state.fronts.russian = 0;
  state.fronts.turkish = 0;
  state.rp.cp = { east: 1, ah: 6, ge: 0 };
  state.rp.ap = { br: 0.5, us: 0.5, fr: 8, it: 0 };

  rules._test.beginFrontMaintenance(state);

  assert.equal(state.rp.ap.br, 0);
  assert.equal(state.rp.ap.us, 0);
  assert.equal(state.rp.ap.fr, 8);
  assert.equal(state.usage_limits["front_maintenance:1"], 1);
});

test("front-maintenance losses use the same AP replacement pools as rebuilding", () => {
  const state = rules.setup(40007);
  state.events.entry_tu = true;
  state.fronts.russian = 0;
  state.fronts.turkish = 0;
  state.rp.cp = { east: 1, ah: 6, ge: 0 };
  state.rp.ap = { br: 0, us: 0, fr: 0, it: 0 };
  state.units.push(
    { id: "indian-front-loss", piece: "component-089", faction: "ap", nation: "in", type: "corps", location: "london", reduced: false },
    { id: "belgian-front-loss", piece: "component-001", faction: "ap", nation: "be", type: "corps", location: "brussels", reduced: false },
  );

  assert.equal(rules._test.beginFrontMaintenance(state), true);
  const losses = rules.view(state, AP).actions.front_maintenance_loss;

  assert.ok(losses.includes("indian-front-loss:br"));
  assert.ok(losses.includes("indian-front-loss:us"));
  assert.ok(losses.includes("belgian-front-loss:us"));
  assert.equal(losses.includes("belgian-front-loss:br"), false);
});
