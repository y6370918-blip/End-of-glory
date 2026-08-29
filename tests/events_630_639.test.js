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

function prepareEvent(id, seed = id) {
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

function finishReinforcement(state) {
	let guard = 0
	while (state.pending_event?.kind === "reinforcement") {
		assert.ok(guard++ < 30)
		const actions = rules.view(state, AP).actions
		if (actions.reinforcement_to_reserve)
			rules.action(state, AP, "reinforcement_to_reserve")
		else if (actions.event_space?.length)
			rules.action(state, AP, "event_space", actions.event_space[0])
		else
			rules.action(state, AP, "event_confirm")
	}
}

function selectEventUnits(state, role, ids) {
	for (const id of ids) rules.action(state, role, "select_event_unit", id)
	rules.action(state, role, "event_units_confirm")
}

function combatFixture(id, italian = false) {
	const state = setupGame(id)
	const spaces = new Map(data.spaces.map((space) => [space.id, space]))
	const edge = data.edges.find((candidate) => {
		if (!(candidate.modes || []).includes("attack")) return false
		if (!italian) return true
		return spaces.get(candidate.a)?.nation === "it" || spaces.get(candidate.b)?.nation === "it"
	})
	assert.ok(edge)
	const origin = italian && spaces.get(edge.a)?.nation !== "it" ? edge.b : edge.a
	const target = origin === edge.a ? edge.b : edge.a
	const attackerPiece = data.pieces.find((piece) =>
		piece.faction === "ap" && piece.type === "corps" &&
		(!italian || piece.nation === "it"))
	const defenderPiece = data.pieces.find((piece) =>
		piece.faction === "cp" && ["army", "corps"].includes(piece.type))
	assert.ok(attackerPiece)
	assert.ok(defenderPiece)
	const attacker = {
		id: `attacker-${id}`,
		piece: attackerPiece.id,
		faction: "ap",
		nation: attackerPiece.nation,
		type: attackerPiece.type,
		location: origin,
		reduced: false,
		supplied: true,
	}
	const defender = {
		id: `defender-${id}`,
		piece: defenderPiece.id,
		faction: "cp",
		nation: defenderPiece.nation,
		type: defenderPiece.type,
		location: target,
		reduced: false,
		supplied: true,
	}
	state.units = [attacker, defender]
	state.active = "ap"
	state.state = "combat_card_window"
	state.hands.ap = [id]
	state.combat_window = {
		attacker: "ap",
		defender: "cp",
		side: "ap",
		cards: [],
		declaration: { attackers: [attacker.id], target },
	}
	return { state, attacker, defender, target }
}

test("630 Domestic Politicians is prohibited by Cadorna and creates only one Cadorna HQ", () => {
	const blocked = prepareEvent(630, 6301)
	blocked.events[card(627).event] = { faction: "ap", duration: "game" }
	assert.equal(rules.view(blocked, AP).actions.card_event?.includes(630) || false, false)

	const state = prepareEvent(630, 6302)
	state.events.entry_it = true
	rules.action(state, AP, "card_event", 630)
	finishReinforcement(state)
	assert.equal(state.units.filter((unit) => unit.piece === "component-009").length, 1)
	assert.equal(state.mo.pool.it.filter((entry) => entry.source_card === 630).length, 1)
	assert.equal(state.mo.draw_limit.it, 1)
	assert.equal(state.removed.ap.includes(630), true)
})

test("631 They Shall Not Pass deploys Petain once and discards unused temporary French RP", () => {
	const state = setupGame(6311)
	const french = state.units.find((unit) => unit.nation === "fr" && unit.type === "army" && !unit.reduced)
	const german = state.units.find((unit) => unit.faction === "cp" && unit.type === "army")
	assert.ok(french)
	assert.ok(german)
	state.active = "ap"
	state.hands.ap = [631]
	state.control[french.location] = "ap"
	state.combat = {
		attacker: "cp",
		attackers: [german.id],
		defenders: [french.id],
		target: french.location,
		attack_loss: 1,
		defense_loss: 1,
		modifiers: { cancel_retreat: [], cancel_advance: [], cards: [] },
		origins: { [german.id]: german.location, [french.id]: french.location },
	}
	state.post_combat_window = { attacker: "cp", defender: "ap", side: "ap" }
	state.state = "post_combat_card_window"
	const rpBefore = state.rp.ap.fr
	rules.action(state, AP, "combat_card", 631)
	const hqSpace = rules.view(state, AP).actions.event_space[0]
	assert.ok(hqSpace)
	rules.action(state, AP, "event_space", hqSpace)
	selectEventUnits(state, AP, [french.id])
	assert.equal(french.reduced, true)
	assert.equal(state.rp.ap.fr, rpBefore + 1)
	rules.action(state, AP, "event_choose", "done")
	rules.action(state, AP, "event_choose", "done")
	assert.equal(state.rp.ap.fr, rpBefore)
	assert.equal(state.units.filter((unit) => unit.piece === "component-001").length, 1)
	assert.equal(state.hands.ap.length, 1)
})

test("632 Landships is combat-only, clears fieldworks, and adds one AP loss point", () => {
	const action = prepareEvent(632, 6321)
	assert.equal(rules.view(action, AP).actions.card_event?.includes(632) || false, false)
	const { state, attacker, defender, target } = combatFixture(632)
	state.fortifications[target] = 3
	assert.equal(rules.view(state, AP).actions.combat_card.includes(632), true)
	rules.action(state, AP, "combat_card", 632)
	const modifiers = rules._test.combatModifiers(
		state,
		state.combat_window.declaration,
		[attacker],
		[defender],
	)
	assert.equal(modifiers.clear_fortification, true)
	assert.equal(modifiers.defense_loss_adjust, 1)
})

test("633 Conrad requires Italian entry and adds its three Austrian objectives once", () => {
	const blocked = prepareEvent(633, 6331)
	assert.equal(rules.view(blocked, AP).actions.card_event?.includes(633) || false, false)
	const state = prepareEvent(633, 6332)
	state.events[card(625).event] = { faction: "ap", duration: "game" }
	state.fronts.russian = 4
	rules.action(state, AP, "card_event", 633)
	assert.equal(state.fronts.russian, 3)
	assert.equal(state.vp, 9)
	assert.equal(state.mo.pool.ah.filter((entry) => entry.source_card === 633).length, 3)
})

test("634 All Out War grants one war-status point and requires an explicit pre-T12 trench choice", () => {
	const state = prepareEvent(634, 6341)
	state.turn = 8
	const warStatus = state.war_status.ap
	rules.action(state, AP, "card_event", 634)
	assert.equal(state.war_status.ap, warStatus + 1)
	assert.ok(state.events[`${card(634).event}_permanent`])

	const fixture = combatFixture(632, false)
	const attackerPiece = data.pieces.find((piece) => piece.nation === "br" && piece.type === "corps")
	fixture.attacker.piece = attackerPiece.id
	fixture.attacker.nation = "br"
	fixture.state.events = JSON.parse(JSON.stringify(state.events))
	fixture.state.turn = 8
	fixture.state.trenches[fixture.target] = 1
	const ordinary = rules._test.combatModifiers(
		fixture.state,
		fixture.state.combat_window.declaration,
		[fixture.attacker],
		[fixture.defender],
	)
	assert.equal(ordinary.ignore_trench, false)
	const selected = rules._test.combatModifiers(
		fixture.state,
		{ ...fixture.state.combat_window.declaration, all_out_group: "br" },
		[fixture.attacker],
		[fixture.defender],
	)
	assert.equal(selected.ignore_trench, true)
	fixture.state.turn = 12
	const automatic = rules._test.combatModifiers(
		fixture.state,
		fixture.state.combat_window.declaration,
		[fixture.attacker],
		[fixture.defender],
	)
	assert.equal(automatic.ignore_trench, true)
	assert.equal(automatic.clear_fortification, true)
	assert.equal(automatic.defense_loss_adjust, 1)
})

test("635 Influenza stages the AP MO and both secret LCU selections before applying losses", () => {
	const state = prepareEvent(635, 6351)
	const vp = state.vp
	rules.action(state, AP, "card_event", 635)
	assert.equal(state.vp, vp - 1)
	const moToken = rules.view(state, AP).actions.event_choose[0]
	assert.ok(moToken)
	const [, nation, mo] = moToken.split(":")
	rules.action(state, AP, "event_choose", moToken)
	assert.equal(state.mo.completed[nation].includes(mo), false)
	const apCandidates = rules.view(state, AP).actions.select_event_unit
	selectEventUnits(state, AP, apCandidates.slice(0, Math.min(4, apCandidates.length)))
	const cpPrivate = rules.view(state, CP).pending_event
	const observer = rules.view(state, "Observer").pending_event
	assert.equal("ap" in cpPrivate.selections, false)
	assert.deepEqual(observer.selections, {})
	const cpCandidates = rules.view(state, CP).actions.select_event_unit
	selectEventUnits(state, CP, cpCandidates.slice(0, Math.min(4, cpCandidates.length)))
	let guard = 0
	while (state.pending_event?.kind === "mass_attrition") {
		assert.ok(guard++ < 12)
		const role = state.active === "ap" ? AP : CP
		const replacement = rules.view(state, role).actions.select_event_unit
		assert.ok(replacement?.length)
		selectEventUnits(state, role, [replacement[0]])
	}
	assert.equal(state.mo.completed[nation].includes(mo), true)

	const canceled = prepareEvent(635, 6352)
	const canceledVp = canceled.vp
	rules.action(canceled, AP, "card_event", 635)
	rules.action(canceled, AP, "event_cancel")
	assert.equal(canceled.vp, canceledVp)
	assert.equal(canceled.hands.ap.includes(635), true)
})

test("636 Allenby separates its action event from the one-point naval branch", () => {
	const action = prepareEvent(636, 6361)
	action.turn = 10
	action.events[card(703).event] = { faction: "cp", duration: "game" }
	action.events.entry_tu = true
	const front = action.fronts.turkish
	rules.action(action, AP, "card_event", 636)
	assert.equal(action.fronts.turkish, front + 1)
	assert.ok(action.events[card(636).event])

	const naval = setupGame(6362)
	naval.turn = 10
	naval.events[card(703).event] = { faction: "cp", duration: "game" }
	naval.events.entry_tu = true
	naval.commitment.ap = "total"
	naval.state = "naval_choice"
	naval.active = "cp"
	naval.naval.selections = {}
	naval.naval.points = { ap: 0, cp: 0 }
	naval.naval.event_queue = []
	naval.hands.cp = []
	naval.hands.ap = [636]
	const navalFront = naval.fronts.turkish
	rules.action(naval, CP, "naval_empty_fleet")
	rules.action(naval, AP, "naval_event", 636)
	assert.equal(naval.fronts.turkish, navalFront)
	assert.equal(Boolean(naval.events[card(636).event]), false)
	assert.equal(naval.naval.points.ap, 1)
	assert.equal(naval.discard.ap.includes(636), true)
})

test("637 Piave full-strength condition uses only the seven eastern spaces or Lloyd George", () => {
	const reduced = prepareEvent(637, 6371)
	reduced.events.entry_it = true
	rules.action(reduced, AP, "card_event", 637)
	assert.deepEqual(
		reduced.pending_event.queue.slice(0, 2).map((entry) => entry.piece),
		["component-170", "component-169"],
	)
	assert.equal(reduced.pending_event.queue[0].reduced, true)
	rules.action(reduced, AP, "event_cancel")

	const occupied = prepareEvent(637, 6372)
	occupied.events.entry_it = true
	occupied.control.belluno = "cp"
	rules.action(occupied, AP, "card_event", 637)
	assert.equal(occupied.pending_event.queue[0].reduced, false)
	rules.action(occupied, AP, "event_cancel")

	const lloydGeorge = prepareEvent(637, 6373)
	lloydGeorge.events.entry_it = true
	lloydGeorge.events[card(623).event] = { faction: "ap", duration: "game" }
	rules.action(lloydGeorge, AP, "card_event", 637)
	assert.equal(lloydGeorge.pending_event.queue[0].reduced, false)
})

test("638 Cambrai permits one legal discard combat card per battle", () => {
	const state = prepareEvent(638, 6381)
	rules.action(state, AP, "card_event", 638)
	const fixture = combatFixture(632)
	fixture.state.events = JSON.parse(JSON.stringify(state.events))
	fixture.state.discard.ap = [632, 639]
	fixture.state.hands.ap = []
	const legal = rules.view(fixture.state, AP).actions.combat_card
	assert.equal(legal.includes(632), true)
	rules.action(fixture.state, AP, "combat_card", 632)
	assert.equal(fixture.state.combat_window.discard_card_used, true)
	assert.equal(rules.view(fixture.state, AP).actions.combat_card?.includes(639) || false, false)
})

test("639 Alpini is combat-only and forces the AP army fire table only in Italy", () => {
	const action = prepareEvent(639, 6391)
	assert.equal(rules.view(action, AP).actions.card_event?.includes(639) || false, false)
	const { state, attacker, defender } = combatFixture(639, true)
	assert.equal(rules.view(state, AP).actions.combat_card.includes(639), true)
	rules.action(state, AP, "combat_card", 639)
	const modifiers = rules._test.combatModifiers(
		state,
		state.combat_window.declaration,
		[attacker],
		[defender],
	)
	assert.equal(modifiers.attack_table, "army")
})
