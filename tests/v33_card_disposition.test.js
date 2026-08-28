"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")

const AP_ROLE = "Allied Powers"

function prepareApCard(id, seed) {
	const state = setupGame(seed)
	state.active = "ap"
	state.state = "action_card"
	state.phase = "行动阶段"
	state.commitment.ap = "total"
	state.last_action_use.ap = null
	for (const pool of [state.hands.ap, state.decks.ap, state.discard.ap, state.removed.ap]) {
		let index
		while ((index = pool.indexOf(id)) >= 0) pool.splice(index, 1)
	}
	state.hands.ap = [id]
	return state
}

test("v33 a printed asterisk removes Events but not OPS, SR, or RP uses", () => {
	const event = prepareApCard(651, 33001)
	assert.equal(rules.view(event, AP_ROLE).actions.card_event.includes(651), true)
	rules.action(event, AP_ROLE, "card_event", 651)
	assert.equal(event.removed.ap.includes(651), true)
	assert.equal(event.discard.ap.includes(651), false)

	for (const [action, seed] of [["card_ops", 33002], ["card_sr", 33003], ["card_rp", 33004]]) {
		const state = prepareApCard(604, seed)
		assert.equal(rules.view(state, AP_ROLE).actions[action].includes(604), true)
		rules.action(state, AP_ROLE, action, 604)
		assert.equal(state.discard.ap.includes(604), true, action)
		assert.equal(state.removed.ap.includes(604), false, action)
	}
})

test("v33 every starred combat card has unconditional removal disposition", () => {
	for (const card of data.cards.filter((candidate) => candidate.combat_card && candidate.remove)) {
		assert.deepEqual(data.card_effects[card.id].combat.disposition, {
			retain_on_win: false,
			after_combat: "remove",
			win_draw: null,
			retained_after_use: "remove",
		}, String(card.id))
	}
})

test("v33 migration moves only proven Event removals and restores card 640", () => {
	const state = setupGame(33005)
	state.version = 32
	for (const id of [604, 605, 640]) {
		for (const pool of [state.hands.ap, state.decks.ap, state.discard.ap, state.removed.ap]) {
			let index
			while ((index = pool.indexOf(id)) >= 0) pool.splice(index, 1)
		}
	}
	state.discard.ap.push(604, 605)
	state.removed.ap.push(640)
	state.event_history.push({ card: 604, event: data.cards.find((card) => card.id === 604).event })

	rules.view(state, AP_ROLE)

	assert.equal(state.version, 42)
	assert.equal(state.removed.ap.includes(604), true)
	assert.equal(state.discard.ap.includes(604), false)
	assert.equal(state.discard.ap.includes(605), true)
	assert.equal(state.removed.ap.includes(605), false)
	assert.equal(state.discard.ap.includes(640), true)
	assert.equal(state.removed.ap.includes(640), false)
})
