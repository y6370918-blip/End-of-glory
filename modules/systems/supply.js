"use strict";

function createSupplySystem(api) {
  const SUPPLY_NATIONS = Object.freeze({
    [api.AP]: ["be", "br", "fr", "it", "us"],
    [api.CP]: ["ah", "ge"],
  });

  function portSupplyAllowed(state, faction, space) {
    const blockade = api.activeRule(state, "channel_blockade");
    return !(
      faction === blockade?.blocked_faction &&
      ["br", "fr", "be"].includes(space.nation)
    );
  }

  function supplyNations(unitOrNation) {
    if (typeof unitOrNation === "string") return [unitOrNation];
    const piece = unitOrNation?.piece
      ? api.pieceById[unitOrNation.piece]
      : unitOrNation;
    const combined = piece?.combined_nations;
    if (Array.isArray(combined) && combined.length)
      return [...new Set(combined)];
    return unitOrNation?.nation ? [unitOrNation.nation] : [];
  }

  function londonOpen(state) {
    return state.control.london === api.AP &&
      api.unitsAt(state, "london", api.CP).length === 0;
  }

  function belgianFallbackActive(state) {
    return state.control.brussels !== api.AP;
  }

  function britishOrFrenchPort(space) {
    return Boolean(space?.port && ["br", "fr"].includes(space.nation));
  }

  function frenchPort(space) {
    return Boolean(space?.port && space.nation === "fr");
  }

  function sourceMatchesNation(state, faction, nation, space) {
    if (!space) return false;
    if (faction === api.AP && nation === "be") {
      if (!belgianFallbackActive(state)) return space.id === "brussels";
      return londonOpen(state) &&
        (space.id === "london" || britishOrFrenchPort(space));
    }
    if (faction === api.AP && nation === "us")
      return frenchPort(space);
    if (faction === api.AP && nation === "br")
      return londonOpen(state) &&
        (space.id === "london" || britishOrFrenchPort(space));
    if (faction === api.CP && nation === "ge" && space.id === "brussels")
      return state.control.brussels === api.CP;
    if (faction === api.CP && nation === "ge" && space.id === "carnicola")
      return true;
    return Boolean(
      space.supply &&
      space.faction === faction &&
      space.nation === nation
    );
  }

  function supplyProfile(state, unitOrNation, faction = unitOrNation?.faction) {
    const nations = supplyNations(unitOrNation);
    const resolvedFaction = faction ||
      (nations.some((nation) => ["ah", "ge"].includes(nation)) ? api.CP : api.AP);
    return {
      faction: resolvedFaction,
      nations,
      belgian_fallback: resolvedFaction === api.AP &&
        nations.includes("be") && belgianFallbackActive(state),
      independent_french_ports: resolvedFaction === api.AP && nations.includes("us"),
    };
  }

  function nationalSupplySource(state, faction, unitOrNation, space) {
    return supplyNations(unitOrNation).some((nation) =>
      sourceMatchesNation(state, faction, nation, space));
  }

  function sourceUsable(state, faction, space) {
    return Boolean(
      space &&
      !(faction === api.CP && space.port) &&
      state.control[space.id] === faction &&
      api.unitsAt(state, space.id, api.other(faction)).length === 0 &&
      (!space.port || portSupplyAllowed(state, faction, space))
    );
  }

  function nationalSupplySources(state, faction, unitOrNation) {
    return api.data.spaces
      .filter((space) => sourceUsable(state, faction, space))
      .filter((space) => nationalSupplySource(state, faction, unitOrNation, space))
      .map((space) => space.id);
  }

  function supplySources(state, faction, unitOrNation = null) {
    if (unitOrNation != null)
      return nationalSupplySources(state, faction, unitOrNation);
    const result = new Set();
    for (const nation of SUPPLY_NATIONS[faction] || [])
      for (const source of nationalSupplySources(state, faction, nation))
        result.add(source);
    return [...result];
  }

  function suppliedSpaces(state, faction, unitOrNation = null) {
    const sources = supplySources(state, faction, unitOrNation);
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

  function supplyStatus(state, unit) {
    if (!unit?.location) return null;
    if (suppliedSpaces(state, unit.faction, unit).has(unit.location))
      return "full";
    if (suppliedSpaces(state, unit.faction, null).has(unit.location))
      return "limited";
    if (api.intactFort(state, unit.location) &&
        api.spaceById[unit.location]?.faction === unit.faction)
      return "fort_limited";
    return "none";
  }

  function applySupplyStatus(unit, status) {
    unit.supplied = status === "full";
    unit.limited_supply = status === "limited";
    unit.fort_limited_supply = status === "fort_limited";
  }

  function supplyDependencySignature(state) {
    const control = api.data.spaces
      .map((space) => state.control?.[space.id] || "-")
      .join("");
    const units = (state.units || [])
      .map((unit) => `${unit.id}:${unit.piece}:${unit.faction}:${unit.nation}:${unit.location || "-"}`)
      .sort()
      .join("|");
    const forts = [...(state.destroyed_forts || [])].sort().join(",");
    const besieged = [...(state.besieged || [])].sort().join(",");
    const blockade = JSON.stringify(api.activeRule(state, "channel_blockade") || null);
    return `${control}#${units}#${forts}#${besieged}#${blockade}`;
  }

  function markSupplyDirty(state) {
    state.supply_dirty = true;
  }

  function updateSupply(state) {
    const networks = new Map();
    const network = (faction, unitOrNation = null) => {
      const nations = unitOrNation == null
        ? ["*"]
        : supplyNations(unitOrNation).slice().sort();
      const key = `${faction}:${nations.join("+")}`;
      if (!networks.has(key))
        networks.set(key, suppliedSpaces(state, faction, unitOrNation));
      return networks.get(key);
    };
    for (const unit of state.units || []) {
      let status = "none";
      if (unit.location && network(unit.faction, unit).has(unit.location))
        status = "full";
      else if (unit.location && network(unit.faction).has(unit.location))
        status = "limited";
      else if (unit.location && api.intactFort(state, unit.location) &&
          api.spaceById[unit.location]?.faction === unit.faction)
        status = "fort_limited";
      applySupplyStatus(unit, status);
    }
    state.supply_signature = supplyDependencySignature(state);
    state.supply_dirty = false;
  }

  function ensureSupply(state) {
    const signature = supplyDependencySignature(state);
    if (state.supply_dirty !== false || state.supply_signature !== signature)
      updateSupply(state);
    return state;
  }

  function placementSources(state, unit, purpose = "rebuild") {
    const faction = unit.faction ||
      (["ah", "ge"].includes(unit.nation) ? api.CP : api.AP);
    let sources = nationalSupplySources(state, faction, unit);
    if (["rebuild", "reinforcement"].includes(purpose) &&
        state.turn <= 2 && faction === api.AP &&
        ["be", "br"].includes(unit.nation))
      sources = sources.filter((id) => {
        const space = api.spaceById[id];
        return !(space?.port && space.nation === "fr");
      });
    return sources;
  }

  return Object.freeze({
    ensureSupply,
    markSupplyDirty,
    nationalSupplySource,
    nationalSupplySources,
    placementSources,
    portSupplyAllowed,
    suppliedSpaces,
    supplyDependencySignature,
    supplyProfile,
    supplySources,
    supplyStatus,
    updateSupply,
  });
}

module.exports = { createSupplySystem };
