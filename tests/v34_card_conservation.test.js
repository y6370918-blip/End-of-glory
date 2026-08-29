"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const rules = require("../rules.js");
const data = require("../data.js");
const { setupGame } = require("./setup_game.js");

const saveReload = (value) => JSON.parse(JSON.stringify(value));

function removeCard(state, id) {
  for (const faction of ["ap", "cp"])
    for (const pool of [state.decks[faction], state.hands[faction], state.discard[faction],
      state.removed[faction], state.retained_combat_cards[faction]])
      for (let index = pool.length - 1; index >= 0; index -= 1)
        if (pool[index] === id) pool.splice(index, 1);
}

test("v34 every printed card occupies exactly one ownership zone", () => {
  const state = rules.setup(3401);
  assert.equal(rules._test.assertCardConservation(state), true);
  const inventory = rules._test.cardZoneInventory(state);
  assert.equal(Object.keys(inventory).length, 118);
  assert.equal(Object.values(inventory).every((zones) => zones.length === 1), true);
});

test("v34 migration removes proven starred Events from recyclable zones", () => {
  const state = rules.setup(3402);
  removeCard(state, 604);
  state.decks.ap.push(604);
  state.event_history.push({ card: 604, event: "ap_英国增援_基钦纳志愿军", turn: 2 });
  state.version = 33;
  rules.view(state, "Allied Powers");
  assert.equal(state.version, 46);
  assert.equal(state.removed.ap.includes(604), true);
  assert.equal(state.decks.ap.includes(604), false);
  assert.equal(rules._test.assertCardConservation(state), true);
});

test("v34 migration removes already-used starred combat cards from retention", () => {
  const state = rules.setup(3403);
  removeCard(state, 610);
  state.retained_combat_cards.ap.push(610);
  state.version = 33;
  rules.view(state, "Allied Powers");
  assert.equal(state.retained_combat_cards.ap.includes(610), false);
  assert.equal(state.removed.ap.includes(610), true);
  assert.equal(rules._test.assertCardConservation(state), true);
});

test("private combat commitments are owned once without leaking into public piles", () => {
  const state = rules.setup(3404);
  removeCard(state, 610);
  state.state = "combat_card_window";
  state.active = "cp";
  state.combat_window = {
    attacker: "ap",
    defender: "cp",
    side: "cp",
    cards: [610],
    card_sources: { 610: "hand" },
    card_owners: { 610: "ap" },
    declaration: { attackers: [], target: "metz" },
  };
  const inventory = rules._test.cardZoneInventory(state);
  assert.deepEqual(inventory[610].map((entry) => entry.zone), ["combat_commitment.ap"]);
  const view = rules.view(state, "Central Powers");
  assert.equal(view.discard.ap.includes(610), false);
  assert.equal(view.removed.ap.includes(610), false);
  assert.equal(view.combat_cards.hidden_counts.ap, 1);
});

test("card conservation reports duplicate and missing cards with their zones", () => {
  const state = rules.setup(3405);
  const id = state.decks.ap[0];
  state.hands.ap.push(id);
  assert.throws(() => rules._test.assertCardConservation(state),
    new RegExp(`${id}: expected one zone, found 2`));
});

test("non-card pending states do not invent card zero", () => {
  const state = rules.setup(34009);
  state.pending_event = { kind: "replacement_rebuild", card: null, faction: "ap" };
  assert.equal(rules._test.cardZoneInventory(state)[0], undefined);
  assert.equal(rules._test.assertCardConservation(state), true);
});

test("a delayed OHL combat-card return is a physical ownership zone", () => {
  const state = setupGame(3406);
  const card = state.hands.cp.find((id) => data.cards.find((entry) => entry.id === id)?.combat_card);
  assert.ok(card);
  state.hands.cp.splice(state.hands.cp.indexOf(card), 1);
  state.scheduled_events.push({ kind: "card_return", faction: "cp", card, due_turn: 2, source_card: 713 });
  assert.equal(rules._test.assertCardConservation(state), true);
  assert.equal(rules._test.cardZoneInventory(state)[card][0].zone, "scheduled_return.cp.2");
});

test("version 29-33 private combat commitments migrate without exposing or duplicating cards", () => {
  const base = rules.setup(3407);
  removeCard(base, 610);
  base.state = "combat_card_window";
  base.active = "cp";
  base.combat_window = {
    attacker: "ap",
    defender: "cp",
    side: "cp",
    cards: [610],
    card_sources: { 610: "hand" },
    card_owners: { 610: "ap" },
    declaration: { attackers: [], target: "metz" },
  };
  for (const version of [29, 30, 31, 32, 33]) {
    const state = saveReload(base);
    state.version = version;
    const view = rules.view(state, "Central Powers");
    assert.equal(state.version, 46);
    assert.equal(view.combat_cards.hidden_counts.ap, 1);
    assert.equal(rules._test.assertCardConservation(state), true);
  }
});

test("version 29-33 naval disposition saves preserve both pending Fleet cards", () => {
  const base = setupGame(3408);
  rules.action(base, "Central Powers", "confirm_mo");
  rules.action(base, "Allied Powers", "confirm_mo");
  const cpCard = rules.view(base, "Central Powers").actions.naval_fleet[0];
  rules.action(base, "Central Powers", "naval_fleet", cpCard);
  const apCard = rules.view(base, "Allied Powers").actions.naval_fleet[0];
  rules.action(base, "Allied Powers", "naval_fleet", apCard);
  assert.equal(base.state, "naval_disposition");
  for (const version of [29, 30, 31, 32, 33]) {
    const state = saveReload(base);
    state.version = version;
    rules.view(state, "Central Powers");
    assert.equal(state.version, 46);
    assert.equal(state.naval.pending_fleet_cards.cp, cpCard);
    assert.equal(state.naval.pending_fleet_cards.ap, apCard);
    assert.equal(rules._test.assertCardConservation(state), true);
  }
});

test("version 29-33 in-flight reinforcement Events remain owned during migration", () => {
  const base = setupGame(3409);
  removeCard(base, 604);
  base.hands.ap.push(604);
  base.active = "ap";
  base.state = "action_card";
  rules.action(base, "Allied Powers", "card_event", 604);
  assert.equal(base.pending_event?.card, 604);
  for (const version of [29, 30, 31, 32, 33]) {
    const state = saveReload(base);
    state.version = version;
    rules.view(state, "Allied Powers");
    assert.equal(state.version, 46);
    assert.equal(state.pending_event?.card, 604);
    assert.equal(rules._test.cardZoneInventory(state)[604].length, 1);
    assert.equal(rules._test.assertCardConservation(state), true);
  }
});

test("an in-flight CP Event keeps CP card ownership while AP makes a response", () => {
  const state = setupGame(3410);
  removeCard(state, 701);
  state.pending_event = {
    card: 701,
    kind: "august_belgian_relocation",
    owner: "ap",
    chooser: "ap",
  };
  state.active = "ap";

  rules.view(state, "Allied Powers");

  assert.equal(state.pending_event.owner, "cp");
  assert.equal(state.pending_event.chooser, "ap");
  assert.equal(rules._test.cardZoneInventory(state)[701][0].zone, "event_in_flight.cp");
  assert.equal(rules._test.assertCardConservation(state), true);
});
