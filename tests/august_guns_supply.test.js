"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")

test("701 redeployment captures destroyed Liege and immediately traces supply through Aachen", () => {
	const state = setupGame(70101)
	state.active = "cp"
	state.state = "action_card"
	state.turn = 1
	state.action_round = 1
	state.hands.cp = [701]

	rules.action(state, "Central Powers", "card_event", 701)
	assert.ok(rules.view(state, "Central Powers").actions.event_space.includes("liege"))
	rules.action(state, "Central Powers", "event_space", "liege")
	rules.action(state, "Central Powers", "event_confirm")

	while (state.pending_event.kind === "august_belgian_relocation") {
		const destination = rules.view(state, "Allied Powers").actions.event_space[0]
		assert.ok(destination)
		rules.action(state, "Allied Powers", "event_space", destination)
	}

	const candidate = rules.view(state, "Central Powers").actions.select_august_unit
		.find((id) => state.units.find((unit) => unit.id === id)?.location === "aachen")
	assert.ok(candidate)
	rules.action(state, "Central Powers", "select_august_unit", candidate)
	rules.action(state, "Central Powers", "event_space", "liege")

	const unit = state.units.find((entry) => entry.id === candidate)
	assert.equal(unit.location, "liege")
	assert.equal(state.control.liege, "cp")
	assert.equal(unit.supplied, true)
})

test("current saves repair destroyed-fort control and supply without a version bump", () => {
	const state = setupGame(70102)
	const unit = state.units.find(
		(candidate) => candidate.faction === "cp" && candidate.location === "aachen" && candidate.type === "army",
	)
	assert.ok(unit)

	state.control.liege = "ap"
	if (!state.destroyed_forts.includes("liege")) state.destroyed_forts.push("liege")
	state.besieged = state.besieged.filter((space) => space !== "liege")
	state.units = state.units.filter(
		(candidate) => candidate.location !== "liege" || candidate.faction !== "ap",
	)
	unit.location = "liege"
	unit.supplied = false
	unit.fort_limited_supply = false

	rules.view(state, "Central Powers")

	assert.equal(state.version, 46)
	assert.equal(state.control.liege, "cp")
	assert.equal(unit.supplied, true)
})
