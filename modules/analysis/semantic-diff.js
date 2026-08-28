"use strict";

const POOLS = ["map", "reserve", "upgrade", "eliminated", "removed"];

function factionForRole(role) {
  if (role === "Allied Powers" || role === "ap") return "ap";
  if (role === "Central Powers" || role === "cp") return "cp";
  return null;
}

function indexUnits(state) {
  const result = new Map();
  const add = (unit, pool, faction) =>
    result.set(unit.id, {
      id: unit.id,
      piece: unit.piece,
      faction: unit.faction || faction,
      pool,
      location: unit.location || null,
      reduced: Boolean(unit.reduced),
      moved: Boolean(unit.moved),
      attacked: Boolean(unit.attacked),
    });
  for (const unit of state.units || []) add(unit, "map", unit.faction);
  for (const faction of ["ap", "cp"])
    for (const [pool, source] of [
      ["reserve", state.reserves?.[faction]],
      ["upgrade", state.upgrade_pool?.[faction]],
      ["eliminated", state.eliminated?.[faction]],
      ["removed", state.permanently_removed_units?.[faction]],
    ])
      for (const unit of source || []) add(unit, pool, faction);
  return result;
}

function valueChanges(before, after, keys) {
  const result = [];
  for (const key of keys) {
    const left = before?.[key];
    const right = after?.[key];
    if (JSON.stringify(left) !== JSON.stringify(right))
      result.push({ key, before: left, after: right });
  }
  return result;
}

function semanticDiff(before, after, role) {
  const viewer = factionForRole(role);
  const leftUnits = indexUnits(before);
  const rightUnits = indexUnits(after);
  const units = [];
  for (const id of new Set([...leftUnits.keys(), ...rightUnits.keys()])) {
    const left = leftUnits.get(id) || null;
    const right = rightUnits.get(id) || null;
    if (JSON.stringify(left) !== JSON.stringify(right))
      units.push({ id, before: left, after: right });
  }
  const cards = {};
  for (const faction of ["ap", "cp"]) {
    const own = viewer === faction;
    const beforeHand = before.hands?.[faction] || [];
    const afterHand = after.hands?.[faction] || [];
    const hand = own
      ? { before: beforeHand.slice(), after: afterHand.slice() }
      : { before_count: beforeHand.length, after_count: afterHand.length };
    const deck = {
      before_count: before.decks?.[faction]?.length || 0,
      after_count: after.decks?.[faction]?.length || 0,
    };
    const publicPiles = {
      discard: {
        before: (before.discard?.[faction] || []).slice(),
        after: (after.discard?.[faction] || []).slice(),
      },
      removed: {
        before: (before.removed?.[faction] || []).slice(),
        after: (after.removed?.[faction] || []).slice(),
      },
      retained: {
        before: (before.retained_combat_cards?.[faction] || []).slice(),
        after: (after.retained_combat_cards?.[faction] || []).slice(),
      },
    };
    if (
      JSON.stringify(beforeHand) !== JSON.stringify(afterHand) ||
      deck.before_count !== deck.after_count ||
      Object.values(publicPiles).some(
        (pile) => JSON.stringify(pile.before) !== JSON.stringify(pile.after),
      )
    )
      cards[faction] = { hand, deck, ...publicPiles };
  }
  const activations = valueChanges(before, after, ["activations"]);
  const resources = valueChanges(before, after, [
    "vp",
    "rp",
    "war_status",
    "commitment",
    "fronts",
    "front_storage",
    "entry_tracks",
  ]);
  const publicNaval = (state) => ({
    track: state.naval?.track,
    points: state.naval?.points,
    resolving: Boolean(state.naval?.resolving),
  });
  if (JSON.stringify(publicNaval(before)) !== JSON.stringify(publicNaval(after)))
    resources.push({ key: "naval", before: publicNaval(before), after: publicNaval(after) });
  const beforeOps = before.ops
    ? { total: before.ops.total, remaining: before.ops.remaining, italian_bonus: before.ops.italian_bonus }
    : null;
  const afterOps = after.ops
    ? { total: after.ops.total, remaining: after.ops.remaining, italian_bonus: after.ops.italian_bonus }
    : null;
  if (JSON.stringify(beforeOps) !== JSON.stringify(afterOps))
    resources.push({ key: "ops", before: beforeOps, after: afterOps });
  const board = valueChanges(before, after, [
    "control",
    "trenches",
    "fortifications",
    "besieged",
    "destroyed_forts",
    "markers",
    "events",
  ]);
  const flow = valueChanges(before, after, [
    "state",
    "phase",
    "active",
    "turn",
    "action_round",
  ]);
  const beforeSr = before.sr
    ? { remaining: before.sr.remaining, used_count: before.sr.used_units?.length || 0 }
    : null;
  const afterSr = after.sr
    ? { remaining: after.sr.remaining, used_count: after.sr.used_units?.length || 0 }
    : null;
  if (JSON.stringify(beforeSr) !== JSON.stringify(afterSr))
    flow.push({ key: "sr", before: beforeSr, after: afterSr });
  const beforeEvent = before.pending_event?.kind || null;
  const afterEvent = after.pending_event?.kind || null;
  if (beforeEvent !== afterEvent)
    flow.push({ key: "pending_event", before: beforeEvent, after: afterEvent });
  return { units, activations, resources, board, cards, flow, pools: POOLS };
}

module.exports = { factionForRole, semanticDiff };
