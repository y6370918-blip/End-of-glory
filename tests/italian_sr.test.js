"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")

const AP_ROLE = "Allied Powers"
const CP_ROLE = "Central Powers"

function piece(nation, type) {
	return data.pieces.find(
		(candidate) =>
			candidate.faction === (["ge", "ah"].includes(nation) ? "cp" : "ap") &&
			candidate.nation === nation &&
			candidate.type === type
	)
}

function unit(id, nation, type, location) {
	const template = piece(nation, type)
	assert.ok(template, `${nation} ${type}`)
	return {
		id,
		piece: template.id,
		nation,
		faction: template.faction,
		type,
		location,
		reduced: false,
		moved: false,
		attacked: false,
		supplied: true,
		limited_supply: false,
		fort_limited_supply: false
	}
}

function opsState(seed = 1901) {
	const state = rules.setup(seed)
	state.turn = 6
	state.action_round = 1
	state.state = "ops_activate"
	state.activations = {}
	state.ops = {
		card: null,
		total: 5,
		remaining: 5,
		italian_bonus: 0,
		combat_effect: null,
		activated: [],
		moving: null,
		schlieffen: null,
		preactivation_sr_used: [],
		preactivation_sr_units: [],
		entrench_attempted: [],
		pending_siege: null,
		pending_activation: null,
		activated_units: {}
	}
	return state
}

function enterItaly(state) {
	state.events[data.cards.find((card) => card.id === 625).event] = {
		faction: "ap",
		duration: "game"
	}
}

test("the printed Western and Italian maps have no invented cross-map edges", () => {
	const theater = (id) => ["it", "ah"].includes(data.spaces.find((space) => space.id === id)?.nation)
	for (const edge of data.edges)
		assert.equal(theater(edge.a), theater(edge.b), `${edge.a}-${edge.b}`)
})

test("supply cannot cross an SR-only theater boundary", () => {
	const state = rules.setup(1902)
	for (const space of data.spaces.filter((candidate) => ["it", "ah"].includes(candidate.nation)))
		state.control[space.id] = "cp"
	state.control.brescia = "ap"
	assert.equal(rules._test.suppliedSpaces(state, "ap").has("brescia"), false)
})

test("the Italian theater is frozen before entry and activates afterwards", () => {
	const state = opsState(1903)
	state.active = "cp"
	const austrian = state.units.find(
		(candidate) => candidate.nation === "ah" && ["army", "corps"].includes(candidate.type)
	)
	assert.ok(austrian)
	assert.equal(rules.view(state, CP_ROLE).actions.activate_move.includes(austrian.location), false)

	rules.action(state, CP_ROLE, "activate_move", austrian.location)
	assert.equal(state.activations[austrian.location], undefined)

	enterItaly(state)
	assert.equal(rules.view(state, CP_ROLE).actions.activate_move.includes(austrian.location), true)
})

test("ordinary movement, combat, retreat, and advance cannot cross theater boundaries", () => {
	const state = opsState(1904)
	enterItaly(state)
	state.active = "ap"
	const attacker = unit("boundary-fr-army", "fr", "army", "paris")
	const defender = unit("boundary-ah-army", "ah", "army", "tyrol")
	state.units = [attacker, defender]
	state.control.paris = "ap"
	state.control.tyrol = "cp"
	rules._test.updateSupply(state)

	assert.equal(rules._test.movementDestinations(state, attacker).includes("tyrol"), false)
	assert.equal(rules._test.attacksTarget(state, attacker, "tyrol"), false)

	state.control.tyrol = "ap"
	state.pending_retreat = { paths: { [attacker.id]: [] } }
	assert.equal(rules._test.retreatDestinations(state, attacker).includes("tyrol"), false)

	state.state = "advance_select"
	state.pending_retreat = {
		units: [attacker.id],
		target: "tyrol",
		maximum: null,
		advanced: 0
	}
	state.combat = { attacker: "ap", modifiers: { cards: [] } }
	assert.equal(rules.view(state, AP_ROLE).actions.select_advance_unit?.includes(attacker.id) || false, false)
})

test("cross-theater SR cannot bypass the formal connection network", () => {
	const state = opsState(1905)
	enterItaly(state)
	state.active = "ap"
	const corps = unit("cross-fr-corps", "fr", "corps", "paris")
	const army = unit("cross-fr-army", "fr", "army", "paris")
	const hq = unit("cross-fr-hq", "fr", "hq", "paris")
	const anchor = unit("italy-fr-anchor", "fr", "corps", "milan")
	state.units = [corps, army, hq, anchor]
	state.control.paris = "ap"
	state.control.milan = "ap"
	rules._test.updateSupply(state)

	assert.equal(rules._test.srDestinations(state, corps).includes("milan"), false)
	assert.equal(rules._test.srDestinations(state, army).includes("milan"), false)
	assert.equal(rules._test.srDestinations(state, hq).includes("milan"), false)

	state.units = [corps, army, hq]
	rules._test.updateSupply(state)
	assert.equal(rules._test.srDestinations(state, corps).includes("milan"), false)
})

test("reserve corps SR to national sources or supplied same-nationality stacks", () => {
	const state = opsState(1906)
	state.active = "ap"
	state.state = "sr"
	state.sr = { card: null, remaining: 4, used_units: [] }
	const reserve = unit("reserve-fr-corps", "fr", "corps")
	delete reserve.location
	state.reserves.ap = [reserve]
	rules._test.updateSupply(state)

	const early = rules._test.reserveSrDestinations(state, reserve)
	assert.equal(early.includes("paris"), true)
	assert.equal(early.includes("london"), false)

	rules.action(state, AP_ROLE, "select_sr_unit", reserve.id)
	rules.action(state, AP_ROLE, "sr_destination", "paris")
	assert.equal(state.reserves.ap.some((candidate) => candidate.id === reserve.id), false)
	assert.equal(state.units.find((candidate) => candidate.id === reserve.id)?.location, "paris")

	state.sr = { card: null, remaining: 4, used_units: [] }
	rules.action(state, AP_ROLE, "select_sr_unit", reserve.id)
	rules.action(state, AP_ROLE, "sr_destination", "reserve")
	assert.equal(state.units.some((candidate) => candidate.id === reserve.id), false)
	assert.equal(state.reserves.ap.some((candidate) => candidate.id === reserve.id), true)
})

test("T1-T2 SR stays inside national borders and Belgium remains closed to BR/FR entry", () => {
	const state = opsState(1907)
	state.turn = 1
	const french = unit("early-fr-corps", "fr", "corps")
	const british = unit("early-br-corps", "br", "corps")
	delete french.location
	delete british.location
	state.reserves.ap = [french, british]
	rules._test.updateSupply(state)

	const frenchSpaces = rules._test.reserveSrDestinations(state, french)
	const britishSpaces = rules._test.reserveSrDestinations(state, british)
	assert.equal(frenchSpaces.includes("paris"), true)
	assert.equal(frenchSpaces.includes("london"), false)
	assert.equal(britishSpaces.includes("london"), true)
	assert.equal(britishSpaces.includes("brussels"), false)

	state.events[data.cards.find((card) => card.id === 611).event] = {
		faction: "ap",
		duration: "game"
	}
	state.control.brussels = "ap"
	rules._test.updateSupply(state)
	assert.equal(rules._test.reserveSrDestinations(state, british).includes("brussels"), true)
})
