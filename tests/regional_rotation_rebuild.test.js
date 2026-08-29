"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")

test("601 rebuilds a French LCU for one FR RP at a chosen French supply source", () => {
	const state = setupGame(60101)
	state.active = "ap"
	state.state = "action_card"
	state.turn = 1
	state.action_round = 1
	state.hands.ap = [601]

	const army = state.units.find(
		(unit) => unit.faction === "ap" && unit.nation === "fr" && unit.type === "army",
	)
	assert.ok(army)
	state.units.splice(state.units.indexOf(army), 1)
	delete army.location
	army.reduced = true
	state.eliminated.ap.push(army)

	rules.action(state, "Allied Powers", "card_event", 601)
	assert.equal(state.pending_event.kind, "immediate_rp")
	assert.equal(state.rp.ap.fr, 2)
	assert.ok(rules.view(state, "Allied Powers").actions.spend_rebuild.includes(army.id))

	rules.action(state, "Allied Powers", "spend_rebuild", army.id)
	assert.equal(state.pending_event.kind, "replacement_rebuild")
	assert.deepEqual(
		[...rules.view(state, "Allied Powers").actions.event_space].sort(),
		["chaumont", "orleans", "paris"],
	)
	assert.equal(state.eliminated.ap.some((unit) => unit.id === army.id), true)

	rules.action(state, "Allied Powers", "event_space", "orleans")
	assert.equal(army.location, "orleans")
	assert.equal(army.reduced, true)
	assert.equal(state.rp.ap.fr, 1)
	assert.equal(state.pending_event.kind, "immediate_rp")
	assert.equal(state.pending_event.remaining.fr, 1)
})
