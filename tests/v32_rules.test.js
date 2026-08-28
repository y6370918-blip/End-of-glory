"use strict"

/* global structuredClone */

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")

const AP_ROLE = "Allied Powers"

function card(id) {
	return data.cards.find((candidate) => candidate.id === id)
}

function combatUnit(id, piece, location) {
	return {
		id,
		piece: piece.id,
		faction: piece.faction,
		nation: piece.nation,
		type: piece.type,
		location,
		reduced: false,
		moved: false,
		attacked: false,
		supplied: true,
		fort_limited_supply: false,
	}
}

test("v32 four Channel roads are AP-only land connections with all six modes", () => {
	const expected = new Set([
		"brighton|dieppe",
		"brighton|le_havre",
		"boulogne|dover",
		"calais|dover",
	])
	const channel = data.edges.filter((edge) => edge.requires_land_attack_support)
	assert.deepEqual(new Set(channel.map((edge) => [edge.a, edge.b].sort().join("|"))), expected)
	for (const edge of channel) {
		assert.equal(edge.type, "land")
		assert.deepEqual(edge.modes, ["move", "attack", "supply", "sr", "retreat", "advance"])
		assert.deepEqual(edge.factions, ["ap"])
	}
	assert.equal(data.edges.some((edge) => [edge.a, edge.b].sort().join("|") === "southern_italy|venice"), false)
})

test("v32 a Channel origin cannot attack alone but may join a supported land attack", () => {
	const state = rules.setup(32001)
	const channelEdge = data.edges.find(
		(edge) => edge.requires_land_attack_support && edge.a === "dover" && edge.b === "calais",
	)
	assert.ok(channelEdge)
	const normalEdge = data.edges.find(
		(edge) =>
			!edge.requires_land_attack_support &&
			edge.modes.includes("attack") &&
			edge.factions.includes("ap") &&
			(edge.a === "calais" || edge.b === "calais"),
	)
	assert.ok(normalEdge)
	const landOrigin = normalEdge.a === "calais" ? normalEdge.b : normalEdge.a
	const apPiece = data.pieces.find((piece) => piece.faction === "ap" && piece.type === "army")
	const cpPiece = data.pieces.find((piece) => piece.faction === "cp" && piece.type === "army")
	const channelAttacker = combatUnit("channel-attacker", apPiece, "dover")
	const landAttacker = combatUnit("land-attacker", apPiece, landOrigin)
	const defender = combatUnit("channel-defender", cpPiece, "calais")
	state.turn = 4
	state.active = "ap"
	state.units = [channelAttacker, landAttacker, defender]
	state.control.dover = "ap"
	state.control[landOrigin] = "ap"
	state.control.calais = "cp"
	state.activations = { dover: "attack", [landOrigin]: "attack" }
	state.ops = {
		remaining: 0,
		activated: ["dover", landOrigin],
		activated_units: {
			dover: [channelAttacker.id],
			[landOrigin]: [landAttacker.id],
		},
	}
	assert.throws(
		() => rules._test.validateAttackDeclaration(state, {
			attackers: [channelAttacker.id],
			target: "calais",
			flank: false,
		}),
		/Channel attack requires/,
	)
	assert.doesNotThrow(() => rules._test.validateAttackDeclaration(state, {
		attackers: [channelAttacker.id, landAttacker.id],
		target: "calais",
		flank: false,
	}))
})

test("v32 consecutive card SR and RP uses are hidden until another formal action intervenes", () => {
	const state = rules.setup(32002)
	state.active = "ap"
	state.state = "action_card"
	state.commitment.ap = "mobilization"
	state.hands.ap = [600, 601]
	state.last_action_use.ap = "sr"
	let view = rules.view(state, AP_ROLE)
	assert.equal(view.actions.card_sr, undefined)
	assert.ok(view.actions.card_rp.includes(600))

	state.last_action_use.ap = "rp"
	view = rules.view(state, AP_ROLE)
	assert.equal(view.actions.card_rp, undefined)
	assert.ok(view.actions.card_sr.includes(600))

	state.last_action_use.ap = "sr"
	rules.action(state, AP_ROLE, "card_ops", 600)
	assert.equal(state.last_action_use.ap, "ops")
})

test("v32 one national reinforcement event per turn is enforced without consuming other nations", () => {
	const state = rules.setup(32003)
	state.active = "ap"
	state.state = "action_card"
	state.commitment.ap = "total"
	state.reinforcement_events_this_turn.ap = ["br"]
	assert.equal(rules._test.eventLegal(state, card(603)), false)
	assert.equal(rules._test.eventLegal(state, card(645)), false)
	assert.equal(rules._test.eventLegal(state, card(607)), true)

	assert.equal(rules._test.eventLegal(state, card(649)), false)
	state.events[card(646).event] = true
	assert.equal(rules._test.eventLegal(state, card(649)), true)
})

test("v32 an HQ may move alone when its destination contains a national combat unit", () => {
	const state = rules.setup(32005)
	const hqPiece = data.pieces.find((piece) => piece.faction === "cp" && piece.nation === "ge" && piece.type === "hq")
	const armyPiece = data.pieces.find((piece) => piece.faction === "cp" && piece.nation === "ge" && piece.type === "army")
	const hq = combatUnit("solo-hq", hqPiece, "essen")
	const army = combatUnit("hq-destination-army", armyPiece, "dusseldorf")
	state.turn = 4
	state.active = "cp"
	state.state = "ops_move"
	state.units = [hq, army]
	state.activations = { essen: "move" }
	state.ops = {
		remaining: 0,
		activated: ["essen"],
		activated_units: { essen: [hq.id] },
		execution_phase: "move",
		moving: null,
		move_selection: null,
		pending_siege: null,
	}
	rules.action(state, "Central Powers", "select_move_unit", hq.id)
	assert.deepEqual(state.ops.move_selection.selected, [hq.id])
	assert.ok(rules.view(state, "Central Powers").actions.move.includes("dusseldorf"))
})

test("v32 each combat loss has a one-step undo without undoing the public dice", () => {
	const state = rules.setup(32006)
	const piece = data.pieces.find((candidate) => candidate.faction === "ap" && candidate.type === "corps")
	const unit = combatUnit("undo-loss-corps", piece, "paris")
	state.units = [unit]
	state.active = "ap"
	state.state = "combat_losses"
	state.undo = []
	state.combat = {
		attacker: "cp",
		attackers: [],
		defenders: [unit.id],
		target: "paris",
		attack_loss: 0,
		defense_loss: 99,
		pending_side: "ap",
		remaining_loss: 99,
		mo_assignments: {},
		resolution_events: [],
		modifiers: { cards: [], cancel_retreat: [], cancel_advance: [], prohibit_advance: [], minimum_retreat: 0 },
	}
	rules.action(state, AP_ROLE, "take_loss", unit.id)
	assert.equal(unit.reduced, true)
	assert.equal(rules.view(state, AP_ROLE).actions.undo, 1)
	rules.action(state, AP_ROLE, "undo")
	const restored = state.units.find((candidate) => candidate.id === unit.id)
	assert.equal(restored.reduced, false)
	assert.equal(state.state, "combat_losses")
})

test("v32 Junker Officers is an eventable no-effect white card", () => {
	const state = rules.setup(32004)
	state.active = "ap"
	state.state = "action_card"
	state.commitment.ap = "mobilization"
	state.hands.ap = [651]
	const before = {
		vp: state.vp,
		warStatus: structuredClone(state.war_status),
		units: state.units.map((unit) => unit.id),
	}
	assert.deepEqual(rules.view(state, AP_ROLE).actions.card_event, [651])
	rules.action(state, AP_ROLE, "card_event", 651)
	assert.equal(state.removed.ap.includes(651), true)
	assert.equal(state.discard.ap.includes(651), false)
	assert.equal(state.vp, before.vp)
	assert.deepEqual(state.war_status, before.warStatus)
	assert.deepEqual(state.units.map((unit) => unit.id), before.units)
	assert.equal(Boolean(state.events[card(651).event]), true)
})
