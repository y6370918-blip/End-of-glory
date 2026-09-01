"use strict";

function createUnitSystem(context) {
  const { AP, CP, adjustVp, cardById, other, pieceById, spaceById } = context;

  function unitsAt(state, space, faction = null) {
    return state.units.filter(
      (unit) => unit.location === space && (!faction || unit.faction === faction),
    );
  }

  function isCombatUnit(unit) {
    return Boolean(unit && ["army", "corps"].includes(unit.type));
  }

  function isAttackParticipant(unit) {
    return Boolean(unit && (isCombatUnit(unit) || unit.type === "hq"));
  }

  function acceptsReplacementPoints(unit) {
    return pieceById[unit?.piece]?.accepts_replacement_points !== false;
  }

  function permanentOnElimination(unit) {
    return Boolean(pieceById[unit?.piece]?.permanent_on_elimination);
  }

  function normalizeOffMapUnit(unit) {
    if (!unit) return unit;
    delete unit.location;
    delete unit.supplied;
    delete unit.limited_supply;
    delete unit.fort_limited_supply;
    delete unit.moved;
    delete unit.attacked;
    delete unit.attack_eligible;
    return unit;
  }

  function placeEliminatedUnit(state, unit, reason = "eliminated") {
    normalizeOffMapUnit(unit);
    const retreatException = reason === "unable_to_retreat" || reason === "无法撤退";
    if (permanentOnElimination(unit) && !retreatException) {
      state.permanently_removed_units ||= [];
      state.permanently_removed_units.push({
        ...unit,
        removed_by: reason,
        removed_turn: state.turn,
      });
      state.supply_dirty = true;
      return "permanent";
    }
    state.eliminated ||= { ap: [], cp: [] };
    state.eliminated[unit.faction].push(unit);
    state.supply_dirty = true;
    return "eliminated";
  }

  function permanentlyRemoveOnMapUnit(state, id, reason = "permanent") {
    const index = state.units.findIndex((unit) => unit.id === id);
    if (index < 0) return null;
    const [unit] = state.units.splice(index, 1);
    normalizeOffMapUnit(unit);
    state.permanently_removed_units ||= [];
    state.permanently_removed_units.push({
      ...unit,
      removed_by: reason,
      removed_turn: state.turn,
    });
    state.supply_dirty = true;
    return unit;
  }

  function nationalityGroup(nation) {
    if (["br", "be"].includes(nation)) return "br";
    if (["fr", "us"].includes(nation)) return "fr";
    return nation;
  }

  function stackLegal(state, space, movingUnit = null) {
    if (spaceById[space]?.large_area) return true;
    const units = unitsAt(state, space, movingUnit?.faction);
    const field = units.filter(
      (unit) => unit.type !== "hq" && unit.id !== movingUnit?.id,
    ).length;
    const hq = units.filter(
      (unit) => unit.type === "hq" && unit.id !== movingUnit?.id,
    ).length;
    return movingUnit?.type === "hq" ? hq < 1 : field < 3;
  }

  function captureSpace(state, space, faction) {
    if (state.control[space] !== faction) {
      delete state.fortifications[space];
      delete state.trenches[space];
    }
    state.control[space] = faction;
    state.supply_dirty = true;
    if (faction === AP && state.markers?.hindenburg?.includes(space))
      state.markers.hindenburg = state.markers.hindenburg.filter(
        (candidate) => candidate !== space,
      );
    if (faction === CP && state.markers?.killing_ground?.space === space) {
      if (!state.destroyed_forts.includes(space)) state.destroyed_forts.push(space);
      adjustVp(state, state.markers.killing_ground.destroy_vp || 1);
      const card = cardById[state.markers.killing_ground.source_card || 720];
      if (card) {
        delete state.events[card.event];
        state.removed.cp = state.removed.cp.filter((id) => id !== card.id);
        if (!state.discard.cp.includes(card.id)) state.discard.cp.push(card.id);
      }
      delete state.markers.killing_ground;
    }
  }

  function friendlySpace(state, spaceId, faction) {
    const enemy = unitsAt(state, spaceId, other(faction)).length;
    const friendlyBesieger =
      state.besieged.includes(spaceId) &&
      spaceById[spaceId]?.faction !== faction &&
      unitsAt(state, spaceId, faction).some(isCombatUnit);
    return enemy === 0 &&
      (state.control[spaceId] === faction || friendlyBesieger);
  }

  function hydrateUnit(unit) {
    const piece = pieceById[unit.piece];
    if (!piece) throw new Error("Unknown unit template");
    unit.faction ||= piece.faction;
    unit.nation ||= piece.nation;
    unit.type ||= piece.type;
    unit.moved = Boolean(unit.moved);
    unit.attacked = Boolean(unit.attacked);
    unit.supplied = unit.supplied !== false;
    unit.fort_limited_supply = Boolean(unit.fort_limited_supply);
    unit.limited_supply = Boolean(unit.limited_supply);
    return unit;
  }

  return Object.freeze({
    acceptsReplacementPoints,
    captureSpace,
    friendlySpace,
    hydrateUnit,
    isAttackParticipant,
    isCombatUnit,
    normalizeOffMapUnit,
    nationalityGroup,
    permanentOnElimination,
    permanentlyRemoveOnMapUnit,
    placeEliminatedUnit,
    stackLegal,
    unitsAt,
  });
}

module.exports = { createUnitSystem };
