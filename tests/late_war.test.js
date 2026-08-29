"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")

const AP_ROLE = "Allied Powers"
const CP_ROLE = "Central Powers"

function stagePosition(turn, commitment, seed = turn * 1009) {
	const state = setupGame(seed)
	state.turn = turn
	state.action_round = 1
	state.phase = "行动阶段"
	state.state = "action_card"
	state.active = "ap"
	state.last_action_purpose = { ap: null, cp: null }
	if (commitment === "limited") {
		state.war_status.ap = Math.max(state.war_status.ap, 6)
		state.war_status.cp = Math.max(state.war_status.cp, 6)
		state.war_status.combined = state.war_status.ap + state.war_status.cp
		rules._test.resolveWarStatus(state)
	}
	if (commitment === "total") {
		state.war_status.ap = Math.max(state.war_status.ap, 13)
		state.war_status.cp = Math.max(state.war_status.cp, 13)
		state.war_status.combined = state.war_status.ap + state.war_status.cp
		rules._test.resolveWarStatus(state)
	}
	rules._test.assertCardConservation(state)
	return state
}

function assertPrimitiveActions(actions) {
	for (const [name, value] of Object.entries(actions)) {
		assert.ok(value === 0 || value === 1 || Array.isArray(value), `${name} has a non-primitive action value`)
		if (Array.isArray(value)) {
			assert.equal(new Set(value).size, value.length, `${name} contains duplicate choices`)
			assert.equal(value.every((entry) => ["string", "number", "boolean"].includes(typeof entry)), true)
		}
	}
}

for (const fixture of [
	{ turn: 5, commitment: "limited", label: "Limited War" },
	{ turn: 9, commitment: "limited", label: "1917 reinforcement boundary" },
	{ turn: 12, commitment: "total", label: "1918 rules" },
	{ turn: 15, commitment: "total", label: "final turn" }
]) {
	test(`T${fixture.turn} ${fixture.label} position survives save/load with legal private views`, () => {
		const first = stagePosition(fixture.turn, fixture.commitment)
		const saved = JSON.stringify(first)
		const state = JSON.parse(saved)
		const ap = rules.view(state, AP_ROLE)
		const cp = rules.view(state, CP_ROLE)
		assert.equal(state.version, 46)
		assert.equal(state.turn, fixture.turn)
		assert.equal(state.commitment.ap, fixture.commitment)
		assert.equal(state.commitment.cp, fixture.commitment)
		assertPrimitiveActions(ap.actions)
		assert.deepEqual(cp.actions, {})
		assert.equal(cp.hand, undefined)
		assert.equal(cp.opponent_hand?.cards, undefined)
		rules._test.assertCardConservation(state)
		assert.deepEqual(state, JSON.parse(JSON.stringify(state)))
	})
}

test("T15 final scoring reaches a terminal state without changing card ownership", () => {
	const state = stagePosition(15, "total", 151515)
	state.phase = "终局"
	rules._test.checkVictory(state)
	assert.equal(state.state, "game_over")
	assert.ok([AP_ROLE, CP_ROLE].includes(state.result))
	rules._test.assertCardConservation(state)
})
