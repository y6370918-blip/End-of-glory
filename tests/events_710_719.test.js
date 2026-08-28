"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")

const AP = "Allied Powers"
const CP = "Central Powers"

function card(id) {
	return data.cards.find((entry) => entry.id === id)
}

function prepareCpAction(id, turn = 10) {
	const state = setupGame(id)
	state.turn = turn
	state.active = "cp"
	state.state = "action_card"
	state.phase = "行动阶段"
	state.commitment.cp = "total"
	state.hands.cp = [id]
	state.decks.cp = state.decks.cp.filter((entry) => entry !== id)
	state.discard.cp = state.discard.cp.filter((entry) => entry !== id)
	state.removed.cp = state.removed.cp.filter((entry) => entry !== id)
	return state
}

function cpDefense(cardId, attackerNation = "fr", turn = 5) {
	const state = setupGame(cardId)
	const target = data.spaces.find((space) => space.id === "metz")
	const originId = target.connections.find((id) =>
		rules._test.connectionAllows(id, target.id, "attack", "ap"))
	assert.ok(originId)
	const attackerPiece = data.pieces.find((piece) =>
		piece.nation === attackerNation && ["army", "corps"].includes(piece.type))
	const defenderPiece = data.pieces.find((piece) =>
		piece.nation === "ge" && piece.type === "army")
	assert.ok(attackerPiece)
	assert.ok(defenderPiece)
	const attackers = [{
		id: "attacker", piece: attackerPiece.id, faction: "ap", nation: attackerNation,
		type: attackerPiece.type, location: originId, reduced: false, supplied: true,
	}]
	const defenders = [{
		id: "defender", piece: defenderPiece.id, faction: "cp", nation: "ge",
		type: "army", location: target.id, reduced: false, supplied: true,
	}]
	state.turn = turn
	state.units = [...attackers, ...defenders]
	state.active = "ap"
	state.hands.cp = [cardId]
	state.hands.ap = []
	state.state = "combat_card_window"
	state.combat_window = {
		declaration: {
			attackers: ["attacker"], target: target.id,
			attack_origin: { kind: "normal", source: null },
		},
		attacker: "ap", defender: "cp", side: "ap", passes: 0,
		cards: [], card_sources: {},
	}
	return { state, attackers, defenders }
}

function beginCpNavalEvent(id) {
	const state = setupGame(id)
	state.turn = 5
	state.commitment.cp = "limited"
	state.state = "naval_choice"
	state.phase = "海军阶段"
	state.active = "cp"
	state.hands.cp = [id]
	state.hands.ap = []
	state.decks.cp = state.decks.cp.filter((entry) => entry !== id)
	rules.action(state, CP, "naval_event", id)
	rules.action(state, AP, "naval_empty_fleet")
	return state
}

test("710 Rupprecht requires the printed HQ and grants first fire plus one loss", () => {
	const spec = data.card_effects[710].combat
	assert.equal(spec.required_hq_piece, "component-085")
	assert.equal(spec.first_fire, "cp")
	assert.equal(spec.extra_enemy_loss, 1)
	assert.equal(spec.disposition.retain_on_win, false)
	assert.equal(spec.disposition.after_combat, "remove")
})

test("711 Falkenhayn is barred on T1 and adds its unique HQ, MO, OPS and DRM", () => {
	const t1 = prepareCpAction(711, 1)
	assert.equal(rules.view(t1, CP).actions.card_event?.includes(711) || false, false)
	const t2 = prepareCpAction(711, 2)
	assert.equal(rules.view(t2, CP).actions.card_event.includes(711), true)
	const operations = data.card_effects[711].operations
	assert.equal(operations.some((op) => op.type === "reinforcement" && op.units.some((unit) => unit.piece === "component-004" && unit.count === 1)), true)
	assert.equal(operations.some((op) => op.type === "mo_modify" && op.add.some((mo) => mo.requirement === "destroy_enemy_army" && mo.target === "fr")), true)
	assert.equal(data.card_effects[711].combat.attack_drm, 1)
	assert.equal(card(711).ops, 4)
})

test("712 Christmas Truce cancels normal and MO attacks but not event attacks", () => {
	const { state } = cpDefense(712)
	rules.action(state, AP, "pass")
	assert.equal(rules.view(state, CP).actions.combat_card.includes(712), true)
	state.combat_window.declaration.attack_origin = { kind: "event", source: "cp_法军进攻学说" }
	assert.equal(rules.view(state, CP).actions.combat_card?.includes(712) || false, false)
	state.combat_window.declaration.attack_origin = { kind: "mo_penalty", source: "ge-1" }
	assert.equal(rules.view(state, CP).actions.combat_card.includes(712), true)
	assert.equal(data.card_effects[712].combat.return_other_combat_cards, true)
})

test("713 OHL adds its German +1 DRM MO exactly once", () => {
	const state = prepareCpAction(713, 5)
	rules.action(state, CP, "card_event", 713)
	const count = () => state.mo.pool.ge.filter((mo) => mo.source_card === 713).length
	assert.equal(count(), 1)
	state.active = "cp"
	state.state = "action_card"
	state.hands.cp = [713]
	state.discard.cp = state.discard.cp.filter((id) => id !== 713)
	rules.action(state, CP, "card_event", 713)
	assert.equal(count(), 1)
	assert.equal(state.mo.pool.ge.find((mo) => mo.source_card === 713).attack_drm, 1)
})

test("714 Spirit of 1914 changes values and combat text by era and is removed from T10", () => {
	for (const [turn, expected] of [[3, { ops: 4, sr: 4, ge: 4 }], [4, { ops: 3, sr: 4, ge: 3 }], [10, { ops: 3, sr: 4, ge: 3 }]]) {
		const state = prepareCpAction(714, turn)
		const values = rules.view(state, CP).card_values[714]
		assert.equal(values.ops, expected.ops)
		assert.equal(values.sr, expected.sr)
		assert.equal(values.rp.ge, expected.ge)
	}
	const early = cpDefense(714, "fr", 3).state
	rules.action(early, AP, "pass")
	assert.equal(rules.view(early, CP).actions.combat_card.includes(714), true)
	const late = cpDefense(714, "fr", 4)
	rules.action(late.state, AP, "pass")
	rules.action(late.state, CP, "combat_card", 714)
	const modifiers = late.state.combat?.modifiers || late.state.combat_modifiers
	assert.equal(modifiers.virtual_trench, 1)
	for (const action of ["card_ops", "card_sr", "card_rp"]) {
		const removed = prepareCpAction(714, 10)
		rules.action(removed, CP, action, 714)
		assert.equal(removed.removed.cp.includes(714), true)
		assert.equal(removed.discard.cp.includes(714), false)
	}
	const fleet = setupGame(71410)
	fleet.turn = 10
	fleet.state = "naval_choice"
	fleet.phase = "海军阶段"
	fleet.active = "cp"
	fleet.hands.cp = [714]
	fleet.hands.ap = []
	fleet.decks.cp = fleet.decks.cp.filter((id) => id !== 714)
	rules.action(fleet, CP, "naval_fleet", 714)
	rules.action(fleet, AP, "naval_empty_fleet")
	assert.equal(fleet.removed.cp.includes(714), true)
	assert.equal(fleet.naval.pending_fleet_cards.cp, undefined)
})

test("715 and 717 use normal occupied-space reinforcement plus optional immediate GE RP", () => {
	for (const id of [715, 717]) {
		const operations = data.card_effects[id].operations
		const reinforcement = operations.find((op) => op.type === "reinforcement")
		const rp = operations.find((op) => op.type === "rp")
		assert.equal(reinforcement.placement, "friendly_occupied")
		assert.equal(rp.nation, "ge")
		assert.equal(rp.amount, 1)
		assert.equal(rp.immediate_choice, true)
		assert.equal(rp.retain_unspent, true)
	}
	assert.equal(data.card_effects[715].operations[0].units.filter((unit) => unit.to === "upgrade").reduce((sum, unit) => sum + unit.count, 0), 3)
	assert.equal(data.card_effects[717].operations[0].units.some((unit) => unit.piece === "component-010" && unit.count === 1), true)
})

test("716 Zeppelin Raids is a fixed two-point naval Event and lasts three turns", () => {
	const state = beginCpNavalEvent(716)
	assert.equal(state.naval.points.cp, 2)
	assert.deepEqual(state.scheduled_events.filter((effect) => effect.source_card === 716).map((effect) => effect.due_turn), [state.turn + 1, state.turn + 2])
	assert.equal(data.card_effects[716].naval_event_points, 2)
})

test("718 Tsar Takes Command requires front four and grants one front plus two EAST RP", () => {
	const low = prepareCpAction(718, 5)
	low.fronts.russian = 3
	assert.equal(rules.view(low, CP).actions.card_event?.includes(718) || false, false)
	const state = prepareCpAction(718, 5)
	state.fronts.russian = 4
	rules.action(state, CP, "card_event", 718)
	assert.equal(state.fronts.russian, 5)
	assert.equal(state.rp.cp.east, 2)
	assert.equal(state.removed.cp.includes(718), true)
})

test("719 Haig is a CP defense combat card, adds one British MO, fires first, forbids AP advance, and discards", () => {
	const { state } = cpDefense(719, "br", 5)
	assert.equal(rules.view(state, AP).actions.card_event?.includes(719) || false, false)
	rules.action(state, AP, "pass")
	assert.equal(rules.view(state, CP).actions.combat_card.includes(719), true)
	rules.action(state, CP, "combat_card", 719)
	const modifiers = state.combat?.modifiers || state.combat_modifiers
	assert.equal(modifiers.first_fire, "cp")
	assert.deepEqual(modifiers.prohibit_advance, ["ap"])
	assert.equal(state.mo.pool.br.filter((mo) => mo.source_card === 719).length, 1)
	assert.equal(data.card_effects[719].combat.disposition.after_combat, "discard")
	assert.equal(data.card_effects[719].combat.disposition.retain_on_win, false)
})

test("version 24 migration adds the missing 713 MO without rewriting old history", () => {
	const state = setupGame(71325)
	state.version = 24
	state.events[card(713).event] = { turn: 3, faction: "cp" }
	state.event_history = [{ card: 713, turn: 3, faction: "cp" }]
	delete state.mo.pool.ge
	const history = JSON.parse(JSON.stringify(state.event_history))
	rules.view(state, CP)
	assert.equal(state.version, 42)
	assert.equal(state.mo.pool.ge.filter((mo) => mo.source_card === 713).length, 1)
	assert.deepEqual(state.event_history, history)
})


