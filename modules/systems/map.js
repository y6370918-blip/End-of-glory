"use strict";

function createMapSystem({ data, ConnectionData, cardById }) {
  const spaceById = Object.fromEntries(
    data.spaces.map((space) => [space.id, space]),
  );
  const index = ConnectionData.buildConnectionIndex(
    data.edges || [],
    data.spaces.map((space) => space.id),
  );

  const connectionBetween = (from, to) =>
    ConnectionData.connectionBetween(index, from, to) || null;
  const connectionType = (from, to) => connectionBetween(from, to)?.type || null;
  const connectionRule = (from, to, rule) => {
    const edge = connectionBetween(from, to);
    if (!edge) return false;
    if (rule === "river")
      return edge.river === true || edge.river_from === from;
    return Boolean(edge[rule]);
  };
  const isLandConnection = (from, to) => connectionType(from, to) === "land";
  const connectionAllows = (from, to, mode, faction) =>
    ConnectionData.connectionAllows(index, from, to, mode, faction);
  const neighborsFor = (space, mode, faction) =>
    ConnectionData.neighborsFor(index, space, mode, faction);
  const landNeighbors = (space) => ConnectionData.landNeighbors(index, space);

  function theaterOf(space) {
    return ["it", "ah"].includes(spaceById[space]?.nation)
      ? "italian"
      : "western";
  }

  function italianTheaterActive(state) {
    return Boolean(
      state.events?.entry_it || state.events?.[cardById[625]?.event],
    );
  }

  function turkishFrontActive(state) {
    return Boolean(
      state.events?.entry_tu || state.events?.[cardById[703]?.event],
    );
  }

  function spaceCanActivate(state, space) {
    return theaterOf(space) !== "italian" || italianTheaterActive(state);
  }

  return Object.freeze({
    index,
    connectionBetween,
    connectionType,
    connectionRule,
    isLandConnection,
    connectionAllows,
    neighborsFor,
    landNeighbors,
    theaterOf,
    italianTheaterActive,
    turkishFrontActive,
    spaceCanActivate,
  });
}

module.exports = { createMapSystem };
