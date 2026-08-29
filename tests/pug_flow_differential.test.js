"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const rules = require("../rules.js");

const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, "fixtures", "pug_common_flow.json"),
  "utf8",
));

test("EOG registers every state in the PUG common-flow semantic projection", () => {
  const registered = new Set(rules._test.engineStateNames());
  const seenFlows = new Set();
  for (const entry of fixture) {
    assert.equal(seenFlows.has(entry.flow), false, `duplicate flow ${entry.flow}`);
    seenFlows.add(entry.flow);
    assert.ok(entry.pug.length > 0, `${entry.flow} has no PUG reference state`);
    assert.ok(entry.eog.length > 0, `${entry.flow} has no EOG state`);
    for (const stateName of entry.eog)
      assert.ok(registered.has(stateName), `${entry.flow}: missing EOG state ${stateName}`);
  }
});

test("EOG keeps explicit event ownership outside the PUG common-flow projection", () => {
  const registered = rules._test.engineStateNames();
  assert.equal(registered.includes("event"), false);
  assert.ok(registered.some((name) => name.startsWith("event_")));
  assert.equal(fixture.some((entry) => entry.eog.includes("event")), false);
});
