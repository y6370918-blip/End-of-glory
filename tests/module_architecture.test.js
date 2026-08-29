"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const rulesSource = fs.readFileSync(path.join(root, "rules.js"), "utf8");

test("rules dispatch actions and prompts through the state engine", () => {
  assert.match(rulesSource, /Engine\.dispatch\(state, action, arg, current\)/);
  assert.match(rulesSource, /Engine\.view\(state, current\)/);
  assert.match(rulesSource, /stateFactories:\s*\[/);
  assert.doesNotMatch(rulesSource, /const\s+handlers\s*=/);
  assert.doesNotMatch(rulesSource, /switch\s*\(state\.state\)/);
  assert.doesNotMatch(rulesSource, /collectActionCandidates/);
});

test("PUG-style state and system modules replace the old facade directory", () => {
  for (const file of [
    "modules/engine.js",
    "modules/core/constants.js",
    "modules/core/utils.js",
    "modules/core/game-utils.js",
    "modules/core/history.js",
    "modules/systems/map.js",
    "modules/systems/supply.js",
    "modules/systems/units.js",
    "modules/systems/operations.js",
    "modules/systems/combat.js",
    "modules/systems/combat-cards.js",
    "modules/systems/deterministic.js",
    "modules/systems/action.js",
    "modules/systems/events.js",
    "modules/systems/events/combat.js",
    "modules/systems/events/fronts.js",
    "modules/systems/events/movement.js",
    "modules/systems/events/reinforcements.js",
    "modules/systems/events/replacement.js",
    "modules/systems/fronts.js",
    "modules/systems/mo.js",
    "modules/systems/naval.js",
    "modules/systems/replacement.js",
    "modules/systems/turn.js",
    "modules/view.js",
    "modules/analysis/index.js",
    "modules/analysis/semantic-diff.js",
    "modules/analysis/view-explanations.js",
    "modules/states/states_action.js",
    "modules/states/states_activation.js",
    "modules/states/states_movement.js",
    "modules/states/states_combat.js",
    "modules/states/states_turn.js",
    "modules/states/states_event.js",
  ]) assert.equal(fs.existsSync(path.join(root, file)), true, file);

  for (const file of [
    "rules/operations.js",
    "rules/combat.js",
    "rules/strategic.js",
    "rules/events.js",
    "rules/map.js",
  ]) assert.equal(fs.existsSync(path.join(root, file)), false, file);
});

test("rules.js is an RTT composition root rather than a domain implementation", () => {
  assert.ok(rulesSource.split(/\r?\n/).length <= 3500);
  const declarations = [...rulesSource.matchAll(/^function\s+([A-Za-z_$][\w$]*)/gm)]
    .map((match) => match[1]);
  assert.deepEqual(declarations, [
    "ensureState",
    "random",
    "roll",
    "shuffle",
    "log",
    "snapshot",
		"clearUndo",
		"advanceRestoringState",
		"undoAvailable",
    "restoreSnapshot",
    "checkpoint",
    "set_up_historical_scenario",
    "createState",
  ]);
});

test("systems and states never import rules.js or invert the dependency graph", () => {
  const moduleRoot = path.join(root, "modules");
  const queue = [moduleRoot];
  while (queue.length) {
    const current = queue.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(file);
      else if (entry.name.endsWith(".js")) {
        const source = fs.readFileSync(file, "utf8");
        assert.doesNotMatch(source, /require\([^\n)]*rules(?:\.js)?["']\)/, file);
        if (file.includes(`${path.sep}systems${path.sep}`))
          assert.doesNotMatch(source, /require\([^\n)]*states[\\/]/, file);
      }
    }
  }
});

test("engine rejects duplicate states and owns view and analysis interfaces", () => {
  const { createEngine } = require("../modules/engine.js");
  const view = { publicView: (state, role) => ({ state, role }) };
  const engine = createEngine({ systems: { view } });
  engine.registerStates({ sample: { prompt() {}, go() {} } });
  assert.throws(
    () => engine.registerStates({ sample: { prompt() {} } }),
    /Duplicate state registration/,
  );
  assert.deepEqual(engine.view("position", "role"), {
    state: "position",
    role: "role",
  });
  const analysis = engine.registerAnalysis({ inspect: () => true });
  assert.equal(engine.analysis, analysis);
  assert.throws(() => engine.registerAnalysis({}), /already configured/);
});

test("state modules own both action generation and action handlers", () => {
  for (const file of fs.readdirSync(path.join(root, "modules/states"))) {
    const source = fs.readFileSync(path.join(root, "modules/states", file), "utf8");
    assert.match(source, /(?:\.prompt\s*=|prompt\s*\()/, file);
    assert.match(source, /message\s*(?::|\()/, file);
  }
});

test("live systems enter explicit event states without the legacy catch-all", () => {
  const files = [path.join(root, "rules.js")];
  const queue = [path.join(root, "modules", "systems")];
  while (queue.length) {
    const current = queue.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(file);
      else if (entry.name.endsWith(".js")) files.push(file);
    }
  }
  for (const file of files)
    assert.doesNotMatch(
      fs.readFileSync(file, "utf8"),
      /state\.state\s*=\s*["']event["']/,
      file,
    );

  const eventStates = fs.readFileSync(
    path.join(root, "modules", "states", "states_event.js"),
    "utf8",
  );
  assert.match(eventStates, /explicitEventState\(kind\)/);
  assert.doesNotMatch(eventStates, /\[GENERIC_EVENT_STATE,\s*event\]/);
});

test("event flow entry assigns the owning explicit state immediately", () => {
  const { canonicalizeEventState, enterEventFlow } = require("../modules/core/event-flow.js");
  const state = { state: "action_card", pending_event: null };
  const pending = { card: 701, kind: "august_reposition" };
  assert.equal(enterEventFlow(state, pending), pending);
  assert.equal(state.pending_event, pending);
  assert.equal(state.state, "event_august_reposition");
  state.pending_event = { card: 713, kind: "ohl" };
  canonicalizeEventState(state);
  assert.equal(state.state, "event_ohl");
  assert.throws(
    () => enterEventFlow(state, { card: 701, kind: "unknown" }),
    /Unknown pending event flow/,
  );
});
