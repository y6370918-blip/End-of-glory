"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")

const AP = "Allied Powers"

function card(id) {
	return data.cards.find((entry) => entry.id === id)
}

function prepareEvent(id, seed = id) {
	const state = setupGame(seed)
	state.turn = 8
	state.active = "ap"
	state.state = "action_card"
	state.phase = "行动阶段"
	state.commitment.ap = "total"
	state.hands.ap = [id]
	state.decks.ap = state.decks.ap.filter((entry) => entry !== id)
	state.discard.ap = state.discard.ap.filter((entry) => entry !== id)
	return state
}

function combatWindow(id) {
	const state = setupGame(id)
	const edge = data.edges.find((entry) =>
		entry.modes.includes("attack") && entry.factions.includes("ap"))
	const attackerPiece = data.pieces.find((piece) => piece.faction === "ap" && piece.type === "corps")
	const defenderPiece = data.pieces.find((piece) => piece.faction === "cp" && piece.type === "corps")
	const attacker = {
		id: "attacker", piece: attackerPiece.id, faction: "ap", nation: attackerPiece.nation,
		type: "corps", location: edge.a, reduced: false, supplied: true,
	}
	const defender = {
		id: "defender", piece: defenderPiece.id, faction: "cp", nation: defenderPiece.nation,
		type: "corps", location: edge.b, reduced: false, supplied: true,
	}
	state.units = [attacker, defender]
	state.active = "ap"
	state.state = "combat_card_window"
	state.hands.ap = [id]
	state.combat_window = {
		attacker: "ap", defender: "cp", side: "ap",
		cards: [], card_sources: {}, card_owners: {},
		declaration: { attackers: [attacker.id], target: defender.location },
	}
	return { state, attacker, defender }
}

function finishReinforcement(state) {
	let guard = 0
	while (state.pending_event?.kind === "reinforcement") {
		assert.ok(guard++ < 40)
		const actions = rules.view(state, AP).actions
		if (actions.event_space?.length)
			rules.action(state, AP, "event_space", actions.event_space[0])
		else if (actions.reinforcement_to_reserve)
			rules.action(state, AP, "reinforcement_to_reserve")
		else if (actions.event_confirm)
			rules.action(state, AP, "event_confirm")
		else throw new Error(`No reinforcement continuation: ${JSON.stringify(actions)}`)
	}
}

test("622 Creeping Barrage is AP-attack-only and applies -1 DRM to CP fire", () => {
	const { state, attacker, defender } = combatWindow(622)
	assert.equal(rules.view(state, AP).actions.combat_card.includes(622), true)
	rules.action(state, AP, "combat_card", 622)
	assert.equal(state.hands.ap.includes(622), false)
	const modifiers = rules._test.combatModifiers(
		state,
		state.combat_window.declaration,
		[attacker],
		[defender],
	)
	assert.equal(modifiers.defense_drm, -1)
	assert.equal(data.card_effects[622].combat.disposition.win_draw, "optional")
})

test("625 Italian Entry activates Italy, costs two VP, and installs its recurring rule", () => {
	const state = prepareEvent(625)
	state.turn = 5
	const before = state.vp
	rules.action(state, AP, "card_event", 625)
	assert.equal(state.events.entry_it, true)
	assert.equal(state.vp, before - 2)
	assert.ok(state.events[card(625).event])
	assert.equal(state.removed.ap.includes(625), true)
})

test("627 Cadorna deploys one HQ and adds three persistent Italian loss MO", () => {
	const state = prepareEvent(627)
	state.events.entry_it = true
	for (const space of data.spaces.filter((entry) => entry.nation === "it"))
		state.control[space.id] = "ap"
	rules.action(state, AP, "card_event", 627)
	finishReinforcement(state)
	assert.equal(state.units.filter((unit) => unit.piece === "component-009").length, 1)
	assert.equal(state.mo.pool.it.filter((entry) => entry.source_card === 627).length, 3)
	assert.equal(state.mo.draw_bonus.it, 1)
})

test("628 Artois creates one action-round attack modifier and is removed", () => {
	const state = prepareEvent(628)
	rules.action(state, AP, "card_event", 628)
	const status = state.events[card(628).event]
	assert.equal(status.duration, "action_round")
	assert.equal(data.card_effects[628].combat.restore_attackers_before, 2)
	assert.equal(state.removed.ap.includes(628), true)
})
