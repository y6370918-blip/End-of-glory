"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const data = require("../data.js");
const rules = require("../rules.js");
const ConnectionData = require("../connection-data.js");

const root = path.resolve(__dirname, "..");
const sourceEdges = JSON.parse(
  fs.readFileSync(path.join(root, "data", "source", "edges.json"), "utf8"),
);

test("connection data defines exactly the six EOG land-use modes", () => {
  assert.deepEqual(ConnectionData.CONNECTION_MODES, [
    "move",
    "attack",
    "supply",
    "sr",
    "retreat",
    "advance",
  ]);
  assert.deepEqual(data.connection_modes, ConnectionData.CONNECTION_MODES);
  assert.equal(data.connection_modes.includes("command"), false);
  assert.equal(data.connection_modes.includes("range"), false);
});

test("every source connection explicitly defines valid modes and factions", () => {
  assert.equal(sourceEdges.length, data.edges.length);
  assert.ok(sourceEdges.length > 0);
  assert.equal(
    ConnectionData.validateConnections(
      sourceEdges,
      data.spaces.map((space) => space.id),
    ),
    true,
  );
  for (const edge of sourceEdges) {
    assert.ok(Object.hasOwn(edge, "modes"), `${edge.a}-${edge.b} modes`);
    assert.ok(Object.hasOwn(edge, "factions"), `${edge.a}-${edge.b} factions`);
    assert.equal(edge.type, "land");
    assert.deepEqual(edge.modes, ConnectionData.CONNECTION_MODES);
    assert.deepEqual(
      edge.factions,
      edge.requires_land_attack_support ? ["ap"] : ["ap", "cp"],
    );
  }
});

test("generated per-space mode indexes exactly match the source edges", () => {
  const index = ConnectionData.buildConnectionIndex(
    data.edges,
    data.spaces.map((space) => space.id),
  );
  for (const space of data.spaces)
    assert.deepEqual(
      space.connections_by_mode,
      ConnectionData.generatedConnectionsByMode(index, space.id),
      space.id,
    );
});

test("mode and faction restrictions are independent", () => {
  const edges = [
    {
      a: "a",
      b: "b",
      type: "land",
      modes: ["move", "supply"],
      factions: ["ap"],
    },
  ];
  const index = ConnectionData.buildConnectionIndex(edges, ["a", "b"]);
  assert.equal(ConnectionData.connectionAllows(index, "a", "b", "move", "ap"), true);
  assert.equal(ConnectionData.connectionAllows(index, "a", "b", "supply", "ap"), true);
  assert.equal(ConnectionData.connectionAllows(index, "a", "b", "attack", "ap"), false);
  assert.equal(ConnectionData.connectionAllows(index, "a", "b", "move", "cp"), false);
  assert.deepEqual(ConnectionData.landNeighbors(index, "a"), ["b"]);
});

test("connection semantic flags support bidirectional and endpoint-specific river crossings", () => {
  const edge = {
    a: "a",
    b: "b",
    type: "land",
    modes: ["move"],
    factions: ["ap"],
    river: true,
  };
  assert.equal(ConnectionData.validateConnections([edge], ["a", "b"]), true);
  assert.throws(
    () => ConnectionData.validateConnections([{ ...edge, river: "yes" }], ["a", "b"]),
    /invalid river/,
  );
  const directional = { ...edge, river: undefined, river_from: "a" };
  assert.equal(ConnectionData.validateConnections([directional], ["a", "b"]), true);
  assert.throws(
    () => ConnectionData.validateConnections([{ ...directional, river_from: "c" }], ["a", "b"]),
    /invalid river_from/,
  );
  assert.throws(
    () => ConnectionData.validateConnections([{ ...directional, river: true }], ["a", "b"]),
    /both river and river_from/,
  );
});

test("directional river rules apply only when attacking from the recorded endpoint", () => {
  const source = data.edges[0];
  const edge = rules._test.connectionBetween(source.a, source.b);
  const previousRiver = edge.river;
  const previousFrom = edge.river_from;
  delete edge.river;
  edge.river_from = edge.a;
  try {
    assert.equal(rules._test.connectionRule(edge.a, edge.b, "river"), true);
    assert.equal(rules._test.connectionRule(edge.b, edge.a, "river"), false);
  } finally {
    if (previousRiver === undefined) delete edge.river;
    else edge.river = previousRiver;
    if (previousFrom === undefined) delete edge.river_from;
    else edge.river_from = previousFrom;
  }
});

test("four Channel roads grant all six modes to AP only", () => {
  const channel = data.edges.filter((edge) => edge.requires_land_attack_support);
  assert.equal(channel.length, 4);
  for (const edge of channel) {
    assert.equal(edge.type, "land");
  for (const mode of ConnectionData.CONNECTION_MODES)
      assert.equal(rules._test.connectionAllows(edge.a, edge.b, mode, "ap"), true);
    for (const mode of ConnectionData.CONNECTION_MODES)
      assert.equal(rules._test.connectionAllows(edge.a, edge.b, mode, "cp"), false);
    assert.equal(rules._test.landNeighbors(edge.a).includes(edge.b), true);
  }
});

test("rules consume the connection API instead of raw space connections", () => {
  const sources = [
    "rules.js",
    "modules/systems/map.js",
    "modules/systems/supply.js",
    "modules/systems/operations.js",
    "modules/systems/combat.js",
  ].map((file) => fs.readFileSync(path.join(root, file), "utf8"));
  const source = sources.join("\n");
  assert.doesNotMatch(source, /factionCanUseConnection/);
  assert.doesNotMatch(source, /\.connections\b/);
  for (const mode of ConnectionData.CONNECTION_MODES)
    assert.match(source, new RegExp(`(?:neighborsFor|connectionAllows)\\([^\\n]*["']${mode}["']`));
});

test("a rules hot reload evicts stale generated connection data", () => {
  const script = [
    "const dataPath = require.resolve('./data.js')",
    "require.cache[dataPath] = { id: dataPath, filename: dataPath, loaded: true, exports: { schema: 1, edges: [{ a: 'antwerp', b: 'brussels', type: 'land' }] } }",
    "require('./rules.js')",
    "if (require.cache[dataPath].exports.schema !== 2) process.exit(2)",
  ].join(";");
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
