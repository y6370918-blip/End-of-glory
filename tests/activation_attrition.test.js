"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")

const AP_ROLE = "Allied Powers"

function apUnits(state, count) {
	return state.units.filter((unit) => unit.faction === "ap" && unit.nation === "fr").slice(0, count)
}

function beginTestOps(state, units, space, remaining = 6) {
	state.turn = 4
	state.active = "ap"
	state.state = "ops_activate"
	state.units = units
	state.activations = {}
	state.ops = {
		card: null,
		total: remaining,
		remaining,
		italian_bonus: 0,
		combat_effect: null,
		activated: [],
		activated_units: {},
		pending_activation: null,
		moving: null,
		forced_attacks: [],
		preactivation_sr_used: [],
		preactivation_sr_units: [],
		entrench_attempted: [],
		pending_siege: null
	}
	for (const unit of units) {
		unit.location = space
		unit.moved = false
		unit.attacked = false
		unit.limited_supply = false
		unit.fort_limited_supply = false
	}
}

test("large areas activate at most three selected units for one OP and may be activated repeatedly", () => {
	const state = rules.setup(1401)
	const units = apUnits(state, 5)
	assert.equal(units.length, 5)
	beginTestOps(state, units, "le_havre")

	rules.action(state, AP_ROLE, "activate_move", "le_havre")
	assert.equal(state.state, "activation_region")
	let view = rules.view(state, AP_ROLE)
	assert.deepEqual(new Set(view.actions.select_activation_unit), new Set(units.map((unit) => unit.id)))
	for (const unit of units.slice(0, 3))
		rules.action(state, AP_ROLE, "select_activation_unit", unit.id)
	assert.equal(rules.view(state, AP_ROLE).actions.select_activation_unit, undefined)
	rules.action(state, AP_ROLE, "activation_confirm")
	assert.equal(state.state, "ops_activate")
	assert.deepEqual(state.ops.region_activations.move.le_havre[0].units, units.slice(0, 3).map((unit) => unit.id))
	assert.equal(state.ops.remaining, 5)

	view = rules.view(state, AP_ROLE)
	assert.ok(view.actions.activate_move.includes("le_havre"))
	rules.action(state, AP_ROLE, "activate_move", "le_havre")
	assert.deepEqual(
		new Set(rules.view(state, AP_ROLE).actions.select_activation_unit),
		new Set(units.slice(3).map((unit) => unit.id))
	)
	for (const unit of units.slice(3))
		rules.action(state, AP_ROLE, "select_activation_unit", unit.id)
	rules.action(state, AP_ROLE, "activation_confirm")
	assert.equal(state.ops.remaining, 4)
	assert.equal(state.ops.region_activations.move.le_havre.length, 2)
	assert.deepEqual(new Set(state.ops.activated_units.le_havre), new Set(units.map((unit) => unit.id)))
	assert.equal(rules.view(state, AP_ROLE).actions.activate_move?.includes("le_havre") || false, false)

	rules.action(state, AP_ROLE, "finish")
	assert.equal(state.state, "ops_move")
	assert.deepEqual(
		new Set(rules.view(state, AP_ROLE).actions.select_move_unit),
		new Set(units.map((unit) => unit.id))
	)
})

test("large-area activation selection can be cancelled without spending OP", () => {
	const state = rules.setup(1410)
	const units = apUnits(state, 4)
	beginTestOps(state, units, "le_havre", 2)
	rules.action(state, AP_ROLE, "activate_move", "le_havre")
	assert.equal(state.state, "activation_region")
	const selectable = rules.view(state, AP_ROLE).actions.select_activation_unit
	assert.ok(selectable.length > 0)
	rules.action(state, AP_ROLE, "select_activation_unit", selectable[0])
	rules.action(state, AP_ROLE, "activation_cancel")
	assert.equal(state.state, "ops_activate")
	assert.equal(state.ops.remaining, 2)
	assert.equal(state.ops.region_activations.move.le_havre, undefined)
})

test("fort-limited units cannot be omitted from a space activation", () => {
	const state = rules.setup(1402)
	const units = apUnits(state, 2)
	beginTestOps(state, units, "paris", 3)
	const [full, limited] = units
	limited.fort_limited_supply = true

	rules.action(state, AP_ROLE, "activate_move", "paris")
	assert.equal(state.state, "ops_activate")
	assert.equal(state.ops.remaining, 1)
	assert.deepEqual(state.ops.activated_units.paris, [full.id, limited.id])
})

test("selecting a limited-supply unit charges the additional OP", () => {
	const state = rules.setup(1403)
	const units = apUnits(state, 2)
	beginTestOps(state, units, "paris", 3)
	const [full, limited] = units
	limited.fort_limited_supply = true

	rules.action(state, AP_ROLE, "activate_move", "paris")

	assert.equal(state.state, "ops_activate")
	assert.equal(state.ops.remaining, 1)
	assert.deepEqual(state.ops.activated_units.paris, [full.id, limited.id])
})

test("a stack containing only fort-limited units activates as one space", () => {
	const state = rules.setup(1404)
	const units = apUnits(state, 2)
	beginTestOps(state, units, "paris", 3)
	for (const unit of units) unit.fort_limited_supply = true

	rules.action(state, AP_ROLE, "activate_move", "paris")
	assert.equal(state.ops.remaining, 1)
	assert.deepEqual(state.ops.activated_units.paris, units.map((unit) => unit.id))
})

test("large areas ignore the normal three-field-unit stacking ceiling", () => {
	const state = rules.setup(1405)
	const units = apUnits(state, 5)
	for (const unit of units) unit.location = "le_havre"
	state.units = units

	assert.equal(rules._test.stackLegal(state, "le_havre", units[0]), true)
	for (const unit of units) unit.location = "paris"
	assert.equal(rules._test.stackLegal(state, "paris", units[0]), false)
})

test("London is a large area without combat-unit or HQ stacking limits", () => {
	const state = rules.setup(1407)
	const combatUnits = apUnits(state, 5)
	const hqPiece = data.pieces.find((piece) => piece.faction === "ap" && piece.type === "hq")
	assert.ok(hqPiece)
	const headquarters = ["test-london-hq-1", "test-london-hq-2"].map((id) => ({
		id,
		piece: hqPiece.id,
		faction: "ap",
		nation: hqPiece.nation,
		type: "hq",
		location: "london",
		reduced: false
	}))
	for (const unit of combatUnits) unit.location = "london"
	state.units = [...combatUnits, ...headquarters]
	assert.equal(data.spaces.find((space) => space.id === "london").large_area, true)
	assert.equal(rules._test.stackLegal(state, "london", combatUnits[0]), true)
	assert.equal(rules._test.stackLegal(state, "london", headquarters[0]), true)
})

test("each faction suffers attrition immediately after its own final action round", () => {
	const state = rules.setup(1406)
	const cp = state.units.find((unit) => unit.faction === "cp" && unit.type === "army")
	const ap = state.units.find((unit) => unit.faction === "ap" && unit.type === "army")
	state.units = [cp, ap]
	cp.location = "essen"
	ap.location = "paris"
	state.control = Object.fromEntries(data.spaces.map((space) => [space.id, null]))
	state.events = {}
	state.mo.current = {}
	state.mo.completed = {}
	state.hands.cp = []
	state.action_round = data.title.action_rounds
	state.active = "cp"
	state.state = "ops_activate"

	rules._test.nextFactionAction(state)
	assert.equal(state.active, "ap")
	assert.equal(state.units.some((unit) => unit.id === cp.id), false)
	assert.equal(state.units.some((unit) => unit.id === ap.id), true)

	rules._test.nextFactionAction(state)
	assert.equal(state.units.some((unit) => unit.id === ap.id), false)
})

test("British-Belgian and French-American units use the printed equivalent nationalities", () => {
	const state = rules.setup(1407)
	state.active = "ap"
	state.ops = { remaining: 6 }
	state.units = [
		{ id: "fr", faction: "ap", nation: "fr", type: "corps", location: "paris" },
		{ id: "us", faction: "ap", nation: "us", type: "corps", location: "paris" }
	]
	assert.equal(rules._test.activationCost(state, "paris", "move"), 1)

	state.units = [
		{ id: "br", faction: "ap", nation: "br", type: "corps", location: "paris" },
		{ id: "be", faction: "ap", nation: "be", type: "corps", location: "paris" }
	]
	assert.equal(rules._test.activationCost(state, "paris", "move"), 1)

	state.units[1].nation = "fr"
	assert.equal(rules._test.activationCost(state, "paris", "move"), 2)
})

test("combination restores one reduced LCU and eliminates one equivalent-nationality SCU", () => {
	const state = rules.setup(1408)
	const belgianArmyPiece = data.pieces.find(
		(piece) => piece.faction === "ap" && piece.nation === "be" && piece.type === "army"
	)
	const britishCorpsPiece = data.pieces.find(
		(piece) =>
			piece.faction === "ap" &&
			piece.nation === "br" &&
			piece.type === "corps" &&
			!piece.permanent_on_elimination
	)
	const army = {
		id: "combine-army",
		piece: belgianArmyPiece.id,
		faction: "ap",
		nation: "be",
		type: "army",
		location: "paris",
		reduced: true,
		moved: false,
		attacked: false
	}
	const corps = {
		id: "combine-corps",
		piece: britishCorpsPiece.id,
		faction: "ap",
		nation: "br",
		type: "corps",
		location: "paris",
		reduced: false,
		moved: false,
		attacked: false
	}
	beginTestOps(state, [army, corps], "paris")
	state.activations.paris = "move"
	state.ops.activated.push("paris")
	state.ops.activated_units.paris = [army.id, corps.id]
	rules.action(state, AP_ROLE, "finish")
	assert.equal(state.state, "ops_move")

	assert.deepEqual(rules.view(state, AP_ROLE).actions.combine, [`${army.id}+${corps.id}`])
	rules.action(state, AP_ROLE, "combine", `${army.id}+${corps.id}`)

	assert.equal(army.reduced, false)
	assert.equal(state.units.some((unit) => unit.id === corps.id), false)
	assert.equal(state.eliminated.ap.some((unit) => unit.id === corps.id), true)
})

test("EOG strategic redeployment charges 3 points for an LCU and reduces T1-T2 card SR by one", () => {
	const state = rules.setup(1409)
	const card = data.cards.find((candidate) => candidate.faction === "ap" && candidate.sr >= 3)
	state.turn = 1
	state.active = "ap"
	state.state = "action_card"
	state.hands.ap = [card.id]

	rules.action(state, AP_ROLE, "card_sr", card.id)
	assert.equal(state.sr.remaining, card.sr - 1)

	const army = state.units.find((unit) => unit.faction === "ap" && unit.type === "army")
	state.units = [army]
	state.control = Object.fromEntries(data.spaces.map((space) => [space.id, "ap"]))
	army.location = "paris"
	state.sr = { card: card.id, remaining: 3, used_units: [] }
	rules._test.updateSupply(state)
	rules.action(state, AP_ROLE, "select_sr_unit", army.id)
	const destination = rules.view(state, AP_ROLE).actions.sr_destination[0]
	rules.action(state, AP_ROLE, "sr_destination", destination)

	assert.equal(state.sr.remaining, 0)
	assert.equal(army.location, destination)
})
