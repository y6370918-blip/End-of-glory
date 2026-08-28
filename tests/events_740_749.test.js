"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")

const CP = "Central Powers"
const card = (id) => data.cards.find((entry) => entry.id === id)
const piece = (nation, type) => data.pieces.find(
	(entry) => entry.nation === nation && entry.type === type,
)

function unit(id, nation, type, location) {
	const model = piece(nation, type)
	assert.ok(model)
	return {
		id,
		piece: model.id,
		faction: model.faction,
		nation,
		type,
		location,
		reduced: false,
		moved: false,
		attacked: false,
		supplied: true,
	}
}

function combatState(id) {
	const state = setupGame(id)
	state.turn = 12
	state.commitment.cp = "total"
	state.commitment.ap = "total"
	state.units = [
		unit("ge", "ge", "army", "metz"),
		unit("fr", "fr", "army", "verdun"),
	]
	state.active = "cp"
	state.state = "combat_card_window"
	state.hands.cp = [id]
	state.combat_window = {
		attacker: "cp",
		defender: "ap",
		side: "cp",
		cards: [],
		card_sources: {},
		card_owners: {},
		declaration: { attackers: ["ge"], target: "verdun" },
	}
	return state
}

function modifiersFor(id, trench = 0) {
	const state = setupGame(id)
	state.turn = 12
	state.units = [
		unit("ge", "ge", "army", "metz"),
		unit("fr", "fr", "army", "verdun"),
	]
	state.trenches.verdun = trench
	const declaration = {
		attackers: ["ge"],
		target: "verdun",
		event_effects: [id],
	}
	return rules._test.combatModifiers(
		state,
		declaration,
		[state.units[0]],
		[state.units[1]],
	)
}

test("740/744 reduce losses inflicted by AP, and 748 changes only trenches", () => {
	const michael = modifiersFor(740)
	assert.equal(michael.attack_loss_adjust, -1)
	assert.equal(michael.defense_loss_adjust, 0)
	assert.equal(michael.ignore_natural_terrain, true)
	assert.equal(michael.ignore_fortification, true)
	assert.equal(michael.ignore_trench, true)

	const georgette = modifiersFor(744)
	assert.equal(georgette.attack_loss_adjust, -1)
	assert.equal(georgette.defense_loss_adjust, 0)
	assert.equal(georgette.ignore_natural_terrain, false)
	assert.equal(georgette.ignore_fortification, true)
	assert.equal(georgette.ignore_trench, true)

	const bluecher = modifiersFor(748)
	assert.equal(bluecher.attack_loss_adjust, 0)
	assert.equal(bluecher.defense_loss_adjust, 0)
	assert.equal(bluecher.ignore_natural_terrain, false)
	assert.equal(bluecher.ignore_fortification, false)
	assert.equal(bluecher.ignore_trench, true)
})

test("741 uses the printed trench condition and forces first fire", () => {
	assert.equal(modifiersFor(741, 0).attack_drm, 0)
	const entrenched = modifiersFor(741, 1)
	assert.equal(entrenched.attack_drm, 1)
	assert.equal(entrenched.first_fire, "cp")
	assert.equal(data.card_effects[741].disposition, "discard")
	assert.equal(data.card_effects[741].combat.draw_on_win, true)
})

test("742 is discarded before 737 and removed after 737", () => {
	const before = combatState(742)
	rules.action(before, CP, "combat_card", 742)
	rules._test.revealCommittedCombatCards(before)
	assert.equal(before.discard.cp.includes(742), true)
	assert.equal(before.removed.cp.includes(742), false)

	const after = combatState(742)
	after.events[card(737).event] = { faction: "cp", persistent: true }
	rules.action(after, CP, "combat_card", 742)
	rules._test.revealCommittedCombatCards(after)
	assert.equal(after.discard.cp.includes(742), false)
	assert.equal(after.removed.cp.includes(742), true)
})

test("743 applies its printed marker and RP loss but leaves persistent mutiny MOs in the pool", () => {
	const state = setupGame(743)
	state.active = "cp"
	state.state = "action_card"
	state.commitment.cp = "total"
	state.hands.cp = [743]
	state.rp.ap.fr = 4
	const cp = state.war_status.cp
	const combined = state.war_status.combined
	rules.action(state, CP, "card_event", 743)
	assert.equal(state.war_status.cp, cp + 1)
	assert.equal(state.war_status.combined, combined + 1)
	assert.equal(state.rp.ap.fr, 2)
	const entries = state.mo.pool.fr.filter((entry) => entry.source_card === 743)
	assert.equal(entries.length, 3)
	assert.equal(entries.every((entry) => entry.kind === "prohibition" && entry.expires_turn == null), true)
	assert.equal(state.mo.current.fr.some((id) => id.startsWith("743:mo:")), false)
	assert.equal(state.removed.cp.includes(743), true)
})

test("740/744/748 place only one salient chosen at the end of the CP action", () => {
	for (const id of [740, 744, 748]) {
		const state = setupGame(id)
		state.active = "cp"
		state.state = "ops_attack"
		state.action_round = 2
		state.events[card(id).event] = {
			faction: "cp",
			duration: "action_round",
			salient_candidates: ["sedan", "verdun", "sedan"],
		}
		rules._test.nextFactionAction(state)
		assert.equal(state.state, "event")
		assert.equal(state.pending_event.kind, "salient")
		assert.deepEqual(rules.view(state, CP).actions.event_space, ["sedan", "verdun"])
		rules.action(state, CP, "event_space", "verdun")
		assert.deepEqual(
			state.markers.salients.filter((entry) => entry.source_card === id),
			[{ space: "verdun", source_card: id }],
		)
		assert.equal(state.active, "ap")
	}
})

test("745 locks the Russian front and discounts maintenance", () => {
	const state = setupGame(745)
	state.fronts.russian = 8
	state.events[card(745).event] = { faction: "cp", persistent: true }
	rules._test.moveFront(state, "russian", 1, "test")
	assert.equal(state.fronts.russian, 8)
	const rule = data.card_effects[745].operations.find(
		(entry) => entry.type === "rule_modifier",
	)
	assert.equal(rule.lock_front, "russian")
	assert.equal(rule.russian_maintenance_discount, 1)
	assert.equal(data.card_effects[745].operations.some(
		(entry) => entry.type === "end_vp" && entry.amount === 2,
	), true)
})

test("746 uses the T11 VP boundary and a fixed five-point naval event", () => {
	const spec = data.card_effects[746]
	assert.equal(spec.operations.find((entry) => entry.type === "vp").max_turn, 11)
	assert.equal(spec.naval_event_points, 5)
	assert.deepEqual(
		spec.operations.find((entry) => entry.type === "recurring_rp_loss").values.ap,
		{ us: 1, br: 1 },
	)
})

test("747/749 deploy armies and HQ on the map while corps may use the reserve", () => {
	assert.deepEqual(
		data.card_effects[747].operations[0].units.map((entry) => [entry.piece, entry.count, entry.to]),
		[["component-008", 1, "map"], ["component-110", 3, "map"], ["component-109", 3, "reserve"]],
	)
	assert.deepEqual(
		data.card_effects[749].operations[0].units.map((entry) => [entry.piece, entry.count, entry.to]),
		[["component-110", 4, "map"], ["component-109", 4, "reserve"]],
	)

	for (const [id, total, reserve] of [[747, 7, 3], [749, 8, 4]]) {
		const state = setupGame(id)
		state.turn = 12
		state.active = "cp"
		state.state = "action_card"
		state.commitment.cp = "total"
		state.hands.cp = [id]
		state.events[card(745).event] = { faction: "cp", persistent: true }
		rules.action(state, CP, "card_event", id)
		assert.equal(state.pending_event.kind, "reinforcement")
		assert.equal(state.pending_event.queue.length, total)
		assert.equal(state.pending_event.queue.filter((entry) => entry.reserve_optional).length, reserve)
		assert.equal(state.pending_event.queue.filter((entry) => !entry.reserve_optional).length, total - reserve)
	}
})

test("version 27 saves migrate mutiny MOs and duplicate salients to version 28", () => {
	const state = setupGame(740)
	state.version = 27
	state.active = "cp"
	state.events[card(740).event] = { faction: "cp", duration: "action_round" }
	state.markers.salients = [
		{ space: "sedan", source_card: 740 },
		{ space: "verdun", source_card: 740 },
	]
	state.mo.pool.fr ||= []
	state.mo.pool.fr.push({
		id: "743:mo:mutiny_no_attack:1",
		nation: "fr",
		kind: "prohibition",
		source_card: 743,
		expires_turn: state.turn,
	})
	state.mo.current.fr.push("743:mo:mutiny_no_attack:1")
	rules.view(state, CP)
	assert.equal(state.version, 42)
	assert.deepEqual(state.events[card(740).event].salient_candidates, ["sedan", "verdun"])
	assert.equal(state.markers.salients.length, 0)
	assert.equal(state.mo.pool.fr.at(-1).expires_turn, undefined)
	assert.equal(state.mo.current.fr.includes("743:mo:mutiny_no_attack:1"), false)
})


