"use strict";

const CONNECTION_MODES = Object.freeze([
  "move",
  "attack",
  "supply",
  "sr",
  "retreat",
  "advance",
]);
const CONNECTION_FACTIONS = Object.freeze(["ap", "cp"]);
const CONNECTION_BOOLEAN_FLAGS = Object.freeze([
  "difficult",
  "alpine",
  "river",
  "requires_land_attack_support",
]);

const modeSet = new Set(CONNECTION_MODES);
const factionSet = new Set(CONNECTION_FACTIONS);

function directedKey(from, to) {
  return `${from}|${to}`;
}

function undirectedKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function assertUniqueValues(values, allowed, label, edge) {
  if (!Array.isArray(values))
    throw new Error(`Connection ${edge.a}-${edge.b} must define ${label}`);
  if (new Set(values).size !== values.length)
    throw new Error(`Connection ${edge.a}-${edge.b} has duplicate ${label}`);
  for (const value of values)
    if (!allowed.has(value))
      throw new Error(
        `Connection ${edge.a}-${edge.b} has unknown ${label} value ${value}`,
      );
}

function validateConnections(edges, spaceIds = null) {
  if (!Array.isArray(edges)) throw new Error("Connections must be an array");
  const spaces = spaceIds == null ? null : new Set(spaceIds);
  const seen = new Set();
  for (const edge of edges) {
    if (!edge || typeof edge.a !== "string" || typeof edge.b !== "string")
      throw new Error("Every connection must define string endpoints");
    if (edge.a === edge.b)
      throw new Error(`Connection ${edge.a}-${edge.b} cannot be a loop`);
    if (spaces && (!spaces.has(edge.a) || !spaces.has(edge.b)))
      throw new Error(`Connection ${edge.a}-${edge.b} has an invalid endpoint`);
    const key = undirectedKey(edge.a, edge.b);
    if (seen.has(key)) throw new Error(`Duplicate connection ${key}`);
    seen.add(key);
    if (edge.type !== "land")
      throw new Error(`Connection ${edge.a}-${edge.b} has invalid type`);
    for (const legacy of ["no_attack", "ap_only", "cp_only"])
      if (Object.hasOwn(edge, legacy))
        throw new Error(
          `Connection ${edge.a}-${edge.b} must express ${legacy} through modes/factions`,
        );
    assertUniqueValues(edge.modes, modeSet, "modes", edge);
    assertUniqueValues(edge.factions, factionSet, "factions", edge);
    for (const flag of CONNECTION_BOOLEAN_FLAGS)
      if (edge[flag] != null && typeof edge[flag] !== "boolean")
        throw new Error(`Connection ${edge.a}-${edge.b} has invalid ${flag}`);
    if (edge.river_from != null &&
        edge.river_from !== edge.a &&
        edge.river_from !== edge.b)
      throw new Error(
        `Connection ${edge.a}-${edge.b} has invalid river_from endpoint`,
      );
    if (edge.river === true && edge.river_from != null)
      throw new Error(
        `Connection ${edge.a}-${edge.b} cannot define both river and river_from`,
      );
  }
  return true;
}

function buildConnectionIndex(edges, spaceIds = null) {
  validateConnections(edges, spaceIds);
  const byPair = new Map();
  const landBySpace = new Map();
  const byMode = Object.fromEntries(
    CONNECTION_MODES.map((mode) => [
      mode,
      Object.fromEntries(CONNECTION_FACTIONS.map((faction) => [faction, new Map()])),
    ]),
  );

  function addNeighbor(map, from, to) {
    if (!map.has(from)) map.set(from, []);
    map.get(from).push(to);
  }

  for (const edge of edges) {
    byPair.set(directedKey(edge.a, edge.b), edge);
    byPair.set(directedKey(edge.b, edge.a), edge);
    addNeighbor(landBySpace, edge.a, edge.b);
    addNeighbor(landBySpace, edge.b, edge.a);
    for (const mode of edge.modes)
      for (const faction of edge.factions) {
        addNeighbor(byMode[mode][faction], edge.a, edge.b);
        addNeighbor(byMode[mode][faction], edge.b, edge.a);
      }
  }

  for (const list of landBySpace.values()) list.sort();
  for (const mode of CONNECTION_MODES)
    for (const faction of CONNECTION_FACTIONS)
      for (const list of byMode[mode][faction].values()) list.sort();

  return { byPair, landBySpace, byMode };
}

function connectionBetween(index, from, to) {
  return index.byPair.get(directedKey(from, to)) || null;
}

function connectionAllows(index, from, to, mode, faction) {
  if (!modeSet.has(mode) || !factionSet.has(faction)) return false;
  const edge = connectionBetween(index, from, to);
  return Boolean(
    edge &&
      edge.modes.includes(mode) &&
      edge.factions.includes(faction),
  );
}

function neighborsFor(index, space, mode, faction) {
  if (!modeSet.has(mode) || !factionSet.has(faction)) return [];
  return index.byMode[mode][faction].get(space) || [];
}

function landNeighbors(index, space) {
  return index.landBySpace.get(space) || [];
}

function generatedConnectionsByMode(index, space) {
  return Object.fromEntries(
    CONNECTION_MODES.map((mode) => [
      mode,
      Object.fromEntries(
        CONNECTION_FACTIONS.map((faction) => [
          faction,
          [...neighborsFor(index, space, mode, faction)],
        ]),
      ),
    ]),
  );
}

module.exports = {
  CONNECTION_MODES,
  CONNECTION_FACTIONS,
  CONNECTION_BOOLEAN_FLAGS,
  validateConnections,
  buildConnectionIndex,
  connectionBetween,
  connectionAllows,
  neighborsFor,
  landNeighbors,
  generatedConnectionsByMode,
};
