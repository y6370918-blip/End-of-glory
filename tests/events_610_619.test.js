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

function prepareActionEvent(id, seed = id) {
	const state = setupGame(seed)
	state.turn = 8
	state.active = "ap"
	state.state = "action_card"
	state.phase = "行动阶段"
	state.commitment.ap = "total"
	state.hands.ap = [id]
	state.decks.ap = state.decks.ap.filter((entry) => entry !== id)
	return state
}

function finishReinforcement(state, rebuildCount = 0) {
	while (state.pending_event?.kind === "reinforcement") {
		const actions = rules.view(state, AP).actions
		if (actions.reinforcement_to_reserve)
			rules.action(state, AP, "reinforcement_to_reserve")
		else if (actions.event_space?.length)
			rules.action(state, AP, "event_space", actions.event_space[0])
		else rules.action(state, AP, "event_confirm")
	}
	if (state.pending_event?.kind !== "reinforcement_rebuild") return
	const candidates = rules.view(state, AP).actions.select_event_unit || []
	for (const id of candidates.slice(0, rebuildCount))
		rules.action(state, AP, "select_event_unit", id)
	rules.action(state, AP, "event_units_confirm")
	while (state.pending_event?.kind === "reinforcement_rebuild") {
		const actions = rules.view(state, AP).actions
		if (actions.reinforcement_to_reserve)
			rules.action(state, AP, "reinforcement_to_reserve")
		else if (actions.event_space?.length)
			rules.action(state, AP, "event_space", actions.event_space[0])
		else rules.action(state, AP, "event_confirm")
	}
}

test("610 requires British-family and German participants and fortifies every final survivor space", () => {
	const state = setupGame(610)
	const britishPiece = data.pieces.find((piece) =>
		["br", "ca", "in"].includes(piece.nation) && ["army", "corps"].includes(piece.type))
	const germanPiece = data.pieces.find((piece) =>
		piece.nation === "ge" && ["army", "corps"].includes(piece.type))
	const british = {
		id: "ypres-british",
		piece: britishPiece.id,
		faction: "ap",
		nation: britishPiece.nation,
		type: britishPiece.type,
		location: "london",
		reduced: false,
		supplied: true,
	}
	const german = {
		id: "ypres-german",
		piece: germanPiece.id,
		faction: "cp",
		nation: "ge",
		type: germanPiece.type,
		location: "metz",
		reduced: false,
		supplied: true,
	}
	state.units = [british, german]
	state.combat_window = {
		attacker: "ap",
		defender: "cp",
		cards: [610],
		declaration: { attackers: [british.id], target: german.location },
	}
	const modifiers = rules._test.combatModifiers(
		state,
		state.combat_window.declaration,
		[british],
		[german],
	)
	assert.equal(modifiers.attack_column, 1)
	assert.equal(modifiers.defense_column, 1)
	assert.deepEqual(modifiers.prohibit_advance, ["both"])
	assert.equal(modifiers.fortification_after, "participants")

	const attackerFinal = british.location
	const defenderFinal = german.location
	state.combat = {
		attacker: "ap",
		target: defenderFinal,
		attackers: [british.id],
		defenders: [german.id],
		modifiers,
	}
	rules._test.finishCombatSequence(state)
	assert.equal(state.fortifications[attackerFinal], 1)
	assert.equal(state.fortifications[defenderFinal], 1)
})

test("611 is unavailable before T2 and requires two Belgian SCU", () => {
	const state = setupGame(611)
	state.turn = 1
	assert.equal(rules._test.eventLegal(state, card(611)), false)
	state.turn = 2
	assert.equal(rules._test.eventLegal(state, card(611)), true)
	const belgian = state.units.filter((unit) => unit.nation === "be" && unit.type === "corps")
	state.units = state.units.filter((unit) => !belgian.slice(1).includes(unit))
	state.reserves.ap = state.reserves.ap.filter((unit) => unit.nation !== "be" || unit.type !== "corps")
	state.eliminated.ap = state.eliminated.ap.filter((unit) => unit.nation !== "be" || unit.type !== "corps")
	assert.equal(rules._test.eventLegal(state, card(611)), false)
})

test("612 applies -1 to the CP attack and prohibits CP advance across a river", () => {
	const edge = data.edges.find((entry) =>
		entry.type === "land" && data.spaces.find((space) => space.id === entry.b)?.nation === "be")
	assert.ok(edge)
	const connection = rules._test.connectionBetween(edge.a, edge.b)
	connection.river = true
	try {
		const state = setupGame(612)
		const german = state.units.find((unit) => unit.nation === "ge" && unit.type !== "hq")
		const defender = state.units.find((unit) => unit.faction === "ap" && unit.type !== "hq")
		german.location = edge.a
		defender.location = edge.b
		state.combat_window = {
			attacker: "cp",
			defender: "ap",
			cards: [612],
			declaration: { attackers: [german.id], target: edge.b },
		}
		const modifiers = rules._test.combatModifiers(
			state,
			state.combat_window.declaration,
			[german],
			[defender],
		)
		assert.equal(modifiers.attack_drm, -1)
		assert.equal(modifiers.defense_drm, 1)
		assert.equal(modifiers.crosses_river, true)
		assert.ok(modifiers.prohibit_advance.includes("cp"))
	} finally {
		delete connection.river
	}
})

test("613 is not playable unless at least one complete removal branch exists", () => {
	const state = setupGame(613)
	state.units = state.units.filter((unit) =>
		!(["br", "ca", "in"].includes(unit.nation) && ["army", "corps"].includes(unit.type)))
	state.reserves.ap = state.reserves.ap.filter((unit) =>
		!(["br", "ca", "in"].includes(unit.nation) && ["army", "corps"].includes(unit.type)))
	assert.equal(rules._test.eventLegal(state, card(613)), false)
	const piece = data.pieces.find((entry) => entry.nation === "br" && entry.type === "corps" && entry.group !== "bef")
	for (let index = 0; index < 3; index++)
		state.reserves.ap.push({
			id: `colonies-${index}`,
			piece: piece.id,
			faction: "ap",
			nation: "br",
			type: "corps",
			reduced: false,
		})
	assert.equal(rules._test.eventLegal(state, card(613)), true)
})

test("614 is legal only through T3", () => {
	const state = setupGame(614)
	state.turn = 3
	assert.equal(data.card_effects[614].prerequisites.max_turn, 3)
	state.turn = 4
	assert.equal(rules._test.eventLegal(state, card(614)), false)
})

test("615 permits rebuilding zero French units without changing the eliminated pool", () => {
	const state = prepareActionEvent(615)
	const before = state.eliminated.ap.map((unit) => unit.id)
	rules.action(state, AP, "card_event", 615)
	finishReinforcement(state, 0)
	assert.deepEqual(state.eliminated.ap.map((unit) => unit.id), before)
	assert.ok(state.events[card(615).event])
})

test("616 may rebuild a French SCU to reserve on its reduced side", () => {
	const state = prepareActionEvent(616)
	const corps = state.units.find((unit) => unit.nation === "fr" && unit.type === "corps")
	state.units.splice(state.units.indexOf(corps), 1)
	delete corps.location
	state.eliminated.ap.push(corps)
	rules.action(state, AP, "card_event", 616)
	finishReinforcement(state, 1)
	assert.ok(state.reserves.ap.includes(corps))
	assert.equal(corps.reduced, true)
})

test("617 naval event stages two armies in London and atomically adds two fortifications twice", () => {
	const state = setupGame(617)
	state.commitment.ap = "limited"
	state.hands.cp = []
	state.hands.ap = [617]
	state.decks.ap = state.decks.ap.filter((id) => id !== 617)
	rules.action(state, CP, "confirm_mo")
	rules.action(state, AP, "confirm_mo")
	rules.action(state, CP, "naval_empty_fleet")
	rules.action(state, AP, "naval_event", 617)
	const staged = rules.view(state, AP).units.filter((unit) => unit.staged)
	assert.equal(staged.filter((unit) => unit.location === "london" && unit.type === "army").length, 2)
	for (let index = 0; index < 5; index++)
		rules.action(state, AP, "reinforcement_to_reserve")
	const first = rules.view(state, AP).actions.event_space[0]
	rules.action(state, AP, "event_space", first)
	const second = rules.view(state, AP).actions.event_space[0]
	rules.action(state, AP, "event_space", second)
	assert.equal(state.fortifications[first], undefined)
	rules.action(state, AP, "event_confirm")
	assert.equal(state.fortifications[first], 2)
	assert.equal(state.fortifications[second], 2)
	assert.equal(state.units.filter((unit) => unit.reinforcement_card === 617 && unit.location === "london").length, 2)
})

function resolveBritishPair(first, second, seed) {
	const state = prepareActionEvent(first, seed)
	const before = state.mo.draw_bonus.br || 0
	rules.action(state, AP, "card_event", first)
	finishReinforcement(state)
	assert.equal(state.mo.draw_bonus.br || 0, before)
	state.turn += 1
	state.reinforcement_events_this_turn = { ap: [], cp: [] }
	state.active = "ap"
	state.state = "action_card"
	state.hands.ap = [second]
	rules.action(state, AP, "card_event", second)
	finishReinforcement(state)
	return { state, before }
}

test("618 followed by 619 adds the British MO and draw bonus exactly once", () => {
	const { state, before } = resolveBritishPair(618, 619, 61819)
	assert.equal(state.mo.draw_bonus.br, before + 1)
	assert.equal(state.mo.pool.br.filter((entry) => [618, 619].includes(entry.source_card)).length, 1)
})

test("619 followed by 618 adds the same group bonus exactly once", () => {
	const { state, before } = resolveBritishPair(619, 618, 61918)
	assert.equal(state.mo.draw_bonus.br, before + 1)
	assert.equal(state.mo.pool.br.filter((entry) => [618, 619].includes(entry.source_card)).length, 1)
})

