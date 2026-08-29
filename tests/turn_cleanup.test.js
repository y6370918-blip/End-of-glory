"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")

test("each side may discard any combat cards before drawing to nine", () => {
	const state = rules.setup(2301)
	const combat = data.cards.find(
		(card) => card.faction === "ap" && card.commitment === "mobilization" && card.combat_card
	)
	assert.ok(combat)
	state.hands.ap = [combat.id]
	state.hands.cp = []
	state.decks.ap = []
	state.decks.cp = []
	state.discard.ap = []
	state.discard.cp = []
	rules._test.beginDrawPhase(state)
	assert.equal(state.state, "draw_discard")
	assert.deepEqual(
		rules.view(state, "Allied Powers").actions.discard_combat_card,
		[combat.id]
	)
	rules.action(state, "Allied Powers", "discard_combat_card", combat.id)
	assert.deepEqual(state.hands.ap, [])
	assert.deepEqual(state.discard.ap, [combat.id])
})

test("voluntary cleanup can destroy isolated-fort units and remove fieldworks", () => {
	const state = rules.setup(2302)
	const unit = state.units.find((candidate) => candidate.faction === "cp" && candidate.type === "army")
	assert.ok(unit)
	state.units = [unit]
	unit.location = "metz"
	unit.reduced = false
	for (const space of data.spaces) state.control[space.id] = "ap"
	state.control.metz = "cp"
	state.fortifications.metz = 2
	state.trenches.metz = 2
	assert.equal(rules._test.beginVoluntaryCleanup(state, "cp", "ap_action"), true)
	let actions = rules.view(state, "Central Powers").actions
	assert.ok(actions.voluntary_destroy_unit.includes(unit.id))
	assert.ok(actions.voluntary_remove_fortification.includes("metz"))
	assert.ok(actions.voluntary_reduce_trench.includes("metz"))

	rules.action(state, "Central Powers", "voluntary_reduce_trench", "metz")
	assert.equal(state.trenches.metz, 1)
	rules.action(state, "Central Powers", "voluntary_remove_fortification", "metz")
	assert.equal(state.fortifications.metz, undefined)
	actions = rules.view(state, "Central Powers").actions
	assert.ok(actions.voluntary_destroy_unit.includes(unit.id))
	rules.action(state, "Central Powers", "voluntary_destroy_unit", unit.id)
	assert.equal(state.units.length, 0)
	assert.ok(state.eliminated.cp.some((candidate) => candidate.id === unit.id))
})
