"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const rules = require("../rules.js");

const CP_ROLE = "Central Powers";
const AP_ROLE = "Allied Powers";

function installFrontMo(state, nation, id) {
  for (const key of Object.keys(state.mo.current)) state.mo.current[key] = [];
  state.mo.current[nation] = [id];
  state.mo.completed[nation] = [];
  state.mo.waived[nation] = [];
  state.mo.penalized[nation] = [];
  state.mo.front_commitments = {};
}

test("v41 migration initializes front MO commitments", () => {
  const state = rules.setup(4100);
  state.version = 40;
  delete state.mo.front_commitments;
  rules.view(state, CP_ROLE);
  assert.equal(state.version, 42);
  assert.deepEqual(state.mo.front_commitments, {});
});

test("v41 Russian front MO reserves AH maintenance before converting surplus AH to EAST", () => {
  const state = rules.setup(4101);
  state.events["cp_坦能堡的英雄"] = true;
  state.fronts.russian = 0;
  installFrontMo(state, "ge", "ge-10");
  state.rp.cp = { ge: 0, ah: 8, east: 3.5 };

  const plan = rules._test.frontMoCommitmentPlan(state, "cp", "ge-10");
  assert.ok(plan);
  assert.deepEqual(plan.maintenance[1].rp, { ah: 6 });
  assert.equal(plan.reserved_rp.east, 3.5);
  assert.equal(plan.reserved_rp.ah, 8);

  state.rp.cp.ah = 7;
  assert.equal(rules._test.frontMoCommitmentPlan(state, "cp", "ge-10"), null);
  state.rp.cp.ah = 6;
  state.rp.cp.ge = 1;
  assert.ok(rules._test.frontMoCommitmentPlan(state, "cp", "ge-10"));
});

test("v41 committed Russian front MO automatically pays maintenance and advances in replacement", () => {
  const state = rules.setup(4102);
  state.events["cp_坦能堡的英雄"] = true;
  state.fronts.russian = 0;
  installFrontMo(state, "ge", "ge-10");
  state.rp.cp = { ge: 0, ah: 8, east: 3.5 };

  assert.equal(rules._test.beginFrontMoCommitmentReview(state), true);
  assert.deepEqual(rules.view(state, CP_ROLE).actions.commit_front_mo, ["ge-10"]);
  rules.action(state, CP_ROLE, "commit_front_mo", "ge-10");

  assert.equal(state.fronts.russian, 1);
  assert.deepEqual(state.mo.completed.ge, ["ge-10"]);
  assert.equal(state.rp.cp.east, 0);
  assert.equal(state.rp.cp.ah, 0);
  assert.equal(Object.values(state.mo.front_commitments)[0].processed, true);
});

test("v41 front MO commitment window opens after the final AP action", () => {
  const state = rules.setup(4105);
  state.events["cp_坦能堡的英雄"] = true;
  state.fronts.russian = 0;
  installFrontMo(state, "ge", "ge-10");
  state.rp.cp = { ge: 0, ah: 8, east: 3.5 };
  state.action_round = 6;
  state.active = "ap";
  state.state = "action_card";

  rules._test.nextFactionAction(state);

  assert.equal(state.state, "front_mo_commit");
  assert.equal(state.phase, "战线MO承诺");
  assert.equal(state.active, "cp");
});

test("v41 declining an affordable front MO sends it to ordinary MO penalty resolution", () => {
  const state = rules.setup(4103);
  state.events["cp_坦能堡的英雄"] = true;
  state.fronts.russian = 0;
  installFrontMo(state, "ge", "ge-10");
  state.rp.cp = { ge: 0, ah: 8, east: 3.5 };

  assert.equal(rules._test.beginFrontMoCommitmentReview(state), true);
  rules.action(state, CP_ROLE, "decline_front_mo");

  assert.equal(state.pending_event?.kind, "mo_penalty");
  assert.equal(state.pending_event?.mo, "ge-10");
  assert.equal(state.mo.penalty_resolution.queue[0].id, "ge-10");
});

test("v41 British Turkish-front MO uses only BR and A RP", () => {
  const state = rules.setup(4104);
  state.events.entry_tu = true;
  state.events["cp_土耳其参战"] = true;
  state.events["ap_丘吉尔"] = true;
  state.fronts.russian = 0;
  state.fronts.turkish = 0;
  installFrontMo(state, "br", "br-6");
  state.rp.cp = { ge: 0, ah: 6, east: 1 };
  state.rp.ap = { br: 2, us: 2, fr: 9, it: 0 };

  assert.equal(rules._test.beginFrontMoCommitmentReview(state), true);
  assert.equal(state.active, "ap");
  assert.deepEqual(rules.view(state, AP_ROLE).actions.commit_front_mo, ["br-6"]);
  rules.action(state, AP_ROLE, "commit_front_mo", "br-6");

  assert.equal(state.fronts.turkish, 1);
  assert.deepEqual(state.mo.completed.br, ["br-6"]);
  assert.equal(state.rp.ap.br, 0);
  assert.equal(state.rp.ap.us, 0);
  assert.equal(state.rp.ap.fr, 9);
});

test("v41 FR RP cannot qualify or pay Turkish-front maintenance", () => {
  const state = rules.setup(4106);
  state.events.entry_tu = true;
  state.events["cp_土耳其参战"] = true;
  state.events["ap_丘吉尔"] = true;
  state.fronts.russian = 0;
  state.fronts.turkish = 0;
  installFrontMo(state, "br", "br-6");
  state.rp.cp = { ge: 0, ah: 6, east: 1 };
  state.rp.ap = { br: 0, us: 0, fr: 20, it: 0 };
  state.reserves.ap.push({
    id: "br-front-loss",
    piece: "component-094",
    faction: "ap",
    nation: "br",
    type: "corps",
    reduced: false,
  });

  assert.equal(rules._test.frontMoCommitmentPlan(state, "ap", "br-6"), null);
  rules._test.beginFrontMaintenance(state);
  assert.equal(state.active, "ap");
  const choices = rules.view(state, AP_ROLE).actions.event_choose || [];
  assert.equal(choices.includes("pay:fr"), false);
});

test("a committed front MO is waived without advance payment if the front becomes locked", () => {
  const state = rules.setup(4107);
  state.events.entry_tu = true;
  state.events["cp_土耳其参战"] = true;
  state.events["ap_丘吉尔"] = true;
  state.fronts.russian = 0;
  state.fronts.turkish = 0;
  installFrontMo(state, "br", "br-6");
  state.rp.cp = { ge: 0, ah: 6, east: 1 };
  state.rp.ap = { br: 2, us: 2, fr: 0, it: 0 };

  const plan = rules._test.frontMoCommitmentPlan(state, "ap", "br-6");
  assert.ok(plan);
  state.mo.front_commitments["br:br-6"] = plan;
  state.turn_flags.turkish_front_locked = state.turn;

  rules._test.beginFrontMaintenance(state);

  assert.equal(state.fronts.turkish, 0);
  assert.deepEqual(state.mo.completed.br, []);
  assert.deepEqual(state.mo.waived.br, ["br-6"]);
  assert.equal(state.rp.ap.br, 1);
  assert.equal(state.rp.ap.us, 2);
  assert.equal(plan.processed, true);
  assert.equal(plan.waived, true);
});
