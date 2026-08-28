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

function prepareAction(id, commitment = "total") {
	const state = setupGame(id)
	state.turn = 10
	state.active = "ap"
	state.state = "action_card"
	state.phase = "行动阶段"
	state.commitment.ap = commitment
	state.hands.ap = [id]
	state.decks.ap = state.decks.ap.filter((entry) => entry !== id)
	return state
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

function beginNaval(apCard, use, commitment = "total") {
	const state = setupGame(apCard + (use === "fleet" ? 1000 : 0))
	state.turn = 10
	state.commitment.ap = commitment
	state.state = "naval_choice"
	state.phase = "海军阶段"
	state.active = "cp"
	state.hands.cp = []
	state.hands.ap = [apCard]
	state.decks.ap = state.decks.ap.filter((id) => id !== apCard)
	rules.action(state, CP, "naval_empty_fleet")
	rules.action(state, AP, use === "event" ? "naval_event" : "naval_fleet", apCard)
	return state
}

function combat654(withCadorna = false) {
	const state = setupGame(withCadorna ? 6542 : 6541)
	const target = data.spaces.find((space) => space.id === "treviso")
	const origin = target.connections.find((id) =>
		rules._test.connectionAllows(id, target.id, "attack", "ap"))
	assert.ok(origin)
	const attackerPiece = data.pieces.find((piece) => piece.nation === "it" && piece.type === "army")
	const defenderPiece = data.pieces.find((piece) => piece.nation === "ah" && piece.type === "army")
	const attackers = [{
		id: "it-attacker", piece: attackerPiece.id, faction: "ap", nation: "it",
		type: "army", location: origin, reduced: false, supplied: true,
	}]
	const defenders = [{
		id: "ah-defender", piece: defenderPiece.id, faction: "cp", nation: "ah",
		type: "army", location: target.id, reduced: false, supplied: true,
	}]
	state.units = [...attackers, ...defenders]
	state.active = "ap"
	state.commitment.ap = "limited"
	state.hands.ap = [654]
	state.state = "combat_card_window"
	state.combat_window = {
		declaration: { attackers: [attackers[0].id], target: target.id },
		attacker: "ap", defender: "cp", side: "ap", cards: [], card_sources: {},
	}
	if (withCadorna) state.events[card(627).event] = { faction: "ap" }
	return { state, attackers, defenders }
}

test("650 Hellfighters supplies its reinforcements, US defense MO, OPS modifier, and removal", () => {
	const state = prepareAction(650)
	state.events[card(646).event] = { faction: "ap" }
	state.events.entry_us = true
	rules.action(state, AP, "card_event", 650)
	finishReinforcement(state)
	assert.equal(state.removed.ap.includes(650), true)
	assert.equal(state.mo.pool.us.some((mo) => mo.source_card === 650 && mo.requirement === "defense_win_counterattack"), true)
	assert.equal(state.mo.draw_count.us, 1)
	assert.deepEqual(data.card_effects[650].ops, { attack_column: 1, ignore_trench_with_nation: "us" })
})

test("651 Junker Officers is a no-effect mobilization event with no reaction", () => {
	const state = prepareAction(651, "mobilization")
	const actions = rules.view(state, AP).actions
	assert.equal(card(651).color, "white")
	assert.equal(card(651).event, "ap_容克军官")
	assert.deepEqual(data.card_effects[651].operations, [{ type: "noop" }])
	assert.equal(actions.card_event?.includes(651) || false, true)
	assert.equal(actions.card_ops.includes(651), true)
	assert.equal(actions.card_sr.includes(651), true)
	assert.equal(actions.card_rp.includes(651), true)
})

test("652 Women Workers searches deck or discard for a structured LCU reinforcement and then grants 2 OP", () => {
	const state = prepareAction(652, "limited")
	state.discard.ap = [650]
	state.events[card(646).event] = { faction: "ap" }
	rules.action(state, AP, "card_event", 652)
	assert.equal(state.pending_event.kind, "card_search")
	assert.equal(rules.view(state, AP).actions.event_choose.includes("650"), true)
	rules.action(state, AP, "event_choose", "650")
	assert.equal(state.hands.ap.includes(650), true)
	assert.equal(state.removed.ap.includes(652), true)
	assert.equal(state.state, "ops_activate")
	assert.equal(state.ops.total, 2)
})

test("653 Salonika action event excludes Indian SCU while its naval event is only one point", () => {
	const state = prepareAction(653, "limited")
	const indianPiece = data.pieces.find((piece) => piece.id === "component-089")
	const frenchPiece = data.pieces.find((piece) => piece.nation === "fr" && piece.type === "corps")
	const britishPiece = data.pieces.find((piece) => piece.nation === "br" && piece.type === "corps" &&
		!["component-089", "component-090"].includes(piece.id))
	state.reserves.ap.push({ id: "indian-test", piece: indianPiece.id, reduced: false })
	state.reserves.ap.push(
		{ id: "fr-test-1", piece: frenchPiece.id, reduced: false },
		{ id: "fr-test-2", piece: frenchPiece.id, reduced: false },
		{ id: "br-test-1", piece: britishPiece.id, reduced: false },
		{ id: "br-test-2", piece: britishPiece.id, reduced: false },
	)
	rules.action(state, AP, "card_event", 653)
	rules.action(state, AP, "event_choose", "remove_corps")
	const actions = rules.view(state, AP).actions
	assert.equal(actions.select_event_unit.includes("indian-test"), false)
	const selected = []
	for (const id of actions.select_event_unit) {
		const unit = state.units.find((entry) => entry.id === id) || state.reserves.ap.find((entry) => entry.id === id)
		const nation = data.pieces.find((piece) => piece.id === unit.piece).nation
		if (nation === "fr" && selected.filter((entry) => entry.nation === "fr").length < 2)
			selected.push({ id, nation })
		else if (nation === "br" && !["component-089", "component-090"].includes(unit.piece) &&
			selected.filter((entry) => entry.nation === "br").length < 2)
			selected.push({ id, nation })
	}
	assert.equal(selected.length, 4)
	for (const entry of selected) rules.action(state, AP, "select_event_unit", entry.id)
	rules.action(state, AP, "event_units_confirm")
	assert.equal(state.war_status.ap, 1)
	assert.equal(state.vp, 9)
	assert.ok(state.events[card(653).event])

	const naval = beginNaval(653, "event", "limited")
	assert.equal(naval.naval.points.ap, 1)
	assert.equal(naval.war_status.ap, 0)
	assert.equal(Boolean(naval.events[card(653).event]), false)
})

test("654 Gorizia is limited to an AP attack on an Italian fort and gains Cadorna's column", () => {
	for (const withCadorna of [false, true]) {
		const { state, attackers, defenders } = combat654(withCadorna)
		assert.equal(rules.view(state, AP).actions.combat_card.includes(654), true)
		rules.action(state, AP, "combat_card", 654)
		const modifiers = rules._test.combatModifiers(
			state, state.combat_window.declaration, attackers, defenders)
		assert.equal(modifiers.defense_drm, -1)
		assert.equal(modifiers.attack_column, withCadorna ? 1 : 0)
	}
})

test("655 Sick Man stages four printed SCU and advances the Turkish front only on confirmation", () => {
	const state = prepareAction(655, "limited")
	state.events[card(703).event] = { faction: "cp" }
	state.events.entry_tu = true
	const before = state.fronts.turkish
	rules.action(state, AP, "card_event", 655)
	assert.equal(state.fronts.turkish, before)
	finishReinforcement(state)
	assert.equal(state.fronts.turkish, before + 1)
	assert.equal(state.event_history.at(-1).card, 655)
})

test("656 Wilson requires one printed treaty and adds one point to both naval uses", () => {
	const illegal = prepareAction(656)
	assert.equal(rules.view(illegal, AP).actions.card_event?.includes(656) || false, false)
	illegal.events[card(746).event] = { faction: "cp" }
	assert.equal(rules.view(illegal, AP).actions.card_event.includes(656), true)

	const eventState = setupGame(6561)
	eventState.turn = 10
	eventState.commitment.ap = "total"
	eventState.events[card(746).event] = { faction: "cp" }
	eventState.state = "naval_choice"
	eventState.active = "cp"
	eventState.hands.cp = []
	eventState.hands.ap = [656]
	rules.action(eventState, CP, "naval_empty_fleet")
	rules.action(eventState, AP, "naval_event", 656)
	assert.equal(eventState.naval.points.ap, 2)
	assert.equal(eventState.entry_tracks.us, 0)
	assert.equal(eventState.vp, 9)

	const fleetState = setupGame(6562)
	fleetState.turn = 10
	fleetState.commitment.ap = "total"
	fleetState.events[card(746).event] = { faction: "cp" }
	fleetState.state = "naval_choice"
	fleetState.active = "cp"
	fleetState.hands.cp = []
	fleetState.hands.ap = [656]
	rules.action(fleetState, CP, "naval_empty_fleet")
	rules.action(fleetState, AP, "naval_fleet", 656)
	assert.equal(fleetState.naval.points.ap, 4)
})

test("657 Victory or Collapse enforces its event timing and late-war persistent restrictions", () => {
	const early = prepareAction(657)
	early.turn = 11
	assert.equal(rules.view(early, AP).actions.card_event?.includes(657) || false, false)
	const state = prepareAction(657)
	state.turn = 12
	state.entry_tracks.us = 2
	rules.action(state, AP, "card_event", 657)
	assert.equal(state.entry_tracks.us, 1)
	assert.equal(state.vp, 9)
	assert.equal(state.removed.ap.includes(657), true)
	assert.equal(data.card_effects[657].operations[0].rebuild_limits.ge[0], 1)
})

test("658 Great Retreat is removed as an Event and by every Total War use", () => {
	const limited = prepareAction(658, "limited")
	limited.fronts.russian = 4
	rules.action(limited, AP, "card_event", 658)
	assert.equal(limited.removed.ap.includes(658), true)
	assert.equal(limited.discard.ap.includes(658), false)
	rules._test.moveFront(limited, "russian", 1, "test")
	assert.equal(limited.fronts.russian, 4)

	for (const use of ["card_ops", "card_sr", "card_rp"]) {
		const state = prepareAction(658, "total")
		const actions = rules.view(state, AP).actions
		assert.equal(actions.card_event?.includes(658) || false, false)
		assert.equal(actions[use].includes(658), true)
		rules.action(state, AP, use, 658)
		assert.equal(state.removed.ap.includes(658), true)
	}

	const fleet = beginNaval(658, "fleet", "total")
	assert.equal(fleet.removed.ap.includes(658), true)
	assert.equal(fleet.naval.pending_fleet_cards.ap, undefined)
})

test("version 22 migration adds corrected commitment cards and cancels an unconfirmed 651 reaction", () => {
	const state = setupGame(6590)
	state.version = 22
	state.commitment.ap = "limited"
	for (const pool of [state.decks.ap, state.hands.ap, state.discard.ap, state.removed.ap])
		for (const id of [651, 652, 653, 654, 655, 658]) {
			let index
			while ((index = pool.indexOf(id)) >= 0) pool.splice(index, 1)
		}
	state.active = "ap"
	state.state = "event"
	state.ops = { execution_phase: null }
	state.pending_event = { kind: "activation_conversion", card: 651, owner: "ap" }
	rules.view(state, AP)
	assert.equal(state.version, 42)
	assert.equal(state.pending_event, null)
	assert.equal(state.active, "cp")
	assert.equal(state.state, "ops_activate")
	for (const id of [651, 652, 653, 654, 655, 658])
		assert.equal(state.decks.ap.includes(id), true)
})


