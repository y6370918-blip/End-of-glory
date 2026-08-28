"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")
const scene = require("../piece-scene.js")
const { setupGame } = require("./setup_game.js")

const AP = "Allied Powers"
const CP = "Central Powers"

test("version 31 opening lets AP reserve one printed 4 OP card before CP decides August Guns", () => {
	const state = rules.setup(31001)
	assert.equal(state.version, 42)
	assert.equal(state.state, "opening_ap_card")
	const ap = rules.view(state, AP)
	assert.ok(ap.opening_cards.length > 0)
	assert.ok(ap.opening_cards.every((id) => data.cards.find((card) => card.id === id).ops === 4))
	assert.deepEqual(rules.view(state, CP).opening_cards, [])
	assert.deepEqual(rules.view(state, "Observer").opening_cards, [])

	const selected = ap.opening_cards[0]
	rules.action(state, AP, "select_opening_card", selected)
	assert.equal(state.state, "opening_cp_august_guns")
	assert.deepEqual(rules.view(state, CP).actions.select_opening_card, [701])
	rules.action(state, CP, "skip_august_guns")
	assert.equal(state.state, "mo_review")
	assert.equal(state.active, "cp")
	assert.equal(state.hands.ap.includes(selected), true)
	assert.equal(state.hands.ap.length, 9)
	assert.equal(state.hands.cp.length, 9)
})

test("703 is barred on T1, voluntary entry starts the Turkish front at zero, and automatic entry starts it at one", () => {
	const voluntary = setupGame(31002)
	voluntary.active = "cp"
	voluntary.state = "action_card"
	voluntary.hands.cp = [703]
	assert.equal(rules.view(voluntary, CP).actions.card_event?.includes(703) || false, false)
	voluntary.turn = 2
	const vp = voluntary.vp
	rules.action(voluntary, CP, "card_event", 703)
	assert.equal(voluntary.events.entry_tu, true)
	assert.equal(voluntary.fronts.turkish, 0)
	assert.equal(voluntary.vp, vp - 1)

	const automatic = setupGame(31003)
	automatic.turn = 3
	automatic.hands.cp.push(703)
	automatic.war_status.cp = 6
	automatic.war_status.combined = 6
	const automaticVp = automatic.vp
	rules._test.resolveWarStatus(automatic)
	assert.equal(automatic.events[data.cards.find((card) => card.id === 703).event].automatic, true)
	assert.equal(automatic.fronts.turkish, 1)
	assert.equal(automatic.vp, automaticVp)
	assert.equal(automatic.removed.cp.includes(703), true)
})

test("movement-only attack eligibility never creates an MO attack marker", () => {
	const state = setupGame(31004)
	const attacker = state.units.find((unit) => unit.faction === "ap" && unit.type === "army")
	assert.ok(attacker)
	attacker.attack_eligible = true
	state.active = "ap"
	state.activations = { [attacker.location]: "move" }
	state.ops = { forced_attacks: [] }
	const declaration = { attackers: [attacker.id], target: "test-target" }
	assert.deepEqual(rules._test.computeMoMarkerOrigins(state, declaration), {})
	const id = `test-${attacker.nation}-movement-only`
	state.mo.pool[attacker.nation] = [{ id, nation: attacker.nation, kind: "task", attacks: 1, distinct_targets: true }]
	state.mo.current[attacker.nation] = [id]
	state.mo.completed[attacker.nation] = []
	state.mo.progress[attacker.nation] = { [id]: 0 }
	state.mo.targets[attacker.nation] = { [id]: [] }
	rules._test.markMoForAttack(state, attacker.nation, id, declaration)
	assert.equal(state.mo.progress[attacker.nation][id], 0)
	assert.deepEqual(state.mo.targets[attacker.nation][id], [])
	state.activations[attacker.location] = "attack"
	assert.deepEqual(rules._test.computeMoMarkerOrigins(state, declaration), {
		[attacker.nation]: [attacker.location],
	})
})

test("one combat card id cannot be committed twice during the same player action", () => {
	const state = setupGame(31005)
	const card = data.cards.find((entry) => entry.id === 621)
	const edge = data.edges.find((entry) => entry.modes.includes("attack") && entry.factions.includes("ap"))
	const apPiece = data.pieces.find((entry) => entry.faction === "ap" && entry.type === "army")
	const cpPiece = data.pieces.find((entry) => entry.faction === "cp" && entry.type === "army")
	state.units = [
		{ id: "ap-card-user", piece: apPiece.id, faction: "ap", nation: apPiece.nation, type: "army", location: edge.a, reduced: false, supplied: true },
		{ id: "cp-card-target", piece: cpPiece.id, faction: "cp", nation: cpPiece.nation, type: "army", location: edge.b, reduced: false, supplied: true },
	]
	state.active = "ap"
	state.state = "combat_card_window"
	state.action_state = { turn: 1, round: 1, actor: "ap", used_combat_cards: [] }
	state.hands.ap = [card.id]
	state.combat_window = {
		attacker: "ap", defender: "cp", side: "ap", cards: [], card_sources: {}, card_owners: {},
		declaration: { attackers: ["ap-card-user"], target: edge.b },
	}
	const originalLegal = rules.view(state, AP).actions.combat_card || []
	assert.equal(originalLegal.includes(card.id), true)
	rules.action(state, AP, "combat_card", card.id)
	assert.equal(state.action_state.used_combat_cards.includes(card.id), true)
	state.retained_combat_cards.ap.push(card.id)
	state.active = "ap"
	state.state = "combat_card_window"
	state.combat_window = {
		attacker: "ap", defender: "cp", side: "ap", cards: [], card_sources: {}, card_owners: {},
		declaration: { attackers: ["ap-card-user"], target: edge.b },
	}
	assert.equal(rules.view(state, AP).actions.combat_card?.includes(card.id) || false, false)
})

test("603 and 617 reserve SCU list London as their only map destination", () => {
	for (const id of [603, 617]) {
		const reserveUnits = data.card_effects[id].operations
			.flatMap((operation) => operation.units || [])
			.filter((unit) => unit.to === "reserve")
		assert.ok(reserveUnits.length > 0)
		assert.ok(reserveUnits.every((unit) => unit.reserve_allowed &&
			JSON.stringify(unit.map_spaces) === JSON.stringify(["london"])))
	}
})

test("eliminated units have stable faction, nation, type and face stack keys", () => {
	const piece = data.pieces.find((entry) => entry.faction === "ap" && entry.type === "corps")
	const unit = { id: "dead", piece: piece.id, faction: "ap", nation: piece.nation, type: "corps", reduced: true }
	const built = scene.buildScene({
		units: [], reserves: { ap: [], cp: [] }, eliminated: { ap: [unit], cp: [] }, activations: {}, selection: null,
	}, { pieces: new Map(), spaces: new Map() }, data)
	const key = scene.eliminatedStackKey("ap", piece.nation, "corps", "reduced")
	assert.equal(built.units.get("dead").stackKey, key)
	assert.deepEqual(built.stacks.get(key).unitIds, ["dead"])
})
