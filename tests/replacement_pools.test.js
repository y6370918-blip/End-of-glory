"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")

const AP = "Allied Powers"

function replacementState() {
	const state = rules.setup(5601)
	state.turn = 6
	state.commitment.ap = "limited"
	state.state = "replacement"
	state.phase = "补员/升级"
	state.active = "ap"
	state.replacement_active = "ap"
	state.rp.ap = {br: 4, fr: 0, it: 0, us: 4}
	return state
}

function addReduced(state, id, piece) {
	const definition = data.pieces.find((candidate) => candidate.id === piece)
	const unit = {
		id,
		piece,
		faction: "ap",
		nation: definition.nation,
		type: definition.type,
		location: "london",
		reduced: true,
		supplied: true,
		limited_supply: false
	}
	state.units.push(unit)
	return unit
}

test("Indian cavalry and Commonwealth replacements may choose BR:RP or A:RP", () => {
	for (const piece of ["component-090", "component-099"]) {
		const state = replacementState()
		const unit = addReduced(state, `pool-${piece}`, piece)
		const options = rules
			.view(state, AP)
			.actions.spend_option.filter((option) => option.startsWith(`flip:${unit.id}:`))
		assert.deepEqual(
			options.map((option) => option.split(":")[2]).sort(),
			["br", "us"]
		)

		rules.action(state, AP, "spend_option", `flip:${unit.id}:us`)
		assert.equal(unit.reduced, false)
		assert.equal(state.rp.ap.us, 3)
		assert.equal(state.rp.ap.br, 4)
	}
})

test("Indian infantry is a one-use unit and cannot receive replacement points", () => {
	const state = replacementState()
	const unit = addReduced(state, "pool-indian-infantry", "component-089")
	const options = rules
		.view(state, AP)
		.actions.spend_option?.filter((option) => option.startsWith(`flip:${unit.id}:`)) || []
	assert.deepEqual(options, [])
})

test("Belgian replacements use A:RP and ordinary British replacements use BR:RP", () => {
	const state = replacementState()
	const belgian = addReduced(state, "pool-belgian", "component-023")
	const british = addReduced(state, "pool-british", "component-094")
	const actions = rules.view(state, AP).actions
	assert.equal(actions.spend_flip.includes(belgian.id), true)
	assert.equal(actions.spend_flip.includes(british.id), true)
	const beforeBr = state.rp.ap.br
	const beforeUs = state.rp.ap.us
	rules.action(state, AP, "spend_flip", belgian.id)
	assert.equal(state.rp.ap.us, beforeUs - 1)
	rules.action(state, AP, "spend_flip", british.id)
	assert.equal(state.rp.ap.br, beforeBr - 1)
	rules.action(state, AP, "spend_option", `flip:${british.id}:us`)
	assert.equal(state.rp.ap.us, beforeUs - 1)
})
