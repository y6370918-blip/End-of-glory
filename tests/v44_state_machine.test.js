"use strict";

process.env.NODE_TEST_CONTEXT = "1";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const rules = require("../rules.js");

const AP = "Allied Powers";
const clone = (value) => JSON.parse(JSON.stringify(value));

test("v44 stores compact unlimited same-action undo points", () => {
  const state = rules.setup(4401);
  state.state = "action_card";
  state.active = "ap";
  state.action_round = 1;
  state.log = [];

  for (let index = 0; index < 30; index += 1) {
    rules._test.snapshot(state, `step-${index}`);
    state.vp += 1;
    state.log.push(`log-${index}`);
  }

  assert.equal(state.undo.length, 30);
  assert.equal(state.undo[0].log_cursor, 0);
  assert.equal("log" in state.undo[0].state, false);
  assert.equal("undo" in state.undo[0].state, false);
  assert.equal("rollback" in state.undo[0].state, false);
  assert.equal("rollback_state" in state.undo[0].state, false);

  const entry = state.undo.pop();
  rules._test.restoreSnapshot(state, entry);
  assert.equal(state.log.length, 29);
  assert.equal(state.undo.length, 29);
});

test("v44 rollback metadata and compressed state stay separate", () => {
  const state = rules.setup(4402);
  rules._test.checkpoint(state, "action", "start");
  assert.equal(state.rollback.length, 1);
  assert.equal("state" in state.rollback[0], false);
  assert.match(state.rollback_state, /^eog-rb-v44:/);
  const snapshot = rules._test.rollbackSnapshot(state, 0);
  assert.ok(snapshot);
  assert.equal("log" in snapshot, false);
  assert.equal("rollback" in snapshot, false);

  state.vp += 1;
  const preview = rules.query(state, AP, "rollback");
  assert.equal(preview.length, 1);
  assert.equal(preview[0].label, "start");
  assert.ok(preview[0].changes.resources.some((change) => change.key === "vp"));
});

test("v44 atomically restores a signed action when conservation fails", () => {
  const state = rules.setup(4403);
  state.state = "action_card";
  state.phase = "行动阶段";
  state.active = "ap";
  state.action_round = 1;
  state.action_state = {
    turn: state.turn,
    round: state.action_round,
    actor: state.active,
    used_combat_cards: [],
  };
  state.options.assert_card_conservation = true;
  state.discard.ap.push(state.decks.ap[0]);
  const before = clone(state);

  assert.throws(
    () => rules.action(state, AP, "one_op"),
    /Action failed \(action_card\/one_op\/undefined\): Card conservation failed/,
  );
  assert.deepEqual(state, before);
  assert.equal(state.log.some((entry) => String(entry).includes("非法动作")), false);
});

test("v44 migrates the legacy event state to an explicit registered flow", () => {
  const state = rules.setup(4404);
  state.version = 43;
  state.state = "event";
  state.phase = "行动阶段";
  state.active = "ap";
  state.pending_event = {
    card: 600,
    faction: "ap",
    owner: "ap",
    chooser: "ap",
    kind: "card_search",
    cards: [601],
  };

  const view = rules.view(state, AP);
  assert.equal(state.version, 46);
  assert.equal(state.state, "event_card_search");
  assert.deepEqual(view.actions.event_choose, ["601"]);
});

test("v44 compacts legacy undo and rollback snapshots without changing the position", () => {
  const state = rules.setup(4406);
  state.version = 43;
  const undoPosition = clone(state);
  undoPosition.vp -= 1;
  undoPosition.log.push("legacy undo");
  const rollbackPosition = clone(state);
  rollbackPosition.vp += 1;
  rollbackPosition.log.push("legacy rollback");
  state.undo = [{ label: "legacy", state: undoPosition }];
  state.rollback = [{
    turn: state.turn,
    round: state.action_round,
    kind: "action",
    label: "legacy checkpoint",
    state: rollbackPosition,
  }];

  const before = { vp: state.vp, active: state.active, seed: state.seed };
  rules.view(state, AP);

  assert.equal(state.version, 46);
  assert.deepEqual({ vp: state.vp, active: state.active, seed: state.seed }, before);
  assert.equal(state.undo.length, 1);
  assert.equal("log" in state.undo[0].state, false);
  assert.equal("undo" in state.undo[0].state, false);
  assert.equal("state" in state.rollback[0], false);
  assert.match(state.rollback_state, /^eog-rb-v44:/);
  assert.equal(rules._test.rollbackSnapshot(state, 0).vp, rollbackPosition.vp);
});

test("v44 rejects an unknown saved event flow with card diagnostics", () => {
  const state = rules.setup(4405);
  state.version = 43;
  state.state = "event";
  state.pending_event = { card: 754, kind: "obsolete_unknown_flow" };
  assert.throws(
    () => rules.view(state, AP),
    /Unknown pending event flow: card 754, kind obsolete_unknown_flow/,
  );
});

test("all explicit event states are registered and the catch-all is absent", () => {
  const names = rules._test.engineStateNames();
  assert.equal(names.includes("event"), false);
  assert.ok(names.includes("event_choice"));
  assert.ok(names.includes("event_reinforcement"));
  assert.ok(names.includes("event_front_payment") || names.includes("event_front_investment"));
  assert.equal(new Set(names).size, names.length);
});

test("every literal state written by a runtime module is registered", () => {
  const root = path.join(__dirname, "..", "modules");
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.name.endsWith(".js")) files.push(target);
    }
  };
  visit(root);
  const written = new Set();
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/state\.state\s*=\s*["']([^"']+)["']/g))
      written.add(match[1]);
  }
  const registered = new Set(rules._test.engineStateNames());
  const transient = new Set(["event", "automatic"]);
  assert.deepEqual(
    [...written].filter((name) => !registered.has(name) && !transient.has(name)),
    [],
  );
});
