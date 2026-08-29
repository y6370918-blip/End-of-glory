"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")

test("historical setup is deterministic and separates map, reserve, and upgrade pools", () => {
	const first = setupGame(12345)
	const second = setupGame(12345)
	assert.deepEqual(first, second)
	assert.equal(first.scenario, "1914 Historical")
	assert.ok(first.units.length > 80)
	assert.ok(first.reserves.ap.length > 0)
	assert.ok(first.reserves.cp.length > 0)
	assert.ok(first.upgrade_pool.ap.length > 0)
	assert.ok(first.upgrade_pool.cp.length > 0)
	assert.ok(first.units.every((unit) => unit.location))
	assert.equal(first.units.some((unit) => "tts_guid" in unit), false)
	const germanCavalry = data.pieces.find((piece) => piece.id === "component-035")
	assert.equal(germanCavalry.name, "德国骑兵scu")
	assert.equal(germanCavalry.type, "corps")
	const prussianCavalry = data.pieces.find((piece) => piece.id === "component-043")
	assert.equal(prussianCavalry.name, "普鲁士骑兵scu")
	assert.equal(prussianCavalry.type, "corps")
})

test("turn one MO follows the EOG national draw counts", () => {
	const state = setupGame(9)
	const bagIds = (nation) => rules._test.moBagDefinitions(state, nation)
		.map((definition) => definition.id)
		.sort()
	assert.deepEqual(bagIds("fr"), ["fr-9", "fr-10", "fr-11"].sort())
	assert.deepEqual(bagIds("br"), ["br-1", "br-2", "br-3"].sort())
	assert.deepEqual(bagIds("it"), ["it-1", "it-2"].sort())
	assert.deepEqual(bagIds("us"), [])
	assert.deepEqual(bagIds("ge"), ["ge-1", "ge-2", "ge-3"].sort())
	assert.deepEqual(bagIds("ah"), ["ah-2"])
	assert.equal(state.mo.current.fr.length, 2)
	assert.equal(state.mo.current.ge.length, 2)
	assert.ok(state.mo.current.ge.every((id) => ["ge-1", "ge-2", "ge-3"].includes(id)))
	assert.equal(state.mo.current.ge.includes("ge-6"), false)
	assert.equal(state.mo.current.ge.includes("ge-7"), false)
	assert.equal(state.mo.current.ah.length, 0)
	assert.equal(state.mo.current.it.length, 0)
	assert.equal(state.mo.current.br.length, 0)
	assert.equal(state.mo.current.us.length, 0)
})

test("version twelve saves discard printed MO that entered before its event", () => {
	const state = setupGame(10)
	state.version = 12
	state.mo.current.ge = ["ge-6"]
	state.mo.progress.ge = { "ge-6": 0 }
	state.mo.drm_used.ge = { "ge-6": 0 }
	state.mo.targets.ge = { "ge-6": [] }
	state.mo.drawn.ge = ["ge-6"]
	rules.view(state, "Central Powers")
	assert.equal(state.version, 46)
	assert.deepEqual(state.mo.current.ge, [])
	assert.equal(state.mo.progress.ge["ge-6"], undefined)
	assert.equal(state.mo.drawn.ge.includes("ge-6"), false)
})

test("opponent hand is never exposed by view", () => {
	const state = setupGame(77)
	const ap = rules.view(state, "Allied Powers")
	const cp = rules.view(state, "Central Powers")
	const spectator = rules.view(state, "Observer")
	assert.ok(Array.isArray(ap.hands.ap))
	assert.equal(ap.hands.cp, 9)
	assert.ok(Array.isArray(cp.hands.cp))
	assert.equal(cp.hands.ap, 9)
	assert.equal(spectator.hands.ap, 9)
	assert.equal(spectator.hands.cp, 9)
})

test("private event candidates are visible only to their chooser", () => {
	const state = setupGame(78)
	state.state = "event"
	state.active = "ap"
	state.pending_event = {
		card: 626,
		faction: "ap",
		owner: "ap",
		chooser: "ap",
		kind: "card_search",
		cards: [603, 604]
	}
	const allied = rules.view(state, "Allied Powers").pending_event
	const central = rules.view(state, "Central Powers").pending_event
	const observer = rules.view(state, "Observer").pending_event
	assert.deepEqual(allied.cards, [603, 604])
	assert.equal(central.cards, undefined)
	assert.equal(observer.cards, undefined)
	assert.equal(central.card_count, 2)
	assert.equal(observer.card_count, 2)

	state.active = "cp"
	state.pending_event = {
		card: 713,
		faction: "cp",
		owner: "cp",
		chooser: "cp",
		kind: "ohl",
		stage: "discard",
		cards: state.hands.cp.slice()
	}
	assert.ok(Array.isArray(rules.view(state, "Central Powers").pending_event.cards))
	assert.equal(rules.view(state, "Allied Powers").pending_event.cards, undefined)
})

test("inactive role and unknown action cannot mutate state", () => {
	const state = setupGame(2)
	const before = JSON.stringify(state)
	rules.action(state, "Allied Powers", "done")
	assert.equal(JSON.stringify(state), before)
	rules.action(state, "Allied Powers", "rollback", 0)
	assert.equal(JSON.stringify(state), before)
	rules.action(state, "Central Powers", "not_an_action", 1)
	assert.equal(JSON.stringify(state), before)
})
