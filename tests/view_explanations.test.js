"use strict"

/* global structuredClone */

const test = require("node:test")
const assert = require("node:assert/strict")
const ViewExplanations = require("../modules/analysis/view-explanations.js")

test("three public supply states have unambiguous precedence", () => {
	assert.equal(ViewExplanations.supplyStatus({ supplied: true }), "full")
	assert.equal(ViewExplanations.supplyStatus({ supplied: false, limited_supply: true }), "none")
	assert.equal(ViewExplanations.supplyStatus({ supplied: false, fort_limited_supply: true }), "fort_limited")
	assert.equal(ViewExplanations.supplyStatus({ supplied: false }), "none")
})

test("supply explanations list the concrete rule consequences", () => {
	assert.deepEqual(
		ViewExplanations.supplyEffects({ supplied: false, fort_limited_supply: true }).map((entry) => entry.code),
		["activation_cost", "attack_column", "movement_stop", "replacement"]
	)
	assert.deepEqual(
		ViewExplanations.supplyEffects({ supplied: false }).map((entry) => entry.code),
		["activation", "replacement", "replacement_points"]
	)
})

test("domain rule explanations override heuristics and never conflict with legal actions", () => {
	const state = {
		state: "movement",
		active: "ap",
		units: [{ id: "u1", faction: "ap", location: "origin" }],
		ops: { movement: { active_units: ["u1"] } }
	}
	const hints = ViewExplanations.actionHints(state, "ap", { move: ["legal"] }, {
		candidateSpaces: () => ["legal", "blocked"],
		explainSpaceAction: (_state, action, destination) =>
			destination === "blocked"
				? { action, code: "overstack", label: "精确堆叠检查失败" }
				: null,
		explainPieceAction: () => null,
		landNeighbors: () => [],
		other: () => "cp",
		spaceCanActivate: () => true,
		unitsAt: () => []
	})
	assert.equal(hints.spaces.legal, undefined)
	assert.equal(hints.spaces.blocked[0].code, "overstack")
	assert.equal(hints.spaces.blocked[0].label, "精确堆叠检查失败")
})

test("rollback preview groups checkpoints and limits public log details", () => {
	const state = {
		log: Array.from({ length: 30 }, (_, index) => `line ${index}`),
		rollback: [{ turn: 2, round: 3, kind: "move", label: "Move", log_cursor: 2, state: { log: ["old"] } }]
	}
	const [entry] = ViewExplanations.rollbackEntries(state)
	assert.equal(entry.group, "T2:AR3")
	assert.equal(entry.removed_logs.length, 20)
	assert.equal(entry.omitted_logs, 8)
})

test("rollback semantic changes expose board changes but redact opponent card identities and private selections", () => {
	const before = {
		log: [],
		units: [{ id: "u1", piece: "p1", faction: "ap", location: "paris" }],
		reserves: { ap: [], cp: [] }, upgrade_pool: { ap: [], cp: [] }, eliminated: { ap: [], cp: [] }, permanently_removed_units: { ap: [], cp: [] },
		hands: { ap: [600], cp: [700] }, decks: { ap: [601], cp: [701] },
		control: { paris: "ap" }, activations: {}, rp: { ap: {}, cp: {} }, war_status: {}, fronts: {}, front_storage: {}, entry_tracks: {},
		rollback: []
	}
	const after = structuredClone(before)
	after.log = ["moved"]
	after.units[0].location = "meaux"
	after.hands.cp = [702]
	after.ops = { total: 3, remaining: 2, pending_attack: { mo_assignments: { ge: "secret-mo" } } }
	after.pending_event = { kind: "secret", selected_units: ["hidden-unit"] }
	after.rollback = [{ turn: 1, round: 1, kind: "move", label: "Move", log_cursor: 0, state: before }]
	const [entry] = ViewExplanations.rollbackEntries(after, "Allied Powers")
	assert.equal(entry.changes.units[0].after.location, "meaux")
	assert.deepEqual(entry.changes.cards.cp.hand, { before_count: 1, after_count: 1 })
	assert.equal(JSON.stringify(entry.changes).includes("secret-mo"), false)
	assert.equal(JSON.stringify(entry.changes).includes("hidden-unit"), false)
})
