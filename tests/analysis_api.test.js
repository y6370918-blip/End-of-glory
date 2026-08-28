"use strict"

/* global structuredClone */

const test = require("node:test")
const assert = require("node:assert/strict")
const data = require("../data.js")
const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")

test("analysis API is readonly and validates through authoritative actions", () => {
	const state = setupGame(1717)
	const before = structuredClone(state)
	const role = state.active === "ap" ? "Allied Powers" : "Central Powers"
	const result = rules.analysis.explain_action_v1(state, role, { action: "confirm_mo" })
	assert.equal(result.legal, true)
	assert.deepEqual(state, before)
	const forged = rules.analysis.explain_action_v1(state, role, { action: "move", target: "nowhere" })
	assert.equal(forged.legal, false)
	assert.deepEqual(state, before)
})

test("simulation clones state and reports deterministic state differences", () => {
	const state = setupGame(1718)
	const before = structuredClone(state)
	const role = state.active === "ap" ? "Allied Powers" : "Central Powers"
	const result = rules.analysis.simulate_action_sequence_v1(state, role, [{ action: "confirm_mo" }])
	assert.equal(result.steps[0].legal, true)
	assert.deepEqual(state, before)
	assert.ok(Object.keys(result.changed).length)
})

test("observer analysis does not receive executable or private actions", () => {
	const state = setupGame(1719)
	const result = rules.analysis.public_position_v1(state, "Observer")
	assert.deepEqual(result.position.actions, {})
	assert.deepEqual(result.position.mo.own, [])
})

test("simulation stops before a combat die roll and preserves both state and seed", () => {
	const state = setupGame(1720)
	const edge = data.edges.find((candidate) => candidate.type === "land" && candidate.modes.includes("attack"))
	const apPiece = data.pieces.find((piece) => piece.faction === "ap" && piece.type === "army")
	const cpPiece = data.pieces.find((piece) => piece.faction === "cp" && piece.type === "army")
	state.units = [
		{ id: "analysis-ap", piece: apPiece.id, faction: "ap", nation: apPiece.nation, type: "army", location: edge.a, reduced: false, supplied: true },
		{ id: "analysis-cp", piece: cpPiece.id, faction: "cp", nation: cpPiece.nation, type: "army", location: edge.b, reduced: false, supplied: true }
	]
	state.active = "cp"
	state.state = "combat_card_window"
	state.combat_window = {
		declaration: { attackers: ["analysis-ap"], target: edge.b, flank: false },
		attacker: "ap",
		defender: "cp",
		side: "cp",
		cards: [],
		card_sources: {},
		defense_mo_assignments: {},
		defense_mo_decisions: {}
	}
	const before = structuredClone(state)
	const result = rules.analysis.simulate_action_sequence_v1(state, "Central Powers", [{ action: "pass" }])
	assert.deepEqual(state, before)
	assert.deepEqual(result.steps[0], {
		action: "pass",
		arg: undefined,
		legal: true,
		consumes_randomness: true,
		executed: false,
		stopped_before_randomness: true,
		diff: result.steps[0].diff
	})
	assert.deepEqual(result.changed.units, [])
})

