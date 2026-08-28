"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")

const AP_ROLE = "Allied Powers"

function apUnit(state, type = null) {
	return state.units.find(
		(unit) => unit.faction === "ap" && (!type || unit.type === type)
	)
}

test("an isolated friendly fort grants fort-limited supply and prevents automatic attrition", () => {
	const state = rules.setup(1301)
	const unit = apUnit(state, "army")
	state.units = [unit]
	unit.location = "verdun"
	state.control = Object.fromEntries(data.spaces.map((space) => [space.id, "cp"]))
	state.control.verdun = "ap"
	state.destroyed_forts = []

	rules._test.updateSupply(state)
	assert.equal(unit.supplied, false)
	assert.equal(unit.limited_supply, undefined)
	assert.equal(unit.fort_limited_supply, true)

	rules._test.resolveAttrition(state)
	assert.equal(state.units.includes(unit), true)
	assert.equal(state.eliminated.ap.some((candidate) => candidate.id === unit.id), false)
})

test("a unit leaving an isolated fort stops after one space unless it regains supply", () => {
	const state = rules.setup(1302)
	const unit = apUnit(state, "army")
	state.units = [unit]
	unit.location = "verdun"
	state.control = Object.fromEntries(data.spaces.map((space) => [space.id, "cp"]))
	state.control.verdun = "ap"
	state.destroyed_forts = []
	rules._test.updateSupply(state)

	const paths = Object.values(rules._test.movementPaths(state, unit))
	assert.ok(paths.length > 0)
	assert.ok(paths.every((path) => path.length === 1))
})

test("ordinary out-of-supply units do not acquire a generic limited-supply flag", () => {
	const state = rules.setup(1303)
	const unit = apUnit(state, "army")
	state.units = [unit]
	unit.location = "paris"
	unit.supplied = false
	delete unit.limited_supply
	unit.fort_limited_supply = false
	state.control = Object.fromEntries(data.spaces.map((space) => [space.id, "ap"]))

	const paths = Object.values(rules._test.movementPaths(state, unit))
	assert.ok(paths.some((path) => path.length > 1))
})

test("activating a fort-limited-supply stack costs one additional OP", () => {
	const state = rules.setup(1304)
	const unit = apUnit(state, "army")
	state.units = [unit]
	unit.location = "paris"
	unit.fort_limited_supply = true
	state.active = "ap"
	state.ops = { remaining: 3 }

	assert.equal(rules._test.activationCost(state, "paris", "move"), 2)
})

test("a fort-limited-supply unit cannot gain an attack after an early-turn move", () => {
	const state = rules.setup(1305)
	const unit = apUnit(state, "army")
	state.units = [unit]
	unit.location = "paris"
	unit.supplied = false
	delete unit.limited_supply
	unit.fort_limited_supply = true
	state.turn = 2
	state.active = "ap"
	state.state = "ops_move"
	state.control = Object.fromEntries(data.spaces.map((space) => [space.id, "ap"]))
	state.activations = { paris: "move" }
	state.ops = {
		remaining: 0,
		activated: ["paris"],
		moving: null,
		forced_attacks: [],
		pending_siege: null,
		preactivation_sr_used: [],
		preactivation_sr_units: [],
		entrench_attempted: [],
		activated_units: { paris: [unit.id] },
		execution_origin: "paris",
		execution_phase: "move",
		unresolved_stacks: ["paris"]
	}
	const destination = rules._test.movementDestinations(state, unit)[0]

	rules.action(state, AP_ROLE, "select_move_unit", unit.id)
	rules.action(state, AP_ROLE, "move", destination)
	if (state.state === "movement") rules.action(state, AP_ROLE, "stop")

	assert.equal(unit.moved, true)
	assert.equal(unit.attack_eligible, false)
})

test("a fort-limited-supply attacker suffers the printed one-column shift", () => {
	const state = rules.setup(1306)
	const attacker = apUnit(state, "army")
	const defender = state.units.find((unit) => unit.faction === "cp" && unit.type === "army")
	state.units = [attacker, defender]
	state.active = "ap"
	state.mo.current.fr = []
	state.mo.completed.fr = []
	attacker.location = "bar_le_duc"
	attacker.fort_limited_supply = true
	defender.location = "vitry"

	rules._test.resolveCombat(state, {
		attackers: [attacker.id],
		target: "vitry",
		flank: false
	})

	const otherShifts = state.combat_modifiers.modifier_sources
		.filter((source) => source.kind === "column" && source.label !== "要塞有限补给")
		.reduce((total, source) => total + source.amount, 0)
	assert.equal(state.combat_modifiers.attack_column - otherShifts, -1)
})

test("fort-limited-supply units cannot receive replacement steps or veteran upgrades", () => {
	const state = rules.setup(1307)
	const unit = apUnit(state, "army")
	state.units = [unit]
	state.eliminated = { ap: [], cp: [] }
	unit.reduced = true
	unit.fort_limited_supply = true
	state.active = "ap"
	state.state = "replacement"
	state.rp.ap.fr = 5

	const spend = rules.view(state, AP_ROLE).actions.spend
	assert.equal(spend?.flip?.includes(unit.id) || false, false)
	assert.equal(spend?.upgrade?.includes(unit.id) || false, false)
})
