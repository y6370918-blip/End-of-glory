"use strict";

function createSupplySystem(api) {
  function portSupplyAllowed(state, faction, space) {
    const blockade = api.activeRule(state, "channel_blockade");
    return !(
      faction === blockade?.blocked_faction &&
      ["br", "fr", "be"].includes(space.nation)
    );
  }

  function nationalSupplySource(state, faction, nation, space) {
    const nationality = api.nationalityGroup(nation);
    if (
      faction === api.AP &&
      space.id === "brussels" &&
      state.control.brussels === api.AP &&
      nationality === "br"
    ) return true;
    if (
      faction === api.CP &&
      space.id === "brussels" &&
      state.control.brussels === api.CP &&
      nationality === "ge"
    ) return true;
    if (faction === api.CP && nation === "ge" && space.id === "carnicola")
      return true;
    return Boolean(
      space.supply &&
      space.faction === faction &&
      api.nationalityGroup(space.nation) === nationality
    );
  }

  function supplySources(state, faction, nation = null) {
    const sources = api.data.spaces
      .filter((space) => state.control[space.id] === faction)
      .filter((space) => api.unitsAt(state, space.id, api.other(faction)).length === 0)
      .filter((space) => nation
        ? nationalSupplySource(state, faction, nation, space)
        : (space.supply && space.faction === faction) ||
          (faction === api.AP && space.id === "brussels") ||
          (faction === api.CP && space.id === "brussels"))
      .map((space) => space.id);
    // AP ports relay London's supply; they are not independent sources.
    // CP never receives port supply.
    const londonOpen = faction === api.AP &&
      state.control.london === api.AP &&
      api.unitsAt(state, "london", api.CP).length === 0;
    const usesLondon = !nation || api.nationalityGroup(nation) === "br";
    if (londonOpen && usesLondon)
      for (const space of api.data.spaces)
        if (space.port && state.control[space.id] === api.AP &&
            api.unitsAt(state, space.id, api.CP).length === 0 &&
            portSupplyAllowed(state, api.AP, space))
          sources.push(space.id);
    return [...new Set(sources)];
  }

  function suppliedSpaces(state, faction, nation = null) {
    const sources = supplySources(state, faction, nation);
    const seen = new Set(sources);
    const queue = sources.slice();
    while (queue.length) {
      const current = queue.shift();
      for (const next of api.neighborsFor(current, "supply", faction)) {
        if (seen.has(next) || !api.friendlySpace(state, next, faction)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return seen;
  }

  function updateSupply(state) {
    for (const faction of [api.AP, api.CP]) {
      const suppliedByNation = new Map();
      const friendlySupply = suppliedSpaces(state, faction, null);
      for (const unit of state.units.filter(
        (candidate) => candidate.faction === faction,
      )) {
        if (!suppliedByNation.has(unit.nation))
          suppliedByNation.set(
            unit.nation,
            suppliedSpaces(state, faction, unit.nation),
          );
        const supplied = suppliedByNation.get(unit.nation);
        unit.supplied = supplied.has(unit.location);
        unit.limited_supply = !unit.supplied && friendlySupply.has(unit.location);
        unit.fort_limited_supply =
          !unit.supplied &&
          !unit.limited_supply &&
          Boolean(api.intactFort(state, unit.location)) &&
          api.spaceById[unit.location]?.faction === unit.faction;
      }
    }
  }

  return Object.freeze({
    nationalSupplySource,
    portSupplyAllowed,
    suppliedSpaces,
    supplySources,
    updateSupply,
  });
}

module.exports = { createSupplySystem };
