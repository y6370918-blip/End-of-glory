"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")

test("MO forward penalty requires one unit to remain before selecting a destination", () => {
	const state = setupGame(3410)
	const option = rules._test.moPenaltyForwardOptions(state, "ap")[0]
	assert.ok(option)
	const origin = option.origin
	state.pending_event = {
		kind: "mo_penalty",
		owner: "cp",
		chooser: "cp",
		penalized: "ap",
		nation: "ap",
		mo: "fr-test",
		stage: "forward_leave",
		selected: [],
		origin
	}
	state.state = "event"
	state.active = "cp"
	const actions = rules.view(state, "Central Powers").actions
	assert.equal(actions.event_units_confirm, undefined)
	assert.ok(actions.select_event_unit?.length)
	rules.action(state, "Central Powers", "select_event_unit", actions.select_event_unit[0])
	assert.equal(state.pending_event.stage, "forward_target")
	assert.ok(rules.view(state, "Central Powers").actions.event_space?.length)
})
