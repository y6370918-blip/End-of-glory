"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")

const AP_ROLE = "Allied Powers"

function apUnits(state, type, count) {
	return state.units.filter((unit) => unit.faction === "ap" && unit.type === type).slice(0, count)
}

function cpUnits(state, type, count) {
	return state.units.filter((unit) => unit.faction === "cp" && unit.type === type).slice(0, count)
}

function movementState(seed, units) {
	const state = rules.setup(seed)
	state.turn = 4
	state.active = "ap"
	state.state = "ops_move"
	state.units = units
	state.control.saint_mihiel = "ap"
	state.control.metz = "cp"
	state.destroyed_forts = []
	state.besieged = []
	state.activations = { saint_mihiel: "move" }
	state.ops = {
		card: null,
		total: 1,
		remaining: 0,
		activated: ["saint_mihiel"],
		moving: null,
		forced_attacks: [],
		preactivation_sr_used: [],
		preactivation_sr_units: [],
		entrench_attempted: [],
		pending_siege: null,
		execution_phase: "move",
		activated_units: { saint_mihiel: units.map((unit) => unit.id) }
	}
	for (const unit of units) {
		unit.location = "saint_mihiel"
		unit.moved = false
		unit.attacked = false
	}
	return state
}

function moveToMetz(state, units) {
	rules.action(state, AP_ROLE, "select_move_unit", units[0].id)
	for (const unit of units.slice(1))
		rules.action(state, AP_ROLE, "select_move_unit", unit.id)
	rules.action(state, AP_ROLE, "move", "metz")
	assert.equal(state.state, "ops_move")
}

test("all printed map forts have numeric loss factors", () => {
	const expected = {
		liege: 3,
		verdun: 3,
		nancy: 3,
		metz: 3,
		strasbourg: 3,
		lille: 2,
		namur: 2,
		maubeuge: 1,
		laon: 1,
		toul: 2,
		chaumont: 1,
		neufchateau: 2,
		dijon: 1,
		caporetto: 2,
		gorizia: 2,
		treviso: 2
	}
	for (const [id, lossFactor] of Object.entries(expected))
		assert.equal(data.spaces.find((space) => space.id === id)?.fort, lossFactor, id)
})

test("an army may enter and immediately besiege an enemy fort", () => {
	const source = rules.setup(1101)
	const [army] = apUnits(source, "army", 1)
	const state = movementState(1101, [army])

	moveToMetz(state, [army])

	assert.equal(army.location, "metz")
	assert.deepEqual(state.besieged, ["metz"])
	assert.equal(state.control.metz, "cp")
	assert.equal(state.ops.pending_siege, null)
})

test("an LF3 fort requires three corps to enter as one siege force", () => {
	const source = rules.setup(1102)
	const corps = apUnits(source, "corps", 3)
	assert.equal(corps.length, 3)
	const state = movementState(1102, corps)

	moveToMetz(state, corps)

	assert.equal(state.ops.pending_siege, null)
	assert.deepEqual(state.besieged, ["metz"])
	assert.equal(rules.view(state, AP_ROLE).actions.finish, 1)
})

test("one corps cannot enter an unbesieged LF3 fort", () => {
	const source = rules.setup(1103)
	const [corps] = apUnits(source, "corps", 1)
	const state = movementState(1103, [corps])

	assert.equal(rules._test.movementDestinations(state, corps).includes("metz"), false)
})

test("one selected corps cannot borrow unselected corps to enter an LF3 fort", () => {
	const source = rules.setup(1113)
	const corps = apUnits(source, "corps", 3)
	const state = movementState(1113, corps)

	rules.action(state, AP_ROLE, "select_move_unit", corps[0].id)
	assert.equal(rules.view(state, AP_ROLE).actions.move.includes("metz"), false)
	assert.deepEqual(corps.map((unit) => unit.location), [
		"saint_mihiel", "saint_mihiel", "saint_mihiel",
	])
})

test("a besieger cannot leave if doing so breaks the siege minimum", () => {
	const source = rules.setup(1104)
	const [army] = apUnits(source, "army", 1)
	const state = movementState(1104, [army])
	moveToMetz(state, [army])
	state.activations = { metz: "move" }

	assert.deepEqual(rules._test.movementDestinations(state, army), [])
})

test("combat losses below the siege minimum lift the siege without trapping the action", () => {
	const state = rules.setup(1105)
	const corps = apUnits(state, "corps", 3)
	state.units = corps
	state.active = "ap"
	state.state = "ops_activate"
	state.destroyed_forts = []
	state.control.metz = "cp"
	state.besieged = []
	state.activations = {}
	state.ops = {
		remaining: 0,
		activated: [],
		forced_attacks: [],
		pending_siege: null,
		preactivation_sr_used: [],
		preactivation_sr_units: [],
		entrench_attempted: []
	}
	for (const unit of corps) unit.location = "metz"
	assert.equal(rules._test.refreshBesiegedSpace(state, "metz"), true)

	state.units.splice(state.units.indexOf(corps[0]), 1)
	assert.equal(rules._test.refreshBesiegedSpace(state, "metz"), false)
	assert.equal(rules.view(state, AP_ROLE).actions.finish, 1)
})

test("an intact fort adds its CF and makes a defending corps fire on the army table", () => {
	const state = rules.setup(1106)
	const [attacker] = apUnits(state, "army", 1)
	const [defender] = cpUnits(state, "corps", 1)
	state.units = [attacker, defender]
	state.active = "ap"
	state.destroyed_forts = []
	attacker.location = "saint_mihiel"
	defender.location = "metz"

	const defenderCombat = data.pieces.find((piece) => piece.id === defender.piece).combat
	rules._test.resolveCombat(state, { attackers: [attacker.id], target: "metz", flank: false })

	assert.equal(state.combat.defense_table, "army")
	assert.equal(state.combat.defense_strength, defenderCombat + 3)
	assert.equal(state.combat.fort.loss_factor, 3)
})

test("a fort absorbs only residual losses after all defending units are gone", () => {
	const state = rules.setup(1107)
	state.units = []
	state.destroyed_forts = []
	state.fortifications = {}
	state.control.metz = "cp"

	const insufficient = {
		target: "metz",
		defenders: [],
		remaining_loss: 2,
		fort: { space: "metz", strength: 3, loss_factor: 3 }
	}
	rules._test.resolveFortCombatLoss(state, insufficient)
	assert.equal(state.destroyed_forts.includes("metz"), false)

	const enough = {
		target: "metz",
		defenders: [],
		remaining_loss: 3,
		fort: { space: "metz", strength: 3, loss_factor: 3 }
	}
	rules._test.resolveFortCombatLoss(state, enough)
	assert.equal(state.destroyed_forts.includes("metz"), true)
	assert.equal(enough.remaining_loss, 0)
	assert.equal(state.fortifications.metz, 1)
})

test("siege rolls never apply the removed T2 -2 DRM", () => {
	function siegeAt(turn) {
		const state = rules.setup(1108 + turn)
		const [army] = apUnits(state, "army", 1)
		state.units = [army]
		army.location = "metz"
		state.turn = turn
		state.seed = 1
		state.control.metz = "cp"
		state.destroyed_forts = []
		state.besieged = []
		rules._test.refreshBesiegedSpace(state, "metz")
		rules._test.resolveSieges(state)
		return state
	}

	const turnOne = siegeAt(1)
	const turnTwo = siegeAt(2)
	assert.equal(turnOne.destroyed_forts.includes("metz"), true)
	assert.equal(turnTwo.destroyed_forts.includes("metz"), true)
	assert.match(turnOne.log.find((entry) => entry.includes("siege")), /4 = 4/)
	assert.match(turnTwo.log.find((entry) => entry.includes("siege")), /4 = 4/)
})
