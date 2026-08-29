"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")

test("MO penalties no longer expose the removed forward-unit option", () => {
	const state = setupGame(3410)
	assert.equal(rules._test.moPenaltyForwardOptions, undefined)
	const actions = rules.view(state, state.active === "cp" ? "Central Powers" : "Allied Powers").actions
	assert.equal((actions.event_choose || []).includes("forward"), false)
})
