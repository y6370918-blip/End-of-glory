"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")

const AP_ROLE = "Allied Powers"

function addTestMoBagTokens(state, nation, count) {
	if (!state.mo.pool[nation]) state.mo.pool[nation] = []
	for (let index = 1; index <= count; index++)
		state.mo.pool[nation].push({
			id: `test-${nation}-bag-${index}`,
			nation,
			kind: "task",
			name: `测试 ${nation.toUpperCase()} MO ${index}`,
			attacks: 1
		})
}

function playItalyEntry(turn = 1) {
	const state = rules.setup(1201 + turn)
	state.turn = turn
	state.commitment.ap = "limited"
	state.active = "ap"
	state.state = "action_card"
	state.hands.ap = [625]
	rules.action(state, AP_ROLE, "card_event", 625)
	return state
}

test("Italian historical setup units remain off-map until Italy enters", () => {
	const state = rules.setup(1201)
	const waiting = state.entry_reserve.it.map((unit) => ({
		id: unit.id,
		location: unit.location,
		reduced: unit.reduced
	}))
	assert.ok(waiting.length > 0)
	assert.equal(state.units.some((unit) => unit.nation === "it"), false)

	const entered = playItalyEntry()
	assert.equal(entered.events.entry_it, true)
	assert.equal(entered.entry_reserve.it.length, 0)
	for (const expected of waiting) {
		const deployed = entered.units.find((unit) => unit.id === expected.id)
		assert.equal(deployed?.location, expected.location)
		assert.equal(deployed?.reduced, expected.reduced)
	}
})

test("version 3 saves move pre-entry Italian setup units into the entry reserve", () => {
	const state = rules.setup(1202)
	const expectedCount = state.entry_reserve.it.length
	state.units.push(...state.entry_reserve.it)
	state.entry_reserve = undefined
	state.version = 3

	rules.view(state, AP_ROLE)

	assert.equal(state.version, 46)
	assert.equal(state.units.some((unit) => unit.nation === "it"), false)
	assert.equal(state.entry_reserve.it.length, expectedCount)
})

test("ports are not automatic supply sources, while London supplies through the Channel roads", () => {
	const state = rules.setup(1203)
	state.control = Object.fromEntries(data.spaces.map((space) => [space.id, null]))
	for (const space of ["london", "dover", "calais", "boulogne", "montreuil", "abbeville", "amiens"])
		state.control[space] = "ap"
	for (const space of ["trieste", "adelsberg"]) state.control[space] = "cp"

	const apSupply = rules._test.suppliedSpaces(state, "ap")
	const cpSupply = rules._test.suppliedSpaces(state, "cp")
	assert.equal(apSupply.has("calais"), true)
	assert.equal(apSupply.has("amiens"), true)
	assert.equal(cpSupply.has("trieste"), false)
	assert.equal(cpSupply.has("adelsberg"), false)
})

test("Channel Blockade does not turn ports into supply sources", () => {
	const state = rules.setup(1204)
	state.control = Object.fromEntries(data.spaces.map((space) => [space.id, null]))
	for (const space of [
		"calais", "boulogne", "montreuil", "abbeville", "amiens", "trieste", "adelsberg"
	])
		state.control[space] = "cp"
	const blockadeCard = data.cards.find((card) => card.id === 606)
	const blockadeRule = data.card_effects[606].operations.find(
		(operation) => operation.type === "rule_modifier"
	)

	assert.equal(rules._test.suppliedSpaces(state, "cp").has("calais"), false)
	state.events[blockadeCard.event] = { faction: "ap", rule: blockadeRule }
	const supplied = rules._test.suppliedSpaces(state, "cp")
	assert.equal(supplied.has("calais"), false)
	assert.equal(supplied.has("amiens"), false)
	assert.equal(supplied.has("trieste"), false)
	assert.equal(supplied.has("adelsberg"), false)
})

test("captured Brussels becomes a CP supply source", () => {
	const state = rules.setup(1205)
	state.units = []
	state.control = Object.fromEntries(data.spaces.map((space) => [space.id, null]))
	state.control.brussels = "cp"
	state.control.leuven = "cp"
	const supplied = rules._test.suppliedSpaces(state, "cp")
	assert.equal(supplied.has("brussels"), true)
	assert.equal(supplied.has("leuven"), true)
})

test("units connected only to an allied nation's source have limited supply", () => {
	const state = rules.setup(12051)
	const german = state.units.find(
		(unit) => unit.nation === "ge" && ["army", "corps"].includes(unit.type)
	)
	assert.ok(german)
	state.units = [german]
	german.location = "tyrol"
	state.control = Object.fromEntries(data.spaces.map((space) => [space.id, null]))
	state.control.tyrol = "cp"

	rules._test.updateSupply(state)

	assert.equal(rules._test.suppliedSpaces(state, "cp").has("tyrol"), true)
	assert.equal(rules._test.suppliedSpaces(state, "cp", "ge").has("tyrol"), false)
	assert.equal(german.supplied, false)
	assert.equal(german.limited_supply, true)
	assert.equal(german.fort_limited_supply, false)
})

test("MO bags retain previously drawn markers until at least half have been drawn", () => {
	const state = setupGame(1206)
	addTestMoBagTokens(state, "fr", 4)
	const turnOne = state.mo.current.fr.slice()
	state.turn = 2
	rules._test.drawMo(state)
	const turnTwo = state.mo.current.fr.slice()

	assert.equal(turnOne.some((id) => turnTwo.includes(id)), false)
	assert.equal(state.mo.drawn.fr.length, 4)
	assert.equal(state.mo.bag.fr.length, 7 - 4)
})

test("MO bags wash all markers before drawing when half have already been drawn", () => {
	const state = setupGame(1207)
	addTestMoBagTokens(state, "fr", 4)
	state.turn = 2
	rules._test.drawMo(state)
	assert.equal(state.mo.drawn.fr.length, 4)

	state.turn = 3
	const logStart = state.log.length
	rules._test.drawMo(state)

	assert.equal(state.mo.drawn.fr.length, 2)
	assert.equal(state.mo.bag.fr.length, 7 - 2)
	assert.ok(state.log.slice(logStart).some((entry) => entry.includes("FR MO：已抽出半数")))
})

test("an undersized MO bag draws its remainder, then washes only older markers", () => {
	const state = rules.setup(1208)
	addTestMoBagTokens(state, "it", 1)
	const ids = rules._test.moBagDefinitions(state, "it").map((mo) => mo.id)
	state.mo.bag.it = ids.slice(1)
	state.mo.drawn.it = ids.slice(0, 1)
	const selected = rules._test.drawMoForNation(state, "it", 3)

	assert.deepEqual(
		selected.map((mo) => mo.id).sort(),
		ids.sort()
	)
	assert.equal(state.mo.bag.it.length, 0)
	assert.equal(state.mo.drawn.it.length, 3)
	assert.ok(state.log.some((entry) => entry.includes("IT MO：抽完余下标记")))
})
