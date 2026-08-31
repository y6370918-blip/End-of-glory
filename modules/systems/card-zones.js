"use strict";

const COMMITMENT_RANK = Object.freeze({ mobilization: 0, limited: 1, total: 2 });

function createCardZoneSystem(api) {
  const { AP = "ap", CP = "cp" } = api;

  function optionalCardId(value) {
    if (value == null || value === "") return null;
    const id = Number(value);
    return Number.isInteger(id) ? id : null;
  }

  function removeAll(pool, id) {
    if (!Array.isArray(pool)) return 0;
    let count = 0;
    for (let index = pool.length - 1; index >= 0; index -= 1)
      if (pool[index] === id) {
        pool.splice(index, 1);
        count += 1;
      }
    return count;
  }

  function concreteContainers(state) {
    const containers = [];
    for (const faction of [AP, CP]) {
      containers.push(
        [`deck.${faction}`, faction, state.decks?.[faction]],
        [`hand.${faction}`, faction, state.hands?.[faction]],
        [`discard.${faction}`, faction, state.discard?.[faction]],
        [`removed.${faction}`, faction, state.removed?.[faction]],
        [`retained.${faction}`, faction, state.retained_combat_cards?.[faction]],
      );
    }
    for (const faction of [AP, CP]) {
      const id = state.naval?.pending_fleet_cards?.[faction];
      if (Number.isInteger(id)) containers.push([`naval_fleet.${faction}`, faction, [id]]);
    }
    for (const entry of state.scheduled_events || []) {
      const id = optionalCardId(entry?.card);
      if (entry?.kind === "card_return" && id != null)
        containers.push([
          `scheduled_return.${entry.faction}.${entry.due_turn}`,
          entry.faction,
          [id],
        ]);
    }
    return containers;
  }

  function cardZoneInventory(state) {
    const inventory = Object.fromEntries(api.data.cards.map((card) => [card.id, []]));
    const add = (id, zone, faction, transient = false) => {
      id = Number(id);
      if (!inventory[id]) inventory[id] = [];
      inventory[id].push({ zone, faction, transient });
    };
    for (const [zone, faction, pool] of concreteContainers(state))
      for (const id of pool || []) add(id, zone, faction);

    // Before reveal, combat-window cards have left their source and are owned
    // by the private commitment zone.  Once revealed they live in a public
    // discard/remove pool and the combat window is only a reference.
    if (state.combat_window && !state.combat_window.cards_revealed)
      for (const id of state.combat_window.cards || []) {
        const owner = state.combat_window.card_owners?.[id] ||
          state.card_owners?.[id] || api.cardById[id]?.faction;
        add(id, `combat_commitment.${owner}`, owner, true);
      }

    // An Event card is temporarily absent between cardUse() and finishEvent().
    // Count pending_event only when no concrete container owns that card;
    // post-event choices keep the already-disposed card in its public pool.
    // An Event may temporarily hand control to the opposing player without
    // disposing its source card.  Moltke (614), for example, can remove the
    // combat unit escorting an HQ and must finish that HQ relocation before
    // finishEvent() disposes the card.  The relocation context deliberately
    // has no `card` field because its `owner` is the player moving the HQ;
    // preserve the in-flight Event through its explicit resume card instead.
    const delayedResumeId =
      state.pending_event?.kind === "hq_relocation" &&
      state.pending_event?.resume === "finish_delayed_event"
        ? optionalCardId(state.pending_event.resume_card)
        : null;
    const pendingId = optionalCardId(state.pending_event?.card) ?? delayedResumeId;
    if (pendingId != null && !(inventory[pendingId] || []).length) {
      const owner = delayedResumeId != null
        ? state.card_owners?.[pendingId] || api.cardById[pendingId]?.faction
        : state.pending_event.owner || state.pending_event.faction ||
          state.card_owners?.[pendingId] || api.cardById[pendingId]?.faction;
      add(pendingId, `event_in_flight.${owner}`, owner, true);
    }

    // Cards from later commitment levels are intentionally outside the live
    // deck until that faction reaches the corresponding commitment.
    for (const card of api.data.cards) {
      if (inventory[card.id].length) continue;
      const current = COMMITMENT_RANK[state.commitment?.[card.faction]] ?? 0;
      const printed = COMMITMENT_RANK[card.commitment] ?? 0;
      if (printed > current) add(card.id, `future.${card.faction}`, card.faction, true);
    }
    return inventory;
  }

  function cardConservationErrors(state) {
    const inventory = cardZoneInventory(state);
    const errors = [];
    for (const card of api.data.cards) {
      const zones = inventory[card.id] || [];
      if (zones.length !== 1) {
        errors.push(`${card.id}: expected one zone, found ${zones.length} (${zones.map((entry) => entry.zone).join(", ") || "missing"})`);
        continue;
      }
      const owner = state.card_owners?.[card.id] || card.faction;
      if (zones[0].faction !== owner)
        errors.push(`${card.id}: owner ${owner} conflicts with ${zones[0].zone}`);
      if (card.id !== 729 && zones[0].faction !== card.faction)
        errors.push(`${card.id}: printed ${card.faction} card is in ${zones[0].zone}`);
    }
    for (const id of Object.keys(inventory).map(Number))
      if (!api.cardById[id]) errors.push(`${id}: unknown card in state`);
    return errors;
  }

  function assertCardConservation(state) {
    const errors = cardConservationErrors(state);
    if (errors.length)
      throw new Error(`Card conservation failed: ${errors.join("; ")}`);
    return true;
  }

  function removeFromOwnedZones(state, id) {
    for (const faction of [AP, CP]) {
      removeAll(state.decks?.[faction], id);
      removeAll(state.hands?.[faction], id);
      removeAll(state.discard?.[faction], id);
      removeAll(state.removed?.[faction], id);
      removeAll(state.retained_combat_cards?.[faction], id);
      if (state.naval?.pending_fleet_cards?.[faction] === id)
        delete state.naval.pending_fleet_cards[faction];
    }
    for (const entry of state.scheduled_events || [])
      if (entry?.kind === "card_return" && optionalCardId(entry.card) === id)
        delete entry.card;
  }

  function migrateV34(state) {
    state.retained_combat_cards ||= { ap: [], cp: [] };
    state.card_owners ||= {};

    // Old combat commitments were placed in public discard/remove zones as
    // soon as they were committed.  Restore the private in-flight ownership.
    if (state.combat_window && !state.combat && !state.combat_window.cards_revealed) {
      for (const id of state.combat_window.cards || []) removeFromOwnedZones(state, id);
    }

    // A retained combat card has necessarily already been revealed and used.
    for (const faction of [AP, CP])
      for (const id of [...state.retained_combat_cards[faction]]) {
        const card = api.cardById[id];
        if (!card?.remove || !card.combat_card) continue;
        removeFromOwnedZones(state, id);
        if (!state.removed[faction].includes(id)) state.removed[faction].push(id);
      }

    // Event history proves Event use.  Normalize every recyclable ownership
    // zone, not just the discard pile.  A currently in-flight Event is left to
    // finish normally so its state machine is not replayed or canceled.
    const inFlightEvent = optionalCardId(state.pending_event?.card);
    const provenEvents = new Set((state.event_history || [])
      .map((entry) => optionalCardId(entry?.card))
      .filter((id) => api.cardById[id]?.remove));
    for (const id of provenEvents) {
      if (id === inFlightEvent && !(cardZoneInventory(state)[id] || []).some((entry) => !entry.transient))
        continue;
      const owner = state.card_owners[id] || api.cardById[id].faction;
      removeFromOwnedZones(state, id);
      if (!state.removed[owner].includes(id)) state.removed[owner].push(id);
      if (state.combat_window?.cards?.includes(id)) {
        state.combat_window.cards = state.combat_window.cards.filter((entry) => entry !== id);
        delete state.combat_window.card_sources?.[id];
        delete state.combat_window.card_owners?.[id];
      }
    }

    // Royal Tank Corps no longer has a printed removal mark.
    removeAll(state.removed.ap, 640);
    if (![...state.decks.ap, ...state.hands.ap, ...state.discard.ap,
      ...state.retained_combat_cards.ap].includes(640) &&
      state.pending_event?.card !== 640)
      state.discard.ap.push(640);

    const owner729 = cardZoneInventory(state)[729]?.[0]?.faction;
    if (owner729 === AP || owner729 === CP) state.card_owners[729] = owner729;
  }

  return Object.freeze({
    assertCardConservation,
    cardConservationErrors,
    cardZoneInventory,
    migrateV34,
    removeFromOwnedZones,
  });
}

module.exports = { createCardZoneSystem };
